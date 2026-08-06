// 기지 하루 산출 근사 — 요약 카드의 "하루 용문폐 / 하루 작전기록".
//
// 왜 (사용자 요청 2026-08-06): 요약이 %효율만 보여 주니 "그래서 하루에 용문폐 얼마,
// 작전기록 몇 개냐"를 알 수 없다. 대신 '기용 인원'(배치도를 세면 나오는 값)을 뺐다.
//
// 원칙은 육성 추천 회수일(planner-invest)과 같다 — **상수는 전부 게임 데이터에서 뽑고,
// 추정이 섞인 값은 화면에 그대로 밝힌다.** 여기 상수의 출처:
//   · 제조소 기본 생산 속도 1포인트/초, 레시피 costPoint = building_data manufactFormulas
//     (순금 3003 = 4,320pt / 기초 2001 = 2,700pt·200exp / 초급 2002 = 4,800pt·400exp /
//      중급 2003 = 10,800pt·1,000exp). 작전기록 등급은 **제조소 레벨로 해금**되므로
//      (requireRooms.roomLevel) 레벨별 최선 레시피를 쓴다 — 252 배치의 Lv2 제조소가 여기 걸린다.
//   · 순금 1개 = 용문폐 500 = building_data goldItems["3003"].
//   · 무역소 일반 오더 풀(Lv3): 2/3/4금이 30/50/20%, 획득 시간은 금 수와 무관하게 오더별
//     고정 144/210/276분 → 기대 순금 2.9개 / 3.39시간. docs/INFRA-RULES.md 무역소 항의
//     프로바이조·특별 오더 등가값을 유도한 그 상수와 **같은 값**이다.
// 유일하게 게임 테이블에 없는 건 오더 풀 구성 자체이며(무역소 주문 보상 미수록), 그래서
// 이 화면 숫자는 전부 "≈"로 표시하고 근거를 툴팁에 적는다.
import {
  LAYOUT, levelOf, teamScore, ctxFor, aurasOf, presentIdsFor, roomOfFor, cellOfFor, SHIFT_COUNT,
  type InfraOp, type Plan,
} from "./planner-engine";

const DAY_SEC = 86400;
const GOLD_PT = 4320;
/** 제조소 레벨(1·2·3)에서 만들 수 있는 **가장 효율 좋은** 작전기록 — 레벨 인덱스로 접근 */
const EXP_BY_LEVEL = [
  { pt: 2700, exp: 200 },    // Lv1 기초작전기록
  { pt: 4800, exp: 400 },    // Lv2 초급작전기록
  { pt: 10800, exp: 1000 },  // Lv3 중급작전기록
];
/** 표시 단위 = 중급작전기록 1,000exp (Lv3 제조소가 만드는 것) */
export const EXP_PER_RECORD = 1000;
/** 순금 1개 = 용문폐 (goldItems) */
export const GOLD_LMD = 500;
// 무역소 일반 오더 풀 — 기대 납품 순금 2.9개 / 기대 획득 3.39시간
const ORDER_GOLD = 2 * 0.3 + 3 * 0.5 + 4 * 0.2;
const ORDER_HOURS = (144 * 0.3 + 210 * 0.5 + 276 * 0.2) / 60;
/** 효율 0%p 무역소 1개의 시간당 용문폐 (= 427.7) */
export const ORDER_LMD_HOUR = (ORDER_GOLD * GOLD_LMD) / ORDER_HOURS;
/** 효율 0%p 무역소 1개가 시간당 소비하는 순금 */
const ORDER_GOLD_HOUR = ORDER_GOLD / ORDER_HOURS;
// ⚠ 무역소 레벨을 낮추면 받을 수 있는 오더 등급(orderRarity 1/2/3)이 줄어 풀 구성이 달라지는데,
// 그 확률 테이블은 클뜯 데이터에 없다. Lv1은 2금 오더뿐이라 416.7/h로 Lv3 풀(427.7/h)보다
// 2.6% 낮은 정도라, 레벨과 무관하게 Lv3 풀로 근사한다 (프리셋은 전부 무역소 만렙).

export type DailyYield = {
  /** 하루 용문폐 — 무역소 처리량과 순금 공급 중 **작은 쪽**에 맞춘 값 */
  lmd: number;
  /** 하루 경험치 */
  exp: number;
  /** 하루 작전기록 (중급 1,000exp 환산 개수) */
  records: number;
  /** 순금 제조소가 하루에 만드는 개수 */
  gold: number;
  /** 무역소가 하루에 오더로 소화할 수 있는 순금 개수 */
  goldNeed: number;
  /** 무역소 처리량 상한(순금이 충분할 때의 하루 용문폐) */
  lmdCap: number;
  /** 순금이 모자라 무역소가 노는가 (= 순금 제조소를 늘릴 여지) */
  goldShort: boolean;
  /** [A조, B조] 교대 시계(시간)와 그 비율 — 하루를 두 조로 섞은 근거 */
  hours: number[];
  weights: number[];
};

/**
 * 편성 하나의 하루 산출. 방마다 실제 teamScore(%)를 그대로 곱하고, A/B 두 조를 각 조의
 * 교대 시계 비율로 섞는다 (육성 추천 회수일과 같은 하루 모델).
 *
 * 창고·오더 슬롯 상한은 **차기 전에 수거한다고 본다** — 제조소 창고는 Lv3에서 중급작전기록
 * 10개(= 효율 0%p로도 30시간분)라, 하루 한 번도 안 들어오는 계정이면 실제 산출은 이보다 적다.
 */
export function dailyYield(plan: Plan, byId: Map<string, InfraOp>): DailyYield {
  const hours = [plan.shiftHours?.[0] ?? 12, plan.shiftHours?.[1] ?? 12];
  const span = hours[0] + hours[1] || 24;
  const weights = hours.map((h) => h / span);

  let gold = 0, exp = 0, lmdCap = 0, goldNeed = 0;
  for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
    const teamAt = (key: string): InfraOp[] => {
      const shifts = plan.assignments[key] ?? [];
      return (shifts[Math.min(shift, shifts.length - 1)] ?? []).map((id) => byId.get(id)).filter(Boolean) as InfraOp[];
    };
    const points = shift === 0 ? plan.tokenPoints : {};
    const counts = plan.factionCounts[shift] ?? {};
    const present = presentIdsFor(plan, shift);
    const rooms = roomOfFor(plan, shift);
    const cells = cellOfFor(plan, shift);
    const ambient = aurasOf(teamAt("CONTROL"), ctxFor("CONTROL", points, counts, plan.plants, present, undefined, rooms, cells));
    const w = weights[shift] ?? 0;
    for (const cell of LAYOUT) {
      if (cell.room !== "MANUFACTURE" && cell.room !== "TRADING") continue;
      const ctx = { ...ctxFor(cell.key, points, counts, plan.plants, present, ambient, rooms, cells), shiftHours: plan.shiftHours?.[shift], shift };
      // 방 %효율. 무인 시설도 기본 속도 100%로 돌아가므로 배수는 (1 + %/100)이다.
      const rate = 1 + teamScore(teamAt(cell.key), cell.room, ctx) / 100;
      if (cell.room === "TRADING") {
        lmdCap += ORDER_LMD_HOUR * 24 * rate * w;
        goldNeed += ORDER_GOLD_HOUR * 24 * rate * w;
      } else if (cell.product === "gold") {
        gold += ((DAY_SEC * rate) / GOLD_PT) * w;
      } else {
        const recipe = EXP_BY_LEVEL[Math.min(levelOf(cell.key), EXP_BY_LEVEL.length) - 1];
        exp += ((DAY_SEC * rate) / recipe.pt) * recipe.exp * w;
      }
    }
  }
  // 무역소는 순금이 있어야 오더를 납품한다 — 하루 생산이 소화량에 못 미치면 그 비율만큼만.
  // (반대로 순금이 남으면 무역소 처리량이 천장이다. 남는 순금은 그냥 쌓인다.)
  //
  // ⚠ 이 비율은 무역소 %를 **용문폐와 순금 소비 양쪽에 똑같이** 건다. 프로바이조(위약 배상)는
  // 실제로 오더당 납품 순금이 함께 늘어나므로 이 근사가 정확하고, 테킬라(고품질 수익)·클로저
  // (특별 오더 1200)는 순금은 그대로인데 건당 용문폐만 오르는 항이라 **순금 병목일 때만**
  // 낮게 잡힌다(클로저 기준 최대 −17%). 방 %를 처리량/가치로 쪼개려면 엔진에 두 번째 채점
  // 경로가 생기고 그게 teamScore와 어긋나기 시작하므로, 보수적으로 낮게 잡는 쪽을 택했다.
  const ratio = goldNeed > 0 ? Math.min(1, gold / goldNeed) : 0;
  return {
    lmd: lmdCap * ratio,
    exp,
    records: exp / EXP_PER_RECORD,
    gold, goldNeed, lmdCap,
    goldShort: goldNeed > 0 && gold < goldNeed - 1e-9,
    hours, weights,
  };
}

/** 배치에 순금 제조소·무역소·작전기록 제조소가 각각 있는지 (없는 값은 카드에서 '—') */
export function yieldCells(): { gold: number; exp: number; trade: number } {
  let gold = 0, exp = 0, trade = 0;
  for (const cell of LAYOUT) {
    if (cell.room === "TRADING") trade += 1;
    else if (cell.room === "MANUFACTURE") { if (cell.product === "gold") gold += 1; else exp += 1; }
  }
  return { gold, exp, trade };
}
