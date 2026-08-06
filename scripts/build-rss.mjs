// public/feed.xml 자동 생성 — AI 스토리 요약 발행 피드 (npm run build가 자동 실행).
//
// 왜 (2026-08-06): 네이버 서치어드바이저는 사이트맵과 **별도로 RSS를 받고**, 신규 문서
// 수집이 사이트맵보다 빠르다. 이 사이트에서 "새로 발행되는 글"은 AI 스토리 요약뿐이라
// (오퍼 데이터는 게임 갱신을 따라가는 참조 자료지 발행물이 아니다) 그것만 담는다.
//
// 항목 순서 = 출시월 내림차순. 출시월이 없는 메인스토리·통합전략은 뒤로 보낸다.
// pubDate는 그 이벤트의 KR 출시월 1일 09:00 KST — 일자까지는 데이터에 없으므로
// 지어내지 않고 월초로 고정한다(항목마다 안정적이라 피드가 흔들리지 않는다).
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_URL = "https://terra-archive.net";
const TITLE = "테라 아카이브 — AI 스토리 요약";
const DESC = "명일방주(Arknights) 이벤트 스토리를 AI가 정독해 컷씬과 함께 10분 분량으로 요약합니다.";
const MAX_ITEMS = 60; // 피드는 최신분만 — 전체 목록은 사이트맵이 담당한다

const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const stories = read("app/data/stories.json");
const chronology = read("app/data/chronology.json");
const summaryIds = read("app/data/story-summary-ids.json");
const summaries = read("app/data/story-summaries.json");

// ⚠ 이벤트 목록 구성은 app/seo-story.ts·app/story.tsx와 같아야 한다:
//    stories.json 이벤트 + chronology.json의 메인스토리·통합전략 항목.
const byId = new Map();
for (const e of stories.events) byId.set(e.id, { id: e.id, name: e.name, start: e.start });
for (const e of chronology.entries) {
  if (e.id && e.kind !== "event" && !byId.has(e.id)) byId.set(e.id, { id: e.id, name: e.title ?? { ko: e.id } });
}

const items = summaryIds
  .filter((id) => byId.has(id))
  .map((id) => ({ ...byId.get(id), tagline: (summaries[id]?.tagline ?? "").trim() }))
  .sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""))
  .slice(0, MAX_ITEMS);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// "2026-07" → RFC 822 (그 달 1일 09:00 KST). Date를 안 쓰는 이유: 요일 이름을 붙이려면
// 어차피 표를 써야 하고, 빌드 시각에 따라 값이 흔들리면 안 된다.
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function pubDate(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym ?? "")) return null;
  const [y, m] = ym.split("-").map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, 1)).getUTCDay()];
  return `${dow}, 01 ${MON[m - 1]} ${y} 09:00:00 +0900`;
}

const entries = items.map((it) => {
  const link = `${SITE_URL}/stories/${it.id}`;
  const date = pubDate(it.start);
  return `  <item>
    <title>${esc(it.name.ko)}</title>
    <link>${link}</link>
    <guid isPermaLink="true">${link}</guid>
${date ? `    <pubDate>${date}</pubDate>\n` : ""}    <description>${esc(it.tagline || DESC)}</description>
  </item>`;
}).join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- 자동 생성 파일 — 직접 수정 금지. scripts/build-rss.mjs가 만든다 (npm run build). -->
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(TITLE)}</title>
  <link>${SITE_URL}/stories</link>
  <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
  <description>${esc(DESC)}</description>
  <language>ko</language>
${entries}
</channel>
</rss>
`;

writeFileSync(join(ROOT, "public", "feed.xml"), xml);
console.log(`feed.xml: ${items.length} items`);
