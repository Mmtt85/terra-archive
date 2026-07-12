"use client";

import { useEffect, useMemo, useState } from "react";
import operatorsData from "./data/operators.json";
import InfraPlanner from "./planner";
import RecruitHelper from "./recruit";

type RangeGrid = { row: number; col: number };

type StatRow = {
  phase: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  res: number;
  cost: number;
  block: number;
  redeploy: number;
  interval: number;
  rangeId: string;
  range: RangeGrid[];
};

type Skill = {
  id: string;
  name: string;
  spType: string;
  initialSp: number;
  spCost: number;
  duration: number | null;
  description: string;
};

type Talent = { name: string; description: string };

type Potential = { rank: number; description: string };

type ModuleLevel = { level: number; stats: string | null; effects: string[] };

type OperatorModule = {
  id: string;
  name: string;
  type: string;
  unlock: string;
  levels: ModuleLevel[];
};

type Infrastructure = {
  name: string;
  room: string;
  unlock: string;
  description: string;
};

type Operator = {
  id: string;
  name: string;
  code: string;
  rarity: number;
  job: string;
  jobCode: string;
  subProfession: string;
  position: string;
  combatTags: string[];
  faction: string;
  factions: string[];
  birthplace?: string;
  race?: string;
  concepts: string[];
  aliases: string[];
  reason: string;
  trait: string;
  talents: Talent[];
  stats: StatRow[];
  skills: Skill[];
  potentials: Potential[];
  modules: OperatorModule[];
  infrastructure: Infrastructure[];
  seq: number;
  accent: string;
  image: string;
};

const operators = operatorsData as Operator[];

const factions = Array.from(new Set(operators.flatMap((operator) => operator.factions))).sort((a, b) => a.localeCompare(b, "ko"));

const conceptCounts = new Map<string, number>();
operators.forEach((operator) => operator.concepts.forEach((concept) => conceptCounts.set(concept, (conceptCounts.get(concept) ?? 0) + 1)));
const SYNERGY_POTS = ["해산물팟", "쉐이팟", "쉐라그팟", "카시미어팟", "미노스팟", "아베무팟", "연소팟", "라테라노팟", "탄약팟", "라인랩팟"];
const concepts = [
  ...SYNERGY_POTS.filter((pot) => conceptCounts.has(pot)),
  ...Array.from(conceptCounts.keys()).filter((concept) => !SYNERGY_POTS.includes(concept)).sort((a, b) => (conceptCounts.get(b) ?? 0) - (conceptCounts.get(a) ?? 0)),
];

const attackMethods = ["근거리", "원거리", "물리", "마법"];
const POSITION_METHODS = ["근거리", "원거리"];
const damageTypeOf = (operator: Operator) => (operator.trait.includes("마법 대미지") ? "마법" : "물리");
const combatTags = Array.from(new Set(operators.flatMap((operator) => operator.combatTags))).sort((a, b) => a.localeCompare(b, "ko"));
const jobs = ["뱅가드", "가드", "디펜더", "스나이퍼", "캐스터", "메딕", "서포터", "스페셜리스트"];
const subProfessions = Array.from(new Set(operators.map((operator) => operator.subProfession))).sort((a, b) => a.localeCompare(b, "ko"));

const SORT_KEYS = ["기본", "이름", "성급", "소속", "출신지", "종족", "직군", "세부 직군"];

export default function Home() {
  const [selectedFactions, setSelectedFactions] = useState<string[]>([]);
  const [selectedConcepts, setSelectedConcepts] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [selectedSubProfessions, setSelectedSubProfessions] = useState<string[]>([]);
  const [selected, setSelected] = useState<Operator | null>(null);
  const [tab, setTab] = useState<"archive" | "planner" | "recruit">("archive");

  useEffect(() => {
    const applyHash = () => {
      const hash = decodeURIComponent(window.location.hash);
      if (hash === "#infra") {
        setTab("planner");
        return;
      }
      if (hash === "#recruit") {
        setTab("recruit");
        return;
      }
      setTab("archive");
      if (hash.startsWith("#op-")) {
        const operator = operators.find((candidate) => candidate.id === hash.slice(4));
        if (operator) setSelected(operator);
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  const openOperator = (operator: Operator) => {
    setSelected(operator);
    history.replaceState(null, "", `#op-${operator.id}`);
  };
  const closeOperator = () => {
    setSelected(null);
    history.replaceState(null, "", window.location.pathname);
  };

  const switchTab = (next: "archive" | "planner" | "recruit") => {
    setTab(next);
    setSelected(null);
    if (next === "planner") window.location.hash = "infra";
    else if (next === "recruit") window.location.hash = "recruit";
    else history.replaceState(null, "", window.location.pathname);
  };
  const [sortKey, setSortKey] = useState("기본");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOperator();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selected]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return operators.filter((operator) => {
      const matchesFaction = selectedFactions.length === 0 || selectedFactions.some((faction) => operator.factions.includes(faction));
      const matchesConcept = selectedConcepts.length === 0 || selectedConcepts.some((concept) => operator.concepts.includes(concept));
      const positionPicks = selectedMethods.filter((method) => POSITION_METHODS.includes(method));
      const damagePicks = selectedMethods.filter((method) => !POSITION_METHODS.includes(method));
      const matchesMethod = (positionPicks.length === 0 || positionPicks.includes(operator.position)) && (damagePicks.length === 0 || damagePicks.includes(damageTypeOf(operator)));
      const matchesTags = tags.every((tag) => operator.combatTags.includes(tag));
      const matchesJob = selectedJobs.length === 0 || selectedJobs.includes(operator.job);
      const matchesSubProfession = selectedSubProfessions.length === 0 || selectedSubProfessions.includes(operator.subProfession);
      const matchesQuery = !keyword || [operator.name, operator.code, operator.job, operator.subProfession, operator.position, ...operator.combatTags, ...operator.factions, operator.reason, ...operator.aliases, ...operator.concepts].join(" ").toLowerCase().includes(keyword);
      return matchesFaction && matchesConcept && matchesMethod && matchesTags && matchesJob && matchesSubProfession && matchesQuery;
    });
  }, [selectedFactions, selectedConcepts, selectedMethods, tags, selectedJobs, selectedSubProfessions, query]);

  const reset = () => {
    setSelectedFactions([]);
    setSelectedConcepts([]);
    setSelectedMethods([]);
    setTags([]);
    setSelectedJobs([]);
    setSelectedSubProfessions([]);
    setQuery("");
  };

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (value: string) =>
    setter((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  const toggleTag = toggleIn(setTags);

  const hasActiveFilter = selectedFactions.length > 0 || selectedConcepts.length > 0 || selectedMethods.length > 0 || tags.length > 0 || selectedJobs.length > 0 || selectedSubProfessions.length > 0 || query.trim().length > 0;

  const sorted = useMemo(() => {
    if (sortKey === "기본") {
      const base = [...filtered].sort((a, b) => b.rarity - a.rarity || b.seq - a.seq);
      return sortAsc ? base : base.reverse();
    }
    const valueOf = (operator: Operator): string | number => {
      switch (sortKey) {
        case "이름": return operator.name;
        case "성급": return operator.rarity;
        case "소속": return operator.faction;
        case "출신지": return operator.birthplace ?? "";
        case "종족": return operator.race ?? "";
        case "직군": return jobs.indexOf(operator.job);
        case "세부 직군": return operator.subProfession;
        default: return 0;
      }
    };
    const direction = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = valueOf(a);
      const right = valueOf(b);
      const compared = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "ko");
      return compared !== 0 ? compared * direction : a.name.localeCompare(b.name, "ko");
    });
  }, [filtered, sortKey, sortAsc]);

  return (
    <main className={tab !== "archive" ? "base-main" : ""}>
      <header className="site-header" id="top">
        <a className="brand" href="#top" aria-label="테라 아카이브 홈">
          <span className="brand-mark">TA</span>
          <span>테라 아카이브<small>한국 서버 오퍼레이터 탐색기</small></span>
        </a>
        <div className="header-tagline">로도스 아일랜드 <em>비공식 작전 데이터베이스</em>.</div>
        <nav className="main-tabs" aria-label="주요 탭">
          <button className={tab === "archive" ? "selected" : ""} onClick={() => switchTab("archive")}>오퍼 백과사전</button>
          <button className={tab === "planner" ? "selected" : ""} onClick={() => switchTab("planner")}>인프라 플래너</button>
          <button className={tab === "recruit" ? "selected" : ""} onClick={() => switchTab("recruit")}>공채 도우미</button>
        </nav>
        <div className="server-chip"><span /> KR SERVER · BETA</div>
      </header>

      {tab === "archive" && <section className="explorer" aria-labelledby="explorer-title">
        <div className="filter-panel">
          <div className="panel-heading">
            <div><span className="section-no">FILTER / 01</span><h2 id="explorer-title">탐색 조건</h2></div>
            <button className="reset" onClick={reset}>↻ 초기화</button>
          </div>
          <label className="search-label" htmlFor="operator-search">오퍼레이터 검색</label>
          <div className="search-wrap"><span>⌕</span><input id="operator-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름, 별명, 직군, 효과 검색" /></div>

          <FilterGroup title="컨셉덱" items={concepts} selected={selectedConcepts} onToggle={toggleIn(setSelectedConcepts)} limit={16} countForItem={(item) => operators.filter((operator) => operator.concepts.includes(item)).length} />
          <FilterGroup title="직군" items={jobs} selected={selectedJobs} onToggle={toggleIn(setSelectedJobs)} limit={9} countForItem={(item) => operators.filter((operator) => operator.job === item).length} />
          <FilterGroup title="세부 직군" items={subProfessions} selected={selectedSubProfessions} onToggle={toggleIn(setSelectedSubProfessions)} limit={13} countForItem={(item) => operators.filter((operator) => operator.subProfession === item).length} />
          <FilterGroup title="전투 태그" items={combatTags} selected={tags} onToggle={toggleTag} limit={12} countForItem={(item) => operators.filter((operator) => operator.combatTags.includes(item)).length} />
          <FilterGroup title="공격 방식" items={attackMethods} selected={selectedMethods} onToggle={toggleIn(setSelectedMethods)} limit={4} countForItem={(item) => operators.filter((operator) => POSITION_METHODS.includes(item) ? operator.position === item : damageTypeOf(operator) === item).length} />
          <FilterGroup title="공식 소속" items={factions} selected={selectedFactions} onToggle={toggleIn(setSelectedFactions)} limit={12} countForItem={(item) => operators.filter((operator) => operator.factions.includes(item)).length} />

          <aside className="data-note"><span>DATA NOTE</span><p>한국 서버 {operators.length}명 · 전원 이미지 · 다국어 이름 및 커뮤니티 별명 검색 · 스킬과 재능 기반 {concepts.length}개 컨셉 태그를 제공합니다. 모든 필터는 토글식이며 아무것도 선택하지 않으면 전체가 표시됩니다.</p></aside>
        </div>

        <div className="results">
          <div className="results-heading">
            <div><span className="section-no">RESULT / 02</span><h2>{selectedConcepts.length === 1 ? `${selectedConcepts[0]} 컨셉덱` : selectedFactions.length === 1 ? selectedFactions[0] : hasActiveFilter ? "탐색 결과" : "전체 오퍼레이터"}</h2></div>
            <div className="results-tools">
              <label className="sort-wrap">
                <span>정렬</span>
                <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
                  {SORT_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}
                </select>
                <button type="button" className="sort-direction" onClick={() => setSortAsc((current) => !current)} aria-label={sortAsc ? "내림차순으로 변경" : "오름차순으로 변경"}>{sortAsc ? "↑" : "↓"}</button>
              </label>
              <span className="count"><b>{sorted.length}</b> OPERATORS</span>
            </div>
          </div>
          <div className="active-filters">
            {selectedFactions.map((item) => <button key={`f-${item}`} onClick={() => toggleIn(setSelectedFactions)(item)}>{item} ×</button>)}
            {selectedConcepts.map((item) => <button key={`c-${item}`} onClick={() => toggleIn(setSelectedConcepts)(item)}>{item} ×</button>)}
            {selectedMethods.map((item) => <button key={`p-${item}`} onClick={() => toggleIn(setSelectedMethods)(item)}>{item} ×</button>)}
            {tags.map((tag) => <button key={`t-${tag}`} onClick={() => toggleTag(tag)}>{tag} ×</button>)}
            {selectedJobs.map((item) => <button key={`j-${item}`} onClick={() => toggleIn(setSelectedJobs)(item)}>{item} ×</button>)}
            {selectedSubProfessions.map((item) => <button key={`s-${item}`} onClick={() => toggleIn(setSelectedSubProfessions)(item)}>{item} ×</button>)}
            {query && <button onClick={() => setQuery("")}>“{query}” ×</button>}
          </div>

          {sorted.length > 0 ? (
            <div className="operator-grid">
              {sorted.map((operator, index) => <OperatorCard key={operator.id ?? `${operator.name}-${index}`} operator={operator} index={index} onSelect={openOperator} />)}
            </div>
          ) : (
            <div className="empty"><span>NO MATCH</span><h3>조건에 맞는 오퍼레이터가 없어요.</h3><p>소속이나 컨셉 태그를 하나씩 해제해 보세요.</p><button onClick={reset}>전체 보기</button></div>
          )}
        </div>
      </section>}

      {tab === "planner" && <InfraPlanner />}
      {tab === "recruit" && <RecruitHelper />}

      {selected && <OperatorModal operator={selected} onClose={closeOperator} />}

      <footer><span>RHODES ISLAND // TERRA ARCHIVE</span><p>비공식 팬 프로젝트 · 게임 내 명칭과 데이터의 권리는 각 권리자에게 있습니다.</p></footer>
    </main>
  );
}

function FilterGroup({ title, items, selected, onToggle, limit, countForItem }: { title: string; items: string[]; selected: string[]; onToggle: (value: string) => void; limit: number; countForItem: (item: string) => number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, limit);
  return (
    <fieldset>
      <legend>{title}<small className="multi-hint">복수 선택 가능 · 전부 해제 시 전체</small></legend>
      <div className="filter-list">
        {visible.map((item) => {
          const isSelected = selected.includes(item);
          return (
            <button key={item} className={isSelected ? "selected" : ""} onClick={() => onToggle(item)} aria-pressed={isSelected}>{item}<span>{countForItem(item)}</span></button>
          );
        })}
      </div>
      {items.length > limit && (
        <button className="more-filter" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>{expanded ? "접기" : `더보기 +${items.length - limit}`}</button>
      )}
    </fieldset>
  );
}

function OperatorCard({ operator, index, onSelect }: { operator: Operator; index: number; onSelect: (operator: Operator) => void }) {
  return (
    <button type="button" className="operator-card" onClick={() => onSelect(operator)} aria-label={`${operator.name} 상세 정보 열기`} style={{ "--accent": operator.accent, "--delay": `${(index % 12) * 25}ms` } as React.CSSProperties}>
      <div className="portrait">
        <span className="portrait-grid" />
        <div className="portrait-info">
          <div className="portrait-meta"><span>{"★".repeat(operator.rarity)}</span><b>{operator.job}</b></div>
          <h3>{operator.name}</h3>
          <small className="portrait-facts">
            <span><i>소속</i>{operator.faction}</span>
            <span><i>출신</i>{operator.birthplace ?? "불명"}</span>
            <span><i>종족</i>{operator.race ?? "불명"}</span>
          </small>
        </div>
        <img src={operator.image} alt={`${operator.name} 오퍼레이터`} loading="lazy" decoding="async" />
      </div>
      <div className="card-body">
        <div className="tags">{operator.concepts.map((tag) => <span key={tag}>{tag}</span>)}</div>
      </div>
    </button>
  );
}

function OperatorModal({ operator, onClose }: { operator: Operator; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal" role="dialog" aria-modal="true" aria-labelledby="operator-modal-title" style={{ "--accent": operator.accent } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="상세 정보 닫기">×</button>
        <header className="modal-hero">
          <img src={operator.image} alt={`${operator.name} 오퍼레이터`} />
          <div className="modal-title-block">
            <span className="modal-kicker">OPERATOR FILE · {operator.code}</span>
            <h2 id="operator-modal-title">{operator.name}</h2>
            <div className="modal-rarity">{"★".repeat(operator.rarity)} <span>{operator.rarity}성</span></div>
            <div className="class-line">
              <div><b>{operator.job}</b><small>{operator.subProfession} · {operator.position}</small></div>
            </div>
          </div>
        </header>
        <div className="modal-scroll">
          <div className="modal-facts">
            <div><span>공식 소속</span><b>{operator.factions.join(" · ")}</b></div>
            <div><span>출신지</span><b>{operator.birthplace ?? "불명"}</b></div>
            <div><span>종족</span><b>{operator.race ?? "불명"}</b></div>
            <div><span>전투 태그</span><b>{operator.combatTags.length ? operator.combatTags.join(" · ") : "태그 없음"}</b></div>
            <div><span>컨셉</span><b>{operator.concepts.length ? operator.concepts.join(" · ") : "분류 없음"}</b></div>
          </div>

          <section className="detail-section">
            <span className="detail-no">POTENTIAL / 01</span>
            <h3>잠재능력</h3>
            {operator.potentials.length ? (
              <div className="potential-scroll">
                <div className="potential-list">
                  {operator.potentials.map((potential) => (
                    <article key={potential.rank}><span>P{potential.rank}</span><p>{potential.description}</p></article>
                  ))}
                </div>
              </div>
            ) : (
              <p className="no-detail">등록된 잠재능력 정보가 없습니다.</p>
            )}
          </section>

          <section className="detail-section">
            <span className="detail-no">STAT / 02</span>
            <h3>스탯</h3>
            <div className="stat-table">
              <div className="stat-row stat-head"><b>육성 단계</b><span>HP</span><span>공격</span><span>방어</span><span>마저</span><span>코스트</span><span>저지</span><span>재배치</span><span>공격 간격</span><span>공격 범위</span></div>
              {operator.stats.map((stat) => (
                <div key={stat.phase} className="stat-row">
                  <b>{stat.phase}<small> Lv.{stat.level}</small></b>
                  <span>{stat.hp}</span>
                  <span>{stat.atk}</span>
                  <span>{stat.def}</span>
                  <span>{stat.res}</span>
                  <span>{stat.cost}</span>
                  <span>{stat.block}</span>
                  <span>{stat.redeploy}초</span>
                  <span>{stat.interval}초</span>
                  <span><AttackRange grids={stat.range} /></span>
                </div>
              ))}
            </div>
          </section>

          <section className="detail-section">
            <span className="detail-no">SKILL / 03</span>
            <h3>스킬</h3>
            {operator.skills.length ? (
              <div className="skill-list">
                {operator.skills.map((skill, index) => (
                  <article key={skill.id} className="skill-detail">
                    <div className="skill-index">S{index + 1}</div>
                    <div>
                      <h4>{skill.name}</h4>
                      <div className="skill-meta">
                        <span>{skill.spType}</span>
                        <span>초기 SP {skill.initialSp}</span>
                        <span>소모 SP {skill.spCost}</span>
                        {skill.duration && <span>지속 {skill.duration}초</span>}
                      </div>
                      <p>{skill.description}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="no-detail">등록된 전투 스킬이 없습니다.</p>
            )}
          </section>

          <section className="detail-section">
            <span className="detail-no">TALENT / 04</span>
            <h3>재능</h3>
            {operator.talents.length ? (
              <div className="detail-list">
                {operator.talents.map((talent, index) => (
                  <article key={`${talent.name}-${index}`}><b>{talent.name}</b><p>{talent.description}</p></article>
                ))}
              </div>
            ) : (
              <p className="no-detail">등록된 재능이 없습니다.</p>
            )}
          </section>

          <section className="detail-section">
            <span className="detail-no">TRAIT / 05</span>
            <h3>특성</h3>
            <p>{operator.trait}</p>
          </section>

          <section className="detail-section">
            <span className="detail-no">MODULE / 06</span>
            <h3>모듈</h3>
            {operator.modules.length ? (
              <div className="module-list">
                {operator.modules.map((module) => (
                  <article key={module.id} className="module-card">
                    <header>
                      <span>{module.type}</span>
                      <div><h4>{module.name}</h4><small>{module.unlock}</small></div>
                    </header>
                    <div className="module-levels">
                      {module.levels.map((level) => (
                        <div key={level.level}>
                          <b>STAGE {level.level}</b>
                          {level.stats && <p className="module-stats">{level.stats}</p>}
                          {level.effects.map((effect, index) => <p key={index}>{effect}</p>)}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="no-detail">현재 적용 가능한 모듈이 없습니다.</p>
            )}
          </section>

          <section className="detail-section">
            <span className="detail-no">INFRA / 07</span>
            <h3>인프라 스킬</h3>
            {operator.infrastructure.length ? (
              <div className="infra-list">
                {operator.infrastructure.map((infra, index) => (
                  <article key={`${infra.name}-${index}`}>
                    <div><span>{infra.room}</span><small>{infra.unlock}</small></div>
                    <section><b>{infra.name}</b><p>{infra.description}</p></section>
                  </article>
                ))}
              </div>
            ) : (
              <p className="no-detail">등록된 인프라 스킬이 없습니다.</p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function AttackRange({ grids }: { grids: RangeGrid[] }) {
  if (!grids.length) return <small className="no-range">-</small>;
  const withOrigin = [...grids, { row: 0, col: 0 }];
  const rows = withOrigin.map((grid) => grid.row);
  const cols = withOrigin.map((grid) => grid.col);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const active = new Set(grids.map((grid) => `${grid.row}:${grid.col}`));
  const cells = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      cells.push(<i key={`${row}:${col}`} className={row === 0 && col === 0 ? "origin" : active.has(`${row}:${col}`) ? "active" : ""} />);
    }
  }
  return <span className="attack-range" style={{ gridTemplateColumns: `repeat(${maxCol - minCol + 1},8px)` }}>{cells}</span>;
}
