"use client";

// 이벤트 기록 — 한정 이벤트의 미니게임·수집 요소로 풀리는 읽을거리 (사용자 제보 2026-08-22:
// "중생의 여정에서 미니게임으로 등장인물 과거사를 해금하는 글이 있었는데 아카이브 가능한가요.
//  다른 한정 이벤트들도 이런 게 있었던 것 같은데 같이").
//
// 본편 스토리(스토리 요약 탭)와는 별개다 — 이쪽은 story_review_table이 아니라
// activity_table 안에 흩어져 있던 의뢰서·신문·편지·평론·조우문이라, 이벤트가 끝나면
// 게임에서도 다시 볼 수 없다. 데이터는 scripts/build-eventlore.py가 3로케일로 낸다.
//
// 화면 규약: 다른 가이드와 같은 「카드 목록 → 클릭하면 상세 모달」. 항목이 300개를 넘는
// 이벤트(스툴티페라 나비스)가 있어 모달 안에 섹션 탭과 검색을 둔다.

import { useMemo, useState } from "react";
import { useI18n, rich } from "./i18n";
import { ModalWindow } from "./modal-window";
import { asset } from "./assets";

export type LoreItem = { t?: string; by?: string; tag?: string; d?: string; d2?: string };
export type LoreSec = { n: string; items: LoreItem[] };
export type LoreEvent = { id: string; n: string; mini?: string; note?: string; thumb?: string; start?: string; secs: LoreSec[] };
export type LoreDoc = { events: LoreEvent[] };

const countOf = (e: LoreEvent) => e.secs.reduce((a, s) => a + s.items.length, 0);
const hideErr = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.visibility = "hidden"; };

export default function EventLore({ doc }: { doc: LoreDoc }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<LoreEvent | null>(null);
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");

  const total = useMemo(() => doc.events.reduce((a, e) => a + countOf(e), 0), [doc]);

  const openEvent = (e: LoreEvent) => { setOpen(e); setTab(0); setQ(""); };

  const sec = open?.secs[Math.min(tab, open.secs.length - 1)];
  const shown = useMemo(() => {
    if (!sec) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return sec.items;
    return sec.items.filter((it) =>
      [it.t, it.by, it.tag, it.d, it.d2].some((v) => v && v.toLowerCase().includes(needle)));
  }, [sec, q]);

  return (
    <div className="el-wrap">
      <p className="story-source">
        {t("이벤트를 진행하면서 미니게임·수집 요소로 하나씩 풀리는 글입니다 — 의뢰서, 신문 기사, 편지, 오페라 평론처럼 본편 스토리에는 없고 이벤트가 끝나면 게임에서도 다시 볼 수 없는 것들입니다. 현재 {n}개 이벤트 · 글 {m}편.",
          { n: doc.events.length, m: total })}
      </p>

      <div className="el-cards">
        {doc.events.map((e) => (
          <button key={e.id} type="button" className="el-card" onClick={() => openEvent(e)}>
            <span className="el-thumb">
              {e.thumb
                ? <img src={asset(e.thumb)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                : <em aria-hidden>◆</em>}
            </span>
            <span className="el-card-body">
              <b>{e.n}</b>
              <span className="el-card-meta">
                {e.mini && <i className="sb-chip">{e.mini}</i>}
                {e.start && <i className="sb-dim">{e.start}</i>}
              </span>
              {e.note && <span className="el-note">{e.note}</span>}
              <span className="el-count">{t("글 {n}편", { n: countOf(e) })}</span>
            </span>
          </button>
        ))}
      </div>

      {open && (
        <ModalWindow label={open.n} className="operator-modal el-modal" onClose={() => setOpen(null)}>
          <div className="el-modal-head">
            <h3>{open.n}</h3>
            {open.mini && <i className="sb-chip">{open.mini}</i>}
          </div>
          {open.note && <p className="el-note big">{open.note}</p>}

          {open.secs.length > 1 && (
            <div className="el-subtabs" role="tablist" aria-label={open.n}>
              {open.secs.map((s, i) => (
                <button key={s.n} type="button" role="tab" aria-selected={i === tab}
                  className={i === tab ? "on" : ""} onClick={() => { setTab(i); setQ(""); }}>
                  {s.n}<i>{s.items.length}</i>
                </button>
              ))}
            </div>
          )}

          {(sec?.items.length ?? 0) > 12 && (
            <input className="el-search" type="search" value={q} onChange={(ev) => setQ(ev.target.value)}
              placeholder={t("이 목록에서 검색")} aria-label={t("이 목록에서 검색")} />
          )}

          {q && <p className="sb-dim el-hits">{t("{n}편", { n: shown.length })}</p>}

          <div className="el-entries">
            {shown.map((it, i) => (
              <article key={i} className="el-entry">
                {(it.t || it.by || it.tag) && (
                  <header>
                    {it.t && <b>{it.t}</b>}
                    {it.by && <i className="sb-chip">{it.by}</i>}
                    {it.tag && <i className="el-tag">{it.tag}</i>}
                  </header>
                )}
                {it.d && <p className="el-body">{rich(it.d)}</p>}
                {it.d2 && (
                  <div className="el-unlock">
                    <span className="el-unlock-cap">{t("해금")}</span>
                    <p className="el-body">{rich(it.d2)}</p>
                  </div>
                )}
              </article>
            ))}
            {shown.length === 0 && <p className="sb-dim">{t("찾는 글이 없습니다.")}</p>}
          </div>
        </ModalWindow>
      )}
    </div>
  );
}
