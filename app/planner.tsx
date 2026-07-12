"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { feedbackReady, sendFeedback } from "./feedback";
import infraData from "./data/infra.json";

type TokenGen = { token: string; estimate: number; perMember?: { per: number; cap: number; match: string } };
type TokenUse = { token: string; per: number; value: number; percent: boolean };

type InfraSkill = {
  name: string;
  room: string;
  unlock: string;
  description: string;
  kind: string;
  value: number;
  product: string;
  group: string;
  tier: number;
  moraleDrain: number;
  partners: string[];
  tokenGen: TokenGen[];
  tokenUse: TokenUse[];
  convert: { from: string; per: number; to: string; amount: number } | null;
  facilityBased?: boolean;
  basePartners?: string[];      // 기지 어디든(숙소 포함) 있으면 발동하는 동반 조건
  basePartnerBonus?: number | null; // 위 조건 충족 시 추가 효율 (언더플로우 +10)
  reqFaction: string | null;
  perFaction: string | null;
  perScope: string | null;
  perCap: number | null;
  perSkillTag: string | null;
  perSkillValue: number | null;
};

type InfraOp = {
  id: string;
  name: string;
  rarity: number;
  faction: string;
  accent: string;
  image: string;
  seq: number;
  skills: InfraSkill[];
};

type RoomSpec = { name: string; slots: number; electricity: number; maxCount: number };

const infra = infraData as { rooms: Record<string, RoomSpec>; ops: InfraOp[] };
const ops = infra.ops;
const opById = new Map(ops.map((op) => [op.id, op]));

const ELITE2_UNLOCK = "정예화 2";

// 1정(정예화 1) 오퍼는 정예화 2에서 해금되는 인프라 스킬을 아직 못 씀 — 미지정 시 2정(최대) 가정
function withElite(op: InfraOp, elite: 1 | 2 | undefined): InfraOp {
  if (elite !== 1) return op;
  const skills = op.skills.filter((skill) => skill.unlock !== ELITE2_UNLOCK);
  return skills.length === op.skills.length ? op : { ...op, skills };
}

// 243 layout: gold ×2 + battle-record ×2 factories, two 12h crews per day
const LAYOUT: { key: string; room: string; label: string; product?: string }[] = [
  { key: "TRADING-0", room: "TRADING", label: "무역소 1" },
  { key: "TRADING-1", room: "TRADING", label: "무역소 2" },
  { key: "MANUFACTURE-0", room: "MANUFACTURE", label: "제조소 1 · 순금", product: "gold" },
  { key: "MANUFACTURE-1", room: "MANUFACTURE", label: "제조소 2 · 순금", product: "gold" },
  { key: "MANUFACTURE-2", room: "MANUFACTURE", label: "제조소 3 · 작전기록", product: "exp" },
  { key: "MANUFACTURE-3", room: "MANUFACTURE", label: "제조소 4 · 작전기록", product: "exp" },
  { key: "POWER-0", room: "POWER", label: "발전소 1" },
  { key: "POWER-1", room: "POWER", label: "발전소 2" },
  { key: "POWER-2", room: "POWER", label: "발전소 3" },
  { key: "CONTROL", room: "CONTROL", label: "제어 센터" },
  { key: "MEETING", room: "MEETING", label: "응접실" },
  { key: "WORKSHOP", room: "WORKSHOP", label: "가공소" },
  { key: "HIRE", room: "HIRE", label: "사무실" },
  { key: "TRAINING", room: "TRAINING", label: "훈련실" },
  { key: "DORM-0", room: "DORMITORY", label: "숙소 1" },
  { key: "DORM-1", room: "DORMITORY", label: "숙소 2" },
  { key: "DORM-2", room: "DORMITORY", label: "숙소 3" },
  { key: "DORM-3", room: "DORMITORY", label: "숙소 4" },
];

const cellByKey = new Map(LAYOUT.map((cell) => [cell.key, cell]));

const ROOM_ACCENT: Record<string, string> = {
  TRADING: "#4d9dd6", MANUFACTURE: "#e0b13e", POWER: "#b7d940", CONTROL: "#dfff00",
  MEETING: "#8f7fc0", WORKSHOP: "#c78a54", HIRE: "#6fa08a", TRAINING: "#c05f6e", DORMITORY: "#7f8ea3",
};

const UNIT: Record<string, string> = {
  MANUFACTURE: "생산력", TRADING: "오더 효율·품질", POWER: "드론 회복", MEETING: "단서 속도",
  HIRE: "연락 속도", WORKSHOP: "부산물", TRAINING: "훈련 속도", CONTROL: "지원", DORMITORY: "회복",
};

const PARK_KEYS = ["WORKSHOP"];
const SHIFT_COUNT = 2;

type Ctx = { product?: string; tokenPoints: Record<string, number>; factionCounts?: Record<string, number>; plants?: number; presentIds?: Set<string> };

function skillApplies(skill: InfraSkill, room: string, product?: string): boolean {
  if (skill.room !== room) return false;
  if (room === "MANUFACTURE" && product && skill.product !== "any" && skill.product !== product) return false;
  return true;
}

// every distinct skill line (group) applies at once; α/β tiers replace each other
function activeSkills(op: InfraOp, room: string, product?: string): InfraSkill[] {
  const byGroup = new Map<string, InfraSkill>();
  for (const skill of op.skills) {
    if (!skillApplies(skill, room, product)) continue;
    const existing = byGroup.get(skill.group);
    if (!existing || skill.tier > existing.tier) byGroup.set(skill.group, skill);
  }
  return Array.from(byGroup.values());
}

type OpBreakdown = {
  efficiency: number;   // additive order/production efficiency
  facilityEff: number;  // facility-count-based production (survives automation)
  automation: number;   // 위디·유넥티스: zeroes others, scales with plants
  quality: number;      // quality-order probability (equiv %)
  payout: number;       // quality-order payout (테킬라 — scales with quality crew)
  payoutViolation: number; // violation-order payout (프로바이조 — anti-synergy with quality crew)
  override: number;     // 샤마르: flat rate replacing everyone's efficiency
  perCoworker: number;  // +x% per other member
  auras: Record<string, number>; // control-center facility-wide auras
  skills: InfraSkill[];
};

// control auras: only the highest of a kind counts, ranked by the user's
// priority — factories > trading posts > hire contacts > clue speed
const AURA_WEIGHT: Record<string, number> = { ctrl_mfg: 10, ctrl_trade: 2, ctrl_hire: 0.6, ctrl_clue: 0.2 };

function breakdown(op: InfraOp, room: string, team: InfraOp[], ctx: Ctx): OpBreakdown {
  const teamIds = new Set(team.map((member) => member.id));
  const teamSize = Math.max(team.length, 1);
  const out: OpBreakdown = { efficiency: 0, facilityEff: 0, automation: 0, quality: 0, payout: 0, payoutViolation: 0, override: 0, perCoworker: 0, auras: {}, skills: [] };
  const tokenRates = new Map<string, number>();
  for (const skill of activeSkills(op, room, ctx.product)) {
    if (skill.partners.length > 0 && !skill.partners.every((p) => teamIds.has(p))) continue;
    // faction companion gate (호시구마: 용문근위국 오퍼와 함께 배치 시)
    if (skill.reqFaction && !team.some((member) => member.id !== op.id && member.faction === skill.reqFaction)) continue;
    out.skills.push(skill);
    // 기반시설 어디든 존재 조건 (언더플로우: 울피아누스가 숙소 포함 기지 내에 있으면 +10%)
    if (skill.basePartners?.length && skill.basePartnerBonus && skill.basePartners.every((p) => ctx.presentIds?.has(p))) {
      out.efficiency += skill.basePartnerBonus;
    }
    // per-faction counting (바르카리스: 미노스 오퍼레이터 1명당 +v%, 최대 cap)
    if (skill.perFaction && skill.perSkillTag == null) {
      const count = skill.perScope === "room"
        ? team.filter((member) => member.faction === skill.perFaction).length
        : ctx.factionCounts?.[skill.perFaction] ?? 0;
      const gained = Math.min(skill.value * count, skill.perCap ?? Infinity);
      if (skill.kind in AURA_WEIGHT) { out.auras[skill.kind] = Math.max(out.auras[skill.kind] ?? 0, gained); continue; }
      out.efficiency += gained;
      continue;
    }
    // same-room skill-tag counting (브라이오피타: 금속 공예류 스킬 1개당 +5%)
    if (skill.perSkillTag && skill.perSkillValue) {
      const tag = skill.perSkillTag;
      let count = 0;
      for (const member of team) for (const active of activeSkills(member, room, ctx.product)) {
        if (active.name.replace(/\s/g, "").includes(tag)) count += 1;
      }
      out.efficiency += skill.perSkillValue * count;
      continue;
    }
    const percentUses = skill.tokenUse.filter((use) => use.percent);
    for (const use of percentUses) {
      const rate = use.value / use.per;
      if (rate > (tokenRates.get(use.token) ?? 0)) tokenRates.set(use.token, rate);
    }
    if (skill.kind === "override") { out.override = Math.max(out.override, skill.value); continue; }
    if (skill.kind === "automation") { out.automation += skill.value * (ctx.plants ?? 3); continue; }
    // 스네구로치카: 위디·유넥티스와 같은 제로아웃이지만 발전소가 아니라 같은 방 인원수로 스케일
    if (skill.kind === "automation_crew") { out.automation += skill.value * teamSize; continue; }
    if (skill.kind === "quality") { out.quality += skill.value; continue; }
    if (skill.kind === "payout") { out.payout += skill.value; continue; }
    if (skill.kind === "payout_v") { out.payoutViolation += skill.value; continue; }
    if (skill.kind === "percoworker") { out.perCoworker += skill.value; continue; }
    if (skill.kind === "solo") { if (teamSize === 1) out.efficiency += skill.value; continue; }
    if (skill.kind === "shared") { out.efficiency += skill.value; continue; } // 단서 공유 상태 기준
    if (skill.kind in AURA_WEIGHT) { out.auras[skill.kind] = Math.max(out.auras[skill.kind] ?? 0, skill.value); continue; }
    if (room === "DORMITORY") continue;
    if (percentUses.length === 0) {
      if (skill.facilityBased) out.facilityEff += skill.value;
      else out.efficiency += skill.value;
    }
  }
  for (const [token, rate] of tokenRates) out.efficiency += (ctx.tokenPoints[token] ?? 0) * rate;
  return out;
}

function teamScore(team: InfraOp[], room: string, ctx: Ctx): number {
  const parts = team.map((op) => breakdown(op, room, team, ctx));
  const override = Math.max(...parts.map((p) => p.override), 0);
  const automation = parts.reduce((sum, p) => sum + p.automation, 0);
  const facilityEff = parts.reduce((sum, p) => sum + p.facilityEff, 0);
  const additive = parts.reduce((sum, p) => sum + p.efficiency + p.perCoworker * (team.length - 1), 0);
  // 샤마르 override zeroes everyone's efficiency; 위디·유넥티스 automation
  // zeroes operator-provided efficiency but facility-based production survives
  const efficiency = override > 0 ? override * team.length
    : automation > 0 ? automation + facilityEff
    : additive + facilityEff;
  const probCount = parts.filter((p) => p.quality > 0).length;
  const quality = parts.reduce((sum, p) => sum + p.quality, 0);
  // quality payouts (테킬라) profit from quality orders; violation payouts
  // (프로바이조) need low-count orders — quality crew works against them, but
  // a high-throughput post (우요우·에벤홀츠) multiplies her per-order bonus
  const payout = parts.reduce((sum, p) => sum + p.payout, 0) * Math.min(1 + 0.5 * probCount, 2)
    + parts.reduce((sum, p) => sum + p.payoutViolation, 0) * Math.max(1 - 0.5 * probCount, 0) * Math.min(1 + efficiency / 100, 3);
  let auras = 0;
  for (const kind of Object.keys(AURA_WEIGHT)) {
    const bestOfKind = Math.max(...parts.map((p) => p.auras[kind] ?? 0), 0);
    auras += bestOfKind * AURA_WEIGHT[kind];
  }
  return efficiency + quality + payout + auras;
}

function opSolo(op: InfraOp, room: string, slots: number, ctx: Ctx): number {
  const b = breakdown(op, room, [op], ctx);
  let auras = 0;
  for (const kind of Object.keys(AURA_WEIGHT)) auras += (b.auras[kind] ?? 0) * AURA_WEIGHT[kind];
  return b.efficiency + b.facilityEff + b.automation + b.quality + b.payout + b.payoutViolation + b.override * slots + b.perCoworker * (slots - 1) + auras;
}

function bestTeam(room: string, slots: number, pool: Map<string, InfraOp>, ctx: Ctx, seedOps: InfraOp[] = []): InfraOp[] {
  const cands = Array.from(pool.values()).filter((op) => op.skills.some((skill) => skillApplies(skill, room, ctx.product)));
  const solo = cands.map((op) => ({ op, v: opSolo(op, room, slots, ctx) })).sort((a, b) => b.v - a.v || a.op.rarity - b.op.rarity);
  const fill = (seed: InfraOp[]): InfraOp[] => {
    const team = [...seed].slice(0, slots);
    const shortlist = solo.slice(0, 40).map((entry) => entry.op);
    while (team.length < slots) {
      let pick: InfraOp | null = null;
      let pickScore = -Infinity;
      for (const op of shortlist) {
        if (team.includes(op)) continue;
        const score = teamScore([...team, op], room, ctx);
        if (score > pickScore) { pickScore = score; pick = op; }
      }
      if (!pick) break;
      team.push(pick);
    }
    return team;
  };
  let best = fill(seedOps);
  let bestScore = teamScore(best, room, ctx);
  for (const cand of cands) {
    for (const skill of cand.skills) {
      if (skill.room !== room || skill.partners.length === 0) continue;
      const seed = [...seedOps];
      if (!seed.includes(cand)) seed.push(cand);
      let valid = true;
      for (const pid of skill.partners) {
        const partner = pool.get(pid);
        if (!partner) { valid = false; break; }
        if (!seed.includes(partner)) seed.push(partner);
      }
      if (!valid || seed.length > slots) continue;
      const team = fill(seed);
      const score = teamScore(team, room, ctx);
      if (score > bestScore) { best = team; bestScore = score; }
    }
  }
  return best;
}

type FlowGenerator = { opId: string; at: string; amount: number; via?: string; perMember?: { per: number; cap: number; match: string } };
type FlowConsumer = { opId: string; at: string; room: string; rate: number; percent: boolean; gain: number };

type TokenFlow = {
  token: string;
  total: number;
  generators: FlowGenerator[];
  converters: { opId: string; from: string }[];
  consumers: FlowConsumer[];
};

type Plan = {
  assignments: Record<string, string[][]>; // roomKey -> shift -> opIds
  plants: number; // 발전소 수 (그레이 더 라이트닝베어러 배치 시 4로 간주)
  tokenPoints: Record<string, number>;
  factionCounts: Record<string, number>[]; // per shift, base-wide placements
  flows: TokenFlow[];
  strategy: string;
};

const PRODUCTION_KEYS = ["TRADING-0", "TRADING-1", "MANUFACTURE-0", "MANUFACTURE-1", "MANUFACTURE-2", "MANUFACTURE-3", "POWER-0", "POWER-1", "POWER-2"];
const SUPPORT_KEYS = ["CONTROL", "MEETING", "HIRE", "WORKSHOP", "TRAINING"];

function ctxFor(key: string, tokenPoints: Record<string, number>, factionCounts?: Record<string, number>, plants?: number, presentIds?: Set<string>): Ctx {
  return { product: cellByKey.get(key)?.product, tokenPoints, factionCounts, plants, presentIds };
}

// 해당 조 기준 기지 내 배치 전원 (숙소·응접실 포함) — 기반시설 존재 조건 판정용
function presentIdsFor(plan: Plan, shift: number): Set<string> {
  const ids = new Set<string>();
  for (const shifts of Object.values(plan.assignments)) {
    for (const id of shifts[Math.min(shift, shifts.length - 1)] ?? []) ids.add(id);
  }
  return ids;
}

function buildPlan(packageTokens: string[], roster: InfraOp[]): Plan {
  const assignments: Record<string, string[][]> = {};
  const used = new Set<string>();
  const keys = [...PRODUCTION_KEYS, ...SUPPORT_KEYS];
  for (const key of keys) assignments[key] = [];
  const tokenPoints: Record<string, number> = {};
  const flows: TokenFlow[] = [];
  const factionCountsPerShift: Record<string, number>[] = [];
  const reserved = new Map<string, string>(); // seeded ops belong to their room
  // 그레이 더 라이트닝베어러: 다른 발전소에 1성 로봇(작업 플랫폼)만 없으면
  // 발전소 +1개로 간주 — 발전소에 고정 배치하고 4기로 계산
  const plantBooster = roster.find((op) => op.skills.some((skill) => skill.kind === "plantbonus"));
  const plants = plantBooster ? 4 : 3;

  const dormPins: InfraOp[][] = [[], [], [], []];
  for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
    const seeds: Record<string, InfraOp[]> = {};
    if (shift === 0 && plantBooster) {
      seeds["POWER-0"] = [plantBooster];
      reserved.set(plantBooster.id, "POWER-0");
    }
    if (shift === 0 && packageTokens.length) {
      const parked = new Set<string>();
      const placedAt = new Map<string, string>();
      const place = (op: InfraOp, key: string) => {
        seeds[key] = seeds[key] ?? [];
        const slots = infra.rooms[cellByKey.get(key)?.room ?? key]?.slots ?? 1;
        if (seeds[key].length >= slots || parked.has(op.id)) return false;
        seeds[key].push(op);
        parked.add(op.id);
        reserved.set(op.id, key);
        placedAt.set(op.id, cellByKey.get(key)?.label ?? key);
        return true;
      };
      for (const token of packageTokens) {
        // converters (에벤홀츠) pull a source token into this one, so source
        // generators (숙소의 아이리스·체르니 등) join the package too
        const converters = roster.filter((op) => op.skills.some((skill) => skill.convert?.to === token));
        const sources = new Map<string, number>(); // source token -> rate
        for (const op of converters) for (const skill of op.skills) if (skill.convert?.to === token) sources.set(skill.convert.from, skill.convert.amount / skill.convert.per);
        const flow: TokenFlow = { token, total: 0, generators: [], converters: converters.map((op) => ({ opId: op.id, from: op.skills.find((skill) => skill.convert?.to === token)?.convert?.from ?? "" })), consumers: [] };
        flows.push(flow);
        const generatesFor = (op: InfraOp) => op.skills.some((skill) => skill.tokenGen.some((g) => g.token === token || sources.has(g.token)));
        const members = roster.filter((op) => !used.has(op.id) && (generatesFor(op) || op.skills.some((skill) => skill.tokenUse.some((u) => u.token === token))));
        const estTotal = roster.reduce((sum, member) => sum + member.skills.reduce((inner, skill) => inner + skill.tokenGen.reduce((acc, g) => acc + (g.token === token ? g.estimate : sources.has(g.token) ? g.estimate * (sources.get(g.token) ?? 0) : 0), 0), 0), 0);
        for (const op of members) {
          for (const skill of op.skills) {
            const use = skill.tokenUse.find((u) => u.token === token && u.percent);
            if (!use) continue;
            // 시드는 토큰 기대 가치가 큰 핵심 소비자만: 약한 소비자(마르실
            // +5% 급)는 일반 경쟁으로 — 토큰 값은 점수에 자동 반영된다
            if ((use.value / use.per) * estTotal < 20) continue;
            // 순금이 병목이므로 최고 효율 요원은 순금 제조소부터 채운다
            // (LAYOUT 순서가 순금 → 작전기록); 남는 효율이 작전기록으로 간다
            const targets = LAYOUT.filter((c) => c.room === skill.room && !PARK_KEYS.includes(c.key));
            for (const cell of targets) if (place(op, cell.key)) break;
          }
        }
        for (const op of members) {
          for (const skill of op.skills) {
            const gen = skill.tokenGen.filter((g) => g.token === token || sources.has(g.token));
            if (!gen.length) continue;
            const converterPlaced = gen.some((g) => g.token === token) || converters.some((c) => parked.has(c.id) || c === op);
            const already = parked.has(op.id);
            if (already || LAYOUT.filter((c) => c.room === skill.room).some((cell) => place(op, cell.key))) {
              if (converterPlaced) {
                for (const g of gen) {
                  const amount = g.estimate * (g.token === token ? 1 : sources.get(g.token) ?? 0);
                  if (amount <= 0) continue;
                  flow.generators.push({ opId: op.id, at: placedAt.get(op.id) ?? "기존 배치", amount, via: g.token === token ? undefined : g.token, perMember: g.perMember });
                  tokenPoints[token] = (tokenPoints[token] ?? 0) + amount;
                }
              }
              break;
            }
          }
        }
        // park leftovers only where they at least have a matching room skill
        for (const op of members) {
          if (parked.has(op.id)) continue;
          if (op.skills.some((skill) => skill.room === "WORKSHOP")) place(op, "WORKSHOP");
        }
      }
      // family pinning: when a token's generators share a faction (쉐이),
      // faction-mates with a workshop/training skill are pinned there (니엔)
      for (const token of packageTokens) {
        const genOps = roster.filter((op) => op.skills.some((skill) => skill.tokenGen.some((g) => g.token === token)));
        const factionCounts = new Map<string, number>();
        genOps.forEach((op) => factionCounts.set(op.faction, (factionCounts.get(op.faction) ?? 0) + 1));
        const families = Array.from(factionCounts.entries()).filter(([, count]) => count >= 2).map(([faction]) => faction);
        for (const key of ["WORKSHOP"]) {
          const candidates = roster
            .filter((op) => !used.has(op.id) && !parked.has(op.id) && families.includes(op.faction) && op.skills.some((skill) => skill.room === key))
            .sort((a, b) => opSolo(b, key, 1, { tokenPoints: {} }) - opSolo(a, key, 1, { tokenPoints: {} }));
          for (const op of candidates) place(op, key);
        }
      }
      // dorm-pinned package members stay put across both shifts
      for (let d = 0; d < 4; d += 1) {
        const pinned = seeds[`DORM-${d}`] ?? [];
        dormPins[d] = pinned;
        pinned.forEach((op) => used.add(op.id));
      }
    }
    const shiftFactionCounts: Record<string, number> = {};
    // 기지 전체 존재 조건(언더플로우의 울피아누스 등)용 — 숙소 고정 인원 포함,
    // 이 조에서 지금까지 배치된 오퍼가 누적된다
    const placedIds = new Set<string>(dormPins.flat().map((op) => op.id));
    for (const key of keys) {
      if (key === "TRAINING") { assignments[key].push([]); continue; } // 특화 훈련용으로 비워둠
      if (key === "MEETING" && shift > 0) continue; // 응접실은 조 전환과 별개 상시 편성
      const room = cellByKey.get(key)?.room ?? key;
      const slots = infra.rooms[room]?.slots ?? 1;
      const pool = new Map(roster.filter((op) => !used.has(op.id) && (shift > 0 || !reserved.has(op.id) || reserved.get(op.id) === key)).map((op) => [op.id, op]));
      const ctx = ctxFor(key, shift === 0 ? tokenPoints : {}, shiftFactionCounts, plants, placedIds);
      const seed = (seeds[key] ?? []).filter((op) => pool.has(op.id));
      const team = bestTeam(room, slots, pool, ctx, seed);
      team.forEach((op) => {
        used.add(op.id);
        placedIds.add(op.id);
        shiftFactionCounts[op.faction] = (shiftFactionCounts[op.faction] ?? 0) + 1;
      });
      assignments[key].push(team.map((op) => op.id));
    }
    factionCountsPerShift.push(shiftFactionCounts);
  }
  // dorms: pinned rest space; package members that generate from the dorm
  // (아이리스·체르니·비르투오사 등) stay locked in regardless of shift
  for (let d = 0; d < 4; d += 1) assignments[`DORM-${d}`] = [dormPins[d].map((op) => op.id)];
  // ledger: recount per-member generators against the actual A-crew roster,
  // then record who cashes the points in
  const rosterById = new Map(roster.map((op) => [op.id, op]));
  const placedA: InfraOp[] = [];
  for (const key of [...PRODUCTION_KEYS, ...SUPPORT_KEYS]) {
    for (const id of assignments[key]?.[0] ?? []) {
      const op = rosterById.get(id);
      if (op) placedA.push(op);
    }
  }
  for (const flow of flows) {
    let total = 0;
    for (const gen of flow.generators) {
      if (gen.perMember) {
        const count = placedA.filter((op) => op.faction.includes(gen.perMember!.match)).length;
        gen.amount = gen.perMember.per * Math.min(count, gen.perMember.cap);
      }
      total += gen.amount;
    }
    tokenPoints[flow.token] = total;
    flow.total = total;
    for (const key of [...PRODUCTION_KEYS, ...SUPPORT_KEYS, "DORM-0", "DORM-1", "DORM-2", "DORM-3"]) {
      const team = (assignments[key]?.[0] ?? []).map((id) => rosterById.get(id)).filter(Boolean) as InfraOp[];
      const cell = cellByKey.get(key);
      for (const op of team) {
        let bestRate = 0;
        let percent = true;
        for (const skill of activeSkills(op, cell?.room ?? key, cell?.product)) {
          for (const use of skill.tokenUse) {
            if (use.token !== flow.token) continue;
            const rate = use.value / use.per;
            if (use.percent && rate > bestRate) { bestRate = rate; percent = true; }
            if (!use.percent && bestRate === 0) { bestRate = rate; percent = false; }
          }
        }
        if (bestRate !== 0) flow.consumers.push({ opId: op.id, at: cell?.label ?? key, room: cell?.room ?? key, rate: bestRate, percent, gain: percent ? flow.total * bestRate : bestRate * flow.total });
      }
    }
  }
  const strategy = packageTokens.length ? `${packageTokens.join(" + ")} 패키지` : "기본 편성";
  return { assignments, plants, tokenPoints, factionCounts: factionCountsPerShift, flows, strategy };
}

function optimize(roster: InfraOp[]): Plan {
  // every token family (속세의 화식, 감지 정보 계열, 주술 결정, …) is always
  // assembled into A조 — B조 is the recovery crew that steps in when A조's
  // morale runs out
  const allTokens = new Set<string>();
  for (const op of roster) for (const skill of op.skills) for (const use of skill.tokenUse) if (use.percent) allTokens.add(use.token);
  // closed single-team systems (정보 저장 = 레인보우 팀 전용) stay out of the
  // base-wide packages — they'd hijack control/meeting slots from the mains
  const open = Array.from(allTokens).filter((token) => {
    const participants = roster.filter((op) => op.skills.some((skill) => skill.tokenGen.some((g) => g.token === token) || skill.tokenUse.some((u) => u.token === token)));
    const factions = new Set(participants.map((op) => op.faction));
    if (participants.length < 2 || factions.size > 1) return true;
    // closed single-team systems stay only if their generators live in the
    // dorm (센시 마물 요리) — control-seat generators (Ash 정보 저장) hijack
    const genRooms = new Set(participants.flatMap((op) => op.skills.filter((skill) => skill.tokenGen.some((g) => g.token === token)).map((skill) => skill.room)));
    return genRooms.size > 0 && Array.from(genRooms).every((room) => room === "DORMITORY");
  });
  return buildPlan(open, roster);
}

function slotSubstitutes(team: InfraOp[], index: number, key: string, ctx: Ctx, excluded: Set<string>, roster: InfraOp[], count = 3): { op: InfraOp; score: number }[] {
  const room = cellByKey.get(key)?.room ?? key;
  return roster
    .filter((op) => !excluded.has(op.id) && op.skills.some((skill) => skillApplies(skill, room, ctx.product)))
    .map((op) => {
      const swapped = team.map((member, i) => (i === index ? op : member));
      return { op, score: Math.round(teamScore(swapped, room, ctx)) };
    })
    .sort((a, b) => b.score - a.score || a.op.rarity - b.op.rarity)
    .slice(0, count);
}

const STORAGE_KEY = "terra-archive-infra-v3";

export default function InfraPlanner({ onShowOperator }: { onShowOperator?: (id: string) => void } = {}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [activeShift, setActiveShift] = useState(0);
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const [showFlows, setShowFlows] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // 1~5성은 기본 보유, 6성은 미보유로 시작 — 가진 6성만 직접 체크한다
  const [ownedIds, setOwnedIds] = useState<Set<string>>(() => new Set(ops.filter((op) => op.rarity <= 5).map((op) => op.id)));
  // 미지정 = 2정(정예화 2, 최대) 가정 — 정예화 2 스킬이 있는 오퍼만 1정으로 낮출 수 있다
  const [eliteById, setEliteById] = useState<Map<string, 1 | 2>>(new Map());
  // 보유 오퍼·정예화 구성이나 방별 수동 편성을 바꾼 뒤 파일로 저장하지 않았으면 true
  const [dirty, setDirty] = useState(false);

  const effectiveOps = useMemo(() => ops.map((op) => withElite(op, eliteById.get(op.id))), [eliteById]);
  const effectiveOpById = useMemo(() => new Map(effectiveOps.map((op) => [op.id, op])), [effectiveOps]);
  const roster = useMemo(() => effectiveOps.filter((op) => ownedIds.has(op.id)), [effectiveOps, ownedIds]);

  const persist = (ids: Set<string>, nextPlan: Plan | null, elite: Map<string, 1 | 2> = eliteById) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ owned: Array.from(ids), elite: Array.from(elite.entries()), plan: nextPlan })); } catch { /* ignore */ }
  };

  const [confirmProposal, setConfirmProposal] = useState(false);
  const submitBaseProposal = async () => {
    setConfirmProposal(false);
    if (!plan) return;
    try {
      await sendFeedback("plan", "", { scope: "base", strategy: plan.strategy, assignments: plan.assignments, tokenPoints: plan.tokenPoints, owned: ownedIds.size });
      showToast("전체 편성을 제안했습니다, 감사합니다!");
    } catch { showToast("전송 실패 — 잠시 후 다시 시도해주세요"); }
  };

  const exportImage = async () => {
    if (!plan) return;
    type Row = { cell: (typeof LAYOUT)[number]; crews: { label: string; team: InfraOp[]; score: number | null }[] };
    const rows: Row[] = LAYOUT.map((cell) => {
      const shifts = plan.assignments[cell.key] ?? [];
      const scoreFor = (team: InfraOp[], shift: number) =>
        cell.room === "DORMITORY" || PARK_KEYS.includes(cell.key) ? null
          : Math.round(teamScore(team, cell.room, ctxFor(cell.key, shift === 0 ? plan.tokenPoints : {}, plan.factionCounts[shift] ?? {}, plan.plants, presentIdsFor(plan, shift))));
      const teamAt = (shift: number) => (shifts[Math.min(shift, shifts.length - 1)] ?? []).map((id) => effectiveOpById.get(id)).filter(Boolean) as InfraOp[];
      const single = cell.room === "DORMITORY" || cell.key === "MEETING" || cell.key === "TRAINING";
      if (single) {
        const team = teamAt(0);
        return { cell, crews: [{ label: cell.room === "DORMITORY" ? "고정" : cell.key === "MEETING" ? "상시" : "-", team, score: scoreFor(team, 0) }] };
      }
      return { cell, crews: [0, 1].map((shift) => ({ label: ["A", "B"][shift], team: teamAt(shift), score: scoreFor(teamAt(shift), shift) })) };
    });
    const uniqueOps = Array.from(new Set(rows.flatMap((row) => row.crews.flatMap((crew) => crew.team))));
    const avatars = new Map<string, HTMLImageElement>();
    await Promise.all(uniqueOps.map((op) => new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { avatars.set(op.id, img); resolve(); };
      img.onerror = () => resolve();
      img.src = op.image;
    })));
    const W = 1240; const lineH = 46; const top = 150;
    const rowHeights = rows.map((row) => row.crews.length * lineH + 12);
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = top + rowHeights.reduce((a, b) => a + b, 0) + 70;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#f1f0eb"; g.fillRect(0, 0, W, canvas.height);
    g.fillStyle = "#131719"; g.fillRect(0, 0, W, 96);
    g.fillStyle = "#dfff00"; g.font = "900 30px monospace"; g.fillText("TERRA ARCHIVE // RIIC PLAN", 32, 58);
    g.fillStyle = "#131719"; g.font = "700 15px sans-serif";
    g.fillText(`${plan.strategy} · ${Object.entries(plan.tokenPoints).map(([token, points]) => `${token} ${Math.round(points)}점`).join(" · ")}`, 32, 126);
    let y = top;
    rows.forEach((row, index) => {
      const h = rowHeights[index];
      g.fillStyle = index % 2 ? "#eceae3" : "#fbfbf8"; g.fillRect(24, y, W - 48, h - 8);
      g.fillStyle = ROOM_ACCENT[row.cell.room] ?? "#888"; g.fillRect(24, y, 5, h - 8);
      g.fillStyle = "#131719"; g.font = "800 15px sans-serif";
      g.fillText(row.cell.label, 44, y + 26);
      row.crews.forEach((crew, crewIndex) => {
        const cy = y + crewIndex * lineH;
        g.font = "900 13px monospace";
        const labelWidth = g.measureText(crew.label).width;
        const badgeWidth = Math.max(26, labelWidth + 14);
        g.fillStyle = "#131719";
        g.fillRect(210, cy + 10, badgeWidth, 26);
        g.fillStyle = "#dfff00";
        g.fillText(crew.label, 210 + (badgeWidth - labelWidth) / 2, cy + 28);
        let x = 210 + badgeWidth + 12;
        for (const op of crew.team) {
          const img = avatars.get(op.id);
          if (img) g.drawImage(img, x, cy + 6, 34, 34);
          g.fillStyle = "#131719"; g.font = "700 12px sans-serif";
          g.fillText(op.name, x + 40, cy + 28);
          x += 40 + Math.max(g.measureText(op.name).width + 20, 76);
        }
        if (!crew.team.length) {
          g.fillStyle = "#9aa0a3"; g.font = "700 12px sans-serif";
          g.fillText(row.cell.key === "TRAINING" ? "비워둠 (특화 훈련용)" : "휴식 공간", 248, cy + 28);
        }
        if (crew.score != null) {
          g.fillStyle = "#687176"; g.font = "800 13px monospace";
          const label = `+${crew.score}${row.cell.room === "CONTROL" ? "" : "%"}`;
          g.fillText(label, W - 48 - g.measureText(label).width, cy + 28);
        }
      });
      y += h;
    });
    g.fillStyle = "#687176"; g.font = "700 11px monospace";
    g.fillText("A = 풀파워 주간조 · B = 회복 교대조 · terra-archive infra planner", 32, canvas.height - 28);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setImageUrl(URL.createObjectURL(blob)); // 미리보기 모달로 바로 표시
    });
  };

  const closeImage = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
  };

  const exportState = () => {
    const payload = JSON.stringify({ version: 1, exported: new Date().toISOString(), owned: Array.from(ownedIds), elite: Array.from(eliteById.entries()), plan }, null, 1);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "terra-archive-infra.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setDirty(false);
    showToast("현재 상태를 파일로 저장했습니다");
  };

  const importState = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const ids = new Set<string>((data.owned as string[]).filter((id) => opById.has(id)));
        const elite = new Map<string, 1 | 2>((data.elite as [string, 1 | 2][] | undefined) ?? []);
        setOwnedIds(ids);
        setEliteById(elite);
        if (data.plan) { setPlan(data.plan as Plan); setActiveShift(0); }
        persist(ids, data.plan ?? null, elite);
        setDirty(false);
        showToast(`저장된 상태를 불러왔습니다 · 보유 ${ids.size}명 복원`);
      } catch { alert("가져오기 실패: 파일 형식을 확인해 주세요."); }
    };
    reader.readAsText(file);
  };

  const allAssigned = useMemo(() => {
    const set = new Set<string>();
    if (plan) for (const shifts of Object.values(plan.assignments)) for (const team of shifts) for (const id of team) set.add(id);
    return set;
  }, [plan]);

  // 방 모달에서 직접 편집: 해당 조의 팀을 교체하고 진영 카운트를 다시 센다.
  // 토큰 포인트·패키지 구성은 마지막 자동편성 기준으로 유지된다 (근사).
  const updateTeam = (cellKey: string, shiftIdx: number, ids: string[]) => {
    if (!plan) return;
    const shifts = (plan.assignments[cellKey] ?? []).map((team, index) => (index === shiftIdx ? ids : team));
    const assignments = { ...plan.assignments, [cellKey]: shifts };
    const factionCounts = [0, 1].map((s) => {
      const counts: Record<string, number> = {};
      for (const c of LAYOUT) {
        const cellShifts = assignments[c.key] ?? [];
        const team = cellShifts[Math.min(s, cellShifts.length - 1)] ?? [];
        for (const id of team) {
          const op = effectiveOpById.get(id);
          if (op) counts[op.faction] = (counts[op.faction] ?? 0) + 1;
        }
      }
      return counts;
    });
    const next = { ...plan, assignments, factionCounts };
    setPlan(next);
    persist(ownedIds, next);
    setDirty(true);
  };

  // 이미 배치된 오퍼의 정예화 단계를 방 상세에서 바로 바꾼다 — 편성 자체는 그대로 두고
  // 해당 오퍼의 활성 스킬만 다시 계산된다 (전체 재배치는 자동편성 실행에서 별도로).
  const setOperatorElite = (id: string, elite: 1 | 2) => {
    const next = new Map(eliteById);
    if (elite === 2) next.delete(id); else next.set(id, elite);
    setEliteById(next);
    persist(ownedIds, plan, next);
    setDirty(true);
  };

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  const runOptimize = (ids: Set<string> = ownedIds, elite: Map<string, 1 | 2> = eliteById) => {
    const next = optimize(ops.map((op) => withElite(op, elite.get(op.id))).filter((op) => ids.has(op.id)));
    setPlan(next);
    setActiveShift(0);
    persist(ids, next, elite);
    showToast(`자동편성을 실행했습니다 · 보유 ${ids.size}명 기준`);
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        const ids = new Set<string>((data.owned as string[]).filter((id: string) => opById.has(id)));
        const elite = new Map<string, 1 | 2>((data.elite as [string, 1 | 2][] | undefined) ?? []);
        setOwnedIds(ids);
        setEliteById(elite);
        if (data.plan) { setPlan(data.plan as Plan); return; }
        setPlan(optimize(ops.map((op) => withElite(op, elite.get(op.id))).filter((op) => ids.has(op.id))));
        return;
      }
    } catch { /* fall through to defaults */ }
    setPlan(optimize(ops.filter((op) => op.rarity <= 5)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teamFor = (key: string, shift: number): InfraOp[] => {
    const shifts = plan?.assignments[key] ?? [];
    const team = shifts[Math.min(shift, shifts.length - 1)] ?? [];
    return team.map((id) => effectiveOpById.get(id)).filter(Boolean) as InfraOp[];
  };

  const pointsFor = (shift: number) => (shift === 0 && plan ? plan.tokenPoints : {});

  // 현재 조 기준 기지 내 배치 전원 — 기반시설 존재 조건(언더플로우+울피아누스) 판정용
  const presentIds = useMemo(() => (plan ? presentIdsFor(plan, activeShift) : undefined), [plan, activeShift]);

  const summary = useMemo(() => {
    if (!plan) return null;
    const avg = (prefix: string) => {
      const keys = LAYOUT.filter((cell) => cell.key.startsWith(prefix)).map((cell) => cell.key);
      const totals = keys.map((key) => teamScore(teamFor(key, activeShift), cellByKey.get(key)!.room, ctxFor(key, pointsFor(activeShift), plan.factionCounts[activeShift], plan.plants, presentIds)));
      return totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0;
    };
    return {
      strategy: plan.strategy,
      manufacture: avg("MANUFACTURE"),
      trading: avg("TRADING"),
      power: avg("POWER"),
      staffed: allAssigned.size,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, activeShift, allAssigned]);

  const openCell = LAYOUT.find((cell) => cell.key === openRoom);

  return (
    <section className="planner">
      <div className="planner-controls">
        <div>
          <span className="section-no">RIIC / 243 · 순금 2 + 작전기록 2 · 12시간 2조 교대</span>
          <h2>인프라 배치 최적화</h2>
        </div>
        <div className="planner-buttons">
          <button onClick={() => setShowRoster(true)}>보유 오퍼 설정 ({ownedIds.size}/{ops.length})</button>
          <button className="primary" onClick={() => runOptimize()}>자동편성 실행</button>
          <button onClick={exportImage} title="A조·B조 편성표를 이미지로 확인 (PNG)">이미지로 보기</button>
          {plan && feedbackReady && (
            <button title="현재 전체 편성을 사이트 운영자에게 제안" onClick={() => setConfirmProposal(true)}>전체 편성 제안</button>
          )}
          <span className="file-group">
            <button className={dirty ? "save-pending" : undefined} onClick={exportState} title={dirty ? "저장 후 변경 사항이 있습니다 — 파일로 저장하세요" : "보유 오퍼와 편성을 JSON 파일로 저장"}>현재 상태 파일로 저장</button>
            <label className="import-label">
              저장된 상태 파일 가져오기
              <input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) importState(file); event.target.value = ""; }} />
            </label>
          </span>
          <button onClick={() => setShowHelp(true)}>도움말</button>
        </div>
      </div>

      {summary && (
        <div className="planner-summary">
          <button type="button" className="strategy-cell" onClick={() => setShowFlows(true)}>
            <span>전략 (클릭해 시너지 트리 보기)</span>
            <b className="strategy">{summary.strategy}{plan && Object.keys(plan.tokenPoints).length > 0 && ` · ${Object.entries(plan.tokenPoints).map(([token, points]) => `${token} ${Math.round(points)}점`).join(" · ")}`}</b>
          </button>
          <div><span>제조소 평균</span><b>+{summary.manufacture}%</b></div>
          <div><span>무역소 평균</span><b>+{summary.trading}%</b></div>
          <div><span>발전소 평균</span><b>+{summary.power}%</b></div>
          <div><span>기용 인원</span><b>{summary.staffed}명</b></div>
        </div>
      )}

      {plan && (
        <div className="shift-tabs">
          {Array.from({ length: SHIFT_COUNT }, (_, i) => (
            <button key={i} className={activeShift === i ? "selected" : ""} onClick={() => setActiveShift(i)}>{["A조 (풀파워)", "B조 (회복 교대)"][i]}</button>
          ))}
          <span className="shift-hint">A조 컨디션 소진 시 B조 투입 · 시너지 세트는 A조 집중 · 숙소·응접실·고정 요원은 조 전환과 무관 · <b>숙소는 항상 5명 꽉 채워 유지</b></span>
        </div>
      )}

      <div className="ship">
        {LAYOUT.map((cell) => {
          if (cell.room === "DORMITORY") {
            const pinned = teamFor(cell.key, 0);
            return (
              <div key={cell.key} className={`ship-room dorm-room pos-${cell.key.toLowerCase()}`} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
                <div className="ship-room-head"><b>{cell.label}</b><span>고정</span></div>
                <div className="ship-room-crew">
                  {pinned.map((op) => <img key={op.id} src={op.image} alt={op.name} title={`${op.name} 상세 정보`} loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={() => onShowOperator?.(op.id)} />)}
                  <i>{pinned.length ? "시너지 고정 + 휴식 공간" : "휴식 공간 · 조 전환과 무관"}</i>
                </div>
              </div>
            );
          }
          const team = teamFor(cell.key, activeShift);
          const spec = infra.rooms[cell.room];
          const score = Math.round(teamScore(team, cell.room, ctxFor(cell.key, pointsFor(activeShift), plan?.factionCounts?.[activeShift], plan?.plants, presentIds)));
          return (
            <button key={cell.key} type="button" className={`ship-room pos-${cell.key.toLowerCase()}`} onClick={() => setOpenRoom(cell.key)} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
              <div className="ship-room-head">
                <b>{cell.label}</b>
                <span>{team.length}/{spec?.slots ?? 1}</span>
              </div>
              <div className="ship-room-crew">
                {team.length ? team.map((op) => (
                  <img key={op.id} src={op.image} alt={op.name} title={op.name} loading="lazy" />
                )) : <i>{cell.key === "TRAINING" ? "비워둠 · 특화 훈련 시 사용" : plan ? "비어 있음" : "자동 편성 대기"}</i>}
              </div>
              {plan && team.length > 0 && !PARK_KEYS.includes(cell.key) && (
                <small>+{score}{cell.room === "CONTROL" ? "" : "%"} {UNIT[cell.room]}{cell.key === "MEETING" ? " · 조 전환과 별개 상시 편성" : ""}</small>
              )}
              {plan && PARK_KEYS.includes(cell.key) && team.length > 0 && <small>세트 요원 고정 · 효율 무관</small>}
            </button>
          );
        })}
      </div>

      <aside className="data-note"><span>PLANNER NOTE</span><p>오퍼레이터의 모든 인프라 스킬을 동시에 적용하고(α/β는 상위 티어만), 시설 간 포인트 시스템(속세의 화식·무성의 공명 등)을 겹쳐 쌓을 수 있을 때까지 패키지로 조합합니다. 고품질 귀금속 오더 확률(샤마르·카프카·디아만테·바이비크)과 오더당 수익(테킬라·프로바이조)의 상호작용, 샤마르의 효율 대체를 반영합니다. 조건부·누적 버프는 추정 상한 기준 근사치입니다.</p></aside>

      {showRoster && (
        <RosterModal
          ownedIds={ownedIds}
          eliteById={eliteById}
          onApply={(ids, elite) => { setOwnedIds(ids); setEliteById(elite); setShowRoster(false); runOptimize(ids, elite); setDirty(true); }}
          onClose={() => setShowRoster(false)}
        />
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {imageUrl && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeImage(); }}>
          <section className="operator-modal room-modal image-preview" style={{ "--accent": "#dfff00" } as React.CSSProperties}>
            <button type="button" className="modal-close" onClick={closeImage} aria-label="닫기">×</button>
            <header className="room-modal-head">
              <span className="modal-kicker">PLAN SHEET</span>
              <h2>편성표 이미지</h2>
              <div className="roster-tools">
                <a className="apply save-image" href={imageUrl} download="terra-archive-infra.png">PNG 저장</a>
              </div>
            </header>
            <div className="modal-scroll"><img src={imageUrl} alt="인프라 편성표" /></div>
          </section>
        </div>
      )}

      {showFlows && plan && <FlowModal plan={plan} opMap={effectiveOpById} onClose={() => setShowFlows(false)} onShowOperator={onShowOperator} />}

      {openCell && plan && (
        <RoomModal
          cell={openCell}
          plan={plan}
          allAssigned={allAssigned}
          roster={roster}
          opMap={effectiveOpById}
          initialShift={activeShift}
          onClose={() => setOpenRoom(null)}
          onShowOperator={onShowOperator}
          onUpdateTeam={updateTeam}
          onNotify={showToast}
          eliteById={eliteById}
          onSetElite={setOperatorElite}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      {confirmProposal && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmProposal(false); }}>
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <p>현재 <b>전체 인프라 편성</b>을 사이트 운영자에게 제안할까요?</p>
            <div className="confirm-actions">
              <button type="button" onClick={() => setConfirmProposal(false)}>취소</button>
              <button type="button" className="confirm-yes" onClick={submitBaseProposal}>제안하기</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function RoomModal({ cell, plan, allAssigned, roster, opMap, initialShift, onClose, onShowOperator, onUpdateTeam, onNotify, eliteById, onSetElite }: { cell: { key: string; room: string; label: string; product?: string }; plan: Plan; allAssigned: Set<string>; roster: InfraOp[]; opMap: Map<string, InfraOp>; initialShift: number; onClose: () => void; onShowOperator?: (id: string) => void; onUpdateTeam?: (cellKey: string, shiftIdx: number, ids: string[]) => void; onNotify?: (message: string) => void; eliteById: Map<string, 1 | 2>; onSetElite: (id: string, elite: 1 | 2) => void }) {
  const [shift, setShift] = useState(initialShift);
  const [confirmRoomProposal, setConfirmRoomProposal] = useState(false);
  const shiftIndex = Math.min(shift, (plan.assignments[cell.key]?.length ?? 1) - 1);
  const rawIds = plan.assignments[cell.key]?.[shiftIndex] ?? [];
  const team = rawIds.map((id) => opMap.get(id)).filter(Boolean) as InfraOp[];
  const teamIds = new Set(team.map((op) => op.id));
  const points = shiftIndex === 0 ? plan.tokenPoints : {};
  const ctx = ctxFor(cell.key, points, plan.factionCounts[shiftIndex] ?? {}, plan.plants, presentIdsFor(plan, shiftIndex));
  const excluded = new Set([...allAssigned, ...teamIds]);
  const currentScore = Math.round(teamScore(team, cell.room, ctx));
  const slots = infra.rooms[cell.room]?.slots ?? 1;
  const scored = cell.room !== "DORMITORY" && !PARK_KEYS.includes(cell.key);
  const setIds = (ids: string[]) => onUpdateTeam?.(cell.key, shiftIndex, ids);
  // 종합 효율 구성 요소 (팀원 breakdown 합산)
  const agg = team.reduce((acc, op) => {
    const b = breakdown(op, cell.room, team, ctx);
    acc["스킬 효율"] += b.efficiency;
    acc["시설 기반"] += b.facilityEff;
    acc["자동화"] += b.automation;
    acc["품질 기대치"] += b.quality;
    acc["오더 수익"] += b.payout + b.payoutViolation;
    acc["효율 오버라이드"] += b.override > 0 ? b.override : 0;
    acc["동료 보너스"] += b.perCoworker * (team.length - 1);
    acc["제어 오라(가중)"] += Object.keys(AURA_WEIGHT).reduce((sum, kind) => sum + (b.auras[kind] ?? 0) * AURA_WEIGHT[kind], 0);
    return acc;
  }, { "스킬 효율": 0, "시설 기반": 0, "자동화": 0, "품질 기대치": 0, "오더 수익": 0, "효율 오버라이드": 0, "동료 보너스": 0, "제어 오라(가중)": 0 } as Record<string, number>);
  // 추가 후보: 어디에도 배치 안 된 보유 오퍼를 한계 기여 순으로
  const [benchAll, setBenchAll] = useState(false);
  const [benchQuery, setBenchQuery] = useState("");
  const benchFull = team.length < slots && onUpdateTeam
    ? roster
        .filter((op) => !allAssigned.has(op.id))
        .map((op) => ({ op, delta: Math.round(teamScore([...team, op], cell.room, ctx)) - currentScore }))
        .sort((a, b) => b.delta - a.delta || b.op.rarity - a.op.rarity)
    : [];
  const benchKeyword = benchQuery.trim().toLowerCase();
  const benchFiltered = benchKeyword
    ? benchFull.filter(({ op }) => op.name.toLowerCase().includes(benchKeyword) || op.faction.toLowerCase().includes(benchKeyword))
    : benchFull;
  const bench = benchAll ? benchFiltered : benchFiltered.slice(0, 12);
  // synergy cores can't be swapped: token generators/consumers of active
  // systems, override/payout roles, and per-member counter bodies (쉐이)
  const activeTokens = new Set(Object.entries(plan.tokenPoints).filter(([, points]) => points > 0).map(([token]) => token));
  const counterMatches = plan.flows.flatMap((flow) => flow.generators).filter((gen) => gen.perMember).map((gen) => gen.perMember!.match);
  const isCore = (op: InfraOp) =>
    op.skills.some((skill) =>
      skill.kind === "override" || skill.kind === "payout" || skill.kind === "payout_v" ||
      skill.tokenGen.some((gen) => activeTokens.has(gen.token)) ||
      skill.tokenUse.some((use) => use.percent && activeTokens.has(use.token))) ||
    counterMatches.some((match) => op.faction.includes(match));

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">×</button>
        <header className="room-modal-head">
          <span className="modal-kicker">FACILITY FILE · {cell.room}</span>
          <h2>{cell.label}</h2>
          <div className="shift-tabs in-modal">
            {Array.from({ length: SHIFT_COUNT }, (_, i) => (
              <button key={i} className={shift === i ? "selected" : ""} onClick={() => setShift(i)}>{["A조", "B조"][i]}</button>
            ))}
            {feedbackReady && team.length > 0 && (
              <button type="button" className="propose-btn" title="이 시설의 현재 편성을 사이트 운영자에게 제안" onClick={() => setConfirmRoomProposal(true)}>이 편성을 제안</button>
            )}
          </div>
        </header>
        <div className="modal-scroll">
          {scored && (
            <section className="detail-section room-summary">
              <span className="detail-no">RESULT / 00</span>
              <h3>종합 효율{cell.product ? ` · ${cell.product}` : ""} <b className="summary-total">+{currentScore}{cell.room === "CONTROL" ? "" : "%"}</b></h3>
              <div className="summary-parts">
                {Object.entries(agg).filter(([, value]) => Math.round(value) !== 0).map(([name, value]) => (
                  <span key={name}>{name} <b>+{Math.round(value)}</b></span>
                ))}
                {team.length === 0 && <span>편성 없음</span>}
              </div>
              <p className="summary-note">아래에서 오퍼를 빼거나(✕) 대체 오퍼·추가 후보를 클릭하면 즉시 다시 계산됩니다.
                단, 토큰 포인트(속세의 화식 등)와 패키지 구성은 마지막 자동편성 기준이므로, 토큰 생성원을 바꿨다면 자동편성 실행으로 재계산하세요.</p>
            </section>
          )}
          <section className="detail-section">
            <span className="detail-no">CREW / 01</span>
            <h3>편성 ({team.length}/{slots})</h3>
            {cell.room === "DORMITORY" && (
              <p className="dorm-note">숙소는 <b>항상 5명을 꽉 채운 상태로 유지</b>하세요. 고정 생성원 외의 빈 자리는 휴식이 필요한 아무 오퍼레이터로 채우면 됩니다 — 토큰 생성과 회복 효율은 풀 인원 기준으로 계산됩니다.</p>
            )}
            <div className="crew-list">
              {team.map((op) => {
                const b = breakdown(op, cell.room, team, ctx);
                const auraTotal = Object.keys(AURA_WEIGHT).reduce((sum, kind) => sum + (b.auras[kind] ?? 0) * AURA_WEIGHT[kind], 0);
                const total = Math.round(b.efficiency + b.facilityEff + b.automation + b.quality + b.payout + b.payoutViolation + (b.override > 0 ? b.override : 0) + b.perCoworker * (team.length - 1) + auraTotal);
                const shown = b.skills.length ? b.skills : op.skills.filter((skill) => skill.room === cell.room);
                return (
                  <article key={op.id} className="crew-card">
                    {onUpdateTeam && <button type="button" className="crew-remove" title="이 자리에서 빼기" onClick={() => setIds(rawIds.filter((id) => id !== op.id))}>✕</button>}
                    <img src={op.image} alt={op.name} loading="lazy" className={onShowOperator ? "op-link" : undefined}
                      title={`${op.name} 상세 정보`} onClick={() => onShowOperator?.(op.id)} />
                    <div>
                      <b>
                        {op.name} <i>{"★".repeat(op.rarity)}</i>
                        {opById.get(op.id)?.skills.some((skill) => skill.unlock === "정예화 2") && (
                          <span className="elite-pill" role="group" aria-label={`${op.name} 정예화 단계`}>
                            <button type="button" className={(eliteById.get(op.id) ?? 2) === 1 ? "selected" : ""} onClick={() => onSetElite(op.id, 1)}>1정</button>
                            <button type="button" className={(eliteById.get(op.id) ?? 2) === 2 ? "selected" : ""} onClick={() => onSetElite(op.id, 2)}>2정</button>
                          </span>
                        )}
                      </b>
                      {shown.length ? shown.map((skill) => <p key={skill.name}><em>{skill.name}</em> — {skill.description}</p>) : <p>이 시설에 적용되는 스킬이 없습니다 (세트 대기 요원).</p>}
                      {total > 0 && <small>기여 +{total}{cell.room === "CONTROL" ? "" : "%"}</small>}
                      {op.skills.flatMap((skill) => skill.tokenGen).map((gen) => (
                        <small key={`${op.id}-${gen.token}`} className="token-chip">{gen.token} +{Math.round(gen.estimate)}점 생성</small>
                      ))}
                      {isCore(op) ? (
                        <div className="slot-subs"><small className="core-chip">대체 불가 · 시너지 코어</small></div>
                      ) : (
                        <div className="slot-subs">
                          <span>이 자리 대체 오퍼:</span>
                          {slotSubstitutes(team, team.indexOf(op), cell.key, ctx, excluded, roster).map(({ op: sub, score }) => (
                            <small key={sub.id} className={`sub-chip${onUpdateTeam ? " swappable" : ""}`}
                              title={`클릭하면 ${op.name} 자리에 교체\n${sub.skills.filter((skill) => skill.room === cell.room).map((skill) => `${skill.name}: ${skill.description}`).join("\n")}`}
                              onClick={() => onUpdateTeam && setIds(rawIds.map((id) => (id === op.id ? sub.id : id)))}>
                              <img src={sub.image} alt="" loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={(event) => { event.stopPropagation(); onShowOperator?.(sub.id); }} />{sub.name} <em>{score >= currentScore ? "동급" : `-${currentScore - score}`}</em>
                            </small>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
              {team.length === 0 && !benchFull.length && <p className="no-detail">자동 편성을 먼저 실행해 주세요.</p>}
            </div>
            {benchFull.length > 0 && (
              <div className="bench">
                <span>빈 자리에 추가 — 클릭 시 즉시 배치 (기여 예상):</span>
                <input className="bench-search" value={benchQuery} onChange={(event) => setBenchQuery(event.target.value)} placeholder="이름·소속으로 후보 검색" />
                {bench.length > 0 ? (
                  <div className="bench-chips">
                    {bench.map(({ op, delta }) => (
                      <small key={op.id} className="sub-chip swappable" title={`${op.name} 추가`} onClick={() => setIds([...rawIds, op.id])}>
                        <img src={op.image} alt="" loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={(event) => { event.stopPropagation(); onShowOperator?.(op.id); }} />{op.name} <em>{delta >= 0 ? `+${delta}` : delta}</em>
                      </small>
                    ))}
                  </div>
                ) : (
                  <p className="no-detail">검색 결과가 없습니다.</p>
                )}
                {benchFiltered.length > 12 && (
                  <button type="button" className="more-filter" onClick={() => setBenchAll((current) => !current)}>
                    {benchAll ? "접기" : `더 많이 보기 (전체 ${benchFiltered.length}명)`}
                  </button>
                )}
              </div>
            )}
          </section>

        </div>
      </section>
      {confirmRoomProposal && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmRoomProposal(false); }}>
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <p><b>{cell.label}</b> 편성을 사이트 운영자에게 제안할까요?</p>
            <div className="confirm-actions">
              <button type="button" onClick={() => setConfirmRoomProposal(false)}>취소</button>
              <button type="button" className="confirm-yes" onClick={async () => {
                setConfirmRoomProposal(false);
                try {
                  await sendFeedback("plan", "", { scope: cell.key, label: cell.label, room: cell.room, shifts: plan.assignments[cell.key], score: currentScore, shift: shiftIndex });
                  onNotify?.(`${cell.label} 편성을 제안했습니다, 감사합니다!`);
                } catch { onNotify?.("전송 실패 — 잠시 후 다시 시도해주세요"); }
              }}>제안하기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FlowModal({ plan, opMap, onClose, onShowOperator }: { plan: Plan; opMap: Map<string, InfraOp>; onClose: () => void; onShowOperator?: (id: string) => void }) {
  const flows = plan.flows.filter((flow) => flow.generators.length > 0 || flow.consumers.length > 0);
  const avatar = (op: InfraOp | undefined) => op ? (
    <img src={op.image} alt="" loading="lazy" className={onShowOperator ? "op-link" : undefined}
      title={onShowOperator ? `${op.name} 상세 정보` : undefined} onClick={() => onShowOperator?.(op.id)} />
  ) : null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": "#dfff00" } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">×</button>
        <header className="room-modal-head">
          <span className="modal-kicker">SYNERGY LEDGER · A조 기준</span>
          <h2>시너지 트리</h2>
        </header>
        <div className="modal-scroll">
          {flows.length === 0 && <p className="no-detail">활성화된 포인트 시너지가 없습니다.</p>}
          {flows.map((flow) => (
            <section key={flow.token} className="detail-section flow-tree">
              <h3>{flow.token} <span className="flow-total">총 {Math.round(flow.total)}점</span></h3>
              <ul>
                <li className="flow-branch">생성
                  <ul>
                    {flow.generators.map((gen, index) => {
                      const op = opMap.get(gen.opId);
                      return (
                        <li key={`${gen.opId}-${index}`}>
                          {avatar(op)}
                          <b>{op?.name ?? gen.opId}</b> <i>{gen.at}</i>
                          <em>+{Math.round(gen.amount)}점{gen.via ? ` (${gen.via} 전환)` : ""}</em>
                        </li>
                      );
                    })}
                    {flow.generators.length === 0 && <li><em>생성원이 배치되지 않음</em></li>}
                  </ul>
                </li>
                {flow.converters.length > 0 && (
                  <li className="flow-branch">전환
                    <ul>
                      {flow.converters.map((conv) => {
                        const op = opMap.get(conv.opId);
                        return <li key={conv.opId}>{avatar(op)}<b>{op?.name}</b> <em>{conv.from} → {flow.token}</em></li>;
                      })}
                    </ul>
                  </li>
                )}
                <li className="flow-branch">소비
                  <ul>
                    {flow.consumers.map((consumer, index) => {
                      const op = opMap.get(consumer.opId);
                      return (
                        <li key={`${consumer.opId}-${index}`}>
                          {avatar(op)}
                          <b>{op?.name ?? consumer.opId}</b> <i>{consumer.at}</i>
                          <em>{consumer.percent ? `${flow.token} ${Math.round(flow.total)}점 소비 → ${UNIT[consumer.room] ?? "효율"} +${Math.round(consumer.gain)}% (1점당 +${consumer.rate}%)` : `${flow.token} 기반 컨디션 회복·소모 보정`}</em>
                        </li>
                      );
                    })}
                    {flow.consumers.length === 0 && <li><em>소비자가 배치되지 않음</em></li>}
                  </ul>
                </li>
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

function RosterModal({ ownedIds, eliteById, onApply, onClose }: { ownedIds: Set<string>; eliteById: Map<string, 1 | 2>; onApply: (ids: Set<string>, elite: Map<string, 1 | 2>) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Set<string>>(new Set(ownedIds));
  const [eliteDraft, setEliteDraft] = useState<Map<string, 1 | 2>>(new Map(eliteById));
  const [query, setQuery] = useState("");
  const keyword = query.trim().toLowerCase();
  const visible = ops
    .filter((op) => !keyword || op.name.toLowerCase().includes(keyword) || op.faction.toLowerCase().includes(keyword))
    .sort((a, b) => b.rarity - a.rarity || b.seq - a.seq); // 6성 우선, 그 안에서 KR 출시 최신순
  const toggle = (id: string) => setDraft((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const setElite = (id: string, elite: 1 | 2) => setEliteDraft((current) => {
    const next = new Map(current);
    if (elite === 2) next.delete(id); else next.set(id, elite); // 2정이 기본값이라 별도 저장 불필요
    return next;
  });
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": "#dfff00" } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">×</button>
        <header className="room-modal-head">
          <span className="modal-kicker">ROSTER · {draft.size}/{ops.length} 보유</span>
          <h2>보유 오퍼레이터 설정</h2>
          <div className="roster-tools">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름·소속 검색" />
            <button type="button" onClick={() => setDraft(new Set(ops.map((op) => op.id)))}>전체 선택</button>
            <button type="button" onClick={() => setDraft(new Set())}>전체 해제</button>
            <button type="button" className="apply" onClick={() => onApply(draft, eliteDraft)}>적용 및 자동편성 실행</button>
          </div>
        </header>
        <div className="modal-scroll">
          <p className="dorm-note">정예화 2에서 해금되는 인프라 스킬을 가진 오퍼는 카드 아래 <b>1정/2정</b>을 선택할 수 있습니다 (기본값 2정 · 최대치 가정).</p>
          <div className="roster-grid">
            {visible.map((op) => {
              const owned = draft.has(op.id);
              const hasElite2Skill = op.skills.some((skill) => skill.unlock === "정예화 2");
              const elite = eliteDraft.get(op.id) ?? 2;
              return (
                <div key={op.id} className={`roster-card${owned ? " owned" : ""}`}>
                  <button type="button" onClick={() => toggle(op.id)} title={op.name}>
                    <img src={op.image} alt={op.name} loading="lazy" />
                    <span>{op.name}</span>
                  </button>
                  {owned && hasElite2Skill && (
                    <div className="elite-toggle" role="group" aria-label={`${op.name} 정예화 단계`}>
                      <button type="button" className={elite === 1 ? "selected" : ""} onClick={() => setElite(op.id, 1)}>1정</button>
                      <button type="button" className={elite === 2 ? "selected" : ""} onClick={() => setElite(op.id, 2)}>2정</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

const HELP_SECTIONS: { title: string; items: string[] }[] = [
  { title: "교대 정책", items: [
    "A조가 풀파워 주력이고 모든 시너지 세트는 A조에 모입니다. B조는 A조 컨디션이 소진됐을 때 투입되는 회복 교대입니다 (12시간 2조).",
    "숙소·응접실·시너지 고정 요원(숙소 생성원, 니엔 등)은 A/B 전환과 무관하게 고정됩니다.",
    "훈련실은 실제 스킬 특화 훈련에 쓰도록 비워 둡니다.",
  ]},
  { title: "제조소 우선순위", items: [
    "순금 2 + 작전기록 2 분할. 무역소 효율이 오르면 순금이 병목이 되므로 가장 강한 생산 팀을 순금 2방에 먼저 배치하고, 남는 효율을 작전기록으로 돌립니다.",
    "품목 전용 스킬(금속공예류 = 순금)은 해당 품목 방에서만 계산됩니다.",
  ]},
  { title: "포인트 시너지 (시설 간)", items: [
    "속세의 화식: 제어센터 시·링·총웨(쉐이 1명당 +5, 최대 5명 — 실제 배치 수로 계산) + 우요우가 생성, 슈(제조)·우요우(무역)·지에윈(화식→주술 결정 전환)이 소비합니다.",
    "무성의 공명·감지 정보: 숙소에 고정된 아이리스(꿈나라)·체르니(소절)·비르투오사가 생성, 에벤홀츠가 감지 정보를 공명으로 전환해 무역소 효율로 소비합니다.",
    "마물 요리: 센시를 숙소에 고정하면 레벨당 1개(총 5개)가 생겨 마르실(제조)·라이오스(응접실)가 소비합니다.",
    "정보 저장은 레인보우 팀 전용 폐쇄 시스템이라 기지 편성에 넣지 않습니다.",
  ]},
  { title: "무역소 조합", items: [
    "샤마르(속삭임)는 다른 인원의 효율을 0으로 만들고 인당 +45%를 주므로, 효율이 없어도 되는 품질 요원과 묶습니다: 샤마르 + 테킬라(투자β: 고품질 순금 오더 수익) + 확률 요원(카프카·디아만테·바이비크 — 전부 동급).",
    "프로바이조는 반대로 저품질 오더를 위약 처리해 수익을 내므로 고품질 확률과는 반시너지입니다. 처리량이 높은 우요우+에벤홀츠 방에 넣습니다.",
    "레벨 성장형은 만렙 기지 기준 상한으로 계산합니다: 비질 +40%(응접실 Lv3), 아르케토 +40%(숙소 20레벨), 미틈 +30%, 만트라 +45%(시설 10개).",
    "언더플로우(+30%)는 울피아누스가 기지 어디든(숙소 포함) 있으면 +40%가 됩니다 — 울피아누스를 숙소에 고정해 두세요. B조 무역소 정배: 비질+아르케토+언더플로우.",
  ]},
  { title: "자동화 제조소", items: [
    "위디·유넥티스·윈드플릿·패신저는 방 내 다른 오퍼의 생산력을 0으로 만들고 발전소 1기당 +15%/+10%/+5%/+5%를 받습니다 — 이들과 같은 방에 넣은 일반 +30%/+35%류 생산력 스킬은 전부 0%가 되므로, 직접 수치가 아니라 이런 제로아웃 오퍼와 궁합이 맞는지 먼저 확인해야 합니다.",
    "스네구로치카는 같은 방식으로 제로아웃하되 발전소가 아니라 그 제조소에 실제 배치된 인원수당 +10%로 스케일됩니다.",
    "단 시설 수량 기반 생산력(퓨어스트림·쏜즈의 '각각의 무역소가…')은 살아남아 함께 쓸 수 있습니다.",
    "그레이 더 라이트닝베어러를 발전소에 두면(다른 발전소에 1성 로봇이 없는 한) 발전소 4기로 간주되어 자동화 방이 최대 140%까지 오릅니다.",
    "제로아웃 오퍼를 쓰는 편성 자체가 예외적인 케이스입니다 — 자동편성은 실제 방 점수(제로아웃 반영)로 비교해 더 나을 때만 추천합니다.",
  ]},
  { title: "제어 센터", items: [
    "오라 우선순위: 제조소 생산력 > 무역소 오더 효율 > 인맥 레퍼런스 > 단서 수집. '동종 효과 중 최고만 적용' 규칙을 따릅니다.",
    "'용문근위국 오퍼와 함께'류 동반 조건, '미노스 1명당'류 카운트 조건은 실제 배치를 기준으로만 인정합니다.",
  ]},
  { title: "정예화 단계 (1정/2정)", items: [
    "보유 오퍼 설정에서 오퍼별로 기본값(2정 · 정예화 2)을 1정으로 낮출 수 있습니다. 정예화 2에서 해금되는 인프라 스킬을 가진 오퍼만 선택지가 보입니다.",
    "1정으로 지정하면 해당 오퍼는 정예화 2 전용 스킬 없이 계산·자동편성됩니다 — 아직 승급 못 한 오퍼를 과대평가하지 않도록 맞춰 두세요.",
  ]},
  { title: "대체 추천", items: [
    "각 자리의 대체 후보는 실제로 교체해 본 방 점수로 순위를 매기고, 동점이면 낮은 성급(육성 저렴)을 우선합니다.",
    "토큰 생성·소비자, 오버라이드·수익 역할, 쉐이 카운트 인원 같은 시너지 코어는 '대체 불가'로 표시됩니다.",
  ]},
  { title: "수치는 근사치", items: [
    "숙소는 풀 인원(20명), 모집 4칸, 발전소 3(그레이 알터 시 4) 기준의 추정 상한으로 계산합니다. 실제 게임 수치와 약간 다를 수 있습니다.",
    "자세한 규칙 전문은 저장소의 docs/INFRA-RULES.md를 참고하세요.",
  ]},
];

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": "#dfff00" } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">×</button>
        <header className="room-modal-head">
          <span className="modal-kicker">HOW IT WORKS</span>
          <h2>최적화 규칙 도움말</h2>
        </header>
        <div className="modal-scroll">
          {HELP_SECTIONS.map((section) => (
            <section key={section.title} className="detail-section">
              <h3>{section.title}</h3>
              <ul className="help-list">
                {section.items.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
