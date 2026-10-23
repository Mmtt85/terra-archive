// 경로마다의 문서 제목 — 서버(<title>, app/seo*.ts)와 화면(home.tsx 문서 제목 effect)이 **같은 문구**를 쓰게 한 곳에 둔다.
// seo*.ts 를 화면 쪽에서 직접 가져오면 긴 설명문·데이터 JSON 까지 딸려 와서 여기로 뺐다 (2026-10-18 탭 제목 전수조사 —
// 위수 협의·소개·생존연산 시즌 주소를 열면 하이드레이션 직후 사이트 기본 제목으로 덮이던 것).
export type TitleLocale = "ko" | "en" | "ja";

export const ABOUT_TITLE: Record<TitleLocale, string> = {
  ko: "소개 - 기능 안내 | 테라 아카이브",
  en: "About - Feature Guide | Terra Archive",
  ja: "紹介 - 機能ガイド | テラアーカイブ",
};

export const AUTOCHESS_TITLE: Record<TitleLocale, string> = {
  ko: "위수 협의 가이드 - 명일방주 위수 협의 공략 | 테라 아카이브",
  en: "Stronghold Protocol Guide - Arknights Auto Chess | Terra Archive",
  ja: "堅守協定ガイド - アークナイツ オートチェス攻略 | テラアーカイブ",
};

export const autochessSeasonTitle = (locale: TitleLocale, n: number): string =>
  locale === "en" ? `Stronghold Protocol Season ${n} - Arknights Guide | Terra Archive`
    : locale === "ja" ? `堅守協定 シーズン${n} - アークナイツ攻略 | テラアーカイブ`
      : `위수 협의 시즌 ${n} - 명일방주 위수 협의 공략 | 테라 아카이브`;

export const SANDBOX_TITLE: Record<"sand" | "anchor", Record<TitleLocale, string>> = {
  sand: {
    ko: "사막 이야기 - 명일방주 생존연산 공략 | 테라 아카이브",
    en: "Tales Within the Sand - Arknights Reclamation Algorithm | Terra Archive",
    ja: "砂中の遺聞 - アークナイツ生息演算攻略 | テラアーカイブ",
  },
  anchor: {
    ko: "리런치 앵커(重启锚点) - 명일방주 생존연산 신시즌 | 테라 아카이브",
    en: "重启锚点 - Arknights Reclamation Algorithm New Season | Terra Archive",
    ja: "重启锚点 - アークナイツ生息演算 新シーズン | テラアーカイブ",
  },
};

/** 요약 없이 이벤트 기록만 있는 스토리 상세 (app/seo-story.ts loreOnly) */
export const loreStoryTitle = (locale: TitleLocale, name: string): string =>
  locale === "en" ? `${name} Event Records - Arknights | Terra Archive`
    : locale === "ja" ? `${name} イベント記録 - アークナイツ | テラアーカイブ`
      : `${name} 이벤트 기록 - 명일방주 | 테라 아카이브`;
