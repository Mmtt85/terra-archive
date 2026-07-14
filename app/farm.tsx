"use client";

// 재료 파밍 효율표 탭.
// 데이터는 scripts/build-farm.py가 생성하는 app/data/farm.json —
// 클뜯 item/stage_table(이름 3개 언어) + 펭귄 물류 실측 드랍률(KR 개방 스테이지만).
// 재료별 스테이지 목록은 "개당 기대 이성(이성 소모 ÷ 드랍률)" 오름차순으로 이미
// 정렬돼 있고, 첫 행이 이성 대비 획득 확률이 가장 높은 최고 효율 스테이지다.
import { useMemo, useState } from "react";
import farmData from "./data/farm.json";
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

const data = farmData as { updated: string; minTimes: number; items: FarmItem[] };

const TIERS = Array.from(new Set(data.items.map((item) => item.rarity))).sort((a, b) => b - a);

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

export default function FarmGuide() {
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
                {item.stages.map((stage, index) => (
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
