// 인프라 플래너 계산 워커 — 자동편성(optimize)·육성 추천(recommendRaises)을 메인 스레드
// 밖에서 돌린다. buildPlan 1회가 ~100ms(데스크톱, 모바일은 3~10배)라 아무리 사이사이
// setTimeout으로 양보해도 태스크 하나가 INP 한도(200ms)를 넘는다 — 계산을 통째로 워커로
// 옮기는 것만이 근본 해결 (2026-07-22 /infra INP Poor 10% 리포트).
// 엔진은 React 무의존 순수 계산이라 그대로 임포트한다 (verify-plan.mjs와 같은 성질).
// 호출부는 planner-offload.ts — 오퍼 객체 대신 id·정예화만 주고받는다 (직렬화 최소화).
import { ops, withElite, optimize, type Elite, type ProdPriority } from "./planner-engine";
import { recommendRaises } from "./planner-invest";

export type PlannerJobMsg = {
  seq: number;
  cmd: "optimize" | "invest";
  owned: string[];
  elite: [string, Elite][];
  includeFuture: boolean;
  priority: ProdPriority;
};

// DOM lib의 Window 타입과 겹치지 않게 postMessage(1인자)만 뽑아 쓴다
const post = (message: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(message);

self.addEventListener("message", (event) => {
  void (async () => {
    const msg = (event as MessageEvent<PlannerJobMsg>).data;
    try {
      // 메인 스레드의 visibleOps와 동일 규칙 — 미래시 OFF면 미실장 제외. 로케일 오버레이는
      // 표시 문자열만 바꾸므로(구조 필드 KR 원본 유지) 엔진 결과(id 기반)에 영향 없다.
      const visible = msg.includeFuture ? ops : ops.filter((op) => !op.unreleased);
      const eliteById = new Map(msg.elite);
      const ownedIds = new Set(msg.owned);
      if (msg.cmd === "optimize") {
        const roster = visible.map((op) => withElite(op, eliteById.get(op.id))).filter((op) => ownedIds.has(op.id));
        const plan = await optimize(roster, msg.priority, (step) => { post({ seq: msg.seq, type: "step", step }); });
        post({ seq: msg.seq, type: "done", result: plan });
      } else {
        const recs = await recommendRaises(visible, ownedIds, eliteById, msg.priority, (p) => { post({ seq: msg.seq, type: "progress", progress: p }); });
        post({ seq: msg.seq, type: "done", result: recs });
      }
    } catch (error) {
      post({ seq: msg.seq, type: "error", message: String(error) });
    }
  })();
});
