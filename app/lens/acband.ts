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

// ── 참가자 줄 (연합 '전략 정보' 화면) ──────────────────────────────────────
//
// 2026-09-07 재작성 — 처음엔 카드 좌상단 '참가자' 배지를 앵커로 삼았는데, 그 배지는 **내 카드에만**
// 붙는 '나' 표식이었다 (연합 4인 스크린샷 11/22/33 에서 확인). 그래서 남의 줄은 한 줄도 못 찾았다
// (사용자 신고 "다른사람 전략도 다 띄워줘야함"). 1인 녹화만 보고 맞춘 기하의 대가다.
//
// 새 앵커는 **줄 오른쪽 체크박스**다. 고른 줄에만 켜지므로 "읽을 썸네일이 있다" 와 정확히 같은 조건이고,
// 밝은 청록이라 마스크 한 번으로 잡힌다. 1px 팽창해 체크 글리프(16×15)와 네모 테두리(24×23)를 한
// 덩어리로 만들면 **거의 꽉 찬 정사각**이 되어 글자 조각과 갈린다.
//   실측(900px 판, 11/22/33.png): 체크박스 26×25 채움 0.94~0.97 · 청록 글자 조각 채움 0.31~0.82.
//   22.png 은 3개(한 명은 '선택 중'), 33.png 은 4개, 11.png(아무도 안 골랐다)·44.png(로비)는 0개.
//
// 기하 (체크박스 **마스크** 변 단위 — 마스크는 경계 흐림 때문에 실제보다 ~7% 작게 잡힌다):
//   썸네일 중심 = 체크박스 중심 + (-1.80, 0) · 썸네일 변 = 2.25 — dx -2.2~-1.7 · 변 2.0~2.5 를
//   훑어 **전 구간 오답 0**(33.png 4줄)이라 값에 예민하지 않다. 넓게 맞는 구간의 가운데를 골랐다.
//   두 픽스처가 서로 다른 해상도인데도 같은 비율이다 — v2 1인 화면(원본 1826px: 체크박스 54px,
//   썸네일 중심 -93px·변 119px)과 4인 스크린샷(원본 1920px: 54px, -95px·115px).
//   searchBand 가 사방 10%·3스케일을 훑으므로 이 정도 오차는 흡수된다.
//
// '나' 표식: 카드 좌상단의 작은 청록 정사각(실측 18×16 채움 0.78, 체크박스의 0.73배). 이걸로 내 줄을
// 가른다 — 우측 패널은 **돋보기로 남의 전략을 열어 보면 그 사람 것을 보여주므로** 내 전략의 근거로
// 쓰기엔 약하다. 표식을 못 찾으면 호출자가 우측 패널 값과 대조해 거른다.

/** 팽창 성분의 채움 — 이 아래는 글자 조각 (실측 경계: 글자 ≤0.82 vs 체크박스 ≥0.94) */
const CB_FILL = 0.88;
/** 체크박스 변 (900px 판 기준 px) — 실측 23~24 */
const CB_MIN = 12, CB_MAX = 44;
/** 체크박스 마스크 중심 → 썸네일 중심·변 (마스크 변 단위) */
const THUMB_DX = -1.80, THUMB_SIDE = 2.25;
/** '나' 표식 — 체크박스 변 대비 크기·최소 채움·체크박스보다 왼쪽이어야 하는 거리 */
const BADGE_LO = 0.45, BADGE_HI = 1.05, BADGE_FILL = 0.55, BADGE_DX = -6;

/** 밝은 청록 (체크박스·'나' 표식) — 상대 기준이라 어두워진 프레임도 잡는다 */
function brightTeal(r: number, g: number, b: number): boolean {
  return r < 60 && g >= 90 && g - r >= 60 && b - r >= 40 && b >= 0.6 * g && b <= 0.95 * g;
}

type Blob = { cx: number; cy: number; side: number; fill: number };

/**
 * 밝은 청록 8-연결 성분. `dilate` 면 1px 팽창해서 찾는다 — 체크박스는 체크 글리프와 네모 테두리가
 * 떨어져 있어 붙여야 한 덩어리가 된다.
 * ⚠ '나' 표식은 **팽창 없이** 찾아야 한다: 내 줄은 청록 테두리로 강조돼 있고 표식이 그 모서리에
 *   2px 붙어 있어, 팽창하면 테두리와 한 덩어리가 되어 크기 조건에서 통째로 탈락한다 (실측 11/22/33).
 * 변은 언제나 **팽창 전** 화소로 다시 재 해상도 의존을 없앤다.
 */
function tealBlobs(px: Uint8ClampedArray, W: number, H: number, dilate: boolean): Blob[] {
  const raw = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) if (brightTeal(px[p], px[p + 1], px[p + 2])) raw[i] = 1;
  let m = raw;
  if (dilate) {
    m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!raw[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < H && xx >= 0 && xx < W) m[yy * W + xx] = 1;
      }
    }
  }
  const s = W / 900;
  const lo = CB_MIN * s, hi = CB_MAX * s;
  const seen = new Uint8Array(W * H), st = new Int32Array(W * H);
  const out: Blob[] = [];
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!m[s0] || seen[s0]) continue;
    let sp = 0, cnt = 0, x0 = W, x1 = -1, y0 = H, y1 = -1;
    st[sp++] = s0; seen[s0] = 1;
    while (sp) {
      const i = st[--sp]; cnt++;
      const x = i % W, y = (i - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx; if (m[j] && !seen[j]) { seen[j] = 1; st[sp++] = j; } } }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < lo || bh < lo || bw > hi || bh > hi) continue;
    if (Math.abs(bw - bh) > 0.25 * Math.max(bw, bh)) continue;
    // 변은 팽창 전 화소의 bbox 로 — 팽창분(항상 1px)이 해상도에 따라 다른 비율로 섞이지 않게
    let rx0 = x1, rx1 = x0, ry0 = y1, ry1 = y0, has = false;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!raw[y * W + x]) continue;
      has = true;
      if (x < rx0) rx0 = x; if (x > rx1) rx1 = x; if (y < ry0) ry0 = y; if (y > ry1) ry1 = y;
    }
    if (!has) continue;
    out.push({ cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2, side: ((rx1 - rx0) + (ry1 - ry0)) / 2 + 1, fill: cnt / (bw * bh) });
  }
  return out;
}

/**
 * 연합 참가자 줄 **후보** — 전략을 고른 줄에만 체크박스가 켜지므로 "읽을 썸네일이 있다" 와 같은 조건이다.
 * ⚠ 여기서 내는 건 후보일 뿐이고, **판정은 호출자의 searchBand + BAND_ACCEPT 가 한다** (밴 인식의
 *   두 겹 게이트와 같은 규약). 값싼 기하로 넓게 제안하고, 답을 내는 매칭이 그대로 확인을 겸한다 —
 *   그래야 화면 어딘가의 청록 정사각 하나가 없는 줄을 만들어 내지 못한다.
 *   실측: 진짜 줄 0.78~0.87 vs 헛자리 0.29~0.41 (임계 0.60).
 */
export type PartRow = {
  /** 썸네일이 있을 자리 — searchBand 에 그대로 넘긴다 */
  thumb: BandRect;
  /** '나' 표식이 붙은 줄인가 */
  mine: boolean;
};

export function participantRows(px: Uint8ClampedArray, W: number, H: number): PartRow[] {
  const rows = tealBlobs(px, W, H, true).filter((b) => b.fill >= CB_FILL).sort((a, b) => a.cy - b.cy);
  if (!rows.length) return [];

  // '나' 표식 — 어느 줄과 같은 높이이고 그 줄의 체크박스보다 충분히 왼쪽인 작은 청록 정사각.
  // 후보가 여럿이면 줄 중심에 가장 가까운 것.
  let mineAt = -1, mineD = Infinity;
  for (const b of tealBlobs(px, W, H, false)) {
    if (b.fill < BADGE_FILL) continue;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (b.side < r.side * BADGE_LO || b.side > r.side * BADGE_HI) continue;
      if (b.cx > r.cx + BADGE_DX * r.side) continue;
      const d = Math.abs(b.cy - r.cy);
      if (d <= r.side * 1.6 && d < mineD) { mineD = d; mineAt = i; }
    }
  }

  return rows.map((r, i) => {
    const ts = THUMB_SIDE * r.side;
    return {
      thumb: { x: (r.cx + THUMB_DX * r.side - ts / 2) / W, y: (r.cy - ts / 2) / H, w: ts / W, h: ts / H },
      mine: i === mineAt,
    };
  });
}
