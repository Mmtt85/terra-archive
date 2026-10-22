#!/usr/bin/env node
// 인프라 한 계정 점검 — 엔진을 고친 뒤 **배포 전에 반드시** 사용자 계정으로 돌린다 (INFRA-FAILURES '반복된 작업 방식 실패' 1).
// 지금 작업 트리 엔진으로 자동편성 → 안정장치(화면과 같은 keepIfClose)까지 돌려, 그 사람이 자동편성을 눌렀을 때 받는 편성과
// 지금 저장 편성의 총점을 나란히 찍는다. '한 번 더 다듬기'로 오르면 다듬기가 덜 끝난 것(고정점이 아님)이다.
//
//   node scripts/riic-one.mjs                 # .riic-audit/owner.txt 의 계정 (운영자 본인 계정)
//   node scripts/riic-one.mjs p:kr:12345678   # 그 계정
//   node scripts/riic-one.mjs --fresh         # D1 에서 그 계정 설정을 새로 받아서 (기본은 기준선 입력 → 마지막 전체 판 입력)
import fs from "node:fs";
import path from "node:path";
import { auditDir, loadEngine, setupAccount, rescore, d1, sqlq, SIDE_KEYS, readJson } from "./riic-lib.mjs";

const args = process.argv.slice(2);
const DIR = auditDir();
const owner = args.find((a) => !a.startsWith("--")) ?? (() => { try { return fs.readFileSync(path.join(DIR, "owner.txt"), "utf8").trim(); } catch { return ""; } })();
if (!owner) { console.error("계정을 주거나 .riic-audit/owner.txt 에 적어 두세요 (예: p:kr:12345678)"); process.exit(2); }

let row, sd;
if (args.includes("--fresh")) {
  [row] = d1(`select owner, t, d from prefs where k='terra-archive-infra-v3' and owner=${sqlq(owner)}`);
  sd = {};
  for (const r of d1(`select k, d from prefs where owner=${sqlq(owner)} and k in (${SIDE_KEYS.map(sqlq).join(",")})`)) sd[r.k] = r.d;
} else {
  // 받아 둔 입력 중 그 계정 설정이 **가장 새로운** 것 (기준 입력은 며칠 묵을 수 있다 — 운영자 계정은 지금 저장 편성으로 봐야 한다)
  const base = readJson(path.join(DIR, "baseline.json"), null);
  const runs = fs.existsSync(path.join(DIR, "runs")) ? fs.readdirSync(path.join(DIR, "runs")) : [];
  const inputs = [...new Set([base?.input, ...runs.map((d) => path.join(DIR, "runs", d, "input.json"))])].filter((p) => p && fs.existsSync(p));
  let from = "";
  for (const p of inputs) {
    const input = readJson(p, null);
    const r = input?.rows?.find((x) => x.owner === owner);
    if (r && (!row || r.t > row.t)) { row = r; sd = input.side?.[owner] ?? {}; from = p; }
  }
  if (row) console.log(`입력: ${path.relative(DIR, from)} (가장 새로운 설정)`);
}
if (!row) { console.error(`${owner} 설정을 못 찾았습니다 (--fresh 로 D1 에서 받아 보세요)`); process.exit(1); }

const tmp = path.join(DIR, `engine-one-${process.pid}.mjs`);
fs.mkdirSync(DIR, { recursive: true });
const E = await loadEngine(tmp);
fs.rmSync(tmp, { force: true });
const a = setupAccount(E, row, sd);
const { roster, byId, priority, pins, dorms, saved } = a;
const name = new Map(E.ops.map((o) => [o.id, o.name]));
const diff = (p, q) => Object.keys({ ...p.assignments, ...q.assignments }).filter((k) => JSON.stringify(p.assignments[k]) !== JSON.stringify(q.assignments[k]))
  .map((k) => `   ${k}: ${JSON.stringify((p.assignments[k] ?? []).map((t) => t.map((id) => name.get(id) ?? id)))} → ${JSON.stringify((q.assignments[k] ?? []).map((t) => t.map((id) => name.get(id) ?? id)))}`);
const sc = (p) => rescore(E, p, p.assignments, byId, priority);

console.log(`계정 ${owner} · 설정 저장 ${new Date(row.t).toLocaleString("ko-KR")} · 보유 ${roster.length} · ${a.layout} · ${priority} · 고정 ${a.pinCount}`);
const savedV = saved ? sc(saved) : null;
console.log(`지금 저장 편성: ${savedV == null ? "없음" : savedV.toFixed(2)}`);
E.resetPolishStats();
const t0 = Date.now();
const cfg = await E.optimizeConfig(roster, priority, undefined, dorms, pins);
const st = { ...E.POLISH_STATS };
const autoV = sc(cfg.plan);
console.log(`자동편성: ${autoV.toFixed(2)} (엔진 점수 ${E.planScore({ ...cfg.plan, shiftHours: undefined }, byId).toFixed(2)}) · ${((Date.now() - t0) / 1000).toFixed(1)}초 · 다듬기 ${st.calls}번 ${st.rounds}판 시도 ${st.evals}${st.capped ? ` · ⚠ 시도 상한에 걸린 다듬기 ${st.capped}번` : ""}`);
const again = E.polishPlan(cfg.plan, E.autoRoster(roster, dorms, pins), dorms, pins);
if (again === cfg.plan || sc(again) <= autoV + 0.5) console.log("한 번 더 다듬기: 그대로 (고정점)");
else { console.log(`⚠ 한 번 더 다듬기: ${autoV.toFixed(2)} → ${sc(again).toFixed(2)} — 다듬기가 덜 끝났다`); for (const l of diff(cfg.plan, again)) console.log(l); }
if (saved) {
  const k = E.keepIfClose(saved, cfg.plan, roster, dorms, pins);
  const info = k.plan.stability;
  const label = { fresh: "빈 편성", priority: "우선 생산이 바뀜", layout: "기지 구성이 바뀜", slots: "자리가 모자람", roster: "보유하지 않은 오퍼", pin: "고정을 안 지킴", better: "새 편성이 5점 넘게 높음", close: "차이 5점 이하" }[k.reason];
  if (k.kept) {
    const d = info.after - info.before;
    console.log(`안정장치: 지금 편성 유지 (${label}) · 지금 ${info.before.toFixed(2)} · 새 ${info.after.toFixed(2)} → ${d > 0.05 ? `화면이 바꿀지 묻는다 (+${d.toFixed(2)})` : "묻지 않고 그대로 둔다"}`);
    if (d > 0.05) for (const l of diff(saved, k.plan.kept.next)) console.log(l);
  } else {
    const fin = sc(k.plan);
    console.log(`안정장치: 새 편성 (${label})${info?.before != null ? ` · 지금 ${info.before.toFixed(2)} → 새 ${info.after.toFixed(2)}` : ""} · 받는 편성 ${fin.toFixed(2)}`);
    if (savedV != null && (k.reason === "better") && fin < savedV - 0.05) console.log("✗ 안정장치 위반 — 비교했는데 받는 편성이 지금보다 낮다");
  }
}
