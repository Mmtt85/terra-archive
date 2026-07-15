"use client";

// 재료 파밍 효율표 + 육성 비용 계산기 탭.
// 효율표 데이터는 scripts/build-farm.py가 생성하는 app/data/farm.json —
// 클뜯 item/stage_table(이름 3개 언어) + 펭귄 물류 실측 드랍률(KR 개방 스테이지만).
// 재료별 스테이지 목록은 "개당 기대 이성(이성 소모 ÷ 드랍률)" 오름차순으로 이미
// 정렬돼 있고, 첫 행이 이성 대비 획득 확률이 가장 높은 최고 효율 스테이지다.
// 화면에는 재료당 효율 상위 3개 스테이지만 표시한다 (2026-07 사용자 확정).
// 육성 비용 데이터는 scripts/build-costs.py가 생성하는 app/data/costs.json —
// 정예화 1·2, 스킬 2~7, 특화 1~3, 모듈 1~3단계의 용문폐·재료 소요량.
import { useMemo, useState } from "react";
import farmData from "./data/farm.json";
import costsData from "./data/costs.json";
import type { Operator } from "./home";
import { useI18n, type Locale } from "./i18n";

type LocText = { ko: string; en?: string; ja?: string };
type FarmStage = {
  id: string;
  code: string;
  name: LocText;
  ap: number;
  kind: "main" | "perm" | "event" | "daily";
  rate: number;    // 드랍률 %
  sanity: number;  // 개당 기대 이성
  times: number;   // 펭귄 물류 표본 수
};
type FarmItem = { id: string; name: LocText; rarity: number; sortId: number; image: string; stages: FarmStage[] };

type CostList = [string, number][];
type CostEntry = {
  elite?: { lmd: number; items: CostList }[];
  skills?: CostList[];
  masteries?: { id: string; levels: CostList[] }[];
  modules?: { id: string; levels: { lmd: number; items: CostList }[] }[];
};
type CostsData = {
  updated: string;
  items: Record<string, { name: LocText; rarity: number; sortId: number; image: string }>;
  ops: Record<string, CostEntry>;
};

const data = farmData as { updated: string; minTimes: number; items: FarmItem[] };
const costs = costsData as unknown as CostsData;

// 효율표에 있는(=파밍 가능한) 재료 id — 계산기 결과에서 클릭하면 효율표 검색으로 연결
const FARMABLE_IDS = new Set(data.items.map((item) => item.id));

const TIERS = Array.from(new Set(data.items.map((item) => item.rarity))).sort((a, b) => b - a);

// 재료당 화면에 표시할 효율 스테이지 수 (데이터에는 상위 8개까지 있음)
const TOP_STAGES = 3;

// 커뮤니티 별칭 검색 (사용자 확정 2026-07-14) — 데이터 재생성과 무관하게 여기서 관리.
// 오줌=아케톤, 돌=원암+RMA70-24, 장치/좆치=장치류, 방석=연마석, 젤리=콜(로식·화이트 호스),
// 별사탕=RMA70 계열. 한국어 은어라 로케일과 무관하게 항상 검색에 걸린다.
const SEARCH_ALIASES: Record<string, string[]> = {
  "30011": ["돌"], "30012": ["돌"], "30013": ["돌"], "30014": ["돌"],
  "30051": ["오줌"], "30052": ["오줌"], "30053": ["오줌"], "30054": ["오줌"],
  "30061": ["장치", "좆치"], "30062": ["장치", "좆치"], "30063": ["장치", "좆치"], "30064": ["장치", "좆치"],
  "30073": ["젤리"], "30074": ["젤리"],
  "30093": ["방석"], "30094": ["방석"],
  "30103": ["별사탕"],
  "30104": ["돌", "별사탕"],
};

// 상시 파밍 가능 = 메인/서브 + 상설(복각) + 물자(요일 로테이션)
const PERMANENT_KINDS = new Set(["main", "perm", "daily"]);
const KIND_LABEL: Record<string, string> = { perm: "상설", event: "이벤트 한정", daily: "물자" };

function locText(locale: Locale, text: LocText): string {
  return (locale === "ko" ? text.ko : text[locale]) ?? text.ko;
}

export default function FarmGuide({ operators, includeFuture, onShowOperator }: { operators: Operator[]; includeFuture: boolean; onShowOperator: (id: string) => void }) {
  const { locale, t } = useI18n();
  const [tiers, setTiers] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [permOnly, setPermOnly] = useState(false);

  const toggleTier = (tier: number) =>
    setTiers((current) => (current.includes(tier) ? current.filter((value) => value !== tier) : [...current, tier]));

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return data.items
      .map((item) => permOnly ? { ...item, stages: item.stages.filter((stage) => PERMANENT_KINDS.has(stage.kind)) } : item)
      .filter((item) =>
        item.stages.length > 0 &&
        (tiers.length === 0 || tiers.includes(item.rarity)) &&
        (!keyword ||
          [item.name.ko, item.name.en, item.name.ja].filter(Boolean).join(" ").toLowerCase().includes(keyword) ||
          (SEARCH_ALIASES[item.id] ?? []).some((alias) => alias.includes(keyword))));
  }, [tiers, query, permOnly]);

  return (
    <section className="farm" aria-label={t("재료 파밍 효율표")}>
      <div className="farm-head">
        <span className="section-no">FARMING EFFICIENCY</span>
        <h2>{t("재료 파밍 효율표")}</h2>
        <p>{t("정예화 재료 {count}종의 실측 드랍 통계입니다. 재료마다 어느 스테이지에서 나오는지와 개당 기대 이성(이성 소모 ÷ 드랍률)을 표시하고, 이성 대비 획득 확률이 가장 높은 스테이지에 최고 효율 배지를 붙입니다.", { count: data.items.length })}</p>
        <p className="farm-source">{t("출처: 펭귄 물류 실측 통계(표본 {min}회 이상) + 클뜯 게임 데이터 · {date} 기준 한국 서버에 개방된 스테이지만 수록 · 기대 이성은 낮을수록 좋습니다.", { min: data.minTimes, date: data.updated })}</p>
      </div>

      <CostCalculator operators={operators} includeFuture={includeFuture} onShowOperator={onShowOperator} onSearchItem={(name) => { setQuery(name); setTiers([]); }} />

      <div className="farm-tools">
        <div className="filter-list farm-tier-filter" role="group" aria-label={t("등급 필터")}>
          {TIERS.map((tier) => (
            <button key={tier} type="button" className={tiers.includes(tier) ? "selected" : ""} aria-pressed={tiers.includes(tier)} onClick={() => toggleTier(tier)}>
              T{tier}<span>{data.items.filter((item) => item.rarity === tier).length}</span>
            </button>
          ))}
        </div>
        <div className="search-wrap farm-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("재료 이름·별명 검색")} aria-label={t("재료 이름·별명 검색")} /></div>
        <label className="farm-perm-toggle">
          <input type="checkbox" checked={permOnly} onChange={(event) => setPermOnly(event.target.checked)} />
          {t("상시 파밍 가능한 스테이지만 (이벤트 한정 제외)")}
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="recruit-empty">{t("조건에 맞는 재료가 없어요.")}</p>
      ) : (
        <div className="farm-grid">
          {visible.map((item) => (
            <article key={item.id} className="farm-card" style={{ "--tier": item.rarity } as React.CSSProperties}>
              <header>
                <img src={item.image} alt={locText(locale, item.name)} loading="lazy" decoding="async" />
                <div>
                  <h3>{locText(locale, item.name)}</h3>
                  <span className={`farm-tier tier-${item.rarity}`}>T{item.rarity}</span>
                </div>
              </header>
              <div className="farm-cols" aria-hidden>
                <i>{t("스테이지")}</i><i>{t("드랍률")}</i><i>{t("기대 이성")}</i>
              </div>
              <ul>
                {item.stages.slice(0, TOP_STAGES).map((stage, index) => (
                  <li key={stage.id} className={index === 0 ? "best" : undefined}
                    title={`${locText(locale, stage.name) ?? stage.code} · ${t("이성 {n} 소모", { n: stage.ap })} · ${t("표본 {n}회", { n: stage.times.toLocaleString() })}`}>
                    <b className="farm-code">{stage.code}</b>
                    <span className="farm-badges">
                      {index === 0 && <em className="best-badge">{t("최고 효율")}</em>}
                      {KIND_LABEL[stage.kind] && <em className={`kind-badge ${stage.kind}`}>{t(KIND_LABEL[stage.kind])}</em>}
                    </span>
                    <span className="farm-rate">{stage.rate}%</span>
                    <span className="farm-sanity">{stage.sanity}</span>
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

// ── 육성 비용 계산기 ──────────────────────────────────────────────────────────
// 선택한 오퍼레이터들의 정예화 1·2 + 스킬 2~7 + 전 스킬 특화 3 + 모듈 풀강(1~3단계)에
// 필요한 용문폐·재료 총량을 costs.json에서 합산한다. 항목별 토글로 범위 조절 가능.
const PARTS = ["elite", "skill", "mastery", "module"] as const;
type Part = (typeof PARTS)[number];
const PART_LABEL: Record<Part, string> = {
  elite: "정예화 1·2",
  skill: "스킬 Lv.7",
  mastery: "특화 3 (전 스킬)",
  module: "모듈 풀강",
};

function addCost(map: Map<string, number>, list: CostList) {
  for (const [id, count] of list) map.set(id, (map.get(id) ?? 0) + count);
}

function CostCalculator({ operators, includeFuture, onShowOperator, onSearchItem }: {
  operators: Operator[];
  includeFuture: boolean;
  onShowOperator: (id: string) => void;
  onSearchItem: (name: string) => void;
}) {
  const { locale, t } = useI18n();
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [parts, setParts] = useState<Record<Part, boolean>>({ elite: true, skill: true, mastery: true, module: true });

  const byId = useMemo(() => new Map(operators.map((operator) => [operator.id, operator])), [operators]);
  // 비용 데이터가 있는 오퍼만 (로봇 등 정예화·스킬 없는 유닛 제외) · 미래시 토글 반영
  const pool = useMemo(() =>
    operators.filter((operator) => costs.ops[operator.id] && (includeFuture || !operator.unreleased)),
    [operators, includeFuture]);
  const keyword = draft.trim().toLowerCase();
  const matches = keyword
    ? pool.filter((operator) => !picked.includes(operator.id) &&
        [operator.name, operator.code, ...operator.aliases].join(" ").toLowerCase().includes(keyword)).slice(0, 8)
    : [];

  const totals = useMemo(() => {
    let lmd = 0;
    const map = new Map<string, number>();
    for (const id of picked) {
      const entry = costs.ops[id];
      if (!entry) continue;
      if (parts.elite) for (const phase of entry.elite ?? []) { lmd += phase.lmd; addCost(map, phase.items); }
      if (parts.skill) for (const level of entry.skills ?? []) addCost(map, level);
      if (parts.mastery) for (const mastery of entry.masteries ?? []) for (const level of mastery.levels) addCost(map, level);
      if (parts.module) for (const mod of entry.modules ?? []) for (const level of mod.levels) { lmd += level.lmd; addCost(map, level.items); }
    }
    const rows = Array.from(map.entries())
      .map(([id, count]) => ({ id, count, meta: costs.items[id] }))
      .filter((row) => row.meta)
      .sort((a, b) => b.meta.rarity - a.meta.rarity || a.meta.sortId - b.meta.sortId);
    return { lmd, rows };
  }, [picked, parts]);

  const addOp = (id: string) => { setPicked((current) => [...current, id]); setDraft(""); };
  const removeOp = (id: string) => setPicked((current) => current.filter((value) => value !== id));

  return (
    <div className="cost-calc">
      <div className="cost-calc-head">
        <span className="section-no">COST CALCULATOR</span>
        <h3>{t("육성 비용 계산기")}</h3>
        <p>{t("오퍼레이터를 추가하면 정예화 1·2, 스킬 7레벨, 전 스킬 특화 3, 모듈 풀강까지 필요한 용문폐와 재료 총량을 계산합니다. 파밍 가능한 재료는 클릭하면 아래 효율표에서 검색됩니다.")}</p>
      </div>
      <div className="cost-tools">
        <div className="search-wrap cost-search">
          <span>⌕</span>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("오퍼레이터 이름·별명 검색 후 추가")} aria-label={t("오퍼레이터 이름·별명 검색 후 추가")} />
          {matches.length > 0 && (
            <div className="cost-suggest" role="listbox">
              {matches.map((operator) => (
                <button key={operator.id} type="button" onClick={() => addOp(operator.id)}>
                  <img src={operator.image} alt="" loading="lazy" decoding="async" />
                  <b>{operator.name}</b>
                  <small>{"★".repeat(operator.rarity)}</small>
                  {operator.unreleased && <em className="future-badge">{t("미실장")}</em>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="cost-parts" role="group" aria-label={t("계산 범위")}>
          {PARTS.map((part) => (
            <label key={part}>
              <input type="checkbox" checked={parts[part]} onChange={(event) => setParts((current) => ({ ...current, [part]: event.target.checked }))} />
              {t(PART_LABEL[part])}
            </label>
          ))}
        </div>
      </div>

      {picked.length === 0 ? (
        <p className="cost-empty">{t("아직 선택한 오퍼레이터가 없어요 — 위 검색창에서 추가해 보세요.")}</p>
      ) : (
        <>
          <div className="cost-picked">
            {picked.map((id) => {
              const operator = byId.get(id);
              if (!operator) return null;
              return (
                <span key={id} className="cost-chip" style={{ "--accent": operator.accent } as React.CSSProperties}>
                  <img src={operator.image} alt="" />
                  <button type="button" className="cost-chip-name" onClick={() => onShowOperator(id)} title={t("{name} 상세 정보 열기", { name: operator.name })}>{operator.name}</button>
                  {operator.unreleased && <em className="future-badge">{t("미실장")}</em>}
                  <button type="button" className="cost-chip-remove" onClick={() => removeOp(id)} aria-label={t("{name} 제외", { name: operator.name })}>×</button>
                </span>
              );
            })}
            <button type="button" className="cost-clear" onClick={() => setPicked([])}>{t("전체 비우기")}</button>
          </div>
          <div className="cost-result">
            <div className="cost-lmd">
              <img src="/items/4001.png" alt="" />
              <div><span>{t("용문폐")}</span><b>{totals.lmd.toLocaleString()}</b></div>
            </div>
            <div className="cost-items">
              {totals.rows.map((row) => {
                const name = locText(locale, row.meta.name);
                const farmable = FARMABLE_IDS.has(row.id);
                const body = (
                  <>
                    <span className="cost-item-icon" data-tier={row.meta.rarity}><img src={row.meta.image} alt="" loading="lazy" decoding="async" /><i>{row.count.toLocaleString()}</i></span>
                    <b>{name}</b>
                  </>
                );
                return farmable ? (
                  <button key={row.id} type="button" className="cost-item farmable" title={t("효율표에서 {name} 검색", { name })} onClick={() => onSearchItem(name)}>{body}</button>
                ) : (
                  <span key={row.id} className="cost-item">{body}</span>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
