"use client";

// 관리 — 만능검색(유니버셜 서치) 검색 내역 (사용자 지시 2026-10-19 "UID 설정 탭을 없애고 거기에 검색 내역").
// ① 이용 기록 = 방문 기록 DB visit_event kind 'omni' (app/omni-search.tsx 가 창을 열고 닫을 때까지 한 줄 — detail 검색어 ·
//    n 결과 수 · target 고른 항목 '종류:이름', 비면 안 고르고 닫음). 2026-10-19부터.
// ② 직접 연결 = 같은 DB 의 omni_answer (q 정규화 검색어 → url·label). 검색이 0건이었거나 안 고르고 닫은 말에 운영자가 주소를
//    직접 달면, 사이트 만능검색이 그 말에 '바로가기'를 맨 위에 띄운다 (같은 날 "검색에서 히트 안 했거나 안 들어간 건 내가 직접 URL 을").
// 읽고 쓰기는 /api/visits 중계(관리자 키를 붙인다)로. 표 만들기 SQL 은 docs/supabase-visits.sql 맨 끝.
import { useEffect, useMemo, useState } from "react";
import { normSearch } from "../search";
import { Who } from "./who";

type Row = { at: string; visitor: string | null; detail: string | null; target: string | null; n: number | null };
type Answer = { q: string; url: string; label: string | null; updated_at?: string };

const whenShort = (at: string) => new Date(at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const kstStartOfToday = () => {
  const d = new Date(Date.now() + 9 * 3600_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 9 * 3600_000;
};
const PERIODS = [{ k: 1, label: "오늘" }, { k: 7, label: "7일" }, { k: 30, label: "30일" }, { k: 365, label: "1년" }] as const;
const label = (t: string) => t.replace(/^[^:]+:/, "");

/** 한 검색어에 단 직접 연결 — 주소(사이트 경로 또는 전체 주소)·이름. 비우고 저장하면 지운다 */
function AnswerEditor({ q, cur, onSaved }: { q: string; cur?: Answer; onSaved: () => void }) {
  const [url, setUrl] = useState(cur?.url ?? "");
  const [name, setName] = useState(cur?.label ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const key = normSearch(q);
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const u = url.trim();
      const r = u
        ? await fetch("/api/visits/omni_answer?on_conflict=q", {
          method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify({ q: key, url: u, label: name.trim() || null, updated_at: new Date().toISOString() }),
        })
        : await fetch(`/api/visits/omni_answer?q=eq.${encodeURIComponent(key)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      const j = await r.json().catch(() => null);
      // ⚠ RLS 에 걸리면 200 + 빈 배열이다 — 0행이면 실패로 본다
      if (!r.ok || (u && !(Array.isArray(j) && j.length))) throw new Error(r.ok ? "저장된 행 없음 (표·권한 확인)" : String(r.status));
      onSaved();
    } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  return (
    <span className="om-edit">
      <input className="om-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/me#stages 또는 https://…" />
      <input className="om-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="보일 이름 (선택)" />
      <button type="button" disabled={busy} onClick={() => void save()}>{url.trim() ? "저장" : cur ? "지우기" : "저장"}</button>
      {err && <small className="vz-note om-err">{err}</small>}
    </span>
  );
}

export default function OmniPanel() {
  const [days, setDays] = useState<number>(7);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [err, setErr] = useState("");
  const [onlyMiss, setOnlyMiss] = useState(false);
  const [top, setTop] = useState(30);
  const [rev, setRev] = useState(0);
  const from = useMemo(() => new Date(kstStartOfToday() - (days - 1) * 86400_000).toISOString(), [days]);
  useEffect(() => {
    let alive = true;
    const load = () => Promise.all([
      fetch(`/api/visits/visit_event?select=at,visitor,detail,target,n&kind=eq.omni&env=eq.live&at=gte.${encodeURIComponent(from)}&order=at.desc&limit=5000`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`기록 ${r.status}`)))),
      fetch("/api/visits/omni_answer?select=q,url,label,updated_at&order=updated_at.desc&limit=2000", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([d, a]) => { if (!alive) return; setRows(Array.isArray(d) ? d : []); setAnswers(Array.isArray(a) ? a : []); setErr(""); })
      .catch((e) => { if (alive) setErr(String((e as Error).message ?? e)); });
    void load();
    const id = days === 1 ? window.setInterval(load, 30_000) : 0;   // 오늘 보기면 30초마다
    return () => { alive = false; if (id) window.clearInterval(id); };
  }, [from, days, rev]);
  const answerOf = useMemo(() => new Map(answers.map((a) => [a.q, a])), [answers]);
  const groups = useMemo(() => {
    const m = new Map<string, { q: string; n: number; people: Set<string>; zero: number; none: number; targets: Map<string, number> }>();
    for (const r of rows ?? []) {
      if (!r.detail) continue;
      const k = normSearch(r.detail);
      const g = m.get(k) ?? { q: r.detail, n: 0, people: new Set<string>(), zero: 0, none: 0, targets: new Map<string, number>() };
      g.n += 1; if (r.visitor) g.people.add(r.visitor);
      if ((r.n ?? 0) === 0) g.zero += 1;
      if (!r.target) g.none += 1; else g.targets.set(r.target, (g.targets.get(r.target) ?? 0) + 1);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || b.people.size - a.people.size);
  }, [rows]);
  if (err) return <p className="vz-note">검색 내역을 불러오지 못했습니다 — {err}. 방문 기록 DB 에 omni 기록 칸이 있는지(docs/supabase-visits.sql) 확인하세요.</p>;
  if (!rows) return <p className="vz-note">불러오는 중…</p>;
  const people = new Set(rows.map((r) => r.visitor).filter(Boolean)).size;
  const picked = rows.filter((r) => r.target).length;
  const zero = rows.filter((r) => (r.n ?? 0) === 0).length;
  // '못 찾음' = 0건이었거나 안 고르고 닫은 적이 있는 말 — 직접 연결을 달 후보
  const shown = (onlyMiss ? groups.filter((g) => g.zero || g.none) : groups).slice(0, top);
  return (
    <section className="om-panel">
      <div className="vz-head">
        <h3 className="vz-h">만능검색 검색 내역</h3>
        <span className="vz-note">{rows.length ? `검색 ${rows.length.toLocaleString()}회 · ${people}명 · 골라서 이동 ${Math.round((picked / rows.length) * 100)}% · 결과 0건 ${zero}회 · 직접 연결 ${answers.length}개` : "이 기간에는 기록이 없습니다 (2026-10-19부터 기록)"}</span>
        <div className="vz-head-tools">
          {PERIODS.map((p) => <button key={p.k} type="button" className={`tab-btn${days === p.k ? " selected" : ""}`} onClick={() => setDays(p.k)}>{p.label}</button>)}
          <label className="om-check"><input type="checkbox" checked={onlyMiss} onChange={(e) => setOnlyMiss(e.target.checked)} /> 못 찾은 말만</label>
          <select value={top} onChange={(e) => setTop(Number(e.target.value))}>{[30, 100, 500].map((n) => <option key={n} value={n}>상위 {n}</option>)}</select>
        </div>
      </div>
      <p className="vz-note">0건이었거나 안 고르고 닫은 검색어에 주소를 달면, 다음부터 그 말로 검색할 때 맨 위에 '바로가기'가 뜹니다. 주소는 사이트 경로(<code>/me#stages</code>)로 적으면 영어·일본어 화면에선 그 언어 경로로 바뀝니다. 비우고 저장하면 지웁니다.</p>
      <div className="vz-tablewrap"><table className="vz-table om-table">
        <thead><tr><th>검색어</th><th>횟수</th><th>사람</th><th>0건</th><th>안 고름</th><th>가장 많이 고른 곳</th><th>직접 연결</th></tr></thead>
        <tbody>{shown.map((g) => {
          const best = [...g.targets.entries()].sort((a, b) => b[1] - a[1])[0];
          const ans = answerOf.get(normSearch(g.q));
          return (
            <tr key={g.q} className={g.zero || g.none ? "om-miss" : undefined}>
              <td><code>{g.q}</code></td><td>{g.n}</td><td>{g.people.size}</td><td>{g.zero || "—"}</td><td>{g.none || "—"}</td>
              <td title={best?.[0] ?? ""}>{best ? `${label(best[0])} (${best[1]})` : "—"}</td>
              <td><AnswerEditor key={`${g.q}|${ans?.url ?? ""}`} q={g.q} cur={ans} onSaved={() => setRev((n) => n + 1)} /></td>
            </tr>
          );
        })}</tbody>
      </table></div>

      <div className="vz-head vz-subhead"><h4 className="vz-h">최근 검색</h4></div>
      <div className="vz-tablewrap"><table className="vz-table">
        <thead><tr><th>시각</th><th>누구</th><th>검색어</th><th>결과</th><th>고른 곳</th></tr></thead>
        <tbody>{rows.slice(0, top).map((r, i) => (
          <tr key={i}><td>{whenShort(r.at)}</td><td><Who visitor={r.visitor} /></td><td><code>{r.detail}</code></td><td>{r.n ?? "—"}</td>
            <td title={r.target ?? ""}>{r.target ? label(r.target) : <span className="vz-note">안 고르고 닫음</span>}</td></tr>
        ))}</tbody>
      </table></div>

      {answers.length > 0 && (<>
        <div className="vz-head vz-subhead"><h4 className="vz-h">직접 연결 전체</h4><span className="vz-note">{answers.length}개</span></div>
        <div className="vz-tablewrap"><table className="vz-table">
          <thead><tr><th>검색어</th><th>주소 · 이름</th><th>고친 때</th></tr></thead>
          <tbody>{answers.map((a) => (
            <tr key={a.q}><td><code>{a.q}</code></td><td><AnswerEditor key={`${a.q}|${a.url}`} q={a.q} cur={a} onSaved={() => setRev((n) => n + 1)} /></td><td>{a.updated_at ? whenShort(a.updated_at) : "—"}</td></tr>
          ))}</tbody>
        </table></div>
      </>)}
    </section>
  );
}
