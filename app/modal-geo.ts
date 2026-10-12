// 공용 창(ModalWindow)의 '마지막 자리' 기억 — geoKey 를 준 창끼리 한 자리를 나눠 쓴다. 새로고침하면 사라지는 메모리 값이다.
// PRTS 링크로 뜨는 상세 창(작전·조우·구역·소장품·모아보기)이 쓴다: 연결 중엔 옮긴 자리에 다시 뜨고, 연결을 끊으면 잊어서
// 다음 연결은 기본 자리부터 (사용자 지시 2026-10-12) — 끊을 때 lens/bridge.ts disconnectBridge 가 forgetModalPos 를 부른다.
// 자리는 열쇠 하나에 하나(창 종류가 달라도 같은 자리), 크기는 창 종류(className)별로 따로 — 모아보기를 넓혀도 작전 창은 제 크기로
export type ModalPos = { x: number; y: number };
export type ModalSize = { w: number; h: number };
const saved = new Map<string, ModalPos>();
const sizes = new Map<string, ModalSize>();
const sizeKey = (key: string, kind: string) => `${key}|${kind}`;
export const modalPosOf = (key: string): ModalPos | undefined => saved.get(key);
export const modalSizeOf = (key: string, kind: string): ModalSize | undefined => sizes.get(sizeKey(key, kind));
export const rememberModalGeo = (key: string, kind: string, pos: ModalPos | null, size: ModalSize | null): void => {
  if (pos) saved.set(key, pos);
  if (size) sizes.set(sizeKey(key, kind), size);
};
/** 열쇠와, 그 열쇠로 시작하는 갈래("prts:zone" 등)까지 잊는다 */
export const forgetModalPos = (key: string): void => {
  const mine = (k: string) => k === key || k.startsWith(`${key}:`) || k.startsWith(`${key}|`);
  for (const k of [...saved.keys()]) if (mine(k)) saved.delete(k);
  for (const k of [...sizes.keys()]) if (mine(k)) sizes.delete(k);
};
/** PRTS 링크 창들이 나눠 쓰는 열쇠 */
export const PRTS_MODAL_KEY = "prts";
