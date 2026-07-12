"use client";

import { useMemo, useState } from "react";
import recruitData from "./data/recruit.json";

type RecruitTag = { id: number; name: string; group: number };
type RecruitOp = { id: string; name: string; rarity: number; tags: string[]; image: string; accent: string; seq: number };

const data = recruitData as { tags: RecruitTag[]; ops: RecruitOp[] };

const QUALIFICATION_TAGS = ["고급 특별 채용", "특별 채용", "신입", "로봇"];
const JOB_TAGS = ["가드", "스나이퍼", "디펜더", "메딕", "서포터", "캐스터", "스페셜리스트", "뱅가드"];
const POSITION_TAGS = ["근거리", "원거리"];
const FIXED = new Set([...QUALIFICATION_TAGS, ...JOB_TAGS, ...POSITION_TAGS]);
const AFFIX_TAGS = data.tags.map((tag) => tag.name).filter((name) => !FIXED.has(name));

const TAG_GROUPS: Array<[string, string[]]> = [
  ["자격", QUALIFICATION_TAGS],
  ["직군", JOB_TAGS],
  ["위치", POSITION_TAGS],
  ["특성", AFFIX_TAGS],
];

const RARITY_COLORS: Record<number, string> = { 6: "#c2571f", 5: "#b8860b", 4: "#7c5cbf", 3: "#3a7ca5", 2: "#5a8f4f", 1: "#75797a" };

type ComboResult = { combo: string[]; ops: RecruitOp[]; floor: number; ceil: number };

const allCombos = (tags: string[]): string[][] => {
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

const evaluate = (combo: string[]): ComboResult | null => {
  const matched = data.ops
    .filter((op) =>
      combo.every((tag) => op.tags.includes(tag)) &&
      (op.rarity !== 6 || combo.includes("고급 특별 채용")) &&
      (op.rarity !== 1 || combo.includes("로봇")) &&
      (op.rarity !== 2 || combo.includes("신입")))
    .sort((a, b) => b.rarity - a.rarity || b.seq - a.seq);
  if (matched.length === 0) return null;
  const rarities = matched.map((op) => op.rarity);
  return { combo, ops: matched, floor: Math.min(...rarities), ceil: Math.max(...rarities) };
};

export function comboResults(picked: string[]): ComboResult[] {
  return allCombos(picked)
    .map(evaluate)
    .filter((result): result is ComboResult => result !== null)
    .sort((a, b) => b.floor - a.floor || b.ceil - a.ceil || a.ops.length - b.ops.length);
}

// 자격 태그 없이 4★ 이상이 확정되는 최소 조합 사전 (부분조합이 이미 확정이면 제외)
const SNIPE_DICT: ComboResult[] = (() => {
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

function ComboCard({ result }: { result: ComboResult }) {
  return (
    <article className={`recruit-combo${result.floor >= 4 ? " prized" : ""}`}>
      <header>
        <div className="combo-tags">{result.combo.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <b style={{ background: RARITY_COLORS[result.floor] }}>
          {result.floor === result.ceil ? `${result.floor}★ 확정` : `${result.floor}★ 이상`}
        </b>
      </header>
      <ul>
        {result.ops.map((op) => (
          <li key={op.id} style={{ borderColor: RARITY_COLORS[op.rarity] }}>
            <img src={op.image} alt="" loading="lazy" decoding="async" />
            <span>{op.name}</span>
            <i style={{ color: RARITY_COLORS[op.rarity] }}>{op.rarity}★</i>
          </li>
        ))}
      </ul>
    </article>
  );
}

export default function RecruitHelper() {
  const [picked, setPicked] = useState<string[]>([]);
  const [showDict, setShowDict] = useState(false);

  const togglePicked = (tag: string) =>
    setPicked((current) => current.includes(tag) ? current.filter((item) => item !== tag) : current.length >= 3 ? current : [...current, tag]);

  const results = useMemo(() => comboResults(picked), [picked]);

  return (
    <section className="recruit" aria-label="공개모집 도우미">
      <div className="recruit-head">
        <span className="section-no">RECRUITMENT ASSIST</span>
        <h2>공채 도우미</h2>
        <p>게임과 동일하게 태그를 <b>최대 3개</b>까지 선택하면, 선택한 태그의 모든 조합별 결과를 높은 성급이 확정되는 순서로 보여줍니다.
          모집 시간 <b>9시간</b> 기준 — 1★는 로봇 태그, 2★는 신입 태그를 체크했을 때만 나오고, 6★는 고급 특별 채용이 있어야 나옵니다.</p>
      </div>

      <div className="recruit-tags">
        {TAG_GROUPS.map(([group, tags]) => (
          <fieldset key={group}>
            <legend>{group}</legend>
            <div className="filter-list">
              {tags.map((tag) => (
                <button key={tag} type="button" className={picked.includes(tag) ? "selected" : ""}
                  disabled={!picked.includes(tag) && picked.length >= 3} onClick={() => togglePicked(tag)}>{tag}</button>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="recruit-picked">
          선택 {picked.length}/3
          {picked.length > 0 && <button type="button" className="reset" onClick={() => setPicked([])}>모두 해제</button>}
        </div>
      </div>

      {picked.length === 0 ? (
        <p className="recruit-empty">태그를 선택하면 조합 결과가 여기에 표시됩니다.</p>
      ) : (
        <div className="recruit-results">
          {results.map((result) => <ComboCard key={result.combo.join("+")} result={result} />)}
        </div>
      )}

      <div className="recruit-dict">
        <button type="button" className="dict-toggle" onClick={() => setShowDict((current) => !current)}>
          4·5성 저격 조합 사전 {showDict ? "접기 ▲" : `펼치기 (${SNIPE_DICT.length}개 조합) ▼`}
        </button>
        {showDict && (
          <>
            <p>특별 채용·고급 특별 채용 없이도 <b>4★ 이상이 확정</b>되는 최소 태그 조합 전체입니다.
              모집 태그에 아래 조합이 뜨면 놓치지 마세요. (태그를 더 얹어도 확정은 유지됩니다)</p>
            <div className="recruit-results">
              {SNIPE_DICT.map((result) => <ComboCard key={result.combo.join("+")} result={result} />)}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
