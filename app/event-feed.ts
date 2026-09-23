// 진행중·예정 게임 이벤트 피드 — 워커(terra-archive-broadcast)가 KR activity_table 과 공식 카페 공지를 모아 준다.
//
// 헤더(app/home.tsx — 진행중 이벤트 그룹·이벤트 목록·홈 이벤트 띠)와 이벤트 도감 상세(app/events.tsx — 공식 카페
// 버튼)가 **같은 요청 하나**를 나눠 쓴다 (모듈 공유 프라미스). 이벤트 도감은 지연 청크라 home.tsx 에서 가져오면
// 순환이 생겨서 여기로 뺐다 (2026-09-23).
// ⚠ 워커 이름은 방송 기능 때 만든 것이 그대로다 — 2026-09-23 방송을 걷어냈지만 이벤트는 이 워커가 싣는다.
// 진행중 판정은 부르는 쪽이 start/end 를 지금 시각과 비교한다 (워커 데이터가 묵어도 정확).

export const EVENT_API = "https://terra-archive-broadcast.nzkonaru.workers.dev/";

/** url = 공식 네이버 카페 이벤트 공지 (워커가 제목 매칭으로 찾는다 — 못 찾으면 없음) */
export type GameEvent = { id: string; name: string; type?: string | null; displayType?: string | null; start: string; end: string; url?: string };

/** 공식 카페 이벤트 게시판 — 개별 공지를 못 찾은 이벤트의 착지점 (2026-07-31 실확인: 로그인 없이 열린다) */
export const CAFE_EVENT_BOARD = "https://cafe.naver.com/f-e/cafes/29703924/menus/3";

let feed: Promise<{ events: GameEvent[] } | null> | null = null;

/** 워커 피드 — 세션에 한 번만 받는다. 불통이면 null (부르는 쪽은 정적 폴백 없이 비워 둔다) */
export function fetchEventPayload(): Promise<{ events: GameEvent[] } | null> {
  feed ??= fetch(EVENT_API)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data ? { events: Array.isArray(data.events) ? data.events : [] } : null))
    .catch(() => null);
  return feed;
}
