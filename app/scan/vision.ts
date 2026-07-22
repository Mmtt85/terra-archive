// 오퍼 스캐너 — 순수 컴퓨터비전 코어 (React·DOM 무의존, 워커에서 구동).
// 검증된 파이프라인(2026-07-23, 실스샷 3장/42카드): 자동 격자 → 별 앵커 성급 → 인-도메인
// 직군 글리프 ZNCC. 직군 42/42(100%), 성급 38/42(90%). scripts는 scratchpad/scan_reference.py 기준.
//
// 카드 아트 자체 이미지 매칭은 불가(신 UI 일러스트가 공개 미러에 없음, 1차 세션 확정) →
// 이름 OCR(app/scan/ocr.ts)이 주 식별자, 성급=하드제약·직군=신뢰도 게이트 소프트제약(app/scan/match.ts).
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
  cx: number;      // 카드 좌측 경계(열 골짜기)
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
  let best = 0, bestS = -1;
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = 0; i + lag < d.length; i++) s += d[i] * d[i + lag];
    s /= varSum;
    if (s > bestS) { bestS = s; best = lag; }
  }
  return { pitch: best, score: bestS };
}

function valleyPhase(prof: Float64Array, pitch: number): number {
  const acc = new Float64Array(pitch), cnt = new Float64Array(pitch);
  for (let i = 0; i < prof.length; i++) { acc[i % pitch] += prof[i]; cnt[i % pitch] += 1; }
  let best = 0, bestV = Infinity;
  for (let k = 0; k < pitch; k++) { const v = acc[k] / Math.max(cnt[k], 1); if (v < bestV) { bestV = v; best = k; } }
  return best;
}

function detectColumns(L: Float32Array, W: number, H: number, xMax: number): { cols: number[]; px: number; score: number } {
  const y0 = Math.round(H * 0.30), y1 = Math.round(H * 0.55);
  const colp = new Float64Array(xMax);
  for (let x = 0; x < xMax; x++) {
    let s = 0;
    for (let y = y0; y < y1; y++) s += L[y * W + x];
    colp[x] = s / (y1 - y0);
  }
  const { pitch, score } = bestPeriod(colp, Math.round(W * 0.07), Math.round(W * 0.14));
  const gx = valleyPhase(colp, pitch);
  const cols: number[] = [];
  for (let x = gx; x < xMax - Math.round(pitch * 0.3); x += pitch) cols.push(x);
  return { cols, px: pitch, score };
}

// ── 행 격자: 성급-독립 (별 리본 = 모든 카드열 최상단의 얇은 골드) ────────────
function detectRows(gold: Uint8Array, W: number, H: number, cols: number[], px: number): number[] {
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
  const r0 = firstRibbon(Math.round(H * 0.13), Math.round(H * 0.48));
  const r1 = firstRibbon(Math.round(H * 0.50), Math.round(H * 0.86));
  return [r0, r1].sort((a, b) => a - b);
}

// ── 별 앵커 + 성급 ───────────────────────────────────────────────────────────
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

export function scanFrame(f: Frame): FrameScan {
  const { width: W, height: H } = f;
  const { L, gold } = preprocess(f);
  const xMax = Math.round(W * 0.95); // 우측 툴바 대략 제외
  const { cols, px, score } = detectColumns(L, W, H, xMax);
  const rows = detectRows(gold, W, H, cols, px);
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
      const cardTop = cellRy - 22;
      const cardH = Math.round(rowPitch * 0.95);
      const card: Rect = { x: cx, y: cardTop, w: px, h: cardH };
      // 이름 띠: 카드 맨 아래 이름 줄(브랜치 아이콘·LV원 제외) — OCR 88% 검증값(px*1.60)
      const nameBox: Rect = { x: cx + Math.round(px * 0.05), y: cellRy + Math.round(px * 1.60), w: Math.round(px * 0.90), h: Math.round(px * 0.21) };
      const eliteBox: Rect = { x: cx + 4, y: cellRy + Math.round(px * 1.05), w: Math.round(px * 0.5), h: Math.round(px * 0.45) };
      cells.push({ row: ri, col: ci, cx, sx, ry: cellRy, rarity, cls, clsConf: conf, card, nameBox, eliteBox });
    }
  }
  return { cols: validCols, px, rows, colScore: score, cells };
}
