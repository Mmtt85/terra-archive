"use client";

// 전략(밴드) 아이콘 템플릿 로더 — **브라우저 전용** 환경 의존부 (fetch · createImageBitmap · OffscreenCanvas).
// 계산은 전부 acband.ts(순수)에 있다. node 하네스(scripts/verify-ac/band.ts)는 sharp 로 디코드해 같은
// bandTemplate() 을 부른다 — 디코드 방법만 다르고 크롭·축소·특징은 pix.ts 로 같다.
//
// 아이콘은 public/ac/band/<id>.webp(180×180, 알파) → 운영에선 asset() 으로 R2 에서 받는다 (CORS 허용 확인됨).
// 반투명 홀로그램 픽셀이 많아(저스틴 아이콘의 77%) **검은 배경 위에 그린 뒤** getImageData 한다 —
// 브라우저가 프리멀티플라이 공간에서 정확히 합성하고, 투명 캔버스의 언프리멀티플라이 반올림을 피한다.
// node 쪽은 resampleRgb 가 알파를 검정 위에 실수로 합성하므로 두 경로는 1/255 안에서 같다.
//
// 40개 × Float32Array(2048) ≈ 330KB — 모듈 캐시에 한 번만 만든다. 동시 요청 6개.

import { asset } from "../assets";
import { bandTemplate } from "./acband";
import type { Raster } from "./pix";

const CONCURRENCY = 6;
const cache = new Map<string, Promise<Float32Array>>();

let active = 0;
const waiting: (() => void)[] = [];
function acquire(): Promise<void> {
  if (active < CONCURRENCY) { active++; return Promise.resolve(); }
  return new Promise((r) => waiting.push(() => { active++; r(); }));
}
function release(): void {
  active--;
  waiting.shift()?.();
}

async function decode(id: string): Promise<Float32Array> {
  await acquire();
  try {
    const res = await fetch(asset(`/ac/band/${id}.webp`));
    if (!res.ok) throw new Error(`band icon ${id}: HTTP ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    try {
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("OffscreenCanvas 2d context 없음");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, bmp.width, bmp.height);
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
      const raster: Raster = { data: img.data, width: img.width, height: img.height, channels: 4 };
      return bandTemplate(raster);
    } finally {
      bmp.close();
    }
  } finally {
    release();
  }
}

function get(id: string): Promise<Float32Array> {
  let p = cache.get(id);
  if (!p) {
    p = decode(id);
    p.catch(() => { cache.delete(id); });   // 실패하면 다음 호출에서 다시 받는다
    cache.set(id, p);
  }
  return p;
}

/** ids(autochess.json bands[].id) 의 템플릿 맵 — searchBand 의 tpl 인자. 하나라도 실패하면 throw (부분 맵은 오답을 낳는다). */
export async function loadBandTemplates(ids: string[]): Promise<Map<string, Float32Array>> {
  const feats = await Promise.all(ids.map(get));
  const out = new Map<string, Float32Array>();
  ids.forEach((id, i) => out.set(id, feats[i]));
  return out;
}

/** 미리 받아 두기 (모달을 열 때 등) — 실패는 조용히 무시, 실제 사용 시 loadBandTemplates 가 다시 시도한다 */
export function warmBandTemplates(ids: string[]): void {
  loadBandTemplates(ids).catch(() => {});
}
