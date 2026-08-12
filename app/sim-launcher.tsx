"use client";

// 작전 시뮬레이터 런처(/sim) — 사용자 확정 2026-08-10 "B안으로 가자".
//
// **작전 리스트를 복제하지 않는다**: 시뮬레이트 기능의 정본은 작전 도감 상세의
// '이동 경로' 탭이고, 이 화면은 검색창 + 추천 몇 개짜리 얇은 런처다 (같은 리스트를
// 두 군데 두는 안은 반려됨). "명일방주 시뮬레이터" 검색 유입을 노리는 SEO 표적
// 페이지이기도 하다 — 그래서 home.tsx가 **정적 임포트**로 물고(프리렌더 필수),
// 1.4MB 작전 데이터는 화면에 들어왔을 때만 지연 로드한다 (stages 탭과 같은 성능 규칙).
//
// 카드 클릭 = **상세 모달**(작전 도감과 같은 창)에 이동 경로 탭 + 시뮬 자동 재생 —
// 페이지가 넘어가면 안 된다 (사용자 지시 2026-08-10). href(/stages/<id>?sim=1)는
// 크롤러·새 탭·보조클릭용 딥링크로 남긴다.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { normSearch, useSearchInput } from "./search";
import { SearchSuggest } from "./search-suggest";
import { stageMap, stagePath } from "./dex-paths";
import { StageFile } from "./stage-detail";
import { viewOf, type EnemyStatsIndex, type Stage, type StageDoc } from "./stage-data";
import { ModalWindow } from "./modal-window";
import { useHashSync } from "./hash-modal";
import { loadEnemies } from "./dex-cross";
import { EnemyFile, type Enemy } from "./enemy-detail";

// 재료 상세는 재료파밍 도우미의 모달을 그대로 (stages 탭과 같은 지연 청크)
const ItemModal = lazy(() => import("./farm").then((m) => ({ default: m.ItemModal })));

// 모듈 캐시 — 탭을 들락거려도 다시 받지 않는다
const DOCS: Partial<Record<string, StageDoc>> = {};
let SIM_SET: Set<string> | null = null;
let STATS: EnemyStatsIndex | null = null;

/** 검색 결과·추천 카드 — 작전 도감 카드(.st-card)와 같은 겉모습. 클릭은 상세 모달,
 *  href는 ?sim=1 딥링크(새 탭·크롤러용). 경로 데이터가 없는 작전은 그 사실을 카드에
 *  적고 시뮬 없이 여는 게 낫다 — 눌러 보고 아는 것보다. */
function SimCard({ stage, zone, canSim, onSelect }: {
  stage: Stage; zone: string; canSim: boolean; onSelect: (s: Stage) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <a className={`st-card sim-card${canSim ? "" : " nosim"}`}
      href={stagePath(locale, stage.id) + (canSim ? "?sim=1" : "")}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault(); onSelect(stage);
      }}>
      <div className="st-card-map">
        {stage.map ? (
          <img src={stageMap(stage.id)} alt="" aria-hidden loading="lazy" decoding="async" />
        ) : <span className="st-card-nomap" aria-hidden>—</span>}
        {canSim && <span className="sim-card-play" aria-hidden>▶</span>}
      </div>
      <div className="st-card-body">
        <span className="st-card-code">{stage.code}</span>
        <b className="st-card-name">{stage.name}</b>
        <span className="st-card-meta">
          <span>{zone}</span>
          {!canSim && <em>{t("경로 데이터 없음")}</em>}
        </span>
      </div>
    </a>
  );
}

export default function SimLauncher() {
  const { locale, t } = useI18n();
  const [, bump] = useState(0);
  useEffect(() => {
    const jobs: Promise<unknown>[] = [];
    if (!DOCS[locale]) {
      // 동적 import는 경로가 정적이어야 코드 스플릿된다 — 로케일별로 분기해 자기 것만 받는다
      const load = locale === "en" ? import("./data/stages.en.json")
        : locale === "ja" ? import("./data/stages.ja.json")
        : import("./data/stages.json");
      jobs.push(load.then((m) => { DOCS[locale] = (m as { default?: unknown }).default as StageDoc ?? (m as unknown as StageDoc); }));
    }
    if (!SIM_SET) {
      jobs.push(import("./data/sim-stages.json").then((m) => {
        SIM_SET = new Set(((m as { default?: unknown }).default ?? m) as string[]);
      }));
    }
    if (!STATS) {
      // 모달의 등장 적 스탯(70KB) — 작전 도감 모달과 같은 수치를 내려면 필요하다
      jobs.push(import("./data/enemy-stats.json").then((m) => {
        STATS = ((m as { default?: unknown }).default ?? m) as EnemyStatsIndex;
      }));
    }
    if (jobs.length) void Promise.all(jobs).then(() => bump((k) => k + 1)).catch(() => {});
  }, [locale]);
  const doc = DOCS[locale];
  const sims = SIM_SET;

  // 입력 중엔 결과를 갈아끼우지 않는다 — **검색 버튼(또는 Enter)을 눌러야** 결과 그리드가
  // 뜬다 (사용자 지시 2026-08-10 "입력 다 끝나고 검색 버튼 눌러야"). 드롭다운 제안은
  // 같은 날 요청대로 입력을 따라 라이브로 남긴다 (한 작전으로 바로 점프하는 용도).
  const { term, clear, inputRef, inputProps } = useSearchInput();
  const [committed, setCommitted] = useState("");
  const doSearch = () => setCommitted(inputRef.current?.value ?? "");
  const q = normSearch(committed);

  // ── 상세 모달 스택 — 작전 도감(stages.tsx)과 같은 짜임 (주 모달 + 적·재료 겹침) ──
  const [open, setOpen] = useState<Stage | null>(null);
  const [subEnemy, setSubEnemy] = useState<Enemy | null>(null);
  const [subItem, setSubItem] = useState<string | null>(null);
  const [enemyRaise, setEnemyRaise] = useState(0);
  const [itemRaise, setItemRaise] = useState(0);
  const [mainRaise, setMainRaise] = useState(0);
  const byId = useMemo(() => new Map((doc?.stages ?? []).map((s) => [s.id, s])), [doc]);
  // 딥링크 #st-<id> — 작전 도감과 같은 관례 (뒤로가기 = 모달 닫힘)
  useHashSync(open ? `#st-${open.id}` : null, (hash) => {
    const m = /^#st-(.+)$/.exec(hash);
    setOpen(m ? byId.get(m[1]) ?? null : null);
  });
  // ⚠ 딥링크로 들어오면 useHashSync의 첫 적용이 **데이터 로드 전**에 돈다 — byId가 비어 있어
  //   모달이 안 열린다 (사용자 제보 2026-08-12 "#st-camp_r_14가 새로고침 때 안 뜸").
  //   stages.json이 도착한 뒤 한 번 더 해시를 읽는다.
  const deepDone = useRef(false);
  useEffect(() => {
    if (deepDone.current || !doc) return;
    deepDone.current = true;
    const m = /^#st-(.+)$/.exec(decodeURIComponent(window.location.hash));
    const s = m ? byId.get(m[1]) : null;
    if (s) queueMicrotask(() => setOpen(s));   // 이펙트 안 동기 setState 금지 (lint 규칙)
  }, [doc, byId]);
  const view = open && doc ? viewOf(doc, open, STATS ?? undefined) : null;
  const openEnemy = (id: string) => {
    setEnemyRaise((k) => k + 1);
    void loadEnemies(locale).then((m) => setSubEnemy(m.get(id) ?? null));
  };
  const openItem = (id: string) => { setSubItem(id); setItemRaise((k) => k + 1); };

  // 검색 — 코드·이름·구역. 숨은 판(sub)은 목록·검색 어디에도 안 낸다 (도감과 동일)
  const searchStages = (d: StageDoc | undefined, query: string) => {
    if (!d || !query) return [];
    const out: Stage[] = [];
    for (const s of d.stages) {
      if (s.sub !== undefined) continue;
      if (normSearch(s.code).includes(query) || normSearch(s.name).includes(query)
        || normSearch(d.zones[s.z] ?? "").includes(query)) {
        out.push(s);
        if (out.length >= 18) break;
      }
    }
    return out;
  };
  // 결과 그리드는 확정 검색어(committed)만 따른다 — 드롭다운 제안만 입력(term)을 따라간다
  const results = useMemo(() => searchStages(doc, q), [doc, q]);  // eslint-disable-line react-hooks/exhaustive-deps
  const live = useMemo(() => searchStages(doc, normSearch(term)), [doc, term]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 추천 — 최신 이벤트 · 메인 스토리 최신 챕터 · 섬멸작전. 시뮬 가능한 것만 담는다.
  // stages 배열은 KR 출시순(도메인 규칙)이라 "마지막 = 최신"이 성립한다.
  // 카드에 보이는 글자(code+name)가 같은 변형은 마지막 것 하나만 — 띠에 똑같은 카드가
  // 여럿 보였다 (위수 협의: code="표준 모드"에 name="AC-2"인 행이 여럿). 코드만으로 접으면
  // 반대로 다양성이 사라지므로 **보이는 짝**으로 접는다.
  const recs = useMemo(() => {
    if (!doc || !sims) return null;
    const vis = doc.stages.filter((s) => s.sub === undefined && sims.has(s.id));
    const byCode = (list: Stage[]) => {
      const m = new Map<string, Stage>();
      for (const s of list) m.set(`${s.code}|${s.name}`, s);
      return [...m.values()].slice(-6);
    };
    const evLast = [...vis].reverse().find((s) => s.ev !== undefined);
    const mainLast = [...vis].reverse().find((s) => s.t === "MAIN");
    return {
      event: evLast ? { name: doc.events[evLast.ev ?? 0] ?? "", list: byCode(vis.filter((s) => s.ev === evLast.ev)) } : null,
      main: mainLast ? { name: doc.zones[mainLast.z] ?? "", list: byCode(vis.filter((s) => s.z === mainLast.z)) } : null,
      camp: byCode(vis.filter((s) => s.t === "CAMPAIGN")),
    };
  }, [doc, sims]);

  const zoneOf = (s: Stage) => doc?.zones[s.z] || doc?.types[s.t] || "";
  const canSim = (s: Stage) => !!sims?.has(s.id);
  const grid = (list: Stage[]) => (
    <div className="sim-grid">
      {list.map((s) => <SimCard key={s.id} stage={s} zone={zoneOf(s)} canSim={canSim(s)} onSelect={setOpen} />)}
    </div>
  );

  return (
    <section className="sim-launch" aria-labelledby="sim-title">
      <header className="sim-head">
        <span className="section-no">STAGE SIMULATOR</span>
        <h2 id="sim-title">{t("작전 시뮬레이터")}</h2>
      </header>
      {/* 이 소개 문단은 프리렌더되는 SEO 본문이다 — 데이터 로드와 무관하게 정적으로 그린다 */}
      <p className="sim-intro">{t("작전을 고르면 적이 몇 초에 어디서 나와 어떤 경로로 어디에 들어가는지, 스폰 타임라인을 재생해 보여줍니다. 배속·구간 이동으로 흐름을 훑고, 선이나 말을 누르면 적별 경로를 확인할 수 있습니다.")}</p>
      <p className="sim-note">{t("저지 없이 두었을 때의 기준 타임라인입니다.")} {t("처치 수 등 조건 분기 증원은 재생에 포함되지 않습니다.")} {t("통합전략 가이드의 전투 노드에서도 '이동 경로' 탭으로 같은 시뮬레이션을 재생할 수 있습니다.")}</p>

      <div className="sim-search-row">
        <div className="search-wrap heading-search sim-search">
          <span>⌕</span>
          <input id="sim-search" {...inputProps} placeholder={t("작전 코드, 이름, 구역 검색")}
            autoComplete="off" spellCheck={false}
            onKeyDown={(event) => {
              // 한글 IME 조합 중 Enter(조합 확정)는 검색으로 치지 않는다
              if (event.key === "Enter" && !event.nativeEvent.isComposing) doSearch();
            }} />
          <button type="button" className="search-clear"
            onClick={() => { clear(); setCommitted(""); }} aria-label={t("검색어 지우기")}>×</button>
          {/* 검색란 제안 — 다른 검색란과 같은 드롭다운, 고르면 상세 모달 (사용자 지시 2026-08-10) */}
          <SearchSuggest query={term}
            items={live.map((s) => ({ key: s.id, label: `${s.code} ${s.name}`.trim(), sub: zoneOf(s) || undefined, img: s.map ? stageMap(s.id) : undefined }))}
            onPick={(id) => { const st = byId.get(id); if (st) setOpen(st); }} />
        </div>
        {/* 결과는 입력 즉시가 아니라 이 버튼(또는 Enter)으로 확정 (사용자 지시 2026-08-10) */}
        <button type="button" className="sim-search-btn" onClick={doSearch}>{t("검색")}</button>
      </div>

      {!doc || !sims ? (
        <p className="sim-note">{t("불러오는 중…")}</p>
      ) : q ? (
        results.length ? grid(results) : <p className="sim-note">{t("검색 결과가 없습니다.")}</p>
      ) : recs && (
        <>
          {recs.event && recs.event.list.length > 0 && (
            <section className="sim-sec">
              <h3>{t("최신 이벤트")} <em>{recs.event.name}</em></h3>
              {grid(recs.event.list)}
            </section>
          )}
          {recs.main && recs.main.list.length > 0 && (
            <section className="sim-sec">
              <h3>{t("메인 스토리")} <em>{recs.main.name}</em></h3>
              {grid(recs.main.list)}
            </section>
          )}
          {recs.camp.length > 0 && (
            <section className="sim-sec">
              <h3>{t("섬멸작전")}</h3>
              {grid(recs.camp)}
            </section>
          )}
        </>
      )}

      {/* 상세 모달 — 페이지 이동 없이 이 자리에서 (사용자 지시 2026-08-10). 시뮬 가능
          작전이면 이동 경로 탭 + 자동 재생(autoSim)으로 연다. */}
      {view && (
        <ModalWindow key={mainRaise} label={`${view.stage.code} ${view.stage.name}`} className="operator-modal st-modal"
          onClose={() => setOpen(null)}>
          {/* key: 다른 작전으로 갈아탈 때 환경 탭·시뮬 상태를 초기화한다 */}
          <StageFile key={view.stage.id} view={view} onOpenEnemy={openEnemy} onOpenItem={openItem}
            autoSim={canSim(view.stage)} />
        </ModalWindow>
      )}
      {subEnemy && (
        <ModalWindow key={enemyRaise} label={subEnemy.name} className="operator-modal en-modal" onClose={() => setSubEnemy(null)}>
          <EnemyFile enemy={subEnemy} stagesDoc={null} onOpenEnemy={openEnemy} />
        </ModalWindow>
      )}
      {subItem && (
        <Suspense fallback={null}>
          <ItemModal key={itemRaise} id={subItem} onClose={() => setSubItem(null)} onShowItem={openItem}
            onShowStage={(sid: string) => {
              const st = byId.get(sid);
              if (st) { setOpen(st); setMainRaise((k) => k + 1); }
            }} />
        </Suspense>
      )}
    </section>
  );
}
