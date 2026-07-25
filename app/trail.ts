"use client";

// 실패한 검색의 **최종 목적지 추적** (사용자 요청 2026-07-25).
//
//   "날시"로 검색 → 아무것도 없음 → 검색창을 닫고 백과사전에서 "켈시"를 찾아
//   Kal'tsit Esperanta를 클릭 → 그러면 날시 = Kal'tsit Esperanta다.
//   "뱅제" → 없음 → "은재" → 없음 → "실버애쉬" → 실버애쉬 더 레인프로스트 클릭
//   → 뱅제·은재 둘 다 그 오퍼로 이어진다.
//
// 동작: 결과가 0건인 검색어를 **미해결 미스**로 쌓아 두고, 이후 몇 번의 행동 안에
// 실제 컨텐츠(오퍼·스토리·재료·통합전략 상세)에 도착하면 그 미스들에 귀속시킨다.
// 귀속된 표는 직접 클릭(pick)이 아니라 **추론(trail)**이라 가중치를 절반만 준다.
//
// 저장은 sessionStorage(탭 단위) — 창을 닫으면 사라지는 임시 흔적이고, 확정된 학습만
// omni-picks(로컬 + Supabase 집계)로 넘어간다.

import { recordTrail } from "./omni-picks";

const KEY = "ta-omni-trail";
const MAX_ACTIONS = 10;             // 미스 이후 이 횟수 안의 도착만 귀속 (사용자 제안 5~10)
const MAX_AGE_MS = 10 * 60_000;     // 10분이 지나면 다른 볼일로 본다
const MAX_MISSES = 6;               // 동시에 추적하는 미스 수 (뱅제→은재→이격은재…)

type Miss = { q: string; at: number; actions: number };

function read(): Miss[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Miss[]) : [];
    const now = Date.now();
    return Array.isArray(list) ? list.filter((m) => m && now - m.at < MAX_AGE_MS && m.actions <= MAX_ACTIONS) : [];
  } catch { return []; }
}

function write(list: Miss[]): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_MISSES))); } catch { /* ignore */ }
}

/** 결과가 0건이었던 검색어를 기억한다 (정규화된 문자열). 유니버셜 서치·탭 검색창 공용. */
export function noteMiss(q: string): void {
  if (!q || q.length < 2 || q.length > 40) return;
  const list = read();
  if (list.some((m) => m.q === q)) return;         // 같은 검색어는 한 번만
  list.push({ q, at: Date.now(), actions: 0 });
  write(list);
}

/** 사용자의 행동 1회 (탭 이동·새 검색어 입력 등) — 미스에서 너무 멀어지면 추적을 끊는다. */
export function noteAction(): void {
  const list = read();
  if (!list.length) return;
  write(list.map((m) => ({ ...m, actions: m.actions + 1 })).filter((m) => m.actions <= MAX_ACTIONS));
}

/** 실제 컨텐츠 도착 — 미해결 미스 전부에 귀속시키고 흔적을 지운다.
 *  uid는 유니버셜 서치 색인과 같은 형식(op:char_… / story:… / mat:… / rg:토픽:섹션:id). */
export function noteArrival(uid: string, meta: { kind: string; name: string; locale: string }): void {
  const list = read();
  if (!list.length) return;
  write([]);
  for (const miss of list) recordTrail(miss.q, uid, { ...meta, steps: miss.actions });
}

/** 추적 중인 미스가 있는지 (디버깅·표시용) */
export const pendingMisses = (): string[] => read().map((m) => m.q);
