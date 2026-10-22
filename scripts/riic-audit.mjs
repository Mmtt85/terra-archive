#!/usr/bin/env node
// 인프라 플래너 역검증 (주 1회 — 사용자 결정 2026-10-20) + 엔진 배포 관문 (2026-10-21).
// 사람들이 저장한 인프라 설정(보유·정예화·편성·고정)으로 지금 엔진을 다시 돌려 찾는다:
//   ① 회귀 — 기준선(배포된 엔진들이 그 사람에게 낸 편성 중 지금 채점으로 가장 높은 것)보다 자동편성이 낮아진 사람
//   ② 안정장치 위반 — 그 사람이 지금 자동편성을 누르면 받는 편성(화면과 같은 keepIfClose)이 지금 저장 편성보다 낮다
//   ③ 다듬기 덜 끝남 — 자동편성 결과를 한 번 더 다듬으면 오른다(고정점이 아니다)
//   ④ 채점 경로 불일치 — 엔진 점수 ≠ 배치에서 다시 센 점수   ⑤ (참고) 엔진이 놓친 조합 — 저장 편성 > 자동편성 +5
// 절차·판단은 riic-audit 스킬. 받은 설정·결과는 .riic-audit/ 에만 둔다 (gitignore — 남의 계정 데이터다).
//
//   node scripts/riic-audit.mjs --quick         # 배포 관문 — 관문 명단(한 번이라도 문제가 난 계정 + 운영자 계정)만, 기준 입력으로 (5~15분)
//   node scripts/riic-audit.mjs --rerun         # 기준 입력 전원 다시 (받기 없음, 1~1.5시간) — 엔진을 크게 고쳤을 때
//   node scripts/riic-audit.mjs                 # 주간 점검 — D1 에서 검증완료가 아닌 계정만 새로 받아서
//   node scripts/riic-audit.mjs --all           # D1 에서 전원 새로 받아서
//   node scripts/riic-audit.mjs --mark [판]     # **기록만** — 마지막으로 끝난 판(또는 준 판)에서 문제 없던 계정을 검증완료로 (아무것도 안 돌린다)
//   node scripts/riic-audit.mjs --promote [판] [--replace]   # 그 판의 자동편성을 기준선에 올린다 — 기본은 계정마다 기준선과 높은 쪽
//   node scripts/riic-audit.mjs --accept 계정,계정  # 마지막 관문 판의 그 계정 편성을 기준선으로 (내려간 게 맞다고 판단했을 때 — 사용자 확인 뒤)
//   node scripts/riic-audit.mjs --rewatch [판]  # 그 판에서 문제 난 계정을 관문 명단에 더한다
//   node scripts/riic-audit.mjs --gate-check [--rev HEAD]   # 배포 관문 확인 (ship.sh·deploy.sh 가 부른다)
//   node scripts/riic-audit.mjs --deployed [--rev HEAD]     # 배포된 엔진 기록 + 관문 판을 기준선에 (deploy.sh 가 배포 끝에 부른다)
//
// 배포 관문 (2026-10-21, docs/INFRA-FAILURES.md — '배포 전 역검증'을 다짐 대신 장치로): 엔진(app/planner-engine.ts)이 마지막 배포 판과
// 다르면, **그 엔진으로 돈** --quick 또는 --rerun·--all 판이 통과해야 ship.sh 가 푸시하고 deploy.sh 가 배포한다.
// 통과 = 오류 0 · 회귀 0 · 안정장치 위반 0 · 안정장치 채점 불일치 0 · 다듬기 덜 끝남 0 · 채점 경로 불일치 0.
// 검증완료 = .riic-audit/verified.json 의 {계정: 그때 설정의 t}. 설정 저장소(D1 prefs)의 t 는 그 사람이 설정을 바꿀 때마다 오른다.
// 사용자 계정에 플래그 키를 쓰지 않는다(그 사람 브라우저로 동기화되고 쓰기가 는다).
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, auditDir, gitCommonDir, d1, sqlq, SIDE_KEYS, readJson, readJsonl, isBig, gap, loadEngine, setupAccount, rescore, ownsAll, acquireHeavyLock } from "./riic-lib.mjs";

const DIR = auditDir();
const RUNS = path.join(DIR, "runs");
fs.mkdirSync(RUNS, { recursive: true });
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueAfter = (flag) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null; };
const P = {
  verified: path.join(DIR, "verified.json"),
  baseMeta: path.join(DIR, "baseline.json"),     // { input: 기준 입력 경로, runs: [{run, at, mode, engine}] }
  basePlans: path.join(DIR, "baseline.jsonl"),   // 계정마다 {owner, t, run, plan}
  watch: path.join(DIR, "watch.json"),           // 관문 명단 {계정: {since, why[]}}
  owner: path.join(DIR, "owner.txt"),            // 운영자 본인 계정 — 관문에 늘 넣고 보고서 맨 위에 찍는다
  gate: path.join(gitCommonDir(), "riic-gate.json"),          // 관문 결과 — git 공용 디렉터리라 워크트리에서 배포해도 보인다
  deployed: path.join(gitCommonDir(), "riic-deployed-engine"), // 마지막으로 배포한 엔진의 해시
};
const owner = (() => { try { return fs.readFileSync(P.owner, "utf8").trim(); } catch { return ""; } })();
const hashOf = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
const engineHash = (rev) => hashOf(rev
  ? execFileSync("git", ["show", `${rev}:app/planner-engine.ts`], { cwd: ROOT, maxBuffer: 1 << 28 })
  : fs.readFileSync(path.join(ROOT, "app/planner-engine.ts")));
const completedRuns = () => fs.readdirSync(RUNS).sort().filter((d) => fs.existsSync(path.join(RUNS, d, "res.jsonl")));
const metaOf = (d) => readJson(path.join(RUNS, d, "meta.json"), null) ?? { mode: "all" };   // 2026-10-21 전 판은 전부 전원 판
const resolveRun = (name) => {
  const d = name ?? completedRuns().at(-1);
  if (!d || !fs.existsSync(path.join(RUNS, d, "res.jsonl"))) throw new Error(`끝난 판이 없습니다: ${name ?? "(마지막)"}`);
  return d;
};
const readRes = (d) => readJsonl(path.join(RUNS, d, "res.jsonl"));

// ── 판정 — 보고서·관문·검증완료·관문 명단이 같은 판정을 쓴다 ─────────────────────────────
const MISS = 5, LEDGER = 1, REGRESS = 0.5, FIX = 0.5, KEEP_EPS = 0.05;
function judge(res) {
  const ok = res.filter((r) => !r.err && r.autoRe != null);
  const g = (a, b, r) => gap(a, b, isBig(r.autoRe));
  // 장기 지속 모드는 엔진이 일부러 안 다듬는다 — 관문에서 빼고 참고로만 (2026-10-21 첫 관문 판: 덜 끝남 39명이 전부 이 모드였다)
  const endless = (r) => r.endless ?? /\+endless|^endless$|^perpetual$/.test(r.priority ?? "");
  const notFix = ok.filter((r) => r.polish != null && g(r.polish, r.autoRe, r) > FIX && !endless(r));
  return {
    ok,
    endlessPolish: ok.filter((r) => r.polish != null && g(r.polish, r.autoRe, r) > FIX && endless(r)),
    err: res.filter((r) => r.err),
    regress: ok.filter((r) => r.baseRe != null && g(r.autoRe, r.baseRe, r) < -REGRESS),
    keepViolation: ok.filter((r) => (r.keep === "better" || r.keep === "close") && r.saved != null && r.keepFinal != null && g(r.keepFinal, r.saved, r) < -KEEP_EPS),
    keepMismatch: ok.filter((r) => r.keepBefore != null && r.saved != null && Math.abs(g(r.keepBefore, r.saved, r)) > KEEP_EPS),
    notFixpoint: notFix.filter((r) => !r.polishCapped),
    cappedFix: notFix.filter((r) => r.polishCapped),
    ledger: ok.filter((r) => Math.abs(g(r.autoRe, r.auto, r)) > LEDGER),
    miss: ok.filter((r) => r.saved != null && g(r.saved, r.autoRe, r) > MISS),
    regressPrev: ok.filter((r) => r.prevRe != null && g(r.autoRe, r.prevRe, r) < -REGRESS),
    improvedPrev: ok.filter((r) => r.prevRe != null && g(r.autoRe, r.prevRe, r) > REGRESS),
    improvedBase: ok.filter((r) => r.baseRe != null && g(r.autoRe, r.baseRe, r) > REGRESS),
    g,
  };
}
const GATE_KEYS = [["err", "오류"], ["regress", "회귀"], ["keepViolation", "안정장치 위반"], ["keepMismatch", "안정장치 채점 불일치"], ["notFixpoint", "다듬기 덜 끝남"], ["ledger", "채점 경로 불일치"]];
const WATCH_KEYS = [...GATE_KEYS, ["cappedFix", "다듬기 상한"], ["miss", "놓친 조합"], ["regressPrev", "지난 판 대비 내려감"]];
function addWatch(j, run) {
  const watch = readJson(P.watch, {});
  let added = 0;
  for (const [key, label] of WATCH_KEYS) for (const r of j[key]) {
    const w = (watch[r.owner] ??= { since: run, why: [] });
    if (!w.why.length) added += 1;
    if (!w.why.includes(label)) w.why.push(label);
  }
  fs.writeFileSync(P.watch, JSON.stringify(watch, null, 1));
  return { added, size: Object.keys(watch).length };
}

// ── 관문 확인 (ship.sh 푸시 전 · deploy.sh 배포 전) ─────────────────────────────────────────
if (has("--gate-check")) {
  const eng = engineHash(valueAfter("--rev"));
  const deployed = (() => { try { return fs.readFileSync(P.deployed, "utf8").trim(); } catch { return ""; } })();
  if (deployed === eng) { console.log(`엔진 관문: 엔진이 마지막 배포 판과 같습니다 (${eng}) — 통과`); process.exit(0); }
  const gate = readJson(P.gate, null);
  if (gate?.engine === eng && gate.pass) { console.log(`엔진 관문: 통과 — ${gate.mode} 판 ${gate.run} (${gate.rows}명)`); process.exit(0); }
  console.error(`✗ 엔진 관문: 자동편성 엔진(app/planner-engine.ts ${eng})이 마지막 배포 판${deployed ? `(${deployed})` : "(기록 없음)"}과 다른데, 이 엔진으로 통과한 역검증이 없습니다.`);
  if (gate?.engine === eng) console.error(`  이 엔진의 ${gate.mode} 판(${gate.run})이 걸렸습니다: ${gate.failures.join(" · ")} — 보고서 ${path.join(gate.runDir, "report.md")}`);
  else if (gate) console.error(`  마지막 관문 판(${gate.run})은 다른 엔진(${gate.engine})으로 돌았습니다 — 엔진을 고친 뒤엔 다시 돌려야 합니다.`);
  console.error("  → node scripts/riic-audit.mjs --quick   (5~15분, 다른 무거운 계산 없이) 통과한 뒤 다시");
  process.exit(1);
}

// ── 기준선 올리기 ─────────────────────────────────────────────────────────────────────
// 기본은 계정마다 **기준선과 이 판 중 지금 엔진 채점으로 높은 쪽**(그 계정 설정 t 가 같을 때) — 배포마다 기준이 0.5점씩 미끄러지지 않게.
// --replace 는 그대로 덮는다. 설정이 바뀐 계정(t 다름)은 이 판 편성으로
async function promote(run, { replace = false, only = null } = {}) {
  const dir = path.join(RUNS, run);
  const meta = metaOf(run);
  const res = readRes(run).filter((r) => r.autoPlan && !r.err && (!only || only.has(r.owner)));
  const base = new Map(readJsonl(P.basePlans).map((b) => [b.owner, b]));
  let fresh = 0, took = 0, stayed = 0;
  let E = null, input = null, rows = null;
  for (const r of res) {
    const b = base.get(r.owner);
    const mine = { owner: r.owner, t: r.t, run, plan: r.autoPlan };
    if (!b || b.t !== r.t || replace) { base.set(r.owner, mine); fresh += 1; continue; }
    if (!E) {
      const tmp = path.join(DIR, `engine-promote-${process.pid}.mjs`);
      E = await loadEngine(tmp);
      fs.rmSync(tmp, { force: true });
      input = readJson(path.join(dir, "input.json"), { rows: [], side: {} });
      rows = new Map(input.rows.map((x) => [x.owner, x]));
    }
    const row = rows.get(r.owner);
    if (!row) { base.set(r.owner, mine); fresh += 1; continue; }
    const a = setupAccount(E, row, input.side?.[r.owner] ?? {});
    if (!ownsAll(b.plan, a.byId)) { base.set(r.owner, mine); fresh += 1; continue; }
    const vb = rescore(E, { assignments: b.plan }, b.plan, a.byId, a.priority);
    const vr = rescore(E, { assignments: r.autoPlan }, r.autoPlan, a.byId, a.priority);
    if (vr >= vb - 1e-9) { base.set(r.owner, mine); took += 1; } else stayed += 1;
  }
  fs.writeFileSync(P.basePlans, [...base.values()].map((b) => JSON.stringify(b)).join("\n") + "\n");
  const bm = readJson(P.baseMeta, { input: null, runs: [] });
  if (meta.mode !== "quick" && meta.mode !== "pending") bm.input = path.join(dir, "input.json");
  bm.runs.push({ run, at: new Date().toISOString(), mode: meta.mode, engine: meta.engine ?? null, replace, only: only ? [...only] : undefined });
  fs.writeFileSync(P.baseMeta, JSON.stringify(bm, null, 1));
  console.log(`기준선 ← ${run}: 새로 ${fresh} · 이 판이 높거나 같아 바꿈 ${took} · 기준선이 높아 그대로 ${stayed} (기준선 ${base.size}명)`);
}

if (has("--promote")) { await promote(resolveRun(valueAfter("--promote")), { replace: has("--replace") }); process.exit(0); }
if (has("--accept")) {
  const list = new Set((valueAfter("--accept") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const gate = readJson(P.gate, null);
  if (!list.size || !gate?.run) { console.error("--accept 계정,계정 — 마지막 관문 판이 있어야 합니다"); process.exit(2); }
  await promote(gate.run, { replace: true, only: list });
  // 그 판을 다시 판정 — 받아들인 계정은 기준선이 이 판의 편성이 됐으니 회귀가 아니다. 나머지 판정은 그대로라, 관문 판을 다시 돌리지 않아도 된다
  const res = readRes(gate.run).map((r) => (list.has(r.owner) && r.autoRe != null ? { ...r, baseRe: r.autoRe } : r));
  const j = judge(res);
  const failures = GATE_KEYS.filter(([key]) => j[key].length).map(([key, label]) => `${label} ${j[key].length}명`);
  const accepted = [...new Set([...(gate.accepted ?? []), ...list])];
  fs.writeFileSync(P.gate, JSON.stringify({ ...gate, pass: !failures.length, failures, accepted, at: new Date().toISOString() }, null, 1));
  console.log(`관문 다시 판정 (${gate.run}, 받아들인 ${accepted.length}명): ${failures.length ? `✗ ${failures.join(" · ")}` : "✓ 통과"}`);
  process.exit(0);
}
if (has("--deployed")) {
  const eng = engineHash(valueAfter("--rev"));
  fs.writeFileSync(P.deployed, eng + "\n");
  console.log(`배포된 엔진 기록: ${eng}`);
  const gate = readJson(P.gate, null);
  if (gate?.engine === eng && gate.pass && fs.existsSync(path.join(RUNS, gate.run, "res.jsonl"))) await promote(gate.run);
  process.exit(0);
}
if (has("--rewatch")) {
  const run = resolveRun(valueAfter("--rewatch"));
  const { added, size } = addWatch(judge(readRes(run)), run);
  console.log(`관문 명단 ← ${run}: 새로 ${added}명 (명단 ${size}명)`);
  process.exit(0);
}

// ── 검증완료 기록 (#16: 종전엔 --mark 가 '실행' 옵션이라 D1 에서 받아 전원을 다시 돌렸다 — 1시간 반) ─────────────
if (has("--mark")) {
  const run = resolveRun(valueAfter("--mark"));
  const res = readRes(run);
  const j = judge(res);
  const sanity = readJson(path.join(RUNS, run, "sanity.json"), { rows: [] });
  const bad = new Set(WATCH_KEYS.flatMap(([key]) => j[key].map((r) => r.owner)));
  for (const r of sanity.rows) if (r.flags.some((f) => ["A<B", "빈 칸", "이중 근무", "같은 팀 % 급변"].includes(f.kind))) bad.add(r.owner);   // 상식 검사에 걸린 사람도 다음 판에 다시
  const verified = readJson(P.verified, {});
  let n = 0;
  for (const r of j.ok) if (!bad.has(r.owner) && r.t) { verified[r.owner] = r.t; n += 1; }
  fs.writeFileSync(P.verified, JSON.stringify(verified, null, 1));
  console.log(`검증완료 기록 ← ${run}: ${n}명 (문제 있던 ${bad.size}명은 다음 판에 다시 본다)`);
  process.exit(0);
}

// ── 판 돌리기 ─────────────────────────────────────────────────────────────────────────
const mode = has("--quick") ? "quick" : has("--rerun") ? "rerun" : has("--all") ? "all" : "pending";
acquireHeavyLock(`riic-audit ${mode}`);
const baseMeta = readJson(P.baseMeta, null);
function baseInput() {
  const p = baseMeta?.input && fs.existsSync(baseMeta.input) ? baseMeta.input
    : (() => { const d = completedRuns().reverse().find((x) => ["all", "rerun"].includes(metaOf(x).mode)); return d && path.join(RUNS, d, "input.json"); })();
  if (!p) throw new Error("기준 입력이 없습니다 — 먼저 전원 판(--all)을 한 번 돌리세요");
  return { p, data: readJson(p) };
}
let input;
if (mode === "quick") {
  const { p, data } = baseInput();
  const want = new Set([...Object.keys(readJson(P.watch, {})), ...(owner ? [owner] : [])]);
  input = { rows: data.rows.filter((r) => want.has(r.owner)), side: Object.fromEntries(Object.entries(data.side ?? {}).filter(([o]) => want.has(o))) };
  console.log(`관문 명단 ${want.size}명 중 기준 입력에 있는 ${input.rows.length}명을 돌립니다 (${path.relative(DIR, p)})`);
} else if (mode === "rerun") {
  const { p, data } = baseInput();
  input = data;
  console.log(`기준 입력 ${input.rows.length}명을 다시 돌립니다 (받기 없음, ${path.relative(DIR, p)})`);
} else {
  const verified = readJson(P.verified, {});
  const list = d1("select owner, t from prefs where k='terra-archive-infra-v3'");
  const targets = list.filter((r) => mode === "all" || !(verified[r.owner] >= r.t)).map((r) => r.owner);
  console.log(`설정 ${list.length}명 · 검증완료 ${list.length - targets.length}명 · 이번 대상 ${targets.length}명`);
  const rows = [];
  for (let i = 0; i < targets.length; i += 60) {
    rows.push(...d1(`select owner, t, d from prefs where k='terra-archive-infra-v3' and owner in (${targets.slice(i, i + 60).map(sqlq).join(",")})`));
    process.stdout.write(`\r받는 중 ${Math.min(i + 60, targets.length)}/${targets.length}`);
  }
  process.stdout.write("\n");
  const side = {};
  for (let i = 0; i < targets.length; i += 300) {
    for (const r of d1(`select owner, k, d from prefs where k in (${SIDE_KEYS.map(sqlq).join(",")}) and owner in (${targets.slice(i, i + 300).map(sqlq).join(",")})`)) (side[r.owner] ??= {})[r.k] = r.d;
  }
  rows.sort((a, b) => a.owner.localeCompare(b.owner));
  input = { rows, side };
}
const prevRun = completedRuns().at(-1);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const runDir = path.join(RUNS, stamp);
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, "input.json"), JSON.stringify(input));

// 엔진 번들 — 해시는 번들하는 그 내용으로 (판 도중 엔진을 고쳐도 이 판은 시작 때 엔진 기준이다)
const engine = engineHash();
const bundle = path.join(runDir, "engine.mjs");
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [path.join(ROOT, "app/planner-engine.ts"), "--bundle", "--format=esm", "--platform=node", `--outfile=${bundle}`, "--log-level=warning"]);
fs.writeFileSync(path.join(runDir, "meta.json"), JSON.stringify({ mode, rows: input.rows.length, engine, baseline: baseMeta?.runs?.at(-1)?.run ?? null, prev: prevRun ?? null, started: new Date().toISOString() }, null, 1));
const shards = Math.max(1, Math.min(input.rows.length, os.cpus().length - 1));
const t0 = Date.now();
// 진행률 — 작업자들이 한 줄씩 덧붙이는 결과 파일의 줄 수를 30초마다 센다
const countDone = () => Array.from({ length: shards }, (_, s) => { try { return fs.readFileSync(path.join(runDir, `res-${s}.jsonl`), "utf8").split("\n").filter(Boolean).length; } catch { return 0; } }).reduce((a, b) => a + b, 0);
const ticker = setInterval(() => {
  const done = countDone(), sec = (Date.now() - t0) / 1000;
  const eta = done ? Math.round((sec / done) * (input.rows.length - done) / 60) : "?";
  console.log(`진행 ${done}/${input.rows.length} · ${Math.round(sec / 60)}분 경과 · 남은 예상 ${eta}분`);
}, 30_000);
const prevRes = prevRun ? path.join(RUNS, prevRun, "res.jsonl") : "";
await Promise.all(Array.from({ length: shards }, (_, s) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(ROOT, "scripts/riic-audit-worker.mjs"), bundle, path.join(runDir, "input.json"), path.join(runDir, `res-${s}.jsonl`), String(s), String(shards), prevRes, P.basePlans], { stdio: ["ignore", "ignore", "inherit"] });
  child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`작업자 ${s} 실패 (${code})`))));
})));
clearInterval(ticker);
const res = [];
for (let s = 0; s < shards; s += 1) for (const l of fs.readFileSync(path.join(runDir, `res-${s}.jsonl`), "utf8").split("\n")) if (l.trim()) res.push(JSON.parse(l));
fs.writeFileSync(path.join(runDir, "res.jsonl"), res.map((r) => JSON.stringify(r)).join("\n") + "\n");
for (let s = 0; s < shards; s += 1) fs.rmSync(path.join(runDir, `res-${s}.jsonl`));

// ── 보고서 ────────────────────────────────────────────────────────────────────────────
const j = judge(res);
const { g } = j;
const f1 = (v) => (v == null ? "—" : v.toFixed(1));
const failures = GATE_KEYS.filter(([key]) => j[key].length).map(([key, label]) => `${label} ${j[key].length}명`);
const isGate = mode !== "pending";
const keepCount = {};
for (const r of j.ok) if (r.keep) keepCount[r.keep] = (keepCount[r.keep] ?? 0) + 1;
const KEEP_LABEL = { close: "유지(차이 5점 이하)", better: "새 편성(5점 넘게 높음)", priority: "우선 생산 바뀜", layout: "기지 구성 바뀜", slots: "자리 모자람", roster: "보유하지 않은 오퍼", pin: "고정 안 지킴", fresh: "빈 편성" };
const me = owner ? res.find((r) => r.owner === owner) : null;
const roomFreq = {};
for (const r of [...j.notFixpoint, ...j.cappedFix]) for (const k of r.polishRooms ?? []) roomFreq[k] = (roomFreq[k] ?? 0) + 1;
const list = (rows, fmt, n = 30) => rows.slice(0, n).map(fmt);
const lines = [
  `# 인프라 역검증 ${stamp} (${mode})`,
  `대상 ${res.length}명 · 오류 ${j.err.length} · 걸린 시간 ${Math.round((Date.now() - t0) / 1000)}초 (작업자 ${shards}) · 엔진 ${engine} · 기준선 ${baseMeta?.runs?.at(-1)?.run ?? "없음"}`,
  "",
  isGate ? `## 관문 — ${failures.length ? `✗ 걸림 (${failures.join(" · ")})` : "✓ 통과"}` : "## 판정 (이 판은 관문이 아니다 — 검증완료 아닌 계정만 돌았다)",
  `- 회귀 (기준선 대비 −${REGRESS}점 넘게 내려감): **${j.regress.length}명** · 기준선보다 오름 ${j.improvedBase.length}명`,
  `- 안정장치 위반 (자동편성을 누르면 지금 저장 편성보다 낮은 편성을 받음): **${j.keepViolation.length}명**`,
  `- 안정장치 채점 불일치 (안정장치가 본 지금 편성 점수 ≠ 다시 센 점수): **${j.keepMismatch.length}명**`,
  `- 다듬기 덜 끝남 (결과를 한 번 더 다듬으면 +${FIX}점 넘게 오름): **${j.notFixpoint.length}명**${j.cappedFix.length ? ` · 시도 상한에 걸려 덜 끝난 ${j.cappedFix.length}명은 따로(관문 제외)` : ""}${Object.keys(roomFreq).length ? ` — 자주 바뀐 방 ${Object.entries(roomFreq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(" · ")}` : ""}`,
  `- 채점 경로 불일치 (엔진 점수 ≠ 배치로 다시 센 점수, ±${LEDGER}점): **${j.ledger.length}명**`,
  "",
  "## 참고",
  me ? `- 운영자 계정 ${owner}: 저장 ${f1(me.saved)} · 자동편성 ${f1(me.autoRe)} · 받는 편성 ${f1(me.keepFinal)} (${KEEP_LABEL[me.keep] ?? "저장 편성 없음"})${me.baseRe != null ? ` · 기준선 ${f1(me.baseRe)}` : ""}` : `- 운영자 계정: ${owner ? "이 판에 없음" : ".riic-audit/owner.txt 없음"}`,
  `- 안정장치: ${Object.entries(keepCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${KEEP_LABEL[k] ?? k} ${n}`).join(" · ") || "저장 편성 없음"}`,
  `- 엔진이 놓친 조합 (저장 편성 > 자동편성 +${MISS}점 — 안정장치가 저장 편성을 지킨다): ${j.miss.length}명`,
  prevRun ? `- 지난 판(${prevRun}) 대비 — 오름 ${j.improvedPrev.length}명 · 내려감 ${j.regressPrev.length}명 (참고 — 판정은 기준선으로)` : "- 지난 판 없음",
  `- 다듬기 시도 상한에 걸린 사람: ${j.ok.filter((r) => r.polishCapped).length}명`,
  `- 장기 지속 모드(엔진이 일부러 안 다듬는다) 중 한 번 다듬으면 +${FIX}점 넘게 오르는 사람: ${j.endlessPolish.length}명 — 이 모드 다듬기를 켤 때의 몫`,
  "",
  "## 회귀 (기준선 대비, 내려간 폭 큰 순 — 계정 · 폭 · 기준 판 · 고정 수)",
  ...list(j.regress.sort((a, b) => g(a.autoRe, a.baseRe, a) - g(b.autoRe, b.baseRe, b)), (r) => `- ${r.owner} · ${g(r.autoRe, r.baseRe, r).toFixed(1)} · ${r.baseRun} · 고정 ${r.pins}`),
  "",
  "## 안정장치 위반·채점 불일치",
  ...list([...j.keepViolation, ...j.keepMismatch], (r) => `- ${r.owner} · ${r.keep} · 저장 ${f1(r.saved)} · 안정장치가 본 지금 ${f1(r.keepBefore)} · 받는 편성 ${f1(r.keepFinal)}`),
  "",
  "## 다듬기 덜 끝남 (한 번 더 다듬으면 오르는 폭 · 바뀐 방)",
  ...list([...j.notFixpoint, ...j.cappedFix].sort((a, b) => g(b.polish, b.autoRe, b) - g(a.polish, a.autoRe, a)), (r) => `- ${r.owner} · +${g(r.polish, r.autoRe, r).toFixed(1)} · ${(r.polishRooms ?? []).join(",")}${r.polishCapped ? " · 시도 상한" : ""}`),
  "",
  "## 놓친 폭 큰 순 (계정 · 놓친 점수 · 고정 수 · 우선 생산)",
  ...list(j.miss.sort((a, b) => g(b.saved, b.autoRe, b) - g(a.saved, a.autoRe, a)), (r) => `- ${r.owner} · ${g(r.saved, r.autoRe, r).toFixed(1)} · 고정 ${r.pins} · ${r.priority}`),
  "",
  "## 지난 판 대비 내려간 사람 (참고)",
  ...list(j.regressPrev.sort((a, b) => g(a.autoRe, a.prevRe, a) - g(b.autoRe, b.prevRe, b)), (r) => `- ${r.owner} · ${g(r.autoRe, r.prevRe, r).toFixed(1)} · 고정 ${r.pins}`),
  "",
  "## 오류",
  ...list(j.err, (r) => `- ${r.owner} · ${r.err}`),
];
// 상식 검사 — 점수와 무관한 모양(A조 < B조·빈 칸·이중 근무·같은 팀 % 급변). 채점 공식이 틀려도 잡히는 쪽 (riic-audit-sanity.mjs)
const sanityOut = execFileSync(process.execPath, [path.join(ROOT, "scripts/riic-audit-sanity.mjs"), runDir, prevRun ? path.join(RUNS, prevRun) : ""], { maxBuffer: 1 << 26 }).toString().trim();
const at = lines.indexOf("## 회귀 (기준선 대비, 내려간 폭 큰 순 — 계정 · 폭 · 기준 판 · 고정 수)");
lines.splice(at, 0, "## 상식 검사 (점수와 무관)", ...sanityOut.split("\n").map((l) => (l.startsWith("  ") ? `- ${l.trim()}` : l)), "");
fs.writeFileSync(path.join(runDir, "report.md"), lines.join("\n") + "\n");
const { added, size } = addWatch(j, stamp);
if (isGate) {
  const changed = engineHash() !== engine;
  fs.writeFileSync(P.gate, JSON.stringify({ engine, run: stamp, mode, rows: res.length, at: new Date().toISOString(), pass: !failures.length, failures, runDir }, null, 1));
  if (changed) console.log(`⚠ 판 도중 엔진이 바뀌었습니다 — 이 판은 시작 때 엔진(${engine}) 기준이라 지금 엔진의 관문이 아닙니다`);
}
console.log(lines.slice(0, 18).join("\n"));
console.log(`관문 명단: 새로 ${added}명 (명단 ${size}명)`);
console.log(`보고서: ${path.join(runDir, "report.md")}`);
