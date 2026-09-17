// 도감 사이를 **넘어가지 않고** 겹쳐 보기 위한 지연 로더.
//
// 작전 상세에서 적을 누르면 적 상세가, 적 상세에서 등장 작전을 누르면 작전 상세가
// **모달로 하나 더** 뜬다 (사용자 요청 2026-08-09: "그쪽 페이지로 넘어가면 안되고
// 그냥 상세 모달창만 추가로"). 그러려면 각 도감이 상대편 데이터를 갖고 있어야 하는데,
// 로케일당 1MB가 넘으므로 **누르는 순간에만** 받는다. ModalWindow는 zTop 카운터로
// 창끼리 앞뒤를 정하므로 겹쳐 떠도 그대로 동작한다.
import type { Enemy, EnemyStages } from "./enemy-detail";
import type { EnemyStatsIndex, StageDoc } from "./stage-data";

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

const ITEM_LOADERS: Record<string, () => Promise<unknown>> = {
  ko: () => import("./data/items.json"),
  en: () => import("./data/items.en.json"),
  ja: () => import("./data/items.ja.json"),
};
const itemCache = new Map<string, unknown>();

/** 아이템 도감 문서 (로케일당 ~650KB) — 이벤트 도감에서 재화를 누를 때 처음 필요해진다.
 *  페이지로 넘기지 않고 **모달로 겹쳐 띄우기** 위한 것이다 (사용자 지시 2026-09-16:
 *  "교환재화 클릭하면 페이지 이동이 아니라 모달창이 떠야됨"). */
export async function loadItems<T>(locale: string): Promise<T> {
  const hit = itemCache.get(locale);
  if (hit) return hit as T;
  const doc = unwrap<T>(await (ITEM_LOADERS[locale] ?? ITEM_LOADERS.ko)());
  itemCache.set(locale, doc);
  return doc;
}

const ENEMY_STAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  ko: () => import("./data/enemy-stages.json"),
  en: () => import("./data/enemy-stages.en.json"),
  ja: () => import("./data/enemy-stages.ja.json"),
};
const enemyStageCache = new Map<string, EnemyStages>();

/** 적의 **등장 작전 역색인** (로케일당 ~300KB) — 적 상세의 '등장 작전' 절에 필요하다.
 *  ⚠ 안 넘기면 그 절이 **통째로 안 그려진다** (EnemyFile의 stagesDoc). 2026-09-17까지
 *  적 도감에서만 넘기고 있어서, 이벤트·작전·재료파밍·아이템 도감의 적 모달에는 등장 작전이
 *  아예 없었다 (사용자 지시 2026-09-17 "등장 작전도 다른 모달에서 다 보이게 해줘").
 *  색인이 없어도 나머지는 보여야 하므로 실패는 삼키고 null을 준다. */
export async function loadEnemyStages(locale: string): Promise<EnemyStages | null> {
  const hit = enemyStageCache.get(locale);
  if (hit) return hit;
  try {
    const doc = unwrap<EnemyStages>(await (ENEMY_STAGE_LOADERS[locale] ?? ENEMY_STAGE_LOADERS.ko)());
    enemyStageCache.set(locale, doc);
    return doc;
  } catch {
    return null;
  }
}

/** 적 코어 스탯 색인 (70KB, 로케일 무관) — 작전 모달의 등장 적 수치에 필요하다.
 *  ⚠ viewOf에 이걸 안 넘기면 등장 적 카드에 HP·공격 수치가 통째로 빠진다
 *  (2026-08-11 사용자 제보: 적 도감→작전 모달 경로에서 실제로 빠져 있었다). */
export async function loadEnemyStats(): Promise<EnemyStatsIndex> {
  return unwrap<EnemyStatsIndex>(await import("./data/enemy-stats.json"));
}
