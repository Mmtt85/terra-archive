"use client";

// 오퍼 식별 — 카드 아트 영역을 portrait 인덱스(리스트 카드가 실제 렌더하는 원본 아트,
// 기본/정예화/스킨 변형 포함)와 코사인 유사도로 매칭한다 (스펙 §3·§4).
//   ① 인덱스: app/data/portrait-index.json (build-portrait-index.py 생성, 지연 로드)
//   ② 후보: 카드 crop → 그레이 16×24 정규화 벡터 → 전 변형 코사인 top-K
//   ③ 재대조: top-K를 로컬 서치(오프셋 이동)로 재평가해 크롭 오차 흡수
//   ④ 통합: 변형(variant) → operator_id 단위로 합치고, 임계·1-2위 격차(margin) 미달이면
//      unknown(후보 목록 첨부) 반환. 신뢰도 설정값은 호출부에서 조정 가능 (스펙 §10).
// 100% 클라이언트 — 어디에도 전송 없음. ML 모델 불사용(동일 원본 아트 매칭이라 불필요).

export type MatchConfig = {
  minScore: number;      // 1위 최소 코사인 (기본 0.60)
  minMargin: number;     // (1위-2위) 최소 격차 — 서로 다른 오퍼 간 (기본 0.04)
  topK: number;          // 재대조 후보 수 (기본 6)
};
export const DEFAULT_MATCH: MatchConfig = { minScore: 0.6, minMargin: 0.04, topK: 6 };

export type OperatorMatch = {
  operatorId: string | null;
  matchedVariant: string | null;
  score: number;                       // 1위 코사인 (0~1)
  margin: number;                      // 1위-2위(다른 오퍼) 격차
  candidates: { operatorId: string; variant: string; score: number }[]; // top-3 (디버그·unknown용)
  reason?: "ambiguous_operator_match" | "low_similarity";
};

let W = 16, H = 24, DIM = W * H;
let IDS: string[] = [];
let VARIANTS: string[] = [];
let MAT: Float32Array | null = null; // N×DIM 평균0·L2정규화
let loadingPromise: Promise<void> | null = null;

export function portraitIndexReady(): boolean { return MAT !== null; }
export function portraitVariantCount(): number { return VARIANTS.length; }

export async function initPortraitIndex(): Promise<void> {
  if (MAT) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const mod = await import("./data/portrait-index.json");
    const data = (mod as unknown as { default?: IndexFile }).default ?? (mod as unknown as IndexFile);
    W = data.w; H = data.h; DIM = W * H;
    const n = data.portraits.length;
    const mat = new Float32Array(n * DIM);
    IDS = new Array(n); VARIANTS = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const e = data.portraits[i];
      IDS[i] = e.id; VARIANTS[i] = e.v;
      const raw = atob(e.g);
      const off = i * DIM;
      let mean = 0;
      for (let k = 0; k < DIM; k += 1) mean += raw.charCodeAt(k);
      mean /= DIM;
      let norm = 0;
      for (let k = 0; k < DIM; k += 1) { const v = raw.charCodeAt(k) - mean; mat[off + k] = v; norm += v * v; }
      norm = Math.sqrt(norm) || 1;
      for (let k = 0; k < DIM; k += 1) mat[off + k] /= norm;
    }
    MAT = mat;
  })();
  return loadingPromise;
}

type IndexFile = { w: number; h: number; portraits: { id: string; v: string; g: string }[] };

const scratch = typeof document !== "undefined" ? document.createElement("canvas") : null;

// 영역을 W×H 그레이 정규화 벡터로 (인덱스와 파리티: L601, 평균0, L2)
function regionVec(frame: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): Float32Array | null {
  const canvas = scratch!;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  const v = new Float32Array(DIM);
  let mean = 0;
  for (let i = 0; i < DIM; i += 1) { v[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; mean += v[i]; }
  mean /= DIM;
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) { v[i] -= mean; norm += v[i] * v[i]; }
  norm = Math.sqrt(norm);
  if (norm < 1e-6) return null;
  for (let i = 0; i < DIM; i += 1) v[i] /= norm;
  return v;
}

function topKOf(v: Float32Array, k: number): { idx: number; score: number }[] {
  const mat = MAT!;
  const n = VARIANTS.length;
  const heap: { idx: number; score: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const off = i * DIM;
    let s = 0;
    for (let d = 0; d < DIM; d += 1) s += v[d] * mat[off + d];
    if (heap.length < k) { heap.push({ idx: i, score: s }); heap.sort((a, b) => a.score - b.score); }
    else if (s > heap[0].score) { heap[0] = { idx: i, score: s }; heap.sort((a, b) => a.score - b.score); }
  }
  return heap.sort((a, b) => b.score - a.score);
}

// 카드 ROI(프레임 픽셀)를 식별. 카드는 portrait를 "상단 정렬·전폭"으로 그리므로 매칭은
// **카드 상단 정사각(폭×폭)**만 사용 — 카드 비율(이름띠에 하단이 얼마나 가리든)과 무관하게
// 인덱스(portrait 상단 정사각)와 같은 내용이 보인다 (2026-07-22 실험: 전체상 4/14 → 정사각 14/14).
// 로컬 서치로 격자 오차(±8%)를 흡수한다.
export function matchOperator(
  frame: CanvasImageSource,
  cardBox: { x: number; y: number; w: number; h: number },
  cfg: MatchConfig = DEFAULT_MATCH,
): OperatorMatch | null {
  if (!MAT || cardBox.w < 8 || cardBox.h < 8) return null;
  const box = { x: cardBox.x, y: cardBox.y, w: cardBox.w, h: Math.min(cardBox.w, cardBox.h) }; // 상단 정사각
  // 1차: 정사각 크롭 벡터로 전 변형 top-K
  const v0 = regionVec(frame, box.x, box.y, box.w, box.h);
  if (!v0) return null;
  const rough = topKOf(v0, Math.max(cfg.topK, 3));
  // 2차: top-K 각각을 오프셋 로컬 서치로 재평가 (crop 오차·스케일 보정)
  const offsets = [-0.08, -0.04, 0, 0.04, 0.08];
  const rescored = rough.map(({ idx }) => {
    let best = -2;
    for (const dy of offsets) {
      for (const dx of offsets) {
        const v = regionVec(frame, box.x + dx * box.w, box.y + dy * box.h, box.w, box.h);
        if (!v) continue;
        const off = idx * DIM;
        let s = 0;
        for (let d = 0; d < DIM; d += 1) s += v[d] * MAT![off + d];
        if (s > best) best = s;
      }
    }
    return { idx, score: best };
  }).sort((a, b) => b.score - a.score);

  // 변형 → 오퍼 통합: 1위 오퍼와, "다른 오퍼" 중 최고가 margin 상대
  const top = rescored[0];
  const topId = IDS[top.idx];
  const rival = rescored.find((r) => IDS[r.idx] !== topId);
  const margin = top.score - (rival?.score ?? -1);
  const candidates = rescored.slice(0, 3).map((r) => ({ operatorId: IDS[r.idx], variant: VARIANTS[r.idx], score: Math.round(r.score * 1000) / 1000 }));

  if (top.score < cfg.minScore) return { operatorId: null, matchedVariant: null, score: top.score, margin, candidates, reason: "low_similarity" };
  if (rival && margin < cfg.minMargin) return { operatorId: null, matchedVariant: null, score: top.score, margin, candidates, reason: "ambiguous_operator_match" };
  return { operatorId: topId, matchedVariant: VARIANTS[top.idx], score: top.score, margin, candidates };
}
