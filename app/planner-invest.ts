// 육성(정예화 완성) 추천 엔진 — "이 오퍼를 키우면 인프라가 좋아지나"를 감으로 추정하지
// 않고, 실제 자동편성 엔진을 두 번 돌려 증명한다.
//   현재 상태 로스터 optimize → planScore(S0)
//   후보만 목표 정예화로 올린 로스터 → planScore(S1),  ΔS = S1 − S0  (랭킹 기준)
//
// 잘못 추천하면 유저가 실제 자원을 태우므로(핵심 관심사) 신뢰 성질을 척추로 삼는다:
//  ① 이득은 증명한다 — 반사실(counterfactual) ΔS. 휴리스틱 점수 금지.
//  ② 설명 못 하면 추천 안 한다 — 그 오퍼가 실제 근무 방에 배치돼 기여할 때만.
//  ③ 비용은 정확히 — costs.json의 실제 재료·용문폐·경험치.
// 표시는 **방 %효율 변화 + 완성 비용 + 예상 회수일**이다.
//   2026-07-21: 일일 용문폐·회수일 같은 근사 환산 금지 (기준 상수가 불확실해 오해를 부른다)
//   2026-08-05: 상수를 전부 데이터에서 뽑고(scripts/build-sanity.py) **근거를 화면에 그대로
//     밝히는 조건**으로 회수일을 되살렸다 — 사용자 지시 "N일 걸림이라고 적고, 무슨 근거로 그
//     계산이 나왔는지 정확하게 적어주기만 하면 됨. 판단은 유저가 하겠지".
//     추정이 남은 상수는 순금→용문폐 환산 하나뿐이고, 그것도 각주에 추정임을 명시한다.
//
// 성능 (사용자 확정 2026-07-21): 후보마다 전체 재탐색(optimize=buildPlan 최대 15회)을 반복하지
// 않는다. 베이스라인이 고른 전략(토큰 패키지·시너지 세트)을 재사용해 **buildPlan을 1회만** 돌린다
// — 이 경우 두 편성은 딱 그 오퍼의 정예화만 다른 깔끔한 대조가 된다. 단 **시너지 조각(팀 의존
// 스킬이 새로 열리는 오퍼)만** 전체 optimize로 돌려 완성 시 새로 열릴 수 있는 세트의 총 시너지
// 효율까지 다시 평가한다. 정렬된 전체 목록을 반환하고 표시 상한(20)·숨기기 백필은 UI 몫.
//
// 도메인 규칙 정본은 docs/INFRA-RULES.md, 엔진은 app/planner-engine.ts.
import costsData from "./data/costs.json";
import sanityData from "./data/sanity.json";
import {
  optimizeConfig, buildPlan, planScore, teamScore, opSolo, withElite, maxElite, eliteLocks, setCapCluster, setShiftTiebreak,
  availableSetKeys, synergySetMembers, cellByKey, LAYOUT, aurasOf, ctxFor, presentIdsFor, roomOfFor, cellOfFor, SHIFT_COUNT, AUTO_BENCH_IDS,
  type InfraOp, type Elite, type Plan, type ProdPriority, type FactionSets,
} from "./planner-engine";

type CostPhase = { lmd: number; items: [string, number][] };
type LevelPhase = { lmd: number; items: [string, number][]; maxLv: number; exp: number };
type OpCost = { elite?: (CostPhase | null)[]; levels?: LevelPhase[] };
const OPS_COST = (costsData as { ops: Record<string, OpCost> }).ops;

// 보고 대상 방 (설명용 %효율 변화). 제조소·무역소·발전소·사무실·응접실. 제어센터 변화는
// 버프받는 방 델타로 자연히 드러나므로 뺀다. 가공소·숙소·훈련실은 planScore 무관/무의미.
// ⚠ 칸 목록을 하드코딩하면 배치 프리셋(153의 제조소 5칸·252·그외)에서 칸이 새거나 없는
// 칸을 보게 된다 — 활성 LAYOUT에서 방 종류로 골라 쓴다 (2026-07-25).
const REPORTED_ROOMS = new Set(["MANUFACTURE", "TRADING", "POWER", "HIRE", "MEETING"]);
const reportedCells = () => LAYOUT.filter((cell) => REPORTED_ROOMS.has(cell.room)).map((cell) => cell.key);
// 기여 판정용 근무 방 — 여기 배치돼야 "실제로 일하는" 것으로 본다 (숙소·가공소·훈련실 제외)
const WORK_ROOMS = new Set(["MANUFACTURE", "TRADING", "POWER", "CONTROL", "HIRE", "MEETING"]);
const CAND_CAP = 140;     // 정밀 평가 후보 상한 — 유망순(시너지·성급) 정렬 후 상위만 (성능)
const EPS = 1e-6;         // ΔS 부호 판정용 부동소수 노이즈 컷
const DROP_TOL = 3;       // 방 효율 하락 허용 오차 (재배치 잡음 판정 문턱)
const SYNERGY_MIN = 25;   // 방이 하락해도 통과시키는 최소 ΔS — 진짜 시너지 결집만

// ── 정예화 비용 (costs.json) — 정확 ──────────────────────────────────────────
export type RaiseCost = { lmd: number; exp: number; items: [string, number][] };

// 정예화 단계별 레벨업 누적표 — levelUp.exp[phase][k] = 그 단계 Lv.1 → Lv.(k+2) 누적.
// 현재 레벨이 주어지면 이미 지나온 몫을 빼서 **남은 비용만** 계상한다 (레벨 입력, 2026-08-04).
const LEVEL_UP = (costsData as { levelUp?: { exp: number[][]; lmd: number[][] } }).levelUp;

// from Lv.fromLevel → to 정예화에 드는 총비용. 각 단계 p(=from…to-1)마다 그 단계 만렙까지의
// 레벨업(levels[p]) + 승급(elite[p]) — 게임 규칙상 승급은 그 단계 만렙에서만 가능하다.
// fromLevel 미지정이면 전 레벨업을 계상한다(비용을 과소평가하지 않는 안전한 방향).
export function raiseCost(opId: string, from: Elite, to: Elite, fromLevel?: number): RaiseCost {
  const entry = OPS_COST[opId];
  const items = new Map<string, number>();
  let lmd = 0;
  let exp = 0;
  if (entry) {
    for (let p = from; p < to; p += 1) {
      const lv = entry.levels?.[p];
      if (lv) {
        let addLmd = lv.lmd || 0;
        let addExp = lv.exp || 0;
        if (p === from && fromLevel && fromLevel > 1 && LEVEL_UP) {
          const idx = Math.min(fromLevel, lv.maxLv) - 2; // Lv.L 도달 누적 = [L-2]
          if (idx >= 0) {
            addExp = Math.max(0, addExp - (LEVEL_UP.exp[p]?.[idx] ?? 0));
            addLmd = Math.max(0, addLmd - (LEVEL_UP.lmd[p]?.[idx] ?? 0));
          }
        }
        lmd += addLmd; exp += addExp;
      }
      const el = entry.elite?.[p];
      if (el) {
        lmd += el.lmd || 0;
        for (const [iid, ct] of el.items) items.set(iid, (items.get(iid) ?? 0) + ct);
      }
    }
  }
  return { lmd, exp, items: [...items.entries()] };
}

// ── 이성(AP) 환산 회수일 ──────────────────────────────────────────────────────
// 사용자 지시 2026-08-05: "N일 걸림이라고 적고, 무슨 근거로 그 계산이 나왔는지 정확하게
// 적어주기만 하면 됨 — 판단은 유저가 한다". 종전(2026-07-21)엔 근사 환산을 아예 뺐으나,
// 상수를 전부 데이터에서 뽑아 근거를 화면에 밝히는 조건으로 되살렸다.
//   비용 = 용문폐/EXP/재료를 각각의 전용 파밍처 이성 단가로 환산 (scripts/build-sanity.py)
//   이득 = 방 %효율 변화 × 그 방 1%p의 하루 산출 × (그 조 근무시간/24)
const SANITY = sanityData as { lmdPerAp: number; expPerAp: number; goldLmd: number; items: Record<string, number>;
  basis: { lmd: { stage: string; ap: number; drop: number }; exp: { stage: string; ap: number; drop: number } } };
// 제조소 기본 생산 속도 1포인트/초 = 3600pt/h (building_data manufactFormulas의 costPoint 단위).
// 1%p가 하루 내내 유지되면 3600×0.01×24 = 864pt.
const PT_DAY_1PCT = 3600 * 0.01 * 24;
const GOLD_COST_PT = 4320;   // 순금 1개 = 4320pt (manufactFormulas formula 4)
const EXP_PT_PER_EXP = 10.8; // 중급작전기록 10800pt / 1000exp (formula 3)
// ⚠ 유일하게 게임 데이터에 없는 상수 — 무역소 주문 보상이 테이블에 없어 통용값을 쓴다
// (sanity.json goldLmd, 화면 각주에 그대로 밝힌다)
const GOLD_LMD = SANITY.goldLmd;
/** 그 칸(또는 방 종류) 효율 +1%p가 하루 만드는 이성. 환산 근거가 없는 방은 0. */
function apPerPctDay(key: string): number {
  const cell = cellByKey.get(key);
  const room = cell?.room ?? key; // roomDeltas는 여러 칸을 방 종류로 묶기도 한다
  const goldAp = (PT_DAY_1PCT / GOLD_COST_PT) * GOLD_LMD / SANITY.lmdPerAp;
  const expAp = (PT_DAY_1PCT / EXP_PT_PER_EXP) / SANITY.expPerAp;
  // 무역소는 순금을 주문으로 파는 같은 파이프라인이라 순금 1%p와 같은 가치로 본다
  if (room === "TRADING") return goldAp;
  if (room === "MANUFACTURE") {
    if (cell?.product === "exp") return expAp;
    if (cell?.product === "gold") return goldAp;
    // 칸이 묶인 경우 — 활성 레이아웃의 순금/작전기록 칸 비율로 가중
    const cells = LAYOUT.filter((c) => c.room === "MANUFACTURE");
    const gold = cells.filter((c) => c.product === "gold").length;
    const total = cells.length || 1;
    return (goldAp * gold + expAp * (total - gold)) / total;
  }
  return 0; // 발전소·사무실·응접실은 이성으로 환산할 근거가 없어 제외한다
}

export type Payback = {
  apLmd: number; apExp: number; apMat: number;  // 비용 (이성) — 용문폐 / 경험치 / 재료
  apBase: number;        // 용문폐+경험치 (기본 기준 — 사용자 지정 2026-08-05)
  apTotal: number;       // apBase + 재료
  unconverted: number;   // 이성 단가를 못 구한 재료 종수 (교환 전용·미출시)
  dailyAp: number;       // 하루 이득 (이성)
  days: number | null;        // 회수일 (용문폐+경험치 기준) — 환산 가능한 이득이 없으면 null
  daysWithMat: number | null; // 재료까지 포함한 회수일 — UI 토글로 전환
};
/** 완성 비용과 방 변화를 이성으로 환산해 회수일을 낸다. shiftHours=[A조, B조] 시간. */
export function paybackOf(cost: RaiseCost, roomDeltas: RoomDelta[], shiftHours?: number[]): Payback {
  const apLmd = cost.lmd / SANITY.lmdPerAp;
  const apExp = cost.exp / SANITY.expPerAp;
  let apMat = 0;
  let unconverted = 0;
  for (const [iid, ct] of cost.items) {
    const unit = SANITY.items[iid];
    if (unit == null) { unconverted += 1; continue; }
    apMat += unit * ct;
  }
  const hours = [shiftHours?.[0] ?? 12, shiftHours?.[1] ?? 12];
  const span = hours[0] + hours[1] || 24;
  let dailyAp = 0;
  for (const d of roomDeltas) {
    const per = apPerPctDay(d.key);
    if (!per) continue;
    dailyAp += (d.after - d.before) * per * ((hours[d.shift] ?? 12) / span);
  }
  // 기본 회수일은 **용문폐+경험치만** 본다 — 재료는 주간 파밍으로 자연히 쌓이는 성격이라
  // 이성 환산 논쟁이 크고, 유저가 버튼으로 켤 때만 합산한다 (사용자 지정 2026-08-05)
  const apBase = apLmd + apExp;
  const apTotal = apBase + apMat;
  return { apLmd, apExp, apMat, apBase, apTotal, unconverted, dailyAp,
           days: dailyAp > 0 ? apBase / dailyAp : null,
           daysWithMat: dailyAp > 0 ? apTotal / dailyAp : null };
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
  const rooms = roomOfFor(plan, shift);
  const cells = cellOfFor(plan, shift);
  const ambient = aurasOf(teamAt(plan, "CONTROL", shift, byId), ctxFor("CONTROL", points, counts, plan.plants, present, undefined, rooms, cells));
  return teamScore(teamAt(plan, key, shift, byId), cell.room, ctxFor(key, points, counts, plan.plants, present, ambient, rooms, cells));
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
  fromLevel?: number;            // 비용 계산에 쓴 현재 레벨 (보유 설정 입력값 · 미지정이면 없음)
  aGain: number;                 // A조 방 %효율 변화 합계(%p) — 표시·랭킹 기준(주력 조 우선)
  bGain: number;                 // B조(회복 교대) 방 %효율 변화 합계(%p)
  deltaScore: number;            // 내부 ΔplanScore (재배치 잡음 가드용 — 표시 안 함)
  synergy: boolean;              // 시너지 조각으로 판정돼 전체 최적화로 평가됨 (표시 힌트)
  roomDeltas: RoomDelta[];       // 바뀐 생산·무역·발전·사무실·응접실 방·조
  placement: { key: string; shift: number } | null; // raised 편성에서 이 오퍼 위치
  cost: RaiseCost;
  payback?: Payback;             // 이성 환산 회수일 (근거는 UI가 그대로 밝힌다)
};

export type InvestProgress = { done: number; total: number; opId?: string };

// 로스터를 정예화 반영해 스탬프 + id 맵. current = eliteById에 없으면 성급 최대 가정.
function stampRoster(visibleOps: InfraOp[], ownedIds: Set<string>, eliteById: Map<string, Elite>, override?: { id: string; elite: Elite }, levelById?: Map<string, number>) {
  const roster: InfraOp[] = [];
  const byId = new Map<string, InfraOp>();
  for (const op of visibleOps) {
    if (!ownedIds.has(op.id)) continue;
    const elite = override && override.id === op.id ? override.elite : eliteById.get(op.id) ?? maxElite(op.rarity);
    const stamped = withElite(op, elite, levelById?.get(op.id));
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
function candidateInfo(rawOp: InfraOp, target: Elite, current: Elite, baseline: Plan, byId0: Map<string, InfraOp>, level?: number): { pass: boolean; synergy: boolean } {
  // 목표는 정예화 1 이상이라 레벨 잠금이 없다 — 현재 상태에만 레벨을 먹여, 노정예 Lv.30
  // 미만이라 잠겨 있던 스킬도 '정예화하면 새로 열리는 것'으로 정확히 잡힌다
  const raised = withElite(rawOp, target);
  const base = withElite(rawOp, current, level);
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
  pinnedDorms: Record<string, string[]> = {},  // 사용자가 숙소에 고정한 인원 — 반사실도 같은 기지 조건에서
  levelById: Map<string, number> = new Map(),  // 오퍼 레벨 — 노정예 'Lv.30' 스킬이 잠긴 상태를 베이스라인에 반영
): Promise<RaiseRec[]> {
  const cur = (op: InfraOp): Elite => eliteById.get(op.id) ?? maxElite(op.rarity);
  // 정예화는 **지정이 없으면 만정예로 간주**하므로(성급 상한), 보유 설정에서 아무도 낮춰 두지
  // 않았으면 완성할 게 없어 후보가 수학적으로 0이다. 그런데도 베이스라인 전체 optimize를
  // 끝까지 돌린 뒤 빈 결과를 보여줬다 — 보유 405명이면 16초(모바일은 3~10배)를 통째로 버린다.
  // 후보 유무는 optimize 없이 판정되므로 먼저 끊는다 (2026-07-25).
  if (!visibleOps.some((op) => ownedIds.has(op.id) && raiseTarget(op, cur(op)) != null)) return [];
  const { roster: baseRoster, byId: byId0 } = stampRoster(visibleOps, ownedIds, eliteById, undefined, levelById);
  // 베이스라인 편성 + 그 편성이 고른 전략(토큰·시너지 세트) — 순수 가산 후보 평가에 재사용
  // park = 베이스라인이 채택한 숙소 파킹 여부 — 반사실도 같은 전략으로 지어야 ΔplanScore가 공정하다
  // 반사실은 베이스라인이 **실제로 쓴 전략 그대로** 지어야 한다 — 토큰·세트·파킹만 맞추고
  // 시드(캡 확장·밀려난 생성원)·제외 명단(사슬 전환자)·용량 결집 on/off를 빠뜨리면, 반사실이
  // 통째로 상수만큼 낮게 지어져 그 상수가 모든 후보의 ΔS에서 똑같이 깎인다. 실계정 404명
  // 박스에서 −1.521이 걸려 후보 66건이 전부 음수 → **추천 0건**이었다 (2026-07-30).
  const { plan: baseline, tokenChoice, factionSets, park, seeds, excluded, capCluster, shiftTiebreak } =
    await optimizeConfig(baseRoster, priority, undefined, pinnedDorms);
  const S0 = planScore(baseline, byId0);
  const droppedIds = new Set(excluded);

  type Cand = { op: InfraOp; from: Elite; to: Elite; synergy: boolean };
  const candidates: Cand[] = [];
  for (const op of visibleOps) {
    if (!ownedIds.has(op.id)) continue;
    if (AUTO_BENCH_IDS.has(op.id)) continue; // 자동편성 제외 명단(케이퍼·인포서)은 완성해도 편성이 안 바뀐다
    const from = cur(op);
    const to = raiseTarget(op, from);
    if (to == null) continue;
    const info = candidateInfo(op, to, from, baseline, byId0, levelById.get(op.id));
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
    // 베이스라인이 로스터에서 뺐던 오퍼는 반사실에서도 뺀다 (후보 본인이면 그대로 두어 평가).
    const roster1 = droppedIds.size ? upRoster.filter((op) => op.id === opId || !droppedIds.has(op.id)) : upRoster;
    setCapCluster(capCluster);
    setShiftTiebreak(shiftTiebreak);
    for (const cfg of configs) {
      // ⑤(우선 생산 집중)는 planScore 중립(gold↔exp 등량 재배치)이라 육성 이득 델타를 안 바꾸고
      // config 비교만 교란하므로 끈다 — 반사실 평가는 ⑤-무관 원가치로 본다 (planner-engine 참고).
      const plan = buildPlan(tokenChoice, roster1, cfg, priority, seeds, false, park, pinnedDorms);
      const score = planScore(plan, byId1);
      if (score > bestS) { bestS = score; best = plan; }
    }
    setCapCluster(true);
    setShiftTiebreak(true);
    return { plan: best!, score: bestS };
  };

  const recs: RaiseRec[] = [];
  for (let i = 0; i < evalList.length; i += 1) {
    const { op, from, to, synergy } = evalList[i];
    if (onProgress) await onProgress({ done: i, total: evalList.length, opId: op.id });
    const { byId: byId1 } = stampRoster(visibleOps, ownedIds, eliteById, { id: op.id, elite: to }, levelById);
    const upRoster = [...byId1.values()];
    const { plan, score: S1 } = evalCandidate(upRoster, byId1, op.id);
    const deltaScore = S1 - S0;
    if (deltaScore <= EPS) continue;                 // 이득 없음/음수(휴리스틱 잡음) → 억제
    const placement = placementOf(plan, op.id);
    if (!placement) continue;                        // 근무 방에 안 앉으면 귀속 실패 → 억제

    const cellDeltas: RoomDelta[] = [];
    for (const key of reportedCells()) {
      for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
        const before = cellEff(baseline, key, shift, byId0);
        const after = cellEff(plan, key, shift, byId1);
        if (Math.abs(after - before) < 0.05) continue;
        cellDeltas.push({ key, shift, before, after });
      }
    }
    // 같은 종류 방끼리 팀이 통째로 자리를 맞바꾼 것(제조소3↔제조소4)은 **어느 칸이 어느 팀인지가
    // 임의**일 뿐 실제 변화가 아니다. 칸 단위로 보면 한쪽이 -72%p로 잡혀 아래 하락 가드에
    // 걸려버리므로(육성 추천이 통째로 0건이던 원인, 2026-07-25), 한 종류·한 조에서 두 칸 이상이
    // 바뀌었으면 **방 종류 단위로 합산**해 판정하고 표시한다 — "제조소 B조 280% → 290%".
    const groups = new Map<string, RoomDelta[]>();
    for (const d of cellDeltas) {
      const room = cellByKey.get(d.key)?.room ?? d.key;
      const tag = `${room}/${d.shift}`;
      groups.set(tag, [...(groups.get(tag) ?? []), d]);
    }
    const roomDeltas: RoomDelta[] = [];
    for (const [tag, list] of groups) {
      if (list.length === 1) { roomDeltas.push(list[0]); continue; }
      const room = tag.split("/")[0];
      const before = list.reduce((sum, d) => sum + d.before, 0);
      const after = list.reduce((sum, d) => sum + d.after, 0);
      if (Math.abs(after - before) < 0.05) continue;  // 순수 자리 맞바꿈 — 표시할 변화 없음
      roomDeltas.push({ key: room, shift: list[0].shift, before, after });
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
    const fromLevel = levelById.get(op.id);
    const cost = raiseCost(op.id, from, to, fromLevel);
    recs.push({ opId: op.id, from, to, fromLevel, aGain, bGain, deltaScore, synergy, roomDeltas, placement, cost,
                payback: paybackOf(cost, roomDeltas, baseline.shiftHours) });
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
