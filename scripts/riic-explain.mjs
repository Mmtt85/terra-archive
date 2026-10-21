// 인프라 오퍼별 효과 전수 조사 (주 1회, 사용자 지시 2026-10-21) — 토큰 없이 스크립트로만 돈다.
//   저장된 설정에서 무작위로 N명(기본 100)을 뽑아 그 사람 보유 오퍼로 자동편성을 돌리고, 나온 편성의 **모든 오퍼 한 명 한 명**을
//   ① 엔진이 매긴 효과(breakdown)로 풀어 쓰고 ② **스킬 문구를 직접 읽어 배치표에서 다시 센 값**과 대조한다.
//   두 값이 어긋난 오퍼, 다시 셀 방법이 없는 스킬을 보고서로 모은다 — 엔진이 '세는 법' 자체를 틀린 곳(내스티 숙소 인원, 제보 8a92310b)을 잡는 게 목적.
//
//   node scripts/riic-explain.mjs                 # 최근 역검증 판 입력에서 100명 (같은 날은 같은 100명)
//   node scripts/riic-explain.mjs --n 300 --seed 7
//   → .riic-audit/explain/<시각>/report.md · ops.jsonl (남의 계정 데이터 — gitignore, 커밋·공개 금지)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".riic-audit");
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

// ── 작업자 ─────────────────────────────────────────────────────────────
if (argv[0] === "--worker") {
  const [, bundle, inPath, outPath, shardS, shardsS] = argv;
  const E = await import(pathToFileURL(bundle).href);
  const { rows, side } = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const shard = Number(shardS), shards = Number(shardsS);
  fs.writeFileSync(outPath, "");
  for (let i = shard; i < rows.length; i += shards) {
    const r = rows[i];
    try { for (const line of explainOne(E, r, side[r.owner] ?? {}, await optimize(E, r, side[r.owner] ?? {}))) fs.appendFileSync(outPath, JSON.stringify(line) + "\n"); }
    catch (e) { fs.appendFileSync(outPath, JSON.stringify({ owner: r.owner, err: String(e?.message ?? e).slice(0, 200) }) + "\n"); }
  }
  process.exit(0);
}

function setup(E, r, sd) {
  const s = JSON.parse(r.d);
  const server = r.owner.split(":")[1], fut = sd["ta-include-future"] === "1";
  E.setRecycle(fut && E.RECYCLE_SPEC ? (server !== "cn" && server !== "bili" ? "off" : sd["terra-archive-infra-recycle"] ?? "normal") : null);
  const layout = s.layout ?? "243", bucket = s.buckets?.[layout] ?? {};
  E.setLayoutPreset(layout, s.customRooms ?? null, s.customProducts ?? null);
  E.setLevels(bucket.levels ?? null);
  E.setTrainingUse(sd["terra-archive-infra-training"] === "use");
  const visible = fut ? E.ops : E.ops.filter((op) => !op.unreleased);
  const el = new Map(s.elite ?? []), lv = new Map(s.opLevels ?? []), own = new Set(s.owned ?? []);
  const roster = visible.map((op) => E.withElite(op, el.get(op.id), lv.get(op.id))).filter((op) => own.has(op.id));
  return { s, bucket, roster, byId: new Map(roster.map((op) => [op.id, op])), priority: s.priority ?? "gold" };
}
async function optimize(E, r, sd) {
  const { bucket, roster, priority } = setup(E, r, sd);
  const cfg = await E.optimizeConfig(roster, priority, undefined, bucket.dormPins ?? {}, bucket.roomPins ?? {});
  return cfg.plan;
}

// 스킬 문구로 따로 세기 — 엔진 필드(perFaction 등)는 '누구를 세는지'만 빌리고, **어디서 세는지·상한**은 문구에서 읽는다
function independent(E, skill, op, cellKey, team, place) {
  const d = skill.description ?? "";
  const kindOk = ["output", "trade", "hire", "clue", "power"].includes(skill.kind) || /생산력|오더 수주 효율|누적 속도|수집 속도|회복 속도/.test(d);
  if (!kindOk) return null;
  const capM = /최대\s*\+?(\d+)\s*명/.exec(d) ?? /\(최대\s*(\d+)명/.exec(d);
  const cap = capM ? Number(capM[1]) : Infinity;
  const selfEx = /자신을 제외/.test(d);
  const noTraining = /활동실/.test(d);
  // 조건·변환이 붙은 스킬은 이 계산기로 못 센다 — 종류만 적어 둔다
  if (skill.tokenUse?.length || skill.tokenGen?.length || skill.convert || skill.override || skill.automation || skill.partners?.length || skill.basePartners?.length
    || skill.roomPartner || skill.gateFaction || skill.belowThreshold != null || skill.perSkillTag != null || skill.reqFaction || skill.reqGroup || skill.workPartners?.length
    || skill.crossBuff || skill.capConv || skill.amplify || skill.payout || skill.quality) return { kind: "조건부·변환", value: null };
  // 자동화·덮어쓰기(위디·샤마르·스네구로치카 …)는 방 전체 규칙이라 한 명 값으로 못 센다
  if (/전부 0|0%로 감소|0이 되|대체|자동화/.test(d)) return { kind: "자동화·덮어쓰기", value: null };
  const isMember = (m) => E.memberOf(m, skill.perFaction);
  if (skill.perFacility) {
    const pf = skill.perFacility;
    const cells = new Set(pf.ids.map((id) => place.cellOf.get(id)).filter(Boolean));
    const n = Math.min(pf.count, cells.size);
    return { kind: "시설 1개당", value: skill.value + pf.per * n, why: `${skill.value}% + ${pf.group ?? "그룹"} 있는 시설 ${n}곳 × ${pf.per}%` };
  }
  if (skill.perFaction && /기반시설/.test(d) && /1명당/.test(d)) {
    const per = Number((/1명당[^+\-]*([+\-]?\d+(?:\.\d+)?)%/.exec(d) ?? [])[1] ?? skill.value);
    const head = d.split("기반시설")[0];   // '드론 회복 속도 +10%, 기반시설 … 1명당 +3%' 의 앞 고정분
    const base = Number((/\+(\d+(?:\.\d+)?)%/.exec(head) ?? [])[1] ?? 0);
    const members = [...place.all].filter(([id, k]) => !(noTraining && k === "TRAINING") && !(selfEx && id === op.id)).map(([id]) => E.opById?.get?.(id) ?? place.byId.get(id)).filter((m) => m && isMember(m));
    const n = Math.min(cap, members.length);
    return { kind: "기반시설 내 진영 1명당", value: base + per * n, why: `${base ? `${base}% + ` : ""}${skill.perFaction} ${n}명 × ${per}% (기지 전체·숙소 포함${noTraining ? "·훈련실 제외" : ""}${selfEx ? "·자신 제외" : ""}${cap < Infinity ? `·최대 ${cap}명` : ""})`, members: members.map((m) => m.name) };
  }
  if (skill.perFaction && /(함께 배치된|해당 [가-힣]+ 내|같은 [가-힣]+에)/.test(d) && /1명당/.test(d)) {
    const n = Math.min(cap, team.filter((m) => m.id !== op.id && isMember(m)).length);
    return { kind: "같은 방 진영 1명당", value: skill.value * n, why: `같은 방 ${skill.perFaction} ${n}명 × ${skill.value}%` };
  }
  if (skill.perFaction) return { kind: "진영 1명당(다른 범위)", value: null };
  // 고정 % 는 조건 없는 문구만 — '…경우·있으면·함께·시간·컨디션' 이 붙으면 조건부로 둔다
  if (/경우|있으면|함께|때마다|시간이|시간당|컨디션|만약|이상|미만|이하/.test(d) || (d.match(/[+\-]\d+(?:\.\d+)?%/g) ?? []).length > 1) return { kind: "조건부 문구", value: null };
  return { kind: "고정", value: skill.value, why: `${skill.value}%` };
}

function explainOne(E, r, sd, plan) {
  const { byId, priority } = setup(E, r, sd);
  E.setPriorityMode(priority);
  const out = [];
  for (let shift = 0; shift < E.SHIFT_COUNT; shift += 1) {
    const roomOf = E.roomOfFor(plan, shift), cellOf = E.cellOfFor(plan, shift);
    const all = new Map();
    for (const [k, shifts] of Object.entries(plan.assignments)) for (const id of shifts[Math.min(shift, shifts.length - 1)] ?? []) all.set(id, k);
    const place = { roomOf, cellOf, all, byId };
    const teamAt = (k) => { const sh = plan.assignments[k] ?? []; return (sh[Math.min(shift, sh.length - 1)] ?? []).map((id) => byId.get(id)).filter(Boolean); };
    const pts = E.planTokensAt(plan, byId, shift), fc = plan.factionCounts?.[shift] ?? E.factionCountsFor(plan.assignments, byId)[shift], plants = E.plantsFor(plan, shift, byId), present = E.presentIdsFor(plan, shift);
    const amb = E.aurasOf(teamAt("CONTROL"), E.ctxFor("CONTROL", pts, fc, plants, present, undefined, roomOf, cellOf));
    for (const cell of E.LAYOUT) {
      if (cell.room === "DORMITORY" || cell.room === "CONTROL" || cell.room === "RECYCLE") continue;
      const team = teamAt(cell.key);
      if (!team.length) continue;
      const ctx = { ...E.ctxFor(cell.key, pts, fc, plants, present, amb, roomOf, cellOf), shiftHours: plan.shiftHours?.[shift], shift };
      for (const op of team) {
        const b = E.breakdown(op, cell.room, team, ctx);
        const engine = b.efficiency + b.facilityEff + b.perCoworker * (team.length - 1);
        const lines = [];
        let expect = 0, ok = true;
        const kinds = [];
        for (const sk of b.skills.filter((x) => x.room === cell.room)) {
          const ind = independent(E, sk, op, cell.key, team, place);
          if (!ind) continue;
          kinds.push(ind.kind);
          if (ind.value == null) { ok = false; lines.push(`${sk.name}: ${ind.kind} — 따로 셀 방법 없음`); continue; }
          expect += ind.value; lines.push(`${sk.name}: ${ind.why}${ind.members ? ` [${ind.members.join("·")}]` : ""}`);
        }
        const crossIn = (b.crossIn ?? []).reduce((a, c) => a + c.value, 0);
        if (crossIn) lines.push(`다른 방에서 받음: ${b.crossIn.map((c) => `${byId.get(c.from)?.name ?? c.from}(${c.fromRoom}) +${c.value}%`).join(", ")}`);
        out.push({ owner: r.owner, shift: shift === 0 ? "A" : "B", room: cell.key, op: op.name, engine: Math.round(engine * 10) / 10,
          expect: ok ? Math.round((expect + crossIn) * 10) / 10 : null, verified: ok, kinds, lines });
      }
    }
  }
  return out;
}

// ── 본체 ───────────────────────────────────────────────────────────────
const N = Number(arg("--n", 100));
const runs = fs.readdirSync(path.join(DIR, "runs")).sort().filter((d) => fs.existsSync(path.join(DIR, "runs", d, "input.json")));
if (!runs.length) throw new Error("역검증 입력이 없습니다 — 먼저 node scripts/riic-audit.mjs");
const src = JSON.parse(fs.readFileSync(path.join(DIR, "runs", runs.at(-1), "input.json"), "utf8"));
let seed = Number(arg("--seed", new Date().toISOString().slice(0, 10).replace(/-/g, "")));
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pool = [...src.rows];
for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const picked = pool.slice(0, N);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(DIR, "explain", stamp);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "input.json"), JSON.stringify({ rows: picked, side: src.side }));
const bundle = path.join(outDir, "engine.mjs");
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [path.join(ROOT, "app/planner-engine.ts"), "--bundle", "--format=esm", "--platform=node", `--outfile=${bundle}`, "--log-level=warning"]);
const shards = Math.max(1, Math.min(picked.length, os.cpus().length - 1));
console.log(`${picked.length}명 (입력 ${runs.at(-1)}) · 작업자 ${shards}`);
const t0 = Date.now();
const tick = setInterval(() => {
  const done = new Set();
  for (let s = 0; s < shards; s += 1) { try { for (const l of fs.readFileSync(path.join(outDir, `ops-${s}.jsonl`), "utf8").split("\n")) if (l) done.add(JSON.parse(l).owner); } catch { /* 아직 */ } }
  console.log(`진행 ${done.size}/${picked.length} · ${Math.round((Date.now() - t0) / 60000)}분`);
}, 30_000);
await Promise.all(Array.from({ length: shards }, (_, s) => new Promise((ok, bad) => {
  const c = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker", bundle, path.join(outDir, "input.json"), path.join(outDir, `ops-${s}.jsonl`), String(s), String(shards)], { stdio: ["ignore", "ignore", "inherit"] });
  c.on("exit", (code) => (code === 0 ? ok() : bad(new Error(`작업자 ${s} 실패 ${code}`))));
})));
clearInterval(tick);
const rows = [];
for (let s = 0; s < shards; s += 1) for (const l of fs.readFileSync(path.join(outDir, `ops-${s}.jsonl`), "utf8").split("\n")) if (l) rows.push(JSON.parse(l));
fs.writeFileSync(path.join(outDir, "ops.jsonl"), rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
for (let s = 0; s < shards; s += 1) fs.rmSync(path.join(outDir, `ops-${s}.jsonl`));

// ── 보고서 ─────────────────────────────────────────────────────────────
const ops = rows.filter((x) => !x.err), errs = rows.filter((x) => x.err);
const verified = ops.filter((x) => x.verified);
const mismatch = verified.filter((x) => Math.abs(x.engine - x.expect) > 0.5);
const unver = ops.filter((x) => !x.verified);
const byKind = {};
for (const x of unver) for (const l of x.lines.filter((l) => l.includes("따로 셀 방법 없음"))) { const k = l.split(":")[0]; byKind[k] = (byKind[k] ?? 0) + 1; }
const misBySkill = {};
for (const x of mismatch) { const k = `${x.op} (${x.room.replace(/-\d+$/, "")})`; misBySkill[k] = (misBySkill[k] ?? 0) + 1; }
const lines = [
  `# 인프라 오퍼별 효과 전수 조사 ${stamp}`,
  `대상 ${picked.length}명 · 오퍼 자리 ${ops.length}개 · 오류 ${errs.length} · 걸린 시간 ${Math.round((Date.now() - t0) / 1000)}초`,
  `- 따로 세어 확인됨: **${verified.length}자리** (${Math.round((verified.length / Math.max(1, ops.length)) * 100)}%)`,
  `- **엔진 값과 어긋남: ${mismatch.length}자리** (±0.5%p 넘게)`,
  `- 따로 셀 방법이 없는 스킬이 있어 못 셈: ${unver.length}자리`,
  "",
  "## 어긋난 오퍼 (많은 순)",
  ...Object.entries(misBySkill).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => `- ${k} — ${n}자리`),
  "",
  "## 어긋난 자리 예시 (오퍼마다 하나)",
  ...[...new Map(mismatch.map((x) => [x.op, x])).values()].slice(0, 40).flatMap((x) => [`- ${x.owner} ${x.shift}조 ${x.room} **${x.op}** — 엔진 ${x.engine}% · 문구로 센 값 ${x.expect}%`, ...x.lines.map((l) => `  - ${l}`)]),
  "",
  "## 따로 셀 방법이 없는 스킬 (많은 순 — 계산기를 늘릴 차례)",
  ...Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => `- ${k} — ${n}자리`),
  ...(errs.length ? ["", "## 오류", ...errs.slice(0, 20).map((x) => `- ${x.owner}: ${x.err}`)] : []),
];
fs.writeFileSync(path.join(outDir, "report.md"), lines.join("\n") + "\n");
console.log(lines.slice(0, 6).join("\n"));
console.log(`보고서: ${path.join(outDir, "report.md")}`);
