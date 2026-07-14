"use client";

// 3개 탭(백과사전·플래너·공채)의 공용 루트. 로케일별 라우트(/ /en /ja)가
// home-ko/en/ja.tsx 래퍼로 해당 언어의 operators 데이터를 정적 import해 넘긴다 —
// 런타임 언어 전환은 전체 내비게이션이라 이 컴포넌트 안에서 로케일은 불변이다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import broadcastsData from "./data/broadcasts.json";
import InfraPlanner from "./planner";
import RecruitHelper from "./recruit";
import FarmGuide from "./farm";
import StoryGuide from "./story";
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
};

const SYNERGY_POTS = ["해산물팟", "쉐이팟", "쉐라그팟", "카시미어팟", "미노스팟", "아베무팟", "연소팟", "라테라노팟", "탄약팟", "라인랩팟", "라이오스 파티"];

// 직군 표시 순서의 정본은 jobCode — 표시명은 로케일 데이터에서 뽑는다
const JOB_ORDER = ["PIONEER", "WARRIOR", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"];

const SORT_KEYS = ["기본", "이름", "성급", "소속", "출신지", "종족", "직군", "세부 직군"];

function tabFromHash(hash: string): "archive" | "planner" | "recruit" | "farm" | "story" {
  return hash === "#infra" ? "planner" : hash === "#recruit" ? "recruit" : hash === "#farm" ? "farm" : hash.startsWith("#story") ? "story" : "archive";
}

// ── 공식 방송 ─────────────────────────────────────────────
// 방송 목록은 크론 워커(workers/broadcast — 6시간마다 유튜브 공식 채널 3개를 수집)에서
// 가져오고, 네트워크 실패 시 broadcasts.json 정적 데이터로 폴백한다. 현재 시각과 비교해
// 예약/생방송/지난방송을 분류하며, 헤더엔 요약 버튼 하나만 두고 클릭하면 전체 목록
// (유튜브 썸네일 포함) 모달을 연다. 지난 방송도 날짜와 함께 계속 남긴다.
const BCAST_API = "https://terra-archive-broadcast.nzkonaru.workers.dev/";
type Broadcast = { server: string; title: string; start: string; durationMin?: number; url?: string; videoId?: string };
type BState = "live" | "upcoming" | "past";

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
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    fetch(BCAST_API)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (Array.isArray(data?.broadcasts)) setRemote(data.broadcasts); })
      .catch(() => { /* 워커 불통이면 정적 broadcasts.json만 사용 */ });
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (now == null) return null;
  const statics = (broadcastsData.broadcasts as Broadcast[]).filter((b) => !Number.isNaN(Date.parse(b.start)));
  const seen = new Set((remote ?? []).map(bcastKey));
  const all = [
    ...(remote ?? []).filter((b) => !Number.isNaN(Date.parse(b.start))),
    ...statics.filter((b) => !seen.has(bcastKey(b))),
  ];
  if (all.length === 0) return null;
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
  const switchTo = (code: Locale, path: string) => {
    try { localStorage.setItem("ta-locale", code); } catch { /* ignore */ }
    if (code !== locale) window.location.assign(path + window.location.hash);
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
              onClick={() => switchTo(entry.code, entry.path)}>
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

export default function Home({ locale, operators, extra }: { locale: Locale; operators: Operator[]; extra: ExtraI18n | null }) {
  return (
    <I18nProvider locale={locale}>
      <HomeInner operators={operators} extra={extra} />
    </I18nProvider>
  );
}

function HomeInner({ operators, extra }: { operators: Operator[]; extra: ExtraI18n | null }) {
  const { locale, t } = useI18n();
  const [selectedFactions, setSelectedFactions] = useState<string[]>([]);
  const [selectedConcepts, setSelectedConcepts] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [selectedSubProfessions, setSelectedSubProfessions] = useState<string[]>([]);
  const [selected, setSelected] = useState<Operator | null>(null);
  // 서버 렌더는 해시를 모르므로 항상 "archive"로 시작 — hydration 직후
  // useLayoutEffect가 페인트 전에 동기적으로 올바른 탭으로 맞춘다 (깜빡임 방지 +
  // hydration mismatch 방지, useState 초기값에서 window.location.hash를
  // 직접 읽으면 서버/클라이언트 첫 렌더가 갈려서 hydration 에러가 난다)
  const [tab, setTab] = useState<"archive" | "planner" | "recruit" | "farm" | "story">("archive");

  // 필터 항목은 전부 현재 로케일 데이터에서 유도한다 — 값과 표시가 항상 일치
  const factions = useMemo(() =>
    Array.from(new Set(operators.flatMap((operator) => operator.factions))).sort((a, b) => a.localeCompare(b, locale)),
    [operators, locale]);
  const concepts = useMemo(() => {
    const counts = new Map<string, number>();
    operators.forEach((operator) => operator.concepts.forEach((concept) => counts.set(concept, (counts.get(concept) ?? 0) + 1)));
    return [
      ...SYNERGY_POTS.filter((pot) => counts.has(pot)),
      ...Array.from(counts.keys()).filter((concept) => !SYNERGY_POTS.includes(concept)).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)),
    ];
  }, [operators]);
  const combatTags = useMemo(() =>
    // 데이터에 빈 문자열 태그가 섞여 들어온 사례(예비 오퍼레이터·하디야)가 있어 걸러낸다
    Array.from(new Set(operators.flatMap((operator) => operator.combatTags))).filter((tag) => tag.trim().length > 0).sort((a, b) => a.localeCompare(b, locale)),
    [operators, locale]);
  const jobs = useMemo(() => {
    const byCode = new Map<string, string>();
    operators.forEach((operator) => { if (!byCode.has(operator.jobCode)) byCode.set(operator.jobCode, operator.job); });
    return JOB_ORDER.map((code) => byCode.get(code)).filter((job): job is string => Boolean(job));
  }, [operators]);
  const subProfessions = useMemo(() =>
    Array.from(new Set(operators.map((operator) => operator.subProfession))).sort((a, b) => a.localeCompare(b, locale)),
    [operators, locale]);
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
    // 첫 페인트 플래시 방지용 data-route는 이제 React가 탭을 제어하므로 해제한다
    // (남겨두면 클라이언트에서 백과사전 탭으로 이동해도 CSS가 계속 숨겨버린다)
    document.documentElement.removeAttribute("data-route");
    const applyHash = () => {
      const hash = decodeURIComponent(window.location.hash);
      if (hash.startsWith("#op-")) {
        setTab("archive");
        const operator = operators.find((candidate) => candidate.id === hash.slice(4));
        if (operator) setSelected(operator);
        return;
      }
      // op 해시가 아니면 열려 있던 모달을 닫는다 (뒤로가기로 닫기)
      pushedModalRef.current = false;
      setSelected(null);
      setTab(tabFromHash(hash));
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    window.addEventListener("popstate", applyHash);
    return () => {
      window.removeEventListener("hashchange", applyHash);
      window.removeEventListener("popstate", applyHash);
    };
    // operators는 라우트 수명 동안 불변 (로케일 전환 = 전체 내비게이션)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 탭·오퍼 모달에 맞춰 문서 제목 갱신 — 검색엔진 렌더링·북마크·공유 미리보기에 반영
  useEffect(() => {
    document.title = selected
      ? t("{name} - 명일방주 오퍼레이터 | 테라 아카이브", { name: selected.name })
      : tab === "planner"
        ? t("인프라 플래너 - 명일방주 기반시설 편성 | 테라 아카이브")
        : tab === "recruit"
          ? t("공채 도우미 - 명일방주 공개모집 계산기 | 테라 아카이브")
          : tab === "farm"
            ? t("재료 파밍 효율표 - 명일방주 파밍 가이드 | 테라 아카이브")
            : tab === "story"
              ? t("AI 이벤트 스토리 요약 - 명일방주 이벤트 스토리 요약 | 테라 아카이브")
              : t("테라 아카이브 | 명일방주(Arknights) KR 팬사이트");
  }, [tab, selected, t]);

  const openOperator = (operator: Operator) => {
    setSelected(operator);
    history.pushState(null, "", `#op-${operator.id}`);
    pushedModalRef.current = true;
  };
  const closeOperator = () => {
    if (pushedModalRef.current) {
      pushedModalRef.current = false;
      history.back(); // popstate → applyHash가 모달을 닫고 이전 해시 복원
      return;
    }
    setSelected(null);
    history.replaceState(null, "", tab === "planner" ? "#infra" : tab === "recruit" ? "#recruit" : tab === "farm" ? "#farm" : tab === "story" ? "#story" : window.location.pathname);
  };
  // 플래너 등 다른 탭 위에서 모달만 띄울 때 — URL은 그대로 두고 히스토리만 한 칸 쌓는다
  const showOperatorById = (id: string) => {
    const operator = operators.find((candidate) => candidate.id === id);
    if (!operator) return;
    setSelected(operator);
    history.pushState(null, "", window.location.href);
    pushedModalRef.current = true;
  };

  const switchTab = (next: "archive" | "planner" | "recruit" | "farm" | "story") => {
    setTab(next);
    setSelected(null);
    if (next === "planner") window.location.hash = "infra";
    else if (next === "recruit") window.location.hash = "recruit";
    else if (next === "farm") window.location.hash = "farm";
    else if (next === "story") window.location.hash = "story";
    else history.replaceState(null, "", window.location.pathname);
  };
  const [sortKey, setSortKey] = useState("기본");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOperator();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selected]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return operators.filter((operator) => {
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
      const matchesQuery = !keyword || [operator.name, operator.code, operator.job, operator.subProfession, operator.position, ...operator.combatTags, ...operator.factions, operator.reason, ...operator.aliases, ...communityNicknames, ...operator.concepts, ...conceptNames].join(" ").toLowerCase().includes(keyword);
      return matchesFaction && matchesConcept && matchesMethod && matchesTags && matchesJob && matchesSubProfession && matchesQuery;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operators, selectedFactions, selectedConcepts, selectedMethods, tags, selectedJobs, selectedSubProfessions, query, nicknames, locale]);

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
    <main className={tab !== "archive" ? "base-main" : ""}>
      <header className="site-header" id="top">
        <a className="brand" href="#top" aria-label={t("테라 아카이브 홈")}>
          <span className="brand-mark">TA</span>
          <span>{t("테라 아카이브")}<small>{t("명일방주(Arknights) KR 팬사이트")}</small></span>
        </a>
        <BroadcastBadges />
        <nav className="main-tabs" aria-label={t("주요 탭")}>
          <button className={`tab-archive${tab === "archive" ? " selected" : ""}`} onClick={() => switchTab("archive")}><span className="tab-icon" aria-hidden>▤</span>{t("오퍼 백과사전")}</button>
          <button className={`tab-planner${tab === "planner" ? " selected" : ""}`} onClick={() => switchTab("planner")}><span className="tab-icon" aria-hidden>⌂</span>{t("인프라 플래너")}</button>
          <button className={`tab-recruit${tab === "recruit" ? " selected" : ""}`} onClick={() => switchTab("recruit")}><span className="tab-icon" aria-hidden>◎</span>{t("공채 도우미")}</button>
          <button className={`tab-farm${tab === "farm" ? " selected" : ""}`} onClick={() => switchTab("farm")}><span className="tab-icon" aria-hidden>◈</span>{t("재료 파밍")}</button>
          <button className={`tab-story${tab === "story" ? " selected" : ""}`} onClick={() => switchTab("story")}><span className="tab-icon" aria-hidden>✦</span>{t("AI 이벤트 스토리 요약")}</button>
        </nav>
        <LanguageSwitcher />
      </header>

      {tab === "archive" && <section className="explorer" aria-labelledby="explorer-title">
        <div className="filter-panel">
          <div className="panel-heading">
            <div><span className="section-no">FILTER / 01</span><h2 id="explorer-title">{t("탐색 조건")}</h2></div>
            <button className="reset" onClick={reset}>↻ {t("초기화")}</button>
          </div>
          <label className="search-label" htmlFor="operator-search">{t("오퍼레이터 검색")}</label>
          <div className="search-wrap"><span>⌕</span><input id="operator-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("이름, 별명, 직군, 효과 검색")} /></div>

          <FilterGroup title={t("컨셉덱")} items={concepts} labelFor={(item) => conceptName(locale, item)} selected={selectedConcepts} onToggle={toggleIn(setSelectedConcepts)} rows={2} countForItem={(item) => operators.filter((operator) => operator.concepts.includes(item)).length} />
          <FilterGroup title={t("직군")} items={jobs} selected={selectedJobs} onToggle={toggleIn(setSelectedJobs)} countForItem={(item) => operators.filter((operator) => operator.job === item).length} />
          <FilterGroup title={t("세부 직군")} items={subProfessions} selected={selectedSubProfessions} onToggle={toggleIn(setSelectedSubProfessions)} countForItem={(item) => operators.filter((operator) => operator.subProfession === item).length} />
          <FilterGroup title={t("전투 태그")} items={combatTags} selected={tags} onToggle={toggleTag} countForItem={(item) => operators.filter((operator) => operator.combatTags.includes(item)).length} />
          <FilterGroup title={t("공격 방식")} items={attackMethods} selected={selectedMethods} onToggle={toggleIn(setSelectedMethods)} countForItem={(item) => operators.filter((operator) => positionMethods.includes(item) ? operator.position === item : damageTypeOf(operator) === item).length} />
          <FilterGroup title={t("공식 소속")} items={factions} selected={selectedFactions} onToggle={toggleIn(setSelectedFactions)} countForItem={(item) => operators.filter((operator) => operator.factions.includes(item)).length} />

          <aside className="data-note"><span>DATA NOTE</span><p>{t("한국 서버 {count}명 · 전원 이미지 · 다국어 이름 및 커뮤니티 별명 검색 · 스킬과 재능 기반 {concepts}개 컨셉 태그를 제공합니다. 모든 필터는 토글식이며 아무것도 선택하지 않으면 전체가 표시됩니다.", { count: operators.length, concepts: concepts.length })}</p></aside>
        </div>

        <div className="results">
          <div className="results-heading">
            <div><span className="section-no">RESULT / 02</span><h2>{selectedConcepts.length === 1 ? t("{concept} 컨셉덱", { concept: conceptName(locale, selectedConcepts[0]) }) : selectedFactions.length === 1 ? selectedFactions[0] : hasActiveFilter ? t("탐색 결과") : t("전체 오퍼레이터")}</h2></div>
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

      {tab === "planner" && <InfraPlanner onShowOperator={showOperatorById} extra={extra} />}
      {tab === "recruit" && <RecruitHelper onShowOperator={showOperatorById} extra={extra} />}
      {tab === "farm" && <FarmGuide />}
      {tab === "story" && <StoryGuide onShowOperator={showOperatorById} />}

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
          <div className="portrait-meta"><span>{"★".repeat(operator.rarity)}</span><b>{operator.job}</b></div>
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
              <div className="modal-rarity">{"★".repeat(operator.rarity)} <span>{t("{n}성", { n: operator.rarity })}</span></div>
              <div className="class-line">
                <div><b>{operator.job}</b><small>{operator.subProfession} · {operator.position}</small></div>
              </div>
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
