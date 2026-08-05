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
    define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
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
