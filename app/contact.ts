// 사이트 공개 연락처의 단일 정본 (2026-09-03).
//
// 개인 지메일 대신 도메인 역할 주소를 쓴다 — 저작권·삭제 요청처럼 공개적으로 받아야 하는
// 연락이 운영자 개인 주소로 박히면 나중에 갈아끼울 수가 없다.
//   수신: Cloudflare Email Routing (contact@ → 운영자 지메일 전달)
//   발신: Resend SMTP 릴레이 (지메일 "다른 주소에서 메일 보내기"로 연결, SPF·DKIM·DMARC 통과)
// 주소를 바꾸면 Cloudflare 라우팅 규칙과 지메일 send-as 설정도 함께 바꿔야 한다.
//
// 이 파일은 **의존성이 없어야 한다** — home.tsx(클라이언트)와 seo.ts(서버 메타)가 같이 무는데,
// seo.ts를 클라이언트에서 임포트하면 META 표 전체가 첫 화면 번들에 딸려 들어간다.
export const CONTACT_EMAIL = "contact@terra-archive.net";
