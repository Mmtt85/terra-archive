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

export function comboResults(picked: string[]): ComboResult[] {
  const combos: string[][] = [];
  for (let i = 0; i < picked.length; i++) {
    combos.push([picked[i]]);
    for (let j = i + 1; j < picked.length; j++) {
      combos.push([picked[i], picked[j]]);
      for (let k = j + 1; k < picked.length; k++) combos.push([picked[i], picked[j], picked[k]]);
    }
  }
  return combos
    .map((combo) => {
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
    })
    .filter((result): result is ComboResult => result !== null)
    .sort((a, b) => b.floor - a.floor || b.ceil - a.ceil || a.ops.length - b.ops.length);
}

export default function RecruitHelper() {
  const [picked, setPicked] = useState<string[]>([]);

  const togglePicked = (tag: string) =>
    setPicked((current) => current.includes(tag) ? current.filter((item) => item !== tag) : current.length >= 5 ? current : [...current, tag]);

  const results = useMemo(() => comboResults(picked), [picked]);

  return (
    <section className="recruit" aria-label="공개모집 도우미">
      <div className="recruit-head">
        <span className="section-no">RECRUITMENT ASSIST</span>
        <h2>공채 도우미</h2>
        <p>게임에서 받은 모집 태그 <b>5개</b>를 선택하면, 최대 3개 조합별로 나올 수 있는 오퍼레이터를 높은 성급 확정 순으로 보여줍니다.
          모집 시간 <b>9시간</b> 기준 — 1★는 로봇 태그, 2★는 신입 태그를 골랐을 때만 나오고, 6★는 고급 특별 채용이 있어야 나옵니다.</p>
      </div>

      <div className="recruit-tags">
        {TAG_GROUPS.map(([group, tags]) => (
          <fieldset key={group}>
            <legend>{group}</legend>
            <div className="filter-list">
              {tags.map((tag) => (
                <button key={tag} type="button" className={picked.includes(tag) ? "selected" : ""}
                  disabled={!picked.includes(tag) && picked.length >= 5} onClick={() => togglePicked(tag)}>{tag}</button>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="recruit-picked">
          선택 {picked.length}/5
          {picked.length > 0 && <button type="button" className="reset" onClick={() => setPicked([])}>모두 해제</button>}
        </div>
      </div>

      {picked.length === 0 ? (
        <p className="recruit-empty">태그를 선택하면 조합 결과가 여기에 표시됩니다.</p>
      ) : (
        <div className="recruit-results">
          {results.map((result) => (
            <article key={result.combo.join("+")} className={`recruit-combo${result.floor >= 4 ? " prized" : ""}`}>
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
          ))}
        </div>
      )}
    </section>
  );
}
