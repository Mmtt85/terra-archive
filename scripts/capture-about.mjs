// 소개 페이지 스크린샷 재캡처 — 로컬 프로덕션 서버(:3000)를 Playwright로 열어
// 각 기능 화면을 라이트/다크 × 데스크탑(1200×760)/모바일(440×952)로 찍는다.
// PNG로 받아 scratchpad에 저장하고, convert-about.py가 webp로 변환해 public/about/에 넣는다.
//   1) npm run start (별도)  2) node scripts/capture-about.mjs <outDir>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";

// name → 캡처 대상. prep은 로드 후 추가 조작(계산기 채우기·연대기 전환 등).
const SHOTS = [
  { name: "portal", path: "/" },
  { name: "planner", path: "/infra" },
  { name: "archive", path: "/operators" },
  { name: "recruit", path: "/recruit" },
  { name: "farm", path: "/farm" },
  { name: "upgrade", path: "/upgrade?ops=char_113_cqbw,char_456_ash" },
  { name: "story", path: "/stories" },
  { name: "rogue", path: "/rogue" },
  { name: "chronicle", path: "/stories", prep: async (page) => {
    const btn = page.locator(".story-viewtabs button, .digest-viewtabs button", { hasText: "연대기" });
    if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(600); }
  } },
];

const VIEWPORTS = [
  { key: "d", width: 1200, height: 760, mobile: false },
  { key: "m", width: 440, height: 952, mobile: true },
];

const browser = await chromium.launch();
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
      await page.goto(BASE + shot.path, { waitUntil: "networkidle" });
      await page.waitForTimeout(1800); // 방송·이벤트 fetch + 이미지 로드
      // 헤더를 펼쳐 이벤트·공식방송·토글까지 보여준다(접힘이 기본) — best effort
      try {
        const handle = page.locator(".header-collapse-toggle");
        if (await handle.count() && (await page.locator(".site-header.collapsed").count())) {
          await handle.first().click();
          await page.waitForTimeout(400);
        }
      } catch (e) {}
      if (shot.prep) { try { await shot.prep(page); } catch (e) {} }
      await page.evaluate(() => document.querySelector(".site-scroll")?.scrollTo(0, 0));
      await page.waitForTimeout(300);
      const suffix = vp.key === "d" ? "" : "-m";
      const themeSfx = theme === "dark" ? "-dark" : "";
      const file = path.join(OUT, `${shot.name}${suffix}${themeSfx}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: vp.width, height: vp.height } });
      console.log("captured", path.basename(file));
    }
    await ctx.close();
  }
}
await browser.close();
console.log("done");
