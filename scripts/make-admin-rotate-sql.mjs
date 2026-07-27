#!/usr/bin/env node
// Supabase 관리자 키(x-admin-key) 회전 SQL 생성기 (2026-07-27, Access 이관과 함께).
//
// 배경: 종전 키는 docs/supabase-*.sql에 평문으로 커밋돼 있었다. Access(구글 SSO) 이관 후
// 키는 브라우저가 아니라 admin-api 워커 시크릿에만 살면 되므로, 강한 랜덤으로 회전한다.
//
//   node scripts/make-admin-rotate-sql.mjs
//     → .supabase-admin-key         새 키 (없으면 생성, gitignore됨)
//     → .admin-rotate.generated.sql Supabase SQL Editor에 붙여넣을 회전 SQL (gitignore됨)
//   이후: cd workers/admin-api && npx wrangler secret put SUPABASE_ADMIN_KEY < ../../.supabase-admin-key
//
// ⚠ 실행 순서: Access 로그인·프록시가 동작하는 걸 확인한 다음에 SQL을 돌릴 것 —
//   돌리는 순간 옛 비밀번호('admin')는 어디서도 통하지 않는다.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_FILE = join(ROOT, ".supabase-admin-key");
const OUT = join(ROOT, ".admin-rotate.generated.sql");

const key = existsSync(KEY_FILE)
  ? readFileSync(KEY_FILE, "utf8").trim()
  : randomBytes(32).toString("hex");
if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, `${key}\n`, { mode: 0o600 });

const CHECK = `(current_setting('request.headers', true)::json ->> 'x-admin-key') = '${key}'`;

// (테이블, 정책명, 종류) — docs/supabase-*.sql의 admin 정책 전수 (2026-07-27 기준)
const POLICIES = [
  ["feedback", "admin read feedback", "select"],
  ["feedback", "admin update feedback", "update"],
  ["feedback", "admin delete feedback", "delete"],
  ["planner_rules", "admin all planner_rules", "all"],
  ["rule_releases", "admin insert releases", "insert"],
  ["rule_releases", "admin delete releases", "delete"],
  ["changelog", "admin write changelog", "all"],
  ["tips", "admin write tips", "all"],
  ["omni_pick", "admin read omni pick", "select"],
  ["omni_pick", "admin delete omni pick", "delete"],
];

const lines = [
  "-- 관리자 키 회전 — scripts/make-admin-rotate-sql.mjs 생성물. 이 파일은 커밋 금지(gitignore).",
  "-- Supabase SQL Editor에서 실행하면 옛 키('admin')는 즉시 무효가 된다.",
  "",
];
for (const [table, name, kind] of POLICIES) {
  lines.push(`drop policy if exists "${name}" on public.${table};`);
  if (kind === "insert") {
    lines.push(`create policy "${name}" on public.${table} for insert to anon`, `  with check (${CHECK});`, "");
  } else if (kind === "select" || kind === "delete") {
    lines.push(`create policy "${name}" on public.${table} for ${kind} to anon`, `  using (${CHECK});`, "");
  } else {
    lines.push(
      `create policy "${name}" on public.${table} for ${kind} to anon`,
      `  using (${CHECK})`,
      `  with check (${CHECK});`,
      "",
    );
  }
}
writeFileSync(OUT, lines.join("\n"));
console.log(`새 키: ${KEY_FILE} (${key.length}자)`);
console.log(`회전 SQL: ${OUT} — Supabase SQL Editor에 붙여넣어 실행`);
console.log("다음: cd workers/admin-api && npx wrangler secret put SUPABASE_ADMIN_KEY < ../../.supabase-admin-key");
