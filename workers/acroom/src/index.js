// 테라 아카이브 위수 협의 **파티 공유** 방 — Durable Object 하나가 방 하나 (2026-09-21).
//
// 왜: 위수 협의 연합 시뮬레이션은 게임이 '맹약 초대' 문구를 준다 —
//   [kmk0im89g02bli]테라아카이브 박사님의 위수 협의: 맹약 초대 [초월 시뮬레이션]
// 그 문구를 받은 사람들이 사이트에 붙여 넣으면 대괄호 속 ID로 같은 방에 모여, 각자 고른
// **전략**과 가고 싶은 **맹약**을 서로 본다 (사용자 요청 2026-09-21). 채팅은 없다 — 게임을
// 하면서 칠 여유가 없다는 게 사용자의 판단이다. 대신 미리 정한 한마디 **신호**(sig — "연결이
// 끊겼어요, 죄송해요" 같은 것) 하나만 올릴 수 있다 (사용자 추가 요청, 같은 날). 닉네임은 없다 —
// 자리는 들어온 순서로 '박사 1~4' 다.
//
// 동작 규약:
//  - 방은 만들지 않는다. 처음 들어오는 순간 생긴다 (idFromName(방 ID)).
//  - 자리는 4개. 다섯째는 `full` 을 받고 끊긴다 (게임의 연합도 4인이다).
//  - **자리(seat 0~3)는 들어올 때 비어 있는 가장 낮은 번호로 정해지고 나갈 때까지 바뀌지 않는다** —
//    누가 나가도 남은 사람의 칸이 밀리지 않는다 (사용자 지시 2026-09-21 "누가 나가도 내 슬롯 위치를 변경하지 말아줘").
//  - 신호를 올려 둔 채 나가면 그 자리에 **신호만 남는다**(`g:<seat>` — 유령 자리). 다음 사람이 그 자리에
//    앉는 순간 지워진다 (사용자 지시 "바로 나가도 다음 사람이 들어오기 전까지는 해당 의사 문자열은 계속 남아있게").
//  - 같은 사람(uid — 브라우저 localStorage 의 임의 id)이 새로고침·탭 둘로 들어오면 자리를 하나만 쓴다.
//  - 마지막 사람이 나가면 60초 뒤 알람에서 저장소를 통째로 지운다 (사용자 요청 "1분 후에 자동 삭제").
//    그 안에 누가 다시 들어오면 그대로 이어진다.
//  - **만든 지 6시간이 지난 방은 사람이 있어도 강제로 닫는다** (사용자 요청 "혹시 모르니") — 순찰 알람이
//    `expired` 를 보내고 4002 로 끊은 뒤 통째로 지운다. 새로 붙는 연결이 그런 방을 만나면 먼저 지우고 새 방으로.
//  - 저장하는 건 참가자의 전략 id·맹약 id·신호 id, 그리고 처음 붙여 넣은 게임 초대 문구 한 줄뿐이다.
//    계정도 IP도 남기지 않는다. (초대 문구는 '링크 복사'가 사이트 링크와 함께 싣기 위해 방에 둔다 —
//    ID 만 넣고 들어온 사람도 남이 붙여 넣은 원문을 그대로 복사해 갈 수 있게. 사용자 요청 2026-09-21)
//
// WebSocket 하이버네이션 API 를 쓴다 — 게임 한 판(30~40분) 동안 메시지가 뜸해서, 그 사이
// 인스턴스가 잠들어도 소켓과 참가자 정보(storage)가 살아 있어야 한다. 그래서 참가자 목록은
// 메모리가 아니라 storage(`m:<uid>`)에 두고, 소켓↔uid 는 attachment 로 잇는다.
//
// **열린 방 수** (사용자 요청 "현재 세션이 몇 개 만들어져 있는지 파티 공유 오른쪽에") — Durable Object 는
// 목록을 못 뽑으므로 장부 DO 하나(AcLobby, idFromName("lobby"))를 둔다. 방이 생기면 /up, 지워지면 /down,
// 사람이 있는 동안 순찰마다 /up 으로 살아 있음을 알린다. 알림을 놓친 방은 30분 넘게 소식이 없으면 장부에서 뺀다.
// 사이트는 GET /stats → {rooms:N} 만 읽는다.
// **방 목록(운영자)**: `GET /admin/rooms` + `x-admin-key: <VIEW_KEY 시크릿, 없으면 ADMIN_KEY>` — 장부에 있는 방마다
//   자리·전략·맹약·신호를 **자리를 먹지 않고** 돌려준다 (사이트의 '방 N개' 버튼이 부른다).
// **전부 정리**: `POST /admin/purge` + `x-admin-key: <ADMIN_KEY 시크릿>` — 장부에 있는 방을 모두 닫고(`closed`, 4003)
// 장부를 비운다 (사용자 요청 "세션 싹 다 삭제"). 시크릿은 업로드 워커와 같은 .upload-admin-key 값.
//
// 배포: `bash deploy.sh`

const ROOM_ID = /^[a-z0-9]{14}$/;   // 게임 초대 코드는 늘 14자다 (kmk0im89g02bli) — 길이가 다르면 잘못된 방 (사용자 지시 2026-09-21)
const LOBBY_STALE_MS = 30 * 60_000;   // 순찰(10분) 세 번 놓치면 장부에서 지운다
const UID_RE = /^[a-z0-9-]{8,48}$/;
const BAND_RE = /^band_[a-z0-9_]{1,32}$/;
const BOND_RE = /^[A-Za-z0-9_]{1,32}$/;
const SIG_RE = /^[a-z]{1,16}$/;   // 짧은 신호 — 채팅 대신 미리 정한 한마디 ("연결이 끊겼어요" 등), id 만 오간다
const INVITE_MAX = 160;           // 게임 초대 문구 한 줄 — 방에 한 번 남겨 두고 '링크 복사'가 함께 싣는다
const MAX_SEATS = 4;
const MAX_BONDS = 4;       // 클라이언트는 3개까지 고르게 한다 — 하나 여유
const MSG_MAX = 2048;
const WIPE_AFTER_MS = 60_000;          // 마지막 사람이 나간 뒤 방을 지우기까지
const SWEEP_EVERY_MS = 10 * 60_000;    // 사람이 있는 동안 죽은 소켓·고아 행을 훑는 주기 (env.SWEEP_MS 로 시험용 단축)
const ROOM_TTL_MS = 6 * 3600_000;      // 방 최대 수명 — 만든 지 이만큼 지나면 강제 삭제 (env.ROOM_TTL_MS 로 시험용 단축)

// 사이트와 로컬 개발만 — 계정 워커와 같은 목록 (남의 페이지에서 방을 헤집지 못하게)
const ORIGIN_OK = (origin) =>
  origin === "https://terra-archive.net" ||
  origin === "https://terra-archive.pages.dev" ||
  /^https:\/\/[a-z0-9-]+\.terra-archive\.pages\.dev$/.test(origin) ||
  /^http:\/\/localhost:\d+$/.test(origin) ||
  /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return json({ ok: true, service: "terra-archive-acroom", seats: MAX_SEATS, wipeAfterSec: WIPE_AFTER_MS / 1000 });
    }
    // ⚠ `x-admin-key` 는 단순 헤더가 아니라 **프리플라이트를 부른다** — OPTIONS 를 안 받으면
    //   브라우저가 요청 자체를 막는다 (curl 로는 되는데 화면에서만 안 되는 함정).
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "x-admin-key, content-type",
        "Access-Control-Max-Age": "86400",
      } });
    }
    const lobby = () => env.LOBBY.get(env.LOBBY.idFromName("lobby"));
    if (url.pathname === "/stats") return lobby().fetch("https://lobby/stats");
    // 운영자 방 목록 — 어느 방에 누가 무슨 전략·맹약으로 있는지 **들어가 보지 않고** 본다
    // (사용자 요청 2026-09-21). 자리를 먹지 않으므로 4명이 찬 방도 그대로 볼 수 있다.
    if (url.pathname === "/admin/rooms") {
      // ⚠ 키를 **둘로 가른다.** 이 키는 운영자 브라우저의 localStorage 에 놓인다 — 공개
      //   사이트에 놓이는 값이므로 **보기만 되고 지우기는 안 되게** 한다 (app/feedback.ts 의
      //   "공개 사이트 localStorage 에 키가 놓이는 트레이드오프" 와 같은 계열).
      //   VIEW_KEY 가 있으면 그걸 쓰고, 없으면 ADMIN_KEY 로 떨어진다(설정 전에도 동작하게).
      //   `/admin/purge` 는 언제나 ADMIN_KEY 전용 — 브라우저에 들어갈 일이 없다.
      const viewKey = env.VIEW_KEY || env.ADMIN_KEY;
      if (!viewKey) return json({ ok: false, error: "no-admin-key" }, 503);
      if ((request.headers.get("x-admin-key") ?? "") !== viewKey) return json({ ok: false, error: "forbidden" }, 403);
      const { ids } = await (await lobby().fetch("https://lobby/list")).json();
      const rooms = [];
      for (const id of ids) {
        try {
          const r = await env.ROOM.get(env.ROOM.idFromName(id)).fetch("https://room/peek");
          const d = await r.json();
          if (!d?.ok || d.gone) continue;          // 장부에만 남은 유령은 안 싣는다
          rooms.push({ id, at: d.room?.at ?? 0, invite: d.room?.invite ?? "", members: d.members ?? [] });
        } catch { /* 한 방이 막혀도 나머지는 계속 */ }
      }
      rooms.sort((a, b) => b.at - a.at);
      return json({ ok: true, rooms, seats: MAX_SEATS });
    }
    if (url.pathname === "/admin/purge") {
      if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
      if (!env.ADMIN_KEY) return json({ ok: false, error: "no-admin-key" }, 503);
      if ((request.headers.get("x-admin-key") ?? "") !== env.ADMIN_KEY) return json({ ok: false, error: "forbidden" }, 403);
      const { ids } = await (await lobby().fetch("https://lobby/list")).json();
      let purged = 0;
      for (const id of ids) {
        try {
          const r = await env.ROOM.get(env.ROOM.idFromName(id)).fetch("https://room/purge", { method: "POST" });
          if (r.ok) purged++;
        } catch { /* 방 하나가 안 닫혀도 나머지는 계속 */ }
      }
      await lobby().fetch("https://lobby/clear", { method: "POST" });
      return json({ ok: true, listed: ids.length, purged });
    }
    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (!m) return json({ ok: false, error: "not-found" }, 404);
    const id = decodeURIComponent(m[1]).toLowerCase();
    if (!ROOM_ID.test(id)) return json({ ok: false, error: "bad-room" }, 400);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ ok: false, error: "websocket-only" }, 426);
    }
    const origin = request.headers.get("Origin") ?? "";
    if (!ORIGIN_OK(origin)) return json({ ok: false, error: "bad-origin" }, 403);
    const stub = env.ROOM.get(env.ROOM.idFromName(id));
    return stub.fetch(request);
  },
};

const cleanBand = (v) => (typeof v === "string" && BAND_RE.test(v) ? v : "");
const cleanSig = (v) => (typeof v === "string" && SIG_RE.test(v) ? { k: v, at: Date.now() } : null);
/** 초대 문구 — 이 방의 ID 로 시작하는 한 줄만 받는다 (남의 방 문구·아무 글자를 방에 못 남기게) */
const cleanInvite = (v, roomId) => {
  if (typeof v !== "string") return "";
  const one = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, INVITE_MAX);
  return new RegExp(`^\\[${roomId}\\]`, "i").test(one) ? one : "";
};
const cleanBonds = (v) =>
  Array.isArray(v)
    ? [...new Set(v.filter((x) => typeof x === "string" && BOND_RE.test(x)))].slice(0, MAX_BONDS)
    : [];

/** 열린 방 장부 — 방 id → 마지막으로 살아 있다고 알린 시각 */
export class AcLobby {
  constructor(state, env) {
    this.storage = state.storage;
    this.stale = Number(env?.LOBBY_STALE_MS) || LOBBY_STALE_MS;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/stats") {
      const now = Date.now();
      let rooms = 0;
      for (const [key, at] of await this.storage.list({ prefix: "r:" })) {
        if (now - at > this.stale) { await this.storage.delete(key); continue; }
        rooms++;
      }
      return json({ ok: true, rooms });
    }
    if (url.pathname === "/list") {
      return json({ ok: true, ids: [...(await this.storage.list({ prefix: "r:" })).keys()].map((k) => k.slice(2)) });
    }
    if (request.method === "POST" && url.pathname === "/clear") {
      await this.storage.deleteAll();
      return json({ ok: true });
    }
    if (request.method === "POST" && (url.pathname === "/up" || url.pathname === "/down")) {
      const { id } = await request.json().catch(() => ({}));
      if (typeof id !== "string" || !ROOM_ID.test(id)) return json({ ok: false }, 400);
      if (url.pathname === "/up") await this.storage.put(`r:${id}`, Date.now());
      else await this.storage.delete(`r:${id}`);
      return json({ ok: true });
    }
    return json({ ok: false, error: "not-found" }, 404);
  }
}

export class AcRoom {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
    this.lobby = env?.LOBBY ? env.LOBBY.get(env.LOBBY.idFromName("lobby")) : null;
    this.ttl = Number(env?.ROOM_TTL_MS) || ROOM_TTL_MS;
    this.sweep = Number(env?.SWEEP_MS) || SWEEP_EVERY_MS;
    // "ping" 은 인스턴스를 깨우지 않고 런타임이 "pong" 으로 받아친다 — 클라이언트 25초 keepalive
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    const url = new URL(request.url);
    // 내부 전용 — 공개 라우터는 /room/<id> 웹소켓만 넘기므로 밖에서는 못 부른다 (관리자 purge 가 부른다)
    if (url.pathname === "/purge") { await this.wipe("closed"); return json({ ok: true }); }
    // 관리자 엿보기 — **자리를 먹지 않고** 방 안을 그대로 돌려준다 (운영자 방 목록, 2026-09-21).
    // ⚠ 아무것도 쓰지 않는다: 장부에만 남고 실체가 없는 방을 여기서 되살리면 유령 방이 는다.
    if (url.pathname === "/peek") {
      const room = await this.storage.get("room");
      if (!room || this.expired(room)) return json({ ok: true, gone: true });
      return json({ ok: true, room, members: await this.members(null, true) });
    }
    const roomId = decodeURIComponent(url.pathname.split("/").pop() ?? "").toLowerCase();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ uid: "", at: Date.now() });
    // 방 ID·생성 시각은 처음 소켓이 붙을 때 한 번 적어 둔다. 수명이 다한 방이 남아 있으면 먼저 지운다.
    const room = await this.storage.get("room");
    if (room && this.expired(room)) await this.wipe("expired");
    if (!room || this.expired(room)) {
      await this.storage.put("room", { id: roomId, at: Date.now() });
      await this.tell("/up");   // 새 방 — 장부에 올린다
    }
    // 비워질 때 걸어 둔 '지우기' 알람이 있으면 이제 사람이 있으니 순찰 주기로 되돌린다
    await this.storage.setAlarm(Date.now() + this.sweep);
    return new Response(null, { status: 101, webSocket: client });
  }

  expired(room) { return !!room?.at && Date.now() - room.at >= this.ttl; }
  /** 장부에 알린다 — 실패해도 방 동작에는 영향이 없어야 하므로 삼킨다 */
  async tell(path) {
    if (!this.lobby) return;
    const room = await this.storage.get("room");
    if (!room?.id) return;
    try {
      await this.lobby.fetch(`https://lobby${path}`, { method: "POST", body: JSON.stringify({ id: room.id }) });
    } catch { /* 장부는 통계일 뿐 */ }
  }
  /** 방을 통째로 지운다 — 붙어 있는 소켓에는 이유를 알리고 끊는다 (expired → 4002) */
  async wipe(reason) {
    await this.tell("/down");
    for (const ws of this.state.getWebSockets()) {
      try {
        if (reason) ws.send(JSON.stringify({ t: reason }));
        ws.close(reason === "expired" ? 4002 : reason === "closed" ? 4003 : 1000, reason ?? "wipe");
      } catch { /* noop */ }
    }
    await this.storage.deleteAlarm();
    await this.storage.deleteAll();
  }

  // ── 소켓 ↔ 참가자 ──────────────────────────────────────────────────────────
  attachmentOf(ws) {
    try { return ws.deserializeAttachment() ?? {}; } catch { return {}; }
  }
  /** 살아 있는 소켓이 붙어 있는 uid 집합 (except = 지금 닫히는 소켓) */
  liveUids(except) {
    const set = new Set();
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      const { uid } = this.attachmentOf(ws);
      if (uid) set.add(uid);
    }
    return set;
  }
  /** 살아 있는 참가자 (자리 순). ghosts=true 면 나간 사람이 남긴 신호 자리(ghost:1, uid "")도 뒤에 붙인다 */
  async members(except, ghosts = false) {
    const live = this.liveUids(except);
    const rows = await this.storage.list({ prefix: "m:" });
    const out = [];
    for (const [key, row] of rows) {
      const uid = key.slice(2);
      if (!live.has(uid)) continue;
      out.push({ uid, seat: row.seat ?? 0, band: row.band ?? "", bonds: row.bonds ?? [], sig: row.sig ?? null, at: row.at ?? 0, up: row.up ?? 0 });
    }
    out.sort((a, b) => a.seat - b.seat || a.at - b.at);
    if (ghosts) {
      const taken = new Set(out.map((m) => m.seat));
      for (const [key, g] of await this.storage.list({ prefix: "g:" })) {
        const seat = Number(key.slice(2));
        if (taken.has(seat) || !g?.sig) continue;
        out.push({ uid: "", ghost: 1, seat, band: "", bonds: [], sig: g.sig, at: 0, up: g.up ?? 0 });
      }
    }
    return out;
  }
  /** 비어 있는 가장 낮은 자리 번호 — 없으면 -1 (살아 있는 사람의 자리만 찬 것으로 본다, 유령 자리는 비어 있다) */
  async freeSeat() {
    const taken = new Set((await this.members()).map((m) => m.seat));
    for (let i = 0; i < MAX_SEATS; i++) if (!taken.has(i)) return i;
    return -1;
  }
  /** 자리를 비운다 — 신호가 올라 있었으면 그 자리에 신호만 남긴다 */
  async vacate(uid) {
    const row = await this.storage.get(`m:${uid}`);
    if (row?.sig && typeof row.seat === "number") await this.storage.put(`g:${row.seat}`, { sig: row.sig, up: Date.now() });
    await this.storage.delete(`m:${uid}`);
  }
  async broadcast(except) {
    const room = (await this.storage.get("room")) ?? {};
    const payload = JSON.stringify({ t: "state", id: room.id ?? "", invite: room.invite ?? "", seats: MAX_SEATS, members: await this.members(except, true) });
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      if (!this.attachmentOf(ws).uid) continue;   // hello 전인 소켓엔 아직 아무것도 안 준다
      try { ws.send(payload); } catch { /* 닫히는 중 — close 핸들러가 정리한다 */ }
    }
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MSG_MAX) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    const att = this.attachmentOf(ws);

    if (msg.t === "hello") {
      const uid = typeof msg.uid === "string" ? msg.uid.toLowerCase() : "";
      if (!UID_RE.test(uid)) { ws.close(4000, "bad-uid"); return; }
      const live = this.liveUids();
      // 이미 앉아 있는 사람(다른 탭·새로고침)은 제 자리를 그대로 쓴다. 새 사람은 빈 자리 중 가장 낮은 번호.
      const prevLive = live.has(uid) ? ((await this.storage.get(`m:${uid}`)) ?? null) : null;
      const seat = prevLive?.seat ?? (await this.freeSeat());
      if (seat < 0) {
        // 다섯째 — 자리가 없다. 상태는 보여 주지 않고 문만 닫는다.
        try { ws.send(JSON.stringify({ t: "full", seats: MAX_SEATS })); } catch { /* noop */ }
        ws.close(4001, "full");
        return;
      }
      ws.serializeAttachment({ uid, at: att.at ?? Date.now() });
      if (!prevLive) await this.storage.delete(`g:${seat}`);   // 새 사람이 앉으면 남아 있던 신호는 지운다
      const prev = prevLive;
      const row = {
        seat,
        band: msg.band !== undefined ? cleanBand(msg.band) : (prev?.band ?? ""),
        bonds: msg.bonds !== undefined ? cleanBonds(msg.bonds) : (prev?.bonds ?? []),
        sig: prev?.sig ?? null,
        at: prev?.at ?? Date.now(),
        up: Date.now(),
      };
      await this.storage.put(`m:${uid}`, row);
      // 게임 초대 문구는 **처음 것 하나**만 남긴다 — 방 ID 가 같으면 같은 게임 방의 문구다
      const room = (await this.storage.get("room")) ?? {};
      if (!room.invite) {
        const invite = cleanInvite(msg.invite, room.id ?? "");
        if (invite) await this.storage.put("room", { ...room, invite });
      }
      try { ws.send(JSON.stringify({ t: "welcome", uid })); } catch { /* noop */ }
      await this.broadcast();
      return;
    }

    if (!att.uid) return;   // hello 없이 온 메시지는 무시

    if (msg.t === "set") {
      const prev = (await this.storage.get(`m:${att.uid}`)) ?? null;
      if (!prev) return;   // 자리가 이미 비워졌다(끊김 정리 뒤 늦게 온 메시지) — 되살리지 않는다
      const row = {
        seat: prev.seat ?? 0,
        band: msg.band !== undefined ? cleanBand(msg.band) : (prev.band ?? ""),
        bonds: msg.bonds !== undefined ? cleanBonds(msg.bonds) : (prev.bonds ?? []),
        // 신호: "" = 내리기 · 아는 id = 올리기(시각 갱신) · 모르는 값 = 무시
        sig: msg.sig === undefined ? (prev.sig ?? null) : msg.sig === "" ? null : (cleanSig(msg.sig) ?? prev.sig ?? null),
        at: prev.at ?? Date.now(),
        up: Date.now(),
      };
      await this.storage.put(`m:${att.uid}`, row);
      await this.broadcast();
      return;
    }

    if (msg.t === "leave") {
      // 명시적으로 나감 — 같은 uid 의 다른 탭도 함께 내보낸다 (그 사람이 '나가기'를 눌렀다)
      for (const other of this.state.getWebSockets()) {
        if (other !== ws && this.attachmentOf(other).uid === att.uid) {
          try { other.send(JSON.stringify({ t: "bye" })); other.close(1000, "leave"); } catch { /* noop */ }
        }
      }
      await this.vacate(att.uid);
      try { ws.send(JSON.stringify({ t: "bye" })); } catch { /* noop */ }
      ws.close(1000, "leave");
      await this.afterDrop(ws);
    }
  }

  async webSocketClose(ws) { await this.afterDrop(ws); }
  async webSocketError(ws) { await this.afterDrop(ws); }

  /** 소켓 하나가 사라진 뒤 — 그 사람의 마지막 소켓이었으면 자리를 비우고, 방이 비었으면 지우기 예약 */
  async afterDrop(ws) {
    const { uid } = this.attachmentOf(ws);
    const live = this.liveUids(ws);
    if (uid && !live.has(uid)) await this.vacate(uid);
    if (live.size === 0) {
      await this.storage.setAlarm(Date.now() + WIPE_AFTER_MS);
      return;
    }
    await this.broadcast(ws);
  }

  async alarm() {
    const live = this.liveUids();
    if (live.size === 0) {
      // 마지막 사람이 나간 뒤 60초 — 아무도 돌아오지 않았다. 방을 통째로 지운다.
      await this.wipe(null);
      return;
    }
    // 만든 지 6시간 — 사람이 있어도 닫는다 (사용자 요청 "혹시 모르니")
    if (this.expired(await this.storage.get("room"))) { await this.wipe("expired"); return; }
    // 사람이 있다 — 소켓 없이 남은 고아 행만 걷고, 장부에 살아 있음을 알리고, 다음 순찰을 건다
    const rows = await this.storage.list({ prefix: "m:" });
    for (const key of rows.keys()) if (!live.has(key.slice(2))) await this.storage.delete(key);
    await this.tell("/up");
    await this.storage.setAlarm(Date.now() + this.sweep);
  }
}
