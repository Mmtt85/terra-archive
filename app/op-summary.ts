// 오퍼 상세 요약 한 단락 — 상세 페이지 맨 위(app/home.tsx OperatorPage)와 구조화 데이터(app/seo-operator.ts)가 같이 쓴다.
// 왜 (2026-10-12, 사용자 승인 "AI 검색"): AI 검색은 질문에 바로 답이 되는 짧은 사실 문장을 인용하는데, 오퍼 정보가
// 표·칸으로만 흩어져 있어 인용할 문장이 없었다. 데이터로 만들어 오퍼마다 내용이 다르다.
// 한국어는 조사(은/는) 없이 나열한다 — 'CONFESS-47' 같은 영문·숫자 이름에서 조사가 어색해진다.
import eventIds from "./data/event-ids.json";

type Named = { name: string };
export type SummaryOp = {
  name: string; code?: string; rarity: number; job: string; subProfession?: string; position?: string;
  factions?: string[]; trait?: string; skills?: Named[]; talents?: Named[];
  infrastructure?: (Named & { room?: string })[]; modules?: unknown[];
};
type Loc = "ko" | "en" | "ja";

const q = (loc: Loc, s: string) => (loc === "en" ? `“${s}”` : `「${s}」`);
const list = (loc: Loc, xs: string[]) => xs.map((x) => q(loc, x)).join(loc === "en" ? ", " : loc === "ja" ? "・" : "·");
const end = (loc: Loc, s: string) => (/[.。!?！？]$/.test(s) ? s : s + (loc === "ja" ? "。" : "."));

/** 게임 데이터를 마지막으로 받아 맞춘 날 (데이터 파이프라인이 매 회차 적는다) */
export const DATA_DATE: string = (eventIds as { updated?: string }).updated ?? "";
export function dataDateLabel(loc: Loc): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(DATA_DATE);
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (loc === "ko") return `${y}년 ${mo}월 ${d}일`;
  if (loc === "ja") return `${y}年${mo}月${d}日`;
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function opSummary(loc: Loc, op: SummaryOp): string {
  const skills = (op.skills ?? []).map((s) => s.name).filter(Boolean);
  const talents = (op.talents ?? []).map((s) => s.name).filter(Boolean);
  // 인프라 스킬은 방별로 묶는다 — "숙소 「독거」·「비가」"
  const rooms = new Map<string, string[]>();
  for (const b of op.infrastructure ?? []) {
    if (!b.name) continue;
    const r = b.room ?? "";
    if (!rooms.has(r)) rooms.set(r, []);
    if (!rooms.get(r)!.includes(b.name)) rooms.get(r)!.push(b.name);
  }
  const infra = [...rooms].map(([r, ns]) => `${r ? `${r} ` : ""}${list(loc, ns)}`).join(loc === "en" ? "; " : " · ");
  const factions = (op.factions ?? []).filter(Boolean);
  const nMod = op.modules?.length ?? 0;
  const trait = (op.trait ?? "").replace(/\s+/g, " ").trim();
  const sub = [op.subProfession, op.position].filter(Boolean);
  // 코드가 이름과 같으면(CONFESS-47·SKADI) 괄호를 붙이지 않는다
  const code = op.code && op.code.toLowerCase() !== op.name.toLowerCase() ? op.code : "";
  const out: string[] = [];
  if (loc === "ko") {
    out.push(`명일방주(명방) ${op.rarity}성 ${op.job} 오퍼레이터 ${op.name}${code ? `(${code})` : ""} — ${sub.length ? `세부 직군 ${sub.join("·")}` : ""}${factions.length ? `${sub.length ? ", " : ""}소속 ${factions.join("·")}` : ""}.`);
    if (trait) out.push(`특성: ${end(loc, trait)}`);
    if (skills.length) out.push(`스킬: ${list(loc, skills)}.`);
    if (talents.length) out.push(`재능: ${list(loc, talents)}.`);
    if (infra) out.push(`인프라(기반시설) 스킬: ${infra}.`);
    if (nMod) out.push(`모듈 ${nMod}종.`);
  } else if (loc === "ja") {
    out.push(`アークナイツの★${op.rarity}${op.job}オペレーター、${op.name}${code ? `（${code}）` : ""}。${sub.length ? `職分は${sub.join("・")}` : ""}${factions.length ? `${sub.length ? "、" : ""}所属は${factions.join("・")}` : ""}。`);
    if (trait) out.push(`特性：${end(loc, trait)}`);
    if (skills.length) out.push(`スキル：${list(loc, skills)}。`);
    if (talents.length) out.push(`素質：${list(loc, talents)}。`);
    if (infra) out.push(`基地スキル：${infra}。`);
    if (nMod) out.push(`モジュール${nMod}種。`);
  } else {
    out.push(`${op.name}${code ? ` (${code})` : ""} is a ${op.rarity}★ ${op.job} operator in Arknights${sub.length ? ` (${sub.join(", ")})` : ""}${factions.length ? `, affiliated with ${factions.join(" / ")}` : ""}.`);
    if (trait) out.push(`Trait: ${end(loc, trait)}`);
    if (skills.length) out.push(`Skills: ${list(loc, skills)}.`);
    if (talents.length) out.push(`Talents: ${list(loc, talents)}.`);
    if (infra) out.push(`Base (RIIC) skills: ${infra}.`);
    if (nMod) out.push(`${nMod} module${nMod > 1 ? "s" : ""}.`);
  }
  return out.join(" ").replace(/ — \./, ".").replace(/。。/g, "。");
}

// ── 작전·적 상세 요약 (2026-10-12, 같은 이유) — StagePage·EnemyPage 맨 위와 seo-stage·seo-enemy 구조화 데이터 ──
type StageLike = { code: string; name: string; ap?: number; danger?: string };
type StageViewLike = { stage: StageLike; zone: string; typeName: string;
  drops: { name: string; occ?: string }[]; enemies: { name: string; cnt: number }[] };

export function stageSummary(loc: Loc, v: StageViewLike): string {
  const s = v.stage;
  const where = [v.typeName, v.zone && v.zone !== v.typeName ? v.zone : ""].filter(Boolean);
  // 등장 적은 많이 나오는 순 6종까지, 드랍은 앞 5종까지
  const ens = [...v.enemies].sort((a, b) => b.cnt - a.cnt).slice(0, 6);
  const enText = ens.map((e) => `${q(loc, e.name)}${e.cnt > 1 ? `×${e.cnt}` : ""}`).join(loc === "en" ? ", " : loc === "ja" ? "・" : "·");
  const drops = [...new Set(v.drops.map((d) => d.name).filter(Boolean))].slice(0, 5);
  const out: string[] = [];
  if (loc === "ko") {
    out.push(`명일방주(명방) 작전 ${s.code} ${s.name}${where.length ? ` — ${where.join(" · ")}` : ""}.`);
    if (s.ap) out.push(`소모 이성 ${s.ap}.`);
    if (s.danger) out.push(`권장 수준 ${s.danger}.`);
    if (ens.length) out.push(`등장 적 ${v.enemies.length}종: ${enText}${v.enemies.length > ens.length ? " 등" : ""}.`);
    if (drops.length) out.push(`드랍: ${list(loc, drops)}.`);
  } else if (loc === "ja") {
    out.push(`アークナイツの作戦 ${s.code}「${s.name}」${where.length ? `（${where.join("・")}）` : ""}。`);
    if (s.ap) out.push(`消費理性${s.ap}。`);
    if (s.danger) out.push(`推奨レベル ${s.danger}。`);
    if (ens.length) out.push(`出現する敵${v.enemies.length}種：${enText}${v.enemies.length > ens.length ? "など" : ""}。`);
    if (drops.length) out.push(`ドロップ：${list(loc, drops)}。`);
  } else {
    out.push(`Arknights stage ${s.code} “${s.name}”${where.length ? ` (${where.join(", ")})` : ""}.`);
    if (s.ap) out.push(`Sanity cost ${s.ap}.`);
    if (s.danger) out.push(`Recommended level ${s.danger}.`);
    if (ens.length) out.push(`${v.enemies.length} enemy type${v.enemies.length > 1 ? "s" : ""}: ${enText}${v.enemies.length > ens.length ? ", and more" : ""}.`);
    if (drops.length) out.push(`Drops: ${list(loc, drops)}.`);
  }
  return out.join(" ");
}

type EnemyLike = { name: string; idx: string | null; race: string[]; abil: string[];
  lv: { hp: number; atk: number; def: number; res: number }[] };
/** rankLabel 은 화면이 번역해 넘긴다(일반·정예·보스), stageCodes 는 등장 작전 코드 */
export function enemySummary(loc: Loc, e: EnemyLike, rankLabel: string, stageCodes: string[]): string {
  const st = e.lv[0];
  const abil = e.abil.map((a) => a.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 2)
    .map((a) => (a.length > 70 ? `${a.slice(0, 69)}…` : a));
  const codes = [...new Set(stageCodes)];
  const ex = codes.slice(0, 4).join(loc === "en" ? ", " : loc === "ja" ? "・" : "·");
  const out: string[] = [];
  if (loc === "ko") {
    out.push(`명일방주(명방) 적 ${e.name}${e.idx ? `(${e.idx})` : ""} — ${[rankLabel, e.race.length ? `종족 ${e.race.join("·")}` : ""].filter(Boolean).join(", ")}.`);
    if (st) out.push(`기본 스탯 HP ${st.hp}·공격력 ${st.atk}·방어력 ${st.def}·마법 저항 ${st.res}.`);
    if (abil.length) out.push(`능력: ${abil.join(" / ")}${/[.。]$/.test(abil[abil.length - 1]) ? "" : "."}`);
    if (codes.length) out.push(`등장 작전 ${codes.length}개 (${ex}${codes.length > 4 ? " 등" : ""}).`);
  } else if (loc === "ja") {
    out.push(`アークナイツの敵「${e.name}」${e.idx ? `（${e.idx}）` : ""}。${[rankLabel, e.race.length ? `種族は${e.race.join("・")}` : ""].filter(Boolean).join("、")}。`);
    if (st) out.push(`基礎ステータス HP ${st.hp}・攻撃力 ${st.atk}・防御力 ${st.def}・術耐性 ${st.res}。`);
    if (abil.length) out.push(`能力：${abil.join(" / ")}${/[.。]$/.test(abil[abil.length - 1]) ? "" : "。"}`);
    if (codes.length) out.push(`出現作戦${codes.length}件（${ex}${codes.length > 4 ? "など" : ""}）。`);
  } else {
    out.push(`${e.name}${e.idx ? ` (${e.idx})` : ""} is an Arknights enemy${rankLabel ? ` — ${rankLabel}` : ""}${e.race.length ? `, race ${e.race.join(" / ")}` : ""}.`);
    if (st) out.push(`Base stats: HP ${st.hp}, ATK ${st.atk}, DEF ${st.def}, RES ${st.res}.`);
    if (abil.length) out.push(`Abilities: ${abil.join(" / ")}${/[.。]$/.test(abil[abil.length - 1]) ? "" : "."}`);
    if (codes.length) out.push(`Appears in ${codes.length} stage${codes.length > 1 ? "s" : ""} (${ex}${codes.length > 4 ? ", …" : ""}).`);
  }
  return out.join(" ").replace(/ — \./, ".").replace(/。。/g, "。");
}
