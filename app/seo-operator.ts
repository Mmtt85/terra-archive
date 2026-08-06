// 오퍼레이터 상세 페이지(/operators/<id>)의 메타데이터 — 서버(빌드) 전용.
//
// 왜 있나 (2026-08-06): 상세가 #op-<id> 해시 모달뿐이라 검색엔진에는 존재하지 않는 화면이었다.
// "명일방주 <오퍼> 인프라 스킬" 같은 롱테일 수요가 전부 /operators 한 장으로 몰려 있었다.
//
// ⚠ 미실장(중국 서버 선행) 오퍼는 라우트를 만들지 않는다 — 텍스트가 비공식 AI 번역이라
//    정식 출시 시 바뀌고, 색인된 뒤 내용이 통째로 갈리는 편이 검색 품질에 더 나쁘다.
//    (사이트에서는 '미래시 포함' 토글로 계속 볼 수 있다.)
import type { Metadata } from "next";
import { asset } from "./assets";
import { SITE_URL } from "./seo";
import operatorsKo from "./data/operators.json";
import operatorsEn from "./data/operators.en.json";
import operatorsJa from "./data/operators.ja.json";

type SeoLocale = "ko" | "en" | "ja";
type OpMeta = {
  id: string; name: string; code: string; rarity: number; job: string; subProfession: string;
  position: string; faction?: string; factions?: string[]; trait?: string; unreleased?: boolean; image?: string;
};

const LOCALE_BASE: Record<SeoLocale, string> = { ko: "", en: "/en", ja: "/ja" };
const ROSTER: Record<SeoLocale, OpMeta[]> = {
  ko: operatorsKo as unknown as OpMeta[],
  en: operatorsEn as unknown as OpMeta[],
  ja: operatorsJa as unknown as OpMeta[],
};
const BY_ID: Record<SeoLocale, Map<string, OpMeta>> = {
  ko: new Map(ROSTER.ko.map((o) => [o.id, o])),
  en: new Map(ROSTER.en.map((o) => [o.id, o])),
  ja: new Map(ROSTER.ja.map((o) => [o.id, o])),
};

/** 정식 출시된 오퍼 id 전부 — 라우트 생성(generateStaticParams)용 */
export const operatorIds = ROSTER.ko.filter((o) => !o.unreleased).map((o) => o.id);

const opOf = (locale: SeoLocale, id: string) => BY_ID[locale].get(id) ?? BY_ID.ko.get(id);

const TITLE: Record<SeoLocale, (name: string) => string> = {
  // ⚠ 하이드레이션 후 app/home.tsx의 document.title도 같은 문구로 맞춘다 (i18n 사전 같은 키)
  ko: (name) => `${name} - 명일방주 오퍼레이터 | 테라 아카이브`,
  en: (name) => `${name} - Arknights Operator | Terra Archive`,
  ja: (name) => `${name} - アークナイツ オペレーター | テラアーカイブ`,
};

// 설명은 그 오퍼의 실제 데이터로 만든다 — 성급·직군·세부직군·소속 + 특성 한 줄.
// 420장이 같은 문장 틀을 쓰지만 채워지는 값이 전부 달라 중복으로 잡히지 않는다.
function descOf(locale: SeoLocale, id: string): string {
  const op = opOf(locale, id);
  if (!op) return "";
  const faction = op.factions?.[0] ?? op.faction ?? "";
  const trait = (op.trait ?? "").replace(/\s+/g, " ").trim();
  const head = locale === "ko"
    ? `${op.name}(${op.code}) — ${op.rarity}성 ${op.job} · ${op.subProfession}${faction ? ` · ${faction}` : ""}.`
    : locale === "ja"
      ? `${op.name}（${op.code}）— ★${op.rarity} ${op.job}・${op.subProfession}${faction ? `・${faction}` : ""}。`
      : `${op.name} (${op.code}) — ${op.rarity}★ ${op.job} · ${op.subProfession}${faction ? ` · ${faction}` : ""}.`;
  const tail = locale === "ko"
    ? "스탯·스킬·재능·모듈·인프라 스킬·프로필·보이스를 한 페이지에서 봅니다."
    : locale === "ja"
      ? "ステータス・スキル・才能・モジュール・基地スキル・プロフィール・ボイスをまとめて確認できます。"
      : "Stats, skills, talents, modules, base skills, profile, and voice lines on one page.";
  // 특성 문장은 마침표가 없는 경우가 많다 — 뒤 문장과 붙어 읽히지 않게 끝을 맺어 준다
  const traitSentence = trait ? `${trait}${/[.。!?！？]$/.test(trait) ? "" : locale === "ja" ? "。" : "."}` : "";
  const full = `${head}${traitSentence ? ` ${traitSentence}` : ""} ${tail}`;
  return full.length > 158 ? `${full.slice(0, 157).trimEnd()}…` : full;
}

const urlOf = (locale: SeoLocale, id: string) => `${SITE_URL}${LOCALE_BASE[locale]}/operators/${id}`;

export function operatorMetadata(locale: SeoLocale, id: string): Metadata {
  const op = opOf(locale, id);
  const name = op?.name ?? id;
  const title = TITLE[locale](name);
  const description = descOf(locale, id);
  const languages = {
    ko: urlOf("ko", id), en: urlOf("en", id), ja: urlOf("ja", id), "x-default": urlOf("ko", id),
  };
  // OG는 백과사전 탭 공용 이미지 — 오퍼 초상은 180×180 정사각이라 OG 규격(1200×630)에 안 맞는다
  const ogImage = asset(`/og/${locale}/archive.jpg`);
  const siteName = locale === "ko" ? "테라 아카이브" : locale === "ja" ? "テラアーカイブ" : "Terra Archive";
  return {
    title,
    description,
    alternates: { canonical: urlOf(locale, id), languages },
    robots: { index: true, follow: true },
    openGraph: {
      title, description, type: "profile", url: urlOf(locale, id), siteName,
      locale: locale === "ko" ? "ko_KR" : locale === "ja" ? "ja_JP" : "en_US",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
  };
}

export function operatorJsonLd(locale: SeoLocale, id: string) {
  const op = opOf(locale, id);
  const name = op?.name ?? id;
  const siteName = locale === "ko" ? "테라 아카이브" : locale === "ja" ? "テラアーカイブ" : "Terra Archive";
  const listLabel = locale === "ko" ? "오퍼레이터 백과사전" : locale === "ja" ? "オペレーター図鑑" : "Operator Archive";
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        // 게임 캐릭터 문서 — Person이 아니라 게임 소속 항목임을 about으로 묶는다
        "@type": "Article",
        headline: TITLE[locale](name).split(" | ")[0],
        description: descOf(locale, id),
        inLanguage: locale,
        url: urlOf(locale, id),
        mainEntityOfPage: urlOf(locale, id),
        isAccessibleForFree: true,
        ...(op?.image ? { image: asset(op.image) } : {}),
        publisher: { "@type": "Organization", name: siteName, url: SITE_URL },
        about: { "@type": "VideoGame", name: locale === "ja" ? "アークナイツ" : locale === "en" ? "Arknights" : "명일방주" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: siteName, item: `${SITE_URL}${LOCALE_BASE[locale] || "/"}` },
          { "@type": "ListItem", position: 2, name: listLabel, item: `${SITE_URL}${LOCALE_BASE[locale]}/operators` },
          { "@type": "ListItem", position: 3, name },
        ],
      },
    ],
  };
}
