import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 정적 내보내기 — 사이트가 전부 클라이언트 렌더링이라 SSR 워커가 필요 없고,
  // Cloudflare Pages 무료 플랜의 워커 3MiB 한도(데이터 JSON 인라인 시 초과)를 피한다 (2026-07)
  output: "export",
};

export default nextConfig;
