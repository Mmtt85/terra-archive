// 테라 브리지 — 서비스 워커. 창 선택(desktopCapture)과 오프스크린 문서 수명만 관리한다.
//
// 캡처·변화감지는 offscreen.js가, 인식은 **사이트가** 한다 (확장은 프레임 수도꼭지일 뿐).
// 그래서 규칙·데이터가 바뀌어도 확장은 갱신할 일이 없다.
//
// 메시지 경로
//   콘텐츠 스크립트 → 여기 : {from:"page", type:"start"|"stop"|"status"}
//   여기 → 오프스크린      : {to:"offscreen", type:"capture"|"release"}
//   오프스크린 → 여기      : {from:"offscreen", type:"state"|"preview"|"frame"|"ended"}
//   여기 → 콘텐츠 스크립트 : chrome.tabs.sendMessage({tag:"ta-bridge", ...})

const TAG = "ta-bridge";
const PAGE_URL = "https://terra-archive.net/bridge";

let capturing = false;
let siteTabId = null;   // 프레임을 보낼 사이트 탭

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: PAGE_URL });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // ── 오프스크린 → 사이트 탭 중계 ─────────────────────────────────────────
  if (msg.from === "offscreen") {
    if (msg.type === "ended") capturing = false;
    relay(msg.type, msg.payload);
    return;
  }

  // ── 사이트 페이지 명령 ──────────────────────────────────────────────────
  if (msg.from !== "page") return;

  if (msg.type === "status") {
    sendResponse({ ok: true, capturing });
    return false;
  }
  if (msg.type === "start") {
    siteTabId = sender.tab ? sender.tab.id : null;
    start(msg.payload || {}, sender.tab).then(sendResponse, (e) =>
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;   // 비동기 응답
  }
  if (msg.type === "stop") {
    stop().then(() => sendResponse({ ok: true, capturing: false }));
    return true;
  }
});

async function start(opts, tab) {
  // 창 선택 피커 — 사용자가 에뮬레이터 창을 고른다. 취소하면 빈 id가 온다.
  // ⚠ MV3 서비스 워커에서는 **대상 탭이 필수**다 ("A target tab is required when called
  //   from a service worker context"). 피커가 "누구에게 공유하는지"를 그 탭 주소로 보여준다.
  if (!tab || tab.id == null) throw new Error("사이트 탭을 찾을 수 없습니다 — 테라 아카이브 탭에서 눌러 주세요");
  const streamId = await new Promise((resolve, reject) => {
    try {
      chrome.desktopCapture.chooseDesktopMedia(["window", "screen"], tab, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!id) reject(new Error("창 선택이 취소되었습니다"));
        else resolve(id);
      });
    } catch (e) {
      reject(e);
    }
  });

  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({
    to: "offscreen",
    type: "capture",
    streamId,
    maxWidth: opts.maxWidth || 3840,
    maxHeight: opts.maxHeight || 2160,
  });
  if (!res || !res.ok) throw new Error((res && res.error) || "캡처 시작 실패");
  capturing = true;
  return { ok: true, settings: res.settings };
}

async function stop() {
  capturing = false;
  try { await chrome.runtime.sendMessage({ to: "offscreen", type: "release" }); } catch { /* 이미 없음 */ }
  try { await chrome.offscreen.closeDocument(); } catch { /* 이미 닫힘 */ }
}

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "선택한 게임 창의 화면을 캡처해 인식용 프레임을 만듭니다.",
  });
}

function relay(type, payload) {
  if (siteTabId == null) return;
  chrome.tabs.sendMessage(siteTabId, { tag: TAG, type, payload }).catch(() => { /* 탭이 닫힘 */ });
}
