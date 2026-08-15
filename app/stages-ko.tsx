"use client";

// 로케일별 작전 도감 래퍼 — 자기 언어 데이터만 정적 임포트한다 (app/enemies-ko.tsx와 같은 관례).
//
// 통합전략 작전 693개는 **별도 색인**(stages-rogue*.json, 로케일당 ~400KB)으로 들어와
// 여기서 합쳐진다. stages.json에 섞지 않는 이유는 scripts/build-stages-rogue.py 머리주석 —
// 그 파일은 서버(app/seo-stage.ts)·사이트맵이 읽고, 섞으면 상세 페이지가 4,158개 늘어
// Cloudflare Pages 파일 수 한도를 넘긴다. 합치기는 목록 탭에서만 한다.
import StageDex from "./stages";
import doc from "./data/stages.json";
import rogueDoc from "./data/stages-rogue.json";
import { mergeRogueDoc, type StageDoc } from "./stage-data";

const merged = mergeRogueDoc(doc as unknown as StageDoc, rogueDoc as unknown as StageDoc);

export default function StageDexKo({ onOpenEnemy }: { onOpenEnemy?: (id: string) => void }) {
  return <StageDex doc={merged} onOpenEnemy={onOpenEnemy} />;
}
