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
const { optimize, teamScore, ops, cellByKey, LAYOUT } = engine;

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
function planFor(rosterName = "full", priority = "gold") {
  const key = `${rosterName}/${priority}`;
  if (!planCache.has(key)) {
    const roster = rosters[rosterName];
    if (!roster) throw new Error(`unknown roster: ${rosterName}`);
    planCache.set(key, optimize(roster, priority));
  }
  return planCache.get(key);
}

const opName = new Map(ops.map((o) => [o.id, o.name]));
const names = (ids) => ids.map((id) => opName.get(id) ?? id).join(", ");

// ── 스냅샷 모드 ──────────────────────────────────────────────────────────────
const mode = process.argv[2];
const file = process.argv[3];
function takeSnapshot() {
  const out = {};
  for (const name of Object.keys(rosters)) {
    out[name] = {};
    for (const priority of ["gold", "exp", "balance"]) {
      const p = planFor(name, priority);
      out[name][priority] = {
        assignments: p.assignments, plants: p.plants,
        tokenPoints: p.tokenPoints, strategy: p.strategy, strategySet: !!p.strategySet,
      };
    }
  }
  return out;
}
if (mode === "--snapshot") {
  fs.writeFileSync(file, JSON.stringify(takeSnapshot(), null, 1));
  console.log("스냅샷 저장 →", file);
  process.exit(0);
}
if (mode === "--compare") {
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  const current = takeSnapshot();
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
      const plan = planFor(fx.roster, fx.priority);
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
      } else throw new Error(`unknown check: ${fx.check}`);
    } else if (fx.type === "planContains") {
      const plan = planFor(fx.roster, fx.priority);
      const cells = fx.roomKey ? [fx.roomKey]
        : LAYOUT.filter((c) => c.room === fx.roomType).map((c) => c.key);
      // roomType이면 "그 종류의 어느 한 방에 allOf 전원이 함께" — 같은 방 동반 판정
      ok = cells.some((key) => {
        const shifts = plan.assignments[key] ?? [];
        const team = new Set(shifts[Math.min(fx.shift ?? 0, shifts.length - 1)] ?? []);
        return fx.allOf.every((id) => team.has(id));
      });
      if (!ok) detail = `기대 [${names(fx.allOf)}] — 미충족`;
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
if (failed) { console.error(`\n✗ 픽스처 ${failed}건 실패`); process.exit(1); }
console.log(`\n✓ 픽스처 ${rules.fixtures.length}건 전부 통과`);
