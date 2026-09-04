import type { Metadata } from "next";
import HomeJa from "../../../home-ja";
import { autochessSlugs, autochessMetadata, autochessJsonLd } from "../../../seo-autochess";
import JsonLd from "../../../json-ld";

// 위수 협의 시즌 페이지 — 지난 시즌을 **메뉴부터** 갈라 둔다 (사용자 요청 2026-09-05).
// 생존연산 /ra/<slug> · 통합전략 /rogue/<slug>와 같은 규격.
// 슬러그 목록은 app/data/autochess-seasons.json 에서 나오므로 새 시즌이 와도 여기는 그대로다.
export const dynamicParams = false;

export function generateStaticParams() {
  return autochessSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return autochessMetadata("ja", slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <>
      <JsonLd data={autochessJsonLd("ja", slug)} />
      <HomeJa initialTab="autochess" initialAutochess={slug} />
    </>
  );
}
