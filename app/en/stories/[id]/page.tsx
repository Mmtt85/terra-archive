import type { Metadata } from "next";
import HomeEn from "../../../home-en";
import { storyIds, storyMetadata, storyJsonLd } from "../../../seo-story";
import JsonLd from "../../../json-ld";

// 스토리 요약 상세 — 요약이 있는 이벤트마다 실제 정적 페이지를 만든다 (2026-08-06, SEO).
// 종전에는 #story-<id> 해시라 검색엔진에 존재하지 않는 화면이었다. 프리렌더 HTML에
// 요약 본문이 담기도록 Home에 initialStory를 넘긴다 (StoryGuide가 상세를 바로 연다).
export const dynamicParams = false;

export function generateStaticParams() {
  return storyIds.map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return storyMetadata("en", id);
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <JsonLd data={storyJsonLd("en", id)} />
      <HomeEn initialTab="story" initialStory={id} />
    </>
  );
}
