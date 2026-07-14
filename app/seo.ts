// 로케일별 SEO 메타데이터의 정본 — 라우트(/ /en /ja) 페이지가 공유한다.
// 프리뷰 배포(*.pages.dev 해시 서브도메인)도 항상 본 사이트를 정본(canonical)으로 가리킨다.
import type { Metadata } from "next";

export const SITE_URL = "https://terra-archive.pages.dev";

type SeoLocale = "ko" | "en" | "ja";
export type SeoTab = "archive" | "planner" | "recruit" | "farm" | "story";

// 탭 → URL 세그먼트 (archive는 로케일 루트). 라우트 폴더명과 반드시 일치.
export const TAB_SEG: Record<SeoTab, string> = {
  archive: "", planner: "infra", recruit: "recruit", farm: "farm", story: "stories",
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

// 탭별 제목·설명 (archive는 아래 META의 기본값 사용)
const TAB_META: Record<Exclude<SeoTab, "archive">, Record<SeoLocale, { title: string; description: string }>> = {
  planner: {
    ko: { title: "인프라 플래너 - 명일방주 기반시설 편성 | 테라 아카이브", description: "명일방주 기반시설(RIIC) 자동 편성 플래너 — 보유 오퍼레이터로 제조소·무역소·발전소 최적 배치를 계산합니다." },
    en: { title: "Base Planner - Arknights RIIC Base | Terra Archive", description: "Arknights RIIC base auto-assignment planner — computes the optimal factory, trading post, and power plant layout from your roster." },
    ja: { title: "基地プランナー - アークナイツ基地編成 | テラアーカイブ", description: "アークナイツ基地（インフラ）自動編成プランナー — 手持ちオペレーターで製造所・貿易所・発電所の最適配置を計算します。" },
  },
  recruit: {
    ko: { title: "공채 도우미 - 명일방주 공개모집 계산기 | 테라 아카이브", description: "명일방주 공개모집(공채) 태그 계산기 — 태그 조합으로 확정·고성급 오퍼레이터를 찾아줍니다." },
    en: { title: "Recruit Helper - Arknights Recruitment Calculator | Terra Archive", description: "Arknights recruitment tag calculator — finds guaranteed and high-rarity operators from your tag combinations." },
    ja: { title: "公開求人ヘルパー - アークナイツ公開求人計算機 | テラアーカイブ", description: "アークナイツ公開求人タグ計算機 — タグの組み合わせから確定・高レアオペレーターを見つけます。" },
  },
  farm: {
    ko: { title: "재료 파밍 효율표 - 명일방주 파밍 가이드 | 테라 아카이브", description: "명일방주 재료 파밍 효율표 — 재료별 최적 파밍 스테이지와 이성 효율을 정리했습니다." },
    en: { title: "Material Farming Efficiency - Arknights Farming Guide | Terra Archive", description: "Arknights material farming efficiency table — the best stage and sanity efficiency for each material." },
    ja: { title: "素材周回効率表 - アークナイツ周回ガイド | テラアーカイブ", description: "アークナイツ素材周回効率表 — 素材ごとの最適ステージと理性効率をまとめました。" },
  },
  story: {
    ko: { title: "AI 이벤트 스토리 요약 - 명일방주 이벤트 스토리 요약 | 테라 아카이브", description: "명일방주 이벤트 스토리 AI 요약 아카이브 — 사이드 스토리를 컷씬과 함께 10분 분량으로 요약합니다." },
    en: { title: "AI Event Story Digest - Arknights Event Story Summaries | Terra Archive", description: "AI-written Arknights event story digest archive — side stories summarized with cutscenes in a 10-minute read." },
    ja: { title: "AIイベントストーリー要約 - アークナイツイベントストーリー要約 | テラアーカイブ", description: "アークナイツのイベントストーリーAI要約アーカイブ — サイドストーリーをカットシーンと共に10分で要約します。" },
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

export function pageMetadata(locale: SeoLocale, tab: SeoTab = "archive"): Metadata {
  const meta = META[locale];
  const tabMeta = tab === "archive" ? null : TAB_META[tab][locale];
  const title = tabMeta?.title ?? meta.title;
  const description = tabMeta?.description ?? meta.description;
  const url = `${SITE_URL}${pathFor(locale, tab)}`;
  return {
    title,
    description,
    keywords: meta.keywords,
    alternates: { canonical: url, languages: languagesFor(tab) },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      type: "website",
      url,
      siteName: meta.siteName,
      locale: meta.ogLocale,
      alternateLocale: Object.values(META).filter((m) => m !== meta).map((m) => m.ogLocale),
      images: [{ url: "/og.png", width: 1200, height: 630, alt: meta.siteName }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

export function jsonLdFor(locale: SeoLocale, tab: SeoTab = "archive") {
  const meta = META[locale];
  const tabMeta = tab === "archive" ? null : TAB_META[tab][locale];
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: meta.siteName,
    alternateName: ["Terra Archive", "테라 아카이브", "テラアーカイブ", "명일방주 팬사이트"],
    url: `${SITE_URL}${pathFor(locale, tab)}`,
    description: tabMeta?.description ?? meta.description,
    inLanguage: locale,
  };
}
