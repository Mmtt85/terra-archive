// 플래너 무거운 계산의 워커 오프로드 셔틀 — planner.tsx는 이 모듈만 부른다.
// Web Worker(planner-worker.ts)로 id·정예화만 보내 계산하고, 진행 콜백(step/progress)은
// postMessage로 돌려받아 메인 스레드는 상태 갱신·리페인트만 한다 (INP 근본 해결, 2026-07-22).
// 워커 생성 실패·미지원(구형 브라우저)이면 종전대로 메인 스레드에서 직접 계산(폴백).
import { ops, withElite, optimize, setLayoutPreset, type Elite, type Plan, type ProdPriority, type OptimizeStep, type LayoutPreset } from "./planner-engine";
import { recommendRaises, type RaiseRec, type InvestProgress } from "./planner-invest";

export type PlannerJob = {
  owned: Set<string>;
  elite: Map<string, Elite>;
  includeFuture: boolean;
  priority: ProdPriority;
  layout?: LayoutPreset; // 기지 배치 프리셋 (기본 243) — 워커·폴백 양쪽에 동기화
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

function postJob(cmd: "optimize" | "invest", job: PlannerJob, hooks: Pick<Pending, "onStep" | "onProgress">): Promise<unknown> | null {
  const w = getWorker();
  if (!w) return null;
  seq += 1;
  const mySeq = seq;
  const promise = new Promise<unknown>((resolve, reject) => {
    pending.set(mySeq, { resolve, reject, ...hooks });
  });
  w.postMessage({ seq: mySeq, cmd, owned: [...job.owned], elite: [...job.elite.entries()], includeFuture: job.includeFuture, priority: job.priority, layout: job.layout ?? "243" });
  return promise;
}

// 폴백용 로스터 조립 — 워커와 동일 규칙 (미래시 OFF면 미실장 제외, 미지정 정예화 = 성급 최대)
function rosterOf(job: PlannerJob) {
  const visible = job.includeFuture ? ops : ops.filter((op) => !op.unreleased);
  return visible.map((op) => withElite(op, job.elite.get(op.id))).filter((op) => job.owned.has(op.id));
}

// 자동편성 — 워커에서. onStep은 진행 문구 갱신용 (메인 스레드는 setState만)
export async function optimizeOff(job: PlannerJob, onStep?: (step: OptimizeStep) => void): Promise<Plan> {
  const viaWorker = postJob("optimize", job, { onStep });
  if (viaWorker) {
    try { return (await viaWorker) as Plan; } catch (error) { if (!(error instanceof WorkerFailed)) throw error; }
  }
  setLayoutPreset(job.layout ?? "243"); // 폴백(메인 스레드)도 워커와 동일하게 프리셋 동기화
  return optimize(rosterOf(job), job.priority, onStep && (async (step) => { onStep(step); }));
}

// 육성 추천 — 워커에서. onProgress는 후보 진행 바 갱신용
export async function investOff(job: PlannerJob, onProgress?: (p: InvestProgress) => void): Promise<RaiseRec[]> {
  const viaWorker = postJob("invest", job, { onProgress });
  if (viaWorker) {
    try { return (await viaWorker) as RaiseRec[]; } catch (error) { if (!(error instanceof WorkerFailed)) throw error; }
  }
  setLayoutPreset(job.layout ?? "243");
  const visible = job.includeFuture ? ops : ops.filter((op) => !op.unreleased);
  return recommendRaises(visible, job.owned, job.elite, job.priority, onProgress && (async (p) => {
    onProgress(p);
    await new Promise((resolve) => setTimeout(resolve, 0)); // 폴백은 종전처럼 진행 바 리페인트 양보
  }));
}
