#!/usr/bin/env node
// public/ 정적 에셋 → Cloudflare R2(terra-archive-files) 증분 동기화.
// 사이트 배포에서 대용량 에셋을 떼어내 배포를 빠르게 하기 위한 것 (2026-07-27).
//
//   node scripts/r2-sync.mjs           # 바뀐 것만 업로드 (md5 ↔ R2 etag 비교)
//   node scripts/r2-sync.mjs --dry     # 올릴 목록만 출력
//   node scripts/r2-sync.mjs --prune   # 로컬에 없는 assets/ 원격 키 삭제 (uploads/는 절대 안 건드림)
//   node scripts/r2-sync.mjs --recache # 내용이 같아도 데이터 파일을 다시 올려 캐시 헤더 갱신
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
  // 전투 스킬 레벨별 수치 — scripts/build-skill-levels.py (2026-08-01)
  "skills",
  // 모듈 이야기(uniEquipDesc) — scripts/build-module-stories.py (2026-08-02)
  "modules",
  // 적 도감 초상 — scripts/build-enemies.py (2026-08-09). ⚠ 폴더는 enemy(단수),
  // 라우트는 /enemies(복수) — deploy.sh가 자산만 떼어낼 수 있게 일부러 다르다.
  "enemy",
  // 작전 지형 도면 — scripts/build-stages.py (2026-08-09). 폴더는 stage(단수),
  // 라우트는 /stages(복수) — 적 도감과 같은 이유로 갈라 뒀다.
  "stage",
  // 생존연산 아이템 아이콘·맵 프리뷰 — scripts/build-sandbox.py (2026-08-12).
  // 폴더는 sandbox, 라우트는 /ra — 위와 같은 이유로 갈라 뒀다.
  "sandbox"];
// (2026-08-01 제거) "portal" — 대문 배경 전용 폴더였는데 포탈이 이격 스카디 일러 한 장
// (PORTAL_ART = /skin/full/…)으로 굳으면서 로컬·R2 양쪽에서 비었다. 남겨 두면 아래
// prune 안전장치가 매번 "빈 폴더"로 걸린다.

const PREFIX = "assets/"; // 에셋은 전부 이 폴더 밑 — uploads/(수동 업로드)와 격리
const DRY = process.argv.includes("--dry");
const PRUNE = process.argv.includes("--prune");
// --recache: 내용이 같아도 데이터 파일(json/txt/bin)을 다시 올려 **Cache-Control을 새로 씌운다**.
// 캐시 정책은 오브젝트 메타데이터라 cacheFor()만 고치면 이미 올라간 파일엔 반영되지 않는다.
// 정책을 바꾼 뒤 딱 한 번 돌리면 된다 (2026-08-02, 86400 → 60+must-revalidate 전환 때 사용).
const RECACHE = process.argv.includes("--recache");
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
//
// 재생성되는 데이터(오퍼 스킬·프로필·보이스·복장, 스토리 스크립트, 검색 인덱스)는
// **파일 이름이 그대로인 채 내용만 바뀐다** — URL이 안 변하니 브라우저가 캐시를 버릴
// 계기가 없다. 예전 값 max-age=86400은 그래서 "갱신 후 최대 하루 동안 옛 데이터"를
// 뜻했다. 2026-08-02에 실제로 당했다: 이격 안젤리나 S2의 레벨별 수치를 고쳐 올렸는데
// 사용자 브라우저는 하루 지난 캐시를 계속 써서 "다시 안 바뀌는 상태로 돌아갔다"고 보였다
// (R2·배포본은 정상이었다). 60초 후부터는 조건부 요청으로 확인하게 해 둔다 —
// 안 바뀌었으면 304(본문 없음)라 사실상 공짜고, 바뀌었으면 즉시 새 데이터를 받는다.
function cacheFor(key) {
  const ext = extname(key).toLowerCase();
  if ([".json", ".txt", ".bin"].includes(ext)) return "public, max-age=60, must-revalidate";
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
  const recache = RECACHE && [".json", ".txt", ".bin"].includes(extname(key).toLowerCase());
  if (remote.get(key) === md5 && !recache) { same += 1; continue; }
  todo.push({ key, p, size: statSync(p).size });
}

// --prune: 로컬에 없는 원격 키 삭제 대상 — assets/ 밖(uploads/ 등)은 절대 건드리지 않는다.
// 접두사 없는 옛 키(2026-07-27 assets/ 재편 이전)도 여기서 함께 청소된다.
const stale = PRUNE
  ? [...remote.keys()].filter((key) => !key.startsWith("uploads/") && !localKeys.has(key))
  : [];

// ── 2.5 prune 안전장치 (2026-08-01) ────────────────────────────────────────
// prune은 "로컬에 없다 = 지워도 된다"로 판단하는데, **로컬이 비어 있는 이유가 삭제 의도가
// 아닌 경우**가 실제로 있다:
//   · build-profiles/skins/voicelines.py는 출력 폴더를 rmtree하고 다시 굽는다 —
//     중간에 죽으면 폴더가 부분 상태로 남는다 (git에 원본이 있어도 작업 폴더는 이미 빈 상태).
//   · 부분 클론·sparse checkout·CI 체크아웃 등 애초에 폴더를 안 받은 환경.
// 이 상태로 prune을 돌리면 R2에서 조용히 대량 삭제된다. 두 겹으로 막는다:
//   ① DIRS 중 로컬에 없거나 빈 폴더가 하나라도 있으면 중단
//   ② 삭제량이 원격 assets/ 키의 PRUNE_MAX_RATIO를 넘으면 중단
// 진짜 대량 정리(폴더 폐지 등)는 --force로 뚫는다.
// 판단은 여기서 하고 **실제 차단은 삭제 직전(§4)** 에 건다 — 업로드는 정상적으로 끝내고
// 위험한 삭제만 건너뛰는 게 안전하다. --dry도 이 사유를 함께 보여준다.
const PRUNE_MAX_RATIO = 0.1;
const FORCE = process.argv.includes("--force");
const pruneBlock = (() => {
  if (!PRUNE || FORCE) return null;
  // 위험한 건 "원격엔 있는데 로컬이 빈" 폴더뿐이다 — 양쪽 다 비었으면 그냥 안 쓰는 항목이다
  const emptyDirs = DIRS.filter((dir) =>
    !files.some((p) => p.startsWith(join(PUBLIC, dir) + "/"))
    && [...remote.keys()].some((key) => key.startsWith(`${PREFIX}${dir}/`)));
  if (emptyDirs.length) return `원격엔 있는데 로컬이 빈 폴더: ${emptyDirs.join(", ")}`;
  const remoteAssets = [...remote.keys()].filter((key) => key.startsWith(PREFIX)).length;
  const ratio = remoteAssets ? stale.length / remoteAssets : 0;
  if (ratio > PRUNE_MAX_RATIO) {
    return `삭제 대상이 원격 에셋의 ${(ratio * 100).toFixed(1)}%`
      + ` (${stale.length}/${remoteAssets}개, 한도 ${PRUNE_MAX_RATIO * 100}%)`;
  }
  return null;
})();

console.log(`로컬 ${files.length}개 · 이미 동일 ${same}개 · 올릴 것 ${todo.length}개 (${(todo.reduce((a, f) => a + f.size, 0) / 1048576).toFixed(1)}MB)${PRUNE ? ` · 지울 것 ${stale.length}개` : ""}`);
if (DRY) {
  for (const f of todo.slice(0, 40)) console.log("  ", f.key);
  if (todo.length > 40) console.log(`   … 외 ${todo.length - 40}개`);
  if (stale.length) console.log(`  삭제 예정: ${stale.slice(0, 10).join(", ")}${stale.length > 10 ? ` … 외 ${stale.length - 10}개` : ""}`);
  if (pruneBlock) console.log(`  ⚠ 안전장치가 삭제를 막습니다 — ${pruneBlock} (--force로 무시)`);
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

// ── 4. --prune 삭제 (안전장치가 걸리면 건너뛴다) ──
let pruned = 0;
if (stale.length && pruneBlock) {
  console.error(`\n✗ 삭제 ${stale.length}개를 건너뜁니다 — ${pruneBlock}`);
  console.error("  로컬이 비어서 지우려는 것인지, 정말 지워야 하는 것인지 구분이 안 됩니다.");
  console.error("  · 빌드가 중간에 죽었을 수 있습니다(build-profiles/skins/voicelines.py는 출력 폴더를");
  console.error("    통째로 지우고 다시 굽습니다) — 파이프라인을 다시 돌린 뒤 재시도하세요.");
  console.error("  · 정말 지우려는 것이면 --prune --force 로 다시 실행하세요.");
  console.error("  (업로드는 정상적으로 끝났습니다)");
} else if (stale.length) {
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
