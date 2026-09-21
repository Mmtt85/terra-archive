"use client";

// 위수 협의 **파티 공유** — 게임의 '맹약 초대' 문구로 같은 방에 모여, 각자 고른 전략과
// 가고 싶은 맹약을 서로 본다 (사용자 요청 2026-09-21).
//
//   [kmk0im89g02bli]테라아카이브 박사님의 위수 협의: 맹약 초대 [초월 시뮬레이션]
//
// 게임이 주는 저 문구를 통째로 붙여 넣어도 되고, 대괄호 속 ID만 넣어도 된다. 방은 만들지
// 않는다 — 처음 들어오는 순간 생기고, 모두 나가면 1분 뒤 사라진다 (workers/acroom).
// **채팅은 없다.** 게임을 하면서 칠 여유가 없다는 게 사용자의 판단이다 — 보여 줄 값은
// 전략 하나 + 맹약 몇 개, 그리고 미리 정한 한마디 **신호**("연결이 끊겼어요, 죄송해요" 같은 것)
// 하나. **닉네임도 없다** (사용자 지시 "닉네임은 필요 없음") — 자리는 들어온 순서로 박사 1~4.
// 자리는 게임의 연합과 같은 4개.
//
// 서버와 주고받는 것은 id 뿐이다 (band_xxx · xxxShip · 신호 id). 이름은 각자 자기 언어의
// doc·사전에서 찾아 그리므로 한국어·영어·일본어 사용자가 한 방에 있어도 각자 제 말로 본다.
//
// ── 여기까지가 이 도구의 범위다 (사용자 확정 2026-09-21) ────────────────────────────
// 실제로 써 보니 **넷이 들어와 전략·맹약을 한 번 맞춰 보고 다 같이 나간다.** 그래서 "판이
// 도는 동안 창을 켜 두게 만들 방법"을 같이 뒤졌고, 결론은 **만들지 않는다**였다 —
// 사용자 판단: "겜 켜놓고 웹페이지 왔다갔다 하면서는 안 보게 되더라. 거기까지가 딱 이
// 도구의 목적이 맞는 거 같다." 30초 만에 합을 맞추고 게임하러 가면 도구가 제 일을 한 것이다.
//
// 그때 검토하고 **접은** 안들 — 다시 꺼내기 전에 아래를 먼저 볼 것:
//  · 목표 맹약이 겹치면 경고 → **데이터가 안 받쳐 준다.** 맹약 쌍 253개 중 69%가 겹치는
//    기물이 0개고 최대가 2개다 (실측). 경고가 뜰 일이 거의 없다.
//  · PRTS 시뮬레이션을 방에 중계(한 명만 켜면 방 전체가 밴·맹약 중첩·HP 를 실시간으로) →
//    데이터는 이미 있다 (autochess-run.ts 의 AcRun: bands[{seat,band,final}]·bans·stacks·hp).
//    **기술이 아니라 쓰임새 때문에 접었다** — 전체화면 게임 안에 있는 사람이 알트탭할 이유는
//    라운드 사이 몇 초뿐이다.
//  · 기물·맹약을 눌러 지목하는 신호("이거 너 가져") · 미니 모드 → 같은 이유로 보류.
//
// 딥링크: `/autochess#bond?p=<방ID>` — autochess.tsx 의 해시 기계가 p= 를 읽고 쓴다.
// 창은 **📌 고정된 채로 열린다** (사용자 지시) — 게임을 하면서 옆에 띄워 두는 창이라 뒤 화면을
// 가리지 않고, 바깥 클릭·Esc 로 닫히지 않는다. × 로 닫으면 방에서 나간 것이다 (연결이 끊긴다).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { asset } from "./assets";
import { ModalWindow } from "./modal-window";
import { getBoardAdminKey } from "./feedback";
import type { AcBand, AcBond, AutochessDoc } from "./autochess";

/** 방 워커 — 개발 중에는 localStorage["ta-acparty-ws"] 로 로컬 wrangler dev 를 가리킬 수 있다 */
const WS_BASE = "wss://terra-archive-acroom.nzkonaru.workers.dev";
const wsBase = () => {
  try { return localStorage.getItem("ta-acparty-ws") || WS_BASE; } catch { return WS_BASE; }
};

/** 열린 방 수 — 제목 줄의 파티 공유 버튼 오른켍에 붙는다 (사용자 요청 2026-09-21). 통계일 뿐이라 실패하면 그냥 안 보인다.
 *  마운트 때 한 번, 그 뒤 60초마다, 그리고 refreshKey(입장·나가기)가 바뀔 때 다시 읽는다.
 *  ⚠ **운영자에게만 보인다** (사용자 지시 2026-09-21: "그냥 나한테만 보이게") — 제안 게시판
 *  관리자 모드 키(localStorage `ta-feedback-admin`, app/feedback.ts)를 가진 브라우저만 읽는다.
 *  판정을 **이펙트 안에서** 하는 게 핵심이다: 렌더 중에 localStorage 를 보면 프리렌더 HTML 과
 *  어긋나고(하이드레이션), 상태로 담으면 set-state-in-effect 린트에 걸린다. 값이 비동기로
 *  오는 칩이라 "안 불러온 상태"와 "볼 자격이 없는 상태"가 화면에서 같은 모습이라 그냥 안 부른다
 *  (요청도 안 나간다). 빈 칩이 자리를 먹지 않게 하는 건 globals 의 `.ac-party-count:empty`. */
export function usePartyRoomCount(refreshKey: string | null): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!getBoardAdminKey()) return;   // 운영자 아님 — 통계를 아예 안 읽는다
    let alive = true;
    const base = wsBase().replace(/^ws/, "http");
    const load = () => {
      fetch(`${base}/stats`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { rooms?: number } | null) => { if (alive && d && typeof d.rooms === "number") setCount(d.rooms); })
        .catch(() => { /* 통계는 없어도 된다 */ });
    };
    // 입장·나가기 직후에는 장부가 한 박자 늦게 바뀐다 — 잠깐 뒤에 읽고, 빈 방이 지워지는 60초 뒤에 한 번 더
    // (사용자 지적 2026-09-21 "방 다 나가고 1분 지났는데 계속 4개" — 60초 주기론 최대 2분 묵었다)
    const first = window.setTimeout(load, 800);
    const afterWipe = window.setTimeout(load, 65_000);
    const id = window.setInterval(load, 20_000);
    return () => { alive = false; window.clearTimeout(first); window.clearTimeout(afterWipe); window.clearInterval(id); };
  }, [refreshKey]);
  return count;
}

/** 게임 초대 코드는 늘 **14자** 영숫자다 (kmk0im89g02bli). 길이가 다르면 잘못된 방으로 막는다 (사용자 지시 2026-09-21). */
const ROOMS_POLL_MS = 5_000;   // 운영자 방 목록 자동 갱신 주기 (창이 열려 있고 탭이 보일 때만)

/** `GET /admin/rooms` 한 줄 — 방 하나의 겉모습과 안에 앉은 사람들 */
type AdminRoom = { id: string; at: number; invite: string; members: PartyMember[] };
/** 일별 방 생성 집계 — 하루치가 한 줄 (`nicks` 는 닉네임 → 그날 만든 수, `unknown` 은 못 읽은 문구) */
type StatDay = { day: string; n: number; nicks: Record<string, number>; unknown: number };
const CHART_DAYS = 14;   // 막대그래프에 보여 줄 날 수 (그보다 옛날 것도 집계에는 들어간다)

export const ROOM_ID_LEN = 14;
export const ROOM_ID_RE = /^[a-z0-9]{14}$/i;
export const MAX_SEATS = 4;
/** 한 사람이 고를 수 있는 맹약 수 — 진영 하나 + 특성 둘이면 충분하다 */
export const MAX_BONDS = 3;

/** 신호 — 채팅 대신 미리 정한 한마디. id 만 오가고 글자는 각자 사전에서 (사용자 요청 2026-09-21:
 *  "연결이 끊겼어요 죄송해요 라는 느낌의 의사를 전달 가능한 버튼"). 첫 것이 그 요청이고, 옆의 둘은
 *  같은 자리에서 바로 필요해지는 짝이다. **스스로 사라지지 않는다** — 다시 눌러 내리거나 다른 신호로
 *  바꿀 때까지 남고, 올린 채 나가면 그 빈 자리에 다음 사람이 앉을 때까지 남는다 (사용자 지시). 경과 시간을 함께 적는다. */
const SIGNALS = ["dc", "wait", "ready"] as const;
type SignalId = (typeof SIGNALS)[number];
const SIGNAL_KO: Record<SignalId, string> = {
  dc: "연결이 끊겼어요, 죄송해요",
  wait: "잠시만요",
  ready: "준비됐어요",
};

/** 초대 문구 → 방 ID. 문구 맨 앞 대괄호가 우선, 없으면 문자열 전체가 ID 여야 한다. */
export function parseInvite(raw: string): string {
  const s = raw.trim();
  const head = s.match(/^\[\s*([A-Za-z0-9]+)\s*\]/) ?? s.match(/\[\s*([A-Za-z0-9]+)\s*\]/);
  if (head) return ROOM_ID_RE.test(head[1]) ? head[1].toLowerCase() : "";
  return ROOM_ID_RE.test(s) ? s.toLowerCase() : "";
}

const bondIcon = (id: string) => asset(`/ac/bond/${id}.webp`);
const bandIcon = (id: string) => asset(`/ac/band/${id}.webp`);
/** 전략 표기 — **오퍼 이름 (전략 이름)** (사용자 지시 2026-09-21). 커뮤니티가 '와파린 전략'으로 먼저 부르니
 *  대표 오퍼가 앞. .ac-bandby 가 괄호를 그린다. 대표 오퍼가 없는 전략은 이름만. */
const bandLabel = (b: AcBand) => (b.by ? <>{b.by}<em className="ac-bandby">{b.n}</em></> : b.n);
const hideErr = (ev: React.SyntheticEvent<HTMLImageElement>) => { ev.currentTarget.style.display = "none"; };

// ── 내 식별·내 선택 (브라우저에 남는 것은 이 둘뿐) ─────────────────────────
const UID_KEY = "ta-acparty-uid";
/** 내 선택은 **방마다 · 탭 세션에만** 둔다 (sessionStorage `ta-acparty-me:<방ID>`). 새로고침은 살리고,
 *  나가기·창 닫기·뒤로가기·다른 방 입장은 빈손으로 시작한다 — "누군가 나갔으면 그 슬롯의 선택
 *  내용은 초기화" (사용자 지시 2026-09-21). 지난 판의 전략·맹약이 새 판에 따라오면 조용히 틀린다. */
const meKey = (room: string) => `ta-acparty-me:${room}`;
type Me = { band: string; bonds: string[] };
const EMPTY_ME: Me = { band: "", bonds: [] };

function myUid(): string {
  try {
    const cur = localStorage.getItem(UID_KEY);
    if (cur && /^[a-z0-9-]{8,48}$/.test(cur)) return cur;
  } catch { /* noop */ }
  const uid = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
  try { localStorage.setItem(UID_KEY, uid); } catch { /* 시크릿 모드 — 이 탭에서만 유효 */ }
  return uid;
}
function loadMe(room: string): Me {
  if (!room) return EMPTY_ME;
  try {
    const v = JSON.parse(sessionStorage.getItem(meKey(room)) ?? "null");
    if (v && typeof v === "object") {
      return {
        band: typeof v.band === "string" ? v.band : "",
        bonds: Array.isArray(v.bonds) ? v.bonds.filter((x: unknown) => typeof x === "string").slice(0, MAX_BONDS) : [],
      };
    }
  } catch { /* noop */ }
  return EMPTY_ME;
}
function saveMe(room: string, me: Me) {
  if (!room) return;
  try { sessionStorage.setItem(meKey(room), JSON.stringify(me)); } catch { /* noop */ }
}
function clearMe(room: string) {
  if (!room) return;
  try { sessionStorage.removeItem(meKey(room)); } catch { /* noop */ }
}

// ── 방 연결 ─────────────────────────────────────────────────────────────────
export type PartyMember = {
  uid: string;
  /** 1 = 나간 사람이 신호를 남긴 **빈 자리** (uid 없음, 전략·맹약 없음) — 다음 사람이 앉으면 사라진다 */
  ghost?: 1;
  /** 자리 번호 0~3 — 들어올 때 정해지고 나갈 때까지 안 바뀐다 (누가 나가도 내 칸은 그 자리) */
  seat: number;
  band: string; bonds: string[];
  /** 올려 둔 신호 — k 는 SIGNALS 의 id, at 은 서버 시각 */
  sig: { k: string; at: number } | null;
  at: number; up: number;
};
type Status = "idle" | "connecting" | "online" | "reconnecting" | "full" | "expired" | "closed";
type Patch = Partial<Me> & { sig?: string };

type Conn = { room: string; gen: number; status: Status; members: PartyMember[]; uid: string; skew: number;
  /** 방에 남은 게임 초대 문구 — 누군가 통째로 붙여 넣었을 때만 있다 ('링크 복사'가 함께 싣는다) */
  invite: string };
const NO_CONN: Conn = { room: "", gen: -1, status: "idle", members: [], uid: "", skew: 0, invite: "" };

/** gen = 입장 횟수. 같은 방을 나갔다 바로 다시 들어오면 room 이 같아 지난 연결의 참가자 목록이 새
 *  상태가 오기 전까지 그대로 보였다 (실측 2026-09-21: 나가기 뒤 재입장에 옛 맹약이 남아 보임). */
function usePartyRoom(roomId: string, gen: number, meRef: React.RefObject<Me>, inviteRef: React.RefObject<string>) {
  // 방 하나의 연결 상태를 통째로 든다 — room 이 지금 방과 다르면(막 갈아탔다) 아직 아무것도
  // 모르는 것으로 본다. 효과 안에서 초기화 setState 를 하지 않기 위한 모양이다 (리포 규약).
  const [conn, setConn] = useState<Conn>(NO_CONN);
  const sendRef = useRef<(patch: Patch) => void>(() => {});
  const leaveRef = useRef<() => void>(() => {});
  const retryRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!roomId) return;
    const room = roomId;
    const patch = (p: Partial<Conn>) => setConn((cur) => (cur.room === room && cur.gen === gen ? { ...cur, ...p } : { ...NO_CONN, room, gen, status: "connecting", ...p }));
    let ws: WebSocket | null = null;
    let dead = false;          // 내가 끝냈다 — 다시 붙지 않는다
    let tries = 0;
    let timer = 0;
    let ping = 0;
    const open = () => {
      if (dead) return;
      if (tries) patch({ status: "reconnecting" });   // 첫 시도의 '연결 중'은 파생 기본값이 맡는다
      const onclose = () => {
        window.clearInterval(ping);
        if (dead) return;
        patch({ status: "reconnecting" });
        timer = window.setTimeout(open, Math.min(15_000, 1000 * 2 ** Math.min(tries++, 4)));
      };
      try { ws = new WebSocket(`${wsBase()}/room/${room}`); } catch { onclose(); return; }
      ws.onopen = () => {
        tries = 0;
        const me = meRef.current ?? EMPTY_ME;
        ws?.send(JSON.stringify({ t: "hello", uid: myUid(), band: me.band, bonds: me.bonds, invite: inviteRef.current || undefined }));
        // 25초 keepalive — 워커의 자동 pong 이라 인스턴스를 깨우지 않는다
        ping = window.setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send("ping"); }, 25_000);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string" || ev.data === "pong") return;
        let m: { t?: string; uid?: string; members?: PartyMember[]; invite?: string };
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === "welcome" && m.uid) patch({ uid: m.uid });
        else if (m.t === "state" && Array.isArray(m.members)) {
          // 신호 만료는 서버 시각(sig.at)으로 재는데 내 시계가 어긋날 수 있다 — 가장 최근 갱신(up)을
          // '지금'으로 보고 차이를 기억해 둔다 (정확할 필요는 없다, 3분 만료의 기준일 뿐)
          const newest = Math.max(0, ...m.members.map((x) => x.up || 0));
          patch({ status: "online", members: m.members, invite: typeof m.invite === "string" ? m.invite : "",
            ...(newest ? { skew: newest - Date.now() } : {}) });
        }
        else if (m.t === "full") { dead = true; patch({ status: "full", members: [] }); }
        // 만든 지 6시간 — 워커가 방을 닫았다 (4002). 다시 붙지 않고 안내만 남긴다
        else if (m.t === "expired") { dead = true; patch({ status: "expired", members: [] }); }
        // 운영자가 방을 정리했다 (4003) — 마찬가지로 다시 붙지 않는다
        else if (m.t === "closed") { dead = true; patch({ status: "closed", members: [] }); }
        else if (m.t === "bye") { dead = true; }
      };
      ws.onclose = onclose;
      ws.onerror = () => { /* 곧 onclose 가 따라온다 */ };
    };
    const onVisible = () => {
      // 폰이 잠들었다 깨어나면 즉시 다시 붙는다 — 백오프를 기다리지 않는다
      if (document.visibilityState !== "visible" || dead) return;
      if (!ws || ws.readyState === WebSocket.CLOSED) { window.clearTimeout(timer); tries = 0; open(); }
    };
    document.addEventListener("visibilitychange", onVisible);
    sendRef.current = (p) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "set", ...p }));
    };
    leaveRef.current = () => {
      dead = true;
      window.clearTimeout(timer);
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "leave" }));
      ws?.close();
    };
    retryRef.current = () => { dead = false; tries = 0; window.clearTimeout(timer); patch({ status: "connecting" }); open(); };
    open();
    return () => {
      // 창을 닫으면 나간 것이다 — 소켓만 닫는다 (같은 사람의 다른 탭은 워커가 그대로 둔다)
      dead = true;
      window.clearTimeout(timer);
      window.clearInterval(ping);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    };
  }, [roomId, gen, meRef, inviteRef]);

  const cur: Conn = !roomId ? NO_CONN : conn.room === roomId && conn.gen === gen ? conn : { ...NO_CONN, room: roomId, gen, status: "connecting" };
  return { status: cur.status, members: cur.members, uid: cur.uid, skew: cur.skew, invite: cur.invite, send: sendRef, leave: leaveRef, retry: retryRef };
}

/** 10초마다 갱신되는 '지금' — 신호 만료·경과 시간 표시용. 렌더 중에 Date.now() 를 부르지 않기 위해
 *  상태로 든다 (react-compiler 순수성 규칙). 첫 값은 0 이고 마운트 직후 한 번 채워진다. */
function useClock(on: boolean) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!on) return;
    const bump = () => setNow(Date.now());
    const first = window.setTimeout(bump, 0);
    const id = window.setInterval(bump, 10_000);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, [on]);
  return now;
}

// ── 창 ──────────────────────────────────────────────────────────────────────
/** 운영자 방 목록 — '방 N개' 버튼이 연다 (사용자 요청 2026-09-21: "생성돼있는 방 목록이랑,
 *  그 방 클릭하면 안에 들어가보지 않아도 알 수 있도록"). 워커의 `GET /admin/rooms` 는
 *  **자리를 먹지 않고** 방 안을 돌려주므로 4명이 찬 방도 그대로 들여다본다.
 *  ⚠ 권한은 **워커가** 판정한다 (`x-admin-key` ↔ ADMIN_KEY 시크릿). 화면에서 숨기는 것만으로는
 *  막은 게 아니다 — 여기 오는 값은 전부 서버가 통과시킨 뒤의 것이다.
 *  ⚠ **보기 전용이다.** 입장 버튼을 두지 않는다 (사용자 지시 2026-09-21 "그냥 관음만 하고
 *  싶은 거야") — 운영자가 끼면 자리를 하나 먹어 4명이 3명이 된다. 들어갈 일이 있으면 초대
 *  문구의 방 ID 로 평소처럼 입장하면 된다. */
export function AcRoomsModal({ doc, onClose }: {
  doc: AutochessDoc;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const bandById = useMemo(() => new Map(doc.bands.map((b) => [b.id, b])), [doc.bands]);
  const bondById = useMemo(() => new Map(doc.bonds.map((b) => [b.id, b])), [doc.bonds]);
  const [rooms, setRooms] = useState<AdminRoom[] | null>(null);
  const [days, setDays] = useState<StatDay[]>([]);
  const [today, setToday] = useState("");
  const [err, setErr] = useState("");
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState(false);
  const now = useClock(true);   // 렌더 중에 Date.now() 를 부르지 않는다 (react-compiler 순수성 규칙)
  /** quiet = 배경 갱신. '새로고침' 버튼을 회색으로 만들지 않고, 실패해도 **보던 목록을 지우지 않는다**
   *  — 잠깐 끊겼다고 화면이 비면 방이 사라진 것처럼 보인다. */
  const load = useCallback((quiet = false) => {
    const key = getBoardAdminKey();
    if (!key) { setErr("no-key"); setRooms([]); return; }
    if (!quiet) setBusy(true);
    fetch(`${wsBase().replace(/^ws/, "http")}/admin/rooms`, { headers: { "x-admin-key": key }, cache: "no-store" })
      .then(async (r) => {
        if (r.status === 403) { setErr("forbidden"); setRooms([]); return; }
        if (!r.ok) { setErr("net"); if (!quiet) setRooms([]); return; }
        const d = await r.json();
        setErr(""); setRooms(Array.isArray(d?.rooms) ? d.rooms : []);
        setDays(Array.isArray(d?.days) ? d.days : []);
        setToday(typeof d?.today === "string" ? d.today : "");
      })
      .catch(() => { setErr("net"); if (!quiet) setRooms([]); })
      .finally(() => { if (!quiet) setBusy(false); });
  }, []);
  // 창이 열려 있는 동안 5초마다 스스로 갱신한다 (사용자 요청 2026-09-21 "강제 새로고침 말고 실시간").
  // ⚠ **폴링이다.** 진짜 푸시로 하려면 방 안의 전략·맹약이 바뀔 때마다 방 DO 가 로비에 알리고
  //   로비가 다시 구독자에게 밀어야 하는데, 운영자 한 명이 잠깐 보는 화면치고는 배보다 배꼽이 크다.
  //   탭이 가려져 있으면 쉬고, 돌아오면 곧바로 한 번 당긴다 — 묵은 목록을 보여 주지 않으려고.
  // 첫 조회도 타이머로 한 틱 미룬다 — 이펙트 안에서 곧바로 setState 하면 렌더가 한 번 더 돈다
  // (set-state-in-effect 린트 관례, promoNow·lens 와 같은 처리)
  useEffect(() => {
    const first = window.setTimeout(() => load(), 0);
    const id = window.setInterval(() => { if (!document.hidden) load(true); }, ROOMS_POLL_MS);
    const onShow = () => { if (!document.hidden) load(true); };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearTimeout(first); window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load]);

  const age = (at: number) => {
    const min = Math.max(0, Math.floor(((now || at) - at) / 60000));
    return min < 60 ? t("{n}분 전", { n: min }) : t("{n}시간 전", { n: Math.floor(min / 60) });
  };
  const live = (r: AdminRoom) => r.members.filter((m) => !m.ghost).length;

  /** 최근 CHART_DAYS 일 — 방이 하나도 안 만들어진 날도 0 으로 채워야 막대가 안 밀린다 */
  const chart = useMemo(() => {
    if (!today) return [];
    const byDay = new Map(days.map((d) => [d.day, d]));
    const base = Date.parse(`${today}T00:00:00Z`);
    return Array.from({ length: CHART_DAYS }, (_, i) => {
      const day = new Date(base - (CHART_DAYS - 1 - i) * 86400_000).toISOString().slice(0, 10);
      return { day, n: byDay.get(day)?.n ?? 0 };
    });
  }, [days, today]);
  /** 닉네임별 — 총 몇 번, 언제 처음, 언제 마지막. 남은 일수(기본 120일) 안의 집계다. */
  const byNick = useMemo(() => {
    const map = new Map<string, { n: number; first: string; last: string }>();
    for (const d of days) {
      for (const [nick, n] of Object.entries(d.nicks ?? {})) {
        const cur = map.get(nick) ?? { n: 0, first: d.day, last: d.day };
        cur.n += n;
        if (d.day < cur.first) cur.first = d.day;
        if (d.day > cur.last) cur.last = d.day;
        map.set(nick, cur);
      }
    }
    return [...map.entries()].map(([nick, v]) => ({ nick, ...v })).sort((a, b) => b.n - a.n || a.nick.localeCompare(b.nick));
  }, [days]);
  const todayN = days.find((d) => d.day === today)?.n ?? 0;
  const unknownTotal = days.reduce((a, d) => a + (d.unknown ?? 0), 0);
  const chartMax = Math.max(1, ...chart.map((c) => c.n));
  const nickMax = Math.max(1, ...byNick.map((v) => v.n));

  return (
    <ModalWindow label={t("파티 공유 방 목록")} className="operator-modal ac-modal ac-rooms" onClose={onClose}>
      <div className="ac-partybody">
        <div className="ac-party-bar">
          <span className="sim-note">{rooms === null ? t("불러오는 중…") : t("열린 방 {n}개", { n: rooms.length })}</span>
          <span className="ac-party-fine sb-dim">{t("{n}초마다 자동 갱신", { n: ROOMS_POLL_MS / 1000 })}</span>
          <button type="button" className="ac-party-copy" style={{ marginLeft: "auto" }} disabled={busy}
            onClick={() => load()}>{t("새로고침")}</button>
        </div>
        {err && (
          <p className="ac-party-err">{err === "no-key"
            ? t("관리자 키가 이 브라우저에 없습니다 — 제안 게시판에서 관리자 모드로 들어가세요.")
            : err === "forbidden"
              ? t("워커가 이 키를 거부했습니다 — 방 워커의 ADMIN_KEY 시크릿과 값이 다릅니다.")
              : t("방 목록을 불러오지 못했습니다.")}</p>
        )}
        {rooms !== null && !err && rooms.length === 0 && <p className="sim-note">{t("지금 열린 방이 없습니다.")}</p>}

        {/* ── 방 생성 통계 (사용자 요청 2026-09-21) ────────────────────────────────
            하루 경계는 **한국시간 0시**이고, 날짜별 수와 닉네임별 횟수를 워커가 들고 있다.
            닉네임은 게임 초대 문구에서 뽑는다 — 한국어 클라 문구만 확실히 잡히므로
            못 읽은 건 지어내지 않고 '알 수 없음'으로 따로 센다. */}
        {!err && days.length > 0 && (
          <section className="ac-stat">
            <h4>{t("오늘 만들어진 방 {n}개", { n: todayN })}<small>{today}</small></h4>
            <div className="ac-stat-bars" role="img" aria-label={t("날짜별 방 생성 수")}>
              {chart.map((c) => (
                <div key={c.day} className={`ac-stat-bar${c.day === today ? " on" : ""}`}
                  title={`${c.day} · ${t("{n}개", { n: c.n })}`}>
                  <b>{c.n || ""}</b>
                  <i style={{ height: `${Math.round((c.n / chartMax) * 100)}%` }} />
                  <span>{c.day.slice(5).replace("-", "/")}</span>
                </div>
              ))}
            </div>
            {byNick.length > 0 ? (
              <ul className="ac-stat-nicks">
                {byNick.slice(0, 10).map((v) => (
                  <li key={v.nick}>
                    <b title={v.nick}>{v.nick}</b>
                    <span className="ac-stat-track"><i style={{ width: `${Math.round((v.n / nickMax) * 100)}%` }} /></span>
                    <em>{t("{n}회", { n: v.n })}</em>
                    <small className="sb-dim">{v.first === v.last ? v.last : `${v.first} ~ ${v.last}`}</small>
                  </li>
                ))}
              </ul>
            ) : <p className="sim-note">{t("아직 닉네임을 읽은 방이 없습니다.")}</p>}
            {unknownTotal > 0 && (
              <p className="ac-party-fine sb-dim">{t("초대 문구를 못 읽어 만든 사람을 모르는 방 {n}개 — 한국어 클라 문구만 읽습니다.", { n: unknownTotal })}</p>
            )}
          </section>
        )}
        {rooms?.map((r) => (
          <section key={r.id} className={`ac-rooms-item${open === r.id ? " on" : ""}`}>
            <button type="button" className="ac-rooms-head" aria-expanded={open === r.id}
              onClick={() => setOpen((v) => (v === r.id ? "" : r.id))}>
              <code>{r.id}</code>
              <i className="sb-chip">{live(r)}/{MAX_SEATS}</i>
              <span className="sb-dim">{age(r.at)}</span>
              <span className="ac-rooms-caret" aria-hidden>{open === r.id ? "▴" : "▾"}</span>
            </button>
            {open === r.id && (
              <div className="ac-rooms-body">
                {r.invite && <p className="ac-party-fine sb-dim">{r.invite}</p>}
                {/* 자리 넷을 **가로로** 세운다 (사용자 지시 2026-09-21). 빈 자리도 그려야 박사 1~4 가
                    늘 같은 칸에 온다 — 있는 사람만 늘어놓으면 방마다 자리가 밀려 대조가 안 된다. */}
                <ul className="ac-rooms-seats">
                  {Array.from({ length: MAX_SEATS }, (_, i) => r.members.find((m) => m.seat === i) ?? null).map((m, i) => (
                    <li key={`${r.id}-${i}`} className={!m || m.ghost ? "ghost" : undefined}>
                      {/* 신호는 자리 이름 줄 **오른쪽 끝**에 아주 작게 (사용자 지시 2026-09-21) —
                          제 줄을 차지하면 칸 절반을 먹어 전략·맹약이 밀린다 */}
                      <span className="ac-rooms-seathead">
                        <b>{t("박사 {n}", { n: i + 1 })}</b>
                        {m?.sig && <em className={`ac-rooms-sig ${m.sig.k}`}>{SIGNAL_KO[m.sig.k as SignalId] ? t(SIGNAL_KO[m.sig.k as SignalId]) : m.sig.k}</em>}
                      </span>
                      {!m || m.ghost ? <i className="sb-dim">{t("빈 자리")}</i> : (<>
                        <span className="ac-rooms-band">
                          {m.band ? (bandById.get(m.band) ? bandLabel(bandById.get(m.band)!) : m.band) : <i className="sb-dim">{t("아직 안 골랐음")}</i>}
                        </span>
                        <span className="ac-party-bonds">
                          {m.bonds.map((id) => <i key={id} className="sb-chip">{bondById.get(id)?.n ?? id}</i>)}
                        </span>
                      </>)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}
      </div>
    </ModalWindow>
  );
}

export function AcPartyModal({ doc, roomId, onJoin, onClose, onShowBand, onShowBond }: {
  doc: AutochessDoc;
  /** "" = 아직 입장 전(문구 붙여 넣는 화면) · 그 외 = 이 방에 연결 */
  roomId: string;
  onJoin: (id: string) => void;
  onClose: () => void;
  /** 다른 참가자의 전략·맹약을 누르면 페이지의 상세 창을 연다 */
  onShowBand?: (b: AcBand) => void;
  onShowBond?: (b: AcBond) => void;
}) {
  const { t } = useI18n();
  const bandById = useMemo(() => new Map(doc.bands.map((b) => [b.id, b])), [doc.bands]);
  const bondById = useMemo(() => new Map(doc.bonds.map((b) => [b.id, b])), [doc.bonds]);

  const [me, setMe] = useState<Me>(() => (typeof window === "undefined" ? EMPTY_ME : loadMe(roomId)));
  const meRef = useRef<Me>(me);
  useEffect(() => { meRef.current = me; }, [me]);
  // 방을 떠나는 모든 길(나가기·×·뒤로가기·다른 방으로)에서 그 방의 선택을 지운다 — 새로고침은
  // 언마운트가 아니라 여기 안 걸리고, 그래서 판 중간에 새로고침하면 선택이 살아 돌아온다.
  useEffect(() => () => { clearMe(roomId); }, [roomId]);
  /** 입장할 때 붙여 넣은 게임 초대 문구 원문 — hello 에 실어 방에 남긴다 (ID 만 넣었으면 빈 문자열) */
  const inviteRef = useRef("");
  const [gen, setGen] = useState(0);
  const room = usePartyRoom(roomId, gen, meRef, inviteRef);
  const now = useClock(!!roomId);

  /** 링크 복사 = 「{초대 문구 또는 방 ID}⏎{URL}」 (사용자 지시 2026-09-21 — 이 꼴 그대로).
   *  문구는 방이 기억하는 것(누군가 통째로 붙여 넣은 원문)이 우선, 없으면 내가 넣은 것, 그것도
   *  없으면 방 ID 만 — 게임 문구를 지어내지는 않는다. */
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const invite = room.invite || inviteRef.current || roomId;
    // ⚠ 해시(#bond?p=…)를 그대로 주면 **게시판 자동 링크가 # 앞에서 끊는다** (사용자 제보
    // 2026-09-21, 디시). 예약문자가 하나도 없는 /p/<방ID> 로 주고 Pages 리다이렉트가 넘긴다.
    const prefix = window.location.pathname.replace(/\/autochess\/?$/, "");   // "" | "/en" | "/ja"
    const link = `${window.location.origin}${prefix}/p/${roomId}`;
    try {
      await navigator.clipboard.writeText(`${invite}\n${link}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* 클립보드 권한이 없으면 그냥 넘어간다 */ }
  };

  /** 내 선택 변경 — 저장하고 곧장 방에 알린다 */
  const update = (patch: Partial<Me>) => {
    setMe((cur) => {
      const next = { ...cur, ...patch };
      saveMe(roomId, next);
      return next;
    });
    room.send.current(patch);
  };
  const toggleBond = (id: string) => {
    const has = me.bonds.includes(id);
    if (!has && me.bonds.length >= MAX_BONDS) return;
    update({ bonds: has ? me.bonds.filter((x) => x !== id) : [...me.bonds, id] });
  };

  const [picker, setPicker] = useState<"" | "band" | "bond">("");

  // ── 입장 전 ──
  const inviteBoxRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState(false);
  const enter = () => {
    const raw = inviteBoxRef.current?.value ?? "";
    const id = parseInvite(raw);
    if (!id) { setErr(true); return; }
    setErr(false);
    // 통째로 붙여 넣었을 때만 원문을 들고 간다 (ID 만 넣었으면 방에 남길 문구가 없다)
    inviteRef.current = /^\s*\[/.test(raw) ? raw.replace(/\s+/g, " ").trim().slice(0, 160) : "";
    const start = loadMe(id);   // 같은 탭에서 같은 방에 다시 들어오는 게 아니면 빈손이다
    meRef.current = start;      // hello 가 ref 를 읽으므로 렌더 전에 맞춰 둔다
    setMe(start);
    setGen((g) => g + 1);
    onJoin(id);
  };

  /** 살아 있는 사람만 — 서버 목록 뒤에 붙어 오는 유령 자리(나간 사람이 남긴 신호)는 인원에 안 센다 */
  const members = useMemo(() => room.members.filter((m) => !m.ghost), [room.members]);
  /** 자리 → 사람(또는 유령 자리). 자리는 서버가 정해 준 번호 그대로 — 누가 나가도 남은 칸이 밀리지 않는다
   *  (사용자 지시 2026-09-21 "누가 나가도 내 슬롯 위치를 변경하지 말아줘"). */
  const bySeat = Array.from({ length: MAX_SEATS }, (_, i) => room.members.find((m) => m.seat === i) ?? null);
  /** 자리 이름 — 닉네임이 없으니 자리 번호다 (박사 1~4). 방장 표시는 두지 않는다 (사용자 지시 2026-09-21 "필요 없겠다"). */
  const seatLabel = (m: PartyMember) => t("박사 {n}", { n: m.seat + 1 });
  const isMe = (m: PartyMember) => m.uid === room.uid;
  const mine = members.find(isMe) ?? null;
  const serverNow = now ? now + room.skew : 0;   // 0 = 시계가 아직 안 찼다 → 경과 시간은 '방금'으로
  const sigLabel = (k: string) => (k in SIGNAL_KO ? t(SIGNAL_KO[k as SignalId]) : k);
  const sigAge = (at: number) => {
    const min = serverNow ? Math.floor((serverNow - at) / 60_000) : 0;
    return min <= 0 ? t("방금") : t("{n}분 전", { n: min });
  };
  const mySig = mine?.sig ?? null;
  const signal = (k: SignalId) => room.send.current({ sig: mySig?.k === k ? "" : k });

  /** 둘 이상이 함께 고른 맹약 — 겹침을 한눈에 (사이 조율은 사람이 한다) */
  const shared = useMemo(() => {
    const by = new Map<string, PartyMember[]>();
    for (const m of members) for (const id of m.bonds) by.set(id, [...(by.get(id) ?? []), m]);
    return [...by.entries()].filter(([, ms]) => ms.length >= 2);
  }, [members]);

  const statusText = room.status === "online" ? t("연결됨")
    : room.status === "connecting" ? t("연결 중")
    : room.status === "reconnecting" ? t("다시 연결 중")
    : room.status === "full" ? t("자리가 없음")
    : room.status === "expired" || room.status === "closed" ? t("닫힌 방") : "";

  return (
    <ModalWindow label={t("파티 공유")} className="operator-modal ac-modal ac-party" onClose={onClose} defaultPinned>
      {!roomId ? (
        <div className="ac-partybody ac-party-lobby">
          <p className="sim-note">{t("게임이 준 맹약 초대 문구를 그대로 붙여 넣거나, 대괄호 속 방 ID만 넣고 입장하세요. 같은 방에 들어온 사람(최대 4명)이 고른 전략과 가고 싶은 맹약을 서로 봅니다. 채팅은 없습니다.")}</p>
          <label className="ac-party-field">
            <span>{t("초대 문구 또는 방 ID")}</span>
            {/* 한 줄 입력 — 엔터가 곧 입장 (사용자 지시 2026-09-21 "엔터치면 그냥 바로 입장가능하게 한줄입력으로") */}
            <input ref={inviteBoxRef} type="text" spellCheck={false} autoComplete="off" enterKeyHint="go"
              placeholder="[kmk0im89g02bli]테라아카이브 박사님의 위수 협의: 맹약 초대 [초월 시뮬레이션]"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enter(); } }}
              onInput={() => setErr(false)} />
          </label>
          {err && <p className="ac-party-err">{t("잘못된 방 ID입니다 — 방 ID는 영문·숫자 14자입니다 (예: kmk0im89g02bli).")}</p>}
          <div className="ac-party-actions">
            <button type="button" className="ac-simcta" onClick={enter}>{t("입장")}</button>
          </div>
          <p className="ac-party-fine sb-dim">{t("방은 처음 들어오는 사람이 자동으로 만들고, 모두 나가면 1분 뒤 사라집니다. 남는 것은 전략·맹약 선택뿐입니다.")}</p>
        </div>
      ) : (
        <div className="ac-partybody ac-party-room">
          <div className="ac-party-bar">
            <span className="ac-party-roomid">{t("방")} <code>{roomId}</code></span>
            <button type="button" className="ac-party-copy" onClick={copy}
              title={t("게임 초대 문구와 이 방의 링크를 함께 복사합니다")}>{copied ? t("복사됨") : t("링크 복사")}</button>
            <span className={`ac-party-status ${room.status}`}>
              <i aria-hidden />{statusText}
              {room.status === "online" && <b>{members.length}/{MAX_SEATS}</b>}
            </span>
            <button type="button" className="ac-runbar-off"
              onClick={() => { room.leave.current(); clearMe(roomId); setMe(EMPTY_ME); setPicker(""); onJoin(""); }}>{t("나가기")}</button>
          </div>

          {room.status === "full" ? (
            <div className="ac-party-full">
              <p>{t("이 방은 이미 4명이 있습니다. 자리가 나면 다시 시도해 주세요.")}</p>
              <button type="button" className="ac-party-copy" onClick={() => room.retry.current()}>{t("다시 시도")}</button>
            </div>
          ) : room.status === "expired" || room.status === "closed" ? (
            <div className="ac-party-full">
              <p>{room.status === "expired"
                ? t("방이 만들어진 지 6시간이 지나 닫혔습니다. 같은 ID로 다시 입장하면 새 방이 열립니다.")
                : t("방이 정리되어 닫혔습니다. 같은 ID로 다시 입장하면 새 방이 열립니다.")}</p>
              <button type="button" className="ac-party-copy" onClick={() => { clearMe(roomId); setMe(EMPTY_ME); onJoin(""); }}>{t("입장 화면으로")}</button>
            </div>
          ) : (
            <>
              <div className="ac-party-seats">
                {bySeat.map((m, i) => {
                  if (!m || m.ghost) {
                    return (
                      <section key={`e${i}`} className="ac-party-seat empty" aria-label={t("빈 자리")}>
                        <span className="sb-dim">{t("빈 자리")}</span>
                        {/* 나간 사람이 남긴 신호 — 다음 사람이 이 자리에 앉을 때까지 남는다 (사용자 지시 2026-09-21) */}
                        {m?.sig && (
                          <span className={`ac-party-sig ghost ${m.sig.k}`} role="status">
                            {sigLabel(m.sig.k)}<i>{sigAge(m.sig.at)}</i>
                          </span>
                        )}
                      </section>
                    );
                  }
                  const own = isMe(m);
                  const band = m.band ? bandById.get(m.band) ?? null : null;
                  const sig = m.sig;
                  return (
                    <section key={m.uid} className={`ac-party-seat${own ? " me" : ""}`}>
                      <header className="ac-party-seathead">
                        <b className="ac-party-who">{seatLabel(m)}</b>
                        {own && <i className="sb-chip ac-party-mechip">{t("나")}</i>}
                      </header>
                      <div className="ac-party-row">
                        <b>{t("전략")}</b>
                        {own ? (
                          <button type="button" className={`ac-runbar-bandbtn${band ? "" : " empty"}${picker === "band" ? " on" : ""}`}
                            aria-expanded={picker === "band"}
                            onClick={() => setPicker((p) => (p === "band" ? "" : "band"))}>
                            {band ? (<>
                              <img src={bandIcon(band.id)} alt="" aria-hidden onError={hideErr} />
                              {bandLabel(band)}
                            </>) : t("전략 고르기")}
                          </button>
                        ) : band ? (
                          <button type="button" className="ac-runbar-bandbtn" onClick={() => onShowBand?.(band)} title={t("전략 상세 보기")}>
                            <img src={bandIcon(band.id)} alt="" aria-hidden onError={hideErr} />
                            {bandLabel(band)}
                          </button>
                        ) : <i className="sb-dim">{m.band ? m.band : t("아직 안 골랐음")}</i>}
                      </div>
                      <div className="ac-party-row">
                        <b>{t("맹약")}</b>
                        <span className="ac-party-bonds">
                          {m.bonds.map((id) => {
                            const b = bondById.get(id);
                            const label = b?.n ?? id;
                            return own ? (
                              <button key={id} type="button" className={`ac-bondchip sm${b?.nation ? " nation" : ""}`}
                                title={t("빼기")} onClick={() => toggleBond(id)}>
                                <img src={bondIcon(id)} alt="" aria-hidden onError={hideErr} />{label}<span className="ac-party-x" aria-hidden>×</span>
                              </button>
                            ) : (
                              <button key={id} type="button" className={`ac-bondchip sm${b?.nation ? " nation" : ""}`}
                                onClick={() => b && onShowBond?.(b)}>
                                <img src={bondIcon(id)} alt="" aria-hidden onError={hideErr} />{label}
                              </button>
                            );
                          })}
                          {own && me.bonds.length < MAX_BONDS && (
                            <button type="button" className={`ac-bondchip sm ac-party-add${picker === "bond" ? " on" : ""}`}
                              aria-expanded={picker === "bond"}
                              onClick={() => setPicker((p) => (p === "bond" ? "" : "bond"))}>
                              + {t("맹약 고르기")} <i>{me.bonds.length}/{MAX_BONDS}</i>
                            </button>
                          )}
                          {!own && !m.bonds.length && <i className="sb-dim">{t("아직 안 골랐음")}</i>}
                        </span>
                      </div>
                      {/* 신호 — 채팅 대신 미리 정한 한마디. 내 자리엔 버튼(누르면 올라가고 다시 누르면
                          내려간다), 남의 자리엔 올린 신호만 **같은 줄에** (사용자 지시 2026-09-21 "오른쪽 위에
                          표시할 필요 없이 신호 부분에" — 남의 자리는 그 줄이 비어 있으니 거기가 맞다).
                          3분 지나면 스스로 내려간다. */}
                      <div className="ac-party-row ac-party-sigrow">
                        <b>{t("신호")}</b>
                        {own ? (
                          <span className="ac-party-bonds">
                            {SIGNALS.map((k) => (
                              <button key={k} type="button" className={`ac-party-sigbtn ${k}${mySig?.k === k ? " on" : ""}`}
                                aria-pressed={mySig?.k === k} title={mySig?.k === k ? t("신호 내리기") : undefined}
                                onClick={() => signal(k)}>
                                {t(SIGNAL_KO[k])}
                              </button>
                            ))}
                          </span>
                        ) : sig ? (
                          <span className={`ac-party-sig ${sig.k}`} role="status">
                            {sigLabel(sig.k)}<i>{sigAge(sig.at)}</i>
                          </span>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>

              {picker === "band" && (
                <div className="ac-party-picker" role="group" aria-label={t("전략 고르기")}>
                  <div className="ac-party-pickhead">
                    <b>{t("전략 고르기")}</b>
                    {me.band && <button type="button" className="ac-party-copy" onClick={() => { update({ band: "" }); setPicker(""); }}>{t("선택 해제")}</button>}
                    <button type="button" className="ac-party-copy" onClick={() => setPicker("")}>{t("닫기")}</button>
                  </div>
                  <div className="ac-party-pickgrid">
                    {doc.bands.map((b) => (
                      <button key={b.id} type="button" className={`ac-runbar-bandbtn${me.band === b.id ? " on" : ""}`}
                        aria-pressed={me.band === b.id}
                        onClick={() => { update({ band: b.id }); setPicker(""); }}>
                        <img src={bandIcon(b.id)} alt="" aria-hidden loading="lazy" onError={hideErr} />
                        {bandLabel(b)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {picker === "bond" && (
                <div className="ac-party-picker" role="group" aria-label={t("맹약 고르기")}>
                  <div className="ac-party-pickhead">
                    <b>{t("맹약 고르기")}</b>
                    <span className="ac-party-limit">{t("최대 {n}개까지 선택 가능", { n: MAX_BONDS })} · {me.bonds.length}/{MAX_BONDS}</span>
                    <button type="button" className="ac-party-copy" onClick={() => setPicker("")}>{t("완료")}</button>
                  </div>
                  <div className="ac-party-pickgrid">
                    {doc.bonds.map((b) => {
                      const on = me.bonds.includes(b.id);
                      return (
                        <button key={b.id} type="button" className={`ac-bondchip${b.nation ? " nation" : ""}${on ? " on" : ""}`}
                          aria-pressed={on} disabled={!on && me.bonds.length >= MAX_BONDS}
                          /* 하나 고르면 닫는다 (사용자 지시 2026-09-21) — 둘째는 '+ 맹약 고르기'를 다시 누른다 */
                          onClick={() => { toggleBond(b.id); setPicker(""); }}>
                          <img src={bondIcon(b.id)} alt="" aria-hidden onError={hideErr} />{b.n}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {shared.length > 0 && (
                <p className="ac-party-shared">
                  <b>{t("함께 고른 맹약")}</b>
                  {shared.map(([id, ms]) => {
                    const b = bondById.get(id);
                    return (
                      <span key={id} className="ac-party-sharedone">
                        <button type="button" className={`ac-bondchip sm${b?.nation ? " nation" : ""}`} onClick={() => b && onShowBond?.(b)}>
                          <img src={bondIcon(id)} alt="" aria-hidden onError={hideErr} />{b?.n ?? id}
                        </button>
                        <i className="sb-dim">{ms.map(seatLabel).join(" · ")}</i>
                      </span>
                    );
                  })}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </ModalWindow>
  );
}
