"use client";

// 로케일별 작전 도감 래퍼 — 자기 언어 데이터만 정적 임포트한다 (app/enemies-ko.tsx와 같은 관례).
import StageDex from "./stages";
import doc from "./data/stages.en.json";
import type { StageDoc } from "./stage-data";

export default function StageDexEn({ onOpenEnemy }: { onOpenEnemy?: (id: string) => void }) {
  return <StageDex doc={doc as unknown as StageDoc} onOpenEnemy={onOpenEnemy} />;
}
