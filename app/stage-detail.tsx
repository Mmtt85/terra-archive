"use client";

// 작전 상세 본문 — 목록의 모달(app/stages.tsx)과 상세 페이지(/stages/<id>)가 공유한다.
//
// ⚠ 적 도감과 **같은 이유로** 데이터를 임포트하지 않는다: home.tsx가 이걸 lazy가 아니라
//   인라인으로 그려야 상세 페이지 HTML에 본문이 박힌다 (근거는 app/enemy-detail.tsx 머리주석).
//   1.6MB짜리 stages.json은 지연 로드되는 목록 탭에만 있다.

import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { asset } from "./assets";
import { enemyPath, enemyImg, enemyImgBase, stageMap, stagePath, stageListPath } from "./dex-paths";

import { viewOf, type EnvMul, type Stage, type StageDoc, type StageView } from "./stage-data";

// 다른 모듈이 종전처럼 여기서 가져다 쓰던 것들 — 정본은 app/dex-paths.ts · app/stage-data.ts다
export { stageMap, stagePath, stageListPath, viewOf };
export type { Stage, StageDoc, StageView };

const nf = (n: number) => n.toLocaleString("en-US");

/** 환경 배수(룬)에서 이 적에게 걸리는 최종 배수 — 전체 대상(0)과 지목 대상을 곱으로 합친다 */
function mulFor(id: string, rows?: EnvMul[]): [number, number, number, number] {
  const m: [number, number, number, number] = [1, 1, 1, 1];
  for (const r of rows ?? []) {
    if (r[4] !== 0 && !String(r[4]).split("|").includes(id)) continue;
    m[0] *= r[0]; m[1] *= r[1]; m[2] *= r[2]; m[3] *= r[3];
  }
  return m;
}

/** 등장 적 한 칸 — 통합전략 작전 노드의 적 셀과 같은 짜임(초상 위·이름 아래·코어 스탯).
 *  누르면 **모달로 겹쳐** 적 상세가 뜬다 (페이지 이동 없음). */
function EnemyChip({ e, mul, onOpenEnemy }: {
  e: { id: string; name: string; cnt: number; lv: number; st?: [number, number, number, number] };
  mul?: EnvMul[];
  onOpenEnemy?: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const base = e.id.replace(/_\d+$/, "");
  // 환경 배수(고난·긴급 룬)를 곱해 실제 등장 수치로 보여준다 (사용자 요청 2026-08-10).
  // 마저는 배수가 아니라 그대로인 경우가 대부분 — 곱해지면 함께 반영된다.
  const m = mulFor(e.id, mul);
  const st = e.st && ([
    Math.round(e.st[0] * m[0]), Math.round(e.st[1] * m[1]),
    Math.round(e.st[2] * m[2]), Math.round(e.st[3] * m[3]),
  ] as const);
  return (
    <a className={`st-enemy${e.lv > 0 ? " reinforced" : ""}`} href={enemyPath(locale, e.id)}
      onClick={(ev) => {
        if (!onOpenEnemy || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
        ev.preventDefault(); onOpenEnemy(e.id);
      }}>
      {/* 가로형 배치 (사용자 확정 2026-08-10): "적이름 ×N" 한 줄 · 그 밑에 썸네일 왼쪽 ·
          스탯 2×2 오른쪽 — 세로도 줄어든다. */}
      <span className="st-enemy-name">
        <span className="nm">{e.name}</span>
        {/* 별만 찍지 않고 몇 단계 강화인지 숫자로 (사용자 지적 2026-08-10) */}
        {e.lv > 0 && <i title={t("강화 {n}단계", { n: String(e.lv) })}>★{e.lv}</i>}
        {e.cnt > 0 && <em className="st-enemy-cnt">×{e.cnt}</em>}
      </span>
      <span className="st-enemy-body">
        <img src={enemyImg(e.id)} alt="" aria-hidden width={96} height={96} loading="lazy" decoding="async"
          onError={(ev) => {
            const el = ev.currentTarget;
            if (base !== e.id && !el.dataset.fb) { el.dataset.fb = "1"; el.src = enemyImgBase(e.id); }
            else el.style.visibility = "hidden";
          }} />
        {/* 코어 스탯 — 통전 전투노드 규격 (사용자 요청 2026-08-10 "적 얼굴만 덜렁 나오지 말고").
            환경 배수가 곱해진 값은 빨간 톤으로 표시한다. */}
        {st && (
          <span className="st-enemy-stats">
            <b className={m[0] !== 1 ? "up" : undefined} title={t("최대 HP")}>HP {nf(st[0])}</b>
            <b className={m[1] !== 1 ? "up" : undefined} title={t("공격력")}>{t("공격")} {nf(st[1])}</b>
            <b className={m[2] !== 1 ? "up" : undefined} title={t("방어력")}>{t("방어")} {nf(st[2])}</b>
            <b className={m[3] !== 1 ? "up" : undefined} title={t("마법 저항")}>{t("마저")} {nf(st[3])}</b>
          </span>
        )}
      </span>
    </a>
  );
}

export function StageFile({ view, onOpenEnemy, onOpenItem }: {
  view: StageView; onOpenEnemy?: (id: string) => void; onOpenItem?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(false);
  const zoomRef = useRef<HTMLButtonElement | null>(null);
  // 확대 해제는 **페이지 아무 곳이나** 눌러도 된다 (사용자 요청 2026-08-09).
  // 버튼 자체 클릭은 onClick 토글이 맡으므로 여기선 버튼 밖만 잡는다.
  useEffect(() => {
    if (!zoom) return;
    const off = (ev: PointerEvent) => {
      if (!zoomRef.current?.contains(ev.target as Node)) setZoom(false);
    };
    document.addEventListener("pointerdown", off, true);
    return () => document.removeEventListener("pointerdown", off, true);
  }, [zoom]);
  // 작전 환경 — 고난 판(alt)이 있으면 [일반/고난], 긴급 제한 조건(chg)만 있으면 [일반/긴급].
  // 고난은 도면·적·드랍이 통째로 다른 판이라 뷰를 갈아끼우고, 긴급은 지형·적이 같아
  // 제한 조건 텍스트만 바꿔 보여준다 (사용자 확정 2026-08-10 "하나만 만들고 환경 선택").
  const [env, setEnv] = useState<0 | 1>(view.initEnv === 1 ? 1 : 0);
  const hasEnv = !!(view.alt || view.stage.chg);
  const cur = env === 1 && view.alt ? view.alt : view;
  const s = cur.stage;
  // 드랍은 구분(주요·특별·추가·완벽 작전…)별로 묶는다 — 게임 '작전 정보' 화면과 같은 짜임
  const byKind: { kind: string; items: StageView["drops"] }[] = [];
  for (const d of cur.drops) {
    const last = byKind.find((x) => x.kind === d.kind);
    if (last) last.items.push(d);
    else byKind.push({ kind: d.kind, items: [d] });
  }
  const reinforced = cur.enemies.some((e) => e.lv > 0);
  const facts: [string, string][] = [
    ...(s.ap ? [[t("소모 이성"), String(s.ap)] as [string, string]] : []),
    ...(s.exp ? [[t("작전 경험치"), String(s.exp)] as [string, string]] : []),
    ...(s.gold ? [[t("용문폐"), String(s.gold)] as [string, string]] : []),
    ...(s.danger ? [[t("권장 편성"), s.danger] as [string, string]] : []),
  ];
  // 활성 환경의 적 스탯 배수 — 고난(alt) 뷰는 자기 em, 긴급은 일반판의 chgEm.
  // 일반판이 없는 고난 전용 작전(H10-1 등)은 em이 상시 걸린다 (게임도 항상 고난이다).
  const envMul = cur.stage.em ?? (env === 1 && !view.alt ? view.stage.chgEm : undefined);
  return (
    <div className="st-file">
      {/* 헤더 한 줄 배치 — 계열·구역 배지는 이름 오른쪽으로, 환경 탭은 오른쪽 끝
          (사용자 요청 2026-08-10 "밑으로 길어지지 않도록"). 좁은 화면에선 줄바꿈된다. */}
      <header className="st-head">
        <div className="st-head-main">
          <span className="st-code">{s.code}</span>
          <h2>{s.name}</h2>
          <div className="st-badges">
            <span className="st-tag">{view.typeName}</span>
            {view.zone && view.zone !== view.typeName && <span className="st-tag">{view.zone}</span>}
          </div>
          {/* 작전 환경 선택 — 통합전략 일반/긴급 탭(.rg-modal-modes)과 같은 짜임 */}
          {hasEnv && (
            <div className="st-envs" role="tablist" aria-label={t("작전 환경")}>
              <button type="button" role="tab" aria-selected={env === 0} className={env === 0 ? "on" : ""}
                onClick={() => setEnv(0)}>{t("일반 환경")}</button>
              <button type="button" role="tab" aria-selected={env === 1} className={`hard${env === 1 ? " on" : ""}`}
                onClick={() => setEnv(1)}>{view.alt ? t("고난 환경") : t("긴급 환경")}</button>
            </div>
          )}
        </div>
      </header>

      {/* 통합전략 작전 노드 상세와 같은 2단 구성 (사용자 요청 2026-08-09):
          왼쪽에 지형 도면·설명·수치, 오른쪽에 등장 적·드랍. */}
      <div className="st-cols">
        <div className="st-left">
          {/* ⚠ 도면은 **원본 비율 그대로** 둔다. 인게임 도면은 거의 다 정사각이라
              통합전략처럼 16:9로 늘리면 찌그러진다 (사용자 지적). 클릭 확대는 통전과 같다. */}
          {s.map ? (
            <button type="button" ref={zoomRef} className={`st-map-zoom${zoom ? " zoom" : ""}`}
              onClick={() => setZoom((z) => !z)}
              title={zoom ? t("아무 곳이나 클릭하면 원래 크기로 돌아갑니다") : t("클릭하면 화면 크기로 확대됩니다")}>
              <img className="st-map" src={stageMap(s.id)} alt={t("{code} 지형 도면", { code: s.code })}
                loading="lazy" decoding="async" />
            </button>
          ) : (
            <p className="st-note">{t("이 작전은 지형 도면이 제공되지 않습니다.")}</p>
          )}
          {s.desc && <p className="st-desc">{s.desc}</p>}
          {/* 긴급 환경 제한 조건 — 설명을 지우지 않고 이어서 덧붙인다 (사용자 요청 2026-08-10) */}
          {env === 1 && !view.alt && view.stage.chg && <p className="st-desc st-chg">{view.stage.chg}</p>}
          {facts.length > 0 && (
            <dl className="st-facts">
              {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          )}
        </div>

        <div className="st-right">
          {cur.enemies.length > 0 && (
            <section className="st-block">
              <h3>
                <span className="section-no">ENEMY</span>{t("등장 적")} <em>{cur.enemies.length}</em>
                {/* 배수 안내는 제목 줄 오른쪽 끝 — 밑으로 줄을 안 늘린다 (사용자 요청 2026-08-10) */}
                {envMul && <span className="st-envnote">{t("빨간 수치는 이 환경의 스탯 배수가 반영된 값입니다.")}</span>}
              </h3>
              {reinforced && <p className="st-note">{t("★ 뒤의 숫자는 강화 단계입니다 — 적을 누르면 단계별 스탯이 나옵니다.")}</p>}
              <div className="st-enemies">
                {cur.enemies.map((e, i) => <EnemyChip key={`${e.id}-${i}`} e={e} mul={envMul} onOpenEnemy={onOpenEnemy} />)}
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
                          {/* 재료 상세도 **모달로 겹쳐** 띄운다 (사용자 요청 2026-08-09).
                              재료파밍 도우미의 상세를 그대로 쓰므로 설명·조합식·효율 스테이지까지 나온다. */}
                          <button type="button" disabled={!onOpenItem} onClick={() => onOpenItem?.(d.id)}>
                            <img src={asset(`/items/${d.id}.webp`)} alt="" aria-hidden width={28} height={28}
                              loading="lazy" decoding="async"
                              onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
                            <span>{d.name}</span>
                            {/* 실측이 있으면 게임 빈도 대신 정확한 % + 효율 순위 (사용자 요청
                                2026-08-09). 순위는 기대 이성 오름차순 — 재료파밍 도우미와 같은 기준. */}
                            {d.rate !== undefined ? (
                              <em>{d.rate}% · {(d.rank ?? 99) <= 10 ? t("효율 {n}위", { n: String(d.rank) }) : t("순위밖")}</em>
                            ) : (
                              <em>{d.occ}</em>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
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
