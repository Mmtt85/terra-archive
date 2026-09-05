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
// 원하는 키(패스프레이즈)로 바꾸려면: .supabase-admin-key에 그 값을 먼저 써넣고 실행
// (사용자 요청 2026-08-17 — 제안 게시판 관리자 모드에서 폰으로도 칠 수 있는 키).
// ⚠ anon 키가 공개 번들에 있어 아무나 키 대입을 시도할 수 있다 — 'admin' 같은 짐작 가능한
//   값이 실제로 뚫려 있던 전례(dev_notes 2026-08-05) 때문에 16자 미만은 거부한다.
//
// ⚠ 실행 순서: Access 로그인·프록시가 동작하는 걸 확인한 다음에 SQL을 돌릴 것 —
//   돌리는 순간 옛 키는 어디서도 통하지 않는다 (워커 시크릿·게시판 localStorage 재입력 필요).

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

// --allow-short: 소유자가 위험을 알고도 짧은 키를 고른 경우의 오버라이드
// (2026-08-17 사용자 확정 — 9자 개인 키. 온라인 대입은 요청당 1회라 현실적으론 어렵지만,
//  짐작 가능한 값·다른 서비스 재사용 비밀번호는 절대 금지라고 고지했다.)
const allowShort = process.argv.includes("--allow-short");
if (key.length < (allowShort ? 8 : 16)) {
  console.error(`거부: 키가 ${key.length}자 — ${allowShort ? 8 : 16}자 이상으로. (anon 키가 공개라 짧은 키는 대입당한다)`);
  process.exit(1);
}
if (key.includes("'")) {
  console.error("거부: 키에 작은따옴표(')는 쓸 수 없다 (SQL 리터럴에 박힌다).");
  process.exit(1);
}

const CHECK = `(current_setting('request.headers', true)::json ->> 'x-admin-key') = '${key}'`;

// (테이블, 정책명, 종류) — docs/supabase-*.sql의 admin 정책 전수
// (2026-08-17 갱신: dev_notes·feedback_replies 추가 — 새 admin 정책이 생기면 여기도 등록)
const POLICIES = [
  ["feedback", "admin read feedback", "select"],
  ["feedback", "admin update feedback", "update"],
  ["feedback", "admin delete feedback", "delete"],
  ["feedback_replies", "admin all feedback_replies", "all"],
  // 개발자 코멘트 기능은 2026-09-05에 사이트에서 제거됐지만 **테이블은 Supabase에 남아 있다**
  // (데이터를 지우지 않았다). 정책이 살아 있는 한 회전 대상에서 빼면 안 된다 — 빼면 옛 키가
  // 그 테이블에 그대로 남는다. Supabase에서 dev_notes를 drop 하면 이 줄도 함께 지울 것.
  ["dev_notes", "admin write dev_notes", "all"],
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
