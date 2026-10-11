// public/feed.xml 자동 생성 — AI 스토리 요약 + 신규 오퍼 발행 피드 (npm run build가 자동 실행).
//
// 2026-10-12: 신규 오퍼(한섭 데뷔)도 싣는다 (사용자 지시 "RSS 넓히기"). 네이버가 RSS 로 새 링크를 빨리 긁어 가는데,
// 점검일에 생기는 오퍼 상세 페이지(/operators/<id>)는 그동안 알릴 길이 사이트맵뿐이었다. 데뷔일은
// app/data/operator-debut.json (operators.json 커밋 이력에서 되짚은 한섭 데뷔일).
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
const TITLE = "테라 아카이브 — 신규 오퍼·AI 스토리 요약";
const DESC = "명일방주(명방·Arknights) 신규 오퍼레이터 정보와, 이벤트 스토리를 AI가 정독해 컷씬과 함께 10분 분량으로 요약한 글을 싣습니다.";
const STORY_DESC = "명일방주(Arknights) 이벤트 스토리를 AI가 정독해 컷씬과 함께 10분 분량으로 요약합니다.";
const MAX_ITEMS = 60; // 스토리 요약 — 피드는 최신분만, 전체 목록은 사이트맵이 담당한다
const MAX_OPS = 30;   // 신규 오퍼 — 데뷔일 최신순

const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const stories = read("app/data/stories.json");
const chronology = read("app/data/chronology.json");
const summaryIds = read("app/data/story-summary-ids.json");
const summaries = read("app/data/story-summaries.json");
const operators = read("app/data/operators.json");
const debut = read("app/data/operator-debut.json").debut ?? {};

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

// "2026-09-16" → 그날 16:00 KST (한섭 점검이 끝나 오퍼가 풀리는 시각)
function dayDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? "")) return null;
  const [y, m, dd] = d.split("-").map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  return `${dow}, ${String(dd).padStart(2, "0")} ${MON[m - 1]} ${y} 16:00:00 +0900`;
}
// 신규 오퍼 — 정식 출시(상세 라우트가 있는) 오퍼만, 데뷔일 최신순 (같은 날이면 출시 순번 역순)
const opById = new Map(operators.filter((o) => !o.unreleased).map((o) => [o.id, o]));
const opItems = Object.entries(debut)
  .filter(([id]) => opById.has(id))
  .map(([id, day]) => ({ op: opById.get(id), day }))
  .sort((a, b) => b.day.localeCompare(a.day) || (b.op.seq ?? 0) - (a.op.seq ?? 0))
  .slice(0, MAX_OPS);

// 피드 순서 = 날짜 내림차순 — 스토리(출시월 1일)와 오퍼(데뷔일)를 한 줄로. 날짜 없는 스토리는 맨 뒤
const all = [
  ...items.map((it) => ({ key: it.start ? `${it.start}-01` : "", title: it.name.ko, link: `${SITE_URL}/stories/${it.id}`, date: pubDate(it.start), desc: it.tagline || STORY_DESC })),
  ...opItems.map(({ op, day }) => ({
    key: day,
    title: `${op.name} — ${op.rarity}성 ${op.job}${op.subProfession ? ` · ${op.subProfession}` : ""} 신규 오퍼레이터`,
    link: `${SITE_URL}/operators/${op.id}`,
    date: dayDate(day),
    desc: `명일방주(명방) ${op.name} — 스킬·재능·잠재·인프라 스킬·정예화 재료${op.modules?.length ? "·모듈" : ""}을 한 페이지에 정리했습니다.`,
  })),
].sort((a, b) => b.key.localeCompare(a.key));

const entries = all.map((it) => `  <item>
    <title>${esc(it.title)}</title>
    <link>${it.link}</link>
    <guid isPermaLink="true">${it.link}</guid>
${it.date ? `    <pubDate>${it.date}</pubDate>\n` : ""}    <description>${esc(it.desc)}</description>
  </item>`).join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- 자동 생성 파일 — 직접 수정 금지. scripts/build-rss.mjs가 만든다 (npm run build). -->
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(TITLE)}</title>
  <link>${SITE_URL}/</link>
  <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
  <description>${esc(DESC)}</description>
  <language>ko</language>
${entries}
</channel>
</rss>
`;

writeFileSync(join(ROOT, "public", "feed.xml"), xml);
console.log(`feed.xml: ${all.length} items (스토리 ${items.length} · 신규 오퍼 ${opItems.length})`);
