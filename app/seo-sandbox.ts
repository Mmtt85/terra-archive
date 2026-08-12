// 생존연산 시즌 페이지(/ra/<slug>)의 메타데이터 — 서버(빌드) 전용.
//
// 시즌마다 실제 정적 페이지를 둔다 (사용자 확정 2026-08-12 "한섭이랑 중섭 메뉴를
// 아예 나눠줘 록라처럼") — 통합전략 테마(/rogue/<slug>)와 같은 규격이다.
//   sand   = 사막 이야기 (sandbox_1, 한국 서버 상설)
//   anchor = 재기동 앵커 (sandbox_2, 중국 서버 선행 — 미래시)
import type { Metadata } from "next";
import { asset } from "./assets";
import { SITE_URL } from "./seo";

type SeoLocale = "ko" | "en" | "ja";
const LOCALE_BASE: Record<SeoLocale, string> = { ko: "", en: "/en", ja: "/ja" };

export const sandboxSlugs = ["sand", "anchor"] as const;
export type SandboxSlug = (typeof sandboxSlugs)[number];

const META: Record<SandboxSlug, Record<SeoLocale, { name: string; title: string; desc: string }>> = {
  sand: {
    ko: {
      name: "사막 이야기",
      title: "사막 이야기 - 명일방주 생존연산 공략 | 테라 아카이브",
      desc: "명일방주 생존연산 상설 「사막 이야기」 — 요리 53종 조합과 α·β·γ 변형, 제작·설치물 96종, 지역 106곳의 도면·등장 적·이동 경로, 조우 선택지, 균열 목표와 보상까지 정리했습니다.",
    },
    en: {
      name: "Tales Within the Sand",
      title: "Tales Within the Sand - Arknights Reclamation Algorithm | Terra Archive",
      desc: "Arknights Reclamation Algorithm permanent season — 53 food recipes with α/β/γ variants, 96 craftable structures, 106 areas with layouts, enemies and routes, encounter choices, and rift objectives.",
    },
    ja: {
      name: "砂中の遺聞",
      title: "砂中の遺聞 - アークナイツ生息演算攻略 | テラアーカイブ",
      desc: "アークナイツ生息演算の常設シーズン — 料理53種のレシピとα・β・γ変種、製作・設置物96種、エリア106箇所の地形図・出現する敵・移動ルート、遭遇の選択肢、裂け目の目標と報酬を整理しました。",
    },
  },
  anchor: {
    ko: {
      name: "재기동 앵커",
      title: "재기동 앵커(重启锚点) - 명일방주 생존연산 신시즌 | 테라 아카이브",
      desc: "중국 서버 선행 생존연산 신시즌 「重启锚点」 — 아이템 381종, 가공·건설 레시피, 지역과 날씨, 조우를 중국어 원문과 비공식 한국어 번역으로 미리 봅니다.",
    },
    en: {
      name: "重启锚点 (Reboot Anchor)",
      title: "重启锚点 - Arknights Reclamation Algorithm New Season | Terra Archive",
      desc: "The CN-first Reclamation Algorithm season — 381 items, processing and building recipes, areas, weather and encounters, shown in the original Chinese.",
    },
    ja: {
      name: "重启锚点",
      title: "重启锚点 - アークナイツ生息演算 新シーズン | テラアーカイブ",
      desc: "中国サーバー先行の生息演算新シーズン「重启锚点」 — アイテム381種、加工・建設レシピ、エリアと天候、遭遇を原文（中国語）で先取りできます。",
    },
  },
};

export const sandboxName = (locale: SeoLocale, slug: SandboxSlug) => META[slug][locale].name;

const urlOf = (locale: SeoLocale, slug: SandboxSlug) => `${SITE_URL}${LOCALE_BASE[locale]}/ra/${slug}`;

export function sandboxMetadata(locale: SeoLocale, slug: string): Metadata {
  const sl = (sandboxSlugs as readonly string[]).includes(slug) ? (slug as SandboxSlug) : "sand";
  const m = META[sl][locale];
  const url = urlOf(locale, sl);
  const ogImage = asset(`/og/${locale}/ra.jpg`);
  return {
    title: m.title,
    description: m.desc,
    alternates: {
      canonical: url,
      languages: {
        ko: urlOf("ko", sl), en: urlOf("en", sl), ja: urlOf("ja", sl), "x-default": urlOf("ko", sl),
      },
    },
    robots: { index: true, follow: true },
    openGraph: {
      title: m.title, description: m.desc, type: "article", url,
      images: [{ url: ogImage, width: 1200, height: 630, alt: m.title }],
    },
    twitter: { card: "summary_large_image", site: "@naru35405955", title: m.title, description: m.desc, images: [ogImage] },
  };
}

export function sandboxJsonLd(locale: SeoLocale, slug: string) {
  const sl = (sandboxSlugs as readonly string[]).includes(slug) ? (slug as SandboxSlug) : "sand";
  const m = META[sl][locale];
  const home = `${SITE_URL}${LOCALE_BASE[locale]}/`;
  return {
    "@context": "https://schema.org",
    "@graph": [{
      "@type": "Article",
      headline: m.title.split(" - ")[0],
      description: m.desc,
      inLanguage: locale,
      mainEntityOfPage: urlOf(locale, sl),
    }, {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Terra Archive", item: home },
        { "@type": "ListItem", position: 2, name: locale === "ko" ? "생존연산 가이드" : locale === "ja" ? "生息演算ガイド" : "Reclamation Algorithm Guide", item: `${SITE_URL}${LOCALE_BASE[locale]}/ra` },
        { "@type": "ListItem", position: 3, name: m.name },
      ],
    }],
  };
}
