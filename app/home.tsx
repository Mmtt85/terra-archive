"use client";

// 3개 탭(백과사전·플래너·공채)의 공용 루트. 로케일별 라우트(/ /en /ja)가
// home-ko/en/ja.tsx 래퍼로 해당 언어의 operators 데이터를 정적 import해 넘긴다 —
// 런타임 언어 전환은 전체 내비게이션이라 이 컴포넌트 안에서 로케일은 불변이다.
import { lazy, startTransition, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import broadcastsData from "./data/broadcasts.json";
import storyEventsData from "./data/stories.json";
// 탭 본문은 전부 지연 로드한다 (INP 조사 2026-08-09). 종전엔 정적 import라 **어느 탭을
// 열든 모든 탭의 코드와 데이터를 받아서 파싱**했다 — /stories가 오퍼 DB 1.8MB를, /infra가
// 스토리 요약 1.8MB를 받는 식이라 페이지당 초기 JS가 6.4MB였고, 그 파싱이 하이드레이션
// 중 300~400ms짜리 롱태스크를 만들어 그 창에 들어온 클릭의 INP를 700ms까지 밀어 올렸다.
// 탭은 이미 `tab === "x" && <X/>` 조건부 렌더라 경계가 그대로 맞는다.
const InfraPlanner = lazy(() => import("./planner"));
const RecruitHelper = lazy(() => import("./recruit"));
const FarmGuide = lazy(() => import("./farm"));
const UpgradeSim = lazy(() => import("./farm").then((m) => ({ default: m.UpgradeSim })));
// 적 도감 목록 — 로케일마다 자기 데이터(~1MB)만 든 청크를 받는다 (app/enemies-{ko,en,ja}.tsx).
// 셋을 한 모듈에서 동적 선택하면 번들러가 세 JSON을 같은 청크에 묶어 3MB가 된다.
const ENEMY_DEX = {
  ko: lazy(() => import("./enemies-ko")),
  en: lazy(() => import("./enemies-en")),
  ja: lazy(() => import("./enemies-ja")),
} as const;
// 작전 도감도 같은 이유로 로케일별 청크 (데이터 ~1.25MB)
const STAGE_DEX = {
  ko: lazy(() => import("./stages-ko")),
  en: lazy(() => import("./stages-en")),
  ja: lazy(() => import("./stages-ja")),
} as const;
// 생존연산 가이드 — 로케일별 청크 (데이터 ~330KB, 2026-08-12)
const SANDBOX_GUIDE = {
  ko: lazy(() => import("./sandbox-ko")),
  en: lazy(() => import("./sandbox-en")),
  ja: lazy(() => import("./sandbox-ja")),
} as const;
// 위수 협의(오토체스) 가이드 — 로케일별 청크 (데이터 ~160KB, 2026-08-22)
const AUTOCHESS_GUIDE = {
  ko: lazy(() => import("./autochess-ko")),
  en: lazy(() => import("./autochess-en")),
  ja: lazy(() => import("./autochess-ja")),
} as const;
import { normSearch, useSearchInput } from "./search";
// 작전 시뮬레이터 런처 — SEO 본문이 프리렌더돼야 해서 정적 임포트 (데이터는 자체 지연 로드)
import SimLauncher from "./sim-launcher";
// 만능검색(⌘K)은 첫 화면에 필요 없다 — 정적 import면 omni.ts가 끌고 오는
// farm·story·rogue·recruit 색인까지 하이드레이션 경로에서 함께 파싱된다 (INP 조사 2026-08-09).
const OmniSearch = lazy(() => import("./omni-search"));
import BridgeButton from "./lens/bridge-button";
import { asset } from "./assets";
import { CONTACT_EMAIL } from "./contact";
import { descLines } from "./desc-lines";
import ChangelogButton from "./changelog";
import FutureTip from "./future-tip";
// 헤더 치비 대화 — 크롬 내장 Gemini Nano (베타, 2026-08-03)
import { ChibiChatPanel, chibiChatStatus, type ChibiActionRequest, type ChibiChatStatus } from "./chibi-chat";
// 공용 창형 모달 — 이동·리사이즈·고정·z순서 (2026-08-03)
import { ModalWindow } from "./modal-window";
import { useHashSync } from "./hash-modal";
import type { OmniTarget } from "./omni";
import { notifyHandoff, stashHandoff } from "./handoff";
import { noteAction, noteArrival, noteMiss } from "./trail";
import type { StorySummaries, OpIndex, ScriptData } from "./story";
// 오퍼레이터 기록(밀록)이 있는 오퍼 id — scripts/build-records.py 생성. 본문은
// public/records/<locale>/<id>.json 을 모달에서 지연 fetch (R2 서빙, 번들 import 금지).
import recordIdsData from "./data/record-ids.json";
import acSeasonList from "./data/autochess-seasons.json";
/** 스토리 요약(로케일별 1.8MB)은 **스토리 탭에 들어갈 때만** 받는다 (2026-08-09 INP 작업).
 *  종전엔 로케일 래퍼가 정적 import해 모든 페이지가 파싱했다. 셸에서 쓰던 곳은
 *  Portal의 죽은 stats prop 하나뿐이라 데이터 자체가 필요 없었다. */
export type SummariesLoader = () => Promise<{ default: unknown }>;
// TOPICS·slugOf는 라우팅(해시·경로 파싱)에 쓰여 셸에 남는다 — 작은 상수 테이블이라 무해하다.
import { TOPICS as ROGUE_TOPICS, slugOf as rogueSlugOf } from "./rogue-topics";
const StoryGuide = lazy(() => import("./story"));
const RogueGuide = lazy(() => import("./rogue"));
const About = lazy(() => import("./about"));
import FeedbackWidget from "./feedback-widget";
import { bindEscClose } from "./esc-close";
import { feedbackReady } from "./feedback";
import { isNewFeature, inTimeWindow, tabHasNewFeature, BUILD_NOW } from "./whats-new";
import { scrollMainTop } from "./scroll";
import { PORTAL_TILES, PORTAL_ART, type PortalTile } from "./portal-themes";
import { useLazyVisible } from "./lazy-img";
// 속성 필터는 적 도감(app/enemies.tsx)과 공유하는 부품이라 별도 모듈에 있다 (2026-08-09)
import { AttributeFilter } from "./attr-filter";
import { Dropdown } from "./dropdown";
import { SearchSuggest } from "./search-suggest";
// ⚠ 적 상세는 **lazy가 아니다.** /enemies/<id> HTML에 본문이 박히려면 인라인 렌더여야 한다
//    (app/enemy-detail.tsx 머리주석의 실측 근거 참조). 데이터는 안 딸려 온다 — props로만 받는다.
import { EnemyPage, type Enemy as EnemyEntry, type EnemyStages } from "./enemy-detail";
// 작전 상세도 **lazy가 아니다** — 같은 프리렌더 이유 (app/enemy-detail.tsx 머리주석)
import { StagePage } from "./stage-detail";
import type { StageView } from "./stage-data";
import { I18nProvider, useI18n, conceptName, makeT, DT_LOCALE, MAGIC_TRAIT_RE, LOCALES, type Locale, type ExtraI18n, type T } from "./i18n";
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

// detail = '제2재능 강화'처럼 게임 원문이 수치를 안 알려 주는 잠재의 **실제 증가폭**
// ("공격 속도 +8 → +10 · 피격 대미지 25% → 30%"). scripts/potutil.py가 재능 후보를
// 잠재 단계끼리 견줘 계산한다 (사용자 요청 2026-09-04). 수치가 이미 설명에 있는 잠재는 null.
type Potential = { rank: number; description: string; detail?: string | null };

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

export type Tab = "portal" | "archive" | "enemy" | "stage" | "sim" | "planner" | "recruit" | "farm" | "upgrade" | "story" | "rogue" | "ra" | "autochess" | "about";
// 탭 ↔ URL 세그먼트 (portal이 로케일 루트, 오퍼 백과사전은 /operators — 사용자 확정 2026-07-17:
// 루트 진입 시 오퍼 이미지 강제 로딩을 없애려 포탈 첫화면 도입). seo.ts의 TAB_SEG·라우트 폴더명과 일치.
// URL 세그먼트 "stories"(← 정적 자산 디렉터리 public/story/ 와의 경로 충돌 회피). 내부 탭명은 story.
// ⚠ 적 도감의 URL 세그먼트는 "enemies"(복수)인데 초상 자산 폴더는 public/enemy/(단수)다.
//    일부러 다르게 뒀다 — scripts/deploy.sh가 스테이징에서 `rm -rf $STAGE/enemy`로 자산만
//    떼어내는데(서빙은 R2), 이름이 같으면 라우트 HTML까지 통째로 지워진다.
const TAB_SEG: Record<Tab, string> = { portal: "", archive: "operators", enemy: "enemies", stage: "stages", sim: "sim", planner: "infra", recruit: "recruit", farm: "farm", upgrade: "upgrade", story: "stories", rogue: "rogue", ra: "ra", autochess: "autochess", about: "about" };
// ⚠ TAB_SEG와 짝 — 세그먼트를 더하면 여기도 같이 (enemies·stages가 빠져 /stages가
//   portal로 판정되던 기존 누락도 2026-08-10에 함께 채움)
const SEG_TAB: Record<string, Tab> = { "": "portal", operators: "archive", enemies: "enemy", stages: "stage", sim: "sim", infra: "planner", recruit: "recruit", farm: "farm", upgrade: "upgrade", stories: "story", rogue: "rogue", ra: "ra", autochess: "autochess", about: "about" };
const LOCALE_BASE: Record<Locale, string> = { ko: "", en: "/en", ja: "/ja" };

// 빌드(=배포) 시각 — vite define으로 박히는 ISO 문자열을 KST 분 단위로 찍는다.
// 데이터 JSON·엔진은 빌드 시점에 번들로 들어가므로(런타임 fetch는 공지·팁뿐), 화면 계산이
// 최신인지 여부는 이 시각이 답이다. 표준시를 서울로 고정해 SSR/CSR 결과가 안 갈리게 한다.
const BUILD_STAMP = (() => {
  const iso = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} KST`;
})();

// 현재 pathname → 탭 (로케일 프리픽스 제거 후 세그먼트 매핑)
function tabFromPath(pathname: string): Tab {
  let p = pathname;
  if (p === "/en" || p.startsWith("/en/")) p = p.slice(3);
  else if (p === "/ja" || p.startsWith("/ja/")) p = p.slice(3);
  // 첫 세그먼트만 본다 — 상세 라우트(/stories/<id>, /operators/<id>)도 그 탭에 속한다 (2026-08-06)
  return SEG_TAB[p.replace(/^\/+/, "").replace(/\/+$/, "").split("/")[0]] ?? "portal";
}

// ── 오퍼 상세의 정본 주소 = /operators/<id> (2026-08-06, SEO) ────────────────
// 종전에는 #op-<id> 해시 모달뿐이라 검색엔진에 없는 화면이었다. 앱 안에서 모달을 열 때도
// 이 주소로 replaceState한다 — 공유·새로고침이 곧 정본이 되고, 히스토리 엔트리를 쌓지
// 않으므로 인앱 브라우저 리로드 버그(2026-07-18)와도 무관하다.
// ── 기간 한정 헤더 바로가기 (사용자 요청 2026-08-22) ─────────────────────────
// 게임에서 그 모드가 도는 동안에만 헤더에 바로가기 칩을 띄운다. 기간은 클뜯
// basicInfo(act2autochess)의 startTime·endTime 그대로 —
//   2026-08-20 16:00 KST 시작 / 2026-10-01 03:59:59 KST 종료.
// ⚠ 판정 시계는 whats-new의 **빌드 시각**이다 (Date.now()를 렌더에 쓰면 프리렌더 HTML과
//   어긋나 React #418 → 전 페이지 다크모드까지 날아간 전례. whats-new.ts 주석 참조).
//   무인 파이프라인이 거의 매일 배포하므로 실제 노출 종료는 게임 종료 다음 배포다.
const PROMO = {
  tab: "autochess" as Tab,
  label: "위수 협의",
  icon: "♟",
  from: "2026-08-20T16:00:00+09:00",
  to: "2026-10-01T04:00:00+09:00",
};
const PROMO_ON = inTimeWindow(PROMO.from, PROMO.to);
const PROMO_END = Date.parse(PROMO.to);
/** 기간 한정 바로가기의 남은 시간 문구 (사용자 요청 2026-08-24) —
 *  하루 이상이면 며칠, 하루 미만이면 몇 시간, 한 시간 미만이면 몇 분.
 *  ⚠ 시계는 첫 렌더에서 **빌드 시각**(BUILD_NOW)이다 — 렌더 중 Date.now()를 쓰면 서버·클라
 *  답이 갈려 하이드레이션이 깨진다(React #418, whats-new.ts 주석). 마운트 후 진짜 시각으로
 *  갈아 끼운다. */
function promoLeftLabel(nowMs: number, t: T): string | null {
  const ms = PROMO_END - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  if (d >= 1) return t("{n}일 남음", { n: d });
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return t("{n}시간 남음", { n: h });
  return t("{n}분 남음", { n: Math.max(1, Math.floor(ms / 60000)) });
}

/** 진행중 이벤트 배너를 눌렀을 때, 그 이벤트 전용 가이드가 사이트에 있으면 그쪽으로 보낸다.
 *  키는 클뜯 basicInfo의 이벤트 type (broadcast 워커가 그대로 실어 준다). */
const EVENT_GUIDE_TAB: Record<string, Tab> = { AUTOCHESS_SEASON: "autochess" };

// 위수 협의 시즌 — 메뉴 부메뉴와 /autochess/<slug> 라우팅에 쓴다 (2026-09-05).
// 목록은 build-autochess.py 산출물이라 **여기에 숫자를 안 적는다** — 새 시즌이 오면 늘어난다.
// (SEO 쪽 같은 판정은 app/seo-autochess.ts. 그쪽은 서버 전용이라 여기서 임포트하지 않는다)
const AC_SEASONS = (acSeasonList as { n: number }[]).map((x) => x.n).sort((a, b) => a - b);
const AC_LATEST = AC_SEASONS[AC_SEASONS.length - 1] ?? 1;
const autochessSeasonOf = (slug?: string) => {
  const n = Number(String(slug ?? "").replace(/^s/, ""));
  return AC_SEASONS.includes(n) ? n : AC_LATEST;
};

const OPERATOR_PATH_RE = /^\/(?:en\/|ja\/)?operators\/([^/]+)\/?$/;
const operatorPath = (locale: Locale, id: string) => `${LOCALE_BASE[locale]}/operators/${id}`;
const archivePath = (locale: Locale) => `${LOCALE_BASE[locale]}/operators`;
// ⚠ 미실장(중섭 선행) 오퍼는 **상세 라우트가 없다** — seo-operator.ts가 일부러 안 만든다
//    (비공식 AI 번역이 색인됐다가 정식 출시 때 통째로 갈리는 게 검색 품질에 더 나쁘다).
//    그래서 그 주소로 replaceState하면 새로고침·공유가 404다 (사용자 제보 2026-09-04).
//    미실장만 목록 경로 + #op- 딥링크로 둔다 — 새로고침해도 모달이 그대로 열린다.
//    ⚠ ?future=1은 붙이지 않는다 (사용자 지시 2026-09-04) — 2026-09-04부터 미실장은 토글과
//      무관하게 목록에 있으므로 주소에 실을 이유가 없고, 주소창이 지저분해진다.
const operatorHref = (locale: Locale, op: { id: string; unreleased?: boolean }) =>
  op.unreleased ? `${archivePath(locale)}#op-${op.id}` : operatorPath(locale, op.id);
const operatorIdFromPath = (pathname: string) => {
  const m = OPERATOR_PATH_RE.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
};
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
  [/AUTOCHESS/, "♟"],      // 위수 협의(오토체스) — 2026-08-20 시즌2 개방 때 추가
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
// ⚠ 재개방(복각)은 **activity id 가 원본과 다르다** — act41side 의 복각이 act41sre 다.
//   그래서 id 로만 찾으면 stories.json 을 못 만나고, 이름·썸네일이 KR activity_table 원문
//   (= 한국어)으로 떨어진다 (사용자 제보 2026-09-04: "EN·JA 홈에서 이벤트 이름이 한글").
//   id → 실패하면 **"(재개방)"을 뗀 한국어 이름**으로 잇는다. 실측 35건 중 34건이 붙는다
//   (act1r6sre '오리지늄 더스트'만 stories.json 에 항목 자체가 없어 원문 그대로 나간다).
//   ⚠ `act(\d+)sre → act$1side` 로 잇지 말 것 — act5sre·act9sre 처럼 옛 이벤트는 원본 id 가
//     act5d0·act9d0 이라 8건이 통째로 빗나간다 (실측).
const RERUN_SUFFIX = /\s*\(재개방\)\s*$/;
const storyEventByKoName = new Map(storyEventsList.map((event) => [event.name.ko, event]));
const storyOf = (event: GameEvent): StoryEventLite | undefined =>
  storyEventById.get(event.id) ?? storyEventByKoName.get(event.name.replace(RERUN_SUFFIX, ""));
function eventName(locale: Locale, event: GameEvent): string {
  const story = storyOf(event);
  if (!story) return event.name;
  const base = (locale === "ko" ? story.name.ko : story.name[locale]) ?? story.name.ko;
  // 복각 표시는 살린다 — 원본과 이름이 같아 구분이 안 되면 "이미 본 이벤트"인지 알 수 없다
  return RERUN_SUFFIX.test(event.name) ? `${base} (${makeT(locale)("재개방")})` : base;
}
function eventThumb(locale: Locale, event: GameEvent): string | undefined {
  const story = storyOf(event);
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
  // 시작까지 남은 날짜는 **KST 달력 날짜 차이**로 센다. 시분 차를 올림하면 오늘 16시
  // 시작인 이벤트가 'D-1'(=내일)로 나온다 (2026-08-13 '교차지점'에서 확인).
  const kstDay = (ms: number): number => Math.floor((ms + 9 * 3_600_000) / DAY);
  const startDday = (event: GameEvent): number => Math.max(0, kstDay(Date.parse(event.start)) - kstDay(now));
  const startLabel = (event: GameEvent): string => {
    const d = startDday(event);
    return d === 0 ? t("오늘 시작") : t("시작 D-{n}", { n: d });
  };
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
          · {headlineUpcoming ? startLabel(headline) : `D-${dday(headline)}`}
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
                    <small>{md(event.start)} ~ {md(event.end)} · {startLabel(event)}</small>
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
              2026-09-04 규칙 변경: 미래시를 꺼도 숨기지 않고 흑백(.fut-dim)으로 보여준다. */}
          {futureEvents.length > 0 && <>
            <h3 className="event-menu-upcoming">{t("향후 다가올 이벤트")}</h3>
            <ul>
              {futureEvents.map((event) => {
                const name = (locale === "ko" ? event.name.ko : event.name[locale]) ?? event.name.ko;
                return (
                  <li key={event.id} className="fut-dim">
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
        <ModalWindow label={t("명일방주 공식 방송")} className="bcast-modal" onClose={() => setOpen(false)}>
            {/* 제목은 창 크롬 바(label)가 담당 — 종전 내부 header는 제목이 이중으로 떠서 제거 (2026-08-03) */}
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
        </ModalWindow>,
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

function Portal({ onOpenTab }: {
  onOpenTab: (tab: Tab) => void;
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
      // 단, **그 이벤트 전용 가이드가 사이트에 있으면 우리 화면으로** (사용자 지시 2026-08-22
      // "위수협의 누르면 위수협의 메뉴로 넘어가야돼"). 위수 협의는 공식 공지 URL도 없어서
      // 종전에는 카페 이벤트 게시판으로 튕겼다.
      const guide = headline ? EVENT_GUIDE_TAB[headline.type ?? ""] : undefined;
      if (guide) { onOpenTab(guide); scrollMainTop(); return; }
      if (headline?.url) { window.open(headline.url, "_blank", "noopener"); return; }
      // 공지를 못 찾았을 때: **스토리가 있는 이벤트만** 스토리 탭으로 보낸다. 벡터 돌파처럼
      // 스토리가 없는 이벤트를 스토리로 보내면 엉뚱한 곳에 떨어진다 (사용자 지적 2026-07-31
      // "왜 스토리로 연결이 돼?") — 그런 이벤트는 공식 카페 이벤트 게시판으로.
      // storyOf — 재개방은 id 가 원본과 달라(act41sre) id 로만 보면 "스토리 없음"이 된다
      if (headline && !storyOf(headline)) {
        window.open(CAFE_EVENT_BOARD, "_blank", "noopener"); return;
      }
      onOpenTab("story"); scrollMainTop(); return;
    }
    // ⚠ `location.hash = …` 대입은 vinext의 RSC 내비게이션을 태운다. 로컬 서버에선 1회로
    // 끝나지만 Pages(정적 배포)에선 그 페이로드를 못 받아 무한 재시도에 빠지고, 거기서 쏟아지는
    // popstate가 useHashSync를 계속 깨워 닫은 모달이 즉시 다시 열린다 (사용자 제보 2026-08-13
    // "닫기 버튼을 눌러도 다시 새로 뜬다" — 라이브 실측 클릭 1회에 RSC 내비 75회·popstate 45회/2초).
    // 네이티브 pushState로 해시만 바꾸고 합성 hashchange로 깨운다 (hash-modal.ts와 같은 규약).
    if (tile.action === "changelog") {
      History.prototype.pushState.call(history, null, "", "#changelog-all");
      window.dispatchEvent(new Event("hashchange"));
      return;
    }
    if (tile.action === "donate") { window.open("https://buymeacoffee.com/terra_archive", "_blank", "noopener"); return; }
    if (tile.href) { window.open(tile.href, "_blank", "noopener"); return; }
    if (tile.tab) { onOpenTab(tile.tab as Tab); scrollMainTop(); }
  };

  // 서버 렌더엔 시각이 없어 0을 찍었다가 마운트 후 실제 값으로 바뀌었는데, 자릿수가
  // 늘면서 옆 'DAY' 글자를 밀어 레이아웃이 흔들렸다 (CLS, 2026-08-22). 첫 값은 빌드 시각으로
  // 내면 서버·클라가 같은 답을 내고, 배포 당일엔 마운트 후 값과도 같아 흔들림이 없다.
  const days = Math.max(1, Math.floor(((now ?? BUILD_NOW) - SITE_OPENED) / DAY) + 1);

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

      {/* 우측 타일 — 배치는 CSS grid-template-areas(=tile.area)가 잡는다.
          도감·시뮬레이터는 헤더 메뉴와 같은 묶음 상자로 (사용자 지시 2026-08-10). */}
      <div className="pt-tiles">
        {(() => {
        const renderTile = (tile: PortalTile) => {
          // 배너는 tab/action이 없어도 이벤트 공지를 여는 칸이다 — 장식 판정에서 제외
          const dead = tile.kind !== "banner" && !tile.tab && !tile.action && !tile.href;
          const isBanner = tile.kind === "banner";
          const thumb = isBanner && headline ? eventThumb(locale, headline) : undefined;
          return (
            <button key={tile.id} type="button" disabled={dead}
              className={`pt-tile pt-${tile.kind} pt-t-${tile.id}${dead ? " dead" : ""}${isBanner && !thumb ? " nothumb" : ""}`}
              style={tile.group ? undefined : { gridArea: tile.area }}
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
                    {/* 포탈 타일의 새 기능 표시 — 탭 배지는 헤더 메뉴와 같은 판정을 쓴다.
                        (업데이트 내역 타일에 붙던 dev-notes 배지는 2026-09-05 기능 제거로 삭제) */}
                    {!!tile.tab && tabHasNewFeature(tile.tab) && (
                      <span className="new-badge">{t("새기능")}</span>
                    )}
                  </span>
                  {tile.desc && <span className="pt-desc">{t(tile.desc)}</span>}
                </>
              )}
            </button>
          );
        };
        const groups: { id: "dex" | "sim" | "guide"; name: string }[] = [
          { id: "guide", name: t("가이드") },
          { id: "dex", name: t("도감") },
          { id: "sim", name: t("시뮬레이터") },
        ];
        return (
          <>
            {PORTAL_TILES.filter((tile) => !tile.group).map(renderTile)}
            {groups.map((g) => (
              <div key={g.id} className={`pt-group pt-g-${g.id}`} style={{ gridArea: g.id }}
                role="group" aria-label={g.name}>
                <span className="pt-group-cap">{g.name}</span>
                <div className="pt-group-tiles">
                  {PORTAL_TILES.filter((tile) => tile.group === g.id).map(renderTile)}
                </div>
              </div>
            ))}
          </>
        );
        })()}
      </div>

    </section>
  );
}

export default function Home({ locale, operators, extra, summariesLoader, initialTab = "portal", initialStory, initialOperator, initialRogue, initialSandbox, initialAutochess, initialEnemy, pageEnemy, pageEnemyStages, pageStage }: { locale: Locale; operators: Operator[]; extra: ExtraI18n | null; summariesLoader: SummariesLoader; initialTab?: Tab; initialStory?: string; initialOperator?: string; initialRogue?: string; initialSandbox?: string; initialAutochess?: string; initialEnemy?: string; pageEnemy?: EnemyEntry | null; pageEnemyStages?: EnemyStages | null; pageStage?: StageView | null }) {
  return (
    <I18nProvider locale={locale}>
      <HomeInner operators={operators} extra={extra} summariesLoader={summariesLoader} initialTab={initialTab} initialStory={initialStory} initialOperator={initialOperator} initialRogue={initialRogue} initialSandbox={initialSandbox} initialAutochess={initialAutochess} initialEnemy={initialEnemy} pageEnemy={pageEnemy} pageEnemyStages={pageEnemyStages} pageStage={pageStage} />
    </I18nProvider>
  );
}

// '미래시 포함' 토글 localStorage 키 — 켜면 한국 서버 미실장(CN 선행) 오퍼도 목록에 표시
const FUTURE_KEY = "ta-include-future";

function HomeInner({ operators, extra, summariesLoader, initialTab, initialStory, initialOperator, initialRogue, initialSandbox, initialAutochess, initialEnemy, pageEnemy, pageEnemyStages, pageStage }: { operators: Operator[]; extra: ExtraI18n | null; summariesLoader: SummariesLoader; initialTab: Tab; initialStory?: string; initialOperator?: string; initialRogue?: string; initialSandbox?: string; initialAutochess?: string; initialEnemy?: string; pageEnemy?: EnemyEntry | null; pageEnemyStages?: EnemyStages | null; pageStage?: StageView | null }) {
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
  // 미실장 항목의 **흑백 처리**는 <html data-fut> 하나로 건다 (사용자 지시 2026-09-04:
  // "미래시 꺼도 보여주되 살짝 흑백처리"). 화면마다 토글 값을 실어 나르지 않아도 되고,
  // 모달·포털(createPortal)처럼 트리 밖으로 나가는 곳까지 한 번에 걸린다.
  // ⚠ 렌더가 아니라 이펙트로 documentElement 에 쓴다 — 마크업에 넣으면 프리렌더 HTML과
  //   갈라져 하이드레이션이 깨진다. 기본값(OFF)이 프리렌더 상태와 같아 첫 화면도 맞다.
  useEffect(() => { document.documentElement.dataset.fut = includeFuture ? "1" : "0"; }, [includeFuture]);
  const toggleFuture = (on: boolean) => {
    setIncludeFuture(on);
    try { localStorage.setItem(FUTURE_KEY, on ? "1" : "0"); } catch { /* ignore */ }
    // 공유용 URL 파라미터도 갱신 (다른 파라미터는 보존)
    const url = new URL(window.location.href);
    if (on) url.searchParams.set("future", "1"); else url.searchParams.delete("future");
    window.history.replaceState(null, "", url);
  };
  // 백과사전 목록·필터·카운트가 쓰는 로스터 — **미래시와 무관하게 전원**이다
  // (2026-09-04 규칙 변경: 미실장도 숨기지 않고 흑백으로 보여준다).
  // 여기 쓰이는 곳은 전부 표시용(목록·필터 선택지·개수·검색)이라 계산에 영향이 없다.
  const roster = operators;
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
  const opPinnedRef = useRef(false); // 오퍼 창 📌 고정 여부 — 해시 청소가 고정 창을 닫지 않게
  // 경로 기반 라우팅: 서버가 라우트별로 올바른 탭을 렌더하므로 initialTab을 그대로
  // 초기값으로 쓴다 (SSR/클라이언트 첫 렌더 일치 → hydration mismatch 없음).
  const [tab, setTab] = useState<Tab>(initialTab);
  // 기간 한정 바로가기의 남은 시간 시계 — 첫 값은 빌드 시각(서버·클라 일치), 마운트 뒤
  // 실제 시각으로 갈아 끼우고 1분마다 갱신한다. PROMO가 안 뜨는 동안은 타이머도 안 돈다.
  const [promoNow, setPromoNow] = useState(BUILD_NOW);
  useEffect(() => {
    if (!PROMO_ON) return;
    // 첫 보정도 타이머로 미룬다 — 이펙트 안에서 곧바로 setState하면 렌더가 한 번 더 돈다
    const tick = () => setPromoNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);
  const [navOpen, setNavOpen] = useState(false); // 모바일 탭 메뉴(햄버거) 열림 상태
  // 메뉴 안 묶음(도감·시뮬레이터) 펼침 — 데스크탑은 호버로도 열리지만, iOS는 탭해도 버튼에
  // 포커스가 안 가 focus-within이 무력하므로 클릭 토글 상태가 따로 필요하다 (2026-08-09).
  // 초기화는 effect가 아니라 햄버거 토글 클릭에서 한다 (set-state-in-effect 린트 관례).
  const [openGroup, setOpenGroup] = useState<"" | "dex" | "sim" | "guide">("");
  // ── 플라이아웃 닫힘 지연 (사용자 요청 2026-09-05 "마우스 오버했던거 밖으로 삐져나가도
  //    안사라지게 해 줘") ────────────────────────────────────────────────────────
  // CSS `:hover` 만으로는 커서가 경계를 1px만 벗어나도 그 순간 닫힌다. 가이드 안에 2단
  // 부메뉴가 생기면서 대각선으로 옮겨 가는 동안 자꾸 닫혔다. 들어올 때는 즉시 열고,
  // 나갈 때만 잠깐 붙잡는다 — 열려 있는 동안 `.open` 을 얹으므로 CSS 는 그대로 둔다.
  // id 는 `guide` / `guide/rogue` 처럼 경로로 둔다 (자식이 열려 있으면 부모도 열린 채).
  // 1초 — 420ms는 "너무 빨리 사라진다", 2초는 너무 길어 사용자가 1초로 확정했다 (2026-09-05).
  // 대각선으로 옮겨 가다 잠깐 벗어나는 정도로는 안 닫힌다. 이동·Esc·바깥 클릭은
  // holdFlyout("")로 **즉시** 닫으므로 이 지연에 갇히지 않는다.
  const HOVER_HOLD_MS = 1000;
  const [hoverFlyout, setHoverFlyout] = useState("");
  const hoverTimer = useRef<number | null>(null);
  const holdFlyout = (id: string) => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setHoverFlyout(id);
  };
  /** 빠져나갔다 — `back` 은 되돌아갈 자리(2단에서 나오면 부모 메뉴는 열린 채 둔다).
   *  바깥으로 완전히 나가면 부모의 onMouseLeave 가 이어서 ""로 다시 예약한다. */
  const releaseFlyout = (back = "") => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setHoverFlyout(back);
    }, HOVER_HOLD_MS);
  };
  const flyoutOpen = (id: string) => hoverFlyout === id || hoverFlyout.startsWith(`${id}/`);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const [feedbackOpen, setFeedbackOpen] = useState(false); // 제안 패널 — 모바일 헤더 버튼·데스크탑 FAB 공용
  // 제안 게시판 뱃지 숫자 — 위젯이 올려주고 헤더 버튼 뱃지에 쓴다. 방문자는 '새 답변',
  // 관리자 모드는 '새 제안'이라 무엇의 개수인지도 같이 받는다 (2026-09-06).
  const [feedbackNew, setFeedbackNew] = useState(0);
  const [feedbackNewAdmin, setFeedbackNewAdmin] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(true); // 모바일 헤더 접기 — 접힘이 기본(사용자 확정 2026-07-22). PC는 무관(관련 CSS가 모바일 블록에만 있음)
  // 헤더 완전히 치우기 — 핸들을 **위로 끌어올리면** 헤더가 통째로 사라지고 핸들만 남는다
  // (사용자 요청 2026-08-25: 폰 가로모드에서 리더기를 볼 때 헤더가 화면을 너무 먹는다).
  // 모바일 전용(CSS가 모바일 블록에만 있다). 다시 끌어내리거나 누르면 접힘 상태로 돌아온다.
  const [headerTucked, setHeaderTucked] = useState(false);
  const handleFrom = useRef<number | null>(null);
  const handleDragged = useRef(false);
  // 끄는 **동안** 헤더가 손가락을 따라오게 한다 (사용자 정정 2026-08-25: "클릭하면
  // 애니메이션이 아니라 붙잡고 끄는 와중에 애니메이션이 필요하다"). 종전엔 pointerup 에서
  // 한 번에 스냅만 해서, 끄는 내내 아무 반응이 없었다.
  // 잡은 순간의 헤더 높이를 재 두고 max-height 를 그 값 ± 이동량으로 실시간 갱신한다
  // (tuck 이 max-height 기반이라 같은 축을 쓴다 — transform 을 쓰면 본문과 겹친다).
  const headerRef = useRef<HTMLElement>(null);
  const headerH = useRef(0);
  // 끄는 동안의 높이와 **내용 불투명도**를 같이 든다. 헤더는 안쪽 드롭다운이 absolute 라
  // overflow 로 자를 수 없어서(위 CSS 주석 참조), 높이만 줄이면 버튼이 상자 밖으로 삐져나온
  // 채 남는다 (사용자 제보 2026-08-25). 그래서 진행률만큼 내용을 같이 흐린다.
  const [drag, setDrag] = useState<{ h: number } | null>(null);
  // 모바일 푸터 접기 — **접힘이 기본**(사용자 요청 2026-08-25: 폰에서 푸터가 너무 커서
  // 본문을 가린다). 헤더 핸들과 같은 규약: 눌러서 여닫고, 끌면 손가락을 따라온다.
  // PC 는 무관 — 관련 CSS 가 모바일 블록에만 있다.
  const [footerFolded, setFooterFolded] = useState(true);
  const footerRef = useRef<HTMLElement>(null);
  const footerFrom = useRef<number | null>(null);
  const footerDragged = useRef(false);
  const footerH = useRef(0);
  const [footDragH, setFootDragH] = useState<number | null>(null);
  // 햄버거 '통합전략 가이드' 부메뉴 활성 표시용 — 현재 URL의 ?topic= 슬러그 (기본 is1)
  // 열려 있는 스토리 상세의 이름 — 문서 제목에 반영 (StoryGuide가 알려준다)
  const [storyTitle, setStoryTitle] = useState<string | null>(null);
  // 오퍼 상세 **페이지**(/operators/<id>로 직접 진입). 모달(selected)과 별개다 —
  // 모달은 body 포털이라 프리렌더가 안 되고, 목록 위에 겹치므로 색인용으로 못 쓴다.
  const [pageOperator, setPageOperator] = useState<Operator | null>(
    () => (initialOperator ? operators.find((o) => o.id === initialOperator) ?? null : null));
  // 적 상세 **페이지**(/enemies/<id>). 오퍼와 달리 목록 데이터가 이 모듈에 없으므로,
  // 서버 라우트가 그 적 하나(+등장 작전 발췌)만 골라 props로 내려준다.
  const [enemyPageOpen, setEnemyPageOpen] = useState<boolean>(() => !!pageEnemy);
  const EnemyDexForLocale = ENEMY_DEX[locale as keyof typeof ENEMY_DEX] ?? ENEMY_DEX.ko;
  const SandboxForLocale = SANDBOX_GUIDE[locale as keyof typeof SANDBOX_GUIDE] ?? SANDBOX_GUIDE.ko;
  const AutochessForLocale = AUTOCHESS_GUIDE[locale as keyof typeof AUTOCHESS_GUIDE] ?? AUTOCHESS_GUIDE.ko;
  const [stagePageOpen, setStagePageOpen] = useState<boolean>(() => !!pageStage);
  const StageDexForLocale = STAGE_DEX[locale as keyof typeof STAGE_DEX] ?? STAGE_DEX.ko;
  // 작전 도감 → 적 도감: 적 칩을 누르면 적 상세로 넘어간다 (두 도감이 서로를 가리킨다)
  const openEnemyFromStage = (id: string) => {
    history.pushState(null, "", `${tabPath("enemy")}#en-${id}`);
    startTransition(() => { setTab("enemy"); setStagePageOpen(false); });
  };
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
  // 세부 직군은 직군의 하위 개념 — 직군을 안 고르면 8개 직군의 세부 직군이 한 목록에
  // 통째로 쏟아진다 (사용자 요청 2026-08-06). 종전엔 **별도 칸을 잠가** 그걸 막았는데,
  // 2026-08-16부터는 직군 목록 안에서 그 직군의 것만 펼치는 계층 목록이 대신한다 —
  // 잠금·"직군 먼저" 안내가 없어도 섞일 일이 없다.
  // 계층 목록은 **고른 직군이 아니라 마우스가 지나가는 직군**의 것을 보여줘야 하므로
  // 로스터 전체를 직군별로 한 번만 갈라 둔다.
  const subsByJob = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const operator of roster) {
      const list = map.get(operator.job);
      if (!list) map.set(operator.job, [operator.subProfession]);
      else if (!list.includes(operator.subProfession)) list.push(operator.subProfession);
    }
    for (const list of map.values()) list.sort((a, b) => a.localeCompare(b, locale));
    return map;
  }, [roster, locale]);
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
      // 오퍼 상세 페이지 주소면 페이지 뷰로 (모달은 닫는다) — 뒤로/앞으로 대응
      const pathOp = operatorIdFromPath(window.location.pathname);
      const pageOp = pathOp ? operators.find((candidate) => candidate.id === pathOp) ?? null : null;
      setPageOperator(pageOp);
      if (pageOp) { if (!opPinnedRef.current) setSelected(null); return; }
      if (hash.startsWith("#op-")) {
        const operator = operators.find((candidate) => candidate.id === hash.slice(4));
        if (operator) setSelected(operator);
        return;
      }
      // op 해시가 아니면 열려 있던 모달을 닫는다 (URL 직접 편집·딥링크 이탈).
      // 단 창이 📌 고정돼 있으면 내비게이션이 닫아버리지 않는다 (창형 모달 2026-08-03)
      if (!opPinnedRef.current) setSelected(null);
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
  // 도착(스토리 상세·통합전략 상세)을 한 곳에서 잡아, 앞서 아무것도 못 찾았던
  // 검색어들에 "결국 여기로 갔다"를 이어 붙인다.
  // ⚠ **오퍼 상세는 여기서 안 잡는다** — 아래 별도 이펙트에서 상태로 잡는다.
  //   상세 주소가 정본 경로(/operators/<id>)로 바뀐 뒤(2026-08-06)로 해시 감시로는
  //   카드 클릭도, 플래너 등에서 띄운 모달(URL 무변화)도 하나도 못 잡았다.
  useEffect(() => {
    const seen = { url: "" };
    const check = () => {
      const hash = decodeURIComponent(window.location.hash);
      const url = window.location.pathname + hash;
      if (url === seen.url) return;
      seen.url = url;
      // 스토리 상세 — 정본 경로 /stories/<id> (2026-08-06) 또는 옛 해시 #story-<id>.
      // ⚠ 정규식을 story.tsx(STORY_PATH_RE)에서 가져오지 않고 여기 둔 건, 값 import가
      //   스토리 청크를 첫 화면 번들로 끌고 오기 때문이다 (home.tsx는 타입만 가져온다).
      const onStory = /^\/(?:en\/|ja\/)?stories\/([^/]+)\/?$/.exec(window.location.pathname);
      const storyId = onStory ? decodeURIComponent(onStory[1])
        : hash.startsWith("#story-") ? hash.slice(7).split("/")[0] : null;
      if (storyId) {
        noteArrival(`story:${storyId}`, { kind: "story", name: storyId, locale });
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
  }, [locale]);

  // 오퍼 상세 도착 — 모달이든 상세 페이지든 **화면에 떠 있는 오퍼**를 그대로 신호로 쓴다.
  // 주소를 보고 판단하지 않는 이유: 카드 클릭은 경로(/operators/<id>)로, 유니버셜 서치는
  // 해시(#op-<id>)로, 플래너·치비에서 띄운 모달은 주소를 아예 안 바꾸는 등 길이 제각각이라
  // 한 가지만 감시하면 반드시 새는 길이 생긴다 (사용자 제보 2026-08-24).
  const arrivedOp = selected ?? pageOperator;
  useEffect(() => {
    if (!arrivedOp) return;
    noteArrival(`op:${arrivedOp.id}`, { kind: "op", name: arrivedOp.name, locale });
  }, [arrivedOp, locale]);

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

  // 헤더를 접고 펼치면 본문 스크롤러(.site-scroll)의 높이가 그만큼 바뀐다. iOS 사파리는
  // `body{overflow:hidden}` + 안쪽 `overflow-y:auto` 조합에서 **스크롤 중에 그 높이가
  // 바뀌면** 스크롤 영역을 다시 잡지 못하고 위로 못 올라가는 일이 있다 (사용자 제보
  // 2026-09-05: "헤더 열린상태에서 이 페이지 들어와서 헤더 접고나면 위로 못올림").
  // ⚠ 이건 **재현하지 못한 채 넣은 완화책**이다 — Chromium·WebKit(headless) 둘 다에서
  //   같은 순서를 밟아도 정상이라(실측) 실기기 사파리 고유 동작으로 보인다. 1px 흔들어
  //   레이아웃을 다시 잡게 하는 고전적 처방이고, 눈에 보이는 변화도 부작용도 없다.
  //   그래도 안 되면 이 자리가 아니라 스크롤 구조(main 100dvh) 쪽을 봐야 한다.
  useEffect(() => {
    const kick = () => {
      const sc = document.querySelector<HTMLElement>(".site-scroll");
      if (!sc) return;
      const at = sc.scrollTop;
      sc.scrollTop = at + 1;
      sc.scrollTop = at;
    };
    const raf = requestAnimationFrame(kick);
    const later = window.setTimeout(kick, 320);   // CSS 전환이 끝난 뒤 한 번 더
    return () => { cancelAnimationFrame(raf); clearTimeout(later); };
  }, [headerCollapsed, headerTucked]);

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
    // 상세 **페이지**(pageOperator)도 같은 제목 — 라우트가 내보낸 <title>과 문구를 맞춰야
    // 하이드레이션 직후 목록 제목으로 뭉개지지 않는다 (app/seo-operator.ts TITLE과 같은 키)
    const op = selected ?? pageOperator;
    document.title = op
      ? t("{name} - 명일방주 오퍼레이터 | 테라 아카이브", { name: op.name })
      : tab === "planner"
        ? t("인프라 자동편성기 - 명일방주 기반시설 편성 | 테라 아카이브")
        : tab === "recruit"
          ? t("공개채용 도우미 - 명일방주 공개모집 계산기 | 테라 아카이브")
          : tab === "enemy"
            ? (pageEnemy && enemyPageOpen
              ? t("{name} - 명일방주 적 도감 | 테라 아카이브", { name: pageEnemy.name })
              : t("적 도감 - 명일방주 적 정보 | 테라 아카이브"))
          : tab === "stage"
            ? (pageStage && stagePageOpen
              ? t("{code} {name} - 명일방주 작전 | 테라 아카이브", { code: pageStage.stage.code, name: pageStage.stage.name })
              : t("작전 도감 - 명일방주 스테이지 지형·드랍 | 테라 아카이브"))
          : tab === "farm"
            ? t("재료파밍 도우미 - 명일방주 재료 파밍 효율표 | 테라 아카이브")
            : tab === "sim"
            ? t("작전 시뮬레이터 - 명일방주 적 스폰 타임라인 | 테라 아카이브")
            : tab === "upgrade"
            ? t("오퍼 육성 시뮬 - 명일방주 육성 비용 계산기 | 테라 아카이브")
            : tab === "story"
              // 상세가 열려 있으면 스토리별 제목 — 상세 라우트의 <title>(app/seo-story.ts)과 같은 문구
              ? (storyTitle
                ? t("{name} 스토리 요약 - 명일방주 | 테라 아카이브", { name: storyTitle })
                : t("스토리 - 명일방주 스토리 요약·전문 | 테라 아카이브"))
              : tab === "rogue"
                ? t("통합전략 가이드 - 명일방주 통합전략 공략 | 테라 아카이브")
                : tab === "ra"
                ? t("생존연산 가이드 - 명일방주 생존연산 공략 | 테라 아카이브")
                : tab === "archive"
                ? t("오퍼레이터 백과사전 - 명일방주 오퍼 도감 | 테라 아카이브")
                : t("테라 아카이브 | 명일방주(Arknights) 팬사이트");
  }, [tab, selected, pageOperator, storyTitle, t]);

  // 오퍼 모달은 히스토리 엔트리를 쌓지 않고 해시만 교체한다(공유용 딥링크).
  // 예전엔 열 때 pushState, 닫을 때 history.back()으로 URL을 복원했는데, 인앱 브라우저
  // (카톡·네이버 카페 웹뷰 — bfcache 미지원)에서 back()이 문서를 통째로 리로드시켜
  // 목록·필터·스크롤이 전부 초기화되는 버그가 있었다 (사용자 리포트 2026-07-18).
  // replaceState는 네비게이션이 아니라 리로드가 원천적으로 발생하지 않는다.
  //
  // ⚠ 주소는 **목록 경로 + #op-<id>** 다. 2026-08-06에 상세의 정본 경로(/operators/<id>)로
  //   바꿨다가 2026-09-04에 되돌렸다 — 그 주소로 새로고침하면 **모달이 페이지에 박힌 채로**
  //   뜬다(그 라우트의 프리렌더 HTML이 페이지 뷰이기 때문). 하이드레이션 뒤에 모달로 바꿔
  //   봤지만, 브라우저는 JS가 돌기 전에 이미 그 HTML을 그려 놓아서 **페이지 → 모달 번쩍임**이
  //   남는다 (사용자 제보 2026-09-04, 두 번). 목록 경로는 프리렌더가 곧 목록이라 새로고침해도
  //   모달이 목록 위에 그대로 뜬다.
  //   정본 경로는 그대로 살아 있다 — 카드 <a href>·사이트맵이 가리키므로 색인은 영향 없고,
  //   검색 결과로 직접 들어오면 종전대로 상세 페이지가 뜬다.
  const openOperator = useCallback((operator: Operator) => {
    setSelected(operator);
    // ⚠ 미실장이라고 ?future=1을 덧붙이지 않는다 (사용자 지시 2026-09-04) — 토글이 켜져
    //   있으면 tabPath가 이미 달고 오고, 꺼져 있어도 목록에 있으므로 실을 이유가 없다.
    history.replaceState(null, "", `${tabPath("archive")}#op-${operator.id}`);
  }, [tabPath]);
  const closeOperator = () => {
    setSelected(null);
    // 주소를 되돌리는 건 **주소가 오퍼를 가리키고 있을 때만**. 플래너 등 다른 탭에서
    // 띄운 모달(showOperatorById)은 URL을 안 건드리므로 여기서도 그대로 둔다.
    if (operatorIdFromPath(window.location.pathname) !== null) {
      history.replaceState(null, "", tabPath("archive"));
    } else if (decodeURIComponent(window.location.hash).startsWith("#op-")) {
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
    enemy: t("적 도감"),
    stage: t("작전 도감"),
    planner: t("인프라 자동편성기"),
    recruit: t("공개채용 도우미"),
    farm: t("재료파밍 도우미"),
    upgrade: t("오퍼 육성 시뮬"),
    sim: t("작전 시뮬레이터"),
    story: t("스토리"),
    rogue: t("통합전략 가이드"),
    ra: t("생존연산 가이드"),
    autochess: t("위수 협의 가이드"),
    about: t("테라 아카이브 소개"),
  };
  // 햄버거 메뉴 묶음 (사용자 확정 2026-08-09 '메뉴 마토메') — 도감(오퍼·적·작전)과
  // 시뮬레이터(공개채용·재료파밍·오퍼 육성)로 묶고, 하위 라벨은 짧게 쓴다.
  // **URL·페이지 제목·SEO는 그대로** — 헤더/푸터 내비 표시만 바꾸는 것이다.
  // 가이드 묶음에 속한 탭 — 묶음 헤더 선택 표시·새기능 배지 판정에 쓴다
  const GUIDE_TABS: Tab[] = ["rogue", "ra", "autochess"];
  const TAB_GROUPS: { id: "dex" | "sim"; name: string; icon: string; items: { tab: Tab; short: string }[] }[] = [
    { id: "dex", name: t("도감"), icon: "▤", items: [
      { tab: "archive", short: t("오퍼레이터") }, { tab: "enemy", short: t("적") }, { tab: "stage", short: t("작전") },
    ] },
    { id: "sim", name: t("시뮬레이터"), icon: "◈", items: [
      { tab: "recruit", short: t("공개채용") }, { tab: "farm", short: t("재료파밍") }, { tab: "upgrade", short: t("오퍼 육성") },
      // 작전 시뮬레이터(/sim) — "시뮬레이터 → 작전" (사용자 확정 2026-08-10 B안)
      { tab: "sim", short: t("작전") },
    ] },
  ];
  // 탭 청크 미리 받기 — 지연 로드(위 lazy)로 초기 파싱은 줄이되, **탭 전환 체감은 종전과
  // 같게** 유지하기 위한 짝이다. 탭 줄에 포인터가 닿거나(=누르기 직전) 포커스가 오면 그때
  // 나머지 탭을 조용히 당겨 둔다. 로드 직후 무조건 당기지 않는 이유: 그러면 파싱 비용이
  // 하이드레이션 직후로 옮겨올 뿐이라, 탭을 안 쓰는 방문자에게까지 롱태스크를 다시 안긴다.
  // 스토리 요약 본문 — 스토리 탭에 들어갈 때만 받는다 (SummariesLoader 주석 참조).
  // 셸의 하이드레이션 경로에서 1.8MB 파싱이 빠지고, 실제로 읽는 사람만 비용을 낸다.
  const [summaries, setSummaries] = useState<StorySummaries | null>(null);
  useEffect(() => {
    if (tab !== "story" || summaries) return;
    let alive = true;
    void summariesLoader().then((m) => { if (alive) setSummaries(m.default as StorySummaries); });
    return () => { alive = false; };
  }, [tab, summaries, summariesLoader]);

  // 만능검색 — 첫 열기 전까지 모듈을 받지 않는다 (위 OmniSearch 주석 참조).
  const [omniOpen, setOmniOpen] = useState(false);
  useEffect(() => {
    if (omniOpen) return;   // 로드된 뒤엔 omni-search가 자기 ⌘K 바인딩을 갖는다
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOmniOpen(true); }
      else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setOmniOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [omniOpen]);

  // ⌘F/Ctrl+F — 브라우저 찾기 대신 **그 화면의 검색란**으로 (사용자 요청 2026-08-09).
  // 모달이 떠 있으면 최상단 모달 안의 검색란만 후보다 — 모달에 검색란이 없으면
  // 뒤 화면 검색란에 초점을 주는 게 더 이상하다.
  // ⚠ 검색란이 없으면 **아무것도 하지 않고 브라우저 찾기를 그대로 둔다**
  //    (사용자 지시 2026-08-22: 예전엔 이때 유니버셜 서치를 열었는데 그 동작을 뺐다).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "f" && e.key !== "F") || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const SEL = '.search-wrap input, input[type="search"]';
      // ModalWindow는 포털이라 나중에 뜬(=재지목돼 앞으로 온) 창이 body 뒤쪽에 붙는다
      const modals = document.querySelectorAll<HTMLElement>(".mw-backdrop");
      const scope = modals.length ? modals[modals.length - 1] : document;
      const input = [...scope.querySelectorAll<HTMLInputElement>(SEL)]
        .find((x) => x.offsetParent !== null && !x.disabled);
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const omniTrigger = (
    <div className="omni">
      <button type="button" className="omni-trigger" onClick={() => setOmniOpen(true)}
        aria-label={t("유니버셜 서치 — 사이트 전체 검색")}
        title={t("유니버셜 서치 — 오퍼·재료·스토리·통합전략·기능을 한 번에 찾아 이동합니다 (⌘K)")}>
        <span aria-hidden>⌕</span>
        <span className="omni-trigger-label">{t("유니버셜 서치")}{isNewFeature("omni") && <span className="new-badge">{t("새기능")}</span>}</span>
        <kbd className="omni-trigger-kbd" aria-hidden>⌘K</kbd>
      </button>
    </div>
  );

  const prefetched = useRef(false);
  const prefetchTabs = useCallback(() => {
    if (prefetched.current) return;
    prefetched.current = true;
    void import("./planner"); void import("./recruit"); void import("./farm");
    void import("./story"); void import("./rogue"); void import("./about");
    // 적 도감은 로케일 청크가 갈라져 있다 — 지금 언어 것만 미리 받는다
    void (locale === "ja" ? import("./enemies-ja") : locale === "en" ? import("./enemies-en") : import("./enemies-ko"));
    // 생존연산 가이드도 로케일 청크 (2026-08-12)
    void (locale === "ja" ? import("./sandbox-ja") : locale === "en" ? import("./sandbox-en") : import("./sandbox-ko"));
    void (locale === "ja" ? import("./stages-ja") : locale === "en" ? import("./stages-en") : import("./stages-ko"));
  }, [locale]);

  // 생존연산 시즌 전환 — /ra/<slug>로 주소를 바꾸고 탭을 연다 (통전 테마 전환과 같은 짜임).
  // ⚠ tabPath가 ?future=1을 달고 올 수 있어 문자열 이어붙이기 금지 (switchRogueTopic과 같은 함정).
  const [sandboxSlug, setSandboxSlug] = useState(initialSandbox ?? "sand");
  const switchSandbox = (slug: string) => {
    setNavOpen(false); setOpenGroup(""); holdFlyout("");
    const [, query] = tabPath("ra").split("?");
    history.pushState(null, "", `${localeBase}/ra/${slug}${query ? `?${query}` : ""}`);
    setSandboxSlug(slug);
    startTransition(() => { setTab("ra"); setSelected(null); });
  };

  // 위수 협의 시즌 전환 — /autochess/<slug>로 주소를 바꾸고 탭을 연다 (생존연산과 같은 짜임).
  // ⚠ tabPath가 ?future=1을 달고 올 수 있어 문자열 이어붙이기 금지.
  const [autochessSeason, setAutochessSeason] = useState(() => autochessSeasonOf(initialAutochess));
  const switchAutochess = (n: number) => {
    setNavOpen(false); setOpenGroup(""); holdFlyout("");
    const [, query] = tabPath("autochess").split("?");
    history.pushState(null, "", `${localeBase}/autochess/s${n}${query ? `?${query}` : ""}`);
    setAutochessSeason(n);
    startTransition(() => { setTab("autochess"); setSelected(null); });
  };

  const switchTab = (next: Tab) => {
    setNavOpen(false); holdFlyout("");
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
    setNavOpen(false); holdFlyout("");
    const slug = rogueSlugOf(topicId);
    startTransition(() => {
      setSelected(null);
      setTab("rogue");
      setRogueSlug(slug);
    });
    // tabPath가 이미 ?future=1을 달고 올 수 있으므로 문자열 이어붙이기 금지 —
    // ?future=1?topic=isN 처럼 깨져 topic 파싱에 실패하면 팬텀(rogue_1)으로 떨어진다
    // 주소는 테마의 정본 경로 — 종전 ?topic= 파라미터는 색인되지 않는 주소였다 (2026-08-06)
    const [, query] = tabPath("rogue").split("?");
    const params = new URLSearchParams(query);
    params.delete("topic");
    const qs = params.toString();
    history.pushState(null, "", `${localeBase}/rogue/${slug}${qs ? `?${qs}` : ""}`);
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
      if (!target.closest(".main-tabs") && !target.closest(".nav-toggle")) {
        // 붙잡아 둔 플라이아웃도 같이 놓는다 — 안 그러면 메뉴를 다시 열 때
        // 2초 지연이 남아 엉뚱한 패널이 펼쳐진 채로 뜬다
        setNavOpen(false); holdFlyout("");
      }
    };
    const onKey = (event: KeyboardEvent) => {
      // Esc 는 붙잡아 둔 플라이아웃까지 같이 닫는다 (닫힘 지연이 남아 있으면 갇힌다)
      if (event.key === "Escape") { setNavOpen(false); setOpenGroup(""); holdFlyout(""); }
    };
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
  // 직군을 바꾸면 그 직군에 없는 세부 직군 선택은 같이 떨어뜨린다 — 안 그러면 결과가
  // 0건인 채로 이유가 안 보인다 (세부 직군 목록은 고른 직군의 것만 나오므로).
  const toggleJob = (job: string) => {
    const next = selectedJobs.includes(job) ? selectedJobs.filter((item) => item !== job) : [...selectedJobs, job];
    const allowed = new Set(roster.filter((operator) => next.includes(operator.job)).map((operator) => operator.subProfession));
    setSelectedJobs(next);
    setSelectedSubProfessions((subs) => (subs.every((sub) => allowed.has(sub)) ? subs : subs.filter((sub) => allowed.has(sub))));
  };

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
      <header ref={headerRef} id="top"
        className={`site-header${headerCollapsed ? " collapsed" : ""}${headerTucked ? " tucked" : ""}${drag ? " dragging" : ""}`}
        style={drag ? { maxHeight: `${drag.h}px` } : undefined}>
        <a className="brand" href={localeBase || "/"} aria-label={t("테라 아카이브 홈")}
          onClick={(event) => { event.preventDefault(); switchTab("portal"); scrollMainTop(); }}>
          <span className="brand-mark"><img src={asset("/avatars/char_1012_skadi2.webp")} alt="" width={180} height={180} /></span>
          <span>{t("테라 아카이브")}<small>{t("명일방주(Arknights) 팬사이트")}</small></span>
        </a>
        {/* 업데이트 내역 — 로고 바로 오른쪽 1줄 소속: 헤더를 접어도 보인다
            (사용자 요청 2026-07-27: "헤더를 열어보지 않으면 알 수가 없으니") */}
        <ChangelogButton />
        {/* 기간 한정 바로가기 — 그 모드가 게임에서 도는 동안에만 (사용자 요청 2026-08-22).
            업데이트 내역과 같은 **1줄 소속**이라 헤더를 접어도 남는다 — 확장부에 두면
            헤더가 접힌 기본 상태에서 아예 안 보인다. 링크라 크롤러도 따라가고, 클릭은 SPA 전환. */}
        {PROMO_ON && (
          <a className={`promo-trigger${tab === PROMO.tab ? " selected" : ""}`}
            href={`${localeBase}/${TAB_SEG[PROMO.tab]}`}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault(); switchTab(PROMO.tab);
            }}>
            <span className="promo-mark" aria-hidden>{PROMO.icon}</span>
            {t(PROMO.label)}
            {/* 남은 기간 — '기간 한정'보다 쓸모 있는 정보라 그 자리를 대신한다
                (사용자 요청 2026-08-24). 못 구하면 종전 문구로 되돌아간다. */}
            <span className="promo-hint">{promoLeftLabel(promoNow, t) ?? t("기간 한정")}</span>
            {tabHasNewFeature(PROMO.tab) && <span className="new-badge">{t("새기능")}</span>}
          </a>
        )}
        {/* 헤더 치비 (베타) — 1줄 가운데 빈 공간의 산책 장식, 데스크탑 전용 (사용자 요청 2026-08-03) */}
        <HeaderChibi operators={operators} onNavigate={switchTab} onShowOperator={(op) => setSelected(op)} />
        {/* 언어 전환 = 1줄 만능검색 왼쪽 — 헤더를 접어도 남는다 (사용자 요청 2026-08-17:
            확장부에 있으면 외국어 방문자가 못 찾고 이탈한다). 첫 방문 자동 언어 맞춤은
            layout.tsx 인라인 스크립트(ta-locale)가 담당. */}
        <LanguageSwitcher />
        {/* 만능검색 = 1줄 오른쪽(햄버거 왼쪽) — 헤더를 접어도 남는다 (사용자 요청 2026-07-25) */}
        {/* 만능검색은 **처음 열 때까지 로드하지 않는다** (2026-08-09 INP 작업).
            omni-search → omni.ts → farm.tsx → costs.json(573KB) 사슬이라 그냥 마운트만 해도
            초기 파싱에 그대로 얹혔다. 트리거는 셸이 직접 그리고(가볍다), 누르거나 ⌘K를
            치면 그때 모듈을 받아 패널을 연다. 로드된 뒤에는 omni-search가 트리거까지
            자기 것으로 다시 그리므로 화면은 종전과 같다. */}
        {omniOpen ? (
          <Suspense fallback={omniTrigger}>
            <OmniSearch roster={roster} extra={extra} onGo={runOmni} autoOpen />
          </Suspense>
        ) : omniTrigger}
        {/* 게임 연결 — 크롬 확장(extension/)이 깔린 사람에게만 나타난다. 누르면 게임 창
            프레임이 흐르고, 인식·이동은 각 탭의 스샷 레이더 경로가 그대로 처리한다. */}
        <BridgeButton t={t} />
        {/* 햄버거(메뉴) = 1줄 오른쪽 끝 — 데스크탑·모바일 공통 (사용자 확정 2026-07-22).
            모바일은 order로, 데스크탑은 margin-left:auto로 배치되므로 JSX 위치는 자유. */}
        <div className="nav-group">
          <button type="button" className="nav-toggle" aria-expanded={navOpen} aria-label={t("메뉴 열기")} onClick={() => { setOpenGroup(""); setNavOpen((open) => !open); }}>
            {/* 라벨은 "메뉴"로 **고정** — 현재 탭 이름을 넣으면 페이지를 옮길 때마다 버튼 폭이
                늘었다 줄었다 해서 헤더가 흔들린다 (사용자 요청 2026-07-29) */}
            <span aria-hidden>☰</span>{t("메뉴")}
          </button>
          {/* 드롭다운은 햄버거 버튼 바로 밑에 딱 붙여 연다 (사용자 요청 2026-07) */}
          {/* 순서 (사용자 확정 2026-08-10): 홈 · 인프라 · 도감▸ · 시뮬레이터▸ ·
              통합전략▸ · 스토리 · 소개. 인프라는 대표 기능이라 묶지 않고 톱레벨 유지(사용자 확정). */}
          <nav className={`main-tabs${navOpen ? " open" : ""}`} aria-label={t("주요 탭")}
            onPointerOver={prefetchTabs} onTouchStart={prefetchTabs} onFocus={prefetchTabs}>
            <button className={`tab-portal${tab === "portal" ? " selected" : ""}`} onClick={() => switchTab("portal")}><span className="tab-icon" aria-hidden>◇</span>{t("홈")}</button>
            <button className={`tab-planner${tab === "planner" ? " selected" : ""}`} onClick={() => switchTab("planner")}><span className="tab-icon" aria-hidden>⌂</span>{t("인프라 자동편성기")}{tabHasNewFeature("planner") && <span className="new-badge">{t("새기능")}</span>}</button>
            {/* 도감·시뮬레이터 묶음 — 통합전략과 같은 플라이아웃 규격. 하위 항목은 실제 <a>
                (크롤러용 내부 링크 — 통전 부메뉴와 같은 이유, 2026-08-06). 클릭은 SPA 전환. */}
            {TAB_GROUPS.map((g) => (
              <div key={g.id} className={`tab-flyout${openGroup === g.id || flyoutOpen(g.id) ? " open" : ""}`}
                onMouseEnter={() => holdFlyout(g.id)} onMouseLeave={() => releaseFlyout()}>
                <button type="button"
                  className={`tab-group${g.items.some((it) => it.tab === tab) ? " selected" : ""}`}
                  aria-expanded={openGroup === g.id}
                  onClick={() => setOpenGroup((cur) => (cur === g.id ? "" : g.id))}>
                  <span className="tab-icon" aria-hidden>{g.icon}</span>{g.name}
                  {g.items.some((it) => tabHasNewFeature(it.tab)) && <span className="new-badge">{t("새기능")}</span>}
                  <span className="tab-group-arrow" aria-hidden>◂</span>
                </button>
                <div className="tab-submenu" role="group" aria-label={g.name}>
                  {g.items.map((it) => (
                    <a key={it.tab} href={`${localeBase}/${TAB_SEG[it.tab]}`}
                      className={`tab-sub tab-${it.tab}${tab === it.tab ? " selected" : ""}`}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                        event.preventDefault(); switchTab(it.tab);
                      }}>
                      <span className="tab-sub-mark" aria-hidden>›</span>{it.short}
                      {tabHasNewFeature(it.tab) && <span className="new-badge">{t("새기능")}</span>}
                    </a>
                  ))}
                </div>
              </div>
            ))}
            {/* 가이드 — 게임 모드 공략 3종을 한 묶음으로 (사용자 확정 2026-08-22
                "이제 각 모드를 가이드 메뉴로 합칠 필요가 있어보임"). 종전엔 통합전략·생존연산이
                각각 톱레벨을 먹고 있었는데 위수 협의가 셋째로 붙으면서 메뉴가 길어졌다.
                하위 테마·시즌 링크는 **크롤러용 내부 링크**라 없애지 않는다
                (2026-08-06에 넣은 이유 — 헤더가 전부 버튼이라 정적 HTML에 앵커가 없었다).
                ⚠ 그 하위 링크는 2026-09-05부터 **모드마다 자기 플라이아웃**으로 옆에 뜬다
                (사용자 요청 "주메뉴 - 부메뉴로 구성해서 마우스오버하면 뜨게 해 줘") —
                들여쓴 인라인 목록으로 되돌리지 말 것. 호버가 없는 기기(터치)에서는 CSS가
                알아서 인라인 목록으로 펼친다 (globals.css `@media (hover: none)`). */}
            <div className={`tab-flyout${openGroup === "guide" || flyoutOpen("guide") ? " open" : ""}`}
              onMouseEnter={() => holdFlyout("guide")} onMouseLeave={() => releaseFlyout()}>
              <button type="button"
                className={`tab-group${GUIDE_TABS.includes(tab) ? " selected" : ""}`}
                aria-expanded={openGroup === "guide"}
                onClick={() => setOpenGroup((cur) => (cur === "guide" ? "" : "guide"))}>
                <span className="tab-icon" aria-hidden>❖</span>{t("가이드")}
                {GUIDE_TABS.some((x) => tabHasNewFeature(x)) && <span className="new-badge">{t("새기능")}</span>}
                <span className="tab-group-arrow" aria-hidden>◂</span>
              </button>
              <div className="tab-submenu tab-submenu-guide" role="group" aria-label={t("가이드")}>
                <div className={`tab-flyout tab-flyout2${flyoutOpen("guide/rogue") ? " open" : ""}`}
                  onMouseEnter={() => holdFlyout("guide/rogue")} onMouseLeave={() => releaseFlyout("guide")}>
                  <a href={`${localeBase}/rogue`} className={`tab-sub tab-rogue${tab === "rogue" ? " selected" : ""}`}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                      event.preventDefault(); switchTab("rogue");
                    }}>
                    <span className="tab-sub-mark" aria-hidden>›</span>{t("통합전략(로그라이크)")}
                    {tabHasNewFeature("rogue") && <span className="new-badge">{t("새기능")}</span>}
                    <span className="tab-group-arrow" aria-hidden>◂</span>
                  </a>
                  <div className="tab-submenu tab-submenu2" role="group" aria-label={t("통합전략(로그라이크)")}>
                    {/* 미래시 토픽도 항상 메뉴에 둔다 — 흑백 + '미래시' 표식 (2026-09-04 규칙 변경) */}
                    {ROGUE_TOPICS.filter((tp) => tp.ready).map((tp) => (
                      <a key={tp.id} href={`${localeBase}/rogue/${rogueSlugOf(tp.id)}`}
                        className={`tab-sub tab-sub2${tab === "rogue" && rogueSlug === rogueSlugOf(tp.id) ? " selected" : ""}${tp.future ? " fut-dim" : ""}`}
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                          event.preventDefault(); switchRogueTopic(tp.id);
                        }}>
                        <span className="tab-sub-mark" aria-hidden>·</span>{t(tp.name)}{tp.future && <em className="tab-sub-future">{t("미래시")}</em>}
                      </a>
                    ))}
                  </div>
                </div>
                <div className={`tab-flyout tab-flyout2${flyoutOpen("guide/ra") ? " open" : ""}`}
                  onMouseEnter={() => holdFlyout("guide/ra")} onMouseLeave={() => releaseFlyout("guide")}>
                  <a href={`${localeBase}/ra`} className={`tab-sub tab-ra${tab === "ra" ? " selected" : ""}`}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                      event.preventDefault(); switchTab("ra");
                    }}>
                    <span className="tab-sub-mark" aria-hidden>›</span>{t("생존연산")}
                    {tabHasNewFeature("ra") && <span className="new-badge">{t("새기능")}</span>}
                    <span className="tab-group-arrow" aria-hidden>◂</span>
                  </a>
                  <div className="tab-submenu tab-submenu2" role="group" aria-label={t("생존연산")}>
                    <a href={`${localeBase}/ra/sand`} className={`tab-sub tab-sub2${tab === "ra" && sandboxSlug === "sand" ? " selected" : ""}`}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                        event.preventDefault(); switchSandbox("sand");
                      }}><span className="tab-sub-mark" aria-hidden>·</span>{t("사막 이야기")}</a>
                    {/* 중섭 선행 신시즌도 항상 메뉴에 둔다 (2026-09-04 규칙 변경) */}
                    <a href={`${localeBase}/ra/anchor`} className={`tab-sub tab-sub2 fut-dim${tab === "ra" && sandboxSlug === "anchor" ? " selected" : ""}`}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                        event.preventDefault(); switchSandbox("anchor");
                      }}><span className="tab-sub-mark" aria-hidden>·</span>{t("재기동 앵커")}<em className="tab-sub-future">{t("미래시")}</em></a>
                  </div>
                </div>
                <div className={`tab-flyout tab-flyout2${flyoutOpen("guide/autochess") ? " open" : ""}`}
                  onMouseEnter={() => holdFlyout("guide/autochess")} onMouseLeave={() => releaseFlyout("guide")}>
                  <a href={`${localeBase}/autochess`} className={`tab-sub tab-autochess${tab === "autochess" ? " selected" : ""}`}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                      event.preventDefault(); switchTab("autochess");
                    }}>
                    <span className="tab-sub-mark" aria-hidden>›</span>{t("위수협의(명토체스)")}
                    {tabHasNewFeature("autochess") && <span className="new-badge">{t("새기능")}</span>}
                    <span className="tab-group-arrow" aria-hidden>◂</span>
                  </a>
                  {/* 시즌도 통전 테마·생존연산 시즌과 같이 부메뉴에 둔다 (사용자 요청 2026-09-05).
                      최신 시즌이 위 — 지난 시즌은 수치가 당시 것이라 섞이면 안 된다 */}
                  <div className="tab-submenu tab-submenu2" role="group" aria-label={t("위수협의(명토체스)")}>
                    {[...AC_SEASONS].reverse().map((n) => (
                      <a key={n} href={`${localeBase}/autochess/s${n}`}
                        className={`tab-sub tab-sub2${tab === "autochess" && autochessSeason === n ? " selected" : ""}`}
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                          event.preventDefault(); switchAutochess(n);
                        }}>
                        <span className="tab-sub-mark" aria-hidden>·</span>{t("시즌 {n}", { n })}
                        {n !== AC_LATEST && <em className="tab-sub-past">{t("지난 시즌")}</em>}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <button className={`tab-story${tab === "story" ? " selected" : ""}`} onClick={() => switchTab("story")}><span className="tab-icon" aria-hidden>✦</span>{t("스토리")}{tabHasNewFeature("story") && <span className="new-badge">{t("새기능")}</span>}</button>
            <button className={`tab-about${tab === "about" ? " selected" : ""}`} onClick={() => switchTab("about")}><span className="tab-icon" aria-hidden>ⓘ</span>{t("테라 아카이브 소개")}</button>
          </nav>
        </div>
        {/* 2줄(확장부) — 데스크탑: 미래시·다크모드(오른쪽 끝). 모바일: display:contents로
            래퍼를 풀어 기존 order 배치(3줄 제안·미래시·다크)가 그대로 동작한다.
            언어 전환은 2026-08-17에 1줄(만능검색 왼쪽)로 올라갔다. */}
        <div className="header-sub">
          {/* 제안 버튼 — 모바일 전용(3줄). 데스크탑에선 숨기고 우하단 FAB을 쓴다. */}
          {feedbackReady && (
            <button type="button" className="feedback-header-btn" onClick={() => setFeedbackOpen(true)} aria-label={t("제안 게시판")}>
              <span aria-hidden>💬</span> {t("제안")}
              {feedbackNew > 0 && (
                <span className="fb-reply-badge"
                  title={feedbackNewAdmin ? t("새 제안 {n}개", { n: feedbackNew }) : t("새 답변 {n}개", { n: feedbackNew })}>{feedbackNew}</span>
              )}
              {feedbackNew === 0 && isNewFeature("feedback-board") && <span className="new-badge">{t("새기능")}</span>}
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
          </div>
        </div>
        {/* 헤더 접기 핸들 — 헤더 맨 아래 중앙, 데스크탑·모바일 공통 (접힘이 기본).
            접으면 로고·햄버거 한 줄만 남는다 (사용자 확정 2026-07-22).
            **위로 끌어올리면 헤더가 통째로 사라지고 이 핸들만 남는다** (모바일, 2026-08-25).
            끌기 판정은 pointerup 에서 하고, 그때 처리했으면 뒤따라오는 click 은 흘려보낸다
            (키보드 Enter·Space 는 pointer 이벤트가 없어 click 으로 들어온다). */}
        <button type="button" className="header-collapse-toggle"
          aria-expanded={!headerCollapsed && !headerTucked}
          aria-label={headerTucked || headerCollapsed ? t("헤더 펼치기") : t("헤더 접기")}
          onPointerDown={(e) => {
            handleFrom.current = e.clientY;
            handleDragged.current = false;
            // 잡은 순간의 실제 높이 — 끄는 동안 이 값을 기준으로 따라간다.
            // tuck 상태면 0에서 시작해 끌어내리는 만큼 열린다.
            headerH.current = headerTucked ? 0 : (headerRef.current?.offsetHeight ?? 0);
            // ⚠ 포인터를 잡아 두지 않으면 위로 끌어올리는 순간 커서가 버튼 밖으로 나가고,
            //    pointerup 이 헤더의 다른 요소에서 발생해 끌기 판정이 통째로 날아간다.
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 미지원 */ }
          }}
          onPointerMove={(e) => {
            const from = handleFrom.current;
            if (from == null) return;
            const dy = e.clientY - from;
            // 잡은 자리에서 3px 안쪽은 무시 — 탭이 미세하게 흔들려도 헤더가 떨지 않게
            if (drag == null && Math.abs(dy) < 3) return;
            const open = headerTucked ? (headerRef.current?.scrollHeight ?? 0) : headerH.current;
            setDrag({ h: Math.max(0, Math.min(open, headerH.current + dy)) });
          }}
          onPointerUp={(e) => {
            const from = handleFrom.current;
            handleFrom.current = null;
            setDrag(null);                        // 손을 떼면 CSS 전환이 나머지를 마무리한다
            if (from == null) return;
            const dy = e.clientY - from;
            if (dy <= -14) { handleDragged.current = true; setHeaderTucked(true); }
            else if (dy >= 14) { handleDragged.current = true; setHeaderTucked(false); setHeaderCollapsed(false); }
          }}
          onPointerCancel={() => { handleFrom.current = null; setDrag(null); }}
          onClick={() => {
            if (handleDragged.current) { handleDragged.current = false; return; }
            if (headerTucked) { setHeaderTucked(false); return; }
            setHeaderCollapsed((collapsed) => !collapsed);
          }}>
          <span aria-hidden>{headerTucked || headerCollapsed ? "⌄" : "⌃"}</span>
        </button>
      </header>

      {/* 본문 스크롤 영역 — 세로 스크롤은 여기서만 생긴다(헤더는 위에 고정, 스크롤바가 헤더까지
          올라오지 않도록 — 사용자 요청 2026-07-22, 모바일·PC 공통). 모달·제안 위젯은 fixed라 밖에 둔다. */}
      <div className="site-scroll">

      {tab === "portal" && <Portal onOpenTab={switchTab} />}

      {/* 오퍼 상세 페이지(/operators/<id>)로 들어오면 목록 대신 상세만 — 420장의 목록이
          모든 상세 페이지에 통째로 딸려 들어가면 페이지마다 고유 본문보다 공통 뼈대가
          많아진다 (2026-08-06). 목록으로 돌아가는 링크는 상세 위에 있다. */}
      {tab === "archive" && pageOperator && (
        <OperatorPage operator={pageOperator} onUpgrade={openUpgradeFor} includeFuture={includeFuture}
          listHref={tabPath("archive")} operators={operators}
          onRelated={(op) => { setPageOperator(op); history.pushState(null, "", operatorHref(locale, op)); scrollMainTop(); }}
          onBack={() => { setPageOperator(null); history.pushState(null, "", tabPath("archive")); }} />
      )}
      {tab === "archive" && !pageOperator && <section className="explorer" aria-labelledby="explorer-title">
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
            // 세부 직군은 **직군 목록 안에서** 펼쳐진다 (사용자 요청 2026-08-16) — 종전엔
            // 직군을 골라야 옆 칸이 열리는 방식이었다("직군 먼저" 잠금). 이제 직군에 마우스를
            // 올리면(터치는 탭) 그 직군의 세부 직군이 옆으로 나온다. 직군은 복수 선택이라
            // 가드 세부 하나 + 캐스터 세부 하나처럼 갈래를 섞어 고르는 것도 그대로 된다.
            { title: t("직군"), items: jobs, selected: selectedJobs, onToggle: toggleJob,
              countForItem: (item) => chipCount.job.get(item) ?? 0,
              subFor: (path: string[]) => {
                if (path.length !== 1) return null;
                const job = path[0];
                const items = subsByJob.get(job) ?? [];
                if (items.length <= 1) return null;
                return {
                  title: t("세부 직군"), items, selected: selectedSubProfessions,
                  countForItem: (item: string) => chipCount.sub.get(item) ?? 0,
                  // 세부 직군을 고르면 그 직군도 함께 켠다 — 직군이 꺼져 있으면 결과가 0건이 된다
                  onPick: (item: string) => {
                    setSelectedJobs((cur) => (cur.includes(job) ? cur : [...cur, job]));
                    toggleIn(setSelectedSubProfessions)(item);
                  },
                };
              } },
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
              {/* 검색란 제안 — 고르면 그 오퍼 상세가 바로 열린다 (사용자 확정 2026-08-10) */}
              <SearchSuggest query={searchTerm}
                items={filtered.map((o) => ({ key: o.id, label: o.name, sub: `★${o.rarity} · ${o.job}`, img: asset(`/avatars/${o.id}.webp`) }))}
                onPick={(id) => { const op = filtered.find((o) => o.id === id); if (op) openOperator(op); }} />
            </div>
            <div className="results-tools">
              {/* 공용 드롭다운으로 통일 (사용자 지시 2026-08-25). 종전엔 네이티브 <select>라
                  운영체제마다 생김새가 달랐고, <label>이 버튼까지 감싸고 있어 정렬 방향
                  버튼을 눌러도 라벨이 select를 깨우는 구조였다. */}
              <div className="sort-wrap">
                <span>{t("정렬")}</span>
                <Dropdown ariaLabel={t("정렬")} label={t(sortKey)} selected={[sortKey]}
                  items={SORT_KEYS.map((key) => ({ value: key, label: t(key) }))}
                  onPick={setSortKey} />
                <button type="button" className="sort-direction" onClick={() => setSortAsc((current) => !current)} aria-label={sortAsc ? t("내림차순으로 변경") : t("오름차순으로 변경")}>{sortAsc ? "↑" : "↓"}</button>
              </div>
              <span className="count"><b>{sorted.length}</b> OPERATORS</span>
            </div>
          </div>
          <div className="active-filters">
            {selectedRarities.map((item) => <button key={`r-${item}`} onClick={() => toggleIn(setSelectedRarities)(item)}>{item}★ ×</button>)}
            {selectedFactions.map((item) => <button key={`f-${item}`} onClick={() => toggleIn(setSelectedFactions)(item)}>{item} ×</button>)}
            {selectedConcepts.map((item) => <button key={`c-${item}`} onClick={() => toggleIn(setSelectedConcepts)(item)}>{conceptTitle(locale, item)} ×</button>)}
            {selectedMethods.map((item) => <button key={`p-${item}`} onClick={() => toggleIn(setSelectedMethods)(item)}>{item} ×</button>)}
            {tags.map((tag) => <button key={`t-${tag}`} onClick={() => toggleTag(tag)}>{tag} ×</button>)}
            {selectedJobs.map((item) => <button key={`j-${item}`} onClick={() => toggleJob(item)}>{item} ×</button>)}
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

      {/* 적 상세 페이지(/enemies/<id>) — **lazy가 아니다**. 이 한 줄이 4,542장의 SEO를
          가른다: lazy로 감싸면 HTML에 "데이터를 불러오는 중…"만 남는다(/rogue/is1이 그 상태).
          목록 1,514장을 상세마다 딸려 보내지 않으려고, 서버가 그 적 하나만 props로 준다. */}
      {tab === "enemy" && pageEnemy && enemyPageOpen && (
        <EnemyPage enemy={pageEnemy} stagesDoc={pageEnemyStages ?? null}
          onBack={() => { setEnemyPageOpen(false); history.pushState(null, "", tabPath("enemy")); }} />
      )}

      {/* 작전 상세 페이지(/stages/<id>) — 적 상세와 같은 이유로 lazy가 아니다 */}
      {tab === "stage" && pageStage && stagePageOpen && (
        <StagePage view={pageStage}
          onBack={() => { setStagePageOpen(false); history.pushState(null, "", tabPath("stage")); }} />
      )}

      {/* 지연 로드된 탭 본문. fallback은 **높이를 가진 빈 칸**이다 — null이면 푸터가 위로
          솟았다 내려오며 레이아웃이 튄다. 탭 전환은 아래 prefetch가 미리 받아 두므로
          이 자리표시가 실제로 보이는 건 첫 진입의 아주 짧은 순간뿐이다. */}
      <Suspense fallback={<div className="tab-loading" aria-hidden />}>
        {tab === "planner" && <InfraPlanner onShowOperator={showOperatorById} extra={extra} includeFuture={includeFuture} />}
        {tab === "recruit" && <RecruitHelper onShowOperator={showOperatorById} extra={extra} />}
        {tab === "farm" && <FarmGuide />}
        {tab === "upgrade" && <UpgradeSim operators={operators} includeFuture={includeFuture} onShowOperator={showOperatorById} />}
        {/* 요약 JSON은 Suspense가 아니라 상태로 받으므로(summariesLoader), 도착 전에는
            Suspense 자리표시가 뜨지 않는다 — 그냥 아무것도 안 그리면 푸터가 헤더 바로 밑에
            붙었다가 밀려나며 CLS가 된다 (실측 모바일 0.281, 2026-08-13). 같은 자리표시를 쓴다. */}
        {tab === "story" && (summaries
          ? <StoryGuide summaries={summaries} onShowOperator={showOperatorById} opIndex={storyOpIndex} initialStory={initialStory} onStoryTitle={setStoryTitle} />
          : <div className="tab-loading" aria-hidden />)}
        {tab === "rogue" && <RogueGuide initialTopic={initialRogue ? `rogue_${initialRogue.replace(/^is/, "")}` : undefined} />}
        {tab === "enemy" && !(pageEnemy && enemyPageOpen) && <EnemyDexForLocale />}
        {tab === "stage" && !(pageStage && stagePageOpen) && <StageDexForLocale onOpenEnemy={openEnemyFromStage} />}
        {tab === "ra" && <SandboxForLocale includeFuture={includeFuture} season={sandboxSlug === "anchor" ? "v3" : "v2"} />}
        {tab === "autochess" && <AutochessForLocale season={autochessSeason} onShowOperator={showOperatorById} />}
        {tab === "about" && <About onOpenTab={switchTab} />}
      </Suspense>
      {/* 작전 시뮬레이터 런처 — SEO 표적 페이지라 **정적 임포트로 프리렌더**한다
          (lazy면 /sim의 HTML이 빈 껍데기가 된다). 무거운 데이터는 컴포넌트가 지연 로드. */}
      {tab === "sim" && <SimLauncher />}

      <footer ref={footerRef}
        className={`${footerFolded ? "folded" : ""}${footDragH != null ? " dragging" : ""}`}
        style={footDragH != null ? { maxHeight: `${footDragH}px` } : undefined}>
        {/* 푸터 접기 핸들 — 모바일에서만 보인다 (CSS). 헤더 핸들과 같은 동작:
            눌러서 여닫고, 끄는 **동안** 손가락을 따라 높이가 바뀐다. */}
        <button type="button" className="footer-collapse-toggle"
          aria-expanded={!footerFolded} aria-label={footerFolded ? t("푸터 펼치기") : t("푸터 접기")}
          onPointerDown={(e) => {
            footerFrom.current = e.clientY;
            footerDragged.current = false;
            footerH.current = footerFolded ? (footerRef.current?.offsetHeight ?? 0)
              : (footerRef.current?.offsetHeight ?? 0);
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 미지원 */ }
          }}
          onPointerMove={(e) => {
            const from = footerFrom.current;
            if (from == null) return;
            const dy = e.clientY - from;              // 위로 끌면 음수 = 더 열린다
            if (footDragH == null && Math.abs(dy) < 3) return;
            // 시트가 올라올 수 있는 최대치 = 내용 높이와 72vh 중 작은 쪽 (CSS 상한과 같다)
            const full = Math.min(footerRef.current?.scrollHeight ?? 0,
              Math.round(window.innerHeight * 0.72));
            setFootDragH(Math.max(0, Math.min(full, footerH.current - dy)));
          }}
          onPointerUp={(e) => {
            const from = footerFrom.current;
            footerFrom.current = null;
            setFootDragH(null);
            if (from == null) return;
            const dy = e.clientY - from;
            if (dy <= -14) { footerDragged.current = true; setFooterFolded(false); }
            else if (dy >= 14) { footerDragged.current = true; setFooterFolded(true); }
          }}
          onPointerCancel={() => { footerFrom.current = null; setFootDragH(null); }}
          onClick={() => {
            if (footerDragged.current) { footerDragged.current = false; return; }
            setFooterFolded((f) => !f);
          }}>
          <span aria-hidden>{footerFolded ? "⌃" : "⌄"}</span>
        </button>
        {/* 'RHODES ISLAND // TERRA ARCHIVE' 장식 문구는 뺐다 (사용자 지시 2026-08-25).
            SEO에는 쓰이지 않았다 — 크롤러가 읽는 건 아래 footer-tabs(내부 링크)와
            footer-langs(언어 대체 링크)이고, 사이트 이름은 <title>·JSON-LD가 이미 준다. */}
        <p>{t("명일방주(Arknights) 비공식 팬 프로젝트 · 게임 내 명칭과 데이터의 권리는 Hypergryph / Yostar 등 각 권리자에게 있습니다.")}</p>
        {/* 비상업 고지 바로 아래에 자발적 서버 후원 링크(작게) — 수익이 아니라 운영비 보탬임을 명확히 */}
        <p className="footer-donate">
          <a href="https://buymeacoffee.com/terra_archive" target="_blank" rel="noopener noreferrer"
            title={t("광고 없이 운영되는 이 사이트의 서버·도메인 비용에 자발적으로 보태 주실 수 있어요 (Buy Me a Coffee). 후원은 전적으로 선택이며 아무 대가가 없습니다.")}>
            ☕ {t("서버 운영 후원")}
          </a>
        </p>
        {/* 문의 메일 — 후원 옆 같은 알약. 오류 제보·기능 제안은 피드백 버튼이 페이지 맥락까지
            같이 실어 보내므로 그쪽이 낫고, 이건 저작권·삭제 요청처럼 위젯으로 못 보내는 용건용이다.
            수신은 Cloudflare Email Routing → 운영자 지메일 전달, 발신은 Resend (2026-09-03).
            ⚠ **mailto: 링크를 달지 않는다** (사용자 지시 2026-09-03 — 메일 클라이언트가 뜨는 게
            불편하다). 주소를 글자로만 두고 user-select:all 로 한 번 클릭에 통째로 잡히게 한다. */}
        <p className="footer-contact">
          <span><i aria-hidden>✉</i><b>{CONTACT_EMAIL}</b></span>
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
              // 선호 언어(ta-locale)를 먼저 기록해야 한다 — 안 그러면 layout.tsx의 자동
              // 리다이렉트가 저장된 언어로 곧장 되돌려 "푸터에서 언어를 바꿔도 안 바뀐다"
              // (사용자 제보 2026-08-19). 기록만 하고 이동은 <a> 기본 동작에 맡긴다.
              : <a key={entry.code} href={href} hrefLang={entry.code} lang={entry.code}
                  onClick={() => { try { localStorage.setItem("ta-locale", entry.code); } catch { /* ignore */ } }}>{entry.label}</a>;
          })}
        </nav>
        {/* 배포 시각 — 화면 계산(인프라 엔진·데이터 JSON)은 빌드 시점에 번들로 굳으므로,
            "지금 보는 사이트가 언제 것인지"를 이 한 줄로 확인한다 (사용자 요청 2026-08-05). */}
        {BUILD_STAMP && <p className="footer-build">{t("배포 {t}", { t: BUILD_STAMP })}</p>}
      </footer>
      </div>{/* /.site-scroll */}

      {/* 미실장 항목(.fut-dim) 안내 툴팁 — 위임 리스너 하나가 사이트 전체를 맡는다 */}
      <FutureTip />
      {selected && <OperatorModal operator={selected} onClose={closeOperator} onUpgrade={openUpgradeFor} includeFuture={includeFuture} onPinChange={(pinned) => { opPinnedRef.current = pinned; }} operators={operators} onRelated={openOperator} />}
      <FeedbackWidget open={feedbackOpen} setOpen={setFeedbackOpen}
        onNewCount={(n, admin) => { setFeedbackNew(n); setFeedbackNewAdmin(admin); }} />
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
        <button className="more-filter" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}><span className="btn-icon drop-caret" aria-hidden>{expanded ? "▴" : "▾"}</span>{expanded ? t("접기") : t("더보기 +{n}", { n: hiddenCount })}</button>
      )}
    </fieldset>
  );
}

function OperatorCard({ operator, index, onSelect }: { operator: Operator; index: number; onSelect: (operator: Operator) => void }) {
  const { locale, t } = useI18n();
  // 카드가 화면 근처에 실제로 들어오기 전엔 이미지 자체를 마운트하지 않는다 — 진입 즉시
  // 420장이 전부 요청되던 문제 대응 (스크롤·필터링 시에만 그때그때 받아옴, 2026-07-22)
  const [portraitRef, visible] = useLazyVisible<HTMLDivElement>();
  // 실제 앵커 — 크롤러가 따라갈 내부 링크이자 새 탭/북마크가 되는 정본 주소.
  // 클릭은 종전대로 가로채 모달을 연다 (미실장 오퍼는 상세 라우트가 없어 목록 주소로).
  return (
    <a className={`operator-card${operator.unreleased ? " fut-dim" : ""}`} href={operatorHref(locale, operator)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault(); onSelect(operator);
      }}
      aria-label={t("{name} 상세 정보 열기", { name: operator.name })} style={{ "--accent": operator.accent, "--delay": `${(index % 12) * 25}ms` } as React.CSSProperties}>
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
    </a>
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
  { id: "op-record", label: "오퍼레이터 기록" },
  { id: "op-voice", label: "보이스 대사" },
  // 관련 오퍼레이터는 2026-08-06(상세끼리 내부 링크, SEO)에 들어왔는데 목차에서 빠져 있었다
  // — 본문 맨 끝 섹션이라 마지막 번호 (사용자 지적 2026-08-13).
  { id: "op-related", label: "관련 오퍼레이터" },
];

function ModalRail({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useI18n();
  const [active, setActive] = useState(MODAL_SECTIONS[0].id);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    // 지금 읽고 있는 섹션 = 스크롤러 위쪽 28% 선을 마지막으로 지나간 섹션
    const sync = () => {
      // 바닥까지 내려갔으면 마지막으로 렌더된 섹션을 활성으로. 끝 섹션이 짧으면 더 스크롤할
      // 여지가 없어 28% 선을 영영 못 넘고, 목차 마지막 항목을 눌러도 앞 항목이 켜져 있었다
      // (관련 오퍼레이터를 11번으로 넣으며 드러남 — 2026-08-13).
      if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2) {
        const tail = [...MODAL_SECTIONS].reverse().find((s) => document.getElementById(s.id));
        if (tail) { setActive(tail.id); return; }
      }
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

// 관련 오퍼 — 상세끼리 서로 링크한다 (2026-08-06). 종전엔 상세가 목록에서만 링크돼
// 크롤 깊이가 목록→상세 한 단계뿐이었고, 페이지끼리의 관련성 신호도 없었다.
// 같은 진영·같은 세부 직군 두 갈래로만 — 임의로 늘리면 페이지마다 링크 뭉치가 커진다.
const RELATED_MAX = 10;
function RelatedOperators({ operator, operators, onSelect }: {
  operator: Operator; operators: Operator[]; onSelect?: (op: Operator) => void;
}) {
  const { locale, t } = useI18n();
  const groups = useMemo(() => {
    const rank = (list: Operator[]) => list
      .filter((o) => o.id !== operator.id && !o.unreleased)
      .sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, locale))
      .slice(0, RELATED_MAX);
    const faction = operator.factions[0];
    return [
      { key: faction ?? "", label: faction, items: faction ? rank(operators.filter((o) => o.factions.includes(faction))) : [] },
      { key: operator.subProfession, label: operator.subProfession, items: rank(operators.filter((o) => o.subProfession === operator.subProfession)) },
    ].filter((g) => g.items.length > 0);
  }, [operator, operators, locale]);
  if (groups.length === 0) return null;
  return (
    <section className="detail-section op-related" id="op-related" aria-label={t("관련 오퍼레이터")}>
      <span className="detail-no">RELATED / 12</span>
      <h3>{t("관련 오퍼레이터")}</h3>
      {groups.map((g) => (
        <div key={g.key} className="op-related-row">
          <span className="op-related-label">{g.label}</span>
          <div className="op-related-list">
            {g.items.map((o) => (
              <a key={o.id} href={operatorHref(locale, o)} className="op-related-chip"
                onClick={(event) => {
                  if (!onSelect || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault(); onSelect(o);
                }}>
                <img src={asset(o.image)} alt="" aria-hidden width={180} height={180} loading="lazy" decoding="async" />
                <span>{o.name}</span>
              </a>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

// 오퍼 상세 본문 — 창 모달(OperatorModal)과 상세 페이지(OperatorPage)가 공유한다.
// 페이지가 따로 필요한 이유: ModalWindow는 body 포털이라 프리렌더(document 없음)에서
// 아무것도 못 그린다. /operators/<id>를 색인시키려면 본문이 정적 HTML에 있어야 한다
// (2026-08-06). 두 곳이 같은 컴포넌트를 쓰므로 내용이 갈라질 일은 없다.
function OperatorFile({ operator, onUpgrade, includeFuture, operators, onRelated }: { operator: Operator; onUpgrade?: (operatorId: string) => void; includeFuture?: boolean; operators?: Operator[]; onRelated?: (op: Operator) => void }) {
  const { locale, t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  // 미래 모듈도 항상 보여준다 — 미래시가 꺼져 있으면 흑백(.fut-dim) + 미실장 배지
  // (2026-09-04 규칙 변경. 종전엔 includeFuture 일 때만 목록에 넣었다.)
  const shownModules = operator.modules;
  return (
    <>
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
                    <article key={potential.rank}>
                      <span>P{potential.rank}</span>
                      <p>{potential.description}</p>
                      {/* 증가폭은 " · "(같은 재능 안의 여러 수치)와 " / "(재능이 여럿)로 이어
                          붙여 오므로, 그 자리에서 줄을 나눈다 — 한 줄로 붙이면 좁은 칸에서
                          벽이 된다 (사용자 요청 2026-09-04). 구분자는 potutil.py가 문맥에서
                          제외하는 문자라 본문 안에 다시 나타나지 않는다. */}
                      {potential.detail ? (
                        <em className="potential-detail">
                          {potential.detail.split(/ \/ | · /).map((line, at) => <b key={at}>{line}</b>)}
                        </em>
                      ) : null}
                    </article>
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
                {/* 효과가 여럿인 재능은 한 덩어리로 오므로 줄을 나눠 준다 (desc-lines.ts) */}
                {operator.talents.map((talent, index) => (
                  <article key={`${talent.name}-${index}`}>
                    <b>{talent.name}</b>
                    {descLines(talent.description).map((line, at) => <p key={at}>{line}</p>)}
                  </article>
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

          <RecordSection operator={operator} operators={operators} onRelated={onRelated} />

          <VoiceSection operator={operator} />

          {operators && <RelatedOperators operator={operator} operators={operators} onSelect={onRelated} />}
        </div>
        <ModalRail scrollRef={scrollRef} />
        </div>
    </>
  );
}

function OperatorModal({ operator, onClose, onUpgrade, includeFuture, onPinChange, operators, onRelated }: { operator: Operator; onClose: () => void; onUpgrade?: (operatorId: string) => void; includeFuture?: boolean; onPinChange?: (pinned: boolean) => void; operators?: Operator[]; onRelated?: (op: Operator) => void }) {
  return (
    <ModalWindow label={`${operator.name} · ${operator.code}`} className="operator-modal" onClose={onClose} onPinChange={onPinChange}
      style={{ "--accent": operator.accent } as React.CSSProperties}>
      <OperatorFile operator={operator} onUpgrade={onUpgrade} includeFuture={includeFuture} operators={operators} onRelated={onRelated} />
    </ModalWindow>
  );
}

// 오퍼 상세 페이지 — /operators/<id>로 직접 들어왔을 때. 창 모양은 그대로 쓰되(같은
// .operator-modal 규격) 백드롭·크롬 없이 본문에 놓인다. 목록으로 돌아가는 링크는 실제
// 앵커라 크롤러도 목록으로 되돌아갈 수 있다.
function OperatorPage({ operator, onUpgrade, includeFuture, listHref, onBack, operators, onRelated }: {
  operator: Operator; onUpgrade?: (operatorId: string) => void; includeFuture?: boolean;
  listHref: string; onBack: () => void; operators?: Operator[]; onRelated?: (op: Operator) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="operator-page-wrap">
      <a className="story-back" href={listHref}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault(); onBack();
        }}>← {t("오퍼 목록으로")}</a>
      <section className="operator-modal operator-page" aria-label={`${operator.name} · ${operator.code}`}
        style={{ "--accent": operator.accent } as React.CSSProperties}>
        <OperatorFile operator={operator} onUpgrade={onUpgrade} includeFuture={includeFuture} operators={operators} onRelated={onRelated} />
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
              <article key={module.id} className={`module-card${module.unreleased ? " future fut-dim" : ""}`}>
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
                  <span className="btn-icon drop-caret" aria-hidden>{shown ? "▴" : "▾"}</span>
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
// Pages 직접 서빙 (R2 아님 — 합계 ~1.5MB). relax=서기 · move=걷기 · sit=앉아 쉬기 ·
// sleep=드러누워 잠 · interact=터치 반응 · grab=잡힘·낙하(Default 직립 정지 — CSS가
// 허리축으로 기울여 대롱대롱) · sitdown/situp/liedown/wakeup=포즈 전환(Spine 믹스 렌더 —
// "서 있다가 갑자기 앉는 게 아니라 서서히", 사용자 확정 2026-08-03)
const CHIBI_CLIPS = {
  relax: "/chibi/skadi2-relax.webm",
  move: "/chibi/skadi2-move.webm",
  sit: "/chibi/skadi2-sit.webm",
  sleep: "/chibi/skadi2-sleep.webm",
  interact: "/chibi/skadi2-interact.webm",
  grab: "/chibi/skadi2-grab.webm",
  sitdown: "/chibi/skadi2-sitdown.webm",
  situp: "/chibi/skadi2-situp.webm",
  liedown: "/chibi/skadi2-liedown.webm",
  wakeup: "/chibi/skadi2-wakeup.webm",
  special: "/chibi/skadi2-special.webm",
  splat: "/chibi/skadi2-splat.webm",
  getupmad: "/chibi/skadi2-getupmad.webm",
} as const;
// 레어 이벤트 — 命途迭代/II 스킨의 기지 Special(10.7s, 붉은 드레스로 갈아입고 카드 점술 +
// 미니 치비 관객). 쿨다운 지나고 서 있는 틱의 3%로 발동, 끝나면 기본 복장으로 원복
// (사용자 확정 2026-08-03: "가끔 옷 갈아입고 점을 봐준다" 콘셉트).
const CHIBI_SPECIAL_COOLDOWN = 240_000;
const CHIBI_SPECIAL_CHANCE = 0.03;
// 전환 클립 → 끝나면 이어지는 정착 클립 (onEnded에서 전이).
// splat(철푸덕: Default→Sleep 급속 믹스)→getupmad(벌떡)→interact(짜증, 💢)는 높은 낙하 전용 체인
// (사용자 확정 2026-08-03: CSS 회전 계열 전부 반려 — 렌더 클립 버전으로 롤백).
const CHIBI_FLOW = { sitdown: "sit", situp: "relax", liedown: "sleep", wakeup: "sit", splat: "getupmad", getupmad: "interact" } as const;
const CHIBI_HARD_FALL = 320; // px — 이보다 높이 떨어지면 철푸덕

type ChibiClip = keyof typeof CHIBI_CLIPS;
const CHIBI_WALK_SPEED = 34; // px/s — Move 모션(1.67s 사이클) 보폭에 눈대중으로 맞춘 값
const CHIBI_GRAVITY = 2600; // px/s² — 낙하 가속도 (뷰포트 절반을 ~0.6초에)
// 드래그·낙하·자유 배회 (사용자 요청 2026-08-03): home=헤더 슬롯 · held=잡힘(Sit) ·
// fall=낙하 중 · free=떨어진 표면 위에서 배회. 착지면은 "발밑 x에서 아래로 훑어
// 처음 만나는 요소의 윗변" — 요소가 사라지거나 스크롤로 움직이면 다시 떨어진다.
type ChibiMode = "home" | "held" | "fall" | "free" | "climb";
const subscribeNever = () => () => {};

// 대화 액션 → 탭 라벨 (i18n 키 — 헤더 내비와 동일 사전)
const CHAT_TAB_LABEL: Record<string, string> = {
  portal: "홈", planner: "인프라 자동편성기", archive: "오퍼 백과사전", enemy: "적 도감", stage: "작전 도감", sim: "작전 시뮬레이터", recruit: "공개채용 도우미",
  farm: "재료파밍 도우미", upgrade: "오퍼 육성 시뮬", story: "스토리", rogue: "통합전략 가이드", ra: "생존연산 가이드", about: "테라 아카이브 소개",
};

function HeaderChibi({ operators, onNavigate, onShowOperator }: { operators: Operator[]; onNavigate: (tab: Tab) => void; onShowOperator: (op: Operator) => void }) {
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
  // 대화(크롬 내장 Gemini Nano) — available=바로 대화 · downloadable/downloading=설치 안내 후
  // 동의 시 다운로드 · none=클릭해도 반응 모션만 (요건 미달·타 브라우저)
  const [chatStatus, setChatStatus] = useState<ChibiChatStatus>("none");
  const [chatOpen, setChatOpen] = useState(false);
  const chatOpenRef = useRef(false);
  const xRef = useRef(0);
  const clipRef = useRef<ChibiClip>("relax");
  const videoRefs = useRef<Partial<Record<ChibiClip, HTMLVideoElement | null>>>({});
  // 드래그·낙하·자유 배회 상태 — free 좌표는 뷰포트 기준 좌상단(px)
  const [mode, setMode] = useState<ChibiMode>("home");
  const [grip, setGrip] = useState({ x: 0.49, y: 0.52 }); // 쥔 지점(상자 비율) — 대롱대롱 회전축
  const [angry, setAngry] = useState(false); // 높은 낙하 뒤 짜증(💢) — interact가 끝나면 풀린다
  const modeRef = useRef<ChibiMode>("home");
  const [free, setFree] = useState({ x: 0, y: 0 });
  const freeRef = useRef({ x: 0, y: 0 });
  // 착지면 — el을 붙들고 있다가 스크롤·리사이즈 때 rect를 따라 "탑승"한다 (el null = 뷰포트 바닥).
  // relX = 표면 왼쪽 끝에서 치비까지의 가로 오프셋 (탑승 중 가로 위치 유지용)
  const surfRef = useRef<{ top: number; left: number; right: number; el: Element | null; relX: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const grabRef = useRef<{ px: number; py: number; offX: number; offY: number; dragging: boolean } | null>(null);
  const suppressClickRef = useRef(false); // 드래그 후 이어지는 click을 무시
  const fallRafRef = useRef(0);
  const lastSpecialRef = useRef(0);

  const star = useMemo(() => operators.find((candidate) => candidate.id === CHIBI_STAR) ?? null, [operators]);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  // 마운트 직후 바로 레어 연출이 나오지 않게 — 지금부터 쿨다운 시작 (렌더 중 Date.now() 금지)
  useEffect(() => { lastSpecialRef.current = Date.now(); }, []);
  useEffect(() => () => cancelAnimationFrame(fallRafRef.current), []);
  const setFreePos = (nx: number, ny: number) => {
    freeRef.current = { x: nx, y: ny };
    setFree({ x: nx, y: ny });
  };

  // 착지면 찾기 — 발 중심 x에서 6px 간격으로 아래를 훑어, 윗변이 발보다 아래인 요소 중
  // 처음 만나는 것의 top을 돌려준다. 못 찾으면 뷰포트 바닥. (pointer-events:none인
  // 고정 창 통과 백드롭 등은 elementsFromPoint가 알아서 건너뛴다.)
  // 실제로 뭔가를 "그리는" 요소만 착지 후보 — 투명 레이아웃 래퍼의 윗변에 서면 허공에 뜬
  // 것처럼 보인다 (사용자 제보 2026-08-03). 배경·테두리·그림자·이미지류·직접 텍스트 보유만 통과.
  const paintsSomething = (el: Element) => {
    if (["IMG", "VIDEO", "CANVAS", "SVG", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return true;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.opacity) < 0.1) return false;
    if (cs.backgroundImage !== "none") return true;
    const bg = cs.backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(bg)) return true;
    if (parseFloat(cs.borderTopWidth) > 0.5) return true;
    if (cs.boxShadow && cs.boxShadow !== "none") return true;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent && n.textContent.trim()) return true;
    return false;
  };
  const findLanding = (cx: number, footY: number) => {
    const self = btnRef.current;
    const floorY = window.innerHeight - 2;
    const px = Math.max(2, Math.min(cx, window.innerWidth - 2));
    for (let sy = Math.max(footY + 2, 2); sy < floorY; sy += 6) {
      for (const el of document.elementsFromPoint(px, sy)) {
        if (self && (el === self || self.contains(el))) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 10) continue;
        if (r.top >= footY && r.top <= sy && sy - r.top <= 6 && paintsSomething(el)) {
          return { top: r.top, left: Math.max(0, r.left), right: Math.min(window.innerWidth, r.right), el };
        }
      }
    }
    return { top: floorY, left: 0, right: window.innerWidth, el: null as Element | null };
  };

  // 착지면 탑승 동기화 — 표면 요소의 rect를 따라 함께 움직인다 (스크롤 내렸다 올렸다 하면
  // 아래로만 계속 떨어지던 문제의 수정, 사용자 제보 2026-08-03). 표면이 DOM에서 사라졌거나
  // 화면 밖으로 나가면 그때 낙하한다.
  const syncSurface = () => {
    if (modeRef.current !== "free") return;
    const el0 = btnRef.current;
    const surf = surfRef.current;
    if (!el0 || !surf) return;
    const h = el0.offsetHeight;
    if (!surf.el) {
      // 뷰포트 바닥 탑승 — 리사이즈 시 바닥 높이만 따라간다
      const floorY = window.innerHeight - 2 - h;
      if (Math.abs(freeRef.current.y - floorY) > 2) setFreePos(freeRef.current.x, floorY);
      return;
    }
    if (!surf.el.isConnected) { startFall(); return; }
    const r = surf.el.getBoundingClientRect();
    if (r.width < 30 || r.height < 4 || r.top < 4 || r.top > window.innerHeight - 6) { startFall(); return; }
    if (clipRef.current === "move") {
      // 지면이 움직이면 걷기를 그 자리에서 중단 — 걷기 transition이 탑승 이동까지 끌어당긴다
      const vr = el0.getBoundingClientRect();
      freeRef.current = { ...freeRef.current, x: vr.left };
      setClip("relax");
    }
    surf.top = r.top; surf.left = r.left; surf.right = r.right;
    setFreePos(Math.max(-el0.offsetWidth * 0.4, Math.min(r.left + surf.relX, window.innerWidth - el0.offsetWidth * 0.6)), r.top - h);
  };

  // 등반 — 머리 위 30~190px에서 "실제로 그려진" 요소의 윗변(턱)을 찾는다 (없으면 null)
  const findLedge = () => {
    const el0 = btnRef.current;
    if (!el0) return null;
    const { x: fx, y: fy } = freeRef.current;
    const footY = fy + el0.offsetHeight;
    const px = Math.max(2, Math.min(fx + el0.offsetWidth / 2, window.innerWidth - 2));
    for (let sy = footY - 30; sy > Math.max(24, footY - 190); sy -= 6) {
      for (const el of document.elementsFromPoint(px, sy)) {
        if (el === el0 || el0.contains(el)) continue;
        if (surfRef.current?.el === el) continue; // 지금 밟은 표면은 제외
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 10) continue;
        if (r.top <= sy && sy - r.top <= 6 && r.top < footY - 30 && paintsSomething(el)) {
          return { top: r.top, left: Math.max(0, r.left), right: Math.min(window.innerWidth, r.right), el };
        }
      }
    }
    return null;
  };
  // 점프해 턱에 매달렸다가 기어오른다 — 반복되면 한 칸씩 꼭대기까지 (사용자 요청 2026-08-03)
  const startClimb = (ledge: { top: number; left: number; right: number; el: Element | null }) => {
    const el0 = btnRef.current;
    if (!el0) return;
    cancelAnimationFrame(fallRafRef.current);
    modeRef.current = "climb";
    setMode("climb");
    setClip("grab"); // 매달림 = 대롱대롱 포즈
    const h = el0.offsetHeight;
    const from = { ...freeRef.current };
    const hangY = ledge.top - h * 0.34; // 손이 턱에 걸리는 높이
    const standY = ledge.top - h;
    const JUMP = 260, HANG = 640, TOP = 900; // ms 경계
    const t0 = performance.now();
    const step = (now: number) => {
      const t = now - t0;
      if (t < JUMP) {
        const k = 1 - (1 - t / JUMP) ** 2; // ease-out 도약
        setFreePos(from.x, from.y + (hangY - from.y) * k);
      } else if (t < HANG) {
        setFreePos(from.x, hangY); // 매달림
      } else if (t < TOP) {
        const k = (t - HANG) / (TOP - HANG);
        setFreePos(from.x, hangY + (standY - hangY) * (k * k * (3 - 2 * k))); // 기어오름
      } else {
        setFreePos(from.x, standY);
        surfRef.current = { ...ledge, relX: from.x - ledge.left };
        modeRef.current = "free";
        setMode("free");
        setClip("relax");
        return;
      }
      fallRafRef.current = requestAnimationFrame(step);
    };
    fallRafRef.current = requestAnimationFrame(step);
  };

  // 낙하 — 등가속 rAF. 착지 지점은 놓는 순간 1회 계산 (떨어지는 동안 화면이 안 바뀐다는 전제)
  const startFall = () => {
    const el = btnRef.current;
    if (!el) return;
    cancelAnimationFrame(fallRafRef.current);
    const h = el.offsetHeight;
    const from = freeRef.current;
    const landing = findLanding(from.x + el.offsetWidth / 2, from.y + h);
    const surf = { ...landing, relX: from.x - landing.left };
    surfRef.current = surf;
    modeRef.current = "fall"; // 같은 틱 안의 판정이 스테일 모드를 읽지 않게 즉시 반영
    setMode("fall");
    setClip("grab");
    const dest = surf.top - h;
    const y0 = from.y;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = (now - t0) / 1000;
      const ny = y0 + 0.5 * CHIBI_GRAVITY * t * t;
      if (ny >= dest) {
        setFreePos(freeRef.current.x, dest);
        surf.relX = freeRef.current.x - surf.left;
        modeRef.current = "free";
        setMode("free");
        if (dest - y0 > CHIBI_HARD_FALL) {
          setClip("splat"); // 철푸덕(뻗기) → 벌떡 → 짜증 체인 (CHIBI_FLOW)
          setAngry(true);
        } else {
          setClip("relax");
        }
        return;
      }
      setFreePos(freeRef.current.x, ny);
      fallRafRef.current = requestAnimationFrame(step);
    };
    fallRafRef.current = requestAnimationFrame(step);
  };

  // 스크롤·리사이즈 → 표면 탑승 동기화 (rAF 스로틀) — 함수는 ref로 넘겨 stale 캡처를 피한다
  const syncRef = useRef<() => void>(() => {});
  useEffect(() => {
    syncRef.current = syncSurface;
  });
  useEffect(() => {
    let raf = 0;
    const onMove = () => {
      if (modeRef.current !== "free") return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => syncRef.current());
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  useEffect(() => {
    if (!isClient) return;
    let alive = true;
    void chibiChatStatus().then((status) => { if (alive && status !== "none") setChatStatus(status); });
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

  // 생활 루프 — 알파 프로브 통과 후에만. 틱(3.5~7초)마다 70% 산책, 아니면 대기 —
  // 낮잠은 두 틱 연속 가만히 있었을 때만 절반 확률로("오래 가만히 있으면 졸기").
  // 종전 7~13초 틱·55% 산책은 평균 18초 이상 한자리에 서 있었다 (사용자 제보 2026-08-03).
  useEffect(() => {
    if (alpha !== true) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    let sitTicks = 0; // 앉은 채 보낸 틱 수 — 오래 앉아 있으면 잠든다
    const tick = () => {
      const current = clipRef.current;
      const currentMode = modeRef.current;
      if (currentMode === "held" || currentMode === "fall" || currentMode === "climb") { timer = window.setTimeout(tick, 1500); return; }
      if (chatOpenRef.current) {
        // 대화 중엔 얌전히 — 자던 중이면 서서히 일어나 앉는다
        if (current === "sleep") { setClip("wakeup"); sitTicks = 0; }
        timer = window.setTimeout(tick, 4000);
        return;
      }
      if (current === "interact" || current === "special" || current in CHIBI_FLOW) { timer = window.setTimeout(tick, 1200); return; } // 반응·연출·포즈 전환 중
      if (current === "move") { timer = window.setTimeout(tick, 1200); return; } // 걷는 중 방향 홱 틀기 방지
      if (current === "sleep") {
        setClip("wakeup"); // 기상 — 서서히 일어나 앉았다가 다음 틱에서 행동 결정
        sitTicks = 0;
        timer = window.setTimeout(tick, 2500 + Math.random() * 2500);
        return;
      }
      if (currentMode === "free") {
        syncRef.current(); // 표면 재확인 — 사라졌으면 여기서 낙하가 시작된다
        if (modeRef.current !== "free") { timer = window.setTimeout(tick, 1500); return; }
        if (Math.random() < 0.3) {
          const ledge = findLedge();
          if (ledge) { startClimb(ledge); timer = window.setTimeout(tick, 1500); return; } // 위 칸으로
        }
      }
      // 앉아 있을 때 — 계속 앉거나, 오래 앉았으면 잠들거나, 일어난다.
      // 서 있다가 갑자기 드러눕는 경로는 없다 (사용자 확정 2026-08-03: 걷기→앉기→잠).
      if (current === "sit") {
        sitTicks += 1;
        if (sitTicks >= 2 && Math.random() < 0.6) setClip("liedown"); // 서서히 눕는다
        else if (Math.random() < 0.4) setClip("situp"); // 서서히 일어선다
        timer = window.setTimeout(tick, 3500 + Math.random() * 3500);
        return;
      }
      // 레어 이벤트 — 드레스로 갈아입고 카드 점술 (쿨다운 + 낮은 확률, 서 있을 때만)
      if (Date.now() - lastSpecialRef.current > CHIBI_SPECIAL_COOLDOWN && Math.random() < CHIBI_SPECIAL_CHANCE) {
        lastSpecialRef.current = Date.now();
        setClip("special");
        timer = window.setTimeout(tick, 2000);
        return;
      }
      const roll = Math.random();
      if (roll < 0.15) {
        setClip("sitdown"); // 걷다 지치면 한 번씩 서서히 앉아 쉰다
        sitTicks = 0;
        timer = window.setTimeout(tick, 3500 + Math.random() * 3500);
        return;
      }
      if (roll < 0.8) {
        if (currentMode === "free") {
          // 착지면 위 산책 — 발 중심이 표면을 벗어나지 않는 범위, 한 번에 ±130px
          const el = btnRef.current;
          const surf = surfRef.current;
          if (el && surf) {
            const w = el.offsetWidth;
            const minX = Math.max(4, surf.left - w / 2 + 10);
            const maxX = Math.min(window.innerWidth - w - 4, surf.right - w / 2 - 10);
            const cur = freeRef.current.x;
            const next = Math.max(minX, Math.min(cur + Math.round(Math.random() * 260 - 130), maxX));
            if (maxX > minX && Math.abs(next - cur) > 8) {
              setFlip(next < cur);
              setMoveSec(Math.abs(next - cur) / CHIBI_WALK_SPEED);
              setFreePos(next, freeRef.current.y);
              surf.relX = next - surf.left; // 탑승 가로 오프셋도 목적지 기준으로
              setClip("move");
            }
          }
        } else {
          const next = Math.round(Math.random() * 260 - 130); // 헤더 중앙 ±130px
          if (Math.abs(next - xRef.current) > 8) {
            setFlip(next < xRef.current); // 원본 기본 방향이 오른쪽(머리 크롭 실측) — 왼쪽 이동 시 반전
            setMoveSec(Math.abs(next - xRef.current) / CHIBI_WALK_SPEED);
            xRef.current = next;
            setX(next);
            setClip("move");
          }
        }
      }
      // 나머지 20%는 그대로 서서 쉰다 — 눕는 건 앉기를 거쳐서만
      timer = window.setTimeout(tick, 3500 + Math.random() * 3500);
    };
    timer = window.setTimeout(tick, 2000);
    return () => window.clearTimeout(timer);
  }, [alpha]); // eslint-disable-line react-hooks/exhaustive-deps -- 틱은 ref로만 상태를 읽는다

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
  // 대화 속 요청("인프라 열어줘")을 실제 기능으로 — 성공하면 연 것의 표시명을 돌려준다
  const handleChatAction = (request: ChibiActionRequest): string | null => {
    if (request.action === "operator" && request.operator) {
      const query = request.operator.trim().toLowerCase();
      if (!query) return null;
      // 자기 지칭("너 정보 보여줘") — 라우터가 self 토큰으로 주지만, 이름으로 새는 경우까지 방어.
      // "스카디" 부분일치는 원본 스카디를 먼저 잡으므로 자기 지칭 판정을 반드시 먼저 한다.
      const selfWords = ["self", "you", "your", "너", "네", "당신", "본인", "스카디 더 커럽팅 하트", "skadi the corrupting heart", "濁心スカジ"];
      const found = selfWords.includes(query)
        ? operators.find((op) => op.id === CHIBI_STAR)
        : operators.find((op) => op.name.toLowerCase() === query)
          ?? operators.find((op) => op.aliases.some((alias) => alias.toLowerCase() === query))
          ?? operators.find((op) => op.name.toLowerCase().includes(query));
      if (!found) return null;
      onShowOperator(found);
      return found.name;
    }
    const label = CHAT_TAB_LABEL[request.action];
    if (!label) return null;
    onNavigate(request.action as Tab);
    return t(label);
  };

  // 클릭 = 반응 모션(Interact) 재생 + LLM 상태에 따라 대화/설치 안내 패널 (사용자 확정 2026-08-03).
  // none(요건 미달·타 브라우저)은 모션만. 걷는 중 모션 전환은 무시(이동 transform과 겹치면 미끄러진다).
  const handleClick = () => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; } // 방금 드래그였다
    const current = clipRef.current;
    if (current !== "interact" && current !== "move" && current !== "special" && !(current in CHIBI_FLOW)) setClip("interact");
    if (chatStatus !== "none") setChatOpen(true);
  };
  // 드래그로 잡아 옮기기 — 7px을 넘게 끌면 드래그로 판정(클릭과 구분), 잡힌 동안 Sit 포즈,
  // 놓으면 낙하해 처음 만나는 요소 윗변에 착지 (사용자 요청 2026-08-03)
  const onChibiPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    grabRef.current = { px: event.clientX, py: event.clientY, offX: event.clientX - rect.left, offY: event.clientY - rect.top, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onChibiPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const grab = grabRef.current;
    if (!grab) return;
    if (!grab.dragging) {
      if (Math.hypot(event.clientX - grab.px, event.clientY - grab.py) < 7) return;
      grab.dragging = true;
      cancelAnimationFrame(fallRafRef.current);
      // 클릭한 지점을 그대로 쥔다 (사용자 확정 2026-08-03 — 예전 허리 스냅은 상자의 투명
      // 여백을 잡던 시절의 해법. 지금은 clip-path 히트박스가 몸에 맞아 필요 없다.)
      // 대롱대롱 회전축도 쥔 지점으로 — CSS 변수로 전달.
      const el0 = btnRef.current;
      if (el0) setGrip({ x: grab.offX / el0.offsetWidth, y: grab.offY / el0.offsetHeight });
      setAngry(false); // 다시 잡히면 짜증 표시는 접는다
      modeRef.current = "held";
      setMode("held");
      setClip("grab");
    }
    const el = btnRef.current;
    const w = el?.offsetWidth ?? 137;
    const h = el?.offsetHeight ?? 77;
    // 스프라이트가 상자 가운데 있으므로 좌우는 반 폭까지 삐져나가도 된다
    const nx = Math.max(-w * 0.4, Math.min(event.clientX - grab.offX, window.innerWidth - w * 0.6));
    const ny = Math.max(2, Math.min(event.clientY - grab.offY, window.innerHeight - h - 2));
    setFreePos(nx, ny);
    event.preventDefault();
  };
  const onChibiPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const grab = grabRef.current;
    grabRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!grab?.dragging) return; // 단순 클릭 — 이어지는 click 이벤트가 처리
    suppressClickRef.current = true;
    // 헤더 위에 놓으면 홈 슬롯으로 복귀 — 한 번 떨어지면 헤더로 못 돌아가던 문제
    // (사용자 제보 2026-08-03). 몸 중심이 헤더 영역 안이면 낙하 대신 제자리 걸음.
    const header = document.querySelector(".site-header");
    const el0 = btnRef.current;
    if (header && el0) {
      const hr = header.getBoundingClientRect();
      const cx = freeRef.current.x + el0.offsetWidth / 2;
      const cy = freeRef.current.y + el0.offsetHeight * 0.6;
      if (cy <= hr.bottom + 6 && cx >= hr.left && cx <= hr.right) {
        const rel = Math.max(-130, Math.min(cx - (hr.left + hr.width / 2), 130));
        xRef.current = rel;
        setX(rel);
        // 즉시 스냅 — free(뷰포트 좌표)와 home(left:50% 기준)의 좌표계가 달라, transition을
        // 걸면 화면 오른쪽 밖에서 날아드는 것처럼 보인다 (사용자 제보 2026-08-03)
        setMoveSec(0);
        surfRef.current = null;
        modeRef.current = "home";
        setMode("home");
        setClip("relax");
        return;
      }
    }
    startFall();
  };
  return (
    <>
    <button ref={btnRef} type="button"
      className={`header-chibi clip-${clip}${mode !== "home" ? " chibi-free" : ""}${mode === "held" ? " chibi-held" : ""}${mode === "climb" ? " chibi-climb" : ""}`}
      aria-hidden={alpha !== true} tabIndex={alpha === true ? 0 : -1}
      style={{ "--cx": `${x}px`, "--walk": `${moveSec}s`, "--fx": `${free.x}px`, "--fy": `${free.y}px`,
        "--grip-x": `${Math.round(grip.x * 100)}%`, "--grip-y": `${Math.round(grip.y * 100)}%` } as React.CSSProperties}
      title={t("{name} 치비 쿡 찌르기", { name: star.name })}
      aria-label={t("{name} 치비 쿡 찌르기", { name: star.name })}
      onClick={handleClick}
      onPointerDown={onChibiPointerDown} onPointerMove={onChibiPointerMove}
      onPointerUp={onChibiPointerUp} onPointerCancel={onChibiPointerUp}
      onTransitionEnd={(event) => {
        // ⚠ target 검사 필수 — 자식 video의 flip 전환(transform 0.25s)이 버블돼 걷기 시작
        // 0.25초 만에 relax로 되돌리면, 다음 틱이 move 가드를 지나쳐 "자면서 미끄러지는"
        // 상태가 됐다 (사용자 제보 2026-08-03).
        if (event.target === event.currentTarget && event.propertyName === "transform" && clipRef.current === "move") setClip("relax");
      }}>
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
        onEnded={() => { setClip("relax"); setAngry(false); }} />
      <video className={`chibi-sit${flip ? " flip" : ""}`} src={CHIBI_CLIPS.sit}
        loop muted playsInline preload="metadata" ref={(el) => { videoRefs.current.sit = el; }} />
      <video className={`chibi-grab${flip ? " flip" : ""}`} src={CHIBI_CLIPS.grab}
        loop muted playsInline preload="metadata" ref={(el) => { videoRefs.current.grab = el; }} />
      <video className={`chibi-special${flip ? " flip" : ""}`} src={CHIBI_CLIPS.special}
        muted playsInline preload="none" ref={(el) => { videoRefs.current.special = el; }}
        onEnded={() => setClip("relax")} />
      {angry && (clip === "getupmad" || clip === "interact") && <span className="chibi-anger" aria-hidden>💢</span>}
      {/* 포즈 전환 클립 — 한 번 재생하고 끝나면 정착 클립으로 */}
      {(Object.keys(CHIBI_FLOW) as (keyof typeof CHIBI_FLOW)[]).map((name) => (
        <video key={name} className={`chibi-${name}${flip ? " flip" : ""}`} src={CHIBI_CLIPS[name]}
          muted playsInline preload="metadata" ref={(el) => { videoRefs.current[name] = el; }}
          onEnded={() => setClip(CHIBI_FLOW[name])} />
      ))}
    </button>
    {chatOpen && <ChibiChatPanel status={chatStatus} onReady={() => setChatStatus("available")} onAction={handleChatAction} onClose={() => setChatOpen(false)} />}
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
// 게임 내 기록실 문서 전문(기본정보·종합검진·프로필·임상 진단·파일 자료·승진 기록)
// + 맨 앞의 고용 계약·증표 플레이버 (제안 게시판 요청 2026-08-18, build-profiles.py가 합성).
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

// ── 오퍼레이터 기록(밀록) ────────────────────────────────────────────────────
// 게임 아카이브 '기록 복원' 미니 스토리 전문 (scripts/build-records.py — AVG 스크립트를
// build-story-scripts.py 파서로 파싱). 목록만 이 섹션에 그리고, 열람은 스토리 탭의
// ScriptReader 를 창모달로 재사용한다 — story 청크는 lazy 라 기록을 열 때만 받는다.
// CN 선행 기록(f:1)은 '미래시 포함'일 때만 노출한다. 번역이 채워진 것은 tr:"cn"으로
// 표시돼 안내 문구가 바뀐다 (원문 그대로 → 비공식 AI 번역, scripts/records-cn/).
type RecordEntry = { name: string; tag: string; unlock: { t: string; p: string[] }[]; f?: 1; tr?: "cn";
  lines: ScriptData["eps"][number]["lines"]; vn?: ScriptData["eps"][number]["vn"] };
type RecordDoc = { id: string; recs: RecordEntry[]; faces?: Record<string, string> };
const recordIds = new Set(recordIdsData as string[]);
const recordCache = new Map<string, RecordDoc | null>();
const StoryScriptReader = lazy(() => import("./story").then((m) => ({ default: m.ScriptReader })));

function RecordSection({ operator, operators, onRelated }: {
  operator: Operator; operators?: Operator[]; onRelated?: (op: Operator) => void;
}) {
  const { locale, t } = useI18n();
  const key = `${locale}/${operator.id}`;
  const known = recordIds.has(operator.id);
  const [doc, setDoc] = useState<RecordDoc | null | undefined>(() => (known ? recordCache.get(key) : null));
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!known || recordCache.has(key)) { if (recordCache.has(key)) setDoc(recordCache.get(key)); return; }
    let alive = true;
    fetch(asset(`/records/${locale}/${operator.id}.json`))
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data: RecordDoc | null) => {
        recordCache.set(key, data);
        if (alive) setDoc(data);
      });
    return () => { alive = false; };
  }, [known, key, locale, operator.id]);

  // 화자 이름 → 오퍼 아바타·상세 연결 (스토리 탭의 storyOpIndex 와 같은 규칙)
  const opIndex = useMemo<OpIndex>(() => {
    const m: OpIndex = {};
    for (const o of operators ?? []) m[o.name] = { op: o.id, desc: `${o.rarity}성 ${o.job} 오퍼레이터` };
    return m;
  }, [operators]);

  // CN 선행 기록(f:1)도 항상 목록에 둔다 — 흑백 + 미실장 배지로 구분한다 (2026-09-04 규칙 변경)
  const shown = doc?.recs ?? [];
  const open = openIdx != null ? shown[openIdx] : null;
  // ScriptReader 는 eps 배열을 받는다 — 기록 하나를 단일 에피소드로 감싼다 (탭 없이 본문만)
  const script = useMemo<ScriptData | null>(() => (open && doc
    ? { id: `${operator.id}-rec`,
        // vn — 무대 연출 트랙이 있으면 '장면' 보기 버튼이 뜬다 (build-records.py + build-story-vn.py --records)
        eps: [{ code: "", name: open.name, tag: open.tag, lines: open.lines, ...(open.vn ? { vn: open.vn } : {}) }],
        faces: doc.faces }
    : null), [open, doc, operator.id]);
  const showOp = onRelated && operators
    ? (id: string) => { const target = operators.find((o) => o.id === id); if (target) { setOpenIdx(null); onRelated(target); } }
    : undefined;

  const unlockChips = (rec: RecordEntry) => rec.unlock.map((u) => (
    u.t === "FAVOR" ? t("신뢰도 {n}", { n: u.p[0] ?? "?" })
      // AWAKE p = [정예화 단계, 레벨]. 레벨 1은 "정예화 N 도달"과 같은 말이라 생략
      : u.t === "AWAKE" ? (u.p[1] && u.p[1] !== "1"
        ? t("정예화 {p} Lv.{n}", { p: u.p[0] ?? "?", n: u.p[1] })
        : t("정예화 {n}", { n: u.p[0] ?? "?" }))
      : t("추가 해금")));

  return (
    <section className="detail-section" id="op-record">
      <span className="detail-no">RECORD / 10</span>
      <h3>{t("오퍼레이터 기록")}</h3>
      {known && doc === undefined ? (
        <p className="no-detail">{t("불러오는 중…")}</p>
      ) : shown.length === 0 ? (
        <p className="no-detail">{t("등록된 기록이 없습니다.")}</p>
      ) : (
        <div className="rec-list">
          {shown.map((rec, index) => (
            <button key={index} type="button" className={`rec-item${rec.f ? " fut-dim" : ""}`} onClick={() => setOpenIdx(index)}>
              <b>{rec.name}{rec.f ? <em className="future-badge">{t("미실장")}</em> : null}</b>
              {rec.tag && <span className="rec-tag">{rec.tag}</span>}
              <span className="rec-chips">{unlockChips(rec).map((chip, i) => <i key={i}>{chip}</i>)}</span>
            </button>
          ))}
        </div>
      )}
      {open && script && (
        <ModalWindow label={open.name} className="op-record-modal" onClose={() => setOpenIdx(null)}>
          {open.f ? <p className="future-note">{open.tr === "cn"
            ? t("중국 서버 선행 기록입니다 — 중국어 원문을 AI가 번역한 비공식 텍스트라 정식 출시 시 공식 번역과 다를 수 있습니다.")
            : t("중국 서버 선행 기록입니다 — 아직 한국어 번역 전이라 중국어 원문으로 표시됩니다.")}</p> : null}
          <Suspense fallback={<p className="no-detail">{t("불러오는 중…")}</p>}>
            {/* withPrefs — 스토리 탭과 같은 읽기 설정(글자·삽화 크기)을 기록 모달에도
                붙인다 (사용자 요청 2026-09-04). 설정값은 스토리 리더와 공유된다.
                withScene — 연출 트랙이 있는 기록은 스토리 리더기(무대 재생)로도 볼 수 있다. */}
            <StoryScriptReader key={openIdx} script={script} error={false} entities={[]}
              opIndex={opIndex} onShowOperator={showOp} withPrefs withScene />
          </Suspense>
        </ModalWindow>
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
      <span className="detail-no">VOICE / 11</span>
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
              <span className="btn-icon drop-caret" aria-hidden>{all ? "▴" : "▾"}</span>
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
                  // 이름표(<i>)가 첫 줄 앞에 붙어야 해서 여기선 <br>로 나눈다
                  <p key={i}><i>{talent.name}</i>{descLines(talent.description).map((line, at) => (
                    <span key={at}>{at > 0 && <br />}{line}</span>
                  ))}</p>
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
