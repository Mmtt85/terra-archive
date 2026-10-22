// 인프라 역검증 작업자 — riic-audit.mjs 가 띄운다. 사람마다 ① 저장된 편성(손 편집 포함) 점수 ② 지금 엔진 자동편성 점수
// ③ 엔진 결과를 배치에서 다시 센 점수(두 채점 경로가 같은지) ④ 기준선·지난 판 편성을 지금 채점으로 다시 매긴 점수(회귀)
// ⑤ 그 사람이 지금 자동편성을 누르면 받는 편성(화면과 같은 안정장치 keepIfClose) ⑥ 결과를 한 번 더 다듬은 점수(고정점인가)를 잰다.
//   node riic-audit-worker.mjs <엔진번들> <입력.json> <출력.jsonl> <shard> <shards> [지난 판 res.jsonl] [기준선 baseline.jsonl]
// 기지 설정은 riic-lib.mjs setupAccount (화면 planner-worker.ts 와 같은 순서).
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { setupAccount, rescore, ownsAll, readJsonl } from "./riic-lib.mjs";

const [bundle, inPath, outPath, shardS, shardsS, prevPath, basePath] = process.argv.slice(2);
const E = await import(pathToFileURL(bundle).href);
const shard = Number(shardS), shards = Number(shardsS);
const { rows, side } = JSON.parse(fs.readFileSync(inPath, "utf8"));
// 지난 판 자동편성 — **지금 채점으로 다시 매겨** 비교한다 (채점 공식이 바뀐 판끼리도 같은 기준, 2026-10-20). 참고용
const prevPlans = new Map(readJsonl(prevPath).filter((p) => p.autoPlan).map((p) => [p.owner, p.autoPlan]));
// 기준선 — 배포된 엔진들이 그 사람에게 낸 편성 중 지금 채점으로 가장 높은 것(riic-audit --promote). 회귀 판정은 이것과만 한다.
// '지난 판 대비'는 판마다 기준이 옮겨 가서, 한 번 넘어간 회귀가 다음 판에서 사라졌다 (2026-10-21: 16명 최대 −18.2 가 그렇게 묻혔다)
const basePlans = new Map(readJsonl(basePath).map((b) => [b.owner, b]));
fs.writeFileSync(outPath, "");   // 한 사람 끝날 때마다 바로 덧붙인다 — 계산이 이벤트 루프를 붙잡아 스트림 쓰기는 끝까지 밀렸다(진행률이 안 보였다)

for (let i = shard; i < rows.length; i += shards) {
  const r = rows[i];
  const rec = { owner: r.owner, t: r.t };
  try {
    const a = setupAccount(E, r, side?.[r.owner] ?? {});
    const { roster, byId, priority, pins, dorms, saved } = a;
    Object.assign(rec, { n: roster.length, layout: a.layout, priority, fut: a.fut, server: a.server, pins: a.pinCount });
    E.resetPolishStats();
    const t0 = Date.now();
    const cfg = await E.optimizeConfig(roster, priority, undefined, dorms, pins);
    rec.ms = Date.now() - t0;
    rec.polishCapped = E.POLISH_STATS.capped;   // 시도 상한에 걸린 다듬기 수 — 걸렸으면 덜 다듬어졌을 수 있다
    rec.polishEvals = E.POLISH_STATS.evals;
    rec.auto = E.planScore({ ...cfg.plan, shiftHours: undefined }, byId);
    rec.autoRe = rescore(E, cfg.plan, cfg.plan.assignments, byId, priority);
    rec.sets = Object.keys(cfg.factionSets).join(",");
    const pp = prevPlans.get(r.owner);
    if (pp && ownsAll(pp, byId)) rec.prevRe = rescore(E, cfg.plan, pp, byId, priority);
    const bp = basePlans.get(r.owner);
    // 설정(t)이 기준선 때와 같을 때만 — 보유·고정이 바뀌었으면 내려가도 회귀가 아니다
    if (bp && bp.t === r.t && ownsAll(bp.plan, byId)) { rec.baseRe = rescore(E, cfg.plan, bp.plan, byId, priority); rec.baseRun = bp.run; }
    rec.autoPlan = cfg.plan.assignments;
    // 탐지기 — 결과를 한 번 더 다듬어 오르면 다듬기가 고정점에 못 닿은 것(엔진과 같은 명단·같은 다듬기).
    // 장기 지속(소모) 모드는 엔진이 일부러 안 다듬는다(채점 개편과 함께 켠다 — optimizeConfigCore polished) → 관문이 아니라 참고(endless)
    rec.endless = E.splitPriority(priority).drain === "endless";
    const pol = E.polishPlan(cfg.plan, E.autoRoster(roster, dorms, pins), dorms, pins);
    if (pol !== cfg.plan) {
      rec.polish = rescore(E, pol, pol.assignments, byId, priority);
      rec.polishRooms = E.LAYOUT.filter((c) => JSON.stringify(pol.assignments[c.key]) !== JSON.stringify(cfg.plan.assignments[c.key])).map((c) => c.key);
    }
    if (saved && Object.values(saved.assignments).some((shifts) => shifts.some((team) => team.length))) {
      const ids = Object.values(saved.assignments).flat(2);
      rec.savedForeign = ids.filter((id) => !byId.has(id)).length;   // 저장 뒤 보유가 바뀜 → 점수 비교 안 함
      if (!rec.savedForeign) { rec.saved = rescore(E, saved, saved.assignments, byId, priority); rec.savedPlan = saved.assignments; }
      // 안정장치 — 이 사람이 지금 자동편성을 누르면 받는 편성. 지금 편성을 남겼으면 그 편성(바꿀지 묻는 창은 새 편성이 더 높을 때만 뜬다)
      const k = E.keepIfClose(saved, cfg.plan, roster, dorms, pins);
      const info = k.plan.stability;
      rec.keep = k.reason;
      if (info?.before != null) { rec.keepBefore = info.before; rec.keepAfter = info.after; }
      rec.keepFinal = k.kept ? info.before : rescore(E, k.plan, k.plan.assignments, byId, priority);
    }
  } catch (e) { rec.err = String(e?.message ?? e).slice(0, 200); }
  fs.appendFileSync(outPath, JSON.stringify(rec) + "\n");
}
