// 본문 스크롤러(.site-scroll) 헬퍼 — 헤더를 스크롤 영역에서 분리하면서(2026-07-22 사용자 요청:
// 세로 스크롤바가 헤더까지 올라오지 않고 본문에만 생기도록) window 대신 이 컨테이너가 스크롤한다.
// window.scrollTo/scrollY를 쓰던 코드는 전부 이 헬퍼를 거친다.
export function scrollerEl(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".site-scroll");
}

export function scrollMainTo(top: number) {
  scrollerEl()?.scrollTo(0, top);
}

export function scrollMainTop() {
  scrollMainTo(0);
}

export function mainScrollY(): number {
  return scrollerEl()?.scrollTop ?? 0;
}
