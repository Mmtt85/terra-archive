// 스샷 워프 — 브라우저 OCR 래퍼 (tesseract.js, 에셋은 public/lens/ 자체 호스팅).
// 지연 로드: 워프 모달을 열 때 warmOcr()로 미리 예열한다 (워커·wasm·kor.traineddata ~9MB).
//
// 단계형 세션 (속도 최적화 2026-07-23): PSM11(sparse)만 먼저 돌리고, 판정이 나면
// PSM3(auto)·칩 패스를 생략한다. 칩 패스(공채 태그 등 어두운 버튼 개별 OCR)는
// 화면 키워드가 보일 때만 — 오케스트레이션은 lens.tsx·verify-lens.ts가 동일 순서로 수행.

import { grayNormalize, upscaleFactor, findDarkChips, chipCropRect, binarizeGlyph, isolateGlyphs } from "./preprocess";
import type { Worker } from "tesseract.js";

let workerP: Promise<Worker> | null = null;
let digitWorkerP: Promise<Worker> | null = null; // 난이도 배지 숫자 전용 (eng — kor은 숫자를 한글로 읽음)
let chiWorkerP: Promise<Worker> | null = null;   // 중국어(흑류수해 CN 클라) 전용 — 필요할 때만 지연 로드

function getWorker(): Promise<Worker> {
  if (!workerP) {
    workerP = (async () => {
      // ⚠ 반드시 브라우저 전용 번들을 명시 import — 패키지 루트("tesseract.js")를 import하면
      // vinext가 package.json browser 필드를 무시하고 Node용 어댑터를 번들해, 캔버스 입력이
      // 워커에 전달되지 않아 OCR이 조용히 0줄을 반환한다 (2026-07-23 실브라우저 재현으로 확인).
      // esm.min.js는 CJS 래핑이라 default export 하나뿐 — 구조분해는 default에서 한다.
      const mod = await import("tesseract.js/dist/tesseract.esm.min.js");
      const { createWorker } = mod.default;
      return createWorker("kor", 1, {
        workerPath: "/lens/worker.min.js",
        corePath: "/lens", // 디렉토리 지정 → tesseract-core(-simd)-lstm.wasm.js를 알아서 선택
        langPath: "/lens",
        gzip: false, // kor.traineddata를 비압축 그대로 호스팅
      });
    })();
    workerP.catch(() => { workerP = null; }); // 로드 실패 시 다음 시도에서 재생성
  }
  return workerP;
}

// 난이도 숫자 전용 eng 워커 — kor LSTM은 단독 숫자를 한글 글리프로 오독하고,
// LSTM은 char_whitelist도 무시하므로 (실측 2026-07-24) 별도 모델이 필요하다.
function getDigitWorker(): Promise<Worker> {
  if (!digitWorkerP) {
    digitWorkerP = (async () => {
      const mod = await import("tesseract.js/dist/tesseract.esm.min.js");
      const { createWorker } = mod.default;
      const w = await createWorker("eng", 1, {
        workerPath: "/lens/worker.min.js",
        corePath: "/lens",
        langPath: "/lens",
        gzip: false,
      });
      await w.setParameters({ tessedit_pageseg_mode: "7" as never });
      return w;
    })();
    digitWorkerP.catch(() => { digitWorkerP = null; });
  }
  return digitWorkerP;
}

// 중국어 전용 워커 — kor 모델은 중국어 화면에서 한자를 한 글자도 못 읽으므로(실측: 전부
// 한글 쓰레기, 한자 0자) 흑류수해 CN 스크린샷은 chi_sim으로 별도 패스를 돌린다 (2026-07-24)
function getChiWorker(): Promise<Worker> {
  if (!chiWorkerP) {
    chiWorkerP = (async () => {
      const mod = await import("tesseract.js/dist/tesseract.esm.min.js");
      const { createWorker } = mod.default;
      const w = await createWorker("chi_sim", 1, {
        workerPath: "/lens/worker.min.js",
        corePath: "/lens",
        langPath: "/lens",
        gzip: false,
      });
      await w.setParameters({ tessedit_pageseg_mode: "11" as never });
      return w;
    })();
    chiWorkerP.catch(() => { chiWorkerP = null; });
  }
  return chiWorkerP;
}

/** 모달을 열자마자 호출해 워커·wasm·언어데이터를 예열한다 (첫 인식 체감 속도 개선). */
export async function warmOcr(): Promise<void> {
  try { await getWorker(); } catch { /* 실제 인식 시 재시도 */ }
}

export type OcrSession = {
  /** PSM11(sparse) 전체 프레임 — 흩어진 텍스트에 강함, 1차 패스 */
  sparse(): Promise<string[]>;
  /** 어두운 버튼 칩 개별 PSM7 — 공개모집 태그 등 (호출 측이 키워드로 게이트) */
  chips(): Promise<string[]>;
  /** PSM3(auto) 전체 프레임 — 1차로 판정 안 될 때만 폴백 */
  auto(): Promise<string[]>;
  /** 중국어(chi_sim) PSM11 전체 프레임 — kor 매칭이 무신호일 때만 (흑류수해 CN 스크린샷) */
  zh(): Promise<string[]>;
  /** 좌하단 난이도 배지(육각형 숫자) — 있으면 0~18 반환, 없으면 null */
  difficulty(): Promise<number | null>;
};

/** 좌하단 난이도 배지(육각형) 크롭 영역 (통합전략 화면 공통 위치) — f6 실측 캘리브레이션 */
export const DIFF_REGION = { x: 0.012, y: 0.95, w: 0.032, h: 0.05 } as const;

/** OCR 텍스트에서 난이도 숫자 파싱 — 0~18 한정, 그 외는 배지 없음으로 간주 */
export function parseDifficulty(text: string, confidence: number): number | null {
  if (confidence < 40) return null;
  const m = (text ?? "").match(/(\d{1,2})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 0 && n <= 18 ? n : null;
}

async function setPsm(worker: Worker, psm: string): Promise<void> {
  await worker.setParameters({ tessedit_pageseg_mode: psm as never });
}

/** 스크린샷 Blob → 전처리 캔버스를 쥔 단계형 OCR 세션. */
export async function createOcrSession(blob: Blob): Promise<OcrSession> {
  const bmp = await createImageBitmap(blob);
  const scale = upscaleFactor(bmp.width);
  const W = bmp.width * scale, H = bmp.height * scale;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close();
  const img = ctx.getImageData(0, 0, W, H);
  grayNormalize(img.data);
  ctx.putImageData(img, 0, 0);
  const worker = await getWorker();

  // 출력은 blocks(→lines)만 생성 — 기본값의 hocr·tsv 생성 비용을 끈다 (속도)
  const OUT = { blocks: true, text: false, hocr: false, tsv: false } as const;

  return {
    async sparse() {
      await setPsm(worker, "11");
      const r = await worker.recognize(c, {}, OUT);
      return (r.data.lines ?? []).map((l) => l.text.trim()).filter(Boolean);
    },
    async auto() {
      await setPsm(worker, "3");
      const r = await worker.recognize(c, {}, OUT);
      return (r.data.lines ?? []).map((l) => l.text.trim()).filter(Boolean);
    },
    async zh() {
      const zw = await getChiWorker();
      const r = await zw.recognize(c, {}, OUT);
      return (r.data.lines ?? []).map((l) => l.text.trim()).filter(Boolean);
    },
    async difficulty() {
      // 좌하단 코너를 1:1로 잘라 이진화 → nearest 4배 확대 → eng 워커 한 줄 OCR.
      // ⚠ 확대 후 이진화하면 리샘플링 방식(canvas bilinear vs sharp lanczos)에 따라 결과가
      // 갈린다 — 1:1 이진화 + nearest 확대는 결정적이라 브라우저·하네스가 일치 (실측 90%).
      // kor은 단독 숫자를 한글로 오독하므로 eng 전용 워커를 쓴다 (2026-07-24)
      const x = Math.round(W * DIFF_REGION.x), y = Math.round(H * DIFF_REGION.y);
      const w = Math.round(W * DIFF_REGION.w), h = Math.min(Math.round(H * DIFF_REGION.h), H - y);
      const c1 = document.createElement("canvas");
      c1.width = w; c1.height = h;
      const c1x = c1.getContext("2d", { willReadFrequently: true })!;
      c1x.drawImage(c, x, y, w, h, 0, 0, w, h);
      const cimg = c1x.getImageData(0, 0, w, h);
      binarizeGlyph(cimg.data);
      // 가장자리 침입 아트 노이즈 제거 — 글리프가 하나도 안 남으면 배지 없음 (OCR 생략)
      if (isolateGlyphs(cimg.data, w, h) === 0) {
        console.debug(`[lens] 난이도 OCR: 글리프 없음 (배지 미검출)`);
        return null;
      }
      c1x.putImageData(cimg, 0, 0);
      const cc = document.createElement("canvas");
      cc.width = w * 4; cc.height = h * 4;
      const cctx = cc.getContext("2d")!;
      cctx.imageSmoothingEnabled = false; // nearest
      cctx.drawImage(c1, 0, 0, w * 4, h * 4);
      const dw = await getDigitWorker();
      const r = await dw.recognize(cc, {}, { blocks: false, text: true, hocr: false, tsv: false });
      console.debug(`[lens] 난이도 OCR: "${(r.data.text ?? "").trim()}" ${Math.round(r.data.confidence ?? 0)}%`);
      return parseDifficulty(r.data.text ?? "", r.data.confidence ?? 0);
    },
    async chips() {
      const boxes = findDarkChips(img.data, W, H);
      if (!boxes.length) return [];
      await setPsm(worker, "7");
      const out: string[] = [];
      const cc = document.createElement("canvas");
      const cctx = cc.getContext("2d", { willReadFrequently: true })!;
      for (const b of boxes) {
        // ⚠ 바깥 패딩 금지 — 흰 여백이 들어가면 이진화 극성이 뒤집혀 0%가 된다 (인셋 크롭)
        const r = chipCropRect(b, W, H);
        if (!r) continue;
        cc.width = r.w; cc.height = r.h;
        cctx.drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        const r7 = await worker.recognize(cc, {}, { blocks: false, text: true, hocr: false, tsv: false });
        const txt = (r7.data.text ?? "").trim();
        if (txt) out.push(...txt.split("\n").map((l) => l.trim()).filter(Boolean));
      }
      return out;
    },
  };
}

/** 모달 닫을 때 워커 정리 (다음 열림에서 재초기화). */
export async function disposeOcr(): Promise<void> {
  const p = workerP, dp = digitWorkerP, cp = chiWorkerP;
  workerP = null;
  digitWorkerP = null;
  chiWorkerP = null;
  if (p) {
    try { await (await p).terminate(); } catch { /* 이미 종료됨 */ }
  }
  if (dp) {
    try { await (await dp).terminate(); } catch { /* 이미 종료됨 */ }
  }
  if (cp) {
    try { await (await cp).terminate(); } catch { /* 이미 종료됨 */ }
  }
}
