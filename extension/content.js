// 테라 브리지 — 페이지 다리 + 캡처.
//
// ⚠ 왜 오프스크린 문서가 아니라 여기서 캡처하나 (2026-07-26 실측):
//   MV3 서비스 워커의 chooseDesktopMedia는 **대상 탭이 필수**이고, 그렇게 받은 스트림 id는
//   그 탭의 렌더러에 묶인다. 오프스크린 문서에서 소비하면 "Error starting tab capture"로
//   실패한다. 그래서 캡처는 사이트 탭과 같은 렌더러인 이 콘텐츠 스크립트가 맡는다.
//
// 탭 스로틀 대응: setInterval은 숨겨진 탭에서 1초로, 5분 뒤엔 더 심하게 묶인다.
// 그래서 타이머가 아니라 **프레임 구동**으로 돈다 — MediaStreamTrackProcessor의
// ReadableStream은 프레임이 도착할 때마다 깨어나므로 타이머 스로틀을 받지 않는다.
// (게임이 브라우저를 완전히 가려도 계속 도는 것이 이 기능의 전제다.)
//
// 메시지: 페이지 ⇄ (window.postMessage) ⇄ 여기 ⇄ (chrome.runtime) ⇄ 백그라운드

const TAG = "ta-bridge";

const SMALL_W = 64, SMALL_H = 36;
const MIN_GAP_MS = 400;    // 이 간격보다 자주는 검사하지 않는다 (나머지 프레임은 즉시 폐기)
const MOVING = 6.0;        // 평균 절대차(0~255) 이 이상이면 움직이는 중
const STILL = 2.0;         // 이 미만이면 정지로 본다
const STABLE_NEEDED = 2;   // 정지가 이만큼 연속되면 안착
const NEW_SCENE = 6.0;     // 마지막 전송본과 이 이상 다르면 새 화면
const PREVIEW_MS = 1200;
const PREVIEW_W = 360;

let track = null, reader = null, running = false;
let smallCv = null, smallCx = null, fullCv = null, fullCx = null, prevCv = null, prevCx = null;
let prevGray = null, sentGray = null;
let stable = 0, lastCheck = 0, lastPreview = 0, ticks = 0, emitted = 0, moving = 0;

function toPage(type, payload, id) {
  window.postMessage({ tag: TAG, dir: "toPage", type, id, payload }, window.location.origin);
}

// ── 페이지 → 확장 ───────────────────────────────────────────────────────────
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.tag !== TAG || msg.dir !== "toExt") return;

  if (msg.type === "ping") {
    toPage("hello", { version: chrome.runtime.getManifest().version }, msg.id);
    return;
  }
  if (msg.type === "stop") { release(); toPage("ack", { ok: true }, msg.id); toPage("ended", {}); return; }

  try {
    chrome.runtime.sendMessage({ from: "page", type: msg.type, payload: msg.payload }, (res) => {
      const err = chrome.runtime.lastError;
      if (err) { toPage("ack", { ok: false, error: err.message }, msg.id); return; }
      // 백그라운드가 창 선택까지 마치고 스트림 id를 주면 여기서 캡처를 시작한다
      if (res && res.ok && res.streamId) {
        capture(res.streamId, msg.payload || {}).then(
          (settings) => toPage("ack", { ok: true, settings }, msg.id),
          (e) => toPage("ack", { ok: false, error: String(e && e.message ? e.message : e) }, msg.id),
        );
        return;
      }
      toPage("ack", res, msg.id);
    });
  } catch (e) {
    toPage("ack", { ok: false, error: String(e && e.message ? e.message : e) }, msg.id);
  }
});

// 백그라운드가 밀어주는 알림(있으면) 중계
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.tag === TAG) toPage(msg.type, msg.payload);
});

toPage("hello", { version: chrome.runtime.getManifest().version });
document.addEventListener("DOMContentLoaded", () =>
  toPage("hello", { version: chrome.runtime.getManifest().version }));

// ── 캡처 ────────────────────────────────────────────────────────────────────
async function capture(streamId, opts) {
  release();
  if (typeof MediaStreamTrackProcessor === "undefined") {
    throw new Error("이 크롬은 MediaStreamTrackProcessor를 지원하지 않습니다 (크롬 94+ 필요)");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: streamId,
        // 크게 요청해 캡처가 실제로 몇 픽셀을 주는지 본다 (반해상도 문제의 진위)
        maxWidth: opts.maxWidth || 3840,
        maxHeight: opts.maxHeight || 2160,
        maxFrameRate: 5,
      },
    },
  });

  track = stream.getVideoTracks()[0];
  track.addEventListener("ended", () => { release(); toPage("ended", {}); });

  smallCv = new OffscreenCanvas(SMALL_W, SMALL_H);
  smallCx = smallCv.getContext("2d", { willReadFrequently: true });
  fullCv = new OffscreenCanvas(2, 2);
  fullCx = fullCv.getContext("2d");
  prevCv = new OffscreenCanvas(2, 2);
  prevCx = prevCv.getContext("2d");

  prevGray = null; sentGray = null; stable = 0; ticks = 0; emitted = 0; moving = 0;
  lastCheck = 0; lastPreview = 0;

  const s = track.getSettings ? track.getSettings() : {};
  const settings = {
    label: track.label || "",
    width: s.width || 0,
    height: s.height || 0,
    reportedWidth: s.width || null,
    reportedHeight: s.height || null,
    frameRate: s.frameRate || null,
    devicePixelRatio: window.devicePixelRatio || 1,
  };

  running = true;
  const processor = new MediaStreamTrackProcessor({ track });
  reader = processor.readable.getReader();
  void pump(settings);
  toPage("state", { phase: "started", settings });
  return settings;
}

/** 프레임 구동 루프 — 타이머가 아니라 프레임 도착이 깨운다(숨겨진 탭에서도 돈다). */
async function pump(settings) {
  while (running) {
    let result;
    try { result = await reader.read(); } catch { break; }
    if (result.done) break;
    const frame = result.value;
    try {
      // 실제 프레임 크기는 여기서 확정된다 (트랙 신고값이 비어 있는 경우 대비)
      if (!settings.width && frame.displayWidth) {
        settings.width = frame.displayWidth;
        settings.height = frame.displayHeight;
        toPage("state", { phase: "started", settings });
      }
      const now = Date.now();
      if (now - lastCheck >= MIN_GAP_MS) { lastCheck = now; inspect(frame, now); }
    } finally {
      frame.close();   // ⚠ 반드시 닫는다 — 안 닫으면 파이프가 막힌다
    }
  }
  release();
}

function inspect(frame, now) {
  const w = frame.displayWidth, h = frame.displayHeight;
  if (!w || !h) return;
  ticks++;

  smallCx.drawImage(frame, 0, 0, SMALL_W, SMALL_H);
  const d = smallCx.getImageData(0, 0, SMALL_W, SMALL_H).data;
  const g = new Uint8Array(SMALL_W * SMALL_H);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;

  const dMove = diff(g, prevGray);
  prevGray = g;

  if (now - lastPreview > PREVIEW_MS) {
    lastPreview = now;
    void shrink(frame, PREVIEW_W, 0.5).then((url) => toPage("preview", { url, w, h }));
  }

  if (dMove > MOVING) {
    moving++; stable = 0;
    toPage("state", { phase: "moving", d: round(dMove), ticks, emitted, moving });
    return;
  }
  if (dMove >= STILL) { stable = 0; return; }

  stable++;
  if (stable < STABLE_NEEDED) {
    toPage("state", { phase: "settling", d: round(dMove), ticks, emitted, moving });
    return;
  }

  const dScene = diff(g, sentGray);
  if (dScene < NEW_SCENE) {
    toPage("state", { phase: "same", d: round(dScene), ticks, emitted, moving });
    return;   // 같은 화면 — 여기서 대부분이 걸러진다
  }

  sentGray = g;
  stable = 0;
  emitted++;
  fullCv.width = w; fullCv.height = h;
  fullCx.drawImage(frame, 0, 0, w, h);
  void toDataUrl(fullCv, 0.9).then((url) => {
    toPage("frame", { url, w, h, d: round(dScene), ticks, emitted, at: now });
    toPage("state", { phase: "emit", d: round(dScene), ticks, emitted, moving });
  });
}

async function shrink(frame, width, q) {
  const w = Math.min(width, frame.displayWidth);
  const h = Math.round((frame.displayHeight / frame.displayWidth) * w);
  prevCv.width = w; prevCv.height = h;
  prevCx.drawImage(frame, 0, 0, w, h);
  return toDataUrl(prevCv, q);
}

async function toDataUrl(canvas, q) {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: q });
  return await new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });
}

function diff(a, b) {
  if (!a || !b) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function release() {
  running = false;
  if (reader) { try { reader.cancel(); } catch { /* 이미 닫힘 */ } reader = null; }
  if (track) { try { track.stop(); } catch { /* 이미 멈춤 */ } track = null; }
}

const round = (n) => Math.round(n * 100) / 100;
