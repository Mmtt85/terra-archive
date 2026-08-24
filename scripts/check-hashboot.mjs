#!/usr/bin/env node
// 딥링크 첫 페인트 가리개 점검 (2026-08-24)
//
// 문제: 프리렌더 HTML은 URL 해시를 볼 수 없어 **언제나 그 페이지의 기본 화면**이 그려져
// 있다. 그래서 딥링크(#item·#story-… 등)로 바로 들어오면 기본 탭이 잠깐 보였다가 딥링크
// 탭으로 튄다. 새 메뉴를 붙일 때마다 이 버그가 되풀이됐다 (사용자 지적 2026-08-24:
// "네댓번정도 고친거 같은데 또 새로운거 나오면서 또 발생하네").
//
// 규약: 마운트 시 해시를 읽어 **무엇을 보여줄지** 정하는 화면은 셋 중 하나를 갖춰야 한다.
//   ① [data-hashswap] 로 해시가 정하는 영역을 감싸고
//   ② useLayoutEffect 안에서 해시를 반영한 뒤
//   ③ document.documentElement.removeAttribute("data-hashboot") 로 가리개를 뗀다
// (①의 가리개는 layout.tsx pre-paint 스크립트 + globals.css html[data-hashboot] 가 건다)
//
// 다른 방식으로 이미 막고 있거나 애초에 해당 없는 파일은 아래 EXEMPT에 **이유와 함께** 적는다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const EXEMPT = {
  "layout.tsx": "가리개를 세우는 pre-paint 스크립트 본인",
  "home.tsx": "옛 해시 탭(#infra 등)은 data-route 가리개로 이미 막고 경로로 치환한다",
  "story.tsx": "#story-<id>는 data-story-detail 가리개 + useLayoutEffect로 이미 막았다",
  "rogue.tsx": "프리렌더가 '불러오는 중' 자리표시자뿐 — 기본 화면이 HTML에 없어 플래시가 없다",
  "sandbox.tsx": "생존연산은 프리렌더 라우트가 없다 (홈에서 lazy로만 뜬다)",
  "sim-launcher.tsx": "시뮬레이터 진입 버튼 — 해시를 쓰기만 하고 화면을 고르지 않는다",
};

const dir = new URL("../app/", import.meta.url).pathname;
const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".tsx")) files.push(p);
  }
};
walk(dir);

const bad = [];
for (const p of files) {
  const rel = p.slice(dir.length);
  const src = readFileSync(p, "utf8");
  if (!/location\.hash/.test(src)) continue;
  if (EXEMPT[rel]) continue;
  const ok = src.includes("data-hashswap")
    && src.includes('removeAttribute("data-hashboot")')
    && src.includes("useLayoutEffect");
  if (!ok) bad.push(rel);
}

if (bad.length) {
  console.error("check-hashboot: 딥링크 첫 페인트 가리개가 없는 화면");
  for (const f of bad) {
    console.error(`  app/${f}`);
  }
  console.error("");
  console.error("  해시로 화면을 고르는 컴포넌트는 세 가지를 갖춰야 합니다:");
  console.error("    1) 해시가 정하는 영역을 <div data-hashswap> 로 감싸기");
  console.error("    2) 해시 반영을 useEffect가 아니라 useLayoutEffect에서 하기");
  console.error('    3) 반영 직후 document.documentElement.removeAttribute("data-hashboot")');
  console.error("  해당 없으면 scripts/check-hashboot.mjs의 EXEMPT에 이유와 함께 적으세요.");
  process.exit(1);
}
console.log(`check-hashboot: ${files.length}개 중 해시 화면 점검 통과`);
