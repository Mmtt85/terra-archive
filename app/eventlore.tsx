"use client";

// 이벤트 기록 — 한정 이벤트의 미니게임·수집 요소로 풀리는 읽을거리 (사용자 제보 2026-08-22:
// "중생의 여정에서 미니게임으로 등장인물 과거사를 해금하는 글이 있었는데 아카이브 가능한가요.
//  다른 한정 이벤트들도 이런 게 있었던 것 같은데 같이").
//
// 본편 스토리와는 출처가 다르다 — story_review_table이 아니라 activity_table 안에 흩어져
// 있던 의뢰서·신문·편지·평론·조우문이라, 이벤트가 끝나면 게임에서도 다시 볼 수 없다.
//
// ⚠ 화면 규약(사용자 확정 2026-08-23): **스토리 탭에 따로 빼지 않는다.** 처음엔 /stories#lore
//   독립 탭이었지만, 이 글들은 결국 그 이벤트의 읽을거리라 스토리 상세의 세 번째 보기
//   (전문 / AI 요약 / 이벤트 기록)로 들어간다. 그래서 이 컴포넌트는 **이벤트 하나**만 그리고,
//   데이터도 전문 스크립트처럼 public/lore/data/<스토리id>.json 을 그때 받아 온다.

import { useMemo, useState } from "react";
import { useI18n, rich } from "./i18n";
import { asset } from "./assets";

/** 본문에 사진이 끼어 있는 글(신문 기사)은 문단·사진 순서를 그대로 담는다 — p=문단, i=사진 */
export type LoreBlock = { p?: string; i?: string };
export type LoreItem = { t?: string; by?: string; tag?: string; d?: string; d2?: string; img?: string; face?: string; blocks?: LoreBlock[] };
export type LoreSec = { n: string; items: LoreItem[] };
export type LoreEvent = { id: string; n: string; mini?: string; note?: string; thumb?: string; start?: string; secs: LoreSec[] };

const hideErr = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.visibility = "hidden"; };

export default function EventLore({ doc, error }: { doc: LoreEvent | null; error?: boolean }) {
  const { t } = useI18n();
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");

  const sec = doc?.secs[Math.min(tab, doc.secs.length - 1)];
  const shown = useMemo(() => {
    if (!sec) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return sec.items;
    return sec.items.filter((it) =>
      [it.t, it.by, it.tag, it.d, it.d2].some((v) => v && v.toLowerCase().includes(needle)));
  }, [sec, q]);

  if (error) return <p className="sb-dim el-loading">{t("이벤트 기록을 불러오지 못했습니다.")}</p>;
  if (!doc) return <p className="sb-dim el-loading">{t("불러오는 중…")}</p>;

  return (
    <div className="el-wrap">
      <p className="story-disclaimer">
        {t("이벤트를 진행하면서 미니게임·수집 요소로 하나씩 풀리던 글입니다 — 본편 스토리에는 없고, 이벤트가 끝나면 게임에서도 다시 볼 수 없습니다.")}
      </p>
      <div className="el-head">
        {doc.mini && <i className="sb-chip">{doc.mini}</i>}
        <b>{t("글 {n}편", { n: doc.secs.reduce((a, s) => a + s.items.length, 0) })}</b>
      </div>
      {doc.note && <p className="el-note big">{doc.note}</p>}

      {doc.secs.length > 1 && (
        <div className="el-subtabs" role="tablist" aria-label={doc.n}>
          {doc.secs.map((s, i) => (
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
          <article key={i} className={`el-entry${it.img ? " has-img" : ""}`}>
            {/* 물건 그림은 글의 장식이 아니라 **그 기억을 불러온 물건**이다 (중생의 여정) —
                글 옆에 흘려 두고, 글이 짧으면 자연스럽게 아래로 감긴다. */}
            {it.img && <img className="el-img" src={asset(it.img)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />}
            {(it.t || it.by || it.tag || it.face) && (
              <header>
                {it.face && <img className="el-face" src={asset(it.face)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />}
                {it.t && <b>{it.t}</b>}
                {it.by && <i className="sb-chip">{it.by}</i>}
                {/* 해금 조건·효과 문구에도 게임 마크업(**강조**)이 섞여 있다 — 그대로 두면
                    별표가 날것으로 보인다 (재건 계획 지형 효과에서 실측 2026-08-23) */}
                {it.tag && <i className="el-tag">{rich(it.tag)}</i>}
              </header>
            )}
            {it.d && <p className="el-body">{rich(it.d)}</p>}
            {/* 신문 기사처럼 본문에 사진이 끼는 글 — 원문이 사진 위치를 갖고 있어 그대로 따른다
                (사용자 지적 2026-08-23: "<newsimg>…</newsimg> 이런 식으로 나와 있는 부분이
                 아마 이미지가 나와야 하는 부분일 듯"). */}
            {it.blocks && (
              <div className="el-article">
                {it.blocks.map((b, j) => b.i
                  ? <img key={j} className="el-inline-img" src={asset(b.i)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                  : <p key={j} className="el-body">{rich(b.p ?? "")}</p>)}
              </div>
            )}
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
    </div>
  );
}
