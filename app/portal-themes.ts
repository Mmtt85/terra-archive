"use client";

// 포탈(첫 화면) = 게임 홈 화면 UI를 흉내 낸 대문 (사용자 요청 2026-07-30).
//
// 구조를 둘로 나눈 이유: 게임의 홈 UI 테마는 **버튼 구성은 그대로 두고 겉모습만 갈아끼운다.**
// 그래서 여기서도
//   · PORTAL_TILES = 어떤 칸이 어디로 가는가 (사이트 기능 매핑 — 테마와 무관, 하나뿐)
//   · 겉모습(배경 아트 PORTAL_ART + 색 변수 --pt-*) = 갈아끼우는 대상
// 로 갈랐다. 색 변수는 globals.css의 `.pt-stage` / `html.dark .pt-stage`에 있다
// (아래 주석 참고 — 다크모드 번쩍임 때문에 JS가 아니라 CSS가 쥔다).


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
  { id: "base", label: "재료파밍 도우미", tab: "farm", area: "base", kind: "plate",
    desc: "정예화 재료의 최적 파밍 스테이지와 이성 효율표", icon: "◈" },
  { id: "operator", label: "오퍼 백과사전", tab: "archive", area: "operator", kind: "plate",
    desc: "소속·직군·태그·시너지로 필터·검색하는 오퍼레이터 도감", icon: "▤" },
  { id: "enemy", label: "적 도감", tab: "enemy", area: "enemy", kind: "plate",
    desc: "적 1,500여 종의 스탯·능력·면역과 등장 작전", icon: "⊗" },
  { id: "stage", label: "작전 도감", tab: "stage", area: "stage", kind: "plate",
    desc: "작전 2,200여 개의 지형 도면과 등장 적·드랍", icon: "▨" },
  { id: "story", label: "스토리", tab: "story", area: "story", kind: "plate",
    desc: "이벤트 스토리를 AI 요약과 전문(풀 스크립트)으로", icon: "✦" },
  { id: "squads", label: "통합전략 가이드", tab: "rogue", area: "squads", kind: "plate",
    desc: "층별 노드·적 도감·유물·엔딩 조건을 난이도별로 정리", icon: "❖" },
  { id: "recruit", label: "공개채용 도우미", tab: "recruit", area: "recruit", kind: "plate",
    desc: "공개모집 태그 조합으로 확정·고성급 오퍼를 탐색", icon: "◎" },
  { id: "depot", label: "오퍼 육성 시뮬", tab: "upgrade", area: "depot", kind: "plate",
    desc: "오퍼 육성에 필요한 용문폐·재료 총량을 단계별로 계산", icon: "▦" },
  { id: "mission", label: "업데이트 내역", action: "changelog", area: "mission", kind: "plate",
    desc: "최근 무엇이 바뀌었는지, 지난 기록까지 한 곳에", icon: "🛠" },
  { id: "archives", label: "테라 아카이브 소개", tab: "about", area: "archives", kind: "plate",
    desc: "각 기능이 무엇이고 언제 쓰는지 안내", icon: "ⓘ" },
  { id: "friends", label: "제안 보내기", action: "feedback", area: "friends", kind: "plate",
    desc: "잘못된 정보나 아쉬운 점을 알려주세요", icon: "💬" },
];

/**
 * 배경은 **이격 스카디 일러스트로 고정** (사용자 지시 2026-07-30).
 * ⚠ 게임 홈 스크린샷을 배경으로 쓰지 말 것 — 박사 ID·보유 재화가 찍혀 있는 개인 화면이다.
 *   (한 번 그렇게 넣었다가 공개 R2에 올라가 회수했다.)
 */
export const PORTAL_ART = "/skin/full/char_1012_skadi2_1.webp";

/** 인터페이스 팔레트(--pt-*)는 **app/globals.css의 `.pt-stage` / `html.dark .pt-stage`** 가
 *  쥔다. 사이트 밝기를 그대로 따르므로(사용자 확정 2026-07-30: "색깔만 바꿀 거면 다크/라이트
 *  두 가지만") 여기서 JS로 고르지 않는다 — 서버 렌더가 다크 여부를 몰라 정적 HTML이 늘
 *  라이트 팔레트로 나갔고, 다크 사용자의 새로고침마다 밝은 판이 번쩍였다 (2026-07-31 수정).
 */
