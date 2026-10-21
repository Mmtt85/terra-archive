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
/** 인식 모델 언어 — kor(한국어) · ch(중국어·일본어·영어). 테서랙트 언어 코드에서 고른다 */
export type RecLang = "kor" | "ch";
export const recLangOf = (tessLang: string): RecLang | null =>
  tessLang === "kor" ? "kor" : tessLang === "chi_sim" || tessLang === "jpn" || tessLang === "eng" ? "ch" : null;
type DetBox = [number, number, number, number, number];
let worker: Worker | null = null;
let broken = false;
let seq = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const waiting = new Map<number, (o: any) => void>();

function getWorker(): Worker | null {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL("./paddle-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<{ id: number; out?: Out; boxes?: DetBox[]; err?: string }>) => {
      if (ev.data.err) console.warn(`[lens] PaddleOCR ${ev.data.err}`);
      waiting.get(ev.data.id)?.(ev.data.boxes ?? ev.data.out ?? null);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ask(msg: { lang?: RecLang; warm?: boolean; chips?: { w: number; data: Float32Array }[]; detImg?: { w: number; h: number; data: Float32Array } }, transfer: Transferable[] = []): Promise<any> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((res) => {
    waiting.set(id, res);
    w.postMessage({ id, ...msg }, transfer);
  });
}

/** 공채 화면에 들어올 때·PRTS 공채 연결 때 미리 받아 둔다 (첫 인식이 모델 받는 시간을 기다리지 않게) */
export function warmPaddle(lang: RecLang = "kor"): void { void ask({ warm: true, lang }); }

const H = 48;

/** 캔버스의 칩 상자들을 읽는다 — [글자, 가장 낮은 글자 확률] 배열. 모델을 못 쓰면 null */
export async function paddleReadBoxes(src: CanvasImageSource, boxes: { x: number; y: number; w: number; h: number }[], maxW = 640, lang: RecLang = "kor"): Promise<Out> {
  if (!boxes.length) return [];
  if (!getWorker()) return null;
  const cc = document.createElement("canvas");
  const cx = cc.getContext("2d", { willReadFrequently: true })!;
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  const chips = boxes.map((b) => {
    const w = Math.max(16, Math.min(maxW, Math.round((b.w * H) / b.h)));
    cc.width = w; cc.height = H;
    cx.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, w, H);
    const px = cx.getImageData(0, 0, w, H).data;
    const plane = H * w;
    // ⚠ **BGR** 평면 순서(NCHW), (값 / 127.5) − 1 — PaddleOCR 은 OpenCV 로 읽은 BGR 로 학습했다 (모델 설정 inference.yml)
    const data = new Float32Array(3 * plane);
    for (let i = 0, p = 0; i < plane; i++, p += 4) {
      data[i] = px[p + 2] / 127.5 - 1;
      data[plane + i] = px[p + 1] / 127.5 - 1;
      data[2 * plane + i] = px[p] / 127.5 - 1;
    }
    return { w, data };
  });
  return ask({ chips, lang }, chips.map((c) => c.data.buffer));
}

/** 화면 전체 읽기 (통합전략 1차 판독, 2026-10-13 — tesseract PSM11 자리) — 검출로 글자 줄 상자를 찾고 줄마다 인식.
 *  돌려주는 줄은 위→아래, 같은 줄은 왼→오 순서이고 좌표는 src 기준. 검출 모델을 못 쓰면 null */
/** keepEmpty — 글자가 빈 상자도 돌려준다. 한국어 모델은 한자를 빈 글자로 내서, 버리면 중국어 화면의 이름표 상자가 통째로 사라진다
 *  (ocr.ts zh() 가 그 상자들을 중국어 모델로 다시 읽는다 — 틀렸어요 088cc·69a23927, 2026-10-22) */
export async function paddleReadFrame(src: HTMLCanvasElement, lang: RecLang = "kor", opts?: { keepEmpty?: boolean }): Promise<{ text: string; conf: number; x0: number; y0: number; x1: number; y1: number }[] | null> {
  if (!getWorker()) return null;
  const SW = src.width, SH = src.height;
  // 긴 변 960 (모델 설정 DetResizeForTest resize_long), 32 의 배수
  const r = 960 / Math.max(SW, SH);
  const dw = Math.max(32, Math.round((SW * r) / 32) * 32), dh = Math.max(32, Math.round((SH * r) / 32) * 32);
  const cc = document.createElement("canvas");
  cc.width = dw; cc.height = dh;
  const cx = cc.getContext("2d", { willReadFrequently: true })!;
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  cx.drawImage(src, 0, 0, dw, dh);
  const px = cx.getImageData(0, 0, dw, dh).data;
  const plane = dw * dh;
  // BGR, ImageNet 평균·편차 (inference.yml NormalizeImage — 채널 순서가 BGR 이라 mean[0] 이 B 몫)
  const data = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    data[i] = (px[p + 2] / 255 - 0.485) / 0.229;
    data[plane + i] = (px[p + 1] / 255 - 0.456) / 0.224;
    data[2 * plane + i] = (px[p] / 255 - 0.406) / 0.225;
  }
  const boxes: DetBox[] | null = await ask({ detImg: { w: dw, h: dh, data }, lang }, [data.buffer]);
  if (!boxes) return null;
  const sx = SW / dw, sy = SH / dh;
  const rects = boxes.map(([x, y, w, h]) => ({
    x: Math.max(0, Math.round(x * sx)), y: Math.max(0, Math.round(y * sy)),
    w: Math.max(1, Math.min(SW - Math.round(x * sx), Math.round(w * sx))), h: Math.max(1, Math.min(SH - Math.round(y * sy), Math.round(h * sy))),
  })).filter((b) => b.w >= 6 && b.h >= 6);
  if (!rects.length) return [];
  // 줄 순서 — 세로 가운데가 가까우면(줄 높이 반 안) 같은 줄로 보고 왼→오
  rects.sort((a, b) => {
    const ca = a.y + a.h / 2, cb = b.y + b.h / 2;
    return Math.abs(ca - cb) < Math.min(a.h, b.h) / 2 ? a.x - b.x : ca - cb;
  });
  const got = await paddleReadBoxes(src, rects, 2000, lang);
  if (!got) return null;
  return got.map((g, i) => ({ ...g, x0: rects[i].x, y0: rects[i].y, x1: rects[i].x + rects[i].w, y1: rects[i].y + rects[i].h }))
    .filter((l) => opts?.keepEmpty || l.text);
}
