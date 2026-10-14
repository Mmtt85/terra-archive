"use client";

// 플레이어 호칭 표식 {@nickname} — 게임 원문이 "{@nickname} 박사", "Dr. {@nickname}", "Dr.{@nickname}" 처럼 플레이어 닉네임을 끼우는 자리.
// 내 정보로 로그인한 사람은 **게임 닉네임**으로, 아니면 그 언어의 호칭(박사 / Doctor / ドクター)으로 바꿔 넣는다 (사용자 지시 2026-10-14).
// 쓰는 곳: 오퍼 보이스·프로필·오퍼레이터 기록(home.tsx), 스토리 전문·리더기·대사 검색(story.tsx) — 받아 온 JSON 을 nickifyDeep 로 한 번 훑는다.
// 원문(빌더 산출물)은 표식을 그대로 둔다 — scripts/build-story-scripts.py clean() · build-voicelines 는 원래 손대지 않았다.
// ⚠ 서버 렌더·첫 하이드레이션에선 닉네임을 모른다(useMe 가 null) — 그때는 호칭으로 나가고, 로그인 정보가 읽히면 다시 그린다.
import type { Locale } from "./i18n";
import { useMe } from "./me-store";

const MARK = /\{@nickname\}/gi;

/** 닉네임이 없을 때 — 호칭이 이미 붙어 있으면("{@nickname} 박사", "Dr. {@nickname}") 표식만 떼고, 아니면 호칭을 넣는다 */
function fallback(s: string, locale: Locale): string {
  if (locale === "ko") return s.replace(/\{@nickname\}\s*(?=박사)/gi, "").replace(/Dr\.\s*\{@nickname\}/gi, "박사").replace(MARK, "박사");
  if (locale === "ja") return s.replace(/(?:Dr\.|ドクター)\s*\{@nickname\}/gi, "ドクター").replace(MARK, "ドクター");
  return s.replace(/\b(?:Dr\.|Doctor)\s*\{@nickname\}/gi, "Doctor").replace(MARK, "Doctor");
}

export function nickify(s: string, locale: Locale, nick: string | null | undefined): string {
  if (!s.includes("{@")) return s;
  return nick ? s.replace(MARK, nick) : fallback(s, locale);
}

/** JSON 을 통째로 훑어 문자열마다 nickify — 표식이 없으면 같은 객체를 돌려준다(리렌더 최소화) */
export function nickifyDeep<T>(v: T, locale: Locale, nick: string | null | undefined): T {
  if (typeof v === "string") return nickify(v, locale, nick) as unknown as T;
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => { const y = nickifyDeep(x, locale, nick); if (y !== x) changed = true; return y; });
    return (changed ? out : v) as unknown as T;
  }
  if (v && typeof v === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const y = nickifyDeep(x, locale, nick);
      if (y !== x) changed = true;
      out[k] = y;
    }
    return (changed ? out : v) as T;
  }
  return v;
}

/** 내 정보로 로그인한 게임 닉네임 (없으면 null) */
export function useNick(): string | null {
  return useMe()?.player?.nickName?.trim() || null;
}
