"use client";

// 로케일별 생존연산 가이드 래퍼 — 자기 언어 데이터만 정적 임포트 (stages-ko.tsx와 같은 관례)
import SandboxGuide, { type SandboxDoc } from "./sandbox";
import doc from "./data/sandbox.json";

export default function SandboxKo({ includeFuture, season }: { includeFuture?: boolean; season?: "v2" | "v3" }) {
  return <SandboxGuide doc={doc as unknown as SandboxDoc} includeFuture={includeFuture} season={season} />;
}
