// 화면별 서버 안내(app/page-seo/*) 공용 — 언어별 주소 앞머리·이름표 (2026-10-15)
import extraEn from "../data/extra-i18n.en.json";
import extraJa from "../data/extra-i18n.ja.json";

export type SeoLang = "ko" | "en" | "ja";
export const BASE: Record<SeoLang, string> = { ko: "", en: "/en", ja: "/ja" };

type Extra = { names: Record<string, string>; recruitTags: Record<string, string> };
const EXTRA: Record<"en" | "ja", Extra> = { en: extraEn as unknown as Extra, ja: extraJa as unknown as Extra };
/** 오퍼레이터 이름 — 한국어면 그대로 */
export const opName = (lang: SeoLang, id: string, ko: string) => (lang === "ko" ? ko : EXTRA[lang].names[id] ?? ko);
/** 공개모집 태그 이름 (gacha_table tagId 로) — 한국어면 그대로 */
export const tagName = (lang: SeoLang, id: number | undefined, ko: string) => (lang === "ko" || id == null ? ko : EXTRA[lang].recruitTags[String(id)] ?? ko);
