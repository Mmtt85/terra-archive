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
// 로케일별로 '실제 번역이 끝난' 이벤트 id 목록 (story-i18n-merge.py 생성). 부분 롤아웃 중
// 아직 번역 안 된 이벤트는 en/ja에서 한국어 폴백이므로 'KO 전용' 안내를 띄운다.
import translatedEnData from "./data/story-translated.en.json";
import translatedJaData from "./data/story-translated.ja.json";
// 전문(풀 스크립트)이 준비된 이벤트 id — scripts/build-story-scripts.py 생성.
// 본문은 public/story/script/<id>.json 정적 파일을 fetch (번들 import 금지 — 수백 KB/이벤트).
import scriptIdsData from "./data/story-script-ids.json";
import chronologyData from "./data/chronology.json";
import imageDimsData from "./data/story-image-dims.json";
import { rich, useI18n, type Locale } from "./i18n";
import { normSearch } from "./search";

// CG·삽화의 실측 크기 (scripts/measure-story-images.py) — width/height를 박아 로딩 중
// 레이아웃 밀림(CLS)을 없앤다. 브라우저가 렌더 폭에 맞춰 높이를 미리 예약한다.
const imageDims = imageDimsData as Record<string, [number, number]>;

type LocText = { ko: string; en?: string; ja?: string };
type StoryEvent = { id: string; name: LocText; start: string; episodes: number; thumb: string; thumbEn?: string; thumbJa?: string; unreleased?: boolean; epNo?: number; mini?: boolean };
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
type ChronKind = "event" | "mini" | "main" | "roguelike";
type Arc = { id: string; name: LocText };
type RawEntry = { ref?: string; id?: string; kind: ChronKind; title?: LocText; terraYear?: number | null; arc?: string | null; dateNote?: string };
type Chronology = { note: string; updated?: string; arcs: Arc[]; entries: RawEntry[] };
// 연대기 항목 하나(이벤트 ref는 stories.json에서 이름·썸네일·출시월을 끌어온다)
type ChronItem = { key: string; kind: ChronKind; name: LocText; start?: string; thumb?: string; thumbEn?: string; thumbJa?: string; terraYear: number | null; arc: string | null; eventId?: string; dateNote?: string; epNo?: number; ep?: LocText };

const data = storiesData as { updated: string; events: StoryEvent[] };
const summaryIds = new Set(summaryIdsData as string[]);
const scriptIds = new Set(scriptIdsData as string[]);
// 전문(풀 스크립트)이나 AI 요약 중 하나만 있어도 열 수 있다 (사용자 확정 2026-07-20).
const canOpenStory = (id: string) => summaryIds.has(id) || scriptIds.has(id);

// 전문(풀 스크립트) 스키마 — build-story-scripts.py 라인 스키마와 1:1
type ScriptLine = { n?: string; x?: string; st?: string; img?: string; loc?: string; opts?: string[]; vals?: string[]; br?: string };
type ScriptEp = { code: string; name: string; tag: string; lines: ScriptLine[] };
// tr: "cn" = 한국 서버 미출시 이벤트 — CN 원문 AI 번역본 (비공식 번역 안내 표시)
type ScriptData = { id: string; eps: ScriptEp[]; tr?: string; faces?: Record<string, string> };
const translatedByLocale: Record<string, Set<string>> = {
  en: new Set(translatedEnData as string[]),
  ja: new Set(translatedJaData as string[]),
};
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
  return ev && canOpenStory(id) ? ev : null;
}

function blockText(block: Block): string {
  if (block.t === "img") return block.cap ?? "";
  if (block.t === "deco") return "";   // 장식 삽화는 레일 매칭 대상 아님
  if (block.t === "quote") return `${block.who} ${block.x}`;
  return block.t === "h" || block.t === "p" ? block.x : "";
}

// 세로 중앙 정렬 스택이 일반 노트북 뷰포트(~800px)를 넘지 않는 개수
const MAX_RAIL_CARDS = 4;

// 엔티티 이름들 → 매칭 정규식. 이름 앞에 한글이 오면 제외(negative lookbehind — '-이신' 오탐 방지).
// 한 글자 이름(위·시·첸 등)은 '위해·시간' 같은 일반 단어 첫 글자에 오탐되므로
// 단독으로 서 있거나 바로 뒤가 조사일 때만 매칭 (사용자 리포트 2026-07-18).
function entityMatcher(rawKeys: string[]): RegExp {
  const keys = rawKeys
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  const parts = keys.map((k) =>
    k.length === 1
      ? `(?:${k}(?![가-힣])|${k}(?=(?:가|는|를|의|와|과|도|만|랑|에게|한테|께서?)(?![가-힣])))`
      : k,
  );
  return new RegExp(`(?<![가-힣])(?:${parts.join("|")})`);
}

// 오퍼레이터 자동 카드 인덱스 — Home이 로케일 오퍼 데이터에서 만들어 내려준다 (name → {op, desc})
export type OpIndex = Record<string, { op: string; desc: string }>;

// 엔티티별 글로벌 매처 (본문 밑줄용) — 매칭 단어가 '어느' 레일 카드에 연결되는지 알아야
// 클릭 시 그 카드를 강조할 수 있으므로, 합성 정규식 대신 (정규식, 엔티티인덱스) 쌍을 쓴다.
export type EntMatch = { re: RegExp; ei: number }[];
function entMatchOf(matchers: RegExp[]): EntMatch {
  return matchers.map((r, ei) => ({ re: new RegExp(r.source, "g"), ei }));
}

// 본문에서 레일 매칭 단어에 점선 밑줄 — 레일 카드가 왜 떴는지 본문에서 직접 보여준다
// (사용자 확정 2026-07-18: 카드 옆 배지 대신 본문 밑줄). 클릭하면 onEntity(ei)로 그 단어가
// 연결된 레일 카드를 강조/펼친다 (사용자 요청 2026-07-20).
function markEntities(text: string, em: EntMatch | null, onEntity?: (ei: number) => void): React.ReactNode {
  if (typeof text !== "string") return null; // 잘못된 블록(x 누락)이 페이지 전체를 죽이지 않게 방어
  if (!em || em.length === 0) return text;
  const hits: { s: number; e: number; w: string; ei: number }[] = [];
  for (const { re, ei } of em) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      hits.push({ s: m.index, e: m.index + m[0].length, w: m[0], ei });
    }
  }
  if (hits.length === 0) return text;
  // 시작 위치 오름차순, 같으면 더 긴 것 우선 → 겹치는 뒤 매치는 건너뛴다
  hits.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const h of hits) {
    if (h.s < last) continue;
    if (h.s > last) out.push(text.slice(last, h.s));
    out.push(
      <i key={k++} className="ent-mark" role="button" tabIndex={0}
        onClick={onEntity ? (ev) => { ev.stopPropagation(); onEntity(h.ei); } : undefined}
        onKeyDown={onEntity ? (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); onEntity(h.ei); } } : undefined}>
        {h.w}
      </i>,
    );
    last = h.e;
  }
  out.push(text.slice(last));
  return out;
}

// **볼드** 마크업 + 엔티티 밑줄을 같이 처리 (요약 본문용 — i18n rich 대체)
function richMark(s: string, em: EntMatch | null, onEntity?: (ei: number) => void): React.ReactNode {
  if (typeof s !== "string") return null; // 잘못된 블록(x 누락) 방어
  const parts = s.split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return markEntities(s, em, onEntity);
  return parts.map((part, i) =>
    i % 2 ? <b key={i}>{markEntities(part, em, onEntity)}</b> : <span key={i}>{markEntities(part, em, onEntity)}</span>);
}

// ── 읽기 설정(글자·삽화 크기) — 요약/전문 공용, localStorage에 기억 (사용자 피드백 2026-07-20) ──
type ReaderPrefs = { font: "sm" | "md" | "lg"; img: "sm" | "md" | "lg" };
const READER_PREFS_KEY = "story-reader-prefs";
function loadReaderPrefs(): ReaderPrefs {
  if (typeof window === "undefined") return { font: "md", img: "md" };
  try {
    const raw = window.localStorage.getItem(READER_PREFS_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (p && (p.font === "sm" || p.font === "md" || p.font === "lg") && (p.img === "sm" || p.img === "md" || p.img === "lg")) return p;
  } catch { /* 무시 — 기본값 사용 */ }
  return { font: "md", img: "md" };
}
function useReaderPrefs() {
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadReaderPrefs);
  useEffect(() => {
    try { window.localStorage.setItem(READER_PREFS_KEY, JSON.stringify(prefs)); } catch { /* 무시 */ }
  }, [prefs]);
  return [prefs, setPrefs] as const;
}
function ReaderPrefsBar({ prefs, setPrefs }: { prefs: ReaderPrefs; setPrefs: (fn: (p: ReaderPrefs) => ReaderPrefs) => void }) {
  const { t } = useI18n();
  const STEPS: Array<{ key: "sm" | "md" | "lg"; label: string }> = [
    { key: "sm", label: t("작게") }, { key: "md", label: t("보통") }, { key: "lg", label: t("크게") },
  ];
  return (
    <div className="story-reader-prefs" role="group" aria-label={t("읽기 설정")}>
      <div className="reader-prefs-group">
        <span className="story-reader-prefs-label">{t("글자 크기")}</span>
        <div className="story-reader-prefs-btns">
          {STEPS.map((s) => (
            <button key={s.key} type="button" className={prefs.font === s.key ? "on" : ""}
              onClick={() => setPrefs((p) => ({ ...p, font: s.key }))}>{s.label}</button>
          ))}
        </div>
      </div>
      <div className="reader-prefs-group">
        <span className="story-reader-prefs-label">{t("삽화 크기")}</span>
        <div className="story-reader-prefs-btns">
          {STEPS.map((s) => (
            <button key={s.key} type="button" className={prefs.img === s.key ? "on" : ""}
              onClick={() => setPrefs((p) => ({ ...p, img: s.key }))}>{s.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 참조 레일 공용 로직 — 요약 본문과 전문(스크립트) 뷰가 같이 쓴다 (2026-07-18) ──
// texts[i] = data-idx=i 요소의 매칭용 텍스트. 화면에 보이는 요소들에 언급된 엔티티를 추적.
function useEntityRail(texts: string[], matchers: RegExp[]) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState<Set<number>>(new Set());
  const mentions = useMemo(
    () =>
      texts.map((text) => {
        // 매칭된 실제 단어도 포착 — 레일 카드에 '왜 떴는지' 표시용 (사용자 요청 2026-07-18)
        const found: { ei: number; word: string }[] = [];
        matchers.forEach((re, index) => {
          const m = re.exec(text);
          if (m) found.push({ ei: index, word: m[0] });
        });
        return found;
      }),
    [texts, matchers],
  );
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    setInView(new Set());
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
  }, [texts]);

  // 지금 화면(아래 문단 우선)에 언급된 엔티티. 한 번 뜬 카드는 그 문단이 완전히 사라질 때까지
  // 자리를 지켜, 4장 제한 때문에 밀렸다 다시 뜨는 깜빡임을 막는다. 빈 자리엔 아래쪽 새 엔티티를 채운다.
  const [active, setActive] = useState<{ ei: number; word: string }[]>([]);
  useEffect(() => {
    const ordered: { ei: number; word: string }[] = [];
    [...inView].sort((a, b) => b - a).forEach((blockIndex) => {
      for (const m of mentions[blockIndex] ?? []) {
        if (!ordered.some((o) => o.ei === m.ei)) ordered.push(m);
      }
    });
    const present = new Set(ordered.map((o) => o.ei));
    setActive((prev) => {
      const next = prev.filter((o) => present.has(o.ei)); // 아직 보이는 카드는 순서 그대로 유지
      for (const o of ordered) {                           // 빈 자리에만 아래쪽 새 엔티티 추가
        if (next.length >= MAX_RAIL_CARDS) break;
        if (!next.some((x) => x.ei === o.ei)) next.push(o);
      }
      return next.length === prev.length && next.every((o, i) => o.ei === prev[i].ei) ? prev : next;
    });
  }, [inView, mentions]);

  return { bodyRef, active };
}

// 참조 레일 렌더 — 요약/전문 공용 (모바일 펼침 상태 포함)
// focus: 본문 점선밑줄 단어를 클릭하면 {ei, k}가 넘어와 해당 카드를 강조(데스크탑)하거나
// 펼친다(모바일). k는 같은 단어를 다시 눌러도 강조가 재발동하도록 하는 nonce.
function EntityRail({ entities, active, onShowOperator, focus }: {
  entities: Entity[]; active: { ei: number; word: string }[]; onShowOperator?: (id: string) => void;
  focus?: { ei: number; k: number } | null;
}) {
  const { t } = useI18n();
  const [openCard, setOpenCard] = useState<string | null>(null); // 모바일 레일에서 펼친 카드(이름)
  const [flashEi, setFlashEi] = useState<number | null>(null);    // 데스크탑에서 잠깐 강조할 카드
  const railRef = useRef<HTMLElement>(null);
  // 펼친 카드 바깥을 누르면 자동으로 접는다
  useEffect(() => {
    if (!openCard) return;
    const onDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".story-rail .rail-card")) setOpenCard(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [openCard]);
  // 본문 밑줄 단어 클릭 → 해당 카드로 스크롤 + 강조(데스크탑) / 펼침(모바일)
  useEffect(() => {
    if (!focus) return;
    const entity = entities[focus.ei];
    if (!entity) return;
    const mobile = typeof window !== "undefined" && window.matchMedia("(max-width: 1180px)").matches;
    if (mobile) setOpenCard(entity.name); // 모바일: 펼치면 100% 폭이 되므로 레이아웃 후 스크롤
    setFlashEi(focus.ei);
    // 펼침(.open)으로 폭이 바뀐 뒤에 가운데로 스크롤해야 오른쪽 잘림 없이 정확히 중앙에 온다.
    // scrollIntoView는 sticky 가로 레일에서 축을 헷갈려 안 먹는 사례가 있어, 레일을 직접
    // scrollBy 한다(뷰포트 기준 rect 차이로 중앙 오프셋 계산 — 2026-07-20 사용자 리포트).
    const raf = window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const rail = railRef.current;
      const el = rail?.querySelector<HTMLElement>(`[data-ei="${focus.ei}"]`);
      if (!rail || !el) return;
      const rRect = rail.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const delta = (eRect.left - rRect.left) - (rRect.width - eRect.width) / 2;
      rail.scrollBy({ left: delta, behavior: "instant" });
    }));
    const timer = window.setTimeout(() => setFlashEi((cur) => (cur === focus.ei ? null : cur)), 1400);
    return () => { window.cancelAnimationFrame(raf); window.clearTimeout(timer); };
  }, [focus, entities]);
  // 강조 대상이 현재 active에 없으면(스크롤로 밀려남) 임시로 끼워 넣어 카드를 띄운다
  const shown = focus && !active.some((a) => a.ei === focus.ei)
    ? [{ ei: focus.ei, word: "" }, ...active]
    : active;
  return (
    <aside className="story-rail" aria-label={t("등장인물")} ref={railRef}>
      {shown.map(({ ei: entityIndex }) => {
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
          <div className={`rail-card${linked ? " op-linked" : ""}${openCard === entity.name ? " open" : ""}${flashEi === entityIndex ? " flash" : ""}`} key={entity.name}
            data-ei={entityIndex}
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
  );
}

// ── 전문(풀 스크립트) 리더 — 요약 상단 '전문 보기' 토글로 진입 (2026-07-18) ──
// 데이터는 public/story/script/<id>.json 을 지연 fetch. 에피소드 단위로 렌더.
// 요약과 같은 참조 레일이 오른쪽에 따라다닌다 (사용자 요청 2026-07-18).
function ScriptReader({ script, error, entities, opIndex, onShowOperator }: {
  script: ScriptData | null; error: boolean;
  entities: Entity[]; opIndex?: OpIndex; onShowOperator?: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  // 오퍼가 아닌 화자의 스탠딩 스프라이트 — 썸네일 클릭 시 원본 크게 보기 (사용자 요청 2026-07-18)
  const [faceZoom, setFaceZoom] = useState<string | null>(null);
  // 요약 카드에 없는 화자라도 오퍼레이터면 자동으로 레일 카드 생성 (호시구마 등 — 사용자 리포트 2026-07-18)
  const autoEntities = useMemo<Entity[]>(() => {
    if (!script || !opIndex) return [];
    const covered = new Set(entities.flatMap((e) => [e.name, ...(e.alias ?? [])]));
    const seen = new Set<string>();
    const out: Entity[] = [];
    for (const e of script.eps) {
      for (const ln of e.lines) {
        if (!ln.n || seen.has(ln.n)) continue;
        seen.add(ln.n);
        if (covered.has(ln.n)) continue;
        const oi = opIndex[ln.n];
        if (oi) out.push({ name: ln.n, desc: oi.desc, op: oi.op });
      }
    }
    return out;
  }, [script, opIndex, entities]);
  const allEntities = useMemo(() => [...entities, ...autoEntities], [entities, autoEntities]);
  const [epIdx, setEpIdx] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);
  const goEp = (i: number) => {
    setEpIdx(i);
    topRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  };
  const ep = script ? script.eps[Math.min(epIdx, script.eps.length - 1)] : null;
  // 렌더용 라인 가공 — 렌더 중 변수 재할당 금지(react-compiler)라 memo에서 미리 계산:
  //  · br 마커에 직전 선택지 텍스트 부착 (references 는 Decision values 참조 — 옵션 순번 아님)
  //  · 같은 화자의 연속 대사는 첫 줄만 이름 표시 (showN — 사용자 요청 2026-07-18)
  //  · 화자 썸네일(face): 오퍼 아바타 → 요약 스탠딩 CG 순 폴백
  const lines = useMemo(() => {
    if (!ep) return [];
    let lastOpts: string[] = [];
    let lastVals: string[] = [];
    let prevN: string | undefined;
    const mapped = ep.lines.map((ln) => {
      if (ln.opts) {
        prevN = undefined;
        lastOpts = ln.opts;
        lastVals = ln.vals ?? ln.opts.map((_, i) => String(i + 1));
        return ln;
      }
      if (ln.br != null) {
        const refs = ln.br.split(";").map((v) => v.trim());
        const texts = refs.map((r) => lastOpts[lastVals.indexOf(r)]).filter(Boolean);
        return { ...ln, brTexts: texts } as ScriptLine & { brTexts: string[] };
      }
      if (ln.n) {
        const showN = ln.n !== prevN;
        prevN = ln.n;
        // 화자 얼굴·오퍼 연결: 오퍼명 직매칭 → 요약 엔티티(별칭 포함 — '숴'는 총웨) →
        // 스크립트 스탠딩 스프라이트(faces — 오퍼 아닌 NPC도 연결) 순 폴백 (사용자 요청 2026-07-18)
        let face: string | undefined;
        let opId: string | undefined;
        const oi = opIndex?.[ln.n];
        if (oi) {
          face = `/avatars/${oi.op}.webp`;
          opId = oi.op;
        } else {
          const ent = entities.find((e) => e.name === ln.n || e.alias?.includes(ln.n!));
          if (ent) {
            face = ent.img ?? (ent.op ? `/avatars/${ent.op}.webp` : undefined);
            opId = ent.op;
          }
        }
        if (!face && script?.faces?.[ln.n]) face = `/story/char/${script.faces[ln.n]}.webp`;
        return { ...ln, showN, face, opId } as ScriptLine & { showN: boolean; face?: string; opId?: string };
      }
      // 지문·컷씬 등이 끼면 다음 대사엔 이름을 다시 보여준다
      prevN = undefined;
      return ln;
    });
    // 연속된 지문(st)은 한 박스로 합친다 — 시적 나레이션이 줄마다 별도 회색 박스로 쪼개지지
    // 않도록 (사용자 피드백 2026-07-20). st 사이에 대사·컷씬·선택지가 끼면 병합하지 않는다.
    const merged: ScriptLine[] = [];
    for (const ln of mapped) {
      const isStOnly = ln.st != null && ln.n == null && ln.x == null && ln.img == null && ln.opts == null && ln.br == null && ln.loc == null;
      const prev = merged[merged.length - 1] as ScriptLine | undefined;
      const prevStOnly = prev && prev.st != null && prev.n == null && prev.x == null && prev.img == null && prev.opts == null && prev.br == null && prev.loc == null;
      if (isStOnly && prevStOnly) {
        prev!.st = `${prev!.st}\n${ln.st}`;
      } else {
        merged.push({ ...ln });
      }
    }
    return merged;
  }, [ep, script, opIndex, entities]);
  const lineTexts = useMemo(
    () => lines.map((ln) => [ln.n, ln.x, ln.st, ln.loc, ...(ln.opts ?? [])].filter(Boolean).join(" ")),
    [lines],
  );
  // 이 에피소드에서 썸네일 달고 말하는 인물은 레일에서 제외 — 왼쪽에 이미 얼굴이 보이므로
  // 중복 표시하지 않는다 (사용자 요청 2026-07-18). 언급만 되는 편에서는 레일에 그대로 뜬다.
  const facedSpeakers = useMemo(() => {
    const s = new Set<string>();
    for (const ln of lines) {
      const l = ln as ScriptLine & { face?: string };
      if (l.n && l.face) s.add(l.n);
    }
    return s;
  }, [lines]);
  const railEntities = useMemo(
    () => allEntities.filter((e) => ![e.name, ...(e.alias ?? [])].some((k) => facedSpeakers.has(k))),
    [allEntities, facedSpeakers],
  );
  const railMatchers = useMemo(
    () => railEntities.map((e) => entityMatcher([e.name, ...(e.alias ?? [])])),
    [railEntities],
  );
  const { bodyRef, active } = useEntityRail(lineTexts, railMatchers);
  const em = useMemo(() => entMatchOf(railMatchers), [railMatchers]);
  const [railFocus, setRailFocus] = useState<{ ei: number; k: number } | null>(null);
  const focusEntity = (ei: number) => setRailFocus((p) => ({ ei, k: (p?.k ?? 0) + 1 }));
  if (error) return <p className="story-disclaimer">{t("스크립트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.")}</p>;
  if (!script || !ep) return <p className="sc-loading">{t("스크립트 불러오는 중…")}</p>;
  return (
    <div className="story-script" ref={topRef}>
      <p className="story-disclaimer">{t("게임 내 스토리 스크립트 원문입니다. 대사·지문·컷씬만 표시되며 연출(음악·효과)은 생략됩니다.")}</p>
      {script.tr === "cn" && <p className="story-disclaimer">{t("아직 한국 서버에 출시되지 않은 이벤트라, 중국 서버 원문을 AI가 번역한 비공식 한국어 텍스트입니다.")}</p>}
      {locale !== "ko" && <p className="story-disclaimer">{t("전문은 현재 한국어 게임 텍스트로만 제공됩니다.")}</p>}
      <div className="sc-ep-nav" role="tablist" aria-label={t("에피소드")}>
        {script.eps.map((e, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === epIdx}
            className={i === epIdx ? "on" : ""} onClick={() => goEp(i)}>
            <b>{e.code || `#${i + 1}`}</b>{e.tag && <small>{e.tag}</small>}
          </button>
        ))}
      </div>
      <h3 className="sc-ep-title">{ep.code} {ep.name}{ep.tag && <small>{ep.tag}</small>}</h3>
      <div className="story-detail-grid">
        <div className="story-body sc-body" ref={bodyRef}>
        {lines.map((ln, i) => {
          if (ln.opts) return (
            <div key={i} className="sc-opts" data-idx={i}><i>{t("선택지")}</i>{ln.opts.map((o, j) => <span key={j}>{o}</span>)}</div>
          );
          if (ln.br != null) {
            const texts = (ln as ScriptLine & { brTexts?: string[] }).brTexts ?? [];
            return <div key={i} className="sc-br">▼ {texts.length > 0 ? texts.join(" / ") : t("분기")}</div>;
          }
          if (ln.img) {
            const cutSrc = `/story/cut/${ln.img}.webp`;
            const cutDim = imageDims[cutSrc];
            return (
              <figure key={i} className="sc-cut">
                <img src={cutSrc} alt="" loading="lazy" decoding="async" width={cutDim?.[0]} height={cutDim?.[1]} />
              </figure>
            );
          }
          if (ln.loc) return <div key={i} className="sc-loc" data-idx={i}>{ln.loc}</div>;
          if (ln.st) return <p key={i} className="sc-st" data-idx={i}>{markEntities(ln.st, em, focusEntity)}</p>;
          if (ln.n) {
            const { showN, face, opId } = ln as ScriptLine & { showN?: boolean; face?: string; opId?: string };
            // 클릭: 오퍼레이터(별칭 연결 포함)는 오퍼 상세 모달, 그 외 얼굴 있는 화자는 스탠딩 크게 보기
            const openOp = opId && onShowOperator ? () => onShowOperator(opId) : undefined;
            const act = openOp ?? (face ? () => setFaceZoom(face) : undefined);
            const clickable = Boolean(act);
            return (
              <p key={i} className={`sc-line${showN === false ? " cont" : ""}`} data-idx={i}>
                <b className={`sc-name${clickable ? " op-linked" : ""}`}
                  {...(clickable && showN !== false ? {
                    onClick: act,
                    role: "button", tabIndex: 0,
                    onKeyDown: (e: { key: string }) => { if (e.key === "Enter") act!(); },
                    title: openOp ? t("오퍼레이터 정보 보기") : t("크게 보기"),
                  } : {})}>
                  {showN !== false && face && (
                    <span className={`sc-face${face.startsWith("/story/char/") ? " sprite" : ""}`} aria-hidden>
                      <img src={face} alt="" loading="lazy" decoding="async" />
                    </span>
                  )}
                  {showN !== false && ln.n}
                </b>
                <span>{markEntities(ln.x ?? "", em, focusEntity)}</span>
              </p>
            );
          }
          return <p key={i} className="sc-narr" data-idx={i}>{markEntities(ln.x ?? "", em, focusEntity)}</p>;
        })}
        </div>
        <EntityRail entities={railEntities} active={active} onShowOperator={onShowOperator} focus={railFocus} />
      </div>
      <div className="sc-ep-foot">
        {epIdx > 0 && <button type="button" onClick={() => goEp(epIdx - 1)}>← {t("이전 에피소드")}</button>}
        {epIdx < script.eps.length - 1 && <button type="button" onClick={() => goEp(epIdx + 1)}>{t("다음 에피소드")} →</button>}
      </div>
      {/* 화자 스탠딩 크게 보기 — 아무 곳이나 클릭하면 닫힘 */}
      {faceZoom && (
        <div className="sc-face-zoom" role="presentation" onClick={() => setFaceZoom(null)}>
          <img src={faceZoom} alt="" />
        </div>
      )}
    </div>
  );
}

// 요약 상세 — 본문 + 스크롤 추적 참조 레일
function StoryDetail({ event, summary, onClose, onShowOperator, opIndex }: {
  event: StoryEvent; summary?: Summary; onClose: () => void; onShowOperator?: (id: string) => void; opIndex?: OpIndex;
}) {
  const { locale, t } = useI18n();

  // 전문(풀 스크립트)이 기본 뷰 — 진입 즉시 로드, AI 요약은 토글로 (사용자 확정 2026-07-18).
  // StoryDetail은 key={event.id}로 리마운트되므로 이벤트 전환 시 상태가 새지 않는다.
  const hasScript = scriptIds.has(event.id);
  const hasSummary = Boolean(summary); // 요약이 아직 없는(전문만 있는) 이벤트도 열람 가능 (2026-07-20)
  // 미출시(CN 선행) 이벤트: 전문이 없어도 버튼은 보여주고, 누르면 왜 없는지 안내 (사용자 요청 2026-07-18)
  const futureNoScript = !hasScript && Boolean(event.unreleased);
  // 요약이 없으면 전문만 볼 수 있으니 전문 뷰로 고정 시작
  const [scriptView, setScriptView] = useState(hasScript || !hasSummary);
  const [script, setScript] = useState<ScriptData | null>(null);
  const [scriptErr, setScriptErr] = useState(false);
  useEffect(() => {
    if (!hasScript) return;
    let alive = true;
    fetch(`/story/script/${event.id}.json`)
      .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
      .then((json) => { if (alive) setScript(json as ScriptData); })
      .catch(() => { if (alive) setScriptErr(true); });
    return () => { alive = false; };
  }, [event.id, hasScript]);
  const openScript = () => setScriptView(true);
  const [readerPrefs, setReaderPrefs] = useReaderPrefs();

  // 인물이 용어보다 먼저 뜨도록 chars → terms 순으로 합친다
  const entities = useMemo<Entity[]>(
    () => [...(summary?.chars ?? []), ...(summary?.terms ?? [])],
    [summary],
  );

  // 엔티티별 매칭 정규식 — 이름/별칭 앞에 한글이 오면 제외(negative lookbehind).
  // "이신"이 경어체 "-이신"(선생님이신)에, 짧은 이름이 다른 단어에 부분일치해 레일이
  // 엉뚱하게 뜨던 문제를 막는다. 한국어 조사는 이름 뒤에 붙으므로 뒤쪽은 열어 둔다 (2026-07).
  const matchers = useMemo(
    () => entities.map((entity) => entityMatcher([entity.name, ...(entity.alias ?? [])])),
    [entities],
  );
  // 참조 레일 — 블록 텍스트 기준 매칭 (전문 뷰는 ScriptReader가 라인 기준으로 동일 훅 사용)
  const blockTexts = useMemo(() => (summary?.blocks ?? []).map(blockText), [summary]);
  const { bodyRef, active } = useEntityRail(blockTexts, matchers);
  const em = useMemo(() => entMatchOf(matchers), [matchers]);
  const [railFocus, setRailFocus] = useState<{ ei: number; k: number } | null>(null);
  const focusEntity = (ei: number) => setRailFocus((p) => ({ ei, k: (p?.k ?? 0) + 1 }));

  return (
    <section className="story story-detail" aria-label={locText(locale, event.name)}>
      {/* 뒤로가기: 넓은 화면에선 왼쪽 여백에 sticky(본문은 위로 올라옴), 좁으면 본문 위 일반 배치 */}
      <div className="story-back-wrap">
        <button type="button" className="story-back story-back-top" onClick={onClose}>← {t("스토리 목록으로")}</button>
      </div>
      <div className={`story-detail-inner reader-font-${readerPrefs.font} reader-img-${readerPrefs.img}`}>
        <header className="story-detail-head">
          {/* 제목 줄 — 왼쪽 제목, 오른쪽에 전문/요약 토글 (사용자 요청 2026-07-20, 모바일·PC 공통) */}
          <div className="story-detail-titlerow">
            <div className="story-detail-titlecol">
              <span className="section-no">AI STORY DIGEST</span>
              <h2>{locText(locale, event.name)}</h2>
            </div>
            {/* 보기 방식 토글 — 전문·요약이 둘 다 있을 때만(또는 미출시 안내). 하나만 있으면 토글 없이 그것만. */}
            {((hasScript && hasSummary) || futureNoScript) && (
              <div className="story-mode-bar" role="tablist" aria-label={t("보기 방식")}>
                <button type="button" role="tab" aria-selected={scriptView}
                  className={scriptView ? "on" : ""} onClick={openScript}>{t("전문 보기 (풀 스크립트)")}</button>
                <button type="button" role="tab" aria-selected={!scriptView}
                  className={!scriptView ? "on" : ""} onClick={() => setScriptView(false)}>{t("AI 요약")}</button>
              </div>
            )}
          </div>
          <p className="story-meta">{event.epNo != null ? locText(locale, epLabel(event.epNo)) : event.id.startsWith("rogue_") ? t("통합 전략") : `${event.start} · ${t("에피소드 {n}개", { n: event.episodes })}`}</p>
          {summary?.tagline && <p className="story-tagline">{summary.tagline}</p>}
          {/* 전문만 있고 요약이 아직 없는 이벤트 안내 */}
          {!hasSummary && hasScript && <p className="story-tagline story-tagline-plain">{t("AI 요약은 아직 준비 중이에요. 지금은 게임 내 스토리 전문으로 만나 보세요.")}</p>}
          {!scriptView && hasSummary && <p className="story-disclaimer">{t("이 요약은 AI가 게임 내 스토리 스크립트 전문을 읽고 쓴 2차 창작 요약입니다.")}</p>}
          {!scriptView && locale !== "ko" && !translatedByLocale[locale]?.has(event.id) && (
            <p className="story-disclaimer">{t("이 편의 요약 본문은 아직 번역되지 않아 한국어로 표시됩니다.")}</p>
          )}
          {/* 읽기 설정(글자·삽화 크기) — 전문·요약 둘 다 실제 본문이 있을 때만 노출 (사용자 피드백 2026-07-20) */}
          {(hasSummary || hasScript) && <ReaderPrefsBar prefs={readerPrefs} setPrefs={setReaderPrefs} />}
        </header>
        {scriptView && hasScript && <ScriptReader script={script} error={scriptErr} entities={entities} opIndex={opIndex} onShowOperator={onShowOperator} />}
        {scriptView && futureNoScript && (
          <div className="sc-future-note">
            <b>{t("전문은 한국 서버 정식 출시 후에 열려요")}</b>
            <p>{t("이 이벤트는 아직 중국 서버에만 공개된 스토리예요. 공식 한국어 번역이 나오기 전에 원문 전체를 그대로 옮겨 싣는 건 이야기를 만든 분들의 몫을 앞질러 가는 일이라, 전문은 아껴두고 있어요.")}</p>
            <p>{t("한국 서버에 정식 출시되면 공식 번역 전문을 바로 볼 수 있도록 준비해 두었어요. 그때까지는 줄거리를 꼼꼼히 담은 AI 요약으로 먼저 만나 보세요.")}</p>
          </div>
        )}
        <div className="story-detail-grid" hidden={scriptView || !hasSummary}>
          <div className="story-body" ref={bodyRef}>
            {(summary?.blocks ?? []).map((block, index) => {
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
                    <p>{richMark(block.x, em, focusEntity)}</p>
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
              return <p key={index} data-idx={index}>{richMark(block.x, em, focusEntity)}</p>;
            })}
          </div>
          <EntityRail entities={entities} active={active} onShowOperator={onShowOperator} focus={railFocus} />
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
        key: raw.ref, kind: ev?.mini ? "mini" : "event", // 미니 이벤트는 사이드와 분리 (2026-07-20)
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
      eventId: raw.id && canOpenStory(raw.id) ? raw.id : undefined,
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
const KIND_KO: Record<ChronKind, string> = { event: "사이드 이벤트", mini: "미니 이벤트", main: "메인스토리", roguelike: "통합 전략" };
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
    if (sec && panelRef.current) panelRef.current.scrollTo({ top: sec.offsetTop, behavior: "instant" });
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
                    <span className="chron-item-top">
                      <span className="chron-kind" style={it.arc ? { background: arcColor(it.arc) } : undefined}>{t(KIND_KO[it.kind])}</span>
                      {it.ep && <span className="chron-item-ep">{locText(locale, it.ep)}</span>}
                    </span>
                    <span className="chron-item-name">{locText(locale, it.name)}</span>
                    <span className="chron-item-bot">
                      {it.terraYear != null && <span className="chron-item-year">{t("테라력 {y}년", { y: it.terraYear })}</span>}
                      <span className="chron-item-meta">{it.start ?? "—"}</span>
                    </span>
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
function DigestView({ onOpen, includeFuture, group }: { onOpen: (event: StoryEvent) => void; includeFuture?: boolean; group: "theme" | "kind" }) {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false); // 검색창 클릭 시 전체 이벤트 목록 드롭다운
  const searchRef = useRef<HTMLDivElement>(null);

  // #theme-<arc> 딥링크 진입 시 해당 테마 섹션으로 스크롤 (테마별 뷰가 렌더된 뒤)
  useEffect(() => {
    if (group !== "theme") return;
    const m = decodeURIComponent(window.location.hash).match(/^#theme-(.+)$/);
    if (!m) return;
    const el = document.getElementById(`theme-${m[1]}`);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "start", behavior: "instant" }));
  }, [group]);

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
        k = it.kind; label = t(KIND_KO[it.kind]); sort = ["event", "mini", "main", "roguelike"].indexOf(it.kind);
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
    const ready = Boolean(it.eventId && canOpenStory(it.eventId));
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
                    const ready = Boolean(it.eventId && canOpenStory(it.eventId));
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
      </div>

      {filtered.length === 0 ? (
        <p className="recruit-empty">{t("조건에 맞는 이벤트가 없어요.")}</p>
      ) : (
        <div className="digest-groups">
          {groups.map((g) => {
            // 테마 그룹은 이름 클릭으로 #theme-<arc> 딥링크를 남긴다 (URL 복붙 공유용)
            const linkable = group === "theme" && g.key !== "__none";
            return (
              <section key={g.key} id={linkable ? `theme-${g.key}` : undefined} className="digest-group">
                <h3 style={g.color ? { borderColor: g.color, color: g.color } : undefined}>
                  {linkable ? (
                    <button type="button" className="digest-group-link" title={t("클릭하면 주소가 이 테마의 공유 링크로 바뀝니다")}
                      onClick={() => {
                        history.pushState(null, "", `#theme-${g.key}`);
                        document.getElementById(`theme-${g.key}`)?.scrollIntoView({ block: "start", behavior: "instant" });
                      }}>
                      {g.label} <em>{g.items.length}</em><span className="digest-group-anchor" aria-hidden>#</span>
                    </button>
                  ) : (
                    <>{g.label} <em>{g.items.length}</em></>
                  )}
                </h3>
                <div className="story-grid">{g.items.map(renderCard)}</div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function StoryGuide({ summaries, onShowOperator, includeFuture, opIndex }: { summaries: StorySummaries; onShowOperator?: (id: string) => void; includeFuture?: boolean; opIndex?: OpIndex }) {
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
      else if (h === "#theme" || h.startsWith("#theme-")) { setView("digest"); setGroup("theme"); }
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
    if (ev && canOpenStory(eventId)) open(ev);
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
    return <StoryDetail key={selected.id} event={selected} summary={summaries[selected.id]} onClose={close} onShowOperator={onShowOperator} opIndex={opIndex} />;
  }

  return (
    <section className="story" aria-label={t("스토리")}>
      <div className="story-head">
        <span className="section-no">AI STORY DIGEST</span>
        <h2>{t("스토리")}</h2>
        <p>{t("한국 서버에 풀린 사이드 스토리 {count}개의 아카이브입니다. AI가 스토리 스크립트 전문을 정독하고 컷씬과 함께 10분 분량으로 요약합니다. 현재 {done}개 수록 — 계속 추가됩니다.", { count: data.events.filter((event) => !event.unreleased).length, done: summarized })}</p>
        <p className="story-source">{t("요약에는 결말 포함 스포일러가 있습니다. 이벤트 제목·썸네일 출처: 게임 데이터 · {date} 기준.", { date: data.updated })}</p>
        {includeFuture && data.events.some((event) => event.unreleased) && (
          <p className="story-source">{t("미실장(중국 서버 선행) 이벤트의 제목은 비공식 AI 번역으로, 한국 서버 정식 출시 시 공식 번역과 다를 수 있습니다.")}</p>
        )}
      </div>

      <div className="story-viewtabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === "digest" && group === "kind"} className={view === "digest" && group === "kind" ? "on" : ""} onClick={() => goGroup("kind")}>{t("종류별")}</button>
        <button type="button" role="tab" aria-selected={view === "digest" && group === "theme"} className={view === "digest" && group === "theme" ? "on" : ""} onClick={() => goGroup("theme")}>{t("테마별")}</button>
        <button type="button" role="tab" aria-selected={view === "chronicle"} className={view === "chronicle" ? "on" : ""} onClick={() => goView("chronicle")}>{t("테라 연대기")}</button>
      </div>

      {view === "chronicle" ? (
        <ChronologyView onOpenEvent={openEvent} />
      ) : (
        <DigestView onOpen={open} includeFuture={includeFuture} group={group} />
      )}
    </section>
  );
}
