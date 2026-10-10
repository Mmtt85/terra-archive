"use client";

// 어드민 '방문' 탭 — 방문 동선 기록(docs/supabase-visits.sql · app/visit-track.ts)을 그래프로
// (사용자 요청 2026-10-04 "통계는 어드민 페이지에서 그래프화 시켜서"). 차트는 라이브러리 없이 SVG·CSS 로
// 직접 그린다(사용자 확정 — 의존성을 늘리지 않는다).
//
// 데이터는 같은 오리진 `/api/visits/rpc/<함수>` — 실서비스는 admin-api 워커, localhost 는 dev 프록시가
// 관리자 키를 붙여 방문 기록 전용 Supabase 프로젝트로 중계한다. 프로젝트가 아직 없으면 503 → 안내만 띄운다.
// 기간 7·30·90일은 원장에서, '1년'은 매일 밤 말아 둔 일별 집계표에서 읽는다. 원장은 기간으로 자르지 않고
// DB 가 80% 차면 오래된 것부터 지운다(docs/supabase-visits.sql visits_maintain).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dropdown } from "../dropdown";
import { ACCOUNT_SERVERS } from "../account";
import { ModalWindow } from "../modal-window";
import { VisitsReport } from "./visits-report";
import operatorsData from "../data/operators.json";
import storiesData from "../data/stories.json";

type Kv = { k: string | null; n: number };
type FlowRow = { step: number; src: string; dst: string; n: number };
type Bucket = { t: number; sessions: number; visitors: number; views: number };
export type Summary = {
  /** visible_ms·med_* = 머문 시간(탭이 화면에 떠 있던 시간, 화면당 1시간 상한) — 2026-10-07~ DB 함수 */
  total: { sessions: number; visitors: number; views: number; active_ms: number; revisit: number; bounce: number; bots: number;
    /** 기간 안 세션 종류별 수 (고른 종류와 무관) — 2026-10-08~ DB 함수 */
    kinds?: { human: number; skim: number; bot: number };
    visible_ms?: number; med_active?: number; med_visible?: number; med_views?: number };
  days: { day: string; sessions: number; visitors: number; views: number; active_ms: number }[];
  src: { src: string; sessions: number; views: number; active_ms: number; visible_ms?: number; med_active?: number; med_visible?: number }[];
  ref: { ref: string; sessions: number }[];
  landing: { path: string; sessions: number; bounces: number }[];
  pages: { path: string; views: number; sessions: number; avg_active: number; med_active: number; avg_visible?: number; med_visible?: number; exits: number; scroll: number | null }[];
  sections: { section: string; views: number; avg_active: number; avg_visible?: number; med_active?: number; med_visible?: number; exits: number }[];
  hours: [number, number, number][];
  /** 오늘 보기 전용 — 시작 시각(KST)의 시별 (옛 DB 함수엔 없다) */
  hourly?: { hr: number; sessions: number; visitors: number; views: number }[];
  /** 15분 칸 — q = 시×4 + 분÷15. 옛 DB 함수엔 없다(그땐 hourly 로 물러선다) */
  quarter?: { q: number; sessions: number; visitors: number; views: number }[];
  /** 시각 칸 15·30·60분 — t = 칸 시작 epoch 초 (2026-10-08~ DB 함수). 기간이 48시간 이하일 때만 채운다 */
  b15?: Bucket[]; b30?: Bucket[]; b60?: Bucket[];
  device: Kv[]; site_lang: Kv[]; tz: Kv[];
  out: { host: string; n: number }[];
  flow: FlowRow[];
  /** '내 정보' 로그인·다시 동기화 기록 (2026-10-05~ DB 함수) — 누가 = 익명 방문자 id */
  me_sync?: {
    n: number; people: number; login: number; sync: number;
    /** src·ref = 이 기간 첫 로그인(없으면 첫 동기화) 세션의 유입 (2026-10-05~) */
    by: { visitor: string | null; n: number; login: number; sync: number; last: string; server: string | null; src?: string | null; ref?: string | null }[];
    recent: { at: string; visitor: string | null; kind: string; server: string | null; src?: string | null; ref?: string | null }[];
  };
};
type TrendRow = { day: string; sessions: number; human_sessions: number; visitors: number; new_visitors: number; views: number; active_ms: number };
type SessView = { path: string; hash: string | null; t0: number | null; vis: number; act: number; scroll: number | null; out: string | null };
type SessRow = {
  id: string; at: string; src: string; ref: string | null; landing: string; device: string | null; site_lang: string | null;
  tz: string | null; revisit: boolean | null; human: boolean; kind?: "human" | "skim" | "bot"; utm: string | null; views: SessView[];
  /** 마지막으로 받은 시각 (DB visits_sessions_range — 옛 함수면 없다) */
  last_at?: string | null;
};

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  let res = await fetch(`/api/visits/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  // 옛 DB 함수(p_kinds 모름, 2026-10-08 전)면 사람/봇 둘로 물러선다 — 훑고 간 사람은 사람 쪽에 섞인다
  if (!res.ok && res.status !== 503 && Array.isArray(args.p_kinds)) {
    const k = args.p_kinds as string[];
    const { p_kinds: _drop, ...rest } = args;
    void _drop;
    const p_human = k.includes("bot") ? (k.length === 1 ? false : null) : true;
    res = await fetch(`/api/visits/rpc/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...rest, p_human }) });
  }
  if (res.status === 503) throw new Error("not-configured");
  if (!res.ok) throw new Error(`${name} 조회 실패 (${res.status})`);
  return res.json() as Promise<T>;
}

// ── 이름표 ─────────────────────────────────────────────────────────────────────

const OP_NAME = new Map((operatorsData as { id: string; name: string }[]).map((o) => [o.id, o.name]));
// 작전·적 상세 주소의 이름 — 작전 데이터(1.5MB)는 관리자 화면을 열 때 뒤늦게 받아 채운다 (loadDexNames)
const STAGE_NAME = new Map<string, string>();
const ENEMY_NAME = new Map<string, string>();
const ITEM_NAME = new Map<string, string>();
let dexNames: Promise<void> | null = null;
function loadDexNames(): Promise<void> {
  dexNames ??= import("../data/stages.json").then((m) => {
    const doc = m.default as unknown as { stages: { id: string; code: string; name: string }[]; enemyNames: Record<string, string> };
    for (const st of doc.stages) STAGE_NAME.set(st.id, st.code && st.code !== st.name ? `${st.code} ${st.name}` : st.name);
    for (const [k, v] of Object.entries(doc.enemyNames ?? {})) ENEMY_NAME.set(k, v);
  }).then(() => Promise.all([
    // 작전에 안 나오는 적(통합전략·생존연산 전용 등)은 적 이름표에서 — enemy-names.json {ids, ko}
    import("../data/enemy-names.json").then((m) => {
      const e = m.default as unknown as { ids: string[]; ko: string[] };
      e.ids.forEach((id, i) => { if (!ENEMY_NAME.has(id) && e.ko[i]) ENEMY_NAME.set(id, e.ko[i]); });
    }),
    import("../data/items.json").then((m) => {
      for (const it of (m.default as unknown as { items: { id: string; n: string }[] }).items) ITEM_NAME.set(it.id, it.n);
    }),
  ])).then(() => undefined).catch(() => { dexNames = null; });
  return dexNames;
}
const STORY_NAME = new Map((storiesData as unknown as { events: { id: string; name: { ko: string } }[] }).events.map((e) => [e.id, e.name.ko]));
export const SECTION_KO: Record<string, string> = {
  홈: "홈", operators: "오퍼레이터", stories: "스토리", enemies: "적 도감", stages: "작전", events: "이벤트",
  infra: "인프라", recruit: "공채", farm: "파밍", upgrade: "육성", items: "아이템", rogue: "통합전략",
  ra: "생존연산", autochess: "위수 협의", gallery: "갤러리", sim: "시뮬레이터", about: "소개", me: "내 정보",
};
const DEVICE_KO: Record<string, string> = { mobile: "폰", tablet: "태블릿", desktop: "PC" };
// 사이트 언어 이름표 (사용자 지시 2026-10-08) — 유입원·시간대는 원래 값 그대로 둔다(사용자 지시).
// 시간대는 실제로 들어온 값(2026-09~10, 70여 개)을 다 적었고, 모르는 것은 대륙 이름 + 도시로 물러선다
const LANG_KO: Record<string, string> = { ko: "한국어", en: "영어", ja: "일본어" };
// 통합전략은 몇 번 테마인지가 제일 중요하다 (사용자 지시 2026-10-04) — 맨 /rogue 는 1번 테마가 열린다.
// 별명은 커뮤니티 호칭(omni.ts TOPIC_NICKS 첫 낱말), 화면 이름은 rogue.tsx viewsFor 와 같다.
const ROGUE_NICK = ["팬텀", "미즈키", "사미", "살카즈", "쉐이", "블랙플로우"];
const ROGUE_VIEW_KO: Record<string, string> = { map: "맵·노드", enemy: "적 도감", relic: "소장품", archive: "전시관", diff: "난이도", ending: "엔딩" };
function rogueLabel(slug: string): string {
  const n = Number(/^is(\d)$/.exec(slug || "is1")?.[1]);
  return n ? `통합전략 ${n} · ${ROGUE_NICK[n - 1] ?? ""}` : `통합전략 · ${slug}`;
}

// 해시(탭·모달) 이름 — 영어 해시 그대로 두지 않는다 (사용자 지시 2026-10-06 "이런애들도 다 한국어로")
const ROOM_KO: Record<string, string> = {
  CONTROL: "제어 센터", MANUFACTURE: "제조소", TRADING: "무역소", POWER: "발전소", DORMITORY: "숙소", DORM: "숙소",
  MEETING: "응접실", HIRE: "사무실", WORKSHOP: "가공소", TRAINING: "훈련실",
};
const RA_VIEW_KO: Record<string, string> = {
  food: "요리·음료", craft: "제작·설치물", stage: "지역", enemy: "적 도감", weather: "날씨", event: "조우", rift: "균열·원정", tech: "테크트리",
  v3item: "아이템", v3craft: "가공·건설", v3map: "전투 지형", v3enemy: "적 도감", v3stage: "시나리오", v3weather: "날씨", v3event: "조우",
};
const AC_VIEW_KO: Record<string, string> = {
  bond: "맹약", band: "전략", op: "오퍼레이터", item: "아이템", misc: "게임 정보",
  enemy: "적", map: "전투 맵", hunt: "수배·특훈", mode: "모드", supply: "보급센터", buff: "전략 전술",
};
/** 갈래 묶음의 해시 종류(문자만) → 이름. 흐름도·갈래 목록용 */
const HASH_KIND_KO: Record<string, string> = {
  changelog: "업데이트 내역", help: "도움말", verify: "정품 인증", room: "방 상세", roster: "보유 오퍼 설정",
  flows: "생산 흐름", ep: "에피소드", scene: "리더기", script: "전문", summary: "AI 요약", theme: "테마별", kind: "분류별",
  release: "출시순", chronicle: "연대기", story: "스토리", sprite: "스탠딩", illust: "일러스트", op: "오퍼 상세",
  en: "적 상세", st: "작전 상세", it: "아이템 상세", item: "아이템", ev: "이벤트 상세", ra: "탭", bond: "맹약", band: "전략",
  misc: "게임 정보", prts: "PRTS 연결 도움말", replay: "리플레이", lore: "이벤트 기록", top: "맨 위",
};
const STORY_VIEW_KO: Record<string, string> = { summary: "AI 요약", scene: "리더기", script: "전문", lore: "이벤트 기록" };
function hashLabel(head: string, hash: string): string {
  const h = decodeURIComponent(hash).replace(/^#/, "");
  let m: RegExpExecArray | null;
  if (h === "changelog") return "업데이트 내역";
  if (h === "help") return "도움말";
  if (h === "prts-help") return "PRTS 연결 도움말";
  if (h.startsWith("verify=")) return "정품 인증";
  if ((m = /^op-(char_\w+)/.exec(h))) return `오퍼 · ${OP_NAME.get(m[1]) ?? m[1]}`;
  if ((m = /^en-(enemy_\w+)/.exec(h))) return `적 · ${ENEMY_NAME.get(m[1]) ?? m[1]}`;
  if ((m = /^st-(.+)$/.exec(h))) return `작전 · ${STAGE_NAME.get(m[1]) ?? m[1]}`;
  if ((m = /^(?:it|item)-(.+)$/.exec(h))) return `아이템 · ${ITEM_NAME.get(m[1]) ?? m[1]}`;
  if ((m = /^ev-(.+)$/.exec(h))) return `이벤트 · ${STORY_NAME.get(m[1]) ?? m[1]}`;
  // 스토리 뒤 보기 이름(/ep3 · /summary · /scene · /script · /lore)도 한국어로 (사용자 지적 2026-10-08 "#story-act33side/summary")
  if ((m = /^story-([^/]+)(?:\/(.+))?$/.exec(h))) {
    const tail = (m[2] ?? "").split("/").filter(Boolean).map((p) => /^ep(\d+)$/.exec(p)?.[1] ? `${Number(p.slice(2))}화` : STORY_VIEW_KO[p] ?? p).join(" · ");
    return `스토리 · ${STORY_NAME.get(m[1]) ?? m[1]}${tail ? ` · ${tail}` : ""}`;
  }
  // 방 하나뿐인 곳(제어 센터·응접실·사무실·가공소·훈련실)은 번호가 없다 — 종전엔 '#room-CONTROL' 이 영어로 남았다 (2026-10-08)
  if ((m = /^room-([A-Z]+)(?:-(\d+))?$/.exec(h))) return `방 · ${ROOM_KO[m[1]] ?? m[1]}${m[2] != null ? ` ${Number(m[2]) + 1}` : ""}`;
  if ((m = /^ep(\d+)$/.exec(h))) return `${m[1]}화`;
  if ((m = /^theme-(.+)$/.exec(h))) return `테마 · ${m[1] === "mainLine" ? "메인 라인" : m[1]}`;
  if ((m = /^ra-(sandbox_[\w]+)$/.exec(h))) return `지역 상세 · ${m[1]}`;
  if ((m = /^ra-(.+)$/.exec(h))) return RA_VIEW_KO[m[1]] ?? m[1];
  if (head === "autochess") {
    const [v, sub] = h.split("?")[0].split("/");
    return [AC_VIEW_KO[v] ?? v, sub ? AC_VIEW_KO[sub] ?? sub : ""].filter(Boolean).join(" · ");
  }
  if (h === "roster-import") return "보유 오퍼 가져오기";
  return HASH_KIND_KO[h] ?? `#${h}`;
}
function sectionLabel(s: string): string {
  const [head, hash] = s.split(" #");
  if (head.startsWith("rogue/")) return rogueLabel(head.slice(6)) + (hash ? ` · ${ROGUE_VIEW_KO[hash] ?? hash}` : "");
  const kind = hash ? (head === "autochess" ? AC_VIEW_KO[hash] : head === "ra" ? null : HASH_KIND_KO[hash]) ?? hash : null;
  return (SECTION_KO[head] ?? head) + (kind ? ` · ${kind}` : "");
}
export function pathLabel(path: string, hash?: string | null): string {
  const p = path.replace(/^\/(en|ja)(?=\/|$)/, "") || "/";
  const [, head = "", id = ""] = p.split("/");
  const key = decodeURIComponent(id);
  if (head === "rogue") {
    const m = hash && /^#rg-([a-z]+)(?:~[a-z]+~(.+))?$/.exec(hash);
    const tail = m ? ` · ${ROGUE_VIEW_KO[m[1]] ?? m[1]}${m[2] ? ` ${decodeURIComponent(m[2])}` : ""}` : hash ? ` · ${hashLabel(head, hash)}` : "";
    return rogueLabel(id) + tail;
  }
  const main = /^main_(\d+)$/.exec(key), rogueStory = /^rogue_(\d+)$/.exec(key), season = /^s(\d+)$/.exec(key);
  const name =
    p === "/" ? "홈"
    : !id && SECTION_KO[head] ? SECTION_KO[head]
    : head === "operators" && OP_NAME.has(key) ? `오퍼 · ${OP_NAME.get(key)}`
    : head === "stories" && STORY_NAME.has(key) ? `스토리 · ${STORY_NAME.get(key)}`
    : head === "stories" && main ? `스토리 · 메인 ${Number(main[1])}장`
    : head === "stories" && rogueStory ? `스토리 · ${rogueLabel(`is${rogueStory[1]}`)}`
    : head === "autochess" && season ? `위수 협의 · 시즌 ${season[1]}`
    : head === "stages" && STAGE_NAME.has(key) ? `작전 · ${STAGE_NAME.get(key)}`
    : head === "enemies" && ENEMY_NAME.has(key) ? `적 · ${ENEMY_NAME.get(key)}`
    // 모르는 하위 주소도 영어 경로 통째가 아니라 '기능 · id' 로 (사용자 지적 2026-10-05 "왜 영어로 나오는겨")
    : SECTION_KO[head] && id ? `${SECTION_KO[head]} · ${key}`
    : decodeURIComponent(p);
  return name + (hash ? ` · ${hashLabel(head, hash)}` : "");
}
// 화면 이름을 누르면 라이브 사이트의 그 화면을 새 탭으로 (사용자 지시 2026-10-04). 운영자 브라우저는 어드민이
// ta-no-track 쿠키를 걸어 두어서 이렇게 열어 봐도 통계에 안 잡힌다.
const SITE = "https://terra-archive.net";
const siteUrl = (path: string, hash?: string | null) => SITE + (path.startsWith("/") ? path : `/${path}`) + (hash ?? "");
/** 갈래 → 그 갈래의 첫 주소 ('operators #op' → /operators, 'rogue/is3 #relic' → /rogue/is3#rg-relic). 이탈·기타는 없음 */
function sectionUrl(s: string): string | null {
  if (s === "이탈" || s === "기타") return null;
  const [head, hash] = s.split(" #");
  if (head === "홈") return siteUrl("/");
  if (head.startsWith("rogue/")) return siteUrl(`/${head}`, hash ? `#rg-${hash}` : null);
  return siteUrl(`/${head}`);
}
function Go({ href, className, children }: { href?: string | null; className?: string; children: ReactNode }) {
  if (!href) return <span className={className}>{children}</span>;
  return <a className={`vz-go${className ? ` ${className}` : ""}`} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}
export function fmtDur(ms: number | null | undefined): string {
  const s = Math.round((ms ?? 0) / 1000);
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분 ${s % 60}초`;
  return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
}
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
const num = (n: number) => n.toLocaleString("ko-KR");

// ── 차트 ───────────────────────────────────────────────────────────────────────

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
}

/** 일별 꺾은선 — 빈 날은 0으로 채운다. 날짜 칸에 올리면(폰은 터치) 그날의 정확한 숫자 (사용자 지시 2026-10-04) */
const WEEK = "일월화수목금토";
function LineChart({ days, series, fmt = (d) => d.slice(5).replace("-", "/"), tip, every: everyIn, onPick, sel }: {
  /** axis "right" = 오른쪽 눈금에 따로 맞춘다 — 화면 조회와 방문자·세션은 자릿수가 달라 한 눈금이면
   *  방문자·세션 선이 바닥에 깔렸다 (사용자 지시 2026-10-07) */
  days: string[]; series: { name: string; cls: string; values: number[]; axis?: "right" }[];
  fmt?: (label: string) => string;
  /** 숫자 상자의 머리글 — 기본은 '10/03 (금)' */
  tip?: (label: string) => string;
  /** 눈금 간격(칸 수) — 15분 칸은 8(=2시간)로 정각에 맞춘다 */
  every?: number;
  /** 칸을 누르면 (15분 칸 → 그 15분만 보기). sel = 고른 칸(띠로 표시) */
  onPick?: (i: number) => void;
  sel?: number | null;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const dual = series.some((s) => s.axis === "right");
  const W = 960, H = 230, L = 44, R = dual ? 44 : 12, T = 12, B = 28;
  const max = niceMax(Math.max(1, ...series.filter((s) => s.axis !== "right").flatMap((s) => s.values)));
  // 오른쪽 눈금은 4등분이 정수로 떨어지게 — 한 칸 크기를 먼저 반올림해 정한다 (50 → 12.5 단위로 '38'·'13' 이 찍혔다)
  const maxR = niceMax(Math.max(1, ...series.filter((s) => s.axis === "right").flatMap((s) => s.values)) / 4) * 4;
  const n = days.length;
  const x = (i: number) => L + (n <= 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const y = (v: number, right = false) => T + (1 - v / (right ? maxR : max)) * (H - T - B);
  const every = everyIn ?? Math.max(1, Math.ceil(n / 12));
  const step = n <= 1 ? W - L - R : (W - L - R) / (n - 1);
  const head = tip ?? ((d: string) => {
    const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(dt.getTime()) ? d : `${d.slice(5, 10).replace("-", "/")} (${WEEK[dt.getUTCDay()]})`;
  });
  return (
    <div className="vz-chart">
      <div className="vz-legend">
        {series.map((s) => <span key={s.name} className={s.cls}><i />{s.name}{dual && <small>{s.axis === "right" ? " · 오른쪽 눈금" : " · 왼쪽 눈금"}</small>}</span>)}
      </div>
      <div className="vz-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="추이" onMouseLeave={() => setHi(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f} className="vz-grid">
              <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} />
              <text x={L - 6} y={y(max * f) + 4} textAnchor="end">{num(Math.round(max * f))}</text>
              {dual && <text className="vz-axis-r" x={W - R + 6} y={y(max * f) + 4} textAnchor="start">{num(Math.round(maxR * f))}</text>}
            </g>
          ))}
          {days.map((d, i) => (i % every === 0 || i === n - 1) && (
            <text key={d} className="vz-axis" x={x(i)} y={H - 8} textAnchor={i === n - 1 && n > 1 ? "end" : i === 0 && n > 1 ? "start" : "middle"}>{fmt(d)}</text>
          ))}
          {sel != null && sel < n && <rect className="vz-sel" x={x(sel) - step / 2} y={T} width={step} height={H - T - B} />}
          {hi != null && <line className="vz-guide" x1={x(hi)} x2={x(hi)} y1={T} y2={H - B} />}
          {series.map((s) => (
            <g key={s.name} className={`vz-series ${s.cls}`}>
              <polyline points={s.values.map((v, i) => `${x(i)},${y(v, s.axis === "right")}`).join(" ")} />
              {s.values.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v, s.axis === "right")} r={i === hi ? 4.5 : n > 45 ? 1.6 : 2.6} />
              ))}
            </g>
          ))}
          {/* 날짜 칸 전체가 올림 영역 — 작은 점을 정확히 노리지 않아도 된다 */}
          {days.map((d, i) => (
            <rect key={d} className={`vz-hit${onPick ? " pick" : ""}`} x={x(i) - step / 2} y={T} width={step} height={H - T - B}
                  onMouseEnter={() => setHi(i)} onPointerDown={() => setHi(i)} onClick={onPick ? () => onPick(i) : undefined} />
          ))}
        </svg>
        {hi != null && (
          <div className={`vz-tip${x(hi) > W * 0.62 ? " left" : ""}`} style={{ left: `${(x(hi) / W) * 100}%` }}>
            <b>{head(days[hi])}</b>
            {series.map((s) => <span key={s.name} className={s.cls}><i />{s.name} <em>{num(s.values[hi])}</em></span>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** 가로 막대 목록 */
function BarList({ rows, top, unit = "" }: { rows: { label: string; n: number; sub?: string; title?: string; href?: string | null }[]; top: number; unit?: string }) {
  const total = rows.reduce((a, r) => a + r.n, 0);   // % 는 잘라 낸 뒤가 아니라 전체 기준
  rows = top ? rows.slice(0, top) : rows;
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="vz-empty">기록 없음</p>;
  return (
    <ol className="vz-bars">
      {rows.map((r) => (
        <li key={r.label} title={r.title ?? r.label}>
          <span className="vz-bar" style={{ width: `${(r.n / max) * 100}%` }} />
          <Go className="vz-bar-label" href={r.href}>{r.label}</Go>
          {r.sub && <span className="vz-bar-sub">{r.sub}</span>}
          <span className="vz-bar-n">{num(r.n)}{unit} <small>{pct(r.n, total)}</small></span>
        </li>
      ))}
    </ol>
  );
}

/** 요일 × 시간 (KST) */
export function Heatmap({ cells }: { cells: [number, number, number][] }) {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const [d, h, n] of cells) if (grid[d]) grid[d][h] += n;
  const max = Math.max(1, ...grid.flat());
  const CW = 36, CH = 20, L = 26, T = 16;
  return (
    <svg className="vz-heat" viewBox={`0 0 ${L + CW * 24} ${T + CH * 7}`} role="img" aria-label="요일·시간대별 방문">
      {Array.from({ length: 24 }, (_, h) => h % 3 === 0 && (
        <text key={h} className="vz-axis" x={L + h * CW + CW / 2} y={11} textAnchor="middle">{h}시</text>
      ))}
      {"월화수목금토일".split("").map((w, d) => (
        <g key={w}>
          <text className="vz-axis" x={L - 6} y={T + d * CH + 14} textAnchor="end">{w}</text>
          {grid[d].map((n, h) => (
            <rect key={h} x={L + h * CW + 1} y={T + d * CH + 1} width={CW - 2} height={CH - 2} rx={2}
                  style={{ fillOpacity: n ? 0.12 + 0.88 * (n / max) : 0.04 }}>
              <title>{`${w}요일 ${h}시 · ${num(n)}세션`}</title>
            </rect>
          ))}
        </g>
      ))}
    </svg>
  );
}

/** 흐름도 — 유입원 → 첫 화면 → 두 번째 → 세 번째. 칸마다 상위 7개만, 나머지는 '기타' */
export function Sankey({ flow, nameOf, links = true }: { flow: FlowRow[]; nameOf?: (label: string) => string; links?: boolean }) {
  const TOP = 7;
  const W = 960, H = 380, NODE = 10, GAP = 8, LABEL = 150;
  const layout = useMemo(() => {
    const steps = [0, 1, 2];
    const raw = flow.filter((f) => steps.includes(f.step));
    // 칸 c 의 이름별 흐름량 (나가는 쪽·들어오는 쪽 중 큰 값)
    const tot = Array.from({ length: 4 }, () => new Map<string, number>());
    for (const f of raw) {
      tot[f.step].set(f.src, (tot[f.step].get(f.src) ?? 0) + f.n);
      tot[f.step + 1].set(f.dst, (tot[f.step + 1].get(f.dst) ?? 0) + f.n);
    }
    const keep = tot.map((m) => new Set([...m.entries()].filter(([k]) => k !== "이탈").sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([k]) => k)));
    const norm = (c: number, k: string) => (k === "이탈" || keep[c].has(k) ? k : "기타");
    const links = new Map<string, { c: number; src: string; dst: string; n: number }>();
    for (const f of raw) {
      const src = norm(f.step, f.src), dst = norm(f.step + 1, f.dst);
      if (src === "이탈") continue;
      const key = `${f.step}|${src}|${dst}`;
      const cur = links.get(key) ?? { c: f.step, src, dst, n: 0 };
      cur.n += f.n;
      links.set(key, cur);
    }
    type Node = { c: number; k: string; inN: number; outN: number; v: number; y: number; h: number; inOff: number; outOff: number };
    const nodes = new Map<string, Node>();
    const node = (c: number, k: string) => {
      const id = `${c}|${k}`;
      if (!nodes.has(id)) nodes.set(id, { c, k, inN: 0, outN: 0, v: 0, y: 0, h: 0, inOff: 0, outOff: 0 });
      return nodes.get(id)!;
    };
    for (const l of links.values()) { node(l.c, l.src).outN += l.n; node(l.c + 1, l.dst).inN += l.n; }
    const cols = [0, 1, 2, 3].map((c) => [...nodes.values()].filter((n) => n.c === c));
    for (const n of nodes.values()) n.v = Math.max(n.inN, n.outN);
    const rank = (k: string) => (k === "이탈" ? 2 : k === "기타" ? 1 : 0);
    for (const col of cols) col.sort((a, b) => rank(a.k) - rank(b.k) || b.v - a.v);
    const maxSum = Math.max(1, ...cols.map((col) => col.reduce((a, n) => a + n.v, 0)));
    const maxCount = Math.max(1, ...cols.map((col) => col.length));
    const scale = (H - 24 - GAP * (maxCount - 1)) / maxSum;
    const colX = (c: number) => 4 + c * ((W - LABEL - 8) / 3);
    for (const col of cols) {
      let y = 22;
      for (const n of col) { n.y = y; n.h = Math.max(2, n.v * scale); y += n.h + GAP; }
    }
    const paths = [...links.values()].sort((a, b) => b.n - a.n).map((l) => {
      const s = node(l.c, l.src), d = node(l.c + 1, l.dst);
      const h = l.n * scale;
      const x0 = colX(l.c) + NODE, x1 = colX(l.c + 1), xm = (x0 + x1) / 2;
      const y0 = s.y + s.outOff, y1 = d.y + d.inOff;
      s.outOff += h; d.inOff += h;
      return { key: `${l.c}|${l.src}|${l.dst}`, n: l.n, src: l.src, dst: l.dst, exit: l.dst === "이탈",
        d: `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h} C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h} Z` };
    });
    return { cols, paths, colX };
  }, [flow]);
  if (!layout.paths.length) return <p className="vz-empty">기록 없음</p>;
  const name = (c: number, k: string) => {
    const label = c === 0 || k === "이탈" || k === "기타" ? k : sectionLabel(k);
    return nameOf ? nameOf(label) : label;
  };
  return (
    <svg className="vz-sankey" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="방문 동선 흐름">
      {["유입", "첫 화면", "두 번째", "세 번째"].map((t, c) => (
        <text key={t} className="vz-axis" x={layout.colX(c)} y={12}>{t}</text>
      ))}
      {layout.paths.map((p) => (
        <path key={p.key} d={p.d} className={p.exit ? "vz-link exit" : "vz-link"}>
          <title>{`${p.src} → ${p.dst} · ${num(p.n)}`}</title>
        </path>
      ))}
      {layout.cols.flat().map((n) => (
        <g key={`${n.c}|${n.k}`} className={n.k === "이탈" ? "vz-node exit" : "vz-node"}>
          <rect x={layout.colX(n.c)} y={n.y} width={NODE} height={n.h} />
          {(() => {
            const label = (
              <text x={layout.colX(n.c) + NODE + 5} y={n.y + Math.min(n.h, 24) / 2 + 4}>
                {name(n.c, n.k)} <tspan className="vz-node-n">{num(n.v)}</tspan>
              </text>
            );
            const href = !links || n.c === 0 ? null : sectionUrl(n.k);   // 0열은 유입원(바깥) · 리포트 이미지엔 링크 없음
            return href ? <a className="vz-go" href={href} target="_blank" rel="noopener noreferrer">{label}</a> : label;
          })()}
        </g>
      ))}
    </svg>
  );
}

// ── 목록 길이 — 모든 목록은 상위 5·10·20·30 다음 '전체 보기', 기본 5 (2026-10-07 — 종전 5·15·30), 바꾸면 이 브라우저에 남는다. '전체 보기'는 목록을 늘리지 않고
//    창(모달)을 띄워 업데이트 내역처럼 내릴수록 이어서 그린다 (사용자 지시 2026-10-05 — 종전 5·10·20·50·100·전체) ──

const TOPS = [5, 10, 20, 30];
const SPANS = [7, 30, 90, 365] as const;
// 세션 종류 — 사람 = 세션 동안 스크롤·클릭·터치·키 입력이 한 번이라도 있었던 것 (JS 를 도는 위장 크롤러 거르기)
// 세션 종류 셋 — 골라서 조합 (사용자 지시 2026-10-08). DB visit_kind 와 같은 이름
type Kind = "human" | "skim" | "bot";
const KINDS: Kind[] = ["human", "skim", "bot"];
const KIND_LABEL: Record<Kind, string> = { human: "사람", skim: "훑고 간 사람", bot: "봇" };
/** 고를 수 있는 조합 — 하나씩 · 둘씩 · 셋 다 */
const KIND_COMBOS: Kind[][] = [["human"], ["skim"], ["bot"], ["human", "skim"], ["human", "bot"], ["skim", "bot"], ["human", "skim", "bot"]];
const KIND_HINT: Record<Kind, string> = {
  human: "스크롤·클릭·터치·키 입력이 한 번이라도 있었던 세션",
  skim: "조작은 없지만 화면에 1초 이상 떠 있었고 한국·일본 시간대 — 열어서 확인만 하고 닫은 사람",
  bot: "나머지 — 화면 기록 없음·화면에 0초(미리보기)·해외 시간대 무조작",
};
const SPAN_LABEL: Record<number, string> = { 7: "최근 7일", 30: "최근 30일", 90: "최근 90일", 365: "1년(일별 집계)" };
const SESSIONS_ALL = 5000;                // 세션 타임라인 '전체 보기'의 상한 (visits_sessions 도 5,000 에서 자른다)
const ALL_STEP = 50;                      // 전체 보기 창에서 한 번에 더 그리는 줄 수

function TopPick({ value, onChange, onAll, what }: { value: number; onChange: (n: number) => void; onAll?: () => void; what: string }) {
  return (
    <Dropdown
      label={`상위 ${value}`}
      items={[...TOPS.map((n) => ({ value: String(n), label: `상위 ${n}` })), ...(onAll ? [{ value: "all", label: "전체 보기" }] : [])]}
      selected={[String(value)]}
      onPick={(v) => (v === "all" ? onAll?.() : onChange(Number(v)))}
      ariaLabel={`${what} 보여 줄 개수`}
    />
  );
}

/** 전체 보기 창 — 처음 ALL_STEP 줄, 바닥에 닿으면 ALL_STEP 줄씩 더 (업데이트 내역과 같은 무한 스크롤) */
function AllWindow({ title, total, loading, render, onClose }: { title: string; total: number; loading?: boolean; render: (n: number) => ReactNode; onClose: () => void }) {
  const [n, setN] = useState(ALL_STEP);
  const box = useRef<HTMLDivElement | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const target = end.current;
    if (!target || n >= total) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setN((x) => Math.min(total, x + ALL_STEP)); },
      { root: box.current, rootMargin: "300px 0px" });
    io.observe(target);
    return () => io.disconnect();
  }, [n, total]);
  return (
    <ModalWindow label={`${title} — 전체 ${num(total)}`} className="operator-modal vz-all-modal" onClose={onClose}>
      <div className="vz vz-all" ref={box}>
        {loading ? <p className="vz-empty">불러오는 중…</p> : render(n)}
        {!loading && n < total && <div ref={end} className="vz-empty">불러오는 중…</div>}
      </div>
    </ModalWindow>
  );
}

/** 제목 + (목록이면) 개수 고르기 */
function Head({ title, sub, top, setTop, onAll, children }: { title: string; sub?: string; top?: number; setTop?: (n: number) => void; onAll?: () => void; children?: React.ReactNode }) {
  return (
    <div className="vz-head">
      <h3 className="vz-h">{title}{sub && <small> — {sub}</small>}</h3>
      <div className="vz-head-tools">
        {children}
        {top != null && setTop && <TopPick value={top} onChange={setTop} onAll={onAll} what={title} />}
      </div>
    </div>
  );
}

type TopKey = "src" | "ref" | "landing" | "pages" | "sections" | "device" | "lang" | "tz" | "out" | "sessions" | "mesync";
const TOP_DEFAULT: Record<TopKey, number> = { src: 5, ref: 5, landing: 5, pages: 5, sections: 5, device: 5, lang: 5, tz: 5, out: 5, sessions: 5, mesync: 5 };
const TOPS_KEY = "ta-admin-visit-tops";   // localStorage — 목록마다 고른 개수

function loadTops(): Record<TopKey, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(TOPS_KEY) ?? "{}") as Partial<Record<TopKey, number>>;
    const out = { ...TOP_DEFAULT };
    for (const k of Object.keys(out) as TopKey[]) if (TOPS.includes(saved[k] as number)) out[k] = saved[k] as number;
    return out;
  } catch { return { ...TOP_DEFAULT }; }
}

// ── 패널 ───────────────────────────────────────────────────────────────────────

function fillDays(days: Summary["days"], span: number) {
  const byDay = new Map(days.map((d) => [d.day.slice(0, 10), d]));
  const out: { day: string; sessions: number; visitors: number; views: number; active_ms: number }[] = [];
  const today = new Date(Date.now() + 9 * 3600_000);   // KST
  for (let i = span - 1; i >= 0; i--) {
    const key = new Date(today.getTime() - i * 86400_000).toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? { day: key, sessions: 0, visitors: 0, views: 0, active_ms: 0 });
  }
  return out;
}

// 기간 지정의 날짜(KST) — 시작~끝(끝 날 포함)을 하루씩 채운다
function fillRange(days: Summary["days"], from: string, to: string) {
  const byDay = new Map(days.map((d) => [d.day.slice(0, 10), d]));
  const out: { day: string; sessions: number; visitors: number; views: number; active_ms: number }[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400_000) {
    const key = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? { day: key, sessions: 0, visitors: 0, views: 0, active_ms: 0 });
  }
  return out;
}
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
const prevDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);

function SessionLine({ s }: { s: SessRow }) {
  const at = new Date(s.at);
  const when = at.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const last = s.views[s.views.length - 1];
  // 세션 합계 — 화면마다 찍힌 시간(조작, 없으면 보인 시간)을 더한 값. 동선의 작은 숫자들의 합이다 (사용자 요청 2026-10-10)
  const total = s.views.reduce((a, v) => a + (v.act || v.vis || 0), 0);
  // 아직 안 나간 세션 — 열린 탭은 1분마다 기록을 보내므로(visit-track.ts BEAT_MS) 마지막 수신이 3분 안이면 '조작 중'.
  // DB 함수가 옛판이라 last_at 이 없으면 시작 시각 + 마지막 화면의 시작·보인 시간으로 어림한다 (사용자 지시 2026-10-10)
  const lastAt = s.last_at ? Date.parse(s.last_at) : last ? at.getTime() + (last.t0 ?? 0) * 1000 + last.vis : at.getTime();
  const live = Date.now() - lastAt < 3 * 60_000;
  return (
    <li className={(s.kind ?? (s.human ? "human" : "bot")) === "bot" ? "bot" : ""}>
      <header>
        <time>{when}</time>
        <span className="vz-tag vz-total" title="화면마다 조작 시간(없으면 보인 시간)의 합">합계 {fmtDur(total)}</span>
        <b>{s.src}</b>
        {s.ref && s.ref !== s.src && <span className="vz-muted" title={s.ref}><Go href={/^https?:\/\//.test(s.ref) ? s.ref : null}>{s.ref.replace(/^https?:\/\//, "").slice(0, 60)}</Go></span>}
        {s.utm && <span className="vz-tag" title="utm_source">유입 태그 {s.utm}</span>}
        <span className="vz-tag">{DEVICE_KO[s.device ?? ""] ?? s.device}</span>
        {s.site_lang && s.site_lang !== "ko" && <span className="vz-tag">{LANG_KO[s.site_lang] ?? s.site_lang}</span>}
        {s.revisit && <span className="vz-tag">재방문</span>}
        {(s.kind ?? (s.human ? "human" : "bot")) === "skim" && <span className="vz-tag" title={KIND_HINT.skim}>훑고 감</span>}
        {(s.kind ?? (s.human ? "human" : "bot")) === "bot" && <span className="vz-tag warn" title={KIND_HINT.bot}>봇 추정</span>}
        {s.tz && s.tz !== "Asia/Seoul" && <span className="vz-muted">{s.tz}</span>}
      </header>
      <p className="vz-trail">
        {s.views.map((v, i) => (
          <span key={i}>
            {i > 0 && <i>→</i>}
            <a className="vz-step vz-go" href={siteUrl(v.path, v.hash)} target="_blank" rel="noopener noreferrer"
               title={`${v.path}${v.hash ?? ""} · 보인 ${fmtDur(v.vis)} · 조작 ${fmtDur(v.act)}${v.scroll != null ? ` · 스크롤 ${v.scroll}%` : ""}`}>
              {pathLabel(v.path, v.hash)} <small>{fmtDur(v.act || v.vis)}</small>
            </a>
            {v.out && <><i>↗</i><Go className="vz-step out" href={/^https?:\/\//.test(v.out) ? v.out : null}>{v.out.replace(/^https?:\/\//, "").slice(0, 40)}</Go></>}
          </span>
        ))}
        {last && !last.out && (live
          ? <><i>→</i><span className="vz-step live" title="마지막 기록이 3분 안 — 탭이 열려 있다">조작 중</span></>
          : <><i>→</i><span className="vz-step exit">이탈</span></>)}
      </p>
    </li>
  );
}

export function VisitsPanel() {
  const [days, setDays] = useState<0 | 7 | 30 | 90 | 365>(0);
  // 내 정보 동기화 — 서버별로 거르기 (사용자 요청 2026-10-06). 통계가 방문자별로 묶여 있어 방문자의 서버(max) 기준이다
  const [meServer, setMeServer] = useState("");
  // 내 정보 동기화 정렬 — 횟수순(기본) · 최신순 (사용자 지시 2026-10-08)
  // 정렬은 이 브라우저에 기억한다 — 새로고침하면 횟수순으로 풀렸다 (사용자 지적 2026-10-08)
  const [meSort, setMeSortState] = useState<"n" | "last" | "sync">(() => {
    try { const v = localStorage.getItem("ta-admin-visit-mesort"); return v === "last" || v === "sync" ? v : "n"; } catch { return "n"; }
  });
  const setMeSort = (v: "n" | "last" | "sync") => { setMeSortState(v); try { localStorage.setItem("ta-admin-visit-mesort", v); } catch { /* 무시 */ } };
  // 기간 지정 (사용자 지시 2026-10-05 "특정 일 혹은 특정 기간 지정도") — KST 날짜. 정해 두면 위 기간 버튼 대신 이것을 본다.
  // DB 쪽 visits_summary_range·visits_sessions_range (docs/supabase-visits.sql) 를 부른다.
  // 기간 — 날짜에 시각(HH:MM, KST)까지 고를 수 있다 (사용자 지시 2026-10-08). 시각을 비우면 그날 0시부터 / 끝날 24시까지
  const [range, setRange] = useState<{ from: string; to: string; fromT?: string; toT?: string } | null>(null);
  // 칸 크기 15·30·60분 (사용자 지시 2026-10-08) — 이 브라우저에 남긴다
  const [step, setStepState] = useState<15 | 30 | 60>(() => {
    try { const v = Number(localStorage.getItem("ta-admin-visit-step")); return v === 30 || v === 60 ? v : 15; } catch { return 15; }
  });
  const setStep = (v: 15 | 30 | 60) => { setStepState(v); try { localStorage.setItem("ta-admin-visit-step", String(v)); } catch { /* 무시 */ } };
  const kstMs = (d: string, hm = "00:00") => Date.parse(`${d}T${hm}:00+09:00`);
  const todayStr = kstToday();
  // 보고 있는 구간 [시작, 끝) — 오늘 보기는 0시~지금
  const spanStart = range ? kstMs(range.from, range.fromT || "00:00") : days === 0 ? kstMs(todayStr) : null;
  const spanEnd = range ? (range.toT ? kstMs(range.to, range.toT) : kstMs(nextDay(range.to))) : days === 0 ? Date.now() : null;
  // 48시간 이하면 시각 칸 그래프 (그보다 길면 일별 추이)
  const fine = spanStart != null && spanEnd != null && spanEnd - spanStart <= 48 * 3600_000;
  // 칸 하나만 보기 (사용자 지시 2026-10-07) — 그래프에서 칸을 누르면 그 칸에 **시작한** 세션만으로 나머지 통계를 다시 센다.
  // 그래프 자체는 구간 전체를 그대로 보여야 하니 고르기 전의 칸 묶음을 따로 쥐고 있는다
  const [slot, setSlot] = useState<{ t: number; step: number } | null>(null);
  const [saved, setSaved] = useState<Summary | null>(null);
  const isoAt = (ms: number) => new Date(ms).toISOString();
  const rangeArgs = slot
    ? { p_from: isoAt(slot.t * 1000), p_to: isoAt((slot.t + slot.step * 60) * 1000) }
    : range && spanStart != null && spanEnd != null ? { p_from: isoAt(spanStart), p_to: isoAt(spanEnd) } : null;
  const oneDay = !!slot || (!!range && fine);
  // 기간·칸 크기를 바꾸면 고른 칸은 풀린다
  useEffect(() => { setSlot(null); }, [range, days, step]);
  // 세션 종류 조합 — 기본 사람 + 훑고 간 사람. 이 브라우저에 남긴다. 하나는 꼭 남는다
  const [kinds, setKindsState] = useState<Kind[]>(() => {
    try { const v = JSON.parse(localStorage.getItem("ta-admin-visit-kinds") ?? "null") as Kind[] | null; if (Array.isArray(v) && v.length && v.every((k) => KINDS.includes(k))) return v; } catch { /* 무시 */ }
    return ["human", "skim"];
  });
  const pickKinds = (next: Kind[]) => {
    setKindsState(next);
    try { localStorage.setItem("ta-admin-visit-kinds", JSON.stringify(next)); } catch { /* 무시 */ }
  };
  const human = kinds.join(",");   // 의존성 키 (아래 effect 들이 이걸 본다)
  const kindArgs = { p_kinds: kinds };
  const whoLabel = kinds.map((k) => KIND_LABEL[k]).join(" + ");
  const [data, setData] = useState<Summary | null>(null);
  const [, setNamesReady] = useState(false);
  useEffect(() => { void loadDexNames().then(() => setNamesReady(true)); }, []);
  const [report, setReport] = useState(false);   // 이미지 리포트 창 (visits-report.tsx)
  const [trend, setTrend] = useState<TrendRow[] | null>(null);
  const [sessions, setSessions] = useState<SessRow[] | null>(null);
  const [srcFilter, setSrcFilter] = useState<string>("");
  const [tops, setTops] = useState(TOP_DEFAULT);
  useEffect(() => { setTops(loadTops()); }, []);   // 하이드레이션 뒤에 저장값을 읽는다
  // 전체 보기 창 — 어느 목록인지
  const [allOf, setAllOf] = useState<{ key: TopKey; title: string } | null>(null);
  const top = (k: TopKey, title = "") => ({
    top: tops[k],
    onAll: () => setAllOf({ key: k, title }),
    setTop: (n: number) => setTops((t) => {
      const next = { ...t, [k]: n };
      try { localStorage.setItem(TOPS_KEY, JSON.stringify(next)); } catch { /* 프라이빗 모드 */ }
      return next;
    }),
  });
  const limit = tops.sessions;
  const [status, setStatus] = useState("");
  const [missing, setMissing] = useState(false);
  const [tick, setTick] = useState(0);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  // 받아오는 중 표시 (사용자 지시 2026-10-04) — 요약·세션 두 갈래 중 하나라도 돌면 새로고침 버튼이 '불러오는 중'으로 바뀐다
  const [loadMain, setLoadMain] = useState(false);
  const [loadSess, setLoadSess] = useState(false);
  const busy = loadMain || loadSess;

  // 켜 둔 동안 1분마다 새로고침 (사용자 지시 2026-10-04, 5분 → 1분). 탭이 가려져 있으면 쉬었다가, 다시 보일 때 1분이 지났으면 곧바로.
  useEffect(() => {
    const EVERY = 60_000;
    let last = Date.now();
    const bump = () => { last = Date.now(); setTick((n) => n + 1); };
    const timer = setInterval(() => { if (document.visibilityState === "visible" && Date.now() - last >= EVERY) bump(); }, 5_000);
    const onVis = () => { if (document.visibilityState === "visible" && Date.now() - last >= EVERY) bump(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoadMain(true);
    const fail = (e: unknown) => {
      if (!alive) return;
      if ((e as Error).message === "not-configured") { setMissing(true); setStatus(""); }
      else setStatus(String((e as Error).message ?? e));
    };
    const done = () => { if (alive) setLoadMain(false); };
    if (rangeArgs) {
      rpc<Summary>("visits_summary_range", { ...rangeArgs, ...kindArgs, p_hourly: oneDay })
        .then((d) => { if (alive) { setData(d); setStatus(""); setLoadedAt(new Date()); } }).catch(fail).finally(done);
    } else if (days === 365) {
      rpc<TrendRow[]>("visits_trend", { p_days: 365 })
        .then((t) => { if (alive) { setTrend(t); setStatus(""); setLoadedAt(new Date()); } }).catch(fail).finally(done);
    } else {
      rpc<Summary>("visits_summary", { p_days: days, ...kindArgs })
        .then((d) => { if (alive) { setData(d); setStatus(""); setLoadedAt(new Date()); } }).catch(fail).finally(done);
    }
    return () => { alive = false; };
    // rangeArgs 는 range 에서 나온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, human, tick, range, slot]);

  useEffect(() => {
    if (days === 365 && !rangeArgs) return;
    let alive = true;
    setLoadSess(true);
    (rangeArgs
      ? rpc<SessRow[]>("visits_sessions_range", { ...rangeArgs, ...kindArgs, p_src: srcFilter || null, p_limit: limit })
      : rpc<SessRow[]>("visits_sessions", { p_days: Math.min(days, 90), ...kindArgs, p_src: srcFilter || null, p_limit: limit }))
      .then((s) => { if (alive) setSessions(s); }).catch(() => { if (alive) setSessions(null); })
      .finally(() => { if (alive) setLoadSess(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, human, srcFilter, limit, tick, range, slot]);

  // 세션 타임라인 '전체 보기' — 창을 열 때 상한(5,000)까지 따로 받는다
  const [allSessions, setAllSessions] = useState<SessRow[] | null>(null);
  const sessAll = allOf?.key === "sessions";
  useEffect(() => {
    if (!sessAll) return;
    let alive = true;
    (rangeArgs
      ? rpc<SessRow[]>("visits_sessions_range", { ...rangeArgs, ...kindArgs, p_src: srcFilter || null, p_limit: SESSIONS_ALL })
      : rpc<SessRow[]>("visits_sessions", { p_days: Math.min(days, 90), ...kindArgs, p_src: srcFilter || null, p_limit: SESSIONS_ALL }))
      .then((rows) => { if (alive) setAllSessions(rows); }).catch(() => { if (alive) setAllSessions([]); });
    return () => { alive = false; setAllSessions(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessAll, days, human, srcFilter, range, slot]);

  useEffect(() => { if (data && !slot) setSaved(data); }, [data, slot]);
  if (missing) {
    return (
      <section className="vz">
        <p className="admin-status">
          방문 기록 DB 가 아직 연결되지 않았습니다. 방문 기록 전용 Supabase 프로젝트를 만든 뒤{" "}
          <code>node scripts/make-visits-sql.mjs</code> 로 만든 <code>.visits-setup.generated.sql</code> 을 그 프로젝트의 SQL Editor 에서 실행하고,{" "}
          프로젝트 주소·anon 키를 <code>app/visit-track.ts</code> · <code>scripts/admin-dev-proxy.ts</code> · <code>workers/admin-api/wrangler.toml</code> 에 넣으세요 (docs/supabase-visits.sql 머리말).
        </p>
      </section>
    );
  }

  const t = data?.total;
  // 막대 목록의 줄 — 본문과 '전체 보기' 창이 같이 쓴다
  type BarRow = { label: string; n: number; sub?: string; title?: string; href?: string | null };
  const barRows: Record<"src" | "ref" | "landing" | "sections" | "device" | "lang" | "tz" | "out", BarRow[]> = data ? {
    // 시간은 전부 **평균** (사용자 지시 2026-10-07 두 번째 — 한때 중앙값으로 바꿨다가 되돌렸다. 화면 수·시간 모두 '실제 쓴 총량 ÷ 세션'이 낫다)
    src: data.src.map((r) => ({ label: r.src, n: r.sessions, sub: `평균 조작 ${fmtDur(r.active_ms / Math.max(1, r.sessions))}${r.visible_ms != null ? ` · 머문 ${fmtDur(r.visible_ms / Math.max(1, r.sessions))}` : ""}` })),
    ref: data.ref.map((r) => ({ label: r.ref.replace(/^https?:\/\//, ""), n: r.sessions, title: r.ref, href: /^https?:\/\//.test(r.ref) ? r.ref : null })),
    landing: data.landing.map((r) => ({ label: pathLabel(r.path), n: r.sessions, sub: `바로 이탈 ${pct(r.bounces, r.sessions)}`, title: r.path, href: siteUrl(r.path) })),
    sections: data.sections.map((r) => ({ label: sectionLabel(r.section), n: r.views, sub: `평균 조작 ${fmtDur(r.avg_active)}${r.avg_visible != null ? ` · 머문 ${fmtDur(r.avg_visible)}` : ""}`, href: sectionUrl(r.section) })),
    // 기기와 사이트 언어는 따로 (사용자 지시 2026-10-07 — 한 목록에 섞여 비율을 읽을 수 없었다)
    device: data.device.map((r) => ({ label: DEVICE_KO[r.k ?? ""] ?? String(r.k), n: r.n })),
    lang: data.site_lang.map((r) => ({ label: LANG_KO[r.k ?? ""] ?? r.k ?? "?", n: r.n })),
    tz: data.tz.map((r) => ({ label: r.k ?? "?", n: r.n })),
    out: data.out.map((r) => ({ label: r.host, n: r.n })),
  } : { src: [], ref: [], landing: [], sections: [], device: [], lang: [], tz: [], out: [] };
  // 화면 순위·내 정보 동기화 표 — 본문(상위 n)과 '전체 보기' 창이 같이 쓴다
  const pageTable = (n: number) => !data ? null : (
    <div className="vz-tablewrap"><table className="vz-table">
      <thead>
        <tr><th>화면</th><th>조회</th><th>세션</th><th>평균 조작</th><th title="탭이 화면에 떠 있던 시간 · 화면당 1시간 상한">평균 머문</th><th>여기서 이탈</th><th title="평균">스크롤</th></tr>
      </thead>
      <tbody>
        {data.pages.slice(0, n).map((p) => {
          const maxV = data.pages[0]?.views || 1;
          return (
            <tr key={p.path}>
              <td title={p.path}><span className="vz-cellbar" style={{ width: `${(p.views / maxV) * 100}%` }} /><Go href={siteUrl(p.path)}>{pathLabel(p.path)}</Go></td>
              <td>{num(p.views)}</td>
              <td>{num(p.sessions)}</td>
              <td>{fmtDur(p.avg_active)}</td>
              <td>{p.avg_visible != null ? fmtDur(p.avg_visible) : "–"}</td>
              <td>{pct(p.exits, p.views)}</td>
              <td>{p.scroll != null ? `${p.scroll}%` : "–"}</td>
            </tr>
          );
        })}
      </tbody>
    </table></div>
  );
  const meBy = (data?.me_sync?.by ?? []).filter((b) => !meServer || b.server === meServer)
    .slice().sort((a, b) => meSort === "last" ? String(b.last).localeCompare(String(a.last))
      : meSort === "sync" ? (b.sync - a.sync) || (b.n - a.n) || String(b.last).localeCompare(String(a.last))   // 다시 동기화 많은 순 (사용자 2026-10-08)
      : (b.n - a.n) || String(b.last).localeCompare(String(a.last)));
  const meServers = [...new Set((data?.me_sync?.by ?? []).map((b) => b.server).filter((x): x is string => !!x))];
  const serverLabel = (code: string) => ACCOUNT_SERVERS.find((x) => x.code === code)?.label ?? code;
  const meTable = (n: number) => !data?.me_sync ? null : (
    <div className="vz-tablewrap"><table className="vz-table">
      <thead><tr><th>방문자</th><th>유입</th><th>합계</th><th>로그인</th><th>다시 동기화</th><th>서버</th><th>마지막</th></tr></thead>
      <tbody>
        {meBy.slice(0, n).map((b) => (
          <tr key={b.visitor ?? "?"}>
            <td title={b.visitor ?? ""}><code>{(b.visitor ?? "—").slice(0, 8)}</code></td>
            {/* 유입 — 로그인한 세션이 어디서 왔는가 (사용자 요청 2026-10-05). 주소가 있으면 호스트·경로를 툴팁으로 */}
            <td title={b.ref ?? ""}>{b.src ?? "—"}{b.ref && <small className="vz-note"> {b.ref.replace(/^https?:\/\//, "").slice(0, 40)}</small>}</td>
            <td>{num(b.n)}</td><td>{num(b.login)}</td><td>{num(b.sync)}</td><td>{b.server ? serverLabel(b.server) : "—"}</td>
            <td>{new Date(b.last).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
  // 전체 보기 창의 내용 · 줄 수
  const allTotal = !allOf || !data ? 0
    : allOf.key === "pages" ? data.pages.length
    : allOf.key === "mesync" ? meBy.length
    : allOf.key === "sessions" ? allSessions?.length ?? 0
    : barRows[allOf.key].length;
  const allRender = (n: number) => !allOf ? null
    : allOf.key === "pages" ? pageTable(n)
    : allOf.key === "mesync" ? meTable(n)
    : allOf.key === "sessions" ? <ol className="vz-sessions">{(allSessions ?? []).slice(0, n).map((x) => <SessionLine key={x.id} s={x} />)}</ol>
    : <BarList top={n} rows={barRows[allOf.key]} />;
  const filled = data ? (range ? fillRange(data.days, range.from, range.to) : fillDays(data.days, days)) : [];
  const today = kstToday();
  const pickDate = (which: "from" | "to", v: string) => {
    if (!v) return;
    const cur = range ?? { from: v, to: v };
    let next = { ...cur, [which]: v };
    if (next.from > next.to) next = { ...next, from: v, to: v };
    setRange(next);
  };
  // 전날·다음날 (사용자 지시 2026-10-05) — 지정 기간을 하루씩 민다. 기간이 없으면 오늘 하루에서 출발한다.
  // 오늘 너머로는 못 가고, 오늘 하루에 닿으면 기간을 풀어 '오늘' 보기(자동 새로고침)로 돌아간다.
  const shiftDay = (dir: -1 | 1) => {
    const cur = range ?? { from: today, to: today };
    const mv = dir < 0 ? prevDay : nextDay;
    const next = { ...cur, from: mv(cur.from), to: mv(cur.to) };   // 고른 시각은 그대로 들고 간다
    if (next.to > today) return;
    if (next.from === today && next.to === today && !next.fromT && !next.toT) { setRange(null); setDays(0); return; }
    setRange(next);
  };
  // 시각 (사용자 지시 2026-10-08) — 비우면 0시부터 / 24시까지. 기간이 없으면 오늘 하루에 시각을 붙인다
  const pickTime = (which: "fromT" | "toT", v: string) => {
    const cur = range ?? { from: today, to: today };
    const next = { ...cur, [which]: v || undefined };
    if (next.from === next.to && next.fromT && next.toT && next.fromT >= next.toT) return;   // 끝이 시작보다 앞이면 무시
    setRange(next);
  };
  const canNext = !!range && range.to < today;
  // 리포트 기간 = 지금 고른 기간. 최근 N일은 수집 첫날(데이터가 있는 첫 날)보다 앞으로 늘리지 않는다
  const reportSpan = (() => {
    if (range) return range;
    if (days === 0) return { from: today, to: today };
    const start = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86400_000).toISOString().slice(0, 10);
    const first = data?.days.find((x) => x.sessions > 0)?.day.slice(0, 10);
    return { from: first && first > start ? first : start, to: today };
  })();
  return (
    <section className="vz">
      <div className="admin-tools vz-controls">
        <button className={!range && days === 0 ? "tab-btn selected" : "tab-btn"} onClick={() => { setRange(null); setDays(0); }}>오늘</button>
        {/* 7·30·90일·1년은 드롭다운 하나로 (사용자 지시 2026-10-05) */}
        <Dropdown
          label={!range && days !== 0 ? SPAN_LABEL[days] : "최근 기간"}
          items={SPANS.map((d) => ({ value: String(d), label: SPAN_LABEL[d] }))}
          selected={!range && days !== 0 ? [String(days)] : []}
          onPick={(v) => { setRange(null); setDays(Number(v) as typeof SPANS[number]); }}
          ariaLabel="최근 기간"
          buttonClassName={!range && days !== 0 ? "selected" : ""}
        />
        {/* 기간 지정 — 하루만 고르면 시작=끝. 날짜 칸을 누르면 브라우저 달력이 뜬다 */}
        <span className={`vz-range${range ? " on" : ""}`}>
          <span>기간</span>
          <button type="button" className="vz-day" onClick={() => shiftDay(-1)} title="하루 앞으로">‹ 전날</button>
          <input type="date" max={today} value={range?.from ?? ""} onChange={(e) => pickDate("from", e.target.value)} aria-label="시작일" />
          {/* 시각은 시 단위만 (사용자 지시 2026-10-08 "분까지는 필요없고 시간대까지만") */}
          <select value={range?.fromT ?? ""} onChange={(e) => pickTime("fromT", e.target.value)} aria-label="시작 시각">
            <option value="">0시</option>
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => <option key={h} value={`${String(h).padStart(2, "0")}:00`}>{h}시</option>)}
          </select>
          <i>~</i>
          <input type="date" max={today} value={range?.to ?? ""} onChange={(e) => pickDate("to", e.target.value)} aria-label="끝일" />
          <select value={range?.toT ?? ""} onChange={(e) => pickTime("toT", e.target.value)} aria-label="끝 시각">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => <option key={h} value={`${String(h).padStart(2, "0")}:00`}>{h}시</option>)}
            <option value="">24시</option>
          </select>
          <button type="button" className="vz-day" onClick={() => shiftDay(1)} disabled={!canNext} title="하루 뒤로">다음날 ›</button>
          {range && <button type="button" className="vz-range-x" onClick={() => setRange(null)} aria-label="기간 지정 해제">×</button>}
        </span>
{/* 세션 종류 — 셋의 조합 7가지를 한 항목씩 (사용자 지시 2026-10-08 "경우의 수에 따라 + 로 묶어 하나의 항목으로").
            숫자는 그 조합의 기간 안 세션 수 */}
        <Dropdown ariaLabel="세션 종류" label={whoLabel} selected={[kinds.join("+")]}
          items={KIND_COMBOS.map((c) => {
            const n = data?.total?.kinds ? c.reduce((a, k) => a + (data.total.kinds?.[k] ?? 0), 0) : undefined;
            return { value: c.join("+"), label: c.map((k) => KIND_LABEL[k]).join(" + "), ...(n != null ? { count: n } : {}) };
          })}
          onPick={(v) => pickKinds(v.split("+") as Kind[])} disabled={days === 365 && !range} />
        <button className={`vz-refresh${busy ? " busy" : ""}`} onClick={() => setTick((n) => n + 1)} disabled={busy} aria-busy={busy}>
          <span>새로고침</span>
          <span role="status"><i className="vz-spin" aria-hidden />불러오는 중</span>
        </button>
        {/* 이미지 리포트 — 지금 고른 기간·사람만/봇 포함 그대로 (사용자 지시 2026-10-05). 1년 보기는 일별 집계라 빠진다 */}
        <button className="vz-report-btn" onClick={() => setReport(true)} disabled={!data || busy || (days === 365 && !range) || !!slot} title={slot ? "칸을 고른 동안은 리포트를 뽑지 않습니다" : undefined}>리포트 이미지</button>
        {loadedAt && <span className="vz-muted vz-loaded">{loadedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })} 갱신 · 1분마다 자동</span>}
      </div>
      {status && <p className="admin-status">{status}</p>}
      {report && data && <VisitsReport data={data} from={reportSpan.from} to={reportSpan.to} who={whoLabel} onlyHuman={!kinds.includes("bot")} tops={tops} onClose={() => setReport(false)} />}

      {days === 365 && !range ? (
        trend && (
          <>
            <h3 className="vz-h">일별 추이 (최근 1년 · 매일 밤 말아 둔 집계 — 오늘은 내일 반영)</h3>
            <LineChart days={trend.map((r) => r.day)} series={[
              { name: "세션(사람)", cls: "s1", values: trend.map((r) => r.human_sessions) },
              { name: "방문자", cls: "s2", values: trend.map((r) => r.visitors) },
              { name: "세션(전체)", cls: "s3", values: trend.map((r) => r.sessions) },
            ]} />
            <p className="vz-note">1년 보기는 추이만 있습니다 — 유입·페이지·동선의 원본은 DB 가 80% 차면 오래된 것부터 지워집니다.</p>
          </>
        )
      ) : data && t && (
        <>
          <div className="vz-kpis">
            <div><b>{num(t.visitors)}</b><span>방문자</span></div>
            <div><b>{num(t.sessions)}</b><span>세션</span></div>
            <div><b>{num(t.views)}</b><span>화면 조회</span></div>
            {/* 지표는 전부 **평균** = 총량 ÷ 세션 (사용자 지시 2026-10-07 — 중앙값은 정수 화면 수에선 매일 3 에 붙고,
                시간도 '실제로 쓴 양'이 안 보였다). 머문 시간은 화면당 1시간 상한이라 켜 두고 잊은 탭이 크게 흔들지 못한다 */}
            <div><b>{t.sessions ? (t.views / t.sessions).toFixed(1) : "–"}</b><span>세션당 화면</span></div>
            <div><b>{fmtDur(t.sessions ? t.active_ms / t.sessions : 0)}</b><span>세션당 조작 시간</span></div>
            {t.visible_ms != null && <div title="탭이 화면에 떠 있던 시간 · 화면당 1시간 상한"><b>{fmtDur(t.sessions ? t.visible_ms / t.sessions : 0)}</b><span>세션당 머문 시간</span></div>}
            <div><b>{pct(t.bounce, t.sessions)}</b><span>한 화면만 보고 이탈</span></div>
            <div><b>{pct(t.revisit, t.sessions)}</b><span>재방문</span></div>
            <div title={`고르지 않은 종류: ${KINDS.filter((k) => !kinds.includes(k)).map((k) => KIND_LABEL[k]).join(", ") || "없음"}`}><b>{num(t.kinds ? KINDS.filter((k) => !kinds.includes(k)).reduce((a, k) => a + (t.kinds?.[k] ?? 0), 0) : t.bots)}</b><span>거른 세션</span></div>
          </div>

          {/* 내 정보 동기화 — 누가(익명 방문자 id) 몇 번 (사용자 요청 2026-10-05) */}
          {data.me_sync && (
            <div className="vz-mesync">
              <Head title="내 정보 동기화" {...top("mesync", "내 정보 동기화")} sub={meServer
                ? `${serverLabel(meServer)} — 로그인 ${num(meBy.reduce((a, b) => a + b.login, 0))} · 다시 동기화 ${num(meBy.reduce((a, b) => a + b.sync, 0))} · ${num(meBy.length)}명`
                : `로그인 ${num(data.me_sync.login)} · 다시 동기화 ${num(data.me_sync.sync)} · ${num(data.me_sync.people)}명 — 누가 = 방문자 익명 id (닉네임은 받지 않는다) · 유입 = 이 기간 첫 로그인 세션이 들어온 곳`} >
                {/* 정렬은 드롭다운으로, '상위 n' 과 같은 줄 오른쪽 (사용자 지시 2026-10-08) */}
                <Dropdown ariaLabel="정렬" label={meSort === "last" ? "최신순" : meSort === "sync" ? "다시 동기화순" : "횟수순"} selected={[meSort]}
                  items={[{ value: "n", label: "횟수순" }, { value: "last", label: "최신순" }, { value: "sync", label: "다시 동기화순" }]} onPick={(v) => setMeSort(v as "n" | "last" | "sync")} />
              </Head>
              {/* 서버별 인원 — 버튼 줄로 늘 보이고 누르면 그 서버만. 중섭은 직영·비리비리를 0명이어도 따로 둔다
                  (사용자 지시 2026-10-07 — 비리비리가 안 보여 합쳐진 줄 알았다. 종전 드롭다운은 기록 있는 서버만 나왔다) */}
              <div className="vz-mesync-filter vz-srv-chips" role="group" aria-label="서버">
                <span>서버</span>
                {[{ value: "", label: "전체" },
                  ...ACCOUNT_SERVERS.map((x) => ({ value: x.code, label: x.label })),
                  ...meServers.filter((c) => !ACCOUNT_SERVERS.some((x) => x.code === c)).map((c) => ({ value: c, label: c }))].map((o) => {
                  const cnt = o.value ? data.me_sync!.by.filter((b) => b.server === o.value).length : data.me_sync!.by.length;
                  return (
                    <button key={o.value || "all"} type="button" className={`${meServer === o.value ? "selected" : ""}${cnt ? "" : " zero"}`}
                      onClick={() => setMeServer(o.value)}>{o.label} <b>{num(cnt)}</b></button>
                  );
                })}
              </div>
              {meBy.length ? meTable(tops.mesync) : <p className="vz-note">{meServer ? "이 서버의 동기화 기록이 없습니다." : "이 기간에는 동기화 기록이 없습니다."}</p>}
            </div>
          )}

          {(range ? fine : days === 0) ? (() => {
            // 시각 칸 그래프 — 15·30·60분 (세션 시작 시각 KST). 구간 시작~끝(오늘이면 지금)까지 빈 칸도 0 으로 채운다.
            // 칸을 골라 둔 동안 data 는 그 칸치라, 그래프는 고르기 전에 쥐어 둔 묶음으로 그린다
            const src = (slot ? saved : data) ?? data;
            const stepMs = step * 60_000;
            // 옛 DB 함수(시각 칸 없음)면 하루 순번 15분 칸(quarter)을 시각으로 바꿔 쓴다 — 30·60분은 더해서(방문자는 근사)
            const legacy = (): Bucket[] | undefined => {
              if (!src.quarter || spanStart == null) return undefined;
              const day0 = kstMs(range?.from ?? todayStr) / 1000;
              const m = new Map<number, Bucket>();
              for (const r of src.quarter) {
                const t = Math.floor((day0 + r.q * 900) * 1000 / stepMs) * stepMs / 1000;
                const c = m.get(t) ?? { t, sessions: 0, visitors: 0, views: 0 };
                c.sessions += r.sessions; c.visitors += r.visitors; c.views += r.views; m.set(t, c);
              }
              return [...m.values()];
            };
            const arr = src[`b${step}` as "b15" | "b30" | "b60"] ?? legacy();
            if (!arr || spanStart == null || spanEnd == null) return <p className="vz-note">시각 칸 그래프는 DB 함수 갱신(바탕화면 visits-시각칸.sql)이 필요합니다.</p>;
            const end = Math.min(spanEnd, Date.now());
            const slots: number[] = [];
            for (let t = Math.floor(spanStart / stepMs) * stepMs; t < end; t += stepMs) slots.push(t / 1000);
            const by = new Map(arr.map((r) => [r.t, r] as const));
            const kst = (sec: number) => new Date(sec * 1000 + 9 * 3600_000);
            const sameDay = kst(slots[0] ?? 0).getUTCDate() === kst(slots[slots.length - 1] ?? 0).getUTCDate();
            const lab = (sec: number) => {
              const d = kst(sec), hm = `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
              return sameDay ? hm : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}`;
            };
            const spanLabel = !range ? "오늘" : `${range.from.slice(5).replace("-", "/")}${range.fromT ? ` ${range.fromT}` : ""}${range.to !== range.from || range.toT ? ` ~ ${range.to !== range.from ? range.to.slice(5).replace("-", "/") + " " : ""}${range.toT ?? "24:00"}` : ""}`;
            const every = Math.max(1, Math.round((slots.length * stepMs > 24 * 3600_000 ? 6 : 2) * 60 / step));
            const selIdx = slot ? slots.indexOf(slot.t) : -1;
            return (
              <>
                <Head title={`${spanLabel} ${step === 60 ? "1시간" : `${step}분`}별`} sub={`세션이 시작된 시각 기준 (KST) · 칸을 누르면 그 ${step === 60 ? "1시간" : `${step}분`}만 본다`}>
                  {slot && (
                    <button type="button" className="vz-slot-chip" onClick={() => setSlot(null)} title="구간 전체로 돌아가기">
                      {lab(slot.t)}~{lab(slot.t + slot.step * 60)} 만 보는 중 <b aria-hidden>×</b>
                    </button>
                  )}
                  <Dropdown ariaLabel="칸 크기" label={step === 60 ? "1시간 칸" : `${step}분 칸`} selected={[String(step)]}
                    items={([15, 30, 60] as const).map((v) => ({ value: String(v), label: v === 60 ? "1시간" : `${v}분` }))}
                    onPick={(v) => setStep(Number(v) as 15 | 30 | 60)} />
                </Head>
                <LineChart days={slots.map(String)} every={every}
                  sel={selIdx >= 0 ? selIdx : null}
                  onPick={(i) => setSlot((cur) => (cur && cur.t === slots[i] ? null : { t: slots[i], step }))}
                  fmt={(v) => lab(Number(v))} tip={(v) => `${lab(Number(v))}부터 ${step === 60 ? "1시간" : `${step}분`}`} series={[
                  { name: "방문자", cls: "s1", values: slots.map((t) => by.get(t)?.visitors ?? 0), axis: "right" },
                  { name: "세션", cls: "s2", values: slots.map((t) => by.get(t)?.sessions ?? 0), axis: "right" },
                  { name: "화면 조회", cls: "s3", values: slots.map((t) => by.get(t)?.views ?? 0) },
                ]} />
              </>
            );
          })() : (
            <>
              <h3 className="vz-h">일별 추이</h3>
              <LineChart days={filled.map((d) => d.day)} series={[
                { name: "방문자", cls: "s1", values: filled.map((d) => d.visitors), axis: "right" },
                { name: "세션", cls: "s2", values: filled.map((d) => d.sessions), axis: "right" },
                { name: "화면 조회", cls: "s3", values: filled.map((d) => d.views) },
              ]} />
            </>
          )}

          <div className="vz-cols">
            <div>
              <Head title="유입원" {...top("src", "유입원")} />
              <BarList top={tops.src} rows={barRows.src} />
              {data.ref.length > 0 && (
                <>
                  <Head title="경로까지 온 리퍼러" sub={`${data.ref.length}개`} {...top("ref", "경로까지 온 리퍼러")} />
                  <BarList top={tops.ref} rows={barRows.ref} />
                </>
              )}
            </div>
            <div>
              <Head title="첫 화면 (랜딩)" {...top("landing", "첫 화면 (랜딩)")} />
              <BarList top={tops.landing} rows={barRows.landing} />
            </div>
          </div>

          <Head title="동선 흐름" sub="띠 굵기 = 세션 수. 갈래 단위라 모달·같은 갈래 안의 이동은 한 칸으로 친다. 줄에 올리면 수가 나온다" />
          <Sankey flow={data.flow} />

          <Head title="화면 순위" sub={`${data.pages.length}개 화면`} {...top("pages", "화면 순위")} />
          {pageTable(tops.pages)}

          <div className="vz-cols">
            <div>
              <Head title="갈래별 (모달 포함)" {...top("sections", "갈래별 (모달 포함)")} />
              <BarList top={tops.sections} rows={barRows.sections} />
            </div>
            <div>
              <Head title="요일·시간 (KST)" />
              <Heatmap cells={data.hours} />
            </div>
          </div>

          {/* 기기·사이트 언어는 따로 한 줄 — 위 칸 길이와 상관없이 두 제목 높이가 맞는다 */}
          <div className="vz-cols">
            <div>
              <Head title="기기" {...top("device", "기기")} />
              <BarList top={tops.device} rows={barRows.device} />
            </div>
            <div>
              <Head title="사이트 언어" {...top("lang", "사이트 언어")} />
              <BarList top={tops.lang} rows={barRows.lang} />
            </div>
          </div>

          <div className="vz-cols">
            <div>
              <Head title="시간대 (나라 대신)" {...top("tz", "시간대 (나라 대신)")} />
              <BarList top={tops.tz} rows={barRows.tz} />
            </div>
            <div>
              <Head title="눌러서 나간 바깥 링크" {...top("out", "눌러서 나간 바깥 링크")} />
              <BarList top={tops.out} rows={barRows.out} />
            </div>
          </div>

          <Head title="세션 타임라인" sub="한 줄이 한 사람의 동선 · 최근 순. 시간은 조작 시간(없으면 보인 시간)" {...top("sessions", "세션 타임라인")}>
            <Dropdown
              label={srcFilter || "유입원 전체"}
              items={[{ value: "", label: "유입원 전체" }, ...data.src.map((r) => ({ value: r.src, label: r.src, count: r.sessions }))]}
              selected={[srcFilter]}
              onPick={setSrcFilter}
              ariaLabel="세션 타임라인 유입원"
              scroll
            />
          </Head>
          {sessions == null ? <p className="vz-empty">불러오는 중…</p> : (
            <>
              <ol className="vz-sessions">{sessions.map((s) => <SessionLine key={s.id} s={s} />)}</ol>
              
            </>
          )}
        </>
      )}
      {allOf && (
        <AllWindow key={allOf.key} title={allOf.title} total={allTotal} loading={allOf.key === "sessions" && allSessions == null}
          render={allRender} onClose={() => setAllOf(null)} />
      )}
    </section>
  );
}
