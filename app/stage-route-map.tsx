"use client";

// 적 이동 경로 격자 지도 — 작전 상세의 '이동 경로' 탭 (사용자 요청 2026-08-10).
//
// 레벨 파일의 타일 격자를 SVG로 그리고 그 위에 경로 폴리라인을 겹친다. 격자 방향은
// scripts/build-rogue.py render_minimap과 같은 row 0 = 위 (실사 미리보기와 육안 대조로 확인된 규약).
// **실사 모드**(photo prop, 2026-09-23): 카메라값이 있는 작전은 실사 도면을 바탕에 깔고
// 모든 좌표를 전투 카메라로 투영해 그 위에 그린다 (app/stage-cam.ts — 원근 정합의 근거).
// 좌표만 투영하고 선 굵기·점선·말 크기는 화면에서 일정하게 둔다 — 단위(unit)를 도면
// 가운데 한 칸 폭으로 잡아서, 격자 모드와 같은 숫자(0.042·0.5 0.14 …)를 그대로 쓴다.
// 데이터는 app/data/stage-routes.json — 5MB가 넘으므로 지연 로드한다 (stage-detail.tsx가 import()로
// 가져와 여기 props로 준다). 합친 도면 작전은 상세를 열 때, 그 밖은 '이동 경로' 탭을 누를 때.
//
// 상호작용: 적 칩/범례에 호버(데스크탑)·탭(모바일)하면 그 적의 경로만 강조.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { asset } from "./assets";
import { PHOTO_ASPECT, stageProjector, type StageCam } from "./stage-cam";

/** scripts/routeutil.py 산출 — g는 행 문자열(row 0 = 위), r은 [col,row] 꼭짓점.
 *  sp 이하는 시뮬레이션 확장 (필드 의미는 routeutil.py docstring이 정본). */
export type StageRoutes = {
  h: number; w: number; g: string[];
  r: ([number, number][] | null)[];
  f: number[];
  e: Record<string, number[]>;
  /** 스폰 [웨이브, 웨이브 내 시각, 경로, 마릿수, 간격초, 적번호(e 키 순서), 조각 preDelay] */
  sp?: [number, number, number, number, number, number, number][];
  /** 웨이브별 [preDelay, postDelay, maxTimeWaitingForNextWave] */
  wv?: [number, number, number][];
  /** e 키 순서별 이동속도(타일/초) */
  ems?: number[];
  /** 경로번호 → [원본 꼭짓점 번호, 초, 모드(0 고정 · 1 조각시계 · 2 웨이브시계)] */
  cw?: Record<string, [number, number, number][]>;
  /** 레벨 전역 이동속도 배율 */
  mm?: number;
  /** 지도 오브젝트 [종류, col, row] — 생존연산의 파괴 가능 바위·채집 자원·보물
   *  (build-sandbox.py predefines 추출, 사용자 요청 2026-08-12). 좌표는 경로와 같은
   *  규약(row 0 = 아래)이라 렌더러가 뒤집는다. */
  ob?: [string, number, number][];
  /** 화면 이름표 밖의 경로 주인 — 그 판 전용 변종·도감 밖 원본 적. p 모델 키 · n 그 판 이름(레벨 파일 언어
   *  그대로) · i 초상(public 경로) · ko/en/ja 모델 적의 현지 이름. scripts/routenames.py 가 싣는다 (2026-09-23) */
  nm?: Record<string, { p: string; n?: string; i?: string; ko?: string; en?: string; ja?: string }>;
  /** 생존연산 도면이 담은 격자 창 [x, y, w, h] (row 0 = 위) — 안개 방(레벨 rect_N) 밖의 보이는 영역.
   *  도면은 이 창을 가운데 share(5/6)로 그린다. 없으면 격자 전체 (build-sandbox.py, 2026-09-23) */
  vb?: [number, number, number, number];
};
const HANGUL = /[가-힣]/;
/** 경로가 아직 안 온 동안의 빈 지도 — 모든 계산이 빈 배열로 돈다 */
const EMPTY_ROUTES: StageRoutes = { h: 0, w: 0, g: [], r: [], f: [], e: {} };

// 지도 오브젝트 표기 — **전 종류를 기본으로 그린다** (사용자 지시 2026-08-12
// "자원 오브젝트들도 기본적으로 보이게, 눌러야만 나오면 어떡해"). 자원 목록에서 한
// 종류를 고르면 그 종류만 선명해지고 나머지는 흐려진다.
// ⚠ 종류 이름표는 **타일 범례에 섞지 않는다** — 타일이 아니라 오브젝트다 (같은 날 지적).
const OB_STYLE: Record<string, { fill: string; label: string; shape: "diamond" | "dot" | "star" }> = {
  rock: { fill: "#e07a3f", label: "파괴 가능 바위", shape: "diamond" },
  stone: { fill: "#cfc8bd", label: "석재", shape: "dot" },
  iron: { fill: "#8fb3d9", label: "철광석", shape: "dot" },
  diam: { fill: "#6fe3d4", label: "명징석", shape: "dot" },
  wood: { fill: "#7fc46a", label: "목재", shape: "dot" },
  treasure: { fill: "#ffd166", label: "보물", shape: "star" },
  // 신시즌(재기동 앵커) 추가분 — 종류가 45가지라 개별 색 대신 성격별로 묶는다
  water: { fill: "#4fb3d9", label: "물", shape: "dot" },
  bldg: { fill: "#c9a0ff", label: "설치물", shape: "diamond" },
  obj: { fill: "#9aa0a6", label: "오브젝트", shape: "dot" },
};
function obShape(shape: "diamond" | "dot" | "star", x: number, y: number, fill: string, key: number) {
  if (shape === "diamond") {
    return <rect key={key} x={x - 0.17} y={y - 0.17} width={0.34} height={0.34} fill={fill}
      stroke="#10141c" strokeWidth={0.045} transform={`rotate(45 ${x} ${y})`} />;
  }
  if (shape === "star") {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const rr = i % 2 ? 0.1 : 0.22;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      return `${x + Math.cos(a) * rr},${y + Math.sin(a) * rr}`;
    }).join(" ");
    return <polygon key={key} points={pts} fill={fill} stroke="#10141c" strokeWidth={0.04} />;
  }
  return <circle key={key} cx={x} cy={y} r={0.16} fill={fill} stroke="#10141c" strokeWidth={0.045} />;
}

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
  x: "#0b0a12",   // 고지형 이동·배치 불가 — 아주 새까만 배경 + ⊘ 표식 (사용자 지시 2026-08-10)
  f: "#3b322c",   // 장애물 — 이동·배치 불가 (갈색끼 어두움)
  h: "#10141c",   // 구멍 — 비행만 통과 (어두운 남색끼 — x보단 밝고 ⊘도 없어 구분된다)
  i: "#b06a2a",   // 통로 입구 — 게임의 주황 화살표 (사용자 제보 2026-08-10)
  o: "#d18f3f",   // 통로 출구
  u: "#2d6b86",   // 물 — 생존연산은 수상 플랫폼을 놓아야 배치 가능 (사용자 제보 2026-08-12)
  d: "#16394f",   // 깊은 물 — 비행만 통과
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
  ["u", "물(지상·비행 통과)", "지상 적도 걸어서 건넙니다 — 생존연산에서는 수상 플랫폼을 설치해야 오퍼레이터를 배치할 수 있습니다"],
  ["d", "깊은 물(비행만)", "비행 적만 지나갈 수 있습니다"],
];
// 적별 색 — **같은 적은 같은 색, 다른 적은 다른 색** (사용자 확정 2026-08-10).
// 색은 범례(적 얼굴) 순번으로 배정하고 초상 테두리에도 같은 색을 쓴다.
const ROUTE_COLORS = ["#ffd166", "#6ee7b7", "#7ab8ff", "#ff8fab", "#c9a0ff", "#5eead4", "#ffa94d", "#b8e986"];
/** 범례 순번(order) 기준 적 색 — 지도 선과 초상 테두리가 같은 색을 공유한다 */
export function enemyRouteColor(order: string[], id: string): string {
  const k = order.indexOf(id);
  return k >= 0 ? ROUTE_COLORS[k % ROUTE_COLORS.length] : "#9aa0a6";
}

// 지상 이동 가능 타일 — 도로(r)·통행(p)·출현(s)·방어(e)·통로(i/o)·물(u).
// ⚠ 물(u)은 passableMask=ALL이라 **지상 적도 걸어서 건넌다** — 비행 전용이 아니다
//   (사용자 지적 2026-08-12). 비행만 지나는 건 깊은 물(d)·구멍(h)뿐이라 여기서 뺀다.
const WALKABLE = new Set(["r", "p", "s", "e", "i", "o", "u"]);

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

/** 방향이 안 바뀌는 중간 점 제거 — BFS가 뱉는 촘촘한 계단을 짧은 폴리라인으로.
 *  ⚠ 외적 0만 보면 **왕복 반환점**(같은 줄에서 갔다가 되돌아오는 V)까지 일직선으로 접혀
 *  선에서 왕복 구간이 통째로 사라진다 — 13-6 폭격자가 방어 지점을 지나쳐 내려갔다
 *  돌아오는 경로에서 실측 (사용자 지적 2026-08-10 "경로 벗어났잖아"). 진행 방향이
 *  같을 때(내적 > 0)만 접는다. */
function simplify(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && i < pts.length - 1) {
      const [ax, ay] = out[out.length - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
      const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
      const dot = (bx - ax) * (cx - bx) + (by - ay) * (cy - by);
      if (cross === 0 && dot > 0) continue;
    }
    out.push(pts[i]);
  }
  return out;
}

export function StageRouteMap({ data: dataProp, order, highlights, imgOf, nameOf, onPick, autoSim, obPick, obStyleOf, obIconOf, photo }: {
  /** 없으면 '불러오는 중' — 실사 모드에서 경로가 오기 전에도 같은 자리·모양을 그려 둔다 (합친 도면) */
  data?: StageRoutes;
  /** 범례에 보이는 적 id 순서 — 선 색 배정 기준 (stage-detail이 넘겨준다) */
  order: string[];
  highlights?: string[] | null;
  /** 적 섬네일 URL — 시뮬레이션 말을 초상으로 그린다 (없으면 색 원, 사용자 요청 2026-08-10) */
  imgOf?: (id: string) => string | undefined;
  /** 적 표시 이름 — 선·말 호버 즉시 툴팁 (사용자 요청 2026-08-10 "어떤 적의 경로인지") */
  nameOf?: (id: string) => string | undefined;
  /** 선 클릭 = 그 적 고정 토글 — 적 카드 클릭과 같은 동작 (사용자 요청 2026-08-10) */
  onPick?: (id: string) => void;
  /** 마운트하자마자 시뮬 자동 재생 — /stages/<id>?sim=1 딥링크 (작전 시뮬레이터 런처) */
  autoSim?: boolean;
  /** 오브젝트 강조 — 고른 종류만 선명하게, 나머지는 흐리게 (생존연산 자원 목록 클릭) */
  obPick?: string | null;
  /** ob의 종류 문자열 → 마커 스타일 키. 신시즌은 종류가 45가지(트랩 id)라 성격별로 접어 준다 */
  obStyleOf?: (kind: string) => string;
  /** ob의 종류 → 아이템 아이콘 URL. 주면 마커 자리에 **섬네일**을 그린다 (사용자 요청 2026-08-12) */
  obIconOf?: (kind: string) => string | undefined;
  /** 실사 모드 — 실사 도면(src)을 바탕에 깔고 전투 카메라(cam)로 투영해 그린다 (2026-09-23) */
  /** 실사 모드 — 도면(src) 위에 겹친다. cam 이 있으면 전투 카메라 원근 투영(16:9), 없으면 **평면도**
   *  (생존연산 도면처럼 격자를 바로 위에서 그린 그림 — 격자를 그림 크기에 그대로 맞춘다, 2026-09-23). */
  photo?: { src: string; cam?: StageCam; alt?: string;
    /** (평면도) 격자가 그림 폭·높이에서 차지하는 몫 — 가운데 기준. 생존연산 사막 이야기는 5/6 (SANDBOX_GRID_SHARE) */
    share?: number };
}) {
  const { t, locale } = useI18n();
  // 경로가 아직 없으면(pending) 빈 지도로 돌린다 — 버튼 줄과 도면 자리는 그대로 그려 CLS 가 없다
  const pending = !dataProp;
  const data = dataProp ?? EMPTY_ROUTES;
  // 경로 주인의 이름·초상 — 화면 이름표(nameOf/imgOf)에 없는 적은 경로 문서의 nm(레벨 파일에 적힌 이름·모델)으로
  // 채운다. 종전엔 말풍선에 id 가 찍히고 시뮬 말이 까맣게 비었다 (사용자 제보 2026-09-23 흑류수해 시뮬레이터,
  // 전수 조사 248종 — scripts/routenames.py 머리주석). 모든 화면(작전 도감·시뮬·/rogue·/ra·위수 협의)이 여기를 지난다.
  const ownerName = (k: string) => {
    const own = nameOf?.(k);
    if (own && own !== k) return own;            // 폴백으로 id 를 돌려주는 화면(/ra 등)도 '없음'으로 친다
    const o = data.nm?.[k];
    if (!o) return own || k;
    const local = o[locale as "ko" | "en" | "ja"] ?? (o.p !== k ? nameOf?.(o.p) : undefined);
    if (!o.n) return local || k;
    // 한섭 레벨 이름은 한국어 화면에서 그대로 — '사냥개 (약)'처럼 그 판의 표기가 모델 이름보다 정확하다
    if (HANGUL.test(o.n)) return locale === "ko" ? o.n : local || o.n;
    // 중섭 선행 레벨 이름(중국어)은 원문이 대표·번역이 뒤 — 통합전략 CN 표기 규칙(Nm)과 같다
    return locale === "ko" ? (local && local !== o.n ? `${o.n} ${local}` : o.n) : local || o.n;
  };
  // 초상 — nm 의 초상(i)은 빌더가 파일이 실제로 있는 것만 싣는다. i 가 없으면 게임에도 초상이 없는 적이다
  // (장치·소환물 등 25종, 2026-09-23 CDN 전수 확인) → 말을 경로 색으로 채운다. 불러오다 깨진 그림도 한 번
  // 기억해 두고 같은 처리 — 종전엔 어두운 원만 남아 '까맣게 빈 아이콘'이었다 (같은 제보).
  const [badImg, setBadImg] = useState<Set<string>>(() => new Set());
  const markBad = (u?: string) => { if (u) setBadImg((cur) => (cur.has(u) ? cur : new Set(cur).add(u))); };
  const ownerImg = (k: string) => {
    const o = data.nm?.[k];
    const u = o ? (o.i ? asset(o.i) : undefined) : imgOf?.(k);
    return u && !badImg.has(u) ? u : undefined;
  };
  const { w, h, g, r, f } = data;
  // 실사 모드 좌표 — toXY(gx, gy)는 격자 좌표(한 칸 = 1, 왼쪽 위 원점)를 그리는 좌표로 옮긴다.
  // 격자 모드는 그대로. 실사 모드는 도면을 **16:9로 펴서**(PHOTO_ASPECT — 실사 도면을 보여 주던
  // .st-map 과 같은 비율) 그 위 위치를 '가운데 한 칸 폭 = 1' 단위로 준다.
  const proj = useMemo(() => (photo?.cam ? stageProjector(photo.cam, w, h) : null), [photo, w, h]);
  // 평면도 겹치기 — 좌표는 격자 그대로, 상자 비율은 격자 비율(w:h). 도면이 격자와 같은 비율로
  // 잘려 있어야 맞는다 (scripts/build-stages-sandbox.py 가 그런 도면에만 ortho 를 붙인다).
  const ortho = !!photo && !photo.cam;
  // 평면도는 격자가 그림 한가운데 share 만큼만 차지한다 — 그림(=SVG 좌표 범위)은 격자보다 1/share 배 넓다.
  // 좌표는 격자 그대로 두고 viewBox 만 넓혀 그림 전체와 맞춘다 (2026-09-23 사용자 제보 "나오는 데·들어가는 데가
  // 안 맞는다" — 종전엔 격자가 그림 전체를 덮는다고 보아 가장자리 출현 칸이 1~2칸씩 어긋났다).
  const share = ortho ? photo?.share ?? 1 : 1;
  // 도면이 담은 격자 창 — 안개 방이 있는 생존연산 지역(20곳)은 처음 보이는 영역만 그린다 (StageRoutes.vb).
  // 종전엔 격자 전체로 보아 비율이 안 맞는 이 20곳을 겹치기에서 빼고 타일 지도만 남겼다 (사용자 지적 2026-09-23)
  const [bx, by, bw, bh] = data.vb ?? [0, 0, w, h];
  const unit = useMemo(() => {
    if (!proj) return 1;
    return (proj(w / 2 + 0.5, h / 2)[0] - proj(w / 2 - 0.5, h / 2)[0]) * PHOTO_ASPECT;
  }, [proj, w, h]);
  const toXY = (x: number, y: number): [number, number] => {
    if (!proj) return [x, y];
    const [u, v] = proj(x, y);
    return [(u * PHOTO_ASPECT) / unit, v / unit];
  };
  // 실사 위에 타일 종류를 반투명으로 겹칠지 — 격자 모드의 색 구분을 실사에서도 본다
  const [showTiles, setShowTiles] = useState(false);
  // 실사 위 경로 선 표시 — 기본은 켠다 (사용자 요청 2026-09-23 "기본적으로는 지금처럼 표시").
  // 끄면 선과 출발·도착 표식만 숨긴다. 시뮬레이션 말은 경로가 아니라 그대로 달린다.
  const [showRoutes, setShowRoutes] = useState(true);
  // ── 시뮬레이션 상태 (사용자 요청 2026-08-10 "시뮬레이트 버튼 하나 만들어보자") ──
  // 시각(simT)은 초 단위 스테이지 시계. rAF 루프가 tRef를 굴리고 상태로 비춘다.
  // 이 컴포넌트는 경로 데이터가 준비된 뒤에만 마운트되므로 autoSim은 초기값으로 소화한다.
  const initSim = !!autoSim && !!(data.sp?.length && data.wv);
  const [simOn, setSimOn] = useState(initSim);
  const [playing, setPlaying] = useState(initSim);
  const [speed, setSpeed] = useState(1);
  const [simT, setSimT] = useState(0);
  const tRef = useRef(0);
  const clipId = useId();
  // 선·말 호버 즉시 툴팁 — 브라우저 기본 title은 1초쯤 지연된다 (사용자 정책).
  // 이름 옆에 작은 섬네일도 함께 (사용자 요청 2026-08-10 "섬네일 이미지도 작게 같이").
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; img?: string } | null>(null);
  const showTip = (ev: { clientX: number; clientY: number }, text: string, img?: string) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setTip({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, text, img });
  };
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
      // marks: 원본 꼭짓점 k가 dense의 몇 번째 칸인지 — 시뮬레이션의 경유 대기(cw)가
      // 원본 번호로 오므로 이 매핑으로 대기 지점을 찾는다.
      if (f[i]) return { segs: [{ pts: wp, hop: false }], dense: wp, marks: wp.map((_, k) => k) };
      const out: [number, number][] = [wp[0]];
      const marks: number[] = [0];
      for (let k = 1; k < wp.length; k++) {
        const seg = walkPath(g, w, h, out[out.length - 1], wp[k]);
        if (seg) out.push(...seg.slice(1));
        else out.push(wp[k]);   // 경로 탐색 실패(특수 좌표 등)면 직선 폴백
        marks.push(out.length - 1);
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
      return { segs, dense: out, marks };
    }), [r, f, g, w, h]);
  // 접기·선 목록은 시뮬레이션 재생(초당 수십 렌더) 중에도 다시 계산하지 않는다
  const { lines, classOf } = useMemo(() => {
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
  const lines: { rep: number; owner: string | null; best: number; off: number }[] = [];
  const usedClasses = new Set<number>();
  for (const id of order) {                    // 범례 순 — 색·겹침 순서가 안정된다
    const reps = new Set<number>();
    for (const ri of data.e[id] ?? []) {
      const rep = classOf.get(ri);
      if (rep !== undefined) reps.add(rep);
    }
    for (const rep of reps) { lines.push({ rep, owner: id, best: rep, off: 0 }); usedClasses.add(rep); }
  }
  // 등장 적 목록 밖(숨은 증원 등)만 쓰는 경로 — 회색 한 벌로 남긴다.
  // ⚠ **어느 적도 스폰하지 않는 경로는 그리지 않는다** (사용자 제보 2026-09-23 TR-5 "정체를 알 수
  //   없는 회색 경로"). 레벨의 routes 에는 적 말고도 PREVIEW_CURSOR(웨이브 예고 화살표)·
  //   PLAY_OPERA(경고 연출)·DISPLAY_ENEMY_INFO 가 가리키는 경로가 섞여 있다 — 작전 도감만
  //   401곳 1,163개가 회색 선으로 나가고 있었다. e 는 웨이브·브랜치의 SPAWN 전부(숨은 증원
  //   포함)로 만들어지므로(routeutil.py), 거기 한 번도 안 나오는 경로는 적의 길이 아니다.
  const spawned = new Set(Object.values(data.e).flat());
  for (const [rep, members] of group) {
    if (!usedClasses.has(rep) && members.some((i) => spawned.has(i))) lines.push({ rep, owner: null, best: rep, off: 0 });
  }
  // 묶음 중 **경유점이 가장 많은** 변형을 그 선의 모양으로 (게임이 의도한 궤적에 가장
  // 가깝다). 오프셋도 여기서 확정 — 시뮬레이션 말이 **자기 선 위**를 정확히 타야 하므로
  // (사용자 지적 2026-08-10 "경로를 벗어나버리는 경우가 있음") 렌더와 시뮬이 공유한다.
  const step = lines.length > 1 ? Math.min(0.4 / (lines.length - 1), 0.07) : 0;
  lines.forEach((ln, li) => {
    const members = group.get(ln.rep) ?? [ln.rep];
    ln.best = members.reduce((a, b) => ((drawPolys[b]?.length ?? 0) > (drawPolys[a]?.length ?? 0) ? b : a), ln.rep);
    ln.off = (li - (lines.length - 1) / 2) * step;
  });
  return { lines, classOf };
  }, [polys, r, f, data, order]);

  // ── 시뮬레이션 계획 — 스폰 하나하나를 (등장 시각, 칸별 도착/출발 시각표)로 편다.
  // "저지 없이 흘려보냈을 때"의 기준선이다: 웨이브는 마지막 적이 도착 지점에 닿는
  // 순간 끝난다고 보고 잇는다 (게임은 처치·저지에 따라 달라진다 — st-simnote로 고지).
  const plan = useMemo(() => {
    if (!simOn || !data.sp?.length || !data.wv) return null;
    const keys = Object.keys(data.e);
    const mmul = data.mm || 1;
    type Runner = { key: string; color: string; t0: number; end: number; arr: number[]; dep: number[]; pts: [number, number][]; off: number };
    const runners: Runner[] = [];
    const waveSpans: number[] = [];   // 웨이브 n의 시작 시각
    // 말은 **화면에 그려진 그 선**(묶음 대표 best + 오프셋)을 타야 한다 (사용자 지적
    // 2026-08-10 "경로를 벗어나버리는 경우가 있음" — 자기 변형 경로를 타면 대표 선과
    // 지터만큼 어긋난다). (주인, 묶음) → 선 찾기.
    const lineBy = new Map<string, (typeof lines)[number]>();
    for (const ln of lines) lineBy.set(`${ln.owner ?? ""}#${ln.rep}`, ln);
    const byWave = new Map<number, NonNullable<typeof data.sp>>();
    for (const s of data.sp) {
      if (!byWave.has(s[0])) byWave.set(s[0], []);
      byWave.get(s[0])?.push(s);
    }
    let waveStart = 0;
    for (let wi = 0; wi < data.wv.length; wi++) {
      const [pre, post, mtw] = data.wv[wi];
      waveStart += pre;
      waveSpans.push(waveStart);
      let waveEnd = waveStart, lastSpawn = waveStart;
      for (const [, tw, ri, count, itv, ki, fpre] of byWave.get(wi) ?? []) {
        const key = keys[ki] ?? "";
        const rep = classOf.get(ri);
        if (rep === undefined) continue;
        const line = lineBy.get(`${order.includes(key) ? key : ""}#${rep}`)
          ?? lines.find((ln) => ln.rep === rep);
        const P = polys[line?.best ?? ri] ?? polys[ri];
        const own = polys[ri];
        if (!P || !own || !line) continue;
        const ms = Math.max(0.05, (data.ems?.[ki] ?? 1) * mmul);
        // 경유 대기(cw)는 원래 경로(ri)의 꼭짓점 번호 기준 — 그리는 변형(best)이 다르면
        // 좌표가 가장 가까운 칸으로 옮겨 단다 (묶음 판정상 차이 ≤ 2칸이라 안전).
        const waits = (data.cw?.[String(ri)] ?? []).map(([k, sec, mode]) => {
          const pt = own.dense[own.marks[k]] ?? own.dense[own.dense.length - 1];
          let bi = 0, bd = Infinity;
          for (let i = 0; i < P.dense.length; i++) {
            const d = Math.abs(P.dense[i][0] - pt[0]) + Math.abs(P.dense[i][1] - pt[1]);
            if (d < bd) { bd = d; bi = i; }
          }
          return [bi, sec, mode] as const;
        });
        for (let c = 0; c < count; c++) {
          const t0 = waveStart + tw + c * itv;
          // arr[i] = i번째 칸 도착 시각(스폰 기준 상대), dep[i] = 대기를 마친 출발 시각.
          // 대기를 이동 시간에 뭉개면 말이 느리게 '기어가는' 것처럼 보인다 — 분리한다.
          const arr: number[] = [0], dep: number[] = [0];
          for (let i = 0; i < P.dense.length; i++) {
            if (i > 0) {
              const [ax, ay] = P.dense[i - 1], [bx, by] = P.dense[i];
              const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
              // 순간이동(hop)은 0초
              arr[i] = dep[i - 1] + (Math.max(dx, dy) > 1 ? 0 : Math.hypot(dx, dy) / ms);
            }
            let d = arr[i];
            for (const [k, sec, mode] of waits) {
              if (k !== i) continue;
              if (mode === 0) d += sec;
              // 조각/웨이브 시계 T까지 대기 — 이미 지났으면 대기 없음
              else d = Math.max(d, (mode === 1 ? waveStart + fpre + sec : waveStart + sec) - t0);
            }
            dep[i] = d;
          }
          const end = t0 + arr[arr.length - 1];
          runners.push({
            key, t0, end, arr, dep, pts: P.dense, off: line.off,
            color: key && order.includes(key) ? enemyRouteColor(order, key) : "#c8cdd4",
          });
          lastSpawn = Math.max(lastSpawn, t0);
          waveEnd = Math.max(waveEnd, end);
        }
      }
      // 다음 웨이브 시작 — 기준선으론 전원 도착 시점, maxTimeWaiting이 있으면 그로 상한
      let endAt = waveEnd;
      if (mtw >= 0) endAt = Math.min(endAt, lastSpawn + mtw);
      waveStart = endAt + post;
    }
    const duration = runners.reduce((m, rn) => Math.max(m, rn.end), 0);
    // 제자리 개체(한 칸 경로)는 도착 시각이 스폰과 같아 한 프레임만 보인다 —
    // 스테이지가 끝날 때까지 서 있는 게 실제에 가깝다 (생존연산 채집물·장치)
    for (const rn of runners) if (rn.pts.length < 2) rn.end = duration;
    // 조건 분기(branches)만으로 등장하는 적 — 재생에서 빠진다는 고지용
    const spRoutes = new Set(data.sp.map((s) => s[2]));
    const conditional = Object.values(data.e).some((ris) => ris.every((ri) => !spRoutes.has(ri)));
    return { runners, duration, waveSpans, conditional };
  }, [simOn, data, polys, order, lines, classOf]);

  // 재생 루프 — rAF. 시간은 tRef가 정본, simT는 화면 반영용.
  useEffect(() => {
    if (!playing || !plan) return;
    let last = performance.now();
    let id = requestAnimationFrame(function step(now: number) {
      const dt = (now - last) / 1000;
      last = now;
      const t2 = tRef.current + dt * speed;
      if (t2 >= plan.duration) {
        tRef.current = plan.duration;
        setSimT(plan.duration);
        setPlaying(false);
        return;
      }
      tRef.current = t2;
      setSimT(t2);
      id = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(id);
  }, [playing, speed, plan]);

  const fmtT = (v: number) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, "0")}`;
  const curWave = plan ? plan.waveSpans.reduce((n, from, i) => (simT >= from ? i + 1 : n), 1) : 1;
  const hasSim = pending || !!(data.sp?.length && data.wv);
  // 지도 크기 2단 — **기본이 이미 넓은 칼럼(52%)**이고 토글은 전폭 하나뿐
  // (사용자 확정 2026-08-12 "한번 확대한 크기를 기본으로, 지도 크기는 두 가지만")
  const [big, setBig] = useState(false);
  const cell = 1;
  const svgEl = (
      <svg className={`st-routemap${photo ? " st-routeoverlay" : ""}`}
        viewBox={photo && !ortho ? `0 0 ${PHOTO_ASPECT / unit} ${1 / unit}`
          : ortho ? `${bx - (bw / share - bw) / 2} ${by - (bh / share - bh) / 2} ${bw / share} ${bh / share}`
          : `0 0 ${w * cell} ${h * cell}`} role="img"
        aria-label={t("적 이동 경로 지도")}>
        {/* 고지형(x) 금지 표식 — 각 타일 중앙의 은은한 ⊘(원+사선) (사용자 요청 2026-08-10
            "금지당한듯한 표시, 너무 심하게 눈에 안 띄게" — 단순 세로줄은 무성의하다고 반려).
            색이 아니라 표식이라 색약에도 구분된다. */}
        <defs>
          {/* 새까만 배경 위라 표식은 은은한 밝은 잉크 (배경이 새까만색 — 사용자 지시 2026-08-10) */}
          <g id={`${clipId}x`}>
            <circle r={0.19} fill="none" stroke="#4f4964" strokeWidth={0.055} />
            <line x1={-0.134} y1={-0.134} x2={0.134} y2={0.134} stroke="#4f4964" strokeWidth={0.055} />
          </g>
        </defs>
        {photo ? (
          <>
            {/* 타일 종류 겹치기 — 각 칸의 바닥 네 모서리를 투영한 사각형 (원근 그대로) */}
            {showTiles && g.map((row, ri) =>
              Array.from(row).map((ch, ci) => {
                const q = [toXY(ci, ri), toXY(ci + 1, ri), toXY(ci + 1, ri + 1), toXY(ci, ri + 1)];
                return (
                  <polygon key={`${ri}-${ci}`} points={q.map((p) => p.join(",")).join(" ")}
                    fill={TILE_FILL[ch] ?? TILE_FILL.r} fillOpacity={0.55}
                    stroke="#fff" strokeOpacity={0.35} strokeWidth={0.02} />
                );
              }))}
          </>
        ) : (
          <>
            {g.map((row, ri) =>
              Array.from(row).map((ch, ci) => (
                <rect key={`${ri}-${ci}`} x={ci * cell + 0.02} y={ri * cell + 0.02}
                  width={cell - 0.04} height={cell - 0.04} fill={TILE_FILL[ch] ?? TILE_FILL.r} />
              )))}
            {g.map((row, ri) =>
              Array.from(row).map((ch, ci) => ch === "x" && (
                <use key={`x${ri}-${ci}`} href={`#${clipId}x`}
                  x={ci * cell + cell / 2} y={ri * cell + cell / 2} />
              )))}
          </>
        )}
        {/* 지도 오브젝트 — 전 종류를 그리고, 고른 종류(obPick)만 선명하게 남긴다 */}
        {data.ob?.map(([kind, c, r], i) => {
          const st = OB_STYLE[obStyleOf ? obStyleOf(kind) : kind];
          if (!st) return null;
          const dim = obPick ? obPick !== kind : false;
          const [x, y] = toXY(c + 0.5, h - 1 - r + 0.5);
          const icon = obIconOf?.(kind);
          return (
            <g key={i} opacity={dim ? 0.14 : 1}>
              {icon ? (
                // 섬네일 마커 — 종류 색 테두리 원 위에 아이템 아이콘 (사용자 요청 2026-08-12)
                <>
                  <circle cx={x} cy={y} r={0.3} fill="#10141c" fillOpacity={0.82} stroke={st.fill} strokeWidth={0.06} />
                  <image href={icon} x={x - 0.24} y={y - 0.24} width={0.48} height={0.48}
                    preserveAspectRatio="xMidYMid meet" />
                </>
              ) : obShape(st.shape, x, y, st.fill, i)}
            </g>
          );
        })}
        {showRoutes && lines.map((ln) => {
          // 선의 모양(best)·오프셋(off)은 접기 메모에서 확정 — 시뮬레이션 말과 공유한다
          const { rep, owner, best, off } = ln;
          const P = polys[best];
          if (!P) return null;
          const mapPt = ([x, y]: [number, number]) => toXY(x * cell + cell / 2 + off, y * cell + cell / 2 + off);
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
          const tipPts: [number, number][] = [
            [last[0] + Math.cos(ang) * a, last[1] + Math.sin(ang) * a],
            [last[0] + Math.cos(ang + 2.5) * a, last[1] + Math.sin(ang + 2.5) * a],
            [last[0] + Math.cos(ang - 2.5) * a, last[1] + Math.sin(ang - 2.5) * a],
          ];
          return (
            <g key={`${rep}-${owner ?? "•"}`} opacity={obPick ? 0.12 : hl && !em ? 0.07 : 0.92}>
              {/* 대시가 진행 방향으로 흐른다(CSS 애니메이션) — 방향 표시 겸 움직임 (사용자 요청).
                  지상은 긴 대시, 비행은 점선, **통로 순간이동(hop)은 가늘고 성긴 점선**.
                  패턴 길이는 keyframe 오프셋(-0.64)의 약수라 끊김 없이 순환한다. */}
              {/* 실사 모드 밑선 — 흰 고지대·밝은 바닥 위에서 노랑·연두 선이 묻히지 않게
                  어두운 테두리를 한 겹 깐다 (격자 모드는 바탕이 어두워 필요 없다) */}
              {photo && P.segs.map((sgm, si) => !sgm.hop && (
                <polyline key={`c${si}`} points={sgm.pts.map(mapPt).map((p) => p.join(",")).join(" ")}
                  fill="none" stroke="#0b0e12" strokeOpacity={0.6}
                  strokeWidth={(em ? 0.12 : 0.042) + 0.05}
                  strokeLinejoin="round" strokeLinecap="round" style={{ animation: "none" }} />
              ))}
              {P.segs.map((sgm, si) => (
                <polyline key={si} points={sgm.pts.map(mapPt).map((p) => p.join(",")).join(" ")}
                  fill="none" stroke={color}
                  strokeWidth={sgm.hop ? (em ? 0.07 : 0.03) : em ? 0.12 : 0.042}
                  strokeLinejoin="round" strokeLinecap="round" opacity={sgm.hop ? 0.55 : 1}
                  strokeDasharray={sgm.hop ? "0.04 0.12" : f[best] ? "0.12 0.2" : "0.5 0.14"} />
              ))}
              {/* 호버용 투명 굵은 선 — 어떤 적의 경로인지 즉시 툴팁 (사용자 요청 2026-08-10).
                  본선(0.042)은 얇아 마우스로 짚기 어려워 폭 0.3의 히트 영역을 겹친다.
                  클릭 = 그 적 고정 토글 — 적 카드 클릭과 같은 동작 (사용자 요청 2026-08-10). */}
              {owner && P.segs.map((sgm, si) => (
                <polyline key={`h${si}`} points={sgm.pts.map(mapPt).map((p) => p.join(",")).join(" ")}
                  fill="none" stroke="#000" strokeOpacity={0} strokeWidth={0.3}
                  style={{ pointerEvents: "stroke", animation: "none", cursor: onPick ? "pointer" : undefined }}
                  onClick={onPick ? () => onPick(owner) : undefined}
                  onMouseMove={(ev) => showTip(ev, ownerName(owner), ownerImg(owner))}
                  onMouseLeave={() => setTip(null)} />
              ))}
              {/* 시작점 ●·도착 화살촉 — 제자리 적(한 칸 경로)은 선이 없어 이 표식이 전부라,
                  여기에도 선과 같은 호버 툴팁·클릭 고정을 단다 (사용자 요청 2026-08-12). */}
              <g style={owner && onPick ? { cursor: "pointer" } : undefined}
                onMouseMove={owner ? (ev) => showTip(ev, ownerName(owner), ownerImg(owner)) : undefined}
                onMouseLeave={owner ? () => setTip(null) : undefined}
                onClick={owner && onPick ? () => onPick(owner) : undefined}>
                {P.dense.length < 2 && (
                  <circle cx={first[0]} cy={first[1]} r={0.34} fill="#000" fillOpacity={0}
                    style={{ pointerEvents: "all" }} />
                )}
                <circle cx={first[0]} cy={first[1]} r={0.16} fill={color} />
                <polygon points={tipPts.map((p) => p.join(",")).join(" ")} fill={color} />
              </g>
            </g>
          );
        })}
        {/* 시뮬레이션 말 — 스폰~도착 사이에만 있고, 경유 대기 중엔 제자리에 선다.
            적 섬네일 + 진행 방향 화살촉 (사용자 요청 2026-08-10 "원 말고 진행방향을 알 수
            있는 무언가로"). 강조 중엔 선과 똑같이 흐려진다 — 안 흐리면 숨은 경로 위를
            달리는 것처럼 보였다 (사용자 제보 "경로를 벗어나버리는 경우"). */}
        {simOn && plan && (
          <g className="st-simdots">
            <defs>
              <clipPath id={`${clipId}c`}><circle cx={0} cy={0} r={0.27} /></clipPath>
            </defs>
            {plan.runners.map((rn, i) => {
              if (!rn.pts.length || simT < rn.t0 || simT > rn.end) return null;
              const rel = simT - rn.t0;
              let x: number, y: number, vx = 0, vy = 0;
              if (rn.pts.length < 2) {
                // 한 칸짜리 경로 — 제자리 개체(생존연산 채집물·장치 등). k-1이 음수가 되어
                // 터지던 케이스 (사용자 제보 2026-08-12 그물망 갱도). 방향 없이 그 자리에 선다.
                [x, y] = rn.pts[0];
              } else {
              let k = 1;
              while (k < rn.arr.length && rn.arr[k] < rel) k++;
              if (k >= rn.arr.length) k = rn.arr.length - 1;
              const [ax, ay] = rn.pts[k - 1], [bx, by] = rn.pts[k];
              vx = bx - ax; vy = by - ay;
              if (rel <= rn.dep[k - 1]) {
                [x, y] = rn.pts[k - 1];             // 대기 중 — 다음 구간 방향을 미리 가리킨다
              } else if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) > 1) {
                [x, y] = rn.pts[k];                 // 순간이동(hop)은 즉시 도착점
                const [nx2, ny2] = rn.pts[Math.min(k + 1, rn.pts.length - 1)];
                vx = nx2 - bx; vy = ny2 - by;
              } else {
                const span = rn.arr[k] - rn.dep[k - 1];
                const f01 = span > 0 ? Math.min(1, (rel - rn.dep[k - 1]) / span) : 1;
                x = ax + (bx - ax) * f01;
                y = ay + (by - ay) * f01;
              }
              }
              // 그리는 자리와 진행 방향 — 실사 모드에선 원근 때문에 격자 방향과 화면 방향이
              // 달라지므로, 앞으로 조금 간 자리도 함께 투영해 화면 위 각도를 잰다.
              const [sx, sy] = toXY(x * cell + cell / 2 + rn.off, y * cell + cell / 2 + rn.off);
              const [ax2, ay2] = toXY(x * cell + cell / 2 + rn.off + vx * 0.05, y * cell + cell / 2 + rn.off + vy * 0.05);
              const deg = vx || vy ? (Math.atan2(ay2 - sy, ax2 - sx) * 180) / Math.PI : 0;
              const dim = hl ? !(rn.key && hl.has(rn.key)) : false;
              const img = ownerImg(rn.key);
              return (
                <g key={i} className="st-simunit"
                  transform={`translate(${sx},${sy})`}
                  opacity={dim ? 0.12 : 1}
                  onMouseMove={(ev) => showTip(ev, ownerName(rn.key), img)}
                  onMouseLeave={() => setTip(null)}>
                  {/* 진행 방향 화살촉 — 정지 상태에서도 어디로 가는지 보인다.
                      제자리 개체(이동 없음)는 방향이 없으니 그리지 않는다. */}
                  {(vx !== 0 || vy !== 0) && (
                    <g transform={`rotate(${deg})`}>
                      <polygon points="0.53,0 0.27,0.16 0.27,-0.16" fill={rn.color} stroke="#10141c" strokeWidth={0.03} />
                    </g>
                  )}
                  <circle r={0.3} fill={img ? "#10141c" : rn.color} stroke={rn.color} strokeWidth={0.055} />
                  {img && (
                    <image href={img} x={-0.27} y={-0.27} width={0.54} height={0.54}
                      clipPath={`url(#${clipId}c)`} preserveAspectRatio="xMidYMid slice"
                      onError={() => markBad(img)} />
                  )}
                </g>
              );
            })}
          </g>
        )}
      </svg>
  );
  return (
    <div className={`st-routewrap big${big ? " full" : ""}`} ref={wrapRef}>
    {/* 시뮬레이트 — 스폰 타임라인 재생 (사용자 요청 2026-08-10). 데이터가 있는 작전만. */}
    {hasSim && (
      <div className="st-simbar">
        {!simOn ? (
          <button type="button" className="st-simstart" disabled={pending}
            onClick={() => { tRef.current = 0; setSimT(0); setSimOn(true); setPlaying(true); }}>
            ▶ {t("시뮬레이트")}
          </button>
        ) : (
          <>
            <button type="button" onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? t("일시정지") : t("재생")}>{playing ? "⏸" : "▶"}</button>
            <button type="button" onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))}
              title={t("배속")}>×{speed}</button>
            <input type="range" min={0} max={plan ? Math.ceil(plan.duration * 10) / 10 : 0} step={0.1}
              value={Math.min(simT, plan?.duration ?? 0)}
              onChange={(ev) => { const v = Number(ev.target.value); tRef.current = v; setSimT(v); }}
              aria-label={t("재생 위치")} />
            <span className="st-simtime">
              {t("웨이브 {n}", { n: String(curWave) })} · {fmtT(simT)} / {fmtT(plan?.duration ?? 0)}
            </span>
            <button type="button" onClick={() => { setPlaying(false); setSimOn(false); }}
              aria-label={t("닫기")}>✕</button>
          </>
        )}
      </div>
    )}
    {simOn && (
      <p className="st-simnote">
        {t("저지 없이 두었을 때의 기준 타임라인입니다.")}
        {plan?.conditional && <> {t("처치 수 등 조건 분기 증원은 재생에 포함되지 않습니다.")}</>}
      </p>
    )}
    {/* 지상/비행 선 스타일 범례 — 지도 **바깥** 오른쪽 위 (사용자 정정 2026-08-10).
        ⤢ 확대 = 지도 칼럼을 모달의 절반 폭까지 (사용자 요청 2026-08-12 "시뮬레이터도
        확대 가능하게, 상세모달의 절반정도 크기까지") — .big을 :has()로 칼럼이 받는다. */}
    <div className="st-routekey">
      <span aria-hidden><svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="currentColor" strokeWidth="2.4" strokeDasharray="9 3.5" /></svg>{t("지상")}</span>
      <span aria-hidden><svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="currentColor" strokeWidth="2.4" strokeDasharray="2.5 4" /></svg>{t("비행")}</span>
      {/* 실사 모드 — 경로 선 켜고 끄기(기본 켬) · 타일 종류 반투명 겹치기(기본 끔) */}
      {photo && (
        <button type="button" className="st-mapscale" aria-pressed={showRoutes} disabled={pending}
          onClick={() => setShowRoutes((v) => !v)}>
          ⇢ {showRoutes ? t("경로 숨기기") : t("경로 표시")}
        </button>
      )}
      {photo && (
        <button type="button" className="st-mapscale" aria-pressed={showTiles} disabled={pending}
          onClick={() => setShowTiles((v) => !v)}>
          ▦ {showTiles ? t("타일 숨기기") : t("타일 표시")}
        </button>
      )}
      <button type="button" className="st-mapscale" aria-pressed={big} disabled={pending}
        onClick={() => setBig((v) => !v)}>
        {big ? "⤡ " + t("원래 크기") : "⤢ " + t("지도 확대")}
      </button>
    </div>
    {/* 실사 모드: 도면은 진짜 <img>(서버 렌더·검색에 그대로 박힌다)이고, 경로 SVG 는 같은 상자
        위에 투명하게 겹친다 — 경로가 늦게 와도 도면은 바뀌지도 밀리지도 않는다. */}
    {photo ? (
      <div className="st-photomap" style={ortho && bw && bh ? { aspectRatio: `${bw} / ${bh}` } : undefined}>
        <img src={photo.src} alt={photo.alt ?? ""} decoding="async" />
        {!pending && svgEl}
      </div>
    ) : svgEl}
    {/* 타일 범례 — 이 지도에 있는 타일 종류만 (사용자 요청 2026-08-10 "다 구분 가능하게").
        실사 모드에선 타일을 겹쳐 볼 때만 — 안 겹쳤는데 색 범례가 있으면 뜻이 없다 */}
    {(!photo || showTiles) && <div className="st-tilekey">
      {(() => {
        const present = new Set<string>();
        for (const row of g) for (const ch of row) present.add(ch);
        {/* data-tip = 즉시 뜨는 커스텀 툴팁 — 브라우저 기본 title은 1초쯤 지연된다 (사용자 요청) */}
        // ⚠ 지도 오브젝트(파괴 가능 바위)는 **타일이 아니다** — 타일 범례에 섞지 않는다
        //   (사용자 지적 2026-08-12). 자원·오브젝트 목록이 그 역할을 맡는다.
        return (
          <>
            {TILE_LABELS.filter(([c]) => present.has(c)).map(([c, label, desc]) => (
              <span key={c} data-tip={t(desc)}>
                <i style={{ backgroundColor: TILE_FILL[c] }}>
                  {/* x 스와치도 지도와 같은 ⊘ 표식 */}
                  {c === "x" && (
                    <svg viewBox="0 0 12 12" aria-hidden>
                      <circle cx="6" cy="6" r="3.6" fill="none" stroke="#4f4964" strokeWidth="1.2" />
                      <line x1="3.45" y1="3.45" x2="8.55" y2="8.55" stroke="#4f4964" strokeWidth="1.2" />
                    </svg>
                  )}
                </i>
                {t(label)}
              </span>
            ))}
          </>
        );
      })()}
    </div>}
    {/* 선·말 호버 즉시 툴팁 — 커서를 따라다니는 이름표 (+작은 섬네일) */}
    {tip && (
      <div className="st-maptip" style={{ left: tip.x, top: tip.y }}>
        {tip.img && <img src={tip.img} alt="" aria-hidden onError={(ev) => { markBad(tip.img); ev.currentTarget.style.display = "none"; }} />}
        {tip.text}
      </div>
    )}
    </div>
  );
}
