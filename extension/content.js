// 테라 브리지 — 페이지 ↔ 확장 다리 (격리 월드).
//
// 사이트는 확장 ID를 몰라도 된다. 이 콘텐츠 스크립트가 매니페스트 matches에 걸린
// 페이지에만 주입되고, window.postMessage로만 대화한다 (externally_connectable 불필요).
//   페이지 → 확장 : {tag:"ta-bridge", dir:"toExt", type, id, payload}
//   확장 → 페이지 : {tag:"ta-bridge", dir:"toPage", type, id?, payload}

const TAG = "ta-bridge";

function toPage(type, payload, id) {
  window.postMessage({ tag: TAG, dir: "toPage", type, id, payload }, window.location.origin);
}

// 페이지가 보낸 명령을 백그라운드로 넘기고, 응답을 같은 id로 돌려준다.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.tag !== TAG || msg.dir !== "toExt") return;

  if (msg.type === "ping") {
    toPage("hello", { version: chrome.runtime.getManifest().version }, msg.id);
    return;
  }
  try {
    chrome.runtime.sendMessage({ from: "page", type: msg.type, payload: msg.payload }, (res) => {
      const err = chrome.runtime.lastError;
      toPage("ack", err ? { ok: false, error: err.message } : res, msg.id);
    });
  } catch (e) {
    // 확장이 새로고침(리로드)돼 컨텍스트가 끊긴 경우
    toPage("ack", { ok: false, error: String(e && e.message ? e.message : e) }, msg.id);
  }
});

// 백그라운드가 밀어주는 상태·프레임을 페이지로 중계
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.tag === TAG) toPage(msg.type, msg.payload);
});

// 확장이 살아있다고 알린다 (페이지 스크립트가 늦게 뜨면 페이지가 ping을 보내 다시 받는다)
toPage("hello", { version: chrome.runtime.getManifest().version });
document.addEventListener("DOMContentLoaded", () =>
  toPage("hello", { version: chrome.runtime.getManifest().version }));
