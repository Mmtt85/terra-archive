"use client";

// 훈수방 — 보는 사람 화면 (2026-10-24). 링크(/w/<코드>)를 열면 바로 연결해 하는 사람 게임 화면과 PRTS 인식 정보를 띄운다.
// 코드 입력 없이 링크만으로 (사용자 지시 "URL 을 뿌리면 자동으로 해당 페이지로 가서 다 켜지게").
// 주소는 # 없는 /w/<코드> — 디시 등 게시판 자동 링크가 # 앞에서 끊는다(위수 협의 /p/<방ID> 와 같은 이유). 배포는 _redirects 가
// /w/* 를 이 페이지로 리라이트(200)하고, 개발 서버에선 /watch?c=<코드> 로 연다.
// 영상·정보·짚기는 하는 사람과 P2P(WebRTC), 방 워커는 연결 중개만 (app/lens/coach.ts 머리말).

import { useEffect, useRef, useState } from "react";
import { I18nProvider, useI18n, type Locale } from "./i18n";
import { COACH_ICE, COACH_MAX, COACH_WS, cardKey, type CoachInfo, type CoachPings } from "./lens/coach";
import type { BridgePipCard } from "./lens/bridge";

type Phase = "connecting" | "waiting" | "live" | "full" | "ended" | "kicked" | "hostgone" | "failed" | "bad";

function codeFromUrl(): string {
  const m = location.pathname.match(/\/w\/([a-z2-9]{8})\/?$/i);
  const q = new URLSearchParams(location.search).get("c") ?? location.hash.replace(/^#/, "");
  return (m?.[1] ?? q ?? "").toLowerCase();
}
const uid = () => {
  try { let v = localStorage.getItem("ta:coach-uid"); if (!v) { v = crypto.randomUUID().slice(0, 24); localStorage.setItem("ta:coach-uid", v); } return v; }
  catch { return "anon-" + Math.random().toString(36).slice(2, 10); }
};

function WatchInner() {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [info, setInfo] = useState<CoachInfo | null>(null);
  const [pings, setPings] = useState<CoachPings>({});
  const [myId, setMyId] = useState<number | null>(null);
  const [myPing, setMyPing] = useState<string | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  useEffect(() => {
    const code = codeFromUrl();
    if (!/^[a-z2-9]{8}$/.test(code)) { queueMicrotask(() => setPhase("bad")); return; }
    let pc: RTCPeerConnection | null = null;
    let ws: WebSocket | null = null;
    let dead = false;
    let failTimer: number | undefined;
    const reset = () => { pc?.close(); pc = null; dcRef.current = null; };
    const newPc = () => {
      reset();
      const p = new RTCPeerConnection({ iceServers: COACH_ICE });
      pc = p;
      p.ontrack = (e) => { const v = videoRef.current; if (v) { v.srcObject = e.streams[0] ?? new MediaStream([e.track]); void v.play().catch(() => null); } setPhase("live"); };
      p.ondatachannel = (e) => {
        const dc = e.channel; dcRef.current = dc;
        dc.onmessage = (ev) => {
          let m: { t?: string } & Partial<CoachInfo> & { pings?: CoachPings };
          try { m = JSON.parse(String(ev.data)); } catch { return; }
          if (m.t === "info") setInfo(m as CoachInfo);
          else if (m.t === "pings") setPings(m.pings ?? {});
        };
      };
      p.onicecandidate = (e) => { if (e.candidate) ws?.send(JSON.stringify({ t: "sig", data: { ice: e.candidate } })); };
      p.onconnectionstatechange = () => {
        if (p.connectionState === "connected") window.clearTimeout(failTimer);
        // 직접 연결이 안 되는 망(중계 서버는 쓰지 않는다) — 한참 붙지 않거나 실패하면 알린다
        if (p.connectionState === "failed") setPhase("failed");
      };
      window.clearTimeout(failTimer);
      failTimer = window.setTimeout(() => { if (pc === p && p.connectionState !== "connected") setPhase("failed"); }, 20_000);
      return p;
    };
    const connect = () => {
      const sock = new WebSocket(`${COACH_WS}${code}?role=view&uid=${encodeURIComponent(uid())}`);
      ws = sock;
      sock.onmessage = async (e) => {
        let m: { t: string; id?: number; host?: boolean; data?: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit } };
        try { m = JSON.parse(String(e.data)); } catch { return; }
        if (m.t === "hello") { setMyId(m.id ?? null); setPhase(m.host ? "connecting" : "waiting"); }
        else if (m.t === "full") setPhase("full");
        else if (m.t === "kicked") setPhase("kicked");
        else if (m.t === "ended") setPhase("ended");
        else if (m.t === "host-gone") { setPhase("hostgone"); reset(); }
        else if (m.t === "host-back") setPhase("connecting");
        else if (m.t === "sig") {
          if (m.data?.sdp) {
            const p = newPc();
            await p.setRemoteDescription(m.data.sdp);
            const ans = await p.createAnswer();
            await p.setLocalDescription(ans);
            sock.send(JSON.stringify({ t: "sig", data: { sdp: p.localDescription } }));
          } else if (m.data?.ice && pc) await pc.addIceCandidate(m.data.ice).catch(() => null);
        }
      };
      sock.onclose = (ev) => {
        if (dead || ws !== sock) return;
        if ([4003, 4004, 4005, 4002].includes(ev.code)) return;   // 꽉 참·내보내짐·끝남·만료 — 다시 붙지 않는다
        setTimeout(() => { if (!dead) connect(); }, 2000);
      };
    };
    connect();
    return () => { dead = true; window.clearTimeout(failTimer); ws?.close(); reset(); };
  }, []);

  const ping = (c: BridgePipCard) => {
    const key = cardKey(c);
    const next = myPing === key ? null : key;
    setMyPing(next);
    try { dcRef.current?.send(JSON.stringify({ t: "ping", key })); } catch { /* 아직 안 열림 */ }
  };
  const msg: Partial<Record<Phase, string>> = {
    connecting: t("하는 사람과 연결하는 중…"),
    waiting: t("하는 사람이 아직 들어오지 않았어요 — 화면 공유를 켜면 바로 보입니다"),
    full: t("자리가 다 찼어요 ({n}/{n})", { n: COACH_MAX }),
    ended: t("이 훈수방은 끝났어요"),
    kicked: t("하는 사람이 내보냈어요"),
    hostgone: t("하는 사람의 연결이 잠깐 끊겼어요 — 돌아오면 다시 이어집니다"),
    failed: t("이 네트워크에서는 직접 연결이 안 돼요 — 와이파이로 바꾸거나 다른 네트워크에서 열어 주세요"),
    bad: t("링크가 올바르지 않아요"),
  };
  const fl = info?.floor;
  const cards = [...(info?.node ? [info.node] : []), ...(info?.relics ?? [])];
  return (
    <main className="watch-page">
      <header className="watch-head">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 사이트 전체가 <a> 로 이동한다(next/link 안 씀) */}
        <a href="/" className="watch-brand">TERRA ARCHIVE</a>
        <b>{t("훈수방")}</b>
        <span className="beta-badge">BETA</span>
        {myId != null && phase === "live" && <small>{t("보는 사람 {n}번", { n: myId })}</small>}
      </header>
      <div className="watch-body">
        <section className="watch-video">
          <video ref={videoRef} autoPlay muted playsInline />
          {phase !== "live" && <p className="watch-msg">{msg[phase]}</p>}
          {phase === "live" && info?.hidden && <p className="watch-msg">{t("하는 사람이 잠시 다른 화면을 보고 있어요")}</p>}
        </section>
        <aside className="watch-side">
          {fl && (fl.floor != null || fl.name) && (
            <p className="watch-floor">{fl.floor ? t("{n}층", { n: fl.floor }) : ""}{fl.name ? ` · ${fl.name}` : ""}{fl.grade != null ? ` · ${t("난이도 {n}", { n: fl.grade })}` : ""}</p>
          )}
          <p className="watch-hint">{t("카드를 누르면 짚기 — 하는 사람 화면에 몇 명이 짚었는지 표시돼요. 다시 누르면 취소")}</p>
          <div className="watch-cards">
            {cards.map((c, i) => {
              const k = cardKey(c);
              const n = pings[k]?.length ?? 0;
              return (
                <button type="button" key={`${k}:${i}`} className={`watch-card${myPing === k ? " mine" : ""}`} onClick={() => ping(c)}>
                  {c.img && <img src={c.img} alt="" width={36} height={36} />}
                  <span><small>{c.kind}</small><b>{c.name}</b>{c.text && <em>{c.text}</em>}</span>
                  {n > 0 && <i className="watch-ping">{"●".repeat(n)}</i>}
                </button>
              );
            })}
            {!cards.length && <p className="watch-empty">{t("하는 사람의 PRTS 링크가 무언가를 인식하면 여기에 카드가 뜹니다")}</p>}
          </div>
        </aside>
      </div>
    </main>
  );
}

export default function Watch({ locale }: { locale: Locale }) {
  return <I18nProvider locale={locale}><WatchInner /></I18nProvider>;
}
