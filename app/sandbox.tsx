"use client";

// 생존연산(Reclamation Algorithm) 가이드 — 사용자 확정 2026-08-12
//
// 화면 규약 (사용자 확정 2026-08-12 "록라 소장품 도감이랑 비슷하게 카드형식으로
// 섬네일이랑 간단한 정보만 먼저 내보이고, 클릭하면 상세모달"):
//   목록 = 큰 섬네일 카드(요약만) → 클릭 = 상세 모달(그 항목의 모든 정보)
//   같은 계열의 변형(날씨 위험도 · 균열 환경압력 · 원정 편성)은 **한 카드로 묶고**
//   상세 모달 안에서 골라 본다 — 목록에 00·11·22·33이 늘어서지 않게.
//
// - 사막 이야기(sandbox_1): KR/EN/JA 공식 텍스트.
// - 신시즌 「재기동 앵커」(sandbox_2): CN 선행 — **중국어 원문이 메인, 한국어 번역이 서브**
//   (사용자 확정 — 뒤집지 말 것). 사이트 전역 '미래시 데이터 포함' 토글을 따른다.
//
// 데이터는 scripts/build-sandbox.py 산출 app/data/sandbox{,.en,.ja}.json —
// 로케일 래퍼(sandbox-ko/en/ja.tsx)가 자기 것만 정적 임포트하고 home이 lazy로 문다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { normSearch, useSearchInput } from "./search";
import { asset } from "./assets";
import { ModalWindow } from "./modal-window";
import { GLOBAL_MODAL_HASH } from "./hash-modal";
import { loadEnemies } from "./dex-cross";
import { enemyImg, enemyPath } from "./dex-paths";
import { EnemyFile, type Enemy } from "./enemy-detail";
import { StageRouteMap, enemyRouteColor, type StageRoutes } from "./stage-route-map";

// 이미지 — build-sandbox.py가 public/sandbox/{item,map,misc}/에 받아 R2로 서빙한다.
// ⚠ 폴더는 sandbox, 라우트는 /ra — 이름이 달라야 deploy.sh가 자산만 떼어낸다.
const itemIcon = (id: string) => asset(`/sandbox/item/${id}.webp`);
const stageMapImg = (id: string) => asset(`/sandbox/map/${id}.webp`);
const miscIcon = (k: string) => asset(`/sandbox/misc/${k}.webp`);
// 신시즌 보조 아이콘 — 파일명이 v2와 겹쳐(weather_normal 등) 폴더를 나눴다
const misc2Icon = (k: string) => asset(`/sandbox/misc2/${k}.webp`);
// 시즌 전체 맵 — 게임 지도 화면의 원본 배경 (사용자 요청 2026-08-12)
const worldMap = asset("/sandbox/world/sandbox_1.webp");
// 신시즌 전투 지형 프리뷰 (사용자 요청 2026-08-12 "맵 이미지같은것도 보여줘야 해")
const v3MapImg = (id: string) => asset(`/sandbox/map2/${id}.webp`);
const FOOD_ATTR_ICON: Record<string, string> = {
  SURVIVE: "survive_main", ATTACK: "attack_main", COOLDOWN: "cooldown_main",
  COST: "cost_main", SKILL_POINT: "skill_point_main", SPECIAL: "special_main",
};
const hideErr = (ev: React.SyntheticEvent<HTMLImageElement>) => { ev.currentTarget.style.display = "none"; };

// 지역 상세의 타일 격자·경로·시뮬 데이터 — 모달을 열 때만 지연 로드
let SB_ROUTES: Record<string, StageRoutes | string> | null = null;
let SB_ROUTES_LOADING: Promise<unknown> | null = null;
function loadSandboxRoutes(): Promise<unknown> {
  if (SB_ROUTES) return Promise.resolve(SB_ROUTES);
  SB_ROUTES_LOADING ??= import("./data/sandbox-routes.json").then((m) => {
    SB_ROUTES = ((m as { default?: unknown }).default ?? m) as Record<string, StageRoutes | string>;
  });
  return SB_ROUTES_LOADING;
}
function sbRoutesFor(id: string): StageRoutes | undefined {
  let d = SB_ROUTES?.[id];
  if (typeof d === "string") d = SB_ROUTES?.[d];
  return typeof d === "object" ? d : undefined;
}
// 신시즌 전투 지형의 도면·경로 — 별도 파일 (사용자 요청 2026-08-12 "전투 지형도 상세 뜨게")
let SB2_ROUTES: Record<string, StageRoutes> | null = null;
let SB2_LOADING: Promise<unknown> | null = null;
function loadSandbox2Routes(): Promise<unknown> {
  if (SB2_ROUTES) return Promise.resolve(SB2_ROUTES);
  SB2_LOADING ??= import("./data/sandbox2-routes.json").then((m) => {
    SB2_ROUTES = ((m as { default?: unknown }).default ?? m) as Record<string, StageRoutes>;
  });
  return SB2_LOADING;
}

type Item = [string, string, number, string, string];    // [이름, 용도, 희귀도, 타입, 설명]
// [번역명, CN명, 용도(CN), 희귀도, 타입, 용도(번역), 설명(CN), 설명(번역)]
type V3Item = [string, string, string, number, string, string, string, string];
type EnemyRow = [string, string, number, number, number, number, number, number, number];
export type SandboxDoc = {
  v2: {
    name: string;
    items: Record<string, Item>;
    foods: { id: string; attrs: string[]; recipes: string[][]; variants: [string, string, string][] }[];
    foodMats: [string, string, string, string, string][];
    drinkMats: [string, number][];
    crafts: { id: string; type: string; tag: string; kind: string; unlock: string; mats: Record<string, number>;
      up: Record<string, number> | null; rarity: number; out: number; wd: number; repair: number; lvs: number[] }[];
    trapTags: Record<string, [string, string]>;
    stages: [string, string, string, string, number, number][];
    stageRewards: Record<string, string[]>;
    zones: Record<string, string>;
    /** 전체 지도 위 구역 폴리곤 — 좌표는 이미지 대비 0~1 비율. buff = [이름, 효과, 플레이버] */
    zoneAreas: { id: string; name: string; ap: string; buff: [string, string, string] | null;
      c: [number, number]; v: [number, number][] }[];
    nodeCount: number;
    nodeTypes: Record<string, [string, string]>;
    /** 거점 업그레이드 [이름, 효과, 조건] */
    nodeUpgrades: [string, string, string][];
    /** 기후 종류별 묶음 — lv = [위험도, 이름, 효과, 설명, 아이콘] */
    weather: { type: string; name: string; lv: [number, string, string, string, string][] }[];
    /** 조우 — 제목 기준 묶음, 갈래(vars)마다 장면(steps)이 순서대로 */
    scenes: { title: string; icon: string; kind: string;
      vars: { fam: string; steps: { id: string; desc: string; choices: [string, string, number][] }[] }[] }[];
    rift: {
      sets: { id: string; diffs: [number, string, string[]][] }[];
      fixed: [string, string[]][];
      mains: [string, string, string, number, string, string, string][];
      subs: [string, string][];
      teams: [string, string, string, [number, string][]][];
      globals: string[];
      envs: [string, string][];
    };
    expeditions: { eff: string; rows: [string, number, number, number, number, string[]][] }[];
    techs: [string, string, number, string, string][];
    trapRewards: Record<string, [string, number]>;
    enemyRewards: Record<string, [string, number]>;
    /** 지역별 오브젝트 개수 {종류: 수} — 목록 카드에 바로 쓴다 */
    stageObjs: Record<string, Record<string, number>>;
    stageEnemies: Record<string, EnemyRow[]>;
    enemyNames: Record<string, string>;
    dex: { id: string; img: string; src: number; lv: number; st: number[]; at: [string, number][] }[];
  };
  v3: {
    name: string; cnName: string; start: number;
    items: Record<string, V3Item>;
    /** 아이템·설치물 종류 표시명 {영어키: [CN, 번역]} — 원본엔 COIN 같은 키만 있다 */
    itemTypes: Record<string, [string, string]>;
    trapTypes: Record<string, [string, string]>;
    /** 가공 레시피 — Lv 변형을 한 묶음으로. rows = [레벨, 재료, 산출수, 번영도] */
    process: { out: string; cn: string; ko: string; icon: string;
      rows: [number, Record<string, number>, number, number][] }[];
    builds: { out: string; mats: Record<string, number>; type: string; recipe: string; wd: number; cnt: number }[];
    /** 시나리오 — 노드(지도 위치)·전투 지형 배치(3×3)·초회 보상 */
    stages: { id: string; code: string; cn: string; ko: string; desc: string; descKo: string;
      day: number; power: number; grid: string[]; init: number[]; pool: string; diff: number;
      foes: string[]; first: Record<string, number>; zone: string; node: string; ntype: string }[];
    /** 전체 지도 — V2와 달리 노드 좌표가 데이터에 있다 */
    world: {
      tiles: [number, number, string, number][];
      zones: { id: string; cn: string; ko: string; ap: string; x: number | null; y: number | null }[];
      nodeTypes: Record<string, [string, string]>;
      nodes: { id: string; t: string; st: string; z: string; x: number; y: number; f: string }[];
    };
    /** [이름(번역), 이름(CN), 효과(CN), 설명(CN), 효과(번역), 설명(번역), 아이콘] */
    weather: [string, string, string, string, string, string, string][];
    /** 조우 — 한 이야기의 1·2·보스 판을 묶은 것. choices = [CN, 번역, 설명CN, 설명번역, 직군, 인원, 정예] */
    scenes: { fam: string; cn: string; ko: string;
      tiers: { tier: string; desc: string; descKo: string;
        choices: [string, string, string, string, string, number, number][] }[] }[];
    /** 전투 지형 — foes = [적id, 마릿수, 강화, hp, atk, def, res] */
    subs: { id: string; prev: string; pool: string; route: boolean; use: [string, number][];
      foes: [string, number, number, number, number, number, number][]; objs: Record<string, number> }[];
    pools: Record<string, [string, string]>;
    /** 지도 오브젝트 {트랩id: [CN이름, CN설명, 마커스타일, 아이템id, 이름번역, 설명번역]} */
    objKinds: Record<string, [string, string, string, string, string, string]>;
    enemyNames: Record<string, string>;
    enemyCn: Record<string, string>;
    enemySrc: Record<string, number>;
    /** 적 도감 — 전투 지형 전수에서 모은 대표 스탯·등장 지형 (사용자 요청 2026-08-13) */
    dex: { id: string; lv: number; st: number[]; at: [string, number][] }[];
  };
};

// 한국 서버 상설(사막 이야기)과 중국 서버 신시즌은 **메뉴를 아예 분리**한다
// (사용자 확정 2026-08-12) — 위쪽 시즌 탭으로 갈아타고, 아래 뷰 칩은 시즌마다 다르다.
const VIEWS = ["food", "craft", "stage", "enemy", "weather", "event", "rift", "tech"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = {
  food: "요리·음료", craft: "제작·설치물", stage: "지역", enemy: "적 도감", weather: "날씨",
  event: "조우", rift: "균열·원정", tech: "테크트리",
};
const V3_VIEWS = ["v3item", "v3craft", "v3map", "v3enemy", "v3stage", "v3weather", "v3event"] as const;
type V3View = (typeof V3_VIEWS)[number];
const V3_LABEL: Record<V3View, string> = {
  v3item: "아이템", v3craft: "가공·건설", v3map: "전투 지형", v3enemy: "적 도감",
  v3stage: "시나리오", v3weather: "날씨", v3event: "조우",
};
const FOOD_ATTR: Record<string, string> = {
  SURVIVE: "생존", ATTACK: "공격", COOLDOWN: "재배치", COST: "코스트", SKILL_POINT: "스킬", SPECIAL: "특수",
};
const TECH_TYPE: Record<string, string> = {
  SURVIVE: "생존", BATTLE: "전투", COLLECT: "채집", DUNGEON: "균열", SHOP: "상점",
};
// 제작·설치물 분류 (craftItemData.type — 사용자 요청 2026-08-12 "종류별로 분류")
const CRAFT_TYPE: Record<string, string> = {
  BASE_BUILDING: "거점 시설", COMBAT_BUILDING: "전투 설치물", TACTICAL: "전술 아이템",
};
// 균열 세트 이름 (riftId — 데이터에 표시명이 없어 종류로 쓴다)
const RIFT_SET: Record<string, string> = {
  random_dungeon_1: "일반 균열", hunt_dungeon_1: "사냥 균열",
};
// 지역 오브젝트 종류 → 대표 아이템 아이콘·이름 (지도 마커·자원 목록·지역 카드 공용)
// [종류, 대표 아이템 아이콘, 이름, 지도 마커 색(stage-route-map OB_STYLE과 같은 값)]
// ⚠ 파괴 가능 바위(trap_413_hiddenstone)와 보물(trap_416/422)만은 **전용 아이콘을 못 찾았다**
//    — 클뜯 에셋의 itemicon·mattypeicons·floathub·arts/enemies를 다 훑었지만 트랩은 PNG가
//    아니라 스파인 스켈레톤으로만 들어 있다. 석재·순금 아이콘을 빌려 쓰면 다른 물건으로
//    보이므로(사용자 지적 2026-08-12 "이미지가 그게 아닌데") 그 둘만 마커 모양(마름모·별)로
//    구분한다. 이름은 사용자 확정 표기 그대로.
const OB_KINDS: [string, string, string, string][] = [
  ["rock", "", "파괴 가능 바위", "#e07a3f"],
  ["stone", "sandbox_1_stone", "석재", "#cfc8bd"],
  ["iron", "sandbox_1_iron", "철광석", "#8fb3d9"],
  ["diam", "sandbox_1_diamond", "명징석", "#6fe3d4"],
  ["wood", "sandbox_1_wood", "목재", "#7fc46a"],
  ["treasure", "", "보물", "#ffd166"],
];
// 구역 오버레이 색 (경로 색과 같은 팔레트 계열)
const ROUTE_TINT = ["#ffd166", "#6ee7b7", "#7ab8ff", "#ff8fab", "#c9a0ff", "#ffa94d"];
const PROF_LABEL: Record<string, string> = {
  WARRIOR: "근위", SNIPER: "저격", TANK: "중장", MEDIC: "의료",
  SUPPORT: "보조", CASTER: "술사", SPECIAL: "특수", PIONEER: "선봉",
};

// 요리 변형 기호 — 보조 재료의 종류가 정한다. GAMMA를 β로 찍던 버그 수정 (2026-08-12)
const VAR_MARK: Record<string, string> = { NONE: "—", ALPHA: "α", BETA: "β", GAMMA: "γ" };
// 박사가 꼽은 좋은 지역 — 카드에 따봉을 단다 (사용자 지정 2026-08-12)
const PICKED: Record<string, string> = {
  sandbox_1_16: "그물망 갱도", sandbox_1_52: "부족 전쟁", sandbox_1_40: "사정거리 내",
};
// 신시즌 조우 난이도 — scene id의 꼬리 (1 · 2 · boss)
const V3_TIER: Record<string, string> = { "1": "1단계", "2": "2단계", boss: "보스" };

/** 재료 배열 → [id, 개수] 목록 (같은 재료 반복을 접는다) */
function matCounts(mats: string[]): [string, number][] {
  const cnt = new Map<string, number>();
  for (const m of mats) cnt.set(m, (cnt.get(m) ?? 0) + 1);
  return [...cnt];
}

export default function SandboxGuide({ doc, includeFuture, season = "v2" }: { doc: SandboxDoc; includeFuture?: boolean; season?: "v2" | "v3" }) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<View>("food");
  const [v3view, setV3view] = useState<V3View>("v3item");
  const { term, clear, inputProps } = useSearchInput();
  const q = normSearch(term);
  const { v2, v3 } = doc;

  const nameOf = (id: string) => v2.items[id]?.[0] ?? id;
  const p3 = (id: string) => {
    const it = v3.items[id];
    if (!it) return id;
    return it[0] !== it[1] ? `${it[1]}(${it[0]})` : it[1];
  };
  const enName = (id: string) => v2.enemyNames[id] ?? id;
  const enImgOf = (id: string, img: string, src: number) => (src === 1 ? asset(`/sandbox/enemy/${id}.webp`) : enemyImg(img));
  // 신시즌 적 — 적 도감에 있으면 그 초상, 없으면 sandbox 폴더 (build-sandbox.py enemySrc)
  const v3EnName = (id: string) => v3.enemyNames[id] ?? id;
  const v3EnImg = (id: string) => (v3.enemySrc[id] === 1 ? asset(`/sandbox/enemy/${id}.webp`) : enemyImg(id));
  /** 신시즌 지도 오브젝트 종류(트랩 id) → 마커 스타일 키 */
  const obStyle3 = (kind: string) => v3.objKinds[kind]?.[2] ?? "obj";
  /** 신시즌 표시명 — CN 원문이 메인, 한국어는 서브 (사용자 확정) */
  const ty3 = (key: string, table: Record<string, [string, string]>) => {
    const row = table[key];
    if (!row) return key;
    return locale === "ko" && row[1] && row[1] !== row[0] ? `${row[0]}(${row[1]})` : row[0];
  };

  // ── 카드 → 상세 모달 (한 상태로 종류별 모달을 돌려 쓴다) ─────────────────────
  type Detail =
    | { k: "craft"; i: number } | { k: "weather"; i: number } | { k: "event"; i: number }
    | { k: "rift"; i: number } | { k: "riftMain"; i: number } | { k: "exp"; i: number }
    | { k: "dex"; i: number } | { k: "food"; i: number } | { k: "mat"; id: string }
    | { k: "v3item"; id: string } | { k: "v3proc"; i: number } | { k: "v3build"; i: number }
    | { k: "v3stage"; i: number } | { k: "v3weather"; i: number } | { k: "v3event"; i: number }
    | { k: "zone"; i: number };
  const [detail, setDetail] = useState<Detail | null>(null);
  const [pick, setPick] = useState(0);              // 상세 안의 변형 선택 (위험도·난이도·편성)
  // 재료 창은 **두 개까지** 겹쳐 띄운다 (사용자 확정 2026-08-12): 상세에서 다른 재료를
  // 누르면 자기 자신이 바뀌지 않고 창이 하나 더 열리고, 거기서 또 누르면 **먼저 열려 있던
  // 창**이 그 재료로 바뀌며 앞으로 나온다 (두 창을 번갈아 쓰는 셈).
  const [matA, setMatA] = useState<string | null>(null);
  const [matB, setMatB] = useState<string | null>(null);
  const [matTop, setMatTop] = useState<"a" | "b">("a");   // 지금 앞에 있는 창
  const [matRaise, setMatRaise] = useState(0);            // ModalWindow z 재부여용 key
  const openMat = (id: string) => {
    setMatRaise((k) => k + 1);
    if (!matA) { setMatA(id); setMatTop("a"); return; }
    if (!matB) { setMatB(id); setMatTop("b"); return; }
    // 둘 다 떠 있으면 **뒤에 있던 창**을 새 재료로 갈아끼우고 앞으로
    if (matTop === "a") { setMatB(id); setMatTop("b"); } else { setMatA(id); setMatTop("a"); }
  };

  // 신시즌 아이템 창 — 보상·재료 칩에서 열면 **부모 모달 위에 겹쳐** 뜬다
  // (사용자 확정 2026-08-12 "자기 자신의 모달이 바뀌면 안 됨" 규칙을 따른다).
  const [v3Item, setV3Item] = useState<string | null>(null);
  const [v3Raise, setV3Raise] = useState(0);
  const openV3Item = (id: string) => { if (v3.items[id]) { setV3Item(id); setV3Raise((k) => k + 1); } };

  // 전투 지형·적 상세는 **각자 창**이다 (사용자 제보 2026-08-13: 시나리오에서 지형을 열면
  // 시나리오 모달이 꺼지고, 지형에서 적을 열면 지형 모달이 사라졌다). 상세 모달 상태가
  // 하나뿐이라 새로 열 때 갈아치우던 구조 — 창을 나눠 겹쳐 뜨게 한다.
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [subRaise, setSubRaise] = useState(0);
  const [openV3En, setOpenV3En] = useState<string | null>(null);
  const [enRaise, setEnRaise] = useState(0);

  // ── 지역 상세 모달 ───────────────────────────────────────────────────────
  type V2Stage = SandboxDoc["v2"]["stages"][number];
  const [openSt, setOpenSt] = useState<V2Stage | null>(null);
  const [mapView, setMapView] = useState<"map" | "route">("map");
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
  const [obPick, setObPick] = useState<string | null>(null);   // 자원 클릭 = 그것만 강조
  const [, bumpRoutes] = useState(0);
  const [subEnemy, setSubEnemy] = useState<Enemy | null>(null);
  const [zoom, setZoom] = useState(false);
  // 경로 색 테두리는 **이동 경로 탭에서만** — 실사 도면일 땐 원래의 어두운 테두리
  // (사용자 지시 2026-08-12). 작전 도감(stage-detail.tsx)도 같은 규약이다.
  const routeMode = mapView === "route";
  const byStId = useMemo(() => new Map(v2.stages.map((st) => [st[0], st])), [v2]);
  const resetStage = () => { setMapView("map"); setPinned(new Set()); setHover(null); setZoom(false); setObPick(null); };
  // ── URL 해시 — 탭과 지역 모달을 한 기계가 관리한다 (사용자 요청 2026-08-12 "각 탭에도 딥링크").
  //   #ra-<탭키>      예: /ra/sand#ra-craft · /ra/anchor#ra-v3map
  //   #ra-<지역 id>   예: /ra/sand#ra-sandbox_1_16  ← 기존 딥링크도 그대로 산다
  // 지역 id는 sandbox_1_… 꼴이라 탭 키와 겹치지 않는다. 탭 전환은 replaceState(히스토리를
  // 더럽히지 않는다), 모달 열기는 pushState(뒤로가기로 닫힌다) — rogue.tsx와 같은 규약.
  const hashWant = openSt ? `#ra-${openSt[0]}` : `#ra-${season === "v3" ? v3view : view}`;
  const applyHash = () => {
    const m = /^#ra-(.+)$/.exec(decodeURIComponent(window.location.hash));
    if (!m) return;
    const key = m[1];
    const st = byStId.get(key) ?? null;
    setOpenSt(st);
    if (st) {
      resetStage();
      void loadSandboxRoutes().then(() => bumpRoutes((k) => k + 1)).catch(() => { SB_ROUTES_LOADING = null; });
      return;
    }
    if (season === "v3") { if ((V3_VIEWS as readonly string[]).includes(key)) setV3view(key as V3View); }
    else if ((VIEWS as readonly string[]).includes(key)) setView(key as View);
  };
  const applyRef = useRef(applyHash);
  useEffect(() => { applyRef.current = applyHash; });
  const inited = useRef(false);
  useEffect(() => {
    applyRef.current();
    inited.current = true;
    const on = () => applyRef.current();
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    return () => { window.removeEventListener("hashchange", on); window.removeEventListener("popstate", on); };
  }, []);
  const prevHash = useRef("");
  useEffect(() => {
    if (!inited.current) return;
    if (GLOBAL_MODAL_HASH.test(window.location.hash)) return;   // #changelog 등 전역 모달 우선
    if (decodeURIComponent(window.location.hash) === hashWant) { prevHash.current = hashWant; return; }
    const opening = !!openSt && !/^#ra-sandbox_/.test(prevHash.current);
    // ⚠ vinext가 pushState를 패치해 스크롤을 리셋한다 — 네이티브를 직접 부른다 (rogue.tsx 실측)
    if (opening) History.prototype.pushState.call(history, null, "", hashWant);
    else history.replaceState(null, "", hashWant);
    prevHash.current = hashWant;
  }, [hashWant, openSt]);
  const openStage = (st: V2Stage) => {
    setOpenSt(st); resetStage();
    void loadSandboxRoutes().then(() => bumpRoutes((k) => k + 1)).catch(() => { SB_ROUTES_LOADING = null; });
  };
  const togglePin = (id: string) => setPinned((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const enemyRows = openSt ? v2.stageEnemies[openSt[0]] ?? [] : [];
  const rd = openSt ? sbRoutesFor(openSt[0]) : undefined;
  const routeOrder = rd ? enemyRows.filter((r) => rd.e[r[0]]?.length).map((r) => r[0]) : [];
  const openDexEnemy = (id: string, img: string) => {
    void loadEnemies(locale).then((m) => { setEnMap(m); setSubEnemy(m.get(id) ?? m.get(img) ?? null); });
  };
  // 적 도감 상세는 **모달을 열 때 바로 싣는다** — 링크를 한 번 더 누르게 하지 않는다
  // (사용자 지시 2026-08-13 "적도감에 있으면 바로 보여줘").
  const [dexFull, setDexFull] = useState<Enemy | null>(null);
  // 연계 소환 적의 **이름**을 찍으려면 도감 전체 맵이 필요하다 (없으면 id가 그대로 보였다 —
  // 사용자 제보 2026-08-13 "연계 소환이 제대로 안 나옴"). 한 번 받아 두고 재사용한다.
  const [enMap, setEnMap] = useState<Map<string, Enemy> | null>(null);
  const loadDexFull = (id: string, img: string) => {
    setDexFull(null);
    void loadEnemies(locale).then((m) => { setEnMap(m); setDexFull(m.get(id) ?? m.get(img) ?? null); });
  };
  /** 적 이름 — 도감 맵 → 생존연산 이름표 → id */
  const anyEnName = (id: string) => enMap?.get(id)?.name ?? v2.enemyNames[id] ?? v3.enemyNames[id] ?? id;

  // 자원·오브젝트 — 지도엔 파괴 가능 바위만, 목록엔 전부 (클릭 = 그것만 강조)
  const OB_LIST = OB_KINDS;
  const obCounts: Record<string, number> = {};
  for (const [k] of rd?.ob ?? []) obCounts[k] = (obCounts[k] ?? 0) + 1;

  const match = (s: string) => !q || normSearch(s).includes(q);

  // ── 재료도 카드+상세 모달 (사용자 확정 2026-08-12 "요리/음료에 있는 모든 재료에 대해서
  // 다 카드형식 + 상세모달"). 재료 이름은 어디에 나오든 눌러서 상세를 열 수 있다. ──
  const matMeta = useMemo(() => {
    const m = new Map<string, { id: string; role: string; variant: string; buff: string; water: number;
      usedIn: [string, string][]; from: string[] }>();
    const get = (id: string) => m.get(id) ?? m.set(id, { id, role: "", variant: "", buff: "", water: 0, usedIn: [], from: [] }).get(id)!;
    for (const fm of v2.foodMats) { const e = get(fm[0]); e.role = fm[1]; e.variant = fm[3]; e.buff = fm[4]; }
    for (const dm of v2.drinkMats) get(dm[0]).water = dm[1];
    // ⚠ 한 요리에 조합이 여러 개면 같은 이름이 여러 번 들어간다 — 요리 단위로 한 번만
    //   (사용자 지적 2026-08-12 "쓰이는 요리에 중복이 엄청나게 많음")
    for (const f of v2.foods) {
      const nm = f.variants[0]?.[1] ?? f.id;
      const ids = new Set(f.recipes.flat());
      for (const id of ids) {
        const e = get(id);
        if (!e.usedIn.some(([fid]) => fid === f.id)) e.usedIn.push([f.id, nm]);
      }
    }
    // 어디서 얻나 — 오브젝트 파괴·적 처치 보상 역색인
    for (const [trapId, rw] of Object.entries(v2.trapRewards)) {
      const e = m.get(rw[0]); if (e) e.from.push(t("오브젝트 채집") + ` ×${rw[1]}`);
      void trapId;
    }
    for (const [eid, rw] of Object.entries(v2.enemyRewards)) {
      const e = m.get(rw[0]);
      if (e) { const nm = v2.enemyNames[eid]; if (nm && !e.from.includes(nm)) e.from.push(nm); }
    }
    return m;
  }, [v2]);  // eslint-disable-line react-hooks/exhaustive-deps
  /** 재료 칩 — 누르면 그 재료 상세 모달 */
  const matChip = (id: string, n?: number) => (
    <button key={id} type="button" className="sb-matchip" onClick={() => openDetail({ k: "mat", id })}>
      <img src={itemIcon(id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
      {nameOf(id)}{n && n > 1 ? <em>×{n}</em> : null}
    </button>
  );
  const matChips = (mats: string[]) => <span className="sb-matline">{matCounts(mats).map(([id, n]) => matChip(id, n))}</span>;
  // 요리·음료에 쓰이는 모든 재료 (주재료·보조·음료용 + 조합에 등장하는 것 전부)
  const allMats = useMemo(() => {
    const ids = new Set<string>([...v2.foodMats.map((x) => x[0]), ...v2.drinkMats.map((x) => x[0])]);
    for (const f of v2.foods) for (const r of f.recipes) for (const id of r) ids.add(id);
    return [...ids].filter((id) => match(nameOf(id)));
  }, [v2, q]);  // eslint-disable-line react-hooks/exhaustive-deps

  const searchable = season === "v3" ? (v3view === "v3item" || v3view === "v3enemy")
    : (view === "food" || view === "craft" || view === "enemy" || view === "stage");

  // ── 목록들 ──────────────────────────────────────────────────────────────
  const foods = useMemo(() => v2.foods.filter((f) => !q || f.variants.some((v) => normSearch(v[1]).includes(q))
    || f.recipes.some((r) => r.some((m) => normSearch(nameOf(m)).includes(q)))), [v2, q]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [craftType, setCraftType] = useState("");
  const crafts = useMemo(() => v2.crafts.filter((c) => (!craftType || c.type === craftType) && match(nameOf(c.id))), [v2, q, craftType]);  // eslint-disable-line react-hooks/exhaustive-deps
  // 지역 — 획득 자원별 필터 (게임 데이터에 지역↔노드 종류 고정 매핑이 없다)
  const [resFilter, setResFilter] = useState("");
  const resKinds = useMemo(() => {
    const c = new Map<string, number>();
    for (const ids of Object.values(v2.stageRewards)) for (const id of ids) c.set(id, (c.get(id) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]);
  }, [v2]);
  const stages = useMemo(() => v2.stages.filter((s) => {
    if (!match(s[2]) && !match(s[3])) return false;
    if (!resFilter) return true;
    if (resFilter.startsWith("ob:")) return !!v2.stageObjs[s[0]]?.[resFilter.slice(3)];
    return (v2.stageRewards[s[0]] ?? []).includes(resFilter);
  }), [v2, q, resFilter]);  // eslint-disable-line react-hooks/exhaustive-deps
  // 오브젝트 종류별 지역 수 — 필터 칩에 쓴다
  const obKindCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const objs of Object.values(v2.stageObjs)) for (const k of Object.keys(objs)) c.set(k, (c.get(k) ?? 0) + 1);
    return c;
  }, [v2]);
  const dex = useMemo(() => [...v2.dex].sort((a, b) => b.st[0] - a.st[0])
    .filter((e) => match(enName(e.id))), [v2, q]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── 신시즌 목록 상태 ─────────────────────────────────────────────────────
  const [v3type, setV3type] = useState("");     // 아이템 종류 필터
  const [v3pool, setV3pool] = useState("");     // 전투 지형 지형 풀 필터
  const v3ItemTypes = useMemo(() => {
    const c = new Map<string, number>();
    for (const it of Object.values(v3.items)) if (it[4]) c.set(it[4], (c.get(it[4]) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]);
  }, [v3]);
  const v3dex = useMemo(() => v3.dex.filter((e) => match(v3.enemyNames[e.id] ?? "")
    || match(v3.enemyCn[e.id] ?? "")), [v3, q]);  // eslint-disable-line react-hooks/exhaustive-deps
  const zoneIdx = (zid: string) => v3.world.zones.findIndex((z) => z.id === zid);
  const zoneName = (zid: string) => {
    const z = v3.world.zones.find((x) => x.id === zid);
    if (!z) return "";
    return locale === "ko" && z.ko !== z.cn ? `${z.cn}(${z.ko})` : z.cn;
  };
  const subPrev = (sid: string) => v3.subs.find((s2) => s2.id === sid)?.prev ?? "";
  const subOf = (sid: string) => v3.subs.find((s2) => s2.id === sid);
  // 격자 지도의 좌표 범위 — 타일이 불규칙한 섬 모양이라 데이터에서 뽑는다
  const worldBox = useMemo(() => {
    const xs = v3.world.tiles.map((t2) => t2[0]).concat(v3.world.nodes.map((n) => n.x));
    const ys = v3.world.tiles.map((t2) => t2[1]).concat(v3.world.nodes.map((n) => n.y));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { x: x0, y: y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }, [v3]);

  const views = VIEWS;
  const openDetail = (d: Detail) => {
    if (d.k === "mat") { openMat(d.id); return; }
    if (d.k === "dex") {
      const e = v2.dex[d.i];
      if (e && e.src === 0) loadDexFull(e.id, e.img); else setDexFull(null);
    }
    setDetail(d); setPick(0);
  };
  /** 전투 지형 상세 — 지역 상세와 같은 재료(도면·경로·적), 파일만 다르다 */
  const openTerrain = (id: string) => {
    resetStage();
    setOpenSub(id); setSubRaise((k) => k + 1);
    void loadSandbox2Routes().then(() => bumpRoutes((k) => k + 1)).catch(() => { SB2_LOADING = null; });
  };
  /** 신시즌 적 상세 — 적 도감에 있으면 도감 본문까지 같이 싣는다 */
  const openV3Enemy = (id: string) => {
    if (!v3.dex.some((e) => e.id === id)) return;
    setOpenV3En(id); setEnRaise((k) => k + 1);
    if (v3.enemySrc[id] === 0) loadDexFull(id, id); else setDexFull(null);
  };

  /** 재료 상세 모달 한 장 — A·B 두 슬롯이 같은 본문을 쓴다 */
  const matModal = (id: string, slot: "a" | "b") => {
    const mm = matMeta.get(id);
    const it = v2.items[id];
    return (
      <ModalWindow key={`${slot}-${matRaise}`} label={nameOf(id)} className="operator-modal sb-modal"
        onClose={() => (slot === "a" ? setMatA(null) : setMatB(null))}>
        <div className="sb-dt">
          <header className="sb-dt-head">
            <img src={itemIcon(id)} alt="" aria-hidden onError={hideErr} />
            <div>
              <h2>{nameOf(id)}</h2>
              <p className="sb-cmeta">
                {mm?.role && <i className="sb-chip">{mm.role === "SUB" ? t("보조 재료") : t("주재료")}</i>}
                {mm?.variant && mm.variant !== "NONE" && <i className="sb-chip">{VAR_MARK[mm.variant]} {t("변형")}</i>}
                {mm?.water ? <i className="sb-chip">{t("수분")} {mm.water}</i> : null}
              </p>
            </div>
          </header>
          {it?.[1] && <p>{it[1]}</p>}
          {it?.[4] && <p className="sb-dim">{it[4]}</p>}
          {mm?.buff && (<><h4>{t("요리 효과")}</h4><p>{mm.buff}</p></>)}
          {mm?.from.length ? (<><h4>{t("얻는 곳")}</h4><p>{mm.from.join(" · ")}</p></>) : null}
          {mm?.usedIn.length ? (
            <>
              <h4>{t("쓰이는 요리")} <em className="sb-count">{mm.usedIn.length}</em></h4>
              <span className="sb-matline">
                {mm.usedIn.map(([fid, nm]) => {
                  const fi = v2.foods.findIndex((f) => f.id === fid);
                  return (
                    <button key={fid} type="button" className="sb-matchip"
                      onClick={() => { if (fi >= 0) { setDetail({ k: "food", i: fi }); setPick(0); } }}>
                      <img src={itemIcon(fid)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                      {nm}
                    </button>
                  );
                })}
              </span>
            </>
          ) : null}
          {/* 같은 요리에 들어가는 다른 재료로 이어 보기 — 누르면 창이 하나 더 열린다 */}
          {mm?.usedIn.length ? (
            <>
              <h4>{t("함께 쓰이는 재료")}</h4>
              <span className="sb-matline">
                {[...new Set(v2.foods.filter((f) => f.recipes.some((r) => r.includes(id)))
                  .flatMap((f) => f.recipes.flat()).filter((x) => x !== id))].map((x) => matChip(x))}
              </span>
            </>
          ) : null}
        </div>
      </ModalWindow>
    );
  };

  /** 신시즌 아이템 칩 — 누르면 그 아이템 상세가 겹쳐 열린다 (보상·재료 공용) */
  const v3chip = (id: string, n?: number) => (
    <button key={id} type="button" className="sb-matchip" onClick={() => openV3Item(id)}>
      <img src={itemIcon(id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
      {p3(id)}{n && n > 1 ? <em>×{n}</em> : null}
    </button>
  );
  /** 신시즌 아이템 상세 본문 — 상세 모달과 겹침 창이 같은 본문을 쓴다 */
  const v3ItemBody = (id: string) => {
    const it = v3.items[id];
    if (!it) return null;
    const usedProc = v3.process.filter((r) => r.out === id || r.rows.some((x) => id in x[1]));
    const usedBuild = v3.builds.filter((bd) => bd.out === id || id in bd.mats);
    return (
      <div className="sb-dt">
        <header className="sb-dt-head">
          <img src={itemIcon(id)} alt="" aria-hidden onError={hideErr} />
          <div>
            <h2>{it[1]}{locale === "ko" && it[0] !== it[1] && <span className="sb-cn">{it[0]}</span>}</h2>
            <p className="sb-cmeta">{it[4] && <i className="sb-chip">{ty3(it[4], v3.itemTypes)}</i>}</p>
          </div>
        </header>
        {it[2] && <p>{it[2]}{locale === "ko" && it[5] && it[5] !== it[2] && <span className="sb-trline">{it[5]}</span>}</p>}
        {it[6] && <p className="sb-dim">{it[6]}{locale === "ko" && it[7] && it[7] !== it[6] && <span className="sb-trline">{it[7]}</span>}</p>}
        {usedProc.length > 0 && (
          <>
            <h4>{t("가공 레시피")}</h4>
            <ul className="sb-recipes">
              {usedProc.map((r, i) => (
                <li key={i}>{r.out ? `${p3(r.out)}${r.rows[0][2] > 1 ? ` ×${r.rows[0][2]}` : ""}` : `${r.cn}${locale === "ko" && r.ko !== r.cn ? `(${r.ko})` : ""}`}
                  {r.rows[0][3] > 0 ? ` · ${t("번영도")} +${r.rows[0][3]}` : ""} ← {Object.entries(r.rows[0][1]).map(([mid, n]) => `${p3(mid)} ×${n}`).join(" + ")}
                  {r.rows.length > 1 ? ` (Lv.${r.rows[0][0]}~${r.rows[r.rows.length - 1][0]})` : ""}</li>
              ))}
            </ul>
          </>
        )}
        {usedBuild.length > 0 && (
          <>
            <h4>{t("건설 레시피")}</h4>
            <ul className="sb-recipes">
              {usedBuild.map((bd, i) => <li key={i}>{p3(bd.out)} ← {Object.entries(bd.mats).map(([mid, n]) => `${p3(mid)} ×${n}`).join(" + ")}</li>)}
            </ul>
          </>
        )}
      </div>
    );
  };

  /** 카드 그리드 공용 래퍼 */
  const card = (key: string, onClick: () => void, inner: React.ReactNode, cls = "") => (
    <button key={key} type="button" className={`sb-card sb-clickable ${cls}`} onClick={onClick}>{inner}</button>
  );

  return (
    <section className="sb-guide" aria-labelledby="sb-title">
      <header className="sim-head">
        <span className="section-no">RECLAMATION ALGORITHM</span>
        <h2 id="sb-title">{season === "v3" ? v3.cnName : v2.name}
          <span className="sb-season-sub">{season === "v3" ? t("중국 서버 선행") : t("한국 서버 상설")}</span>
        </h2>
      </header>
      {season === "v2" ? (
        <>
          <p className="sim-intro">{t("생존연산 상설 「사막 이야기」의 요리 조합, 제작·설치물 재료, 지역과 날씨, 조우 선택지, 균열 목표를 게임 데이터에서 그대로 정리했습니다.")}</p>
          {!includeFuture && (
            <p className="sim-note">{t("중국 서버 선행 신시즌 「재기동 앵커」는 헤더의 '미래시 데이터 포함'을 켜면 메뉴에 나타납니다.")}</p>
          )}
        </>
      ) : (
        <p className="sim-intro">{t("중국 서버 선행 신시즌입니다 — 원문(중국어)이 기준이고, 괄호·옆의 한국어는 비공식 번역입니다.")}</p>
      )}

      <div className="sb-views" role="tablist" aria-label={t("생존연산 보기")}>
        {season === "v2" ? views.map((vw) => (
          <button key={vw} type="button" role="tab" aria-selected={view === vw}
            className={view === vw ? "on" : ""} onClick={() => setView(vw)}>{t(VIEW_LABEL[vw])}</button>
        )) : V3_VIEWS.map((vw) => (
          <button key={vw} type="button" role="tab" aria-selected={v3view === vw}
            className={v3view === vw ? "on" : ""} onClick={() => setV3view(vw)}>{t(V3_LABEL[vw])}</button>
        ))}
      </div>

      {searchable && (
        <div className="search-wrap heading-search sim-search sb-search">
          <span>⌕</span>
          <input {...inputProps} placeholder={t("이름·재료 검색")} autoComplete="off" spellCheck={false} />
          <button type="button" className="search-clear" onClick={() => clear()} aria-label={t("검색어 지우기")}>×</button>
        </div>
      )}

      {/* ── 요리·음료 ── */}
      {season === "v2" && view === "food" && (
        <>
          <p className="sim-note">{t("재료 조합이 같으면 같은 요리가 나옵니다.")} {t("주재료로 요리를 정하고, 보조 재료를 함께 넣으면 그 재료의 종류에 따라 α·β·γ 변형이 됩니다 — α는 능력치가 하나 더 붙고, β(조미료)는 지속 시간이 늘며, γ는 공격 계열 효과가 크게 붙습니다.")}</p>
          <div className="sb-cards">
            {foods.map((f, i) => card(f.id, () => openDetail({ k: "food", i: v2.foods.indexOf(f) }), (
              <>
                <img className="sb-thumb" src={itemIcon(f.id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                <b className="sb-cname">{f.variants[0]?.[1] ?? f.id}</b>
                <span className="sb-cmeta">
                  {f.attrs.map((a) => (
                    <i key={a} className={`sb-chip a-${a}`}>
                      {FOOD_ATTR_ICON[a] && <img src={miscIcon(FOOD_ATTR_ICON[a])} alt="" aria-hidden onError={hideErr} />}
                      {t(FOOD_ATTR[a] ?? a)}
                    </i>
                  ))}
                </span>
                <span className="sb-cdesc">{f.recipes[0] ? matCounts(f.recipes[0]).map(([id, n]) => `${nameOf(id)}${n > 1 ? ` ×${n}` : ""}`).join(" + ") : t("정해진 조합 없음")}</span>
              </>
            )))}
          </div>
          <h3 className="sb-h3">{t("재료")} <em className="sb-count">{allMats.length}</em></h3>
          <p className="sim-note">{t("요리·음료에 쓰이는 모든 재료입니다. 누르면 효과와 쓰이는 요리, 얻는 곳이 나옵니다.")}</p>
          <div className="sb-cards">
            {allMats.map((id) => {
              const mm = matMeta.get(id);
              return card(`mat-${id}`, () => openDetail({ k: "mat", id }), (
                <>
                  <img className="sb-thumb" src={itemIcon(id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                  <b className="sb-cname">{nameOf(id)}</b>
                  <span className="sb-cmeta">
                    {mm?.role && <i className="sb-chip">{mm.role === "SUB" ? t("보조") : t("주재료")}</i>}
                    {mm?.variant && VAR_MARK[mm.variant] && mm.variant !== "NONE" && <i className="sb-chip">{VAR_MARK[mm.variant]}</i>}
                    {mm?.water ? <i className="sb-chip">{t("수분")} {mm.water}</i> : null}
                  </span>
                  <span className="sb-cdesc">{mm?.buff || v2.items[id]?.[1] || ""}</span>
                </>
              ));
            })}
          </div>
        </>
      )}

      {/* ── 제작·설치물 (종류별 분류 + 카드) ── */}
      {season === "v2" && view === "craft" && (
        <>
          <div className="sb-filters">
            <button type="button" className={craftType === "" ? "on" : ""} onClick={() => setCraftType("")}>{t("전체")} <em>{v2.crafts.length}</em></button>
            {Object.entries(CRAFT_TYPE).map(([k, label]) => (
              <button key={k} type="button" className={craftType === k ? "on" : ""} onClick={() => setCraftType(k)}>
                {t(label)} <em>{v2.crafts.filter((c) => c.type === k).length}</em>
              </button>
            ))}
          </div>
          <div className="sb-cards">
            {crafts.map((c) => card(c.id, () => openDetail({ k: "craft", i: v2.crafts.indexOf(c) }), (
              <>
                <img className="sb-thumb" src={itemIcon(c.id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                <b className="sb-cname">{nameOf(c.id)}</b>
                <span className="sb-cmeta">
                  {c.tag && v2.trapTags[c.tag] && (
                    <i className="sb-chip">
                      {v2.trapTags[c.tag][1] && <img src={miscIcon(v2.trapTags[c.tag][1])} alt="" aria-hidden onError={hideErr} />}
                      {v2.trapTags[c.tag][0]}
                    </i>
                  )}
                  {c.lvs.length > 1 && <i className="sb-chip">Lv.{c.lvs[c.lvs.length - 1]}</i>}
                </span>
                <span className="sb-cdesc">
                  {Object.entries(c.mats).map(([id, n]) => `${nameOf(id)} ×${n}`).join(" + ") || "—"}
                </span>
              </>
            )))}
          </div>
        </>
      )}

      {/* ── 지역 (획득 자원 필터 + 카드) ── */}
      {season === "v2" && view === "stage" && (
        <>
          <h3 className="sb-h3">{t("전체 지도")}</h3>
          {/* ⚠ 노드 개별 좌표는 게임 데이터에 없다 — mapData.nodes에는 minDistance뿐이고
              (127개 전부 확인) 배치는 판마다 새로 뽑힌다. 그래서 지도에는 **구역**을 얹고,
              구역을 누르면 그 구역의 고유 효과를 보여준다 (사용자 요청 2026-08-12). */}
          <p className="sim-note">{t("구역 경계를 지도 위에 표시했습니다 — 구역을 누르면 그 구역의 정보가 열립니다. 노드 {n}개는 매 판 이 구역들 안에 새로 뽑혀 배치되므로 게임 데이터에 고정 좌표가 없습니다 (좌표 대신 최소 간격만 들어 있습니다).", { n: String(v2.nodeCount) })}</p>
          <div className="sb-worldwrap">
            <img className="sb-worldmap" src={worldMap} alt={t("전체 지도")} loading="lazy" decoding="async" onError={hideErr} />
            {/* 구역 폴리곤 오버레이 — 좌표가 0~1 비율이라 이미지 크기와 무관하다 */}
            <svg className="sb-worldsvg" viewBox="0 0 1 1" preserveAspectRatio="none">
              {v2.zoneAreas.map((z, i) => (
                <polygon key={z.id} points={z.v.map((pt) => pt.join(",")).join(" ")}
                  fill={ROUTE_TINT[i % ROUTE_TINT.length]} fillOpacity={0.16}
                  stroke={ROUTE_TINT[i % ROUTE_TINT.length]} strokeWidth={0.003}
                  className="sb-zonepoly" onClick={() => openDetail({ k: "zone", i })}>
                  <title>{z.name}</title>
                </polygon>
              ))}
            </svg>
            <div className="sb-worldlabels">
              {v2.zoneAreas.map((z, i) => (
                <button key={z.id} type="button" style={{ left: `${z.c[0] * 100}%`, top: `${z.c[1] * 100}%` }}
                  onClick={() => openDetail({ k: "zone", i })}>{z.name}{z.buff && <em>!</em>}</button>
              ))}
            </div>
          </div>
          <h3 className="sb-h3">{t("노드 종류")} <em className="sb-count">{Object.keys(v2.nodeTypes).length}</em></h3>
          <p className="sim-note">{t("지도에 배치되는 노드 종류입니다 — 어느 지역이 어느 노드에 놓이는지는 게임이 매번 새로 뽑기 때문에 데이터에 고정 매핑이 없습니다. 대신 아래에서 자원으로 지역을 걸러 보세요.")}</p>
          <div className="sb-nodekey">
            {Object.entries(v2.nodeTypes).map(([k, nt]) => (
              <span key={k}>
                {nt[1] && <img src={miscIcon(nt[1])} alt="" aria-hidden loading="lazy" onError={hideErr} />}
                {nt[0]}
              </span>
            ))}
          </div>
          {v2.nodeUpgrades.length > 0 && (
            <>
              <h3 className="sb-h3">{t("거점 강화")}</h3>
              <p className="sim-note">{t("노드에 시설을 세우면 그 거점에 붙는 상시 효과입니다.")}</p>
              <div className="sb-cards">
                {v2.nodeUpgrades.map((u, i) => (
                  <article key={i} className="sb-card sb-card-noimg">
                    <b className="sb-cname">{u[0]}</b>
                    <span className="sb-cdesc">{u[1]}</span>
                    <span className="sb-cmeta"><i className="sb-chip">{u[2]}</i></span>
                  </article>
                ))}
              </div>
            </>
          )}
          <h3 className="sb-h3">{t("지역")} <em className="sb-count">{stages.length}</em></h3>
          <p className="sim-note">{t("지역을 누르면 등장 적과 타일 도면·이동 경로 상세가 열립니다. 아래에서 획득 자원으로 걸러 볼 수 있습니다.")}</p>
          <div className="sb-filters">
            <button type="button" className={resFilter === "" ? "on" : ""} onClick={() => setResFilter("")}>{t("전체")}</button>
            {resKinds.map(([id, n]) => (
              <button key={id} type="button" className={resFilter === id ? "on" : ""} onClick={() => setResFilter(id)}>
                <img src={itemIcon(id)} alt="" aria-hidden onError={hideErr} />{nameOf(id)} <em>{n}</em>
              </button>
            ))}
            {OB_KINDS.filter(([k]) => obKindCounts.get(k)).map(([k, iid, label, color]) => (
              <button key={`ob-${k}`} type="button" className={resFilter === `ob:${k}` ? "on" : ""}
                onClick={() => setResFilter(`ob:${k}`)}>
                {iid ? <img src={itemIcon(iid)} alt="" aria-hidden onError={hideErr} />
                  : <i className="dot" style={{ background: color }} aria-hidden />}
                {t(label)} <em>{obKindCounts.get(k)}</em>
              </button>
            ))}
          </div>
          <div className="sb-grid">
            {stages.map((s) => (
              <button key={s[0]} type="button" className="sb-card sb-map-card sb-clickable" onClick={() => openStage(s)}>
                <img src={stageMapImg(s[0])} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                {PICKED[s[0]] && <i className="sb-pick" title={t("박사 추천 지역")}>👍</i>}
                <h4><i className="sb-chip">{s[1]}</i>{s[2]}
                  <i className="sb-lv">{t("행동력")} {s[4]}{s[5] !== s[4] ? ` · ⚔${s[5]}` : ""}</i></h4>
                {/* 획득 자원 + 지도에 놓인 오브젝트 개수. 같은 자원이 양쪽에 있으면
                    **개수 있는 쪽만** 남긴다 (사용자 지적 2026-08-12 "두 개 중첩"). */}
                {(() => {
                  const objs = OB_KINDS.filter(([k]) => v2.stageObjs[s[0]]?.[k]);
                  const covered = new Set(objs.map(([, iid]) => iid));
                  const plain = (v2.stageRewards[s[0]] ?? []).filter((id) => !covered.has(id));
                  if (!objs.length && !plain.length) return null;
                  return (
                    <span className="sb-stres">
                      {objs.map(([k, iid, label, color]) => (
                        <i key={`ob-${k}`} className="ob">
                          {iid ? <img src={itemIcon(iid)} alt="" aria-hidden loading="lazy" onError={hideErr} />
                            : <b className="dot" style={{ background: color }} aria-hidden />}
                          {t(label)} <b>×{v2.stageObjs[s[0]][k]}</b>
                        </i>
                      ))}
                      {plain.map((id) => (
                        <i key={id}><img src={itemIcon(id)} alt="" aria-hidden loading="lazy" onError={hideErr} />{nameOf(id)}</i>
                      ))}
                    </span>
                  );
                })()}
                <p className="sb-dim">{s[3]}</p>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── 적 도감 ── */}
      {season === "v2" && view === "enemy" && (
        <>
          <p className="sim-note">{t("생존연산에 나오는 적입니다. 스탯은 가장 강화된 등장 기준이며, 누르면 등장 지역과 처치 보상이 나옵니다.")}</p>
          <div className="sb-cards">
            {dex.map((e) => card(e.id, () => openDetail({ k: "dex", i: v2.dex.indexOf(e) }), (
              <>
                <img className="sb-thumb sb-thumb-en" src={enImgOf(e.id, e.img, e.src)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                <b className="sb-cname">{enName(e.id)}{e.lv > 0 && <em className="sb-lv">★{e.lv}</em>}</b>
                <span className="sb-cdesc">HP {e.st[0].toLocaleString()} · {t("공격")} {e.st[1].toLocaleString()}</span>
                <span className="sb-cmeta">
                  <i className="sb-chip">{t("{n}개 지역", { n: String(e.at.length) })}</i>
                  {v2.enemyRewards[e.id] && (
                    <i className="sb-chip">
                      <img src={itemIcon(v2.enemyRewards[e.id][0])} alt="" aria-hidden onError={hideErr} />
                      {nameOf(v2.enemyRewards[e.id][0])}
                    </i>
                  )}
                </span>
              </>
            )))}
          </div>
        </>
      )}

      {/* ── 날씨 (기후별 한 카드, 상세에서 위험도) ── */}
      {season === "v2" && view === "weather" && (
        <div className="sb-cards">
          {v2.weather.map((w, i) => card(w.type, () => openDetail({ k: "weather", i }), (
            <>
              {w.lv[w.lv.length - 1][4] && (
                <img className="sb-thumb sb-thumb-dim" src={miscIcon(w.lv[w.lv.length - 1][4])} alt="" aria-hidden loading="lazy" onError={hideErr} />
              )}
              <b className="sb-cname">{w.name}</b>
              <span className="sb-cmeta">
                {w.lv.map((l) => <i key={l[0]} className={`sb-chip${l[0] >= 3 ? " warn" : ""}`}>{l[0] === 0 ? t("쾌청") : t("위험 {n}", { n: String(l[0]) })}</i>)}
              </span>
              <span className="sb-cdesc">{w.lv[w.lv.length - 1][2]}</span>
            </>
          )))}
        </div>
      )}

      {/* ── 조우 (섬네일+이름, 상세는 모달) — 여러 장면·갈래로 이어지는 조우는 한 카드 ── */}
      {season === "v2" && view === "event" && (
        <>
          <p className="sim-note">{t("이어지는 장면과 갈래는 한 조우로 묶었습니다 — 카드를 누르면 갈래를 골라 장면 순서대로 볼 수 있습니다.")}</p>
          <div className="sb-cards">
            {v2.scenes.map((sc, i) => card(sc.title + i, () => openDetail({ k: "event", i }), (
              <>
                {sc.icon && <img className="sb-thumb sb-thumb-dim" src={miscIcon(sc.icon)} alt="" aria-hidden loading="lazy" onError={hideErr} />}
                <b className="sb-cname">{sc.title}</b>
                <span className="sb-cmeta">
                  {sc.kind && <i className="sb-chip">{sc.kind}</i>}
                  {sc.vars.length > 1 && <i className="sb-chip">{t("{n}갈래", { n: String(sc.vars.length) })}</i>}
                  {sc.vars[0].steps.length > 1 && <i className="sb-chip">{t("장면 {n}", { n: String(sc.vars[0].steps.length) })}</i>}
                </span>
                <span className="sb-cdesc">{sc.vars[0].steps[0]?.desc}</span>
              </>
            )))}
          </div>
        </>
      )}

      {/* ── 균열·원정 ── */}
      {season === "v2" && view === "rift" && (
        <>
          <h3 className="sb-h3">{t("균열")}</h3>
          <p className="sim-note">{t("환경압력(난이도)은 카드 안에서 골라 봅니다. 보상은 그 난이도에서 나오는 자원입니다.")}</p>
          <div className="sb-cards">
            {v2.rift.sets.map((r, i) => card(r.id, () => openDetail({ k: "rift", i }), (
              <>
                <img className="sb-thumb sb-thumb-dim" src={miscIcon(v2.rift.envs[0]?.[1] ?? "")} alt="" aria-hidden loading="lazy" onError={hideErr} />
                <b className="sb-cname">{t(RIFT_SET[r.id] ?? r.id)}</b>
                <span className="sb-cmeta"><i className="sb-chip">{t("환경압력 0~{n}", { n: String(r.diffs[r.diffs.length - 1][0]) })}</i></span>
                <span className="sb-cdesc">
                  {[...new Set(r.diffs.flatMap((dd) => dd[2]))].slice(0, 4).map(nameOf).join(" · ")}
                </span>
              </>
            )))}
            {v2.rift.fixed.map(([nm, rw], i) => (
              <div key={`fx${i}`} className="sb-card">
                <b className="sb-cname">{nm}</b>
                <span className="sb-cmeta"><i className="sb-chip">{t("고정 균열")}</i></span>
                <span className="sb-cdesc sb-obs-inline">
                  {rw.map((id) => <i key={id}><img src={itemIcon(id)} alt="" aria-hidden loading="lazy" onError={hideErr} />{nameOf(id)}</i>)}
                </span>
              </div>
            ))}
          </div>

          <h3 className="sb-h3">{t("주 목표")} <em className="sb-count">{v2.rift.mains.length}</em></h3>
          <div className="sb-cards">
            {v2.rift.mains.map((m, i) => card(`main${i}`, () => openDetail({ k: "riftMain", i }), (
              <>
                {m[5] && <img className="sb-thumb sb-thumb-dim" src={miscIcon(m[5])} alt="" aria-hidden loading="lazy" onError={hideErr} />}
                <b className="sb-cname">{m[1]}</b>
                <span className="sb-cmeta">
                  {m[3] > 0 && <i className="sb-chip">{t("{n}일", { n: String(m[3]) })}</i>}
                  {m[4] && <i className="sb-chip">{m[4]}</i>}
                </span>
                <span className="sb-cdesc">{m[2]}</span>
              </>
            )))}
          </div>

          <h3 className="sb-h3">{t("추가 목표")}</h3>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("이름")}</th><th>{t("내용")}</th></tr></thead>
            <tbody>{v2.rift.subs.map((sv, i) => <tr key={i}><td>{sv[0]}</td><td>{sv[1]}</td></tr>)}</tbody>
          </table></div>

          <h3 className="sb-h3">{t("파견 팀 특성")}</h3>
          <div className="sb-cards">
            {v2.rift.teams.map((tm, i) => (
              <div key={i} className="sb-card">
                {tm[2] && <img className="sb-thumb sb-thumb-dim" src={miscIcon(tm[2])} alt="" aria-hidden loading="lazy" onError={hideErr} />}
                <b className="sb-cname">{tm[0]}</b>
                <span className="sb-cdesc">{tm[1]}</span>
                <ul className="sb-choices">
                  {tm[3].map(([lv, dsc]) => <li key={lv}><b>Lv.{lv}</b> <span>{dsc}</span></li>)}
                </ul>
              </div>
            ))}
          </div>

          <h3 className="sb-h3">{t("원정")} <em className="sb-count">{v2.expeditions.length}</em></h3>
          <p className="sim-note">{t("같은 성과의 원정은 한 카드로 묶었습니다 — 편성(인원·정예화·기간)은 상세에서 고릅니다.")}</p>
          <div className="sb-cards">
            {v2.expeditions.map((e, i) => card(`exp${i}`, () => openDetail({ k: "exp", i }), (
              <>
                <b className="sb-cname">{e.eff}</b>
                <span className="sb-cmeta"><i className="sb-chip">{t("{n}가지 편성", { n: String(e.rows.length) })}</i></span>
                <span className="sb-cdesc">{e.rows[0][0]}</span>
              </>
            )))}
          </div>
        </>
      )}

      {/* ── 테크트리 ── */}
      {season === "v2" && view === "tech" && (
        <>
          <p className="sim-note">{t("주둔지 연구 노트로 해금하는 상시 강화입니다. 숫자는 필요한 토큰입니다.")}</p>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("기술")}</th><th>{t("계열")}</th><th>{t("토큰")}</th><th>{t("효과")}</th></tr></thead>
            <tbody>
              {v2.techs.map((tc, i) => (
                <tr key={i}>
                  <td className="sb-cell-ico">{tc[4] && <img className="sb-ico sb-ico-dim" src={miscIcon(tc[4])} alt="" aria-hidden loading="lazy" onError={hideErr} />}{tc[0]}</td>
                  <td>{t(TECH_TYPE[tc[1]] ?? tc[1])}</td><td>{tc[2]}</td><td>{tc[3]}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      {/* ── 신시즌 (CN 메인 · 한국어 서브) ── */}
      {/* ── 신시즌 — 사막 이야기와 **같은 카드+상세 모달 규격** (사용자 확정 2026-08-12).
           CN 원문이 메인, 한국어 번역이 서브 병기. ── */}
      {season === "v3" && (
        <>
          {locale !== "ko" && <p className="sim-note">{t("이 신시즌의 공식 번역은 아직 없어 원문(중국어)으로 표시됩니다.")}</p>}
          {v3view === "v3item" && (
            <>
              <div className="sb-filters">
                <button type="button" className={v3type === "" ? "on" : ""} onClick={() => setV3type("")}>
                  {t("전체")} <em>{Object.keys(v3.items).length}</em>
                </button>
                {v3ItemTypes.map(([k, n]) => (
                  <button key={k} type="button" className={v3type === k ? "on" : ""} onClick={() => setV3type(k)}>
                    {ty3(k, v3.itemTypes)} <em>{n}</em>
                  </button>
                ))}
              </div>
              <div className="sb-cards">
                {Object.entries(v3.items)
                  .filter(([, it]) => (!v3type || it[4] === v3type)
                    && (!q || normSearch(it[0]).includes(q) || normSearch(it[1]).includes(q)))
                  .map(([id, it]) => card(`v3i-${id}`, () => openDetail({ k: "v3item", id }), (
                    <>
                      <img className="sb-thumb" src={itemIcon(id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                      <b className="sb-cname">{it[1]}{locale === "ko" && it[0] !== it[1] && <span className="sb-cn">{it[0]}</span>}</b>
                      <span className="sb-cmeta">{it[4] && <i className="sb-chip">{ty3(it[4], v3.itemTypes)}</i>}</span>
                      <span className="sb-cdesc">{locale === "ko" && it[5] ? it[5] : it[2]}</span>
                    </>
                  )))}
              </div>
            </>
          )}
          {v3view === "v3craft" && (
            <>
              <h3 className="sb-h3">{t("가공 레시피")} <em className="sb-count">{v3.process.length}</em></h3>
              {/* ⚠ 산출물이 없는 레시피가 30건 있다 — 재료를 태워 번영도만 올리는 레시피다.
                  이름·아이콘이 비어 보이던 원인 (사용자 지적 2026-08-12). */}
              <p className="sim-note">{t("산출물이 없는 레시피는 재료를 소비해 번영도를 올리는 레시피입니다.")}</p>
              <div className="sb-cards">
                {v3.process.map((r, i) => card(`v3p${i}`, () => openDetail({ k: "v3proc", i }), (
                  <>
                    <img className="sb-thumb" src={itemIcon(r.icon)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                    <b className="sb-cname">{r.out ? `${p3(r.out)}${r.rows[0][2] > 1 ? ` ×${r.rows[0][2]}` : ""}` : r.cn}
                      {locale === "ko" && !r.out && r.ko && r.ko !== r.cn && <span className="sb-cn">{r.ko}</span>}</b>
                    <span className="sb-cmeta">
                      <i className="sb-chip">{r.rows.length > 1 ? `Lv.${r.rows[0][0]}~${r.rows[r.rows.length - 1][0]}` : `Lv.${r.rows[0][0]}`}</i>
                      {r.rows[0][3] > 0 && <i className="sb-chip">{t("번영도")} +{r.rows[0][3]}</i>}
                    </span>
                    <span className="sb-cdesc">{Object.entries(r.rows[0][1]).map(([id, n]) => `${p3(id)} ×${n}`).join(" + ")}</span>
                  </>
                )))}
              </div>
              <h3 className="sb-h3">{t("건설 레시피")} <em className="sb-count">{v3.builds.length}</em></h3>
              <div className="sb-cards">
                {v3.builds.map((bd, i) => card(`v3b${i}`, () => openDetail({ k: "v3build", i }), (
                  <>
                    <img className="sb-thumb" src={itemIcon(bd.out)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                    <b className="sb-cname">{p3(bd.out)}</b>
                    <span className="sb-cmeta">{bd.type && <i className="sb-chip">{ty3(bd.type, v3.trapTypes)}</i>}</span>
                    <span className="sb-cdesc">{Object.entries(bd.mats).map(([id, n]) => `${p3(id)} ×${n}`).join(" + ") || "—"}</span>
                  </>
                )))}
              </div>
            </>
          )}
          {v3view === "v3map" && (
            <>
              <p className="sim-note">{t("전투 지형입니다 — 누르면 사막 이야기 지역과 같은 도면·이동 경로·등장 적 상세가 열립니다. 시나리오는 이 지형들을 이어 붙여 만들어집니다.")}</p>
              <p className="sim-note">{t("게임 데이터에 지형 이름이 따로 없어, 그 지형을 쓰는 시나리오 코드(없으면 지형 풀)를 이름 대신 싣고 내부 id를 작게 덧붙였습니다.")}</p>
              <div className="sb-filters">
                <button type="button" className={v3pool === "" ? "on" : ""} onClick={() => setV3pool("")}>
                  {t("전체")} <em>{v3.subs.length}</em>
                </button>
                {Object.entries(v3.pools).map(([k, nm]) => (
                  <button key={k} type="button" className={v3pool === k ? "on" : ""} onClick={() => setV3pool(k)}>
                    {locale === "ko" && nm[1] !== nm[0] ? `${nm[0]}(${nm[1]})` : nm[0]}
                    <em>{v3.subs.filter((s2) => s2.pool === k).length}</em>
                  </button>
                ))}
              </div>
              <div className="sb-grid">
                {v3.subs.filter((sv) => !v3pool || sv.pool === v3pool).map((sv) => (
                  <button key={sv.id} type="button" className="sb-card sb-map-card sb-clickable sb-map2"
                    onClick={() => openTerrain(sv.id)}>
                    {sv.prev
                      ? <img src={v3MapImg(sv.prev)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                      : <span className="sb-noprev">{t("프리뷰 없음")}</span>}
                    <h4>
                      {sv.use.length > 0
                        ? <i className="sb-chip">{sv.use.map((u) => u[0]).join(" · ")}</i>
                        : sv.pool && v3.pools[sv.pool]
                          ? <i className="sb-chip">{v3.pools[sv.pool][0]}{locale === "ko" ? `(${v3.pools[sv.pool][1]})` : ""}</i>
                          : <i className="sb-chip">{t("무작위 지형")}</i>}
                      <i className="sb-lv sb-rawid">{sv.id}</i></h4>
                    <span className="sb-stres">
                      {sv.foes.length > 0 && <i>{t("적")} <b>{sv.foes.length}</b></i>}
                      {Object.entries(sv.objs).slice(0, 3).map(([k, n]) => (
                        <i key={k}>{v3.objKinds[k]?.[locale === "ko" ? 4 : 0] || k} <b>×{n}</b></i>
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {v3view === "v3enemy" && (
            <>
              <p className="sim-note">{t("신시즌 전투 지형에 나오는 적입니다. 스탯은 가장 강화된 등장 기준이며, 누르면 등장 지형과 스탯이 나옵니다.")}</p>
              <div className="sb-cards">
                {v3dex.map((e) => card(`v3d-${e.id}`, () => openV3Enemy(e.id), (
                  <>
                    <img className="sb-thumb sb-thumb-en" src={v3EnImg(e.id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                    <b className="sb-cname">{v3EnName(e.id)}
                      {locale === "ko" && v3.enemyCn[e.id] && v3.enemyCn[e.id] !== v3EnName(e.id) && <span className="sb-cn">{v3.enemyCn[e.id]}</span>}
                      {e.lv > 0 && <em className="sb-lv">★{e.lv}</em>}</b>
                    <span className="sb-cdesc">HP {e.st[0].toLocaleString()} · {t("공격")} {e.st[1].toLocaleString()}</span>
                    <span className="sb-cmeta"><i className="sb-chip">{t("{n}개 지형", { n: String(e.at.length) })}</i></span>
                  </>
                )))}
              </div>
            </>
          )}
          {v3view === "v3stage" && (
            <>
              <h3 className="sb-h3">{t("전체 지도")}</h3>
              {/* 신시즌은 사막 이야기와 달리 **노드 좌표가 데이터에 있다** (mainMapData) —
                  실제 격자 배치 그대로 그린다 (사용자 요청 2026-08-12 "노드도 전부 표시"). */}
              <p className="sim-note">{t("게임 데이터의 격자 좌표 그대로 그린 지도입니다. 노드를 누르면 그 시나리오 상세가 열립니다.")}</p>
              <div className="sb-nodemap" style={{ aspectRatio: `${worldBox.w} / ${worldBox.h}` }}>
                <svg viewBox={`0 0 ${worldBox.w} ${worldBox.h}`} preserveAspectRatio="xMidYMid meet">
                  {v3.world.tiles.map(([x, y, z], i) => (
                    <rect key={i} x={x - worldBox.x} y={worldBox.y - y} width={0.94} height={0.94} rx={0.08}
                      fill={z ? ROUTE_TINT[zoneIdx(z) % ROUTE_TINT.length] : "#3a3742"} fillOpacity={z ? 0.28 : 0.5} />
                  ))}
                  {v3.world.nodes.map((n) => {
                    const from = v3.world.nodes.find((m) => m.id === n.f);
                    return from ? (
                      <line key={`l${n.id}`} x1={from.x - worldBox.x + 0.47} y1={worldBox.y - from.y + 0.47}
                        x2={n.x - worldBox.x + 0.47} y2={worldBox.y - n.y + 0.47}
                        stroke="#ffd166" strokeOpacity={0.5} strokeWidth={0.09} />
                    ) : null;
                  })}
                  {v3.world.nodes.map((n) => {
                    const st = v3.stages.find((s2) => s2.id === n.st);
                    return (
                      <g key={n.id} className="sb-nodedot" onClick={() => {
                        const i = v3.stages.findIndex((s2) => s2.id === n.st);
                        if (i >= 0) openDetail({ k: "v3stage", i });
                      }}>
                        <circle cx={n.x - worldBox.x + 0.47} cy={worldBox.y - n.y + 0.47} r={0.42}
                          fill={n.t === "HOME" ? "#ffd166" : n.t === "EXPLORE" ? "#6ee7b7" : "#7ab8ff"}
                          stroke="#10141c" strokeWidth={0.08} />
                        <title>{st ? `${st.code} ${st.cn}` : n.id}</title>
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="sb-nodekey">
                {Object.entries(v3.world.nodeTypes).map(([k, nt]) => (
                  <span key={k}><i className="dot" style={{ background: k === "HOME" ? "#ffd166" : k === "EXPLORE" ? "#6ee7b7" : "#7ab8ff" }} />
                    {locale === "ko" && nt[1] !== nt[0] ? `${nt[0]}(${nt[1]})` : nt[0]}</span>
                ))}
                {v3.world.zones.filter((z) => z.x !== null).map((z, i) => (
                  <span key={z.id}><i className="dot" style={{ background: ROUTE_TINT[i % ROUTE_TINT.length] }} />
                    {z.cn}{locale === "ko" && z.ko !== z.cn ? `(${z.ko})` : ""}</span>
                ))}
              </div>
              <h3 className="sb-h3">{t("시나리오")} <em className="sb-count">{v3.stages.length}</em></h3>
              <div className="sb-cards">
                {v3.stages.map((s2, i) => card(`v3s${i}`, () => openDetail({ k: "v3stage", i }), (
                  <>
                    {s2.grid.some(Boolean) && (
                      <img className="sb-thumb sb-thumb-map" src={v3MapImg(subPrev(s2.grid[s2.init[0] ?? s2.grid.findIndex(Boolean)] || s2.grid.find(Boolean) || ""))}
                        alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                    )}
                    <b className="sb-cname">{s2.cn}{locale === "ko" && s2.ko !== s2.cn && <span className="sb-cn">{s2.ko}</span>}</b>
                    <span className="sb-cmeta">
                      <i className="sb-chip">{s2.code}</i>
                      {zoneName(s2.zone) && <i className="sb-chip">{zoneName(s2.zone)}</i>}
                      {s2.day > 0 && <i className="sb-chip">{t("{n}일", { n: String(s2.day) })}</i>}
                      {s2.diff > 0 && <i className="sb-chip">{t("난이도 0~{n}", { n: String(s2.diff) })}</i>}
                    </span>
                    <span className="sb-cdesc">{locale === "ko" && s2.descKo ? s2.descKo : s2.desc}</span>
                  </>
                )))}
              </div>
            </>
          )}
          {v3view === "v3weather" && (
            <div className="sb-cards">
              {v3.weather.map((w, i) => card(`v3w${i}`, () => openDetail({ k: "v3weather", i }), (
                <>
                  {w[6] && <img className="sb-thumb sb-thumb-dim" src={misc2Icon(w[6])} alt="" aria-hidden loading="lazy" onError={hideErr} />}
                  <b className="sb-cname">{w[1]}{locale === "ko" && w[0] !== w[1] && <span className="sb-cn">{w[0]}</span>}</b>
                  <span className="sb-cdesc">{locale === "ko" && w[4] ? w[4] : w[2]}</span>
                </>
              )))}
            </div>
          )}
          {v3view === "v3event" && (
            <>
              <p className="sim-note">{t("같은 이야기의 1·2단계와 보스 판은 한 카드로 묶었습니다 — 상세에서 골라 봅니다.")}</p>
              <div className="sb-cards">
                {v3.scenes.map((sc, i) => card(`v3e${i}`, () => openDetail({ k: "v3event", i }), (
                  <>
                    <img className="sb-thumb sb-thumb-dim" src={misc2Icon("img_default_npc_pic")} alt="" aria-hidden loading="lazy" onError={hideErr} />
                    <b className="sb-cname">{sc.cn}{locale === "ko" && sc.ko !== sc.cn && <span className="sb-cn">{sc.ko}</span>}</b>
                    <span className="sb-cmeta">
                      {sc.tiers.map((tr) => <i key={tr.tier} className={`sb-chip${tr.tier === "boss" ? " warn" : ""}`}>{t(V3_TIER[tr.tier] ?? tr.tier)}</i>)}
                    </span>
                    <span className="sb-cdesc">{locale === "ko" && sc.tiers[0].descKo ? sc.tiers[0].descKo : sc.tiers[0].desc}</span>
                  </>
                )))}
              </div>
            </>
          )}
        </>
      )}

      {/* ══ 상세 모달 — 종류별 본문 ══ */}
      {detail && (() => {
        const close = () => setDetail(null);
        if (detail.k === "v3item") {
          return (
            <ModalWindow label={v3.items[detail.id]?.[1] ?? detail.id} className="operator-modal sb-modal" onClose={close}>
              {v3ItemBody(detail.id)}
            </ModalWindow>
          );
        }
        if (detail.k === "v3proc" || detail.k === "v3build") {
          const isProc = detail.k === "v3proc";
          const pr = isProc ? v3.process[detail.i] : null;
          const bd = isProc ? null : v3.builds[detail.i];
          const row = pr ? pr.rows[Math.min(pick, pr.rows.length - 1)] : null;
          const outId = (pr ? pr.out : bd!.out) || "";
          const mats = row ? row[1] : bd!.mats;
          const cnt = row ? row[2] : bd!.cnt;
          // 산출물이 없는 레시피(번영도 소비)는 레시피 이름을 제목으로 쓴다
          const title = outId ? p3(outId) : (pr?.cn ?? "");
          return (
            <ModalWindow label={title} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <header className="sb-dt-head">
                  <img src={itemIcon(pr ? pr.icon : outId)} alt="" aria-hidden onError={hideErr} />
                  <div>
                    <h2>{title}{cnt > 1 ? ` ×${cnt}` : ""}
                      {locale === "ko" && !outId && pr?.ko && pr.ko !== pr.cn && <span className="sb-cn">{pr.ko}</span>}</h2>
                    <p className="sb-cmeta">
                      <i className="sb-chip">{isProc ? t("가공 레시피") : t("건설 레시피")}</i>
                      {row && row[3] > 0 && <i className="sb-chip">{t("번영도")} +{row[3]}</i>}
                      {bd?.type && <i className="sb-chip">{ty3(bd.type, v3.trapTypes)}</i>}
                    </p>
                  </div>
                </header>
                {/* 가공 숙련도(Lv) — 레벨이 오를수록 같은 산출물에 재료가 덜 든다 */}
                {pr && pr.rows.length > 1 && (
                  <div className="sb-picks" role="tablist" aria-label={t("가공 숙련도")}>
                    {pr.rows.map((x, i) => (
                      <button key={x[0]} type="button" role="tab" aria-selected={i === pick}
                        className={i === pick ? "on" : ""} onClick={() => setPick(i)}>Lv.{x[0]}</button>
                    ))}
                  </div>
                )}
                <h4>{t("재료")}</h4>
                <span className="sb-matline">{Object.entries(mats).map(([id, n]) => v3chip(id, n))}</span>
                {outId && v3.items[outId]?.[2] && (
                  <><h4>{t("용도")}</h4>
                    <p>{v3.items[outId][2]}
                      {locale === "ko" && v3.items[outId][5] && v3.items[outId][5] !== v3.items[outId][2]
                        && <span className="sb-trline">{v3.items[outId][5]}</span>}</p></>
                )}
                {bd?.recipe && v3.items[bd.recipe] && (
                  <dl className="st-facts">
                    <div><dt>{t("도면")}</dt><dd>{p3(bd.recipe)}</dd></div>
                    {bd.wd > 0 && <div><dt>{t("회수율")}</dt><dd>{bd.wd}%</dd></div>}
                  </dl>
                )}
              </div>
            </ModalWindow>
          );
        }
        if (detail.k === "v3stage") {
          const s2 = v3.stages[detail.i];
          const cells = s2.grid.length ? s2.grid : [];
          return (
            <ModalWindow label={s2.cn} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <header className="sb-dt-head">
                  {cells.some(Boolean) && (
                    <img src={v3MapImg(subPrev(cells[s2.init[0] ?? 0] || cells.find(Boolean) || ""))} alt="" aria-hidden onError={hideErr} />
                  )}
                  <div>
                    <h2>{s2.cn}{locale === "ko" && s2.ko !== s2.cn && <span className="sb-cn">{s2.ko}</span>}</h2>
                    <p className="sb-cmeta">
                      <i className="sb-chip">{s2.code}</i>
                      {zoneName(s2.zone) && <i className="sb-chip">{zoneName(s2.zone)}</i>}
                      {s2.day > 0 && <i className="sb-chip">{t("{n}일", { n: String(s2.day) })}</i>}
                      {s2.power > 0 && <i className="sb-chip">{t("목표 점수")} {s2.power}</i>}
                    </p>
                  </div>
                </header>
                <p>{s2.desc}</p>
                {locale === "ko" && s2.descKo && s2.descKo !== s2.desc && <p className="sb-trline">{s2.descKo}</p>}
                {cells.some(Boolean) && (
                  <>
                    <h4>{t("지형 배치")}</h4>
                    <p className="sim-note">{t("이 시나리오를 이루는 전투 지형입니다 — 누르면 도면·경로 상세가 열립니다.")}</p>
                    <div className="sb-subgrid">
                      {cells.map((sid, gi) => (
                        <div key={gi} className={`cell${sid ? "" : " empty"}${s2.init.includes(gi) ? " start" : ""}`}>
                          {sid ? (
                            <button type="button" onClick={() => openTerrain(sid)}>
                              {subPrev(sid) && <img src={v3MapImg(subPrev(sid))} alt="" aria-hidden loading="lazy" onError={hideErr} />}
                              <em>{sid}</em>
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {s2.pool && v3.pools[s2.pool] && (
                  <dl className="st-facts">
                    <div><dt>{t("지형 풀")}</dt><dd>{v3.pools[s2.pool][0]}{locale === "ko" ? ` (${v3.pools[s2.pool][1]})` : ""}</dd></div>
                    {s2.diff > 0 && <div><dt>{t("환경 압력")}</dt><dd>0~{s2.diff}</dd></div>}
                  </dl>
                )}
                {Object.keys(s2.first).length > 0 && (
                  <>
                    <h4>{t("최초 클리어 보상")}</h4>
                    <span className="sb-matline">{Object.entries(s2.first).map(([id, n]) => v3chip(id, n))}</span>
                  </>
                )}
                {s2.foes.length > 0 && (
                  <>
                    <h4>{t("등장 적")} <em className="sb-count">{s2.foes.length}</em></h4>
                    <div className="st-enemies">
                      {s2.foes.map((id) => (
                        <span key={id} className="st-enemy">
                          <span className="st-enemy-name"><span className="nm">{v3EnName(id)}</span></span>
                          <span className="st-enemy-body">
                            <img src={v3EnImg(id)} alt="" aria-hidden width={96} height={96} loading="lazy" decoding="async"
                              onError={(ev) => { ev.currentTarget.style.visibility = "hidden"; }} />
                          </span>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </ModalWindow>
          );
        }
        if (detail.k === "v3weather") {
          const w = v3.weather[detail.i];
          return (
            <ModalWindow label={w[1]} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <header className="sb-dt-head">
                  {w[6] && <img className="sb-thumb-dim" src={misc2Icon(w[6])} alt="" aria-hidden onError={hideErr} />}
                  <div><h2>{w[1]}{locale === "ko" && w[0] !== w[1] && <span className="sb-cn">{w[0]}</span>}</h2></div>
                </header>
                <p>{w[2]}</p>
                {locale === "ko" && w[4] && w[4] !== w[2] && <p className="sb-trline">{w[4]}</p>}
                <p className="sb-dim">{w[3]}</p>
                {locale === "ko" && w[5] && w[5] !== w[3] && <p className="sb-trline">{w[5]}</p>}
              </div>
            </ModalWindow>
          );
        }
        if (detail.k === "v3event") {
          const sc = v3.scenes[detail.i];
          const tr = sc.tiers[Math.min(pick, sc.tiers.length - 1)];
          return (
            <ModalWindow label={sc.cn} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <header className="sb-dt-head">
                  <img className="sb-thumb-dim" src={misc2Icon("img_default_npc_pic")} alt="" aria-hidden onError={hideErr} />
                  <div><h2>{sc.cn}{locale === "ko" && sc.ko !== sc.cn && <span className="sb-cn">{sc.ko}</span>}</h2></div>
                </header>
                {sc.tiers.length > 1 && (
                  <div className="sb-picks" role="tablist" aria-label={t("단계")}>
                    {sc.tiers.map((x, i) => (
                      <button key={x.tier} type="button" role="tab" aria-selected={i === pick}
                        className={i === pick ? "on" : ""} onClick={() => setPick(i)}>{t(V3_TIER[x.tier] ?? x.tier)}</button>
                    ))}
                  </div>
                )}
                <p>{tr.desc}</p>
                {locale === "ko" && tr.descKo && tr.descKo !== tr.desc && <p className="sb-trline">{tr.descKo}</p>}
                <h4>{t("선택지")}</h4>
                <ul className="sb-choices">
                  {tr.choices.map((c, i) => (
                    <li key={i}><b>{c[0]}</b>{locale === "ko" && c[0] !== c[1] && <span className="sb-cn">{c[1]}</span>}
                      {c[4] && <i className="sb-lv">{t(PROF_LABEL[c[4]] ?? c[4])} {t("{n}명", { n: String(c[5]) })}{c[6] > 0 ? ` · ${t("정예화 {n}+", { n: String(c[6]) })}` : ""}</i>}
                      {c[2] && <span>{c[2]}{locale === "ko" && c[3] && c[3] !== c[2] && ` (${c[3]})`}</span>}</li>
                  ))}
                </ul>
              </div>
            </ModalWindow>
          );
        }
        if (detail.k === "food") {
          const f = v2.foods[detail.i];
          const it = v2.items[f.id];
          return (
            <ModalWindow label={f.variants[0]?.[1] ?? f.id} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <header className="sb-dt-head">
                  <img src={itemIcon(f.id)} alt="" aria-hidden onError={hideErr} />
                  <div>
                    <h2>{f.variants[0]?.[1] ?? f.id}</h2>
                    <p className="sb-dim">{it?.[4] || it?.[1]}</p>
                  </div>
                </header>
                <h4>{t("조합")}</h4>
                {f.recipes.length ? (
                  <ul className="sb-recipes sb-recipes-chip">{f.recipes.map((r, i) => <li key={i}>{matChips(r)}</li>)}</ul>
                ) : <p className="sb-dim">{t("정해진 조합이 없는 요리입니다 — 조건이 안 맞는 조합에서 나옵니다.")}</p>}
                <h4>{t("변형별 효과")}</h4>
                <p className="sim-note">{t("보조 재료의 종류가 변형을 정합니다 — α 재료(알·버섯·후추·설탕·뿔 등)는 능력치를 하나 더 붙이고, β 재료(조미료)는 지속 시간을 늘리며, γ 재료(양조주·파울 파우더·아이스 퓌레·플라워 슈거)는 공격 계열 효과를 크게 붙입니다.")}</p>
                <ul className="sb-variants">
                  {f.variants.map((v, i) => {
                    const mats = v2.foodMats.filter((fm) => fm[3] === v[0] && fm[1] === "SUB");
                    return (
                      <li key={i}>
                        <b className={`v-${v[0]}`}>{VAR_MARK[v[0]] ?? v[0]}</b> {v[1]} — {v[2]}
                        {mats.length > 0 && (
                          <span className="sb-matline sb-matline-sub">
                            {t("이 변형이 되는 보조 재료")} {mats.map((fm) => matChip(fm[0]))}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </ModalWindow>
          );
        }
        if (detail.k === "craft") {
          const c = v2.crafts[detail.i];
          const it = v2.items[c.id];
          return (
            <ModalWindow label={nameOf(c.id)} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <header className="sb-dt-head">
                  <img src={itemIcon(c.id)} alt="" aria-hidden onError={hideErr} />
                  <div>
                    <h2>{nameOf(c.id)}</h2>
                    <p className="sb-cmeta">
                      <i className="sb-chip">{t(CRAFT_TYPE[c.type] ?? c.type)}</i>
                      {c.tag && v2.trapTags[c.tag] && <i className="sb-chip">{v2.trapTags[c.tag][0]}</i>}
                      {c.lvs.length > 1 && <i className="sb-chip">Lv.1~{c.lvs[c.lvs.length - 1]}</i>}
                    </p>
                  </div>
                </header>
                {it?.[1] && <p>{it[1]}</p>}
                {it?.[4] && <p className="sb-dim">{it[4]}</p>}
                <dl className="st-facts">
                  <div><dt>{t("제작 재료")}</dt><dd>{Object.entries(c.mats).map(([id, n]) => `${nameOf(id)} ×${n}`).join(" + ") || "—"}</dd></div>
                  {c.up && <div><dt>{t("업그레이드")}</dt><dd>{Object.entries(c.up).map(([id, n]) => `${nameOf(id)} ×${n}`).join(" + ")}</dd></div>}
                  {c.unlock && <div><dt>{t("해금")}</dt><dd>{c.unlock}</dd></div>}
                  {c.repair > 0 && <div><dt>{t("수리 비용")}</dt><dd>{c.repair}</dd></div>}
                  {c.wd > 0 && <div><dt>{t("회수율")}</dt><dd>{c.wd}%</dd></div>}
                </dl>
              </div>
            </ModalWindow>
          );
        }
        if (detail.k === "weather") {
          const w = v2.weather[detail.i];
          const lv = w.lv[Math.min(pick, w.lv.length - 1)];
          return (
            <ModalWindow label={w.name} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <header className="sb-dt-head">
                  {lv[4] && <img className="sb-thumb-dim" src={miscIcon(lv[4])} alt="" aria-hidden onError={hideErr} />}
                  <div><h2>{lv[1]}</h2><p className="sb-dim">{w.name}</p></div>
                </header>
                {/* 위험도 선택 — 사용자 요청 "상세모달에서 위험도를 지정가능하게" */}
                <div className="sb-picks" role="tablist" aria-label={t("위험도")}>
                  {w.lv.map((l, i) => (
                    <button key={l[0]} type="button" role="tab" aria-selected={i === pick}
                      className={i === pick ? "on" : ""} onClick={() => setPick(i)}>
                      {l[0] === 0 ? t("쾌청") : t("위험 {n}", { n: String(l[0]) })}
                    </button>
                  ))}
                </div>
                <p>{lv[2]}</p>
                <p className="sb-dim">{lv[3]}</p>
              </div>
            </ModalWindow>
          );
        }
        if (detail.k === "event") {
          const sc = v2.scenes[detail.i];
          const vr = sc.vars[Math.min(pick, sc.vars.length - 1)];
          return (
            <ModalWindow label={sc.title} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <header className="sb-dt-head">
                  {sc.icon && <img className="sb-thumb-dim" src={miscIcon(sc.icon)} alt="" aria-hidden onError={hideErr} />}
                  <div><h2>{sc.title}</h2>{sc.kind && <p className="sb-dim">{sc.kind}</p>}</div>
                </header>
                {/* 같은 조우의 갈래 — 내용이 달라지는 판을 여기서 고른다 */}
                {sc.vars.length > 1 && (
                  <div className="sb-picks" role="tablist" aria-label={t("갈래")}>
                    {sc.vars.map((v, i) => (
                      <button key={v.fam} type="button" role="tab" aria-selected={i === pick}
                        className={i === pick ? "on" : ""} onClick={() => setPick(i)}>{t("갈래 {n}", { n: String(i + 1) })}</button>
                    ))}
                  </div>
                )}
                {vr.steps.map((st, si) => (
                  <section key={st.id} className="sb-step">
                    {vr.steps.length > 1 && <h4>{si === 0 ? t("시작") : t("이어지는 장면 {n}", { n: String(si) })}</h4>}
                    <p>{st.desc}</p>
                    {st.choices.length > 0 && (
                      <ul className="sb-choices">
                        {st.choices.map((c, i) => (
                          <li key={i}><b>{c[0]}</b>{c[2] > 0 && <i className="sb-lv">{t("행동력 {n}", { n: String(c[2]) })}</i>}{c[1] && <span>{c[1]}</span>}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            </ModalWindow>
          );
        }
        if (detail.k === "zone") {
          const z = v2.zoneAreas[detail.i];
          return (
            <ModalWindow label={z.name} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <h2>{z.name}</h2>
                {z.ap && <p className="sb-dim">{z.ap}</p>}
                {z.buff ? (
                  <>
                    <h4>{t("구역 고유 효과")}</h4>
                    <p><b>{z.buff[0]}</b> — {z.buff[1]}</p>
                    {z.buff[2] && <p className="sb-dim">{z.buff[2]}</p>}
                  </>
                ) : <p className="sim-note">{t("이 구역에는 고유 효과가 없습니다.")}</p>}
                <p className="sim-note">{t("이 구역 안에 놓이는 노드는 판마다 새로 뽑히므로 어떤 지역이 나올지는 고정돼 있지 않습니다.")}</p>
              </div>
            </ModalWindow>
          );
        }
        if (detail.k === "rift") {
          const r = v2.rift.sets[detail.i];
          const dd = r.diffs[Math.min(pick, r.diffs.length - 1)];
          return (
            <ModalWindow label={t(RIFT_SET[r.id] ?? r.id)} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <h2>{t(RIFT_SET[r.id] ?? r.id)}</h2>
                <div className="sb-picks" role="tablist" aria-label={t("환경압력")}>
                  {r.diffs.map((x, i) => (
                    <button key={x[0]} type="button" role="tab" aria-selected={i === pick}
                      className={i === pick ? "on" : ""} onClick={() => setPick(i)}>{t("압력 {n}", { n: String(x[0]) })}</button>
                  ))}
                </div>
                <p>{dd[1]}</p>
                <h4>{t("보상 자원")}</h4>
                <span className="sb-obs-inline">
                  {dd[2].map((id) => <i key={id}><img src={itemIcon(id)} alt="" aria-hidden loading="lazy" onError={hideErr} />{nameOf(id)}</i>)}
                </span>
                {v2.rift.globals.length > 0 && (
                  <>
                    <h4>{t("특수 효과")}</h4>
                    <ul className="sb-recipes">{v2.rift.globals.map((g, i) => <li key={i}>{g}</li>)}</ul>
                  </>
                )}
                {v2.rift.envs.length > 0 && (
                  <>
                    <h4>{t("등장 세력")}</h4>
                    <span className="sb-obs-inline">
                      {v2.rift.envs.map(([nm, ic], i) => (
                        <i key={i}>{ic && <img className="sb-ico-dim" src={miscIcon(ic)} alt="" aria-hidden loading="lazy" onError={hideErr} />}{nm}</i>
                      ))}
                    </span>
                  </>
                )}
              </div>
            </ModalWindow>
          );
        }
        if (detail.k === "riftMain") {
          const m = v2.rift.mains[detail.i];
          return (
            <ModalWindow label={m[1]} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <header className="sb-dt-head">
                  {m[5] && <img className="sb-thumb-dim" src={miscIcon(m[5])} alt="" aria-hidden onError={hideErr} />}
                  <div><h2>{m[1]}</h2><p className="sb-dim">{m[4]}</p></div>
                </header>
                <p>{m[2]}</p>
                {m[6] && <p className="sb-dim">{m[6]}</p>}
                <dl className="st-facts">
                  {m[3] > 0 && <div><dt>{t("기한")}</dt><dd>{t("{n}일", { n: String(m[3]) })}</dd></div>}
                  <div><dt>{t("종류")}</dt><dd>{m[0]}</dd></div>
                </dl>
                <h4>{t("추가 목표")}</h4>
                <ul className="sb-recipes">{v2.rift.subs.map((sv, i) => <li key={i}><b>{sv[0]}</b> — {sv[1]}</li>)}</ul>
              </div>
            </ModalWindow>
          );
        }
        if (detail.k === "exp") {
          const e = v2.expeditions[detail.i];
          const row = e.rows[Math.min(pick, e.rows.length - 1)];
          return (
            <ModalWindow label={e.eff} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <h2>{e.eff}</h2>
                <div className="sb-picks" role="tablist" aria-label={t("편성")}>
                  {e.rows.map((r, i) => (
                    <button key={i} type="button" role="tab" aria-selected={i === pick}
                      className={i === pick ? "on" : ""} onClick={() => setPick(i)}>
                      {t("{n}명", { n: String(r[2]) })}{r[3] > 0 ? ` · ${t("정예화 {n}+", { n: String(r[3]) })}` : ""}
                    </button>
                  ))}
                </div>
                <p>{row[0]}</p>
                <dl className="st-facts">
                  <div><dt>{t("기간")}</dt><dd>{t("{n}일", { n: String(row[4]) })}</dd></div>
                  <div><dt>{t("인원")}</dt><dd>{t("{n}명", { n: String(row[2]) })}</dd></div>
                  {row[1] > 0 && <div><dt>{t("에너지음료")}</dt><dd>{row[1]}</dd></div>}
                  {row[3] > 0 && <div><dt>{t("정예화")}</dt><dd>{row[3]}+</dd></div>}
                </dl>
                {row[5].length > 0 && row[5].length < 8 && (
                  <>
                    <h4>{t("직군 조건")}</h4>
                    <p>{row[5].map((pf) => t(PROF_LABEL[pf] ?? pf)).join(" · ")}</p>
                  </>
                )}
              </div>
            </ModalWindow>
          );
        }
        // dex — mat은 위에서 별도 창(matModal)으로 빠지므로 여기 남는 건 적 도감뿐이다
        if (detail.k !== "dex") return null;
        const e = v2.dex[detail.i];
        return (
          <ModalWindow label={enName(e.id)} className="operator-modal sb-modal" onClose={close}>
            <div className="sb-dt">
              <header className="sb-dt-head">
                <img src={enImgOf(e.id, e.img, e.src)} alt="" aria-hidden onError={hideErr} />
                <div>
                  <h2>{enName(e.id)}{e.lv > 0 && <em className="sb-lv">★{e.lv}</em>}</h2>
                  <p className="sb-dim">HP {e.st[0].toLocaleString()} · {t("공격")} {e.st[1].toLocaleString()} · {t("방어")} {e.st[2].toLocaleString()} · {t("마저")} {e.st[3]}</p>
                </div>
              </header>
              {v2.enemyRewards[e.id] && (
                <>
                  <h4>{t("처치 보상")}</h4>
                  <span className="sb-obs-inline">
                    <i><img src={itemIcon(v2.enemyRewards[e.id][0])} alt="" aria-hidden onError={hideErr} />
                      {nameOf(v2.enemyRewards[e.id][0])} ×{v2.enemyRewards[e.id][1]}</i>
                  </span>
                </>
              )}
              <h4>{t("등장 지역")} <em className="sb-count">{e.at.length}</em></h4>
              <div className="sb-atlist">
                {e.at.map(([sid, cnt]) => {
                  const st = byStId.get(sid);
                  return (
                    <button key={sid} type="button" onClick={() => { setDetail(null); if (st) openStage(st); }}>
                      {st ? st[2] : sid} <em>{cnt > 0 ? `×${cnt}` : t("습격")}</em>
                    </button>
                  );
                })}
              </div>
              {e.src === 0 && (
                dexFull ? <div className="sb-dexfull">
                    <EnemyFile enemy={dexFull} stagesDoc={null} nameOf={anyEnName}
                      onOpenEnemy={(id) => openDexEnemy(id, id)} />
                  </div>
                  : <p className="sim-note">{t("적 도감 정보를 불러오는 중…")}</p>
              )}
            </div>
          </ModalWindow>
        );
      })()}

      {/* ══ 지역 상세 모달 — 작전 도감 상세와 같은 규격 ══ */}
      {openSt && (
        <ModalWindow label={`${openSt[1]} ${openSt[2]}`} className="operator-modal st-modal"
          onClose={() => setOpenSt(null)}>
          <div className="st-file">
            <header className="st-head">
              <div className="st-head-main">
                <span className="st-code">{openSt[1]}</span>
                <h2>{openSt[2]}</h2>
                <div className="st-badges">
                  <span className="st-tag">{t("생존연산")}</span>
                  <span className="st-tag">{v2.name}</span>
                </div>
              </div>
            </header>
            <div className="st-cols">
              <div className="st-left">
                <div className="st-maptabs" role="tablist" aria-label={t("도면 보기")}>
                  <button type="button" role="tab" aria-selected={mapView === "map"}
                    className={mapView === "map" ? "on" : ""} onClick={() => setMapView("map")}>{t("실사 도면")}</button>
                  <button type="button" role="tab" aria-selected={mapView === "route"}
                    className={mapView === "route" ? "on" : ""}
                    onClick={() => {
                      setMapView("route");
                      if (!SB_ROUTES) loadSandboxRoutes().then(() => bumpRoutes((k) => k + 1)).catch(() => { SB_ROUTES_LOADING = null; bumpRoutes((k) => k + 1); });
                    }}>{t("이동 경로")}</button>
                </div>
                {mapView === "map" ? (
                  <button type="button" className={`st-map-zoom${zoom ? " zoom" : ""}`}
                    onClick={() => setZoom((z) => !z)}
                    title={zoom ? t("아무 곳이나 클릭하면 원래 크기로 돌아갑니다") : t("클릭하면 화면 크기로 확대됩니다")}>
                    {/* 생존연산 도면은 원본 비율 그대로 (사용자 확정 2026-08-12) */}
                    <img className="st-map sb-origmap" src={stageMapImg(openSt[0])} alt={t("{code} 지형 도면", { code: openSt[1] })}
                      loading="lazy" decoding="async" onError={hideErr} />
                  </button>
                ) : rd ? (
                  <StageRouteMap data={rd} order={routeOrder}
                    highlights={hover ? [hover] : pinned.size ? [...pinned] : null}
                    imgOf={(id) => { const row = enemyRows.find((r) => r[0] === id); return row ? enImgOf(row[0], row[1], row[2]) : undefined; }}
                    nameOf={enName} onPick={togglePin} obPick={obPick}
                    obIconOf={(k) => { const iid = OB_KINDS.find((x) => x[0] === k)?.[1]; return iid ? itemIcon(iid) : undefined; }} />
                ) : (
                  <p className="st-note">{SB_ROUTES ? t("이 작전은 경로 데이터가 없습니다.") : t("경로 데이터를 불러오는 중…")}</p>
                )}
                {openSt[3] && <p className="st-desc">{openSt[3]}</p>}
                <dl className="st-facts">
                  <div><dt>{t("행동력")}</dt><dd>{openSt[4]}</dd></div>
                  {openSt[5] !== openSt[4] && <div><dt>{t("적습 시 행동력")}</dt><dd>{openSt[5]}</dd></div>}
                </dl>
              </div>
              <div className="st-right">
                {rd?.ob && rd.ob.length > 0 && (
                  <section className="st-block">
                    <h3><span className="section-no">RESOURCE</span>{t("자원·오브젝트")}</h3>
                    {/* 클릭 = 지도에서 그것만 남기고 흐리게 (사용자 요청 2026-08-12) */}
                    <div className="sb-obs">
                      {OB_LIST.filter(([k]) => obCounts[k]).map(([k, iid, label, color]) => (
                        <button key={k} type="button"
                          className={`sb-ob${obPick === k ? " on" : ""}`}
                          title={t("누르면 지도에서 이 자원만 남깁니다")}
                          onClick={() => { setObPick((cur) => (cur === k ? null : k)); setMapView("route"); }}>
                          {iid && <img className="sb-ico" src={itemIcon(iid)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />}
                          <i className="dot" style={{ background: color }} aria-hidden />
                          {t(label)} <em>×{obCounts[k]}</em>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {enemyRows.length > 0 && (
                  <section className="st-block">
                    <h3><span className="section-no">ENEMY</span>{t("등장 적")} <em>{enemyRows.length}</em></h3>
                    <div className="st-enemies">
                      {enemyRows.map((r) => {
                        const hasRoute = !!rd?.e[r[0]]?.length;
                        const pinColor = hasRoute ? enemyRouteColor(routeOrder, r[0]) : undefined;
                        return (
                          <a key={r[0]}
                            className={`st-enemy${r[4] > 0 ? " reinforced" : ""}${pinned.has(r[0]) ? " pinned" : ""}${routeMode ? " has-route" : ""}`}
                            href={enemyPath(locale, r[1])}
                            style={routeMode && pinColor ? ({ "--rc": pinColor } as React.CSSProperties) : undefined}
                            onMouseEnter={mapView === "route" ? () => setHover(r[0]) : undefined}
                            onMouseLeave={mapView === "route" ? () => setHover(null) : undefined}
                            onClick={(ev) => {
                              if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
                              ev.preventDefault();
                              // 실사 도면 탭에선 카드 클릭 = 적 상세 모달, 경로 탭에서만 고정 토글
                              // (사용자 지시 2026-08-12)
                              if (routeMode && hasRoute) togglePin(r[0]);
                              else openDexEnemy(r[0], r[1]);
                            }}>
                            <span className="st-enemy-name">
                              <span className="nm">{enName(r[0])}</span>
                              {r[4] > 0 && <i title={t("강화 {n}단계", { n: String(r[4]) })}>★{r[4]}</i>}
                              <em className="st-enemy-cnt">{r[3] > 0 ? `×${r[3]}` : t("습격")}</em>
                            </span>
                            <span className="st-enemy-body">
                              <img src={enImgOf(r[0], r[1], r[2])} alt="" aria-hidden width={96} height={96} loading="lazy" decoding="async"
                                className="st-enemy-face-btn"
                                onClick={(ev) => {
                                  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
                                  ev.stopPropagation(); ev.preventDefault(); openDexEnemy(r[0], r[1]);
                                }}
                                onError={(ev) => { ev.currentTarget.style.visibility = "hidden"; }} />
                              <span className="st-enemy-stats">
                                <b title={t("최대 HP")}>HP {r[5].toLocaleString()}</b>
                                <b title={t("공격력")}>{t("공격")} {r[6].toLocaleString()}</b>
                                <b title={t("방어력")}>{t("방어")} {r[7].toLocaleString()}</b>
                                <b title={t("마법 저항")}>{t("마저")} {r[8]}</b>
                              </span>
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        </ModalWindow>
      )}
      {openSub && (() => {
        const close = () => setOpenSub(null);
          // 전투 지형 상세 — 사막 이야기 지역 상세와 **같은 규격** (사용자 요청 2026-08-12)
          const sv = subOf(openSub);
          const rd3 = SB2_ROUTES?.[openSub];
          const foes = sv?.foes ?? [];
          const order3 = rd3 ? foes.filter((r) => rd3.e[r[0]]?.length).map((r) => r[0]) : [];
          const obCnt: Record<string, number> = {};
          for (const [k] of rd3?.ob ?? []) obCnt[k] = (obCnt[k] ?? 0) + 1;
          return (
            <ModalWindow key={`sub-${subRaise}`} label={openSub} className="operator-modal st-modal" onClose={close}>
              <div className="st-file">
                <header className="st-head">
                  <div className="st-head-main">
                    <span className="st-code">{sv?.use.length ? sv.use.map((u) => u[0]).join(" · ") : openSub}</span>
                    <h2>{sv?.pool && v3.pools[sv.pool] ? v3.pools[sv.pool][0] : t("전투 지형")}
                      {locale === "ko" && sv?.pool && v3.pools[sv.pool] && <span className="sb-cn">{v3.pools[sv.pool][1]}</span>}</h2>
                    <div className="st-badges">
                      <span className="st-tag">{t("생존연산")}</span>
                      <span className="st-tag">{v3.cnName}</span>
                      <span className="st-tag sb-rawid">{openSub}</span>
                    </div>
                  </div>
                </header>
                <div className="st-cols">
                  <div className="st-left">
                    <div className="st-maptabs" role="tablist" aria-label={t("도면 보기")}>
                      <button type="button" role="tab" aria-selected={mapView === "map"}
                        className={mapView === "map" ? "on" : ""} onClick={() => setMapView("map")}>{t("실사 도면")}</button>
                      <button type="button" role="tab" aria-selected={mapView === "route"}
                        className={mapView === "route" ? "on" : ""} onClick={() => setMapView("route")}>{t("이동 경로")}</button>
                    </div>
                    {mapView === "map" ? (
                      sv?.prev ? (
                        <button type="button" className={`st-map-zoom${zoom ? " zoom" : ""}`} onClick={() => setZoom((z) => !z)}
                          title={zoom ? t("아무 곳이나 클릭하면 원래 크기로 돌아갑니다") : t("클릭하면 화면 크기로 확대됩니다")}>
                          <img className="st-map sb-origmap" src={v3MapImg(sv.prev)} alt={t("{code} 지형 도면", { code: openSub })}
                            loading="lazy" decoding="async" onError={hideErr} />
                        </button>
                      ) : <p className="st-note">{t("이 지형은 프리뷰 이미지가 없습니다.")}</p>
                    ) : rd3 ? (
                      <StageRouteMap data={rd3} order={order3}
                        highlights={hover ? [hover] : pinned.size ? [...pinned] : null}
                        imgOf={(id) => v3EnImg(id)} nameOf={v3EnName} onPick={togglePin}
                        obPick={obPick} obStyleOf={obStyle3}
                        obIconOf={(k) => { const iid = v3.objKinds[k]?.[3]; return iid ? itemIcon(iid) : undefined; }} />
                    ) : <p className="st-note">{SB2_ROUTES ? t("이 지형은 경로 데이터가 없습니다.") : t("경로 데이터를 불러오는 중…")}</p>}
                  </div>
                  <div className="st-right">
                    {rd3?.ob && rd3.ob.length > 0 && (
                      <section className="st-block">
                        <h3><span className="section-no">RESOURCE</span>{t("자원·오브젝트")}</h3>
                        <div className="sb-obs">
                          {Object.entries(obCnt).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
                            const ok = v3.objKinds[k];
                            const style = ok?.[2] ?? "obj";
                            const color = { wood: "#7fc46a", stone: "#cfc8bd", iron: "#8fb3d9", diam: "#6fe3d4",
                              treasure: "#ffd166", water: "#4fb3d9", bldg: "#c9a0ff", obj: "#9aa0a6" }[style] ?? "#9aa0a6";
                            return (
                              <button key={k} type="button" className={`sb-ob${obPick === k ? " on" : ""}`}
                                title={locale === "ko" && ok?.[5] ? ok[5] : ok?.[1]}
                                onClick={() => { setObPick((cur) => (cur === k ? null : k)); setMapView("route"); }}>
                                {ok?.[3] && <img className="sb-ico" src={itemIcon(ok[3])} alt="" aria-hidden loading="lazy" onError={hideErr} />}
                                <i className="dot" style={{ background: color }} aria-hidden />
                                {ok?.[0] ?? k}{locale === "ko" && ok?.[4] && ok[4] !== ok[0] ? `(${ok[4]})` : ""} <em>×{n}</em>
                              </button>
                            );
                          })}
                        </div>
                        {obPick && v3.objKinds[obPick]?.[1] && (
                          <p className="st-note">{v3.objKinds[obPick][1]}
                            {locale === "ko" && v3.objKinds[obPick][5] && v3.objKinds[obPick][5] !== v3.objKinds[obPick][1]
                              && <span className="sb-trline">{v3.objKinds[obPick][5]}</span>}</p>
                        )}
                      </section>
                    )}
                    {foes.length > 0 && (
                      <section className="st-block">
                        <h3><span className="section-no">ENEMY</span>{t("등장 적")} <em>{foes.length}</em></h3>
                        <div className="st-enemies">
                          {foes.map((r) => {
                            const hasRoute = !!rd3?.e[r[0]]?.length;
                            const pinColor = hasRoute ? enemyRouteColor(order3, r[0]) : undefined;
                            return (
                              <button key={r[0]} type="button"
                                className={`st-enemy${r[2] > 0 ? " reinforced" : ""}${pinned.has(r[0]) ? " pinned" : ""}${routeMode ? " has-route" : ""}`}
                                style={routeMode && pinColor ? ({ "--rc": pinColor } as React.CSSProperties) : undefined}
                                onMouseEnter={mapView === "route" ? () => setHover(r[0]) : undefined}
                                onMouseLeave={mapView === "route" ? () => setHover(null) : undefined}
                                onClick={() => {
                                  if (routeMode && hasRoute) { togglePin(r[0]); return; }
                                  openV3Enemy(r[0]);   // CN 전용 적도 우리 도감 상세로 (사용자 제보 2026-08-13)
                                }}>
                                <span className="st-enemy-name">
                                  <span className="nm">{v3EnName(r[0])}</span>
                                  {r[2] > 0 && <i title={t("강화 {n}단계", { n: String(r[2]) })}>★{r[2]}</i>}
                                  <em className="st-enemy-cnt">{r[1] > 0 ? `×${r[1]}` : t("습격")}</em>
                                </span>
                                <span className="st-enemy-body">
                                  {/* 섬네일 클릭은 **항상** 적 상세 — 경로 고정과 분리한다 (사용자 지시 2026-08-13) */}
                                  <img src={v3EnImg(r[0])} alt="" aria-hidden width={96} height={96} loading="lazy" decoding="async"
                                    className="st-enemy-face-btn"
                                    onClick={(ev) => {
                                      ev.stopPropagation(); ev.preventDefault();
                                      openV3Enemy(r[0]);
                                    }}
                                    onError={(ev) => { ev.currentTarget.style.visibility = "hidden"; }} />
                                  <span className="st-enemy-stats">
                                    <b title={t("최대 HP")}>HP {r[3].toLocaleString()}</b>
                                    <b title={t("공격력")}>{t("공격")} {r[4].toLocaleString()}</b>
                                    <b title={t("방어력")}>{t("방어")} {r[5].toLocaleString()}</b>
                                    <b title={t("마법 저항")}>{t("마저")} {r[6]}</b>
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    )}
                  </div>
                </div>
              </div>
            </ModalWindow>
          );
              })()}
      {openV3En && (() => {
        const close = () => setOpenV3En(null);
          const e = v3.dex.find((x) => x.id === openV3En)!;
          return (
            <ModalWindow key={`v3en-${enRaise}`} label={v3EnName(e.id)} className="operator-modal sb-modal" onClose={close}>
              <div className="sb-dt">
                <header className="sb-dt-head">
                  <img src={v3EnImg(e.id)} alt="" aria-hidden onError={hideErr} />
                  <div>
                    <h2>{v3EnName(e.id)}{e.lv > 0 && <em className="sb-lv">★{e.lv}</em>}
                      {locale === "ko" && v3.enemyCn[e.id] && v3.enemyCn[e.id] !== v3EnName(e.id) && <span className="sb-cn">{v3.enemyCn[e.id]}</span>}</h2>
                    <p className="sb-dim">HP {e.st[0].toLocaleString()} · {t("공격")} {e.st[1].toLocaleString()} · {t("방어")} {e.st[2].toLocaleString()} · {t("마저")} {e.st[3]}</p>
                  </div>
                </header>
                <h4>{t("등장 지형")} <em className="sb-count">{e.at.length}</em></h4>
                <div className="sb-atlist">
                  {e.at.map(([sid, cnt]) => {
                    const sv = subOf(sid);
                    return (
                      <button key={sid} type="button" onClick={() => openTerrain(sid)}>
                        {sv?.use.length ? sv.use.map((u) => u[0]).join(" · ") : sid} <em>{cnt > 0 ? `×${cnt}` : t("습격")}</em>
                      </button>
                    );
                  })}
                </div>
                {v3.enemySrc[e.id] === 0 && (
                  dexFull ? <div className="sb-dexfull">
                    <EnemyFile enemy={dexFull} stagesDoc={null} nameOf={anyEnName}
                      onOpenEnemy={(id) => openDexEnemy(id, id)} />
                  </div>
                    : <p className="sim-note">{t("적 도감 정보를 불러오는 중…")}</p>
                )}
              </div>
            </ModalWindow>
          );
              })()}
      {/* 신시즌 아이템 창 — 부모 모달 위에 겹친다 */}
      {v3Item && (
        <ModalWindow key={`v3i-${v3Raise}`} label={v3.items[v3Item]?.[1] ?? v3Item}
          className="operator-modal sb-modal" onClose={() => setV3Item(null)}>
          {v3ItemBody(v3Item)}
        </ModalWindow>
      )}
      {/* 재료 창 두 장 — 앞에 와야 하는 쪽을 나중에 그린다 (ModalWindow가 마운트 순으로 z를 준다) */}
      {matTop === "b" && matA && matModal(matA, "a")}
      {matB && matModal(matB, "b")}
      {matTop === "a" && matA && matModal(matA, "a")}
      {subEnemy && (
        <ModalWindow label={subEnemy.name} className="operator-modal en-modal" onClose={() => setSubEnemy(null)}>
          <EnemyFile enemy={subEnemy} stagesDoc={null} nameOf={anyEnName}
            onOpenEnemy={(id) => { void loadEnemies(locale).then((m) => { setEnMap(m); setSubEnemy(m.get(id) ?? null); }); }} />
        </ModalWindow>
      )}
    </section>
  );
}
