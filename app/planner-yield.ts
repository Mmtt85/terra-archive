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
  /** 하루 용문폐 — 무역소 처리량 그대로 (순금은 밖에서 수급한다고 본다, 아래 주석) */
  lmd: number;
  /** 하루 경험치 */
  exp: number;
  /** 하루 작전기록 (중급 1,000exp 환산 개수) */
  records: number;
  /** 순금 제조소가 하루에 만드는 개수 */
  gold: number;
  /** 무역소가 하루에 오더로 쓰는 순금 개수 */
  goldNeed: number;
  /** 기지 안에서 모자라는 순금 (하루, 0 이상) — 밖에서 채워 와야 하는 양 */
  goldShort: number;
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

  let gold = 0, exp = 0, lmd = 0, goldNeed = 0;
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
        lmd += ORDER_LMD_HOUR * 24 * rate * w;
        // 순금 소비는 방 %를 그대로 쓴다 — 프로바이조(위약 배상)는 오더당 납품 순금이 실제로
        // 함께 늘어나 정확하지만, 테킬라·클로저처럼 **건당 용문폐만** 올리는 항까지 소비로
        // 세므로 '부족한 순금'은 조금 크게 잡힌다(클로저 방 기준 최대 +20%). 방 %를 처리량과
        // 가치로 쪼개려면 teamScore와 어긋날 수 있는 두 번째 채점 경로가 생겨서 안 쪼갠다.
        goldNeed += ORDER_GOLD_HOUR * 24 * rate * w;
      } else if (cell.product === "gold") {
        gold += ((DAY_SEC * rate) / GOLD_PT) * w;
      } else {
        const recipe = EXP_BY_LEVEL[Math.min(levelOf(cell.key), EXP_BY_LEVEL.length) - 1];
        exp += ((DAY_SEC * rate) / recipe.pt) * recipe.exp * w;
      }
    }
  }
  // ⚠ **순금 병목은 용문폐에서 빼지 않는다** (사용자 확정 2026-08-06: "순금은 다른 데서
  // 어떻게든 수급해 오니까, 인프라 상에서만 보면 순금 부족이면 순금 부족이라고 써놓기만 하되
  // 순금은 부족하지 않다는 전제 하에서 시뮬레이션해 달라"). 종전엔 순금 생산÷소화량 비율을
  // 곱했는데, 실계정 인게임 리포트(용문폐 51,000/일)와 대조하니 그 비율만큼 낮게 나왔다.
  // 모자라는 양은 goldShort로 내보내 화면에 "순금 N개 부족"으로 적고, 판단은 유저가 한다.
  return {
    lmd,
    exp,
    records: exp / EXP_PER_RECORD,
    gold, goldNeed,
    goldShort: Math.max(0, goldNeed - gold),
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
