// 작전 상세 페이지(/stages/<id>)의 메타데이터 + 본문 데이터 공급 — 서버(빌드) 전용.
//
// app/seo-enemy.ts와 같은 구조다: stages.json이 로케일당 1.25MB라 클라이언트 번들에 실을 수
// 없고, 본문을 lazy로 감싸면 HTML이 빈 껍데기로 색인된다. 그래서 서버가 그 작전 하나를
// 화면이 바로 쓸 수 있는 형태(StageView)로 풀어 props로 내려 준다.
//
// ⚠ **상세 라우트는 상시 콘텐츠에만 만든다** (사용자 확정 2026-08-09).
//    Cloudflare Pages는 배포당 20,000파일이 한도인데, 작전 2,224개를 3개 언어로 전부
//    펼치면 그것만 13,000파일이라 한도를 넘긴다. 그래서 메인·막간·섬멸·자원 확보·보안
//    파견(상시로 열려 있어 검색 수요가 꾸준한 것)만 개별 페이지를 갖고, 종료된 이벤트는
//    목록과 모달(#st-<id>)로만 본다. 이 목록을 넓히려면 파일 수부터 다시 재야 한다.
import type { Metadata } from "next";
import { asset } from "./assets";
import { SITE_URL } from "./seo";
// ⚠ "use client" 없는 순수 데이터 모듈에서 가져온다 — stage-detail.tsx에서 가져오면
//   빌드가 "client reference export is called on server"로 죽는다 (2026-08-09 실측).
import { viewOf, type EnemyStatsIndex, type StageDoc, type StageView } from "./stage-data";
import stagesKo from "./data/stages.json";
import stagesEn from "./data/stages.en.json";
import stagesJa from "./data/stages.ja.json";
// 적 칩의 HP·공격·방어·마저 — 서버 전용 임포트라 클라이언트 번들에는 실리지 않고,
// 페이지 직렬화에는 그 작전의 적 몇 마리 것만 담긴다
import enemyStats from "./data/enemy-stats.json";

type SeoLocale = "ko" | "en" | "ja";

const LOCALE_BASE: Record<SeoLocale, string> = { ko: "", en: "/en", ja: "/ja" };
const DOC: Record<SeoLocale, StageDoc> = {
  ko: stagesKo as unknown as StageDoc,
  en: stagesEn as unknown as StageDoc,
  ja: stagesJa as unknown as StageDoc,
};
const BY_ID: Record<SeoLocale, Map<string, StageView>> = {
  ko: new Map(), en: new Map(), ja: new Map(),
};
for (const loc of ["ko", "en", "ja"] as SeoLocale[]) {
  for (const s of DOC[loc].stages) BY_ID[loc].set(s.id, viewOf(DOC[loc], s, enemyStats as EnemyStatsIndex));
}

/** 개별 페이지를 갖는 작전 계열 — 위 주석의 파일 수 제약 때문에 이벤트는 뺀다 */
const PAGE_TYPES = new Set(["MAIN", "SUB", "SPECIAL_STORY", "CAMPAIGN", "DAILY", "CLIMB_TOWER"]);

/** 상세 라우트를 만들 작전 id (generateStaticParams용) */
export const stageIds = DOC.ko.stages.filter((s) => PAGE_TYPES.has(s.t)).map((s) => s.id);

/** 상세 페이지가 그릴 데이터 — 전체 사전(1.25MB)이 아니라 풀어 놓은 한 작전만 */
export function stagePageData(locale: SeoLocale, id: string): StageView | null {
  return BY_ID[locale].get(id) ?? BY_ID.ko.get(id) ?? null;
}

const TITLE: Record<SeoLocale, (code: string, name: string) => string> = {
  // ⚠ 하이드레이션 후 app/home.tsx의 document.title도 같은 문구로 맞춘다 (i18n 사전 같은 키)
  ko: (code, name) => `${code} ${name} - 명일방주 작전 | 테라 아카이브`,
  en: (code, name) => `${code} ${name} - Arknights Stage | Terra Archive`,
  ja: (code, name) => `${code} ${name} - アークナイツ 作戦 | テラアーカイブ`,
};

// 설명은 그 작전의 실제 값으로 만든다 — 계열·구역·이성·권장 편성 + 등장 적 수·주요 드랍.
function descOf(locale: SeoLocale, id: string): string {
  const v = stagePageData(locale, id);
  if (!v) return "";
  const s = v.stage;
  const bits = [v.typeName, v.zone && v.zone !== v.typeName ? v.zone : "", s.ap ? `AP ${s.ap}` : "", s.danger ?? ""]
    .filter(Boolean).join(" · ");
  const head = locale === "ja" ? `${s.code}「${s.name}」— ${bits}。` : `${s.code} ${s.name} — ${bits}.`;
  const drop = v.drops.find((d) => d.kind && d.name)?.name ?? "";
  const mid = locale === "ko"
    ? `${v.enemies.length ? `등장 적 ${v.enemies.length}종.` : ""}${drop ? ` 주요 드랍 ${drop}.` : ""}`
    : locale === "ja"
      ? `${v.enemies.length ? `出現する敵${v.enemies.length}種。` : ""}${drop ? ` 主なドロップ ${drop}。` : ""}`
      : `${v.enemies.length ? `${v.enemies.length} enemy types.` : ""}${drop ? ` Main drop: ${drop}.` : ""}`;
  const tail = locale === "ko"
    ? "지형 도면과 등장 적·드랍을 한 페이지에서 봅니다."
    : locale === "ja"
      ? "地形図と出現する敵・ドロップをまとめて確認できます。"
      : "Terrain layout, enemies, and drops on one page.";
  const full = `${head}${mid ? ` ${mid}` : ""} ${tail}`;
  return full.length > 158 ? `${full.slice(0, 157).trimEnd()}…` : full;
}

const urlOf = (locale: SeoLocale, id: string) => `${SITE_URL}${LOCALE_BASE[locale]}/stages/${id}`;

// AI 스토리 요약 발행 피드(public/feed.xml)는 한국어 본문이라 **한국어 페이지에만** 건다.
// ⚠ alternates는 페이지 값이 레이아웃 값을 통째로 덮으므로 레이아웃이 아니라 여기서 붙인다.
const RSS_ALT = (locale: SeoLocale) =>
  locale === "ko"
    // ⚠ 문자열 형태로 준다 — vinext 메타데이터 렌더러가 {url,title} 객체 형태를 못 풀어
    //    href="[object Object]"가 나간다 (2026-08-06 실측).
    ? { types: { "application/rss+xml": `${SITE_URL}/feed.xml` } }
    : {};

export function stageMetadata(locale: SeoLocale, id: string): Metadata {
  const v = stagePageData(locale, id);
  // 고난 판 id로 들어오면 viewOf가 일반판 뷰를 돌려준다 — 캐노니컬·hreflang도 일반판
  // URL로 통일해 중복 색인을 막는다 (/stages/tough_*는 딥링크용으로만 남는 200 페이지).
  const cid = v?.stage.id ?? id;
  const code = v?.stage.code ?? id;
  const name = v?.stage.name ?? "";
  const title = TITLE[locale](code, name);
  const description = descOf(locale, id);
  const languages = {
    ko: urlOf("ko", cid), en: urlOf("en", cid), ja: urlOf("ja", cid), "x-default": urlOf("ko", cid),
  };
  // OG는 작전 도감 탭 공용 이미지 — 지형 도면은 가로세로비가 제각각이라 1200×630에 안 맞는다
  const ogImage = asset(`/og/${locale}/stage.jpg`);
  const siteName = locale === "ko" ? "테라 아카이브" : locale === "ja" ? "テラアーカイブ" : "Terra Archive";
  return {
    title,
    description,
    alternates: { canonical: urlOf(locale, cid), languages, ...RSS_ALT(locale) },
    robots: { index: true, follow: true },
    openGraph: {
      title, description, type: "article", url: urlOf(locale, cid), siteName,
      locale: locale === "ko" ? "ko_KR" : locale === "ja" ? "ja_JP" : "en_US",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    // site/creator = 운영 계정 — 공유 카드에 계정이 표시되고 X 애널리틱스에 잡힌다
    twitter: { card: "summary_large_image", site: "@naru35405955", creator: "@naru35405955", title, description, images: [ogImage] },
  };
}

export function stageJsonLd(locale: SeoLocale, id: string) {
  const v = stagePageData(locale, id);
  const cid = v?.stage.id ?? id;   // 고난 판이면 일반판 URL (stageMetadata와 같은 이유)
  const code = v?.stage.code ?? id;
  const name = v?.stage.name ?? "";
  const siteName = locale === "ko" ? "테라 아카이브" : locale === "ja" ? "テラアーカイブ" : "Terra Archive";
  const listLabel = locale === "ko" ? "작전 도감" : locale === "ja" ? "作戦図鑑" : "Stage Handbook";
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: TITLE[locale](code, name).split(" | ")[0],
        description: descOf(locale, id),
        inLanguage: locale,
        url: urlOf(locale, cid),
        mainEntityOfPage: urlOf(locale, cid),
        isAccessibleForFree: true,
        ...(v?.stage.map ? { image: asset(`/stage/${v.stage.id}.webp`) } : {}),
        publisher: { "@type": "Organization", name: siteName, url: SITE_URL },
        about: { "@type": "VideoGame", name: locale === "ja" ? "アークナイツ" : locale === "en" ? "Arknights" : "명일방주" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: siteName, item: `${SITE_URL}${LOCALE_BASE[locale] || "/"}` },
          { "@type": "ListItem", position: 2, name: listLabel, item: `${SITE_URL}${LOCALE_BASE[locale]}/stages` },
          { "@type": "ListItem", position: 3, name: `${code} ${name}`.trim() },
        ],
      },
    ],
  };
}
