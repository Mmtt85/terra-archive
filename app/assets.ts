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

export const ASSET_BASE = "https://files.terra-archive.net";

/** 루트 상대 에셋 경로 → R2 URL. 이미 절대 URL이면 그대로 돌려준다.
 *  버킷은 assets/(사이트 에셋 — r2-sync 관할)와 uploads/(수동 업로드)로 나뉜다 (2026-07-27). */
export function asset(path: string): string {
  return path.startsWith("/") ? `${ASSET_BASE}/assets${path}` : path;
}
