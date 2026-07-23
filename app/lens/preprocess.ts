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
