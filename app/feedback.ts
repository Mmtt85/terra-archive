// Supabase 피드백 전송 (익명 INSERT 전용 — RLS로 조회 차단, docs/supabase-setup.sql 참고)
const SUPABASE_URL = "https://exirlkhpkgxsflbglhld.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4aXJsa2hwa2d4c2ZsYmdsaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNTAwNDEsImV4cCI6MjA5ODgyNjA0MX0.IKwvqp0OyHOacl89JWIoRwzvJRDc2t0678qs3NPZ4fw";

export const feedbackReady = !SUPABASE_ANON_KEY.startsWith("PASTE");

export type FeedbackKind = "feature" | "data_error" | "plan";

export async function sendFeedback(kind: FeedbackKind, message: string, payload?: unknown) {
  if (!feedbackReady) throw new Error("Supabase 키가 아직 설정되지 않았습니다");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ kind, message: message.slice(0, 4000), payload: payload ?? null }),
  });
  if (!res.ok) throw new Error(`전송 실패 (${res.status})`);
}

// ─ 오퍼레이터 별명 제보 (docs/supabase-nicknames.sql) ─
// 제보 1건 = 1행, 공개 조회는 (오퍼, 별명)별 득표 집계 뷰로만.

export type NicknameCount = { op_id: string; name: string; votes: number };

export async function fetchNicknameCounts(): Promise<NicknameCount[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/op_nickname_counts?select=*&order=votes.desc&limit=10000`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`별명 조회 실패 (${res.status})`);
  return res.json();
}

export async function submitNickname(opId: string, name: string) {
  if (!feedbackReady) throw new Error("Supabase 키가 아직 설정되지 않았습니다");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/op_nickname`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ op_id: opId, name: name.slice(0, 16) }),
  });
  if (!res.ok) throw new Error(`전송 실패 (${res.status})`);
}

// 관리자: 특정 (오퍼, 별명)의 제보 행 전체 삭제 — 집계에서 사라진다
export async function adminDeleteNickname(password: string, opId: string, name: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/op_nickname?op_id=eq.${encodeURIComponent(opId)}&name=eq.${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: adminHeaders(password),
  });
  if (!res.ok) throw new Error(`삭제 실패 (${res.status})`);
}

// ─ 관리자 (/admin) — RLS 정책이 x-admin-key 헤더를 검사한다 (docs/supabase-admin.sql) ─
export type FeedbackRow = { id: string; created_at: string; kind: FeedbackKind; message: string; payload: unknown; reviewed_at: string | null };

function adminHeaders(password: string) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "x-admin-key": password,
  };
}

export async function adminListFeedback(password: string): Promise<FeedbackRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback?select=*&order=created_at.desc&limit=500`, {
    headers: adminHeaders(password),
  });
  if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
  return res.json();
}

export async function adminSetReviewed(password: string, id: string, reviewed: boolean) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...adminHeaders(password), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ reviewed_at: reviewed ? new Date().toISOString() : null }),
  });
  if (!res.ok) throw new Error(`갱신 실패 (${res.status})`);
}

export async function adminDeleteFeedback(password: string, id: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback?id=eq.${id}`, {
    method: "DELETE",
    headers: adminHeaders(password),
  });
  if (!res.ok) throw new Error(`삭제 실패 (${res.status})`);
}
