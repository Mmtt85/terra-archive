// DPS 계산 — 순수 함수만 (화면은 app/dps.tsx). 데이터는 scripts/build-dps.py → app/data/dps.json.
// (2026-10-17, 제안 e8bcebb4 · 사용자 지시 "물리 및 마법 방어에 따른 DPS도 자동으로", "어떤 적에 대한 DPS", "탄약은 다 썼을 때 기준",
//  "범위 공격은 1명일 때·여러 명일 때")
//
// 확실히 아는 계수만 계산한다 — 공격력·공격 배율·공격 속도·공격 간격·타수·대상 수·탄약 수·방어 무시.
// 그 밖에 피해에 닿을 수 있는 계수(확률·틱 피해·최대 HP 비례 등)가 스킬에 있으면 partial 로 알리고 숫자는 그대로 둔다 —
// 화면이 "일부 효과 미반영"으로 표시한다. 재능·모듈의 특성 변화는 아직 안 다룬다(모듈은 스탯만).
//
// 게임 규칙 (공식 공식):
//  · 물리 = max(공격력×배율 − 방어력, 공격력×배율×5%) · 마법 = max(공격력×배율×(1 − 저항/100), 공격력×배율×5%)
//  · 공격 간격 = (기본 간격 + 간격 변화) ÷ (공격 속도/100), 공격 속도는 10~600
//  · 스킬 '공격 간격' 계수: 음수면 초 단위로 더하고, 양수면 기본 간격의 비율로 늘린다
//  · 공격력 = (기본 + 신뢰도 + 잠재 + 모듈) × (1 + 공격력% 합)

export type DpsSkillLv = { d: number; sp: [number, number, number]; bb: Record<string, number> };
/** 스킬 보정 규칙 — 계수만으로는 틀리는 스킬을 손으로 맞춘다 (scripts/dps-overrides*.json → build-dps.py, 사용자 지시 2026-10-17
 *  "첸 더 던스트릭도 고쳐 주고 다른 오퍼들도 전수조사"). 값 자리에 문자열을 쓰면 그 스킬 레벨의 계수(blackboard) 키다 */
export type Num = number | string;
export type SkillFx = {
  /** 스킬 중 공격 한 번의 타수 (설명에만 있는 'N연 공격'·'N회 입힘') */
  times?: Num;
  /** 스킬 중 공격의 피해 유형 — true = 방어·저항 무시(원소·진실 피해 아님, 방어 무시 피해) */
  dmg?: "phys" | "arts" | "true";
  /** 스킬 중 공격 배율 (atk_scale 대신 다른 키를 쓰는 스킬) */
  scale?: Num;
  /** 스킬 중 공격에만 더하는 공격력 % (발동 피해에는 안 붙는다 — 첸 더 던스트릭 S2 '이후 공격력 +300%') */
  atk?: Num;
  /** 스킬 중 동시에 치는 수 — "aoe" 면 적 전부 */
  targets?: Num | "aoe";
  /** 공격에 쓰지 않는 계수 — 발동 피해 전용 배율 등 */
  skip?: string[];
  /** 발동 순간 한 번 들어가는 피해 — 배율 × 횟수 × 대상 */
  burst?: { scale: Num; hits?: Num; targets?: Num | "aoe"; dmg?: "phys" | "arts" | "true" };
  /** 스킬 중 평타를 안 한다 (발동 피해만) */
  noAttack?: boolean;
  /** 스킬 중 공격 간격 덮어쓰기 (초, 공격 속도 반영 전 기본 간격) — 계수가 실제와 다르게 읽히는 미스틱 등 (전수조사 2026-10-17) */
  interval?: Num;
  /** 지속 시간 덮어쓰기 (초) */
  dur?: Num;
  /** '일부 효과 미반영'에서 뺄 계수 — 보정으로 처리했거나 피해와 무관 */
  ok?: string[];
  /** 카드에 띄울 짧은 메모 — 언어별 (문자열 하나면 한국어로 보고 i18n 사전을 거친다) */
  note?: string | { ko: string; en?: string; ja?: string };
};
/** tx = 공식 설명의 타수, ap = 공격 한 번에 쓰는 탄약 (build-dps.py from_desc), fx = 보정 규칙 */
/** bt = "set" — 양수 공격 간격 계수가 기본 간격에 곱하는 배율인 스킬 (설명이 '공격 딜레이 감소', 앤젤리나 S2 0.15 → 1.9초 × 0.15) */
export type DpsSkill = { id: string; t: 0 | 1 | 2; am: 0 | 1; lv: DpsSkillLv[]; tx?: number; ap?: number; bt?: "set"; fx?: SkillFx };
export type DpsOp = {
  sub: string; prof: string;
  ph: [number, number, number, number, number][];
  fav: [number, number]; pot: [number, number][];
  sk: DpsSkill[]; eq: Record<string, [number, number][]>; tb: Record<string, number>;
};
export type DmgType = "phys" | "arts";
type AnyDmg = DmgType | "true";

/** 직군(세부)별 공격 방식 — 게임 표에 바로 쓸 수 있는 값이 없어 직군 설명을 보고 정했다.
 *  dmg: 피해 유형 · aoe: 범위 공격(적 N명 모두) · tgt: 동시에 치는 수 · times: 한 번에 몇 대 · partial: 계산이 어림인 이유 */
type SubRule = { dmg: DmgType | "heal" | "none"; aoe?: boolean; tgt?: number; times?: number; partial?: string };
const SUB: Record<string, SubRule> = {
  blastcaster: { dmg: "arts", aoe: true }, chain: { dmg: "arts", tgt: 4 }, corecaster: { dmg: "arts" },
  funnel: { dmg: "arts", partial: "드론 공격 배율이 쌓일수록 오른다" }, mystic: { dmg: "arts", partial: "공격을 모아 한꺼번에 쏜다" },
  phalanx: { dmg: "arts", partial: "스킬 밖에서는 공격하지 않는다" }, primcaster: { dmg: "arts" }, soulcaster: { dmg: "arts" },
  splashcaster: { dmg: "arts", aoe: true },
  chainhealer: { dmg: "heal" }, healer: { dmg: "heal" }, physician: { dmg: "heal" }, ringhealer: { dmg: "heal" },
  wandermedic: { dmg: "heal" }, watchman: { dmg: "heal" }, incantationmedic: { dmg: "arts" },
  aoesniper: { dmg: "phys", aoe: true },
  // 투척수 — 2회차는 여진(공격력의 절반, 특성 계수 attack@append_atk_scale) (전수조사 2026-10-17)
  bombarder: { dmg: "phys", aoe: true },
  // 대검사·푸쉬마스터 — "저지하고 있는 모든 적 동시에 공격", 저지 수 2 (전수조사 2026-10-17: 1명으로 셌다)
  crusher: { dmg: "phys", tgt: 2 }, pusher: { dmg: "phys", tgt: 2 },
  // 스토커 — "공격 범위 내 모든 적 동시 공격" (전수조사 2026-10-17: 단일로 셌다)
  stalker: { dmg: "phys", aoe: true },
  reaperrange: { dmg: "phys", aoe: true, partial: "맨 앞줄 적에게만 150%" },
  skybreaker: { dmg: "phys", partial: "범위 피해 규칙" },
  alchemist: { dmg: "phys", partial: "공격 방식이 특수하다" }, traper: { dmg: "phys", partial: "피해 대부분이 함정에서 나온다" },
  bard: { dmg: "none" }, librator: { dmg: "none" },
  blessing: { dmg: "arts" }, ritualist: { dmg: "arts" }, slower: { dmg: "arts" }, summoner: { dmg: "arts", partial: "소환물 피해는 빠진다" },
  underminer: { dmg: "arts" }, artsprotector: { dmg: "arts" }, artsfghter: { dmg: "arts" },
  fortress: { dmg: "phys", aoe: true, partial: "저지 중이 아닐 때만 범위 공격" },
  centurion: { dmg: "phys", tgt: 3 }, sword: { dmg: "phys", times: 2 }, reaper: { dmg: "phys", aoe: true },
  hammer: { dmg: "phys", partial: "주변 적 50% 피해" }, lord: { dmg: "phys", partial: "원거리 공격은 80%" },
  instructor: { dmg: "phys", partial: "자신이 저지하지 않은 적에게 120%" },
};
export const subRule = (sub: string): SubRule => SUB[sub] ?? { dmg: "phys" };

// 스킬 계수 — 이 셋 밖의 키가 있으면 '일부 효과 미반영'
const HANDLED = new Set(["atk", "atk_scale", "attack_speed", "base_attack_time", "times", "max_target", "trigger_time",
  "def_penetrate_fixed", "def_penetrate", "magic_resist_penetrate_fixed", "magic_resist_penetrate"]);
// 피해 계산과 무관한 계수 — 상태 이상·생존·사거리·비용 따위
const IGNORE = new Set(["cost", "stun", "sluggish", "block_cnt", "max_hp", "move_speed", "taunt_level", "force", "ability_range_forward_extend",
  "projectile_range", "projectile_delay_time", "projectile_life_time", "heal_scale", "duration", "sleep", "silence", "levitate", "frozen",
  "respawn_time", "height_offset", "hp_recovery_per_sec", "hp_recovery_per_sec_by_max_hp_ratio", "range_radius", "ability_range_radius",
  "another_trigger_time", "hit_duration", "sp", "damage_resistance", "one_minus_status_resistance", "atk_to_hp_recovery_ratio",
  "max_stack_cnt", "def_scale", "attack@def_scale", "mode", "skill_max_trigger_time", "max_target_bonus_by_level",
  "shield_duration", "shield_max_hp_ratio", "levitate_duration", "frozen_duration", "cold", "fear", "range_id", "talent_range_flag", "p_force", "max_hp_ratio"]);

/** 미반영 계수의 사람이 읽는 이름 — 화면 표시용 (i18n 키) */
export const PARTIAL_LABEL: Record<string, string> = {
  prob: "확률 효과", value: "추가 효과 수치", ct: "횟수 효과", cnt: "횟수 효과", ep_damage_ratio: "원소 피해", hp_ratio: "체력 비례 피해",
  damage_scale: "받는 피해 증가", def: "방어력 변화", magic_resistance: "마법 저항 변화", interval: "주기 피해", atk_scale_2: "추가 피해 배율",
  scale: "추가 배율", multi_atk_scale: "연타 배율", multi_times: "연타 횟수", burn: "원소 피해", talent: "재능 연동",
};
export const partialLabel = (raw: string): string => {
  const k = raw.replace(/^attack@/, "");
  return PARTIAL_LABEL[k] ?? PARTIAL_LABEL[k.split(".")[0]] ?? PARTIAL_LABEL[k.split("@")[0]] ?? "그 밖의 효과";
};

export type Build = {
  phase: number; level: number; pot: number; /** 쓰지 않는다 — 신뢰도는 늘 100% (예전 저장값 호환) */ trust?: boolean; equip: string; equipLv: number;
  skill: number; skillLv: number; dmg: "auto" | DmgType;
};
export type Enemy = { def: number; res: number; hp: number; count: number };

/** aspd = 공격 속도(기본 100, 10~600) · interval = 실제 공격 간격(초) */
export type Line = { hit: number; interval: number; aspd: number; targets: number; dps1: number; dpsN: number };
export type Result = {
  kind: "ok" | "heal" | "none";
  dmg: DmgType;
  atk: number; normal: Line; skill: Line | null;
  /** 스킬 지속(초) — 탄약형은 탄약을 다 쓰는 데 걸리는 시간, 무한이면 Infinity, 한 방짜리는 0 */
  dur: number;
  /** 탄약형 — 탄약 수(ammoTotal)와 그걸로 하는 공격 횟수(ammo) */
  ammo: number; ammoTotal: number;
  /** 한 방짜리(다음 공격 강화 등) 스킬의 1회 피해 (적 1명) */
  burst: number;
  /** 발동 순간 피해 (보정 규칙 burst) — 1명 / N명. 없으면 0 */
  open1: number; openN: number;
  /** 발동 피해까지 넣은 스킬 중 DPS — 그래프·처치 시간이 쓴다 (발동 피해가 없으면 skill.dps1) */
  eff1: number; effN: number;
  /** 보정 규칙 메모 */
  fxNote?: SkillFx["note"];
  /** 스킬 한 번 동안 넣는 총 피해 (1명 / N명) */
  total1: number; totalN: number;
  /** 충전 시간(초) — 피격 충전은 null */
  charge: number | null;
  /** 스킬 한 바퀴(충전 + 발동) 평균 DPS (1명 / N명) */
  avg1: number | null; avgN: number | null;
  /** 계산에 못 넣은 계수 · 직군 규칙상 어림인 이유 */
  partial: string[]; subNote?: string;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const keyOf = (k: string) => k.replace(/^attack@/, "");

export function baseStats(op: DpsOp, b: Build): { atk: number; aspd: number; bat: number } {
  const ph = op.ph[clamp(b.phase, 0, op.ph.length - 1)];
  const [maxLv, a1, aMax, bat, aspd0] = ph;
  const lv = clamp(b.level, 1, maxLv);
  let atk = Math.round(a1 + (aMax - a1) * (maxLv > 1 ? (lv - 1) / (maxLv - 1) : 0));
  let aspd = aspd0;
  // 신뢰도는 늘 100% 이상으로 본다 (사용자 지시 2026-10-17 "신뢰도는 기본적으로 100% 이상이라고 고정")
  atk += op.fav[0]; aspd += op.fav[1];
  for (let i = 0; i < clamp(b.pot, 1, 6) - 1 && i < op.pot.length; i++) { atk += op.pot[i][0]; aspd += op.pot[i][1]; }
  const eq = b.equip ? op.eq[b.equip] : undefined;
  if (eq && b.phase === 2) { const s = eq[clamp(b.equipLv, 1, eq.length) - 1]; atk += s[0]; aspd += s[1]; }
  return { atk, aspd, bat };
}

function hitDmg(atk: number, scale: number, type: AnyDmg, e: { def: number; res: number }): number {
  const a = atk * scale;
  if (type === "true") return a;
  return type === "phys" ? Math.max(a - Math.max(0, e.def), a * 0.05) : Math.max(a * (1 - clamp(e.res, 0, 100) / 100), a * 0.05);
}

export function calc(op: DpsOp, b: Build, enemy: Enemy): Result {
  const rule = subRule(op.sub);
  const st = baseStats(op, b);
  const dmg: DmgType = b.dmg !== "auto" ? b.dmg : rule.dmg === "arts" ? "arts" : "phys";
  const empty: Line = { hit: 0, interval: 0, aspd: 0, targets: 0, dps1: 0, dpsN: 0 };
  if (rule.dmg === "heal" || rule.dmg === "none")
    return { kind: rule.dmg, dmg, atk: st.atk, normal: empty, skill: null, dur: 0, ammo: 0, ammoTotal: 0, burst: 0, open1: 0, openN: 0, eff1: 0, effN: 0, total1: 0, totalN: 0, charge: null, avg1: null, avgN: null, partial: [] };
  const N = Math.max(1, enemy.count);
  const traitScale = op.prof === "SNIPER" && op.sub === "hunter" ? op.tb.atk_scale ?? 1 : 1;
  // 투척수 여진 — 같은 공격이 절반 배율로 한 번 더
  const append = op.sub === "bombarder" ? op.tb["attack@append_atk_scale"] ?? 0 : 0;
  const baseTargets = rule.aoe ? N : Math.min(N, rule.tgt ?? 1);

  type Mods = { atkPct: number; scale: number; aspd: number; batAdd: number; times: number; targets: number; defFlat: number; defPct: number; resFlat: number; resPct: number };
  const line = (m: Mods): Line => {
    const atk = st.atk * (1 + m.atkPct);
    const aspd = clamp(st.aspd + m.aspd, 10, 600);
    const interval = (st.bat + m.batAdd) / (aspd / 100);
    const e = { def: Math.max(0, enemy.def * (1 - m.defPct) - m.defFlat), res: Math.max(0, enemy.res * (1 - m.resPct) - m.resFlat) };
    const hit = (hitDmg(atk, m.scale * traitScale, dmg, e) + (append ? hitDmg(atk, m.scale * traitScale * append, dmg, e) : 0)) * m.times;
    const targets = rule.aoe ? N : Math.min(N, m.targets);
    return { hit, interval, aspd, targets, dps1: hit / interval, dpsN: (hit * targets) / interval };
  };
  const plain: Mods = { atkPct: 0, scale: 1, aspd: 0, batAdd: 0, times: rule.times ?? 1, targets: baseTargets, defFlat: 0, defPct: 0, resFlat: 0, resPct: 0 };

  const sk = op.sk[b.skill];
  const L = sk?.lv[clamp(b.skillLv, 1, sk.lv.length) - 1];
  const partial: string[] = [];
  let sm: Mods | null = null, ammo = 0, burstAtkPct = 0;
  const fx = sk?.fx;
  // 보정 규칙의 값 — 숫자면 그대로, 문자열이면 이 레벨 계수(attack@ 붙은 것도 찾는다)
  const num = (v: Num | undefined, d: number): number => (v == null ? d : typeof v === "number" ? v : L?.bb[v] ?? L?.bb[`attack@${v}`] ?? d);
  if (sk && L) {
    sm = { ...plain };
    if (sk.tx && !("times" in L.bb) && !("attack@times" in L.bb)) sm.times = sk.tx;
    const skip = new Set(fx?.skip ?? []), okKeys = new Set(fx?.ok ?? []);
    for (const [raw, v] of Object.entries(L.bb)) {
      const k = keyOf(raw);
      if (skip.has(raw) || skip.has(k)) continue;
      if (okKeys.has(raw) || okKeys.has(k)) {
        // 처리됐다고 표시만 — 아래 일반 규칙도 그대로 탄다(공격력 등)
        if (!HANDLED.has(k)) continue;
      }
      if (k === "atk") sm.atkPct += v;
      else if (k === "atk_scale") sm.scale *= v;
      else if (k === "attack_speed") sm.aspd += v;
      // 공격 간격 — 음수면 초 단위로 더하고, 양수면 설명이 '감소'일 때 기본 간격 × 값(0.15 → 15%로), '증가'면 기본 간격 × (1 + 값)
      else if (k === "base_attack_time") sm.batAdd += v < 0 ? v : sk.bt === "set" ? st.bat * v - st.bat : st.bat * v;
      else if (k === "times") sm.times = v;
      else if (k === "max_target") sm.targets = v;
      else if (k === "trigger_time") { if (sk.am) ammo = v; }
      else if (k === "def_penetrate_fixed") sm.defFlat += v;
      else if (k === "def_penetrate") sm.defPct += v;
      else if (k === "magic_resist_penetrate_fixed") sm.resFlat += v;
      else if (k === "magic_resist_penetrate") sm.resPct += v;
      // 공격에 붙는 적 방어력 깎기(점액 등) — 스킬 중 적 방어력에 더한다
      else if (raw === "attack@def" && v < 0) sm.defFlat += -v;
      // 자신의 방어력·저항 증가는 피해와 무관
      else if ((k === "def" || k === "magic_resistance") && v >= 0) continue;
      else if (!HANDLED.has(k) && !IGNORE.has(k) && !IGNORE.has(raw)) partial.push(raw);
    }
    if (fx?.times != null) sm.times = num(fx.times, sm.times);
    if (fx?.interval != null) sm.batAdd = num(fx.interval, st.bat) - st.bat;
    burstAtkPct = sm.atkPct;
    if (fx?.atk != null) sm.atkPct += num(fx.atk, 0);
    if (fx?.scale != null) sm.scale = num(fx.scale, sm.scale);
    if (fx?.targets != null) sm.targets = fx.targets === "aoe" ? 99 : num(fx.targets, sm.targets);
  }
  const skillDmg: AnyDmg = b.dmg !== "auto" ? b.dmg : fx?.dmg ?? dmg;
  const skillLine = (m: Mods): Line => {
    if (skillDmg === dmg) return line(m);
    // 스킬 중 피해 유형이 다르면 그 유형으로 다시 센다
    const atk = st.atk * (1 + m.atkPct);
    const aspd = clamp(st.aspd + m.aspd, 10, 600);
    const interval = (st.bat + m.batAdd) / (aspd / 100);
    const e = { def: Math.max(0, enemy.def * (1 - m.defPct) - m.defFlat), res: Math.max(0, enemy.res * (1 - m.resPct) - m.resFlat) };
    const hit = (hitDmg(atk, m.scale * traitScale, skillDmg, e) + (append ? hitDmg(atk, m.scale * traitScale * append, skillDmg, e) : 0)) * m.times;
    const targets = rule.aoe || m.targets >= 99 ? N : Math.min(N, m.targets);
    return { hit, interval, aspd, targets, dps1: hit / interval, dpsN: (hit * targets) / interval };
  };
  // 패시브 스킬은 늘 켜져 있다 — 피해 유형 보정까지 평타에 (전수조사 2026-10-17: 우타게 S2 마법 전환이 안 먹었다)
  const normal = sk?.t === 2 && sm ? skillLine(sm) : line(plain);
  if (!sk || !L || !sm || sk.t === 2)
    return { kind: "ok", dmg, atk: st.atk, normal, skill: null, dur: 0, ammo: 0, ammoTotal: 0, burst: 0, open1: 0, openN: 0, eff1: normal.dps1, effN: normal.dpsN, total1: 0, totalN: 0, charge: null, avg1: null, avgN: null, partial, subNote: rule.partial };

  const skill0 = skillLine(sm!);
  const skill = fx?.noAttack ? { ...skill0, hit: 0, dps1: 0, dpsN: 0 } : sm.targets >= 99 && !rule.aoe ? { ...skill0, targets: N, dpsN: skill0.hit * N / skill0.interval } : skill0;
  // 발동 피해 — 스킬 공격력(공격력 % 포함)으로 한 번
  let open1 = 0, openN = 0;
  if (fx?.burst) {
    const bt = fx.burst;
    const e = { def: Math.max(0, enemy.def * (1 - sm.defPct) - sm.defFlat), res: Math.max(0, enemy.res * (1 - sm.resPct) - sm.resFlat) };
    const one = hitDmg(st.atk * (1 + burstAtkPct), num(bt.scale, 1), bt.dmg ?? skillDmg, e) * num(bt.hits, 1);
    const tg = bt.targets === "aoe" ? N : Math.min(N, num(bt.targets, 1));
    open1 = one; openN = one * tg;
  }
  const ammoTotal = ammo;
  const [spType, spCost] = L.sp;
  // 지속 — 탄약형은 탄약 수 × 스킬 중 공격 간격 (한 번 공격에 탄약 1발)
  let dur = fx?.dur != null ? num(fx.dur, L.d) : L.d;
  if (sk.am && ammo > 0) { ammo = Math.ceil(ammo / (sk.ap ?? 1)); dur = ammo * skill.interval; }   // ammo = 공격 횟수
  else if (dur < 0) dur = Infinity;
  let burst = 0, total1 = 0, totalN = 0;
  if (dur === 0) {   // 한 방짜리 — 다음 공격 한 번이 강화된다
    burst = skill.hit;
    total1 = skill.hit; totalN = skill.hit * skill.targets;
  } else if (Number.isFinite(dur)) {
    total1 = skill.dps1 * dur; totalN = skill.dpsN * dur;
  }
  total1 += open1; totalN += openN;
  // 발동 피해까지 넣은 DPS — 지속이 있으면 (발동 + 공격) ÷ 지속, 한 방·무한이면 공격 DPS
  const eff1 = open1 && dur > 0 && Number.isFinite(dur) ? total1 / dur : skill.dps1;
  const effN = openN && dur > 0 && Number.isFinite(dur) ? totalN / dur : skill.dpsN;
  // 충전 — 시간 충전은 초당 1 SP(스킬 중엔 안 찬다) · 공격 충전은 평타 횟수 · 피격 충전은 셀 수 없다
  const charge = spType === 0 ? spCost : spType === 1 ? spCost * normal.interval : null;
  let avg1: number | null = null, avgN: number | null = null;
  if (dur === Infinity) { avg1 = skill.dps1; avgN = skill.dpsN; }
  else if (charge != null) {
    if (dur === 0 && spType === 1) {
      // 공격 충전 한 방짜리 — spCost 번 평타 뒤 한 번은 스킬 공격
      const cyc = (spCost + 1) * normal.interval;
      avg1 = (spCost * normal.hit + skill.hit) / cyc;
      avgN = (spCost * normal.hit * normal.targets + skill.hit * skill.targets) / cyc;
    } else {
      const cyc = charge + dur;
      avg1 = cyc > 0 ? (normal.dps1 * charge + total1) / cyc : null;
      avgN = cyc > 0 ? (normal.dpsN * charge + totalN) / cyc : null;
    }
  }
  return { kind: "ok", dmg, atk: st.atk, normal, skill, dur, ammo, ammoTotal, burst, open1, openN, eff1, effN, total1, totalN, charge, avg1, avgN,
    partial, subNote: rule.partial, fxNote: fx?.note };
}
