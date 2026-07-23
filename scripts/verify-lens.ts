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
import { grayNormalize, upscaleFactor, findDarkChips, chipCropRect, binarizeGlyph } from "../app/lens/preprocess";
import { DIFF_REGION, parseDifficulty } from "../app/lens/ocr";
import { buildIndex, analyzeLines, analyzeRecruit, wantsChipPass } from "../app/lens/match";

const ROOT = resolve(import.meta.dirname ?? __dirname, "..");
const SHOTS = resolve(ROOT, "fixtures/lens/screenshots");
const EXPECTED = resolve(ROOT, "fixtures/lens/expected.json");

type Expect = {
  mode?: "rogue" | "recruit"; // 페이지별 설치 — 어느 모달로 인식하는지 (기본 rogue)
  section: string;
  targetKind: "goto" | "tie" | "none";
  topic?: string;
  modalType?: string;
  entities?: string[];
  page?: string;    // "recruit" 등 — goto 페이지 검증
  tags?: string[];  // 공개모집: 자동 입력돼야 할 태그 (정확히 일치)
  grade?: number;   // 좌하단 난이도 배지 — 미지정이면 "인식되지 않아야" 한다 (오탐 검출)
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
  const recruitTags: string[] = JSON.parse(readFileSync(resolve(ROOT, "app/data/recruit.json"), "utf8"))
    .tags.map((tg: { name: string }) => tg.name);
  console.log(`인덱스: ${index.entries.length}개 엔티티 (${topics.length}토픽) + 공개모집 태그 ${recruitTags.length}개`);

  const worker = await createWorker("kor", 1, {
    langPath: resolve(ROOT, "public/lens"),
    cachePath: resolve(ROOT, "public/lens"),
    gzip: false,
  });
  // 난이도 배지 숫자 전용 eng 워커 (kor은 단독 숫자를 한글로 오독)
  const digitWorker = await createWorker("eng", 1, {
    langPath: resolve(ROOT, "public/lens"),
    cachePath: resolve(ROOT, "public/lens"),
    gzip: false,
  });
  await digitWorker.setParameters({ tessedit_pageseg_mode: "7" as never });

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

    // OCR — lens.tsx와 동일한 단계형: PSM11 → (모집 키워드 시) 칩 PSM7 → 판정 →
    // none일 때만 PSM3(+미실행 칩) 폴백. 속도 최적화가 하네스에서도 측정되게 한다.
    const chipPass = async (): Promise<string[]> => {
      const chips = findDarkChips(data, info.width, info.height);
      if (!chips.length) return [];
      await worker.setParameters({ tessedit_pageseg_mode: "7" as never });
      const out: string[] = [];
      for (const b of chips) {
        const r = chipCropRect(b, info.width, info.height);
        if (!r) continue;
        const cbuf = await sharp(buf).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).png().toBuffer();
        const r7 = await worker.recognize(cbuf, {}, { blocks: false, text: true, hocr: false, tsv: false });
        const txt = (r7.data.text ?? "").trim();
        if (txt) out.push(...txt.split("\n").map((l) => l.trim()).filter(Boolean));
      }
      return out;
    };
    const fullPass = async (psm: string): Promise<string[]> => {
      await worker.setParameters({ tessedit_pageseg_mode: psm as never });
      const r = await worker.recognize(buf, {}, { blocks: true, text: false, hocr: false, tsv: false });
      return (r.data.lines ?? []).map((l) => l.text.trim()).filter(Boolean);
    };
    // 모드별 흐름 — lens.tsx와 동일하게
    let oc;
    if (exp.mode === "recruit") {
      // 태그는 어두운 버튼 칩이 본체 — 칩 + 전체 프레임 보조
      const lines = (await chipPass()).concat(await fullPass("11"));
      oc = analyzeRecruit(lines, recruitTags);
    } else {
      // 프로덕션 rogue 모드는 항상 현재 토픽 컨텍스트가 있다 — 사미 페이지에서 찍는 상황을 재현
      const ctx = { context: { topic: "rogue_3" } };
      let lines = await fullPass("11");
      let chipsRan = false;
      if (wantsChipPass(lines)) { chipsRan = true; lines = lines.concat(await chipPass()); }
      oc = analyzeLines(lines, index, ctx);
      // run.ts와 동일: none·tie 또는 하이라이트형 goto(엔티티 완성도)면 폴백 보강
      const needMore = oc.target.kind !== "goto"
        || (oc.target.goto.page === "rogue" && !oc.target.goto.modal && !!oc.target.goto.highlight);
      if (needMore) {
        lines = lines.concat(await fullPass("3"));
        if (!chipsRan) lines = lines.concat(await chipPass());
        oc = analyzeLines(lines, index, ctx);
      }
      // 좌하단 난이도 배지 — ocr.ts session.difficulty()와 동일: 크롭→4x→글리프 이진화→eng OCR
      if (oc.target.kind !== "none") {
        const dx = Math.round(info.width * DIFF_REGION.x), dy = Math.round(info.height * DIFF_REGION.y);
        const dw = Math.round(info.width * DIFF_REGION.w), dh = Math.min(Math.round(info.height * DIFF_REGION.h), info.height - dy);
        // 1:1 이진화 → nearest 4x (ocr.ts와 동일 — 리샘플링 결정적)
        const { data: cd, info: ci } = await sharp(buf).extract({ left: dx, top: dy, width: dw, height: dh })
          .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        binarizeGlyph(cd);
        const dbuf = await sharp(cd, { raw: { width: ci.width, height: ci.height, channels: 4 } })
          .resize({ width: ci.width * 4, kernel: "nearest" }).png().toBuffer();
        const rd = await digitWorker.recognize(dbuf, {}, { blocks: false, text: true, hocr: false, tsv: false });
        const grade = parseDifficulty(rd.data.text ?? "", rd.data.confidence ?? 0);
        if (grade !== null) {
          if (oc.target.kind === "goto" && oc.target.goto.page === "rogue") oc.target.goto.grade = grade;
          else if (oc.target.kind === "tie") for (const o of oc.target.options) { if (o.goto.page === "rogue") o.goto.grade = grade; }
        }
      }
    }
    const errs: string[] = [];
    if (oc.section !== exp.section) errs.push(`섹션 ${oc.section} ≠ 기대 ${exp.section}`);
    if (oc.target.kind !== exp.targetKind) errs.push(`타깃 ${oc.target.kind} ≠ 기대 ${exp.targetKind}`);
    if (oc.target.kind === "goto") {
      const g = oc.target.goto;
      if (exp.page && g.page !== exp.page) errs.push(`페이지 ${g.page} ≠ 기대 ${exp.page}`);
      if (g.page === "rogue") {
        if (exp.topic && g.topic !== exp.topic) errs.push(`토픽 ${g.topic} ≠ 기대 ${exp.topic}`);
        if (exp.modalType && g.modal?.type !== exp.modalType) errs.push(`모달 ${g.modal?.type ?? "(없음)"} ≠ 기대 ${exp.modalType}`);
        if (g.grade !== exp.grade) errs.push(`난이도 ${g.grade ?? "(없음)"} ≠ 기대 ${exp.grade ?? "(없음)"}`);
      } else if (g.page === "recruit" && exp.tags) {
        const got = [...g.tags].sort().join(",");
        const want = [...exp.tags].sort().join(",");
        if (got !== want) errs.push(`태그 [${got}] ≠ 기대 [${want}]`);
      }
    }
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
  await digitWorker.terminate();
  console.log(`\n결과: ${pass}/${pass + fail} 통과${skipped ? ` (건너뜀 ${skipped})` : ""}`);
  if (pass + fail === 0) process.exit(2);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
