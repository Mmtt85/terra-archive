import type { Metadata } from "next";
import HomeKo from "../home-ko";
import { pageMetadata, jsonLdFor } from "../seo";
import JsonLd from "../json-ld";
import RecruitSeo from "../page-seo/recruit";
import RouteOnly from "../route-only";

export const metadata: Metadata = pageMetadata("ko", "recruit");

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLdFor("ko", "recruit")} />
      {/* 푸터 위 접는 안내 — 서버 HTML 에 태그·사용법·확정 조합을 싣는다 (app/page-seo/recruit.tsx) */}
      <HomeKo initialTab="recruit" pageSeo={<RouteOnly path="/recruit"><RecruitSeo /></RouteOnly>} />
    </>
  );
}
