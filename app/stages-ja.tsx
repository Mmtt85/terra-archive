"use client";

// 로케일별 작전 도감 래퍼 — 자기 언어 데이터만 정적 임포트한다 (app/stages-ko.tsx 주석 참조).
import StageDex from "./stages";
import doc from "./data/stages.ja.json";
import rogueDoc from "./data/stages-rogue.ja.json";
import { mergeRogueDoc, type StageDoc } from "./stage-data";

const merged = mergeRogueDoc(doc as unknown as StageDoc, rogueDoc as unknown as StageDoc);

export default function StageDexJa({ onOpenEnemy }: { onOpenEnemy?: (id: string) => void }) {
  return <StageDex doc={merged} onOpenEnemy={onOpenEnemy} />;
}
