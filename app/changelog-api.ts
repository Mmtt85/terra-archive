"use client";

// 업데이트 내역 API — 내용은 코드가 아니라 Supabase `changelog` 테이블에 있다
// (사용자 확정 2026-07-27: "매번 빌드해서 올리지 말고, 디비에 저장하면 자동으로 나오게").
// 스키마·RLS·시드: docs/supabase-changelog.sql

import { SUPABASE_URL, SUPABASE_ANON_KEY, adminWrite } from "./feedback";

// 종류 5종 (사용자 확정 2026-07-27: "버그픽스인지 수정인지" — 둘은 별개다).
// change = 버그가 아닌 일반 변경(이름 정리·문구 교체·배치 조정), fix = 실제 오작동 수정.
export type ChangeKind = "new" | "improve" | "change" | "fix" | "data";

/** 어느 기능의 이야기인가 — 배지를 '인프라 개선'처럼 읽히게 한다 (사용자 요청 2026-07-29) */
export type ChangeArea = "infra" | "archive" | "enemy" | "stage" | "recruit" | "farm" | "upgrade" | "story" | "rogue" | "site";

export type ChangeRow = {
  id: string;
  released_at: string;   // YYYY-MM-DD
  kind: ChangeKind;
  /** 없으면 href로 유추 (컬럼 추가 전 기존 행 대응 — areaOf 참조) */
  area?: ChangeArea | null;
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

/** 영역 표시명 (i18n 키). 배지에 들어가므로 탭 정식명이 아니라 짧은 쪽을 쓴다. */
export const CHANGE_AREA_LABEL: Record<ChangeArea, string> = {
  infra: "인프라", archive: "오퍼 백과사전", enemy: "적 도감", stage: "작전 도감", recruit: "공채", farm: "파밍",
  upgrade: "육성", story: "스토리", rogue: "통합전략", site: "사이트",
};

export const CHANGE_AREAS: ChangeArea[] = [
  "infra", "archive", "enemy", "stage", "recruit", "farm", "upgrade", "story", "rogue", "site",
];

/** 바로가기 경로 → 영역 (area가 비어 있는 옛 행의 폴백) */
const AREA_BY_PATH: [string, ChangeArea][] = [
  ["/infra", "infra"], ["/operators", "archive"], ["/enemies", "enemy"], ["/stages", "stage"], ["/recruit", "recruit"],
  ["/farm", "farm"], ["/upgrade", "upgrade"], ["/stories", "story"], ["/rogue", "rogue"],
];

/**
 * 행의 영역 — 명시값이 우선, 없으면 href로 유추하고, 그래도 모르면 '사이트'.
 * href가 없는 옛 행은 전부 '사이트'가 되므로 /admin에서 채워 주는 게 정확하다.
 */
export function areaOf(row: ChangeRow): ChangeArea {
  if (row.area) return row.area;
  const href = row.href ?? "";
  return AREA_BY_PATH.find(([p]) => href.startsWith(p))?.[1] ?? "site";
}

const anonHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

/** 기본 표시 기간 — 최근 1주일 (사용자 확정 2026-07-27) */
export const RECENT_DAYS = 7;

/** YYYY-MM-DD (KST 기준 오늘에서 n일 전) */
export function daysAgoKst(n: number): string {
  const kstNow = Date.now() + 9 * 3600_000;      // UTC+9로 옮겨 UTC 캘린더로 읽으면 KST 날짜
  return new Date(kstNow - n * 86400_000).toISOString().slice(0, 10);
}

// select=* 인 이유: `area` 컬럼 마이그레이션(docs/supabase-changelog.sql) 전에도 조회가
// 깨지지 않게 — 없는 컬럼을 명시하면 PostgREST가 400을 내고 모달 전체가 안 뜬다.
//
// 정렬 (사용자 확정 2026-07-29): 날짜 최신순 → 같은 날짜 안에서는 `seq`(작을수록 위) →
// **seq가 같으면 나중에 등록한 것이 위**. 마지막 기준이 없으면 /admin에서 seq를 안 건드리고
// 새 항목을 넣었을 때(기본값 0) 기존 0번들과 섞여 순서가 뒤죽박죽으로 보인다.
// 날짜 안 배치 규칙은 **무조건 나중에 한 작업이 위** — '신기능 먼저' 같은 종류별 재배치는
// 하지 않는다 (사용자 재확정 2026-08-09: 신설 항목들 아래에 나중 개선 2건을 붙였다가
// "왜 또 최신이 밑으로 내려가냐"는 지적을 받았다 — 2026-08-02에 이어 같은 지적 두 번째).
//
// ⚠ seq는 **작을수록 위 = 최신**이다. 스크립트로 여러 건을 한꺼번에 넣을 때 마지막 seq에서
//    1씩 올려 붙이면 **새 항목이 그 날짜의 맨 아래로 간다** — 2026-08-01에 실제로 그렇게
//    쌓아서 하루치 10건이 통째로 뒤집혔고 사용자가 지적해 뒤집어 고쳤다(2026-08-02).
//    같은 날짜에 항목을 추가할 때는 **그 날짜 전체를 등록 시각(created_at) 역순으로
//    seq 0..N 재부여**하는 게 확실하다 — 새 항목만 seq 0으로 넣어도 위로 오긴 하지만,
//    기존 행들끼리의 순서가 최신순이 아니면 그대로 남는다.
const SELECT = "select=*&order=released_at.desc,seq.asc,created_at.desc";

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

/** 이보다 짧으면 접지 않는다 — 한 줄로 끝나는 항목에 '상세보기'를 붙여봐야 클릭만 늘어난다 */
const HEAD_MAX = 90;
/** 접었을 때 감출 분량이 이보다 적으면 그냥 다 보여준다 */
const REST_MIN = 20;

/**
 * 항목을 '핵심 한 줄 + 상세'로 가른다 (사용자 요청 2026-07-29 — 목록이 너무 길어졌다).
 * 집필 관례상 `" — "` 앞이 핵심 한 줄이다 (실측: 등록된 28행 중 KO 85%·EN 82%가 이 형식이고,
 * 80자를 넘는 긴 항목은 3개 언어 모두 예외 없이 이 구분자를 갖고 있다).
 * 구분자가 없으면 첫 문장에서 자르고, 그마저 짧으면 통째로 둔다 — /admin에서 자유롭게
 * 쓰는 항목도 있으므로 폴백이 필요하다.
 */
export function splitChange(text: string): { head: string; rest: string } {
  const whole = { head: text, rest: "" };
  const dash = text.indexOf(" — ");
  if (dash > 0) {
    const rest = text.slice(dash + 3).trim();
    return rest.length >= REST_MIN ? { head: text.slice(0, dash), rest } : whole;
  }
  if (text.length <= HEAD_MAX) return whole;
  // 첫 문장 끝. 일본어 구두점(。！？)은 **뒤에 공백을 두지 않으므로** 공백을 요구하면 안 된다
  // (실측: JA 항목이 하나도 접히지 않았다). ASCII 마침표는 소수점·약어를 피하려 공백을 요구.
  const m = /[。！？]|[.!?](?=\s|$)/.exec(text);
  if (!m) return whole;
  const rest = text.slice(m.index + 1).trim();
  return rest.length >= REST_MIN ? { head: text.slice(0, m.index + 1), rest } : whole;
}

// ── 관리자 (/admin) — RLS가 x-admin-key 헤더를 검사한다 ──

export type ChangeDraft = Omit<ChangeRow, "id"> & { id?: string };

export async function adminUpsertChange(row: ChangeDraft) {
  const isNew = !row.id;
  const body = {
    released_at: row.released_at,
    kind: row.kind,
    area: row.area ?? null,
    ko: row.ko.trim(),
    en: row.en?.trim() || null,
    ja: row.ja?.trim() || null,
    href: row.href?.trim() || null,
    seq: row.seq,
  };
  await adminWrite(isNew ? "/changelog" : `/changelog?id=eq.${row.id}`, {
    method: isNew ? "POST" : "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, "저장");
}

export async function adminDeleteChange(id: string) {
  await adminWrite(`/changelog?id=eq.${id}`, { method: "DELETE" }, "삭제");
}
