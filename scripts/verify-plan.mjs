#!/usr/bin/env node
// 인프라 플래너 회귀 검증 하네스 — 엔진(app/planner-engine.ts)을 esbuild로 번들해 노드에서
// 실행하고, ① rules.json의 픽스처(검증된 정배·절대룰 불변식)와 ② 선택적으로 편성 스냅샷을 검사한다.
// 엔진·rules.json·build-infra.py를 고쳤으면 커밋 전에 반드시 통과시킬 것 (INFRA-RULES §10).
//
//   node scripts/verify-plan.mjs                     # 픽스처 검사
//   node scripts/verify-plan.mjs --snapshot out.json # 현재 엔진의 편성 스냅샷 저장
//   node scripts/verify-plan.mjs --compare out.json  # 저장된 스냅샷과 현재 편성 비교 (리팩토링 무변화 증명)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "app/data/rules.json"), "utf8"));

// ── 엔진 번들 (React 없음 — 그대로 노드에서 돈다) ─────────────────────────────
const bundle = path.join(os.tmpdir(), `planner-engine-${process.pid}.mjs`);
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [
  path.join(ROOT, "app/planner-engine.ts"),
  "--bundle", "--format=esm", "--platform=node", `--outfile=${bundle}`, "--log-level=warning",
]);
const engine = await import(pathToFileURL(bundle).href);
fs.rmSync(bundle, { force: true });
const { optimize, teamScore, ops, cellByKey, LAYOUT, PARK_KEYS, aurasOf, withElite, maxElite } = engine;

// 육성 추천 엔진(planner-invest.ts)도 번들 — recommendRaises 불변식 검사용.
// 순수 함수 호출(visibleOps를 인자로 받음)이라 엔진 인스턴스가 달라도 안전하다.
const invBundle = path.join(os.tmpdir(), `planner-invest-${process.pid}.mjs`);
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [
  path.join(ROOT, "app/planner-invest.ts"),
  "--bundle", "--format=esm", "--platform=node", `--outfile=${invBundle}`, "--log-level=warning",
]);
const { recommendRaises } = await import(pathToFileURL(invBundle).href);
fs.rmSync(invBundle, { force: true });

// ── 결정적 로스터 세트 (스냅샷·픽스처 공용) ──────────────────────────────────
const released = ops.filter((o) => !o.unreleased);
const rosters = {
  full: released,
  withFuture: ops,
  no6: released.filter((o) => o.rarity <= 5),
  no56: released.filter((o) => o.rarity <= 4),
  evenSeq: released.filter((o) => o.seq % 2 === 0),
  early150: [...released].sort((a, b) => a.seq - b.seq).slice(0, 150),
};

const planCache = new Map();
async function planFor(rosterName = "full", priority = "gold") {
  const key = `${rosterName}/${priority}`;
  if (!planCache.has(key)) {
    const roster = rosters[rosterName];
    if (!roster) throw new Error(`unknown roster: ${rosterName}`);
    planCache.set(key, optimize(roster, priority)); // Promise 캐시 — 중복 계산 방지
  }
  return planCache.get(key);
}

const opName = new Map(ops.map((o) => [o.id, o.name]));
const names = (ids) => ids.map((id) => opName.get(id) ?? id).join(", ");

// ── 스냅샷 모드 ──────────────────────────────────────────────────────────────
const mode = process.argv[2];
const file = process.argv[3];
async function takeSnapshot() {
  const out = {};
  for (const name of Object.keys(rosters)) {
    out[name] = {};
    for (const priority of ["gold", "exp", "balance"]) {
      const p = await planFor(name, priority);
      out[name][priority] = {
        assignments: p.assignments, plants: p.plants,
        tokenPoints: p.tokenPoints, strategy: p.strategy, strategySet: !!p.strategySet,
      };
    }
  }
  return out;
}
if (mode === "--snapshot") {
  fs.writeFileSync(file, JSON.stringify(await takeSnapshot(), null, 1));
  console.log("스냅샷 저장 →", file);
  process.exit(0);
}
if (mode === "--compare") {
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  const current = await takeSnapshot();
  let diffs = 0;
  for (const r of Object.keys(saved)) for (const p of Object.keys(saved[r])) {
    const a = JSON.stringify({ ...saved[r][p], ms: undefined });
    const b = JSON.stringify({ ...current[r]?.[p], ms: undefined });
    if (a !== b) { diffs += 1; console.error(`DIFF: ${r}/${p}`); }
  }
  if (diffs) { console.error(`✗ 스냅샷과 ${diffs}개 편성이 다릅니다`); process.exit(1); }
  console.log(`✓ 스냅샷 일치 (${Object.keys(saved).length}개 로스터 × 3모드)`);
  process.exit(0);
}

// ── 픽스처 검사 (rules.json fixtures — 검증된 정배·절대룰) ────────────────────
const workRoom = (key) => {
  const room = cellByKey.get(key)?.room ?? key;
  return room !== "DORMITORY" && room !== "WORKSHOP";
};
let failed = 0;
for (const fx of rules.fixtures) {
  let ok = false;
  let detail = "";
  try {
    if (fx.type === "invariant") {
      const plan = await planFor(fx.roster, fx.priority);
      if (fx.check === "noDualShift") {
        // 근무 방 기준 A·B 동시 배치 금지 (숙소·가공소 예외 — INFRA-RULES §1)
        const shiftIds = [0, 1].map((s) => new Set(
          LAYOUT.filter((c) => workRoom(c.key)).flatMap((c) => {
            const shifts = plan.assignments[c.key] ?? [];
            return shifts[Math.min(s, shifts.length - 1)] ?? [];
          }),
        ));
        const dup = [...shiftIds[0]].filter((id) => shiftIds[1].has(id));
        ok = dup.length === 0;
        detail = dup.length ? `중복: ${names(dup)}` : "";
      } else if (fx.check === "trainingEmpty") {
        ok = (plan.assignments["TRAINING"] ?? []).every((team) => team.length === 0);
      } else if (fx.check === "parkBEmpty") {
        // 가공소(상시 슬롯)는 A조 한 팀만 — B조 칸은 비워 둔다 (사용자 확정 2026-07-19)
        ok = PARK_KEYS.every((key) => ((plan.assignments[key] ?? [])[1] ?? []).length === 0);
      } else throw new Error(`unknown check: ${fx.check}`);
    } else if (fx.type === "planContains") {
      const plan = await planFor(fx.roster, fx.priority);
      const cells = fx.roomKey ? [fx.roomKey]
        : LAYOUT.filter((c) => c.room === fx.roomType).map((c) => c.key);
      // roomType이면 "그 종류의 어느 한 방에 allOf 전원이 함께" — 같은 방 동반 판정.
      // anyOf가 있으면 그 방에 anyOf 중 1명 이상도 함께 있어야 한다 (동급 대체군 —
      // 예: 샤마르+테킬라 방의 품질 요원은 미틈·디아만테·카프카·바이비크 중 아무나)
      ok = cells.some((key) => {
        const shifts = plan.assignments[key] ?? [];
        const team = new Set(shifts[Math.min(fx.shift ?? 0, shifts.length - 1)] ?? []);
        return fx.allOf.every((id) => team.has(id)) && (!fx.anyOf || fx.anyOf.some((id) => team.has(id)));
      });
      if (!ok) detail = `기대 [${names(fx.allOf)}]${fx.anyOf ? ` + [${names(fx.anyOf)}] 중 1` : ""} — 미충족`;
    } else if (fx.type === "teamCompare") {
      const byId = new Map(ops.map((o) => [o.id, o]));
      const team = (ids) => ids.map((id) => {
        const op = byId.get(id);
        if (!op) throw new Error(`unknown op: ${id}`);
        return op;
      });
      const ctx = { product: fx.product, tokenPoints: {} };
      const better = teamScore(team(fx.better), fx.room, ctx);
      const worse = teamScore(team(fx.worse), fx.room, ctx);
      ok = better > worse;
      detail = `${better.toFixed(1)} vs ${worse.toFixed(1)}`;
    } else throw new Error(`unknown fixture type: ${fx.type}`);
  } catch (err) {
    ok = false;
    detail = String(err.message ?? err);
  }
  console.log(`${ok ? "✓" : "✗"} ${fx.name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
}
// ── 육성 추천 엔진 불변식 (planner-invest 반사실 추천) ────────────────────────
// 잘못 추천하면 유저가 실제 자원을 태우므로 신뢰 성질을 회귀로 못박는다. 소형 로스터(4성↓)로
// optimize 부담을 줄여 검사한다. 낮춘 오퍼가 없으면 후보 0(정상), 있으면 모든 추천이 가드를
// 통과해야 한다: ΔS>0 · 근무 방 배치됨 · 비용>0 · (방 하락 없음 또는 큰 시너지).
console.log("");
// 5성 포함 소형 로스터(seq 앞 140명) — 실제 추천이 나와 가드 검사가 공허하지 않도록.
const invRoster = ops.filter((o) => !o.unreleased && o.rarity <= 5).sort((a, b) => a.seq - b.seq).slice(0, 140);
const invRun = async (elite) => recommendRaises(invRoster, new Set(invRoster.map((o) => o.id)), elite, "gold");
const invCheck = async (name, fn) => {
  let ok = false; let detail = "";
  try { const r = await fn(); ok = r.ok; detail = r.detail ?? ""; }
  catch (err) { ok = false; detail = String(err.message ?? err); }
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

// ① 전원 최대 정예화면 후보 0 (완성할 게 없음)
await invCheck("육성추천: 만정예 로스터는 추천 0건", async () => {
  const recs = await invRun(new Map());
  return { ok: recs.length === 0, detail: `${recs.length}건` };
});

// 4·5성 중 정예화2 인프라 스킬 보유자 일부를 1정으로 낮춰 후보를 만든다 (결정적: seq 순 12명)
const lowerable = invRoster
  .filter((o) => o.rarity >= 4 && o.skills.some((s) => s.unlock === "정예화 2"))
  .sort((a, b) => a.seq - b.seq).slice(0, 12);
const loweredElite = new Map(lowerable.map((o) => [o.id, 1]));

let sharedRecs = null;
// ② 모든 추천이 신뢰 가드를 통과 (ΔS>0 · 배치됨 · 비용>0 · 방 하락 없음 or 큰 시너지)
await invCheck("육성추천: 모든 추천이 신뢰 가드 통과", async () => {
  sharedRecs = await invRun(loweredElite);
  for (const r of sharedRecs) {
    if (!(r.deltaScore > 0)) return { ok: false, detail: `${r.opId} ΔS=${r.deltaScore}` };
    if (!r.placement) return { ok: false, detail: `${r.opId} 배치 없음` };
    if (!(r.cost.lmd >= 0)) return { ok: false, detail: `${r.opId} 비용 이상` };
    const drop = r.roomDeltas.some((d) => d.after < d.before - 3);
    if (drop && r.deltaScore < 25) return { ok: false, detail: `${r.opId} 미보상 방하락` };
  }
  return { ok: true, detail: `${sharedRecs.length}건 검증` };
});

// ③ 결정론 — 같은 입력 두 번이 동일 (opId·ΔS)
await invCheck("육성추천: 결정론(재현성)", async () => {
  const again = await invRun(loweredElite);
  const sig = (rs) => JSON.stringify(rs.map((r) => [r.opId, Math.round(r.deltaScore * 100)]));
  return { ok: sig(again) === sig(sharedRecs ?? []), detail: `${again.length}건` };
});

// ④ 랭킹 단조 — A조 이득(aGain) 내림차순 정렬 보장 (동률 시 bGain)
await invCheck("육성추천: A조 이득 내림차순 정렬", async () => {
  const rs = sharedRecs ?? [];
  for (let i = 1; i < rs.length; i += 1) {
    const p = rs[i - 1]; const c = rs[i];
    if (c.aGain > p.aGain + 1e-9 || (Math.abs(c.aGain - p.aGain) < 1e-9 && c.bGain > p.bGain + 1e-9)) return { ok: false, detail: `#${i}` };
  }
  return { ok: true, detail: `${rs.length}건` };
});

// ── 제어센터 "무역소 내 진영 1명당" 오라는 방 단위 (노시스·델핀·야하타, 사용자 제보 2026-07-22) ──
// 노시스 '정밀 계산'(무역소 내 쉐라그 1명당 오더효율 -15%·상한 +6)은 **그 무역소에 앉은 쉐라그
// 수**로만 걸려야 한다 — 기지 전체 쉐라그 수(노시스 자신·타 무역소 포함)로 세거나, 쉐라그 0명
// 무역소에 유령 마이너스가 새면 안 된다. 종전 perScope="base"+flat 적용 버그의 회귀 잠금.
console.log("");
{
  const byId = new Map(ops.map((o) => [o.id, o]));
  const E = (id) => withElite(byId.get(id), maxElite(byId.get(id).rarity));
  const gnosis = E("char_206_gnosis");
  const withKjerag = [E("char_4032_provs"), E("char_172_svrash"), E("char_272_strong")]; // 실버애쉬=쉐라그 1
  const noKjerag = [E("char_455_nothin"), E("char_4046_ebnhlz"), E("char_4032_provs")];   // 쉐라그 0
  // base 쉐라그 수를 3으로 부풀려도(노시스 버그 조건) 방 점수는 방내 실제 쉐라그로만 결정돼야 한다
  const ambient = aurasOf([gnosis], { tokenPoints: {}, factionCounts: { 쉐라그: 3 }, plants: 3, presentIds: new Set([gnosis.id]) });
  const mk = (team, fc) => ({ product: "gold", tokenPoints: {}, factionCounts: { 쉐라그: fc }, plants: 3, presentIds: new Set(team.map((o) => o.id)), ambient });
  const noAura = (team) => teamScore(team, "TRADING", { ...mk(team, 0), ambient: [] });
  const checks = [
    // ① 쉐라그 0명 무역소: 노시스 오라가 있어도 없어도 점수 동일 (유령 마이너스 없음)
    ["쉐라그 0명 무역소엔 노시스 오라 0", Math.abs(teamScore(noKjerag, "TRADING", mk(noKjerag, 3)) - noAura(noKjerag)) < 1e-6],
    // ② 방내 쉐라그 1명: base 카운트를 3으로 부풀려도 1명 기준과 동일 (자기·타방 카운트 안 함)
    ["노시스 오라는 base가 아니라 방내 쉐라그로 스케일", Math.abs(teamScore(withKjerag, "TRADING", mk(withKjerag, 3)) - teamScore(withKjerag, "TRADING", mk(withKjerag, 1))) < 1e-6],
  ];
  for (const [name, ok] of checks) { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) failed += 1; }
}

if (failed) { console.error(`\n✗ 검사 ${failed}건 실패`); process.exit(1); }
console.log(`\n✓ 픽스처 ${rules.fixtures.length}건 + 육성추천 불변식 4건 + 노시스 오라 2건 전부 통과`);
