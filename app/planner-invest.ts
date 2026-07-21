// 육성(정예화 완성) 추천 엔진 — "이 오퍼를 키우면 인프라가 좋아지나"를 감으로 추정하지
// 않고, 실제 자동편성 엔진을 두 번 돌려 증명한다.
//   현재 상태 로스터 optimize → planScore(S0)
//   후보만 목표 정예화로 올린 로스터 → planScore(S1),  ΔS = S1 − S0  (랭킹 기준)
//
// 잘못 추천하면 유저가 실제 자원을 태우므로(핵심 관심사) 신뢰 성질을 척추로 삼는다:
//  ① 이득은 증명한다 — 반사실(counterfactual) ΔS. 휴리스틱 점수 금지.
//  ② 설명 못 하면 추천 안 한다 — 그 오퍼가 실제 근무 방에 배치돼 기여할 때만.
//  ③ 비용은 정확히 — costs.json의 실제 재료·용문폐·경험치.
// 표시는 **방 %효율 변화 + 완성 비용**뿐이다. 일일 용문폐/작전기록·회수일 같은 근사 환산은
// 쓰지 않는다 (사용자 확정 2026-07-21: 기준 상수가 불확실한 근사치는 오히려 오해를 부른다).
//
// 성능 (사용자 확정 2026-07-21): 후보마다 전체 재탐색(optimize=buildPlan 최대 15회)을 반복하지
// 않는다. 베이스라인이 고른 전략(토큰 패키지·시너지 세트)을 재사용해 **buildPlan을 1회만** 돌린다
// — 이 경우 두 편성은 딱 그 오퍼의 정예화만 다른 깔끔한 대조가 된다. 단 **시너지 조각(팀 의존
// 스킬이 새로 열리는 오퍼)만** 전체 optimize로 돌려 완성 시 새로 열릴 수 있는 세트의 총 시너지
// 효율까지 다시 평가한다. 정렬된 전체 목록을 반환하고 표시 상한(20)·숨기기 백필은 UI 몫.
//
// 도메인 규칙 정본은 docs/INFRA-RULES.md, 엔진은 app/planner-engine.ts.
import costsData from "./data/costs.json";
import {
  optimizeConfig, buildPlan, planScore, teamScore, opSolo, withElite, maxElite, eliteLocks,
  availableSetKeys, synergySetMembers, cellByKey, aurasOf, ctxFor, presentIdsFor, SHIFT_COUNT,
  type InfraOp, type Elite, type Plan, type ProdPriority, type FactionSets,
} from "./planner-engine";

type CostPhase = { lmd: number; items: [string, number][] };
type LevelPhase = { lmd: number; items: [string, number][]; maxLv: number; exp: number };
type OpCost = { elite?: (CostPhase | null)[]; levels?: LevelPhase[] };
const OPS_COST = (costsData as { ops: Record<string, OpCost> }).ops;

// 보고 대상 방 (설명용 %효율 변화). 제조소·무역소·발전소·사무실·응접실. 제어센터 변화는
// 버프받는 방 델타로 자연히 드러나므로 뺀다. 가공소·숙소·훈련실은 planScore 무관/무의미.
const REPORTED_CELLS = ["MANUFACTURE-0", "MANUFACTURE-1", "MANUFACTURE-2", "MANUFACTURE-3", "TRADING-0", "TRADING-1", "POWER-0", "HIRE", "MEETING"];
// 기여 판정용 근무 방 — 여기 배치돼야 "실제로 일하는" 것으로 본다 (숙소·가공소·훈련실 제외)
const WORK_ROOMS = new Set(["MANUFACTURE", "TRADING", "POWER", "CONTROL", "HIRE", "MEETING"]);
const CAND_CAP = 140;     // 정밀 평가 후보 상한 — 유망순(시너지·성급) 정렬 후 상위만 (성능)
const EPS = 1e-6;         // ΔS 부호 판정용 부동소수 노이즈 컷
const DROP_TOL = 3;       // 방 효율 하락 허용 오차 (재배치 잡음 판정 문턱)
const SYNERGY_MIN = 25;   // 방이 하락해도 통과시키는 최소 ΔS — 진짜 시너지 결집만

// ── 정예화 비용 (costs.json) — 정확 ──────────────────────────────────────────
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
function teamAt(plan: Plan, key: string, shift: number, byId: Map<string, InfraOp>): InfraOp[] {
  const shifts = plan.assignments[key] ?? [];
  return (shifts[Math.min(shift, shifts.length - 1)] ?? []).map((id) => byId.get(id)).filter(Boolean) as InfraOp[];
}

// 방 %효율 (teamScore) — 조별 앰비언트(제어센터 오라) 반영. 방 델타 표시용.
function cellEff(plan: Plan, key: string, shift: number, byId: Map<string, InfraOp>): number {
  const cell = cellByKey.get(key);
  if (!cell) return 0;
  const points = shift === 0 ? plan.tokenPoints : {};
  const counts = plan.factionCounts[shift] ?? {};
  const present = presentIdsFor(plan, shift);
  const ambient = aurasOf(teamAt(plan, "CONTROL", shift, byId), ctxFor("CONTROL", points, counts, plan.plants, present));
  return teamScore(teamAt(plan, key, shift, byId), cell.room, ctxFor(key, points, counts, plan.plants, present, ambient));
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
  aGain: number;                 // A조 방 %효율 변화 합계(%p) — 표시·랭킹 기준(주력 조 우선)
  bGain: number;                 // B조(회복 교대) 방 %효율 변화 합계(%p)
  deltaScore: number;            // 내부 ΔplanScore (재배치 잡음 가드용 — 표시 안 함)
  synergy: boolean;              // 시너지 조각으로 판정돼 전체 최적화로 평가됨 (표시 힌트)
  roomDeltas: RoomDelta[];       // 바뀐 생산·무역·발전·사무실·응접실 방·조
  placement: { key: string; shift: number } | null; // raised 편성에서 이 오퍼 위치
  cost: RaiseCost;
};

export type InvestProgress = { done: number; total: number; opId?: string };

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

// 팀 의존(시너지) 스킬 종류 — 완성 시 새 세트가 열릴 수 있어 전체 optimize가 필요한 신호
const TEAM_KINDS = new Set(["override", "payout", "quality", "percoworker", "amplify", "automation", "automation_crew"]);

// 후보 판정(admissible 사전 필터) + 시너지 조각 여부. pass=false면 그 오퍼는 완성해도 편성이
// 절대 안 바뀐다(스킵). synergy=true면 팀 의존이라 전체 재탐색으로 총 시너지 효율까지 본다.
// ⚠ pass 판정은 보수적(과포함) — 애매하면 통과, 실제 이득은 반사실 재편성이 최종 판정한다.
function candidateInfo(rawOp: InfraOp, target: Elite, current: Elite, baseline: Plan, byId0: Map<string, InfraOp>): { pass: boolean; synergy: boolean } {
  const raised = withElite(rawOp, target);
  const base = withElite(rawOp, current);
  const baseSkills = new Set(base.skills.map((s) => s.buffId ?? s.name));
  const gained = raised.skills.filter((s) => !baseSkills.has(s.buffId ?? s.name));
  if (!gained.length) return { pass: false, synergy: false };
  let synergy = false;
  let pass = false;
  for (const skill of gained) {
    if (TEAM_KINDS.has(skill.kind) || skill.partners.length || skill.roomPartner || skill.condBonus
      || skill.perFaction || skill.gateFaction || skill.basePartners?.length || (skill.cap ?? 0) !== 0
      || skill.capConv || skill.tokenGen.length || skill.tokenUse.length) { synergy = true; pass = true; }
  }
  if (!pass) {
    // 순수 가산 스킬: 그 방 종류의 현재 최약 근무자 단독 점수를 넘어설 여지가 있으면 통과
    for (const skill of gained) {
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
      if (soloRaised > (weakest === Infinity ? 0 : weakest)) { pass = true; break; }
    }
  }
  return { pass, synergy };
}

// 메인 — 보유·정예화 상태를 받아 "완성하면 이득인" 정예화 투자를 이득순 정렬 전체로 반환.
export async function recommendRaises(
  visibleOps: InfraOp[],
  ownedIds: Set<string>,
  eliteById: Map<string, Elite>,
  priority: ProdPriority = "gold",
  onProgress?: (p: InvestProgress) => void | Promise<void>,
): Promise<RaiseRec[]> {
  const cur = (op: InfraOp): Elite => eliteById.get(op.id) ?? maxElite(op.rarity);
  const { roster: baseRoster, byId: byId0 } = stampRoster(visibleOps, ownedIds, eliteById);
  // 베이스라인 편성 + 그 편성이 고른 전략(토큰·시너지 세트) — 순수 가산 후보 평가에 재사용
  const { plan: baseline, tokenChoice, factionSets } = await optimizeConfig(baseRoster, priority);
  const S0 = planScore(baseline, byId0);

  type Cand = { op: InfraOp; from: Elite; to: Elite; synergy: boolean };
  const candidates: Cand[] = [];
  for (const op of visibleOps) {
    if (!ownedIds.has(op.id)) continue;
    const from = cur(op);
    const to = raiseTarget(op, from);
    if (to == null) continue;
    const info = candidateInfo(op, to, from, baseline, byId0);
    if (!info.pass) continue;
    candidates.push({ op, from, to, synergy: info.synergy });
  }
  // 후보가 상한을 넘으면 유망순으로 정밀 평가 대상을 좁힌다 — 표시는 20개씩이므로, 시너지
  // 조각과 고성급(강한 스킬)을 앞세운다. 값싼 정렬이라 진짜 최상위를 놓칠 위험은 낮다.
  candidates.sort((a, b) => (b.synergy ? 1 : 0) - (a.synergy ? 1 : 0) || b.op.rarity - a.op.rarity || a.op.seq - b.op.seq);
  const capped = candidates.length > CAND_CAP;
  const evalList = capped ? candidates.slice(0, CAND_CAP) : candidates;

  // 후보 하나를 평가 — 기본은 baseline 전략 재사용 buildPlan 1회. 세트 활성안은 **그 후보가
  // 실제로 참가하는** 휴면 세트(setMembers) + 완성으로 새로 가용해지는 세트만 추가로 비교한다.
  // 비참가 후보에까지 휴면 세트 재탐색을 돌리던 낭비를 없앤다(대부분 후보가 buildPlan 1회로 수렴).
  const baselineAvail = new Set(availableSetKeys(baseRoster));
  const setMembers = synergySetMembers(baseRoster);
  const dormantSets = [...baselineAvail].filter((key) => !factionSets[key]);
  const evalCandidate = (upRoster: InfraOp[], byId1: Map<string, InfraOp>, opId: string): { plan: Plan; score: number } => {
    const configs: FactionSets[] = [factionSets];
    const seen = new Set(Object.keys(factionSets));
    for (const key of dormantSets) if (!seen.has(key) && setMembers[key]?.includes(opId)) { configs.push({ ...factionSets, [key]: true }); seen.add(key); }
    for (const key of availableSetKeys(upRoster)) if (!baselineAvail.has(key) && !seen.has(key)) { configs.push({ ...factionSets, [key]: true }); seen.add(key); }
    let best: Plan | null = null;
    let bestS = -Infinity;
    for (const cfg of configs) {
      const plan = buildPlan(tokenChoice, upRoster, cfg, priority);
      const score = planScore(plan, byId1);
      if (score > bestS) { bestS = score; best = plan; }
    }
    return { plan: best!, score: bestS };
  };

  const recs: RaiseRec[] = [];
  for (let i = 0; i < evalList.length; i += 1) {
    const { op, from, to, synergy } = evalList[i];
    if (onProgress) await onProgress({ done: i, total: evalList.length, opId: op.id });
    const { byId: byId1 } = stampRoster(visibleOps, ownedIds, eliteById, { id: op.id, elite: to });
    const upRoster = [...byId1.values()];
    const { plan, score: S1 } = evalCandidate(upRoster, byId1, op.id);
    const deltaScore = S1 - S0;
    if (deltaScore <= EPS) continue;                 // 이득 없음/음수(휴리스틱 잡음) → 억제
    const placement = placementOf(plan, op.id);
    if (!placement) continue;                        // 근무 방에 안 앉으면 귀속 실패 → 억제

    const roomDeltas: RoomDelta[] = [];
    for (const key of REPORTED_CELLS) {
      for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
        const before = cellEff(baseline, key, shift, byId0);
        const after = cellEff(plan, key, shift, byId1);
        if (Math.abs(after - before) < 0.05) continue;
        roomDeltas.push({ key, shift, before, after });
      }
    }
    // 재배치 잡음 억제 — 어떤 방이 눈에 띄게 하락했는데 총이득(ΔS)이 작으면, 그 오퍼를 키운
    // 효과가 아니라 그리디가 다른 방 인원을 뒤섞은 부작용이다("왜 키웠는데 다른 방이 나빠지지?"
    // 혼란·불신 방지). ΔS가 큰 진짜 시너지 결집은 하락(딴 방→결집 방 이동)이 정상이라 통과.
    if (!roomDeltas.length) continue;                // 보여줄 방 변화가 없으면(제어·훈련만 미세 변동) 억제
    const hasDrop = roomDeltas.some((d) => d.after < d.before - DROP_TOL);
    if (hasDrop && deltaScore < SYNERGY_MIN) continue;

    // 조별 방 %효율 변화 합계 — 유저에게 보여줄 구체 지표(추상 planScore 대신). A조(주력) 우선.
    const aGain = roomDeltas.reduce((sum, d) => (d.shift === 0 ? sum + (d.after - d.before) : sum), 0);
    const bGain = roomDeltas.reduce((sum, d) => (d.shift === 1 ? sum + (d.after - d.before) : sum), 0);
    recs.push({ opId: op.id, from, to, aGain, bGain, deltaScore, synergy, roomDeltas, placement, cost: raiseCost(op.id, from, to) });
  }
  if (onProgress) await onProgress({ done: evalList.length, total: evalList.length });
  void capped; // 상한 초과 시 잘린 후보가 있으나(로그성) UI는 어차피 20개씩만 노출
  // A조 방 효율 이득 우선 정렬 — A조가 풀파워 주력이라(피로 소진 전까지 A조로 돌림) 그 이득을
  // 먼저 본다 (사용자 확정 2026-07-21). 동률이면 B조, 그다음 내부 총점.
  recs.sort((a, b) => b.aGain - a.aGain || b.bGain - a.bGain || b.deltaScore - a.deltaScore);
  // 전체 반환 — 표시 상한(20)은 UI(planner.tsx INVEST_SHOW) 몫. '숨기기' 시 21위부터 순서대로
  // 올라와야 하므로(사용자 요청 2026-07-21) 여기서 자르지 않는다.
  return recs;
}
