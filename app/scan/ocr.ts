// 오퍼 스캐너 — 이름 띠 OCR (tesseract.js, kor+eng, 100% 클라이언트).
// 애셋은 public/tesseract/ 자가호스팅(CF Pages, CDN 미접속). 검증된 전처리:
// 반전(흰글자→검정) → 4x 업스케일 → 오토콘트라스트 → Otsu 이진화 → 흰 여백.
// (2026-07-23 Node 하네스: 단일프레임 이름매칭 88% — 다중프레임 투표로 상향).
import { createWorker, PSM, type Worker } from "tesseract.js";
import type { Rect } from "./vision";

let workerP: Promise<Worker> | null = null;

export type OcrProgress = (status: string, progress: number) => void;

export function initOcr(onProgress?: OcrProgress): Promise<Worker> {
  if (workerP) return workerP;
  workerP = (async () => {
    const w = await createWorker(["kor", "eng"], 1, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract",
      langPath: "/tesseract/lang",
      gzip: false,
      logger: onProgress ? (m: { status: string; progress: number }) => onProgress(m.status, m.progress) : undefined,
    });
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK }); // 1~2줄 이름 블록
    return w;
  })();
  return workerP;
}

export async function terminateOcr(): Promise<void> {
  if (!workerP) return;
  try { (await workerP).terminate(); } catch { /* noop */ }
  workerP = null;
}

// ── 전처리: 소스 캔버스의 nameBox를 잘라 이진화 캔버스로 ──────────────────────
export function preprocessNameBand(src: CanvasImageSource, rect: Rect, srcW: number, srcH: number): HTMLCanvasElement {
  const SCALE = 4, BORDER = 20;
  const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
  const w = Math.min(rect.w, srcW - x), h = Math.min(rect.h, srcH - y);
  const cw = Math.max(1, Math.round(w) * SCALE), ch = Math.max(1, Math.round(h) * SCALE);
  const c = document.createElement("canvas");
  c.width = cw + BORDER * 2; c.height = ch + BORDER * 2;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, x, y, w, h, BORDER, BORDER, cw, ch);
  const img = ctx.getImageData(BORDER, BORDER, cw, ch);
  const d = img.data;
  // 그레이 + 반전 + min/max 수집
  let mn = 255, mx = 0;
  const g = new Uint8Array(cw * ch);
  for (let p = 0, i = 0; p < cw * ch; p++, i += 4) {
    const v = 255 - (d[i] + d[i + 1] + d[i + 2]) / 3; // 반전
    g[p] = v; if (v < mn) mn = v; if (v > mx) mx = v;
  }
  const span = Math.max(1, mx - mn);
  // 오토콘트라스트 + Otsu
  const hist = new Uint32Array(256);
  for (let p = 0; p < g.length; p++) { const s = Math.round(((g[p] - mn) / span) * 255); g[p] = s; hist[s]++; }
  const thr = otsu(hist, g.length);
  for (let p = 0, i = 0; p < g.length; p++, i += 4) {
    const bw = g[p] > thr ? 0 : 255; // 글자(밝음→검정), 배경 흰
    d[i] = d[i + 1] = d[i + 2] = bw; d[i + 3] = 255;
  }
  ctx.putImageData(img, BORDER, BORDER);
  return c;
}

function otsu(hist: Uint32Array, total: number): number {
  let sumAll = 0; for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (wB === 0) continue;
    const wF = total - wB; if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

export async function ocrNameBand(src: CanvasImageSource, rect: Rect, srcW: number, srcH: number): Promise<string> {
  const w = await initOcr();
  const pre = preprocessNameBand(src, rect, srcW, srcH);
  const { data } = await w.recognize(pre);
  // 줄바꿈 유지 — match가 줄 단위로 나눠 이름 줄만 골라낸다(윗줄 셰브런/스킬 잡음 제거).
  return (data.text || "").trim();
}
