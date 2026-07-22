"use client";

// 오퍼 이름 OCR — tesseract.js(한국어)로 카드 이름 밴드의 글자를 읽는다. 100% 클라이언트:
// OCR은 브라우저 안(웹워커)에서 돌고, 화면 픽셀은 어디에도 전송되지 않는다(모델 파일만 1회 내려받음).
// 초상화 매칭(scanner-core)은 게임 카드 아트가 우리 아바타와 달라 실패 → 이름 OCR이 정식 식별자.
// tesseract.js는 무겁고 브라우저 전용이라 지연 import (플래너 번들·SSR 오염 방지).
import type { Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

// tesseract 워커/코어/언어데이터 위치. 기본은 CDN(jsdelivr + projectnaptha) — 코어 wasm 3변형이
// 20MB라 레포에 넣지 않는다. 사용자는 브라우저가 고른 1변형(~7MB)+한국어 모델(~1MB)만 1회
// 내려받아 캐시한다(화면 픽셀은 여전히 전송 안 함 — 모델 파일만). 오프라인·자체호스팅이 필요하면
// public/tess에 worker.min.js·코어 wasm·kor.traineddata.gz를 넣고 USE_LOCAL을 켠다.
const USE_LOCAL = false;
const LOCAL = { workerPath: "/tess/worker.min.js", corePath: "/tess", langPath: "/tess" };

export type OcrProgress = { status: string; progress: number };

export async function initOcr(onProgress?: (p: OcrProgress) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("kor", 1, {
        ...(USE_LOCAL ? LOCAL : {}),
        logger: onProgress ? (m: { status: string; progress: number }) => onProgress({ status: m.status, progress: m.progress ?? 0 }) : undefined,
      });
      // ⚠ PSM·whitelist는 워커 전역 상태 — 각 인식 함수(ocrWords/ocrName/ocrDigits)가
      // 호출마다 자기 파라미터를 설정한다 (안 그러면 직전 호출 모드가 새어든다 — 2026-07-22 버그)
      return worker;
    })();
  }
  return workerPromise;
}

export async function terminateOcr(): Promise<void> {
  if (workerPromise) { const w = await workerPromise; await w.terminate(); workerPromise = null; }
}

export type OcrWord = { text: string; x0: number; y0: number; x1: number; y1: number; conf: number };

// 전체 프레임을 한 번에 OCR해 단어+위치(프레임 픽셀 좌표)를 반환. 격자·크롭 없이 화면 어디의
// 글자든 찾는다(PSM 11 sparse). 호출부가 위치로 카드 이름을 묶어 매칭한다.
export async function ocrWords(frame: CanvasImageSource, fw: number, fh: number): Promise<OcrWord[]> {
  // 작은 글자 인식률 위해 목표 폭 ~2600으로 스케일(과확대 방지). 카드 이름이 작아 해상도가 관건.
  const scale = Math.min(2.4, Math.max(1, 2600 / fw));
  const cw = Math.round(fw * scale), ch = Math.round(fh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame, 0, 0, fw, fh, 0, 0, cw, ch);
  const worker = await initOcr();
  await worker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" } as unknown as never); // sparse — 흩어진 글자
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const words: OcrWord[] = [];
  const push = (w: { text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }) => {
    if (!w?.bbox || !w.text) return;
    words.push({ text: w.text, conf: w.confidence ?? 0, x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale });
  };
  const blocks = (data as { blocks?: unknown[] }).blocks ?? [];
  for (const b of blocks as Block[]) {
    for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const w of l.words ?? []) push(w);
  }
  return words;
}
type Block = { paragraphs?: { lines?: { words?: { text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] };

// 프레임의 (sx,sy,sw,sh) 이름 밴드를 전처리(3× 확대·그레이·반전) 후 OCR → 텍스트.
// 게임 UI는 밝은 글자/어두운 배경이라 반전해 어두운 글자/밝은 배경으로 만들면 인식률이 오른다.
export async function ocrName(frame: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): Promise<string> {
  const scale = 3;
  const cw = Math.max(8, Math.round(sw * scale));
  const ch = Math.max(8, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, cw, ch);
  const img = ctx.getImageData(0, 0, cw, ch);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); // 그레이 후 반전
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  const worker = await initOcr();
  await worker.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: "" } as unknown as never); // 한 줄
  const { data } = await worker.recognize(canvas);
  return (data.text || "").replace(/\s+/g, " ").trim();
}

// 레벨 숫자 전용 OCR — 영역을 확대·반전 후 숫자 화이트리스트(PSM 한 줄)로 읽는다.
// 1패스 sparse OCR이 레벨 원의 작은 숫자를 놓친 카드의 폴백. 1~90 범위만 유효.
export async function ocrDigits(frame: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): Promise<number | null> {
  const scale = 3;
  const cw = Math.max(8, Math.round(sw * scale));
  const ch = Math.max(8, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, cw, ch);
  const img = ctx.getImageData(0, 0, cw, ch);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  const worker = await initOcr();
  await worker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "0123456789" } as unknown as never);
  const { data } = await worker.recognize(canvas);
  // 후보 숫자들 중 1~90 범위의 최댓값 (레벨이 화면 내 최대 숫자 — "LV" 옆 잡음 억제)
  const nums = (data.text || "").match(/\d{1,2}/g) ?? [];
  let best: number | null = null;
  for (const s of nums) { const n = parseInt(s, 10); if (n >= 1 && n <= 90 && (best === null || n > best)) best = n; }
  return best;
}
