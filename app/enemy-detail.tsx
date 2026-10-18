"use client";

// 적 상세 본문 — 목록의 모달(app/enemies.tsx)과 상세 페이지(/enemies/<id>)가 공유한다.
//
// ⚠ **이 모듈은 데이터를 임포트하지 않는다.** 적 하나를 props로 받을 뿐이다.
//   이유(2026-08-09 실측): app/home.tsx가 이 컴포넌트를 lazy()가 아니라 **인라인**으로
//   그려야 상세 페이지 HTML에 본문이 박힌다. 빌드 산출물로 확인한 사실 —
//     dist/client/operators/<id>.html  → 본문 2,186자 (인라인 렌더)
//     dist/client/rogue/is1.html       → 본문 728자, "데이터를 불러오는 중…" (lazy)
//   그래서 표현부만 여기 두고, 1MB짜리 enemies.json은 지연 로드되는 목록 탭에만 둔다.
//   여기에 데이터 임포트를 추가하면 그 순간 모든 페이지의 첫 번들이 1MB 늘어난다.

import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import { enemySummary, DATA_DATE, dataDateLabel } from "./op-summary";
import { enemyImg, enemyImgBase, enemyPath, enemyListPath, stageListPath } from "./dex-paths";

// 다른 모듈이 종전처럼 여기서 가져다 쓰던 것들 — 정본은 app/dex-paths.ts다
export { enemyImg, enemyImgBase, enemyPath, enemyListPath };

/** scripts/build-enemies.py 산출물 한 마리. 필드 설명은 그 스크립트 헤더 참조. */
export type EnemyLevel = {
  l: number; hp: number; atk: number; def: number; res: number;
  aspd: number; ms: number; w: number; lp: number; imm: string[];
};
export type Enemy = {
  id: string; idx: string | null; name: string; rank: string | null; sort: number;
  desc: string | null; abil: string[]; dmg: string[]; race: string[];
  way: string | null; motion: string | null; rng?: number; link?: string[];
  /** 능력 줄 중 형태(페이즈) 제목인 줄의 번호 — build-enemies.py (게임 textFormat TITLE) */
  abilT?: number[];
  /** 게임 도감이 감추는 적 (hideInHandbook) — /enemies 목록엔 안 뜨고 위수 협의처럼
   *  id로 직접 여는 화면에서만 보인다. build-enemies.py의 AC_HIDDEN 참조. */
  hid?: 1;
  lv: EnemyLevel[];
};
/** 등장 작전 역색인 — stages[i] = [코드, 이름, 구역, 스테이지종류, stageId] */
// byEnemy[id] = [작전번호, 스폰수?, 스탯레벨?] — 뒤 칸은 0이면 생략된다
export type EnemyStages = { stages: [string, string, string, string, string][]; byEnemy: Record<string, number[][]> };

/** 등급 표시 — i18n 사전 키(한국어)로 준다 */
export const RANK_KEY: Record<string, string> = { NORMAL: "일반", ELITE: "정예", BOSS: "보스" };


/** 상태이상 9종(전율 2026-10-17 추가) — scripts/build-enemies.py IMMUNE_LABELS 와 같은 순서·표기 (게임 원문) */
const IMM_ALL: Record<"ko" | "en" | "ja", string[]> = {
  ko: ["기절", "침묵", "수면", "빙결", "공중 부양", "공포", "마비", "유도", "전율"],
  en: ["Stun", "Silence", "Sleep", "Freeze", "Levitate", "Fear", "Paralysis", "Lure", "Frighten"],
  ja: ["スタン", "沈黙", "睡眠", "凍結", "浮遊", "恐怖", "麻痺", "誘導", "戦慄"],
};

/** 상태이상 아이콘 — 게임에 평면 아이콘이 없어(전투 이펙트·글자뿐, 2026-10-17 에셋 전수 확인) 직접 그린 단색 선 그림.
 *  IMM_ALL 과 같은 순서. 색은 글자색(currentColor)을 따른다 (사용자 지시 2026-10-17 "한번 뽑아와 보자" → 없어서 그림) */
const ST_ICON: React.ReactNode[] = [
  // 기절 — 머리 위에서 빙글빙글 도는 고리 (게임 전투 화면의 기절 표시를 본뜸, 사용자 제보 화면 2026-10-17)
  <g key={0}><ellipse cx="8" cy="8.5" rx="6.6" ry="2.8" /><path d="M4.6 8.6c.4-1.3 1.9-2 3.6-2s3 .7 3.2 1.8c.2 1.1-1.2 1.8-3 1.8-1.4 0-2.3-.5-2.3-1.2" /><path d="M3.2 3.4l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="currentColor" stroke="none" /><circle cx="13" cy="11.8" r="0.9" fill="currentColor" stroke="none" /></g>,
  // 침묵 — 말풍선 + 사선
  <g key={1}><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" /><path d="M2 14L14 2" /></g>,
  // 수면 — Z
  <g key={2}><path d="M3 4h5l-5 5h5" /><path d="M9.5 9h3.5l-3.5 4h3.5" /></g>,
  // 빙결 — 눈 결정
  <g key={3}><path d="M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5" /><path d="M6.5 2.5L8 4l1.5-1.5M6.5 13.5L8 12l1.5 1.5" /></g>,
  // 공중 부양 — 위 화살표 + 바닥선
  <g key={4}><path d="M8 11V2.5M4.5 6L8 2.5 11.5 6" /><path d="M3 14h10" strokeDasharray="1.6 1.6" /></g>,
  // 공포 — 느낌표 삼각형
  <g key={5}><path d="M8 2l6.5 12h-13z" /><path d="M8 6.5v3.5" /><circle cx="8" cy="12" r="0.6" fill="currentColor" /></g>,
  // 마비 — 번개
  <path key={6} d="M9.5 1.5L3.5 9h4l-1 5.5 6-7.5h-4z" />,
  // 유도 — 세로 동공의 눈 (게임 전투 화면의 보라 눈 표시를 본뜸 — 평면 그림은 에셋에서 못 찾았다)
  <g key={7}><path d="M1.5 8C3.5 4.5 5.6 3.2 8 3.2S12.5 4.5 14.5 8C12.5 11.5 10.4 12.8 8 12.8S3.5 11.5 1.5 8z" /><path d="M8 5.2c.9 1 .9 4.6 0 5.6c-.9-1-.9-4.6 0-5.6z" fill="currentColor" /></g>,
];
/** 게임 원본 그림이 있는 상태이상 — 전투 화면에 뜨는 그 표시를 실루엣으로 떠서 글자색으로 칠한다 (사용자 지시 2026-10-17 "인게임 그림 긴빠이" → 2번안).
 *  출처: battle/prefabs/effects/common.ab 의 텍스처 `fear`(공포 얼굴) · `common_numb03`(마비 번개) · `blkkgt_04`(전율). 1~2KB 라 파일 대신 데이터 주소로 싣는다
 *  (CSS mask 는 다른 출처 그림에 CORS 를 요구한다 — 에셋 서버 헤더에 기대지 않는다) */
const ST_GAME: Record<number, string> = {
  5: "data:image/webp;base64,UklGRjIFAABXRUJQVlA4TCUFAAAvP8APEKemoG0bJvxJt/uDMP/zTyBpi7f9ZtO2IXuRewagBV+DTgesYaDNtViCOCkFG4QwdW1jhWwYmjJsBYP/U1O+JU7D9yURNy49GkDQurXteCRdz/O8X9K2u8e2bdu2bdu2bXumbbs76cqH+x8llVT16ZxE9H8C+N9g2NZl0RvY1uRgvdgpNWzrMcYdi3WV+Zn6bRS2tbjt/q2O8NQpkuP8Wc3sxwcndWD3+fobx1PQnjhPOo4EOPggmNMxcYx0Hon2Ey/aO/F89du4MAh7dS/SgBlc+CwBltW/qV4i7X3RibBIt8Lz5U9GguCMvp2IAbLEozquLWHflY/CrVoEX7V+zvxo6f2JmFnYZ0v3ImwgLPGYPksJh72/lA7w7Je+L+HIShcQn0iNs4GMu6WnCevNgqe14RjCqN3Qkj6pcYF0DKn+k3QB9vQa5d9OtGBqQ3qKFL1E4ikVa8Fjwo/S2guMC1Ss392DQ5vKP5jA4bOl35MF96upJ8GsmzB4Ug3dn5Lzq/TeHkz4IFfzYILggBXSv1Ph8XL9UDI7LW829fZRENbJAo58S42+1TtYxoFF+QRM+VdacQABOKPuybVrcJw2HIZHfZYklR+Oo8vjPlT7w0Rw1gYdR+yq/J5ROO11jlC5G1NnlsV4zDnm+2+//1FqfL8rDs7u/0lLv/7hm++3dTdolDOnslupI6jTHhzbyLXdNgule/Cg81FnnHPJvp32vfj0M6bT2VN2r7Rwm+2UN44lgOCgpnSGfSTdRYDjEWH0HBFhGAR3SR/ZGVLzIAJLQz9U35kc0NCdZMY+BO2RUvJOnlIWtDvjtqfOnWocwJlNfTg0mbONqnPxjzTTkwXP3E7Wwdzo38EAZ/iskyxlPlMfOS9W2hZv04H4f8XXo0kWw2ZfT80xgOjkzvgpBImhf1xLBKO/Lv5zLteWqbj5mL/KBTtzqvT9aCxxkq6CiAPefHAa0Zbg0k2f1y1jxDcaZRl7fiedyi7LqlcsjMTZ0rKd0gvSnHMJZ7au3ybxqTTnCMzdmfy8pI/r7P+Frq/VuW6D9GLaaZl0PgkIbla1dGde3CDdSt0v6NNT9SfVyqX7AG5foKJq6a3LpMU4V0sbX2TnpdLrGO2Jm6SFu7Lb65WupM7PeeMXFVLZ0it77vmeVEgqpXztXjWukJbsxskLpZtIdM64Udr8tE1ZWc0clXG8SpWqKqlQo6GiVFlIZUtPkE2ZWy3fy56WdCOJ/p2Dv5emsWOjPIba0B+KviqXKimXCqmUSlX5uh2Ck1RcwwyV824mo9uMw6tNk+30lk6kzglqSes2qpSqSir09wfKcz3JEE5S374+aVN1OBldRxymzVN5WfO2d4/4SRseGDvhL+WSVGjhtnytYvl4C991gZ63qQ0dFtGdc5WqKf6m3iWR7KynZgA7LlEpFVq0PZF9qnMJEm/pGaYVugrvzlioL9PuuZ62RMeMYMaGvKq0/mxqxrBjMEj2oVbtWP9Hi7Be/tSz7F/p5Q4eDiTu0pbWsp09wMBp+0g6mNv0R28LtHx0ek3vk9G/ZTwi3UICsADIeFcfp2Gfa14vwXVFsR+PVGv2sNQfJN55jowuk+2xRncwXcXNRA92kHQnu0pvYNaF2Ri6NuMNrRnpE7fooF7wuOZkD39HejNFF4B1FelN6TKv24k3B9ZDR/P659IjZN0Y3TovSZ/XnAFOAW5DP9JD3XWfeKr57jAziDQQHZ10gjHgxshDwBhcY7DdGGyLQbHg/4cA",
  6: "data:image/webp;base64,UklGRlgEAABXRUJQVlA4TEwEAAAvP8APEN+loG0jx/xJ3/wBYf7nn0CAMqSgyG3bBj5ltGW/gcSAI3CqyQUykpcFhfum8dx0+HYf9gW6sXaFAxTD4EUHIQrQ1rft1EKIt7m8z39fCD8BoGjb2iFJut///dG2bdu2bdtjtW3btl1IxB9xH28qIqP+fIGI/k8AsheDswyj0kPugMJLxRqGrmQy5tf6EB+MtPzOiBlG8dt6fii20uXnjR4zOu3YIWdY4GwYeKho+TXiXyh1fEWBf8LAxwB76H500UBTBtr2B/mskYoPRtp/ifgPFGmtOcHC974w8FGxj8WKzmLSWKxhnitg4aOR7oWQf0CRUjGqUOR5qHih2M+wooOYFGLsnTj81NkY+KjSrTLk77BIaXGABU6HhR84yOhHG5EUijFhnnth4aVKz4oif4NFspE2XyM+DkQ8wQFGn9vBJInFIearR0LhpZHuFSF3wCI5wErmuQcKT3CE7kNzI0nG9PhW5BVrxQ+VHgXH7QiQKAY3WSwOhMJPg2MM3zcTk2Sxm3kuhoWfisGx40YoEhVD4yKPw8Kb4wzftFSTYLTNcxc9aWDEE8XQOORKWCQqDjPkGKmjqWtBrJ6je9FIJUGxjIV4J0qV7BTDI8flsKjZoMuXiK9HDB82NPVA1IKeY/zAitQkRi/EBedY8nJoRorhkeNcWCSg7huW7KIcz8FmZOQC43sqSDaYdPLU6ZPJpy7+d5shX/eEyUZlNItcBJuiZDXd7rn45xgYZCu4xPhxI5FURgCpGRYDPpGV46HIVmVMHHIWFCUKahRY9HvPqGoiLDI2uMz4Xl0jpSRb9HnHqHoyLDJWTGXIOVBkrOj7jlHlRFhkptdi3m1YN7CJms6i/zu6igmwyFoxha44CFlb9H5DVz0BFlmLaXgrjl8uXLBwQc3zF4yESbLo+pIuNxUWmStWs+Bipna9xNSk6PqCLj8NFrUxn+njMM/h0BoUfV/R5afDojYFM3dtS9y+bclzRk+bivmfovd7unA6AtSuIHWnqogbYQFA0eUVC/kZCFDbmrKO2cvoY1MRAIrWT1ngHATw10ibjxF/hQVg0eYe81yFAB4rdjGq6ggDKFo9YIFLYOGxkcYvHY9CAUXzh8xzKQL4rFhOVxgEA0WLh8xxJQJ4LeZGzNMwULR6xBzXIIDXVqYxKo4TVbS+zxxXI4DfBpfI6xBF63vMcTUC+K0YRxfPQF20uscc1yCA5wanGT2pE6D5fea4GgE8VwyOHTcAzR8yx7UI4Htg/qV70xwtHzHHNQjgu0jLHzH3oO0D5rgKAby32MTIte30gDmuQQDvjTR97fh3g4fMcR0C+K9YyLii1xXmuQEWZWiC63F88DTzXAuLMlRMoIu+ssC1CFCORq7SkQVuQoByVBnnIsYhNyNAWRqcootDrodFWSoGFaM45HoEKJe9DENugEV5Clp+Z8gtCFCmBsMYcRsCKReRJjf5C6zAbw==",
  8: "data:image/webp;base64,UklGRtAFAABXRUJQVlA4TMMFAAAvP8APENemoG0bJvxJt/uDMP/zryBtAxa2OwKShA7YDUALHkEuxcAsDmh3rMIVclrq4pqCTlINQOAJmDJYGo/h7uyW7vv3J4Hwvv3/2rb9/92eegpsJ23HSyEwZmZmZmZm5u0F45WZmZnHXOYGDLJsS/d/x3Kc5eIuRfR/AvgXceANHi8YCOODN1g88E1TDpzdjhkUxtJ+NjjNWIJtE33HDAr8idsCbBM5vM2KpoD951wYV9Fmj1y/WumYoZK2ggs2yGQCgw0yGc+Al8lkDJggk/HBN20L4zjR9A5aGzkuZ45WVGgwsA6pJk3FikafiXVSDAyfo3xS3j85JdN+QleHS669q+tI4Piuri7AdnR1DQdcGFdUnNfs4WDqAtgQl5P4p7t8YyzBQ3+G4f527vgrDL9uhxlhWDgBhu8PwyXgYvD+qyiO4g3gAz7HrpZC6SkPCBj1hySdwIuSCl/Bcklb7jKnSNp2hjHGWI55XQqlsW2Oh3E7PpaKSd9nR5OFLCepdjA60MFLtahbq2FO1B3pfbL7K9GPlxscyDL0je64lFQvwcPltl3FWlF/QwuQobMvyau3kxcSlWqzYb5KKj/eck8x1s8XpDgOw3arN9HdWGPNZcukUHvafZvSFSrlRamk+Wm65UyprF8uTjHuaeOjJFLf9VhDEFwjhVFtz7MGMyBzop4oufksVfPRj5caHCfgiX0lFXTonIw1YLF3jZak7TMfhtwArJdUvH3I05J2HIXjwht/S1VtuBoMgAunvTgrDqXFPi3NzIOXv/vmu7fOgv9/992b4Nthzx1WvlZZdDuuS6qTwb6QqCf5oYVcM3NoOqCzoKgqXcUQQwPDF3GkktZAazNzwTRhyT63V2XpVSzpvst1P6lS0KSTjMnS2RMeDPd38FwYHo4WwBeb1m7atHHDxk3rNy2+K8Cl5dndCit7P8ZxHcDCfSuLZWn0mRiT4WTVnx58JElTYZ36mbyWw4Uj7pgn6dAHgMG4HY/8JlXKi9sYAj7Hz5w/fd44n8umzpj17U0wrXCwUCiFYZgP/34yi8XCBasrfdLz5w7BeLwn1ULtgCz9HXp0FiCAhYqVWtWeZ+pwPE7aq3yiLzuNkxI3d92qA4vuveT0/30KS9Wwqj1Pp3h+XV+s61wf43Y88ltUDMuL2xhi8Dl+1oLZi3+TtP2ndcUFbuaKO++4885FqqqqvS/nsCaAC1dXeqXnM1iwcL/qR58PZDlZ9XFZ9XNJ/1BlVfTnDR4u3PHyLEkH3gYDkHWZtPHPuKgFJ3tk6OwO+8qVREm1UqxtvvHcCy6++KKLZqiisjYNx7jeqTukqLLtPRwnBYzDM1JRW44lS1eoSANb1pZOAkb9rVpNuoMMjQ3cLXXrQBtZTpTKA1SMNp5Ihs6qVJUuYVgjE/DQmkqoTbdm8TlmTl81bpRUK6mxkrL0+xB803LXcyvCqLLkdgKb4sG1v6qmrfcAjnEv3qmoUT/jRNvmvgOOAT6XqtpwJVjAOLTvVW+8/1qygAsLq2FzsbTnNR8HcALv9T3dcV772o1rIODEXpWS/Rc4GMCBuzfGcTO1grpHepZ06w9/tS8J1XsqAa55bIeSknYNwafe2NYxqiZNSN9fBNZJq9+pvPT5icZae8MCxXlth1yaw3Vr4iTpR6zk80/uxPNomGXouz1JMdF7I6yDT261KpUD11rcOoxrHo3jKG4cxpWjIaCx4ZhXpEhafRw+EBg2JEXpRuunkDFXSokax9IZTo7GxvH/oyiO4g3gAxjD8Dkqav/TOKYuyzVq9iyTbeTCpILivOYMB1OH43LmaBX0+xsGB7C0PfTQAw81fuChB4dhGxiH4b+rp6LRZ+I6NGylY4Z61Q0e/7QD5+1SpOkdtNLfHN5mlSaATXH8Zk3/TpofabNHjv5bgm0TfccwCI0NJm4LsDTpwNntGAZp+9ngNIPxwWNwGg98wwAGHoPWC/gXMQA=",   // 전율 — common.ab `blkkgt_04` (주먹 + 지그재그)
};
function StatusIcon({ i }: { i: number }) {
  const g = ST_GAME[i];
  if (g) return <span className="en-st-icon game" style={{ WebkitMaskImage: `url(${g})`, maskImage: `url(${g})` }} aria-hidden />;
  return <svg className="en-st-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden>{ST_ICON[i]}</svg>;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
/** 큰 수치는 세 자리마다 쉼표 — 37,000 (사용자 지시 2026-10-17). 소수는 그대로 */
const fmtK = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : fmt(n));

/** 초상 — 변종 id에 파일이 없으면 원본 id로 한 번 폴백한다 */
function Portrait({ enemy, size, src }: { enemy: Enemy; size: number; src?: string }) {
  const base = enemy.id.replace(/_\d+$/, "");
  return (
    <img className="en-portrait" src={src ?? enemyImg(enemy.id)} alt="" aria-hidden
      width={size} height={size} loading="lazy" decoding="async"
      onError={(e) => {
        const el = e.currentTarget;
        if (base !== enemy.id && !el.dataset.fb) { el.dataset.fb = "1"; el.src = enemyImgBase(enemy.id); }
        else el.style.visibility = "hidden";
      }} />
  );
}

/** 스탯표를 그 자리의 수치로 바꿔 달 때 — 단계 대신 붙일 라벨 · 배율로 달라진 칸 · 표 위 안내.
 *  /rogue 적 모달이 쓴다: 테마 레벨 파일이 덮어쓴 수치에 난이도·긴급 배율을 곱한 한 줄이다
 *  (본 도감 단계표 그대로면 통합전략 적 1,601종 중 313종이 틀린 값이다 — 2026-09-23 실측). */
export type StatOverride = { label: string; up?: readonly ("hp" | "atk" | "def" | "res")[]; notes?: string[] };

/** 적 전체(도감에 보이는 적의 모든 강화 단계)에서 5% 간격 분위 — 스탯 막대 길이·'상위 N%'의 기준 (2026-10-17, app/data/enemies.json 에서 셈).
 *  분포가 한쪽으로 쏠려(HP 중앙값 12,000 · 최대 250만) 고정 눈금이면 막대가 대부분 바닥에 붙는다 — 그래서 백분위로 */
const QUANT: Record<"hp" | "atk" | "def" | "res" | "ms" | "w", number[]> = {
  hp: [0, 1800, 3000, 3800, 4500, 5000, 6000, 7200, 8000, 10000, 12000, 14000, 15000, 20000, 24000, 30000, 40000, 50000, 80000, 100000, 2500000],
  atk: [0, 0, 150, 250, 300, 330, 360, 400, 450, 500, 550, 600, 700, 750, 800, 900, 1000, 1200, 1500, 2000, 20000],
  def: [0, 0, 0, 50, 100, 100, 150, 180, 200, 250, 300, 300, 400, 500, 550, 650, 800, 900, 1050, 1500, 8000],
  res: [0, 0, 0, 0, 0, 0, 0, 10, 10, 20, 20, 20, 30, 30, 40, 50, 50, 50, 60, 65, 99],
  ms: [0, 0.3, 0.45, 0.5, 0.6, 0.6, 0.7, 0.7, 0.7, 0.75, 0.8, 0.8, 0.9, 1, 1, 1, 1, 1, 1.2, 1.5, 3.5],
  w: [0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 13],
};
/** 백분위(0~100) — 같은 값이 여러 분위에 걸치면 그 가운데 */
function pctOf(q: number[], v: number): number {
  let lo = q.findIndex((x) => x >= v);
  if (lo < 0) return 100;
  let hi = lo;
  while (hi + 1 < q.length && q[hi + 1] <= v) hi++;
  if (q[lo] > v && lo > 0) { const f = (v - q[lo - 1]) / (q[lo] - q[lo - 1] || 1); return (lo - 1 + f) * 5; }
  lo = Math.max(0, lo);
  return ((lo + hi) / 2) * 5;
}

/** 스탯 시트 — 표 대신 스탯마다 한 줄: 이름 · 값(기본형 대비 오른 만큼) · 적 전체 대비 막대와 '상위 N%'.
 *  강화 단계가 여럿이면 위 탭으로 단계를 고른다 (사용자 지시 2026-10-17 "굳이 표로 해야 하나, 진짜 예쁘게").
 *  종전 표(스탯이 열, 단계가 행 — 2026-08-09)는 걷었다. /rogue 모달은 그 자리 수치 한 줄(ctx)만, 배율이 걸린 값은 강조 */
function StatTable({ levels, ctx, sel, withoutKey }: { levels: EnemyLevel[]; ctx?: StatOverride; sel: number; withoutKey?: boolean }) {
  const { t } = useI18n();
  const cur = levels[Math.min(sel, levels.length - 1)] ?? levels[0];
  const base = levels[0];
  const rows: { k: string; label: string; get: (l: EnemyLevel) => number; unit?: string; q?: number[]; key?: boolean }[] = [
    { k: "hp", label: "최대 HP", get: (l) => l.hp, q: QUANT.hp, key: true },
    { k: "atk", label: "공격력", get: (l) => l.atk, q: QUANT.atk, key: true },
    { k: "def", label: "방어력", get: (l) => l.def, q: QUANT.def, key: true },
    { k: "res", label: "마법 저항", get: (l) => l.res, unit: "%", q: QUANT.res, key: true },
    { k: "ms", label: "이동 속도", get: (l) => l.ms, q: QUANT.ms },
    { k: "w", label: "무게", get: (l) => l.w, q: QUANT.w },
    { k: "aspd", label: "공격 속도", get: (l) => l.aspd },
    { k: "lp", label: "라이프 감소", get: (l) => l.lp },
  ];
  const up = (k: string) => !!ctx?.up?.includes(k as "hp");
  return (
    <div className="en-sheet">
      {ctx && <p className="en-sheet-ctx">{ctx.label}</p>}
      <dl className="en-sheet-rows">
        {rows.filter((r) => !(withoutKey && r.key)).map(({ k, label, get, unit, q, key }) => {
          const v = get(cur), d = v - get(base);
          const p = q ? pctOf(q, v) : null;
          return (
            <div key={k} className={`${key ? "key" : ""}${up(k) ? " up" : ""}`}>
              <dt>{t(label)}</dt>
              <dd>
                <span className="en-v"><b>{fmtK(v)}{unit}</b>
                  {cur !== base && d !== 0 && <small className={d > 0 ? "plus" : "minus"}>({d > 0 ? "+" : "−"}{fmtK(Math.abs(d))}{unit})</small>}</span>
                {p != null && (
                  <span className="en-bar" title={t("적 전체 중 상위 {n}%", { n: String(Math.max(1, Math.round(100 - p))) })}>
                    <i style={{ width: `${Math.max(2, p)}%` }} />
                  </span>
                )}
                {p != null && <em>{t("상위 {n}%", { n: String(Math.max(1, Math.round(100 - p))) })}</em>}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** 공격 범위 — 적은 오퍼처럼 칸 모양이 아니라 **반지름**(rangeRadius, 칸 단위)이다. 칸으로 보이게 중심이 반지름 안에 드는 칸을
 *  칠한 근사 그림 (사용자 지시 2026-10-17 "공격 범위도 오퍼 스킬처럼 칸으로"). 반지름 5칸 넘게는(파우스트 20 등) 그림 없이 숫자만 */
function RangeTile({ r }: { r: number }) {
  const { t } = useI18n();
  const n = Math.ceil(r - 0.5);   // 원이 걸치는 칸까지
  const draw = r <= 5;
  const C = n <= 2 ? 11 : n <= 3 ? 9 : 7, size = (2 * n + 1) * C, mid = size / 2;
  const cells: React.ReactNode[] = [];
  if (draw) for (let y = -n; y <= n; y++) for (let x = -n; x <= n; x++) {
    const on = x * x + y * y <= r * r + 1e-9;
    cells.push(<rect key={`${x}:${y}`} className={x === 0 && y === 0 ? "origin" : on ? "on" : ""} x={(x + n) * C + 0.5} y={(y + n) * C + 0.5} width={C - 1} height={C - 1} />);
  }
  // 칸(중심이 반지름 안이면 칠함) + 실제 판정인 원을 겹쳐 그린다 (사용자 지시 2026-10-17 "칸이랑 원 두 개 다")
  return (
    <div className="en-range" title={t("공격 범위 반지름 {n}칸 — 실제 판정은 원(선), 칠한 칸은 중심이 원 안에 드는 칸", { n: fmt(r) })}>
      <dt>{t("공격 범위")}</dt>
      <dd>{t("{n}칸", { n: fmt(r) })}{!draw && <small>{t("사실상 맵 전체")}</small>}</dd>
      {draw && (
        <svg className="en-range-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          {cells}
          <circle cx={mid} cy={mid} r={r * C} />
        </svg>
      )}
    </div>
  );
}

/** 강화 단계 탭 — 머리에 하나만 두고 핵심 수치·스탯 시트가 같이 따른다 (사용자 지시 2026-10-17 "일반 탭 강화 탭을 따로") */
function LevelTabs({ levels, sel, onSel }: { levels: EnemyLevel[]; sel: number; onSel: (i: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="en-lvtabs" role="tablist" aria-label={t("강화 단계")}>
      {levels.map((l, i) => (
        <button type="button" role="tab" key={l.l} aria-selected={i === sel} className={i === sel ? "on" : ""} onClick={() => onSel(i)}>
          {l.l === 0 ? t("기본형") : t("강화 {n}단계", { n: String(l.l) })}
        </button>
      ))}
    </div>
  );
}

/** 머리의 핵심 수치 — HP·공격력·방어력·마법 저항, 고른 강화 단계의 값과 기본형 대비 차이 */
function KeyStats({ levels, sel, rng }: { levels: EnemyLevel[]; sel: number; rng?: number }) {
  const { t } = useI18n();
  const a = levels[0], cur = levels[Math.min(sel, levels.length - 1)] ?? a;
  // 타일마다 값 · 기본형 대비 차이 · 적 전체 대비 막대와 '상위 N%' (사용자 지시 2026-10-17 "이거 좀 더 예쁘게") —
  // 막대가 여기 있으니 아래 스탯 시트는 이 넷을 빼고 나머지 스탯만 보인다
  const items: [string, (l: EnemyLevel) => number, number[], string?][] = [
    ["최대 HP", (l) => l.hp, QUANT.hp], ["공격력", (l) => l.atk, QUANT.atk], ["방어력", (l) => l.def, QUANT.def], ["마법 저항", (l) => l.res, QUANT.res, "%"],
  ];
  return (
    <dl className="en-key">
      {items.map(([k, get, q, unit]) => {
        const v = get(cur), d = v - get(a), p = pctOf(q, v), top = Math.max(1, Math.round(100 - p));
        return (
          <div key={k}>
            <dt>{t(k)}<em title={t("적 전체 중 상위 {n}%", { n: String(top) })}>{t("상위 {n}%", { n: String(top) })}</em></dt>
            <dd>{fmtK(v)}{unit}{d !== 0 && <small className={d > 0 ? "plus" : "minus"}>({d > 0 ? "+" : "−"}{fmtK(Math.abs(d))}{unit})</small>}</dd>
            <span className="en-bar" aria-hidden><i style={{ width: `${Math.max(2, p)}%` }} /></span>
          </div>
        );
      })}
      {/* 다섯째 타일 — 공격 범위 그림 (칩 줄에선 너무 작았다) */}
      {rng != null && rng > 0 && <RangeTile r={rng} />}
    </dl>
  );
}

/** 등장 작전 — 구역별로 묶어서. stagesDoc이 아직 안 왔으면 아무것도 그리지 않는다. */
function Appearances({ enemy, doc, onOpenStage }: { enemy: Enemy; doc: EnemyStages | null; onOpenStage?: (sid: string) => void }) {
  const { locale, t } = useI18n();
  const refs = doc?.byEnemy[enemy.id];
  if (!doc || !refs || !refs.length) return null;
  // 역색인은 이미 메인→막간→섬멸→자원→보안파견→이벤트 순으로 쌓여 있다
  // (build-enemies.py의 TYPE_ORDER) — 여기서 다시 정렬하지 않고 구역 경계만 나눈다.
  const groups: { zone: string; items: { code: string; name: string; cnt: number; lv: number; sid: string }[] }[] = [];
  for (const r of refs) {
    const s = doc.stages[r[0]];
    if (!s) continue;
    const last = groups[groups.length - 1];
    const item = { code: s[0], name: s[1], cnt: r[1] ?? 0, lv: r[2] ?? 0, sid: s[4] };
    if (last && last.zone === s[2]) last.items.push(item);
    else groups.push({ zone: s[2], items: [item] });
  }
  const reinforced = groups.some((g) => g.items.some((it) => it.lv > 0));
  return (
    <section className="en-block">
      <h3><span className="section-no">STAGES</span>{t("등장 작전")} <em>{refs.length}</em></h3>
      {reinforced && <p className="en-note">{t("★ 뒤의 숫자는 그 작전에서의 강화 단계입니다 — 위 스탯의 단계 탭과 같습니다.")}</p>}
      <div className="en-stagelist">
        {groups.map((g, gi) => (
          <div className="en-stagegroup" key={`${g.zone}-${gi}`}>
            <h4>{g.zone}<em>{g.items.length}</em></h4>
            <ul>
              {g.items.map((it, ii) => (
                <li key={`${it.code}-${ii}`} className={it.lv > 0 ? "reinforced" : undefined}>
                  {/* 작전 도감으로 — 상세 라우트가 없는 이벤트 작전도 있어 **목록 + 해시**로 연다 */}
                  {/* 작전 도감으로 **넘어가지 않고** 상세를 겹쳐 띄운다 (사용자 요청
                      2026-08-09). 콜백이 없는 자리(상세 페이지)에선 링크로 폴백한다. */}
                  <a href={`${stageListPath(locale)}#st-${it.sid}`}
                    onClick={(e) => {
                      if (!onOpenStage || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault(); onOpenStage(it.sid);
                    }}>
                    {/* 별만 찍지 않고 몇 단계 강화인지 숫자로 (사용자 지적 2026-08-10) */}
                    {it.lv > 0 && <i className="en-lv" aria-hidden title={t("강화 {n}단계", { n: String(it.lv) })}>★{it.lv}</i>}
                    <b>{it.code}</b><span>{it.name}</span>
                    {it.cnt > 0 && <em>×{it.cnt}</em>}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * 적 상세 본문.
 *  · stagesDoc — 등장 작전 색인. 상세 **페이지**는 서버가 넣어 주고(프리렌더 대상),
 *    목록 모달은 열릴 때 지연 로드한다. null이면 그 절만 빠진다.
 *  · onOpenEnemy — 연계 소환 적으로 이동 (목록 안에서만 동작, 페이지에선 링크로 폴백)
 *  · nameOf — 연계 소환 적의 **이름**. 이 컴포넌트는 적 하나만 받으므로 다른 적의 이름을
 *    스스로 알 수 없다. 안 넘기면 `enemy_1588_ubbphw` 같은 **id가 날것으로** 찍힌다
 *    (사용자 제보 2026-08-13 생존연산 · 2026-09-17 이벤트 도감 "파블로비치, 추밀관").
 *    모달로 띄우는 자리는 어차피 dex-cross의 적 맵을 받아 두었으니 그 맵을 그대로 넘긴다.
 *    ⚠ 빠뜨리면 scripts/check-dexlinks.mjs가 빌드를 멈춘다.
 *  · title · portrait · statCtx — /rogue 적 모달만 쓴다 (CN 원문·번역 두 줄 이름, 테마 초상,
 *    그 자리의 스탯 한 줄). 안 넘기면 본 도감 그대로다.
 */
export function EnemyFile({ enemy, stagesDoc, nameOf, onOpenEnemy, onOpenStage, title, portrait, statCtx }: {
  enemy: Enemy; stagesDoc: EnemyStages | null;
  nameOf?: (id: string) => string | undefined;
  onOpenEnemy?: (id: string) => void;
  onOpenStage?: (sid: string) => void;
  title?: React.ReactNode;
  portrait?: string;
  statCtx?: StatOverride;
}) {
  const { locale, t } = useI18n();
  // 고른 강화 단계의 면역 — 단계마다 다를 수 있다 (통합전략처럼 그 자리 수치면 첫 줄)
  const [lvSel, setLvSel] = useState(0);
  const imm = (statCtx ? enemy.lv[0] : enemy.lv[Math.min(lvSel, enemy.lv.length - 1)])?.imm ?? enemy.lv.find((l) => l.imm.length)?.imm ?? [];
  // 공격·이동 방식·피해 유형·공격 범위 — 따로 한 구역을 차지하지 않고 머리 배지 줄에 '이름표 + 값' 칩으로
  // (사용자 지시 2026-10-17 "굳이 한 섹션을 잡아먹을 필요가 없어 보인다"). 칩 이름표는 짧게, 마우스를 올리면 원래 이름
  const facts: [string, string, string][] = [
    ...(enemy.way ? [[t("공격"), t("공격 방식"), enemy.way] as [string, string, string]] : []),
    ...(enemy.motion ? [[t("이동"), t("이동 방식"), enemy.motion] as [string, string, string]] : []),
    ...(enemy.dmg.length ? [[t("피해"), t("피해 유형"), enemy.dmg.join(" · ")] as [string, string, string]] : []),
  ];
  return (
    <div className="en-file">
      {/* 머리 — 초상 | 번호·이름·꼬리표 | 오른쪽 위: 강화 단계 탭 + 설명 (사용자 지시 2026-10-18 "설명은 맨 위 띠 오른쪽 위에").
          핵심 수치 넷은 그 아래 줄에 넓게 */}
      <header className={`en-head${enemy.desc ? " has-desc" : ""}`}>
        <Portrait enemy={enemy} size={132} src={portrait} />
        <div className="en-head-main">
          <div className="en-head-top">
            <span className="en-code">{enemy.idx ?? "—"}</span>
          </div>
          <h1>{title ?? enemy.name}</h1>
          <div className="en-badges">
            {enemy.rank && <span className={`en-rank r-${enemy.rank.toLowerCase()}`}>{t(RANK_KEY[enemy.rank] ?? enemy.rank)}</span>}
            {enemy.race.map((r) => <span className="en-tag" key={r}>{r}</span>)}
            {facts.map(([short, full, v]) => <span className="en-fact" key={full} title={full}><small>{short}</small>{v}</span>)}
          </div>
        </div>
        {(enemy.desc || (!statCtx && enemy.lv.length > 1)) && (
          <div className="en-head-side">
            {!statCtx && enemy.lv.length > 1 && <LevelTabs levels={enemy.lv} sel={lvSel} onSel={setLvSel} />}
            {enemy.desc && <p className="en-desc">{enemy.desc}</p>}
          </div>
        )}
        {/* 핵심 수치 넷 — 표까지 내려가지 않아도 바로 보이게. 강화 단계가 있으면 최고 단계 값을 화살표로 (2026-10-17 가독성 손질).
            그 자리 수치로 바꿔 다는 /rogue 모달(statCtx)은 표가 정답이라 뺀다 */}
        {!statCtx && enemy.lv.length > 0 && <div className="en-head-keys"><KeyStats levels={enemy.lv} sel={lvSel} rng={enemy.rng} /></div>}
      </header>

      {enemy.abil.length > 0 && (
        <section className="en-block">
          <h3><span className="section-no">ABILITY</span>{t("능력")}</h3>
          {/* 형태 제목 줄(abilT)은 번호 없는 소제목 — 그 아래가 그 형태의 능력. 번호는 능력 줄만 센다 */}
          <ol className="en-abil">{(() => {
            let n = 0;
            return enemy.abil.map((a, i) => enemy.abilT?.includes(i)
              ? <li key={i} className="en-abil-title"><span>{a}</span></li>
              : <li key={i}><i aria-hidden>{String(++n).padStart(2, "0")}</i><span>{a}</span></li>);
          })()}</ol>
        </section>
      )}

      <section className="en-block">
        <h3><span className="section-no">STAT</span>{t("스탯")}</h3>
        {statCtx ? statCtx.notes?.map((n) => <p className="en-note" key={n}>{n}</p>) : enemy.lv.length > 1 && (
          <p className="en-note">{t("같은 적이라도 작전에 따라 더 강한 스탯으로 나옵니다 — 위의 단계 탭으로 바꿔 볼 수 있습니다. 막대는 적 전체 중 어느 정도인지입니다.")}</p>
        )}
        <StatTable levels={enemy.lv} ctx={statCtx} sel={statCtx ? 0 : lvSel} withoutKey={!statCtx && enemy.lv.length > 0} />
      </section>

      {/* 상태이상 8종을 다 깔고 면역인 것만 표시 — 면역이 아닌(통하는) 것도 보이게 (사용자 지시 2026-10-17).
          목록·표기는 build-enemies.py IMMUNE_LABELS 와 같아야 한다 */}
      <section className="en-block">
        <h3><span className="section-no">STATUS</span>{t("상태이상")} <em>{t("면역 {n}/{m}", { n: String(imm.length), m: String(IMM_ALL[locale as "ko"]?.length ?? 8) })}</em></h3>
        <div className="en-status">
          {(IMM_ALL[locale as "ko"] ?? IMM_ALL.ko).map((x, i) => imm.includes(x)
            ? <span className="en-imm" key={x}><StatusIcon i={i} /><b>{x}</b><small>{t("면역")}</small></span>
            : <span className="en-st-ok" key={x}><StatusIcon i={i} /><b>{x}</b></span>)}
        </div>
      </section>

      {enemy.link && enemy.link.length > 0 && (
        <section className="en-block">
          <h3><span className="section-no">LINK</span>{t("연계 소환")}</h3>
          <div className="en-links">
            {enemy.link.map((id) => (
              <a key={id} href={enemyPath(locale, id)}
                onClick={(e) => {
                  if (!onOpenEnemy || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault(); onOpenEnemy(id);
                }}>{nameOf?.(id) ?? id}</a>
            ))}
          </div>
        </section>
      )}

      <Appearances enemy={enemy} doc={stagesDoc} onOpenStage={onOpenStage} />
    </div>
  );
}

/** 상세 페이지(/enemies/<id>) — 목록 대신 이 적 하나만 그린다 */
export function EnemyPage({ enemy, stagesDoc, onBack }: {
  enemy: Enemy; stagesDoc: EnemyStages | null; onBack?: () => void;
}) {
  const { locale, t } = useI18n();
  // 연계 소환 적의 이름 — 서버가 내려 주는 건 **이 적 하나**뿐이라 링크에는 id밖에 없다.
  // 하이드레이션 뒤에 도감을 받아 채운다 (링크가 있는 적일 때만).
  // ⚠ 머리주석의 '데이터 임포트 금지'는 지킨다 — dex-cross를 **동적으로** 부르므로
  //   이 모듈의 정적 임포트 그래프에 데이터가 들어오지 않고 첫 번들도 그대로다.
  const [links, setLinks] = useState<Map<string, Enemy> | null>(null);
  useEffect(() => {
    if (!enemy.link?.length) return;
    let live = true;
    void import("./dex-cross")
      .then((m) => m.loadEnemies(locale))
      .then((m) => { if (live) setLinks(m); });
    return () => { live = false; };
  }, [enemy.id, enemy.link, locale]);
  return (
    <div className="operator-page-wrap">
      <a className="story-back" href={enemyListPath(locale)}
        onClick={(e) => {
          if (!onBack || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault(); onBack();
        }}>← {t("적 목록으로")}</a>
      {/* 요약 한 단락 + 데이터 확인일 — AI 검색이 인용할 사실 문장 (2026-10-12). 페이지에만 (app/op-summary.ts) */}
      <p className="op-summary">
        {enemySummary(locale, enemy, enemy.rank ? t(RANK_KEY[enemy.rank] ?? enemy.rank) : "",
          (stagesDoc?.byEnemy[enemy.id] ?? []).map((r) => stagesDoc!.stages[r[0]]?.[0]).filter((c): c is string => !!c))}
        {DATA_DATE && <span className="op-summary-date"> {t("게임 데이터 확인 {date}", { date: dataDateLabel(locale) })}</span>}
      </p>
      <section className="operator-modal operator-page en-page" aria-label={enemy.name}>
        <EnemyFile enemy={enemy} stagesDoc={stagesDoc} nameOf={(id) => links?.get(id)?.name} />
      </section>
    </div>
  );
}
