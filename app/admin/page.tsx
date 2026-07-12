"use client";

import { useEffect, useState } from "react";
import { adminDeleteFeedback, adminListFeedback, type FeedbackRow } from "../feedback";

const KIND_LABEL: Record<string, string> = { feature: "기능 제안", data_error: "데이터 오류", plan: "편성 제안" };

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [entered, setEntered] = useState(false);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState<string>("all");

  const load = async (pw: string) => {
    setStatus("불러오는 중…");
    try {
      const data = await adminListFeedback(pw);
      setRows(data);
      setStatus(data.length ? "" : "항목이 없습니다 — 비밀번호가 틀리면 목록이 비어 보입니다");
      setEntered(true);
      sessionStorage.setItem("ta-admin-key", pw);
    } catch {
      setStatus("조회 실패 — 잠시 후 다시 시도해주세요");
    }
  };

  useEffect(() => {
    const saved = sessionStorage.getItem("ta-admin-key");
    if (saved) { setPassword(saved); load(saved); }
  }, []);

  const remove = async (id: string) => {
    if (!window.confirm("이 항목을 삭제할까요?")) return;
    try {
      await adminDeleteFeedback(password, id);
      setRows((current) => current.filter((row) => row.id !== id));
    } catch {
      setStatus("삭제 실패");
    }
  };

  const shown = rows.filter((row) => filter === "all" || row.kind === filter);

  if (!entered) {
    return (
      <main className="admin-gate">
        <section>
          <h1>TERRA ARCHIVE // ADMIN</h1>
          <form onSubmit={(event) => { event.preventDefault(); load(password); }}>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비밀번호" autoFocus />
            <button type="submit">입장</button>
          </form>
          {status && <p>{status}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="admin">
      <header>
        <h1>피드백 관리 <small>{rows.length}건</small></h1>
        <div className="admin-tools">
          {["all", "feature", "data_error", "plan"].map((kind) => (
            <button key={kind} className={filter === kind ? "selected" : ""} onClick={() => setFilter(kind)}>
              {kind === "all" ? "전체" : KIND_LABEL[kind]} ({kind === "all" ? rows.length : rows.filter((row) => row.kind === kind).length})
            </button>
          ))}
          <button onClick={() => load(password)}>새로고침</button>
          <button onClick={() => { sessionStorage.removeItem("ta-admin-key"); setEntered(false); setRows([]); }}>잠금</button>
        </div>
      </header>
      {status && <p className="admin-status">{status}</p>}
      <div className="admin-list">
        {shown.map((row) => (
          <article key={row.id} className={`admin-row kind-${row.kind}`}>
            <header>
              <b>{KIND_LABEL[row.kind] ?? row.kind}</b>
              <time>{new Date(row.created_at).toLocaleString("ko-KR")}</time>
              <button onClick={() => remove(row.id)}>삭제</button>
            </header>
            {row.message && <p>{row.message}</p>}
            {row.payload != null && (
              <details>
                <summary>payload 보기</summary>
                <pre>{JSON.stringify(row.payload, null, 2)}</pre>
              </details>
            )}
          </article>
        ))}
        {shown.length === 0 && <p className="admin-status">표시할 항목이 없습니다.</p>}
      </div>
    </main>
  );
}
