"use client";

import { useMemo, useState } from "react";

type Operator = {
  name: string;
  code: string;
  rarity: number;
  job: string;
  faction: string;
  concepts: string[];
  reason: string;
  accent: string;
};

const operators: Operator[] = [
  { name: "첸", code: "CH'EN", rarity: 6, job: "가드", faction: "염국", concepts: ["공격 회복"], reason: "공격 회복 스킬과 아군의 공격·피격 회복 SP를 보조하는 재능", accent: "#dc5a45" },
  { name: "총웨", code: "CHONGYUE", rarity: 6, job: "가드", faction: "염국", concepts: ["공격 회복"], reason: "공격으로 SP를 채워 스킬을 누적 강화하는 핵심 딜러", accent: "#d5963e" },
  { name: "시", code: "DUSK", rarity: 6, job: "캐스터", faction: "염국", concepts: ["소환물"], reason: "프리링을 소환해 저지선과 화력을 함께 구성", accent: "#6f72b8" },
  { name: "링", code: "LING", rarity: 6, job: "서포터", faction: "염국", concepts: ["소환물"], reason: "여러 형태의 소환수로 전장을 단독 설계", accent: "#6576a9" },
  { name: "스카디", code: "SKADI", rarity: 6, job: "가드", faction: "어비셜 헌터스", concepts: ["어비셜 시너지"], reason: "어비셜 헌터 진영 강화와 단일 대상 압박", accent: "#44799d" },
  { name: "글래디아", code: "GLADIIA", rarity: 6, job: "스페셜리스트", faction: "어비셜 헌터스", concepts: ["어비셜 시너지", "강제 이동"], reason: "어비셜 헌터에게 체력 회복과 피해 감소를 제공", accent: "#7c4f79" },
  { name: "스펙터 디 언체인드", code: "SPECTER", rarity: 6, job: "스페셜리스트", faction: "어비셜 헌터스", concepts: ["어비셜 시너지"], reason: "대역과 모듈을 통해 어비셜 덱의 생존·화력 축 담당", accent: "#865a75" },
  { name: "안드레아나", code: "ANDREANA", rarity: 5, job: "스나이퍼", faction: "어비셜 헌터스", concepts: ["어비셜 시너지"], reason: "어비셜 헌터의 공격 속도를 높이는 장거리 딜러", accent: "#745e8b" },
  { name: "블레미샤인", code: "BLEMISHINE", rarity: 6, job: "디펜더", faction: "카시미어", concepts: ["수면", "피격 회복"], reason: "수면 상태의 적을 공격할 수 있고 피격 회복 스킬을 지원", accent: "#c79e47" },
  { name: "에라토", code: "ERATO", rarity: 5, job: "스나이퍼", faction: "미노스", concepts: ["수면"], reason: "수면 부여 후 잠든 적을 우선 공격하는 연계 딜러", accent: "#b37f50" },
  { name: "블랙나이트", code: "BLACKNIGHT", rarity: 5, job: "뱅가드", faction: "림 빌리턴", concepts: ["수면", "소환물"], reason: "소환수 주변에 범위 수면을 걸어 흐름을 끊음", accent: "#62758e" },
  { name: "카프카", code: "KAFKA", rarity: 5, job: "스페셜리스트", faction: "컬럼비아", concepts: ["수면", "쾌속 배치"], reason: "배치 즉시 주변 적을 재워 안전한 딜 타이밍을 생성", accent: "#6b8c68" },
  { name: "아르케토", code: "ARCHETTO", rarity: 6, job: "스나이퍼", faction: "라테라노", concepts: ["공격 회복"], reason: "스나이퍼의 공격 회복 스킬 SP를 주기적으로 충전", accent: "#b98b43" },
  { name: "스테인리스", code: "STAINLESS", rarity: 6, job: "서포터", faction: "빅토리아", concepts: ["공격 회복", "소환물"], reason: "장치를 타격해 공격 회복 SP와 스킬 발동을 가속", accent: "#b07645" },
  { name: "리스캄", code: "LISKARM", rarity: 5, job: "디펜더", faction: "BSW", concepts: ["피격 회복", "SP 배터리"], reason: "공격받을 때 인접 아군에게 SP를 공급", accent: "#4f6c92" },
  { name: "와파린", code: "WARFARIN", rarity: 5, job: "메딕", faction: "로도스 아일랜드", concepts: ["SP 배터리"], reason: "공격 범위 내 적 처치 시 무작위 아군에게 SP 공급", accent: "#a34652" },
  { name: "그노시스", code: "GNOSIS", rarity: 6, job: "서포터", faction: "쉐라그", concepts: ["냉기·빙결"], reason: "냉기 중첩과 빙결로 취약 효과를 만드는 핵심 제어", accent: "#5b7c99" },
  { name: "오로라", code: "AURORA", rarity: 5, job: "디펜더", faction: "쉐라그", concepts: ["냉기·빙결"], reason: "빙결된 적을 상대로 강력한 단발 피해를 가함", accent: "#6291a5" },
];

const factions = ["전체", ...Array.from(new Set(operators.map((operator) => operator.faction)))];
const concepts = ["전체", "공격 회복", "수면", "어비셜 시너지", "SP 배터리", "소환물", "냉기·빙결", "피격 회복"];

export default function Home() {
  const [faction, setFaction] = useState("전체");
  const [concept, setConcept] = useState("전체");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return operators.filter((operator) => {
      const matchesFaction = faction === "전체" || operator.faction === faction;
      const matchesConcept = concept === "전체" || operator.concepts.includes(concept);
      const matchesQuery = !keyword || [operator.name, operator.code, operator.job, operator.faction, operator.reason, ...operator.concepts].join(" ").toLowerCase().includes(keyword);
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

          <aside className="data-note"><span>DATA NOTE</span><p>현재는 대표 오퍼레이터로 구성한 기능 시제품입니다. 컨셉 태그는 한국 서버 설명문을 기준으로 계속 검수·확장할 예정입니다.</p></aside>
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
  return <fieldset><legend>{title}</legend><div className="filter-list">{items.map((item) => <button key={item} className={selected === item ? "selected" : ""} onClick={() => onSelect(item)} aria-pressed={selected === item}>{item}<span>{item === "전체" ? operators.length : operators.filter((operator) => title === "공식 소속" ? operator.faction === item : operator.concepts.includes(item)).length}</span></button>)}</div></fieldset>;
}

function OperatorCard({ operator, index }: { operator: Operator; index: number }) {
  return <article className="operator-card" style={{ "--accent": operator.accent, "--delay": `${index * 35}ms` } as React.CSSProperties}>
    <div className="card-top"><span className="rarity">{"★".repeat(operator.rarity)}</span><span className="job">{operator.job}</span></div>
    <div className="portrait" aria-hidden="true"><span className="portrait-grid" /><b>{operator.code.slice(0, 2)}</b><small>{operator.code}</small></div>
    <div className="card-body"><div className="name-line"><div><h3>{operator.name}</h3><span>{operator.code}</span></div><i>{operator.faction}</i></div>
      <div className="tags">{operator.concepts.map((tag) => <span key={tag}>{tag}</span>)}</div>
      <p>{operator.reason}</p>
    </div>
  </article>;
}
