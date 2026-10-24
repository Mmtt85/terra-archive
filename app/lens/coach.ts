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
import { getMe } from "../me-store";
import { bridgeLock, bridgeNotArknights, bridgePipFloor, bridgePipNode, bridgePipRelics, bridgeStream, onBridgeChange, setBridgeShareRate, type BridgePipCard } from "./bridge";

export const COACH_WS = "wss://terra-archive-acroom.nzkonaru.workers.dev/coach/";
export const COACH_ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
export const COACH_MAX = 3;
/** 공개방 한 줄 (방 워커 /coach-lobby) */
export type CoachLobbyRoom = { code: string; title?: string; server?: string; topic?: string; name: string; theme: string; floor: number | null; grade: number | null; viewers: number; max: number; since: number };
export async function coachLobby(): Promise<CoachLobbyRoom[]> {
  const r = await fetch(COACH_WS.replace(/^wss:/, "https:").replace(/\/coach\/$/, "/coach-lobby"), { cache: "no-store" });
  const j = await r.json() as { rooms?: CoachLobbyRoom[] };
  return j.rooms ?? [];
}
const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const UID_KEY = "ta:coach-uid";

/** 보는 사람에게 보내는 인식 정보 한 덩어리 */
export type CoachInfo = { t: "info"; title?: string; server?: string; node: BridgePipCard | null; relics: BridgePipCard[]; floor: ReturnType<typeof bridgePipFloor>; hidden: boolean };
/** 추천·비추천 현황 — 카드 키 → 추천한/비추천한 보는 사람 번호들. 한 사람이 카드마다 하나씩 (사용자 지시 2026-10-24 "추천 비추천 기능") */
export type CoachVotes = Record<string, { up: number[]; down: number[] }>;
export const cardKey = (c: Pick<BridgePipCard, "kind" | "name">) => `${c.kind}:${c.name}`;
/** 채팅 한 줄 — from = 쓴 사람 열쇠(0 = 하는 사람, 보는 사람은 연결마다 새 번호). 이름은 줄에 박지 않고 names 로 그때그때 찾는다 —
 *  중간에 닉네임을 바꾸면 지난 줄도 새 닉네임으로 보여야 한다 (사용자 지시 2026-10-24). name 은 names 에 없을 때의 대비 */
export type CoachMsg = { id: number; from: number; name: string; text: string; at: number; sys?: "join" | "leave" };
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

/** 보내는 화질 단계 — 높이(h) 상한·프레임·보는 사람 1명당 비트레이트 상한 (사용자 지시 2026-10-24 "720 30 / 720 60 / 1080 30 / 1080 60,
 *  최저·저·중·고사양"). 게임 창이 h 보다 작으면 그대로, 크면 h 에 맞춰 줄여 보낸다. 캡처(인식용)는 원래 크기 그대로 — 보낼 때만 줄인다 */
export const QUALITIES = [
  { id: "min", label: "최저사양", h: 720, fps: 30, br: 2_500_000 },
  { id: "low", label: "저사양", h: 720, fps: 60, br: 4_000_000 },
  { id: "mid", label: "중사양", h: 1080, fps: 30, br: 4_500_000 },
  { id: "high", label: "고사양", h: 1080, fps: 60, br: 7_000_000 },
] as const;
export type QualityId = typeof QUALITIES[number]["id"];
const QUALITY_KEY = "ta:coach-quality";
export function coachQuality(): QualityId {
  try { const v = localStorage.getItem(QUALITY_KEY); if (QUALITIES.some((q) => q.id === v)) return v as QualityId; } catch { /* */ }
  return "min";   // 기본 최저사양 — 셋이 들어오면 중사양도 하는 사람 PC 가 한계까지 찼다 (사용자 시험 2026-10-25)
}
const qOf = (id: QualityId) => QUALITIES.find((q) => q.id === id) ?? QUALITIES[2];
/** 보내는 영상 하나에 단계를 입힌다 — 연결을 끊지 않고 그 자리에서 바뀐다 */
/** 데이터 절약 — 보는 사람이 켜면(폰은 처음부터 켜짐) 그 사람에게만 540p 30프레임으로. 하는 사람이 고른 단계가 더 낮으면 그쪽
 *  (사용자 지시 2026-10-25 "모바일은 해상도 낮추고"). 360p 는 게임 글자가 뭉개져서 540p 로 정했다 */
const SAVE_Q = { h: 540, fps: 30, br: 1_500_000 };
/** 보내는 영상 하나 — 캡처 원본(인식용, 원래 크기)을 복제해 **한 번만** 단계 크기로 줄인 것. 보는 사람 모두가 같이 쓴다.
 *  종전엔 보는 사람마다 복제해 각자 원본에서 줄여서, 셋이면 큰 원본(레티나 창)을 세 번 줄이느라 PC 가 한계까지 찼다 (사용자 시험 2026-10-25) */
let sendTrack: MediaStreamTrack | null = null;
function sendTrackNow(): MediaStreamTrack | null {
  const src = bridgeStream()?.getVideoTracks()[0];
  if (!src) return null;
  if (!sendTrack || sendTrack.readyState === "ended") {
    sendTrack = src.clone();
    try { (sendTrack as MediaStreamTrack & { contentHint?: string }).contentHint = "detail"; } catch { /* 글자·세부 우선 */ }
    sendTrack.enabled = !hiddenNow;
    fitSendTrack();
  }
  return sendTrack;
}
/** 단계 높이·프레임으로 줄인다 — 창이 더 작으면 그대로 (max 제약) */
function fitSendTrack(): void {
  const q = qOf(coachQuality());
  void sendTrack?.applyConstraints({ height: { max: q.h }, frameRate: { max: q.fps } }).catch(() => { /* 못 맞추면 보낼 때 줄인다 */ });
}
async function applyQuality(sender: RTCRtpSender, save = false): Promise<void> {
  const host = qOf(coachQuality());
  const q = save ? { h: Math.min(host.h, SAVE_Q.h), fps: Math.min(host.fps, SAVE_Q.fps), br: Math.min(host.br, SAVE_Q.br) } : host;
  // 이미 단계 크기로 줄인 영상 기준 — 더 줄일 건 데이터 절약뿐 (줄이기가 안 먹은 브라우저면 원본 기준으로 여기서 줄인다)
  const srcH = (sender.track ?? sendTrack)?.getSettings().height ?? bridgeStream()?.getVideoTracks()[0]?.getSettings().height ?? 0;
  try {
    const prm = sender.getParameters();
    prm.encodings = [{ ...(prm.encodings?.[0] ?? {}), maxBitrate: q.br, maxFramerate: q.fps, scaleResolutionDownBy: srcH > q.h ? srcH / q.h : 1 }];
    // 버거우면 해상도·프레임을 같이 조금씩 — 종전('글자·세부 우선')엔 해상도만 지키고 프레임을 버려 멈칫멈칫했다 (사용자 시험 2026-10-25)
    (prm as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = "balanced";
    await sender.setParameters(prm);
  } catch { /* 브라우저가 못 맞추면 기본값 */ }
}
let appliedSrcH = 0;
/** 단계 바꾸기 — 캡처 프레임과 보는 사람 모두의 영상에 바로 반영 */
export function setCoachQuality(id: QualityId): void {
  try { localStorage.setItem(QUALITY_KEY, id); } catch { /* 이번만 */ }
  if (live) { setBridgeShareRate(qOf(id).fps); fitSendTrack(); for (const p of peers.values()) for (const sd of p.pc.getSenders()) if (sd.track) void applyQuality(sd, p.save); }
  changed();
}
/** 실측 — 보는 사람마다 지금 나가는 해상도·프레임·비트레이트 (연결 통계, 2초마다) */
/** limit = 화질이 깎인 이유(cpu·bandwidth·none) · avail = 추정 업로드 여유(Mbps) · hw = 하드웨어 압축 여부(브라우저가 알려 줄 때만) */
export type CoachStat = { id: number; w: number; h: number; fps: number; mbps: number; save: boolean; limit: string; avail: number; codec: string; hw: boolean | null };
let stats: CoachStat[] = [];
let statTimer: number | undefined;
const lastBytes = new Map<number, { b: number; at: number }>();
export const coachStats = () => stats;
/** 영상 형식은 H.264 우선 — 맥·윈도우 대부분에서 그래픽카드가 압축해, 보는 사람마다 따로 압축해도 CPU 를 거의 안 쓴다.
 *  크롬 기본(VP8)은 CPU 로만 압축해 셋에게 1080p 를 보내면 멈칫멈칫했다 (사용자 시험 2026-10-25). 받는 쪽(아이폰 포함)도 하드웨어로 푼다 */
function preferH264(pc: RTCPeerConnection, sender: RTCRtpSender): void {
  try {
    const tr = pc.getTransceivers().find((x) => x.sender === sender);
    const caps = RTCRtpSender.getCapabilities?.("video")?.codecs ?? [];
    if (!tr?.setCodecPreferences || !caps.length) return;
    const h264 = caps.filter((c) => /h264/i.test(c.mimeType));
    if (!h264.length) return;
    tr.setCodecPreferences([...h264, ...caps.filter((c) => !/h264/i.test(c.mimeType))]);
  } catch { /* 못 고르면 브라우저 기본 */ }
}
/** 하는 사람 PC 부하 — 크롬의 Compute Pressure(PressureObserver)가 있으면 nominal·fair·serious·critical 네 단계 */
let pcLoad = "";
let pressure: { observe: (s: string, o?: object) => Promise<void>; disconnect: () => void } | null = null;
export const coachPcLoad = () => pcLoad;
function watchPressure(on: boolean): void {
  try {
    if (!on) { pressure?.disconnect(); pressure = null; pcLoad = ""; return; }
    const PO = (globalThis as unknown as { PressureObserver?: new (cb: (r: { state: string }[]) => void) => typeof pressure }).PressureObserver;
    if (!PO || pressure) return;
    pressure = new PO((recs) => { const st = recs[recs.length - 1]?.state ?? ""; if (st !== pcLoad) { pcLoad = st; changed(); } });
    void pressure?.observe("cpu", { sampleInterval: 2000 }).catch(() => { pressure = null; });
  } catch { pressure = null; }
}
async function pollStats(): Promise<void> {
  const out: CoachStat[] = [];
  for (const p of peers.values()) {
    if (!p.open) continue;
    try {
      const rep = await p.pc.getStats();
      // 회선 여유(추정 업로드 가능량)·쓰는 영상 형식 — 같은 보고서의 다른 줄에서
      let avail = 0;
      const codecs = new Map<string, string>();
      rep.forEach((r: { type?: string; id?: string; mimeType?: string; nominated?: boolean; state?: string; availableOutgoingBitrate?: number }) => {
        if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded" && r.availableOutgoingBitrate) avail = r.availableOutgoingBitrate;
        if (r.type === "codec" && r.id && r.mimeType) codecs.set(r.id, r.mimeType.replace(/^video\//i, ""));
      });
      rep.forEach((r: { type?: string; kind?: string; frameWidth?: number; frameHeight?: number; framesPerSecond?: number; bytesSent?: number; timestamp?: number; qualityLimitationReason?: string; codecId?: string; encoderImplementation?: string; powerEfficientEncoder?: boolean }) => {
        if (r.type !== "outbound-rtp" || r.kind !== "video") return;
        const prev = lastBytes.get(p.id);
        const b = r.bytesSent ?? 0, at = r.timestamp ?? Date.now();
        const mbps = prev && at > prev.at ? ((b - prev.b) * 8) / ((at - prev.at) / 1000) / 1e6 : 0;
        lastBytes.set(p.id, { b, at });
        out.push({ id: p.id, w: r.frameWidth ?? 0, h: r.frameHeight ?? 0, fps: Math.round(r.framesPerSecond ?? 0), mbps: Math.round(mbps * 10) / 10, save: p.save,
          limit: r.qualityLimitationReason ?? "none", avail: Math.round(avail / 1e5) / 10,
          codec: (r.codecId && codecs.get(r.codecId)) || "", hw: r.powerEfficientEncoder ?? null });
      });
    } catch { /* 닫히는 중 */ }
  }
  stats = out.sort((a, b) => a.id - b.id);
  changed();
}
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
const TITLE_KEY = "ta:coach-title";
export const TITLE_MAX = 40;
/** 방 제목 — 공유를 시작할 때 정한다(공유 중에도 바꿀 수 있다). 공개방 목록·보는 사람 화면 머리에 나온다 (사용자 지시 2026-10-24) */
export function coachTitle(): string { try { return cleanText(localStorage.getItem(TITLE_KEY), TITLE_MAX); } catch { return ""; } }
export function setCoachTitle(v: string): void {
  try { localStorage.setItem(TITLE_KEY, cleanText(v, TITLE_MAX)); } catch { /* 이번만 */ }
  if (live) { sendAll(infoNow()); sendMeta(); }
  changed();
}
/** 글 다듬기 — 제어 문자를 빼고 줄바꿈은 띄어쓰기로, 길이 제한 */
export const cleanText = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
export function coachName(): string { try { return cleanText(localStorage.getItem(NAME_KEY), NAME_MAX); } catch { return ""; } }
export function setCoachName(v: string): void {
  try { localStorage.setItem(NAME_KEY, cleanText(v, NAME_MAX)); } catch { /* 이번만 */ }
  if (live) { sendAll({ t: "names", names: coachNames(), present: coachPresent() }); sendMeta(); }
  changed();
}

type Peer = { id: number; a: number; save: boolean; pc: RTCPeerConnection; dc: RTCDataChannel | null; votes: Map<string, 1 | -1>; open: boolean; name: string; lastChat: number; lastReact: number };
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
// 공개방 — 켜면 방 워커 장부(공개방 목록)에 겉정보를 알린다. 공유를 새로 켤 때마다 비공개로 시작 (사용자 지시 2026-10-24)
let pub = false;
let metaTimer: number | undefined;
let lastMeta = "";
let reactSeq = 0;
const leftNames = new Map<number, string>();   // 나간 사람의 마지막 이름 — 지난 줄이 번호로 바뀌지 않게
const subs = new Set<() => void>();
const changed = () => { for (const cb of subs) cb(); };

export function onCoachChange(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export const coachState = () => ({ live, code, url: code ? `${location.origin}${location.pathname.startsWith("/en") ? "/en" : location.pathname.startsWith("/ja") ? "/ja" : ""}/w/${code}` : "",
  viewers: [...peers.values()].filter((p) => p.open).length, error: failMsg });
/** 지금 들어와 있는 사람 — 쓴 사람 열쇠(0 = 하는 사람). 참여자 목록용 (사용자 지시 2026-10-25 "입장한 사람 목록") */
export function coachPresent(): number[] { return [0, ...[...peers.values()].filter((p) => p.open).sort((a, b) => a.id - b.id).map((p) => p.a)]; }
/** 쓴 사람 열쇠 → 지금 이름 (하는 사람·지금 있는 사람·나간 사람) */
export function coachNames(): CoachNames {
  const out: CoachNames = { "0": coachName() || "하는 사람" };
  for (const [a, n] of leftNames) out[String(a)] = n;
  for (const p of peers.values()) out[String(p.a)] = p.name || anonName(p.id);
  return out;
}
/** 공개방 여부 */
export const coachPublic = () => pub;
function metaNow() {
  const f = bridgePipFloor();
  // 관리 기록용(방문 통계 '같이 보기') — 동기화한 게임 계정 닉네임·지금 참여자 이름. 공개 목록에는 장부가 빼고 싣는다
  const me = getMe();
  const acct = me ? `${me.player.nickName}#${me.player.nickNumber}` : "";
  const roster = [...peers.values()].filter((p) => p.open).map((p) => ({ id: p.id, name: p.name || anonName(p.id) }));
  return { acct, roster, title: coachTitle(), server: hostServer(), topic: bridgeLock()?.topic ?? "", name: coachName() || "", theme: bridgeLock()?.name ?? "", floor: typeof f.floor === "number" ? f.floor : null, grade: typeof f.grade === "number" ? f.grade : null };
}
/** 장부에 알리기 — force 가 아니면 바뀌었을 때만 */
function sendMeta(force = false): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const body = JSON.stringify({ t: "meta", pub, meta: metaNow() });
  if (!force && body === lastMeta) return;
  lastMeta = body;
  try { ws.send(body); } catch { /* 다시 붙으면 보낸다 */ }
}
export function setCoachPublic(v: boolean): void {
  pub = v;
  sendMeta(true);
  changed();
}
/** 지금 떠 있는 반응들 */
export const coachReacts = () => reacts;
/** 하는 사람도 반응을 보낸다 — 보는 사람 영상 위와 내 작은 창에 같이 뜬다 (사용자 지시 2026-10-25 "하는 사람은 이모지를 못 누른다") */
export function coachReact(e: Emote): void { if (live && EMOTES.includes(e)) pushReact(0, e); }
/** 추천·비추천이 들어온 순간 — 작은 창에 잠깐 크게 알린다 (사용자 지적 2026-10-25 "눌렀는지 티가 안 난다") */
export type CoachVoteFx = { id: number; from: number; up: boolean; card: string; at: number };
let voteFx: CoachVoteFx[] = [];
let voteFxSeq = 0;
export const coachVoteFx = () => voteFx;
function pushVoteFx(from: number, up: boolean, key: string): void {
  const now = Date.now();
  const fx: CoachVoteFx = { id: ++voteFxSeq, from, up, card: key.slice(key.indexOf(":") + 1), at: now };
  voteFx = [...voteFx.filter((x) => now - x.at < 3500), fx].slice(-4);
  setTimeout(() => { voteFx = voteFx.filter((x) => Date.now() - x.at < 3500); changed(); }, 3550);
}
function pushReact(from: number, e: Emote): void {
  const now = Date.now();
  const r: CoachReact = { id: ++reactSeq, e, from, at: now };
  reacts = [...reacts.filter((x) => now - x.at < REACT_MS), r].slice(-16);
  sendAll({ t: "react", r });
  changed();
  setTimeout(() => { reacts = reacts.filter((x) => Date.now() - x.at < REACT_MS); changed(); }, REACT_MS + 50);
}
/** 채팅 — 지금까지 온 줄(최근 CHAT_KEEP)·꺼짐·안 읽은 수·이름표 */
export const coachChat = () => ({ log: chatLog, off: chatOff, unread: chatUnread, names: coachNames(), present: coachPresent() });
export function coachChatRead(): void { if (chatUnread) { chatUnread = 0; changed(); } }
function pushChat(from: number, name: string, text: string, sys?: "join" | "leave"): void {
  const m: CoachMsg = { id: ++chatSeq, from, name, text, at: Date.now(), ...(sys ? { sys } : {}) };
  chatLog = [...chatLog, m].slice(-CHAT_KEEP);
  if (from !== 0 && !sys) chatUnread++;
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

/** 하는 사람이 플레이 중인 서버 — 내 정보에 동기화한 지금 계정의 서버 (사용자 지시 2026-10-24 "어느 서버 플레이 중인지") */
const hostServer = () => getMe()?.server ?? "";
const infoNow = (): CoachInfo => ({ t: "info", title: coachTitle(), server: hostServer(), node: bridgePipNode(), relics: bridgePipRelics(), floor: bridgePipFloor(), hidden: hiddenNow });
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
    if (sendTrack) sendTrack.enabled = !hide;   // 보는 사람 모두가 같은 영상을 쓴다
  }
  // 게임 창 크기가 바뀌면 줄이는 비율을 다시 맞춘다
  const srcH = bridgeStream()?.getVideoTracks()[0]?.getSettings().height ?? 0;
  if (srcH && srcH !== appliedSrcH) { appliedSrcH = srcH; for (const p of peers.values()) for (const sd of p.pc.getSenders()) if (sd.track) void applyQuality(sd, p.save); }
  // 노드가 바뀌면 추천·비추천을 비운다 — 지난 화면의 투표가 남지 않게
  const nk = bridgePipNode() ? cardKey(bridgePipNode()!) : "";
  if (nk !== lastNodeKey) { lastNodeKey = nk; let any = false; for (const p of peers.values()) if (p.votes.size) { p.votes.clear(); any = true; } if (any) { sendAll({ t: "votes", votes: coachVotes() }); changed(); } }
  sendAll(infoNow());
  sendMeta();
}

async function addPeer(id: number) {
  const stream = bridgeStream();
  if (!stream || !ws) return;
  peers.get(id)?.pc.close();
  const pc = new RTCPeerConnection({ iceServers: COACH_ICE });
  const peer: Peer = { id, a: ++authorSeq, save: false, pc, dc: null, votes: new Map(), open: false, name: "", lastChat: 0, lastReact: 0 };
  peers.set(id, peer);
  const track = sendTrackNow();
  if (!track) return;
  const sender = pc.addTrack(track, new MediaStream([track]));
  preferH264(pc, sender);
  await applyQuality(sender, peer.save);
  const dc = pc.createDataChannel("info");
  peer.dc = dc;
  dc.onopen = () => {
    peer.open = true;
    pushChat(peer.a, peer.name || anonName(id), "", "join");   // 입장 한 줄 — 이름은 그때그때 찾아 닉네임을 바꿔도 따라간다
    sendMeta();   // 참여자 이름 — 관리 기록용
    dc.send(JSON.stringify(infoNow())); dc.send(JSON.stringify({ t: "votes", votes: coachVotes() }));
    dc.send(JSON.stringify({ t: "you", a: peer.a }));
    dc.send(JSON.stringify({ t: "chatlog", log: chatLog, off: chatOff, names: coachNames() }));
    sendAll({ t: "names", names: coachNames(), present: coachPresent() });
    changed();
  };
  dc.onclose = () => { peer.open = false; changed(); };
  dc.onmessage = (e) => {
    let m: { t?: string; key?: string | null; v?: unknown; name?: unknown; text?: unknown; e?: unknown }; try { m = JSON.parse(String(e.data)); } catch { return; }
    if (m.t === "save") {
      peer.save = !!(m as { on?: unknown }).on;
      for (const sd of pc.getSenders()) if (sd.track) void applyQuality(sd, peer.save);
      changed();
      return;
    }
    if (m.t === "react") {
      const now = Date.now();
      if (!EMOTES.includes(m.e as Emote) || now - peer.lastReact < REACT_GAP) return;
      peer.lastReact = now;
      pushReact(peer.a, m.e as Emote);
      return;
    }
    if (m.t === "name") { peer.name = cleanText(m.name, NAME_MAX); sendAll({ t: "names", names: coachNames(), present: coachPresent() }); sendMeta(); changed(); return; }
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
      if (m.v === 1 || m.v === -1) { if (!peer.votes.has(m.key) && peer.votes.size >= 40) return; peer.votes.set(m.key, m.v); pushVoteFx(peer.a, m.v === 1, m.key); }
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
  // 보내는 영상은 모두가 같이 쓰므로 여기서 멈추지 않는다 — 훈수방을 닫을 때(stopCoach) 멈춘다
  p.pc.close();
  peers.delete(id);
  leftNames.set(p.a, p.name || anonName(p.id));
  if (p.open) pushChat(p.a, p.name || anonName(p.id), "", "leave");
  sendMeta();
  sendAll({ t: "votes", votes: coachVotes() });
  sendAll({ t: "names", names: coachNames(), present: coachPresent() });
  changed();
}

/** 훈수방 열기 — PRTS 링크가 연결돼 있어야 한다. 새 링크를 만들려면 fresh */
export function startCoach(fresh = false): void {
  if (!bridgeStream()) { failMsg = "PRTS 링크를 먼저 연결해 주세요"; changed(); return; }
  if (live && !fresh) return;
  stopCoach(false);
  code = newCode();
  live = true; failMsg = ""; hiddenNow = bridgeNotArknights();
  chatLog = []; chatUnread = 0; chatOff = false; leftNames.clear(); reacts = []; pub = false; lastMeta = "";
  // 공개·비공개 상관없이 30초마다 장부에 알린다 — 공개 목록은 공개방만, 관리 기록은 전부 (90초 소식이 없으면 목록에서 빠진다)
  window.clearInterval(metaTimer); metaTimer = window.setInterval(() => sendMeta(true), 30_000);
  setBridgeShareRate(qOf(coachQuality()).fps);
  window.clearInterval(statTimer); statTimer = window.setInterval(() => void pollStats(), 2000);
  watchPressure(true);
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
    if (m.t === "hello") { for (const id of m.views ?? []) void addPeer(id); lastMeta = ""; sendMeta(true); }
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
  if (live) setBridgeShareRate(0);
  window.clearInterval(statTimer); stats = []; lastBytes.clear(); watchPressure(false);
  sendTrack?.stop(); sendTrack = null;
  window.clearInterval(metaTimer); pub = false; lastMeta = "";
  live = false; code = ""; lastNodeKey = "";
  changed();
}
