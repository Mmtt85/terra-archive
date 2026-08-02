// MAA(MaaAssistantArknights) 커스텀 기반시설 JSON 내보내기 (베타) — React 의존 없음.
// 스키마 정본: docs.maa.plus 기반시설 스케줄링 프로토콜 + 공식 예제(resource/custom_infrast).
// ⚠ 오퍼 이름은 **게임 클라이언트 언어의 표시명**으로 쓴다 — MaaCore(InfrastAbstractTask)가
//   화면 OCR 결과(CharsNameOcrReplace 교정 후)와 names를 문자열 그대로 비교한다.
//   KO 번역 문서의 "중문명으로 작성" 표기는 원문("对应客户端语言的干员名")의 오역 (2026-08-02 확인).
// 매핑: TRADING-n→trading(LMD) · MANUFACTURE-n→manufacture(gold→Pure Gold, exp→Battle Record) ·
//   POWER-n→power · CONTROL→control · MEETING→meeting · HIRE→hire · WORKSHOP→processing(상시라 A/B 복제) ·
//   DORM-n→dormitory(고정 인원 + autofill로 지친 오퍼 채움) · TRAINING→스키마에 없어 제외.
// 빈 근무방은 skip:true — 계획에 없는 방을 MAA가 비워버리지 않게 "건드리지 않음"으로 남긴다.

export type MaaRoom = {
  operators: string[];
  skip?: boolean;
  sort?: boolean;
  autofill?: boolean;
  product?: string;
};

export type MaaPlan = {
  name: string;
  description?: string;
  period?: [string, string][];
  rooms: Record<string, MaaRoom[]>;
};

export type MaaInfrast = {
  title: string;
  description: string;
  plans: MaaPlan[];
};

export type MaaExportInput = {
  assignments: Record<string, string[][]>; // roomKey → shift → opIds (엔진 Plan.assignments)
  cells: { key: string; room: string; product?: string }[]; // 현재 레이아웃(LAYOUT) — 방 순서의 정본
  nameOf: (id: string) => string | undefined; // 표시 언어의 오퍼 이름 (클라이언트 언어와 일치 전제)
  shiftStarts: [string, string]; // ["08:00", "20:00"] — A/B조 시작 시각(HH:MM)
  title: string;
  description: string;
  planNames: [string, string];
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
  const { assignments, cells, nameOf, shiftStarts, title, description, planNames } = input;
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
    const plan: MaaPlan = { name: planNames[shift], rooms };
    if (hasPeriod) plan.period = shift === 0 ? periodFor(startA!, startB!) : periodFor(startB!, startA!);
    return plan;
  });

  return { title, description, plans };
}
