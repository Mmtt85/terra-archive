// 실사 도면 ↔ 타일 격자 정합 — 게임 전투 카메라를 재현한다 (2026-09-23, 사용자 요청
// "실사 도면 위에 적 경로가 표시되고 시뮬레이트 가능하게 하나로").
//
// 실사 도면(arts/ui/stage/mappreviews/<stageId>.png, 512²)은 **전투 카메라로 찍은 16:9 화면을
// 정사각형으로 눌러 담은 그림**이다. 위로 갈수록 좁아지는 원근도, 칸이 가로보다 세로로 길어
// 보이는 것도 이 두 가지로 전부 설명된다:
//   · 카메라 — 레벨마다 위치(view)만 다르고, 기울기 30°·세로 화각 반각 20°는 공통이다
//     (MAA Arknights-Tile-Pos 의 전투 카메라 규약). 위치는 맵 크기로 계산되지 않는다 —
//     같은 11×7 맵도 레벨마다 달라서 레벨별 값이 있어야 한다 (app/data/stage-cams.json).
//   · 눌러 담기 — 16:9 의 정규 좌표를 그대로 정사각 픽셀로 옮긴다 (가로·세로 배율비 16/9).
// 검증 (0-1, view 0,−4.81,−7.76): 맞추는 데 쓰지 않은 바닥 이음새(2행|3행)의 예측이
// y=234.0, 도면에서 가장 어두운 줄이 234 (세 구간 모두). 바닥 이음새 오차 평균 0.5px.
// 1-7(같은 프리셋)·4-4(다른 프리셋)에도 격자를 얹어 도로 이음새·블록·출발/도착 상자가 맞았다.
//
// 좌표 — 격자(gx, gy)는 StageRouteMap SVG 와 같은 규약이다: 왼쪽 위 모서리가 (0,0), 한 칸 = 1,
// row 0 = 위(북쪽). 게임 월드로는 X = gx − w/2 (동쪽+), Y = h/2 − gy (북쪽+), Z = −높이(위가 음수).
// ⚠ 적은 바닥(높이 0)을 걷는다. 고지대 윗면은 바닥보다 약 0.15 높아(0-1 실측) 그 면의
//   모서리는 몇 px 위로 뜬다 — 경로·말은 바닥에 그리므로 신경 쓸 일이 없다.

/** 전투 카메라 위치 (게임 월드 좌표, view[0]) */
export type StageCam = [number, number, number];

/** 실사 도면을 **보여 주는** 가로/세로 비율 — 정사각 원본을 16:9로 편다. 원래 16:9로 찍어
 *  정사각에 눌러 담은 그림이라, 펴면 게임 화면과 같은 비율로 돌아온다 (globals.css .st-map 과 같은 값). */
export const PHOTO_ASPECT = 16 / 9;

const PITCH = (30 * Math.PI) / 180;
const TAN_HALF_FOV = Math.tan((20 * Math.PI) / 180);
const ASPECT = 9 / 16;   // 세로/가로 — 16:9 로 찍었다

/** (gx, gy, 높이) → 도면 위 정규 좌표 [0..1]² (정사각 이미지의 왼쪽 위가 0,0) */
export function stageProjector(cam: StageCam, w: number, h: number) {
  const c = Math.cos(PITCH), s = Math.sin(PITCH);
  return (gx: number, gy: number, up = 0): [number, number] => {
    const X = gx - w / 2 - cam[0], Y = h / 2 - gy - cam[1], Z = -up - cam[2];
    const up2 = c * Y - s * Z;      // 카메라 기준 위쪽 성분
    const depth = s * Y + c * Z;    // 카메라 앞쪽 거리
    return [(1 + (ASPECT / TAN_HALF_FOV) * (X / depth)) / 2, (1 - up2 / TAN_HALF_FOV / depth) / 2];
  };
}
