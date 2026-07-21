// 육성(정예화 완성) 추천 엔진 — "이 오퍼를 키우면 인프라가 얼마나 좋아지나"를
// 감으로 추정하지 않고 **실제 자동편성 엔진을 두 번 돌려 증명**한다.
//
//   현재 상태 로스터로 optimize → planScore(S0)
//   후보 오퍼만 목표 정예화로 올린 로스터로 optimize → planScore(S1)
//   ΔS = S1 − S0  (이게 랭킹 기준. 플래너와 정확히 같은 목적함수)
//
// 잘못 추천하면 유저가 실제 자원을 태우므로(사용자 최우선 관심사), 세 가지를 지킨다:
//  ① 이득은 증명한다 — 위 반사실(counterfactual) ΔS. 휴리스틱 점수 금지.
//  ② 설명 못 하면 추천 안 한다 — 그 오퍼가 실제 최적 편성의 근무 방에 배치돼 기여할 때만.
//  ③ 비용·이득을 같은 단위로 — 이득은 방 %효율 + (명확한 경우) 일일 용문폐/작전기록,
//     비용은 costs.json의 실제 재료·용문폐, 회수일은 이성(sanity) 공통 환산.
//
// 도메인 규칙 정본은 docs/INFRA-RULES.md, 엔진은 app/planner-engine.ts.
import costsData from "./data/costs.json";
import farmData from "./data/farm.json";
import {
  optimize, planScore, teamScore, opSolo, withElite, maxElite, eliteLocks,
  cellByKey, aurasOf, ctxFor, presentIdsFor, SHIFT_COUNT,
  type InfraOp, type Elite, type Plan, type ProdPriority,
} from "./planner-engine";

// ── 경제 상수 (근사 · β) ──────────────────────────────────────────────────────
// ⚠ 일일 자원·회수일 환산에만 쓰인다. 랭킹(ΔS)·방 %효율·비용 재료 목록은 이 상수와
// 무관하게 정확하다. 아래 값은 커뮤니티 표준 스테이지 기준의 잠정치이며 사용자 확정 대기.
// (LMD_PER_SANITY: CE-6 계열 이성당 용문폐 / EXP_PER_SANITY: LS-6 계열 이성당 경험치 /
//  *_PER_DAY_BASE: 방 하나가 효율 0%[기본 100%]에서 하루[A조 12h + B조 12h] 내는 산출량)
export const ECON = {
  LMD_PER_SANITY: 260,
  EXP_PER_SANITY: 260,
  GOLD_LMD_PER_DAY_BASE: 4000, // 순금 제조소 1방 기본 일일 용문폐(순금 순가치)
  EXP_PER_DAY_BASE: 4000,      // 작전기록 제조소 1방 기본 일일 경험치
  CHIP_FALLBACK_SANITY: 150,   // 듀얼칩 등 farm·craft 어느쪽으로도 값 못 내는 재료 근사
};

// 순금방 2 · 작전기록방 2 (LAYOUT 고정). 무역소는 순금 병목 때문에 일일 용문폐로 억지 환산하지
// 않고 %효율 변화만 표시한다 (INFRA-RULES §1 "순금이 병목", 사용자 확정 "명확한 경우만").
const GOLD_CELLS = ["MANUFACTURE-0", "MANUFACTURE-1"];
const EXP_CELLS = ["MANUFACTURE-2", "MANUFACTURE-3"];
const TRADING_CELLS = ["TRADING-0", "TRADING-1"];
// 일일 용문폐/작전기록 환산은 제조소 두 라인만(명확한 경우). 나머지(무역·발전·사무실·응접실)는
// 설명용으로 %효율 변화만 표시 — 억지 원화 환산 금지 (사용자 확정). 제어센터 변화는 버프받는
// 방 델타로 자연히 드러나므로 CONTROL 자체 칸은 뺀다.
const REPORTED_CELLS = [...GOLD_CELLS, ...EXP_CELLS, ...TRADING_CELLS, "POWER-0", "HIRE", "MEETING"];
// 기여 판정용 근무 방 — 여기 배치돼야 "실제로 일하는" 것으로 본다 (숙소·가공소·훈련실 제외)
const WORK_ROOMS = new Set(["MANUFACTURE", "TRADING", "POWER", "CONTROL", "HIRE", "MEETING"]);

// ── 재료 → 이성 환산 (farm.json 직파밍 + costs.json craft 레시피 재귀) ───────────
type ItemEntry = { craft?: [string, number][]; goldCost?: number | null };
const ITEMS = (costsData as { items: Record<string, ItemEntry> }).items;
const OPS_COST = (costsData as { ops: Record<string, OpCost> }).ops;

// 재료별 최고효율 파밍 이성 (farm.json 스테이지 최솟값 = 이성당 최대 획득)
const FARM_BEST = new Map<string, number>();
for (const it of (farmData as { items: { id: string; stages: { sanity: number }[] }[] }).items) {
  const vals = it.stages.map((s) => s.sanity).filter((n) => n > 0);
  if (vals.length) FARM_BEST.set(it.id, Math.min(...vals));
}

const sanityCache = new Map<string, number | null>();
// 재료 하나의 획득 이성 = min(직파밍, 제작). 제작은 하위 재료 이성 합 + 가공 용문폐 환산.
// 순환 레시피는 없지만 seen 가드로 안전 확보. 값 못 내면 null(호출부가 근사 폴백).
function itemSanity(id: string, seen: Set<string> = new Set()): number | null {
  if (id === "4001") return null; // 용문폐는 lmd로 별도 처리
  const cached = sanityCache.get(id);
  if (cached !== undefined) return cached;
  if (seen.has(id)) return null;
  seen.add(id);
  const farm = FARM_BEST.get(id) ?? null;
  let craft: number | null = null;
  const recipe = ITEMS[id]?.craft;
  if (recipe?.length) {
    let sum = (ITEMS[id]?.goldCost ?? 0) / ECON.LMD_PER_SANITY;
    let ok = true;
    for (const [cid, cnt] of recipe) {
      const cs = itemSanity(cid, seen);
      if (cs == null) { ok = false; break; }
      sum += cs * cnt;
    }
    if (ok) craft = sum;
  }
  seen.delete(id);
  const val = farm != null && craft != null ? Math.min(farm, craft) : (farm ?? craft);
  sanityCache.set(id, val);
  return val;
}

// ── 정예화 비용 (costs.json) ──────────────────────────────────────────────────
type CostPhase = { lmd: number; items: [string, number][] };
type LevelPhase = { lmd: number; items: [string, number][]; maxLv: number; exp: number };
type OpCost = { elite?: (CostPhase | null)[]; levels?: LevelPhase[] };

export type RaiseCost = { lmd: number; exp: number; items: [string, number][] };

// from → to 정예화에 드는 총비용. 각 단계 p(=from…to-1)마다 그 단계 만렙 레벨업(levels[p]) +
// 승급(elite[p]). 현재 레벨을 모르므로 전 레벨업을 계상 — 비용을 과소평가하지 않는(안전한) 방향.
export function raiseCost(opId: string, from: Elite, to: Elite): RaiseCost {
  const entry = OPS_COST[opId];
  const items = new Map<string, number>();
  let lmd = 0;
  let exp = 0;
  if (entry) {
    for (let p = from; p < to; p += 1) {
      const lv = entry.levels?.[p];
      if (lv) { lmd += lv.lmd || 0; exp += lv.exp || 0; }
      const el = entry.elite?.[p];
      if (el) {
        lmd += el.lmd || 0;
        for (const [iid, ct] of el.items) items.set(iid, (items.get(iid) ?? 0) + ct);
      }
    }
  }
  return { lmd, exp, items: [...items.entries()] };
}

// 비용을 이성으로 환산 (용문폐·경험치는 최고효율 스테이지 기준, 재료는 itemSanity).
// approx = 값 못 낸 재료(칩류)를 근사 폴백으로 메운 경우 — UI가 "≈" 표기.
export function costToSanity(cost: RaiseCost): { sanity: number; approx: boolean } {
  let sanity = cost.lmd / ECON.LMD_PER_SANITY + cost.exp / ECON.EXP_PER_SANITY;
  let approx = false;
  for (const [iid, ct] of cost.items) {
    const s = itemSanity(iid);
    if (s == null) { approx = true; sanity += ECON.CHIP_FALLBACK_SANITY * ct; }
    else sanity += s * ct;
  }
  return { sanity, approx };
}

// ── 정예화로 잠긴 인프라 스킬이 풀리는 목표 단계 ───────────────────────────────
// 스킬 unlock이 "정예화 1"→1, "정예화 2"→2. 현재 단계에서 잠긴 인프라 스킬 중 가장 높은
// 해금 단계(= 그 오퍼의 인프라 잠재력을 다 여는 최소 단계)를 목표로. 성급 상한으로 클램프.
export function raiseTarget(op: InfraOp, current: Elite): Elite | null {
  const cap = maxElite(op.rarity);
  let target = current;
  for (const skill of op.skills) {
    const need: Elite = skill.unlock === "정예화 2" ? 2 : skill.unlock === "정예화 1" ? 1 : 0;
    if (need > current && need <= cap && eliteLocks(skill.unlock, current)) target = Math.max(target, need) as Elite;
  }
  return target > current ? target : null;
}

// ── 방·배치 헬퍼 ──────────────────────────────────────────────────────────────
// 한 조(shift) 기준 방 팀 (id → op). byId는 그 로스터 버전(정예화 반영)을 담아야 정확하다.
function teamAt(plan: Plan, key: string, shift: number, byId: Map<string, InfraOp>): InfraOp[] {
  const shifts = plan.assignments[key] ?? [];
  return (shifts[Math.min(shift, shifts.length - 1)] ?? []).map((id) => byId.get(id)).filter(Boolean) as InfraOp[];
}

// 방 %효율 (teamScore) — 조별 앰비언트(제어센터 오라) 반영. 일일 자원·방 델타 공용.
function cellEff(plan: Plan, key: string, shift: number, byId: Map<string, InfraOp>): number {
  const cell = cellByKey.get(key);
  if (!cell) return 0;
  const points = shift === 0 ? plan.tokenPoints : {};
  const counts = plan.factionCounts[shift] ?? {};
  const present = presentIdsFor(plan, shift);
  const ambient = aurasOf(teamAt(plan, "CONTROL", shift, byId), ctxFor("CONTROL", points, counts, plan.plants, present));
  return teamScore(teamAt(plan, key, shift, byId), cell.room, ctxFor(key, points, counts, plan.plants, present, ambient));
}

// 제조소 일일 산출 — 순금방→용문폐, 작전기록방→경험치. 양 조 각 12h(동일 시간, 전략 가중
// SHIFT_WEIGHT와 무관)라 방당 base×(1+eff/100)을 절반씩 두 조 합산 = 하루치.
function factoryDaily(plan: Plan, byId: Map<string, InfraOp>): { lmd: number; exp: number } {
  let lmd = 0;
  let exp = 0;
  for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
    for (const key of GOLD_CELLS) lmd += ECON.GOLD_LMD_PER_DAY_BASE * (1 + cellEff(plan, key, shift, byId) / 100) / SHIFT_COUNT;
    for (const key of EXP_CELLS) exp += ECON.EXP_PER_DAY_BASE * (1 + cellEff(plan, key, shift, byId) / 100) / SHIFT_COUNT;
  }
  return { lmd, exp };
}

// 오퍼가 최적 편성에서 실제로 앉은 근무 방 (기여 판정 + "여기 넣으세요" 설명용)
function placementOf(plan: Plan, opId: string): { key: string; shift: number } | null {
  for (const [key, shifts] of Object.entries(plan.assignments)) {
    const room = cellByKey.get(key)?.room;
    if (!room || !WORK_ROOMS.has(room)) continue;
    for (let shift = 0; shift < shifts.length; shift += 1) {
      if ((shifts[shift] ?? []).includes(opId)) return { key, shift };
    }
  }
  return null;
}

// ── 추천 결과 ────────────────────────────────────────────────────────────────
export type RoomDelta = { key: string; shift: number; before: number; after: number };
export type RaiseRec = {
  opId: string;
  from: Elite;
  to: Elite;
  deltaScore: number;            // ΔplanScore (랭킹 기준)
  dailyLmd: number;              // Δ 일일 용문폐 (순금방 변화분; 무역방 변화는 미포함 — 병목)
  dailyExp: number;              // Δ 일일 작전기록
  tradingChanged: boolean;       // 무역방 %효율이 바뀜(일일 용문폐로 억지 환산 안 함) — 표기 힌트
  roomDeltas: RoomDelta[];       // 바뀐 생산·무역 방·조 (설명용)
  placement: { key: string; shift: number } | null; // raised 편성에서 이 오퍼 위치
  cost: RaiseCost;
  costSanity: number;
  costApprox: boolean;           // 값 못 낸 재료(칩류) 포함
  dailySavedSanity: number;      // 하루 절약 이성 (factory 변화분만)
  paybackDays: number | null;    // costSanity / dailySavedSanity (>0일 때만)
};

export type InvestProgress = { done: number; total: number; opId?: string };

const EPS = 1e-6;         // ΔS 부호 판정용 부동소수 노이즈 컷 (사용자: 미미해도 +면 추천)
const DROP_TOL = 3;       // 방 효율 하락 허용 오차 (재배치 잡음 판정 문턱)
const SYNERGY_MIN = 25;   // 방이 하락해도 통과시키는 최소 ΔS — 진짜 시너지 결집만

// 로스터를 정예화 반영해 스탬프 + id 맵. current = eliteById에 없으면 성급 최대 가정.
function stampRoster(visibleOps: InfraOp[], ownedIds: Set<string>, eliteById: Map<string, Elite>, override?: { id: string; elite: Elite }) {
  const roster: InfraOp[] = [];
  const byId = new Map<string, InfraOp>();
  for (const op of visibleOps) {
    if (!ownedIds.has(op.id)) continue;
    const elite = override && override.id === op.id ? override.elite : eliteById.get(op.id) ?? maxElite(op.rarity);
    const stamped = withElite(op, elite);
    roster.push(stamped);
    byId.set(op.id, stamped);
  }
  return { roster, byId };
}

// 값싼 사전 필터 (admissible — 진짜 이득을 절대 자르지 않는다). 목표 정예에서 새로 켜지는
// 인프라 스킬이 시너지 조각(팀 의존)이거나, 단독 점수로도 그 방 최약 근무자를 넘어설 여지가
// 있으면 통과. 애매하면 통과 — 과포함은 시간 손해일 뿐, 과제거만이 오추천을 부른다.
const TEAM_KINDS = new Set(["override", "payout", "quality", "percoworker", "amplify", "automation", "automation_crew"]);
function passesPrefilter(rawOp: InfraOp, target: Elite, current: Elite, baseline: Plan, byId0: Map<string, InfraOp>): boolean {
  const raised = withElite(rawOp, target);
  const base = withElite(rawOp, current);
  // 새로 켜지는(또는 강화되는) 인프라 스킬만 관심 대상
  const baseSkills = new Set(base.skills.map((s) => s.buffId ?? s.name));
  const gained = raised.skills.filter((s) => !baseSkills.has(s.buffId ?? s.name));
  if (!gained.length) return false;
  for (const skill of gained) {
    // 시너지 조각(팀 의존/토큰/진영카운트/조건부/용량)은 단독 점수가 낮아도 항상 통과
    if (TEAM_KINDS.has(skill.kind) || skill.partners.length || skill.roomPartner || skill.condBonus
      || skill.perFaction || skill.gateFaction || skill.basePartners?.length || (skill.cap ?? 0) !== 0
      || skill.capConv || skill.tokenGen.length || skill.tokenUse.length) return true;
    // 순수 가산 스킬: 그 방 종류의 현재 최약 근무자 단독 점수를 넘어설 여지가 있으면 통과
    const room = skill.room;
    const slots = 3;
    const soloRaised = opSolo(raised, room, slots, { tokenPoints: {}, product: room === "MANUFACTURE" ? skill.product : undefined });
    let weakest = Infinity;
    for (const [key, shifts] of Object.entries(baseline.assignments)) {
      if (cellByKey.get(key)?.room !== room) continue;
      for (const team of shifts) for (const id of team) {
        const occ = byId0.get(id);
        if (occ) weakest = Math.min(weakest, opSolo(occ, room, slots, { tokenPoints: {}, product: cellByKey.get(key)?.product }));
      }
    }
    if (soloRaised > (weakest === Infinity ? 0 : weakest)) return true;
  }
  return false;
}

// 메인 — 보유·정예화 상태를 받아 "완성하면 이득인" 정예화 투자를 ΔplanScore 순으로 반환.
export async function recommendRaises(
  visibleOps: InfraOp[],
  ownedIds: Set<string>,
  eliteById: Map<string, Elite>,
  priority: ProdPriority = "gold",
  onProgress?: (p: InvestProgress) => void | Promise<void>,
): Promise<RaiseRec[]> {
  const cur = (op: InfraOp): Elite => eliteById.get(op.id) ?? maxElite(op.rarity);
  const { roster: baseRoster, byId: byId0 } = stampRoster(visibleOps, ownedIds, eliteById);
  const baseline = await optimize(baseRoster, priority);
  const S0 = planScore(baseline, byId0);
  const base = factoryDaily(baseline, byId0);

  // 후보: 보유 & 목표 정예 존재 & 사전 필터 통과
  type Cand = { op: InfraOp; from: Elite; to: Elite };
  const candidates: Cand[] = [];
  for (const op of visibleOps) {
    if (!ownedIds.has(op.id)) continue;
    const from = cur(op);
    const to = raiseTarget(op, from);
    if (to == null) continue;
    if (!passesPrefilter(op, to, from, baseline, byId0)) continue;
    candidates.push({ op, from, to });
  }

  const recs: RaiseRec[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const { op, from, to } = candidates[i];
    if (onProgress) await onProgress({ done: i, total: candidates.length, opId: op.id });
    const { roster: upRoster, byId: byId1 } = stampRoster(visibleOps, ownedIds, eliteById, { id: op.id, elite: to });
    const plan = await optimize(upRoster, priority);
    const S1 = planScore(plan, byId1);
    const deltaScore = S1 - S0;
    if (deltaScore <= EPS) continue;                 // 이득 없음/음수(휴리스틱 잡음) → 억제
    const placement = placementOf(plan, op.id);
    if (!placement) continue;                        // 근무 방에 안 앉으면 귀속 실패 → 억제

    // 방 델타 (설명 + 일일 자원). 바뀐 생산·무역 방·조만 수집.
    const roomDeltas: RoomDelta[] = [];
    let tradingChanged = false;
    for (const key of REPORTED_CELLS) {
      for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
        const before = cellEff(baseline, key, shift, byId0);
        const after = cellEff(plan, key, shift, byId1);
        if (Math.abs(after - before) < 0.05) continue;
        roomDeltas.push({ key, shift, before, after });
        if (TRADING_CELLS.includes(key)) tradingChanged = true;
      }
    }
    // 재배치 잡음 억제 — 어떤 보고 대상 방이 눈에 띄게 하락했는데 총이득(ΔS)이 작으면,
    // 이건 그 오퍼를 키운 효과가 아니라 그리디가 다른 방 인원을 뒤섞은 부작용이다.
    // "왜 키웠는데 다른 방이 나빠지지?"라는 혼란·불신을 막으려 억제한다. 단, ΔS가 큰(진짜
    // 시너지 결집) 경우는 하락(딴 방 인원을 결집 방으로 이동)이 정상 비용이라 통과시킨다.
    const hasDrop = roomDeltas.some((d) => d.after < d.before - DROP_TOL);
    if (hasDrop && deltaScore < SYNERGY_MIN) continue;

    const up = factoryDaily(plan, byId1);
    const dailyLmd = up.lmd - base.lmd;
    const dailyExp = up.exp - base.exp;

    const cost = raiseCost(op.id, from, to);
    const { sanity: costSanity, approx: costApprox } = costToSanity(cost);
    // 순(net) 절약 — 순금↔작전기록 이동 같은 트레이드오프까지 반영(한쪽만 세면 과대평가).
    // 순 절약이 0 이하면(자원 총량 비슷·재배치) 회수일 계산 불가 → null.
    const dailySavedSanity = dailyLmd / ECON.LMD_PER_SANITY + dailyExp / ECON.EXP_PER_SANITY;
    const paybackDays = dailySavedSanity > 0 ? costSanity / dailySavedSanity : null;

    recs.push({ opId: op.id, from, to, deltaScore, dailyLmd, dailyExp, tradingChanged, roomDeltas, placement, cost, costSanity, costApprox, dailySavedSanity, paybackDays });
  }
  if (onProgress) await onProgress({ done: candidates.length, total: candidates.length });
  recs.sort((a, b) => b.deltaScore - a.deltaScore);
  return recs;
}
