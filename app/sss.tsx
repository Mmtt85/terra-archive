"use client";

// 보안파견 가이드 (/sss, 2026-10-17 — 사용자 "보안파견 가이드 메뉴를 새로 파는 게 맞지 않나").
// 데이터는 app/data/towers-detail{,.en,.ja}.json (scripts/build-tower.py, 게임 climb_tower_table + 훈장 표) — 화면이 열릴 때 받는다.
// 로그인(내 정보)돼 있으면 맵 칸에 내 최고 층·훈장 획득을 겹쳐 보인다 (워커 towerDigest → profile.tower).
// 층을 누르면 작전 도감의 그 작전(lt_<번호>_<층>, 긴급은 작전 창 안 '긴급 환경' 전환)이 창으로 뜬다.
import React, { useEffect, useMemo, useState } from "react";
import { useI18n, DT_LOCALE, type Locale } from "./i18n";
import { asset } from "./assets";
import { ModalWindow } from "./modal-window";
import { useMe } from "./me-store";
import { loadEnemies, loadEnemyStages, loadEnemyStats, loadItems, loadStages } from "./dex-cross";
import { enemyImg } from "./dex-paths";
import { ItemFile, itemIcon, type DexItem, type ItemDoc } from "./items";
import { StageFile } from "./stage-detail";
import { EnemyFile, type Enemy, type EnemyStages } from "./enemy-detail";
import { viewOf, type StageDoc, type StageView } from "./stage-data";

type Info = { desc: string; danger: string; hardDesc: string; boss: string | null; card: string | null; curses: string[];
  tasks: [number, [string, number][]][]; levels: string[]; training: number };
export type TowerDoc = {
  towers: Record<string, [string, string, number, number]>;
  cards: Record<string, [string, string]>;
  tactical: Record<string, [string, string, string]>;
  seasons: Record<string, [string, string[]]>;
  missions: Record<string, [string, [string, number][]]>;
  medals: Record<string, Partial<Record<"clear" | "hard" | "hidden", [string, string, string]>>>;
  info: Record<string, Info>;
  cardInfo: Record<string, [string, string | null, string[]]>;
  curses: Record<string, [string, string]>;
  seasonInfo: Record<string, [number, number, string[]]>;
  const: { initCharCount?: number; charRecruitTimes?: number; charRecruitChoiceCount?: number; assistCharLimit?: number;
    subCardObtainDesc?: string; lowerItemId?: string; lowerItemLimit?: number; higherItemId?: string; higherItemLimit?: number };
};
const DOCS: Record<string, () => Promise<{ default: unknown }>> = {
  ko: () => import("./data/towers-detail.json"),
  en: () => import("./data/towers-detail.en.json"),
  ja: () => import("./data/towers-detail.ja.json"),
};
const TOWER_ART_VER = "2026101701";   // app/me.tsx 와 같은 값 — R2 그림을 바꾸면 둘 다 올린다
const towerBg = (id: string) => (/^tower_n_/.test(id) ? asset(`/tower/${id}.webp?v=${TOWER_ART_VER}`) : null);
const JOB_ORDER = ["PIONEER", "WARRIOR", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"];
const JOB_KO: Record<string, string> = { PIONEER: "뱅가드", WARRIOR: "가드", TANK: "디펜더", SNIPER: "스나이퍼", CASTER: "캐스터", MEDIC: "메딕", SUPPORT: "서포터", SPECIAL: "스페셜리스트" };
const MEDAL_LABEL = { clear: "일반 완료", hard: "긴급 완료", hidden: "일반 퍼펙트" } as const;
const fmtDay = (locale: string, sec: number) => (sec ? new Date(sec * 1000).toLocaleDateString(DT_LOCALE[locale as Locale] ?? "ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "—");

export function SssGuide() {
  const { locale, t } = useI18n();
  const [doc, setDoc] = useState<TowerDoc | null>(null);
  const me = useMe();
  const mine = me?.profile?.tower ?? null;
  const got = useMemo(() => new Set(mine?.medals ?? []), [mine]);
  useEffect(() => {
    let alive = true;
    void (DOCS[locale] ?? DOCS.ko)().then((m) => { if (alive) setDoc(m.default as TowerDoc); });
    return () => { alive = false; };
  }, [locale]);

  // 아이템·작전·적 창 — 내 정보·아이템 도감과 같은 규약(창 위에 겹쳐 띄운다)
  const [items, setItems] = useState<ItemDoc | null>(null);
  const [enMap, setEnMap] = useState<Map<string, Enemy> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadItems<ItemDoc>(locale).then((d) => { if (alive) setItems(d); });
    void loadEnemies(locale).then((m) => { if (alive) setEnMap(m); });
    return () => { alive = false; };
  }, [locale]);
  const [stages, setStages] = useState<StageDoc | null>(null);
  useEffect(() => { let alive = true; void loadStages(locale).then((d) => { if (alive) setStages(d); }); return () => { alive = false; }; }, [locale]);
  const [openItem, setOpenItem] = useState<DexItem | null>(null);
  const [subStage, setSubStage] = useState<StageView | null>(null);
  const [stageRaise, setStageRaise] = useState(0);
  const [subEnemy, setSubEnemy] = useState<Enemy | null>(null);
  const [enStages, setEnStages] = useState<EnemyStages | null>(null);
  const [enemyRaise, setEnemyRaise] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  const [now] = useState(() => Date.now() / 1000);   // 이번 시즌 가르기 — 렌더마다 시계를 읽지 않게
  const itemById = useMemo(() => new Map((items?.items ?? []).flatMap((i) => [[i.id, i] as const, ...(i.alt ?? []).map((a) => [a, i] as const)])), [items]);
  const openStage = (sid: string) => {
    setStageRaise((k) => k + 1);
    void Promise.all([loadStages(locale), loadEnemyStats()]).then(([d, stats]) => {
      const st = d.stages.find((x) => x.id === sid);
      setSubStage(st ? viewOf(d, st, stats) : null);
    });
  };
  const openEnemy = (eid: string) => {
    setEnemyRaise((k) => k + 1);
    void loadEnemies(locale).then((m) => { setEnMap(m); setSubEnemy(m.get(eid) ?? null); });
    void loadEnemyStages(locale).then(setEnStages);
  };

  if (!doc) return <div className="sss"><p className="sss-note">{t("데이터를 불러오는 중...")}</p></div>;

  const seasonIds = Object.keys(doc.seasonInfo).sort((a, b) => doc.seasonInfo[b][0] - doc.seasonInfo[a][0]);
  const cur = seasonIds.find((id) => doc.seasonInfo[id][0] <= now && now <= doc.seasonInfo[id][1]) ?? seasonIds[0];
  const openMaps = new Set(doc.seasons[cur]?.[1] ?? []);
  const name = (id: string) => doc.towers[id]?.[0] ?? id;
  const maps = Object.keys(doc.towers).sort((a, b) => {
    const tr = (doc.info[a]?.training ?? 0) - (doc.info[b]?.training ?? 0);
    return tr || a.localeCompare(b, "en", { numeric: true });
  });
  const reward = (list: [string, number][]) => (
    <span className="sss-reward">
      {list.map(([iid, n]) => {
        const it = itemById.get(iid);
        return (
          <button key={iid} type="button" title={it?.n ?? iid} onClick={() => it && setOpenItem(it)}>
            {it?.i && <img src={itemIcon(it.i)} alt="" width={20} height={20} loading="lazy" />}
            <em>×{n.toLocaleString(DT_LOCALE[locale as Locale] ?? "ko-KR")}</em>
          </button>
        );
      })}
    </span>
  );
  const card = (id: string, cls = "") => {
    const [nm, desc] = doc.cards[id] ?? [id, ""];
    const subs = doc.cardInfo[id]?.[2] ?? [];
    return (
      <article key={id} className={`sss-card ${cls}`}>
        <h4>{nm}</h4>
        <p>{desc}</p>
        {subs.length > 0 && (
          <ul>
            {subs.map((s) => <li key={s}><b>{doc.cards[s]?.[0] ?? s}</b><span>{doc.cards[s]?.[1]}</span></li>)}
          </ul>
        )}
      </article>
    );
  };
  const [cs, ce, cCards] = doc.seasonInfo[cur] ?? [0, 0, []];

  return (
    <div className="sss">
      {/* ── 이번 시즌 ── */}
      <section className="sss-sec">
        <h2>{t("이번 시즌")} <small>{doc.seasons[cur]?.[0]} · {fmtDay(locale, cs)} ~ {fmtDay(locale, ce)}</small></h2>
        <div className="sss-season">
          <ul className="sss-maps">
            {[...openMaps].map((id) => <MapTile key={id} id={id} doc={doc} open mine={mine} got={got} onPick={setPick} />)}
          </ul>
          <div className="sss-season-cards">
            <h3>{t("시즌 리더 카드")}</h3>
            {cCards.map((id) => card(id, "season"))}
          </div>
        </div>
        {mine?.season && mine.season.id === cur && (
          <p className="sss-note">{t("내 시즌 임무 {n}/{total} · 기간 보상 {c}/{l}", {
            n: Object.values(mine.season.missions).filter((m) => m[2] || m[0] >= m[1]).length, total: Object.keys(mine.season.missions).length,
            c: mine.season.period?.cur ?? 0, l: mine.season.period?.len ?? 0 })}</p>
        )}
        <h3>{t("시즌 임무")}</h3>
        <ul className="sss-missions">
          {Object.entries(doc.missions).filter(([id]) => id.startsWith(cur.replace("tower_season_", "tower_season") + "_")).map(([id, [desc, rw]]) => {
            const m = mine?.season?.id === cur ? mine.season.missions[id] : undefined;
            const done = !!m && (m[2] === 1 || m[0] >= m[1]);
            return (
              <li key={id} className={done ? "done" : undefined}>
                <span>{desc}</span>{reward(rw)}{m && <em>{Math.min(m[0], m[1])}/{m[1]}</em>}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── 맵 ── */}
      <section className="sss-sec">
        <h2>{t("맵")} <small>{t("누르면 층별 작전·보상·리더 카드·훈장")}</small></h2>
        {mine && <p className="sss-note">{t("내 정보의 기록을 겹쳐 보여 줍니다 — 훈장 칩은 밝으면 획득")}</p>}
        <ul className="sss-maps">
          {maps.map((id) => <MapTile key={id} id={id} doc={doc} open={openMaps.has(id)} mine={mine} got={got} onPick={setPick} />)}
        </ul>
      </section>

      {/* ── 전술 장비 ── */}
      <section className="sss-sec">
        <h2>{t("전술 장비")} <small>{t("직군마다 A·B 중 하나를 고른다")}</small></h2>
        <table className="sss-tac">
          <tbody>
            {JOB_ORDER.map((job) => {
              const rows = Object.values(doc.tactical).filter(([j]) => j === job).sort((a, b) => a[2].localeCompare(b[2]));
              return (
                <tr key={job}>
                  <th>{t(JOB_KO[job])}</th>
                  {rows.map(([, desc, ab]) => <td key={ab}><b className="sss-ab">{ab}</b>{desc}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ── 리더 카드 (시즌 카드) ── */}
      <section className="sss-sec">
        <h2>{t("시즌 리더 카드")} <small>{t("맵 전용 카드는 맵 창에")}</small></h2>
        <div className="sss-cards">
          {Object.entries(doc.cardInfo).filter(([, v]) => v[0] === "SEASON").map(([id]) => card(id))}
        </div>
      </section>

      {/* ── 지난 시즌 ── */}
      <section className="sss-sec">
        <h2>{t("시즌 기록")}</h2>
        <table className="sss-seasons">
          <thead><tr><th>{t("시즌")}</th><th>{t("기간")}</th><th>{t("열린 맵")}</th><th>{t("시즌 리더 카드")}</th></tr></thead>
          <tbody>
            {seasonIds.map((id) => {
              const [s, e, cards] = doc.seasonInfo[id];
              return (
                <tr key={id} className={id === cur ? "cur" : undefined}>
                  <td>{doc.seasons[id]?.[0]}</td>
                  <td>{fmtDay(locale, s)} ~ {fmtDay(locale, e)}</td>
                  <td>{(doc.seasons[id]?.[1] ?? []).map((m) => <button key={m} type="button" onClick={() => setPick(m)}>{name(m)}</button>)}</td>
                  <td>{cards.map((c) => doc.cards[c]?.[0] ?? c).join(" · ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ── 기본 규칙 ── */}
      <section className="sss-sec">
        <h2>{t("기본 규칙")}</h2>
        <ul className="sss-rules">
          {doc.const.initCharCount != null && <li>{t("처음 데려가는 오퍼 {n}명 · 층마다 {k}번 모집, 한 번에 {c}명 중 고른다", { n: doc.const.initCharCount, k: doc.const.charRecruitTimes ?? 0, c: doc.const.charRecruitChoiceCount ?? 0 })}</li>}
          {doc.const.assistCharLimit != null && <li>{t("지원 오퍼 {n}명까지", { n: doc.const.assistCharLimit })}</li>}
          {doc.const.subCardObtainDesc && <li>{doc.const.subCardObtainDesc}</li>}
          {doc.const.lowerItemId && (
            <li>{t("모듈 강화 데이터 상한")} — {reward([[doc.const.lowerItemId, doc.const.lowerItemLimit ?? 0], ...(doc.const.higherItemId ? [[doc.const.higherItemId, doc.const.higherItemLimit ?? 0] as [string, number]] : [])])}</li>
          )}
        </ul>
      </section>

      {/* ── 맵 창 ── */}
      {pick && (() => {
        const info = doc.info[pick];
        const total = doc.towers[pick]?.[2] ?? 0;
        const num = /^tower_n_(\d+)$/.exec(pick)?.[1];
        const bg = towerBg(pick);
        const my = mine?.maps[pick];
        const boss = info?.boss ? enMap?.get(info.boss) : null;
        return (
          <ModalWindow label={name(pick)} className="operator-modal sss-modal" onClose={() => setPick(null)}>
            <div className="sss-map">
              {bg && <img className="sss-map-bg" src={bg} alt="" />}
              <h3>{name(pick)}{doc.towers[pick]?.[1] && <small> · {doc.towers[pick][1]}</small>}{openMaps.has(pick) && <i className="sss-open">{t("이번 시즌")}</i>}</h3>
              {info?.desc && <p className="sss-desc">{info.desc}</p>}
              {(info?.danger || info?.hardDesc) && <p className="sss-danger">{[info.danger, info.hardDesc].filter(Boolean).join("\n")}</p>}
              {my && <p className="sss-note">{t("내 기록 — 일반 {a}/{n} · 긴급 {b}/{n}", { a: my[0], b: my[1], n: total })}</p>}
              {boss && (
                <button type="button" className="sss-boss" onClick={() => openEnemy(boss.id)}>
                  <img src={enemyImg(boss.id)} alt="" width={40} height={40} loading="lazy" /><span><small>{t("보스")}</small><b>{boss.name}</b></span>
                </button>
              )}
              <h4>{t("층별 작전 · 첫 클리어 보상")}</h4>
              <ul className="sss-floors">
                {Array.from({ length: total }, (_, f) => {
                  const sid = info?.levels[f] ?? (num ? `lt_${num}_${String(f + 1).padStart(2, "0")}` : "");
                  const st = stages?.stages.find((x) => x.id === sid);
                  const task = info?.tasks.find((x) => x[0] === f + 1);
                  return (
                    <li key={sid || f}>
                      <button type="button" onClick={() => sid && openStage(sid)} disabled={!st}>
                        <b>{t("{n}층", { n: f + 1 })}</b><span>{st?.name ?? sid}</span>
                      </button>
                      {task && reward(task[1])}
                    </li>
                  );
                })}
              </ul>
              {info?.card && <><h4>{t("맵 리더 카드")}</h4>{card(info.card)}</>}
              {info?.curses.length ? (
                <>
                  <h4>{t("저주 카드")}</h4>
                  <ul className="sss-curses">{info.curses.map((c) => <li key={c}><b>{doc.curses[c]?.[0] ?? c}</b><span>{doc.curses[c]?.[1]}</span></li>)}</ul>
                </>
              ) : null}
              {doc.medals[pick] && (
                <>
                  <h4>{t("훈장")}</h4>
                  <ul className="sss-medals">
                    {(["clear", "hard", "hidden"] as const).map((k) => {
                      const md = doc.medals[pick][k];
                      if (!md) return null;
                      return (
                        <li key={k} className={mine ? (got.has(md[0]) ? "got" : "no") : undefined}>
                          <i>{t(MEDAL_LABEL[k])}</i><b>{md[1]}</b><span>{k === "hidden" ? t("일반 모드를 재시도 없이 끝까지") : md[2]}</span>
                          {mine && <em>{got.has(md[0]) ? t("획득") : t("미획득")}</em>}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </ModalWindow>
        );
      })()}
      {openItem && items && (
        <ModalWindow label={openItem.n} className="item-modal it-modal" onClose={() => setOpenItem(null)}>
          <ItemFile item={openItem} doc={items} onOpenStage={openStage} />
        </ModalWindow>
      )}
      {subStage && (
        <ModalWindow key={`st-${stageRaise}`} label={`${subStage.stage.code} ${subStage.stage.name}`} className="operator-modal st-modal" onClose={() => setSubStage(null)}>
          <StageFile view={subStage} onOpenEnemy={openEnemy} onOpenItem={(id) => { const i = itemById.get(id); if (i) setOpenItem(i); }} />
        </ModalWindow>
      )}
      {subEnemy && (
        <ModalWindow key={`en-${enemyRaise}`} label={subEnemy.name} className="operator-modal en-modal" onClose={() => setSubEnemy(null)}>
          <EnemyFile enemy={subEnemy} stagesDoc={enStages} onOpenEnemy={openEnemy} nameOf={(id) => enMap?.get(id)?.name} onOpenStage={openStage} />
        </ModalWindow>
      )}
    </div>
  );
}

function MapTile({ id, doc, open, mine, got, onPick }: {
  id: string; doc: TowerDoc; open: boolean; mine: { maps: Record<string, [number, number, number, number]> } | null; got: Set<string>; onPick: (id: string) => void;
}) {
  const { t } = useI18n();
  const bg = towerBg(id);
  const [nm, sub, total, hard] = doc.towers[id] ?? [id, "", 0, 0];
  const my = mine?.maps[id];
  return (
    <li className={`${bg ? "has-bg" : ""}${open ? " open" : ""}`} style={bg ? { ["--bg" as string]: `url(${bg})` } : undefined}>
      <button type="button" onClick={() => onPick(id)}>
        {open && <i className="sss-open">{t("이번 시즌")}</i>}
        <b>{nm}</b>
        {sub && <small>{sub}</small>}
        <span>{t("{n}층", { n: total })}{hard ? ` · ${t("긴급 보급")}` : ""}</span>
        {my && <span className="mine">{t("내 기록")} {my[0]}/{total}{hard ? ` · ${t("긴급")} ${my[1]}/${total}` : ""}</span>}
        {mine && doc.medals[id] && (
          <span className="sss-chips">
            {(["clear", "hard", "hidden"] as const).map((k) => {
              const md = doc.medals[id][k];
              return md ? <i key={k} className={got.has(md[0]) ? "got" : undefined} title={md[1]}>{t(MEDAL_LABEL[k])}</i> : null;
            })}
          </span>
        )}
      </button>
    </li>
  );
}
