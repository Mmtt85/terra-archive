"use client";

// AI 스토리 요약 탭.
// 이벤트 목록·썸네일은 scripts/build-story.py가 생성하는 app/data/stories.json,
// 요약 본문은 AI(Claude)가 스토리 스크립트를 정독하고 집필하는 app/data/story-summaries.json.
// 요약이 있는 이벤트만 카드가 열리고, 상세는 #story-<id> 해시로 공유·뒤로가기 가능.
// 상세를 읽는 동안, 화면에 보이는 문단에 언급된 인물·용어 카드가 오른쪽 레일에
// 따라다니며 떠오른다 (IntersectionObserver — 넓은 화면 전용, 좁은 화면은 상단 갤러리).
import { useEffect, useMemo, useRef, useState } from "react";
import storiesData from "./data/stories.json";
import summariesData from "./data/story-summaries.json";
import { rich, useI18n, type Locale } from "./i18n";

type LocText = { ko: string; en?: string; ja?: string };
type StoryEvent = { id: string; name: LocText; start: string; episodes: number; thumb: string; thumbEn?: string; thumbJa?: string };
type Block =
  | { t: "h"; x: string }
  | { t: "p"; x: string }
  | { t: "img"; src: string; cap?: string }
  | { t: "quote"; who: string; x: string };
type Entity = { name: string; desc: string; img?: string; alias?: string[]; op?: string };
type Summary = { tagline: string; chars?: Entity[]; terms?: Entity[]; blocks: Block[] };

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

function blockText(block: Block): string {
  if (block.t === "img") return block.cap ?? "";
  if (block.t === "quote") return `${block.who} ${block.x}`;
  return block.x;
}

// 세로 중앙 정렬 스택이 일반 노트북 뷰포트(~800px)를 넘지 않는 개수
const MAX_RAIL_CARDS = 4;

// 요약 상세 — 본문 + 스크롤 추적 참조 레일
function StoryDetail({ event, summary, onClose, onShowOperator }: {
  event: StoryEvent; summary: Summary; onClose: () => void; onShowOperator?: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState<Set<number>>(new Set());

  // 인물이 용어보다 먼저 뜨도록 chars → terms 순으로 합친다
  const entities = useMemo<Entity[]>(
    () => [...(summary.chars ?? []), ...(summary.terms ?? [])],
    [summary],
  );

  // 블록별로 언급된 엔티티 인덱스를 미리 계산 (단순 부분 문자열 매칭)
  const mentions = useMemo(
    () =>
      summary.blocks.map((block) => {
        const text = blockText(block);
        const found: number[] = [];
        entities.forEach((entity, index) => {
          if ([entity.name, ...(entity.alias ?? [])].some((key) => text.includes(key))) found.push(index);
        });
        return found;
      }),
    [summary, entities],
  );

  // 화면(읽는 영역)에 들어온 블록 추적
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setInView((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.idx);
            if (entry.isIntersecting) next.add(index);
            else next.delete(index);
          }
          return next;
        });
      },
      // 화면 상단 10%~하단 35%를 '읽는 중' 영역으로 취급
      { rootMargin: "-10% 0px -35% 0px" },
    );
    root.querySelectorAll<HTMLElement>("[data-idx]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [summary]);

  // 지금 보이는 블록들에 언급된 엔티티 — 본문 등장 순서 유지, 상한 개수 제한
  const active = useMemo(() => {
    const order: number[] = [];
    [...inView]
      .sort((a, b) => a - b)
      .forEach((blockIndex) => {
        for (const entityIndex of mentions[blockIndex] ?? []) {
          if (!order.includes(entityIndex)) order.push(entityIndex);
        }
      });
    return order.slice(0, MAX_RAIL_CARDS);
  }, [inView, mentions]);

  return (
    <section className="story story-detail" aria-label={locText(locale, event.name)}>
      <div className="story-detail-inner">
        <button type="button" className="story-back" onClick={onClose}>← {t("스토리 목록으로")}</button>
        <header className="story-detail-head">
          <span className="section-no">AI STORY DIGEST</span>
          <h2>{locText(locale, event.name)}</h2>
          <p className="story-meta">{event.start} · {t("에피소드 {n}개", { n: event.episodes })}</p>
          <p className="story-tagline">{summary.tagline}</p>
          <p className="story-disclaimer">{t("이 요약은 AI가 게임 내 스토리 스크립트 전문을 읽고 쓴 2차 창작 요약입니다.")}</p>
          {locale !== "ko" && <p className="story-disclaimer">{t("요약 본문은 현재 한국어로만 제공됩니다.")}</p>}
        </header>
        <div className="story-detail-grid">
          <div className="story-body" ref={bodyRef}>
            {summary.blocks.map((block, index) => {
              if (block.t === "h") return <h3 key={index} data-idx={index}>{block.x}</h3>;
              if (block.t === "img")
                return (
                  <figure key={index} data-idx={index}>
                    <img src={block.src} alt={block.cap ?? ""} loading="lazy" decoding="async" />
                    {block.cap && <figcaption>{block.cap}</figcaption>}
                  </figure>
                );
              if (block.t === "quote")
                return (
                  <blockquote key={index} data-idx={index}>
                    <p>{rich(block.x)}</p>
                    <cite>— {block.who}</cite>
                  </blockquote>
                );
              return <p key={index} data-idx={index}>{rich(block.x)}</p>;
            })}
          </div>
          <aside className="story-rail" aria-label={t("등장인물")}>
            {active.map((entityIndex) => {
              const entity = entities[entityIndex];
              const linked = Boolean(entity.op && onShowOperator);
              return (
                <div className={`rail-card${linked ? " op-linked" : ""}`} key={entity.name}
                  onClick={linked ? () => onShowOperator!(entity.op!) : undefined}
                  role={linked ? "button" : undefined} tabIndex={linked ? 0 : undefined}
                  onKeyDown={linked ? (keyEvent) => { if (keyEvent.key === "Enter") onShowOperator!(entity.op!); } : undefined}
                  title={linked ? t("오퍼레이터 정보 보기") : undefined}>
                  {entity.img && (
                    <div className="cast-img"><img src={entity.img} alt="" loading="lazy" decoding="async" /></div>
                  )}
                  <div className="rail-card-text"><b>{entity.name}{linked && <i className="op-mark" aria-hidden>↗</i>}</b><span>{entity.desc}</span></div>
                </div>
              );
            })}
          </aside>
        </div>
        <footer className="story-detail-foot">
          <button type="button" className="story-back" onClick={onClose}>← {t("스토리 목록으로")}</button>
        </footer>
      </div>
    </section>
  );
}

export default function StoryGuide({ onShowOperator }: { onShowOperator?: (id: string) => void }) {
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
    return <StoryDetail event={selected} summary={summaries[selected.id]} onClose={close} onShowOperator={onShowOperator} />;
  }

  return (
    <section className="story" aria-label={t("AI 이벤트 스토리 요약")}>
      <div className="story-head">
        <span className="section-no">AI STORY DIGEST</span>
        <h2>{t("AI 이벤트 스토리 요약")}</h2>
        <p>{t("한국 서버에 풀린 사이드 스토리 {count}개의 아카이브입니다. AI가 스토리 스크립트 전문을 정독하고 컷씬과 함께 10분 분량으로 요약합니다. 현재 {done}개 수록 — 계속 추가됩니다.", { count: data.events.length, done: summarized })}</p>
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
                    <img src={(locale === "ja" ? event.thumbJa : locale === "en" ? event.thumbEn : undefined) ?? event.thumb} alt="" loading="lazy" decoding="async" />
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
