"use client";

import { useMemo, useState } from "react";
import recruitData from "./data/recruit.json";

type RecruitTag = { id: number; name: string; group: number };
type RecruitOp = { id: string; name: string; rarity: number; tags: string[]; image: string; accent: string; seq: number; pending?: boolean };

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

function ComboCard({ result, onShowOperator }: { result: ComboResult; onShowOperator?: (id: string) => void }) {
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
          <li key={op.id} className={op.pending ? "pending" : undefined} style={{ borderColor: RARITY_COLORS[op.rarity] }}>
            <img src={op.image} alt="" loading="lazy" decoding="async" className={onShowOperator ? "op-link" : undefined}
              title={onShowOperator ? `${op.name} 상세 정보` : undefined} onClick={() => onShowOperator?.(op.id)} />
            <span>{op.name}{op.pending && <em className="pending-tag">추가 예정</em>}</span>
            <i style={{ color: RARITY_COLORS[op.rarity] }}>{op.rarity}★</i>
          </li>
        ))}
      </ul>
    </article>
  );
}

const ALL_TAG_NAMES = data.tags.map((tag) => tag.name);

export default function RecruitHelper({ onShowOperator }: { onShowOperator?: (id: string) => void } = {}) {
  const [showDict, setShowDict] = useState(false);
  const [quick, setQuick] = useState("");
  const [manualOn, setManualOn] = useState<string[]>([]);   // 직접 클릭해 켠 태그
  const [manualOff, setManualOff] = useState<string[]>([]); // 자동 선택을 직접 꺼둔 태그

  // 빠른 입력: 각 글자를 첫 글자로 갖는 태그만 표시하고, 후보가 하나뿐이면 자동 선택.
  // 선택은 현재 입력 문자열에서 매번 다시 계산한다 — 한글 IME 조합 중간 상태
  // (예: "가메" 입력 도중 '감')에서 잘못 붙은 자동 선택이 다음 키 입력에서 스스로 풀리게.
  const quickChars = Array.from(new Set(quick.replace(/\s/g, "").split("")));
  const autoPicks = useMemo(() =>
    quickChars
      .map((char) => ALL_TAG_NAMES.filter((name) => name[0] === char))
      .filter((candidates) => candidates.length === 1)
      .map((candidates) => candidates[0]),
    [quick]);
  const picked = useMemo(() => {
    const merged = [...autoPicks.filter((tag) => !manualOff.includes(tag))];
    for (const tag of manualOn) if (!merged.includes(tag)) merged.push(tag);
    return merged.slice(0, 5);
  }, [autoPicks, manualOn, manualOff]);

  const isVisible = (tag: string) => quickChars.length === 0 || quickChars.includes(tag[0]) || picked.includes(tag);
  const togglePicked = (tag: string) => {
    if (picked.includes(tag)) {
      setManualOn((current) => current.filter((item) => item !== tag));
      if (autoPicks.includes(tag)) setManualOff((current) => [...current, tag]);
    } else {
      setManualOff((current) => current.filter((item) => item !== tag));
      if (picked.length < 5 && !autoPicks.includes(tag)) setManualOn((current) => [...current, tag]);
    }
  };
  const clearAll = () => { setQuick(""); setManualOn([]); setManualOff([]); };

  const results = useMemo(() => comboResults(picked), [picked]);

  return (
    <section className="recruit" aria-label="공개모집 도우미">
      <div className="recruit-head">
        <span className="section-no">RECRUITMENT ASSIST</span>
        <h2>공채 도우미</h2>
        <p>게임 공개모집에 <b>제시된 태그 5개</b>를 아래에서 그대로 입력하세요. 실제 게임에서 체크할 수 있는 <b>최대 3개</b>짜리 조합 전부를 계산해,
          높은 성급이 확정되는 조합부터 순서대로 보여줍니다.
          결과는 모집 시간 <b>9시간</b> 기준 — 1★는 로봇 태그, 2★는 신입 태그를 체크했을 때만 나오고, 6★는 고급 특별 채용이 있어야 나옵니다.</p>
        <p className="recruit-time-note"><b>모집 시간별 출현 성급</b> —
          1시간~3시간 50분: <b>1·2·3·4★</b> ·
          4시간~7시간 30분: <b>2·3·4·5★</b> ·
          7시간 40분 이상: <b>3·4·5★</b>만 출현.
          저격 조합은 반드시 <b>7시간 40분 이상(보통 9시간)</b>으로 돌려야 3★ 미만이 섞이지 않습니다.</p>
      </div>

      <div className="recruit-tags">
        <div className="quick-wrap">
          <input value={quick} onChange={(event) => setQuick(event.target.value)}
            placeholder="빠른 입력 — 태그 첫 글자를 이어서 입력 (예: 가메신생범)" aria-label="태그 첫 글자 빠른 입력" />
          <button type="button" className="clear-btn" onClick={clearAll}>클리어</button>
        </div>
        {TAG_GROUPS.map(([group, tags]) => {
          const shown = tags.filter(isVisible);
          if (shown.length === 0) return null;
          return (
            <fieldset key={group}>
              <legend>{group}</legend>
              <div className="filter-list">
                {shown.map((tag) => (
                  <button key={tag} type="button" className={picked.includes(tag) ? "selected" : ""}
                    disabled={!picked.includes(tag) && picked.length >= 5} onClick={() => togglePicked(tag)}>{tag}</button>
                ))}
              </div>
            </fieldset>
          );
        })}
        <div className="recruit-picked">
          제시된 태그 {picked.length}/5 · 체크 조합은 3개까지 계산
        </div>
      </div>

      {picked.length === 0 ? (
        <p className="recruit-empty">태그를 선택하면 조합 결과가 여기에 표시됩니다.</p>
      ) : (
        <div className="recruit-results">
          {results.map((result) => <ComboCard key={result.combo.join("+")} result={result} onShowOperator={onShowOperator} />)}
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
              {SNIPE_DICT.map((result) => <ComboCard key={result.combo.join("+")} result={result} onShowOperator={onShowOperator} />)}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
