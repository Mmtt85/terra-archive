// 도감 사이를 **넘어가지 않고** 겹쳐 보기 위한 지연 로더.
//
// 작전 상세에서 적을 누르면 적 상세가, 적 상세에서 등장 작전을 누르면 작전 상세가
// **모달로 하나 더** 뜬다 (사용자 요청 2026-08-09: "그쪽 페이지로 넘어가면 안되고
// 그냥 상세 모달창만 추가로"). 그러려면 각 도감이 상대편 데이터를 갖고 있어야 하는데,
// 로케일당 1MB가 넘으므로 **누르는 순간에만** 받는다. ModalWindow는 zTop 카운터로
// 창끼리 앞뒤를 정하므로 겹쳐 떠도 그대로 동작한다.
import type { Enemy } from "./enemy-detail";
import type { StageDoc } from "./stage-data";

const ENEMY_LOADERS: Record<string, () => Promise<unknown>> = {
  ko: () => import("./data/enemies.json"),
  en: () => import("./data/enemies.en.json"),
  ja: () => import("./data/enemies.ja.json"),
};
const STAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  ko: () => import("./data/stages.json"),
  en: () => import("./data/stages.en.json"),
  ja: () => import("./data/stages.ja.json"),
};

const unwrap = <T,>(m: unknown) => ((m as { default?: unknown }).default ?? m) as T;
const enemyCache = new Map<string, Map<string, Enemy>>();
const stageCache = new Map<string, StageDoc>();

/** 적 도감 데이터 (id → 적). 이미 받았으면 즉시 돌려준다. */
export async function loadEnemies(locale: string): Promise<Map<string, Enemy>> {
  const hit = enemyCache.get(locale);
  if (hit) return hit;
  const list = unwrap<Enemy[]>(await (ENEMY_LOADERS[locale] ?? ENEMY_LOADERS.ko)());
  const map = new Map(list.map((e) => [e.id, e]));
  enemyCache.set(locale, map);
  return map;
}

/** 작전 도감 문서. 이미 받았으면 즉시 돌려준다. */
export async function loadStages(locale: string): Promise<StageDoc> {
  const hit = stageCache.get(locale);
  if (hit) return hit;
  const doc = unwrap<StageDoc>(await (STAGE_LOADERS[locale] ?? STAGE_LOADERS.ko)());
  stageCache.set(locale, doc);
  return doc;
}
