"use client";

// 적 이동 경로 격자 지도 — 작전 상세의 '이동 경로' 탭 (사용자 요청 2026-08-10).
//
// 3D 실사 도면 위에는 경로를 못 얹는다(원근 렌더·카메라값 없음) — 레벨 파일의 타일
// 격자를 SVG로 그리고 그 위에 경로 폴리라인을 겹친다. 격자 방향은 scripts/build-rogue.py
// render_minimap과 같은 row 0 = 위 (실사 미리보기와 육안 대조로 확인된 규약).
// 데이터는 app/data/stage-routes.json — 3MB가 넘으므로 **탭을 눌렀을 때만** 지연 로드
// 한다 (stage-detail.tsx가 import()로 가져와 여기 props로 준다).
//
// 상호작용: 적 칩/범례에 호버(데스크탑)·탭(모바일)하면 그 적의 경로만 강조.

import { useI18n } from "./i18n";

/** scripts/build-enemies.py routes_of 산출 — g는 행 문자열(row 0 = 위), r은 [col,row] 꼭짓점 */
export type StageRoutes = {
  h: number; w: number; g: string[];
  r: ([number, number][] | null)[];
  f: number[];
  e: Record<string, number[]>;
};

// 타일 팔레트 — 통전 render_minimap의 TILE_COLORS 톤을 따른다 (밝음=고지대)
const TILE_FILL: Record<string, string> = {
  s: "#a03434",   // 적 출현 (게임 표기 빨강)
  e: "#2f5f9e",   // 방어 목표 (게임 표기 파랑)
  w: "#8a8892",   // 고지대
  r: "#54525c",   // 지상
  f: "#2c2a32",   // 배치·통행 불가
  h: "#1c1a22",   // 구멍
};
// 경로 색 — 서로 겹쳐도 갈리도록 명도·색상 분산
const ROUTE_COLORS = ["#ffd166", "#6ee7b7", "#7ab8ff", "#ff8fab", "#c9a0ff", "#5eead4", "#ffa94d", "#b8e986"];

export function StageRouteMap({ data, highlight }: { data: StageRoutes; highlight?: string | null }) {
  const { t } = useI18n();
  const { w, h, g, r, f } = data;
  // 강조 대상 경로 번호 — 강조가 없거나(환경 전환 등으로) 이 지도에 없는 적이면 전부 보통 세기
  const hlRoutes = highlight && data.e[highlight]?.length ? new Set(data.e[highlight]) : null;
  // 완전히 동일한 폴리라인은 하나로 접는다 (사용자 지적 2026-08-10) — 게임 데이터는
  // 스폰마다 같은 경로를 별개 항목으로 두는 일이 많다. 강조 판정은 묶음 전체로 본다.
  const group = new Map<number, number[]>();   // 대표 경로 번호 → 묶인 번호들
  {
    const canon = new Map<string, number>();
    r.forEach((poly, i) => {
      if (!poly) return;
      const sig = (f[i] ? "F" : "W") + JSON.stringify(poly);
      const c = canon.get(sig);
      if (c === undefined) { canon.set(sig, i); group.set(i, [i]); }
      else group.get(c)?.push(i);
    });
  }
  // 대표 경로의 순번 (겹침 방지 오프셋 배분용 — 접힌 뒤 기준이라 부채꼴이 덜 벌어진다)
  const drawIdx = new Map<number, number>();
  for (const i of group.keys()) drawIdx.set(i, drawIdx.size);
  const cell = 1;
  return (
    <svg className="st-routemap" viewBox={`0 0 ${w * cell} ${h * cell}`} role="img"
      aria-label={t("적 이동 경로 지도")}>
      {g.map((row, ri) =>
        Array.from(row).map((ch, ci) => (
          <rect key={`${ri}-${ci}`} x={ci * cell + 0.02} y={ri * cell + 0.02}
            width={cell - 0.04} height={cell - 0.04} fill={TILE_FILL[ch] ?? TILE_FILL.r} />
        )))}
      {r.map((poly, i) => {
        if (!poly || !group.has(i)) return null;   // 중복 경로는 대표만 그린다
        // 같은 길을 지나는 경로들이 한 줄로 딱 겹치면 구간마다 색이 바뀌는 것처럼 보인다
        // (사용자 지적 2026-08-10) — 경로 번호마다 대각 미세 오프셋을 줘 나란히 그린다.
        const off = drawIdx.size > 1 ? ((drawIdx.get(i) ?? 0) / (drawIdx.size - 1) - 0.5) * 0.3 : 0;
        // ⚠ 좌표계가 서로 다르다 (2026-08-10 실측, 사용자 제보 "뭔가 뒤집힌 거 같은데"):
        //   타일 행렬은 row 0 = **위**(render_minimap·실사 도면과 일치)인데, 경로 좌표는
        //   row 0 = **아래**(게임 월드 원점이 좌하단)다. main_11-12에서 출현 타일은 g[0],
        //   경로 시작은 row 7(=h-1) — 경로만 상하를 뒤집어야 도착점이 파란 박스에 앉는다.
        const pts = poly.map(([c, rr]) => [c * cell + cell / 2 + off, (h - 1 - rr) * cell + cell / 2 + off] as const);
        // 강조 시: 고른 경로는 굵게, 나머지는 **아주 흐리게** (사용자 확정 2026-08-10 —
        // '굵기만' 안을 써 보고 겹침이 심해 흐림 방식으로 되돌림). 평소엔 전부 보통.
        const em = hlRoutes ? (group.get(i) ?? []).some((j) => hlRoutes.has(j)) : false;
        const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2] ?? pts[0];
        const ang = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
        const a = 0.28; // 화살촉 크기 (타일 단위)
        const tip: [number, number][] = [
          [last[0] + Math.cos(ang) * a, last[1] + Math.sin(ang) * a],
          [last[0] + Math.cos(ang + 2.5) * a, last[1] + Math.sin(ang + 2.5) * a],
          [last[0] + Math.cos(ang - 2.5) * a, last[1] + Math.sin(ang - 2.5) * a],
        ];
        return (
          <g key={i} opacity={hlRoutes && !em ? 0.07 : 0.92}>
            {/* 대시가 진행 방향으로 흐른다(CSS 애니메이션) — 방향 표시 겸 움직임 (사용자 요청).
                지상은 긴 대시, 비행은 점선으로 구분. 패턴 길이(0.64·0.32)는 keyframe
                오프셋(-0.64)의 약수라 둘 다 끊김 없이 순환한다. */}
            <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={color}
              strokeWidth={em ? 0.12 : 0.042} strokeLinejoin="round" strokeLinecap="round"
              strokeDasharray={f[i] ? "0.12 0.2" : "0.5 0.14"} />
            <circle cx={pts[0][0]} cy={pts[0][1]} r={0.16} fill={color} />
            <polygon points={tip.map((p) => p.join(",")).join(" ")} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}
