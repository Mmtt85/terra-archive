#!/usr/bin/env node
// 사이트맵이 가리키는 주소가 **실제로 배포 스테이지에 있는지** 검사한다 (2026-08-08).
//
// 왜 생겼나: deploy.sh가 R2로 옮긴 에셋 폴더를 `rm -rf`로 걷어내는데, 2026-08-06에 통합전략
// 테마 정본 주소가 /rogue/<슬러그>로 바뀌면서 **에셋 폴더와 페이지 파일이 같은 폴더에
// 섞였다**. 그 결과 한국어 테마 페이지 6개가 매 배포마다 삭제돼 라이브에서 404가 났는데,
// 사이트맵에는 그대로 실려 있어 구글에는 "사이트맵이 가리키는데 없는 주소"로 보였다.
// /en·/ja는 다른 경로라 멀쩡해서 눈으로는 더 안 보였다 — GSC 리포트로야 드러났다.
//
// 조용히 넘어가면 다음에 또 같은 일이 난다. 그래서 배포 직전에 기계가 대조한다.
//
//   node scripts/check-staged.mjs <스테이지경로>
// 하나라도 없으면 **비정상 종료**해 배포를 멈춘다.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = process.argv[2];
if (!stage) { console.error("사용법: node scripts/check-staged.mjs <스테이지경로>"); process.exit(1); }

const sitemapPath = join(ROOT, "public/sitemap.xml");
if (!existsSync(sitemapPath)) { console.log("check-staged: sitemap.xml이 없어 건너뜀"); process.exit(0); }

const xml = readFileSync(sitemapPath, "utf8");
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (!urls.length) { console.log("check-staged: 사이트맵이 비어 건너뜀"); process.exit(0); }

/** 주소 → 스테이지의 정적 파일 경로. 정적 내보내기(output:"export") 규약 그대로다. */
const fileFor = (loc) => {
  const path = decodeURIComponent(new URL(loc).pathname);
  if (path === "/") return join(stage, "index.html");
  const clean = path.replace(/\/$/, "");
  // vinext 정적 내보내기는 /a/b → a/b.html (일부는 a/b/index.html)
  return [join(stage, `${clean}.html`), join(stage, clean, "index.html")];
};

const missing = [];
for (const loc of urls) {
  const cands = [fileFor(loc)].flat();
  if (!cands.some((f) => existsSync(f))) missing.push(loc);
}

if (missing.length) {
  console.error(`\n✗ 사이트맵이 가리키는 주소 ${missing.length}개가 스테이지에 없다 — 배포를 중단한다.`);
  console.error("  (이대로 올리면 구글에는 '사이트맵이 가리키는데 404'로 보인다)");
  for (const loc of missing.slice(0, 20)) console.error(`    ${loc}`);
  if (missing.length > 20) console.error(`    … 외 ${missing.length - 20}개`);
  console.error("\n  흔한 원인: deploy.sh의 R2 에셋 삭제 목록이 페이지 파일까지 지웠다.");
  process.exit(1);
}
console.log(`check-staged: 사이트맵 ${urls.length}개 주소 전부 스테이지에 있다`);
