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

import { bridgeNotArknights, bridgePipFloor, bridgePipNode, bridgePipRelics, bridgeStream, onBridgeChange, setBridgeShareRate, type BridgePipCard } from "./bridge";

export const COACH_WS = "wss://terra-archive-acroom.nzkonaru.workers.dev/coach/";
export const COACH_ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
export const COACH_MAX = 3;
const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const UID_KEY = "ta:coach-uid";

/** 보는 사람에게 보내는 인식 정보 한 덩어리 */
export type CoachInfo = { t: "info"; node: BridgePipCard | null; relics: BridgePipCard[]; floor: ReturnType<typeof bridgePipFloor>; hidden: boolean };
/** 짚기 현황 — 카드 키 → 짚은 보는 사람 번호들 */
export type CoachPings = Record<string, number[]>;
export const cardKey = (c: Pick<BridgePipCard, "kind" | "name">) => `${c.kind}:${c.name}`;

type Peer = { id: number; pc: RTCPeerConnection; dc: RTCDataChannel | null; ping: string | null; open: boolean };
let ws: WebSocket | null = null;
let code = "";
let peers = new Map<number, Peer>();
let live = false;
let failMsg = "";
let unsub: (() => void) | null = null;
let hiddenNow = false;
const subs = new Set<() => void>();
const changed = () => { for (const cb of subs) cb(); };

export function onCoachChange(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export const coachState = () => ({ live, code, url: code ? `${location.origin}${location.pathname.startsWith("/en") ? "/en" : location.pathname.startsWith("/ja") ? "/ja" : ""}/w/${code}` : "",
  viewers: [...peers.values()].filter((p) => p.open).length, error: failMsg });
/** 카드별 짚기 수 */
export function coachPings(): CoachPings {
  const out: CoachPings = {};
  for (const p of peers.values()) if (p.ping) (out[p.ping] ??= []).push(p.id);
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
  // 노드가 바뀌면 짚기를 비운다 — 지난 화면의 투표가 남지 않게
  const nk = bridgePipNode() ? cardKey(bridgePipNode()!) : "";
  if (nk !== lastNodeKey) { lastNodeKey = nk; let any = false; for (const p of peers.values()) if (p.ping) { p.ping = null; any = true; } if (any) { sendAll({ t: "pings", pings: coachPings() }); changed(); } }
  sendAll(infoNow());
}

async function addPeer(id: number) {
  const stream = bridgeStream();
  if (!stream || !ws) return;
  peers.get(id)?.pc.close();
  const pc = new RTCPeerConnection({ iceServers: COACH_ICE });
  const peer: Peer = { id, pc, dc: null, ping: null, open: false };
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
  dc.onopen = () => { peer.open = true; dc.send(JSON.stringify(infoNow())); dc.send(JSON.stringify({ t: "pings", pings: coachPings() })); changed(); };
  dc.onclose = () => { peer.open = false; changed(); };
  dc.onmessage = (e) => {
    let m: { t?: string; key?: string | null }; try { m = JSON.parse(String(e.data)); } catch { return; }
    if (m.t === "ping") {
      peer.ping = typeof m.key === "string" && m.key.length < 200 ? (peer.ping === m.key ? null : m.key) : null;   // 같은 카드 다시 누르면 취소
      sendAll({ t: "pings", pings: coachPings() });
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
  sendAll({ t: "pings", pings: coachPings() });
  changed();
}

/** 훈수방 열기 — PRTS 링크가 연결돼 있어야 한다. 새 링크를 만들려면 fresh */
export function startCoach(fresh = false): void {
  if (!bridgeStream()) { failMsg = "PRTS 링크를 먼저 연결해 주세요"; changed(); return; }
  if (live && !fresh) return;
  stopCoach(false);
  code = newCode();
  live = true; failMsg = ""; hiddenNow = bridgeNotArknights();
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
