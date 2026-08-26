import type { Metadata } from "next";
import HomeJa from "../../../home-ja";
import { enemyIds, enemyMetadata, enemyJsonLd, enemyPageData } from "../../../seo-enemy";
import JsonLd from "../../../json-ld";

// 적 상세 — 도감에 나오는 적마다 실제 정적 페이지 (2026-08-09, SEO).
//
// ⚠ 여기서 **서버가 그 적 하나만 골라 props로 내려 준다.** 목록 데이터(enemies.json)는
//    로케일당 1MB라 클라이언트 번들에 실을 수 없고, 그렇다고 본문을 lazy로 감싸면
//    HTML이 "데이터를 불러오는 중…" 껍데기로 나가 색인이 무의미해진다
//    (/rogue/is1이 지금 그 상태 — app/enemy-detail.tsx 머리주석의 실측 근거 참조).
export const dynamicParams = false;

export function generateStaticParams() {
  return enemyIds.map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return enemyMetadata("ja", id);
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { enemy, stages } = enemyPageData("ja", id);
  return (
    <>
      <JsonLd data={enemyJsonLd("ja", id)} />
      <HomeJa initialTab="enemy" initialEnemy={id} pageEnemy={enemy} pageEnemyStages={stages} />
    </>
  );
}
