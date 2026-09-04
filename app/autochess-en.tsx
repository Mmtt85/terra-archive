"use client";

// 로케일별 위수 협의 가이드 래퍼 — 자기 언어 데이터만 정적 임포트 (sandbox-en.tsx와 같은 관례)
// ⚠ 새 시즌이 오면 여기 임포트와 SEASON_DOCS 에 한 줄씩 (지난 시즌이 된 옛 최신본은
//   파일명이 autochess-s<N>.en.json 으로 바뀐다). 절차는 autochess-season 스킬.
import AutochessSeasons from "./autochess-seasons";
import { type AutochessDoc } from "./autochess";
import s2 from "./data/autochess.en.json";
import s1 from "./data/autochess-s1.en.json";

const SEASON_DOCS: Record<number, AutochessDoc> = {
  1: s1 as unknown as AutochessDoc,
  2: s2 as unknown as AutochessDoc,
};

export default function AutochessEn({ season, onShowOperator }: {
  season?: number; onShowOperator?: (id: string) => void;
}) {
  return <AutochessSeasons docs={SEASON_DOCS} season={season} onShowOperator={onShowOperator} />;
}
