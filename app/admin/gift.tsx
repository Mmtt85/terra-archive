"use client";

// 관리 — 한국 서버 쿠폰(교환 코드) 받기 (사용자 요청 2026-10-22). 공식 페이지 https://www.arknights.kr/gift 와 같은 요청을
// 관리 dev 프록시(scripts/admin-dev-proxy.ts /api/gift/*)로 보낸다 — 브라우저에서 바로 부르면 CORS 에 막힌다.
// UID 는 안에서 정한다(아래 OWNER_UID · 내 정보) — 화면엔 쿠폰 번호 칸과 수령 단추만.
import { useEffect, useState } from "react";
import { getMe } from "../me-store";

type Res = { code?: number; message?: string; data?: { nickname?: string } };
// 운영자 본인 한국 서버 UID — admin.terra-archive.net 은 사이트와 주소가 달라 내 정보(localStorage)가 없다 (사용자 지적 2026-10-22
// "자동으로 내 UID"). 이 브라우저에 한국 서버 내 정보가 있으면 그 UID. 화면엔 UID 칸이 없다(쿠폰 번호만)
const OWNER_UID = "07799010";

export function GiftCoupon() {
  const [uid, setUid] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const me = getMe();
    setUid((me?.server === "kr" && me.player?.uid) || OWNER_UID);
  }, []);
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
      {/* 쿠폰 번호만 — UID 칸·닉네임 확인은 뺐다, UID 는 안에서 내 UID 로 (사용자 지시 2026-10-22) */}
      <input className="gift-code" placeholder="쿠폰 번호" maxLength={20} value={code} aria-label="쿠폰 번호"
        onChange={(e) => { setCode(e.target.value.replace(/[^0-9a-zA-Z]/g, "")); setMsg(null); }} />
      <button type="submit" className="tab-btn" disabled={!valid || busy}>{busy ? "보내는 중…" : "수령"}</button>
      {msg && <span className={`gift-msg${msg.ok ? " ok" : ""}`} role="status">{msg.text}</span>}
    </form>
  );
}
