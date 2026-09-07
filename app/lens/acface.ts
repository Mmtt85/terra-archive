// 위수 협의 밴 카드 — **얼굴로 기물을 식별**한다 (2026-09-07).
// (순수 계산 코어. React·DOM·sharp 무의존 — 브라우저와 scripts/verify-ac/face.ts 하네스가 같은 함수를 쓴다.
//  크롭·축소는 pix.ts 의 resampleRgb 로만 한다 — canvas 와 sharp 가 다른 보간을 쓰면 하네스와 실제가 어긋난다)
//
// 왜 초상인가 (2026-09-07 실측 · scripts/ac-lab/face-match.ts → scratchpad/face/match-report-full.txt):
//   밴 카드 그림은 아바타(180×180)가 아니라 **스킨 초상(public/skin/portrait/<op>_2.webp, 180×360)의
//   윗부분**이다. 아바타 1:1 ZNCC 는 121종 중 1위 7.1% — 지난 실패(acvision.ts 머리글)의 원인.
//   초상을 카드 캔버스에 s=0.85 · dx=0.0625 · dy=−0.0625 로 놓고(50 카드 정합의 중앙값, align2.json)
//   10% 인셋 → 48×48 → HOG(8px 셀 · 9빈 · 셀 L2 → 전체 L2) 코사인 유사도로 비교하면
//   900px 브리지 판 294 카드에서 전체 121종 1위 95.6% · 티어 제한 97.3% · (맹약,티어) 후보 제한 99.3%
//   (픽스처 결함 카드 4장을 빼면 100%). 템플릿 지터 27개(스케일 0.95/1/1.05 × dx,dy ±0.03)를 더하면
//   97.6 / 97.6 / 100. 회색 ZNCC(32px) 는 74.5%, 색상 히스토그램은 33% 로 HOG 가 압도적이었다.
//   → 밴 화면에서 맹약 이름 OCR 없이도 행의 맹약과 기물을 얼굴만으로 정할 수 있다 (solveBanRow).
//
// 변환식 (카드 한 변을 1 로 본 카드 캔버스 좌표 ↔ 초상 픽셀 좌표):
//   초상의 (x0, y0, side) 정사각 영역이 카드 전체에 대응한다.
//   x0 = −dx/s · Wp,  y0 = −dy/s · Wp,  side = Wp / s   (Wp = 초상 폭 180)
//   초상 밖·투명 픽셀은 bg(172,169,169) — 카드 배경의 밝은 회색 실측 평균.
//   측정 코드는 128 캔버스를 거쳐 인셋 13px/128 → 48 로 갔지만, 여기서는 초상 좌표에서 인셋 영역을 바로
//   잡아 **한 번에** 48 로 리샘플한다 (하네스로 재현 확인: 표 수치는 scripts/verify-ac/face.ts 머리글).
//
// 리샘플러 보정 (2026-09-07 · scripts/verify-ac/face.ts 로 실측):
//   측정은 sharp lanczos3 두 단계(→128→48), 운영은 pix 의 bilinear k×k 평균 한 단계라 결과가 조금 더 무르다.
//   인셋 0.10 그대로면 (맹약,티어) 제한 99.7% · 티어 제한 97.3% 는 측정과 같지만 전체 121종 1위가 95.6→94.2%
//   로 4장 후퇴했다 — 전부 스노우헌터(char_4211_snhunt) 템플릿과의 경계 혼동(마진 0.004~0.015). 인셋을 흔들어
//   보니(0.08~0.16) 0.13 에서 그 혼동이 전부 사라져 전체 96.9% 로 회복 — 남은 오답 9장은 픽스처 결함 4장 +
//   카제마루(char_4016_kazema, 카드 그림이 _2 초상과 다른 듯 — 측정에서도 순위 83~89위) 5장뿐이다.
//   0.14 이상은 티어 제한이 96.9% 로 내려가서 0.13 에 둔다. 박스 ±2px·±6% 흔들림에서도 0.13 ≥ 0.10 이었다.
//
// 지터 기본값 (acface-load.ts FACE_JITTER_DEFAULT = false):
//   지터 27개는 전체 1위 +0.7pp, 박스 +2px 흔들림에서 (맹약,티어) 제한 오답 1장을 더 잡아 주지만
//   템플릿 특징 계산이 op 당 1.5ms → 40ms (node 실측 · 121종이면 0.18s → 4.9s) 로 27배다. 운영 지표
//   ((맹약,티어) 제한·solveBanRow pick)는 기본 템플릿으로 하한을 넉넉히 넘으므로 기본은 끄고, 필요하면
//   loadFaceTemplates(ops, { jitter: true }) 로 켠다.

import { resampleRgb, grayOf, sobel, dot, type Raster } from "./pix";

/** 얼굴 매칭 상수 — 바꾸면 하네스(scripts/verify-ac/face.ts)를 다시 돌려 표를 갱신할 것 */
export const FACE = {
  canvas: 128,            // 측정 때의 카드 캔버스 한 변 (참고값 — 실제 계산은 정규화 좌표로 한다)
  s: 0.85, dx: 0.0625, dy: -0.0625,   // 초상 → 카드 캔버스 정합 (align2.json 중앙값)
  bg: [172, 169, 169],    // 카드 배경 회색 (초상 밖·투명 채움)
  inset: 0.13,            // 카드 테두리·배지·밴 마크를 피하는 안쪽 여백 비율 (측정은 0.10 — 아래 머리글 '리샘플러 보정')
  size: 48,               // 특징 래스터 한 변
  cell: 8, bins: 9,       // HOG 셀 크기(px)·방향 빈 수 → 6×6 셀 × 9 = 324 차원
} as const;
const BG: [number, number, number] = [FACE.bg[0], FACE.bg[1], FACE.bg[2]];

/** 템플릿 지터 — [스케일 배수, dx 가감, dy 가감]. 첫 항이 기본(무지터), 나머지 26개가 흔든 것. */
export const FACE_JITTER: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = [[1, 0, 0]];
  for (const ds of [0.95, 1, 1.05]) for (const jx of [-0.03, 0, 0.03]) for (const jy of [-0.03, 0, 0.03]) {
    if (ds === 1 && jx === 0 && jy === 0) continue;
    out.push([ds, jx, jy]);
  }
  return out;
})();

/**
 * S×S RGB 래스터 → HOG 특징 (마스크 없음). face-match.ts featHog 와 같은 계산:
 * 소벨 기울기 → 방향 0~180° 를 bins 개로 선형 분배(크기 가중) → 셀 L2(+1e-3) → 전체 L2.
 * 결과는 단위 벡터라 내적이 곧 코사인 유사도.
 */
export function hogFeature(rgb: Uint8Array, S: number, cell: number = FACE.cell): Float32Array {
  const g = grayOf(rgb, S);
  const { gx, gy } = sobel(g, S);
  const nc = Math.floor(S / cell), NB = FACE.bins;
  const v = new Float32Array(nc * nc * NB);
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      const mag = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
      if (mag < 1e-3) continue;
      let ang = Math.atan2(gy[i], gx[i]) * 180 / Math.PI;
      if (ang < 0) ang += 180;
      if (ang >= 180) ang -= 180;
      const fb = ang / 180 * NB;
      const b0 = Math.floor(fb) % NB, b1 = (b0 + 1) % NB, w1 = fb - Math.floor(fb);
      const cx = Math.min(nc - 1, Math.floor(x / cell)), cy = Math.min(nc - 1, Math.floor(y / cell));
      const base = (cy * nc + cx) * NB;
      v[base + b0] += mag * (1 - w1);
      v[base + b1] += mag * w1;
    }
  }
  for (let c = 0; c < nc * nc; c++) {
    let ss = 0;
    for (let k = 0; k < NB; k++) ss += v[c * NB + k] * v[c * NB + k];
    const inv = 1 / Math.sqrt(ss + 1e-3);
    for (let k = 0; k < NB; k++) v[c * NB + k] *= inv;
  }
  let ss = 0;
  for (let i = 0; i < v.length; i++) ss += v[i] * v[i];
  const inv = 1 / Math.sqrt(ss + 1e-9);
  for (let i = 0; i < v.length; i++) v[i] *= inv;
  return v;
}

/**
 * 화면(RGBA)의 카드 사각(px) → 인셋 → 48×48 → HOG.
 * 격자(acvision.findAcRows)의 AcCard 를 (x·W, y·H, w·W, h·H) 로 픽셀화해 **그대로** 넣으면 된다 — 2026-09-07 실측
 * (v1 f020/f024 · v2 f012/f018, 45장): 격자 상자와 이 모듈의 정합 기준 상자는 dx/c 중앙값 −0.015(−0.036~+0.008) ·
 * dy/c ≈ 0 · w/c 0.994~1.023 으로, 하네스가 확인한 ±2px·±6% 흔들림 안이다.
 */
export function cardFeature(px: Uint8ClampedArray, W: number, H: number,
  card: { x: number; y: number; w: number; h: number }): Float32Array {
  const src: Raster = { data: px, width: W, height: H, channels: 4 };
  const ix = card.x + card.w * FACE.inset, iy = card.y + card.h * FACE.inset;
  const iw = card.w * (1 - 2 * FACE.inset), ih = card.h * (1 - 2 * FACE.inset);
  return hogFeature(resampleRgb(src, ix, iy, iw, ih, FACE.size, BG), FACE.size);
}

/**
 * 초상(또는 아바타 폴백) 래스터 → 템플릿 특징. jitter=false 면 기본 1개, true 면 FACE_JITTER 27개.
 * 아바타(180×180)도 같은 식으로 잡는다 — Wp 가 폭이므로 아래쪽이 bg 로 채워질 뿐 (측정도 동일).
 */
export function templateFeatures(portrait: Raster, jitter = false): Float32Array[] {
  const Wp = portrait.width;
  const list = jitter ? FACE_JITTER : FACE_JITTER.slice(0, 1);
  return list.map(([ds, jx, jy]) => {
    const s = FACE.s * ds, dx = FACE.dx + jx, dy = FACE.dy + jy;
    const side = Wp / s, x0 = -dx / s * Wp, y0 = -dy / s * Wp;
    const in0 = side * FACE.inset, iw = side * (1 - 2 * FACE.inset);
    return hogFeature(resampleRgb(portrait, x0 + in0, y0 + in0, iw, iw, FACE.size, BG), FACE.size);
  });
}

export type FaceCand = { op: string; feats: Float32Array[] };

/** 지터 템플릿 중 최대 유사도 */
function bestSim(feat: Float32Array, feats: Float32Array[]): number {
  let best = -Infinity;
  for (const f of feats) { const s = dot(feat, f); if (s > best) best = s; }
  return best;
}

/** 카드 특징을 후보들과 비교해 유사도 내림차순으로 (지터 중 최대) */
export function rankFaces(feat: Float32Array, cands: FaceCand[]): { op: string; score: number }[] {
  return cands.map((c) => ({ op: c.op, score: bestSim(feat, c.feats) })).sort((a, b) => b.score - a.score);
}

export type FacePiece = { id: string; op: string; t: number; bonds: string[] };
export type FacePick = { id: string; op: string; score: number; margin: number };

/**
 * 밴 목록 **한 행**을 얼굴로 푼다 — 맹약 이름 OCR 없이.
 * 카드마다 티어 후보(그 티어의 기물 전부)에 점수를 내고, 행의 모든 카드가 공유하는 맹약 B 를
 * "각 카드의 (B,티어) 후보 중 최고 점수 합"이 최대인 것으로 고른 뒤, 카드마다 (B,티어) 후보 1위를 낸다.
 *   margin = 1위 − 2위 (후보가 하나면 1). 실측(900px 판 294장, 인셋 0.13): 정답 마진 중앙값 0.215 · 최소 0.002,
 *   오답은 픽스처 결함 카드 1장뿐(마진 0.026) — 마진으로 기권 문턱을 두려면 0.03 근처가 실측 경계다.
 *   한 장짜리 행: 티어 후보 1위를 그대로, bond 는 그 기물의 맹약이 하나면 그것 · 아니면 null.
 *   두 맹약의 합이 정확히 같으면(같은 기물들이 두 맹약에 다 속함) 얼굴만으론 못 가르므로 bond=null.
 * picks[i] 는 cards[i] 에 대응한다 (후보가 하나도 없는 카드 — 그 티어에 템플릿 있는 기물이 없을 때 — 는
 * id·op 빈 문자열). pick 의 id 는 chess 의 기본형 id (pieces 에 넣은 그대로).
 *
 * hint — 행의 맹약을 이미 아는 경우(맹약 아이콘 매칭 acbond.ts, 실측 95/95 정답). 주면 역산을 건너뛰고
 *   후보를 곧바로 그 맹약으로 제한한다: 한 장짜리 행에서도 맹약이 정해지고(역산은 두 맹약 기물이면 포기했다),
 *   같은 기물 집합을 공유하는 두 맹약이 동점이라 포기하던 경우도 없어진다.
 */
export function solveBanRow(cards: { tier: number; feat: Float32Array }[], pieces: FacePiece[],
  tpl: Map<string, Float32Array[]>, hint?: string | null): { bond: string | null; picks: FacePick[] } {
  if (!cards.length) return { bond: null, picks: [] };
  type Sc = { p: FacePiece; score: number };
  // 카드별 티어 후보 점수 (내림차순)
  const scored: Sc[][] = cards.map((c) => {
    const out: Sc[] = [];
    for (const p of pieces) {
      if (p.t !== c.tier) continue;
      // 맹약을 알면 **(맹약,티어) 후보만** 비교한다 (사용자 지시 2026-09-07 "사르곤에 속한 기물이랑
      // 만 비교하는 식으로"). 조합당 후보는 1~4명뿐이다 (1명 57조합 · 2명 52 · 3명 13 · 4명 1) —
      // 티어 전체(≈20명)를 다 재고 나중에 거르던 것과 결과는 같고(같은 부분집합의 argmax) 비교가 5~20배 줄며,
      // 후보가 1명인 조합은 비교 없이 확정된다. 필요한 초상 템플릿도 그만큼만 받으면 된다 (run.ts).
      if (hint && !p.bonds.includes(hint)) continue;
      const feats = tpl.get(p.op);
      if (!feats || !feats.length) continue;
      out.push({ p, score: bestSim(c.feat, feats) });
    }
    return out.sort((a, b) => b.score - a.score);
  });
  const empty: FacePick = { id: "", op: "", score: 0, margin: 0 };
  const pickFrom = (pool: Sc[]): FacePick => pool.length
    ? { id: pool[0].p.id, op: pool[0].p.op, score: pool[0].score, margin: pool.length >= 2 ? pool[0].score - pool[1].score : 1 }
    : empty;

  // 맹약을 이미 아는 경우 — 역산할 것이 없다 (위에서 이미 그 맹약 후보만 쟀다)
  if (hint) return { bond: hint, picks: scored.map(pickFrom) };
  if (cards.length === 1) {
    const top = scored[0][0];
    return { bond: top && top.p.bonds.length === 1 ? top.p.bonds[0] : null, picks: [pickFrom(scored[0])] };
  }
  // 맹약별: 카드마다 (B,티어) 후보 최고 점수 — 모든 카드를 덮는 B 만 후보
  const sums = new Map<string, { sum: number; n: number }>();
  scored.forEach((list) => {
    const seen = new Set<string>();
    for (const { p, score } of list) {        // 내림차순이라 처음 만난 맹약의 점수가 그 카드의 최고
      for (const b of p.bonds) {
        if (seen.has(b)) continue;
        seen.add(b);
        const e = sums.get(b) ?? { sum: 0, n: 0 };
        e.sum += score; e.n++;
        sums.set(b, e);
      }
    }
  });
  const full = [...sums.entries()].filter(([, e]) => e.n === cards.length).sort((a, b) => b[1].sum - a[1].sum);
  if (!full.length) return { bond: null, picks: scored.map(pickFrom) };
  const best = full[0][0];
  const tied = full.length >= 2 && Math.abs(full[0][1].sum - full[1][1].sum) < 1e-9;
  return { bond: tied ? null : best, picks: scored.map((list) => pickFrom(list.filter((x) => x.p.bonds.includes(best)))) };
}
