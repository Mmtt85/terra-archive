// 테라 브리지 — 캡처 + 변화 게이트. 탭 스로틀을 안 받는 오프스크린 문서에서 돈다.
//
// 매 프레임 OCR을 돌리면 게임 프레임레이트를 잡아먹으므로, 싼 필터를 앞에 둔다:
//   1. 64×36 그레이로 줄여 직전 틱과의 평균 절대차를 잰다
//   2. 차이가 크면 = 전투/전환 중 → 버린다 (아무 일도 안 함)
//   3. 두 틱 연속 정지 = 화면 안착 → 후보
//   4. 마지막으로 보낸 화면과 충분히 다를 때만 원본 해상도 프레임을 보낸다
// 결과적으로 무거운 인식은 "새 화면에 막 도착했을 때" 화면당 1회만 돈다.

const SMALL_W = 64, SMALL_H = 36;
const TICK_MS = 400;
const MOVING = 6.0;        // 평균 절대차(0~255) 이 이상이면 움직이는 중
const STILL = 2.0;         // 이 미만이면 정지로 본다
const STABLE_NEEDED = 2;   // 정지 틱이 이만큼 연속되면 안착
const NEW_SCENE = 6.0;     // 마지막 전송본과 이 이상 다르면 새 화면
const PREVIEW_MS = 1200;   // 미리보기(진단용) 주기
const PREVIEW_W = 360;

let stream = null, video = null, timer = null;
let smallCv = null, smallCx = null, fullCv = null, fullCx = null, prevCv = null, prevCx = null;
let prevGray = null, sentGray = null;
let stable = 0, lastPreview = 0, ticks = 0, emitted = 0, moving = 0;

function send(type, payload) {
  try {
    const p = chrome.runtime.sendMessage({ from: "offscreen", type, payload });
    if (p && p.catch) p.catch(() => { /* 백그라운드가 잠들었거나 응답 없음 */ });
  } catch { /* 컨텍스트 소멸 */ }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.to !== "offscreen") return;
  if (msg.type === "capture") {
    capture(msg).then(sendResponse, (e) =>
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }
  if (msg.type === "release") { release(); sendResponse({ ok: true }); return false; }
});

async function capture(msg) {
  release();
  // 레거시 desktop 제약 경로 — maxWidth/maxHeight를 크게 요청해 캡처가 실제로 몇 픽셀을
  // 주는지 확인한다 (반해상도 문제의 진위가 여기서 갈린다).
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: msg.streamId,
        maxWidth: msg.maxWidth || 3840,
        maxHeight: msg.maxHeight || 2160,
        maxFrameRate: 5,
      },
    },
  });

  const track = stream.getVideoTracks()[0];
  track.addEventListener("ended", () => { release(); send("ended", {}); });

  video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  (document.body || document.documentElement).appendChild(video);
  await video.play().catch(() => { /* 자동재생 정책 무관(무음) */ });
  await new Promise((r) => {
    if (video.videoWidth) return r();
    video.addEventListener("loadedmetadata", r, { once: true });
    setTimeout(r, 3000);
  });

  smallCv = new OffscreenCanvas(SMALL_W, SMALL_H);
  smallCx = smallCv.getContext("2d", { willReadFrequently: true });
  fullCv = document.createElement("canvas");
  fullCx = fullCv.getContext("2d");
  prevCv = document.createElement("canvas");
  prevCx = prevCv.getContext("2d");

  prevGray = null; sentGray = null; stable = 0; ticks = 0; emitted = 0; moving = 0; lastPreview = 0;
  timer = setInterval(tick, TICK_MS);

  const s = track.getSettings ? track.getSettings() : {};
  const settings = {
    label: track.label || "",
    width: video.videoWidth,        // 실제로 받은 프레임 크기 (이게 정답)
    height: video.videoHeight,
    reportedWidth: s.width || null, // 트랙이 신고하는 값 (참고)
    reportedHeight: s.height || null,
    frameRate: s.frameRate || null,
    devicePixelRatio: self.devicePixelRatio || 1,
  };
  send("state", { phase: "started", settings });
  return { ok: true, settings };
}

function release() {
  if (timer) { clearInterval(timer); timer = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (video) { video.srcObject = null; video.remove(); video = null; }
}

function grayOf() {
  smallCx.drawImage(video, 0, 0, SMALL_W, SMALL_H);
  const d = smallCx.getImageData(0, 0, SMALL_W, SMALL_H).data;
  const g = new Uint8Array(SMALL_W * SMALL_H);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
  }
  return g;
}

function diff(a, b) {
  if (!a || !b) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function tick() {
  if (!video || video.readyState < 2 || !video.videoWidth) return;
  ticks++;
  const g = grayOf();
  const dMove = diff(g, prevGray);
  prevGray = g;

  const now = Date.now();
  if (now - lastPreview > PREVIEW_MS) {
    lastPreview = now;
    send("preview", { url: shrink(PREVIEW_W, 0.5), w: video.videoWidth, h: video.videoHeight });
  }

  if (dMove > MOVING) {
    moving++; stable = 0;
    send("state", { phase: "moving", d: round(dMove), ticks, emitted, moving });
    return;
  }
  if (dMove >= STILL) { stable = 0; return; }

  stable++;
  if (stable < STABLE_NEEDED) {
    send("state", { phase: "settling", d: round(dMove), ticks, emitted, moving });
    return;
  }

  const dScene = diff(g, sentGray);
  if (dScene < NEW_SCENE) {
    send("state", { phase: "same", d: round(dScene), ticks, emitted, moving });
    return;   // 같은 화면 — 안 보낸다 (여기서 대부분이 걸러진다)
  }

  sentGray = g;
  stable = 0;
  emitted++;
  const w = video.videoWidth, h = video.videoHeight;
  fullCv.width = w; fullCv.height = h;
  fullCx.drawImage(video, 0, 0, w, h);
  send("frame", {
    url: fullCv.toDataURL("image/jpeg", 0.9),
    w, h, d: round(dScene), ticks, emitted, at: now,
  });
  send("state", { phase: "emit", d: round(dScene), ticks, emitted, moving });
}

function shrink(width, q) {
  const w = Math.min(width, video.videoWidth);
  const h = Math.round((video.videoHeight / video.videoWidth) * w);
  prevCv.width = w; prevCv.height = h;
  prevCx.drawImage(video, 0, 0, w, h);
  return prevCv.toDataURL("image/jpeg", q);
}

const round = (n) => Math.round(n * 100) / 100;
