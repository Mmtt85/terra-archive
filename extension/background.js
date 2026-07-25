// 테라 브리지 — 서비스 워커. 하는 일은 **창 선택 하나**다.
//
// ⚠ 2026-07-26 실측으로 확정된 제약:
//   · MV3 서비스 워커의 chooseDesktopMedia는 대상 탭이 필수다
//     ("A target tab is required when called from a service worker context")
//   · 그렇게 받은 스트림 id는 **그 탭의 렌더러에 묶인다** — 오프스크린 문서에서
//     소비하면 "Error starting tab capture"로 실패한다.
//   그래서 캡처·변화감지는 같은 렌더러인 content.js가 맡고, 여기서는 id만 건네준다.
//
// 인식(OCR·매칭·이동)은 전부 사이트(app/lens/*)가 한다 — 확장은 프레임 수도꼭지일 뿐이라
// 규칙·데이터가 바뀌어도 갱신할 일이 없다.

const PAGE_URL = "https://terra-archive.net/";

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: PAGE_URL });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.from !== "page") return;

  if (msg.type === "start") {
    pick(sender.tab).then(
      (streamId) => sendResponse({ ok: true, streamId }),
      (e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }),
    );
    return true;   // 비동기 응답
  }
});

function pick(tab) {
  return new Promise((resolve, reject) => {
    if (!tab || tab.id == null) {
      reject(new Error("사이트 탭을 찾을 수 없습니다 — 테라 아카이브 탭에서 눌러 주세요"));
      return;
    }
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
}
