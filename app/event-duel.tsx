"use client";

// 듀얼 채널 상세 — 이벤트 도감 모달(app/events.tsx 의 EventFile) 안, 공통 틀 아래에 붙는다.
//
// ## 왜 (사용자 요청 2026-09-23)
//
// "방금 다운받은 이벤트에서 표시할 수 있는 모든 데이터를 다 가독성좋게 최대한 보여줬으면" — 듀얼 채널은
// 작전이 VS-1 하나뿐이고 등장 적이 고정돼 있지 않아서(라운드마다 풀에서 양쪽 팀을 뽑는다) 공통 틀로는
// 작전 하나·재화 하나뿐인 빈 모달이었다. 게임 데이터에 있는 것을 **탭 여섯 개**로 나눠 싣는다:
// 개요(진행 단계·모드·경기장) · 보상(보상 프로그램 50단계·순위 추가 보상·일일 활약·메달) · 선수(명단) ·
// 라운드(모드별 대진 구성) · 게임 안내(인게임 안내 그림·팁) · 관객(NPC·정산 코멘트).
//
// 데이터: app/data/event-duel{,.en,.ja}.json (scripts/build-event-duel.py, 로케일당 ~80KB) — 모달을 열 때
// 처음 받는다. 이벤트 도감 문서(events.json)에 넣으면 듀얼을 안 여는 사람도 매번 받는다.
// ⚠ 풀 이름(POOL_LABEL)·NPC 전략(STRAT)은 게임 내부 이름을 옮긴 것이다. 뜻이 분명하지 않은 전략
//   (CHOOSE_ODD)은 지어내지 않고 비워 둔다.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { asset } from "./assets";
import { useI18n } from "./i18n";
import { enemyImg } from "./dex-paths";

type StatKey = "hp" | "atk" | "def" | "res";
/** 선수 한 명 — o = 원본 적 id(적 도감), on = 원본 이름(듀얼 이름과 다를 때만), d = 원본과 다른 스탯 */
export type DuelFighter = {
  id: string; n: string; o?: string; on?: string;
  hp: number; atk: number; def: number; res: number; aspd: number; ms: number; w: number; lp: number;
  d?: StatKey[]; p: string[]; idle?: 1; new?: 1; multi?: 1;
};
type ModeKey = "solo" | "gift" | "stand";
type DuelMode = {
  key: ModeKey; type: string; name: string; en?: string; target?: string; desc?: string; max?: number;
  match: 0 | 1; room: 0 | 1; ch?: string; sub?: string; pic?: string; cond?: string;
  rounds?: number; sel?: number; last?: number; init?: number; shield?: number;
  rank?: [number, number, number][];
};
/** [라운드, 왼쪽 최소, 최대, 오른쪽 최소, 최대, 왼쪽 풀, 오른쪽 풀, 관망, 올인, 선택 시간(초 — 0 이면 모드 기본)] */
type Round = [number, number, number, number, number, string, string, 0 | 1, 0 | 1, number];
/** [Lv, 누적 폭죽, 종류, id, 수량, 이름, 아이콘, 개방 시각(늦게 열리는 단계만)] */
type MileRow = [number, number, string, string, number, string | null, string | null, string | null];
export type DuelData = {
  until?: string; info: { bgm?: string; arena?: string; match?: string };
  phases: [string, string, string, 0 | 1][];
  modes: DuelMode[]; rounds: Partial<Record<ModeKey, Round[]>>;
  daily: { name?: string; desc?: string };
  mile: {
    name?: string; item: [string | null, string | null]; hl?: string; hlText?: string; rows: MileRow[];
    furn?: Record<string, [string | null, string | null, number | null]>;
  };
  roster: DuelFighter[]; unk?: number;
  npc: [string | null, string, string | null][];
  tips: [string, ModeKey[]][];
  comments: [string, string][];
  medals: [string, string, string, string, string, string | null][];
  guide: string[];
  fb?: 1;
};

const LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  ko: () => import("./data/event-duel.json"),
  en: () => import("./data/event-duel.en.json"),
  ja: () => import("./data/event-duel.ja.json"),
};
const cache = new Map<string, Promise<Record<string, DuelData>>>();
function loadDuel(locale: string) {
  let p = cache.get(locale);
  if (!p) {
    p = (LOADERS[locale] ?? LOADERS.ko)().then((m) => m.default as Record<string, DuelData>);
    cache.set(locale, p);
  }
  return p;
}

const POOL_LABEL: Record<string, string> = {
  normal: "일반", giant: "거대 보스", antigiant: "거대 보스 상대", boss: "보스", nosurprise: "기습 없음",
  small: "소형", music: "음악",
};
const STRAT: Record<string, string> = {
  ALWAYS_LEFT: "항상 왼쪽", FOLLOW_MORE: "다수를 따라감", FOLLOW_FEWER: "소수를 따라감",
  CHOOSE_ODD_ENEMY_COUNT: "적이 홀수인 쪽", CHOOSE_EVEN_ENEMY_COUNT: "적이 짝수인 쪽", CHOOSE_WIN: "승리 예상 쪽",
};
const TABS = ["overview", "reward", "roster", "round", "guide", "crowd"] as const;
type Tab = (typeof TABS)[number];

const kstMs = (s: string) => Date.parse(`${s.replace(" ", "T")}:00+09:00`);
const md = (s: string) => s.slice(5).replace("-", ".");       // "2026-09-23 16:00" → "09.23 16:00"
const n0 = (v: number) => v.toLocaleString("en-US");
const range = (a: number, b: number) => (a === b ? String(a) : `${a}–${b}`);
/** [1,2,3,5,7,8] → "1–3·5·7–8" */
const spans = (xs: number[]) => {
  const out: string[] = [];
  let s = xs[0], p = xs[0];
  for (const x of [...xs.slice(1), NaN]) {
    if (x === p + 1) { p = x; continue; }
    out.push(s === p ? `${s}` : `${s}–${p}`);
    s = x; p = x;
  }
  return out.join("·");
};

/** side — 개요 탭 왼쪽 칸(썸네일 + 교환 재화). 이벤트 모달이 공통 윗칸에서 쓰는 블록을 그대로 넘긴다. */
export function DuelDetail({ id, onOpenFighter, side }: { id: string; onOpenFighter: (f: DuelFighter) => void; side?: ReactNode }) {
  const { locale, t } = useI18n();
  const [data, setData] = useState<DuelData | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("overview");
  useEffect(() => {
    let live = true;
    loadDuel(locale).then((all) => { if (live) setData(all[id] ?? null); }, () => { if (live) setData(null); });
    return () => { live = false; };
  }, [id, locale]);
  if (data === undefined) return <p className="no-detail">{t("불러오는 중…")}</p>;
  if (!data) return null;
  const label: Record<Tab, string> = {
    overview: t("개요"), reward: t("보상"), roster: t("선수 {n}", { n: data.roster.length }),
    round: t("라운드"), guide: t("게임 안내"), crowd: t("관객·기타"),
  };
  return (
    <section className="ev-sec ed-wrap">
      <b>{t("듀얼 채널 상세")}</b>
      {data.fb && <p className="ed-note">{t("이 서버엔 아직 없는 회차라 게임 문구를 한국어판으로 보여 줍니다.")}</p>}
      <div className="ed-tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={tab === k ? "on" : undefined} onClick={() => setTab(k)}>{label[k]}</button>
        ))}
      </div>
      <div className="ed-panel" role="tabpanel">
        {tab === "overview" && <Overview data={data} side={side} />}
        {tab === "reward" && <Rewards data={data} />}
        {tab === "roster" && <Roster data={data} onOpen={onOpenFighter} />}
        {tab === "round" && <Rounds data={data} />}
        {tab === "guide" && <Guide data={data} />}
        {tab === "crowd" && <Crowd data={data} />}
      </div>
    </section>
  );
}

/** 개요 — [썸네일·교환 재화 | 진행 단계] · 모드 카드 · 경기장·BGM
 *  (사용자 지시 2026-09-23 "개요 탭에다가 섬네일(밑에 교환재화) | 진행단계 느낌으로") */
function Overview({ data, side }: { data: DuelData; side?: ReactNode }) {
  const { t } = useI18n();
  // '지금' 단계 표시 — 렌더 중에 Date.now() 를 부르지 않는다(react-compiler 순수성 규칙). 첫 칠은 표시 없이,
  // 마운트 직후 한 번 채운다 (app/autochess-party.tsx useClock 과 같은 방식).
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <>
      <div className="ev-top ed-top">
        {side}
        <div className="ev-top-main">
      <h4 className="ed-h">{t("진행 단계")}</h4>
      <ol className="ed-phases">
        {data.phases.map(([s, e, text, isNew], i) => {
          const on = now > 0 && now >= kstMs(s) && now <= kstMs(e) + 59_999;
          return (
            <li key={i} className={on ? "on" : now > kstMs(e) + 59_999 ? "past" : undefined}>
              <span className="ed-when">{md(s)} ~ {md(e)}</span>
              <span className="ed-what">{text}</span>
              {isNew ? <em className="ed-badge">NEW</em> : null}
              {on && <em className="ed-badge now">{t("지금")}</em>}
            </li>
          );
        })}
      </ol>
      {data.until && <p className="ed-note">{t("보상 수령은 {at}까지 (한국 시간)", { at: md(data.until) })}</p>}
        </div>
      </div>

      <h4 className="ed-h">{t("관전 모드")}</h4>
      <div className="ed-modes">
        {data.modes.map((m) => (
          <article key={m.key} className="ed-mode">
            {m.pic && <img className="ed-mode-pic" src={asset(m.pic)} alt="" aria-hidden loading="lazy" decoding="async" />}
            <div className="ed-mode-body">
              <h5>{m.name}{m.en && <small>{m.en}</small>}</h5>
              {m.target && <p className="ed-mode-target">{m.target}</p>}
              {m.desc && <p className="ed-mode-desc">{m.desc}</p>}
              <ul className="ed-facts">
                {m.rounds ? <li>{m.key === "stand" ? t("최대 {n}라운드", { n: m.rounds }) : t("{n}라운드", { n: m.rounds })}</li> : null}
                {m.init ? <li>{t("시작 선물 {n}", { n: n0(m.init) })}</li> : null}
                {m.sel ? <li>{t("선택 {n}초", { n: m.sel })}{m.last ? ` · ${t("마지막 {n}초 응원 비공개", { n: m.last })}` : ""}</li> : null}
                {m.shield ? <li>{t("관객 보호 {n}라운드까지", { n: m.shield })}</li> : null}
                {m.max ? <li>{m.key === "solo" ? t("NPC 관객과 {n}명", { n: m.max }) : t("최대 {n}명", { n: m.max })}</li> : null}
                {(m.match || m.room) ? <li>{[m.match ? t("매칭") : "", m.room ? t("단체방") : ""].filter(Boolean).join(" · ")}</li> : null}
                {m.cond && <li className="lock">{m.cond}</li>}
              </ul>
              {m.ch && <p className="ed-ch" title={t("게임 속 중계 채널")}>● {m.ch}{m.sub ? ` · ${m.sub}` : ""}</p>}
            </div>
          </article>
        ))}
      </div>

      {(data.info.arena || data.info.bgm) && (
        <dl className="ed-info">
          {data.info.arena && <div><dt>{t("경기장")}</dt><dd>{[data.info.arena, data.info.match].filter(Boolean).join(" · ")}</dd></div>}
          {data.info.bgm && <div><dt>BGM</dt><dd>{data.info.bgm}</dd></div>}
        </dl>
      )}
    </>
  );
}

/** 보상 — 보상 프로그램 50단계(합계 먼저) · 순위 추가 보상 · 일일 활약 · 메달 */
function Rewards({ data }: { data: DuelData }) {
  const { t } = useI18n();
  const mile = data.mile;
  const [ptName, ptIcon] = mile.item;
  const nameOf = (r: MileRow) => r[5] ?? (r[2] === "PLAYER_AVATAR" ? t("프로필 아바타") : r[3]);
  const special = (r: MileRow) => r[2] === "PLAYER_AVATAR" || r[2] === "FURN" || r[3] === "mod_unlock_token";
  const totals = useMemo(() => {
    const m = new Map<string, { row: MileRow; count: number }>();
    for (const r of mile.rows) {
      const cur = m.get(r[3]);
      if (cur) cur.count += r[4]; else m.set(r[3], { row: r, count: r[4] });
    }
    return [...m.values()];
  }, [mile.rows]);
  const late = mile.rows.find((r) => r[7]);
  const ranked = data.modes.filter((m) => m.rank?.length);
  const pt = ptIcon ? <img className="ed-pt" src={asset(ptIcon)} alt="" aria-hidden width={16} height={16} /> : null;
  return (
    <>
      <h4 className="ed-h">{mile.name ?? t("보상 프로그램")}<small>{t("{item} 누적 수량에 따라 단계별 보상", { item: ptName ?? "" })}</small></h4>
      {mile.hl && <p className="ed-hl"><b>{mile.hl}</b>{mile.hlText ? ` — ${mile.hlText}` : ""}</p>}
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
        {mile.rows.map((r) => {
          const f = r[2] === "FURN" ? mile.furn?.[r[3]] : undefined;
          const tip = [`Lv.${r[0]} · ${nameOf(r)} ×${n0(r[4])}`, `${ptName ?? ""} ${n0(r[1])}`,
            f?.[2] ? t("분위기 +{n}", { n: f[2] }) : "", f?.[1] ?? "", r[7] ? t("{at}부터", { at: md(r[7]) }) : ""]
            .filter(Boolean).join("\n");
          return (
            <li key={r[0]} className={`${special(r) ? "sp" : ""}${r[7] ? " late" : ""}`.trim() || undefined} title={tip}>
              <span className="ed-lv">Lv.{r[0]}</span>
              {r[6] ? <img src={asset(r[6])} alt={nameOf(r)} width={36} height={36} loading="lazy" decoding="async" />
                : <span className="ed-noimg" aria-hidden>?</span>}
              <span className="ed-cnt">×{n0(r[4])}</span>
              <span className="ed-tok">{pt}{n0(r[1])}</span>
            </li>
          );
        })}
      </ol>
      {late && <p className="ed-note">{t("Lv.{lv} 이후 단계는 {at}에 열립니다 (한국 시간)", { lv: late[0], at: md(late[7] as string) })}</p>}

      {ranked.length > 0 && (
        <>
          <h4 className="ed-h">{t("순위 추가 보상")}<small>{t("매칭 한 판의 최종 순위에 따라")}</small></h4>
          <div className="ed-ranks">
            {ranked.map((m) => (
              <table key={m.key} className="ed-rank">
                <caption>{m.name}</caption>
                <tbody>
                  {(m.rank ?? []).map(([a, b, tok]) => (
                    <tr key={a}><th scope="row">{a === b ? t("{n}위", { n: a }) : t("{a}~{b}위", { a, b })}</th><td>{pt}+{tok}</td></tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </>
      )}

      {data.daily.desc && (
        <>
          <h4 className="ed-h">{data.daily.name ?? t("일일 활약")}</h4>
          <p className="ed-daily">{data.daily.desc}</p>
        </>
      )}

      {data.medals.length > 0 && (
        <>
          <h4 className="ed-h">{t("메달 {n}", { n: data.medals.length })}</h4>
          <div className="ed-medals">
            {data.medals.map(([mid, name, rarity, how, desc, img]) => (
              <div key={mid} className="ed-medal">
                {img ? <img src={asset(img)} alt="" aria-hidden width={56} height={56} loading="lazy" decoding="async" /> : <span className="ed-noimg" aria-hidden>?</span>}
                <div>
                  <b>{name}{rarity && <em className="ed-rar">{rarity}</em>}</b>
                  {how && <p className="ed-medal-how">{how}</p>}
                  {desc && <p className="ed-medal-desc">{desc}</p>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

type RosterSort = "base" | StatKey;

/** 선수 명단 — 필터(신규·풀) · 정렬 · 카드. 누르면 원본 적 도감 + 듀얼 수치 한 줄이 겹쳐 뜬다. */
function Roster({ data, onOpen }: { data: DuelData; onOpen: (f: DuelFighter) => void }) {
  const { t } = useI18n();
  const [filt, setFilt] = useState<string>("all");
  const [sort, setSort] = useState<RosterSort>("base");
  const pools = useMemo(() => {
    const c = new Map<string, number>();
    for (const f of data.roster) for (const p of f.p) c.set(p, (c.get(p) ?? 0) + 1);
    return Object.keys(POOL_LABEL).filter((k) => c.has(k)).map((k) => [k, c.get(k) as number] as const);
  }, [data.roster]);
  // 풀 칩의 툴팁 — '어느 모드의 몇 라운드에 쓰이나'. 게임 내부 이름만으로는 뜻이 약하다
  const usedAt = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const mode of data.modes) {
      const byPool = new Map<string, number[]>();
      for (const r of data.rounds[mode.key] ?? []) {
        for (const pool of new Set([r[5], r[6]])) byPool.set(pool, [...(byPool.get(pool) ?? []), r[0]]);
      }
      for (const [pool, rounds] of byPool) m.set(pool, [...(m.get(pool) ?? []), `${mode.name} ${spans(rounds)}R`]);
    }
    return m;
  }, [data.modes, data.rounds]);
  const newCount = data.roster.filter((f) => f.new).length;
  const shown = useMemo(() => {
    const list = data.roster.filter((f) => filt === "all" || (filt === "new" ? f.new : f.p.includes(filt.slice(5))));
    return sort === "base" ? list : [...list].sort((a, b) => b[sort] - a[sort]);
  }, [data.roster, filt, sort]);
  const chip = (key: string, text: string, count: number, title?: string) => (
    <button key={key} type="button" className={filt === key ? "on" : undefined} title={title}
      onClick={() => setFilt(key)}>{text} <em>{count}</em></button>
  );
  return (
    <>
      <p className="ed-note">{t("라운드마다 이 명단에서 양쪽 팀을 뽑습니다. 큰 글씨가 듀얼 채널 전용 이름, 작은 글씨가 원본 적입니다. 강조된 수치는 원본과 다른 값입니다.")}</p>
      <div className="ed-filter">
        {chip("all", t("전체"), data.roster.length)}
        {newCount > 0 && chip("new", t("신규"), newCount, t("앞 회차에 없던 선수"))}
        {pools.map(([k, c]) => chip(`pool:${k}`, t("{pool} 풀", { pool: t(POOL_LABEL[k]) }), c,
          (usedAt.get(k) ?? []).join("\n") || undefined))}
        <label className="ed-sort">
          <span>{t("정렬")}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as RosterSort)}>
            <option value="base">{t("게임 순서")}</option>
            <option value="hp">{t("최대 HP")}</option>
            <option value="atk">{t("공격력")}</option>
            <option value="def">{t("방어력")}</option>
            <option value="res">{t("마법 저항")}</option>
          </select>
        </label>
      </div>
      <div className="ed-roster">
        {shown.map((f) => {
          const up = (k: StatKey) => (f.d?.includes(k) ? "up" : undefined);
          return (
            <button key={f.id} type="button" className={`ed-fighter${f.idle ? " idle" : ""}`} onClick={() => onOpen(f)}>
              <img src={enemyImg(f.o ?? f.id)} alt="" aria-hidden width={48} height={48} loading="lazy" decoding="async"
                onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              <span className="ed-f-main">
                <b>{f.n}</b>
                {f.on && <small>{f.on}</small>}
                <span className="ed-f-stat">
                  <span className={up("hp")}>HP {n0(f.hp)}</span>
                  <span className={up("atk")}>{t("공격")} {n0(f.atk)}</span>
                  <span className={up("def")}>{t("방어")} {n0(f.def)}</span>
                  <span className={up("res")}>{t("마저")} {f.res}</span>
                </span>
              </span>
              <span className="ed-f-tags">
                {f.new && <em className="ed-badge">NEW</em>}
                {f.multi && <em className="ed-badge soft" title={t("여러 개체가 한 팀으로 나온다")}>{t("다수")}</em>}
                {f.idle && <em className="ed-badge soft" title={t("모든 풀의 가중치가 0 — 지금은 대진에 뽑히지 않습니다")}>{t("대기")}</em>}
              </span>
            </button>
          );
        })}
      </div>
      {data.unk ? <p className="ed-note">{t("풀에는 올라 있지만 게임 데이터에 아직 없는 선수 {n}명은 뺐습니다.", { n: data.unk })}</p> : null}
    </>
  );
}

/** 라운드 — 모드마다 표 하나. 전부 불가(관망·올인)인 칸은 뺀다. */
function Rounds({ data }: { data: DuelData }) {
  const { t } = useI18n();
  const pool = (k: string) => t(POOL_LABEL[k] ?? k);
  return (
    <>
      <p className="ed-note">{t("양쪽 팀은 각 칸의 풀에서 그 수만큼 뽑힙니다. 풀에 누가 있는지는 '선수' 탭의 풀 필터로 볼 수 있습니다.")}</p>
      {data.modes.map((m) => {
        const rs = data.rounds[m.key];
        if (!rs?.length) return null;
        const hasSkip = rs.some((r) => r[7]);
        const hasAll = rs.some((r) => r[8]);
        return (
          <div key={m.key} className="ed-round">
            <h4 className="ed-h">{m.name}</h4>
            <div className="ed-table-wrap">
              <table className="ed-rtable">
                <thead>
                  <tr>
                    <th scope="col">{t("라운드")}</th><th scope="col">{t("왼쪽 팀")}</th><th scope="col">{t("오른쪽 팀")}</th>
                    <th scope="col">{t("선택 시간")}</th>
                    {hasSkip && <th scope="col">{t("관망")}</th>}
                    {hasAll && <th scope="col">{t("올인")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rs.map((r) => {
                    const special = r[5] !== "normal" || r[6] !== "normal";
                    return (
                      <tr key={r[0]} className={special ? "sp" : undefined}>
                        <th scope="row">{r[0]}</th>
                        <td>{pool(r[5])} <b>{range(r[1], r[2])}</b></td>
                        <td>{pool(r[6])} <b>{range(r[3], r[4])}</b></td>
                        <td>{t("{n}초", { n: r[9] || m.sel || 0 })}</td>
                        {hasSkip && <td>{r[7] ? "○" : "—"}</td>}
                        {hasAll && <td>{r[8] ? "○" : "—"}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {m.rounds && m.rounds > rs.length && (
              <p className="ed-note">{t("최대 {n}라운드 — 게임 데이터에는 {k}라운드까지만 따로 정의돼 있습니다.", { n: m.rounds, k: rs.length })}</p>
            )}
          </div>
        );
      })}
    </>
  );
}

/** 게임 안내 — 인게임 안내 그림(서버 언어, 16:9) · 로딩 팁. 그림을 누르면 같은 비율로 크게 뜬다
 *  (사용자 지시 2026-09-23 "새탭에서 원본이미지가 아니라 모달창이 떠서 같은비율로 확대"). */
function Guide({ data }: { data: DuelData }) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState<number | null>(null);
  const modeName = (k: ModeKey) => data.modes.find((m) => m.key === k)?.name ?? k;
  return (
    <>
      {data.guide.length > 0 && (
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
      )}
      {data.tips.length > 0 && (
        <>
          <h4 className="ed-h">{t("팁 {n}", { n: data.tips.length })}</h4>
          <ul className="ed-tips">
            {data.tips.map(([text, modes], i) => (
              <li key={i}>
                <span className="ed-tip-tags">{modes.length ? modes.map((k) => <em key={k}>{modeName(k)}</em>) : <em className="all">{t("공통")}</em>}</span>
                {text}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** 안내 그림 확대 — 오퍼 스킨 확대(app/home.tsx SkinLightbox)와 같은 규약: 어디를 눌러도 닫히고 Esc 로도 닫힌다.
 *  ←/→ 와 아래 버튼으로 장을 넘긴다(인게임 안내가 한 벌 5장이다).
 *  ⚠ body 포털 + z 1150 — 이벤트 모달은 창(z 200~)이라 그 안에 그리면 창 틀에 갇히고 아래로 깔린다.
 *  ⚠ 키는 **window 캡처 단계**에서 먼저 받아 전파를 끊는다 — 창의 Esc(document)까지 가면 이벤트 모달도 같이 닫힌다. */
function GuideZoom({ srcs, index, onIndex, onClose }: {
  srcs: string[]; index: number; onIndex: (i: number) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const n = srcs.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowRight" && n > 1) { e.stopPropagation(); onIndex((index + 1) % n); }
      else if (e.key === "ArrowLeft" && n > 1) { e.stopPropagation(); onIndex((index + n - 1) % n); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, n, onIndex, onClose]);
  return createPortal(
    <div className="ed-zoom" role="dialog" aria-modal="true" aria-label={t("인게임 안내")}
      onMouseDown={(e) => { e.stopPropagation(); onClose(); }}>
      <button type="button" className="ed-zoom-close" onClick={onClose} aria-label={t("닫기")}>×</button>
      <img src={asset(srcs[index])} alt={t("안내 {n}", { n: index + 1 })} />
      {n > 1 && (
        <div className="ed-zoom-nav" onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => onIndex((index + n - 1) % n)} aria-label={t("이전")}>‹</button>
          <span>{index + 1} / {n}</span>
          <button type="button" onClick={() => onIndex((index + 1) % n)} aria-label={t("다음")}>›</button>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** 관객·기타 — 관객 NPC · 정산 코멘트 */
function Crowd({ data }: { data: DuelData }) {
  const { t } = useI18n();
  const byType = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [typ, text] of data.comments) m.set(typ, [...(m.get(typ) ?? []), text]);
    return [...m.entries()];
  }, [data.comments]);
  const typeName = (typ: string) => (typ === "STAND"
    ? data.modes.find((m) => m.type === "STAND")?.name
    : data.modes.filter((m) => m.type === "OPERATION").map((m) => m.name).join(" · ")) || typ;
  return (
    <>
      <h4 className="ed-h">{t("관객 NPC {n}", { n: data.npc.length })}<small>{t("혼자 즐기기에서 함께 예측하는 가상 관객")}</small></h4>
      <div className="ed-npcs">
        {data.npc.map(([img, name, strat], i) => (
          <div key={i} className="ed-npc">
            {img ? <img src={asset(img)} alt="" aria-hidden width={44} height={44} loading="lazy" decoding="async" /> : <span className="ed-noimg" aria-hidden>?</span>}
            <span><b>{name}</b>{strat && STRAT[strat] && <small>{t(STRAT[strat])}</small>}</span>
          </div>
        ))}
      </div>
      {byType.length > 0 && (
        <>
          <h4 className="ed-h">{t("정산 코멘트")}<small>{t("판이 끝나면 결과에 따라 붙는 한마디")}</small></h4>
          {byType.map(([typ, texts]) => (
            <p key={typ} className="ed-comments"><span>{typeName(typ)}</span>{texts.map((x) => <em key={x}>{x}</em>)}</p>
          ))}
        </>
      )}
    </>
  );
}
