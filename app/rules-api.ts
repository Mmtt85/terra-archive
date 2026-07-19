// 플래너 지식 베이스 Supabase API — 테이블·RLS는 docs/supabase-planner-rules.sql.
// 읽기(발행 스냅샷)는 anon, 원장 CRUD·발행·롤백은 x-admin-key 헤더 (기존 admin 패턴).
import { SUPABASE_URL, SUPABASE_ANON_KEY, adminHeaders } from "./feedback";
import type { PlannerRules } from "./rules";
import type { RuleRow } from "./rules-compile";

export type ReleaseRow = { version: number; snapshot: PlannerRules; note: string | null; published_at: string };

const anonHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

// 최신 발행 스냅샷 — 미발행/테이블 없음이면 null (설치 전에도 admin 페이지가 죽지 않게)
export async function fetchLatestRelease(): Promise<ReleaseRow | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rule_releases?select=*&order=version.desc&limit=1`, { headers: anonHeaders });
  if (!res.ok) return null;
  const rows: ReleaseRow[] = await res.json();
  return rows[0] ?? null;
}

export async function adminListRules(password: string): Promise<RuleRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/planner_rules?select=*&order=kind.asc,seq.asc,key.asc&limit=2000`, {
    headers: adminHeaders(password),
  });
  if (!res.ok) throw new Error(`규칙 조회 실패 (${res.status}) — supabase-planner-rules.sql을 실행했는지 확인`);
  return res.json();
}

// upsert — (kind, key) 충돌 시 body·status·note·seq를 갱신 (updated_at 갱신 포함)
export async function adminUpsertRule(password: string, rule: RuleRow) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/planner_rules?on_conflict=kind,key`, {
    method: "POST",
    headers: {
      ...adminHeaders(password),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      kind: rule.kind, key: rule.key, body: rule.body, status: rule.status,
      source: rule.source ?? "manual", note: rule.note ?? null, seq: rule.seq,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`규칙 저장 실패 (${res.status})`);
}

export async function adminDeleteRule(password: string, id: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/planner_rules?id=eq.${id}`, {
    method: "DELETE",
    headers: adminHeaders(password),
  });
  if (!res.ok) throw new Error(`규칙 삭제 실패 (${res.status})`);
}

export async function adminPublishRelease(password: string, version: number, snapshot: PlannerRules, note: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rule_releases`, {
    method: "POST",
    headers: { ...adminHeaders(password), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ version, snapshot, note: note || null }),
  });
  if (!res.ok) throw new Error(`발행 실패 (${res.status})${res.status === 409 ? " — 같은 버전이 이미 있습니다 (새로고침 후 재시도)" : ""}`);
}

// 롤백 = 최신 발행 행 삭제 → 이전 버전이 자동으로 최신이 된다 (원장 행은 그대로)
export async function adminDeleteRelease(password: string, version: number) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rule_releases?version=eq.${version}`, {
    method: "DELETE",
    headers: adminHeaders(password),
  });
  if (!res.ok) throw new Error(`롤백 실패 (${res.status})`);
}
