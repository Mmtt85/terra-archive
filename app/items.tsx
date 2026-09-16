"use client";

// 아이템 도감 목록 탭 (/items) — 게임 안 아이템 전량(1,423종)을 보는 화면.
//
// ## 왜 따로 있나 (사용자 확정 2026-09-16)
//
// 사이트의 다른 화면들은 아이템을 **계산 재료로만** 스쳐 간다 — 재료파밍은 드랍률,
// 육성 비용 계산기는 소요량, 오퍼 상세는 재료 칸. 셋을 합쳐도 95종뿐이고, 정작 게임이
// 아이템마다 달아 둔 **설명(플레이버)·용도·획득처**를 보여 주는 자리가 없었다.
// 이벤트 교환 재화는 이벤트가 끝나면 아예 다시 볼 길이 없다.
//
// 데이터(로케일당 ~630KB)는 **여기에만** 들어간다 — app/home.tsx가 이 모듈을 lazy()로
// 물기 때문에 첫 화면 번들에 실리지 않는다. 로케일 데이터는 app/items-{ko,en,ja}.tsx
// 래퍼가 각자 자기 것만 정적 임포트해 넘긴다 (적 도감과 같은 관례).
//
// ⚠ 이 탭에는 **개별 라우트(/items/<id>)를 만들지 않는다.** 두 가지 이유가 겹친다:
//   ① 항목 1개당 6파일(html+rsc × 3언어) → 1,423종이면 8,500파일이고 Pages 한도가
//      20,000개다 (PROJECT-GUIDE 파일 수 예산).
//   ② `public/items/`가 이미 **에셋 폴더**라 scripts/deploy.sh가 `rm -rf $STAGE/items`로
//      통째로 지운다. 지금은 목록이 `items.html` 한 파일이라 무사하지만, 하위 라우트를
//      만들면 그게 `items/` 아래로 떨어져 **매 배포마다 사라진다** (2026-08-08 rogue 사고와
//      똑같은 함정). 상세는 모달 + `#it-<id>` 딥링크로 둔다.

import { useMemo, useState } from "react";
import { asset } from "./assets";
import { useI18n } from "./i18n";
import { normSearch, useSearchInput } from "./search";
import { useLazyVisible } from "./lazy-img";
import { ModalWindow } from "./modal-window";
import { useHashSync } from "./hash-modal";
import { AttributeFilter } from "./attr-filter";
import { SearchSuggest } from "./search-suggest";
import { loadEnemyStats, loadStages } from "./dex-cross";
import { StageFile } from "./stage-detail";
import { viewOf, type StageView } from "./stage-data";

export type DexItem = {
  id: string;
  n: string;                  // 이름
  r: number;                  // 등급 TIER_n
  g: ItemGroup;
  s: number;                  // sortId — 게임 창고 정렬 순서
  i?: string;                 // 아이콘 파일명(iconId). 없으면 CDN에 그림이 없는 것
  d?: string;                 // 설명(플레이버)
  u?: string;                 // 용도
  o?: string;                 // 획득처 한 줄
  ev?: string;                // 이벤트 재화면 그 이벤트 **스토리 id** (읽을거리가 있을 때만)
  evName?: string;            // 그 이벤트 이름 — 스토리 페이지가 없어도 붙는다
  farm?: number;              // 재료파밍 도우미에 효율표가 있다
  b?: "MANUFACTURE" | "WORKSHOP";
  drop?: [string, string, number, number][];  // 작전id, 코드, occ, kind
  dropMore?: number;          // 잘라낸 나머지 작전 수
};
export type ItemDoc = { updated: string; occ: string[]; kinds: string[]; items: DexItem[] };
export type ItemGroup = "material" | "event" | "resource" | "voucher" | "etc";

// 분류 표시 순서 — 사람이 찾는 빈도 순 (재료 → 이벤트 재화 → 자원 → 교환권 → 기타)
const GROUPS: ItemGroup[] = ["material", "event", "resource", "voucher", "etc"];
const GROUP_LABEL: Record<ItemGroup, string> = {
  material: "재료",
  event: "이벤트 재화",
  resource: "기초 자원",
  voucher: "교환권·모집권",
  etc: "소장품·기타",
};
// 획득 경로 필터 — 데이터의 파생값이라 아이템에 필드를 더 두지 않고 여기서 판정한다
const SOURCES = ["drop", "build", "event", "farm"] as const;
const SOURCE_LABEL: Record<string, string> = {
  drop: "작전 드랍", build: "제조·가공", event: "이벤트 한정", farm: "효율표 있음",
};
const hasSource = (item: DexItem, key: string) =>
  key === "drop" ? !!item.drop : key === "build" ? !!item.b
    : key === "event" ? item.g === "event" : !!item.farm;

const ROOM_LABEL: Record<string, string> = { MANUFACTURE: "제조소에서 생산", WORKSHOP: "가공소에서 가공" };

// 로케일 프리픽스 — app/story.tsx의 storyPath와 같은 규칙이지만 **거기서 가져오지 않는다**
// (story.tsx를 임포트하면 요약·리더기 모듈이 통째로 이 청크에 딸려 온다).
const localeBase = (locale: string) => (locale === "ko" ? "" : `/${locale}`);
const storyHref = (locale: string, id: string) => `${localeBase(locale)}/stories/${id}`;

export const itemIcon = (icon: string) => asset(`/items/icon/${icon}.webp`);

function ItemCard({ item, onSelect }: { item: DexItem; onSelect: (i: DexItem) => void }) {
  // 1,400장이 진입 즉시 전부 요청되지 않도록 화면 근처에 올 때만 <img>를 붙인다
  const [ref, visible] = useLazyVisible<HTMLDivElement>();
  return (
    <button type="button" className="it-card" onClick={() => onSelect(item)}>
      <span className="it-card-face" ref={ref} data-tier={item.r}>
        {visible && item.i && (
          <img src={itemIcon(item.i)} alt="" aria-hidden width={64} height={64} loading="lazy" decoding="async"
            onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
        )}
      </span>
      <b className="it-card-name">{item.n}</b>
      <span className={`farm-tier tier-${item.r}`}>T{item.r}</span>
    </button>
  );
}

/** 아이템 상세 — 설명·용도·획득처 + 드랍 작전. 재료파밍 효율표가 있으면 그쪽으로 보낸다. */
function ItemFile({ item, doc, onOpenStage }: {
  item: DexItem; doc: ItemDoc; onOpenStage: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <>
      <header>
        <span className="item-modal-icon" data-tier={item.r}>
          {item.i && <img src={itemIcon(item.i)} alt={item.n} width={183} height={183} />}
        </span>
        <div>
          <h3>{item.n}</h3>
          <span className={`farm-tier tier-${item.r}`}>T{item.r}</span>
          <em className="it-group-badge">{t(GROUP_LABEL[item.g])}</em>
        </div>
      </header>
      {item.d && <p className="item-desc">{item.d}</p>}
      {item.u && <p className="item-usage">{item.u}</p>}
      {(item.o || item.b || item.evName || item.farm) && (
        <div className="item-craft">
          <b>{t("획득 방법")}</b>
          {/* 어느 이벤트 재화인지 — 스토리 페이지가 없는 이벤트(미니게임·보스러시)도 많아서
              이름은 항상 글로 보여주고, 링크는 아래 it-links 에서 있을 때만 건다. */}
          {item.evName && (
            <p className="it-obtain it-event">{t("이벤트")} <b>「{item.evName}」</b></p>
          )}
          {item.o && <p className="it-obtain">{item.o}</p>}
          {item.b && <p className="it-obtain">{t(ROOM_LABEL[item.b])}</p>}
          <div className="it-links">
            {item.ev && (
              <a className="it-link" href={storyHref(locale, item.ev)}>{t("이 이벤트 스토리 보기")}</a>
            )}
            {/* 효율표는 재료파밍 도우미의 #item-<id> 딥링크가 정본이다 (2026-07-27) */}
            {item.farm ? (
              <a className="it-link" href={`${localeBase(locale)}/farm#item-${item.id}`}>
                {t("재료파밍 효율표에서 보기")}
              </a>
            ) : null}
          </div>
        </div>
      )}
      {item.drop && item.drop.length > 0 && (
        <div className="item-stages">
          <b>{t("드랍 작전")}</b>
          <ul className="it-drops">
            {item.drop.map(([sid, code, occ, kind]) => (
              <li key={`${sid}-${kind}`}>
                <button type="button" className="farm-code as-btn" onClick={() => onOpenStage(sid)}>{code}</button>
                <span className="it-drop-kind">{doc.kinds[kind] ?? ""}</span>
                <span className="it-drop-occ">{doc.occ[occ] ?? ""}</span>
              </li>
            ))}
          </ul>
          {item.dropMore ? <p className="it-drop-more">{t("그 밖에 {n}개 작전에서도 나옵니다.", { n: item.dropMore })}</p> : null}
        </div>
      )}
      {!item.d && !item.u && !item.o && !item.drop && (
        <p className="item-usage">{t("게임이 설명을 붙이지 않은 아이템이에요.")}</p>
      )}
    </>
  );
}

export default function ItemDex({ doc }: { doc: ItemDoc }) {
  const { locale, t } = useI18n();
  const { term, clear, inputProps } = useSearchInput();
  const [groups, setGroups] = useState<string[]>([]);
  const [tiers, setTiers] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [open, setOpen] = useState<DexItem | null>(null);
  // 작전 상세 — 아이템 모달을 그대로 둔 채 위에 하나 더 띄운다 (적 도감과 같은 규약).
  // ⚠ 해시 동기화는 하지 않는다 (주 모달 #it-<id>와 서로 덮어써 창이 닫힌다).
  const [subStage, setSubStage] = useState<StageView | null>(null);
  const [stageRaise, setStageRaise] = useState(0);

  const items = doc.items;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const openStage = (sid: string) => {
    setStageRaise((k) => k + 1);
    void Promise.all([loadStages(locale), loadEnemyStats()]).then(([d, stats]) => {
      const st = d.stages.find((x) => x.id === sid);
      setSubStage(st ? viewOf(d, st, stats) : null);
    });
  };

  // 딥링크 #it-<id> — 오퍼(#op-)·적(#en-)과 같은 관례. 재료파밍의 #item-<id>와는 다른
  // 접두사다 (그쪽은 95종짜리 재료 모달이고 여기는 전량 도감이라 같은 창이 아니다).
  useHashSync(open ? `#it-${open.id}` : null, (hash) => {
    const m = /^#it-(.+)$/.exec(hash);
    setOpen(m ? byId.get(m[1]) ?? null : null);
  });

  const tierOpts = useMemo(
    () => [...new Set(items.map((i) => String(i.r)))].sort((a, b) => Number(b) - Number(a)), [items]);

  const shown = useMemo(() => {
    const q = normSearch(term);
    return items.filter((i) => {
      if (groups.length && !groups.includes(i.g)) return false;
      if (tiers.length && !tiers.includes(String(i.r))) return false;
      if (sources.length && !sources.every((s) => hasSource(i, s))) return false;
      if (!q) return true;
      // 이벤트 이름으로도 걸린다 — "공상의 정원" 을 치면 그 이벤트 재화가 나온다
      return normSearch(`${i.n} ${i.evName ?? ""} ${i.d ?? ""} ${i.u ?? ""} ${i.o ?? ""}`).includes(q);
    });
  }, [items, term, groups, tiers, sources]);

  const countBy = useMemo(() => {
    const g = new Map<string, number>(), r = new Map<string, number>(), s = new Map<string, number>();
    for (const i of items) {
      g.set(i.g, (g.get(i.g) ?? 0) + 1);
      r.set(String(i.r), (r.get(String(i.r)) ?? 0) + 1);
      for (const key of SOURCES) if (hasSource(i, key)) s.set(key, (s.get(key) ?? 0) + 1);
    }
    return { g, r, s };
  }, [items]);

  const toggle = (set: (fn: (cur: string[]) => string[]) => void) => (v: string) =>
    set((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  const reset = () => { setGroups([]); setTiers([]); setSources([]); clear(false); };
  const active = groups.length + tiers.length + sources.length > 0 || !!term;

  return (
    <section className="explorer it-explorer" aria-labelledby="item-title">
      <div className="filter-panel">
        <div className="panel-heading">
          <div><span className="section-no">FILTER / 01</span><h2 id="item-title">{t("탐색 조건")}</h2></div>
          <button className="reset" onClick={reset}>↻ {t("초기화")}</button>
        </div>
        <AttributeFilter groups={[
          { title: t("분류"), items: GROUPS, selected: groups, onToggle: toggle(setGroups),
            labelFor: (v) => t(GROUP_LABEL[v as ItemGroup] ?? v), countForItem: (v) => countBy.g.get(v) ?? 0 },
          { title: t("등급"), items: tierOpts, selected: tiers, onToggle: toggle(setTiers),
            labelFor: (v) => `T${v}`, countForItem: (v) => countBy.r.get(v) ?? 0 },
          { title: t("획득 방법"), items: [...SOURCES], selected: sources, onToggle: toggle(setSources),
            labelFor: (v) => t(SOURCE_LABEL[v] ?? v), countForItem: (v) => countBy.s.get(v) ?? 0 },
        ]} />
      </div>

      <div className="results">
        <div className="results-heading">
          <div><span className="section-no">RESULT / 02</span><h2>{active ? t("탐색 결과") : t("전체 아이템")}</h2></div>
          <div className="search-wrap heading-search">
            <span>⌕</span>
            <input id="item-search" {...inputProps} placeholder={t("이름, 이벤트, 설명, 용도 검색")} />
            <button type="button" className="search-clear" onClick={() => clear()} aria-label={t("검색어 지우기")}>×</button>
            <SearchSuggest query={term}
              items={shown.map((i) => ({ key: i.id, label: i.n, sub: i.evName ?? t(GROUP_LABEL[i.g]), img: i.i ? itemIcon(i.i) : undefined }))}
              onPick={(id) => { const i = byId.get(id); if (i) setOpen(i); }} />
          </div>
          <div className="results-tools"><span className="count"><b>{shown.length}</b> ITEMS</span></div>
        </div>
        <div className="active-filters">
          {groups.map((v) => <button key={`g-${v}`} onClick={() => toggle(setGroups)(v)}>{t(GROUP_LABEL[v as ItemGroup] ?? v)} ×</button>)}
          {tiers.map((v) => <button key={`t-${v}`} onClick={() => toggle(setTiers)(v)}>T{v} ×</button>)}
          {sources.map((v) => <button key={`s-${v}`} onClick={() => toggle(setSources)(v)}>{t(SOURCE_LABEL[v] ?? v)} ×</button>)}
          {term && <button onClick={() => clear()}>“{term}” ×</button>}
        </div>

        <div className="results-scroll">
          {shown.length > 0 ? (
            <div className="it-grid">
              {shown.map((i) => <ItemCard key={i.id} item={i} onSelect={setOpen} />)}
            </div>
          ) : (
            <div className="empty"><span>NO MATCH</span><h3>{t("조건에 맞는 아이템이 없어요.")}</h3>
              <button onClick={reset}><span className="btn-icon" aria-hidden>↻</span>{t("전체 보기")}</button></div>
          )}
        </div>
      </div>

      {open && (
        <ModalWindow label={open.n} className="item-modal it-modal" onClose={() => setOpen(null)}>
          <ItemFile item={open} doc={doc} onOpenStage={openStage} />
        </ModalWindow>
      )}
      {subStage && (
        <ModalWindow key={stageRaise} label={`${subStage.stage.code} ${subStage.stage.name}`}
          className="operator-modal st-modal" onClose={() => setSubStage(null)}>
          <StageFile view={subStage} onOpenItem={(id) => { const i = byId.get(id); if (i) setOpen(i); }} />
        </ModalWindow>
      )}
    </section>
  );
}
