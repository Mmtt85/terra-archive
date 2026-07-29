#!/usr/bin/env node
// 업데이트 내역 `area` 채우기 — 1회성 백필 (2026-07-29).
//
// 배지를 '인프라 개선'처럼 읽히게 하면서 추가한 컬럼이라, 기존 28행은 비어 있다.
// href가 있는 행은 사이트가 알아서 유추하지만(areaOf), **href 없는 12행은 전부 '사이트'로
// 떨어져 실제와 다르다** (복장·오퍼레이터 파일 = 백과사전, 스캐너 = 인프라 등).
// 그 12행만 손으로 분류해 채운다.
//
//   1) 먼저 docs/supabase-changelog.sql 의 `alter table ... add column area` 를
//      Supabase SQL Editor에서 실행한다 (PostgREST로는 DDL을 못 돌린다).
//   2) node scripts/changelog-backfill-area.mjs        # 미리보기
//      node scripts/changelog-backfill-area.mjs --write # 실제 반영
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_BASE = "https://exirlkhpkgxsflbglhld.supabase.co/rest/v1/changelog";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4aXJsa2hwa2d4c2ZsYmdsaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNTAwNDEsImV4cCI6MjA5ODgyNjA0MX0.IKwvqp0OyHOacl89JWIoRwzvJRDc2t0678qs3NPZ4fw";
const KEY = fs.readFileSync(path.join(ROOT, ".supabase-admin-key"), "utf8").trim();
const write = process.argv.includes("--write");

// href 없는 행의 영역 — 본문을 읽고 손으로 분류했다
const BY_ID = {
  "791c3b1e-590b-47d5-8001-5c176a3304b0": "archive",  // 오퍼레이터 상세 복장
  "4220994d-03f8-4d72-a765-02860ba57952": "archive",  // 오퍼레이터 파일
  "b0b5ce67-6aaf-4081-8de1-ce0e20931ede": "site",     // 업데이트 내역 자체
  "a013b56d-28e2-48e4-bcec-ec75401dc4cc": "site",     // 모달 URL 딥링크
  "ed3bad52-6299-438c-80c4-dd19b30d0b11": "site",     // 유니버셜 서치 개선
  "0ad08373-59ea-49d4-927d-cfc5ec62de16": "infra",    // 보유 오퍼 설정 모달
  "e6861420-4eca-4459-af82-73dfbb3531f1": "site",     // 전역 모서리 정리
  "ac75272a-6f64-4f29-a07b-4d51efe80e87": "site",     // 이름 정리
  "9a76e508-1ad8-4872-b49e-c7fc4e4113d3": "site",     // 유니버셜 서치 신규
  "201db7be-54c5-4018-8cd1-ecebbb04763b": "site",     // 공식 방송 이력
  "a7488446-4a1e-438d-a8d1-1de49cb1687d": "story",    // 헤더 이벤트 드롭다운
  "6e1580ea-cee8-44ce-b4e4-75af7bf1d8ca": "infra",    // 스크린샷 스캐너 iPad
};

// href → 영역 (app/changelog-api.ts 의 AREA_BY_PATH 와 같은 표)
const BY_PATH = [
  ["/infra", "infra"], ["/operators", "archive"], ["/recruit", "recruit"],
  ["/farm", "farm"], ["/upgrade", "upgrade"], ["/stories", "story"], ["/rogue", "rogue"],
];

const anon = { apikey: ANON, Authorization: `Bearer ${ANON}` };
const res = await fetch(`${URL_BASE}?select=*&order=released_at.desc,seq.asc&limit=500`, { headers: anon });
if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
const rows = await res.json();

if (!("area" in (rows[0] ?? {}))) {
  console.error("✗ area 컬럼이 없습니다 — docs/supabase-changelog.sql 의 alter table 을 먼저 실행하세요.");
  process.exit(1);
}

let done = 0, skip = 0;
for (const row of rows) {
  const want = BY_ID[row.id] ?? BY_PATH.find(([p]) => (row.href ?? "").startsWith(p))?.[1] ?? "site";
  if (row.area === want) { skip += 1; continue; }
  console.log(`${row.area ?? "(없음)"} → ${want}  ${row.ko.slice(0, 48)}`);
  if (!write) continue;
  const put = await fetch(`${URL_BASE}?id=eq.${row.id}`, {
    method: "PATCH",
    headers: { ...anon, "x-admin-key": KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ area: want }),
  });
  if (!put.ok) throw new Error(`저장 실패 ${row.id} (${put.status}) — ${await put.text()}`);
  done += 1;
}
console.log(write ? `\n반영 ${done}건 · 이미 맞음 ${skip}건` : `\n미리보기 — 실제로 반영하려면 --write`);
