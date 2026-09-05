// 위수 협의 화면 인식 — 맹약 원형의 **중첩 수**를 읽는다 (2026-09-06).
// (순수 계산 코어. React·DOM 무의존 — 브라우저와 verify-lens 하네스가 같은 함수를 쓴다)
//
// 왜 (사용자 요청 2026-09-06 "한판 하면서 필요한 정보들을 유지하게"):
// 한 판 도는 동안 중첩 수는 매 라운드 바뀌는데, 편성 계산기(autochess-board.ts)는 중첩을
// **자동 합산하지 않는다** — 중첩을 올리는 특질 130개 중 72개가 대상이 동적이라 절반 빠진
// 합계를 확정값처럼 보일 수 없기 때문이다. 그래서 지금까지 사람이 손으로 넣어야 했다.
// 화면에는 정답이 이미 찍혀 있으므로, 거기서 읽어 그 수동 입력을 없앤다.
//
// ⚠ 원 안의 숫자는 **중첩 수**다 (실측 2026-09-06): 빅토리아가 툴팁 `중첩 수 0`·`👥 1/3`인데
//   원에는 0, 사르곤은 2였다. 인원수였다면 빅토리아가 1로 찍혔어야 한다.
//
// 화면 배치 (KR 클라 실측):
//   ( 아이콘 + 숫자 )   ← 발광 링 안에 흰 숫자
//        맹약 이름       ← 링 바로 아래
// 그래서 **이름 줄을 먼저 찾고 그 위를 읽는다.** 이름은 23개가 전부 다른 단어라 매칭이 튼튼하고,
// 위치를 OCR이 알려주므로 화면 해상도·UI 배율에 안 묶인다.

import type { OcrBox, OcrRect } from "./ocr";
import type { Normalizer } from "./match";

/** 맹약 이름 색인 — id ↔ 정규화된 이름. 로케일별로 doc.bonds[].n 을 넣는다. */
export type AcIndex = { bonds: { id: string; n: string }[] };

export function buildAcIndex(bonds: { id: string; n: string }[], norm: Normalizer): AcIndex {
  // ⚠ 한 글자 이름을 버리지 않는다 — JA 클라의 염국이 `炎` 한 글자다. 짧은 이름은
  //   아래 bondOfLine 이 **완전 일치로만** 받으므로(오독 보정은 3자 이상) 오탐이 안 는다.
  return {
    bonds: bonds
      .map((b) => ({ id: b.id, n: norm(b.n) }))
      .filter((b) => b.n.length >= 1),
  };
}

// ── 이름 줄 ↔ 맹약 ──────────────────────────────────────────────────────────
// ⚠ **부분 일치를 쓰지 않는다.** 23개 중 `조력`↔`조화`, `기민`↔`기습`, `정밀`↔`불굴`처럼
//   두 글자짜리가 많아 substring 매칭은 서로를 삼킨다. 완전 일치(정규화 후)와,
//   한 글자 차이(레벤슈타인 1)까지만 OCR 오독 보정으로 허용한다.
const MAX_EDITS = 1;

function editsWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;
  // 길이가 짧아(2~5자) 전체 DP가 더 싸다
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;      // 이 행 전체가 이미 초과 — 조기 종료
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length] <= max;
}

/** 이 줄이 어느 맹약 이름인가 — 아니면 null. 두 글자 이름은 오독 보정을 끈다(서로 1자 차이라). */
export function bondOfLine(textN: string, idx: AcIndex): string | null {
  if (!textN) return null;
  let exact: string | null = null;
  let near: string | null = null;
  let nearCount = 0;
  for (const b of idx.bonds) {
    if (b.n === textN) { if (exact) return null; exact = b.id; continue; }
    if (b.n.length >= 3 && textN.length >= 3 && editsWithin(b.n, textN, MAX_EDITS)) {
      near = b.id; nearCount++;
    }
  }
  if (exact) return exact;
  return nearCount === 1 ? near : null;     // 후보가 둘 이상이면 포기 (오배정보다 미검출이 낫다)
}

// ── 숫자 자리 찾기 ──────────────────────────────────────────────────────────
/** 이름 줄 위쪽에서 숫자 후보 상자를 고른다 — 가로로 겹치고, 바로 위에 있으며, 가장 가까운 것. */
function numBoxAbove(label: OcrBox, boxes: OcrBox[]): OcrBox | null {
  const lh = label.y1 - label.y0;
  if (lh <= 0) return null;
  const cx = (label.x0 + label.x1) / 2;
  let best: OcrBox | null = null;
  let bestGap = Infinity;
  for (const b of boxes) {
    if (b === label) continue;
    if (b.y1 > label.y0) continue;                       // 이름보다 아래 — 다른 줄
    const gap = label.y0 - b.y1;
    if (gap > lh * 4) continue;                          // 너무 멀다 (윗 섹션의 글자)
    if (cx < b.x0 - lh || cx > b.x1 + lh) continue;      // 가로로 안 겹친다 — 옆 맹약의 것
    if (gap < bestGap) { bestGap = gap; best = b; }
  }
  return best;
}

/** 이름 줄만 있을 때의 폴백 크롭 — 링 안쪽을 넉넉히 잡는다.
 *  ⚠ 실측 스샷(2026-09-06) 기준 캘리브레이션이다. 원이 이름 위 약 2.6줄 높이에 있고
 *  지름이 약 3줄 높이였다. 링(발광 테두리)은 isolateGlyphs 가 테두리 성분으로 걷어낸다. */
function fallbackRect(label: OcrBox): OcrRect {
  const lh = label.y1 - label.y0;
  const cx = (label.x0 + label.x1) / 2;
  const half = lh * 0.85;                    // 링 안쪽만 — 넓히면 아이콘 글리프가 섞인다
  return { x: cx - half, y: label.y0 - lh * 3.3, w: half * 2, h: lh * 2.1 };
}

/** 숫자 상자를 조금 넓혀 크롭 rect 로 — 이진화가 글리프 가장자리를 먹지 않게 여유를 준다. */
function padRect(b: OcrBox): OcrRect {
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const px = Math.max(w * 0.35, h * 0.2), py = h * 0.25;
  return { x: b.x0 - px, y: b.y0 - py, w: w + px * 2, h: h + py * 2 };
}

/** OCR 텍스트 → 중첩 수. 0~999 밖은 오독으로 보고 버린다. */
export function parseStack(text: string, conf: number): number | null {
  if (conf < 35) return null;
  const m = (text || "").replace(/\s/g, "").match(/\d{1,3}/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return n >= 0 && n <= 999 ? n : null;
}

export type AcStackPlan = { id: string; rect: OcrRect; from: "box" | "guess" }[];

/** 1단계 — 어느 맹약이 화면에 있고, 그 숫자를 어디서 읽어야 하는지 계획을 세운다.
 *  (숫자 OCR 은 비동기라 호출 측이 돌린다 — 이 함수는 순수 계산으로 남는다) */
export function planAcStacks(boxes: OcrBox[], idx: AcIndex, norm: Normalizer, max = 8): AcStackPlan {
  const plan: AcStackPlan = [];
  const seen = new Set<string>();
  for (const b of boxes) {
    const id = bondOfLine(norm(b.text), idx);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const num = numBoxAbove(b, boxes);
    plan.push({ id, rect: num ? padRect(num) : fallbackRect(b), from: num ? "box" : "guess" });
    if (plan.length >= max) break;
  }
  return plan;
}

// ── 배치 가능 인원 (n/8 · n/9) ──────────────────────────────────────────────
// **분모가 9면 인사부 파일을 쓴 것**이다 (사용자 확정 2026-09-06) — 9번째 배치 칸이 열린다.
// ⚠ 정규화가 '/'를 지우므로 **원시 라인**에서 읽는다 (run.ts parseHud 와 같은 이유).
// 화면의 다른 분수(HP·라운드 등)와 섞이지 않게 **분모 8·9만** 받고, 분자는 그 이하만.
const FRACTION = /(\d{1,2})\s*[/／]\s*(\d{1,2})/g;

export function parseDeploy(rawLines: string[]): { cur: number; max: number } | null {
  let best: { cur: number; max: number } | null = null;
  for (const l of rawLines) {
    FRACTION.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FRACTION.exec(l))) {
      const cur = parseInt(m[1], 10), max = parseInt(m[2], 10);
      if ((max !== 8 && max !== 9) || cur > max) continue;
      // 9가 보이면 9를 택한다 — 인사부 파일은 한 번 쓰면 그 판 내내 유효하고,
      // 같은 화면에 8이 다른 뜻으로 섞여 있어도 9쪽이 정보량이 크다.
      if (!best || max > best.max) best = { cur, max };
    }
  }
  return best;
}

// ── 독립 / 멀티 ─────────────────────────────────────────────────────────────
// '전략 정보(2/2)' 화면 왼쪽에 참가자 카드가 늘어선다 — **한 명이면 독립, 여럿이면 멀티**
// (사용자 확정 2026-09-06). 카드에는 언제나 `<닉네임> #1234` 꼴의 번호가 붙는다.
//
// ⚠ 화면 제목("전략 정보")으로 게이트하지 않는다 — 로케일마다 문구가 다르고 EN/JA 클라의
//   실제 표기를 확인하지 못했다. 대신 **번호 패턴 자체**로 센다: 3자리 이상 숫자 앞의 #는
//   다른 화면에 나오지 않는다. 로케일을 안 타는 게 이 방식의 장점이다.
// ⚠ 정규화가 '#'을 지우므로 **원시 라인**에서 읽는다.
const SEAT_ID = /#\s?(\d{3,})/g;

export function parseSeats(rawLines: string[]): number {
  const ids = new Set<string>();
  for (const l of rawLines) {
    SEAT_ID.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SEAT_ID.exec(l))) ids.add(m[1]);
  }
  return ids.size;
}

// ── 새 판 신호 ──────────────────────────────────────────────────────────────
// '시뮬레이션 정보' 화면 = 판의 시작. 이걸 보면 지난 판 값을 버린다.
// 로케일별 클라 문구 (KR/EN/JA) — 정규화 후 부분 일치로 본다 (제목 줄이 통째로 잡히므로).
const INFO_WORDS = ["시뮬레이션정보", "simulationinfo", "シミュレーション情報"];
const CORE_WORDS = ["핵심맹약", "corealliances", "コア盟約"];

export function isAcInfoScreen(linesN: string[]): boolean {
  const all = linesN.join("");
  return INFO_WORDS.some((w) => all.includes(w)) || CORE_WORDS.some((w) => all.includes(w));
}
