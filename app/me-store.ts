// '내 정보' — 게임 로그인으로 받은 내 계정 데이터를 사이트 전체가 함께 쓴다 (2026-10-04).
// 오퍼 도감(보유·육성 현황)·인프라(보유 오퍼)·아이템 도감(창고 수량)·공개채용(미보유·잠재)이 여기서 읽는다.
//
// 저장: 이 브라우저의 localStorage 하나뿐. 서버로 보내지 않는다.
// ⚠ 토큰(재동기화 권한)은 **저장하지 않는다** — account.ts 규약 그대로 모듈 메모리에만 두고,
//   탭을 닫으면 사라진다. 저장되는 건 화면에 그릴 계정 요약뿐이다.

import { useSyncExternalStore } from "react";
import { noteVisitEvent } from "./visit-track";
import type { AccountChar, AccountPlayer, AccountProfile, AccountRoster, AccountServer, AccountToken, MatchSigned } from "./account";

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
  /** 친구 매칭 등록용 서명된 내 정보 (워커가 동기화 때 만든다, 2026-10-20~). 옛 저장분엔 없다 */
  match?: MatchSigned | null;
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
// 사이트 설정 동기화용 표 (app/cloud-prefs.ts) — 게임 토큰과 달리 만료가 없다(UID 는 평생 같다). '데이터 지우기'만 지운다
const PREF_KEY = "ta:me-pref";
export const PREF_EVENT = "ta:me-pref";
export function mePrefToken(): string | null {
  try { return window.localStorage.getItem(PREF_KEY) || null; } catch { return null; }
}
function setPrefToken(next: string | null) {
  try {
    const prev = window.localStorage.getItem(PREF_KEY);
    if (next) window.localStorage.setItem(PREF_KEY, next); else window.localStorage.removeItem(PREF_KEY);
    if (prev !== next) window.dispatchEvent(new Event(PREF_EVENT));
  } catch { /* 무시 */ }
}
/** 토큰이 만료됐을 때 — 다음엔 로그인 창으로 보낸다 */
export const dropMeToken = () => setToken(null);

/** 내 정보 보관 기한 — 마지막 동기화 뒤 90일 (사용자 지시 2026-10-20) */
export const ME_EXPIRE_MS = 90 * 86400_000;
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
  // 90일 넘게 동기화하지 않은 내 정보는 이 브라우저에서도 지운다 — 서버의 사이트 설정·친구 찾기 등록도 같은 기준으로 지워진다
  // (계정 워커 matchSweep, 사용자 지시 2026-10-20). 읽는 중엔 지우지 않고 다음 틱에 로그아웃과 같은 길(clearMe)로
  if (cached && Date.now() - (cached.syncedAt || 0) > ME_EXPIRE_MS) {
    cached = null;
    setTimeout(() => clearMe(), 0);
  }
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

// ── 여러 계정 (사용자 지시 2026-10-24 제안 be87b8c8 "한섭이랑 중섭을 같이") ──────────────────────────────────
// 지금 쓰는 계정은 종전 그대로 ta:me·ta:me-token·ta:me-pref 와 각 기능의 설정 키에 있다 — 사이트 전체가 그걸 읽으니 화면 코드는 그대로다.
// 다른 계정은 ta:me-accounts 에 통째로(게임 데이터·다시 동기화 토큰·설정용 표·설정 키 값) 넣어 두고, 바꿀 때 서로 맞바꾼 뒤 새로 연다.
// 설정은 계정마다 따로 — 계정을 바꾸면 그 계정의 설정으로 (사용자 지시: "각각 계정별로 설정 저장하고, 계정 변경하면 그 설정에 따라가게").
// 바꿀 설정 키 목록과 '올리기 멈추기'는 cloud-prefs 가 registerPrefSwap 으로 넘긴다 (거꾸로 import 하면 고리가 생긴다)
const ACCOUNTS_KEY = "ta:me-accounts";
export const MAX_ACCOUNTS = 5;   // 서버 다섯(한·일·글로벌·중국 직영·비리비리)에 하나씩 — 계정 하나 수백 KB, 다섯이면 저장 공간 2MB 안쪽 (사용자 결정 2026-10-24)
type Slot = { id: string; at: number; me: string; token: string | null; pref: string | null; prefs: Record<string, string | null> };
let prefSwap: { keys: string[]; freeze: (push?: boolean) => void } | null = null;
export function registerPrefSwap(s: { keys: string[]; freeze: (push?: boolean) => void }) { prefSwap = s; }
/** 설정 올리기를 멈춘다 — push=false 면 마지막 올리기도 없이 (계정 설정을 지우기 직전: 지운 뒤 늦게 도착한 올리기가 되살리지 않게) */
export function freezePrefs(push = true) { prefSwap?.freeze(push); }
/** 그 계정의 설정용 표 — 지금 계정이면 지금 것, 보관한 계정이면 보관해 둔 것 */
export function accountPrefToken(id: string): string | null {
  const cur = read();
  if (cur && accountIdOf(cur.server, cur.player.uid) === id) return mePrefToken();
  return readSlots().find((x) => x.id === id)?.pref ?? null;
}
export const accountIdOf = (server: string, uid: string | number) => `${server}:${uid}`;
const ls = (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } };
const lsPut = (k: string, v: string | null) => { try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch { /* 무시 */ } };
function readSlots(): Slot[] {
  try { const v = JSON.parse(ls(ACCOUNTS_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string" && typeof x.me === "string") : []; } catch { return []; }
}
function writeSlots(slots: Slot[]) { lsPut(ACCOUNTS_KEY, slots.length ? JSON.stringify(slots) : null); }
/** 지금 계정을 보관함으로 옮기고 지금 자리(계정 키·설정 키)를 비운다. 지금 계정이 없으면 아무것도 안 한다.
 *  keep — 보관함에 남길 최대 칸 수. 계정 바꾸기는 곧 한 칸을 꺼내므로 MAX_ACCOUNTS 칸까지 둔다 — MAX-1 로 자르면 계정이 다 찬 상태에서
 *  바꿀 때마다 가장 오래된 계정 하나가 조용히 사라졌다 (사용자 지적 2026-10-24 "하나 지우니까 두 개 날아갔다") */
function stashActive(keep = MAX_ACCOUNTS): void {
  const cur = read();
  const raw = ls(KEY);
  if (!cur || !raw) return;
  prefSwap?.freeze();   // 설정 올리기를 멈춘다 — 안 멈추면 바꾼 뒤의(다른 계정) 값이 이 계정 저장소로 올라간다
  const prefs: Record<string, string | null> = {};
  for (const k of prefSwap?.keys ?? []) prefs[k] = ls(k);
  const id = accountIdOf(cur.server, cur.player.uid);
  const slots = readSlots().filter((x) => x.id !== id);
  slots.unshift({ id, at: Date.now(), me: raw, token: ls(TOKEN_KEY), pref: ls(PREF_KEY), prefs });
  writeSlots(slots.slice(0, keep));
  lsPut(KEY, null); lsPut(TOKEN_KEY, null); lsPut(PREF_KEY, null);
  for (const k of prefSwap?.keys ?? []) lsPut(k, null);
  token = undefined; cachedRaw = undefined;
}
/** 보관함의 계정 하나를 지금 자리로 (설정 키까지). me 를 넘기지 않으면 게임 데이터·토큰은 두고 설정만 */
function loadSlot(slot: Slot, withMe = true): void {
  if (withMe) { lsPut(KEY, slot.me); lsPut(TOKEN_KEY, slot.token); lsPut(PREF_KEY, slot.pref); }
  for (const [k, v] of Object.entries(slot.prefs ?? {})) lsPut(k, v);
  writeSlots(readSlots().filter((x) => x.id !== slot.id));
  token = undefined; cachedRaw = undefined;
}
export type AccountTab = { id: string; server: AccountServer; uid: string; nick: string; level: number; active: boolean };
// nick 은 '닉네임#번호' — 이 조합은 게임에서 겹치지 않아 탭끼리 늘 구분된다 (사용자 확인 2026-10-24)
const nickOf = (p: MeData["player"]) => (p.nickNumber ? `${p.nickName}#${p.nickNumber}` : p.nickName);
// 탭 순서 — 처음 들어온 순서로 고정한다. 지금 계정을 맨 앞에 두면 바꿀 때마다 탭 자리가 바뀌었다 (사용자 지적 2026-10-24)
const ORDER_KEY = "ta:me-accounts-order";
/** 계정 탭 목록 — 처음 들어온 순서 그대로 (어느 계정을 보고 있든 자리가 같다) */
export function accountTabs(): AccountTab[] {
  const out: AccountTab[] = [];
  const cur = getMe();
  if (cur) out.push({ id: accountIdOf(cur.server, cur.player.uid), server: cur.server, uid: String(cur.player.uid), nick: nickOf(cur.player), level: cur.player.level, active: true });
  for (const sl of readSlots()) {
    try {
      const m = JSON.parse(sl.me) as MeData;
      if (out.some((x) => x.id === sl.id)) continue;
      out.push({ id: sl.id, server: m.server, uid: String(m.player.uid), nick: nickOf(m.player), level: m.player.level, active: false });
    } catch { /* 깨진 칸은 건너뛴다 */ }
  }
  let order: string[] = [];
  try { const v = JSON.parse(ls(ORDER_KEY) ?? "[]"); if (Array.isArray(v)) order = v.filter((x) => typeof x === "string"); } catch { /* 무시 */ }
  // 처음 보는 계정은 뒤에 붙이고, 없어진 계정은 뺀다
  const ids = new Set(out.map((x) => x.id));
  const next = [...order.filter((id) => ids.has(id)), ...out.map((x) => x.id).filter((id) => !order.includes(id))];
  if (next.join("|") !== order.join("|")) lsPut(ORDER_KEY, next.length > 1 ? JSON.stringify(next) : null);
  return out.sort((a, b) => next.indexOf(a.id) - next.indexOf(b.id));
}
/** 다른 계정으로 바꾼다 — 지금 계정을 보관하고 고른 계정(게임 데이터·설정)을 꺼낸 뒤 새로 연다 */
export function switchAccount(id: string): void {
  const slot = readSlots().find((x) => x.id === id);
  if (!slot) return;
  stashActive();
  loadSlot(slot);
  // 주소의 미래시 표시(?future=)는 떼고 연다 — 주소가 저장값보다 우선이라, 중섭 계정에서 붙은 표시가 한섭 계정에도 남았다
  const u = new URL(location.href);
  u.searchParams.delete("future");
  location.replace(u.toString());
}
/** 계정을 목록에서 뺀다. 지금 보고 있는 계정이면 그 자리를 비우고 목록의 첫 계정으로 옮겨 새로 연다 (남은 계정이 없으면 로그아웃과 같다).
 *  설정은 이 브라우저에서만 지운다 — 계정 저장소엔 남아 다시 동기화하면 돌아온다 (사용자 지시 2026-10-24 "자기 자신 계정도 뺄 수 있게, 빼면 첫 계정으로") */
export function removeAccount(id: string): void {
  const cur = read();
  if (!cur || accountIdOf(cur.server, cur.player.uid) !== id) {
    writeSlots(readSlots().filter((x) => x.id !== id));
    window.dispatchEvent(new Event(EVENT));
    return;
  }
  const order = accountTabs().map((x) => x.id).filter((x) => x !== id);
  const slots = readSlots();
  const next = order.map((oid) => slots.find((sl) => sl.id === oid)).find((sl): sl is Slot => !!sl);
  prefSwap?.freeze();
  lsPut(KEY, null); lsPut(TOKEN_KEY, null); lsPut(PREF_KEY, null);
  for (const k of prefSwap?.keys ?? []) lsPut(k, null);
  token = undefined; cachedRaw = undefined;
  if (next) loadSlot(next);
  const u = new URL(location.href);
  u.searchParams.delete("future");
  location.replace(u.toString());
}

/** 게임 로그인 결과를 저장한다 — 인프라 '가져오기'로 로그인해도 같은 곳에 쌓인다.
 *  지금과 다른 계정이 들어오면 지금 계정은 보관함으로 옮기고(계정 추가), 그 계정의 설정으로 새로 연다 */
export function saveMe(roster: AccountRoster, server: AccountServer, kind: "me_login" | "me_sync" = "me_login") {
  const cur = read();
  const nextId = accountIdOf(server, roster.player.uid);
  const switching = !!cur && accountIdOf(cur.server, cur.player.uid) !== nextId;
  if (switching) {
    // 새 계정이 들어오는 자리 — 보관함은 MAX-1 칸 (넘으면 가장 오래된 계정부터 빠진다. 화면에선 다 차면 '+ 계정 추가'를 숨긴다)
    const known = readSlots().some((x) => x.id === nextId);
    stashActive(known ? MAX_ACCOUNTS : MAX_ACCOUNTS - 1);
    const back = readSlots().find((x) => x.id === nextId);
    if (back) loadSlot(back, false);   // 예전에 쓰던 계정이면 그 계정 설정을 꺼낸다 (게임 데이터·토큰은 방금 받은 것)
  }
  // 방문 통계 — 누가(익명 id) 몇 번 동기화했는지 · 계정(UID)도 바로 넘겨 방문자와 잇는다(저장소에 못 쓰는 브라우저에서도)
  noteVisitEvent(kind, server, roster.player?.uid != null ? { uid: String(roster.player.uid) } : undefined);
  if (roster.token) setToken({ server, token: roster.token });
  if (roster.prefToken) setPrefToken(roster.prefToken);
  const data: MeData = {
    v: 1, server, syncedAt: Date.now(), player: roster.player, chars: roster.chars, profile: roster.profile ?? null,
    match: roster.match ?? null,
  };
  try { window.localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 저장 못 해도 이번 화면은 그린다 */ }
  cachedRaw = undefined;
  window.dispatchEvent(new Event(EVENT));
  // 계정이 바뀌었으면 새로 연다 — 기능들이 새 계정 설정을 처음부터 읽고, 설정 동기화도 새 계정으로 다시 붙는다
  if (switching) setTimeout(() => location.reload(), 50);
}

export function clearMe() {
  setToken(null);
  setPrefToken(null);
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

/** 가진 재화로 헤드헌팅을 몇 번 돌릴 수 있나 — 내 정보 '재화'와 가챠 시뮬레이터 '내 재화로'가 같이 쓴다 (2026-10-12 공용화).
 *  합성옥 600 = 1회, 허가증 1장 = 1회, 10회 허가증 = 10회. all 은 순오리지늄 1개 = 합성옥 180 으로 바꿔 남은 합성옥과 합친 값 */
export function mePulls(inv: Record<string, number> | undefined | null, kernel = false): { pulls: number; all: number; orundum: number; prime: number; permit: number; permit10: number } | null {
  if (!inv) return null;
  // 커널 헤드헌팅은 일반 허가증을 못 쓰고 커널 헤드헌팅 허가증(classic_gacha·classic_gacha_10)만 — 합성옥은 둘 다 된다
  const orundum = inv["4003"] ?? 0, prime = inv["4002"] ?? 0;
  const permit = inv[kernel ? "classic_gacha" : "7003"] ?? 0, permit10 = inv[kernel ? "classic_gacha_10" : "7004"] ?? 0;
  return {
    pulls: Math.floor(orundum / 600) + permit + permit10 * 10,
    all: Math.floor((orundum + prime * 180) / 600) + permit + permit10 * 10,
    orundum, prime, permit, permit10,
  };
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
