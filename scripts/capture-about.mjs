// 소개 페이지 스크린샷 재캡처 — 로컬 프로덕션 서버(:3000)를 Playwright로 열어
// 각 기능 화면을 언어(ko/en/ja) × 라이트/다크 × 데스크탑(1200×760)/모바일(440×952)로 찍는다.
// EN/JA 소개 페이지는 그 언어 UI 캡처를 보여준다 (언어별 세트, 사용자 요청 2026-07-22).
// PNG로 받아 <outDir>/{locale}/에 저장하고, convert-about.py가 webp로 변환해
// public/about/(ko는 루트, en·ja는 하위 폴더)에 넣는다.
//   1) npm run start (별도)  2) node scripts/capture-about.mjs <outDir>  3) python3 scripts/convert-about.py <outDir>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";

// 언어 축 — prefix는 라우트(/, /en, /ja), chron은 연대기 탭 버튼 텍스트("테라 연대기" 번역 부분 일치)
const LOCALES = [
  { code: "ko", prefix: "", chron: "연대기" },
  { code: "en", prefix: "/en", chron: "Chronicle" },
  { code: "ja", prefix: "/ja", chron: "年代記" },
];

// name → 캡처 대상. prep은 로드 후 추가 조작(연대기 전환 등). 경로에 로케일 prefix가 붙는다.
const SHOTS = [
  { name: "portal", path: "/" },
  { name: "planner", path: "/infra" },
  { name: "archive", path: "/operators" },
  { name: "recruit", path: "/recruit" },
  { name: "farm", path: "/farm" },
  { name: "upgrade", path: "/upgrade?ops=char_113_cqbw,char_456_ash" },
  { name: "story", path: "/stories" },
  { name: "rogue", path: "/rogue" },
  { name: "chronicle", path: "/stories", prep: async (page, loc) => {
    const btn = page.locator(".story-viewtabs button, .digest-viewtabs button", { hasText: loc.chron });
    if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(600); }
  } },
];

const VIEWPORTS = [
  { key: "d", width: 1200, height: 760, mobile: false },
  { key: "m", width: 440, height: 952, mobile: true },
];

const browser = await chromium.launch();
for (const loc of LOCALES) {
  fs.mkdirSync(path.join(OUT, loc.code), { recursive: true });
  for (const theme of ["light", "dark"]) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        userAgent: vp.mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" : undefined,
      });
      // 첫 페인트 전에 테마 고정 (ta-theme) — 다크/라이트 플래시 방지
      await ctx.addInitScript((t) => { try { localStorage.setItem("ta-theme", t); } catch (e) {} }, theme);
      // 제안 버튼(모바일 헤더 버튼 · PC FAB · 패널)은 소개 스샷에서 감춘다 (사용자 요청 2026-07-22)
      await ctx.addInitScript(() => {
        const css = ".feedback-header-btn,.feedback-fab,.feedback-widget{display:none !important}";
        const inject = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
        if (document.head) inject(); else document.addEventListener("DOMContentLoaded", inject);
      });
      const page = await ctx.newPage();
      for (const shot of SHOTS) {
        // 로케일 prefix를 경로 앞에 — 홈("/")은 prefix 자체가 그 언어 홈("/en", "/ja")
        const target = shot.path === "/" ? (loc.prefix || "/") : loc.prefix + shot.path;
        await page.goto(BASE + target, { waitUntil: "networkidle" });
        await page.waitForTimeout(1800); // 방송·이벤트 fetch + 이미지 로드
        // 헤더를 펼쳐 이벤트·공식방송·토글까지 보여준다(접힘이 기본) — best effort
        try {
          const handle = page.locator(".header-collapse-toggle");
          if (await handle.count() && (await page.locator(".site-header.collapsed").count())) {
            await handle.first().click();
            await page.waitForTimeout(400);
          }
        } catch (e) {}
        if (shot.prep) { try { await shot.prep(page, loc); } catch (e) {} }
        await page.evaluate(() => document.querySelector(".site-scroll")?.scrollTo(0, 0));
        await page.waitForTimeout(300);
        const suffix = vp.key === "d" ? "" : "-m";
        const themeSfx = theme === "dark" ? "-dark" : "";
        const file = path.join(OUT, loc.code, `${shot.name}${suffix}${themeSfx}.png`);
        await page.screenshot({ path: file, clip: { x: 0, y: 0, width: vp.width, height: vp.height } });
        console.log("captured", loc.code + "/" + path.basename(file));
      }
      await ctx.close();
    }
  }
}
await browser.close();
console.log("done");
