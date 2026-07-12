"use client";

import { useMemo, useState } from "react";
import infraData from "./data/infra.json";

type TokenGen = { token: string; estimate: number };
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
  conditional: boolean;
};

type InfraOp = {
  id: string;
  name: string;
  rarity: number;
  faction: string;
  accent: string;
  image: string;
  skills: InfraSkill[];
};

type RoomSpec = { name: string; slots: number; electricity: number; maxCount: number };

const infra = infraData as { rooms: Record<string, RoomSpec>; ops: InfraOp[] };
const ops = infra.ops;
const opById = new Map(ops.map((op) => [op.id, op]));

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

const PARK_KEYS = ["WORKSHOP", "TRAINING"];
const SHIFT_COUNT = 2;

type Ctx = { product?: string; tokenPoints: Record<string, number> };

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
  quality: number;      // quality-order probability (equiv %)
  payout: number;       // per-order payout bonus (scales with quality crew)
  override: number;     // 샤마르: flat rate replacing everyone's efficiency
  perCoworker: number;  // +x% per other member
  skills: InfraSkill[];
};

function breakdown(op: InfraOp, room: string, teamIds: Set<string>, ctx: Ctx): OpBreakdown {
  const out: OpBreakdown = { efficiency: 0, quality: 0, payout: 0, override: 0, perCoworker: 0, skills: [] };
  const tokenRates = new Map<string, number>();
  for (const skill of activeSkills(op, room, ctx.product)) {
    if (skill.partners.length > 0 && !skill.partners.every((p) => teamIds.has(p))) continue;
    out.skills.push(skill);
    const percentUses = skill.tokenUse.filter((use) => use.percent);
    for (const use of percentUses) {
      const rate = use.value / use.per;
      if (rate > (tokenRates.get(use.token) ?? 0)) tokenRates.set(use.token, rate);
    }
    if (skill.kind === "override") { out.override = Math.max(out.override, skill.value); continue; }
    if (skill.kind === "quality") { out.quality += skill.value; continue; }
    if (skill.kind === "payout") { out.payout += skill.value; continue; }
    if (skill.kind === "percoworker") { out.perCoworker += skill.value; continue; }
    if (room === "DORMITORY") continue;
    if (percentUses.length === 0) out.efficiency += skill.value;
  }
  for (const [token, rate] of tokenRates) out.efficiency += (ctx.tokenPoints[token] ?? 0) * rate;
  return out;
}

function teamScore(team: InfraOp[], room: string, ctx: Ctx): number {
  const ids = new Set(team.map((op) => op.id));
  const parts = team.map((op) => breakdown(op, room, ids, ctx));
  const override = Math.max(...parts.map((p) => p.override), 0);
  const additive = parts.reduce((sum, p) => sum + p.efficiency + p.perCoworker * (team.length - 1), 0);
  // an override (샤마르) zeroes everyone's own efficiency, flat rate per member instead
  const efficiency = override > 0 ? override * team.length : additive;
  const probCount = parts.filter((p) => p.quality > 0).length;
  const quality = parts.reduce((sum, p) => sum + p.quality, 0);
  // payout skills (테킬라/프로바이조) profit from quality orders showing up more often
  const payout = parts.reduce((sum, p) => sum + p.payout, 0) * Math.min(1 + 0.5 * probCount, 2);
  return efficiency + quality + payout;
}

function opSolo(op: InfraOp, room: string, slots: number, ctx: Ctx): number {
  const b = breakdown(op, room, new Set([op.id]), ctx);
  return b.efficiency + b.quality + b.payout + b.override * slots + b.perCoworker * (slots - 1);
}

function bestTeam(room: string, slots: number, pool: Map<string, InfraOp>, ctx: Ctx, seedOps: InfraOp[] = []): InfraOp[] {
  const cands = Array.from(pool.values()).filter((op) => op.skills.some((skill) => skillApplies(skill, room, ctx.product)));
  const solo = cands.map((op) => ({ op, v: opSolo(op, room, slots, ctx) })).sort((a, b) => b.v - a.v);
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

type Plan = {
  assignments: Record<string, string[][]>; // roomKey -> shift -> opIds
  tokenPoints: Record<string, number>;
  strategy: string;
};

const PRODUCTION_KEYS = ["TRADING-0", "TRADING-1", "MANUFACTURE-0", "MANUFACTURE-1", "MANUFACTURE-2", "MANUFACTURE-3", "POWER-0", "POWER-1", "POWER-2"];
const SUPPORT_KEYS = ["CONTROL", "MEETING", "HIRE", "WORKSHOP", "TRAINING"];

function ctxFor(key: string, tokenPoints: Record<string, number>): Ctx {
  return { product: cellByKey.get(key)?.product, tokenPoints };
}

function buildPlan(packageTokens: string[]): Plan {
  const assignments: Record<string, string[][]> = {};
  const used = new Set<string>();
  const keys = [...PRODUCTION_KEYS, ...SUPPORT_KEYS];
  for (const key of keys) assignments[key] = [];
  const tokenPoints: Record<string, number> = {};

  for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
    const seeds: Record<string, InfraOp[]> = {};
    if (shift === 0 && packageTokens.length) {
      const parked = new Set<string>();
      const place = (op: InfraOp, key: string) => {
        seeds[key] = seeds[key] ?? [];
        const slots = infra.rooms[cellByKey.get(key)?.room ?? key]?.slots ?? 1;
        if (seeds[key].length >= slots || parked.has(op.id)) return false;
        seeds[key].push(op);
        parked.add(op.id);
        return true;
      };
      for (const token of packageTokens) {
        const members = ops.filter((op) => !used.has(op.id) && op.skills.some((skill) => skill.tokenGen.some((g) => g.token === token) || skill.tokenUse.some((u) => u.token === token)));
        // consumers first (they convert points into production), then generators,
        // then park leftover family members to feed per-member counters
        for (const op of members) {
          for (const skill of op.skills) {
            if (!skill.tokenUse.some((u) => u.token === token && u.percent)) continue;
            for (const cell of LAYOUT.filter((c) => c.room === skill.room && !PARK_KEYS.includes(c.key))) if (place(op, cell.key)) break;
          }
        }
        for (const op of members) {
          for (const skill of op.skills) {
            const gen = skill.tokenGen.filter((g) => g.token === token);
            if (!gen.length) continue;
            const already = parked.has(op.id);
            if (already || LAYOUT.filter((c) => c.room === skill.room).some((cell) => place(op, cell.key))) {
              tokenPoints[token] = (tokenPoints[token] ?? 0) + gen.reduce((s, g) => s + g.estimate, 0);
              break;
            }
          }
        }
        for (const op of members) {
          if (parked.has(op.id)) continue;
          for (const key of PARK_KEYS) if (place(op, key)) break;
        }
      }
    }
    for (const key of keys) {
      const room = cellByKey.get(key)?.room ?? key;
      const slots = infra.rooms[room]?.slots ?? 1;
      const pool = new Map(ops.filter((op) => !used.has(op.id)).map((op) => [op.id, op]));
      const ctx = ctxFor(key, shift === 0 ? tokenPoints : {});
      const seed = (seeds[key] ?? []).filter((op) => pool.has(op.id));
      const team = bestTeam(room, slots, pool, ctx, seed);
      team.forEach((op) => used.add(op.id));
      assignments[key].push(team.map((op) => op.id));
    }
  }
  // dorms: pinned rest space for the off-shift crew, unaffected by switching
  for (let d = 0; d < 4; d += 1) assignments[`DORM-${d}`] = [[]];
  const strategy = packageTokens.length ? `${packageTokens.join(" + ")} 패키지` : "기본 편성";
  return { assignments, tokenPoints, strategy };
}

function planScore(plan: Plan): number {
  let score = 0;
  const teamOf = (key: string) => (plan.assignments[key]?.[0] ?? []).map((id) => opById.get(id)).filter(Boolean) as InfraOp[];
  for (const key of PRODUCTION_KEYS) score += teamScore(teamOf(key), cellByKey.get(key)!.room, ctxFor(key, plan.tokenPoints));
  for (const key of ["MEETING", "HIRE"]) score += 0.3 * teamScore(teamOf(key), key, ctxFor(key, plan.tokenPoints));
  score += 0.5 * teamScore(teamOf("CONTROL"), "CONTROL", ctxFor("CONTROL", plan.tokenPoints));
  return score;
}

function optimize(): Plan {
  const allTokens = new Set<string>();
  for (const op of ops) for (const skill of op.skills) for (const use of skill.tokenUse) if (use.percent) allTokens.add(use.token);
  let chosen: string[] = [];
  let best = buildPlan(chosen);
  let bestScore = planScore(best);
  // greedily stack token packages while they keep improving the whole base
  let improved = true;
  while (improved) {
    improved = false;
    for (const token of allTokens) {
      if (chosen.includes(token)) continue;
      const plan = buildPlan([...chosen, token]);
      const score = planScore(plan);
      if (score > bestScore) { best = plan; bestScore = score; chosen = [...chosen, token]; improved = true; }
    }
  }
  return best;
}

function substitutes(key: string, tokenPoints: Record<string, number>, excluded: Set<string>, count = 3): { op: InfraOp; value: number }[] {
  const room = cellByKey.get(key)?.room ?? key;
  const ctx = ctxFor(key, tokenPoints);
  const slots = infra.rooms[room]?.slots ?? 1;
  return ops
    .filter((op) => !excluded.has(op.id) && op.skills.some((skill) => skillApplies(skill, room, ctx.product)))
    .map((op) => ({ op, value: Math.round(opSolo(op, room, slots, ctx)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}

export default function InfraPlanner() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [activeShift, setActiveShift] = useState(0);
  const [openRoom, setOpenRoom] = useState<string | null>(null);

  const allAssigned = useMemo(() => {
    const set = new Set<string>();
    if (plan) for (const shifts of Object.values(plan.assignments)) for (const team of shifts) for (const id of team) set.add(id);
    return set;
  }, [plan]);

  const runOptimize = () => {
    setPlan(optimize());
    setActiveShift(0);
  };

  const teamFor = (key: string, shift: number): InfraOp[] => {
    const shifts = plan?.assignments[key] ?? [];
    const team = shifts[Math.min(shift, shifts.length - 1)] ?? [];
    return team.map((id) => opById.get(id)).filter(Boolean) as InfraOp[];
  };

  const pointsFor = (shift: number) => (shift === 0 && plan ? plan.tokenPoints : {});

  const summary = useMemo(() => {
    if (!plan) return null;
    const avg = (prefix: string) => {
      const keys = LAYOUT.filter((cell) => cell.key.startsWith(prefix)).map((cell) => cell.key);
      const totals = keys.map((key) => teamScore(teamFor(key, activeShift), cellByKey.get(key)!.room, ctxFor(key, pointsFor(activeShift))));
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
          <button className={plan ? "primary" : ""} onClick={runOptimize}>자동 편성 실행</button>
        </div>
      </div>

      {summary && (
        <div className="planner-summary">
          <div><span>전략</span><b className="strategy">{summary.strategy}{plan && Object.keys(plan.tokenPoints).length > 0 && ` · ${Object.entries(plan.tokenPoints).map(([token, points]) => `${token} ${Math.round(points)}점`).join(" · ")}`}</b></div>
          <div><span>제조소 평균</span><b>+{summary.manufacture}%</b></div>
          <div><span>무역소 평균</span><b>+{summary.trading}%</b></div>
          <div><span>발전소 평균</span><b>+{summary.power}%</b></div>
          <div><span>기용 인원</span><b>{summary.staffed}명</b></div>
        </div>
      )}

      {plan && (
        <div className="shift-tabs">
          {Array.from({ length: SHIFT_COUNT }, (_, i) => (
            <button key={i} className={activeShift === i ? "selected" : ""} onClick={() => setActiveShift(i)}>{["A조", "B조"][i]}</button>
          ))}
          <span className="shift-hint">하루 1회 교대 · 패키지 시너지는 A조 기준 · 숙소는 고정 휴식 공간</span>
        </div>
      )}

      <div className="ship">
        {LAYOUT.map((cell) => {
          if (cell.room === "DORMITORY") {
            return (
              <div key={cell.key} className={`ship-room dorm-room pos-${cell.key.toLowerCase()}`} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
                <div className="ship-room-head"><b>{cell.label}</b><span>고정</span></div>
                <div className="ship-room-crew"><i>휴식 공간 · 조 전환과 무관</i></div>
              </div>
            );
          }
          const team = teamFor(cell.key, activeShift);
          const spec = infra.rooms[cell.room];
          const score = Math.round(teamScore(team, cell.room, ctxFor(cell.key, pointsFor(activeShift))));
          return (
            <button key={cell.key} type="button" className={`ship-room pos-${cell.key.toLowerCase()}`} onClick={() => setOpenRoom(cell.key)} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
              <div className="ship-room-head">
                <b>{cell.label}</b>
                <span>{team.length}/{spec?.slots ?? 1}</span>
              </div>
              <div className="ship-room-crew">
                {team.length ? team.map((op) => (
                  <img key={op.id} src={op.image} alt={op.name} title={op.name} loading="lazy" />
                )) : <i>{plan ? "비어 있음" : "자동 편성 대기"}</i>}
              </div>
              {plan && team.length > 0 && !PARK_KEYS.includes(cell.key) && (
                <small>+{score}{cell.room === "CONTROL" ? "" : "%"} {UNIT[cell.room]}</small>
              )}
              {plan && PARK_KEYS.includes(cell.key) && team.length > 0 && <small>세트 요원 대기 · 효율 무관</small>}
            </button>
          );
        })}
      </div>

      <aside className="data-note"><span>PLANNER NOTE</span><p>오퍼레이터의 모든 인프라 스킬을 동시에 적용하고(α/β는 상위 티어만), 시설 간 포인트 시스템(속세의 화식·무성의 공명 등)을 겹쳐 쌓을 수 있을 때까지 패키지로 조합합니다. 고품질 귀금속 오더 확률(샤마르·카프카·디아만테·바이비크)과 오더당 수익(테킬라·프로바이조)의 상호작용, 샤마르의 효율 대체를 반영합니다. 조건부·누적 버프는 추정 상한 기준 근사치입니다.</p></aside>

      {openCell && plan && (
        <RoomModal
          cell={openCell}
          plan={plan}
          allAssigned={allAssigned}
          onClose={() => setOpenRoom(null)}
        />
      )}
    </section>
  );
}

function RoomModal({ cell, plan, allAssigned, onClose }: { cell: { key: string; room: string; label: string; product?: string }; plan: Plan; allAssigned: Set<string>; onClose: () => void }) {
  const [shift, setShift] = useState(0);
  const shiftIndex = Math.min(shift, (plan.assignments[cell.key]?.length ?? 1) - 1);
  const team = (plan.assignments[cell.key]?.[shiftIndex] ?? []).map((id) => opById.get(id)).filter(Boolean) as InfraOp[];
  const teamIds = new Set(team.map((op) => op.id));
  const points = shiftIndex === 0 ? plan.tokenPoints : {};
  const ctx = ctxFor(cell.key, points);
  const subs = substitutes(cell.key, points, new Set([...allAssigned, ...teamIds]));

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
          </div>
        </header>
        <div className="modal-scroll">
          <section className="detail-section">
            <span className="detail-no">CREW / 01</span>
            <h3>편성 ({team.length}/{infra.rooms[cell.room]?.slots ?? 1})</h3>
            <div className="crew-list">
              {team.map((op) => {
                const b = breakdown(op, cell.room, teamIds, ctx);
                const total = Math.round(b.efficiency + b.quality + b.payout + (b.override > 0 ? b.override : 0) + b.perCoworker * (team.length - 1));
                const shown = b.skills.length ? b.skills : op.skills.filter((skill) => skill.room === cell.room);
                return (
                  <article key={op.id} className="crew-card">
                    <img src={op.image} alt={op.name} loading="lazy" />
                    <div>
                      <b>{op.name} <i>{"★".repeat(op.rarity)}</i></b>
                      {shown.length ? shown.map((skill) => <p key={skill.name}><em>{skill.name}</em> — {skill.description}</p>) : <p>이 시설에 적용되는 스킬이 없습니다 (세트 대기 요원).</p>}
                      {total > 0 && <small>기여 +{total}{cell.room === "CONTROL" ? "" : "%"}</small>}
                    </div>
                  </article>
                );
              })}
              {team.length === 0 && <p className="no-detail">자동 편성을 먼저 실행해 주세요.</p>}
            </div>
          </section>

          <section className="detail-section">
            <span className="detail-no">SUBSTITUTE / 02</span>
            <h3>대체 오퍼레이터 추천</h3>
            <p className="sub-hint">위 편성 오퍼레이터가 없다면, 아직 어디에도 기용되지 않은 차순위 오퍼레이터입니다.</p>
            <div className="crew-list">
              {subs.map(({ op, value }) => {
                const skills = activeSkills(op, cell.room, cell.product);
                return (
                  <article key={op.id} className="crew-card sub">
                    <img src={op.image} alt={op.name} loading="lazy" />
                    <div>
                      <b>{op.name} <i>{"★".repeat(op.rarity)}</i></b>
                      {skills.map((skill) => <p key={skill.name}><em>{skill.name}</em> — {skill.description}</p>)}
                      <small>단독 기여 +{value}{cell.room === "CONTROL" ? "" : "%"}</small>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
