import type { Metadata } from "next";
import HomeEn from "../../../home-en";
import { sandboxSlugs, sandboxMetadata, sandboxJsonLd } from "../../../seo-sandbox";

// 생존연산 시즌 페이지 — 한국 서버 상설(sand)과 중국 서버 선행(anchor)을 **메뉴부터**
// 분리한다 (사용자 확정 2026-08-12 "록라처럼"). 통합전략 /rogue/<slug>와 같은 규격.
export const dynamicParams = false;

export function generateStaticParams() {
  return sandboxSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return sandboxMetadata("en", slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(sandboxJsonLd("en", slug)) }}
      />
      <HomeEn initialTab="ra" initialSandbox={slug} />
    </>
  );
}
