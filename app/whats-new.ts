// 신규 기능 배지 — 기능 출시일로부터 7일간 'NEW'를 표시한다 (사용자 정책 2026-07-23).
// 새 기능을 추가하면 여기에 키와 출시일(YYYY-MM-DD, KST 자정 기준)만 등록하면 된다.
// 판정은 클라이언트 렌더 시각 기준 — 정적 사이트라 서버 시각에 의존하지 않는다.
export const FEATURE_RELEASED: Record<string, string> = {
  scanner: "2026-07-23", // 스크린샷으로 보유 오퍼 스캔 (보유 오퍼 설정 모달)
  lens: "2026-07-23", // 스크린샷 렌즈 — 게임 화면 인식 → 해당 정보로 이동 (헤더)
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 출시일로부터 7일 이내이면 true. 미등록 키·기간 경과·잘못된 날짜는 false. */
export function isNewFeature(key: string): boolean {
  const date = FEATURE_RELEASED[key];
  if (!date) return false;
  const released = Date.parse(`${date}T00:00:00+09:00`);
  if (Number.isNaN(released)) return false;
  return Date.now() < released + WEEK_MS;
}
