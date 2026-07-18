import type { Metadata } from "next";

// 관리자 페이지 — 검색엔진 색인 금지 (robots.txt Disallow에 더해 meta로 이중 차단).
// page.tsx가 "use client"라 metadata를 내보낼 수 없어 레이아웃에서 지정한다.
export const metadata: Metadata = {
  title: "관리자 | 테라 아카이브",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
