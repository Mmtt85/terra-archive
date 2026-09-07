// 위수 협의 '사용 제한 오퍼레이터'(밴) 화면 — 카드 격자와 티어 배지를 읽는다 (2026-09-07, grid2 정식화).
// (순수 계산 코어. React·DOM·sharp 무의존 — 브라우저와 scripts/verify-ac/grid.ts 하네스가 같은 함수를 쓴다)
//
// 왜 얼굴이 아니라 티어 목록인가 (2026-09-06 결정):
//   밴된 기물은 자기가 속한 모든 맹약 행에 동시에 나타나므로, 행별 (맹약, 티어 목록) 관측만으로
//   조합이 거의 유일하게 정해진다 (풀이는 acsolve.ts). 여기서는 **행별 카드 박스와 티어**만 뽑는다.
//   맹약 이름·아이콘 매칭은 소비자(acmatch·통합 run) 몫 — 그래서 행마다 아이콘 자리도 함께 낸다.
//
// 왜 밝기 투영을 버리고 **빨간 금지 표식**을 쓰는가 (2026-09-07 실측):
//   구 findAcCards(밝기 투영 + 오츠)는 브리지 운영 조건(가로 900px, 카드 ≈68px)에서 온전한 행을
//   36% 만 맞혔다 — 어두운 아트 카드가 통째로 빠지고 헤더 글자가 카드로 잡혔다. 카드 우상단의
//   빨간 금지 표식(사람+X 글리프가 박힌 빨간 삼각형)은 아트와 무관하게 **모든 카드에 늘 있고**
//   UI 어디에도 같은 모양의 빨강이 없다. 이걸로 바꾼 뒤 32프레임 온전한 행 87/88(99%)·카드 티어
//   276/276·오탐 0·잘린 행 누출 0·4ms (900px, scripts/verify-ac/grid.ts 로 재현).
//
// 화면 배치:
//   [맹약 아이콘]  [카드][카드][카드]…(최대 6장)      ← 한 행 = 한 맹약. 7장째는 아이콘 없이 다음 줄(줄바꿈 행)
//    맹약 이름      카드 좌하단에 티어 배지(로마숫자), 우상단에 빨간 금지 표식
//
// 방법 (수치는 카드 한 변 c 기준):
//   · c ≈ 0.0757·W — 세 소스 모두 0.075~0.076 (v1 146/1916 · v2 137/1807 · ban2 181/2388). 피치 ≈1.41c.
//     크기는 ±3% 만 훑는다 (0.97~1.03) — 신호가 없으면(ban1 처럼 카드가 없는 화면) 최솟값에 머무는 게 정상.
//   · 열 격자: **표식 띠 [x+0.76c, x+c] 의 빨강 질량이 최대가 되는 (피치, 위상)**. 열 합은 누적합으로 O(1).
//     아트 속 빨강(머리카락·눈)은 흩어져 있어 못 이긴다. 헤더의 빨간 제목·카운트다운을 피해 y ≥ 0.15H 만 합산.
//   · 첫 열 = 띠 질량이 표식 하나의 절반 이상인 가장 왼쪽 열 (아이콘 자리에 허깃 열이 안 생기게).
//   · 행 상단: **열마다** 띠의 빨강 y-런 시작을 후보로 모아 ±0.12c 로 묶는다. 한 카드의 아트 속 빨강이 런을
//     늘려도 다른 열의 런이 깨끗해 top 이 살아남는다. ⚠ 원본 해상도에서는 표식 속 흰 글리프가 빨강 런을
//     10/14/18px 조각으로 갈라 0.10c(18.08px) 문턱에 걸렸다(ban2 정밀·아케인 행 통째로 놓침) —
//     그래서 **0.04c 이하 틈은 이어 붙인 뒤** 길이를 본다. 후보 스캔은 y=0 부터 (ban2 첫 행은 0.12H).
//   · 카드 존재: 우상단 창(0.24c 정방) 빨강 ≥0.10 **그리고 표식 모양** — 3×3 셀에서 위중앙·우하가 진하고
//     우상·좌하가 비어 있어야 한다 (S = 위중앙+우하−우상−좌하 ≥ 0.3, 정답 위치 실측 최악 0.87·보통 1.6).
//     격자 오차는 ±0.08c 를 x 로 훑어 S 최대 자리로 보정한다. 한 장짜리 행은 S ≥ 0.7 이어야 받는다
//     (아트 속 빨강으로 생기는 허깃 행은 대개 한 열).
//   · 행은 카드 수가 많은 순으로 받고 세로로 겹치는(< c) 행은 버린다 (행 간격 ≥1.35c 라 겹칠 수 없다).
//   · 줄바꿈 행: 아이콘 자리가 어둡고(luma ≤ 35 — 실측 아이콘 49~68 · 줄바꿈 자리 16~18) 바로 위 행이
//     6장이면 위 행에 붙인다 (col 은 이어서 증가). 붙일 곳이 없는 어두운 아이콘 행은 불완전으로 본다.
//   · 티어 배지(readTier): 색 배지(VI 주황·V 노랑·IV 청록·III 초록)는 색상으로, 회색 II/I 는 **3% 인셋 창**의
//     흰 비율 0.02 로 가른다. 배지 판이 안 보이면(창의 luma>40 비율 < 0.17) null.
//
// cut(불완전) 판정 — 소비자는 cut 행을 건너뛴다. 하나라도 걸리면 행의 tier 는 전부 null:
//   ① top < 1 (위가 잘림)  ② 어느 카드든 배지를 못 읽음(창이 화면 밖·판이 안 보임·'준비 완료' 버튼 아래)
//   ③ 마지막 카드 **다음 열**의 표식 자리가 버튼 패널에 걸림 — 카드가 숨어 있어도 알 수 없다. 표식 자리가
//     패널 밖인데 카드가 안 잡혔으면 카드가 없는 것이니 온전하다 (봉투 규칙 x>0.76W·y>0.85H 는 v2 f014 고수·
//     v1 f020 예견 같은 온전한 바닥 행을 잘라냈다).
//   ④ 6의 배수 장이고 줄바꿈 행이 붙지 않았는데 다음 줄(top+1.5c, 행 간격 상한)의 표식 자리가 화면 밖
//   버튼은 teal 덩어리(g>120 ∧ g−r>80 ∧ g−b>20 가 한 줄에 0.10W 이상 이어짐, x ≥ 0.6W · y ≥ 0.6H)로 찾는다 —
//   실측 top 0.874H(v1)·0.885~0.904H(v2)·0.897H(ban2), left 0.773~0.791W. 없으면 가림 없음으로 본다.
//   ⚠ teal 블록 둘레에 **어두운 반투명 패널**이 있어 그 아래 카드는 표식이 흐려져 잡히지 않는다 (v2 f011 6번째
//     사르곤 카드: 표식 창 빨강 0.02 vs 보통 0.40 — 완화 문턱으로도 0.11 이라 못 가른다. v2 f010 은 teal 왼쪽
//     35px 의 5번째 카드까지 놓쳤다). 패널 어두워짐은 teal 위 ≈0.3c 부터 시작(luma 19→11) — 그래서 teal 을
//     **위·왼쪽으로 0.6c 넓힌 사각형**을 패널로 보고 ③·②에 쓴다. 대가: 바닥 행의 5번째 자리가 패널에 걸리면
//     온전한 5장 행도 cut 이 된다 (v1 f020 예견 — 다음 프레임들(f021~)에서 잡히므로 누적 소비자에겐 무해).
//   ⚠ ②의 '판이 안 보임'이 뷰포트 잘림을 잡는다 — v1 녹화는 게임 화면 아래에 창 밖 띠(24px@900)가 붙어
//     있어 화면 끝(H)만 보면 줄바꿈 카드가 안 잘린 것으로 나왔고, 그 카드의 배지 자리는 어두운 띠라
//     회색 분기에서 I 로 읽혔다(orig 실측 누출 1). 판 존재 실측: 온전한 카드 min 0.266(orig)/0.344(900)
//     vs 잘린 카드 0.059/0.079 → 문턱 0.17.
//   ⚠ 화면 끝 1px 규칙(top+c > H−1)은 쓰지 않는다 — v2 f014 고수 행이 0.2px 차로 잘림 판정되어 88 중 1을
//     잃었고, 배지(0.97c 까지)가 다 보이면 카드 아래 1px 은 필요 없다.
//
// 좌표는 **0~1 정규화** (x·w 는 W, y·h·top 은 H 기준; icon.d 는 W 기준). 호출 측이 해상도를 몰라도 된다.
// ⚠ AcCard.x 는 카드 **아트**의 왼쪽 끝이다 — 티어 배지는 아트 밖 왼쪽으로 ≈0.10c 튀어나와 있으므로
//   배지까지 포함한 상자가 필요하면 x−0.10c 로 넓혀 쓴다 (face 정답 상자와의 차이가 이것이다, 2026-09-07).

/** 밴 카드 한 장 — 좌표는 0~1 정규화 (w=h=카드 변; 각각 W·H 기준). tier 는 행이 cut 이면 null. */
export type AcCard = { x: number; y: number; w: number; h: number; col: number; tier: number | null; red: number };
/** 한 맹약 행 — 줄바꿈 행은 이미 위 행에 합쳐져 있다. icon 은 왼쪽 맹약 아이콘 자리(원, 정규화). */
export type AcRow = { top: number; cut: boolean; cards: AcCard[]; icon: { cx: number; cy: number; d: number; luma: number } };
export type AcGrid = {
  cardPx: number;      // 카드 한 변 (px)
  pitchPx: number;     // 열 간격 (px)
  cols: number[];      // 열의 x (정규화) — 카드 아트 왼쪽 끝 격자 위치
  rows: AcRow[];       // 위→아래
  note: string[];      // 디버그 기록 (하네스·관리자 화면용)
  button: { x: number; y: number; w: number; h: number } | null;   // '준비 완료' 버튼 (정규화) — 없으면 null
};

const C_RATIO = 0.0757;          // 카드 변 / 화면 폭
const PITCH_RATIO = 1.41;        // 열 간격 / 카드 변
const SIZE_SCALES = [0.97, 0.985, 1, 1.015, 1.03];
const MARK_X0 = 0.76, MARK_H = 0.24;   // 우상단 표식 창 (카드 기준)
const PHASE_Y_MIN = 0.15;        // 위상 탐색에서 헤더(빨간 제목·카운트다운)를 피하는 상한
const RUN_GAP = 0.04, RUN_MIN = 0.10, CLUSTER_TOL = 0.12;
const MARK_FRAC_MIN = 0.10, MARK_S_MIN = 0.3, MARK_S_SINGLE = 0.7, REFINE_SPAN = 0.08;
const BUTTON_X_MIN = 0.6, BUTTON_Y_MIN = 0.6, BUTTON_RUN = 0.10;   // '준비 완료' 버튼 탐색 영역·최소 가로 길이
const PANEL_PAD = 0.6;           // teal 블록 둘레 어두운 패널 — 위·왼쪽으로 넓히는 폭 (c 단위)
const WRAP_ICON_LUMA = 35;       // 아이콘 자리 luma 이하면 줄바꿈 행
const WRAP_GAP_MAX = 1.7;        // 줄바꿈 행과 위 행의 top 차 상한 (c 단위)
const ROW_PITCH_MAX = 1.5;       // 행 간격 상한 (c 단위) — 실측 1.35(v1)~1.47(ban2)
const CARDS_PER_LINE = 6;

// ── 밴 화면 게이트 (2026-09-07) ─────────────────────────────────────────────
// 왜 필요한가: 위 격자는 **빨간 금지 표식만** 본다. 그래서 밴 화면이 아닌 곳의 붉은 UI를 카드로 착각한다 —
//   녹화 117프레임 실측에서 밴 구간 밖 **22프레임**에 '온전한 행'이 나왔다 (전투 화면 9장은 전부).
//   run.ts 가 그걸 밴 화면으로 단정해 없는 밴을 등록하고 OCR을 건너뛰었다 (사용자 신고 2026-09-07
//   "밴 리스트 인식이 뭔 모든 상황에서 계속 되냐. 밴 화면에서만 인식되게 해 줘야지").
//   기존 회귀 하네스가 밴 프레임만 넣어 보고 다른 화면을 한 번도 안 재서 생긴 구멍이다.
// 게이트는 두 겹이다 — ② 행 위생(여기, 공짜) → ③ 맹약 아이콘 매칭(acbond.ts, 행당 ≈50ms).
//   둘 다 **단독으로도** 밴 구간 밖 오탐 0 이다 (② 49행→0 · ③ 149행 중 승인 0). 겹쳐서 건다.
//
// ⚠ ①(아래 isAcBanScreen)은 **하드 게이트에서 뺐다** (2026-09-07 오후, 사용자 신고 "밴리스트가
//   전~혀 안나온다"). 셋 중 유일하게 **캡처 창 모양에 의존**하는 조건이라, 녹화 3종과 다른 창
//   비율·여백으로 캡처하면 버튼의 정규화 x 가 대역을 벗어나 **모든 프레임에서 밴이 통째로 죽는다**.
//   비대칭이 결정적이다 — ②가 진짜 행을 잘못 버리면 그 프레임만 잃고 다음 프레임이 잡지만(스토어가
//   프레임을 누적한다), ①이 틀리면 매 프레임 전부를 잃는다. 게다가 ②·③만으로 이미 오탐 0 이라
//   ①은 정확도에 보태는 게 없다. 지금은 진단 신호와, 아이콘 템플릿을 못 받았을 때의 폴백으로만 쓴다.
//
// ① 화면 서명 = 우하단 teal '준비 완료' 버튼의 **자리와 크기**. 이미 findButton 이 계산해 둔 값이다.
//    실측 117프레임 — 버튼이 잡히는 화면은 셋뿐이고 x·w 로 서로 안 겹친다:
//      정보(밴) 42장 x 0.773~0.791 · w 0.169~0.173   ← 이것만 통과시킨다
//      선택('시뮬레이션 시작') 8장 x 0.606~0.616 · w 0.264~0.269
//      메인메뉴('동맹/파티') 4장 x 0.857~0.878 · w 0.116~0.117
//      전략·확정·로딩·정비·전투 63장 — 버튼 없음
//    → 정보 42/42 · 그 외 0/75. 문제의 22프레임 전부 차단, 밴 카드가 보이는 33프레임 전부 통과.
//    서로 다른 세 캡처(1936×1098 · 1826×1030 · 2388×1668, 화면비 1.43~1.79)에서 x 0.774~0.791 ·
//    w 0.165~0.174 로 모여 문턱까지 ±20% 여유가 있다. 비용 0.18ms (격자가 이미 냈으므로 실질 0).
//    ⚠ h 는 조건에 쓰지 마라 — v2/f020 에서 버튼 높이가 0.029 까지 눌린 사례가 있다.
//    ⚠ '준비 완료'를 **누른 뒤** 버튼 색이 바뀌면 서명이 꺼진다 (녹화에 없어 미검증). 연합 다인 정보
//      화면·21:9 초광각도 미검증. 그래서 ②③을 함께 건다 — 셋 중 하나가 흔들려도 남는다.
//    ⚠ OCR 분류(classifyAcScreen)도 info 42/42 · 오탐 0 으로 똑같이 정확하지만 803ms 가 들고,
//      INFO_WORDS 에 중국어가 없어 CN 클라에서는 통째로 닫힌다. 버튼은 색·크기만 보므로 로케일 무관이다.
const INFO_BTN = { x0: 0.72, x1: 0.84, w0: 0.14, w1: 0.21 };

/** 이 프레임이 '시뮬레이션 정보'(= 밴 목록) 화면인가 — 우하단 '준비 완료' 버튼의 자리·크기로 본다.
 *  ⚠ 창 비율에 의존한다 (위). 밴 판정의 **조건으로 쓰지 마라** — 진단 로그와 폴백용이다. */
export function isAcBanScreen(grid: AcGrid): boolean {
  const b = grid.button;
  return !!b && b.x >= INFO_BTN.x0 && b.x <= INFO_BTN.x1 && b.w >= INFO_BTN.w0 && b.w <= INFO_BTN.w1;
}

// ② 행 위생 — 진짜 밴 행의 **모양**을 못박는다. 조건별 실측(밴 구간 밖 오탐 행 49개 → 누적):
//      col 0 부터 빈칸 없이 연속 → 5   (주력. 오탐은 c1 c2 c5 c6 처럼 뚝뚝 끊긴다)
//      + 카드 2장 이상          → 1   (한 장짜리 허깃 행을 쓸어낸다. 남는 1행은 ③이 죽인다)
//    온전한 행 검출은 87/89 그대로 — **잃는 행이 없다**. ban1.jpg 0행 · ban2.jpg 5행도 그대로.
//    ⚠ **red 비율 조건(행 안 폭 ≤0.10 · 최대 ≤0.55)은 뺐다** (2026-09-07 오후). 그것까지 걸면 실측
//      오탐이 1→0 이 되지만, red 는 표식의 선명도에 따라 움직이는 값이고 실측 표본이 전부 **재인코딩된
//      녹화 프레임**(mov→png→jpeg)이다. 라이브 캡처는 표식이 더 선명해 red 가 높고 카드마다 더 흔들릴 수
//      있어, 진짜 행을 **매 프레임** 버릴 위험이 있다 (사용자 신고 "밴리스트가 전~혀 안나온다"). 남는
//      오탐 1행(v2/f001)은 맹약 아이콘(③)이 확실히 죽인다 — 그쪽은 양성 0.83 vs 음성 0.43 으로 틈이 0.37 이다.
//      배율·선명도에 무관한 **구조 조건만** 여기 남긴다.
//    ⚠ 프레임 단위 하한(행 ≥2 · 이웃 행 간격 규칙성)은 쓰지 마라 — 스크롤이 막 시작돼 한 행만 보이는
//      순간을 통째로 버려 v1/f015·f016 을 잃고, 원본 해상도에서는 헤더 잡음 한 조각이 그 프레임의
//      진짜 행 전부를 죽여 87→81 이 된다 (위험이 비선형이다).
//    ⚠ '카드 2장 이상'은 밴 기물이 1명뿐인 맹약 행을 버릴 수 있다 (픽스처에 그런 행이 없어 미검증).
//      그래서 **같은 프레임에 2장 이상 행이 있으면 한 장 행도 받는다** — 실측 결과는 완전히 같으면서
//      (87/89 · f015 살음) 진짜 한 장 행을 구제할 여지가 남는다.
function rowClean(r: AcRow): boolean {
  if (r.cut || !r.cards.length) return false;
  return r.cards.every((c, i) => c.col === i && c.tier !== null);
}

/** 밴으로 받아도 되는 행만 — 위 ② 규칙. 이것만으로 밴 구간 밖 오탐 0 이고, 최종 확정은 맹약 아이콘(③)이 한다. */
export function acBanRows(grid: AcGrid): AcRow[] {
  const clean = grid.rows.filter(rowClean);
  return clean.some((r) => r.cards.length >= 2) ? clean : [];
}

const isRed = (r: number, g: number, b: number) => r > 100 && r - Math.max(g, b) > 45;
const isTeal = (r: number, g: number, b: number) => g > 120 && g - r > 80 && g - b > 20;
type Rect = { x0: number; y0: number; x1: number; y1: number };   // px, 반열림 [x0,x1)×[y0,y1)
const overlaps = (a: Rect, b: Rect | null) => !!b && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const lumaAt = (px: Uint8ClampedArray, i: number) => px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
const median = (a: number[]) => (a.length ? a.slice().sort((p, q) => p - q)[a.length >> 1] : 0);

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}

// ── 티어 배지 ───────────────────────────────────────────────────────────────
// 실측 색상 (ban2.jpg, 표본 3~5개씩 · 편차 ±0.3°): T6 31° · T5 46° · T4 189° · T3 161°. T2/T1 은 무채색.
const HUES: { tier: number; h: number }[] = [
  { tier: 6, h: 31 }, { tier: 5, h: 46 }, { tier: 4, h: 189 }, { tier: 3, h: 161 },
];
const HUE_TOL = 12;
const SAT_MIN = 0.45;
const GREY_SPLIT = 0.02;     // 인셋 창 흰 비율 — 실측 108+111장: T1 max 0.007(900)/0.000(orig) · T2 min 0.094/0.027
const PLATE_MIN = 0.17;      // 배지 창의 luma>40 비율 하한 — 아래면 배지 판이 없다(잘림)

/**
 * 카드 좌하단 배지를 읽어 티어(1~6)를 낸다. 못 읽으면 null (창이 화면 밖·배지 판이 안 보임).
 * (cx, cy) 카드 아트 좌상단 px, c 카드 변 px. 색 배지는 창 2~24%·70~97% 의 색상으로, 회색 II/I 는
 * 3% 인셋 창(5~21%·73~94%)의 흰 비율로 가른다 — 창 가장자리의 밝은 테두리가 I 를 II 로 올리던 것을 막는다.
 */
export function readTier(px: Uint8ClampedArray, W: number, H: number,
  cx: number, cy: number, c: number, split = GREY_SPLIT): number | null {
  const x0 = Math.round(cx + c * 0.02), x1 = Math.round(cx + c * 0.24);
  const y0 = Math.round(cy + c * 0.70), y1 = Math.round(cy + c * 0.97);
  if (x1 - x0 < 3 || y1 - y0 < 3 || y1 > H || y0 < 0 || x1 > W || x0 < 0) return null;
  const ix0 = Math.round(cx + c * 0.05), ix1 = Math.round(cx + c * 0.21);
  const iy0 = Math.round(cy + c * 0.73), iy1 = Math.round(cy + c * 0.94);
  const hits: number[] = [];
  let white = 0, total = 0, inTot = 0, plate = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const [h, s, v] = rgbToHsv(px[i], px[i + 1], px[i + 2]);
      total++;
      if (lumaAt(px, i) > 40) plate++;
      if (x >= ix0 && x < ix1 && y >= iy0 && y < iy1) { inTot++; if (v > 0.72 && s < 0.30) white++; }
      if (s >= SAT_MIN && v > 0.55) hits.push(h);
    }
  }
  if (!total || !inTot) return null;
  if (plate / total < PLATE_MIN) return null;          // 배지 판이 없다 — 뷰포트 아래로 잘린 카드
  if (hits.length > total * 0.06) {
    // 색상 평균은 원형이라 벡터로 낸다 (0°/360° 경계 안전)
    let sx = 0, sy = 0;
    for (const h of hits) { sx += Math.cos(h * Math.PI / 180); sy += Math.sin(h * Math.PI / 180); }
    let hm = Math.atan2(sy, sx) * 180 / Math.PI;
    if (hm < 0) hm += 360;
    let best: number | null = null, bestD = HUE_TOL;
    for (const k of HUES) {
      const d = Math.min(Math.abs(hm - k.h), 360 - Math.abs(hm - k.h));
      if (d < bestD) { bestD = d; best = k.tier; }
    }
    if (best !== null) return best;
  }
  return white / inTot > split ? 2 : 1;
}

// ── 표식 모양 ───────────────────────────────────────────────────────────────
/** 카드 우상단 창의 빨강 비율 + 3×3 모양 점수 S (위중앙 + 우하 − 우상 − 좌하) */
function markScore(px: Uint8ClampedArray, W: number, H: number, x: number, y: number, c: number) {
  const x0 = Math.round(x + c * MARK_X0), x1 = Math.round(x + c), y0 = Math.round(y), y1 = Math.round(y + c * MARK_H);
  const cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0], tot = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let n = 0, t = 0;
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  for (let yy = Math.max(0, y0); yy < Math.min(H, y1); yy++) {
    const gy = Math.min(2, Math.floor((yy - y0) * 3 / bh));
    for (let xx = Math.max(0, x0); xx < Math.min(W, x1); xx++) {
      const gx = Math.min(2, Math.floor((xx - x0) * 3 / bw));
      const i = (yy * W + xx) * 4;
      t++; tot[gy * 3 + gx]++;
      if (isRed(px[i], px[i + 1], px[i + 2])) { n++; cnt[gy * 3 + gx]++; }
    }
  }
  const f = (k: number) => (tot[k] ? cnt[k] / tot[k] : 0);
  return { frac: t ? n / t : 0, S: f(1) + f(8) - f(2) - f(6) };
}
/** 열 격자 오차(±0.08c)를 x 로 훑어 모양 점수가 최대인 자리를 카드 x 로 잡는다 */
function refineMark(px: Uint8ClampedArray, W: number, H: number, x: number, y: number, c: number) {
  const span = Math.max(2, Math.round(c * REFINE_SPAN));
  let best = { dx: 0, ...markScore(px, W, H, x, y, c) };
  for (let dx = -span; dx <= span; dx++) {
    const m = markScore(px, W, H, x + dx, y, c);
    if (m.frac >= MARK_FRAC_MIN && m.S > best.S) best = { dx, ...m };
  }
  return best;
}

// ── '준비 완료' 버튼 ─────────────────────────────────────────────────────────
/** 우하단 teal 덩어리 — 한 줄에 0.10W 이상 이어진 teal 이 있는 y 범위와 그 x 범위. 없으면 null. */
function findButton(px: Uint8ClampedArray, W: number, H: number): Rect | null {
  const xs = Math.round(W * BUTTON_X_MIN), minRun = W * BUTTON_RUN;
  let top = -1, bottom = -1, left = W, right = 0;
  for (let y = Math.round(H * BUTTON_Y_MIN); y < H; y++) {
    let run = 0, best = 0, start = xs, bl = 0, br = 0;
    for (let x = xs, i = (y * W + xs) * 4; x < W; x++, i += 4) {
      if (isTeal(px[i], px[i + 1], px[i + 2])) { if (!run) start = x; run++; if (run > best) { best = run; bl = start; br = x + 1; } }
      else run = 0;
    }
    if (best >= minRun) { if (top < 0) top = y; bottom = y + 1; left = Math.min(left, bl); right = Math.max(right, br); }
  }
  return top < 0 ? null : { x0: left, y0: top, x1: right, y1: bottom };
}

// ── 격자 ───────────────────────────────────────────────────────────────────
type PxCard = { x: number; y: number; col: number; red: number; tier: number | null };
type PxRow = { top: number; cards: PxCard[]; iconLuma: number; icon: { cx: number; cy: number; d: number }; wrapped: boolean };

/**
 * 밴 화면의 카드 행들을 찾는다. 줄바꿈 행은 위 행에 합쳐져 있고, 불완전한 행은 cut=true·tier=null 이다.
 * 카드가 없는 화면(다른 화면·맹약 정보 상단)에서는 rows 가 빈 배열 — ban1.jpg 실측 0행.
 */
export function findAcRows(px: Uint8ClampedArray, W: number, H: number): AcGrid {
  const note: string[] = [];
  const c0 = C_RATIO * W;
  // ① 열별 빨강 질량 (헤더를 피해 y ≥ 0.15H) → 누적합
  const yMin = Math.round(H * PHASE_Y_MIN);
  const cum = new Float64Array(W + 1);
  {
    const colMass = new Uint32Array(W);
    for (let y = yMin; y < H; y++) {
      let i = y * W * 4;
      for (let x = 0; x < W; x++, i += 4) if (isRed(px[i], px[i + 1], px[i + 2])) colMass[x]++;
    }
    for (let x = 0; x < W; x++) cum[x + 1] = cum[x] + colMass[x];
  }
  const bandMass = (x0: number, c: number) => {
    const a = Math.max(0, Math.min(W, Math.round(x0 + c * MARK_X0))), b = Math.max(a, Math.min(W, Math.round(x0 + c)));
    return cum[b] - cum[a];
  };
  // ② 열 격자 — (크기, 위상) 탐색: 표식 띠 질량 최대
  let best = { mass: -1, pitch: c0 * PITCH_RATIO, phase: 0, c: c0 };
  for (const sc of SIZE_SCALES) {
    const c = c0 * sc, pitch = c * PITCH_RATIO;
    for (let off = 0; off < pitch; off += 1) {
      let mass = 0;
      for (let x0 = off; x0 + c <= W + 2; x0 += pitch) {
        if (x0 < c * 1.7) continue;           // 아이콘 자리
        mass += bandMass(x0, c);
      }
      if (mass > best.mass) best = { mass, pitch, phase: off, c };
    }
  }
  const { pitch, phase, c } = best;
  const oneMark = 0.3 * (MARK_H * c) * (0.19 * c);
  const all: { x0: number; mass: number }[] = [];
  for (let x0 = phase; x0 + c <= W + 2; x0 += pitch) if (x0 >= 0) all.push({ x0, mass: bandMass(x0, c) });
  const firstIdx = all.findIndex((k) => k.mass >= oneMark * 0.5);
  const colsPx: number[] = firstIdx < 0 ? [] : all.slice(firstIdx).map((k) => k.x0);
  note.push(`c=${c.toFixed(1)} pitch=${pitch.toFixed(1)} phase=${phase} cols=[${colsPx.map((x) => x.toFixed(0)).join(",")}]`);
  const button = findButton(px, W, H);
  // 패널 = teal 을 위·왼쪽으로 넓힌 것 — 이 안의 표식·배지는 믿지 않는다
  const panel: Rect | null = button ? { x0: button.x0 - c * PANEL_PAD, y0: button.y0 - c * PANEL_PAD, x1: W, y1: H } : null;
  if (button) note.push(`button x=${button.x0}..${button.x1} y=${button.y0}..${button.y1} (패널 x≥${panel!.x0.toFixed(0)} y≥${panel!.y0.toFixed(0)})`);
  const grid: AcGrid = {
    cardPx: c, pitchPx: pitch, cols: colsPx.map((x) => x / W), rows: [], note,
    button: button ? { x: button.x0 / W, y: button.y0 / H, w: (button.x1 - button.x0) / W, h: (button.y1 - button.y0) / H } : null,
  };
  if (!colsPx.length) return grid;

  // ③ 열마다 표식 띠의 빨강 y-런(틈 ≤0.04c 는 이어서) 시작 → 후보 top → ±0.12c 로 묶기
  const cand: number[] = [];
  const gapMax = c * RUN_GAP, runMin = c * RUN_MIN;
  for (const x0 of colsPx) {
    const a = Math.max(0, Math.round(x0 + c * MARK_X0)), b = Math.min(W, Math.round(x0 + c)), thr = (b - a) * 0.2;
    if (b <= a) continue;
    let run = -1, last = -1;   // run: 현재 런 시작, last: 마지막 켜진 y
    const flush = () => { if (run >= 0 && last - run + 1 >= runMin) cand.push(run); run = -1; };
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = a, i = (y * W + a) * 4; x < b; x++, i += 4) if (isRed(px[i], px[i + 1], px[i + 2])) n++;
      if (n >= thr) {
        if (run >= 0 && y - last > gapMax) flush();
        if (run < 0) run = y;
        last = y;
      } else if (run >= 0 && y - last > gapMax) flush();
    }
    flush();
  }
  cand.sort((p, q) => p - q);
  const clusters: number[][] = [];
  for (const t of cand) {
    const k = clusters[clusters.length - 1];
    if (k && t - k[0] <= c * CLUSTER_TOL) k.push(t); else clusters.push([t]);
  }
  // ④ 후보 행마다 카드 판정 → 카드 수 많은 순으로 받되 세로로 겹치면 버린다
  type Cand = { top: number; cards: PxCard[]; support: number };
  const cands: Cand[] = [];
  for (const k of clusters) {
    const top = median(k);
    const cards: PxCard[] = [];
    const Ss: number[] = [];
    colsPx.forEach((x0, ci) => {
      const m = refineMark(px, W, H, x0, top, c);
      if (m.frac < MARK_FRAC_MIN || m.S < MARK_S_MIN) return;
      const x = x0 + m.dx;
      Ss.push(m.S);
      cards.push({ x, y: top, col: ci, red: m.frac, tier: null });
    });
    if (cards.length === 1 && Ss[0] < MARK_S_SINGLE) { note.push(`한 장 행 top=${top.toFixed(0)} S=${Ss[0].toFixed(2)} 버림`); continue; }
    if (cards.length) cands.push({ top, cards, support: k.length });
    else note.push(`후보 top=${top.toFixed(0)} (열 ${k.length}) 카드 없음`);
  }
  cands.sort((p, q) => q.cards.length - p.cards.length || q.support - p.support);
  const accepted: Cand[] = [];
  for (const cd of cands) {
    if (accepted.some((a) => Math.abs(a.top - cd.top) < c)) { note.push(`겹침 버림 top=${cd.top.toFixed(0)} ${cd.cards.length}장`); continue; }
    accepted.push(cd);
  }
  accepted.sort((p, q) => p.top - q.top);

  // ⑤ 행 — 아이콘 자리 밝기, 티어
  const rows: PxRow[] = [];
  for (const cd of accepted) {
    const top = cd.top;
    const icon = { cx: colsPx[0] - 1.26 * c, cy: top + 0.33 * c, d: 0.74 * c };
    let lum = 0, n = 0;
    for (let y = Math.max(0, Math.round(icon.cy - icon.d / 2)); y < Math.min(H, Math.round(icon.cy + icon.d / 2)); y++)
      for (let x = Math.max(0, Math.round(icon.cx - icon.d / 2)); x < Math.min(W, Math.round(icon.cx + icon.d / 2)); x++) { lum += lumaAt(px, (y * W + x) * 4); n++; }
    for (const k of cd.cards) {
      // 배지 창이 버튼 패널에 걸리면 못 읽는다 — 버튼의 teal 이 색 분기에서 III(161°)로 읽히므로 반드시 먼저 막는다
      const badge: Rect = { x0: k.x + c * 0.02, y0: k.y + c * 0.70, x1: k.x + c * 0.24, y1: k.y + c * 0.97 };
      k.tier = overlaps(badge, panel) ? null : readTier(px, W, H, k.x, k.y, c);
    }
    rows.push({ top, cards: cd.cards, iconLuma: n ? lum / n : 0, icon, wrapped: false });
    note.push(`row top=${top.toFixed(0)} cards=${cd.cards.map((k) => `${k.col}:${k.red.toFixed(2)}${k.tier === null ? "·" : `T${k.tier}`}`).join(" ")} iconLuma=${(n ? lum / n : 0).toFixed(0)}`);
  }
  // ⑥ 줄바꿈 행 — 아이콘 자리가 어둡고 바로 위 행이 6장(의 배수)이면 위 행에 붙인다 (col 은 이어서)
  const merged: (PxRow & { orphan: boolean })[] = [];
  for (const r of rows) {
    const prev = merged[merged.length - 1];
    const dark = r.iconLuma <= WRAP_ICON_LUMA;
    if (dark && prev && prev.cards.length > 0 && prev.cards.length % CARDS_PER_LINE === 0 && r.top - prev.top < c * WRAP_GAP_MAX) {
      const base = prev.cards[prev.cards.length - 1].col + 1;
      for (const k of r.cards) prev.cards.push({ ...k, col: base + k.col });
      prev.wrapped = true;
      note.push(`줄바꿈 행 top=${r.top.toFixed(0)} ${r.cards.length}장 → 위 행(top=${prev.top.toFixed(0)})에 붙임`);
      continue;
    }
    merged.push({ ...r, orphan: dark });
    if (dark) note.push(`아이콘 어두운 행 top=${r.top.toFixed(0)} 붙일 곳 없음 → 불완전`);
  }
  // ⑦ cut 판정 + 정규화
  for (const r of merged) {
    const reasons: string[] = [];
    if (r.top < 1) reasons.push("위 잘림");
    if (r.cards.some((k) => k.tier === null)) reasons.push("배지 못 읽음");
    if (r.orphan) reasons.push("줄바꿈 고아");
    // ③ 마지막 카드 다음 열의 **표식 자리**가 버튼에 가려 있으면 카드가 숨어 있어도 알 수 없다
    //    (줄의 마지막 줄 기준 — 줄바꿈 줄은 0열부터 다시 채우고 top 이 다르다)
    const lineTop = r.cards.length ? r.cards[r.cards.length - 1].y : r.top;
    const onLine = r.cards.filter((k) => k.y === lineTop).length;   // 그 줄의 카드 수 = 다음 열 번호
    if (onLine > 0 && onLine < CARDS_PER_LINE && onLine < colsPx.length) {
      const nx = colsPx[onLine];
      const mark: Rect = { x0: nx + c * MARK_X0, y0: lineTop, x1: nx + c, y1: lineTop + c * MARK_H };
      if (overlaps(mark, panel)) reasons.push("다음 열 표식이 버튼 패널에 걸림");
    }
    // ④ 줄이 꽉 찼는데(6장) 다음 줄의 표식 자리가 화면 밖 — 줄바꿈 카드가 숨어 있을 수 있다
    if (onLine === CARDS_PER_LINE && lineTop + c * ROW_PITCH_MAX + c * MARK_H > H) reasons.push("다음 줄 표식이 화면 밖");
    const cut = reasons.length > 0;
    if (cut) note.push(`cut top=${r.top.toFixed(0)}: ${reasons.join(", ")}`);
    grid.rows.push({
      top: r.top / H, cut,
      cards: r.cards.map((k) => ({ x: k.x / W, y: k.y / H, w: c / W, h: c / H, col: k.col, tier: cut ? null : k.tier, red: k.red })),
      icon: { cx: r.icon.cx / W, cy: r.icon.cy / H, d: r.icon.d / W, luma: r.iconLuma },
    });
  }
  return grid;
}
