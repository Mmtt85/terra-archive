"use client";

// 정예화 배지 분류 — 오퍼 리스트 카드의 정예화 마크(E0/E1/E2)는 게임 공통 고정 스프라이트라
// (초상화와 달리 오퍼별 변형 없음) 템플릿 매칭이 정석이다. 인게임 배지는 임의의 카드 아트 위에
// "거의 순백 글리프"로 얹히므로, 그레이 상관(아트 노이즈에 압도됨 — 2026-07-22 실험 1/14)이
// 아니라 **밝기 이진화 마스크 vs 스프라이트 알파 마스크의 Dice 계수**로 비교한다.
// 템플릿: public/scan/elite{0,1,2}.webp (scripts/download-scanner-ui.py). 100% 클라이언트.

// 32px·크기 6종·스텝 win/6이 최적 (2026-07-22 파라미터 스윕: 28px·4종 8/14 → 32px·6종 11/14,
// E1·E2 전원 정답. 남은 실패는 전부 E0 — 얇은 외곽선 글리프가 이진 마스크에 취약).
const SIZE = 32;
const DIM = SIZE * SIZE;
let TPL: Uint8Array[] | null = null; // [E0,E1,E2] 알파>50% 이진 마스크
let TPL_SUM: number[] = [];
let loadingPromise: Promise<void> | null = null;

async function loadMask(url: string): Promise<Uint8Array> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const m = new Uint8Array(DIM);
  for (let i = 0; i < DIM; i += 1) m[i] = data[i * 4 + 3] > 128 ? 1 : 0; // 알파 마스크
  return m;
}

export async function initEliteTemplates(): Promise<void> {
  if (TPL) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    TPL = await Promise.all([0, 1, 2].map((n) => loadMask(`/scan/elite${n}.webp`)));
    TPL_SUM = TPL.map((m) => m.reduce((s, v) => s + v, 0));
  })();
  return loadingPromise;
}

const scratch = typeof document !== "undefined" ? document.createElement("canvas") : null;

// 창 영역을 SIZE×SIZE로 축소해 "밝은 픽셀(흰 글리프)" 이진 마스크로 만든다.
// 임계는 창 내 최대 밝기의 78% — 카드 아트가 밝아도 글리프(순백)가 항상 최상단이라 적응적.
function windowMask(frame: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): { m: Uint8Array; sum: number } | null {
  const canvas = scratch!;
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const g = new Float32Array(DIM);
  let max = 0;
  for (let i = 0; i < DIM; i += 1) { g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; if (g[i] > max) max = g[i]; }
  if (max < 140) return null; // 밝은 글리프가 아예 없음
  const thr = max * 0.78;
  const m = new Uint8Array(DIM);
  let sum = 0;
  for (let i = 0; i < DIM; i += 1) { if (g[i] >= thr) { m[i] = 1; sum += 1; } }
  if (sum < DIM * 0.04 || sum > DIM * 0.75) return null; // 글리프 비율이 비정상
  return { m, sum };
}

export type EliteResult = { elite: 0 | 1 | 2; score: number };

// region(카드 상부 탐색 영역) 안을 창 크기 3종 × 슬라이딩하며 E0/E1/E2 알파 마스크와
// Dice 계수(2·교집합/(합)) 최고 클래스를 찾는다. score<minScore면 null(불확실).
export function classifyElite(frame: CanvasImageSource, region: { x: number; y: number; w: number; h: number }, minScore = 0.55): EliteResult | null {
  if (!TPL || region.w < 10 || region.h < 10) return null;
  let best: EliteResult | null = null;
  const base = Math.min(region.w, region.h);
  for (const frac of [0.34, 0.42, 0.5, 0.58, 0.66, 0.74]) {
    const win = base * frac;
    if (win < 10) continue;
    const step = Math.max(2, win / 6);
    for (let y = region.y; y + win <= region.y + region.h + 0.1; y += step) {
      for (let x = region.x; x + win <= region.x + region.w + 0.1; x += step) {
        const wm = windowMask(frame, x, y, win, win);
        if (!wm) continue;
        for (let k = 0; k < 3; k += 1) {
          const tpl = TPL[k];
          let inter = 0;
          for (let i = 0; i < DIM; i += 1) if (wm.m[i] & tpl[i]) inter += 1;
          const dice = (2 * inter) / (wm.sum + TPL_SUM[k]);
          if (!best || dice > best.score) best = { elite: k as 0 | 1 | 2, score: dice };
        }
      }
    }
  }
  return best && best.score >= minScore ? best : null;
}
