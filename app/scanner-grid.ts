"use client";

// 오퍼 카드 격자 자동 검출 — 스크린샷에서 카드 ROI들을 좌표로 돌려준다 (스펙 §2).
// 원리: 오퍼 목록은 규칙 격자이고 카드 사이 골(어두운 배경 띠)이 주기적으로 나타난다.
//   ① 그레이 다운샘플 → 세로줄 밝기 프로파일(열 합)에서 주기(피치)와 위상(첫 카드 x) 추정
//   ② 가로줄 프로파일로 행 피치·시작 y 추정 (행은 1~3개뿐이라 골 탐색으로)
//   ③ 카드 종횡비 검증(명일방주 리스트 카드 ≈ 0.65)·프레임 경계의 잘린 카드 제외/표시
// 고정 픽셀 좌표 금지 — 모든 산출은 프레임 기준 정규화(0~1)로 반환한다.
// YOLO류 딥러닝 없이 신호처리만 사용. 디버그 모드에서 오버레이용 데이터도 반환.

export type CardRoi = {
  x: number; y: number; w: number; h: number; // 정규화(0~1)
  col: number; row: number;
  truncated: boolean; // 프레임 경계에 걸려 불완전
};
export type GridResult = {
  cards: CardRoi[];
  pitchX: number; pitchY: number; // 정규화 피치 (디버그)
  debug: { colProfile: number[]; rowProfile: number[] };
};

// 자기상관으로 1D 프로파일의 주기 추정 — lag ∈ [minLag,maxLag] 중 상관 최대
function bestPeriod(profile: Float32Array, minLag: number, maxLag: number): { lag: number; score: number } {
  const n = profile.length;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += profile[i];
  mean /= n;
  const d = new Float32Array(n);
  let varSum = 0;
  for (let i = 0; i < n; i += 1) { d[i] = profile[i] - mean; varSum += d[i] * d[i]; }
  if (varSum < 1e-9) return { lag: 0, score: 0 };
  let best = { lag: 0, score: -1 };
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let s = 0;
    for (let i = 0; i + lag < n; i += 1) s += d[i] * d[i + lag];
    const norm = s / varSum;
    if (norm > best.score) best = { lag, score: norm };
  }
  return best;
}

// 주기·프로파일에서 "골(어두운 띠)" 위상 찾기 — pitch 간격으로 접었을 때 최소 밝기 위치
function valleyPhase(profile: Float32Array, pitch: number): number {
  const acc = new Float32Array(pitch);
  const cnt = new Float32Array(pitch);
  for (let i = 0; i < profile.length; i += 1) { const p = i % pitch; acc[p] += profile[i]; cnt[p] += 1; }
  let best = 0, bestV = Infinity;
  for (let p = 0; p < pitch; p += 1) { const v = acc[p] / (cnt[p] || 1); if (v < bestV) { bestV = v; best = p; } }
  return best;
}

// frame(canvas/img/video)에서 카드 격자를 추정한다. 실패(격자 없음) 시 null.
export function detectGrid(frame: CanvasImageSource, fw: number, fh: number): GridResult | null {
  // 분석 해상도 축소 (속도·노이즈 완화)
  const AW = 640;
  const scale = AW / fw;
  const AH = Math.max(8, Math.round(fh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = AW; canvas.height = AH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(frame, 0, 0, fw, fh, 0, 0, AW, AH);
  const { data } = ctx.getImageData(0, 0, AW, AH);
  const gray = new Float32Array(AW * AH);
  for (let i = 0; i < AW * AH; i += 1) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];

  // 중앙 세로 60% 영역(카드 존)만으로 열 프로파일 — 상단 메뉴/하단 바 영향 배제
  const y0 = Math.round(AH * 0.2), y1 = Math.round(AH * 0.8);
  const colProfile = new Float32Array(AW);
  for (let x = 0; x < AW; x += 1) {
    let s = 0;
    for (let y = y0; y < y1; y += 1) s += gray[y * AW + x];
    colProfile[x] = s / (y1 - y0);
  }
  // 카드 폭은 화면 폭의 6~16% 근방(7~8열 + 여백) — 피치 후보 범위
  const px = bestPeriod(colProfile, Math.round(AW * 0.06), Math.round(AW * 0.2));
  if (px.score < 0.25 || px.lag === 0) return null; // 주기성 없음 → 격자 아님
  const pitchX = px.lag;
  const gutterX = valleyPhase(colProfile, pitchX);

  // 행: 가로 프로파일 (카드 존 추정 없이 전체) — 세로 피치는 카드 비율로 유도하되 자기상관으로 보정
  const rowProfile = new Float32Array(AH);
  for (let y = 0; y < AH; y += 1) {
    let s = 0;
    for (let x = 0; x < AW; x += 1) s += gray[y * AW + x];
    rowProfile[y] = s / AW;
  }
  // 카드 높이 ≈ 폭 / 0.65 (명일방주 리스트 카드 비율). 자기상관은 행 2개뿐이면 약해서 비율 우선.
  const expectPitchY = pitchX / 0.65;
  const py = bestPeriod(rowProfile, Math.round(expectPitchY * 0.8), Math.min(AH - 2, Math.round(expectPitchY * 1.25)));
  const pitchY = py.score > 0.2 && py.lag > 0 ? py.lag : Math.round(expectPitchY);
  const gutterY = valleyPhase(rowProfile, pitchY);

  // 격자 열거 — 골 위상에서 시작해 프레임을 채우고, 경계 걸침은 truncated 표시
  const cardW = pitchX * 0.94; // 골 폭 ≈ 피치의 6%
  const cardH = pitchY * 0.96;
  const cards: CardRoi[] = [];
  let row = 0;
  for (let gy = gutterY - pitchY; gy < AH; gy += pitchY) {
    const cy = gy + (pitchY - cardH) / 2;
    if (cy + cardH < AH * 0.08 || cy > AH * 0.98) continue;
    let col = 0;
    for (let gx = gutterX - pitchX; gx < AW; gx += pitchX) {
      const cx = gx + (pitchX - cardW) / 2;
      if (cx + cardW < 0 || cx > AW) continue;
      const truncated = cx < -1 || cy < -1 || cx + cardW > AW + 1 || cy + cardH > AH + 1;
      cards.push({
        x: Math.max(0, cx) / AW,
        y: Math.max(0, cy) / AH,
        w: Math.min(cardW, AW - Math.max(0, cx)) / AW,
        h: Math.min(cardH, AH - Math.max(0, cy)) / AH,
        col, row, truncated,
      });
      col += 1;
    }
    row += 1;
  }
  return {
    cards,
    pitchX: pitchX / AW,
    pitchY: pitchY / AH,
    debug: { colProfile: Array.from(colProfile), rowProfile: Array.from(rowProfile) },
  };
}
