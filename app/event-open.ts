// 어느 화면에서든 이벤트 도감 상세 모달을 연다 — 셸(home.tsx)이 이 신호를 받아 헤더 이벤트 칩과 같은
// openEventById 로 띄운다 (전용 가이드가 있는 모드는 그 가이드로). 이벤트 도감 청크는 셸이 미리 받아 둔다.
// 처음 쓰는 곳: 재료 파밍 표의 이벤트 이름 배지 (사용자 지시 2026-09-28).
export const OPEN_EVENT = "ta:open-event";

export function openEvent(id: string) {
  window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: id }));
}
