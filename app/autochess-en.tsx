"use client";

// 로케일별 위수 협의 가이드 래퍼 — 자기 언어 데이터만 정적 임포트 (sandbox-en.tsx와 같은 관례)
import AutochessGuide, { type AutochessDoc } from "./autochess";
import doc from "./data/autochess.en.json";

export default function AutochessEn({ onShowOperator }: { onShowOperator?: (id: string) => void }) {
  return <AutochessGuide doc={doc as unknown as AutochessDoc} onShowOperator={onShowOperator} />;
}
