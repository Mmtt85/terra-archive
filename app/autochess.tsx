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

import { useEffect, useMemo, useState } from "react";
import { useI18n, rich } from "./i18n";
import { normSearch, useSearchInput } from "./search";
import { asset } from "./assets";
import { ModalWindow } from "./modal-window";
import { loadEnemies } from "./dex-cross";
import { EnemyFile, RANK_KEY, enemyImg, enemyImgBase, type Enemy } from "./enemy-detail";

// ── 데이터 타입 (build-autochess.py 산출과 1:1) ──────────────────────────────
export type AcStep = { c?: string; t: string };
export type AcBond = { id: string; n: string; nation: boolean; min: number; cond?: string; down?: 1; steps: AcStep[]; chess: string[] };
export type AcGar = { d: string; t: string; ic: string };
export type AcChess = {
  id: string; gid?: string | null; op?: string | null; n: string; t: number; sort: number;
  kind: string; bonds: string[]; gar: string[]; garG: string[]; up?: number;
  r?: number; job?: string; jobCode?: string;
  sk?: { n: string; i: number }; mod?: { n: string; i?: string };
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
    diyPool: { op: string; n: string; job?: string; seq?: number; in?: 1 }[];
  };
  bonds: AcBond[];
  chess: AcChess[];
  gar: Record<string, AcGar>;
  equips: AcEquip[];
  bands: AcBand[];
  buffs: { id: string; n: string; d: string; round: number }[];
  enemies: AcEnemy[];
  enemyTypes: Record<string, AcEnemyType>;
  enemyNames: Record<string, string>;
  bosses: AcBoss[];
  milestones: { lv: number; tk: number; id: string; n: string; c: number }[];
  rounds: { r: number; tk: number }[];
  difficulty: Record<string, number>;
};

// 이미지 — build-autochess.py가 public/ac/에 받아 R2로 서빙한다.
// ⚠ 폴더는 ac, 라우트는 /autochess — 이름이 달라야 deploy.sh가 자산만 떼어낸다.
const bondIcon = (id: string) => asset(`/ac/bond/${id}.webp`);
const bandIcon = (id: string) => asset(`/ac/band/${id}.webp`);
const equipIcon = (trap: string) => asset(`/ac/equip/${trap}.webp`);
const garIcon = (k: string) => asset(`/ac/type/${k}.webp`);
const modeIcon = (k: string) => asset(`/ac/mode/${k}.webp`);
const etypeIcon = (k: string) => asset(`/ac/etype/${k}.webp`);
const opFace = (id: string) => asset(`/avatars/${id}.webp`);
const itemIcon = (id: string) => asset(`/items/${id}.webp`);
const hideErr = (ev: React.SyntheticEvent<HTMLImageElement>) => { ev.currentTarget.style.display = "none"; };

// 화면 구성은 **게임 UI를 따른다** (사용자 확정 2026-08-22):
//   S.W.E.E.T. 리포트 = 맹약 · 전략 · 적   /   물자관리소 = 오퍼레이터 · 아이템
// ⚠ 용어도 게임 표기 그대로다 — 기물X 오퍼레이터O, 장비X 아이템O, 밴드X 전략O.
//   코드 안의 chess/equip/band 는 클뜯 필드 이름이라 그대로 두고 화면 문구만 바꾼다.
//   라운드 사이 '전략 전술' 노드에서 고르는 효과(BUFF_GAIN)는 '전략'과 헷갈리므로
//   게임 표기대로 '전략 전술'로 따로 부른다.
const VIEWS = ["report", "shop", "misc"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = {
  report: "S.W.E.E.T. 리포트", shop: "물자관리소", misc: "모드·보상",
};
const REPORT_TABS = ["bond", "band", "enemy"] as const;
type ReportTab = (typeof REPORT_TABS)[number];
const REPORT_LABEL: Record<ReportTab, string> = { bond: "맹약", band: "전략", enemy: "적" };
const SHOP_TABS = ["op", "item"] as const;
type ShopTab = (typeof SHOP_TABS)[number];
const SHOP_LABEL: Record<ShopTab, string> = { op: "오퍼레이터", item: "아이템" };
// ⚠ 물자관리소 ≠ 보급센터 (사용자 교정 2026-08-22). 물자관리소는 **출전 전**에
//   오퍼레이터·아이템을 확인·편성하는 곳이고, 판 안에서 돌아가는 상점(갱신 비용·
//   레벨·진열 칸)은 보급센터다 — 그래서 수치는 이쪽 '모드·보상'으로 옮겼다.
const MISC_TABS = ["mode", "supply", "buff", "reward"] as const;
type MiscTab = (typeof MISC_TABS)[number];
const MISC_LABEL: Record<MiscTab, string> = {
  mode: "모드", supply: "보급센터", buff: "전략 전술", reward: "보상",
};

// 정예화 표기 — 게임 데이터의 PHASE_n을 도감과 같은 말로
const PHASE_LABEL: Record<string, string> = { PHASE_0: "정예화 0", PHASE_1: "정예화 1", PHASE_2: "정예화 2" };
// 상점 등장 방식 — NORMAL만 물자관리소에 뜬다
const KIND_LABEL: Record<string, string> = { NORMAL: "상점 등장", PRESET: "특수 지급", DIY: "자유 선택" };
const MODE_TYPE_LABEL: Record<string, string> = { LOCAL: "입문", SINGLE: "단독", MULTI: "협동" };
// 맹약이 인원을 세는 범위 — 전장만 세는 BOARD는 기본값이라 배지를 붙이지 않는다
const BOND_COND_LABEL: Record<string, string> = {
  BOARD_AND_DECK: "예비 포함", BOARD_ALL_CHESS: "정예화 전원",
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

/** 게임 텍스트를 줄 단위로 — 빈 줄은 버리고 **굵게**는 rich()가 <b>로 바꾼다. */
function Lines({ text, className }: { text: string; className?: string }) {
  const rows = text.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!rows.length) return null;
  return <>{rows.map((r, i) => <p key={i} className={className}>{rich(r)}</p>)}</>;
}

export default function AutochessGuide({ doc }: { doc: AutochessDoc }) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<View>("report");
  const [reportTab, setReportTab] = useState<ReportTab>("bond");
  const [shopTab, setShopTab] = useState<ShopTab>("op");
  const [miscTab, setMiscTab] = useState<MiscTab>("mode");
  const [etype, setEtype] = useState("");              // 특훈 적 유형 거르기 ("" = 전체)
  const [bond, setBond] = useState<AcBond | null>(null);
  const [chess, setChess] = useState<AcChess | null>(null);
  const [equip, setEquip] = useState<AcEquip | null>(null);
  const [band, setBand] = useState<AcBand | null>(null);
  const [enemy, setEnemy] = useState<string | null>(null);   // 적 id (딸린 적·연계 소환도 열 수 있어 id로 든다)
  const [tier, setTier] = useState(0);                 // 0 = 전체
  const [bondFilter, setBondFilter] = useState("");
  const [shopMode, setShopMode] = useState("mode_single_normal");
  const { term, clear, inputProps } = useSearchInput();

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
  // 표준 시뮬레이션은 맹약이 13개뿐 — 어느 모드에서 도는 맹약인지 배지로 알린다
  const funnyBonds = useMemo(
    () => new Set(doc.modes.find((m) => m.diff === "FUNNY")?.bonds ?? []), [doc]);

  const enemyDex = useEnemyDex(locale, view === "report" && reportTab === "enemy");
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
  const opPath = (id: string) => `${locale === "ko" ? "" : `/${locale}`}/operators/${id}`;

  const nameOfBond = (id: string) => bondById.get(id)?.n ?? id;

  const q = normSearch(term);
  const chessRows = useMemo(() => doc.chess.filter((c) => {
    // 자유 선택 슬롯 4칸은 오퍼레이터가 아니라 빈 칸이다 — 목록 맨 아래 후보 명단이
    // 그 자리를 대신하므로 카드에서는 뺀다 (2026-08-22)
    if (c.kind === "DIY") return false;
    if (tier && c.t !== tier) return false;
    if (bondFilter && !c.bonds.includes(bondFilter)) return false;
    if (!q) return true;
    const hay = [c.n, c.job ?? "", c.sk?.n ?? "", c.mod?.n ?? "",
      ...c.bonds.map(nameOfBond),
      ...[...c.gar, ...c.garG].map((g) => doc.gar[g]?.d ?? "")].join(" ");
    return normSearch(hay).includes(q);
  }), [doc, tier, bondFilter, q]);   // eslint-disable-line react-hooks/exhaustive-deps

  const equipRows = useMemo(() => doc.equips.filter((e) => {
    if (tier && e.t !== tier) return false;
    if (bondFilter && e.bond !== bondFilter) return false;
    if (!q) return true;
    return normSearch(`${e.n} ${e.d} ${e.dG} ${e.bond ? nameOfBond(e.bond) : ""}`).includes(q);
  }), [doc, tier, bondFilter, q]);   // eslint-disable-line react-hooks/exhaustive-deps

  const bandRows = useMemo(() => doc.bands.filter((b) =>
    !q || normSearch(`${b.n} ${b.d}`).includes(q)), [doc, q]);

  // ── 조각들 ────────────────────────────────────────────────────────────────
  const tierBadge = (n: number) => <em className={`ac-tier ac-t${n}`}>T{n}</em>;

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

  const garLine = (id: string, gold: boolean) => {
    const g = doc.gar[id];
    if (!g) return null;
    return (
      <div key={`${id}${gold ? "-g" : ""}`} className={`ac-gar${gold ? " gold" : ""}`}>
        <span className="ac-gar-type">
          <img src={garIcon(g.ic)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
          {g.t}
        </span>
        <span className="ac-gar-txt">{rich(g.d)}</span>
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
      onClick={() => setChess(c)}>
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

  const filterBar = (
    <div className="ac-filters">
      <div className="search-wrap heading-search sim-search">
        <span>⌕</span>
        <input {...inputProps} placeholder={t("이름·능력 검색")} autoComplete="off" spellCheck={false} />
        <button type="button" className="search-clear" onClick={() => clear()} aria-label={t("검색어 지우기")}>×</button>
      </div>
      <div className="ac-tierbar" role="group" aria-label={t("티어")}>
        <button type="button" className={tier === 0 ? "on" : ""} onClick={() => setTier(0)}>{t("전체")}</button>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button key={n} type="button" className={`ac-t${n}${tier === n ? " on" : ""}`} onClick={() => setTier(n)}>T{n}</button>
        ))}
      </div>
      <select className="ac-bondsel" value={bondFilter} onChange={(e) => setBondFilter(e.target.value)}
        aria-label={t("맹약으로 거르기")}>
        <option value="">{t("맹약 전체")}</option>
        {doc.bonds.map((b) => <option key={b.id} value={b.id}>{b.n}</option>)}
      </select>
    </div>
  );

  return (
    <section className="ac-guide" aria-labelledby="ac-title">
      <header className="sim-head">
        <span className="section-no">STRONGHOLD PROTOCOL</span>
        <h2 id="ac-title">{doc.name}</h2>
      </header>
      <p className="sim-intro">{t("맹약(진영·특성)별 오퍼레이터와 각자의 위수 협의 전용 능력, 특훈 적과 리더 적, 보급센터 수치를 게임 데이터에서 그대로 정리했습니다.")}</p>
      {doc.krOnly && (
        <p className="sim-note">{t("이 모드는 아직 글로벌 서버에 출시되지 않아 설명문은 한국어 원문으로 표시됩니다. 일부 이름은 시즌 1의 영어 표기입니다.")}</p>
      )}

      <div className="sb-views ac-views" role="tablist" aria-label={t("위수 협의 보기")}>
        {VIEWS.map((vw) => (
          <button key={vw} type="button" role="tab" aria-selected={view === vw}
            className={view === vw ? "on" : ""} onClick={() => setView(vw)}>
            {t(VIEW_LABEL[vw])}
          </button>
        ))}
      </div>

      {/* ══ S.W.E.E.T. 리포트 — 맹약 · 전략 · 적 ══ */}
      {view === "report" && (
        <>
          <div className="ac-subtabs" role="tablist" aria-label={t("S.W.E.E.T. 리포트")}>
            {REPORT_TABS.map((tb) => (
              <button key={tb} type="button" role="tab" aria-selected={reportTab === tb}
                className={reportTab === tb ? "on" : ""} onClick={() => setReportTab(tb)}>
                {t(REPORT_LABEL[tb])}
              </button>
            ))}
          </div>

          {reportTab === "bond" && (
            <>
              <p className="sim-note">{t("전장에 같은 맹약의 오퍼레이터를 모을수록 단계별 효과가 열립니다. 카드를 누르면 전체 효과와 소속 오퍼레이터를 볼 수 있습니다.")}</p>
              {[true, false].map((nation) => {
                const rows = doc.bonds.filter((b) => b.nation === nation);
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

          {reportTab === "band" && (
            <>
              <p className="sim-note">{t("전략은 판을 시작할 때 고르는 조직입니다. 고유 효과와 시작 목표 HP가 다릅니다.")}</p>
              <div className="ac-filters">
                <div className="search-wrap heading-search sim-search">
                  <span>⌕</span>
                  <input {...inputProps} placeholder={t("이름·능력 검색")} autoComplete="off" spellCheck={false} />
                  <button type="button" className="search-clear" onClick={() => clear()} aria-label={t("검색어 지우기")}>×</button>
                </div>
              </div>
              <p className="ac-count">{t("{n}종", { n: bandRows.length })}</p>
              <div className="ac-cards">
                {bandRows.map((b) => (
                  <button key={b.id} type="button" className="ac-card ac-bandcard" onClick={() => setBand(b)}>
                    <header>
                      <img className="ac-thumb" src={bandIcon(b.id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                      <div>
                        <b className="ac-cname">{b.n}</b>
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

          {reportTab === "enemy" && (
            <>
              <p className="sim-note">{t("판마다 특훈 적 유형이 뽑히고, 그 유형의 적이 딸린 부대와 함께 나옵니다. 14라운드(표준 시뮬레이션은 9라운드)에는 리더 적이 기다립니다. 카드를 누르면 스탯과 능력, 함께 나오는 적을 볼 수 있습니다.")}</p>

              {/* 리더 적 — 유형 추첨과 별개라 맨 위에 따로 (사용자 지시 2026-08-22) */}
              <section className="ac-enemygrp">
                <h3 className="sb-h3">{t("리더 적")} <em className="sb-count">{doc.bosses.length}</em></h3>
                {[false, true].map((hide) => {
                  const rows = doc.bosses.filter((b) => b.hide === hide);
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
              <p className="ac-count">{t("{n}종", { n: doc.enemies.filter((e) => !etype || e.type === etype).length })}</p>
              {etypes.map(([ty, info]) => {
                if (etype && ty !== etype) return null;
                const rows = doc.enemies.filter((e) => e.type === ty);
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
                    <div className="ac-encards">
                      {rows.map((e) => (
                        <button key={e.id} type="button" className="ac-encard" onClick={() => setEnemy(e.id)}>
                          <EnFace id={e.id} />
                          <span className="ac-encard-body">
                            <i className="ac-encode">{e.code ?? "—"}</i>
                            <b>{e.n}</b>
                            <span className="ac-encard-meta">
                              {e.rank && <em className={`en-rank r-${e.rank.toLowerCase()}`}>{t(RANK_KEY[e.rank] ?? e.rank)}</em>}
                              <em>{e.half ? t("전반") : t("후반")}</em>
                              {/* 가중치는 대부분 기본값이라, 더 자주·덜 나오는 적만 짚는다 */}
                              {e.w !== ENEMY_W_BASE && <em className="ac-enw">{t("가중치 {n}", { n: e.w })}</em>}
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
        </>
      )}

      {/* ══ 물자관리소 — 출전 전에 오퍼레이터·아이템을 확인·편성하는 곳 ══
          ⚠ 판 안에서 도는 상점(보급센터)과는 다르다 — 갱신 비용·관리소 레벨 같은
             인게임 수치는 '모드·보상 → 보급센터'로 옮겼다 (사용자 교정 2026-08-22). */}
      {view === "shop" && (
        <div className="ac-shop">
          <div className="ac-subtabs" role="tablist" aria-label={t("물자관리소")}>
            {SHOP_TABS.map((tb) => (
              <button key={tb} type="button" role="tab" aria-selected={shopTab === tb}
                className={shopTab === tb ? "on" : ""}
                onClick={() => setShopTab(tb)}>
                {t(SHOP_LABEL[tb])}
              </button>
            ))}
          </div>

          {shopTab === "op" && (
            <>
              {filterBar}
              <p className="sim-note">{t("오퍼레이터마다 위수 협의 전용 능력이 하나씩 붙고, 같은 오퍼레이터 {n}장을 모아 정예화(골든)하면 그 능력이 강해집니다.", { n: doc.chess[0]?.up ?? 3 })}</p>
              <p className="ac-count">{t("{n}명", { n: chessRows.length })}</p>
              {/* 티어별로 묶는다 (사용자 지시 2026-08-22) — 133명을 한 덩어리로 늘어놓으면
                  "몇 티어에 누가 있나"를 못 읽는다. 티어 필터를 걸면 그 티어만 남는다. */}
              {[1, 2, 3, 4, 5, 6].map((tn) => {
                const rows = chessRows.filter((c) => c.t === tn);
                if (!rows.length) return null;
                return (
                  <section key={tn} className="ac-tiersec">
                    <h3 className="ac-tierhead">{tierBadge(tn)}<span>{t("{n}명", { n: rows.length })}</span></h3>
                    <div className="ac-cards">
                      {rows.map((c) => (
                        <button key={c.id} type="button" className="ac-card ac-chesscard" onClick={() => setChess(c)}>
                          <header>
                            {c.op
                              ? <img className="ac-thumb" src={opFace(c.op)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                              : <span className="ac-thumb ac-face-diy" aria-hidden>?</span>}
                            <div>
                              <b className="ac-cname">{c.n}</b>
                              <span className="ac-cmeta">
                                {c.r ? <i className="ac-star">★{c.r}</i> : null}
                                {c.job ? <i className="sb-chip">{c.job}</i> : null}
                                {c.kind !== "NORMAL" && <i className="sb-chip ac-kind">{t(KIND_LABEL[c.kind] ?? c.kind)}</i>}
                              </span>
                            </div>
                          </header>
                          {/* 카드 전체가 버튼이라 안쪽 맹약은 태그로 — 버튼 중첩은 HTML 위반이라
                              하이드레이션 오류가 났다 (2026-08-22 콘솔 실측). 모달 안 칩은 그대로 누른다. */}
                          <div className="ac-bondline">{c.bonds.map((b) => bondTag(b))}</div>
                          {c.gar.map((g) => garLine(g, false))}
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
              {!chessRows.length && <p className="sb-dim">{t("조건에 맞는 오퍼레이터가 없습니다.")}</p>}

              {/* 자유 선택 칸 후보 — 편성하는 자리라 오퍼레이터 목록 맨 밑에 붙인다
                  (사용자 지시 2026-08-22). 클뜯에는 후보 명단이 없고 '★6' 조건뿐이라
                  ★6 전원에서 **이미 상점 명단에 있는 오퍼레이터를 뺀** 나머지를 싣는다. */}
              <h3 className="sb-h3">{t("자유 선택 칸")} <em className="sb-count">{diyPool.length}</em></h3>
              <p className="sb-dim">{t("보급센터 레벨 5·6에서 각각 {n}칸씩 열립니다. 게임 데이터에는 후보 명단 대신 '★6 오퍼레이터'라는 조건만 들어 있어, 위 목록에 이미 들어 있는 ★6을 뺀 나머지 KR 출시 ★6 전원을 싣습니다. 누르면 오퍼레이터 상세로 갑니다.", { n: 2 })}</p>
              <div className="ac-diypool">
                {diyPool.map((o) => (
                  <button key={o.op} type="button" className="ac-diyop"
                    onClick={() => setChess({
                      id: `diy_${o.op}`, op: o.op, n: o.n, t: 6, sort: 0,
                      kind: "DIY", bonds: [], gar: [], garG: [], r: 6, job: o.job,
                    })}>
                    <img src={opFace(o.op)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                    <b>{o.n}</b>
                  </button>
                ))}
              </div>
            </>
          )}

          {shopTab === "item" && (
            <>
              {filterBar}
              <p className="sim-note">{t("아이템은 오퍼레이터에 장착해 능력치를 올립니다. 같은 아이템 {n}개를 모으면 강화판이 되고, 진영 아이템은 해당 맹약의 중첩도 함께 올려 줍니다.", { n: doc.equips[0]?.up ?? 2 })}</p>
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
              {!equipRows.length && <p className="sb-dim">{t("조건에 맞는 아이템이 없습니다.")}</p>}
            </>
          )}
        </div>
      )}

      {/* ══ 모드·보상 — 판에 들어간 뒤 돌아가는 것들 ══ */}
      {view === "misc" && (
        <div className="ac-misc">
          <div className="ac-subtabs" role="tablist" aria-label={t("모드·보상")}>
            {MISC_TABS.map((tb) => (
              <button key={tb} type="button" role="tab" aria-selected={miscTab === tb}
                className={miscTab === tb ? "on" : ""} onClick={() => setMiscTab(tb)}>
                {t(MISC_LABEL[tb])}
              </button>
            ))}
          </div>

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

          {miscTab === "buff" && (
            <>
              <p className="sim-note">{t("라운드 사이의 '전략 전술'에서 고르는 효과입니다. 판 시작 때 고르는 '전략'과는 다릅니다.")}</p>
              <p className="ac-count">{t("{n}종", { n: doc.buffs.length })}</p>
              <div className="ac-buffs">
                {doc.buffs.map((b) => (
                  <div key={b.id} className="ac-buff"><b>{b.n}</b><span>{rich(b.d)}</span></div>
                ))}
              </div>
            </>
          )}

          {miscTab === "reward" && (
            <>
              <h3 className="sb-h3">{t("라운드 보상")}</h3>
              <p className="sb-dim">{t("라운드를 넘길 때마다 받는 {token} 수량입니다.", { token: doc.token })}</p>
              <div className="ac-rounds">
                {doc.rounds.map((r) => (
                  <div key={r.r} className="ac-round"><b>{r.r}R</b><span>{r.tk}</span></div>
                ))}
              </div>

              <h3 className="sb-h3">{t("마일스톤 보상")} <em className="sb-count">{doc.milestones.length}</em></h3>
              <p className="sb-dim">{t("{token}을 모으면 단계마다 받습니다.", { token: doc.token })}</p>
              <div className="ac-msgrid">
                {doc.milestones.map((m) => (
                  <div key={m.lv} className="ac-ms">
                    <span className="ac-ms-lv">{m.lv}</span>
                    <img src={itemIcon(m.id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                    <b>{m.n}</b>
                    <span className="ac-ms-c">×{m.c}</span>
                    <span className="ac-ms-tk">{m.tk}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}


      {bond && (
        <ModalWindow label={bond.n} className="operator-modal ac-modal" onClose={() => setBond(null)}>
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
            <h4>{t("효과")}</h4>
            <ol className="ac-steps">
              {bond.steps.map((s, i) => (
                <li key={i}>
                  {s.c && <span className="ac-stepcond">{rich(s.c)}</span>}
                  <span className="ac-steptxt">{rich(s.t)}</span>
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
          </div>
        </ModalWindow>
      )}

      {/* ── 기물 상세 모달 ── */}
      {chess && (
        <ModalWindow label={chess.n} className="operator-modal ac-modal" onClose={() => setChess(null)}>
          <div className="ac-dt">
            <header className="ac-dt-head">
              {chess.op
                ? <img src={opFace(chess.op)} alt="" aria-hidden onError={hideErr} />
                : <span className="ac-thumb ac-face-diy" aria-hidden>?</span>}
              <div>
                <h2>{chess.n}</h2>
                <p className="ac-cmeta">
                  {tierBadge(chess.t)}
                  {chess.r ? <i className="ac-star">★{chess.r}</i> : null}
                  {chess.job ? <i className="sb-chip">{chess.job}</i> : null}
                  <i className="sb-chip ac-kind">{t(KIND_LABEL[chess.kind] ?? chess.kind)}</i>
                </p>
                <p className="ac-bondline">{chess.bonds.map((b) => bondChip(b))}</p>
              </div>
            </header>

            <h4>{t("위수 협의 능력")}</h4>
            {chess.gar.length || chess.garG.length ? (
              <>
                {chess.gar.map((g) => garLine(g, false))}
                {chess.garG.length > 0 && (
                  <>
                    <p className="ac-goldhead">{t("정예화(골든)")}</p>
                    {chess.garG.map((g) => garLine(g, true))}
                  </>
                )}
              </>
            ) : chess.id.startsWith("diy_")
              /* 자유 선택 칸으로만 데려오는 ★6 — 상점 명단이 아니라 전용 능력이 아예 없다 */
              ? <p className="sb-dim">{t("보급센터 자유 선택 칸으로만 데려올 수 있는 오퍼레이터입니다. 상점 명단에 없어 전용 능력·기본 스킬 설정이 게임 데이터에 들어 있지 않습니다.")}</p>
              : <p className="sb-dim">{t("전용 능력이 없는 오퍼레이터입니다.")}</p>}
            {chess.op && (
              <p className="ac-oplink"><a href={opPath(chess.op)}>{t("오퍼레이터 도감에서 보기")} →</a></p>
            )}

            {(chess.sk || chess.mod) && (
              <>
                <h4>{t("기본 스킬·모듈")}</h4>
                <p className="sb-dim ac-note">{t("오퍼레이터가 기본으로 들고 나오는 설정입니다.")}</p>
                <ul className="ac-kv">
                  {chess.sk && <li><span>{t("스킬")}</span><b>{t("{n}스킬", { n: chess.sk.i })} · {chess.sk.n}</b></li>}
                  {chess.mod && <li><span>{t("모듈")}</span><b>{chess.mod.n}{chess.mod.i ? ` (${chess.mod.i.toUpperCase()})` : ""}</b></li>}
                </ul>
              </>
            )}

            <h4>{t("가격과 능력치")}</h4>
            {(() => {
              const row = doc.shop.tiers.find((x) => x.t === chess.t);
              if (!row) return null;
              return (
                <div className="ac-tablewrap">
                  <table className="ac-table ac-table-sm">
                    <thead><tr><th /><th>{t("구매")}</th><th>{t("정예화")}</th><th>{t("레벨")}</th><th>{t("스킬")}</th><th>{t("모듈")}</th></tr></thead>
                    <tbody>
                      <tr><th scope="row">{t("일반")}</th><td>{row.b.buy}</td><td>{t(PHASE_LABEL[row.b.ph] ?? row.b.ph)}</td><td>Lv{row.b.lv}</td><td>{row.b.sk}</td><td>{row.b.md ? t("{n}단계", { n: row.b.md }) : "—"}</td></tr>
                      <tr className="ac-gold-row"><th scope="row">{t("골든")}</th><td>{t("{n}장", { n: chess.up ?? 3 })}</td><td>{t(PHASE_LABEL[row.g.ph] ?? row.g.ph)}</td><td>Lv{row.g.lv}</td><td>{row.g.sk}</td><td>{row.g.md ? t("{n}단계", { n: row.g.md }) : "—"}</td></tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </ModalWindow>
      )}

      {/* ── 장비 상세 모달 ── */}
      {equip && (
        <ModalWindow label={equip.n} className="operator-modal ac-modal" onClose={() => setEquip(null)}>
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
            <Lines text={equip.d} />
            {equip.dG && equip.dG !== equip.d && (
              <>
                <p className="ac-goldhead">{t("강화 ({n}개 조합)", { n: equip.up ?? 2 })}</p>
                <div className="ac-gar gold"><span className="ac-gar-txt"><Lines text={equip.dG} /></span></div>
              </>
            )}
            {equip.bond && (
              <p className="sb-dim">{t("장착하면 {bond} 맹약의 중첩도 함께 올라갑니다.", { bond: nameOfBond(equip.bond) })}</p>
            )}
          </div>
        </ModalWindow>
      )}

      {/* ── 밴드 상세 모달 ── */}
      {band && (
        <ModalWindow label={band.n} className="operator-modal ac-modal" onClose={() => setBand(null)}>
          <div className="ac-dt">
            <header className="ac-dt-head">
              <img src={bandIcon(band.id)} alt="" aria-hidden onError={hideErr} />
              <div>
                <h2>{band.n}</h2>
                <p className="ac-cmeta">
                  {band.by && <i className="sb-chip">{band.by}</i>}
                  <i className="sb-chip ac-hp">{t("목표 HP")} {band.hp}</i>
                  {band.modes.map((m) => <i key={m} className="sb-chip">{t(MODE_TYPE_LABEL[m] ?? m)}</i>)}
                </p>
              </div>
            </header>
            <h4>{t("효과")}</h4>
            <Lines text={band.d} />
            {/* 해금 조건 — 37개 중 25개만 조건이 있다 (사용자 요청 2026-08-22) */}
            <h4>{t("해금 조건")}</h4>
            {band.un
              ? <p className="ac-unlock">{rich(band.un)}</p>
              : <p className="sb-dim">{t("처음부터 고를 수 있는 전략입니다.")}</p>}
          </div>
        </ModalWindow>
      )}

      {/* ── 적 상세 모달 — 본문은 적 도감과 같은 EnemyFile을 쓰고(스탯·능력·면역),
             그 아래 이 모드에서만 뜻이 있는 등장 정보를 덧댄다. 도감 데이터가 아직
             안 왔으면 이름·초상만 먼저 띄운다 (사용자 요청 2026-08-22). ── */}
      {enemy && (
        <ModalWindow label={enemyRow?.n ?? bossRow?.n ?? enemyName(enemy)} className="operator-modal ac-modal ac-enmodal"
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
