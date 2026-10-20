// 인프라 역검증 — 상식 검사 (사용자 지적 2026-10-20 "채점이 틀렸어도 잡아낼 수 있어야 — 제조소 A조보다 B조가 높은 건 단순한 거잖아").
// 점수 비교는 엔진 채점 공식을 기준으로 하므로 공식이 틀리면 못 잡는다. 여기서는 **점수와 무관한 모양**만 본다:
//   ① 같은 방 A조 효율이 B조보다 크게 낮음 — A조는 주력, B조는 회복 교대다 (설계상 B조 결집 세트가 앉은 방은 따로 표시)
//   ② 근무 방 빈 칸   ③ 같은 오퍼가 A·B조 근무 방에 겹침(이중 근무)
//   ④ 지난 판과 같은 팀인데 방 효율이 크게 다름 — 제어센터 같은 5명이 +118 → +218 로 뛴 이중 계산 같은 것
// 방 효율은 화면 방 카드와 같은 teamScore. node scripts/riic-audit-sanity.mjs <runDir> [지난 runDir]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [runDir, prevDir] = process.argv.slice(2);
const E = await import(pathToFileURL(path.join(runDir, "engine.mjs")).href);
const { rows, side } = JSON.parse(fs.readFileSync(path.join(runDir, "input.json"), "utf8"));
const byOwner = new Map(rows.map((r) => [r.owner, r]));
const readRes = (dir) => fs.readFileSync(path.join(dir, "res.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const res = readRes(runDir);
const prevPct = new Map();
if (prevDir && fs.existsSync(path.join(prevDir, "sanity.json"))) for (const r of JSON.parse(fs.readFileSync(path.join(prevDir, "sanity.json"), "utf8")).rows ?? []) prevPct.set(r.owner, r);

const LOW_GAP = 10;      // ① A조가 B조보다 이만큼(%p) 넘게 낮으면
const JUMP = 15;         // ④ 같은 팀인데 이만큼(%p) 넘게 다르면
const out = [];
for (const r of res) {
  if (!r.autoPlan || r.err) continue;
  const row = byOwner.get(r.owner);
  const s = JSON.parse(row.d);
  const sd = side[r.owner] ?? {};
  const server = r.owner.split(":")[1];
  const fut = sd["ta-include-future"] === "1";
  E.setRecycle(fut && E.RECYCLE_SPEC ? (server !== "cn" && server !== "bili" ? "off" : sd["terra-archive-infra-recycle"] ?? "normal") : null);
  const layout = s.layout ?? "243";
  const bucket = s.buckets?.[layout] ?? {};
  E.setLayoutPreset(layout, s.customRooms ?? null, s.customProducts ?? null);
  E.setLevels(bucket.levels ?? null);
  E.setTrainingUse(sd["terra-archive-infra-training"] === "use");
  const visible = fut ? E.ops : E.ops.filter((op) => !op.unreleased);
  const elite = new Map(s.elite ?? []), lv = new Map(s.opLevels ?? []), owned = new Set(s.owned ?? []);
  const roster = visible.map((op) => E.withElite(op, elite.get(op.id), lv.get(op.id))).filter((op) => owned.has(op.id));
  const byId = new Map(roster.map((op) => [op.id, op]));
  const priority = s.priority ?? "gold";
  E.setPriorityMode(priority);
  const asg = r.autoPlan;
  const ledger = E.recountTokens(asg, byId, E.flowsFromAssignments(asg, byId));
  const plan = { assignments: asg, priority, plants: 3, factionCounts: E.factionCountsFor(asg, byId), tokenPoints: ledger?.tokenPoints ?? {}, flows: ledger?.flows ?? [] };
  const workKeys = [...E.PRODUCTION_KEYS, ...E.SUPPORT_KEYS].filter((k) => !E.PARK_KEYS.includes(k) && k !== "TRAINING");
  const pct = {};
  for (let sh = 0; sh < E.SHIFT_COUNT; sh += 1) {
    const teamAt = (k) => ((asg[k] ?? [])[Math.min(sh, (asg[k] ?? []).length - 1)] ?? []).map((id) => byId.get(id)).filter(Boolean);
    const points = E.planTokensAt(plan, byId, sh), counts = plan.factionCounts[sh] ?? {}, present = E.presentIdsFor(plan, sh), plants = E.plantsFor(plan, sh, byId);
    const amb = E.aurasOf(teamAt("CONTROL"), E.ctxFor("CONTROL", points, counts, plants, present));
    const clock = E.shiftHoursFor([...E.PRODUCTION_KEYS, ...E.SUPPORT_KEYS].map((k) => ({ room: E.cellByKey.get(k).room, ops: teamAt(k) })));
    for (const k of workKeys) {
      (pct[k] ??= [])[sh] = Math.round(E.teamScore(teamAt(k), E.cellByKey.get(k).room, { ...E.ctxFor(k, points, counts, plants, present, amb), roomOf: E.roomOfFor(plan, sh), cellOf: E.cellOfFor(plan, sh), shiftHours: clock, shift: sh }));
    }
  }
  const flags = [];
  // 사용자 고정 — 양 조 고정(shift 없음)은 일부러 두 조에 앉는다(③ 제외), 고정한 방의 모양은 사용자 선택이다
  const pins = bucket.roomPins ?? {};
  const bothPinned = new Set(Object.values(pins).flat().filter((p) => typeof p === "string" || p.shift == null).map((p) => (typeof p === "string" ? p : p.id)));
  const placedAny = new Set(Object.entries(asg).filter(([k]) => !k.startsWith("DORM")).flatMap(([, sh]) => sh.flat()));
  const autoPool = E.autoRoster(roster, bucket.dormPins ?? {}, pins);
  // ① A < B — 설계상인 경우를 가른다: 장기 지속(소모) 모드는 A조에 덜 지치는 팀을 일부러 앉힌다 · B조 결집 세트(피누스)가 B조에 있다 ·
  //    A조 팀에 **다른 방에 기여하는 오퍼**(토큰 생성·전환 — 위스퍼레인 사무실 등)가 있으면 자기 방 % 가 낮아도 정상일 수 있다.
  //    그 셋이 아닌데 A조가 크게 낮으면 'A<B' — 진짜 의심(위디 자동화 팀이 A조 +40%·B조 +95% 같은 것)
  const endless = /endless/.test(priority);
  const bSetIds = new Set(r.sets?.split(",").includes("pinus") ? ["char_431_ashlok", "char_496_wildmn", "char_430_fartth"] : []);
  const feedsOthers = (id, room) => (byId.get(id)?.skills ?? []).some((sk) => sk.room === room && (sk.tokenGen?.length || sk.convert));
  for (const k of workKeys) {
    if (k === "CONTROL") continue;   // 제어센터 % 는 오라 가중 합이라 A·B 비교 대상이 아니다
    const [a, b] = pct[k] ?? [];
    if (a == null || b == null || !(asg[k]?.[1]?.length)) continue;
    if (b - a > LOW_GAP) {
      const room = E.cellByKey.get(k).room;
      const kind = endless ? "A<B(장기 지속)"
        : (asg[k][1] ?? []).filter((id) => bSetIds.has(id)).length >= 2 ? "A<B(B조 세트)"
        : (asg[k][0] ?? []).some((id) => feedsOthers(id, room)) ? "A<B(토큰 생성원)"
        : "A<B";
      flags.push({ kind, room: k, a, b });
    }
  }
  // ② 빈 칸
  for (const k of workKeys) for (let sh = 0; sh < (asg[k]?.length ?? 0); sh += 1) {
    const n = E.slotsFor(k) - (asg[k][sh]?.length ?? 0);
    // 그 방에 쓸 수 있는데 어디에도 안 앉은 오퍼가 있을 때만 (보유가 모자라 비는 건 정상)
    const room = E.cellByKey.get(k).room;
    const spare = autoPool.filter((op) => !placedAny.has(op.id) && op.skills.some((sk) => sk.room === room)).length;
    if (n > 0 && spare > 0) flags.push({ kind: "빈 칸", room: k, shift: sh, n, spare });
  }
  // ③ 이중 근무
  const seen = [new Set(), new Set()];
  for (const k of workKeys) for (let sh = 0; sh < 2; sh += 1) for (const id of asg[k]?.[sh] ?? []) seen[sh].add(id);
  const both = [...seen[0]].filter((id) => seen[1].has(id) && !bothPinned.has(id));
  if (both.length) flags.push({ kind: "이중 근무", ids: both });
  // ④ 같은 팀인데 % 가 크게 다름 (지난 판 대비)
  const prev = prevPct.get(r.owner);
  if (prev) for (const k of workKeys) for (let sh = 0; sh < 2; sh += 1) {
    const now = asg[k]?.[sh], was = prev.teams?.[k]?.[sh];
    if (!now || !was || [...now].sort().join() !== [...was].sort().join()) continue;
    const d = (pct[k]?.[sh] ?? 0) - (prev.pct?.[k]?.[sh] ?? 0);
    if (Math.abs(d) > JUMP) flags.push({ kind: "같은 팀 % 급변", room: k, shift: sh, from: prev.pct[k][sh], to: pct[k][sh] });
  }
  out.push({ owner: r.owner, pct, teams: Object.fromEntries(workKeys.map((k) => [k, asg[k]])), flags });
}
const count = (kind) => out.filter((r) => r.flags.some((f) => f.kind === kind)).length;
const kinds = ["A<B", "A<B(토큰 생성원)", "A<B(B조 세트)", "A<B(장기 지속)", "빈 칸", "이중 근무", "같은 팀 % 급변"];
const summary = Object.fromEntries(kinds.map((k) => [k, count(k)]));
const roomFreq = {};
for (const r of out) for (const f of r.flags) if (f.kind === "A<B") roomFreq[f.room] = (roomFreq[f.room] ?? 0) + 1;
fs.writeFileSync(path.join(runDir, "sanity.json"), JSON.stringify({ summary, roomFreq, rows: out }));
console.log("상식 검사:", kinds.map((k) => `${k} ${summary[k]}명`).join(" · "));
console.log("  A<B 가 난 방:", Object.entries(roomFreq).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ") || "없음");
const worst = out.flatMap((r) => r.flags.filter((f) => f.kind === "A<B").map((f) => ({ owner: r.owner, ...f }))).sort((x, y) => (y.b - y.a) - (x.b - x.a)).slice(0, 15);
for (const w of worst) console.log(`  ${w.owner} ${w.room} A +${w.a}% / B +${w.b}%`);
