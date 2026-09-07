"use client";
// 위수 협의 얼굴 템플릿 로더 — 기물 초상(없으면 아바타)을 R2 에서 받아 acface.templateFeatures 로 특징을 만든다.
// (환경 의존부만 여기 — fetch · createImageBitmap · OffscreenCanvas. 계산은 acface.ts 순수 함수)
//
// 파일 우선순위: /skin/portrait/<op>_2.webp → _1 → /avatars/<op>.webp (2026-09-07 기준 121종 중 초상이 없는
// 것은 char_616_pithst 하나 — 아바타 폴백). 404 판정은 res.ok. 실패한 op 은 결과 Map 에서 빠지고 캐시도
// 비워 다음 호출에서 다시 시도한다 (한 장 못 받았다고 밴 인식 전체를 막지 않는다).
// op 별 Promise 를 모듈 캐시에 두고 동시 요청은 6개로 묶는다 (121장 · 각 10~20KB).

import { asset } from "../assets";
import { templateFeatures } from "./acface";
import type { Raster } from "./pix";

const CONCURRENCY = 6;
/** 기본 지터 여부 — 하네스 실측(scripts/verify-ac/face.ts)으로 정했다. acface.ts 머리글 참고. */
export const FACE_JITTER_DEFAULT = false;

const cache = new Map<string, Promise<Float32Array[]>>();   // key = `${op}|${jitter ? 1 : 0}`

async function fetchRaster(op: string): Promise<Raster> {
  const paths = [`/skin/portrait/${op}_2.webp`, `/skin/portrait/${op}_1.webp`, `/avatars/${op}.webp`];
  for (const path of paths) {
    const res = await fetch(asset(path));
    if (!res.ok) continue;
    const bmp = await createImageBitmap(await res.blob());
    try {
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = cv.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas 2d 컨텍스트 없음");
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
      return { data: img.data, width: img.width, height: img.height, channels: 4 };
    } finally {
      bmp.close();
    }
  }
  throw new Error(`얼굴 템플릿 이미지 없음: ${op}`);
}

function templateOf(op: string, jitter: boolean): Promise<Float32Array[]> {
  const key = `${op}|${jitter ? 1 : 0}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchRaster(op).then((r) => templateFeatures(r, jitter));
    p.catch(() => { cache.delete(key); });   // 실패는 캐시에 남기지 않는다
    cache.set(key, p);
  }
  return p;
}

/**
 * op 목록의 템플릿 특징을 받아 Map(op → Float32Array[]) 으로. 못 받은 op 은 빠진다 (console.warn).
 * 동시 6개 · 모듈 캐시 — 같은 op 을 다시 요청하면 네트워크를 타지 않는다.
 */
export async function loadFaceTemplates(ops: string[], opts?: { jitter?: boolean }): Promise<Map<string, Float32Array[]>> {
  const jitter = opts?.jitter ?? FACE_JITTER_DEFAULT;
  const out = new Map<string, Float32Array[]>();
  const queue = [...new Set(ops)];
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const op = queue[next++];
      try {
        out.set(op, await templateOf(op, jitter));
      } catch (e) {
        console.warn("[acface] 템플릿 실패", op, e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return out;
}

/** 예열 — 밴 화면이 뜨기 전에(위수 협의 모달을 열 때) 미리 받아 둔다. 실패는 조용히 무시. */
export function warmFaceTemplates(ops: string[], opts?: { jitter?: boolean }): void {
  void loadFaceTemplates(ops, opts).catch(() => {});
}
