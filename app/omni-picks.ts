"use client";

// 유니버셜 서치 학습 — **가중치는 전부 DB(Supabase)에 쌓인다** (사용자 확정 2026-07-25:
// "모두가 검색해서 빅데이터를 쌓아야 하기 때문에 기본적으로 디비에 가중치가 쌓여야 해").
// 브라우저에는 학습 데이터를 보관하지 않는다 — localStorage에 두는 건 익명 세션 id 하나뿐이고,
// 그건 "한 사람이 100번 눌러도 1표"를 만들기 위한 중복 제거용이다.
//
// 쌓는 신호 (전부 `omni_pick` 한 표에 source로 구분해 들어간다)
//   · pick  — 되묻기에서 직접 고른 항목                        (표 1.0)
//   · miss  — 결과가 0건이었던 검색어 자체                     (그 자체로는 가중치 아님)
//   · visit — 컨텐츠에 도착 (app/trail.ts) — 같은 세션의 직전 miss와 **DB에서 짝지어져**
//             "실패한 검색 → 최종 목적지" 가중치가 된다 (표 0.5, omni_trail_counts 뷰)
//   · 은어 힌트("록라"=통합전략)는 q가 `~록라`, uid가 `hint:<종류>`인 pick 행.
//
// 읽기: 공개 집계 뷰 `omni_weights(q, uid, voters, trail_voters)`를 세션 1회 받아 메모리에 둔다
// (직접 클릭 집계 + DB가 짝지은 실패→도착 집계를 합쳐 놓은 뷰). 내가 방금 누른 표는 서버 왕복 없이 그 메모리 지도에 낙관적으로 얹어 같은
// 세션에서 즉시 반영되고, 다음 접속 땐 DB에서 그대로 돌아온다.
//
// 가중 = voters + 0.5×trail_voters  ·  보너스 = min(45, 18+9·log2(1+가중))
//   1표 → 27점: 1순위로 올라오지만 되묻기는 유지 (확신 문턱 30 미만)
//   2표 → 32점: 되묻지 않고 바로 이동 — **서로 다른 두 사람이 합의하면 확정**
//
// 설치 SQL: docs/supabase-omni-picks.sql (없으면 404 한 번 확인 후 전송을 끊는다).

import { SUPABASE_ANON_KEY, SUPABASE_URL, feedbackReady } from "./feedback";

export type PickMap = Record<string, number>;                 // uid → 가중(표)
export type PickIndex = Record<string, PickMap>;              // 정규화 검색어 → PickMap

const SESSION_KEY = "ta-omni-session";   // 익명 랜덤 id — 표 중복 제거용(개인 식별 아님)
const TRAIL_WEIGHT = 0.5;                // 추론(trail) 표는 직접 클릭의 절반
export const PICK_BONUS_MAX = 45;

// 힌트 학습 — "쉐이록라"에서 이름(쉐이)을 뺀 조각 "록라"가 통합전략을 뜻한다는 걸 배운다.
// 같은 표를 쓰되 검색어 키에 "~"를 붙여(`~록라`) 일반 검색어와 섞이지 않게 한다.
const HINT_PREFIX = "~";
const HINT_UID = "hint:";
const HINT_MIN = 1;      // 이 표수 이상 모인 조각만 힌트로 쓴다

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

// 세션 1회만 받아 온다 (검색 패널을 처음 열 때). 낙관적 갱신도 이 지도에 얹는다.
let crowdPromise: Promise<PickIndex> | null = null;
const crowdIndex: PickIndex = {};
// 테이블 미설치(404)를 확인했으면 그 뒤 전송을 아예 하지 않는다 — 콘솔 404 잡음·헛트래픽 방지
let tableMissing = false;

type Source = "pick" | "miss" | "visit";

function send(row: Record<string, unknown>): void {
  if (!feedbackReady || tableMissing) return;
  void fetch(`${SUPABASE_URL}/rest/v1/omni_pick`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ ...row, session: sessionId() }),
    keepalive: true,   // 클릭 직후 페이지가 바뀌어도 전송이 끊기지 않게
  }).catch(() => { /* 테이블 미설치·오프라인 */ });
}

/** 메모리 집계에 내 표를 즉시 얹는다 (다음 접속엔 DB에서 같은 값이 돌아온다).
 *  실패→도착 추론은 DB가 짝지으므로 여기서 미리 얹지 않는다 — 다음 접속부터 반영된다. */
function bump(q: string, uid: string, weight: number): void {
  const map = crowdIndex[q] ?? (crowdIndex[q] = {});
  map[uid] = (map[uid] ?? 0) + weight;
}

/** 되묻기에서 직접 고른 항목 — 후보가 둘 이상이었을 때만 기록한다. */
export function recordPick(q: string, uid: string, meta: {
  kind: string; name: string; locale: string;
  rank?: number; candidates?: number; fuzzy?: boolean; hinted?: boolean;
  source?: Source;
}): void {
  if (!q || q.length > 41) return;
  const source: Source = meta.source ?? "pick";
  bump(q, uid, 1);
  send({
    q, uid, kind: meta.kind, name: meta.name.slice(0, 80), locale: meta.locale,
    rank: meta.rank ?? null, candidates: meta.candidates ?? null,
    fuzzy: meta.fuzzy ?? null, hinted: meta.hinted ?? null,
    source,
  });
}

/** 컨텐츠 도착 — app/trail.ts가 부른다. 짝짓기(직전 miss와 연결)는 **DB 뷰가** 한다. */
export function recordVisit(uid: string, meta: { kind: string; name: string; locale: string }): void {
  send({ q: "-", uid, kind: meta.kind, name: meta.name.slice(0, 80), locale: meta.locale, source: "visit" });
}

/** 결과가 0건이었던 검색어 자체 — 가중치가 아니라 **무엇을 못 찾는지** 모으는 통계다
 *  (omni_miss_top 뷰로 자주 실패하는 말을 확인해 별칭·힌트 사전에 반영한다). */
export function recordMiss(q: string, locale: string): void {
  if (!q || q.length < 2 || q.length > 41) return;
  send({ q, uid: "-", kind: "miss", name: null, locale, source: "miss" });
}

/** 검색어에서 이름을 뺀 조각 → 종류 ("쉐이록라"에서 쉐이 테마를 고르면 록라=통합전략). */
export function recordHint(token: string, kind: string): void {
  if (token.length < 2 || token.length > 6) return;
  recordPick(HINT_PREFIX + token, HINT_UID + kind, { kind: "hint", name: token, locale: "-" });
}

export function fetchCrowdPicks(): Promise<PickIndex> {
  if (!crowdPromise) {
    crowdPromise = fetch(`${SUPABASE_URL}/rest/v1/omni_weights?select=q,uid,voters,trail_voters&order=voters.desc&limit=6000`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    })
      .then((res) => {
        if (res.status === 404) tableMissing = true;   // docs/supabase-omni-picks.sql 미실행
        return res.ok ? res.json() : [];
      })
      .then((rows: { q: string; uid: string; voters: number; trail_voters?: number }[]) => {
        for (const row of rows ?? []) {
          if (!row?.q || !row?.uid) continue;
          // 가중치는 **사람 수**로 센다 (같은 사람의 반복 클릭은 뷰에서 이미 1표로 접혔다)
          const weight = (row.voters ?? 0) + TRAIL_WEIGHT * (row.trail_voters ?? 0);
          const map = crowdIndex[row.q] ?? (crowdIndex[row.q] = {});
          map[row.uid] = Math.max(map[row.uid] ?? 0, weight);   // 낙관적으로 얹어둔 내 표 보존
        }
        return crowdIndex;
      })
      .catch(() => crowdIndex);
  }
  return crowdPromise;
}

/** 지금까지 아는 전역 집계 (서버 응답 + 이번 세션에 내가 만든 표). */
export const crowdPicks = (): PickIndex => crowdIndex;

/** 학습된 은어 사전 (토큰 → 종류들) — 전역 집계에서 뽑는다. */
export function learnedHints(crowd: PickIndex): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, map] of Object.entries(crowd)) {
    if (!key.startsWith(HINT_PREFIX)) continue;
    const token = key.slice(HINT_PREFIX.length);
    for (const [uid, weight] of Object.entries(map)) {
      if (!uid.startsWith(HINT_UID) || weight < HINT_MIN) continue;
      const kind = uid.slice(HINT_UID.length);
      const list = out[token] ?? (out[token] = []);
      if (!list.includes(kind)) list.push(kind);
    }
  }
  return out;
}

/** 이 검색어의 가중치 지도 (없으면 undefined).
 *  정확 키에 더해 **접두 관계** 키도 합친다 (사용자 요청 2026-07-26: "금뵝어"→하루카를
 *  배웠으면 "금뵝"까지만 쳐도 나와야 한다). 접두 확장은 0.7배로 접어 정확 키가 우선하고,
 *  한 글자 키/검색어는 확장하지 않는다 (저엔트로피 오염 방지). */
export function picksFor(q: string, crowd: PickIndex): PickMap | undefined {
  if (!q) return undefined;
  const out: PickMap = {};
  const add = (map: PickMap, scale: number) => {
    for (const [uid, w] of Object.entries(map)) {
      const v = w * scale;
      if (v > (out[uid] ?? 0)) out[uid] = v;
    }
  };
  const exact = crowd[q];
  if (exact) add(exact, 1);
  if (q.length >= 2) {
    for (const [key, map] of Object.entries(crowd)) {
      if (key === q || key.startsWith(HINT_PREFIX)) continue;
      if (key.startsWith(q) || (key.length >= 2 && q.startsWith(key))) add(map, 0.7);
    }
  }
  return Object.keys(out).length ? out : undefined;
}
