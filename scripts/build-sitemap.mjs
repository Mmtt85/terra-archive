// public/sitemap.xml 자동 생성 — app/ 라우트 폴더(page.tsx) 스캔 기반.
// 페이지가 늘어나면 빌드 시 자동 반영된다 (package.json build 스크립트가 vinext build 전에 실행).
// 규칙: /admin 제외 · 같은 탭의 ko/en/ja를 xhtml:link hreflang으로 상호 참조 ·
//       x-default=한국어 (사용자 확정 2026-07-18) · 정본 도메인 terra-archive.net (app/seo.ts와 동일).
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "app");
const SITE_URL = "https://terra-archive.net";
const LOCALES = ["ko", "en", "ja"]; // ko가 기본(접두 없음) — x-default 대상
const EXCLUDE = new Set(["admin"]); // 색인 금지 라우트

// app/ 아래 page.tsx 경로 수집 → "/en/farm" 같은 라우트 경로로
function collectRoutes(dir, base = "") {
  const routes = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (EXCLUDE.has(relative(APP, p).split("/")[0])) continue;
      routes.push(...collectRoutes(p, `${base}/${name}`));
    } else if (name === "page.tsx") {
      routes.push(base || "/");
    }
  }
  return routes;
}

// 라우트 → { locale, seg } (seg="" = 포탈 루트)
function parseRoute(route) {
  const parts = route.split("/").filter(Boolean);
  const locale = parts[0] === "en" || parts[0] === "ja" ? parts.shift() : "ko";
  return { locale, seg: parts.join("/") };
}

const routes = collectRoutes(APP);
const bySeg = new Map(); // seg → { ko?: path, en?: path, ja?: path }
for (const route of routes) {
  const { locale, seg } = parseRoute(route);
  if (!bySeg.has(seg)) bySeg.set(seg, {});
  bySeg.get(seg)[locale] = route;
}

// 포탈 루트 먼저, 나머지는 세그먼트 알파벳순 (기존 sitemap과 유사한 순서)
const segs = [...bySeg.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));

const urls = [];
for (const seg of segs) {
  const variants = bySeg.get(seg);
  if (!variants.ko) {
    console.warn(`⚠ 한국어(기본) 라우트 없음: ${seg} — x-default를 만들 수 없어 건너뜀`);
    continue;
  }
  const alt = LOCALES.filter((l) => variants[l])
    .map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}${variants[l] === "/" ? "/" : variants[l]}"/>`)
    .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${variants.ko === "/" ? "/" : variants.ko}"/>`)
    .join("\n");
  for (const l of LOCALES) {
    if (!variants[l]) continue;
    const loc = variants[l] === "/" ? "/" : variants[l];
    const priority = seg === "" ? (l === "ko" ? "1.0" : "0.9") : "0.8";
    urls.push(`  <url>
    <loc>${SITE_URL}${loc}</loc>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
${alt}
  </url>`);
  }
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- 자동 생성 파일 — 직접 수정 금지. scripts/build-sitemap.mjs가 app/ 라우트를 스캔해 만든다
     (npm run build 시 자동 실행). 언어 상호 참조는 xhtml:link hreflang, x-default=한국어. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;

writeFileSync(join(ROOT, "public", "sitemap.xml"), xml);
console.log(`sitemap.xml: ${urls.length} urls (${segs.length} paths × locales)`);
