// 픽셀 공용 유틸 — **환경 무관** 리샘플·특징 (브라우저 canvas 와 node sharp 가 서로 다른 보간을 쓰면
// 같은 화면에서 다른 특징이 나와 하네스와 실제가 어긋난다. 그래서 크롭→축소는 여기 순수 JS 로만 한다).
// 위수 협의 얼굴 매칭(acface.ts)·전략 아이콘 매칭(acband.ts)이 쓴다. React·DOM 무의존.

/** 원시 래스터 — RGBA(4) 또는 RGB(3) 인터리브 */
export type Raster = { data: Uint8ClampedArray | Uint8Array; width: number; height: number; channels: 3 | 4 };

/**
 * 원본의 실수 영역(sx, sy, sw, sh — 래스터 밖으로 나가도 된다)을 S×S **RGB(3ch)** 로 리샘플한다.
 * 출력 픽셀마다 k×k 서브샘플을 bilinear 로 읽어 평균한다 (축소 시 앨리어싱 억제).
 * 알파가 있으면 bg 위에 합성하고, 래스터 밖은 bg 로 채운다 (초상 템플릿의 투명 여백이 그렇다).
 */
export function resampleRgb(src: Raster, sx: number, sy: number, sw: number, sh: number, S: number,
  bg: [number, number, number] = [0, 0, 0], supersample?: number): Uint8Array {
  const { data, width: W, height: H, channels: C } = src;
  const out = new Uint8Array(S * S * 3);
  const scale = Math.max(sw, sh) / S;
  const k = supersample ?? Math.max(1, Math.min(4, Math.ceil(scale)));
  const inv = 1 / (k * k);
  const px = (x: number, y: number, acc: Float64Array) => {
    // bilinear — 화소 중심 좌표계 (x−0.5)
    const fx = x - 0.5, fy = y - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < 2; j++) {
      const yy = y0 + j, wy = j ? ty : 1 - ty;
      if (wy === 0) continue;
      for (let i = 0; i < 2; i++) {
        const xx = x0 + i, wx = i ? tx : 1 - tx;
        if (wx === 0) continue;
        const w = wx * wy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) { r += bg[0] * w; g += bg[1] * w; b += bg[2] * w; continue; }
        const p = (yy * W + xx) * C;
        const a = C === 4 ? data[p + 3] / 255 : 1;
        r += (data[p] * a + bg[0] * (1 - a)) * w;
        g += (data[p + 1] * a + bg[1] * (1 - a)) * w;
        b += (data[p + 2] * a + bg[2] * (1 - a)) * w;
      }
    }
    acc[0] += r; acc[1] += g; acc[2] += b;
  };
  const acc = new Float64Array(3);
  for (let oy = 0; oy < S; oy++) {
    for (let ox = 0; ox < S; ox++) {
      acc[0] = acc[1] = acc[2] = 0;
      for (let jy = 0; jy < k; jy++) {
        const y = sy + ((oy + (jy + 0.5) / k) / S) * sh;
        for (let jx = 0; jx < k; jx++) {
          const x = sx + ((ox + (jx + 0.5) / k) / S) * sw;
          px(x, y, acc);
        }
      }
      const o = (oy * S + ox) * 3;
      out[o] = Math.round(acc[0] * inv); out[o + 1] = Math.round(acc[1] * inv); out[o + 2] = Math.round(acc[2] * inv);
    }
  }
  return out;
}

/** RGB(3ch) S×S → 휘도 Float32 (0~255) */
export function grayOf(rgb: Uint8Array, S: number): Float32Array {
  const g = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) g[i] = rgb[i * 3] * 0.299 + rgb[i * 3 + 1] * 0.587 + rgb[i * 3 + 2] * 0.114;
  return g;
}

/** 평균 0 · 노름 1 (제자리 아님 — 새 배열). 전부 같은 값이면 0 벡터. */
export function znorm(v: Float32Array): Float32Array {
  let m = 0;
  for (let i = 0; i < v.length; i++) m += v[i];
  m /= v.length || 1;
  const o = new Float32Array(v.length);
  let ss = 0;
  for (let i = 0; i < v.length; i++) { o[i] = v[i] - m; ss += o[i] * o[i]; }
  const inv = ss > 0 ? 1 / Math.sqrt(ss) : 0;
  for (let i = 0; i < v.length; i++) o[i] *= inv;
  return o;
}

/** 내적 (같은 길이 전제) */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** 소벨 기울기 (gx, gy) — 테두리 1픽셀은 0 */
export function sobel(g: Float32Array, S: number): { gx: Float32Array; gy: Float32Array } {
  const gx = new Float32Array(S * S), gy = new Float32Array(S * S);
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      gx[i] = (g[i + 1] - g[i - 1]) * 2 + (g[i - S + 1] - g[i - S - 1]) + (g[i + S + 1] - g[i + S - 1]);
      gy[i] = (g[i + S] - g[i - S]) * 2 + (g[i + S - 1] - g[i - S - 1]) + (g[i + S + 1] - g[i - S + 1]);
    }
  }
  return { gx, gy };
}
