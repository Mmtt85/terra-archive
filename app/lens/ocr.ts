// 스크린샷 렌즈 — 브라우저 OCR 래퍼 (tesseract.js, 에셋은 public/lens/ 자체 호스팅).
// 지연 로드: 렌즈 모달을 열어 실제 인식할 때만 워커·wasm·kor.traineddata(~9MB)를 내려받는다.
// PSM 11(sparse)+PSM 3(auto) 라인 합집합 — 스모크 검증(2026-07-23)으로 확정.
// (기본 PSM만 쓰면 맵 노드 화면 등 흩어진 텍스트가 전멸한다)

import { grayNormalize, upscaleFactor } from "./preprocess";
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

/** 스크린샷 Blob → OCR 텍스트 라인 배열. */
export async function ocrImage(blob: Blob): Promise<string[]> {
  const bmp = await createImageBitmap(blob);
  try {
    const scale = upscaleFactor(bmp.width);
    const W = bmp.width * scale, H = bmp.height * scale;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    grayNormalize(img.data);
    ctx.putImageData(img, 0, 0);

    const worker = await getWorker();
    await worker.setParameters({ tessedit_pageseg_mode: "11" as never }); // sparse
    const r11 = await worker.recognize(c);
    await worker.setParameters({ tessedit_pageseg_mode: "3" as never }); // auto
    const r3 = await worker.recognize(c);
    return [...(r11.data.lines ?? []), ...(r3.data.lines ?? [])]
      .map((l) => l.text.trim())
      .filter(Boolean);
  } finally {
    bmp.close();
  }
}

/** 모달 닫을 때 워커 정리 (다음 열림에서 재초기화). */
export async function disposeOcr(): Promise<void> {
  const p = workerP;
  workerP = null;
  if (p) {
    try { await (await p).terminate(); } catch { /* 이미 종료됨 */ }
  }
}
