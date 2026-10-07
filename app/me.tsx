"use client";

// 내 정보 (/me) — 게임 로그인으로 받은 내 계정을 한 화면에 (사용자 요청 2026-10-04).
// 계정 데이터는 me-store 가 브라우저에 보관하고, 오퍼 도감·인프라·아이템 도감·공개채용이 같은 것을 읽는다.
//
// 화면 구성 (넓은 화면 2단):
//   왼쪽  — 박사 카드 · 재화 · 지원 유닛 · 기반시설
//   오른쪽 — 한눈에 보기 · 성급별 육성 · 진행 상황(미클리어 작전) · 공개모집으로 채울 오퍼 · 친구 · 최근 영입
//   맨 아래 — 창고 전체
// 로그인 폼은 제목 오른쪽 버튼 → 모달 (사용자 지시 같은 날). 로그인 전에는 가상의 계정으로 채운 예시 화면을 보여 준다.
// 숫자 칸(한눈에 보기·성급별 육성)은 누르면 해당 오퍼 목록이 모달로 뜬다. 긴 목록은 몇 줄만 보이고 '전부 보기'로 편다.
// 공개모집 슬롯은 빼다 (사용자 지시 — 너무 자주 바뀌어 동기화 시점 값이 쓸모없다).

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { asset } from "./assets";
import { useI18n, rich, DT_LOCALE, type ExtraI18n, type Locale } from "./i18n";
import { ModalWindow } from "./modal-window";
import { useConfirm } from "./confirm";
import { AccountLoginForm, AccountSteps } from "./roster-import";
import { MeVerify } from "./me-verify";
import { AccountError, accountErrorText, syncAccount, ACCOUNT_SERVERS, type AccountChar, type AccountStep } from "./account";
import { cnErrorText } from "./account-cn";
import { clearMe, dropMeToken, eliteText, isCollectible, isMaxed, masteryText, maxEliteOf, meChars, meToken, potText, saveMe, useMe, type MeData, WALLET_ROWS } from "./me-store";
import { loadEnemies, loadEnemyStages, loadEnemyStats, loadFutureDex, loadItems, loadStages } from "./dex-cross";
import { GROUPS, GROUP_LABEL, ItemFile, itemIcon, type DexItem, type ItemDoc, type ItemGroup } from "./items";
import { StageFile } from "./stage-detail";
import { EnemyFile, type Enemy, type EnemyStages } from "./enemy-detail";
import { viewOf, type StageDoc, type StageView } from "./stage-data";
import { normSearch } from "./search";
import { Marquee } from "./marquee";
import { AttributeFilter } from "./attr-filter";
import recruitData from "./data/recruit.json";
import { MeShare } from "./me-share";
import { openChecker } from "./stage-open";
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

/** 제목 오른쪽 — 데이터 지우기 · 다시 동기화. 이 탭에서 로그인한 적이 없으면(토큰 없음) 동기화는 로그인 창을 연다 */
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
      setErr(t((tok.server === "cn" || tok.server === "bili" ? cnErrorText : accountErrorText)(code), { code }));
      // 토큰이 죽었으면(만료·다른 기기 로그인) 지우고 로그인 창으로 — 요스타 단계에서 4xx 가 와도 같은 뜻이다
      if (code === "token-expired") { dropMeToken(); onLogin(); }
    } finally { setBusy(false); }
  };
  const wipe = async () => {
    if (!(await confirm({ message: t("이 브라우저에 저장된 내 계정 데이터를 지웁니다. 오퍼 도감·아이템 도감의 보유 표시도 함께 사라집니다 (인프라 편성은 그대로 남습니다)."), confirmLabel: t("지우기") }))) return;
    clearMe();
  };
  return (
    <div className="me-head-actions">
      {dialog}
      <button type="button" className="import-action" onClick={() => void wipe()}><span className="btn-icon" aria-hidden>✕</span>{t("데이터 지우기")}</button>
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
        <div className="me-col me-col-main">
          <Kpis owned={owned} released={released} opById={opById} me={me} onList={openList} demo={demo} />
          <RarityTable owned={owned} released={released} opById={opById} onList={openList} />
          {/* 공개모집으로 채울 오퍼를 진행 상황 위로 (사용자 지시 2026-10-05) */}
          <RecruitPool mine={mine} opById={opById} onShowOperator={onShowOperator} />
          <Progress me={me} stages={stages} onOpenStage={openStage} />
          <Friends me={me} now={now} opById={opById} onShowOperator={onShowOperator} />
          <Recent owned={owned} opById={opById} onShowOperator={onShowOperator} />
        </div>
      </div>
      <Depot me={me} items={items} onOpen={(i) => setOpenItem(i)} />

      {share && onShareClose && <MeShare me={me} owned={owned} released={released} opById={opById} stages={stages} items={items} onClose={onShareClose} />}
      {list && (
        <ModalWindow key={`ls-${list.key}`} label={list.title} className="operator-modal me-list-modal" onClose={() => setList(null)}>
          <OpListBody title={list.title} entries={list.entries} opById={opById} onShowOperator={onShowOperator} />
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

function Card({ no, title, aside, className, children }: { no: string; title: string; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`me-card${className ? ` ${className}` : ""}`}>
      <header className="me-card-head">
        <div><span className="section-no">{no}</span><h3>{title}</h3></div>
        {aside && <div className="me-card-aside">{aside}</div>}
      </header>
      {children}
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
function OpListBody({ title, entries, opById, onShowOperator }: { title: string; entries: ListEntry[]; opById: Map<string, MeOp>; onShowOperator?: (id: string) => void }) {
  const { locale, t } = useI18n();
  return (
    <div className="me-list">
      <header className="me-list-head">
        <span className="modal-kicker">MY OPERATORS</span>
        <h3>{title}<small>{t("{n}명", { n: fmtOf(locale)(entries.length) })}</small></h3>
      </header>
      <div className="modal-scroll">
        {entries.length ? (
          <ul className="me-ops">
            {entries.map((e) => {
              const op = opById.get(e.id);
              if (!op) return null;
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => onShowOperator?.(e.id)} title={op.name}>
                    <span className={`me-op-face r${op.rarity}`}><img src={avatarOf(op.id)} alt="" width={56} height={56} loading="lazy" /></span>
                    <span className="me-op-name">{op.name}</span>
                    <em>{e.sub}</em>
                  </button>
                </li>
              );
            })}
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
  const server = ACCOUNT_SERVERS.find((s) => s.code === me.server)?.label ?? me.server;
  return (
    <section className="me-card me-profile">
      <div className="me-profile-top">
        <span className="me-avatar">{secretary ? <img src={avatarOf(secretary)} alt="" width={96} height={96} /> : <b aria-hidden>Dr.</b>}</span>
        <div className="me-profile-name">
          <span className="modal-kicker keep">{t(server)}</span>
          <h3>{me.player.nickName}<small>#{me.player.nickNumber}</small></h3>
          <p>Lv.<b>{me.player.level}</b> · UID {me.player.uid}</p>
        </div>
      </div>
      {st?.resume && <p className="me-resume">{st.resume}</p>}
      <dl className="me-facts">
        {st && <div><dt>{t("이성")}</dt><dd><b>{fmt(apNow)}</b> / {fmt(st.maxAp)}<small>{apNow < st.maxAp ? t("{time} 가득", { time: dt((st.apTs + (st.maxAp - st.ap) * 360) * 1000) }) : t("가득 참")}</small></dd></div>}
        {days > 0 && <div><dt>{t("박사 경력")}</dt><dd><b>D+{fmt(days)}</b><small>{t("{date} 입사", { date: day(st!.register * 1000) })}</small></dd></div>}
        {me.profile?.creditSpent != null && <div><dt>{t("누적 소비 크레딧")}</dt><dd><b>{fmt(me.profile.creditSpent)}</b></dd></div>}
        {st?.monthlyEnd ? <div><dt>{t("월정액")}</dt><dd>{st.monthlyEnd * 1000 > now ? t("{n}일 남음", { n: fmt(Math.ceil((st.monthlyEnd * 1000 - now) / 86400000)) }) : t("만료")}</dd></div> : null}
        {!demo && <div><dt>{t("동기화")}</dt><dd>{dt(me.syncedAt)}</dd></div>}
      </dl>
      {!me.profile && <p className="me-note">{t("이 데이터는 오퍼 목록만 들어 있는 예전 형식입니다 — 다시 동기화하면 창고·진행 상황·친구까지 채워집니다.")}</p>}
    </section>
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
  return (
    <Card no="WALLET" title={t("재화")}>
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
    const pct = big && v.total ? `${Math.round((v.value / Math.max(1, v.total)) * 100)}%` : null;
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

function Progress({ me, stages, onOpenStage }: { me: MeData; stages: StageDoc | null; onOpenStage: (id: string) => void }) {
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
  const data = useMemo(() => {
    if (!stages || !rec) return null;
    const byId = new Map(stages.stages.map((s) => [s.id, s]));
    const groups = new Map<string, ProgGroup>();
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
      if (s.t === "ACTIVITY" && s.ev == null && mainZones.has(s.z)) return;
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
    return { list, byId, next };
  }, [stages, rec, camps, me.profile, t, isOpen]);
  if (!rec) return null;
  if (!data) return <Card no="PROGRESS" title={t("진행 상황")}><p className="me-note">{t("불러오는 중…")}</p></Card>;
  const pendingOf = (g: ProgGroup) => (withStars ? [...g.left, ...g.star] : g.left);
  const inCat = data.list.filter((g) => cat === "all" || g.cat === cat);
  const leftTotal = inCat.reduce((n, g) => n + g.left.length, 0);
  const starTotal = inCat.reduce((n, g) => n + g.star.length, 0);
  const camp = data.list.find((g) => g.cat === "camp");
  const ordered = pendingFirst ? [...inCat].sort((a, b) => pendingOf(b).length - pendingOf(a).length || a.order - b.order) : inCat;
  const shown = ordered.slice(0, EP_FOLD);
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
    <Card no="PROGRESS" title={t("진행 상황")}
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
      {ordered.length > EP_FOLD && <MoreButton open={false} total={ordered.length} onToggle={() => setAll(true)} />}
      {all && <MoreModal title={t("진행 상황")} onClose={() => setAll(false)}>{epList(ordered, false)}</MoreModal>}
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
                      const s = data.byId.get(id);
                      if (!s) return null;
                      const kills = s.t === "CAMPAIGN" ? camps?.[id] ?? 0 : null;
                      return (
                        <button key={id} type="button" onClick={() => onOpenStage(id)} title={s.name}>
                          <b>{s.code}</b><span>{s.name}{kills != null ? ` · ${fmt(kills)}/400` : ""}</span>
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
    <ul className="me-ops" ref={withRef ? gridRef : undefined}>
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
        </span>
        <span className="me-op-name">{op.name}</span>
        <em>{eliteText(locale, c.elite, c.level)}{sk ? ` · ${m ? masteryText(locale, m) : t("스킬 {n}", { n: c.skill })}` : ""}</em>
      </button>
    </li>
  );
}

// ── 친구 ────────────────────────────────────────────────────
function Friends({ me, now, opById, onShowOperator }: { me: MeData; now: number; opById: Map<string, MeOp>; onShowOperator?: (id: string) => void }) {
  const { locale, t } = useI18n();
  const fmt = fmtOf(locale);
  const [all, setAll] = useState(false);
  const list = me.profile?.friends;
  if (!me.profile) return null;
  const sorted = [...(list ?? [])].sort((a, b) => b.lastOnline - a.lastOnline);
  // 목록 그리기 — 본문(앞 몇 줄)과 '전부 보기' 창(전체)이 같이 쓴다 (사용자 2026-10-07 "페이지가 너무 길어진다")
  const friendList = (items: typeof sorted, withRef: boolean) => (
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
  return (
    <Card no="FRIENDS" title={t("친구")} aside={list ? <small>{fmt(list.length)} / {me.profile.status.friendLimit ? fmt(me.profile.status.friendLimit) : "—"}</small> : null}>
      {list === null ? <p className="me-note">{t("친구 목록을 받아 오지 못했습니다 — 다시 동기화해 보세요.")}</p>
        : !sorted.length ? <p className="me-note">{t("친구가 없습니다.")}</p> : (
        friendList(sorted.slice(0, FRIEND_FOLD), true)
      )}
      {sorted.length > FRIEND_FOLD && <MoreButton open={false} total={sorted.length} onToggle={() => setAll(true)} />}
      {all && <MoreModal title={t("친구")} onClose={() => setAll(false)}>{friendList(sorted, false)}</MoreModal>}
    </Card>
  );
}

// ── 최근 영입 ────────────────────────────────────────────────
function Recent({ owned, opById, onShowOperator }: { owned: AccountChar[]; opById: Map<string, MeOp>; onShowOperator?: (id: string) => void }) {
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
    <Card no="RECENT" title={t("최근 영입")} className="me-recent"
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
      {recentList(list.slice(0, fold), true)}
      {list.length > fold && <MoreButton open={false} total={list.length} onToggle={() => setAll(true)} />}
      {all && <MoreModal title={t("최근 영입")} onClose={() => setAll(false)}>{recentList(list, false)}</MoreModal>}
    </Card>
  );
}

// ── 창고 ────────────────────────────────────────────────────
function Depot({ me, items, onOpen }: { me: MeData; items: ItemDoc | null; onOpen: (i: DexItem) => void }) {
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
        depotList((nq ? shown : shown.slice(0, fold)), true)
      )}
      {rows && !nq && shown.length > fold && <MoreButton open={false} total={shown.length} onToggle={() => setAll(true)} />}
      {all && <MoreModal title={t("창고")} onClose={() => setAll(false)}>{depotList(shown, false)}</MoreModal>}
    </Card>
  );
}
