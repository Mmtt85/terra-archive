// Supabase 피드백 전송 (익명 INSERT 전용 — RLS로 조회 차단, docs/supabase-setup.sql 참고)
// URL·anon 키는 플래너 지식 베이스 API(app/rules-api.ts)도 같이 쓴다
export const SUPABASE_URL = "https://exirlkhpkgxsflbglhld.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4aXJsa2hwa2d4c2ZsYmdsaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNTAwNDEsImV4cCI6MjA5ODgyNjA0MX0.IKwvqp0OyHOacl89JWIoRwzvJRDc2t0678qs3NPZ4fw";

export const feedbackReady = !SUPABASE_ANON_KEY.startsWith("PASTE");

export type FeedbackKind = "feature" | "data_error" | "plan";

// ── 제안 첨부 이미지 (사용자 요청 2026-08-05: 최대 3장, 바로 R2로) ──
// 업로드 워커(workers/upload)의 익명 공개 엔드포인트 — 키는 서버가 만든다(feedback/…).
// URL은 payload.images 배열로 제안과 함께 저장돼 /admin에서 보인다.
const FB_UPLOAD = "https://terra-archive-upload.nzkonaru.workers.dev/fb";
export const FEEDBACK_IMG_MAX = 3;
export const FEEDBACK_IMG_MB = 8;

export async function uploadFeedbackImage(file: File): Promise<string> {
  if (file.size > FEEDBACK_IMG_MB * 1024 * 1024) throw new Error(`이미지가 너무 큽니다 (${FEEDBACK_IMG_MB}MB 이하)`);
  const res = await fetch(FB_UPLOAD, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error(`이미지 업로드 실패 (${res.status})`);
  const data = (await res.json()) as { url: string };
  return data.url;
}

/** payload.images — 제안에 첨부된 이미지 URL 목록 (없으면 빈 배열) */
export function imagesOf(payload: unknown): string[] {
  const value = payload && typeof payload === "object" ? (payload as { images?: unknown }).images : null;
  return Array.isArray(value) ? value.filter((u): u is string => typeof u === "string" && !!u) : [];
}

// ── 제안 게시판 — 로그인 없는 작성자 식별 (사용자 확정 2026-08-17) ──
// 첫 제안 때 uuid 토큰을 만들어 localStorage에 두고, 이후 그 토큰이 '내 제안'의 열람
// 자격이 된다: RLS가 요청 헤더 x-feedback-token과 일치하는 행만 돌려준다
// (docs/supabase-feedback-board.sql). 토큰 = 열람 코드 — 다른 기기에서 입력하면 이어본다.

const FEEDBACK_TOKEN_KEY = "ta-feedback-token";
const FEEDBACK_SEEN_KEY = "ta-feedback-seen"; // 게시판을 마지막으로 연 시각 — 새 답변 뱃지 기준

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function getFeedbackToken(): string | null {
  try {
    const v = localStorage.getItem(FEEDBACK_TOKEN_KEY);
    return v && UUID_RE.test(v) ? v : null;
  } catch { return null; }
}

/** 없으면 만들어 저장하고 돌려준다 — 첫 제안 전송 시점에만 호출 (일반 방문자에겐 안 만든다) */
export function ensureFeedbackToken(): string {
  const cur = getFeedbackToken();
  if (cur) return cur;
  const token = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
  try { localStorage.setItem(FEEDBACK_TOKEN_KEY, token); } catch { /* 시크릿 모드 등 — 전송은 되고 열람만 안 됨 */ }
  return token;
}

/** 열람 코드 입력 — uuid 형식이면 토큰을 교체하고 true (다른 기기에서 이어보기) */
export function setFeedbackToken(code: string): boolean {
  const v = code.trim().toLowerCase();
  if (!UUID_RE.test(v)) return false;
  try { localStorage.setItem(FEEDBACK_TOKEN_KEY, v); } catch { return false; }
  return true;
}

export function getFeedbackSeen(): string | null {
  try { return localStorage.getItem(FEEDBACK_SEEN_KEY); } catch { return null; }
}
export function markFeedbackSeen() {
  try { localStorage.setItem(FEEDBACK_SEEN_KEY, new Date().toISOString()); } catch { /* noop */ }
}

export type FeedbackReply = { id: string; body: string; created_at: string };
export type MyFeedbackRow = {
  id: string; created_at: string; kind: FeedbackKind; message: string; payload: unknown;
  feedback_replies: FeedbackReply[];
};

/** 내 제안 목록 (답변 포함, 최신순) — 토큰이 없으면 네트워크 없이 [] */
export async function fetchMyFeedback(): Promise<MyFeedbackRow[]> {
  const token = getFeedbackToken();
  if (!token) return [];
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "x-feedback-token": token };
  const embed = "select=id,created_at,kind,message,payload,feedback_replies(id,body,created_at)" +
    "&order=created_at.desc&feedback_replies.order=created_at.asc&limit=100";
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback?${embed}`, { headers });
  if (res.ok) return res.json();
  // 과도기 — supabase-feedback-board.sql이 아직 적용 전이면 feedback_replies 임베드가 400.
  // 답변 없이 목록만이라도 돌려준다 (정책도 없으면 어차피 빈 배열).
  if (res.status === 400) {
    const plain = await fetch(`${SUPABASE_URL}/rest/v1/feedback?select=id,created_at,kind,message,payload&order=created_at.desc&limit=100`, { headers });
    if (plain.ok) return (await plain.json() as Omit<MyFeedbackRow, "feedback_replies">[]).map((r) => ({ ...r, feedback_replies: [] }));
  }
  throw new Error(`조회 실패 (${res.status})`);
}

// 본인 수정·삭제 (사용자 요청 2026-08-17) — RLS가 토큰 일치 행만 허용한다.
// ⚠ RLS에 걸리면 에러가 아니라 "0행 처리"에 200이 온다 (adminWrite와 같은 함정) —
// return=representation으로 실제 행 수를 세서 0행이면 실패로 던진다.

function authorHeaders(token: string) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "x-feedback-token": token,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

/** 본인 제안 수정 — 내용(message)만 바꾼다 */
export async function updateMyFeedback(id: string, message: string) {
  const token = getFeedbackToken();
  if (!token) throw new Error("열람 토큰이 없습니다");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback?id=eq.${id}`, {
    method: "PATCH",
    headers: authorHeaders(token),
    body: JSON.stringify({ message: message.slice(0, 4000) }),
  });
  if (!res.ok) throw new Error(`수정 실패 (${res.status})`);
  const changed = await res.json().catch(() => null);
  if (!Array.isArray(changed) || changed.length === 0) throw new Error("수정 실패 — 0행 처리");
}

/** 본인 제안 삭제 — 달린 답변도 FK cascade로 함께 지워진다 */
export async function deleteMyFeedback(id: string) {
  const token = getFeedbackToken();
  if (!token) throw new Error("열람 토큰이 없습니다");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback?id=eq.${id}`, {
    method: "DELETE",
    headers: authorHeaders(token),
  });
  if (!res.ok) throw new Error(`삭제 실패 (${res.status})`);
  const removed = await res.json().catch(() => null);
  if (!Array.isArray(removed) || removed.length === 0) throw new Error("삭제 실패 — 0행 처리");
}

// ── 게시판 관리자 모드 (사용자 요청 2026-08-17: "admin페이지 말고 제안 모달에서 답변") ──
// 열람 코드 입력칸에 관리자 키(.supabase-admin-key 내용)를 넣으면 잠금 해제된다.
// 키는 이 브라우저 localStorage에 남아 Supabase REST에 x-admin-key로 직접 실린다
// (RLS admin 정책이 대조 — /admin 프록시와 같은 헤더, 경로만 다름).
// ⚠ 공개 사이트 localStorage에 키가 놓이는 트레이드오프가 있다 — 관리자 본인 브라우저에서만
// 쓸 것. '관리자 해제'가 키를 지운다.

const FEEDBACK_ADMIN_KEY = "ta-feedback-admin";

export function getBoardAdminKey(): string | null {
  try { return localStorage.getItem(FEEDBACK_ADMIN_KEY) || null; } catch { return null; }
}
export function setBoardAdminKey(key: string | null) {
  try {
    if (key) localStorage.setItem(FEEDBACK_ADMIN_KEY, key);
    else localStorage.removeItem(FEEDBACK_ADMIN_KEY);
  } catch { /* noop */ }
}

function adminKeyHeaders(key: string) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "x-admin-key": key };
}

/** 키가 진짜인지 확인 — admin read 정책이 행을 돌려주면 참 (틀린 키는 RLS가 빈 배열을 준다) */
export async function probeBoardAdminKey(key: string): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback?select=id&limit=1`, { headers: adminKeyHeaders(key) });
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch { return false; }
}

export type BoardRow = MyFeedbackRow & { author_token?: string | null; reviewed_at?: string | null };

/** 전체 제안 (관리자 모드) — 답변·작성자 토큰 유무·대응 상태 포함 최신순 */
export async function fetchAllFeedbackBoard(key: string): Promise<BoardRow[]> {
  const embed = "select=id,created_at,kind,message,payload,author_token,reviewed_at,feedback_replies(id,body,created_at)" +
    "&order=created_at.desc&feedback_replies.order=created_at.asc&limit=200";
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback?${embed}`, { headers: adminKeyHeaders(key) });
  if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
  return res.json();
}

/** 게시판에서 관리자 제안 삭제 — 답변은 cascade. ⚠ 첨부 이미지 R2 정리는 못 한다
 * (파일 API는 /admin 프록시 전용) — 남은 이미지는 /admin 파일 탭 '제안 이미지'에서. */
export async function boardAdminDeleteFeedback(key: string, id: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback?id=eq.${id}`, {
    method: "DELETE",
    headers: { ...adminKeyHeaders(key), Prefer: "return=representation" },
  });
  if (!res.ok) throw new Error(`삭제 실패 (${res.status})`);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("삭제 실패 — 0행 처리");
}

/** 게시판에서 대응완료 토글 (/admin의 reviewed_at과 같은 칼럼) */
export async function boardAdminSetReviewed(key: string, id: string, reviewed: boolean) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...adminKeyHeaders(key), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ reviewed_at: reviewed ? new Date().toISOString() : null }),
  });
  if (!res.ok) throw new Error(`갱신 실패 (${res.status})`);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("갱신 실패 — 0행 처리");
}

/** 게시판에서 관리자 답변 등록 — 0행 처리는 실패 (키가 정책과 안 맞는 상태) */
export async function boardAdminAddReply(key: string, feedbackId: string, body: string): Promise<FeedbackReply> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback_replies`, {
    method: "POST",
    headers: { ...adminKeyHeaders(key), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ feedback_id: feedbackId, body: body.slice(0, 4000) }),
  });
  if (!res.ok) throw new Error(`답변 등록 실패 (${res.status})`);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("답변 등록 실패 — 0행 처리");
  return rows[0];
}

/** 게시판에서 관리자 답변 수정 (사용자 요청 2026-08-29) — 종전엔 지우고 다시 쓰는 수밖에
 *  없어서 등록 시각이 바뀌고 '새 답변' 표시가 다시 떴다. 0행 처리는 실패로 본다
 *  (RLS에 걸리면 에러가 아니라 200 + 빈 배열이 온다 — adminWrite 와 같은 함정). */
export async function boardAdminEditReply(key: string, replyId: string, body: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback_replies?id=eq.${replyId}`, {
    method: "PATCH",
    headers: { ...adminKeyHeaders(key), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ body: body.slice(0, 4000) }),
  });
  if (!res.ok) throw new Error(`답변 수정 실패 (${res.status})`);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("답변 수정 실패 — 0행 처리");
  return rows[0];
}

export async function boardAdminDeleteReply(key: string, replyId: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback_replies?id=eq.${replyId}`, {
    method: "DELETE",
    headers: { ...adminKeyHeaders(key), Prefer: "return=representation" },
  });
  if (!res.ok) throw new Error(`답변 삭제 실패 (${res.status})`);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("답변 삭제 실패 — 0행 처리");
}

/** 마지막으로 게시판을 연 뒤 달린 답변 수 — 헤더·FAB 뱃지용 */
export function countNewReplies(rows: MyFeedbackRow[]): number {
  const seen = getFeedbackSeen();
  let n = 0;
  for (const row of rows) for (const rep of row.feedback_replies) if (!seen || rep.created_at > seen) n += 1;
  return n;
}

/** 방문자 국가 코드 — Cloudflare 엣지가 같은 오리진 /cdn-cgi/trace에 붙여 주는 loc= 값.
 *  외부 지오IP 서비스 없이 공짜로 얻는다. 로컬 dev(:3000)나 실패 시엔 조용히 생략.
 *  관리자 화면(게시판 관리자 모드·/admin)에서만 표시한다 (사용자 요청 2026-08-19). */
async function visitorCountry(): Promise<string | null> {
  try {
    const res = await fetch("/cdn-cgi/trace", { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const m = (await res.text()).match(/^loc=([A-Z]{2})$/m);
    return m ? m[1] : null;
  } catch { return null; }
}

/** payload.country — 관리자 표시용 ISO 국가 코드 (없으면 null) */
export function countryOf(payload: unknown): string | null {
  const v = payload && typeof payload === "object" ? (payload as { country?: unknown }).country : null;
  return typeof v === "string" && /^[A-Z]{2}$/.test(v) ? v : null;
}

/** "KR" → 🇰🇷 (지역 지시 문자 합성) */
export function flagOf(cc: string): string {
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export async function sendFeedback(kind: FeedbackKind, message: string, payload?: unknown) {
  if (!feedbackReady) throw new Error("Supabase 키가 아직 설정되지 않았습니다");
  // 어떤 화면에서 보낸 제안인지 payload에 자동 첨부 (예: "/#infra", "/#op-char_2014_nian")
  const page = typeof window === "undefined" ? null : `${window.location.pathname}${window.location.hash}`;
  const country = await visitorCountry();
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  const body = { kind, message: message.slice(0, 4000), payload: { ...(payload && typeof payload === "object" ? payload : {}), page, ...(country ? { country } : {}) } };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method: "POST", headers,
    body: JSON.stringify({ ...body, author_token: ensureFeedbackToken() }),
  });
  if (res.ok) return;
  // 과도기 — author_token 컬럼(supabase-feedback-board.sql)이 아직 없으면 PGRST204(400).
  // 제안을 버리는 것보단 종전 모양(익명·열람 불가)으로라도 접수한다.
  if (res.status === 400) {
    const legacy = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, { method: "POST", headers, body: JSON.stringify(body) });
    if (legacy.ok) return;
  }
  throw new Error(`전송 실패 (${res.status})`);
}

// ─ 관리자 (/admin) — 인증은 Cloudflare Access(구글 SSO)가 담당한다 (2026-07-27).
// 브라우저는 관리자 키를 모른다: 모든 관리자 호출은 같은 오리진 /api(admin-api 프록시
// 워커)로 나가고, 워커가 Access JWT를 검증한 뒤 x-admin-key를 붙여 Supabase에 중계한다.
export const ADMIN_REST = "/api/supabase"; // + /<table>?<PostgREST query>
export type FeedbackRow = {
  id: string; created_at: string; kind: FeedbackKind; message: string; payload: unknown; reviewed_at: string | null;
  // 게시판 개편(2026-08-17) 이후 — SQL 적용 전이나 구형 익명 제안에는 없다
  author_token?: string | null;
  feedback_replies?: FeedbackReply[];
};

/**
 * 관리자 쓰기 — **0행이 바뀌면 실패로 본다**.
 *
 * RLS에 걸린 UPDATE/DELETE는 에러가 아니라 "0행 처리"다. PostgREST는 그때도 200을 주므로,
 * res.ok만 보면 아무것도 저장되지 않았는데 UI가 "저장됨"이라고 말한다 —
 * 2026-07-29에 실제로 당했다: docs/supabase-changelog.sql을 통째로 다시 돌리는 바람에
 * RLS 정책의 관리자 키가 플레이스홀더로 되돌아갔고, /admin은 조용히 아무것도 저장하지
 * 않으면서 성공 문구만 띄웠다. 그래서 return=representation으로 바꿔 실제 행 수를 센다.
 */
export async function adminWrite(path: string, init: RequestInit & { method: string }, what: string) {
  const res = await fetch(`${ADMIN_REST}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Prefer: "return=representation" },
  });
  if (!res.ok) throw new Error(`${what} 실패 (${res.status})`);
  const rows = await res.json().catch(() => null);
  if (Array.isArray(rows) && rows.length === 0) {
    throw new Error(`${what} 실패 — 서버가 0행을 처리했습니다. 권한(RLS 정책의 관리자 키)을 확인하세요.`);
  }
  return rows;
}

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
  const embed = "select=*,feedback_replies(id,body,created_at)&order=created_at.desc&feedback_replies.order=created_at.asc&limit=500";
  const res = await fetch(`${ADMIN_REST}/feedback?${embed}`);
  if (res.ok) return res.json();
  // 과도기 — feedback_replies 테이블(supabase-feedback-board.sql)이 아직 없으면 임베드가 400
  if (res.status === 400) {
    const plain = await fetch(`${ADMIN_REST}/feedback?select=*&order=created_at.desc&limit=500`);
    if (plain.ok) return plain.json();
  }
  throw new Error(`조회 실패 (${res.status})`);
}

// ── 관리자 답변 (제안 게시판 스레드 — 그 제안의 작성자만 읽을 수 있다) ──

export async function adminAddReply(feedbackId: string, body: string): Promise<FeedbackReply> {
  const rows = await adminWrite("/feedback_replies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback_id: feedbackId, body: body.slice(0, 4000) }),
  }, "답변 등록");
  return rows[0];
}

export async function adminDeleteReply(id: string) {
  await adminWrite(`/feedback_replies?id=eq.${id}`, { method: "DELETE" }, "답변 삭제");
}

export async function adminSetReviewed(id: string, reviewed: boolean) {
  await adminWrite(`/feedback?id=eq.${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewed_at: reviewed ? new Date().toISOString() : null }),
  }, "갱신");
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
  await adminWrite(`/feedback?id=eq.${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: withHandling(payload, handling) }),
  }, "갱신");
}

export async function adminDeleteFeedback(id: string) {
  await adminWrite(`/feedback?id=eq.${id}`, { method: "DELETE" }, "삭제");
}
