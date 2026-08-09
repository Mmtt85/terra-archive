"use client";

// 로케일별 적 도감 래퍼 — 자기 언어 데이터만 정적 임포트한다 (app/home-ko.tsx와 같은 관례).
// 한 모듈에서 세 로케일을 동적 선택하면 셋 다 같은 청크에 묶여 3MB가 된다.
import EnemyDex from "./enemies";
import enemies from "./data/enemies.ja.json";
import type { Enemy } from "./enemy-detail";

export default function EnemyDexJa() {
  return <EnemyDex enemies={enemies as unknown as Enemy[]} />;
}
