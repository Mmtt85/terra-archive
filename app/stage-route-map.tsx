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

// 타일 팔레트 — 통행·배치 속성 분류 (사용자 요청 2026-08-10 "다 구분 가능하게").
// 분류 기준은 scripts/build-enemies.py routes_of의 tchar 주석 참조.
// 색조를 입혀 회색끼리 안 헷갈리게 (사용자 지적 2026-08-10 "죄다 회색계열이라").
const TILE_FILL: Record<string, string> = {
  s: "#a03434",   // 적 출현 (게임 표기 빨강)
  e: "#2f5f9e",   // 방어 목표 (게임 표기 파랑)
  r: "#56535d",   // 도로 — 이동 + 지상 배치 (중립 회색)
  p: "#3d5a63",   // 이동 가능·배치 불가 (청록끼)
  b: "#71603f",   // 지상 배치 가능·이동 불가 (황토끼 — 펜스류)
  w: "#8a8892",   // 고지대 — 원거리 배치 (밝은 회색, 실사 도면과 같은 감각)
  x: "#4d4160",   // 고지형 이동·배치 불가 (보라끼)
  f: "#3b322c",   // 장애물 — 이동·배치 불가 (갈색끼 어두움)
  h: "#10141c",   // 구멍 — 비행만 통과 (가장 어두움)
  i: "#b06a2a",   // 통로 입구 — 게임의 주황 화살표 (사용자 제보 2026-08-10)
  o: "#d18f3f",   // 통로 출구
};
// 타일 범례 — 라벨 자체가 설명이 되게 (사용자 지적 2026-08-10 "'배치만'은 또 뭔데")
const TILE_LABELS: [string, string, string][] = [
  ["s", "적 출현", "적이 나타나는 곳입니다"],
  ["e", "방어 지점", "적이 도달하면 안 되는 곳입니다"],
  ["r", "도로", "적 이동 가능 · 지상 오퍼레이터 배치 가능"],
  ["p", "이동 가능·배치 불가", "적은 지나가지만 오퍼레이터는 배치할 수 없습니다"],
  ["b", "지상 배치 가능·이동 불가", "적은 못 지나가지만 지상 오퍼레이터는 배치할 수 있습니다"],
  ["w", "고지대(원거리 배치)", "적 이동 불가 · 원거리 오퍼레이터 배치 가능"],
  ["x", "고지형(이동·배치 불가)", "높은 지형 — 적 이동도 오퍼레이터 배치도 불가합니다"],
  ["f", "장애물(이동·배치 불가)", "적 이동도 오퍼레이터 배치도 불가합니다"],
  ["h", "구멍(비행만 통과)", "비행 적만 지나갈 수 있습니다"],
  ["i", "통로 입구", "적이 여기로 들어가 통로 출구로 순간이동합니다"],
  ["o", "통로 출구", "통로 입구로 들어간 적이 여기서 나옵니다"],
];
// 적별 색 — **같은 적은 같은 색, 다른 적은 다른 색** (사용자 확정 2026-08-10).
// 색은 범례(적 얼굴) 순번으로 배정하고 초상 테두리에도 같은 색을 쓴다.
const ROUTE_COLORS = ["#ffd166", "#6ee7b7", "#7ab8ff", "#ff8fab", "#c9a0ff", "#5eead4", "#ffa94d", "#b8e986"];
/** 범례 순번(order) 기준 적 색 — 지도 선과 초상 테두리가 같은 색을 공유한다 */
export function enemyRouteColor(order: string[], id: string): string {
  const k = order.indexOf(id);
  return k >= 0 ? ROUTE_COLORS[k % ROUTE_COLORS.length] : "#9aa0a6";
}

// 지상 이동 가능 타일 — 도로(r)·통행(p)·출현(s)·방어(e)·통로(i/o). 나머지는 걷지 못한다
const WALKABLE = new Set(["r", "p", "s", "e", "i", "o"]);

/** 격자 BFS (8방향, 모서리 끊어가기 금지) — 지상 경로가 이동불가 타일을 "뚫고" 직선으로
 *  가로지르지 않게 실제 보행 가능 경로를 찾는다 (사용자 지적 2026-08-10). **통로 입구(i)
 *  에선 모든 출구(o)로 순간이동 간선**이 있다 — 11-2처럼 통로 너머로 이어지는 경로가
 *  고지형을 뚫는 직선으로 그려지던 문제의 해법. 못 찾으면 null → 직선 폴백. */
function walkPath(g: string[], w: number, h: number, from: [number, number], to: [number, number]): [number, number][] | null {
  const pass = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && WALKABLE.has(g[y][x]);
  if (!pass(from[0], from[1]) || !pass(to[0], to[1])) return null;
  const outs: [number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (g[y][x] === "o") outs.push([x, y]);
  const key = (x: number, y: number) => y * w + x;
  const prev = new Map<number, number>([[key(from[0], from[1]), -1]]);
  let ring: [number, number][] = [from];
  while (ring.length) {
    const next: [number, number][] = [];
    const push = (nx: number, ny: number, fx: number, fy: number) => {
      if (!pass(nx, ny) || prev.has(key(nx, ny))) return;
      prev.set(key(nx, ny), key(fx, fy));
      next.push([nx, ny]);
    };
    for (const [x, y] of ring) {
      if (x === to[0] && y === to[1]) {
        const path: [number, number][] = [];
        let k = key(x, y);
        while (k !== -1) { path.push([k % w, Math.floor(k / w)]); k = prev.get(k) ?? -1; }
        return path.reverse();
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        if (dx && dy && (!pass(x + dx, y) || !pass(x, y + dy))) continue;   // 모서리 뚫기 금지
        push(x + dx, y + dy, x, y);
      }
      if (g[y][x] === "i") for (const [ox, oy] of outs) push(ox, oy, x, y);   // 통로 순간이동
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
  // 강조 대상 적 — 호버는 한 적, 클릭 고정은 여러 적의 합집합이 온다.
  // 이 지도에 없는 적뿐이면(환경 전환 등) 강조 없음으로 본다.
  let hl: Set<string> | null = null;
  for (const id of highlights ?? []) {
    if (data.e[id]?.length) (hl ??= new Set()).add(id);
  }
  // 그리기용 폴리라인(격자 좌표계) — 지상(WALK)은 BFS 보행 경로로 확장해 이동불가
  // 타일을 가로지르지 않게 한다. 비행(FLY)은 실제로 지형을 무시하므로 직선 그대로.
  // ⚠ 좌표계 반전이 여기서 일어난다: 타일 행렬은 row 0=위, 경로 좌표는 row 0=아래
  //   (게임 월드 원점이 좌하단 — 2026-08-10 실측, 사용자 제보 "뭔가 뒤집힌 거 같은데").
  const polys = useMemo(() =>
    r.map((poly, i) => {
      if (!poly) return null;
      const wp = poly.map(([c, rr]) => [c, h - 1 - rr] as [number, number]);
      if (f[i]) return { segs: [{ pts: wp, hop: false }], dense: wp };
      const out: [number, number][] = [wp[0]];
      for (let k = 1; k < wp.length; k++) {
        const seg = walkPath(g, w, h, out[out.length - 1], wp[k]);
        if (seg) out.push(...seg.slice(1));
        else out.push(wp[k]);   // 경로 탐색 실패(특수 좌표 등)면 직선 폴백
      }
      // 순간이동(통로) 지점 = 인접하지 않은 연속 칸 — 구간을 끊고 hop으로 표시해
      // 가는 선 점선으로만 잇는다. dense = 밟는 타일 전부 (경로 동일성 비교용).
      const segs: { pts: [number, number][]; hop: boolean }[] = [];
      let cur: [number, number][] = [out[0]];
      for (let k = 1; k < out.length; k++) {
        const [ax, ay] = out[k - 1], [bx, by] = out[k];
        if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) > 1) {
          if (cur.length > 1) segs.push({ pts: simplify(cur), hop: false });
          segs.push({ pts: [out[k - 1], out[k]], hop: true });
          cur = [out[k]];
        } else cur.push(out[k]);
      }
      if (cur.length > 1 || segs.length === 0) segs.push({ pts: simplify(cur), hop: false });
      return { segs, dense: out };
    }), [r, f, g, w, h]);
  const drawPolys = polys.map((p) => (p ? p.segs.flatMap((s) => s.pts) : null));
  // 같은 경로(기하) 판정 — 게임 데이터는 같은 길을 스폰마다 복제하며 경유점만 덜/더
  // 명시하는 지터가 섞여 있어, 먼저 경로 번호들을 **기하 단위 묶음**으로 접는다
  // (11-19 실측으로 확정): ① 원본 경유점열이 완전히 같다, 또는 ② 출발·도착·비행이
  // 같고 밟는 타일 차이가 2칸 이하(지터). 진짜 다른 궤적(11-19 전사의 윗길/오른길)은
  // 안 걸려 남는다. 이 묶음은 **한 적 안에서** 중복 인덱스·지터 복제를 한 줄로 만드는
  // 용도다 (11-12 실측: 왕정군 전사 단독 등록 + 전사·부패의 전사 공용 등록이 같은 길).
  // 서로 다른 적끼리 합치는 게 아니다 — 선 자체는 아래에서 **적 단위**로 그린다.
  const group = new Map<number, number[]>();   // 대표 경로 번호 → 묶인 번호들
  {
    const byRaw = new Map<string, number>();
    r.forEach((poly, i) => {
      if (!poly || !drawPolys[i]) return;
      const k = (f[i] ? "F" : "W") + JSON.stringify(poly);
      const c = byRaw.get(k);
      if (c === undefined) { byRaw.set(k, i); group.set(i, [i]); }
      else group.get(c)?.push(i);
    });
    // 같은 경로 판정 (사용자 기대 결과로 역산 — 11-19 전사 4변형 실측):
    // 두 경로가 **밟는 타일의 차이가 2칸 이하**면 같은 경로다. 같은 복도를 스폰마다
    // 한 칸 엇갈려 짜는 지터는 차이 1~2칸이라 접히고, 위로 가는 길 vs 오른쪽으로
    // 가는 길처럼 복도 자체가 다르면 차이 4칸 이상이라 남는다.
    const sameRoute = (A: [number, number][], B: [number, number][]) => {
      const sa = new Set(A.map((p) => `${p[0]},${p[1]}`));
      const sb = new Set(B.map((p) => `${p[0]},${p[1]}`));
      let d = 0;
      for (const k of sa) if (!sb.has(k)) d++;
      for (const k of sb) if (!sa.has(k)) d++;
      return d <= 2;
    };
    // 접힘이 접힘을 부를 수 있어(추이적) 변화가 없을 때까지 반복한다
    let changed = true;
    while (changed) {
      changed = false;
      const reps = [...group.keys()];
      for (const x of reps) {
        for (const y of reps) {
          if (x === y || !group.has(x) || !group.has(y)) continue;
          if (f[x] !== f[y]) continue;
          const a = r[x], b = r[y], pa = polys[x], pb = polys[y];
          if (!a || !b || !pa || !pb) continue;
          const sameEnds = a[0][0] === b[0][0] && a[0][1] === b[0][1]
            && a[a.length - 1][0] === b[b.length - 1][0] && a[a.length - 1][1] === b[b.length - 1][1];
          if (sameEnds && sameRoute(pa.dense, pb.dense)) {
            const keep = b.length >= a.length ? y : x;   // 상세한(경유점 많은) 쪽을 대표로
            const drop = keep === y ? x : y;
            group.get(keep)?.push(...(group.get(drop) ?? []));
            group.delete(drop);
            changed = true;
          }
        }
      }
    }
  }
  // 그리는 선은 **적 단위다** (사용자 확정 2026-08-10, 7번째 지적: "서로 다른 적이 같은
  // 경로라고 해서 한 선으로 합쳐지면 안된다"): 적마다 자기가 쓰는 기하 묶음을 자기 색으로
  // 한 줄씩 그린다 — 0-2처럼 원석충·병사가 같은 복도를 걸으면 노랑·초록 두 줄이 나란히
  // 간다. 같은 적 + 같은 기하 = 한 줄, 같은 적 + 다른 기하 = 같은 색 다른 줄(어긋나게),
  // 다른 적 = 기하가 같아도 **항상 별도 줄**. 강조 색 문제(16-2)도 이 구조에선 안 생긴다.
  const classOf = new Map<number, number>();   // 경로 번호 → 소속 묶음 대표
  for (const [rep, members] of group) for (const m of members) classOf.set(m, rep);
  const lines: { rep: number; owner: string | null }[] = [];
  const usedClasses = new Set<number>();
  for (const id of order) {                    // 범례 순 — 색·겹침 순서가 안정된다
    const reps = new Set<number>();
    for (const ri of data.e[id] ?? []) {
      const rep = classOf.get(ri);
      if (rep !== undefined) reps.add(rep);
    }
    for (const rep of reps) { lines.push({ rep, owner: id }); usedClasses.add(rep); }
  }
  // 등장 적 목록 밖(숨은 증원 등)만 쓰는 경로 — 회색 한 벌로 남긴다
  for (const rep of group.keys()) if (!usedClasses.has(rep)) lines.push({ rep, owner: null });
  const cell = 1;
  return (
    <div className="st-routewrap">
    {/* 지상/비행 선 스타일 범례 — 지도 **바깥** 오른쪽 위 (사용자 정정 2026-08-10) */}
    <div className="st-routekey" aria-hidden>
      <span><svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="currentColor" strokeWidth="2.4" strokeDasharray="9 3.5" /></svg>{t("지상")}</span>
      <span><svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="currentColor" strokeWidth="2.4" strokeDasharray="2.5 4" /></svg>{t("비행")}</span>
    </div>
    <svg className="st-routemap" viewBox={`0 0 ${w * cell} ${h * cell}`} role="img"
      aria-label={t("적 이동 경로 지도")}>
      {g.map((row, ri) =>
        Array.from(row).map((ch, ci) => (
          <rect key={`${ri}-${ci}`} x={ci * cell + 0.02} y={ri * cell + 0.02}
            width={cell - 0.04} height={cell - 0.04} fill={TILE_FILL[ch] ?? TILE_FILL.r} />
        )))}
      {lines.map(({ rep, owner }, li) => {
        // 묶음 중 **경유점이 가장 많은** 변형의 모양을 그린다 — 체크포인트가 명시된
        // 쪽이 게임이 의도한 궤적에 가장 가깝다
        const members = group.get(rep) ?? [rep];
        const best = members.reduce((a, b) => ((drawPolys[b]?.length ?? 0) > (drawPolys[a]?.length ?? 0) ? b : a), rep);
        const P = polys[best];
        if (!P) return null;
        // 선마다 대각 미세 오프셋 — 같은 길을 걷는 다른 적들이 나란히 보이게.
        // 간격 0.07타일(약간)을 지향하되 **타일 폭(±0.2)은 절대 안 벗어난다** (사용자 지적
        // "다른 타일로 벗어나버리면 안되지" — 선이 많으면 간격을 줄여서라도 안에 담는다).
        const n = lines.length;
        const step = n > 1 ? Math.min(0.4 / (n - 1), 0.07) : 0;
        const off = (li - (n - 1) / 2) * step;
        const mapPt = ([x, y]: [number, number]) => [x * cell + cell / 2 + off, y * cell + cell / 2 + off] as const;
        // 강조 시: 고른 적의 선은 굵게, 나머지는 **아주 흐리게** (사용자 확정 2026-08-10 —
        // '굵기만' 안을 써 보고 겹침이 심해 흐림 방식으로 되돌림). 평소엔 전부 보통.
        // 선이 적 단위라 색은 언제나 그 선 주인의 색이다.
        const em = hl ? owner !== null && hl.has(owner) : false;
        const color = owner ? enemyRouteColor(order, owner) : "#9aa0a6";
        const first = mapPt(P.segs[0].pts[0]);
        const lastPts = P.segs[P.segs.length - 1].pts;
        const last = mapPt(lastPts[lastPts.length - 1]);
        const prev = mapPt(lastPts[lastPts.length - 2] ?? lastPts[0]);
        const ang = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
        const a = 0.28; // 화살촉 크기 (타일 단위)
        const tip: [number, number][] = [
          [last[0] + Math.cos(ang) * a, last[1] + Math.sin(ang) * a],
          [last[0] + Math.cos(ang + 2.5) * a, last[1] + Math.sin(ang + 2.5) * a],
          [last[0] + Math.cos(ang - 2.5) * a, last[1] + Math.sin(ang - 2.5) * a],
        ];
        return (
          <g key={`${rep}-${owner ?? "•"}`} opacity={hl && !em ? 0.07 : 0.92}>
            {/* 대시가 진행 방향으로 흐른다(CSS 애니메이션) — 방향 표시 겸 움직임 (사용자 요청).
                지상은 긴 대시, 비행은 점선, **통로 순간이동(hop)은 가늘고 성긴 점선**.
                패턴 길이는 keyframe 오프셋(-0.64)의 약수라 끊김 없이 순환한다. */}
            {P.segs.map((sgm, si) => (
              <polyline key={si} points={sgm.pts.map(mapPt).map((p) => p.join(",")).join(" ")}
                fill="none" stroke={color}
                strokeWidth={sgm.hop ? (em ? 0.07 : 0.03) : em ? 0.12 : 0.042}
                strokeLinejoin="round" strokeLinecap="round" opacity={sgm.hop ? 0.55 : 1}
                strokeDasharray={sgm.hop ? "0.04 0.12" : f[best] ? "0.12 0.2" : "0.5 0.14"} />
            ))}
            <circle cx={first[0]} cy={first[1]} r={0.16} fill={color} />
            <polygon points={tip.map((p) => p.join(",")).join(" ")} fill={color} />
          </g>
        );
      })}
    </svg>
    {/* 타일 범례 — 이 지도에 있는 타일 종류만 (사용자 요청 2026-08-10 "다 구분 가능하게") */}
    <div className="st-tilekey">
      {(() => {
        const present = new Set<string>();
        for (const row of g) for (const ch of row) present.add(ch);
        {/* data-tip = 즉시 뜨는 커스텀 툴팁 — 브라우저 기본 title은 1초쯤 지연된다 (사용자 요청) */}
        return TILE_LABELS.filter(([c]) => present.has(c)).map(([c, label, desc]) => (
          <span key={c} data-tip={t(desc)}><i style={{ background: TILE_FILL[c] }} />{t(label)}</span>
        ));
      })()}
    </div>
    </div>
  );
}
