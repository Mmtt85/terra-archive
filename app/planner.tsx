"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import infraData from "./data/infra.json";
import { useI18n, tokenName, rich, type ExtraI18n, type Locale, type T } from "./i18n";
import { useConfirm } from "./confirm";
import { normSearch } from "./search";

type TokenGen = { token: string; estimate: number; perMember?: { per: number; cap: number; match: string } };
type TokenUse = { token: string; per: number; value: number; percent: boolean };

type InfraSkill = {
  buffId?: string;   // 다국어 오버레이(extra-i18n) 매핑 키
  krName?: string;   // 표시명을 로케일로 바꿔도 로직(스킬 태그 카운트)은 KR 이름 기준
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
  gateFaction?: string | null;  // "쉐라그 3명 배치된 무역소" 류 — 진영 N명 배치 조건
  gateCount?: number | null;
  gatePlatforms?: number | null; // "작업 플랫폼 2대+ 발전소 배치 시" (푸딩) — 자동편성 미충족 조건
  roomPartner?: { id: string; room: string } | null; // "만약 굼이 무역소에 배치되어 있다면" (레토) — 교차방 파트너
  belowThreshold?: number | null; // "누적 속도 30% 미만인 경우" 류 — 대상 방 수치가 임계값 미만일 때만 (사일라흐)
  reqFaction: string | null;
  perFaction: string | null;
  perScope: string | null;
  perCap: number | null;
  perSkillTag: string | null;
  perSkillValue: number | null;
  families?: string[]; // 이 스킬이 속한 "~류" 계열 태그 (build-infra.py skillFamilies 카탈로그)
  tiers?: InfraSkill[]; // 같은 슬롯의 하위 정예화 단계 (스푸리아 기술 교류 α) — 정예화 낮추면 대체
};

type InfraOp = {
  id: string;
  name: string;
  rarity: number;
  job: string;          // 직군 표시명 (뱅가드·가드 …)
  jobCode: string;      // 직군 정렬 순서의 정본 (PIONEER·WARRIOR …)
  subProfession: string;
  birthplace: string;
  race: string;
  faction: string;
  factions?: string[]; // 다중 소속 (마터호른: 카란 무역회사 + 쉐라그) — 진영 카운트는 전부 인정
  accent: string;
  image: string;
  seq: number;
  skills: InfraSkill[];
  unreleased?: boolean; // KR 미실장(중국 선행) — '미래시 데이터 포함' 토글이 켜져야 로스터에 노출
};

// 직군 정렬 순서·정렬 키 — 백과사전(home.tsx)과 동일 (보유 오퍼 설정 정렬용)
const JOB_ORDER = ["PIONEER", "WARRIOR", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"];
const ROSTER_SORT_KEYS = ["기본", "이름", "성급", "발매순", "소속", "출신지", "종족", "직군", "세부 직군"];

const factionsOf = (op: InfraOp): string[] => op.factions ?? [op.faction];

type RoomSpec = { name: string; slots: number; electricity: number; maxCount: number };

const infra = infraData as { rooms: Record<string, RoomSpec>; ops: InfraOp[] };
const ops = infra.ops;
const opById = new Map(ops.map((op) => [op.id, op]));

type Elite = 0 | 1 | 2;

// 미지정 = 2정(최대) 가정. 1정은 '정예화 2' 해금 스킬을, 0정(노정예)은
// '정예화 1'·'정예화 2' 해금 스킬을 아직 못 쓴다 (Lv.1/Lv.30 스킬은 유지)
const eliteLocks = (unlock: string, elite: Elite) => unlock === "정예화 2" || (elite === 0 && unlock === "정예화 1");
function withElite(op: InfraOp, elite: Elite | undefined): InfraOp {
  if (elite == null || elite === 2) return op;
  let changed = false;
  const skills: InfraSkill[] = [];
  for (const skill of op.skills) {
    if (!eliteLocks(skill.unlock, elite)) { skills.push(skill); continue; }
    changed = true;
    // 정예화로 잠긴 스킬 — 같은 슬롯의 하위 단계(기술 교류 α 등)가 있으면 그걸로 대체.
    // 없으면(순수 정예화 해금 스킬) 통째로 빠진다.
    const lower = (skill.tiers ?? []).filter((t) => !eliteLocks(t.unlock, elite));
    if (lower.length) skills.push(lower[lower.length - 1]);
  }
  return changed ? { ...op, skills } : op;
}

// 정예화 단계 선택지: 정예화 해금 스킬이 있어야 의미가 있고,
// 3성은 정예화 1까지·1~2성은 승급 자체가 없다
const ELITE_LABEL: Record<Elite, string> = { 0: "노정예", 1: "1정", 2: "2정" };
function eliteOptions(op: InfraOp): Elite[] {
  if (!op.skills.some((skill) => skill.unlock.startsWith("정예화"))) return [];
  if (op.rarity <= 2) return [];
  return op.rarity === 3 ? [0, 1] : [0, 1, 2];
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

type Ctx = { product?: string; tokenPoints: Record<string, number>; factionCounts?: Record<string, number>; plants?: number; presentIds?: Set<string>; ambient?: AmbientAura[]; roomOf?: Map<string, string> };

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
const AURA_LABEL: Record<string, string> = { ctrl_mfg: "제조소 생산력 오라", ctrl_trade: "무역소 오더 효율 오라", ctrl_hire: "인맥 레퍼런스 오라", ctrl_clue: "단서 수집 오라" };
// 제어센터 오라가 실제로 더해지는 대상 방 — 방 점수·서머리에 합산된다
const AURA_TARGET: Record<string, string> = { MANUFACTURE: "ctrl_mfg", TRADING: "ctrl_trade", HIRE: "ctrl_hire", MEETING: "ctrl_clue" };

// 조건부 오라(이격 실버애쉬: "쉐라그 3명 배치된 무역소")는 조건을 채운 그 방 하나에만 적용
type AmbientAura = { kind: string; value: number; gateFaction?: string | null; gateCount?: number | null; belowThreshold?: number | null };

// 방 기본 속도 — 임계값 조건("N% 미만인 경우, 기본 속도 포함") 판정용 (사무실 기본 누적 5%)
const ROOM_BASE_RATE: Record<string, number> = { HIRE: 5 };

// 제어센터 팀의 활성 오라 목록 — 대상 방 점수에 앰비언트로 더해 준다
function aurasOf(controlTeam: InfraOp[], ctx: Ctx): AmbientAura[] {
  const list: AmbientAura[] = [];
  for (const op of controlTeam) {
    const b = breakdown(op, "CONTROL", controlTeam, ctx);
    for (const skill of b.skills) {
      if (!(skill.kind in AURA_WEIGHT)) continue;
      if (skill.gateFaction || skill.belowThreshold != null) {
        list.push({ kind: skill.kind, value: skill.value, gateFaction: skill.gateFaction, gateCount: skill.gateCount ?? 1, belowThreshold: skill.belowThreshold });
      } else {
        list.push({ kind: skill.kind, value: skill.perFaction ? b.auras[skill.kind] ?? 0 : skill.value });
      }
    }
  }
  return list;
}

// 이 방이 실제로 받는 오라 (동종 최고만) — 조건부 오라는 방 구성원·수치가 조건을 채울 때만.
// roomEfficiency: 방 자체 크루가 내는 효율 (사일라흐 임계값 판정: 기본 속도 + 크루 효율 < 임계)
function ambientFor(room: string, team: InfraOp[], ambient?: AmbientAura[], roomEfficiency = 0): number {
  if (!team.length || !ambient) return 0;
  const target = AURA_TARGET[room] ?? "";
  let best = 0;
  for (const aura of ambient) {
    if (aura.kind !== target) continue;
    if (aura.gateFaction && team.filter((member) => factionsOf(member).includes(aura.gateFaction!)).length < (aura.gateCount ?? 1)) continue;
    if (aura.belowThreshold != null && (ROOM_BASE_RATE[room] ?? 0) + roomEfficiency >= aura.belowThreshold) continue;
    best = Math.max(best, aura.value);
  }
  return best;
}

function breakdown(op: InfraOp, room: string, team: InfraOp[], ctx: Ctx): OpBreakdown {
  const teamIds = new Set(team.map((member) => member.id));
  const teamSize = Math.max(team.length, 1);
  const out: OpBreakdown = { efficiency: 0, facilityEff: 0, automation: 0, quality: 0, payout: 0, payoutViolation: 0, override: 0, perCoworker: 0, auras: {}, skills: [] };
  const tokenRates = new Map<string, number>();
  for (const skill of activeSkills(op, room, ctx.product)) {
    if (skill.partners.length > 0 && !skill.partners.every((p) => teamIds.has(p))) continue;
    // faction companion gate (호시구마: 용문근위국 오퍼와 함께 배치 시)
    if (skill.reqFaction && !team.some((member) => member.id !== op.id && factionsOf(member).includes(skill.reqFaction!))) continue;
    // 진영 N명 배치 게이트 (실버애쉬 이격: 쉐라그 3명 배치된 무역소) — 조 전체 인원수 근사
    if (skill.gateFaction && (ctx.factionCounts?.[skill.gateFaction] ?? 0) < (skill.gateCount ?? 1)) continue;
    // 교차방 파트너 조건(레토: 굼이 무역소에): roomOf가 주어진 검증 단계에선 파트너가 지정 방에
    // 실제 있어야 발동. 그리디 1차(roomOf 없음)에선 낙관적으로 통과시켜 짝이 배치될 기회를 준다
    if (skill.roomPartner && ctx.roomOf && ctx.roomOf.get(skill.roomPartner.id) !== skill.roomPartner.room) continue;
    out.skills.push(skill);
    // 작업 플랫폼 발전소 배치 조건(푸딩)은 자동편성이 충족하지 않으므로 오라를 계상하지 않는다
    // — 스킬 자체는 표시(위에서 push)하되 효과는 0으로 둔다
    if (skill.gatePlatforms) continue;
    // 기반시설 어디든 존재 조건 (언더플로우: 울피아누스가 숙소 포함 기지 내에 있으면 +10%)
    if (skill.basePartners?.length && skill.basePartnerBonus && skill.basePartners.every((p) => ctx.presentIds?.has(p))) {
      out.efficiency += skill.basePartnerBonus;
    }
    // per-faction counting (바르카리스: 미노스 오퍼레이터 1명당 +v%, 최대 cap)
    if (skill.perFaction && skill.perSkillTag == null) {
      const count = skill.perScope === "room"
        ? team.filter((member) => factionsOf(member).includes(skill.perFaction!)).length
        : ctx.factionCounts?.[skill.perFaction] ?? 0;
      const gained = Math.min(skill.value * count, skill.perCap ?? Infinity);
      if (skill.kind in AURA_WEIGHT) { out.auras[skill.kind] = Math.max(out.auras[skill.kind] ?? 0, gained); continue; }
      out.efficiency += gained;
      continue;
    }
    // same-room skill-tag counting (도로시: 라인테크류 1개당 +5% / 브라이오피타: 금속공예류 +5%)
    // 계열 판정은 build-infra.py가 정리한 families 카탈로그 우선. 폴백도 부분매칭이 아니라
    // **정확 명칭**("<태그>" 또는 "<태그> α/β/γ")만 인정 — '비표준화'류 오포함 방지, 사용자
    // 확정 2026-07. (컨빅션 "작전기록류 +35%"의 '~류'는 제품 분류라 계열이 아님)
    if (skill.perSkillTag && skill.perSkillValue) {
      const tag = skill.perSkillTag;
      let count = 0;
      for (const member of team) for (const active of activeSkills(member, room, ctx.product)) {
        const raw = (active.krName ?? active.name).trim();
        const inFamily = active.families ? active.families.includes(tag)
          : raw.startsWith(tag) && raw.slice(tag.length).trim().length <= 2 && !/[가-힣]/.test(raw.slice(tag.length));
        if (inFamily) count += 1;
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
  // 제어센터 오라를 대상 방 점수에 실제 합산 — "무역소 오더 효율 +10%"면 무역소가 +10%.
  // 조건부 오라(쉐라그 3명 배치)는 조건을 채운 그 방 하나에만 붙는다
  return efficiency + quality + payout + auras + ambientFor(room, team, ctx.ambient, efficiency);
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
  const ranked = solo.slice(0, 40).map((entry) => entry.op);
  // 점수가 실제로 오를 때만 슬롯을 채운다 — 0 기여 몸빵으로 컨디션을 낭비하지 않고,
  // 아르모니류 '자신만 업무 중' 스킬은 혼자 남을 수 있다
  const fill = (seed: InfraOp[], shortlist: InfraOp[] = ranked): InfraOp[] => {
    const team = [...seed].slice(0, slots);
    while (team.length < slots) {
      let pick: InfraOp | null = null;
      let pickScore = teamScore(team, room, ctx); // 현재 점수보다 나아야 추가
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
  // 솔로 스킬 오퍼가 상위에 있으면 그리디가 '혼자 50%'에 갇혀 '둘이 60%' 조합을 놓친다
  // — 솔로 오퍼를 뺀 대안 팀도 만들어 비교한다
  const noSolo = ranked.filter((op) => !op.skills.some((skill) => skill.kind === "solo" && skillApplies(skill, room, ctx.product)));
  if (noSolo.length !== ranked.length) {
    const alt = fill(seedOps, noSolo);
    const altScore = teamScore(alt, room, ctx);
    if (altScore > bestScore) { best = alt; bestScore = altScore; }
  }
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
  strategy: string;             // KR 조합 문자열 (구버전 저장 호환용)
  strategyTokens?: string[];    // 표시용 구조 필드 — 로케일에서 토큰명 번역해 재조립
  strategySet?: boolean;
  priority?: ProdPriority;    // 우선 생산 모드 (기본 gold)
};

// 전략 라벨은 저장된 문자열이 아니라 구조 필드에서 로케일로 재조립한다
// (localStorage의 구버전 플랜은 strategyTokens가 없어 KR 문자열 그대로 표시)
function strategyLabel(plan: Plan, locale: Locale, t: T): string {
  if (!plan.strategyTokens) return plan.strategy;
  const base = plan.strategyTokens.length
    ? t("{tokens} 패키지", { tokens: plan.strategyTokens.map((token) => tokenName(locale, token)).join(" + ") })
    : t("기본 편성");
  return base + (plan.strategySet ? t(" + 쉐라그 세트") : "");
}

// 방 채우기 우선순위 (사용자 확정 2026-07): 제조소-순금 > 제조소-작전기록 > 무역소 >
// 발전소 > 사무실 > 응접실 — 먼저 채우는 방이 최고 요원을 가져간다. 응접실은 최하위
// (제어센터는 쉐이 시드·오라 요원 전용이라 경합이 적어 발전소 다음에 둔다)
const PRODUCTION_KEYS = ["MANUFACTURE-0", "MANUFACTURE-1", "MANUFACTURE-2", "MANUFACTURE-3", "TRADING-0", "TRADING-1", "POWER-0", "POWER-1", "POWER-2"];
// 우선 생산 모드 (사용자 확정 2026-07): 먼저 채우는 방이 최고 요원을 가져가므로,
// 방 순서만 바꾸면 순금 우선 / 작전기록 우선 / 밸런스(교차)가 된다.
export type ProdPriority = "gold" | "exp" | "balance";
const PRIORITY_KEYS: Record<ProdPriority, string[]> = {
  gold: PRODUCTION_KEYS,
  exp: ["MANUFACTURE-2", "MANUFACTURE-3", "MANUFACTURE-0", "MANUFACTURE-1", "TRADING-0", "TRADING-1", "POWER-0", "POWER-1", "POWER-2"],
  balance: ["MANUFACTURE-0", "MANUFACTURE-2", "MANUFACTURE-1", "MANUFACTURE-3", "TRADING-0", "TRADING-1", "POWER-0", "POWER-1", "POWER-2"],
};
const SUPPORT_KEYS = ["CONTROL", "HIRE", "MEETING", "WORKSHOP", "TRAINING"];

function ctxFor(key: string, tokenPoints: Record<string, number>, factionCounts?: Record<string, number>, plants?: number, presentIds?: Set<string>, ambient?: Record<string, number>): Ctx {
  return { product: cellByKey.get(key)?.product, tokenPoints, factionCounts, plants, presentIds, ambient };
}

// 해당 조 기준 기지 내 배치 전원 (숙소·응접실 포함) — 기반시설 존재 조건 판정용
function presentIdsFor(plan: Plan, shift: number): Set<string> {
  const ids = new Set<string>();
  for (const shifts of Object.values(plan.assignments)) {
    for (const id of shifts[Math.min(shift, shifts.length - 1)] ?? []) ids.add(id);
  }
  return ids;
}

function buildPlan(packageTokens: string[], roster: InfraOp[], factionSets = false, priority: ProdPriority = "gold"): Plan {
  const prodKeys = PRIORITY_KEYS[priority];
  const assignments: Record<string, string[][]> = {};
  const used = new Set<string>();
  const keys = [...prodKeys, ...SUPPORT_KEYS];
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
    // 쉐라그 무역소 세트: 이격 실버애쉬(제어센터 "쉐라그 3명 배치된 무역소 +10%")
    // 보유 시 쉐라그 3명을 무역소 한 곳에 모으는 후보안 — 무조건 채택이 아니라
    // optimize()가 세트 미포함안과 총점을 비교해 이득일 때만 쓴다 (사용자 확정)
    if (shift === 0 && factionSets) {
      for (const auraOp of roster) {
        for (const skill of auraOp.skills) {
          if (skill.room !== "CONTROL" || !skill.gateFaction || !skill.gateCount) continue;
          const bodies = roster
            .filter((op) => op.id !== auraOp.id && !used.has(op.id) && !reserved.has(op.id) && factionsOf(op).includes(skill.gateFaction!))
            .sort((a, b) => opSolo(b, "TRADING", 3, { tokenPoints: {} }) - opSolo(a, "TRADING", 3, { tokenPoints: {} }));
          if (bodies.length < skill.gateCount) continue;
          const set = bodies.slice(0, skill.gateCount);
          seeds["TRADING-0"] = [...(seeds["TRADING-0"] ?? []), ...set].slice(0, 3);
          seeds["CONTROL"] = [...(seeds["CONTROL"] ?? []), auraOp];
          for (const op of seeds["TRADING-0"]) reserved.set(op.id, "TRADING-0");
          reserved.set(auraOp.id, "CONTROL");
        }
      }
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
            // 우선 생산 모드 순서대로 시드 배치 — 순금 우선이면 순금 제조소부터,
            // 작전기록 우선이면 작전기록부터, 밸런스는 교차 순서로 최고 요원이 앉는다
            const ord = new Map(prodKeys.map((k, i) => [k, i] as const));
            const targets = LAYOUT.filter((c) => c.room === skill.room && !PARK_KEYS.includes(c.key))
              .sort((a, b) => (ord.get(a.key) ?? 99) - (ord.get(b.key) ?? 99));
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
      const room = cellByKey.get(key)?.room ?? key;
      const slots = infra.rooms[room]?.slots ?? 1;
      const pool = new Map(roster.filter((op) => !used.has(op.id) && (shift > 0 || !reserved.has(op.id) || reserved.get(op.id) === key)).map((op) => [op.id, op]));
      const ctx = ctxFor(key, shift === 0 ? tokenPoints : {}, shiftFactionCounts, plants, placedIds);
      const seed = (seeds[key] ?? []).filter((op) => pool.has(op.id));
      const team = bestTeam(room, slots, pool, ctx, seed);
      team.forEach((op) => {
        used.add(op.id);
        placedIds.add(op.id);
        for (const faction of factionsOf(op)) shiftFactionCounts[faction] = (shiftFactionCounts[faction] ?? 0) + 1;
      });
      assignments[key].push(team.map((op) => op.id));
    }
    factionCountsPerShift.push(shiftFactionCounts);
  }
  // dorms: pinned rest space; package members that generate from the dorm
  // (아이리스·체르니·비르투오사 등) stay locked in regardless of shift
  for (let d = 0; d < 4; d += 1) assignments[`DORM-${d}`] = [dormPins[d].map((op) => op.id)];

  // ── 교차방 조건 리페어 패스 (사용자 제안 2026-07) ──────────────────────────────
  // 그리디는 방을 우선순위대로 채우느라 "굼이 무역소에 있어야 +35%"인 레토처럼 나중에
  // 채워질 방에 걸린 조건을 1차엔 낙관적으로 배치한다. 편성을 다 마친 뒤 조 전체를 다시
  // 보고, 조건이 실제로 미충족인 오퍼는 그 자리에서 더 나은 벤치 오퍼로 교체(없으면 제거)한다.
  // 조건 미충족 오퍼만 손대므로(그리디 결과를 갈아엎지 않음) 안전. 안정될 때까지 최대 3회.
  const byIdAll = new Map(roster.map((op) => [op.id, op]));
  for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
    for (let pass = 0; pass < 3; pass += 1) {
      const roomOf = new Map<string, string>();
      const placed = new Set<string>();
      for (const key of Object.keys(assignments)) {
        const room = cellByKey.get(key)?.room ?? key;
        for (const id of assignments[key][Math.min(shift, assignments[key].length - 1)] ?? []) { roomOf.set(id, room); placed.add(id); }
      }
      const fc: Record<string, number> = {};
      for (const id of placed) { const op = byIdAll.get(id); if (op) for (const f of factionsOf(op)) fc[f] = (fc[f] ?? 0) + 1; }
      // 다른 조의 근무 인원 — 대체 후보로 뽑으면 A·B 동시 배치가 되므로 제외 (INFRA-RULES §1)
      const otherWorking = new Set<string>();
      for (const okey of Object.keys(assignments)) {
        const oroom = cellByKey.get(okey)?.room ?? okey;
        if (oroom === "DORMITORY" || oroom === "WORKSHOP") continue;
        for (const id of assignments[okey][Math.min(SHIFT_COUNT - 1 - shift, assignments[okey].length - 1)] ?? []) otherWorking.add(id);
      }
      let changed = false;
      for (const key of prodKeys) {
        const room = cellByKey.get(key)?.room ?? key;
        const idx = Math.min(shift, assignments[key].length - 1);
        const team = (assignments[key][idx] ?? []).map((id) => byIdAll.get(id)).filter((op): op is InfraOp => Boolean(op));
        if (!team.length) continue;
        const ctx: Ctx = { product: cellByKey.get(key)?.product, tokenPoints: shift === 0 ? tokenPoints : {}, factionCounts: fc, plants, presentIds: placed, roomOf };
        // 조건(roomPartner)이 실제 미충족인 멤버 — 시드/예약 오퍼는 건드리지 않는다
        const member = team.find((op) => reserved.get(op.id) !== key && op.skills.some((sk) =>
          sk.roomPartner && skillApplies(sk, room, ctx.product) && roomOf.get(sk.roomPartner.id) !== sk.roomPartner.room));
        if (!member) continue;
        const rest = team.filter((op) => op !== member);
        // 미충족 멤버는 "빼기(DROP)"를 기본값으로 둔다 — 조건이 안 채워진 데드웨이트는
        // 슬롯을 비우는 게 낫다(0 기여 몸빵 금지). 유지·대체가 더 나을 때만 그쪽을 택한다.
        let bestScore = teamScore(rest, room, ctx);
        let bestPick: InfraOp | "DROP" | null = "DROP";
        if (teamScore(team, room, ctx) > bestScore) { bestScore = teamScore(team, room, ctx); bestPick = null; }
        for (const op of roster) {
          if (placed.has(op.id) || reserved.has(op.id) || otherWorking.has(op.id)) continue;
          if (!op.skills.some((sk) => skillApplies(sk, room, ctx.product))) continue;
          const sc = teamScore([...rest, op], room, ctx);
          if (sc > bestScore) { bestScore = sc; bestPick = op; }
        }
        if (bestPick) {
          const newTeam = bestPick === "DROP" ? rest : [...rest, bestPick];
          assignments[key][idx] = newTeam.map((op) => op.id);
          placed.delete(member.id); roomOf.delete(member.id);
          if (bestPick !== "DROP") { placed.add(bestPick.id); roomOf.set(bestPick.id, room); }
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  // ── 편성 후 전수 감사 ×3 (사용자 확정 2026-07, INFRA-RULES §1) ────────────────────
  // 한 번의 그리디로는 "A조=최강·조 동시배치 금지·빈 방 금지" 규칙을 놓치므로, 편성을
  // 마친 뒤 최대 3회 다시 훑어 교정한다. 매 회: ① A조가 각 방(제품 타입별)에서 최강이
  // 되도록 B조의 더 나은 요원을 끌어올리고(같은 방타입 내 swap, 시드/예약은 고정) →
  // ② A·B 동시 배치를 제거하고 → ③ 빈 근무 방을 벤치 최고 요원으로 채운다. 사기 비소모
  // 방 숙소(휴식)·가공소(상시 슬롯)만 예외로 조 전환과 무관하게 고정.
  {
    const restRoom = (key: string) => { const r = cellByKey.get(key)?.room ?? key; return r === "DORMITORY" || r === "WORKSHOP"; };
    const workKeys = keys.filter((key) => !restRoom(key) && key !== "TRAINING");
    const dormIds = new Set<string>();
    for (let d = 0; d < 4; d += 1) for (const id of assignments[`DORM-${d}`]?.[0] ?? []) dormIds.add(id);
    // 조 단위 2단계 감사 (사용자 규칙 2026-07): A조를 먼저 최대 3회 전수검사로 풀파워로
    // 완성하고(전체 로스터에서 선발), 그 뒤 B조를 "남은 오퍼만으로" 최대 3회 전수검사한다.
    // A·B를 한 번에 섞어 보면 서로 자리를 뺏고 되돌리는 진동이 생긴다.
    const orderKeys = [...prodKeys, ...SUPPORT_KEYS].filter((k) => workKeys.includes(k));
    for (let auditShift = 0; auditShift < SHIFT_COUNT; auditShift += 1) {
      const tp = auditShift === 0 ? tokenPoints : {};
      // 앞서 확정한 조의 근무자 — 이번 조에서 사용 금지(동시 배치 금지), 남아 있으면 제거
      const lockedPrev = new Set<string>();
      for (let s2 = 0; s2 < auditShift; s2 += 1) for (const k of workKeys) for (const id of assignments[k]?.[s2] ?? []) lockedPrev.add(id);
      for (const k of workKeys) {
        const idx = Math.min(auditShift, (assignments[k]?.length ?? 1) - 1);
        assignments[k][idx] = (assignments[k]?.[idx] ?? []).filter((id) => !lockedPrev.has(id));
      }
    for (let pass = 0; pass < 3; pass += 1) {
      let changed = false;
      const shift = auditShift;

      // ① 방별 통째 검수 (사용자 규칙 2026-07): 시설을 하나하나 보며
      //    세 후보를 만들어 "총 생산력"을 직접 비교하고 높은 쪽을 배치한다. 한 자리씩 바꾸는
      //    swap이 아니라 팀 전체 단위 비교라 국소최적에 안 갇힌다. (B조를 검수하지 않으면
      //    "도로시 혼자" 같은 방이 회복 교대에 그대로 남는다 — 사용자 지적 2026-07)
      //    ⓐ 현재 팀 그대로
      //    ⓑ 일반 재편성 — 자유 풀(벤치, 반대 조 근무자 제외)에서 방 전체를 다시 짠 최고 팀
      //    ⓒ 시너지 결집 — perSkillTag 보유자(도로시: 라인테크류 1개당 +5%)를 축으로 같은
      //       계열(families 카탈로그)을 채운 팀. 계열 요원이 같은 조 다른 방에 있으면 그 방의
      //       손실(차출 후 재충원해도 남는 점수 하락)을 비용으로 계산해 순증일 때만 차출한다.
      //       **총점 동률이면 ⓒ(시너지 결집)를 우선한다** — 같은 점수면 계열을 모아두는 쪽이
      //       정배이고, 사용자가 편성을 읽을 때도 의도가 보인다.
      //    시드·예약 요원은 항상 유지, roomPartner는 엄격 평가(굼 없는 레토 방지).
      {
        for (const aKey of orderKeys) {
          const room = cellByKey.get(aKey)?.room ?? aKey;
          const slots = infra.rooms[room]?.slots ?? 1;
          // 이 조의 현재 배치 지도 (매 방마다 갱신) + 반대 조 근무자(동시 배치 금지 대상)
          const roomKeyOf = new Map<string, string>();
          for (const k of workKeys) for (const id of assignments[k]?.[shift] ?? []) roomKeyOf.set(id, k);
          const otherWork = lockedPrev; // 앞 조(A) 근무자만 잠금 — 같은 조 내 이동은 자유
          const roomOfS = new Map<string, string>();
          for (const [id, k] of roomKeyOf) roomOfS.set(id, cellByKey.get(k)?.room ?? k);
          for (const id of dormIds) roomOfS.set(id, "DORMITORY");
          const present = new Set<string>([...roomKeyOf.keys(), ...dormIds]);
          const ctx = { ...ctxFor(aKey, tp, factionCountsPerShift[shift], plants, present), roomOf: roomOfS };
          const curTeam = (assignments[aKey][shift] ?? []).map((id) => byIdAll.get(id)).filter((op): op is InfraOp => Boolean(op));
          const seedKeep = shift === 0 ? curTeam.filter((op) => reserved.get(op.id) === aKey) : []; // 예약 시드는 A조 개념
          // 자유 풀 = 벤치 + 이 방의 현재 멤버 (같은 조 다른 방·반대 조 근무·숙소 고정·타방 예약 제외)
          const freeOps = roster.filter((op) =>
            !dormIds.has(op.id) && !otherWork.has(op.id) &&
            (!roomKeyOf.has(op.id) || roomKeyOf.get(op.id) === aKey) &&
            (shift > 0 || !reserved.has(op.id) || reserved.get(op.id) === aKey));
          const score = (team: InfraOp[]) => teamScore(team, room, ctx);
          let bestPickTeam = curTeam;
          let bestNet = score(curTeam);
          let bestDonors: { fromKey: string; refill: InfraOp[] }[] = [];
          // ⓑ 일반 재편성
          const flat = bestTeam(room, slots, new Map(freeOps.map((op) => [op.id, op])), ctx, seedKeep);
          if (score(flat) > bestNet + 1e-6) { bestPickTeam = flat; bestNet = score(flat); bestDonors = []; }
          // ⓒ 시너지 결집 — 계열 카운트 보유자별 후보 팀
          const holders = freeOps.filter((op) => activeSkills(op, room, ctx.product).some((sk) => sk.perSkillTag && sk.perSkillValue));
          for (const holder of holders) {
            const tags = new Set(activeSkills(holder, room, ctx.product).flatMap((sk) => (sk.perSkillTag ? [sk.perSkillTag] : [])));
            const isFam = (op: InfraOp) => op.id !== holder.id && activeSkills(op, room, ctx.product).some((sk) => {
              if (sk.families) return sk.families.some((f) => tags.has(f));
              const raw = (sk.krName ?? sk.name).trim(); // 폴백도 정확 명칭만 — 부분매칭 금지
              return [...tags].some((t) => raw.startsWith(t) && raw.slice(t.length).trim().length <= 2 && !/[가-힣]/.test(raw.slice(t.length)));
            });
            let team = seedKeep.some((op) => op.id === holder.id) ? [...seedKeep] : [...seedKeep, holder];
            if (team.length > slots) continue;
            // 전체 자유 풀에서 한계 기여 순으로 채우되, **동률이면 계열 요원 우선**(미세 보정 +1e-4).
            // 계열만 먼저 채우면 [도로시+계열+계열]=95가 [도로시+계열+강범용]=100을 가리는 함정이 있다.
            let adding = true;
            while (adding && team.length < slots) {
              adding = false;
              let pick: InfraOp | null = null; let ps = score(team) + 1e-6;
              for (const op of freeOps) {
                if (team.some((t) => t.id === op.id)) continue;
                const s = score([...team, op]) + (isFam(op) ? 1e-4 : 0);
                if (s > ps) { ps = s; pick = op; }
              }
              if (pick) { team.push(pick); adding = true; }
            }
            // 같은 조 다른 방의 계열 요원 차출 — 그 방의 손실을 비용으로 치르고 순증일 때만
            const donors: { fromKey: string; refill: InfraOp[] }[] = [];
            let net = 0;
            if (team.length < slots) {
              for (const [id, fromKey] of roomKeyOf) {
                if (team.length >= slots) break;
                if (fromKey === aKey || reserved.has(id)) continue;
                const op = byIdAll.get(id);
                if (!op || !isFam(op) || team.some((t) => t.id === op.id)) continue;
                const gain = score([...team, op]) - score(team);
                const dRoom = cellByKey.get(fromKey)?.room ?? fromKey;
                const dSlots = infra.rooms[dRoom]?.slots ?? 1;
                const dCtx = { ...ctxFor(fromKey, tp, factionCountsPerShift[shift], plants, present), roomOf: roomOfS };
                const dTeam = (assignments[fromKey][shift] ?? []).map((x) => byIdAll.get(x)).filter((o): o is InfraOp => Boolean(o));
                const rest = dTeam.filter((o) => o.id !== id);
                const claimed = new Set(team.map((t) => t.id));
                const dPool = new Map(freeOps.filter((o) => !claimed.has(o.id)).map((o) => [o.id, o]));
                const refill = bestTeam(dRoom, dSlots, dPool, dCtx, rest);
                const cost = teamScore(dTeam, dRoom, dCtx) - teamScore(refill, dRoom, dCtx);
                if (gain - cost > 1e-6) { team.push(op); donors.push({ fromKey, refill }); net -= cost; }
              }
            }
            // 남는 자리는 자유 풀 최고 요원으로 (점수가 오를 때만 — 0 기여 몸빵 금지)
            if (team.length < slots) {
              const claimed = new Set([...team.map((t) => t.id), ...donors.flatMap((d) => d.refill.map((o) => o.id))]);
              team = bestTeam(room, slots, new Map(freeOps.filter((o) => !claimed.has(o.id)).map((o) => [o.id, o])), ctx, team);
            }
            const total = score(team) + net;
            // 순증이면 채택. 차출 없는 결집은 동률(±1e-6)이어도 채택 — 같은 점수면 시너지를
            // 모아두는 게 정배(시너지 우선 규칙). 동일 팀 재선택은 커밋 가드가 걸러 수렴한다.
            const wins = donors.length ? total > bestNet + 1e-6 : total > bestNet - 1e-6;
            if (wins) { bestPickTeam = team; bestNet = Math.max(bestNet, total); bestDonors = donors; }
          }
          // 최고 후보 배치 (중복·공백은 바로 뒤 ②·③이 정규화)
          const newIds = bestPickTeam.map((o) => o.id);
          if (newIds.join() !== (assignments[aKey][shift] ?? []).join()) {
            assignments[aKey][shift] = newIds;
            for (const d of bestDonors) assignments[d.fromKey][shift] = d.refill.map((o) => o.id);
            changed = true;
          }
        }
      }

      // ④ 체인 승격 (사용자 지적 2026-07: 미즈키 30 근무·트라고디아 35 벤치): 제품 전용
      //    스페셜리스트는 자기 제품 방이 동률 범용으로 차 있으면 ⓑ 재편성으로 못 들어온다
      //    (동률이라 교체 이득 0). 벤치 오퍼 S를 방 R의 멤버 M 자리에 넣고(손해 없음 이상),
      //    밀려난 M을 다른 방 R2의 더 약한 W 자리(또는 빈 슬롯)로 옮기는 2단 이동을
      //    "두 방 합산 순증"일 때 실행한다. 시드·예약은 건드리지 않는다.
      {
        let moved = true;
        let guard = 0;
        while (moved && guard < 30) {
          moved = false; guard += 1;
          const roomKeyOf = new Map<string, string>();
          for (const k of workKeys) for (const id of assignments[k]?.[shift] ?? []) roomKeyOf.set(id, k);
          const otherWork = lockedPrev; // 앞 조(A) 근무자만 잠금 — 같은 조 내 이동은 자유
          const roomOfS = new Map<string, string>();
          for (const [id, k] of roomKeyOf) roomOfS.set(id, cellByKey.get(k)?.room ?? k);
          for (const id of dormIds) roomOfS.set(id, "DORMITORY");
          const present = new Set<string>([...roomKeyOf.keys(), ...dormIds]);
          const ctxOf = (key: string) => ({ ...ctxFor(key, tp, factionCountsPerShift[shift], plants, present), roomOf: roomOfS });
          const scoreOf = (key: string, team: InfraOp[]) => teamScore(team, cellByKey.get(key)?.room ?? key, ctxOf(key));
          const teamOf = (key: string) => (assignments[key]?.[shift] ?? []).map((id) => byIdAll.get(id)).filter((op): op is InfraOp => Boolean(op));
          const bench = roster.filter((op) => !dormIds.has(op.id) && !roomKeyOf.has(op.id) && !otherWork.has(op.id) && !reserved.has(op.id));
          // 후보 S = 벤치(이탈 비용 0) + 같은 조 다른 방 근무자(이탈 시 그 방을 벤치로 재충원한
          // 손실 g0 부담) — 미틈이 다른 무역소에 묶여 샤마르·테킬라 조합에 못 가는 케이스 회수
          const sources: { S: InfraOp; fromKey: string | null }[] = [
            ...bench.map((S) => ({ S, fromKey: null as string | null })),
            ...[...roomKeyOf.entries()].filter(([id]) => !reserved.has(id)).map(([id, k]) => ({ S: byIdAll.get(id)!, fromKey: k as string | null })).filter((x) => Boolean(x.S)),
          ];
          chain: for (const { S, fromKey } of sources) {
            // 소스 방 이탈 비용 (벤치면 0)
            let g0 = 0; let srcRefill: InfraOp[] | null = null;
            if (fromKey) {
              const t0 = teamOf(fromKey);
              const room0 = cellByKey.get(fromKey)?.room ?? fromKey;
              const slots0 = infra.rooms[room0]?.slots ?? 1;
              const pool0 = new Map(bench.map((o) => [o.id, o]));
              srcRefill = bestTeam(room0, slots0, pool0, ctxOf(fromKey), t0.filter((o) => o.id !== S.id));
              g0 = scoreOf(fromKey, srcRefill) - scoreOf(fromKey, t0);
            }
            for (const rKey of workKeys) {
              if (rKey === fromKey) continue;
              const room = cellByKey.get(rKey)?.room ?? rKey;
              if (!S.skills.some((sk) => skillApplies(sk, room, cellByKey.get(rKey)?.product))) continue;
              const team = teamOf(rKey);
              const base1 = scoreOf(rKey, team);
              for (let i = 0; i < team.length; i += 1) {
                const M = team[i];
                if (reserved.has(M.id)) continue;
                const g1 = scoreOf(rKey, team.map((o, x) => (x === i ? S : o))) - base1;
                if (g1 < -1e-6) continue; // S가 그 자리에서 손해면 체인 무의미
                // M의 최선 재배치처 탐색 (다른 방의 약한 멤버 대체 또는 빈 슬롯)
                let g2 = 0; let r2Key: string | null = null; let wIdx = -1;
                for (const cand of workKeys) {
                  if (cand === rKey || cand === fromKey) continue;
                  const room2 = cellByKey.get(cand)?.room ?? cand;
                  if (!M.skills.some((sk) => skillApplies(sk, room2, cellByKey.get(cand)?.product))) continue;
                  const t2 = teamOf(cand);
                  const base2 = scoreOf(cand, t2);
                  const slots2 = infra.rooms[room2]?.slots ?? 1;
                  if (t2.length < slots2) {
                    const g = scoreOf(cand, [...t2, M]) - base2;
                    if (g > g2) { g2 = g; r2Key = cand; wIdx = -1; }
                  }
                  for (let j = 0; j < t2.length; j += 1) {
                    if (reserved.has(t2[j].id)) continue;
                    const g = scoreOf(cand, t2.map((o, x) => (x === j ? M : o))) - base2;
                    if (g > g2) { g2 = g; r2Key = cand; wIdx = j; }
                  }
                }
                if (g0 + g1 + g2 > 1e-6) {
                  if (fromKey && srcRefill) assignments[fromKey][shift] = srcRefill.map((o) => o.id);
                  assignments[rKey][shift] = team.map((o, x) => (x === i ? S : o)).map((o) => o.id);
                  if (r2Key) {
                    const t2 = teamOf(r2Key);
                    assignments[r2Key][shift] = (wIdx < 0 ? [...t2, M] : t2.map((o, x) => (x === wIdx ? M : o))).map((o) => o.id);
                  }
                  changed = true; moved = true;
                  break chain; // 지도가 바뀌었으니 처음부터 다시 스캔
                }
              }
            }
          }
        }
      }

      // ②·③ 조 동시배치 제거 + 빈 방 재충원 (이번 조만)
      {
        const otherWorking = lockedPrev;
        const usedThisShift = new Set<string>();
        for (const key of workKeys) {
          const kept = (assignments[key][shift] ?? []).filter((id) => !otherWorking.has(id) && !usedThisShift.has(id));
          if (kept.length !== (assignments[key][shift] ?? []).length) changed = true;
          assignments[key][shift] = kept;
          for (const id of kept) usedThisShift.add(id);
        }
        // roomPartner 조건 엄격 평가용 현재 배치 지도 — 재충원이 굼 없는 레토 등을 도로 넣지 않게.
        const roomOfS = new Map<string, string>();
        for (const k of workKeys) { const rm = cellByKey.get(k)?.room ?? k; for (const id of assignments[k]?.[shift] ?? []) roomOfS.set(id, rm); }
        for (let dd = 0; dd < 4; dd += 1) for (const id of assignments[`DORM-${dd}`]?.[0] ?? []) roomOfS.set(id, "DORMITORY");
        for (const key of workKeys) {
          const room = cellByKey.get(key)?.room ?? key;
          const slots = infra.rooms[room]?.slots ?? 1;
          const team = assignments[key][shift] ?? [];
          if (team.length >= slots) continue;
          const present = new Set<string>([...usedThisShift, ...dormIds]);
          const ctx = { ...ctxFor(key, shift === 0 ? tokenPoints : {}, factionCountsPerShift[shift], plants, present), roomOf: roomOfS };
          const pool = new Map(roster.filter((op) =>
            !usedThisShift.has(op.id) && !otherWorking.has(op.id) &&
            (shift > 0 || !reserved.has(op.id) || reserved.get(op.id) === key)).map((op) => [op.id, op]));
          const seed = team.map((id) => byIdAll.get(id)).filter((op): op is InfraOp => Boolean(op));
          const filled = bestTeam(room, slots, pool, ctx, seed);
          if (filled.length !== team.length) changed = true;
          assignments[key][shift] = filled.map((op) => op.id);
          for (const op of filled) { usedThisShift.add(op.id); roomOfS.set(op.id, room); }
        }
      }

      if (!changed) break;
    }
    }
  }

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
        const count = placedA.filter((op) => factionsOf(op).some((faction) => faction.includes(gen.perMember!.match))).length;
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
  const strategy = (packageTokens.length ? `${packageTokens.join(" + ")} 패키지` : "기본 편성") + (factionSets ? " + 쉐라그 세트" : "");
  return { assignments, plants, tokenPoints, factionCounts: factionCountsPerShift, flows, strategy, strategyTokens: packageTokens, strategySet: factionSets, priority };
}

// 세트 채택 비교 시 조별 가중 — A조는 풀파워 주력, B조는 회복 교대(§1). 동일 가중이면
// 약한 쉐라그 세트를 A조에 앉히고 강한 샤마르 조합을 B조로 밀어도 총점이 같아 세트가 잘못
// 채택된다(사용자 지적 2026-07). A조를 더 높게 쳐서 강조합이 A조에 남게 한다.
const SHIFT_WEIGHT = [1, 0.6];

// 계획 전체 총점 (양 조 전 방, 앰비언트 오라 포함) — 세트 포함/미포함 두 안 비교용
function planScore(plan: Plan, byId: Map<string, InfraOp>): number {
  let total = 0;
  for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
    const shiftWeight = SHIFT_WEIGHT[shift] ?? 1;
    const teamAt = (key: string): InfraOp[] => {
      const shifts = plan.assignments[key] ?? [];
      return (shifts[Math.min(shift, shifts.length - 1)] ?? []).map((id) => byId.get(id)).filter(Boolean) as InfraOp[];
    };
    const points = shift === 0 ? plan.tokenPoints : {};
    const counts = plan.factionCounts[shift] ?? {};
    const present = presentIdsFor(plan, shift);
    const ambient = aurasOf(teamAt("CONTROL"), ctxFor("CONTROL", points, counts, plan.plants, present));
    for (const key of [...PRODUCTION_KEYS, ...SUPPORT_KEYS]) {
      const cell = cellByKey.get(key)!;
      if (PARK_KEYS.includes(key)) continue;
      total += shiftWeight * teamScore(teamAt(key), cell.room, ctxFor(key, points, counts, plan.plants, present, ambient));
    }
  }
  return total;
}

function optimize(roster: InfraOp[], priority: ProdPriority = "gold"): Plan {
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
  const base = buildPlan(open, roster, false, priority);
  // 쉐라그 세트 같은 조건부 오라 후보가 있으면 세트 포함안을 만들어 총점이 높을 때만 채택
  const hasGatedAura = roster.some((op) => op.skills.some((skill) => skill.room === "CONTROL" && skill.gateFaction));
  if (!hasGatedAura) return base;
  const withSet = buildPlan(open, roster, true, priority);
  const byId = new Map(roster.map((op) => [op.id, op]));
  return planScore(withSet, byId) > planScore(base, byId) ? withSet : base;
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

export default function InfraPlanner({ onShowOperator, extra, includeFuture }: { onShowOperator?: (id: string) => void; extra?: ExtraI18n | null; includeFuture?: boolean } = {}) {
  const { locale, t } = useI18n();
  // 로케일 표시 오버레이: 이름·스킬명·설명만 교체하고(krName에 원본 보존),
  // 엔진이 쓰는 구조 필드(unlock·kind·token 등)는 KR 원본 그대로 둔다
  const lops = useMemo(() => {
    if (!extra) return ops;
    const loc = (skill: InfraSkill): InfraSkill => ({
      ...skill,
      krName: skill.name,
      name: (skill.buffId && extra.buffs[skill.buffId]?.name) || skill.name,
      description: (skill.buffId && extra.buffs[skill.buffId]?.desc) || skill.description,
      // 하위 정예화 단계(정예화 낮추면 대체됨)도 같은 오버레이로 로컬라이즈
      ...(skill.tiers ? { tiers: skill.tiers.map(loc) } : {}),
    });
    return ops.map((op) => ({
      ...op,
      name: extra.names[op.id] ?? op.name,
      skills: op.skills.map(loc),
    }));
  }, [extra]);
  // 미실장(중국 선행) 오퍼는 '미래시 데이터 포함' 토글이 켜져야 로스터·설정·편성에 등장.
  // 토글을 바꿔도 현재 편성은 갈아엎지 않는다 — 다음 자동편성부터 반영 (설정 불변 원칙)
  const visibleOps = useMemo(() => (includeFuture ? lops : lops.filter((op) => !op.unreleased)), [lops, includeFuture]);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [priority, setPriorityState] = useState<ProdPriority>("gold"); // 우선 생산 모드
  const [activeShift, setActiveShift] = useState(0);
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const [showFlows, setShowFlows] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false); // '그 외' 드롭다운(이미지·파일·도움말)
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // 1~5성은 기본 보유, 6성은 미보유로 시작 — 가진 6성만 직접 체크한다
  const [ownedIds, setOwnedIds] = useState<Set<string>>(() => new Set(ops.filter((op) => op.rarity <= 5).map((op) => op.id)));
  // 미지정 = 2정(정예화 2, 최대) 가정 — 정예화 2 스킬이 있는 오퍼만 1정으로 낮출 수 있다
  const [eliteById, setEliteById] = useState<Map<string, Elite>>(new Map());
  // 보유 오퍼·정예화 구성이나 방별 수동 편성을 바꾼 뒤 파일로 저장하지 않았으면 true
  const [dirty, setDirty] = useState(false);

  const effectiveOps = useMemo(() => visibleOps.map((op) => withElite(op, eliteById.get(op.id))), [visibleOps, eliteById]);
  const effectiveOpById = useMemo(() => new Map(effectiveOps.map((op) => [op.id, op])), [effectiveOps]);
  const roster = useMemo(() => effectiveOps.filter((op) => ownedIds.has(op.id)), [effectiveOps, ownedIds]);

  const persist = (ids: Set<string>, nextPlan: Plan | null, elite: Map<string, Elite> = eliteById, prio: ProdPriority = priority) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ owned: Array.from(ids), elite: Array.from(elite.entries()), plan: nextPlan, priority: prio })); } catch { /* ignore */ }
  };

  const exportImage = async () => {
    if (!plan) return;
    type Row = { cell: (typeof LAYOUT)[number]; crews: { label: string; team: InfraOp[]; score: number | null }[] };
    const controlTeamAt = (shift: number) => {
      const shifts = plan.assignments["CONTROL"] ?? [];
      return (shifts[Math.min(shift, shifts.length - 1)] ?? []).map((id) => effectiveOpById.get(id)).filter(Boolean) as InfraOp[];
    };
    const ambientAt = [0, 1].map((shift) => aurasOf(controlTeamAt(shift), ctxFor("CONTROL", shift === 0 ? plan.tokenPoints : {}, plan.factionCounts[shift] ?? {}, plan.plants, presentIdsFor(plan, shift))));
    const rows: Row[] = LAYOUT.map((cell) => {
      const shifts = plan.assignments[cell.key] ?? [];
      const scoreFor = (team: InfraOp[], shift: number) =>
        cell.room === "DORMITORY" || PARK_KEYS.includes(cell.key) ? null
          : Math.round(teamScore(team, cell.room, ctxFor(cell.key, shift === 0 ? plan.tokenPoints : {}, plan.factionCounts[shift] ?? {}, plan.plants, presentIdsFor(plan, shift), ambientAt[shift])));
      const teamAt = (shift: number) => (shifts[Math.min(shift, shifts.length - 1)] ?? []).map((id) => effectiveOpById.get(id)).filter(Boolean) as InfraOp[];
      const single = cell.room === "DORMITORY" || cell.key === "TRAINING";
      if (single) {
        const team = teamAt(0);
        return { cell, crews: [{ label: cell.room === "DORMITORY" ? t("고정") : "-", team, score: scoreFor(team, 0) }] };
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
    g.fillText(`${strategyLabel(plan, locale, t)} · ${Object.entries(plan.tokenPoints).map(([token, points]) => t("{token} {n}점", { token: tokenName(locale, token), n: Math.round(points) })).join(" · ")}`, 32, 126);
    let y = top;
    rows.forEach((row, index) => {
      const h = rowHeights[index];
      g.fillStyle = index % 2 ? "#eceae3" : "#fbfbf8"; g.fillRect(24, y, W - 48, h - 8);
      g.fillStyle = ROOM_ACCENT[row.cell.room] ?? "#888"; g.fillRect(24, y, 5, h - 8);
      g.fillStyle = "#131719"; g.font = "800 15px sans-serif";
      g.fillText(t(row.cell.label), 44, y + 26);
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
          g.fillText(row.cell.key === "TRAINING" ? t("비워둠 (특화 훈련용)") : t("휴식 공간"), 248, cy + 28);
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
    g.fillText(t("A = 풀파워 주간조 · B = 회복 교대조 · terra-archive infra planner"), 32, canvas.height - 28);
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
    showToast(t("현재 상태를 파일로 저장했습니다"));
  };

  const importState = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const ids = new Set<string>((data.owned as string[]).filter((id) => opById.has(id)));
        const elite = new Map<string, Elite>((data.elite as [string, Elite][] | undefined) ?? []);
        setOwnedIds(ids);
        setEliteById(elite);
        if (data.plan) { setPlan(data.plan as Plan); setActiveShift(0); }
        persist(ids, data.plan ?? null, elite);
        setDirty(false);
        showToast(t("저장된 상태를 불러왔습니다 · 보유 {n}명 복원", { n: ids.size }));
      } catch { alert(t("가져오기 실패: 파일 형식을 확인해 주세요.")); }
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
          if (op) for (const faction of factionsOf(op)) counts[faction] = (counts[faction] ?? 0) + 1;
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
  const setOperatorElite = (id: string, elite: Elite) => {
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

  const runOptimize = (ids: Set<string> = ownedIds, elite: Map<string, Elite> = eliteById, prio: ProdPriority = priority) => {
    const next = optimize(visibleOps.map((op) => withElite(op, elite.get(op.id))).filter((op) => ids.has(op.id)), prio);
    setPlan(next);
    setActiveShift(0);
    persist(ids, next, elite);
    showToast(t("전체 자동편성을 실행했습니다 · 보유 {n}명 기준", { n: ids.size }));
  };

  // 우선 생산 모드는 설정(라디오)일 뿐 — 실제 편성은 기존처럼 자동편성 버튼으로 실행한다
  // (사용자 확정 2026-07: 설정 변경이 편성을 갈아엎으면 안 됨)
  const setPriority = (prio: ProdPriority) => {
    if (prio === priority) return;
    setPriorityState(prio);
    persist(ownedIds, plan, eliteById, prio);
    showToast(t("우선 생산 설정을 저장했습니다 — 다음 자동편성부터 적용됩니다"));
  };

  // 현재 편성(수동 수정 포함)은 그대로 두고, 빈 슬롯만 한계 기여가 큰 미배치 오퍼로
  // 채운다 — 방 우선순위(순금→작전기록→무역→발전→사무실→응접실) 순서로 그리디
  const fillGaps = () => {
    if (!plan) return;
    const assignments: Record<string, string[][]> = Object.fromEntries(
      Object.entries(plan.assignments).map(([key, shifts]) => [key, shifts.map((team) => [...team])])
    );
    const usedAll = new Set<string>();
    for (const shifts of Object.values(assignments)) for (const team of shifts) for (const id of team) usedAll.add(id);
    let added = 0;
    for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
      const points = shift === 0 ? plan.tokenPoints : {};
      const counts: Record<string, number> = {};
      const present = new Set<string>(); // 이 조 기준 기지 내 배치 전원
      for (const shifts of Object.values(assignments)) {
        for (const id of shifts[Math.min(shift, shifts.length - 1)] ?? []) {
          present.add(id);
          const op = effectiveOpById.get(id);
          if (op) for (const faction of factionsOf(op)) counts[faction] = (counts[faction] ?? 0) + 1;
        }
      }
      for (const key of [...PRODUCTION_KEYS, ...SUPPORT_KEYS]) {
        if (key === "TRAINING" || PARK_KEYS.includes(key)) continue; // 훈련실 비움·가공소 고정 정책 유지
        const cell = cellByKey.get(key)!;
        const shifts = assignments[key] ?? (assignments[key] = [[]]);
        const index = Math.min(shift, shifts.length - 1);
        const slots = infra.rooms[cell.room]?.slots ?? 1;
        while (shifts[index].length < slots) {
          const controlIds = assignments["CONTROL"]?.[Math.min(shift, (assignments["CONTROL"]?.length ?? 1) - 1)] ?? [];
          const controlTeam = controlIds.map((id) => effectiveOpById.get(id)).filter(Boolean) as InfraOp[];
          const ambientNow = aurasOf(controlTeam, ctxFor("CONTROL", points, counts, plan.plants, present));
          const ctx = ctxFor(key, points, counts, plan.plants, present, ambientNow);
          const team = shifts[index].map((id) => effectiveOpById.get(id)).filter(Boolean) as InfraOp[];
          const current = teamScore(team, cell.room, ctx);
          let best: InfraOp | null = null;
          let bestDelta = 0;
          for (const op of roster) {
            if (usedAll.has(op.id)) continue;
            if (!op.skills.some((skill) => skillApplies(skill, cell.room, ctx.product))) continue;
            const delta = teamScore([...team, op], cell.room, ctx) - current;
            if (delta > bestDelta) { bestDelta = delta; best = op; }
          }
          if (!best) break;
          shifts[index].push(best.id);
          usedAll.add(best.id);
          present.add(best.id);
          for (const faction of factionsOf(best)) counts[faction] = (counts[faction] ?? 0) + 1;
          added += 1;
        }
      }
    }
    if (added === 0) { showToast(t("채울 수 있는 빈 자리가 없습니다")); return; }
    const factionCounts = [0, 1].map((shift) => {
      const counts: Record<string, number> = {};
      for (const cell of LAYOUT) {
        const cellShifts = assignments[cell.key] ?? [];
        for (const id of cellShifts[Math.min(shift, cellShifts.length - 1)] ?? []) {
          const op = effectiveOpById.get(id);
          if (op) for (const faction of factionsOf(op)) counts[faction] = (counts[faction] ?? 0) + 1;
        }
      }
      return counts;
    });
    const next = { ...plan, assignments, factionCounts };
    setPlan(next);
    persist(ownedIds, next);
    setDirty(true);
    showToast(t("빈 자리 {n}곳을 채웠습니다 · 기존 편성 유지", { n: added }));
  };

  // 편성 전체 비우기 — 모든 방을 빈 슬롯으로 되돌린다(수동 배치 시작점). 되돌릴 수 없어 확인을 받는다.
  const clearAll = async () => {
    if (!plan) return;
    const ok = await confirm({
      title: t("편성 전체 비우기"),
      message: t("현재 편성을 전부 비웁니다. 되돌릴 수 없어요 — 계속할까요?"),
      confirmLabel: t("비우기"),
      danger: true,
    });
    if (!ok) return;
    const assignments: Record<string, string[][]> = Object.fromEntries(
      Object.entries(plan.assignments).map(([key, shifts]) => [key, shifts.map(() => [])])
    );
    const next = { ...plan, assignments, tokenPoints: {}, factionCounts: plan.factionCounts.map(() => ({})) };
    setPlan(next);
    setActiveShift(0);
    persist(ownedIds, next);
    setDirty(true);
    showToast(t("편성을 전부 비웠습니다 — 방을 눌러 수동 배치하거나 자동편성하세요"));
  };

  // '그 외' 드롭다운: 바깥 클릭·Esc로 닫기
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".more-group")) setMoreOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onEsc); };
  }, [moreOpen]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        const ids = new Set<string>((data.owned as string[]).filter((id: string) => opById.has(id)));
        const elite = new Map<string, Elite>((data.elite as [string, Elite][] | undefined) ?? []);
        setOwnedIds(ids);
        setEliteById(elite);
        if (data.priority) setPriorityState(data.priority as ProdPriority);
        if (data.plan) { setPlan(data.plan as Plan); if (!data.priority && (data.plan as Plan).priority) setPriorityState((data.plan as Plan).priority!); return; }
        // 마운트 시점엔 미래시 토글이 아직 복원 전(false)일 수 있으므로 미실장은 제외하고
        // 기본 편성을 만든다 — 미래시 포함 편성은 토글 후 자동편성 버튼으로 실행
        setPlan(optimize(ops.filter((op) => !op.unreleased).map((op) => withElite(op, elite.get(op.id))).filter((op) => ids.has(op.id))));
        return;
      }
    } catch { /* fall through to defaults */ }
    setPlan(optimize(ops.filter((op) => op.rarity <= 5 && !op.unreleased)));
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

  // 제어센터 오라 — 대상 방(제조·무역·사무·응접) 점수와 서머리에 실제 합산된다
  const ambient = useMemo(() => {
    if (!plan) return undefined;
    const control = teamFor("CONTROL", activeShift);
    return aurasOf(control, ctxFor("CONTROL", pointsFor(activeShift), plan.factionCounts[activeShift], plan.plants, presentIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, activeShift, presentIds, eliteById]);

  const summary = useMemo(() => {
    if (!plan) return null;
    const avg = (prefix: string) => {
      const keys = LAYOUT.filter((cell) => cell.key.startsWith(prefix)).map((cell) => cell.key);
      const totals = keys.map((key) => teamScore(teamFor(key, activeShift), cellByKey.get(key)!.room, ctxFor(key, pointsFor(activeShift), plan.factionCounts[activeShift], plan.plants, presentIds, ambient)));
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
  }, [plan, activeShift, allAssigned, presentIds, ambient, eliteById]);

  const openCell = LAYOUT.find((cell) => cell.key === openRoom);

  return (
    <section className="planner">
      {confirmDialog}
      <div className="planner-controls">
        <div>
          <span className="section-no">{t("RIIC / 243 · 순금 2 + 작전기록 2 · 12시간 2조 교대")}</span>
          <h2>{t("인프라 배치 최적화")}</h2>
        </div>
        <div className="planner-buttons">
          <button onClick={() => setShowRoster(true)}><span className="btn-icon" aria-hidden>▦</span>{t("보유 오퍼 설정 ({a}/{b})", { a: visibleOps.filter((op) => ownedIds.has(op.id)).length, b: visibleOps.length })}</button>
          <button className="primary" onClick={() => runOptimize()}><span className="btn-icon" aria-hidden>⟳</span>{t("전체 자동편성")}</button>
          <button onClick={fillGaps} title={t("현재 편성(수동 수정 포함)은 그대로 두고, 남은 빈 자리만 효율 순으로 자동 편성합니다")}><span className="btn-icon" aria-hidden>⊕</span>{t("빈 자리만 자동편성")}</button>
          <button onClick={clearAll} title={t("모든 방의 편성을 비웁니다 (보유 오퍼 설정은 유지)")}><span className="btn-icon" aria-hidden>⌫</span>{t("편성 전체 비우기")}</button>
          {/* 이미지·파일·도움말은 '그 외' 드롭다운으로 묶는다 (사용자 요청 2026-07) */}
          <span className="more-group">
            <button className={`more-toggle${dirty ? " save-pending" : ""}`} aria-expanded={moreOpen} aria-haspopup="menu"
              onClick={() => setMoreOpen((open) => !open)}><span className="btn-icon" aria-hidden>⋯</span>{t("그 외")}</button>
            {moreOpen && (
              <div className="more-menu" role="menu">
                <button role="menuitem" onClick={() => { setMoreOpen(false); exportImage(); }} title={t("A조·B조 편성표를 이미지로 확인 (PNG)")}><span className="btn-icon" aria-hidden>⧉</span>{t("이미지로 보기")}</button>
                <button role="menuitem" className={dirty ? "save-pending" : undefined} onClick={() => { setMoreOpen(false); exportState(); }} title={dirty ? t("저장 후 변경 사항이 있습니다 — 파일로 저장하세요") : t("보유 오퍼와 편성을 JSON 파일로 저장")}><span className="btn-icon" aria-hidden>⤓</span>{t("현재 상태 파일로 저장")}</button>
                <label className="import-label" role="menuitem">
                  <span className="btn-icon" aria-hidden>⤒</span>{t("저장된 상태 파일 가져오기")}
                  <input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) importState(file); event.target.value = ""; setMoreOpen(false); }} />
                </label>
                <button role="menuitem" onClick={() => { setMoreOpen(false); setShowHelp(true); }}><span className="btn-icon" aria-hidden>?</span>{t("도움말")}</button>
              </div>
            )}
          </span>
        </div>
      </div>

      {/* 우선 생산 설정 (라디오) — 다음 자동편성부터 적용, 편성 실행은 버튼으로 */}
      <div className="prio-setting" role="radiogroup" aria-label={t("우선 생산")}
        title={t("먼저 채우는 방이 최고 요원을 가져갑니다 — 다음 자동편성부터 적용됩니다")}>
        <span className="prio-label">⚙ {t("우선 생산")}</span>
        {(["gold", "exp", "balance"] as const).map((mode) => (
          <label key={mode} className={priority === mode ? "on" : ""}>
            <input type="radio" name="prod-priority" checked={priority === mode} onChange={() => setPriority(mode)} />
            {t(mode === "gold" ? "순금 우선" : mode === "exp" ? "작전기록 우선" : "밸런스")}
          </label>
        ))}
      </div>

      {summary && (
        <div className="planner-summary">
          <button type="button" className="strategy-cell" onClick={() => setShowFlows(true)}>
            <span>{t("전략 (클릭해 시너지 트리 보기)")}</span>
            <b className="strategy">{plan ? strategyLabel(plan, locale, t) : summary.strategy}{plan && Object.keys(plan.tokenPoints).length > 0 && ` · ${Object.entries(plan.tokenPoints).map(([token, points]) => t("{token} {n}점", { token: tokenName(locale, token), n: Math.round(points) })).join(" · ")}`}</b>
          </button>
          <div><span>{t("제조소 평균")}</span><b>+{summary.manufacture}%</b></div>
          <div><span>{t("무역소 평균")}</span><b>+{summary.trading}%</b></div>
          <div><span>{t("발전소 평균")}</span><b>+{summary.power}%</b></div>
          <div><span>{t("기용 인원")}</span><b>{t("{n}명", { n: summary.staffed })}</b></div>
        </div>
      )}

      {plan && (
        <div className="shift-tabs">
          {Array.from({ length: SHIFT_COUNT }, (_, i) => (
            <button key={i} className={activeShift === i ? "selected" : ""} onClick={() => setActiveShift(i)}>{[t("A조 (풀파워)"), t("B조 (회복 교대)")][i]}</button>
          ))}
          <span className="shift-hint">{t("A조 컨디션 소진 시 B조 투입 · 시너지 세트는 A조 집중 · 숙소·고정 요원은 조 전환과 무관 · ")}<b>{t("숙소는 항상 5명 꽉 채워 유지")}</b></span>
        </div>
      )}

      <div className="ship">
        {LAYOUT.map((cell) => {
          if (cell.room === "DORMITORY") {
            const pinned = teamFor(cell.key, 0);
            return (
              <div key={cell.key} className={`ship-room dorm-room pos-${cell.key.toLowerCase()}`} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
                <div className="ship-room-head"><b>{t(cell.label)}</b><span>{t("고정")}</span></div>
                <div className="ship-room-crew">
                  {pinned.map((op) => <img key={op.id} src={op.image} alt={op.name} title={t("{name} 상세 정보", { name: op.name })} loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={() => onShowOperator?.(op.id)} />)}
                  <i>{pinned.length ? t("시너지 고정 + 휴식 공간") : t("휴식 공간 · 조 전환과 무관")}</i>
                </div>
              </div>
            );
          }
          const team = teamFor(cell.key, activeShift);
          const spec = infra.rooms[cell.room];
          const score = Math.round(teamScore(team, cell.room, ctxFor(cell.key, pointsFor(activeShift), plan?.factionCounts?.[activeShift], plan?.plants, presentIds, ambient)));
          return (
            <button key={cell.key} type="button" className={`ship-room pos-${cell.key.toLowerCase()}`} onClick={() => setOpenRoom(cell.key)} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
              <div className="ship-room-head">
                <b>{t(cell.label)}</b>
                <span>{team.length}/{spec?.slots ?? 1}</span>
              </div>
              <div className="ship-room-crew">
                {team.length ? team.map((op) => (
                  <img key={op.id} src={op.image} alt={op.name} title={op.name} loading="lazy" />
                )) : <i>{cell.key === "TRAINING" ? t("비워둠 · 특화 훈련 시 사용") : plan ? t("비어 있음") : t("자동 편성 대기")}</i>}
              </div>
              {plan && team.length > 0 && !PARK_KEYS.includes(cell.key) && (
                <small>+{score}{cell.room === "CONTROL" ? "" : "%"} {t(UNIT[cell.room])}</small>
              )}
              {plan && PARK_KEYS.includes(cell.key) && team.length > 0 && <small>{t("세트 요원 고정 · 효율 무관")}</small>}
            </button>
          );
        })}
      </div>

      <aside className="data-note"><span>PLANNER NOTE</span><p>{t("오퍼레이터의 모든 인프라 스킬을 동시에 적용하고(α/β는 상위 티어만), 시설 간 포인트 시스템(속세의 화식·무성의 공명 등)을 겹쳐 쌓을 수 있을 때까지 패키지로 조합합니다. 고품질 귀금속 오더 확률(샤마르·카프카·디아만테·바이비크)과 오더당 수익(테킬라·프로바이조)의 상호작용, 샤마르의 효율 대체를 반영합니다. 조건부·누적 버프는 추정 상한 기준 근사치입니다.")}</p></aside>

      {showRoster && (
        <RosterModal
          allOps={visibleOps}
          ownedIds={ownedIds}
          eliteById={eliteById}
          onApply={(ids, elite) => { setOwnedIds(ids); setEliteById(elite); setShowRoster(false); runOptimize(ids, elite); setDirty(true); }}
          onClose={() => setShowRoster(false)}
          onShowOperator={onShowOperator}
        />
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {imageUrl && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeImage(); }}>
          <section className="operator-modal room-modal image-preview" style={{ "--accent": "#dfff00" } as React.CSSProperties}>
            <button type="button" className="modal-close" onClick={closeImage} aria-label={t("닫기")}>×</button>
            <header className="room-modal-head">
              <span className="modal-kicker">PLAN SHEET</span>
              <h2>{t("편성표 이미지")}</h2>
              <div className="roster-tools">
                <a className="apply save-image" href={imageUrl} download="terra-archive-infra.png">{t("PNG 저장")}</a>
              </div>
            </header>
            <div className="modal-scroll"><img src={imageUrl} alt={t("인프라 편성표")} /></div>
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
          eliteById={eliteById}
          onSetElite={setOperatorElite}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}

function RoomModal({ cell, plan, allAssigned, roster, opMap, initialShift, onClose, onShowOperator, onUpdateTeam, eliteById, onSetElite }: { cell: { key: string; room: string; label: string; product?: string }; plan: Plan; allAssigned: Set<string>; roster: InfraOp[]; opMap: Map<string, InfraOp>; initialShift: number; onClose: () => void; onShowOperator?: (id: string) => void; onUpdateTeam?: (cellKey: string, shiftIdx: number, ids: string[]) => void; eliteById: Map<string, Elite>; onSetElite: (id: string, elite: Elite) => void }) {
  const { locale, t } = useI18n();
  const [shift, setShift] = useState(initialShift);
  const shiftIndex = Math.min(shift, (plan.assignments[cell.key]?.length ?? 1) - 1);
  const rawIds = plan.assignments[cell.key]?.[shiftIndex] ?? [];
  const team = rawIds.map((id) => opMap.get(id)).filter(Boolean) as InfraOp[];
  const teamIds = new Set(team.map((op) => op.id));
  const points = shiftIndex === 0 ? plan.tokenPoints : {};
  // 제어센터 오라를 이 방 점수에도 합산 (제어센터 자신을 볼 때는 미적용)
  const controlShifts = plan.assignments["CONTROL"] ?? [];
  const controlTeam = (controlShifts[Math.min(shiftIndex, controlShifts.length - 1)] ?? []).map((id) => opMap.get(id)).filter(Boolean) as InfraOp[];
  const ambient = cell.key === "CONTROL" ? undefined
    : aurasOf(controlTeam, ctxFor("CONTROL", points, plan.factionCounts[shiftIndex] ?? {}, plan.plants, presentIdsFor(plan, shiftIndex)));
  const ctx = ctxFor(cell.key, points, plan.factionCounts[shiftIndex] ?? {}, plan.plants, presentIdsFor(plan, shiftIndex), ambient);
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
  agg["제어센터 오라 수신"] = ambientFor(cell.room, team, ambient, agg["스킬 효율"]);
  // 추가 후보: 어디에도 배치 안 된 보유 오퍼를 한계 기여 순으로
  const [benchAll, setBenchAll] = useState(false);
  const [benchQuery, setBenchQuery] = useState("");
  const benchFull = team.length < slots && onUpdateTeam
    ? roster
        .filter((op) => !allAssigned.has(op.id))
        .map((op) => ({ op, delta: Math.round(teamScore([...team, op], cell.room, ctx)) - currentScore }))
        .sort((a, b) => b.delta - a.delta || b.op.rarity - a.op.rarity)
    : [];
  const benchKeyword = normSearch(benchQuery);
  const benchFiltered = benchKeyword
    ? benchFull.filter(({ op }) => normSearch(op.name).includes(benchKeyword) || normSearch(op.faction).includes(benchKeyword))
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
    counterMatches.some((match) => factionsOf(op).some((faction) => faction.includes(match)));

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        <header className="room-modal-head">
          <span className="modal-kicker">FACILITY FILE · {cell.room}</span>
          <h2>{t(cell.label)}</h2>
          <div className="shift-tabs in-modal">
            {Array.from({ length: SHIFT_COUNT }, (_, i) => (
              <button key={i} className={shift === i ? "selected" : ""} onClick={() => setShift(i)}>{[t("A조"), t("B조")][i]}</button>
            ))}
          </div>
        </header>
        <div className="modal-scroll">
          {scored && (
            <section className="detail-section room-summary">
              <span className="detail-no">RESULT / 00</span>
              <h3>{t("종합 효율")}{cell.product ? ` · ${cell.product}` : ""} <b className="summary-total">+{currentScore}{cell.room === "CONTROL" ? "" : "%"}</b></h3>
              <div className="summary-parts">
                {Object.entries(agg).filter(([, value]) => Math.round(value) !== 0).map(([name, value]) => (
                  <span key={name}>{t(name)} <b>+{Math.round(value)}</b></span>
                ))}
                {team.length === 0 && <span>{t("편성 없음")}</span>}
              </div>
              <p className="summary-note">{t("아래에서 오퍼를 빼거나(✕) 대체 오퍼·추가 후보를 클릭하면 즉시 다시 계산됩니다. 단, 토큰 포인트(속세의 화식 등)와 패키지 구성은 마지막 자동편성 기준이므로, 토큰 생성원을 바꿨다면 자동편성 실행으로 재계산하세요.")}</p>
            </section>
          )}
          <section className="detail-section">
            <span className="detail-no">CREW / 01</span>
            <h3>{t("편성 ({a}/{b})", { a: team.length, b: slots })}</h3>
            {cell.room === "DORMITORY" && (
              <p className="dorm-note">{rich(t("숙소는 **항상 5명을 꽉 채운 상태로 유지**하세요. 고정 생성원 외의 빈 자리는 휴식이 필요한 아무 오퍼레이터로 채우면 됩니다 — 토큰 생성과 회복 효율은 풀 인원 기준으로 계산됩니다."))}</p>
            )}
            <div className="crew-list">
              {team.map((op) => {
                const b = breakdown(op, cell.room, team, ctx);
                // 기여를 성분별로 풀어서 표시 — 특히 제어센터 오라는 내부 가중치 점수가
                // 아니라 실제 효과("무역소 오더 효율 오라 +10%")로 보여준다
                const pct = cell.room === "CONTROL" ? "" : "%";
                const parts: string[] = [];
                if (Math.round(b.efficiency) !== 0) parts.push(`${t(UNIT[cell.room] ?? "효율")} +${Math.round(b.efficiency)}${pct}`);
                if (Math.round(b.facilityEff) !== 0) parts.push(t("시설 기반 +{n}%", { n: Math.round(b.facilityEff) }));
                if (Math.round(b.automation) !== 0) parts.push(t("자동화 +{n}%", { n: Math.round(b.automation) }));
                if (Math.round(b.quality) !== 0) parts.push(t("고품질 확률 +{n}%p 상당", { n: Math.round(b.quality) }));
                if (Math.round(b.payout + b.payoutViolation) !== 0) parts.push(t("오더 수익 +{n}% 상당", { n: Math.round(b.payout + b.payoutViolation) }));
                if (b.override > 0) parts.push(t("효율 대체 인당 +{n}%", { n: Math.round(b.override) }));
                if (Math.round(b.perCoworker * (team.length - 1)) !== 0) parts.push(t("동료 보너스 +{n}%", { n: Math.round(b.perCoworker * (team.length - 1)) }));
                for (const [kind, value] of Object.entries(b.auras)) if (value > 0) parts.push(`${t(AURA_LABEL[kind] ?? kind)} +${Math.round(value)}%`);
                const shown = b.skills.length ? b.skills : op.skills.filter((skill) => skill.room === cell.room);
                return (
                  <article key={op.id} className="crew-card">
                    {onUpdateTeam && <button type="button" className="crew-remove" title={t("이 자리에서 빼기")} onClick={() => setIds(rawIds.filter((id) => id !== op.id))}>✕</button>}
                    <img src={op.image} alt={op.name} loading="lazy" className={onShowOperator ? "op-link" : undefined}
                      title={t("{name} 상세 정보", { name: op.name })} onClick={() => onShowOperator?.(op.id)} />
                    <div>
                      <b>
                        {op.name} <i>{"★".repeat(op.rarity)}</i>
                        {(() => {
                          // 정예화 판정은 스킬이 필터링되지 않은 원본(opById) 기준
                          const master = opById.get(op.id);
                          const options = master ? eliteOptions(master) : [];
                          if (!options.length) return null;
                          const current = Math.min(eliteById.get(op.id) ?? 2, options[options.length - 1]) as Elite;
                          return (
                            <span className="elite-pill" role="group" aria-label={t("{name} 정예화 단계", { name: op.name })}>
                              {options.map((option) => (
                                <button key={option} type="button" className={current === option ? "selected" : ""} onClick={() => onSetElite(op.id, option)}>{t(ELITE_LABEL[option])}</button>
                              ))}
                            </span>
                          );
                        })()}
                      </b>
                      {shown.length ? shown.map((skill) => <p key={skill.name}><em>{skill.name}</em> — {skill.description}</p>) : <p>{t("이 시설에 적용되는 스킬이 없습니다 (세트 대기 요원).")}</p>}
                      {parts.map((part) => <small key={part}>{part}</small>)}
                      {op.skills.flatMap((skill) => skill.tokenGen).map((gen) => (
                        <small key={`${op.id}-${gen.token}`} className="token-chip">{t("{token} +{n}점 생성", { token: tokenName(locale, gen.token), n: Math.round(gen.estimate) })}</small>
                      ))}
                      {isCore(op) ? (
                        <div className="slot-subs"><small className="core-chip">{t("대체 불가 · 시너지 코어")}</small></div>
                      ) : (
                        <div className="slot-subs">
                          <span>{t("이 자리 대체 오퍼:")}</span>
                          {slotSubstitutes(team, team.indexOf(op), cell.key, ctx, excluded, roster).map(({ op: sub, score }) => (
                            <small key={sub.id} className={`sub-chip${onUpdateTeam ? " swappable" : ""}`}
                              title={`${t("클릭하면 {name} 자리에 교체", { name: op.name })}\n${sub.skills.filter((skill) => skill.room === cell.room).map((skill) => `${skill.name}: ${skill.description}`).join("\n")}`}
                              onClick={() => onUpdateTeam && setIds(rawIds.map((id) => (id === op.id ? sub.id : id)))}>
                              <img src={sub.image} alt="" loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={(event) => { event.stopPropagation(); onShowOperator?.(sub.id); }} />{sub.name} <em>{score >= currentScore ? t("동급") : `-${currentScore - score}`}</em>
                            </small>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
              {team.length === 0 && !benchFull.length && <p className="no-detail">{t("자동 편성을 먼저 실행해 주세요.")}</p>}
            </div>
            {benchFull.length > 0 && (
              <div className="bench">
                <span>{t("빈 자리에 추가 — 클릭 시 즉시 배치 (기여 예상):")}</span>
                <input className="bench-search" value={benchQuery} onChange={(event) => setBenchQuery(event.target.value)} placeholder={t("이름·소속으로 후보 검색")} />
                {bench.length > 0 ? (
                  <div className="bench-chips">
                    {bench.map(({ op, delta }) => (
                      <small key={op.id} className="sub-chip swappable" title={t("{name} 추가", { name: op.name })} onClick={() => setIds([...rawIds, op.id])}>
                        <img src={op.image} alt="" loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={(event) => { event.stopPropagation(); onShowOperator?.(op.id); }} />{op.name} <em>{delta >= 0 ? `+${delta}` : delta}</em>
                      </small>
                    ))}
                  </div>
                ) : (
                  <p className="no-detail">{t("검색 결과가 없습니다.")}</p>
                )}
                {benchFiltered.length > 12 && (
                  <button type="button" className="more-filter" onClick={() => setBenchAll((current) => !current)}>
                    {benchAll ? t("접기") : t("더 많이 보기 (전체 {n}명)", { n: benchFiltered.length })}
                  </button>
                )}
              </div>
            )}
          </section>

        </div>
      </section>
    </div>
  );
}

function FlowModal({ plan, opMap, onClose, onShowOperator }: { plan: Plan; opMap: Map<string, InfraOp>; onClose: () => void; onShowOperator?: (id: string) => void }) {
  const { locale, t } = useI18n();
  const flows = plan.flows.filter((flow) => flow.generators.length > 0 || flow.consumers.length > 0);
  const avatar = (op: InfraOp | undefined) => op ? (
    <img src={op.image} alt="" loading="lazy" className={onShowOperator ? "op-link" : undefined}
      title={onShowOperator ? t("{name} 상세 정보", { name: op.name }) : undefined} onClick={() => onShowOperator?.(op.id)} />
  ) : null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": "#dfff00" } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        <header className="room-modal-head">
          <span className="modal-kicker">SYNERGY LEDGER · {t("A조 기준")}</span>
          <h2>{t("시너지 트리")}</h2>
        </header>
        <div className="modal-scroll">
          {flows.length === 0 && <p className="no-detail">{t("활성화된 포인트 시너지가 없습니다.")}</p>}
          {flows.map((flow) => (
            <section key={flow.token} className="detail-section flow-tree">
              <h3>{tokenName(locale, flow.token)} <span className="flow-total">{t("총 {n}점", { n: Math.round(flow.total) })}</span></h3>
              <ul>
                <li className="flow-branch">{t("생성")}
                  <ul>
                    {flow.generators.map((gen, index) => {
                      const op = opMap.get(gen.opId);
                      return (
                        <li key={`${gen.opId}-${index}`}>
                          {avatar(op)}
                          <b>{op?.name ?? gen.opId}</b> <i>{t(gen.at)}</i>
                          <em>{t("+{n}점", { n: Math.round(gen.amount) })}{gen.via ? t(" ({token} 전환)", { token: tokenName(locale, gen.via) }) : ""}</em>
                        </li>
                      );
                    })}
                    {flow.generators.length === 0 && <li><em>{t("생성원이 배치되지 않음")}</em></li>}
                  </ul>
                </li>
                {flow.converters.length > 0 && (
                  <li className="flow-branch">{t("전환")}
                    <ul>
                      {flow.converters.map((conv) => {
                        const op = opMap.get(conv.opId);
                        return <li key={conv.opId}>{avatar(op)}<b>{op?.name}</b> <em>{tokenName(locale, conv.from)} → {tokenName(locale, flow.token)}</em></li>;
                      })}
                    </ul>
                  </li>
                )}
                <li className="flow-branch">{t("소비")}
                  <ul>
                    {flow.consumers.map((consumer, index) => {
                      const op = opMap.get(consumer.opId);
                      return (
                        <li key={`${consumer.opId}-${index}`}>
                          {avatar(op)}
                          <b>{op?.name ?? consumer.opId}</b> <i>{t(consumer.at)}</i>
                          <em>{consumer.percent
                            ? t("{token} {n}점 소비 → {unit} +{m}% (1점당 +{r}%)", { token: tokenName(locale, flow.token), n: Math.round(flow.total), unit: t(UNIT[consumer.room] ?? "효율"), m: Math.round(consumer.gain), r: consumer.rate })
                            : t("{token} 기반 컨디션 회복·소모 보정", { token: tokenName(locale, flow.token) })}</em>
                        </li>
                      );
                    })}
                    {flow.consumers.length === 0 && <li><em>{t("소비자가 배치되지 않음")}</em></li>}
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

function RosterModal({ allOps, ownedIds, eliteById, onApply, onClose, onShowOperator }: { allOps: InfraOp[]; ownedIds: Set<string>; eliteById: Map<string, Elite>; onApply: (ids: Set<string>, elite: Map<string, Elite>) => void; onClose: () => void; onShowOperator?: (id: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Set<string>>(new Set(ownedIds));
  const [eliteDraft, setEliteDraft] = useState<Map<string, Elite>>(new Map(eliteById));
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("기본");
  const [sortAsc, setSortAsc] = useState(true);
  const keyword = query.trim().toLowerCase();
  // 백과사전과 동일한 정렬 (직군·세부 직군·출신지·종족 포함). 기본 = 6성↓ → KR 출시 최신순
  const filteredOps = allOps.filter((op) => !keyword || op.name.toLowerCase().includes(keyword) || op.faction.toLowerCase().includes(keyword));
  const sortOps = (list: InfraOp[]): InfraOp[] => {
    if (sortKey === "기본") {
      const base = [...list].sort((a, b) => b.rarity - a.rarity || b.seq - a.seq);
      return sortAsc ? base : base.reverse();
    }
    const valueOf = (op: InfraOp): string | number =>
      sortKey === "이름" ? op.name : sortKey === "성급" ? op.rarity : sortKey === "발매순" ? op.seq
      : sortKey === "출신지" ? op.birthplace : sortKey === "종족" ? op.race
      : sortKey === "직군" ? JOB_ORDER.indexOf(op.jobCode) : sortKey === "세부 직군" ? op.subProfession
      : op.faction;
    const direction = sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      const left = valueOf(a), right = valueOf(b);
      const compared = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "ko");
      return compared !== 0 ? compared * direction : a.name.localeCompare(b.name, "ko");
    });
  };
  // 미실장(중국 선행) 오퍼는 위쪽에 따로 빼서 보여준다 (사용자 요청) — 각 그룹 내부는 선택 정렬
  const futureOps = sortOps(filteredOps.filter((op) => op.unreleased));
  const releasedOps = sortOps(filteredOps.filter((op) => !op.unreleased));
  const visible = [...futureOps, ...releasedOps];
  const toggle = (id: string) => setDraft((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const setElite = (id: string, elite: Elite) => setEliteDraft((current) => {
    const next = new Map(current);
    if (elite === 2) next.delete(id); else next.set(id, elite); // 2정이 기본값이라 별도 저장 불필요
    return next;
  });
  const renderCard = (op: InfraOp) => {
    const owned = draft.has(op.id);
    const options = eliteOptions(op);
    const elite = Math.min(eliteDraft.get(op.id) ?? 2, options.length ? options[options.length - 1] : 2) as Elite;
    return (
      <div key={op.id} className={`roster-card${owned ? " owned" : ""}${op.unreleased ? " future" : ""}`}>
        <button type="button" onClick={() => toggle(op.id)} title={op.name}>
          <img src={op.image} alt={op.name} loading="lazy" className={onShowOperator ? "op-link" : undefined}
            onClick={(event) => { if (onShowOperator) { event.stopPropagation(); onShowOperator(op.id); } }} />
          <span>{op.name}{op.unreleased && <em className="future-badge">{t("미실장")}</em>}</span>
        </button>
        {owned && options.length > 0 && (
          <div className="elite-toggle" role="group" aria-label={t("{name} 정예화 단계", { name: op.name })}>
            {options.map((option) => (
              <button key={option} type="button" className={elite === option ? "selected" : ""} onClick={() => setElite(op.id, option)}>{t(ELITE_LABEL[option])}</button>
            ))}
          </div>
        )}
      </div>
    );
  };
  // 성급 단위 일괄 조작 — 보유 체크/해제, 정예화 노정예/1정/2정
  // (정예화는 정예화 해금 스킬이 있는 오퍼에만 적용, 3성 이하는 2정이 없어 보유/해제만)
  const bulkOwn = (test: (rarity: number) => boolean, own: boolean) => setDraft((current) => {
    const next = new Set(current);
    for (const op of allOps) if (test(op.rarity)) { if (own) next.add(op.id); else next.delete(op.id); }
    return next;
  });
  const bulkElite = (test: (rarity: number) => boolean, elite: Elite) => setEliteDraft((current) => {
    const next = new Map(current);
    for (const op of allOps) {
      if (!test(op.rarity) || eliteOptions(op).length === 0) continue;
      if (elite === 2) next.delete(op.id); else next.set(op.id, elite);
    }
    return next;
  });
  // MAA(MaaAssistantArknights) 오퍼 박스 인식 결과 가져오기.
  // 지원 형식: ① Arknights_OperBox_Export.json — [{id, own, elite, ...}] 플랫 배열
  //           ② MAA 원본 operbox — {own_opers:[...], all_opers:[...]}
  // 파일이 언급한 오퍼만 갱신한다 (MAA가 모르는 최신 오퍼는 현재 체크 상태 유지).
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importMaa = (file: File) => {
    const reader = new FileReader();
    const fail = () => setImportMsg(t("MAA 파일을 인식하지 못했습니다 — 오퍼 박스 인식 결과 JSON(Arknights_OperBox_Export.json 등)인지 확인해 주세요."));
    reader.onload = () => {
      try {
        // MAA 내보내기 파일은 UTF-8 BOM이 붙어 있어 그대로 JSON.parse하면 실패한다
        const text = String(reader.result).replace(/^\uFEFF/, "");
        const parsed = JSON.parse(text);
        type MaaOper = { id?: string; own?: boolean; elite?: number };
        const entries: MaaOper[] = Array.isArray(parsed)
          ? parsed
          : [...((parsed?.all_opers as MaaOper[]) ?? []), ...((parsed?.own_opers as MaaOper[]) ?? [])];
        const byId = new Map(allOps.map((op) => [op.id, op]));
        const nextDraft = new Set(draft);
        const nextElite = new Map(eliteDraft);
        const seen = new Set<string>();
        let owned = 0, eliteSet = 0, unmatched = 0;
        for (const entry of entries) {
          if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) continue;
          seen.add(entry.id);
          const op = byId.get(entry.id);
          const isOwned = entry.own !== false; // own_opers 항목은 own 필드 없이도 보유로 취급
          if (!op) { if (isOwned) unmatched += 1; continue; }
          if (isOwned) { nextDraft.add(op.id); owned += 1; } else nextDraft.delete(op.id);
          const elite = (typeof entry.elite === "number" ? Math.max(0, Math.min(2, entry.elite)) : 2) as Elite;
          if (isOwned && elite < 2 && eliteOptions(op).length > 0) { nextElite.set(op.id, elite); eliteSet += 1; }
          else nextElite.delete(op.id);
        }
        if (seen.size === 0) { fail(); return; }
        setDraft(nextDraft);
        setEliteDraft(nextElite);
        setImportMsg(t("MAA 보유 데이터를 반영했습니다 — 보유 {own}명 · 정예화 반영 {elite}건 · 미수록 오퍼 {skip}건. 확인 후 '적용 및 자동편성 실행'을 누르세요.", { own: owned, elite: eliteSet, skip: unmatched }));
      } catch { fail(); }
    };
    reader.readAsText(file);
  };
  // 성급별 가능한 정예화 단계: 4성+ = 노정예/1정/2정, 3성 = 노정예/1정, 2성 이하 = 노정예뿐(선택지 없음)
  const BULK_GROUPS: { label: string; test: (rarity: number) => boolean; elites: Elite[] }[] = [
    { label: "6성", test: (rarity) => rarity === 6, elites: [0, 1, 2] },
    { label: "5성", test: (rarity) => rarity === 5, elites: [0, 1, 2] },
    { label: "4성", test: (rarity) => rarity === 4, elites: [0, 1, 2] },
    { label: "3성", test: (rarity) => rarity === 3, elites: [0, 1] },
    { label: "2성 이하", test: (rarity) => rarity <= 2, elites: [] },
  ];
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": "#dfff00" } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        <header className="room-modal-head">
          <span className="modal-kicker">ROSTER · {t("{n}/{m} 보유", { n: draft.size, m: allOps.length })}</span>
          <h2>{t("보유 오퍼레이터 설정")}</h2>
          <div className="roster-tools">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("이름·소속 검색")} />
            <button type="button" onClick={() => setDraft(new Set(allOps.map((op) => op.id)))}><span className="btn-icon" aria-hidden>✓</span>{t("전체 선택")}</button>
            <button type="button" onClick={() => setDraft(new Set())}><span className="btn-icon" aria-hidden>✕</span>{t("전체 해제")}</button>
            <label className="maa-import" title={t("MAA(MaaAssistantArknights)의 오퍼 박스 인식 결과 JSON을 불러와 보유·정예화를 한 번에 설정합니다")}>
              <span className="btn-icon" aria-hidden>⤒</span>{t("MAA 파일 가져오기")}
              <input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) importMaa(file); event.target.value = ""; }} />
            </label>
            <button type="button" className="apply" onClick={() => onApply(draft, eliteDraft)}><span className="btn-icon" aria-hidden>⟳</span>{t("적용 및 자동편성 실행")}</button>
          </div>
        </header>
        <div className="modal-scroll">
          {importMsg && <p className="dorm-note maa-import-msg">{importMsg}</p>}
          <p className="dorm-note">{rich(t("정예화 단계에 따라 해금되는 인프라 스킬을 가진 오퍼는 카드 아래에서 **노정예/1정/2정**을 선택할 수 있습니다 (기본값 최대 정예화). 얼굴을 클릭하면 상세 정보가 열립니다."))}</p>
          {allOps.some((op) => op.unreleased) && (
            <p className="dorm-note">{rich(t("**미실장** 배지가 붙은 오퍼는 한국 서버 미출시(중국 서버 선행) 오퍼입니다 — 미래시 데이터 포함이 켜져 있을 때만 표시되며, 스킬 텍스트는 비공식 AI 번역입니다."))}</p>
          )}
          <div className="roster-bulk">
            {BULK_GROUPS.map(({ label, test, elites }) => (
              <span key={label} className="bulk-group">
                <b>{t(label)}</b>
                <button type="button" onClick={() => bulkOwn(test, true)}>{t("전체 보유")}</button>
                <button type="button" onClick={() => bulkOwn(test, false)}>{t("전체 해제")}</button>
                {elites.map((option) => (
                  <button key={option} type="button" onClick={() => bulkElite(test, option)}>{t("일괄 {label}", { label: t(ELITE_LABEL[option]) })}</button>
                ))}
              </span>
            ))}
          </div>
          <div className="roster-sortbar">
            <label className="sort-wrap">
              <span>{t("정렬")}</span>
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
                {ROSTER_SORT_KEYS.map((key) => <option key={key} value={key}>{t(key)}</option>)}
              </select>
              <button type="button" className="sort-direction" onClick={() => setSortAsc((current) => !current)} aria-label={sortAsc ? t("내림차순으로 변경") : t("오름차순으로 변경")}>{sortAsc ? "↑" : "↓"}</button>
            </label>
            <span className="count"><b>{visible.length}</b> OPERATORS</span>
          </div>
          {futureOps.length > 0 && (
            <>
              <h4 className="roster-section-head">{t("미실장 (중국 서버 선행)")} <em>{futureOps.length}</em></h4>
              <div className="roster-grid">{futureOps.map(renderCard)}</div>
              <h4 className="roster-section-head">{t("한국 서버 출시")} <em>{releasedOps.length}</em></h4>
            </>
          )}
          <div className="roster-grid">{releasedOps.map(renderCard)}</div>
        </div>
      </section>
    </div>
  );
}

const HELP_SECTIONS: { title: string; items: string[] }[] = [
  { title: "교대 정책", items: [
    "A조가 풀파워 주력이고 모든 시너지 세트는 A조에 모입니다. B조는 A조 컨디션이 소진됐을 때 투입되는 회복 교대입니다 (12시간 2조).",
    "A조를 먼저 전수검사 3회로 풀파워로 완성한 뒤, 남은 오퍼레이터만으로 B조를 다시 3회 검수해 편성합니다.",
    "같은 오퍼를 A조·B조에 동시 배치하지 않는 것이 기본 원칙입니다 — 근무를 이중으로 서면 못 쉬고 24시간 돌아야 하기 때문입니다. 사기를 소모하지 않는 숙소(휴식)·가공소(상시 슬롯)만 예외로 조 전환과 무관하게 고정됩니다.",
    "숙소·시너지 고정 요원(숙소 생성원, 니엔 등)은 A/B 전환과 무관하게 고정됩니다. 응접실도 A/B 교대로 운영합니다 — 같은 인원을 24시간 돌리지 않습니다.",
    "훈련실은 실제 스킬 특화 훈련에 쓰도록 비워 둡니다.",
    "'전체 자동편성'은 처음부터 다시 계산하고, '빈 자리만 자동편성'은 현재 편성(수동 수정 포함)을 유지한 채 남은 빈 자리만 한계 기여 순으로 채웁니다.",
  ]},
  { title: "방 우선순위", items: [
    "우선 생산 설정: 순금 우선(기본) · 작전기록 우선 · 밸런스(교차). 먼저 채우는 방이 최고 요원을 가져갑니다. 설정만 바꾸고, 실제 편성은 전체 자동편성 버튼을 눌러 적용합니다.",
    "채우는 순서: 제조소-순금 > 제조소-작전기록 > 무역소 > 발전소 > 사무실 > 응접실 — 먼저 채우는 방이 좋은 요원을 가져갑니다. 응접실은 최하위라, 응접실 스킬이 있는 오퍼(쉐라 등)도 상위 방 세트가 우선입니다.",
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
    "제어센터 오라는 대상 방 점수에 실제로 합산됩니다 — 무역소 오더 효율 +10% 오라면 무역소 점수와 상단 서머리에 더해집니다 (방 상세의 '제어센터 오라 수신'). 단 이격 실버애쉬처럼 조건이 붙은 오라는 조건을 채운 그 방 하나에만 적용됩니다.",
    "'용문근위국 오퍼와 함께'류 동반 조건, '미노스 1명당'류 카운트 조건은 실제 배치를 기준으로만 인정합니다.",
    "이격 실버애쉬 보유 시 쉐라그 3명(무역 스킬 강한 순)을 무역소 한 곳에 모으는 세트안을 만들되, 세트 없는 편성과 기지 총점을 비교해 이득일 때만 채택합니다. 진영 판정은 다중 소속 기준(카란 무역회사 오퍼도 쉐라그로 인정).",
    "만트라 정예 소대는 실존 정예 오퍼 수 기준으로 계산합니다 (현재 6명 → +37%, 신규 정예 오퍼 추가 시 데이터 갱신에서 자동 반영).",
  ]},
  { title: "정예화 단계 (1정/2정)", items: [
    "보유 오퍼 설정에서 오퍼별로 기본값(2정 · 정예화 2)을 1정으로 낮출 수 있습니다. 정예화 2에서 해금되는 인프라 스킬을 가진 오퍼만 선택지가 보입니다.",
    "1정으로 지정하면 해당 오퍼는 정예화 2 전용 스킬 없이 계산·자동편성됩니다 — 아직 승급 못 한 오퍼를 과대평가하지 않도록 맞춰 두세요.",
  ]},
  { title: "대체 추천", items: [
    "각 자리의 대체 후보는 실제로 교체해 본 방 점수로 순위를 매기고, 동점이면 낮은 성급(육성 저렴)을 우선합니다.",
    "토큰 생성·소비자, 오버라이드·수익 역할, 쉐이 카운트 인원 같은 시너지 코어는 '대체 불가'로 표시됩니다.",
  ]},
  { title: "미래시(미실장) 오퍼", items: [
    "헤더의 '미래시 데이터 포함'을 켜면 한국 서버 미출시(중국 서버 선행) 오퍼도 보유 오퍼 설정과 자동편성 계산에 포함됩니다. 스킬 텍스트는 비공식 AI 번역이며, 한국 서버 정식 출시 시 공식 데이터로 대체됩니다.",
    "토글을 바꿔도 현재 편성은 유지됩니다 — 자동편성을 다시 실행해야 반영됩니다.",
  ]},
  { title: "수치는 근사치", items: [
    "숙소는 풀 인원(20명), 모집 4칸, 발전소 3(그레이 알터 시 4) 기준의 추정 상한으로 계산합니다. 실제 게임 수치와 약간 다를 수 있습니다.",
    "자세한 규칙 전문은 저장소의 docs/INFRA-RULES.md를 참고하세요.",
  ]},
];

function HelpModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": "#dfff00" } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        <header className="room-modal-head">
          <span className="modal-kicker">HOW IT WORKS</span>
          <h2>{t("최적화 규칙 도움말")}</h2>
        </header>
        <div className="modal-scroll">
          {HELP_SECTIONS.map((section) => (
            <section key={section.title} className="detail-section">
              <h3>{t(section.title)}</h3>
              <ul className="help-list">
                {section.items.map((item, index) => <li key={index}>{t(item)}</li>)}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
