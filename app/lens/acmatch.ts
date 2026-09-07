// 위수 협의 화면 인식 — 텍스트 파서·맹약 링 (순수 계산 코어. React·DOM 무의존 —
// 브라우저(run.ts)와 scripts/verify-ac/text.ts 하네스가 같은 함수를 쓴다).
//
// 2026-09-07 재가동: fixtures/lens/ac-frames v1(36장)·v2(81장)을 **900px 브리지 판**(bridge.ts 가
// 실제로 인식기에 넘기는 크기)으로 전 프레임 실측해 방법을 확정하고 옮겼다. 수치는 각 함수 위에.
// 버린 것과 이유:
//   · planAcStacks / numBoxAbove / fallbackRect / parseStack — "이름 줄을 먼저 찾고 그 위를 읽는다"는
//     전제가 900px 에서 깨졌다: 링 있는 21프레임 중 이름 줄은 6프레임만 잡히고(신속 0) 숫자는 0/13.
//     PSM11 이 링 안 아이콘을 글자 줄로 내서 numBoxAbove 가 아이콘을 숫자 상자로 집었고, fallbackRect
//     는 이 UI 배율에서 링 전체를 잡았다. 상점 카드의 맹약 라벨('에기르', y≈0.92)이 bondOfLine 에
//     걸려 5프레임 오탐도 냈다. → findAcRings(원둘레 밝기 차)로 **링을 먼저** 찾고(20/21, 오탐 0)
//     ringNameRect / ringNumRect 로 자리를 잡는다.
//   · parseDeploy(n/8 분수) — 실제 화면은 '배치 가능 인원:8' 콜론 형식이라 0/32. → parseDeployLeft.
//
// ⚠ 원 안의 숫자는 **중첩 수**다 (실측 2026-09-06): 빅토리아가 툴팁 `중첩 수 0`·`👥 1/3`인데
//   원에는 0, 사르곤은 2였다. 인원수였다면 빅토리아가 1로 찍혔어야 한다.

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

/** 이 줄이 어느 맹약 이름인가 — 아니면 null. 두 글자 이름은 오독 보정을 끈다(서로 1자 차이라).
 *  ⚠ 인게임에서는 **상단 띠(링 아래, y<0.25) 밖에 쓰지 말 것** — 상점 카드의 맹약 라벨(y≈0.92)이
 *    그대로 걸린다 (실측 '에기르' 5프레임 오탐). 링 이름은 ringNameRect 크롭에만 적용한다. */
export function bondOfLine(textN: string, idx: AcIndex): string | null {
  // ⚠ **숫자를 떼고 본다.** 정규화는 숫자를 남기는데(normText), 맹약 이름엔 숫자가 없고
  //   OCR 은 배경 무늬를 숫자로 자주 붙인다 (실측: "아케인11", "정밀."). 떼면 그대로 맞는다.
  textN = textN.replace(/[0-9]/g, "");
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

// ── 맹약 링 (인게임 상단 띠) ────────────────────────────────────────────────
// 화면 배치 (KR 클라 실측, 900px 판 v2 f076):
//   ( 아이콘 + 숫자 )   ← 발광 링(지름 ≈34px = 0.066H) 안에 흰 숫자, 링 바닥 안쪽 y≈cy+5..+16
//        맹약 이름       ← 링 바로 아래 y≈cy+18..+31, 링 간격 ≈56px(0.062W), 중심 y≈0.13H
// 링은 **원둘레 밝기 차**로 찾는다: 반지름 r 원둘레 24점 평균 휘도 − 반지름 r+5 원둘레 평균 휘도.
// 발광 테두리는 밝고 바로 바깥은 어두운 HUD 배경이라 차가 크다 (실측 s=68~97, 문턱 25).
// 결과(2026-09-07, v2 f054~081 중 링 구간 21프레임): 링 개수 일치 20/21 (f059 미검출), 링 없는
// 8프레임 오탐 0, 원본 해상도 6/6. 이 계수들은 900px 판(H≈513) 기준이라 u=H/513 로 배율을 맞춘다.

/** 검출된 링 — cx·cy·r 은 0~1 정규화(cx 는 W, cy·r 은 H 기준). ux·uy 는 900px 판 픽셀 단위
 *  u=H/513 을 각각 W·H 로 정규화한 것 — 링 주변 크롭(ringNameRect 등)이 이걸로 픽셀 상수를 옮긴다. */
export type AcRing = { cx: number; cy: number; r: number; ux: number; uy: number; score: number };

const RING_R = 0.033;                 // 반지름 / H
const RING_BAND = { x0: 0.28, x1: 0.72, y0: 0.10, y1: 0.16 } as const;   // 링 중심이 있을 수 있는 띠
const RING_PTS = 24;
const RING_SCORE_MIN = 25;            // 둘레 밝기 차 문턱 (실측 진짜 링 68~97)
const RING_LIT_MIN = 18;              // 24점 중 휘도>70 인 점 최소 수 — 어두운 배경의 우연한 밝기 차 배제
const RING_MAX = 8;                   // 한 화면에 맹약 원형은 최대 8개

/** 인게임 상단 띠에서 맹약 링을 찾는다 — **원색 RGBA**(브리지 JPEG 디코드 그대로, grayNormalize 전)
 *  를 넣는다. 좌→우 정렬. 링이 없는 화면(정보·전략·로딩 등)에서는 빈 배열 (실측 오탐 0). */
export function findAcRings(px: Uint8ClampedArray | Uint8Array, W: number, H: number): AcRing[] {
  const r = Math.round(H * RING_R);
  if (r < 4) return [];
  const uPx = Math.max(1, Math.round(H / 513));
  const ro = r + 5 * uPx;
  const lum = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    const i = (y * W + x) * 4;
    return (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  };
  const inner: [number, number][] = [], outer: [number, number][] = [];
  for (let k = 0; k < RING_PTS; k++) {
    const a = (k / RING_PTS) * Math.PI * 2;
    inner.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]);
    outer.push([Math.round(Math.cos(a) * ro), Math.round(Math.sin(a) * ro)]);
  }
  const cand: { cx: number; cy: number; score: number }[] = [];
  const cy0 = Math.round(H * RING_BAND.y0), cy1 = Math.round(H * RING_BAND.y1);
  const cx0 = Math.round(W * RING_BAND.x0), cx1 = Math.round(W * RING_BAND.x1);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      let a = 0, b = 0, lit = 0;
      for (let k = 0; k < RING_PTS; k++) {
        const v = lum(cx + inner[k][0], cy + inner[k][1]);
        a += v;
        if (v > 70) lit++;
        b += lum(cx + outer[k][0], cy + outer[k][1]);
      }
      const score = (a - b) / RING_PTS;
      if (score > RING_SCORE_MIN && lit >= RING_LIT_MIN) cand.push({ cx, cy, score });
    }
  }
  cand.sort((p, q) => q.score - p.score);
  const kept: { cx: number; cy: number; score: number }[] = [];
  for (const c of cand) {                       // NMS — 같은 링의 이웃 픽셀 후보를 접는다
    if (kept.every((o) => Math.hypot(o.cx - c.cx, o.cy - c.cy) > r * 1.5)) kept.push(c);
    if (kept.length >= RING_MAX) break;
  }
  kept.sort((p, q) => p.cx - q.cx);
  const u = H / 513;
  return kept.map((c) => ({ cx: c.cx / W, cy: c.cy / H, r: r / H, ux: u / W, uy: u / H, score: c.score }));
}

/** 링 아래 맹약 이름 자리 — {cx−24u, cy+18u, 48u, 13u} (900px 판 px). session.cropInverted 로 읽어
 *  norm → bondOfLine. 실측(2026-09-07) 그레이 반전+4배+**검은** 패딩→kor PSM7 34/35 (이진화 crop 은 10/35,
 *  흰 패딩은 19/33 — 패딩 색이 결과를 가른다). */
export function ringNameRect(ring: AcRing): OcrRect {
  return { x: ring.cx - 24 * ring.ux, y: ring.cy + 18 * ring.uy, w: 48 * ring.ux, h: 13 * ring.uy };
}

/** 링 안 중첩 숫자 자리 — {cx−7u, cy+5u, 14u, 12u}. session.digits(rect, RING_DIGITS) 로 읽고
 *  parseRingStack 에 넣는다. ⚠ 약하다 — 아래 parseRingStack 주석 참조. */
export function ringNumRect(ring: AcRing): OcrRect {
  return { x: ring.cx - 7 * ring.ux, y: ring.cy + 5 * ring.uy, w: 14 * ring.ux, h: 12 * ring.uy };
}

/** 링 숫자용 digits() 옵션 — **isolateGlyphs 를 끈다**: 숫자 글리프가 링 테두리에 닿아 있어
 *  기본 digits() 는 글리프를 테두리 성분으로 지워 0/35 였다. 이진화 문턱도 0.6 (실측 최선). */
export const RING_DIGITS = { cut: 0.6, isolate: false } as const;

/** 링 숫자 OCR 텍스트 → 중첩 수. eng LSTM 이 **단독 0 을 O/o/Q/C/()/D 로 낸다**(실측: 링 전부 0 인데
 *  '0' 으로 읽은 건 0/35, 'oO'·'O'·'Oo' 꼴이 10/35 — 링 3개 프레임 11장만 보면 7/33, 나머지는 'Yn'·'np'·'}' 같은
 *  글자). 그래서 O 계열만으로 이뤄진 문자열을 0 으로 본다. 그 외 글자가 섞이면 null (짐작하지 않는다).
 *  ⚠ 약하다 — 셋에 둘은 못 읽는다. 값을 UI 에 확정 표시하지 말고, 여러 프레임에 걸쳐 같은 값이 반복될 때만 쓸 것.
 *    글리프 자체는 크롭에서 선명하므로(10px 흰 숫자) 숫자 템플릿 ZNCC 매칭이 다음 후보다.
 *  ⚠ **1 이상 값은 미검증** — 녹화가 라운드 1(전부 0)뿐이라 표본이 없다. 다음 라운드 녹화가 들어오면
 *    scripts/verify-ac/text.ts 의 링 숫자 검사에 정답을 채워 바로 검증할 것. */
export function parseRingStack(text: string): number | null {
  const t = (text || "").replace(/\s/g, "");
  if (!t || !/^[0-9OoQCcD()]+$/.test(t)) return null;
  const n = parseInt(t.replace(/[OoQCcD()]/g, "0"), 10);
  return Number.isFinite(n) && n >= 0 && n <= 999 ? n : null;
}


// ── 배치 가능 인원 ──────────────────────────────────────────────────────────
// 휴식 화면 우하단 '배치 가능 인원:8' — **남은** 배치 칸이다 (실측 2026-09-07 v2: 기물을 살수록
// 8→7→6). 9 가 보이면 인사부 파일(9번째 칸)을 쓴 것 (사용자 확정 2026-09-06).
// ⚠ 옛 parseDeploy 는 'n/8' 분수를 찾았는데 실제 화면은 콜론 형식이라 0/32 였다.
// '배치가능' 까지 요구하면 14/19 — OCR 이 앞부분을 자주 흘린다('인원:8' 만 남음). '인원' 만 앵커로
// 잡으면 17/19 (f055·f068 은 숫자 자체가 안 읽힘). 정규화가 ':' 를 지우므로 **원시 줄**에서 읽는다.
// 전투 중엔 이 HUD 가 없어 null — 호출 측이 마지막 값을 유지한다.
const DEPLOY_LEFT = /인\s*원\s*[:：;.]?\s*(\d{1,2})\b/;

export function parseDeployLeft(rawLines: string[]): number | null {
  for (const l of rawLines) {
    const m = DEPLOY_LEFT.exec(l);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n >= 0 && n <= 9) return n;          // 두 자리는 오독 (배치 칸은 최대 9)
  }
  return null;
}

// ── 인게임 HUD (상단 띠) ────────────────────────────────────────────────────
// 줄 **상자 위치**로 가른다 — 같은 숫자가 코인·라운드·HP 로 여럿 보이기 때문.
// 실측(900px 판, v2 f054~081 28프레임):
//   목표 HP 23 : x0∈(0.55,0.70)·y0<0.09 줄의 끝 숫자 24/28 ('늘 23'·'들 23' 꼴 — 앞 글리프는 아이콘)
//   처치 a/b   : x0∈(0.42,0.56)·y0<0.09 — 슬래시가 자주 빠져 '솔 04' 로 읽힌다(5/7). '1/4'→'144'
//                오독, '전투 시작'→'00' 오탐이 있어 **정보용**으로만 (계산기 입력에 쓰지 말 것).
//   라운드     : 흰 상자 안 어두운 8px 숫자라 900px 에서 0/28 — 읽지 않는다. 화면 전환으로 셀 것.
export function parseAcHud(boxes: OcrBox[]): { hp: number | null; kills: [number, number] | null } {
  let hp: number | null = null;
  let kills: [number, number] | null = null;
  for (const b of boxes) {
    if (b.y0 >= 0.09) continue;
    if (hp === null && b.x0 > 0.55 && b.x0 < 0.70) {
      const m = /(\d{1,3})\s*$/.exec(b.text);
      if (m) { const v = parseInt(m[1], 10); if (v >= 1 && v <= 99) hp = v; }
    }
    if (kills === null && b.x0 > 0.42 && b.x0 < 0.56) {
      const m = /(\d)\s*[/／]?\s*(\d)\s*$/.exec(b.text);
      if (m) {
        const a = parseInt(m[1], 10), t = parseInt(m[2], 10);
        if (t >= 1 && a <= t) kills = [a, t];   // '00'(전투 시작 문구 오탐) 은 분모 0 이라 걸러진다
      }
    }
  }
  return { hp, kills };
}

// ── 시뮬레이션 종류 ─────────────────────────────────────────────────────────
// 'AC-4' 코드와 'OPERATION' 은 kor 모델이 못 낸다("&(>-4", 0/11 — 원본 해상도도 동일) → 한글 모드
// 이름만 쓴다. '시뮬레이션' 은 '시물레이션·시울레이션·시율레이션' 으로 자주 오독되므로 앵커는
// 모드 이름 + '시' 까지만 (실측: 배지 46/51 → 51/51).
// 실측(2026-09-07): 로딩 화면 큰 글씨 11/11 (PSM11 줄) · 정보/전략 화면 좌상단 붉은 배지는 PSM11 로는
// 0/51 이고 badgeRectFromTitle 자리를 session.maxCrop(채널최댓값) 으로 읽어야 51/51.
// ⚠ **정보·전략 화면의 PSM11 줄에는 쓰지 말 것** — 잠긴 전략의 개방 조건 "[표준 시뮬레이션]에서
//   9라운드 클리어 시 개방" 이 보이면 표준(AC-1)으로 오판한다. 그 화면들은 배지 크롭 결과에만 쓴다.
// EN/JA 는 실제 화면이 없어 **미검증** — autochess.en/ja.json modes[].n 을 정규화한 형태로 갈음.
//   EN: Standard/Perilous/Dire/Ultimate Simulation · Entry Protocol (normTextEn: 소문자·공백 제거)
//   JA: 標準/逆境/死地/究極 (데이터는 이 두 글자뿐이라 뒤에 'シミュ' 를 요구해 본문 오탐을 막는다) · 指導協定
const MODE_WORDS: [RegExp, string][] = [
  [/(극한|초월|표준|험지)\s*시/, ""],          // 그룹으로 가른다 (아래 KR_MODE)
  [/입문협의/, "AC-TR-1"],
  [/standardsimulation/, "AC-1"], [/periloussimulation/, "AC-2"],
  [/diresimulation/, "AC-3"], [/ultimatesimulation/, "AC-4"], [/entryprotocol/, "AC-TR-1"],
  [/標準シミュ/, "AC-1"], [/逆境シミュ/, "AC-2"], [/死地シミュ/, "AC-3"], [/究極シミュ/, "AC-4"], [/指導協定/, "AC-TR-1"],
];
const KR_MODE: Record<string, string> = { "표준": "AC-1", "험지": "AC-2", "극한": "AC-3", "초월": "AC-4" };

/** 정규화된 줄들에서 모드 코드 — "AC-1"|"AC-2"|"AC-3"|"AC-4"|"AC-TR-1". 서로 다른 모드가 함께
 *  보이면 null (선택 화면은 카드 두 장의 글씨가 다 읽혀 어느 쪽이 선택됐는지 텍스트로는 못 가른다 —
 *  모드는 로딩 화면이나 배지에서 잡는 게 맞다). */
export function parseAcMode(linesN: string[]): string | null {
  let found: string | null = null;
  for (const l of linesN) {
    for (const [re, code] of MODE_WORDS) {
      const m = re.exec(l);
      if (!m) continue;
      const c = code || KR_MODE[m[1]];
      if (!c) continue;
      if (found && found !== c) return null;
      found = c;
    }
  }
  return found;
}

/** 정보/전략 화면 좌상단 붉은 배지 자리 — 제목 줄('1/2 시뮬레이션 정보'·'2/2 전략 정보') 상자의
 *  **왼쪽, 같은 높이**. 해상도·창틀에 안 묶이게 제목 상자에서 파생한다 (실측: 제목 줄 51/51 검출,
 *  rect 예 (0.06,0.037,0.31,0.072)). 제목이 안 보이면 null. session.maxCrop 으로 읽는다 —
 *  붉은 글씨는 R 만 높아 휘도 그레이(crop)에선 배경과 뭉개진다(4/51), 채널최댓값이면 51/51. */
export function badgeRectFromTitle(boxes: OcrBox[]): OcrRect | null {
  const top = boxes.filter((b) => b.y0 < 0.2 && b.x1 > b.x0 && b.y1 > b.y0);
  const title = top.find((b) => /시뮬레이션\s*정보|전략\s*정보/.test(b.text))
    ?? top.filter((b) => /\/\s*2/.test(b.text)).sort((a, b) => a.x0 - b.x0)[0];
  if (!title) return null;
  const lh = title.y1 - title.y0;
  const w = title.x0 - 0.07;
  if (w < 0.05 || lh <= 0) return null;         // 제목이 너무 왼쪽 — 배지가 들어갈 자리가 없다
  return { x: 0.06, y: title.y0 - lh * 0.35, w, h: lh * 1.7 };
}

// ── 전략 (밴드) ─────────────────────────────────────────────────────────────
// 전략 화면 우측 패널에 대표 오퍼레이터 이름(bands[].by)이 큰 글씨로 뜬다 — 정규화 완전일치 7/7 (97%).
// 탐색 중('전략 선택' 만 보임)에도 우측 패널이 있으면 잡히고, 확정('선택한 전략'·'전략 선택 완료')
// 화면과 팝업에서도 같은 줄이 있다. 탐색/확정 문구 분리는 9/9.
// ⚠ by 가 1~2자인 전략('리·위·시·첸·팽·페페·캔낫')은 **안 잡는다** — 다른 화면 오탐 18건. 3자 이상은
//   전 117프레임에서 오탐 0. 보조로 설명 첫 줄의 '[사모펀드]' 대괄호를 bands[].n 과 맞춘다 (5/7).
// EN/JA 확정 문구는 실제 화면이 없어 **미구현** — final 은 KR 문구로만 선다.
const BAND_FINAL_WORDS = ["선택한전략", "전략선택완료"];

export function parseAcBand(rawLines: string[], bands: { id: string; n: string; by?: string }[],
  norm: Normalizer): { band: string; final: boolean } | null {
  const linesN = rawLines.map(norm);
  const all = linesN.join("");
  const final = BAND_FINAL_WORDS.some((w) => all.includes(w));
  const byIdx = bands.map((b) => ({ id: b.id, by: norm(b.by) })).filter((b) => b.by.length >= 3);
  let hit: string | null = null;
  for (const l of linesN) {
    for (const b of byIdx) {
      if (l !== b.by) continue;
      if (hit && hit !== b.id) return null;      // 서로 다른 전략 둘 — 짐작하지 않는다
      hit = b.id;
    }
  }
  if (!hit) {
    const nIdx = bands.map((b) => ({ id: b.id, n: norm(b.n) })).filter((b) => b.n.length >= 2);
    for (const raw of rawLines) {
      const m = /\[([^\]]{2,12})\]/.exec(raw);
      if (!m) continue;
      const k = norm(m[1]);
      const b = nIdx.find((x) => x.n === k);
      if (b) { hit = b.id; break; }
    }
  }
  return hit ? { band: hit, final } : null;
}

// ── 기물·장비 이름 (상점 카드·툴팁) ─────────────────────────────────────────
// 인게임에서 chess[].n / equips[].n 정규화 완전일치 — 언더플로우 11/13, 리스캄 3/3, 인사이더, 기사 저금통
// (툴팁 93~97%). 장비 카드는 아이콘 글리프가 이름 앞에 붙어('츄 빅토리아 해머') 완전일치 1/13 →
// 길이 ≥4 에 한해 편집거리 1 또는 선행 1자 제거를 허용하면 9/13.
// ⚠ 인게임 게이트(classifyAcScreen === 'rest') 안에서만 쓸 것 — 밖에선 '페페'(v2 f009)·전략 설명문의
//   '<기사 저금통>' 이 걸린다. 정비구역 확정 근거로는 상점 카드보다 툴팁 이름이 믿을 만하다.
export type PieceIndex = { items: { id: string; n: string; kind: "chess" | "equip" }[] };

export function buildPieceNameIndex(chess: { id: string; n: string }[], equips: { id: string; n: string }[],
  norm: Normalizer): PieceIndex {
  const items: PieceIndex["items"] = [];
  for (const c of chess) { const n = norm(c.n); if (n.length >= 2) items.push({ id: c.id, n, kind: "chess" }); }
  for (const e of equips) { const n = norm(e.n); if (n.length >= 2) items.push({ id: e.id, n, kind: "equip" }); }
  return { items };
}

export function matchPieceName(line: string, idx: PieceIndex, norm: Normalizer):
  { id: string; kind: "chess" | "equip" } | null {
  // 선행 숫자는 뗀다 — 카드 위 가격·수량이 이름 줄에 붙어 읽힌다. 이름은 숫자로 시작하지 않는다(데이터 확인).
  const n = norm(line).replace(/^[0-9]+/, "");
  if (n.length < 2) return null;
  const exact = idx.items.find((i) => i.n === n);
  if (exact) return { id: exact.id, kind: exact.kind };
  if (n.length < 4) return null;                // 짧은 이름은 완전일치만 ('굼'·'시'·'위' 같은 1~2자 기물)
  const tail = n.slice(1);
  const dropped = idx.items.find((i) => i.n === tail);
  if (dropped) return { id: dropped.id, kind: dropped.kind };
  let near: PieceIndex["items"][number] | null = null;
  const names = new Set<string>();
  for (const i of idx.items) {
    if (i.n.length >= 4 && editsWithin(i.n, n, MAX_EDITS)) { names.add(i.n); near = i; }
  }
  return names.size === 1 && near ? { id: near.id, kind: near.kind } : null;   // 후보 둘이면 포기
}

// ── 독립 / 연합 ─────────────────────────────────────────────────────────────
// '전략 정보(2/2)' 화면 왼쪽에 참가자 카드가 늘어선다 — **한 명이면 독립, 여럿이면 연합**
// (사용자 확정 2026-09-06). 카드에는 언제나 `<닉네임> #1234` 꼴의 번호가 붙는다.
//
// ⚠ 900px 판에서는 '#' 이 '1' 로 읽혀('테라아카이브 12786') 0/9 — 원본 해상도도 1/6. 탐색 중엔
//   '선택 중' 패널이 번호를 가린다. 다인 녹화도 없어 검증 불가 → UI 는 독립/연합을 사용자 입력으로
//   두는 게 안전하다. 함수는 남겨 두되 값을 믿지 말 것 (2026-09-07 실측).
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

// ── 화면 종류 ───────────────────────────────────────────────────────────────
// '시뮬레이션 정보' 화면 = 판의 시작. 이걸 보면 지난 판 값을 버린다.
// 로케일별 클라 문구 (KR/EN/JA) — 정규화 후 부분 일치로 본다 (제목 줄이 통째로 잡히므로).
const INFO_WORDS = ["시뮬레이션정보", "simulationinfo", "シミュレーション情報"];
const CORE_WORDS = ["핵심맹약", "corealliances", "コア盟約"];

/** 정보 화면(1/2 시뮬레이션 정보 — 상단·밴 목록 모두)인가. 실측 117/117 (참 42, 거짓 75). */
export function isAcInfoScreen(linesN: string[]): boolean {
  const all = linesN.join("");
  return INFO_WORDS.some((w) => all.includes(w)) || CORE_WORDS.some((w) => all.includes(w));
}

/** 한 판의 화면 흐름: select(시뮬레이션 선택) → info(시뮬레이션 정보 — 배지에서 모드를 읽는다) →
 *  band(전략 탐색) → confirm(전략 확정) → loading(로딩 — 모드 큰 글씨) → rest(휴식 — 링·상점) ⇄ battle(전투 — 링만) */
export type AcScreen = "select" | "info" | "band" | "confirm" | "loading" | "rest" | "battle";

const SELECT_WORDS = ["시뮬레이션선택"];
const BAND_WORDS = ["전략정보"];
const LOADING_HINT = /맵위의특수한|operation|loading/i;
const REST_WORDS = /배치가능인원|휴식기간|접기/;
const BATTLE_START = /전투시[작자]/;             // '전투 시작' — '시자' 오독 흡수 (v2 f075)

/** 화면 종류 판정 — 문구(정규화 줄·원시 줄)와, 있으면 줄 상자(HUD 위치)로 가른다. 모르면 null
 *  (메인·협의 가동·검은 화면·전환 프레임). 실측(2026-09-07, 117프레임)은 scripts/verify-ac/text.ts (e).
 *  ⚠ 순서가 규칙이다: 전략 화면의 설명문에 '휴식 기간' 이 나오므로 band/confirm 을 rest 보다 먼저 본다.
 *  ⚠ 로딩은 모드 큰 글씨 + (힌트 문구 | 줄 수 ≤8) — 힌트 '맵 위의 특수한…' 은 11장 중 8장에만 읽혔고
 *    (f047~049 는 줄 3개), 로딩 화면은 원래 텅 비어 있어 줄 수 자체가 신호다.
 *  ⚠ EN/JA 문구(select·band·confirm·rest·battle)는 실제 화면이 없어 **미구현** — info 만 기존 사전. */
export function classifyAcScreen(linesN: string[], raw: string[], boxes?: OcrBox[]): AcScreen | null {
  const all = linesN.join("");
  if (isAcInfoScreen(linesN)) return "info";
  if (SELECT_WORDS.some((w) => all.includes(w))) return "select";
  const finalWord = BAND_FINAL_WORDS.some((w) => all.includes(w));
  if (BAND_WORDS.some((w) => all.includes(w))) return finalWord ? "confirm" : "band";
  if (finalWord) return "confirm";                // 확정 팝업(v2 f028)엔 제목이 가려도 '선택한 전략' 이 있다
  const mode = parseAcMode(linesN);
  if (mode && (LOADING_HINT.test(all) || raw.length <= 8)) return "loading";
  if (REST_WORDS.test(all) || parseDeployLeft(raw) !== null) return "rest";
  const hud = boxes ? parseAcHud(boxes) : null;
  if ((hud && hud.kills) || BATTLE_START.test(all)
    || raw.some((l) => /(?:^|\s)\d\s*[/／]\s*\d\s*$/.test(l))) return "battle";
  return null;
}
