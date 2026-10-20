"use client";

// 관리 — 친구 찾기 (사용자 지시 2026-10-20 "통계사이트에도 친구찾기 탭 만들어서 등록중인 리스트랑 이것저것").
// 계정 워커 D1 의 match(등록 중인 줄)·match_log(등록·취소·검색 기록, 누가 했는지는 없음)를 /api/prefs {match:true} 로 받는다.
// 신고 목록은 만들지 않는다 (사용자 결정 — 악질이면 커뮤니티에 올라온다)
import { useEffect, useMemo, useState } from "react";
import operatorsData from "../data/operators.json";

type Assist = { id: string; elite: number; level: number; potential: number; skill: number; skillIndex: number; mastery: number; equip: string | null; equipLevel: number };
type Row = { server: string; uid: string; nick: string; level: number; assist: Assist[]; friends: number | null; flimit: number | null; t: number; created: number };
type Day = { day: string; kind: "put" | "delete" | "search" | "expire"; server: string; n: number };
type Res = { ok: boolean; rows: Row[]; days: Day[]; ops: { op: string; server: string; n: number }[] };

const OP_NAME = new Map((operatorsData as { id: string; name: string }[]).map((o) => [o.id, o.name]));
const SERVER_LABEL: Record<string, string> = { kr: "한섭", jp: "일섭", en: "글섭", cn: "중섭 직영", bili: "중섭 B" };
const STALE = 14 * 86400_000;
const when = (ms: number) => new Date(ms).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export default function MatchPanel({ tick }: { tick: number }) {
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState("");
  const [server, setServer] = useState("all");
  useEffect(() => {
    fetch("/api/prefs", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ match: true }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => { if (j?.ok) { setRes(j); setErr(""); } else setErr(j?.error ?? "실패"); })
      .catch((e) => setErr(String(e)));
  }, [tick]);

  const [now] = useState(() => Date.now());
  const rows = useMemo(() => (res?.rows ?? []).filter((r) => server === "all" || r.server === server), [res, server]);
  const perServer = useMemo(() => {
    const m = new Map<string, { all: number; shown: number }>();
    for (const r of res?.rows ?? []) {
      const e = m.get(r.server) ?? { all: 0, shown: 0 };
      e.all++;
      if (now - r.t < STALE && (r.flimit == null || r.friends == null || r.friends < r.flimit)) e.shown++;
      m.set(r.server, e);
    }
    return [...m].sort((a, b) => b[1].all - a[1].all);
  }, [res, now]);
  // 하루별 등록·취소·검색 (최근 60일, 한국 날짜) — 서버 고르면 그 서버만
  const days = useMemo(() => {
    const m = new Map<string, { put: number; delete: number; search: number; expire: number }>();
    for (const d of res?.days ?? []) {
      if (server !== "all" && d.server !== server) continue;
      const e = m.get(d.day) ?? { put: 0, delete: 0, search: 0, expire: 0 };
      e[d.kind] += d.n;
      m.set(d.day, e);
    }
    return [...m].sort((a, b) => b[0].localeCompare(a[0]));
  }, [res, server]);
  const ops = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of res?.ops ?? []) if (server === "all" || o.server === server) m.set(o.op, (m.get(o.op) ?? 0) + o.n);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [res, server]);
  // 지원으로 많이 걸린 오퍼 — 등록한 사람들이 내건 지원 오퍼 순위 (찾는 쪽과 대 보기)
  const offered = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const a of r.assist) m.set(a.id, (m.get(a.id) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [rows]);

  if (err) return <p className="vz-note">친구 매칭 기록을 못 받았습니다 ({err}).</p>;
  if (!res) return <p className="vz-note">불러오는 중…</p>;
  const total = days.reduce((s, [, d]) => ({ put: s.put + d.put, delete: s.delete + d.delete, search: s.search + d.search, expire: s.expire + d.expire }), { put: 0, delete: 0, search: 0, expire: 0 });
  return (
    <div className="vz-match">
      <div className="admin-tools">
        {[["all", "전체"], ...perServer.map(([s]) => [s, SERVER_LABEL[s] ?? s])].map(([k, l]) => (
          <button key={k} type="button" className={server === k ? "tab-btn selected" : "tab-btn"} onClick={() => setServer(k)}>{l}</button>
        ))}
      </div>
      <div className="vz-kpis">
        <div><span>등록 중</span><b>{rows.length}</b></div>
        {perServer.map(([s, e]) => <div key={s}><span>{SERVER_LABEL[s] ?? s} (목록에 보임)</span><b>{e.all} ({e.shown})</b></div>)}
        <div><span>최근 60일 등록</span><b>{total.put}</b></div>
        <div><span>최근 60일 취소</span><b>{total.delete}</b></div>
        <div><span>최근 60일 자동 삭제 (90일 미동기화)</span><b>{total.expire}</b></div>
        <div><span>최근 60일 오퍼 검색</span><b>{total.search}</b></div>
      </div>

      <h4>날짜별 등록·취소·검색</h4>
      {days.length ? (
        <div className="vz-tablewrap"><table className="vz-table">
          <thead><tr><th>날짜</th><th>등록</th><th>취소</th><th>자동 삭제</th><th>검색</th></tr></thead>
          <tbody>{days.map(([d, e]) => <tr key={d}><td>{d}</td><td>{e.put}</td><td>{e.delete}</td><td>{e.expire}</td><td>{e.search}</td></tr>)}</tbody>
        </table></div>
      ) : <p className="vz-note">기록이 아직 없습니다.</p>}

      <div className="vz-match-two">
        <div>
          <h4>많이 찾은 오퍼</h4>
          {ops.length ? <ol className="ap-list">{ops.map(([id, n]) => <li key={id}>{OP_NAME.get(id) ?? id} <span className="vz-note">· {n}회</span></li>)}</ol> : <p className="vz-note">검색 기록이 없습니다.</p>}
        </div>
        <div>
          <h4>많이 내건 지원 오퍼</h4>
          {offered.length ? <ol className="ap-list">{offered.map(([id, n]) => <li key={id}>{OP_NAME.get(id) ?? id} <span className="vz-note">· {n}명</span></li>)}</ol> : <p className="vz-note">등록한 사람이 없습니다.</p>}
        </div>
      </div>

      <h4>등록 중인 목록</h4>
      {rows.length ? (
        <div className="vz-tablewrap"><table className="vz-table">
          <thead><tr><th>서버</th><th>UID</th><th>닉네임</th><th>레벨</th><th>지원 오퍼</th><th>친구</th><th>등록</th><th>마지막 동기화</th></tr></thead>
          <tbody>{rows.map((r) => {
            const hidden = now - r.t >= STALE ? "2주 넘음" : r.flimit != null && r.friends != null && r.friends >= r.flimit ? "친구 꽉 참" : "";
            return (
              <tr key={`${r.server}:${r.uid}`} className={hidden ? "vz-dim" : undefined} title={hidden ? `목록에서 숨김 — ${hidden}` : undefined}>
                <td>{SERVER_LABEL[r.server] ?? r.server}</td><td><code>{r.uid}</code></td><td>{r.nick}</td><td>{r.level}</td>
                <td>{r.assist.map((a) => `${OP_NAME.get(a.id) ?? a.id} 정${a.elite} ${a.level}${a.mastery ? ` 특${a.mastery}` : ""}${a.equip && a.equipLevel ? ` 모${a.equipLevel}` : ""}`).join(" · ")}</td>
                <td>{r.friends ?? "?"}/{r.flimit ?? "?"}</td><td>{when(r.created)}</td><td>{when(r.t)}{hidden && <span className="vz-note"> · {hidden}</span>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      ) : <p className="vz-note">등록 중인 사람이 없습니다.</p>}
    </div>
  );
}
