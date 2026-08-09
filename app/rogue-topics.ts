// 통합전략 토픽 상수 — **데이터를 전혀 import하지 않는** 경량 모듈 (2026-08-09).
//
// 왜 rogue.tsx에서 떼어냈나: 셸(home.tsx)과 만능검색(omni.ts)이 라우팅·색인 때문에
// TOPICS·slugOf만 필요한데, 이걸 rogue.tsx에서 가져오면 그 모듈이 정적으로 물고 있는
// rogue1.json(321KB)·rogue-index·node-icons까지 통째로 초기 번들에 딸려 들어온다.
// 실측(INP 조사): /operators·/stories처럼 통합전략과 무관한 페이지에서도 rogue1이
// 내려받아지고 파싱됐다. 상수만 여기 두면 그 사슬이 끊긴다.
//
// rogue.tsx는 이 파일을 다시 export하므로 기존 `from "./rogue"` 사용처는 그대로 동작한다.

export const TOPICS: { id: string; name: string; ready?: boolean; future?: boolean }[] = [
  { id: "rogue_1", name: "팬텀 & 크림슨 솔리테어", ready: true },
  { id: "rogue_2", name: "미즈키 & 카이룰라 아버", ready: true },
  { id: "rogue_3", name: "탐험가의 은빛 서리 끝자락", ready: true },
  { id: "rogue_4", name: "살카즈의 영겁 기담", ready: true },
  { id: "rogue_5", name: "쉐이의 기이한 계원", ready: true },
  { id: "rogue_6", name: "침몰자의 흑류수해", ready: true, future: true },
];

// 토픽 URL 슬러그 — /rogue/is6 (rogue_1도 경로를 갖는다)
export const slugOf = (id: string) => "is" + id.split("_")[1];

// 테마의 정본 주소 = /rogue/<slug> (2026-08-06, SEO)
export const roguePath = (localeBase: string, id: string) => `${localeBase}/rogue/${slugOf(id)}`;
