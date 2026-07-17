"use client";

// 3개 탭(백과사전·플래너·공채)의 공용 루트. 로케일별 라우트(/ /en /ja)가
// home-ko/en/ja.tsx 래퍼로 해당 언어의 operators 데이터를 정적 import해 넘긴다 —
// 런타임 언어 전환은 전체 내비게이션이라 이 컴포넌트 안에서 로케일은 불변이다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import broadcastsData from "./data/broadcasts.json";
import storyEventsData from "./data/stories.json";
import InfraPlanner from "./planner";
import RecruitHelper from "./recruit";
import FarmGuide from "./farm";
import { normSearch } from "./search";
import StoryGuide from "./story";
import About from "./about";
import FeedbackWidget from "./feedback-widget";
import { feedbackReady, fetchNicknameCounts, submitNickname } from "./feedback";
import { I18nProvider, useI18n, conceptName, DT_LOCALE, MAGIC_TRAIT_RE, LOCALES, type Locale, type ExtraI18n } from "./i18n";

type RangeGrid = { row: number; col: number };

type StatRow = {
  phase: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  res: number;
  cost: number;
  block: number;
  redeploy: number;
  interval: number;
  rangeId: string;
  range: RangeGrid[];
};

type Skill = {
  id: string;
  name: string;
  spType: string;
  initialSp: number;
  spCost: number;
  duration: number | null;
  description: string;
};

type Talent = { name: string; description: string };

type Potential = { rank: number; description: string };

type ModuleLevel = { level: number; stats: string | null; effects: string[] };

type OperatorModule = {
  id: string;
  name: string;
  type: string;
  unlock: string;
  levels: ModuleLevel[];
};

type Infrastructure = {
  name: string;
  room: string;
  unlock: string;
  description: string;
};

export type Operator = {
  id: string;
  name: string;
  code: string;
  rarity: number;
  job: string;
  jobCode: string;
  subProfession: string;
  position: string;
  combatTags: string[];
  faction: string;
  factions: string[];
  birthplace?: string;
  race?: string;
  concepts: string[];
  aliases: string[];
  reason: string;
  trait: string;
  talents: Talent[];
  stats: StatRow[];
  skills: Skill[];
  potentials: Potential[];
  modules: OperatorModule[];
  infrastructure: Infrastructure[];
  seq: number;
  accent: string;
  image: string;
  // 한국 서버 미실장(중국 서버 선행) 오퍼 — 헤더 '미래시 포함' 토글이 꺼져 있으면 숨긴다
  unreleased?: boolean;
};

const SYNERGY_POTS = ["해산물팟", "쉐이팟", "쉐라그팟", "카시미어팟", "미노스팟", "아베무팟", "연소팟", "라테라노팟", "탄약팟", "라인랩팟", "라이오스 파티"];

// 직군 표시 순서의 정본은 jobCode — 표시명은 로케일 데이터에서 뽑는다
const JOB_ORDER = ["PIONEER", "WARRIOR", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"];

const SORT_KEYS = ["기본", "이름", "성급", "발매순", "소속", "출신지", "종족", "직군", "세부 직군"];

export type Tab = "portal" | "archive" | "planner" | "recruit" | "farm" | "story" | "about";
// 탭 ↔ URL 세그먼트 (portal이 로케일 루트, 오퍼 백과사전은 /operators — 사용자 확정 2026-07-17:
// 루트 진입 시 오퍼 이미지 강제 로딩을 없애려 포탈 첫화면 도입). seo.ts의 TAB_SEG·라우트 폴더명과 일치.
// URL 세그먼트 "stories"(← 정적 자산 디렉터리 public/story/ 와의 경로 충돌 회피). 내부 탭명은 story.
const TAB_SEG: Record<Tab, string> = { portal: "", archive: "operators", planner: "infra", recruit: "recruit", farm: "farm", story: "stories", about: "about" };
const SEG_TAB: Record<string, Tab> = { "": "portal", operators: "archive", infra: "planner", recruit: "recruit", farm: "farm", stories: "story", about: "about" };
const LOCALE_BASE: Record<Locale, string> = { ko: "", en: "/en", ja: "/ja" };

// 현재 pathname → 탭 (로케일 프리픽스 제거 후 세그먼트 매핑)
function tabFromPath(pathname: string): Tab {
  let p = pathname;
  if (p === "/en" || p.startsWith("/en/")) p = p.slice(3);
  else if (p === "/ja" || p.startsWith("/ja/")) p = p.slice(3);
  return SEG_TAB[p.replace(/^\/+/, "").replace(/\/+$/, "")] ?? "portal";
}
// 구 해시(#infra 등) → 탭 (하위호환 리다이렉트용). op 해시나 일반 해시는 null.
function tabFromLegacyHash(hash: string): Tab | null {
  return hash === "#infra" ? "planner" : hash === "#recruit" ? "recruit" : hash === "#farm" ? "farm" : hash.startsWith("#story") ? "story" : null;
}

// ── 공식 방송 ─────────────────────────────────────────────
// 방송 목록은 크론 워커(workers/broadcast — 6시간마다 유튜브 공식 채널 3개를 수집)에서
// 가져오고, 네트워크 실패 시 broadcasts.json 정적 데이터로 폴백한다. 현재 시각과 비교해
// 예약/생방송/지난방송을 분류하며, 헤더엔 요약 버튼 하나만 두고 클릭하면 전체 목록
// (유튜브 썸네일 포함) 모달을 연다. 지난 방송도 날짜와 함께 계속 남긴다.
const BCAST_API = "https://terra-archive-broadcast.nzkonaru.workers.dev/";
type Broadcast = { server: string; title: string; start: string; durationMin?: number; url?: string; videoId?: string };
type BState = "live" | "upcoming" | "past";
// 진행중 게임 이벤트 — 워커가 KR activity_table에서 뽑아 같은 payload에 실어준다.
// 진행중 판정은 클라이언트가 start/end와 Date.now()를 비교 (워커 데이터가 묵어도 정확).
// url = 공식 네이버 카페 이벤트 공지 (워커가 제목 매칭으로 찾음, 없으면 링크 없음)
type GameEvent = { id: string; name: string; type?: string | null; displayType?: string | null; start: string; end: string; url?: string };

const SERVER_META: Record<string, { code: string; label: string }> = {
  kr: { code: "KR", label: "한국" },
  jp: { code: "JP", label: "일본" },
  global: { code: "GL", label: "글로벌" },
};
const HOUR = 3_600_000;
const DAY = 86_400_000;
const STATE_RANK: Record<BState, number> = { live: 0, upcoming: 1, past: 2 };

function YtIcon() {
  return <span className="yt-icon" aria-label="YouTube"><i /></span>;
}

// 공식 방송은 전부 유튜브 — watch/live/youtu.be/embed URL 또는 명시적 videoId에서 11자 ID 추출
function youTubeId(b: Broadcast): string | null {
  if (b.videoId) return b.videoId;
  const m = b.url?.match(/(?:v=|\/live\/|youtu\.be\/|\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function bcastState(b: Broadcast, now: number): BState {
  const start = Date.parse(b.start);
  const end = start + (b.durationMin ?? 120) * 60_000;
  if (now < start) return "upcoming";
  if (now <= end) return "live";
  return "past";
}

// 한국 시각(KST) 기준으로 표기 — KR 팬사이트 기준 (표기 언어만 로케일 적용)
function fmtDate(locale: Locale, iso: string, withTime: boolean) {
  return new Intl.DateTimeFormat(DT_LOCALE[locale], {
    timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(iso));
}

function BroadcastThumb({ b }: { b: Broadcast }) {
  const id = youTubeId(b);
  const [broken, setBroken] = useState(false);
  return (
    <div className="bcast-thumb">
      {id && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <div className="bcast-thumb-empty" aria-hidden>ARKNIGHTS</div>
      )}
      <span className="yt-mark" aria-label="YouTube"><i /></span>
    </div>
  );
}

// 원격/정적 항목 중복 판정 키 — 유튜브 영상 ID가 있으면 그것, 없으면 서버+날짜(UTC)
function bcastKey(b: Broadcast): string {
  return youTubeId(b) ?? `${b.server}:${new Date(b.start).toISOString().slice(0, 10)}`;
}

// AI 스토리 요약이 있는 이벤트 — 진행중 배지에서 이름 현지화 + 배너 썸네일 + 스토리 페이지 링크에 사용
const storyEventById = new Map(
  (storyEventsData as { events: { id: string; name: { ko: string; en?: string; ja?: string }; thumb?: string; thumbEn?: string; thumbJa?: string }[] }).events
    .map((event) => [event.id, event]),
);
// 사이드스토리·복각 등 굵직한 이벤트 — 배지 대표로 우선한다 (로그인·출석류보다)
const MAJOR_EVENT_TYPES = new Set(["SIDESTORY", "BRANCHLINE", "MINISTORY"]);
// 로그인·출석·기원 등 "보상 수령만" 하는 잔이벤트 — 헤더에서 아예 숨긴다 (사용자 확정 2026-07-17).
// 콜라보(SWITCH_ONLY)·한정임무(COLLECTION) 같은 실제 콘텐츠 이벤트는 "_ONLY"라도 남기므로
// 접미사 일괄 필터가 아니라 명시적 블록리스트로 관리한다.
const MINOR_EVENT_TYPES = new Set(["LOGIN_ONLY", "CHECKIN_ONLY", "PRAY_ONLY", "BLESS_ONLY"]);

// 워커 fetch는 모듈 공유 프라미스로 1회만 — 헤더 배지와 이벤트 스트립이 같이 쓴다
let bcastFetch: Promise<{ broadcasts: Broadcast[]; events: GameEvent[] } | null> | null = null;
function fetchBcastPayload() {
  bcastFetch ??= fetch(BCAST_API)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data ? {
      broadcasts: Array.isArray(data.broadcasts) ? data.broadcasts : [],
      events: Array.isArray(data.events) ? data.events : [],
    } : null))
    .catch(() => null);
  return bcastFetch;
}

// 진행중 이벤트 공용 헬퍼 — 배지·스트립이 같은 규칙으로 정렬·표기한다
function sortRunning(events: GameEvent[], now: number): GameEvent[] {
  return events
    .filter((event) => Date.parse(event.start) <= now && now <= Date.parse(event.end))
    .filter((event) => !MINOR_EVENT_TYPES.has(event.type ?? ""))
    .sort((a, b) => {
      const majorA = MAJOR_EVENT_TYPES.has(a.displayType ?? "") ? 0 : 1;
      const majorB = MAJOR_EVENT_TYPES.has(b.displayType ?? "") ? 0 : 1;
      if (majorA !== majorB) return majorA - majorB;
      return majorA === 0 ? Date.parse(b.start) - Date.parse(a.start) : Date.parse(a.end) - Date.parse(b.end);
    });
}
function eventName(locale: Locale, event: GameEvent): string {
  const story = storyEventById.get(event.id);
  return story ? ((locale === "ko" ? story.name.ko : story.name[locale]) ?? story.name.ko) : event.name;
}
function eventThumb(locale: Locale, event: GameEvent): string | undefined {
  const story = storyEventById.get(event.id);
  if (!story) return undefined;
  return (locale === "ja" ? story.thumbJa : locale === "en" ? story.thumbEn : undefined) ?? story.thumb;
}
const eventDday = (event: GameEvent, now: number): number => Math.max(0, Math.ceil((Date.parse(event.end) - now) / DAY));

function BroadcastBadges() {
  const { locale, t } = useI18n();
  const shortStatus = (b: Broadcast, now: number): string => {
    const state = bcastState(b, now);
    if (state === "live") return t("생방송 중");
    if (state === "upcoming") {
      const ms = Date.parse(b.start) - now;
      return ms < HOUR ? t("곧 시작") : ms < DAY ? t("{n}시간 후", { n: Math.round(ms / HOUR) }) : `D-${Math.ceil(ms / DAY)}`;
    }
    return new Intl.DateTimeFormat(DT_LOCALE[locale], { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(new Date(b.start));
  };
  // 서버 렌더에는 시각을 알 수 없어 hydration이 어긋나므로, 마운트 후에만 그린다
  const [now, setNow] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<Broadcast[] | null>(null);
  const [gameEvents, setGameEvents] = useState<GameEvent[]>([]);
  const [evOpen, setEvOpen] = useState(false);
  const evRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    // 워커 불통이면 정적 broadcasts.json만 사용 (이벤트 배지는 생략)
    fetchBcastPayload().then((data) => {
      if (!data) return;
      setRemote(data.broadcasts);
      setGameEvents(data.events);
    });
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // 진행중 이벤트 팝오버 — 바깥 클릭/Esc로 닫기
  useEffect(() => {
    if (!evOpen) return;
    const onDoc = (event: MouseEvent) => { if (!evRef.current?.contains(event.target as Node)) setEvOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setEvOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [evOpen]);
  if (now == null) return null;
  const statics = (broadcastsData.broadcasts as Broadcast[]).filter((b) => !Number.isNaN(Date.parse(b.start)));
  const seen = new Set((remote ?? []).map(bcastKey));
  const all = [
    ...(remote ?? []).filter((b) => !Number.isNaN(Date.parse(b.start))),
    ...statics.filter((b) => !seen.has(bcastKey(b))),
  ];

  // ── 진행중 게임 이벤트 배지 (공식 방송 버튼 오른쪽) ──
  // 굵직한 이벤트(사이드스토리 등) 우선 + 최신 시작순으로 대표 하나를 버튼에,
  // 나머지는 팝오버 목록에. 로그인·출석·기원류 잔이벤트는 sortRunning에서 제외한다
  // (대표 이벤트만 노출 — 사용자 확정 2026-07-17).
  const running = sortRunning(gameEvents, now);
  const headline = running[0];
  const evName = (event: GameEvent): string => eventName(locale, event);
  const dday = (event: GameEvent): number => eventDday(event, now);
  // 드롭다운: "2026년 7월 16일" 연·월·일 / 배지: "7월 16일" 월·일 (사용자 요청 2026-07)
  const md = (iso: string): string =>
    new Intl.DateTimeFormat(DT_LOCALE[locale], { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
  const mdLong = (iso: string): string =>
    new Intl.DateTimeFormat(DT_LOCALE[locale], { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(new Date(iso));
  // 스토리 탭용으로 이미 받아둔 이벤트 배너를 재활용 (로케일 변형 → ko 폴백)
  const evThumb = (event: GameEvent): string | undefined => eventThumb(locale, event);
  const headlineThumb = headline ? evThumb(headline) : undefined;
  const eventBadge = headline && (
    <div className="event-group" ref={evRef}>
      {/* 대표 이벤트는 배너째로 버튼에 — 헤더 정가운데, 라벨·기간 포함 (사용자 요청 2026-07).
          클릭하면 나머지 이벤트 드롭다운. */}
      <button type="button" className={`event-trigger${headlineThumb ? " has-banner" : ""}`} aria-expanded={evOpen}
        onClick={() => setEvOpen((o) => !o)} title={t("진행중인 이벤트 보기")}>
        {headlineThumb
          ? <span className="event-trigger-thumb"><img src={headlineThumb} alt="" /></span>
          : <span className="event-mark" aria-hidden>✦</span>}
        <span className="event-trigger-main">
          <small className="event-kicker">{t("현재 진행중 이벤트")}</small>
          <span className="event-name">{evName(headline)}</span>
          <span className="event-dates">{mdLong(headline.start)} ~ {mdLong(headline.end)} · D-{dday(headline)}</span>
        </span>
        <span className="event-caret" aria-hidden>▾</span>
      </button>
      {evOpen && (
        <div className="event-menu" role="dialog" aria-label={t("진행중 이벤트")}>
          <h3>{t("진행중 이벤트")}</h3>
          <ul>
            {running.map((event) => {
              // 대표 배너는 버튼에 이미 보이므로 드롭다운에서는 중복 표시하지 않는다
              const thumb = event.id === headline.id ? undefined : evThumb(event);
              const body = (
                <>
                  {thumb && <span className="event-banner"><img src={thumb} alt="" loading="lazy" /></span>}
                  <span className="event-row-name">{evName(event)}</span>
                  <small>{md(event.start)} ~ {md(event.end)} · D-{dday(event)}</small>
                </>
              );
              // 링크는 공식 카페 이벤트 공지로 (사용자 요청 2026-07 — 스토리 요약 아님)
              return (
                <li key={event.id}>
                  {event.url
                    ? <a href={event.url} target="_blank" rel="noopener noreferrer" title={t("공식 카페 공지 보기")}>{body}</a>
                    : <span className="event-row-plain">{body}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );

  if (all.length === 0) return eventBadge || null;
  // 정렬: 생방송 > 가까운 예약 > 최근 지난 방송 (세 서버 전부 목록에 표시)
  const sorted = [...all].sort((a, b) => {
    const sa = bcastState(a, now), sb = bcastState(b, now);
    if (STATE_RANK[sa] !== STATE_RANK[sb]) return STATE_RANK[sa] - STATE_RANK[sb];
    return sa === "past" ? Date.parse(b.start) - Date.parse(a.start) : Date.parse(a.start) - Date.parse(b.start);
  });
  // 헤더 버튼 힌트: 생방송이 있으면 LIVE, 없으면 가장 가까운 예약을 표시
  const liveOne = all.find((b) => bcastState(b, now) === "live");
  const nextUp = all.filter((b) => bcastState(b, now) === "upcoming").sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  const hint = liveOne ? { cls: "live", text: t("생방송 중") } : nextUp ? { cls: "upcoming", text: t("예약 {s}", { s: shortStatus(nextUp, now) }) } : null;
  return (
    <>
      <button type="button" className={`bcast-trigger ${hint?.cls ?? ""}`} onClick={() => setOpen(true)} title={t("명일방주 한국·일본·글로벌 공식 방송 일정 보기")}>
        <YtIcon />
        <span>{t("공식 방송")}</span>
        {hint && <span className="bcast-hint">· {hint.text}</span>}
      </button>
      {/* 진행중 게임 이벤트 배지 — 공식 방송 버튼 바로 오른쪽 (사용자 요청 2026-07) */}
      {eventBadge}
      {/* 사이트 헤더의 backdrop-filter가 fixed 기준을 헤더로 만들어버리므로,
          모달은 portal로 body에 직접 렌더링해야 화면 전체를 덮는다 */}
      {open && createPortal(
        <div className="modal-backdrop bcast-backdrop" onClick={() => setOpen(false)}>
          <div className="bcast-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-label={t("명일방주 공식 방송 일정")}>
            <header>
              <h2><YtIcon /> {t("명일방주 공식 방송")}</h2>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label={t("닫기")}>×</button>
            </header>
            <div className="bcast-list">
              {sorted.map((b) => {
                const st = bcastState(b, now);
                const meta = SERVER_META[b.server] ?? { code: b.server.toUpperCase(), label: b.server };
                const stateLabel = st === "live" ? t("● 생방송 중") : st === "upcoming" ? t("예약됨 ({s})", { s: shortStatus(b, now) }) : t("지난 방송");
                const dateLine =
                  st === "live" ? t("지금 방송 중")
                    : st === "upcoming" ? t("{date} 예정", { date: fmtDate(locale, b.start, true) })
                      : t("{date} 방송", { date: fmtDate(locale, b.start, false) });
                const body = (
                  <>
                    <BroadcastThumb b={b} />
                    <div className="bcast-info">
                      <div className="bcast-top">
                        <span className={`bcast-server ${b.server}`}>{t("{label} 서버", { label: t(meta.label) })}</span>
                        <span className={`bcast-state ${st}`}>{stateLabel}</span>
                      </div>
                      <strong>{b.title}</strong>
                      <span className="bcast-date">{dateLine}</span>
                    </div>
                  </>
                );
                return b.url ? (
                  <a key={`${b.server}-${b.start}`} className={`bcast-card ${st}`} href={b.url} target="_blank" rel="noopener noreferrer">{body}</a>
                ) : (
                  <div key={`${b.server}-${b.start}`} className={`bcast-card ${st}`}>{body}</div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── 언어 전환 (서버 칩 드롭다운) ─────────────────────────────────────────────
// 언어는 경로(/ /en /ja)로 나뉘므로 전환은 전체 내비게이션 — 해시(탭·오퍼 모달)는 유지
function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  const current = LOCALES.find((entry) => entry.code === locale) ?? LOCALES[0];
  // 언어 전환 시 탑페이지로 가지 않고 현재 탭(세그먼트)·해시를 유지한 채 로케일만 바꾼다
  const switchTo = (code: Locale) => {
    try { localStorage.setItem("ta-locale", code); } catch { /* ignore */ }
    if (code === locale) return;
    const seg = TAB_SEG[tabFromPath(window.location.pathname)];
    const target = (LOCALE_BASE[code] + (seg ? `/${seg}` : "")) || "/";
    window.location.assign(target + window.location.hash);
  };
  return (
    <div className="lang-wrap">
      <button type="button" className="server-chip" aria-haspopup="listbox" aria-expanded={open} aria-label={t("언어 선택")}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>
        <span /> {current.chip} <i aria-hidden>▾</i>
      </button>
      {open && (
        <div className="lang-menu" role="listbox" aria-label={t("언어 선택")}>
          {LOCALES.map((entry) => (
            <button key={entry.code} type="button" role="option" aria-selected={entry.code === locale}
              className={entry.code === locale ? "selected" : ""}
              onClick={() => switchTo(entry.code)}>
              {entry.label}<small>{entry.chip}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Nickname = { name: string; votes: number };

// 별명은 제보 3회 이상 쌓여야 노출·검색에 반영된다 (스팸·오타 필터)
const NICKNAME_MIN_VOTES = 3;

// 같은 (오퍼, 별명) 중복 제보를 이 브라우저에서 막는 가드
const NICK_SENT_KEY = "ta-nick-sent";
function nickAlreadySent(opId: string, name: string): boolean {
  try { return (JSON.parse(localStorage.getItem(NICK_SENT_KEY) ?? "[]") as string[]).includes(`${opId} ${name}`); } catch { return false; }
}
function rememberNickSent(opId: string, name: string) {
  try {
    const sent = new Set(JSON.parse(localStorage.getItem(NICK_SENT_KEY) ?? "[]") as string[]);
    sent.add(`${opId} ${name}`);
    localStorage.setItem(NICK_SENT_KEY, JSON.stringify(Array.from(sent)));
  } catch { /* ignore */ }
}

// 포탈 첫화면 — 루트(/)의 랜딩. 각 도구로 가는 큰 버튼만 두어, 진입 시 오퍼 이미지 로딩이
// 전혀 없다 (사용자 확정 2026-07-17: 데이터 소진 방지). 오퍼 백과사전은 여기서 /operators로 이동.
function Portal({ onOpenTab }: { onOpenTab: (tab: Tab) => void }) {
  const { t } = useI18n();
  const cards: { tab: Tab; icon: string; name: string; desc: string }[] = [
    { tab: "archive", icon: "▤", name: t("오퍼 백과사전"), desc: t("소속·직군·태그·시너지로 필터·검색하는 오퍼레이터 도감") },
    { tab: "planner", icon: "⌂", name: t("인프라 자동편성기"), desc: t("보유 오퍼만 입력하면 기반시설 편성을 자동으로 계산") },
    { tab: "recruit", icon: "◎", name: t("공채 도우미"), desc: t("공개모집 태그 조합으로 확정·고성급 오퍼를 탐색") },
    { tab: "farm", icon: "◈", name: t("파밍·육성 시뮬"), desc: t("재료 파밍 효율표와 오퍼 육성 비용 시뮬레이션") },
    { tab: "story", icon: "✦", name: t("AI 스토리 요약"), desc: t("이벤트 스토리를 컷씬과 함께 10분 분량으로 요약") },
  ];
  return (
    <section className="portal" aria-labelledby="portal-title">
      <div className="portal-hero">
        <span className="portal-kicker">TERRA ARCHIVE</span>
        <h1 id="portal-title">{t("테라 아카이브")}</h1>
        <p>{t("명일방주(아크나이츠) KR 팬사이트 — 필요한 도구를 골라 들어가세요.")}</p>
      </div>
      <div className="portal-grid">
        {cards.map((card) => (
          <button key={card.tab} type="button" className={`portal-card portal-${card.tab}`}
            onClick={() => { onOpenTab(card.tab); window.scrollTo({ top: 0 }); }}>
            <span className="portal-card-icon" aria-hidden>{card.icon}</span>
            <span className="portal-card-body"><b>{card.name}</b><small>{card.desc}</small></span>
            <span className="portal-card-go" aria-hidden>→</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function Home({ locale, operators, extra, initialTab = "portal" }: { locale: Locale; operators: Operator[]; extra: ExtraI18n | null; initialTab?: Tab }) {
  return (
    <I18nProvider locale={locale}>
      <HomeInner operators={operators} extra={extra} initialTab={initialTab} />
    </I18nProvider>
  );
}

// '미래시 포함' 토글 localStorage 키 — 켜면 한국 서버 미실장(CN 선행) 오퍼도 목록에 표시
const FUTURE_KEY = "ta-include-future";

function HomeInner({ operators, extra, initialTab }: { operators: Operator[]; extra: ExtraI18n | null; initialTab: Tab }) {
  const { locale, t } = useI18n();
  // SSR엔 localStorage가 없으므로 false로 하이드레이션 후 이펙트에서 복원한다.
  // 우선순위: URL 쿼리(?future=1|0) > localStorage. URL 파라미터는 공유 링크용.
  const [includeFuture, setIncludeFuture] = useState(false);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("future");
    if (fromUrl === "1") { setIncludeFuture(true); return; }
    if (fromUrl === "0") { setIncludeFuture(false); return; }
    try { if (localStorage.getItem(FUTURE_KEY) === "1") setIncludeFuture(true); } catch { /* ignore */ }
  }, []);
  const toggleFuture = (on: boolean) => {
    setIncludeFuture(on);
    try { localStorage.setItem(FUTURE_KEY, on ? "1" : "0"); } catch { /* ignore */ }
    // 공유용 URL 파라미터도 갱신 (다른 파라미터는 보존)
    const url = new URL(window.location.href);
    if (on) url.searchParams.set("future", "1"); else url.searchParams.delete("future");
    window.history.replaceState(null, "", url);
  };
  // 백과사전 목록·필터·카운트가 쓰는 로스터 — 미래시 꺼짐(기본)이면 미실장 오퍼 제외.
  // 딥링크(#op-…)·플래너발 모달 열기는 전체 operators에서 찾으므로 토글과 무관하게 동작.
  const roster = useMemo(() => (includeFuture ? operators : operators.filter((operator) => !operator.unreleased)), [operators, includeFuture]);
  const [selectedFactions, setSelectedFactions] = useState<string[]>([]);
  const [selectedConcepts, setSelectedConcepts] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [selectedSubProfessions, setSelectedSubProfessions] = useState<string[]>([]);
  const [selected, setSelected] = useState<Operator | null>(null);
  // 경로 기반 라우팅: 서버가 라우트별로 올바른 탭을 렌더하므로 initialTab을 그대로
  // 초기값으로 쓴다 (SSR/클라이언트 첫 렌더 일치 → hydration mismatch 없음).
  const [tab, setTab] = useState<Tab>(initialTab);
  const [navOpen, setNavOpen] = useState(false); // 모바일 탭 메뉴(햄버거) 열림 상태
  const localeBase = LOCALE_BASE[locale];
  // 탭 → 로케일 포함 경로 (예: planner + en → "/en/infra", archive + ko → "/").
  // 전역 파라미터(future)는 탭을 옮겨도 URL에 유지한다 (공유·일관성). ops 같은 탭 전용
  // 파라미터는 해당 탭이 직접 관리하므로 여기서 실어 나르지 않는다.
  const tabPath = useCallback((tb: Tab) => {
    const seg = TAB_SEG[tb];
    const base = (localeBase + (seg ? `/${seg}` : "")) || "/";
    const fut = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("future") === "1";
    return fut ? `${base}?future=1` : base;
  }, [localeBase]);

  // 필터 항목은 전부 현재 로케일 데이터에서 유도한다 — 값과 표시가 항상 일치
  const factions = useMemo(() =>
    Array.from(new Set(roster.flatMap((operator) => operator.factions))).sort((a, b) => a.localeCompare(b, locale)),
    [roster, locale]);
  const concepts = useMemo(() => {
    const counts = new Map<string, number>();
    roster.forEach((operator) => operator.concepts.forEach((concept) => counts.set(concept, (counts.get(concept) ?? 0) + 1)));
    return [
      ...SYNERGY_POTS.filter((pot) => counts.has(pot)),
      ...Array.from(counts.keys()).filter((concept) => !SYNERGY_POTS.includes(concept)).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)),
    ];
  }, [roster]);
  const combatTags = useMemo(() =>
    // 데이터에 빈 문자열 태그가 섞여 들어온 사례(예비 오퍼레이터·하디야)가 있어 걸러낸다
    Array.from(new Set(roster.flatMap((operator) => operator.combatTags))).filter((tag) => tag.trim().length > 0).sort((a, b) => a.localeCompare(b, locale)),
    [roster, locale]);
  const jobs = useMemo(() => {
    const byCode = new Map<string, string>();
    roster.forEach((operator) => { if (!byCode.has(operator.jobCode)) byCode.set(operator.jobCode, operator.job); });
    return JOB_ORDER.map((code) => byCode.get(code)).filter((job): job is string => Boolean(job));
  }, [roster]);
  const subProfessions = useMemo(() =>
    Array.from(new Set(roster.map((operator) => operator.subProfession))).sort((a, b) => a.localeCompare(b, locale)),
    [roster, locale]);
  const positionMethods = useMemo(() => [t("근거리"), t("원거리")], [t]);
  const attackMethods = useMemo(() => [...positionMethods, t("물리"), t("마법")], [positionMethods, t]);
  const damageTypeOf = (operator: Operator) => (MAGIC_TRAIT_RE[locale].test(operator.trait) ? t("마법") : t("물리"));

  // 커뮤니티 제보 별명 — (오퍼 id → 득표순 목록). 검색 대상에도 병합된다.
  const [nicknames, setNicknames] = useState<Map<string, Nickname[]>>(new Map());

  useEffect(() => {
    fetchNicknameCounts()
      .then((rows) => {
        const byOp = new Map<string, Nickname[]>();
        for (const row of rows) {
          const list = byOp.get(row.op_id) ?? [];
          list.push({ name: row.name, votes: row.votes });
          byOp.set(row.op_id, list);
        }
        for (const list of byOp.values()) list.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "ko"));
        setNicknames(byOp);
      })
      .catch(() => { /* 별명 서버 불통이어도 사이트는 정상 동작 */ });
  }, []);

  const handleSubmitNickname = async (opId: string, rawName: string): Promise<string> => {
    const name = rawName.trim().replace(/\s+/g, " ");
    if (name.length < 1) return t("별명을 입력해 주세요");
    if (name.length > 16) return t("별명은 16자 이내로 부탁드려요");
    if (nickAlreadySent(opId, name)) return t("이미 이 별명을 제보하셨어요, 감사합니다!");
    await submitNickname(opId, name);
    rememberNickSent(opId, name);
    // 낙관적 반영 — 새로고침 없이 득표가 즉시 갱신돼 보인다
    setNicknames((current) => {
      const next = new Map(current);
      const list = [...(next.get(opId) ?? [])];
      const idx = list.findIndex((item) => item.name === name);
      if (idx >= 0) list[idx] = { ...list[idx], votes: list[idx].votes + 1 };
      else list.push({ name, votes: 1 });
      list.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "ko"));
      next.set(opId, list);
      return next;
    });
    return "";
  };

  // 모달을 열 때 히스토리를 쌓았는지 여부 — 뒤로가기(popstate)가 모달만 닫도록
  const pushedModalRef = useRef(false);

  // 루트 레이아웃은 lang="ko" 고정이라, 로케일 라우트에서는 클라이언트에서 맞춘다
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useLayoutEffect(() => {
    // 구 해시 링크(#infra 등) 하위호환 — 서버는 경로 기준으로 archive를 렌더하므로,
    // 첫 페인트 script가 data-route로 잠깐 가려둔 걸 경로로 치환하고 탭을 맞춘다.
    const legacyHash = decodeURIComponent(window.location.hash);
    const legacy = tabFromLegacyHash(legacyHash);
    if (legacy) {
      setTab(legacy);
      // 스토리 상세 해시(#story-<id>)는 story.tsx가 읽으므로 경로 치환 시 보존한다
      const keep = legacyHash.startsWith("#story-") ? legacyHash : "";
      history.replaceState(null, "", tabPath(legacy) + keep);
    }
    // React가 탭을 제어하므로 data-route(첫 페인트 플래시 방지용)는 이제 해제한다.
    document.documentElement.removeAttribute("data-route");

    // 첫 진입이 딥링크(/#op-xxx)면 모달을 연다 (탭은 initialTab=경로 기준으로 이미 맞음).
    const hash0 = decodeURIComponent(window.location.hash);
    if (hash0.startsWith("#op-")) {
      const op = operators.find((candidate) => candidate.id === hash0.slice(4));
      if (op) setSelected(op);
    }

    // 뒤로/앞으로 및 해시 변경 시 URL(경로+해시)로 탭·모달을 동기화한다.
    const syncFromUrl = () => {
      const hash = decodeURIComponent(window.location.hash);
      setTab(tabFromPath(window.location.pathname));
      if (hash.startsWith("#op-")) {
        const operator = operators.find((candidate) => candidate.id === hash.slice(4));
        if (operator) setSelected(operator);
        return;
      }
      // op 해시가 아니면 열려 있던 모달을 닫는다 (뒤로가기로 닫기)
      pushedModalRef.current = false;
      setSelected(null);
    };
    window.addEventListener("hashchange", syncFromUrl);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener("hashchange", syncFromUrl);
      window.removeEventListener("popstate", syncFromUrl);
    };
    // operators는 라우트 수명 동안 불변 (로케일 전환 = 전체 내비게이션)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 스크롤 복원: 페이지(탭·스토리) 이동 시 top으로, 뒤로/앞으로 시 직전 스크롤 복구.
  // pushState를 감싸 (1) 떠나는 위치 저장 (2) 엔트리에 고유 키 부여 (3) 페이지가 바뀌면 top.
  // (오퍼 모달은 #op- 해시만 바뀌거나 URL이 그대로라 '같은 페이지'로 보고 스크롤을 건드리지 않는다)
  useEffect(() => {
    if (typeof window === "undefined" || !("scrollRestoration" in history)) return;
    history.scrollRestoration = "manual";
    const store = new Map<number, number>();
    const pageId = (href: string) => { const u = new URL(href); return u.pathname + (u.hash.startsWith("#op-") ? "" : u.hash); };
    const freshKey = () => Date.now() + Math.random();
    const keyOf = (): number | null => (history.state && typeof (history.state as { __k?: number }).__k === "number") ? (history.state as { __k: number }).__k : null;
    if (keyOf() === null) history.replaceState({ ...(history.state as object || {}), __k: freshKey() }, "");
    let curKey = keyOf() as number;
    const save = () => { if (curKey != null) store.set(curKey, window.scrollY); };
    let ticking = false;
    const onScroll = () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { save(); ticking = false; }); };
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.replaceState = ((state: unknown, ...rest: [string, (string | URL | null)?]) => {
      origReplace({ ...(state as object || {}), __k: keyOf() ?? curKey }, ...rest);
    }) as typeof history.replaceState;
    history.pushState = ((state: unknown, title: string, url?: string | URL | null) => {
      const fromPage = pageId(window.location.href);
      save();
      const k = freshKey();
      origPush({ ...(state as object || {}), __k: k }, title, url as string);
      curKey = k;
      if (pageId(window.location.href) !== fromPage) { store.set(k, 0); window.scrollTo(0, 0); }
      else store.set(k, window.scrollY);
    }) as typeof history.pushState;
    const onPop = () => {
      const k = keyOf();
      curKey = k ?? freshKey();
      if (k === null) origReplace({ ...(history.state as object || {}), __k: curKey }, "");
      const y = k != null && store.has(k) ? store.get(k)! : 0;
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPop);
    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // 모바일 sticky 요소(스토리 레일)가 가변 높이 헤더 아래에 붙도록 헤더 높이를 CSS 변수로 노출
  useEffect(() => {
    if (typeof window === "undefined") return;
    const header = document.querySelector<HTMLElement>(".site-header");
    if (!header) return;
    const apply = () => document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    window.addEventListener("resize", apply);
    return () => { observer.disconnect(); window.removeEventListener("resize", apply); };
  }, []);

  // 탭·오퍼 모달에 맞춰 문서 제목 갱신 — 검색엔진 렌더링·북마크·공유 미리보기에 반영
  useEffect(() => {
    document.title = selected
      ? t("{name} - 명일방주 오퍼레이터 | 테라 아카이브", { name: selected.name })
      : tab === "planner"
        ? t("인프라 자동편성기 - 명일방주 기반시설 편성 | 테라 아카이브")
        : tab === "recruit"
          ? t("공채 도우미 - 명일방주 공개모집 계산기 | 테라 아카이브")
          : tab === "farm"
            ? t("재료 파밍 & 오퍼 육성 시뮬레이션 - 명일방주 파밍·육성 계산기 | 테라 아카이브")
            : tab === "story"
              ? t("AI 스토리 요약 - 명일방주 스토리 요약 | 테라 아카이브")
              : tab === "archive"
                ? t("오퍼레이터 백과사전 - 명일방주 오퍼 도감 | 테라 아카이브")
                : t("테라 아카이브 | 명일방주(Arknights) KR 팬사이트");
  }, [tab, selected, t]);

  const openOperator = (operator: Operator) => {
    setSelected(operator);
    history.pushState(null, "", `${tabPath(tab)}#op-${operator.id}`);
    pushedModalRef.current = true;
  };
  const closeOperator = () => {
    if (pushedModalRef.current) {
      pushedModalRef.current = false;
      history.back(); // popstate → syncFromUrl이 모달을 닫고 이전 URL 복원
      return;
    }
    setSelected(null);
    history.replaceState(null, "", tabPath(tab));
  };
  // 플래너 등 다른 탭 위에서 모달만 띄울 때 — URL은 그대로 두고 히스토리만 한 칸 쌓는다
  const showOperatorById = (id: string) => {
    const operator = operators.find((candidate) => candidate.id === id);
    if (!operator) return;
    setSelected(operator);
    history.pushState(null, "", window.location.href);
    pushedModalRef.current = true;
  };

  const TAB_LABEL: Record<Tab, string> = {
    portal: t("홈"),
    archive: t("오퍼 백과사전"),
    planner: t("인프라 자동편성기"),
    recruit: t("공채 도우미"),
    farm: t("파밍·육성 시뮬"),
    story: t("AI 스토리 요약"),
    about: t("소개"),
  };
  const switchTab = (next: Tab) => {
    setNavOpen(false);
    if (next === tab && !selected) return;
    setTab(next);
    setSelected(null);
    history.pushState(null, "", tabPath(next));
  };
  const [sortKey, setSortKey] = useState("기본");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    if (!selected) return;
    const body = document.body;
    const saved = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    // 모바일은 window가 스크롤러 — iOS Safari는 body{overflow:hidden}만으론 스크롤이
    // 튀므로(닫을 때 맨 위로 점프) position:fixed로 잠그고 닫을 때 정확히 복원한다.
    // 그래서 오퍼 상세를 닫으면 보던 오퍼 위치 그대로 돌아온다 (사용자 요청 2026-07).
    // 데스크탑은 목록이 .results 내부 스크롤이라 body 잠금만으로 충분하다.
    const mobile = window.matchMedia("(max-width: 1180px)").matches;
    const scrollY = window.scrollY;
    if (mobile) {
      body.style.position = "fixed";
      body.style.top = `-${scrollY}px`;
      body.style.width = "100%";
    } else {
      body.style.overflow = "hidden";
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOperator();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      body.style.position = saved.position;
      body.style.top = saved.top;
      body.style.width = saved.width;
      body.style.overflow = saved.overflow;
      if (mobile) window.scrollTo(0, scrollY);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selected]);

  // 햄버거 드롭다운은 바깥 클릭·Esc로 닫는다 (데스크탑·모바일 공통 드롭다운)
  useEffect(() => {
    if (!navOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".main-tabs") && !target.closest(".nav-toggle")) setNavOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setNavOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [navOpen]);

  // 모바일: 햄버거 드롭다운이 열려 있는 동안 배경 페이지 스크롤을 잠근다
  // (iOS 사파리는 body overflow:hidden만으로는 안 막혀 position:fixed 방식 사용)
  useEffect(() => {
    if (!navOpen || !window.matchMedia("(max-width: 760px)").matches) return;
    const scrollY = window.scrollY;
    const { position, top, width } = document.body.style;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    return () => {
      document.body.style.position = position;
      document.body.style.top = top;
      document.body.style.width = width;
      window.scrollTo(0, scrollY);
    };
  }, [navOpen]);

  const filtered = useMemo(() => {
    const keyword = normSearch(query);
    return roster.filter((operator) => {
      const matchesFaction = selectedFactions.length === 0 || selectedFactions.some((faction) => operator.factions.includes(faction));
      const matchesConcept = selectedConcepts.length === 0 || selectedConcepts.some((concept) => operator.concepts.includes(concept));
      const positionPicks = selectedMethods.filter((method) => positionMethods.includes(method));
      const damagePicks = selectedMethods.filter((method) => !positionMethods.includes(method));
      const matchesMethod = (positionPicks.length === 0 || positionPicks.includes(operator.position)) && (damagePicks.length === 0 || damagePicks.includes(damageTypeOf(operator)));
      const matchesTags = tags.every((tag) => operator.combatTags.includes(tag));
      const matchesJob = selectedJobs.length === 0 || selectedJobs.includes(operator.job);
      const matchesSubProfession = selectedSubProfessions.length === 0 || selectedSubProfessions.includes(operator.subProfession);
      const communityNicknames = nicknames.get(operator.id)?.filter((nick) => nick.votes >= NICKNAME_MIN_VOTES).map((nick) => nick.name) ?? [];
      const conceptNames = operator.concepts.map((concept) => conceptName(locale, concept));
      const matchesQuery = !keyword || normSearch([operator.name, operator.code, operator.job, operator.subProfession, operator.position, ...operator.combatTags, ...operator.factions, operator.reason, ...operator.aliases, ...communityNicknames, ...operator.concepts, ...conceptNames].join(" ")).includes(keyword);
      return matchesFaction && matchesConcept && matchesMethod && matchesTags && matchesJob && matchesSubProfession && matchesQuery;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, selectedFactions, selectedConcepts, selectedMethods, tags, selectedJobs, selectedSubProfessions, query, nicknames, locale]);

  const reset = () => {
    setSelectedFactions([]);
    setSelectedConcepts([]);
    setSelectedMethods([]);
    setTags([]);
    setSelectedJobs([]);
    setSelectedSubProfessions([]);
    setQuery("");
  };

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (value: string) =>
    setter((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  const toggleTag = toggleIn(setTags);

  const hasActiveFilter = selectedFactions.length > 0 || selectedConcepts.length > 0 || selectedMethods.length > 0 || tags.length > 0 || selectedJobs.length > 0 || selectedSubProfessions.length > 0 || query.trim().length > 0;

  const sorted = useMemo(() => {
    if (sortKey === "기본") {
      const base = [...filtered].sort((a, b) => b.rarity - a.rarity || b.seq - a.seq);
      return sortAsc ? base : base.reverse();
    }
    const valueOf = (operator: Operator): string | number => {
      switch (sortKey) {
        case "이름": return operator.name;
        case "성급": return operator.rarity;
        case "발매순": return operator.seq; // KR 출시 순서 (↑ 오래된 순 / ↓ 최신 순)
        case "소속": return operator.faction;
        case "출신지": return operator.birthplace ?? "";
        case "종족": return operator.race ?? "";
        case "직군": return jobs.indexOf(operator.job);
        case "세부 직군": return operator.subProfession;
        default: return 0;
      }
    };
    const direction = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = valueOf(a);
      const right = valueOf(b);
      const compared = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), locale);
      return compared !== 0 ? compared * direction : a.name.localeCompare(b.name, locale);
    });
  }, [filtered, sortKey, sortAsc, jobs, locale]);

  return (
    <main className={tab === "archive" ? "" : tab === "portal" ? "base-main portal-main" : "base-main"}>
      <header className="site-header" id="top">
        <a className="brand" href={localeBase || "/"} aria-label={t("테라 아카이브 홈")}
          onClick={(event) => { event.preventDefault(); switchTab("portal"); window.scrollTo({ top: 0 }); }}>
          <span className="brand-mark"><img src="/avatars/char_1012_skadi2.webp" alt="" /></span>
          <span>{t("테라 아카이브")}<small>{t("명일방주(Arknights) KR 팬사이트")}</small></span>
        </a>
        <BroadcastBadges />
        {/* 미래시 토글 = 우측 그룹의 첫 요소(margin-left:auto). 햄버거 버튼 바로 왼쪽 (사용자 배치 지시 2026-07) */}
        <label className="future-toggle" title={t("한국 서버에 아직 나오지 않은 오퍼레이터·재료(중국 서버 데이터)도 목록·계산기에 표시합니다. 미실장 텍스트는 비공식 AI 번역입니다.")}>
          <input type="checkbox" checked={includeFuture} onChange={(event) => toggleFuture(event.target.checked)} />
          {t("미래시 데이터 포함")}
        </label>
        {/* 우측 그룹: .nav-group의 margin-left:auto로 여기부터 헤더 오른쪽 끝으로 밀어낸다.
            순서 = 햄버거 · 언어변경 · 소개(ⓘ) (사용자 배치 지시 2026-07) */}
        <div className="nav-group">
          <button type="button" className="nav-toggle" aria-expanded={navOpen} aria-label={t("메뉴 열기")} onClick={() => setNavOpen((open) => !open)}>
            <span aria-hidden>☰</span>{TAB_LABEL[tab]}
          </button>
          {/* 드롭다운은 햄버거 버튼 바로 밑에 딱 붙여 연다 (사용자 요청 2026-07) */}
          <nav className={`main-tabs${navOpen ? " open" : ""}`} aria-label={t("주요 탭")}>
            <button className={`tab-portal${tab === "portal" ? " selected" : ""}`} onClick={() => switchTab("portal")}><span className="tab-icon" aria-hidden>◇</span>{t("홈")}</button>
            <button className={`tab-archive${tab === "archive" ? " selected" : ""}`} onClick={() => switchTab("archive")}><span className="tab-icon" aria-hidden>▤</span>{t("오퍼 백과사전")}</button>
            <button className={`tab-planner${tab === "planner" ? " selected" : ""}`} onClick={() => switchTab("planner")}><span className="tab-icon" aria-hidden>⌂</span>{t("인프라 자동편성기")}</button>
            <button className={`tab-recruit${tab === "recruit" ? " selected" : ""}`} onClick={() => switchTab("recruit")}><span className="tab-icon" aria-hidden>◎</span>{t("공채 도우미")}</button>
            <button className={`tab-farm${tab === "farm" ? " selected" : ""}`} onClick={() => switchTab("farm")}><span className="tab-icon" aria-hidden>◈</span>{t("파밍·육성 시뮬")}</button>
            <button className={`tab-story${tab === "story" ? " selected" : ""}`} onClick={() => switchTab("story")}><span className="tab-icon" aria-hidden>✦</span>{t("AI 스토리 요약")}</button>
          </nav>
        </div>
        <LanguageSwitcher />
        <button type="button" className={`about-icon${tab === "about" ? " selected" : ""}`} onClick={() => switchTab("about")}
          aria-label={t("소개")} title={t("소개")}>ⓘ</button>
      </header>


      {tab === "portal" && <Portal onOpenTab={switchTab} />}

      {tab === "archive" && <section className="explorer" aria-labelledby="explorer-title">
        <div className="filter-panel">
          <div className="panel-heading">
            <div><span className="section-no">FILTER / 01</span><h2 id="explorer-title">{t("탐색 조건")}</h2></div>
            <button className="reset" onClick={reset}>↻ {t("초기화")}</button>
          </div>
          <FilterGroup title={t("컨셉덱")} items={concepts} labelFor={(item) => conceptName(locale, item)} selected={selectedConcepts} onToggle={toggleIn(setSelectedConcepts)} rows={2} countForItem={(item) => roster.filter((operator) => operator.concepts.includes(item)).length} />
          <FilterGroup title={t("직군")} items={jobs} selected={selectedJobs} onToggle={toggleIn(setSelectedJobs)} countForItem={(item) => roster.filter((operator) => operator.job === item).length} />
          <FilterGroup title={t("세부 직군")} items={subProfessions} selected={selectedSubProfessions} onToggle={toggleIn(setSelectedSubProfessions)} countForItem={(item) => roster.filter((operator) => operator.subProfession === item).length} />
          <FilterGroup title={t("전투 태그")} items={combatTags} selected={tags} onToggle={toggleTag} countForItem={(item) => roster.filter((operator) => operator.combatTags.includes(item)).length} />
          <FilterGroup title={t("공격 방식")} items={attackMethods} selected={selectedMethods} onToggle={toggleIn(setSelectedMethods)} countForItem={(item) => roster.filter((operator) => positionMethods.includes(item) ? operator.position === item : damageTypeOf(operator) === item).length} />
          <FilterGroup title={t("공식 소속")} items={factions} selected={selectedFactions} onToggle={toggleIn(setSelectedFactions)} countForItem={(item) => roster.filter((operator) => operator.factions.includes(item)).length} />

          <aside className="data-note"><span>DATA NOTE</span><p>{t("한국 서버 {count}명 · 전원 이미지 · 다국어 이름 및 커뮤니티 별명 검색 · 스킬과 재능 기반 {concepts}개 컨셉 태그를 제공합니다. 모든 필터는 토글식이며 아무것도 선택하지 않으면 전체가 표시됩니다.", { count: roster.length, concepts: concepts.length })}</p></aside>
        </div>

        <div className="results">
          <div className="results-heading">
            <div><span className="section-no">RESULT / 02</span><h2>{selectedConcepts.length === 1 ? t("{concept} 컨셉덱", { concept: conceptName(locale, selectedConcepts[0]) }) : selectedFactions.length === 1 ? selectedFactions[0] : hasActiveFilter ? t("탐색 결과") : t("전체 오퍼레이터")}</h2></div>
            <div className="search-wrap heading-search">
              <span>⌕</span>
              <input id="operator-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("이름, 별명, 직군, 효과 검색")} />
              {query && <button type="button" className="search-clear" onClick={() => setQuery("")} aria-label={t("검색어 지우기")}>×</button>}
            </div>
            <div className="results-tools">
              <label className="sort-wrap">
                <span>{t("정렬")}</span>
                <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
                  {SORT_KEYS.map((key) => <option key={key} value={key}>{t(key)}</option>)}
                </select>
                <button type="button" className="sort-direction" onClick={() => setSortAsc((current) => !current)} aria-label={sortAsc ? t("내림차순으로 변경") : t("오름차순으로 변경")}>{sortAsc ? "↑" : "↓"}</button>
              </label>
              <span className="count"><b>{sorted.length}</b> OPERATORS</span>
            </div>
          </div>
          <div className="active-filters">
            {selectedFactions.map((item) => <button key={`f-${item}`} onClick={() => toggleIn(setSelectedFactions)(item)}>{item} ×</button>)}
            {selectedConcepts.map((item) => <button key={`c-${item}`} onClick={() => toggleIn(setSelectedConcepts)(item)}>{conceptName(locale, item)} ×</button>)}
            {selectedMethods.map((item) => <button key={`p-${item}`} onClick={() => toggleIn(setSelectedMethods)(item)}>{item} ×</button>)}
            {tags.map((tag) => <button key={`t-${tag}`} onClick={() => toggleTag(tag)}>{tag} ×</button>)}
            {selectedJobs.map((item) => <button key={`j-${item}`} onClick={() => toggleIn(setSelectedJobs)(item)}>{item} ×</button>)}
            {selectedSubProfessions.map((item) => <button key={`s-${item}`} onClick={() => toggleIn(setSelectedSubProfessions)(item)}>{item} ×</button>)}
            {query && <button onClick={() => setQuery("")}>“{query}” ×</button>}
          </div>

          {sorted.length > 0 ? (
            <div className="operator-grid">
              {sorted.map((operator, index) => <OperatorCard key={operator.id ?? `${operator.name}-${index}`} operator={operator} index={index} onSelect={openOperator} />)}
            </div>
          ) : (
            <div className="empty"><span>NO MATCH</span><h3>{t("조건에 맞는 오퍼레이터가 없어요.")}</h3><p>{t("소속이나 컨셉 태그를 하나씩 해제해 보세요.")}</p><button onClick={reset}><span className="btn-icon" aria-hidden>↻</span>{t("전체 보기")}</button></div>
          )}
        </div>
      </section>}

      {tab === "planner" && <InfraPlanner onShowOperator={showOperatorById} extra={extra} includeFuture={includeFuture} />}
      {tab === "recruit" && <RecruitHelper onShowOperator={showOperatorById} extra={extra} />}
      {tab === "farm" && <FarmGuide operators={operators} includeFuture={includeFuture} onShowOperator={showOperatorById} />}
      {tab === "story" && <StoryGuide onShowOperator={showOperatorById} includeFuture={includeFuture} />}
      {tab === "about" && <About onOpenTab={switchTab} />}

      {selected && <OperatorModal operator={selected} nicknames={nicknames.get(selected.id) ?? []} onSubmitNickname={handleSubmitNickname} onClose={closeOperator} />}
      <FeedbackWidget />

      <footer><span>RHODES ISLAND // TERRA ARCHIVE</span><p>{t("명일방주(Arknights) 비공식 팬 프로젝트 · 게임 내 명칭과 데이터의 권리는 Hypergryph / Yostar 등 각 권리자에게 있습니다.")}</p></footer>
    </main>
  );
}

// rows줄까지만 보여주고 넘치는 항목은 더보기로 접는다 (기본 1줄, 컨셉덱만 2줄)
function FilterGroup({ title, items, selected, onToggle, rows = 1, countForItem, labelFor }: { title: string; items: string[]; selected: string[]; onToggle: (value: string) => void; rows?: number; countForItem: (item: string) => number; labelFor?: (item: string) => string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [clamp, setClamp] = useState<number | null>(null);   // 접힌 상태 max-height(px)
  const [hiddenCount, setHiddenCount] = useState(0);          // 접혀서 안 보이는 항목 수

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const children = Array.from(el.children) as HTMLElement[];
      if (!children.length) { setClamp(null); setHiddenCount(0); return; }
      const rowHeight = children[0].offsetHeight;
      const max = rows * rowHeight + (rows - 1) * 7; // gap 7px (globals.css .filter-list)
      setClamp(max);
      const baseTop = children[0].offsetTop;
      setHiddenCount(children.filter((child) => child.offsetTop - baseTop + child.offsetHeight > max + 2).length);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [items, rows]);

  return (
    <fieldset>
      <legend>{title}<small className="multi-hint">{t("복수 선택 가능 · 전부 해제 시 전체")}</small></legend>
      <div className="filter-list" ref={listRef} style={!expanded && clamp != null ? { maxHeight: clamp, overflow: "hidden" } : undefined}>
        {items.map((item) => {
          const isSelected = selected.includes(item);
          return (
            <button key={item} className={isSelected ? "selected" : ""} onClick={() => onToggle(item)} aria-pressed={isSelected}>{labelFor ? labelFor(item) : item}<span>{countForItem(item)}</span></button>
          );
        })}
      </div>
      {(hiddenCount > 0 || expanded) && (
        <button className="more-filter" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}><span className="btn-icon" aria-hidden>{expanded ? "▴" : "▾"}</span>{expanded ? t("접기") : t("더보기 +{n}", { n: hiddenCount })}</button>
      )}
    </fieldset>
  );
}

function OperatorCard({ operator, index, onSelect }: { operator: Operator; index: number; onSelect: (operator: Operator) => void }) {
  const { locale, t } = useI18n();
  return (
    <button type="button" className="operator-card" onClick={() => onSelect(operator)} aria-label={t("{name} 상세 정보 열기", { name: operator.name })} style={{ "--accent": operator.accent, "--delay": `${(index % 12) * 25}ms` } as React.CSSProperties}>
      <div className="portrait">
        <span className="portrait-grid" />
        <div className="portrait-info">
          <div className="portrait-meta"><span>{"★".repeat(operator.rarity)}</span><b>{operator.job}</b>{operator.unreleased && <em className="future-badge">{t("미실장")}</em>}</div>
          <h3>{operator.name}</h3>
          <small className="portrait-facts">
            <span><i>{t("소속")}</i>{operator.faction}</span>
            <span><i>{t("출신")}</i>{operator.birthplace ?? t("불명")}</span>
            <span><i>{t("종족")}</i>{operator.race ?? t("불명")}</span>
          </small>
        </div>
        <img src={operator.image} alt={t("{name} 오퍼레이터", { name: operator.name })} loading="lazy" decoding="async" />
      </div>
      <div className="card-body">
        <div className="tags">{operator.concepts.map((tag) => <span key={tag}>{conceptName(locale, tag)}</span>)}</div>
      </div>
    </button>
  );
}

function NicknameForm({ operator, onSubmit }: { operator: Operator; onSubmit: (opId: string, name: string) => Promise<string> }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const error = await onSubmit(operator.id, draft);
      if (error) { setMessage(error); return; }
      setDraft("");
      setMessage(t("제보 감사합니다!"));
    } catch {
      setMessage(t("전송 실패 — 잠시 후 다시 시도해주세요"));
    } finally {
      setBusy(false);
    }
  };
  if (!feedbackReady) return null;
  return (
    <div className="nickname-row">
      <span className="nickname-label">{t("별명 제보")}</span>
      <form className="nickname-form" onSubmit={submit}>
        <input value={draft} maxLength={16} placeholder={t("이 오퍼의 별명 (16자 이내)")}
          onChange={(event) => { setDraft(event.target.value); setMessage(""); }} />
        <button type="submit" disabled={busy || !draft.trim()}>{busy ? t("전송 중…") : <><span className="btn-icon" aria-hidden>✎</span>{t("제보")}</>}</button>
      </form>
      {message && <small className="nickname-msg">{message}</small>}
    </div>
  );
}

function OperatorModal({ operator, nicknames, onSubmitNickname, onClose }: { operator: Operator; nicknames: Nickname[]; onSubmitNickname: (opId: string, name: string) => Promise<string>; onClose: () => void }) {
  const { locale, t } = useI18n();
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal" role="dialog" aria-modal="true" aria-labelledby="operator-modal-title" style={{ "--accent": operator.accent } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("상세 정보 닫기")}>×</button>
        <header className="modal-hero">
          <img src={operator.image} alt={t("{name} 오퍼레이터", { name: operator.name })} />
          <div className="modal-title-block">
            <div className="modal-title-main">
              <span className="modal-kicker">OPERATOR FILE · {operator.code}</span>
              <div className="modal-name-row">
                <h2 id="operator-modal-title">{operator.name}</h2>
                {nicknames.some((nick) => nick.votes >= NICKNAME_MIN_VOTES) && (
                  <span className="nickname-inline">{nicknames.filter((nick) => nick.votes >= NICKNAME_MIN_VOTES).slice(0, 3).map((nick) => <b key={nick.name}>{nick.name}</b>)}</span>
                )}
              </div>
              <div className="modal-rarity">{"★".repeat(operator.rarity)} <span>{t("{n}성", { n: operator.rarity })}</span>{operator.unreleased && <em className="future-badge">{t("미실장")}</em>}</div>
              <div className="class-line">
                <div><b>{operator.job}</b><small>{operator.subProfession} · {operator.position}</small></div>
              </div>
              {operator.unreleased && <p className="future-note">{t("한국 서버 미실장 오퍼레이터입니다 — 중국 서버 데이터 기준이며, 스킬·재능 등 텍스트는 비공식 AI 번역이라 정식 출시 시 공식 번역과 다를 수 있습니다.")}</p>}
            </div>
            <NicknameForm key={operator.id} operator={operator} onSubmit={onSubmitNickname} />
          </div>
        </header>
        <div className="modal-scroll">
          <div className="modal-facts">
            <div><span>{t("공식 소속")}</span><b>{operator.factions.join(" · ")}</b></div>
            <div><span>{t("출신지")}</span><b>{operator.birthplace ?? t("불명")}</b></div>
            <div><span>{t("종족")}</span><b>{operator.race ?? t("불명")}</b></div>
            <div><span>{t("전투 태그")}</span><b>{operator.combatTags.length ? operator.combatTags.join(" · ") : t("태그 없음")}</b></div>
            <div><span>{t("컨셉")}</span><b>{operator.concepts.length ? operator.concepts.map((concept) => conceptName(locale, concept)).join(" · ") : t("분류 없음")}</b></div>
          </div>

          <section className="detail-section">
            <span className="detail-no">POTENTIAL / 01</span>
            <h3>{t("잠재능력")}</h3>
            {operator.potentials.length ? (
              <div className="potential-scroll">
                <div className="potential-list">
                  {operator.potentials.map((potential) => (
                    <article key={potential.rank}><span>P{potential.rank}</span><p>{potential.description}</p></article>
                  ))}
                </div>
              </div>
            ) : (
              <p className="no-detail">{t("등록된 잠재능력 정보가 없습니다.")}</p>
            )}
          </section>

          <section className="detail-section">
            <span className="detail-no">STAT / 02</span>
            <h3>{t("스탯")}</h3>
            <div className="stat-table">
              <div className="stat-row stat-head"><b>{t("육성 단계")}</b><span>HP</span><span>{t("공격")}</span><span>{t("방어")}</span><span>{t("마저")}</span><span>{t("코스트")}</span><span>{t("저지")}</span><span>{t("재배치")}</span><span>{t("공격 간격")}</span><span>{t("공격 범위")}</span></div>
              {operator.stats.map((stat) => (
                <div key={stat.phase} className="stat-row">
                  <b>{stat.phase}<small> Lv.{stat.level}</small></b>
                  <span>{stat.hp}</span>
                  <span>{stat.atk}</span>
                  <span>{stat.def}</span>
                  <span>{stat.res}</span>
                  <span>{stat.cost}</span>
                  <span>{stat.block}</span>
                  <span>{t("{n}초", { n: stat.redeploy })}</span>
                  <span>{t("{n}초", { n: stat.interval })}</span>
                  <span><AttackRange grids={stat.range} /></span>
                </div>
              ))}
            </div>
          </section>

          <section className="detail-section">
            <span className="detail-no">SKILL / 03</span>
            <h3>{t("스킬")}</h3>
            {operator.skills.length ? (
              <div className="skill-list">
                {operator.skills.map((skill, index) => (
                  <article key={skill.id} className="skill-detail">
                    <div className="skill-index">S{index + 1}</div>
                    <div>
                      <h4>{skill.name}</h4>
                      <div className="skill-meta">
                        <span>{skill.spType}</span>
                        <span>{t("초기 SP {n}", { n: skill.initialSp })}</span>
                        <span>{t("소모 SP {n}", { n: skill.spCost })}</span>
                        {skill.duration && <span>{t("지속 {n}초", { n: skill.duration })}</span>}
                      </div>
                      <p>{skill.description}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="no-detail">{t("등록된 전투 스킬이 없습니다.")}</p>
            )}
          </section>

          <section className="detail-section">
            <span className="detail-no">TALENT / 04</span>
            <h3>{t("재능")}</h3>
            {operator.talents.length ? (
              <div className="detail-list">
                {operator.talents.map((talent, index) => (
                  <article key={`${talent.name}-${index}`}><b>{talent.name}</b><p>{talent.description}</p></article>
                ))}
              </div>
            ) : (
              <p className="no-detail">{t("등록된 재능이 없습니다.")}</p>
            )}
          </section>

          <section className="detail-section">
            <span className="detail-no">TRAIT / 05</span>
            <h3>{t("특성")}</h3>
            <p>{operator.trait}</p>
          </section>

          <section className="detail-section">
            <span className="detail-no">MODULE / 06</span>
            <h3>{t("모듈")}</h3>
            {operator.modules.length ? (
              <div className="module-list">
                {operator.modules.map((module) => (
                  <article key={module.id} className="module-card">
                    <header>
                      <span>{module.type}</span>
                      <div><h4>{module.name}</h4><small>{module.unlock}</small></div>
                    </header>
                    <div className="module-levels">
                      {module.levels.map((level) => (
                        <div key={level.level}>
                          <b>STAGE {level.level}</b>
                          {level.stats && <p className="module-stats">{level.stats}</p>}
                          {level.effects.map((effect, index) => <p key={index}>{effect}</p>)}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="no-detail">{t("현재 적용 가능한 모듈이 없습니다.")}</p>
            )}
          </section>

          <section className="detail-section">
            <span className="detail-no">INFRA / 07</span>
            <h3>{t("인프라 스킬")}</h3>
            {operator.infrastructure.length ? (
              <div className="infra-list">
                {operator.infrastructure.map((infra, index) => (
                  <article key={`${infra.name}-${index}`}>
                    <div><span>{infra.room}</span><small>{infra.unlock}</small></div>
                    <section><b>{infra.name}</b><p>{infra.description}</p></section>
                  </article>
                ))}
              </div>
            ) : (
              <p className="no-detail">{t("등록된 인프라 스킬이 없습니다.")}</p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function AttackRange({ grids }: { grids: RangeGrid[] }) {
  if (!grids.length) return <small className="no-range">-</small>;
  const withOrigin = [...grids, { row: 0, col: 0 }];
  const rows = withOrigin.map((grid) => grid.row);
  const cols = withOrigin.map((grid) => grid.col);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const active = new Set(grids.map((grid) => `${grid.row}:${grid.col}`));
  const cells = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      cells.push(<i key={`${row}:${col}`} className={row === 0 && col === 0 ? "origin" : active.has(`${row}:${col}`) ? "active" : ""} />);
    }
  }
  return <span className="attack-range" style={{ gridTemplateColumns: `repeat(${maxCol - minCol + 1},8px)` }}>{cells}</span>;
}
