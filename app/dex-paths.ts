// 도감 URL·에셋 경로 한곳 모음 — 적 도감과 작전 도감이 **서로를 링크**하기 때문에
// 각자 모듈에 두면 순환 임포트가 된다 (2026-08-09에 실제로 걸렸다).
//
// ⚠ 여기 규칙은 app/seo-enemy.ts·app/seo-stage.ts의 urlOf와 같아야 한다.
// ⚠ 라우트는 /enemies·/stages(복수), 자산 폴더는 /enemy·/stage(단수)로 **일부러 다르다** —
//   scripts/deploy.sh가 `rm -rf $STAGE/enemy` 로 자산만 떼어내기 때문(서빙은 R2).
import { asset } from "./assets";
import { slugOf } from "./rogue-topics";

const base = (locale: string) => (locale === "ko" ? "" : `/${locale}`);

export const enemyPath = (locale: string, id: string) => `${base(locale)}/enemies/${id}`;
export const enemyListPath = (locale: string) => `${base(locale)}/enemies`;
export const stagePath = (locale: string, id: string) => `${base(locale)}/stages/${id}`;
export const stageListPath = (locale: string) => `${base(locale)}/stages`;
/** 통합전략 작전(Stage.rg)이 속한 테마의 정본 주소 — 그 작전엔 /stages/<id> 페이지가 없다
 *  (파일 수 한도, scripts/build-stages-rogue.py 머리주석). id는 `ro<N>_...` 꼴이다.
 *  ⚠ rogue-topics는 데이터를 전혀 물지 않는 경량 모듈이라 여기서 가져와도 번들이 안 커진다
 *  (rogue.tsx에서 가져오면 rogue1.json 321KB가 딸려 온다 — 그 모듈 머리주석). */
export const rogueHrefOf = (locale: string, stageId: string) => {
  const n = /^ro(\d+)_/.exec(stageId)?.[1];
  return n ? `${base(locale)}/rogue/${slugOf(`rogue_${n}`)}` : `${base(locale)}/rogue`;
};

/** 적 초상. 변종(_2 등)은 원본 id 이미지로 폴백한다 (build-enemies.py와 같은 규약) */
export const enemyImg = (id: string) => asset(`/enemy/${id}.webp`);
export const enemyImgBase = (id: string) => asset(`/enemy/${id.replace(/_\d+$/, "")}.webp`);
/** 작전 지형 도면. 없는 작전이 있으므로 stage.map으로 먼저 거른다.
    MAP_VER: 파일명이 같은 채 내용이 바뀔 때 올린다 — R2 엣지·브라우저의 30일 이미지
    캐시를 새 키로 우회 (about.tsx SHOT_VER와 같은 이유. v2: 어려움 판 도면 교체 2026-08-10.
    v3: R2 동기화 직후 확인 요청이 전파 경합으로 v2 키에 옛 파일을 박아버려 한 번 더 올림 —
    동기화 후 검증 curl은 반드시 일회용 쿼리로 할 것). */
const MAP_VER = "3";
/** rogue=true(통합전략 작전, Stage.rg)면 록라 도면 폴더를 본다 — **이미지를 public/stage/로
    복사·이동하지 않는다.** public/rogue는 이미 R2 동기화·배포 트림 대상이고, 에셋과 페이지가
    같은 폴더에 섞인 그 폴더를 건드리면 2026-08-08 사고(테마 페이지가 매 배포마다 사라짐)를
    되풀이한다. 버전 쿼리는 붙이지 않는다 — 록라 도면은 /rogue가 예전부터 무버전으로 물고
    있어, 여기서만 v를 붙이면 같은 이미지를 캐시 키 두 벌로 받게 된다. */
export const stageMap = (id: string, rogue?: boolean) =>
  (rogue ? asset(`/rogue/map/${id}.webp`) : asset(`/stage/${id}.webp?v=${MAP_VER}`));
