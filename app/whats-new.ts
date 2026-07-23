// 신규 기능 배지 — 기능 출시일로부터 일정 기간 '새기능'을 표시한다 (사용자 정책 2026-07-23).
// 새 기능을 추가하면 여기에 키와 출시일(YYYY-MM-DD, KST 자정 기준)만 등록하면 된다.
// 기본 7일, 기능별로 days를 지정할 수 있다. 판정은 클라이언트 렌더 시각 기준.
export const FEATURE_RELEASED: Record<string, string | { date: string; days: number }> = {
  scanner: "2026-07-23", // 스크린샷으로 보유 오퍼 스캔 (보유 오퍼 설정 모달)
  lens: "2026-07-23", // 스샷 레이더 — 게임 화면 인식 → 해당 정보로 이동 (/rogue·공채 페이지별 설치)
  invest: { date: "2026-07-24", days: 3 }, // 인프라 오퍼 육성 추천 (사용자 지정 3일)
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 출시일로부터 표시 기간(기본 7일) 이내이면 true. 미등록 키·기간 경과·잘못된 날짜는 false. */
export function isNewFeature(key: string): boolean {
  const entry = FEATURE_RELEASED[key];
  if (!entry) return false;
  const date = typeof entry === "string" ? entry : entry.date;
  const days = typeof entry === "string" ? 7 : entry.days;
  const released = Date.parse(`${date}T00:00:00+09:00`);
  if (Number.isNaN(released)) return false;
  return Date.now() < released + days * DAY_MS;
}

// 탭 → 그 탭 안에 든 새 기능 키 — 햄버거 메뉴 배지용 (사용자 요청 2026-07-24:
// 새 기능이 있는 메뉴 항목에도 '새기능'을 표시). 새 기능을 다른 탭에 넣으면 여기도 갱신.
const TAB_FEATURES: Record<string, string[]> = {
  planner: ["scanner", "invest"],
  recruit: ["lens"],
  rogue: ["lens"],
};

/** 해당 탭 안에 아직 '새기능' 기간인 기능이 하나라도 있으면 true. */
export function tabHasNewFeature(tab: string): boolean {
  return (TAB_FEATURES[tab] ?? []).some(isNewFeature);
}
