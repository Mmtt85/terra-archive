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

// ── 경고 (빌드를 멈추지 않는다) — 디자인 규칙이 조용히 무너지는 것을 알린다 (2026-10-14) ──────────────
// 2026-09-19 에 글자 크기를 12단계로 정리했는데 한 달 만에 반값(10.5·11.5·12.5px)이 110곳 넘게 다시 쌓였고,
// 라이트 바탕 위 라임 글자·선(종이 위 1.5:1 — 안 보인다)도 고칠 때마다 빠진 곳이 남았다.
// 규칙 정본: docs/PROJECT-GUIDE.md §8 '색 토큰 규칙' · 디자인 시스템 Artifact.
const FONT_STEPS = new Set([8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 26, 30, 34, 64, 92, 190]);   // 8 미니 배지 · 34 연대기 연도 · 64 404 코드 · 92 포탈 숫자 · 190 홈 워터마크
const FONT_EXEMPT = /\.me-share|\.vzr|\.admin|@keyframes/;                          // 이미지 내보내기·관리자 리포트
// 어두운 바탕이 확실한 규칙 — 다크·통합전략·리더기·공유 이미지
const DARK_SCOPE = /html\.dark|^\.dark|\.dark |rg-theme|^\.rg\b|\.rg-|\.rg\d|\.vn-|\.me-share|lens-hit/;
const warns = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let r;
  while ((r = rule.exec(stripped)) !== null) {
    const sel = r[1].replace(/\s+/g, " ").trim();
    const body = r[2];
    const line = stripped.slice(0, r.index + r[1].length).split("\n").length;
    // ① 글자 크기 단계
    if (!FONT_EXEMPT.test(sel)) {
      for (const d of body.matchAll(/(?:^|;)\s*(font-size|font)\s*:\s*([^;]+)/g)) {
        const px = d[1] === "font-size" ? /^([\d.]+)px/.exec(d[2].trim()) : /(?:^|\s)([\d.]+)px/.exec(d[2]);
        if (px && !FONT_STEPS.has(Number(px[1]))) warns.push(`${file}:${line}  글자 크기 ${px[1]}px — 단계(9·10·11·12·13·14·16·18·20·22·26·30) 밖  (${sel.slice(0, 60)})`);
      }
    }
    // ② 밝은 바탕 위 라임 글자·선
    if (DARK_SCOPE.test(sel.replace(/:not\(\.(dark|rg-theme)\)/g, ""))) continue;
    if (src.slice(r.index, r.index + r[0].length).includes("lime-ok")) continue;   // 어두운 칩 위 등 일부러 쓴 곳
    for (const d of body.matchAll(/(?:^|;)\s*(color|border[a-z-]*|outline[a-z-]*|box-shadow)\s*:\s*([^;]+)/g)) {
      // 다른 토큰의 대체값 자리(var(--lime-ink, var(--lime)))는 빼고 본다
      if (/var\(--lime[,)]/.test(d[2].replace(/var\(--(lime-ink|lime-line|tab-line)\s*,[^)]*\)\)?/g, ""))) warns.push(`${file}:${line}  밝은 바탕 위 var(--lime) ${d[1]} — 글자는 --lime-ink, 선은 --lime-line (어두운 칩 위면 규칙에 /* lime-ok */)  (${sel.slice(0, 50)})`);
    }
  }
}
if (warns.length) {
  console.warn(`\n⚠ 디자인 규칙 경고 ${warns.length}건 (빌드는 계속):`);
  for (const w of warns) console.warn("  " + w);
  console.warn("");
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
