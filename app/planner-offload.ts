// 플래너 무거운 계산의 워커 오프로드 셔틀 — planner.tsx는 이 모듈만 부른다.
// Web Worker(planner-worker.ts)로 id·정예화만 보내 계산하고, 진행 콜백(step/progress)은
// postMessage로 돌려받아 메인 스레드는 상태 갱신·리페인트만 한다 (INP 근본 해결, 2026-07-22).
// 워커 생성 실패·미지원(구형 브라우저)이면 종전대로 메인 스레드에서 직접 계산(폴백).
import { ops, withElite, optimizeConfig, setLayoutPreset, setLevels, setRecycle, setTrainingUse, setPolishTuning, keepIfClose, type RecycleMode, type Elite, type Plan, type OptimizeResult, type ProdPriority, type OptimizeStep, type LayoutPreset, type Levels, type CustomRoom, type CustomProduct, type RoomPin } from "./planner-engine";
import { recommendRaises, rankRaises, type RaiseRec, type InvestProgress, type InvestSetup, type InvestCand } from "./planner-invest";

export type PlannerJob = {
  owned: Set<string>;
  elite: Map<string, Elite>;
  /** 오퍼 레벨 (미지정 = 제한 없음) — 노정예의 'Lv.30' 해금 스킬 판정용 */
  opLevels?: Map<string, number>;
  includeFuture: boolean;
  priority: ProdPriority;
  layout?: LayoutPreset; // 기지 배치 프리셋 (기본 243) — 워커·폴백 양쪽에 동기화
  levels?: Levels | null; // 시설 레벨 (미지정 = 만렙)
  customRooms?: CustomRoom[] | null; // 그외(커스텀) 배치 9칸 구성 — layout === "custom"일 때 필수
  customProducts?: (CustomProduct | null)[] | null; // 커스텀 제조소 품목(순금/작전기록)
  dormPins?: Record<string, string[]>; // 사용자가 숙소 칸에 고정한 오퍼 (자동편성이 건드리지 않는다)
  roomPins?: Record<string, RoomPin[]>; // 생산방 고정 오퍼 — 문자열=양조 고정, {id,shift}=조별 고정 (2026-09-12)
  recycle?: RecycleMode | null; // 재활용소 우선도 — 미래시 꺼짐이면 null(칸 없음). §11, 2026-10-09
  training?: boolean; // 훈련실까지 고려(2석, 조건 충족용) — 기본 false = 비워 둔다 (2026-10-17)
  prev?: Plan | null; // 지금 편성 — 새 편성이 KEEP_MARGIN 점 넘게 낫지 않으면 이걸 그대로 둔다 (안정장치, 2026-10-18)
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onStep?: (step: OptimizeStep) => void;
  onProgress?: (p: InvestProgress) => void;
};

let worker: Worker | null = null;
let workerBroken = false; // 모듈 로드 실패 등 — 이후 잡은 전부 폴백으로
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (workerBroken || typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (!worker) {
    try {
      worker = new Worker(new URL("./planner-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data as { seq: number; type: string; step?: OptimizeStep; progress?: InvestProgress; result?: unknown; message?: string };
        const job = pending.get(msg.seq);
        if (!job) return;
        if (msg.type === "step") job.onStep?.(msg.step!);
        else if (msg.type === "progress") job.onProgress?.(msg.progress!);
        else if (msg.type === "done") { pending.delete(msg.seq); job.resolve(msg.result); }
        else if (msg.type === "error") { pending.delete(msg.seq); job.reject(new Error(msg.message)); }
      };
      // 워커 스크립트 로드 실패(오프라인 캐시 꼬임 등) — 걸린 잡을 폴백으로 재시도시킨다
      worker.onerror = () => {
        workerBroken = true;
        for (const job of pending.values()) job.reject(new WorkerFailed());
        pending.clear();
        worker?.terminate();
        worker = null;
      };
    } catch {
      workerBroken = true;
      return null;
    }
  }
  return worker;
}

class WorkerFailed extends Error {}

function postJob(cmd: "optimize" | "investPrep" | "investEval", job: PlannerJob, hooks: Pick<Pending, "onStep" | "onProgress">, extra: { base?: OptimizeResult | null; cands?: InvestCand[] } = {}, target?: Worker): Promise<unknown> | null {
  const w = target ?? getWorker();
  if (!w) return null;
  seq += 1;
  const mySeq = seq;
  const promise = new Promise<unknown>((resolve, reject) => {
    pending.set(mySeq, { resolve, reject, ...hooks });
  });
  w.postMessage({ seq: mySeq, cmd, ...extra, owned: [...job.owned], elite: [...job.elite.entries()], opLevels: [...(job.opLevels ?? new Map()).entries()], includeFuture: job.includeFuture, priority: job.priority, layout: job.layout ?? "243", levels: job.levels ?? null, customRooms: job.customRooms ?? null, customProducts: job.customProducts ?? null, dormPins: job.dormPins ?? {}, roomPins: job.roomPins ?? {}, recycle: job.recycle ?? null, training: !!job.training, prev: job.prev ?? null });
  return promise;
}

// 폴백용 로스터 조립 — 워커와 동일 규칙 (미래시 OFF면 미실장 제외, 미지정 정예화 = 성급 최대)
function rosterOf(job: PlannerJob) {
  const visible = job.includeFuture ? ops : ops.filter((op) => !op.unreleased);
  return visible.map((op) => withElite(op, job.elite.get(op.id), job.opLevels?.get(op.id))).filter((op) => job.owned.has(op.id));
}

// 자동편성 — 워커에서. onStep은 진행 문구 갱신용 (메인 스레드는 setState만)
export async function optimizeOff(job: PlannerJob, onStep?: (step: OptimizeStep) => void): Promise<Plan> {
  const viaWorker = postJob("optimize", job, { onStep });
  if (viaWorker) {
    try {
      const { plan, base } = (await viaWorker) as { plan: Plan; base: OptimizeResult };
      rememberBase(job, base);
      return plan;
    } catch (error) { if (!(error instanceof WorkerFailed)) throw error; }
  }
  setRecycle(job.recycle ?? null);
  setTrainingUse(!!job.training);
  setLayoutPreset(job.layout ?? "243", job.customRooms ?? null, job.customProducts ?? null); // 폴백(메인 스레드)도 워커와 동일하게 프리셋 동기화
  setLevels(job.levels ?? null);
  // 메인 스레드에서는 다듬기 한 번이 창을 통째로 붙잡는다 — 여기서만 시간 상한을 건다(워커는 상한 없음 — 기기마다 결과가 같게, POLISH_TUNING 주석)
  setPolishTuning({ budgetMs: 15000 });
  const roster = rosterOf(job);
  const cfg = await optimizeConfig(roster, job.priority, onStep && (async (step) => { onStep(step); }), job.dormPins ?? {}, job.roomPins ?? {});
  rememberBase(job, cfg);
  return keepIfClose(job.prev, cfg.plan, roster, job.dormPins ?? {}, job.roomPins ?? {}).plan;
}

// ── 육성 추천 — 기준 편성 재사용 + 워커 여러 개 (2026-10-19, 사용자 "한 번 돌리면 생각보다 오래 걸린다") ──
// 실측(데스크톱, 보유 415명·미완성 154명): 기준 편성 11.5초 + 후보 100여 명 재편성 12초 = 24초. 모바일은 몇 배.
//  ① 기준 편성 = 자동편성이 고른 전략(OptimizeResult). 자동편성을 돌릴 때 입력 서명과 함께 기억해 두고(새로고침 뒤에도
//     localStorage), 같은 입력이면 다시 짜지 않는다. 엔진이 그새 바뀌어도 평가 쪽이 그 전략으로 기준 편성을 다시 지어
//     비교하므로 편향이 없다(investEvaluate).
//  ② 후보 평가는 서로 독립이라 워커 여러 개(코어 수 −1, 최대 4)에 번갈아 나눠 맡긴다.
const BASE_KEY = "ta-infra-invest-base";
const sigOf = (job: PlannerJob) => JSON.stringify([[...job.owned].sort(), [...job.elite.entries()].sort(), [...(job.opLevels ?? new Map()).entries()].sort(),
  job.includeFuture, job.priority, job.layout ?? "243", job.levels ?? null, job.customRooms ?? null, job.customProducts ?? null,
  job.dormPins ?? {}, job.roomPins ?? {}, job.recycle ?? null, !!job.training]);
let memBase: { sig: string; base: OptimizeResult } | null = null;
function rememberBase(job: PlannerJob, base: OptimizeResult) {
  memBase = { sig: sigOf(job), base };
  try { localStorage.setItem(BASE_KEY, JSON.stringify(memBase)); } catch { /* 용량·차단 — 메모리로만 */ }
}
function recallBase(job: PlannerJob): OptimizeResult | null {
  const sig = sigOf(job);
  if (memBase?.sig === sig) return memBase.base;
  try {
    const saved = JSON.parse(localStorage.getItem(BASE_KEY) ?? "null") as { sig: string; base: OptimizeResult } | null;
    if (saved?.sig === sig) { memBase = saved; return saved.base; }
  } catch { /* 손상 — 무시 */ }
  return null;
}

let pool: Worker[] | null = null;
function getPool(): Worker[] {
  if (pool) return pool;
  const main = getWorker();
  if (!main) return (pool = []);
  const n = Math.max(1, Math.min(4, (typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2) - 1));
  const list = [main];
  for (let i = 1; i < n; i += 1) {
    try {
      const w = new Worker(new URL("./planner-worker.ts", import.meta.url), { type: "module" });
      w.onmessage = main.onmessage;   // 같은 seq 장부(pending)를 쓴다
      w.onerror = () => { /* 보조 워커 하나가 죽으면 그 몫만 실패 — 아래에서 주 워커로 다시 돈다 */ };
      list.push(w);
    } catch { break; }
  }
  return (pool = list);
}

export async function investOff(job: PlannerJob, onProgress?: (p: InvestProgress) => void): Promise<RaiseRec[]> {
  const base = recallBase(job);
  const prep = postJob("investPrep", job, {}, { base });
  if (prep) {
    try {
      const setup = (await prep) as InvestSetup | null;
      if (!setup) return [];
      if (!base) rememberBase(job, setup.base);
      const workers = getPool();
      const total = setup.cands.length;
      onProgress?.({ done: 0, total });
      // 번갈아 나눈다 — 시너지 후보(무거움)가 앞에 몰려 있어 앞에서부터 자르면 한 워커에 쏠린다
      const chunks: InvestCand[][] = workers.map(() => []);
      setup.cands.forEach((c, i) => chunks[i % workers.length].push(c));
      const doneBy = new Array(workers.length).fill(0);
      const runChunk = (i: number, w: Worker) => postJob("investEval", job, {
        onProgress: (p) => { doneBy[i] = p.done; onProgress?.({ done: doneBy.reduce((a, b) => a + b, 0), total, opId: p.opId }); },
      }, { base: setup.base, cands: chunks[i] }, w) as Promise<RaiseRec[]>;
      const parts = await Promise.all(workers.map((w, i) => (chunks[i].length ? runChunk(i, w).catch(() => runChunk(i, workers[0])) : Promise.resolve([] as RaiseRec[]))));
      onProgress?.({ done: total, total });
      return rankRaises(parts.flat());
    } catch (error) { if (!(error instanceof WorkerFailed)) throw error; }
  }
  setRecycle(job.recycle ?? null);
  setTrainingUse(!!job.training);
  setLayoutPreset(job.layout ?? "243", job.customRooms ?? null, job.customProducts ?? null);
  setLevels(job.levels ?? null);
  const visible = job.includeFuture ? ops : ops.filter((op) => !op.unreleased);
  return recommendRaises(visible, job.owned, job.elite, job.priority, onProgress && (async (p) => {
    onProgress(p);
    await new Promise((resolve) => setTimeout(resolve, 0)); // 폴백은 종전처럼 진행 바 리페인트 양보
  }), job.dormPins ?? {}, job.opLevels ?? new Map(), job.roomPins ?? {}, base);
}
