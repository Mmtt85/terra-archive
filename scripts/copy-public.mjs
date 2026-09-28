#!/usr/bin/env node
// public/ → dist/client 복사 — **Pages 가 서빙할 것만** (2026-09-28, 사용자 요청 "빌드 시간 줄이기").
//
// 종전엔 vite 가 빌드마다 public/ 을 통째로 복사했다 (copyPublicDir). public/ 은 2.4GB·3만 9천 개인데
// 그 대부분(story·skin·stage·rogue …)은 R2(files.terra-archive.net)에서 서빙하는 에셋이라,
// 복사해 봐야 deploy.sh 가 스테이지에서 다시 지운다. 그 헛복사가 빌드마다 두 번 났다 —
// vite 의 복사(2.4GB, 실측 17초) + 다음 빌드 시작 때 그걸 지우는 것, 그리고 deploy.sh 의
// 스테이지 복사(3.4GB). 그래서 vite.config.ts 에서 copyPublicDir 를 끄고 여기서 골라 복사한다.
//
// 빼는 목록 = scripts/deploy.sh 의 트림 목록 + rogue (public/rogue 는 전부 에셋이다 — 테마 페이지
//   is*.html·.rsc 는 빌드 산출물이라 public 에 없다). 새 R2 폴더를 만들면 deploy.sh·r2-sync.mjs 와
//   함께 여기도 넣는다. **빠뜨려도 깨지지는 않는다** — 복사됐다가 deploy.sh 가 지울 뿐, 느려질 뿐이다.
//
// TA_LOCAL_ASSETS=1 빌드(아직 R2 에 안 올린 새 에셋을 로컬에서 확인 — vite.config.ts)는 에셋을
// public/ 에서 읽으므로 **전부** 복사한다.
//
// ⚠ vinext build **바로 뒤, fix-html-lang 앞**에서 돈다 (package.json) — 종전 순서(vite 가 빌드 첫머리에
//   복사)와 뒤 단계가 보는 파일이 같아야 한다 (public 의 사이트 인증용 .html 두 개 등).
import { cpSync, existsSync, readdirSync } from "node:fs";
import { constants } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "public");
const OUT = join(ROOT, "dist", "client");

const R2_ONLY = new Set([
  "story", "lens", "tesseract", "avatars", "about", "og", "items", "scan", "profiles", "skins", "skin",
  "voice", "skills", "modules", "enemy", "stage", "sandbox", "ac", "records", "lore", "event", "tl",
  "rogue",
]);
const ALL = !!process.env.TA_LOCAL_ASSETS;

if (!existsSync(OUT)) {
  console.error("copy-public: dist/client 가 없다 — vinext build 뒤에 돌린다");
  process.exit(1);
}

let n = 0;
for (const name of readdirSync(SRC)) {
  if (!ALL && R2_ONLY.has(name)) continue;
  // 같은 이름이 빌드 산출물에 있으면 산출물이 이긴다 (vite 의 copyPublicDir 도 먼저 복사하고
  // 산출물이 덮어쓰는 순서였다). APFS 에선 복제(clone)로 — 안 되는 파일시스템은 보통 복사로 떨어진다.
  cpSync(join(SRC, name), join(OUT, name), {
    recursive: true, force: false, errorOnExist: false, mode: constants.COPYFILE_FICLONE,
  });
  n++;
}
console.log(`copy-public: public/ ${n}개 항목 → dist/client${ALL ? " (TA_LOCAL_ASSETS — 전부)" : " (R2 전용 폴더 제외)"}`);
