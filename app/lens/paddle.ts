// 공채 태그 칩 OCR — PaddleOCR(PP-OCRv5 한국어 mobile 인식 모델) + ONNX Runtime Web (2026-10-13)
//
// 왜: tesseract 는 어두운 칩 위 흰 글자를 자주 뭉갰다('가드' → '리도', 흑백+2배 재시도로 땜질) 데다 칩 하나에 1초 안팎이라
// 칩 16개짜리 화면이 17초까지 걸렸다. 틀렸어요 화면 2장 비교에서 PaddleOCR 은 태그 10개 중 9개를 바로 읽었고(나머지 하나
// '메딕'은 '메덕'으로 — 한 글자 틀림은 match.ts detectRecruitTags 가 받아 준다) 화면 하나에 0.2~0.5초였다.
//
// 구조: 칩 위치는 종전대로 findDarkChips 가 찾는다 — PaddleOCR 의 검출 모델은 쓰지 않고 **인식 모델만** (13MB).
// 여기(화면 스레드)서 칩을 높이 48px 로 잘라 정규화하고, 모델 실행·글자 풀기는 작업 스레드(paddle-worker.ts)가 한다.
// 에셋: /lens/paddle/kor_rec.onnx·kor_dict.txt (모델·글자 목록, Apache-2.0 — monkt/paddleocr-onnx 변환본),
//       /lens/ort/ort-wasm-simd-threaded.{wasm,mjs} (ONNX Runtime Web 1.30 CPU 판). R2 에서 서빙(scripts/r2-sync.mjs).
// 한국어 화면만 — 영·일 공채는 tesseract 그대로. 로드·실행이 실패하면 null 을 돌려 부르는 쪽이 tesseract 로 물러난다.

type Out = { text: string; conf: number }[] | null;
let worker: Worker | null = null;
let broken = false;
let seq = 0;
const waiting = new Map<number, (o: Out) => void>();

function getWorker(): Worker | null {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL("./paddle-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<{ id: number; out: Out }>) => {
      waiting.get(ev.data.id)?.(ev.data.out);
      waiting.delete(ev.data.id);
    };
    worker.onerror = (e) => {
      console.warn("[lens] PaddleOCR 작업 스레드 오류 — tesseract 로 읽는다", e);
      broken = true; worker?.terminate(); worker = null;
      for (const f of waiting.values()) f(null);
      waiting.clear();
    };
  } catch (e) {
    console.warn("[lens] PaddleOCR 작업 스레드를 못 띄움 — tesseract 로 읽는다", e);
    broken = true;
  }
  return worker;
}

function ask(msg: { warm?: boolean; chips?: { w: number; data: Float32Array }[] }, transfer: Transferable[] = []): Promise<Out> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((res) => {
    waiting.set(id, res);
    w.postMessage({ id, ...msg }, transfer);
  });
}

/** 공채 화면에 들어올 때·PRTS 공채 연결 때 미리 받아 둔다 (첫 인식이 모델 받는 시간을 기다리지 않게) */
export function warmPaddle(): void { void ask({ warm: true }); }

const H = 48;

/** 캔버스의 칩 상자들을 읽는다 — [글자, 가장 낮은 글자 확률] 배열. 모델을 못 쓰면 null */
export async function paddleReadBoxes(src: CanvasImageSource, boxes: { x: number; y: number; w: number; h: number }[]): Promise<Out> {
  if (!boxes.length) return [];
  if (!getWorker()) return null;
  const cc = document.createElement("canvas");
  const cx = cc.getContext("2d", { willReadFrequently: true })!;
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  const chips = boxes.map((b) => {
    const w = Math.max(16, Math.min(640, Math.round((b.w * H) / b.h)));
    cc.width = w; cc.height = H;
    cx.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, w, H);
    const px = cx.getImageData(0, 0, w, H).data;
    const plane = H * w;
    const data = new Float32Array(3 * plane);   // RGB 평면 순서(NCHW), (값 / 127.5) − 1
    for (let i = 0, p = 0; i < plane; i++, p += 4) {
      data[i] = px[p] / 127.5 - 1;
      data[plane + i] = px[p + 1] / 127.5 - 1;
      data[2 * plane + i] = px[p + 2] / 127.5 - 1;
    }
    return { w, data };
  });
  return ask({ chips }, chips.map((c) => c.data.buffer));
}
