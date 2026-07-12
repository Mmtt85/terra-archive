"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import infraData from "../data/infra.json";

type InfraSkill = {
  name: string;
  room: string;
  unlock: string;
  description: string;
  kind: string;
  value: number;
  moraleDrain: number;
  partners: string[];
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

// 243 layout — the standard fully-upgraded Rhodes Island ship
const LAYOUT: { key: string; room: string; label: string }[] = [
  { key: "TRADING-0", room: "TRADING", label: "무역소 1" },
  { key: "TRADING-1", room: "TRADING", label: "무역소 2" },
  { key: "MANUFACTURE-0", room: "MANUFACTURE", label: "제조소 1" },
  { key: "MANUFACTURE-1", room: "MANUFACTURE", label: "제조소 2" },
  { key: "MANUFACTURE-2", room: "MANUFACTURE", label: "제조소 3" },
  { key: "MANUFACTURE-3", room: "MANUFACTURE", label: "제조소 4" },
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

const ROOM_ACCENT: Record<string, string> = {
  TRADING: "#4d9dd6", MANUFACTURE: "#e0b13e", POWER: "#b7d940", CONTROL: "#dfff00",
  MEETING: "#8f7fc0", WORKSHOP: "#c78a54", HIRE: "#6fa08a", TRAINING: "#c05f6e", DORMITORY: "#7f8ea3",
};

const UNIT: Record<string, string> = {
  MANUFACTURE: "생산력", TRADING: "오더 효율", POWER: "무인기 회복", MEETING: "단서 속도",
  HIRE: "연락 속도", WORKSHOP: "부산물", TRAINING: "훈련 속도", CONTROL: "지원", DORMITORY: "회복",
};

function contribution(op: InfraOp, room: string, teamIds: Set<string>): { value: number; skill: InfraSkill | null } {
  let best = 0;
  let bestSkill: InfraSkill | null = null;
  for (const skill of op.skills) {
    if (skill.room !== room) continue;
    if (skill.partners.length > 0 && !skill.partners.every((p) => teamIds.has(p))) continue;
    const v = room === "DORMITORY" ? (skill.kind === "morale" ? skill.value * 100 : 0) : skill.value;
    if (v >= best) { best = v; bestSkill = skill; }
  }
  return { value: best, skill: bestSkill };
}

function teamScore(team: InfraOp[], room: string): number {
  const ids = new Set(team.map((op) => op.id));
  return team.reduce((sum, op) => sum + contribution(op, room, ids).value, 0);
}

function bestTeam(room: string, slots: number, pool: Map<string, InfraOp>): InfraOp[] {
  const cands = Array.from(pool.values()).filter((op) => op.skills.some((skill) => skill.room === room));
  const solo = cands
    .map((op) => ({ op, v: contribution(op, room, new Set([op.id])).value }))
    .sort((a, b) => b.v - a.v);
  const fill = (seed: InfraOp[]): InfraOp[] => {
    const team = [...seed];
    for (const { op } of solo) {
      if (team.length >= slots) break;
      if (!team.includes(op)) team.push(op);
    }
    return team.slice(0, slots);
  };
  let best = fill([]);
  let bestScore = teamScore(best, room);
  for (const cand of cands) {
    for (const skill of cand.skills) {
      if (skill.room !== room || skill.partners.length === 0) continue;
      const seed = [cand];
      let valid = true;
      for (const pid of skill.partners) {
        const partner = pool.get(pid);
        if (!partner) { valid = false; break; }
        if (!seed.includes(partner)) seed.push(partner);
      }
      if (!valid || seed.length > slots) continue;
      const team = fill(seed);
      const score = teamScore(team, room);
      if (score > bestScore) { best = team; bestScore = score; }
    }
  }
  return best;
}

type Assignments = Record<string, string[][]>; // roomKey -> shift -> opIds

function optimize(shiftCount: number): Assignments {
  const result: Assignments = {};
  const used = new Set<string>();
  const priority = ["TRADING-0", "TRADING-1", "MANUFACTURE-0", "MANUFACTURE-1", "MANUFACTURE-2", "MANUFACTURE-3",
    "POWER-0", "POWER-1", "POWER-2", "CONTROL", "MEETING", "HIRE", "WORKSHOP", "TRAINING"];
  for (const key of priority) result[key] = [];
  for (let shift = 0; shift < shiftCount; shift += 1) {
    for (const key of priority) {
      const room = key.split("-")[0] === "DORM" ? "DORMITORY" : key.split("-")[0];
      const slots = infra.rooms[room]?.slots ?? 1;
      const pool = new Map(ops.filter((op) => !used.has(op.id)).map((op) => [op.id, op]));
      const team = bestTeam(room, slots, pool);
      team.forEach((op) => used.add(op.id));
      result[key].push(team.map((op) => op.id));
    }
  }
  // dorms: one standing recovery specialist each (no shifts)
  for (let d = 0; d < 4; d += 1) {
    const pool = new Map(ops.filter((op) => !used.has(op.id)).map((op) => [op.id, op]));
    const team = bestTeam("DORMITORY", 1, pool);
    team.forEach((op) => used.add(op.id));
    result[`DORM-${d}`] = [team.map((op) => op.id)];
  }
  return result;
}

function substitutes(room: string, excluded: Set<string>, count = 3): { op: InfraOp; value: number }[] {
  return ops
    .filter((op) => !excluded.has(op.id) && op.skills.some((skill) => skill.room === room))
    .map((op) => ({ op, value: contribution(op, room, new Set([op.id])).value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}

export default function BasePlanner() {
  const [shiftMode, setShiftMode] = useState<2 | 3>(2);
  const [assignments, setAssignments] = useState<Assignments | null>(null);
  const [activeShift, setActiveShift] = useState(0);
  const [openRoom, setOpenRoom] = useState<string | null>(null);

  const allAssigned = useMemo(() => {
    const set = new Set<string>();
    if (assignments) for (const shifts of Object.values(assignments)) for (const team of shifts) for (const id of team) set.add(id);
    return set;
  }, [assignments]);

  const runOptimize = (mode: 2 | 3) => {
    setShiftMode(mode);
    setAssignments(optimize(mode));
    setActiveShift(0);
  };

  const teamFor = (key: string, shift: number): InfraOp[] => {
    const shifts = assignments?.[key] ?? [];
    const team = shifts[Math.min(shift, shifts.length - 1)] ?? [];
    return team.map((id) => opById.get(id)).filter(Boolean) as InfraOp[];
  };

  const summary = useMemo(() => {
    if (!assignments) return null;
    const avg = (roomPrefix: string, room: string) => {
      const keys = LAYOUT.filter((cell) => cell.key.startsWith(roomPrefix)).map((cell) => cell.key);
      const totals = keys.map((key) => teamScore(teamFor(key, activeShift), room));
      return totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0;
    };
    return {
      manufacture: avg("MANUFACTURE", "MANUFACTURE"),
      trading: avg("TRADING", "TRADING"),
      power: avg("POWER", "POWER"),
      staffed: allAssigned.size,
      swaps: shiftMode === 2 ? "12시간 2조 · 하루 1회 편한 교대" : "8시간 3조 · 하루 3~4회 빡센 교대",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, activeShift, shiftMode, allAssigned]);

  const openCell = LAYOUT.find((cell) => cell.key === openRoom);

  return (
    <main className="base-main">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="테라 아카이브 홈">
          <span className="brand-mark">TA</span>
          <span>테라 아카이브<small>인프라 플래너</small></span>
        </Link>
        <div className="header-tagline">함선을 <em>최대 효율</em>로 돌리기.</div>
        <div className="server-chip"><span /> RIIC PLANNER · BETA</div>
      </header>

      <section className="planner">
        <div className="planner-controls">
          <div>
            <span className="section-no">RIIC / 243 LAYOUT</span>
            <h2>인프라 배치 최적화</h2>
          </div>
          <div className="planner-buttons">
            <button className={shiftMode === 2 && assignments ? "primary" : ""} onClick={() => runOptimize(2)}>편한 교대 자동 편성 (2조)</button>
            <button className={shiftMode === 3 && assignments ? "primary" : ""} onClick={() => runOptimize(3)}>빡센 교대 자동 편성 (3조)</button>
          </div>
        </div>

        {summary && (
          <div className="planner-summary">
            <div><span>제조소 평균</span><b>+{summary.manufacture}%</b></div>
            <div><span>무역소 평균</span><b>+{summary.trading}%</b></div>
            <div><span>발전소 평균</span><b>+{summary.power}%</b></div>
            <div><span>기용 인원</span><b>{summary.staffed}명</b></div>
            <div className="wide"><span>교대 플랜</span><b>{summary.swaps}</b></div>
          </div>
        )}

        {assignments && (
          <div className="shift-tabs">
            {Array.from({ length: shiftMode }, (_, i) => (
              <button key={i} className={activeShift === i ? "selected" : ""} onClick={() => setActiveShift(i)}>{["A조", "B조", "C조"][i]}</button>
            ))}
            <span className="shift-hint">숙소 담당은 상주 편성입니다.</span>
          </div>
        )}

        <div className="ship">
          {LAYOUT.map((cell) => {
            const team = teamFor(cell.key, cell.room === "DORMITORY" ? 0 : activeShift);
            const spec = infra.rooms[cell.room];
            return (
              <button key={cell.key} type="button" className={`ship-room room-${cell.room.toLowerCase()} pos-${cell.key.toLowerCase()}`} onClick={() => setOpenRoom(cell.key)} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
                <div className="ship-room-head">
                  <b>{cell.label}</b>
                  <span>{team.length}/{spec?.slots ?? 1}</span>
                </div>
                <div className="ship-room-crew">
                  {team.length ? team.map((op) => (
                    <img key={op.id} src={op.image} alt={op.name} title={op.name} loading="lazy" />
                  )) : <i>{assignments ? "비어 있음" : "자동 편성 대기"}</i>}
                </div>
                {assignments && team.length > 0 && cell.room !== "DORMITORY" && (
                  <small>+{Math.round(teamScore(team, cell.room))}{cell.room === "CONTROL" ? "" : "%"} {UNIT[cell.room]}</small>
                )}
              </button>
            );
          })}
        </div>

        <aside className="data-note"><span>PLANNER NOTE</span><p>클뜯 데이터의 인프라 스킬 수치와 스킬 설명에 명시된 파트너 시너지(예: 텍사스–라플란드–엑시아)를 근거로 한 근사 최적화입니다. 조건부·누적형 버프는 표기 수치의 상한을 기준으로 계산합니다. 방을 클릭하면 조별 편성과 대체 오퍼레이터를 볼 수 있습니다.</p></aside>
      </section>

      {openCell && assignments && (
        <RoomModal
          cell={openCell}
          shiftMode={shiftMode}
          teams={(assignments[openCell.key] ?? []).map((team) => team.map((id) => opById.get(id)).filter(Boolean) as InfraOp[])}
          allAssigned={allAssigned}
          onClose={() => setOpenRoom(null)}
        />
      )}

      <footer><span>RHODES ISLAND // TERRA ARCHIVE</span><p>비공식 팬 프로젝트 · 게임 내 명칭과 데이터의 권리는 각 권리자에게 있습니다.</p></footer>
    </main>
  );
}

function RoomModal({ cell, shiftMode, teams, allAssigned, onClose }: { cell: { key: string; room: string; label: string }; shiftMode: number; teams: InfraOp[][]; allAssigned: Set<string>; onClose: () => void }) {
  const [shift, setShift] = useState(0);
  const isDorm = cell.room === "DORMITORY";
  const team = teams[isDorm ? 0 : Math.min(shift, teams.length - 1)] ?? [];
  const teamIds = new Set(team.map((op) => op.id));
  const subs = substitutes(cell.room, new Set([...allAssigned, ...teamIds]));

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
                const { value, skill } = contribution(op, cell.room, teamIds);
                return (
                  <article key={op.id} className="crew-card">
                    <img src={op.image} alt={op.name} loading="lazy" />
                    <div>
                      <b>{op.name} <i>{"★".repeat(op.rarity)}</i></b>
                      {skill ? <p><em>{skill.name}</em> — {skill.description}</p> : <p>이 시설에 적용되는 스킬이 없습니다 (휴식 요원).</p>}
                      {skill && cell.room !== "DORMITORY" && <small>기여 +{value}{cell.room === "CONTROL" ? "" : "%"}</small>}
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
                const skill = op.skills.find((candidate) => candidate.room === cell.room);
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
