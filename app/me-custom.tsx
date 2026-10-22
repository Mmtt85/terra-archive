"use client";

// 내 정보 '한눈에 보기'의 맞춤 칸 — 훈장 오른쪽 '+ 항목 추가'로 사용자가 직접 만든다 (사용자 요청 2026-10-04).
// 제목을 쓰고 조건(성급·정예화·레벨·잠재·스킬 레벨·몇 번째 스킬의 마스터·모듈·신뢰도)을 조합하면
// "그 조건에 맞는 내 오퍼 수"가 칸이 된다. 다른 칸처럼 누르면 해당 오퍼 목록이 뜨고, ✎로 고치거나 지운다.
// 칸 정의는 이 브라우저에만 저장한다 (계정과 무관한 화면 설정이다).

import { useState, useSyncExternalStore } from "react";
import { useI18n } from "./i18n";
import { ModalWindow } from "./modal-window";
import { Dropdown } from "./dropdown";
import { NumInput } from "./num-input";
import type { AccountChar } from "./account";
import { isMaxed, masteryText, potText, trustPct } from "./me-store";
// '현재 / 전체'의 전체 수 — 게임 표에서 센 것 (scripts/build-me-meta.py)
import meMeta from "./data/me-meta.json";
import { asset } from "./assets";

// 편집 창 꾸밈 — 조건에 맞는 첫 오퍼의 일러스트(창 뒤)와 얼굴 줄(미리보기). 스킨을 입혔으면 그 스킨, 없으면 정예화 단계 일러
const faceOf = (id: string) => asset(`/avatars/${id}.webp`);
export const fullArtOf = (c: AccountChar) => asset(`/skin/full/${encodeURIComponent(c.skin ? (c.skin.includes("@") ? c.skin.replace("@", "_") : c.skin.replace("#", "_")) : `${c.id}_${c.elite >= 2 ? 2 : 1}`)}.webp`);

/** 조건 — 비어 있으면(0·빈 배열·"") 따지지 않는다 */
export type Cond = {
  rarity: number[];
  elite: number;          // 정예화 이상
  maxed: boolean;         // 최종 정예화 만렙
  level: number;          // 레벨 이상
  pot: number;            // 잠재 — 이 값과 같은 오퍼 (1 명함 ~ 6 풀잠)
  skill: number;          // 스킬 레벨 — 이 값과 같은 오퍼 (1~7, '아무 스킬')
  /** 1·2·3스킬 각각의 마스터 — 고른 값 중 하나면 된다(또는), 스킬끼리는 모두 만족(그리고). 빈 배열이면 안 따진다 */
  ms: [number[], number[], number[]];
  /** 모듈 종류(X·Y·α·Δ…)별 레벨 — 고른 값 중 하나면 된다(또는), 종류끼리는 모두 만족(그리고). 그 종류 모듈이 없는 오퍼는 빠진다 */
  mods: Record<string, number[]>;
  trust: number;          // 신뢰도 % 이상
  /** 레벨·신뢰도 구간의 위끝 (2026-10-22~ "30레벨대"·"50~99%"·직접 입력). 없으면 아래끝 '이상'(옛 칸) */
  levelMax?: number;
  trustMax?: number;
};
// 잠재·스킬 레벨·마스터는 **고른 값과 같은** 오퍼만 센다 (명함·1잠…풀잠처럼 단계를 하나 고르는 방식이라, '이상'이면
// 명함이 '상관없음'과 같아진다). 신뢰도만 연속값이라 '이상'.
/** '한눈에 보기' 칸 하나 — 조건으로 세는 칸(cond)과, 조건으로 못 나타내는 계정 숫자 칸(builtin).
 *  labelKey 가 있으면 사전 키(기본 칸)라 언어에 맞춰 번역하고, 사용자가 제목을 고치면 label 만 남는다. */
export type BuiltinKey = "owned" | "six" | "unowned" | "m3skills" | "mod3" | "skins" | "medals";
export type CustomTile =
  | { id: string; kind?: "cond"; label: string; labelKey?: string; cond: Cond; total: boolean }
  | { id: string; kind: "builtin"; key: BuiltinKey; label: string; labelKey?: string };
export const tileLabel = (tile: CustomTile, t: (k: string) => string) => (tile.labelKey ? t(tile.labelKey) : tile.label);

// 배치 전체(기본 칸 + 만든 칸)를 한 목록으로 저장한다 — 기본 칸도 고치고 지울 수 있게 (사용자 지시 2026-10-05).
// 종전 ta:me-tiles(만든 칸만)는 처음 읽을 때 기본 배치 뒤에 붙여 옮긴다.
const KEY = "ta:me-layout";
const OLD_KEY = "ta:me-tiles";
const EVENT = "ta:me-tiles-change";
export const MAX_CUSTOM = 24;
const EMPTY: Cond = { rarity: [], elite: 0, maxed: false, level: 0, pot: 0, skill: 0, ms: [[], [], []], mods: {}, trust: 0 };
const hasMastery = (cond: Cond) => cond.ms.some((x) => x.length > 0);
/** 구간 글자 — 같으면 하나("Lv.55"), 다르면 "Lv.30~39" */
const rangeText = (lo: number, hi: number, pre: string, post: string) => (lo === hi ? `${pre}${lo}${post}` : `${pre}${lo}~${hi}${post}`);
// 레벨 구간 (사용자 지시 2026-10-22 "30레벨대·40레벨대, 만렙은 90·80과 같으니 빼고, 직접 입력도")
const LEVEL_BANDS: [number, number][] = [[1, 9], [10, 19], [20, 29], [30, 39], [40, 49], [50, 59], [60, 69], [70, 79], [80, 89], [90, 90]];
// 신뢰도 구간 (같은 날 "0~49 50~99 100~149 150~199, 200, 직접 입력")
const TRUST_BANDS: [number, number][] = [[0, 49], [50, 99], [100, 149], [150, 199], [200, 200]];

const B = (key: BuiltinKey, labelKey: string): CustomTile => ({ id: `b-${key}`, kind: "builtin", key, label: labelKey, labelKey });
const C = (id: string, labelKey: string, cond: Partial<Cond>): CustomTile => ({ id, label: labelKey, labelKey, cond: { ...EMPTY, ...cond }, total: false });
/** 기본 배치 — 첫 줄은 보유 오퍼(넓은 칸) + 보유 스킨 + 훈장 (사용자 지시 2026-10-05). 미보유는 기본에서 뺐고(필요하면 추가),
 *  6성 보유는 계정 숫자가 아니라 조건 칸(6성 · 인원 수/전체)이다. */
const CT = (id: string, labelKey: string, cond: Partial<Cond>): CustomTile => ({ ...C(id, labelKey, cond), total: true } as CustomTile);
export const DEFAULT_LAYOUT: CustomTile[] = [
  B("owned", "보유 오퍼"), B("skins", "보유 스킨"), B("medals", "훈장"),
  CT("d-six", "6성 보유", { rarity: [6] }),
  C("d-e2", "정예화 2", { elite: 2 }),
  C("d-six90", "6성 2정 90", { rarity: [6], maxed: true }),
  C("d-maxed", "만렙 (최종 정예화)", { maxed: true }),
  C("d-pot6", "풀잠 (잠재 6)", { pot: 6 }),
  C("d-sk7", "스킬 7레벨", { skill: 7 }),
  B("m3skills", "3마스터 스킬"),
  C("d-m9", "3스킬 모두 3마스터", { ms: [[3], [3], [3]] }),
  B("mod3", "모듈 Lv.3"),
  C("d-trust", "신뢰도 200%", { trust: 200 }),
];

const fixCond = (raw: Partial<Cond> | undefined): Cond => {
  const cond = { ...EMPTY, ...raw };
  if (!Array.isArray(cond.ms) || cond.ms.length !== 3) cond.ms = [[], [], []];
  if (!cond.mods || typeof cond.mods !== "object") cond.mods = {};
  return cond;
};

let cachedRaw: string | null | undefined;
let cached: CustomTile[] = DEFAULT_LAYOUT;
function read(): CustomTile[] {
  let raw: string | null = null;
  let old: string | null = null;
  try { raw = localStorage.getItem(KEY); old = raw ? null : localStorage.getItem(OLD_KEY); } catch { raw = null; }
  const sig = raw ?? `old:${old ?? ""}`;
  if (sig === cachedRaw) return cached;
  cachedRaw = sig;
  try {
    const list = raw ? JSON.parse(raw) : [...DEFAULT_LAYOUT, ...(old ? JSON.parse(old) : [])];
    cached = Array.isArray(list) ? list.map((x: CustomTile) => (x.kind === "builtin" ? x : { ...x, cond: fixCond((x as { cond?: Partial<Cond> }).cond) })) : DEFAULT_LAYOUT;
  } catch { cached = DEFAULT_LAYOUT; }
  return cached;
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}
export function useCustomTiles(): CustomTile[] {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_LAYOUT);
}
export function saveCustomTiles(list: CustomTile[] | null) {
  try {
    if (list) localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_CUSTOM)));
    else localStorage.removeItem(KEY);   // null = 기본 배치로 되돌리기
    localStorage.removeItem(OLD_KEY);
  } catch { /* 저장 못 하면 이번만 */ }
  cachedRaw = undefined;
  window.dispatchEvent(new Event(EVENT));
}
/** 기본 배치에서 바뀌었는가 — '기본으로 되돌리기' 버튼을 보일지 */
export function useLayoutCustomized(): boolean {
  return useSyncExternalStore(subscribe, () => { try { return !!localStorage.getItem(KEY) || !!localStorage.getItem(OLD_KEY); } catch { return false; } }, () => false);
}

/** 모듈 종류 글자 — 타입 이름 끝(CCR-Y → Y). 게임 표기대로 A→α, D→Δ, B→β */
const MOD_GREEK: Record<string, string> = { A: "α", D: "Δ", B: "β" };
export const modKindOf = (type?: string) => { const k = (type ?? "").split("-").pop() ?? ""; return MOD_GREEK[k] ?? k; };
export const MOD_KINDS = ["X", "Y", "α", "Δ", "β"];
type CondOp = { rarity: number; modules: { id: string; type?: string }[] };

export function matchesCond(c: AccountChar, op: CondOp, cond: Cond): boolean {
  const rarity = op.rarity;
  if (cond.rarity.length && !cond.rarity.includes(rarity)) return false;
  if (c.elite < cond.elite) return false;
  if (cond.maxed && !isMaxed(c, rarity)) return false;
  // 레벨 조건은 정예화 단계를 넘어선 오퍼에겐 걸지 않는다 (2정 1레벨이 1정 50레벨보다 높다)
  if ((cond.level || cond.levelMax) && !(c.elite > cond.elite) && (c.level < cond.level || (cond.levelMax != null && c.level > cond.levelMax))) return false;
  if (cond.pot && c.potential !== cond.pot) return false;
  // 마스터를 하나라도 지정했으면 스킬 레벨은 7 이 전제다 (마스터는 7레벨 다음 단계)
  const skillLv = hasMastery(cond) ? 7 : cond.skill;
  // 스킬 레벨은 고른 값과 같은 오퍼만 (사용자 지시 2026-10-22 "3이상·4이상은 의미 없다, 3이면 3")
  if (skillLv && c.skill !== skillLv) return false;
  for (let i = 0; i < 3; i++) {
    const want = cond.ms[i];
    if (want.length && !want.includes(c.mastery[i] ?? 0)) return false;
  }
  for (const [kind, want] of Object.entries(cond.mods)) {
    if (!want.length) continue;
    const mod = op.modules.find((m) => modKindOf(m.type) === kind);
    if (!mod || !want.includes(c.modules[mod.id] ?? 0)) return false;
  }
  if ((cond.trust > 0 || cond.trustMax != null) && (trustPct(c.trust) < cond.trust || (cond.trustMax != null && trustPct(c.trust) > cond.trustMax))) return false;
  return true;
}

/** 칸 하나 만들기·고치기 창 — 계정 숫자 칸(builtin)은 제목만 고친다 */
/** 조건으로 제목을 지어 준다 (사용자 지시 2026-10-05 "무슨 조건을 설정했는지에 따라 제목을 자동으로 제안") —
 *  예: 6★ 2정 90 풀잠 · 1스킬 3마 · 신뢰도 200%. 조건이 없으면 빈 문자열 */
export function suggestTitle(cond: Cond, locale: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const parts: string[] = [];
  if (cond.rarity.length) parts.push(`${[...cond.rarity].sort((a, b) => b - a).join("·")}★`);
  const eliteOnly = (e: number) => (locale === "en" ? `E${e}` : locale === "ja" ? `昇進${e}` : `${e}정`);
  if (cond.maxed) parts.push(cond.elite ? `${eliteOnly(cond.elite)} ${t("만렙")}` : t("만렙"));
  else if (cond.levelMax != null) parts.push(`${cond.elite ? `${eliteOnly(cond.elite)} ` : ""}${rangeText(cond.level, cond.levelMax, "Lv.", "")}`);
  else if (cond.elite && cond.level) parts.push(`${eliteOnly(cond.elite)} ${cond.level}${cond.elite === 2 && cond.level >= 90 ? "" : "+"}`);
  else if (cond.elite) parts.push(cond.elite === 1 ? `${eliteOnly(1)}+` : eliteOnly(cond.elite));
  else if (cond.level) parts.push(`Lv.${cond.level}+`);
  if (cond.pot) parts.push(potText(locale, cond.pot));
  const ms = cond.ms.map((x) => [...x].sort());
  if (ms.every((x) => x.length === 1 && x[0] === 3)) parts.push(t("3스킬 모두 3마스터"));
  else ms.forEach((x, i) => { if (x.length) parts.push(`${t("{n}스킬", { n: i + 1 })} ${x.map((m) => masteryText(locale, m)).join("·")}`); });
  if (cond.skill && !hasMastery(cond)) parts.push(`${t("스킬")} Lv.${cond.skill}`);
  for (const [kind, lv] of Object.entries(cond.mods)) if (lv.length) parts.push(`${t("{k}모듈", { k: kind })} ${[...lv].sort().map((m) => `Lv.${m}`).join("·")}`);
  if (cond.trustMax != null) parts.push(`${t("신뢰도")} ${rangeText(cond.trust, cond.trustMax, "", "%")}`);
  else if (cond.trust) parts.push(`${t("신뢰도")} ${cond.trust}%${cond.trust < 200 ? "+" : ""}`);
  return parts.join(" ");
}

export function CustomTileEditor({ tile, countOf, valueOf, onSave, onDelete, onClose }: {
  tile: CustomTile | null;
  /** 지금 조건으로 몇 명인지 (미리보기) — [인원, 전체] */
  countOf: (cond: Cond) => [number, number, AccountChar[]?];
  /** 계정 숫자 칸의 지금 값 (미리보기) */
  valueOf?: (tile: CustomTile) => string;
  onSave: (tile: CustomTile) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const builtin = tile?.kind === "builtin" ? tile : null;
  const condTile = tile && tile.kind !== "builtin" ? tile : null;
  const [cond, setCond] = useState<Cond>(condTile?.cond ?? EMPTY);
  // 제목 자동 제안 — 직접 쓰기 전까지는 조건을 바꿀 때마다 제목이 따라간다. 직접 쓰면 그대로 두고, 칸을 비우면 다시 따라간다.
  // 고치는 칸은 지금 제목이 그 조건의 제안과 같을 때만 따라간다 (사용자가 붙인 이름을 덮지 않게)
  const suggested = builtin ? "" : suggestTitle(cond, locale, t);
  const [typed, setTyped] = useState<string | null>(() => {
    if (!tile) return null;
    const now = tileLabel(tile, t);
    return condTile && now === suggestTitle(condTile.cond, locale, t) ? null : now;
  });
  const label = typed ?? suggested;
  const setLabel = (v: string) => setTyped(v === "" ? null : v);
  const [total, setTotal] = useState(condTile?.total ?? false);
  const set = (part: Partial<Cond>) => setCond((c) => ({ ...c, ...part }));
  // 구간 목록에 없는 값(옛 칸·직접 넣은 값)이면 처음부터 직접 입력 칸을 연다
  const [levelCustom, setLevelCustom] = useState(() => !!condTile?.cond.levelMax && !LEVEL_BANDS.some(([lo, hi]) => lo === condTile.cond.level && hi === condTile.cond.levelMax));
  const [trustCustom, setTrustCustom] = useState(() => condTile?.cond.trustMax != null && !TRUST_BANDS.some(([lo, hi]) => lo === condTile.cond.trust && hi === condTile.cond.trustMax));
  // 직접 입력은 공용 숫자 칸(NumInput — [−][값][+], 사용자 지적 2026-10-22 "공통 컴포넌트 있지 않냐"). 아래끝을 위끝보다 올리면 위끝도 따라간다
  const rangeRow = (name: string, lo: number, hi: number, min: number, max: number, on: (lo: number, hi: number) => void, pre: string, post = "") => (
    <div className="me-cm-custom">
      <span>{t("{name} 직접 입력", { name })}</span>
      {pre && <small>{pre}</small>}
      <NumInput value={lo} min={min} max={max} ariaLabel={`${name} ${t("부터")}`} onChange={(a) => on(a, Math.max(a, hi))} />
      <small>~</small>
      <NumInput value={hi} min={min} max={max} ariaLabel={`${name} ${t("까지")}`} onChange={(b) => on(Math.min(lo, b), b)} />
      {post && <small>{post}</small>}
    </div>
  );
  const [n, all, chars = []] = countOf(cond);
  const hero = builtin ? null : chars[0] ?? null;
  const any = t("상관없음");
  /** 조건 카드 — 이름(위)·지금 값(아래), 누르면 목록. on = 상관없음이 아닌 값이 골라짐(명암 반전) */
  // 목록은 하나만 고른다 (사용자 지적 2026-10-22 "왜 복수 선택이 되냐") — 성급·스킬 마스터·모듈도 하나씩. 예전에 여럿 고른 항목은 값 글자로만 보인다
  const card = (name: string, value: string, on: boolean, _multi: boolean, items: { value: string; label: string }[], selected: string[],
    pick: (v: string) => void, scroll = false, disabled = false) => (
    <Dropdown bare ariaLabel={name} scroll={scroll || items.length > 10} disabled={disabled} className="me-cm-drop" buttonClassName={`me-cm-card${on ? " on" : ""}`}
      label={<><span className="me-cm-k">{name}</span><b className="me-cm-v">{value}</b><i className="me-cm-caret" aria-hidden>▾</i></>}
      selected={selected} items={items} onPick={pick} />
  );
  // 제목을 그대로 두면 사전 키를 유지한다(언어를 바꿔도 번역되게), 고치면 쓴 글 그대로
  const keepKey = tile?.labelKey && label === t(tile.labelKey) ? tile.labelKey : undefined;
  const save = () => {
    const name = label.trim() || t("새 항목");
    if (builtin) onSave({ ...builtin, label: name, labelKey: keepKey });
    else onSave({ id: tile?.id ?? `c${Date.now().toString(36)}`, label: name, labelKey: keepKey, cond, total });
  };
  return (
    <ModalWindow label={tile ? t("카드 편집") : t("카드 추가")} className="operator-modal me-tile-modal" onClose={onClose}>
      <div className="me-tile-edit">
        {/* 창 뒤 일러스트 — 조건을 바꾸면 그 조건의 첫 오퍼로 바뀐다. 그림이 없으면(스킨 그림 미수록 등) 정예화 일러, 그것도 없으면 뺀다 */}
        {hero && <span className="me-tile-art-box" aria-hidden><img key={hero.id + (hero.skin ?? "")} className="me-tile-art" src={fullArtOf(hero)} alt="" decoding="async"
          onError={(e) => { const el = e.currentTarget; const fb = fullArtOf({ ...hero, skin: null }); if (el.src !== new URL(fb, location.href).href) el.src = fb; else el.remove(); }} /></span>}
        <div className="me-tile-top">
          <h3>{tile ? t("카드 편집") : t("카드 추가")}</h3>
          {/* 지우기는 오른쪽 위에 따로 (사용자 지시 2026-10-04) — 아래 버튼과 붙어 있으면 잘못 누른다 */}
          {onDelete && <button type="button" className="me-sort me-tile-del" onClick={onDelete}><span aria-hidden>✕</span>{t("이 카드 지우기")}</button>}
        </div>
        <label className="me-tile-name">
          <span>{t("제목")}</span>
          <input value={label} maxLength={40} placeholder={t("예: 6성 3마 1스킬")} onChange={(e) => setLabel(e.target.value)} />
        </label>
        {/* 조건은 카드 하나에 하나씩 가로로 — 누르면 목록이 펼쳐진다 (사용자 지시 2026-10-22). 카드엔 이름 위·지금 값 아래.
            스킬 마스터·모듈은 카드가 너무 늘지 않게 하나씩으로 묶고 목록에서 여럿 고른다 */}
        {/* 조건 한 번에 비우기 (사용자 지시 2026-10-22) — 표시 방식(인원 수 / 전체)은 조건이 아니라 그대로 둔다 */}
        {!builtin && (
          <div className="me-cm-head">
            <span>{t("조건")}</span>
            <button type="button" className="me-sort" disabled={JSON.stringify(cond) === JSON.stringify(EMPTY)} onClick={() => setCond(EMPTY)}>{t("조건 초기화")}</button>
          </div>
        )}
        {builtin ? <p className="me-note">{t("이 칸은 계정 숫자라 조건을 바꿀 수 없습니다 — 제목만 고치거나 지울 수 있습니다.")}</p> : <div className="me-cm-cards">
          {card(t("성급"), cond.rarity.length ? [...cond.rarity].sort((a, b) => b - a).map((r) => `${r}★`).join("·") : any, cond.rarity.length > 0, true,
            [{ value: "any", label: any }, ...[6, 5, 4, 3, 2, 1].map((r) => ({ value: String(r), label: `${r}★` }))],
            cond.rarity.map(String),
            (v) => set({ rarity: v === "any" ? [] : [Number(v)] }))}
          {card(t("정예화"), cond.elite === 1 ? t("1정 이상") : cond.elite === 2 ? t("2정") : any, cond.elite > 0, false,
            [{ value: "0", label: any }, { value: "1", label: t("1정 이상") }, { value: "2", label: t("2정") }],
            [String(cond.elite)], (v) => set({ elite: Number(v) }))}
          {card(t("레벨"), cond.maxed ? t("만렙") : cond.levelMax != null ? rangeText(cond.level, cond.levelMax, "Lv.", "") : cond.level ? `Lv.${cond.level}+` : any,
            cond.maxed || cond.level > 0 || cond.levelMax != null, false,
            [{ value: "any", label: any }, ...LEVEL_BANDS.map(([lo, hi]) => ({ value: `${lo}-${hi}`, label: lo === hi ? `Lv.${lo}` : lo < 10 ? `Lv.${lo}~${hi}` : t("{n}레벨대", { n: lo }) })),
              { value: "custom", label: t("직접 입력") }],
            [levelCustom ? "custom" : cond.levelMax != null ? `${cond.level}-${cond.levelMax}` : cond.level ? "" : "any"],
            (v) => {
              setLevelCustom(v === "custom");
              if (v === "any") set({ maxed: false, level: 0, levelMax: undefined });
              else if (v === "custom") set({ maxed: false, level: cond.level || 1, levelMax: cond.levelMax ?? (cond.level || 90) });
              else { const [lo, hi] = v.split("-").map(Number); set({ maxed: false, level: lo, levelMax: hi }); }
            }, true)}
          {card(t("잠재"), cond.pot ? potText(locale, cond.pot) : any, cond.pot > 0, false,
            [{ value: "0", label: any }, ...[1, 2, 3, 4, 5, 6].map((p) => ({ value: String(p), label: potText(locale, p) }))],
            [String(cond.pot)], (v) => set({ pot: Number(v) }))}
          {/* 마스터를 지정하면 공통 스킬 레벨은 7 로 고정 — 고칠 수 없다 (사용자 지시 2026-10-04) */}
          {card(t("스킬 레벨"), hasMastery(cond) ? "Lv.7" : cond.skill ? `Lv.${cond.skill}` : any, cond.skill > 0 || hasMastery(cond), false,
            [{ value: "0", label: any }, ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: `Lv.${n}` }))],
            [String(cond.skill)], (v) => set({ skill: Number(v) }), false, hasMastery(cond))}
          {card(t("스킬 마스터"), hasMastery(cond)
            ? cond.ms.map((x, i) => (x.length ? `${i + 1}S ${[...x].sort().map((m) => masteryText(locale, m)).join("·")}` : "")).filter(Boolean).join(" · ") : any,
            hasMastery(cond), true,
            [{ value: "any", label: any }, ...[0, 1, 2].flatMap((i) => [1, 2, 3].map((m) => ({ value: `${i}:${m}`, label: `${t("{n}스킬", { n: i + 1 })} ${masteryText(locale, m)}` })))],
            cond.ms.flatMap((x, i) => x.map((m) => `${i}:${m}`)),
            (v) => {
              if (v === "any") { set({ ms: [[], [], []] }); return; }
              const [i, m] = v.split(":").map(Number);
              set({ ms: [0, 1, 2].map((j) => (j === i ? [m] : [])) as Cond["ms"] });
            }, true)}
          {card(t("모듈"), Object.values(cond.mods).some((x) => x.length)
            ? Object.entries(cond.mods).filter(([, x]) => x.length).map(([k, x]) => `${k} ${[...x].sort().map((m) => `Lv.${m}`).join("·")}`).join(" · ") : any,
            Object.values(cond.mods).some((x) => x.length), true,
            [{ value: "any", label: any }, ...MOD_KINDS.flatMap((k) => [1, 2, 3].map((m) => ({ value: `${k}:${m}`, label: `${t("{k}모듈", { k })} Lv.${m}` })))],
            Object.entries(cond.mods).flatMap(([k, x]) => x.map((m) => `${k}:${m}`)),
            (v) => {
              if (v === "any") { set({ mods: {} }); return; }
              const [k, mS] = v.split(":");
              set({ mods: { [k]: [Number(mS)] } });
            }, true)}
          {card(t("신뢰도"), cond.trustMax != null ? rangeText(cond.trust, cond.trustMax, "", "%") : cond.trust ? `${cond.trust}%${cond.trust < 200 ? "+" : ""}` : any,
            cond.trust > 0 || cond.trustMax != null, false,
            [{ value: "any", label: any }, ...TRUST_BANDS.map(([lo, hi]) => ({ value: `${lo}-${hi}`, label: rangeText(lo, hi, "", "%") })), { value: "custom", label: t("직접 입력") }],
            [trustCustom ? "custom" : cond.trustMax != null ? `${cond.trust}-${cond.trustMax}` : cond.trust ? "" : "any"],
            (v) => {
              setTrustCustom(v === "custom");
              if (v === "any") set({ trust: 0, trustMax: undefined });
              else if (v === "custom") set({ trust: cond.trust, trustMax: cond.trustMax ?? 200 });
              else { const [lo, hi] = v.split("-").map(Number); set({ trust: lo, trustMax: hi }); }
            })}
          {card(t("표시"), total ? t("인원 수 / 전체") : t("인원 수"), false, false,
            [{ value: "0", label: t("인원 수") }, { value: "1", label: t("인원 수 / 전체") }],
            [total ? "1" : "0"], (v) => setTotal(v === "1"))}
        </div>}
        {/* 직접 입력 — 목록에서 '직접 입력'을 고르면 카드 아래에 범위 칸이 열린다 (같은 값이면 그 값 하나) */}
        {!builtin && levelCustom && rangeRow(t("레벨"), cond.level, cond.levelMax ?? cond.level, 1, 90, (lo, hi) => set({ maxed: false, level: lo, levelMax: hi }), "Lv.")}
        {!builtin && trustCustom && rangeRow(t("신뢰도"), cond.trust, cond.trustMax ?? 200, 0, 200, (lo, hi) => set({ trust: lo, trustMax: hi }), "", "%")}
        <div className="me-tile-preview">
          <div className="me-tile-pv-l">
            <span>{label.trim() || t("새 항목")}</span>
            {/* 이 조건이 세는 오퍼 — 앞에서 몇 명만 겹쳐 보이고 나머지는 +N */}
            {!builtin && chars.length > 0 && (
              <span className="me-tile-faces" aria-hidden>
                {chars.slice(0, 10).map((c) => <img key={c.id} src={faceOf(c.id)} alt="" width={30} height={30} loading="lazy" />)}
                {chars.length > 10 && <em>+{chars.length - 10}</em>}
              </span>
            )}
          </div>
          <b>{builtin ? valueOf?.(builtin) ?? "" : total ? `${n} / ${all}` : n}</b>
        </div>
        <div className="me-tile-actions">
          <button type="button" className="import-action" onClick={onClose}>{t("취소")}</button>
          <button type="button" className="import-action apply" onClick={save}><span className="btn-icon" aria-hidden>✓</span>{tile ? t("저장") : t("추가")}</button>
        </div>
      </div>
    </ModalWindow>
  );
}

// ── 칸 값 계산 — 한눈에 보기와 내보내기 카드가 같이 쓴다 ─────────────
type TileOp = CondOp & { id: string };
export type TileCtx = {
  owned: AccountChar[];
  released: { id: string; rarity: number }[];
  opById: Map<string, TileOp>;
  profile: { skins: number; medals: number; medalTotal?: number } | null;
};
/** value = 칸 숫자 · total = 분모(있을 때) · chars = 누르면 뜨는 내 오퍼 · ops = 미보유처럼 계정에 없는 오퍼 ·
 *  per = 오퍼 한 명이 몇 개를 보탰는지(3마스터 스킬·모듈 Lv.3 처럼 '개수' 칸) */
export type TileValue = { value: number; total?: number; chars?: AccountChar[]; ops?: string[]; per?: (c: AccountChar) => number; perKind?: "m3" | "mod3" };
export function evalTile(tile: CustomTile, ctx: TileCtx): TileValue {
  const rar = (c: AccountChar) => ctx.opById.get(c.id)?.rarity ?? 0;
  if (tile.kind !== "builtin") {
    const chars = ctx.owned.filter((c) => { const op = ctx.opById.get(c.id); return !!op && matchesCond(c, op, tile.cond); });
    const total = tile.total ? ctx.released.filter((op) => !tile.cond.rarity.length || tile.cond.rarity.includes(op.rarity)).length : undefined;
    return { value: chars.length, total, chars };
  }
  const m3 = (c: AccountChar) => c.mastery.filter((m) => m >= 3).length;
  const mod3 = (c: AccountChar) => Object.values(c.modules).filter((lv) => lv >= 3).length;
  switch (tile.key) {
    case "owned": return { value: ctx.owned.length, total: ctx.released.length, chars: ctx.owned };
    case "six": {
      const chars = ctx.owned.filter((c) => rar(c) === 6);
      return { value: chars.length, total: ctx.released.filter((op) => op.rarity === 6).length, chars };
    }
    case "unowned": {
      const have = new Set(ctx.owned.map((c) => c.id));
      const ops = ctx.released.filter((op) => !have.has(op.id)).sort((a, b) => b.rarity - a.rarity).map((op) => op.id);
      return { value: ops.length, ops };
    }
    case "m3skills": return { value: ctx.owned.reduce((n, c) => n + m3(c), 0), chars: ctx.owned.filter((c) => m3(c) > 0), per: m3, perKind: "m3" };
    case "mod3": return { value: ctx.owned.reduce((n, c) => n + mod3(c), 0), chars: ctx.owned.filter((c) => mod3(c) > 0), per: mod3, perKind: "mod3" };
    case "skins": return { value: ctx.profile?.skins ?? 0, total: meMeta.skins || undefined };
    case "medals": return { value: ctx.profile?.medals ?? 0, total: ctx.profile?.medalTotal || undefined };
  }
}
