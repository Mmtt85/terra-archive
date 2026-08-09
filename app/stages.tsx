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

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "./i18n";
import { normSearch, useSearchInput } from "./search";
import { useLazyVisible } from "./lazy-img";
import { ModalWindow } from "./modal-window";
import { useHashSync } from "./hash-modal";
import { AttributeFilter } from "./attr-filter";
import {
  StageFile, stageMap, stagePath, viewOf, type Stage, type StageDoc,
} from "./stage-detail";

function StageCard({ stage, zone, typeName, onSelect }: {
  stage: Stage; zone: string; typeName: string; onSelect: (s: Stage) => void;
}) {
  const { locale, t } = useI18n();
  // 2,327장짜리 그리드 — 화면 근처에 올 때만 도면을 붙인다 (오퍼·적 카드와 같은 방식)
  const [ref, visible] = useLazyVisible<HTMLDivElement>();
  return (
    <a className="st-card" href={stagePath(locale, stage.id)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault(); onSelect(stage);
      }}>
      <div className="st-card-map" ref={ref}>
        {visible && stage.map ? (
          <img src={stageMap(stage.id)} alt="" aria-hidden loading="lazy" decoding="async" />
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

export default function StageDex({ doc, onOpenEnemy }: { doc: StageDoc; onOpenEnemy?: (id: string) => void }) {
  const { locale, t } = useI18n();
  const { term, clear, inputProps } = useSearchInput();
  const [types, setTypes] = useState<string[]>([]);
  const [zonesSel, setZonesSel] = useState<string[]>([]);
  const [open, setOpen] = useState<Stage | null>(null);

  const byId = useMemo(() => new Map(doc.stages.map((s) => [s.id, s])), [doc]);

  // 딥링크 #st-<id> — 오퍼(#op-)·적(#en-)과 같은 관례
  useHashSync(open ? `#st-${open.id}` : null, (hash) => {
    const m = /^#st-(.+)$/.exec(hash);
    setOpen(m ? byId.get(m[1]) ?? null : null);
  });

  // 필터 값 — 데이터에 실제로 있는 것만
  const typeItems = useMemo(
    () => [...new Set(doc.stages.map((s) => s.t))].sort((a, b) => (doc.types[a] ?? a).localeCompare(doc.types[b] ?? b, locale)),
    [doc, locale]);
  const zoneItems = useMemo(
    () => [...new Set(doc.stages.map((s) => doc.zones[s.z]))].filter(Boolean).sort((a, b) => a.localeCompare(b, locale)),
    [doc, locale]);

  const countBy = useMemo(() => {
    const type = new Map<string, number>(), zone = new Map<string, number>();
    for (const s of doc.stages) {
      type.set(s.t, (type.get(s.t) ?? 0) + 1);
      const z = doc.zones[s.z];
      if (z) zone.set(z, (zone.get(z) ?? 0) + 1);
    }
    return { type, zone };
  }, [doc]);

  const shown = useMemo(() => {
    const q = normSearch(term);
    return doc.stages.filter((s) => {
      if (types.length && !types.includes(s.t)) return false;
      if (zonesSel.length && !zonesSel.includes(doc.zones[s.z])) return false;
      if (!q) return true;
      return normSearch(`${s.code} ${s.name} ${doc.zones[s.z] ?? ""} ${s.desc ?? ""}`).includes(q);
    });
  }, [doc, term, types, zonesSel]);

  const toggle = (set: (fn: (cur: string[]) => string[]) => void) => (v: string) =>
    set((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  const reset = () => { setTypes([]); setZonesSel([]); clear(false); };
  const active = types.length + zonesSel.length > 0 || !!term;

  const view = open ? viewOf(doc, open) : null;

  return (
    <section className="explorer st-explorer" aria-labelledby="stage-title">
      <div className="filter-panel">
        <div className="panel-heading">
          <div><span className="section-no">FILTER / 01</span><h2 id="stage-title">{t("탐색 조건")}</h2></div>
          <button className="reset" onClick={reset}>↻ {t("초기화")}</button>
        </div>
        <AttributeFilter groups={[
          { title: t("작전 계열"), items: typeItems, selected: types, onToggle: toggle(setTypes),
            labelFor: (v) => doc.types[v] ?? v, countForItem: (v) => countBy.type.get(v) ?? 0 },
          { title: t("구역"), items: zoneItems, selected: zonesSel, onToggle: toggle(setZonesSel),
            countForItem: (v) => countBy.zone.get(v) ?? 0 },
        ]} />
      </div>

      <div className="results">
        <div className="results-heading">
          <div><span className="section-no">RESULT / 02</span><h2>{active ? t("탐색 결과") : t("전체 작전")}</h2></div>
          <div className="search-wrap heading-search">
            <span>⌕</span>
            <input id="stage-search" {...inputProps} placeholder={t("작전 코드, 이름, 구역 검색")} />
            <button type="button" className="search-clear" onClick={() => clear()} aria-label={t("검색어 지우기")}>×</button>
          </div>
          <div className="results-tools"><span className="count"><b>{shown.length}</b> STAGES</span></div>
        </div>
        <div className="active-filters">
          {types.map((v) => <button key={`t-${v}`} onClick={() => toggle(setTypes)(v)}>{doc.types[v] ?? v} ×</button>)}
          {zonesSel.map((v) => <button key={`z-${v}`} onClick={() => toggle(setZonesSel)(v)}>{v} ×</button>)}
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
        <ModalWindow label={`${view.stage.code} ${view.stage.name}`} className="operator-modal st-modal"
          onClose={() => setOpen(null)}>
          <StageFile view={view} onOpenEnemy={onOpenEnemy} />
        </ModalWindow>
      )}
    </section>
  );
}
