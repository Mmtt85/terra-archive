"use client";

// 적 상세 본문 — 목록의 모달(app/enemies.tsx)과 상세 페이지(/enemies/<id>)가 공유한다.
//
// ⚠ **이 모듈은 데이터를 임포트하지 않는다.** 적 하나를 props로 받을 뿐이다.
//   이유(2026-08-09 실측): app/home.tsx가 이 컴포넌트를 lazy()가 아니라 **인라인**으로
//   그려야 상세 페이지 HTML에 본문이 박힌다. 빌드 산출물로 확인한 사실 —
//     dist/client/operators/<id>.html  → 본문 2,186자 (인라인 렌더)
//     dist/client/rogue/is1.html       → 본문 728자, "데이터를 불러오는 중…" (lazy)
//   그래서 표현부만 여기 두고, 1MB짜리 enemies.json은 지연 로드되는 목록 탭에만 둔다.
//   여기에 데이터 임포트를 추가하면 그 순간 모든 페이지의 첫 번들이 1MB 늘어난다.

import { useI18n } from "./i18n";
import { enemyImg, enemyImgBase, enemyPath, enemyListPath, stageListPath } from "./dex-paths";

// 다른 모듈이 종전처럼 여기서 가져다 쓰던 것들 — 정본은 app/dex-paths.ts다
export { enemyImg, enemyImgBase, enemyPath, enemyListPath };

/** scripts/build-enemies.py 산출물 한 마리. 필드 설명은 그 스크립트 헤더 참조. */
export type EnemyLevel = {
  l: number; hp: number; atk: number; def: number; res: number;
  aspd: number; ms: number; w: number; lp: number; imm: string[];
};
export type Enemy = {
  id: string; idx: string | null; name: string; rank: string | null; sort: number;
  desc: string | null; abil: string[]; dmg: string[]; race: string[];
  way: string | null; motion: string | null; rng?: number; link?: string[];
  lv: EnemyLevel[];
};
/** 등장 작전 역색인 — stages[i] = [코드, 이름, 구역, 스테이지종류, stageId] */
// byEnemy[id] = [작전번호, 스폰수?, 스탯레벨?] — 뒤 칸은 0이면 생략된다
export type EnemyStages = { stages: [string, string, string, string, string][]; byEnemy: Record<string, number[][]> };

/** 등급 표시 — i18n 사전 키(한국어)로 준다 */
export const RANK_KEY: Record<string, string> = { NORMAL: "일반", ELITE: "정예", BOSS: "보스" };


const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** 초상 — 변종 id에 파일이 없으면 원본 id로 한 번 폴백한다 */
function Portrait({ enemy, size }: { enemy: Enemy; size: number }) {
  const base = enemy.id.replace(/_\d+$/, "");
  return (
    <img className="en-portrait" src={enemyImg(enemy.id)} alt="" aria-hidden
      width={size} height={size} loading="lazy" decoding="async"
      onError={(e) => {
        const el = e.currentTarget;
        if (base !== enemy.id && !el.dataset.fb) { el.dataset.fb = "1"; el.src = enemyImgBase(enemy.id); }
        else el.style.visibility = "hidden";
      }} />
  );
}

/** 스탯표 — **스탯이 열, 강화 단계가 행**이다 (사용자 요청 2026-08-09).
 *  단계가 대부분 1~2개뿐이라, 단계를 열로 두면 표가 세로로 길쭉해지고 값 비교가 어렵다. */
function StatTable({ levels }: { levels: EnemyLevel[] }) {
  const { t } = useI18n();
  const cols: [string, (l: EnemyLevel) => string][] = [
    ["최대 HP", (l) => fmt(l.hp)],
    ["공격력", (l) => fmt(l.atk)],
    ["방어력", (l) => fmt(l.def)],
    ["마법 저항", (l) => `${fmt(l.res)}%`],
    ["공격 속도", (l) => fmt(l.aspd)],
    ["이동 속도", (l) => fmt(l.ms)],
    ["무게", (l) => fmt(l.w)],
    ["라이프 감소", (l) => fmt(l.lp)],
  ];
  return (
    <div className="en-stats-wrap">
      <table className="en-stats">
        <thead>
          <tr>
            <th scope="col">{t("단계")}</th>
            {cols.map(([label]) => <th key={label} scope="col">{t(label)}</th>)}
          </tr>
        </thead>
        <tbody>
          {/* 레벨 0은 강화 이전 = 기본형이다. "강화 0단계"로 쓰면 말이 안 된다. */}
          {levels.map((l) => (
            <tr key={l.l}>
              <th scope="row">{l.l === 0 ? t("기본형") : t("강화 {n}단계", { n: String(l.l) })}</th>
              {cols.map(([label, get]) => <td key={label}>{get(l)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 등장 작전 — 구역별로 묶어서. stagesDoc이 아직 안 왔으면 아무것도 그리지 않는다. */
function Appearances({ enemy, doc, onOpenStage }: { enemy: Enemy; doc: EnemyStages | null; onOpenStage?: (sid: string) => void }) {
  const { locale, t } = useI18n();
  const refs = doc?.byEnemy[enemy.id];
  if (!doc || !refs || !refs.length) return null;
  // 역색인은 이미 메인→막간→섬멸→자원→보안파견→이벤트 순으로 쌓여 있다
  // (build-enemies.py의 TYPE_ORDER) — 여기서 다시 정렬하지 않고 구역 경계만 나눈다.
  const groups: { zone: string; items: { code: string; name: string; cnt: number; lv: number; sid: string }[] }[] = [];
  for (const r of refs) {
    const s = doc.stages[r[0]];
    if (!s) continue;
    const last = groups[groups.length - 1];
    const item = { code: s[0], name: s[1], cnt: r[1] ?? 0, lv: r[2] ?? 0, sid: s[4] };
    if (last && last.zone === s[2]) last.items.push(item);
    else groups.push({ zone: s[2], items: [item] });
  }
  const reinforced = groups.some((g) => g.items.some((it) => it.lv > 0));
  return (
    <section className="en-block">
      <h3><span className="section-no">STAGES</span>{t("등장 작전")} <em>{refs.length}</em></h3>
      {reinforced && <p className="en-note">{t("★ 표시는 강화된 스탯으로 나오는 작전입니다.")}</p>}
      <div className="en-stagelist">
        {groups.map((g, gi) => (
          <div className="en-stagegroup" key={`${g.zone}-${gi}`}>
            <h4>{g.zone}</h4>
            <ul>
              {g.items.map((it, ii) => (
                <li key={`${it.code}-${ii}`} className={it.lv > 0 ? "reinforced" : undefined}>
                  {/* 작전 도감으로 — 상세 라우트가 없는 이벤트 작전도 있어 **목록 + 해시**로 연다 */}
                  {/* 작전 도감으로 **넘어가지 않고** 상세를 겹쳐 띄운다 (사용자 요청
                      2026-08-09). 콜백이 없는 자리(상세 페이지)에선 링크로 폴백한다. */}
                  <a href={`${stageListPath(locale)}#st-${it.sid}`}
                    onClick={(e) => {
                      if (!onOpenStage || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault(); onOpenStage(it.sid);
                    }}>
                    {it.lv > 0 && <i className="en-lv" aria-hidden title={t("강화 {n}단계", { n: String(it.lv) })}>★</i>}
                    <b>{it.code}</b><span>{it.name}</span>
                    {it.cnt > 0 && <em>×{it.cnt}</em>}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * 적 상세 본문.
 *  · stagesDoc — 등장 작전 색인. 상세 **페이지**는 서버가 넣어 주고(프리렌더 대상),
 *    목록 모달은 열릴 때 지연 로드한다. null이면 그 절만 빠진다.
 *  · onOpenEnemy — 연계 소환 적으로 이동 (목록 안에서만 동작, 페이지에선 링크로 폴백)
 */
export function EnemyFile({ enemy, stagesDoc, nameOf, onOpenEnemy, onOpenStage }: {
  enemy: Enemy; stagesDoc: EnemyStages | null;
  nameOf?: (id: string) => string | undefined;
  onOpenEnemy?: (id: string) => void;
  onOpenStage?: (sid: string) => void;
}) {
  const { locale, t } = useI18n();
  const imm = enemy.lv.find((l) => l.imm.length)?.imm ?? [];
  const facts: [string, string][] = [
    ...(enemy.race.length ? [[t("종족"), enemy.race.join(" · ")] as [string, string]] : []),
    ...(enemy.way ? [[t("공격 방식"), enemy.way] as [string, string]] : []),
    ...(enemy.motion ? [[t("이동 방식"), enemy.motion] as [string, string]] : []),
    ...(enemy.dmg.length ? [[t("피해 유형"), enemy.dmg.join(" · ")] as [string, string]] : []),
    ...(enemy.rng ? [[t("공격 범위"), fmt(enemy.rng)] as [string, string]] : []),
  ];
  return (
    <div className="en-file">
      <header className="en-head">
        <Portrait enemy={enemy} size={132} />
        <div className="en-head-main">
          <span className="en-code">{enemy.idx ?? "—"}</span>
          <h2>{enemy.name}</h2>
          <div className="en-badges">
            {enemy.rank && <span className={`en-rank r-${enemy.rank.toLowerCase()}`}>{t(RANK_KEY[enemy.rank] ?? enemy.rank)}</span>}
            {enemy.race.map((r) => <span className="en-tag" key={r}>{r}</span>)}
            {enemy.motion && <span className="en-tag">{enemy.motion}</span>}
            {enemy.way && <span className="en-tag">{enemy.way}</span>}
          </div>
        </div>
      </header>

      {enemy.desc && <p className="en-desc">{enemy.desc}</p>}

      {facts.length > 0 && (
        <dl className="en-facts">
          {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}

      {enemy.abil.length > 0 && (
        <section className="en-block">
          <h3><span className="section-no">ABILITY</span>{t("능력")}</h3>
          <ul className="en-abil">{enemy.abil.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
      )}

      <section className="en-block">
        <h3><span className="section-no">STAT</span>{t("스탯")}</h3>
        {enemy.lv.length > 1 && (
          <p className="en-note">{t("같은 적이라도 작전에 따라 더 강한 스탯으로 나옵니다 — 아래는 그 단계별 수치입니다.")}</p>
        )}
        <StatTable levels={enemy.lv} />
      </section>

      {imm.length > 0 && (
        <section className="en-block">
          <h3><span className="section-no">IMMUNE</span>{t("상태이상 면역")}</h3>
          <div className="en-badges">{imm.map((x) => <span className="en-imm" key={x}>{x}</span>)}</div>
        </section>
      )}

      {enemy.link && enemy.link.length > 0 && (
        <section className="en-block">
          <h3><span className="section-no">LINK</span>{t("연계 소환")}</h3>
          <div className="en-links">
            {enemy.link.map((id) => (
              <a key={id} href={enemyPath(locale, id)}
                onClick={(e) => {
                  if (!onOpenEnemy || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault(); onOpenEnemy(id);
                }}>{nameOf?.(id) ?? id}</a>
            ))}
          </div>
        </section>
      )}

      <Appearances enemy={enemy} doc={stagesDoc} onOpenStage={onOpenStage} />
    </div>
  );
}

/** 상세 페이지(/enemies/<id>) — 목록 대신 이 적 하나만 그린다 */
export function EnemyPage({ enemy, stagesDoc, onBack }: {
  enemy: Enemy; stagesDoc: EnemyStages | null; onBack?: () => void;
}) {
  const { locale, t } = useI18n();
  return (
    <div className="operator-page-wrap">
      <a className="story-back" href={enemyListPath(locale)}
        onClick={(e) => {
          if (!onBack || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault(); onBack();
        }}>← {t("적 목록으로")}</a>
      <section className="operator-modal operator-page en-page" aria-label={enemy.name}>
        <EnemyFile enemy={enemy} stagesDoc={stagesDoc} />
      </section>
    </div>
  );
}
