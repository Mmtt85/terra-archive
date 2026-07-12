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

// 243 layout: gold ×2 + battle-record ×2 factories, the common daily setup
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

// facilities that count for cross-facility token generators (not dorms)
const PARK_KEYS = ["WORKSHOP", "TRAINING"];

type Ctx = { product?: string; tokenPoints: Record<string, number> };

function skillApplies(skill: InfraSkill, room: string, product?: string): boolean {
  if (skill.room !== room) return false;
  if (room === "MANUFACTURE" && product && skill.product !== "any" && skill.product !== product) return false;
  return true;
}

function skillValue(skill: InfraSkill, room: string, ctx: Ctx): number {
  let v = skill.kind === "override" ? 0 : skill.value;
  for (const use of skill.tokenUse) {
    if (!use.percent) continue;
    const points = ctx.tokenPoints[use.token] ?? 0;
    v += (points / use.per) * use.value;
  }
  if (room === "DORMITORY") return skill.kind === "morale" ? skill.value * 100 : 0;
  return v;
}

function contribution(op: InfraOp, room: string, teamIds: Set<string>, ctx: Ctx): { value: number; skill: InfraSkill | null } {
  let best = 0;
  let bestSkill: InfraSkill | null = null;
  for (const skill of op.skills) {
    if (!skillApplies(skill, room, ctx.product)) continue;
    if (skill.partners.length > 0 && !skill.partners.every((p) => teamIds.has(p))) continue;
    const v = skillValue(skill, room, ctx);
    if (v >= best) { best = v; bestSkill = skill; }
  }
  return { value: best, skill: bestSkill };
}

function overrideValue(op: InfraOp, room: string): number {
  let best = 0;
  for (const skill of op.skills) if (skill.room === room && skill.kind === "override") best = Math.max(best, skill.value);
  return best;
}

function qualityValue(op: InfraOp, room: string): number {
  let best = 0;
  for (const skill of op.skills) if (skill.room === room && skill.kind === "quality") best = Math.max(best, skill.value);
  return best;
}

function teamScore(team: InfraOp[], room: string, ctx: Ctx): number {
  const ids = new Set(team.map((op) => op.id));
  const quality = team.reduce((sum, op) => sum + qualityValue(op, room), 0);
  const override = Math.max(...team.map((op) => overrideValue(op, room)), 0);
  // an override skill (샤마르) zeroes everyone's own efficiency and applies
  // its flat rate per member instead — never both
  const efficiency = override > 0 ? override * team.length : team.reduce((sum, op) => sum + contribution(op, room, ids, ctx).value, 0);
  return efficiency + quality;
}

function bestTeam(room: string, slots: number, pool: Map<string, InfraOp>, ctx: Ctx, seedOps: InfraOp[] = []): InfraOp[] {
  const cands = Array.from(pool.values()).filter((op) => op.skills.some((skill) => skillApplies(skill, room, ctx.product) || (room === "TRADING" && skill.room === room)));
  const solo = cands
    .map((op) => ({ op, v: contribution(op, room, new Set([op.id]), ctx).value + qualityValue(op, room) + overrideValue(op, room) * slots }))
    .sort((a, b) => b.v - a.v);
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

function buildPlan(shiftCount: number, packageToken: string | null): Plan {
  const assignments: Record<string, string[][]> = {};
  const used = new Set<string>();
  const keys = [...PRODUCTION_KEYS, ...SUPPORT_KEYS];
  for (const key of keys) assignments[key] = [];
  let tokenPoints: Record<string, number> = {};

  for (let shift = 0; shift < shiftCount; shift += 1) {
    const seeds: Record<string, InfraOp[]> = {};
    if (shift === 0 && packageToken) {
      // pre-place the package: generators & consumers into their rooms,
      // remaining family members parked in workshop/training so that
      // per-member counters (총웨) actually reach their cap
      let points = 0;
      const parked = new Set<string>();
      const place = (op: InfraOp, key: string) => {
        seeds[key] = seeds[key] ?? [];
        const slots = infra.rooms[cellByKey.get(key)?.room ?? key]?.slots ?? 1;
        if (seeds[key].length >= slots || seeds[key].includes(op) || parked.has(op.id)) return false;
        seeds[key].push(op);
        parked.add(op.id);
        return true;
      };
      const members = ops.filter((op) => !used.has(op.id) && op.skills.some((skill) => skill.tokenGen.some((g) => g.token === packageToken) || skill.tokenUse.some((u) => u.token === packageToken)));
      // consumers with % output first (they convert points into production)
      for (const op of members) {
        for (const skill of op.skills) {
          if (!skill.tokenUse.some((u) => u.token === packageToken && u.percent)) continue;
          const targets = LAYOUT.filter((cell) => cell.room === skill.room && !PARK_KEYS.includes(cell.key));
          for (const cell of targets) if (place(op, cell.key)) break;
        }
      }
      // then generators
      for (const op of members) {
        for (const skill of op.skills) {
          const gen = skill.tokenGen.filter((g) => g.token === packageToken);
          if (!gen.length) continue;
          const targets = LAYOUT.filter((cell) => cell.room === skill.room);
          for (const cell of targets) {
            if (place(op, cell.key)) { points += gen.reduce((s, g) => s + g.estimate, 0); break; }
          }
        }
      }
      // park leftover family members (they feed per-member counters)
      for (const op of members) {
        if (parked.has(op.id)) continue;
        for (const key of PARK_KEYS) if (place(op, key)) break;
      }
      tokenPoints = { [packageToken]: points };
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
  // dorms stay empty in the plan: they are pinned rest space for off-shift
  // crews and don't participate in shift switching
  for (let d = 0; d < 4; d += 1) assignments[`DORM-${d}`] = [[]];
  return { assignments, tokenPoints, strategy: packageToken ? `${packageToken} 패키지` : "기본 편성" };
}

function planScore(plan: Plan): number {
  let score = 0;
  for (const key of PRODUCTION_KEYS) {
    const team = (plan.assignments[key]?.[0] ?? []).map((id) => opById.get(id)).filter(Boolean) as InfraOp[];
    score += teamScore(team, cellByKey.get(key)!.room, ctxFor(key, plan.tokenPoints));
  }
  for (const key of ["MEETING", "HIRE"]) {
    const team = (plan.assignments[key]?.[0] ?? []).map((id) => opById.get(id)).filter(Boolean) as InfraOp[];
    score += 0.3 * teamScore(team, key, ctxFor(key, plan.tokenPoints));
  }
  const control = (plan.assignments["CONTROL"]?.[0] ?? []).map((id) => opById.get(id)).filter(Boolean) as InfraOp[];
  score += 0.5 * teamScore(control, "CONTROL", ctxFor("CONTROL", plan.tokenPoints));
  return score;
}

function optimize(shiftCount: number): Plan {
  const packageTokens = new Set<string>();
  for (const op of ops) for (const skill of op.skills) for (const use of skill.tokenUse) if (use.percent) packageTokens.add(use.token);
  let best = buildPlan(shiftCount, null);
  let bestScore = planScore(best);
  for (const token of packageTokens) {
    const plan = buildPlan(shiftCount, token);
    const score = planScore(plan);
    if (score > bestScore) { best = plan; bestScore = score; }
  }
  return best;
}

function substitutes(key: string, tokenPoints: Record<string, number>, excluded: Set<string>, count = 3): { op: InfraOp; value: number }[] {
  const room = cellByKey.get(key)?.room ?? key;
  const ctx = ctxFor(key, tokenPoints);
  return ops
    .filter((op) => !excluded.has(op.id) && op.skills.some((skill) => skillApplies(skill, room, ctx.product)))
    .map((op) => ({ op, value: Math.round(contribution(op, room, new Set([op.id]), ctx).value + qualityValue(op, room)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}

export default function InfraPlanner() {
  const [shiftMode, setShiftMode] = useState<2 | 3>(2);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [activeShift, setActiveShift] = useState(0);
  const [openRoom, setOpenRoom] = useState<string | null>(null);

  const allAssigned = useMemo(() => {
    const set = new Set<string>();
    if (plan) for (const shifts of Object.values(plan.assignments)) for (const team of shifts) for (const id of team) set.add(id);
    return set;
  }, [plan]);

  const runOptimize = (mode: 2 | 3) => {
    setShiftMode(mode);
    setPlan(optimize(mode));
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
      swaps: shiftMode === 2 ? "12시간 2조 · 하루 1회 편한 교대" : "8시간 3조 · 하루 3~4회 빡센 교대",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, activeShift, shiftMode, allAssigned]);

  const openCell = LAYOUT.find((cell) => cell.key === openRoom);

  return (
    <section className="planner">
      <div className="planner-controls">
        <div>
          <span className="section-no">RIIC / 243 · 순금 2 + 작전기록 2</span>
          <h2>인프라 배치 최적화</h2>
        </div>
        <div className="planner-buttons">
          <button className={shiftMode === 2 && plan ? "primary" : ""} onClick={() => runOptimize(2)}>편한 교대 자동 편성 (2조)</button>
          <button className={shiftMode === 3 && plan ? "primary" : ""} onClick={() => runOptimize(3)}>빡센 교대 자동 편성 (3조)</button>
        </div>
      </div>

      {summary && (
        <div className="planner-summary">
          <div><span>전략</span><b className="strategy">{summary.strategy}{plan && Object.keys(plan.tokenPoints).length > 0 && ` · ${Object.entries(plan.tokenPoints).map(([token, points]) => `${token} ${Math.round(points)}점`).join(", ")}`}</b></div>
          <div><span>제조소 평균</span><b>+{summary.manufacture}%</b></div>
          <div><span>무역소 평균</span><b>+{summary.trading}%</b></div>
          <div><span>발전소 평균</span><b>+{summary.power}%</b></div>
          <div><span>기용 인원</span><b>{summary.staffed}명</b></div>
          <div className="wide"><span>교대 플랜</span><b>{summary.swaps}</b></div>
        </div>
      )}

      {plan && (
        <div className="shift-tabs">
          {Array.from({ length: shiftMode }, (_, i) => (
            <button key={i} className={activeShift === i ? "selected" : ""} onClick={() => setActiveShift(i)}>{["A조", "B조", "C조"][i]}</button>
          ))}
          <span className="shift-hint">패키지 시너지는 A조 기준 · 숙소는 고정 휴식 공간</span>
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

      <aside className="data-note"><span>PLANNER NOTE</span><p>클뜯 데이터에서 파싱한 스킬 수치·파트너 시너지·시설 간 포인트 시스템(속세의 화식 등)·오더 품질 효과를 근거로 기본 편성과 패키지 전략을 비교해 더 좋은 쪽을 채택합니다. 제조소는 순금 2 + 작전기록 2 기준이고, 가공소·훈련실은 효율 대신 세트 인원 주차용으로 씁니다. 조건부·누적 버프는 추정 상한 기준의 근사치입니다.</p></aside>

      {openCell && plan && (
        <RoomModal
          cell={openCell}
          shiftMode={shiftMode}
          plan={plan}
          allAssigned={allAssigned}
          onClose={() => setOpenRoom(null)}
        />
      )}
    </section>
  );
}

function RoomModal({ cell, shiftMode, plan, allAssigned, onClose }: { cell: { key: string; room: string; label: string; product?: string }; shiftMode: number; plan: Plan; allAssigned: Set<string>; onClose: () => void }) {
  const [shift, setShift] = useState(0);
  const isDorm = cell.room === "DORMITORY";
  const shiftIndex = isDorm ? 0 : Math.min(shift, (plan.assignments[cell.key]?.length ?? 1) - 1);
  const team = (plan.assignments[cell.key]?.[shiftIndex] ?? []).map((id) => opById.get(id)).filter(Boolean) as InfraOp[];
  const teamIds = new Set(team.map((op) => op.id));
  const ctx = ctxFor(cell.key, shiftIndex === 0 ? plan.tokenPoints : {});
  const subs = substitutes(cell.key, shiftIndex === 0 ? plan.tokenPoints : {}, new Set([...allAssigned, ...teamIds]));

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">×</button>
        <header className="room-modal-head">
          <span className="modal-kicker">FACILITY FILE · {cell.room}</span>
          <h2>{cell.label}</h2>
          {!isDorm && (
            <div className="shift-tabs in-modal">
              {Array.from({ length: shiftMode }, (_, i) => (
                <button key={i} className={shift === i ? "selected" : ""} onClick={() => setShift(i)}>{["A조", "B조", "C조"][i]}</button>
              ))}
            </div>
          )}
        </header>
        <div className="modal-scroll">
          <section className="detail-section">
            <span className="detail-no">CREW / 01</span>
            <h3>편성 ({team.length}/{infra.rooms[cell.room]?.slots ?? 1})</h3>
            <div className="crew-list">
              {team.map((op) => {
                const { value, skill } = contribution(op, cell.room, teamIds, ctx);
                const quality = qualityValue(op, cell.room);
                const shown = skill ?? op.skills.find((candidate) => candidate.room === cell.room) ?? null;
                return (
                  <article key={op.id} className="crew-card">
                    <img src={op.image} alt={op.name} loading="lazy" />
                    <div>
                      <b>{op.name} <i>{"★".repeat(op.rarity)}</i></b>
                      {shown ? <p><em>{shown.name}</em> — {shown.description}</p> : <p>이 시설에 적용되는 스킬이 없습니다 (세트 대기 요원).</p>}
                      {cell.room !== "DORMITORY" && (value > 0 || quality > 0) && <small>기여 +{Math.round(value + quality)}{cell.room === "CONTROL" ? "" : "%"}</small>}
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
                const skill = op.skills.find((candidate) => skillApplies(candidate, cell.room, cell.product));
                return (
                  <article key={op.id} className="crew-card sub">
                    <img src={op.image} alt={op.name} loading="lazy" />
                    <div>
                      <b>{op.name} <i>{"★".repeat(op.rarity)}</i></b>
                      {skill && <p><em>{skill.name}</em> — {skill.description}</p>}
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
