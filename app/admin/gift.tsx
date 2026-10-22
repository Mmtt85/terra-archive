"use client";

// 관리 — 한국 서버 쿠폰(교환 코드) 받기 (사용자 요청 2026-10-22). 공식 페이지 https://www.arknights.kr/gift 와 같은 요청을
// 관리 dev 프록시(scripts/admin-dev-proxy.ts /api/gift/*)로 보낸다 — 브라우저에서 바로 부르면 CORS 에 막힌다.
// UID 는 이 브라우저의 내 정보(한국 서버 로그인)에서 자동으로. 없으면 직접 넣는 칸이 열린다.
import { useEffect, useState } from "react";
import { getMe } from "../me-store";

type Res = { code?: number; message?: string; data?: { nickname?: string } };

export function GiftCoupon() {
  const [uid, setUid] = useState("");
  const [who, setWho] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const me = getMe();
    if (me?.server === "kr" && me.player?.uid) setUid(me.player.uid);
  }, []);
  // UID 가 정해지면 공식 확인 요청으로 닉네임을 받아 둔다 (공식 페이지의 '확인' 단계)
  useEffect(() => {
    if (!/^\d{1,8}$/.test(uid)) { setWho(null); return; }
    let dead = false;
    void fetch(`/api/gift/playerinfo?uid=${uid}`).then((r) => r.json() as Promise<Res>).then((j) => { if (!dead) setWho(j.message === "ok" ? j.data?.nickname ?? "" : null); }, () => { if (!dead) setWho(null); });
    return () => { dead = true; };
  }, [uid]);
  const valid = /^[0-9a-zA-Z]{16,20}$/.test(code) && /^\d{1,8}$/.test(uid);
  const redeem = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/gift/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid, code }) });
      const j = (await r.json().catch(() => ({}))) as Res;
      if (r.ok && j.message === "ok") { setMsg({ ok: true, text: "교환 완료 — 게임 우편함을 확인하세요" }); setCode(""); }
      else setMsg({ ok: false, text: j.message || `실패 (${r.status})` });
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="gift-coupon" onSubmit={(e) => { e.preventDefault(); void redeem(); }}>
      {/* 내 정보에 한국 서버 UID 가 없을 때만 직접 넣는 칸 */}
      {!getMe()?.player?.uid || getMe()?.server !== "kr"
        ? <input className="gift-uid" inputMode="numeric" maxLength={8} placeholder="UID" value={uid} onChange={(e) => setUid(e.target.value.replace(/\D/g, ""))} />
        : <span className="gift-who" title={`UID ${uid}`}>{who != null ? `DR.${who}` : uid}</span>}
      <input className="gift-code" placeholder="쿠폰 번호" maxLength={20} value={code} aria-label="쿠폰 번호"
        onChange={(e) => { setCode(e.target.value.replace(/[^0-9a-zA-Z]/g, "")); setMsg(null); }} />
      <button type="submit" className="tab-btn" disabled={!valid || busy}>{busy ? "보내는 중…" : "수령"}</button>
      {msg && <span className={`gift-msg${msg.ok ? " ok" : ""}`} role="status">{msg.text}</span>}
    </form>
  );
}
