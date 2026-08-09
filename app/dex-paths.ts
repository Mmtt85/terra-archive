// 도감 URL·에셋 경로 한곳 모음 — 적 도감과 작전 도감이 **서로를 링크**하기 때문에
// 각자 모듈에 두면 순환 임포트가 된다 (2026-08-09에 실제로 걸렸다).
//
// ⚠ 여기 규칙은 app/seo-enemy.ts·app/seo-stage.ts의 urlOf와 같아야 한다.
// ⚠ 라우트는 /enemies·/stages(복수), 자산 폴더는 /enemy·/stage(단수)로 **일부러 다르다** —
//   scripts/deploy.sh가 `rm -rf $STAGE/enemy` 로 자산만 떼어내기 때문(서빙은 R2).
import { asset } from "./assets";

const base = (locale: string) => (locale === "ko" ? "" : `/${locale}`);

export const enemyPath = (locale: string, id: string) => `${base(locale)}/enemies/${id}`;
export const enemyListPath = (locale: string) => `${base(locale)}/enemies`;
export const stagePath = (locale: string, id: string) => `${base(locale)}/stages/${id}`;
export const stageListPath = (locale: string) => `${base(locale)}/stages`;

/** 적 초상. 변종(_2 등)은 원본 id 이미지로 폴백한다 (build-enemies.py와 같은 규약) */
export const enemyImg = (id: string) => asset(`/enemy/${id}.webp`);
export const enemyImgBase = (id: string) => asset(`/enemy/${id.replace(/_\d+$/, "")}.webp`);
/** 작전 지형 도면. 없는 작전이 있으므로 stage.map으로 먼저 거른다.
    MAP_VER: 파일명이 같은 채 내용이 바뀔 때 올린다 — R2 엣지·브라우저의 30일 이미지
    캐시를 새 키로 우회 (about.tsx SHOT_VER와 같은 이유. v2: 어려움 판 도면 교체 2026-08-10). */
const MAP_VER = "2";
export const stageMap = (id: string) => asset(`/stage/${id}.webp?v=${MAP_VER}`);
