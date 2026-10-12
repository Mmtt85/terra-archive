// 스토리 책갈피 — 리더기(장면 모드)에서 어디까지 읽었는지 이야기마다 기억한다 (제안 934ec868, 2026-10-12 "どこまで読んだかを記録するしおり").
// 이 브라우저에만 남는다(localStorage). 막힌 환경(시크릿·저장 차단)에서는 조용히 아무것도 안 한다.
/** done = 마지막 화 끝까지 읽은 적이 있다 (한 번 서면 다시 처음부터 읽어도 남는다 — 목록 카드의 '다 읽음') */
export type StoryPos = { ep: number; line: number; at: number; done?: 1 };
const KEY = "ta:story-pos";
const MAX = 300;   // 오래된 것부터 버린다

function readAll(): Record<string, StoryPos> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, StoryPos>; } catch { return {}; }
}
export function storyPos(id: string): StoryPos | null {
  const p = readAll()[id];
  return p && Number.isFinite(p.ep) && Number.isFinite(p.line) ? p : null;
}
export function saveStoryPos(id: string, ep: number, line: number, done?: boolean): void {
  try {
    const all = readAll();
    all[id] = { ep, line, at: Date.now(), ...(done || all[id]?.done ? { done: 1 as const } : {}) };
    const keys = Object.keys(all);
    if (keys.length > MAX) for (const k of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX)) delete all[k];
    localStorage.setItem(KEY, JSON.stringify(all));
    subs.forEach((f) => f());
  } catch { /* 저장 막힘 */ }
}

/** 그 이야기의 읽은 기록(책갈피·다 읽음)을 지운다 — 리더기의 '읽은 기록 지우기' (사용자 요청 2026-10-13) */
export function clearStoryPos(id: string): void {
  try {
    const all = readAll();
    if (!(id in all)) return;
    delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
    subs.forEach((f) => f());
  } catch { /* 저장 막힘 */ }
}

// 목록 카드의 '읽는 중'·'다 읽음' 뱃지 (사용자 요청 2026-10-13) — useSyncExternalStore 용. 서버 렌더는 빈 표(뱃지 없음),
// 하이드레이션 뒤 이 브라우저 기록으로 채운다. 다른 탭에서 읽어도(storage 이벤트) 따라온다
const subs = new Set<() => void>();
let snapRaw: string | null = null;
let snap: Record<string, StoryPos> = {};
const EMPTY: Record<string, StoryPos> = {};
export function subscribeStoryPos(f: () => void): () => void {
  subs.add(f);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) f(); };
  window.addEventListener("storage", onStorage);
  return () => { subs.delete(f); window.removeEventListener("storage", onStorage); };
}
export function storyPosSnapshot(): Record<string, StoryPos> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* 막힘 */ }
  if (raw !== snapRaw) { snapRaw = raw; try { snap = JSON.parse(raw ?? "{}"); } catch { snap = {}; } }
  return snap;
}
export const storyPosServer = () => EMPTY;
