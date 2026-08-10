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
  "rogue-cn": "2026-08-04", // 통합전략 서버 탭 — 중국 서버(전 테마 중국어 병기, CN 선행 콘텐츠)
  "op-level": "2026-08-05", // 인프라 보유 오퍼 레벨 입력 — 노정예 Lv.30 해금 기지 스킬 반영
  "invest-payback": "2026-08-05", // 육성 추천 예상 회수일 — 이성 환산 + 완성 비용 모달
  "dev-notes": "2026-08-05", // 개발자 코멘트 — 받은 제안에 대한 답변 (업데이트 내역 모달 안)
  "feedback-image": "2026-08-05", // 제안에 이미지 첨부 (최대 3장 · 드래그·붙여넣기)
  "enemy-dex": "2026-08-09", // 적 도감
  "stage-dex": "2026-08-09", // 작전 도감 — 작전 2,224개의 지형 도면·등장 적·드랍
  "route-map": "2026-08-10", // 적 이동 경로 지도 — 작전 상세·통전 전투 노드의 '이동 경로' 탭
  "sim-page": "2026-08-10", // 작전 시뮬레이터 런처(/sim) — 스폰 타임라인 재생 딥링크 (B안)
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

/**
 * 여러 기능을 품은 진입점(모달을 여는 버튼·탭)에 쓴다 — 안에 든 것 중 하나라도
 * 아직 새 기능이면 true. 열어 봐야 보이는 기능은 바깥 버튼에도 표시해 줘야 눈에 띈다
 * (사용자 요청 2026-07-29: "보유리스트 안에 버튼에 새 기능 있으니 보유리스트에도").
 */
export function anyNewFeature(...keys: string[]): boolean {
  return keys.some(isNewFeature);
}

// 탭 → 그 탭 안에 든 새 기능 키 — 햄버거 메뉴 배지용 (사용자 요청 2026-07-24:
// 새 기능이 있는 메뉴 항목에도 '새기능'을 표시). 새 기능을 다른 탭에 넣으면 여기도 갱신.
const TAB_FEATURES: Record<string, string[]> = {
  planner: ["scanner", "invest", "layout-153", "account", "endless", "op-level", "invest-payback"],
  recruit: ["lens"],
  rogue: ["lens", "rogue-inv", "bridge", "rogue-eff", "rogue-cn", "route-map"],
  story: ["lens"], // 스샷 레이더 /stories 설치 (전문 대사 검색, 2026-07-24)
  enemy: ["enemy-dex"],
  stage: ["stage-dex", "route-map"],
  sim: ["sim-page"],
};

/** 해당 탭 안에 아직 '새기능' 기간인 기능이 하나라도 있으면 true. */
export function tabHasNewFeature(tab: string): boolean {
  return anyNewFeature(...(TAB_FEATURES[tab] ?? []));
}
