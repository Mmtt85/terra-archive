// 획득 구분 — 한정·통상·보상·공채·커널 (사용자 지시 2026-10-14 "오퍼 도감도 내 정보 보유 오퍼도 이렇게 필터링").
// '획득 경로'(op-obtain.json — 오퍼마다 대표 경로 하나)와 달리 **겹친다**: 통상 헤드헌팅 오퍼가 공채에도 나오면 둘 다.
//   한정 = 한정·콜라보 헤드헌팅 (획득 경로 limited·collab — 콜라보 풀이라도 이벤트 배포 오퍼는 보상)
//   통상 = 통상 헤드헌팅 풀 (gacha-pool pool — 커널 오퍼는 이미 빠져 있다)
//   커널 = 커널 헤드헌팅 (gacha-pool kernel)
//   공채 = 공개모집 풀 (recruit.json)
//   보상 = 헤드헌팅이 아닌 대표 경로 — 이벤트 배포·증명서/크레딧 교역소·통합전략·메인 스토리·기념 보상·패키지
// 쓰는 곳: 오퍼 도감 필터(home.tsx) · 내 정보 오퍼 목록 창(me.tsx OpListBody)
import pool from "./data/gacha-pool.json";
import recruit from "./data/recruit.json";
import obtain from "./data/op-obtain.json";

export const ACQUIRE_KEYS = ["limited", "standard", "reward", "recruit", "kernel"] as const;
export type AcquireKey = (typeof ACQUIRE_KEYS)[number];
/** 한국어 원문 = i18n 사전 키 */
export const ACQUIRE_LABEL: Record<AcquireKey, string> = {
  limited: "한정 오퍼", standard: "통상 오퍼", reward: "보상 오퍼", recruit: "공채 오퍼", kernel: "커널 오퍼",
};

const P = pool as unknown as { pool: Record<string, string[]>; limited: string[]; collab: string[]; kernel: string[] };
const limited = new Set([...P.limited, ...P.collab]);
const standard = new Set(Object.values(P.pool).flat());
const kernel = new Set(P.kernel);
const recruitable = new Set((recruit as unknown as { ops: { id: string }[] }).ops.map((o) => o.id));
const OB = (obtain as unknown as { ops: Record<string, string[]> }).ops;
const REWARD_ROUTES = new Set(["event", "cert", "credit", "rogue", "main", "anniv", "package"]);

const cache = new Map<string, AcquireKey[]>();
export function acquireOf(id: string): AcquireKey[] {
  let out = cache.get(id);
  if (out) return out;
  const route = OB[id]?.[0];
  out = [];
  // 콜라보 풀(gacha-pool collab)에는 이벤트로 그냥 주는 오퍼(코로마루·로도스 아일랜드 정찰대)도 들어 있다 — 대표 경로가 이벤트 배포면 보상
  if (route === "limited" || route === "collab" || (limited.has(id) && !REWARD_ROUTES.has(route ?? ""))) out.push("limited");
  if (standard.has(id)) out.push("standard");
  if (!out.length && !kernel.has(id) && route && REWARD_ROUTES.has(route)) out.push("reward");
  if (recruitable.has(id)) out.push("recruit");
  if (kernel.has(id)) out.push("kernel");
  cache.set(id, out);
  return out;
}
