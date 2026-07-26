"use client";

// 실패한 검색 → 최종 목적지 잇기 (사용자 요청 2026-07-25).
//
//   "날시"로 검색 → 아무것도 없음 → 검색창을 닫고 백과사전에서 "켈시"를 찾아
//   Kal'tsit·Esperanta를 클릭 → 그러면 날시 = Kal'tsit·Esperanta다.
//   "뱅제" → 없음 → "은재" → 없음 → 실버애쉬 더 레인프로스트 클릭도 같은 방식.
//
// **연결은 브라우저가 아니라 DB에서 한다** (사용자 확정: 학습은 전부 DB에 쌓는다).
// 클라이언트는 사실 두 가지만 보고한다:
//   · miss  — "이 검색어로 0건이 나왔다"
//   · visit — "이 컨텐츠에 도착했다"
// 같은 session의 miss 뒤 10분 안의 **첫 visit**을 SQL 뷰(omni_trail_counts)가 짝지어
// 가중치로 만든다. 그래서 이 파일에는 학습 데이터도, 저장소도 없다.
//
// 메모리에 두는 건 "최근에 못 찾은 게 있나" 플래그뿐이다 — 그게 있을 때만 visit을 보내
// 모든 방문을 서버로 밀어 올리지 않는다. 새로고침하면 그 한 번의 연결은 놓친다(임시 상태).

import { recordMiss, recordVisit } from "./omni-picks";

const WINDOW_MS = 10 * 60_000;   // DB 뷰의 짝짓기 창(10분)과 같게 유지할 것

let lastMissAt = 0;
let lastMissQ = "";
const reported = new Set<string>();   // 같은 검색어를 반복해서 보내지 않는다 (페이지 수명)

/** 결과가 0건이었던 검색어 — DB에 남기고, 잠시 visit 보고를 켠다. */
export function noteMiss(q: string, locale = "ko"): void {
  if (!q || q.length < 2 || q.length > 40) return;
  lastMissAt = Date.now();
  lastMissQ = q;
  if (reported.has(q)) return;
  reported.add(q);
  recordMiss(q, locale);
}

/** 최근(10분)의 실패 검색어 — 검색 패널이 "실패 후 재검색해 고른" 선택을 즉시 연결하는 데 쓴다
 *  (사용자 제보 2026-07-26: '보텀' 실패 → '트라고디아'로 재검색해 클릭해도 학습이 안 됐다). */
export function recentMissQ(): string | null {
  return lastMissAt && Date.now() - lastMissAt <= WINDOW_MS ? (lastMissQ || null) : null;
}
/** 실패 검색을 선택에 연결해 소진 — 다음 클릭에 또 붙지 않게. */
export function consumeMiss(): void { lastMissAt = 0; lastMissQ = ""; }

/** 실제 컨텐츠 도착 — 최근에 못 찾은 검색이 있을 때만 보고한다.
 *  uid는 유니버셜 서치 색인과 같은 형식(op:char_… / story:… / mat:… / rg:토픽:섹션:id). */
export function noteArrival(uid: string, meta: { kind: string; name: string; locale: string }): void {
  if (!lastMissAt || Date.now() - lastMissAt > WINDOW_MS) return;
  recordVisit(uid, meta);
}

/** 탭 이동·새 검색어 등 — 지금은 DB 쪽 시간 창이 판정하므로 아무 상태도 두지 않는다. */
export function noteAction(): void { /* 호환용 (시간 창 기반으로 바뀌며 비었다) */ }
