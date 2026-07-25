// 테라 브리지 — 페이지 다리 + 캡처.
//
// ⚠ 왜 오프스크린 문서가 아니라 여기서 캡처하나 (2026-07-26 실측):
//   MV3 서비스 워커의 chooseDesktopMedia는 **대상 탭이 필수**이고, 그렇게 받은 스트림 id는
//   그 탭의 렌더러에 묶인다. 오프스크린 문서에서 소비하면 "Error starting tab capture"로
//   실패한다. 그래서 캡처는 사이트 탭과 같은 렌더러인 이 콘텐츠 스크립트가 맡는다.
//
// ⚠ 왜 프레임 수신과 판정을 분리했나 (2026-07-26 실기에서 잡은 두 증상):
//   ① "됐다 안됐다" — 화면 캡처는 **바뀔 때만** 새 프레임을 준다. 노드 상세처럼 완전히
//      멈춘 화면은 프레임이 끊기므로, 프레임 도착에 판정을 걸면 안착을 확정하지 못한다.
//   ② "사이트로 돌아가야 반영된다" — <video>는 탭이 가려지면 프레임 갱신을 멈춘다.
//      게임이 브라우저를 덮은 상태로 도는 게 이 기능의 전제라 <video>는 못 쓴다.
//   그래서:
//      · 수신 = MediaStreamTrackProcessor (렌더링과 무관 — 탭이 가려져도 프레임이 온다)
//               도착한 프레임은 즉시 캔버스에 그려 두고 close한다 (안 닫으면 파이프가 막힌다)
//      · 판정 = setInterval (프레임이 안 와도 틱은 돈다 — 정지 화면도 안착 확정된다)
//   숨겨진 탭의 타이머는 1초로 묶이지만 그 정도면 충분하고, 5분 뒤의 '집중 스로틀'은
//   Web Lock을 쥐고 있으면 면제된다.
//
// 메시지: 페이지 ⇄ (window.postMessage) ⇄ 여기 ⇄ (chrome.runtime) ⇄ 백그라운드

const TAG = "ta-bridge";

const SMALL_W = 64, SMALL_H = 36;
const TICK_MS = 400;       // 판정 주기 (숨겨진 탭에서는 크롬이 1초로 늘린다 — 그래도 충분)
const FULL_MS = 300;       // 원본 해상도 캔버스 갱신 주기 (매 프레임 그리면 낭비)
const MOVING = 6.0;        // 평균 절대차(0~255) 이 이상이면 움직이는 중
const SETTLE_MS = 600;     // 마지막 움직임 이후 이만큼 잠잠하면 안착
const NEW_SCENE = 6.0;     // 마지막 전송본과 이 이상 다르면 새 화면
const PREVIEW_MS = 1500;
const PREVIEW_W = 360;
const STATE_MS = 2000;     // 상태 보고는 국면이 바뀔 때 + 이 주기로만

let stream = null, track = null, reader = null, timer = null, lockRelease = null, running = false;
let smallCv = null, smallCx = null, fullCv = null, fullCx = null, prevCv = null, prevCx = null;
let latestGray = null, latestW = 0, latestH = 0, lastFullAt = 0, framesIn = 0;
let prevGray = null, sentGray = null;
let lastMoveAt = 0, lastPreview = 0, lastState = 0, lastPhase = "";
let ticks = 0, emitted = 0, moving = 0;

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
    throw new Error("이 크롬은 MediaStreamTrackProcessor를 지원하지 않습니다 (크롬 94+)");
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: streamId,
        // 크게 요청해 캡처가 실제로 몇 픽셀을 주는지 본다 (반해상도 문제의 진위)
        maxWidth: opts.maxWidth || 3840,
        maxHeight: opts.maxHeight || 2160,
        maxFrameRate: 10,
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

  latestGray = null; latestW = 0; latestH = 0; lastFullAt = 0; framesIn = 0;
  prevGray = null; sentGray = null; ticks = 0; emitted = 0; moving = 0;
  lastMoveAt = Date.now(); lastPreview = 0; lastState = 0; lastPhase = "";

  running = true;
  reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  void pump();

  // 첫 프레임을 기다려야 실제 해상도를 알 수 있다
  for (let i = 0; i < 50 && !latestW; i++) await new Promise((r) => setTimeout(r, 100));
  if (!latestW) { release(); throw new Error("캡처 프레임이 오지 않습니다 — 창을 다시 선택해 주세요"); }

  const s = track.getSettings ? track.getSettings() : {};
  const settings = {
    label: track.label || "",
    width: latestW,               // 실제로 받은 프레임 크기 — 이게 정답이다
    height: latestH,
    reportedWidth: s.width || null,
    reportedHeight: s.height || null,
    frameRate: s.frameRate || null,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
  console.debug(`[bridge] 캡처 시작 — ${latestW}×${latestH} · dpr ${settings.devicePixelRatio} · ${settings.label}`);

  timer = setInterval(tick, TICK_MS);
  holdLock();
  toPage("state", { phase: "started", settings });
  return settings;
}

/** 프레임 수신 — 그려 두고 즉시 닫는다. 판정은 하지 않는다(정지 화면이면 여기가 멈추므로). */
async function pump() {
  while (running) {
    let res;
    try { res = await reader.read(); } catch { break; }
    if (res.done) break;
    const frame = res.value;
    try {
      const w = frame.displayWidth, h = frame.displayHeight;
      if (w && h) {
        latestW = w; latestH = h;
        smallCx.drawImage(frame, 0, 0, SMALL_W, SMALL_H);
        const px = smallCx.getImageData(0, 0, SMALL_W, SMALL_H).data;
        const g = new Uint8Array(SMALL_W * SMALL_H);
        for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (px[p] * 77 + px[p + 1] * 150 + px[p + 2] * 29) >> 8;
        latestGray = g;
        framesIn++;
        const now = Date.now();
        if (now - lastFullAt >= FULL_MS) {
          lastFullAt = now;
          if (fullCv.width !== w || fullCv.height !== h) { fullCv.width = w; fullCv.height = h; }
          fullCx.drawImage(frame, 0, 0, w, h);
        }
      }
    } catch { /* 프레임 하나는 건너뛴다 */ } finally {
      frame.close();   // ⚠ 반드시 닫는다
    }
  }
}

/** 숨겨진 탭의 '집중 스로틀'(5분 뒤 1분당 1회) 면제 — Web Lock 보유가 제외 조건이다. */
function holdLock() {
  try {
    navigator.locks.request("ta-bridge-capture", { mode: "shared" }, () =>
      new Promise((resolve) => { lockRelease = resolve; }));
  } catch { /* 미지원 — 타이머가 느려질 뿐 동작은 한다 */ }
}

function state(phase, d) {
  const now = Date.now();
  if (phase === lastPhase && now - lastState < STATE_MS) return;
  lastPhase = phase; lastState = now;
  toPage("state", { phase, d: round(d), ticks, emitted, moving, framesIn });
}

/** 판정 — 프레임 도착과 무관하게 돈다. 그래서 정지 화면도 안착이 확정된다. */
function tick() {
  if (!latestGray) return;
  const now = Date.now();
  ticks++;

  const first = !prevGray;
  const dMove = diff(latestGray, prevGray);
  prevGray = latestGray;

  if (now - lastPreview > PREVIEW_MS && fullCv.width > 2) {
    lastPreview = now;
    void shrink(PREVIEW_W, 0.5).then((url) => toPage("preview", { url, w: latestW, h: latestH }));
  }

  if (first) { lastMoveAt = now; state("settling", 0); return; }
  if (dMove > MOVING) { moving++; lastMoveAt = now; state("moving", dMove); return; }
  // 시간 기준 안착 — 틱 간격이 들쭉날쭉해도(숨겨진 탭 스로틀) 판정이 흔들리지 않는다
  if (now - lastMoveAt < SETTLE_MS) { state("settling", dMove); return; }

  const dScene = diff(latestGray, sentGray);
  if (dScene < NEW_SCENE) { state("same", dScene); return; }
  if (fullCv.width < 4) return;   // 아직 원본 프레임을 못 받았다

  sentGray = latestGray;
  emitted++;
  const w = fullCv.width, h = fullCv.height;
  console.debug(`[bridge] 새 화면 → 전송 #${emitted} · ${w}×${h} · 차이 ${round(dScene)} (틱 ${ticks} · 수신 ${framesIn})`);
  void toDataUrl(fullCv, 0.9).then((url) => {
    toPage("frame", { url, w, h, d: round(dScene), ticks, emitted, at: now });
    state("emit", dScene);
  });
}

async function shrink(width, q) {
  const w = Math.min(width, fullCv.width);
  const h = Math.round((fullCv.height / fullCv.width) * w);
  prevCv.width = w; prevCv.height = h;
  prevCx.drawImage(fullCv, 0, 0, w, h);
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
  if (timer) { clearInterval(timer); timer = null; }
  if (lockRelease) { try { lockRelease(); } catch { /* 이미 해제 */ } lockRelease = null; }
  if (reader) { try { reader.cancel(); } catch { /* 이미 닫힘 */ } reader = null; }
  if (stream) { stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* 이미 멈춤 */ } }); stream = null; }
  track = null;
  latestGray = null; latestW = 0; latestH = 0;
}

const round = (n) => Math.round((n || 0) * 100) / 100;
