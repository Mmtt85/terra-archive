"use client";

// 관리 화면 — 제안 카드(읽기 전용). '이 사람의 다른 제안' 창(page.tsx)과 방문 통계의 '저장된 설정' 창(prefs.tsx)이 같이 쓴다 (2026-10-15).
// 답변 달기·대응 표시 같은 손대는 일은 피드백 탭 본문에서만 한다
import { filesOf, fmtFileSize, handlingAt, imagesOf, type FeedbackRow } from "../feedback";

export const FB_KIND_LABEL: Record<string, string> = { feature: "기능 제안", data_error: "데이터 오류", plan: "편성 제안" };
const pageOf = (payload: unknown): string | undefined => {
  const page = payload && typeof payload === "object" ? (payload as { page?: unknown }).page : undefined;
  return typeof page === "string" && page ? page : undefined;
};

export function FbReadCard({ row }: { row: FeedbackRow }) {
  const page = pageOf(row.payload);
  return (
    <article className={`admin-row kind-${row.kind}${row.reviewed_at ? " reviewed" : ""}`}>
      <header>
        <code className="fb-id">#{row.id.slice(0, 8)}</code>
        <b>{FB_KIND_LABEL[row.kind] ?? row.kind}</b>
        {page && <a className="page-chip" href={page} target="_blank" rel="noreferrer">📍 {page}</a>}
        {handlingAt(row.payload) && !row.reviewed_at && <i className="handling-badge">🔧 대응중</i>}
        {row.reviewed_at && <i className="reviewed-badge">✓ 확인됨</i>}
        <time>{new Date(row.created_at).toLocaleString("ko-KR")}</time>
      </header>
      {row.message && <p>{row.message}</p>}
      {imagesOf(row.payload).length > 0 && (
        <div className="fb-images">{imagesOf(row.payload).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" loading="lazy" /></a>)}</div>
      )}
      {filesOf(row.payload).length > 0 && (
        <div className="fb-files">{filesOf(row.payload).map((f) => (
          <a key={f.url} href={f.url} download={f.name} rel="noreferrer" className="fb-filechip"><span className="fb-filechip-name">📄 {f.name}</span><small>{fmtFileSize(f.size)}</small></a>
        ))}</div>
      )}
      {(row.feedback_replies ?? []).length > 0 && (
        <div className="fb-admin-replies">
          {(row.feedback_replies ?? []).map((rep) => <div key={rep.id} className="fb-admin-reply"><span className="fb-admin-reply-body">{rep.body}</span></div>)}
        </div>
      )}
    </article>
  );
}
