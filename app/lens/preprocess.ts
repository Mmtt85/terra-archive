// 스크린샷 렌즈 — OCR 전처리 (브라우저·verify-lens 하네스 공용 순수 함수).
// 스모크 검증(2026-07-23, fixtures/lens f1~f4)으로 확정된 파라미터:
// 2x 업스케일 + 그레이스케일 + 대비 정규화(min-max 스트레치)가 PSM11 인식률을 크게 올린다.

/** RGBA 픽셀 버퍼를 제자리에서 그레이스케일 + 대비 정규화한다. */
export function grayNormalize(data: Uint8ClampedArray | Uint8Array): void {
  const n = data.length;
  // 1패스: 휘도 계산 + min/max
  let min = 255, max = 0;
  for (let i = 0; i < n; i += 4) {
    const y = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    // 알파 채널을 휘도 임시 저장소로 쓰지 않고 R에 기록 (알파는 유지)
    data[i] = y;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const range = Math.max(1, max - min);
  // 2패스: 스트레치 후 RGB 동일값
  for (let i = 0; i < n; i += 4) {
    const v = Math.round(((data[i] - min) * 255) / range);
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

/** 업스케일 배율 — 폭 2000px 미만(비레티나 캡처)이면 2x, 이미 크면 원본 유지. */
export function upscaleFactor(width: number): number {
  return width < 2000 ? 2 : 1;
}

export type ChipBox = { x: number; y: number; w: number; h: number };

/**
 * 밝은 배경 위 고립된 어두운 버튼(칩) 사각형 검출 — 공개모집 태그 버튼처럼
 * 흰 페이지 위 검은 버튼은 테서랙트 페이지 세그멘테이션이 통째로 버리므로
 * (f5 재현: 전체 OCR 0개 vs 버튼 단독 크롭 97%), 여기서 찾아 개별 PSM7 OCR한다.
 * 입력은 grayNormalize를 거친 RGBA(휘도가 R에 있음). 다운스케일 그리드에서 BFS로
 * 어두운 연결 성분을 찾고, 버튼다운 기하(크기·종횡비·채움비)만 통과시킨다.
 */
export function findDarkChips(data: Uint8ClampedArray | Uint8Array, W: number, H: number): ChipBox[] {
  const s = Math.max(1, Math.floor(W / 360)); // 그리드 셀 한 변 (px)
  const gw = Math.floor(W / s), gh = Math.floor(H / s);
  const dark = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      // 셀 대표값: 중심 픽셀 (셀이 작아 평균 대신 충분)
      const px = Math.min(W - 1, gx * s + (s >> 1));
      const py = Math.min(H - 1, gy * s + (s >> 1));
      if (data[(py * W + px) * 4] < 115) dark[gy * gw + gx] = 1;
    }
  }
  const seen = new Uint8Array(gw * gh);
  const boxes: ChipBox[] = [];
  const qx = new Int32Array(gw * gh), qy = new Int32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i0 = gy * gw + gx;
      if (!dark[i0] || seen[i0]) continue;
      // BFS
      let head = 0, tail = 0, count = 0;
      let minX = gx, maxX = gx, minY = gy, maxY = gy;
      qx[tail] = gx; qy[tail] = gy; tail++; seen[i0] = 1;
      while (head < tail) {
        const cx = qx[head], cy = qy[head]; head++; count++;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const ni = ny * gw + nx;
          if (dark[ni] && !seen[ni]) { seen[ni] = 1; qx[tail] = nx; qy[tail] = ny; tail++; }
        }
      }
      const bw = (maxX - minX + 1) * s, bh = (maxY - minY + 1) * s;
      const fill = count / ((maxX - minX + 1) * (maxY - minY + 1));
      const aspect = bw / bh;
      // 버튼다운 기하: 폭 4~35%W, 높이 2.5~12%H, 종횡비 1.3~9, 채움비 ≥0.5
      if (bw >= W * 0.04 && bw <= W * 0.35 && bh >= H * 0.025 && bh <= H * 0.12
        && aspect >= 1.3 && aspect <= 9 && fill >= 0.5) {
        boxes.push({ x: minX * s, y: minY * s, w: bw, h: bh });
      }
    }
  }
  // 읽기 순서(위→아래, 왼→오른쪽), 과도 검출 방어 상한
  boxes.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return boxes.slice(0, 20);
}

/**
 * 칩 박스를 버튼 내부로 인셋한 크롭 좌표. ⚠ 바깥 패딩 금지 — 흰 여백이 들어가면
 * 테서랙트 이진화 극성이 뒤집혀 0%가 된다 (f5 실측: 패드 18px → "" / 인셋 → 96%).
 * 그리드 오차(셀 한 변 s px)만큼 안쪽으로 파고든다.
 */
export function chipCropRect(b: ChipBox, W: number, H: number): ChipBox | null {
  const s = Math.max(1, Math.floor(W / 360));
  const inset = s + 2;
  const x = b.x + inset, y = b.y + inset;
  const w = b.w - inset * 2, h = b.h - inset * 2;
  if (w < 24 || h < 14) return null;
  return { x, y, w: Math.min(w, W - x), h: Math.min(h, H - y) };
}
