// 스토리 요약 상세 페이지(/stories/<id>)의 메타데이터 — 서버(빌드) 전용.
//
// 왜 있나 (2026-08-06): 상세가 #story-<id> 해시뿐이라 검색엔진에는 존재하지 않는 페이지였다.
// AI가 쓴 요약 91편은 이 사이트에만 있는 고유 본문이라 색인 가치가 가장 높다 — 로케일마다
// 실제 라우트로 뽑아 제목·설명·hreflang·Article JSON-LD를 붙인다.
//
// ⚠ 이벤트 목록을 만드는 방식은 app/story.tsx의 eventById와 같아야 한다 —
//    stories.json 이벤트 + chronology.json의 메인스토리·통합전략 합성 항목.
//    story.tsx는 "use client"라 서버 컴포넌트에서 못 부르므로 최소한만 다시 만든다.
import type { Metadata } from "next";
import { asset } from "./assets";
import { SITE_URL } from "./seo";
import storiesData from "./data/stories.json";
import chronologyData from "./data/chronology.json";
import summaryIdsData from "./data/story-summary-ids.json";
import summariesKo from "./data/story-summaries.json";
import summariesEn from "./data/story-summaries.en.json";
import summariesJa from "./data/story-summaries.ja.json";
import loreIndexData from "./data/eventlore-index.json";

type SeoLocale = "ko" | "en" | "ja";
type LocText = { ko: string; en?: string; ja?: string };

const LOCALE_BASE: Record<SeoLocale, string> = { ko: "", en: "/en", ja: "/ja" };
const summaryIds = summaryIdsData as string[];
const TAGLINE: Record<SeoLocale, Record<string, { tagline?: string }>> = {
  ko: summariesKo as Record<string, { tagline?: string }>,
  en: summariesEn as Record<string, { tagline?: string }>,
  ja: summariesJa as Record<string, { tagline?: string }>,
};

type StoryMeta = { id: string; name: LocText; start?: string };
const BY_ID = new Map<string, StoryMeta>();
for (const event of (storiesData as { events: { id: string; name: LocText; start?: string }[] }).events) {
  BY_ID.set(event.id, { id: event.id, name: event.name, start: event.start });
}
for (const entry of (chronologyData as { entries: { id?: string; kind: string; title?: LocText }[] }).entries) {
  if (entry.id && entry.kind !== "event" && !BY_ID.has(entry.id)) {
    BY_ID.set(entry.id, { id: entry.id, name: entry.title ?? { ko: entry.id } });
  }
}
// 이벤트 기록만 있고 요약·전문이 없는 이벤트(재건 계획)도 상세가 열리므로 주소가 있어야 한다 —
// 없으면 목록 카드의 href가 404다. 이름·출시월은 색인이 실어 보낸다 (build-eventlore.py).
const loreRows = (loreIndexData as { events: { id: string; n: number; name?: LocText; start?: string }[] }).events;
const LORE_IDS = new Set(loreRows.map((row) => row.id));
for (const row of loreRows) {
  if (row.name && !BY_ID.has(row.id)) BY_ID.set(row.id, { id: row.id, name: row.name, start: row.start });
}
/** 요약이 없어 '스토리 요약'이라고 부를 수 없는 상세 — 제목·설명을 이벤트 기록 쪽으로 바꾼다 */
const loreOnly = (id: string) => LORE_IDS.has(id) && !TAGLINE.ko[id];

/** 상세 페이지를 만들 스토리 id 전부 — 라우트 생성(generateStaticParams)용. 세 로케일 모두 같다. */
export const storyIds = [...new Set([...summaryIds, ...LORE_IDS])].filter((id) => BY_ID.has(id));

const nameOf = (locale: SeoLocale, id: string) => {
  const meta = BY_ID.get(id);
  if (!meta) return id;
  return (locale === "ko" ? meta.name.ko : meta.name[locale]) ?? meta.name.ko;
};

const TITLE: Record<SeoLocale, (name: string) => string> = {
  ko: (name) => `${name} 스토리 요약 - 명일방주 | 테라 아카이브`,
  en: (name) => `${name} Story Summary - Arknights | Terra Archive`,
  ja: (name) => `${name} ストーリー要約 - アークナイツ | テラアーカイブ`,
};
const FALLBACK_DESC: Record<SeoLocale, (name: string) => string> = {
  ko: (name) => `명일방주 '${name}' 스토리를 AI가 정독하고 컷씬과 함께 10분 분량으로 요약했습니다.`,
  en: (name) => `An AI-written digest of the Arknights story "${name}" — the full script read through and summarized with cutscenes in a 10-minute read.`,
  ja: (name) => `アークナイツ「${name}」のストーリーをAIが通読し、カットシーンと共に10分で読める要約にまとめました。`,
};

const descOf = (locale: SeoLocale, id: string) => {
  const tagline = (TAGLINE[locale][id]?.tagline ?? "").trim();
  const name = nameOf(locale, id);
  if (loreOnly(id)) return LORE_DESC[locale](name);
  if (!tagline) return FALLBACK_DESC[locale](name);
  // 검색 결과 발췌 길이(약 160자)에 맞춰 자른다 — 자를 땐 문장부호가 아니라 말줄임으로
  return tagline.length > 158 ? `${tagline.slice(0, 157).trimEnd()}…` : tagline;
};

// 요약이 없는(기록뿐인) 이벤트 — 이 주소로 색인되는 본문은 요약이 아니라 이벤트 기록이다.
const LORE_TITLE: Record<SeoLocale, (name: string) => string> = {
  ko: (name) => `${name} 이벤트 기록 - 명일방주 | 테라 아카이브`,
  en: (name) => `${name} Event Records - Arknights | Terra Archive`,
  ja: (name) => `${name} イベント記録 - アークナイツ | テラアーカイブ`,
};
const LORE_DESC: Record<SeoLocale, (name: string) => string> = {
  ko: (name) => `명일방주 '${name}' 이벤트를 진행하며 미니게임·수집 요소로 풀리던 글 모음입니다. 이벤트가 끝나면 게임에서도 다시 볼 수 없는 기록입니다.`,
  en: (name) => `The writings unlocked through minigames and collectibles during the Arknights event "${name}" — records that can no longer be read in game once the event ends.`,
  ja: (name) => `アークナイツ「${name}」でミニゲームや収集要素を通じて解放された文章のアーカイブです。イベント終了後はゲーム内で読めなくなる記録です。`,
};

const urlOf = (locale: SeoLocale, id: string) => `${SITE_URL}${LOCALE_BASE[locale]}/stories/${id}`;

// AI 스토리 요약 발행 피드(public/feed.xml)는 한국어 본문이라 **한국어 페이지에만** 건다.
// ⚠ alternates는 페이지 값이 레이아웃 값을 통째로 덮으므로 레이아웃이 아니라 여기서 붙인다.
const RSS_ALT = (locale: SeoLocale) =>
  locale === "ko"
    // ⚠ 문자열 형태로 준다 — vinext 메타데이터 렌더러가 {url,title} 객체 형태를 못 풀어
    //    href="[object Object]"가 나간다 (2026-08-06 실측).
    ? { types: { "application/rss+xml": `${SITE_URL}/feed.xml` } }
    : {};

export function storyMetadata(locale: SeoLocale, id: string): Metadata {
  const name = nameOf(locale, id);
  const title = (loreOnly(id) ? LORE_TITLE : TITLE)[locale](name);
  const description = descOf(locale, id);
  // 요약 91편이 세 로케일 모두 있으므로 hreflang은 항상 3개 + x-default(한국어)
  const languages = {
    ko: urlOf("ko", id), en: urlOf("en", id), ja: urlOf("ja", id), "x-default": urlOf("ko", id),
  };
  // OG는 스토리 탭 공용 이미지 — 이벤트 썸네일은 420×508 세로라 OG 규격(1200×630)에 안 맞는다
  const ogImage = asset(`/og/${locale}/story.jpg`);
  const siteName = locale === "ko" ? "테라 아카이브" : locale === "ja" ? "テラアーカイブ" : "Terra Archive";
  return {
    title,
    description,
    alternates: { canonical: urlOf(locale, id), languages, ...RSS_ALT(locale) },
    robots: { index: true, follow: true },
    openGraph: {
      title, description, type: "article", url: urlOf(locale, id), siteName,
      locale: locale === "ko" ? "ko_KR" : locale === "ja" ? "ja_JP" : "en_US",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    // site/creator = 운영 계정 — 공유 카드에 계정이 표시되고 X 애널리틱스에 잡힌다
    twitter: { card: "summary_large_image", site: "@naru35405955", creator: "@naru35405955", title, description, images: [ogImage] },
  };
}

export function storyJsonLd(locale: SeoLocale, id: string) {
  const name = nameOf(locale, id);
  const meta = BY_ID.get(id);
  const siteName = locale === "ko" ? "테라 아카이브" : locale === "ja" ? "テラアーカイブ" : "Terra Archive";
  const listLabel = locale === "ko" ? "스토리" : locale === "ja" ? "ストーリー" : "Story";
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: (loreOnly(id) ? LORE_TITLE : TITLE)[locale](name).split(" | ")[0],
        description: descOf(locale, id),
        inLanguage: locale,
        url: urlOf(locale, id),
        mainEntityOfPage: urlOf(locale, id),
        // 게임 출시월만 알고 일자는 모른다 — 있는 정보만 넣는다 (없으면 생략)
        ...(meta?.start ? { datePublished: `${meta.start}-01` } : {}),
        isAccessibleForFree: true,
        publisher: { "@type": "Organization", name: siteName, url: SITE_URL },
        about: { "@type": "VideoGame", name: locale === "ja" ? "アークナイツ" : locale === "en" ? "Arknights" : "명일방주" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: siteName, item: `${SITE_URL}${LOCALE_BASE[locale] || "/"}` },
          { "@type": "ListItem", position: 2, name: listLabel, item: `${SITE_URL}${LOCALE_BASE[locale]}/stories` },
          { "@type": "ListItem", position: 3, name },
        ],
      },
    ],
  };
}
