// Supabase 피드백 전송 (익명 INSERT 전용 — RLS로 조회 차단, docs/supabase-setup.sql 참고)
const SUPABASE_URL = "https://exirlkhpkgxsflbglhld.supabase.co";
const SUPABASE_ANON_KEY = "PASTE_ANON_KEY_HERE";

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
