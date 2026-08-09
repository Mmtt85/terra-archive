"use client";

// 작전 상세 본문 — 목록의 모달(app/stages.tsx)과 상세 페이지(/stages/<id>)가 공유한다.
//
// ⚠ 적 도감과 **같은 이유로** 데이터를 임포트하지 않는다: home.tsx가 이걸 lazy가 아니라
//   인라인으로 그려야 상세 페이지 HTML에 본문이 박힌다 (근거는 app/enemy-detail.tsx 머리주석).
//   1.6MB짜리 stages.json은 지연 로드되는 목록 탭에만 있다.

import { useI18n } from "./i18n";
import { asset } from "./assets";
import { enemyPath, enemyImg, enemyImgBase, stageMap, stagePath, stageListPath } from "./dex-paths";

import { viewOf, type Stage, type StageDoc, type StageView } from "./stage-data";

// 다른 모듈이 종전처럼 여기서 가져다 쓰던 것들 — 정본은 app/dex-paths.ts · app/stage-data.ts다
export { stageMap, stagePath, stageListPath, viewOf };
export type { Stage, StageDoc, StageView };


/** 등장 적 한 칸 — 누르면 적 도감으로 간다 (두 도감이 서로를 가리킨다) */
function EnemyChip({ e, onOpenEnemy }: {
  e: { id: string; name: string; cnt: number; lv: number };
  onOpenEnemy?: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const base = e.id.replace(/_\d+$/, "");
  return (
    <a className={`st-enemy${e.lv > 0 ? " reinforced" : ""}`} href={enemyPath(locale, e.id)}
      onClick={(ev) => {
        if (!onOpenEnemy || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
        ev.preventDefault(); onOpenEnemy(e.id);
      }}>
      <img src={enemyImg(e.id)} alt="" aria-hidden width={48} height={48} loading="lazy" decoding="async"
        onError={(ev) => {
          const el = ev.currentTarget;
          if (base !== e.id && !el.dataset.fb) { el.dataset.fb = "1"; el.src = enemyImgBase(e.id); }
          else el.style.visibility = "hidden";
        }} />
      <span className="st-enemy-name">{e.name}</span>
      <span className="st-enemy-meta">
        {e.cnt > 0 && <em>×{e.cnt}</em>}
        {e.lv > 0 && <i title={t("강화 {n}단계", { n: String(e.lv) })}>★</i>}
      </span>
    </a>
  );
}

export function StageFile({ view, onOpenEnemy }: { view: StageView; onOpenEnemy?: (id: string) => void }) {
  const { t } = useI18n();
  const s = view.stage;
  // 드랍은 구분(주요·특별·추가·완벽 작전…)별로 묶는다 — 게임 '작전 정보' 화면과 같은 짜임
  const byKind: { kind: string; items: StageView["drops"] }[] = [];
  for (const d of view.drops) {
    const last = byKind.find((x) => x.kind === d.kind);
    if (last) last.items.push(d);
    else byKind.push({ kind: d.kind, items: [d] });
  }
  const reinforced = view.enemies.some((e) => e.lv > 0);
  const facts: [string, string][] = [
    ...(s.ap ? [[t("소모 이성"), String(s.ap)] as [string, string]] : []),
    ...(s.exp ? [[t("작전 경험치"), String(s.exp)] as [string, string]] : []),
    ...(s.gold ? [[t("용문폐"), String(s.gold)] as [string, string]] : []),
    ...(s.danger ? [[t("권장 편성"), s.danger] as [string, string]] : []),
  ];
  return (
    <div className="st-file">
      <header className="st-head">
        <div className="st-head-main">
          <span className="st-code">{s.code}</span>
          <h2>{s.name}</h2>
          <div className="st-badges">
            <span className="st-tag">{view.typeName}</span>
            {view.zone && view.zone !== view.typeName && <span className="st-tag">{view.zone}</span>}
          </div>
        </div>
      </header>

      {/* 지형 도면 — 이 도감의 핵심. 없는 작전이 있어 map 플래그로 먼저 거른다. */}
      {s.map ? (
        <figure className="st-mapfig">
          <img src={stageMap(s.id)} alt={t("{code} 지형 도면", { code: s.code })}
            loading="lazy" decoding="async" />
        </figure>
      ) : (
        <p className="st-note">{t("이 작전은 지형 도면이 제공되지 않습니다.")}</p>
      )}

      {s.desc && <p className="st-desc">{s.desc}</p>}

      {facts.length > 0 && (
        <dl className="st-facts">
          {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}

      {view.enemies.length > 0 && (
        <section className="st-block">
          <h3><span className="section-no">ENEMY</span>{t("등장 적")} <em>{view.enemies.length}</em></h3>
          {reinforced && <p className="st-note">{t("★ 표시는 강화된 스탯으로 나오는 적입니다.")}</p>}
          <div className="st-enemies">
            {view.enemies.map((e, i) => <EnemyChip key={`${e.id}-${i}`} e={e} onOpenEnemy={onOpenEnemy} />)}
          </div>
        </section>
      )}

      {byKind.length > 0 && (
        <section className="st-block">
          <h3><span className="section-no">DROP</span>{t("드랍")}</h3>
          {/* 확률 수치는 게임 데이터에 없다 — 실측 드랍률은 재료파밍 도우미 몫이다 */}
          <p className="st-note">{t("게임에 표기된 빈도입니다. 실측 드랍률과 이성 효율은 재료파밍 도우미에서 봅니다.")}</p>
          <div className="st-drops">
            {byKind.map((g) => (
              <div className="st-dropgroup" key={g.kind}>
                <h4>{g.kind}</h4>
                <ul>
                  {g.items.map((d, i) => (
                    <li key={`${d.id}-${i}`}>
                      <img src={asset(`/items/${d.id}.webp`)} alt="" aria-hidden width={28} height={28}
                        loading="lazy" decoding="async"
                        onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
                      <span>{d.name}</span><em>{d.occ}</em>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** 상세 페이지(/stages/<id>) — 목록 대신 이 작전 하나만 그린다 */
export function StagePage({ view, onBack }: { view: StageView; onBack?: () => void }) {
  const { locale, t } = useI18n();
  return (
    <div className="operator-page-wrap">
      <a className="story-back" href={stageListPath(locale)}
        onClick={(e) => {
          if (!onBack || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault(); onBack();
        }}>← {t("작전 목록으로")}</a>
      <section className="operator-modal operator-page st-page" aria-label={`${view.stage.code} ${view.stage.name}`}>
        <StageFile view={view} />
      </section>
    </div>
  );
}
