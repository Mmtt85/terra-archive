// 위수 협의 밴 목록 **맹약 아이콘** 매칭 — 순수 계산 코어 (React·DOM·sharp 무의존, 2026-09-07).
// 브라우저(PRTS 시뮬레이션 브리지)와 node 회귀 하네스(scripts/verify-ac/bond.ts)가 같은 함수를 쓴다.
//
// 무엇을 위한 것인가 — **두 가지를 한 번에 한다**:
//   ① 게이트. findAcRows 가 낸 행이 진짜 밴 행인지 확정한다. 밴 격자는 카드 우상단의 빨간 금지 표식만
//      보므로 전투 화면의 붉은 UI를 카드로 착각한다 (2026-09-07 사용자 신고 "밴 리스트 인식이 뭔 모든
//      상황에서 계속 되냐"). 행 왼쪽 맹약 아이콘이 23종 중 하나로 붙어야 밴 행이다.
//   ② 라벨. 그 행이 어느 맹약 줄인지 곧바로 안다 — 얼굴로 푼 기물들의 공통 맹약을 역산하던 것보다
//      직접적이고, 밴 리스트를 맹약별로 묶는 UI(사용자 요청 2026-09-07)의 근거가 된다.
//
// 측정으로 확정된 방법 (2026-09-07, v1·v2 픽스처 900px 브리지 판 + 전체화면 스샷 ban1/ban2):
//  [템플릿] public/ac/bond/<bondId>.webp 23개. ⚠ 에셋은 **흰 글리프만 투명 배경에 bbox 타이트 크롭**한
//      것이고(100~107 × 93~107, 크기·종횡비가 제각각) 게임 안 아이콘은 같은 글리프가 **어두운 청록 원판**
//      안에 있다. 원판은 에셋에 없다. 그래서 acband 의 bandTemplate 을 쓰면 안 된다 — BAND_INSET 0.12 가
//      이미 타이트한 글리프를 깎아 같은 자리 점수가 최저 0.29 까지 떨어진다. **정사각 레터박스 · inset 0** 이 정답.
//      resampleRgb 는 sw≠sh 면 늘려 버리므로 정사각화가 필수다 (안 하면 최대 7% 왜곡).
//  [특징] Sobel(gx,gy) 부호 있는 2채널 ZNCC, N=32 — acband 와 같다. 소벨이 상수 배경을 지우고 znorm 이
//      대비를 정규화하므로 원판 색·배경색은 문제되지 않는다.
//  [기하] 1위 창의 실측(양성 95행): 글리프 변 / icon.d = 0.463~0.519(중앙 0.492) → 3스케일 0.47·0.50·0.53.
//      글리프 중심 − icon 중심 = dx/d −0.184~+0.094 · dy/d −0.132~+0.072 — **맹약마다 다르다**(에셋이 bbox
//      크롭이라 원판 안 글리프의 시각 중심이 맹약별로 어긋난다). 그래서 탐색 영역을 좁히면 무너진다:
//      ρ=0.7 은 ±3px 지터에서 92/95, ρ=0.6 은 사르곤→독행 오답. **ρ=0.8(허용 평행이동 ±0.235·d)** 이 필요하다.
//      크기 봉우리는 좁다 — 글리프/d 를 0.35 나 0.65 로 잡으면 6/13·5/13 으로 즉사한다.
//  [실측] 양성 = 밴 프레임 33장의 검출된 행 **95개 전부** 1순위 정답(100%), 점수 0.830~0.966(중앙 0.899),
//      마진 0.210~0.664. ±3px 지터 7종에서도 95/95 (최저 0.808).
//      음성 = 밴 구간 밖 84프레임의 오탐 행 149개 → 70행은 아이콘 자리가 평탄해 점수 자체가 안 나오고(null),
//      나머지 79행은 최고 **0.431**. 지터를 줘도 0.437 을 안 넘는다.
//      **틈: 0.437 ~ 0.808 (폭 0.37).** 문턱을 0.55~0.80 어디에 둬도 양성 95/95 · 음성 0 이 유지된다.
//      전체화면 스샷(제3의 캡처, 2388×1668)도 6행 전부 정답 (염국 0.902 · 쉐라그 0.972 · 정밀 0.963 …).
//      속도: 23템플릿 로딩 35~65ms(한 번), 행당 ≈71ms — 밴 프레임 한 장 ≈206ms.
//      ⚠ 1스케일(0.49)은 v1·v2 만 보면 충분한데(양성 최저 0.805) ban2.jpg 염국이 0.662 로 떨어진다 —
//      캡처 소스가 늘면 배율 여유가 필요하다는 증거다. 3스케일을 쓴다.
//  [미검증] 픽스처에 안 나온 맹약 7종 — 빅토리아·신속·조력·투자자·조화·협동방어·궁극기. 23템플릿 상호
//      최대 ZNCC 가 0.515(에기르↔기습)로 문턱 0.62 아래라는 상한만 있고 실측은 없다.
//      게임 안 원판 우상단에는 에셋에 없는 인원수 배지가 원을 살짝 덮는데, 글리프가 0.49·d 뿐이라
//      창 밖에 남아 실측 피해는 0 이었다 (탐색 창을 키우면 이게 들어와 점수를 깎는다).
//
// 좌표는 전부 0~1 정규화. 크롭·축소는 pix.ts(resampleRgb)로만 한다 — canvas/sharp 보간 차이로 특징이
// 갈라지지 않게 (acband·acface 와 같은 규약).

import { BAND_INSET, BAND_N, gradFeature, searchBand, type BandHit, type BandRect } from "./acband";
import { resampleRgb, type Raster } from "./pix";

/** 아이콘 자리(AcRow.icon.d) 대비 탐색 정사각의 변 — 0.8 미만은 지터에서 무너진다 (위 [기하]) */
export const BOND_RHO = 0.8;
/** 훑는 글리프 변 / icon.d — 실측 0.463~0.519 를 덮는 3스케일 */
export const BOND_GLYPH = [0.47, 0.50, 0.53];
/** 판정 문턱 — 실측 틈(음성 0.437 ~ 양성 0.808)의 한가운데. margin 은 2차 안전장치다 */
export const BOND_ACCEPT = { score: 0.62, margin: 0.10 };
/** searchBand 의 scale 인자 — 그쪽이 아이콘 변을 (1−2·inset)×rect변×scale 로 잡으므로 되돌려 준다 */
export const BOND_SCALES = BOND_GLYPH.map((g) => g / ((1 - 2 * BAND_INSET) * BOND_RHO));

/**
 * 맹약 아이콘(public/ac/bond/<id>.webp, RGBA) → 검은 배경 합성·**정사각 레터박스**·32×32 → gradFeature.
 * ⚠ inset 을 주지 마라 — 에셋이 이미 글리프 bbox 타이트 크롭이다 (위 [템플릿]).
 */
export function bondTemplate(icon: Raster): Float32Array {
  const { width: w, height: h } = icon;
  const side = Math.max(w, h);
  const rgb = resampleRgb(icon, w / 2 - side / 2, h / 2 - side / 2, side, side, BAND_N, [0, 0, 0]);
  return gradFeature(rgb, BAND_N);
}

/** AcRow.icon(정규화, d 는 W 기준) → searchBand 에 넘길 정사각 영역 (화면 픽셀로 정사각) */
export function bondIconRect(icon: { cx: number; cy: number; d: number }, W: number, H: number): BandRect {
  const side = BOND_RHO * icon.d;                 // W 기준 정규화 변
  return { x: icon.cx - side / 2, y: icon.cy - (side * W) / H / 2, w: side, h: (side * W) / H };
}

/**
 * 행 왼쪽 맹약 아이콘을 23종 템플릿과 맞춘다. 점수는 원시값 — 판정은 호출자가 BOND_ACCEPT 로 한다
 * (아이콘 자리가 평탄하면 null: 창의 그래디언트 분산이 0 이라 ZNCC 가 정의되지 않는다 = 밴 행이 아니다).
 */
export function matchBondIcon(px: Uint8ClampedArray, W: number, H: number,
  icon: { cx: number; cy: number; d: number }, tpl: Map<string, Float32Array>): BandHit | null {
  return searchBand(px, W, H, bondIconRect(icon, W, H), tpl, { scales: BOND_SCALES, step: 1 });
}

/** BOND_ACCEPT 를 넘으면 맹약 id, 아니면 null — 호출부가 매번 두 조건을 적지 않게 */
export function bondOfHit(hit: BandHit | null): string | null {
  return hit && hit.score >= BOND_ACCEPT.score && hit.margin >= BOND_ACCEPT.margin ? hit.band : null;
}
