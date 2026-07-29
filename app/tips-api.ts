"use client";

// 팁 풍선 API — 내용은 코드가 아니라 Supabase `tips` 테이블에 있다
// (사용자 확정 2026-07-27: 업데이트 내역과 같은 방식으로 /admin에서 넣으면 배포 없이 반영).
// 스키마·RLS·시드: docs/supabase-tips.sql

import { SUPABASE_URL, SUPABASE_ANON_KEY, adminWrite } from "./feedback";

export type TipRow = {
  id: string;
  title_ko: string; title_en: string | null; title_ja: string | null;
  body_ko: string; body_en: string | null; body_ja: string | null;
  image: string | null;
  image_dark: string | null;
  href: string | null;
  active: boolean;
  seq: number;
};

const anonHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const SELECT = "select=id,title_ko,title_en,title_ja,body_ko,body_en,body_ja,image,image_dark,href,active,seq&order=seq.asc";

/** 사이트에 띄울 팁 (active만). 실패는 예외 — 풍선은 조용히 표시하지 않는다. */
export async function fetchTips(): Promise<TipRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tips?${SELECT}&active=is.true&limit=100`, { headers: anonHeaders });
  if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
  return res.json();
}

/** 관리자 목록 — 비활성 포함 전체 */
export async function fetchAllTips(): Promise<TipRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tips?${SELECT}&limit=200`, { headers: anonHeaders });
  if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
  return res.json();
}

/** 로케일별 제목·본문 — 번역이 비었으면 한국어로 폴백 */
export function tipTitle(tip: TipRow, locale: string): string {
  const v = locale === "en" ? tip.title_en : locale === "ja" ? tip.title_ja : tip.title_ko;
  return (v ?? "").trim() || tip.title_ko;
}
export function tipBody(tip: TipRow, locale: string): string {
  const v = locale === "en" ? tip.body_en : locale === "ja" ? tip.body_ja : tip.body_ko;
  return (v ?? "").trim() || tip.body_ko;
}
/** 다크 모드 이미지 — 따로 없으면 기본 이미지 */
export function tipImage(tip: TipRow, dark: boolean): string | null {
  return (dark ? tip.image_dark || tip.image : tip.image) || null;
}

// ── 관리자 (/admin) ──

export type TipDraft = Omit<TipRow, "id"> & { id?: string };

export async function adminUpsertTip(row: TipDraft) {
  const isNew = !row.id;
  const trim = (v: string | null | undefined) => (v ?? "").trim() || null;
  const body = {
    title_ko: row.title_ko.trim(), title_en: trim(row.title_en), title_ja: trim(row.title_ja),
    body_ko: row.body_ko.trim(), body_en: trim(row.body_en), body_ja: trim(row.body_ja),
    image: trim(row.image), image_dark: trim(row.image_dark), href: trim(row.href),
    active: row.active, seq: row.seq,
  };
  await adminWrite(isNew ? "/tips" : `/tips?id=eq.${row.id}`, {
    method: isNew ? "POST" : "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, "저장");
}

export async function adminDeleteTip(id: string) {
  await adminWrite(`/tips?id=eq.${id}`, { method: "DELETE" }, "삭제");
}
