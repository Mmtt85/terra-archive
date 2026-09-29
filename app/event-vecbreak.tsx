"use client";

// 벡터 돌파 상세 — 이벤트 도감 모달(app/events.tsx 의 EventFile) 안, **작전 목록 자리**가 탭이 된다
// (사용자 지시 2026-09-29 "지금 작전 있는부분에다가 개요 작전 커널돌파 총력전 ….. 이런식으로"). '작전' 탭이 종전 목록이다.
//
// ## 왜 (사용자 요청 2026-09-29 "벡터돌파 말인데, 표시할 수 있는 데이터는 다 표시했으면 좋겠음")
//
// 공통 틀(작전·등장 적·교환 재화)로는 모드 구조가 안 보였다. 게임 데이터(activity.VEC_BREAK_V2)에 있는 것을
// **탭 일곱 개**로 나눠 싣는다: 개요(구역·해금 조건·일정·규칙·메달) · 커널 돌파(층·교관·소개문·마일스톤 포인트) ·
// 총력전 · 특별 전선(개방일·주둔 인원·얻는 보급·묶음) · 전투 보급 · 돌파 마일스톤 · 게임 안내.
// 구역 이름(커널 돌파·총력전·특별 전선)·'교관 강화'·'돌파 마일스톤'은 **게임 문구를 그대로** 탭 이름으로 쓴다.
//
// 데이터: app/data/event-vecbreak{,.en,.ja}.json (scripts/build-event-vecbreak.py, 로케일당 ~70KB) — 모달을 열 때
// 처음 받는다. 3회차(미래시)는 중섭 원문의 비공식 번역이다(tr).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { asset } from "./assets";
import { useI18n } from "./i18n";
import { GuideZoom } from "./event-duel";

type Boss = { e: string; n: string | null; d: string | null; lv?: number; i: string | null };
/** [완벽 클리어, 일반 클리어, [기간 한정 시작, 끝, 추가 포인트]?] */
type Pts = [number | null, number | null, [string | null, string | null, number]?];
type Off = { s: string; lv: number; b: 0 | 1; t: string | null; boss: Boss | null; p: Pts };
type Hard = { s: string; o: string; t: string | null; boss: Boss | null; p: Pts };
type Def = { s: string; g: string | null; open: string | null; lim: number | null; buff: string | null; i: string | null; p: Pts };
/** [Lv, 누적 포인트, 종류, id, 수량, 이름, 아이콘, 개방 시각(늦게 열리는 단계만)] */
type MileRow = [number, number, string, string, number, string | null, string | null, string | null];
export type VecData = {
  sub: string | null; color: string | null; period: [string | null, string | null, string | null];
  zones: [string, string | null, string | null][]; sched: [string | null, string | null][];
  rule: { buffMax?: number; def?: string | null; boss?: string | null };
  off: Off[]; hard: Hard[]; def: Def[]; groups: [string, string[]][];
  buffs: Record<string, [string | null, string | null, string | null]>;
  mile: { name: string | null; item: [string, string | null, string | null]; rows: MileRow[] };
  medals: [string, string | null, string | null, string | null, string | null, string | null][];
  guide: string[]; tr?: 1;
};

const LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  ko: () => import("./data/event-vecbreak.json"),
  en: () => import("./data/event-vecbreak.en.json"),
  ja: () => import("./data/event-vecbreak.ja.json"),
};
const cache = new Map<string, Promise<Record<string, VecData>>>();
function loadVec(locale: string) {
  let p = cache.get(locale);
  if (!p) {
    p = (LOADERS[locale] ?? LOADERS.ko)().then((m) => m.default as Record<string, VecData>);
    cache.set(locale, p);
  }
  return p;
}

const md = (s: string | null) => (s ? s.slice(5).replace("-", ".") : "");   // "2026-09-23 16:00" → "09.23 16:00"
const n0 = (v: number | null | undefined) => (v ?? 0).toLocaleString("en-US");
// 훈장은 게임 안내 바로 왼쪽 탭 (사용자 지시 2026-09-29 "메달은 훈장으로 변경하고, 게임안내 왼쪽에다 넣어줘")
type Tab = "overview" | "stages" | "kernel" | "allout" | "front" | "supply" | "mile" | "medal" | "guide";
const TABS: Tab[] = ["overview", "stages", "kernel", "allout", "front", "supply", "mile", "medal", "guide"];

export function VecDetail({ id, stages, stagesTab, onOpenStage, onOpenEnemy }: {
  id: string;
  /** 이벤트 행의 작전 [id, 코드, 이름] — 코드·이름은 여기서 빌린다 (작전 도감·미래시 도감과 같은 표기) */
  stages: [string, string, string][];
  /** '작전' 탭 본문 — 이벤트 창의 공통 작전 목록(묶음 머리말 포함)을 그대로 받는다 */
  stagesTab: ReactNode;
  onOpenStage: (id: string) => void;
  onOpenEnemy: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const [data, setData] = useState<VecData | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("overview");
  useEffect(() => {
    let live = true;
    loadVec(locale).then((all) => { if (live) setData(all[id] ?? null); }, () => { if (live) setData(null); });
    return () => { live = false; };
  }, [id, locale]);
  const stageOf = useMemo(() => new Map(stages.map(([sid, code, name]) => [sid, { code, name }])), [stages]);
  // 받는 동안·자료가 없는 회차는 종전처럼 작전 목록만 — 자리가 비었다 차면 모달이 출렁인다
  const plain = (
    <section className="ev-sec">
      <b>{t("작전 {n}", { n: stages.length })}</b>
      {stagesTab}
    </section>
  );
  if (!data) return plain;
  const zone = (i: number, fb: string) => data.zones[i]?.[1] ?? fb;
  const label: Record<Tab, string> = {
    overview: t("개요"), stages: t("작전 {n}", { n: stages.length }),
    kernel: zone(0, t("커널 돌파")), allout: zone(1, t("총력전")), front: zone(2, t("특별 전선")),
    supply: t("전투 보급 {n}", { n: Object.keys(data.buffs).length }), mile: data.mile.name ?? t("돌파 마일스톤"),
    medal: t("훈장 {n}", { n: data.medals.length }), guide: t("게임 안내"),
  };
  const ctx = { data, stageOf, onOpenStage, onOpenEnemy };
  return (
    <section className="ev-sec ed-wrap vb-wrap">
      <div className="ed-tabs" role="tablist" aria-label={data.sub ?? undefined}>
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={tab === k ? "on" : undefined} onClick={() => setTab(k)}>{label[k]}</button>
        ))}
      </div>
      <div className="ed-panel" role="tabpanel">
        {tab === "overview" && <Overview {...ctx} />}
        {tab === "stages" && stagesTab}
        {tab === "kernel" && <Floors {...ctx} />}
        {tab === "allout" && <AllOut {...ctx} />}
        {tab === "front" && <Front {...ctx} />}
        {tab === "supply" && <Supplies {...ctx} />}
        {tab === "mile" && <Milestones data={data} />}
        {tab === "medal" && <Medals data={data} />}
        {tab === "guide" && <Guide data={data} />}
      </div>
    </section>
  );
}

type Ctx = {
  data: VecData; stageOf: Map<string, { code: string; name: string }>;
  onOpenStage: (id: string) => void; onOpenEnemy: (id: string) => void;
};

function StageBtn({ sid, stageOf, onOpenStage }: { sid: string } & Pick<Ctx, "stageOf" | "onOpenStage">) {
  const st = stageOf.get(sid);
  return (
    <button type="button" className="vb-stage" onClick={() => onOpenStage(sid)}>
      <b>{st?.code ?? sid}</b><span>{st?.name ?? ""}</span>
    </button>
  );
}

/** 마일스톤 포인트 — 완벽 / 일반 클리어, 기간 한정 추가분 */
function PtsLine({ p, data }: { p: Pts; data: VecData }) {
  const { t } = useI18n();
  const icon = data.mile.item[2];
  const pt = icon ? <img className="ed-pt" src={asset(icon)} alt="" aria-hidden width={16} height={16} /> : null;
  if (p[0] == null && p[1] == null) return null;
  return (
    <span className="vb-pts">
      {pt}<span>{t("완벽 {a} · 일반 {b}", { a: n0(p[0]), b: n0(p[1]) })}</span>
      {p[2] && <em title={`${md(p[2][0])} ~ ${md(p[2][1])}`}>{t("기간 한정 +{n}", { n: p[2][2] })}</em>}
    </span>
  );
}

function BossCard({ boss, title, onOpenEnemy }: { boss: Boss; title?: string | null; onOpenEnemy: (id: string) => void }) {
  return (
    <div className="vb-boss">
      <button type="button" className="vb-boss-face" onClick={() => onOpenEnemy(boss.e)} title={boss.n ?? boss.e}>
        {boss.i ? <img src={asset(boss.i)} alt="" aria-hidden width={56} height={56} loading="lazy" decoding="async" />
          : <span className="ed-noimg" aria-hidden>?</span>}
        <b>{boss.n ?? boss.e}</b>
      </button>
      {boss.d && (
        <div className="vb-boss-desc">
          {title && <i>{title}</i>}
          <p>{boss.d}</p>
        </div>
      )}
    </div>
  );
}

function Overview({ data, stageOf, onOpenStage }: Ctx) {
  const { t } = useI18n();
  const opensAt = (start: string | null) => data.def.filter((d) => d.open && d.open === start);
  const [s, e, r] = data.period;
  return (
    <>
      {data.tr && <p className="ed-note">{t("아직 정식 출시되지 않은 이벤트라, 중국 서버 원문을 AI가 번역한 비공식 텍스트입니다.")}</p>}
      {(s || e) && (
        <p className="vb-period">
          <span>{data.tr ? t("중국 서버 기간") : t("기간")}</span>{md(s)} ~ {md(e)}
          {r && r !== e && <em>{t("보상 수령 {at}까지", { at: md(r) })}</em>}
          <small>{t("한국 시간")}</small>
        </p>
      )}
      <h4 className="ed-h">{t("구성")}</h4>
      <ol className="vb-zones">
        {data.zones.map(([zid, name, lock], i) => (
          <li key={zid}>
            <b>{name}</b>
            <span>{[data.off, data.hard, data.def][i]?.length ? t("작전 {n}", { n: [data.off, data.hard, data.def][i].length }) : ""}</span>
            {lock && <em>{lock}</em>}
          </li>
        ))}
      </ol>
      {(data.rule.def || data.rule.buffMax) && (
        <>
          <h4 className="ed-h">{t("규칙")}</h4>
          <ul className="vb-rules">
            {data.rule.def && <li>{data.rule.def}</li>}
            <li>{t("특별 전선을 클리어해 주둔하면 전투 보급이 열리고, 커널 돌파·총력전에 장착해 쓸 수 있습니다.")}</li>
            {data.groups.length > 0 && <li>{t("묶인 특별 전선 두 곳은 앞 작전의 주둔을 빼면 뒤 작전의 상위 보급도 함께 꺼집니다.")}</li>}
          </ul>
        </>
      )}
      {data.sched.length > 0 && (
        <>
          <h4 className="ed-h">{data.tr ? t("진행 일정 (중국 서버)") : t("진행 일정")}<small>{t("특별 전선은 구간마다 새로 열립니다 (한국 시간)")}</small></h4>
          <ol className="ed-phases vb-sched">
            {data.sched.map(([a, b], i) => (
              <li key={i}>
                <span className="ed-when">{md(a)} ~ {md(b)}</span>
                <span className="ed-what vb-sched-st">
                  {opensAt(a).map((d) => <StageBtn key={d.s} sid={d.s} stageOf={stageOf} onOpenStage={onOpenStage} />)}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

/** 훈장 — 이름·획득 조건·설명 (게임 표기가 '훈장'이다: '주술의 밤 탁월함 훈장') */
function Medals({ data }: { data: VecData }) {
  const { t } = useI18n();
  if (!data.medals.length) return <p className="no-detail">{t("훈장이 없습니다.")}</p>;
  return (
    <ul className="vb-medals">
      {data.medals.map(([mid, name, , how, desc, icon]) => (
        <li key={mid}>
          {icon ? <img src={asset(icon)} alt="" aria-hidden width={48} height={48} loading="lazy" decoding="async" />
            : <span className="ed-noimg" aria-hidden>?</span>}
          <span>
            <b>{name}</b>
            {how && <i>{how}</i>}
            {desc && <em>{desc}</em>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Floors({ data, stageOf, onOpenStage, onOpenEnemy }: Ctx) {
  const { t } = useI18n();
  return (
    <ol className="vb-list">
      {[...data.off].reverse().map((f) => (
        <li key={f.s} className={f.b ? "boss" : undefined}>
          <div className="vb-row-h">
            <span className="vb-floor">{t("{n}층", { n: f.lv })}</span>
            <StageBtn sid={f.s} stageOf={stageOf} onOpenStage={onOpenStage} />
            {f.b ? <em className="vb-tag">{t("교관")}</em> : null}
            <PtsLine p={f.p} data={data} />
          </div>
          {f.t && <p className="vb-story">{f.t}</p>}
          {f.boss && <BossCard boss={f.boss} title={data.rule.boss} onOpenEnemy={onOpenEnemy} />}
        </li>
      ))}
    </ol>
  );
}

function AllOut({ data, stageOf, onOpenStage, onOpenEnemy }: Ctx) {
  return (
    <ol className="vb-list">
      {data.hard.map((h) => (
        <li key={h.s} className={h.boss ? "boss" : undefined}>
          <div className="vb-row-h">
            <span className="vb-floor">{h.o}</span>
            <StageBtn sid={h.s} stageOf={stageOf} onOpenStage={onOpenStage} />
            <PtsLine p={h.p} data={data} />
          </div>
          {h.t && <p className="vb-story">{h.t}</p>}
          {h.boss && <BossCard boss={h.boss} title={data.rule.boss} onOpenEnemy={onOpenEnemy} />}
        </li>
      ))}
    </ol>
  );
}

function BuffChip({ id, data }: { id: string | null; data: VecData }) {
  const b = id ? data.buffs[id] : undefined;
  if (!b) return null;
  return (
    <span className="vb-buff">
      {b[2] ? <img src={asset(b[2])} alt="" aria-hidden width={32} height={32} loading="lazy" decoding="async" /> : null}
      <span><b>{b[0]}</b>{b[1] && <i>{b[1]}</i>}</span>
    </span>
  );
}

function Front({ data, stageOf, onOpenStage }: Ctx) {
  const { t } = useI18n();
  const groupNo = new Map(data.groups.map(([g], i) => [g, i + 1]));
  const upper = new Set(data.groups.flatMap(([, list]) => list.slice(1)));
  return (
    <ol className="vb-list vb-front">
      {data.def.map((d) => (
        <li key={d.s} className={d.g ? "grouped" : undefined}>
          <div className="vb-row-h">
            {d.i ? <img className="vb-def-face" src={asset(d.i)} alt="" aria-hidden width={40} height={40} loading="lazy" decoding="async" /> : null}
            <StageBtn sid={d.s} stageOf={stageOf} onOpenStage={onOpenStage} />
            {d.lim != null && <em className="vb-tag">{t("주둔 {n}명", { n: d.lim })}</em>}
            {d.g && <em className="vb-tag g">{upper.has(d.s) ? t("묶음 {n} · 상위 보급", { n: groupNo.get(d.g) ?? "" }) : t("묶음 {n}", { n: groupNo.get(d.g) ?? "" })}</em>}
            {d.open && <span className="vb-open">{t("{at}부터", { at: md(d.open) })}</span>}
            <PtsLine p={d.p} data={data} />
          </div>
          <BuffChip id={d.buff} data={data} />
        </li>
      ))}
    </ol>
  );
}

function Supplies({ data, stageOf, onOpenStage }: Ctx) {
  const { t } = useI18n();
  const from = new Map<string, string[]>();
  for (const d of data.def) if (d.buff) from.set(d.buff, [...(from.get(d.buff) ?? []), d.s]);
  return (
    <>
      {data.rule.def && <p className="ed-note">{data.rule.def}</p>}
      <ul className="vb-supplies">
        {Object.entries(data.buffs).map(([bid, [name, desc, icon]]) => (
          <li key={bid}>
            {icon ? <img src={asset(icon)} alt="" aria-hidden width={48} height={48} loading="lazy" decoding="async" />
              : <span className="ed-noimg" aria-hidden>?</span>}
            <span>
              <b>{name}</b>
              {desc && <i>{desc}</i>}
              {(from.get(bid) ?? []).length > 0 && (
                <span className="vb-from">{t("얻는 곳")}
                  {(from.get(bid) ?? []).map((sid) => <StageBtn key={sid} sid={sid} stageOf={stageOf} onOpenStage={onOpenStage} />)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Milestones({ data }: { data: VecData }) {
  const { t } = useI18n();
  const mile = data.mile;
  const [, ptName, ptIcon] = mile.item;
  const nameOf = (r: MileRow) => r[5] ?? (r[2] === "PLAYER_AVATAR" ? t("프로필 아바타") : r[3]);
  const special = (r: MileRow) => r[2] === "CHAR_SKIN" || r[2] === "FURN" || r[2] === "PLAYER_AVATAR";
  const totals = useMemo(() => {
    const m = new Map<string, { row: MileRow; count: number }>();
    for (const r of mile.rows) {
      const cur = m.get(r[3]);
      if (cur) cur.count += r[4]; else m.set(r[3], { row: r, count: r[4] });
    }
    return [...m.values()];
  }, [mile.rows]);
  const late = mile.rows.find((r) => r[7]);
  const pt = ptIcon ? <img className="ed-pt" src={asset(ptIcon)} alt="" aria-hidden width={16} height={16} /> : null;
  return (
    <>
      <h4 className="ed-h">{mile.name ?? t("돌파 마일스톤")}<small>{t("{item} 누적 수량에 따라 단계별 보상", { item: ptName ?? "" })}</small></h4>
      <div className="ed-totals" aria-label={t("{n}단계 합계", { n: mile.rows.length })}>
        <span className="ed-totals-h">{t("{n}단계 합계", { n: mile.rows.length })}</span>
        {totals.map(({ row, count }) => (
          <span key={row[3]} className={`ed-total${special(row) ? " sp" : ""}`} title={nameOf(row)}>
            {row[6] ? <img src={asset(row[6])} alt="" aria-hidden width={26} height={26} loading="lazy" decoding="async" /> : null}
            <span>{nameOf(row)}</span><b>×{n0(count)}</b>
          </span>
        ))}
      </div>
      <ol className="ed-mile">
        {mile.rows.map((r) => (
          <li key={r[0]} className={`${special(r) ? "sp" : ""}${r[7] ? " late" : ""}`.trim() || undefined}
            title={[`Lv.${r[0]} · ${nameOf(r)} ×${n0(r[4])}`, `${ptName ?? ""} ${n0(r[1])}`, r[7] ? t("{at}부터", { at: md(r[7]) }) : ""].filter(Boolean).join("\n")}>
            <span className="ed-lv">Lv.{r[0]}</span>
            {r[6] ? <img src={asset(r[6])} alt={nameOf(r) ?? ""} width={36} height={36} loading="lazy" decoding="async" />
              : <span className="ed-noimg" aria-hidden>?</span>}
            <span className="ed-cnt">×{n0(r[4])}</span>
            <span className="ed-tok">{pt}{n0(r[1])}</span>
          </li>
        ))}
      </ol>
      {late && <p className="ed-note">{t("Lv.{lv} 이후 단계는 {at}에 열립니다 (한국 시간)", { lv: late[0], at: md(late[7]) })}</p>}
    </>
  );
}

function Guide({ data }: { data: VecData }) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState<number | null>(null);
  if (!data.guide.length) return <p className="no-detail">{t("게임 안내 그림이 없습니다.")}</p>;
  return (
    <>
      <h4 className="ed-h">{t("인게임 안내")}<small>{t("누르면 크게 볼 수 있습니다")}</small></h4>
      <div className="ed-guide">
        {data.guide.map((src, i) => (
          <button key={src} type="button" onClick={() => setZoom(i)}>
            <img src={asset(src)} alt={t("안내 {n}", { n: i + 1 })} loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
      {zoom !== null && <GuideZoom srcs={data.guide} index={zoom} onIndex={setZoom} onClose={() => setZoom(null)} />}
    </>
  );
}
