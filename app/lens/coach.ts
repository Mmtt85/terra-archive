// 훈수방 — 하는 사람 쪽 (2026-10-24, 사용자 지시 "PRTS 링크를 켜고 링크를 뿌리면 고수가 내 화면을 보며 훈수").
//
// PRTS 링크가 이미 잡고 있는 게임 창 영상(bridgeStream)을 **그대로** 보는 사람에게 WebRTC 로 보낸다 — 화면을 한 번 더 고르지 않는다.
// 영상·인식 정보·짚기는 브라우저끼리 직접(P2P) 오가고, 방 워커(workers/acroom CoachRoom)는 연결 중개 메시지만 넘긴다.
// 중계 서버(TURN)는 쓰지 않는다 — Cloudflare 트래픽이 들면 안 된다는 조건. 직접 연결이 안 되는 망이면 그 사람은 못 본다.
//
//   보는 사람 ≤ 3 (보는 사람마다 영상을 따로 올린다 — 1080p 30fps 면 1인당 약 3Mbps)
//   인식 정보 = PRTS 작은 창과 같은 것(노드 카드·소장품 카드·층) — 데이터 채널로, 바뀔 때마다
//   짚기 = 보는 사람이 카드를 누르면 그 카드 키가 온다 → 카드마다 몇 명이 짚었는지 (한 사람 한 장)
//   명일방주 화면이 아닌 것 같으면(bridgeNotArknights) 영상을 끄고 'hidden' 을 알린다
//   채팅 = 보는 사람 글이 하는 사람에게 오면 하는 사람이 모두에게 나눠 준다(하는 사람이 가운데). 저장하지 않는다 — 방이 닫히면 사라진다.
//     닉네임은 각자 브라우저에 둔다(ta:coach-name). 하는 사람은 '채팅 끄기'로 막을 수 있다 (사용자 지시 2026-10-24
//     "채팅 기능 한번 넣어볼까", "닉네임 설정은 만들자", "록라는 채팅창 볼 틈이 있다")

import { asset } from "../assets";
import { bridgeNotArknights, bridgePipFloor, bridgePipNode, bridgePipRelics, bridgeStream, onBridgeChange, setBridgeShareRate, type BridgePipCard } from "./bridge";

export const COACH_WS = "wss://terra-archive-acroom.nzkonaru.workers.dev/coach/";
export const COACH_ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
export const COACH_MAX = 3;
const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const UID_KEY = "ta:coach-uid";

/** 보는 사람에게 보내는 인식 정보 한 덩어리 */
export type CoachInfo = { t: "info"; node: BridgePipCard | null; relics: BridgePipCard[]; floor: ReturnType<typeof bridgePipFloor>; hidden: boolean };
/** 추천·비추천 현황 — 카드 키 → 추천한/비추천한 보는 사람 번호들. 한 사람이 카드마다 하나씩 (사용자 지시 2026-10-24 "추천 비추천 기능") */
export type CoachVotes = Record<string, { up: number[]; down: number[] }>;
export const cardKey = (c: Pick<BridgePipCard, "kind" | "name">) => `${c.kind}:${c.name}`;
/** 채팅 한 줄 — from = 쓴 사람 열쇠(0 = 하는 사람, 보는 사람은 연결마다 새 번호). 이름은 줄에 박지 않고 names 로 그때그때 찾는다 —
 *  중간에 닉네임을 바꾸면 지난 줄도 새 닉네임으로 보여야 한다 (사용자 지시 2026-10-24). name 은 names 에 없을 때의 대비 */
export type CoachMsg = { id: number; from: number; name: string; text: string; at: number };
/** 화면 반응 — 게임 '이모티콘 세트: 위수 협의' 그림 (scripts/build-emotes.py 가 public/ac/emote 에 꺼내 둔다).
 *  보는 사람이 누르면 하는 사람 작은 창과 모두의 영상 위로 잠깐 떠오른다. 카드 추천·비추천(엄지 SVG)과는 따로다 (사용자 지시 2026-10-24) */
export const EMOTES = ["happy", "call", "noproblem", "thanks", "respect", "thinking", "scared", "sorry", "dying", "sad"] as const;
export type Emote = typeof EMOTES[number];
export const EMOTE_LABEL: Record<Emote, string> = {
  happy: "신남", call: "오오", noproblem: "문제없음", thanks: "고마워", respect: "존경",
  thinking: "고민", scared: "허걱", sorry: "미안", dying: "기진맥진", sad: "엉엉",
};
/** 그림 주소 — 작은 창 문서는 about:blank 라 절대 주소로 */
/** 보는 사람 페이지용 — 서버 렌더와 같은 주소 */
export const emoteSrc = (e: string) => asset(`/ac/emote/${e}.webp`);
export const emoteUrl = (e: string) => {
  const u = emoteSrc(e);
  return typeof location === "undefined" ? u : new URL(u, location.href).href;   // 서버 렌더엔 location 이 없다
};
/** 떠오른 반응 하나 — from = 쓴 사람 열쇠(채팅과 같다) */
export type CoachReact = { id: number; e: Emote; from: number; at: number };
export const REACT_MS = 2800;    // 떠 있는 시간
const REACT_GAP = 600;           // 한 사람이 이보다 빨리 누르면 버린다
/** 쓴 사람 열쇠 → 지금 이름 */
export type CoachNames = Record<string, string>;
export const msgName = (m: CoachMsg, names: CoachNames) => names[String(m.from)] ?? m.name;
export const CHAT_MAX = 80;      // 한 줄 글자 수
export const NAME_MAX = 12;
/** 닉네임을 안 쓴 보는 사람 이름표 — 'cannot 1~3' (번호는 방 워커가 비어 있는 가장 작은 수로 준다. 사용자 지시 2026-10-24) */
export const anonName = (id: number) => `cannot ${id}`;
const CHAT_KEEP = 60;            // 하는 사람이 들고 있는 최근 줄 수 — 늦게 들어온 사람에게도 보낸다
const CHAT_GAP = 1200;           // 한 사람이 이 간격(ms)보다 빨리 보내면 버린다
const NAME_KEY = "ta:coach-name";
/** 글 다듬기 — 제어 문자를 빼고 줄바꿈은 띄어쓰기로, 길이 제한 */
export const cleanText = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
export function coachName(): string { try { return cleanText(localStorage.getItem(NAME_KEY), NAME_MAX); } catch { return ""; } }
export function setCoachName(v: string): void {
  try { localStorage.setItem(NAME_KEY, cleanText(v, NAME_MAX)); } catch { /* 이번만 */ }
  if (live) sendAll({ t: "names", names: coachNames() });
  changed();
}

type Peer = { id: number; a: number; pc: RTCPeerConnection; dc: RTCDataChannel | null; votes: Map<string, 1 | -1>; open: boolean; name: string; lastChat: number; lastReact: number };
let ws: WebSocket | null = null;
let code = "";
let peers = new Map<number, Peer>();
let live = false;
let failMsg = "";
let unsub: (() => void) | null = null;
let hiddenNow = false;
let chatLog: CoachMsg[] = [];
let chatSeq = 0;
let chatOff = false;
let chatUnread = 0;
let authorSeq = 0;
let reacts: CoachReact[] = [];
let reactSeq = 0;
const leftNames = new Map<number, string>();   // 나간 사람의 마지막 이름 — 지난 줄이 번호로 바뀌지 않게
const subs = new Set<() => void>();
const changed = () => { for (const cb of subs) cb(); };

export function onCoachChange(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export const coachState = () => ({ live, code, url: code ? `${location.origin}${location.pathname.startsWith("/en") ? "/en" : location.pathname.startsWith("/ja") ? "/ja" : ""}/w/${code}` : "",
  viewers: [...peers.values()].filter((p) => p.open).length, error: failMsg });
/** 쓴 사람 열쇠 → 지금 이름 (하는 사람·지금 있는 사람·나간 사람) */
export function coachNames(): CoachNames {
  const out: CoachNames = { "0": coachName() || "하는 사람" };
  for (const [a, n] of leftNames) out[String(a)] = n;
  for (const p of peers.values()) out[String(p.a)] = p.name || anonName(p.id);
  return out;
}
/** 지금 떠 있는 반응들 */
export const coachReacts = () => reacts;
function pushReact(from: number, e: Emote): void {
  const now = Date.now();
  const r: CoachReact = { id: ++reactSeq, e, from, at: now };
  reacts = [...reacts.filter((x) => now - x.at < REACT_MS), r].slice(-16);
  sendAll({ t: "react", r });
  changed();
  setTimeout(() => { reacts = reacts.filter((x) => Date.now() - x.at < REACT_MS); changed(); }, REACT_MS + 50);
}
/** 채팅 — 지금까지 온 줄(최근 CHAT_KEEP)·꺼짐·안 읽은 수·이름표 */
export const coachChat = () => ({ log: chatLog, off: chatOff, unread: chatUnread, names: coachNames() });
export function coachChatRead(): void { if (chatUnread) { chatUnread = 0; changed(); } }
function pushChat(from: number, name: string, text: string): void {
  const m: CoachMsg = { id: ++chatSeq, from, name, text, at: Date.now() };
  chatLog = [...chatLog, m].slice(-CHAT_KEEP);
  if (from !== 0) chatUnread++;
  sendAll({ t: "chat", m });
  changed();
}
/** 하는 사람이 채팅 치기 */
export function coachSay(text: string): void {
  const v = cleanText(text, CHAT_MAX);
  if (!v || !live) return;
  pushChat(0, coachName() || "하는 사람", v);
}
/** 채팅 끄기·켜기 — 끄면 보는 사람 글을 받지 않는다 (지난 줄은 그대로) */
export function setCoachChatOff(v: boolean): void { chatOff = v; sendAll({ t: "chatoff", off: v }); changed(); }
/** 카드별 추천·비추천 */
export function coachVotes(): CoachVotes {
  const out: CoachVotes = {};
  for (const p of peers.values()) for (const [k, v] of p.votes) { const r = (out[k] ??= { up: [], down: [] }); (v > 0 ? r.up : r.down).push(p.id); }
  return out;
}

const uid = () => {
  try { let v = localStorage.getItem(UID_KEY); if (!v) { v = crypto.randomUUID().slice(0, 24); localStorage.setItem(UID_KEY, v); } return v; }
  catch { return "anon-" + Math.random().toString(36).slice(2, 10); }
};
function newCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
}

const infoNow = (): CoachInfo => ({ t: "info", node: bridgePipNode(), relics: bridgePipRelics(), floor: bridgePipFloor(), hidden: hiddenNow });
function sendAll(msg: unknown) {
  const s = JSON.stringify(msg);
  for (const p of peers.values()) if (p.dc?.readyState === "open") { try { p.dc.send(s); } catch { /* 닫히는 중 */ } }
}
let lastNodeKey = "";
function onBridge() {
  if (!live) return;
  // PRTS 링크가 끊기면(게임 창 공유 종료) 훈수방도 닫는다 — 보낼 영상이 없다
  if (!bridgeStream()) { stopCoach(); return; }
  // 명일방주 화면이 아니면 영상을 끈다 — 다른 창(메신저·알림)이 보는 사람에게 가지 않게
  const hide = bridgeNotArknights();
  if (hide !== hiddenNow) {
    hiddenNow = hide;
    for (const p of peers.values()) for (const s of p.pc.getSenders()) if (s.track) s.track.enabled = !hide;
  }
  // 노드가 바뀌면 추천·비추천을 비운다 — 지난 화면의 투표가 남지 않게
  const nk = bridgePipNode() ? cardKey(bridgePipNode()!) : "";
  if (nk !== lastNodeKey) { lastNodeKey = nk; let any = false; for (const p of peers.values()) if (p.votes.size) { p.votes.clear(); any = true; } if (any) { sendAll({ t: "votes", votes: coachVotes() }); changed(); } }
  sendAll(infoNow());
}

async function addPeer(id: number) {
  const stream = bridgeStream();
  if (!stream || !ws) return;
  peers.get(id)?.pc.close();
  const pc = new RTCPeerConnection({ iceServers: COACH_ICE });
  const peer: Peer = { id, a: ++authorSeq, pc, dc: null, votes: new Map(), open: false, name: "", lastChat: 0, lastReact: 0 };
  peers.set(id, peer);
  const src = stream.getVideoTracks()[0];
  const track = src.clone();
  try { (track as MediaStreamTrack & { contentHint?: string }).contentHint = "detail"; } catch { /* 글자·세부 우선 */ }
  track.enabled = !hiddenNow;
  const sender = pc.addTrack(track, new MediaStream([track]));
  try {
    const prm = sender.getParameters();
    prm.encodings = [{ ...(prm.encodings?.[0] ?? {}), maxBitrate: 3_500_000, maxFramerate: 30 }];
    await sender.setParameters(prm);
  } catch { /* 브라우저가 못 맞추면 기본값 */ }
  const dc = pc.createDataChannel("info");
  peer.dc = dc;
  dc.onopen = () => {
    peer.open = true;
    dc.send(JSON.stringify(infoNow())); dc.send(JSON.stringify({ t: "votes", votes: coachVotes() }));
    dc.send(JSON.stringify({ t: "you", a: peer.a }));
    dc.send(JSON.stringify({ t: "chatlog", log: chatLog, off: chatOff, names: coachNames() }));
    sendAll({ t: "names", names: coachNames() });
    changed();
  };
  dc.onclose = () => { peer.open = false; changed(); };
  dc.onmessage = (e) => {
    let m: { t?: string; key?: string | null; v?: unknown; name?: unknown; text?: unknown; e?: unknown }; try { m = JSON.parse(String(e.data)); } catch { return; }
    if (m.t === "react") {
      const now = Date.now();
      if (!EMOTES.includes(m.e as Emote) || now - peer.lastReact < REACT_GAP) return;
      peer.lastReact = now;
      pushReact(peer.a, m.e as Emote);
      return;
    }
    if (m.t === "name") { peer.name = cleanText(m.name, NAME_MAX); sendAll({ t: "names", names: coachNames() }); changed(); return; }
    if (m.t === "chat") {
      const now = Date.now();
      const text = cleanText(m.text, CHAT_MAX);
      if (chatOff || !text || now - peer.lastChat < CHAT_GAP) return;
      peer.lastChat = now;
      pushChat(peer.a, peer.name || anonName(id), text);
      return;
    }
    // 추천(1)·비추천(-1)·취소(0) — 보는 사람이 원하는 상태를 보낸다
    if (m.t === "vote" && typeof m.key === "string" && m.key.length < 200) {
      if (m.v === 1 || m.v === -1) { if (!peer.votes.has(m.key) && peer.votes.size >= 40) return; peer.votes.set(m.key, m.v); }
      else peer.votes.delete(m.key);
      sendAll({ t: "votes", votes: coachVotes() });
      changed();
    }
  };
  pc.onicecandidate = (e) => { if (e.candidate) ws?.send(JSON.stringify({ t: "sig", to: id, data: { ice: e.candidate } })); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") { peer.open = false; changed(); }
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ t: "sig", to: id, data: { sdp: pc.localDescription } }));
}
function dropPeer(id: number) {
  const p = peers.get(id);
  if (!p) return;
  p.pc.getSenders().forEach((s) => s.track?.stop());
  p.pc.close();
  peers.delete(id);
  leftNames.set(p.a, p.name || anonName(p.id));
  sendAll({ t: "votes", votes: coachVotes() });
  sendAll({ t: "names", names: coachNames() });
  changed();
}

/** 훈수방 열기 — PRTS 링크가 연결돼 있어야 한다. 새 링크를 만들려면 fresh */
export function startCoach(fresh = false): void {
  if (!bridgeStream()) { failMsg = "PRTS 링크를 먼저 연결해 주세요"; changed(); return; }
  if (live && !fresh) return;
  stopCoach(false);
  code = newCode();
  live = true; failMsg = ""; hiddenNow = bridgeNotArknights();
  chatLog = []; chatUnread = 0; chatOff = false; leftNames.clear(); reacts = [];
  setBridgeShareRate(true);
  unsub = onBridgeChange(onBridge);
  connect();
  changed();
}
function connect() {
  const me = uid();
  const sock = new WebSocket(`${COACH_WS}${code}?role=host&uid=${encodeURIComponent(me)}`);
  ws = sock;
  sock.onmessage = (e) => {
    let m: { t: string; views?: number[]; id?: number; from?: number; data?: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit } };
    try { m = JSON.parse(String(e.data)); } catch { return; }
    if (m.t === "hello") for (const id of m.views ?? []) void addPeer(id);
    else if (m.t === "join" && m.id != null) void addPeer(m.id);
    else if (m.t === "leave" && m.id != null) dropPeer(m.id);
    else if (m.t === "sig" && m.from != null) {
      const p = peers.get(m.from);
      if (!p) return;
      if (m.data?.sdp) void p.pc.setRemoteDescription(m.data.sdp).catch(() => null);
      else if (m.data?.ice) void p.pc.addIceCandidate(m.data.ice).catch(() => null);
    } else if (m.t === "taken") { failMsg = "이 링크는 다른 사람이 쓰고 있어요 — 새 링크를 만들어 주세요"; stopCoach(false); }
  };
  sock.onclose = () => {
    if (ws !== sock || !live) return;
    // 끊기면 잠깐 뒤 다시 붙는다 — 보는 사람과의 영상(P2P)은 그대로 살아 있다
    setTimeout(() => { if (live && ws === sock) connect(); }, 2000);
  };
}
/** 보는 사람 모두 내보내기 — 링크는 그대로 (같은 링크로 다시 들어올 수 있다. 막으려면 새 링크) */
export function kickAllViewers(): void {
  ws?.send(JSON.stringify({ t: "kick" }));
  for (const id of [...peers.keys()]) dropPeer(id);
}
/** 훈수방 닫기 — 보는 사람에게 '끝났어요'를 보내고 영상을 끊는다 */
export function stopCoach(notifyEnd = true): void {
  if (ws) { try { if (notifyEnd && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "end" })); ws.close(); } catch { /* */ } }
  ws = null;
  for (const id of [...peers.keys()]) dropPeer(id);
  peers = new Map();
  unsub?.(); unsub = null;
  if (live) setBridgeShareRate(false);
  live = false; code = ""; lastNodeKey = "";
  changed();
}
