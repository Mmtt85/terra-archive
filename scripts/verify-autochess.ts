// 위수 협의 PRTS 시뮬레이션 회귀 하네스 — 다섯 코어를 한 번에 돈다 (2026-09-07 재가동).
//
//   npx tsx scripts/verify-autochess.ts            ← 반드시 리포 루트에서 (약 2~3분, 텍스트 OCR 이 대부분)
//   npx tsx scripts/verify-autochess.ts --quick    ← 텍스트 OCR 표본 1/3 (약 1분)
//   npx tsx scripts/verify-ac/<grid|bond|face|band|text>.ts   ← 하나만
//
// 픽스처: fixtures/lens/ac-frames/v1|v2/*.png (녹화 프레임 — ffmpeg fps=2 / fps=1) · fixtures/lens/screenshots/
// git 미추적 로컬 전용 — 없으면 각 하네스가 **조용히 건너뛴다** (CI·다른 기기에서 실패하지 않게).
// 정답 라벨은 각 하네스 파일 안의 상수다 (사람이 프레임을 눈으로 보고 확정, 2026-09-07).
// 브라우저와의 차이: 프레임 디코드·브리지 900px 축소가 sharp(lanczos3) 라는 점뿐 — 격자·얼굴·파서·아이콘
// 매칭은 app/lens/ 의 같은 함수를 그대로 쓰고, 크롭·축소는 app/lens/pix.ts 순수 JS 로 양쪽이 같다.

import { verify as grid } from "./verify-ac/grid";
import { verify as bond } from "./verify-ac/bond";
import { verify as face } from "./verify-ac/face";
import { verify as band } from "./verify-ac/band";
import { verify as text } from "./verify-ac/text";

async function main() {
  let pass = 0, fail = 0;
  for (const [label, run] of [["grid", grid], ["bond", bond], ["face", face], ["band", band], ["text", text]] as const) {
    const t0 = Date.now();
    try {
      const r = await run();
      pass += r.pass; fail += r.fail;
      console.log(`\n=== ${r.name ?? label} — pass ${r.pass} · fail ${r.fail} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      for (const l of r.lines) console.log("  " + l);
    } catch (e) {
      fail++;
      console.log(`\n=== ${label} — 하네스 자체가 죽었다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(fail ? `\n${fail}건 실패 (통과 ${pass})` : `\n전부 통과 (${pass}건)`);
  process.exit(fail ? 1 : 0);
}
main();
