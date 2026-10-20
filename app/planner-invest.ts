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
import obtainData from "./data/op-obtain.json";
import { acquireOf } from "./op-acquire";
import sanityData from "./data/sanity.json";
import {
  optimizeConfig, buildPlan, planScore, setPriorityMode, teamScore, opSolo, withElite, maxElite, eliteLocks, setCapCluster, setShiftTiebreak,
  availableSetKeys, synergySetMembers, cellByKey, LAYOUT, aurasOf, ctxFor, presentIdsFor, roomOfFor, cellOfFor, SHIFT_COUNT, AUTO_BENCH_IDS,
  apPerPctDay, planTokensAt, setActive,
  type InfraOp, type Elite, type Plan, type ProdPriority, type FactionSets, type RoomPin, type OptimizeResult,
} from "./planner-engine";

type CostPhase = { lmd: number; items: [string, number][] };
type LevelPhase = { lmd: number; items: [string, number][]; maxLv: number; exp: number };
type OpCost = { elite?: (CostPhase | null)[]; levels?: LevelPhase[] };
const OPS_COST = (costsData as unknown as { ops: Record<string, OpCost> }).ops;

// 보고 대상 방 (설명용 %효율 변화). 제조소·무역소·발전소·사무실·응접실. 제어센터 변화는
// 버프받는 방 델타로 자연히 드러나므로 뺀다. 가공소·숙소·훈련실은 planScore 무관/무의미.
// ⚠ 칸 목록을 하드코딩하면 배치 프리셋(153의 제조소 5칸·252·그외)에서 칸이 새거나 없는
// 칸을 보게 된다 — 활성 LAYOUT에서 방 종류로 골라 쓴다 (2026-07-25).
const REPORTED_ROOMS = new Set(["MANUFACTURE", "TRADING", "POWER", "HIRE", "MEETING"]);
const reportedCells = () => LAYOUT.filter((cell) => REPORTED_ROOMS.has(cell.room)).map((cell) => cell.key);
// 기여 판정용 근무 방 — 여기 배치돼야 "실제로 일하는" 것으로 본다 (숙소·가공소·훈련실 제외)
// 숙소도 넣는다 (2026-10-19) — 숙소에 앉아 피로도 회복·기지 동반 조건으로 이득을 내는 오퍼도 있다. 이득이 없으면 어차피 아래에서 걸러진다
const WORK_ROOMS = new Set(["MANUFACTURE", "TRADING", "POWER", "CONTROL", "HIRE", "MEETING", "DORMITORY"]);
const CAND_CAP = 240;     // 정밀 평가 후보 상한 — 안전장치. 여러 워커로 나눠 돌리므로 넉넉히 (2026-10-19, 종전 140은 저성급부터 잘렸다)
const PAIR_CAP = 40;      // 짝 후보(둘 다 키워야 열리는 시너지) 평가 상한
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
// 방 효율 +1%p의 하루 이성 환산은 엔진(apPerPctDay)으로 옮겼다 — 재활용소 배치 비교(§11)가 같은
// 환산을 써야 해서다. 상수(1포인트/초·순금 4,320pt·중급작전기록 10,800pt/1,000exp·순금 = 용문폐
// goldLmd(유일한 추정 상수, 화면 각주에 밝힘))와 계산은 종전과 한 글자도 다르지 않다.
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
  const points = planTokensAt(plan, byId, shift);
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
  /** 같이 키워야 열리는 짝 (2026-10-19) — 있으면 비용·이득·방 변화는 둘을 함께 완성한 값이다.
   *  한 명씩만 올려 보는 평가로는 '둘 다 미완성인 토큰·세트 짝'이 각자 이득 0으로 영영 안 나왔다 */
  with?: { opId: string; from: Elite; to: Elite; fromLevel?: number }[];
  /** 아직 없는 오퍼 — 데려와서(뽑기·공채·상점) 키우면 (2026-10-19). 비용은 Lv.1 부터의 육성만, 데려오는 값은 운이라 안 넣는다 */
  fresh?: boolean;
  /** 데려오는 길 — standard 통상 헤드헌팅 · kernel 커널 · recruit 공채 · cert 자격증 상점 · credit 크레딧 교역소 */
  obtain?: string[];
  aGain: number;                 // A조 방 %효율 변화 합계(%p) — 표시용
  bGain: number;                 // B조(회복 교대) 방 %효율 변화 합계(%p)
  deltaScore: number;            // 내부 ΔplanScore (재배치 잡음 가드용 — 표시 안 함)
  synergy: boolean;              // 시너지 조각으로 판정돼 전체 최적화로 평가됨 (표시 힌트)
  roomDeltas: RoomDelta[];       // 바뀐 생산·무역·발전·사무실·응접실 방·조
  placement: { key: string; shift: number } | null; // raised 편성에서 이 오퍼 위치
  /** 교대 시계 [A조, B조] 시간 — 피로도 소모가 바뀌어 A조가 더 오래 버티면 (2026-10-19) */
  hours?: { before: number[]; after: number[] };
  cost: RaiseCost;
  payback?: Payback;             // 이성 환산 회수일 (근거는 UI가 그대로 밝힌다)
};
/** 목록·숨기기·선택의 열쇠 — 짝 카드는 같은 오퍼의 단독 카드와 따로 센다 */
export const recKey = (r: Pick<RaiseRec, "opId" | "with">): string => (r.with?.length ? [r.opId, ...r.with.map((w) => w.opId)].join("+") : r.opId);
/** 이 추천이 완성하는 오퍼 전부 (본인 + 짝) */
export const recOps = (r: RaiseRec): { opId: string; to: Elite }[] => [{ opId: r.opId, to: r.to }, ...(r.with ?? []).map((w) => ({ opId: w.opId, to: w.to }))];

export type InvestProgress = { done: number; total: number; opId?: string };

// 로스터를 정예화 반영해 스탬프 + id 맵. current = eliteById에 없으면 성급 최대 가정.
function stampRoster(visibleOps: InfraOp[], ownedIds: Set<string>, eliteById: Map<string, Elite>, overrides?: { id: string; elite: Elite }[], levelById?: Map<string, number>) {
  const roster: InfraOp[] = [];
  const byId = new Map<string, InfraOp>();
  const over = new Map((overrides ?? []).map((o) => [o.id, o.elite]));
  for (const op of visibleOps) {
    if (!ownedIds.has(op.id) && !over.has(op.id)) continue;   // 새로 데려오는 후보(미보유)는 덮어쓰기로 들어온다
    const elite = over.get(op.id) ?? eliteById.get(op.id) ?? maxElite(op.rarity);
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
function candidateInfo(rawOp: InfraOp, target: Elite, current: Elite, baseline: Plan, byId0: Map<string, InfraOp>, level?: number, fresh = false): { pass: boolean; synergy: boolean; gained: InfraOp["skills"] } {
  // 목표는 정예화 1 이상이라 레벨 잠금이 없다 — 현재 상태에만 레벨을 먹여, 노정예 Lv.30
  // 미만이라 잠겨 있던 스킬도 '정예화하면 새로 열리는 것'으로 정확히 잡힌다
  const raised = withElite(rawOp, target);
  const base = withElite(rawOp, current, level);
  const baseSkills = new Set(fresh ? [] : base.skills.map((s) => s.buffId ?? s.name));   // 새로 데려오면 스킬 전부가 새것
  const gained = raised.skills.filter((s) => !baseSkills.has(s.buffId ?? s.name));
  if (!gained.length) return { pass: false, synergy: false, gained };
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
  return { pass, synergy, gained };
}

// ── 하루 이득(이성) — 편성 전체로 잰다 (2026-10-19) ─────────────────────────────
// 종전엔 '바뀐 방의 %p 변화 × 그 방 단가 × 기준 편성의 조 시간'이었다. 그러면 ① 피로도가 줄어
// A조가 더 오래 버티는 이득(교대 시계 변화)이 통째로 빠지고 ② 정렬은 서로 단위가 다른 방의 %p를
// 그냥 더해(제조소 +10 = 사무실 +10) 했다. 이제 두 편성 각각의 '하루 산출'을 그 편성의 교대
// 시계로 섞어 빼고, 정렬도 이 값으로 낸 회수일로 한다.
// 발전소 +1%p = 드론 회복 +1% → 하루 2.4개(기본 240개 — laborRecoverTime 360초) × 1개당 제조 180초
// (manufactReduceTimeUnit, 기본 1포인트/초) — 요약 카드 드론 칸과 같은 상수(INFRA-RULES §7 드론).
// 드론을 어디에 쓰는지는 사람마다 달라 제조소 평균 단가로 친다. 사무실·응접실은 여전히 환산 근거가 없다.
const PT_DAY_1PCT = 3600 * 0.01 * 24;
const DRONE_PT_PER_PCT_DAY = 240 * 0.01 * 180;
function apPerPctInvest(key: string): number {
  const room = cellByKey.get(key)?.room ?? key;
  if (room === "POWER") return DRONE_PT_PER_PCT_DAY * (apPerPctDay("MANUFACTURE") / PT_DAY_1PCT);
  return apPerPctDay(key);
}
type Effs = Map<string, number[]>;
function effsOf(plan: Plan, byId: Map<string, InfraOp>): Effs {
  const out: Effs = new Map();
  for (const key of reportedCells()) {
    const row: number[] = [];
    for (let shift = 0; shift < SHIFT_COUNT; shift += 1) row.push(cellEff(plan, key, shift, byId));
    out.set(key, row);
  }
  return out;
}
const hoursOf = (plan: Plan) => [plan.shiftHours?.[0] ?? 12, plan.shiftHours?.[1] ?? 12];
function dailyApOf(p0: Plan, e0: Effs, p1: Plan, e1: Effs): number {
  const h0 = hoursOf(p0); const h1 = hoursOf(p1);
  const s0 = h0[0] + h0[1] || 24; const s1 = h1[0] + h1[1] || 24;
  let ap = 0;
  for (const [key, before] of e0) {
    const per = apPerPctInvest(key);
    if (!per) continue;
    const after = e1.get(key) ?? before;
    for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
      ap += ((after[shift] ?? 0) * (h1[shift] ?? 0) / s1 - (before[shift] ?? 0) * (h0[shift] ?? 0) / s0) * per;
    }
  }
  return ap;
}
function paybackFrom(cost: RaiseCost, dailyAp: number): Payback {
  const p = paybackOf(cost, []);
  return { ...p, dailyAp, days: dailyAp > 0 ? p.apBase / dailyAp : null, daysWithMat: dailyAp > 0 ? p.apTotal / dailyAp : null };
}
const sumCost = (list: RaiseCost[]): RaiseCost => {
  const items = new Map<string, number>();
  let lmd = 0; let exp = 0;
  for (const c of list) { lmd += c.lmd; exp += c.exp; for (const [id, n] of c.items) items.set(id, (items.get(id) ?? 0) + n); }
  return { lmd, exp, items: [...items.entries()] };
};

// ── 1단계: 기준 편성 + 후보 목록 ─────────────────────────────────────────────
// 단계를 나눈 까닭 (2026-10-19 "생각보다 오래 걸린다"): 기준 편성(전체 자동편성 = 실측 11.5초)은
// ① 방금 자동편성을 돌렸으면 그 결과(base)를 그대로 받아 건너뛰고, 후보 평가(후보 100명 × 재편성 ≈ 12초)는
// ② 여러 워커에 나눠 동시에 돌린다(planner-offload). 단계마다 입력·출력이 전부 직렬화 가능한 값이다.
export type InvestCand = { opId: string; from: Elite; to: Elite; synergy: boolean; with?: { opId: string; from: Elite; to: Elite }[]; fresh?: boolean; obtain?: string[] };

// 새로 데려와 키우는 후보 (2026-10-19, 사용자 "가진 오퍼를 키우는 것도 필요하지만 새로 뽑아서 키우는 것도 추천 중 하나") —
// 지금 손에 넣을 수 있는 길이 있는 오퍼만: 통상·커널 헤드헌팅, 공채, 자격증 상점, 크레딧 교역소. 한정·콜라보·이벤트 배포·
// 통합전략 보상은 지금 데려올 수 없어 뺀다.
const OBTAIN_ROUTE = (obtainData as unknown as { ops: Record<string, string[]> }).ops;
export function obtainableNow(id: string): string[] {
  const out: string[] = acquireOf(id).filter((k) => k === "standard" || k === "kernel" || k === "recruit");
  const route = OBTAIN_ROUTE[id]?.[0];
  if (route === "cert" || route === "credit") out.push(route);
  return out;
}
const FRESH_CAP = 80;
export type InvestSetup = { base: OptimizeResult; cands: InvestCand[] };
export type InvestInput = {
  visibleOps: InfraOp[]; ownedIds: Set<string>; eliteById: Map<string, Elite>; priority: ProdPriority;
  pinnedDorms: Record<string, string[]>; levelById: Map<string, number>; roomPins: Record<string, RoomPin[]>;
};

/** 후보가 하나라도 있나 — 없으면 기준 편성조차 짤 필요가 없다 (전원 만정예 간주, 2026-07-25) */
export function hasInvestCandidates(inp: InvestInput): boolean {
  const cur = (op: InfraOp): Elite => inp.eliteById.get(op.id) ?? maxElite(op.rarity);
  return inp.visibleOps.some((op) => (inp.ownedIds.has(op.id) ? raiseTarget(op, cur(op)) != null : !op.unreleased && obtainableNow(op.id).length > 0));
}

export async function investPrepare(inp: InvestInput, base?: OptimizeResult | null): Promise<InvestSetup | null> {
  const { visibleOps, ownedIds, eliteById, priority, pinnedDorms, levelById, roomPins } = inp;
  if (!hasInvestCandidates(inp)) return null;
  const cur = (op: InfraOp): Elite => eliteById.get(op.id) ?? maxElite(op.rarity);
  const { roster: baseRoster, byId: byId0 } = stampRoster(visibleOps, ownedIds, eliteById, undefined, levelById);
  // 반사실은 베이스라인이 **실제로 쓴 전략 그대로** 지어야 한다 — 토큰·세트·파킹·시드·제외 명단·
  // 결집 on/off 중 하나라도 빠지면 모든 후보의 ΔS 가 같은 상수만큼 깎여 추천이 0건이 된다 (2026-07-30)
  const cfg = base ?? await optimizeConfig(baseRoster, priority, undefined, pinnedDorms, roomPins);
  const baseline = cfg.plan;

  type Raw = InvestCand & { gained: InfraOp["skills"] };
  const singles: Raw[] = [];
  for (const op of visibleOps) {
    if (!ownedIds.has(op.id)) continue;
    if (AUTO_BENCH_IDS.has(op.id)) continue; // 자동편성 제외 명단(케이퍼·인포서)은 완성해도 편성이 안 바뀐다
    const from = cur(op);
    const to = raiseTarget(op, from);
    if (to == null) continue;
    const info = candidateInfo(op, to, from, baseline, byId0, levelById.get(op.id));
    if (!info.pass) continue;
    singles.push({ opId: op.id, from, to, synergy: info.synergy, gained: info.gained });
  }
  // 상한은 안전장치 — 넘으면 시너지 먼저, 그다음 **싼 쪽(저성급)** 먼저 남긴다. 종전엔 고성급 먼저라
  // 가성비 좋은 3·4성이 평가도 못 받고 잘렸다 (2026-10-19)
  const rarity = (id: string) => byId0.get(id)?.rarity ?? 0;
  const rawById = new Map(visibleOps.map((op) => [op.id, op]));
  const rarity2 = (id: string) => rawById.get(id)?.rarity ?? 0;
  singles.sort((a, b) => (b.synergy ? 1 : 0) - (a.synergy ? 1 : 0) || rarity(a.opId) - rarity(b.opId) || a.opId.localeCompare(b.opId));
  const kept = singles.slice(0, CAND_CAP);

  // 짝 — 둘 다 미완성이라 한 명씩 올려서는 안 열리는 시너지. 새로 열리는 스킬끼리 이어진 것만:
  // 토큰(한쪽이 새로 만들고 한쪽이 새로 씀) · 지정 동료(partners·basePartners) · 같은 세트(기준엔 없던 세트)
  const syn = kept.filter((c) => c.synergy);
  const pairKeys = new Set<string>();
  const pairs: [Raw, Raw][] = [];
  const addPair = (a: Raw, b: Raw) => {
    if (pairs.length >= PAIR_CAP || a.opId === b.opId) return;
    const [x, y] = a.opId < b.opId ? [a, b] : [b, a];
    const k = `${x.opId}+${y.opId}`;
    if (pairKeys.has(k)) return;
    pairKeys.add(k); pairs.push([x, y]);
  };
  const uses = (c: Raw) => new Set(c.gained.flatMap((sk) => sk.tokenUse.map((u) => u.token)));
  const gens = (c: Raw) => new Set(c.gained.flatMap((sk) => sk.tokenGen.map((g) => g.token)));
  const mates = (c: Raw) => new Set(c.gained.flatMap((sk) => [...sk.partners, ...(sk.basePartners ?? [])]));
  for (let i = 0; i < syn.length; i += 1) {
    for (let j = i + 1; j < syn.length; j += 1) {
      const a = syn[i]; const b = syn[j];
      const tok = [...uses(a)].some((x) => gens(b).has(x)) || [...uses(b)].some((x) => gens(a).has(x));
      if (tok || mates(a).has(b.opId) || mates(b).has(a.opId)) addPair(a, b);
    }
  }
  if (syn.length > 1) {
    const { roster: allUp } = stampRoster(visibleOps, ownedIds, eliteById, syn.map((c) => ({ id: c.opId, elite: c.to })), levelById);
    const before = new Set(availableSetKeys(baseRoster));
    const members = synergySetMembers(allUp);
    const synById = new Map(syn.map((c) => [c.opId, c]));
    for (const [key, ids] of Object.entries(members)) {
      if (before.has(key)) continue;
      const inSet = ids.map((id) => synById.get(id)).filter(Boolean) as Raw[];
      for (let i = 0; i < inSet.length; i += 1) for (let j = i + 1; j < inSet.length; j += 1) addPair(inSet[i], inSet[j]);
    }
  }
  const cands: InvestCand[] = kept.map(({ gained: _g, ...c }) => c);
  // 새로 데려오는 후보 — 미보유 · 실장 · 지금 데려올 길이 있음. 목표는 인프라 스킬이 다 열리는 정예화(없으면 노정예)
  const fresh: InvestCand[] = [];
  for (const op of visibleOps) {
    if (ownedIds.has(op.id) || op.unreleased || AUTO_BENCH_IDS.has(op.id)) continue;
    const obtain = obtainableNow(op.id);
    if (!obtain.length) continue;
    const to = raiseTarget(op, 0) ?? 0;
    const info = candidateInfo(op, to, 0, baseline, byId0, undefined, true);
    if (!info.pass) continue;
    fresh.push({ opId: op.id, from: 0, to, synergy: info.synergy, fresh: true, obtain });
  }
  fresh.sort((a, b) => (b.synergy ? 1 : 0) - (a.synergy ? 1 : 0) || rarity2(a.opId) - rarity2(b.opId) || a.opId.localeCompare(b.opId));
  cands.push(...fresh.slice(0, FRESH_CAP));
  for (const [a, b] of pairs) cands.push({ opId: a.opId, from: a.from, to: a.to, synergy: true, with: [{ opId: b.opId, from: b.from, to: b.to }] });
  return { base: cfg, cands };
}

// ── 2단계: 후보 평가 — 워커 여러 개가 후보를 나눠 맡는다 ───────────────────────
export function investEvaluate(inp: InvestInput, setup: InvestSetup, onEach?: (done: number, opId: string) => void): RaiseRec[] {
  const { visibleOps, ownedIds, eliteById, priority, pinnedDorms, levelById, roomPins } = inp;
  const { base, cands } = setup;
  const { tokenChoice, factionSets, park, seeds, excluded, capCluster, shiftTiebreak } = base;
  setPriorityMode(priority);
  const { roster: baseRoster, byId: byId0 } = stampRoster(visibleOps, ownedIds, eliteById, undefined, levelById);
  const droppedIds = new Set(excluded);
  // 세트 활성안은 **그 후보가 실제로 참가하는** 휴면 세트 + 완성으로 새로 가용해지는 세트만 추가 비교
  const baselineAvail = new Set(availableSetKeys(baseRoster));
  const setMembers = synergySetMembers(baseRoster);
  const dormantSets = [...baselineAvail].filter((key) => !setActive(factionSets, key));   // A조판(<키>@A)으로 켜진 세트도 켜진 것
  const evalCandidate = (upRoster: InfraOp[], byId1: Map<string, InfraOp>, ids: Set<string>): { plan: Plan; score: number } => {
    const configs: FactionSets[] = [factionSets];
    const seen = new Set(Object.keys(factionSets));
    for (const key of dormantSets) if (!seen.has(key) && setMembers[key]?.some((id) => ids.has(id))) { configs.push({ ...factionSets, [key]: true }); seen.add(key); }
    for (const key of availableSetKeys(upRoster)) if (!baselineAvail.has(key) && !seen.has(key)) { configs.push({ ...factionSets, [key]: true }); seen.add(key); }
    let best: Plan | null = null;
    let bestS = -Infinity;
    // 베이스라인이 로스터에서 뺐던 오퍼는 반사실에서도 뺀다 (후보 본인이면 그대로 두어 평가).
    const roster1 = droppedIds.size ? upRoster.filter((op) => ids.has(op.id) || !droppedIds.has(op.id)) : upRoster;
    setCapCluster(capCluster);
    setShiftTiebreak(shiftTiebreak);
    for (const cfg of configs) {
      // ⑤(우선 생산 집중)는 planScore 중립이라 육성 이득 델타를 안 바꾸고 config 비교만 교란하므로 끈다
      const plan = buildPlan(tokenChoice, roster1, cfg, priority, seeds, false, park, pinnedDorms, roomPins);
      const score = planScore(plan, byId1);
      if (score > bestS) { bestS = score; best = plan; }
    }
    setCapCluster(true);
    setShiftTiebreak(true);
    return { plan: best!, score: bestS };
  };

  // 기준 편성도 반사실과 **같은 절차(buildPlan, ⑤ 끔)로 다시 짓는다** — base 가 앞서 저장해 둔 자동편성 결과라
  // 엔진이 그새 바뀌었어도(배포) 비교 대상이 같은 엔진·같은 전략에서 나와 ΔS 에 상수 편향이 끼지 않는다 (2026-10-19)
  const roster0 = droppedIds.size ? baseRoster.filter((op) => !droppedIds.has(op.id)) : baseRoster;
  setCapCluster(capCluster);
  setShiftTiebreak(shiftTiebreak);
  const baseline = buildPlan(tokenChoice, roster0, factionSets, priority, seeds, false, park, pinnedDorms, roomPins);
  setCapCluster(true);
  setShiftTiebreak(true);
  const S0 = planScore(baseline, byId0);
  const effs0 = effsOf(baseline, byId0);

  const recs: RaiseRec[] = [];
  cands.forEach((c, i) => {
    onEach?.(i, c.opId);
    const ups = [{ id: c.opId, elite: c.to }, ...(c.with ?? []).map((w) => ({ id: w.opId, elite: w.to }))];
    const ids = new Set(ups.map((u) => u.id));
    const { byId: byId1 } = stampRoster(visibleOps, ownedIds, eliteById, ups, levelById);
    const { plan, score: S1 } = evalCandidate([...byId1.values()], byId1, ids);
    const deltaScore = S1 - S0;
    if (deltaScore <= EPS) return;                   // 이득 없음/음수(휴리스틱 잡음) → 억제
    const placement = placementOf(plan, c.opId);
    if (!placement) return;                          // 근무 방에 안 앉으면 귀속 실패 → 억제
    if ((c.with ?? []).some((w) => !placementOf(plan, w.opId))) return;   // 짝도 앉아야 짝 추천이다

    const effs1 = effsOf(plan, byId1);
    const cellDeltas: RoomDelta[] = [];
    for (const [key, before] of effs0) {
      const after = effs1.get(key) ?? before;
      for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
        if (Math.abs((after[shift] ?? 0) - (before[shift] ?? 0)) < 0.05) continue;
        cellDeltas.push({ key, shift, before: before[shift] ?? 0, after: after[shift] ?? 0 });
      }
    }
    // 같은 종류 방끼리 팀이 통째로 자리를 맞바꾼 것(제조소3↔제조소4)은 실제 변화가 아니다 — 한 종류·한 조에서
    // 두 칸 이상이 바뀌었으면 **방 종류 단위로 합산**해 판정하고 표시한다 (2026-07-25)
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
    // 교대 시계 — 피로도가 줄어 A조가 더 오래 버티는 것도 이득이다 (15분 넘게 바뀌었을 때만 보인다)
    const h0 = hoursOf(baseline); const h1 = hoursOf(plan);
    const hoursMoved = Math.abs(h1[0] - h0[0]) >= 0.25 || Math.abs(h1[1] - h0[1]) >= 0.25;
    if (!roomDeltas.length && !hoursMoved) return;   // 보여줄 변화가 없으면(제어·훈련만 미세 변동) 억제
    // 재배치 잡음 억제 — 어떤 방이 눈에 띄게 하락했는데 총이득이 작으면 그리디가 다른 방을 뒤섞은 부작용이다
    const hasDrop = roomDeltas.some((d) => d.after < d.before - DROP_TOL);
    if (hasDrop && deltaScore < SYNERGY_MIN) return;

    const aGain = roomDeltas.reduce((sum, d) => (d.shift === 0 ? sum + (d.after - d.before) : sum), 0);
    const bGain = roomDeltas.reduce((sum, d) => (d.shift === 1 ? sum + (d.after - d.before) : sum), 0);
    const fromLevel = c.fresh ? undefined : levelById.get(c.opId);
    const withList = (c.with ?? []).map((w) => ({ ...w, fromLevel: levelById.get(w.opId) }));
    const cost = sumCost([raiseCost(c.opId, c.from, c.to, fromLevel), ...withList.map((w) => raiseCost(w.opId, w.from, w.to, w.fromLevel))]);
    const dailyAp = dailyApOf(baseline, effs0, plan, effs1);
    // 총점(ΔS)은 올랐는데 이성으로 환산되는 산출은 줄었다 — 사무실·응접실 같은 환산 밖 방이 오르는 대신 생산이 깎인 것.
    // '키우면 좋아진다'고 내밀 수 없다 (2026-10-19 실측: 플레임테일 하루 −2.1)
    if (dailyAp < -0.1) return;
    recs.push({ opId: c.opId, from: c.from, to: c.to, fromLevel, ...(withList.length ? { with: withList } : {}),
                ...(c.fresh ? { fresh: true, obtain: c.obtain } : {}),
                aGain, bGain, deltaScore, synergy: c.synergy, roomDeltas, placement,
                ...(hoursMoved ? { hours: { before: h0, after: h1 } } : {}), cost,
                payback: paybackFrom(cost, dailyAp) });
  });
  return recs;
}

// ── 3단계: 거르기·정렬 ────────────────────────────────────────────────────────
// 정렬 = **회수 빠른 순** (2026-10-19, 종전 'A조 %p 합계 큰 순'). %p 합계는 비용을 안 보고(재료 수십 개짜리
// 6성 2정예화가 용문폐 몇만짜리 4성 위로), 단위가 다른 방을 그냥 더했다. 회수일 = 용문폐·경험치 이성 ÷ 하루
// 이득(이성) — 화면 기본 표시와 같은 기준. 환산이 안 되는 추천(사무실·응접실만 바뀜)은 그 뒤에 %p 합계순.
export function rankRaises(recs: RaiseRec[]): RaiseRec[] {
  // 짝 카드는 **각자 따로 키운 것의 합보다 확실히 나을 때만** — 아니면 단독 카드로 충분하다
  const single = new Map(recs.filter((r) => !r.with).map((r) => [r.opId, r]));
  const kept = recs.filter((r) => {
    if (!r.with?.length) return true;
    const alone = recOps(r).reduce((sum, o) => sum + (single.get(o.opId)?.deltaScore ?? 0), 0);
    return r.deltaScore > alone + 1;
  });
  const daysOf = (r: RaiseRec) => (r.payback && r.payback.dailyAp > 0 && r.payback.days != null ? r.payback.days : null);
  return kept.sort((a, b) => {
    const da = daysOf(a); const db = daysOf(b);
    if (da != null && db != null) return da - db || b.deltaScore - a.deltaScore;
    if (da != null) return -1;
    if (db != null) return 1;
    return (b.aGain + b.bGain) - (a.aGain + a.bGain) || b.deltaScore - a.deltaScore;
  });
}

// 한 번에 — 하네스·워커 없는 폴백용. 화면은 planner-offload 가 단계별로 나눠 부른다.
export async function recommendRaises(
  visibleOps: InfraOp[],
  ownedIds: Set<string>,
  eliteById: Map<string, Elite>,
  priority: ProdPriority = "gold",
  onProgress?: (p: InvestProgress) => void | Promise<void>,
  pinnedDorms: Record<string, string[]> = {},  // 사용자가 숙소에 고정한 인원 — 반사실도 같은 기지 조건에서
  levelById: Map<string, number> = new Map(),  // 오퍼 레벨 — 노정예 'Lv.30' 스킬이 잠긴 상태를 베이스라인에 반영
  roomPins: Record<string, RoomPin[]> = {},   // 생산방 고정 인원 — 숙소 고정과 같은 이유로 관통 (조별 고정 포함)
  base?: OptimizeResult | null,               // 방금 자동편성의 결과 — 있으면 기준 편성을 다시 짜지 않는다
): Promise<RaiseRec[]> {
  const inp: InvestInput = { visibleOps, ownedIds, eliteById, priority, pinnedDorms, levelById, roomPins };
  const setup = await investPrepare(inp, base);
  if (!setup) return [];
  const total = setup.cands.length;
  const recs = investEvaluate(inp, setup, (done, opId) => { void onProgress?.({ done, total, opId }); });
  if (onProgress) await onProgress({ done: total, total });
  return rankRaises(recs);
}
