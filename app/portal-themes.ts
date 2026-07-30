"use client";

// 포탈(첫 화면) = 게임 홈 화면 UI를 흉내 낸 대문 (사용자 요청 2026-07-30).
//
// 구조를 둘로 나눈 이유: 게임의 홈 UI 테마는 **버튼 구성은 그대로 두고 겉모습만 갈아끼운다.**
// 그래서 여기서도
//   · PORTAL_TILES = 어떤 칸이 어디로 가는가 (사이트 기능 매핑 — 테마와 무관, 하나뿐)
//   · PORTAL_THEMES = 그 칸들을 어떻게 그리는가 (배경 아트 + 색 변수 — 갈아끼우는 대상)
// 로 갈랐다. 새 테마를 넣을 때 PORTAL_THEMES에 항목 하나만 추가하면 되고,
// 기능 매핑은 건드리지 않는다.

import type { Locale } from "./i18n";
import themeData from "./data/portal-themes.json";

/** 홈 화면의 칸 하나. area는 CSS grid-template-areas 이름과 1:1로 맞춘다. */
export type PortalTile = {
  id: string;
  /** 표시 라벨 — i18n 사전 키(한국어 원문) */
  label: string;
  /** 이 칸이 실제로 여는 곳. tab이 없으면 장식 칸(게임엔 있으나 사이트엔 없는 기능) */
  tab?: string;
  /** 탭 대신 동작을 여는 칸 (헤더 버튼과 같은 것을 부른다) */
  action?: "changelog" | "feedback" | "donate";
  href?: string;
  area: string;
  /** 칸 모양 — 판(plate) / 이벤트 배너 */
  kind: "plate" | "banner";
  /** 큰 칸의 가운데를 채우는 한 줄 설명 — 작은 칸은 비워 둔다 (i18n 사전 키) */
  desc?: string;
  icon: string;
};

/**
 * 게임 홈 ↔ 사이트 기능 매핑 (사용자 지시: "있는 애들은 한번 맞춰보자").
 * 영문 제목(Terminal·Squads…)과 대응 기능이 없던 칸(헤드헌팅·구매센터)은 사용자 지시로
 * 뺐다 (2026-07-30) — 게임에만 있는 칸을 흉내 내느라 못 누르는 버튼을 두지 않는다.
 * 제일 큰 칸(터미널 자리)은 대표 도구인 인프라 자동편성기가 쓴다.
 */
export const PORTAL_TILES: PortalTile[] = [
  { id: "terminal", label: "인프라 자동편성기", tab: "planner", area: "terminal", kind: "plate",
    desc: "보유 오퍼만 입력하면 기반시설 편성을 자동으로 계산", icon: "⌂" },
  { id: "banner", label: "진행중 이벤트", area: "banner", kind: "banner", icon: "✦" },
  { id: "base", label: "파밍 도우미", tab: "farm", area: "base", kind: "plate",
    desc: "정예화 재료의 최적 파밍 스테이지와 이성 효율표", icon: "◈" },
  { id: "operator", label: "오퍼 백과사전", tab: "archive", area: "operator", kind: "plate", icon: "▤" },
  { id: "story", label: "스토리", tab: "story", area: "story", kind: "plate", icon: "✦" },
  { id: "squads", label: "통합전략 가이드", tab: "rogue", area: "squads", kind: "plate", icon: "❖" },
  { id: "recruit", label: "공채 도우미", tab: "recruit", area: "recruit", kind: "plate", icon: "◎" },
  { id: "depot", label: "오퍼 육성 시뮬", tab: "upgrade", area: "depot", kind: "plate", icon: "▦" },
  { id: "mission", label: "업데이트 내역", action: "changelog", area: "mission", kind: "plate", icon: "🛠" },
  { id: "archives", label: "테라 아카이브 소개", tab: "about", area: "archives", kind: "plate", icon: "ⓘ" },
  { id: "friends", label: "제안 보내기", action: "feedback", area: "friends", kind: "plate", icon: "💬" },
];

/** 갈아끼우는 대상 — 인터페이스 색만 바꾼다. 배경 아트와 칸 배치는 테마가 건드리지 않는다. */
export type PortalTheme = {
  id: string;
  dark: boolean;
  /** .pt-stage에 그대로 얹는 CSS 변수 */
  vars: Record<string, string>;
};

/**
 * 배경은 **이격 스카디 일러스트로 고정** (사용자 지시 2026-07-30).
 * ⚠ 게임 홈 스크린샷을 배경으로 쓰지 말 것 — 독타 ID·보유 재화가 찍혀 있는 개인 화면이다.
 *   (한 번 그렇게 넣었다가 공개 R2에 올라가 회수했다. 스크린샷은 색을 뽑는 재료일 뿐이다.)
 */
export const PORTAL_ART = "/skin/full/char_1012_skadi2_1.webp";

/**
 * 홈 화면 인터페이스 테마 — 사용자가 준 게임 홈 UI 테마 11종에서
 * scripts/build-portal-themes.py가 판 색·포인트 색만 뽑아 만든 팔레트.
 * 이미지를 더 넣고 스크립트만 다시 돌리면 늘어난다.
 */
export const PORTAL_THEMES: PortalTheme[] = themeData as PortalTheme[];

export function themeById(id: string | null | undefined): PortalTheme {
  return PORTAL_THEMES.find((theme) => theme.id === id) ?? PORTAL_THEMES[0];
}

/** 테마에 맞춘 뒷배경 — 아트 뒤에 깔리는 분위기 */
export function backdropOf(theme: PortalTheme): string {
  return theme.dark
    ? "linear-gradient(120deg, #0d1114 0%, #161d21 50%, #202a2b 100%)"
    : "linear-gradient(120deg, #2b3a41 0%, #47585c 45%, #6d7f7a 100%)";
}

/**
 * 들어올 때마다 무작위로 고른다 (사용자 지시 2026-07-30: "랜덤으로 적용").
 * 저장하지 않는 것이 요점 — 고정하면 랜덤이 아니게 된다. 마음에 드는 걸 계속 보고 싶으면
 * 화면의 🎲 버튼으로 그 자리에서 넘긴다.
 */
export function randomTheme(exceptId?: string): string {
  const pool = PORTAL_THEMES.filter((theme) => theme.id !== exceptId);
  const list = pool.length ? pool : PORTAL_THEMES;
  return list[Math.floor(Math.random() * list.length)].id;
}

/** 게임 상단바의 날짜·시각 표기 (YYYY/MM/DD HH:MM, KST) */
export function stageClock(locale: Locale, at: number): string {
  const parts = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}
