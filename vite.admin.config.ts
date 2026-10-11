// 관리자 사이트 단독 빌드 (2026-10-11) — `npx vite build --config vite.admin.config.ts` → dist-admin/.
// 본사이트 vite.config.ts(vinext·Cloudflare 플러그인·프리렌더)를 타지 않아 몇 초면 끝난다. 배포는 scripts/deploy-admin.sh.
// 본사이트와 같은 컴파일 상수(__BUILD_TIME__·__ASSET_BASE__)를 넣어야 공용 코드(assets.ts 등)가 똑같이 돈다.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "admin-app",
  base: "/",
  publicDir: false,
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __ASSET_BASE__: JSON.stringify(process.env.TA_LOCAL_ASSETS ? "" : "https://files.terra-archive.net"),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: { outDir: "../dist-admin", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
