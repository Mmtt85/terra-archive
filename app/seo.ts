// 로케일별 SEO 메타데이터의 정본 — 라우트(/ /en /ja) 페이지가 공유한다.
// 정본 도메인은 terra-archive.net (2026-07 사용자가 구매·연결). Cloudflare Pages 기본
// 도메인(terra-archive.pages.dev)과 프리뷰 배포(*.pages.dev)도 전부 이 SITE_URL을 canonical·
// hreflang·OG로 내보내므로, 어느 도메인으로 크롤링되든 검색엔진이 .net으로 통합한다
// (중복 콘텐츠 방지). 도메인을 바꾸면 여기 + scripts/build-sitemap.mjs + public/robots.txt를 함께 수정
// (sitemap.xml은 빌드 시 build-sitemap.mjs가 라우트 스캔으로 자동 생성 — 직접 수정 금지).
import type { Metadata } from "next";
import { asset } from "./assets";

export const SITE_URL = "https://terra-archive.net";

type SeoLocale = "ko" | "en" | "ja";
export type SeoTab = "portal" | "archive" | "planner" | "recruit" | "farm" | "upgrade" | "story" | "rogue" | "about";

// 탭 → URL 세그먼트 (portal이 로케일 루트, 오퍼 백과사전은 /operators로 분리 — 사용자 확정
// 2026-07-17: 루트 진입 시 오퍼 이미지 강제 로딩을 없애기 위해 포탈 첫화면 도입). 라우트 폴더명과 반드시 일치.
export const TAB_SEG: Record<SeoTab, string> = {
  portal: "", archive: "operators", planner: "infra", recruit: "recruit", farm: "farm", upgrade: "upgrade", story: "stories", rogue: "rogue", about: "about",
};

// 로케일 베이스 경로
const LOCALE_BASE: Record<SeoLocale, string> = { ko: "", en: "/en", ja: "/ja" };

function pathFor(locale: SeoLocale, tab: SeoTab): string {
  const seg = TAB_SEG[tab];
  const p = LOCALE_BASE[locale] + (seg ? `/${seg}` : "");
  return p || "/";
}

// 같은 탭의 세 언어 상호 참조 (hreflang). 탭별로 언어 세트가 달라진다.
function languagesFor(tab: SeoTab) {
  return {
    ko: `${SITE_URL}${pathFor("ko", tab)}`,
    en: `${SITE_URL}${pathFor("en", tab)}`,
    ja: `${SITE_URL}${pathFor("ja", tab)}`,
    "x-default": `${SITE_URL}${pathFor("ko", tab)}`,
  };
}

// 탭별 제목·설명 (portal은 아래 META의 기본값=사이트 허브 메타를 그대로 쓴다)
const TAB_META: Record<Exclude<SeoTab, "portal">, Record<SeoLocale, { title: string; description: string }>> = {
  archive: {
    ko: { title: "오퍼레이터 백과사전 - 명일방주 오퍼 도감 | 테라 아카이브", description: "명일방주(아크나이츠) 오퍼레이터 백과사전 — 소속·직군·태그·시너지로 필터·검색하고, 오퍼레이터 상세 정보와 별명을 확인하세요." },
    en: { title: "Operator Archive - Arknights Operator Database | Terra Archive", description: "Arknights operator encyclopedia — filter and search by faction, class, tags, and synergy, and browse full operator details." },
    ja: { title: "オペレーター図鑑 - アークナイツ オペレーター一覧 | テラアーカイブ", description: "アークナイツのオペレーター図鑑 — 所属・クラス・タグ・シナジーで絞り込み検索し、オペレーターの詳細情報を確認できます。" },
  },
  planner: {
    ko: { title: "인프라 자동편성기 - 명일방주 기반시설 편성 | 테라 아카이브", description: "명일방주 기반시설(RIIC) 자동 편성 플래너 — 보유 오퍼레이터만 입력하면 제조소·무역소·발전소 편성을 자동으로 짜줍니다." },
    en: { title: "Base Auto-Planner - Arknights RIIC Base | Terra Archive", description: "Arknights RIIC base auto-assignment planner — just enter your roster and it builds the optimal factory, trading post, and power plant layout for you." },
    ja: { title: "基地自動編成 - アークナイツ基地編成 | テラアーカイブ", description: "アークナイツ基地（インフラ）自動編成プランナー — 手持ちオペレーターを入力するだけで製造所・貿易所・発電所の編成を自動で組んでくれます。" },
  },
  recruit: {
    ko: { title: "공채 도우미 - 명일방주 공개모집 계산기 | 테라 아카이브", description: "명일방주 공개모집(공채) 태그 계산기 — 태그 조합으로 확정·고성급 오퍼레이터를 찾아줍니다." },
    en: { title: "Recruit Helper - Arknights Recruitment Calculator | Terra Archive", description: "Arknights recruitment tag calculator — finds guaranteed and high-rarity operators from your tag combinations." },
    ja: { title: "公開求人ヘルパー - アークナイツ公開求人計算機 | テラアーカイブ", description: "アークナイツ公開求人タグ計算機 — タグの組み合わせから確定・高レアオペレーターを見つけます。" },
  },
  farm: {
    ko: { title: "파밍 도우미 - 명일방주 재료 파밍 효율표 | 테라 아카이브", description: "명일방주 재료 파밍 효율표 — 정예화 재료별 최적 파밍 스테이지와 개당 기대 이성을 펭귄 물류 실측 드랍 통계로 확인합니다." },
    en: { title: "Farming Helper - Arknights Material Farming Efficiency | Terra Archive", description: "Arknights material farming efficiency table — the best farming stage and sanity-per-item for every Elite material, from Penguin Logistics real drop statistics." },
    ja: { title: "周回ヘルパー - アークナイツ素材周回効率表 | テラアーカイブ", description: "アークナイツ素材周回効率表 — 昇進素材ごとの最適ステージと1個あたりの期待理性を、ペンギン急便の実測ドロップ統計で確認します。" },
  },
  upgrade: {
    ko: { title: "오퍼 육성 시뮬 - 명일방주 육성 비용 계산기 | 테라 아카이브", description: "명일방주 오퍼레이터 육성 비용 계산기 — 레벨·정예화·스킬·특화·모듈 목표 단계까지 필요한 용문폐·경험치·재료 총량을 합산합니다." },
    en: { title: "Operator Upgrade Sim - Arknights Upgrade Cost Calculator | Terra Archive", description: "Arknights operator upgrade cost calculator — total LMD, EXP, and materials needed to reach your target level, Elite, skills, masteries, and modules." },
    ja: { title: "オペレーター育成シミュ - アークナイツ育成コスト計算機 | テラアーカイブ", description: "アークナイツ育成コスト計算機 — レベル・昇進・スキル・特化・モジュールの目標段階までに必要な龍門幣・経験値・素材の合計を集計します。" },
  },
  story: {
    ko: { title: "AI 스토리 요약 - 명일방주 스토리 요약 | 테라 아카이브", description: "명일방주 이벤트 스토리 AI 요약 아카이브 — 사이드 스토리를 컷씬과 함께 10분 분량으로 요약합니다." },
    en: { title: "AI Story Digest - Arknights Story Summaries | Terra Archive", description: "AI-written Arknights event story digest archive — side stories summarized with cutscenes in a 10-minute read." },
    ja: { title: "AIストーリー要約 - アークナイツストーリー要約 | テラアーカイブ", description: "アークナイツのイベントストーリーAI要約アーカイブ — サイドストーリーをカットシーンと共に10分で要約します。" },
  },
  rogue: {
    ko: { title: "통합전략 가이드 - 명일방주 통합전략 공략 | 테라 아카이브", description: "명일방주 통합전략(IS) 가이드 — 팬텀 & 크림슨 솔리테어의 층별 노드, 적 도감(난이도 0~15 스탯 적용), 소장품·레퍼토리 전시관, 환각, 엔딩 조건을 정리합니다." },
    en: { title: "Integrated Strategies Guide - Arknights IS Guide | Terra Archive", description: "Arknights Integrated Strategies guide — Phantom & Crimson Solitaire floor nodes, enemy handbook with difficulty 0-15 stats, relic/repertoire archive, hallucinations, and ending requirements." },
    ja: { title: "統合戦略ガイド - アークナイツ統合戦略攻略 | テラアーカイブ", description: "アークナイツ統合戦略ガイド — ファントムと緋き貴石の各階層ノード、難易度0～15対応の敵図鑑、収蔵品・レパートリー、幻覚、エンディング条件を整理します。" },
  },
  about: {
    ko: { title: "소개 - 기능 안내 | 테라 아카이브", description: "테라 아카이브의 기능 소개 — 오퍼 백과사전, 인프라 자동편성기, 공채 도우미, 파밍·육성 시뮬, AI 스토리 요약이 각각 무엇이고 어떤 상황에 쓰는지 안내합니다." },
    en: { title: "About - Feature Guide | Terra Archive", description: "About Terra Archive — what the operator encyclopedia, base auto-planner, recruitment helper, farming/upgrade simulator, and AI story digest do, and when to use each." },
    ja: { title: "紹介 - 機能ガイド | テラアーカイブ", description: "テラアーカイブの機能紹介 — オペレーター図鑑、基地自動編成、公開求人ヘルパー、周回・育成シミュ、AIストーリー要約が何で、どんな時に使うのかを案内します。" },
  },
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
    title: "테라 아카이브 | 명일방주(Arknights) 팬사이트",
    description: "명일방주(아크나이츠) 팬사이트 — 오퍼레이터 백과사전, 기반시설(인프라) 자동 편성 플래너, 공개모집(공채) 태그 계산기, 재료 파밍 효율표.",
    keywords: ["명일방주", "아크나이츠", "Arknights", "오퍼레이터", "오퍼레이터 도감", "인프라", "기반시설", "기반시설 편성", "공개모집", "공채 계산기", "공개모집 태그", "재료 파밍", "파밍 효율", "이성 효율", "테라 아카이브"],
  },
  en: {
    path: "/en",
    ogLocale: "en_US",
    siteName: "Terra Archive",
    title: "Terra Archive | Arknights Operator Database, Base Planner & Recruitment Calculator",
    description: "Arknights fansite — full operator encyclopedia, RIIC base auto-assignment planner, recruitment tag calculator, and material farming efficiency guide, available in English.",
    keywords: ["Arknights", "operators", "operator database", "RIIC", "base planner", "base layout", "recruitment calculator", "recruitment tags", "material farming", "sanity efficiency", "farming guide", "Terra Archive"],
  },
  ja: {
    path: "/ja",
    ogLocale: "ja_JP",
    siteName: "テラアーカイブ",
    title: "テラアーカイブ | アークナイツ オペレーター図鑑・基地編成・公開求人計算機",
    description: "アークナイツのファンサイト — オペレーター図鑑、基地（インフラ）自動編成プランナー、公開求人タグ計算機、素材周回効率表を日本語で提供。",
    keywords: ["アークナイツ", "Arknights", "オペレーター", "オペレーター図鑑", "基地", "基地編成", "公開求人", "公開求人 計算機", "求人タグ", "素材周回", "理性効率", "テラアーカイブ"],
  },
};

// AI 스토리 요약 발행 피드(public/feed.xml)는 한국어 본문이라 **한국어 페이지에만** 건다.
// ⚠ alternates는 페이지 값이 레이아웃 값을 통째로 덮으므로 레이아웃이 아니라 여기서 붙인다.
const RSS_ALT = (locale: SeoLocale) =>
  locale === "ko"
    // ⚠ 문자열 형태로 준다 — vinext 메타데이터 렌더러가 {url,title} 객체 형태를 못 풀어
    //    href="[object Object]"가 나간다 (2026-08-06 실측).
    ? { types: { "application/rss+xml": `${SITE_URL}/feed.xml` } }
    : {};

export function pageMetadata(locale: SeoLocale, tab: SeoTab = "portal"): Metadata {
  const meta = META[locale];
  const tabMeta = tab === "portal" ? null : TAB_META[tab][locale];
  const title = tabMeta?.title ?? meta.title;
  const description = tabMeta?.description ?? meta.description;
  const url = `${SITE_URL}${pathFor(locale, tab)}`;
  // 로케일×탭별 전용 OG 이미지 (scripts/build-og.py 생성) — '모든 페이지 동일' 문제 해결.
  const ogImage = asset(`/og/${locale}/${tab}.jpg`);
  return {
    title,
    description,
    keywords: meta.keywords,
    alternates: { canonical: url, languages: languagesFor(tab), ...RSS_ALT(locale) },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      type: "website",
      url,
      siteName: meta.siteName,
      locale: meta.ogLocale,
      alternateLocale: Object.values(META).filter((m) => m !== meta).map((m) => m.ogLocale),
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    // site/creator = 운영 계정 — 공유 카드에 계정이 표시되고 X 애널리틱스에 잡힌다
    twitter: { card: "summary_large_image", site: "@naru35405955", creator: "@naru35405955", title, description, images: [ogImage] },
  };
}

// 탭 표시명 — 제목("오퍼레이터 백과사전 - 명일방주 오퍼 도감 | 테라 아카이브")의 앞부분.
// 탐색 경로(BreadcrumbList)와 도구 이름에 쓴다. 제목 문구가 정본이라 따로 관리하지 않는다.
function tabName(locale: SeoLocale, tab: Exclude<SeoTab, "portal">): string {
  return TAB_META[tab][locale].title.split(" - ")[0].split(" | ")[0].trim();
}

// 계산기·시뮬레이터 성격의 탭 — 브라우저에서 바로 돌아가는 무료 웹 도구임을 밝힌다.
// (평점·설치수 같은 건 없으므로 지어내지 않는다 — aggregateRating 없이 엔티티만 준다.)
const TOOL_TABS: SeoTab[] = ["planner", "recruit", "upgrade", "farm"];
const APP_CATEGORY: Record<SeoLocale, string> = {
  ko: "게임 유틸리티", en: "GameApplication", ja: "ゲームユーティリティ",
};
const BROWSER_REQ: Record<SeoLocale, string> = {
  ko: "자바스크립트를 지원하는 최신 브라우저",
  en: "Requires a modern browser with JavaScript",
  ja: "JavaScript対応の最新ブラウザが必要",
};

/**
 * 페이지의 구조화 데이터. WebSite 하나만 내보내다가 @graph로 넓혔다 (2026-08-06):
 *  · BreadcrumbList — 검색 결과에 "테라 아카이브 › 인프라 자동편성기" 경로가 뜬다
 *  · WebApplication — 편성기·공채·육성·파밍은 읽을거리가 아니라 도구라는 신호
 * (사이트링크 검색창 SearchAction은 구글이 2024년에 폐지해 넣지 않는다.)
 */
export function jsonLdFor(locale: SeoLocale, tab: SeoTab = "portal") {
  const meta = META[locale];
  const tabMeta = tab === "portal" ? null : TAB_META[tab][locale];
  const url = `${SITE_URL}${pathFor(locale, tab)}`;
  const home = `${SITE_URL}${pathFor(locale, "portal")}`;
  const description = tabMeta?.description ?? meta.description;

  const graph: Record<string, unknown>[] = [{
    "@type": "WebSite",
    "@id": `${home}#website`,
    name: meta.siteName,
    alternateName: ["Terra Archive", "테라 아카이브", "テラアーカイブ", "명일방주 팬사이트"],
    url: home,
    description: meta.description,
    inLanguage: locale,
    publisher: { "@type": "Organization", name: meta.siteName, url: home },
  }];

  if (tab !== "portal") {
    const name = tabName(locale, tab);
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: meta.siteName, item: home },
        { "@type": "ListItem", position: 2, name },
      ],
    });
    if (TOOL_TABS.includes(tab)) {
      graph.push({
        "@type": "WebApplication",
        name,
        url,
        description,
        inLanguage: locale,
        applicationCategory: APP_CATEGORY[locale],
        operatingSystem: "Any",
        browserRequirements: BROWSER_REQ[locale],
        isAccessibleForFree: true,
        publisher: { "@type": "Organization", name: meta.siteName, url: home },
      });
    }
  }
  return { "@context": "https://schema.org", "@graph": graph };
}
