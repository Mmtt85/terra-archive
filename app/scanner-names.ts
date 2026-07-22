"use client";

// 오퍼 이름 fuzzy 매칭 — OCR로 읽은(오탈자 있을 수 있는) 이름을 우리 정식 오퍼 사전(한/영/일 +
// 커뮤니티 별명)에 가장 가까운 이름으로 스냅한다. 닫힌 사전(436명)이라 OCR이 몇 글자 틀려도
// 정확도가 높다. operators.json은 스캐너 열 때 지연 로드(메인 번들 밖).
type Cand = { id: string; name: string; norm: string };
let CANDS: Cand[] | null = null;
let loadingPromise: Promise<void> | null = null;

// 정규화 — 공백·구분점·괄호 제거, 소문자. 한글은 그대로. (예: "니어 더 래디언트 나이트" → "니어더래디언트나이트")
const norm = (s: string) => s.toLowerCase().replace(/[\s·・;:,._'’`\-—()[\]]/g, "");

export function namesReady(): boolean { return CANDS !== null; }

export async function initNames(): Promise<void> {
  if (CANDS) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const [ko, en, ja] = await Promise.all([
      import("./data/operators.json"),
      import("./data/operators.en.json").catch(() => null),
      import("./data/operators.ja.json").catch(() => null),
    ]);
    const ops = ((ko as { default?: OpRow[] }).default ?? (ko as unknown as OpRow[]));
    const enMap = mapNames(en);
    const jaMap = mapNames(ja);
    const out: Cand[] = [];
    const push = (id: string, name: string, key: string) => { const n = norm(key); if (n) out.push({ id, name, norm: n }); };
    for (const op of ops) {
      push(op.id, op.name, op.name);                 // KR 정식 이름 (표시용 name도 KR)
      for (const a of op.aliases ?? []) push(op.id, op.name, a); // 커뮤니티 별명
      if (op.code) push(op.id, op.name, op.code);
      const e = enMap.get(op.id); if (e) push(op.id, op.name, e);
      const j = jaMap.get(op.id); if (j) push(op.id, op.name, j);
    }
    CANDS = out;
  })();
  return loadingPromise;
}

type OpRow = { id: string; name: string; code?: string; aliases?: string[] };
function mapNames(mod: unknown): Map<string, string> {
  const rows = mod ? ((mod as { default?: OpRow[] }).default ?? (mod as OpRow[])) : [];
  return new Map((Array.isArray(rows) ? rows : []).map((o) => [o.id, o.name]));
}

// 레벤슈타인 거리 (짧은 문자열 · 436 후보라 단순 DP로 충분)
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

export type NameMatch = { id: string; name: string; sim: number; text: string };

// OCR 텍스트 → 최근접 오퍼. sim = 1 - 편집거리/최대길이 (0~1, 높을수록 확실).
export function matchName(text: string): NameMatch | null {
  if (!CANDS) return null;
  const q = norm(text);
  if (q.length < 1) return null;
  let best: Cand | null = null;
  let bestSim = -1;
  for (const c of CANDS) {
    const d = lev(q, c.norm);
    const sim = 1 - d / Math.max(q.length, c.norm.length);
    if (sim > bestSim) { bestSim = sim; best = c; }
  }
  return best ? { id: best.id, name: best.name, sim: bestSim, text } : null;
}
