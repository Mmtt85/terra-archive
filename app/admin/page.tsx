"use client";

import { useEffect, useState } from "react";
import { adminDeleteFeedback, adminDeleteNickname, adminListFeedback, adminSetHandling, adminSetReviewed, handlingAt, withHandling, fetchNicknameCounts, type FeedbackRow, type NicknameCount } from "../feedback";
import operatorsData from "../data/operators.json";
import recruitData from "../data/recruit.json";
import farmData from "../data/farm.json";

// 크론 워커가 매일 클뜯 레포에서 뽑아둔 최신 오퍼 목록·공채 풀 요약.
// 여기(브라우저)서 사이트에 번들된 데이터와 비교해 "갱신 필요" 여부를 판단한다.
const DATACHECK_API = "https://terra-archive-broadcast.nzkonaru.workers.dev/datacheck";
type DataCheck = {
  updated: string;
  operators: { id: string; name: string; rarity: number; obtainable: boolean }[];
  recruit: { name: string; rarity: number }[];
  // 펭귄 물류 기준 "지금 KR에 열려 있는 파밍 스테이지·재료" 세트 (워커 불통 시 null)
  farm?: { stages: string[]; items: string[] } | null;
};

const KIND_LABEL: Record<string, string> = { feature: "기능 제안", data_error: "데이터 오류", plan: "편성 제안" };
const OP_NAME = new Map((operatorsData as { id: string; name: string }[]).map((op) => [op.id, op.name]));

// payload.page("/#infra" 등)를 사람이 읽을 라벨로 — 클릭하면 그 페이지가 새 탭에 열린다
function pageOf(payload: unknown): string | undefined {
  const page = payload && typeof payload === "object" ? (payload as { page?: unknown }).page : undefined;
  return typeof page === "string" && page ? page : undefined;
}
function pageLabel(page: string): string {
  if (page.includes("#infra")) return "인프라 플래너";
  if (page.includes("#recruit")) return "공채 도우미";
  const op = page.match(/#op-(char_[A-Za-z0-9_]+)/);
  if (op) return `오퍼 상세 · ${OP_NAME.get(op[1]) ?? op[1]}`;
  return "오퍼 백과사전";
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [entered, setEntered] = useState(false);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all"); // all | open | handling | reviewed
  const [nicknames, setNicknames] = useState<NicknameCount[]>([]);
  const [dataCheck, setDataCheck] = useState<DataCheck | null>(null);

  useEffect(() => {
    if (!entered) return;
    fetch(DATACHECK_API)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (Array.isArray(data?.operators)) setDataCheck(data); })
      .catch(() => { /* 워커 불통 시 섹션이 '확인 중'으로 남음 */ });
  }, [entered]);

  const load = async (pw: string) => {
    setStatus("불러오는 중…");
    try {
      const data = await adminListFeedback(pw);
      setRows(data);
      setStatus(data.length ? "" : "항목이 없습니다 — 비밀번호가 틀리면 목록이 비어 보입니다");
      setEntered(true);
      sessionStorage.setItem("ta-admin-key", pw);
      fetchNicknameCounts().then(setNicknames).catch(() => { /* 별명 테이블 미설치 시 무시 */ });
    } catch {
      setStatus("조회 실패 — 잠시 후 다시 시도해주세요");
    }
  };

  const removeNickname = async (item: NicknameCount) => {
    if (!window.confirm(`'${OP_NAME.get(item.op_id) ?? item.op_id}'의 별명 '${item.name}' (${item.votes}표)을 전부 삭제할까요?`)) return;
    try {
      await adminDeleteNickname(password, item.op_id, item.name);
      setNicknames((current) => current.filter((row) => !(row.op_id === item.op_id && row.name === item.name)));
    } catch {
      setStatus("별명 삭제 실패");
    }
  };

  useEffect(() => {
    const saved = sessionStorage.getItem("ta-admin-key");
    if (saved) { setPassword(saved); load(saved); }
  }, []);

  const toggleReviewed = async (row: FeedbackRow) => {
    const next = !row.reviewed_at;
    try {
      await adminSetReviewed(password, row.id, next);
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, reviewed_at: next ? new Date().toISOString() : null } : item));
    } catch {
      setStatus("갱신 실패");
    }
  };

  const toggleHandling = async (row: FeedbackRow) => {
    const next = !handlingAt(row.payload);
    try {
      await adminSetHandling(password, row.id, row.payload, next);
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, payload: withHandling(item.payload, next) } : item));
    } catch {
      setStatus("갱신 실패");
    }
  };

  // "한꺼번에 대응중" — 지금 보이는 목록 중 아직 대응중이 아닌 항목을 일괄 표시
  const markShownHandling = async () => {
    const targets = shown.filter((row) => !handlingAt(row.payload));
    if (!targets.length) { setStatus("이미 모두 대응중입니다"); return; }
    if (!window.confirm(`표시된 ${targets.length}건을 대응중으로 표시할까요?`)) return;
    setStatus(`대응중 표시 중… (0/${targets.length})`);
    let done = 0;
    for (const row of targets) {
      try {
        await adminSetHandling(password, row.id, row.payload, true);
        setRows((current) => current.map((item) => item.id === row.id ? { ...item, payload: withHandling(item.payload, true) } : item));
      } catch { /* 개별 실패는 건너뛴다 */ }
      setStatus(`대응중 표시 중… (${++done}/${targets.length})`);
    }
    setStatus(`${done}건 대응중 표시 완료`);
  };

  const remove = async (id: string) => {
    if (!window.confirm("이 항목을 삭제할까요?")) return;
    try {
      await adminDeleteFeedback(password, id);
      setRows((current) => current.filter((row) => row.id !== id));
    } catch {
      setStatus("삭제 실패");
    }
  };

  // 상태: 확인완료 > 대응중 > 신규. 확인완료를 아래로, 그 위에 대응중, 맨 위 신규 — 같은 그룹은 최신순
  const statusRank = (row: FeedbackRow) => (row.reviewed_at ? 2 : handlingAt(row.payload) ? 1 : 0);
  const matchStatus = (row: FeedbackRow) =>
    statusFilter === "all" ? true
    : statusFilter === "reviewed" ? Boolean(row.reviewed_at)
    : statusFilter === "handling" ? Boolean(handlingAt(row.payload)) && !row.reviewed_at
    : /* open */ !row.reviewed_at && !handlingAt(row.payload);
  const shown = rows
    .filter((row) => (filter === "all" || row.kind === filter) && matchStatus(row))
    .sort((a, b) => statusRank(a) - statusRank(b) || Date.parse(b.created_at) - Date.parse(a.created_at));
  const handlingCount = rows.filter((row) => handlingAt(row.payload) && !row.reviewed_at).length;

  // 게임 데이터 비교 — 획득 불가(가짜 게스트·컬래버 잔재 등)는 사이트가 의도적으로
  // 제외한 것이므로 obtainable=true만 신규로 판정한다
  const localOpIds = new Set((operatorsData as { id: string }[]).map((op) => op.id));
  const localRecruitNames = new Set((recruitData as { ops: { name: string }[] }).ops.map((op) => op.name));
  const newOps = (dataCheck?.operators ?? []).filter((op) => op.obtainable && !localOpIds.has(op.id)).sort((a, b) => b.rarity - a.rarity);
  const newRecruit = (dataCheck?.recruit ?? []).filter((r) => !localRecruitNames.has(r.name)).sort((a, b) => b.rarity - a.rarity);
  const remoteRecruitNames = new Set((dataCheck?.recruit ?? []).map((r) => r.name));
  const staleRecruit = dataCheck ? (recruitData as { ops: { name: string }[] }).ops.filter((op) => !remoteRecruitNames.has(op.name)).map((op) => op.name) : [];
  // 재료 파밍표: farm.json에 박힌 빌드 시점 세트 vs 워커의 현재 세트 —
  // 이벤트 개폐(스테이지 증감)나 신규 재료가 생기면 재생성 신호
  const farmLocal = farmData as { updated: string; openStages?: string[]; items: { id: string }[] };
  const localFarmStages = new Set(farmLocal.openStages ?? []);
  const localFarmItems = new Set(farmLocal.items.map((item) => item.id));
  const remoteFarm = dataCheck?.farm ?? null;
  const farmOpened = remoteFarm ? remoteFarm.stages.filter((sid) => !localFarmStages.has(sid)) : [];
  const farmClosed = remoteFarm ? [...localFarmStages].filter((sid) => !remoteFarm.stages.includes(sid)) : [];
  const farmNewItems = remoteFarm ? remoteFarm.items.filter((iid) => !localFarmItems.has(iid)) : [];
  const farmNeeds = farmOpened.length > 0 || farmClosed.length > 0 || farmNewItems.length > 0;
  const needsUpdate = newOps.length > 0 || newRecruit.length > 0 || farmNeeds;

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
        <div className="admin-tools admin-status-tools">
          {([["all", "전체 상태"], ["open", "신규"], ["handling", "대응중"], ["reviewed", "대응완료"]] as const).map(([key, label]) => (
            <button key={key} className={statusFilter === key ? "selected" : ""} onClick={() => setStatusFilter(key)}>
              {label}{key === "handling" && handlingCount ? ` (${handlingCount})` : ""}
            </button>
          ))}
          <button className="bulk-handling-btn" onClick={markShownHandling} title="지금 보이는 목록을 한꺼번에 대응중으로 표시">🔧 표시된 항목 일괄 대응중</button>
        </div>
      </header>
      {status && <p className="admin-status">{status}</p>}

      <section className={`data-status ${dataCheck ? (needsUpdate ? "warn" : "ok") : ""}`}>
        {!dataCheck ? (
          <p>게임 데이터 확인 중… (크론 워커 응답 대기)</p>
        ) : (
          <>
            <header>
              <b>{needsUpdate ? "⚠ 게임 데이터 갱신 필요" : "✓ 게임 데이터 최신 상태"}</b>
              <time>클뜯 레포 기준 · {new Date(dataCheck.updated).toLocaleString("ko-KR")} 확인</time>
            </header>
            {newOps.length > 0 && (
              <p>
                <b>신규 오퍼 {newOps.length}명</b> — {newOps.map((op) => `${"★".repeat(op.rarity)} ${op.name}`).join(" · ")}
                <br /><i>Claude에서 <code>/operator-data-update</code> 실행</i>
              </p>
            )}
            {newRecruit.length > 0 && (
              <p>
                <b>공채 풀 추가 {newRecruit.length}명</b> — {newRecruit.map((r) => `${"★".repeat(r.rarity)} ${r.name}`).join(" · ")}
                <br /><i>Claude에서 <code>/recruit-data-update</code> 실행</i>
              </p>
            )}
            {farmNeeds && (
              <p>
                <b>재료 파밍표 갱신 필요</b>
                {farmOpened.length > 0 && <> — 새로 열린 파밍 스테이지 {farmOpened.length}개 ({farmOpened.slice(0, 8).join(" · ")}{farmOpened.length > 8 ? " …" : ""})</>}
                {farmClosed.length > 0 && <> — 닫힌 스테이지 {farmClosed.length}개 ({farmClosed.slice(0, 8).join(" · ")}{farmClosed.length > 8 ? " …" : ""})</>}
                {farmNewItems.length > 0 && <> — 신규 재료 {farmNewItems.length}종 ({farmNewItems.join(" · ")})</>}
                <br /><i>Claude에서 <code>/farm-data-update</code> 실행 (farm.json 기준일 {farmLocal.updated})</i>
              </p>
            )}
            {staleRecruit.length > 0 && (
              <p className="data-status-minor">참고 · 사이트 공채 풀에만 있는 오퍼 (데이터마인 미반영이면 정상): {staleRecruit.join(" · ")}</p>
            )}
            {remoteFarm == null && (
              <p className="data-status-minor">참고 · 파밍표 신선도는 다음 크론 수집(매일 11:41 KST) 후 표시됩니다.</p>
            )}
          </>
        )}
      </section>

      <div className="admin-list">
        {shown.map((row) => (
          <article key={row.id} className={`admin-row kind-${row.kind}${row.reviewed_at ? " reviewed" : ""}${handlingAt(row.payload) && !row.reviewed_at ? " handling" : ""}`}>
            <header>
              <code className="fb-id" title={`${row.id} — 클릭하면 전체 ID 복사`}
                onClick={() => { navigator.clipboard?.writeText(row.id).then(() => setStatus(`ID 복사됨: ${row.id}`)).catch(() => {}); }}>
                #{row.id.slice(0, 8)}
              </code>
              <b>{KIND_LABEL[row.kind] ?? row.kind}</b>
              {pageOf(row.payload) && (
                <a className="page-chip" href={pageOf(row.payload)} target="_blank" rel="noreferrer" title={`보낸 페이지 열기: ${pageOf(row.payload)}`}>
                  📍 {pageLabel(pageOf(row.payload)!)}
                </a>
              )}
              {handlingAt(row.payload) && !row.reviewed_at && <i className="handling-badge" title={new Date(handlingAt(row.payload)!).toLocaleString("ko-KR")}>🔧 대응중</i>}
              {row.reviewed_at && <i className="reviewed-badge" title={new Date(row.reviewed_at).toLocaleString("ko-KR")}>✓ 확인됨</i>}
              <time>{new Date(row.created_at).toLocaleString("ko-KR")}</time>
              <button className="handling-btn" onClick={() => toggleHandling(row)}>{handlingAt(row.payload) ? "대응 해제" : "대응중"}</button>
              <button className="review-btn" onClick={() => toggleReviewed(row)}>{row.reviewed_at ? "대응 취소" : "대응완료"}</button>
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

      <header className="admin-section-head">
        <h1>별명 제보 <small>{nicknames.length}종</small></h1>
      </header>
      <div className="admin-nicknames">
        {nicknames.map((item) => (
          <span key={`${item.op_id}-${item.name}`} className="admin-nick">
            <b>{OP_NAME.get(item.op_id) ?? item.op_id}</b>
            {item.name}
            <i>{item.votes}표</i>
            <button onClick={() => removeNickname(item)} title="이 별명의 제보를 전부 삭제">×</button>
          </span>
        ))}
        {nicknames.length === 0 && <p className="admin-status">제보된 별명이 없습니다.</p>}
      </div>
    </main>
  );
}
