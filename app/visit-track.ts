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
// 안 보내는 것 — IP·위치·닉네임. 방문자 구분은 localStorage 의 무작위 id 이고, 내 정보로 로그인한 사람만 그 게임 계정(서버·UID)을
//   방문자와 잇는다 — 서버·UID 만, 닉네임은 안 보낸다 (visit_player, 2026-10-14 "로그인한 사람은 UID 로, 아닌 사람은 기존처럼").
//
// **운영자 본인은 기록하지 않는다** (사용자 지시 2026-10-04 "내 움직임은 통계에 들어가면 안돼") —
//   ① 내 정보로 관리자 UID(OWNER_UIDS)에 로그인한 브라우저 — 2026-10-14~. 종전의 관리 사이트 'ta-no-track' 쿠키는 없앴다
//   ② 관리자 키가 있는 브라우저(관리자 UID 로그인 때 계정 워커가 내준다, feedback.ts getBoardAdminKey)
//   ③ 로컬 dev(localhost) 화면에서 링크로 들어온 화면 (2026-10-06)
//   세션 도중에 관리자가 되면 그 순간부터 더 보내지 않는다.
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
const BEAT_MS = 60_000;   // 열린 탭의 중간 전송 주기 (어드민 '조작 중' 판정)
let lastBeat = Date.now();

/** 관리자 게임 UID — 내 정보로 이 계정에 로그인한 브라우저가 운영자다 (사용자 지시 2026-10-14 "내 UID 로 로그인하면 관리자, 기존 판정은 다 지워").
 *  관리자 기능의 실제 권한(관리자 키)은 계정 워커가 서명된 표로 확인해 내준다(app/cloud-prefs.tsx) — 여기는 통계 제외·화면 표시용 판정이다 */
export const OWNER_UIDS = new Set(["07799010"]);
export function isOwnerUid(): boolean {
  try {
    const uid = (JSON.parse(localStorage.getItem("ta:me") ?? "null") as { player?: { uid?: string | number } } | null)?.player?.uid;
    return uid != null && OWNER_UIDS.has(String(uid));
  } catch { return false; }
}

/** 운영자 본인 브라우저인가 — 그러면 아무것도 보내지 않는다.
 *  종전엔 관리 사이트가 거는 'ta-no-track' 쿠키·제안 창에 넣은 관리자 키로 가렸다 — 2026-10-14 관리자 UID 로그인으로 바꿨다 */
function isOwner(): boolean {
  if (isOwnerUid() || getBoardAdminKey()) return true;
  // 로컬 dev(localhost·127.0.0.1)에서 링크를 눌러 들어온 화면 — 로컬 관리 화면에서 라이브를 열어 본 운영자다 (2026-10-06)
  try {
    if (document.referrer && /^(localhost|127\.0\.0\.1)$/.test(new URL(document.referrer).hostname)) return true;
  } catch { /* 이상한 리퍼러 */ }
  return false;
}

/** 운영자 브라우저인가 (밖에서 쓰는 판정) — 시험 중인 기능을 운영자에게만 보일 때 쓴다 (PRTS 작은 창, 2026-10-12).
 *  로컬 dev 도 운영자다 */
export function isOwnerBrowser(): boolean {
  if (typeof window === "undefined") return false;
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return true;
  return isOwner();
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
// 이 탭의 방문자 id — 저장소(localStorage)에 못 쓰는 브라우저(사파리 개인 정보 보호·앱 안 브라우저)에서도 세션과 같은 id 로 이어 쓴다.
// 종전엔 세션은 새 id 로 남고, 그 뒤 기록(로그인·동기화·PRTS)은 저장소에서 다시 읽다가 비어 방문자 없이 남았다 (2026-10-15 실측)
let memVisitor = "";
const visitorId = (): string => { try { return localStorage.getItem(VISITOR_KEY) || memVisitor; } catch { return memVisitor; } };
let view: View | null = null;
let lastInput = 0;
let lastTick = 0;
// 화면을 안 봐도 쓰는 중인 기능 — 게임 연결(PRTS, lens/bridge.ts)이 켜져 있으면 게임 창이 브라우저를 덮고 있어도
// 그 시간을 보인 시간·조작 시간으로 센다 (사용자 지시 2026-10-05). 가려진 채 오래 돌므로 1분마다 중간 전송한다.
let holds = 0;
let lastHoldFlush = 0;
export function holdVisitActive(on: boolean): void {
  holds = Math.max(0, holds + (on ? 1 : -1));
  if (on && view) view.touched = true;
  lastTick = Date.now();
  lastHoldFlush = Date.now();
}

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

function post(table: "visit_session" | "visit_view" | "visit_event" | "prts_scan" | "visit_player", rows: object[]): void {
  if (!rows.length) return;
  // PRTS 인식 기록은 관리자 브라우저에서도 보낸다 — 운영자가 직접 테스트하며 '틀렸어요'를 누르기 때문
  // (사용자 지시 2026-10-12 "내가 보낸 거라도 받을 수 있게"). 방문자 칸이 'owner' 라 어드민에서 구분된다
  if (table !== "prts_scan") {
    if (muted) return;
    if (isOwner()) { muted = true; return; }   // 도중에 관리자 모드를 켰다
  }
  if (!VISITS_URL) {
    if (env === "dev") console.debug(`[visit] ${table} ${JSON.stringify(rows)}`);   // 프로젝트 연결 전 시험 — 콘솔에만
    return;
  }
  // visit_player 는 같은 (방문자, 서버, UID) 를 여러 번 보낸다 — 두 번째부터는 기본키 중복(409)으로 DB 가 거절하고 여기선 버린다.
  // ⚠ '이미 있으면 무시'(on_conflict + resolution=ignore-duplicates)는 쓰면 안 된다 — 중복 확인에 읽기 권한이 필요해
  //   익명 쓰기가 RLS 에 통째로 막혔다 (2026-10-14 실측: 표가 빈 채로 남았다)
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

/** 어떤 브라우저로 왔나 — 'Chrome/Android' 꼴 (사용자 지시 2026-10-19 "무슨 브라우저로 들어왔는지도"). 인앱 브라우저를 먼저 가른다.
 *  UA 문자열 통째로는 보내지 않는다 — 이름 하나면 충분하고 모으는 건 적을수록 좋다 */
function browserName(): string {
  const ua = navigator.userAgent;
  const name = /KAKAOTALK/i.test(ua) ? "KakaoTalk" : /NAVER\(inapp/i.test(ua) ? "NaverApp" : /DaumApps/i.test(ua) ? "DaumApp"
    : /Instagram/i.test(ua) ? "Instagram" : /FBAN|FBAV/i.test(ua) ? "Facebook" : /\bLine\//i.test(ua) ? "Line" : /Discord/i.test(ua) ? "Discord"
    : /SamsungBrowser/i.test(ua) ? "Samsung" : /Whale/i.test(ua) ? "Whale" : /EdgA?\/|EdgiOS/i.test(ua) ? "Edge" : /OPR\/|Opera/i.test(ua) ? "Opera"
    : /Firefox|FxiOS/i.test(ua) ? "Firefox" : /CriOS|Chrome\//i.test(ua) ? "Chrome" : /Safari/i.test(ua) ? "Safari" : "기타";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) ? "iOS"
    : /Windows/i.test(ua) ? "Windows" : /Mac OS X/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "";
  return os ? `${name}/${os}` : name;
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
  memVisitor = visitor;
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
    landing: clip(trackPath() + location.hash, 300),
    ref_host: clip(refHost, 120),
    ref: clip(ref, 300),
    utm_source: clip(q.get("utm_source"), 60),
    utm_medium: clip(q.get("utm_medium"), 60),
    utm_campaign: clip(q.get("utm_campaign"), 80),
    site_lang: locale === "en" || locale === "ja" ? locale : "ko",
    lang: clip(navigator.language, 20),
    tz: clip(Intl.DateTimeFormat().resolvedOptions().timeZone, 60),
    device: device(),
    browser: clip(browserName(), 40),
    vw: innerWidth,
    vh: innerHeight,
    dark: document.documentElement.classList.contains("dark"),
    revisit,
    env,
  }]);
  sess.sent = true;
  notePlayer();   // 이미 로그인해 둔 사람 — 세션마다 한 번 (중복은 DB 가 버린다)
  saveSess();
}

/** 일이 있었다고 한 줄 남긴다 — '내 정보' 로그인·다시 동기화 (사용자 요청 2026-10-05 "누가, 몇 번 했는지"), 헤더 이벤트 칩 클릭(ev_chip, 2026-10-14).
 *  누가 = 방문 기록과 같은 익명 방문자 id. 닉네임·계정 정보는 보내지 않는다. */
/** 내 정보로 로그인한 게임 계정 — 방문자(브라우저 익명 id)와 잇는다. 관리자 세션 타임라인이 그 사람을 UID·닉네임으로 알아보게
 *  (사용자 지시 2026-10-14 "방문 통계도 로그인한 사람은 UID 로, 아닌 사람은 기존처럼"). me-store 를 import 하면 순환이라 저장분을 직접 읽는다 */
function notePlayer(given?: { server: string; uid: string }): void {
  if (!started) return;
  try {
    const visitor = visitorId();
    // 로그인 직후엔 넘겨받은 계정을 그대로 — 저장소에 못 쓰는 브라우저는 ta:me 를 다시 읽어도 비어 있다
    let server = given?.server ?? "", uid = given?.uid ?? "";
    if (!uid) {
      const me = JSON.parse(localStorage.getItem("ta:me") ?? "null") as { server?: string; player?: { uid?: string | number } } | null;
      uid = me?.player?.uid != null ? String(me.player.uid) : "";
      server = me?.server ?? "";
    }
    if (!visitor || !uid || !server) return;
    // 닉네임은 보내지 않는다 — 알아보는 데 UID 면 충분하고, 모으는 건 적을수록 좋다 (사용자 지시 2026-10-14 "닉네임은 필요 없지 않나")
    post("visit_player", [{ visitor: clip(visitor, 64), server: clip(server, 8), uid: clip(uid, 24), env }]);
  } catch { /* 저장 막힘 */ }
}

export function noteVisitEvent(kind: "me_login" | "me_sync" | "me_logout" | "me_reset" | "prts_start" | "prts_end" | "leave" | "ev_chip", server?: string, extra?: { detail?: string; dur?: number; uid?: string }): void {
  if (!started) return;
  const visitor = visitorId();
  // 로그인·동기화 — 계정을 넘겨받았으면 바로, 아니면 saveMe 가 저장한 뒤(한 박자 늦게) 읽어서 잇는다
  if (kind === "me_login" || kind === "me_sync") {
    if (extra?.uid && server) notePlayer({ server, uid: extra.uid }); else setTimeout(() => notePlayer(), 0);
  }
  post("visit_event", [{ session: sess?.id ?? uuid(), visitor: clip(visitor, 64), kind, server: clip(server ?? null, 8), env,
    ...(extra?.detail ? { detail: clip(extra.detail, 40) } : {}),
    ...(extra?.dur != null ? { dur_ms: Math.max(0, Math.min(86_400_000, Math.round(extra.dur))) } : {}) }]);
}

// PRTS 링크 인식 기록 (2026-10-12, 사용자 지시 "얼마나 걸렸나 제대로 인식이 됐나") — 인식 1번 = scan 한 줄,
// '틀렸어요'(wrong)·손으로 바로잡음(fix)은 그 scan 을 ref 로 가리키는 줄. 그림·OCR 원문은 보내지 않는다 (lens/bridge.ts).
export type PrtsScanRow = {
  id: string; kind: "scan" | "wrong" | "fix" | "shot"; ref?: string; page?: string; topic?: string; result?: string;
  section?: string; target?: string; note?: string; seen?: string; img?: string; ms?: number; ocr_ms?: number; cached?: boolean; w?: number; h?: number; crop?: number;
};
export const prtsScanId = () => uuid();
let prtsReady = false;
let prtsSession = "";
export function notePrtsScan(r: PrtsScanRow): void {
  if (!started && !prtsReady) return;
  let visitor = "";
  if (isOwner()) visitor = "owner";
  else visitor = visitorId();
  // 관리자는 방문 세션이 없다 — 이 탭 동안 쓰는 세션 id 를 따로 만든다
  if (!sess && !prtsSession) prtsSession = uuid();
  const ms = (v?: number) => (v == null ? null : Math.max(0, Math.min(600_000, Math.round(v))));
  const px = (v?: number) => (v == null ? null : Math.max(0, Math.min(20_000, Math.round(v))));
  post("prts_scan", [{
    id: r.id, session: sess?.id ?? prtsSession, visitor: clip(visitor, 64), env, kind: r.kind, ref: r.ref ?? null,
    page: clip(r.page, 60), topic: clip(r.topic, 40), result: clip(r.result, 16), section: clip(r.section, 24),
    target: clip(r.target, 80), note: clip(r.note, 40), seen: clip(r.seen, 200), img: clip(r.img, 300), ms: ms(r.ms), ocr_ms: ms(r.ocr_ms), cached: r.cached ?? null,
    w: px(r.w), h: px(r.h), crop: r.crop == null ? null : Math.max(0, Math.min(1, Math.round(r.crop * 1000) / 1000)),
  }]);
}

// PRTS 링크(게임 연결) 사용 기록 — 연결·해제 한 번씩, 해제 때 연결 시간 (사용자 요청 2026-10-11 "PRTS 링크 사용 기록").
// 탭을 닫아 해제 단추를 못 누른 경우도 pagehide 에서 해제로 남긴다 (keepalive 전송)
let prts: { t0: number; detail: string } | null = null;
export function notePrtsStart(detail: string): void {
  if (prts) return;
  prts = { t0: Date.now(), detail };
  noteVisitEvent("prts_start", undefined, { detail });
}
export function notePrtsEnd(): void {
  if (!prts) return;
  const p = prts;
  prts = null;
  noteVisitEvent("prts_end", undefined, { detail: p.detail, dur: Date.now() - p.t0 });
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

// 통합전략 옛 링크(/rogue?topic=is3)는 경로가 /rogue 뿐이라 몇 번 테마였는지가 사라진다 — 테마 경로로 적는다
// (사용자 지시 2026-10-04 "통합전략 몇번에 접속했는지가 제일 중요". 맨 /rogue 는 1번 테마라 그대로 둔다)
function trackPath(): string {
  const p = location.pathname;
  const topic = /^\/(?:en\/|ja\/)?rogue\/?$/.test(p) ? new URLSearchParams(location.search).get("topic") : null;
  return topic && /^is\d$/.test(topic) ? p.replace(/\/?$/, `/${topic}`) : p;
}
const here = () => trackPath() + location.hash;

function beginView(): void {
  if (!sess) return;
  sess.seq += 1;
  saveSess();
  view = {
    seq: sess.seq, path: trackPath(), hash: location.hash || null,
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
  const held = holds > 0;
  if (document.visibilityState !== "visible" && !held) return;
  view.vis += dt;
  if (held || now - lastInput < IDLE_MS) view.act += dt;
  if (held && now - lastHoldFlush >= 60_000) { lastHoldFlush = now; view.touched = true; flush(); }
  // 열려 있는 탭은 1분마다 그사이 몫을 보낸다 — 떠날 때만 보내면 지금 보고 있는 화면이 기록에 없어 어드민 세션
  // 타임라인이 앞 화면 뒤에 '이탈'을 찍었다 (사용자 지시 2026-10-10 "이탈 안 했을 때는 조작 중으로")
  // ⚠ '보이기만' 하면 보내던 것을 **최근 입력이 있을 때만**으로 (2026-10-11) — 창 뒤에 깔린 채 켜 둔 탭까지 1분마다 보내
  //   어드민 '조작 중'이 2~5개에서 10~20개로 부풀었다(사용자 지적 "나간 걸 검출 못 한다"). 손을 떼면 3분 안에 '이탈'로 바뀐다
  else if (document.visibilityState === "visible" && now - lastInput < IDLE_MS && now - lastBeat >= BEAT_MS) { lastBeat = now; flush(); }
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
  // PRTS 인식·'틀렸어요'는 **어디서 누가 눌러도** 남긴다 — 언제 재현될지 모른다 (사용자 지시 2026-10-12).
  // 라이브가 아니면(localhost·미리보기) env='dev' 로 표시만 다르게 — 어드민 통계는 라이브만 세고, 틀렸어요 목록엔 다 나온다
  env = location.hostname === LIVE_HOST ? "live" : "dev";
  prtsReady = true;   // PRTS 인식 기록은 관리자도 (notePrtsScan)
  if (env === "dev" && !debug) return;   // 방문 기록 자체는 종전처럼 라이브(또는 디버그 켠 dev)만
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
  addEventListener("pagehide", notePrtsEnd);
  // 떠남 표시 — 탭을 닫으면 마지막 화면 기록이 그 순간에 찍혀 어드민 '조작 중'이 몇 분 남았다 (사용자 지적 2026-10-11).
  // 사이트 안 이동(새 문서)도 pagehide 가 나지만, 뒤이어 새 화면 기록이 오므로 어드민이 그걸 보고 무시한다
  addEventListener("pagehide", () => noteVisitEvent("leave"));
  // 뒤로가기 캐시(bfcache)에서 되살아난 문서 — 그사이 같은 탭의 다른 문서가 순번을 올렸을 수 있다
  addEventListener("pageshow", (e) => {
    if (!(e as PageTransitionEvent).persisted) return;
    sess = readSess() ?? sess;
    lastTick = Date.now();
    beginView();
  });
  setInterval(tick, TICK_MS);
}
