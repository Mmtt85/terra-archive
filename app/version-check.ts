// 새 버전 알림 (사용자 지시 2026-10-12) — 오래 열어 둔 탭이 배포 전 옛 코드로 계속 도는 것을 막는다
// (그날 2시간 넘게 열린 탭 하나가 걷어낸 PRTS 인식 기록을 계속 보냈다).
//
// 빌드 시각(__BUILD_TIME__)과 같은 값이 /version.json 에 실린다 (vite.config.ts ta-version-json). 열린 탭은 1분마다
// (가려져 있으면 쉬고) 그 파일을 받아 자기 값과 다르면 '새 버전이 있다'로 표시해 둔다. 그 뒤 **다른 화면(경로)으로 옮길 때**
// 그 주소로 새로고침해 새 버전을 받는다 — 해시만 바뀌는 모달·탭 안 이동은 그대로, PRTS 링크 연결 중에도 미룬다(끊기면 안 된다).
// 새로고침된 화면에는 "새 버전으로 자동 업데이트했어요" 토스트 (평소 매끄럽던 이동이 한 번 깜빡이는 까닭을 알린다).
// ⚠ 이 코드가 든 빌드를 받은 탭부터 동작한다 — 그 전에 열린 탭은 이 검사를 모른다.
// ⚠ Supabase 가 아니라 Pages 정적 파일이다 — 방문 DB 부담 없음.

const EVERY = 60_000;
const FLAG = "ta-updated";
let stale = false;
let started = false;

/** PRTS 링크가 연결 중인가 — bridge.ts 가 연결·해제 때 세운다 (그 모듈을 여기서 불러오지 않으려고 전역 표식으로) */
const prtsLive = () => document.documentElement.dataset.prtsLive === "1";

export function startVersionCheck(updatedMsg: string): void {
  if (started || typeof window === "undefined") return;
  started = true;
  // 방금 새 버전으로 새로고침된 화면 — 알림 한 번
  try {
    if (sessionStorage.getItem(FLAG)) {
      sessionStorage.removeItem(FLAG);
      const el = document.createElement("div");
      el.className = "toast me-share-toast";
      el.setAttribute("role", "status");
      el.textContent = updatedMsg;
      document.body.appendChild(el);
      window.setTimeout(() => el.remove(), 4000);
    }
  } catch { /* 프라이빗 모드 */ }
  const mine = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";
  if (!mine) return;
  const check = () => {
    if (stale || document.visibilityState !== "visible") return;
    fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { build?: string } | null) => { if (v?.build && v.build !== mine) stale = true; })
      .catch(() => { /* 오프라인·dev(파일 없음) — 다음에 */ });
  };
  window.setTimeout(check, 15_000);
  window.setInterval(check, EVERY);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
}

/** 화면(경로)이 바뀐 직후 부른다 — 새 버전이 있으면 그 주소로 새로고침. 새로고침했으면 true */
export function reloadIfStale(fromPath: string): boolean {
  if (!stale || location.pathname === fromPath || prtsLive()) return false;
  try { sessionStorage.setItem(FLAG, "1"); } catch { /* 무시 */ }
  location.reload();
  return true;
}
