"use client";

// 위수 협의 가이드 — 사용자 확정 2026-08-22
// (커뮤니티에서 '오토체스·명토체스'로 부르지만 그건 별명이다 — 화면에는 쓰지 않는다)
//
// 화면 규약: 생존연산·통합전략 가이드와 같은 「요약 카드 목록 → 클릭하면 상세 모달」.
// 사용자가 짚은 우선순위 그대로 뷰 순서를 잡았다 —
//   ① 맹약(진영·특성)별 오퍼레이터  ② 오퍼레이터별 위수 협의 전용 능력  ③ 특훈 적·리더 적
// 나머지(아이템·전략·보급센터 수치·보상)는 뒤에 붙인다.
//
// 데이터는 scripts/build-autochess.py 산출 app/data/autochess{,.en,.ja}.json —
// 로케일 래퍼(autochess-ko/en/ja.tsx)가 자기 것만 정적 임포트하고 home이 lazy로 문다
// (한 모듈에서 세 로케일을 동적 선택하면 세 JSON이 한 청크로 묶인다 — enemies-ko.tsx 주석).
//
// ⚠ 영어판은 시즌2가 글로벌 서버에 없어 **설명문이 한국어 원문**이다 (doc.krOnly).
//    통합전략 IS6와 같은 취급 — 안내문을 띄우고 그대로 보여 준다.

import { cloneElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n, rich, type T } from "./i18n";
import { isNewFeature } from "./whats-new";
import { computeBoard, MAX_BOARD, MAX_BOARD_ITEM, MAX_DECK, BOARD9_ITEM, type BoardSlot } from "./autochess-board";
import { normSearch, useSearchInput } from "./search";
import { asset } from "./assets";
import { ModalWindow } from "./modal-window";
import { GLOBAL_MODAL_HASH } from "./hash-modal";
import { loadEnemies } from "./dex-cross";
import { EnemyFile, RANK_KEY, enemyImg, enemyImgBase, type Enemy } from "./enemy-detail";
import { StageRouteMap, enemyRouteColor, type StageRoutes } from "./stage-route-map";

// 전투 맵 (scripts/build-autochess-routes.py) — 작전 도감·통합전략과 **같은 렌더러**를 쓴다
// (규칙: .claude/skills/route-map-rules). '전투 맵' 탭을 처음 눌렀을 때만 지연 로드한다.
// ⚠ 맵 이미지는 안 쓴다 — 타일 격자와 경로를 데이터에서 그린다 (제보 c3d2c056, 2026-08-30).
export type AcRouteDoc = {
  /** 전장을 끊는 위·아래 구획의 g행 범위 — [위, 아래] */
  bands: [number, number][];
  maps: Record<string, StageRoutes & { band: 0 | 1 }>;
  rounds: { r: number; m: string }[];
  leaders: Record<string, { s: string; c: string }>;
  train: { r: number; m: string }[];
  /** 적 도감이 못 푸는 적만 — [ko, en, ja] */
  nm: Record<string, [string, string, string]>;
};
let AC_ROUTES: AcRouteDoc | null = null;
let AC_ROUTES_LOADING: Promise<void> | null = null;
function loadAcRoutes(): Promise<void> {
  if (AC_ROUTES) return Promise.resolve();
  AC_ROUTES_LOADING ??= import("./data/autochess-routes.json").then((m) => {
    AC_ROUTES = (m.default ?? m) as unknown as AcRouteDoc;
  });
  return AC_ROUTES_LOADING;
}

// ── 편성 판의 칸 ────────────────────────────────────────────────────────────
/** 한 칸 — 비어 있으면 null. **성긴 배열**이라 인덱스가 곧 화면의 칸 위치다
 *  (끌어다 놓은 자리를 그대로 지키려면 앞으로 당겨 채우면 안 된다, 사용자 지시 2026-08-29). */
type AcCell = BoardSlot | null;
/** 담긴 기물만 — 맹약 계산·인원수는 전부 이걸 거친다 */
const kept = (v: AcCell[]) => v.filter((x): x is BoardSlot => !!x);
/** 뒤쪽 빈 칸은 들고 다닐 이유가 없으니 잘라 낸다 (화면은 cap 만큼 늘 그린다) */
const trimCells = (v: AcCell[]) => {
  const o = [...v];
  while (o.length && !o[o.length - 1]) o.pop();
  return o;
};

// ── 편성 딥링크 코덱 (사용자 요청 2026-08-29) ───────────────────────────────
// 기물 id 116개가 **전부** `chess_char_…` 라 접두사를 뗀다 (`chess_char_1_01_a` → `1_01_a`,
// 최대 8자). 19칸을 다 채워도 132자라 해시에 그대로 실을 만하다.
// ⚠ 구분자는 URLSearchParams 가 **손대지 않는 글자**만 쓴다 — 실측으로 `. - * _` 는
// 그대로 나오고 `~ !` 는 %7E·%21 로 인코딩된다. 칸 사이 `.` · 중첩 짝 `*` · 예외 접두 `-`.
const CH_PRE = "chess_char_";
const pieceCode = (id: string) => (id.startsWith(CH_PRE) ? id.slice(CH_PRE.length) : `-${id}`);
const pieceId = (code: string) => (code.startsWith("-") ? code.slice(1) : CH_PRE + code);
/** 칸 배열 → "1_01_a..2_04_a" (빈 칸은 빈 토막) */
const cellsToCode = (v: AcCell[]) => trimCells(v).map((x) => (x ? pieceCode(x.id) : "")).join(".");

// ── 데이터 타입 (build-autochess.py 산출과 1:1) ──────────────────────────────
export type AcStep = { c?: string; t: string };
/** 문구 상호 참조 — [종류, 대상 id]. 종류: bond·item·band·op·enemy·mode */
export type AcRef = [string, string];
/** 게임 문구가 다른 항목을 부르는 괄호 — <고유명사> · [분류] · 【분류】(일본어판) */
const REF_TOKEN = /(<[^<>\n]+>|\[[^\[\]\n]+\]|【[^【】\n]+】)/;

/** 중첩 수치 — k=대상 코드, u=단위, b=기본값, p=중첩 1당 (build-autochess.py stack_rows) */
export type AcStack = { k: string; u: "pct" | "flat" | "sec" | "mult"; b: number;
  /** 중첩 1당 증가분 — 없으면 중첩과 무관한 상수다 */
  p?: number;
  /** 이 값이 걸린 효과 단계 (steps의 인덱스) — "6명 배치 시" 같은 상위 단계도 여기 들어온다 */
  s?: number;
  /** 상한값과 그 단위 ("stack" = 중첩 횟수, 그 외는 u와 같다) */
  cap?: number; capU?: string };
export type AcBond = { id: string; n: string; nation: boolean; min: number; cond?: string; down?: 1; steps: AcStep[]; stk?: AcStack[]; chess: string[];
  /** 중첩 개념이 있는 맹약만 1 — 조화·협동방어·독행·궁극기는 없다 (build-autochess.py) */
  stku?: 1 };
// tg = 특질 분류 태그(발동 시점·효과 유형, build-autochess.py classify_gar) — 오퍼레이터 필터용.
// evb = '맹약이 N회 중첩할 때마다' 능력이 세는 맹약 id 목록 ("core" = 핵심 맹약, 병기 가능).
// bs = 설명문이 [이름] 꼴로 언급하는 맹약 전부 — 시뮬레이터의 '돕는 특질' 판정용.
/** 특질이 올려 주는 중첩 한 행 — build-autochess.py stack_gains 산출.
 *  w = 시점(acq·restIn·restEnd·deploy·down·battle·refresh·sell) · c = 조건부(합산 불가) ·
 *  to = 맹약 id 목록 | own(자신 소속) | ownAct(자신의 활성) | top(최다 중첩) | benchAct(정비 각자의 활성) ·
 *  n = 수치 · na = 활성화 불필요 · bn = 정비 구역에서도 · per = bench/tiers 곱셈 · nb = 이웃(f/b)에도 */
export type AcGain = { w: string; c?: 1; to?: string[] | "own" | "ownAct" | "top" | "benchAct";
  n?: number; na?: 1; bn?: 1; per?: "bench" | "tiers"; pb?: string[]; nb?: "f" | "b";
  /** 자원 수급 (사용자 요청 2026-08-30) — gold 자금 · ref 무료 갱신 · item 아이템(it=장비 id) ·
   *  res 조건부 자원. bna = 이 맹약 중 하나가 발동 중이면 정비 구역에서도 센다 (스와이어 엘위) */
  k?: "gold" | "ref" | "item" | "res"; it?: string; bna?: string[] };
export type AcGar = { d: string; t: string; ic: string; tg?: string[]; evb?: string[]; bs?: string[]; gn?: AcGain[] };
export type AcChess = {
  id: string; gid?: string | null; op?: string | null; n: string; t: number; sort: number;
  kind: string; bonds: string[]; gar: string[]; garG: string[]; up?: number;
  r?: number; job?: string; jobCode?: string; sub?: string;
  /** 본체 미보유 시 대체 출전하는 전용 캐릭터 — 맹약·특질·스킬은 이 기물 것 그대로 */
  bk?: { op: string; n: string };
  /** 대체 기물(NPC) 모달 전용 — 이 캐릭터가 대체 출전하는 기물 id들 */
  subsOf?: string[];
  // sks = 오퍼의 스킬 전부 (d/dG = 일반/골든 레벨 설명 — 같은 문장이면 dG 없음, df = 기물이
  // 기본으로 들고 나오는 것). mods = 보유 모듈 전부 (d = 전투 효과, s = 능력치, df = 기본 장착).
  // modG = 모듈 슬롯이 골든부터 열림.
  sks?: { n: string; i: number; ic?: string; d?: string; lv?: number; dG?: string; lvG?: number; df?: 1 }[];
  mods?: { n: string; i?: string; d?: string; s?: string; df?: 1 }[];
  modG?: 1;
};
export type AcTierStat = { buy: number; sell: number; ph: string; lv: number; sk: number; md: number };
export type AcEquip = {
  id: string; trap: string; n: string; t: number; sort: number; buy: number;
  d: string; dG: string; bond?: string | null; up?: number; hide?: boolean;
};
/** 전략(밴드) — by=대표 오퍼레이터 이름, un=해금 조건 (없으면 처음부터 열려 있다) */
export type AcBand = {
  id: string; icon: string; n: string; hp: number; modes: string[];
  d: string; sort: number; by?: string; un?: string;
};
export type AcMode = {
  id: string; n: string; code: string; sort: number; diff: string; type: string;
  icon: string; color: string; d: string; eff: string[]; bonds: string[];
};
/** 특수 적 한 마리 — an/ae는 그 라운드에 딸려 나오는 일반·정예 적 */
export type AcEnemy = {
  id: string; n: string; code?: string; rank?: string | null;
  type: string; w: number; half: boolean; an: string[]; ae: string[];
};
/** 특훈 적 유형 — 이름·설명은 게임 표기 그대로 (autoChessData.enemyTypeDatas) */
export type AcEnemyType = {
  count: number; weight: number; n: string; d: string;
  icon?: string | null; sort: number; rnd: boolean;
};
/** 리더 적 — hide면 15라운드에만 나오는 히든 리더 */
export type AcBoss = {
  id: string; sort: number; enemy: string; n: string; code?: string | null;
  w: number; hide: boolean; hp: Record<string, number>; round: number[];
};
export type AutochessDoc = {
  id: string; name: string; krOnly: boolean; token: string;
  const: { deck: number; board: number; refresh: number; store: number; borrow: number; hpCost: number };
  modes: AcMode[];
  shop: {
    tiers: { t: number; b: AcTierStat; g: AcTierStat }[];
    levels: Record<string, { lv: number; up: number; slot: number; item: number }[]>;
    diy: Record<string, string[]>;
    /** 자유 선택 칸이 받는 등급 (전부 TIER_6 = ★6) */
    diyTier: Record<string, string>;
    /** 그 조건에 맞는 오퍼레이터 — in이 있으면 이 모드 상점 명단에도 들어 있다 */
    /** bonds = 자유 선택 시 세어지는 맹약 — 시즌1 배정 또는 진영 도출 (build-autochess.py) */
    diyPool: { op: string; n: string; job?: string; seq?: number; in?: 1; bonds?: string[] }[];
    /** 대체 기물(NPC) — 본체 미보유 기물로 대신 출전. subs = 대체하는 기물 id (사용자 제보 2026-08-23) */
    diySubs: { op: string; n: string; r: number; job?: string; subs: string[] }[];
  };
  bonds: AcBond[];
  chess: AcChess[];
  gar: Record<string, AcGar>;
  equips: AcEquip[];
  bands: AcBand[];
  buffs: { id: string; n: string; d: string; round: number }[];
  /** 수배·특훈 — **직접 골라서 불러오는 적** (ENEMY_GAIN, 사용자 지적 2026-08-29).
   *  e=등장하는 적 · c=마릿수 · coin=보상 자금 · w=자금 지급 시점(kill 처치/win 승리) · r=지속 라운드 */
  hunts: { id: string; n: string; d: string; e: string; c: number; coin: number; w?: string; r?: number }[];
  enemies: AcEnemy[];
  /** 유형별 **전체** 적 명단 (게임 표기 순서: 대표 → 함께 나오는 일반·정예). role: sp/n/e */
  enemyList: Record<string, { id: string; n: string; code?: string | null; rank?: string | null;
    role: "sp" | "n" | "e"; w?: number; half?: boolean }[]>;
  enemyTypes: Record<string, AcEnemyType>;
  enemyNames: Record<string, string>;
  bosses: AcBoss[];
  milestones: { lv: number; tk: number; id: string; n: string; c: number }[];
  rounds: { r: number; tk: number }[];
  difficulty: Record<string, number>;
  /** 문구가 <염국>·[사르곤]·<호출 모듈>처럼 부르는 이름 → 그 상세 (build-autochess.py) */
  refs?: Record<string, AcRef>;
};

// 이미지 — build-autochess.py가 public/ac/에 받아 R2로 서빙한다.
// ⚠ 폴더는 ac, 라우트는 /autochess — 이름이 달라야 deploy.sh가 자산만 떼어낸다.
const bondIcon = (id: string) => asset(`/ac/bond/${id}.webp`);
const skillIcon = (ic: string) => asset(`/ac/skill/${ic}.webp`);
const modTypeIcon = (i: string) => asset(`/ac/modtype/${i.toLowerCase()}.webp`);
const bandIcon = (id: string) => asset(`/ac/band/${id}.webp`);
const equipIcon = (trap: string) => asset(`/ac/equip/${trap}.webp`);
const garIcon = (k: string) => asset(`/ac/type/${k}.webp`);
const modeIcon = (k: string) => asset(`/ac/mode/${k}.webp`);
const etypeIcon = (k: string) => asset(`/ac/etype/${k}.webp`);
const opFace = (id: string) => asset(`/avatars/${id}.webp`);
const hideErr = (ev: React.SyntheticEvent<HTMLImageElement>) => { ev.currentTarget.style.display = "none"; };

// 화면 구성은 **게임 UI를 따른다** (사용자 확정 2026-08-22):
//   S.W.E.E.T. 리포트 = 맹약 · 전략 · 적   /   물자관리소 = 오퍼레이터 · 아이템
// ⚠ 용어도 게임 표기 그대로다 — 기물X 오퍼레이터O, 장비X 아이템O, 밴드X 전략O.
//   코드 안의 chess/equip/band 는 클뜯 필드 이름이라 그대로 두고 화면 문구만 바꾼다.
//   라운드 사이 '전략 전술' 노드에서 고르는 효과(BUFF_GAIN)는 '전략'과 헷갈리므로
//   게임 표기대로 '전략 전술'로 따로 부른다.
// ── 특질(전용 능력) 필터 — 사용자 요청 2026-08-23: 발동 시점·효과 유형별로 오퍼레이터를
// 거른다. 태그는 build-autochess.py가 KR 원문에서 분류해 gar.tg로 실어 보낸다.
// 순서는 사용자가 부른 순서 그대로. "every"(맹약이 중첩될 때마다)만 서브메뉴를 가진다 —
// 마우스오버(데스크탑)·▾ 탭(모바일)으로 어느 맹약을 세는 능력인지까지 고른다.
const GAR_CATS = ["acq", "restEnd", "restIn", "sell", "battle", "stack", "deploy", "every", "pos", "etc"] as const;
const GAR_CAT_LABEL: Record<string, string> = {
  acq: "획득 시", restEnd: "휴식 기간 종료 시", restIn: "휴식 기간 진입 시", sell: "판매 시",
  battle: "전투 중", stack: "맹약을 계속 중첩", deploy: "배치 시", every: "맹약이 중첩될 때마다",
  pos: "전방·후방·주변 칸", etc: "그 외 나머지",
};

// 시뮬레이터 뷰는 반나절 만에 접었다 (사용자 확정 2026-08-23: "그냥 물자관리소 →
// 오퍼레이터에서 필터링하는 거랑 똑같네") — 맹약 2축 선택·소속 그룹·중첩 기여 배지는
// 전부 물자관리소 오퍼레이터 탭의 필터로 들어갔다.
// 중첩 수급 표의 시점 라벨 — acq/restIn/restEnd/deploy/battle/sell 은 GAR_CAT_LABEL 과
// 같은 문구를 쓰고(번역 키 공유), refresh/down 만 여기서 새로 든다.
const GAIN_W_LABEL: Record<string, string> = {
  acq: "획득 시", deploy: "배치 시", restIn: "휴식 기간 진입 시", restEnd: "휴식 기간 종료 시",
  refresh: "갱신 시", battle: "전투 중", down: "쓰러질 시", sell: "판매 시",
};
const GAIN_W_NOTE: Record<string, string> = {
  acq: "획득할 때 1회", deploy: "전투마다", restIn: "라운드마다", restEnd: "라운드마다",
};
const VIEWS = ["bond", "band", "op", "item", "misc"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = {
  bond: "맹약", band: "전략", op: "오퍼레이터", item: "아이템", misc: "게임 정보",
};
// 게임 정보 = 핵심 셋 밖의 나머지 전부 (사용자 확정 2026-08-23: "맹약, 전략, 오퍼레이터만
// 제일 큰 탭으로 빼고 그 외는 다 게임 정보로"). 보상 탭은 같은 날 제거.
// ⚠ 물자관리소 ≠ 보급센터 (사용자 교정 2026-08-22, 옛 탭 이름의 유래): 물자관리소는 출전 전
//   편성 화면(→ 지금의 오퍼레이터·아이템), 판 안에서 도는 상점 수치가 보급센터(supply)다.
const MISC_TABS = ["enemy", "map", "hunt", "mode", "supply", "buff"] as const;
type MiscTab = (typeof MISC_TABS)[number];
const MISC_LABEL: Record<MiscTab, string> = {
  enemy: "적", map: "전투 맵", hunt: "수배·특훈", mode: "모드", supply: "보급센터", buff: "전략 전술",
};

// 정예화 표기 — 게임 데이터의 PHASE_n을 도감과 같은 말로
const PHASE_LABEL: Record<string, string> = { PHASE_0: "정예화 0", PHASE_1: "정예화 1", PHASE_2: "정예화 2" };
// 상점 등장 방식 — NORMAL만 물자관리소에 뜬다
const KIND_LABEL: Record<string, string> = { NORMAL: "상점 등장", PRESET: "특수 지급", DIY: "자유 선택", SUB: "대체 기물" };
const MODE_TYPE_LABEL: Record<string, string> = { LOCAL: "입문", SINGLE: "단독", MULTI: "협동" };
// 맹약이 인원을 세는 범위 — 전장만 세는 BOARD는 기본값이라 배지를 붙이지 않는다
const BOND_COND_LABEL: Record<string, string> = {
  BOARD_AND_DECK: "예비 포함", BOARD_ALL_CHESS: "정예화 전원",
};
/** 변형 구조체 — 맹약 아이템의 맹약을 실제로 부여하는 **유일한** 장비.
 *  클뜯 trapChessDataDict의 canGiveBond가 true인 건 이것(과 그 골든판)뿐이고,
 *  맹약 아이템 18종은 전부 false다. 게임 안내문은 "상세 대응 관계는 해당 장비의
 *  재능에서 확인"이라며 표를 안 준다 — 그래서 상세 모달에서 우리가 모아 보여 준다
 *  (사용자 요청 2026-08-24 "되게 중요한 아이템인데 싹 정리를"). */
const MORPH_ID = "chess_item_6_09_e_a";
/** 맹약 중첩 수치의 대상 이름 — build-autochess.py가 낸 코드를 화면 말로 (2026-08-24).
 *  게임 설명문이 "(중첩 수에 따라 변경)"으로 뭉갠 값을 실제 숫자로 펴 주는 자리다. */
const STACK_LABEL: Record<string, string> = {
  atk: "공격력", hp: "HP", def: "방어력", aspd: "공격 속도",
  time: "지속 시간", duration: "지속 시간", stormtime: "냉기 지속 시간",
  truedmg: "트루 대미지", magicdmg: "마법 대미지",
  dmgscale: "대미지 배율", chilldmg: "냉기·빙결 적 대미지 배율",
  magictaken: "받는 마법 대미지", lowhpdmg: "HP 50% 미만 적 대미지",
  ammo: "탄약", atkcap: "공격력 증가 상한", prob: "발동 확률",
  // 설명문이 "(최대치 존재)"·"일정량"으로만 적어 둔 상수 (build-autochess.py BOND_CONST)
  atkperammo: "탄약 1발당 공격력", atkequip: "장비 장착 시 공격력",
  atkequipgold: "승급 장비면 추가", pen: "방어력·마법 저항 무시", respawn: "재배치 시간",
  aspdcast: "스킬 발동마다 공격 속도", atkcast: "스킬 발동마다 공격력",
};
/** 소수점 지저분한 값 정리 — 0.9 / 0.35 / 1.5 는 그대로, 0.90000001 같은 건 잘라낸다 */
const trim = (n: number) => String(Math.round(n * 1e4) / 1e4);
/** 단위별 표기. pct는 배율(0.23)을 퍼센트로, mult는 ×배율, sec는 초, flat은 날숫자.
 *  "23% + 중첩당 0.9%"처럼 **식**으로 읽히게 부호를 붙이지 않는다 — '기본 +23% / 중첩 1당
 *  +0.9%'로 나눠 적었더니 둘의 관계가 안 읽혔다 (사용자 지적 2026-08-24). */
const stackNum = (v: number, u: AcStack["u"], t: T) => {
  if (u === "pct") return `${trim(v * 100)}%`;
  if (u === "mult") return `×${trim(v)}`;
  // ⚠ "초"를 문자열에 박아 두면 영어판에도 "20초"가 나온다 (2026-08-24 실측) — 사전을 탄다
  if (u === "sec") return t("{n}초", { n: trim(v) });
  return trim(v);
};
/** 중첩 n 에서의 실제 값 — 중첩당 증가분(p)이 없으면 중첩과 무관한 상수라 null.
 *  ⚠ 지금 데이터엔 p 와 cap 을 **함께** 가진 행이 없다(실측 2026-08-30). 그래도 상한을
 *  같이 처리해 둔다 — 새 패치가 상한을 붙였을 때 조용히 틀린 값을 내보내지 않도록.
 *  capU="stack" 이면 중첩 횟수 자체가 잘리고, 그 외 단위면 결과값이 잘린다. */
const stackValueAt = (sk: AcStack, n: number): number | null => {
  if (sk.p == null) return null;
  const eff = sk.capU === "stack" && sk.cap != null ? Math.min(n, sk.cap) : n;
  const v = sk.b + sk.p * eff;
  return sk.cap != null && sk.capU !== "stack" ? Math.min(v, sk.cap) : v;
};
/** 추첨 가중치의 기본값 — 67마리 중 62마리가 이 값이라, 다른 값만 카드에 띄운다 */
const ENEMY_W_BASE = 10;
/** 리더 HP는 난이도별로 다르다 — hp 키 ↔ 모드 difficulty 키 (이름은 doc.modes에서 끌어온다,
 *  그래야 EN/JA에서도 사전 없이 게임 표기 그대로 나온다) */
const BOSS_HP_KEYS: [string, string][] = [
  ["funny", "FUNNY"], ["normal", "NORMAL"], ["hard", "HARD"], ["abyss", "ABYSS"],
];

/** 적 초상 — 변종 id(…_2)에 파일이 없으면 원본 id로 한 번 폴백한다 (적 도감과 같은 규칙) */
function EnFace({ id, className = "ac-enface" }: { id: string; className?: string }) {
  return (
    <img className={className} src={enemyImg(id)} alt="" aria-hidden loading="lazy" decoding="async"
      onError={(ev) => {
        const el = ev.currentTarget;
        const base = id.replace(/_\d+$/, "");
        if (base !== id && !el.dataset.fb) { el.dataset.fb = "1"; el.src = enemyImgBase(id); }
        else el.style.visibility = "hidden";
      }} />
  );
}

/** 적 도감(로케일당 1MB)은 '적' 탭에 들어왔을 때만 받는다 — 카드는 autochess.json의
 *  이름·초상만으로 그려지고, 도감이 도착하면 상세 모달이 본문(EnemyFile)을 채운다. */
function useEnemyDex(locale: string, want: boolean) {
  const [dex, setDex] = useState<Map<string, Enemy> | null>(null);
  useEffect(() => {
    if (!want) return;
    let live = true;
    loadEnemies(locale)
      .then((m) => { if (live) setDex(m); })
      .catch(() => { /* 도감을 못 받아도 목록·카드는 그대로 보여야 한다 */ });
    return () => { live = false; };
  }, [locale, want]);
  return dex;
}

/** 리더 HP는 수십만~수백만이라 그대로 쓰면 안 읽힌다 — 천 단위 구분 */
const fmtHp = (n?: number) => (n == null ? "—" : n.toLocaleString("en-US"));

/** 게임 텍스트를 줄 단위로 — 빈 줄은 버리고 **굵게**는 rich()가 <b>로 바꾼다.
 *  render를 주면 줄마다 그걸로 그린다 (상호 참조 링크를 다는 acRich). */
function Lines({ text, className, render = rich }:
  { text: string; className?: string; render?: (s: string) => React.ReactNode }) {
  const rows = text.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!rows.length) return null;
  return <>{rows.map((r, i) => <p key={i} className={className}>{render(r)}</p>)}</>;
}

export default function AutochessGuide({ doc, onShowOperator }: {
  doc: AutochessDoc;
  /** 백과사전 오퍼 상세 모달 열기 — 기물 상세에서 특질·스킬·모듈 전문을 볼 때 쓴다 */
  onShowOperator?: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<View>("bond");
  const [miscTab, setMiscTab] = useState<MiscTab>("enemy");
  const [etype, setEtype] = useState("");              // 특훈 적 유형 거르기 ("" = 전체)
  const [bond, setBond] = useState<AcBond | null>(null);
  const [chess, setChess] = useState<AcChess | null>(null);
  // 기물 상세의 일반/정예화(골든) 토글 (사용자 확정 2026-08-23: "정예화를 따로 설명으로 빼지
  // 말고 버튼으로" — 능력·스킬·모듈이 전부 이 토글을 따라간다). 열 때마다 일반부터(openChess).
  const [goldView, setGoldView] = useState(false);
  const openChess = (c: AcChess) => { setGoldView(false); setChess(c); };
  // ── 편성 계산기 (사용자 요청 2026-08-29) ──────────────────────────────────
  // 판에 담으면 23개 맹약 상태가 한 번에 나온다. 계산 규칙은 autochess-board.ts 참고 —
  // **인원 게이트만 자동 판정하고 중첩은 자동 합산하지 않는다** (중첩을 올리는 능력 130개 중
  // 58개만 대상·수치가 고정이라, 절반 빠진 합계를 확정값처럼 보이면 안 된다).
  // ⚠ 배열을 **성기게** 든다 — 빈 칸은 null 로 남는다. 앞에서부터 촘촘히 채우면 끌어다
  // 놓은 자리가 아니라 맨 앞 빈칸으로 튕겨 나갔다 (사용자 지적 2026-08-29
  // "제일 왼쪽으로 보내지 말고 드롭한 부분에다가 놔줘"). 세는 곳은 전부 kept() 를 거친다.
  const [slots, setSlots] = useState<AcCell[]>([]);   // 전장 (최대 8~9)
  const [bench, setBench] = useState<AcCell[]>([]);   // 덱 (최대 10)
  // 중첩 수는 **맹약마다 따로**다 (사용자 지적 2026-08-29 "중첩수는 공통이 아니니까") —
  // 공통 입력칸을 없애고 맹약을 눌러 연 작은 창에서 그 맹약 것만 지정한다.
  const [stacks, setStacks] = useState<Record<string, number>>({});
  // ★(정예화)는 **칸이 아니라 기물의 성질**로 든다 — 판을 비워도 남아야 한다
  // (사용자 지시 2026-08-29 "판 비우기 할 때 스타 표시 해둔 건 지우지 말아줘").
  const [goldMark, setGoldMark] = useState<Set<string>>(new Set());
  const isGold = (id: string) => goldMark.has(id);
  const toggleGoldOf = (id: string) => setGoldMark((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const [sim, setSim] = useState(false);                 // 덱편성 시뮬레이터 모달
  const [copied, setCopied] = useState(false);           // 공유 링크 복사 알림
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* 클립보드 권한이 없으면 그냥 넘어간다 */ }
  };
  const [slot9, setSlot9] = useState(false);             // 9번째 배치 칸 — '인사부 파일' 해금
  // ⚠ 구역만이 아니라 **누른 칸의 번호까지** 든다 — 누른 자리에 그대로 놓기 위함
  // (사용자 지적 2026-08-29 "+ 버튼 눌러서 지정해도 그 카드에 지정이 돼야지").
  const [picking, setPicking] = useState<null | { z: "b" | "d"; i: number }>(null);
  const [peek, setPeek] = useState<string>("");           // 원형 맹약을 눌러 연 작은 상세 창
  // 전투 맵 — 고른 맵 id, 단독/협동 (리더 맵만 갈린다), 강조할 적
  const [acMap, setAcMap] = useState<string>("");
  const [mapCoop, setMapCoop] = useState(false);
  const [mapPin, setMapPin] = useState<Set<string>>(new Set());
  const [routesReady, setRoutesReady] = useState(false);
  const [equip, setEquip] = useState<AcEquip | null>(null);
  const [band, setBand] = useState<AcBand | null>(null);
  const [enemy, setEnemy] = useState<string | null>(null);   // 적 id (딸린 적·연계 소환도 열 수 있어 id로 든다)
  const [tier, setTier] = useState(0);                 // 0 = 전체
  // 맹약 필터 2축 — 진영·특성 하나씩 (옛 시뮬레이터의 선택 축을 그대로 필터로,
  // 사용자 확정 2026-08-23). 하나라도 고르면 오퍼 목록이 티어 섹션 대신 소속 그룹으로 갈린다.
  const [bondN, setBondN] = useState("");
  const [bondT, setBondT] = useState("");
  // 특질 필터 — "" | 카테고리 코드 | "every:<맹약 id>" (특정 맹약을 세는 능력만)
  const [garFilter, setGarFilter] = useState("");
  // 직군·세부직군 필터 (사용자 요청 2026-08-23)
  const [jobFilter, setJobFilter] = useState("");
  const [subFilter, setSubFilter] = useState("");
  const [shopMode, setShopMode] = useState("mode_single_normal");
  const { term, clear, set: setTerm, inputRef, inputProps } = useSearchInput();

  // ── 딥링크 (필터: 사용자 요청 2026-08-23 · 모달: 2026-08-24) ─────────────────
  // #<뷰>[/<게임 정보 탭>][?bn=&bt=&t=&g=&job=&sub=&q=&m=<종류>~<id>]
  //   필터·뷰 변화 → replaceState (히스토리를 안 쌓는다)
  //   모달이 **새로 열릴 때만** → pushState (뒤로가기로 닫힌다 — 록라와 같은 규약)
  // m의 종류: bond 맹약 · op 기물 · item 장비 · band 전략 · enemy 적
  //
  // ⚠ 겹쳐 뜬 모달 중 **하나만** 해시에 남는다. 아래 우선순위(맨 앞이 이김)는 실제로 겹치는
  //   순서에 맞춘 것 — 적은 어디서든 맨 위, 기물은 맹약 목록에서 열리고, 맹약은 전략 문구
  //   (<염국>)에서 열린다. 반대 방향([나란투야]로 전략을 여는 자리)은 한 곳뿐이라 양보했다.
  const curModal: [string, string] | null =
    enemy ? ["enemy", enemy]
    : equip ? ["item", equip.id]
    : chess ? ["op", chess.id]
    : bond ? ["bond", bond.id]
    : band ? ["band", band.id]
    : null;
  // 해시의 m=<종류>~<id> → 모달 상태. 해당 항목이 없으면(옛 링크·오타) 그냥 안 연다.
  // ⚠ 함수 선언이라 호이스팅된다 — 아래 effect보다 뒤에 적어도 되지만, 여기 두어야 읽힌다.
  function applyModalHash(m: string | null) {
    const cut = (m ?? "").indexOf("~");
    const kind = cut < 0 ? "" : (m as string).slice(0, cut);
    const id = cut < 0 ? "" : (m as string).slice(cut + 1);
    setEnemy(kind === "enemy" && id ? id : null);
    setEquip(kind === "item" && id ? doc.equips.find((e) => e.id === id) ?? null : null);
    setBand(kind === "band" && id ? doc.bands.find((b) => b.id === id) ?? null : null);
    setBond(kind === "bond" && id ? doc.bonds.find((b) => b.id === id) ?? null : null);
    setGoldView(false);   // 기물 상세는 언제나 일반부터 (openChess와 같은 규약)
    setChess(kind === "op" && id ? doc.chess.find((c) => c.id === id) ?? null : null);
  }
  /** 해시의 편성 파라미터 → 시뮬레이터 상태. 없는 기물 코드(옛 링크·오타)는 조용히 버린다.
   *  ⚠ 함수 선언이라 호이스팅된다 — applyModalHash 와 같은 규약. */
  function applySimHash(p: URLSearchParams) {
    const known = new Set(doc.chess.map((c) => c.id));
    const seen = new Set<string>();
    const cells = (v: string | null, cap: number): AcCell[] => {
      const out: AcCell[] = [];
      (v ?? "").split(".").slice(0, cap).forEach((code, i) => {
        if (!code) return;
        const id = pieceId(code);
        if (!known.has(id) || seen.has(id)) return;   // 같은 기물이 두 칸에 있을 수는 없다
        seen.add(id); out[i] = { id };
      });
      return trimCells(out);
    };
    const board = cells(p.get("b"), MAX_BOARD_ITEM);
    setSlots(board);
    setBench(cells(p.get("d"), MAX_DECK));
    // 9번째 칸은 링크에 기물이 있으면 자동으로 열어 준다 — 안 그러면 그 칸이 안 그려진다
    setSlot9(p.get("s9") === "1" || Boolean(board[MAX_BOARD]));
    setGoldMark(new Set((p.get("gd") ?? "").split(".").map(pieceId).filter((id) => known.has(id))));
    const st: Record<string, number> = {};
    for (const pair of (p.get("k") ?? "").split(".")) {
      const [id, n] = pair.split("*");
      const v = Number(n);
      if (id && Number.isFinite(v) && v > 0) st[id] = Math.min(999, Math.floor(v));
    }
    setStacks(st);
    setSim(p.get("sim") === "1");
  }
  const hydrated = useRef(false);
  const prevHash = useRef("");
  // ⚠ useEffect가 아니라 **useLayoutEffect** — 해시 반영이 페인트 뒤로 밀리면 기본 탭(맹약)이
  // 한 프레임 보였다가 딥링크 탭으로 튄다 (story.tsx #story-<id>와 같은 규약).
  useLayoutEffect(() => {
    const apply = () => {
      // 전역 모달(#changelog·#broadcast…)이 떠 있으면 내 상태로 해석하지 않는다 — 그대로
      // 두면 다른 모달을 여는 순간 이 페이지의 필터·모달이 통째로 초기화된다 (2026-08-24)
      if (GLOBAL_MODAL_HASH.test(window.location.hash)) return;
      // 빈 해시 = **기본 상태**(맹약 탭·필터 없음·모달 없음)다. 종전엔 여기서 그냥 빠져나가
      // 뒤로가기로 해시가 지워져도 모달이 안 닫혔다 (2026-08-24 실측).
      const h = decodeURIComponent(window.location.hash.slice(1));
      const [head, qs] = h.split("?");
      const [v, tab] = head.split("/");
      setView((VIEWS as readonly string[]).includes(v) ? (v as View) : "bond");
      if (v === "misc" && (MISC_TABS as readonly string[]).includes(tab)) setMiscTab(tab as MiscTab);
      const p = new URLSearchParams(qs ?? "");
      setBondN(p.get("bn") ?? "");
      setBondT(p.get("bt") ?? "");
      const tn = Number(p.get("t"));
      setTier(tn >= 1 && tn <= 6 ? tn : 0);
      setGarFilter(p.get("g") ?? "");
      setJobFilter(p.get("job") ?? "");
      setSubFilter(p.get("sub") ?? "");
      // q가 없으면 지운다 — 남기면 뒤로가기로 뷰를 옮겼을 때 빈 검색칸으로 계속 걸러진다
      setTerm(p.get("q") ?? "");
      applyModalHash(p.get("m"));
      applySimHash(p);
    };
    apply();
    hydrated.current = true;
    prevHash.current = window.location.hash;
    // 첫 페인트 가리개 해제 — 이제 화면이 해시대로 그려진다 (layout.tsx pre-paint 스크립트)
    document.documentElement.removeAttribute("data-hashboot");
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
    // 마운트 1회 + 해시 편집 — 이후 상태 변화는 아래 effect가 해시로 내보낸다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    if (GLOBAL_MODAL_HASH.test(window.location.hash)) return;
    const p = new URLSearchParams();
    if (view === "op" || view === "item") {
      if (bondN) p.set("bn", bondN);
      if (bondT) p.set("bt", bondT);
      if (tier) p.set("t", String(tier));
      if (term) p.set("q", term);
      if (view === "op") {
        if (garFilter) p.set("g", garFilter);
        if (jobFilter) p.set("job", jobFilter);
        if (subFilter) p.set("sub", subFilter);
      }
    }
    // 편성(덱편성 시뮬레이터)은 탭과 무관하게 싣는다 — 링크 하나로 판이 그대로 열린다
    if (sim) {
      p.set("sim", "1");
      const bc = cellsToCode(slots), dc = cellsToCode(bench);
      if (bc) p.set("b", bc);
      if (dc) p.set("d", dc);
      if (slot9) p.set("s9", "1");
      // 골든은 **판에 올라온 기물 것만** 싣는다 (표식은 판을 비워도 남지만 링크엔 군더더기)
      const onBoard = new Set([...kept(slots), ...kept(bench)].map((x) => x.id));
      const gd = [...goldMark].filter((id) => onBoard.has(id)).map(pieceCode).join(".");
      if (gd) p.set("gd", gd);
      const k = Object.entries(stacks).filter(([, n]) => n > 0).map(([id, n]) => `${id}*${n}`).join(".");
      if (k) p.set("k", k);
    }
    if (curModal) p.set("m", `${curModal[0]}~${curModal[1]}`);
    // ~는 URL에서 그대로 써도 되는 글자인데 URLSearchParams가 %7E로 인코딩한다 — 링크가
    // 읽히게 되돌린다 (해석은 decodeURIComponent가 하므로 양쪽 다 받는다)
    const qs = p.toString().replace(/%7E/g, "~");
    const hash = view === "bond" && !qs ? "" : `#${view}${view === "misc" ? `/${miscTab}` : ""}${qs ? `?${qs}` : ""}`;
    if (hash !== window.location.hash) {
      // 모달이 **새로 열린** 경우만 히스토리를 쌓아 뒤로가기로 닫히게 한다.
      // ⚠ vinext가 history.pushState를 인스턴스 패치해 내비게이션으로 취급 — .site-scroll을
      //   맨 위로 리셋한다. 네이티브 프로토타입을 직접 불러 라우터를 우회한다 (rogue.tsx 실측).
      // 모달이 새로 열린 경우만 히스토리를 쌓는다 — 시뮬레이터도 같은 규약이라 뒤로가기로 닫힌다
      const opening = (!!curModal && !/[?&]m=/.test(prevHash.current))
        || (sim && !/[?&]sim=/.test(prevHash.current));
      if (opening) History.prototype.pushState.call(history, null, "", hash);
      else history.replaceState(null, "", hash || window.location.pathname + window.location.search);
    }
    prevHash.current = hash;
  }, [view, miscTab, bondN, bondT, tier, garFilter, jobFilter, subFilter, term, curModal?.[0], curModal?.[1],
      sim, slots, bench, slot9, goldMark, stacks]); // eslint-disable-line react-hooks/exhaustive-deps


  // 검색 입력은 비제어(useSearchInput)라 뷰가 바뀌어 입력칸이 새로 마운트되면 빈칸이 된다.
  // 살아 있는 term을 DOM에 되써서 "빈 검색칸 + 걸러진 목록" 불일치를 막는다 — 딥링크
  // ?q= 진입 복원도 이 이펙트가 담당한다 (사용자 제보 2026-08-23).
  useEffect(() => {
    const el = inputRef.current;
    if (el && el.value !== term) el.value = term;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, view]);

  const chessById = useMemo(() => {
    const m = new Map<string, AcChess>();
    for (const c of doc.chess) m.set(c.id, c);
    return m;
  }, [doc]);
  const bondById = useMemo(() => {
    const m = new Map<string, AcBond>();
    for (const b of doc.bonds) m.set(b.id, b);
    return m;
  }, [doc]);
  // 변형 구조체 대응표 — 맹약을 주는 장비를 맹약별로 묶는다. 맹약 순서는 목록과 같고
  // (진영 → 특성), 같은 맹약 안에서는 티어순이다. 빅토리아 해머처럼 한 맹약에 여러
  // 장비가 걸린 경우가 있어 묶어서 보여야 읽힌다.
  const morphMap = useMemo(() => {
    const by = new Map<string, AcEquip[]>();
    for (const e of doc.equips) if (e.bond) (by.get(e.bond) ?? by.set(e.bond, []).get(e.bond)!).push(e);
    for (const list of by.values()) list.sort((a, b) => a.t - b.t || a.sort - b.sort);
    return doc.bonds.filter((b) => by.has(b.id)).map((b) => [b, by.get(b.id)!] as const);
  }, [doc]);
  // 전략의 대표 오퍼레이터 이름 → 기물. 36개 중 8개만 이 모드의 기물이고 나머지는
  // 판 밖의 NPC라, 기물인 것만 눌러서 상세를 연다 (2026-08-24).
  const chessByName = useMemo(() => {
    const m = new Map<string, AcChess>();
    for (const c of doc.chess) if (!m.has(c.n)) m.set(c.n, c);
    return m;
  }, [doc]);
  // 표준 시뮬레이션은 맹약이 13개뿐 — 어느 모드에서 도는 맹약인지 배지로 알린다
  const funnyBonds = useMemo(
    () => new Set(doc.modes.find((m) => m.diff === "FUNNY")?.bonds ?? []), [doc]);

  // 적 모달은 '적' 탭 밖에서도 열린다 — 전략 문구의 <덕로드>처럼 문구가 부르는 적
  // (2026-08-24). 창이 떠 있으면 도감을 받아 본문을 채운다.
  const enemyDex = useEnemyDex(locale,
    (view === "misc" && (miscTab === "enemy" || miscTab === "map")) || enemy != null);
  // 전투 맵 데이터는 그 탭을 처음 열 때만 받는다 (42KB)
  const wantRoutes = view === "misc" && miscTab === "map";
  useEffect(() => {
    if (!wantRoutes || routesReady) return;
    let live = true;
    loadAcRoutes().then(() => { if (live) setRoutesReady(true); })
      .catch(() => { /* 못 받아도 나머지 탭은 그대로 돈다 */ });
    return () => { live = false; };
  }, [wantRoutes, routesReady]);
  /** 리더 상세 → 그 리더의 전투 맵으로. 데이터를 기다렸다가 고른다 (사용자 확정 2026-08-30) */
  const openLeaderMap = async (bossId: string) => {
    setEnemy(null); setView("misc"); setMiscTab("map"); setMapPin(new Set());
    await loadAcRoutes().catch(() => { /* 못 받으면 탭의 안내문이 그대로 뜬다 */ });
    setRoutesReady(true);
    const v = AC_ROUTES?.leaders[bossId];
    if (v) setAcMap(mapCoop ? v.c : v.s);
  };
  const enemyRow = useMemo(
    () => (enemy ? doc.enemies.find((e) => e.id === enemy) ?? null : null), [doc, enemy]);
  const bossRow = useMemo(
    () => (enemy ? doc.bosses.find((b) => b.enemy === enemy) ?? null : null), [doc, enemy]);
  const enemyName = (id: string) => doc.enemyNames[id] ?? enemyDex?.get(id)?.name ?? id;
  // 유형은 게임 표기 순서(sortId)대로 — 특이 → 비행 → 빈도 → 원소 → 지속 → 은신 → 굴절
  const etypes = useMemo(
    () => Object.entries(doc.enemyTypes).sort((a, b) => a[1].sort - b[1].sort), [doc]);
  const modeNameOf = (diff: string) =>
    doc.modes.find((m) => m.diff === diff && m.type !== "MULTI")?.n ?? diff;
  const diySlots = Object.values(doc.shop.diy).reduce((a, x) => a + x.length, 0);
  // 이미 상점 명단에 있는 ★6은 뺀다 — 자유 선택 칸으로 새로 데려올 수 있는 쪽만 남긴다
  // (사용자 지시 2026-08-22)
  const diyPool = useMemo(() => doc.shop.diyPool.filter((o) => !o.in), [doc]);
  // 대체 기물(NPC) — 게임의 자유 선택 판에 항상 뜨는 나머지 절반 (사용자 제보 2026-08-23)
  const diySubs = useMemo(() => doc.shop.diySubs ?? [], [doc]);
  const openSub = (s: { op: string; n: string; r: number; job?: string; subs: string[] }) =>
    openChess({ id: `sub_${s.op}`, op: s.op, n: s.n, t: 0, sort: 0, kind: "SUB",
      bonds: [], gar: [], garG: [], r: s.r, job: s.job, subsOf: s.subs });

  const nameOfBond = (id: string) => bondById.get(id)?.n ?? id;
  /** 그 효과 줄에 걸린 실제 수치 — 맹약 상세와 원형 배지의 작은 창이 **같은 것**을 쓴다.
   *  중첩을 넣어 두면 "20% + 중첩당 0.35% = 34%" 처럼 푼 값을 뒤에 붙인다
   *  (사용자 지적 2026-08-30 "40중첩 설정했는데 왜 일정확률로 나옴" — 정작 중첩을 넣는
   *  작은 창에는 수치가 아예 없어서, 게임 원문의 '일정 확률로'만 보였다).
   *  s가 범위를 벗어나면 마지막 줄에 붙인다 — 어떤 경우에도 수치를 잃지 않게. */
  const stackList = (b: AcBond, i: number) => {
    const nums = (b.stk ?? []).filter((sk) => Math.min(sk.s ?? 0, b.steps.length - 1) === i);
    if (!nums.length) return null;
    const n = stacks[b.id] ?? 0;
    return (
      <div className="ac-stackrow"><ul className="ac-stack">
        {nums.map((sk) => {
          const v = n > 0 ? stackValueAt(sk, n) : null;
          return (
            <li key={sk.k}>
              <b>{t(STACK_LABEL[sk.k] ?? sk.k)}</b>
              <span className="ac-stack-eq">
                <em>{stackNum(sk.b, sk.u, t)}</em>
                {sk.p != null && <>{" + "}{t("중첩당")} <em>{stackNum(sk.p, sk.u, t)}</em></>}
                {v != null && <b className="ac-stack-now">= {stackNum(v, sk.u, t)}</b>}
              </span>
              {sk.cap != null && <i>{sk.capU === "stack"
                ? t("최대 {n}중첩", { n: trim(sk.cap) })
                : t("최대 {v}", { v: stackNum(sk.cap, sk.u, t) })}</i>}
            </li>
          );
        })}
      </ul></div>
    );
  };

  // ── 편성 계산 ────────────────────────────────────────────────────────────
  // 중첩은 **기본 0** 으로 본다 (사용자 지시 2026-08-29 "처음엔 - 이 아니라 0으로").
  // 배지에 0 을 띄우면서 단계만 '판정 불가(?)' 로 두면 앞뒤가 안 맞아, 계산도 0 기준으로
  // 맞춘다 — 중첩이 전투 중에 쌓인다는 단서는 작은 창의 안내문이 계속 들고 있다.
  const stacksAll = useMemo(
    () => Object.fromEntries(doc.bonds.map((b) => [b.id, stacks[b.id] ?? 0])), [doc, stacks]);
  const withGold = (v: BoardSlot[]) => v.map((x) => ({ ...x, gold: goldMark.has(x.id) }));
  const boardState = useMemo(
    () => computeBoard(doc.bonds, chessById, withGold(kept(slots)), withGold(kept(bench)), stacksAll),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, chessById, slots, bench, stacksAll, goldMark]);
  /** 켜진 맹약 먼저, 그다음 인원이 많은 순 — 판을 보는 사람이 궁금한 순서다 */
  const boardBonds = useMemo(() => boardState
    .map((st, i) => ({ st, b: doc.bonds[i] }))
    .filter((x) => x.st.counted > 0 || x.st.active)
    .sort((a, b) => Number(b.st.active) - Number(a.st.active) || b.st.counted - a.st.counted),
    [boardState, doc]);
  const placed = useMemo(() => new Set([...kept(slots), ...kept(bench)].map((x) => x.id)), [slots, bench]);

  // ── 중첩 수급 총정리 (사용자 요청 2026-08-30 "어느 상황에 어느 맹약이 몇 개씩") ────
  // 판에 올라온 기물들의 gn(특질의 중첩 행)을 시점별로 모은다. **확정 행만 합산**하고
  // 조건부(횟수·확률·남의 행동에 달린 것)는 설명문 그대로 보여 준다 — 절반 섞인 합계를
  // 확정값처럼 내보이지 않는다 (autochess-board.ts 머리주석과 같은 원칙).
  // 정비 구역 기물은 <획득 시>와 '정비 구역에 있어도 적용'(bn) 행만 낸다 — 나머지 특질은
  // 전장에 있어야 돈다 (원문이 bn 을 예외로 명기하는 것이 그 방증).
  const gainRows = useMemo(() => {
    const activeB = new Set(doc.bonds.filter((_, i) => boardState[i]?.active).map((b) => b.id));
    const onB = kept(slots).map((x) => chessById.get(x.id)).filter((c): c is AcChess => !!c);
    const onD = kept(bench).map((x) => chessById.get(x.id)).filter((c): c is AcChess => !!c);
    type Cond = { c: AcChess; gid: string; selfIn?: boolean };
    type Bucket = { sum: Map<string, number>; wait: Map<string, number>; top: number; topWait: number;
      conds: Cond[]; gold: number; ref: number; items: Map<string, number> };
    const buckets = new Map<string, Bucket>();
    const at = (w: string): Bucket => {
      let b = buckets.get(w);
      if (!b) { b = { sum: new Map(), wait: new Map(), top: 0, topWait: 0, conds: [], gold: 0, ref: 0, items: new Map() }; buckets.set(w, b); }
      return b;
    };
    const add = (m: Map<string, number>, id: string, n: number) => m.set(id, (m.get(id) ?? 0) + n);
    // per="tiers" — 전장의 pb 소속 기물이 가진 서로 다른 티어 수
    const tiersOf = (pb: string[]) =>
      new Set(onB.filter((c) => c.bonds.some((b) => pb.includes(b))).map((c) => c.t)).size;
    const handle = (c: AcChess, onBoard: boolean) => {
      for (const gid of (isGold(c.id) ? c.garG : c.gar)) {
        for (const r of doc.gar[gid]?.gn ?? []) {
          // 정비 구역: 획득·판매 시점(구역 무관)과 '정비 구역에서도' 표기(bn),
          // 맹약 발동을 조건으로 정비 구역까지 미치는 것(bna — 스와이어 엘위)만 센다
          if (!onBoard && !r.bn && r.w !== "acq" && r.w !== "sell"
            && !(r.bna && r.bna.some((id) => activeB.has(id)))) continue;
          const B = at(r.w);
          if (r.c) { B.conds.push({ c, gid }); continue; }
          if (r.k === "gold") { B.gold += r.n ?? 0; continue; }
          if (r.k === "ref") { B.ref += r.n ?? 0; continue; }
          if (r.k === "item") {
            if (r.it) B.items.set(r.it, (B.items.get(r.it) ?? 0) + (r.n ?? 0));
            continue;
          }
          const mult = r.per === "bench" ? onD.length : r.per === "tiers" ? tiersOf(r.pb ?? []) : 1;
          const n = (r.n ?? 0) * mult;
          if (!n) continue;
          if (r.to === "top") { if (activeB.size) B.top += n; else B.topWait += n; continue; }
          if (r.to === "benchAct") {
            for (const bc of onD) for (const b of bc.bonds) if (activeB.has(b)) add(B.sum, b, r.n ?? 0);
            continue;
          }
          const targets = r.to === "own" ? c.bonds
            : r.to === "ownAct" ? c.bonds.filter((b) => activeB.has(b))
            : (r.to ?? []);
          for (const b of targets)
            add(r.na || r.to === "ownAct" || activeB.has(b) ? B.sum : B.wait, b, n);
          // 이웃(전방/후방 1칸)에게도 같은 중첩 — 그 몫은 대상 기물을 모르니 안내만 한다
          if (r.nb) B.conds.push({ c, gid, selfIn: true });
        }
      }
    };
    for (const c of onB) handle(c, true);
    for (const c of onD) handle(c, false);
    const order = ["acq", "deploy", "restIn", "restEnd", "refresh", "battle", "down", "sell"];
    return order
      .map((w) => ({ w, b: buckets.get(w) }))
      .filter((x): x is { w: string; b: Bucket } =>
        !!x.b && (x.b.sum.size > 0 || x.b.wait.size > 0 || x.b.top > 0 || x.b.topWait > 0
          || x.b.conds.length > 0 || x.b.gold > 0 || x.b.ref > 0 || x.b.items.size > 0))
      .map(({ w, b }) => ({
        w,
        sum: [...b.sum].sort((a, z) => z[1] - a[1]),
        wait: [...b.wait].sort((a, z) => z[1] - a[1]),
        top: b.top,
        topWait: b.topWait,
        conds: b.conds,
        gold: b.gold,
        ref: b.ref,
        items: [...b.items],
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, chessById, slots, bench, boardState, goldMark]);
  const nBoard = kept(slots).length, nBench = kept(bench).length;
  const boardCap = slot9 ? MAX_BOARD_ITEM : MAX_BOARD;
  /** 고르기 모달에서 담기 — **누른 그 칸**에 놓는다. 그 칸이 이미 찼으면(있을 수 없지만)
   *  같은 줄의 첫 빈 칸으로 물러난다. */
  const addPieceTo = (at: { z: "b" | "d"; i: number }, c: AcChess) => {
    if (placed.has(c.id)) return;
    const cap = at.z === "b" ? boardCap : MAX_DECK;
    if (at.i >= cap) return;
    (at.z === "b" ? setSlots : setBench)((v) => {
      const out = [...v];
      if (!out[at.i]) { out[at.i] = { id: c.id }; return trimCells(out); }
      for (let i = 0; i < cap; i++) if (!out[i]) { out[i] = { id: c.id }; return trimCells(out); }
      return v;                                   // 자리가 없다
    });
  };
  // ── 끌어 옮기기 (사용자 요청 2026-08-29) ─────────────────────────────────
  // 배치 ↔ 정비구역을 마우스로 옮긴다. **놓은 칸이 곧 결과 자리다** — 빈 칸이면 거기에
  // 그대로 놓고, 기물 위면 자리를 맞바꾼다. 정원은 인덱스가 cap 미만이라는 것으로 지켜진다.
  const dragFrom = useRef<{ z: "b" | "d"; i: number } | null>(null);
  const [dropAt, setDropAt] = useState<string>("");     // "b3" 처럼 — 놓을 자리 강조용
  const moveSlot = (from: { z: "b" | "d"; i: number }, to: { z: "b" | "d"; i: number }) => {
    if (from.z === to.z && from.i === to.i) return;
    if (to.i >= (to.z === "b" ? boardCap : MAX_DECK)) return;
    if (from.z === to.z) {
      const v = [...(from.z === "b" ? slots : bench)];
      const a = v[from.i] ?? null;
      if (!a) return;
      v[from.i] = v[to.i] ?? null; v[to.i] = a;
      (from.z === "b" ? setSlots : setBench)(trimCells(v));
      return;
    }
    const src = [...(from.z === "b" ? slots : bench)];
    const dst = [...(to.z === "b" ? slots : bench)];
    const a = src[from.i] ?? null;
    if (!a) return;
    src[from.i] = dst[to.i] ?? null; dst[to.i] = a;            // 빈 칸이면 그냥 옮겨지고, 기물이면 맞바꾼다
    if (from.z === "b") { setSlots(trimCells(src)); setBench(trimCells(dst)); }
    else { setBench(trimCells(src)); setSlots(trimCells(dst)); }
  };
  /** 놓을 수 있는 칸에 공통으로 다는 속성 */
  const dropProps = (z: "b" | "d", i: number) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDropAt(`${z}${i}`); },
    onDragLeave: () => setDropAt((v) => (v === `${z}${i}` ? "" : v)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setDropAt("");
      const from = dragFrom.current; dragFrom.current = null;
      if (from) moveSlot(from, { z, i });
    },
  });

  const dropFrom = (where: "b" | "d", i: number) =>
    (where === "b" ? setSlots : setBench)((v) => { const o = [...v]; o[i] = null; return trimCells(o); });


  // 기물 → 특질 카테고리 집합 (gar+garG 합집합, 아무 태그도 없으면 "etc") + 세는 맹약 집합
  const garTagsOf = useMemo(() => {
    const m = new Map<string, { tags: Set<string>; evb: Set<string>; refs: Set<string> }>();
    for (const c of doc.chess) {
      const tags = new Set<string>(), evb = new Set<string>(), refs = new Set<string>();
      for (const g of [...c.gar, ...c.garG]) {
        for (const tg of doc.gar[g]?.tg ?? []) tags.add(tg);
        for (const b of doc.gar[g]?.evb ?? []) evb.add(b);
        for (const b of doc.gar[g]?.bs ?? []) refs.add(b);
      }
      if (!tags.size) tags.add("etc");
      m.set(c.id, { tags, evb, refs });
    }
    return m;
  }, [doc]);
  const everyBonds = useMemo(() => {
    const ids = [...new Set(Object.values(doc.gar).flatMap((g) => g.evb ?? []))];
    // 맹약 목록 순서(진영 먼저)대로, '핵심 맹약'은 맨 뒤
    return ids.sort((a, b) => (a === "core" ? 1 : b === "core" ? -1 : (bondById.get(a) ? doc.bonds.findIndex((x) => x.id === a) : 99) - (bondById.get(b) ? doc.bonds.findIndex((x) => x.id === b) : 99)));
  }, [doc, bondById]);
  const matchGarBy = (c: AcChess, filter: string) => {
    if (!filter) return true;
    const e = garTagsOf.get(c.id);
    if (!e) return false;
    return filter.startsWith("every:") ? e.evb.has(filter.slice(6)) : e.tags.has(filter);
  };

  // 기물 하나가 고른 맹약의 중첩에 **관여**하는가 — 계속 올리거나(stack+언급),
  // 중첩 수를 세어 강해지거나(evb). 실측: 맹약을 언급하는 특질은 전부 그 맹약 소속
  // 오퍼에게 있다 — 그래서 별도 그룹이 아니라 소속 그룹 안 배지·우선 정렬로 쓴다.
  const bondFeed = (c: AcChess): { stack: string[]; every: string[] } => {
    const e = garTagsOf.get(c.id);
    const stack: string[] = [], every: string[] = [];
    for (const id of [bondN, bondT]) {
      if (!id || !e) continue;
      if (e.evb.has(id)) every.push(id);
      else if (e.tags.has("stack") && e.refs.has(id)) stack.push(id);
    }
    return { stack, every };
  };

  const q = normSearch(term);
  // 오퍼 필터 풀 — 맹약은 여기서 거르지 않는다. 맹약을 고르면 아래 bondGroups가
  // 이 풀을 '두 맹약 모두 / 진영 / 특성 소속'으로 갈라 그 자체가 맹약 필터가 된다.
  // ⚠ 특질을 거르기 **전** 단계를 따로 둔다 — 드롭다운 옆 숫자는 자기 축을 빼고 세야 해서
  // (아래 facetCount) 특질 필터가 걸리지 않은 풀이 필요하다.
  const rowsNoGar = useMemo(() => doc.chess.filter((c) => {
    // 자유 선택 슬롯 4칸은 오퍼레이터가 아니라 빈 칸이다 — 목록 맨 아래 후보 명단이
    // 그 자리를 대신하므로 카드에서는 뺀다 (2026-08-22)
    if (c.kind === "DIY") return false;
    if (tier && c.t !== tier) return false;
    if (jobFilter && c.job !== jobFilter) return false;
    if (subFilter && c.sub !== subFilter) return false;
    if (!q) return true;
    const hay = [c.n, c.job ?? "", c.sub ?? "", ...(c.sks?.map((x) => x.n) ?? []), ...(c.mods?.map((x) => x.n) ?? []),
      ...c.bonds.map(nameOfBond),
      ...[...c.gar, ...c.garG].map((g) => doc.gar[g]?.d ?? "")].join(" ");
    return normSearch(hay).includes(q);
  }), [doc, tier, jobFilter, subFilter, q]);   // eslint-disable-line react-hooks/exhaustive-deps
  const chessRows = useMemo(
    () => rowsNoGar.filter((c) => matchGarBy(c, garFilter)),
    [rowsNoGar, garFilter]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── 드롭다운 옆 숫자 (사용자 지시 2026-08-29) ─────────────────────────────
  // "염국 누르면 특성 맹약에서 기민이 11명이 아니라 1명이라고 나오게" — 숫자는 전체 인원이
  // 아니라 **지금 걸린 다른 필터를 반영한 인원**이다 (염국 10명 ∩ 기민 11명 = 1명).
  // ⚠ 자기 축은 빼고 센다 — 그래야 같은 축의 다른 값으로 갈아탈 수 있다 (특성 맹약 칸의
  // 숫자에 지금 고른 특성 맹약을 또 걸면 고른 것만 남고 나머지가 전부 0이 된다).
  // 고르기 모달에서는 이미 담은 기물도 뺀다 — 그 목록이 그렇게 나오므로 숫자도 맞춰야 한다.
  const facetCount = useMemo(() => {
    const base = picking ? rowsNoGar.filter((c) => !placed.has(c.id)) : rowsNoGar;
    const nation = new Map<string, number>(), trait = new Map<string, number>(), gar = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const c of base) {
      const okN = !bondN || c.bonds.includes(bondN);
      const okT = !bondT || c.bonds.includes(bondT);
      if (matchGarBy(c, garFilter)) {
        for (const id of c.bonds) {
          if (bondById.get(id)?.nation) { if (okT) bump(nation, id); }   // 진영 칸엔 특성 선택만 건다
          else if (okN) bump(trait, id);                                 // 특성 칸엔 진영 선택만 건다
        }
      }
      if (okN && okT) {          // 특질 칸엔 맹약 2축을 다 건다 (자기 축은 garFilter 라 뺀다)
        bump(gar, "__all");
        const e = garTagsOf.get(c.id);
        if (e) { for (const tg of e.tags) bump(gar, tg); for (const b of e.evb) bump(gar, `every:${b}`); }
      }
    }
    return { nation, trait, gar };
  }, [rowsNoGar, picking, placed, bondN, bondT, garFilter, bondById, garTagsOf]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** 고르기 모달의 목록 — 이미 담은 기물은 빼고, **맹약 필터도 여기서 건다.**
   *  chessRows 는 진영·특성 맹약을 안 본다 (오퍼레이터 탭은 맹약을 고르면 bondGroups 로
   *  갈라지기 때문). 모달은 카드 한 벌만 쓰므로 여기서 직접 걸러야 필터가 먹는다
   *  (사용자 제보 2026-08-29 "진영맹약 특성맹약 어쩌고 바꿔도 밑에 오퍼들이 필터링이 안 됨"). */
  const pickRows = useMemo(() => chessRows.filter((c) =>
    !placed.has(c.id)
    && (!bondN || c.bonds.includes(bondN))
    && (!bondT || c.bonds.includes(bondT))), [chessRows, placed, bondN, bondT]);

  // 맹약을 골랐을 때의 소속 그룹 (옛 시뮬레이터 로직 그대로) — 기여자 먼저, 티어순
  const bondGroups = useMemo(() => {
    if (!bondN && !bondT) return null;
    const both: AcChess[] = [], nOnly: AcChess[] = [], tOnly: AcChess[] = [];
    for (const c of chessRows) {
      const inN = Boolean(bondN) && c.bonds.includes(bondN);
      const inT = Boolean(bondT) && c.bonds.includes(bondT);
      if (inN && inT) both.push(c);
      else if (inN) nOnly.push(c);
      else if (inT) tOnly.push(c);
    }
    const feeds = (c: AcChess) => { const f = bondFeed(c); return f.stack.length + f.every.length ? 0 : 1; };
    const byTier = (a: AcChess, b: AcChess) =>
      feeds(a) - feeds(b) || (a.t - b.t) || ((a.sort || 99) - (b.sort || 99)) || a.n.localeCompare(b.n);
    for (const arr of [both, nOnly, tOnly]) arr.sort(byTier);
    return { both, nOnly, tOnly };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chessRows, bondN, bondT, garTagsOf]);

  // 직군 → 세부직군 (사용자 확정 2026-08-23: 두 드롭다운이 아니라 직군에 마우스오버하면
  // 세부직군이 서브메뉴로). 인원수도 같이 세어 메뉴에 띄운다.
  const jobTree = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const c of doc.chess) {
      if (c.kind === "DIY" || !c.job) continue;
      if (!m.has(c.job)) m.set(c.job, new Map());
      if (c.sub) m.get(c.job)!.set(c.sub, (m.get(c.job)!.get(c.sub) ?? 0) + 1);
    }
    return m;
  }, [doc]);
  const jobCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of doc.chess) if (c.kind !== "DIY" && c.job) m.set(c.job, (m.get(c.job) ?? 0) + 1);
    return m;
  }, [doc]);

  // 대표 오퍼 이름으로도 찾을 수 있어야 한다 — 커뮤니티는 '집중 케어'가 아니라
  // '와파린 전략'으로 부른다 (사용자 확정 2026-08-24)
  const bandRows = useMemo(() => doc.bands.filter((b) =>
    !q || normSearch(`${b.n} ${b.by ?? ""} ${b.d}`).includes(q)), [doc, q]);
  const equipRows = useMemo(() => doc.equips.filter((e) =>
    !q || normSearch(`${e.n} ${e.d} ${e.dG}`).includes(q)), [doc, q]);
  const buffRows = useMemo(() => doc.buffs.filter((b) =>
    !q || normSearch(`${b.n} ${b.d}`).includes(q)), [doc, q]);
  // 수배·특훈 — 효과 이름·설명에 더해 **등장하는 적 이름**까지 훑는다
  // ("제셀톤이 어디서 나오지"가 이 탭의 물음이다, 사용자 지적 2026-08-29)
  const huntRows = useMemo(() => doc.hunts.filter((h) =>
    !q || normSearch(`${h.n} ${h.d} ${doc.enemyNames[h.e] ?? ""}`).includes(q)), [doc, q]);
  // 맹약 검색 — 이름·효과문에 더해 **소속 오퍼레이터 이름**까지 훑는다.
  // "이 오퍼가 어느 맹약이더라"가 이 탭에서 가장 흔한 물음이라서 (2026-08-24)
  const bondRows = useMemo(() => {
    if (!q) return doc.bonds;
    const nameOf = new Map(doc.chess.map((c) => [c.id, c.n]));
    return doc.bonds.filter((b) => normSearch(
      `${b.n} ${b.steps.map((st) => `${st.c ?? ""} ${st.t}`).join(" ")} `
      + b.chess.map((id) => nameOf.get(id) ?? "").join(" ")).includes(q));
  }, [doc, q]);

  // ── 조각들 ────────────────────────────────────────────────────────────────
  const tierBadge = (n: number) => <em className={`ac-tier ac-t${n}`}>T{n}</em>;

  // 기물 카드 — 물자관리소 목록과 시뮬레이터 추천이 같은 카드를 쓴다 (2026-08-23 추출)
  const chessCard = (c: AcChess, marks?: string[]) => (
    <button key={c.id} type="button" className="ac-card ac-chesscard" onClick={() => openChess(c)}>
      <header>
        {c.op
          ? <img className="ac-thumb" src={opFace(c.op)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
          : <span className="ac-thumb ac-face-diy" aria-hidden>?</span>}
        <div>
          <b className="ac-cname">{c.n}</b>
          <span className="ac-cmeta">
            {tierBadge(c.t)}
            {c.r ? <i className="ac-star">★{c.r}</i> : null}
            {c.job ? <i className="sb-chip">{c.job}</i> : null}
            {c.kind !== "NORMAL" && <i className="sb-chip ac-kind">{t(KIND_LABEL[c.kind] ?? c.kind)}</i>}
          </span>
        </div>
      </header>
      {/* 카드 전체가 버튼이라 안쪽 맹약은 태그로 — 버튼 중첩은 HTML 위반이라
          하이드레이션 오류가 났다 (2026-08-22 콘솔 실측). 모달 안 칩은 그대로 누른다. */}
      <div className="ac-bondline">
        {c.bonds.map((b) => bondTag(b))}
        {marks?.map((m) => <i key={m} className="sb-chip ac-feed">{m}</i>)}
      </div>
      {c.gar.map((g) => garLine(g, false))}
    </button>
  );

  const bondChip = (id: string, small = false) => {
    const b = bondById.get(id);
    if (!b) return null;
    return (
      <button key={id} type="button" className={`ac-bondchip${small ? " sm" : ""}${b.nation ? " nation" : ""}`}
        onClick={() => { setBond(b); }}>
        <img src={bondIcon(id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
        {b.n}
      </button>
    );
  };

  /** 문구가 부르는 다른 항목을 눌러서 여는 링크 (사용자 요청 2026-08-24 "매핑할 수 있는 건 전부").
   *
   *  게임 문구는 다른 항목을 괄호로 부른다 — "<염국> 오퍼레이터 1명 우선 등장",
   *  "[사르곤] 오퍼레이터 스킬 발동", "<호출 모듈> 1개 획득", "일부 적이 <덕로드>로 변경".
   *  이름 ↔ 대상 표(doc.refs)는 build-autochess.py가 로케일별로 미리 풀어 실어 준다 —
   *  이름이 언어마다 다르고(JA는 대괄호 대신 【】), 적 이름표는 1MB짜리 적 도감에만 있어
   *  화면에서는 풀 수 없다.
   *
   *  self를 주면 **지금 열려 있는 항목 자신**을 가리키는 참조는 링크로 만들지 않는다
   *  (사르곤 맹약 상세 안의 [사르곤]을 눌러 같은 창을 또 여는 건 무의미하다). */
  const acRich = (text: string, self?: string): React.ReactNode => {
    const map = doc.refs;
    if (!map) return rich(text);
    const parts = text.split(REF_TOKEN);
    if (parts.length === 1) return rich(text);
    return parts.map((seg, i) => {
      if (!(i % 2)) return <span key={i}>{rich(seg)}</span>;
      const name = seg.slice(1, -1);
      const ref = map[name];
      if (ref && ref[1] !== self) {
        return (
          <button key={i} type="button" className={`ac-ref ac-ref-${ref[0]}`}
            onClick={() => openRef(ref)}>{name}</button>
        );
      }
      // 못 푼 조건절이 안쪽에 참조를 품고 있다 — "<전장에 서로 다른 [사르곤] 오퍼레이터 6명 배치>"
      if (!ref && /[[【]/.test(name)) {
        return <span key={i}>{seg[0]}{acRich(name, self)}{seg[seg.length - 1]}</span>;
      }
      return <span key={i}>{rich(seg)}</span>;
    });
  };
  const openRef = ([kind, id]: AcRef) => {
    if (kind === "bond") { const b = bondById.get(id); if (b) setBond(b); return; }
    if (kind === "item") { const e = doc.equips.find((x) => x.id === id); if (e) setEquip(e); return; }
    if (kind === "band") { const b = doc.bands.find((x) => x.id === id); if (b) setBand(b); return; }
    if (kind === "op") { const c = chessById.get(id); if (c) openChess(c); return; }
    if (kind === "enemy") { setEnemy(id); return; }
    // 모드는 상세 모달이 없다 — 게임 정보 → 모드 목록으로 데려간다. 목록이 뒤에 가려지지
    // 않게 열려 있는 창을 모두 닫는다.
    if (kind === "mode") {
      setBond(null); setChess(null); setEquip(null); setBand(null); setEnemy(null);
      setView("misc"); setMiscTab("mode");
    }
  };

  // linked = 문구 안의 참조를 눌러서 열 수 있게 (모달 전용 — 카드는 그 자체가 버튼이라
  // 안에 버튼을 또 넣을 수 없다. 2026-08-22 하이드레이션 오류로 확인된 규약).
  const garLine = (id: string, gold: boolean, linked = false, self?: string) => {
    const g = doc.gar[id];
    if (!g) return null;
    return (
      <div key={`${id}${gold ? "-g" : ""}`} className={`ac-gar${gold ? " gold" : ""}`}>
        <span className="ac-gar-type">
          <img src={garIcon(g.ic)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
          {g.t}
        </span>
        <span className="ac-gar-txt">{linked ? acRich(g.d, self) : rich(g.d)}</span>
      </div>
    );
  };

  /** 맹약 칩의 클릭 불가 판 — 소속 오퍼레이터 행은 그 자체가 버튼이라 안에 버튼을 또
   *  넣을 수 없다(HTML 금지). 행을 누르면 오퍼레이터 모달이 열리고, 거기 칩은 누를 수 있다. */
  const bondTag = (id: string) => {
    const b = bondById.get(id);
    if (!b) return null;
    return (
      <span key={id} className={`ac-bondchip sm${b.nation ? " nation" : ""}`}>
        <img src={bondIcon(id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
        {b.n}
      </span>
    );
  };

  /** 맹약 모달의 소속 오퍼레이터 한 줄 — 얼굴만 늘어놓으면 "이 진영에 누가 있나"는 알아도
   *  "그래서 걔가 뭘 하나"를 모른다 (사용자 지시 2026-08-22). 위수 협의 능력과, 그 오퍼가
   *  가진 맹약 둘(진영·특성)을 같이 싣는다 — 시너지를 짜려면 나머지 한쪽이 중요하다. */
  const opRow = (c: AcChess) => (
    <button key={c.id} type="button" className="ac-oprow"
      // 맹약 모달은 **닫지 않는다** — 소속 오퍼를 하나씩 눌러 보는 자리라, 볼 때마다 맹약
      // 목록이 사라지면 매번 되돌아가야 한다 (사용자 지적 2026-08-22). ModalWindow가 창을
      // 겹쳐 띄우므로 오퍼 창을 닫으면 맹약 창이 그대로 남는다.
      onClick={() => openChess(c)}>
      {c.op
        ? <img src={opFace(c.op)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
        : <span className="ac-face-diy" aria-hidden>?</span>}
      <span className="ac-oprow-main">
        <b>{c.n}</b>
        <span className="ac-oprow-meta">
          {c.r ? <i className="ac-star">★{c.r}</i> : null}
          {c.job ? <i className="sb-chip">{c.job}</i> : null}
        </span>
        {c.bonds.length > 0 && <span className="ac-oprow-bonds">{c.bonds.map(bondTag)}</span>}
      </span>
      <span className="ac-oprow-gar">
        {c.gar.length ? c.gar.map((g) => {
          const gd = doc.gar[g];
          return gd ? <span key={g}><em>{gd.t}</em>{rich(gd.d)}</span> : null;
        }) : <span className="sb-dim">{t("전용 능력 없음")}</span>}
      </span>
    </button>
  );

  // ── 특질 필터 메뉴 (사용자 요청 2026-08-23) — 발동 시점·효과 유형으로 오퍼레이터를
  // 거른다. '맹약이 중첩될 때마다'만 서브메뉴가 있다: 데스크탑은 행에 마우스를 올리면
  // 옆으로 펼쳐지고, 호버가 없는 기기는 ▸ 버튼을 탭하면 아래로 아코디언처럼 펼쳐진다.
  // 세 드롭다운(티어·맹약·특질)이 한 스타일을 쓴다 (사용자 요청 2026-08-23: T1~T6 버튼 줄과
  // 네이티브 select가 제각각이라 통일). 한 번에 하나만 열린다.
  const [openMenu, setOpenMenu] = useState<"" | "tier" | "bondN" | "bondT" | "gar" | "job">("");
  // 열린 서브메뉴의 행 키 ("" = 없음) — 특질 메뉴의 "every", 직군 메뉴의 직군 이름
  const [flyout, setFlyout] = useState("");
  // 메뉴가 펼쳐질 방향 — 버튼이 화면 왼쪽에 붙어 있으면 오른쪽으로, 오른쪽 끝이면 왼쪽으로
  // (사용자 지적 2026-08-23: 시뮬레이터의 왼쪽 드롭다운이 왼쪽으로 펼쳐져 잘렸다).
  const [menuSide, setMenuSide] = useState<"left" | "right">("left");
  /** 메뉴를 연 버튼의 **화면 좌표** — 목록을 body 로 빼서 여기에 맞춰 띄운다 (menuPop) */
  const [menuAt, setMenuAt] = useState<{ l: number; r: number; t: number; b: number } | null>(null);
  const closeMenus = () => { setOpenMenu(""); setFlyout(""); };
  const toggleMenu = (menuKey: typeof openMenu) => (e: React.MouseEvent<HTMLButtonElement>) => {
    // 270px = 제일 넓은 메뉴(특질) 폭 + 여유. 오른쪽 공간이 모자라면 왼쪽으로 편다.
    // 목록이 이제 화면 좌표(fixed)로 뜨므로 기준도 창이다 — 자르는 상자가 없어졌다.
    const r = e.currentTarget.getBoundingClientRect();
    setMenuAt({ l: r.left, r: r.right, t: r.top, b: r.bottom });
    setMenuSide(r.left + 270 <= window.innerWidth - 8 ? "left" : "right");
    setOpenMenu(openMenu === menuKey ? "" : menuKey);
    setFlyout("");
  };
  const menuCls = (extra = "") => `ac-garsel-menu${extra}${menuSide === "right" ? " align-right" : ""}`;
  // ── 드롭다운 목록 띄우기 ────────────────────────────────────────────────
  // ⚠ 목록을 **body 로 빼서 화면 좌표(fixed)에 놓는다**. 버튼 옆에 absolute 로 달아 두면
  // 모달·스크롤 상자의 overflow 가 목록을 잘라 먹는다 — 가로로 삐져나가던 걸 align-right
  // 로 땜질했지만 세로(모달 높이)로도 잘렸다 (사용자 지적 2026-08-29 "근본적으로 해결").
  // body 자식이면 어떤 조상도 자르지 못한다. 아래 자리가 좁으면 버튼 **위로 뒤집고**,
  // 남는 높이를 max-height 로 넘겨 긴 목록(맹약 23개)이 스스로 스크롤하게 한다.
  const menuPop = (el: React.ReactElement) => {
    if (typeof document === "undefined") return null;
    const at = menuAt ?? { l: 8, r: 8, t: 8, b: 8 };
    const vh = window.innerHeight, vw = window.innerWidth;
    const below = vh - at.b - 12, above = at.t - 12;
    const up = below < Math.min(280, above);          // 아래가 좁고 위가 더 넓을 때만 뒤집는다
    const style: React.CSSProperties = {
      position: "fixed", zIndex: 9200,                 // 공용 창(z 200~)보다 위, 연결 토스트(10000)보다 아래
      maxHeight: Math.max(160, up ? above : below),
      ...(up ? { top: "auto", bottom: vh - at.t + 4 } : { top: at.b + 4, bottom: "auto" }),
      ...(menuSide === "right" ? { right: Math.max(8, vw - at.r) } : { left: Math.max(8, at.l) }),
    };
    return createPortal(
      cloneElement(el as React.ReactElement<{ style?: React.CSSProperties }>, { style }), document.body);
  };
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      // ⚠ 목록은 이제 body 자식이라 .ac-garsel 안에 없다 — 목록 자신도 '안'으로 쳐야
      // 항목 클릭이 mousedown 단계에서 닫혀 선택이 씹히지 않는다.
      if (!(e.target as Element)?.closest?.(".ac-garsel, .ac-garsel-menu")) closeMenus();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenus(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    // 화면 좌표에 고정해 띄우므로, 뒤가 스크롤되면 버튼과 어긋난다 — 그때는 닫는다.
    // (모달 본문 스크롤은 window 로 안 올라오니 캡처 단계에서 듣는다)
    window.addEventListener("scroll", closeMenus, true);
    window.addEventListener("resize", closeMenus);
    return () => {
      window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", closeMenus, true); window.removeEventListener("resize", closeMenus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMenu]);
  const evbName = (id: string) => (id === "core" ? t("핵심 맹약") : bondById.get(id)?.n ?? id);
  // 특질 드롭다운 — 물자관리소 필터 바와 시뮬레이터가 **같은 것**을 쓴다 (상태만 다르다,
  // 사용자 요청 2026-08-23). menuKey로 어느 자리의 메뉴가 열렸는지 갈라 한 번에 하나만 연다.
  const garDropdown = (cur: string, setCur: (v: string) => void, menuKey: "gar") => {
    const pick = (v: string) => { setCur(v); closeMenus(); };
    const label = !cur ? t("특질 전체")
      : cur.startsWith("every:") ? `${t(GAR_CAT_LABEL.every)} · ${evbName(cur.slice(6))}`
        : t(GAR_CAT_LABEL[cur]);
    const item = (value: string, lab: string) => (
      <li key={value || "all"} role="none">
        <button type="button" role="menuitemradio" aria-checked={cur === value}
          className={cur === value ? "on" : ""} onClick={() => pick(value)}>
          <span>{lab}</span><em>{facetCount.gar.get(value || "__all") ?? 0}</em>
        </button>
      </li>
    );
    return (
      <div className="ac-garsel">
        <button type="button" className={`ac-garsel-btn${cur ? " on" : ""}`}
          aria-haspopup="menu" aria-expanded={openMenu === menuKey}
          onClick={toggleMenu(menuKey)}>
          {label} <i aria-hidden>▾</i>
        </button>
        {openMenu === menuKey && menuPop(
          <ul className={menuCls()} role="menu" aria-label={t("특질로 거르기")}>
            {item("", t("특질 전체"))}
            {GAR_CATS.map((cat) => cat === "every" ? (
              <li key={cat} role="none" className={`has-sub${flyout === "every" ? " open" : ""}`}
                /* ⚠ 터치 기기는 탭 직전에 합성 mouseenter를 쏜다 — 호버로 열자마자 ▾ 클릭이
                   도로 닫아 서브메뉴가 안 열렸다 (2026-08-23 실측). 진짜 호버 기기에서만 듣는다. */
                onMouseEnter={() => { if (matchMedia("(hover: hover)").matches) setFlyout("every"); }}
                onMouseLeave={() => { if (matchMedia("(hover: hover)").matches) setFlyout(""); }}>
                <button type="button" role="menuitemradio" aria-checked={cur === "every"}
                  className={cur.startsWith("every") ? "on" : ""} onClick={() => pick("every")}>
                  <span>{t(GAR_CAT_LABEL.every)}</span><em>{facetCount.gar.get("every") ?? 0}</em>
                </button>
                {/* 펼침 버튼 — 행 클릭(=전체 선택)과 역할이 다르다. 데스크탑은 호버로도 열리지만
                    키보드·터치스크린 노트북은 이 버튼이 유일한 경로라 **항상** 노출한다 (감사 2026-08-23) */}
                <button type="button" className="ac-garsel-more" aria-expanded={flyout === "every"}
                  aria-label={t("맹약별로 보기")}
                  onClick={(e) => { e.stopPropagation(); setFlyout(flyout === "every" ? "" : "every"); }}>▾</button>
                {flyout === "every" && (
                  <ul className="ac-garsel-sub" role="menu" aria-label={t(GAR_CAT_LABEL.every)}>
                    {item("every", t("전체"))}
                    {everyBonds.map((b) => item(`every:${b}`, evbName(b)))}
                  </ul>
                )}
              </li>
            ) : (
              <li key={cat} role="none">
                <button type="button" role="menuitemradio" aria-checked={cur === cat}
                  className={cur === cat ? "on" : ""} onClick={() => pick(cat)}>
                  <span>{t(GAR_CAT_LABEL[cat])}</span><em>{facetCount.gar.get(cat) ?? 0}</em>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };
  // 시뮬레이터의 맹약 선택 드롭다운 (진영/특성 각 1) — 같은 드롭다운 스타일 (사용자 요청 2026-08-23:
  // "맹약 일렬로 주르르륵 하지 말고 전부 다 드랍다운으로")
  const bondDropdown = (nation: boolean, cur: string, setCur: (v: string) => void, menuKey: "bondN" | "bondT") => (
    <div className="ac-garsel">
      <button type="button" className={`ac-garsel-btn${cur ? " on" : ""}`}
        aria-haspopup="menu" aria-expanded={openMenu === menuKey}
        onClick={toggleMenu(menuKey)}>
        {cur ? nameOfBond(cur) : t(nation ? "진영 맹약 전체" : "특성 맹약 전체")} <i aria-hidden>▾</i>
      </button>
      {openMenu === menuKey && menuPop(
        <ul className={menuCls(" scroll")} role="menu" aria-label={t(nation ? "진영 맹약" : "특성 맹약")}>
          <li role="none"><button type="button" role="menuitemradio" aria-checked={!cur}
            className={!cur ? "on" : ""} onClick={() => { setCur(""); closeMenus(); }}><span>{t(nation ? "진영 맹약 전체" : "특성 맹약 전체")}</span></button></li>
          {doc.bonds.filter((b) => b.nation === nation).map((b) => (
            <li key={b.id} role="none"><button type="button" role="menuitemradio" aria-checked={cur === b.id}
              className={cur === b.id ? "on" : ""} onClick={() => { setCur(b.id); closeMenus(); }}>
              <img className="ac-garsel-icon" src={bondIcon(b.id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
              <span>{b.n}</span><em>{(nation ? facetCount.nation : facetCount.trait).get(b.id) ?? 0}</em></button></li>
          ))}
        </ul>
      )}
    </div>
  );

  // 직군 드롭다운 — 직군 행에 마우스오버(터치는 ▾)하면 그 직군의 세부직군이 서브메뉴로
  // 열린다 (사용자 확정 2026-08-23: 두 드롭다운 대신 하나로). 행 클릭 = 직군만 선택.
  const jobDropdown = () => {
    const pickJob = (j: string, sub = "") => { setJobFilter(j); setSubFilter(sub); closeMenus(); };
    const label = jobFilter ? (subFilter ? `${jobFilter} · ${subFilter}` : jobFilter) : t("직군 전체");
    return (
      <div className="ac-garsel">
        <button type="button" className={`ac-garsel-btn${jobFilter ? " on" : ""}`}
          aria-haspopup="menu" aria-expanded={openMenu === "job"}
          onClick={toggleMenu("job")}>
          {label} <i aria-hidden>▾</i>
        </button>
        {openMenu === "job" && menuPop(
          <ul className={menuCls()} role="menu" aria-label={t("직군 전체")}>
            <li role="none"><button type="button" role="menuitemradio" aria-checked={!jobFilter}
              className={!jobFilter ? "on" : ""} onClick={() => pickJob("")}><span>{t("직군 전체")}</span></button></li>
            {[...jobTree.keys()].map((j) => (
              <li key={j} role="none" className={`has-sub${flyout === j ? " open" : ""}`}
                onMouseEnter={() => { if (matchMedia("(hover: hover)").matches) setFlyout(j); }}
                onMouseLeave={() => { if (matchMedia("(hover: hover)").matches) setFlyout(""); }}>
                <button type="button" role="menuitemradio" aria-checked={jobFilter === j && !subFilter}
                  className={jobFilter === j ? "on" : ""} onClick={() => pickJob(j)}>
                  <span>{j}</span><em>{jobCount.get(j) ?? 0}</em>
                </button>
                <button type="button" className="ac-garsel-more" aria-expanded={flyout === j}
                  aria-label={t("세부직군으로 보기")}
                  onClick={(e) => { e.stopPropagation(); setFlyout(flyout === j ? "" : j); }}>▾</button>
                {flyout === j && (
                  <ul className="ac-garsel-sub" role="menu" aria-label={j}>
                    <li role="none"><button type="button" role="menuitemradio" aria-checked={jobFilter === j && !subFilter}
                      className={jobFilter === j && !subFilter ? "on" : ""} onClick={() => pickJob(j)}>
                      <span>{t("전체")}</span><em>{jobCount.get(j) ?? 0}</em></button></li>
                    {[...(jobTree.get(j) ?? new Map<string, number>())].map(([sb, n]) => (
                      <li key={sb} role="none"><button type="button" role="menuitemradio"
                        aria-checked={jobFilter === j && subFilter === sb}
                        className={jobFilter === j && subFilter === sb ? "on" : ""}
                        onClick={() => pickJob(j, sb)}>
                        <span>{sb}</span><em>{n}</em></button></li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  // 검색칸 — 모든 탭이 같은 것을 쓴다 (사용자 요청 2026-08-24: "모든 탭에 전부 검색란")
  const searchBox = (
    <div className="ac-filters">
      <div className="search-wrap heading-search sim-search">
        <span>⌕</span>
        <input {...inputProps} placeholder={t("이름·능력 검색")} autoComplete="off" spellCheck={false} />
        <button type="button" className="search-clear" onClick={() => clear()} aria-label={t("검색어 지우기")}>×</button>
      </div>
    </div>
  );

  // 걸린 조건을 한 번에 푼다 (사용자 요청 2026-08-29) — 하나라도 걸렸을 때만 나온다
  const anyFilter = Boolean(term || bondN || bondT || garFilter || tier || jobFilter || subFilter);
  const clearFilters = () => {
    clear(false); setBondN(""); setBondT(""); setGarFilter("");
    setTier(0); setJobFilter(""); setSubFilter(""); closeMenus();
  };
  const filterBar = (
    <div className="ac-filters">
      <div className="search-wrap heading-search sim-search">
        <span>⌕</span>
        <input {...inputProps} placeholder={t("이름·능력 검색")} autoComplete="off" spellCheck={false} />
        <button type="button" className="search-clear" onClick={() => clear()} aria-label={t("검색어 지우기")}>×</button>
      </div>
      {/* 순서는 사용자 지시 (2026-08-23): 진영 맹약 · 특성 맹약 · 특질 · 티어 · 직군.
          맹약 2축은 옛 시뮬레이터의 선택 축이 필터로 들어온 것. */}
      {bondDropdown(true, bondN, setBondN, "bondN")}
      {bondDropdown(false, bondT, setBondT, "bondT")}
      {/* 특질·직군(세부직군 서브메뉴) 필터는 오퍼레이터 목록에만 — 아이템에는 없는 개념이다.
          ⚠ 담기 모달은 **언제나 오퍼 목록**이라 탭이 무엇이든 함께 낸다 — view 기본값이
          "bond" 라 모달에서 이 두 필터가 통째로 빠져 있었다 (2026-08-29). */}
      {(view === "op" || picking) && garDropdown(garFilter, setGarFilter, "gar")}
      <div className="ac-garsel">
        <button type="button" className={`ac-garsel-btn${tier ? " on" : ""}`}
          aria-haspopup="menu" aria-expanded={openMenu === "tier"}
          onClick={toggleMenu("tier")}>
          {tier ? `T${tier}` : t("티어 전체")} <i aria-hidden>▾</i>
        </button>
        {openMenu === "tier" && menuPop(
          <ul className={menuCls()} role="menu" aria-label={t("티어")}>
            <li role="none"><button type="button" role="menuitemradio" aria-checked={tier === 0}
              className={tier === 0 ? "on" : ""} onClick={() => { setTier(0); closeMenus(); }}><span>{t("전체")}</span></button></li>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <li key={n} role="none"><button type="button" role="menuitemradio" aria-checked={tier === n}
                className={tier === n ? "on" : ""} onClick={() => { setTier(n); closeMenus(); }}>
                <span>{tierBadge(n)}</span></button></li>
            ))}
          </ul>
        )}
      </div>
      {(view === "op" || picking) && jobDropdown()}
      {anyFilter && (
        <button type="button" className="ac-filters-clear" onClick={clearFilters}
          title={t("걸린 조건을 모두 풉니다")}>{t("조건 지우기")}</button>
      )}
    </div>
  );

  return (
    <section className="ac-guide" aria-labelledby="ac-title">
      <header className="sim-head ac-head">
        <span className="section-no">STRONGHOLD PROTOCOL</span>
        <h2 id="ac-title">{doc.name}</h2>
        {/* 도감·목록 탭과 성격이 달라(직접 짜 보는 자리) 탭 줄이 아니라 제목 줄 한가운데 세운다 */}
        <button type="button" className={`ac-simcta${sim ? " on" : ""}`} aria-haspopup="dialog"
          onClick={() => { setSim(true); closeMenus(); clear(false); }}>
          {t("덱편성 시뮬레이터")}
          {isNewFeature("ac-deck") && <span className="new-badge">{t("새기능")}</span>}
        </button>
      </header>
      <p className="sim-intro">{t("맹약(진영·특성)별 오퍼레이터와 각자의 위수 협의 전용 능력, 특훈 적과 리더 적, 보급센터 수치를 게임 데이터에서 그대로 정리했습니다.")}</p>
      {doc.krOnly && (
        <p className="sim-note">{t("이 모드는 아직 글로벌 서버에 출시되지 않아 설명문은 한국어 원문으로 표시됩니다. 일부 이름은 시즌 1의 영어 표기입니다.")}</p>
      )}

      {/* data-hashswap = 해시가 정하는 영역. 프리렌더 HTML은 언제나 맹약 탭이라, 딥링크로
          들어온 첫 페인트에서는 가려 두고 하이드레이션이 제 탭을 그린 뒤에 보인다
          (globals.css html[data-hashboot], layout.tsx pre-paint 스크립트) */}
      <div data-hashswap>
      <div className="sb-views ac-views" role="tablist" aria-label={t("위수 협의 보기")}>
        {VIEWS.map((vw) => (
          <button key={vw} type="button" role="tab" aria-selected={view === vw}
            className={view === vw ? "on" : ""}
            /* 메뉴를 접고 이동 — 키보드 Enter는 mousedown이 없어 바깥클릭 감지를 안 탄다 (감사 2026-08-23).
               검색도 비운다 — 입력칸은 뷰마다 새로 마운트돼 빈칸인데 term만 남아
               "빈 검색칸 + 걸러진 목록"이 됐다 (사용자 제보 2026-08-23) */
            onClick={() => { setView(vw); closeMenus(); clear(false); }}>
            {t(VIEW_LABEL[vw])}
          </button>
        ))}
      </div>

      {/* ══ 맹약 — 최상위 탭 (사용자 확정 2026-08-23: 맹약·전략·오퍼레이터가 제일 중요) ══ */}
      {view === "bond" && (
        <>
          {(
            <>
              <p className="sim-note">{t("전장에 같은 맹약의 오퍼레이터를 모을수록 단계별 효과가 열립니다. 카드를 누르면 전체 효과와 소속 오퍼레이터를 볼 수 있습니다.")}</p>
              {searchBox}
              <p className="ac-count">{t("{n}종", { n: bondRows.length })}</p>
              {[true, false].map((nation) => {
                const rows = bondRows.filter((b) => b.nation === nation);
                if (!rows.length) return null;
                return (
                  <section key={String(nation)} className="ac-bondsec">
                    <h3 className="sb-h3">{nation ? t("진영 맹약") : t("특성 맹약")} <em className="sb-count">{rows.length}</em></h3>
                    <div className="ac-bondcards">
                      {rows.map((b) => (
                        <button key={b.id} type="button" className="ac-bondcard" onClick={() => setBond(b)}>
                          <header>
                            <img src={bondIcon(b.id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                            <b>{b.n}</b>
                            <span className="ac-bondmeta">
                              <i>{b.down ? t("{n}명 이하", { n: b.min }) : t("{n}명부터", { n: b.min })}</i>
                              {b.cond && BOND_COND_LABEL[b.cond] && <i>{t(BOND_COND_LABEL[b.cond])}</i>}
                              {!funnyBonds.has(b.id) && <i className="ac-warn">{t("표준 제외")}</i>}
                            </span>
                          </header>
                          {b.steps[0] && <p className="ac-bonddesc">{rich(b.steps[0].t)}</p>}
                          {/* 카드에서도 숫자가 바로 보이게 — 목록을 훑을 때 비교가 된다 */}
                          {b.stk && b.stk.length > 0 && (
                            <p className="ac-stacksum">
                              {b.stk.map((sk) => (
                                <span key={sk.k}>
                                  {t(STACK_LABEL[sk.k] ?? sk.k)} {stackNum(sk.b, sk.u, t)}
                                  {sk.p != null && <em>{" + "}{stackNum(sk.p, sk.u, t)}{t("/중첩")}</em>}
                                </span>
                              ))}
                            </p>
                          )}
                          {b.chess.length > 0 && <div className="ac-facerow">
                            {b.chess.slice(0, 14).map((cid) => {
                              const c = chessById.get(cid);
                              return c ? (
                                <span key={cid} className="ac-facemini" title={`${c.n} · T${c.t}`}>
                                  {c.op
                                    ? <img src={opFace(c.op)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                                    : <em aria-hidden>?</em>}
                                  <em className={`ac-face-t ac-t${c.t}`}>{c.t}</em>
                                </span>
                              ) : null;
                            })}
                            {b.chess.length > 14 && <span className="ac-facemore">+{b.chess.length - 14}</span>}
                          </div>}
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </>
          )}
        </>
      )}

      {/* ══ 전략 ══ */}
      {view === "band" && (
        <>
          {(
            <>
              <p className="sim-note">{t("전략은 판을 시작할 때 고르는 조직입니다. 고유 효과와 시작 목표 HP가 다릅니다.")}</p>
              {searchBox}
              <p className="ac-count">{t("{n}종", { n: bandRows.length })}</p>
              <div className="ac-cards">
                {bandRows.map((b) => (
                  <button key={b.id} type="button" className="ac-card ac-bandcard" onClick={() => setBand(b)}>
                    <header>
                      <img className="ac-thumb" src={bandIcon(b.id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                      <div>
                        {/* 커뮤니티가 부르는 이름은 대표 오퍼 쪽이다 — '집중 케어'보다
                            '와파린 전략'이 먼저 통한다 (사용자 확정 2026-08-24) */}
                        <b className="ac-cname">{b.n}{b.by && <em className="ac-bandby">{b.by}</em>}</b>
                        <span className="ac-cmeta">
                          <i className="sb-chip ac-hp">HP {b.hp}</i>
                          {b.modes.map((m) => <i key={m} className="sb-chip">{t(MODE_TYPE_LABEL[m] ?? m)}</i>)}
                        </span>
                      </div>
                    </header>
                    <p className="ac-eqd">{rich(b.d.split("\n")[0])}</p>
                  </button>
                ))}
              </div>
            </>
          )}

        </>
      )}

      {/* ══ 오퍼레이터 ══ */}
      {view === "op" && (
        <div className="ac-shop">
          {(
            <>
              {/* 안내문이 먼저, 검색·필터가 그다음 — 전략 탭과 같은 순서 (사용자 지시 2026-08-23) */}
              <p className="sim-note">{t("오퍼레이터마다 위수 협의 전용 능력이 하나씩 붙고, 같은 오퍼레이터 {n}장을 모아 정예화(골든)하면 그 능력이 강해집니다.", { n: doc.chess[0]?.up ?? 3 })}</p>
              {filterBar}
              {bondGroups ? (
                <>
                  {/* 맹약을 골랐다 — 고른 맹약 요약 + 소속 그룹 (옛 시뮬레이터 화면, 2026-08-23 편입).
                      중첩에 관여하는 오퍼가 배지를 달고 그룹 맨 앞에 선다. */}
                  <div className="ac-sim-bonds">
                    {[bondN, bondT].filter(Boolean).map((id) => {
                      const b = bondById.get(id);
                      if (!b) return null;
                      return (
                        <button key={id} type="button" className="ac-sim-bondcard" onClick={() => setBond(b)}>
                          <img src={bondIcon(id)} alt="" aria-hidden onError={hideErr} />
                          <span>
                            <b>{b.n}</b>
                            <i className="sb-chip">{b.down ? t("{n}명 이하", { n: b.min }) : t("{n}명부터", { n: b.min })}</i>
                            {b.steps[0] && <em>{rich(b.steps[0].t)}</em>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {([
                    // 양쪽 소속이 조합의 축 — 한 명이 두 카운터를 동시에 채운다
                    { key: "both", label: t("두 맹약 모두 소속"), rows: bondGroups.both, need: Boolean(bondN && bondT) },
                    { key: "n", label: bondN ? t("{name} 소속", { name: nameOfBond(bondN) }) : "", rows: bondGroups.nOnly, need: Boolean(bondN) },
                    { key: "t", label: bondT ? t("{name} 소속", { name: nameOfBond(bondT) }) : "", rows: bondGroups.tOnly, need: Boolean(bondT) },
                  ] as const).map((g) => g.need && (
                    <section key={g.key} className="ac-sim-group">
                      <h3 className="sb-h3">{g.label} <em className="sb-count">{g.rows.length}</em></h3>
                      {g.rows.length ? (
                        <div className="ac-cards">
                          {g.rows.map((c) => {
                            const f = bondFeed(c);
                            return chessCard(c, [
                              ...f.stack.map((id) => t("{name} 중첩 올림", { name: nameOfBond(id) })),
                              ...f.every.map((id) => t("{name} 중첩마다 강화", { name: nameOfBond(id) })),
                            ]);
                          })}
                        </div>
                      ) : <p className="sb-dim">{t("해당 없음")}</p>}
                    </section>
                  ))}
                </>
              ) : (
                <>
                  <p className="ac-count">{t("{n}명", { n: chessRows.length })}</p>
                  {/* 티어별로 묶는다 (사용자 지시 2026-08-22) — 133명을 한 덩어리로 늘어놓으면
                      "몇 티어에 누가 있나"를 못 읽는다. 티어 필터를 걸면 그 티어만 남는다. */}
                  {[1, 2, 3, 4, 5, 6].map((tn) => {
                    const rows = chessRows.filter((c) => c.t === tn);
                    if (!rows.length) return null;
                    return (
                      <section key={tn} className="ac-tiersec">
                        <h3 className="ac-tierhead">{tierBadge(tn)}<span>{t("{n}명", { n: rows.length })}</span></h3>
                        {/* ⚠ rows.map(chessCard)로 넘기면 map의 index가 marks 인자로 들어간다 */}
                        <div className="ac-cards">{rows.map((c) => chessCard(c))}</div>
                      </section>
                    );
                  })}
                  {!chessRows.length && <p className="sb-dim">{t("조건에 맞는 오퍼레이터가 없습니다.")}</p>}
                </>
              )}

              {/* 자유 선택 칸 후보 — 편성하는 자리라 오퍼레이터 목록 맨 밑에 붙인다
                  (사용자 지시 2026-08-22). 게임의 자체 편성 판 = 명단 밖 보유 ★6 + 대체 기물
                  (사용자 스크린샷 검증 2026-08-23). 클뜯에 ★6 후보 명단은 없어 상점 명단에
                  이미 있는 오퍼레이터를 뺀 KR 출시 ★6 전원을 싣는다. */}
              <h3 className="sb-h3">{t("자유 선택 칸")} <em className="sb-count">{diyPool.length}</em></h3>
              <p className="sb-dim">{t("보급센터 레벨 5·6에서 각각 {n}칸씩 열립니다. 상점 명단에 없는 KR 출시 ★6 오퍼레이터를 보유하고 있으면 데려올 수 있습니다 — 단, 게임 안내대로 이렇게 편성한 오퍼레이터는 특질 없이 출전합니다. 누르면 어느 맹약으로 세는지가 뜨고, 거기서 백과사전 상세(특질·스킬·모듈)로 갈 수 있습니다.", { n: 2 })}</p>
              <div className="ac-diypool">
                {diyPool.map((o) => (
                  <button key={o.op} type="button" className="ac-diyop"
                    onClick={() => openChess({
                      id: `diy_${o.op}`, op: o.op, n: o.n, t: 6, sort: 0,
                      kind: "DIY", bonds: o.bonds ?? [], gar: [], garG: [], r: 6, job: o.job,
                    })}>
                    <img src={opFace(o.op)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                    <b>{o.n}</b>
                  </button>
                ))}
              </div>

              {/* 대체 기물(NPC) — 자유 선택 판의 나머지 절반. 본체 미보유 기물의 대체 출전이
                  본업이라, 특질·맹약은 그때 대체하는 기물의 것을 그대로 쓴다 (사용자 제보
                  2026-08-23 — "스톰아이 특질" = 르무엔 기물 특질). */}
              <h3 className="sb-h3">{t("대체 기물")} <em className="sb-count">{diySubs.length}</em></h3>
              <p className="sb-dim">{t("명단 기물의 본체 오퍼레이터가 없을 때 그 기물 그대로(맹약·특질·스킬) 대신 출전하는 전용 오퍼레이터입니다. 자유 선택 판에도 보유와 무관하게 항상 후보로 떠서, ★6이 없어도 칸을 채울 수 있습니다. 누르면 어떤 기물을 대체하는지 보여줍니다.")}</p>
              <div className="ac-diypool">
                {diySubs.map((s) => (
                  <button key={s.op} type="button" className="ac-diyop" onClick={() => openSub(s)}>
                    <img src={opFace(s.op)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                    <b>{s.n}</b>
                  </button>
                ))}
              </div>
            </>
          )}

        </div>
      )}

      {/* ══ 아이템 — 최상위 탭 승격 (사용자 확정 2026-08-23: "아이템까지 표시") ══ */}
      {view === "item" && (
        <div className="ac-shop">
          {(
            <>
              {/* 필터 없음 (사용자 확정 2026-08-23: "아이템에는 필터 필요 없어" — 59종 고정 목록) */}
              {/* ⚠ "진영 아이템은 중첩도 올려 준다"고 썼다가 정정 (사용자 지적 2026-08-23) —
                  클뜯 canGiveBond가 맹약 아이템 18종 전부 false다. 맹약 부여는 변형 구조체
                  (canGiveBond=true, 유일)와 같이 장착했을 때만 일어난다. */}
              <p className="sim-note">{t("아이템은 오퍼레이터에 장착해 능력치를 올립니다. 같은 아이템 {n}개를 모으면 강화판이 되고, 맹약 아이템은 변형 구조체와 같이 장착하면 착용자가 그 맹약을 추가로 얻습니다.", { n: doc.equips[0]?.up ?? 2 })}</p>
              {/* 필터는 안 붙이지만(59종 고정 목록) 검색은 붙인다 — 이름·효과로 찾는 건 별개다
                  (사용자 요청 2026-08-24: "모든 탭에 전부 검색란") */}
              {searchBox}
              <p className="ac-count">{t("{n}종", { n: equipRows.length })}</p>
              {[1, 2, 3, 4, 5, 6].map((tn) => {
                const rows = equipRows.filter((e) => e.t === tn);
                if (!rows.length) return null;
                return (
                  <section key={tn} className="ac-tiersec">
                    <h3 className="ac-tierhead">{tierBadge(tn)}<span>{t("{n}종", { n: rows.length })}</span></h3>
                    <div className="ac-cards">
                      {rows.map((e) => (
                        <button key={e.id} type="button" className="ac-card ac-equipcard" onClick={() => setEquip(e)}>
                          <header>
                            <img className="ac-thumb ac-equipthumb" src={equipIcon(e.trap)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                            <div>
                              <b className="ac-cname">{e.n}</b>
                              <span className="ac-cmeta">
                                <i className="sb-chip">{t("{n} 자금", { n: e.buy })}</i>
                                {e.bond ? bondTag(e.bond) : null}
                              </span>
                            </div>
                          </header>
                          <p className="ac-eqd">{rich(e.d)}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ══ 게임 정보 — 핵심 셋(맹약·전략·오퍼레이터) 밖의 나머지 전부 (2026-08-23 재편):
          적 · 모드 · 보급센터 · 전략 전술 (아이템은 2026-08-23 최상위로 승격) ══ */}
      {view === "misc" && (
        <div className="ac-misc">
          <div className="ac-subtabs" role="tablist" aria-label={t("게임 정보")}>
            {MISC_TABS.map((tb) => (
              <button key={tb} type="button" role="tab" aria-selected={miscTab === tb}
                className={miscTab === tb ? "on" : ""} onClick={() => { setMiscTab(tb); closeMenus(); }}>
                {t(MISC_LABEL[tb])}
              </button>
            ))}
          </div>

          {miscTab === "enemy" && (
            <>
              <p className="sim-note">{t("판마다 특훈 적 유형이 뽑히고, 그 유형의 적이 딸린 부대와 함께 나옵니다. 14라운드(표준 시뮬레이션은 9라운드)에는 리더 적이 기다립니다. 카드를 누르면 스탯과 능력, 함께 나오는 적을 볼 수 있습니다.")}</p>
              {/* 목록이 긴 두 탭(적 119종·전략 전술 43종)에만 검색칸을 둔다 — 모드·보급센터는
                  한 화면에 들어오는 짧은 표라 검색이 할 일이 없다 (2026-08-24) */}
              {searchBox}

              {/* 리더 적 — 유형 추첨과 별개라 맨 위에 따로 (사용자 지시 2026-08-22) */}
              <section className="ac-enemygrp">
                <h3 className="sb-h3">{t("리더 적")} <em className="sb-count">{doc.bosses.length}</em></h3>
                {[false, true].map((hide) => {
                  const rows = doc.bosses.filter((b) => b.hide === hide
                    && (!q || normSearch(`${b.n} ${b.code ?? ""}`).includes(q)));
                  if (!rows.length) return null;
                  return (
                    <div key={String(hide)} className="ac-bossgrp">
                      <h4 className="ac-bosshead">
                        {hide ? t("히든 리더") : t("일반 리더")} <span>{rows.length}</span>
                        <em>{hide
                          ? t("15라운드 — 극한·초월에서만 나옵니다")
                          : t("14라운드 — 표준 시뮬레이션은 9라운드")}</em>
                      </h4>
                      <div className="ac-encards">
                        {rows.map((b) => (
                          <button key={b.id} type="button" className="ac-encard ac-bosscard"
                            onClick={() => setEnemy(b.enemy)}>
                            <EnFace id={b.enemy} />
                            <span className="ac-encard-body">
                              <i className="ac-encode">{b.code ?? "—"}</i>
                              <b>{b.n}</b>
                              <span className="ac-encard-meta">
                                <em className="en-rank r-boss">{t("리더")}</em>
                                <em>{t("HP {n}", { n: fmtHp(b.hp.normal ?? b.hp.funny) })}</em>
                                {b.w !== ENEMY_W_BASE && <em className="ac-enw">{t("가중치 {n}", { n: b.w })}</em>}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>

              {/* 특훈 적 — 유형별. 유형 이름·설명은 게임 표기 그대로다 */}
              <div className="ac-etypebar" role="group" aria-label={t("특훈 적 유형")}>
                <button type="button" className={etype === "" ? "on" : ""} onClick={() => setEtype("")}>
                  {t("전체")}
                </button>
                {etypes.map(([k, v]) => (
                  <button key={k} type="button" className={etype === k ? "on" : ""}
                    onClick={() => setEtype(etype === k ? "" : k)} title={v.d}>
                    <img src={etypeIcon(k)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                    {v.n.replace(/^.*?[-·・]\s*/, "")}
                  </button>
                ))}
              </div>
              <p className="ac-count">{t("{n}종", { n: etypes.reduce((a, [k]) =>
                a + (!etype || k === etype ? (doc.enemyList?.[k]?.length ?? 0) : 0), 0) })}</p>
              {etypes.map(([ty, info]) => {
                if (etype && ty !== etype) return null;
                // 유형의 **전 명단**을 게임 순서대로 (대표 → 함께 나오는 일반·정예).
                // 종전엔 대표(특수 적)만 깔아 '특이'가 17종으로 보였다 — 실제 35종
                // (사용자 지적 2026-08-24). enemyList가 없던 옛 데이터는 종전대로 폴백.
                const rows = (doc.enemyList?.[ty]
                  ?? doc.enemies.filter((e) => e.type === ty).map((e) => ({ ...e, role: "sp" as const })))
                  .filter((e) => !q || normSearch(`${e.n} ${e.code ?? ""}`).includes(q));
                if (!rows.length) return null;
                return (
                  <section key={ty} className="ac-enemygrp">
                    <h3 className="sb-h3">
                      <img className="ac-etypeico" src={etypeIcon(ty)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                      {info.n} <em className="sb-count">{rows.length}</em>
                      <span className="ac-endim">{info.rnd
                        ? t("판마다 {n}종 추첨", { n: info.count })
                        : t("유형 추첨에서 빠지는 기본 편성")}</span>
                    </h3>
                    {info.d && <p className="sb-dim ac-note">{info.d}</p>}
                    {/* 대표(sp)든 딸린 적이든 카드 배경은 **같다** — 딸린 적만 --paper를 쓰던
                        시절엔 라이트모드에서 페이지 바탕색과 겹쳐 그 카드만 투명해 보였다
                        (사용자 지적 2026-08-24). 구분은 '함께 나옴' 표시가 한다. */}
                    <div className="ac-encards">
                      {rows.map((e) => (
                        <button key={e.id} type="button" className="ac-encard"
                          onClick={() => setEnemy(e.id)}>
                          <EnFace id={e.id} />
                          <span className="ac-encard-body">
                            <i className="ac-encode">{e.code ?? "—"}</i>
                            <b>{e.n}</b>
                            <span className="ac-encard-meta">
                              {e.rank && <em className={`en-rank r-${e.rank.toLowerCase()}`}>{t(RANK_KEY[e.rank] ?? e.rank)}</em>}
                              {/* 대표(부대를 끌고 오는 적)만 등장 구간·가중치를 갖는다.
                                  나머지는 그 대표를 따라 나오는 적이라 '함께 나옴'으로 묶는다. */}
                              {e.role === "sp" ? (
                                <>
                                  <em>{e.half ? t("전반") : t("후반")}</em>
                                  {/* 가중치는 대부분 기본값이라, 더 자주·덜 나오는 적만 짚는다 */}
                                  {e.w != null && e.w !== ENEMY_W_BASE && <em className="ac-enw">{t("가중치 {n}", { n: e.w })}</em>}
                                </>
                              ) : <em className="ac-ensub">{t("함께 나옴")}</em>}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
              <p className="sb-dim">{t("전반·후반은 그 적이 나올 수 있는 라운드 구간입니다. 추첨 가중치는 기본 {n}이고, 다른 값만 카드에 표시합니다.", { n: ENEMY_W_BASE })}</p>
            </>
          )}


          {miscTab === "mode" && (
            <>
              <p className="sim-note">{t("난이도가 올라갈수록 적이 강해지고 보상 배율이 커집니다. 협동은 같은 난이도의 단독과 규칙이 같습니다.")}</p>
              <div className="ac-cards">
                {doc.modes.filter((m) => m.type !== "MULTI").map((m) => (
                  <div key={m.id} className="ac-card ac-modecard">
                    <header>
                      <img className="ac-thumb ac-modethumb" src={modeIcon(m.icon)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                      <div>
                        <b className="ac-cname">{m.n}</b>
                        <span className="ac-cmeta">
                          <i className="sb-chip">{m.code}</i>
                          <i className="sb-chip">{t("맹약 {n}종", { n: m.bonds.length })}</i>
                          {doc.difficulty[m.diff] ? <i className="sb-chip">{t("보상 ×{n}", { n: doc.difficulty[m.diff] })}</i> : null}
                        </span>
                      </div>
                    </header>
                    <p className="ac-eqd">{m.d}</p>
                    {m.eff.length > 0 && <ul className="ac-efflist">{m.eff.map((x, i) => <li key={i}>{x.replace(/^·\s*/, "")}</li>)}</ul>}
                  </div>
                ))}
              </div>
            </>
          )}

          {miscTab === "supply" && (
            <>
              <p className="sim-note">{t("보급센터는 판이 시작된 뒤 라운드마다 오퍼레이터와 아이템을 파는 인게임 상점입니다. 레벨을 올리면 더 높은 티어가 나오고 진열 칸도 늘어납니다.")}</p>

              <div className="ac-rules">
                {[
                  [t("갱신 비용"), t("{n} 자금", { n: doc.const.refresh })],
                  [t("정예화(골든)"), t("같은 오퍼레이터 {n}장", { n: doc.chess[0]?.up ?? 3 })],
                  [t("전장 배치"), t("최대 {n}명", { n: doc.const.board })],
                  [t("보유 한도"), t("최대 {n}명", { n: doc.const.deck })],
                  [t("예비 칸"), t("최대 {n}칸", { n: doc.const.store })],
                  [t("지원 요청"), t("최대 {n}명", { n: doc.const.borrow })],
                ].map(([k, v]) => (
                  <div key={k} className="ac-rule"><b>{v}</b><span>{k}</span></div>
                ))}
              </div>

              <h3 className="sb-h3">{t("티어별 가격과 능력치")}</h3>
              <p className="sb-dim">{t("같은 티어면 오퍼레이터가 누구든 값과 성장 수치가 같습니다. 판매가는 티어와 무관하게 {n} 자금입니다.", { n: doc.shop.tiers[0]?.b.sell ?? 1 })}</p>
              <div className="ac-tablewrap">
                <table className="ac-table">
                  <thead>
                    <tr>
                      <th>{t("티어")}</th><th>{t("상태")}</th><th>{t("구매")}</th><th>{t("판매")}</th>
                      <th>{t("정예화")}</th><th>{t("레벨")}</th><th>{t("스킬")}</th><th>{t("모듈")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.shop.tiers.map((row) => (
                      [["b", row.b] as const, ["g", row.g] as const].filter(([, st]) => st).map(([k, st], i) => (
                        <tr key={`${row.t}${k}`} className={k === "g" ? "ac-gold-row" : ""}>
                          {i === 0 && <th rowSpan={2} scope="row">{tierBadge(row.t)}</th>}
                          <td className={k === "g" ? "ac-goldmark" : ""}>{i === 0 ? t("일반") : t("골든")}</td>
                          {/* 골든은 값을 주고 사는 게 아니라 같은 오퍼레이터를 모아 합치는 것이다 */}
                          <td>{i === 0 ? st.buy : t("{n}장 합성", { n: doc.chess[0]?.up ?? 3 })}</td>
                          <td>{st.sell}</td>
                          <td>{t(PHASE_LABEL[st.ph] ?? st.ph)}</td>
                          <td>Lv{st.lv}</td>
                          <td>{st.sk}</td>
                          <td>{st.md ? t("{n}단계", { n: st.md }) : "—"}</td>
                        </tr>
                      ))
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="sb-h3">{t("보급센터 레벨")}</h3>
              <div className="ac-modebar" role="group" aria-label={t("모드")}>
                {doc.modes.filter((m) => m.type !== "MULTI").map((m) => (
                  <button key={m.id} type="button" className={shopMode === m.id ? "on" : ""} onClick={() => setShopMode(m.id)}>
                    <img src={modeIcon(m.icon)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                    {m.n}
                  </button>
                ))}
              </div>
              <div className="ac-tablewrap">
                <table className="ac-table">
                  <thead>
                    <tr><th>{t("레벨")}</th><th>{t("승급 비용")}</th><th>{t("오퍼레이터 칸")}</th><th>{t("아이템 칸")}</th><th>{t("등장 티어")}</th></tr>
                  </thead>
                  <tbody>
                    {(doc.shop.levels[shopMode] ?? []).map((lv) => (
                      <tr key={lv.lv}>
                        <th scope="row">Lv{lv.lv}</th>
                        <td>{lv.up >= 99 ? <span className="sb-dim">{t("최대")}</span> : t("{n} 자금", { n: lv.up })}</td>
                        <td>{lv.slot}</td>
                        <td>{lv.item}</td>
                        <td>{tierBadge(lv.lv)}{doc.shop.diy[String(lv.lv)] ? <em className="ac-diy">{t("자유 선택 {n}칸", { n: doc.shop.diy[String(lv.lv)].length })}</em> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="sb-dim">{t("승급 비용은 그 레벨에서 다음 레벨로 올릴 때 처음 드는 자금입니다. 자유 선택 칸에 넣을 수 있는 오퍼레이터는 '물자관리소 → 오퍼레이터' 맨 아래에 있습니다.")}</p>
            </>
          )}

          {/* ══ 전투 맵 — 라운드마다 전장이 정해져 있다 (제보 c3d2c056, 2026-08-30
                "add the maps … positioning aegir alliance on different maps").
                맵 그림이 아니라 **게임 데이터의 타일·경로**를 작전 도감과 같은 렌더러로
                그린다 — 이미지 자산이 안 든다. 격자는 원본 21x19 중 실제 전장만 잘라 썼다. ══ */}
          {miscTab === "map" && (
            <>
              <p className="sim-note">{t("위수 협의의 전장은 하나뿐입니다 — 지형은 라운드가 바뀌어도 그대로고, 달라지는 건 적의 종류와 그들이 오는 길입니다. 전장은 두 구획으로 나뉘어 일반 라운드와 리더 라운드가 각각 한쪽씩 씁니다. 카드를 누르면 타일 지도와 적 이동 경로가 열립니다.")}</p>
              {!routesReady || !AC_ROUTES
                ? <p className="chlog-empty">{t("전투 맵을 불러오는 중…")}</p>
                : (() => {
                  const R = AC_ROUTES;
                  /** 같은 전장을 쓰는 라운드는 한 장으로 묶는다 — 입문 2·3R이 그렇다.
                   *  안 묶으면 2R을 눌렀는데 3R도 같이 켜져 고장으로 보인다
                   *  (사용자 지적 2026-08-30). */
                  const chips = (xs: { r: number; m: string }[]) => {
                    const by = new Map<string, number[]>();
                    for (const x of xs) by.set(x.m, [...(by.get(x.m) ?? []), x.r]);
                    return [...by].map(([m, rs]) => ({ m, label: t("{n}R", { n: rs.join("·") }) }));
                  };
                  const card = (m: string, label: string, face?: string) => {
                    const d = R.maps[m];
                    if (!d) return null;
                    return (
                      <button key={m} type="button" className="ac-card ac-mapcard"
                        onClick={() => { setMapPin(new Set()); setAcMap(m); }}>
                        {face ? <EnFace id={face} className="ac-mapcardface" /> : null}
                        <span className="ac-mapcard-body">
                          <b>{label}</b>
                          <em>{t("적 {a}종 · 오는 길 {b}갈래",
                            { a: Object.keys(d.e).length, b: d.r.filter(Boolean).length })}</em>
                        </span>
                      </button>
                    );
                  };
                  const bossAt = (n: number) => doc.bosses.filter((b) => b.round.includes(n));
                  const leaderMap = (id: string) => { const v = R.leaders[id]; return v ? (mapCoop ? v.c : v.s) : ""; };
                  return (
                    <>
                      <h3 className="sb-h3">{t("일반 라운드")} <em className="sb-count">{R.rounds.length}</em>
                        <span className="sb-dim ac-note">{t("모든 난이도 공통 — 라운드가 오를수록 적이 늘고 오는 길이 많아집니다")}</span></h3>
                      <div className="ac-cards ac-mapcards">{chips(R.rounds).map((x) => card(x.m, x.label))}</div>

                      <h3 className="sb-h3">{t("리더 라운드")}
                        <span className="sb-dim ac-note">{t("14R · 15R — 표준 시뮬레이션은 9R")}</span>
                        <span className="ac-mapmode">
                          {[[false, "단독"], [true, "협동"]].map(([co, lb]) => (
                            <button key={String(co)} type="button" className={mapCoop === co ? "on" : ""}
                              onClick={() => setMapCoop(co as boolean)}>{t(lb as string)}</button>
                          ))}
                        </span>
                      </h3>
                      {[14, 15].map((rn) => {
                        const rows = bossAt(rn).filter((b) => leaderMap(b.id));
                        if (!rows.length) return null;
                        return (
                          <div key={rn} className="ac-mapbosses">
                            <h4 className="ac-bosshead">{t("{n}R", { n: rn })} <span>{rows.length}</span></h4>
                            <div className="ac-cards ac-mapcards">
                              {rows.map((b) => card(leaderMap(b.id), b.n, b.enemy))}
                            </div>
                          </div>
                        );
                      })}

                      <h3 className="sb-h3">{t("입문 협의")}
                        <span className="sb-dim ac-note">{t("2·3라운드는 같은 전장입니다")}</span></h3>
                      <div className="ac-cards ac-mapcards">{chips(R.train).map((x) => card(x.m, x.label))}</div>
                    </>
                  );
                })()}
            </>
          )}

          {miscTab === "hunt" && (
            <>
              {/* 사용자 지적 2026-08-29: "제셀톤이나 투척수 같은, 자기가 직접 골라야 나오는
                  적들". 전략 선택지 중 적을 불러오는 쪽(ENEMY_GAIN)이 통째로 빠져 있었다. */}
              <p className="sim-note">{t("골라서 다음 전투에 불러오는 적입니다. 처치하거나 그 전투를 이기면 자금을 줍니다 — 자금이 클수록 그만큼 버거운 적입니다.")}</p>
              {searchBox}
              <p className="ac-count">{t("{n}종", { n: huntRows.length })}</p>
              <div className="ac-cards">
                {huntRows.map((h) => (
                  <button key={h.id} type="button" className="ac-card ac-huntcard"
                    onClick={() => setEnemy(h.e)} title={t("적 상세 보기")}>
                    <header>
                      <EnFace id={h.e} />
                      <div>
                        <b className="ac-cname">{h.n}</b>
                        <span className="ac-cmeta">
                          <i className="sb-chip">{doc.enemyNames[h.e] ?? h.e}</i>
                          {h.c > 1 ? <i className="sb-chip">{t("{n}마리", { n: h.c })}</i> : null}
                          <i className="sb-chip ac-coin">
                            {t(h.w === "win" ? "승리 시 자금 {n}" : "처치 시 자금 {n}", { n: h.coin })}
                          </i>
                        </span>
                      </div>
                    </header>
                    <p className="ac-eqd">{rich(h.d)}</p>
                  </button>
                ))}
              </div>
            </>
          )}

          {miscTab === "buff" && (
            <>
              <p className="sim-note">{t("라운드 사이의 '전략 전술'에서 고르는 효과입니다. 판 시작 때 고르는 '전략'과는 다릅니다.")}</p>
              {searchBox}
              <p className="ac-count">{t("{n}종", { n: buffRows.length })}</p>
              <div className="ac-buffs">
                {buffRows.map((b) => (
                  <div key={b.id} className="ac-buff"><b>{b.n}</b><span>{acRich(b.d)}</span></div>
                ))}
              </div>
            </>
          )}

        </div>
      )}
      </div>{/* /data-hashswap — 모달은 body 포털이라 이 가리개와 무관하다 */}


      {/* 맹약 배지를 누르면 뜨는 **작은 창** — 이 판에서 그 맹약이 어떤 상태인지만 본다
          (맹약 자체의 전체 설명은 아래 '맹약 상세'로 넘긴다). 사용자 지시 2026-08-29. */}
      {/* ══ 전투 맵 모달 — 작전 도감·통합전략과 같은 규약(카드 → 창)이다
            (사용자 지적 2026-08-30 "맵 시뮬레이터는 다른 기능들에 많잖아, 동일하게
            모달 띄우거나 해서 보여줘야"). 지도·경로 재생은 공용 StageRouteMap 이 맡는다. ══ */}
      {acMap && AC_ROUTES?.maps[acMap] && (() => {
        const R = AC_ROUTES!;
        const d = R.maps[acMap];
        const li = locale === "en" ? 1 : locale === "ja" ? 2 : 0;
        const nameOfEnemy = (id: string) =>
          enemyDex?.get(id)?.name ?? doc.enemyNames[id] ?? R.nm[id]?.[li] ?? id;
        const order = Object.keys(d.e);
        const rs = R.rounds.filter((x) => x.m === acMap).map((x) => x.r);
        const tr = R.train.filter((x) => x.m === acMap).map((x) => x.r);
        const boss = doc.bosses.find((b) => {
          const v = R.leaders[b.id];
          return v && (v.s === acMap || v.c === acMap);
        });
        const title = boss ? boss.n
          : rs.length ? t("{n}R", { n: rs.join("·") })
            : t("입문 {n}R", { n: tr.join("·") });
        return (
          <ModalWindow key={acMap} label={title} className="operator-modal ac-modal ac-mapmodal"
            onClose={() => setAcMap("")}>
            <div className="ac-mapbody">
              <p className="ac-mapcap">
                <b>{d.band === 0 ? t("일반 라운드 전장") : t("리더 라운드 전장")}</b>
                {boss && <i className="sb-chip">{mapCoop ? t("협동") : t("단독")}</i>}
                <em>{t("적 {a}종 · 오는 길 {b}갈래", { a: order.length, b: d.r.filter(Boolean).length })}</em>
              </p>
              <StageRouteMap data={d} order={order}
                highlights={mapPin.size ? [...mapPin] : null}
                imgOf={(k) => enemyImg(k)}
                nameOf={nameOfEnemy}
                onPick={(id) => setMapPin((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(id)) next.add(id);
                  return next;
                })} />
              <p className="ac-mapenemies">
                {order.map((k) => (
                  <button key={k} type="button"
                    className={`ac-bondchip sm${mapPin.has(k) ? " nation" : ""}`}
                    style={{ borderLeft: `3px solid ${enemyRouteColor(order, k)}` }}
                    onClick={() => setEnemy(k)}>
                    <EnFace id={k} className="ac-mapenface" />{nameOfEnemy(k)}
                  </button>
                ))}
              </p>
            </div>
          </ModalWindow>
        );
      })()}

      {peek && (() => {
        const row = boardBonds.find((x) => x.b.id === peek);
        if (!row) return null;
        const { st, b } = row;
        return (
          <ModalWindow label={b.n} className="operator-modal ac-modal ac-peek" onClose={() => setPeek("")}>
            <div className="ac-peekbody">
              <p className="ac-peekhead">
                <img src={bondIcon(b.id)} alt="" aria-hidden onError={hideErr} />
                <i className="sb-chip">{t("{a}/{b}명", { a: st.counted, b: b.min })}</i>
                {b.down ? <i className="sb-chip">{t("적을수록 강함")}</i> : null}
                {st.deck > 0 && b.cond === "BOARD_AND_DECK"
                  ? <i className="sb-chip">{st.deckOn ? t("정비구역 {n} 포함", { n: st.deck })
                    : t("정비구역 {n} — 아직 안 셈", { n: st.deck })}</i> : null}
                <i className={`sb-chip ${st.active ? "ac-on" : "ac-off"}`}>{st.active ? t("발동") : t("미발동")}</i>
              </p>
              {/* 중첩은 이 맹약 것만 여기서 지정한다 — 전투 중에 쌓이는 값이라 편성만으로는
                  못 구하고, 맹약마다 값이 다르다 (사용자 지적 2026-08-29).
                  ⚠ 중첩 개념이 없는 맹약(조화·협동방어·독행·궁극기)에는 아예 안 낸다
                  (사용자 지적 2026-08-30 "독행이랑 궁극기는 중첩 없지 않음?") */}
              {b.stku && (
              <label className="ac-stackin">
                {t("중첩 수")}
                <input type="number" min={0} inputMode="numeric" placeholder="—"
                  value={stacks[b.id] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setStacks((prev) => {
                      const next = { ...prev };
                      if (v === "") delete next[b.id];
                      else next[b.id] = Math.max(0, Math.floor(Number(v) || 0));
                      return next;
                    });
                  }} />
                <span className="sb-dim">{t("중첩은 전투 중에 특질이 쌓는 값이라 편성만으로 정해지지 않습니다. 값을 넣으면 그 기준으로 수치와 단계를 보여 줍니다.")}</span>
              </label>
              )}
              <ol className="ac-bstat-steps">
                {st.steps.map((sp) => (
                  <li key={sp.i} className={sp.on === true ? "on" : sp.on === null ? "unknown" : "off"}>
                    <span className="ac-bstat-mark" aria-hidden>{sp.on === true ? "●" : sp.on === null ? "?" : "○"}</span>
                    {sp.gate?.k === "stack"
                      ? <em>{t("중첩 {n}", { n: sp.gate.n })}{sp.need != null && sp.need > 0 ? t(" — {n} 남음", { n: sp.need }) : ""}</em>
                      : sp.gate ? <em>{sp.gate.k === "gold" ? t("정예화 {n}명", { n: sp.gate.n }) : t("{n}명", { n: sp.gate.n })}</em>
                        : null}
                    <span>{acRich(b.steps[sp.i].t, b.id)}</span>
                    {stackList(b, sp.i)}
                  </li>
                ))}
              </ol>
              <button type="button" className="ac-clear" onClick={() => { setPeek(""); setBond(b); }}>
                {t("맹약 상세 보기")}
              </button>
            </div>
          </ModalWindow>
        );
      })()}

      {/* 덱편성 시뮬레이터 — **모달** (사용자 지시 2026-08-29 "모달로 띄우자").
          탭이 아니라 제목 줄 버튼으로 열고, 기물 고르기 모달이 이 위에 겹쳐 뜬다
          (ModalWindow 가 창을 쌓는다 — 맹약↔기물 모달과 같은 규약). */}
      {sim && (
        <ModalWindow label={t("덱편성 시뮬레이터")} className="operator-modal ac-modal ac-simmodal"
          onClose={() => setSim(false)}>
          <div className="ac-guide ac-simbody">

          {/* 맹약 — 켜진 것 먼저. 빈 안내문·'상태' 군더더기는 걷어내되 제목과 발동 수는
              남긴다 (사용자 지시 2026-08-30 "맹약 0 은 다시 만들어줘"). */}
          <section className="ac-boardout">
            <h3 className="sb-h3">{t("맹약")} <em className="sb-count">{boardBonds.filter((x) => x.st.active).length}</em></h3>
            {/* 인게임처럼 **동그란 배지 줄**로 (사용자 지시 2026-08-29 + 스크린샷).
                미발동은 흐리게, 누르면 작은 창으로 상세를 편다.
                ⚠ 가운데 숫자는 게임처럼 '중첩'이 아니라 **인원**이다 — 중첩은 전투 중에
                   쌓여서 편성만으로 못 구한다 (autochess-board.ts 머리주석). */}
            <div className="ac-bring-row">
              {boardBonds.map(({ st, b }) => (
                <button key={b.id} type="button" className={`ac-bring${st.active ? " on" : ""}`}
                  onClick={() => setPeek(b.id)}
                  title={`${b.n} — ${t("{a}/{b}명", { a: st.counted, b: b.min })}`}>
                  <span className="ac-bring-dial"
                    style={{ ["--p" as string]: `${Math.min(1, st.counted / Math.max(1, b.min ?? 1)) * 100}%` }}>
                    <img src={bondIcon(b.id)} alt="" aria-hidden loading="lazy" onError={hideErr} />
                    <em>{stacks[b.id] ?? 0}</em>
                  </span>
                  <b>{b.n}</b>
                </button>
              ))}
            </div>
          </section>

          <section className="ac-board">
            {gainRows.length > 0 && (
              <>
                <h3 className="sb-h3">{t("특질 수급")}
                  <span className="sb-dim ac-note">{t("기물 특질이 주는 중첩·자금·아이템 — 아이템·전략 자체의 효과는 계산에 없습니다")}</span></h3>
                <div className="ac-gains">
                  {gainRows.map((g) => (
                    <div key={g.w} className="ac-gainrow">
                      <div className="ac-gainw">
                        <b>{t(GAIN_W_LABEL[g.w] ?? g.w)}</b>
                        {GAIN_W_NOTE[g.w] && <i>{t(GAIN_W_NOTE[g.w])}</i>}
                      </div>
                      <div className="ac-gainbody">
                        {(g.sum.length > 0 || g.top > 0 || g.topWait > 0 || g.wait.length > 0
                          || g.gold > 0 || g.ref > 0 || g.items.length > 0) && (
                          <p className="ac-gainchips">
                            {g.sum.map(([id, n]) => (
                              <span key={id} className="ac-gainchip">{bondChip(id, true)}<em>+{n}</em></span>
                            ))}
                            {g.gold > 0 && (
                              <span className="ac-gainchip">
                                <span className="ac-gainres"><img src={garIcon("gold")} alt="" aria-hidden loading="lazy" onError={hideErr} />{t("자금")}</span><em>+{g.gold}</em>
                              </span>
                            )}
                            {g.ref > 0 && (
                              <span className="ac-gainchip"><span className="ac-gaintop">{t("무료 갱신")}</span><em>+{g.ref}</em></span>
                            )}
                            {g.items.map(([id, n]) => {
                              const e = doc.equips.find((x) => x.id === id);
                              if (!e) return null;
                              return (
                                <span key={id} className="ac-gainchip">
                                  <button type="button" className="ac-bondchip sm" onClick={() => setEquip(e)}>
                                    <img src={equipIcon(e.trap)} alt="" aria-hidden loading="lazy" onError={hideErr} />
                                    {e.n}
                                  </button>
                                  <em>×{n}</em>
                                </span>
                              );
                            })}
                            {g.top > 0 && (
                              <span className="ac-gainchip">
                                <span className="ac-gaintop">{t("가장 많이 중첩된 맹약")}</span><em>+{g.top}</em>
                              </span>
                            )}
                            {/* '이미 활성화된' 맹약이 아직 없다 — 숨기면 안 세는 걸로 오해받는다
                                (포덴코·퍼퓨머 정비구역, 사용자 지적 2026-08-30) */}
                            {g.topWait > 0 && (
                              <span className="ac-gainchip off">
                                <span className="ac-gaintop">{t("가장 많이 중첩된 맹약")}</span><em>+{g.topWait}</em><u>{t("미발동")}</u>
                              </span>
                            )}
                            {/* 대상 맹약이 아직 미발동 — 발동해야 세는 특질이라 합계 밖 */}
                            {g.wait.map(([id, n]) => (
                              <span key={`w${id}`} className="ac-gainchip off">
                                {bondChip(id, true)}<em>+{n}</em><u>{t("미발동")}</u>
                              </span>
                            ))}
                          </p>
                        )}
                        {g.conds.map((cd, i) => (
                          <p key={i} className="ac-gaincond">
                            <b>{cd.c.n}</b> — {acRich(doc.gar[cd.gid]?.d ?? "")}
                            {cd.selfIn && <i> · {t("자신 몫은 위 합계에 포함, 이웃 몫은 대상에 따라 다릅니다")}</i>}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <h3 className="sb-h3">{t("배치")} <em className="sb-count">{nBoard}/{boardCap}</em></h3>
            <div className="ac-slots">
              {Array.from({ length: MAX_BOARD_ITEM }, (_, i) => {
                // 9번째 칸은 아이템 '인사부 파일'을 장착해야 열린다 — 기본은 잠금이고,
                // 먹었다면 눌러서 해금한다 (사용자 지시 2026-08-29)
                if (i === MAX_BOARD && !slot9) {
                  const it = doc.equips.find((e) => e.id === BOARD9_ITEM);
                  return (
                    <button key={i} type="button" className="ac-slot locked"
                      title={t("아이템 '인사부 파일'을 장착하면 최대 배치 인원이 9로 늘어납니다. 보유 중이라면 눌러서 해금하세요.")}
                      onClick={() => setSlot9(true)}>
                      {/* 어떤 아이템인지 바로 알아보게 섬네일을 싣는다 (사용자 지시 2026-08-29) */}
                      {it ? <img src={equipIcon(it.trap)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                        : <span aria-hidden>🔒</span>}
                      <b>{it?.n ?? t("인사부 파일")}</b>
                      <i>{t("있으면 해금")}</i>
                    </button>
                  );
                }
                const sl = slots[i];
                const c = sl && chessById.get(sl.id);
                if (!c) return (
                  <button key={i} type="button" title={t("기물 담기")}
                    className={`ac-slot empty${dropAt === `b${i}` ? " over" : ""}`}
                    {...dropProps("b", i)}
                    onClick={() => setPicking({ z: "b", i })}>+</button>
                );
                return (
                  <div key={i} draggable
                    className={`ac-slot${isGold(sl.id) ? " gold" : ""}${dropAt === `b${i}` ? " over" : ""}`}
                    onDragStart={() => { dragFrom.current = { z: "b", i }; }}
                    onDragEnd={() => { dragFrom.current = null; setDropAt(""); }}
                    {...dropProps("b", i)}>
                    <button type="button" className="ac-slot-face" onClick={() => openChess(c)} title={t("기물 상세")}>
                      {c.op ? <img src={opFace(c.op)} alt="" aria-hidden loading="lazy" onError={hideErr} />
                        : <span className="ac-face-diy" aria-hidden>?</span>}
                      <b>{c.n}</b>
                    </button>
                    <span className="ac-slot-act"
                      draggable={false}
                      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      {/* ⚠ ★ 로 뒀더니 누가 봐도 즐겨찾기·고정 버튼으로 읽혔다
                          (사용자 지적 2026-08-29) — 게임 용어 그대로 글자로 적는다. */}
                      <button type="button" className={`ac-goldbtn${isGold(sl.id) ? " on" : ""}`}
                        onClick={() => toggleGoldOf(sl.id)}
                        title={t("정예화(골든) 전환 — 판을 비워도 남습니다")}>{t("골든")}</button>
                      <button type="button" onClick={() => dropFrom("b", i)} title={t("빼기")}>×</button>
                    </span>
                  </div>
                );
              })}
            </div>

            <h3 className="sb-h3">{t("정비구역")} <em className="sb-count">{nBench}/{MAX_DECK}</em>
              <span className="sb-dim ac-note">{t("배치+정비구역을 함께 세는 맹약이 셋 있습니다 — 예견·기적·투자자")}</span></h3>
            <div className="ac-slots deck">
              {Array.from({ length: MAX_DECK }, (_, i) => {
                const sl = bench[i];
                const c = sl && chessById.get(sl.id);
                if (!c) return (
                  <button key={i} type="button" title={t("기물 담기")}
                    className={`ac-slot empty sm${dropAt === `d${i}` ? " over" : ""}`}
                    {...dropProps("d", i)}
                    onClick={() => setPicking({ z: "d", i })}>+</button>
                );
                return (
                  <div key={i} draggable
                    className={`ac-slot sm${isGold(sl.id) ? " gold" : ""}${dropAt === `d${i}` ? " over" : ""}`}
                    onDragStart={() => { dragFrom.current = { z: "d", i }; }}
                    onDragEnd={() => { dragFrom.current = null; setDropAt(""); }}
                    {...dropProps("d", i)}>
                    <button type="button" className="ac-slot-face" onClick={() => openChess(c)} title={t("기물 상세")}>
                      {c.op ? <img src={opFace(c.op)} alt="" aria-hidden loading="lazy" onError={hideErr} />
                        : <span className="ac-face-diy" aria-hidden>?</span>}
                      <b>{c.n}</b>
                    </button>
                    <span className="ac-slot-act"
                      draggable={false}
                      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      {/* 골든은 기물의 성질이라 어느 구역에서 눌러도 같다 (사용자 지적 2026-08-29) */}
                      <button type="button" className={`ac-goldbtn${isGold(sl.id) ? " on" : ""}`}
                        onClick={() => toggleGoldOf(sl.id)}
                        title={t("정예화(골든) 전환 — 판을 비워도 남습니다")}>{t("골든")}</button>
                      <button type="button" onClick={() => dropFrom("d", i)} title={t("빼기")}>×</button>
                    </span>
                  </div>
                );
              })}
            </div>
            {(nBoard > 0 || nBench > 0) && (
              <p className="ac-simfoot">
                <button type="button" className="ac-clear" onClick={() => { setSlots([]); setBench([]); }}>
                  {t("판 비우기")}
                </button>
                {/* 지금 판이 그대로 주소에 실려 있다 — 그 주소를 복사한다 (사용자 요청 2026-08-29).
                    farm.tsx 의 ShareLinkButton 과 같은 규약. */}
                <button type="button" className="ac-clear" onClick={copyLink}>
                  <span aria-hidden>🔗</span> {copied ? t("복사됨!") : t("공유 링크 복사")}
                </button>
              </p>
            )}
          </section>


          </div>
        </ModalWindow>
      )}

      {/* 기물 고르기 모달 — 빈 칸의 + 를 누르면 오퍼레이터 탭과 같은 내용이 뜬다
          (사용자 지시 2026-08-29). 필터 바·티어 묶음·카드 모양을 그대로 쓰되, 카드를 누르면
          상세가 아니라 **그 칸에 담긴다**. 담고 나면 바로 닫아 판이 보이게 한다. */}
      {picking && (
        <ModalWindow label={picking.z === "b" ? t("배치에 담기") : t("정비구역에 담기")}
          className="operator-modal ac-modal" onClose={() => setPicking(null)}>
          <div className="ac-guide ac-pickmodal">
            {filterBar}
            <p className="ac-count">{t("{n}명", { n: pickRows.length })}</p>
            {[1, 2, 3, 4, 5, 6].map((tn) => {
              const rows = pickRows.filter((c) => c.t === tn);
              if (!rows.length) return null;
              return (
                <section key={tn} className="ac-tiersec">
                  <h3 className="ac-tierhead">{tierBadge(tn)}<span>{t("{n}명", { n: rows.length })}</span></h3>
                  <div className="ac-cards">
                    {rows.map((c) => (
                      <button key={c.id} type="button" className="ac-card ac-chesscard ac-pickcard"
                        onClick={() => { addPieceTo(picking, c); setPicking(null); }}>
                        <header>
                          {c.op
                            ? <img className="ac-thumb" src={opFace(c.op)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                            : <span className="ac-thumb ac-face-diy" aria-hidden>?</span>}
                          <div>
                            <b className="ac-cname">{c.n}</b>
                            <span className="ac-cmeta">
                              {c.r ? <i className="ac-star">★{c.r}</i> : null}
                              {c.job ? <i className="sb-chip">{c.job}</i> : null}
                            </span>
                            {c.bonds.length > 0 && (
                              <span className="ac-oprow-bonds">{c.bonds.map(bondTag)}</span>
                            )}
                          </div>
                        </header>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </ModalWindow>
      )}

      {bond && (
        <ModalWindow key={bond.id} label={bond.n} className="operator-modal ac-modal" onClose={() => setBond(null)}>
          <div className="ac-dt">
            <header className="ac-dt-head">
              <img src={bondIcon(bond.id)} alt="" aria-hidden onError={hideErr} />
              <div>
                <h2>{bond.n}</h2>
                <p className="ac-cmeta">
                  <i className="sb-chip">{bond.nation ? t("진영 맹약") : t("특성 맹약")}</i>
                  <i className="sb-chip">{bond.down ? t("{n}명 이하", { n: bond.min }) : t("{n}명부터", { n: bond.min })}</i>
                  {bond.cond && BOND_COND_LABEL[bond.cond] && <i className="sb-chip">{t(BOND_COND_LABEL[bond.cond])}</i>}
                  {bond.chess.length > 0 && <i className="sb-chip">{t("오퍼레이터 {n}명", { n: bond.chess.length })}</i>}
                  {!funnyBonds.has(bond.id) && <i className="sb-chip ac-warn">{t("표준 시뮬레이션 제외")}</i>}
                </p>
              </div>
            </header>
            <h4>{t("효과")}
              {/* 시뮬레이터에서 중첩을 넣어 두면 그 기준으로 수치를 풀어 준다
                  (사용자 지시 2026-08-30 "중첩을 변경하면 해당 중첩에 맞춰서 맹약 상세에 뜨도록").
                  맹약 탭에서 그냥 연 경우엔 중첩이 없으니 종전대로 식만 보인다. */}
              {(stacks[bond.id] ?? 0) > 0 && (
                <em className="sb-count ac-atstack">{t("중첩 {n} 기준", { n: stacks[bond.id] })}</em>
              )}
            </h4>
            {/* 게임 설명문이 "(중첩 수에 따라 변경)"·"(최대치 존재)"로 뭉갠 값의 **실제 숫자**를
                그 효과 줄 **안에** 붙인다 (사용자 지시 2026-08-24: "효과 쪽에다가 그냥 같이
                넣어주면 안되나 — 굳이 따로 빼는것보단"). 따로 뺐을 땐 어느 줄 이야기인지
                눈으로 다시 맞춰야 했다. 계수는 클뜯 전투 블랙보드에서 뽑는다 —
                build-autochess.py stack_rows 참고, sk.s = 그 값이 걸린 단계 인덱스. */}
            <ol className="ac-steps">
              {bond.steps.map((s, i) => (
                <li key={i}>
                  {s.c && <span className="ac-stepcond">{acRich(s.c, bond.id)}</span>}
                  <span className="ac-steptxt">{acRich(s.t, bond.id)}</span>
                  {stackList(bond, i)}
                </li>
              ))}
            </ol>
            {bond.chess.length === 0
              ? <p className="sb-dim">{t("소속 오퍼레이터가 따로 없는 맹약입니다 — 배치 조건만 맞으면 활성화됩니다.")}</p>
              : <h4>{t("소속 오퍼레이터")} <em className="sb-count">{bond.chess.length}</em></h4>}
            {[1, 2, 3, 4, 5, 6].map((tn) => {
              const rows = bond.chess.map((id) => chessById.get(id)).filter((c): c is AcChess => !!c && c.t === tn);
              if (!rows.length) return null;
              return (
                <div key={tn} className="ac-tiergrp">
                  <h5 className="ac-tierhead">{tierBadge(tn)}<span>{t("{n}명", { n: rows.length })}</span></h5>
                  <div className="ac-oplist">{rows.map(opRow)}</div>
                </div>
              );
            })}
            {/* 자유 선택 칸으로 데려올 수 있는 이 맹약 오퍼 (사용자 요청 2026-08-23:
                "골든글로우 같은 경우는 빅토리아 맹약 밑에 뜨게") — 상점 명단과 구분해 맨 밑에 */}
            {(() => {
              const cand = diyPool.filter((o) => o.bonds?.includes(bond.id));
              if (!cand.length) return null;
              return (
                <>
                  <h4>{t("자유 선택 칸 후보")} <em className="sb-count">{cand.length}</em></h4>
                  <p className="sb-dim">{t("상점 명단에는 없지만, 보급센터 자유 선택 칸으로 데려오면 이 맹약으로 셉니다.")}</p>
                  <div className="ac-diypool">
                    {cand.map((o) => (
                      <button key={o.op} type="button" className="ac-diyop"
                        onClick={() => openChess({
                          id: `diy_${o.op}`, op: o.op, n: o.n, t: 6, sort: 0,
                          kind: "DIY", bonds: o.bonds ?? [], gar: [], garG: [], r: 6, job: o.job,
                        })}>
                        <img src={opFace(o.op)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                        <b>{o.n}</b>
                      </button>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </ModalWindow>
      )}

      {/* ── 기물 상세 모달 ── */}
      {chess && (
        /* key로 기물마다 새로 마운트한다 — ModalWindow는 **마운트할 때** 맨 앞 z를 받으므로,
           맹약 상세(위에 떠 있는 창)에서 오퍼레이터를 누르면 뒤에 있던 이 창이 앞으로 나오면서
           그 오퍼레이터로 바뀐다. key가 없으면 내용만 바뀌고 뒤에 가려 있어 안 바뀐 것처럼
           보인다 (사용자 지적 2026-08-23). */
        <ModalWindow key={chess.id} label={chess.n} className="operator-modal ac-modal" onClose={() => setChess(null)}>
          <div className="ac-dt">
            <header className="ac-dt-head">
              {chess.op
                ? <img src={opFace(chess.op)} alt="" aria-hidden onError={hideErr} />
                : <span className="ac-thumb ac-face-diy" aria-hidden>?</span>}
              <div>
                <h2>{chess.n}</h2>
                <p className="ac-cmeta">
                  {chess.t ? tierBadge(chess.t) : null}
                  {chess.r ? <i className="ac-star">★{chess.r}</i> : null}
                  {chess.job ? <i className="sb-chip">{chess.job}</i> : null}
                  <i className="sb-chip ac-kind">{t(KIND_LABEL[chess.kind] ?? chess.kind)}</i>
                </p>
                <p className="ac-bondline">{chess.bonds.map((b) => bondChip(b))}</p>
              </div>
              {/* 본체 미보유 시 대신 출전하는 전용 캐릭터 — 얼굴만 바뀌고 기물은 그대로다
                  (사용자 스크린샷 2026-08-23: 르무엔 미보유 계정의 스톰아이). 머리글 오른쪽
                  빈자리에 둔다 — 본문에 두면 정예화 토글과 붙어 보인다 (사용자 지적). */}
              {chess.bk && (
                <button type="button" className="ac-subnote"
                  title={t("본체 미보유 시 {n} 모습으로 대체 출전 — 맹약·특질·스킬은 그대로", { n: chess.bk.n })}
                  onClick={() => { const s = diySubs.find((x) => x.op === chess.bk!.op); if (s) openSub(s); }}>
                  <em>{t("본체 미보유 시 대체")}</em>
                  <span>
                    <img src={opFace(chess.bk.op)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                    <b>{chess.bk.n}</b>
                  </span>
                </button>
              )}
            </header>

            {/* 백과사전 오퍼 상세로 — 특질·스킬·모듈·능력치 전문은 도감 쪽에 있다.
                특히 자유 선택 칸 후보(diy_)는 위수 협의 전용 데이터가 아예 없어서 이 창만으로는
                볼 게 없다 (사용자 요청 2026-08-24: "자유선택 칸 후보의 오퍼도 클릭하면 스킬 및
                모듈 등등 설명 볼 수 있게"). 대체 기물(NPC)은 백과사전에 항목이 없어 제외한다. */}
            {chess.op && onShowOperator && !chess.subsOf?.length && (
              <button type="button" className="ac-opdex" onClick={() => onShowOperator(chess.op!)}>
                <img src={opFace(chess.op)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                <span>
                  <b>{t("백과사전에서 {n} 보기", { n: chess.n })}</b>
                  <em>{t("특질 · 스킬 · 모듈 · 능력치 전문")}</em>
                </span>
                <i aria-hidden>›</i>
              </button>
            )}

            {/* 일반 ↔ 정예화(골든) — 능력·스킬·모듈·표 강조가 전부 이 토글을 따른다 (2026-08-23) */}
            {(chess.garG.length > 0 || chess.sks?.some((x) => x.dG) || chess.modG) && (
              <div className="ac-goldbar" role="tablist" aria-label={t("정예화 상태")}>
                <button type="button" role="tab" aria-selected={!goldView}
                  className={!goldView ? "on" : ""} onClick={() => setGoldView(false)}>{t("일반")}</button>
                <button type="button" role="tab" aria-selected={goldView}
                  className={goldView ? "on gold" : "gold"} onClick={() => setGoldView(true)}>{t("정예화(골든)")}</button>
              </div>
            )}
            {/* 대체 기물(NPC) — 능력 대신 '어느 기물을 대체하는가'를 보여준다. 특질은
                대체하는 기물의 것이라 각 기물 상세에서 읽는다 (사용자 요청 2026-08-23). */}
            {chess.subsOf?.length ? (
              <>
                <p className="sb-dim ac-note">{t("본체 오퍼레이터가 없는 명단 기물이 이 모습으로 대신 출전합니다 — 맹약·특질·스킬은 대체하는 기물의 것을 그대로 씁니다. 자유 선택 판에도 보유와 무관하게 항상 후보로 뜹니다.")}</p>
                <h4>{t("대체 출전하는 기물")} <em className="sb-count">{chess.subsOf.length}</em></h4>
                <div className="ac-diypool">
                  {chess.subsOf.map((cid) => {
                    const c2 = chessById.get(cid);
                    if (!c2) return null;
                    return (
                      <button key={cid} type="button" className="ac-diyop" onClick={() => openChess(c2)}>
                        {c2.op && <img src={opFace(c2.op)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />}
                        <b>{c2.n}</b>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <h4>{t("위수 협의 능력")}</h4>
                {chess.gar.length || chess.garG.length ? (
                  (goldView && chess.garG.length ? chess.garG : chess.gar)
                    .map((g) => garLine(g, goldView, true, chess.id))
                ) : chess.id.startsWith("diy_")
                  /* 자유 선택 칸으로만 데려오는 ★6 — 상점 명단이 아니라 전용 능력이 아예 없다 */
                  ? <p className="sb-dim">{t("보급센터 자유 선택 칸으로만 데려올 수 있는 오퍼레이터입니다. 상점 명단에 없어 전용 능력·기본 스킬 설정이 게임 데이터에 들어 있지 않고, 게임 안내대로 특질 없이 출전합니다.")}</p>
                  : <p className="sb-dim">{t("전용 능력이 없는 오퍼레이터입니다.")}</p>}
              </>
            )}
            {chess.sks?.length ? (
              <>
                <h4>{t("스킬")}</h4>
                {/* 도감 링크 대신 설명을 그대로 싣는다 (사용자 확정 2026-08-23). 수치는 위 토글이
                    가리키는 그 상태(일반/골든)의 스킬 레벨·모듈 단계 기준이다. */}
                <p className="sb-dim ac-note">{t("수치는 위에서 고른 정예화 상태의 스킬 레벨 기준이고, 기본으로 들고 나오는 구성에 '디폴트'가 붙어 있습니다.")}</p>
                {chess.sks.map((sk) => {
                  const lv = goldView ? (sk.lvG ?? sk.lv) : sk.lv;
                  const d = goldView ? (sk.dG ?? sk.d) : sk.d;
                  return (
                    <div key={sk.i} className="ac-skmod">
                      <header>
                        {sk.ic && <img className="ac-skmod-ic" src={skillIcon(sk.ic)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />}
                        <span className="ac-skmod-cap">{t("{n}스킬", { n: sk.i })}</span>
                        <b>{sk.n}</b>
                        {lv ? <i className="sb-chip">Lv{lv}</i> : null}
                        {sk.df ? <i className="sb-chip ac-df">{t("디폴트")}</i> : null}
                      </header>
                      {d && <p className="ac-skmod-d">{acRich(d, chess.id)}</p>}
                    </div>
                  );
                })}
              </>
            ) : null}
            {chess.mods?.length ? (
              <>
                <h4>{t("모듈")}</h4>
                {/* 모듈 슬롯은 골든부터 — 일반 토글에서는 흐리게 눕혀 둔다 */}
                {chess.modG && !goldView && <p className="sb-dim ac-note">{t("모듈 슬롯은 정예화(골든)부터 열립니다.")}</p>}
                {chess.mods.map((md) => (
                  <div key={md.n} className={`ac-skmod mod${chess.modG && !goldView ? " off" : ""}`}>
                    <header>
                      {md.i && <img className="ac-skmod-ic mod" src={modTypeIcon(md.i)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />}
                      <span className="ac-skmod-cap">{md.i ? md.i.toUpperCase() : t("모듈")}</span>
                      <b>{md.n}</b>
                      {md.df ? <i className="sb-chip ac-df">{t("디폴트")}</i> : null}
                    </header>
                    {md.d && <p className="ac-skmod-d">{acRich(md.d, chess.id)}</p>}
                    {md.s && <p className="ac-skmod-stats">{md.s}</p>}
                  </div>
                ))}
              </>
            ) : null}

            {/* 제목도 표와 함께 숨긴다 — 대체 기물은 티어가 없어 표가 없는데 제목만 남았다 */}
            {(() => {
              const row = doc.shop.tiers.find((x) => x.t === chess.t);
              if (!row) return null;
              return (
                <>
                <h4>{t("가격과 능력치")}</h4>
                <div className="ac-tablewrap">
                  <table className="ac-table ac-table-sm">
                    <thead><tr><th /><th>{t("구매")}</th><th>{t("정예화")}</th><th>{t("레벨")}</th><th>{t("스킬")}</th><th>{t("모듈")}</th></tr></thead>
                    <tbody>
                      <tr className={!goldView ? "ac-activerow" : ""}><th scope="row">{t("일반")}</th><td>{row.b.buy}</td><td>{t(PHASE_LABEL[row.b.ph] ?? row.b.ph)}</td><td>Lv{row.b.lv}</td><td>{row.b.sk}</td><td>{row.b.md ? t("{n}단계", { n: row.b.md }) : "—"}</td></tr>
                      <tr className={`ac-gold-row${goldView ? " ac-activerow" : ""}`}><th scope="row">{t("골든")}</th><td>{t("{n}장", { n: chess.up ?? 3 })}</td><td>{t(PHASE_LABEL[row.g.ph] ?? row.g.ph)}</td><td>Lv{row.g.lv}</td><td>{row.g.sk}</td><td>{row.g.md ? t("{n}단계", { n: row.g.md }) : "—"}</td></tr>
                    </tbody>
                  </table>
                </div>
                </>
              );
            })()}
          </div>
        </ModalWindow>
      )}

      {/* ── 장비 상세 모달 ── */}
      {equip && (
        <ModalWindow key={equip.id} label={equip.n} className="operator-modal ac-modal" onClose={() => setEquip(null)}>
          <div className="ac-dt">
            <header className="ac-dt-head">
              <img src={equipIcon(equip.trap)} alt="" aria-hidden onError={hideErr} />
              <div>
                <h2>{equip.n}</h2>
                <p className="ac-cmeta">
                  {tierBadge(equip.t)}
                  <i className="sb-chip">{t("{n} 자금", { n: equip.buy })}</i>
                  {equip.bond ? bondChip(equip.bond) : null}
                </p>
              </div>
            </header>
            <h4>{t("효과")}</h4>
            <Lines text={equip.d} render={(x) => acRich(x, equip.id)} />
            {equip.dG && equip.dG !== equip.d && (
              <>
                <p className="ac-goldhead">{t("강화 ({n}개 조합)", { n: equip.up ?? 2 })}</p>
                <div className="ac-gar gold"><span className="ac-gar-txt">
                  <Lines text={equip.dG} render={(x) => acRich(x, equip.id)} /></span></div>
              </>
            )}
            {/* ⚠ "장착하면 중첩도 올라간다"고 썼다가 정정 (사용자 지적 2026-08-23 ×2) —
                클뜯 canGiveBond가 맹약 아이템 전부 false. 변형 구조체와 조합해야 맹약 부여. */}
            {/* 변형 구조체 본인 — 게임이 "해당 장비의 재능에서 확인"으로 떠넘기는
                대응 관계를 여기서 통째로 편다 (사용자 요청 2026-08-24). */}
            {equip.id === MORPH_ID && morphMap.length > 0 && (
              <>
                <h4>{t("맹약을 주는 장비")} <em className="sb-count">{
                  morphMap.reduce((a, [, list]) => a + list.length, 0)}</em></h4>
                <p className="sb-dim ac-note">{t("이 중 하나를 변형 구조체와 함께 장착하면 착용자가 그 맹약을 추가로 얻습니다. 장비만 장착해서는 맹약이 붙지 않습니다.")}</p>
                <div className="ac-morphmap">
                  {morphMap.map(([b, list]) => (
                    <div key={b.id} className="ac-morphgrp">
                      {bondChip(b.id, true)}
                      <div className="ac-morphitems">
                        {list.map((e) => (
                          <button key={e.id} type="button" className="ac-morphitem"
                            onClick={() => setEquip(e)}>
                            <img src={equipIcon(e.trap)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                            <b>{e.n}</b>
                            {tierBadge(e.t)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {equip.bond && (() => {
              const morph = doc.equips.find((e) => e.id === MORPH_ID);
              return (
                <p className="sb-dim ac-morphnote">
                  {t("변형 구조체와 함께 장착하면 착용자가 {bond} 맹약을 추가로 얻습니다.", { bond: nameOfBond(equip.bond) })}
                  {morph && (
                    <button type="button" className="ac-morphlink" onClick={() => setEquip(morph)}>
                      <img src={equipIcon(morph.trap)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                      {morph.n} →
                    </button>
                  )}
                </p>
              );
            })()}
          </div>
        </ModalWindow>
      )}

      {/* ── 밴드 상세 모달 ── */}
      {band && (
        <ModalWindow key={band.id} label={band.by ? `${band.n} (${band.by})` : band.n} className="operator-modal ac-modal" onClose={() => setBand(null)}>
          <div className="ac-dt">
            <header className="ac-dt-head">
              <img src={bandIcon(band.id)} alt="" aria-hidden onError={hideErr} />
              <div>
                {/* 대표 오퍼 이름을 제목에 붙인다 — 커뮤니티는 '집중 케어'가 아니라
                    '와파린 전략'으로 부른다 (사용자 확정 2026-08-24). 그 오퍼가 이 모드의
                    기물이면(36개 중 8개) 눌러서 기물 상세로 간다. */}
                <h2>{band.n}{band.by && (() => {
                  const byOp = chessByName.get(band.by as string);
                  return byOp
                    ? <button key="by" type="button" className="ac-bandby ac-bandby-link"
                      title={t("{name} 상세 열기", { name: band.by })}
                      onClick={() => openChess(byOp)}>{band.by}</button>
                    : <em key="by" className="ac-bandby">{band.by}</em>;
                })()}</h2>
                <p className="ac-cmeta">
                  <i className="sb-chip ac-hp">{t("목표 HP")} {band.hp}</i>
                  {band.modes.map((m) => <i key={m} className="sb-chip">{t(MODE_TYPE_LABEL[m] ?? m)}</i>)}
                </p>
              </div>
            </header>
            <h4>{t("효과")}</h4>
            <Lines text={band.d} render={(x) => acRich(x, band.id)} />
            {/* 해금 조건 — 37개 중 25개만 조건이 있다 (사용자 요청 2026-08-22) */}
            <h4>{t("해금 조건")}</h4>
            {band.un
              ? <p className="ac-unlock">{acRich(band.un, band.id)}</p>
              : <p className="sb-dim">{t("처음부터 고를 수 있는 전략입니다.")}</p>}
          </div>
        </ModalWindow>
      )}

      {/* ── 적 상세 모달 — 본문은 적 도감과 같은 EnemyFile을 쓰고(스탯·능력·면역),
             그 아래 이 모드에서만 뜻이 있는 등장 정보를 덧댄다. 도감 데이터가 아직
             안 왔으면 이름·초상만 먼저 띄운다 (사용자 요청 2026-08-22). ── */}
      {enemy && (
        <ModalWindow key={enemy} label={enemyRow?.n ?? bossRow?.n ?? enemyName(enemy)} className="operator-modal ac-modal ac-enmodal"
          onClose={() => setEnemy(null)}>
          {(() => {
            const full = enemyDex?.get(enemy);
            return full ? (
              <EnemyFile enemy={full} stagesDoc={null} nameOf={enemyName}
                onOpenEnemy={(id) => setEnemy(id)} />
            ) : (
              <div className="en-file">
                <header className="en-head">
                  <EnFace id={enemy} className="en-portrait" />
                  <div className="en-head-main">
                    <span className="en-code">{enemyRow?.code ?? "—"}</span>
                    <h2>{enemyRow?.n ?? enemyName(enemy)}</h2>
                  </div>
                </header>
                <p className="sb-dim">{t("적 도감을 불러오는 중…")}</p>
              </div>
            );
          })()}
          {(enemyRow || bossRow) && (
            <div className="en-file ac-enextra">
              <section className="en-block">
                <h3><span className="section-no">STRONGHOLD</span>{t("위수 협의 등장 정보")}</h3>
                {enemyRow && (
                  <dl className="en-facts">
                    <div>
                      <dt>{t("유형")}</dt>
                      <dd>{doc.enemyTypes[enemyRow.type]?.n ?? enemyRow.type}</dd>
                    </div>
                    <div><dt>{t("등장 구간")}</dt><dd>{enemyRow.half ? t("전반") : t("후반")}</dd></div>
                    <div><dt>{t("추첨 가중치")}</dt><dd>{enemyRow.w}</dd></div>
                  </dl>
                )}
                {bossRow && (
                  <>
                    <dl className="en-facts">
                      <div><dt>{t("등장 라운드")}</dt>
                        <dd>{bossRow.round.map((r) => `${r}R`).join(" · ")}</dd></div>
                      <div><dt>{t("추첨 가중치")}</dt><dd>{bossRow.w}</dd></div>
                      {bossRow.hide && <div><dt>{t("히든 리더")}</dt><dd>{t("극한·초월에서만")}</dd></div>}
                    </dl>
                    <p className="en-note">{t("리더 적의 HP는 난이도마다 다릅니다 — 아래 값은 위수 협의 안에서만 쓰는 수치입니다.")}</p>
                    <dl className="en-facts">
                      {BOSS_HP_KEYS.map(([k, diff]) => (
                        <div key={k}><dt>{modeNameOf(diff)}</dt><dd>{fmtHp(bossRow.hp[k])}</dd></div>
                      ))}
                    </dl>
                    {/* 이 리더가 나오는 전장으로 바로 (사용자 확정 2026-08-30) — 맵 데이터는
                        탭이 열릴 때 지연 로드되므로 여기서는 탭만 열고 맵 id를 예약해 둔다. */}
                    <button type="button" className="ac-clear"
                      onClick={() => { void openLeaderMap(bossRow.id); }}>
                      {t("이 리더의 전투 맵 보기")}</button>
                  </>
                )}
                {enemyRow && (enemyRow.an.length > 0 || enemyRow.ae.length > 0) && (
                  <>
                    <p className="en-note">{t("이 적이 뽑힌 라운드에 함께 나오는 부대입니다.")}</p>
                    <div className="ac-enmini">
                      {[...enemyRow.an.map((id) => [id, t("일반")] as const),
                        ...enemyRow.ae.map((id) => [id, t("정예")] as const)].map(([id, kind]) => (
                          <button key={`${kind}-${id}`} type="button" className="ac-enminicard"
                            onClick={() => setEnemy(id)}>
                            <EnFace id={id} />
                            <span><b>{enemyName(id)}</b><em>{kind}</em></span>
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </ModalWindow>
      )}
    </section>
  );
}
