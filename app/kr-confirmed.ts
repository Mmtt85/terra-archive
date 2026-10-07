// 한섭 개방일이 공식 발표로 **확정된** 미실장 이벤트 (사용자가 알려 줄 때 손으로 넣는다).
// 데이터의 eta 는 중↔한 시차로 낸 '추정월'이라, 확정되면 여기 날짜가 그 자리를 대신한다
// (이벤트 카드·상세 · 헤더 '앞으로 올 이벤트' · 스토리 출시순). 실제로 열리면 점검 파이프라인이
// 진짜 기간을 채우므로 그때 줄을 지운다 — 날짜가 지나면 지우지 않아도 저절로 안 쓴다.
import type { Locale } from "./i18n";

export const KR_CONFIRMED: Record<string, string> = {
  act4mainss: "2026-10-14", // 상전이 임계 (사용자 2026-10-07)
};

/** 확정 개방일(YYYY-MM-DD) — 없거나 이미 지났으면 undefined */
export function confirmedDay(id: string | undefined, now = Date.now()): string | undefined {
  const d = id ? KR_CONFIRMED[id] : undefined;
  if (!d) return undefined;
  return Date.parse(`${d}T23:59:59+09:00`) >= now ? d : undefined;
}

/** '10월 14일' · 'Oct 14' · '10月14日' */
export function fmtMonthDay(locale: Locale, day: string): string {
  const [, m, d] = day.split("-").map(Number);
  if (locale === "en") return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}`;
  return locale === "ja" ? `${m}月${d}日` : `${m}월 ${d}일`;
}
