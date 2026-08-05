"use client";

// 개발자 코멘트 API — 받은 제안·피드백에 대한 개발자의 답변. 내용은 코드가 아니라
// Supabase `dev_notes` 테이블에 있다 (사용자 요청 2026-08-05: "제안 받은 피드백에 대한
// 피드백 — 뭐때문에 되고 뭐때문에 안되는지 관리자 페이지에서 입력").
// 업데이트 내역 모달(app/changelog.tsx) 안의 '개발자 코멘트' 뷰가 읽는다.
// 스키마·RLS: docs/supabase-devnotes.sql

import { SUPABASE_URL, SUPABASE_ANON_KEY, adminWrite } from "./feedback";

export type DevNoteStatus = "done" | "planned" | "considering" | "rejected";

export type DevNoteRow = {
  id: string;
  released_at: string;   // YYYY-MM-DD
  status: DevNoteStatus;
  suggestion_ko: string; suggestion_en: string | null; suggestion_ja: string | null;
  reply_ko: string; reply_en: string | null; reply_ja: string | null;
  image: string | null;
  active: boolean;
  seq: number;
};

/** 상태 표시명 (i18n 키 — app/i18n.tsx 사전에 EN/JA가 있다) */
export const DEVNOTE_STATUS_LABEL: Record<DevNoteStatus, string> = {
  done: "반영 완료", planned: "반영 예정", considering: "검토중", rejected: "반려",
};

export const DEVNOTE_STATUSES: DevNoteStatus[] = ["done", "planned", "considering", "rejected"];

const anonHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
// 정렬은 업데이트 내역과 같은 규칙 — 날짜 최신순 → seq 오름차순 → 같은 seq는 나중 등록이 위
const SELECT = "select=id,released_at,status,suggestion_ko,suggestion_en,suggestion_ja,reply_ko,reply_en,reply_ja,image,active,seq&order=released_at.desc,seq.asc,created_at.desc";

/** 사이트에 띄울 코멘트 (active만). 실패는 예외 — 모달이 안내 문구로 처리. */
export async function fetchDevNotes(): Promise<DevNoteRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dev_notes?${SELECT}&active=is.true&limit=200`, { headers: anonHeaders });
  if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
  return res.json();
}

/** 관리자 목록 — 비활성 포함 전체 */
export async function fetchAllDevNotes(): Promise<DevNoteRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dev_notes?${SELECT}&limit=500`, { headers: anonHeaders });
  if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
  return res.json();
}

/** 로케일별 제안·답변 — 번역이 비었으면 한국어로 폴백 */
export function noteSuggestion(row: DevNoteRow, locale: string): string {
  const v = locale === "en" ? row.suggestion_en : locale === "ja" ? row.suggestion_ja : row.suggestion_ko;
  return (v ?? "").trim() || row.suggestion_ko;
}
export function noteReply(row: DevNoteRow, locale: string): string {
  const v = locale === "en" ? row.reply_en : locale === "ja" ? row.reply_ja : row.reply_ko;
  return (v ?? "").trim() || row.reply_ko;
}

// ── 관리자 (/admin) ──

export type DevNoteDraft = Omit<DevNoteRow, "id"> & { id?: string };

export async function adminUpsertDevNote(row: DevNoteDraft) {
  const isNew = !row.id;
  const trim = (v: string | null | undefined) => (v ?? "").trim() || null;
  const body = {
    released_at: row.released_at,
    status: row.status,
    suggestion_ko: row.suggestion_ko.trim(),
    suggestion_en: trim(row.suggestion_en), suggestion_ja: trim(row.suggestion_ja),
    reply_ko: row.reply_ko.trim(),
    reply_en: trim(row.reply_en), reply_ja: trim(row.reply_ja),
    image: trim(row.image),
    active: row.active, seq: row.seq,
  };
  await adminWrite(isNew ? "/dev_notes" : `/dev_notes?id=eq.${row.id}`, {
    method: isNew ? "POST" : "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, "저장");
}

export async function adminDeleteDevNote(id: string) {
  await adminWrite(`/dev_notes?id=eq.${id}`, { method: "DELETE" }, "삭제");
}
