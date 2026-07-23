// 스크린샷 렌즈 회귀 하네스 — 실제 파이프라인(전처리→OCR→매칭)을 픽스처에 돌려 기대값과 비교.
//
//   npx tsx scripts/verify-lens.ts        ← 반드시 리포 루트에서 실행
//
// 픽스처: fixtures/lens/screenshots/*.png (git 미추적, 로컬 전용)
// 기대값: fixtures/lens/expected.json
// 브라우저와의 차이: 업스케일이 canvas drawImage 대신 sharp(lanczos3)라는 점뿐 —
// 그레이+정규화는 app/lens/preprocess.ts를 그대로 공유한다.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { grayNormalize, upscaleFactor } from "../app/lens/preprocess";
import { buildIndex, analyzeLines } from "../app/lens/match";

const ROOT = resolve(import.meta.dirname ?? __dirname, "..");
const SHOTS = resolve(ROOT, "fixtures/lens/screenshots");
const EXPECTED = resolve(ROOT, "fixtures/lens/expected.json");

type Expect = {
  section: string;
  targetKind: "goto" | "tie" | "none";
  topic?: string;
  modalType?: string;
  entities?: string[];
};

async function main() {
  if (!existsSync(SHOTS) || !existsSync(EXPECTED)) {
    console.error("픽스처가 없습니다 — fixtures/lens/{screenshots,expected.json} 필요 (로컬 전용, git 미추적)");
    process.exit(2);
  }
  const expected: Record<string, Expect> = JSON.parse(readFileSync(EXPECTED, "utf8"));

  // 인덱스 — 브라우저(lens.tsx getIndex)와 동일하게 rogue1..6 전체
  const topics = [1, 2, 3, 4, 5, 6]
    .map((i) => resolve(ROOT, `app/data/rogue${i}.json`))
    .filter((p) => existsSync(p))
    .map((p) => JSON.parse(readFileSync(p, "utf8")));
  const index = buildIndex(topics);
  console.log(`인덱스: ${index.entries.length}개 엔티티 (${topics.length}토픽)`);

  const worker = await createWorker("kor", 1, {
    langPath: resolve(ROOT, "public/lens"),
    cachePath: resolve(ROOT, "public/lens"),
    gzip: false,
  });

  let pass = 0, fail = 0, skipped = 0;
  const files = readdirSync(SHOTS).filter((f) => f.endsWith(".png")).sort();
  for (const png of files) {
    const exp = expected[png];
    if (!exp) { skipped++; console.log(`— ${png}: 기대값 없음, 건너뜀`); continue; }
    const t0 = Date.now();

    // 전처리 — preprocess.ts 공유 (업스케일만 sharp)
    const src = sharp(resolve(SHOTS, png));
    const meta = await src.metadata();
    const scale = upscaleFactor(meta.width ?? 0);
    const { data, info } = await src
      .resize({ width: (meta.width ?? 0) * scale, kernel: "lanczos3" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    grayNormalize(data);
    const buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();

    // OCR — PSM11(sparse)+PSM3(auto) 라인 합집합 (ocr.ts와 동일)
    await worker.setParameters({ tessedit_pageseg_mode: "11" as never });
    const r11 = await worker.recognize(buf);
    await worker.setParameters({ tessedit_pageseg_mode: "3" as never });
    const r3 = await worker.recognize(buf);
    const lines = [...(r11.data.lines ?? []), ...(r3.data.lines ?? [])].map((l) => l.text.trim()).filter(Boolean);

    const oc = analyzeLines(lines, index);
    const errs: string[] = [];
    if (oc.section !== exp.section) errs.push(`섹션 ${oc.section} ≠ 기대 ${exp.section}`);
    if (oc.target.kind !== exp.targetKind) errs.push(`타깃 ${oc.target.kind} ≠ 기대 ${exp.targetKind}`);
    if (exp.topic && oc.target.kind === "goto" && oc.target.goto.topic !== exp.topic)
      errs.push(`토픽 ${oc.target.goto.topic} ≠ 기대 ${exp.topic}`);
    if (exp.modalType && oc.target.kind === "goto" && oc.target.goto.modal?.type !== exp.modalType)
      errs.push(`모달 ${oc.target.goto.modal?.type ?? "(없음)"} ≠ 기대 ${exp.modalType}`);
    for (const name of exp.entities ?? []) {
      if (!oc.entities.some((e) => e.name === name)) errs.push(`엔티티 미검출: ${name}`);
    }

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (errs.length === 0) {
      pass++;
      const top = oc.entities[0];
      console.log(`✓ ${png} (${secs}s) — ${oc.target.kind}/${oc.section}${top ? ` · ${top.name}` : ""}`);
    } else {
      fail++;
      console.log(`✗ ${png} (${secs}s) — ${errs.join(" / ")}`);
    }
  }

  await worker.terminate();
  console.log(`\n결과: ${pass}/${pass + fail} 통과${skipped ? ` (건너뜀 ${skipped})` : ""}`);
  if (pass + fail === 0) process.exit(2);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
