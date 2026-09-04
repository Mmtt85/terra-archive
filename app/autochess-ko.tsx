"use client";

// 로케일별 위수 협의 가이드 래퍼 — 자기 언어 데이터만 정적 임포트 (sandbox-ko.tsx와 같은 관례)
// ⚠ 새 시즌이 오면 PAST 에 한 줄 (지난 시즌이 된 옛 최신본). 절차는 autochess-season 스킬.
import AutochessSeasons, { type AcPastMap } from "./autochess-seasons";
import { type AutochessDoc } from "./autochess";
import doc from "./data/autochess.json";

const PAST: AcPastMap = { 1: () => import("./data/autochess-s1.json") };

export default function AutochessKo({ onShowOperator }: { onShowOperator?: (id: string) => void }) {
  return <AutochessSeasons cur={doc as unknown as AutochessDoc} past={PAST} onShowOperator={onShowOperator} />;
}
