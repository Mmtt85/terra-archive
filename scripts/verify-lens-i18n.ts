// 스샷 레이더 EN/JA 매칭 회귀 — OCR 없이 매칭 코어만 검증.
//
//   npx tsx scripts/verify-lens-i18n.ts   ← 리포 루트에서 실행
//
// 방식: rogue*.<loc>.json 을 로케일 정규화기로 인덱싱하고, 각 엔티티의 "이름"을 완벽한
// OCR 라인이라 가정해 analyzeLines에 넣어, 그 엔티티가 올바른 토픽으로 인식되는지 본다.
// 스크린샷·OCR 품질은 검증하지 않는다(그건 verify-lens.ts + 실기기) — 이 테스트는
// ① 로케일 정규화(JA 가나·한자 보존, EN 소문자) ② 인덱스 구축 ③ 이름 매칭·토픽 투표
// ④ rogue_6(흑류수해) CN 원문이 EN/JA 인덱스에서도 살아 중국어 패스로 잡히는지를 지킨다.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildIndex, analyzeLines, analyzeChinese, normFor } from "../app/lens/match";

const ROOT = resolve(import.meta.dirname ?? __dirname, "..");
const load = (name: string) => JSON.parse(readFileSync(resolve(ROOT, "app/data", name), "utf8"));

// 로케일별 데이터 세트 — 사이트 loadersFor(locale)와 동일. rogue_6은 전 로케일 rogue6.json 공유.
const SETS: Record<string, string[]> = {
  en: ["rogue1.en.json", "rogue2.en.json", "rogue3.en.json", "rogue4.en.json", "rogue5.en.json", "rogue6.json"],
  ja: ["rogue1.ja.json", "rogue2.ja.json", "rogue3.ja.json", "rogue4.ja.json", "rogue5.ja.json", "rogue6.json"],
};

// 한 토픽에서 '해석 가능한(다른 토픽과 겹치지 않는 이름)' 엔티티를 섹션별로 골라 표본 케이스로.
type Topic = { id: string; name: string; stages?: Ent[]; relics?: Ent[]; encounters?: (Ent & { scene?: string; title?: string })[] };
type Ent = { id: string; name?: string; title?: string; scene?: string };

function main() {
  let pass = 0, fail = 0;
  const fails: string[] = [];

  for (const [loc, files] of Object.entries(SETS)) {
    const missing = files.filter((f) => !existsSync(resolve(ROOT, "app/data", f)));
    if (missing.length) { console.log(`— ${loc}: 데이터 없음 (${missing.join(", ")}), 건너뜀`); continue; }
    const norm = normFor(loc);
    const topics: Topic[] = files.map(load);
    const index = buildIndex(topics, norm);

    // 이름 정규화값 → 그 값을 이름으로 가진 (topic,id) 집합. 유일할 때만 케이스로 쓴다.
    const nameOwners = new Map<string, Set<string>>();
    for (const e of index.entries) {
      if (!e.nameN || e.nameN.length < 3) continue;
      (nameOwners.get(e.nameN) ?? nameOwners.set(e.nameN, new Set()).get(e.nameN)!).add(e.topic);
    }

    // 각 토픽에서 stage·relic·encounter 중 이름이 '전 토픽 유일'인 첫 항목을 케이스로 (토픽당 최대 3개)
    const cases: { topic: string; name: string; section: string }[] = [];
    for (const d of topics) {
      if (d.id === "rogue_6") continue; // rogue_6은 CN 경로에서 따로 검증
      let picked = 0;
      const pools: [string, Ent[]][] = [
        ["stage", d.stages ?? []],
        ["relic", d.relics ?? []],
        ["enc", (d.encounters ?? []) as Ent[]],
      ];
      for (const [section, pool] of pools) {
        for (const it of pool) {
          const raw = it.name ?? it.title ?? "";
          const n = norm(raw);
          if (n.length < 3) continue;
          if (nameOwners.get(n)?.size !== 1) continue; // 다른 토픽과 겹치는 이름은 스킵(정상적 tie)
          cases.push({ topic: d.id, name: raw, section });
          picked++;
          break;
        }
        if (picked >= 3) break;
      }
    }

    let locPass = 0;
    for (const c of cases) {
      // 완벽한 OCR 한 줄이라 가정 — 이름만 넣어도 해당 토픽·엔티티가 잡혀야 한다
      const oc = analyzeLines([c.name], index, { context: { topic: c.topic }, norm });
      const hit = oc.entities.find((e) => e.name === c.name && e.topic === c.topic);
      const topicOk = oc.topics[0]?.topic === c.topic;
      if (hit && topicOk) { pass++; locPass++; }
      else { fail++; fails.push(`[${loc}] ${c.topic}/${c.section} "${c.name}" → 엔티티 ${hit ? "OK" : "미검출"}, 토픽 ${oc.topics[0]?.topic ?? "(없음)"}`); }
    }
    console.log(`${loc}: ${locPass}/${cases.length} 케이스 통과 (인덱스 ${index.entries.length} 엔티티)`);
  }

  // rogue_6(흑류수해) CN 원문 — EN/JA 인덱스에서도 cnN이 살아 중국어 패스가 잡아야 한다.
  const r6 = load("rogue6.json");
  const cnNames: string[] = [
    ...(r6.stages ?? []), ...(r6.relics ?? []), ...(r6.encounters ?? []),
  ].map((e: { cn?: string }) => e.cn).filter((s): s is string => typeof s === "string" && s.length >= 3).slice(0, 8);
  for (const loc of ["en", "ja"]) {
    if (!SETS[loc]) continue;
    const index = buildIndex(SETS[loc].map(load), normFor(loc));
    let cnPass = 0, cnTot = 0;
    for (const cn of cnNames) {
      cnTot++;
      const oc = analyzeChinese([cn], index);
      if (oc.target.kind !== "none" && oc.topics[0]?.topic === "rogue_6") { cnPass++; pass++; }
      else { fail++; fails.push(`[${loc}] rogue_6 CN "${cn}" → ${oc.target.kind}/${oc.topics[0]?.topic ?? "(없음)"}`); }
    }
    console.log(`${loc}: rogue_6 CN 폴백 ${cnPass}/${cnTot} (EN/JA 인덱스에서 cnN 생존 확인)`);
  }

  // ── 오탐 가드 (적대적 리뷰 회귀 방지) ── 흔한 영어 산문 한 줄이 확신 goto를 내면 오탐이다.
  // 과거 결함: rogue_6 라틴조각(iot·vip)·짧은 라틴 이름(omen)이 부분문자열로 가짜 매칭.
  if (SETS.en) {
    const enIndex = buildIndex(SETS.en.map(load), normFor("en"));
    const proseLines = [
      "Patriot the Wandering Guard",       // iot ⊂ patriot (rogue_6 라틴 조각)
      "The idiot ran away from here",      // iot ⊂ idiot
      "A tense moment passes quietly",     // omen ⊂ moment (짧은 라틴 이름)
      "She earned a very important vip badge", // vip 조각
      "The webbed structure collapsed",    // ebb ⊂ webbed
    ];
    let negPass = 0;
    for (const line of proseLines) {
      const oc = analyzeLines([line], enIndex, { norm: normFor("en") });
      if (oc.target.kind === "goto") {
        fail++;
        fails.push(`[en·neg] "${line}" → 오탐 goto ${JSON.stringify(oc.target.goto).slice(0, 90)}`);
      } else { pass++; negPass++; }
    }
    console.log(`en: 오탐 가드 ${negPass}/${proseLines.length} (산문이 확신 goto를 안 내야 함)`);
  }

  console.log(`\n결과: ${pass}/${pass + fail} 통과`);
  for (const f of fails) console.log("  ✗ " + f);
  process.exit(fail === 0 ? 0 : 1);
}

main();
