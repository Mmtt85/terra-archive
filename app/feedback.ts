// Supabase 피드백 전송 (익명 INSERT 전용 — RLS로 조회 차단, docs/supabase-setup.sql 참고)
// URL·anon 키는 플래너 지식 베이스 API(app/rules-api.ts)도 같이 쓴다
export const SUPABASE_URL = "https://exirlkhpkgxsflbglhld.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4aXJsa2hwa2d4c2ZsYmdsaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNTAwNDEsImV4cCI6MjA5ODgyNjA0MX0.IKwvqp0OyHOacl89JWIoRwzvJRDc2t0678qs3NPZ4fw";

export const feedbackReady = !SUPABASE_ANON_KEY.startsWith("PASTE");

export type FeedbackKind = "feature" | "data_error" | "plan";

export async function sendFeedback(kind: FeedbackKind, message: string, payload?: unknown) {
  if (!feedbackReady) throw new Error("Supabase 키가 아직 설정되지 않았습니다");
  // 어떤 화면에서 보낸 제안인지 payload에 자동 첨부 (예: "/#infra", "/#op-char_2014_nian")
  const page = typeof window === "undefined" ? null : `${window.location.pathname}${window.location.hash}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ kind, message: message.slice(0, 4000), payload: { ...(payload && typeof payload === "object" ? payload : {}), page } }),
  });
  if (!res.ok) throw new Error(`전송 실패 (${res.status})`);
}

// ─ 관리자 (/admin) — 인증은 Cloudflare Access(구글 SSO)가 담당한다 (2026-07-27).
// 브라우저는 관리자 키를 모른다: 모든 관리자 호출은 같은 오리진 /api(admin-api 프록시
// 워커)로 나가고, 워커가 Access JWT를 검증한 뒤 x-admin-key를 붙여 Supabase에 중계한다.
export const ADMIN_REST = "/api/supabase"; // + /<table>?<PostgREST query>
export type FeedbackRow = { id: string; created_at: string; kind: FeedbackKind; message: string; payload: unknown; reviewed_at: string | null };

/** 로그인 확인 — Access를 통과했으면 이메일, 아니면 null (localhost 등) */
export async function adminMe(): Promise<string | null> {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.email === "string" ? data.email : null;
  } catch {
    return null;
  }
}

export async function adminListFeedback(): Promise<FeedbackRow[]> {
  const res = await fetch(`${ADMIN_REST}/feedback?select=*&order=created_at.desc&limit=500`);
  if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
  return res.json();
}

export async function adminSetReviewed(id: string, reviewed: boolean) {
  const res = await fetch(`${ADMIN_REST}/feedback?id=eq.${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ reviewed_at: reviewed ? new Date().toISOString() : null }),
  });
  if (!res.ok) throw new Error(`갱신 실패 (${res.status})`);
}

// '대응중' 상태 — 스키마 변경 없이 payload.handling(ISO 문자열)로 저장한다.
// (신규 → 대응중 → 확인완료 3단계. 대응중은 "나중에 진위 검토할 과제"로 모아두는 용도)
export function handlingAt(payload: unknown): string | null {
  const value = payload && typeof payload === "object" ? (payload as { handling?: unknown }).handling : null;
  return typeof value === "string" && value ? value : null;
}

// 기존 payload를 보존한 채 handling 키만 갱신 (plan 제안의 shifts/score 등을 지우지 않도록 병합)
export function withHandling(payload: unknown, handling: boolean): Record<string, unknown> {
  const base = payload && typeof payload === "object" ? { ...(payload as Record<string, unknown>) } : {};
  if (handling) base.handling = new Date().toISOString();
  else delete base.handling;
  return base;
}

export async function adminSetHandling(id: string, payload: unknown, handling: boolean) {
  const res = await fetch(`${ADMIN_REST}/feedback?id=eq.${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ payload: withHandling(payload, handling) }),
  });
  if (!res.ok) throw new Error(`갱신 실패 (${res.status})`);
}

export async function adminDeleteFeedback(id: string) {
  const res = await fetch(`${ADMIN_REST}/feedback?id=eq.${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`삭제 실패 (${res.status})`);
}
