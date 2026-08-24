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
// 같은 session의 miss 뒤 10분 안의 visit들을 SQL 뷰(omni_trail_counts)가 짝지어
// 가중치로 만든다. 그래서 이 파일에는 학습 데이터도, 저장소도 없다.
//
// 여기 두는 건 "최근에 못 찾은 게 있나" 플래그뿐이다 — 그게 있을 때만 visit을 보내
// 모든 방문을 서버로 밀어 올리지 않는다.
//
// ⚠ 이 플래그는 **sessionStorage**에 둔다 (2026-08-24). 종전엔 모듈 변수였는데, 상세의
//   정본 주소가 경로(/operators/<id>·/stories/<id>)로 바뀐 뒤(2026-08-06)로 목적지에
//   도착하는 길이 곧 **새 문서 로드**가 되면서 플래그가 매번 날아갔다 — 검색에 실패하고
//   목적지를 찾아가도 visit이 한 번도 안 나가, 실패→도착 학습이 사실상 멈춰 있었다
//   (사용자 제보 2026-08-24: "울버지 검색 후 울피아누스를 열어도 다음에 또 안 나온다").
//   탭을 닫으면 같이 사라지므로 "임시 상태"라는 성격은 그대로다.
import { recordMiss, recordVisit } from "./omni-picks";

const WINDOW_MS = 10 * 60_000;   // DB 뷰의 짝짓기 창(10분)과 같게 유지할 것
const KEY = "ta-omni-miss";

/** at·q = 마지막 실패 검색, sent = 이미 DB에 보낸 검색어들(보낸 시각) */
type Trail = { at: number; q: string; sent: Record<string, number> };
let mem: Trail = { at: 0, q: "", sent: {} };     // 프라이빗 모드 폴백

function read(): Trail {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Trail>) : null;
    if (parsed && typeof parsed.at === "number") {
      return { at: parsed.at, q: parsed.q ?? "", sent: parsed.sent ?? {} };
    }
  } catch { /* 프라이빗 모드·손상된 값 — 메모리로만 */ }
  return mem;
}

function write(trail: Trail): void {
  mem = trail;
  try { sessionStorage.setItem(KEY, JSON.stringify(trail)); } catch { /* ignore */ }
}

/** 결과가 0건이었던 검색어 — DB에 남기고, 잠시 visit 보고를 켠다. */
export function noteMiss(q: string, locale = "ko"): void {
  if (!q || q.length < 2 || q.length > 40) return;
  const now = Date.now();
  const prev = read();
  // 같은 검색어를 짝짓기 창 안에서 두 번 보내지 않는다. 창을 넘겼으면 **다시 보낸다** —
  // 서버는 miss 행의 시각을 기준으로 짝짓기 때문에, 오래된 행 하나로는 새 도착이 안 이어진다.
  const sent: Record<string, number> = {};
  for (const [key, at] of Object.entries(prev.sent)) if (now - at < WINDOW_MS) sent[key] = at;
  const dup = sent[q] != null;
  if (!dup) sent[q] = now;
  write({ at: now, q, sent });
  if (!dup) recordMiss(q, locale);
}

/** 최근(10분)의 실패 검색어 — 검색 패널이 "실패 후 재검색해 고른" 선택을 즉시 연결하는 데 쓴다
 *  (사용자 제보 2026-07-26: '보텀' 실패 → '트라고디아'로 재검색해 클릭해도 학습이 안 됐다). */
export function recentMissQ(): string | null {
  const trail = read();
  return trail.at && Date.now() - trail.at <= WINDOW_MS ? (trail.q || null) : null;
}

/** 실패 검색을 선택에 연결해 소진 — 다음 클릭에 또 붙지 않게. */
export function consumeMiss(): void { write({ ...read(), at: 0, q: "" }); }

/** 실제 컨텐츠 도착 — 최근에 못 찾은 검색이 있을 때만 보고한다.
 *  uid는 유니버셜 서치 색인과 같은 형식(op:char_… / story:… / mat:… / rg:토픽:섹션:id). */
export function noteArrival(uid: string, meta: { kind: string; name: string; locale: string }): void {
  const trail = read();
  if (!trail.at || Date.now() - trail.at > WINDOW_MS) return;
  // 실패한 검색어를 함께 넘긴다 — DB가 낼 짝짓기 결과를 같은 세션에 미리 반영하기 위한 것
  recordVisit(uid, { ...meta, missQ: trail.q || undefined });
}

/** 탭 이동·새 검색어 등 — 지금은 DB 쪽 시간 창이 판정하므로 아무 상태도 두지 않는다. */
export function noteAction(): void { /* 호환용 (시간 창 기반으로 바뀌며 비었다) */ }
