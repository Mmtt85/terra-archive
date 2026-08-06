// 통합전략 테마 페이지(/rogue/<slug>)의 메타데이터 — 서버(빌드) 전용.
//
// 왜 있나 (2026-08-06): 테마 6종이 전부 /rogue?topic=isN 쿼리 파라미터라 사이트맵에도 없고
// 테마별 제목·설명도 없었다. 6개 테마가 한 URL을 나눠 쓰고 있던 셈이다.
//
// ⚠ 본문(존·적·소장품)은 300~800KB라 선택 시 동적 로드다 — 정적 HTML에 담기는 건 히어로
//    (테마 이름·도입문)까지다. 그래서 여기서 쓰는 값도 app/data/rogue-index.json(3.6KB)
//    뿐이고, 무거운 rogueN.json은 건드리지 않는다.
import type { Metadata } from "next";
import { asset } from "./assets";
import { SITE_URL } from "./seo";
import indexData from "./data/rogue-index.json";

type SeoLocale = "ko" | "en" | "ja";
type TopicMeta = { name: string; line: string; zones: number; enemies: number; relics: number };

const LOCALE_BASE: Record<SeoLocale, string> = { ko: "", en: "/en", ja: "/ja" };
const INDEX = indexData as Record<string, Partial<Record<SeoLocale, TopicMeta>>>;

/** 테마 슬러그(is1…is6) — 라우트 생성용. app/rogue.tsx의 slugOf와 같은 규칙이다. */
export const rogueSlugs = Object.keys(INDEX).map((id) => `is${id.split("_")[1]}`);
const idOf = (slug: string) => `rogue_${slug.replace(/^is/, "")}`;
const metaOf = (locale: SeoLocale, slug: string): TopicMeta | null => {
  const entry = INDEX[idOf(slug)];
  return entry ? entry[locale] ?? entry.ko ?? null : null;
};

const TITLE: Record<SeoLocale, (name: string) => string> = {
  ko: (name) => `${name} - 명일방주 통합전략 공략 | 테라 아카이브`,
  en: (name) => `${name} - Arknights Integrated Strategies Guide | Terra Archive`,
  ja: (name) => `${name} - アークナイツ統合戦略攻略 | テラアーカイブ`,
};

// 설명 = 그 테마의 도입문 + 실제로 이 페이지에 뭐가 있는지(존·적·소장품 수).
// 수치는 데이터에서 세므로 테마마다 다르고, 갱신되면 같이 바뀐다.
function descOf(locale: SeoLocale, slug: string): string {
  const m = metaOf(locale, slug);
  if (!m) return "";
  const stat = locale === "ko"
    ? `층 ${m.zones}개 · 적 도감 ${m.enemies}종 · 소장품 ${m.relics}종을 정리했습니다.`
    : locale === "ja"
      ? `階層${m.zones}・敵図鑑${m.enemies}種・収蔵品${m.relics}種をまとめています。`
      : `${m.zones} floors, ${m.enemies} enemies, and ${m.relics} collectibles, all catalogued.`;
  const full = `${m.name} — ${m.line} ${stat}`;
  return full.length > 158 ? `${full.slice(0, 157).trimEnd()}…` : full;
}

const urlOf = (locale: SeoLocale, slug: string) => `${SITE_URL}${LOCALE_BASE[locale]}/rogue/${slug}`;

// AI 스토리 요약 발행 피드(public/feed.xml)는 한국어 본문이라 **한국어 페이지에만** 건다.
const RSS_ALT = (locale: SeoLocale) =>
  locale === "ko"
    ? { types: { "application/rss+xml": `${SITE_URL}/feed.xml` } }
    : {};

export function rogueMetadata(locale: SeoLocale, slug: string): Metadata {
  const m = metaOf(locale, slug);
  const name = m?.name ?? slug;
  const title = TITLE[locale](name);
  const description = descOf(locale, slug);
  const languages = {
    ko: urlOf("ko", slug), en: urlOf("en", slug), ja: urlOf("ja", slug), "x-default": urlOf("ko", slug),
  };
  const ogImage = asset(`/og/${locale}/rogue.jpg`);
  const siteName = locale === "ko" ? "테라 아카이브" : locale === "ja" ? "テラアーカイブ" : "Terra Archive";
  return {
    title,
    description,
    alternates: { canonical: urlOf(locale, slug), languages, ...RSS_ALT(locale) },
    robots: { index: true, follow: true },
    openGraph: {
      title, description, type: "article", url: urlOf(locale, slug), siteName,
      locale: locale === "ko" ? "ko_KR" : locale === "ja" ? "ja_JP" : "en_US",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", site: "@naru35405955", creator: "@naru35405955", title, description, images: [ogImage] },
  };
}

export function rogueJsonLd(locale: SeoLocale, slug: string) {
  const m = metaOf(locale, slug);
  const name = m?.name ?? slug;
  const siteName = locale === "ko" ? "테라 아카이브" : locale === "ja" ? "テラアーカイブ" : "Terra Archive";
  const listLabel = locale === "ko" ? "통합전략 가이드" : locale === "ja" ? "統合戦略ガイド" : "Integrated Strategies Guide";
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: TITLE[locale](name).split(" | ")[0],
        description: descOf(locale, slug),
        inLanguage: locale,
        url: urlOf(locale, slug),
        mainEntityOfPage: urlOf(locale, slug),
        isAccessibleForFree: true,
        publisher: { "@type": "Organization", name: siteName, url: SITE_URL },
        about: { "@type": "VideoGame", name: locale === "ja" ? "アークナイツ" : locale === "en" ? "Arknights" : "명일방주" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: siteName, item: `${SITE_URL}${LOCALE_BASE[locale] || "/"}` },
          { "@type": "ListItem", position: 2, name: listLabel, item: `${SITE_URL}${LOCALE_BASE[locale]}/rogue` },
          { "@type": "ListItem", position: 3, name },
        ],
      },
    ],
  };
}
