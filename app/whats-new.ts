// 신규 기능 배지 — 기능 출시일로부터 **3일간** '새기능'을 표시한다
// (사용자 정책 2026-07-29: "7일 너무 길더라" — 기존 항목까지 소급해 3일로 단축.
//  그전 정책은 7일이었다: 2026-07-23 도입 → 2026-07-26 전 배지 7일 통일).
// 새 기능을 추가하면 여기에 키와 출시일(YYYY-MM-DD, KST 자정 기준)만 등록하면 된다.
// days를 지정하면 예외로 그 기간을 쓰지만, 기본 3일을 그대로 두는 것이 정책이다.
// 판정은 클라이언트 렌더 시각 기준.
export const FEATURE_RELEASED: Record<string, string | { date: string; days: number }> = {
  scanner: "2026-07-23", // 스크린샷으로 보유 오퍼 스캔 (보유 오퍼 설정 모달)
  lens: "2026-07-23", // 스샷 레이더 — 게임 화면 인식 → 해당 정보로 이동 (/rogue·공채 페이지별 설치)
  invest: "2026-07-24", // 인프라 오퍼 육성 추천
  "rogue-inv": "2026-07-24", // 통합전략 보유 리스트 — 소장품·테마 자원 인벤토리 (피드백 반영)
  "layout-153": "2026-07-24", // 인프라 플래너 기지 배치 153 프리셋 (무역 1·제조 5·발전 3)
  omni: "2026-07-25", // 헤더 만능검색 — 단어 하나로 사이트 안 아무 컨텐츠나 찾아 이동
  account: "2026-07-26", // 보유 오퍼 가져오기 — 요스타 계정 로그인으로 실제 보유 목록 동기화
  bridge: "2026-07-26", // 게임 연결 — 게임 창 라이브 캡처를 렌즈에 태워 자동 인식 (/rogue 테마별)
  endless: "2026-07-28", // 인프라 플래너 운용 방식 '장기 지속' — 컨디션 순소모 최소 편성 (무한동력 자동 우선 포함)
  "rogue-eff": "2026-07-29", // 통합전략 보유 리스트의 「Σ 효과 총합」 — 담아둔 소장품 수치 합산
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** 배지 기본 노출 기간(일). 정책 값이므로 개별 기능에서 늘리지 말 것. */
const DEFAULT_DAYS = 3;

/** 출시일로부터 표시 기간(기본 3일) 이내이면 true. 미등록 키·기간 경과·잘못된 날짜는 false. */
export function isNewFeature(key: string): boolean {
  const entry = FEATURE_RELEASED[key];
  if (!entry) return false;
  const date = typeof entry === "string" ? entry : entry.date;
  const days = typeof entry === "string" ? DEFAULT_DAYS : entry.days;
  const released = Date.parse(`${date}T00:00:00+09:00`);
  if (Number.isNaN(released)) return false;
  return Date.now() < released + days * DAY_MS;
}

// 탭 → 그 탭 안에 든 새 기능 키 — 햄버거 메뉴 배지용 (사용자 요청 2026-07-24:
// 새 기능이 있는 메뉴 항목에도 '새기능'을 표시). 새 기능을 다른 탭에 넣으면 여기도 갱신.
const TAB_FEATURES: Record<string, string[]> = {
  planner: ["scanner", "invest", "layout-153", "account", "endless"],
  recruit: ["lens"],
  rogue: ["lens", "rogue-inv", "bridge", "rogue-eff"],
  story: ["lens"], // 스샷 레이더 /stories 설치 (전문 대사 검색, 2026-07-24)
};

/** 해당 탭 안에 아직 '새기능' 기간인 기능이 하나라도 있으면 true. */
export function tabHasNewFeature(tab: string): boolean {
  return (TAB_FEATURES[tab] ?? []).some(isNewFeature);
}
