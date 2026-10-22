// 인프라 역검증 공용 — 계정 하나의 기지 설정을 엔진에 세우고, 편성을 같은 채점으로 다시 매긴다.
// riic-audit-worker.mjs(907명)·riic-one.mjs(한 계정)·riic-audit.mjs(기준선)가 같이 쓴다 — 셋이 따로 세우면 순서·규칙이 어긋난다.
// ⚠ 화면(planner-worker.ts)과 같은 순서로 기지 설정을 세운다: 재활용소 → 배치 → 시설 레벨 → 훈련실.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 역검증 자료 폴더 — 남의 계정 데이터라 gitignore. 워크트리에서 돌려도 본 체크아웃의 폴더를 쓴다(git 공용 디렉터리의 부모) */
export function auditDir() {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ROOT }).toString().trim();
  return path.join(path.dirname(common), ".riic-audit");
}
export function gitCommonDir() {
  return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ROOT }).toString().trim();
}

/** 지금 작업 트리의 엔진을 노드용으로 번들해 불러온다 (verify-plan.mjs 와 같은 방식) */
export async function loadEngine(outfile) {
  execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [path.join(ROOT, "app/planner-engine.ts"), "--bundle", "--format=esm", "--platform=node", `--outfile=${outfile}`, "--log-level=warning"]);
  return import(pathToFileURL(outfile).href);
}

/** D1 설정 저장소 읽기 (workers/account 에서 wrangler) */
export function d1(sql) {
  const raw = execFileSync("npx", ["wrangler", "d1", "execute", "terra-archive-prefs", "--remote", "--json", "--command", sql],
    { cwd: path.join(ROOT, "workers", "account"), maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] }).toString();
  return JSON.parse(raw)[0].results;
}
export const sqlq = (s) => `'${String(s).replace(/'/g, "''")}'`;
export const SIDE_KEYS = ["terra-archive-infra-recycle", "terra-archive-infra-training", "ta-include-future"];

/** 계정 하나의 기지 설정을 엔진(E)에 세운다. row = prefs 의 {owner, t, d}, sd = 그 계정의 곁가지 설정 */
export function setupAccount(E, row, sd = {}) {
  const s = JSON.parse(row.d);
  const server = row.owner.split(":")[1];
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
  const saved = E.sanitizePlan(bucket.plan ?? s.plan);
  return { s, server, fut, layout, roster, byId, priority, pins, dorms, saved, pinCount: Object.values(pins).flat().length + Object.values(dorms).flat().length };
}

/** 같은 채점 — 배치에서 다시 센 원장·진영 수 (엔진 rescorePlan, 손 편집·안정장치와 같다). 장기 지속 모드면 점수가 100만대 */
export function rescore(E, plan, assignments, byId, priority) {
  return E.planScore(E.rescorePlan({ ...plan, assignments, priority }, byId), byId);
}
export const isBig = (v) => Math.abs(v ?? 0) > 1e5;
/** 2000점 기지 기준 차이 — 장기 지속 모드는 비율로 */
export const gap = (a, b, big) => (big ? ((a - b) / Math.abs(b)) * 2000 : a - b);
export const ownsAll = (assignments, byId) => Object.values(assignments).flat(2).every((id) => byId.has(id));

export const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
export const readJsonl = (p) => { try { return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch { return []; } };

/** 무거운 계산 잠금 — 역검증(riic-audit)과 오퍼별 효과 조사(riic-explain)는 둘 다 코어를 다 쓴다. 같이 돌리면 서로 느려지고,
 *  다듬기에 시간 상한이 있던 때는 결과까지 바뀌었다(2026-10-21 #15 — 역검증 1명 −5.1 이 그 오염이었다). 둘 다 이 잠금을 잡고 돈다.
 *  주인 프로세스가 죽은 잠금은 넘겨받는다 */
export function acquireHeavyLock(what) {
  const p = path.join(auditDir(), ".busy.json");
  const cur = readJson(p, null);
  if (cur?.pid && cur.pid !== process.pid) {
    let alive = false;
    try { process.kill(cur.pid, 0); alive = true; } catch (e) { alive = e?.code === "EPERM"; }
    if (alive) {
      console.error(`✗ 다른 무거운 계산이 돌고 있습니다 — ${cur.what} (pid ${cur.pid}, ${cur.started} 시작). 끝난 뒤에 돌리세요 (같이 돌리면 둘 다 느려진다).`);
      process.exit(1);
    }
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ pid: process.pid, what, started: new Date().toLocaleString("ko-KR") }));
  const release = () => { try { if (readJson(p, null)?.pid === process.pid) fs.rmSync(p); } catch { /* 이미 없음 */ } };
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { release(); process.exit(130); });
}
