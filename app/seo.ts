// 로케일별 SEO 메타데이터의 정본 — 라우트(/ /en /ja) 페이지가 공유한다.
// 정본 도메인은 terra-archive.net (2026-07 사용자가 구매·연결). Cloudflare Pages 기본
// 도메인(terra-archive.pages.dev)과 프리뷰 배포(*.pages.dev)도 전부 이 SITE_URL을 canonical·
// hreflang·OG로 내보내므로, 어느 도메인으로 크롤링되든 검색엔진이 .net으로 통합한다
// (중복 콘텐츠 방지). 도메인을 바꾸면 여기 + scripts/build-sitemap.mjs + public/robots.txt를 함께 수정
// (sitemap.xml은 빌드 시 build-sitemap.mjs가 라우트 스캔으로 자동 생성 — 직접 수정 금지).
import type { Metadata } from "next";
import { asset } from "./assets";
import { CONTACT_EMAIL } from "./contact";

export const SITE_URL = "https://terra-archive.net";

type SeoLocale = "ko" | "en" | "ja";
export type SeoTab = "portal" | "archive" | "enemy" | "stage" | "sim" | "planner" | "recruit" | "farm" | "upgrade" | "story" | "rogue" | "ra" | "autochess" | "about";

// 탭 → URL 세그먼트 (portal이 로케일 루트, 오퍼 백과사전은 /operators로 분리 — 사용자 확정
// 2026-07-17: 루트 진입 시 오퍼 이미지 강제 로딩을 없애기 위해 포탈 첫화면 도입). 라우트 폴더명과 반드시 일치.
// ⚠ 적 도감 세그먼트는 "enemies"(복수) — 초상 자산 폴더 public/enemy/(단수)와 일부러 다르다.
//    deploy.sh가 스테이징에서 `rm -rf $STAGE/enemy`로 자산만 떼어내기 때문(서빙은 R2).
export const TAB_SEG: Record<SeoTab, string> = {
  portal: "", archive: "operators", enemy: "enemies", stage: "stages", sim: "sim", planner: "infra", recruit: "recruit", farm: "farm", upgrade: "upgrade", story: "stories", rogue: "rogue", ra: "ra", autochess: "autochess", about: "about",
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
  enemy: {
    ko: { title: "적 도감 - 명일방주 적 정보 | 테라 아카이브", description: "명일방주(아크나이츠) 적 도감 — 적 1,500여 종의 스탯·능력·상태이상 면역·종족을 등급별로 찾고, 그 적이 등장하는 작전까지 역으로 확인합니다." },
    en: { title: "Enemy Handbook - Arknights Enemy Database | Terra Archive", description: "Arknights enemy handbook — stats, abilities, status immunities and races for 1,500+ enemies, plus the operations each one appears in." },
    ja: { title: "敵図鑑 - アークナイツ敵情報 | テラアーカイブ", description: "アークナイツの敵図鑑 — 1,500種以上の敵のステータス・能力・状態異常耐性・種族を等級別に検索し、その敵が出現する作戦も逆引きできます。" },
  },
  stage: {
    ko: { title: "작전 도감 - 명일방주 스테이지 지형·드랍 | 테라 아카이브", description: "명일방주(아크나이츠) 작전 도감 — 스테이지 2,200여 개의 지형 도면과 소모 이성·권장 편성·등장 적·드랍을 계열과 구역으로 찾습니다." },
    en: { title: "Stage Handbook - Arknights Stage Maps & Drops | Terra Archive", description: "Arknights stage handbook — terrain layouts for 2,200+ operations with sanity cost, recommended level, enemies and drops, searchable by category and zone." },
    ja: { title: "作戦図鑑 - アークナイツ ステージ地形・ドロップ | テラアーカイブ", description: "アークナイツの作戦図鑑 — 2,200以上のステージの地形図と理性消費・推奨編成・出現する敵・ドロップを系統とエリアで検索できます。" },
  },
  sim: {
    ko: { title: "작전 시뮬레이터 - 명일방주 적 스폰 타임라인 | 테라 아카이브", description: "명일방주(아크나이츠) 작전 시뮬레이터 — 작전을 고르면 적이 몇 초에 어디서 나와 어떤 경로로 어디에 들어가는지 스폰 타임라인을 재생합니다. 배속·구간 이동 지원, 통합전략 전투 노드 포함." },
    en: { title: "Stage Simulator - Arknights Enemy Spawn Timeline | Terra Archive", description: "Arknights stage simulator — pick an operation and replay its enemy spawn timeline: when each enemy appears, which route it takes, and where it goes, with playback speed and seeking." },
    ja: { title: "作戦シミュレーター - アークナイツ敵出現タイムライン | テラアーカイブ", description: "アークナイツ作戦シミュレーター — 作戦を選ぶと、敵が何秒にどこから現れどの経路でどこへ向かうか、出現タイムラインを再生します。倍速・シークにも対応。" },
  },
  planner: {
    ko: { title: "인프라 자동편성기 - 명일방주 기반시설 편성 | 테라 아카이브", description: "명일방주 기반시설(RIIC) 자동 편성 플래너 — 보유 오퍼레이터만 입력하면 제조소·무역소·발전소 편성을 자동으로 짜줍니다." },
    en: { title: "Base Auto-Planner - Arknights RIIC Base | Terra Archive", description: "Arknights RIIC base auto-assignment planner — just enter your roster and it builds the optimal factory, trading post, and power plant layout for you." },
    ja: { title: "基地自動編成 - アークナイツ基地編成 | テラアーカイブ", description: "アークナイツ基地（インフラ）自動編成プランナー — 手持ちオペレーターを入力するだけで製造所・貿易所・発電所の編成を自動で組んでくれます。" },
  },
  recruit: {
    ko: { title: "공개채용 도우미 - 명일방주 공개모집 계산기 | 테라 아카이브", description: "명일방주 공개모집(공채) 태그 계산기 — 태그 조합으로 확정·고성급 오퍼레이터를 찾아줍니다." },
    en: { title: "Public Recruitment Helper - Arknights Recruitment Calculator | Terra Archive", description: "Arknights recruitment tag calculator — finds guaranteed and high-rarity operators from your tag combinations." },
    ja: { title: "公開求人ヘルパー - アークナイツ公開求人計算機 | テラアーカイブ", description: "アークナイツ公開求人タグ計算機 — タグの組み合わせから確定・高レアオペレーターを見つけます。" },
  },
  farm: {
    ko: { title: "재료파밍 도우미 - 명일방주 재료 파밍 효율표 | 테라 아카이브", description: "명일방주 재료 파밍 효율표 — 정예화 재료별 최적 파밍 스테이지와 개당 기대 이성을 펭귄 물류 실측 드랍 통계로 확인합니다." },
    en: { title: "Material Farming Helper - Arknights Material Farming Efficiency | Terra Archive", description: "Arknights material farming efficiency table — the best farming stage and sanity-per-item for every Elite material, from Penguin Logistics real drop statistics." },
    ja: { title: "素材周回ヘルパー - アークナイツ素材周回効率表 | テラアーカイブ", description: "アークナイツ素材周回効率表 — 昇進素材ごとの最適ステージと1個あたりの期待理性を、ペンギン急便の実測ドロップ統計で確認します。" },
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
  ra: {
    ko: { title: "생존연산 가이드 - 명일방주 생존연산 공략 | 테라 아카이브", description: "명일방주(아크나이츠) 생존연산 가이드 — 요리·음료 조합, 제작·설치물 재료, 지역·날씨, 조우 선택지, 균열 목표를 게임 데이터에서 정리했습니다. 중국 서버 선행 신시즌도 비공식 번역으로 미리 봅니다." },
    en: { title: "Reclamation Algorithm Guide - Arknights RA Guide | Terra Archive", description: "Arknights Reclamation Algorithm guide — food recipes, crafting materials, areas & weather, encounter choices and rift objectives, plus a preview of the CN-first new season." },
    ja: { title: "生息演算ガイド - アークナイツ生息演算攻略 | テラアーカイブ", description: "アークナイツ生息演算ガイド — 料理レシピ、製作・設置物の素材、エリアと天候、遭遇の選択肢、裂け目の目標を整理。中国サーバー先行の新シーズンもプレビューできます。" },
  },
  autochess: {
    ko: { title: "위수 협의 가이드 - 명일방주 명토체스 공략 | 테라 아카이브", description: "명일방주(아크나이츠) 위수 협의(오토체스) 시즌2 「맹약」 가이드 — 맹약 23종(진영 8·특성 15)별 오퍼레이터, 오퍼레이터 112명의 전용 능력과 스킬·모듈, 리더 적 10종과 특훈 적 7유형 119종, 보급센터 티어별 가격·레벨, 자유 선택 칸과 대체 기물, 아이템 59종·전략 40종까지 게임 데이터에서 정리했습니다." },
    en: { title: "Stronghold Protocol Guide - Arknights Auto Chess | Terra Archive", description: "Arknights Stronghold Protocol (auto chess) Season 2 guide — 23 alliances (8 nation, 15 trait) with their operators, garrison abilities plus skills and modules for all 112 units, 10 leader enemies and 119 Tactical Training enemies across 7 types, Supply Center tier prices and levels, free-pick slots and stand-in units, 59 items and 40 strategies, straight from game data." },
    ja: { title: "堅守協定ガイド - アークナイツ オートチェス攻略 | テラアーカイブ", description: "アークナイツ堅守協定（オートチェス）シーズン2「盟約」ガイド — 盟約23種（国家8・特性15）ごとのオペレーター、112体それぞれの専用能力とスキル・モジュール、リーダー級10種と訓練用仮想敵7系統119種、補給センターの等級別価格とレベル、自由選択枠と代替ユニット、アイテム59種・戦略40種までゲームデータから整理しました。" },
  },
  about: {
    ko: { title: "소개 - 기능 안내 | 테라 아카이브", description: "테라 아카이브의 기능 소개 — 오퍼 백과사전, 인프라 자동편성기, 공개채용 도우미, 파밍·육성 시뮬, AI 스토리 요약이 각각 무엇이고 어떤 상황에 쓰는지 안내합니다." },
    en: { title: "About - Feature Guide | Terra Archive", description: "About Terra Archive — what the operator encyclopedia, base auto-planner, public recruitment helper, material farming/upgrade simulator, and AI story digest do, and when to use each." },
    ja: { title: "紹介 - 機能ガイド | テラアーカイブ", description: "テラアーカイブの機能紹介 — オペレーター図鑑、基地自動編成、公開求人ヘルパー、素材周回・育成シミュ、AIストーリー要約が何で、どんな時に使うのかを案内します。" },
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
const TOOL_TABS: SeoTab[] = ["planner", "recruit", "upgrade", "farm", "sim"];
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
/** 발행처 노드. 공개 문의 주소를 실어 검색엔진이 사이트 연락처로 읽게 한다 (2026-09-03).
 *  개인 지메일이 아니라 도메인 역할 주소여야 한다 — 구조화 데이터는 한번 색인되면 오래 남는다. */
function publisherOf(name: string, url: string) {
  return { "@type": "Organization", name, url, email: CONTACT_EMAIL };
}

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
    publisher: publisherOf(meta.siteName, home),
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
        publisher: publisherOf(meta.siteName, home),
      });
    }
  }
  return { "@context": "https://schema.org", "@graph": graph };
}
