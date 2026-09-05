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
  "feedback-image": "2026-08-05", // 제안에 이미지 첨부 (최대 3장 · 드래그·붙여넣기)
  "enemy-dex": "2026-08-09", // 적 도감
  "stage-dex": "2026-08-09", // 작전 도감 — 작전 2,224개의 지형 도면·등장 적·드랍
  "route-map": "2026-08-10", // 적 이동 경로 지도 — 작전 상세·통전 전투 노드의 '이동 경로' 탭
  "sim-page": "2026-08-10", // 작전 시뮬레이터 런처(/sim) — 스폰 타임라인 재생 딥링크 (B안)
  "ra-guide": "2026-08-12", // 생존연산 가이드(/ra) — 요리·제작·지역·조우·균열 + CN 신시즌
  "autochess-guide": "2026-08-22", // 위수 협의 가이드(/autochess) — 맹약·오퍼레이터 전용 능력·적·보급센터
  "event-lore": "2026-08-23", // 이벤트 기록 — 미니게임·수집으로 풀리던 의뢰서·신문·편지·평론 (각 스토리 상세의 세 번째 보기)
  "story-scene": "2026-08-25", // 스토리 리더기 — 배경·스탠딩을 세워 인게임처럼 한 줄씩 재생 (스토리 상세의 기본 보기)
  "feedback-board": "2026-08-17", // 제안 게시판 — 내 제안·개발자 답변 스레드 (작성자와 개발자만 열람)
  "ac-deck": "2026-08-29", // 덱편성 시뮬레이터 — 배치·정비구역에 기물을 담아 맹약 상태를 계산 (/autochess 제목 줄 버튼)
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** 배지 기본 노출 기간(일). 정책 값이므로 개별 기능에서 늘리지 말 것. */
const DEFAULT_DAYS = 3;

// ⚠ 판정 시계는 **빌드(=배포) 시각**으로 고정한다 — Date.now()를 쓰면 프리렌더된
// HTML(빌드 시각 기준)과 클라이언트(접속 시각 기준)의 배지 유무가 갈라져, 배지 만료일을
// 걸치는 순간부터 **모든 페이지가 하이드레이션 불일치(React #418)**로 루트를 통째로 다시
// 그리고, 그 과정에서 첫 페인트 전 스크립트가 넣은 html.dark까지 날아갔다 (2026-08-12
// 사용자 제보 "다크모드 켠 후 새로고침하면 라이트로 돌아감" — 전 페이지). 빌드 시각으로
// 고정하면 서버·클라가 언제나 같은 답을 내고, 배지는 '출시 3일 이후의 첫 배포'에 내려간다
// — 무인 파이프라인이 사실상 매일 배포하므로 실제 노출 기간은 3일과 거의 같다.
const CLOCK = (() => {
  const t = typeof __BUILD_TIME__ === "string" ? Date.parse(__BUILD_TIME__) : NaN;
  return Number.isNaN(t) ? Date.now() : t;
})();

/**
 * 위 CLOCK과 같은 **빌드 시각**. 서버 렌더에 시각이 없어 자리를 비워 두던 표시
 * (예: 포탈 DAY 카운터)의 **첫 값**으로 쓴다 — 서버·클라가 같은 값을 내므로
 * 하이드레이션이 어긋나지 않고, 마운트 뒤 실제 시각으로 갈아 끼워도 배포 당일엔
 * 값이 같아 화면이 흔들리지 않는다. 무인 파이프라인이 사실상 매일 배포한다.
 */
export const BUILD_NOW = CLOCK;

/**
 * 기간 한정 요소(게임 이벤트가 도는 동안만 뜨는 헤더 바로가기 등)의 노출 판정.
 * 시계는 위 CLOCK과 같은 **빌드 시각**이라 서버·클라가 언제나 같은 답을 낸다 —
 * 마운트 후 Date.now()로 갈아 끼우면 레이아웃이 밀리고, 렌더 중에 쓰면 React #418이다.
 * 경계는 [from, to) 이며 ISO 문자열(타임존 포함)을 그대로 받는다.
 */
export function inTimeWindow(fromISO: string, toISO: string): boolean {
  const a = Date.parse(fromISO);
  const b = Date.parse(toISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return CLOCK >= a && CLOCK < b;
}

/** 출시일로부터 표시 기간(기본 3일) 이내이면 true. 미등록 키·기간 경과·잘못된 날짜는 false. */
export function isNewFeature(key: string): boolean {
  const entry = FEATURE_RELEASED[key];
  if (!entry) return false;
  const date = typeof entry === "string" ? entry : entry.date;
  const days = typeof entry === "string" ? DEFAULT_DAYS : entry.days;
  const released = Date.parse(`${date}T00:00:00+09:00`);
  if (Number.isNaN(released)) return false;
  return CLOCK < released + days * DAY_MS;
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
  story: ["lens", "event-lore"], // 스샷 레이더(2026-07-24) · 이벤트 기록(2026-08-23)
  enemy: ["enemy-dex"],
  stage: ["stage-dex", "route-map"],
  sim: ["sim-page"],
  ra: ["ra-guide"],
  autochess: ["autochess-guide"],
};

/** 해당 탭 안에 아직 '새기능' 기간인 기능이 하나라도 있으면 true. */
export function tabHasNewFeature(tab: string): boolean {
  return anyNewFeature(...(TAB_FEATURES[tab] ?? []));
}
