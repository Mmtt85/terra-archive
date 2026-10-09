// 정적 에셋(스토리·통합전략 이미지, 아바타, OCR 엔진 등 public/의 대용량 폴더)은
// Cloudflare R2(버킷 terra-archive-files → files.terra-archive.net)에서 서빙한다 (2026-07-27).
// 사이트 배포(Pages)에서 334MB/7,700파일을 떼어내 배포를 빠르게 하기 위한 것.
//
// 규칙:
// - 데이터(JSON)와 내부 상태에는 종전대로 루트 상대경로("/avatars/…")를 그대로 둔다.
//   <img src>·fetch()·OCR 경로처럼 실제 요청이 나가는 경계에서만 asset()으로 감싼다.
// - public/에 파일은 그대로 남기고(파이프라인·git 이력 유지) scripts/r2-sync.mjs로 R2에
//   증분 동기화한다. deploy.sh가 배포 스테이징에서 해당 폴더를 제거하고, 혹시 감싸지 못한
//   참조는 Pages _redirects(301 → R2)가 받아낸다.

// ⚠ 빌드 타임 상수 (vite.config.ts define). TA_LOCAL_ASSETS=1 로 빌드하면 빈 문자열이 되어
//   public/ 의 파일을 그대로 본다 — **아직 R2 에 안 올린 새 에셋을 로컬에서 확인할 때** 쓴다
//   (2026-08-25: 스토리 장면 모드 배경·스탠딩이 R2 에만 없어서 로컬 빌드에 안 보였다).
//   런타임 분기(location.hostname 등)로 하면 프리렌더와 값이 갈라져 하이드레이션이 깨진다.
export const ASSET_BASE = __ASSET_BASE__;

/** 스토리 CG(/story/cut/<이름>.webp) 캐시 키 — 파일명이 같은 채 내용이 바뀔 때 올린다. R2 엣지·브라우저가 30일 붙드는
 *  옛 그림을 새 키로 우회한다 (dex-paths.ts MAP_VER 와 같은 이유).
 *  20261004: 7월에 중섭 미러에서 받아 중국어로 남아 있던 글자 박힌 CG 38장(메인 스토리 장 카드 등)을 한섭판으로 교체.
 *  ⚠ 올리기 전에 R2 동기화(배포)가 끝나 있어야 한다 — 먼저 열면 옛 그림이 새 키로 30일 박힌다. */
export const CUT_VER = "20261004";
export const storyCutUrl = (name: string) => `${asset(`/story/cut/${encodeURIComponent(name)}.webp`)}?v=${CUT_VER}`;
/** 이벤트 창 훈장·가구 그림(/event/medal·/event/furni) 캐시 키. 그림이 R2 에 올라가기 **전에** 누가 그 주소를 열면
 *  404 가 엣지에 4시간 박힌다 — 중섭 선행 이벤트는 도감이 먼저 배포되고 그림이 뒤따라 올 때가 있어 그렇게 됐다
 *  (2026-10-09 어제의 바다 가구 19장). 그림을 새로 받아 올린 뒤 값을 올리면 새 키로 바로 받아진다. */
export const EVENT_ART_VER = "2026100901";
/** 스토리 목록·연대기 카드 섬네일(/story/<id>.webp) 캐시 키 — 새 섬네일을 올리기 전에 그 주소가 한 번이라도 열리면
 *  404 가 엣지에 4시간 박힌다(2026-10-10 상전이 임계 main_17). 섬네일을 새로 넣으면 올린다. */
export const STORY_THUMB_VER = "2026101001";
export const storyThumbUrl = (path: string) => `${asset(path)}?v=${STORY_THUMB_VER}`;
export const eventArtUrl = (kind: "medal" | "furni", id: string) => `${asset(`/event/${kind}/${id}.webp`)}?v=${EVENT_ART_VER}`;

/** 루트 상대 에셋 경로 → R2 URL. 이미 절대 URL이면 그대로 돌려준다.
 *  버킷은 assets/(사이트 에셋 — r2-sync 관할)와 uploads/(수동 업로드)로 나뉜다 (2026-07-27). */
export function asset(path: string): string {
  if (!path.startsWith("/")) return path;
  return ASSET_BASE ? `${ASSET_BASE}/assets${path}` : path;   // 빈 base = public/ 직접
}
