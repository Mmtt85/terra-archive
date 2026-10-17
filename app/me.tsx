"use client";

// 내 정보 (/me) — 게임 로그인으로 받은 내 계정을 한 화면에 (사용자 요청 2026-10-04).
// 계정 데이터는 me-store 가 브라우저에 보관하고, 오퍼 도감·인프라·아이템 도감·공개채용이 같은 것을 읽는다.
//
// 화면 구성 (넓은 화면 2단):
//   왼쪽  — 박사 카드 · 재화 · 지원 유닛 · 기반시설
//   오른쪽 — 한눈에 보기 · 공개모집으로 채울 오퍼 · 접은 칸(진행 상황·친구·최근 얻은 오퍼·창고) · 성급별 육성
//   맨 아래 — 창고 전체
// 로그인 폼은 제목 오른쪽 버튼 → 모달 (사용자 지시 같은 날). 로그인 전에는 가상의 계정으로 채운 예시 화면을 보여 준다.
// 숫자 칸(한눈에 보기·성급별 육성)은 누르면 해당 오퍼 목록이 모달로 뜬다. 긴 목록은 몇 줄만 보이고 '전부 보기'로 편다.
// 공개모집 슬롯은 빼다 (사용자 지시 — 너무 자주 바뀌어 동기화 시점 값이 쓸모없다).

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { asset } from "./assets";
import { TOPICS } from "./rogue-topics";
import { useI18n, rich, DT_LOCALE, type ExtraI18n, type Locale } from "./i18n";
import { ModalWindow } from "./modal-window";
import { useConfirm } from "./confirm";
import { AccountLoginForm, AccountSteps } from "./roster-import";
import { MeVerify } from "./me-verify";
import { AccountError, accountErrorText, syncAccount, MAINTENANCE_TEXT, MAINTENANCE_TITLE, ACCOUNT_SERVERS, type AccountChar, type AccountFriend, type AccountProfile, type AccountStep } from "./account";
import { cnErrorText } from "./account-cn";
import { clearMe, dropMeToken, eliteText, isCollectible, isMaxed, masteryText, maxEliteOf, meChars, meToken, mePulls, potText, saveMe, useMe, type MeData, WALLET_ROWS } from "./me-store";
import { loadEnemies, loadEnemyStages, loadEnemyStats, loadFutureDex, loadItems, loadStages } from "./dex-cross";
import { GROUPS, GROUP_LABEL, ItemFile, itemIcon, type DexItem, type ItemDoc, type ItemGroup } from "./items";
import { StageFile } from "./stage-detail";
import { EnemyFile, type Enemy, type EnemyStages } from "./enemy-detail";
import { viewOf, type StageDoc, type StageView } from "./stage-data";
import { normSearch } from "./search";
import { Marquee } from "./marquee";
import { AttributeFilter } from "./attr-filter";
import recruitData from "./data/recruit.json";
import paradoxData from "./data/paradox.json";
import towerNames from "./data/towers.json";
import { MeShare } from "./me-share";
import { openChecker, runningChecker } from "./stage-open";
import { resetCloudPrefs } from "./cloud-prefs";
import { Dropdown } from "./dropdown";
import { NoSortHandle, SortColumn, SortHandle, useDrawerDrag, useMeOrder, type DrawerKey } from "./me-order";
import { ACQUIRE_KEYS, ACQUIRE_LABEL, acquireOf, type AcquireKey } from "./op-acquire";
import { CustomTileEditor, DEFAULT_LAYOUT, MAX_CUSTOM, evalTile, saveCustomTiles, tileLabel, useCustomTiles, useLayoutCustomized, type Cond, type CustomTile, type TileValue } from "./me-custom";

export type MeOp = {
  id: string; name: string; rarity: number; image: string; unreleased?: boolean;
  /** 직군 — 표시명은 로케일 데이터, 거르기는 jobCode(언어 무관) */
  job?: string; jobCode?: string;
  skills: { id: string; name: string; icon?: string }[];
  modules: { id: string; name: string; type?: string }[];
};

type Props = {
  operators: MeOp[];
  extra?: ExtraI18n | null;
  onShowOperator?: (id: string) => void;
};

const subscribeNoop = () => () => { /* 마운트 판정용 */ };
const RARITIES = [6, 5, 4, 3, 2, 1];

// 재화 — 용문폐·합성옥·순오리지늄을 맨 위로, 크레딧은 뺀다 · 구매증명서·모듈 데이터 칩·순금(금괴)을 더한다 (사용자 지시 2026-10-05)
// 한 줄짜리 묶음(용문폐·합성옥·오리지늄 / 허가증 / 증명서, 사용자 지시 2026-10-05 — WALLET_ROWS 는 me-store, 내보내기 카드도 쓴다) + 나머지 목록
const WALLET_LIST = ["mod_unlock_token", "3003"];

// 기반시설 방 종류 (building roomId) — 표시 순서
const ROOM_ORDER = ["CONTROL", "MANUFACTURE", "TRADING", "POWER", "DORMITORY", "MEETING", "HIRE", "WORKSHOP", "TRAINING"];
const ROOM_LABEL: Record<string, string> = {
  CONTROL: "제어 센터", MANUFACTURE: "제조소", TRADING: "무역소", POWER: "발전소", DORMITORY: "숙소",
  MEETING: "응접실", HIRE: "사무실", WORKSHOP: "가공소", TRAINING: "훈련실",
};

// 직군 표시 순서 — jobCode(언어 무관). home.tsx JOB_ORDER 와 같다 (planner-engine 을 이 묶음에 끌어오지 않으려고 따로 둔다)
const JOB_ORDER = ["PIONEER", "WARRIOR", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"];

// 접어 두는 줄 수 — 이만큼만 먼저 보이고 '전부 보기'로 편다
const DEPOT_ROWS = 4;
const EP_FOLD = 6;

// 남은 순오리지늄 — 작전을 처음 3성(완료)으로 깰 때 한 번 주는 것 (제안 d4c30874 "남은 광산 계산기", 2026-10-14).
// stage-op.json(build-stages.py) = 순오리지늄 주는 작전 전부(돌격 #f#·스토리 작전 포함). 계정 작전 상태가 3 미만이고
// 지금 들어갈 수 있는 것만 센다 — 열림 판정은 미클리어와 같은 openChecker(ref = 판정에 쓸 도감 작전, "" = 상시)
type StageOpDoc = { ids: string[]; n: Record<string, number>; ref: Record<string, string>; nm?: Record<string, [string, string]> };
function useStageOp(): StageOpDoc | null {
  const [doc, setDoc] = useState<StageOpDoc | null>(null);
  useEffect(() => { void import("./data/stage-op.json").then((m) => setDoc(m.default as unknown as StageOpDoc)); }, []);
  return doc;
}
function primeLeft(doc: StageOpDoc | null, rec: Record<string, number> | undefined, stages: StageDoc | null,
  isOpen: (s: { id: string; t: string }) => boolean, isRunning: (id: string) => boolean):
  { n: number; ids: string[]; open: number; clear: number; shut: number; shutIds: string[] } | null {
  if (!doc || !rec || !stages) return null;
  const typeOf = new Map(stages.stages.map((s) => [s.id, s.t]));
  let n = 0, open = 0, clear = 0, shut = 0;
  const ids: string[] = [], shutIds: string[] = [];
  for (const id of doc.ids) {
    const ref = doc.ref[id] ?? id.replace(/#f#$|#s$/, "");
    const type = typeOf.get(ref) ?? "ACTIVITY";
    const state = rec[id] ?? -1;
    // 기록이 아예 없는 이벤트 작전은 지금 기간 중인 이벤트일 때만 — 끝난 이벤트는 깬 기록이 계정 데이터에서 지워진다
    // (사용자 지적 2026-10-14 "작년에 다 깬 중생의 여정이 77개에 들어 있다"). 깼는지 알 수 없으니 입장 불가에도 넣지 않는다
    if (rec[id] == null && type === "ACTIVITY" && !isRunning(ref)) continue;
    // 지금 입장 불가(끝난 기간 이벤트·지난 순환 작전)인데 3성 전인 작전 — 받을 수 없는 순오리지늄이라 '획득 가능'엔 안 넣고
    // 따로 센다 (사용자 지시 2026-10-16 "입장불가 스테이지는 아무 데도 표시가 안 나온다, 표시해 줘")
    if (ref && !isOpen({ id: ref, t: type })) {
      if (state < 3) { shut += doc.n[id] ?? 1; shutIds.push(id); }
      continue;
    }
    // 같은 모집단의 '입장 가능'·'클리어' — 남은 수만 보면 많은지 적은지 가늠이 안 된다 (사용자 지시 2026-10-16
    // "클리어한 작전하고 현재 입장 가능한 스테이지 수를 적어 주는 게 좋겠다", 제보 "390개 깼는데 574개?")
    open += 1;
    if (state >= 2) clear += 1;
    if (state >= 3) continue;
    n += doc.n[id] ?? 1;
    ids.push(id);
  }
  return { n, ids, open, clear, shut, shutIds };
}
const OPS_ROWS = 2;

/** 격자의 실제 열 수 — 접을 때 '몇 줄'을 꽉 채우려고 잰다 (사용자 지적 2026-10-05: 두 번째 줄 끝이 비면 그게 다인 줄 안다).
 *  재기 전(0)엔 넉넉한 기본값을 쓴다. */
function useGridCols(): [(el: HTMLElement | null) => void, number] {
  const [cols, setCols] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    const measure = () => setCols(getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length);
    measure();
    ro.current = new ResizeObserver(measure);
    ro.current.observe(el);
  }, []);
  return [ref, cols];
}
const FRIEND_FOLD = 4;
const avatarOf = (id: string) => asset(`/avatars/${id}.webp`);

/** 숫자는 언제나 천 단위 쉼표 (1113 → 1,113) */
const fmtOf = (locale: Locale) => {
  const f = new Intl.NumberFormat(DT_LOCALE[locale]);
  return (n: number) => f.format(n);
};

function rel(t: ReturnType<typeof useI18n>["t"], now: number, sec: number): string {
  if (!sec) return "—";
  const d = Math.floor((now / 1000 - sec) / 86400);
  if (d <= 0) {
    const h = Math.floor((now / 1000 - sec) / 3600);
    return h <= 0 ? t("방금") : t("{n}시간 전", { n: h });
  }
  return t("{n}일 전", { n: d });
}

// ── 예시 계정 (로그인 전 미리보기) ──────────────────────────
// 오퍼·아이템·작전 id 를 해시해 숫자를 정한다 — 렌더마다 같은 값이 나오고 무작위 호출이 없다.
function hash(str: string): number {
  let n = 2166136261;
  for (let i = 0; i < str.length; i++) n = Math.imul(n ^ str.charCodeAt(i), 16777619) >>> 0;
  return n / 4294967296;
}
const SAMPLE_TS = 1790000000; // 고정 시각 (초) — 예시 화면의 날짜가 렌더마다 흔들리지 않게
const sampleCache = new WeakMap<MeOp[], MeData>();
function sampleMe(operators: MeOp[]): MeData {
  const hit = sampleCache.get(operators);
  if (hit) return hit;
  const CAPS: Record<number, number[]> = { 1: [30], 2: [30], 3: [40, 55], 4: [45, 60, 70], 5: [50, 70, 80], 6: [50, 80, 90] };
  const chars: AccountChar[] = [];
  for (const op of operators) {
    if (op.unreleased) continue;
    const h = hash(op.id);
    if (h > (op.rarity === 6 ? 0.6 : 0.88)) continue;
    const caps = CAPS[op.rarity] ?? [30];
    const top = caps.length - 1;
    const e = hash(`${op.id}e`) < 0.7 ? top : Math.floor(hash(`${op.id}E`) * caps.length);
    const lv = hash(`${op.id}l`) < 0.55 ? caps[e] : 1 + Math.floor(hash(`${op.id}L`) * caps[e]);
    chars.push({
      id: op.id, elite: e, level: lv, potential: hash(`${op.id}p`) < 0.35 ? 6 : 1 + Math.floor(hash(`${op.id}P`) * 5),
      skill: op.rarity > 2 ? (hash(`${op.id}s`) < 0.6 ? 7 : 4) : 1,
      mastery: op.skills.map((sk) => (e === 2 && op.rarity >= 4 ? [0, 0, 1, 2, 3, 3][Math.floor(hash(`${op.id}${sk.id}`) * 6)] : 0)),
      modules: Object.fromEntries(op.modules.slice(0, 2).map((m) => [m.id, e === 2 ? Math.floor(hash(`${op.id}${m.id}`) * 4) : 0])),
      trust: hash(`${op.id}t`) < 0.4 ? 25570 : Math.floor(hash(`${op.id}T`) * 20000),
      skin: null, gain: SAMPLE_TS - Math.floor(hash(`${op.id}g`) * 86400 * 900),
      skillIndex: op.skills.length - 1, equip: null,
    });
  }
  const pick = (k: string) => chars[Math.floor(hash(k) * chars.length)];
  const assist = (k: string) => { const c = pick(k); return { id: c.id, elite: c.elite, level: c.level, potential: c.potential, skin: null, skillIndex: c.skillIndex ?? 0, mastery: c.mastery, skill: c.skill, equip: null, equipLevel: 0 }; };
  const data: MeData = {
    v: 1, server: "kr", syncedAt: SAMPLE_TS * 1000,
    player: { nickName: "Doctor", nickNumber: "0000", uid: "00000000", level: 120, serverName: "", lastOnline: SAMPLE_TS },
    chars,
    profile: {
      status: { level: 120, exp: 0, ap: 98, maxAp: 135, apTs: SAMPLE_TS, register: SAMPLE_TS - 86400 * 1100, lastOnline: SAMPLE_TS,
        progress: "main_15-08", secretary: "char_002_amiya", secretarySkin: null, avatar: null, resume: "", friendLimit: 60, monthlyEnd: 0 },
      // 창고·작전 기록은 데이터가 도착한 뒤 Dashboard 가 채운다 (sampleFill)
      inventory: { 4002: 35, 4003: 28150, 7003: 42, 7004: 3, 4001: 3820000, 7001: 512, 7002: 220, 4004: 118, 4005: 3200, SOCIAL_PT: 290, classic_normal_ticket: 12 },
      stages: {}, campaigns: {},
      recruit: [
        { slot: 0, state: 2, tags: [], picked: [14, 1], finish: SAMPLE_TS * 10 },
        { slot: 1, state: 3, tags: [], picked: [4, 15], finish: SAMPLE_TS },
        { slot: 2, state: 1, tags: [], picked: [], finish: 0 },
        { slot: 3, state: 1, tags: [], picked: [], finish: 0 },
      ],
      assist: [0, 1, 2].map((i) => { const c = pick(`as${i}`); return { id: c.id, skillIndex: c.skillIndex ?? 0, equip: null }; }),
      rooms: [["CONTROL", 5], ["MANUFACTURE", 3], ["MANUFACTURE", 3], ["MANUFACTURE", 3], ["TRADING", 3], ["TRADING", 3], ["POWER", 3], ["POWER", 3], ["POWER", 3],
        ["DORMITORY", 5], ["DORMITORY", 5], ["DORMITORY", 5], ["DORMITORY", 5], ["MEETING", 3], ["HIRE", 3], ["WORKSHOP", 3], ["TRAINING", 3]]
        .map(([room, level], i) => ({ slot: String(i), room: String(room), level: Number(level) })),
      skins: 87, medals: 140, medalTotal: 1402, furniture: 620,
      // 예시 패러독스 — 2정 오퍼의 70% 쯤을 깬 것으로
      paradox: chars.filter((c) => c.elite === 2 && hash(`${c.id}px`) < 0.7).map((c) => c.id),
      labor: { value: 132, max: 192, ts: SAMPLE_TS, speed: 0.3, point: 0 },
      // 예시 화면의 '이어하기' (2026-10-11) — 흑류수해 3층 진행 중 + 생존연산 12일째
      progress: {
        rogue: { state: "PENDING", theme: "rogue_6", mode: "NORMAL", grade: 8, start: SAMPLE_TS - 5400, zone: 2, zoneId: "zone_3", level: 7, hp: 4, maxHp: 6,
          gold: 37, shield: 1, popCost: 22, popMax: 30, toEnding: "ro6_ending_1", relics: ["rogue_6_relic_legacy_43", "rogue_6_relic_legacy_44", "rogue_6_relic_legacy_48", "rogue_6_relic_legacy_49", "rogue_6_relic_legacy_59", "rogue_6_relic_legacy_92", "rogue_6_relic_legacy_93", "rogue_6_relic_legacy_107", "rogue_6_relic_legacy_108"],
          troop: [0, 1, 2, 3, 4, 5].map((i) => { const c = pick(`rt${i}`); return { id: c.id, elite: 2, level: 70 }; }) },
        sandbox: { state: 1, day: 12, maxDay: 0, ap: 18, maxAp: 30, challenge: false, mode: 0, explore: false, rift: false,
          season: { type: 1, remain: 4, total: 9 }, zones: { z_1_0: { state: 1, weather: 0 }, z_1_1: { state: 1, weather: 1 }, z_1_2: { state: 1, weather: 2 }, z_1_3: { state: 0, weather: 0 } },
          baseLv: 4, bossKill: ["enemy_1001_bigbo", "enemy_1001_bigbo_2"], portable: true, outpost: false, techToken: 3, techUnlock: 21, drink: 2,
          squads: [{ chars: [0, 1, 2, 3].map((i) => pick(`sq${i}`).id), tools: [] }], usedChars: [], best: 0 },
      },
      sandbox: { material: { sandbox_1_wood: 41, sandbox_1_stone: 23, sandbox_1_iron: 8, sandbox_1_water: 15 }, food: { sandbox_1_food_4: 2 }, building: {}, tactical: {}, animal: {} },
      friends: Array.from({ length: 6 }, (_, i) => ({
        nickName: `Doctor${String.fromCharCode(65 + i)}`, nickNumber: String(1000 + i * 37), level: 80 + i * 7,
        avatar: null, secretary: pick(`fs${i}`).id, secretarySkin: null, lastOnline: SAMPLE_TS - i * 86400 * 2, resume: "",
        charCnt: 300, progress: null, assist: [0, 1, 2].map((j) => assist(`f${i}${j}`)),
      })),
    },
  };
  sampleCache.set(operators, data);
  return data;
}

/** 예시 계정의 창고·작전 기록을 실제 도감 데이터의 id 로 채운다 */
function sampleFill(me: MeData, items: ItemDoc | null, stages: StageDoc | null): MeData {
  if (!me.profile) return me;
  const inventory = { ...me.profile.inventory };
  for (const it of items?.items ?? []) {
    if (it.g === "material" && hash(it.id) < 0.5) inventory[it.id] ??= 1 + Math.floor(hash(`${it.id}n`) * 600);
  }
  const rec: Record<string, number> = {};
  const camps: Record<string, number> = {};
  for (const st of stages?.stages ?? []) {
    if (st.t === "CAMPAIGN") camps[st.id] = hash(st.id) < 0.85 ? 400 : 370;
    else if (st.t === "MAIN" || st.t === "SUB") { const h = hash(st.id); if (h < 0.94) rec[st.id] = h < 0.8 ? 3 : 2; }
  }
  return { ...me, profile: { ...me.profile, inventory, stages: rec, campaigns: camps } };
}

export default function MyInfo({ operators, extra, onShowOperator }: Props) {
  const { t } = useI18n();
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const me = useMe();
  const [login, setLogin] = useState(false);
  // 내보내기 — 공유용 요약 카드 이미지를 모달로 (me-share.tsx)
  const [share, setShare] = useState(false);
  if (!mounted) return <section className="me-page"><div className="tab-loading" aria-hidden /></section>;
  return (
    <section className="me-page" aria-labelledby="me-title">
      {/* 공유 카드 QR(#verify=…)로 들어오면 정품 인증 창을 띄운다 */}
      <MeVerify />
      <header className="me-head">
        <div className="me-title-row">
          <div><span className="section-no">MY ACCOUNT</span><h2 id="me-title">{t("내 정보")}</h2></div>
          {/* 내보내기 — 제목 바로 오른쪽 (사용자 지시 2026-10-04) */}
          {me && (
            <button type="button" className="me-sort me-export-btn" onClick={() => setShare(true)}>
              <span aria-hidden>⤓</span>{t("이미지로 내보내기")}
            </button>
          )}
        </div>
        {/* 로그인 전 = '로그인해서 내 정보 가져오기' → 모달, 로그인 뒤 = [데이터 지우기][다시 동기화] (사용자 지시 2026-10-04) */}
        {me ? <MeActions onLogin={() => setLogin(true)} /> : (
          <button type="button" className="import-action apply me-login-btn" onClick={() => setLogin(true)}>
            <span className="btn-icon" aria-hidden>⤓</span>{t("로그인해서 내 정보 가져오기")}
          </button>
        )}
      </header>
      {me ? <Dashboard me={me} operators={operators} extra={extra} onShowOperator={onShowOperator} share={share} onShareClose={() => setShare(false)} />
        : (
          // 로그인 전에도 무엇이 나오는지 보여 준다 — 화면을 모르면 아무도 로그인하지 않는다
          // (사용자 지적 2026-10-04). 예시 숫자는 오퍼 id 해시로 만든 가짜 계정이다.
          <div className="me-sample">
            <p className="me-sample-bar"><b>{t("예시 화면")}</b>{t("아래는 가상의 계정으로 채운 예시입니다 — 로그인하면 내 계정의 실제 데이터로 이렇게 정리됩니다.")}</p>
            <Dashboard me={sampleMe(operators)} demo operators={operators} extra={extra} onShowOperator={onShowOperator} />
          </div>
        )}
      {login && (
        <ModalWindow label={t("로그인해서 내 정보 가져오기")} className="operator-modal me-login-modal" onClose={() => setLogin(false)}>
          <LoginCard onDone={() => setLogin(false)} />
        </ModalWindow>
      )}
    </section>
  );
}

// 저장된 설정 완전 초기화가 지우는 것 — app/cloud-prefs.tsx SYNC 와 같은 목록 (제안 열람 코드는 남긴다)
const RESET_ITEMS = [
  "라이트·다크 모드", "사이트 언어", "미래시 보기", "내 정보 맞춤 칸", "내 정보 카드 순서", "통합전략 지도판 카드 자리", "스토리 읽은 위치",
  "리더기 글자·삽화 크기·소리", "인프라 자동편성기 — 보유 오퍼 설정·편성·우선순위·배치·재활용소",
  "공채 '4★ 이상 확정 조합만'", "갤러리 스포일러 가리기", "NEW 배지 본 기록",
];
/** 제목 오른쪽 — 저장된 설정 완전 초기화 · 로그아웃 · 다시 동기화. 이 탭에서 로그인한 적이 없으면(토큰 없음) 동기화는 로그인 창을 연다 */
function MeActions({ onLogin }: { onLogin: () => void }) {
  const { t } = useI18n();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<AccountStep | "start">("start");
  const [err, setErr] = useState<string | null>(null);
  const resync = async () => {
    const tok = meToken();
    if (!tok) { onLogin(); return; }   // 로그인 창에도 같은 주의문이 있다
    // 동기화 = 게임 서버에 새 접속 → 게임 쪽 접속이 끊긴다. 바로 보내지 말고 한 번 묻는다 (사용자 요청 2026-10-05)
    // 다시 로그인 — 다른 계정·서버로 바꾸거나 저장된 로그인이 이상할 때 (사용자 요청 2026-10-06)
    const choice = await confirm({
      message: t("다시 동기화하면 게임 접속이 끊깁니다 — 게임을 하고 있다면 저장한 뒤에 진행하세요. 계정에는 아무 문제가 없고, 게임을 다시 실행하면 그대로 접속됩니다."),
      confirmLabel: t("동기화하기"),
      altLabel: t("다시 로그인"),
    });
    if (choice === "alt") { onLogin(); return; }
    if (!choice) return;
    setErr(null); setBusy(true); setStep("start");
    try { saveMe(await syncAccount(tok.token, tok.server, setStep), tok.server, "me_sync"); }
    catch (caught) {
      const raw = caught instanceof AccountError ? caught.code : "internal";
      const code = /^u8 4\d\d$/.test(raw) ? "token-expired" : raw;
      // 게임 점검 — 로그인 정보는 그대로 두고 알림 창으로 (사용자 지시 2026-10-14 "점검 문구도 모달 같은 걸로")
      if (code === "maintenance") {
        void confirm({ alert: true, title: t(MAINTENANCE_TITLE),
          message: t(MAINTENANCE_TEXT, { window: (caught as AccountError).window ?? "" }) });
        return;
      }
      setErr(t((tok.server === "cn" || tok.server === "bili" ? cnErrorText : accountErrorText)(code), { code }));
      // 토큰이 죽었으면(만료·다른 기기 로그인) 지우고 로그인 창으로 — 요스타 단계에서 4xx 가 와도 같은 뜻이다
      if (code === "token-expired") { dropMeToken(); onLogin(); }
    } finally { setBusy(false); }
  };
  // 로그아웃 — 종전 '데이터 지우기'. 저장된 설정은 지우지 않는다는 걸 이름·문구로 분명히 (사용자 지시 2026-10-14)
  const wipe = async () => {
    if (!(await confirm({ title: t("로그아웃"), message: t("이 브라우저에서 게임 계정 연결을 끊습니다. 내 정보 화면과 오퍼 도감·아이템 도감의 보유 표시가 사라지고 설정 동기화가 멈춥니다. 저장된 설정은 지워지지 않으며, 다시 로그인하면 그대로 이어집니다."), confirmLabel: t("로그아웃") }))) return;
    clearMe();
  };
  // 저장된 설정 완전 초기화 — 계정 저장소와 이 브라우저의 설정을 기본값으로 (되돌릴 수 없어 무엇이 사라지는지 다 적는다)
  const [resetting, setResetting] = useState(false);
  const resetAll = async () => {
    if (!(await confirm({ title: t("저장된 설정 완전 초기화"), danger: true, confirmLabel: t("초기화"),
      // 문단·목록으로 — 한 덩어리 줄글이라 읽히지 않았다 (사용자 지적 2026-10-14). 확인 창 본문은 pre-line 이라 \n 이 그대로 줄바꿈
      message: [
        t("이 계정에 저장된 UID·설정과 이 브라우저의 설정을 모두 지우고 기본값으로 되돌립니다."),
        t("다른 기기에서도 더 이상 이어지지 않으며, 되돌릴 수 없습니다."),
        "",
        t("사라지는 것"),
        ...RESET_ITEMS.map((x) => `• ${t(x)}`),
        "",
        t("이 브라우저는 로그아웃되고, 제안 게시판의 내 제안(열람 코드)만 남습니다."),
      ].join("\n") }))) return;
    setResetting(true);
    // 로그아웃까지 — 계정 저장소를 지운 뒤 이 브라우저의 계정 연결도 끊는다 (사용자 지시 2026-10-14 "완전 삭제는 로그아웃도")
    try { await resetCloudPrefs(clearMe); } catch { setResetting(false); setErr(t("초기화하지 못했습니다 — 잠시 뒤 다시 시도해 주세요.")); }
  };
  return (
    <div className="me-head-actions">
      {dialog}
      <button type="button" className="import-action" disabled={resetting} onClick={() => void resetAll()}
        title={t("이 계정에 저장된 설정과 이 브라우저의 설정을 모두 기본값으로 되돌립니다")}><span className="btn-icon" aria-hidden>↺</span>{t("저장된 설정 완전 초기화")}</button>
      <button type="button" className="import-action" onClick={() => void wipe()}><span className="btn-icon" aria-hidden>⏻</span>{t("로그아웃")}</button>
      <button type="button" className="import-action apply" disabled={busy} onClick={() => void resync()}>
        <span className="btn-icon" aria-hidden>⟳</span>{busy ? t("가져오는 중…") : t("다시 동기화")}
      </button>
      {busy && <div className="me-sync-steps"><AccountSteps t={t} step={step} sync server={meToken()?.server} /></div>}
      {err && <p className="import-msg error">{err}</p>}
    </div>
  );
}

function LoginCard({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  return (
    <div className="me-login">
      <h3>{t("로그인해서 내 정보 가져오기")}</h3>
      <p className="me-lead">{rich(t("요스타 계정으로 로그인하면 **내 계정의 오퍼·창고·진행 상황**을 받아 와 이 화면에 정리하고, 사이트 전체에 함께 반영합니다 — 오퍼 도감에 보유·육성 현황, 인프라 자동편성기에 보유 오퍼, 아이템 도감에 창고 수량, 공개채용 도우미에 미보유·잠재 표시가 붙습니다."))}</p>
      {/* 설정 동기화 안내 (app/cloud-prefs.tsx, 2026-10-14) */}
      <p className="me-lead">{rich(t("로그인하면 **내 정보 맞춤 칸 구성·스토리 읽은 위치**를 이 게임 계정(UID)으로 저장해 두고, 다른 기기·브라우저에서 로그인해도 그대로 이어집니다."))}</p>
      <p className="import-warn">{rich(t("**주의: 가져오는 순간 게임 접속이 끊깁니다.** 데이터를 받으려면 게임 서버에 접속을 새로 열어야 하고, 명일방주는 계정당 접속을 하나만 허용하기 때문입니다. 게임을 하지 않을 때 쓰세요 — 계정에는 아무 문제가 없고, 다시 실행하면 그대로 접속됩니다."))}</p>
      <AccountLoginForm t={t} onAccount={onDone} submitLabel={t("로그인해서 내 정보 가져오기")}
        privacy={t("이메일과 인증코드는 저장하지 않습니다. 받은 계정 데이터는 이 브라우저 안에만 남고, 언제든 이 화면에서 지울 수 있습니다.")} />
    </div>
  );
}

/** 오퍼 목록 모달 한 줄 */
type ListEntry = { id: string; sub: string };
type OpenList = (title: string, entries: ListEntry[]) => void;

// ── 대시보드 ────────────────────────────────────────────────
function Dashboard({ me: given, demo, operators, onShowOperator, share, onShareClose }: { me: MeData; demo?: boolean; share?: boolean; onShareClose?: () => void } & Props) {
  const { locale } = useI18n();
  const [now] = useState(() => Date.now());
  const [items, setItems] = useState<ItemDoc | null>(null);
  const [stages, setStages] = useState<StageDoc | null>(null);
  // 중섭 계정이면 한섭 아이템 도감에 없는 신재료(액화 고에너지 가스 등)를 미래시 문서에서 더한다 — 안 그러면 창고에서
  // 빠졌다 (직영 기증 데이터 2026-10-06). 한·일·글섭 계정은 미래시 문서를 받지 않는다
  const cnAccount = given.server === "cn" || given.server === "bili";
  useEffect(() => {
    let alive = true;
    void Promise.all([loadItems<ItemDoc>(locale), cnAccount ? loadFutureDex(locale) : null]).then(([d, fut]) => {
      if (!alive) return;
      if (!fut) { setItems(d); return; }
      const have = new Set(d.items.map((i) => i.id));
      setItems({ ...d, items: [...d.items, ...fut.items.filter((i) => !have.has(i.id))] });
    });
    void loadStages(locale).then((d) => { if (alive) setStages(d); });
    return () => { alive = false; };
  }, [locale, cnAccount]);
  const me = useMemo(() => (demo ? sampleFill(given, items, stages) : given), [demo, given, items, stages]);

  // 창고·작전 모달 — 아이템 도감과 같은 규약으로 겹쳐 띄운다 (자기 창 위에 작전·적이 쌓인다)
  const [openItem, setOpenItem] = useState<DexItem | null>(null);
  const [subStage, setSubStage] = useState<StageView | null>(null);
  const [stageRaise, setStageRaise] = useState(0);
  const [subEnemy, setSubEnemy] = useState<Enemy | null>(null);
  const [enMap, setEnMap] = useState<Map<string, Enemy> | null>(null);
  const [enStages, setEnStages] = useState<EnemyStages | null>(null);
  const [enemyRaise, setEnemyRaise] = useState(0);
  // 숫자 칸을 누르면 뜨는 오퍼 목록
  const [list, setList] = useState<{ title: string; entries: ListEntry[]; key: number } | null>(null);
  const openList: OpenList = (title, entries) => setList((cur) => ({ title, entries, key: (cur?.key ?? 0) + 1 }));
  const itemById = useMemo(() => new Map((items?.items ?? []).flatMap((i) => [[i.id, i] as const, ...(i.alt ?? []).map((a) => [a, i] as const)])), [items]);
  const openStage = (sid: string) => {
    setStageRaise((k) => k + 1);
    void Promise.all([loadStages(locale), loadEnemyStats()]).then(([d, stats]) => {
      const st = d.stages.find((x) => x.id === sid);
      setSubStage(st ? viewOf(d, st, stats) : null);
    });
  };
  const openEnemy = (eid: string) => {
    setEnemyRaise((k) => k + 1);
    void loadEnemies(locale).then((m) => { setEnMap(m); setSubEnemy(m.get(eid) ?? null); });
    void loadEnemyStages(locale).then(setEnStages);
  };

  // 모을 수 있는 한섭 오퍼만 — 미실장(중섭 선행)과 임시 인원(예비 인원 등 15명)은 분모에서 뺀다
  // 전체 오퍼(보유율의 분모) — 중섭 계정은 한섭 미실장 오퍼도 갖고 있어 그것까지 센다. 안 그러면 보유 416/410 = 101% 가 됐다
  // (2026-10-06). 한·일·글섭 계정은 종전대로 한섭에 나온 오퍼만
  const released = useMemo(() => operators.filter((op) => (cnAccount || !op.unreleased) && isCollectible(op.id)), [operators, cnAccount]);
  const opById = useMemo(() => new Map(operators.map((op) => [op.id, op])), [operators]);
  const mine = meChars(me) ?? new Map<string, AccountChar>();
  const owned = me.chars.filter((c) => opById.has(c.id) && isCollectible(c.id));

  return (
    <>
      <div className="me-grid">
        <div className="me-col me-col-side">
          <ProfileCard me={me} now={now} opById={opById} demo={demo} />
          <Wallet me={me} items={items} onOpen={(i) => setOpenItem(i)} />
          <Support me={me} opById={opById} onShowOperator={onShowOperator} />
          <Rooms me={me} />
        </div>
        {/* 오른쪽 열 — 카드 머리의 손잡이(⠿)로 끌어 순서를 바꾼다, 순서는 설정 동기화로 이어진다 (사용자 지시 2026-10-15, app/me-order.tsx) */}
        <SortColumn className="me-col me-col-main" blocks={{
          summary: <Kpis owned={owned} released={released} opById={opById} me={me} onList={openList} demo={demo} />,
          resume: <Paused me={me} opById={opById} onShowOperator={onShowOperator} onOpenStage={openStage} items={items} onOpenItem={(i) => setOpenItem(i)} stages={stages} />,
          recruit: <RecruitPool mine={mine} opById={opById} onShowOperator={onShowOperator} />,
          paradox: <Paradox me={me} mine={mine} released={released} onShowOperator={onShowOperator} />,
          // 진행 상황·친구·최근 얻은 오퍼·창고는 바로 볼 일이 적어 버튼으로 접고 누르면 창으로 (사용자 지시 2026-10-11) — 묶음 안에서 좌우로도 옮긴다
          drawers: <Drawers me={me} now={now} owned={owned} opById={opById} stages={stages} items={items}
            onOpenStage={openStage} onOpenItem={(i) => setOpenItem(i)} onShowOperator={onShowOperator} />,
          // 성급별 육성은 기본 순서에서 맨 밑 (사용자 지시 2026-10-15)
          rarity: <RarityTable owned={owned} released={released} opById={opById} onList={openList} />,
        }} />
      </div>

      {share && onShareClose && <MeShare me={me} owned={owned} released={released} opById={opById} stages={stages} items={items} onClose={onShareClose} />}
      {list && (
        <ModalWindow key={`ls-${list.key}`} label={list.title} className="operator-modal me-list-modal" onClose={() => setList(null)}>
          <OpListBody title={list.title} entries={list.entries} opById={opById} chars={mine} onShowOperator={onShowOperator} />
        </ModalWindow>
      )}
      {openItem && items && (
        <ModalWindow label={openItem.n} className="item-modal it-modal" onClose={() => setOpenItem(null)}>
          <ItemFile item={openItem} doc={items} onOpenStage={openStage} />
        </ModalWindow>
      )}
      {subStage && (
        <ModalWindow key={`st-${stageRaise}`} label={`${subStage.stage.code} ${subStage.stage.name}`}
          className="operator-modal st-modal" onClose={() => setSubStage(null)}>
          <StageFile view={subStage} onOpenEnemy={openEnemy}
            onOpenItem={(id) => { const i = itemById.get(id); if (i) setOpenItem(i); }} />
        </ModalWindow>
      )}
      {subEnemy && (
        <ModalWindow key={`en-${enemyRaise}`} label={subEnemy.name} className="operator-modal en-modal"
          onClose={() => setSubEnemy(null)}>
          <EnemyFile enemy={subEnemy} stagesDoc={enStages} onOpenEnemy={openEnemy}
            nameOf={(id) => enMap?.get(id)?.name} onOpenStage={openStage} />
        </ModalWindow>
      )}
    </>
  );
}

/** 이어하기 — 마지막 동기화 때 진행 중이던 통합전략·보안파견·생존연산 (사용자 요청 2026-10-11).
 *  카드는 콘텐츠마다 한 줄 칸만(편성이 늘면 카드가 길어지므로), 누르면 상세 모달. 게임 중 동기화는 클라를 튕기므로
 *  '멈춘 상태를 기록'하는 용도다. 통합전략 이름(층·엔딩·소장품·난이도)은 그 테마 데이터를 모달 열 때 받아 붙인다 */
type RogueItem = { id: string; name: string; usage?: string | null; func?: string | null; desc?: string | null; obtain?: string | null; iconId?: string; cn?: string };
type RogueDoc = { zones: { id: string; num: number; name: string }[]; endings: { id: string; name: string }[];
  relics: RogueItem[]; difficulties: { mode: string; grade: number; name: string }[];
  // 계정의 '소장품' 칸에는 분대·능동 도구·부품·사고 등도 같이 들어 있다 — 이름은 이 목록들에서도 찾는다 (2026-10-11 '키 이름으로 나온다')
  bands?: RogueItem[]; tools?: RogueItem[]; capsules?: RogueItem[]; exploreTools?: RogueItem[]; legacies?: RogueItem[]; buoys?: RogueItem[]; scraps?: RogueItem[];
  mechanics?: { label: string; items: RogueItem[] }[] };
const ROGUE_DOCS: Record<string, Record<string, () => Promise<{ default: unknown }>>> = {
  ko: { rogue_1: () => import("./data/rogue1.json"), rogue_2: () => import("./data/rogue2.json"), rogue_3: () => import("./data/rogue3.json"),
    rogue_4: () => import("./data/rogue4.json"), rogue_5: () => import("./data/rogue5.json"), rogue_6: () => import("./data/rogue6.json") },
  en: { rogue_1: () => import("./data/rogue1.en.json"), rogue_2: () => import("./data/rogue2.en.json"), rogue_3: () => import("./data/rogue3.en.json"),
    rogue_4: () => import("./data/rogue4.en.json"), rogue_5: () => import("./data/rogue5.en.json"), rogue_6: () => import("./data/rogue6.en.json") },
  ja: { rogue_1: () => import("./data/rogue1.ja.json"), rogue_2: () => import("./data/rogue2.ja.json"), rogue_3: () => import("./data/rogue3.ja.json"),
    rogue_4: () => import("./data/rogue4.ja.json"), rogue_5: () => import("./data/rogue5.ja.json"), rogue_6: () => import("./data/rogue6.ja.json") },
};

// 보안파견 맵 이름(세 언어)·배경 — scripts/build-tower.py (2026-10-17 사용자 "어느 맵인지도 안 나오고 배경도 없다").
// 배경은 게임 보안파견 화면의 맵 그림. 훈련장(tower_tr_*)은 그림이 없다
const TOWERS = towerNames as Record<string, { ko: string; en: string; ja: string }>;
// ?v= — R2 에 올리기 전에 열어 본 주소의 404 가 엣지에 남았다 (2026-10-17). 그림을 바꾸면 올린다
const TOWER_ART_VER = "2026101701";
const towerBg = (id: string | null) => (id && /^tower_n_/.test(id) ? asset(`/tower/${id}.webp?v=${TOWER_ART_VER}`) : null);

function Paused({ me, opById, onShowOperator, onOpenStage, items, onOpenItem, stages }: { me: MeData; opById: Map<string, MeOp>; onShowOperator?: (id: string) => void;
  onOpenStage?: (id: string) => void; items?: ItemDoc | null; onOpenItem?: (i: DexItem) => void; stages?: StageDoc | null }) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState<"rogue" | "tower" | "sandbox" | null>(null);
  // 세 칸은 늘 자리에 둔다 — 진행 중이 아니면 '진행 아님' (사용자 지시 2026-10-17). 종전엔 진행 중인 것만 나와 칸 수·자리가 바뀌었다
  const pg = me.profile?.progress;
  const r = pg?.rogue, tw = pg?.tower, sb = pg?.sandbox;
  const idle = (label: string) => (
    <div className="me-resume-idle"><b>{t(label)}</b><span>{t("진행 아님")}</span></div>
  );
  const topic = r ? t(TOPICS.find((x) => x.id === r.theme)?.name ?? r.theme ?? "?") : "";
  const towerName = tw?.tower ? TOWERS[tw.tower]?.[locale === "en" ? "en" : locale === "ja" ? "ja" : "ko"] ?? null : null;
  const tDoc = useTowerDoc();
  const tp = me.profile?.tower;
  // 이 맵에 저장해 둔 편성 — 모은 오퍼 중 여기 없는 오퍼가 판 중에 '추가 모집'한 오퍼다
  const squadIds = new Set((tw?.tower ? tp?.season?.slots[tw.tower] ?? [] : []).flatMap((sl) => sl.squad.map((m) => m.id)));
  // 히든 훈장(재시도 없이 6층까지) 얻은 수 — 칸에 한 줄로
  const hiddenIds = tDoc ? Object.values(tDoc.medals).map((m) => m.hidden?.[0]).filter(Boolean) as string[] : [];
  const hiddenTotal = hiddenIds.length;
  const hiddenGot = hiddenIds.filter((id) => tp?.medals?.includes(id)).length;
  // 진행 중이 아닐 때 칸 바탕 — 이번 시즌에 열린 첫 맵의 그림 (사용자 지적 2026-10-17 "배경 이미지가 안 나와")
  const seasonBg = towerBg((tp?.season ? tDoc?.seasons[tp.season.id]?.[1]?.[0] : null) ?? null);
  const twBg = towerBg(tw?.tower ?? null);
  return (
    <Card no="RESUME" title={t("이어하기")} aside={<small>{t("마지막 동기화 때 진행 중이던 콘텐츠")}</small>}>
      <div className="me-resume">
        {r && (
          // 카드 바탕에 그 테마의 대표 그림을 은은하게 (사용자 지시 2026-10-11) — 통합전략 페이지 배경과 같은 kvN
          <button type="button" className="has-bg" onClick={() => setOpen("rogue")}
            style={r.theme ? { ["--bg" as string]: `url(${asset(`/rogue/kv${r.theme.split("_")[1]}.webp`)})` } : undefined}>
            <b>{t("통합전략")}</b><span>{topic}</span>
            <em>{rogueFloor(r) != null ? `${t("{n}층", { n: rogueFloor(r)! })} · ` : ""}{t("난이도 {n}", { n: r.grade })} · HP {r.hp}/{r.maxHp}</em>
          </button>
        )}
        {!r && idle("통합전략")}
        {tw && (
          <button type="button" className={twBg ? "has-bg" : undefined} onClick={() => setOpen("tower")}
            style={twBg ? { ["--bg" as string]: `url(${twBg})` } : undefined}>
            <b>{t("보안파견")}</b><span>{towerName ?? (tw.hard ? t("하드") : t("일반"))}</span>
            <em>{towerName ? `${tw.hard ? t("하드") : t("일반")} · ` : ""}{t("{n}층", { n: tw.coord + 1 })}</em>
          </button>
        )}
        {!tw && (tp ? (
          <button type="button" className={`me-resume-idle${seasonBg ? " has-bg" : ""}`} onClick={() => setOpen("tower")}
            style={seasonBg ? { ["--bg" as string]: `url(${seasonBg})` } : undefined}>
            <b>{t("보안파견")}</b><span>{t("진행 아님")}</span>
            {hiddenTotal > 0 && <em>{t("히든 훈장 {n}/{total}", { n: hiddenGot, total: hiddenTotal })}</em>}
          </button>
        ) : idle("보안파견"))}
        {sb ? (
          <button type="button" className="has-bg" onClick={() => setOpen("sandbox")}
            style={{ ["--bg" as string]: `url(${asset("/sandbox/world/sandbox_1.webp")})` }}>
            <b>{t("생존연산")}</b><span>{t("사막 이야기")}</span>
            <em>{t("{n}일째", { n: sb.day })} · {t("행동력")} {sb.ap}/{sb.maxAp}</em>
          </button>
        ) : idle("생존연산")}
      </div>
      {open === "rogue" && r && <ResumeRogue r={r} topic={topic} opById={opById} onShowOperator={onShowOperator} onClose={() => setOpen(null)} />}
      {open === "tower" && (tw || tp) && (
        <ModalWindow label={t("보안파견")} className="operator-modal me-resume-modal" onClose={() => setOpen(null)}>
          <div className="me-resume-body">
            {tw ? (<>
            <h3>{t("보안파견")}{towerName ? ` · ${towerName}` : ""}{tw.hard ? ` · ${t("하드")}` : ""}</h3>
            {twBg && <img className="me-resume-tower" src={twBg} alt="" loading="lazy" />}
            <dl className="me-resume-facts">
              <dt>{t("진행")}</dt><dd>{t("{n}층", { n: tw.coord + 1 })}</dd>
              <dt>{t("시작")}</dt><dd>{fmtWhen(tw.start)}</dd>
              {tw.god && <><dt>{t("리더 카드")}</dt><dd title={tDoc?.cards[tw.god.id]?.[1]}>{tDoc?.cards[tw.god.id]?.[0] ?? tw.god.id}
                {tw.god.sub ? ` · ${tDoc?.cards[tw.god.sub]?.[0] ?? tw.god.sub}` : ""}</dd></>}
              {tw.traps && tw.traps.length > 0 && <><dt>{t("함정")}</dt><dd>{tw.traps.length}</dd></>}
            </dl>
            {/* 직군별 전술 장비 (2026-10-17) */}
            {tw.tactical && Object.keys(tw.tactical).length > 0 && (
              <>
                <h4>{t("전술 장비")}</h4>
                <dl className="me-resume-facts">
                  {JOB_ORDER.filter((j) => tw.tactical![j]).map((j) => (
                    <React.Fragment key={j}><dt>{t(JOB_KO[j] ?? j)}</dt><dd>{tDoc?.tactical[tw.tactical![j]]?.[2] && <b className="me-tac-ab">{tDoc.tactical[tw.tactical![j]][2]}</b>}{tDoc?.tactical[tw.tactical![j]]?.[1] ?? tw.tactical![j]}</dd></React.Fragment>
                  ))}
                </dl>
              </>
            )}
            {/* 이번 판에 모은 오퍼 카드 */}
            {tw.cards && tw.cards.length > 0 && (
              <>
                <h4>{t("모은 오퍼")} {tw.cards.length}</h4>
                <ul className="me-ops dense">
                  {tw.cards.map((c, i) => {
                    const op = opById.get(c.id);
                    if (!op) return null;
                    const extra = squadIds.size > 0 && !squadIds.has(c.id);
                    return (
                      <li key={`${c.id}-${i}`}>
                        <button type="button" onClick={() => onShowOperator?.(c.id)} title={op.name}>
                          <span className={`me-op-face r${op.rarity}`}><img src={avatarOf(c.id)} alt="" width={46} height={46} loading="lazy" />
                            {extra && <i className="me-op-extra">{t("추가 모집")}</i>}</span>
                          <span className="me-op-name">{op.name}</span>
                          {c.level > 0 && <em>{eliteText(locale, c.elite, c.level)}</em>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            </>) : <h3>{t("보안파견")} <small className="me-note">{t("진행 아님")}</small></h3>}
            <a className="me-tower-go" href={`${locale === "ko" ? "" : `/${locale}`}/sss`}>{t("보안파견 가이드로")} ›</a>
            {/* 맵 기록·훈장·시즌 임무·저장한 편성 — 진행 여부와 상관없이 (2026-10-17) */}
            <TowerInfo me={me} opById={opById} onShowOperator={onShowOperator} onOpenStage={onOpenStage} items={items} onOpenItem={onOpenItem} stages={stages} />
          </div>
        </ModalWindow>
      )}
      {open === "sandbox" && sb && <ResumeSandbox sb={sb} me={me} opById={opById} onShowOperator={onShowOperator} onClose={() => setOpen(null)} />}
    </Card>
  );
}

/** 통합전략 층 — 워커가 구역 순번(0부터)을 보낸다. 2026-10-11 첫 판 워커는 지도 구역 키(1000 등)를 보내 '1001층'으로 보였다 —
 *  그런 옛 기록(zoneId 없음·100 이상)은 층을 모르는 것으로 둔다(다시 동기화하면 채워진다) */
// ⚠ 실계정에서 구역 순번(index)도 1000 단위로 왔다(1층 = 1000, 사용자 화면 '1001층' 2026-10-11) — 1000 이상이면 천의 자리가 층이다
const rogueFloor = (r: { zone: number; zoneId?: string | null }): number | null =>
  r.zone >= 1000 ? Math.floor(r.zone / 1000) : r.zone >= 100 ? null : r.zone + 1;

// 시작 시각은 연도까지 글로 — '10. 11.' 만으로는 못 알아본다 (사용자 지시 2026-10-11). 예: 2026년 10월 11일 21:43
const fmtWhen = (sec: number) => (sec ? new Date(sec * 1000).toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—");

/** 생존연산 '사막 이야기' 상세 (사용자 요청 2026-10-11 "생존연산도 아주 자세하게") — 이름·아이콘은 생존연산 도감 데이터(sandbox.json v2)를
 *  모달을 열 때 받아 붙인다. 가방 수량은 profile.sandbox(재료·요리·제작물), 진행 상태는 profile.progress.sandbox */
type SbDoc = { v2: { items: Record<string, [string, string, number, string, string?]>; zones: Record<string, string>; enemyNames: Record<string, string> } };
const SB_DOCS: Record<string, () => Promise<{ default: unknown }>> = {
  ko: () => import("./data/sandbox.json"), en: () => import("./data/sandbox.en.json"), ja: () => import("./data/sandbox.ja.json"),
};
/** 이어하기 모달의 수치 칸 — 이름표 · 큰 숫자 · (최대값이 있으면) 막대 */
function StatTile({ label, value, max, tone, extra }: { label: string; value: string; max?: number; tone?: string; extra?: string }) {
  const n = Number(value);
  return (
    <div className={`me-rx-stat${tone ? ` ${tone}` : ""}`}>
      <span className="lb">{label}</span>
      <b>{value}{max ? <small> / {max}</small> : null}</b>
      {max ? <i className="bar"><i style={{ width: `${Math.max(0, Math.min(100, (n / max) * 100))}%` }} /></i> : null}
      {extra && <em>{extra}</em>}
    </div>
  );
}

function ResumeSandbox({ sb, me, opById, onShowOperator, onClose }: {
  sb: NonNullable<NonNullable<AccountProfile["progress"]>["sandbox"]>; me: MeData; opById: Map<string, MeOp>;
  onShowOperator?: (id: string) => void; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [doc, setDoc] = useState<SbDoc["v2"] | null>(null);
  useEffect(() => {
    let alive = true;
    (SB_DOCS[locale] ?? SB_DOCS.ko)().then((m) => { if (alive) setDoc((((m as { default?: unknown }).default ?? m) as SbDoc).v2); }).catch(() => {});
    return () => { alive = false; };
  }, [locale]);
  const nameOf = (id: string) => doc?.items[id]?.[0] ?? id;
  const icon = (id: string) => asset(`/sandbox/item/${id}.webp`);
  const bag = me.profile?.sandbox;
  const hide = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.visibility = "hidden"; };
  const itemGrid = (title: string, rec: Record<string, number> | undefined) => {
    const rows = Object.entries(rec ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return null;
    return (
      <details className="me-resume-fold" open>
        <summary>{title} <em>{rows.length}</em></summary>
        <ul className="me-resume-items">
          {rows.map(([id, n]) => (
            <li key={id} title={doc?.items[id]?.[1] ?? undefined}>
              <img src={icon(id)} alt="" loading="lazy" decoding="async" onError={hide} />
              <span>{nameOf(id)}</span><b>{n.toLocaleString()}</b>
            </li>
          ))}
        </ul>
      </details>
    );
  };
  const modeLabel = sb.challenge ? t("도전") : sb.explore ? t("탐험") : t("일반");
  const squads = sb.squads ?? [];
  return (
    <ModalWindow label={`${t("생존연산")} · ${t("사막 이야기")}`} className="operator-modal me-resume-modal" onClose={onClose}>
      <div className="me-resume-body">
        <header className="me-rx-hero" style={{ ["--bg" as string]: `url(${asset("/sandbox/world/sandbox_1.webp")})` }}>
          <small>{t("생존연산")}</small>
          <h3>{t("사막 이야기")}</h3>
          <p className="loc"><b>{t("{n}일째", { n: sb.day })}</b>{sb.maxDay ? ` / ${sb.maxDay}` : ""}</p>
          <p className="chips">
            <span className="diff">{modeLabel}{sb.rift ? <em>{t("균열")}</em> : null}</span>
            {sb.season && <span>{t("계절")} <b>{t("남은 {n}일", { n: sb.season.remain })}</b></span>}
            {sb.best ? <span>{t("도전 최고 기록")} <b>{t("{n}일", { n: sb.best })}</b></span> : null}
          </p>
        </header>
        <div className="me-rx-stats">
          <StatTile label={t("행동력")} value={`${sb.ap}`} max={sb.maxAp} tone="ap" />
          {sb.baseLv != null && <StatTile label={t("거점 레벨")} value={`${sb.baseLv}`} extra={[sb.portable ? t("휴대 거점") : "", sb.outpost ? t("전초기지") : ""].filter(Boolean).join(" · ") || undefined} />}
          {sb.techUnlock != null && <StatTile label={t("기술")} value={`${sb.techUnlock}`} extra={`${t("기술 점수")} ${sb.techToken ?? 0}`} />}
          {sb.drink != null && <StatTile label={t("음료")} value={`${sb.drink}`} />}
        </div>
        {sb.zones && Object.keys(sb.zones).length > 0 && (
          <>
            <h4>{t("지역")}</h4>
            <ul className="me-resume-zones">
              {Object.entries(sb.zones).sort().map(([id, z]) => (
                <li key={id} className={z.state ? "" : "dim"}><b>{doc?.zones[id] ?? id}</b><small>{z.weather ? t("날씨 {n}단계", { n: z.weather }) : t("맑음")}</small></li>
              ))}
            </ul>
          </>
        )}
        {(sb.bossKill?.length ?? 0) > 0 && (
          <>
            <h4>{t("처치한 보스")} <em>{sb.bossKill!.length}</em></h4>
            <p className="me-resume-tags">{sb.bossKill!.map((id) => <span key={id}>{doc?.enemyNames[id] ?? id}</span>)}</p>
          </>
        )}
        {squads.map((q, qi) => (
          <details key={qi} className="me-resume-fold" open>
            <summary>{t("분대 {n}", { n: qi + 1 })} <em>{q.chars.length}</em></summary>
            <div className="me-resume-troop sm">
              {q.chars.map((id, i) => (
                <button key={i} type="button" onClick={() => onShowOperator?.(id)}>
                  <img src={asset(`/avatars/${id}.webp`)} alt="" loading="lazy" decoding="async" />
                  <b>{opById.get(id)?.name ?? id}</b>
                </button>
              ))}
            </div>
            {q.tools.length > 0 && <p className="me-resume-tags">{q.tools.map((id, i) => <span key={i}>{nameOf(id)}</span>)}</p>}
          </details>
        ))}
        {itemGrid(t("가방 재료"), bag?.material)}
        {itemGrid(t("만들어 둔 요리"), bag?.food)}
        {itemGrid(t("건물"), bag?.building)}
        {itemGrid(t("전술 설치물"), bag?.tactical)}
        {itemGrid(t("동물"), bag?.animal)}
      </div>
    </ModalWindow>
  );
}

function ResumeRogue({ r, topic, opById, onShowOperator, onClose }: {
  r: NonNullable<NonNullable<AccountProfile["progress"]>["rogue"]>; topic: string; opById: Map<string, MeOp>;
  onShowOperator?: (id: string) => void; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [doc, setDoc] = useState<RogueDoc | null>(null);
  useEffect(() => {
    const load = r.theme ? (ROGUE_DOCS[locale] ?? ROGUE_DOCS.ko)[r.theme] : undefined;
    if (!load) return;
    let alive = true;
    load().then((m) => { if (alive) setDoc(((m as { default?: unknown }).default ?? m) as RogueDoc); }).catch(() => {});
    return () => { alive = false; };
  }, [r.theme, locale]);
  const zone = doc?.zones.find((z) => z.id === r.zoneId) ?? doc?.zones.find((z) => z.num === rogueFloor(r) && !("variant" in z && (z as { variant?: boolean }).variant));
  const ending = r.toEnding ? doc?.endings.find((e) => e.id === r.toEnding) : null;
  const diff = doc?.difficulties.find((d) => d.grade === r.grade && (!r.mode || d.mode === r.mode)) ?? doc?.difficulties.find((d) => d.grade === r.grade);
  const [pickRelic, setPickRelic] = useState<number | null>(null);
  const relicById = new Map<string, RogueItem>();
  // 분대는 소장품이 아니다 (사용자 지적 2026-10-17) — 계정의 소장품 칸에 같이 들어 있어 따로 떼어 머리 줄에 둔다
  const bandIds = new Set((doc?.bands ?? []).map((b) => b.id));
  const relicIdx = r.relics.map((id, i) => [id, i] as const).filter(([id]) => !bandIds.has(id));
  const bandIdx = r.relics.map((id, i) => [id, i] as const).filter(([id]) => bandIds.has(id));
  if (doc) {
    for (const list of [doc.relics, doc.bands, doc.tools, doc.capsules, doc.exploreTools, doc.legacies, doc.buoys, doc.scraps, ...(doc.mechanics ?? []).map((m) => m.items)]) {
      for (const x of list ?? []) if (x?.id && !relicById.has(x.id)) relicById.set(x.id, x);
    }
  }
  return (
    <ModalWindow label={`${t("통합전략")} · ${topic}`} className="operator-modal me-resume-modal" onClose={onClose}>
      <div className="me-resume-body">
        {/* 머리 — 테마 그림 위에 이름·위치·난이도·목표 엔딩, 아래 수치는 칸마다 큰 숫자 + 막대 (사용자 지시 2026-10-11 "못생겼다, 예쁘게") */}
        <header className="me-rx-hero" style={r.theme ? { ["--bg" as string]: `url(${asset(`/rogue/kv${r.theme.split("_")[1]}.webp`)})` } : undefined}>
          <small>{t("통합전략")} · {t("시작")} {fmtWhen(r.start)}</small>
          <h3>{topic}</h3>
          {/* 그 테마 가이드로 (사용자 요청 2026-10-17) */}
          {r.theme && <a className="me-rx-go" href={`${locale === "ko" ? "" : `/${locale}`}/rogue/is${r.theme.split("_")[1]}`}>{t("이 테마 가이드로")} ›</a>}
          <p className="loc">{zone ? <><b>{t("{n}층", { n: zone.num })}</b> {zone.name}</> : rogueFloor(r) != null ? <b>{t("{n}층", { n: rogueFloor(r)! })}</b> : t("다시 동기화하면 보입니다")}</p>
          <p className="chips">
            <span className="diff">{t("난이도")} <b>{r.grade}</b>{diff ? <em>{diff.name}</em> : null}</span>
            <span>{t("목표 엔딩")} <b>{ending ? ending.name : r.toEnding ? "—" : t("정하지 않음")}</b></span>
            {bandIdx.map(([id, i]) => (
              <button key={id} type="button" className="band" onClick={() => setPickRelic(i)}>
                <img src={asset(`/rogue/relic/${relicById.get(id)?.iconId ?? id}.webp`)} alt="" loading="lazy" decoding="async"
                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
                {t("분대")} <b>{relicById.get(id)?.name ?? id}</b>
              </button>
            ))}
          </p>
        </header>
        <div className="me-rx-stats">
          <StatTile label="HP" value={`${r.hp}`} max={r.maxHp} tone="hp" extra={r.shield ? `${t("실드")} +${r.shield}` : undefined} />
          <StatTile label={t("오리지늄각뿔")} value={`${r.gold}`} tone="gold" />
          <StatTile label={t("분대 레벨")} value={`${r.level}`} />
          {r.popMax > 0 && <StatTile label={t("인원")} value={`${r.popCost}`} max={r.popMax} />}
        </div>
        {/* 편성·소장품은 접었다 펼 수 있게 — 몇십 개면 모달이 길어진다 (사용자 지시 2026-10-11). 위 요약은 늘 보인다 */}
        <details className="me-resume-fold" open>
        <summary>{t("편성")} <em>{r.troop.length}</em></summary>
        <div className="me-resume-troop sm">
          {r.troop.map((c, i) => (
            <button key={i} type="button" onClick={() => onShowOperator?.(c.id)}>
              <img src={asset(`/avatars/${c.id}.webp`)} alt="" loading="lazy" decoding="async" />
              <b>{opById.get(c.id)?.name ?? c.id}</b>
              <small>E{c.elite} · Lv.{c.level}</small>
            </button>
          ))}
        </div>
        </details>
        {/* 소장품 — 아이콘 + 이름 격자(그림만으론 모른다), 누르면 상세 모달 (사용자 지시 2026-10-11) */}
        <details className="me-resume-fold" open>
        <summary>{t("소장품")} <em>{relicIdx.length}</em></summary>
        <ul className="me-resume-relic-grid">
          {relicIdx.map(([id, i]) => {
            const rel = relicById.get(id);
            return (
              <li key={i}>
                <button type="button" title={rel?.usage ?? rel?.func ?? undefined} onClick={() => setPickRelic(i)}>
                  <span className="ico"><img src={asset(`/rogue/relic/${rel?.iconId ?? id}.webp`)} alt="" loading="lazy" decoding="async"
                    onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /></span>
                  <span className="nm">{rel?.name ?? id}</span>
                </button>
              </li>
            );
          })}
        </ul>
        </details>
        {pickRelic != null && r.relics[pickRelic] && (() => {
          const id = r.relics[pickRelic];
          const rel = relicById.get(id);
          return (
            <ModalWindow label={rel?.name ?? id} className="operator-modal me-relic-modal" onClose={() => setPickRelic(null)}>
              <div className="me-relic-detail">
                <img src={asset(`/rogue/relic/${rel?.iconId ?? id}.webp`)} alt="" />
                <div>
                  <h3>{rel?.name ?? id}{rel?.cn && rel.cn !== rel.name && <small lang="zh">{rel.cn}</small>}</h3>
                  {(rel?.usage ?? rel?.func) && <p className="use">{rel?.usage ?? rel?.func}</p>}
                  {rel?.desc && <p className="desc">{rel.desc}</p>}
                  {rel?.obtain && <p className="obt">{t("획득")}: {rel.obtain}</p>}
                  {!rel && <p className="desc">{t("이 테마 데이터에서 찾지 못한 항목입니다.")}</p>}
                </div>
              </div>
            </ModalWindow>
          );
        })()}
      </div>
    </ModalWindow>
  );
}

function Card({ no, title, aside, className, children }: { no: string; title: string; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`me-card${className ? ` ${className}` : ""}`}>
      <header className="me-card-head">
        <div><span className="section-no">{no}</span><h3><SortHandle>{title}</SortHandle></h3></div>
        {aside && <div className="me-card-aside">{aside}</div>}
      </header>
      {/* 손잡이는 이 카드 머리에만 — 안쪽 카드(창 안 등)엔 안 생기게 끊는다 */}
      <NoSortHandle>{children}</NoSortHandle>
    </section>
  );
}

/** '전부 보기' 창 — 접힌 목록의 전체를 창으로 띄운다 (사용자 2026-10-07 — 그 자리에서 펼치면 페이지가 너무 길어졌다) */
function MoreModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <ModalWindow label={title} className="operator-modal me-list-modal me-all-modal" onClose={onClose}>
      <div className="me-all-body">{children}</div>
    </ModalWindow>
  );
}

/** 접힌 목록의 '전부 보기 / 접기' */
function MoreButton({ open, total, onToggle }: { open: boolean; total: number; onToggle: () => void }) {
  const { locale, t } = useI18n();
  return (
    <button type="button" className="me-more" onClick={onToggle}>
      {open ? t("접기") : t("전부 보기 ({n})", { n: fmtOf(locale)(total) })}
    </button>
  );
}

// ── 오퍼 목록 모달 본문 ──────────────────────────────────────
// 거르기·정렬 — 오퍼 도감처럼 (사용자 지시 2026-10-14 "내 정보 보유 오퍼도 오퍼 도감처럼 필터링 및 정렬"):
// 이름 검색 · 성급 · 직군 · 획득 구분(한정·통상·보상·공채·커널, op-acquire.ts) — 같은 줄 안은 하나라도(OR), 줄끼리는 모두(AND).
// 정렬 기본은 들어온 순서(칸마다 정한 성급·레벨 순)이고, 계정 오퍼가 있는 목록만 레벨·잠재·최근 얻은 순으로 바꿀 수 있다
type OpSort = "base" | "level" | "potential" | "name" | "gain";
const dropLabel = (name: string, picked: string | null) => (picked ? <>{name} · <b>{picked}</b></> : name);
function OpListBody({ title, entries, opById, chars, onShowOperator }: { title: string; entries: ListEntry[]; opById: Map<string, MeOp>; chars?: Map<string, AccountChar>; onShowOperator?: (id: string) => void }) {
  const { locale, t } = useI18n();
  const fmt = fmtOf(locale);
  const [q, setQ] = useState("");
  // 드롭다운마다 하나만 고른다 — 고르면 목록이 닫히고, 줄끼리는 모두 만족(AND) (사용자 지시 2026-10-14 "or 가 아니라 and 로").
  // 같은 값을 다시 고르면 풀린다
  const [rar, setRar] = useState<number | null>(null);
  const [jobs, setJobs] = useState<string | null>(null);
  const [acq, setAcq] = useState<AcquireKey | null>(null);
  const [sort, setSort] = useState<OpSort>("base");
  const [rev, setRev] = useState(false);
  const toggle = <V,>(set: React.Dispatch<React.SetStateAction<V | null>>) => (v: V) => set((cur) => (cur === v ? null : v));
  const rows = entries.map((e) => ({ e, op: opById.get(e.id), c: chars?.get(e.id) })).filter((x): x is { e: ListEntry; op: MeOp; c: AccountChar | undefined } => !!x.op);
  // 고를 거리는 이 목록에 있는 것만 — 없는 성급·직군 칩은 띄우지 않는다
  const rarOpts = [6, 5, 4, 3, 2, 1].filter((r) => rows.some((x) => x.op.rarity === r));
  const JOB_ORDER = ["PIONEER", "WARRIOR", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"];   // 게임 직군 순서
  const jobOpts = [...new Map(rows.filter((x) => x.op.jobCode).map((x) => [x.op.jobCode!, x.op.job ?? x.op.jobCode!])).entries()]
    .sort((a, b) => JOB_ORDER.indexOf(a[0]) - JOB_ORDER.indexOf(b[0]));
  const acqOpts = ACQUIRE_KEYS.filter((k) => rows.some((x) => acquireOf(x.op.id).includes(k)));
  const hasChars = rows.some((x) => x.c);
  const nq = normSearch(q);
  const shown = rows.filter((x) => (!nq || normSearch(x.op.name).includes(nq))
    && (rar == null || x.op.rarity === rar)
    && (jobs == null || x.op.jobCode === jobs)
    && (acq == null || acquireOf(x.op.id).includes(acq)));
  if (sort !== "base") {
    const key = (x: (typeof rows)[number]): number => sort === "level" ? (x.c ? x.c.elite * 1000 + x.c.level : -1)
      : sort === "potential" ? (x.c?.potential ?? -1) : sort === "gain" ? (x.c?.gain ?? 0) : 0;
    shown.sort(sort === "name" ? (a, b) => a.op.name.localeCompare(b.op.name, locale)
      : (a, b) => key(b) - key(a) || b.op.rarity - a.op.rarity || a.op.name.localeCompare(b.op.name, locale));
  }
  if (rev) shown.reverse();
  const filtered = !!(nq || rar != null || jobs != null || acq != null);
  // '기본'은 목록에 두지 않는다 — 아무것도 안 고른 상태가 기본이고, 초기화로 돌아간다 (사용자 지시 2026-10-14)
  const SORTS: [OpSort, string][] = [...(hasChars ? [["level", "레벨"], ["potential", "잠재"], ["gain", "최근 얻은 순"]] as [OpSort, string][] : []), ["name", "이름"]];
  return (
    <div className="me-list">
      <header className="me-list-head">
        <span className="modal-kicker">MY OPERATORS</span>
        <h3>{title}<small>{filtered ? `${fmt(shown.length)} / ${t("{n}명", { n: fmt(rows.length) })}` : t("{n}명", { n: fmt(rows.length) })}</small></h3>
      </header>
      {rows.length > 1 && (
        // 드롭다운으로 (사용자 지시 2026-10-14 "보유 오퍼 필터링은 드롭다운 버튼으로") — 오퍼 도감 필터와 같은 공용 Dropdown
        <div className="me-depot-tools me-op-tools">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("이름 검색")} aria-label={t("이름 검색")} />
          {rarOpts.length > 1 && <Dropdown ariaLabel={t("성급")} label={dropLabel(t("성급"), rar == null ? null : `${rar}★`)} selected={rar == null ? [] : [String(rar)]}
            items={rarOpts.map((r) => ({ value: String(r), label: `${r}★`, count: rows.filter((x) => x.op.rarity === r).length }))}
            onPick={(v) => toggle(setRar)(Number(v))} />}
          {jobOpts.length > 1 && <Dropdown ariaLabel={t("직군")} label={dropLabel(t("직군"), jobOpts.find(([c]) => c === jobs)?.[1] ?? null)} selected={jobs == null ? [] : [jobs]}
            items={jobOpts.map(([code, name]) => ({ value: code, label: name, count: rows.filter((x) => x.op.jobCode === code).length }))}
            onPick={(v) => toggle(setJobs)(v)} />}
          {acqOpts.length > 1 && <Dropdown ariaLabel={t("획득 구분")} label={dropLabel(t("획득 구분"), acq == null ? null : t(ACQUIRE_LABEL[acq]))} selected={acq == null ? [] : [acq]}
            items={acqOpts.map((k) => ({ value: k, label: t(ACQUIRE_LABEL[k]), count: rows.filter((x) => acquireOf(x.op.id).includes(k)).length }))}
            onPick={(v) => toggle(setAcq)(v as AcquireKey)} />}
          <Dropdown ariaLabel={t("정렬")} label={sort === "base" ? t("정렬") : <>{t("정렬")} · <b>{t(SORTS.find(([k]) => k === sort)?.[1] ?? "")}</b></>} selected={[sort]}
            items={SORTS.map(([k, label]) => ({ value: k, label: t(label) }))} onPick={(v) => setSort(v as OpSort)} />
          <button type="button" className={`me-sort${rev ? " selected" : ""}`} onClick={() => setRev((v) => !v)} title={t("정렬 뒤집기")}><span aria-hidden>⇅</span>{t("뒤집기")}</button>
          {(filtered || sort !== "base" || rev) && <button type="button" className="me-sort" onClick={() => { setQ(""); setRar(null); setJobs(null); setAcq(null); setSort("base"); setRev(false); }}>{t("초기화")}</button>}
        </div>
      )}
      <div className="modal-scroll">
        {shown.length ? (
          <ul className="me-ops">
            {shown.map(({ e, op }) => (
              <li key={e.id}>
                <button type="button" onClick={() => onShowOperator?.(e.id)} title={op.name}>
                  <span className={`me-op-face r${op.rarity}`}><img src={avatarOf(op.id)} alt="" width={56} height={56} loading="lazy" /></span>
                  <span className="me-op-name">{op.name}</span>
                  <em>{e.sub}</em>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="me-note">{t("해당하는 오퍼가 없습니다.")}</p>}
      </div>
    </div>
  );
}

// ── 박사 카드 ────────────────────────────────────────────────
function ProfileCard({ me, now, opById, demo }: { me: MeData; now: number; opById: Map<string, MeOp>; demo?: boolean }) {
  const { locale, t } = useI18n();
  const fmt = fmtOf(locale);
  const st = me.profile?.status;
  const secretary = st?.secretary && opById.has(st.secretary) ? st.secretary : null;
  const dt = (ms: number) => new Date(ms).toLocaleString(DT_LOCALE[locale], { dateStyle: "medium", timeStyle: "short" });
  // 입사일 — "2023년 9월 30일" 처럼 연·월·일을 다 적는다 (사용자 지시)
  const day = (ms: number) => new Date(ms).toLocaleDateString(DT_LOCALE[locale], { year: "numeric", month: "long", day: "numeric" });
  const days = st?.register ? Math.floor((now / 1000 - st.register) / 86400) + 1 : 0;
  // 이성 — 동기화 뒤 6분마다 1씩 찬다 (상한까지)
  const apNow = st ? (st.ap >= st.maxAp ? st.ap : Math.min(st.maxAp, st.ap + Math.floor((now / 1000 - st.apTs) / 360))) : 0;
  // 드론 — 기본 360초에 1개(building_data laborRecoverTime), 발전소 가속(buffSpeed)만큼 빨라진다. 동기화 뒤 흐른 시간으로 어림 (상한까지)
  const lb = me.profile?.labor;
  const laborNow = lb ? (lb.value >= lb.max ? lb.value : Math.min(lb.max, lb.value + Math.floor((now / 1000 - lb.ts) * (1 + (lb.speed > 5 ? lb.speed / 100 : lb.speed)) / 360))) : 0;
  const server = ACCOUNT_SERVERS.find((s) => s.code === me.server)?.label ?? me.server;
  // 비서 스킨 일러 — 게임 스킨 id(char_002_amiya@epoque#4 · char_002_amiya#2)를 일러 파일명으로. 못 찾으면 정예화 일러로 물러난다
  const skinArt = st?.secretarySkin ? (st.secretarySkin.includes("@") ? st.secretarySkin.replace("@", "_") : st.secretarySkin.replace("#", "_")) : null;
  const art = secretary ? asset(`/skin/full/${encodeURIComponent(skinArt ?? `${secretary}_2`)}.webp`) : null;
  const [copied, setCopied] = useState(false);
  const copyUid = () => {
    void navigator.clipboard?.writeText(me.player.uid).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  const monthLeft = st?.monthlyEnd ? Math.ceil((st.monthlyEnd * 1000 - now) / 86400000) : null;
  return (
    <section className="me-card me-profile">
      {/* 배경 — 부관(비서)과 그 스킨의 일러를 카드 전체에 은은하게. 배너 안에만 두니 그림 아래가 배너 선에서 잘렸다 (사용자 지적 2026-10-11) */}
      {art && <img className="me-pf-art" src={art} alt="" aria-hidden decoding="async"
          onError={(e) => { const el = e.currentTarget; const fb = asset(`/skin/full/${secretary}_2.webp`); if (el.src !== new URL(fb, location.href).href) el.src = fb; else el.remove(); }} />}
      {/* 머리 배너 — 비서 일러를 오른쪽에 은은하게 (사용자 지시 2026-10-11 "예쁘게") */}
      <div className="me-pf-hero">
        <span className="me-pf-server">{t(server)}</span>
        <div className="me-profile-top">
          <span className="me-avatar">{secretary ? <img src={avatarOf(secretary)} alt="" width={96} height={96} /> : <b aria-hidden>Dr.</b>}</span>
          <div className="me-profile-name">
            <h3>{me.player.nickName}<small>#{me.player.nickNumber}</small></h3>
            <p>
              <span className="me-pf-lv">Lv.<b>{me.player.level}</b></span>
              <button type="button" className="me-pf-uid" onClick={copyUid} title={t("UID 복사")}>
                UID <code>{me.player.uid}</code><span aria-hidden>{copied ? "✓" : "⧉"}</span>
              </button>
            </p>
          </div>
        </div>
      </div>
      {st?.resume && <p className="me-pf-quote">{st.resume}</p>}
      <div className="me-pf-stats">
        {st && <ProfileStat label={t("이성")} value={fmt(apNow)} max={fmt(st.maxAp)} ratio={apNow / Math.max(1, st.maxAp)}
          note={apNow < st.maxAp ? t("{time} 가득", { time: dt((st.apTs + (st.maxAp - st.ap) * 360) * 1000) }) : t("가득 참")} />}
        {lb && lb.max > 0 && <ProfileStat label={t("드론")} value={fmt(laborNow)} max={fmt(lb.max)} ratio={laborNow / lb.max}
          note={laborNow < lb.max ? t("{time} 가득", { time: dt((lb.ts + ((lb.max - lb.value) * 360) / (1 + (lb.speed > 5 ? lb.speed / 100 : lb.speed))) * 1000) }) : t("가득 참")} />}
        {days > 0 && <ProfileStat label={t("박사 경력")} value={`D+${fmt(days)}`} note={t("{date} 입사", { date: day(st!.register * 1000) })} />}
        {monthLeft != null && <ProfileStat label={t("월정액")} value={monthLeft > 0 ? t("{n}일 남음", { n: fmt(monthLeft) }) : t("만료")}
          ratio={monthLeft > 0 ? Math.min(1, monthLeft / 30) : 0} warn={monthLeft <= 3} />}
        {me.profile?.creditSpent != null && <ProfileStat label={t("누적 소비 크레딧")} value={fmt(me.profile.creditSpent)} />}
      </div>
      {!demo && <p className="me-pf-sync">{t("동기화")} · {dt(me.syncedAt)}</p>}
      {!me.profile && <p className="me-note">{t("이 데이터는 오퍼 목록만 들어 있는 예전 형식입니다 — 다시 동기화하면 창고·진행 상황·친구까지 채워집니다.")}</p>}
    </section>
  );
}

/** 프로필 카드의 숫자 칸 — 이름 · 큰 숫자(/상한) · 막대 · 보조 문구 */
function ProfileStat({ label, value, max, ratio, note, warn }: { label: string; value: string; max?: string; ratio?: number; note?: string; warn?: boolean }) {
  return (
    <div className={`me-pf-stat${warn ? " warn" : ""}`}>
      <span>{label}</span>
      <b>{value}{max && <small>/{max}</small>}</b>
      {ratio != null && <i className="me-pf-bar" aria-hidden><i style={{ width: `${Math.round(ratio * 100)}%` }} /></i>}
      {note && <small>{note}</small>}
    </div>
  );
}

// ── 재화 ────────────────────────────────────────────────────
function Wallet({ me, items, onOpen }: { me: MeData; items: ItemDoc | null; onOpen: (i: DexItem) => void }) {
  const { locale, t } = useI18n();
  const inv = me.profile?.inventory;
  const ios = me.profile?.status.iosDiamond;
  if (!inv) return null;
  const byId = new Map((items?.items ?? []).map((i) => [i.id, i]));
  const fmt = fmtOf(locale);
  // 가진 재화로 헤드헌팅을 몇 번 돌릴 수 있나 (사용자 지시 2026-10-11) — 합성옥 600 = 1회, 허가증 1장 = 1회, 10회 허가증 = 10회.
  // 순오리지늄은 1개 = 합성옥 180 으로 바꿔 남은 합성옥과 합쳐 다시 600 단위로 센다 — 큰 숫자는 이 값
  const { pulls, all: pullsAll, orundum, prime, permit, permit10 } = mePulls(inv)!;
  return (
    <Card no="WALLET" title={t("재화")}>
      <div className="me-pulls" title={t("합성옥 600개 = 1회 · 헤드헌팅 허가증 1장 = 1회 · 10회 허가증 1장 = 10회 · 순오리지늄 1개 = 합성옥 180개")}>
        <span>{t("헤드헌팅 가능")}</span>
        {/* 큰 숫자는 순오리지늄까지 바꾼 값 (사용자 지시 2026-10-11) — 안 바꾼 값 줄은 필요 없다고 해 뺐다 */}
        <b>{t("{n}회", { n: fmt(pullsAll) })}</b>
        <small>{t("합성옥 {a} · 허가증 {b} · 10회 허가증 {c}", { a: fmt(Math.floor(orundum / 600)), b: fmt(permit), c: fmt(permit10 * 10) })}{prime > 0 && ` · ${t("순오리지늄 {n}", { n: fmt(pullsAll - pulls) })}`}</small>
        {/* 가챠 시뮬레이터로 — 거기 '내 재화로 N회' 단추가 이 재화를 그대로 쓴다 (사용자 요청 2026-10-12) */}
        {pullsAll > 0 && <a className="me-pulls-go" href={`${locale === "ko" ? "" : `/${locale}`}/gacha`}>{t("가챠하러 가기")} <span aria-hidden>→</span></a>}
      </div>
      {/* 묶음은 한 줄씩 칸으로, 나머지는 목록 (사용자 지시 2026-10-05) */}
      {WALLET_ROWS.map((row) => (
        <ul key={row[0]} className="me-wallet-top" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
          {row.map((id) => {
            const it = byId.get(id);
            return (
              <li key={id}>
                <button type="button" disabled={!it} onClick={() => it && onOpen(it)} title={it?.n}>
                  <span className="me-ico" data-tier={it?.r}>{it?.i && <img src={itemIcon(it.i)} alt="" width={40} height={40} loading="lazy" />}</span>
                  {/* 좁은 칸에서 이름이 넘치면 흐른다 (사용자 지시 2026-10-05) */}
                  <Marquee className="me-wallet-name">{it?.n ?? id}</Marquee>
                  {/* 중섭은 순오리지늄이 기기별로 따로다 — 큰 숫자는 안드로이드 몫, iOS 몫은 옆에 작게 (2026-10-06).
                      줄을 따로 쓰면 이 칸만 키가 커져 한 줄 칸들이 들쭉날쭉해진다 */}
                  <b>{fmt(inv[id] ?? 0)}{id === "4002" && ios !== undefined && <small className="me-wallet-sub"> · iOS {fmt(ios)}</small>}</b>
                </button>
              </li>
            );
          })}
        </ul>
      ))}
      <ul className="me-wallet">
        {WALLET_LIST.map((id) => {
          const it = byId.get(id);
          return (
            <li key={id}>
              <button type="button" disabled={!it} onClick={() => it && onOpen(it)} title={it?.n}>
                <span className="me-ico" data-tier={it?.r}>{it?.i && <img src={itemIcon(it.i)} alt="" width={40} height={40} loading="lazy" />}</span>
                <span className="me-wallet-name">{it?.n ?? id}</span>
                <b>{fmt(inv[id] ?? 0)}</b>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── 지원 유닛 ────────────────────────────────────────────────
function Support({ me, opById, onShowOperator }: { me: MeData; opById: Map<string, MeOp>; onShowOperator?: (id: string) => void }) {
  const { t } = useI18n();
  const list = me.profile?.assist ?? [];
  const mine = meChars(me);
  if (!list.length) return null;
  return (
    <Card no="SUPPORT" title={t("내 지원 유닛")}>
      <ul className="me-ops me-ops-wide">
        {list.map((a, i) => {
          const op = opById.get(a.id);
          const c = mine?.get(a.id);
          if (!op || !c) return null;
          return <OpChip key={`${a.id}-${i}`} op={op} c={c} skillIndex={a.skillIndex} onShowOperator={onShowOperator} />;
        })}
      </ul>
    </Card>
  );
}

// ── 기반시설 ────────────────────────────────────────────────
function Rooms({ me }: { me: MeData }) {
  const { locale, t } = useI18n();
  const rooms = me.profile?.rooms ?? [];
  if (!rooms.length) return null;
  const groups = new Map<string, number[]>();
  for (const r of rooms) {
    if (!ROOM_LABEL[r.room]) continue;
    groups.set(r.room, [...(groups.get(r.room) ?? []), r.level]);
  }
  return (
    <Card no="BASE" title={t("기반시설")} aside={me.profile ? <small>{t("가구 {n}종", { n: fmtOf(locale)(me.profile.furniture) })}</small> : null}>
      <ul className="me-rooms">
        {ROOM_ORDER.filter((k) => groups.has(k)).map((k) => {
          const lv = groups.get(k)!.sort((a, b) => b - a);
          return (
            <li key={k}><span>{t(ROOM_LABEL[k])}</span><b>{lv.length > 1 ? `×${lv.length}` : ""}</b><em>{lv.map((l) => `Lv.${l}`).join(" · ")}</em></li>
          );
        })}
      </ul>
      {/* 인프라 자동 편성으로 바로 (사용자 지시 2026-10-11) */}
      <a className="me-rooms-go" href={`${locale === "ko" ? "" : `/${locale}`}/infra`}>{t("인프라 자동 편성")} <span aria-hidden>→</span></a>
    </Card>
  );
}

// 목록 모달 한 줄의 보조 문구 — 기본은 정예화·레벨·잠재
const subOf = (locale: string) => (c: AccountChar) => `${eliteText(locale, c.elite, c.level)} · ${potText(locale, c.potential)}`;
const byRarityLevel = (opById: Map<string, MeOp>) => (a: AccountChar, b: AccountChar) =>
  (opById.get(b.id)?.rarity ?? 0) - (opById.get(a.id)?.rarity ?? 0) || b.elite - a.elite || b.level - a.level;

/** '현재 / 전체' 칸의 동그란 띠 그래프 (사용자 지시 2026-10-05) */
function Ring({ value, total }: { value: number; total: number }) {
  const r = 13;
  const len = 2 * Math.PI * r;
  const p = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <svg className="me-ring" viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r={r} className="me-ring-track" />
      {p > 0 && <circle cx="16" cy="16" r={r} className="me-ring-fill" strokeDasharray={`${len * p} ${len}`} transform="rotate(-90 16 16)" />}
    </svg>
  );
}

// ── 한눈에 보기 ──────────────────────────────────────────────
// 칸 배치는 me-custom.tsx 의 배치 목록 하나 — 기본 칸도 고치고 지울 수 있다 (사용자 지시 2026-10-05).
// 보유 오퍼·6성 보유는 넓은 칸(%)으로, 나머지는 작은 칸. 훈장 다음(맨 끝)에 '+ 항목 추가'.
function Kpis({ owned, released, opById, me, onList, demo }: { owned: AccountChar[]; released: MeOp[]; opById: Map<string, MeOp>; me: MeData; onList: OpenList; demo?: boolean }) {
  const { locale, t } = useI18n();
  const layout = useCustomTiles();
  const customized = useLayoutCustomized();
  const [editing, setEditing] = useState<CustomTile | "new" | null>(null);
  const fmt = fmtOf(locale);
  const ctx = { owned, released, opById, profile: me.profile };
  const countOf = (cond: Cond): [number, number] => {
    const v = evalTile({ id: "", label: "", cond, total: true }, ctx);
    return [v.value, v.total ?? 0];
  };
  const shown = layout.filter((tile) => tile.kind !== "builtin" || ((tile.key !== "skins" && tile.key !== "medals") || !!me.profile));
  // 윗줄 = 계정 숫자 셋(보유 오퍼·보유 스킨·훈장) 고정, 그 아래 = 고칠 수 있는 칸 한 줄에 5개 (사용자 지시 2026-10-05)
  const TOP_KEYS = ["owned", "skins", "medals"];
  const isTop = (tile: CustomTile) => tile.kind === "builtin" && TOP_KEYS.includes(tile.key);
  // 윗줄은 배치와 상관없이 늘 같은 셋 — 이름도 못 바꾸고 지울 수도 없다 (사용자 지시 2026-10-05)
  const top = DEFAULT_LAYOUT.filter((tile) => isTop(tile) && (tile.kind !== "builtin" || tile.key === "owned" || !!me.profile));
  const rest = shown.filter((tile) => !isTop(tile));
  const open = (title: string, v: TileValue) => {
    if (v.ops) { onList(title, v.ops.map((id) => ({ id, sub: `${opById.get(id)?.rarity ?? ""}★` }))); return; }
    if (!v.chars) return;
    const sub = v.perKind === "m3" ? (c: AccountChar) => `${masteryText(locale, 3)} ×${v.per!(c)}`
      : v.perKind === "mod3" ? (c: AccountChar) => `Lv.3 ×${v.per!(c)}` : subOf(locale);
    onList(title, [...v.chars].sort(byRarityLevel(opById)).map((c) => ({ id: c.id, sub: sub(c) })));
  };
  const renderTile = (tile: CustomTile, fixed = false) => {
    const v = evalTile(tile, ctx);
    const label = tileLabel(tile, t);
    const big = tile.kind === "builtin" && tile.key === "owned";
    // 내림 — 반올림하면 413/415 가 100% 로 보였다 (사용자 지적 2026-10-14). 100% 는 다 모았을 때만
    const pct = big && v.total ? `${Math.floor((v.value / Math.max(1, v.total)) * 100)}%` : null;
    const clickable = !!(v.chars || v.ops);
    const body = <><span>{label}</span><b>{fmt(v.value)}{v.total != null && <small>/{fmt(v.total)}</small>}</b>{pct && <small className="me-kpi-pct">{pct}</small>}{v.total != null && <Ring value={v.value} total={v.total} />}</>;
    return (
      <li key={tile.id} className={`me-kpi-custom${big ? " big" : ""}`}>
        {clickable ? <button type="button" onClick={() => open(label, v)}>{body}</button> : <div>{body}</div>}
        {!demo && !fixed && <button type="button" className="me-kpi-edit" aria-label={t("항목 고치기")} onClick={() => setEditing(tile)}>✎</button>}
      </li>
    );
  };
  return (
    <Card no="SUMMARY" title={t("한눈에 보기")} className="me-kpi-card"
      aside={!demo && customized ? (
        <button type="button" className="me-sort" onClick={() => saveCustomTiles(null)}><span aria-hidden>↺</span>{t("기본 칸으로 되돌리기")}</button>
      ) : null}>
      {top.length > 0 && <ul className="me-kpis me-kpis-top">{top.map((tile) => renderTile(tile, true))}</ul>}
      <ul className="me-kpis">
        {rest.map((tile) => renderTile(tile))}
        {/* 맨 끝 — 칸 추가 (사용자 지시 2026-10-04) */}
        {!demo && layout.length < MAX_CUSTOM && (
          <li className="me-kpi-add">
            <button type="button" onClick={() => setEditing("new")}><b aria-hidden>+</b><span>{t("항목 추가")}</span></button>
          </li>
        )}
      </ul>

      {editing && (
        <CustomTileEditor tile={editing === "new" ? null : editing} countOf={countOf}
          valueOf={(tile) => { const v = evalTile(tile, ctx); return v.total != null ? `${fmt(v.value)} / ${fmt(v.total)}` : fmt(v.value); }}
          onClose={() => setEditing(null)}
          onDelete={editing === "new" ? undefined : () => { saveCustomTiles(layout.filter((x) => x.id !== editing.id)); setEditing(null); }}
          onSave={(tile) => {
            saveCustomTiles(editing === "new" ? [...layout, tile] : layout.map((x) => (x.id === tile.id ? tile : x)));
            setEditing(null);
          }} />
      )}
    </Card>
  );
}

// ── 성급별 ──────────────────────────────────────────────────
function RarityTable({ owned, released, opById, onList }: { owned: AccountChar[]; released: MeOp[]; opById: Map<string, MeOp>; onList: OpenList }) {
  const { locale, t } = useI18n();
  const fmt = fmtOf(locale);
  const show = (title: string, list: AccountChar[], sub: (c: AccountChar) => string = subOf(locale)) =>
    onList(title, [...list].sort(byRarityLevel(opById)).map((c) => ({ id: c.id, sub: sub(c) })));
  const rows = RARITIES.map((r) => {
    const all = released.filter((op) => op.rarity === r);
    const mine = owned.filter((c) => opById.get(c.id)?.rarity === r);
    const topE = maxEliteOf(r);
    return {
      r, all, mine,
      missing: all.filter((op) => !mine.some((c) => c.id === op.id)),
      topE: topE > 0 ? mine.filter((c) => c.elite === topE) : null,
      maxed: mine.filter((c) => isMaxed(c, r)),
      pot: mine.filter((c) => c.potential >= 6),
      m3: r >= 4 ? mine.filter((c) => c.mastery.some((m) => m >= 3)) : null,
      m3n: mine.reduce((n, c) => n + c.mastery.filter((m) => m >= 3).length, 0),
    };
  });
  const star = (r: number) => `${r}★`;
  const cell = (n: number, onClick: () => void) => <button type="button" className="me-cell" disabled={!n} onClick={onClick}>{fmt(n)}</button>;
  return (
    <Card no="RARITY" title={t("성급별 육성")}>
      <div className="me-table-wrap">
        <table className="me-table">
          <thead>
            <tr><th>{t("성급")}</th><th>{t("보유")}</th><th>{t("미보유")}</th><th>{t("최종 정예화")}</th><th>{t("만렙")}</th><th>{t("풀잠")}</th><th>{t("3마스터")}</th></tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.r}>
                <th className={`me-r r${x.r}`}>{"★".repeat(x.r)}</th>
                <td>
                  <button type="button" className="me-cell me-cell-bar" disabled={!x.mine.length} onClick={() => show(`${star(x.r)} ${t("보유")}`, x.mine)}>
                    <span className="me-bar" style={{ "--p": `${(x.mine.length / Math.max(1, x.all.length)) * 100}%` } as React.CSSProperties} />
                    <b>{fmt(x.mine.length)}</b><small>/{fmt(x.all.length)}</small>
                  </button>
                </td>
                <td>{cell(x.missing.length, () => onList(`${star(x.r)} ${t("미보유")}`, x.missing.map((op) => ({ id: op.id, sub: `${op.rarity}★` }))))}</td>
                <td>{x.topE ? cell(x.topE.length, () => show(`${star(x.r)} ${t("최종 정예화")}`, x.topE!)) : "—"}</td>
                <td>{cell(x.maxed.length, () => show(`${star(x.r)} ${t("만렙")}`, x.maxed))}</td>
                <td>{cell(x.pot.length, () => show(`${star(x.r)} ${t("풀잠")}`, x.pot))}</td>
                <td>{x.m3 ? cell(x.m3n, () => show(`${star(x.r)} ${t("3마스터")}`, x.m3!, (c) => `${masteryText(locale, 3)} ×${c.mastery.filter((m) => m >= 3).length}`)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="me-note">{t("최종 정예화는 성급마다 다릅니다 — 4~6성은 정예화 2, 3성은 정예화 1. 만렙은 최종 정예화의 최대 레벨(6성 90 · 5성 80 · 4성 70 · 3성 55)입니다.")} {t("숫자를 누르면 해당 오퍼 목록이 열립니다.")}</p>
    </Card>
  );
}

// ── 진행 상황 ────────────────────────────────────────────────
// 메인 스토리뿐 아니라 이벤트·사이드 스토리·섬멸 작전까지 전부 (사용자 지시 2026-10-04).
// 묶음: 메인 = 에피소드(존)별 — 일반·S·H 작전을 함께 세고 고난(tough_, 숨은 판)은 따로 · 이벤트 = 이벤트별 ·
// 섬멸 = 400 처치를 클리어로 친다.
type ProgCat = "main" | "event" | "camp";
type ProgGroup = { key: string; cat: ProgCat; name: string; order: number; total: number; clear: number; perfect: number; left: string[]; star: string[]; tough: number; toughClear: number; open: number };

function Progress({ me, stages, onOpenStage, full }: { me: MeData; stages: StageDoc | null; onOpenStage: (id: string) => void; full?: boolean }) {
  const { locale, t } = useI18n();
  const fmt = fmtOf(locale);
  const [withStars, setWithStars] = useState(false);
  // 미완료 먼저 — 남은 작전이 많은 묶음이 위로 (사용자 지시)
  const [pendingFirst, setPendingFirst] = useState(false);
  const [cat, setCat] = useState<ProgCat | "all">("all");
  const [all, setAll] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // 요약 숫자를 누르면 뜨는 작전 목록 (사용자 지시 2026-10-04)
  const [stageList, setStageList] = useState<{ title: string; groups: { name: string; ids: string[] }[]; key: number } | null>(null);
  const rec = me.profile?.stages;
  const camps = me.profile?.campaigns;
  // 지금 못 들어가는 작전(끝난 기간 이벤트·지난 순환 섬멸)은 미클리어·3성 미달성에 넣지 않는다 (사용자 지시 2026-10-04).
  // 클리어 수·전체 수는 그대로 센다 — 이미 깬 기록까지 지울 이유는 없다
  const [isOpen] = useState(() => openChecker(Date.now()));
  const opDoc = useStageOp();
  const [isRunning] = useState(() => runningChecker(Date.now()));
  const prime = useMemo(() => primeLeft(opDoc, rec, stages, isOpen, isRunning), [opDoc, rec, stages, isOpen, isRunning]);
  const data = useMemo(() => {
    if (!stages || !rec || !opDoc) return null;
    const byId = new Map(stages.stages.map((s) => [s.id, s]));
    // 순오리지늄을 안 주는 이벤트 판(미니게임·대화판 — 엔드리스 카니발 IC-P 트랙, 시라쿠사인 IS-QT 등)은 세지 않는다.
    // 미클리어로 떠서 "남은 작전 = 돌 받을 곳"으로 읽혔다 (디시 제보 2026-10-16 "광석차 드라이브·도란도란 해 봤는데 안 준다",
    // 사용자 지시 "2 ㄱ"). 게임 표의 diamondOnceDrop 0 = stage-op.json 에 없는 작전
    const opSet = new Set(opDoc.ids);
    const groups = new Map<string, ProgGroup>();
    const gOf = new Map<string, string>();   // 작전 → 묶음 이름 ('어디서 얻나' 순오리지늄 목록)
    const get = (key: string, cat: ProgCat, name: string, order: number) => {
      let g = groups.get(key);
      if (!g) { g = { key, cat, name, order, total: 0, clear: 0, perfect: 0, left: [], star: [], tough: 0, toughClear: 0, open: 0 }; groups.set(key, g); }
      return g;
    };
    // 메인 에피소드 구역에 걸쳐 있는 옛 미니 이벤트 작전(act6d5_02 등 — 이벤트 번호 없이 구역만 메인 3장)은 뺀다.
    // 종전엔 메인 묶음(z3)에 섞여 '에피소드 3 15/18'처럼 다 깬 장이 덜 깬 것으로 보였다 (사용자 지적 2026-10-05)
    const mainZones = new Set(stages.stages.filter((s) => s.t === "MAIN" || s.t === "SUB").map((s) => s.z));
    stages.stages.forEach((s) => {
      if (s.id.startsWith("tr_")) return;   // 훈련 작전
      if (s.id.includes("autochess")) return;   // 위수 협의 판 — 클리어·3성·순오리지늄이 있는 작전이 아니다 (사용자 지적 2026-10-14)
      if (s.t === "ACTIVITY" && s.ev == null && mainZones.has(s.z)) return;
      if (s.t === "ACTIVITY" && !opSet.has(s.id)) return;
      let g: ProgGroup;
      if (s.t === "MAIN" || s.t === "SUB") g = get(`z${s.z}`, "main", stages.zones[s.z], s.z);
      else if (s.t === "ACTIVITY") g = s.ev != null ? get(`e${s.ev}`, "event", stages.events[s.ev], 10000 + s.ev) : get(`ez${s.z}`, "event", stages.zones[s.z], 20000 + s.z);
      else if (s.t === "CAMPAIGN") {
        g = get("camp", "camp", t("섬멸 작전"), 30000);
        g.total += 1;
        const kills = camps?.[s.id] ?? 0;
        if (isOpen(s)) g.open += 1;
        if (kills >= 400) { g.clear += 1; g.perfect += 1; } else if (isOpen(s)) g.left.push(s.id);
        return;
      } else return;
      gOf.set(s.id, g.name);
      // 기록이 아예 없는 끝난 이벤트 작전은 세지 않는다 — 깬 기록이 계정 데이터에서 지워져 '안 깸'과 구분이 안 된다
      // (사용자 지적 2026-10-14: 작년에 다 깬 '중생의 여정' 전투 작전이 미클리어로). 순오리지늄(primeLeft)과 같은 규칙
      if (s.t === "ACTIVITY" && rec[s.id] == null && !isRunning(s.id)) return;
      const state = rec[s.id] ?? -1;
      if (s.sub) { g.tough += 1; if (state >= 2) g.toughClear += 1; return; }
      g.total += 1;
      const open = isOpen(s);
      if (open) g.open += 1;
      if (state >= 2) g.clear += 1; else if (open) g.left.push(s.id);
      if (state >= 3) g.perfect += 1; else if (state === 2 && open) g.star.push(s.id);
    });
    const list = [...groups.values()].filter((g) => g.total > 0).sort((a, b) => a.order - b.order);
    const next = me.profile?.status.progress ? byId.get(me.profile.status.progress) ?? null : null;
    return { list, byId, next, gOf };
  }, [stages, rec, camps, me.profile, t, isOpen, isRunning, opDoc]);
  if (!rec) return null;
  if (!data) return <Card no="PROGRESS" title={t("스테이지 클리어 현황")}><p className="me-note">{t("불러오는 중…")}</p></Card>;
  const pendingOf = (g: ProgGroup) => (withStars ? [...g.left, ...g.star] : g.left);
  const inCat = data.list.filter((g) => cat === "all" || g.cat === cat);
  const leftTotal = inCat.reduce((n, g) => n + g.left.length, 0);
  const starTotal = inCat.reduce((n, g) => n + g.star.length, 0);
  const camp = data.list.find((g) => g.cat === "camp");
  const ordered = pendingFirst ? [...inCat].sort((a, b) => pendingOf(b).length - pendingOf(a).length || a.order - b.order) : inCat;
  const shown = full ? ordered : ordered.slice(0, EP_FOLD);
  // 묶음별로 나눠 띄운다 — 지금 고른 분류 안에서
  const openStages = (title: string, pick: (g: ProgGroup) => string[]) => setStageList((cur) => ({
    title, key: (cur?.key ?? 0) + 1,
    groups: inCat.map((g) => ({ name: g.name, ids: pick(g) })).filter((x) => x.ids.length),
  }));
  const catCount = (c: ProgCat) => data.list.filter((g) => g.cat === c).reduce((n, g) => n + g.left.length, 0);
  // 목록 그리기 — 본문(앞 몇 줄)과 '전부 보기' 창(전체)이 같이 쓴다 (사용자 2026-10-07 "페이지가 너무 길어진다")
  const epList = (items: typeof ordered, withRef: boolean) => (
    <ul className="me-eps">
      {items.map((g) => {
        const pending = pendingOf(g);
        const open = openKey === g.key;
        return (
          <li key={g.key} className={pending.length ? "has-left" : "all-clear"}>
            <button type="button" className="me-ep-row" disabled={!pending.length} aria-expanded={open} onClick={() => setOpenKey(open ? null : g.key)}>
              <span className="me-ep-name">{g.name}</span>
              <span className="me-bar" style={{ "--p": `${(g.clear / Math.max(1, g.total)) * 100}%` } as React.CSSProperties} />
              <b>{fmt(g.clear)}<small>/{fmt(g.total)}</small></b>
              {/* ★ 만으로는 뭔지 몰라 글자로 (사용자 지적 2026-10-05) — 3성(완벽 작전) 클리어 수 */}
              {g.cat === "camp" ? <em /> : <em title={t("3성 클리어한 작전 수")}>{t("3성")} {fmt(g.perfect)}</em>}
              {g.open === 0 ? <em className="me-closed" title={t("지금은 들어갈 수 없어 미클리어에서 뺀 묶음")}>{t("기간 종료")}</em>
                : g.tough > 0 ? <em className="me-tough" title={t("고난")}>{t("고난")} {g.toughClear}/{g.tough}</em> : <em />}
            </button>
            {open && pending.length > 0 && (
              <div className="me-stage-chips">
                {pending.map((id) => {
                  const s = data.byId.get(id);
                  if (!s) return null;
                  const kills = g.cat === "camp" ? camps?.[id] ?? 0 : null;
                  return (
                    <button key={id} type="button" className={g.left.includes(id) ? "left" : "star"} onClick={() => onOpenStage(id)} title={s.name}>
                      <b>{s.code}</b><span>{s.name}{kills != null ? ` · ${fmt(kills)}/400` : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
  return (
    <Card no="PROGRESS" title={t("스테이지 클리어 현황")}
      aside={<>
        <button type="button" className={`me-sort${pendingFirst ? " selected" : ""}`} onClick={() => setPendingFirst((v) => !v)}>
          <span aria-hidden>⇅</span>{t("미완료 먼저")}
        </button>
        <label className="me-toggle"><input type="checkbox" checked={withStars} onChange={(e) => setWithStars(e.target.checked)} />{t("3성 미달성 포함")}</label>
      </>}>
      <div className="me-progress-sum">
        <div><span>{t("메인 스토리 진행")}</span><b>{data.next ? `${data.next.code} ${data.next.name}` : t("모두 클리어")}</b></div>
        <button type="button" disabled={!leftTotal} onClick={() => openStages(t("미클리어 작전"), (g) => g.left)}>
          <span>{t("미클리어 작전")}</span><b>{fmt(leftTotal)}</b>
        </button>
        <button type="button" disabled={!starTotal} onClick={() => openStages(t("3성 미달성"), (g) => g.star)}>
          <span>{t("3성 미달성")}</span><b>{fmt(starTotal)}</b>
        </button>
        <button type="button" disabled={!camp} onClick={() => camp && setStageList((cur) => ({
          title: t("섬멸 작전"), key: (cur?.key ?? 0) + 1,
          groups: [{ name: t("400 미달성"), ids: camp.left }, { name: t("400 달성"), ids: (stages?.stages ?? []).filter((s) => s.t === "CAMPAIGN" && !camp.left.includes(s.id)).map((s) => s.id) }].filter((x) => x.ids.length),
        }))}>
          <span>{t("섬멸 작전 400 달성")}</span><b>{fmt(camp?.clear ?? 0)}<small>/{fmt(camp?.total ?? 0)}</small></b>
        </button>
        {/* 누르면 어디서 얻나 — 묶음별 작전 목록 (사용자 지시 2026-10-14) */}
        <button type="button" disabled={!prime?.n && !prime?.shut} onClick={() => {
          if (!prime) return;
          const groupBy = (list: string[], tail = "") => {
            const by = new Map<string, string[]>();
            for (const id of list) {
              const base = id.replace(/#f#$|#s$/, "");
              const ref = opDoc?.ref[id] || base;
              const name = (data.gOf.get(base) ?? data.gOf.get(ref) ?? t("스토리 작전")) + tail;
              by.set(name, [...(by.get(name) ?? []), id]);
            }
            return [...by].map(([name, ids]) => ({ name, ids }));
          };
          // 입장 불가는 맨 뒤에 따로 — 묶음 이름에 표시를 달아 섞이지 않게 (2026-10-16)
          setStageList((cur) => ({ title: t("순오리지늄 획득 가능"), key: (cur?.key ?? 0) + 1,
            groups: [...groupBy(prime.ids), ...groupBy(prime.shutIds, ` — ${t("지금 입장 불가")}`)] }));
        }} title={t("지금 들어갈 수 있는 작전 중 아직 3성(완료)을 못 받은 작전에서 처음 한 번 주는 순오리지늄 — 돌격 작전·스토리 작전 포함")}>
          <span>{t("순오리지늄")}</span>
          <b className="me-prime"><img src={itemIcon("DIAMOND")} alt="" width={22} height={22} />{prime == null ? "…" : t("× {n}개 획득 가능", { n: fmt(prime.n) })}</b>
          {prime && <small className="me-prime-base">{(t("클리어 {a} · 입장 가능 {b}", { a: fmt(prime.clear), b: fmt(prime.open) }) + (prime.shut ? ` · ${t("입장 불가 {n}", { n: fmt(prime.shut) })}` : ""))}</small>}
        </button>
      </div>
      <p className="me-note me-prog-note">{t("미클리어·3성 미달성에는 지금 들어갈 수 있는 작전만 셉니다 — 끝난 기간 이벤트와 지난 순환 섬멸은 뺍니다. 막대는 클리어한 작전 비율, '3성'은 3성 클리어한 작전 수입니다.")}</p>
      <div className="me-seg me-prog-cats" role="group">
        {([["all", t("전체")], ["main", t("메인 스토리")], ["event", t("이벤트")], ["camp", t("섬멸 작전")]] as [ProgCat | "all", string][]).map(([k, label]) => (
          <button key={k} type="button" className={cat === k ? "selected" : ""} onClick={() => { setCat(k); setAll(false); }}>
            {label}{k !== "all" && <small>{fmt(catCount(k))}</small>}
          </button>
        ))}
      </div>
      {epList(shown, true)}
      {!full && ordered.length > EP_FOLD && <MoreButton open={false} total={ordered.length} onToggle={() => setAll(true)} />}
      {all && <MoreModal title={t("스테이지 클리어 현황")} onClose={() => setAll(false)}>{epList(ordered, false)}</MoreModal>}
      {stageList && (
        <ModalWindow key={`sl-${stageList.key}`} label={stageList.title} className="operator-modal me-list-modal" onClose={() => setStageList(null)}>
          <div className="me-list">
            <header className="me-list-head">
              <span className="modal-kicker">MY PROGRESS</span>
              <h3>{stageList.title}<small>{t("{n}개", { n: fmt(stageList.groups.reduce((n, g) => n + g.ids.length, 0)) })}</small></h3>
            </header>
            <div className="modal-scroll">
              {stageList.groups.map((grp) => (
                <section key={grp.name} className="me-list-group">
                  <h4>{grp.name}<small>{fmt(grp.ids.length)}</small></h4>
                  <div className="me-stage-chips">
                    {grp.ids.map((id) => {
                      // 돌격(#f#)은 그 작전 도감으로, 도감에 없는 스토리 작전은 이름만 (순오리지늄 목록)
                      // 돌격 = #f# · 고난 = #s(14장~) / tough_(10~13장) — 앞 둘은 도감에 따로 없어 본 작전으로 연다
                      const assault = id.endsWith("#f#");
                      const adverse = id.endsWith("#s") || id.startsWith("tough_");
                      const s = data.byId.get(id) ?? data.byId.get(id.replace(/#f#$|#s$/, ""));
                      const nm = opDoc?.nm?.[id];
                      if (!s && !nm) return null;
                      // 스토리 작전(전투 없음)은 작전 맵과 구분 — '스토리 ·' + 점선 (사용자 지시 2026-10-14)
                      if (!s) return <button key={id} type="button" className="story" disabled title={nm![1]}><b>{nm![0]}</b><span>{t("스토리")} · {nm![1]}</span></button>;
                      const kills = s.t === "CAMPAIGN" ? camps?.[id] ?? 0 : null;
                      return (
                        <button key={id} type="button" onClick={() => onOpenStage(s.id)} title={s.name}>
                          <b>{s.code}</b><span>{assault ? `${t("돌격")} · ` : adverse ? `${t("고난")} · ` : ""}{s.name}{kills != null ? ` · ${fmt(kills)}/400` : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </ModalWindow>
      )}
    </Card>
  );
}

// ── 공개모집으로 채울 오퍼 ───────────────────────────────────
function RecruitPool({ mine, opById, onShowOperator }: { mine: Map<string, AccountChar>; opById: Map<string, MeOp>; onShowOperator?: (id: string) => void }) {
  const { locale, t } = useI18n();
  const fmt = fmtOf(locale);
  const [mode, setMode] = useState<"missing" | "pot">("missing");
  const [all, setAll] = useState(false);
  // 1·2성까지 전부 (사용자 지시) — 1·2성은 모집 시간을 줄여야 나온다
  const pool = recruitData.ops.filter((o) => opById.has(o.id));
  const missing = pool.filter((o) => !mine.has(o.id)).sort((a, b) => b.rarity - a.rarity);
  const notMax = pool.filter((o) => { const c = mine.get(o.id); return c && c.potential < 6; })
    .sort((a, b) => b.rarity - a.rarity || (mine.get(a.id)!.potential - mine.get(b.id)!.potential));
  const list = mode === "missing" ? missing : notMax;
  const [gridRef, cols] = useGridCols();
  const fold = (cols || 9) * OPS_ROWS;
  const shown = list.slice(0, fold);
  // 목록 그리기 — 본문(앞 몇 줄)과 '전부 보기' 창(전체)이 같이 쓴다 (사용자 2026-10-07 "페이지가 너무 길어진다")
  const recList = (items: typeof list, withRef: boolean) => (
    <ul className="me-ops dense" ref={withRef ? gridRef : undefined}>
      {items.map((o) => {
        const op = opById.get(o.id)!;
        const c = mine.get(o.id);
        return (
          <li key={o.id}>
            <button type="button" onClick={() => onShowOperator?.(o.id)} title={op.name}>
              <span className={`me-op-face r${op.rarity}`}><img src={avatarOf(o.id)} alt="" width={56} height={56} loading="lazy" /></span>
              <span className="me-op-name">{op.name}</span>
              <em>{c ? `${op.rarity}★ · ${potText(locale, c.potential)}` : `${op.rarity}★`}</em>
            </button>
          </li>
        );
      })}
    </ul>
  );
  return (
    <Card no="RECRUITMENT" title={t("공개모집으로 채울 오퍼")}
      aside={(
        <div className="me-seg" role="group">
          <button type="button" className={mode === "missing" ? "selected" : ""} onClick={() => { setMode("missing"); setAll(false); }}>{t("미보유")} {fmt(missing.length)}</button>
          <button type="button" className={mode === "pot" ? "selected" : ""} onClick={() => { setMode("pot"); setAll(false); }}>{t("잠재 미완")} {fmt(notMax.length)}</button>
        </div>
      )}>
      {list.length ? (
        recList(shown, true)
      ) : <p className="me-note">{mode === "missing" ? t("공개모집으로 나오는 오퍼를 모두 보유하고 있습니다.") : t("공개모집 오퍼의 잠재가 모두 6입니다.")}</p>}
      {list.length > fold && <MoreButton open={false} total={list.length} onToggle={() => setAll(true)} />}
      {all && <MoreModal title={t("공개모집으로 채울 오퍼")} onClose={() => setAll(false)}>{recList(list, false)}</MoreModal>}
      <p className="me-note">{t("1·2성은 모집 시간을 줄여야 나옵니다 — 1성은 3시간 50분 이하, 2성은 7시간 30분 이하.")}</p>
    </Card>
  );
}

// ── 패러독스 시뮬레이션 (사용자 요청 2026-10-17 "클리어한 것과 남은 오퍼 — 육성 안 해서 안 열린 것도") ─────
// 해금 조건(정예화·레벨)은 app/data/paradox.json(scripts/build-paradox.py), 깬 기록은 워커가 계정 원본 troop.addon 에서 뽑는다(profile.paradox).
// 남은 것을 셋으로 가른다: 지금 할 수 있음(조건 충족·안 깸) · 육성 필요(보유했지만 조건 미달) · 미보유
const PARADOX = paradoxData as unknown as Record<string, [number, number, number?]>;
type ParadoxMode = "ready" | "train" | "missing" | "clear";
function Paradox({ me, mine, released, onShowOperator }: { me: MeData; mine: Map<string, AccountChar>; released: MeOp[]; onShowOperator?: (id: string) => void }) {
  const { locale, t } = useI18n();
  const fmt = fmtOf(locale);
  const done = me.profile?.paradox;
  const cnAccount = me.server === "cn" || me.server === "bili";
  const groups = useMemo(() => {
    const cleared = new Set(done ?? []);
    const g: Record<ParadoxMode, MeOp[]> = { ready: [], train: [], missing: [], clear: [] };
    for (const op of released) {
      const req = PARADOX[op.id];
      if (!req || (req[2] && !cnAccount)) continue;   // 중섭에만 있는 패러독스는 한·일·글섭 계정에서 뺀다
      const c = mine.get(op.id);
      if (cleared.has(op.id)) g.clear.push(op);
      else if (!c) g.missing.push(op);
      else if (c.elite > req[0] || (c.elite === req[0] && c.level >= req[1])) g.ready.push(op);
      else g.train.push(op);
    }
    for (const list of Object.values(g)) list.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, locale));
    return g;
  }, [done, released, mine, locale, cnAccount]);
  const [mode, setMode] = useState<ParadoxMode | null>(null);
  const cur: ParadoxMode = mode ?? (groups.ready.length ? "ready" : groups.train.length ? "train" : "missing");
  const [all, setAll] = useState(false);
  const [gridRef, cols] = useGridCols();
  const fold = (cols || 9) * OPS_ROWS;
  const total = groups.clear.length + groups.ready.length + groups.train.length + groups.missing.length;
  const need = (op: MeOp) => {
    const [e, l] = PARADOX[op.id];
    return l <= 1 ? t("{e}정 필요", { e }) : t("{e}정 Lv.{l} 필요", { e, l });
  };
  const sub = (op: MeOp) => {
    const c = mine.get(op.id);
    if (curShown === "train") return need(op);
    return c ? eliteText(locale, c.elite, c.level) : `${op.rarity}★`;
  };
  const grid = (items: MeOp[], withRef: boolean) => (
    <ul className="me-ops dense" ref={withRef ? gridRef : undefined}>
      {items.map((op) => (
        <li key={op.id}>
          <button type="button" onClick={() => onShowOperator?.(op.id)} title={op.name}>
            <span className={`me-op-face r${op.rarity}`}><img src={avatarOf(op.id)} alt="" width={56} height={56} loading="lazy" /></span>
            <span className="me-op-name">{op.name}</span>
            <em>{sub(op)}</em>
          </button>
        </li>
      ))}
    </ul>
  );
  const SEG: [ParadoxMode, string][] = [["ready", "지금 가능"], ["train", "육성 필요"], ["missing", "미보유"], ["clear", "클리어"]];
  // 클리어 기록이 없는 옛 동기화 — 깼는지는 몰라도 '육성 필요'·'미보유'는 정예화만으로 가를 수 있어 그 둘은 보여 준다
  const segs = done ? SEG : SEG.filter(([k]) => k === "train" || k === "missing");
  const curShown: ParadoxMode = done ? cur : (mode === "missing" ? "missing" : "train");
  const shownList = groups[curShown];
  return (
    <Card no="PARADOX" title={t("패러독스 시뮬레이션")}
      aside={(
        <div className="me-seg" role="group">
          {segs.map(([k, label]) => (
            <button key={k} type="button" className={curShown === k ? "selected" : ""} onClick={() => { setMode(k); setAll(false); }}>{t(label)} {fmt(groups[k].length)}</button>
          ))}
        </div>
      )}>
      <p className="me-note">{done ? t("클리어 {n} / {total}", { n: fmt(groups.clear.length), total: fmt(total) }) : t("클리어 기록은 다시 동기화하면 보입니다.")}</p>
      {shownList.length ? grid(shownList.slice(0, fold), true) : <p className="me-note">{t("해당하는 오퍼가 없습니다.")}</p>}
      {shownList.length > fold && <MoreButton open={false} total={shownList.length} onToggle={() => setAll(true)} />}
      {all && <MoreModal title={`${t("패러독스 시뮬레이션")} · ${t(SEG.find(([k]) => k === curShown)![1])}`} onClose={() => setAll(false)}>{grid(shownList, false)}</MoreModal>}
    </Card>
  );
}

// ── 보안파견 (사용자 요청 2026-10-17 "보안파견 정보 전부") ─────────────────────────────
// 계정 기록(워커 towerDigest): 맵별 일반·하드 최고 층, 이번 시즌(종료일·임무·기간 보상·맵마다 저장한 편성).
// 이름·설명은 app/data/towers-detail{,.en,.ja}.json (scripts/build-tower.py) — 칸을 그릴 때 받는다. 맵 배경은 public/tower/<id>.webp
type TowerDoc = {
  towers: Record<string, [string, string, number, number]>;
  cards: Record<string, [string, string]>;
  tactical: Record<string, [string, string, string]>;
  seasons: Record<string, [string, string[]]>;
  missions: Record<string, [string, [string, number][]]>;
  medals: Record<string, Partial<Record<"clear" | "hard" | "hidden", [string, string, string]>>>;
};
const TOWER_DOCS: Record<string, () => Promise<{ default: unknown }>> = {
  ko: () => import("./data/towers-detail.json"),
  en: () => import("./data/towers-detail.en.json"),
  ja: () => import("./data/towers-detail.ja.json"),
};
function useTowerDoc(): TowerDoc | null {
  const { locale } = useI18n();
  const [doc, setDoc] = useState<TowerDoc | null>(null);
  useEffect(() => {
    let alive = true;
    void (TOWER_DOCS[locale] ?? TOWER_DOCS.ko)().then((m) => { if (alive) setDoc(m.default as TowerDoc); });
    return () => { alive = false; };
  }, [locale]);
  return doc;
}
// 칩 이름 — "보안·긴급·히든"만으론 뭔지 몰랐다 (사용자 지적 2026-10-17). 히든은 일반 모드를 재시도 없이 깨는 것(unlockParam [맵, 1, 0])
const MEDAL_LABEL = { clear: "일반 완료", hard: "긴급 완료", hidden: "일반 퍼펙트" } as const;
const JOB_KO: Record<string, string> = { PIONEER: "뱅가드", WARRIOR: "가드", TANK: "디펜더", SNIPER: "스나이퍼", CASTER: "캐스터", MEDIC: "메딕", SUPPORT: "서포터", SPECIAL: "스페셜리스트" };
const fmtDay = (locale: string, sec: number) => (sec ? new Date(sec * 1000).toLocaleDateString(DT_LOCALE[locale as Locale] ?? "ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "—");

// 이어하기 › 보안파견 창 안에 그린다 (사용자 지시 2026-10-17 "섹션을 따로 만들지 말고 이어하기 보안파견에") — 진행 중이 아니어도 칸을 눌러 연다
function TowerInfo({ me, opById, onShowOperator, onOpenStage, items, onOpenItem, stages }: { me: MeData; opById: Map<string, MeOp>; onShowOperator?: (id: string) => void;
  onOpenStage?: (id: string) => void; items?: ItemDoc | null; onOpenItem?: (i: DexItem) => void; stages?: StageDoc | null }) {
  const { locale, t } = useI18n();
  const doc = useTowerDoc();
  const [pickMap, setPickMap] = useState<string | null>(null);
  const tp = me.profile?.tower;
  if (!tp) return <p className="me-note">{t("보안파견 기록은 다시 동기화하면 보입니다.")}</p>;
  const got = new Set(tp.medals ?? []);
  const ss = tp.season;
  // 맵 순서 — 이름표(게임 표 순서, 초기 맵 1~4 먼저) · 훈련장은 맨 뒤
  // 이번 시즌에 열린 맵(사용자 요청 2026-10-17 "지금 열려 있는 보안파견 표시") — 자리는 그대로, 표시만 단다("맨 앞에 둘 필요는 없다")
  const open = new Set(ss ? doc?.seasons[ss.id]?.[1] ?? [] : []);
  const ids = Object.keys(tp.maps).sort((a, b) => {
    const tr = Number(a.startsWith("tower_tr_")) - Number(b.startsWith("tower_tr_"));
    return tr || a.localeCompare(b, "en", { numeric: true });
  });
  const name = (id: string) => doc?.towers[id]?.[0] || TOWERS[id]?.[locale === "en" ? "en" : locale === "ja" ? "ja" : "ko"] || id;
  const missions = ss ? Object.entries(ss.missions) : [];
  // 층 목록 — 맵 칸을 누르면 뜨는 창에서 층을 고르면 그 작전(지형·적)이 작전 도감 창으로 (사용자 요청 2026-10-17 "맵 정보는 없나" →
  // "카드에 층 수를 다 넣지 말고 카드를 누르면 창에서"). 작전 id 는 lt_<맵 번호>_<층>, 긴급은 _ex
  const floors = (id: string, total: number, hard: boolean) => {
    const num = /^tower_n_(\d+)$/.exec(id)?.[1];
    if (!num || !total || !onOpenStage) return null;
    return (
      <ul className="me-tower-floors">
        {Array.from({ length: total }, (_, f) => {
          const sid = `lt_${num}_${String(f + 1).padStart(2, "0")}${hard ? "_ex" : ""}`;
          const st = stages?.stages.find((x) => x.id === sid);
          return (
            <li key={sid}>
              <button type="button" onClick={() => onOpenStage(sid)}>
                <b>{t("{n}층", { n: f + 1 })}</b><span>{st?.name ?? sid}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  };
  const itemOf = (iid: string) => items?.items.find((x) => x.id === iid || x.alt?.includes(iid));
  const missionDone = missions.filter(([, m]) => m[2] || m[0] >= m[1]).length;
  return (
    <>
      {ss && <p className="me-note">{doc?.seasons[ss.id]?.[0] ?? ss.id} · {t("{d}까지", { d: fmtDay(locale, ss.finish) })}</p>}
      <h4 className="me-sub">{t("맵 기록")} <em className="me-sub-side">{t("훈장 칩은 밝으면 획득 — 일반 퍼펙트는 일반 모드를 재시도 없이 끝낸 히든 훈장")}</em></h4>
      <ul className="me-tower-maps">
        {ids.map((id) => {
          const [best, hardBest, hardOpen] = tp.maps[id];
          const total = doc?.towers[id]?.[2] ?? 0;
          const hasHard = doc ? doc.towers[id]?.[3] === 1 : hardOpen === 1;
          const bg = towerBg(id);
          const full = (n: number) => total > 0 && n >= total;
          return (
            <li key={id} className={`${bg ? "has-bg" : ""}${open.has(id) ? " open" : ""}${onOpenStage && /^tower_n_/.test(id) ? " pick" : ""}`}
              style={bg ? { ["--bg" as string]: `url(${bg})` } : undefined}
              onClick={onOpenStage && /^tower_n_/.test(id) ? () => setPickMap(id) : undefined}>
              <b>{name(id)}</b>
              {open.has(id) && <i className="me-tower-open">{t("이번 시즌")}</i>}
              <span className={full(best) ? "done" : undefined}>{t("일반")} {best}{total ? `/${total}` : ""}</span>
              {hasHard && (
                <span className={full(hardBest) ? "done" : hardOpen ? undefined : "off"}>
                  {t("하드")} {hardOpen ? `${hardBest}${total ? `/${total}` : ""}` : t("잠김")}
                </span>
              )}
              {/* 맵 훈장 셋 — 완료·긴급 보급·히든(재시도 없이 완벽하게). 얻었으면 강조, 못 얻었으면 흐리게 (사용자 요청 2026-10-17) */}
              {doc?.medals[id] && (
                <div className="me-tower-medals">
                  {(["clear", "hard", "hidden"] as const).map((k) => {
                    const md = doc.medals[id][k];
                    if (!md) return null;
                    return <i key={k} className={got.has(md[0]) ? "got" : undefined} title={`${md[1]} — ${md[2]}`}>{t(MEDAL_LABEL[k])}</i>;
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {ss && (
        <>
          <h4 className="me-sub">{t("시즌 임무")} <em>{missionDone}/{missions.length}</em>
            {ss.period && <em className="me-sub-side">{t("기간 보상")} {ss.period.cur}/{ss.period.len} · {t("{d}까지", { d: fmtDay(locale, ss.period.term) })}</em>}
          </h4>
          <ul className="me-tower-missions">
            {missions.map(([id, [value, target, recv]]) => {
              const done = recv === 1 || value >= target;
              const rewards = doc?.missions[id]?.[1] ?? [];
              return (
                <li key={id} className={done ? "done" : undefined}>
                  <span title={doc?.missions[id]?.[0]}>{doc?.missions[id]?.[0] ?? id}</span>
                  <span className="me-tower-reward">
                    {rewards.map(([iid, n]) => {
                      const it = itemOf(iid);
                      return (
                        <button key={iid} type="button" title={it?.n ?? iid} onClick={() => it && onOpenItem?.(it)}>
                          {it?.i ? <img src={itemIcon(it.i)} alt="" width={18} height={18} loading="lazy" /> : null}
                          <em>×{fmtOf(locale)(n)}</em>
                        </button>
                      );
                    })}
                  </span>
                  <i style={{ ["--p" as string]: `${Math.min(1, target ? value / target : 0) * 100}%` }} />
                  <em>{Math.min(value, target)}/{target}</em>
                </li>
              );
            })}
          </ul>

          {/* 저장한 편성은 이어하기에서 뺀다 — 진행 중 판의 '모은 오퍼'가 그 편성을 늘 품고 있다 (사용자 지시 2026-10-17).
              모은 오퍼 쪽에서 편성 밖 오퍼에 '추가 모집'을 단다 */}
        </>
      )}
      {pickMap && (() => {
        const total = doc?.towers[pickMap]?.[2] ?? 0;
        const bg = towerBg(pickMap);
        return (
          <ModalWindow label={name(pickMap)} className="operator-modal me-resume-modal" onClose={() => setPickMap(null)}>
            <div className="me-resume-body">
              <h3>{name(pickMap)}{doc?.towers[pickMap]?.[1] ? <small className="me-note"> · {doc.towers[pickMap][1]}</small> : null}</h3>
              {bg && <img className="me-resume-tower" src={bg} alt="" loading="lazy" />}
              {/* 긴급판은 작전 창 오른쪽 위 '일반 환경 · 긴급 환경' 전환으로 본다 — 목록을 두 번 늘어놓지 않는다 */}
              {floors(pickMap, total, false)}
            </div>
          </ModalWindow>
        );
      })()}
    </>
  );
}

// ── 오퍼 한 칸 (지원 유닛·친구) ──────────────────────────────
function OpChip({ op, c, skillIndex, onShowOperator }: {
  op: MeOp; c: { elite: number; level: number; potential: number; mastery: number[]; skill: number }; skillIndex: number;
  onShowOperator?: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const sk = skillIndex >= 0 ? op.skills[skillIndex] : undefined;
  const m = skillIndex >= 0 ? c.mastery[skillIndex] ?? 0 : 0;
  return (
    <li>
      <button type="button" onClick={() => onShowOperator?.(op.id)} title={op.name}>
        <span className={`me-op-face r${op.rarity}`}>
          <img src={avatarOf(op.id)} alt="" width={56} height={56} loading="lazy" />
          {sk && <img className="me-op-skill" src={asset(`/skills/icon/${sk.icon ?? sk.id}.webp`)} alt="" width={22} height={22} loading="lazy" />}
          {/* 잠재 — 지원 유닛·친구 오퍼 (사용자 지시 2026-10-12). 게임 잠재 아이콘은 에셋에 없어 글자 뱃지로 */}
          {c.potential > 0 && <i className={`me-op-pot${c.potential >= 6 ? " max" : ""}`}>{potText(locale, c.potential)}</i>}
        </span>
        <span className="me-op-name">{op.name}</span>
        <em>{eliteText(locale, c.elite, c.level)}{sk ? ` · ${m ? masteryText(locale, m) : t("스킬 {n}", { n: c.skill })}` : ""}</em>
      </button>
    </li>
  );
}

// ── 친구 ────────────────────────────────────────────────────
function Friends({ me, now, opById, onShowOperator, full }: { me: MeData; now: number; opById: Map<string, MeOp>; onShowOperator?: (id: string) => void; full?: boolean }) {
  const { locale, t } = useI18n();
  const fmt = fmtOf(locale);
  const [all, setAll] = useState(false);
  // 미접속 일수로 거르기 — '{n}일 전'이 보이기 시작한 친구들을 1일·2일·3일 이상으로 (사용자 지시 2026-10-11)
  const [away, setAway] = useState<FriendAway>("all");
  // 정렬 — 접속·이름·레벨, 방향 뒤집기 (사용자 지시 2026-10-11). 친구가 된 날은 게임이 주지 않아 정렬 기준에 없다
  const [sortKey, setSortKey] = useState<FriendSort>("online");
  const [rev, setRev] = useState(false);
  const list = me.profile?.friends;
  if (!me.profile) return null;
  const daysOff = (f: AccountFriend) => (f.lastOnline ? Math.floor((now / 1000 - f.lastOnline) / 86400) : -1);
  const awayOk = (f: AccountFriend, a: FriendAway) => {
    const d = daysOff(f);
    return a === "all" || (a === "3" ? d >= 3 : d === Number(a));
  };
  const cmp: Record<FriendSort, (a: AccountFriend, b: AccountFriend) => number> = {
    online: (a, b) => b.lastOnline - a.lastOnline,
    name: (a, b) => a.nickName.localeCompare(b.nickName, DT_LOCALE[locale]) || a.nickNumber.localeCompare(b.nickNumber),
    level: (a, b) => b.level - a.level || b.lastOnline - a.lastOnline,
  };
  const sorted = [...(list ?? [])].filter((f) => awayOk(f, away)).sort((a, b) => (rev ? -1 : 1) * cmp[sortKey](a, b));
  // 목록 그리기 — 본문(앞 몇 줄)과 '전부 보기' 창(전체)이 같이 쓴다 (사용자 2026-10-07 "페이지가 너무 길어진다")
  const friendList = (items: typeof sorted) => (
    <ul className="me-friends">
      {items.map((f) => (
        <li key={`${f.nickName}#${f.nickNumber}`}>
          <span className="me-avatar sm">{f.secretary && opById.has(f.secretary) ? <img src={avatarOf(f.secretary)} alt="" width={44} height={44} loading="lazy" /> : <b aria-hidden>Dr.</b>}</span>
          <div className="me-friend-name">
            <b>{f.nickName}<small>#{f.nickNumber}</small></b>
            <span>Lv.{f.level} · {rel(t, now, f.lastOnline)}</span>
          </div>
          <ul className="me-ops me-ops-mini">
            {f.assist.map((a, i) => {
              const op = opById.get(a.id);
              return op ? <OpChip key={`${a.id}-${i}`} op={op} c={a} skillIndex={a.skillIndex} onShowOperator={onShowOperator} /> : null;
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
  const awayCount = (a: FriendAway) => (list ?? []).filter((f) => awayOk(f, a)).length;
  return (
    <Card no="FRIENDS" title={t("친구")} className="me-friends-card" aside={list ? <small>{fmt(list.length)} / {me.profile.status.friendLimit ? fmt(me.profile.status.friendLimit) : "—"}</small> : null}>
      {!!list?.length && (
        <div className="me-friend-tools">
          <div className="me-seg" role="group" aria-label={t("미접속")}>
            {([["all", t("전체")], ["1", t("1일 미접")], ["2", t("2일 미접")], ["3", t("3일 이상 미접")]] as [FriendAway, string][]).map(([k, label]) => (
              <button key={k} type="button" className={away === k ? "selected" : ""} onClick={() => setAway(k)}>{label} {fmt(awayCount(k))}</button>
            ))}
          </div>
          <div className="me-seg" role="group" aria-label={t("정렬")}>
            {([["online", t("접속 순")], ["name", t("이름 순")], ["level", t("레벨 순")]] as [FriendSort, string][]).map(([k, label]) => (
              <button key={k} type="button" className={sortKey === k ? "selected" : ""} onClick={() => setSortKey(k)}>{label}</button>
            ))}
          </div>
          <button type="button" className={`me-sort${rev ? " selected" : ""}`} onClick={() => setRev((v) => !v)} title={t("정렬 뒤집기")}>
            <span aria-hidden>⇅</span>{t("뒤집기")}
          </button>
        </div>
      )}
      {list === null ? <p className="me-note">{t("친구 목록을 받아 오지 못했습니다 — 다시 동기화해 보세요.")}</p>
        : !list?.length ? <p className="me-note">{t("친구가 없습니다.")}</p>
        : !sorted.length ? <p className="me-note">{t("조건에 맞는 친구가 없어요.")}</p> : (
        friendList(full ? sorted : sorted.slice(0, FRIEND_FOLD))
      )}
      {!full && sorted.length > FRIEND_FOLD && <MoreButton open={false} total={sorted.length} onToggle={() => setAll(true)} />}
      {all && <MoreModal title={t("친구")} onClose={() => setAll(false)}>{friendList(sorted)}</MoreModal>}
    </Card>
  );
}
type FriendAway = "all" | "1" | "2" | "3";
type FriendSort = "online" | "name" | "level";

// ── 접어 둔 칸 — 진행 상황·친구·최근 얻은 오퍼·창고 ──────────────────
// 바로 볼 일이 적어 그림 깔린 버튼으로 접고, 누르면 창에 그 카드를 통째로 띄운다 (사용자 지시 2026-10-11)
function Drawers({ me, now, owned, opById, stages, items, onOpenStage, onOpenItem, onShowOperator }: {
  me: MeData; now: number; owned: AccountChar[]; opById: Map<string, MeOp>; stages: StageDoc | null; items: ItemDoc | null;
  onOpenStage: (id: string) => void; onOpenItem: (i: DexItem) => void; onShowOperator?: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const fmt = fmtOf(locale);
  const [open, setOpen] = useState<DrawerKey | null>(null);
  const { drawers: drawerOrder } = useMeOrder();
  const p = me.profile;
  // 진행 상황 — 지금 메인 스토리 장의 대표 그림 (main_15-08 → 15장)
  const chap = /^main_(\d+)-/.exec(p?.status.progress ?? "")?.[1];
  const cleared = Object.values(p?.stages ?? {}).filter((v) => v >= 2).length;
  const opDoc = useStageOp();
  const [isOpen] = useState(() => openChecker(now));
  const [isRunning] = useState(() => runningChecker(now));
  const prime = useMemo(() => primeLeft(opDoc, p?.stages, stages, isOpen, isRunning), [opDoc, p?.stages, stages, isOpen, isRunning]);
  // 친구 — 가장 최근에 들어온 친구의 비서 오퍼 정예화 일러
  const friends = [...(p?.friends ?? [])].sort((a, b) => b.lastOnline - a.lastOnline);
  const fSec = friends.find((f) => f.secretary && opById.has(f.secretary))?.secretary;
  // 최근 얻은 오퍼 — 맨 마지막에 들인 오퍼의 일러
  const latest = owned.filter((c) => c.gain).sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0))[0];
  // 창고 — 가장 귀한 재료 몇 개의 아이콘을 겹쳐 깐다
  const inv = p?.inventory;
  const depotIcons = useMemo(() => {
    if (!inv || !items) return [];
    return items.items.filter((i) => i.i && (inv[i.id] ?? 0) > 0 && i.g === "material").sort((a, b) => b.r - a.r || (inv[b.id] ?? 0) - (inv[a.id] ?? 0)).slice(0, 3).map((i) => itemIcon(i.i!));
  }, [inv, items]);
  const bg = (url: string) => ({ ["--bg" as string]: `url(${url})` });
  const tiles: { key: DrawerKey; label: string; head: string; sub: string; top?: React.ReactNode; style?: React.CSSProperties; cls?: string; icons?: string[] }[] = [];
  if (p?.stages) tiles.push({ key: "progress", label: "PROGRESS", head: t("스테이지 클리어 현황"),
    // 순오리지늄 작전 중 지금 입장 가능한 수와 그중 클리어한 수 — 위 '획득 가능'과 같은 모집단이다
    sub: prime ? (t("클리어 {a} · 입장 가능 {b}", { a: fmt(prime.clear), b: fmt(prime.open) }) + (prime.shut ? ` · ${t("입장 불가 {n}", { n: fmt(prime.shut) })}` : "")) : t("클리어한 작전 {n}개", { n: fmt(cleared) }),
    // 순오리지늄은 제목 위 한 줄로 (사용자 지시 2026-10-14 "버튼 위쪽에다")
    top: prime?.n ? <span className="me-prime"><img src={itemIcon("DIAMOND")} alt={t("순오리지늄")} width={16} height={16} />{t("× {n}개 획득 가능", { n: fmt(prime.n) })}</span> : undefined,
    style: bg(asset(`/story/main_${chap && Number(chap) <= 17 ? chap : 17}.webp`)) });
  if (p) tiles.push({ key: "friends", label: "FRIENDS", head: t("친구"), sub: p.friends ? t("{n}명", { n: fmt(p.friends.length) }) : "—",
    style: fSec ? bg(asset(`/skin/full/${fSec}_1.webp`)) : undefined, cls: "art art-r" });
  if (latest) tiles.push({ key: "recent", label: "RECENT", head: t("최근 얻은 오퍼"), sub: opById.get(latest.id)?.name ?? "",
    style: bg(asset(`/skin/full/${latest.id}_1.webp`)), cls: "art" });
  if (inv) tiles.push({ key: "depot", label: "DEPOT", head: t("창고"), sub: t("{n}종", { n: fmt(Object.values(inv).filter((n) => n > 0).length) }), icons: depotIcons });
  // 묶음 안 순서 — 끌어 옮긴 순서(app/me-order.tsx)
  tiles.sort((a, b) => drawerOrder.indexOf(a.key) - drawerOrder.indexOf(b.key));
  const dd = useDrawerDrag(tiles.map((x) => x.key), drawerOrder);
  tiles.sort((a, b) => dd.display.indexOf(a.key) - dd.display.indexOf(b.key));   // 끄는 동안은 놓았을 때의 순서로 미리
  if (!tiles.length) return null;
  const title = (k: DrawerKey) => tiles.find((x) => x.key === k)?.head ?? "";
  return (
    <>
      {/* 다른 칸처럼 카드로 묶는다 — 제목을 잡으면 묶음째 옮겨진다 (사용자 지시 2026-10-15) */}
      <Card no="MORE" title={t("더 보기")} className="me-drawers-card">
      <div className={`me-drawers${dd.dragging ? " me-sorting" : ""}`} ref={dd.ref}>
        {tiles.map((x) => (
          <button key={x.key} type="button" className={`${x.style ? "has-bg" : ""}${x.cls ? ` ${x.cls}` : ""}${dd.cls(x.key)}`} style={x.style} onClick={() => setOpen(x.key)} {...dd.bind(x.key)}>
            {x.icons && <span className="me-drawer-icons" aria-hidden>{x.icons.map((src) => <img key={src} src={src} alt="" width={64} height={64} loading="lazy" />)}</span>}
            <small className="section-no">{x.label}</small>
            {x.top && <span className="me-drawer-top">{x.top}</span>}
            <b>{x.head}</b>
            <em>{x.sub}</em>
          </button>
        ))}
      </div>
      </Card>
      {open && (
        <NoSortHandle>
        <ModalWindow label={title(open)} className={`operator-modal me-drawer-modal me-drawer-${open}`} onClose={() => setOpen(null)}>
          <div className="me-drawer-body">
            {open === "progress" && <Progress me={me} stages={stages} onOpenStage={onOpenStage} full />}
            {open === "friends" && <Friends me={me} now={now} opById={opById} onShowOperator={onShowOperator} full />}
            {open === "recent" && <Recent owned={owned} opById={opById} onShowOperator={onShowOperator} full />}
            {open === "depot" && <Depot me={me} items={items} onOpen={onOpenItem} full />}
          </div>
        </ModalWindow>
        </NoSortHandle>
      )}
    </>
  );
}

// ── 최근 얻은 오퍼 ────────────────────────────────────────────────
function Recent({ owned, opById, onShowOperator, full }: { owned: AccountChar[]; opById: Map<string, MeOp>; onShowOperator?: (id: string) => void; full?: boolean }) {
  const { locale, t } = useI18n();
  const [all, setAll] = useState(false);
  // 성급·직군으로 거르기 (사용자 요청 2026-10-06) — 오퍼 도감과 같은 드롭다운(AttributeFilter), 여러 개 고를 수 있다
  const [rars, setRars] = useState<string[]>([]);
  const [jobSel, setJobSel] = useState<string[]>([]);
  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>) => (v: string) =>
    set((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  const gained = owned.filter((c) => c.gain).sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0));
  const pass = (c: AccountChar, r: string[], j: string[]) => {
    const op = opById.get(c.id);
    return (!r.length || r.includes(String(op?.rarity))) && (!j.length || j.includes(op?.jobCode ?? ""));
  };
  const list = gained.filter((c) => pass(c, rars, jobSel));
  const [gridRef, cols] = useGridCols();
  const fold = (cols || 9) * OPS_ROWS;
  if (!gained.length) return null;
  const rarities = [...new Set(gained.map((c) => opById.get(c.id)?.rarity ?? 0))].filter(Boolean).sort((a, b) => b - a).map(String);
  const jobs = JOB_ORDER.filter((code) => gained.some((c) => opById.get(c.id)?.jobCode === code));
  const jobLabel = (code: string) => opById.get(gained.find((c) => opById.get(c.id)?.jobCode === code)!.id)?.job ?? code;
  // 영입 시각 — 날짜와 시·분까지 (사용자 지시)
  const day = (sec: number) => new Date(sec * 1000).toLocaleDateString(DT_LOCALE[locale], { year: "2-digit", month: "2-digit", day: "2-digit" });
  const time = (sec: number) => new Date(sec * 1000).toLocaleTimeString(DT_LOCALE[locale], { hour: "2-digit", minute: "2-digit", hour12: false });
  // 목록 그리기 — 본문(앞 몇 줄)과 '전부 보기' 창(전체)이 같이 쓴다 (사용자 2026-10-07 "페이지가 너무 길어진다")
  const recentList = (items: typeof list, withRef: boolean) => (
    <ul className="me-ops" ref={withRef ? gridRef : undefined}>
      {items.map((c) => {
        const op = opById.get(c.id)!;
        return (
          <li key={c.id}>
            <button type="button" onClick={() => onShowOperator?.(c.id)} title={op.name}>
              <span className={`me-op-face r${op.rarity}`}><img src={avatarOf(c.id)} alt="" width={56} height={56} loading="lazy" /></span>
              <span className="me-op-name">{op.name}</span>
              <em className="me-when">{day(c.gain!)}<br />{time(c.gain!)}</em>
            </button>
          </li>
        );
      })}
    </ul>
  );
  return (
    <Card no="RECENT" title={t("최근 얻은 오퍼")} className="me-recent"
      aside={(
        <div className="me-recent-tools">
          <AttributeFilter groups={[
            { title: t("성급"), items: rarities, selected: rars, onToggle: toggle(setRars), labelFor: (v) => `${v}★`,
              countForItem: (v) => gained.filter((c) => pass(c, [v], jobSel)).length },
            { title: t("직군"), items: jobs, selected: jobSel, onToggle: toggle(setJobSel), labelFor: jobLabel,
              countForItem: (v) => gained.filter((c) => pass(c, rars, [v])).length },
          ]} />
        </div>
      )}>
      {!list.length && <p className="me-note">{t("조건에 맞는 오퍼가 없어요.")}</p>}
      {recentList(full ? list : list.slice(0, fold), true)}
      {!full && list.length > fold && <MoreButton open={false} total={list.length} onToggle={() => setAll(true)} />}
      {all && <MoreModal title={t("최근 얻은 오퍼")} onClose={() => setAll(false)}>{recentList(list, false)}</MoreModal>}
    </Card>
  );
}

// ── 창고 ────────────────────────────────────────────────────
function Depot({ me, items, onOpen, full }: { me: MeData; items: ItemDoc | null; onOpen: (i: DexItem) => void; full?: boolean }) {
  const { locale, t } = useI18n();
  const fmt = fmtOf(locale);
  const [group, setGroup] = useState<ItemGroup | "all">("all");
  const [q, setQ] = useState("");
  // 창고는 수백 칸이라 처음엔 몇 줄만 — 검색하거나 '전부 보기'를 누르면 다 편다
  const [all, setAll] = useState(false);
  const inv = me.profile?.inventory;
  const [gridRef, cols] = useGridCols();
  const fold = (cols || 10) * DEPOT_ROWS;
  const rows = useMemo(() => {
    if (!inv || !items) return null;
    const byId = new Map(items.items.flatMap((i) => [[i.id, i] as const, ...(i.alt ?? []).map((a) => [a, i] as const)]));
    const out: { item: DexItem; n: number; id: string }[] = [];
    for (const [id, n] of Object.entries(inv)) {
      const item = byId.get(id);
      if (item && n > 0) out.push({ item, n, id });
    }
    return out.sort((a, b) => a.item.s - b.item.s || b.item.r - a.item.r);
  }, [inv, items]);
  if (!inv) return null;
  const nq = normSearch(q);
  const shown = (rows ?? []).filter((r) => (group === "all" || r.item.g === group) && (!nq || normSearch(r.item.n).includes(nq)));
  const count = (g: ItemGroup) => (rows ?? []).filter((r) => r.item.g === g).length;
  // 목록 그리기 — 본문(앞 몇 줄)과 '전부 보기' 창(전체)이 같이 쓴다 (사용자 2026-10-07 "페이지가 너무 길어진다")
  const depotList = (items: typeof shown, withRef: boolean) => (
    <ul className="me-depot-grid" ref={withRef ? gridRef : undefined}>
      {items.map(({ item, n, id }) => (
        <li key={id}>
          <button type="button" onClick={() => onOpen(item)} title={item.n}>
            <span className="me-ico" data-tier={item.r}>{item.i && <img src={itemIcon(item.i)} alt="" width={56} height={56} loading="lazy" />}</span>
            <b>{fmt(n)}</b>
            <span className="me-depot-name">{item.n}</span>
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <Card no="DEPOT" title={t("창고")} className="me-depot"
      aside={(
        <div className="me-depot-tools">
          <div className="me-seg" role="group">
            <button type="button" className={group === "all" ? "selected" : ""} onClick={() => setGroup("all")}>{t("전체")} {fmt(rows?.length ?? 0)}</button>
            {GROUPS.filter((g) => count(g) > 0).map((g) => (
              <button key={g} type="button" className={group === g ? "selected" : ""} onClick={() => setGroup(g)}>{t(GROUP_LABEL[g])} {fmt(count(g))}</button>
            ))}
          </div>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("아이템 이름 검색")} />
        </div>
      )}>
      {!rows ? <p className="me-note">{t("불러오는 중…")}</p> : (
        depotList((nq || full ? shown : shown.slice(0, fold)), true)
      )}
      {rows && !nq && !full && shown.length > fold && <MoreButton open={false} total={shown.length} onToggle={() => setAll(true)} />}
      {all && <MoreModal title={t("창고")} onClose={() => setAll(false)}>{depotList(shown, false)}</MoreModal>}
    </Card>
  );
}
