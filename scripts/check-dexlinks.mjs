#!/usr/bin/env node
// 도감 사이 겹침 모달의 **콜백 누락** 점검 (2026-09-17)
//
// 문제: 적·작전·아이템 상세 본문(EnemyFile·StageFile·ItemFile)은 표현부일 뿐이라
// "옆 도감으로 넘어가는 길"을 전부 props로 받는다. 그런데 새 화면이 이 본문을 가져다
// 쓸 때마다 그 props를 **말없이 빠뜨렸고**, 빠뜨려도 타입은 통과하고 화면도 멀쩡해 보인다.
// 증상이 눈에 띄는 건 사용자가 눌러 봤을 때다. 실제로 세 번 터졌다:
//
//   · 2026-08-13 생존연산 — nameOf 누락 → '연계 소환'에 적 **id가 날것으로** 찍혔다
//   · 2026-09-17 이벤트 도감 — onOpenItem 누락 → 드랍 칩이 disabled 로 죽었다
//   · 2026-09-17 이벤트 도감 — nameOf·onOpenEnemy 누락 → `enemy_1588_ubbphw` 가 그대로 보이고
//     눌렀더니 모달이 아니라 적 상세 **페이지로 튕겨 나갔다** (사용자 제보 "파블로비치, 추밀관")
//
// 규약: 모달 안에서 이 본문들을 쓰면 아래 필수 props를 **전부** 넘긴다.
//   EnemyFile — nameOf(연계 소환 이름) · onOpenEnemy(연계 소환 열기)
//   StageFile — onOpenEnemy(등장 적 열기)
// (StageFile의 onOpenItem·EnemyFile의 onOpenStage는 없어도 링크로 폴백하므로 안 본다.
//  드랍 칩은 2026-09-17부터 <a href=아이템도감>이고, 등장 작전 절은 stagesDoc이 있어야 뜬다.)
//
// 정적 **페이지**처럼 모달을 열 수 없어 링크 폴백이 맞는 자리는 EXEMPT에 이유와 함께 적는다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** 파일:컴포넌트 → 빠져도 되는 이유 */
const EXEMPT = {
  "enemy-detail.tsx:EnemyFile": "EnemyPage(정적 /enemies/<id>) — 연계 소환은 그 적의 페이지로 가는 게 맞다",
};

/** 컴포넌트 → 반드시 넘겨야 하는 props */
const NEED = {
  EnemyFile: ["nameOf", "onOpenEnemy"],
  StageFile: ["onOpenEnemy"],
};

const dir = join(process.cwd(), "app");
const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".tsx")) files.push(p);
  }
};
walk(dir);

const tag = new RegExp(`<(${Object.keys(NEED).join("|")})\\b([\\s\\S]*?)/>`, "g");
const bad = [];
for (const p of files) {
  const rel = p.slice(dir.length + 1);
  const src = readFileSync(p, "utf8");
  for (const m of src.matchAll(tag)) {
    const [, comp, body] = m;
    if (EXEMPT[`${rel}:${comp}`]) continue;
    const miss = NEED[comp].filter((prop) => !body.includes(`${prop}=`));
    if (miss.length) {
      bad.push({ rel, comp, miss, line: src.slice(0, m.index).split("\n").length });
    }
  }
}

if (bad.length) {
  console.error("check-dexlinks: 도감 겹침 모달의 필수 콜백이 빠졌습니다");
  for (const b of bad) console.error(`  app/${b.rel}:${b.line}  <${b.comp}> — ${b.miss.join(", ")}`);
  console.error("");
  console.error("  nameOf      : 연계 소환 적의 이름. 안 넘기면 enemy_1588_ubbphw 같은 id가 그대로 보입니다.");
  console.error("                dex-cross.loadEnemies 로 받은 맵을 그대로 물고 (id) => map?.get(id)?.name 로 넘기세요.");
  console.error("  onOpenEnemy : 적을 **모달로** 엽니다. 안 넘기면 눌렀을 때 적 상세 페이지로 화면이 통째로 넘어갑니다.");
  console.error("  모달이 아니라 정적 페이지라 링크 폴백이 맞는 자리면 scripts/check-dexlinks.mjs의 EXEMPT에 이유와 함께 적으세요.");
  process.exit(1);
}
console.log(`check-dexlinks: 도감 겹침 모달 점검 통과`);
