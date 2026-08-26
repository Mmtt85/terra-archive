import type { Metadata } from "next";
import HomeJa from "../../../home-ja";
import { operatorIds, operatorMetadata, operatorJsonLd } from "../../../seo-operator";
import JsonLd from "../../../json-ld";

// 오퍼레이터 상세 — 정식 출시 오퍼마다 실제 정적 페이지 (2026-08-06, SEO).
// 종전에는 #op-<id> 해시 모달이라 검색엔진에 존재하지 않았다. 모달(body 포털)은
// 프리렌더가 안 되므로, 이 라우트는 같은 본문을 페이지 형태로 그린다 (OperatorPage).
export const dynamicParams = false;

export function generateStaticParams() {
  return operatorIds.map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return operatorMetadata("ja", id);
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <JsonLd data={operatorJsonLd("ja", id)} />
      <HomeJa initialTab="archive" initialOperator={id} />
    </>
  );
}
