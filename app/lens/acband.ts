// 위수 협의 '전략'(밴드) 아이콘 매칭 — 순수 계산 코어 (React·DOM·sharp 무의존, 2026-09-07).
// 브라우저(PRTS 시뮬레이션 브리지)와 node 회귀 하네스(scripts/verify-ac/band.ts)가 같은 함수를 쓴다.
//
// 왜 그림 매칭인가: 전략 선택 화면의 4열 격자 타일·참가자 카드 썸네일·큰 초상은 전부
// public/ac/band/<id>.webp(180px) 와 **같은 홀로그램 아트**(같은 'STRATEGY' 워터마크·스캔라인)라
// 템플릿 매칭이 곧바로 먹힌다. 밴 화면(acvision.ts)에서 얼굴 매칭을 포기한 것과 다르다 —
// 그쪽은 초상 아트 자체가 달랐다.
//
// 측정으로 확정된 방법 (2026-09-07, v2 픽스처 900px 브리지 판, 실험 코드 scripts/ac-lab/band-*.ts):
//  [격자] 청록 마스크(G−R>22 · B−R>8 · G>48) 열/행 투영 → 등간격 런 사슬(피치 ±18%, 폭 중앙값 ±35%).
//         격자 프레임 5/5(4×4=16 타일)·비격자 12/12 거부. 타일 = 피치×0.87 (실측 176/204).
//         SELECTED 브래킷은 타일 가장자리 **안쪽** 1~4px 에 순청록(22,209,162)으로 그려진다 —
//         바깥 고리에서 찾던 1차 시도는 0.000~0.008 로 실패. 안쪽 7%·바깥 5% 고리 비율 0.19~0.23 vs 0.000.
//         격자 타일은 행우선으로 bands[].sort 1~16 과 일치(사람이 아이콘 시트와 대조). 스크롤(17~40)은 미검증.
//  [특징] Sobel(gx,gy) 부호 있는 2채널 ZNCC, N=32, inset 0.12. 80 표본 100%·평균 마진 0.34.
//         그레이 ZNCC 는 100% 여도 최소 마진 0.01~0.04(템플릿 상호 유사도 최대 0.942 두요야↔클레멘티아)라
//         단독 사용 불가, 히스토그램 평활화는 썸네일에서 7~8위(브래킷·돋보기 오버레이가 분포를 왜곡).
//  [탐색] 단일 rect 매칭은 정렬에 취약 — 세로 3px 오차만으로 80→35/80 (홀로그램 스캔라인 위상).
//         사전 블러는 75/80 까지만 회복하며 정렬 정확 시 마진을 깎아 채택 안 함. 대신 rect 를 사방 10%
//         넓힌 영역에서 아이콘 변 = 0.76×rect 변 × {0.92, 1, 1.08} 3스케일 · 1px 스텝 국소 탐색 →
//         모든 지터(±3px·±6%)에서 80/80, 최소 마진 0.248. 카드 썸네일 3/3(마진 0.35~), 큰 초상 7/7(0.37~).
//         원본 해상도로 올려도 이득이 없어 브리지 900px 상한은 그대로 둔다.
//  [이식 실측] 이 파일(pix.ts 리샘플) 로 다시 잰 값 (scripts/verify-ac/band.ts, node Apple Silicon, 2026-09-07):
//         타일 80/80 최소 마진 0.276·평균 0.398, 8종 지터(±3px·±6%) 전부 80/80 최소 마진 0.258~0.287,
//         카드 썸네일 3/3 마진 0.30~0.40, 큰 초상 7/7 마진 0.40~0.47, '선택 중' 카드 5/5 미승인(점수 ≤0.38).
//         속도 58 ms/타일(창 1232개 = 3스케일 × 16~24²; 그중 리샘플+소벨 2.7ms, 나머지가 40템플릿 내적).
//         step 2 는 17 ms/타일이지만 지터 시 마진이 0.09 까지 떨어져 승인 69~80/80 — 기본은 step 1 이다.
//         16타일 ≈ 0.9 s 라 브라우저에선 Worker 로 빼는 편이 안전하다.
//
// 좌표는 전부 0~1 정규화(브리지 크롭 폭이 프레임마다 1731~1807 로 흔들려 절대 px 상수는 못 쓴다).
// 크롭·축소는 pix.ts(resampleRgb)로만 한다 — canvas/sharp 보간 차이로 특징이 갈라지지 않게.

import { resampleRgb, grayOf, znorm, sobel, type Raster } from "./pix";

/** 특징 해상도 — 아이콘 안쪽(inset 제거 후)을 N×N 으로 본다 */
export const BAND_N = 32;
/** 아이콘 각 변에서 잘라내는 비율 — 테두리 장식·우상단 '1회 클리어' 배지·브래킷 오버레이를 피한다 */
export const BAND_INSET = 0.12;
/** 판정 권장 임계 — 실측 최소 마진 0.248(타일)·0.35(썸네일)·0.37(큰 초상) 아래로 넉넉히 */
export const BAND_ACCEPT = { score: 0.60, margin: 0.15 };
/** 국소 탐색 기본값 — rect 사방 10% 확장, 아이콘 변 0.76×rect 변 × 이 배율들 */
export const BAND_SCALES = [0.92, 1, 1.08];
const BAND_PAD = 0.10;

export type BandRect = { x: number; y: number; w: number; h: number };
export type BandTile = BandRect & { row: number; col: number };
export type BandGrid = {
  cols: number; rows: number;
  /** 행우선 (row*cols+col) — 화면에 온전히 보이는 행만 */
  tiles: BandTile[];
  /** SELECTED 브래킷이 붙은 타일의 tiles 인덱스 (없으면 null) */
  selected: number | null;
};
export type BandHit = {
  band: string; score: number;
  /** 1위 − 2위 (템플릿이 하나면 score 그대로) */
  margin: number;
  /** 2위 후보 — 헷갈리는 쌍(와파린↔클레멘티아 0.667 등)의 사용자 수정 UI 용 */
  second: string | null;
  /** 1위 창의 위치 — 아이콘 안쪽(inset 제거 후) 정사각, 정규화 (디버그 오버레이·하네스용) */
  at: BandRect;
  /** 훑은 창 수 (성능 계측용) */
  windows: number;
};

// ── 격자 검출 ──────────────────────────────────────────────────────────────

const TILE_RATIO = 0.87;

function tealMask(px: Uint8ClampedArray, W: number, H: number): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = px[p], g = px[p + 1], b = px[p + 2];
    if (g - r > 22 && b - r > 8 && g > 48) m[i] = 1;
  }
  return m;
}

type Run = { a: number; b: number; w: number; c: number };
/** 투영에서 임계(최댓값×thrFrac) 초과 런 — 가까운 런은 병합, 폭 범위 밖은 버린다 */
function runs(proj: Float64Array, thrFrac: number, minW: number, maxW: number, mergeGap: number): Run[] {
  let max = 0; for (let i = 0; i < proj.length; i++) if (proj[i] > max) max = proj[i];
  const thr = max * thrFrac;
  const merged: Run[] = [];
  let s = -1;
  for (let i = 0; i <= proj.length; i++) {
    const on = i < proj.length && proj[i] > thr;
    if (on && s < 0) s = i;
    if (!on && s >= 0) {
      const r: Run = { a: s, b: i - 1, w: i - s, c: (s + i - 1) / 2 };
      const last = merged[merged.length - 1];
      if (last && r.a - last.b - 1 <= mergeGap) { last.b = r.b; last.w = last.b - last.a + 1; last.c = (last.a + last.b) / 2; }
      else merged.push(r);
      s = -1;
    }
  }
  return merged.filter((r) => r.w >= minW && r.w <= maxW);
}

/** 등간격(피치 ±tol)으로 이어지고 폭도 고른(중앙값 ±35%) 가장 긴 런 사슬 */
function chain(rs: Run[], tol = 0.18): Run[] {
  let best: Run[] = [];
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const p = rs[j].c - rs[i].c;
      if (p <= 0) continue;
      const seq = [rs[i], rs[j]];
      let last = rs[j];
      for (let k = j + 1; k < rs.length; k++) {
        const d = rs[k].c - last.c;
        if (Math.abs(d - p) <= p * tol) { seq.push(rs[k]); last = rs[k]; }
        else if (d > p * (1 + tol)) break;
      }
      const wm = seq.map((r) => r.w).sort((a, b) => a - b)[Math.floor(seq.length / 2)];
      const ok = seq.every((r) => Math.abs(r.w - wm) <= wm * 0.35);
      if (ok && seq.length > best.length) best = seq;
    }
  }
  return best;
}

/**
 * 전략 선택 화면의 4열 타일 격자. 격자가 아니면(열<3·행<2·피치 불일치) null.
 * 화면 아래로 잘린 행은 버린다 (f021 의 5행 12px 노출 → 제거 확인).
 */
export function findBandGrid(px: Uint8ClampedArray, W: number, H: number): BandGrid | null {
  const m = tealMask(px, W, H);
  const s = W / 900;                       // 크기 상수는 900px 브리지 판 기준

  const colP = new Float64Array(W);
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (m[i]) colP[x]++;
  const colRuns = chain(runs(colP, 0.3, 40 * s, 140 * s, 3 * s));
  if (colRuns.length < 3) return null;
  const pitchX = (colRuns[colRuns.length - 1].c - colRuns[0].c) / (colRuns.length - 1);

  // 행 투영은 열 런의 x 범위 안에서만 — 패널·카드 같은 격자 밖 청록을 배제
  const rowP = new Float64Array(H);
  for (const r of colRuns) for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = r.a; x <= r.b; x++) if (m[row + x]) rowP[y]++;
  }
  let rowRuns = chain(runs(rowP, 0.3, 40 * s, 140 * s, 3 * s));
  if (rowRuns.length < 2) return null;
  const pitchY = (rowRuns[rowRuns.length - 1].c - rowRuns[0].c) / (rowRuns.length - 1);
  if (Math.abs(pitchX - pitchY) > 0.15 * pitchX) return null;

  const tw = pitchX * TILE_RATIO, th = pitchY * TILE_RATIO;
  rowRuns = rowRuns.filter((r) => r.c - th / 2 >= -2 && r.c + th / 2 <= H + 2);
  if (rowRuns.length < 2) return null;

  const tiles: BandTile[] = [];
  const ring: number[] = [];
  for (let ri = 0; ri < rowRuns.length; ri++) for (let ci = 0; ci < colRuns.length; ci++) {
    const x0 = colRuns[ci].c - tw / 2, y0 = rowRuns[ri].c - th / 2;
    // SELECTED 브래킷: 가장자리 안쪽 7%·바깥 5% 고리에서 '순청록'(R<60·G>150·20≤G−B≤90) 비율.
    // 얼굴의 청록(R 이 높고 G≈B)과 갈린다. 실측 f023~f025 선택 타일 0.185~0.228, 나머지 0.000.
    const ringIn = tw * 0.07, ringOut = tw * 0.05;
    let n = 0, hit = 0;
    const ya = Math.max(0, Math.round(y0 - ringOut)), yb = Math.min(H - 1, Math.round(y0 + th + ringOut));
    const xa = Math.max(0, Math.round(x0 - ringOut)), xb = Math.min(W - 1, Math.round(x0 + tw + ringOut));
    for (let y = ya; y <= yb; y++) {
      const inY = Math.min(y - y0, y0 + th - y);
      for (let x = xa; x <= xb; x++) {
        const d = -Math.min(x - x0, x0 + tw - x, inY);   // 가장자리까지 부호 거리 — 안쪽 음수
        if (d < -ringIn || d > ringOut) continue;
        n++;
        const p = (y * W + x) * 4;
        const r = px[p], g = px[p + 1], b = px[p + 2];
        if (r < 60 && g > 150 && g - b >= 20 && g - b <= 90) hit++;
      }
    }
    tiles.push({ row: ri, col: ci, x: x0 / W, y: y0 / H, w: tw / W, h: th / H });
    ring.push(n ? hit / n : 0);
  }
  // 선택 타일: 고리 비율 최댓값이 0.08 이상이고 2위의 3배 이상
  let selected: number | null = null;
  let i1 = -1, v1 = -1, v2 = -1;
  for (let i = 0; i < ring.length; i++) {
    if (ring[i] > v1) { v2 = v1; v1 = ring[i]; i1 = i; } else if (ring[i] > v2) v2 = ring[i];
  }
  if (i1 >= 0 && v1 >= 0.08 && (ring.length < 2 || v1 >= 3 * v2)) selected = i1;

  return { cols: colRuns.length, rows: rowRuns.length, tiles, selected };
}

// ── 특징 ───────────────────────────────────────────────────────────────────

/** S×S RGB → 휘도 → Sobel(gx, gy) 2채널 연결(2·S·S) → 평균 0·노름 1 */
export function gradFeature(rgb: Uint8Array, S: number): Float32Array {
  const { gx, gy } = sobel(grayOf(rgb, S), S);
  const v = new Float32Array(S * S * 2);
  v.set(gx, 0); v.set(gy, S * S);
  return znorm(v);
}

/** 아이콘(public/ac/band/<id>.webp, RGBA) → 검은 배경 합성·12% inset·32×32 → gradFeature */
export function bandTemplate(icon: Raster): Float32Array {
  const { width: w, height: h } = icon;
  const rgb = resampleRgb(icon, w * BAND_INSET, h * BAND_INSET, w * (1 - 2 * BAND_INSET), h * (1 - 2 * BAND_INSET), BAND_N, [0, 0, 0]);
  return gradFeature(rgb, BAND_N);
}

// ── 국소 탐색 ──────────────────────────────────────────────────────────────

/**
 * rect(아이콘이 있을 것으로 보는 영역, 정규화)를 사방 10% 넓힌 영역에서 아이콘을 찾아 템플릿별 최고 ZNCC 를 낸다.
 * 아이콘 안쪽 변 s = 0.76 × min(rect 변) × scale. 각 scale 마다 영역을 한 번 32/s 배로 리샘플한 뒤
 * 32×32 창을 정수 스텝(기본 1 = 프레임 s/32 px)으로 미끄러뜨린다 — 창마다 리샘플하지 않아 순수 JS 로 버틴다.
 * 임계는 호출자가 BAND_ACCEPT 로 판단한다 (원시값 반환).
 *
 * 점수 계산: ZNCC = dot(znorm(w), t). t 는 평균 0 이라 dot(w, t) / ||w − mean(w)|| 로 줄고, 창 벡터의
 * 테두리 1px(소벨 미정의)은 템플릿과 똑같이 0 이므로 안쪽 30×30×2 만 더하면 gradFeature(창 크롭)과 같다.
 */
export function searchBand(px: Uint8ClampedArray, W: number, H: number, rect: BandRect,
  tpl: Map<string, Float32Array>, opts?: { scales?: number[]; step?: number }): BandHit | null {
  const S = BAND_N, n = S * S, N = 2 * n, I = S - 2, L = 2 * I * I;
  const ids = [...tpl.keys()];
  const T = ids.length;
  if (!T) return null;
  const scales = opts?.scales ?? BAND_SCALES;
  const step = Math.max(1, Math.round(opts?.step ?? 1));

  const rw = rect.w * W, rh = rect.h * H;
  const side = Math.min(rw, rh);
  if (!(side >= 8)) return null;
  // 영역 = rect + 사방 10%, 정사각화(리샘플러가 정사각 출력) — 남는 쪽은 프레임 픽셀을 더 본다
  const sq = Math.max(rw, rh) + 2 * BAND_PAD * side;
  const sx = rect.x * W + rw / 2 - sq / 2, sy = rect.y * H + rh / 2 - sq / 2;
  const src: Raster = { data: px, width: W, height: H, channels: 4 };

  // 템플릿 행렬 — 안쪽 값만 이어 붙여 연속 메모리로 (창 벡터와 같은 배치)
  const TM = new Float32Array(T * L);
  for (let t = 0; t < T; t++) {
    const v = tpl.get(ids[t])!;
    let o = t * L;
    for (let c = 0; c < 2; c++) for (let y = 1; y <= I; y++) {
      const base = c * n + y * S;
      for (let x = 1; x <= I; x++) TM[o++] = v[base + x];
    }
  }

  const best = new Float64Array(T).fill(-2);
  const bestAt = new Float64Array(T * 3);   // (x0, y0, 창 변) — 프레임 px
  const wv = new Float32Array(L);
  let windows = 0;
  for (const k of scales) {
    const s = (1 - 2 * BAND_INSET) * side * k;      // 아이콘 안쪽 변 (프레임 px)
    const R = Math.max(S, Math.round(sq * S / s));   // 리샘플 영역 변
    const unit = sq / R;                             // 리샘플 1px = 프레임 unit px
    const g = grayOf(resampleRgb(src, sx, sy, sq, sq, R, [0, 0, 0]), R);
    const { gx, gy } = sobel(g, R);
    for (let y0 = 0; y0 + S <= R; y0 += step) for (let x0 = 0; x0 + S <= R; x0 += step) {
      let sum = 0, sq2 = 0, o = 0;
      for (let yy = 1; yy <= I; yy++) {
        const base = (y0 + yy) * R + x0;
        for (let xx = 1; xx <= I; xx++) { const v = gx[base + xx]; wv[o++] = v; sum += v; sq2 += v * v; }
      }
      for (let yy = 1; yy <= I; yy++) {
        const base = (y0 + yy) * R + x0;
        for (let xx = 1; xx <= I; xx++) { const v = gy[base + xx]; wv[o++] = v; sum += v; sq2 += v * v; }
      }
      windows++;
      const den = Math.sqrt(Math.max(0, sq2 - sum * sum / N));
      if (den < 1e-6) continue;
      const inv = 1 / den;
      // 템플릿 두 개씩 — 창 벡터 로드를 나눠 쓴다 (4단 언롤)
      let t = 0;
      for (; t + 1 < T; t += 2) {
        const a = t * L, b = a + L;
        let d0 = 0, d1 = 0, d2 = 0, d3 = 0, e0 = 0, e1 = 0, e2 = 0, e3 = 0, i = 0;
        for (; i + 3 < L; i += 4) {
          const w0 = wv[i], w1 = wv[i + 1], w2 = wv[i + 2], w3 = wv[i + 3];
          d0 += w0 * TM[a + i]; d1 += w1 * TM[a + i + 1]; d2 += w2 * TM[a + i + 2]; d3 += w3 * TM[a + i + 3];
          e0 += w0 * TM[b + i]; e1 += w1 * TM[b + i + 1]; e2 += w2 * TM[b + i + 2]; e3 += w3 * TM[b + i + 3];
        }
        for (; i < L; i++) { d0 += wv[i] * TM[a + i]; e0 += wv[i] * TM[b + i]; }
        const sa = (d0 + d1 + d2 + d3) * inv, sb = (e0 + e1 + e2 + e3) * inv;
        if (sa > best[t]) { best[t] = sa; bestAt[t * 3] = sx + x0 * unit; bestAt[t * 3 + 1] = sy + y0 * unit; bestAt[t * 3 + 2] = S * unit; }
        if (sb > best[t + 1]) { best[t + 1] = sb; bestAt[t * 3 + 3] = sx + x0 * unit; bestAt[t * 3 + 4] = sy + y0 * unit; bestAt[t * 3 + 5] = S * unit; }
      }
      if (t < T) {
        const a = t * L;
        let d = 0;
        for (let i = 0; i < L; i++) d += wv[i] * TM[a + i];
        const sa = d * inv;
        if (sa > best[t]) { best[t] = sa; bestAt[t * 3] = sx + x0 * unit; bestAt[t * 3 + 1] = sy + y0 * unit; bestAt[t * 3 + 2] = S * unit; }
      }
    }
  }

  let i1 = -1, v1 = -Infinity, i2 = -1, v2 = -Infinity;
  for (let t = 0; t < T; t++) {
    if (best[t] > v1) { i2 = i1; v2 = v1; i1 = t; v1 = best[t]; }
    else if (best[t] > v2) { i2 = t; v2 = best[t]; }
  }
  if (i1 < 0 || !(v1 > -2)) return null;
  const at: BandRect = { x: bestAt[i1 * 3] / W, y: bestAt[i1 * 3 + 1] / H, w: bestAt[i1 * 3 + 2] / W, h: bestAt[i1 * 3 + 2] / H };
  return { band: ids[i1], score: v1, margin: i2 >= 0 ? v1 - v2 : v1, second: i2 >= 0 ? ids[i2] : null, at, windows };
}

// ── 참가자 카드 (실험적) ────────────────────────────────────────────────────
//
// ⚠ **미검증** — 연합(2~4인) 픽스처가 없다. v2 f021~f029 의 1인 카드 한 장으로만 맞춰 놓은 기하다.
//    실제 연합 화면(카드 2~4장 배치·간격·크기)이 확인되기 전까지 결과는 '실험적' 표시를 달 것.
//
// 카드 고정 요소 (원본 1826×1030 f026 실측): 카드 테두리 x130~770 · y504~641 (w 640 · h 137, w/h≈4.67).
//  · 좌상단 '참가자' 배지: 밝은 청록(0,207,159) 정사각 x135~166 · y512~543 (변 32 = h×0.234) 안에 어두운 글리프.
//    → 이것을 앵커로 쓴다. 화면이 어두워지는 전환 프레임(f029)에서도 (0,124,97) 로 색상은 유지된다.
//    900px 판에서는 17×18 정사각 고리 — 카드 왼쪽 테두리와 2px 밖에 안 떨어져 있어 **팽창을 하면 붙는다**
//    (f026 은 왼쪽 테두리가 (0,129,88) 로 밝아 한 덩어리가 됐다). 8-연결 성분을 팽창 없이 쓴다.
//  · 왼쪽 ▶ 마커(0,210,162)는 x110~130 사이를 **움직이고** f029 에선 사라져(0,16,11) 앵커로 못 쓴다.
//  · 체크박스(0,254,236) x712~765 는 '선택 중'(f021~f025) 상태엔 없다.
//  · 썸네일 브래킷 박스 x586~705 · y516~628 ≈ 카드 높이 0.85 배 정사각, 오른쪽 끝에서 0.475h 안쪽.
//    '선택 중'이면 이 자리에 모래시계+글자만 있어 매칭 점수가 낮게 나온다(실측 0.15~0.38, 마진 ≤0.06)
//    → BAND_ACCEPT 미달 = 미선택 판정에 쓸 수 있다.
//  · 검증 두 가지로 격자·패널 속 배지 크기 청록 조각(f023~f025 에서 실제로 나왔다)을 걸러낸다:
//    (b) 카드 위/아래 변의 어두운 청록 테두리(0,56,46 · 어두워지면 4,35,29 / 바닥 바 7,26,24) — 예상 y 의
//        ±6% 안에서 가장 잘 맞는 행이 열의 40% 이상,
//    (c) 이름 띠 아래 어두운 띠(x 0.20~0.50w · y 0.40~0.60h, 실측 휘도 12~38) — 얼굴 타일은 여기가 밝다.
//  · 실측(900px 판): f021~f027·f029 카드 1장씩(원본 환산 x126~131 · y501~504 · 650~657×139~141 — 정답
//    130,504,640×137), 썸네일 매칭 f026/f027/f029 저스틴 0.82~0.89, '선택 중' f021~f025 ≤0.39 미승인.
//    f028 은 팝업이 카드를 덮어 0장 (위 변 대비가 안 나온다) — 그 화면은 팝업 큰 초상으로 읽는다.

const BADGE_OVER_W = 32 / 1826;     // 배지 변 / 화면 폭
const CARD_H_OVER_BADGE = 137 / 32;
const CARD_W_OVER_H = 640 / 137;
const BADGE_DX = 5 / 137, BADGE_DY = 8 / 137;   // 카드 좌상단 → 배지 좌상단 (h 단위)
const THUMB_SIDE = 0.85, THUMB_CX = 515.5 / 137;   // 썸네일 변 / 카드 높이, 썸네일 중심 x 오프셋 / 카드 높이

/** 밝은 청록 (배지·체크박스·마커) — 상대 기준이라 어두워진 프레임도 잡고, 어두운 테두리(G≈56)는 버린다 */
function brightTeal(r: number, g: number, b: number): boolean {
  return r < 60 && g >= 90 && g - r >= 60 && b - r >= 40 && b >= 0.6 * g && b <= 0.95 * g;
}
/** 카드 테두리 청록 — 아주 어두운 것까지 (7,26,24); 배경(10,22,22)·카드 속(3,12,19)은 아니다 */
function borderTeal(r: number, g: number, b: number): boolean {
  return g >= 24 && g - r >= 17 && b - r >= 13 && b >= 0.6 * g && b <= 0.95 * g;
}

export function participantSlots(px: Uint8ClampedArray, W: number, H: number): { card: BandRect; thumb: BandRect }[] {
  // 1) 밝은 청록 마스크 (팽창 없음 — 위 주석)
  const m = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) if (brightTeal(px[p], px[p + 1], px[p + 2])) m[i] = 1;
  // 2) 8-연결 성분 → 배지 크기의 정사각 덩어리만
  const side0 = BADGE_OVER_W * W;
  const minS = side0 * 0.65, maxS = side0 * 1.4 + 2;
  const cap = Math.ceil(maxS * maxS * 4);
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const cands: { x: number; y: number; s: number }[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!m[start] || seen[start]) continue;
    let sp = 0, cnt = 0, x0 = W, x1 = -1, y0 = H, y1 = -1;
    stack[sp++] = start; seen[start] = 1;
    while (sp) {
      const i = stack[--sp]; cnt++;
      const x = i % W, y = (i - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx;
          if (m[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
        }
      }
      if (cnt > cap) break;   // 얼굴 타일·초상처럼 큰 덩어리는 더 볼 것 없다 (남은 픽셀은 다음 성분으로 새지만 크기로 걸러진다)
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < minS || bh < minS || bw > maxS || bh > maxS) continue;
    if (Math.abs(bw - bh) > 0.2 * Math.max(bw, bh)) continue;   // 0.3 이면 헤더의 청록 숫자 '2'(15×21)가 통과했다
    if (cnt / (bw * bh) < 0.35) continue;    // 속이 텅 빈 고리(브래킷)는 아니다
    // 변 추정: 이진 마스크 bbox 는 축소·JPEG 번짐으로 실제보다 ≈1px 크다 (900px 판 실측 17.5 vs 16.6).
    // 카드 높이는 이 값의 4.28 배, 썸네일 x 는 3.35 배로 증폭되므로 1px 이 썸네일 위치 ±7px 를 좌우한다.
    cands.push({ x: x0 + 0.5, y: y0 + 0.5, s: (bw + bh) / 2 - 1 });
  }
  // 3) 배지 → 대략의 카드 기하 → 위 테두리 선·아래 바닥 바로 높이를 **다시 재고** 검증
  //    (배지 변 ±1px 가 카드 높이 ±4px·썸네일 x ±7px 로 증폭돼 f027 썸네일을 놓쳤다 — 테두리는 ±1px 다)
  const lum = (p: number) => px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114;
  const out: { card: BandRect; thumb: BandRect }[] = [];
  for (const c of cands) {
    const h0 = c.s * CARD_H_OVER_BADGE, w0 = h0 * CARD_W_OVER_H;
    const cx0 = c.x - BADGE_DX * h0, cy0 = c.y - BADGE_DY * h0;
    if (cx0 < -2 || cy0 < -2 || cx0 + w0 > W + 2 || cy0 + h0 > H + 2) continue;
    // 행 y 에서 카드 폭 30~90% 구간의 테두리 청록 열 비율
    const xa = Math.max(0, Math.round(cx0 + w0 * 0.3)), xb = Math.min(W - 1, Math.round(cx0 + w0 * 0.9));
    const rowFrac = (y: number): number => {
      if (y < 0 || y >= H) return 0;
      let cols = 0, hit = 0;
      for (let x = xa; x <= xb; x += 2) { cols++; const p = (y * W + x) * 4; if (borderTeal(px[p], px[p + 1], px[p + 2])) hit++; }
      return cols ? hit / cols : 0;
    };
    // 위 변: 예상 ±8% 안에서 비율 ≥0.45 인 첫 행 — 단 그 2~3px 위는 ≤0.25 여야 한다 (선이지 무늬가 아니다).
    // 아래 변: 바닥 바(두께 h×0.09)의 마지막 행(≥0.5) — 그 2~3px 아래는 ≤0.25 (카드가 거기서 끝난다).
    // 실측(900px): 진짜 카드는 위 0.51~1.00 / 아래 0.61~0.96 뒤 0.00~0.20 으로 뚝 떨어지고, 패널·초상 속
    // 배지 크기 청록 조각(f027·f029)은 0.3~0.8 이 평평하게 이어져 여기서 걸러진다. 둘 다 있어야 카드다.
    let top = -1, bottom = -1;
    for (let y = Math.round(cy0 - h0 * 0.08); y <= Math.round(cy0 + h0 * 0.08); y++) {
      if (rowFrac(y) >= 0.45 && rowFrac(y - 2) <= 0.25 && rowFrac(y - 3) <= 0.25) { top = y; break; }
    }
    for (let y = Math.round(cy0 + h0 * 1.08); y >= Math.round(cy0 + h0 * 0.85); y--) {
      if (rowFrac(y) >= 0.5 && rowFrac(y + 2) <= 0.25 && rowFrac(y + 3) <= 0.25) { bottom = y; break; }
    }
    if (top < 0 || bottom < 0) continue;
    const h = bottom - top + 1;
    if (Math.abs(h - h0) > h0 * 0.15) continue;           // 배지 크기와 너무 어긋나면 카드가 아니다
    const cy = top, w = h * CARD_W_OVER_H, cx = c.x - BADGE_DX * h;
    // (c) 이름 띠 아래 어두운 띠 — 얼굴 타일·초상은 여기가 밝다
    let sum = 0, n = 0;
    for (let y = Math.round(cy + h * 0.40); y <= Math.round(cy + h * 0.60); y += 2) {
      if (y < 0 || y >= H) continue;
      for (let x = Math.round(cx + w * 0.20); x <= Math.round(cx + w * 0.50); x += 2) {
        if (x < 0 || x >= W) continue;
        sum += lum((y * W + x) * 4); n++;
      }
    }
    if (!n || sum / n > 60) continue;
    if (out.some((o) => Math.abs(o.card.y * H - cy) < h * 0.5)) continue;   // 같은 카드 중복
    // 썸네일 = 브래킷 박스(원본 586~705 × 516~628, 카드 130~770 × 504~641): 중심 x = 카드 왼쪽 + 3.76h, 변 0.85h
    const ts = h * THUMB_SIDE;
    const tx = cx + THUMB_CX * h - ts / 2, ty = cy + (h - ts) / 2;
    out.push({
      card: { x: cx / W, y: cy / H, w: w / W, h: h / H },
      thumb: { x: tx / W, y: ty / H, w: ts / W, h: ts / H },
    });
  }
  out.sort((a, b) => a.card.y - b.card.y);
  return out;
}
