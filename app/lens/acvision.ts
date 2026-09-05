// 위수 협의 '사용 제한 오퍼레이터'(밴) 화면 — 카드 격자와 티어 배지를 읽는다 (2026-09-06).
// (순수 계산 코어. React·DOM 무의존 — 브라우저와 verify-lens 하네스가 같은 함수를 쓴다)
//
// 왜 얼굴을 안 보는가 (2026-09-06 실측 후 방향 전환):
//   초상·아바타 템플릿 ZNCC 로 얼굴을 맞히려 했으나 121종 중 순위 2·25·9·31위로 못 쓸
//   수준이었다. 대신 **밴된 기물은 자기가 속한 모든 맹약 행에 동시에 나타난다**는 성질을
//   쓴다 — 행끼리 서로를 구속하므로 (맹약, 티어) 관측만으로 조합이 거의 유일하게 정해진다
//   (ban2.jpg 5개 행만으로 17종 중 15종 확정, 탐색 24노드·0.0초). 풀이는 acsolve.ts.
//   그래서 여기서 뽑아야 하는 것은 **행별 티어 목록**뿐이다.
//
// 화면 배치:
//   [맹약 아이콘]  [카드][카드][카드]…      ← 한 행 = 한 맹약
//    맹약 이름                                 카드 좌하단에 티어 배지(로마숫자)
//
// ⚠ 카드 크기가 화면마다 다르다 — 전체화면 스샷은 179px, 창모드 BlueStacks 영상은 55px.
//   그래서 상수로 박지 않고 밝기 투영으로 격자를 찾는다.

/** 밴 카드 한 장 — 좌표는 0~1 정규화 */
export type AcCard = { x: number; y: number; w: number; h: number; tier: number | null };

// ── 티어 배지 ───────────────────────────────────────────────────────────────
// 실측 색상 (ban2.jpg, 표본 3~5개씩 · 편차 ±0.3°):
//   T6 H=30.8° S=0.99 · T5 H=45.5° S=0.97 · T4 H=189.4° S=0.77 · T3 H=161.2° S=0.78
//   T2/T1 은 무채색(S≤0.20) — 흰 글리프 면적으로 가른다 (T2 0.304 vs T1 0.012~0.072)
const HUES: { tier: number; h: number }[] = [
  { tier: 6, h: 31 }, { tier: 5, h: 46 }, { tier: 4, h: 189 }, { tier: 3, h: 161 },
];
const HUE_TOL = 12;        // 실측 편차가 ±0.3° 라 아주 넉넉한 값
const SAT_MIN = 0.45;      // 이보다 낮으면 무채색 배지(T1/T2)로 본다
const GREY_SPLIT = 0.15;   // 흰 글리프 면적비 — 위면 T2(획 둘), 아래면 T1(획 하나)

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}

/** 카드 좌하단 배지를 읽어 티어(1~6)를 낸다. 못 읽으면 null. */
export function readTier(px: Uint8ClampedArray, W: number, H: number,
  cx: number, cy: number, cw: number, chh: number): number | null {
  // 배지 영역 — 카드 기준 상대 위치 (실측: 좌 2~24% · 하 70~97%)
  const x0 = Math.round(cx + cw * 0.02), x1 = Math.round(cx + cw * 0.24);
  const y0 = Math.round(cy + chh * 0.70), y1 = Math.round(cy + chh * 0.97);
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;
  // ⚠ 배지가 화면 밖으로 잘렸으면 **읽지 않는다** — 잘린 배지는 색을 잃어 전부 T1 로
  //   읽히고, 그 틀린 티어가 풀이에 들어가면 조용히 엉뚱한 밴이 나온다. 스크롤 중에는
  //   위아래 행이 늘 잘려 있으므로 이 가드가 정확도의 핵심이다 (2026-09-06).
  if (y1 > H || y0 < 0 || x1 > W) return null;
  // ① 진한 색 픽셀들의 평균 색상 — 채도×명도 상위만 본다 (배지 테두리·글리프)
  const hits: [number, number, number][] = [];
  let white = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const [h, s, v] = rgbToHsv(px[i], px[i + 1], px[i + 2]);
      total++;
      if (v > 0.72 && s < 0.30) white++;          // 흰 글리프 (무채색 배지의 로마숫자)
      if (s >= SAT_MIN && v > 0.55) hits.push([h, s, v]);
    }
  }
  if (!total) return null;
  // ② 진한 색이 충분하면 색상으로 — 아니면 무채색 배지
  if (hits.length > total * 0.06) {
    // 색상 평균은 원형이라 벡터로 낸다 (0°/360° 경계 안전)
    let sx = 0, sy = 0;
    for (const [h] of hits) { sx += Math.cos(h * Math.PI / 180); sy += Math.sin(h * Math.PI / 180); }
    let hm = Math.atan2(sy, sx) * 180 / Math.PI;
    if (hm < 0) hm += 360;
    let best: number | null = null, bestD = HUE_TOL;
    for (const c of HUES) {
      const d = Math.min(Math.abs(hm - c.h), 360 - Math.abs(hm - c.h));
      if (d < bestD) { bestD = d; best = c.tier; }
    }
    if (best !== null) return best;
  }
  return white / total > GREY_SPLIT ? 2 : 1;
}

// ── 카드 격자 ───────────────────────────────────────────────────────────────
/** 밝은 픽셀 비율이 thr 이상인 구간들 — 최소 길이 minLen */
function runs(v: Float32Array, thr: number, minLen: number): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let i = 0; i < v.length; i++) {
    if (v[i] >= thr && s < 0) s = i;
    else if (v[i] < thr && s >= 0) { if (i - s >= minLen) out.push([s, i - 1]); s = -1; }
  }
  if (s >= 0 && v.length - s >= minLen) out.push([s, v.length - 1]);
  return out;
}

/**
 * 밴 화면의 카드들을 찾는다 — 밝기 투영으로 행·열을 잡고 교차점을 카드로 본다.
 * 카드 아트는 밝고 UI 배경은 아주 어두워서, 이 단순한 방법이 179px·55px 양쪽에서 모두 먹힌다.
 * 좌표는 0~1 정규화라 호출 측이 해상도를 몰라도 된다.
 */
export function findAcCards(px: Uint8ClampedArray, W: number, H: number): AcCard[] {
  // ⚠ 밝기 임계를 **고정하지 않는다** (2026-09-06 실측). 전체화면 스샷은 밝고 창모드
  //   에뮬레이터 녹화는 어두워서, 110 으로 박으면 어두운 쪽에서 카드 조각만 잡힌다.
  //   오츠(Otsu) 로 화면마다 어두운 UI 와 밝은 카드 아트를 가르는 지점을 직접 찾는다.
  const hist = new Float64Array(256);
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      hist[(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0]++;
    }
  }
  let sum = 0, tot = 0;
  for (let v = 0; v < 256; v++) { sum += v * hist[v]; tot += hist[v]; }
  let wB = 0, sB = 0, bestVar = -1, BRIGHT = 110;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (!wB) continue;
    const wF = tot - wB;
    if (!wF) break;
    sB += v * hist[v];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; BRIGHT = v; }
  }
  // 아주 어두운 화면에서 임계가 바닥으로 내려가면 UI 잡음까지 카드로 본다 — 하한을 둔다
  BRIGHT = Math.max(BRIGHT, 55);
  const minH = Math.max(12, Math.round(H * 0.035));   // 카드 최소 변 (55px 카드도 통과)
  // 행 투영
  const rowP = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x += 2) {        // 2픽셀 스트라이드 — 전수 불필요
      const i = (y * W + x) * 4;
      if (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 > BRIGHT) n++;
    }
    rowP[y] = n / (W / 2);
  }
  // 행 단위로 모은다 — 아래 ⑤ 검사가 **행 통째로** 판정하기 때문
  const rowsOut: { cards: AcCard[]; size: number }[] = [];
  // ⚠ 행 임계를 낮게 (2026-09-06 실측). 카드가 둘뿐인 행은 밝은 픽셀이 화면 폭의 5% 밖에
  //   안 돼서 0.10 이면 통째로 놓친다 (독행 행). 헐거운 행은 아래 열 단계에서 걸러진다 —
  //   카드 크기 조각이 없으면 아무것도 안 나온다.
  for (const [ry0, ry1] of runs(rowP, 0.05, minH)) {
    const rh = ry1 - ry0 + 1;
    if (rh > H * 0.35) continue;            // 너무 두꺼우면 카드 행이 아니다 (배너 등)
    // 이 행 안에서만 열 투영
    const colP = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let y = ry0; y <= ry1; y += 2) {
        const i = (y * W + x) * 4;
        if (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 > BRIGHT) n++;
      }
      colP[x] = n / (rh / 2);
    }
    // ⚠ 임계를 낮게 잡고 **뒤에서 정리**한다 (2026-09-06 실측). 높이면 어두운 아트를 가진
    //   카드를 통째로 놓치고, 낮추면 한 카드가 둘로 쪼개진다 — 쪼개짐은 붙이면 되지만
    //   놓친 카드는 되살릴 수 없으므로 낮게 잡는 쪽이 맞다.
    let segs = runs(colP, 0.10, Math.round(rh * 0.22));
    if (!segs.length) continue;
    // ① 아주 좁은 틈으로 갈라진 조각은 한 카드다 (아트 중앙이 어두운 경우)
    const med = (a: number[]): number => a.slice().sort((p, q) => p - q)[a.length >> 1] || 1;
    let mw = med(segs.map(([s, e]) => e - s + 1));
    const merged: [number, number][] = [];
    for (const s of segs) {
      const last = merged[merged.length - 1];
      if (last && s[0] - last[1] - 1 < mw * 0.25) last[1] = s[1];
      else merged.push([s[0], s[1]]);
    }
    // ② 카드보다 한참 좁은 것은 카드가 아니다 — UI 조각
    mw = med(merged.map(([s, e]) => e - s + 1));
    segs = merged.filter(([s, e]) => e - s + 1 >= mw * 0.5 && e - s + 1 <= rh * 1.6);
    // ③ 맨 앞의 **맹약 아이콘**을 떼어낸다 — 원형 아이콘이 카드와 크기가 비슷해 폭으로는
    //    안 걸린다. 대신 아이콘과 첫 카드 사이 간격이 카드 사이 간격보다 확연히 넓다
    //    (실측 115px vs 60px). 카드가 셋 이상일 때만 — 둘뿐이면 간격 통계를 못 믿는다.
    if (segs.length >= 3) {
      const gaps: number[] = [];
      for (let i = 1; i < segs.length; i++) gaps.push(segs[i][0] - segs[i - 1][1] - 1);
      const inner = med(gaps.slice(1));
      if (gaps[0] > inner * 1.6) segs = segs.slice(1);
    }
    // ④ **카드는 서로 크기가 같다.** 화면 위쪽 제목·카운트다운 글자도 비슷한 높이의 띠를
    //    이뤄 여기까지 올라오는데, 글자는 폭이 제각각이라 이 검사에서 떨어진다
    //    (2026-09-06: f16 헤더가 카드 10장으로 잡히던 것을 이걸로 걷어냈다).
    if (segs.length >= 2) {
      const wm = med(segs.map(([s, e]) => e - s + 1));
      const alike = segs.filter(([s, e]) => Math.abs(e - s + 1 - wm) <= wm * 0.25).length;
      if (alike / segs.length < 0.7) continue;
    }
    const rowCards: AcCard[] = [];
    const rowSizes: number[] = [];
    for (const [cx0, cx1] of segs) {
      const cw = cx1 - cx0 + 1;
      // ⚠ 배지 위치는 **폭으로 잰 높이**를 기준으로 잡는다 (2026-09-06 실측). 행 높이는
      //   아트 아래쪽이 어두우면 짧게 잡히는데(정밀 행 145 vs 실제 177), 그 값으로 좌하단을
      //   찾으면 배지 **위쪽**을 크롭해 티어를 전부 놓친다. 카드는 정사각이라 폭이 더 낫다.
      const ch2 = Math.max(rh, cw);
      const tier = readTier(px, W, H, cx0, ry0, cw, ch2);
      if (tier === null) continue;          // 배지를 못 읽은 카드는 관측에 넣지 않는다
      rowCards.push({ x: cx0 / W, y: ry0 / H, w: cw / W, h: ch2 / H, tier });
      rowSizes.push(cw);
    }
    if (rowCards.length) rowsOut.push({ cards: rowCards, size: med(rowSizes) });
  }
  // ⑤ **행은 일정한 간격으로 늘어선다.** 화면 끝에 걸쳐 잘린 행은 배지가 잘려 티어가 전부
  //    T1 로 읽히는데, 카드 **폭**으로는 안 걸린다 (실측: 잘린 행도 폭 중앙값 179로 정상).
  //    대신 위치가 어긋난다 — 잘린 행의 위끝은 카드 위끝이 아니라 '보이기 시작하는 곳'이라
  //    간격이 깨진다 (실측 265·264·265·265 뒤에 227). 그 격자에서 벗어난 행을 버린다.
  //    스크롤 중에는 위아래가 늘 잘려 있으니 이게 오답을 막는 마지막 관문이다 (2026-09-06).
  if (rowsOut.length < 3) return rowsOut.flatMap((r) => r.cards);
  const ys = rowsOut.map((r) => r.cards[0].y * H);
  const gaps: number[] = [];
  for (let i = 1; i < ys.length; i++) gaps.push(ys[i] - ys[i - 1]);
  const pitch = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1];
  if (!(pitch > 0)) return rowsOut.flatMap((r) => r.cards);
  // 기준선 = 카드가 가장 많은 행 (가장 믿을 만한 행)
  let ref = 0;
  for (let i = 1; i < rowsOut.length; i++) {
    if (rowsOut[i].cards.length > rowsOut[ref].cards.length) ref = i;
  }
  return rowsOut.filter((_, i) => {
    const off = Math.abs(ys[i] - ys[ref]) % pitch;
    return Math.min(off, pitch - off) <= pitch * 0.12;
  }).flatMap((r) => r.cards);
}
