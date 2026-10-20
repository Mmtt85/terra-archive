// 인프라 역검증 작업자 — riic-audit.mjs 가 띄운다. 사람마다 ① 저장된 편성(손 편집 포함) 점수 ② 지금 엔진 자동편성 점수
// ③ 엔진 결과를 배치에서 다시 센 점수(두 채점 경로가 같은지)를 잰다.  node riic-audit-worker.mjs <엔진번들> <입력.json> <출력.jsonl> <shard> <shards>
// ⚠ 화면(planner-worker.ts)과 같은 순서로 기지 설정을 세운다: 재활용소 → 배치 → 시설 레벨 → 훈련실.
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const [bundle, inPath, outPath, shardS, shardsS, prevPath] = process.argv.slice(2);
const E = await import(pathToFileURL(bundle).href);
const shard = Number(shardS), shards = Number(shardsS);
const { rows, side } = JSON.parse(fs.readFileSync(inPath, "utf8"));
// 지난 판 자동편성 — **지금 채점으로 다시 매겨** 회귀를 본다 (채점 공식이 바뀐 판끼리도 같은 기준으로 비교, 2026-10-20)
const prevPlans = new Map();
if (prevPath && fs.existsSync(prevPath)) for (const l of fs.readFileSync(prevPath, "utf8").split("\n")) if (l.trim()) { const p = JSON.parse(l); if (p.autoPlan) prevPlans.set(p.owner, p.autoPlan); }
fs.writeFileSync(outPath, "");   // 한 사람 끝날 때마다 바로 덧붙인다 — 계산이 이벤트 루프를 붙잡아 스트림 쓰기는 끝까지 밀렸다(진행률이 안 보였다)

const rescore = (plan, assignments, byId, priority) => {
  const ledger = E.recountTokens(assignments, byId, E.flowsFromAssignments(assignments, byId));
  return E.planScore({ ...plan, assignments, priority, factionCounts: E.factionCountsFor(assignments, byId), shiftHours: undefined,
    ...(ledger ? { tokenPoints: ledger.tokenPoints, flows: ledger.flows } : {}) }, byId);
};

for (let i = shard; i < rows.length; i += shards) {
  const r = rows[i];
  const rec = { owner: r.owner, t: r.t };
  try {
    const s = JSON.parse(r.d);
    const sd = side[r.owner] ?? {};
    const server = r.owner.split(":")[1];
    const fut = sd["ta-include-future"] === "1";
    // 재활용소에 사람을 앉히는 건 중섭 계정만 (planner.tsx recycleJob 과 같은 규칙)
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
    const pins = bucket.roomPins ?? {}, dorms = bucket.dormPins ?? {};
    Object.assign(rec, { n: roster.length, layout, priority, fut, server, pins: Object.values(pins).flat().length + Object.values(dorms).flat().length });
    const t0 = Date.now();
    const cfg = await E.optimizeConfig(roster, priority, undefined, dorms, pins);
    rec.ms = Date.now() - t0;
    rec.auto = E.planScore({ ...cfg.plan, shiftHours: undefined }, byId);
    rec.autoRe = rescore(cfg.plan, cfg.plan.assignments, byId, priority);
    rec.sets = Object.keys(cfg.factionSets).join(",");
    const pp = prevPlans.get(r.owner);
    if (pp && Object.values(pp).flat(2).every((id) => byId.has(id))) rec.prevRe = rescore(cfg.plan, pp, byId, priority);
    rec.autoPlan = cfg.plan.assignments;
    // 탐지기 — 마무리 교체(polishPlan)가 같은 채점으로 더 올릴 수 있으면 엔진이 놓친 곳이다. 자동편성엔 안 붙어 있다(엔진 주석)
    const pol = E.polishPlan(cfg.plan, E.autoRoster(roster, dorms, pins), dorms, pins, { budgetMs: 15000 });   // 엔진과 같은 명단 (자동편성 제외 명단 빼고)
    if (pol !== cfg.plan) {
      rec.polish = rescore(pol, pol.assignments, byId, priority);
      rec.polishRooms = E.LAYOUT.filter((c) => JSON.stringify(pol.assignments[c.key]) !== JSON.stringify(cfg.plan.assignments[c.key])).map((c) => c.key);
    }
    const saved = E.sanitizePlan(bucket.plan ?? s.plan);
    if (saved) {
      const ids = Object.values(saved.assignments).flat(2);
      rec.savedForeign = ids.filter((id) => !byId.has(id)).length;   // 저장 뒤 보유가 바뀜 → 비교 안 함
      if (!rec.savedForeign) { rec.saved = rescore(saved, saved.assignments, byId, priority); rec.savedPlan = saved.assignments; }
    }
  } catch (e) { rec.err = String(e?.message ?? e).slice(0, 200); }
  fs.appendFileSync(outPath, JSON.stringify(rec) + "\n");
}
