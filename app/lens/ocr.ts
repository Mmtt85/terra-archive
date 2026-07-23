// 스샷 워프 — 브라우저 OCR 래퍼 (tesseract.js, 에셋은 public/lens/ 자체 호스팅).
// 지연 로드: 워프 모달을 열 때 warmOcr()로 미리 예열한다 (워커·wasm·kor.traineddata ~9MB).
//
// 단계형 세션 (속도 최적화 2026-07-23): PSM11(sparse)만 먼저 돌리고, 판정이 나면
// PSM3(auto)·칩 패스를 생략한다. 칩 패스(공채 태그 등 어두운 버튼 개별 OCR)는
// 화면 키워드가 보일 때만 — 오케스트레이션은 lens.tsx·verify-lens.ts가 동일 순서로 수행.

import { grayNormalize, upscaleFactor, findDarkChips, chipCropRect } from "./preprocess";
import type { Worker } from "tesseract.js";

let workerP: Promise<Worker> | null = null;

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
};

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
  const p = workerP;
  workerP = null;
  if (p) {
    try { await (await p).terminate(); } catch { /* 이미 종료됨 */ }
  }
}
