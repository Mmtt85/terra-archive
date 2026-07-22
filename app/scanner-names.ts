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

// 전체프레임 OCR 단어들을 카드 이름으로 묶어(행·x간격 클러스터링) 각각 fuzzy 매칭.
// 격자·크롭 없이 자동. box는 프레임 픽셀 좌표(오버레이용). id별 최고 sim 하나만 남긴다.
type WordLike = { text: string; x0: number; y0: number; x1: number; y1: number; conf: number };
export type Detection = NameMatch & { box: { x0: number; y0: number; x1: number; y1: number } };

export type WordGroup = { text: string; box: { x0: number; y0: number; x1: number; y1: number } };

// 전체프레임 OCR 단어들을 행·x간격으로 묶어 "카드 이름 후보 그룹"으로 만든다(매칭 전 단계).
// 2패스 인식(호출부)이 이 그룹 위치로 각 이름을 고해상도 재판독한다.
export function groupWords(words: WordLike[]): WordGroup[] {
  const ws = words.filter((w) => (w.conf ?? 0) >= 25 && w.text.trim().length > 0);
  if (!ws.length) return [];
  const heights = ws.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const medH = heights[heights.length >> 1] || 12;
  const rows: { yc: number; items: WordLike[] }[] = [];
  for (const w of [...ws].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)) {
    const yc = (w.y0 + w.y1) / 2;
    let row = rows.find((r) => Math.abs(r.yc - yc) < medH * 0.6);
    if (!row) { row = { yc, items: [] }; rows.push(row); }
    row.items.push(w);
  }
  const groups: WordGroup[] = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x0 - b.x0);
    let cur: WordGroup | null = null;
    for (const w of row.items) {
      if (cur && w.x0 - cur.box.x1 < medH * 1.4) {
        cur.text += w.text; cur.box.x1 = w.x1; cur.box.y0 = Math.min(cur.box.y0, w.y0); cur.box.y1 = Math.max(cur.box.y1, w.y1);
      } else {
        cur = { text: w.text, box: { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 } }; groups.push(cur);
      }
    }
  }
  return groups;
}

// 단일패스(참고용) — 그룹 텍스트를 그대로 매칭. 2패스는 emulator-capture가 수행.
export function detectFromWords(words: WordLike[], minSim = 0.58): Detection[] {
  const bestById = new Map<string, Detection>();
  for (const g of groupWords(words)) {
    const m = matchName(g.text);
    if (m && m.sim >= minSim) { const cur = bestById.get(m.id); if (!cur || m.sim > cur.sim) bestById.set(m.id, { ...m, box: g.box }); }
  }
  return [...bestById.values()].sort((a, b) => b.sim - a.sim);
}

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
