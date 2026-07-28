"use client";

// 3개 탭(백과사전·플래너·공채)의 공용 루트. 로케일별 라우트(/ /en /ja)가
// home-ko/en/ja.tsx 래퍼로 해당 언어의 operators 데이터를 정적 import해 넘긴다 —
// 런타임 언어 전환은 전체 내비게이션이라 이 컴포넌트 안에서 로케일은 불변이다.
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import broadcastsData from "./data/broadcasts.json";
import storyEventsData from "./data/stories.json";
import InfraPlanner from "./planner";
import RecruitHelper from "./recruit";
import FarmGuide, { UpgradeSim } from "./farm";
import { normSearch, useSearchInput } from "./search";
import OmniSearch from "./omni-search";
import BridgeButton from "./lens/bridge-button";
import { asset } from "./assets";
import ChangelogButton from "./changelog";
import TipBalloon from "./tip-balloon";
import { useHashSync } from "./hash-modal";
import type { OmniTarget } from "./omni";
import { notifyHandoff, stashHandoff } from "./handoff";
import { noteAction, noteArrival, noteMiss } from "./trail";
import StoryGuide, { type StorySummaries, type OpIndex } from "./story";
import RogueGuide, { TOPICS as ROGUE_TOPICS, slugOf as rogueSlugOf } from "./rogue";
import About from "./about";
import FeedbackWidget from "./feedback-widget";
import { bindEscClose } from "./esc-close";
import { feedbackReady } from "./feedback";
import { tabHasNewFeature } from "./whats-new";
import { scrollMainTop } from "./scroll";
import { useLazyVisible } from "./lazy-img";
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
  // 미실장(중국 서버 선행) 오퍼 — 헤더 '미래시 포함' 토글이 꺼져 있으면 숨긴다
  unreleased?: boolean;
};

const SYNERGY_POTS = ["어비설팟", "쉐이팟", "쉐라그팟", "카시미어팟", "미노스팟", "아베무팟", "소각팟", "라테라노팟", "탄약팟", "라인랩팟", "라이오스 파티"];

// 직군 표시 순서의 정본은 jobCode — 표시명은 로케일 데이터에서 뽑는다
const JOB_ORDER = ["PIONEER", "WARRIOR", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"];

const SORT_KEYS = ["기본", "이름", "성급", "발매순", "소속", "출신지", "종족", "직군", "세부 직군"];

export type Tab = "portal" | "archive" | "planner" | "recruit" | "farm" | "upgrade" | "story" | "rogue" | "about";
// 탭 ↔ URL 세그먼트 (portal이 로케일 루트, 오퍼 백과사전은 /operators — 사용자 확정 2026-07-17:
// 루트 진입 시 오퍼 이미지 강제 로딩을 없애려 포탈 첫화면 도입). seo.ts의 TAB_SEG·라우트 폴더명과 일치.
// URL 세그먼트 "stories"(← 정적 자산 디렉터리 public/story/ 와의 경로 충돌 회피). 내부 탭명은 story.
const TAB_SEG: Record<Tab, string> = { portal: "", archive: "operators", planner: "infra", recruit: "recruit", farm: "farm", upgrade: "upgrade", story: "stories", rogue: "rogue", about: "about" };
const SEG_TAB: Record<string, Tab> = { "": "portal", operators: "archive", infra: "planner", recruit: "recruit", farm: "farm", upgrade: "upgrade", stories: "story", rogue: "rogue", about: "about" };
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
  return hash === "#infra" ? "planner" : hash === "#recruit" ? "recruit" : hash === "#farm" ? "farm" : hash === "#upgrade" ? "upgrade" : hash.startsWith("#story") ? "story" : null;
}

// ── 공식 방송 ─────────────────────────────────────────────
// 방송 목록은 크론 워커(workers/broadcast — 6시간마다 유튜브 공식 채널 3개를 수집)에서
// 가져오고, 네트워크 실패 시 broadcasts.json 정적 데이터로 폴백한다. 현재 시각과 비교해
// 예약/생방송/지난방송을 분류하며, 헤더엔 요약 버튼 하나만 두고 클릭하면 전체 목록
// (유튜브 썸네일 포함) 모달을 연다. 지난 방송도 날짜와 함께 계속 남긴다.
const BCAST_API = "https://terra-archive-broadcast.nzkonaru.workers.dev/";
// cover = 중섭(비리비리) 라이브룸 커버 — 유튜브 썸네일이 없는 항목의 카드 이미지.
// key = 워커가 붙인 중복 판정 키(중섭 항목엔 videoId가 없다).
type Broadcast = { server: string; title: string; start: string; durationMin?: number; url?: string; videoId?: string; cover?: string; key?: string };
type BState = "live" | "upcoming" | "past";
// 진행중 게임 이벤트 — 워커가 KR activity_table에서 뽑아 같은 payload에 실어준다.
// 진행중 판정은 클라이언트가 start/end와 Date.now()를 비교 (워커 데이터가 묵어도 정확).
// url = 공식 네이버 카페 이벤트 공지 (워커가 제목 매칭으로 찾음, 없으면 링크 없음)
type GameEvent = { id: string; name: string; type?: string | null; displayType?: string | null; start: string; end: string; url?: string };

const SERVER_META: Record<string, { code: string; label: string }> = {
  kr: { code: "KR", label: "한국" },
  jp: { code: "JP", label: "일본" },
  global: { code: "GL", label: "글로벌" },
  cn: { code: "CN", label: "중국" },
};
// 중국 서버 방송은 **미래시 데이터 포함이 켜져 있을 때만** 노출한다 — 중섭 선행 정보라
// 사이트 공통 규칙(미실장 오퍼·향후 이벤트와 동일, 사용자 확정 2026-07-25).
const FUTURE_SERVERS = new Set(["cn"]);
const HOUR = 3_600_000;
const DAY = 86_400_000;
const STATE_RANK: Record<BState, number> = { live: 0, upcoming: 1, past: 2 };
const PAST_LIMIT = 10; // 목록에 남기는 지난 방송 수 (사용자 확정 2026-07-25)

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

// eta "2026-09" → 로케일별 "연월"(일 없음). 미실장 이벤트 추정월 표기용 — KST 기준.
function fmtYm(locale: Locale, ym: string): string {
  return new Intl.DateTimeFormat(DT_LOCALE[locale], { timeZone: "Asia/Seoul", year: "numeric", month: "long" }).format(new Date(`${ym}-01T00:00:00+09:00`));
}

function BroadcastThumb({ b }: { b: Broadcast }) {
  const id = youTubeId(b);
  // 중섭은 유튜브가 아니라 비리비리 — 워커가 실어 준 라이브룸 커버를 쓰고 마크도 B站으로
  const src = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : b.cover;
  const [broken, setBroken] = useState(false);
  return (
    <div className="bcast-thumb">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        // 비리비리 CDN은 Referer가 붙으면 403(핫링크 차단) — 커버는 리퍼러 없이 요청한다
        <img src={src} alt="" width={480} height={360} loading="lazy" referrerPolicy={id ? undefined : "no-referrer"} onError={() => setBroken(true)} />
      ) : (
        <div className="bcast-thumb-empty" aria-hidden>ARKNIGHTS</div>
      )}
      {b.server === "cn"
        ? <span className="bili-mark" aria-label="bilibili">B</span>
        : <span className="yt-mark" aria-label="YouTube"><i /></span>}
    </div>
  );
}

// 원격/정적 항목 중복 판정 키 — 유튜브 영상 ID가 있으면 그것, 없으면 워커 키
function bcastKey(b: Broadcast): string {
  return youTubeId(b) ?? b.key ?? dayKey(b);
}
// 같은 서버·같은 날 방송은 같은 것으로 본다 — 정적 폴백엔 채널 URL(영상 ID 없음)만 있는
// 항목이 있어 id로는 원격과 못 겹친다. 이 보조 키가 없으면 6.5주년 JP·GL이 두 번 뜬다.
function dayKey(b: Broadcast): string {
  return `${b.server}:${new Date(b.start).toISOString().slice(0, 10)}`;
}

// AI 스토리 요약이 있는 이벤트 — 진행중 배지에서 이름 현지화 + 배너 썸네일 + 스토리 페이지 링크에 사용.
// eta = 미실장(중섭 선행) 이벤트의 KR 추정 출시월("2026-11") — build-story.py가 중↔한 시차로 산출.
type StoryEventLite = { id: string; name: { ko: string; en?: string; ja?: string }; thumb?: string; thumbEn?: string; thumbJa?: string; unreleased?: boolean; eta?: string };
const storyEventsList = (storyEventsData as { events: StoryEventLite[] }).events;
const storyEventById = new Map(storyEventsList.map((event) => [event.id, event]));
// 미실장(중섭 선행) 이벤트 — 헤더 이벤트 드롭다운 '향후 다가올'에 추정월과 함께 노출 (미래시 ON일 때만).
// 정렬은 추정월 이른(= 먼저 KR에 올) 순 — 다음에 올 이벤트가 위로.
const futureEvents = storyEventsList
  .filter((event) => event.unreleased)
  .sort((a, b) => (a.eta ?? a.id).localeCompare(b.eta ?? b.id));
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
  { const p = (locale === "ja" ? story.thumbJa : locale === "en" ? story.thumbEn : undefined) ?? story.thumb; return p ? asset(p) : undefined; }
}
const eventDday = (event: GameEvent, now: number): number => Math.max(0, Math.ceil((Date.parse(event.end) - now) / DAY));

// slot — 헤더 두 곳에 나눠 그린다: 진행중 이벤트 배지는 1줄(접어도 보임), 공식 방송 버튼은
// 확장부(header-sub)의 미래시 토글 왼쪽 (사용자 요청 2026-07-25). 워커 fetch는 모듈 공유
// 프라미스라 인스턴스가 둘이어도 요청은 한 번이다.
function BroadcastBadges({ includeFuture, slot }: { includeFuture?: boolean; slot?: "broadcast" | "events" }) {
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
  const [settled, setSettled] = useState(false); // 워커 응답 여부 — 응답 전엔 스켈레톤으로 슬롯 예약
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
      if (data) {
        setRemote(data.broadcasts);
        setGameEvents(data.events);
      }
      setSettled(true); // 성공·실패(워커 불통) 모두 스켈레톤 해제
    });
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // 딥링크: #broadcast — 모달을 소유한 슬롯(≠events)만 동기화 (events 슬롯은 배지 전용)
  useHashSync(slot !== "events" && open ? "#broadcast" : null, (h) => {
    if (slot !== "events") setOpen(h === "#broadcast");
  });
  // 진행중 이벤트 팝오버 — 바깥 클릭/Esc로 닫기
  useEffect(() => {
    if (!evOpen) return;
    const onDoc = (event: MouseEvent) => { if (!evRef.current?.contains(event.target as Node)) setEvOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setEvOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [evOpen]);
  // 워커 응답(또는 마운트) 전에는 실제 버튼과 같은 치수의 스켈레톤으로 슬롯을 고정 예약한다
  // — 로딩 후 요소가 생기며 헤더가 좁아졌다 넓어졌다 하던 레이아웃 시프트 방지 (사용자 요청 2026-07-17).
  if (now == null || !settled) {
    return (
      <>
        {slot !== "events" && (
          <span className="bcast-trigger is-skeleton" aria-hidden>
            <YtIcon />
            <span>{t("공식 방송")}</span>
          </span>
        )}
        {slot !== "broadcast" && <div className="event-group" aria-hidden>
          <div className="event-trigger has-banner is-skeleton">
            <span className="event-trigger-thumb"><span className="sk-box" /></span>
            <span className="event-trigger-main">
              <small className="event-kicker">{t("현재 진행중 이벤트")}</small>
              <span className="event-name sk-line" />
              <span className="event-dates sk-line" />
            </span>
            <span className="event-caret" aria-hidden>▾</span>
          </div>
        </div>}
      </>
    );
  }
  const statics = (broadcastsData.broadcasts as Broadcast[]).filter((b) => !Number.isNaN(Date.parse(b.start)));
  const seen = new Set((remote ?? []).flatMap((b) => [bcastKey(b), dayKey(b)]));
  const all = [
    ...(remote ?? []).filter((b) => !Number.isNaN(Date.parse(b.start))),
    ...statics.filter((b) => !seen.has(bcastKey(b)) && !seen.has(dayKey(b))),
  ].filter((b) => includeFuture || !FUTURE_SERVERS.has(b.server)); // 중섭은 미래시 ON일 때만

  // ── 진행중 게임 이벤트 배지 (공식 방송 버튼 오른쪽) ──
  // 굵직한 이벤트(사이드스토리 등) 우선 + 최신 시작순으로 대표 하나를 버튼에,
  // 나머지는 팝오버 목록에. 로그인·출석·기원류 잔이벤트는 sortRunning에서 제외한다
  // (대표 이벤트만 노출 — 사용자 확정 2026-07-17).
  const running = sortRunning(gameEvents, now);
  // 진행 예정 이벤트(아직 시작 전, 3주 내 시작 — 워커가 함께 실어줌)도 드롭다운에 노출한다
  // (사용자 요청 2026-07-17). 로그인·출석류 잔이벤트는 동일하게 제외, 시작 임박순 정렬.
  const upcoming = gameEvents
    .filter((event) => Date.parse(event.start) > now && !MINOR_EVENT_TYPES.has(event.type ?? ""))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const headline = running[0] ?? upcoming[0]; // 진행중이 없으면 가장 가까운 예정을 대표로
  const headlineUpcoming = running.length === 0 && upcoming.length > 0;
  const evName = (event: GameEvent): string => eventName(locale, event);
  const dday = (event: GameEvent): number => eventDday(event, now);
  const startDday = (event: GameEvent): number => Math.max(0, Math.ceil((Date.parse(event.start) - now) / DAY));
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
      {/* 대표 이벤트는 배너째로 버튼에 — 라벨·기간 포함 (사용자 요청 2026-07).
          클릭하면 나머지 진행중·예정 이벤트 드롭다운. */}
      <button type="button" className={`event-trigger${headlineThumb ? " has-banner" : ""}`} aria-expanded={evOpen}
        onClick={() => setEvOpen((o) => !o)} title={t("진행중·예정 이벤트 보기")}>
        {headlineThumb
          ? <span className="event-trigger-thumb"><img src={headlineThumb} alt="" /></span>
          : <span className="event-mark" aria-hidden>✦</span>}
        <span className="event-trigger-main">
          <small className="event-kicker">{headlineUpcoming ? t("진행 예정 이벤트") : t("현재 진행중 이벤트")}</small>
          <span className="event-name">{evName(headline)}</span>
          <span className="event-dates">
            {headlineUpcoming
              ? <>{t("{date} 시작", { date: mdLong(headline.start) })} · D-{startDday(headline)}</>
              : <>{mdLong(headline.start)} ~ {mdLong(headline.end)} · D-{dday(headline)}</>}
          </span>
        </span>
        <span className="event-caret" aria-hidden>▾</span>
      </button>
      {evOpen && (
        <div className="event-menu" role="dialog" aria-label={t("진행중·예정 이벤트")}>
          {running.length > 0 && <>
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
          </>}
          {upcoming.length > 0 && <>
            <h3 className="event-menu-upcoming">{t("진행 예정")}</h3>
            <ul>
              {upcoming.map((event) => {
                const thumb = event.id === headline.id ? undefined : evThumb(event);
                const body = (
                  <>
                    {thumb && <span className="event-banner"><img src={thumb} alt="" loading="lazy" /></span>}
                    <span className="event-row-name">{evName(event)}</span>
                    <small>{md(event.start)} ~ {md(event.end)} · {t("시작 D-{n}", { n: startDday(event) })}</small>
                  </>
                );
                return (
                  <li key={event.id}>
                    {event.url
                      ? <a href={event.url} target="_blank" rel="noopener noreferrer" title={t("공식 카페 공지 보기")}>{body}</a>
                      : <span className="event-row-plain">{body}</span>}
                  </li>
                );
              })}
            </ul>
          </>}
          {/* 향후 다가올 이벤트 — 아직 KR 미출시(중섭 선행) 이벤트를 순서대로 + 추정월과 함께.
              미래시 데이터 포함이 켜져 있을 때만 노출한다 (사이트 공통 규칙, 사용자 확정 2026-07-25). */}
          {includeFuture && futureEvents.length > 0 && <>
            <h3 className="event-menu-upcoming">{t("향후 다가올 이벤트")}</h3>
            <ul>
              {futureEvents.map((event) => {
                const name = (locale === "ko" ? event.name.ko : event.name[locale]) ?? event.name.ko;
                return (
                  <li key={event.id}>
                    <span className="event-row-plain">
                      <span className="event-row-name">{name}</span>
                      {event.eta && <small>{t("{ym}쯤 예정 (추정)", { ym: fmtYm(locale, event.eta) })}</small>}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="event-menu-note">{t("중국 서버 선행 이벤트예요. 한국 출시일은 미정이며, 표시 월은 중↔한 시차로 추정한 대략적 시점입니다.")}</p>
          </>}
        </div>
      )}
    </div>
  );

  if (all.length === 0) return (slot === "broadcast" ? null : eventBadge) || null;
  // 정렬: 생방송 > 가까운 예약 > 최근 지난 방송 (서버 전부 목록에 표시)
  const sorted = [...all].sort((a, b) => {
    const sa = bcastState(a, now), sb = bcastState(b, now);
    if (STATE_RANK[sa] !== STATE_RANK[sb]) return STATE_RANK[sa] - STATE_RANK[sb];
    return sa === "past" ? Date.parse(b.start) - Date.parse(a.start) : Date.parse(a.start) - Date.parse(b.start);
  })
    // 지난 방송 이력은 최근 10건까지만 (사용자 확정 2026-07-25 — 그 이상은 안 봄).
    // 생방송·예약은 개수 제한 없이 전부 남긴다.
    .filter((b, _i, list) => bcastState(b, now) !== "past"
      || list.filter((x) => bcastState(x, now) === "past").indexOf(b) < PAST_LIMIT);
  // 헤더 버튼 힌트: 생방송이 있으면 LIVE, 없으면 가장 가까운 예약을 표시
  const liveOne = all.find((b) => bcastState(b, now) === "live");
  const nextUp = all.filter((b) => bcastState(b, now) === "upcoming").sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  const hint = liveOne ? { cls: "live", text: t("생방송 중") } : nextUp ? { cls: "upcoming", text: t("예약 {s}", { s: shortStatus(nextUp, now) }) } : null;
  return (
    <>
      {slot !== "events" && (
        <button type="button" className={`bcast-trigger ${hint?.cls ?? ""}`} onClick={() => setOpen(true)}
          title={includeFuture ? t("명일방주 한국·일본·글로벌·중국 공식 방송 일정 보기") : t("명일방주 한국·일본·글로벌 공식 방송 일정 보기")}>
          <YtIcon />
          <span>{t("공식 방송")}</span>
          {hint && <span className="bcast-hint">· {hint.text}</span>}
        </button>
      )}
      {/* 진행중 게임 이벤트 배지 — 1줄(접어도 보임) */}
      {slot !== "broadcast" && eventBadge}
      {/* 사이트 헤더의 backdrop-filter가 fixed 기준을 헤더로 만들어버리므로,
          모달은 portal로 body에 직접 렌더링해야 화면 전체를 덮는다 */}
      {open && slot !== "events" && createPortal(
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
                        {FUTURE_SERVERS.has(b.server) && <span className="bcast-future">{t("미래시")}</span>}
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
              {includeFuture && (
                <p className="bcast-note">{t("중국 서버 방송은 비리비리 공식 라이브룸에서 가져옵니다 — 일정은 방송 소개문 기준이라 실제와 다를 수 있어요. 미래시 데이터 포함을 끄면 숨겨집니다.")}</p>
              )}
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

// ── 다크모드 토글 — html.dark 클래스 + localStorage(ta-theme). 첫 페인트 적용은
// layout.tsx 인라인 스크립트가 담당하므로 여기선 현재 상태 구독·전환만 한다.
// useSyncExternalStore: 서버 스냅샷 false → 하이드레이션 일치, 클라에선 클래스 관찰.
function subscribeThemeClass(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}
function ThemeToggle() {
  const { t } = useI18n();
  const dark = useSyncExternalStore(subscribeThemeClass,
    () => document.documentElement.classList.contains("dark"), () => false);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("ta-theme", next ? "dark" : "light"); } catch { /* ignore */ }
  };
  return (
    <button type="button" className="theme-toggle" onClick={toggle}
      aria-pressed={dark} aria-label={t("다크 모드 전환")} title={t("다크 모드 전환")}>
      <span aria-hidden>{dark ? "☀" : "☾"}</span>
    </button>
  );
}

// 포탈 첫화면 — 루트(/)의 랜딩. 각 도구로 가는 큰 버튼만 두어, 진입 시 오퍼 이미지 로딩이
// 전혀 없다 (사용자 확정 2026-07-17: 데이터 소진 방지). 오퍼 백과사전은 여기서 /operators로 이동.
function Portal({ onOpenTab }: { onOpenTab: (tab: Tab) => void }) {
  const { t } = useI18n();
  // 메뉴 순서는 햄버거 메뉴와 동일하게 유지 (사용자 확정 2026-07-17: 인프라 자동편성기 최상단).
  const cards: { tab: Tab; icon: string; name: string; desc: string }[] = [
    { tab: "planner", icon: "⌂", name: t("인프라 자동편성기"), desc: t("보유 오퍼만 입력하면 기반시설 편성을 자동으로 계산") },
    { tab: "archive", icon: "▤", name: t("오퍼 백과사전"), desc: t("소속·직군·태그·시너지로 필터·검색하는 오퍼레이터 도감") },
    { tab: "recruit", icon: "◎", name: t("공채 도우미"), desc: t("공개모집 태그 조합으로 확정·고성급 오퍼를 탐색") },
    { tab: "farm", icon: "◈", name: t("파밍 도우미"), desc: t("정예화 재료의 최적 파밍 스테이지와 이성 효율표") },
    { tab: "upgrade", icon: "▦", name: t("오퍼 육성 시뮬"), desc: t("오퍼 육성에 필요한 용문폐·재료 총량을 단계별로 계산") },
    { tab: "story", icon: "✦", name: t("스토리"), desc: t("이벤트 스토리를 AI 요약과 전문(풀 스크립트)으로") },
    { tab: "rogue", icon: "❖", name: t("통합전략 가이드"), desc: t("층별 노드·적 도감·유물·엔딩 조건을 난이도별로 정리") },
    { tab: "about", icon: "ⓘ", name: t("테라 아카이브 소개"), desc: t("각 기능이 무엇이고 언제 쓰는지 안내") },
  ];
  return (
    <section className="portal" aria-labelledby="portal-title">
      <div className="portal-hero">
        <span className="portal-kicker">TERRA ARCHIVE</span>
        <h1 id="portal-title">{t("테라 아카이브")}</h1>
        <p>{t("명일방주(아크나이츠) 팬사이트 — 필요한 도구를 골라 들어가세요.")}</p>
      </div>
      <div className="portal-grid">
        {cards.map((card) => (
          <button key={card.tab} type="button" className={`portal-card portal-${card.tab}`}
            onClick={() => { onOpenTab(card.tab); scrollMainTop(); }}>
            <span className="portal-card-icon" aria-hidden>{card.icon}</span>
            <span className="portal-card-body"><b>{card.name}</b><small>{card.desc}</small></span>
            <span className="portal-card-go" aria-hidden>→</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function Home({ locale, operators, extra, summaries, initialTab = "portal" }: { locale: Locale; operators: Operator[]; extra: ExtraI18n | null; summaries: StorySummaries; initialTab?: Tab }) {
  return (
    <I18nProvider locale={locale}>
      <HomeInner operators={operators} extra={extra} summaries={summaries} initialTab={initialTab} />
    </I18nProvider>
  );
}

// '미래시 포함' 토글 localStorage 키 — 켜면 한국 서버 미실장(CN 선행) 오퍼도 목록에 표시
const FUTURE_KEY = "ta-include-future";

function HomeInner({ operators, extra, summaries, initialTab }: { operators: Operator[]; extra: ExtraI18n | null; summaries: StorySummaries; initialTab: Tab }) {
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
  // 스토리 전문 보기 레일용 — 화자명이 오퍼레이터면 자동 카드 (요약 미등록 인물 커버, 2026-07-18)
  const storyOpIndex = useMemo<OpIndex>(() => {
    const m: OpIndex = {};
    for (const o of operators) m[o.name] = { op: o.id, desc: `${o.rarity}성 ${o.job} 오퍼레이터` };
    return m;
  }, [operators]);
  const [selectedFactions, setSelectedFactions] = useState<string[]>([]);
  const [selectedConcepts, setSelectedConcepts] = useState<string[]>([]);
  // 오퍼 검색은 **비제어 입력** — 타이핑 한 글자마다 420장 카드 트리를 다시 렌더하면
  // 그 렌더가 끝나야 글자가 보인다(한글 IME는 더 심함). 입력값은 DOM에만 두고, 멈춘 뒤
  // 0.5초에 searchTerm만 갱신한다 (사용자 리포트 2026-07-25). search.ts가 정본.
  const { term: searchTerm, clear: clearSearch, inputProps: searchProps } = useSearchInput();
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [selectedSubProfessions, setSelectedSubProfessions] = useState<string[]>([]);
  const [selectedRarities, setSelectedRarities] = useState<string[]>([]); // 성급 필터 (문자열 "6"~"1")
  const [selected, setSelected] = useState<Operator | null>(null);
  // 경로 기반 라우팅: 서버가 라우트별로 올바른 탭을 렌더하므로 initialTab을 그대로
  // 초기값으로 쓴다 (SSR/클라이언트 첫 렌더 일치 → hydration mismatch 없음).
  const [tab, setTab] = useState<Tab>(initialTab);
  const [navOpen, setNavOpen] = useState(false); // 모바일 탭 메뉴(햄버거) 열림 상태
  const [feedbackOpen, setFeedbackOpen] = useState(false); // 제안 패널 — 모바일 헤더 버튼·데스크탑 FAB 공용
  const [headerCollapsed, setHeaderCollapsed] = useState(true); // 모바일 헤더 접기 — 접힘이 기본(사용자 확정 2026-07-22). PC는 무관(관련 CSS가 모바일 블록에만 있음)
  // 햄버거 '통합전략 가이드' 부메뉴 활성 표시용 — 현재 URL의 ?topic= 슬러그 (기본 is1)
  const [rogueSlug, setRogueSlug] = useState<string>(() =>
    typeof window === "undefined" ? "is1" : new URLSearchParams(window.location.search).get("topic") || "is1");
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
  // 성급 필터 목록 — 로스터에 실제 있는 성급을 높은 순으로 (보통 6~1성)
  const rarities = useMemo(() =>
    Array.from(new Set(roster.map((operator) => operator.rarity))).sort((a, b) => b - a).map(String),
    [roster]);
  const positionMethods = useMemo(() => [t("근거리"), t("원거리")], [t]);
  const attackMethods = useMemo(() => [...positionMethods, t("물리"), t("마법")], [positionMethods, t]);
  const damageTypeOf = (operator: Operator) => (MAGIC_TRAIT_RE[locale].test(operator.trait) ? t("마법") : t("물리"));

  // 필터 칩의 개수 배지 — 렌더마다 로스터를 훑지 않도록 한 번에 집계해 둔다.
  // (컨셉덱만 40종 × 420명 = 1.7만 회 스캔이 **매 렌더** 돌아 타이핑을 굼뜨게 했다, 2026-07-25)
  const chipCount = useMemo(() => {
    const concept = new Map<string, number>(), faction = new Map<string, number>(), tag = new Map<string, number>();
    const job = new Map<string, number>(), sub = new Map<string, number>(), rarity = new Map<string, number>();
    const method = new Map<string, number>();
    const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
    for (const operator of roster) {
      for (const concept0 of operator.concepts) bump(concept, concept0);
      for (const faction0 of operator.factions) bump(faction, faction0);
      for (const tag0 of operator.combatTags) bump(tag, tag0);
      bump(job, operator.job);
      bump(sub, operator.subProfession);
      bump(rarity, String(operator.rarity));
      bump(method, operator.position);            // 근거리/원거리
      bump(method, damageTypeOf(operator));       // 물리/마법
    }
    return { concept, faction, tag, job, sub, rarity, method };
    // damageTypeOf는 locale·t 클로저 (로케일이 바뀌면 라벨도 바뀐다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, locale, t]);

  // 루트 레이아웃은 lang="ko" 고정이라, 로케일 라우트에서는 클라이언트에서 맞춘다
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // 모든 모달 ESC 닫기 — layout.tsx 인라인 스크립트의 이중 장치 (esc-close.ts, 가드로 1회만)
  useEffect(() => { bindEscClose(); }, []);

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
      setRogueSlug(new URLSearchParams(window.location.search).get("topic") || "is1");
      if (hash.startsWith("#op-")) {
        const operator = operators.find((candidate) => candidate.id === hash.slice(4));
        if (operator) setSelected(operator);
        return;
      }
      // op 해시가 아니면 열려 있던 모달을 닫는다 (URL 직접 편집·딥링크 이탈)
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

  // ── 실패한 검색의 목적지 추적 (app/trail.ts) ────────────────────────────
  // URL 해시로 표현되는 도착(오퍼 상세·스토리 상세·통합전략 상세)을 한 곳에서 잡아,
  // 앞서 아무것도 못 찾았던 검색어들에 "결국 여기로 갔다"를 이어 붙인다.
  useEffect(() => {
    const seen = { hash: "" };
    const check = () => {
      const hash = decodeURIComponent(window.location.hash);
      if (hash === seen.hash) return;
      seen.hash = hash;
      if (hash.startsWith("#op-")) {
        const id = hash.slice(4);
        const op = operators.find((candidate) => candidate.id === id);
        if (op) noteArrival(`op:${id}`, { kind: "op", name: op.name, locale });
        return;
      }
      if (hash.startsWith("#story-")) {
        const id = hash.slice(7).split("/")[0];
        noteArrival(`story:${id}`, { kind: "story", name: id, locale });
        return;
      }
      // 통합전략 상세 모달: #rg-<뷰>~<타입>~<id> · 토픽은 ?topic=isN
      const rg = /^#rg-[a-z]+~([a-z]+)~(.+)$/.exec(hash);
      if (rg) {
        const slug = new URLSearchParams(window.location.search).get("topic") ?? "is1";
        const num = /^is(\d+)$/.exec(slug);
        const topic = num ? `rogue_${num[1]}` : "rogue_1";
        noteArrival(`rg:${topic}:${rg[1]}:${decodeURIComponent(rg[2])}`, { kind: "rogue", name: decodeURIComponent(rg[2]), locale });
      }
    };
    check();
    window.addEventListener("hashchange", check);
    window.addEventListener("popstate", check);
    const timer = window.setInterval(check, 700);   // replaceState는 이벤트를 안 쏜다
    return () => {
      window.removeEventListener("hashchange", check);
      window.removeEventListener("popstate", check);
      window.clearInterval(timer);
    };
    // operators는 라우트 수명 동안 불변
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  // 스크롤 복원: 페이지(탭·스토리) 이동 시 top으로, 뒤로/앞으로 시 직전 스크롤 복구.
  // pushState를 감싸 (1) 떠나는 위치 저장 (2) 엔트리에 고유 키 부여 (3) 페이지가 바뀌면 top.
  // (오퍼 모달은 #op- 해시만 바뀌거나 URL이 그대로라 '같은 페이지'로 보고 스크롤을 건드리지 않는다)
  useEffect(() => {
    if (typeof window === "undefined" || !("scrollRestoration" in history)) return;
    history.scrollRestoration = "manual";
    // 스크롤러 = .site-scroll (헤더 분리 후 window는 스크롤하지 않는다 — 2026-07-22)
    const scroller = document.querySelector<HTMLElement>(".site-scroll");
    if (!scroller) return;
    const store = new Map<number, number>();
    const pageId = (href: string) => { const u = new URL(href); return u.pathname + (u.hash.startsWith("#op-") ? "" : u.hash); };
    const freshKey = () => Date.now() + Math.random();
    const keyOf = (): number | null => (history.state && typeof (history.state as { __k?: number }).__k === "number") ? (history.state as { __k: number }).__k : null;
    if (keyOf() === null) history.replaceState({ ...(history.state as object || {}), __k: freshKey() }, "");
    let curKey = keyOf() as number;
    const save = () => { if (curKey != null) store.set(curKey, scroller.scrollTop); };
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
      if (pageId(window.location.href) !== fromPage) { store.set(k, 0); scroller.scrollTo(0, 0); }
      else store.set(k, scroller.scrollTop);
    }) as typeof history.pushState;
    const onPop = () => {
      const k = keyOf();
      curKey = k ?? freshKey();
      if (k === null) origReplace({ ...(history.state as object || {}), __k: curKey }, "");
      const y = k != null && store.has(k) ? store.get(k)! : 0;
      requestAnimationFrame(() => requestAnimationFrame(() => scroller.scrollTo(0, y)));
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPop);
    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      scroller.removeEventListener("scroll", onScroll);
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
            ? t("파밍 도우미 - 명일방주 재료 파밍 효율표 | 테라 아카이브")
            : tab === "upgrade"
            ? t("오퍼 육성 시뮬 - 명일방주 육성 비용 계산기 | 테라 아카이브")
            : tab === "story"
              ? t("스토리 - 명일방주 스토리 요약·전문 | 테라 아카이브")
              : tab === "rogue"
                ? t("통합전략 가이드 - 명일방주 통합전략 공략 | 테라 아카이브")
                : tab === "archive"
                ? t("오퍼레이터 백과사전 - 명일방주 오퍼 도감 | 테라 아카이브")
                : t("테라 아카이브 | 명일방주(Arknights) 팬사이트");
  }, [tab, selected, t]);

  // 오퍼 모달은 히스토리 엔트리를 쌓지 않고 해시만 교체한다(공유용 딥링크).
  // 예전엔 열 때 pushState, 닫을 때 history.back()으로 URL을 복원했는데, 인앱 브라우저
  // (카톡·네이버 카페 웹뷰 — bfcache 미지원)에서 back()이 문서를 통째로 리로드시켜
  // 목록·필터·스크롤이 전부 초기화되는 버그가 있었다 (사용자 리포트 2026-07-18).
  // replaceState는 네비게이션이 아니라 리로드가 원천적으로 발생하지 않는다.
  const openOperator = useCallback((operator: Operator) => {
    setSelected(operator);
    history.replaceState(null, "", `${tabPath(tab)}#op-${operator.id}`);
  }, [tab, tabPath]);
  const closeOperator = () => {
    setSelected(null);
    if (decodeURIComponent(window.location.hash).startsWith("#op-")) {
      history.replaceState(null, "", tabPath(tab));
    }
  };
  // 플래너 등 다른 탭 위에서 모달만 띄울 때 — URL(경로)은 그대로 둔다.
  // startTransition: 오퍼 상세 모달은 렌더가 무거워 클릭 페인트를 먼저 내보낸다 (INP, 2026-07-21)
  const showOperatorById = (id: string) => {
    const operator = operators.find((candidate) => candidate.id === id);
    if (!operator) return;
    startTransition(() => setSelected(operator));
  };

  const TAB_LABEL: Record<Tab, string> = {
    portal: t("홈"),
    archive: t("오퍼 백과사전"),
    planner: t("인프라 자동편성기"),
    recruit: t("공채 도우미"),
    farm: t("파밍 도우미"),
    upgrade: t("오퍼 육성 시뮬"),
    story: t("스토리"),
    rogue: t("통합전략 가이드"),
    about: t("테라 아카이브 소개"),
  };
  const switchTab = (next: Tab) => {
    setNavOpen(false);
    noteAction();                       // 실패 추적 창 카운트 (app/trail.ts)
    if (next === tab && !selected) return;
    history.pushState(null, "", tabPath(next));
    // 탭 마운트(특히 플래너)는 렌더가 무거워 클릭 페인트부터 내보낸다 (INP 600ms → 개선, 2026-07-21)
    startTransition(() => {
      setTab(next);
      setSelected(null);
    });
  };
  // 햄버거의 '통합전략 가이드' 부메뉴에서 특정 테마로 바로 진입 — /rogue?topic=isN 으로 이동.
  // 이미 rogue 탭이면 커스텀 이벤트(ta:rogue-topic)로 RogueGuide가 토픽을 동기화하고, 다른
  // 탭이면 탭 전환 시 RogueGuide가 마운트되며 URL의 topic을 읽는다.
  // ⚠ 합성 popstate를 쓰지 않는다 — vinext 라우터가 그걸 내비게이션으로 보고 RSC를 재요청한다.
  const switchRogueTopic = (topicId: string) => {
    setNavOpen(false);
    const slug = rogueSlugOf(topicId);
    startTransition(() => {
      setSelected(null);
      setTab("rogue");
      setRogueSlug(slug);
    });
    // tabPath가 이미 ?future=1을 달고 올 수 있으므로 문자열 이어붙이기 금지 —
    // ?future=1?topic=isN 처럼 깨져 topic 파싱에 실패하면 팬텀(rogue_1)으로 떨어진다
    const [path, query] = tabPath("rogue").split("?");
    const params = new URLSearchParams(query);
    params.set("topic", slug);
    history.pushState(null, "", `${path}?${params}`);
    window.dispatchEvent(new CustomEvent("ta:rogue-topic"));
  };
  // 헤더 만능검색의 이동 — 종류별로 **기존** 딥링크·핸드오프 경로를 그대로 탄다
  // (오퍼=#op- 해시 모달, 스토리=#story- 해시, 통합전략=스샷 레이더 핸드오프,
  //  파밍·공채=탭 내부 상태라 sessionStorage 우편함). 새 라우팅을 만들지 않는다.
  const runOmni = (target: OmniTarget) => {
    switch (target.kind) {
      case "tab":
        switchTab(target.tab);
        break;
      case "op": {
        const operator = operators.find((candidate) => candidate.id === target.id);
        if (!operator) return;
        startTransition(() => setSelected(operator));
        history.replaceState(null, "", `${tabPath(tab)}#op-${target.id}`);
        break;
      }
      case "story":
        // 스토리 상세는 해시로 연다 — 탭 전환보다 URL을 먼저 맞춰 두고(마운트 시 읽는다),
        // 이미 스토리 탭이면 hashchange로 깨운다 (pushState/replaceState는 hashchange를 안 쏜다)
        switchTab("story");
        history.replaceState(null, "", `${tabPath("story")}#story-${target.id}`);
        window.dispatchEvent(new Event("hashchange"));
        break;
      case "rogue":
        // 세부 항목(유물·조우…)은 스샷 레이더와 같은 우편함으로 넘긴다 — rogue.tsx가 소비
        if (target.goto) { try { sessionStorage.setItem("ta:lens-handoff", JSON.stringify(target.goto)); } catch { /* ignore */ } }
        switchRogueTopic(target.topic);
        break;
      case "recruit":
        stashHandoff({ page: "recruit", tags: target.tags });
        switchTab("recruit");
        notifyHandoff();
        break;
      case "farm":
        stashHandoff({ page: "farm", item: target.item });
        switchTab("farm");
        notifyHandoff();
        break;
    }
  };
  const [sortKey, setSortKey] = useState("기본");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    if (!selected) return;
    // 배경 스크롤 잠금 — 스크롤러가 .site-scroll(내부 컨테이너)로 바뀌어(2026-07-22)
    // overflow:hidden만으로 scrollTop이 그대로 보존된다. 예전 body position:fixed 트릭
    // (iOS에서 window 스크롤이 튀던 문제 대응)은 window가 더는 스크롤하지 않으므로 불필요.
    const scroller = document.querySelector<HTMLElement>(".site-scroll");
    const savedOverflow = scroller?.style.overflow ?? "";
    if (scroller) scroller.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOperator();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      if (scroller) scroller.style.overflow = savedOverflow;
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
  // (스크롤러가 .site-scroll이라 overflow:hidden으로 충분 — scrollTop 자연 보존, 2026-07-22)
  useEffect(() => {
    if (!navOpen || !window.matchMedia("(max-width: 760px)").matches) return;
    const scroller = document.querySelector<HTMLElement>(".site-scroll");
    if (!scroller) return;
    const savedOverflow = scroller.style.overflow;
    scroller.style.overflow = "hidden";
    return () => { scroller.style.overflow = savedOverflow; };
  }, [navOpen]);

  const filtered = useMemo(() => {
    const keyword = normSearch(searchTerm);
    return roster.filter((operator) => {
      const matchesFaction = selectedFactions.length === 0 || selectedFactions.some((faction) => operator.factions.includes(faction));
      const matchesConcept = selectedConcepts.length === 0 || selectedConcepts.some((concept) => operator.concepts.includes(concept));
      const positionPicks = selectedMethods.filter((method) => positionMethods.includes(method));
      const damagePicks = selectedMethods.filter((method) => !positionMethods.includes(method));
      const matchesMethod = (positionPicks.length === 0 || positionPicks.includes(operator.position)) && (damagePicks.length === 0 || damagePicks.includes(damageTypeOf(operator)));
      const matchesTags = tags.every((tag) => operator.combatTags.includes(tag));
      const matchesJob = selectedJobs.length === 0 || selectedJobs.includes(operator.job);
      const matchesSubProfession = selectedSubProfessions.length === 0 || selectedSubProfessions.includes(operator.subProfession);
      const matchesRarity = selectedRarities.length === 0 || selectedRarities.includes(String(operator.rarity));
      const conceptNames = operator.concepts.map((concept) => conceptName(locale, concept));
      const matchesQuery = !keyword || normSearch([operator.name, operator.code, operator.job, operator.subProfession, operator.position, ...operator.combatTags, ...operator.factions, operator.reason, ...operator.aliases, ...operator.concepts, ...conceptNames].join(" ")).includes(keyword);
      return matchesFaction && matchesConcept && matchesMethod && matchesTags && matchesJob && matchesSubProfession && matchesRarity && matchesQuery;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, selectedFactions, selectedConcepts, selectedMethods, tags, selectedJobs, selectedSubProfessions, selectedRarities, searchTerm, locale]);

  // 백과사전 검색이 0건이면 그것도 "실패한 검색"이다 (뱅제 → 은재 → … 연쇄를 잇기 위해)
  useEffect(() => {
    if (!searchTerm.trim() || filtered.length) return;
    noteMiss(normSearch(searchTerm), locale);
  }, [searchTerm, filtered.length, locale]);

  const reset = () => {
    setSelectedFactions([]);
    setSelectedConcepts([]);
    setSelectedMethods([]);
    setTags([]);
    setSelectedJobs([]);
    setSelectedSubProfessions([]);
    setSelectedRarities([]);
    clearSearch();
  };

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (value: string) =>
    setter((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  const toggleTag = toggleIn(setTags);

  const hasActiveFilter = selectedFactions.length > 0 || selectedConcepts.length > 0 || selectedMethods.length > 0 || tags.length > 0 || selectedJobs.length > 0 || selectedSubProfessions.length > 0 || selectedRarities.length > 0 || searchTerm.trim().length > 0;

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

  // 카드 그리드를 **요소로 메모**한다 — 정렬 결과가 그대로면 리액트가 이 서브트리 재조정을
  // 통째로 건너뛰므로, 필터 칩·검색 결과 갱신 렌더에서 420장을 다시 만들지 않는다 (2026-07-25)
  const operatorGrid = useMemo(() => (
    <div className="operator-grid">
      {sorted.map((operator, index) => <OperatorCard key={operator.id ?? `${operator.name}-${index}`} operator={operator} index={index} onSelect={openOperator} />)}
    </div>
  ), [sorted, openOperator]);

  return (
    <main className={tab === "archive" ? "site-main" : "base-main site-main"}>
      <header className={`site-header${headerCollapsed ? " collapsed" : ""}`} id="top">
        <a className="brand" href={localeBase || "/"} aria-label={t("테라 아카이브 홈")}
          onClick={(event) => { event.preventDefault(); switchTab("portal"); scrollMainTop(); }}>
          <span className="brand-mark"><img src={asset("/avatars/char_1012_skadi2.webp")} alt="" width={180} height={180} /></span>
          <span>{t("테라 아카이브")}<small>{t("명일방주(Arknights) 팬사이트")}</small></span>
        </a>
        {/* 업데이트 내역 — 로고 바로 오른쪽 1줄 소속: 헤더를 접어도 보인다
            (사용자 요청 2026-07-27: "헤더를 열어보지 않으면 알 수가 없으니") */}
        <ChangelogButton />
        {/* 진행중 이벤트 배지 — 1줄(접힘 상태에도 표시). 공식 방송 버튼은 확장부로 내려갔다
            (사용자 요청 2026-07-25 — 미래시 토글 왼쪽). */}
        <BroadcastBadges includeFuture={includeFuture} slot="events" />
        {/* 만능검색 = 1줄 오른쪽(햄버거 왼쪽) — 헤더를 접어도 남는다 (사용자 요청 2026-07-25) */}
        <OmniSearch roster={roster} includeFuture={includeFuture} extra={extra} onGo={runOmni} />
        {/* 게임 연결 — 크롬 확장(extension/)이 깔린 사람에게만 나타난다. 누르면 게임 창
            프레임이 흐르고, 인식·이동은 각 탭의 스샷 레이더 경로가 그대로 처리한다. */}
        <BridgeButton t={t} />
        {/* 햄버거(메뉴) = 1줄 오른쪽 끝 — 데스크탑·모바일 공통 (사용자 확정 2026-07-22).
            모바일은 order로, 데스크탑은 margin-left:auto로 배치되므로 JSX 위치는 자유. */}
        <div className="nav-group">
          <button type="button" className="nav-toggle" aria-expanded={navOpen} aria-label={t("메뉴 열기")} onClick={() => setNavOpen((open) => !open)}>
            {/* 라벨은 "메뉴"로 **고정** — 현재 탭 이름을 넣으면 페이지를 옮길 때마다 버튼 폭이
                늘었다 줄었다 해서 헤더가 흔들린다 (사용자 요청 2026-07-29) */}
            <span aria-hidden>☰</span>{t("메뉴")}
          </button>
          {/* 드롭다운은 햄버거 버튼 바로 밑에 딱 붙여 연다 (사용자 요청 2026-07) */}
          {/* 순서는 포탈 카드와 동일 (사용자 확정 2026-07-17): 홈 · 인프라 · 백과사전 · 공채 · 파밍 · 스토리 · 소개 */}
          <nav className={`main-tabs${navOpen ? " open" : ""}`} aria-label={t("주요 탭")}>
            <button className={`tab-portal${tab === "portal" ? " selected" : ""}`} onClick={() => switchTab("portal")}><span className="tab-icon" aria-hidden>◇</span>{t("홈")}</button>
            <button className={`tab-planner${tab === "planner" ? " selected" : ""}`} onClick={() => switchTab("planner")}><span className="tab-icon" aria-hidden>⌂</span>{t("인프라 자동편성기")}{tabHasNewFeature("planner") && <span className="new-badge">{t("새기능")}</span>}</button>
            <button className={`tab-archive${tab === "archive" ? " selected" : ""}`} onClick={() => switchTab("archive")}><span className="tab-icon" aria-hidden>▤</span>{t("오퍼 백과사전")}</button>
            <button className={`tab-recruit${tab === "recruit" ? " selected" : ""}`} onClick={() => switchTab("recruit")}><span className="tab-icon" aria-hidden>◎</span>{t("공채 도우미")}{tabHasNewFeature("recruit") && <span className="new-badge">{t("새기능")}</span>}</button>
            <button className={`tab-farm${tab === "farm" ? " selected" : ""}`} onClick={() => switchTab("farm")}><span className="tab-icon" aria-hidden>◈</span>{t("파밍 도우미")}</button>
            <button className={`tab-upgrade${tab === "upgrade" ? " selected" : ""}`} onClick={() => switchTab("upgrade")}><span className="tab-icon" aria-hidden>▦</span>{t("오퍼 육성 시뮬")}</button>
            <button className={`tab-story${tab === "story" ? " selected" : ""}`} onClick={() => switchTab("story")}><span className="tab-icon" aria-hidden>✦</span>{t("스토리")}{tabHasNewFeature("story") && <span className="new-badge">{t("새기능")}</span>}</button>
            {/* 통합전략 가이드 — 마우스오버 시 테마별 부메뉴가 펼쳐진다 (플라이아웃) */}
            <div className="tab-rogue-wrap">
              <button className={`tab-rogue${tab === "rogue" ? " selected" : ""}`} onClick={() => switchTab("rogue")}><span className="tab-icon" aria-hidden>❖</span>{t("통합전략 가이드")}{tabHasNewFeature("rogue") && <span className="new-badge">{t("새기능")}</span>}</button>
              <div className="tab-submenu" role="group" aria-label={t("통합전략 가이드")}>
                {ROGUE_TOPICS.filter((tp) => tp.ready && (!tp.future || includeFuture)).map((tp) => (
                  <button key={tp.id} type="button"
                    className={`tab-sub${tab === "rogue" && rogueSlug === rogueSlugOf(tp.id) ? " selected" : ""}`}
                    onClick={() => switchRogueTopic(tp.id)}>
                    <span className="tab-sub-mark" aria-hidden>›</span>{t(tp.name)}{tp.future && <em className="tab-sub-future">{t("미래시")}</em>}
                  </button>
                ))}
              </div>
            </div>
            <button className={`tab-about${tab === "about" ? " selected" : ""}`} onClick={() => switchTab("about")}><span className="tab-icon" aria-hidden>ⓘ</span>{t("테라 아카이브 소개")}</button>
          </nav>
        </div>
        {/* 2줄(확장부) — 데스크탑: 미래시·다크모드·언어(오른쪽 끝). 모바일: display:contents로
            래퍼를 풀어 기존 order 배치(3줄 제안·미래시·다크·언어)가 그대로 동작한다. */}
        <div className="header-sub">
          {/* 제안 버튼 — 모바일 전용(3줄). 데스크탑에선 숨기고 우하단 FAB을 쓴다. */}
          {feedbackReady && (
            <button type="button" className="feedback-header-btn" onClick={() => setFeedbackOpen(true)} aria-label={t("제안 보내기")}>
              <span aria-hidden>💬</span> {t("제안")}
            </button>
          )}
          <div className="header-sub-right">
            {/* 공식 방송 — 미래시 토글 바로 왼쪽 (사용자 요청 2026-07-25) */}
            <BroadcastBadges includeFuture={includeFuture} slot="broadcast" />
            {/* 라벨은 데스크탑 "미래시 데이터 포함", 모바일은 "미래시"로 축약 (사용자 요청 2026-07-22) */}
            <label className="future-toggle" title={t("아직 정식 출시되지 않은(중국 서버 선행) 오퍼레이터·재료도 목록·계산기에 표시합니다. 미실장 텍스트는 비공식 AI 번역입니다.")}>
              <input type="checkbox" checked={includeFuture} onChange={(event) => toggleFuture(event.target.checked)} />
              <span className="ft-full">{t("미래시 데이터 포함")}</span>
              <span className="ft-short">{t("미래시")}</span>
            </label>
            <ThemeToggle />
            <LanguageSwitcher />
          </div>
        </div>
        {/* 헤더 접기 핸들 — 헤더 맨 아래 중앙, 데스크탑·모바일 공통 (접힘이 기본).
            접으면 로고·햄버거 한 줄만 남는다 (사용자 확정 2026-07-22). */}
        <button type="button" className="header-collapse-toggle"
          aria-expanded={!headerCollapsed} aria-label={headerCollapsed ? t("헤더 펼치기") : t("헤더 접기")}
          onClick={() => setHeaderCollapsed((collapsed) => !collapsed)}>
          <span aria-hidden>{headerCollapsed ? "⌄" : "⌃"}</span>
        </button>
      </header>

      {/* 본문 스크롤 영역 — 세로 스크롤은 여기서만 생긴다(헤더는 위에 고정, 스크롤바가 헤더까지
          올라오지 않도록 — 사용자 요청 2026-07-22, 모바일·PC 공통). 모달·제안 위젯은 fixed라 밖에 둔다. */}
      <div className="site-scroll">

      {tab === "portal" && <Portal onOpenTab={switchTab} />}

      {tab === "archive" && <section className="explorer" aria-labelledby="explorer-title">
        <div className="filter-panel">
          <div className="panel-heading">
            <div><span className="section-no">FILTER / 01</span><h2 id="explorer-title">{t("탐색 조건")}</h2></div>
            <button className="reset" onClick={reset}>↻ {t("초기화")}</button>
          </div>
          {/* 컨셉덱은 시그니처 기능이라 맨 위에 항상 펼쳐 둔다 (사용자 요청 2026-07-22). */}
          <FilterGroup title={t("컨셉덱")} items={concepts} labelFor={(item) => conceptName(locale, item)} selected={selectedConcepts} onToggle={toggleIn(setSelectedConcepts)} rows={2} countForItem={(item) => chipCount.concept.get(item) ?? 0} />
          {/* 성급·직군·세부직군·전투태그·공격방식·소속은 한 컨트롤로 합쳐 카테고리→값 방식으로. */}
          <AttributeFilter groups={[
            { title: t("성급"), items: rarities, selected: selectedRarities, onToggle: toggleIn(setSelectedRarities), labelFor: (item) => `${item}★`, countForItem: (item) => chipCount.rarity.get(item) ?? 0 },
            { title: t("직군"), items: jobs, selected: selectedJobs, onToggle: toggleIn(setSelectedJobs), countForItem: (item) => chipCount.job.get(item) ?? 0 },
            { title: t("세부 직군"), items: subProfessions, selected: selectedSubProfessions, onToggle: toggleIn(setSelectedSubProfessions), countForItem: (item) => chipCount.sub.get(item) ?? 0 },
            { title: t("전투 태그"), items: combatTags, selected: tags, onToggle: toggleTag, countForItem: (item) => chipCount.tag.get(item) ?? 0 },
            { title: t("공격 방식"), items: attackMethods, selected: selectedMethods, onToggle: toggleIn(setSelectedMethods), countForItem: (item) => chipCount.method.get(item) ?? 0 },
            { title: t("공식 소속"), items: factions, selected: selectedFactions, onToggle: toggleIn(setSelectedFactions), countForItem: (item) => chipCount.faction.get(item) ?? 0 },
          ]} />

          <aside className="data-note"><span>DATA NOTE</span><p>{t("오퍼레이터 {count}명 · 전원 이미지 · 다국어 이름·별칭 검색 · 스킬과 재능 기반 {concepts}개 컨셉 태그를 제공합니다. 모든 필터는 토글식이며 아무것도 선택하지 않으면 전체가 표시됩니다.", { count: roster.length, concepts: concepts.length })}</p></aside>
        </div>

        <div className="results">
          <div className="results-heading">
            <div><span className="section-no">RESULT / 02</span><h2>{selectedConcepts.length === 1 ? t("{concept} 컨셉덱", { concept: conceptName(locale, selectedConcepts[0]) }) : selectedFactions.length === 1 ? selectedFactions[0] : hasActiveFilter ? t("탐색 결과") : t("전체 오퍼레이터")}</h2></div>
            <div className="search-wrap heading-search">
              <span>⌕</span>
              {/* 비제어 입력 — 지우기(×) 표시는 CSS(:placeholder-shown)가 담당한다 */}
              <input id="operator-search" {...searchProps} placeholder={t("이름, 별명, 직군, 효과 검색")} />
              <button type="button" className="search-clear" onClick={() => clearSearch()} aria-label={t("검색어 지우기")}>×</button>
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
            {selectedRarities.map((item) => <button key={`r-${item}`} onClick={() => toggleIn(setSelectedRarities)(item)}>{item}★ ×</button>)}
            {selectedFactions.map((item) => <button key={`f-${item}`} onClick={() => toggleIn(setSelectedFactions)(item)}>{item} ×</button>)}
            {selectedConcepts.map((item) => <button key={`c-${item}`} onClick={() => toggleIn(setSelectedConcepts)(item)}>{conceptName(locale, item)} ×</button>)}
            {selectedMethods.map((item) => <button key={`p-${item}`} onClick={() => toggleIn(setSelectedMethods)(item)}>{item} ×</button>)}
            {tags.map((tag) => <button key={`t-${tag}`} onClick={() => toggleTag(tag)}>{tag} ×</button>)}
            {selectedJobs.map((item) => <button key={`j-${item}`} onClick={() => toggleIn(setSelectedJobs)(item)}>{item} ×</button>)}
            {selectedSubProfessions.map((item) => <button key={`s-${item}`} onClick={() => toggleIn(setSelectedSubProfessions)(item)}>{item} ×</button>)}
            {searchTerm && <button onClick={() => clearSearch()}>“{searchTerm}” ×</button>}
          </div>

          {/* 스크롤은 카드 그리드에서만 시작 — 헤딩(제목·검색·정렬)과 활성 필터 칩은 위에 고정
              (사용자 요청 2026-07-22: 스크롤바가 헤딩까지 올라오지 않게). */}
          <div className="results-scroll">
          {sorted.length > 0 ? (
            operatorGrid
          ) : (
            <div className="empty"><span>NO MATCH</span><h3>{t("조건에 맞는 오퍼레이터가 없어요.")}</h3><p>{t("소속이나 컨셉 태그를 하나씩 해제해 보세요.")}</p><button onClick={reset}><span className="btn-icon" aria-hidden>↻</span>{t("전체 보기")}</button></div>
          )}
          </div>
        </div>
      </section>}

      {tab === "planner" && <InfraPlanner onShowOperator={showOperatorById} extra={extra} includeFuture={includeFuture} />}
      {tab === "recruit" && <RecruitHelper onShowOperator={showOperatorById} extra={extra} />}
      {tab === "farm" && <FarmGuide includeFuture={includeFuture} />}
      {tab === "upgrade" && <UpgradeSim operators={operators} includeFuture={includeFuture} onShowOperator={showOperatorById} />}
      {tab === "story" && <StoryGuide summaries={summaries} onShowOperator={showOperatorById} includeFuture={includeFuture} opIndex={storyOpIndex} />}
      {tab === "rogue" && <RogueGuide includeFuture={includeFuture} />}
      {tab === "about" && <About onOpenTab={switchTab} />}

      <footer>
        <span>RHODES ISLAND // TERRA ARCHIVE</span>
        <p>{t("명일방주(Arknights) 비공식 팬 프로젝트 · 게임 내 명칭과 데이터의 권리는 Hypergryph / Yostar 등 각 권리자에게 있습니다.")}</p>
        {/* 비상업 고지 바로 아래에 자발적 서버 후원 링크(작게) — 수익이 아니라 운영비 보탬임을 명확히 */}
        <p className="footer-donate">
          <a href="https://buymeacoffee.com/terra_archive" target="_blank" rel="noopener noreferrer"
            title={t("광고 없이 운영되는 이 사이트의 서버·도메인 비용에 자발적으로 보태 주실 수 있어요 (Buy Me a Coffee). 후원은 전적으로 선택이며 아무 대가가 없습니다.")}>
            ☕ {t("서버 운영 후원")}
          </a>
        </p>
        {/* 크롤러용 실제 탭 링크 — 헤더 메뉴는 전부 버튼(SPA 탭 전환)이라 정적 HTML에 내부
            앵커가 하나도 없었고, 검색엔진에는 모든 탭이 고아 페이지였다 (GSC "발견됨 — 현재
            색인이 생성되지 않음": /stories·/en/stories·/ja/stories·/ja/about, 2026-07-28).
            href는 **파라미터 없는 정본 경로**여야 한다 — tabPath는 ?future=1을 실어 나르므로
            쓰지 않는다(그 URL이 색인 후보로 잡히면 "대체 페이지"가 늘어난다).
            클릭은 기존대로 SPA 전환 — 새 탭/수식어 클릭만 브라우저 기본 동작에 맡긴다. */}
        <nav className="footer-tabs" aria-label={t("사이트 메뉴")}>
          {(Object.keys(TAB_SEG) as Tab[]).map((tb) => {
            const seg = TAB_SEG[tb];
            const href = (localeBase + (seg ? `/${seg}` : "")) || "/";
            return tb === tab
              ? <strong key={tb}>{TAB_LABEL[tb]}</strong>
              : (
                <a key={tb} href={href} onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  switchTab(tb);
                }}>{TAB_LABEL[tb]}</a>
              );
          })}
        </nav>
        {/* 크롤러용 실제 언어 링크 — 헤더 전환기는 조건부 렌더 드롭다운이라 정적 HTML에
            /en·/ja 앵커가 하나도 없었다 (2026-07 색인 문제). 현재 탭 세그먼트를 보존한다. */}
        <nav className="footer-langs" aria-label={t("언어 선택")}>
          {LOCALES.map((entry) => {
            const seg = TAB_SEG[tab];
            const href = (LOCALE_BASE[entry.code] + (seg ? `/${seg}` : "")) || "/";
            return entry.code === locale
              ? <strong key={entry.code} lang={entry.code}>{entry.label}</strong>
              : <a key={entry.code} href={href} hrefLang={entry.code} lang={entry.code}>{entry.label}</a>;
          })}
        </nav>
      </footer>
      </div>{/* /.site-scroll */}

      {selected && <OperatorModal operator={selected} onClose={closeOperator} />}
      <FeedbackWidget open={feedbackOpen} setOpen={setFeedbackOpen} />
      {/* 팁 풍선 — 화면 빈 곳을 찾아 떠다닌다 (본문을 가리면 스스로 자리를 옮긴다) */}
      <TipBalloon />
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

// 여러 속성 필터(성급·직군·세부직군·전투태그·공격방식·소속)를 한 컨트롤로 — 카테고리를 누르면
// 그 값 태그가 펼쳐진다. 필터 패널이 세로로 끝없이 늘어나던 문제 해소 (사용자 요청 2026-07-22).
// 컨셉덱은 시그니처 기능이라 별도 유지.
type AttrGroup = { title: string; items: string[]; selected: string[]; onToggle: (value: string) => void; labelFor?: (value: string) => string; countForItem: (value: string) => number };
function AttributeFilter({ groups }: { groups: AttrGroup[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const active = groups.find((g) => g.title === open);
  return (
    <fieldset className="attr-filter">
      <legend>{t("세부 조건")}<small className="multi-hint">{t("항목을 눌러 값을 고르세요 · 복수 선택 가능")}</small></legend>
      <div className="attr-cats">
        {groups.map((g) => (
          <button key={g.title} type="button"
            className={`attr-cat${open === g.title ? " open" : ""}${g.selected.length ? " has-sel" : ""}`}
            aria-expanded={open === g.title}
            onClick={() => setOpen((current) => (current === g.title ? null : g.title))}>
            {g.title}{g.selected.length > 0 && <em>{g.selected.length}</em>}
            <span className="attr-caret" aria-hidden>{open === g.title ? "▴" : "▾"}</span>
          </button>
        ))}
      </div>
      {active && (
        <div className="filter-list attr-values">
          {active.items.map((item) => {
            const isSelected = active.selected.includes(item);
            return (
              <button key={item} className={isSelected ? "selected" : ""} aria-pressed={isSelected} onClick={() => active.onToggle(item)}>
                {active.labelFor ? active.labelFor(item) : item}<span>{active.countForItem(item)}</span>
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function OperatorCard({ operator, index, onSelect }: { operator: Operator; index: number; onSelect: (operator: Operator) => void }) {
  const { locale, t } = useI18n();
  // 카드가 화면 근처에 실제로 들어오기 전엔 이미지 자체를 마운트하지 않는다 — 진입 즉시
  // 420장이 전부 요청되던 문제 대응 (스크롤·필터링 시에만 그때그때 받아옴, 2026-07-22)
  const [portraitRef, visible] = useLazyVisible<HTMLDivElement>();
  return (
    <button type="button" className="operator-card" onClick={() => onSelect(operator)} aria-label={t("{name} 상세 정보 열기", { name: operator.name })} style={{ "--accent": operator.accent, "--delay": `${(index % 12) * 25}ms` } as React.CSSProperties}>
      <div className="portrait" ref={portraitRef}>
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
        {visible && <img src={asset(operator.image)} alt={t("{name} 오퍼레이터", { name: operator.name })} width={180} height={180} decoding="async" />}
      </div>
      <div className="card-body">
        <div className="tags">{operator.concepts.map((tag) => <span key={tag}>{conceptName(locale, tag)}</span>)}</div>
      </div>
    </button>
  );
}

function OperatorModal({ operator, onClose }: { operator: Operator; onClose: () => void }) {
  const { locale, t } = useI18n();
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal" role="dialog" aria-modal="true" aria-labelledby="operator-modal-title" style={{ "--accent": operator.accent } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("상세 정보 닫기")}>×</button>
        <header className="modal-hero">
          <img src={asset(operator.image)} alt={t("{name} 오퍼레이터", { name: operator.name })} width={180} height={180} />
          <div className="modal-title-block">
            <div className="modal-title-main">
              <span className="modal-kicker">OPERATOR FILE · {operator.code}</span>
              <div className="modal-name-row">
                <h2 id="operator-modal-title">{operator.name}</h2>
              </div>
              <div className="modal-rarity">{"★".repeat(operator.rarity)} <span>{t("{n}성", { n: operator.rarity })}</span>{operator.unreleased && <em className="future-badge">{t("미실장")}</em>}</div>
              <div className="class-line">
                <div><b>{operator.job}</b><small>{operator.subProfession} · {operator.position}</small></div>
              </div>
              {operator.unreleased && <p className="future-note">{t("미실장 오퍼레이터입니다 — 중국 서버 데이터 기준이며, 스킬·재능 등 텍스트는 비공식 AI 번역이라 정식 출시 시 공식 번역과 다를 수 있습니다.")}</p>}
            </div>
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

          <SkinSection operator={operator} />

          <ProfileSection operator={operator} />
        </div>
      </section>
    </div>
  );
}

// ── 스킨(복장) ───────────────────────────────────────────────────────────────
// 클뜯 skin_table + yuanyan3060 포트레이트(반신 초상). 프로필과 같은 지연 로딩 —
// 오퍼당 메타 파일 1개를 모달 열 때만 받는다 (scripts/build-skins.py).
type SkinEntry = {
  id: string; name: string; stage: string; group: string; artists: string[];
  content: string; usage: string; quote: string; obtain: string;
  portrait: string; sort: number; default: boolean;
};
type SkinDoc = { id: string; skins: SkinEntry[] };

const skinCache = new Map<string, SkinDoc | null>();

function SkinSection({ operator }: { operator: Operator }) {
  const { locale, t } = useI18n();
  const key = `${locale}/${operator.id}`;
  const [doc, setDoc] = useState<SkinDoc | null | undefined>(() => skinCache.get(key));
  const [picked, setPicked] = useState(0);
  const [zoom, setZoom] = useState<SkinEntry | null>(null); // 전체 일러스트 확대 보기

  useEffect(() => { setPicked(0); setZoom(null); }, [operator.id]);
  useEffect(() => {
    if (skinCache.has(key)) { setDoc(skinCache.get(key)); return; }
    let alive = true;
    fetch(asset(`/skins/${locale}/${operator.id}.json`))
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data: SkinDoc | null) => {
        skinCache.set(key, data);
        if (alive) setDoc(data);
      });
    return () => { alive = false; };
  }, [key, locale, operator.id]);

  const skins = doc?.skins ?? [];
  const current = skins[Math.min(picked, skins.length - 1)];
  return (
    <section className="detail-section">
      <span className="detail-no">SKIN / 08</span>
      <h3>{t("복장")}{skins.length > 0 && <em className="detail-count">{skins.length}</em>}</h3>
      {doc === undefined ? (
        <p className="no-detail">{t("불러오는 중…")}</p>
      ) : !skins.length ? (
        <p className="no-detail">{t("등록된 복장이 없습니다.")}</p>
      ) : (
        <div className="skin-block">
          <div className="skin-tabs" role="tablist">
            {skins.map((skin, index) => (
              <button key={skin.id} type="button" role="tab" aria-selected={index === picked}
                className={index === picked ? "selected" : ""} onClick={() => setPicked(index)}>
                {skin.name || t("기본 복장")}
                {/* 기본 복장은 전부 이름이 같다 — 정예화 단계로 구분 (사용자 요청 2026-07-28) */}
                {skin.stage && <i>{t(skin.stage)}</i>}
              </button>
            ))}
          </div>
          {current && (
            <article className="skin-view">
              {/* 공개 미러에 아직 안 올라온 최신 스킨이 있다 (2026-07-28 기준 1,265종 중 41종) —
                  깨진 이미지 아이콘 대신 자리표시자로 대체한다 */}
              <SkinPortrait skin={current} fallbackAlt={operator.name} onZoom={() => setZoom(current)} />
              <div className="skin-meta">
                <h4>{current.name || t("기본 복장")}{current.stage && <em className="skin-stage">{t(current.stage)}</em>}</h4>
                <dl>
                  {current.group && <div><dt>{t("시리즈")}</dt><dd>{current.group}</dd></div>}
                  {current.artists.length > 0 && <div><dt>{t("일러스트")}</dt><dd>{current.artists.join(" · ")}</dd></div>}
                  {current.obtain && <div><dt>{t("획득처")}</dt><dd>{current.obtain}</dd></div>}
                </dl>
                {current.content && <p className="skin-content">{current.content}</p>}
                {current.usage && <p className="skin-usage">{current.usage}</p>}
                {current.quote && <blockquote className="skin-quote">{current.quote}</blockquote>}
              </div>
            </article>
          )}
        </div>
      )}
      {zoom && <SkinLightbox skin={zoom} alt={operator.name} onClose={() => setZoom(null)} />}
    </section>
  );
}

// 전체 일러스트 확대 — 원본 2500px를 1200px로 줄여 받아 둔 것을 화면에 맞춰 띄운다.
// 모달 위에 겹치므로 z-index는 .modal-backdrop(100)보다 위.
function SkinLightbox({ skin, alt, onClose }: { skin: SkinEntry; alt: string; onClose: () => void }) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    // 확대 상태에서는 **어디를 눌러도** 닫힌다 (사용자 요청 2026-07-28) — 배경만 받으면
    // 그림 위를 눌렀을 때 아무 일도 안 일어나 갇힌 느낌이 든다
    <div className="skin-lightbox" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <button type="button" className="modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
      {broken ? (
        <p className="skin-lightbox-empty">{t("전체 일러스트가 아직 없습니다.")}</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset(`/skin/full/${encodeURIComponent(skin.portrait)}.webp`)}
          alt={skin.name || alt} onError={() => setBroken(true)} />
      )}
      <figcaption>{skin.name || alt}{skin.artists.length > 0 && <em> · {skin.artists.join(" · ")}</em>}</figcaption>
    </div>
  );
}

function SkinPortrait({ skin, fallbackAlt, onZoom }: { skin: SkinEntry; fallbackAlt: string; onZoom: () => void }) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [skin.portrait]);
  if (!skin.portrait || broken) {
    return <div className="skin-portrait-empty" aria-hidden>{t("이미지 없음")}</div>;
  }
  return (
    <button type="button" className="skin-portrait" onClick={onZoom} title={t("클릭하면 전체 일러스트로 봅니다")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset(`/skin/portrait/${encodeURIComponent(skin.portrait)}.webp`)}
        alt={skin.name || fallbackAlt} loading="lazy" width={180} height={360}
        onError={() => setBroken(true)} />
      <span aria-hidden>⤢</span>
    </button>
  );
}

// ── 오퍼레이터 파일(프로필 텍스트) ───────────────────────────────────────────
// 게임 내 기록실 문서 전문(기본정보·종합검진·프로필·임상 진단·파일 자료·승진 기록).
// 전문 합계가 4.5MB라 operators.json에 못 싣고 **오퍼당 파일 1개**(~11KB)로 쪼개
// R2에서 서빙한다 (scripts/build-profiles.py) — 모달을 열 때만 그 한 장을 받는다.
type ProfileSectionData = { title: string; text: string; unlock: { type: string; param: string | null } | null };
type ProfileDoc = { id: string; sections: ProfileSectionData[]; source?: string };

const profileCache = new Map<string, ProfileDoc | null>();

function ProfileSection({ operator }: { operator: Operator }) {
  const { locale, t } = useI18n();
  const key = `${locale}/${operator.id}`;
  const [doc, setDoc] = useState<ProfileDoc | null | undefined>(() => profileCache.get(key));

  useEffect(() => {
    if (profileCache.has(key)) { setDoc(profileCache.get(key)); return; }
    let alive = true;
    fetch(asset(`/profiles/${locale}/${operator.id}.json`))
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data: ProfileDoc | null) => {
        profileCache.set(key, data);
        if (alive) setDoc(data);
      });
    return () => { alive = false; };
  }, [key, locale, operator.id]);

  // 해금 조건 배지 — FAVOR=신뢰도, AWAKE=승진("2;1" = 정예화 2 이후 1단계)
  const unlockLabel = (unlock: ProfileSectionData["unlock"]) => {
    if (!unlock) return null;
    if (unlock.type === "FAVOR") return t("신뢰도 {n}", { n: unlock.param ?? "?" });
    if (unlock.type === "AWAKE") return t("승진 {n}", { n: (unlock.param ?? "").split(";")[0] || "?" });
    return t("추가 해금");
  };

  return (
    <section className="detail-section">
      <span className="detail-no">PROFILE / 09</span>
      <h3>{t("오퍼레이터 파일")}</h3>
      {doc === undefined ? (
        <p className="no-detail">{t("불러오는 중…")}</p>
      ) : !doc?.sections?.length ? (
        <p className="no-detail">{t("등록된 프로필 문서가 없습니다.")}</p>
      ) : (
        <>
          {doc.source === "cn" && (
            <p className="future-note">{t("중국 서버 원문입니다 — 아직 한국 서버에 등록되지 않아 번역 전 텍스트입니다.")}</p>
          )}
          <div className="profile-docs">
            {doc.sections.map((section, index) => (
              // 해금이 걸린 문서(신뢰도·승진)는 접어 둔다 — 스포일러이자, 안 접으면 모달이 배로 길어진다
              <ProfileDoc key={index} section={section} badge={unlockLabel(section.unlock)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ProfileDoc({ section, badge }: { section: ProfileSectionData; badge: string | null }) {
  const body = <ProfileBody text={section.text} />;
  if (!badge) {
    return (
      <article className="profile-doc">
        <h4>{section.title}</h4>
        {body}
      </article>
    );
  }
  return (
    <details className="profile-doc profile-doc-locked">
      <summary><h4>{section.title}</h4><em>{badge}</em></summary>
      {body}
    </details>
  );
}

// 기본정보·종합검진은 "[항목] 값" 줄의 나열이라 표로, 나머지 서술형 문서는 문단으로.
const FACT_LINE = /^[[【]([^\]】]+)[\]】]\s*(.*)$/;

function ProfileBody({ text }: { text: string }) {
  const lines = text.split("\n").filter((line) => line.trim());
  const facts = lines.map((line) => FACT_LINE.exec(line.trim()));
  if (facts.length && facts.every(Boolean) && facts.length > 1) {
    return (
      <dl className="profile-facts">
        {facts.map((fact, index) => (
          <div key={index}><dt>{fact![1]}</dt><dd>{fact![2] || "—"}</dd></div>
        ))}
      </dl>
    );
  }
  return (
    <div className="profile-text">
      {lines.map((line, index) => {
        const fact = FACT_LINE.exec(line.trim());
        // 서술형 문서 중간에 끼는 [제한된 기록] 같은 머리표는 소제목으로 띄운다
        return fact && !fact[2]
          ? <b key={index} className="profile-lead">{fact[1]}</b>
          : <p key={index}>{line}</p>;
      })}
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
