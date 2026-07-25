"use client";

// 만능검색 학습 — 되묻기("이 중에 무엇인가요?")에서 사람들이 무엇을 골랐는지 기억해
// 같은 검색어의 정확도를 올린다 (사용자 요청 2026-07-25). 두 층으로 쌓인다:
//
//   ① 내 선택 — localStorage(`ta-omni-picks`), 가중 3. **한 번만 골라도** 다음 검색에선
//      바로 이동한다 (보너스 36 > decideOmni의 확신 문턱 30).
//   ② 사람들의 선택 — Supabase `omni_pick` 1행 = 1클릭, 공개는 2표 이상 집계 뷰
//      (`omni_pick_counts`)만. 가중 1이라 2표부터 확신 문턱을 넘는다.
//
// 테이블이 아직 없거나(설치 전 404) 네트워크가 죽어도 ①만으로 정상 동작한다.
// 설치 SQL: docs/supabase-omni-picks.sql · 스팸은 /admin과 같은 x-admin-key로 삭제.
//
// 저장하는 건 정규화된 검색어와 고른 항목 id뿐이다 (개인정보·입력 이력 아님).

import { SUPABASE_ANON_KEY, SUPABASE_URL, feedbackReady } from "./feedback";

export type PickMap = Record<string, number>;                 // uid → 표수
export type PickIndex = Record<string, PickMap>;              // 정규화 검색어 → PickMap

const LS_KEY = "ta-omni-picks";
const MAX_QUERIES = 150;      // 로컬 보관 검색어 수 (오래된 것부터 버린다)
const MINE_WEIGHT = 3;        // 내 선택 1회 = 사람들 3표만큼
export const PICK_BONUS_MAX = 45;

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
export function recordPick(q: string, uid: string, meta: { kind: string; name: string; locale: string }): void {
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
    body: JSON.stringify({ q, uid, kind: meta.kind, name: meta.name.slice(0, 80), locale: meta.locale }),
    keepalive: true,   // 클릭 직후 페이지가 바뀌어도 전송이 끊기지 않게
  }).catch(() => { /* 테이블 미설치·오프라인 */ });
}

// 세션 1회만 받아 온다 (검색 패널을 처음 열 때)
let crowdPromise: Promise<PickIndex> | null = null;
// 테이블 미설치(404)를 확인했으면 그 뒤 전송을 아예 하지 않는다 — 콘솔 404 잡음·헛트래픽 방지
let tableMissing = false;
export function fetchCrowdPicks(): Promise<PickIndex> {
  if (!crowdPromise) {
    crowdPromise = fetch(`${SUPABASE_URL}/rest/v1/omni_pick_counts?select=q,uid,picks&order=picks.desc&limit=4000`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    })
      .then((res) => {
        if (res.status === 404) tableMissing = true;   // docs/supabase-omni-picks.sql 미실행
        return res.ok ? res.json() : [];
      })
      .then((rows: { q: string; uid: string; picks: number }[]) => {
        const index: PickIndex = {};
        for (const row of rows ?? []) {
          if (!row?.q || !row?.uid) continue;
          (index[row.q] = index[row.q] ?? {})[row.uid] = row.picks;
        }
        return index;
      })
      .catch(() => ({}));
  }
  return crowdPromise;
}

/** 이 검색어에 대한 (내 선택×3 + 사람들 표) 합산 — searchOmni에 넘기는 가중치. */
export function picksFor(q: string, mine: PickIndex, crowd: PickIndex): PickMap | undefined {
  const a = mine[q];
  const b = crowd[q];
  if (!a && !b) return undefined;
  const merged: PickMap = {};
  for (const [uid, n] of Object.entries(b ?? {})) merged[uid] = n;
  for (const [uid, n] of Object.entries(a ?? {})) merged[uid] = (merged[uid] ?? 0) + n * MINE_WEIGHT;
  return merged;
}
