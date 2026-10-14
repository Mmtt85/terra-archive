"use client";

// 관리 — UID 로 사이트 설정 보기 (사용자 지시 2026-10-14 "어드민 페이지에서 UID 로 검색하면 설정 어떻게 돼 있는지 다").
// 내 정보로 로그인한 계정의 설정(app/cloud-prefs.tsx 가 올린 것)을 계정 워커 D1 에서 읽는다 — /api/prefs (admin-api 워커·dev 중계가 관리자 키를 붙인다)
import { useEffect, useState } from "react";
import { Dropdown } from "../dropdown";
import findMeta from "../data/story-find-meta.json";

type Entry = { t: number; d: string | null };
type Result = { ok: boolean; found?: boolean; server?: string; uid?: string; keys?: Record<string, Entry>; at?: number | null; error?: string };

const SERVERS = [["kr", "한섭"], ["jp", "일섭"], ["en", "글섭"], ["cn", "중섭 직영"], ["bili", "중섭 B"]] as const;
const LABEL: Record<string, string> = {
  "ta:me-layout": "내 정보 맞춤 칸", "ta:story-pos": "스토리 읽은 위치", "ta-feedback-token": "제안 열람 코드", "ta-feedback-extra": "예전 열람 코드",
  "ta-theme": "라이트·다크 모드", "ta-locale": "사이트 언어", "ta-include-future": "미래시 보기", "story-reader-prefs": "리더기 글자·삽화 크기",
  "story-reader-sound": "리더기 소리", "ta:gallery-spoiler": "갤러리 스포일러 가리기", "ta-recruit-prized": "공채 4★ 확정만", "ta:new-seen": "NEW 배지 본 기록",
  "terra-archive-infra-v3": "인프라 편성기 상태", "terra-archive-infra-recycle": "인프라 재활용소 우선도",
};
// 큰 값은 접어 둔다 — 열면 보인다
const BIG = new Set(["terra-archive-infra-v3", "ta:new-seen", "ta-feedback-token", "ta-feedback-extra"]);
// 이야기 이름 — 메인 스토리(main_N)까지 다 있는 대사 검색 목록에서 (stories.json 에는 메인 장이 없다)
const STORY_NAME = new Map((findMeta as unknown as { ko: { id: string; name: { ko: string } }[] }).ko.map((e) => [e.id, e.name.ko]));
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
    return <ol className="ap-list">{v.map((x: { id?: string; label?: string; labelKey?: string; key?: string; kind?: string }, i) => (
      <li key={x.id ?? i}>{x.label || x.labelKey || x.key || x.id}{x.kind && <span className="vz-note"> · {x.kind === "builtin" ? "기본 칸" : "직접 만든 칸"}</span>}</li>))}</ol>;
  }
  return <pre className="ap-pre">{JSON.stringify(v, null, 1)}</pre>;
}

// 설정 저장소 쓰기 — D1 무료 하루(UTC, 한국 9시에 풀림) 쓴 줄 10만. 계정 워커가 하루치를 센다(표 usage) — /api/prefs {usage}.
// 방문 통계의 내 정보 동기화 서버 단추 줄 오른쪽 끝에 붙는다 (사용자 지시 2026-10-15) — 지난 14일은 마우스를 올리면 보인다.
// 2026-10-15 KV(하루 1,000번)에서 D1 으로 옮겼다
export function KvWrites() {
  const [res, setRes] = useState<{ limit: number; days: { day: string; puts: number; deletes: number; rows: number }[] } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usage: 14 }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((j) => (j?.ok ? setRes(j) : setErr(true))).catch(() => setErr(true));
  }, []);
  if (err) return <span className="ap-kv">설정 저장소 쓰기 — 못 읽음</span>;
  if (!res) return null;
  const today = new Date().toISOString().slice(0, 10);
  const used = res.days.find((r) => r.day === today)?.rows ?? 0;
  const tip = [`D1 무료 플랜 하루 쓴 줄 ${res.limit.toLocaleString()} (UTC 기준, 한국 9시에 풀림)`, "",
    ...res.days.map((r) => `${r.day}  ${r.rows.toLocaleString()}줄 · 저장 ${r.puts} · 초기화 ${r.deletes}`)].join("\n");
  return (
    <span className="ap-kv" title={tip}>설정 저장소 쓰기 오늘 <b className={used >= res.limit * 0.8 ? "warn" : ""}>{used.toLocaleString()}</b> / {res.limit.toLocaleString()}줄</span>
  );
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
      <div className="vz-head"><h3 className="vz-h">UID 로 사이트 설정 보기<small> — 내 정보로 로그인한 계정이 저장해 둔 설정 (app/cloud-prefs.tsx)</small></h3></div>
      <div className="admin-tools ap-search">
        <Dropdown ariaLabel="서버" label={SERVERS.find(([v]) => v === server)?.[1] ?? server} selected={[server]}
          items={SERVERS.map(([v, l]) => ({ value: v, label: l }))} onPick={setServer} />
        <input value={uid} onChange={(e) => setUid(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} placeholder="UID (예: 07799010)" inputMode="numeric" />
        <button type="button" onClick={() => void search()} disabled={busy}>{busy ? "찾는 중…" : "찾기"}</button>
      </div>
      {res && !res.ok && <p className="vz-note">못 읽었습니다 — {res.error}</p>}
      {res?.ok && !res.found && <p className="vz-note">{res.server}:{res.uid} — 저장된 설정이 없습니다 (아직 이 기능이 생긴 뒤 로그인·동기화를 안 했다).</p>}
      {res?.ok && res.found && (
        <>
          <p className="vz-note">{res.server}:{res.uid}{res.at ? ` · 마지막 저장 ${when(res.at)}` : ""}</p>
          {Object.entries(res.keys ?? {}).map(([k, e]) => (
            <details key={k} className="ap-item" open={!BIG.has(k)}>
              <summary><b>{LABEL[k] ?? k}</b> <span className="vz-note">{k} · {when(e.t)} · {(e.d ?? "").length}자</span></summary>
              <Body k={k} d={e.d} />
            </details>
          ))}
        </>
      )}
    </section>
  );
}
