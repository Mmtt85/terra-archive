// 오퍼 스캐너 — 순수 컴퓨터비전 코어 (React·DOM 무의존, 워커/Node 하네스에서 구동).
// 파이프라인: 자동 격자 → 별 앵커 성급 → 인-도메인 직군 글리프 ZNCC.
// 오퍼 식별·정예화는 app/scan/artmatch.ts(카드 아트 ↔ 초상 매칭)가 담당 —
// "카드 아트 = 장착 스킨의 초상 에셋"이라 이미지 매칭이 가능하다(2026-07-23 확정,
// 1차 세션의 '공개 미러에 없음' 판정은 스킨 초상을 빼고 본 오판이었음).
// 회귀 검증: npx tsx scripts/verify-scan.ts (픽스처 192셀 식별·정예화 100% — iPad 4:3 포함).
import TEMPLATES from "./class-templates.json";

export interface Frame {
  data: Uint8ClampedArray; // RGBA
  width: number;
  height: number;
}

export type ClassKey =
  | "vanguard" | "guard" | "defender" | "sniper"
  | "caster" | "medic" | "supporter" | "specialist";

// KR job(operators.json) ↔ 내부 클래스 키
export const JOB_TO_CLASS: Record<string, ClassKey> = {
  뱅가드: "vanguard", 가드: "guard", 디펜더: "defender", 스나이퍼: "sniper",
  캐스터: "caster", 메딕: "medic", 서포터: "supporter", 스페셜리스트: "specialist",
};

export interface Rect { x: number; y: number; w: number; h: number; }

export interface CellDetection {
  row: number;
  col: number;
  cx: number;      // 카드 좌측 경계 근사(별 앵커 기준)
  sx: number;      // 첫 별 x(앵커)
  ry: number;      // 별 리본 중심 y
  rarity: number;  // 1~6
  cls: ClassKey;
  clsConf: number; // ZNCC 상관 (0.8+ 신뢰)
  card: Rect;      // 카드 전체 대략 영역
  nameBox: Rect;   // 이름 띠 (OCR 대상)
  eliteBox: Rect;  // 정예화 배지 대략
}

// ── 템플릿 전처리(zero-mean unit-norm) ───────────────────────────────────────
const TW = (TEMPLATES as { tw: number }).tw;
const TH = (TEMPLATES as { th: number }).th;

interface Tmpl { cls: ClassKey; vec: Float64Array; }
const TMPLS: Tmpl[] = (TEMPLATES as { templates: { cls: ClassKey; data: string }[] }).templates.map((t) => {
  const bin = atob(t.data);
  const raw = new Float64Array(TW * TH);
  for (let i = 0; i < raw.length; i++) raw[i] = bin.charCodeAt(i);
  return { cls: t.cls, vec: zeroMeanUnit(raw) };
});

function zeroMeanUnit(v: Float64Array): Float64Array {
  let m = 0;
  for (let i = 0; i < v.length; i++) m += v[i];
  m /= v.length;
  let n = 0;
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) { const d = v[i] - m; out[i] = d; n += d * d; }
  n = Math.sqrt(n);
  if (n > 1e-6) for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

// ── 픽셀 헬퍼 ────────────────────────────────────────────────────────────────
function isGold(d: Uint8ClampedArray, i: number): boolean {
  const R = d[i], G = d[i + 1], B = d[i + 2];
  return R > 200 && G > 165 && B < 100 && (R - B) > 115 && (R - G) < 80;
}

// 프레임 1회 전처리: 그레이(Float32) + 골드(Uint8)
function preprocess(f: Frame): { L: Float32Array; gold: Uint8Array } {
  const { data, width, height } = f;
  const L = new Float32Array(width * height);
  const gold = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < width * height; p++, i += 4) {
    L[p] = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (isGold(data, i)) gold[p] = 1;
  }
  return { L, gold };
}

// ── 열 격자: 밝기 프로파일 자기상관 ──────────────────────────────────────────
function bestPeriod(prof: Float64Array, lo: number, hi: number): { pitch: number; score: number } {
  let mean = 0;
  for (let i = 0; i < prof.length; i++) mean += prof[i];
  mean /= prof.length;
  const d = new Float64Array(prof.length);
  let varSum = 0;
  for (let i = 0; i < prof.length; i++) { d[i] = prof[i] - mean; varSum += d[i] * d[i]; }
  const scores = new Float64Array(hi + 1);
  let best = 0, bestS = -1;
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = 0; i + lag < d.length; i++) s += d[i] * d[i + lag];
    s /= varSum;
    scores[lag] = s;
    if (s > bestS) { bestS = s; best = lag; }
  }
  // 하모닉 방지: 넓은 탐색 범위(크롭 스샷 재시도)에선 진짜 피치의 2배 자기상관도 비슷하게
  // 높다 — 충분히 작은(≤0.6×) lag 중 0.9·best 이상이 있으면 그쪽(기본 주기)을 채택.
  // 피크 주변(±수 px) 이웃은 0.6× 조건에 걸리지 않으므로 미세 피치가 흔들리지 않는다.
  for (let lag = lo; lag <= Math.floor(best * 0.6); lag++) {
    if (scores[lag] >= bestS * 0.9) { best = lag; bestS = scores[lag]; break; }
  }
  return { pitch: best, score: bestS };
}

// 열 위상 = "가장 밝은" 위상 — 카드 사이 배경 틈(밝은 회색, 콘텐츠 없음)에 앵커한다.
// 이전엔 가장 어두운 위상(카드 내부)을 썼는데, 어두운 지점은 카드 아트 내용에 좌우돼
// 화면비·로스터에 따라 첫 별 뒤로 밀리거나(iPad 4:3 — 2번째 별을 앵커로 오인, 인식 붕괴)
// 별보다 한참 앞(이웃 카드 아트 안)으로 갈 수 있다(2026-07-24). 틈에서 시작하면
// 별 탐색이 처음 만나는 금색이 항상 진짜 첫 별이다.
function gapPhase(prof: Float64Array, pitch: number): number {
  const acc = new Float64Array(pitch), cnt = new Float64Array(pitch);
  for (let i = 0; i < prof.length; i++) { acc[i % pitch] += prof[i]; cnt[i % pitch] += 1; }
  let best = 0, bestV = -Infinity;
  for (let k = 0; k < pitch; k++) { const v = acc[k] / Math.max(cnt[k], 1); if (v > bestV) { bestV = v; best = k; } }
  return best;
}

function detectColumns(L: Float32Array, W: number, H: number, xMax: number, pitchLoFrac: number, pitchHiFrac: number): { cols: number[]; px: number; score: number } {
  const y0 = Math.round(H * 0.30), y1 = Math.round(H * 0.55);
  const colp = new Float64Array(xMax);
  for (let x = 0; x < xMax; x++) {
    let s = 0;
    for (let y = y0; y < y1; y++) s += L[y * W + x];
    colp[x] = s / (y1 - y0);
  }
  const { pitch, score } = bestPeriod(colp, Math.round(W * pitchLoFrac), Math.round(W * pitchHiFrac));
  const gx = gapPhase(colp, pitch);
  const cols: number[] = [];
  for (let x = gx; x < xMax - Math.round(pitch * 0.3); x += pitch) cols.push(x);
  return { cols, px: pitch, score };
}

// ── 행 격자: 성급-독립 (별 리본 = 모든 카드열 최상단의 얇은 골드) ────────────
function detectRows(gold: Uint8Array, W: number, H: number, cols: number[], px: number, rowLoFrac: number): number[] {
  const BAND = 16;
  const ncol = Math.max(1, cols.length);
  // spread(y): [y,y+BAND] × 각 카드열에 골드≥2인 열 수
  const spread = new Float64Array(H);
  for (let y = 0; y < H - BAND; y++) {
    let cnt = 0;
    for (const cx of cols) {
      let g = 0;
      const xe = Math.min(W, cx + px);
      for (let yy = y; yy < y + BAND && g < 2; yy++) {
        const base = yy * W;
        for (let x = cx; x < xe; x++) if (gold[base + x]) { g++; if (g >= 2) break; }
      }
      if (g >= 2) cnt++;
    }
    spread[y] = cnt;
  }
  const goldRow = (y: number): number => { let s = 0; const b = y * W; for (let x = 0; x < W; x++) s += gold[b + x]; return s; };
  const firstRibbon = (lo: number, hi: number): number => {
    const thr = ncol * 0.55;
    let y0 = -1;
    for (let y = lo; y < hi; y++) if (spread[y] >= thr) { y0 = y; break; }
    if (y0 < 0) { // 완화: 최대 spread
      let bv = -1; for (let y = lo; y < hi; y++) if (spread[y] > bv) { bv = spread[y]; y0 = y; }
    }
    // 밴드 내 골드 밀도 최댓을 리본 중심으로
    let by = y0, bv = -1;
    for (let y = y0; y < Math.min(H, y0 + BAND + 6); y++) { const v = goldRow(y); if (v > bv) { bv = v; by = y; } }
    return by + 2;
  };
  const r0 = firstRibbon(Math.max(0, Math.round(H * rowLoFrac)), Math.round(H * 0.48));
  // 2행 리본은 1행에서 카드 피치의 ~2.04배 아래 — E2 카드 하단의 골드 도트 패턴이
  // 넓은 창에서 리본으로 오인되는 것을 막기 위해 px 기반으로 탐색창을 좁힌다(픽스처 f0 회귀).
  const lo1 = Math.min(H - BAND - 1, r0 + Math.round(px * 1.7));
  const hi1 = Math.min(H - BAND, r0 + Math.round(px * 2.35));
  const r1 = firstRibbon(lo1, hi1);
  return [r0, r1].sort((a, b) => a - b);
}

// ── 별 앵커 + 성급 ───────────────────────────────────────────────────────────
// cx(카드 사이 배경 틈)에서 오른쪽으로 처음 만나는 금색 열 = 이 카드의 첫 별.
// 틈은 콘텐츠 없는 배경이라(gapPhase 참고) 이웃 카드 아트의 금색을 밟을 일이 없다.
function leftmostStar(gold: Uint8Array, W: number, cx: number, ry: number, px: number): number | null {
  const xe = cx + Math.min(px, 195);
  for (let x = cx; x < xe; x++) {
    let c = 0;
    for (let y = ry - 13; y < ry + 13; y++) if (gold[y * W + x]) c++;
    if (c >= 3) return x;
  }
  return null;
}

function countStars(gold: Uint8Array, W: number, sx: number, ry: number): number {
  const x0 = sx - 4, x1 = sx + 190;
  const on: boolean[] = [];
  for (let x = x0; x < x1; x++) {
    let c = 0;
    for (let y = ry - 12; y < ry + 12; y++) if (gold[y * W + x]) c++;
    on.push(c >= 3);
  }
  let runs = 0, run = 0;
  for (let i = 0; i <= on.length; i++) {
    if (i < on.length && on[i]) run++;
    else { if (run >= 4) runs++; run = 0; }
  }
  return Math.min(6, runs);
}

// ── 직군 글리프 ZNCC (별 앵커 왼쪽 40×36, 소폭 위치 탐색) ─────────────────────
function classifyGlyph(L: Float32Array, W: number, H: number, sx: number, ry: number): { cls: ClassKey; conf: number } {
  let best: ClassKey = "guard", bestS = -2;
  const patch = new Float64Array(TW * TH);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x0 = sx - 44 + dx, y0 = ry - (TH >> 1) + dy;
      if (x0 < 0 || y0 < 0 || x0 + TW > W || y0 + TH > H) continue;
      for (let j = 0; j < TH; j++) {
        const base = (y0 + j) * W + x0;
        for (let k = 0; k < TW; k++) patch[j * TW + k] = L[base + k];
      }
      const v = zeroMeanUnit(patch);
      for (const t of TMPLS) {
        let s = 0;
        for (let i = 0; i < v.length; i++) s += v[i] * t.vec[i];
        if (s > bestS) { bestS = s; best = t.cls; }
      }
    }
  }
  return { cls: best, conf: bestS };
}

// ── 프레임 1장 스캔 → 셀 검출들 ──────────────────────────────────────────────
export interface FrameScan {
  cols: number[];
  px: number;
  rows: number[];
  colScore: number;
  cells: CellDetection[];
}

// 격자 탐색 파라미터 — 기본값은 "전체 창" 기준. 부분(크롭) 스크린샷은 카드가 화면 대부분을
// 차지해 피치가 W의 14%를 훌쩍 넘고 1행 리본이 최상단에 붙는다 → analyzeFrame이 넓은
// 범위로 재시도한다 (artmatch.ts).
export interface ScanOpts { pitchLoFrac?: number; pitchHiFrac?: number; rowLoFrac?: number; }

export function scanFrame(f: Frame, opts?: ScanOpts): FrameScan {
  const { width: W, height: H } = f;
  const { L, gold } = preprocess(f);
  const xMax = Math.round(W * 0.95); // 우측 툴바 대략 제외
  const { cols, px, score } = detectColumns(L, W, H, xMax, opts?.pitchLoFrac ?? 0.07, opts?.pitchHiFrac ?? 0.14);
  const rows = detectRows(gold, W, H, cols, px, opts?.rowLoFrac ?? 0.13);
  const validCols = cols.filter((c) => c + px <= xMax).slice(0, 7);
  const cells: CellDetection[] = [];
  const rowPitch = rows.length >= 2 ? rows[1] - rows[0] : Math.round(px * 2);
  for (let ri = 0; ri < rows.length; ri++) {
    const ry = rows[ri];
    for (let ci = 0; ci < validCols.length; ci++) {
      const cx = validCols[ci];
      const sx = leftmostStar(gold, W, cx, ry, px);
      if (sx == null) continue;
      // 카드 기울기(블루스택 원근) 보정: 이 칸의 별 리본 y를 개별로 정밀화.
      // 한 행에 단일 y를 쓰면 좌↔우로 갈수록 이름 박스가 어긋난다(삐뚤어짐).
      let cellRy = ry, bestG = -1;
      for (let yy = ry - 20; yy <= ry + 20; yy++) {
        let g = 0; const base = yy * W;
        for (let x = sx; x < sx + 34 && x < W; x++) if (gold[base + x]) g++;
        if (g > bestG) { bestG = g; cellRy = yy; }
      }
      const rarity = countStars(gold, W, sx, cellRy);
      const { cls, conf } = classifyGlyph(L, W, H, sx, cellRy);
      // 모든 박스를 sx(별) 기준으로 앵커링. cx(밝기 틈 위상)는 화면마다 카드 왼쪽에서
      // ~50px씩 어긋나 박스가 우측으로 삐져나감 → 별은 항상 카드 좌상단에 있어 안정적.
      const cardLeft = Math.round(sx - px * 0.31);
      const cardTop = cellRy - Math.round(px * 0.16);
      const cardH = Math.round(px * 1.94); // 카드 실제 높이(리본~이름 아래) ≈ px*1.94, 행 피치보다 짧음
      const card: Rect = { x: cardLeft, y: cardTop, w: Math.round(px * 0.92), h: cardH };
      // 이름 띠: 카드 하단 이름. 2줄 이름까지 덮게 위로·크게(px*1.44, h*0.34). 픽스처 10장
      // 스윕 최적값(줄 단위 매칭과 함께 신뢰매칭 113/134). 윗줄 셰브런/스킬은 match가 줄단위로 걸러냄.
      const nameBox: Rect = { x: cardLeft + Math.round(px * 0.05), y: cellRy + Math.round(px * 1.44), w: Math.round(px * 0.86), h: Math.round(px * 0.34) };
      const eliteBox: Rect = { x: cardLeft + 4, y: cellRy + Math.round(px * 1.05), w: Math.round(px * 0.5), h: Math.round(px * 0.45) };
      cells.push({ row: ri, col: ci, cx: cardLeft, sx, ry: cellRy, rarity, cls, clsConf: conf, card, nameBox, eliteBox });
    }
  }
  return { cols: validCols, px, rows, colScore: score, cells };
}
