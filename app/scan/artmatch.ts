// 오퍼 스캐너 — 카드 아트 ↔ 초상 템플릿 매칭 + 정예화 엠블럼 분류.
// (순수 계산 코어. React·DOM 무의존 — 워커/Node 하네스에서 동일 구동)
//
// 원리(2026-07-23 확정): 오퍼 목록 카드의 아트 = "장착 스킨의 초상(portrait) 에셋"을
// 고정 배율로 확대한 것. KR 전 초상(스킨 포함, scripts/build-scan-templates.py)을
// 카드에 그려지는 영역만 잘라 42×30 템플릿으로 굽고, 카드 밴드를 같은 크기로 리샘플해
// masked ZNCC(초상 알파 영역만)로 대조한다. 스모크 실측: 정답 0.88~0.96, 타 오퍼 최고
// 0.63~0.68 — 이름 OCR(84% 상한)을 대체하는 주 식별자.
//
// 정예화: 카드 중단 엠블럼이 E0=무표시 / E1=✕ / E2=날개 스택 (사용자 확인 도메인 팩트).
// 인-도메인 템플릿 ZNCC, 양쪽 모두 임계 미만이면 E0. 3-way 실측 32/32.
import PT from "./portrait-templates.json";
import ET from "./elite-templates.json";
import { scanFrame, type Frame, type FrameScan, type CellDetection, type ScanOpts } from "./vision";

export interface ArtCandidate {
  op: string;      // charId (operators.json id)
  pid: string;     // portraitId (어떤 스킨으로 인식됐나 — 진단용)
  score: number;   // masked ZNCC
}

export interface ArtMatchResult {
  best: ArtCandidate;
  margin: number;  // 다른 오퍼 최고점과의 차 (같은 오퍼의 다른 스킨은 마진 계산에서 제외)
  rivalOp: string; // 마진 상대(진단용)
}

// ── 템플릿 디코드(1회 lazy) ──────────────────────────────────────────────────
const { tw: TW, th: TH, band: BAND } = PT as unknown as {
  tw: number; th: number; band: { ax: number; ay: number; aw: number; ah: number };
};

interface Tmpl { op: string; pid: string; r: number; t: Float32Array; mask: Uint8Array; norm: number; n: number; }
let TMPLS: Tmpl[] | null = null;

function b64bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function templates(): Tmpl[] {
  if (TMPLS) return TMPLS;
  const raw = (PT as unknown as { templates: { op: string; pid: string; r: number; g: string; m: string }[] }).templates;
  TMPLS = raw.map((e) => {
    const g = b64bytes(e.g);
    const mb = b64bytes(e.m);
    const N = TW * TH;
    const mask = new Uint8Array(N);
    let n = 0, sum = 0;
    for (let p = 0; p < N; p++) {
      if (mb[p >> 3] & (1 << (p & 7))) { mask[p] = 1; n++; sum += g[p]; }
    }
    const mean = n ? sum / n : 0;
    const t = new Float32Array(N);
    let ss = 0;
    for (let p = 0; p < N; p++) if (mask[p]) { const d = g[p] - mean; t[p] = d; ss += d * d; }
    return { op: e.op, pid: e.pid, r: e.r, t, mask, norm: Math.sqrt(ss), n };
  });
  return TMPLS;
}

// ── 프레임 그레이(아트 매칭 전용, 1프레임 1회) ───────────────────────────────
export interface GrayFrame { L: Float32Array; W: number; H: number; }
export function toGray(f: Frame): GrayFrame {
  const { data, width: W, height: H } = f;
  const L = new Float32Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) L[p] = (data[i] + data[i + 1] + data[i + 2]) / 3;
  return { L, W, H };
}

// 소스 rect(실수 좌표)를 tw×th로 박스 평균 리샘플
function sampleRect(g: GrayFrame, x0: number, y0: number, w: number, h: number, tw: number, th: number): Float32Array {
  const out = new Float32Array(tw * th);
  const { L, W, H } = g;
  for (let j = 0; j < th; j++) {
    const sy0 = y0 + (j / th) * h, sy1 = y0 + ((j + 1) / th) * h;
    const ya = Math.max(0, Math.floor(sy0)), yb = Math.min(H, Math.ceil(sy1));
    for (let i = 0; i < tw; i++) {
      const sx0 = x0 + (i / tw) * w, sx1 = x0 + ((i + 1) / tw) * w;
      const xa = Math.max(0, Math.floor(sx0)), xb = Math.min(W, Math.ceil(sx1));
      let s = 0, c = 0;
      for (let y = ya; y < yb; y++) {
        const base = y * W;
        for (let x = xa; x < xb; x++) { s += L[base + x]; c++; }
      }
      out[j * tw + i] = c ? s / c : 0;
    }
  }
  return out;
}

// 밴드(리샘플된 42×30) vs 템플릿 masked ZNCC
function scoreTmpl(band: Float32Array, tm: Tmpl): number {
  if (tm.n < 80 || tm.norm < 1e-3) return -1;
  let s1 = 0, s2 = 0, s3 = 0;
  const { t, mask, n } = tm;
  for (let p = 0; p < band.length; p++) {
    if (!mask[p]) continue;
    const b = band[p];
    s1 += b; s2 += b * b; s3 += t[p] * b;
  }
  const varB = s2 - (s1 * s1) / n;
  if (varB < 1e-3) return -1;
  return s3 / (tm.norm * Math.sqrt(varB));
}

// ── 카드 아트 매칭 ───────────────────────────────────────────────────────────
// 2패스: ①중앙 크롭으로 전 템플릿 채점 ②상위 오퍼 후보만 위치·스케일 지터 정밀화.
export function matchArt(g: GrayFrame, sx: number, ry: number, px: number): ArtMatchResult | null {
  const T = templates();
  const bx = sx + BAND.ax * px, by = ry + BAND.ay * px;
  const bw = BAND.aw * px, bh = BAND.ah * px;
  const center = sampleRect(g, bx, by, bw, bh, TW, TH);

  // 패스1: 오퍼별 최고 템플릿
  const perOp = new Map<string, { tm: Tmpl; score: number }>();
  for (const tm of T) {
    const s = scoreTmpl(center, tm);
    const cur = perOp.get(tm.op);
    if (!cur || s > cur.score) perOp.set(tm.op, { tm, score: s });
  }
  const ranked = [...perOp.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  if (ranked.length === 0) return null;

  // 패스2: 지터 정밀화 (±0.03px 이동 5×5 · 스케일 3단)
  const J = px * 0.015;
  let best: { tm: Tmpl; score: number } | null = null;
  let second: { op: string; score: number } | null = null;
  for (const cand of ranked) {
    let s = cand.score;
    for (const sc of [0.97, 1.0, 1.03]) {
      const w = bw * sc, h = bh * sc;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (sc === 1.0 && dx === 0 && dy === 0) continue;
          const band = sampleRect(g, bx + dx * J - (w - bw) / 2, by + dy * J - (h - bh) / 2, w, h, TW, TH);
          const v = scoreTmpl(band, cand.tm);
          if (v > s) s = v;
        }
      }
    }
    if (!best || s > best.score) {
      if (best && best.tm.op !== cand.tm.op && (!second || best.score > second.score)) second = { op: best.tm.op, score: best.score };
      best = { tm: cand.tm, score: s };
    } else if (best.tm.op !== cand.tm.op && (!second || s > second.score)) {
      second = { op: cand.tm.op, score: s };
    }
  }
  if (!best) return null;
  return {
    best: { op: best.tm.op, pid: best.tm.pid, score: best.score },
    margin: second ? best.score - second.score : 1,
    rivalOp: second?.op ?? "",
  };
}

// ── 정예화 엠블럼 3-way ──────────────────────────────────────────────────────
// 글리프(밝은 픽셀+1px 팽창) 마스크 안에서만 ZNCC — 빈 배경(E0)이 평균 템플릿과
// 우연히 상관되는 것을 차단 (실측: E1 갭 +0.11 → +0.23, E2 +0.60).
const EB = ET as unknown as {
  size: number; box: { ax: number; ay: number; aw: number; ah: number }; thr: number;
  e1: string; m1: string; e2: string; m2: string;
};
interface EliteTmpl { t: Float32Array; mask: Uint8Array; norm: number; n: number; }
let ELITE: { e1: EliteTmpl; e2: EliteTmpl } | null = null;
function eliteTmpls() {
  if (ELITE) return ELITE;
  const mk = (b64: string, mb64: string): EliteTmpl => {
    const g = b64bytes(b64);
    const mb = b64bytes(mb64);
    const mask = new Uint8Array(g.length);
    let n = 0, sum = 0;
    for (let p = 0; p < g.length; p++) {
      if (mb[p >> 3] & (1 << (p & 7))) { mask[p] = 1; n++; sum += g[p]; }
    }
    const mean = n ? sum / n : 0;
    const t = new Float32Array(g.length);
    let ss = 0;
    for (let p = 0; p < g.length; p++) if (mask[p]) { const d = g[p] - mean; t[p] = d; ss += d * d; }
    return { t, mask, norm: Math.sqrt(ss), n };
  };
  ELITE = { e1: mk(EB.e1, EB.m1), e2: mk(EB.e2, EB.m2) };
  return ELITE;
}

function znccMasked(a: Float32Array, tm: EliteTmpl): number {
  let s1 = 0, s2 = 0, s3 = 0;
  const { t, mask, n } = tm;
  for (let p = 0; p < a.length; p++) {
    if (!mask[p]) continue;
    const b = a[p];
    s1 += b; s2 += b * b; s3 += t[p] * b;
  }
  const varB = s2 - (s1 * s1) / n;
  if (varB < 1e-3 || tm.norm < 1e-3) return -1;
  return s3 / (tm.norm * Math.sqrt(varB));
}

/** 0=무표시, 1=✕, 2=날개 스택. maxElite(성급) 상한은 호출부에서 클램프. */
export function classifyElite(g: GrayFrame, sx: number, ry: number, px: number): { elite: 0 | 1 | 2; s1: number; s2: number } {
  const { e1, e2 } = eliteTmpls();
  const S = EB.size;
  let m1 = -1, m2 = -1;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x0 = sx + EB.box.ax * px + dx * px * 0.02;
      const y0 = ry + EB.box.ay * px + dy * px * 0.02;
      const patch = sampleRect(g, x0, y0, EB.box.aw * px, EB.box.ah * px, S, S);
      const v1 = znccMasked(patch, e1), v2 = znccMasked(patch, e2);
      if (v1 > m1) m1 = v1;
      if (v2 > m2) m2 = v2;
    }
  }
  // 순차 판정: 진짜 E1의 es2 최대 0.37 vs 진짜 E2의 es2 최소 0.61 (픽스처 138셀) —
  // es1·es2 대소 비교는 밝은 배경 E2에서 마진 0.03까지 좁아지므로 쓰지 않는다.
  const elite = m2 >= EB.thr ? 2 : m1 >= EB.thr ? 1 : 0;
  return { elite, s1: m1, s2: m2 };
}

// ── 프레임 1장 종합 분석 (격자 + 아트 매칭 + 정예화, 크롭 재시도 포함) ─────────
// 전체 창 파라미터로 먼저 스캔하고, 결과가 부실하면(최고 아트 점수 미달) 부분(크롭)
// 스크린샷 파라미터로 재시도해 더 나은 쪽을 쓴다. 정상 전체 창은 최고 셀이 0.8+라
// 재시도가 발동하지 않고(픽스처 152셀 실측), 크롭은 기본 피치 범위(W의 7~14%)를
// 벗어나므로 1차에서 셀이 없거나 저점수가 된다.
export interface CellMatch {
  cell: CellDetection;
  op: string; pid: string; score: number; margin: number; rivalOp: string;
  elite: 0 | 1 | 2; es1: number; es2: number;
}
export interface FrameAnalysis { scan: FrameScan; cells: CellMatch[]; cropRetry: boolean; }

const RETRY_QUALITY = 0.75; // 1차 최고 셀 점수가 이 미만이면 크롭 파라미터 재시도
const CROP_OPTS: ScanOpts = { pitchLoFrac: 0.12, pitchHiFrac: 0.52, rowLoFrac: 0 };

export function analyzeFrame(f: Frame): FrameAnalysis {
  const g = toGray(f);
  const attempt = (opts?: ScanOpts) => {
    const scan = scanFrame(f, opts);
    const cells: CellMatch[] = [];
    for (const c of scan.cells) {
      if (c.rarity < 1) continue;
      const am = matchArt(g, c.sx, c.ry, scan.px);
      if (!am) continue;
      const el = classifyElite(g, c.sx, c.ry, scan.px);
      cells.push({ cell: c, op: am.best.op, pid: am.best.pid, score: am.best.score, margin: am.margin, rivalOp: am.rivalOp, elite: el.elite, es1: el.s1, es2: el.s2 });
    }
    return { scan, cells };
  };
  const quality = (a: { cells: CellMatch[] }) => a.cells.reduce((m, c) => Math.max(m, c.score), 0);
  const first = attempt();
  if (quality(first) >= RETRY_QUALITY) return { ...first, cropRetry: false };
  const retry = attempt(CROP_OPTS);
  return quality(retry) > quality(first) ? { ...retry, cropRetry: true } : { ...first, cropRetry: false };
}
