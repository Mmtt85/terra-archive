"use client";

// 유니버셜 서치 선택 학습 — 되묻기("이 중에 무엇인가요?")에서 **사이트를 쓰는 사람들 전체가**
// 무엇을 골랐는지 모아 같은 검색어의 1순위를 정한다 (사용자 확정 2026-07-25:
// "자기 자신한테만 적용되면 안돼 — 모든 사람 데이터를 수집해서 가중치를").
//
// 가중치 = **사람 수(voters)** 기준으로 센다:
//   · 사람들의 선택 (Supabase `omni_pick` → 뷰 `omni_pick_counts`) = 정본.
//     같은 사람이 반복 클릭해도 1표(session으로 중복 제거)이고, **서로 다른 2명 이상**이
//     고른 조합만 공개된다 → 한 사람이 전역 순위를 흔들 수 없다.
//   · 내 선택 (localStorage) = 그 기기에서만 **2표 상당**으로 얹힌다. 내가 한 번 고르면
//     내 화면에서는 즉시 1순위(보너스 32 > 확신 문턱 30)가 되지만, 남의 화면은 안 바뀐다.
//   → 최종 가중 = crowdVoters + (내가 고른 적 있으면 2)  ·  보너스 = min(45, 18+9·log2(1+가중))
//
// 테이블이 없거나(설치 전 404) 네트워크가 죽어도 로컬 학습만으로 정상 동작한다.
// 설치 SQL: docs/supabase-omni-picks.sql · 스팸 삭제는 /admin과 같은 x-admin-key.
//
// 저장 값: 정규화된 검색어 + 고른 항목 id + (종류·이름·언어·순위·후보수·근사/힌트 여부) +
// 익명 랜덤 session id. 개인 식별 정보나 입력 이력은 저장하지 않는다.

import { SUPABASE_ANON_KEY, SUPABASE_URL, feedbackReady } from "./feedback";

export type PickMap = Record<string, number>;                 // uid → 표수
export type PickIndex = Record<string, PickMap>;              // 정규화 검색어 → PickMap

// 힌트 학습 — "쉐이록라"에서 이름(쉐이)을 뺀 조각 "록라"가 통합전략을 뜻한다는 걸 배운다.
// 같은 저장소를 쓰되 검색어 키에 "~"를 붙여(`~록라`) 일반 검색어와 섞이지 않게 한다.
const HINT_PREFIX = "~";
const HINT_UID = "hint:";
const HINT_MIN = 2;      // 이 표수 이상 모인 조각만 힌트로 쓴다 (내 선택 1회 = 2표라 즉시 성립)

const LS_KEY = "ta-omni-picks";
const SESSION_KEY = "ta-omni-session";   // 익명 랜덤 id — 표 중복 제거용(개인 식별 아님)
const MAX_QUERIES = 150;      // 로컬 보관 검색어 수 (오래된 것부터 버린다)
const MINE_WEIGHT = 2;        // 내 선택 = 내 기기에서 2표 상당 (남의 화면엔 영향 없음)
export const PICK_BONUS_MAX = 45;

/** 브라우저별 익명 id — 같은 사람의 반복 클릭을 서버 집계에서 1표로 접기 위한 것뿐이다. */
function sessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto?.randomUUID?.() ?? `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "anon";   // 프라이빗 모드 — 서버에선 행 id로 대체 집계된다
  }
}

type LocalEntry = { at: number; p: PickMap };
type LocalStore = Record<string, LocalEntry>;

function readLocal(): LocalStore {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LocalStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

function writeLocal(store: LocalStore) {
  try {
    const keys = Object.keys(store);
    if (keys.length > MAX_QUERIES) {
      keys.sort((a, b) => (store[a].at ?? 0) - (store[b].at ?? 0));
      for (const key of keys.slice(0, keys.length - MAX_QUERIES)) delete store[key];
    }
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch { /* 사파리 프라이빗 모드 등 — 학습만 안 되고 검색은 정상 */ }
}

/** 내 선택 기록 (localStorage). 검색어는 정규화된 문자열. */
export function myPicks(): PickIndex {
  const store = readLocal();
  const out: PickIndex = {};
  for (const [q, entry] of Object.entries(store)) out[q] = entry.p ?? {};
  return out;
}

/** 후보가 둘 이상이었을 때의 클릭만 기록한다 (단일 결과는 학습 가치가 없다). */
export function recordPick(q: string, uid: string, meta: {
  kind: string; name: string; locale: string;
  rank?: number; candidates?: number; fuzzy?: boolean; hinted?: boolean;
}): void {
  if (!q || q.length > 40) return;
  const store = readLocal();
  const entry = store[q] ?? { at: 0, p: {} };
  entry.p[uid] = (entry.p[uid] ?? 0) + 1;
  entry.at = Date.now();
  store[q] = entry;
  writeLocal(store);
  // 서버 집계는 실패해도 무시 — 내 선택만으로도 다음 검색은 정확해진다
  if (!feedbackReady || tableMissing) return;
  void fetch(`${SUPABASE_URL}/rest/v1/omni_pick`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      q, uid, kind: meta.kind, name: meta.name.slice(0, 80), locale: meta.locale,
      session: sessionId(),
      rank: meta.rank ?? null, candidates: meta.candidates ?? null,
      fuzzy: meta.fuzzy ?? null, hinted: meta.hinted ?? null,
    }),
    keepalive: true,   // 클릭 직후 페이지가 바뀌어도 전송이 끊기지 않게
  }).catch(() => { /* 테이블 미설치·오프라인 */ });
}

// 세션 1회만 받아 온다 (검색 패널을 처음 열 때)
let crowdPromise: Promise<PickIndex> | null = null;
// 테이블 미설치(404)를 확인했으면 그 뒤 전송을 아예 하지 않는다 — 콘솔 404 잡음·헛트래픽 방지
let tableMissing = false;
export function fetchCrowdPicks(): Promise<PickIndex> {
  if (!crowdPromise) {
    crowdPromise = fetch(`${SUPABASE_URL}/rest/v1/omni_pick_counts?select=q,uid,voters&order=voters.desc&limit=4000`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    })
      .then((res) => {
        if (res.status === 404) tableMissing = true;   // docs/supabase-omni-picks.sql 미실행
        return res.ok ? res.json() : [];
      })
      .then((rows: { q: string; uid: string; voters: number }[]) => {
        const index: PickIndex = {};
        for (const row of rows ?? []) {
          if (!row?.q || !row?.uid) continue;
          // 가중치는 **사람 수**로 센다 (한 사람의 반복 클릭은 서버 뷰에서 이미 1표로 접혔다)
          (index[row.q] = index[row.q] ?? {})[row.uid] = row.voters;
        }
        return index;
      })
      .catch(() => ({}));
  }
  return crowdPromise;
}

/** 검색어에서 이름을 뺀 조각 → 종류를 기록한다 ("쉐이록라"에서 쉐이 테마를 고르면 록라=통합전략). */
export function recordHint(token: string, kind: string): void {
  if (token.length < 2 || token.length > 6) return;
  recordPick(HINT_PREFIX + token, HINT_UID + kind, { kind: "hint", name: token, locale: "-" });
}

/** 내가 이 항목을 고른 적 있는지 — '자주 선택' 배지에서 내 선택과 군중 합의를 구분하려면 필요. */
export const pickedByMe = (q: string, uid: string, mine: PickIndex): boolean => (mine[q]?.[uid] ?? 0) > 0;

/** 학습된 은어 사전 (토큰 → 종류들). 내 선택은 가중 3이라 한 번만 골라도 바로 성립한다. */
export function learnedHints(mine: PickIndex, crowd: PickIndex): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const scan = (index: PickIndex, weight: number) => {
    for (const [key, map] of Object.entries(index)) {
      if (!key.startsWith(HINT_PREFIX)) continue;
      const token = key.slice(HINT_PREFIX.length);
      for (const [uid, n] of Object.entries(map)) {
        if (!uid.startsWith(HINT_UID) || n * weight < HINT_MIN) continue;
        const kind = uid.slice(HINT_UID.length);
        const list = out[token] ?? (out[token] = []);
        if (!list.includes(kind)) list.push(kind);
      }
    }
  };
  scan(crowd, 1);
  scan(mine, MINE_WEIGHT);
  return out;
}

/** 이 검색어의 최종 가중 = 사람들의 표수(voters) + (내가 고른 적 있으면 MINE_WEIGHT).
 *  내 클릭 횟수에 비례시키지 않는다 — 나는 어디까지나 한 명이다. */
export function picksFor(q: string, mine: PickIndex, crowd: PickIndex): PickMap | undefined {
  const my = mine[q];
  const theirs = crowd[q];
  if (!my && !theirs) return undefined;
  const merged: PickMap = {};
  for (const [uid, voters] of Object.entries(theirs ?? {})) merged[uid] = voters;
  for (const [uid, n] of Object.entries(my ?? {})) if (n > 0) merged[uid] = (merged[uid] ?? 0) + MINE_WEIGHT;
  return merged;
}
