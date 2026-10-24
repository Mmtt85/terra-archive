"use client";

// 방문 통계 '같이 보기' 탭 (사용자 지시 2026-10-25) — 게임 화면 같이 보기 방: 지금 열린 방(비공개 포함)과 날짜별 기록
// (누가 언제 열고 닫았나·최대 몇 명·누가 들어왔나). 방 워커 /admin/coach 가 준다 — 위수 협의 파티 방 목록과 같은 보기 키.
// 영상·채팅 내용은 기록되지 않는다 — 하는 사람이 30초마다 알려 오는 겉정보와 참여자 이름·시각뿐 (workers/acroom CoachLobby)

import { useEffect, useMemo, useState } from "react";
import { getBoardAdminKey } from "../feedback";

const BASE = "https://terra-archive-acroom.nzkonaru.workers.dev";
const SERVER_LABEL: Record<string, string> = { kr: "한국", jp: "일본", en: "글로벌", cn: "중국", bili: "중국(B)" };

type Live = { code: string; pub: boolean; title: string; name: string; acct: string; server: string; theme: string; topic: string;
  floor: number | null; grade: number | null; viewers: number; roster: { id: number; name: string }[]; max: number; since: number; at: number };
type Hist = { code: string; title: string; name: string; acct: string; server: string; theme: string; floor: number | null; grade: number | null;
  open: number; last: number; ended: boolean; pub: boolean; peak: number; people: Record<string, { first: number; last?: number }> };
type Res = { live: Live[]; days: { day: string; rooms: Hist[] }[]; today: string };

const hm = (ms: number) => new Date(ms).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
const mins = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };
const where = (r: { server: string; theme: string; floor: number | null; grade: number | null }) =>
  [SERVER_LABEL[r.server] ?? r.server, r.theme, r.floor ? `${r.floor}층` : "", r.grade != null ? `난이도 ${r.grade}` : ""].filter(Boolean).join(" · ");
const host = (r: { name: string; acct: string }) => [r.name || "(닉네임 없음)", r.acct ? `· ${r.acct}` : ""].join(" ");

export default function CoachPanel({ tick }: { tick: number }) {
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState("");
  const [day, setDay] = useState("");
  const [now, setNow] = useState(0);
  useEffect(() => {
    const key = getBoardAdminKey();
    if (!key) { queueMicrotask(() => setErr("보기 키 없음")); return; }
    let alive = true;
    fetch(`${BASE}/admin/coach`, { headers: { "x-admin-key": key }, cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(r.status === 403 ? "키가 맞지 않음" : `HTTP ${r.status}`); return r.json() as Promise<Res>; })
      .then((d) => { if (alive) { setRes(d); setErr(""); setNow(Date.now()); } })
      .catch((e) => { if (alive) setErr(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [tick]);
  const days = useMemo(() => res?.days ?? [], [res]);
  const pick = day || res?.today || days[0]?.day || "";
  const rooms = days.find((d) => d.day === pick)?.rooms ?? [];
  if (err) return <p className="vz-note">같이 보기 기록을 못 받았습니다 ({err}).</p>;
  if (!res) return <p className="vz-note">불러오는 중…</p>;
  const todayRooms = days.find((d) => d.day === res.today)?.rooms ?? [];
  const todayPeople = new Set(todayRooms.flatMap((r) => Object.keys(r.people))).size;
  return (
    <div className="vz-match">
      <div className="vz-kpis">
        <div><span>지금 열린 방</span><b>{res.live.length}</b></div>
        <div><span>그중 공개방</span><b>{res.live.filter((r) => r.pub).length}</b></div>
        <div><span>지금 보는 사람</span><b>{res.live.reduce((n, r) => n + r.viewers, 0)}</b></div>
        <div><span>오늘 열린 방</span><b>{todayRooms.length}</b></div>
        <div><span>오늘 들어온 사람(이름 기준)</span><b>{todayPeople}</b></div>
      </div>

      <h4>지금 열린 방</h4>
      {res.live.length ? (
        <div className="vz-tablewrap"><table className="vz-table">
          <thead><tr><th>공개</th><th>제목</th><th>하는 사람</th><th>어디</th><th>보는 사람</th><th>연 지</th><th>코드</th></tr></thead>
          <tbody>{res.live.map((r) => (
            <tr key={r.code}>
              <td>{r.pub ? "공개" : "비공개"}</td>
              <td>{r.title || "—"}</td>
              <td>{host(r)}</td>
              <td>{where(r)}</td>
              <td>{r.viewers}/{r.max}{r.roster.length ? ` · ${r.roster.map((v) => v.name).join(", ")}` : ""}</td>
              <td>{mins(now - r.since)}</td>
              <td><a href={`https://terra-archive.net/w/${r.code}`} target="_blank" rel="noopener">{r.code}</a></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <p className="vz-note">지금 열린 방이 없습니다.</p>}

      <h4>날짜별 기록 <span className="vz-note">· 14일 보관</span></h4>
      <div className="admin-tools">
        {days.map((d) => <button key={d.day} type="button" className={pick === d.day ? "tab-btn selected" : "tab-btn"} onClick={() => setDay(d.day)}>{d.day.slice(5)} ({d.rooms.length})</button>)}
      </div>
      {rooms.length ? (
        <div className="vz-tablewrap"><table className="vz-table">
          <thead><tr><th>열림 ~ 닫힘</th><th>공개</th><th>제목</th><th>하는 사람</th><th>어디</th><th>최대</th><th>들어온 사람</th></tr></thead>
          <tbody>{rooms.map((r) => (
            <tr key={r.code}>
              <td>{hm(r.open)} ~ {r.ended ? hm(r.last) : "진행 중"} <span className="vz-note">({mins(r.last - r.open)})</span></td>
              <td>{r.pub ? "공개" : "비공개"}</td>
              <td>{r.title || "—"}</td>
              <td>{host(r)}</td>
              <td>{where(r)}</td>
              <td>{r.peak}</td>
              <td>{Object.entries(r.people).map(([n, p]) => `${n} (${hm(p.first)}~${p.last ? hm(p.last) : ""})`).join(", ") || "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <p className="vz-note">그날 기록이 없습니다.</p>}
    </div>
  );
}
