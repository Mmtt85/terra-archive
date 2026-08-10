// 적 상세 페이지(/enemies/<id>)의 메타데이터 + **본문 데이터 공급** — 서버(빌드) 전용.
//
// app/seo-operator.ts와 같은 목적이지만 역할이 하나 더 있다. 오퍼는 목록 데이터가 이미
// 클라이언트 번들(home-ko.tsx)에 있어 상세 페이지가 그걸 그대로 그리지만, 적 도감의
// enemies.json은 로케일당 1MB라 **모든 페이지의 첫 번들에 실을 수 없다.**
// 그래서 이 모듈이 서버에서 그 적 하나(+등장 작전 발췌)만 뽑아 props로 내려 준다.
// 여기서 임포트하는 JSON은 서버 컴포넌트 경유라 클라이언트 번들에 들어가지 않는다.
//
// ⚠ 도감에 안 나오는 적(hideInHandbook)은 애초에 데이터에 없다 — 라우트도 생기지 않는다.
import type { Metadata } from "next";
import { asset } from "./assets";
import { SITE_URL } from "./seo";
import type { Enemy, EnemyStages } from "./enemy-detail";
import enemiesKo from "./data/enemies.json";
import enemiesEn from "./data/enemies.en.json";
import enemiesJa from "./data/enemies.ja.json";
import stagesKo from "./data/enemy-stages.json";
import stagesEn from "./data/enemy-stages.en.json";
import stagesJa from "./data/enemy-stages.ja.json";

type SeoLocale = "ko" | "en" | "ja";

const LOCALE_BASE: Record<SeoLocale, string> = { ko: "", en: "/en", ja: "/ja" };
const ROSTER: Record<SeoLocale, Enemy[]> = {
  ko: enemiesKo as unknown as Enemy[],
  en: enemiesEn as unknown as Enemy[],
  ja: enemiesJa as unknown as Enemy[],
};
const STAGES: Record<SeoLocale, EnemyStages> = {
  ko: stagesKo as unknown as EnemyStages,
  en: stagesEn as unknown as EnemyStages,
  ja: stagesJa as unknown as EnemyStages,
};
const BY_ID: Record<SeoLocale, Map<string, Enemy>> = {
  ko: new Map(ROSTER.ko.map((e) => [e.id, e])),
  en: new Map(ROSTER.en.map((e) => [e.id, e])),
  ja: new Map(ROSTER.ja.map((e) => [e.id, e])),
};

/** 도감에 노출되는 적 전부 — 라우트 생성(generateStaticParams)용 */
export const enemyIds = ROSTER.ko.map((e) => e.id);

const enemyOf = (locale: SeoLocale, id: string) => BY_ID[locale].get(id) ?? BY_ID.ko.get(id);

/**
 * 상세 페이지가 그릴 데이터 — 그 적 하나 + **그 적이 쓰는 작전 행만 추린** 색인.
 * 전체 색인(로케일당 ~230KB)을 페이지마다 직렬화하면 4,542장에 그게 다 실린다.
 */
export function enemyPageData(locale: SeoLocale, id: string): { enemy: Enemy | null; stages: EnemyStages | null } {
  const enemy = enemyOf(locale, id) ?? null;
  const doc = STAGES[locale] ?? STAGES.ko;
  const refs = enemy ? doc.byEnemy[enemy.id] : undefined;
  if (!enemy || !refs?.length) return { enemy, stages: null };
  // 원본 행 번호 → 발췌본 행 번호로 다시 매긴다 (등장 순서는 그대로 유지)
  const remap = new Map<number, number>();
  const rows: EnemyStages["stages"] = [];
  const picked: number[][] = [];
  for (const ref of refs) {
    const src = doc.stages[ref[0]];
    if (!src) continue;
    let at = remap.get(ref[0]);
    if (at === undefined) { at = rows.length; remap.set(ref[0], at); rows.push(src); }
    // ⚠ 스탯레벨(3번째 칸)까지 옮긴다 — 번호만 다시 매기다 이 칸을 떨궈서 정적 적
    //   페이지에만 ★강화 표시가 안 나오던 버그가 있었다 (2026-08-10).
    picked.push(ref.length > 2 ? [at, ref[1], ref[2]] : ref.length > 1 ? [at, ref[1]] : [at]);
  }
  return { enemy, stages: { stages: rows, byEnemy: { [enemy.id]: picked } } };
}

const TITLE: Record<SeoLocale, (name: string) => string> = {
  // ⚠ 하이드레이션 후 app/home.tsx의 document.title도 같은 문구로 맞춘다 (i18n 사전 같은 키)
  ko: (name) => `${name} - 명일방주 적 도감 | 테라 아카이브`,
  en: (name) => `${name} - Arknights Enemy | Terra Archive`,
  ja: (name) => `${name} - アークナイツ 敵図鑑 | テラアーカイブ`,
};

// 설명은 그 적의 실제 데이터로 만든다 — 도감번호·등급·종족·이동/공격 방식 + 능력 한 줄.
// 1,514장이 같은 문장 틀을 쓰지만 채워지는 값이 전부 달라 중복으로 잡히지 않는다.
const RANK_WORD: Record<SeoLocale, Record<string, string>> = {
  ko: { NORMAL: "일반", ELITE: "정예", BOSS: "보스" },
  en: { NORMAL: "Normal", ELITE: "Elite", BOSS: "Boss" },
  ja: { NORMAL: "通常", ELITE: "エリート", BOSS: "ボス" },
};

function descOf(locale: SeoLocale, id: string): string {
  const e = enemyOf(locale, id);
  if (!e) return "";
  const rank = RANK_WORD[locale][e.rank ?? ""] ?? "";
  const bits = [rank, ...e.race, e.motion, e.way].filter(Boolean).join(" · ");
  const lv0 = e.lv[0];
  const stats = lv0
    ? `HP ${lv0.hp} · ATK ${lv0.atk} · DEF ${lv0.def} · RES ${lv0.res}%`
    : "";
  const head = locale === "ko"
    ? `${e.name}(${e.idx ?? "—"}) — ${bits}. ${stats}.`
    : locale === "ja"
      ? `${e.name}（${e.idx ?? "—"}）— ${bits}。${stats}。`
      : `${e.name} (${e.idx ?? "—"}) — ${bits}. ${stats}.`;
  const ability = e.abil[0] ?? "";
  const tail = locale === "ko"
    ? "능력·상태이상 면역·등장 작전을 한 페이지에서 봅니다."
    : locale === "ja"
      ? "能力・状態異常耐性・出現作戦をまとめて確認できます。"
      : "Abilities, status immunities, and every operation it appears in, on one page.";
  // 능력 문장은 마침표가 없는 경우가 많다 — 뒤 문장과 붙어 읽히지 않게 끝을 맺어 준다
  const abilitySentence = ability
    ? `${ability}${/[.。!?！？]$/.test(ability) ? "" : locale === "ja" ? "。" : "."}`
    : "";
  const full = `${head}${abilitySentence ? ` ${abilitySentence}` : ""} ${tail}`;
  return full.length > 158 ? `${full.slice(0, 157).trimEnd()}…` : full;
}

const urlOf = (locale: SeoLocale, id: string) => `${SITE_URL}${LOCALE_BASE[locale]}/enemies/${id}`;

// AI 스토리 요약 발행 피드(public/feed.xml)는 한국어 본문이라 **한국어 페이지에만** 건다.
// ⚠ alternates는 페이지 값이 레이아웃 값을 통째로 덮으므로 레이아웃이 아니라 여기서 붙인다.
const RSS_ALT = (locale: SeoLocale) =>
  locale === "ko"
    // ⚠ 문자열 형태로 준다 — vinext 메타데이터 렌더러가 {url,title} 객체 형태를 못 풀어
    //    href="[object Object]"가 나간다 (2026-08-06 실측).
    ? { types: { "application/rss+xml": `${SITE_URL}/feed.xml` } }
    : {};

export function enemyMetadata(locale: SeoLocale, id: string): Metadata {
  const e = enemyOf(locale, id);
  const name = e?.name ?? id;
  const title = TITLE[locale](name);
  const description = descOf(locale, id);
  const languages = {
    ko: urlOf("ko", id), en: urlOf("en", id), ja: urlOf("ja", id), "x-default": urlOf("ko", id),
  };
  // OG는 적 도감 탭 공용 이미지 — 적 초상은 256px 정사각이라 OG 규격(1200×630)에 안 맞는다
  const ogImage = asset(`/og/${locale}/enemy.jpg`);
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

export function enemyJsonLd(locale: SeoLocale, id: string) {
  const e = enemyOf(locale, id);
  const name = e?.name ?? id;
  const siteName = locale === "ko" ? "테라 아카이브" : locale === "ja" ? "テラアーカイブ" : "Terra Archive";
  const listLabel = locale === "ko" ? "적 도감" : locale === "ja" ? "敵図鑑" : "Enemy Handbook";
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        // 게임 내 항목 문서 — about으로 게임에 묶는다 (오퍼 상세와 같은 형태)
        "@type": "Article",
        headline: TITLE[locale](name).split(" | ")[0],
        description: descOf(locale, id),
        inLanguage: locale,
        url: urlOf(locale, id),
        mainEntityOfPage: urlOf(locale, id),
        isAccessibleForFree: true,
        ...(e ? { image: asset(`/enemy/${e.id}.webp`) } : {}),
        publisher: { "@type": "Organization", name: siteName, url: SITE_URL },
        about: { "@type": "VideoGame", name: locale === "ja" ? "アークナイツ" : locale === "en" ? "Arknights" : "명일방주" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: siteName, item: `${SITE_URL}${LOCALE_BASE[locale] || "/"}` },
          { "@type": "ListItem", position: 2, name: listLabel, item: `${SITE_URL}${LOCALE_BASE[locale]}/enemies` },
          { "@type": "ListItem", position: 3, name },
        ],
      },
    ],
  };
}
