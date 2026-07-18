"use client";

// AI 스토리 요약 탭.
// 이벤트 목록·썸네일은 scripts/build-story.py가 생성하는 app/data/stories.json,
// 요약 본문은 AI(Claude)가 스토리 스크립트를 정독하고 집필하는 app/data/story-summaries.json.
// 요약이 있는 이벤트만 카드가 열리고, 상세는 #story-<id> 해시로 공유·뒤로가기 가능.
// 상세를 읽는 동안, 화면에 보이는 문단에 언급된 인물·용어 카드가 오른쪽 레일에
// 따라다니며 떠오른다 (IntersectionObserver — 넓은 화면 전용, 좁은 화면은 상단 갤러리).
import { useEffect, useMemo, useRef, useState } from "react";
import storiesData from "./data/stories.json";
// 요약 본문은 로케일별(story-summaries.{en,ja}.json)로 갈라져 있어 Home이 활성 로케일 것을
// prop으로 내려준다. 모듈 레벨(합성 이벤트·해시 확인)은 콘텐츠가 아니라 "요약이 있는 id"만
// 필요하므로 가벼운 id 목록만 정적 import 한다 (로케일 무관 — /en /ja 번들에 KO 본문 미포함).
import summaryIdsData from "./data/story-summary-ids.json";
import chronologyData from "./data/chronology.json";
import imageDimsData from "./data/story-image-dims.json";
import { rich, useI18n, type Locale } from "./i18n";
import { normSearch } from "./search";

// CG·삽화의 실측 크기 (scripts/measure-story-images.py) — width/height를 박아 로딩 중
// 레이아웃 밀림(CLS)을 없앤다. 브라우저가 렌더 폭에 맞춰 높이를 미리 예약한다.
const imageDims = imageDimsData as Record<string, [number, number]>;

type LocText = { ko: string; en?: string; ja?: string };
type StoryEvent = { id: string; name: LocText; start: string; episodes: number; thumb: string; thumbEn?: string; thumbJa?: string; unreleased?: boolean; epNo?: number };
type Block =
  | { t: "h"; x: string }
  | { t: "p"; x: string }
  | { t: "img"; src: string; cap?: string }
  | { t: "quote"; who: string; x: string }
  // 본문 옆에 작게 떠 있는 장식 삽화 (귀여운 조각상 등) — 레일 추적 대상 아님
  | { t: "deco"; src: string; cap?: string; side?: "left" | "right" };
type Entity = { name: string; desc: string; img?: string; alias?: string[]; op?: string };
type Summary = { tagline: string; chars?: Entity[]; terms?: Entity[]; blocks: Block[] };
// 활성 로케일의 요약 모음 — Home이 story-summaries[.en|.ja].json을 골라 내려준다.
export type StorySummaries = Record<string, Summary>;

// 테라 연대기 (app/data/chronology.json — 손수 큐레이트하는 스캐폴드).
type ChronKind = "event" | "main" | "roguelike";
type Arc = { id: string; name: LocText };
type RawEntry = { ref?: string; id?: string; kind: ChronKind; title?: LocText; terraYear?: number | null; arc?: string | null; dateNote?: string };
type Chronology = { note: string; updated?: string; arcs: Arc[]; entries: RawEntry[] };
// 연대기 항목 하나(이벤트 ref는 stories.json에서 이름·썸네일·출시월을 끌어온다)
type ChronItem = { key: string; kind: ChronKind; name: LocText; start?: string; thumb?: string; thumbEn?: string; thumbJa?: string; terraYear: number | null; arc: string | null; eventId?: string; dateNote?: string; epNo?: number; ep?: LocText };

const data = storiesData as { updated: string; events: StoryEvent[] };
const summaryIds = new Set(summaryIdsData as string[]);
const chronology = chronologyData as Chronology;

// 메인스토리·로그라이크는 stories.json이 아니라 chronology.json 스캐폴드에만 있다.
// 요약이 달린 항목은 이벤트처럼 열 수 있도록 합성 StoryEvent로 만들어 eventById에 병합한다.
const CHRON_SYNTH: StoryEvent[] = chronology.entries
  .filter((raw) => raw.kind !== "event" && raw.id && summaryIds.has(raw.id))
  .map((raw) => {
    const id = raw.id as string;
    const isMain = /^main_\d+$/.test(id);
    const epNo = isMain ? Number(id.split("_")[1]) : undefined;
    return {
      id,
      name: raw.title ?? { ko: id },
      start: "",
      episodes: 0,
      thumb: `/story/${id}.webp`,
      // 메인스토리만 글로벌·일본판 타이틀카드가 있다. 로그라이크는 KR 키비주얼로 폴백.
      ...(isMain ? { thumbEn: `/story/en/${id}.webp`, thumbJa: `/story/ja/${id}.webp` } : {}),
      epNo,
    };
  });
const eventById = new Map<string, StoryEvent>(
  [...data.events, ...CHRON_SYNTH].map((event) => [event.id, event]),
);

function locText(locale: Locale, text: LocText): string {
  return (locale === "ko" ? text.ko : text[locale]) ?? text.ko;
}

function eventFromHash(): StoryEvent | null {
  const hash = decodeURIComponent(window.location.hash);
  if (!hash.startsWith("#story-")) return null;
  const id = hash.slice(7);
  const ev = eventById.get(id);
  return ev && summaryIds.has(id) ? ev : null;
}

function blockText(block: Block): string {
  if (block.t === "img") return block.cap ?? "";
  if (block.t === "deco") return "";   // 장식 삽화는 레일 매칭 대상 아님
  if (block.t === "quote") return `${block.who} ${block.x}`;
  return block.t === "h" || block.t === "p" ? block.x : "";
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

  // 엔티티별 매칭 정규식 — 이름/별칭 앞에 한글이 오면 제외(negative lookbehind).
  // "이신"이 경어체 "-이신"(선생님이신)에, 짧은 이름이 다른 단어에 부분일치해 레일이
  // 엉뚱하게 뜨던 문제를 막는다. 한국어 조사는 이름 뒤에 붙으므로 뒤쪽은 열어 둔다 (2026-07).
  const matchers = useMemo(
    () =>
      entities.map((entity) => {
        const keys = [entity.name, ...(entity.alias ?? [])]
          .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .sort((a, b) => b.length - a.length);
        return new RegExp(`(?<![가-힣])(?:${keys.join("|")})`);
      }),
    [entities],
  );
  // 블록별로 언급된 엔티티 인덱스를 미리 계산
  const mentions = useMemo(
    () =>
      summary.blocks.map((block) => {
        const text = blockText(block);
        const found: number[] = [];
        matchers.forEach((re, index) => { if (re.test(text)) found.push(index); });
        return found;
      }),
    [summary, matchers],
  );

  // 화면(읽는 영역)에 들어온 블록 추적
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setInView((previous) => {
          const next = new Set(previous);
          let changed = false;
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.idx);
            if (entry.isIntersecting) { if (!next.has(index)) { next.add(index); changed = true; } }
            else if (next.delete(index)) changed = true;
          }
          // 실제 변화가 없으면 이전 Set을 그대로 반환 — 스크롤 중 불필요한 리렌더로
          // 모바일에서 스크롤이 툭툭 끊기던 문제를 막는다 (2026-07)
          return changed ? next : previous;
        });
      },
      // '읽는 중' 영역: 화면 18%~90%. 아래쪽(하단 10% 지점)에서 문단이 나타나면 카드가 뜨고,
      // 위로 스크롤돼 상단 ~18%까지 올라가면(거의 화면 밖) 사라진다. 아래쪽 문단 기준으로 판정.
      { rootMargin: "-18% 0px -10% 0px" },
    );
    root.querySelectorAll<HTMLElement>("[data-idx]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [summary]);

  // 지금 화면(아래 문단 우선)에 언급된 엔티티. 한 번 뜬 카드는 그 문단이 완전히 사라질 때까지
  // 자리를 지켜, 4장 제한 때문에 밀렸다 다시 뜨는 깜빡임을 막는다. 빈 자리엔 아래쪽 새 엔티티를 채운다.
  const [active, setActive] = useState<number[]>([]);
  const [openCard, setOpenCard] = useState<string | null>(null); // 모바일 레일에서 펼친 카드(이름)
  // 펼친 카드 바깥을 누르면 자동으로 접는다
  useEffect(() => {
    if (!openCard) return;
    const onDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".story-rail .rail-card")) setOpenCard(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [openCard]);
  useEffect(() => {
    const ordered: number[] = [];
    [...inView].sort((a, b) => b - a).forEach((blockIndex) => {
      for (const entityIndex of mentions[blockIndex] ?? []) {
        if (!ordered.includes(entityIndex)) ordered.push(entityIndex);
      }
    });
    const present = new Set(ordered);
    setActive((prev) => {
      const next = prev.filter((e) => present.has(e)); // 아직 보이는 카드는 순서 그대로 유지
      for (const e of ordered) {                        // 빈 자리에만 아래쪽 새 엔티티 추가
        if (next.length >= MAX_RAIL_CARDS) break;
        if (!next.includes(e)) next.push(e);
      }
      return next.length === prev.length && next.every((e, i) => e === prev[i]) ? prev : next;
    });
  }, [inView, mentions]);

  return (
    <section className="story story-detail" aria-label={locText(locale, event.name)}>
      {/* 뒤로가기: 넓은 화면에선 왼쪽 여백에 sticky(본문은 위로 올라옴), 좁으면 본문 위 일반 배치 */}
      <div className="story-back-wrap">
        <button type="button" className="story-back story-back-top" onClick={onClose}>← {t("스토리 목록으로")}</button>
      </div>
      <div className="story-detail-inner">
        <header className="story-detail-head">
          <span className="section-no">AI STORY DIGEST</span>
          <h2>{locText(locale, event.name)}</h2>
          <p className="story-meta">{event.epNo != null ? locText(locale, epLabel(event.epNo)) : event.id.startsWith("rogue_") ? t("통합 전략") : `${event.start} · ${t("에피소드 {n}개", { n: event.episodes })}`}</p>
          <p className="story-tagline">{summary.tagline}</p>
          <p className="story-disclaimer">{t("이 요약은 AI가 게임 내 스토리 스크립트 전문을 읽고 쓴 2차 창작 요약입니다.")}</p>
        </header>
        <div className="story-detail-grid">
          <div className="story-body" ref={bodyRef}>
            {summary.blocks.map((block, index) => {
              if (block.t === "h") return <h3 key={index} data-idx={index}>{block.x}</h3>;
              if (block.t === "img") {
                const dim = imageDims[block.src];
                return (
                  <figure key={index} data-idx={index}>
                    <img src={block.src} alt={block.cap ?? ""} loading="lazy" decoding="async"
                      width={dim?.[0]} height={dim?.[1]} />
                    {block.cap && <figcaption>{block.cap}</figcaption>}
                  </figure>
                );
              }
              if (block.t === "quote")
                return (
                  <blockquote key={index} data-idx={index}>
                    <p>{rich(block.x)}</p>
                    <cite>— {block.who}</cite>
                  </blockquote>
                );
              // 장식 삽화 — 본문 옆에 작게 떠 있고 레일 추적(data-idx) 대상은 아니다
              if (block.t === "deco") {
                const dim = imageDims[block.src];
                return (
                  <figure key={index} className={`story-deco story-deco-${block.side ?? "right"}`}>
                    <img src={block.src} alt={block.cap ?? ""} loading="lazy" decoding="async"
                      width={dim?.[0]} height={dim?.[1]} />
                    {block.cap && <figcaption>{block.cap}</figcaption>}
                  </figure>
                );
              }
              return <p key={index} data-idx={index}>{rich(block.x)}</p>;
            })}
          </div>
          <aside className="story-rail" aria-label={t("등장인물")}>
            {active.map((entityIndex) => {
              const entity = entities[entityIndex];
              const linked = Boolean(entity.op && onShowOperator);
              // 전용 스탠딩 CG(img)가 없으면 연결된 오퍼레이터 아바타로 폴백
              const imgSrc = entity.img ?? (entity.op ? `/avatars/${entity.op}.webp` : undefined);
              // 모바일(≤1180px): 스니펫(이름만) → 탭하면 펼쳐 설명 표시, 한 번 더 탭하면 오퍼 상세(있으면)·접기.
              // 데스크탑: 종전대로 카드를 누르면 바로 오퍼 상세.
              const handleClick = () => {
                const mobile = typeof window !== "undefined" && window.matchMedia("(max-width: 1180px)").matches;
                if (mobile) {
                  if (openCard !== entity.name) { setOpenCard(entity.name); return; } // 첫 탭: 펼침
                  if (linked) onShowOperator!(entity.op!);                             // 펼친 카드 재탭: 오퍼 상세 (닫기는 바깥 클릭)
                } else if (linked) {
                  onShowOperator!(entity.op!);
                }
              };
              return (
                <div className={`rail-card${linked ? " op-linked" : ""}${openCard === entity.name ? " open" : ""}`} key={entity.name}
                  onClick={handleClick}
                  role="button" tabIndex={0}
                  onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter") handleClick(); }}
                  title={linked ? t("오퍼레이터 정보 보기") : undefined}>
                  {imgSrc && (
                    <div className={`cast-img${entity.img ? "" : " cast-avatar"}`}><img src={imgSrc} alt="" loading="lazy" decoding="async" /></div>
                  )}
                  <div className="rail-card-text"><b>{entity.name}{linked && <i className="op-mark" aria-hidden>↗</i>}</b><span><span className="rail-desc-full">{entity.desc}</span><span className="rail-desc-snip">{entity.desc.slice(0, 5).trim()}…</span></span></div>
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

// 메인스토리 에피소드 번호 라벨 (KR 존 테이블 표기: 프롤로그 / 에피소드 N, EN Episode, JP 序章·第N章)
const EP_KANJI = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六"];
function epLabel(n: number): LocText {
  if (n === 0) return { ko: "프롤로그", en: "Prologue", ja: "序章" };
  return { ko: `에피소드 ${n}`, en: `Episode ${n}`, ja: `第${EP_KANJI[n] ?? n}章` };
}

// chronology.json 항목 → 표시용 ChronItem (이벤트는 stories.json에서 이름/썸네일/출시월 병합)
function resolveChron(): ChronItem[] {
  return chronology.entries.map((raw, i) => {
    if (raw.kind === "event" && raw.ref) {
      const ev = eventById.get(raw.ref);
      return {
        key: raw.ref, kind: "event",
        name: ev ? ev.name : { ko: raw.ref },
        start: ev?.start, thumb: ev?.thumb,
        terraYear: raw.terraYear ?? null, arc: raw.arc ?? null,
        eventId: ev ? raw.ref : undefined, dateNote: raw.dateNote,
      };
    }
    const isMain = raw.kind === "main" && /^main_\d+$/.test(raw.id ?? "");
    const isRogue = raw.kind === "roguelike" && /^rogue_\d+$/.test(raw.id ?? "");
    const epNo = isMain ? Number((raw.id as string).split("_")[1]) : undefined;
    return {
      key: raw.id ?? `x${i}`, kind: raw.kind,
      name: raw.title ?? { ko: raw.id ?? "?" },
      terraYear: raw.terraYear ?? null, arc: raw.arc ?? null, dateNote: raw.dateNote,
      // 요약이 달린 메인스토리·로그라이크는 열 수 있게 eventId를 부여 (합성 이벤트와 매칭)
      eventId: raw.id && summaryIds.has(raw.id) ? raw.id : undefined,
      epNo,
      ep: epNo != null ? epLabel(epNo) : undefined,
      // 메인: 한국판/글로벌/일본 타이틀카드. 로그라이크: 키 비주얼(로케일 공용).
      thumb: isMain ? `/story/${raw.id}.webp` : isRogue ? `/story/${raw.id}.webp` : undefined,
      thumbEn: isMain ? `/story/en/${raw.id}.webp` : undefined,
      thumbJa: isMain ? `/story/ja/${raw.id}.webp` : undefined,
    };
  });
}
const CHRON_ITEMS = resolveChron();

// arc 색상 팔레트 (id 순환) + 종류 라벨
const ARC_COLORS = ["#c2410c", "#0369a1", "#7c3aed", "#b45309", "#be123c", "#0f766e", "#4d7c0f", "#a16207"];
const arcColor = (arcId: string) => {
  const idx = chronology.arcs.findIndex((a) => a.id === arcId);
  return idx >= 0 ? ARC_COLORS[idx % ARC_COLORS.length] : "#8b9294";
};
const KIND_KO: Record<ChronKind, string> = { event: "이벤트", main: "메인스토리", roguelike: "통합 전략" };
const arcNameOf = (locale: Locale, id: string) => {
  const a = chronology.arcs.find((x) => x.id === id);
  return a ? locText(locale, a.name) : id;
};

// 테라 연대기 뷰 — 한 줄 타임라인 + 연대순(테라력) 그룹. (테마별·종류별은 요약 뷰로 이동)
function ChronologyView({ onOpenEvent }: { onOpenEvent: (eventId: string) => void }) {
  const { locale, t } = useI18n();
  const [tip, setTip] = useState<{ item: ChronItem; x: number; y: number } | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pos, setPos] = useState(0); // 레일 가로 스크롤 진행도 0~1 (슬라이더 썸 위치)
  const arcName = (id: string) => arcNameOf(locale, id);
  const yearLabel = (item: ChronItem) => item.terraYear == null ? t("테라력 미정") : t("테라력 {y}년", { y: item.terraYear });
  const showTip = (e: React.FocusEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>, it: ChronItem) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ item: it, x: r.left + r.width / 2, y: r.top });
  };

  // 연대순(테라력) — 연도 오름차순, 미정은 맨 뒤. 세로 목록(panel)은 미정 그룹까지 전부 담는다.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; year: number | null; sort: number; items: ChronItem[] }>();
    for (const it of CHRON_ITEMS) {
      let k: string, label: string, year: number | null, sort: number;
      if (it.terraYear == null) { k = "__none"; label = t("테라력 미정"); year = null; sort = Infinity; }
      else { k = `y${it.terraYear}`; label = t("테라력 {y}년", { y: it.terraYear }); year = it.terraYear; sort = it.terraYear; }
      if (!map.has(k)) map.set(k, { key: k, label, year, sort, items: [] });
      map.get(k)!.items.push(it);
    }
    return Array.from(map.values()).sort((a, b) => a.sort - b.sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, t]);
  // 레일·슬라이더(연도 타임라인)는 연도 확정분만 — 미정은 타임라인에서 제외한다.
  const yearGroups = useMemo(() => groups.filter((g) => g.year != null), [groups]);

  // 세로 목록(panel)이 스크롤 주체 — 연도 레일과 슬라이더는 목록 스크롤에 동기된다.
  const sliderRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const secRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => { setActiveKey((k) => k ?? groups[0]?.key ?? null); }, [groups]);

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  // 연도 확정 그룹들의 목록 내 세로 위치(offsetTop) 배열
  const yearTops = () => yearGroups.map((g) => secRefs.current.get(g.key)?.offsetTop ?? 0);
  // 목록 스크롤 위치 → 슬라이더 진행도(0~1). 연도 라벨이 균등 배치된 인덱스 공간에 맞춰 보간.
  const posFromScroll = (top: number) => {
    const tops = yearTops(); const n = tops.length;
    if (n <= 1) return 0;
    if (top <= tops[0]) return 0;
    if (top >= tops[n - 1]) return 1;
    let i = 0; for (let k = 0; k < n - 1; k++) if (top >= tops[k]) i = k;
    const t = (top - tops[i]) / ((tops[i + 1] - tops[i]) || 1);
    return clamp01((i + t) / (n - 1));
  };
  // 현재 스크롤이 걸친 그룹 key (미정 포함 전체 그룹 기준)
  const currentKey = () => {
    const c = panelRef.current; if (!c) return null;
    const top = c.scrollTop + 56;
    let best: string | null = null;
    for (const g of groups) {
      const el = secRefs.current.get(g.key); if (!el) continue;
      if (el.offsetTop <= top) best = g.key; else break;
    }
    return best ?? groups[0]?.key ?? null;
  };
  const onPanelScroll = () => {
    const c = panelRef.current; if (!c) return;
    setPos(posFromScroll(c.scrollTop));
    const key = currentKey();
    if (key) setActiveKey((prev) => (key !== prev ? key : prev));
  };
  // 슬라이더 드래그 → 목록을 연도 구간에 맞춰 스크롤 (연도 라벨 균등 간격 기준 보간).
  // 트랙에 포인터를 캡처해 드래그를 안정적으로 추적한다.
  const seekTo = (clientX: number) => {
    const track = sliderRef.current, panel = panelRef.current; if (!track || !panel) return;
    const rect = track.getBoundingClientRect();
    const tops = yearTops(); const n = tops.length; if (!n) return;
    const p = clamp01((clientX - rect.left) / rect.width) * (n - 1);
    const lo = Math.floor(p), hi = Math.min(n - 1, lo + 1);
    const top = tops[lo] + (tops[hi] - tops[lo]) * (p - lo);
    panel.scrollTo({ top, behavior: "auto" });
  };
  const onSliderDown = (e: React.PointerEvent) => {
    const track = sliderRef.current; if (!track) return;
    e.preventDefault(); track.setPointerCapture(e.pointerId); seekTo(e.clientX);
  };
  const onSliderMove = (e: React.PointerEvent) => {
    const track = sliderRef.current;
    if (!track || !track.hasPointerCapture(e.pointerId)) return;
    seekTo(e.clientX);
  };
  const onSliderUp = (e: React.PointerEvent) => {
    const track = sliderRef.current;
    if (track?.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
  };
  // 연도 라벨 클릭 → 그 연도 섹션으로 부드럽게 이동
  const goYear = (key: string) => {
    setActiveKey(key);
    const sec = secRefs.current.get(key);
    if (sec && panelRef.current) panelRef.current.scrollTo({ top: sec.offsetTop, behavior: "smooth" });
  };
  // 양끝 화살표 / 방향키 — 연도 그룹 단위로 이동
  const stepYear = (dir: 1 | -1) => {
    const i = yearGroups.findIndex((g) => g.key === activeKey);
    const cur = i < 0 ? (dir > 0 ? -1 : yearGroups.length) : i;
    const j = Math.min(yearGroups.length - 1, Math.max(0, cur + dir));
    if (yearGroups[j]) goYear(yearGroups[j].key);
  };
  const onThumbKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); stepYear(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); stepYear(1); }
  };
  const setSec = (key: string) => (el: HTMLElement | null) => { if (el) secRefs.current.set(key, el); else secRefs.current.delete(key); };

  const openIf = (it: ChronItem) => { if (it.eventId) onOpenEvent(it.eventId); };

  return (
    <div className="chron">
      <p className="chron-note">{rich(t("**테라 연대기 (베타)** — 모든 이벤트·메인스토리·통합 전략을 한자리에 모으는 사전 작업입니다. 현재 정렬은 출시순(임시)이며, 인게임 연대기 순서·테라력 연도는 스토리 스크립트를 반영하며 채웁니다. 테마 묶음은 확실한 것부터 배정 중입니다."))}</p>

      {/* 한 줄 연혁 바 — 연도 확정분만 100% 폭에 균등 배치(미정 제외). 슬라이더로 아래 목록을 이동. */}
      <div className="chron-railwrap">
        <div className="chron-rail" role="list" aria-label={t("테라 연대기")}
          onMouseLeave={() => setTip(null)}>
          {yearGroups.map((g) => (
            <div key={g.key} className="chron-railseg">
              <button type="button" className={`chron-railseg-yr${activeKey === g.key ? " on" : ""}`}
                onClick={() => goYear(g.key)} title={g.label} aria-label={g.label}>
                {g.year}
              </button>
              <div className="chron-railseg-ticks">
                {g.items.map((it) => (
                  <button key={it.key} type="button" role="listitem"
                    className={`chron-tick k-${it.kind}${it.eventId ? "" : " nolink"}${tip?.item.key === it.key ? " active" : ""}`}
                    style={{ ["--arc" as string]: it.arc ? arcColor(it.arc) : "#c3c6bf" }}
                    onClick={() => openIf(it)}
                    onMouseEnter={(e) => showTip(e, it)} onFocus={(e) => showTip(e, it)} onBlur={() => setTip(null)}
                    aria-label={locText(locale, it.name)}>
                    <span className="chron-tick-dot" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 연대기 슬라이더 — 드래그하면 위 레일과 아래 목록이 함께 이동, 양끝 화살표는 연도 단위 이동 */}
        <div className="chron-slider">
          <button type="button" className="chron-slider-arrow" onClick={() => stepYear(-1)} aria-label={t("이전 연도")}>‹</button>
          <div className="chron-slider-track" ref={sliderRef} onPointerDown={onSliderDown} onPointerMove={onSliderMove} onPointerUp={onSliderUp} onPointerCancel={onSliderUp}>
            <div className="chron-slider-fill" style={{ width: `${pos * 100}%` }} />
            <div className="chron-slider-thumb" style={{ left: `${pos * 100}%` }}
              role="slider" tabIndex={0} aria-label={t("연대기 슬라이더")}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos * 100)}
              onKeyDown={onThumbKey}><span aria-hidden>⇆</span></div>
          </div>
          <button type="button" className="chron-slider-arrow" onClick={() => stepYear(1)} aria-label={t("다음 연도")}>›</button>
        </div>

        <div className="chron-legend">
          <span><i className="lg-dot" /> {t("이벤트")}</span>
          <span><i className="lg-dot lg-main" /> {t("메인스토리")}</span>
          <span><i className="lg-dot lg-rl" /> {t("통합 전략")}</span>
        </div>
      </div>

      {tip && (
        <div className="chron-tip" style={{ left: tip.x, top: tip.y }} aria-hidden>
          <span className="chron-tip-top">
            <em className="chron-kind" style={{ background: tip.item.arc ? arcColor(tip.item.arc) : "#8b9294" }}>{t(KIND_KO[tip.item.kind])}</em>
            {tip.item.arc && <em className="chron-tip-arc" style={{ color: arcColor(tip.item.arc) }}>{arcName(tip.item.arc)}</em>}
          </span>
          <b>{tip.item.ep ? `${locText(locale, tip.item.ep)} · ` : ""}{locText(locale, tip.item.name)}</b>
          <span className="chron-tip-meta">{tip.item.start ?? yearLabel(tip.item)}{tip.item.eventId ? ` · ${t("클릭해서 열기")}` : ""}</span>
        </div>
      )}

      <div className="chron-groups" ref={panelRef} onScroll={onPanelScroll}>
        {groups.map((g) => (
          <section key={g.key} className={`chron-group${activeKey === g.key ? " active" : ""}`} ref={setSec(g.key)}>
            <h3>{g.label} <em>{g.items.length}</em></h3>
            <ul className="chron-list">
              {g.items.map((it) => (
                <li key={it.key}>
                  <button type="button" className={`chron-item k-${it.kind}${it.eventId ? "" : " nolink"}`}
                    onClick={() => openIf(it)} disabled={!it.eventId} title={it.dateNote}>
                    <span className="chron-kind" style={it.arc ? { background: arcColor(it.arc) } : undefined}>{t(KIND_KO[it.kind])}</span>
                    {it.ep && <span className="chron-item-ep">{locText(locale, it.ep)}</span>}
                    <span className="chron-item-name">{locText(locale, it.name)}</span>
                    {it.terraYear != null && <span className="chron-item-year">{t("테라력 {y}년", { y: it.terraYear })}</span>}
                    <span className="chron-item-meta">{it.start ?? "—"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

// 요약 뷰 — 이벤트·메인스토리·로그라이크 카드 그리드 + 검색 + 종류별/테마별 그룹핑(기본 종류별).
// 각 그룹은 최신순(이벤트=출시월, 메인=에피소드 번호). 요약이 있는 이벤트만 열린다.
function DigestView({ onOpen, includeFuture, group, onGroup }: { onOpen: (event: StoryEvent) => void; includeFuture?: boolean; group: "theme" | "kind"; onGroup: (g: "theme" | "kind") => void }) {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false); // 검색창 클릭 시 전체 이벤트 목록 드롭다운
  const searchRef = useRef<HTMLDivElement>(null);

  // 드롭다운: 바깥 클릭·Esc로 닫기
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: MouseEvent) => { if (!searchRef.current?.contains(e.target as Node)) setSearchOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setSearchOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onEsc); };
  }, [searchOpen]);

  // 중섭 선행(미실장) 이벤트 — '미래시 데이터 포함' 체크 시에만 목록에 합류
  // (chronology.json엔 없으므로 stories.json의 unreleased 플래그에서 직접 만든다)
  const allItems = useMemo<ChronItem[]>(() => {
    if (!includeFuture) return CHRON_ITEMS;
    const future = data.events.filter((ev) => ev.unreleased).map<ChronItem>((ev) => ({
      key: ev.id, kind: "event", name: ev.name, start: ev.start, thumb: ev.thumb,
      terraYear: null, arc: null, eventId: ev.id,
    }));
    return [...future, ...CHRON_ITEMS];
  }, [includeFuture]);

  const keyword = normSearch(query);
  const filtered = useMemo(() => {
    if (!keyword) return allItems;
    return allItems.filter((it) =>
      normSearch([it.name.ko, it.name.en, it.name.ja].filter(Boolean).join(" ")).includes(keyword));
  }, [keyword, allItems]);

  // 최신순 정렬: 이벤트는 출시월 내림차순(최신 위), 메인스토리는 에피소드 번호 내림차순
  const recency = (it: ChronItem) => (it.eventId ? eventById.get(it.eventId)?.start : undefined) ?? "";
  const sortItems = (items: ChronItem[]) => [...items].sort((a, b) => {
    // 중섭 선행(미실장)은 아직 KR에 없는 미래분 — CN 출시월이 KR 최신작보다 과거라도 맨 위에 둔다
    const fa = a.eventId && eventById.get(a.eventId)?.unreleased ? 1 : 0;
    const fb = b.eventId && eventById.get(b.eventId)?.unreleased ? 1 : 0;
    if (fa !== fb) return fb - fa;
    const sa = recency(a), sb = recency(b);
    if (sa && sb) { const c = sb.localeCompare(sa); if (c) return c; }
    else if (sa) return -1;
    else if (sb) return 1;
    if (a.epNo != null && b.epNo != null) return b.epNo - a.epNo;
    return b.key.localeCompare(a.key);
  });

  // 테마별(arc) / 종류별(kind) — 각 그룹 내부는 최신순
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; color?: string; sort: number; items: ChronItem[] }>();
    for (const it of filtered) {
      let k: string, label: string, color: string | undefined, sort: number;
      if (group === "theme") {
        k = it.arc ?? "__none"; label = it.arc ? arcNameOf(locale, it.arc) : t("테마 미분류");
        color = it.arc ? arcColor(it.arc) : undefined;
        // 테마 그룹은 arcs 배열(=나무위키 테마) 순서대로, 미분류는 맨 끝
        sort = it.arc ? chronology.arcs.findIndex((a) => a.id === it.arc) : 999;
      } else {
        k = it.kind; label = t(KIND_KO[it.kind]); sort = ["event", "main", "roguelike"].indexOf(it.kind);
      }
      if (!map.has(k)) map.set(k, { key: k, label, color, sort, items: [] });
      map.get(k)!.items.push(it);
    }
    return Array.from(map.values()).sort((a, b) => a.sort - b.sort)
      .map((g) => ({ ...g, items: sortItems(g.items) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, filtered, locale, t]);

  const renderCard = (it: ChronItem) => {
    const ev = it.eventId ? eventById.get(it.eventId) : undefined;
    const ready = Boolean(it.eventId && summaryIds.has(it.eventId));
    const thumb = ev
      ? ((locale === "ja" ? ev.thumbJa : locale === "en" ? ev.thumbEn : undefined) ?? ev.thumb)
      : ((locale === "ja" ? it.thumbJa : locale === "en" ? it.thumbEn : undefined) ?? it.thumb);
    // 메인스토리·로그라이크는 출시월 대신 에피소드 라벨(종류)을 메타로 쓴다
    const meta = it.kind !== "event"
      ? (it.ep ? locText(locale, it.ep) : t(KIND_KO[it.kind]))
      : ev ? `${ev.start} · ${t("에피소드 {n}개", { n: ev.episodes })}`
      : it.ep ? locText(locale, it.ep) : t(KIND_KO[it.kind]);
    return (
      <article key={it.key} className={`story-card${ready ? "" : " pending"}`}>
        <button type="button" onClick={() => { if (ready && ev) onOpen(ev); }} disabled={!ready}
          aria-label={locText(locale, it.name)}>
          <div className={`story-thumb${thumb ? "" : " story-thumb-none"}`}>
            {thumb
              ? <img src={thumb} alt="" loading="lazy" decoding="async" />
              : <span className="story-thumb-kind">{t(KIND_KO[it.kind])}</span>}
            {ready
              ? <em className="story-ready-badge">{t("AI 요약")}</em>
              : <em className="story-pending-badge">{t("요약 준비 중")}</em>}
          </div>
          <div className="story-card-info">
            <h3>{locText(locale, it.name)}{ev?.unreleased && <em className="future-badge">{t("미실장")}</em>}</h3>
            <span>{meta}</span>
          </div>
        </button>
      </article>
    );
  };

  return (
    <>
      <div className="story-tools">
        <div className="search-wrap story-search" ref={searchRef}>
          <span>⌕</span>
          <input value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)} onClick={() => setSearchOpen(true)}
            placeholder={t("이벤트 이름 검색")} aria-label={t("이벤트 이름 검색")}
            role="combobox" aria-expanded={searchOpen} aria-controls="story-search-list" />
          {searchOpen && (
            <ul className="story-search-menu" id="story-search-list" role="listbox">
              {sortItems(filtered).length === 0
                ? <li className="story-search-empty">{t("조건에 맞는 이벤트가 없어요.")}</li>
                : sortItems(filtered).map((it) => {
                    const ev = it.eventId ? eventById.get(it.eventId) : undefined;
                    const ready = Boolean(it.eventId && summaryIds.has(it.eventId));
                    return (
                      <li key={it.key} role="option" aria-selected={false}>
                        <button type="button" className={ready ? "" : "pending"} disabled={!ready}
                          onClick={() => { if (ready && ev) { onOpen(ev); setSearchOpen(false); } }}>
                          <span className="ss-name">{locText(locale, it.name)}{ev?.unreleased && <em className="future-badge">{t("미실장")}</em>}</span>
                          <span className="ss-meta">{ev ? ev.start : t(KIND_KO[it.kind])}{ready ? "" : ` · ${t("요약 준비 중")}`}</span>
                        </button>
                      </li>
                    );
                  })}
            </ul>
          )}
        </div>
        <div className="chron-tabs digest-tabs">
          <button type="button" className={group === "kind" ? "on" : ""} onClick={() => onGroup("kind")}>{t("종류별")}</button>
          <button type="button" className={group === "theme" ? "on" : ""} onClick={() => onGroup("theme")}>{t("테마별")}</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="recruit-empty">{t("조건에 맞는 이벤트가 없어요.")}</p>
      ) : (
        <div className="digest-groups">
          {groups.map((g) => (
            <section key={g.key} className="digest-group">
              <h3 style={g.color ? { borderColor: g.color, color: g.color } : undefined}>{g.label} <em>{g.items.length}</em></h3>
              <div className="story-grid">{g.items.map(renderCard)}</div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

export default function StoryGuide({ summaries, onShowOperator, includeFuture }: { summaries: StorySummaries; onShowOperator?: (id: string) => void; includeFuture?: boolean }) {
  const { t } = useI18n();
  const [view, setView] = useState<"digest" | "chronicle">("digest");
  const [group, setGroup] = useState<"theme" | "kind">("kind");
  const [selected, setSelected] = useState<StoryEvent | null>(null);

  const pushedDetail = useRef(false);
  // 해시 동기화(복붙·공유·뒤로가기): 상세 #story-<id> · 연대기 #chronicle · 테마별 #theme · 종류별 #kind
  useEffect(() => {
    const apply = () => {
      const h = decodeURIComponent(window.location.hash);
      const detail = eventFromHash();
      setSelected(detail);
      if (detail) return;                              // 상세 진입 시 뷰/그룹 상태는 유지
      if (h === "#chronicle") setView("chronicle");
      else if (h === "#theme") { setView("digest"); setGroup("theme"); }
      else if (h === "#kind" || h === "#story" || h === "") { setView("digest"); setGroup("kind"); }
    };
    apply();
    window.addEventListener("hashchange", apply);
    window.addEventListener("popstate", apply);
    return () => { window.removeEventListener("hashchange", apply); window.removeEventListener("popstate", apply); };
  }, []);

  // pushState로 진입 → 홈의 스크롤 매니저가 상세는 top으로, 뒤로가기 시 목록 스크롤을 복구한다
  const open = (event: StoryEvent) => {
    history.pushState(null, "", `#story-${event.id}`);
    pushedDetail.current = true;
    setSelected(event);
  };
  const close = () => {
    if (pushedDetail.current) { pushedDetail.current = false; history.back(); }
    else { window.location.assign("#story"); }  // 딥링크 첫 진입이면 목록으로
  };
  // 연대기에서 이벤트 클릭 → 요약이 있으면 상세로, 없으면 무시
  const openEvent = (eventId: string) => {
    const ev = eventById.get(eventId);
    if (ev && summaryIds.has(eventId)) open(ev);
  };
  // 뷰·그룹 전환을 복붙 가능한 해시로 남긴다 (뒤로가기로 오갈 수 있게 pushState)
  const goView = (v: "digest" | "chronicle") => {
    history.pushState(null, "", v === "chronicle" ? "#chronicle" : (group === "theme" ? "#theme" : "#kind"));
    setView(v);
  };
  const goGroup = (g: "theme" | "kind") => {
    history.pushState(null, "", g === "theme" ? "#theme" : "#kind");
    setView("digest"); setGroup(g);
  };

  useEffect(() => {
    if (selected) window.scrollTo({ top: 0 });
  }, [selected]);

  const summarized = data.events.filter((event) => summaryIds.has(event.id)).length;

  if (selected) {
    return <StoryDetail event={selected} summary={summaries[selected.id]} onClose={close} onShowOperator={onShowOperator} />;
  }

  return (
    <section className="story" aria-label={t("AI 스토리 요약")}>
      <div className="story-head">
        <span className="section-no">AI STORY DIGEST</span>
        <h2>{t("AI 스토리 요약")}</h2>
        <p>{t("한국 서버에 풀린 사이드 스토리 {count}개의 아카이브입니다. AI가 스토리 스크립트 전문을 정독하고 컷씬과 함께 10분 분량으로 요약합니다. 현재 {done}개 수록 — 계속 추가됩니다.", { count: data.events.filter((event) => !event.unreleased).length, done: summarized })}</p>
        <p className="story-source">{t("요약에는 결말 포함 스포일러가 있습니다. 이벤트 제목·썸네일 출처: 게임 데이터 · {date} 기준.", { date: data.updated })}</p>
        {includeFuture && data.events.some((event) => event.unreleased) && (
          <p className="story-source">{t("미실장(중국 서버 선행) 이벤트의 제목은 비공식 AI 번역으로, 한국 서버 정식 출시 시 공식 번역과 다를 수 있습니다.")}</p>
        )}
      </div>

      <div className="story-viewtabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === "digest"} className={view === "digest" ? "on" : ""} onClick={() => goView("digest")}>{t("요약")}</button>
        <button type="button" role="tab" aria-selected={view === "chronicle"} className={view === "chronicle" ? "on" : ""} onClick={() => goView("chronicle")}>{t("테라 연대기")}</button>
      </div>

      {view === "chronicle" ? (
        <ChronologyView onOpenEvent={openEvent} />
      ) : (
        <DigestView onOpen={open} includeFuture={includeFuture} group={group} onGroup={goGroup} />
      )}
    </section>
  );
}
