"use client";

import { useMemo, useState } from "react";
import operatorsData from "./data/operators.json";

type Operator = {
  id: string;
  name: string;
  code: string;
  rarity: number;
  job: string;
  faction: string;
  factions: string[];
  concepts: string[];
  aliases: string[];
  reason: string;
  accent: string;
  image: string;
};

const operators = operatorsData as Operator[];

const byCount = (counts: Map<string, number>) => (a: string, b: string) =>
  (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b, "ko");

const tally = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
};

const factionCounts = tally(operators.flatMap((operator) => operator.factions));
const conceptCounts = tally(operators.flatMap((operator) => operator.concepts));
const factions = ["전체", ...Array.from(factionCounts.keys()).sort(byCount(factionCounts))];
const concepts = ["전체", ...Array.from(conceptCounts.keys()).sort(byCount(conceptCounts))];

export default function Home() {
  const [faction, setFaction] = useState("전체");
  const [concept, setConcept] = useState("전체");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return operators.filter((operator) => {
      const matchesFaction = faction === "전체" || operator.factions.includes(faction);
      const matchesConcept = concept === "전체" || operator.concepts.includes(concept);
      const matchesQuery = !keyword || [operator.name, operator.code, operator.job, operator.faction, operator.reason, ...operator.concepts, ...operator.aliases].join(" ").toLowerCase().includes(keyword);
      return matchesFaction && matchesConcept && matchesQuery;
    });
  }, [faction, concept, query]);

  const reset = () => { setFaction("전체"); setConcept("전체"); setQuery(""); };

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="테라 아카이브 홈">
          <span className="brand-mark">TA</span>
          <span>테라 아카이브<small>한국 서버 오퍼레이터 탐색기</small></span>
        </a>
        <div className="server-chip"><span /> KR SERVER · BETA</div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span>01</span> OPERATOR SYNERGY FINDER</div>
        <h1>소속을 넘어,<br /><em>함께 싸울 이유</em>로 찾기.</h1>
        <p>공식 진영부터 수면, 공격 회복, SP 배터리 같은 컨셉덱까지.<br />원하는 시너지를 선택하면 어울리는 오퍼레이터만 모아 보여드려요.</p>
        <div className="hero-stats">
          <div><strong>{operators.length}</strong><span>현재 등록</span></div>
          <div><strong>{factions.length - 1}</strong><span>소속</span></div>
          <div><strong>{concepts.length - 1}</strong><span>컨셉 태그</span></div>
        </div>
      </section>

      <section className="explorer" aria-labelledby="explorer-title">
        <div className="filter-panel">
          <div className="panel-heading">
            <div><span className="section-no">FILTER / 01</span><h2 id="explorer-title">탐색 조건</h2></div>
            <button className="reset" onClick={reset}>↻ 초기화</button>
          </div>
          <label className="search-label" htmlFor="operator-search">오퍼레이터 검색</label>
          <div className="search-wrap"><span>⌕</span><input id="operator-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름, 직군, 효과 검색" /></div>

          <FilterGroup title="공식 소속" items={factions} selected={faction} onSelect={setFaction} />
          <FilterGroup title="컨셉덱" items={concepts} selected={concept} onSelect={setConcept} />

          <aside className="data-note"><span>DATA NOTE</span><p>한국 서버 기준 오퍼레이터 {operators.length}명을 수록했습니다. 컨셉 태그는 한국 서버 설명문을 기준으로 계속 검수·확장할 예정이며, 초상화 이미지는 ArknightsGameResource 저장소를 사용합니다.</p></aside>
        </div>

        <div className="results">
          <div className="results-heading">
            <div><span className="section-no">RESULT / 02</span><h2>{concept === "전체" ? (faction === "전체" ? "전체 오퍼레이터" : faction) : concept + " 컨셉덱"}</h2></div>
            <span className="count"><b>{filtered.length}</b> OPERATORS</span>
          </div>
          <div className="active-filters">
            {faction !== "전체" && <button onClick={() => setFaction("전체")}>{faction} ×</button>}
            {concept !== "전체" && <button onClick={() => setConcept("전체")}>{concept} ×</button>}
            {query && <button onClick={() => setQuery("")}>“{query}” ×</button>}
          </div>

          {filtered.length > 0 ? (
            <div className="operator-grid">
              {filtered.map((operator, index) => <OperatorCard key={operator.name} operator={operator} index={index} />)}
            </div>
          ) : (
            <div className="empty"><span>NO MATCH</span><h3>조건에 맞는 오퍼레이터가 없어요.</h3><p>소속이나 컨셉 태그를 하나씩 해제해 보세요.</p><button onClick={reset}>전체 보기</button></div>
          )}
        </div>
      </section>
      <footer><span>RHODES ISLAND // TERRA ARCHIVE</span><p>비공식 팬 프로젝트 · 게임 내 명칭과 데이터의 권리는 각 권리자에게 있습니다.</p></footer>
    </main>
  );
}

function FilterGroup({ title, items, selected, onSelect }: { title: string; items: string[]; selected: string; onSelect: (value: string) => void }) {
  return <fieldset><legend>{title}</legend><div className="filter-list">{items.map((item) => <button key={item} className={selected === item ? "selected" : ""} onClick={() => onSelect(item)} aria-pressed={selected === item}>{item}<span>{item === "전체" ? operators.length : (title === "공식 소속" ? factionCounts.get(item) : conceptCounts.get(item)) ?? 0}</span></button>)}</div></fieldset>;
}

function OperatorCard({ operator, index }: { operator: Operator; index: number }) {
  return <article className="operator-card" style={{ "--accent": operator.accent, "--delay": `${Math.min(index * 35, 420)}ms` } as React.CSSProperties}>
    <div className="card-top"><span className="rarity">{"★".repeat(operator.rarity)}</span><span className="job">{operator.job}</span></div>
    <div className="portrait" aria-hidden="true"><span className="portrait-grid" /><img src={operator.image} alt="" loading="lazy" /><small>{operator.code}</small></div>
    <div className="card-body"><div className="name-line"><div><h3>{operator.name}</h3><span>{operator.code}</span></div><i>{operator.faction}</i></div>
      <div className="tags">{operator.concepts.map((tag) => <span key={tag}>{tag}</span>)}</div>
      <p>{operator.reason}</p>
    </div>
  </article>;
}
