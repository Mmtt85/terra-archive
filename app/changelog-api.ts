"use client";

// 업데이트 내역 API — 내용은 코드가 아니라 Supabase `changelog` 테이블에 있다
// (사용자 확정 2026-07-27: "매번 빌드해서 올리지 말고, 디비에 저장하면 자동으로 나오게").
// 스키마·RLS·시드: docs/supabase-changelog.sql

import { SUPABASE_URL, SUPABASE_ANON_KEY, adminHeaders } from "./feedback";

export type ChangeKind = "new" | "improve" | "fix" | "data";

export type ChangeRow = {
  id: string;
  released_at: string;   // YYYY-MM-DD
  kind: ChangeKind;
  ko: string;
  en: string | null;
  ja: string | null;
  href: string | null;
  seq: number;
};

/** 종류 표시명 (i18n 키 — app/i18n.tsx 사전에 EN/JA가 있다) */
export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  new: "신기능", improve: "개선", fix: "버그 수정", data: "데이터 갱신",
};

export const CHANGE_KINDS: ChangeKind[] = ["new", "improve", "fix", "data"];

const anonHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

/** 기본 표시 기간 — 최근 1주일 (사용자 확정 2026-07-27) */
export const RECENT_DAYS = 7;

/** YYYY-MM-DD (KST 기준 오늘에서 n일 전) */
export function daysAgoKst(n: number): string {
  const kstNow = Date.now() + 9 * 3600_000;      // UTC+9로 옮겨 UTC 캘린더로 읽으면 KST 날짜
  return new Date(kstNow - n * 86400_000).toISOString().slice(0, 10);
}

/**
 * 목록 조회. all=false면 최근 RECENT_DAYS일치만, true면 전체.
 * 실패(테이블 미설치·네트워크)는 예외를 던진다 — 모달이 안내 문구로 처리.
 */
export async function fetchChangelog(all: boolean): Promise<ChangeRow[]> {
  const range = all ? "" : `&released_at=gte.${daysAgoKst(RECENT_DAYS)}`;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/changelog?select=id,released_at,kind,ko,en,ja,href,seq&order=released_at.desc,seq.asc${range}&limit=${all ? 500 : 100}`,
    { headers: anonHeaders },
  );
  if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
  return res.json();
}

/** 로케일별 본문 — 번역이 비었으면 한국어로 폴백 */
export function changeText(row: ChangeRow, locale: string): string {
  const text = locale === "en" ? row.en : locale === "ja" ? row.ja : row.ko;
  return (text ?? "").trim() || row.ko;
}

// ── 관리자 (/admin) — RLS가 x-admin-key 헤더를 검사한다 ──

export type ChangeDraft = Omit<ChangeRow, "id"> & { id?: string };

export async function adminUpsertChange(password: string, row: ChangeDraft) {
  const isNew = !row.id;
  const body = {
    released_at: row.released_at,
    kind: row.kind,
    ko: row.ko.trim(),
    en: row.en?.trim() || null,
    ja: row.ja?.trim() || null,
    href: row.href?.trim() || null,
    seq: row.seq,
  };
  const res = await fetch(
    isNew ? `${SUPABASE_URL}/rest/v1/changelog` : `${SUPABASE_URL}/rest/v1/changelog?id=eq.${row.id}`,
    {
      method: isNew ? "POST" : "PATCH",
      headers: { ...adminHeaders(password), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`저장 실패 (${res.status}) — 테이블·비밀번호를 확인하세요`);
}

export async function adminDeleteChange(password: string, id: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/changelog?id=eq.${id}`, {
    method: "DELETE",
    headers: adminHeaders(password),
  });
  if (!res.ok) throw new Error(`삭제 실패 (${res.status})`);
}
