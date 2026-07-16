"use client";

// 재료 파밍 효율표 + 육성 비용 계산기 탭.
// 효율표 데이터는 scripts/build-farm.py가 생성하는 app/data/farm.json —
// 클뜯 item/stage_table(이름 3개 언어) + 펭귄 물류 실측 드랍률(KR 개방 스테이지만).
// 재료별 스테이지 목록은 "개당 기대 이성(이성 소모 ÷ 드랍률)" 오름차순으로 이미
// 정렬돼 있고, 첫 행이 이성 대비 획득 확률이 가장 높은 최고 효율 스테이지다.
// 화면에는 재료당 효율 상위 3개 스테이지만 표시한다 (2026-07 사용자 확정).
// 육성 비용 데이터는 scripts/build-costs.py가 생성하는 app/data/costs.json —
// 정예화 1·2, 스킬 2~7, 특화 1~3, 모듈 1~3단계의 용문폐·재료 소요량.
import { useEffect, useMemo, useRef, useState } from "react";
import farmData from "./data/farm.json";
import costsData from "./data/costs.json";
import type { Operator } from "./home";
import { useI18n, type Locale } from "./i18n";
import { normSearch } from "./search";

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
  levels?: { lmd: number; items: CostList; maxLv: number; exp: number }[];
  elite?: { lmd: number; items: CostList }[];
  skills?: CostList[];
  masteries?: { id: string; levels: CostList[] }[];
  modules?: { id: string; levels: { lmd: number; items: CostList }[] }[];
};
type CostItemMeta = {
  name: LocText; rarity: number; sortId: number; image: string;
  desc?: LocText; usage?: LocText; craft?: CostList; craftGold?: number;
  unreleased?: boolean;   // KR 미출시(중국 선행) 재료 — 미래시 데이터 포함 시에만 노출
};
type CostsData = {
  updated: string;
  items: Record<string, CostItemMeta>;
  ops: Record<string, CostEntry>;
};

const data = farmData as { updated: string; minTimes: number; items: FarmItem[] };
const costs = costsData as unknown as CostsData;

// 화면에 뿌릴 재료 통합 목록 — 효율표(파밍 가능) + costs 사전(칩·조합 T5 등 파밍 불가).
// 파밍 불가 재료도 정보는 봐야 하므로(2026-07 사용자 확정) stages 없이 카드로 노출한다.
type MaterialCard = { id: string; name: LocText; rarity: number; sortId: number; image: string; stages: FarmStage[]; farmable: boolean; unreleased: boolean };
const ALL_MATERIALS: MaterialCard[] = (() => {
  const map = new Map<string, MaterialCard>();
  for (const item of data.items) map.set(item.id, { ...item, farmable: true, unreleased: false });
  for (const [id, meta] of Object.entries(costs.items)) {
    if (map.has(id) || id === "4001") continue; // 용문폐는 재료 목록 제외
    map.set(id, { id, name: meta.name, rarity: meta.rarity, sortId: meta.sortId, image: meta.image, stages: [], farmable: false, unreleased: !!meta.unreleased });
  }
  return Array.from(map.values()).sort((a, b) => b.rarity - a.rarity || a.sortId - b.sortId);
})();

const TIERS = Array.from(new Set(ALL_MATERIALS.map((item) => item.rarity))).sort((a, b) => b - a);

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
    const keyword = normSearch(query);
    return ALL_MATERIALS
      // 상시 파밍 토글은 파밍 가능 재료의 스테이지만 거른다 (파밍 불가 재료는 스테이지가 없음)
      .map((item) => permOnly && item.farmable ? { ...item, stages: item.stages.filter((stage) => PERMANENT_KINDS.has(stage.kind)) } : item)
      // 상시 파밍 토글 시: 파밍 가능한데 상설 스테이지가 하나도 안 남은 재료만 숨긴다.
      // 파밍 불가 재료(칩·조합 T5 등)는 정보 표시용이라 토글과 무관하게 항상 노출.
      .filter((item) => item.farmable ? (permOnly ? item.stages.length > 0 : true) : true)
      // 미래시 데이터 미포함이면 KR 미출시 재료(중국 선행)는 숨긴다
      .filter((item) => includeFuture || !item.unreleased)
      .filter((item) =>
        (tiers.length === 0 || tiers.includes(item.rarity)) &&
        (!keyword ||
          normSearch([item.name.ko, item.name.en, item.name.ja].filter(Boolean).join(" ")).includes(keyword) ||
          (SEARCH_ALIASES[item.id] ?? []).some((alias) => normSearch(alias).includes(keyword))));
  }, [tiers, query, permOnly, includeFuture]);

  return (
    <section className="farm" aria-label={t("재료 파밍 & 오퍼 육성 시뮬레이션")}>
      <div className="farm-head">
        <span className="section-no">FARM &amp; UPGRADE</span>
        <h2>{t("재료 파밍 & 오퍼 육성 시뮬레이션")}</h2>
        <p>{t("오퍼레이터 육성에 필요한 용문폐·재료 총량을 단계별로 계산하고, 각 재료를 어느 스테이지에서 파밍하는 게 가장 효율적인지 실측 드랍 통계로 확인합니다.")}</p>
        {includeFuture && (
          <p className="farm-source">{t("미실장(중국 서버 선행) 오퍼레이터·재료의 텍스트는 비공식 AI 번역으로, 한국 서버 정식 출시 시 공식 번역과 다를 수 있습니다.")}</p>
        )}
      </div>

      <CostCalculator operators={operators} includeFuture={includeFuture} onShowOperator={onShowOperator} onShowItem={setShownItem} />

      <div className="farm-subhead">
        <span className="section-no">FARMING EFFICIENCY</span>
        <h3>{t("재료 파밍 효율표")}</h3>
        <p>{t("정예화 재료 {count}종의 실측 드랍 통계입니다. 재료마다 어느 스테이지에서 나오는지와 개당 기대 이성(이성 소모 ÷ 드랍률)을 표시하고, 이성 대비 획득 확률이 가장 높은 스테이지에 최고 효율 배지를 붙입니다.", { count: data.items.length })}</p>
        <p className="farm-source">{t("출처: 펭귄 물류 실측 통계(표본 {min}회 이상) + 클뜯 게임 데이터 · {date} 기준 한국 서버에 개방된 스테이지만 수록 · 기대 이성은 낮을수록 좋습니다.", { min: data.minTimes, date: data.updated })}</p>
      </div>

      <div className="farm-tools">
        <div className="filter-list farm-tier-filter" role="group" aria-label={t("등급 필터")}>
          {TIERS.map((tier) => (
            <button key={tier} type="button" className={tiers.includes(tier) ? "selected" : ""} aria-pressed={tiers.includes(tier)} onClick={() => toggleTier(tier)}>
              T{tier}<span>{ALL_MATERIALS.filter((item) => item.rarity === tier && (includeFuture || !item.unreleased)).length}</span>
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
          {visible.map((item) => {
            const meta = costs.items[item.id];
            const craftable = !item.farmable && (meta?.craft?.length ?? 0) > 0;
            return (
              <article key={item.id} className={`farm-card${item.farmable ? "" : " nonfarm"}`} style={{ "--tier": item.rarity } as React.CSSProperties}>
                <header>
                  <button type="button" className="farm-item-btn" onClick={() => setShownItem(item.id)} title={t("{name} 상세 정보 열기", { name: locText(locale, item.name) })}>
                    <img src={item.image} alt={locText(locale, item.name)} loading="lazy" decoding="async" />
                  </button>
                  <div>
                    <h3>{locText(locale, item.name)}</h3>
                    <span className={`farm-tier tier-${item.rarity}`}>T{item.rarity}</span>
                    {item.unreleased && <em className="future-badge">{t("미실장")}</em>}
                  </div>
                </header>
                {item.farmable ? (
                  <>
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
                  </>
                ) : (
                  <div className="farm-nonfarm-body">
                    <span className="farm-nonfarm-tag">{craftable ? t("가공소 조합") : t("파밍 불가")}</span>
                    {craftable && (
                      <span className="farm-nonfarm-craft">
                        {meta!.craft!.map(([subId, count]) => {
                          const sub = costs.items[subId];
                          if (!sub) return null;
                          // 조합 재료 아이콘은 각자 자기 상세를 연다 (예전엔 카드 전체가 버튼이라 재료를 눌러도 이 재료 상세가 떴음)
                          return (
                            <button key={subId} type="button" className="cost-mini farmable" title={t("{name} 상세 정보 열기", { name: locText(locale, sub.name) })} onClick={() => setShownItem(subId)}>
                              <img src={sub.image} alt={locText(locale, sub.name)} /><i>{count}</i>
                            </button>
                          );
                        })}
                      </span>
                    )}
                  </div>
                )}
              </article>
            );
          })}
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
// 1/2/3단계를 전부 개별 행으로 나열한다 (2026-07 사용자 확정: 뭉뚱그리지 말 것).
// 육성은 순차라 앞 단계가 전제조건이므로 개별 체크가 아니라 그룹마다 "목표 단계까지
// 누적 선택"한다 — 한 지점을 클릭하면 앞 단계가 자동 포함되고 왼쪽 레일이 슬라이더처럼
// 차오른다 (2026-07 사용자 확정). 합계는 각 그룹의 목표 단계까지만 합산.
function addCost(map: Map<string, number>, list: CostList) {
  for (const [id, count] of list) map.set(id, (map.get(id) ?? 0) + count);
}

// 한 오퍼의 비용을 그룹(정예화·스킬·스킬별 특화·모듈별)으로 나누고, 각 그룹은 순차 단계 행을 갖는다
type CostStep = { step: string; lmd: number; items: CostList };
type CostGroup = { key: string; label: string; steps: CostStep[] };

function buildGroups(operator: Operator, entry: CostEntry, t: (key: string, params?: Record<string, string | number>) => string): CostGroup[] {
  const groups: CostGroup[] = [];
  if (entry.levels?.length) {
    // 각 정예화 단계의 만렙까지 레벨업 (용문폐 + 고급작전기록 환산). step은 "E0 → Lv.50" 형태
    groups.push({ key: "lv", label: t("레벨업"), steps: entry.levels.map((phase, index) => ({ step: t("E{p}·{n}", { p: index, n: phase.maxLv }), lmd: phase.lmd, items: phase.items })) });
  }
  if (entry.elite?.length) {
    groups.push({ key: "e", label: t("정예화"), steps: entry.elite.map((phase, index) => ({ step: `${index + 1}`, lmd: phase.lmd, items: phase.items })) });
  }
  if (entry.skills?.length) {
    groups.push({ key: "s", label: t("스킬"), steps: entry.skills.map((items, index) => ({ step: `Lv.${index + 2}`, lmd: 0, items })) });
  }
  (entry.masteries ?? []).forEach((mastery, index) => {
    const skillName = operator.skills.find((skill) => skill.id === mastery.id)?.name ?? `S${index + 1}`;
    groups.push({ key: `m${index}`, label: `S${index + 1} · ${skillName}`, steps: mastery.levels.map((items, level) => ({ step: t("특화 {n}", { n: level + 1 }), lmd: 0, items })) });
  });
  (entry.modules ?? []).forEach((mod, index) => {
    const meta = operator.modules.find((candidate) => candidate.id === mod.id);
    const label = meta ? `${meta.type} · ${meta.name}` : `MODULE ${index + 1}`;
    groups.push({ key: `d${index}`, label, steps: mod.levels.map((level, stage) => ({ step: `STAGE ${stage + 1}`, lmd: level.lmd, items: level.items })) });
  });
  return groups;
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
  // 검색창 포커스 여부 — 입력이 없어도 포커스만 하면 전체 오퍼 목록을 펼쳐 보여준다.
  const [focused, setFocused] = useState(false);
  // 그룹별 목표 단계 — "opId/groupKey" → 포함할 앞쪽 단계 수. 없으면 전체(steps.length) 기본.
  const [targets, setTargets] = useState<Record<string, number>>({});

  const byId = useMemo(() => new Map(operators.map((operator) => [operator.id, operator])), [operators]);

  // 공유 링크 복원 — URL ?ops=char_2027_wang,... 를 읽어 계산기에 담는다 (마운트 1회).
  // 하이드레이션 불일치를 피해 초기값은 [] 로 두고 이펙트에서 복원한다.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("ops");
    if (!raw) return;
    const ids = raw.split(",").filter((id) => byId.has(id) && costs.ops[id]);
    if (ids.length) setPicked(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // picked → URL ?ops 동기화 (공유용). 첫 마운트의 [] 상태로 파라미터를 지우지 않도록 건너뛴다.
  const opsSynced = useRef(false);
  useEffect(() => {
    if (!opsSynced.current) { opsSynced.current = true; return; }
    const url = new URL(window.location.href);
    if (picked.length) url.searchParams.set("ops", picked.join(","));
    else url.searchParams.delete("ops");
    window.history.replaceState(null, "", url);
  }, [picked]);

  // 비용 데이터가 있는 오퍼만 (로봇 등 정예화·스킬 없는 유닛 제외) · 미래시 토글 반영
  const pool = useMemo(() =>
    operators.filter((operator) => costs.ops[operator.id] && (includeFuture || !operator.unreleased)),
    [operators, includeFuture]);
  const keyword = normSearch(draft);
  // 포커스만 해도 전체 목록(선택 안 된 오퍼)을 보여주고, 입력이 있으면 그 안에서 필터링한다.
  // operators는 성급 오름차순이라 그대로 자르면 저성급만 나온다 → 성급·출시순 내림차순으로 정렬.
  const candidates = pool
    .filter((operator) => !picked.includes(operator.id))
    .sort((a, b) => b.rarity - a.rarity || b.seq - a.seq);
  // 성급·출시순 정렬은 유지하되 개수 제한 없이 전 성급(1~6성)을 다 보여주고 목록은 스크롤한다.
  const matches = !focused
    ? []
    : keyword
        ? candidates.filter((operator) => normSearch([operator.name, operator.code, ...operator.aliases].join(" ")).includes(keyword))
        : candidates;

  const targetOf = (opId: string, group: CostGroup) => targets[`${opId}/${group.key}`] ?? group.steps.length;
  // 단계 pos(0-index)를 클릭 → 목표를 pos+1로(앞 단계 자동 포함). 이미 최상단이면 pos로 낮춰 해제.
  const clickStep = (opId: string, group: CostGroup, pos: number) =>
    setTargets((current) => {
      const key = `${opId}/${group.key}`;
      const now = current[key] ?? group.steps.length;
      return { ...current, [key]: now === pos + 1 ? pos : pos + 1 };
    });
  // 마우스로 레일을 잡고 끌면 포인터 아래 단계까지 목표를 맞춘다. 단순 클릭은 clickStep 토글을
  // 유지하고(0까지 낮추기 가능), 드래그가 일어난 경우 뒤따르는 click을 무시한다(draggedRef).
  const dragRef = useRef<{ opId: string; groupKey: string } | null>(null);
  const draggedRef = useRef(false);
  useEffect(() => {
    const end = () => { dragRef.current = null; };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => { window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
  }, []);
  const dragOver = (opId: string) => (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.opId !== opId) return;
    const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const ds = el?.closest<HTMLElement>(".cost-step-dot")?.dataset;
    if (!ds || ds.op !== opId || ds.gkey !== drag.groupKey || ds.pos === undefined) return;
    draggedRef.current = true;
    setTargets((current) => ({ ...current, [`${opId}/${drag.groupKey}`]: Number(ds.pos) + 1 }));
  };
  const setAllGroups = (opId: string, groups: CostGroup[], full: boolean) =>
    setTargets((current) => {
      const next = { ...current };
      for (const group of groups) next[`${opId}/${group.key}`] = full ? group.steps.length : 0;
      return next;
    });

  const totals = useMemo(() => {
    let lmd = 0;
    const map = new Map<string, number>();
    for (const id of picked) {
      const operator = byId.get(id);
      const entry = costs.ops[id];
      if (!operator || !entry) continue;
      for (const group of buildGroups(operator, entry, t)) {
        const target = targets[`${id}/${group.key}`] ?? group.steps.length;
        for (let pos = 0; pos < target; pos += 1) {
          lmd += group.steps[pos].lmd;
          addCost(map, group.steps[pos].items);
        }
      }
    }
    const rows = Array.from(map.entries())
      .map(([id, count]) => ({ id, count, meta: costs.items[id] }))
      .filter((row) => row.meta)
      .sort((a, b) => b.meta.rarity - a.meta.rarity || a.meta.sortId - b.meta.sortId);
    return { lmd, rows };
  }, [picked, targets, byId, t]);

  const searchRef = useRef<HTMLInputElement>(null);
  // 오퍼를 담으면 드롭다운을 닫는다 (선택 후에도 목록이 안 사라지던 문제). 다시 추가하려면
  // 검색창을 클릭(포커스)하면 목록이 다시 열린다.
  const addOp = (id: string) => {
    setPicked((current) => [...current, id]);
    setDraft("");
    setFocused(false);
    searchRef.current?.blur();
  };
  const removeOp = (id: string) =>
    setPicked((current) => current.filter((value) => value !== id));

  return (
    <div className="cost-calc">
      <div className="cost-calc-head">
        <span className="section-no">COST CALCULATOR</span>
        <h3>{t("육성 비용 계산기")}</h3>
        <p>{t("오퍼레이터를 추가하면 레벨업(용문폐·경험치), 정예화 1·2, 스킬 레벨 2~7, 스킬별 특화 1~3, 모듈별 1~3단계가 전부 개별 행으로 나옵니다. 각 그룹에서 목표 단계를 클릭하면 앞 단계가 자동 포함돼 합산됩니다. 경험치는 고급작전기록(2000 EXP) 환산 개수로 표시합니다. 재료 아이콘을 클릭하면 상세 정보가 열립니다.")}</p>
      </div>
      <div className="cost-tools">
        <div className="search-wrap cost-search">
          <span>⌕</span>
          <input
            ref={searchRef}
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setFocused(true); }}
            onFocus={() => setFocused(true)}
            // 목록 항목 클릭이 먼저 처리되도록 blur는 살짝 지연
            onBlur={() => window.setTimeout(() => setFocused(false), 150)}
            placeholder={t("클릭하면 전체 오퍼레이터 · 이름·별명 입력 시 필터")}
            aria-label={t("오퍼레이터 이름·별명 검색 후 추가")}
          />
          {matches.length > 0 && (
            <div className="cost-suggest" role="listbox">
              {matches.map((operator) => (
                <button key={operator.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => addOp(operator.id)}>
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
              const groups = buildGroups(operator, entry, t);
              const allFull = groups.every((group) => targetOf(id, group) === group.steps.length);
              return (
                <article key={id} className="cost-op" style={{ "--accent": operator.accent } as React.CSSProperties}>
                  <header>
                    <img src={operator.image} alt="" />
                    <button type="button" className="cost-chip-name" onClick={() => onShowOperator(id)} title={t("{name} 상세 정보 열기", { name: operator.name })}>{operator.name}</button>
                    {operator.unreleased && <em className="future-badge">{t("미실장")}</em>}
                    <button type="button" className="cost-op-all" onClick={() => setAllGroups(id, groups, !allFull)}>
                      {allFull ? t("모두 해제") : t("모두 선택")}
                    </button>
                    <button type="button" className="cost-chip-remove" onClick={() => removeOp(id)} aria-label={t("{name} 제외", { name: operator.name })}>×</button>
                  </header>
                  <div className="cost-rows" onPointerMove={dragOver(id)}>
                    {groups.map((group) => {
                      const target = targetOf(id, group);
                      return group.steps.map((row, pos) => {
                        const on = pos < target;
                        const first = pos === 0;
                        // 레일 모양: 켜진 구간은 이어지고, 목표 지점이 마지막 채워진 노드
                        const railClass = !on ? "rail-off" : pos + 1 === target ? "rail-head" : "rail-on";
                        return (
                          <div key={group.key + pos} className={`cost-row${first ? " group-start" : ""}${on ? "" : " off"}`}>
                            <button
                              type="button"
                              className={`cost-step-dot ${railClass}${first ? " first" : ""}${pos === group.steps.length - 1 ? " last" : ""}`}
                              data-op={id}
                              data-gkey={group.key}
                              data-pos={pos}
                              onPointerDown={() => { dragRef.current = { opId: id, groupKey: group.key }; draggedRef.current = false; }}
                              onClick={() => { if (draggedRef.current) { draggedRef.current = false; return; } clickStep(id, group, pos); }}
                              aria-pressed={on}
                              title={on ? t("{label} {step}까지 육성 (클릭 시 제외)", { label: group.label, step: row.step }) : t("{label} {step}까지 육성", { label: group.label, step: row.step })}
                            />
                            <span className="cost-row-group">{first ? group.label : ""}</span>
                            <span className="cost-row-step">{row.step}</span>
                            <span className="cost-row-items">
                              {row.lmd > 0 && <ItemChip id="4001" count={row.lmd} onShowItem={onShowItem} locale={locale} />}
                              {row.items.map(([itemId, count]) => (
                                <ItemChip key={itemId} id={itemId} count={count} onShowItem={onShowItem} locale={locale} />
                              ))}
                            </span>
                          </div>
                        );
                      });
                    })}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="cost-result">
            <div className="cost-total-head">
              <b>{t("합계")}</b>
              <div className="cost-total-actions">
                <ShareLinkButton />
                <button type="button" className="cost-clear" onClick={() => { setPicked([]); setTargets({}); }}>{t("전체 비우기")}</button>
              </div>
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

// 현재 URL(선택 상태 반영)을 클립보드에 복사 — "왕 육성 시뮬" 링크를 바로 공유
function ShareLinkButton() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* 클립보드 권한 없으면 무시 */ }
  };
  return (
    <button type="button" className="cost-share" onClick={copy}>
      <span aria-hidden>🔗</span> {copied ? t("복사됨!") : t("공유 링크 복사")}
    </button>
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
            {meta?.unreleased && <em className="future-badge">{t("미실장")}</em>}
          </div>
        </header>
        {meta?.unreleased && <p className="item-usage">{t("한국 서버 미실장 재료입니다 — 이름·설명은 비공식 AI 번역이라 정식 출시 시 공식 번역과 다를 수 있습니다.")}</p>}
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
