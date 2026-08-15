"use client";

// 작전 도감 목록 탭 (/stages) — 지형 도면 중심의 스테이지 브라우저.
//
// 데이터(로케일당 ~1.6MB)는 여기에만 들어간다. home.tsx가 lazy()로 물기 때문에
// 첫 화면 번들에 실리지 않는다. 표현부는 데이터 없는 app/stage-detail.tsx에 따로 있다
// (프리렌더 때문 — app/enemy-detail.tsx 머리주석 참조).
//
// ⚠ 라우트는 /stages(복수), 도면 폴더는 public/stage/(단수)다. 적 도감과 같은 규약으로
//   일부러 갈랐다 — deploy.sh가 `rm -rf $STAGE/stage`로 자산만 떼어낸다.
//   (그리고 스토리 탭의 URL 세그먼트도 "stories"라 서로 부딪히지 않는다.)

import { lazy, Suspense, useMemo, useState } from "react";
import { useI18n } from "./i18n";
import { normSearch, useSearchInput } from "./search";
import { useLazyVisible } from "./lazy-img";
import { ModalWindow } from "./modal-window";
import { useHashSync } from "./hash-modal";
import { AttributeFilter } from "./attr-filter";
import { SearchSuggest } from "./search-suggest";
import { loadEnemies } from "./dex-cross";
import { EnemyFile, type Enemy } from "./enemy-detail";
// 재료 상세는 재료파밍 도우미의 것을 그대로 쓴다 — 설명·용도·조합식·효율 상위 스테이지까지
// 이미 다 들어 있다. 드랍을 누를 때만 그 청크를 받는다.
const ItemModal = lazy(() => import("./farm").then((m) => ({ default: m.ItemModal })));
import {
  StageFile, stageMap, stagePath, viewOf, type Stage, type StageDoc,
} from "./stage-detail";
import { rogueHrefOf } from "./dex-paths";
// 적 칩 코어 스탯 (~67KB) — 이 파일은 lazy 청크라 메인 번들엔 안 실린다
import enemyStats from "./data/enemy-stats.json";
import type { EnemyStatsIndex } from "./stage-data";

function StageCard({ stage, zone, typeName, onSelect }: {
  stage: Stage; zone: string; typeName: string; onSelect: (s: Stage) => void;
}) {
  const { locale, t } = useI18n();
  // 2,327장짜리 그리드 — 화면 근처에 올 때만 도면을 붙인다 (오퍼·적 카드와 같은 방식)
  const [ref, visible] = useLazyVisible<HTMLDivElement>();
  // 통합전략 작전은 파일 수 한도 때문에 /stages/<id> 개별 페이지가 없다
  // (scripts/build-stages-rogue.py 머리주석). 보조 클릭이 404로 가지 않도록 그 테마의
  // 정본 주소로 보낸다 — 왼쪽 클릭은 아래 preventDefault로 도감 모달을 연다.
  const href = stage.rg ? rogueHrefOf(locale, stage.id) : stagePath(locale, stage.id);
  return (
    <a className="st-card" href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault(); onSelect(stage);
      }}>
      <div className="st-card-map" ref={ref}>
        {visible && stage.map ? (
          <img src={stageMap(stage.id, !!stage.rg)} alt="" aria-hidden loading="lazy" decoding="async" />
        ) : visible ? <span className="st-card-nomap" aria-hidden>—</span> : null}
      </div>
      <div className="st-card-body">
        <span className="st-card-code">{stage.code}</span>
        <b className="st-card-name">{stage.name}</b>
        <span className="st-card-meta">
          <span>{zone || typeName}</span>
          {stage.ap ? <em>{t("이성 {n}", { n: String(stage.ap) })}</em> : null}
        </span>
      </div>
    </a>
  );
}

// ⚠ onOpenEnemy(탭 이동)는 더 이상 쓰지 않는다 — 적은 **모달로 겹쳐** 띄운다
//   (사용자 요청 2026-08-09). prop을 지우면 로케일 래퍼 3개가 같이 바뀌어야 해서 남겨 뒀다.
export default function StageDex({ doc }: { doc: StageDoc; onOpenEnemy?: (id: string) => void }) {
  const { locale, t } = useI18n();
  const { term, clear, inputProps } = useSearchInput();
  const [types, setTypes] = useState<string[]>([]);
  const [evSel, setEvSel] = useState<string[]>([]);
  const [zonesSel, setZonesSel] = useState<string[]>([]);
  const [open, setOpen] = useState<Stage | null>(null);
  // 겹쳐 뜨는 부가 모달 — 목록·작전 모달을 그대로 둔 채 위에 하나 더 띄운다.
  // ⚠ 해시 동기화는 하지 않는다 (주 모달 #st-<id>와 서로 덮어써 창이 닫힌다).
  const [subEnemy, setSubEnemy] = useState<Enemy | null>(null);
  const [subItem, setSubItem] = useState<string | null>(null);
  // 이미 열려 있는 창을 다시 지목하면 앞으로 끌어올린다 (사용자 요청 2026-08-09) —
  // ModalWindow는 마운트 때 z를 받으므로 key를 갈아 재마운트한다.
  const [enemyRaise, setEnemyRaise] = useState(0);
  const [itemRaise, setItemRaise] = useState(0);
  const [mainRaise, setMainRaise] = useState(0);

  const byId = useMemo(() => new Map(doc.stages.map((s) => [s.id, s])), [doc]);

  // 딥링크 #st-<id> — 오퍼(#op-)·적(#en-)과 같은 관례
  useHashSync(open ? `#st-${open.id}` : null, (hash) => {
    const m = /^#st-(.+)$/.exec(hash);
    setOpen(m ? byId.get(m[1]) ?? null : null);
  });

  // ── 필터는 **누를수록 하위가 생긴다** (사용자 요청 2026-08-09) ──────────────
  // 계열 → (이벤트) → 구역. 처음엔 계열 하나만 보이고, 고른 계열에 하위 갈래가 실제로
  // 있을 때만 다음 칸이 나타난다. 오퍼 백과사전의 직군 → 세부 직군과 같은 결이다.
  // 계열을 안 고르면 이벤트 84개·구역 178개가 통째로 펼쳐져 목록이 쓸모없이 길다.
  const byName = (a: string, b: string) => a.localeCompare(b, locale);

  const typeItems = useMemo(
    () => [...new Set(doc.stages.map((s) => s.t))].sort((a, b) => byName(doc.types[a] ?? a, doc.types[b] ?? b)),
    [doc, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  // 고른 계열의 작전들 — 아래 두 필터의 모집단이다
  const pool = useMemo(
    () => (types.length ? doc.stages.filter((s) => types.includes(s.t)) : []),
    [doc, types]);

  // 이벤트: 이름 오름차순 (사용자 요청 — "이름으로 위에서부터 정렬")
  const eventItems = useMemo(() => {
    const set = new Set<string>();
    for (const s of pool) if (s.ev !== undefined) set.add(doc.events[s.ev]);
    return [...set].filter(Boolean).sort(byName);
  }, [doc, pool, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const events = useMemo(() => evSel.filter((e) => eventItems.includes(e)), [evSel, eventItems]);

  // 구역: 이벤트를 골랐으면 그 이벤트 안에서만.
  // ⚠ 여기만 **이름순이 아니라 진행 순서**다. 이름순이면 "에피소드 1 · 10 · 11 · 12 · 2"로
  //   섞이고 프롤로그가 맨 뒤로 밀린다. 데이터는 이미 계열·코드 자연순으로 정렬돼 있어
  //   (build-stages.py) 처음 나온 순서를 그대로 쓰면 프롤로그 → 에피소드 1 → 2 → …가 된다.
  const zoneItems = useMemo(() => {
    const src = events.length ? pool.filter((s) => s.ev !== undefined && events.includes(doc.events[s.ev])) : pool;
    const out: string[] = [];
    for (const s of src) {
      const z = doc.zones[s.z];
      if (z && !out.includes(z)) out.push(z);
    }
    return out;
  }, [doc, pool, events]);
  // 상위 선택이 바뀌면 이전 하위 선택은 **렌더에서 걸러 쓴다** — 이펙트로 상태를 털면
  // 연쇄 렌더가 나고(react-hooks/set-state-in-effect) 한 프레임 동안 "결과 0건인데 이유가
  // 화면에 없는" 상태가 스친다.
  const zones = useMemo(() => zonesSel.filter((z) => zoneItems.includes(z)), [zonesSel, zoneItems]);

  const countBy = useMemo(() => {
    const type = new Map<string, number>(), ev = new Map<string, number>(), zone = new Map<string, number>();
    for (const s of doc.stages) type.set(s.t, (type.get(s.t) ?? 0) + 1);
    // 하위 개수는 **상위 선택 안에서** 센다 — 잠금과 같은 기준이어야 숫자가 말이 된다
    for (const s of pool) if (s.ev !== undefined) ev.set(doc.events[s.ev], (ev.get(doc.events[s.ev]) ?? 0) + 1);
    const src = events.length ? pool.filter((s) => s.ev !== undefined && events.includes(doc.events[s.ev])) : pool;
    for (const s of src) {
      const z = doc.zones[s.z];
      if (z) zone.set(z, (zone.get(z) ?? 0) + 1);
    }
    return { type, ev, zone };
  }, [doc, pool, events]);

  // 같은 단계에서는 **하나만** 고른다 (사용자 요청 2026-08-09). 계열 → 이벤트 → 구역이
  // 한 갈래씩 좁혀 가는 구조라, 여러 개를 겹쳐 고르면 하위 목록이 무엇의 하위인지 흐려진다.
  // 다시 누르면 해제 = 그 단계로 되돌아간다.
  const pickOne = (set: (fn: (cur: string[]) => string[]) => void) => (v: string) =>
    set((cur) => (cur.includes(v) ? [] : [v]));

  // 갈래가 하나뿐이면 그 칸은 아예 만들지 않는다 — 보안 파견·섬멸 작전은 구역이 1개라
  // 계열만 골라도 이미 전부 나온다 (사용자 지적: "카테고리 2 필요없을테고").
  const filterGroups = [
    { title: t("작전 계열"), items: typeItems, selected: types, onToggle: pickOne(setTypes), single: true,
      labelFor: (v: string) => doc.types[v] ?? v, countForItem: (v: string) => countBy.type.get(v) ?? 0 },
    ...(eventItems.length > 1 ? [{
      title: t("이벤트"), items: eventItems, selected: events, onToggle: pickOne(setEvSel), single: true,
      countForItem: (v: string) => countBy.ev.get(v) ?? 0,
    }] : []),
    // 이벤트가 있는 계열은 **이벤트를 고른 뒤에야** 구역이 나온다 — 안 그러면 이벤트
    // 84개와 구역 156개가 동시에 펼쳐져 "점점 좁혀 간다"는 흐름이 깨진다.
    ...(zoneItems.length > 1 && (eventItems.length <= 1 || events.length > 0) ? [{
      title: t("구역"), items: zoneItems, selected: zones, onToggle: pickOne(setZonesSel), single: true,
      countForItem: (v: string) => countBy.zone.get(v) ?? 0,
    }] : []),
  ];

  const shown = useMemo(() => {
    const q = normSearch(term);
    return doc.stages.filter((s) => {
      // 고난 판은 별도 행을 만들지 않는다 — 일반판 상세의 환경 탭이 대신 보여준다
      // (사용자 확정 2026-08-10). 딥링크(#st-tough_*)는 byId로 여전히 열린다.
      if (s.sub) return false;
      if (types.length && !types.includes(s.t)) return false;
      if (events.length && (s.ev === undefined || !events.includes(doc.events[s.ev]))) return false;
      if (zones.length && !zones.includes(doc.zones[s.z])) return false;
      if (!q) return true;
      // 이벤트·테마 이름도 검색어에 넣는다 — 통합전략은 코드가 ISW-NO처럼 짧고 반복돼
      // 테마명("미즈키")으로 찾는 게 자연스럽다. 기존 이벤트 작전도 같은 이득을 본다.
      return normSearch(`${s.code} ${s.name} ${s.ev !== undefined ? doc.events[s.ev] ?? "" : ""} ${doc.zones[s.z] ?? ""} ${s.desc ?? ""}`).includes(q);
    });
  }, [doc, term, types, events, zones]);

  const reset = () => { setTypes([]); setEvSel([]); setZonesSel([]); clear(false); };
  const active = types.length + events.length + zones.length > 0 || !!term;

  const view = open ? viewOf(doc, open, enemyStats as EnemyStatsIndex) : null;
  const openEnemy = (id: string) => {
    setEnemyRaise((k) => k + 1);
    void loadEnemies(locale).then((m) => setSubEnemy(m.get(id) ?? null));
  };
  const openItem = (id: string) => { setSubItem(id); setItemRaise((k) => k + 1); };

  return (
    <section className="explorer st-explorer" aria-labelledby="stage-title">
      <div className="filter-panel">
        <div className="panel-heading">
          <div><span className="section-no">FILTER / 01</span><h2 id="stage-title">{t("탐색 조건")}</h2></div>
          <button className="reset" onClick={reset}>↻ {t("초기화")}</button>
        </div>
        <AttributeFilter groups={filterGroups} />
      </div>

      <div className="results">
        <div className="results-heading">
          <div><span className="section-no">RESULT / 02</span><h2>{active ? t("탐색 결과") : t("전체 작전")}</h2></div>
          <div className="search-wrap heading-search">
            <span>⌕</span>
            <input id="stage-search" {...inputProps} placeholder={t("작전 코드, 이름, 구역 검색")} />
            <button type="button" className="search-clear" onClick={() => clear()} aria-label={t("검색어 지우기")}>×</button>
            {/* 검색란 제안 — 고르면 그 작전 상세가 바로 열린다 (사용자 확정 2026-08-10) */}
            <SearchSuggest query={term}
              items={shown.map((s) => ({ key: s.id, label: `${s.code} ${s.name}`.trim(), sub: doc.zones[s.z] ?? undefined, img: s.map ? stageMap(s.id, !!s.rg) : undefined }))}
              onPick={(id) => { const st = byId.get(id); if (st) setOpen(st); }} />
          </div>
          <div className="results-tools"><span className="count"><b>{shown.length}</b> STAGES</span></div>
        </div>
        <div className="active-filters">
          {types.map((v) => <button key={`t-${v}`} onClick={() => pickOne(setTypes)(v)}>{doc.types[v] ?? v} ×</button>)}
          {events.map((v) => <button key={`e-${v}`} onClick={() => pickOne(setEvSel)(v)}>{v} ×</button>)}
          {zones.map((v) => <button key={`z-${v}`} onClick={() => pickOne(setZonesSel)(v)}>{v} ×</button>)}
          {term && <button onClick={() => clear()}>“{term}” ×</button>}
        </div>

        <div className="results-scroll">
          {shown.length > 0 ? (
            <div className="st-grid">
              {shown.map((s) => (
                <StageCard key={s.id} stage={s} zone={doc.zones[s.z]} typeName={doc.types[s.t] ?? s.t} onSelect={setOpen} />
              ))}
            </div>
          ) : (
            <div className="empty"><span>NO MATCH</span><h3>{t("조건에 맞는 작전이 없어요.")}</h3>
              <button onClick={reset}><span className="btn-icon" aria-hidden>↻</span>{t("전체 보기")}</button></div>
          )}
        </div>
      </div>

      {view && (
        <ModalWindow key={mainRaise} label={`${view.stage.code} ${view.stage.name}`} className="operator-modal st-modal"
          onClose={() => setOpen(null)}>
          {/* key: 다른 작전으로 갈아탈 때 환경 탭 상태를 초기화한다 */}
          <StageFile key={view.stage.id} view={view} onOpenEnemy={openEnemy} onOpenItem={openItem} />
        </ModalWindow>
      )}

      {/* 적 상세 — 작전 모달 위에 겹친다 (ModalWindow가 zTop으로 앞뒤를 정한다) */}
      {subEnemy && (
        <ModalWindow key={enemyRaise} label={subEnemy.name} className="operator-modal en-modal" onClose={() => setSubEnemy(null)}>
          <EnemyFile enemy={subEnemy} stagesDoc={null} onOpenEnemy={openEnemy} />
        </ModalWindow>
      )}
      {subItem && (
        <Suspense fallback={null}>
          {/* 재료 모달의 '효율 스테이지'를 누르면 그 작전을 주 모달에 띄우고 앞으로 끌어올린다 */}
          <ItemModal key={itemRaise} id={subItem} onClose={() => setSubItem(null)} onShowItem={openItem}
            onShowStage={(sid) => {
              const st = doc.stages.find((x) => x.id === sid);
              if (st) { setOpen(st); setMainRaise((k) => k + 1); }
            }} />
        </Suspense>
      )}
    </section>
  );
}
