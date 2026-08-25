// vite.config.ts의 define으로 주입되는 빌드(배포) 시각 ISO 문자열.
declare const __BUILD_TIME__: string;

// 에셋 출처(R2 URL). 빈 문자열이면 public/ 을 그대로 쓴다 — TA_LOCAL_ASSETS=1 로컬 확인용.
declare const __ASSET_BASE__: string;
