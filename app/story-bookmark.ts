// 스토리 책갈피 — 리더기(장면 모드)에서 어디까지 읽었는지 이야기마다 기억한다 (제안 934ec868, 2026-10-12 "どこまで読んだかを記録するしおり").
// 이 브라우저에만 남는다(localStorage). 막힌 환경(시크릿·저장 차단)에서는 조용히 아무것도 안 한다.
export type StoryPos = { ep: number; line: number; at: number };
const KEY = "ta:story-pos";
const MAX = 300;   // 오래된 것부터 버린다

function readAll(): Record<string, StoryPos> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, StoryPos>; } catch { return {}; }
}
export function storyPos(id: string): StoryPos | null {
  const p = readAll()[id];
  return p && Number.isFinite(p.ep) && Number.isFinite(p.line) ? p : null;
}
export function saveStoryPos(id: string, ep: number, line: number): void {
  try {
    const all = readAll();
    all[id] = { ep, line, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > MAX) for (const k of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX)) delete all[k];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* 저장 막힘 */ }
}
