"use client";

// 위기 협약 계산기 (제안 7345061a, 사용자 지시 2026-10-23 "이벤트 가이드의 위기협약에 제약들 맞춰서") —
// 작전 상세의 계약(지표) 카드를 눌러 고르면 위험도(점수) 합계와 고른 효과를 대상(적·특정 적·아군)·능력치별로 모아 보이고,
// 적에게 걸리는 HP·공격력·방어력·마법 저항 %를 **등장 적 카드 수치에 바로 반영**한다(onMul → 작전 상세의 환경 배수, 같은 날 "적 스탯도 알아서").
// 시즌 위기 협약은 지표 수치가 클라이언트 표에 없어(서버가 내려 준다) 계약 설명 문장을 읽어 뽑는다. 홀로그램 매트릭스도 같은 화면(같은 날 "똑같이").
// 같은 능력치 계약은 **더한다** — 게임 문구 "(같은 종류의 효과와 중첩)" 대로. 모든 적 +25% 와 특정 적 +40% 도 그 적에겐 +65%
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "./i18n";
import { asset } from "./assets";
import type { EnvMul } from "./stage-data";

/** 카드 한 장 — g 묶음(-1 = 없음) · val 시즌1 위험 등급 / 시즌2·매트릭스 점수 · must 매트릭스 필수(늘 켜짐) · icon public/stage/rune/<id>.webp */
export type CcCard = { g: number; name: string; desc: string; dim: string; val: number; cnt: number; icon: string; must?: boolean };
export type CcProps = {
  mode: "cc1" | "cc2" | "hm";
  cards: CcCard[];
  /** [묶음 이름, 세트 완료 점수] — 매트릭스는 이름 없는 배타 묶음이라 빈 배열 */
  sets: [string, number][];
  /** 매트릭스 훈장 점수 [하급, 상급] */
  medal?: (number | null)[];
  /** 이 작전의 등장 적 (id·이름) — '유령' 같은 특정 적 계약을 그 적에게 붙인다 */
  foes: { id: string; name: string }[];
  onMul?: (rows: EnvMul[]) => void;
};

// 'I·II·III' 단계만 다른 계약은 하나만 고른다 (오리지늄 환경: 자극 I / II)
const baseOf = (name: string) => name.replace(/\s*(I{1,3}|IV|V|Ⅰ|Ⅱ|Ⅲ)$/, "");
const PCT = /^(.+?)\s*([+-]\d+(?:\.\d+)?)%/;
const STAT_IX = (stat: string): number => (/HP|생명/.test(stat) ? 0 : /공격력/.test(stat) && !/속도/.test(stat) ? 1 : /방어력/.test(stat) ? 2 : /마법 저항/.test(stat) ? 3 : -1);

type Eff = { who: string; names?: string[]; rank?: "ELITE" | "NORMAL"; stat: string; v: number };
// 'HP가 200%로 증가'·'공격력과 방어력이 140%로 증가' — 배수 꼴 (매트릭스 필수 지표). 200% = +100
const ABS = /^(.+?)(?:이|가)\s*(\d+(?:\.\d+)?)%로\s*(증가|감소)/;
/** 설명 한 줄 → 능력치 효과들 + 못 읽은 규칙 문장. 한국어 문장만 읽는다 */
export function parseDesc(desc: string): { effs: Eff[]; rules: string[] } {
  const effs: Eff[] = [];
  const rules: string[] = [];
  for (const raw of desc.split("\n")) {
    const line = raw.replace(/\s*[(（](같은 종류의 효과와 중첩|동일 효과 중첩)[)）]/g, "").trim();
    if (!line || /^\(\d/.test(line) || /^좌표/.test(line)) continue;   // 배치 불가 좌표 줄은 규칙 본문에 딸린 것
    // 주어 — 모든 적 · 모든 정예/일반 적(적 등급 ELITE/NORMAL, 보스는 따로 이름으로 불린다) · '이름' 및 … · 아군
    const m = /^(모든 적|모든 정예 적|모든 일반 적|모든 아군 유닛|모든 아군 오퍼레이터|모든 유닛|(?:모든 )?'[^']+'(?:\s*(?:및|,)\s*(?:'[^']+'|모든 일반 적|모든 정예 적))*)(?:의\s+|의)(.+)$/.exec(line);
    if (m) {
      const subj = m[1];
      const names = subj.includes("'") ? [...subj.matchAll(/'([^']+)'/g)].map((x) => x[1]) : undefined;
      const rank = /모든 정예 적/.test(subj) ? "ELITE" as const : /모든 일반 적/.test(subj) ? "NORMAL" as const : undefined;
      const who = subj.startsWith("모든 아군") ? "ally" : subj === "모든 적" ? "enemy" : subj === "모든 유닛" ? "all" : subj.replace(/^모든 /, "");
      const left: string[] = [];
      for (const p of m[2].split(/,\s*/)) {
        const pa = ABS.exec(p.trim());
        if (pa) {
          const v = Number(pa[2]) - 100;   // '200%로 증가' = +100 · '70%로 감소' = −30
          for (const st of pa[1].split(/\s*(?:과|와|및)\s*/)) effs.push({ who, names, rank, stat: st.trim(), v });
          continue;
        }
        const pm = PCT.exec(p.trim());
        if (pm) effs.push({ who, names, rank, stat: pm[1].trim(), v: Number(pm[2]) });
        else left.push(p.trim());
      }
      if (left.length) rules.push(`${subj}의 ${left.join(", ")}`);
      continue;
    }
    const sp = /^(오퍼레이터 스킬|배치 코스트)의\s+(.+?)\s*([+-]\d+(?:\.\d+)?)%$/.exec(line);
    if (sp) { effs.push({ who: "ally", stat: `${sp[1]} ${sp[2]}`, v: Number(sp[3]) }); continue; }
    rules.push(line);
  }
  return { effs, rules };
}

export function CrisisCalc({ mode, cards, sets, medal, foes, onMul }: CcProps) {
  const { t } = useI18n();
  const mustIx = useMemo(() => cards.map((c, i) => (c.must ? i : -1)).filter((i) => i >= 0), [cards]);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(mustIx));
  // 효과 모아 보기 접기 — 많이 고르면 길어져 아래 카드가 안 보였다 (사용자 지시 2026-10-23)
  const [folded, setFolded] = useState(false);
  const ko = useMemo(() => cards.some((x) => /[가-힣]/.test(x.desc)), [cards]);
  const toggle = (i: number) => setPicked((cur) => {
    if (cards[i].must) return cur;   // 매트릭스 필수 지표는 늘 켜져 있다
    const n = new Set(cur);
    if (n.has(i)) { n.delete(i); return n; }
    for (const j of [...n]) {
      if (cards[j].must) continue;
      // 매트릭스: 같은 배타 묶음은 하나만 · 시즌: 같은 묶음에서 단계만 다른 계약은 하나만
      const clash = mode === "hm"
        ? cards[i].g >= 0 && cards[j].g === cards[i].g
        : cards[j].g === cards[i].g && cards[j].name !== cards[i].name && baseOf(cards[j].name) === baseOf(cards[i].name);
      if (clash) n.delete(j);
    }
    n.add(i);
    return n;
  });
  const sum = useMemo(() => {
    const rows = [...picked].sort((a, b) => a - b).map((i) => cards[i]);
    let risk = rows.reduce((s, r) => s + r.val, 0);
    // 시즌 2 — 묶음의 계약을 전부 고르면 세트 완료 점수 (데이터의 '세트 완료 +n')
    const done: string[] = [];
    if (mode === "cc2") sets.forEach(([name, bonus], gi) => {
      const all = cards.map((r, i) => [r, i] as const).filter(([r]) => r.g === gi);
      if (bonus > 0 && all.length && all.every(([, i]) => picked.has(i))) { risk += bonus; done.push(name); }
    });
    const effs: Eff[] = [];
    const rules: string[] = [];
    for (const r of rows) {
      const p = parseDesc(r.desc);
      effs.push(...p.effs);
      rules.push(...p.rules);
    }
    const by = new Map<string, Map<string, number[]>>();
    for (const e of effs) {
      const w = by.get(e.who) ?? new Map<string, number[]>();
      w.set(e.stat, [...(w.get(e.stat) ?? []), e.v]);
      by.set(e.who, w);
    }
    return { rows, risk, done, by, rules, effs };
  }, [picked, cards, sets, mode]);

  // 적 등급(정예·일반) — 그 꼴의 지표가 있을 때만 적 도감을 받는다
  const { locale } = useI18n();
  const [ranks, setRanks] = useState<Map<string, string> | null>(null);
  const needRank = sum.effs.some((e) => e.rank);
  useEffect(() => {
    if (!needRank || ranks) return;
    let alive = true;
    void import("./dex-cross").then((x) => x.loadEnemies(locale)).then((map) => {
      if (alive) setRanks(new Map([...map].map(([id, e]) => [id, (e as { rank?: string }).rank ?? ""])));
    }).catch(() => {});
    return () => { alive = false; };
  }, [needRank, ranks, locale]);
  // 등장 적 배수 — 적마다 [HP, 공격, 방어, 마저] = 1 + (모든 적 % + 그 적 이름이 든 계약 %) / 100
  useEffect(() => {
    if (!onMul) return;
    if (!ko) { onMul([]); return; }
    const rows: EnvMul[] = [];
    for (const f of foes) {
      const add = [0, 0, 0, 0];
      for (const e of sum.effs) {
        const ix = STAT_IX(e.stat);
        if (ix < 0) continue;
        const rk = ranks?.get(f.id) ?? ranks?.get(f.id.replace(/_\d+$/, ""));
        const hit = e.who === "enemy" || e.who === "all"
          || (e.names && e.names.some((n) => f.name === n || f.name.startsWith(n)))
          || (e.rank && rk === e.rank);
        if (hit) add[ix] += e.v;
      }
      if (add.some((v) => v !== 0)) rows.push([1 + add[0] / 100, 1 + add[1] / 100, 1 + add[2] / 100, 1 + add[3] / 100, f.id]);
    }
    onMul(rows);
  }, [sum, foes, ko, onMul, ranks]);

  const whoLabel = (w: string) => (w === "enemy" ? t("모든 적") : w === "ally" ? t("아군") : w === "all" ? t("모든 유닛") : w);
  const order = (w: string) => (w === "ally" ? 0 : w === "enemy" ? 1 : w === "all" ? 2 : 3);
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}%`;
  const optional = picked.size - mustIx.length;
  const medalHit = mode === "hm" && medal ? medal.map((m) => (m != null && sum.risk >= m ? m : null)) : [];

  const card = (c: CcCard, i: number) => (
    <li key={i} className={`cc-pick${picked.has(i) ? " on" : ""}${c.must ? " must" : ""}`} role="button" tabIndex={0} aria-pressed={picked.has(i)}
      onClick={() => toggle(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(i); } }}>
      {c.icon ? <img className="cc-ic" src={asset(`/stage/rune/${c.icon}.webp`)} alt="" width={40} height={40} loading="lazy" decoding="async" /> : <span className="cc-ic" aria-hidden />}
      <span className="cc-body">
        <span className="cc-top">
          <span className="st-rune-pt">{c.must ? t("필수") : mode === "cc1" ? `Lv${c.val}` : `+${c.val}`}</span>
          {c.name && <b>{c.name}</b>}
          {c.cnt > 1 && <em className="st-rune-grp">×{c.cnt}</em>}
        </span>
        <span className="st-rune-text">{c.desc}</span>
        {c.dim && <em className="st-rune-grp">{c.dim}</em>}
      </span>
    </li>
  );

  return (
    <>
      <div className="cc-calc">
        <div className="cc-calc-head">
          <b>{mode === "hm" ? t("지표 고르기") : t("계약 고르기")}</b>
          <span>{optional > 0 || mustIx.length ? (mode === "cc1" ? t("{n}개 · 위험 {r}", { n: picked.size, r: sum.risk }) : t("{n}개 · {r}점", { n: picked.size, r: sum.risk })) : t("아래 계약을 눌러 고르세요")}</span>
          {sum.done.length > 0 && <em className="cc-set">{t("세트 완료")}: {sum.done.join(", ")}</em>}
          {mode === "hm" && medal && <em className="cc-set">{t("훈장 {a}점 · {b}점", { a: medal[0] ?? "—", b: medal[1] ?? "—" })}{medalHit.some((m) => m != null) ? ` — ${medalHit[1] != null ? t("상급 달성") : t("하급 달성")}` : ""}</em>}
          {optional > 0 && <button type="button" className="cc-reset" onClick={() => setPicked(new Set(mustIx))}>{t("초기화")}</button>}
          {picked.size > 0 && (
            <button type="button" className={`cc-fold${folded ? "" : " open"}`} onClick={() => setFolded((v) => !v)} aria-expanded={!folded}>
              <span className="cof-ic" aria-hidden>▾</span>
              <span className="swap-lab"><span className={folded ? "off" : ""}>{t("접기")}</span><span className={folded ? "" : "off"}>{t("펼치기")}</span></span>
            </button>
          )}
        </div>
        {picked.size > 0 && !folded && (ko ? (
          <div className="cc-sum">
            {[...sum.by.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([who, stats]) => (
              <div key={who} className={`cc-who ${who === "ally" ? "ally" : "foe"}`}>
                <h5>{whoLabel(who)}</h5>
                <ul>
                  {[...stats.entries()].map(([stat, list]) => (
                    <li key={stat}>
                      <span className="cc-stat">{stat}</span>
                      <b>{fmt(list.reduce((s, v) => s + v, 0))}</b>
                      {list.length > 1 && <small>{list.map(fmt).join(" ")}</small>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {sum.rules.length > 0 && (
              <div className="cc-who rule">
                <h5>{t("규칙")}</h5>
                <ul>{sum.rules.map((r, i) => <li key={i}><span className="cc-stat">{r}</span></li>)}</ul>
              </div>
            )}
            {sum.by.size > 0 && <p className="cc-note">{t("적에게 걸리는 HP·공격력·방어력·마법 저항은 위 '등장 적' 수치에 반영됩니다 (같은 능력치는 더합니다).")}</p>}
          </div>
        ) : (
          <ul className="cc-raw">{sum.rows.map((r, i) => <li key={i}><b>{r.name}</b> {r.desc}</li>)}</ul>
        ))}
      </div>
      {(mode === "hm" ? [[-2, null] as const] : [...sets.map((g, i) => [i, g] as const), [-1, null] as const]).map(([gi, g]) => {
        const rows = cards.map((x, i) => [x, i] as const).filter(([x]) => gi === -2 || x.g === gi);
        if (!rows.length) return null;
        return (
          <div key={gi} className="st-cr-group">
            {gi !== -2 && <h4>{g ? g[0] : t("기타")}{g && g[1] > 0 && <em>{t("세트 완료 +{n}", { n: String(g[1]) })}</em>}</h4>}
            <ul className="st-runes">{rows.map(([c, i]) => card(c, i))}</ul>
          </div>
        );
      })}
    </>
  );
}
