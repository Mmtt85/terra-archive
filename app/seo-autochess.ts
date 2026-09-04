// 위수 협의 시즌 페이지(/autochess/<slug>)의 메타데이터 — 서버(빌드) 전용.
//
// 시즌마다 실제 정적 페이지를 둔다 (사용자 요청 2026-09-05 "시즌1이랑 2는 메뉴에다가
// 서브메뉴로 넣어줘") — 통합전략 /rogue/<slug> · 생존연산 /ra/<slug>와 같은 규격이다.
//
// ⚠ **문구를 시즌마다 손으로 적지 않는다.** 두 시즌 다 게임 안 이름이 「위수 협의: 맹약」로
//   같아서 손으로 쓰면 어차피 숫자만 다른 글이 된다. 시즌 목록(app/data/autochess-seasons.json)
//   에서 번호·기간을 읽어 틀로 찍어 내므로, 새 시즌이 와도 **여기는 고칠 게 없다.**
import type { Metadata } from "next";
import { asset } from "./assets";
import { SITE_URL } from "./seo";
import seasonList from "./data/autochess-seasons.json";

type SeoLocale = "ko" | "en" | "ja";
const LOCALE_BASE: Record<SeoLocale, string> = { ko: "", en: "/en", ja: "/ja" };

type Season = { n: number; id: string; file: string; s: number; e: number };
const SEASONS = seasonList as Season[];
const LATEST = SEASONS.length ? Math.max(...SEASONS.map((x) => x.n)) : 1;

export const autochessSlugs = SEASONS.map((x) => `s${x.n}`);
/** "s2" → 2. 모르는 값이면 최신 시즌 */
export const autochessSeasonOf = (slug?: string) => {
  const n = Number(String(slug ?? "").replace(/^s/, ""));
  return SEASONS.some((x) => x.n === n) ? n : LATEST;
};

const ymd = (t: number, locale: SeoLocale) =>
  new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US",
    { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(t * 1000));

function copy(locale: SeoLocale, n: number) {
  const sn = SEASONS.find((x) => x.n === n);
  const run = sn ? `${ymd(sn.s, locale)} ~ ${ymd(sn.e, locale)}` : "";
  const cur = n === LATEST;
  if (locale === "en") {
    return {
      name: `Season ${n}`,
      title: `Stronghold Protocol Season ${n} - Arknights Guide | Terra Archive`,
      desc: cur
        ? `Arknights Stronghold Protocol Season ${n} — alliances by faction and trait, every operator's Protocol-only ability, supply centre tiers, items, bands, tactics, drill enemies and leader enemies, straight from the game data.`
        : `Arknights Stronghold Protocol Season ${n} (${run}) — the alliances, chess pieces, items and battlefields exactly as they were that season. Values differ from the current season.`,
    };
  }
  if (locale === "ja") {
    return {
      name: `シーズン${n}`,
      title: `堅守協定 シーズン${n} - アークナイツ攻略 | テラアーカイブ`,
      desc: cur
        ? `アークナイツ堅守協定シーズン${n} — 陣営・特性別の盟約、駒ごとの専用アビリティ、購買部の数値、アイテム・バンド・戦術・特訓の敵・リーダーの敵をゲームデータからそのまま整理しました。`
        : `アークナイツ堅守協定シーズン${n}（${run}） — 当時の盟約・駒・アイテム・戦場をそのまま。数値は現行シーズンと異なります。`,
    };
  }
  return {
    name: `시즌 ${n}`,
    title: `위수 협의 시즌 ${n} - 명일방주 명토체스 공략 | 테라 아카이브`,
    desc: cur
      ? `명일방주 위수 협의(명토체스) 시즌 ${n} — 맹약(진영·특성)별 오퍼레이터, 기물마다의 위수 협의 전용 능력, 물자관리소 수치, 장비·밴드·전략·특훈 적·리더 적을 게임 데이터에서 그대로 정리했습니다.`
      : `명일방주 위수 협의(명토체스) 시즌 ${n}(${run}) — 그 시즌의 맹약·기물·장비·전장을 당시 수치 그대로 봅니다. 지금 시즌과는 수치가 다릅니다.`,
  };
}

export const autochessName = (locale: SeoLocale, slug: string) => copy(locale, autochessSeasonOf(slug)).name;

const urlOf = (locale: SeoLocale, slug: string) => `${SITE_URL}${LOCALE_BASE[locale]}/autochess/${slug}`;

export function autochessMetadata(locale: SeoLocale, slug: string): Metadata {
  const n = autochessSeasonOf(slug);
  const sl = `s${n}`;
  const m = copy(locale, n);
  const url = urlOf(locale, sl);
  const ogImage = asset(`/og/${locale}/autochess.jpg`);
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

export function autochessJsonLd(locale: SeoLocale, slug: string) {
  const n = autochessSeasonOf(slug);
  const m = copy(locale, n);
  const home = `${SITE_URL}${LOCALE_BASE[locale]}/`;
  return {
    "@context": "https://schema.org",
    "@graph": [{
      "@type": "Article",
      headline: m.title.split(" - ")[0],
      description: m.desc,
      inLanguage: locale,
      mainEntityOfPage: urlOf(locale, `s${n}`),
    }, {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Terra Archive", item: home },
        { "@type": "ListItem", position: 2, name: locale === "ko" ? "위수 협의 가이드" : locale === "ja" ? "堅守協定ガイド" : "Stronghold Protocol Guide", item: `${SITE_URL}${LOCALE_BASE[locale]}/autochess` },
        { "@type": "ListItem", position: 3, name: m.name },
      ],
    }],
  };
}
