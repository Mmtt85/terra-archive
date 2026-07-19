// 인프라 플래너 엔진 (L0) — 절대룰·점수 모델·자동편성·전수 감사. React/UI 의존 없음.
// 규칙 계층: L0(이 파일) 절대룰·점수 결합 방식 / L1 게임 팩트(data/infra.json) /
// L2 유동 규칙(data/rules.json — 상수·토큰 카탈로그·파서 교정·검증 픽스처, app/rules.ts 로더).
// 도메인 규칙 정본은 docs/INFRA-RULES.md. UI는 app/planner.tsx.
// ⚠ 이 파일이나 rules.json을 고치면 반드시 `node scripts/verify-plan.mjs`로 회귀 검증할 것 —
// 픽스처(검증된 정배)와 스냅샷이 "굼 없는 레토"류 회귀를 커밋 전에 잡는다.
import infraData from "./data/infra.json";
import { C } from "./rules";

export type TokenGen = { token: string; estimate: number; perMember?: { per: number; cap: number; match: string } };
export type TokenUse = { token: string; per: number; value: number; percent: boolean };

export type InfraSkill = {
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
  perProduct?: Record<string, number> | null; // 생산품별 부호 오라 (플레임테일: {exp:+10, gold:-10} — 1명당)
  perSkillTag: string | null;
  perSkillValue: number | null;
  families?: string[]; // 이 스킬이 속한 "~류" 계열 태그 (build-infra.py skillFamilies 카탈로그)
  tiers?: InfraSkill[]; // 같은 슬롯의 하위 정예화 단계 (스푸리아 기술 교류 α) — 정예화 낮추면 대체
};

export type InfraOp = {
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
  elite?: Elite; // withElite가 스탬프하는 정예화 단계 (미지정=2정). 응접실 레어도 기본 단서속도 계산용
};

// 직군 정렬 순서·정렬 키 — 백과사전(home.tsx)과 동일 (보유 오퍼 설정 정렬용)
export const JOB_ORDER = ["PIONEER", "WARRIOR", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"];
export const ROSTER_SORT_KEYS = ["기본", "이름", "성급", "발매순", "소속", "출신지", "종족", "직군", "세부 직군"];

export const factionsOf = (op: InfraOp): string[] => op.factions ?? [op.faction];

export type RoomSpec = { name: string; slots: number; electricity: number; maxCount: number };

export const infra = infraData as { rooms: Record<string, RoomSpec>; ops: InfraOp[] };
export const ops = infra.ops;
export const opById = new Map(ops.map((op) => [op.id, op]));

export type Elite = 0 | 1 | 2;

// 미지정 = 2정(최대) 가정. 1정은 '정예화 2' 해금 스킬을, 0정(노정예)은
// '정예화 1'·'정예화 2' 해금 스킬을 아직 못 쓴다 (Lv.1/Lv.30 스킬은 유지)
export const eliteLocks = (unlock: string, elite: Elite) => unlock === "정예화 2" || (elite === 0 && unlock === "정예화 1");
export function withElite(op: InfraOp, elite: Elite | undefined): InfraOp {
  // 미지정·2정은 스킬 필터링이 필요 없지만, 응접실 기본 단서속도용으로 정예화만 스탬프한다
  if (elite == null || elite === 2) return op;
  const skills: InfraSkill[] = [];
  for (const skill of op.skills) {
    if (!eliteLocks(skill.unlock, elite)) { skills.push(skill); continue; }
    // 정예화로 잠긴 스킬 — 같은 슬롯의 하위 단계(기술 교류 α 등)가 있으면 그걸로 대체.
    // 없으면(순수 정예화 해금 스킬) 통째로 빠진다.
    const lower = (skill.tiers ?? []).filter((t) => !eliteLocks(t.unlock, elite));
    if (lower.length) skills.push(lower[lower.length - 1]);
  }
  return { ...op, elite, skills };
}

// 응접실 단서 수집 속도는 RIIC 스킬과 별개로 레어도·정예화 기본치가 가산된다
// (Terra Wiki): 3성↓ +5 / 4성 +7 / 5성 +9 / 6성 +10, 정예화 E1 +8 / E2 +16.
// 정예화 미지정이면 그 레어도의 최대 승급을 가정한다(6·5·4성 E2, 3성 E1, 2성↓ E0).
// RIIC 스킬 없는 2정 6성 +26%, 2정 5성 +25%(=12F 5+20). 응접실 2인 배치라 합산.
export const CLUE_RARITY_BASE: Record<string, number> = C.CLUE_RARITY_BASE;
export const CLUE_ELITE_BASE: number[] = C.CLUE_ELITE_BASE;
export const maxElite = (rarity: number): Elite => (rarity >= 4 ? 2 : rarity === 3 ? 1 : 0);
export const clueBase = (op: InfraOp): number => (CLUE_RARITY_BASE[op.rarity] ?? CLUE_RARITY_BASE.default ?? 5) + (CLUE_ELITE_BASE[op.elite ?? maxElite(op.rarity)] ?? 0);

// 정예화 단계 선택지: 정예화 해금 스킬이 있어야 의미가 있고,
// 3성은 정예화 1까지·1~2성은 승급 자체가 없다
export const ELITE_LABEL: Record<Elite, string> = { 0: "노정예", 1: "1정", 2: "2정" };
export function eliteOptions(op: InfraOp): Elite[] {
  if (!op.skills.some((skill) => skill.unlock.startsWith("정예화"))) return [];
  if (op.rarity <= 2) return [];
  return op.rarity === 3 ? [0, 1] : [0, 1, 2];
}

// 243 layout: gold ×2 + battle-record ×2 factories, two 12h crews per day
export const LAYOUT: { key: string; room: string; label: string; product?: string }[] = [
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

export const cellByKey = new Map(LAYOUT.map((cell) => [cell.key, cell]));

export const ROOM_ACCENT: Record<string, string> = {
  TRADING: "#4d9dd6", MANUFACTURE: "#e0b13e", POWER: "#b7d940", CONTROL: "#c3d24b",
  MEETING: "#8f7fc0", WORKSHOP: "#c78a54", HIRE: "#6fa08a", TRAINING: "#c05f6e", DORMITORY: "#7f8ea3",
};

export const UNIT: Record<string, string> = {
  MANUFACTURE: "생산력", TRADING: "오더 효율·품질", POWER: "드론 회복", MEETING: "단서 속도",
  HIRE: "연락 속도", WORKSHOP: "부산물", TRAINING: "훈련 속도", CONTROL: "지원", DORMITORY: "회복",
};

export const PARK_KEYS = ["WORKSHOP"];
export const SHIFT_COUNT = 2;

export type Ctx = { product?: string; tokenPoints: Record<string, number>; factionCounts?: Record<string, number>; plants?: number; presentIds?: Set<string>; ambient?: AmbientAura[]; roomOf?: Map<string, string> };

export function skillApplies(skill: InfraSkill, room: string, product?: string): boolean {
  if (skill.room !== room) return false;
  if (room === "MANUFACTURE" && product && skill.product !== "any" && skill.product !== product) return false;
  return true;
}

// every distinct skill line (group) applies at once; α/β tiers replace each other
export function activeSkills(op: InfraOp, room: string, product?: string): InfraSkill[] {
  const byGroup = new Map<string, InfraSkill>();
  for (const skill of op.skills) {
    if (!skillApplies(skill, room, product)) continue;
    const existing = byGroup.get(skill.group);
    if (!existing || skill.tier > existing.tier) byGroup.set(skill.group, skill);
  }
  return Array.from(byGroup.values());
}

export type OpBreakdown = {
  efficiency: number;   // additive order/production efficiency
  facilityEff: number;  // facility-count-based production (survives automation)
  automation: number;   // 위디·유넥티스: zeroes others, scales with plants
  quality: number;      // quality-order probability (equiv %)
  payout: number;       // quality-order payout (테킬라 — scales with quality crew)
  payoutViolation: number; // violation-order payout (프로바이조 — anti-synergy with quality crew)
  override: number;     // 샤마르: flat rate replacing everyone's efficiency
  perCoworker: number;  // +x% per other member
  clueBase: number;     // 응접실: 레어도·정예화 기본 단서속도 (RIIC 스킬과 별개, 항상 가산)
  auras: Record<string, number>; // control-center facility-wide auras
  skills: InfraSkill[];
};

// control auras: only the highest of a kind counts, ranked by the user's
// priority — factories > trading posts > hire contacts > clue speed
export const AURA_WEIGHT: Record<string, number> = C.AURA_WEIGHT;
export const AURA_LABEL: Record<string, string> = { ctrl_mfg: "제조소 생산력 오라", ctrl_trade: "무역소 오더 효율 오라", ctrl_hire: "인맥 레퍼런스 오라", ctrl_clue: "단서 수집 오라" };
// 제어센터 오라가 실제로 더해지는 대상 방 — 방 점수·서머리에 합산된다
export const AURA_TARGET: Record<string, string> = { MANUFACTURE: "ctrl_mfg", TRADING: "ctrl_trade", HIRE: "ctrl_hire", MEETING: "ctrl_clue" };

// 조건부 오라(이격 실버애쉬: "쉐라그 3명 배치된 무역소")는 조건을 채운 그 방 하나에만 적용.
// perProduct: 생산품별 부호 오라(플레임테일 — 작전기록 방 +, 귀금속 방 -; 인원수로 스케일된 값)
export type AmbientAura = { kind: string; value: number; gateFaction?: string | null; gateCount?: number | null; belowThreshold?: number | null; perProduct?: Record<string, number> | null };

// 방 기본 속도 — 임계값 조건("N% 미만인 경우, 기본 속도 포함") 판정용 (사무실 기본 누적 5%)
export const ROOM_BASE_RATE: Record<string, number> = C.ROOM_BASE_RATE;

// 제어센터 팀의 활성 오라 목록 — 대상 방 점수에 앰비언트로 더해 준다
export function aurasOf(controlTeam: InfraOp[], ctx: Ctx): AmbientAura[] {
  const list: AmbientAura[] = [];
  for (const op of controlTeam) {
    const b = breakdown(op, "CONTROL", controlTeam, ctx);
    for (const skill of b.skills) {
      if (!(skill.kind in AURA_WEIGHT)) continue;
      if (skill.gateFaction || skill.belowThreshold != null) {
        list.push({ kind: skill.kind, value: skill.value, gateFaction: skill.gateFaction, gateCount: skill.gateCount ?? 1, belowThreshold: skill.belowThreshold });
      } else if (skill.perProduct && skill.perFaction) {
        // 생산품별 부호 오라 (플레임테일): 제조소 배치 진영 인원수(기지 전체 근사 - 제어센터
        // 동석분)로 스케일한 생산품→가감 맵을 전달 — 작전기록 방 +, 귀금속 방 -
        const seated = controlTeam.filter((member) => factionsOf(member).includes(skill.perFaction!)).length;
        const count = Math.max(0, (ctx.factionCounts?.[skill.perFaction] ?? 0) - seated);
        const scaled = Object.fromEntries(Object.entries(skill.perProduct).map(([product, per]) => [product, per * count]));
        list.push({ kind: skill.kind, value: b.auras[skill.kind] ?? 0, perProduct: scaled });
      } else {
        list.push({ kind: skill.kind, value: skill.perFaction ? b.auras[skill.kind] ?? 0 : skill.value });
      }
    }
  }
  return list;
}

// 이 방이 실제로 받는 오라 (동종 최고만) — 조건부 오라는 방 구성원·수치가 조건을 채울 때만.
// roomEfficiency: 방 자체 크루가 내는 효율 (사일라흐 임계값 판정: 기본 속도 + 크루 효율 < 임계)
export function ambientFor(room: string, team: InfraOp[], ambient?: AmbientAura[], roomEfficiency = 0, product?: string): number {
  if (!team.length || !ambient) return 0;
  const target = AURA_TARGET[room] ?? "";
  let best = 0;
  let productAdd = 0; // 생산품별 부호 오라 — 동종 최고 경쟁이 아니라 가감으로 합산 (감산 포함)
  for (const aura of ambient) {
    if (aura.kind !== target) continue;
    if (aura.perProduct) {
      if (product) productAdd += aura.perProduct[product] ?? 0;
      continue;
    }
    if (aura.gateFaction && team.filter((member) => factionsOf(member).includes(aura.gateFaction!)).length < (aura.gateCount ?? 1)) continue;
    if (aura.belowThreshold != null && (ROOM_BASE_RATE[room] ?? 0) + roomEfficiency >= aura.belowThreshold) continue;
    best = Math.max(best, aura.value);
  }
  return best + productAdd;
}

export function breakdown(op: InfraOp, room: string, team: InfraOp[], ctx: Ctx): OpBreakdown {
  const teamIds = new Set(team.map((member) => member.id));
  const teamSize = Math.max(team.length, 1);
  const out: OpBreakdown = { efficiency: 0, facilityEff: 0, automation: 0, quality: 0, payout: 0, payoutViolation: 0, override: 0, perCoworker: 0, clueBase: 0, auras: {}, skills: [] };
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
    // per-faction counting (바르카리스: 미노스 오퍼레이터 1명당 +v%, 최대 cap).
    // perScope "mfg"(플레임테일·제시카 이격 "제조소에 배치된 <진영> 1명당")의 기지 전체 근사는
    // 같은 제어센터에 앉은 동일 진영 인원(본인 포함)을 빼서 과산정을 줄인다
    if (skill.perFaction && skill.perSkillTag == null) {
      const seated = skill.perScope === "mfg" ? team.filter((member) => factionsOf(member).includes(skill.perFaction!)).length : 0;
      const count = skill.perScope === "room"
        ? team.filter((member) => factionsOf(member).includes(skill.perFaction!)).length
        : Math.max(0, (ctx.factionCounts?.[skill.perFaction] ?? 0) - seated);
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
    if (skill.kind === "automation") { out.automation += skill.value * (ctx.plants ?? C.PLANTS_BASE); continue; }
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
  // 응접실: RIIC 스킬과 별개로 레어도·정예화 기본 단서속도를 모든 배치 오퍼가 가산.
  // efficiency에 묻지 않고 별도 필드로 둬서 화면에 "레어도 기본"으로 따로 표시한다
  if (room === "MEETING") out.clueBase = clueBase(op);
  return out;
}

export function teamScore(team: InfraOp[], room: string, ctx: Ctx): number {
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
  const payout = parts.reduce((sum, p) => sum + p.payout, 0) * Math.min(1 + C.PAYOUT_QUALITY_STEP * probCount, C.PAYOUT_QUALITY_CAP)
    + parts.reduce((sum, p) => sum + p.payoutViolation, 0) * Math.max(1 - C.PAYOUT_QUALITY_STEP * probCount, 0) * Math.min(1 + efficiency / 100, C.PAYOUT_VIOLATION_CAP);
  let auras = 0;
  for (const kind of Object.keys(AURA_WEIGHT)) {
    const bestOfKind = Math.max(...parts.map((p) => p.auras[kind] ?? 0), 0);
    auras += bestOfKind * AURA_WEIGHT[kind];
  }
  // 응접실 레어도 기본 단서속도 — 스킬과 무관한 항상 가산분 (override/automation과 무관)
  const clueBaseSum = parts.reduce((sum, p) => sum + p.clueBase, 0);
  // 제어센터 오라를 대상 방 점수에 실제 합산 — "무역소 오더 효율 +10%"면 무역소가 +10%.
  // 조건부 오라(쉐라그 3명 배치)는 조건을 채운 그 방 하나에만 붙는다
  return efficiency + clueBaseSum + quality + payout + auras + ambientFor(room, team, ctx.ambient, efficiency, ctx.product);
}

export function opSolo(op: InfraOp, room: string, slots: number, ctx: Ctx): number {
  const b = breakdown(op, room, [op], ctx);
  let auras = 0;
  for (const kind of Object.keys(AURA_WEIGHT)) auras += (b.auras[kind] ?? 0) * AURA_WEIGHT[kind];
  return b.efficiency + b.clueBase + b.facilityEff + b.automation + b.quality + b.payout + b.payoutViolation + b.override * slots + b.perCoworker * (slots - 1) + auras;
}

export function bestTeam(room: string, slots: number, pool: Map<string, InfraOp>, ctx: Ctx, seedOps: InfraOp[] = []): InfraOp[] {
  const cands = Array.from(pool.values()).filter((op) => op.skills.some((skill) => skillApplies(skill, room, ctx.product)));
  const solo = cands.map((op) => ({ op, v: opSolo(op, room, slots, ctx) })).sort((a, b) => b.v - a.v || a.op.rarity - b.op.rarity);
  // 쇼트리스트 = 단독 점수 상위 40 + **팀 의존 역할군 전원**. override/payout/quality/
  // percoworker는 팀이 갖춰져야 가치가 드러나 단독 점수로는 저평가되는데, 쇼트리스트에서
  // 잘리면 그리디·감사 모두 완성형 조합을 영영 못 본다 — 무6성 로스터에서 디아만테(단독 15)가
  // 잘려 샤마르 방이 품질 요원을 못 받던 사례 (사용자 확정 2026-07-19: 계산이 느려져도 전수)
  const TEAM_KINDS = new Set(["override", "payout", "quality", "percoworker"]);
  const rankedBase = solo.slice(0, 40).map((entry) => entry.op);
  const rankedIds = new Set(rankedBase.map((op) => op.id));
  const ranked = [...rankedBase, ...cands.filter((op) =>
    !rankedIds.has(op.id) && op.skills.some((skill) => TEAM_KINDS.has(skill.kind) && skillApplies(skill, room, ctx.product)))];
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

export type FlowGenerator = { opId: string; at: string; amount: number; via?: string; convRate?: number; perMember?: { per: number; cap: number; match: string } };
export type FlowConsumer = { opId: string; at: string; room: string; rate: number; percent: boolean; gain: number };

export type TokenFlow = {
  token: string;
  total: number;
  generators: FlowGenerator[];
  converters: { opId: string; from: string }[];
  consumers: FlowConsumer[];
};

export type Plan = {
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


// 방 채우기 우선순위 (사용자 확정 2026-07): 제조소-순금 > 제조소-작전기록 > 무역소 >
// 발전소 > 사무실 > 응접실 — 먼저 채우는 방이 최고 요원을 가져간다. 응접실은 최하위
// (제어센터는 쉐이 시드·오라 요원 전용이라 경합이 적어 발전소 다음에 둔다)
export const PRODUCTION_KEYS = ["MANUFACTURE-0", "MANUFACTURE-1", "MANUFACTURE-2", "MANUFACTURE-3", "TRADING-0", "TRADING-1", "POWER-0", "POWER-1", "POWER-2"];
// 우선 생산 모드 (사용자 확정 2026-07): 먼저 채우는 방이 최고 요원을 가져가므로,
// 방 순서만 바꾸면 순금 우선 / 작전기록 우선 / 밸런스(교차)가 된다.
export type ProdPriority = "gold" | "exp" | "balance";
export const PRIORITY_KEYS: Record<ProdPriority, string[]> = {
  gold: PRODUCTION_KEYS,
  exp: ["MANUFACTURE-2", "MANUFACTURE-3", "MANUFACTURE-0", "MANUFACTURE-1", "TRADING-0", "TRADING-1", "POWER-0", "POWER-1", "POWER-2"],
  balance: ["MANUFACTURE-0", "MANUFACTURE-2", "MANUFACTURE-1", "MANUFACTURE-3", "TRADING-0", "TRADING-1", "POWER-0", "POWER-1", "POWER-2"],
};
export const SUPPORT_KEYS = ["CONTROL", "HIRE", "MEETING", "WORKSHOP", "TRAINING"];

export function ctxFor(key: string, tokenPoints: Record<string, number>, factionCounts?: Record<string, number>, plants?: number, presentIds?: Set<string>, ambient?: AmbientAura[]): Ctx {
  return { product: cellByKey.get(key)?.product, tokenPoints, factionCounts, plants, presentIds, ambient };
}

// 불러온(import) plan을 렌더가 안전하게 다룰 수 있는 형태로 정규화한다.
// 방 키는 현재 LAYOUT만 남기고, 각 시프트는 문자열 id 배열로, factionCounts는 조 수만큼
// 채운다. 손상·구버전·수기 편집 파일이 들어와도 인덱스 초과·undefined 접근으로 크래시하지
// 않게 하는 방어 코드 (사용자 제보 2026-07: 커스텀 json 불러오면 인덱스 초과 오류).
export function sanitizePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const src = (p.assignments && typeof p.assignments === "object") ? p.assignments as Record<string, unknown> : {};
  const assignments: Record<string, string[][]> = {};
  for (const cell of LAYOUT) {
    const v = src[cell.key];
    const shifts = Array.isArray(v)
      ? v.map((s) => (Array.isArray(s) ? s.filter((x): x is string => typeof x === "string") : []))
      : [];
    assignments[cell.key] = shifts.length ? shifts : [[]]; // 최소 1개 시프트 보장
  }
  const fc = Array.isArray(p.factionCounts) ? p.factionCounts : [];
  const factionCounts = Array.from({ length: SHIFT_COUNT }, (_, i) =>
    (fc[i] && typeof fc[i] === "object" ? fc[i] : {})) as Record<string, number>[];
  const flows = Array.isArray(p.flows)
    ? (p.flows as unknown[]).filter((f): f is TokenFlow => {
        const o = f as Record<string, unknown>;
        return !!o && typeof o.token === "string" && Array.isArray(o.generators) && Array.isArray(o.converters) && Array.isArray(o.consumers);
      })
    : [];
  return {
    assignments,
    plants: typeof p.plants === "number" ? p.plants : C.PLANTS_BASE,
    tokenPoints: (p.tokenPoints && typeof p.tokenPoints === "object") ? p.tokenPoints as Record<string, number> : {},
    factionCounts,
    flows,
    strategy: typeof p.strategy === "string" ? p.strategy : "",
    strategyTokens: Array.isArray(p.strategyTokens) ? (p.strategyTokens as unknown[]).filter((x): x is string => typeof x === "string") : [],
    strategySet: !!p.strategySet,
    priority: (p.priority === "gold" || p.priority === "exp" || p.priority === "balance") ? p.priority : "gold",
  };
}

// 해당 조 기준 기지 내 배치 전원 (숙소·응접실 포함) — 기반시설 존재 조건 판정용
export function presentIdsFor(plan: Plan, shift: number): Set<string> {
  const ids = new Set<string>();
  for (const shifts of Object.values(plan.assignments)) {
    for (const id of shifts[Math.min(shift, shifts.length - 1)] ?? []) ids.add(id);
  }
  return ids;
}

// 세트 후보 선택 — 쉐라그(gate: A조 무역소)·피누스(product: B조 작전기록방)·품질 조합
// (quality: A조 무역소 오버라이드+수익+품질)은 **개별 후보**로 평가한다. 단일 플래그로 묶으면
// 한 세트의 이득에 다른 세트가 무임승차로 채택되는 얽힘이 생긴다 (2026-07-19)
export type FactionSets = { gate?: boolean; product?: boolean; quality?: boolean };

export function buildPlan(packageTokens: string[], roster: InfraOp[], factionSets: FactionSets = {}, priority: ProdPriority = "gold"): Plan {
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
  const plants = plantBooster ? C.PLANTS_BOOSTED : C.PLANTS_BASE;

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
    if (shift === 0 && factionSets.gate) {
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
    // 품질 조합 세트 (사용자 확정 2026-07-19: "샤마르+테킬라는 가능한 한 고품질 확률 요원과
    // 조합한다"): 오버라이드(샤마르)+품질 수익(테킬라)+고품질 확률 요원 3인을 무역소 한 곳에
    // 결집한 후보안. 보통은 점수 모델이 알아서 조립하지만(디아만테 210 > 아르케토 182.5),
    // 토큰 시드(우요우 등)가 무역소를 선점·예약하면 그리디·감사 모두 이 완성형을 못 연다
    // (무6성 로스터에서 총점 -27.5 사례) — 세트로 열고 planScore 비교로 채택한다.
    // payout_v(프로바이조 위약 수익)는 품질과 반시너지라 제외.
    if (shift === 0 && factionSets.quality) {
      const bestOf = (kind: string) => roster
        .filter((op) => !used.has(op.id) && !reserved.has(op.id) && op.skills.some((s) => s.room === "TRADING" && s.kind === kind))
        .sort((a, b) => opSolo(b, "TRADING", 3, { tokenPoints: {} }) - opSolo(a, "TRADING", 3, { tokenPoints: {} }))[0];
      const overrideOp = bestOf("override");
      const payoutOp = bestOf("payout");
      if (overrideOp && payoutOp && overrideOp.id !== payoutOp.id) {
        // 3번째 자리는 실제 방 점수 기준 최고 품질 요원 (미틈·디아만테·카프카·바이비크 동급 대체)
        const qualityOp = roster
          .filter((op) => op.id !== overrideOp.id && op.id !== payoutOp.id && !used.has(op.id) && !reserved.has(op.id)
            && op.skills.some((s) => s.room === "TRADING" && s.kind === "quality"))
          .sort((a, b) => teamScore([overrideOp, payoutOp, b], "TRADING", { tokenPoints: {} })
            - teamScore([overrideOp, payoutOp, a], "TRADING", { tokenPoints: {} }))[0];
        const cell = LAYOUT.filter((c) => c.room === "TRADING").find((c) => !(seeds[c.key]?.length));
        if (qualityOp && cell) {
          seeds[cell.key] = [overrideOp, payoutOp, qualityOp];
          for (const op of seeds[cell.key]) reserved.set(op.id, cell.key);
        }
      }
    }
    // 피누스 실베스트리스 세트 (피드백 2026-07-14 · 사용자 확정 2026-07-19): 플레임테일
    // (제어센터 — 제조소의 기사단 1명당 작전기록 +10% / 귀금속 -10% 오라) 보유 시
    // **회복 교대(B조)**에 기사단 제조 요원(애쉬락·와일드메인·파투스, 각 +25%)과 플레임테일을
    // 결집한 후보안을 만든다. 그리디는 제조소를 제어센터보다 먼저 채워 "오라는 인원이 있어야
    // 켜지고, 인원은 오라가 켜져야 이긴다"는 닭-달걀로 세트를 못 연다 — 쉐라그 세트처럼
    // 시드로 열고 optimize()가 세트 없는 안과 기지 총점(귀금속 감산 포함)을 비교해 이득일
    // 때만 채택한다. B조인 이유: A조 제조소·제어센터는 화식 세트와 상위 생산 오퍼 몫이라
    // 기회비용이 크다.
    if (shift === 1 && factionSets.product) {
      for (const auraOp of roster) {
        if (used.has(auraOp.id)) continue;
        for (const skill of auraOp.skills) {
          if (skill.room !== "CONTROL" || !(skill.kind in AURA_WEIGHT) || !skill.perFaction || !skill.perProduct) continue;
          const plusProduct = Object.entries(skill.perProduct).find(([, per]) => per > 0)?.[0];
          if (!plusProduct) continue;
          const bodies = roster
            .filter((op) => op.id !== auraOp.id && !used.has(op.id) && !reserved.has(op.id)
              && factionsOf(op).includes(skill.perFaction!)
              && op.skills.some((s) => skillApplies(s, "MANUFACTURE", plusProduct)))
            .sort((a, b) => opSolo(b, "MANUFACTURE", 3, { tokenPoints: {} }) - opSolo(a, "MANUFACTURE", 3, { tokenPoints: {} }))
            .slice(0, 3);
          if (bodies.length < 2) continue; // 결집할 인원이 없으면 세트 무의미
          const cell = LAYOUT.find((c) => c.room === "MANUFACTURE" && c.product === plusProduct);
          if (!cell) continue;
          seeds[cell.key] = [...(seeds[cell.key] ?? []), ...bodies].slice(0, 3);
          seeds["CONTROL"] = [...(seeds["CONTROL"] ?? []), auraOp].slice(0, 5);
          // 예약 등록 — 같은 조의 앞 순서 방(순금 등)이 시드를 채가거나 전수 감사(seedKeep)가
          // 세트를 쓸어내지 않도록. A조 풀은 이미 지나갔으므로 A 배치에는 영향 없다
          for (const op of seeds[cell.key]) reserved.set(op.id, cell.key);
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
            if ((use.value / use.per) * estTotal < C.SEED_TOKEN_MIN_GAIN) continue;
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
            // 죽은 전환 사슬의 공급원은 앉히지 않는다 (사용자 확정 2026-07-19): 전환으로만
            // 이 토큰에 기여하는 오퍼(우요우: 화식→주술)는 전환자(지에윈)가 배치돼 있을 때만
            // 자리를 받는다 — 무6성 로스터에서 기대가치 8짜리 사슬이 우요우를 무역소에
            // 예약해 품질 조합(210 > 182.5)을 봉쇄하던 원인
            if (!already && !converterPlaced) continue;
            if (already || LAYOUT.filter((c) => c.room === skill.room).some((cell) => place(op, cell.key))) {
              if (converterPlaced) {
                for (const g of gen) {
                  const convRate = g.token === token ? 1 : sources.get(g.token) ?? 0;
                  const amount = g.estimate * convRate;
                  if (amount <= 0) continue;
                  flow.generators.push({ opId: op.id, at: placedAt.get(op.id) ?? "기존 배치", amount, via: g.token === token ? undefined : g.token, convRate, perMember: g.perMember });
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
      // 가공소(상시 슬롯)는 조 전환과 무관하게 A조 한 팀만 고정 — B조는 비운다.
      // 사기 비소모 방이라 교대 개념이 없고, 회복 교대에 가공 요원(혼 등)을 끌어올
      // 이유가 없다 (사용자 확정 2026-07-19)
      if (PARK_KEYS.includes(key) && shift > 0) { assignments[key].push([]); continue; }
      const room = cellByKey.get(key)?.room ?? key;
      const slots = infra.rooms[room]?.slots ?? 1;
      // 예약(시드)은 조 불문 강제 — A조 세트(쉐라그·토큰 코어)뿐 아니라 B조 세트(피누스)도
      // 앞 순서 방이 시드를 채가지 못하게 한다 (A조 예약 오퍼는 이미 used라 B풀에 없음)
      const pool = new Map(roster.filter((op) => !used.has(op.id) && (!reserved.has(op.id) || reserved.get(op.id) === key)).map((op) => [op.id, op]));
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
  // 조건 미충족 오퍼만 손대므로(그리디 결과를 갈아엎지 않음) 안전. 안정될 때까지 최대 5회.
  const byIdAll = new Map(roster.map((op) => [op.id, op]));
  for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
    for (let pass = 0; pass < 5; pass += 1) {
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
  // 마친 뒤 수렴할 때까지(최대 8회 — 사용자 확정 2026-07-19: 계산이 수 초 걸려도 전수조사
  // 반복이 우선) 다시 훑어 교정한다. 매 회: ① A조가 각 방(제품 타입별)에서 최강이
  // 되도록 B조의 더 나은 요원을 끌어올리고(같은 방타입 내 swap, 시드/예약은 고정) →
  // ② A·B 동시 배치를 제거하고 → ③ 빈 근무 방을 벤치 최고 요원으로 채운다. 사기 비소모
  // 방 숙소(휴식)·가공소(상시 슬롯)만 예외로 조 전환과 무관하게 고정.
  {
    const restRoom = (key: string) => { const r = cellByKey.get(key)?.room ?? key; return r === "DORMITORY" || r === "WORKSHOP"; };
    const workKeys = keys.filter((key) => !restRoom(key) && key !== "TRAINING");
    const dormIds = new Set<string>();
    for (let d = 0; d < 4; d += 1) for (const id of assignments[`DORM-${d}`]?.[0] ?? []) dormIds.add(id);
    // 조 단위 2단계 감사 (사용자 규칙 2026-07): A조를 먼저 수렴까지 전수검사로 풀파워로
    // 완성하고(전체 로스터에서 선발), 그 뒤 B조를 "남은 오퍼만으로" 수렴까지 전수검사한다.
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
    for (let pass = 0; pass < 8; pass += 1) {
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
          // 예약 시드는 조 불문 유지 — A조 세트(쉐라그 등)와 B조 세트(피누스, 2026-07-19)
          // 모두 감사 재편성(ⓑ flat)이 쓸어내지 않도록 현재 방에 예약된 멤버를 시드로 고정
          const seedKeep = curTeam.filter((op) => reserved.get(op.id) === aKey);
          // 자유 풀 = 벤치 + 이 방의 현재 멤버 (같은 조 다른 방·반대 조 근무·숙소 고정·타방 예약 제외)
          const freeOps = roster.filter((op) =>
            !dormIds.has(op.id) && !otherWork.has(op.id) &&
            (!roomKeyOf.has(op.id) || roomKeyOf.get(op.id) === aKey) &&
            (!reserved.has(op.id) || reserved.get(op.id) === aKey));
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
                const s = score([...team, op]) + (isFam(op) ? C.FAMILY_TIEBREAK : 0);
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
            (!reserved.has(op.id) || reserved.get(op.id) === key)).map((op) => [op.id, op]));
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
        // 전환 생성원(총웨 속세의 화식→주술 결정 등)은 재집계 때도 전환율을 다시 곱해야 한다
        gen.amount = gen.perMember.per * Math.min(count, gen.perMember.cap) * (gen.convRate ?? 1);
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
  const setUsed = Boolean(factionSets.gate || factionSets.product);
  const strategy = (packageTokens.length ? `${packageTokens.join(" + ")} 패키지` : "기본 편성") + (setUsed ? " + 진영 세트" : "");
  return { assignments, plants, tokenPoints, factionCounts: factionCountsPerShift, flows, strategy, strategyTokens: packageTokens, strategySet: setUsed, priority };
}

// 세트 채택 비교 시 조별 가중 — A조는 풀파워 주력, B조는 회복 교대(§1). 동일 가중이면
// 약한 쉐라그 세트를 A조에 앉히고 강한 샤마르 조합을 B조로 밀어도 총점이 같아 세트가 잘못
// 채택된다(사용자 지적 2026-07). A조를 더 높게 쳐서 강조합이 A조에 남게 한다.
export const SHIFT_WEIGHT: number[] = C.SHIFT_WEIGHT;

// 계획 전체 총점 (양 조 전 방, 앰비언트 오라 포함) — 세트 포함/미포함 두 안 비교용
export function planScore(plan: Plan, byId: Map<string, InfraOp>): number {
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

// 자동편성 진행 알림 — UI가 로케일 문구로 포맷해 표시한다 (엔진은 i18n 무의존)
export type OptimizeStep = { phase: "base" | "variant" | "final"; index?: number; total?: number; sets?: (keyof FactionSets)[] };

export async function optimize(roster: InfraOp[], priority: ProdPriority = "gold", onStep?: (step: OptimizeStep) => void): Promise<Plan> {
  // 진행 콜백 후 매크로태스크 양보 — 브라우저가 안내 문구를 리페인트할 틈을 준다
  const tick = async (step: OptimizeStep) => {
    if (!onStep) return;
    onStep(step);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
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
  await tick({ phase: "base" });
  const base = buildPlan(open, roster, {}, priority);
  // 세트 후보 — 쉐라그(게이트 오라, A조 무역소)·피누스(생산품별 진영 오라, B조 작전기록방)·
  // 품질 조합(오버라이드+수익+품질, A조 무역소) 보유 시 **가능한 모든 조합(멱집합)**의
  // 후보안을 만들어 기지 총점이 가장 높은 안을 채택한다. 세트를 한 플래그로 묶으면 한
  // 세트의 이득에 다른 세트가 무임승차하는 얽힘이 생기고(2026-07-19 검출), 조합을 빼먹으면
  // 두 세트가 함께일 때만 이기는 안을 놓친다 — 계산이 수 초 걸려도 전수 비교가 우선
  // (사용자 확정 2026-07-19). 귀금속 감산 등 세트의 비용도 planScore에 그대로 반영되며,
  // 동률이면 세트 없는 안 유지(쉐라그 "이득일 때만" 규칙).
  const hasGatedAura = roster.some((op) => op.skills.some((skill) => skill.room === "CONTROL" && skill.gateFaction));
  const hasPerProductSet = roster.some((op) => op.skills.some((skill) =>
    skill.room === "CONTROL" && skill.perFaction && skill.kind in AURA_WEIGHT && skill.perProduct));
  const tradeOps = (kind: string) => roster.filter((op) => op.skills.some((s) => s.room === "TRADING" && s.kind === kind));
  const hasQualityCombo = (() => {
    const ov = tradeOps("override"), po = tradeOps("payout"), qu = tradeOps("quality");
    return ov.length > 0 && po.length > 0 && qu.some((op) => op.id !== ov[0].id && op.id !== po[0].id);
  })();
  const flags: (keyof FactionSets)[] = [];
  if (hasGatedAura) flags.push("gate");
  if (hasPerProductSet) flags.push("product");
  if (hasQualityCombo) flags.push("quality");
  const variants: FactionSets[] = [];
  for (let mask = 1; mask < (1 << flags.length); mask += 1) {
    const sets: FactionSets = {};
    flags.forEach((flag, index) => { if (mask & (1 << index)) sets[flag] = true; });
    variants.push(sets);
  }
  if (!variants.length) return base;
  const byId = new Map(roster.map((op) => [op.id, op]));
  let best = base;
  let bestScore = planScore(base, byId);
  for (let i = 0; i < variants.length; i += 1) {
    await tick({ phase: "variant", index: i + 1, total: variants.length, sets: Object.keys(variants[i]) as (keyof FactionSets)[] });
    const plan = buildPlan(open, roster, variants[i], priority);
    const score = planScore(plan, byId);
    if (score > bestScore) { best = plan; bestScore = score; }
  }
  await tick({ phase: "final" });
  return best;
}

export function slotSubstitutes(team: InfraOp[], index: number, key: string, ctx: Ctx, excluded: Set<string>, roster: InfraOp[], count = 3): { op: InfraOp; score: number }[] {
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
