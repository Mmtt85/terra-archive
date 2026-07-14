"use client";

// AI 스토리 요약 탭.
// 이벤트 목록·썸네일은 scripts/build-story.py가 생성하는 app/data/stories.json,
// 요약 본문은 AI(Claude)가 스토리 스크립트를 정독하고 집필하는 app/data/story-summaries.json.
// 요약이 있는 이벤트만 카드가 열리고, 상세는 #story-<id> 해시로 공유·뒤로가기 가능.
import { useEffect, useMemo, useState } from "react";
import storiesData from "./data/stories.json";
import summariesData from "./data/story-summaries.json";
import { rich, useI18n, type Locale } from "./i18n";

type LocText = { ko: string; en?: string; ja?: string };
type StoryEvent = { id: string; name: LocText; start: string; episodes: number; thumb: string };
type Block =
  | { t: "h"; x: string }
  | { t: "p"; x: string }
  | { t: "img"; src: string; cap?: string }
  | { t: "quote"; who: string; x: string };
type Summary = { tagline: string; blocks: Block[] };

const data = storiesData as { updated: string; events: StoryEvent[] };
const summaries = summariesData as Record<string, Summary>;

function locText(locale: Locale, text: LocText): string {
  return (locale === "ko" ? text.ko : text[locale]) ?? text.ko;
}

function eventFromHash(): StoryEvent | null {
  const hash = decodeURIComponent(window.location.hash);
  if (!hash.startsWith("#story-")) return null;
  const id = hash.slice(7);
  return data.events.find((event) => event.id === id && summaries[id]) ?? null;
}

export default function StoryGuide() {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<StoryEvent | null>(null);

  // #story-<id> 해시와 동기화 — 새로고침·공유·뒤로가기 모두 동작
  useEffect(() => {
    const apply = () => setSelected(eventFromHash());
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const open = (event: StoryEvent) => {
    window.location.assign(`#story-${event.id}`);
  };
  const close = () => {
    window.location.assign("#story");
  };

  useEffect(() => {
    if (selected) window.scrollTo({ top: 0 });
  }, [selected]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return data.events;
    return data.events.filter((event) =>
      [event.name.ko, event.name.en, event.name.ja].filter(Boolean).join(" ").toLowerCase().includes(keyword));
  }, [query]);

  const summarized = data.events.filter((event) => summaries[event.id]).length;

  if (selected) {
    const summary = summaries[selected.id];
    return (
      <section className="story story-detail" aria-label={locText(locale, selected.name)}>
        <button type="button" className="story-back" onClick={close}>← {t("스토리 목록으로")}</button>
        <header className="story-detail-head">
          <span className="section-no">AI STORY DIGEST</span>
          <h2>{locText(locale, selected.name)}</h2>
          <p className="story-meta">{selected.start} · {t("에피소드 {n}개", { n: selected.episodes })}</p>
          <p className="story-tagline">{summary.tagline}</p>
          <p className="story-disclaimer">{t("이 요약은 AI(Claude)가 게임 내 스토리 스크립트 전문을 읽고 쓴 2차 창작 요약입니다. 결말까지 전부 스포일러하며, 원문의 유머와 온도를 살리려 약간의 익살이 섞여 있습니다.")}</p>
          {locale !== "ko" && <p className="story-disclaimer">{t("요약 본문은 현재 한국어로만 제공됩니다.")}</p>}
        </header>
        <div className="story-body">
          {summary.blocks.map((block, index) => {
            if (block.t === "h") return <h3 key={index}>{block.x}</h3>;
            if (block.t === "img")
              return (
                <figure key={index}>
                  <img src={block.src} alt={block.cap ?? ""} loading="lazy" decoding="async" />
                  {block.cap && <figcaption>{block.cap}</figcaption>}
                </figure>
              );
            if (block.t === "quote")
              return (
                <blockquote key={index}>
                  <p>{rich(block.x)}</p>
                  <cite>— {block.who}</cite>
                </blockquote>
              );
            return <p key={index}>{rich(block.x)}</p>;
          })}
        </div>
        <footer className="story-detail-foot">
          <button type="button" className="story-back" onClick={close}>← {t("스토리 목록으로")}</button>
        </footer>
      </section>
    );
  }

  return (
    <section className="story" aria-label={t("AI 스토리 요약")}>
      <div className="story-head">
        <span className="section-no">AI STORY DIGEST</span>
        <h2>{t("AI 스토리 요약")}</h2>
        <p>{t("한국 서버에 풀린 사이드 스토리 {count}개의 아카이브입니다. AI(Claude)가 스토리 스크립트 전문을 정독하고 컷씬과 함께 10분 분량으로 요약합니다. 현재 {done}개 수록 — 계속 추가됩니다.", { count: data.events.length, done: summarized })}</p>
        <p className="story-source">{t("요약에는 결말 포함 스포일러가 있습니다. 이벤트 제목·썸네일 출처: 게임 데이터 · {date} 기준.", { date: data.updated })}</p>
      </div>

      <div className="story-tools">
        <div className="search-wrap story-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("이벤트 이름 검색")} aria-label={t("이벤트 이름 검색")} /></div>
      </div>

      {visible.length === 0 ? (
        <p className="recruit-empty">{t("조건에 맞는 이벤트가 없어요.")}</p>
      ) : (
        <div className="story-grid">
          {visible.map((event) => {
            const ready = Boolean(summaries[event.id]);
            return (
              <article key={event.id} className={`story-card${ready ? "" : " pending"}`}>
                <button type="button" onClick={() => ready && open(event)} disabled={!ready}
                  aria-label={locText(locale, event.name)}>
                  <div className="story-thumb">
                    <img src={event.thumb} alt="" loading="lazy" decoding="async" />
                    {ready
                      ? <em className="story-ready-badge">{t("AI 요약")}</em>
                      : <em className="story-pending-badge">{t("요약 준비 중")}</em>}
                  </div>
                  <div className="story-card-info">
                    <h3>{locText(locale, event.name)}</h3>
                    <span>{event.start} · {t("에피소드 {n}개", { n: event.episodes })}</span>
                  </div>
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
