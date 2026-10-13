// PaddleOCR 인식 작업 스레드 — app/lens/paddle.ts 가 띄운다 (2026-10-13).
// 모델 실행을 화면 스레드 밖으로 뺀다: 게임을 하는 동안 사이트 탭은 늘 뒤에 있는데, 크롬은 가려진 탭의 화면 스레드 작업을
// 늦춰 칩 하나에 백수십 ms 씩 붙었다(실측). 작업 스레드는 그렇게 늦춰지지 않고, 인식 중에도 사이트 화면이 굳지 않는다.
// 받는 것: { id, chips: { w, data: Float32Array(3×48×w, 정규화 끝) }[] } → 보내는 것: { id, out: { text, conf }[] | null }
import type { InferenceSession, Tensor } from "onnxruntime-web";
import { asset } from "../assets";

type Ort = typeof import("onnxruntime-web");
type Rec = { ort: Ort; sess: InferenceSession; dict: string[] };
let recP: Promise<Rec | null> | null = null;

function loadRec(): Promise<Rec | null> {
  recP ??= (async () => {
    try {
      const ort = (await import("onnxruntime-web/wasm")) as unknown as Ort;
      // 스레드 판은 crossOriginIsolated(SharedArrayBuffer)가 있어야 해서 1스레드로. 파일은 우리 R2 에서
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = asset("/lens/ort/");
      const [model, dictTxt] = await Promise.all([
        fetch(asset("/lens/paddle/kor_rec.onnx")).then((r) => { if (!r.ok) throw new Error(`model ${r.status}`); return r.arrayBuffer(); }),
        fetch(asset("/lens/paddle/kor_dict.txt")).then((r) => { if (!r.ok) throw new Error(`dict ${r.status}`); return r.text(); }),
      ]);
      const sess = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ["wasm"] });
      // 출력 0번 = CTC 빈칸, 1..N = 글자 목록 줄, 맨 끝 = 공백
      const lines = dictTxt.split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      return { ort, sess, dict: ["", ...lines, " "] };
    } catch (e) {
      console.warn("[lens] PaddleOCR 로드 실패", e);
      recP = null;   // 다음 요청에서 다시 시도
      return null;
    }
  })();
  return recP;
}

const H = 48;

self.onmessage = async (ev: MessageEvent<{ id: number; warm?: boolean; chips?: { w: number; data: Float32Array }[] }>) => {
  const { id, warm, chips } = ev.data;
  const rec = await loadRec();
  if (warm || !chips) { self.postMessage({ id, out: rec ? [] : null }); return; }
  if (!rec) { self.postMessage({ id, out: null }); return; }
  const { ort, sess, dict } = rec;
  try {
    const out: { text: string; conf: number }[] = [];
    // ⚠ 칩마다 따로 — 묶어 넣으면 폭을 맞추느라 채운 여백 때문에 신뢰도가 떨어졌다('메딕' 50 → 22, 2026-10-13 실측)
    for (const c of chips) {
      const res = await sess.run({ [sess.inputNames[0]]: new ort.Tensor("float32", c.data, [1, 3, H, c.w]) });
      const o = res[sess.outputNames[0]] as Tensor;
      const [, T, C] = o.dims as number[];
      const prob = o.data as Float32Array;
      // 칸마다 가장 큰 확률의 글자 → CTC 규칙(연속 같은 글자 하나로·빈칸 지움)
      let text = "", last = -1, conf = 1;
      for (let s = 0; s < T; s++) {
        let bi = 0, bv = -1;
        for (let k = 0, base = s * C; k < C; k++) { const v = prob[base + k]; if (v > bv) { bv = v; bi = k; } }
        if (bi !== last && bi !== 0) { text += dict[bi] ?? ""; if (bv < conf) conf = bv; }
        last = bi;
      }
      out.push({ text: text.trim(), conf: text ? conf : 0 });
    }
    self.postMessage({ id, out });
  } catch (e) {
    console.warn("[lens] PaddleOCR 실행 실패", e);
    self.postMessage({ id, out: null });
  }
};
