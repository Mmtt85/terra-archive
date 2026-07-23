// 스토리 전문 스샷 매칭 — 스샷 레이더 /stories 설치 (2026-07-24).
// scripts/build-story-search.py가 만든 public/story/search.bin(콘텐츠-정의 10그램 역색인)을
// 이진 탐색해, OCR 라인 몇 조각으로 어느 스토리·몇 번째 에피소드인지 투표한다.
// 정규화·FNV 해시는 빌드 스크립트와 자구까지 동일해야 한다.

export type StoryIndex = {
  hashes: Uint32Array; // 정렬됨
  story: Uint8Array;
  ep: Uint8Array;      // 255 = 같은 스토리 내 여러 ep에 걸침 (스토리 표로만 사용)
  ids: string[];       // story 바이트 → 스토리 id
};

export type StoryHit = { id: string; ep: number | null; hits: number };

const N = 10;
const EP_AMBIG = 255;

export const normStory = (s: string): string =>
  s.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

// FNV-1a 32비트 — UTF-16 코드 유닛의 하위/상위 바이트 순서 믹스 (build-story-search.py와 동일)
function fnv(s: string, from: number): number {
  let h = 2166136261;
  for (let i = from; i < from + N; i++) {
    const c = s.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), 16777619);
    h = Math.imul(h ^ (c >>> 8), 16777619);
  }
  return h >>> 0;
}

/** search.bin 페이로드 파싱 — u32 count | u32 hashes[] | u8 story[] | u8 ep[] (LE) */
export function parseStoryIndex(buf: ArrayBuffer, ids: string[]): StoryIndex {
  const dv = new DataView(buf);
  const count = dv.getUint32(0, true);
  const hashes = new Uint32Array(count);
  for (let i = 0; i < count; i++) hashes[i] = dv.getUint32(4 + i * 4, true);
  const base = 4 + count * 4;
  const story = new Uint8Array(buf, base, count);
  const ep = new Uint8Array(buf, base + count, count);
  return { hashes, story, ep, ids };
}

function lookup(hashes: Uint32Array, h: number): number {
  let lo = 0, hi = hashes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = hashes[mid];
    if (v === h) return mid;
    if (v < h) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

/** OCR 라인들 → 스토리·에피소드 판정. 표가 하나도 없으면 null.
 *  인덱스는 라인당 앵커 3점(접두·중간·접미)만 담으므로, 질의도 같은 3점 + 오프셋 ±1 변형을
 *  조회한다 (화자 이름 병합·줄바꿈 파편·한 글자 오독 대비). 조회는 전부 정확일치라
 *  한 표만 나와도 그 스토리 고유 10자가 실제로 찍혔다는 뜻 — 오탐 확률이 매우 낮다. */
export function analyzeStoryLines(rawLines: string[], idx: StoryIndex): StoryHit | null {
  const votes = new Map<number, number>();
  const epVotes = new Map<number, Map<number, number>>();
  for (const raw of rawLines) {
    const s = normStory(raw);
    if (s.length < N) continue;
    const last = s.length - N;
    const mid = last >> 1;
    // 같은 위치 중복 제거 + 오프셋 변형 (범위 안전)
    const positions = new Set<number>();
    for (const p of [0, 1, mid, mid + 1, last, last - 1]) {
      if (p >= 0 && p <= last) positions.add(p);
    }
    const seen = new Set<number>(); // 같은 라인 안의 중복 그램은 1표
    for (const p of positions) {
      const h = fnv(s, p);
      if (seen.has(h)) continue;
      seen.add(h);
      const k = lookup(idx.hashes, h);
      if (k < 0) continue;
      const si = idx.story[k];
      votes.set(si, (votes.get(si) ?? 0) + 1);
      const ei = idx.ep[k];
      if (ei !== EP_AMBIG) {
        const m = epVotes.get(si) ?? new Map<number, number>();
        m.set(ei, (m.get(ei) ?? 0) + 1);
        epVotes.set(si, m);
      }
    }
  }
  if (!votes.size) return null;
  const [bestStory, hits] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const eps = epVotes.get(bestStory);
  const ep = eps ? [...eps.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
  return { id: idx.ids[bestStory] ?? "", ep, hits };
}
