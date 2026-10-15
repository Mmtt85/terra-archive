// 공개모집 조합 계산 — 계산기(app/recruit.tsx, 브라우저)와 공채 페이지 서버 안내(app/recruit-seo.tsx)가 같이 쓴다 (2026-10-15).
// "use client" 를 붙이지 않는다 — 서버 컴포넌트가 값으로 가져다 쓰려면 일반 모듈이어야 한다
import recruitData from "./data/recruit.json";

export type RecruitTag = { id: number; name: string; group: number };
export type RecruitOp = { id: string; name: string; rarity: number; tags: string[]; image: string; accent: string; seq: number; pending?: boolean };

export const data = recruitData as { tags: RecruitTag[]; ops: RecruitOp[] };

// 조합 계산은 전부 KR 태그명을 정본으로 돌리고, 표시할 때만 로케일 이름으로 바꾼다
// (태그 번역은 gacha_table tagId로 대응 — extra-i18n.*.json의 recruitTags)
export const QUALIFICATION_TAGS = ["고급 특별 채용", "특별 채용", "신입", "로봇"];
export const JOB_TAGS = ["가드", "스나이퍼", "디펜더", "메딕", "서포터", "캐스터", "스페셜리스트", "뱅가드"];
export const POSITION_TAGS = ["근거리", "원거리"];
const FIXED = new Set([...QUALIFICATION_TAGS, ...JOB_TAGS, ...POSITION_TAGS]);
const AFFIX_TAGS = data.tags.map((tag) => tag.name).filter((name) => !FIXED.has(name));

export const TAG_GROUPS: Array<[string, string[]]> = [
  ["자격", QUALIFICATION_TAGS],
  ["직군", JOB_TAGS],
  ["위치", POSITION_TAGS],
  ["특성", AFFIX_TAGS],
];


// lowOps: 모집 시간을 낮춰야만 등장하는 1·2성 — 배지(floor/ceil)는 9시간 기준(3★+)으로만 계산
export type ComboResult = { combo: string[]; ops: RecruitOp[]; lowOps: RecruitOp[]; floor: number; ceil: number };


export const allCombos = (tags: string[]): string[][] => {
  const combos: string[][] = [];
  for (let i = 0; i < tags.length; i++) {
    combos.push([tags[i]]);
    for (let j = i + 1; j < tags.length; j++) {
      combos.push([tags[i], tags[j]]);
      for (let k = j + 1; k < tags.length; k++) combos.push([tags[i], tags[j], tags[k]]);
    }
  }
  return combos;
};

export const evaluate = (combo: string[]): ComboResult | null => {
  const byRarity = (op: RecruitOp) =>
    combo.every((tag) => op.tags.includes(tag)) &&
    (op.rarity !== 6 || combo.includes("고급 특별 채용"));
  const all = data.ops.filter(byRarity).sort((a, b) => b.rarity - a.rarity || b.seq - a.seq);
  const ops = all.filter((op) => op.rarity >= 3);
  const lowOps = all.filter((op) => op.rarity <= 2);
  if (all.length === 0) return null;
  // 배지는 9시간 기준 — 3★+ 매칭이 없고 저시간 전용(로봇 등)만 있으면 그 성급으로 표시
  const rarities = (ops.length ? ops : lowOps).map((op) => op.rarity);
  return { combo, ops, lowOps, floor: Math.min(...rarities), ceil: Math.max(...rarities) };
};

export function comboResults(picked: string[]): ComboResult[] {
  return allCombos(picked)
    .map(evaluate)
    .filter((result): result is ComboResult => result !== null)
    .sort((a, b) => b.floor - a.floor || b.ceil - a.ceil || a.ops.length - b.ops.length);
}

// 자격 태그 없이 4★ 이상이 확정되는 최소 조합 사전 (부분조합이 이미 확정이면 제외)
export const SNIPE_DICT: ComboResult[] = (() => {
  const names = data.tags.map((tag) => tag.name).filter((name) => name !== "고급 특별 채용" && name !== "특별 채용");
  const key = (combo: string[]) => [...combo].sort().join("+");
  const qualifying = new Map<string, ComboResult>();
  for (const combo of allCombos(names)) {
    const result = evaluate(combo);
    if (result && result.floor >= 4) qualifying.set(key(combo), result);
  }
  return [...qualifying.values()]
    .filter(({ combo }) => combo.every((_, index) => {
      const subset = combo.filter((__, position) => position !== index);
      return subset.length === 0 || !qualifying.has(key(subset));
    }))
    .sort((a, b) => b.floor - a.floor || a.combo.length - b.combo.length || a.ops.length - b.ops.length);
})();
