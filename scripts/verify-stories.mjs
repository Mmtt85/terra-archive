#!/usr/bin/env node
// 스토리 요약 전수 렌더 검증 하네스 — StoryDetail(app/story.tsx)을 esbuild로 번들해
// 요약이 있는 전체 이벤트 × 3개 로케일을 react-dom/server로 실제 렌더하고, 렌더 중
// 던지는 에러(진입 크래시)를 잡는다. 요약/엔진 데이터를 고쳤으면 커밋 전에 돌릴 것.
//
//   node scripts/verify-stories.mjs
//
// 초기 렌더에 요약 본문 전체가 (hidden 상태여도) 포함되므로 renderToString이
// AI 요약 진입 경로를 전부 커버한다. 전문(스크립트) 본문은 런타임 fetch라 여기선
// 로딩 상태까지만 검증된다.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ── 번들: StoryDetail + I18nProvider를 한 엔트리로 ──────────────────────────
// 엔트리는 레포 안에 임시 생성 — tmpdir에 두면 react 등 node_modules 해석이 안 된다
const entry = path.join(ROOT, `.story-verify-entry-${process.pid}.ts`);
fs.writeFileSync(entry, `
export { StoryDetail, ScriptReader, eventById } from "./app/story";
export { I18nProvider } from "./app/i18n";
export { default as React } from "react";
export { renderToString } from "react-dom/server";
`);
// 번들도 레포 안에 생성 — react/react-dom을 external로 두면 임포트 시점에 번들 파일
// 위치 기준으로 node_modules를 찾기 때문 (react-dom/server의 CJS require는 번들 불가)
const bundle = path.join(ROOT, `.story-verify-${process.pid}.mjs`);
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [
  entry, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic",
  "--external:react", "--external:react-dom",
  `--outfile=${bundle}`, "--log-level=warning",
], { cwd: ROOT });
fs.rmSync(entry, { force: true });
const mod = await import(pathToFileURL(bundle).href);
fs.rmSync(bundle, { force: true });
const { StoryDetail, ScriptReader, eventById, I18nProvider, React, renderToString } = mod;

const SUMS = {
  ko: JSON.parse(fs.readFileSync(path.join(ROOT, "app/data/story-summaries.json"), "utf8")),
  en: JSON.parse(fs.readFileSync(path.join(ROOT, "app/data/story-summaries.en.json"), "utf8")),
  ja: JSON.parse(fs.readFileSync(path.join(ROOT, "app/data/story-summaries.ja.json"), "utf8")),
};

let fail = 0, total = 0;
for (const [locale, sums] of Object.entries(SUMS)) {
  for (const [id, summary] of Object.entries(sums)) {
    const event = eventById.get(id);
    if (!event) { console.error(`✗ [${locale}] ${id}: eventById에 없음 — 진입 경로 자체가 없다`); fail++; continue; }
    total++;
    try {
      // opIndex 미전달(최악 케이스)도 렌더가 버텨야 한다 — Home이 늦게 내려줄 수 있음
      renderToString(
        React.createElement(I18nProvider, { locale },
          React.createElement(StoryDetail, { event, summary, onClose: () => {}, opIndex: undefined })),
      );
    } catch (err) {
      fail++;
      console.error(`✗ [${locale}] ${id} (${event.name?.ko ?? id}): ${err?.message ?? err}`);
    }
  }
}
console.log(`✓ 스토리 요약 렌더 — ${total}건 (3로케일 × ${total / 3}편)${fail ? ` / 실패 ${fail}` : ""}`);

// ── 전문(풀 스크립트) 렌더 — 진입 기본 뷰가 전문이라 실제 크래시는 대부분 여기서 난다.
// 런타임엔 fetch로 받는 JSON을 파일에서 직접 읽어 ScriptReader에 주입한다.
const SCRIPT_DIRS = { ko: "public/story/script", en: "public/story/script/en", ja: "public/story/script/ja" };
let sfail = 0, stotal = 0;
for (const [locale, dir] of Object.entries(SCRIPT_DIRS)) {
  const full = path.join(ROOT, dir);
  for (const f of fs.readdirSync(full)) {
    if (!f.endsWith(".json")) continue;
    const id = f.slice(0, -5);
    const script = JSON.parse(fs.readFileSync(path.join(full, f), "utf8"));
    const summary = SUMS[locale][id];
    const entities = [...(summary?.chars ?? []), ...(summary?.terms ?? [])];
    // opIndex 두 케이스: 미전달(최악) / 전 화자 매핑(face·opId 분기 전부 태우기)
    const speakers = new Set();
    for (const ep of script.eps ?? []) for (const ln of ep.lines ?? []) if (ln.n) speakers.add(ln.n);
    const fullIndex = Object.fromEntries([...speakers].map((n) => [n, { op: "char_0000_test", desc: "테스트" }]));
    for (const [tag, opIndex] of [["no-index", undefined], ["full-index", fullIndex]]) {
      stotal++;
      try {
        renderToString(
          React.createElement(I18nProvider, { locale },
            React.createElement(ScriptReader, { script, error: false, entities, opIndex })),
        );
      } catch (err) {
        sfail++;
        console.error(`✗ [${locale}/${tag}] ${id}: ${err?.message ?? err}`);
      }
    }
  }
}
console.log(`✓ 전문 스크립트 렌더 — ${stotal}건`);
if (fail + sfail) { console.error(`\n총 ${fail + sfail}건 실패`); process.exit(1); }
console.log("전수 렌더 검증 전부 통과");
