import type { Metadata } from "next";
import HomeEn from "../../../home-en";
import { rogueSlugs, rogueMetadata, rogueJsonLd } from "../../../seo-rogue";
import JsonLd from "../../../json-ld";

// 통합전략 테마 — 테마마다 실제 정적 페이지 (2026-08-06, SEO).
// 종전엔 6개 테마가 /rogue?topic=isN 쿼리 파라미터 하나를 나눠 써서 사이트맵에도 없었다.
// 본문(존·적·소장품)은 300~800KB라 종전대로 동적 로드이고, 정적 HTML에는 테마 이름·
// 도입문(히어로)까지 담긴다 — app/data/rogue-index.json 참조.
export const dynamicParams = false;

export function generateStaticParams() {
  return rogueSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return rogueMetadata("en", slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <>
      <JsonLd data={rogueJsonLd("en", slug)} />
      <HomeEn initialTab="rogue" initialRogue={slug} />
    </>
  );
}
