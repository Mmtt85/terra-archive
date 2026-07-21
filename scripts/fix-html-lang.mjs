// 정적 내보내기 후처리 — /en·/ja HTML의 <html lang>을 실제 로케일로 교정한다.
// 루트 레이아웃이 전 로케일 공유(output:"export"라 라우트별 <html> 분리 불가)라서
// 서버 HTML은 전부 lang="ko"로 나온다. 하이드레이션 후 JS가 바꿔주긴 하지만(home.tsx)
// 크롤러가 처음 받는 원문 HTML엔 "영어/일본어 페이지인데 문서 언어는 한국어"라는
// 모순 신호가 남는다 (2026-07 EN/JA 구글 색인 문제). npm run build 마지막에 실행.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "dist", "client");
const LOCALES = { en: "en", ja: "ja" };

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(p);
    else if (entry.name.endsWith(".html")) yield p;
  }
}

let total = 0;
for (const [seg, lang] of Object.entries(LOCALES)) {
  let count = 0;
  // 로케일 루트는 디렉터리가 아니라 평면 파일(dist/client/en.html)로 나온다 — 누락 금지
  for (const file of [join(ROOT, `${seg}.html`), ...htmlFiles(join(ROOT, seg))]) {
    const html = readFileSync(file, "utf8");
    const fixed = html.replace(/<html lang="ko"/, `<html lang="${lang}"`);
    if (fixed !== html) {
      writeFileSync(file, fixed);
      count++;
    }
  }
  if (count === 0) throw new Error(`fix-html-lang: ${seg}/ 에서 교정된 파일이 0개 — 출력 구조가 바뀌었는지 확인`);
  console.log(`fix-html-lang: /${seg} ${count}개 파일 lang="${lang}" 적용`);
  total += count;
}
console.log(`fix-html-lang: 총 ${total}개 완료`);
