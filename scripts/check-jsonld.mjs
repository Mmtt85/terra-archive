#!/usr/bin/env node
// 구조화 데이터(JSON-LD) 전수 검사 — **조용히 깨진 마크업**을 배포 전에 잡는다.
//
// 왜 필요한가 (2026-08-26): 사이트의 8,500여 장 전부가 JSON-LD를 싣고 있는데, 그게
// 깨져도 알려주는 사람이 아무도 없었다. 빌드는 통과하고, 사람 눈에도 안 보이고,
// 검색엔진만 조용히 무시한다. 게다가 내용이 **게임 데이터에서 조립**되므로 코드를
// 안 고쳐도 클뜯 텍스트가 바뀌는 것만으로 깨질 수 있다 — 리뷰로는 절대 안 잡히는 부류다.
//
// 이 레포의 규약을 그대로 따른다: check-css / check-hashboot / check-staged 와 같이
// **하나라도 어긋나면 빌드를 중단**한다. 잘못된 구조화 데이터는 단순 오류가 아니라
// 구글 스팸 정책(마크업과 콘텐츠 불일치) 대상이라, 틀린 채로 나가느니 실패가 낫다.
//
// npm run build 의 마지막(fix-html-lang 뒤)에 돈다 — 그때가 최종 HTML이다.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "dist", "client");
const SITE = "https://terra-archive.net";
/** 이 값보다 적게 나오면 출력 구조가 바뀐 것으로 본다 (fix-html-lang 의 0개 가드와 같은 취지) */
const MIN_PAGES = 8000;

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(p);
    else if (entry.name.endsWith(".html")) yield p;
  }
}

const BLOCK = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
const errors = [];
const types = new Map();
let pages = 0, blocks = 0;

const fail = (file, msg) => errors.push(`${file.slice(ROOT.length + 1)}: ${msg}`);

/** url·item 류 필드를 노드 트리 전체에서 재귀로 훑어 절대 주소인지 본다 */
const URL_KEYS = new Set(["url", "mainEntityOfPage", "item", "image", "@id"]);
function checkUrls(file, value, where) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkUrls(file, v, `${where}[${i}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value)) {
    if (URL_KEYS.has(k) && typeof v === "string" && v) {
      if (!/^https?:\/\//.test(v)) fail(file, `${where} ${k} 가 절대 URL 이 아니다: ${v}`);
      // image 만 예외 — 대용량 에셋은 R2(files.terra-archive.net)에서 서빙한다.
      // 나머지는 전부 정본 도메인이어야 한다: pages.dev 프리뷰 주소가 새어 나가면
      // 검색엔진이 중복 콘텐츠로 본다 (app/seo.ts 머리주석의 canonical 통합 규칙).
      else if (k !== "image" && !v.startsWith(SITE)) fail(file, `${where} ${k} 가 정본 도메인이 아니다: ${v}`);
    }
    if (v && typeof v === "object") checkUrls(file, v, `${where}.${k}`);
  }
}

/** 그래프 노드 하나 검사 */
function checkNode(file, node, where) {
  if (!node || typeof node !== "object") return fail(file, `${where} 노드가 객체가 아니다`);
  if (!node["@type"]) return fail(file, `${where} @type 없음`);
  types.set(node["@type"], (types.get(node["@type"]) ?? 0) + 1);

  // URL 필드는 전부 절대 주소여야 한다 — 상대 경로면 검색엔진이 못 따라간다.
  // ⚠ 반드시 **재귀**로 훑는다: item 은 BreadcrumbList 가 아니라 자식 ListItem 에,
  //    url 은 publisher 안에 들어 있다. 최상위만 보던 첫 판이 상대 URL 을 놓쳤다
  //    (2026-08-26 음성 테스트에서 발각 — 검사기도 검사해야 한다).
  checkUrls(file, node, where);
  // 빵부스러기는 검색 결과에 실제로 렌더링되는 유일한 항목이라 조금 더 깐깐하게 본다.
  if (node["@type"] === "BreadcrumbList") {
    const items = node.itemListElement;
    if (!Array.isArray(items) || items.length === 0) return fail(file, "BreadcrumbList 가 비었다");
    items.forEach((it, i) => {
      if (it?.["@type"] !== "ListItem") fail(file, `빵부스러기 ${i} @type 이 ListItem 이 아니다`);
      if (it?.position !== i + 1) fail(file, `빵부스러기 ${i} position 이 ${i + 1} 이 아니다 (${it?.position})`);
      if (!it?.name) fail(file, `빵부스러기 ${i} name 없음`);
      // 마지막 항목(현재 페이지)만 item 을 생략할 수 있다
      if (i < items.length - 1 && !it?.item) fail(file, `빵부스러기 ${i} item(링크) 없음`);
    });
  }
  if (node["@type"] === "Article" && !node.headline) fail(file, "Article headline 없음");
}

for (const file of htmlFiles(ROOT)) {
  const html = readFileSync(file, "utf8");
  let m, found = 0;
  BLOCK.lastIndex = 0;
  while ((m = BLOCK.exec(html))) {
    found += 1; blocks += 1;
    const raw = m[1];

    // ① 스크립트 블록을 조기 종료시키는 문자가 남아 있으면 안 된다.
    //    app/json-ld.tsx 의 ldText() 가 `<` 를 < 로 바꾸므로 여기 걸리면 그 경로를
    //    안 탄 출력이 있다는 뜻이다 (누가 손으로 <script> 를 다시 적었거나).
    if (raw.includes("<")) fail(file, "JSON-LD 안에 이스케이프되지 않은 '<' 가 있다 (app/json-ld.tsx 의 JsonLd 컴포넌트를 쓸 것)");

    // ② 파싱
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      fail(file, `JSON 파싱 실패 — ${e.message}`);
      continue;
    }

    // ③ 문맥과 그래프
    if (data["@context"] !== "https://schema.org") fail(file, `@context 가 https://schema.org 가 아니다 (${data["@context"]})`);
    const graph = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
    if (graph.length === 0) fail(file, "@graph 가 비었다");
    graph.forEach((node, i) => checkNode(file, node, `@graph[${i}]`));
  }
  if (found) pages += 1;
}

if (pages < MIN_PAGES) {
  console.error(`check-jsonld: JSON-LD 를 실은 페이지가 ${pages}개뿐이다 (기대 ${MIN_PAGES}개 이상) — 출력 구조가 바뀌었는지 확인`);
  process.exit(1);
}

if (errors.length) {
  console.error(`check-jsonld: 구조화 데이터 오류 ${errors.length}건\n`);
  for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
  if (errors.length > 20) console.error(`  … 외 ${errors.length - 20}건`);
  console.error("\n잘못된 구조화 데이터는 리치 결과 자격을 잃게 하므로 배포하지 않는다.");
  process.exit(1);
}

const tally = [...types.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} ${c.toLocaleString()}`).join(" · ");
console.log(`check-jsonld: ${pages.toLocaleString()}개 페이지 · 블록 ${blocks.toLocaleString()}개 · 오류 0 — ${tally}`);
