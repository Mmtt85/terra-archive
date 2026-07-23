// 오퍼 스캐너 회귀 하네스 — 픽스처 스크린샷에 실제 파이프라인(vision.ts + artmatch.ts)을
// 돌려 지상값(fixtures/scanner/expected/labels.json, 138셀 전수 시각 검증)과 대조한다.
//
// 실행:  npx --yes tsx scripts/verify-scan.ts
// 요구:  python3 + PIL (PNG → RGBA 변환용) · fixtures/scanner/ (git 미추적, 로컬 전용)
// 기준:  식별 100% · 정예화 100% (2026-07-23 확립). 하나라도 어긋나면 exit 1.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanFrame } from "../app/scan/vision";
import { toGray, matchArt, classifyElite } from "../app/scan/artmatch";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "fixtures", "scanner");
const MAX_W = 1600; // scanner.tsx 처리 해상도 상한과 동일해야 한다

if (!existsSync(join(FIX, "expected", "labels.json"))) {
  console.error("fixtures/scanner/expected/labels.json 없음 — 이 하네스는 픽스처 보유 머신 전용");
  process.exit(2);
}
const labels = JSON.parse(readFileSync(join(FIX, "expected", "labels.json"), "utf8")) as {
  frames: { file: string; cells: { row: number; col: number; op: string; name: string; elite: number }[] }[];
};
const maxEliteByOp = new Map<string, number>(
  (JSON.parse(readFileSync(join(ROOT, "app", "data", "operators.json"), "utf8")) as { id: string; rarity: number }[])
    .map((o) => [o.id, o.rarity >= 4 ? 2 : o.rarity === 3 ? 1 : 0]));

const tmp = mkdtempSync(join(tmpdir(), "scanfix-"));
let idOk = 0, idBad = 0, elOk = 0, elBad = 0, missing = 0;
try {
  for (const frame of labels.frames) {
    const png = join(FIX, "screenshots", frame.file);
    const rgba = join(tmp, "f.rgba");
    // PNG → (≤1600px) RGBA — 런타임과 같은 다운스케일 경로
    const dims = execFileSync("python3", ["-c", `
from PIL import Image
im = Image.open(${JSON.stringify(png)}).convert('RGBA')
s = min(1, ${MAX_W} / im.width)
if s < 1: im = im.resize((round(im.width*s), round(im.height*s)), Image.LANCZOS)
open(${JSON.stringify(rgba)}, 'wb').write(im.tobytes())
print(im.width, im.height)`]).toString().trim().split(" ").map(Number);
    const buf = readFileSync(rgba);
    const f = { data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), width: dims[0], height: dims[1] };
    const scan = scanFrame(f);
    const g = toGray(f);
    const found = new Map(scan.cells.map((c) => [`${c.row},${c.col}`, c]));
    for (const want of frame.cells) {
      const cell = found.get(`${want.row},${want.col}`);
      if (!cell) { missing++; console.log(`✗ ${frame.file} r${want.row}c${want.col} ${want.name}: 셀 미검출`); continue; }
      const am = matchArt(g, cell.sx, cell.ry, scan.px);
      if (am?.best.op === want.op) idOk++;
      else { idBad++; console.log(`✗ ${frame.file} r${want.row}c${want.col} 식별 ${want.name} → ${am?.best.op}(${am?.best.score.toFixed(3)})`); }
      const el = classifyElite(g, cell.sx, cell.ry, scan.px);
      const clamped = Math.min(el.elite, maxEliteByOp.get(want.op) ?? 2);
      if (clamped === want.elite) elOk++;
      else { elBad++; console.log(`✗ ${frame.file} r${want.row}c${want.col} 정예화 ${want.name} E${want.elite} → E${clamped} [${el.s1.toFixed(2)}/${el.s2.toFixed(2)}]`); }
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
const total = idOk + idBad + missing;
console.log(`식별 ${idOk}/${total} · 정예화 ${elOk}/${elOk + elBad} · 미검출 ${missing}`);
if (idBad + elBad + missing > 0) process.exit(1);
console.log("✅ 회귀 없음");
