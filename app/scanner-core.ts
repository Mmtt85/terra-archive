"use client";

// 화면 인식 스캐너 코어 — 캡처 프레임의 카드 초상화를 아바타 ZNCC 템플릿과 정규화 상관으로
// 매칭해 오퍼를 식별한다. 100% 클라이언트. 템플릿(app/data/avatar-templates.json)은 스캐너를
// 열 때 지연 로드(메인 번들에 안 들어감).
//
// dHash(64bit)는 변별력·정렬 민감도가 부족해 폐기(2026-07-22 실험: 크롭 5% 어긋나면 전멸).
// 대신 ZNCC 그레이 템플릿(24×24, 중앙크롭) + 셀별 로컬 서치 → 크롭 ±8%·저해상도·블러에 강건.
// 알고리즘 파리티: scripts/build-avatar-templates.py 와 그레이 L601·정규화·크기가 동일해야 한다.

export type Match = { id: string; name: string; rarity: number; score: number; margin: number };

let SIZE = 24;
let DIM = SIZE * SIZE;
// 인덱스 템플릿이 아바타의 어느 중앙 영역을 담는지(build-avatar-templates.py의 CROP). 쿼리에도
// **동일하게** 적용해야 프레이밍이 맞는다. 기본값은 빌드 스크립트와 같게 둔다.
let CROP = { x0: 0.12, y0: 0.06, x1: 0.88, y1: 0.80 };
let IDS: string[] = [];
let NAMES: string[] = [];
let RARITY: number[] = [];
let MAT: Float32Array | null = null; // N×DIM, 각 행은 평균0·L2정규화
let loadingPromise: Promise<void> | null = null;

export function templatesReady(): boolean { return MAT !== null; }
export function templateCount(): number { return IDS.length; }

// 템플릿 지연 로드 + 정규화(평균차감·L2). 한 번만 수행.
export async function initTemplates(): Promise<void> {
  if (MAT) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const mod = await import("./data/avatar-templates.json");
    const data = (mod as unknown as { default?: TemplatesFile }).default ?? (mod as unknown as TemplatesFile);
    SIZE = data.size;
    DIM = SIZE * SIZE;
    if (data.crop) CROP = data.crop as typeof CROP;
    const n = data.avatars.length;
    const mat = new Float32Array(n * DIM);
    IDS = new Array(n);
    NAMES = new Array(n);
    RARITY = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const a = data.avatars[i];
      IDS[i] = a.id; NAMES[i] = a.n; RARITY[i] = a.r;
      const raw = atob(a.t); // DIM 바이트 그레이
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

type TemplatesFile = { size: number; crop: Record<string, number>; avatars: { id: string; n: string; r: number; t: string }[] };

// 그레이 축소용 재사용 캔버스
const scratch = typeof document !== "undefined" ? document.createElement("canvas") : null;

// 프레임의 (sx,sy,sw,sh) 영역을 SIZE×SIZE 그레이로 축소 → 평균0·L2정규화한 벡터
function regionVec(frame: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): Float32Array | null {
  const canvas = scratch!;
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const v = new Float32Array(DIM);
  let mean = 0;
  for (let i = 0; i < DIM; i += 1) {
    const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    v[i] = g; mean += g;
  }
  mean /= DIM;
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) { v[i] -= mean; norm += v[i] * v[i]; }
  norm = Math.sqrt(norm);
  if (norm < 1e-6) return null;
  for (let i = 0; i < DIM; i += 1) v[i] /= norm;
  return v;
}

// 정규화 벡터 → 최근접 템플릿(코사인 = 내적) + 2등과의 차(margin)
function matchVec(v: Float32Array): Match | null {
  const mat = MAT;
  if (!mat) return null;
  const n = IDS.length;
  let best = -2, second = -2, bi = -1;
  for (let i = 0; i < n; i += 1) {
    const off = i * DIM;
    let s = 0;
    for (let k = 0; k < DIM; k += 1) s += v[k] * mat[off + k];
    if (s > best) { second = best; best = s; bi = i; }
    else if (s > second) { second = s; }
  }
  if (bi < 0) return null;
  return { id: IDS[bi], name: NAMES[bi], rarity: RARITY[bi], score: best, margin: best - second };
}

// 한 초상화 영역(box, 프레임 픽셀)을 로컬 서치로 매칭 — box를 소폭 이동하며 최고 상관을 취해
// 격자/크롭 어긋남을 흡수한다. searchFrac=이동 폭(box 대비), steps=한 축 오프셋 개수(홀수 권장).
export function recognizeRegion(
  frame: CanvasImageSource,
  box: { x: number; y: number; w: number; h: number },
  searchFrac = 0.08,
  steps = 5,
): Match | null {
  if (!MAT || box.w < 4 || box.h < 4) return null;
  let best: Match | null = null;
  const half = (steps - 1) / 2;
  for (let iy = 0; iy < steps; iy += 1) {
    const dy = ((iy - half) / half) * searchFrac * box.h;
    for (let ix = 0; ix < steps; ix += 1) {
      const dx = ((ix - half) / half) * searchFrac * box.w;
      // box를 오프셋 이동한 뒤, 인덱스와 동일한 중앙 크롭(CROP)을 적용해 샘플링 (프레이밍 파리티)
      const cx = box.x + dx + box.w * CROP.x0;
      const cy = box.y + dy + box.h * CROP.y0;
      const cw = box.w * (CROP.x1 - CROP.x0);
      const ch = box.h * (CROP.y1 - CROP.y0);
      const v = regionVec(frame, cx, cy, cw, ch);
      if (!v) continue;
      const m = matchVec(v);
      if (m && (!best || m.score > best.score)) best = m;
    }
  }
  return best;
}
