#!/usr/bin/env node
// 오퍼 스캐너 실화면 평가 — fixtures/scanner/screenshots/*.png 를 실제 UI(이미지로 테스트)에
// 넣어 인식 결과(window.__scanResult)를 수집한다. expected/<같은이름>.json 이 있으면 대조해
// 식별/정예화/레벨 정확도를 출력하고, 없으면 결과만 나열한다(사람이 스크린샷과 대조).
//   node scripts/eval-scanner.mjs           # 서버(:3000) 필요 — npm run start
// expected 형식: [{ "name": "실버애쉬", "elite": 2, "level": 90 }, ...] (화면에 보이는 완전한 카드만)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, "fixtures/scanner/screenshots");
const EXPECTED = path.join(ROOT, "fixtures/scanner/expected");

const files = fs.readdirSync(SHOTS).filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
if (!files.length) { console.error("스크린샷 없음:", SHOTS); process.exit(1); }

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
await p.goto("http://localhost:3000/infra", { waitUntil: "networkidle" });
await p.waitForSelector(".capture-btn", { timeout: 30000 });
await p.locator(".capture-btn").click();
await p.waitForSelector(".capture-modal", { timeout: 5000 });

const summary = [];
for (const f of files) {
  await p.evaluate(() => { delete window.__scanResult; });
  await p.setInputFiles(".capture-modal input[type=file]", path.join(SHOTS, f));
  await p.waitForFunction(() => !!window.__scanResult, { timeout: 300000 });
  const res = await p.evaluate(() => window.__scanResult);
  console.log(`\n=== ${f} — 인식 ${res.length}건`);
  for (const r of res.sort((a, b2) => a.name.localeCompare(b2.name, "ko"))) {
    console.log(`  ${r.identifiedBy === "image" ? "📷" : "  "} ${r.name}  E${r.elite ?? "?"} Lv${r.level ?? "?"}  (op ${r.confidence.operator} · e ${r.confidence.elite} · l ${r.confidence.level})`);
  }
  const expFile = path.join(EXPECTED, f.replace(/\.(png|jpg|jpeg)$/i, ".json"));
  if (fs.existsSync(expFile)) {
    const exp = JSON.parse(fs.readFileSync(expFile, "utf8"));
    const byName = new Map(res.map((r) => [r.name, r]));
    let id = 0, el = 0, lv = 0;
    const missed = [];
    for (const e of exp) {
      const got = byName.get(e.name);
      if (!got) { missed.push(e.name); continue; }
      id += 1;
      if (got.elite === e.elite) el += 1;
      if (got.level === e.level) lv += 1;
    }
    const extra = res.filter((r) => !exp.some((e) => e.name === r.name)).map((r) => r.name);
    console.log(`  → 식별 ${id}/${exp.length} · 정예화 ${el}/${id} · 레벨 ${lv}/${id} · 누락 [${missed.join(",")}] · 과검출 [${extra.join(",")}]`);
    summary.push({ f, id, total: exp.length, el, lv, extra: extra.length });
  }
}
if (summary.length) {
  const tid = summary.reduce((s, x) => s + x.id, 0), tt = summary.reduce((s, x) => s + x.total, 0);
  console.log(`\n총계: 식별 ${tid}/${tt} (${Math.round(tid / tt * 100)}%)`);
}
console.log("페이지 에러:", errs.length ? errs.slice(0, 3) : "없음");
await b.close();
