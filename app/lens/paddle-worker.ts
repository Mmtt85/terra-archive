// PaddleOCR 인식 작업 스레드 — app/lens/paddle.ts 가 띄운다 (2026-10-13).
// 모델 실행을 화면 스레드 밖으로 뺀다: 게임을 하는 동안 사이트 탭은 늘 뒤에 있는데, 크롬은 가려진 탭의 화면 스레드 작업을
// 늦춰 칩 하나에 백수십 ms 씩 붙었다(실측). 작업 스레드는 그렇게 늦춰지지 않고, 인식 중에도 사이트 화면이 굳지 않는다.
// 받는 것: { id, chips: { w, data: Float32Array(3×48×w, 정규화 끝) }[] } → 보내는 것: { id, out: { text, conf }[] | null }
import type { InferenceSession, Tensor } from "onnxruntime-web";
import { asset } from "../assets";

type Ort = typeof import("onnxruntime-web");
type Rec = { ort: Ort; sess: InferenceSession; dict: string[]; det: InferenceSession | null };
let recP: Promise<Rec | null> | null = null;
let lastErr = "";
let gpuOn = false;   // WebGPU 로 돈다 — 묶음을 크게(그래픽 카드는 크게 묶을수록 빠르다)   // 실패 이유 — 화면 쪽 콘솔로 돌려보낸다 (작업 스레드 콘솔은 페이지 콘솔에 안 잡힌다)

function loadRec(): Promise<Rec | null> {
  recP ??= (async () => {
    try {
      // 그래픽 카드(WebGPU)가 있으면 그쪽 판으로 — CPU 1스레드로는 화면 전체 읽기(줄 100여 개)가 3초였다. 없으면 CPU 판
      const gpu = !!(self.navigator as unknown as { gpu?: unknown }).gpu;
      const ort = (gpu ? await import("onnxruntime-web/webgpu") : await import("onnxruntime-web/wasm")) as unknown as Ort;
      const eps = gpu ? ["webgpu", "wasm"] : ["wasm"];
      gpuOn = gpu;
      // 스레드 판은 crossOriginIsolated(SharedArrayBuffer)가 있어야 해서 1스레드로. 파일은 우리 R2 에서
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = asset("/lens/ort/");
      const [model, dictTxt] = await Promise.all([
        fetch(asset("/lens/paddle/kor_rec.onnx")).then((r) => { if (!r.ok) throw new Error(`model ${r.status}`); return r.arrayBuffer(); }),
        fetch(asset("/lens/paddle/kor_dict.txt")).then((r) => { if (!r.ok) throw new Error(`dict ${r.status}`); return r.text(); }),
      ]);
      const sess = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: eps });
      // 검출 모델(PP-OCRv5 mobile det, 4.8MB) — 화면 전체 읽기(통합전략)에만 쓴다. 못 받으면 인식(칩)만 된다
      let det: InferenceSession | null = null;
      try {
        const dm = await fetch(asset("/lens/paddle/det.onnx")).then((r) => { if (!r.ok) throw new Error(`det ${r.status}`); return r.arrayBuffer(); });
        det = await ort.InferenceSession.create(new Uint8Array(dm), { executionProviders: eps });
      } catch (e) { console.warn("[lens] PaddleOCR 검출 모델 로드 실패", e); lastErr = `검출 모델 로드 실패: ${String((e as Error)?.message ?? e)}`; }
      // 출력 0번 = CTC 빈칸, 1..N = 글자 목록 줄, 맨 끝 = 공백
      const lines = dictTxt.split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      return { ort, sess, dict: ["", ...lines, " "], det };
    } catch (e) {
      console.warn("[lens] PaddleOCR 로드 실패", e);
      lastErr = `로드 실패: ${String((e as Error)?.message ?? e)}`;
      recP = null;   // 다음 요청에서 다시 시도
      return null;
    }
  })();
  return recP;
}

const H = 48;

/** 검출 — 글자일 확률 지도(DB) → 문턱 0.3 이진화 → 연결 성분마다 상자 → 평균 확률 0.6 미만 버림 → 넓히기(unclip 1.5).
 *  게임 글자는 늘 가로라 회전 상자 대신 축 정렬 상자로 충분하다. 좌표는 검출 입력(w×h) 기준 */
function detBoxes(prob: Float32Array, w: number, h: number): [number, number, number, number, number][] {
  const lab = new Int32Array(w * h).fill(-1);
  const out: [number, number, number, number, number][] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (lab[i] !== -1 || prob[i] <= 0.3) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, sum = 0, n = 0;
    lab[i] = 0; stack.push(i);
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % w, y = (k - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      sum += prob[k]; n++;
      if (x > 0 && lab[k - 1] === -1 && prob[k - 1] > 0.3) { lab[k - 1] = 0; stack.push(k - 1); }
      if (x < w - 1 && lab[k + 1] === -1 && prob[k + 1] > 0.3) { lab[k + 1] = 0; stack.push(k + 1); }
      if (y > 0 && lab[k - w] === -1 && prob[k - w] > 0.3) { lab[k - w] = 0; stack.push(k - w); }
      if (y < h - 1 && lab[k + w] === -1 && prob[k + w] > 0.3) { lab[k + w] = 0; stack.push(k + w); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < 3 || bh < 3 || sum / n < 0.6) continue;
    const d = (bw * bh * 1.5) / (2 * (bw + bh));
    const nx0 = Math.max(0, x0 - d), ny0 = Math.max(0, y0 - d);
    out.push([nx0, ny0, Math.min(w, x1 + 1 + d) - nx0, Math.min(h, y1 + 1 + d) - ny0, sum / n]);
  }
  return out;
}

self.onmessage = async (ev: MessageEvent<{ id: number; warm?: boolean; chips?: { w: number; data: Float32Array }[]; detImg?: { w: number; h: number; data: Float32Array } }>) => {
  const { id, warm, chips, detImg } = ev.data;
  const rec = await loadRec();
  if (detImg) {
    if (!rec?.det) { self.postMessage({ id, out: null, err: lastErr }); return; }
    try {
      const res = await rec.det.run({ [rec.det.inputNames[0]]: new rec.ort.Tensor("float32", detImg.data, [1, 3, detImg.h, detImg.w]) });
      const o = res[rec.det.outputNames[0]] as Tensor;
      self.postMessage({ id, boxes: detBoxes(o.data as Float32Array, detImg.w, detImg.h) });
    } catch (e) { lastErr = `검출 실패: ${String((e as Error)?.message ?? e)}`; self.postMessage({ id, out: null, err: lastErr }); }
    return;
  }
  if (warm || !chips) { self.postMessage({ id, out: rec ? [] : null }); return; }
  if (!rec) { self.postMessage({ id, out: null, err: lastErr }); return; }
  const { ort, sess, dict } = rec;
  try {
    // 폭이 비슷한 것끼리(가장 넓은 것이 가장 좁은 것의 1.15배 안, 16개까지) 묶어 한 번에 — 하나씩 118번 돌리면 3초였다.
    // ⚠ 폭이 크게 다른 것까지 한 묶음으로 채우면 채운 여백 때문에 신뢰도가 떨어졌다('메딕' 50 → 22) — 그래서 비슷한 폭끼리만
    const out: { text: string; conf: number }[] = new Array(chips.length);
    const order = chips.map((_, i) => i).sort((a, b) => chips[a].w - chips[b].w);
    const decode = (prob: Float32Array, T: number, C: number, n: number, Tn: number) => {
      let text = "", last = -1, conf = 1;
      for (let s = 0; s < Tn; s++) {
        let bi = 0, bv = -1;
        for (let k = 0, base = (n * T + s) * C; k < C; k++) { const v = prob[base + k]; if (v > bv) { bv = v; bi = k; } }
        if (bi !== last && bi !== 0) { text += dict[bi] ?? ""; if (bv < conf) conf = bv; }
        last = bi;
      }
      return { text: text.trim(), conf: text ? conf : 0 };
    };
    for (let a = 0; a < order.length;) {
      let b = a + 1;
      while (b < order.length && b - a < (gpuOn ? 48 : 16) && chips[order[b]].w <= chips[order[a]].w * (gpuOn ? 1.3 : 1.15)) b++;
      const group = order.slice(a, b);
      const maxW = Math.max(...group.map((g) => chips[g].w));
      const plane = H * maxW;
      const t = new Float32Array(group.length * 3 * plane);   // 0 = 정규화 뒤 회색 — 채움값
      group.forEach((g, n) => {
        const c = chips[g], cp = H * c.w;
        for (let ch = 0; ch < 3; ch++) for (let y = 0; y < H; y++)
          t.set(c.data.subarray(ch * cp + y * c.w, ch * cp + (y + 1) * c.w), n * 3 * plane + ch * plane + y * maxW);
      });
      const res = await sess.run({ [sess.inputNames[0]]: new ort.Tensor("float32", t, [group.length, 3, H, maxW]) });
      const o = res[sess.outputNames[0]] as Tensor;
      const [, T, C] = o.dims as number[];
      group.forEach((g, n) => { out[g] = decode(o.data as Float32Array, T, C, n, Math.min(T, Math.ceil((T * chips[g].w) / maxW) + 1)); });
      a = b;
    }
    self.postMessage({ id, out });
  } catch (e) {
    lastErr = `인식 실패: ${String((e as Error)?.message ?? e)}`;
    self.postMessage({ id, out: null, err: lastErr });
  }
};
