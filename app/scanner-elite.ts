"use client";

// 정예화 단계 인식 (스펙 §5) — 배지는 게임 공통 고정 스프라이트(E1/E2)라 템플릿 매칭.
// 인게임 배지는 임의 카드 아트 위 "순백 글리프"라, 그레이 상관 대신 밝기 적응 이진화
// 마스크 vs 스프라이트 알파 마스크의 Dice 계수로 비교한다 (2026-07-22 스윕: E1·E2 전원 정답).
// 판정 규칙(스펙): E2 일치 → E1 일치 → 둘 다 임계 미달이면 E0.
// 임계 0.45 — 실화면 E2 배지 Dice 실측 0.45~0.74 (2026-07-22 픽스처 4장, 합성보다 낮음:
// 점무늬·아트 간섭). E0 정확도는 저정예 화면 미확보로 미검증 — 실측 후 재보정.
//   (E0 배지는 얇은 외곽선이라 양성 매칭이 취약 — E0를 '부재'로 판정해 그 약점을 우회한다)
// 템플릿: public/scan/elite{1,2}.webp (scripts/download-scanner-ui.py). 100% 클라이언트.

const SIZE = 32;
const DIM = SIZE * SIZE;
let TPL: { mask: Uint8Array; sum: number }[] | null = null; // [E1, E2]
let loadingPromise: Promise<void> | null = null;

async function loadMask(url: string): Promise<{ mask: Uint8Array; sum: number }> {
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
  const mask = new Uint8Array(DIM);
  let sum = 0;
  for (let i = 0; i < DIM; i += 1) { if (data[i * 4 + 3] > 128) { mask[i] = 1; sum += 1; } }
  return { mask, sum };
}

export async function initEliteTemplates(): Promise<void> {
  if (TPL) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => { TPL = await Promise.all([1, 2].map((n) => loadMask(`/scan/elite${n}.webp`))); })();
  return loadingPromise;
}

const scratch = typeof document !== "undefined" ? document.createElement("canvas") : null;

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
  if (max < 140) return null;
  const thr = max * 0.78;
  const m = new Uint8Array(DIM);
  let sum = 0;
  for (let i = 0; i < DIM; i += 1) { if (g[i] >= thr) { m[i] = 1; sum += 1; } }
  if (sum < DIM * 0.04 || sum > DIM * 0.75) return null;
  return { m, sum };
}

export type EliteResult = { elite: 0 | 1 | 2; confidence: number };

// region(배지가 있을 카드 중하부 탐색 영역) → E2/E1 Dice 최고점. 둘 다 minScore 미달 = E0.
// E0 confidence = 1 - max(E1,E2 최고점) — "배지가 안 보였다"의 강도.
export function classifyElite(frame: CanvasImageSource, region: { x: number; y: number; w: number; h: number }, minScore = 0.45): EliteResult {
  if (!TPL || region.w < 10 || region.h < 10) return { elite: 0, confidence: 0 };
  const bestOf = [-1, -1]; // [E1, E2]
  const base = Math.min(region.w, region.h);
  for (const frac of [0.34, 0.42, 0.5, 0.58, 0.66, 0.74]) {
    const win = base * frac;
    if (win < 10) continue;
    const step = Math.max(2, win / 6);
    for (let y = region.y; y + win <= region.y + region.h + 0.1; y += step) {
      for (let x = region.x; x + win <= region.x + region.w + 0.1; x += step) {
        const wm = windowMask(frame, x, y, win, win);
        if (!wm) continue;
        for (let k = 0; k < 2; k += 1) {
          const tpl = TPL[k];
          let inter = 0;
          for (let i = 0; i < DIM; i += 1) if (wm.m[i] & tpl.mask[i]) inter += 1;
          const dice = (2 * inter) / (wm.sum + tpl.sum);
          if (dice > bestOf[k]) bestOf[k] = dice;
        }
      }
    }
  }
  if (bestOf[1] >= minScore && bestOf[1] >= bestOf[0]) return { elite: 2, confidence: bestOf[1] };
  if (bestOf[0] >= minScore) return { elite: 1, confidence: bestOf[0] };
  return { elite: 0, confidence: Math.min(1, Math.max(0, 1 - Math.max(bestOf[0], bestOf[1]))) };
}
