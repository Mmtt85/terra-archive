"use client";
// 스샷 레이더 — 인식 파이프라인 (모달과 페이지 레벨 자동인식이 공유).
// 모드별 단계형 OCR + 매칭: 판정이 나면 나머지 패스를 생략한다 (속도).

import { createOcrSession } from "./ocr";
import { buildIndex, analyzeLines, analyzeRecruit, wantsChipPass, type LensIndex, type LensOutcome } from "./match";

export type LensMode = "rogue" | "recruit";

// 매칭 데이터 지연 로드 — 모드별로 필요한 것만 (recruit는 rogue*.json 2.9MB를 안 내려받는다)
let rogueIndexP: Promise<LensIndex> | null = null;
export function getRogueIndex(): Promise<LensIndex> {
  if (!rogueIndexP) {
    rogueIndexP = Promise.all([
      import("../data/rogue1.json"),
      import("../data/rogue2.json"),
      import("../data/rogue3.json"),
      import("../data/rogue4.json"),
      import("../data/rogue5.json"),
      import("../data/rogue6.json"),
    ]).then((mods) => buildIndex(mods.map((m) => m.default)));
    rogueIndexP.catch(() => { rogueIndexP = null; });
  }
  return rogueIndexP;
}
let recruitTagsP: Promise<string[]> | null = null;
export function getRecruitTags(): Promise<string[]> {
  if (!recruitTagsP) {
    recruitTagsP = import("../data/recruit.json")
      .then((m) => (m.default as { tags: { name: string }[] }).tags.map((tg) => tg.name));
    recruitTagsP.catch(() => { recruitTagsP = null; });
  }
  return recruitTagsP;
}

/** 데이터 예열 (모달 열림/토글 켜짐 시 호출) */
export function warmData(mode: LensMode): void {
  if (mode === "recruit") void getRecruitTags(); else void getRogueIndex();
}

/** 스크린샷 1장 인식 — 모드별 단계형 파이프라인. topic은 rogue 모드의 현재 토픽(사전확률). */
export async function recognizeShot(mode: LensMode, file: Blob, topic?: string): Promise<LensOutcome> {
  let lines: string[];
  let oc: LensOutcome;
  if (mode === "recruit") {
    // 태그는 어두운 버튼 칩이 본체 — 칩 패스 필수, 전체 프레임은 보조 (선택된 파란 태그 등)
    const [tags, session] = await Promise.all([getRecruitTags(), createOcrSession(file)]);
    lines = (await session.chips()).concat(await session.sparse());
    oc = analyzeRecruit(lines, tags);
  } else {
    const [index, session] = await Promise.all([getRogueIndex(), createOcrSession(file)]);
    // 단계형 인식 — PSM11만으로 판정이 나면 나머지 패스를 생략한다 (속도)
    lines = await session.sparse();
    let chipsRan = false;
    if (wantsChipPass(lines)) { chipsRan = true; lines = lines.concat(await session.chips()); }
    const ctx = { context: { topic } };
    oc = analyzeLines(lines, index, ctx);
    // 폴백 패스: none·tie(판정 미완) 또는 하이라이트형 goto(목록 표시 — 엔티티 완성도가 중요,
    // 예: 분대 4개 중 PSM11이 3개만 읽은 경우)일 때 PSM3·칩으로 보강 후 재판정.
    const needMore = oc.target.kind !== "goto"
      || (oc.target.goto.page === "rogue" && !oc.target.goto.modal && !!oc.target.goto.highlight);
    if (needMore) {
      lines = lines.concat(await session.auto());
      if (!chipsRan) lines = lines.concat(await session.chips());
      oc = analyzeLines(lines, index, ctx);
    }
    // 좌하단 난이도 배지 — 있으면 이동 목표에 스탬프해 난이도 셀렉터에 자동 적용 (2026-07-24)
    if (oc.target.kind !== "none") {
      const grade = await session.difficulty();
      console.debug(`[lens] 난이도 배지: ${grade ?? "(없음)"}`);
      if (grade !== null) {
        if (oc.target.kind === "goto" && oc.target.goto.page === "rogue") oc.target.goto.grade = grade;
        else if (oc.target.kind === "tie") for (const o of oc.target.options) { if (o.goto.page === "rogue") o.goto.grade = grade; }
      }
    }
  }
  // 필드 진단용 — 오인식 리포트를 받으면 콘솔에서 OCR 라인·판정을 바로 확인한다
  console.debug(`[lens:${mode}] OCR ${lines.length}줄 → ${oc.target.kind}/${oc.section ?? "-"} · 엔티티 ${oc.entities.length}`, { lines, outcome: oc });
  return oc;
}
