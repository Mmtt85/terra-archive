"use client";

// 내 정보 '한눈에 보기'의 맞춤 칸 — 훈장 오른쪽 '+ 항목 추가'로 사용자가 직접 만든다 (사용자 요청 2026-10-04).
// 제목을 쓰고 조건(성급·정예화·레벨·잠재·스킬 레벨·몇 번째 스킬의 마스터·모듈·신뢰도)을 조합하면
// "그 조건에 맞는 내 오퍼 수"가 칸이 된다. 다른 칸처럼 누르면 해당 오퍼 목록이 뜨고, ✎로 고치거나 지운다.
// 칸 정의는 이 브라우저에만 저장한다 (계정과 무관한 화면 설정이다).

import { useState, useSyncExternalStore } from "react";
import { useI18n } from "./i18n";
import { ModalWindow } from "./modal-window";
import { Dropdown } from "./dropdown";
import type { AccountChar } from "./account";
import { isMaxed, masteryText, potText, trustPct } from "./me-store";
// '현재 / 전체'의 전체 수 — 게임 표에서 센 것 (scripts/build-me-meta.py)
import meMeta from "./data/me-meta.json";

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
  if (cond.level && c.level < cond.level && !(c.elite > cond.elite)) return false;
  if (cond.pot && c.potential !== cond.pot) return false;
  // 마스터를 하나라도 지정했으면 스킬 레벨은 7 이 전제다 (마스터는 7레벨 다음 단계)
  const skillLv = hasMastery(cond) ? 7 : cond.skill;
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
  if (cond.trust > 0 && trustPct(c.trust) < cond.trust) return false;
  return true;
}

/** 칸 하나 만들기·고치기 창 — 계정 숫자 칸(builtin)은 제목만 고친다 */
export function CustomTileEditor({ tile, countOf, valueOf, onSave, onDelete, onClose }: {
  tile: CustomTile | null;
  /** 지금 조건으로 몇 명인지 (미리보기) — [인원, 전체] */
  countOf: (cond: Cond) => [number, number];
  /** 계정 숫자 칸의 지금 값 (미리보기) */
  valueOf?: (tile: CustomTile) => string;
  onSave: (tile: CustomTile) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const builtin = tile?.kind === "builtin" ? tile : null;
  const condTile = tile && tile.kind !== "builtin" ? tile : null;
  const [label, setLabel] = useState(tile ? tileLabel(tile, t) : "");
  const [cond, setCond] = useState<Cond>(condTile?.cond ?? EMPTY);
  const [total, setTotal] = useState(condTile?.total ?? false);
  const set = (part: Partial<Cond>) => setCond((c) => ({ ...c, ...part }));
  const [n, all] = countOf(cond);
  const any = t("상관없음");
  const seg = <V extends string | number>(value: V, opts: { v: V; label: string }[], on: (v: V) => void) => (
    <div className="me-seg me-cm-seg" role="group">
      {opts.map((o) => <button key={String(o.v)} type="button" className={value === o.v ? "selected" : ""} onClick={() => on(o.v)}>{o.label}</button>)}
    </div>
  );
  // 제목을 그대로 두면 사전 키를 유지한다(언어를 바꿔도 번역되게), 고치면 쓴 글 그대로
  const keepKey = tile?.labelKey && label === t(tile.labelKey) ? tile.labelKey : undefined;
  const save = () => {
    const name = label.trim() || t("새 항목");
    if (builtin) onSave({ ...builtin, label: name, labelKey: keepKey });
    else onSave({ id: tile?.id ?? `c${Date.now().toString(36)}`, label: name, labelKey: keepKey, cond, total });
  };
  return (
    <ModalWindow label={tile ? t("항목 고치기") : t("항목 추가")} className="operator-modal me-tile-modal" onClose={onClose}>
      <div className="me-tile-edit">
        <div className="me-tile-top">
          <h3>{tile ? t("항목 고치기") : t("항목 추가")}</h3>
          {/* 지우기는 오른쪽 위에 따로 (사용자 지시 2026-10-04) — 아래 버튼과 붙어 있으면 잘못 누른다 */}
          {onDelete && <button type="button" className="me-sort me-tile-del" onClick={onDelete}><span aria-hidden>✕</span>{t("지우기")}</button>}
        </div>
        <label className="me-tile-name">
          <span>{t("제목")}</span>
          <input value={label} maxLength={24} placeholder={t("예: 6성 3마 1스킬")} onChange={(e) => setLabel(e.target.value)} />
        </label>
        {builtin ? <p className="me-note">{t("이 칸은 계정 숫자라 조건을 바꿀 수 없습니다 — 제목만 고치거나 지울 수 있습니다.")}</p> : <div className="me-cm-cond">
          <span>{t("성급")}</span>
          <div className="me-seg me-cm-seg" role="group">
            {[6, 5, 4, 3, 2, 1].map((r) => (
              <button key={r} type="button" className={cond.rarity.includes(r) ? "selected" : ""}
                onClick={() => set({ rarity: cond.rarity.includes(r) ? cond.rarity.filter((x) => x !== r) : [...cond.rarity, r] })}>{r}★</button>
            ))}
          </div>
          <span>{t("정예화")}</span>
          {seg(cond.elite, [{ v: 0, label: any }, { v: 1, label: t("1정 이상") }, { v: 2, label: t("2정") }], (v) => set({ elite: v }))}
          <span>{t("레벨")}</span>
          <div className="me-cm-inline">
            {seg(cond.maxed ? 1 : 0, [{ v: 0, label: t("직접") }, { v: 1, label: t("만렙") }], (v) => set({ maxed: v === 1 }))}
            {!cond.maxed && <input type="number" min={0} max={90} value={cond.level || ""} placeholder="0"
              onChange={(e) => set({ level: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })} />}
            {!cond.maxed && <small>{t("이상")}</small>}
          </div>
          <span>{t("잠재")}</span>
          {seg(cond.pot, [{ v: 0, label: any }, ...[1, 2, 3, 4, 5, 6].map((p) => ({ v: p, label: potText(locale, p) }))], (v) => set({ pot: v }))}
          <span>{t("스킬")}</span>
          {/* 스킬 — '아무 스킬'은 공통 스킬 레벨 1~7, 1·2·3스킬과 '모든 스킬'은 마스터 1~3마를 목록에서 고른다 (사용자 지시 2026-10-04) */}
          <div className="me-seg me-cm-seg me-cm-skill" role="group">
            <button type="button" className={!cond.skill && !hasMastery(cond) ? "selected" : ""} onClick={() => set({ skill: 0, ms: [[], [], []] })}>{any}</button>
            {/* 마스터를 지정하면 공통 스킬 레벨은 7 로 고정 — 고칠 수 없다 (사용자 지시 2026-10-04) */}
            <Dropdown ariaLabel={t("아무 스킬")} disabled={hasMastery(cond)} buttonClassName={cond.skill || hasMastery(cond) ? "selected" : ""}
              label={hasMastery(cond) ? `${t("아무 스킬")} Lv.7` : cond.skill ? `${t("아무 스킬")} Lv.${cond.skill}` : t("아무 스킬")}
              selected={cond.skill ? [String(cond.skill)] : []}
              items={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: `Lv.${n}` }))}
              onPick={(v) => set({ skill: Number(v) })} />
            {[0, 1, 2].map((i) => {
              const name = t("{n}스킬", { n: i + 1 });
              const picked = cond.ms[i];
              return (
                <Dropdown key={i} ariaLabel={name} buttonClassName={picked.length ? "selected" : ""}
                  label={picked.length ? `${name} ${[...picked].sort().map((m) => masteryText(locale, m)).join("·")}` : name}
                  selected={picked.map(String)}
                  items={[1, 2, 3].map((m) => ({ value: String(m), label: masteryText(locale, m) }))}
                  onPick={(v) => {
                    const m = Number(v);
                    const next = cond.ms.map((x, j) => (j === i ? (x.includes(m) ? x.filter((y) => y !== m) : [...x, m]) : x)) as Cond["ms"];
                    set({ ms: next });
                  }} />
              );
            })}
          </div>
          <span>{t("모듈")}</span>
          {/* 모듈 — 종류별로 1~3레벨 목록 (사용자 지시 2026-10-04, 스킬 마스터와 같은 방식) */}
          <div className="me-seg me-cm-seg me-cm-skill" role="group">
            <button type="button" className={Object.values(cond.mods).every((x) => !x.length) ? "selected" : ""} onClick={() => set({ mods: {} })}>{any}</button>
            {MOD_KINDS.map((kind) => {
              const picked = cond.mods[kind] ?? [];
              const name = t("{k}모듈", { k: kind });
              return (
                <Dropdown key={kind} ariaLabel={name} buttonClassName={picked.length ? "selected" : ""}
                  label={picked.length ? `${name} ${[...picked].sort().map((m) => `Lv.${m}`).join("·")}` : name}
                  selected={picked.map(String)}
                  items={[1, 2, 3].map((m) => ({ value: String(m), label: `Lv.${m}` }))}
                  onPick={(v) => {
                    const m = Number(v);
                    set({ mods: { ...cond.mods, [kind]: picked.includes(m) ? picked.filter((y) => y !== m) : [...picked, m] } });
                  }} />
              );
            })}
          </div>
          <span>{t("신뢰도")}</span>
          {seg(cond.trust, [{ v: 0, label: any }, ...[50, 100, 150].map((n) => ({ v: n, label: `${n}%+` })), { v: 200, label: "200%" }], (v) => set({ trust: v }))}
          <span>{t("표시")}</span>
          {seg(total ? 1 : 0, [{ v: 0, label: t("인원 수") }, { v: 1, label: t("인원 수 / 전체") }], (v) => setTotal(v === 1))}
        </div>}
        <p className="me-tile-preview"><span>{label.trim() || t("새 항목")}</span><b>{builtin ? valueOf?.(builtin) ?? "" : total ? `${n} / ${all}` : n}</b></p>
        <div className="me-tile-actions">
          <button type="button" className="import-action" onClick={onClose}>{t("취소")}</button>
          <button type="button" className="import-action apply" onClick={save}><span className="btn-icon" aria-hidden>✓</span>{tile ? t("고치기") : t("추가")}</button>
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
