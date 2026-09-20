import vinext from "vinext";
import { defineConfig } from "vite";
import { adminDevProxy } from "./scripts/admin-dev-proxy";

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    // 빌드(=배포) 시각을 번들에 박아 푸터에 아주 작게 표시한다. 데이터 JSON은 빌드 시점에
    // import로 박히므로, "언제 것까지 반영된 사이트인가"를 이 값 하나로 알 수 있다.
    // 파일로 만들면 빌드마다 git 변경이 생기므로 define 치환으로 처리한다.
    // ⚠ 이 값 하나 때문에 **빌드가 재현되지 않는다** — 이걸 품은 청크(dropdown·home)의 해시가
    //   매 빌드 바뀌고, 연쇄로 html/rsc 17,213개가 전부 달라져 Pages 의 내용 해시 중복 제거가
    //   409개밖에 안 먹는다(배포 실측 2026-09-21: 17,254개 재업로드 50.7초).
    //   그래도 **그대로 둔다**: 배지·기간 한정 배너 판정을 빌드 시각으로 고정하는 게 이 값의
    //   존재 이유고(whats-new.ts 주석), 반올림하면 배너가 뜨고 지는 시점이 바뀐다. 게다가 CSS 가
    //   전 페이지가 참조하는 해시 자산 하나라 globals.css 한 줄만 고쳐도 어차피 전량 재업로드다.
    //   자세한 실측은 scripts/deploy.sh 의 --fast 주석.
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      // 에셋 출처 — 기본은 R2(files.terra-archive.net). TA_LOCAL_ASSETS=1 로 빌드하면
      // public/ 의 파일을 그대로 보게 해 **아직 R2 에 안 올린 새 에셋을 로컬에서 확인**할 수 있다
      // (2026-08-25). 컴파일 타임 상수라 프리렌더와 클라이언트 값이 같아 하이드레이션이 갈라지지 않는다.
      __ASSET_BASE__: JSON.stringify(process.env.TA_LOCAL_ASSETS ? "" : "https://files.terra-archive.net"),
    },
    plugins: [
      // dev 전용: localhost /api/* → 키 파일로 Supabase·업로드 워커 중계 (관리자 로컬 개발용)
      adminDevProxy(),
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          main: "./worker/index.ts",
          compatibility_flags: ["nodejs_compat"],
        },
      }),
    ],
  };
});
