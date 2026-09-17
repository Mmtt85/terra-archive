#!/usr/bin/env node
// 번역 사전 공개본(public/tl) → R2. **사이트 에셋 동기화(r2-sync.mjs)와 완전히 별개다.**
//
//   node scripts/publish-tl.mjs          # 바뀐 것만 올린다
//   node scripts/publish-tl.mjs --dry    # 올릴 목록만 출력
//   node scripts/publish-tl.mjs --force  # 내용이 같아도 전부 다시 올린다 (캐시 헤더 정책을 바꿨을 때)
//
// 왜 따로 두나 (2026-09-17, 사용자 지시 "공개 API 업로드 스크립트는 완전히 따로 빼야지"):
//   받는 쪽이 사이트가 아니라 **남의 앱**이다. 사이트 에셋은 배포마다 나가지만 공개본은
//   중섭 패치를 따라 2~3주에 한 번 나가고, 잘못 나가면 남의 앱이 깨진다. 한 스크립트에
//   섞어 두면 양쪽으로 샌다 — ① 사이트 배포가 공개본을 딸려 보내고, ② 공개본을 내려다
//   사이트 에셋이 딸려 간다 (실측: `--recache` 한 번에 11,681개 321MB가 올라갔다).
//   그래서 집합을 아예 나눴다. **r2-sync.mjs 의 DIRS 에 `tl` 을 다시 넣지 말 것.**
//   deploy.sh 의 트림 목록에는 남아 있다 — Pages 가 같은 파일을 또 서빙할 이유가 없다.
//
// 인증: r2-sync.mjs 와 같은 워커·같은 키 (.r2-sync-key 또는 env R2_SYNC_KEY).
//   키만 공유하고 대상은 assets/tl/ 밖으로 나가지 않는다.

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "public", "tl");
const API = "https://terra-archive-upload.nzkonaru.workers.dev";
const PREFIX = "assets/tl/";                 // ⚠ 이 스크립트는 여기 밖을 절대 안 건드린다
const PUBLIC_BASE = "https://files.terra-archive.net/assets/tl";

const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");

// 공개본은 JSON · 규격서(.md) · 그 규격서를 브라우저로 읽는 페이지(.html) 셋이다.
// .md 가 octet-stream 으로 나가면 브라우저가 페이지로 그리지 않고 내려받는다 (실측
// 2026-09-17). 애초에 브라우저는 마크다운을 어떤 타입으로도 서식대로 그려 주지 않으므로
// index.html 을 같이 낸다 — 그게 "주소 누르면 읽히는" 유일한 길이다.
// 캐시는 60초 — 고치면 바로 나가야 한다.
const MIME = {
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};
const CACHE = "public, max-age=60, must-revalidate";

const KEY = process.env.R2_SYNC_KEY
  ?? (existsSync(join(ROOT, ".r2-sync-key")) ? readFileSync(join(ROOT, ".r2-sync-key"), "utf8").trim() : null);
if (!KEY) {
  console.error("동기화 키가 없습니다 — .r2-sync-key 파일 또는 R2_SYNC_KEY 환경변수 필요");
  process.exit(1);
}
if (!existsSync(join(SRC, "manifest.json"))) {
  console.error("public/tl/manifest.json 이 없습니다 — 먼저 python3 scripts/build-tldict.py");
  process.exit(1);
}

// ── 1. 로컬 ──
const names = (await readdir(SRC, { withFileTypes: true }))
  .filter((e) => e.isFile() && !e.name.startsWith("."))
  .map((e) => e.name);
const unknown = names.filter((n) => !MIME[extname(n).toLowerCase()]);
if (unknown.length) {
  console.error(`public/tl 에 형식을 모르는 파일: ${unknown.join(", ")} — MIME 표에 추가하거나 치우세요`);
  process.exit(1);
}

// ── 2. 원격 (assets/tl/ 만) ──
const listRes = await fetch(`${API}/files`, { headers: { "x-admin-key": KEY } });
if (!listRes.ok) {
  console.error(`R2 목록 조회 실패 (${listRes.status}) — 워커·시크릿을 확인하세요`);
  process.exit(1);
}
const remote = new Map((await listRes.json()).files
  .filter((f) => f.key.startsWith(PREFIX)).map((f) => [f.key, f.etag]));

// ── 3. 견주기 ──
const todo = [];
let same = 0;
for (const name of names) {
  const body = await readFile(join(SRC, name));
  const md5 = createHash("md5").update(body).digest("hex");
  if (!FORCE && remote.get(PREFIX + name) === md5) { same += 1; continue; }
  todo.push({ name, key: PREFIX + name, body });
}
const stale = [...remote.keys()].filter((k) => !names.includes(k.slice(PREFIX.length)));

console.log(`공개본 ${names.length}개 · 이미 동일 ${same}개 · 올릴 것 ${todo.length}개`
  + (stale.length ? ` · 지울 것 ${stale.length}개` : ""));
if (DRY) {
  for (const f of todo) console.log("  ↑", f.name);
  for (const k of stale) console.log("  ✗", k);
  process.exit(0);
}

// ── 4. 업로드 (실패 2회 재시도) ──
let failed = 0;
for (const f of todo) {
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt += 1) {
    const res = await fetch(`${API}/files/${encodeURIComponent(f.key)}`, {
      method: "PUT",
      headers: { "x-admin-key": KEY, "Content-Type": MIME[extname(f.name).toLowerCase()], "x-cache-control": CACHE },
      body: f.body,
    }).catch(() => null);
    if (res?.ok) { ok = true; break; }
    if (res?.status === 401) { console.error("  키 불일치 — 재시도 무의미"); break; }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  console.log(`  ${ok ? "↑" : "✗"} ${f.name}`);
  if (!ok) failed += 1;
}

// 사전 파일이 빠졌을 때만 지운다 — 대상이 assets/tl/ 안이라 사이트 에셋은 사정권 밖이다
for (const key of stale) {
  const res = await fetch(`${API}/files/${encodeURIComponent(key)}`, {
    method: "DELETE", headers: { "x-admin-key": KEY },
  }).catch(() => null);
  console.log(`  ${res?.ok ? "✗ 삭제" : "! 삭제 실패"} ${key}`);
  if (!res?.ok) failed += 1;
}

// ── 5. 내보낸 것을 공개 주소로 되읽어 확인 ──
// 올렸다고 끝이 아니다 — 받는 쪽은 CDN 엣지를 통해 본다. manifest 가 그대로 나오는지,
// 규격서가 내려받기가 아니라 문서로 나가는지까지 확인해야 "나갔다"고 말할 수 있다.
const localManifest = await readFile(join(SRC, "manifest.json"), "utf8");
const check = await fetch(`${PUBLIC_BASE}/manifest.json`, { cache: "no-store" }).catch(() => null);
const liveManifest = check?.ok ? await check.text() : null;
if (liveManifest !== localManifest) {
  console.error("\n✗ 공개 주소의 manifest 가 로컬과 다릅니다 — 잠시 뒤 다시 확인하세요");
  failed += 1;
} else {
  const { files } = JSON.parse(localManifest);
  const want = { "README.md": "text/markdown", "index.html": "text/html" };
  const bad = [];
  for (const [name, type] of Object.entries(want)) {
    const head = await fetch(`${PUBLIC_BASE}/${name}`, { method: "HEAD" }).catch(() => null);
    const ct = head?.headers.get("content-type") ?? "";
    if (!ct.startsWith(type)) bad.push(`${name} → ${ct || "알 수 없음"} (${type} 이어야 함)`);
  }
  if (bad.length) {
    console.error(`\n✗ 형식이 틀립니다 — 브라우저가 내려받아 버립니다:\n   ${bad.join("\n   ")}`);
    failed += 1;
  } else {
    console.log(`\n확인 — manifest 일치 · 사전 ${files.length}개 · 규격서 둘 다 문서로 나감`);
    console.log(`  받는 쪽 시작점: ${PUBLIC_BASE}/manifest.json`);
    console.log(`  사람이 읽을 주소: ${PUBLIC_BASE}/index.html`);
  }
}

if (failed) { console.error(`\n✗ ${failed}건 실패`); process.exit(1); }
console.log("완료");
