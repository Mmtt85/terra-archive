// app/data/rogue-index.json 자동 생성 — 통합전략 테마의 **이름과 도입문만** 뽑은 색인.
//
// 왜 (2026-08-06): 테마 본문 데이터(rogueN.json)는 300~800KB라 선택 시 동적 로드한다.
// 그래서 프리렌더 HTML에는 "데이터를 불러오는 중…" 한 줄뿐이었고, 테마별 라우트
// (/rogue/is5)를 만들어도 정적 HTML에 담길 본문이 없다. 이름·도입문만 담은 몇 KB짜리
// 색인을 따로 두면, 무거운 데이터를 건드리지 않고도 테마 페이지가 제목·소개를 정적으로
// 내보낼 수 있다 (메타데이터·JSON-LD·히어로).
//
// npm run build가 자동 실행. 원본은 rogueN[.en|.ja].json — 직접 고치지 말 것.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["ko", "en", "ja"];
const TOPICS = [1, 2, 3, 4, 5, 6];

// rogue_6(흑류수해)은 CN 선행이라 공식 현지화가 없다 — 전 로케일이 KR/CN 병기 파일을 공유
const fileFor = (n, locale) =>
  join(ROOT, "app/data", locale === "ko" || n === 6 ? `rogue${n}.json` : `rogue${n}.${locale}.json`);

const index = {};
for (const n of TOPICS) {
  const id = `rogue_${n}`;
  index[id] = {};
  for (const locale of LOCALES) {
    const path = fileFor(n, locale);
    if (!existsSync(path)) continue;
    const d = JSON.parse(readFileSync(path, "utf8"));
    index[id][locale] = {
      name: d.name,
      // line은 3줄짜리 도입문 — 설명·히어로에 그대로 쓴다
      line: (d.line ?? "").replace(/\s*\n\s*/g, " ").trim(),
      zones: (d.zones ?? []).length,
      enemies: Object.keys(d.enemies ?? {}).length,
      relics: (d.relics ?? []).length,
    };
  }
}

writeFileSync(join(ROOT, "app/data/rogue-index.json"), `${JSON.stringify(index, null, 1)}\n`);
const kb = Math.round(JSON.stringify(index).length / 102.4) / 10;
console.log(`rogue-index.json: ${Object.keys(index).length} topics × ${LOCALES.length} locales (${kb}KB)`);
