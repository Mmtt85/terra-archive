"use client";

// 적 도감 목록 탭 (/enemies) — 오퍼 백과사전의 적 버전.
//
// 데이터(로케일당 ~1MB)는 **여기에만** 들어간다. app/home.tsx가 이 모듈을 lazy()로 물기
// 때문에 그 무게가 첫 화면 번들에 실리지 않는다. 상세 표현부는 데이터가 없는
// app/enemy-detail.tsx에 따로 있다 — 그쪽 주석에 이유가 적혀 있다(프리렌더).
//
// 로케일 데이터는 app/enemies-{ko,en,ja}.tsx 래퍼가 각자 자기 것만 정적 임포트해 넘긴다
// (app/home-{ko,en,ja}.tsx와 같은 관례) — 세 로케일 JSON이 한 청크에 묶이지 않게.

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
// 재료 상세는 재료파밍 도우미의 것을 그대로 쓴다 (작전 모달의 드랍에서 열린다)
const ItemModal = lazy(() => import("./farm").then((m) => ({ default: m.ItemModal })));
import {
  EnemyFile, RANK_KEY, enemyImg, enemyImgBase, enemyPath,
  type Enemy, type EnemyStages,
} from "./enemy-detail";

const RANKS = ["NORMAL", "ELITE", "BOSS"];

/** 등장 작전 색인은 모달을 열 때 처음 필요해진다 — 로케일별 지연 로드(로케일당 ~230KB) */
const STAGE_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  ko: () => import("./data/enemy-stages.json"),
  en: () => import("./data/enemy-stages.en.json"),
  ja: () => import("./data/enemy-stages.ja.json"),
};
const stageCache = new Map<string, EnemyStages>();

function useStagesDoc(locale: string, want: boolean): EnemyStages | null {
  // 캐시를 **렌더 중에 읽는다** — 이펙트 안에서 동기 setState를 하면 연쇄 렌더가 난다
  // (react-hooks/set-state-in-effect). 비동기 도착 때만 리렌더를 깨운다.
  const [, bump] = useState(0);
  useEffect(() => {
    if (!want || stageCache.has(locale)) return;
    let live = true;
    (STAGE_LOADERS[locale] ?? STAGE_LOADERS.ko)().then((m) => {
      stageCache.set(locale, ((m as { default?: unknown }).default ?? m) as EnemyStages);
      if (live) bump((n) => n + 1);
    }).catch(() => { /* 색인이 없어도 도감 자체는 보여야 한다 */ });
    return () => { live = false; };
  }, [locale, want]);
  return stageCache.get(locale) ?? null;
}

function EnemyCard({ enemy, onSelect }: { enemy: Enemy; onSelect: (e: Enemy) => void }) {
  const { locale, t } = useI18n();
  // 1,514장이 진입 즉시 전부 요청되지 않도록 화면 근처에 올 때만 <img>를 붙인다
  // (오퍼 카드와 같은 방식 — app/lazy-img.tsx)
  const [ref, visible] = useLazyVisible<HTMLDivElement>();
  const base = enemy.id.replace(/_\d+$/, "");
  const top = enemy.lv[0];
  return (
    <a className="en-card" href={enemyPath(locale, enemy.id)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault(); onSelect(enemy);
      }}>
      <div className="en-card-face" ref={ref}>
        {visible && (
          <img src={enemyImg(enemy.id)} alt="" aria-hidden width={96} height={96} loading="lazy" decoding="async"
            onError={(e) => {
              const el = e.currentTarget;
              if (base !== enemy.id && !el.dataset.fb) { el.dataset.fb = "1"; el.src = enemyImgBase(enemy.id); }
              else el.style.visibility = "hidden";
            }} />
        )}
      </div>
      <div className="en-card-body">
        <span className="en-card-code">{enemy.idx ?? "—"}</span>
        <b className="en-card-name">{enemy.name}</b>
        <span className="en-card-meta">
          {enemy.rank && <em className={`en-rank r-${enemy.rank.toLowerCase()}`}>{t(RANK_KEY[enemy.rank] ?? enemy.rank)}</em>}
          {enemy.race[0] && <span>{enemy.race[0]}</span>}
        </span>
        {/* 스탯은 두 줄로 나눈다 — 한 줄에 넷을 넣으면 카드 폭에서 "ATK 1…"로 잘린다
            (2026-08-09 실측). 값이 잘린 숫자는 없는 것만 못하다. */}
        {top && (
          <span className="en-card-stat">
            <span>HP {top.hp} · ATK {top.atk}</span>
            <span>DEF {top.def} · RES {top.res}%</span>
          </span>
        )}
      </div>
    </a>
  );
}

export default function EnemyDex({ enemies }: { enemies: Enemy[] }) {
  const { locale, t } = useI18n();
  const { term, clear, inputProps } = useSearchInput();
  const [ranks, setRanks] = useState<string[]>([]);
  const [races, setRaces] = useState<string[]>([]);
  const [ways, setWays] = useState<string[]>([]);
  const [motions, setMotions] = useState<string[]>([]);
  const [dmgs, setDmgs] = useState<string[]>([]);
  const [imms, setImms] = useState<string[]>([]);
  const [open, setOpen] = useState<Enemy | null>(null);
  // 겹쳐 뜨는 부가 모달 — 적 모달을 그대로 둔 채 위에 하나 더 띄운다 (페이지 이동 X).
  // ⚠ 해시 동기화는 하지 않는다 (주 모달 #en-<id>와 서로 덮어써 창이 닫힌다).
  const [subStage, setSubStage] = useState<StageView | null>(null);
  const [subItem, setSubItem] = useState<string | null>(null);
  // 다시 지목한 창은 앞으로 (사용자 요청 2026-08-09) — key 재마운트로 z를 새로 받는다
  const [stageRaise, setStageRaise] = useState(0);
  const [itemRaise, setItemRaise] = useState(0);

  const byId = useMemo(() => new Map(enemies.map((e) => [e.id, e])), [enemies]);
  const openStage = (sid: string) => {
    setStageRaise((k) => k + 1);
    // 스탯 색인을 같이 받아야 등장 적 카드에 HP·공격 수치가 실린다 (사용자 제보 2026-08-11)
    void Promise.all([loadStages(locale), loadEnemyStats()]).then(([doc, stats]) => {
      const st = doc.stages.find((x) => x.id === sid);
      setSubStage(st ? viewOf(doc, st, stats) : null);
    });
  };
  const openItem = (id: string) => { setSubItem(id); setItemRaise((k) => k + 1); };
  const stagesDoc = useStagesDoc(locale, open !== null);

  // 딥링크 #en-<id> — 오퍼 모달(#op-<id>)과 같은 관례
  useHashSync(open ? `#en-${open.id}` : null, (hash) => {
    const m = /^#en-(.+)$/.exec(hash);
    setOpen(m ? byId.get(m[1]) ?? null : null);
  });
  // 필터 값 목록 — 데이터에 실제로 있는 것만 (없는 종족을 만들어 내지 않는다)
  const opts = useMemo(() => {
    const uniq = (get: (e: Enemy) => (string | null | undefined)[]) => {
      const s = new Set<string>();
      for (const e of enemies) for (const v of get(e)) if (v) s.add(v);
      return [...s].sort((a, b) => a.localeCompare(b, locale));
    };
    return {
      race: uniq((e) => e.race),
      way: uniq((e) => [e.way]),
      motion: uniq((e) => [e.motion]),
      dmg: uniq((e) => e.dmg),
      imm: uniq((e) => e.lv.flatMap((l) => l.imm)),
    };
  }, [enemies, locale]);

  const immOf = (e: Enemy) => e.lv.find((l) => l.imm.length)?.imm ?? [];

  const shown = useMemo(() => {
    const q = normSearch(term);
    return enemies.filter((e) => {
      if (ranks.length && !ranks.includes(e.rank ?? "")) return false;
      if (races.length && !races.some((r) => e.race.includes(r))) return false;
      if (ways.length && !ways.includes(e.way ?? "")) return false;
      if (motions.length && !motions.includes(e.motion ?? "")) return false;
      if (dmgs.length && !dmgs.some((d) => e.dmg.includes(d))) return false;
      if (imms.length) { const im = immOf(e); if (!imms.every((x) => im.includes(x))) return false; }
      if (!q) return true;
      return normSearch(`${e.name} ${e.idx ?? ""} ${e.abil.join(" ")} ${e.desc ?? ""}`).includes(q);
    });
  }, [enemies, term, ranks, races, ways, motions, dmgs, imms]);

  // 칩 개수는 **다른 필터가 적용된 뒤**의 수가 아니라 전체 기준 — 오퍼 백과사전과 같은 방식
  const countBy = useMemo(() => {
    const mk = (get: (e: Enemy) => string[]) => {
      const m = new Map<string, number>();
      for (const e of enemies) for (const v of new Set(get(e))) m.set(v, (m.get(v) ?? 0) + 1);
      return m;
    };
    return {
      rank: mk((e) => (e.rank ? [e.rank] : [])),
      race: mk((e) => e.race),
      way: mk((e) => (e.way ? [e.way] : [])),
      motion: mk((e) => (e.motion ? [e.motion] : [])),
      dmg: mk((e) => e.dmg),
      imm: mk(immOf),
    };
  }, [enemies]);

  const toggle = (set: (fn: (cur: string[]) => string[]) => void) => (v: string) =>
    set((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  const reset = () => {
    setRanks([]); setRaces([]); setWays([]); setMotions([]); setDmgs([]); setImms([]); clear(false);
  };
  const active = ranks.length + races.length + ways.length + motions.length + dmgs.length + imms.length > 0 || !!term;

  return (
    <section className="explorer en-explorer" aria-labelledby="enemy-title">
      <div className="filter-panel">
        <div className="panel-heading">
          <div><span className="section-no">FILTER / 01</span><h2 id="enemy-title">{t("탐색 조건")}</h2></div>
          <button className="reset" onClick={reset}>↻ {t("초기화")}</button>
        </div>
        <AttributeFilter groups={[
          { title: t("적 등급"), items: RANKS, selected: ranks, onToggle: toggle(setRanks),
            labelFor: (v) => t(RANK_KEY[v] ?? v), countForItem: (v) => countBy.rank.get(v) ?? 0 },
          { title: t("종족"), items: opts.race, selected: races, onToggle: toggle(setRaces),
            countForItem: (v) => countBy.race.get(v) ?? 0 },
          { title: t("공격 방식"), items: opts.way, selected: ways, onToggle: toggle(setWays),
            countForItem: (v) => countBy.way.get(v) ?? 0 },
          { title: t("이동 방식"), items: opts.motion, selected: motions, onToggle: toggle(setMotions),
            countForItem: (v) => countBy.motion.get(v) ?? 0 },
          { title: t("피해 유형"), items: opts.dmg, selected: dmgs, onToggle: toggle(setDmgs),
            countForItem: (v) => countBy.dmg.get(v) ?? 0 },
          { title: t("상태이상 면역"), items: opts.imm, selected: imms, onToggle: toggle(setImms),
            countForItem: (v) => countBy.imm.get(v) ?? 0 },
        ]} />
      </div>

      <div className="results">
        <div className="results-heading">
          <div><span className="section-no">RESULT / 02</span><h2>{active ? t("탐색 결과") : t("전체 적")}</h2></div>
          <div className="search-wrap heading-search">
            <span>⌕</span>
            <input id="enemy-search" {...inputProps} placeholder={t("이름, 도감번호, 능력 검색")} />
            <button type="button" className="search-clear" onClick={() => clear()} aria-label={t("검색어 지우기")}>×</button>
            {/* 검색란 제안 — 고르면 그 적 상세가 바로 열린다 (사용자 확정 2026-08-10) */}
            <SearchSuggest query={term}
              items={shown.map((e) => ({ key: e.id, label: e.name, sub: e.idx ?? undefined, img: enemyImg(e.id) }))}
              onPick={(id) => { const e = byId.get(id); if (e) setOpen(e); }} />
          </div>
          <div className="results-tools"><span className="count"><b>{shown.length}</b> ENEMIES</span></div>
        </div>
        <div className="active-filters">
          {ranks.map((v) => <button key={`k-${v}`} onClick={() => toggle(setRanks)(v)}>{t(RANK_KEY[v] ?? v)} ×</button>)}
          {races.map((v) => <button key={`r-${v}`} onClick={() => toggle(setRaces)(v)}>{v} ×</button>)}
          {ways.map((v) => <button key={`w-${v}`} onClick={() => toggle(setWays)(v)}>{v} ×</button>)}
          {motions.map((v) => <button key={`m-${v}`} onClick={() => toggle(setMotions)(v)}>{v} ×</button>)}
          {dmgs.map((v) => <button key={`d-${v}`} onClick={() => toggle(setDmgs)(v)}>{v} ×</button>)}
          {imms.map((v) => <button key={`i-${v}`} onClick={() => toggle(setImms)(v)}>{v} ×</button>)}
          {term && <button onClick={() => clear()}>“{term}” ×</button>}
        </div>

        <div className="results-scroll">
          {shown.length > 0 ? (
            <div className="en-grid">
              {shown.map((e) => <EnemyCard key={e.id} enemy={e} onSelect={setOpen} />)}
            </div>
          ) : (
            <div className="empty"><span>NO MATCH</span><h3>{t("조건에 맞는 적이 없어요.")}</h3>
              <button onClick={reset}><span className="btn-icon" aria-hidden>↻</span>{t("전체 보기")}</button></div>
          )}
        </div>
      </div>

      {open && (
        <ModalWindow label={open.name} className="operator-modal en-modal" onClose={() => setOpen(null)}>
          <EnemyFile enemy={open} stagesDoc={stagesDoc}
            nameOf={(id) => byId.get(id)?.name}
            onOpenEnemy={(id) => { const e = byId.get(id); if (e) setOpen(e); }}
            onOpenStage={openStage} />
        </ModalWindow>
      )}

      {/* 작전 상세 — 적 모달 위에 겹친다 (ModalWindow가 zTop으로 앞뒤를 정한다) */}
      {subStage && (
        <ModalWindow key={stageRaise} label={`${subStage.stage.code} ${subStage.stage.name}`} className="operator-modal st-modal"
          onClose={() => setSubStage(null)}>
          <StageFile view={subStage}
            onOpenEnemy={(id) => { const e = byId.get(id); if (e) { setSubStage(null); setOpen(e); } }}
            onOpenItem={openItem} />
        </ModalWindow>
      )}
      {subItem && (
        <Suspense fallback={null}>
          <ItemModal key={itemRaise} id={subItem} onClose={() => setSubItem(null)} onShowItem={openItem}
            onShowStage={openStage} />
        </Suspense>
      )}
    </section>
  );
}
