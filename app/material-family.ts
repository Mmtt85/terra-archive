// 육성 재료 종류(계열) — 아이템 도감·재료 파밍이 함께 쓰는 필터 (사용자 지시 2026-09-29 "작전기록류 / 칩 류 /
// 스킬개론 / 모듈류(데이터 메모리, 모듈 데이터 칩, 데이터 리더기) / 열합금류 / 젤류 등등으로 필터").
//
// 종류는 게임 아이템 id 규칙으로 가른다 — 이름은 등급마다 제각각이라(원암 → 원암 큐브 → 정제 원암, 유사 응결핵 →
// 카이랄 굴광체) 이름으로는 못 묶는다.
//   · 기본 재료는 5자리 '30xxy'·'31xxy' — 앞 네 자리가 계열, 끝자리가 등급 (30011 원암 … 30014 정제 원암,
//     31023 열합금 · 31024 열합금 팩). 끝자리 5 는 계열 없는 **T5 조합 재료** (30115 중합제 … 30165 중위상 이성질체).
//   · 칩 32[1-8][1-3] + 칩 첨가제 32001 · 작전기록 2001~2004 · 스킬개론 3301~3303 · 모듈 mod_*
//   ⚠ 4자리 '3003'(순금)·'3105'(용골)·'3112'(카본) 같은 기지·가구 재료는 5자리 규칙에 안 걸린다 — 종류 없음.

export function materialFamily(id: string): string | null {
  if (/^200[1-4]$/.test(id)) return "exp";
  if (/^330[1-3]$/.test(id)) return "skill";
  if (/^32[1-8][1-3]$/.test(id) || id === "32001") return "chip";
  if (/^mod_(unlock|update)_token/.test(id)) return "mod";
  const m = /^(3[01]\d{2})(\d)$/.exec(id);
  if (m) return m[2] === "5" ? "t5" : m[1];
  return null;
}

// 표시 순서와 이름(한국어 = i18n 키). 이름은 계열의 공식 표기에서 따왔고, 두 등급 이름이 따로 노는 계열은 둘을
// 잇는다(3109 유사 응결핵·카이랄 굴광체). 여기 없는 새 계열(중섭 선행 등)은 목록 맨 뒤에 **그 계열에서 가장 낮은
// 등급 재료의 이름**으로 뜬다 — 이름을 정해 여기 적으면 된다.
const FAMILIES: [key: string, label: string][] = [
  ["exp", "작전기록"], ["skill", "스킬개론"], ["chip", "칩"], ["mod", "모듈"],
  ["3001", "원암"], ["3002", "포도당"], ["3003", "폴리에스테르"], ["3004", "이철"], ["3005", "아케톤"], ["3006", "장치"],
  ["3007", "콜"], ["3008", "망간"], ["3009", "연마석"], ["3010", "RMA"],
  ["3101", "젤"], ["3102", "열합금"], ["3103", "결정"], ["3104", "용제"], ["3105", "절삭유"], ["3106", "합성 소금"],
  ["3107", "섬유"], ["3108", "고리탄화수소"], ["3109", "응결핵·굴광체"], ["3110", "액화 가스"], ["3111", "전극·동력 유닛"],
  ["t5", "T5 조합 재료"],
];
const ORDER = new Map(FAMILIES.map(([key], index) => [key, index]));
const LABEL = new Map(FAMILIES);

/** 목록에 **실제로 있는** 종류만 위 순서대로 — 칸 목록·개수·이름. 없는 종류(도감에 없는 미실장 등)는 칸을 안 만든다. */
export function familyIndex(items: { id: string; tier: number; name: string }[]) {
  const count = new Map<string, number>();
  const lowest = new Map<string, { tier: number; name: string }>();
  for (const item of items) {
    const key = materialFamily(item.id);
    if (!key) continue;
    count.set(key, (count.get(key) ?? 0) + 1);
    const cur = lowest.get(key);
    if (!cur || item.tier < cur.tier) lowest.set(key, { tier: item.tier, name: item.name });
  }
  const keys = [...count.keys()].sort((a, b) => (ORDER.get(a) ?? 999) - (ORDER.get(b) ?? 999) || a.localeCompare(b));
  return {
    keys,
    count: (key: string) => count.get(key) ?? 0,
    /** 표시 이름 — 정해 둔 이름은 t()로 옮기고, 새 계열은 이미 현지화된 재료 이름을 그대로 쓴다 */
    label: (key: string, t: (ko: string) => string) => {
      const ko = LABEL.get(key);
      return ko ? t(ko) : lowest.get(key)?.name ?? key;
    },
  };
}
