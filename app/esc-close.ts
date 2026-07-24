// 모든 모달 ESC 닫기 (사용자 요청 2026-07-24) — 공통 .modal-backdrop 패턴 전역 처리.
// layout.tsx 인라인 스크립트와 home.tsx(React 셸) 양쪽에서 부른다: 인라인 스크립트가
// 실행되지 않는 환경(웹뷰·개발 서버 핫리로드 꼬임 등) 대비 이중 장치. window.__taEsc
// 가드로 어느 쪽이 먼저 붙든 한 번만 바인딩된다 (중복 바인딩 = ESC 한 번에 모달 두 개 닫힘).
// 겹친 모달은 z-index 최상단(동률이면 DOM 마지막)만 닫는다: .modal-close 버튼 클릭 →
// 없으면 백드롭 자기-타깃 mousedown 디스패치(React 백드롭 클릭 닫기 핸들러가 받는다).
// rogue(rg-*) 모달은 자체 Esc 핸들러가 있어 제외. 한글 IME 조합 중엔 무시.
export function bindEscClose(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __taEsc?: number };
  if (w.__taEsc) return;
  w.__taEsc = 1;
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    // 구형 웹뷰는 key가 "Esc"거나 key 미구현(keyCode 27)일 수 있다
    if ((e.key !== "Escape" && e.key !== "Esc" && e.keyCode !== 27) || e.isComposing) return;
    const els = document.querySelectorAll<HTMLElement>(".modal-backdrop");
    if (!els.length) return;
    let top: HTMLElement | null = null;
    let tz = -1;
    for (const el of els) {
      const z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
      if (z >= tz) { tz = z; top = el; }
    }
    if (!top) return;
    const btn = top.querySelector<HTMLElement>(".modal-close");
    if (btn) { btn.click(); return; }
    top.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}
