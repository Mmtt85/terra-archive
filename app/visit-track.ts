"use client";

// 방문 동선 기록 (사용자 요청 2026-10-04 — "어디로 유입돼서 어느 페이지를 열었고 어디에 몇 초간 머물렀고").
// 설계·표 구조의 정본은 docs/supabase-visits.sql 이다. 통계는 /admin '방문' 탭이 그래프로 보여 준다.
//
// 보내는 곳은 **방문 기록 전용 Supabase 프로젝트**(본 프로젝트와 따로 — 무료 DB 500MB 를 넘으면 통째로
// 읽기 전용이 되므로, 방문 기록이 넘쳐도 제안 게시판·업데이트 내역이 멈추지 않게). 주소가 비어 있으면
// 아무것도 하지 않는다.
//
// 무엇을 재나
//   · 세션(탭 하나) — 첫 화면, 유입 도메인, utm, 기기·언어·시간대, 재방문 여부. 탭을 닫기 전까지는 문서가
//     새로 로드돼도(상세 페이지는 경로라 새 문서다) sessionStorage 로 같은 세션이 이어진다.
//   · 화면 — 주소(경로+해시)가 바뀔 때마다 한 화면. 모달 딥링크(#st-… 등)도 화면으로 센다.
//     보인 시간(탭이 화면에 있던 시간)과 조작 시간(그중 30초 안에 입력이 있던 시간)을 따로 잰다.
//   · 바깥 링크를 누르면 그 주소, 본문을 어디까지 내렸는지(%).
// 보내는 법 — 화면을 떠날 때·탭을 내릴 때 **그사이 늘어난 몫만** 한 행으로 보낸다(추가 전용. 익명 키에
//   UPDATE 를 열지 않는다). 서버가 같은 (session, seq) 를 합친다.
// 안 보내는 것 — IP·계정·위치. 방문자 구분은 localStorage 의 무작위 id 하나뿐이다.
//
// **운영자 본인은 기록하지 않는다** (사용자 지시 2026-10-04 "내 움직임은 통계에 들어가면 안돼") —
//   ① 제안 게시판 관리자 모드가 켜진 브라우저(localStorage 에 관리자 키, feedback.ts getBoardAdminKey)
//   ② admin.terra-archive.net 을 연 적 있는 브라우저 — 어드민 페이지가 terra-archive.net 전체에 거는
//      'ta-no-track' 쿠키(1년). 어드민은 Cloudflare Access 뒤라 운영자만 이 쿠키를 받는다.
//   세션 도중에 관리자 모드를 켜면 그 순간부터 더 보내지 않는다.
//
// 화면 전환은 history 함수를 가로채지 않고 **주소를 1초마다 본다** — 사이트 곳곳이 pushState 를 직접
// 부르고 vinext 도 그 함수를 덧씌우고 있어서(hash-modal.ts 주석), 가로채기는 서로 꼬일 수 있다.

import { getBoardAdminKey } from "./feedback";

export const VISITS_URL = "https://ytulglqiwcwufeyguvrj.supabase.co";        // 방문 기록 전용 Supabase 프로젝트 주소 (https://<ref>.supabase.co)
export const VISITS_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0dWxnbHFpd2N3dWZleWd1dnJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwODgxMDMsImV4cCI6MjEwNjY2NDEwM30.N0bLhSrTtqoP3xOcYcnZfa32grznXN7LBcbp26OqX7E";   // 그 프로젝트의 anon 공개 키

const LIVE_HOST = "terra-archive.net";
const SESSION_KEY = "ta-visit";        // sessionStorage — 탭 세션
const VISITOR_KEY = "ta-visitor";      // localStorage — 재방문 판정용 익명 id
const DEBUG_KEY = "ta-visit-debug";    // localStorage 에 '1' 이면 localhost 에서도 env='dev' 로 보낸다(주소가 비면 콘솔에만)
const IDLE_MS = 30_000;                // 마지막 입력 뒤 이만큼 지나면 '조작 시간'에서 뺀다
const TICK_MS = 1_000;
export const NO_TRACK_COOKIE = "ta-no-track";   // 어드민 페이지가 거는 '운영자 브라우저' 표식

/** 운영자 본인 브라우저인가 — 그러면 아무것도 보내지 않는다 */
function isOwner(): boolean {
  if (getBoardAdminKey()) return true;
  try { return document.cookie.split("; ").some((c) => c === `${NO_TRACK_COOKIE}=1`); } catch { return false; }
}

/** 어드민 페이지가 부른다 — terra-archive.net 과 그 아래 모든 주소에 '운영자' 표식을 1년 건다 */
export function markOwnerBrowser(): void {
  if (!/(^|\.)terra-archive\.net$/.test(location.hostname)) return;   // localhost 에선 도메인 쿠키를 못 건다
  document.cookie = `${NO_TRACK_COOKIE}=1; domain=.terra-archive.net; path=/; max-age=31536000; secure; samesite=lax`;
}

type Sess = { id: string; start: number; seq: number; sent: boolean };
type View = {
  seq: number; path: string; hash: string | null; t0: number;
  vis: number; act: number; sentVis: number; sentAct: number;
  scroll: number; touched: boolean; out: string | null; sentOnce: boolean;
};

let started = false;
let env: "live" | "dev" = "live";
let sess: Sess | null = null;
let view: View | null = null;
let lastInput = 0;
let lastTick = 0;

const uuid = () =>
  crypto?.randomUUID?.() ??
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);

function readSess(): Sess | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Sess) : null;
  } catch { return null; }
}
function saveSess(): void {
  try { if (sess) sessionStorage.setItem(SESSION_KEY, JSON.stringify(sess)); } catch { /* 프라이빗 모드 */ }
}

let muted = false;

function post(table: "visit_session" | "visit_view", rows: object[]): void {
  if (!rows.length || muted) return;
  if (isOwner()) { muted = true; return; }   // 도중에 관리자 모드를 켰다
  if (!VISITS_URL) {
    if (env === "dev") console.debug(`[visit] ${table} ${JSON.stringify(rows)}`);   // 프로젝트 연결 전 시험 — 콘솔에만
    return;
  }
  void fetch(`${VISITS_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: VISITS_ANON_KEY,
      Authorization: `Bearer ${VISITS_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
    keepalive: true,   // 탭을 닫는 순간에도 끊기지 않게 (omni-picks.ts 와 같은 방식)
  }).catch(() => { /* 오프라인·차단 — 버린다 */ });
}

function device(): "mobile" | "tablet" | "desktop" {
  const coarse = matchMedia("(pointer: coarse)").matches;
  if (!coarse) return "desktop";
  return Math.min(screen.width, screen.height) >= 600 ? "tablet" : "mobile";
}

function sendSession(locale: string): void {
  if (!sess || sess.sent) return;
  let revisit = false;
  let visitor = "";
  try {
    visitor = localStorage.getItem(VISITOR_KEY) ?? "";
    revisit = !!visitor;
    if (!visitor) { visitor = uuid(); localStorage.setItem(VISITOR_KEY, visitor); }
  } catch { visitor = uuid(); }
  let refHost: string | null = null;
  let ref: string | null = null;
  try {
    if (document.referrer) {
      const r = new URL(document.referrer);
      if (r.host !== location.host) { refHost = r.host; ref = r.href; }
    }
  } catch { /* 이상한 리퍼러 */ }
  const q = new URLSearchParams(location.search);
  post("visit_session", [{
    id: sess.id,
    visitor,
    landing: clip(location.pathname + location.hash, 300),
    ref_host: clip(refHost, 120),
    ref: clip(ref, 300),
    utm_source: clip(q.get("utm_source"), 60),
    utm_medium: clip(q.get("utm_medium"), 60),
    utm_campaign: clip(q.get("utm_campaign"), 80),
    site_lang: locale === "en" || locale === "ja" ? locale : "ko",
    lang: clip(navigator.language, 20),
    tz: clip(Intl.DateTimeFormat().resolvedOptions().timeZone, 60),
    device: device(),
    vw: innerWidth,
    vh: innerHeight,
    dark: document.documentElement.classList.contains("dark"),
    revisit,
    env,
  }]);
  sess.sent = true;
  saveSess();
}

/** 지금 화면에서 그사이 늘어난 몫을 한 행으로 보낸다 */
function flush(): void {
  if (!sess || !view) return;
  const v = view;
  const dVis = v.vis - v.sentVis;
  const dAct = v.act - v.sentAct;
  if (v.sentOnce && dVis < 500 && dAct <= 0 && !v.out && !v.touched) return;
  post("visit_view", [{
    session: sess.id,
    seq: v.seq,
    t0: v.t0,
    path: clip(v.path, 300),
    hash: clip(v.hash, 200),
    visible_ms: Math.round(dVis),
    active_ms: Math.round(dAct),
    scroll: Math.round(v.scroll),
    interacted: v.touched,
    out_href: clip(v.out, 300),
  }]);
  v.sentVis = v.vis; v.sentAct = v.act; v.touched = false; v.out = null; v.sentOnce = true;
}

const here = () => location.pathname + location.hash;

function beginView(): void {
  if (!sess) return;
  sess.seq += 1;
  saveSess();
  view = {
    seq: sess.seq, path: location.pathname, hash: location.hash || null,
    t0: Math.max(0, Math.round((Date.now() - sess.start) / 1000)),
    vis: 0, act: 0, sentVis: 0, sentAct: 0, scroll: 0, touched: false, out: null, sentOnce: false,
  };
  requestAnimationFrame(() => measureScroll());
}

function scroller(): Element | null {
  return document.querySelector(".site-scroll") ?? document.scrollingElement;
}

function measureScroll(target?: EventTarget | null): void {
  if (!view) return;
  const el = target instanceof Element ? target : scroller();
  if (!el) return;
  // 본문 스크롤만 센다 — 모달·목록 안쪽 스크롤은 '페이지를 어디까지 읽었나'가 아니다
  if (target instanceof Element && target !== scroller()) return;
  const pct = el.scrollHeight <= el.clientHeight + 4 ? 100 : ((el.scrollTop + el.clientHeight) / el.scrollHeight) * 100;
  if (pct > view.scroll) view.scroll = Math.min(100, pct);
}

function tick(): void {
  const now = Date.now();
  const dt = Math.min(now - lastTick, 2 * TICK_MS);   // 백그라운드 스로틀링으로 벌어진 간격은 세지 않는다
  lastTick = now;
  if (!view) return;
  if (here() !== view.path + (view.hash ?? "")) {     // 주소가 바뀌었다 → 화면 전환
    flush();
    beginView();
    return;
  }
  if (document.visibilityState !== "visible") return;
  view.vis += dt;
  if (now - lastInput < IDLE_MS) view.act += dt;
}

function onInput(): void {
  lastInput = Date.now();
  if (view) view.touched = true;
}

function onClick(e: MouseEvent): void {
  onInput();
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || !view) return;
  try {
    const url = new URL(a.href, location.href);
    if (url.host && url.host !== location.host && /^https?:$/.test(url.protocol)) {
      view.out = url.href;
      flush();
    }
  } catch { /* ignore */ }
}

/** 한 번만 켠다 (Home 이 마운트될 때). 라이브 도메인 + 자동화 브라우저가 아닐 때만. */
export function startVisitTrack(locale: string): void {
  if (started || typeof window === "undefined") return;
  if (navigator.webdriver) return;
  let debug = false;
  try { debug = localStorage.getItem(DEBUG_KEY) === "1"; } catch { /* ignore */ }
  if (location.hostname === LIVE_HOST) env = "live";
  else if (debug) env = "dev";
  else return;
  if (!VISITS_URL && env === "live") return;
  if (isOwner()) return;
  started = true;

  sess = readSess() ?? { id: uuid(), start: Date.now(), seq: -1, sent: false };
  saveSess();
  sendSession(locale);
  lastTick = Date.now();
  beginView();

  for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"]) {
    addEventListener(type, onInput, { capture: true, passive: true });
  }
  // 스크롤 자체는 입력으로 치지 않는다 — 화면 전환 때 vinext 가 .site-scroll 을 맨 위로 되감는 것도 scroll 이라
  // 크롤러가 '사람'으로 보인다. 손으로 내리면 wheel·touchstart·keydown 이 먼저 온다.
  document.addEventListener("scroll", (e) => measureScroll(e.target), { capture: true, passive: true });
  document.addEventListener("click", onClick, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
    lastTick = Date.now();
  });
  addEventListener("pagehide", flush);
  // 뒤로가기 캐시(bfcache)에서 되살아난 문서 — 그사이 같은 탭의 다른 문서가 순번을 올렸을 수 있다
  addEventListener("pageshow", (e) => {
    if (!(e as PageTransitionEvent).persisted) return;
    sess = readSess() ?? sess;
    lastTick = Date.now();
    beginView();
  });
  setInterval(tick, TICK_MS);
}
