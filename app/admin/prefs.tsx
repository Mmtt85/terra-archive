"use client";

// 관리 — UID 로 사이트 설정 보기 (사용자 지시 2026-10-14 "어드민 페이지에서 UID 로 검색하면 설정 어떻게 돼 있는지 다").
// 내 정보로 로그인한 계정의 설정(app/cloud-prefs.tsx 가 올린 것)을 계정 워커 KV 에서 읽는다 — /api/prefs (admin-api 워커·dev 중계가 관리자 키를 붙인다)
import { useState } from "react";
import { Dropdown } from "../dropdown";
import storiesData from "../data/stories.json";

type Entry = { t: number; d: string | null };
type Result = { ok: boolean; found?: boolean; server?: string; uid?: string; keys?: Record<string, Entry>; at?: number | null; error?: string };

const SERVERS = [["kr", "한섭"], ["jp", "일섭"], ["en", "글섭"], ["cn", "중섭 직영"], ["bili", "중섭 B"]] as const;
const LABEL: Record<string, string> = {
  "ta:me-layout": "내 정보 맞춤 칸", "ta:story-pos": "스토리 읽은 위치", "ta-feedback-token": "제안 열람 코드", "ta-feedback-extra": "예전 열람 코드",
};
const STORY_NAME = new Map((storiesData as unknown as { events: { id: string; name: { ko: string } }[] }).events.map((e) => [e.id, e.name.ko]));
const when = (ms: number) => new Date(ms).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

function Body({ k, d }: { k: string; d: string | null }) {
  if (d === null) return <p className="vz-note">(비움)</p>;
  let v: unknown;
  try { v = JSON.parse(d); } catch { return <pre className="ap-pre">{d}</pre>; }
  if (k === "ta:story-pos" && v && typeof v === "object") {
    const rows = Object.entries(v as Record<string, { ep: number; line: number; at: number; done?: 1 }>).sort((a, b) => b[1].at - a[1].at);
    return (
      <div className="vz-tablewrap"><table className="vz-table">
        <thead><tr><th>이야기</th><th>위치</th><th>다 읽음</th><th>마지막</th></tr></thead>
        <tbody>{rows.map(([id, p]) => <tr key={id}><td title={id}>{STORY_NAME.get(id) ?? id}</td><td>{p.ep + 1}화 · {p.line}줄</td><td>{p.done ? "✓" : ""}</td><td>{when(p.at)}</td></tr>)}</tbody>
      </table></div>
    );
  }
  if (k === "ta:me-layout" && Array.isArray(v)) {
    return <ol className="ap-list">{v.map((x: { id?: string; label?: string; key?: string; kind?: string }, i) => <li key={x.id ?? i}>{x.label ?? x.key ?? x.id} <span className="vz-note">({x.kind})</span></li>)}</ol>;
  }
  return <pre className="ap-pre">{JSON.stringify(v, null, 1)}</pre>;
}

export default function PrefsPanel() {
  const [server, setServer] = useState("kr");
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const search = async () => {
    const u = uid.replace(/\D/g, "");
    if (!u) return;
    setBusy(true);
    try {
      const r = await fetch("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ server, uid: u }) });
      setRes(await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })));
    } catch (e) { setRes({ ok: false, error: String(e) }); }
    finally { setBusy(false); }
  };
  return (
    <section className="vz">
      <h2>UID 로 사이트 설정 보기</h2>
      <p className="vz-note">내 정보로 로그인한 계정이 이 사이트에 저장해 둔 설정 — 맞춤 칸·스토리 읽은 위치·제안 열람 코드 (app/cloud-prefs.tsx)</p>
      <div className="ap-search">
        <Dropdown ariaLabel="서버" label={SERVERS.find(([v]) => v === server)?.[1] ?? server} selected={[server]}
          items={SERVERS.map(([v, l]) => ({ value: v, label: l }))} onPick={setServer} />
        <input value={uid} onChange={(e) => setUid(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} placeholder="UID (예: 07799010)" inputMode="numeric" />
        <button type="button" className="vz-refresh" onClick={() => void search()} disabled={busy}>{busy ? "찾는 중…" : "찾기"}</button>
      </div>
      {res && !res.ok && <p className="vz-note">못 읽었습니다 — {res.error}</p>}
      {res?.ok && !res.found && <p className="vz-note">{res.server}:{res.uid} — 저장된 설정이 없습니다 (아직 이 기능이 생긴 뒤 로그인·동기화를 안 했다).</p>}
      {res?.ok && res.found && (
        <>
          <p className="vz-note">{res.server}:{res.uid}{res.at ? ` · 마지막 저장 ${when(res.at)}` : ""}</p>
          {Object.entries(res.keys ?? {}).map(([k, e]) => (
            <details key={k} className="ap-item" open={k !== "ta-feedback-token"}>
              <summary><b>{LABEL[k] ?? k}</b> <span className="vz-note">{k} · {when(e.t)} · {(e.d ?? "").length}자</span></summary>
              <Body k={k} d={e.d} />
            </details>
          ))}
        </>
      )}
    </section>
  );
}
