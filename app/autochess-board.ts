// 위수 협의 **편성 계산기** — 판에 담은 기물로 맹약 상태를 계산한다 (사용자 요청 2026-08-29).
// React 의존 없음(순수 함수) — 화면은 autochess.tsx 가 그리고, 여기는 규칙만 안다.
//
// ⚠ 이건 **전투 시뮬레이터가 아니다.** 게임 데이터에 숫자로 있는 것만 다룬다는 사이트 규칙
//   그대로다. 그래서 계산하는 것과 안 하는 것이 명확히 갈린다:
//
//   계산한다 — 맹약별 인원, 발동 여부, **인원 게이트 단계**(char 15 · gold 2 = 17개).
//     판을 짜는 순간 값이 정해지고 게임 blackboard 와 대조까지 끝난 부분이다.
//   계산하지 않는다 — **중첩 수**. 중첩은 전투 중에 특질이 쌓는 값인데, 그 특질 130개 중
//     58개만 대상·수치가 고정이고 나머지 72개는 '가장 많은 맹약에', '갱신 횟수 배수로'처럼
//     대상이 동적이다 (실측 2026-08-29). 절반을 빼먹은 합계를 확정값처럼 보여 주느니
//     사용자가 직접 넣게 하고, 넣은 값으로 실수치와 중첩 게이트만 따라 움직이게 한다.
//
// 지난번 '시뮬레이터' 뷰가 접힌 이유(2026-08-23 "물자관리소에서 필터링하는 거랑 똑같네")도
// 여기서 갈린다 — 그때는 축이 맹약→기물이라 필터의 재탕이었다. 계산기는 축이 반대다:
// 기물 8개를 담으면 **23개 맹약 전체**의 상태가 한 번에 나온다. 기물 하나가 보통 맹약 두 개에
// 속하므로(2개 65종·1개 41종·3개 6종) 8칸이면 슬롯이 16개쯤 겹쳐 손으로 세기 번거롭다.

import type { AcBond, AcChess } from "./autochess";

/** 단계 게이트 — build-autochess.py gate_of() 가 한국어 원문에서 읽어 넣는다 */
export type AcGate = { k: "char" | "gold" | "stack"; n: number; rep?: 1 };

/** 판에 올린 기물 한 칸 — gold = 정예화(골든) 상태 */
export type BoardSlot = { id: string; gold?: boolean };

export type StepState = {
  /** steps 안에서의 위치 */
  i: number;
  /** true=켜짐 · false=안 켜짐 · null=**판정 불가**(중첩 게이트라 전투 중에 결정된다) */
  on: boolean | null;
  gate?: AcGate;
  /** 중첩 게이트일 때 남은 중첩 (stack 입력이 있을 때만) */
  need?: number;
};

export type BondState = {
  id: string;
  /** 전장에 있는 이 맹약 소속 기물 수 */
  board: number;
  /** 덱(예비)에 있는 수 */
  deck: number;
  /** 발동 판정에 실제로 쓰이는 수 — 맹약의 세는 범위(cond)에 따라 다르다 */
  counted: number;
  active: boolean;
  steps: StepState[];
};

/** 전장 최대 8칸 · 덱 최대 10칸 (게임 constData: maxBattleChessCnt · maxDeckChessCnt) */
export const MAX_BOARD = 8;
export const MAX_DECK = 10;

/**
 * 판 상태 계산. stacks 를 주면 중첩 게이트도 판정한다 (안 주면 그 단계는 on=null).
 *
 * 세는 범위(cond)는 세 가지다 — 실측 2026-08-29:
 *   BOARD(19종)            전장만
 *   BOARD_AND_DECK(3종)    전장 + 덱 (예견·기적·투자자 — 정비 구역 오퍼도 맹약을 켠다)
 *   BOARD_ALL_CHESS(1종)   궁극기 — 맹약 소속과 무관하게 **전장의 정예화 기물 수**를 센다
 * 그리고 '독행'만 down=1 이라 **인원이 적을수록** 켜진다 (1명 이하). 부등호를 뒤집는다.
 */
export function computeBoard(
  bonds: AcBond[],
  byId: Map<string, AcChess>,
  board: BoardSlot[],
  deck: BoardSlot[],
  stacks?: Record<string, number>,
): BondState[] {
  const goldOnBoard = board.filter((s) => s.gold).length;
  const bondsOf = (s: BoardSlot) => byId.get(s.id)?.bonds ?? [];

  return bonds.map((b) => {
    const onBoard = board.filter((s) => bondsOf(s).includes(b.id)).length;
    const inDeck = deck.filter((s) => bondsOf(s).includes(b.id)).length;
    const counted = b.cond === "BOARD_ALL_CHESS" ? goldOnBoard
      : b.cond === "BOARD_AND_DECK" ? onBoard + inDeck
        : onBoard;
    const active = b.down ? counted <= (b.min ?? 0) && counted > 0 : counted >= (b.min ?? 0);
    const stack = stacks?.[b.id];

    const steps: StepState[] = b.steps.map((st, i) => {
      const g = (st as { g?: AcGate }).g;
      if (!g) return { i, on: active };
      if (g.k === "char") return { i, on: active && onBoard >= g.n, gate: g };
      if (g.k === "gold") return { i, on: goldOnBoard >= g.n, gate: g };
      // 중첩 게이트 — 입력이 없으면 판정하지 않는다 (추측해서 켜 주면 거짓말이 된다)
      if (stack == null) return { i, on: null, gate: g };
      return { i, on: active && stack >= g.n, gate: g, need: Math.max(0, g.n - stack) };
    });
    return { id: b.id, board: onBoard, deck: inDeck, counted, active, steps };
  });
}

/** 이 기물을 전장에 넣으면 새로 켜지는 단계 — 추천이 아니라 **차이 계산**이다 */
export function stepsGainedBy(
  bonds: AcBond[],
  byId: Map<string, AcChess>,
  board: BoardSlot[],
  deck: BoardSlot[],
  add: BoardSlot,
  stacks?: Record<string, number>,
): { bond: string; step: number }[] {
  if (board.length >= MAX_BOARD) return [];
  const before = computeBoard(bonds, byId, board, deck, stacks);
  const after = computeBoard(bonds, byId, [...board, add], deck, stacks);
  const out: { bond: string; step: number }[] = [];
  after.forEach((a, bi) => {
    a.steps.forEach((st, si) => {
      if (st.on === true && before[bi].steps[si].on !== true) out.push({ bond: a.id, step: si });
    });
  });
  return out;
}

/** 맹약 수치 한 줄의 실제 값 — 기본값 + 중첩당 증가분 × 중첩, 상한 적용 */
export function stackValue(sk: { b: number; p?: number; cap?: number; capU?: string }, stack: number): number {
  const raw = sk.b + (sk.p ?? 0) * stack;
  if (sk.cap != null && sk.capU !== "stack") return Math.min(raw, sk.cap);
  return raw;
}
