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
type CostItemMeta = {
  name: LocText; rarity: number; sortId: number; image: string;
  desc?: LocText; usage?: LocText; craft?: CostList; craftGold?: number;
};
type CostsData = {
  updated: string;
  items: Record<string, CostItemMeta>;
  ops: Record<string, CostEntry>;
};

const data = farmData as { updated: string; minTimes: number; items: FarmItem[] };
const costs = costsData as unknown as CostsData;

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
  // 재료 상세 모달 — 효율표·계산기의 모든 재료 아이콘에서 연다 (id = item id)
  const [shownItem, setShownItem] = useState<string | null>(null);

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

      <CostCalculator operators={operators} includeFuture={includeFuture} onShowOperator={onShowOperator} onShowItem={setShownItem} />

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
                <button type="button" className="farm-item-btn" onClick={() => setShownItem(item.id)} title={t("{name} 상세 정보 열기", { name: locText(locale, item.name) })}>
                  <img src={item.image} alt={locText(locale, item.name)} loading="lazy" decoding="async" />
                </button>
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

      {shownItem && (
        <ItemModal
          id={shownItem}
          onClose={() => setShownItem(null)}
          onShowItem={setShownItem}
          onSearchItem={(name) => { setQuery(name); setTiers([]); setShownItem(null); }}
        />
      )}
    </section>
  );
}

// ── 육성 비용 계산기 ──────────────────────────────────────────────────────────
// 선택한 오퍼레이터마다 정예화 1/2, 스킬 Lv.2~7 각 레벨, 스킬별 특화 1/2/3, 모듈별
// 1/2/3단계를 전부 개별 행 + 개별 체크박스로 나열한다 (2026-07 사용자 확정: 뭉뚱그리지
// 말 것). 합계는 체크된 행만 합산한다. 재료 아이콘 클릭 = 재료 상세 모달.
function addCost(map: Map<string, number>, list: CostList) {
  for (const [id, count] of list) map.set(id, (map.get(id) ?? 0) + count);
}

// 한 오퍼의 비용을 "그룹 라벨 + 단계 라벨 + 용문폐 + 재료" 행 목록으로 분해
type CostRow = { key: string; group: string; step: string; lmd: number; items: CostList };

function buildRows(operator: Operator, entry: CostEntry, t: (key: string, params?: Record<string, string | number>) => string): CostRow[] {
  const rows: CostRow[] = [];
  (entry.elite ?? []).forEach((phase, index) => {
    rows.push({ key: `e${index}`, group: t("정예화"), step: `${index + 1}`, lmd: phase.lmd, items: phase.items });
  });
  (entry.skills ?? []).forEach((items, index) => {
    rows.push({ key: `s${index}`, group: t("스킬"), step: `Lv.${index + 2}`, lmd: 0, items });
  });
  (entry.masteries ?? []).forEach((mastery, index) => {
    const skillName = operator.skills.find((skill) => skill.id === mastery.id)?.name ?? `S${index + 1}`;
    mastery.levels.forEach((items, level) => {
      rows.push({ key: `m${index}-${level}`, group: `S${index + 1} · ${skillName}`, step: t("특화 {n}", { n: level + 1 }), lmd: 0, items });
    });
  });
  (entry.modules ?? []).forEach((mod, index) => {
    const meta = operator.modules.find((candidate) => candidate.id === mod.id);
    const label = meta ? `${meta.type} · ${meta.name}` : `MODULE ${index + 1}`;
    mod.levels.forEach((level, stage) => {
      rows.push({ key: `d${index}-${stage}`, group: label, step: `STAGE ${stage + 1}`, lmd: level.lmd, items: level.items });
    });
  });
  return rows;
}

function CostCalculator({ operators, includeFuture, onShowOperator, onShowItem }: {
  operators: Operator[];
  includeFuture: boolean;
  onShowOperator: (id: string) => void;
  onShowItem: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  // 개별 행 체크 상태 — 기본 전부 포함, 끈 행만 "opId/rowKey"로 기록
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

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

  const toggleRow = (opId: string, rowKey: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      const key = `${opId}/${rowKey}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // 오퍼 단위 전체 선택/해제 — 하나라도 꺼져 있으면 전체 선택, 모두 켜져 있으면 전체 해제
  const toggleAll = (opId: string, rowKeys: string[]) =>
    setExcluded((current) => {
      const next = new Set(current);
      const anyOff = rowKeys.some((rowKey) => next.has(`${opId}/${rowKey}`));
      for (const rowKey of rowKeys) {
        if (anyOff) next.delete(`${opId}/${rowKey}`);
        else next.add(`${opId}/${rowKey}`);
      }
      return next;
    });

  const totals = useMemo(() => {
    let lmd = 0;
    const map = new Map<string, number>();
    for (const id of picked) {
      const operator = byId.get(id);
      const entry = costs.ops[id];
      if (!operator || !entry) continue;
      for (const row of buildRows(operator, entry, t)) {
        if (excluded.has(`${id}/${row.key}`)) continue;
        lmd += row.lmd;
        addCost(map, row.items);
      }
    }
    const rows = Array.from(map.entries())
      .map(([id, count]) => ({ id, count, meta: costs.items[id] }))
      .filter((row) => row.meta)
      .sort((a, b) => b.meta.rarity - a.meta.rarity || a.meta.sortId - b.meta.sortId);
    return { lmd, rows };
  }, [picked, excluded, byId, t]);

  const addOp = (id: string) => { setPicked((current) => [...current, id]); setDraft(""); };
  const removeOp = (id: string) =>
    setPicked((current) => current.filter((value) => value !== id));

  return (
    <div className="cost-calc">
      <div className="cost-calc-head">
        <span className="section-no">COST CALCULATOR</span>
        <h3>{t("육성 비용 계산기")}</h3>
        <p>{t("오퍼레이터를 추가하면 정예화 1·2, 스킬 레벨 2~7, 스킬별 특화 1~3, 모듈별 1~3단계 비용이 전부 개별 행으로 나옵니다. 원하는 단계만 체크해 합산하세요. 재료 아이콘을 클릭하면 상세 정보가 열립니다.")}</p>
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
      </div>

      {picked.length === 0 ? (
        <p className="cost-empty">{t("아직 선택한 오퍼레이터가 없어요 — 위 검색창에서 추가해 보세요.")}</p>
      ) : (
        <>
          <div className="cost-ops">
            {picked.map((id) => {
              const operator = byId.get(id);
              const entry = costs.ops[id];
              if (!operator || !entry) return null;
              const rows = buildRows(operator, entry, t);
              const anyOff = rows.some((row) => excluded.has(`${id}/${row.key}`));
              // 같은 그룹(정예화/스킬/특화 스킬/모듈)의 첫 행에만 그룹 라벨을 표시
              let lastGroup = "";
              return (
                <article key={id} className="cost-op" style={{ "--accent": operator.accent } as React.CSSProperties}>
                  <header>
                    <img src={operator.image} alt="" />
                    <button type="button" className="cost-chip-name" onClick={() => onShowOperator(id)} title={t("{name} 상세 정보 열기", { name: operator.name })}>{operator.name}</button>
                    {operator.unreleased && <em className="future-badge">{t("미실장")}</em>}
                    <button type="button" className="cost-op-all" onClick={() => toggleAll(id, rows.map((row) => row.key))}>
                      {anyOff ? t("모두 선택") : t("모두 해제")}
                    </button>
                    <button type="button" className="cost-chip-remove" onClick={() => removeOp(id)} aria-label={t("{name} 제외", { name: operator.name })}>×</button>
                  </header>
                  <div className="cost-rows">
                    {rows.map((row) => {
                      const showGroup = row.group !== lastGroup;
                      lastGroup = row.group;
                      const off = excluded.has(`${id}/${row.key}`);
                      return (
                        <div key={row.key} className={`cost-row${showGroup ? " group-start" : ""}${off ? " off" : ""}`}>
                          <label className="cost-row-check">
                            <input type="checkbox" checked={!off} onChange={() => toggleRow(id, row.key)} aria-label={`${row.group} ${row.step}`} />
                          </label>
                          <span className="cost-row-group">{showGroup ? row.group : ""}</span>
                          <span className="cost-row-step">{row.step}</span>
                          <span className="cost-row-items">
                            {row.lmd > 0 && <ItemChip id="4001" count={row.lmd} onShowItem={onShowItem} locale={locale} />}
                            {row.items.map(([itemId, count]) => (
                              <ItemChip key={itemId} id={itemId} count={count} onShowItem={onShowItem} locale={locale} />
                            ))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="cost-result">
            <div className="cost-total-head">
              <b>{t("합계")}</b>
              <button type="button" className="cost-clear" onClick={() => { setPicked([]); setExcluded(new Set()); }}>{t("전체 비우기")}</button>
            </div>
            <div className="cost-lmd">
              <img src="/items/4001.png" alt="" />
              <div><span>{t("용문폐")}</span><b>{totals.lmd.toLocaleString()}</b></div>
            </div>
            <div className="cost-items">
              {totals.rows.map((row) => {
                const name = locText(locale, row.meta.name);
                return (
                  <button key={row.id} type="button" className="cost-item farmable" title={t("{name} 상세 정보 열기", { name })} onClick={() => onShowItem(row.id)}>
                    <span className="cost-item-icon" data-tier={row.meta.rarity}><img src={row.meta.image} alt="" loading="lazy" decoding="async" /><i>{row.count.toLocaleString()}</i></span>
                    <b>{name}</b>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// 분해 행의 재료 미니 칩 — 아이콘 + 개수, 클릭하면 재료 상세 모달
function ItemChip({ id, count, onShowItem, locale }: {
  id: string; count: number; onShowItem: (id: string) => void; locale: Locale;
}) {
  const meta = costs.items[id];
  if (!meta) return null;
  const name = locText(locale, meta.name);
  return (
    <button type="button" className="cost-mini farmable" title={`${name} ×${count.toLocaleString()}`} onClick={() => onShowItem(id)}>
      <img src={meta.image} alt={name} loading="lazy" decoding="async" />
      <i>{count.toLocaleString()}</i>
    </button>
  );
}

// ── 재료 상세 모달 ────────────────────────────────────────────────────────────
// 모든 재료 아이콘(효율표·계산기)에서 열린다. 설명·용도·가공소 조합식과, 파밍 가능한
// 재료라면 효율 상위 스테이지 + 효율표 검색 버튼을 함께 보여준다.
function ItemModal({ id, onClose, onShowItem, onSearchItem }: {
  id: string;
  onClose: () => void;
  onShowItem: (id: string) => void;
  onSearchItem: (name: string) => void;
}) {
  const { locale, t } = useI18n();
  const meta = costs.items[id];
  const farmItem = data.items.find((item) => item.id === id);
  if (!meta && !farmItem) return null;
  const name = meta ? locText(locale, meta.name) : locText(locale, farmItem!.name);
  const rarity = meta?.rarity ?? farmItem!.rarity;
  const image = meta?.image ?? farmItem!.image;
  return (
    <div className="modal-backdrop item-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="item-modal" role="dialog" aria-modal="true" aria-label={name}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("상세 정보 닫기")}>×</button>
        <header>
          <span className="item-modal-icon" data-tier={rarity}><img src={image} alt={name} /></span>
          <div>
            <h3>{name}</h3>
            <span className={`farm-tier tier-${rarity}`}>T{rarity}</span>
            {farmItem && <em className="item-farmable-badge">{t("파밍 가능")}</em>}
          </div>
        </header>
        {meta?.desc && <p className="item-desc">{locText(locale, meta.desc)}</p>}
        {meta?.usage && <p className="item-usage">{locText(locale, meta.usage)}</p>}
        {meta?.craft && (
          <div className="item-craft">
            <b>{t("가공소 조합식")}</b>
            <div className="item-craft-row">
              {meta.craft.map(([subId, count]) => {
                const sub = costs.items[subId];
                if (!sub) return null;
                return (
                  <button key={subId} type="button" className="cost-mini farmable" title={locText(locale, sub.name)} onClick={() => onShowItem(subId)}>
                    <img src={sub.image} alt={locText(locale, sub.name)} />
                    <i>{count}</i>
                  </button>
                );
              })}
              {(meta.craftGold ?? 0) > 0 && (
                <span className="cost-mini" title={t("용문폐")}>
                  <img src="/items/4001.png" alt={t("용문폐")} />
                  <i>{(meta.craftGold ?? 0).toLocaleString()}</i>
                </span>
              )}
            </div>
          </div>
        )}
        {farmItem && (
          <div className="item-stages">
            <b>{t("효율 스테이지")}</b>
            <ul>
              {farmItem.stages.slice(0, TOP_STAGES).map((stage, index) => (
                <li key={stage.id}>
                  <b className="farm-code">{stage.code}</b>
                  {index === 0 && <em className="best-badge">{t("최고 효율")}</em>}
                  <span>{stage.rate}%</span>
                  <span>{stage.sanity}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="cost-clear" onClick={() => onSearchItem(locText(locale, farmItem.name))}>{t("효율표에서 {name} 검색", { name })}</button>
          </div>
        )}
        {!farmItem && !meta?.craft && (
          <p className="item-usage">{t("상시 파밍 스테이지가 없는 재료예요 — 이벤트 보상·상점 교환 등으로 획득합니다.")}</p>
        )}
      </section>
    </div>
  );
}
