// IndexNow 통보 — 바뀐 페이지만 Bing·네이버(Yandex/Seznam 포함)에 즉시 알린다.
//
// 왜 (2026-08-06): 사이트맵은 "언젠가 와서 보라"는 신호라 신규 글이 며칠 걸린다.
// IndexNow는 우리가 먼저 알린다. 이 사이트에서 실제로 새로 발행되는 건 AI 스토리 요약과
// 신규 오퍼라, 그게 들어온 날 바로 수집되게 하는 게 요점이다.
//
// ⚠ 전체 URL을 매번 밀어넣지 않는다. 안 바뀐 페이지까지 계속 신고하면 신호가 무의미해지고
//    (검색엔진이 그 사이트의 통보를 신뢰하지 않게 된다) 쿼터도 낭비한다. 그래서 **직전
//    커밋 대비 실제로 바뀐 데이터 파일**에서 URL을 뽑는다 — 바뀐 게 없으면 아무것도 안 쏜다.
//
// 사용:
//   node scripts/indexnow.mjs                 # HEAD~1..HEAD 변경분 (배포 파이프라인 기본)
//   node scripts/indexnow.mjs --base <ref>    # 기준 커밋 지정
//   node scripts/indexnow.mjs --dry           # 보낼 목록만 출력하고 끝
//   node scripts/indexnow.mjs --url <u> ...   # 특정 URL만 직접 지정
//
// 키 파일은 public/<key>.txt (사이트 루트에 그대로 서빙돼야 검증을 통과한다).
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_URL = "https://terra-archive.net";
const HOST = "terra-archive.net";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const LOCALES = ["", "/en", "/ja"];
const MAX_URLS = 300; // 한 번에 이 이상이면 목록 페이지만 알린다 (상세는 사이트맵에 맡긴다)

const KEY = (() => {
  const f = readdirSync(join(ROOT, "public")).find((n) => /^[0-9a-f]{32}\.txt$/.test(n));
  if (!f) throw new Error("public/<32자리 hex>.txt 키 파일이 없다");
  return f.replace(/\.txt$/, "");
})();

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const dry = args.includes("--dry");
const explicit = args.reduce((acc, a, i) => (args[i - 1] === "--url" ? [...acc, a] : acc), []);

// 데이터 파일 → 그 파일이 좌우하는 탭 (build-sitemap.mjs의 SEG_SOURCES와 짝이 맞아야 한다)
const TAB_OF = {
  "operators.json": ["", "operators", "upgrade"],
  "infra.json": ["infra"], "rules.json": ["infra"],
  "recruit.json": ["recruit"],
  "farm.json": ["farm"],
  "costs.json": ["upgrade"],
  "stories.json": ["stories"], "chronology.json": ["stories"], "story-summaries.json": ["stories"],
  "broadcasts.json": [""],
};
const ROGUE_RE = /^rogue\d+(\.(cn|en|ja))?\.json$/;

function git(...a) {
  return execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** base..HEAD에서 바뀐 app/data 파일 목록 */
function changedData(base) {
  try {
    return git("diff", "--name-only", `${base}..HEAD`, "--", "app/data")
      .split("\n").filter(Boolean).map((p) => p.split("/").pop());
  } catch {
    return [];
  }
}

/** 그 파일들 안에서 **새로 추가된 id** (스토리 요약·오퍼) — 신규 발행분이 핵심이다 */
function addedIds(base, file, pick) {
  try {
    const before = JSON.parse(git("show", `${base}:app/data/${file}`));
    const after = JSON.parse(readFileSync(join(ROOT, "app/data", file), "utf8"));
    const had = new Set(pick(before));
    return pick(after).filter((id) => !had.has(id));
  } catch {
    return []; // 파일이 새로 생겼거나 기준 커밋에 없다 — 목록 페이지 통보로 충분하다
  }
}

function collect(base) {
  const urls = new Set();
  const add = (path) => { for (const l of LOCALES) urls.add(`${SITE_URL}${l}${path}`); };
  const files = changedData(base);
  if (files.length === 0) return [];

  for (const f of files) {
    for (const seg of TAB_OF[f] ?? []) add(seg ? `/${seg}` : "/");
    if (ROGUE_RE.test(f)) add("/rogue");
  }
  // 신규 스토리 요약 — 발행물이라 가장 급하다
  if (files.includes("story-summary-ids.json") || files.includes("story-summaries.json")) {
    for (const id of addedIds(base, "story-summary-ids.json", (d) => d)) { add("/stories"); add(`/stories/${id}`); }
  }
  // 신규 오퍼 (미실장은 상세 라우트가 없다 — app/seo-operator.ts)
  if (files.includes("operators.json")) {
    const ids = addedIds(base, "operators.json", (d) => d.filter((o) => !o.unreleased).map((o) => o.id));
    for (const id of ids) add(`/operators/${id}`);
  }
  return [...urls];
}

const base = flag("--base") ?? "HEAD~1";
let urls = explicit.length ? explicit : collect(base);

if (urls.length > MAX_URLS) {
  // 조용히 자르지 않는다 — 무엇을 뺐는지 로그로 남긴다
  const detail = urls.filter((u) => /\/(stories|operators)\/[^/]+$/.test(u));
  console.log(`⚠ 대상 ${urls.length}건이 상한(${MAX_URLS})을 넘어 상세 ${detail.length}건을 뺀다 — 사이트맵에 맡긴다`);
  urls = urls.filter((u) => !detail.includes(u)).slice(0, MAX_URLS);
}

if (urls.length === 0) {
  console.log(`IndexNow: 바뀐 페이지 없음 (기준 ${base}) — 아무것도 보내지 않는다`);
  process.exit(0);
}
console.log(`IndexNow: ${urls.length}건`);
for (const u of urls.slice(0, 12)) console.log(`  ${u}`);
if (urls.length > 12) console.log(`  … 외 ${urls.length - 12}건`);
if (dry) process.exit(0);

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `${SITE_URL}/${KEY}.txt`, urlList: urls }),
});
// 200/202 = 접수. 그 밖은 경고만 하고 **배포를 실패시키지 않는다** — 색인 통보는 부가 작업이다.
if (res.ok) console.log(`IndexNow 접수됨 (${res.status})`);
else console.log(`⚠ IndexNow 실패 (${res.status} ${res.statusText}) — 배포에는 영향 없음`);
