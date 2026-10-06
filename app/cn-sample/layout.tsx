import type { Metadata } from "next";

// 중섭 계정 샘플 기증 페이지 — 링크를 받은 사람만 온다. 검색엔진 색인 금지 (sitemap 에서도 뺐다)
export const metadata: Metadata = {
  title: "중국 서버 계정 데이터 보내기 | 테라 아카이브",
  robots: { index: false, follow: false },
};

export default function CnSampleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
