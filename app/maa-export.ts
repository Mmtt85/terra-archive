// MAA(MaaAssistantArknights) 커스텀 기반시설 JSON 내보내기 (베타) — React 의존 없음.
// 스키마 정본: docs.maa.plus 기반시설 스케줄링 프로토콜 + 공식 예제(resource/custom_infrast).
// ⚠ 오퍼 이름은 **게임 클라이언트 언어의 표시명**으로 쓴다 — MaaCore(InfrastAbstractTask)가
//   화면 OCR 결과(CharsNameOcrReplace 교정 후)와 names를 문자열 그대로 비교한다.
//   KO 번역 문서의 "중문명으로 작성" 표기는 원문("对应客户端语言的干员名")의 오역 (2026-08-02 확인).
// 매핑: TRADING-n→trading(LMD) · MANUFACTURE-n→manufacture(gold→Pure Gold, exp→Battle Record) ·
//   POWER-n→power · CONTROL→control · MEETING→meeting · HIRE→hire · WORKSHOP→processing(상시라 A/B 복제) ·
//   DORM-n→dormitory(고정 인원 + autofill로 지친 오퍼 채움) · RECYCLE→recycle(미래시 칸, 2026-10 스키마) ·
//   TRAINING→training(2026-10 스키마 — 첫 자리 = 협조자 operatorsA, 둘째 자리 = 훈련 자리 operatorsB).
// 빈 근무방은 skip:true — 방 키를 빼면 MAA 가 그 방을 기본 알고리즘으로 교대해 버린다(스키마 2026-10-14~ 문서).
// 드론: 사이트의 조별 드론 가속(칸@조)을 그 조 계획의 drones 로 (index = 같은 종류 방 중 몇 번째, 1부터).
// 확장 프로토콜(layout·operators·metadata, 2026-10 스키마) — 일도류 등 다른 도구가 같은 파일을 읽는다. MAA 실행엔 영향 없음.
// (사용자 지시 2026-10-23 "MAA 내보내기 수요가 많다, 다시 자세히 검사" — 최신 base-scheduling-schema.md·공식 예제와 대조)

export type MaaRoom = {
  operators?: string[];
  /** 훈련실 — 협조자 후보 · 훈련 자리 후보 */
  operatorsA?: string[];
  operatorsB?: string[];
  skip?: boolean;
  sort?: boolean;
  autofill?: boolean;
  product?: string;
};

export type MaaPlan = {
  name: string;
  description?: string;
  period?: [string, string][];
  drones?: { enable: boolean; room: "trading" | "manufacture"; index: number; order: "pre" | "post" };
  rooms: Record<string, MaaRoom[]>;
};

export type MaaInfrast = {
  title: string;
  description: string;
  plans: MaaPlan[];
  layout?: { type: string; level: number }[];
  operators?: Record<string, { name?: string; elite: number; level?: number }>;
  metadata?: { extensionVersion: string; generator: { id: string; name: string; url: string } };
};

/** 사이트 방 종류 → MAA 시설 키 */
export const MAA_ROOM: Record<string, string> = {
  TRADING: "trading", MANUFACTURE: "manufacture", POWER: "power", CONTROL: "control", MEETING: "meeting",
  HIRE: "hire", WORKSHOP: "processing", DORMITORY: "dormitory", TRAINING: "training", RECYCLE: "recycle",
};

export type MaaExportInput = {
  assignments: Record<string, string[][]>; // roomKey → shift → opIds (엔진 Plan.assignments)
  cells: { key: string; room: string; product?: string }[]; // 현재 레이아웃(LAYOUT) — 방 순서의 정본
  nameOf: (id: string) => string | undefined; // 표시 언어의 오퍼 이름 (클라이언트 언어와 일치 전제)
  shiftStarts: [string, string]; // ["08:00", "20:00"] — A/B조 시작 시각(HH:MM)
  title: string;
  description: string;
  planNames: [string, string];
  /** 드론 가속 키 '칸@조' (planner droneKeys) */
  droneKeys?: string[];
  /** 확장 — 시설 레벨 (칸 → 레벨) */
  levelOf?: (key: string) => number;
  /** 확장 — 오퍼 육성 (id → 정예화·레벨) */
  growthOf?: (id: string) => { elite: number; level?: number } | undefined;
};

const MANUFACTURE_PRODUCT: Record<string, string> = { gold: "Pure Gold", exp: "Battle Record" };

const toMinutes = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

const toHHMM = (minutes: number): string => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// [from, to) 구간을 스키마의 period 배열로 — 끝은 포함 표기라 1분 빼고, 자정을 넘으면 두 토막.
const periodFor = (from: number, to: number): [string, string][] => {
  const end = to - 1;
  if (from <= end) return [[toHHMM(from), toHHMM(end)]];
  return [[toHHMM(from), "23:59"], ["00:00", toHHMM(end)]];
};

export function buildMaaInfrast(input: MaaExportInput): MaaInfrast {
  const { assignments, cells, nameOf, shiftStarts, title, description, planNames, droneKeys, levelOf, growthOf } = input;
  const namesAt = (key: string, shift: number): string[] => {
    const ids = assignments[key]?.[shift] ?? [];
    return ids.map((id) => nameOf(id)).filter((name): name is string => !!name);
  };
  // 상시 슬롯(가공소·숙소)은 조 개념이 없어 shift 0 데이터를 양쪽 plan에 복제한다
  const workRoom = (names: string[], extra: Partial<MaaRoom> = {}): MaaRoom =>
    names.length ? { operators: names, sort: true, autofill: false, ...extra } : { operators: [], skip: true, ...extra };

  const byRoom = (room: string) => cells.filter((cell) => cell.room === room);
  const startA = toMinutes(shiftStarts[0]);
  const startB = toMinutes(shiftStarts[1]);
  const hasPeriod = startA !== null && startB !== null && startA !== startB;

  const plans: MaaPlan[] = [0, 1].map((shift) => {
    const rooms: Record<string, MaaRoom[]> = {
      trading: byRoom("TRADING").map((cell) => workRoom(namesAt(cell.key, shift), { product: "LMD" })),
      manufacture: byRoom("MANUFACTURE").map((cell) =>
        workRoom(namesAt(cell.key, shift), cell.product && MANUFACTURE_PRODUCT[cell.product] ? { product: MANUFACTURE_PRODUCT[cell.product] } : {})),
      power: byRoom("POWER").map((cell) => workRoom(namesAt(cell.key, shift), { sort: false })),
      control: [workRoom(namesAt("CONTROL", shift), { sort: false })],
      meeting: [workRoom(namesAt("MEETING", shift), { sort: false })],
      hire: [workRoom(namesAt("HIRE", shift), { sort: false })],
      processing: [workRoom(namesAt("WORKSHOP", 0), { sort: false })],
      // 숙소: 자동편성은 회복 오라·주차 오퍼만 고정하고, 지친 오퍼 순환은 MAA autofill에 맡긴다
      dormitory: byRoom("DORMITORY").map((cell) => ({ operators: namesAt(cell.key, 0), sort: true, autofill: true })),
    };
    // 훈련실 — 사이트는 조건을 채우려고 앉힌 오퍼뿐(훈련 속도로 채우지 않는다). 첫 자리는 협조자, 둘째는 훈련 자리.
    // 비어 있으면 skip — 키를 빼면 MAA 기본 알고리즘이 바꿔 버린다
    if (cells.some((cell) => cell.key === "TRAINING")) {
      const tn = namesAt("TRAINING", shift);
      rooms.training = [tn.length ? { operatorsA: [tn[0]], ...(tn[1] ? { operatorsB: [tn[1]] } : {}) } : { skip: true }];
    }
    if (byRoom("RECYCLE").length) rooms.recycle = byRoom("RECYCLE").map((cell) => workRoom(namesAt(cell.key, shift), { sort: false }));
    const plan: MaaPlan = { name: planNames[shift], rooms };
    // 드론 — 이 조에 켠 방 (사이트는 한 시설만)
    const dk = (droneKeys ?? []).find((k) => Number(k.split("@")[1] ?? 0) === shift);
    if (dk) {
      const cellKey = dk.split("@")[0];
      const cell = cells.find((c) => c.key === cellKey);
      if (cell && (cell.room === "TRADING" || cell.room === "MANUFACTURE")) {
        const index = byRoom(cell.room).findIndex((c) => c.key === cellKey) + 1;
        if (index > 0) plan.drones = { enable: true, room: cell.room === "TRADING" ? "trading" : "manufacture", index, order: "pre" };
      }
    }
    if (hasPeriod) plan.period = shift === 0 ? periodFor(startA!, startB!) : periodFor(startB!, startA!);
    return plan;
  });

  const out: MaaInfrast = { title, description, plans };
  // 확장 프로토콜 — 시설 배치·레벨 (같은 종류는 rooms 와 같은 순서)
  if (levelOf) out.layout = cells.filter((c) => MAA_ROOM[c.room]).map((c) => ({ type: MAA_ROOM[c.room], level: levelOf(c.key) }));
  if (growthOf) {
    const ops: NonNullable<MaaInfrast["operators"]> = {};
    for (const shifts of Object.values(assignments)) for (const team of shifts) for (const id of team) {
      if (ops[id]) continue;
      const g = growthOf(id);
      if (g) ops[id] = { name: nameOf(id), elite: g.elite, ...(g.level != null ? { level: g.level } : {}) };
    }
    out.operators = ops;
  }
  out.metadata = { extensionVersion: "1.0", generator: { id: "terra-archive-infra-planner", name: "Terra Archive Infra Planner", url: "https://terra-archive.net/infra" } };
  return out;
}
