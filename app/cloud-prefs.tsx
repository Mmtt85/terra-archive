"use client";

// 사이트 설정 동기화 (사용자 지시 2026-10-14 "내 정보 로그인하면 UID 로 설정값을 저장 — 내 정보 맞춤 칸이라든지 스토리 어디까지 읽었는지",
// 같은 날 "제안도 로그인한 사람은 열람 코드 입력 없이 자기 것이 보이게").
// 내 정보 로그인·동기화 때 받은 설정용 표(me-store mePrefToken — 워커가 [서버, UID] 를 서명)로, 계정 워커 KV 에 설정을 둔다.
// 화면 코드는 손대지 않는다 — 각 기능은 원래대로 localStorage 에 쓰고, 여기서 그 키를 지켜보다 바뀌면 올리고, 들어올 때 받아서 써 넣는다.
// 써 넣은 뒤 storage 이벤트를 쏘면 그 기능들이 다른 탭에서 바뀐 것처럼 따라온다(맞춤 칸·책갈피 둘 다 storage 를 듣는다).
//   lww     — 키 통째로 더 나중에 고친 쪽이 이긴다 (맞춤 칸 구성)
//   entries — 객체의 항목마다 at 이 큰 쪽 (스토리 읽은 위치: 기기 A 에서 읽은 이야기와 기기 B 에서 읽은 이야기가 둘 다 남는다)
// ⚠ 워커 PREF_KEYS(workers/account/src/index.js)와 같은 목록이어야 한다 — 거기 없는 키는 받아 주지 않는다
import { useEffect } from "react";
import { adminKeyGet, prefsDelete, prefsGet, prefsPut, type PrefEntry } from "./account";
import { getBoardAdminKey, setBoardAdminKey } from "./feedback";
import { isOwnerUid } from "./visit-track";
import { mePrefToken, PREF_EVENT } from "./me-store";

//   token   — 제안 게시판 열람 코드: 계정에 있으면 그걸 쓰고, 이 브라우저가 따로 쓰던 코드는 예전 코드 목록으로 옮긴다 (계정에 없으면 이 브라우저 것을 올린다)
//   union   — 예전 열람 코드 목록: 합집합 (어느 기기에서 쓴 제안이든 다 보이게)
// ⚠ 순서: token 이 union 보다 먼저 — token 이 옮긴 코드를 union 이 같이 올린다
// 2026-10-14 (사용자 지시 "본 사이트에서 이어지는 거 전부") — 화면 설정 전부를 더했다. 기기마다 달라야 하는 것(창 위치·크기)·
// 그때그때 쓰고 버리는 것(위수 협의 판·파티, 치비 대화, 검색 기록)·계정 데이터 자체(ta:me — 기기마다 다시 동기화)·방문자 번호는 넣지 않는다
const SYNC: { key: string; merge: "lww" | "entries" | "token" | "union" }[] = [
  { key: "ta-theme", merge: "lww" },                    // 라이트·다크 모드
  { key: "ta-locale", merge: "lww" },                   // 사이트 언어
  { key: "ta-include-future", merge: "lww" },           // 미래시(중섭 선행) 보기
  { key: "story-reader-prefs", merge: "lww" },          // 스토리 글자·삽화 크기
  { key: "story-reader-sound", merge: "lww" },          // 리더기 소리
  { key: "ta:gallery-spoiler", merge: "lww" },          // 갤러리 스포일러 가리기
  { key: "ta-recruit-prized", merge: "lww" },           // 공채 '4★ 이상 확정 조합만'
  { key: "ta:new-seen", merge: "lww" },                 // NEW 배지 본 기록
  { key: "terra-archive-infra-v3", merge: "lww" },      // 인프라 편성기 — 보유 오퍼 설정·편성·우선순위·배치
  { key: "terra-archive-infra-recycle", merge: "lww" }, // 인프라 재활용소 우선도
  { key: "ta:me-layout", merge: "lww" },
  { key: "ta:me-order", merge: "lww" },
  { key: "ta:rogue-map-pos", merge: "lww" },
  { key: "ta:gacha-plan", merge: "lww" },               // 가챠 플래너 — 재화·수입·쓸 연차·직접 더한 일정·뽑을 오퍼 (2026-10-17)            // 통합전략 지도판 카드 자리 (app/free-drag.tsx, 2026-10-15)                 // 내 정보 카드 순서 (app/me-order.tsx, 2026-10-15)
  { key: "ta:story-pos", merge: "entries" },
  { key: "ta-feedback-token", merge: "token" },
  { key: "ta-feedback-extra", merge: "union" },
];
const asList = (raw: string | null): string[] => { try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
const META = "ta:pref-meta";   // { 키: 마지막으로 고친 시각 } — 이 브라우저 기준
const POLL_MS = 4000;
// 올리기는 모아서 — 바뀐 걸 찾는 건 4초마다(로컬 문자열 비교라 공짜)지만, 계정 저장소(KV)에 쓰는 건 1분에 한 번 + 탭을 닫거나 다른 창으로
// 갈 때만. KV 무료 플랜은 하루 쓰기 1,000번이라, 4초마다 쓰면 하루 로그인 160명(2026-10-14 실측)이 스토리만 읽어도 넘었다 (사용자 지적 2026-10-15)
const PUSH_EVERY_MS = 60_000;

type Meta = Record<string, number>;
const readMeta = (): Meta => { try { return JSON.parse(localStorage.getItem(META) ?? "{}") as Meta; } catch { return {}; } };
const writeMeta = (m: Meta) => { try { localStorage.setItem(META, JSON.stringify(m)); } catch { /* 무시 */ } };
const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
function put(k: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return; }
  // 테마는 storage 이벤트를 듣는 곳이 없어 바로 바꿔 준다 (머리 단추는 html.dark 클래스를 지켜본다)
  if (k === "ta-theme" && (v === "dark" || v === "light")) document.documentElement.classList.toggle("dark", v === "dark");
  // 같은 탭의 기능들이 따라오게 — 원래는 다른 탭에서 바뀔 때만 오는 이벤트를 흉내 낸다
  window.dispatchEvent(new StorageEvent("storage", { key: k, newValue: v }));
}
/** 항목마다 at 이 큰 쪽 — JSON 이 아니면 로컬을 둔다 */
function mergeEntries(local: string | null, remote: string | null): string | null {
  let a: Record<string, { at?: number }> = {}, b: Record<string, { at?: number }> = {};
  try { a = JSON.parse(local ?? "{}"); } catch { return local; }
  try { b = JSON.parse(remote ?? "{}"); } catch { return local; }
  const out = { ...a };
  for (const [id, v] of Object.entries(b)) if (!out[id] || (v?.at ?? 0) > (out[id]?.at ?? 0)) out[id] = v;
  return Object.keys(out).length ? JSON.stringify(out) : local;
}

/** 저장된 설정 완전 초기화 — 내 정보의 단추 (사용자 지시 2026-10-14). 계정에 저장된 설정을 지우고, 이 브라우저의 같은 설정도 기본값으로 되돌린다.
 *  제안 열람 코드만은 남긴다 — 지우면 그동안 쓴 제안을 다시 볼 길이 없어진다. 끝나면 새로 연다(기능들이 기본값으로 다시 읽게) */
export async function resetCloudPrefs(logout?: () => void): Promise<void> {
  const token = mePrefToken();
  if (token) await prefsDelete(token);
  logout?.();   // 로그아웃까지 (내 정보 clearMe — 게임 토큰·설정용 표·계정 데이터)
  for (const { key } of SYNC) {
    if (key === "ta-feedback-token" || key === "ta-feedback-extra") continue;
    try { localStorage.removeItem(key); } catch { /* 무시 */ }
  }
  try { localStorage.removeItem(META); } catch { /* 무시 */ }
  location.reload();
}

export default function CloudPrefs() {
  useEffect(() => {
    let token = mePrefToken();
    let alive = true;
    let pulled = false;
    const seen = new Map<string, string | null>();    // 마지막으로 맞춰 본 값 — 이것과 달라지면 이 브라우저에서 고친 것
    const dirty = new Set<string>();

    const pull = async () => {
      if (!token) return;
      let remote: Record<string, PrefEntry>;
      try { remote = await prefsGet(token); } catch { return; }   // 끊겨도 로컬은 그대로 쓴다
      if (!alive) return;
      const meta = readMeta();
      for (const { key, merge } of SYNC) {
        const r = remote[key];
        const local = get(key);
        if (merge === "token") {
          const rv = r?.d ?? null;
          if (rv && local && rv !== local) {
            const extra = asList(get("ta-feedback-extra"));
            if (!extra.includes(local)) put("ta-feedback-extra", JSON.stringify([...extra, local]));
            put(key, rv);
          } else if (rv && !local) put(key, rv);
          else if (!rv && local) { meta[key] = meta[key] ?? Date.now(); dirty.add(key); }
          if (rv) meta[key] = r!.t;
        } else if (merge === "union") {
          const merged = [...new Set([...asList(local), ...asList(r?.d ?? null)])];
          const text = merged.length ? JSON.stringify(merged) : null;
          if (text !== local && text) put(key, text);
          if (text && text !== (r?.d ?? null)) { meta[key] = Date.now(); dirty.add(key); }
        } else if (merge === "entries") {
          const merged = mergeEntries(local, r?.d ?? null);
          if (merged !== local) put(key, merged);
          if (merged !== (r?.d ?? null)) { meta[key] = Date.now(); dirty.add(key); }   // 로컬에만 있던 항목은 올린다
        } else if (r && r.t > (meta[key] ?? 0)) {
          if (r.d !== local) put(key, r.d);
          meta[key] = r.t;
        } else if (local !== null && (!r || (meta[key] ?? 0) > r.t)) {
          meta[key] = meta[key] ?? Date.now(); dirty.add(key);
        }
        seen.set(key, get(key));
      }
      writeMeta(meta);
      pulled = true;
    };

    let lastPush = 0;
    const push = async (keepalive = false) => {
      if (!token || !pulled || !dirty.size) return;
      if (!keepalive && Date.now() - lastPush < PUSH_EVERY_MS) return;   // 1분 안에 또 바뀐 건 모았다가 다음 번에
      lastPush = Date.now();
      const meta = readMeta();
      const keys: Record<string, PrefEntry> = {};
      for (const k of dirty) keys[k] = { t: meta[k] ?? Date.now(), d: get(k) };
      dirty.clear();
      try { await prefsPut(token, keys, keepalive); } catch { for (const k of Object.keys(keys)) dirty.add(k); }   // 실패하면 다음 번에
    };

    // 바뀐 키 찾기 — 기능 코드를 고치지 않으려고 값 비교로 본다 (몇 초에 한 번, 문자열 비교라 가볍다)
    const tick = () => {
      if (!token || !pulled) return;
      const meta = readMeta();
      let changed = false;
      for (const { key } of SYNC) {
        const v = get(key);
        if (v !== seen.get(key)) { seen.set(key, v); meta[key] = Date.now(); dirty.add(key); changed = true; }
      }
      if (changed) writeMeta(meta);
      void push();
    };

    // 관리자 — 관리자 UID 로 로그인한 브라우저면 계정 워커에서 관리자 키를 받아 둔다(제안 게시판 답변·위수 협의 통계 등이 쓴다).
    // 아닌 브라우저에 예전 방식(제안 창에 직접 넣기)으로 남은 키는 지운다 (사용자 지시 2026-10-14 "기존 관리자 판정은 다 지워")
    const admin = async () => {
      if (!isOwnerUid()) { if (getBoardAdminKey()) setBoardAdminKey(null); return; }
      if (!token || getBoardAdminKey()) return;
      try { const k = await adminKeyGet(token); if (k && alive) setBoardAdminKey(k); } catch { /* 다음에 다시 */ }
    };
    void pull();
    void admin();
    const timer = window.setInterval(tick, POLL_MS);
    // 로그인·동기화로 표가 생기거나 '데이터 지우기'로 없어지면
    const onToken = () => { token = mePrefToken(); pulled = false; seen.clear(); dirty.clear(); void pull(); void admin(); };
    const onHide = () => { if (document.visibilityState === "hidden") { tick(); void push(true); } };
    window.addEventListener(PREF_EVENT, onToken);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(PREF_EVENT, onToken);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);
  return null;
}
