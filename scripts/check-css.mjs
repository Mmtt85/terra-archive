#!/usr/bin/env node
// CSS 정적 검사 — **조용히 버려지는 무효 선언**을 빌드에서 잡는다.
//
// 왜 필요한가 (2026-08-23, 사용자 지적 "폰트 inherit 관련 에러가 한 달째 계속 발생"):
// `font: inherit`은 버튼 리셋의 정석이라 globals.css에 30곳 넘게 정당하게 쓰인다. 그래서
// 버튼 글자를 줄일 때 그 줄에 크기를 얹어 `font: 700 11px/1 inherit`으로 고치는 게 자연스러워
// 보이는데, 이건 **무효**다 — CSS 전역 키워드(inherit/initial/unset/revert)는 단축 속성의
// '전체 값'으로만 쓸 수 있고 구성요소 자리에는 못 온다. 파서는 에러를 내지 않고 그 선언
// 하나를 통째로 버리므로, 빌드는 통과하고 글자만 기본값(16px)으로 남는다.
// 사람 눈으로는 "좀 큰데?" 수준이라 리뷰도 통과한다 — 그래서 주석으로 두 번 경고해도 재발했다.
// 침묵하는 실패는 주석이 아니라 검사로 막는다.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const GLOBAL_KW = /\b(inherit|initial|unset|revert|revert-layer)\b/;
/** 전역 키워드를 허용하는 유일한 형태: 값 전체가 그 키워드 하나뿐 */
const ONLY_KW = /^(inherit|initial|unset|revert|revert-layer)$/;
/** 값이 여러 조각인 단축 속성들 — 여기에 전역 키워드가 섞이면 선언이 통째로 버려진다 */
const SHORTHANDS = [
  "font", "background", "border", "margin", "padding", "flex", "grid", "grid-area",
  "transition", "animation", "list-style", "outline", "overflow", "place-items",
  "place-content", "place-self", "gap", "inset", "mask", "text-decoration",
];

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".css")) files.push(p);
  }
};
walk("app");

const bad = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  // 주석은 검사 대상이 아니다 (경고 주석 자체가 패턴을 담고 있다)
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  // ⚠ 줄 단위로 보면 `.x { font: … }`처럼 한 줄에 쓴 규칙을 놓친다 — 파일 전체를 훑는다
  const re = /(^|[;{}])\s*([a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const prop = m[2];
    const value = m[3].trim();
    if (!SHORTHANDS.includes(prop)) continue;
    if (!GLOBAL_KW.test(value) || ONLY_KW.test(value)) continue;
    const line = stripped.slice(0, m.index).split("\n").length;
    bad.push({ file, line, text: `${prop}: ${value};` });
  }
}

if (bad.length) {
  console.error(`\n✖ 무효 CSS 선언 ${bad.length}건 — 단축 속성에 전역 키워드(inherit 등)를 섞었습니다.`);
  console.error("  브라우저가 이 선언을 조용히 버려서, 지정한 값이 아니라 기본값이 나옵니다.");
  console.error("  롱핸드로 나눠 쓰세요 (예: font-size / font-weight / line-height).\n");
  for (const b of bad) console.error(`  ${b.file}:${b.line}  ${b.text}`);
  console.error("");
  process.exit(1);
}
console.log(`check-css: ${files.length}개 파일 통과`);
