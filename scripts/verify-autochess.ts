// 위수 협의 밴 화면 인식 회귀 하네스 — 실제 파이프라인(카드 격자 → 티어 배지 → 이름 OCR →
// 조합 풀이)을 픽스처에 돌려 기대값과 비교한다.
//
//   npx tsx scripts/verify-autochess.ts        ← 반드시 리포 루트에서 실행
//
// 픽스처: fixtures/lens/screenshots/*.jpg|png (git 미추적, 로컬 전용)
// 기대값: 아래 EXPECT — 행별 티어를 사람이 화면에서 읽어 적은 것.
// 브라우저와의 차이: 업스케일이 canvas drawImage 대신 sharp(lanczos3)라는 점뿐 —
// 격자·배지·이름 매칭·풀이는 app/lens/ 의 같은 함수를 그대로 쓴다.
//
// ⚠ 픽스처가 없으면 **조용히 건너뛴다** (CI·다른 기기에서 실패하지 않게).

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { grayNormalize, upscaleFactor, binarizeGlyph } from "../app/lens/preprocess";
import { findAcCards } from "../app/lens/acvision";
import { buildAcIndex, acBanBands, bandTexts, pickBond } from "../app/lens/acmatch";
import { solveAcBans } from "../app/lens/acsolve";
import { normText } from "../app/lens/match";

const ROOT = resolve(import.meta.dirname ?? __dirname, "..");
const SHOTS = resolve(ROOT, "fixtures/lens/screenshots");

/** 화면에서 사람이 읽은 행별 티어 — 파일명 → { 맹약 이름: 티어들 } */
const EXPECT: Record<string, Record<string, number[]>> = {
  "ban2.jpg": {
    "염국": [5, 5, 4, 1],
    "쉐라그": [6, 4, 3],
    "시라쿠사": [6, 5, 4, 3, 2, 1],
    "정밀": [4, 3, 1, 1],
    "아케인": [6, 5, 4, 1],
  },
};

type Doc = {
  bonds: { id: string; n: string }[];
  chess: { id: string; n: string; op?: string | null; t: number; bonds: string[] }[];
};
const doc = JSON.parse(readFileSync(resolve(ROOT, "app/data/autochess.json"), "utf8")) as Doc;
const idx = buildAcIndex(doc.bonds, normText);
const bondName = Object.fromEntries(doc.bonds.map((b) => [b.id, b.n]));
const R: Record<number, string> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI" };

async function readShot(file: string, worker: Awaited<ReturnType<typeof createWorker>>) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bands = acBanBands(findAcCards(new Uint8ClampedArray(data), info.width, info.height));
  if (!bands.length) return [];
  // 브라우저와 같은 전처리(업스케일 + grayNormalize)
  const sc = upscaleFactor(info.width);
  const W = Math.round(info.width * sc), H = Math.round(info.height * sc);
  const up = new Uint8ClampedArray(
    await sharp(file).resize(W, H, { kernel: "lanczos3" }).ensureAlpha().raw().toBuffer());
  grayNormalize(up);
  const base = sharp(Buffer.from(up), { raw: { width: W, height: H, channels: 4 } });

  await worker.setParameters({ tessedit_pageseg_mode: "11" as never });
  const full = await worker.recognize(await base.clone().png().toBuffer(), {},
    { blocks: true, text: false, hocr: false, tsv: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boxes = ((full.data.lines ?? []) as any[]).map((l) => ({
    text: String(l.text ?? "").trim(),
    x0: (l.bbox?.x0 ?? 0) / W, y0: (l.bbox?.y0 ?? 0) / H,
    x1: (l.bbox?.x1 ?? 0) / W, y1: (l.bbox?.y1 ?? 0) / H,
  })).filter((l) => l.text);

  const used = new Set<string>();
  const rows: { bond: string; tiers: number[] }[] = [];
  for (const b of bands) {
    let bond = pickBond(bandTexts(b, boxes), idx, normText, used);
    if (!bond) {                                  // 이름 자리만 잘라 다시 (이진화 + nearest 확대)
      const x = Math.max(0, Math.round(b.nameRect.x * W)), y = Math.max(0, Math.round(b.nameRect.y * H));
      const cw = Math.min(Math.round(b.nameRect.w * W), W - x);
      const ch = Math.min(Math.round(b.nameRect.h * H), H - y);
      if (cw >= 8 && ch >= 8) {
        const raw = new Uint8ClampedArray(
          await base.clone().extract({ left: x, top: y, width: cw, height: ch }).ensureAlpha().raw().toBuffer());
        binarizeGlyph(raw, 0.55);
        const png = await sharp(Buffer.from(raw), { raw: { width: cw, height: ch, channels: 4 } })
          .resize(cw * 3, ch * 3, { kernel: "nearest" }).png().toBuffer();
        await worker.setParameters({ tessedit_pageseg_mode: "7" as never });
        const rr = await worker.recognize(png, {}, { blocks: false, text: true, hocr: false, tsv: false });
        bond = pickBond((rr.data.text ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
          idx, normText, used);
      }
    }
    if (!bond) continue;
    used.add(bond);
    rows.push({ bond, tiers: b.tiers.slice().sort((p, q) => q - p) });
  }
  return rows;
}

async function main() {
  const files = Object.keys(EXPECT).filter((f) => existsSync(resolve(SHOTS, f)));
  if (!files.length) {
    console.log("픽스처 없음 — 건너뜀 (fixtures/lens/screenshots/ 는 로컬 전용)");
    return;
  }
  const worker = await createWorker("kor");
  let fail = 0;
  for (const f of files) {
    const want = EXPECT[f];
    const rows = await readShot(resolve(SHOTS, f), worker);
    const got: Record<string, number[]> = {};
    for (const r of rows) got[bondName[r.bond] ?? r.bond] = r.tiers;
    console.log(`\n${f} — 행 ${rows.length}/${Object.keys(want).length}`);
    for (const [nm, tiers] of Object.entries(want)) {
      const g = got[nm];
      const ok = g && g.length === tiers.length && g.every((v, i) => v === tiers[i]);
      if (!ok) fail++;
      console.log(`  ${ok ? "✅" : "❌"} ${nm}: ${(g ?? []).map((t) => R[t]).join(" ") || "(못 읽음)"}`
        + (ok ? "" : `   기대 ${tiers.map((t) => R[t]).join(" ")}`));
    }
    for (const nm of Object.keys(got)) {
      if (!(nm in want)) { fail++; console.log(`  ❌ ${nm}: 기대에 없는 행이 잡혔다`); }
    }
    // 풀이도 한 번 돌려 본다 — 관측이 모순이면 해가 0개가 되므로 그 자체가 검사다
    const res = solveAcBans(rows, doc.chess.map((c) => ({ id: c.id, op: c.op ?? "", t: c.t, bonds: c.bonds })));
    const nm = (id: string) => doc.chess.find((c) => c.id === id)?.n ?? id;
    console.log(`  풀이: 해 ${res.solutions}개 · 확정 ${res.sure.length} · 후보 ${res.maybe.length}`);
    if (res.sure.length) console.log(`    확정: ${res.sure.map(nm).join(", ")}`);
    if (rows.length && res.solutions === 0) { fail++; console.log("  ❌ 해가 0개 — 관측이 모순이다"); }
  }
  await worker.terminate();
  console.log(fail ? `\n${fail}건 실패` : "\n전부 통과");
  process.exit(fail ? 1 : 0);
}

main();
