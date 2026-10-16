"use client";

// 로케일별 작전 도감 래퍼 — 자기 언어 데이터만 정적 임포트한다 (app/stages-ko.tsx 주석 참조).
import StageDex from "./stages";
import doc from "./data/stages.en.json";
import rogueDoc from "./data/stages-rogue.en.json";
import sandboxDoc from "./data/stages-sandbox.en.json";
import crisisDoc from "./data/stages-crisis.en.json";
import { mergeRogueDoc, type StageDoc } from "./stage-data";

// 생존연산 지역(사막 이야기 106) — 통합전략과 같은 방식의 별도 색인 (scripts/build-stages-sandbox.py, 2026-09-23)
// 위기협약 시즌 맵·홀로그램 매트릭스 (scripts/build-stages-crisis.py, 2026-10-16) — 넷째 색인
const merged = mergeRogueDoc(
  mergeRogueDoc(
    mergeRogueDoc(doc as unknown as StageDoc, rogueDoc as unknown as StageDoc),
    sandboxDoc as unknown as StageDoc,
  ),
  crisisDoc as unknown as StageDoc,
);

export default function StageDexEn({ onOpenEnemy }: { onOpenEnemy?: (id: string) => void }) {
  return <StageDex doc={merged} onOpenEnemy={onOpenEnemy} />;
}
