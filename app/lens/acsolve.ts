// 위수 협의 밴 목록 풀이 — (맹약, 티어) 관측에서 **어느 기물이 밴됐는지** 역산한다.
// (순수 계산 코어. React·DOM 무의존)
//
// 왜 이 방식인가 (2026-09-06 방향 전환):
//   밴 화면은 이름 없이 얼굴만 나온다. 초상·아바타 템플릿 ZNCC 로 맞히려 했으나 후보 121종
//   중 순위 2·25·9·31위 — 못 쓸 수준이었다. 그런데 밴은 **기물 단위**이고, 밴된 기물은
//   자기가 속한 **모든 맹약 행에 동시에** 나타난다 (시=염국+아케인 → 두 행 모두 T5로).
//   그래서 행들이 서로를 구속한다 — 얼굴을 안 보고 조합만으로 풀린다.
//
//   실측(ban2.jpg): 5개 행만 넣었을 때 후보 33종·슬롯 21칸에서 탐색 24노드·0.0초,
//   17종 중 15종이 모든 해에서 동일했다. 화면을 끝까지 스크롤해 전 행을 받으면 더 좁혀진다.
//   그래서 UI 가 "끝까지 스크롤해 주세요"라고 안내한다 — 그 안내가 정확도의 일부다.
//
// ⚠ **여러 해가 남으면 교집합만 확정으로 낸다.** 하나를 골라 보여 주면 틀린 밴을 사실처럼
//   보여 주게 된다 — 모르는 건 모른다고 두는 편이 낫다.

/** 기물 하나 — id 는 chessId, bonds 는 소속 맹약 id 들, t 는 티어 */
export type AcPiece = { id: string; op: string; t: number; bonds: string[] };
/** 화면에서 읽은 한 행 — 맹약 id 와 그 행에 보인 티어들 */
export type AcRow = { bond: string; tiers: number[] };

export type AcSolveResult = {
  /** 모든 해에 공통으로 들어가는 기물 — 확정 */
  sure: string[];
  /** 해마다 갈리는 기물 — 후보로만 (화면을 더 보면 좁혀진다) */
  maybe: string[];
  /** 찾은 해의 수 (0 = 관측이 모순이거나 아직 부족) */
  solutions: number;
};

const MAX_SOLUTIONS = 64;      // 이보다 많으면 관측이 아직 헐거운 것 — 더 찾아도 의미 없다
const MAX_NODES = 200_000;     // 폭주 방지 (실측은 24노드였다)

/**
 * 관측된 행들을 정확히 설명하는 기물 조합을 찾는다.
 * 한 기물은 자기가 속한 **관측된** 맹약마다 슬롯 하나씩을 채운다.
 */
export function solveAcBans(rows: AcRow[], pieces: AcPiece[]): AcSolveResult {
  const seen = new Set(rows.map((r) => r.bond));
  // 슬롯 = (맹약, 티어) → 남은 개수
  const need = new Map<string, number>();
  for (const r of rows) {
    for (const t of r.tiers) {
      const k = `${r.bond}|${t}`;
      need.set(k, (need.get(k) ?? 0) + 1);
    }
  }
  if (!need.size) return { sure: [], maybe: [], solutions: 0 };

  // 후보 — 관측된 맹약에 걸치고, 걸친 칸이 **전부** 관측에 있는 기물만
  type Cand = { id: string; cover: string[] };
  const cands: Cand[] = [];
  for (const p of pieces) {
    const cover = p.bonds.filter((b) => seen.has(b)).map((b) => `${b}|${p.t}`);
    if (!cover.length) continue;
    if (cover.some((k) => !need.has(k))) continue;   // 관측에 없는 칸을 채우면 모순
    cands.push({ id: p.id, cover });
  }
  const bySlot = new Map<string, Cand[]>();
  for (const c of cands) {
    for (const k of c.cover) {
      const a = bySlot.get(k); if (a) a.push(c); else bySlot.set(k, [c]);
    }
  }

  const sols: string[][] = [];
  const chosen = new Set<string>();
  let nodes = 0;
  const rec = (): void => {
    if (sols.length >= MAX_SOLUTIONS || ++nodes > MAX_NODES) return;
    // 남은 칸 중 후보가 가장 적은 것부터 (제약 전파 — 가지치기가 빨라진다)
    let slot: string | null = null, fewest = Infinity;
    for (const [k, n] of need) {
      if (n <= 0) continue;
      let c = 0;
      for (const cd of bySlot.get(k) ?? []) if (!chosen.has(cd.id)) c++;
      if (c < fewest) { fewest = c; slot = k; }
    }
    if (slot === null) { sols.push([...chosen]); return; }
    if (fewest === 0) return;                         // 채울 수 없는 칸 — 막다른 길
    for (const cd of bySlot.get(slot) ?? []) {
      if (chosen.has(cd.id)) continue;
      if (cd.cover.some((k) => (need.get(k) ?? 0) <= 0)) continue;
      for (const k of cd.cover) need.set(k, need.get(k)! - 1);
      chosen.add(cd.id);
      rec();
      chosen.delete(cd.id);
      for (const k of cd.cover) need.set(k, need.get(k)! + 1);
      if (sols.length >= MAX_SOLUTIONS || nodes > MAX_NODES) return;
    }
  };
  rec();

  if (!sols.length) return { sure: [], maybe: [], solutions: 0 };
  // 교집합 = 확정, 합집합 − 교집합 = 후보
  const inter = new Set(sols[0]);
  const union = new Set<string>();
  for (const s of sols) {
    const set = new Set(s);
    for (const id of [...inter]) if (!set.has(id)) inter.delete(id);
    for (const id of s) union.add(id);
  }
  return {
    sure: [...inter].sort(),
    maybe: [...union].filter((id) => !inter.has(id)).sort(),
    solutions: sols.length,
  };
}
