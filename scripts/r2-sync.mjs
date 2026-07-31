#!/usr/bin/env node
// public/ 정적 에셋 → Cloudflare R2(terra-archive-files) 증분 동기화.
// 사이트 배포에서 대용량 에셋을 떼어내 배포를 빠르게 하기 위한 것 (2026-07-27).
//
//   node scripts/r2-sync.mjs           # 바뀐 것만 업로드 (md5 ↔ R2 etag 비교)
//   node scripts/r2-sync.mjs --dry     # 올릴 목록만 출력
//   node scripts/r2-sync.mjs --prune   # 로컬에 없는 assets/ 원격 키 삭제 (uploads/는 절대 안 건드림)
//
// 버킷 구조: assets/<public 상대경로> = 이 스크립트 관할 · uploads/ = /admin 수동 업로드 관할.
// 인증: 레포 루트 .r2-sync-key (gitignore됨) 또는 env R2_SYNC_KEY.
//   키 재발급: openssl rand -hex 32 > .r2-sync-key
//            && (cd workers/upload && npx wrangler secret put SYNC_KEY < ../../.r2-sync-key)
// 데이터 파이프라인이 public/ 에셋을 새로 뽑으면(스토리·통합전략·아바타 등) 이 스크립트를
// 다시 돌려야 사이트에 반영된다 — scripts/README.md 참고.

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const API = "https://terra-archive-upload.nzkonaru.workers.dev";

// 옮기는 폴더 — 여기 없는 루트 파일(파비콘·구글 인증 HTML)은 Pages에 남는다
const DIRS = ["story", "rogue", "lens", "tesseract", "avatars", "about", "og", "items", "scan",
  // 오퍼 상세 모달이 열릴 때만 받아가는 지연 로딩 데이터·이미지 (2026-07-28)
  "profiles", "skins", "skin",
  // 오퍼 보이스 대사 텍스트 — scripts/build-voicelines.py (2026-07-31)
  "voice",
  // 대문(포탈) 홈 화면 테마 배경 — scripts/build-portal-themes.py가 만든다 (2026-07-30)
  "portal"];

const PREFIX = "assets/"; // 에셋은 전부 이 폴더 밑 — uploads/(수동 업로드)와 격리
const DRY = process.argv.includes("--dry");
const PRUNE = process.argv.includes("--prune");
const CONCURRENCY = 16;

const KEY =
  process.env.R2_SYNC_KEY ??
  (existsSync(join(ROOT, ".r2-sync-key")) ? readFileSync(join(ROOT, ".r2-sync-key"), "utf8").trim() : null);
if (!KEY) {
  console.error("동기화 키가 없습니다 — .r2-sync-key 파일 또는 R2_SYNC_KEY 환경변수 필요");
  process.exit(1);
}

const MIME = {
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".avif": "image/avif", ".ico": "image/x-icon",
  ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".js": "text/javascript", ".wasm": "application/wasm",
  ".bin": "application/octet-stream", ".traineddata": "application/octet-stream",
};

// 캐시 정책: 게임 에셋 이미지·OCR 엔진은 id당 내용이 사실상 불변 → 30일.
// 재생성되는 데이터(스토리 스크립트 JSON·검색 인덱스 bin)는 1일.
function cacheFor(key) {
  const ext = extname(key).toLowerCase();
  if ([".json", ".txt", ".bin"].includes(ext)) return "public, max-age=86400";
  return "public, max-age=2592000";
}

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else if (ent.isFile() && !ent.name.startsWith(".")) out.push(p);
  }
  return out;
}

// ── 1. 현재 R2 상태 (etag = md5) ──
const listRes = await fetch(`${API}/files`, { headers: { "x-admin-key": KEY } });
if (!listRes.ok) {
  console.error(`R2 목록 조회 실패 (${listRes.status}) — 워커·시크릿을 확인하세요`);
  process.exit(1);
}
const remote = new Map((await listRes.json()).files.map((f) => [f.key, f.etag]));

// ── 2. 로컬 파일 수집 + md5 비교 ──
const files = [];
for (const dir of DIRS) {
  const abs = join(PUBLIC, dir);
  if (!existsSync(abs)) continue;
  for (const p of await walk(abs)) files.push(p);
}

const todo = [];
const localKeys = new Set();
let same = 0;
for (const p of files) {
  const key = PREFIX + relative(PUBLIC, p).split("\\").join("/"); // R2 키 = assets/<public 상대경로>
  localKeys.add(key);
  const body = await readFile(p);
  const md5 = createHash("md5").update(body).digest("hex");
  if (remote.get(key) === md5) { same += 1; continue; }
  todo.push({ key, p, size: statSync(p).size });
}

// --prune: 로컬에 없는 원격 키 삭제 대상 — assets/ 밖(uploads/ 등)은 절대 건드리지 않는다.
// 접두사 없는 옛 키(2026-07-27 assets/ 재편 이전)도 여기서 함께 청소된다.
const stale = PRUNE
  ? [...remote.keys()].filter((key) => !key.startsWith("uploads/") && !localKeys.has(key))
  : [];

console.log(`로컬 ${files.length}개 · 이미 동일 ${same}개 · 올릴 것 ${todo.length}개 (${(todo.reduce((a, f) => a + f.size, 0) / 1048576).toFixed(1)}MB)${PRUNE ? ` · 지울 것 ${stale.length}개` : ""}`);
if (DRY) {
  for (const f of todo.slice(0, 40)) console.log("  ", f.key);
  if (todo.length > 40) console.log(`   … 외 ${todo.length - 40}개`);
  if (stale.length) console.log(`  삭제 예정: ${stale.slice(0, 10).join(", ")}${stale.length > 10 ? ` … 외 ${stale.length - 10}개` : ""}`);
  process.exit(0);
}

// ── 3. 병렬 업로드 (실패 2회 재시도) ──
let done = 0, failed = 0;
async function put(f) {
  const body = await readFile(f.p);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`${API}/files/${encodeURIComponent(f.key)}`, {
        method: "PUT",
        headers: {
          "x-admin-key": KEY,
          "Content-Type": MIME[extname(f.key).toLowerCase()] ?? "application/octet-stream",
          "x-cache-control": cacheFor(f.key),
        },
        body,
      });
      if (res.ok) {
        done += 1;
        if (done % 250 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}…`);
        return;
      }
      if (res.status === 401) throw new Error("키 불일치 — 재시도 무의미");
    } catch (err) {
      if (String(err).includes("재시도 무의미")) { failed += 1; console.error(`  ✗ ${f.key}: ${err}`); return; }
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  failed += 1;
  console.error(`  ✗ ${f.key}: 3회 실패`);
}

const queue = [...todo];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await put(queue.shift());
  }),
);

// ── 4. --prune 삭제 ──
let pruned = 0;
if (stale.length) {
  const delQueue = [...stale];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (delQueue.length) {
        const key = delQueue.shift();
        const res = await fetch(`${API}/files/${encodeURIComponent(key)}`, { method: "DELETE", headers: { "x-admin-key": KEY } }).catch(() => null);
        if (res?.ok) { pruned += 1; if (pruned % 1000 === 0) console.log(`  삭제 ${pruned}/${stale.length}…`); }
        else console.error(`  ✗ 삭제 실패: ${key}`);
      }
    }),
  );
  console.log(`오래된 키 ${pruned}/${stale.length}개 삭제`);
}

console.log(failed ? `완료 — 실패 ${failed}개 (다시 돌리면 실패분만 재시도됨)` : "완료 — 전부 동기화됨");
process.exit(failed ? 1 : 0);
