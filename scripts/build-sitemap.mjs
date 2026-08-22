// public/sitemap.xml 자동 생성 — app/ 라우트 폴더(page.tsx) 스캔 기반.
// 페이지가 늘어나면 빌드 시 자동 반영된다 (package.json build 스크립트가 vinext build 전에 실행).
// 규칙: /admin 제외 · 같은 탭의 ko/en/ja를 xhtml:link hreflang으로 상호 참조 ·
//       x-default=한국어 (사용자 확정 2026-07-18) · 정본 도메인 terra-archive.net (app/seo.ts와 동일).
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

// ── lastmod (2026-07-28) ────────────────────────────────────────────────────
// Google은 sitemap의 changefreq·priority를 **무시하고 lastmod만** 크롤 신호로 쓴다. 값이
// 없으면 "언제 바뀌었는지 모름"이라 크롤 우선순위가 바닥에 깔린다 (GSC "발견됨 — 현재 색인이
// 생성되지 않음"). 매 빌드 시각을 넣으면 안 된다 — 안 바뀐 페이지까지 갱신됐다고 거짓 신고하는
// 꼴이라 Google이 lastmod 자체를 신뢰하지 않게 된다. 그래서 **그 페이지 내용을 좌우하는 데이터
// 파일의 마지막 커밋 시각**(git)을 쓴다 — 데이터가 실제로 바뀐 날만 갱신된다.
const SEG_SOURCES = {
  "": ["app/data/operators.json", "app/data/broadcasts.json"], // 포탈 = 허브(진행 이벤트·오퍼)
  operators: ["app/data/operators.json"],
  enemies: ["app/data/enemies.json", "app/data/enemy-stages.json"],
  // 목록 페이지는 통합전략 색인도 함께 그린다 (상세 페이지는 여전히 stages.json만 — 파일 수 한도)
  stages: ["app/data/stages.json", "app/data/stages-rogue.json"],
  sim: ["app/sim-launcher.tsx", "app/data/stages.json"], // 작전 시뮬레이터 런처 — 추천이 데이터를 따른다
  infra: ["app/data/infra.json", "app/data/rules.json"],
  recruit: ["app/data/recruit.json"],
  farm: ["app/data/farm.json"],
  upgrade: ["app/data/costs.json", "app/data/operators.json"],
  stories: ["app/data/story-summaries.json", "app/data/stories.json", "app/data/chronology.json"],
  rogue: ["app/data/rogue1.json", "app/data/rogue2.json", "app/data/rogue3.json", "app/data/rogue4.json", "app/data/rogue5.json", "app/data/rogue6.json"],
  ra: ["app/data/sandbox.json"], // 생존연산 가이드
  autochess: ["app/data/autochess.json"], // 위수 협의(오토체스) 가이드
  about: ["app/about/page.tsx"],
};
// ⚠ 파일 하나당 git을 **한 번만** 부른다. 종전엔 URL마다 불러서, 오퍼·적·작전 상세까지
// 수천 개인 사이트맵에 git 프로세스가 수천 번 떴다 — 이 스크립트 하나가 280초를 먹었고
// (실측 2026-08-23, 정작 vinext build는 166초였다) 배포 체감 시간의 절반이 여기였다.
// 상세 페이지들은 어차피 같은 소스를 보므로(키가 같다) 결과도 같다.
const GIT_DATE = new Map();
function gitDate(file) {
  if (!GIT_DATE.has(file)) {
    let iso = null;
    try {
      iso = execFileSync("git", ["log", "-1", "--format=%cI", "--", file], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    } catch { /* git 없음·shallow clone·미추적 파일 — lastmod 생략(없는 게 거짓말보다 낫다) */ }
    GIT_DATE.set(file, iso);
  }
  return GIT_DATE.get(file);
}

const LASTMOD = new Map();
function lastmodFor(seg) {
  // 스토리 상세(stories/<id>)는 목록과 같은 데이터에서 나오므로 같은 소스를 본다
  const key = seg.startsWith("stories/") ? "stories" : seg.startsWith("operators/") ? "operators" : seg.startsWith("enemies/") ? "enemies" : seg.startsWith("stages/") ? "stages" : seg.startsWith("rogue/") ? "rogue" : seg.startsWith("ra/") ? "ra" : seg;
  if (LASTMOD.has(key)) return LASTMOD.get(key);
  let latest = null;
  for (const file of SEG_SOURCES[key] ?? []) {
    const iso = gitDate(file);
    if (iso && (!latest || iso > latest)) latest = iso;
  }
  LASTMOD.set(key, latest);
  return latest;
}

// ── 동적 라우트 확장 (2026-08-06) ───────────────────────────────────────────
// /stories/[id]는 요약이 있는 스토리마다 실제 정적 페이지가 나온다 (app/seo-story.ts).
// 사이트맵에도 그 목록을 그대로 펼친다 — 색인시키려고 만든 페이지인데 사이트맵에
// 없으면 발견이 늦다. ⚠ 목록 산출 방식은 seo-story.ts의 storyIds와 같아야 한다:
// 요약 id 중 stories.json 이벤트이거나 chronology.json 항목(메인스토리·통합전략)인 것.
function storyIds() {
  const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
  const ids = read("app/data/story-summary-ids.json");
  const known = new Set([
    ...read("app/data/stories.json").events.map((e) => e.id),
    ...read("app/data/chronology.json").entries.filter((e) => e.id).map((e) => e.id),
  ]);
  return ids.filter((id) => known.has(id));
}
// /operators/[id]도 같은 방식 — 정식 출시 오퍼만 (미실장은 라우트를 안 만든다,
// app/seo-operator.ts 참조: 비공식 AI 번역이라 정식 출시 때 내용이 통째로 바뀐다).
function operatorIds() {
  const ops = JSON.parse(readFileSync(join(ROOT, "app/data/operators.json"), "utf8"));
  return ops.filter((o) => !o.unreleased).map((o) => o.id);
}
// /enemies/[id] — 도감에 노출되는 적 전부 (app/seo-enemy.ts enemyIds와 같은 목록).
// 오퍼와 달리 '미실장 제외' 같은 조건이 없다: enemies.json 자체가 이미
// hideInHandbook을 걸러낸 결과다 (scripts/build-enemies.py).
function enemyIds() {
  return JSON.parse(readFileSync(join(ROOT, "app/data/enemies.json"), "utf8")).map((e) => e.id);
}
// /stages/[id] — **상시 콘텐츠만** (app/seo-stage.ts stageIds와 같은 목록).
// 종료된 이벤트까지 펼치면 3개 언어로 13,000파일이라 Cloudflare Pages 20,000 한도를 넘는다.
function stageIds() {
  const PAGE_TYPES = new Set(["MAIN", "SUB", "SPECIAL_STORY", "CAMPAIGN", "DAILY", "CLIMB_TOWER"]);
  const doc = JSON.parse(readFileSync(join(ROOT, "app/data/stages.json"), "utf8"));
  // 고난 판(sub)은 뺀다 — 페이지는 남지만 캐노니컬이 일반판이라 사이트맵에 실을 이유가 없다
  return doc.stages.filter((s) => PAGE_TYPES.has(s.t) && !s.sub).map((s) => s.id);
}
// 통합전략 테마 6종 — /rogue/<slug> (app/seo-rogue.ts rogueSlugs와 같은 목록)
function rogueSlugs() {
  const idx = JSON.parse(readFileSync(join(ROOT, "app/data/rogue-index.json"), "utf8"));
  return Object.keys(idx).map((id) => `is${id.split("_")[1]}`);
}
const DYNAMIC = { "stories/[id]": storyIds, "operators/[id]": operatorIds, "enemies/[id]": enemyIds, "stages/[id]": stageIds, "rogue/[slug]": rogueSlugs, "ra/[slug]": () => ["sand", "anchor"] };

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
  // [id] 자리를 실제 값으로 펼친다 (없는 패턴이면 그 라우트는 사이트맵에서 빠진다)
  const expanded = DYNAMIC[seg] ? DYNAMIC[seg]().map((v) => seg.replace(/\[\w+\]/, v)) : [seg];
  for (const one of expanded) {
    if (!bySeg.has(one)) bySeg.set(one, {});
    bySeg.get(one)[locale] = route.replace(/\[\w+\]/, one.split("/").pop());
  }
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
  const lastmod = lastmodFor(seg);
  for (const l of LOCALES) {
    if (!variants[l]) continue;
    const loc = variants[l] === "/" ? "/" : variants[l];
    const priority = seg === "" ? (l === "ko" ? "1.0" : "0.9") : seg.includes("/") ? "0.7" : "0.8";
    urls.push(`  <url>
    <loc>${SITE_URL}${loc}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ""}    <changefreq>weekly</changefreq>
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
