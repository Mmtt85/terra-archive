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
// 헤더 치비 대화 — 크롬 내장 Gemini Nano (베타, 2026-08-03)
import { ChibiChatPanel, chibiChatAvailability } from "./chibi-chat";
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
import { PORTAL_TILES, PORTAL_ART, type PortalTile } from "./portal-themes";
import { useLazyVisible } from "./lazy-img";
import { I18nProvider, useI18n, conceptName, DT_LOCALE, MAGIC_TRAIT_RE, LOCALES, type Locale, type ExtraI18n } from "./i18n";
import { SPECIAL_CONCEPTS, conceptTitle, conceptMatches, resolveConcepts, suggestConcepts } from "./concepts";

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
  // 스킬이 공격 범위를 바꿀 때만 붙는다 (범위 확대·변경 계열 228개) — 없으면 기본 범위 그대로
  rangeId?: string;
  range?: RangeGrid[];
  // 소환물 발동 범위 — 클뜯 rangeId가 실제와 달라 손수 확인해 넣은 값
  // (scripts/regen-operators.py의 SUMMON_SKILL_RANGE, 현재 왕 S2·S3). note는 i18n 키.
  summonId?: string;
  summonRange?: RangeGrid[];
  summonNote?: string;
};

type Talent = { name: string; description: string };

// 소환물(토큰) — displayTokenDict 기준, KR 48명 + CN 선행 5명 (사용자 요청 2026-08-01).
// 스탯은 최종 단계 한 줄만: 소환물은 본체를 따라 크므로 정예화 표가 의미 없다.
type Summon = {
  id: string; name: string; trait: string;
  rangeId?: string; range: RangeGrid[];
  hp: number; atk: number; def: number; res: number;
  block: number; redeploy: number; interval: number;
  talents: Talent[]; skills: Skill[];
};

type Potential = { rank: number; description: string };

type ModuleLevel = { level: number; stats: string | null; effects: string[] };
// unreleased = KR엔 아직 없고 중섭에만 있는 모듈 — '미래시 포함'이 켜졌을 때만 보여준다
// (사용자 요청 2026-08-01, 실측 18건: 피아메타 통합전략 전용 등)

type OperatorModule = {
  id: string;
  name: string;
  type: string;
  unlock: string;
  levels: ModuleLevel[];
  /** KR엔 아직 없고 중섭에만 있는 모듈 — '미래시 포함'이 켜졌을 때만 노출 */
  unreleased?: boolean;
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
  summons: Summon[];
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
// 공식 카페 이벤트 게시판 — 개별 공지를 못 찾은 이벤트의 착지점 (2026-07-31 실확인: 로그인 없이 열린다)
const CAFE_EVENT_BOARD = "https://cafe.naver.com/f-e/cafes/29703924/menus/3";
// 미실장(중섭 선행) 이벤트 — 헤더 이벤트 드롭다운 '향후 다가올'에 추정월과 함께 노출 (미래시 ON일 때만).
// 정렬은 추정월 이른(= 먼저 KR에 올) 순 — 다음에 올 이벤트가 위로.
const futureEvents = storyEventsList
  .filter((event) => event.unreleased)
  .sort((a, b) => (a.eta ?? a.id).localeCompare(b.eta ?? b.id));
// 섬네일이 없는 이벤트(= 스토리 이벤트가 아닌 **게임 모드**)를 위한 글리프.
// 벡터 돌파·생존 연산 같은 모드는 story_review_table에 없어 storyEntryPicId 자체가 없다
// (실측 2026-07-30: act2break는 KR·CN 어느 저장소에도 배너 에셋이 없다).
// 빈 칸으로 두는 대신 종류를 알아볼 수 있는 기호 하나로 통일한다 (사용자 확정 2026-07-30).
const MODE_GLYPH: [RegExp, string][] = [
  [/VEC_BREAK/, "⇉"],      // 벡터 돌파
  [/SANDBOX/, "▣"],        // 생존 연산
  [/ROGUELIKE/, "❖"],      // 통합전략
  [/BOSS|CHALLENGE/, "⚔"],
  [/COLLECTION|SWITCH/, "◇"],
];
const modeGlyph = (event: GameEvent): string =>
  MODE_GLYPH.find(([re]) => re.test(event.type ?? ""))?.[1] ?? "✦";

// 사이드스토리·복각 등 굵직한 이벤트 — 배지 대표로 우선한다 (로그인·출석류보다)
const MAJOR_EVENT_TYPES = new Set(["SIDESTORY", "BRANCHLINE", "MINISTORY"]);
// 로그인·출석·기원 등 "보상 수령만" 하는 잔이벤트 — 헤더에서 아예 숨긴다 (사용자 확정 2026-07-17).
// 콜라보(SWITCH_ONLY)·한정임무(COLLECTION/MISSION_ONLY) 같은 실제 콘텐츠 이벤트는 "_ONLY"라도
// 남기므로 접미사 일괄 필터가 아니라 명시적 블록리스트로 관리한다.
// 2026-07-31 보강 (사용자 지적 "부 이벤트는 표시 안 하기로 했다") — activity_table 전수로
// 확인한 출석·로그인 계열을 마저 넣는다. 괄호는 그 type의 실제 이벤트명:
//   UNIQUE_ONLY(부활의 찬가 출석·축전 특별·나인컬러드 디어 재개방 출석)
//   CHECKIN_VS('햇빛이여 비추소서' 출석) · CHECKIN_ACCESS(추천 먼슬리카드)
//   CHECKIN_ALL_PLAYER(미래서곡 출석) · GRID_GACHA(_V2)(밸리 광산 로그인·채굴 허가증)
//   FLIP_ONLY(와르르 소원패)
const MINOR_EVENT_TYPES = new Set([
  "LOGIN_ONLY", "CHECKIN_ONLY", "PRAY_ONLY", "BLESS_ONLY",
  "UNIQUE_ONLY", "CHECKIN_VS", "CHECKIN_ACCESS", "CHECKIN_ALL_PLAYER",
  "GRID_GACHA", "GRID_GACHA_V2", "FLIP_ONLY",
]);

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
          <div className="event-trigger is-skeleton">
            <span className="event-mark" aria-hidden>✦</span>
            <span>{t("이벤트")}</span>
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
  const eventBadge = headline && (
    <div className="event-group" ref={evRef}>
      {/* 배너째로 1줄에 눕히던 것을 확장부의 작은 버튼으로 (사용자 요청 2026-07-30).
          라벨은 "이벤트"로 **고정** — 이벤트 이름을 넣으면 이름 길이에 따라 헤더 폭이
          흔들린다(햄버거 '메뉴' 라벨을 고정한 것과 같은 이유). 상태는 짧은 힌트로만 붙이고,
          섬네일·기간·전체 목록은 눌렀을 때 드롭다운에서 보여준다. */}
      <button type="button" className="event-trigger" aria-expanded={evOpen}
        onClick={() => setEvOpen((o) => !o)} title={t("진행중·예정 이벤트 보기")}>
        <span className="event-mark" aria-hidden>✦</span>
        <span>{t("이벤트")}</span>
        <span className={`event-hint${headlineUpcoming ? " upcoming" : ""}`}>
          · {headlineUpcoming ? t("시작 D-{n}", { n: startDday(headline) }) : `D-${dday(headline)}`}
        </span>
        <span className="event-caret" aria-hidden>▾</span>
      </button>
      {evOpen && (
        <div className="event-menu" role="dialog" aria-label={t("진행중·예정 이벤트")}>
          {running.length > 0 && <>
            <h3>{t("진행중 이벤트")}</h3>
            <ul>
              {running.map((event) => {
                // 버튼이 작아졌으니 대표 이벤트도 여기서 섬네일을 보여준다 (사용자 요청 2026-07-30)
                const thumb = evThumb(event);
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
                const thumb = evThumb(event);
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

// 포탈 첫화면 — 게임 홈 화면을 본뜬 대문 (사용자 요청 2026-07-30: "인게임 UI에 맞춰보자").
// 칸 ↔ 기능 매핑과 테마(겉모습)는 app/portal-themes.ts에 분리해 뒀다 — 테마를 갈아끼워도
// 버튼 구성은 그대로다. 색(--pt-*)은 globals.css의 .pt-stage / html.dark .pt-stage.
//
// ⚠ 종전 규칙 변경: 포탈은 "진입 시 오퍼 이미지 로딩이 전혀 없다"(2026-07-17)였는데,
//    게임 UI를 흉내 내려면 배경 캐릭터 아트가 필요하다. 대신 **한 장(약 180KB)만** 쓰고
//    fetchpriority=low·decoding=async로 내려, 종전 카드 그리드보다 요청 수는 오히려 적다.
const SITE_OPENED = Date.parse("2026-07-11T00:00:00+09:00"); // 첫 커밋일 — LV 자리의 '운영 일수'

function Portal({ onOpenTab, onFeedback, stats }: {
  onOpenTab: (tab: Tab) => void;
  onFeedback: () => void;
  stats: { operators: number; summaries: number };
}) {
  const { locale, t } = useI18n();

  const [now, setNow] = useState<number | null>(null); // 서버 렌더엔 시각이 없다 → 마운트 후
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [slide, setSlide] = useState(0);   // 배너에서 몇 번째 이벤트를 보고 있나
  const [hold, setHold] = useState(false); // 마우스를 올린 동안은 자동 넘김을 멈춘다
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    void fetchBcastPayload().then((data) => { if (data) setEvents(data.events); });
    return () => clearInterval(id);
  }, []);
  // 팔레트는 사이트 밝기를 그대로 따라간다 — 별도 테마 선택지를 두지 않는다
  // (사용자 확정 2026-07-30). 헤더에서 다크 모드를 켜면 그 자리에서 같이 바뀐다.
  // ⚠ 여기서 JS로 고르지 않는다 — 서버 렌더는 다크 여부를 알 수 없어 항상 라이트 팔레트를
  //    내보냈고, 다크 사용자가 새로고침하면 하이드레이션 전까지 밝은 판이 번쩍였다
  //    (사용자 제보 2026-07-31 "눈이 부신데"). --pt-* 값은 globals.css의 html.dark가 쥔다.

  // 배너 칸 = 진행중 + 진행 예정을 좌우로 넘겨 본다 (사용자 요청 2026-07-30).
  // 진행중이 앞, 그 뒤에 시작이 임박한 순으로 예정 이벤트.
  const running = now == null ? [] : sortRunning(events, now);
  const upcoming = now == null ? [] : events
    .filter((e) => Date.parse(e.start) > now && !MINOR_EVENT_TYPES.has(e.type ?? ""))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const reel = [...running, ...upcoming];
  const at = reel.length ? ((slide % reel.length) + reel.length) % reel.length : 0;
  const headline = reel[at];
  const soon = headline != null && now != null && Date.parse(headline.start) > now;
  // 게이지: 이벤트 기간 중 지난 비율 (게임의 이성 시계 자리 — 값은 실제 기간에서 계산)
  const ratio = headline && now != null
    ? Math.min(1, Math.max(0, (now - Date.parse(headline.start)) / (Date.parse(headline.end) - Date.parse(headline.start))))
    : 0;
  const dleft = headline && now != null
    ? Math.max(0, Math.ceil((Date.parse(soon ? headline.start : headline.end) - now) / DAY))
    : 0;

  // 이벤트가 둘 이상이면 6초마다 다음 칸으로 (사용자 요청 2026-07-30).
  // 읽는 중에 넘어가면 성가시므로 마우스를 올린 동안은 멈춘다.
  const reelLen = reel.length;
  useEffect(() => {
    if (reelLen < 2 || hold) return;
    const id = setInterval(() => setSlide((n) => n + 1), 6000);
    return () => clearInterval(id);
  }, [reelLen, hold]);

  const openTile = (tile: PortalTile) => {
    // 이벤트 칸은 공식 카페 공지로 (사용자 지시 2026-07-30). 공지가 없는 이벤트만 스토리로.
    if (tile.kind === "banner") {
      if (headline?.url) { window.open(headline.url, "_blank", "noopener"); return; }
      // 공지를 못 찾았을 때: **스토리가 있는 이벤트만** 스토리 탭으로 보낸다. 벡터 돌파처럼
      // 스토리가 없는 이벤트를 스토리로 보내면 엉뚱한 곳에 떨어진다 (사용자 지적 2026-07-31
      // "왜 스토리로 연결이 돼?") — 그런 이벤트는 공식 카페 이벤트 게시판으로.
      if (headline && !storyEventById.has(headline.id)) {
        window.open(CAFE_EVENT_BOARD, "_blank", "noopener"); return;
      }
      onOpenTab("story"); scrollMainTop(); return;
    }
    if (tile.action === "feedback") return onFeedback();
    if (tile.action === "changelog") { window.location.hash = "#changelog-all"; return; }
    if (tile.action === "donate") { window.open("https://buymeacoffee.com/terra_archive", "_blank", "noopener"); return; }
    if (tile.href) { window.open(tile.href, "_blank", "noopener"); return; }
    if (tile.tab) { onOpenTab(tile.tab as Tab); scrollMainTop(); }
  };

  const days = now == null ? 0 : Math.max(1, Math.floor((now - SITE_OPENED) / DAY) + 1);

  return (
    <section className="pt-stage" aria-labelledby="portal-title">
      <span className="pt-scrim" aria-hidden />

      {/* 좌측 — 일러스트와 박사 프로필. 아트를 이 칸 기준으로 잡아야 타일 옆에 붙는다
          (스테이지 기준이면 화면이 넓어질수록 타일과 멀어진다 — 사용자 지적 2026-07-30). */}
      <div className="pt-left">
        {/* 장식이므로 alt는 비운다. 늦게 떠도 레이아웃이 안 밀리게 절대배치. */}
        <img className="pt-art" src={asset(PORTAL_ART)} alt="" decoding="async" fetchPriority="low" />
      <div className="pt-player">
        <span className="pt-lv"><b>{days}</b><small>DAY</small></span>
        <h1 id="portal-title" className="pt-name">{t("테라 아카이브")}</h1>
        <p className="pt-sub">{t("명일방주(아크나이츠) 팬사이트 — 필요한 도구를 골라 들어가세요.")}</p>
        </div>
      </div>

      {/* 우측 타일 — 배치는 CSS grid-template-areas(=tile.area)가 잡는다 */}
      <div className="pt-tiles">
        {PORTAL_TILES.map((tile) => {
          // 배너는 tab/action이 없어도 이벤트 공지를 여는 칸이다 — 장식 판정에서 제외
          const dead = tile.kind !== "banner" && !tile.tab && !tile.action && !tile.href;
          const isBanner = tile.kind === "banner";
          const thumb = isBanner && headline ? eventThumb(locale, headline) : undefined;
          return (
            <button key={tile.id} type="button" disabled={dead}
              className={`pt-tile pt-${tile.kind} pt-t-${tile.id}${dead ? " dead" : ""}${isBanner && !thumb ? " nothumb" : ""}`}
              style={{ gridArea: tile.area }}
              onMouseEnter={isBanner ? () => setHold(true) : undefined}
              onMouseLeave={isBanner ? () => setHold(false) : undefined}
              onClick={() => openTile(tile)}
              title={dead ? t("사이트에는 없는 기능이에요") : t(tile.label)}>
              {isBanner ? (
                <span className="pt-banner-in">
                  {thumb
                    ? <img className="pt-banner-img" src={thumb} alt="" loading="lazy" decoding="async" />
                    : headline && <span className="pt-mode" aria-hidden>{modeGlyph(headline)}</span>}
                  {/* 게이지 = 이벤트 진행률. 게임의 이성 시계 자리를 실제 기간에서 계산해 채운다. */}
                  <span className="pt-gauge" style={{ "--pt-ratio": ratio } as React.CSSProperties}>
                    <b>{headline ? `D-${dleft}` : "—"}</b>
                    <small>{soon ? t("시작") : t("종료")}</small>
                  </span>
                  <span className="pt-banner-txt">
                    <b>{headline ? eventName(locale, headline) : t("진행중 이벤트")}</b>
                    <small>{headline ? t(soon ? "곧 시작합니다" : "진행중") : t("불러오는 중…")}</small>
                  </span>
                  {/* 좌우로 진행 예정 이벤트까지 넘겨 본다. 버튼이라 안쪽에 두면 중첩되므로
                      배너 클릭(카페 공지 열기)과 겹치지 않게 이벤트 전파를 막는다. */}
                  {reel.length > 1 && (
                    <>
                      <span className="pt-nav prev" role="button" tabIndex={0} aria-label={t("이전 이벤트")}
                        onClick={(e) => { e.stopPropagation(); setSlide(at - 1); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setSlide(at - 1); } }}>‹</span>
                      <span className="pt-nav next" role="button" tabIndex={0} aria-label={t("다음 이벤트")}
                        onClick={(e) => { e.stopPropagation(); setSlide(at + 1); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setSlide(at + 1); } }}>›</span>
                      <span className="pt-dots" aria-hidden>{reel.map((_, i) => <i key={i} className={i === at ? "on" : ""} />)}</span>
                    </>
                  )}
                </span>
              ) : (
                <>
                  <span className="pt-head">
                    <span className="pt-ic" aria-hidden>{tile.icon}</span>
                    <span className="pt-ko">{t(tile.label)}</span>
                  </span>
                  {tile.desc && <span className="pt-desc">{t(tile.desc)}</span>}
                </>
              )}
            </button>
          );
        })}
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
      // 태그가 아닌 특수 조건(통합전략 전용 모듈 등)도 같은 검색창에서 찾힌다 — app/concepts.ts
      ...SPECIAL_CONCEPTS.filter((entry) => roster.some((operator) => entry.match(operator))).map((entry) => entry.key),
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
      for (const entry of SPECIAL_CONCEPTS) if (entry.match(operator)) bump(concept, entry.key);
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
  // 오퍼 상세 → 육성 시뮬로 그 오퍼를 담아 이동 (사용자 요청 2026-08-01).
  // UpgradeSim은 마운트 때 ?ops를 한 번 읽으므로 URL을 먼저 맞춰 두고 탭을 바꾼다.
  // ⚠ tabPath가 ?future=1을 달고 올 수 있어 문자열 이어붙이기 금지 — switchRogueTopic과 같은 함정.
  const openUpgradeFor = (operatorId: string) => {
    const [path, query] = tabPath("upgrade").split("?");
    const params = new URLSearchParams(query);
    params.set("ops", operatorId);
    history.pushState(null, "", `${path}?${params}`);
    startTransition(() => { setTab("upgrade"); setSelected(null); });
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
  const [sortKey, setSortKey] = useState("발매순");
  // 기본 정렬 = 발매순 내림차순(최신 오퍼가 맨 앞) — 사용자 요청 2026-08-01.
  // ↑로 뒤집으면 오래된 순. 다른 정렬 키로 바꾸면 그 키의 내림차순으로 시작한다.
  const [sortAsc, setSortAsc] = useState(false);

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
      const matchesConcept = selectedConcepts.length === 0 || selectedConcepts.some((concept) => conceptMatches(concept, operator));
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
        {/* 헤더 치비 (베타) — 1줄 가운데 빈 공간의 산책 장식, 데스크탑 전용 (사용자 요청 2026-08-03) */}
        <HeaderChibi operators={operators} />
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
            {/* 진행중 이벤트 · 공식 방송 — 둘 다 확장부로 (이벤트 배지는 사용자 요청 2026-07-30에
                1줄 배너에서 여기 작은 버튼으로 내려왔다. 방송은 2026-07-25부터 여기). */}
            <BroadcastBadges includeFuture={includeFuture} slot="events" />
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

      {tab === "portal" && <Portal onOpenTab={switchTab} onFeedback={() => setFeedbackOpen(true)}
        stats={{ operators: operators.length, summaries: Object.keys(summaries).length }} />}

      {tab === "archive" && <section className="explorer" aria-labelledby="explorer-title">
        <div className="filter-panel">
          <div className="panel-heading">
            <div><span className="section-no">FILTER / 01</span><h2 id="explorer-title">{t("탐색 조건")}</h2></div>
            <button className="reset" onClick={reset}>↻ {t("초기화")}</button>
          </div>
          {/* 컨셉덱은 시그니처 기능이라 맨 위에 항상 펼쳐 둔다 (사용자 요청 2026-07-22).
              태그 벽 대신 검색으로 (사용자 요청 2026-08-01) — 별칭 사전은 app/concepts.ts. */}
          <ConceptSearch keys={concepts} selected={selectedConcepts} onSet={setSelectedConcepts}
            countFor={(item) => chipCount.concept.get(item) ?? 0} />
          {/* 성급·직군·세부직군·전투태그·공격방식·소속은 한 컨트롤로 합쳐 카테고리→값 방식으로. */}
          <AttributeFilter groups={[
            { title: t("성급"), items: rarities, selected: selectedRarities, onToggle: toggleIn(setSelectedRarities), labelFor: (item) => `${item}★`, countForItem: (item) => chipCount.rarity.get(item) ?? 0 },
            { title: t("직군"), items: jobs, selected: selectedJobs, onToggle: toggleIn(setSelectedJobs), countForItem: (item) => chipCount.job.get(item) ?? 0 },
            { title: t("세부 직군"), items: subProfessions, selected: selectedSubProfessions, onToggle: toggleIn(setSelectedSubProfessions), countForItem: (item) => chipCount.sub.get(item) ?? 0 },
            { title: t("전투 태그"), items: combatTags, selected: tags, onToggle: toggleTag, countForItem: (item) => chipCount.tag.get(item) ?? 0 },
            { title: t("공격 방식"), items: attackMethods, selected: selectedMethods, onToggle: toggleIn(setSelectedMethods), countForItem: (item) => chipCount.method.get(item) ?? 0 },
            { title: t("공식 소속"), items: factions, selected: selectedFactions, onToggle: toggleIn(setSelectedFactions), countForItem: (item) => chipCount.faction.get(item) ?? 0 },
          ]} />
          {/* (2026-08-01 삭제) DATA NOTE — 사용자 판단 "의미가 없어보임" */}
        </div>

        <div className="results">
          <div className="results-heading">
            <div><span className="section-no">RESULT / 02</span><h2>{selectedConcepts.length === 1 ? t("{concept} 컨셉덱", { concept: conceptTitle(locale, selectedConcepts[0]) }) : selectedFactions.length === 1 ? selectedFactions[0] : hasActiveFilter ? t("탐색 결과") : t("전체 오퍼레이터")}</h2></div>
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
            {selectedConcepts.map((item) => <button key={`c-${item}`} onClick={() => toggleIn(setSelectedConcepts)(item)}>{conceptTitle(locale, item)} ×</button>)}
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

      {selected && <OperatorModal operator={selected} onClose={closeOperator} onUpgrade={openUpgradeFor} includeFuture={includeFuture} />}
      <FeedbackWidget open={feedbackOpen} setOpen={setFeedbackOpen} />
      {/* 팁 풍선 — 화면 빈 곳을 찾아 떠다닌다 (본문을 가리면 스스로 자리를 옮긴다) */}
      <TipBalloon />
    </main>
  );
}

// 컨셉덱 검색 — 태그 40여 개를 벽처럼 깔던 걸 입력창으로 바꿨다 (사용자 요청 2026-08-01).
// **검색 버튼(또는 Enter)을 눌러야** 필터가 걸린다 — 글자마다 목록이 튀지 않게.
// 입력 중에는 후보만 띄우고, 후보를 직접 누르면 그건 명시적 선택이므로 바로 적용한다.
// 별칭 사전("슬로우"→감속·정지, "록라모듈"→통합전략 전용 모듈)은 app/concepts.ts.
// ⚠ 컨셉덱은 **한 번에 하나만** 고른다 (사용자 확정 2026-08-01) — 새로 고르면 앞의 것을
// 밀어내고, 같은 걸 두 번 담지 않는다.
function ConceptSearch({ keys, selected, onSet, countFor }: {
  keys: string[]; selected: string[]; onSet: (values: string[]) => void; countFor: (value: string) => number;
}) {
  const { locale, t } = useI18n();
  // text === null = "안 치는 중" — 그때 입력창은 **지금 걸린 컨셉 이름**을 보여준다
  // (사용자 요청 2026-08-01: 뭘로 검색됐는지는 검색란에 표시). 상태를 따로 동기화하지 않고
  // 이렇게 파생시켜야 활성 필터 칩(×)으로 해제됐을 때 입력창도 저절로 비워진다.
  const [text, setText] = useState<string | null>(null);
  const [miss, setMiss] = useState("");
  const [open, setOpen] = useState(false);   // 후보 드롭다운 (사용자 요청 2026-08-01)
  const [cursor, setCursor] = useState(-1);  // 방향키로 짚은 후보
  const boxRef = useRef<HTMLDivElement>(null);
  const pendingEnter = useRef(false);        // 한글 조합 중에 눌린 Enter (아래 onCompositionEnd)

  const typed = text ?? "";                                                  // 실제로 친 글자
  const shown = text ?? (selected.length ? conceptTitle(locale, selected[0]) : "");   // 화면에 보이는 값

  // 입력이 비어 있으면 전체 목록 — 드롭다운이라 자리를 안 먹으니 여기서 훑어볼 수 있다.
  // 걸린 컨셉 이름이 비쳐 보이는 것뿐일 땐(text === null) 그걸 검색어로 치지 않는다 —
  // 다시 열었을 때 후보가 그 하나로 쪼그라들면 다른 컨셉으로 갈아탈 수가 없다.
  const list = useMemo(() => {
    const pool = typed.trim() ? suggestConcepts(typed, keys, 40) : keys;
    return pool.filter((key) => !selected.includes(key));
  }, [typed, keys, selected]);

  useEffect(() => { setCursor(-1); }, [text]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const pick = (key: string) => {
    onSet([key]);                              // 하나만 — 앞서 고른 건 밀어낸다
    setText(null); setMiss(""); setOpen(false); setCursor(-1);   // null = 고른 컨셉이 입력창에 비친다
  };
  // 검색 버튼/Enter — 딱 하나면 바로 걸고, 여럿이면 드롭다운에서 고르게 둔다
  const run = (raw = typed) => {
    const query = raw.trim();
    if (!query) { setOpen(true); return; }
    const hit = resolveConcepts(query, keys);
    if (!hit.length) { setMiss(query); setOpen(false); return; }
    if (hit.length === 1) { pick(hit[0]); return; }
    setMiss(""); setOpen(true);
  };
  const onKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // ⚠ 한글 IME 조합 중의 Enter는 '글자 확정'이지 검색 신호가 아니다. 여기서 입력을
    // 비우면 확정된 글자가 뒤늦게 다시 들어와 “탄약”→“약”처럼 한 글자가 남는다.
    // 조합이 끝난 뒤(onCompositionEnd)로 미룬다 — 사용자는 Enter 한 번만 치면 된다.
    if (event.nativeEvent.isComposing) {
      if (event.key === "Enter") pendingEnter.current = true;
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setCursor((current) => {
        const next = current + (event.key === "ArrowDown" ? 1 : -1);
        return Math.max(-1, Math.min(next, list.length - 1));
      });
      return;
    }
    if (event.key === "Escape") { setOpen(false); return; }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (open && cursor >= 0 && list[cursor]) pick(list[cursor]);
    else run();
  };

  return (
    <fieldset className="concept-search">
      <legend>{t("컨셉덱")}<small className="multi-hint">{t("이름을 입력하고 검색 · 한 번에 하나만 골라집니다")}</small></legend>
      <div className="concept-box" ref={boxRef}>
        <input value={shown} aria-label={t("컨셉덱 검색")} placeholder={t("예: 어비설, 슬로우, 트루뎀, 알파모듈")}
          className={text === null && selected.length ? "has-pick" : ""}
          role="combobox" aria-expanded={open} aria-autocomplete="list"
          // 비쳐 보이는 컨셉 이름은 통째로 잡아 둔다 — 바로 타이핑하면 갈아 끼워진다
          onFocus={(event) => { setOpen(true); if (text === null && selected.length) event.currentTarget.select(); }}
          onClick={() => setOpen(true)} onKeyDown={onKey}
          onCompositionEnd={(event) => {
            if (!pendingEnter.current) return;
            pendingEnter.current = false;
            // compositionend 뒤에 input(onChange)이 한 번 더 오므로 그다음 틱에 검색한다
            const value = event.currentTarget.value;
            window.setTimeout(() => { setText(value); run(value); }, 0);
          }}
          onChange={(event) => { setText(event.target.value); setMiss(""); setOpen(true); }} />
        <button type="button" onClick={() => run()}><span className="btn-icon" aria-hidden>⌕</span>{t("검색")}</button>
        {open && list.length > 0 && (
          <ul className="concept-drop" role="listbox" aria-label={t("컨셉덱 검색")}>
            {list.map((key, index) => (
              <li key={key}>
                <button type="button" role="option" aria-selected={index === cursor}
                  className={index === cursor ? "active" : ""}
                  onMouseEnter={() => setCursor(index)} onClick={() => pick(key)}>
                  {conceptTitle(locale, key)}<span>{countFor(key)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {miss && <p className="concept-miss">{t("“{q}”에 맞는 컨셉이 없어요.", { q: miss })}</p>}
      {/* 고른 컨셉을 여기 뱃지로 또 보여주지 않는다 (사용자 요청 2026-08-01) — 어차피 하나만
          고르는 기능이라 결과 헤딩("○○ 컨셉덱")과 활성 필터 칩(× 로 해제)에 이미 나온다. */}
    </fieldset>
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
// 그 값 태그가 나온다. 필터 패널이 세로로 끝없이 늘어나던 문제 해소 (사용자 요청 2026-07-22).
// 값 목록은 아래로 밀어내지 않고 **떠 있는 드롭다운**으로 (사용자 요청 2026-08-01) —
// 태그를 흩뿌리지 않고 컨셉덱 검색(.concept-drop)과 같은 **한 줄에 하나씩 세로 리스트**다
// (사용자 요청 2026-08-01). ⚠ 하나 고르면 **바로 닫는다** (사용자 요청 2026-08-01) — 값이
// 복수 선택이긴 하지만 고른 뒤에도 목록이 화면을 덮고 있으면 결과를 볼 수 없다. 더 고를 땐
// 카테고리를 다시 누르면 되고, 이미 고른 값은 ✓로 표시돼 있어 다시 열어도 바로 보인다.
// (컨셉덱은 하나만 고르는 기능이라 고른 걸 아예 목록에서 뺀다 — 그 차이만 다르다.)
// 컨셉덱은 시그니처 기능이라 별도 유지.
type AttrGroup = { title: string; items: string[]; selected: string[]; onToggle: (value: string) => void; labelFor?: (value: string) => string; countForItem: (value: string) => number };
function AttributeFilter({ groups }: { groups: AttrGroup[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const active = groups.find((g) => g.title === open);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <fieldset className="attr-filter">
      <legend>{t("세부 조건")}<small className="multi-hint">{t("항목을 눌러 값을 고르세요 · 복수 선택 가능")}</small></legend>
      <div className="attr-cats" ref={wrapRef}>
        {groups.map((g) => (
          <button key={g.title} type="button"
            className={`attr-cat${open === g.title ? " open" : ""}${g.selected.length ? " has-sel" : ""}`}
            aria-expanded={open === g.title}
            onClick={() => setOpen((current) => (current === g.title ? null : g.title))}>
            {g.title}{g.selected.length > 0 && <em>{g.selected.length}</em>}
            <span className="attr-caret" aria-hidden>{open === g.title ? "▴" : "▾"}</span>
          </button>
        ))}
        {active && (
          <ul className="attr-drop" role="listbox" aria-multiselectable aria-label={active.title}>
            {active.items.map((item) => {
              const isSelected = active.selected.includes(item);
              return (
                <li key={item}>
                  <button type="button" role="option" aria-selected={isSelected}
                    className={isSelected ? "selected" : ""}
                    onClick={() => { active.onToggle(item); setOpen(null); }}>
                    <i aria-hidden>{isSelected ? "✓" : ""}</i>
                    {active.labelFor ? active.labelFor(item) : item}
                    <span>{active.countForItem(item)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
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

// 오퍼 상세 목차 — 모달 오른쪽 세로 레일 (사용자 요청 2026-08-01). 순서·id는 아래
// 모달 본문의 <section id="…">와 1:1로 맞춘다. 라벨은 각 섹션 h3와 같은 사전 키다.
const MODAL_SECTIONS = [
  { id: "op-potential", label: "잠재능력" },
  { id: "op-stat", label: "스탯" },
  { id: "op-skill", label: "스킬" },
  { id: "op-talent", label: "재능" },
  { id: "op-trait", label: "특성" },
  { id: "op-module", label: "모듈" },
  { id: "op-infra", label: "인프라 스킬" },
  { id: "op-skin", label: "스킨" },
  { id: "op-profile", label: "오퍼레이터 파일" },
  { id: "op-voice", label: "보이스 대사" },
];

function ModalRail({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useI18n();
  const [active, setActive] = useState(MODAL_SECTIONS[0].id);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    // 지금 읽고 있는 섹션 = 스크롤러 위쪽 28% 선을 마지막으로 지나간 섹션
    const sync = () => {
      const line = scroller.scrollTop + scroller.clientHeight * 0.28;
      let current = MODAL_SECTIONS[0].id;
      for (const section of MODAL_SECTIONS) {
        const el = document.getElementById(section.id);
        if (el && el.offsetTop <= line) current = section.id;
      }
      setActive(current);
    };
    sync();
    scroller.addEventListener("scroll", sync, { passive: true });
    // 지연 로딩(복장·프로필·보이스)이 도착하면 섹션 높이가 바뀐다
    const observer = new ResizeObserver(sync);
    observer.observe(scroller.firstElementChild ?? scroller);
    return () => { scroller.removeEventListener("scroll", sync); observer.disconnect(); };
  }, [scrollRef]);

  const go = (id: string) => {
    const scroller = scrollRef.current, el = document.getElementById(id);
    if (!scroller || !el) return;
    scroller.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: "smooth" });
  };

  return (
    <nav className="modal-rail" aria-label={t("섹션 이동")}>
      {MODAL_SECTIONS.map((section, index) => (
        <button key={section.id} type="button" className={active === section.id ? "active" : ""}
          aria-current={active === section.id ? "true" : undefined} onClick={() => go(section.id)}>
          <em>{String(index + 1).padStart(2, "0")}</em>{t(section.label)}
        </button>
      ))}
    </nav>
  );
}

function OperatorModal({ operator, onClose, onUpgrade, includeFuture }: { operator: Operator; onClose: () => void; onUpgrade?: (operatorId: string) => void; includeFuture?: boolean }) {
  const { locale, t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  // 미래 모듈은 '미래시 포함'이 켜졌을 때만 (사용자 요청 2026-08-01)
  const shownModules = operator.modules.filter((m) => includeFuture || !m.unreleased);
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
            </div>
            {/* 헤더 오른쪽 세로단 — 미실장 안내와 바로가기 버튼을 쌓는다. 제목 옆 별도 열이라
                안내 문장이 길어도 히어로 높이를 밀지 않고, 둘이 겹치지도 않는다
                (사용자 요청 2026-08-01). */}
            {(onUpgrade || operator.unreleased) && (
              <div className="modal-actions">
                {operator.unreleased && (
                  <p className="future-note">{t("미실장 오퍼레이터입니다 — 중국 서버 데이터 기준이며, 스킬·재능 등 텍스트는 비공식 AI 번역이라 정식 출시 시 공식 번역과 다를 수 있습니다.")}</p>
                )}
                {onUpgrade && (
                  <button type="button" className="modal-action" onClick={() => onUpgrade(operator.id)}>
                    <span className="btn-icon" aria-hidden>▦</span>{t("육성 비용 계산")}
                  </button>
                )}
              </div>
            )}
          </div>
        </header>
        <div className="modal-body">
        <div className="modal-scroll" ref={scrollRef}>
          <div className="modal-facts">
            <div><span>{t("공식 소속")}</span><b>{operator.factions.join(" · ")}</b></div>
            <div><span>{t("출신지")}</span><b>{operator.birthplace ?? t("불명")}</b></div>
            <div><span>{t("종족")}</span><b>{operator.race ?? t("불명")}</b></div>
            <div><span>{t("전투 태그")}</span><b>{operator.combatTags.length ? operator.combatTags.join(" · ") : t("태그 없음")}</b></div>
            <div><span>{t("컨셉")}</span><b>{operator.concepts.length ? operator.concepts.map((concept) => conceptName(locale, concept)).join(" · ") : t("분류 없음")}</b></div>
          </div>

          <section className="detail-section" id="op-potential">
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

          <section className="detail-section" id="op-stat">
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

          <SkillSection operator={operator} />

          <section className="detail-section" id="op-talent">
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
            {/* 소환물은 보통 재능 문구가 "○○를 소환할 수 있다"라고 알려 준다 — 그래서
                별도 섹션이 아니라 재능 바로 밑에 붙인다 (사용자 요청 2026-08-01). */}
            {operator.summons.length > 0 && <SummonList summons={operator.summons} />}
          </section>

          <section className="detail-section" id="op-trait">
            <span className="detail-no">TRAIT / 05</span>
            <h3>{t("특성")}</h3>
            <p>{operator.trait}</p>
          </section>

          <ModuleSection operator={operator} modules={shownModules} />

          <section className="detail-section" id="op-infra">
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

          <VoiceSection operator={operator} />
        </div>
        <ModalRail scrollRef={scrollRef} />
        </div>
      </section>
    </div>
  );
}

// ── 전투 스킬 (레벨별 수치) ──────────────────────────────────────────────────
// 설명 문장은 레벨마다 같고 숫자만 바뀌므로, 데이터는 **템플릿 + 레벨별 값**으로 온다
// (scripts/build-skill-levels.py → public/skills/<locale>/<id>.json, R2).
// 레벨 10개를 세로로 늘어놓으면 모달이 배로 길어지므로 **레벨 탭 한 줄**만 두고
// 문장 속 숫자를 그 자리에서 갈아 끼운다 — 바뀌는 값은 강조돼 있어 뭘 사는지 바로 보인다.
// operators.json의 description은 최고 레벨 문장이라, 데이터가 오기 전에도 그대로 쓴다
// (빌드 시 최고 레벨 렌더 == description을 948개 전부 대조해 맞춰 뒀다).
// rg/ri = 레벨마다 공격 범위가 달라지는 스킬(실측 4개)의 레벨별 범위. ri[level] === -1 이면
// 그 레벨에선 범위를 안 바꾼다(오퍼 기본 범위). 레벨을 안 타면 아예 없고 skill.range를 쓴다.
type SkillLevels = { tpl?: string[]; v?: string[][]; sp?: [number, number][]; d?: (number | null)[]; ti?: number[]; rg?: RangeGrid[][]; ri?: number[] };
type SkillLevelDoc = Record<string, SkillLevels>;
const skillLevelCache = new Map<string, SkillLevelDoc | null>();
// 8~10레벨은 게임 표기대로 특화 M1~M3 (특화가 없는 7레벨 스킬은 1~7만)
const skillLevelLabel = (index: number, total: number) => (total > 7 && index >= 7 ? `M${index - 6}` : String(index + 1));

// 모듈 이야기(uniEquipDesc) — 모듈을 열었을 때 붙는 짧은 산문(탐사 일지·정비 보고서·편지).
// 로케일당 656KB(EN 1.2MB)라 operators.json에 넣으면 목록 첫 로딩이 그만큼 무거워진다.
// **버튼을 눌러야 보이는 것**이라(사용자 요청 2026-08-02) 첫 화면에 있을 이유가 없어
// 프로필·보이스와 같은 관례로 오퍼당 파일 하나를 R2에서 지연 로딩한다
// (scripts/build-module-stories.py → public/modules/<locale>/<id>.json).
type ModuleStoryDoc = Record<string, string>;
const moduleStoryCache = new Map<string, ModuleStoryDoc | null>();

function ModuleSection({ operator, modules }: { operator: Operator; modules: OperatorModule[] }) {
  const { locale, t } = useI18n();
  const key = `${locale}/${operator.id}`;
  const [doc, setDoc] = useState<ModuleStoryDoc | null | undefined>(() => moduleStoryCache.get(key));
  const [open, setOpen] = useState<string | null>(null);

  // 이야기를 처음 펼칠 때만 받아온다 — 모듈만 보고 닫는 사람에겐 요청이 아예 안 나간다
  useEffect(() => {
    if (!open || moduleStoryCache.has(key)) { if (moduleStoryCache.has(key)) setDoc(moduleStoryCache.get(key)); return; }
    let alive = true;
    fetch(asset(`/modules/${locale}/${operator.id}.json`))
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data: ModuleStoryDoc | null) => {
        moduleStoryCache.set(key, data);
        if (alive) setDoc(data);
      });
    return () => { alive = false; };
  }, [open, key, locale, operator.id]);

  return (
    <section className="detail-section" id="op-module">
      <span className="detail-no">MODULE / 06</span>
      <h3>{t("모듈")}</h3>
      {modules.length ? (
        <div className="module-list">
          {modules.map((module) => {
            const shown = open === module.id;
            const story = doc?.[module.id];
            return (
              <article key={module.id} className={`module-card${module.unreleased ? " future" : ""}`}>
                <header>
                  <span>{module.type}</span>
                  <div>
                    <h4>{module.name}{module.unreleased && <em className="future-badge">{t("미실장")}</em>}</h4>
                    <small>{module.unlock}</small>
                  </div>
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
                <button type="button" className="module-story-toggle" aria-expanded={shown}
                  onClick={() => setOpen((current) => (current === module.id ? null : module.id))}>
                  <span className="btn-icon" aria-hidden>{shown ? "▴" : "▾"}</span>
                  {t("모듈 이야기")}
                </button>
                {shown && (
                  <div className="module-story">
                    {doc === undefined ? <p className="no-detail">{t("불러오는 중…")}</p>
                      : story ? story.split("\n").filter(Boolean).map((line, index) => <p key={index}>{line}</p>)
                      : <p className="no-detail">{t("등록된 모듈 이야기가 없습니다.")}</p>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="no-detail">{t("현재 적용 가능한 모듈이 없습니다.")}</p>
      )}
    </section>
  );
}

function SkillSection({ operator }: { operator: Operator }) {
  const { locale, t } = useI18n();
  const key = `${locale}/${operator.id}`;
  const [doc, setDoc] = useState<SkillLevelDoc | null | undefined>(() => skillLevelCache.get(key));

  useEffect(() => {
    if (skillLevelCache.has(key)) { setDoc(skillLevelCache.get(key)); return; }
    let alive = true;
    fetch(asset(`/skills/${locale}/${operator.id}.json`))
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data: SkillLevelDoc | null) => {
        skillLevelCache.set(key, data);
        if (alive) setDoc(data);
      });
    return () => { alive = false; };
  }, [key, locale, operator.id]);

  return (
    <section className="detail-section" id="op-skill">
      <span className="detail-no">SKILL / 03</span>
      <h3>{t("스킬")}</h3>
      {operator.skills.length ? (
        <div className="skill-list">
          {operator.skills.map((skill, index) => (
            <SkillCard key={skill.id} skill={skill} index={index} levels={doc?.[skill.id]}
              baseRange={operator.stats[operator.stats.length - 1]?.range} summons={operator.summons} />
          ))}
        </div>
      ) : (
        <p className="no-detail">{t("등록된 전투 스킬이 없습니다.")}</p>
      )}
    </section>
  );
}

/**
 * 같은 이름의 스킬을 가진 소환물 — 그 스킬의 범위는 **소환물 쪽 범위**다.
 * (클뜯에 본체/소환물을 가르는 플래그가 없어 이름으로 잇는다.)
 *
 * ⚠ 소환물 스킬의 rangeId는 **실제 발동 범위와 다를 수 있다** (사용자 지적 2026-08-01):
 *   왕 '천하겁'의 바둑돌 범위는 게임에선 반경2 마름모(13칸)인데 데이터엔 십자 9칸(x-6)뿐이고,
 *   그건 오히려 S2 쪽 모양이다. KR·CN 어디에도 마름모는 참조되지 않는다 — 돌의 발동 범위는
 *   prefabId(스킬 로직)로 계산돼 rangeId에 안 실린다.
 *   그래서 **본체 스킬이 같은 범위를 함께 갖고 있어 교차 검증되는 경우에만** 소환물 것으로
 *   본다 (메이어 '교란 장치'·위디·팬텀). 본체와 값이 다르면(왕·Mon3tr·파죰카) 데이터를
 *   믿을 수 없으므로 **본체 범위만** 낸다.
 */
function summonSkillRange(skill: Skill, summons: Summon[]): { summon: Summon; range: RangeGrid[] } | undefined {
  for (const summon of summons) {
    const hit = summon.skills.find((s) => s.name === skill.name && s.range?.length);
    if (hit) return { summon, range: hit.range as RangeGrid[] };
  }
  return undefined;
}

function SkillCard({ skill, index, levels, baseRange, summons = [] }: { skill: Skill; index: number; levels?: SkillLevels; baseRange?: RangeGrid[]; summons?: Summon[] }) {
  const { t } = useI18n();
  const count = (levels?.v ?? levels?.sp ?? levels?.d ?? levels?.ti)?.length ?? 0;
  const [picked, setPicked] = useState<number | null>(null); // null = 최고 레벨
  const at = count ? Math.min(picked ?? count - 1, count - 1) : -1;

  // 레벨을 타지 않는 값은 operators.json(최고 레벨)의 것을 그대로 쓴다
  const sp = levels?.sp?.[at];
  const duration = levels?.d ? levels.d[at] : skill.duration;
  const template = levels?.tpl?.[levels.ti ? levels.ti[at] : 0];
  const values = levels?.v?.[at] ?? [];
  // 범위가 레벨마다 달라지는 스킬은 Lv 탭을 따라간다 (ri[at] === -1 = 그 레벨엔 변화 없음).
  // 그 외엔 operators.json의 최고레벨 범위 하나 — 레벨을 안 타므로 그게 곧 전 레벨 값이다.
  const skillRange = levels?.rg && levels.ri && at >= 0
    ? (levels.ri[at] >= 0 ? levels.rg[levels.ri[at]] : undefined)
    : skill.range;
  // 손수 확인해 넣은 값이 있으면 그게 정본 — 클뜯에서 유추한 것보다 우선한다
  const pinned = skill.summonRange?.length
    ? { summon: summons.find((su) => su.id === skill.summonId), range: skill.summonRange }
    : undefined;
  const summonHit = pinned?.summon ? { summon: pinned.summon, range: pinned.range } : summonSkillRange(skill, summons);
  // 본체 스킬에 범위가 없으면 소환물 것이 유일한 후보, 있으면 **같은 칸일 때만** 교차 검증된다.
  // 값이 어긋나면(왕 '천하겁' 등) 데이터를 믿을 수 없으므로 소환물 쪽은 아예 안 낸다.
  const owned = pinned?.summon ? summonHit
    : summonHit && (!skill.range?.length || sameRange(skill.range, summonHit.range)) ? summonHit : undefined;
  // 손수 넣은 값은 본체 범위와 별개다 — 왕 '천하겁'은 본체 25칸 + 바둑돌 13칸을 둘 다 낸다
  const mergedIntoSummon = Boolean(owned && !pinned && skill.range?.length);

  return (
    <article className="skill-detail">
      <div className="skill-index">S{index + 1}</div>
      <div>
        <h4>{skill.name}</h4>
        <div className="skill-meta">
          <span>{skill.spType}</span>
          <span>{t("초기 SP {n}", { n: sp ? sp[0] : skill.initialSp })}</span>
          <span>{t("소모 SP {n}", { n: sp ? sp[1] : skill.spCost })}</span>
          {duration ? <span>{t("지속 {n}초", { n: duration })}</span> : null}
        </div>
        {count > 1 && (
          <div className="skill-levels" role="group" aria-label={t("스킬 레벨")}>
            <span className="skill-levels-label">Lv</span>
            {Array.from({ length: count }, (unused, level) => (
              <button key={level} type="button" className={level === at ? "selected" : ""}
                aria-pressed={level === at} onClick={() => setPicked(level)}>
                {skillLevelLabel(level, count)}
              </button>
            ))}
          </div>
        )}
        <p>
          {template
            ? template.split(/(\{\d+\})/).map((part, slot) => {
                const marker = /^\{(\d+)\}$/.exec(part);
                return marker
                  ? <b key={slot} className="skill-val">{values[Number(marker[1])] ?? ""}</b>
                  : <span key={slot}>{part}</span>;
              })
            : skill.description}
        </p>
        {/* 본체 범위와 소환물 범위는 **한 줄에 나란히** 둔다 (사용자 요청 2026-08-01) —
            왕 '천하겁'처럼 둘 다 있는 스킬에서 위아래로 쌓이면 카드가 길어진다.
            본체 격자는 레벨을 따르는 값(skillRange): 메이어는 특화에서 장치 범위가 넓어진다.
            소환물 것과 같은 칸이면 합쳐서 소환물 블록 하나만 낸다. */}
        {(owned || (skillRange && skillRange.length > 0)) && !(
          // 낼 격자가 하나도 없으면(전부 기본과 동일) 구분선까지 통째로 감춘다
          (!owned || sameRange(owned.range, owned.summon.range)) &&
          (mergedIntoSummon || !skillRange?.length || (baseRange ? sameRange(skillRange, baseRange) : false))
        ) && (
          <div className="skill-range-row">
            {!mergedIntoSummon && skillRange && skillRange.length > 0 && (
              <SkillRange grids={skillRange} base={baseRange} />
            )}
            {owned && (
              <SkillRange grids={mergedIntoSummon && skillRange?.length ? skillRange : owned.range}
                base={owned.summon.range} ownerName={owned.summon.name} note={skill.summonNote} />
            )}
          </div>
        )}
      </div>
    </article>
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

// 클뜯 원문에서 기본 스킨의 name·group은 게임 표기 그대로 "기본 복장"이다. 사이트 용어는
// "스킨"으로 통일했으므로(사용자 요청 2026-08-01) 데이터는 원문대로 두고 화면에서만 바꿔 부른다.
// EN/JA 원문은 이미 "Default Outfit"/"デフォルト"라 t("기본 스킨")과 같은 값 → 한국어만 바뀐다.
const isDefaultSkin = (skin: SkinEntry) => skin.default || !skin.name;

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
    <section className="detail-section" id="op-skin">
      <span className="detail-no">SKIN / 08</span>
      <h3>{t("스킨")}{skins.length > 0 && <em className="detail-count">{skins.length}</em>}</h3>
      {doc === undefined ? (
        <p className="no-detail">{t("불러오는 중…")}</p>
      ) : !skins.length ? (
        <p className="no-detail">{t("등록된 스킨이 없습니다.")}</p>
      ) : (
        <div className="skin-block">
          <div className="skin-tabs" role="tablist">
            {skins.map((skin, index) => (
              <button key={skin.id} type="button" role="tab" aria-selected={index === picked}
                className={index === picked ? "selected" : ""} onClick={() => setPicked(index)}>
                {isDefaultSkin(skin) ? t("기본 스킨") : skin.name}
                {/* 기본 스킨은 전부 이름이 같다 — 정예화 단계로 구분 (사용자 요청 2026-07-28) */}
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
                <h4>{isDefaultSkin(current) ? t("기본 스킨") : current.name}{current.stage && <em className="skin-stage">{t(current.stage)}</em>}</h4>
                <dl>
                  {current.group && <div><dt>{t("시리즈")}</dt><dd>{current.default ? t("기본 스킨") : current.group}</dd></div>}
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

// ── 헤더 치비 (베타) ─────────────────────────────────────────────────────────
// 헤더 1줄 가운데 빈 공간에서 마스코트 치비가 꼬물거리다 이따금 걸어서 자리를 옮긴다.
// 클립은 게임 원본 Spine 데이터(3.8.99)의 Relax(대기)·Move(걷기) 모션을 우리가 직접
// 투명 WebM(VP9+알파)으로 렌더한 것 — public/chibi/에 셀프호스팅 (절차: scripts/README §7.7).
// - 마스코트는 이격 스카디 고정 (사용자 확정 2026-08-03 — 로고와 같은 오퍼).
//   누르면 상세 모달. 로테이션용 매니페스트(chibi.json)는 데이터로만 유지.
// - 상태머신: 평소 Relax 루프 → 드리프트 시작하면 Move 루프 + 진행 방향 반전 →
//   transition 이 끝나면(도착) 다시 Relax. prefers-reduced-motion이면 드리프트 없이 제자리.
// - 알파 프로브: VP9 알파를 실제로 합성하는 브라우저인지 캔버스 픽셀로 1회 검사. 못 그리는
//   브라우저(사파리 계열)는 검정 상자가 되므로 아예 표시하지 않는다 (같은 출처라 오염 없음).
const CHIBI_STAR = "char_1012_skadi2"; // 이격 스카디
// Pages 직접 서빙 (R2 아님 — 합계 ~0.9MB). relax=대기 · move=걷기 · sleep=드러누워 잠 · interact=터치 반응
const CHIBI_CLIPS = {
  relax: "/chibi/skadi2-relax.webm",
  move: "/chibi/skadi2-move.webm",
  sleep: "/chibi/skadi2-sleep.webm",
  interact: "/chibi/skadi2-interact.webm",
} as const;
type ChibiClip = keyof typeof CHIBI_CLIPS;
const CHIBI_WALK_SPEED = 34; // px/s — Move 모션(1.67s 사이클) 보폭에 눈대중으로 맞춘 값
const subscribeNever = () => () => {};

function HeaderChibi({ operators }: { operators: Operator[] }) {
  const { t } = useI18n();
  // 클라이언트 전용 — 프리렌더에 넣으면 하이드레이션 불일치(실측 2026-08-03: 서버 UTC 날짜
  // 선택이 HTML에 박혀 클릭까지 오염)가 나므로 서버 스냅샷 false로 서버 렌더에서 제외한다.
  const isClient = useSyncExternalStore(subscribeNever, () => true, () => false);
  // null = 프로브 전(투명 마운트) · true = 표시 · false = 알파 미지원(제거)
  const [alpha, setAlpha] = useState<boolean | null>(null);
  const [x, setX] = useState(0);
  const [flip, setFlip] = useState(false);
  const [moveSec, setMoveSec] = useState(1);
  const [clip, setClip] = useState<ChibiClip>("relax");
  // 대화(크롬 내장 Gemini Nano) — 모델이 이미 설치된 환경에서만 켠다. 미지원이면 클릭은 반응 모션만.
  const [chatReady, setChatReady] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const chatOpenRef = useRef(false);
  const xRef = useRef(0);
  const clipRef = useRef<ChibiClip>("relax");
  const videoRefs = useRef<Partial<Record<ChibiClip, HTMLVideoElement | null>>>({});

  const star = useMemo(() => operators.find((candidate) => candidate.id === CHIBI_STAR) ?? null, [operators]);

  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  useEffect(() => {
    if (!isClient) return;
    let alive = true;
    void chibiChatAvailability().then((ok) => { if (alive && ok) setChatReady(true); });
    return () => { alive = false; };
  }, [isClient]);

  // 클립 전환 — 활성 클립만 처음부터 재생, 나머지는 정지 (숨겨둔 채 디코드하지 않게)
  useEffect(() => {
    clipRef.current = clip;
    for (const name of Object.keys(CHIBI_CLIPS) as ChibiClip[]) {
      const video = videoRefs.current[name];
      if (!video) continue;
      if (name === clip) { video.currentTime = 0; video.play().catch(() => {}); }
      else video.pause();
    }
  }, [clip]);

  // 생활 루프 — 알파 프로브 통과 후에만. 틱마다: 자고 있으면 깨고, 아니면
  // 55% 산책 / 25% 드러누워 낮잠 / 20% 그대로 대기. 반응 모션 중엔 짧게 미룬다.
  useEffect(() => {
    if (alpha !== true) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    const tick = () => {
      const current = clipRef.current;
      if (chatOpenRef.current) {
        // 대화 중엔 얌전히 — 자던 중이면 깨어난 상태로 서 있는다
        if (current === "sleep") setClip("relax");
        timer = window.setTimeout(tick, 4000);
        return;
      }
      if (current === "interact") { timer = window.setTimeout(tick, 1500); return; }
      if (current === "sleep") {
        setClip("relax"); // 기상 — 다음 틱에서 다시 행동 결정
        timer = window.setTimeout(tick, 2500 + Math.random() * 2500);
        return;
      }
      const roll = Math.random();
      if (roll < 0.25) {
        setClip("sleep"); // 다음 틱(7~13초)까지 낮잠
      } else if (roll < 0.8) {
        const next = Math.round(Math.random() * 260 - 130); // 헤더 중앙 ±130px
        if (Math.abs(next - xRef.current) > 8) {
          setFlip(next < xRef.current); // 원본 기본 방향이 오른쪽(머리 크롭 실측) — 왼쪽 이동 시 반전
          setMoveSec(Math.abs(next - xRef.current) / CHIBI_WALK_SPEED);
          xRef.current = next;
          setX(next);
          setClip("move");
        }
      }
      timer = window.setTimeout(tick, 7000 + Math.random() * 6000);
    };
    timer = window.setTimeout(tick, 2500);
    return () => window.clearTimeout(timer);
  }, [alpha]);

  if (!isClient || !star || alpha === false) return null;
  const probe = (video: HTMLVideoElement) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 8;
      const g = canvas.getContext("2d");
      if (!g) return;
      g.drawImage(video, 0, 0, 8, 8);
      // 프레임 왼쪽 위는 렌더 여백 — 알파가 살아 있으면 투명(0), 무시됐으면 불투명(255)
      setAlpha(g.getImageData(0, 0, 1, 1).data[3] < 250);
    } catch {
      setAlpha(false); // 캔버스 이상 계열 — 표시하지 않는 쪽이 안전
    }
  };
  // 클릭 = 반응 모션(Interact) 재생 + LLM 가용 환경이면 대화 패널 (사용자 확정 2026-08-03).
  // 미지원 환경은 모션만. 걷는 중 모션 전환은 무시(이동 transform과 겹치면 미끄러진다).
  const handleClick = () => {
    const current = clipRef.current;
    if (current !== "interact" && current !== "move") setClip("interact");
    if (chatReady) setChatOpen(true);
  };
  return (
    <>
    <button type="button" className={`header-chibi clip-${clip}`}
      aria-hidden={alpha !== true} tabIndex={alpha === true ? 0 : -1}
      style={{ "--cx": `${x}px`, "--walk": `${moveSec}s` } as React.CSSProperties}
      title={t("{name} 치비 쿡 찌르기", { name: star.name })}
      aria-label={t("{name} 치비 쿡 찌르기", { name: star.name })}
      onClick={handleClick}
      onTransitionEnd={(event) => { if (event.propertyName === "transform" && clipRef.current === "move") setClip("relax"); }}>
      {/* React는 muted를 프로퍼티로만 세팅해 자동재생 정책 판정과 어긋날 수 있다 — ref에서 확정 후 play().
          프로브는 loadeddata 이벤트 + ref의 readyState 검사 양쪽에서 건다: 캐시 히트면 핸들러가
          붙기 전에 로드가 끝나 이벤트를 영영 놓친다 (실측 2026-08-03, 두 번째 방문부터 재현). */}
      <video className={`chibi-relax${flip ? " flip" : ""}`} src={CHIBI_CLIPS.relax}
        autoPlay loop muted playsInline preload="metadata"
        style={alpha ? undefined : { opacity: 0 }}
        ref={(el) => { videoRefs.current.relax = el; if (el) { el.muted = true; if (clipRef.current === "relax") el.play().catch(() => {}); if (alpha === null && el.readyState >= 2) probe(el); } }}
        onLoadedData={(event) => { if (alpha === null) probe(event.currentTarget); }} />
      <video className={`chibi-move${flip ? " flip" : ""}`} src={CHIBI_CLIPS.move}
        loop muted playsInline preload="auto" ref={(el) => { videoRefs.current.move = el; }} />
      <video className={`chibi-sleep${flip ? " flip" : ""}`} src={CHIBI_CLIPS.sleep}
        loop muted playsInline preload="metadata" ref={(el) => { videoRefs.current.sleep = el; }} />
      <video className={`chibi-interact${flip ? " flip" : ""}`} src={CHIBI_CLIPS.interact}
        muted playsInline preload="metadata" ref={(el) => { videoRefs.current.interact = el; }}
        onEnded={() => setClip("relax")} />
    </button>
    {chatOpen && <ChibiChatPanel onClose={() => setChatOpen(false)} />}
    </>
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
          alt={isDefaultSkin(skin) ? alt : skin.name} onError={() => setBroken(true)} />
      )}
      <figcaption>{isDefaultSkin(skin) ? t("기본 스킨") : skin.name}{skin.artists.length > 0 && <em> · {skin.artists.join(" · ")}</em>}</figcaption>
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
        alt={isDefaultSkin(skin) ? fallbackAlt : skin.name} loading="lazy" width={180} height={360}
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
    <section className="detail-section" id="op-profile">
      <span className="detail-no">PROFILE / 09</span>
      <h3>{t("오퍼레이터 파일")}</h3>
      {doc === undefined ? (
        <p className="no-detail">{t("불러오는 중…")}</p>
      ) : !doc?.sections?.length ? (
        <p className="no-detail">{t("등록된 프로필 문서가 없습니다.")}</p>
      ) : (
        <>
          {doc.source === "cn" && (
            <p className="future-note">{t("중국 서버 선행 데이터입니다 — 비공식 AI 번역이라 정식 출시 시 공식 번역과 다를 수 있습니다.")}</p>
          )}
          <div className="profile-docs">
            {doc.sections.map((section, index) => (
              <ProfileDoc key={index} section={section} badge={unlockLabel(section.unlock)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// 문서는 전부 접었다 폈다 할 수 있다 (사용자 요청 2026-08-01). 해금이 걸린 문서
// (신뢰도·승진)만 접힌 채로 시작한다 — 스포일러이자, 안 접으면 모달이 배로 길어진다.
function ProfileDoc({ section, badge }: { section: ProfileSectionData; badge: string | null }) {
  return (
    <details className={`profile-doc${badge ? " profile-doc-locked" : ""}`} open={!badge}>
      <summary><h4>{section.title}</h4>{badge && <em>{badge}</em>}</summary>
      <ProfileBody text={section.text} />
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

// ── 보이스 대사 ──────────────────────────────────────────────────────────────
// 클뜯 charword_table — 대사 본문·제목·해금 조건 + 언어별 성우 (scripts/build-voicelines.py).
// 프로필·복장과 같은 지연 로딩: 오퍼당 파일 1개(평균 8KB)를 모달 열 때만 받는다.
// 음성 파일(mp3)은 넣지 않는다 — 텍스트만 (사용자 확정 2026-07-31).
type VoiceLine = { t: string; x: string; u: { type: string; param: string | null } | null; p?: string };
type VoiceSet = { name: string; lines: VoiceLine[] };
type VoiceDoc = { cv: { lang: string; names: string[] }[]; lines: VoiceLine[]; sets?: VoiceSet[]; source?: string };
const voiceCache = new Map<string, VoiceDoc | null>();
const VOICE_HEAD = 12; // 처음 보이는 줄 수 — 오퍼당 최대 114줄이라 접어 둔다

function VoiceSection({ operator }: { operator: Operator }) {
  const { locale, t } = useI18n();
  const key = `${locale}/${operator.id}`;
  const [doc, setDoc] = useState<VoiceDoc | null | undefined>(() => voiceCache.get(key));
  const [all, setAll] = useState(false);

  useEffect(() => {
    setAll(false);
    if (voiceCache.has(key)) { setDoc(voiceCache.get(key)); return; }
    let alive = true;
    fetch(asset(`/voice/${locale}/${operator.id}.json`))
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data: VoiceDoc | null) => {
        voiceCache.set(key, data);
        if (alive) setDoc(data);
      });
    return () => { alive = false; };
  }, [key, locale, operator.id]);

  // 해금 배지 — 프로필 문서와 같은 표기 (FAVOR=신뢰도, AWAKE=승진)
  const unlockLabel = (unlock: VoiceLine["u"]) => {
    if (!unlock) return null;
    if (unlock.type === "FAVOR") return t("신뢰도 {n}", { n: unlock.param ?? "?" });
    if (unlock.type === "AWAKE") return t("승진 {n}", { n: (unlock.param ?? "").split(";")[0] || "?" });
    return t("추가 해금");
  };

  const lines = doc?.lines ?? [];
  const shown = all ? lines : lines.slice(0, VOICE_HEAD);
  return (
    <section className="detail-section" id="op-voice">
      <span className="detail-no">VOICE / 10</span>
      <h3>{t("보이스 대사")}{lines.length > 0 && <em className="detail-count">{lines.length}</em>}</h3>
      {doc === undefined ? (
        <p className="no-detail">{t("불러오는 중…")}</p>
      ) : !lines.length ? (
        <p className="no-detail">{t("등록된 보이스 대사가 없습니다.")}</p>
      ) : (
        <>
          {doc?.source === "cn" && (
            <p className="future-note">{t("중국 서버 선행 데이터입니다 — 비공식 AI 번역이라 정식 출시 시 공식 번역과 다를 수 있습니다.")}</p>
          )}
          {(doc?.cv.length ?? 0) > 0 && (
            <p className="voice-cv">
              <span>{t("성우")}</span>
              {doc!.cv.map((entry) => (
                <em key={entry.lang}><b>{t(entry.lang)}</b> {entry.names.join(", ")}</em>
              ))}
            </p>
          )}
          <dl className="voice-lines">
            {shown.map((line, index) => {
              const badge = unlockLabel(line.u);
              return (
                <div key={index}>
                  <dt>{line.t}{badge && <em>{badge}</em>}</dt>
                  <dd>{line.x}</dd>
                </div>
              );
            })}
          </dl>
          {lines.length > VOICE_HEAD && (
            <button type="button" className="more-filter" onClick={() => setAll((current) => !current)} aria-expanded={all}>
              <span className="btn-icon" aria-hidden>{all ? "▴" : "▾"}</span>
              {all ? t("접기") : t("전체 {n}줄 보기", { n: lines.length })}
            </button>
          )}
          {/* 복장 전용 보이스 — 기본 대본과 거의 전부 다른 별개 대사라 세트째 접어 둔다 */}
          {doc?.sets?.map((set) => (
            <details key={set.name} className="voice-set">
              <summary>
                <b>{t("{name} 스킨 전용 보이스", { name: set.name })}</b>
                <em>{set.lines.length}</em>
              </summary>
              <dl className="voice-lines">
                {set.lines.map((line, index) => {
                  const badge = unlockLabel(line.u);
                  return (
                    <div key={index}>
                      <dt>{line.t}{badge && <em>{badge}</em>}</dt>
                      <dd>{line.x}</dd>
                    </div>
                  );
                })}
              </dl>
            </details>
          ))}
        </>
      )}
    </section>
  );
}

const cellKey = (grid: RangeGrid) => `${grid.row}:${grid.col}`;

/**
 * 공격 범위 격자. `base`를 주면 그와 견줘 **늘어난 칸·줄어든 칸을 갈라 칠한다** —
 * 범위를 바꾸는 스킬이 어떻게 바뀌는지 보이게 (사용자 요청 2026-08-01).
 * base 없이 쓰면 기존 그대로(스탯표의 기본 범위).
 */
// ── 소환물(토큰) ─────────────────────────────────────────────────────────────
// 재능 섹션(04) 안에 붙는다 — 재능 문구가 소환을 설명하는 경우가 대부분이라 같이 읽힌다
// (사용자 요청 2026-08-01). 스탯은 최종 단계 한 줄, 범위는 소환물 자신의 공격 범위.
// 소환물 스킬이 범위를 바꾸면 그 스킬 밑에 다시 격자를 붙인다 — 본체와 같은 규칙.
function SummonList({ summons }: { summons: Summon[] }) {
  const { t } = useI18n();
  return (
    <div className="summon-block">
      <b className="summon-block-label">{t("소환물")}<em className="detail-count">{summons.length}</em></b>
      <div className="summon-list">
        {summons.map((summon) => (
          <article key={summon.id} className="summon-card">
            <header>
              <h4>{summon.name}</h4>
              {summon.trait && <p className="summon-trait">{summon.trait}</p>}
            </header>
            <div className="summon-body">
              <dl className="summon-stats">
                <div><dt>HP</dt><dd>{summon.hp}</dd></div>
                <div><dt>{t("공격")}</dt><dd>{summon.atk}</dd></div>
                <div><dt>{t("방어")}</dt><dd>{summon.def}</dd></div>
                <div><dt>{t("마저")}</dt><dd>{summon.res}</dd></div>
                <div><dt>{t("저지")}</dt><dd>{summon.block}</dd></div>
                <div><dt>{t("공격 간격")}</dt><dd>{summon.interval}</dd></div>
                <div><dt>{t("재배치")}</dt><dd>{summon.redeploy}</dd></div>
              </dl>
              <figure className="summon-range">
                <AttackRange grids={summon.range} />
                <figcaption>{t("공격 범위")}</figcaption>
              </figure>
            </div>
            {summon.talents.length > 0 && (
              <div className="summon-sub">
                <b>{t("재능")}</b>
                {summon.talents.map((talent, i) => (
                  <p key={i}><i>{talent.name}</i>{talent.description}</p>
                ))}
              </div>
            )}
            {summon.skills.length > 0 && (
              <div className="summon-sub">
                <b>{t("스킬")}</b>
                {/* 소환물 스킬의 범위 격자는 여기 두지 않는다 — 같은 이름의 본체 스킬 카드
                    (스킬 03)에서 보여준다 (사용자 요청 2026-08-01). 스킬마다 범위가 다른
                    도로시 같은 경우 스킬을 읽는 자리에 범위가 있어야 한다. */}
                {summon.skills.map((skill) => (
                  <p key={skill.id}><i>{skill.name}</i>{skill.description}</p>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function AttackRange({ grids, base }: { grids: RangeGrid[]; base?: RangeGrid[] }) {
  if (!grids.length) return <small className="no-range">-</small>;
  // 줄어든 칸도 격자 안에 그려야 하므로 범위 계산에 base까지 넣는다
  const withOrigin = [...grids, ...(base ?? []), { row: 0, col: 0 }];
  const rows = withOrigin.map((grid) => grid.row);
  const cols = withOrigin.map((grid) => grid.col);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const active = new Set(grids.map(cellKey));
  const before = base && new Set(base.map(cellKey));
  const cells = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const key = `${row}:${col}`;
      const on = active.has(key);
      let kind = "";
      if (row === 0 && col === 0) kind = "origin";
      else if (!before) kind = on ? "active" : "";
      else if (on) kind = before.has(key) ? "active" : "added";     // 그대로 / 늘어남
      else if (before.has(key)) kind = "removed";                    // 줄어듦
      cells.push(<i key={key} className={kind} />);
    }
  }
  return <span className="attack-range" style={{ gridTemplateColumns: `repeat(${maxCol - minCol + 1},8px)` }}>{cells}</span>;
}

/** 두 범위가 같은 칸 집합인가 — 같으면 "바뀐다"고 보여줄 게 없다 */
function sameRange(a: RangeGrid[], b: RangeGrid[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a.map(cellKey));
  return b.every((grid) => set.has(cellKey(grid)));
}

/**
 * 스킬이 범위를 바꿀 때 카드에 붙는 격자 — 기본 범위와 겹쳐 늘어남/줄어듦을 보여준다.
 * 기본 범위는 **최종 정예화(스탯표 마지막 줄)** 기준이다: 범위를 바꾸는 스킬은 대부분
 * 2스킬·3스킬이라 정예화가 끝난 상태에서 쓰게 된다.
 */
function SkillRange({ grids, base, ownerName, note }: { grids: RangeGrid[]; base?: RangeGrid[]; ownerName?: string; note?: string }) {
  const { t } = useI18n();
  // ⚠ 기본 범위와 **같은 칸이면 아무것도 내지 않는다** (사용자 요청 2026-08-01) — Mon3tr
  // '책략: 초연결'처럼 rangeId만 붙어 있고 실제로는 안 바뀌는 스킬이 14건 있다. "변화 없음"
  // 격자를 띄워봐야 읽을 게 없다. 기준 범위 자체가 없을 때만 격자 하나로 보여준다.
  const before = base?.length ? base : undefined;          // 견줄 기준 (없으면 격자 하나만)
  if (before && sameRange(grids, before)) return null;
  const added = before && grids.some((g) => !before.some((b) => cellKey(b) === cellKey(g)));
  const removed = before && before.some((b) => !grids.some((g) => cellKey(g) === cellKey(b)));
  return (
    <div className="skill-range">
      <b>{ownerName ? t("소환물 {name}의 범위", { name: ownerName }) : t("스킬 사용 시 공격 범위")}</b>
      <div className="skill-range-grids">
        {before && (
          <>
            <figure>
              <AttackRange grids={before} />
              <figcaption>{ownerName ? t("{name} 기본", { name: ownerName }) : t("평소")}</figcaption>
            </figure>
            <span className="skill-range-arrow" aria-hidden>→</span>
          </>
        )}
        <figure>
          <AttackRange grids={grids} base={before} />
          <figcaption>{t("스킬 사용 중")}</figcaption>
        </figure>
      </div>
      {before && (
        <p className="skill-range-legend">
          {added && <span className="rl-added">{t("늘어난 칸")}</span>}
          {removed && <span className="rl-removed">{t("빠지는 칸")}</span>}
        </p>
      )}
      {note && <p className="skill-range-note">{t(note)}</p>}
    </div>
  );
}
