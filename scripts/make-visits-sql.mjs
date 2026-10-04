#!/usr/bin/env node
// 방문 동선 기록 SQL 사본 생성기 (2026-10-04).
//
//   node scripts/make-visits-sql.mjs
//     → .visits-setup.generated.sql  방문 기록 전용 Supabase 프로젝트의 SQL Editor 에 붙여 넣을 사본 (gitignore됨)
//
// docs/supabase-visits.sql 의 관리자 키 자리(__ADMIN_KEY__)에 .supabase-admin-key 를 박는다 —
// 본 프로젝트와 **같은 관리자 키**를 쓴다. 그래야 admin-api 워커가 시크릿 하나(SUPABASE_ADMIN_KEY)로
// 두 프로젝트를 다 열 수 있다. 키를 회전하면(make-admin-rotate-sql.mjs) 이 사본도 다시 만들어 돌린다.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_FILE = join(ROOT, ".supabase-admin-key");
const SRC = join(ROOT, "docs", "supabase-visits.sql");
const OUT = join(ROOT, ".visits-setup.generated.sql");

if (!existsSync(KEY_FILE)) {
  console.error("거부: .supabase-admin-key 가 없다 — 본 프로젝트 관리자 키를 먼저 준비할 것");
  process.exit(1);
}
const key = readFileSync(KEY_FILE, "utf8").trim().replaceAll("'", "''");
const sql = readFileSync(SRC, "utf8");
const n = sql.split("__ADMIN_KEY__").length - 1;
writeFileSync(OUT, `-- 방문 동선 기록 설치 — scripts/make-visits-sql.mjs 생성물. 커밋 금지(gitignore).\n\n${sql.replaceAll("__ADMIN_KEY__", key)}`, { mode: 0o600 });
console.log(`→ ${OUT} (관리자 키 ${n}곳) — 방문 기록 프로젝트의 SQL Editor 에서 Run`);
