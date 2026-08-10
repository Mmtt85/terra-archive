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

import { useMemo } from "react";
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
// 적별 색 — **같은 적은 같은 색, 다른 적은 다른 색** (사용자 확정 2026-08-10).
// 색은 범례(적 얼굴) 순번으로 배정하고 초상 테두리에도 같은 색을 쓴다.
const ROUTE_COLORS = ["#ffd166", "#6ee7b7", "#7ab8ff", "#ff8fab", "#c9a0ff", "#5eead4", "#ffa94d", "#b8e986"];
/** 범례 순번(order) 기준 적 색 — 지도 선과 초상 테두리가 같은 색을 공유한다 */
export function enemyRouteColor(order: string[], id: string): string {
  const k = order.indexOf(id);
  return k >= 0 ? ROUTE_COLORS[k % ROUTE_COLORS.length] : "#9aa0a6";
}

// 지상 이동 가능 타일 — 고지대(w)·금지(f)·구멍(h)은 걷지 못한다
const WALKABLE = new Set(["r", "s", "e"]);

/** 격자 BFS (8방향, 모서리 끊어가기 금지) — 지상 경로가 이동불가 타일을 "뚫고" 직선으로
 *  가로지르지 않게 실제 보행 가능 경로를 찾는다 (사용자 지적 2026-08-10). 게임의 자체
 *  길찾기와 완전히 같지는 않지만 통행 규칙은 지킨다. 못 찾으면 null → 직선 폴백. */
function walkPath(g: string[], w: number, h: number, from: [number, number], to: [number, number]): [number, number][] | null {
  const pass = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && WALKABLE.has(g[y][x]);
  if (!pass(from[0], from[1]) || !pass(to[0], to[1])) return null;
  const key = (x: number, y: number) => y * w + x;
  const prev = new Map<number, number>([[key(from[0], from[1]), -1]]);
  let ring: [number, number][] = [from];
  while (ring.length) {
    const next: [number, number][] = [];
    for (const [x, y] of ring) {
      if (x === to[0] && y === to[1]) {
        const path: [number, number][] = [];
        let k = key(x, y);
        while (k !== -1) { path.push([k % w, Math.floor(k / w)]); k = prev.get(k) ?? -1; }
        return path.reverse();
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (!pass(nx, ny) || prev.has(key(nx, ny))) continue;
        if (dx && dy && (!pass(x + dx, y) || !pass(x, y + dy))) continue;   // 모서리 뚫기 금지
        prev.set(key(nx, ny), key(x, y));
        next.push([nx, ny]);
      }
    }
    ring = next;
  }
  return null;
}

/** 방향이 안 바뀌는 중간 점 제거 — BFS가 뱉는 촘촘한 계단을 짧은 폴리라인으로 */
function simplify(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && i < pts.length - 1) {
      const [ax, ay] = out[out.length - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
      if ((bx - ax) * (cy - by) === (by - ay) * (cx - bx)) continue;   // 일직선이면 건너뜀
    }
    out.push(pts[i]);
  }
  return out;
}

export function StageRouteMap({ data, order, highlights }: {
  data: StageRoutes;
  /** 범례에 보이는 적 id 순서 — 선 색 배정 기준 (stage-detail이 넘겨준다) */
  order: string[];
  highlights?: string[] | null;
}) {
  const { t } = useI18n();
  const { w, h, g, r, f } = data;
  // 강조 대상 경로 번호 — 호버는 한 적, 클릭 고정은 여러 적의 합집합이 온다.
  // 이 지도에 없는 적뿐이면(환경 전환 등) 강조 없음으로 본다.
  let hlRoutes: Set<number> | null = null;
  for (const id of highlights ?? []) {
    for (const ri of data.e[id] ?? []) (hlRoutes ??= new Set()).add(ri);
  }
  const users = new Map<number, string[]>(); // 경로 번호 → 그 경로를 쓰는 적들
  for (const [eid, ris] of Object.entries(data.e)) {
    for (const ri of ris) {
      if (!users.has(ri)) users.set(ri, []);
      users.get(ri)?.push(eid);
    }
  }
  // 완전히 동일한 폴리라인은 하나로 접는다 (사용자 지적 2026-08-10) — 게임 데이터는
  // 스폰마다 같은 경로를 별개 항목으로 두는 일이 많다. 단 **쓰는 적의 조합이 다르면
  // 다른 선**으로 남긴다 (사용자 정정: "서로 다른 적일 경우는 다른 선으로").
  const group = new Map<number, number[]>();   // 대표 경로 번호 → 묶인 번호들
  {
    const canon = new Map<string, number>();
    r.forEach((poly, i) => {
      if (!poly) return;
      const sig = (f[i] ? "F" : "W") + JSON.stringify(poly) + "|" + (users.get(i) ?? []).sort().join(",");
      const c = canon.get(sig);
      if (c === undefined) { canon.set(sig, i); group.set(i, [i]); }
      else group.get(c)?.push(i);
    });
  }
  // 대표 경로의 순번 (겹침 방지 오프셋 배분용 — 접힌 뒤 기준이라 부채꼴이 덜 벌어진다)
  const drawIdx = new Map<number, number>();
  for (const i of group.keys()) drawIdx.set(i, drawIdx.size);
  // 그리기용 폴리라인(격자 좌표계) — 지상(WALK)은 BFS 보행 경로로 확장해 이동불가
  // 타일을 가로지르지 않게 한다. 비행(FLY)은 실제로 지형을 무시하므로 직선 그대로.
  // ⚠ 좌표계 반전이 여기서 일어난다: 타일 행렬은 row 0=위, 경로 좌표는 row 0=아래
  //   (게임 월드 원점이 좌하단 — 2026-08-10 실측, 사용자 제보 "뭔가 뒤집힌 거 같은데").
  const drawPolys = useMemo(() =>
    r.map((poly, i) => {
      if (!poly) return null;
      const wp = poly.map(([c, rr]) => [c, h - 1 - rr] as [number, number]);
      if (f[i]) return wp;
      const out: [number, number][] = [wp[0]];
      for (let k = 1; k < wp.length; k++) {
        const seg = walkPath(g, w, h, out[out.length - 1], wp[k]);
        if (seg) out.push(...seg.slice(1));
        else out.push(wp[k]);   // 경로 탐색 실패(특수 좌표 등)면 직선 폴백
      }
      return simplify(out);
    }), [r, f, g, w, h]);
  const cell = 1;
  return (
    <div className="st-routewrap">
    {/* 지상/비행 선 스타일 범례 — 맵 우상단 (사용자 요청 2026-08-10) */}
    <div className="st-routekey" aria-hidden>
      <span><svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#e8e6df" strokeWidth="2.4" strokeDasharray="9 3.5" /></svg>{t("지상")}</span>
      <span><svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#e8e6df" strokeWidth="2.4" strokeDasharray="2.5 4" /></svg>{t("비행")}</span>
    </div>
    <svg className="st-routemap" viewBox={`0 0 ${w * cell} ${h * cell}`} role="img"
      aria-label={t("적 이동 경로 지도")}>
      {g.map((row, ri) =>
        Array.from(row).map((ch, ci) => (
          <rect key={`${ri}-${ci}`} x={ci * cell + 0.02} y={ri * cell + 0.02}
            width={cell - 0.04} height={cell - 0.04} fill={TILE_FILL[ch] ?? TILE_FILL.r} />
        )))}
      {r.map((poly, i) => {
        const dp = drawPolys[i];
        if (!poly || !dp || !group.has(i)) return null;   // 중복 경로는 대표만 그린다
        // 같은 길을 지나는 경로들이 한 줄로 딱 겹치면 구간마다 색이 바뀌는 것처럼 보인다
        // (사용자 지적 2026-08-10) — 경로 번호마다 대각 미세 오프셋을 줘 나란히 그린다.
        // 간격 0.085타일을 지향하되 **타일 폭(±0.2)은 절대 안 벗어난다** (사용자 지적
        // "다른 타일로 벗어나버리면 안되지" — 경로가 많으면 간격을 줄여서라도 안에 담는다).
        const n = drawIdx.size;
        const step = n > 1 ? Math.min(0.4 / (n - 1), 0.085) : 0;
        const off = ((drawIdx.get(i) ?? 0) - (n - 1) / 2) * step;
        const pts = dp.map(([x, y]) => [x * cell + cell / 2 + off, y * cell + cell / 2 + off] as const);
        // 강조 시: 고른 경로는 굵게, 나머지는 **아주 흐리게** (사용자 확정 2026-08-10 —
        // '굵기만' 안을 써 보고 겹침이 심해 흐림 방식으로 되돌림). 평소엔 전부 보통.
        const em = hlRoutes ? (group.get(i) ?? []).some((j) => hlRoutes.has(j)) : false;
        // 색은 이 경로를 쓰는 첫 적(범례 순)의 색 — 여러 적이 공유하는 경로는 앞선 적을 따른다
        const ord = (id: string) => { const k = order.indexOf(id); return k < 0 ? 999 : k; };
        const owner = (users.get(i) ?? []).slice().sort((a, b) => ord(a) - ord(b))[0];
        const color = owner ? enemyRouteColor(order, owner) : "#9aa0a6";
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
    </div>
  );
}
