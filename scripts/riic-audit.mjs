#!/usr/bin/env node
// 인프라 플래너 역검증 (주 1회 — 사용자 결정 2026-10-20) — 사람들이 저장한 인프라 설정(보유·정예화·편성·고정)으로
// 지금 엔진을 다시 돌려, ① 손으로 짠 편성이 엔진보다 나은 경우(= 엔진이 놓친 조합) ② 엔진 점수와 배치로 다시 센 점수가
// 어긋나는 경우(= 채점 경로 불일치) ③ 지난 판보다 자동편성 점수가 내려간 사람(= 회귀)을 찾는다. 절차·판단은 riic-audit 스킬.
//
//   node scripts/riic-audit.mjs                 # 검증완료가 아닌 계정만 (처음이거나, 검증한 뒤 설정이 바뀐 계정)
//   node scripts/riic-audit.mjs --all           # 전원 다시 (엔진을 고친 뒤 '역의 역검증')
//   node scripts/riic-audit.mjs --rerun         # 마지막 판과 같은 계정을 다시 (받기 없이 — 고친 엔진 확인용)
//   node scripts/riic-audit.mjs --mark          # 이번 판에서 문제 없던 계정을 검증완료로 기록
//
// 검증완료 = .riic-audit/verified.json 의 {계정: 그때 설정의 t}. 설정 저장소(D1 prefs)의 t 는 그 사람이 설정을 바꿀 때마다
// (자동편성을 다시 돌리면 편성이 저장되므로 그때도) 오른다 — t 가 커진 계정은 저절로 다시 대상이 된다(사용자 제안 "자동편성을
// 돌리면 플래그를 false 로"와 같은 효과). 사용자 계정에 플래그 키를 쓰지 않는다(그 사람 브라우저로 동기화되고 쓰기가 는다).
// 받은 설정·결과는 .riic-audit/ 에만 둔다 (gitignore — 남의 계정 데이터다).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, ".riic-audit");
const ACCOUNT = path.join(ROOT, "workers", "account");
const args = new Set(process.argv.slice(2));
fs.mkdirSync(path.join(DIR, "runs"), { recursive: true });
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const verifiedPath = path.join(DIR, "verified.json");
const verified = readJson(verifiedPath, {});

function d1(sql) {
  const raw = execFileSync("npx", ["wrangler", "d1", "execute", "terra-archive-prefs", "--remote", "--json", "--command", sql],
    { cwd: ACCOUNT, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] }).toString();
  return JSON.parse(raw)[0].results;
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// 끝까지 간 판(결과 res.jsonl 이 있는 판)만 '지난 판'으로 — 중간에 멈춘 판을 고르면 보고서 단계에서 죽었다 (2026-10-21)
const runs = fs.readdirSync(path.join(DIR, "runs")).sort().filter((d) => fs.existsSync(path.join(DIR, "runs", d, "res.jsonl")));
const prevRun = runs.at(-1);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const runDir = path.join(DIR, "runs", stamp);
let input;
if (args.has("--rerun")) {
  if (!prevRun) throw new Error("다시 돌릴 지난 판이 없습니다");
  input = readJson(path.join(DIR, "runs", prevRun, "input.json"));
  console.log(`지난 판(${prevRun})과 같은 ${input.rows.length}명을 다시 돌립니다 (받기 없음)`);
} else {
  const list = d1("select owner, t from prefs where k='terra-archive-infra-v3'");
  const targets = list.filter((r) => args.has("--all") || !(verified[r.owner] >= r.t)).map((r) => r.owner);
  console.log(`설정 ${list.length}명 · 검증완료 ${list.length - targets.length}명 · 이번 대상 ${targets.length}명`);
  const rows = [];
  for (let i = 0; i < targets.length; i += 60) {
    const inList = targets.slice(i, i + 60).map(q).join(",");
    rows.push(...d1(`select owner, t, d from prefs where k='terra-archive-infra-v3' and owner in (${inList})`));
    process.stdout.write(`\r받는 중 ${Math.min(i + 60, targets.length)}/${targets.length}`);
  }
  process.stdout.write("\n");
  const side = {};
  for (let i = 0; i < targets.length; i += 300) {
    const inList = targets.slice(i, i + 300).map(q).join(",");
    for (const r of d1(`select owner, k, d from prefs where k in ('terra-archive-infra-recycle','terra-archive-infra-training','ta-include-future') and owner in (${inList})`)) (side[r.owner] ??= {})[r.k] = r.d;
  }
  rows.sort((a, b) => a.owner.localeCompare(b.owner));
  input = { rows, side };
}
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, "input.json"), JSON.stringify(input));

// 엔진 번들 (verify-plan.mjs 와 같은 방식)
const bundle = path.join(runDir, "engine.mjs");
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [path.join(ROOT, "app/planner-engine.ts"), "--bundle", "--format=esm", "--platform=node", `--outfile=${bundle}`, "--log-level=warning"]);
const shards = Math.max(1, Math.min(input.rows.length, os.cpus().length - 1));
const t0 = Date.now();
// 진행률 — 작업자들이 한 줄씩 덧붙이는 결과 파일의 줄 수를 30초마다 센다
const countDone = () => Array.from({ length: shards }, (_, s) => { try { return fs.readFileSync(path.join(runDir, `res-${s}.jsonl`), "utf8").split("\n").filter(Boolean).length; } catch { return 0; } }).reduce((a, b) => a + b, 0);
const ticker = setInterval(() => {
  const done = countDone(), sec = (Date.now() - t0) / 1000;
  const eta = done ? Math.round((sec / done) * (input.rows.length - done) / 60) : "?";
  console.log(`진행 ${done}/${input.rows.length} · ${Math.round(sec / 60)}분 경과 · 남은 예상 ${eta}분`);
}, 30_000);
await Promise.all(Array.from({ length: shards }, (_, s) => new Promise((resolve, reject) => {
  const prevRes = prevRun && prevRun !== stamp ? path.join(DIR, "runs", prevRun, "res.jsonl") : "";
  const child = spawn(process.execPath, [path.join(ROOT, "scripts/riic-audit-worker.mjs"), bundle, path.join(runDir, "input.json"), path.join(runDir, `res-${s}.jsonl`), String(s), String(shards), prevRes], { stdio: ["ignore", "ignore", "inherit"] });
  child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`작업자 ${s} 실패 (${code})`))));
})));
clearInterval(ticker);
const res = [];
for (let s = 0; s < shards; s += 1) for (const l of fs.readFileSync(path.join(runDir, `res-${s}.jsonl`), "utf8").split("\n")) if (l.trim()) res.push(JSON.parse(l));
fs.writeFileSync(path.join(runDir, "res.jsonl"), res.map((r) => JSON.stringify(r)).join("\n") + "\n");
for (let s = 0; s < shards; s += 1) fs.rmSync(path.join(runDir, `res-${s}.jsonl`));

// ── 판정 ── 장기 지속(소모) 모드는 점수 단위가 100만대라 비율로 본다
const big = (r) => Math.abs(r.auto ?? 0) > 1e5;
const gap = (a, b, r) => (big(r) ? (a - b) / Math.abs(b) * 2000 : a - b);   // 2000점 기지 기준 환산
const MISS = 5, LEDGER = 1, REGRESS = 0.5;
const prev = new Map();
if (prevRun && prevRun !== stamp) for (const l of fs.readFileSync(path.join(DIR, "runs", prevRun, "res.jsonl"), "utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l); prev.set(r.owner, r); }
const ok = res.filter((r) => !r.err && r.auto != null);
const miss = ok.filter((r) => r.saved != null && gap(r.saved, r.autoRe, r) > MISS);
const ledger = ok.filter((r) => Math.abs(gap(r.autoRe, r.auto, r)) > LEDGER);
// 회귀는 같은 채점(배치에서 다시 센 점수 autoRe)끼리 — 엔진 자체 점수는 판마다 원장 계산이 달라질 수 있다
const sc = (r) => r?.autoRe ?? r?.auto;
// 지난 판 기준값 = 지난 판 편성을 **지금 채점으로** 다시 매긴 값(prevRe). 없으면 지난 판에 적힌 값
const base = (r) => r.prevRe ?? sc(prev.get(r.owner));
const regress = ok.filter((r) => prev.has(r.owner) && base(r) != null && gap(sc(r), base(r), r) < -REGRESS);
const polishGain = ok.filter((r) => r.polish != null && gap(r.polish, r.autoRe, r) > MISS);
const roomFreq = {};
for (const r of polishGain) for (const k of r.polishRooms ?? []) roomFreq[k] = (roomFreq[k] ?? 0) + 1;
const improved = ok.filter((r) => prev.has(r.owner) && base(r) != null && gap(sc(r), base(r), r) > REGRESS);
const lines = [
  `# 인프라 역검증 ${stamp}`,
  `대상 ${res.length}명 · 오류 ${res.length - ok.length} · 걸린 시간 ${Math.round((Date.now() - t0) / 1000)}초 (작업자 ${shards})`,
  `- 엔진이 놓친 조합 (저장 편성 > 자동편성 +${MISS}점): **${miss.length}명**`,
  `- 채점 경로 불일치 (엔진 점수 ≠ 배치로 다시 센 점수, ±${LEDGER}점): **${ledger.length}명**`,
  `- 탐지기(마무리 교체)가 +${MISS}점 넘게 올린 사람: **${polishGain.length}명** — 자주 바뀐 방 ${Object.entries(roomFreq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(" · ")}`,
  prev.size ? `- 지난 판(${prevRun}) 대비 자동편성 점수 — 오름 ${improved.length}명 · **내려감 ${regress.length}명**` : "- 지난 판 없음 (회귀 비교 생략)",
  "",
  "## 놓친 폭 큰 순 (계정 · 놓친 점수 · 고정 수 · 우선 생산)",
  ...miss.sort((a, b) => gap(b.saved, b.autoRe, b) - gap(a.saved, a.autoRe, a)).slice(0, 30)
    .map((r) => `- ${r.owner} · ${gap(r.saved, r.autoRe, r).toFixed(1)} · 고정 ${r.pins} · ${r.priority}`),
  "",
  "## 내려간 사람 (고정을 새로 지키게 된 경우 등은 정상일 수 있다 — 하나씩 볼 것)",
  ...regress.sort((a, b) => gap(sc(a), base(a), a) - gap(sc(b), base(b), b)).slice(0, 30).map((r) => `- ${r.owner} · ${gap(sc(r), base(r), r).toFixed(1)} · 고정 ${r.pins}`),
];
// 상식 검사 — 점수와 무관한 모양(A조 < B조·빈 칸·이중 근무·같은 팀 % 급변). 채점 공식이 틀려도 잡히는 쪽 (riic-audit-sanity.mjs)
const sanityOut = execFileSync(process.execPath, [path.join(ROOT, "scripts/riic-audit-sanity.mjs"), runDir, prevRun && prevRun !== stamp ? path.join(DIR, "runs", prevRun) : ""], { maxBuffer: 1 << 26 }).toString().trim();
lines.splice(6, 0, "", "## 상식 검사 (점수와 무관)", ...sanityOut.split("\n").map((l) => (l.startsWith("  ") ? `- ${l.trim()}` : l)));
fs.writeFileSync(path.join(runDir, "report.md"), lines.join("\n") + "\n");
console.log(lines.slice(0, 6).join("\n"));
console.log(sanityOut);
console.log(`보고서: ${path.join(runDir, "report.md")}`);

if (args.has("--mark")) {
  const sanity = JSON.parse(fs.readFileSync(path.join(runDir, "sanity.json"), "utf8"));
  const bad = new Set([...miss, ...ledger].map((r) => r.owner));
  for (const r of sanity.rows) if (r.flags.some((f) => ["A<B", "빈 칸", "이중 근무", "같은 팀 % 급변"].includes(f.kind))) bad.add(r.owner);   // 상식 검사에 걸린 사람도 다음 판에 다시
  let n = 0;
  for (const r of ok) if (!bad.has(r.owner) && r.t) { verified[r.owner] = r.t; n += 1; }
  fs.writeFileSync(verifiedPath, JSON.stringify(verified, null, 1));
  console.log(`검증완료 기록 ${n}명 (문제 있던 ${bad.size}명은 다음 판에 다시 본다)`);
}
