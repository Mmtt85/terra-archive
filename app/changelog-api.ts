"use client";

// 업데이트 내역 API — 내용은 코드가 아니라 Supabase `changelog` 테이블에 있다
// (사용자 확정 2026-07-27: "매번 빌드해서 올리지 말고, 디비에 저장하면 자동으로 나오게").
// 스키마·RLS·시드: docs/supabase-changelog.sql

import { SUPABASE_URL, SUPABASE_ANON_KEY, adminHeaders } from "./feedback";

// 종류 5종 (사용자 확정 2026-07-27: "버그픽스인지 수정인지" — 둘은 별개다).
// change = 버그가 아닌 일반 변경(이름 정리·문구 교체·배치 조정), fix = 실제 오작동 수정.
export type ChangeKind = "new" | "improve" | "change" | "fix" | "data";

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
  new: "신기능", improve: "개선", change: "수정", fix: "버그 수정", data: "데이터 갱신",
};

export const CHANGE_KINDS: ChangeKind[] = ["new", "improve", "change", "fix", "data"];

const anonHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

/** 기본 표시 기간 — 최근 1주일 (사용자 확정 2026-07-27) */
export const RECENT_DAYS = 7;

/** YYYY-MM-DD (KST 기준 오늘에서 n일 전) */
export function daysAgoKst(n: number): string {
  const kstNow = Date.now() + 9 * 3600_000;      // UTC+9로 옮겨 UTC 캘린더로 읽으면 KST 날짜
  return new Date(kstNow - n * 86400_000).toISOString().slice(0, 10);
}

const SELECT = "select=id,released_at,kind,ko,en,ja,href,seq&order=released_at.desc,seq.asc";

/**
 * 날짜 구간 조회 — [from, to) (둘 다 YYYY-MM-DD, to를 비우면 상한 없음 = 오늘까지).
 * 실패(테이블 미설치·네트워크)는 예외를 던진다 — 모달이 안내 문구로 처리.
 */
export async function fetchChangelogRange(from: string, to?: string | null): Promise<ChangeRow[]> {
  const upper = to ? `&released_at=lt.${to}` : "";
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/changelog?${SELECT}&released_at=gte.${from}${upper}&limit=200`,
    { headers: anonHeaders },
  );
  if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
  return res.json();
}

/** 전체에서 가장 오래된 항목의 날짜 — "더 볼 게 남았나" 판정용 (없으면 null) */
export async function fetchOldestReleaseDate(): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/changelog?select=released_at&order=released_at.asc&limit=1`,
    { headers: anonHeaders },
  );
  if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
  const rows = (await res.json()) as { released_at: string }[];
  return rows[0]?.released_at ?? null;
}

/** 관리자 목록 — 기간 제한 없이 최신순 전체 (사이트 모달은 7일 창 단위로 나눠 읽는다) */
export async function fetchAllChanges(): Promise<ChangeRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/changelog?${SELECT}&limit=500`, { headers: anonHeaders });
  if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
  return res.json();
}

/** i번째 7일 창의 [from, to) — 0번은 상한 없음(오늘 항목 포함) */
export function windowRange(i: number): { from: string; to: string | null } {
  return { from: daysAgoKst(RECENT_DAYS * (i + 1)), to: i === 0 ? null : daysAgoKst(RECENT_DAYS * i) };
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
