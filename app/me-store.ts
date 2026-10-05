// '내 정보' — 게임 로그인으로 받은 내 계정 데이터를 사이트 전체가 함께 쓴다 (2026-10-04).
// 오퍼 도감(보유·육성 현황)·인프라(보유 오퍼)·아이템 도감(창고 수량)·공개채용(미보유·잠재)이 여기서 읽는다.
//
// 저장: 이 브라우저의 localStorage 하나뿐. 서버로 보내지 않는다.
// ⚠ 토큰(재동기화 권한)은 **저장하지 않는다** — account.ts 규약 그대로 모듈 메모리에만 두고,
//   탭을 닫으면 사라진다. 저장되는 건 화면에 그릴 계정 요약뿐이다.

import { useSyncExternalStore } from "react";
import { noteVisitEvent } from "./visit-track";
import type { AccountChar, AccountPlayer, AccountProfile, AccountRoster, AccountServer, AccountToken } from "./account";

const KEY = "ta:me";
const EVENT = "ta:me-change";

export type MeData = {
  v: 1;
  server: AccountServer;
  /** 동기화 시각 (ms) — 인프라가 '이 데이터를 이미 반영했는가' 판정에 쓴다 */
  syncedAt: number;
  player: AccountPlayer;
  chars: AccountChar[];
  profile: AccountProfile | null;
};

// 다시 동기화용 요스타 토큰 — 계정 데이터(ta:me)와 따로 둔다. 종전엔 탭 메모리에만 둬서 새로고침하면
// 인증코드부터 다시 받아야 했다 → 토큰이 살아 있는 한 새로고침해도 다시 동기화되게 (사용자 요청 2026-10-05).
// 만료되면 워커가 token-expired 를 돌려주고, 그때 지운다. '데이터 지우기'도 함께 지운다.
const TOKEN_KEY = "ta:me-token";
type MeToken = { server: AccountServer; token: AccountToken };
let token: MeToken | null | undefined;
/** 인증코드 없이 다시 동기화할 수 있는 토큰 — 없으면 null */
export function meToken(): MeToken | null {
  if (token !== undefined) return token;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TOKEN_KEY) ?? "null") as MeToken | null;
    token = parsed?.token?.uid && parsed.token.token && parsed.token.deviceId ? parsed : null;
  } catch { token = null; }
  return token;
}
function setToken(next: MeToken | null) {
  token = next;
  try {
    if (next) window.localStorage.setItem(TOKEN_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* 저장 못 하면 이 탭에서만 쓴다 */ }
}
/** 토큰이 만료됐을 때 — 다음엔 로그인 창으로 보낸다 */
export const dropMeToken = () => setToken(null);

let cachedRaw: string | null | undefined;
let cached: MeData | null = null;

function read(): MeData | null {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(KEY); } catch { raw = null; }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) as MeData : null;
    cached = parsed && parsed.v === 1 && Array.isArray(parsed.chars) ? parsed : null;
  } catch { cached = null; }
  return cached;
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, cb);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(EVENT, cb); };
}

/** 내 계정 데이터 — 없으면 null. 서버 렌더·첫 하이드레이션에선 항상 null 이다. */
export function useMe(): MeData | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function getMe(): MeData | null {
  return typeof window === "undefined" ? null : read();
}

/** 게임 로그인 결과를 저장한다 — 인프라 '가져오기'로 로그인해도 같은 곳에 쌓인다. */
export function saveMe(roster: AccountRoster, server: AccountServer, kind: "me_login" | "me_sync" = "me_login") {
  noteVisitEvent(kind, server);   // 방문 통계 — 누가(익명 id) 몇 번 동기화했는지
  if (roster.token) setToken({ server, token: roster.token });
  const data: MeData = {
    v: 1, server, syncedAt: Date.now(), player: roster.player, chars: roster.chars, profile: roster.profile ?? null,
  };
  try { window.localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 저장 못 해도 이번 화면은 그린다 */ }
  cachedRaw = undefined;
  window.dispatchEvent(new Event(EVENT));
}

export function clearMe() {
  setToken(null);
  try { window.localStorage.removeItem(KEY); } catch { /* 무시 */ }
  cachedRaw = undefined;
  window.dispatchEvent(new Event(EVENT));
}

const charMaps = new WeakMap<MeData, Map<string, AccountChar>>();
/** 오퍼 id → 내 오퍼 */
export function meChars(me: MeData | null): Map<string, AccountChar> | null {
  if (!me) return null;
  let map = charMaps.get(me);
  if (!map) { map = new Map(me.chars.map((c) => [c.id, c])); charMaps.set(me, map); }
  return map;
}

/** 성급별 만렙 (정예화 단계별) — character_table maxLevel 과 같다 */
export const MAX_LEVEL: Record<number, number[]> = {
  1: [30], 2: [30], 3: [40, 55], 4: [45, 60, 70], 5: [50, 70, 80], 6: [50, 80, 90],
};
export const maxEliteOf = (rarity: number) => (MAX_LEVEL[rarity]?.length ?? 1) - 1;
/** 그 성급에서 끝까지 키웠는가 (최종 정예화 + 만렙) */
export function isMaxed(c: AccountChar, rarity: number): boolean {
  const caps = MAX_LEVEL[rarity];
  if (!caps) return false;
  return c.elite === caps.length - 1 && c.level >= caps[caps.length - 1];
}
// favor_table.favorFrames — 70% 까지는 구간이 들쭉날쭉하고, 그 뒤로는 1% 마다 155 포인트(200% = 25,570)
const FAVOR_HEAD = [0, 8, 16, 28, 40, 56, 72, 92, 112, 137, 162, 192, 222, 255, 288, 325, 362, 404, 446, 491, 536, 586, 636, 691, 746, 804, 862, 924, 986, 1052, 1118, 1184, 1250, 1316, 1382, 1457, 1532, 1607, 1682, 1757, 1832, 1917, 2002, 2087, 2172, 2257, 2352, 2447, 2542, 2637, 2732, 2840, 2960, 3080, 3200, 3320, 3450, 3580, 3710, 3840, 3970, 4110, 4250, 4390, 4530, 4670, 4820, 4970, 5120, 5270, 5420];
/** 신뢰도 포인트 → % (게임 표기, 최대 200%) */
export function trustPct(point: number): number {
  const last = FAVOR_HEAD.length - 1;
  if (point >= FAVOR_HEAD[last]) return Math.min(200, last + Math.floor((point - FAVOR_HEAD[last]) / 155));
  let pct = 0;
  while (pct < last && FAVOR_HEAD[pct + 1] <= point) pct += 1;
  return pct;
}

// ── 육성 상태 표기 — 커뮤니티 말투 그대로 (사용자 지시 2026-10-04 "e2 90 p6 뭔말인지 모르겠음") ──
// 한국어: 노정예/1정/2정 + 레벨 · 잠재는 명함(잠재 1)·2잠~5잠·풀잠(잠재 6) — 게임 정식 단계 그대로 (사용자 정정 2026-10-05,
//   종전 '1잠~4잠'은 한 칸씩 밀려 있었다) · 특화는 N마 (사용자 지시: N특 아님).
// 영어·일본어는 그 언어권에서 흔히 쓰는 표기 (E2 90 · P6 · M3 / 昇進2 90 · 潜在6 · 特化3).
export function eliteText(locale: string, elite: number, level: number): string {
  if (locale === "en") return `E${elite} ${level}`;
  if (locale === "ja") return `昇進${elite} ${level}`;
  return `${elite === 0 ? "노정예" : `${elite}정`} ${level}`;
}
export function potText(locale: string, potential: number): string {
  if (locale === "en") return `P${potential}`;
  if (locale === "ja") return `潜在${potential}`;
  return potential >= 6 ? "풀잠" : potential <= 1 ? "명함" : `${potential}잠`;
}
export function masteryText(locale: string, m: number): string {
  if (locale === "en") return `M${m}`;
  if (locale === "ja") return `特化${m}`;
  return `${m}마`;
}

// 보유 수에 세지 않는 오퍼 — 게임 오퍼 목록에 들어가지 않는 임시 인원 15명 (사용자 지적 2026-10-04: "한섭 최대 보유는 410").
// 예비 인원 5 · 예비 오퍼레이터 5 · 생존연산/통합전략 전용 지원 인원 5(샤프·피스·터치·스톰아이·튤립).
const NOT_COLLECTIBLE = new Set([
  "char_504_rguard", "char_505_rcast", "char_506_rmedic", "char_507_rsnipe", "char_514_rdfend",
  "char_600_cpione", "char_601_cguard", "char_605_cmedic", "char_606_csuppo", "char_607_cspec",
  "char_508_aguard", "char_509_acast", "char_510_amedic", "char_511_asnipe", "char_513_apionr",
]);
/** 계정 오퍼 목록에 들어가는(=모을 수 있는) 오퍼인가 */
export const isCollectible = (id: string) => !NOT_COLLECTIBLE.has(id);

// ── 통합전략 진행 — '내 정보' 계정 데이터의 테마별 수집 기록 (2026-10-05) ──
// 워커가 테마마다 갈래(엔딩 도서·방문객 기록·소장품 …)별 '얻은 id'를 보내는데, 갈래 이름이 공개 자료로 확정되지 않아
// 갈래를 가리지 않고 한데 모아 사이트의 id(엔딩 ro_ending_N · 해금 스토리 endbook_… · 방문객 장면 month_chat/record_…)와 맞춘다.
export type RogueProgress = { has: (id: string) => boolean; scene: (id: string, floor?: number) => boolean; ending: (id: string) => boolean };
const rogueCache = new WeakMap<MeData, Map<string, RogueProgress | null>>();
export function rogueProgress(me: MeData | null, topic: string): RogueProgress | null {
  const raw = me?.profile?.rogue?.[topic];
  if (!me || !raw) return null;
  let byTopic = rogueCache.get(me);
  if (!byTopic) { byTopic = new Map(); rogueCache.set(me, byTopic); }
  if (byTopic.has(topic)) return byTopic.get(topic)!;
  const got = new Set(Object.values(raw.collect ?? {}).flat());
  const record = raw.record ? JSON.stringify(raw.record) : "";
  // 방문객 장면은 팀 단위로 온다 — chatV2 = { month_chat_rogue_N_팀: [본 장면의 층 zone id…] }.
  // 장면 id(…_팀_순번)의 팀 번호와 그 장면의 층(zone_<층>)으로 잇는다 — 순번째 장면의 층이 chatItemList 의
  // chatZoneId 와 같다는 걸 rogue_1~5 120장면 전부 대조했다 (2026-10-05).
  const seen = new Set<string>();
  for (const [team, zones] of Object.entries(raw.chat?.chatV2 ?? {})) {
    const n = /_(\d+)$/.exec(team)?.[1];
    if (!n || !Array.isArray(zones)) continue;
    for (const zone of zones) seen.add(`${n}:${zone}`);
  }
  const scene = (id: string, floor?: number) => {
    const team = /_(\d+)_\d+$/.exec(id)?.[1];
    return got.has(id) || (!!team && floor !== undefined && seen.has(`${team}:zone_${floor}`));
  };
  const prog: RogueProgress = {
    has: (id) => got.has(id),
    scene,
    // 엔딩은 달성 기록(record) 안에 엔딩 id 가 키나 값으로 들어 있으면 달성으로 본다
    ending: (id) => got.has(id) || record.includes(`"${id}"`),
  };
  byTopic.set(topic, prog);
  return prog;
}

/** 재화 묶음 — 내 정보 '재화' 카드의 칸 줄(용문폐·합성옥·순오리지늄 / 허가증 / 증명서)과 이미지 내보내기의 '재화' 칸이 같이 쓴다 */
export const WALLET_ROWS = [["4001", "4003", "4002"], ["7003", "7004", "7001", "7002"], ["4004", "4005", "4006", "classic_normal_ticket"]];
