// 로케일별 SEO 메타데이터의 정본 — 라우트(/ /en /ja) 페이지가 공유한다.
// 프리뷰 배포(*.pages.dev 해시 서브도메인)도 항상 본 사이트를 정본(canonical)으로 가리킨다.
import type { Metadata } from "next";

export const SITE_URL = "https://terra-archive.pages.dev";

type SeoLocale = "ko" | "en" | "ja";

// hreflang 상호 참조 — 세 언어 모두 같은 언어 목록을 선언해야 한다
const LANGUAGES = {
  ko: `${SITE_URL}/`,
  en: `${SITE_URL}/en`,
  ja: `${SITE_URL}/ja`,
  "x-default": `${SITE_URL}/`,
};

const META: Record<SeoLocale, {
  path: string;
  ogLocale: string;
  siteName: string;
  title: string;
  description: string;
  keywords: string[];
}> = {
  ko: {
    path: "/",
    ogLocale: "ko_KR",
    siteName: "테라 아카이브",
    title: "테라 아카이브 | 명일방주(Arknights) KR 팬사이트",
    description: "명일방주(아크나이츠) 한국 서버 팬사이트 — 오퍼레이터 백과사전, 기반시설(인프라) 자동 편성 플래너, 공개모집(공채) 태그 계산기, 재료 파밍 효율표.",
    keywords: ["명일방주", "아크나이츠", "Arknights", "오퍼레이터", "오퍼레이터 도감", "인프라", "기반시설", "기반시설 편성", "공개모집", "공채 계산기", "공개모집 태그", "재료 파밍", "파밍 효율", "이성 효율", "테라 아카이브"],
  },
  en: {
    path: "/en",
    ogLocale: "en_US",
    siteName: "Terra Archive",
    title: "Terra Archive | Arknights KR Operator Database, Base Planner & Recruitment Calculator",
    description: "Arknights KR-server fansite — full operator encyclopedia, RIIC base auto-assignment planner, recruitment tag calculator, and material farming efficiency guide, available in English.",
    keywords: ["Arknights", "operators", "operator database", "RIIC", "base planner", "base layout", "recruitment calculator", "recruitment tags", "material farming", "sanity efficiency", "farming guide", "Terra Archive"],
  },
  ja: {
    path: "/ja",
    ogLocale: "ja_JP",
    siteName: "テラアーカイブ",
    title: "テラアーカイブ | アークナイツ オペレーター図鑑・基地編成・公開求人計算機",
    description: "アークナイツ（韓国サーバー基準）ファンサイト — オペレーター図鑑、基地（インフラ）自動編成プランナー、公開求人タグ計算機、素材周回効率表を日本語で提供。",
    keywords: ["アークナイツ", "Arknights", "オペレーター", "オペレーター図鑑", "基地", "基地編成", "公開求人", "公開求人 計算機", "求人タグ", "素材周回", "理性効率", "テラアーカイブ"],
  },
};

export function pageMetadata(locale: SeoLocale): Metadata {
  const meta = META[locale];
  const url = `${SITE_URL}${meta.path}`;
  return {
    title: meta.title,
    description: meta.description,
    keywords: meta.keywords,
    alternates: { canonical: url, languages: LANGUAGES },
    robots: { index: true, follow: true },
    openGraph: {
      title: meta.title,
      description: meta.description,
      type: "website",
      url,
      siteName: meta.siteName,
      locale: meta.ogLocale,
      alternateLocale: Object.values(META).filter((m) => m !== meta).map((m) => m.ogLocale),
      images: [{ url: "/og.png", width: 1200, height: 630, alt: meta.siteName }],
    },
    twitter: { card: "summary_large_image", title: meta.title, description: meta.description, images: ["/og.png"] },
  };
}

export function jsonLdFor(locale: SeoLocale) {
  const meta = META[locale];
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: meta.siteName,
    alternateName: ["Terra Archive", "테라 아카이브", "テラアーカイブ", "명일방주 팬사이트"],
    url: `${SITE_URL}${meta.path}`,
    description: meta.description,
    inLanguage: locale,
  };
}
