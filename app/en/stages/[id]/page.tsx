import type { Metadata } from "next";
import HomeEn from "../../../home-en";
import { stageIds, stageMetadata, stageJsonLd, stagePageData } from "../../../seo-stage";

// 작전 상세 — **상시 콘텐츠만** 정적 페이지다 (2026-08-09, 파일 수 한도).
// 종료된 이벤트까지 3개 언어로 펼치면 그것만 13,000파일이라 Cloudflare Pages의
// 배포당 20,000 한도를 넘긴다. 자세한 근거는 app/seo-stage.ts 머리주석.
export const dynamicParams = false;

export function generateStaticParams() {
  return stageIds.map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return stageMetadata("en", id);
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(stageJsonLd("en", id)) }}
      />
      <HomeEn initialTab="stage" pageStage={stagePageData("en", id)} />
    </>
  );
}
