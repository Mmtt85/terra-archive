"use client";

// 통합전략 탭 — 토픽: 팬텀 & 크림슨 솔리테어(rogue_1) + 침몰자의 흑류수해(rogue_6, CN 선행·미래시).
// 데이터는 scripts/build-rogue.py가 생성하는 app/data/rogue1.json / rogue6.json (클뜯 레포 원본).
// rogue_6은 CN 데이터를 한국어화(rogue6-ko.json)한 것으로, 이름류는 중국어 원문(cn)을 병기한다.
// 조우의 층별 출현 규칙·엔딩 선제조건은 클라 데이터에 없어 PRTS 기반 큐레이션(rogueN-curated.json)을 병합한다.
import { useEffect, useMemo, useState } from "react";
import rogue1Data from "./data/rogue1.json";
import { useI18n } from "./i18n";
import { normSearch } from "./search";

type Zone = { id: string; num: number; name: string; time: string | null; desc: string; buff: string | null; hidden: boolean; img?: boolean; variant?: boolean; cn?: string };
type StageEnemy = { key: string; cnt: number };
type Emg = {
  mul?: Record<string, number>; add?: Record<string, number>;
  per?: { keys: string[]; mul: Record<string, number> }[];  // 특정 적 한정 배율
  replace?: Record<string, string>;                          // 긴급 시 적 교체 (원본→변종)
} | null;
type Stage = { id: string; kind: string; zone: number | null; code: string | null; name: string; desc: string | null; eliteDesc: string | null; emg: Emg; map?: string | null; enemies: StageEnemy[]; cn?: string };
type Enemy = { name: string; rank: string | null; index: string | null; attack: string | null; desc: string | null; ability: string | null; hp: number; atk: number; def: number; res: number; aspd: number; ms: number; weight: number; lifePoint: number; immune?: string[]; img?: string | null; cn?: string };
type Relic = { id: string; name: string; desc: string | null; usage: string | null; obtain: string | null; order: string | null; group: number | null; sort: number; sp: boolean; img?: boolean; cn?: string };
type Capsule = { id: string; name: string; en: string | null; desc: string | null; usage: string | null; img?: boolean; cn?: string };
type Simple = { id: string; name: string; desc?: string | null; usage: string | null; img?: boolean; cn?: string };
type Scrap = { id: string; name: string; type: string | null; typeName: string | null; usage: string | null; desc: string | null; img?: boolean; cn?: string };
type Weather = { id: string; name: string; levels: { lv: string; desc: string | null }[]; img?: boolean; cn?: string };
type SubWeather = { id: string; name: string; desc: string | null; img?: boolean; cn?: string };
type Variation = { id: string; name: string; func: string | null; desc: string | null; fusion: boolean; img?: boolean; cn?: string };
type Difficulty = { mode: string; grade: number; name: string; rule: string | null; score: number | null };
type Ending = { id: string; name: string; desc: string | null; boss: string | null; priority: number; change: string | null; cond?: string[]; cn?: string };
type Encounter = { scene: string; title: string; desc: string | null; bg?: string | null; choices: { title: string; desc: string | null }[]; floors?: number[]; note?: string; cn?: string };
type RogueData = {
  id: string; name: string; line: string | null; cnName?: string; future?: boolean;
  zones: Zone[]; nodeTypes: { id: string; name: string; desc: string | null }[];
  difficulties: Difficulty[]; stages: Stage[]; enemies: Record<string, Enemy>;
  relics: Relic[]; capsules?: Capsule[]; tools: Simple[]; bands: Simple[]; exploreTools?: Simple[];
  scraps?: Scrap[]; legacies?: Simple[]; buoys?: Simple[];
  weathers?: Weather[]; subweathers?: SubWeather[];
  variations: Variation[]; endings: Ending[]; encounters: Encounter[];
};

const rogue1 = rogue1Data as unknown as RogueData;
// 현재 활성 토픽 데이터 — RogueGuide 렌더 최상단에서 갱신한다 (모달·applyDiff 등이 참조).
// 자식 컴포넌트는 항상 RogueGuide 렌더 뒤에 동기 렌더되므로 안전하다.
let data = rogue1;
function setActiveData(d: RogueData) { data = d; }

// CN 선행 토픽의 이름 표기 — 중국어 원문이 메인, 한국어 번역이 다음 줄 서브 (사용자 확정 2026-07)
function Nm({ name, cn }: { name: string; cn?: string }) {
  return cn ? <><span lang="zh">{cn}</span><span className="rg-sub">{name}</span></> : <>{name}</>;
}

type View = "map" | "enemy" | "archive" | "hallu" | "diff" | "ending";
// hallu 자리의 토픽별 라벨 — 없는 토픽(IS3~5)은 탭 자체를 숨긴다
const HALLU_LABEL: Record<string, string> = { rogue_1: "환각", rogue_2: "메아리", rogue_6: "환경" };
const viewsFor = (topic: string): { id: View; label: string }[] => [
  { id: "map", label: "맵·노드" },
  { id: "enemy", label: "적 도감" },
  { id: "archive", label: "전시관" },
  ...(HALLU_LABEL[topic] ? [{ id: "hallu" as View, label: HALLU_LABEL[topic] }] : []),
  { id: "diff", label: "난이도" },
  { id: "ending", label: "엔딩" },
];

const RANK_KO: Record<string, string> = { NORMAL: "일반", ELITE: "정예", BOSS: "리더" };

// ── 난이도 스탯 적용 ────────────────────────────────────────────────────────
// 수치 규칙 (difficulties.ruleDesc 근거 — 토픽마다 다르다):
// rogue_1 (팬텀 & 크림슨 솔리테어):
//   g5+  : 모든 정예·리더 적 HP ×1.2
//   g10+ : 긴급 작전·험난한 길에서 적 공격력·HP ×1.15
//   g14+ : 정예·리더 등장 후 20초 공격력 ×1.3 / 받는 대미지 -50% (한시 효과 — 별도 표기)
// rogue_6 (침몰자의 흑류수해):
//   g5+  : 모든 적 최대 HP ×1.3
//   g8+  : 정예·리더 공격력 ×1.15
//   g11+ : 리더가 받는 대미지 -20% (수치 미반영 — 별도 표기)
// 긴급 작전 자체 배율은 레벨 룬(emg — 스테이지마다 다름)으로 별도 적용.
type StatCtx = { emergencyOrBoss?: boolean; emg?: Emg; enemyKey?: string };
function applyDiff(e: Enemy, grade: number, ctx: StatCtx) {
  let hp = e.hp, atk = e.atk, def = e.def;
  if (ctx.emg) {
    const m = ctx.emg.mul ?? {};
    if (m.max_hp) hp *= m.max_hp;
    if (m.atk) atk *= m.atk;
    if (m.def) def *= m.def;
    const a = ctx.emg.add ?? {};
    if (a.max_hp) hp += a.max_hp;
    if (a.atk) atk += a.atk;
    if (a.def) def += a.def;
    // 특정 적 한정 배율 (ebuff_attribute의 enemy 셀렉터)
    if (ctx.enemyKey) {
      for (const p of ctx.emg.per ?? []) {
        if (!p.keys.includes(ctx.enemyKey)) continue;
        if (p.mul.max_hp) hp *= p.mul.max_hp;
        if (p.mul.atk) atk *= p.mul.atk;
        if (p.mul.def) def *= p.mul.def;
      }
    }
  }
  const elite = e.rank === "ELITE" || e.rank === "BOSS";
  const boss = e.rank === "BOSS";
  let res = e.res;
  let burst14 = false, guard = 0; // guard = 피격 대미지 감소 뱃지(%) — 토픽별 규칙
  if (data.id === "rogue_6") {
    if (grade >= 5) hp *= 1.3;
    if (grade >= 8 && elite) atk *= 1.15;
    if (grade >= 11 && boss) guard = 20;
  } else if (data.id === "rogue_2") {
    // g3+/g12+ 마법 저항 +10 · g5+ 리더 공/방 +15% · g11+ 정예·리더 HP +20% · g15 정예·리더 전 스탯 +20%
    if (grade >= 3) res += 10;
    if (grade >= 5 && boss) { atk *= 1.15; def *= 1.15; }
    if (grade >= 11 && elite) hp *= 1.2;
    if (grade >= 12) res += 10;
    if (grade >= 15 && elite) { atk *= 1.2; def *= 1.2; hp *= 1.2; }
  } else if (data.id === "rogue_3") {
    // g4+ 정예 공격 +10% · g5+ 전체 공/HP +5% · g10+ 전체 공격 +10% · g14+ 전체 방/HP +5% · g15 전체 +10%
    if (grade >= 4 && e.rank === "ELITE") atk *= 1.1;
    if (grade >= 5) { atk *= 1.05; hp *= 1.05; }
    if (grade >= 10) atk *= 1.1;
    if (grade >= 14) { def *= 1.05; hp *= 1.05; }
    if (grade >= 15) { atk *= 1.1; def *= 1.1; hp *= 1.1; }
    if (grade >= 11 && boss) guard = 5; // 리더 피격 대미지 -5% (표기만)
  } else if (data.id === "rogue_4") {
    // g4+ 정예·리더 HP +20% · g10+ 정예·리더 피격 대미지 -10% (표기만)
    if (grade >= 4 && elite) hp *= 1.2;
    if (grade >= 10 && elite) guard = 10;
  } else if (data.id === "rogue_5") {
    // g4+ 전체 HP +40% · g8+ 정예·리더 방/HP +20% · g11+ 전체 공격 +20% · g14+ 리더 피격 -20% (표기만)
    if (grade >= 4) hp *= 1.4;
    if (grade >= 8 && elite) { def *= 1.2; hp *= 1.2; }
    if (grade >= 11) atk *= 1.2;
    if (grade >= 14 && boss) guard = 20;
  } else {
    if (grade >= 5 && elite) hp *= 1.2;
    if (grade >= 10 && ctx.emergencyOrBoss) { hp *= 1.15; atk *= 1.15; }
    burst14 = grade >= 14 && elite;
  }
  return { hp: Math.round(hp), atk: Math.round(atk), def: Math.round(def), res, burst14, guard };
}

const fmt = (n: number) => n.toLocaleString("en-US");

function StatRow({ e, grade, ctx }: { e: Enemy; grade: number; ctx: StatCtx }) {
  const { t } = useI18n();
  const s = applyDiff(e, grade, ctx);
  const up = (v: number, b: number) => v !== Math.round(b);
  return (
    <div className="rg-stats" role="group">
      <span className={up(s.hp, e.hp) ? "rg-stat up" : "rg-stat"} title={t("최대 HP")}>HP {fmt(s.hp)}</span>
      <span className={up(s.atk, e.atk) ? "rg-stat up" : "rg-stat"} title={t("공격력")}>{t("공격")} {fmt(s.atk)}</span>
      <span className={up(s.def, e.def) ? "rg-stat up" : "rg-stat"} title={t("방어력")}>{t("방어")} {fmt(s.def)}</span>
      <span className="rg-stat" title={t("마법 저항")}>{t("마저")} {s.res}</span>
      {s.burst14 && <span className="rg-stat g14" title={t("난이도 14 이상: 정예·리더가 등장 후 20초간 공격력 +30%, 받는 물리·마법 대미지 -50%")}>{t("등장 20초")} {t("공격")} {fmt(Math.round(s.atk * 1.3))}</span>}
      {s.guard > 0 && <span className="rg-stat g14" title={t("고난이도에서 이 적이 받는 물리·마법 대미지가 감소합니다")}>{t("받는 대미지")} -{s.guard}%</span>}
    </div>
  );
}

// ── 스테이지 상세 모달 — 일반/긴급이 같은 맵을 공유하므로 페어로 받아 탭 전환 ──
export type StagePair = { n: Stage; e?: Stage };
function StageModal({ pair, grade, onClose, onOpenEnemy }: {
  pair: StagePair; grade: number; onClose: () => void; onOpenEnemy: (key: string, ctx: StatCtx) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"n" | "e">("n");
  const [mapZoom, setMapZoom] = useState(false); // 미리보기 클릭 → 2배 확대 토글
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const stage = mode === "e" && pair.e ? pair.e : pair.n;
  const isEmg = stage.kind === "emergency";
  const isBoss = stage.kind === "boss";
  const ctx: StatCtx = { emergencyOrBoss: isEmg || isBoss, emg: isEmg ? stage.emg : null };
  const mul = stage.emg?.mul ?? {};
  return (
    <div className="rg-modal-back" onClick={onClose} role="presentation">
      <div className="rg-modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <header className="rg-modal-head">
          <div>
            <span className={`rg-kind k-${stage.kind}`}>{t(KIND_LABEL[stage.kind] ?? stage.kind)}</span>
            <h3><Nm name={stage.name} cn={stage.cn} /></h3>
            {stage.zone != null && <span className="rg-modal-zone">{t("{n}층", { n: stage.zone })}</span>}
          </div>
          <button type="button" className="rg-modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        </header>
        {pair.e && (
          <div className="rg-modal-modes" role="tablist" aria-label={t("작전 모드")}>
            <button type="button" role="tab" aria-selected={mode === "n"} className={mode === "n" ? "on" : ""} onClick={() => setMode("n")}>{t("일반 작전")}</button>
            <button type="button" role="tab" aria-selected={mode === "e"} className={`emg${mode === "e" ? " on" : ""}`} onClick={() => setMode("e")}>{t("긴급 작전")}</button>
          </div>
        )}
        <div className="rg-modal-cols">
          <div className="rg-modal-left">
            {stage.map && (
              <button type="button" className={`rg-map-zoom${mapZoom ? " zoom" : ""}`}
                onClick={() => setMapZoom((z) => !z)}
                title={mapZoom ? t("클릭하면 원래 크기로 돌아갑니다") : t("클릭하면 2배로 확대됩니다")}>
                <img className="rg-modal-map" src={`/rogue/map/${stage.map}.webp`} alt={t("전장 미니맵")} loading="lazy" decoding="async" />
              </button>
            )}
            {stage.desc && <p className="rg-modal-desc">{stage.desc}</p>}
            {stage.eliteDesc && <p className="rg-modal-elite">⚠ {stage.eliteDesc}</p>}
            {isEmg && (mul.atk || mul.max_hp || mul.def) && (
              <p className="rg-modal-elite">
                {t("긴급 배율")}: {mul.atk ? `${t("공격")} ×${mul.atk} ` : ""}{mul.def ? `${t("방어")} ×${mul.def} ` : ""}{mul.max_hp ? `HP ×${mul.max_hp}` : ""}
              </p>
            )}
            {isEmg && (stage.emg?.per ?? []).map((p, i) => (
              <p key={i} className="rg-modal-elite">
                {t("특정 적 강화")} ({p.keys.map((k) => data.enemies[k]?.name ?? k).join(", ")}):
                {p.mul.atk ? ` ${t("공격")} ×${p.mul.atk}` : ""}{p.mul.def ? ` ${t("방어")} ×${p.mul.def}` : ""}{p.mul.max_hp ? ` HP ×${p.mul.max_hp}` : ""}
              </p>
            ))}
            {isEmg && stage.emg?.replace && Object.keys(stage.emg.replace).length > 0 && (
              <p className="rg-modal-elite">
                {t("긴급 시 적 교체")}: {Object.entries(stage.emg.replace).map(([f, to]) =>
                  `${data.enemies[f]?.name ?? f} → ${data.enemies[to]?.name ?? to}`).join(" · ")}
              </p>
            )}
          </div>
          <div className="rg-modal-enemies">
          {/* 리더 → 정예 → 일반 순으로 정렬 (사용자 확정 2026-07-18) */}
          {[...stage.enemies].sort((a, b) => {
            const rankOrder = (k: string) => ({ BOSS: 0, ELITE: 1 }[data.enemies[k]?.rank ?? ""] ?? 2);
            return rankOrder(a.key) - rankOrder(b.key);
          }).map((se) => {
            // 긴급 모드에선 교체 룬(level_enemy_replace)이 적용된 변종으로 표시
            const key = isEmg ? (stage.emg?.replace?.[se.key] ?? se.key) : se.key;
            const e = data.enemies[key];
            if (!e) return null;
            return (
              <button type="button" key={se.key} className="rg-enemy-cell" onClick={() => onOpenEnemy(key, { ...ctx, enemyKey: key })}>
                {e.img ? <img className="rg-enemy-face" src={`/rogue/enemy/${e.img}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />
                  : <span className="rg-enemy-face none" aria-hidden>?</span>}
                <span className="rg-enemy-cell-head">
                  <span className={`rg-rank r-${e.rank ?? "NORMAL"}`}>{t(RANK_KO[e.rank ?? ""] ?? "일반")}</span>
                  {se.cnt > 0 && <span className="rg-enemy-cnt">×{se.cnt}</span>}
                </span>
                <span className="rg-enemy-name"><Nm name={e.name} cn={e.cn} /></span>
                <StatRow e={e} grade={grade} ctx={{ ...ctx, enemyKey: key }} />
              </button>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  normal: "작전", emergency: "긴급 작전", boss: "험난한 길", event: "조우 전투", special: "특수",
  duel: "외나무다리", trial: "시련", chase: "추격전", savage: "거점전", incident: "조우 전투",
};

// 전투 노드 카드 — 인게임 맵 미리보기 + 이름 (클릭 → 상세, 일반/긴급은 모달 탭 전환)
function StageCard({ pair, onOpen, boss }: { pair: StagePair; onOpen: (p: StagePair) => void; boss?: boolean }) {
  const s = pair.n;
  return (
    <button type="button" className={`rg-stagecard${boss ? " boss" : ""}`} onClick={() => onOpen(pair)}>
      {s.map && <img className="rg-stagecard-map" src={`/rogue/map/${s.map}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
      <span className="rg-stagecard-name"><Nm name={s.name} cn={s.cn} /></span>
    </button>
  );
}

// ── 적 상세 모달 — 도감 카드·스테이지 모달의 적 행에서 연다 (스테이지 모달 위에 스택) ──
function EnemyModal({ ekey, grade, ctx, onClose, onOpenStage, appear }: {
  ekey: string; grade: number; ctx: StatCtx; onClose: () => void;
  onOpenStage: (s: Stage) => void; appear: Stage[];
}) {
  const { t } = useI18n();
  const e = data.enemies[ekey];
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!e) return null;
  return (
    <div className="rg-modal-back stack" onClick={onClose} role="presentation">
      <div className="rg-modal rg-emodal" role="dialog" aria-modal onClick={(ev) => ev.stopPropagation()}>
        <header className="rg-modal-head">
          <div>
            {e.img ? <img className="rg-enemy-face lg" src={`/rogue/enemy/${e.img}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />
              : <span className="rg-enemy-face lg none" aria-hidden>?</span>}
            <span className={`rg-rank r-${e.rank ?? "NORMAL"}`}>{t(RANK_KO[e.rank ?? ""] ?? "일반")}</span>
            <h3><Nm name={e.name} cn={e.cn} /></h3>
            {e.index && <span className="rg-modal-zone">{e.index}</span>}
          </div>
          <button type="button" className="rg-modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        </header>
        {e.attack && <p className="rg-emodal-row"><strong>{t("공격 방식")}</strong> {e.attack}</p>}
        {e.desc && <p className="rg-emodal-desc">{e.desc}</p>}
        {e.ability && <p className="rg-emodal-ability">{e.ability}</p>}
        {e.immune && e.immune.length > 0 && (
          <p className="rg-emodal-immune"><strong>{t("상태이상 면역")}</strong>
            {e.immune.map((im) => <span key={im} className="rg-immune-chip">{t(im)}</span>)}
          </p>
        )}
        {/* 연 곳(노드 상세/도감)의 배율 컨텍스트를 그대로 물려받아 표시 — 수치 불일치 방지 */}
        {ctx.emg && <p className="rg-ctx-note">{t("긴급 작전 배율이 반영된 수치입니다.")}</p>}
        {!ctx.emg && ctx.emergencyOrBoss && grade >= 10 && <p className="rg-ctx-note">{t("난이도 10 이상 험난한 길·긴급 작전 배율(공격·HP ×1.15)이 반영된 수치입니다.")}</p>}
        <StatRow e={e} grade={grade} ctx={{ ...ctx, enemyKey: ekey }} />
        <div className="rg-stats sub">
          <span className="rg-stat">{t("공속")} {e.aspd}</span>
          <span className="rg-stat">{t("이속")} {e.ms}</span>
          <span className="rg-stat">{t("무게")} {e.weight}</span>
          <span className="rg-stat">{t("침투 피해")} {e.lifePoint}</span>
        </div>
        {appear.length > 0 && (
          <div className="rg-appear">
            <strong>{t("등장 노드")}</strong>
            <div className="rg-chips">
              {appear.map((s) => (
                <button key={s.id} type="button" className={`rg-chip${s.kind === "boss" ? " boss" : ""}`}
                  onClick={() => onOpenStage(s)}>
                  {s.zone != null ? `${s.zone}F ` : ""}<Nm name={s.name} cn={s.cn} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 조우 상세 모달 — 엔딩 조건 등에서 조우를 참조할 때 연다 ──────────────────
function EncounterModal({ enc, onClose }: { enc: Encounter; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="rg-modal-back stack" onClick={onClose} role="presentation">
      <div className="rg-modal" role="dialog" aria-modal onClick={(ev) => ev.stopPropagation()}>
        <header className="rg-modal-head">
          <div>
            <span className="rg-kind">{t("우연한 만남")}</span>
            <h3><Nm name={enc.title} cn={enc.cn} /></h3>
            {enc.floors && <span className="rg-modal-zone">{enc.floors.join("·")}{t("층")}</span>}
          </div>
          <button type="button" className="rg-modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        </header>
        <div className="rg-modal-cols enc">
          <div className="rg-modal-left">
            {enc.bg && <img className="rg-enc-cg modal" src={`/rogue/scene/${enc.bg}.webp`} alt={enc.title} loading="lazy" decoding="async" />}
          </div>
          <div className="rg-enc-body">
            {enc.desc && <p className="rg-modal-desc">{enc.desc}</p>}
            {enc.note && <p className="rg-enc-note">{enc.note}</p>}
            <ul className="rg-enc-choices">
              {enc.choices.map((c, i) => (
                <li key={i}><strong>{c.title}</strong>{c.desc ? ` — ${c.desc}` : ""}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 유물 상세 모달 — 엔딩 조건의 분기 아이템 참조에서 연다 ───────────────────
function RelicModal({ relic, onClose }: { relic: Relic; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="rg-modal-back stack" onClick={onClose} role="presentation">
      <div className="rg-modal rg-rmodal" role="dialog" aria-modal onClick={(ev) => ev.stopPropagation()}>
        <header className="rg-modal-head">
          <div>
            {relic.img && <img className="rg-relic-icon lg" src={`/rogue/relic/${relic.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
            {relic.order && <span className="rg-relic-no">{relic.order}</span>}
            <h3><Nm name={relic.name} cn={relic.cn} /></h3>
          </div>
          <button type="button" className="rg-modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        </header>
        {relic.usage && <p className="rg-relic-usage">{relic.usage}</p>}
        {relic.desc && <p className="rg-relic-desc">{relic.desc}</p>}
        {relic.obtain && <p className="rg-relic-obtain">{relic.obtain}</p>}
      </div>
    </div>
  );
}

// ── 층 상세 모달 — 층 카드 클릭 시 (설명 + 작전/보스 카드) ───────────────────
function ZoneModal({ zone, pairs, bosses, onOpenStage, onClose }: {
  zone: Zone; pairs: StagePair[]; bosses: Stage[];
  onOpenStage: (p: StagePair) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="rg-modal-back" onClick={onClose} role="presentation">
      <div className="rg-modal rg-zmodal" role="dialog" aria-modal onClick={(ev) => ev.stopPropagation()}>
        <header className="rg-modal-head">
          <div>
            <span className="rg-zone-num">{zone.hidden ? "?" : t("{n}층", { n: zone.num })}</span>
            <h3><Nm name={zone.name} cn={zone.cn} /></h3>
            {zone.variant && <span className="rg-zone-hidden">{t("변형 구역")}</span>}
            {zone.hidden && <span className="rg-zone-hidden">{t("히든 층")}</span>}
            {zone.time && <span className="rg-modal-zone">{zone.time}</span>}
          </div>
          <button type="button" className="rg-modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        </header>
        <p className="rg-zone-desc">{zone.desc}</p>
        {zone.buff && <p className="rg-modal-elite">{zone.buff}</p>}
        {pairs.length > 0 && (
          <div className="rg-stage-group">
            <h4>{t("작전")} <em>{pairs.length}</em> <span className="rg-stage-hint">{t("카드를 열면 일반/긴급 탭으로 전환할 수 있습니다")}</span></h4>
            <div className="rg-stage-cards">
              {pairs.map((p) => <StageCard key={p.n.id} pair={p} onOpen={onOpenStage} />)}
            </div>
          </div>
        )}
        {bosses.length > 0 && (
          <div className="rg-stage-group">
            <h4 className="boss">{t("험난한 길 (보스)")} <em>{bosses.length}</em></h4>
            <div className="rg-stage-cards">
              {bosses.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={onOpenStage} boss />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 토픽 목록 — ready=데이터 있음, future=미래시 토글 필요 (CN 선행, 비공식 번역명)
const TOPICS: { id: string; name: string; ready?: boolean; future?: boolean }[] = [
  { id: "rogue_1", name: "팬텀 & 크림슨 솔리테어", ready: true },
  { id: "rogue_2", name: "미즈키 & 카이룰라 아버", ready: true },
  { id: "rogue_3", name: "탐험가의 은빛 서리 끝자락", ready: true },
  { id: "rogue_4", name: "살카즈의 영겁 기담", ready: true },
  { id: "rogue_5", name: "쉐이의 기이한 계원", ready: true },
  { id: "rogue_6", name: "침몰자의 흑류수해", ready: true, future: true },
];

// 토픽 데이터 동적 로더 — rogue_1만 기본 번들, 나머지는 선택 시 로드 (각 300~600KB)
const TOPIC_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  rogue_2: () => import("./data/rogue2.json"),
  rogue_3: () => import("./data/rogue3.json"),
  rogue_4: () => import("./data/rogue4.json"),
  rogue_5: () => import("./data/rogue5.json"),
  rogue_6: () => import("./data/rogue6.json"),
};

// 토픽 URL 슬러그 — /rogue?topic=is6 (rogue_1은 파라미터 없음)
const slugOf = (id: string) => "is" + id.split("_")[1];
const topicFromUrl = () => {
  const q = new URLSearchParams(window.location.search).get("topic");
  return TOPICS.find((tp) => tp.ready && slugOf(tp.id) === q)?.id ?? "rogue_1";
};

// ── 메인 ───────────────────────────────────────────────────────────────────
export default function RogueGuide({ includeFuture }: { includeFuture?: boolean }) {
  const { t, locale } = useI18n();

  // 첫 렌더에서 URL의 ?topic= 을 읽어 시작 토픽 결정 (SSR에선 rogue_1)
  const [topic, setTopic] = useState(() => (typeof window === "undefined" ? "rogue_1" : topicFromUrl()));
  const [loaded, setLoaded] = useState<Record<string, RogueData>>({});
  // 뒤로 가기 → 토픽 동기화
  useEffect(() => {
    const onPop = () => setTopic(topicFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // rogue_2~6 데이터는 선택 시에만 동적 로드 (기본 번들에서 제외)
  useEffect(() => {
    if (topic !== "rogue_1" && !loaded[topic] && TOPIC_LOADERS[topic]) {
      TOPIC_LOADERS[topic]().then((m) =>
        setLoaded((cur) => ({ ...cur, [topic]: m.default as RogueData })));
    }
  }, [topic, loaded]);
  const active = topic === "rogue_1" ? rogue1 : loaded[topic] ?? null;
  setActiveData(active ?? rogue1);
  const loading = active == null;

  // 다크 테마 배경을 페이지 전체(100% 폭)에 칠한다 — 토픽별 스킨 클래스(rg2~rg6)
  useEffect(() => {
    const c = document.documentElement.classList;
    c.add("rg-theme");
    for (const tp of TOPICS) c.toggle("rg" + tp.id.split("_")[1], tp.id === topic && tp.id !== "rogue_1");
    return () => { c.remove("rg-theme"); for (const tp of TOPICS) c.remove("rg" + tp.id.split("_")[1]); };
  }, [topic]);
  const [view, setView] = useState<View>("map");
  const [grade, setGrade] = useState(0); // -1 = EASY, 0~15
  const [zoneOpen, setZoneOpen] = useState<Zone | null>(null);
  const [stageOpen, setStageOpen] = useState<StagePair | null>(null);
  const [enemyOpen, setEnemyOpen] = useState<{ key: string; ctx: StatCtx } | null>(null);
  const [encOpen, setEncOpen] = useState<Encounter | null>(null);
  const [relicOpen, setRelicOpen] = useState<Relic | null>(null);
  const [enemyQ, setEnemyQ] = useState("");
  const [enemyRank, setEnemyRank] = useState<string>("");
  const [relicQ, setRelicQ] = useState("");
  const [arcTab, setArcTab] = useState<"relic" | "capsule" | "tool" | "band" | "scrap" | "legacy" | "explore">("relic");
  const VIEWS = viewsFor(topic);

  const switchTopic = (id: string) => {
    if (id === topic) return;
    // 토픽을 URL에 반영 — 공유·새로고침 시에도 같은 테마로 진입
    const url = new URL(window.location.href);
    if (id === "rogue_1") url.searchParams.delete("topic");
    else url.searchParams.set("topic", slugOf(id));
    history.pushState(null, "", url.pathname + url.search + url.hash);
    setTopic(id);
    setView("map");
    setGrade(0);
    setZoneOpen(null); setStageOpen(null); setEnemyOpen(null); setEncOpen(null); setRelicOpen(null);
    setEnemyQ(""); setEnemyRank(""); setRelicQ(""); setArcTab("relic");
  };

  // 해시 딥링크: #rg-<view>
  useEffect(() => {
    const fromHash = () => {
      const m = window.location.hash.match(/^#rg-(\w+)/);
      if (m && viewsFor("rogue_1").some((v) => v.id === m[1])) setView(m[1] as View);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const goView = (v: View) => {
    setView(v);
    history.pushState(null, "", `#rg-${v}`);
  };

  // 층별 전투 노드 — 일반/긴급이 같은 맵을 공유하므로 페어(StagePair)로 묶는다.
  // rogue_6의 조우 전투(t)도 긴급 페어(e_t)가 있다.
  const emgById = useMemo(() => new Map(data.stages.filter((s) => s.kind === "emergency").map((s) => [s.id, s])), [active]);
  const emgOf = (s: Stage): Stage | undefined =>
    s.kind === "normal" ? emgById.get(s.id.replace("_n_", "_e_"))
      : s.kind === "incident" || s.kind === "special" ? emgById.get(s.id.replace("_t_", "_e_t_")) : undefined;
  const pairOf = (s: Stage): StagePair => ({ n: s, e: emgOf(s) });
  const pairsByZone = useMemo(() => {
    const m = new Map<number, StagePair[]>();
    for (const s of data.stages) {
      if (s.zone == null || s.kind !== "normal") continue;
      if (!m.has(s.zone)) m.set(s.zone, []);
      m.get(s.zone)!.push({ n: s, e: emgById.get(s.id.replace("_n_", "_e_")) });
    }
    return m;
  }, [emgById]); // eslint-disable-line react-hooks/exhaustive-deps
  const bossStages = useMemo(() => data.stages.filter((s) => s.kind === "boss"), [active]);
  // 층이 배정되지 않은 보스(층 큐레이션이 없는 토픽) — 이름 없는 더미 보스는 제외
  const orphanBosses = useMemo(() => bossStages.filter((s) => s.zone == null && s.name.trim()), [bossStages]);
  const evStages = useMemo(() => data.stages.filter((s) => s.kind === "event"), [active]);
  const specialStages = useMemo(() => data.stages.filter((s) => s.kind === "special"), [active]);
  const duelStages = useMemo(() => data.stages.filter((s) => s.kind === "duel"), [active]);
  const trialStages = useMemo(() => data.stages.filter((s) => s.kind === "trial"), [active]);
  const chaseStages = useMemo(() => data.stages.filter((s) => s.kind === "chase"), [active]);
  const savageStages = useMemo(() => data.stages.filter((s) => s.kind === "savage"), [active]);
  const incidentStages = useMemo(() => data.stages.filter((s) => s.kind === "incident"), [active]);

  // 적 → 등장 스테이지 역매핑
  const enemyStages = useMemo(() => {
    const m = new Map<string, Stage[]>();
    for (const s of data.stages) {
      if (s.kind === "emergency") continue; // 일반과 중복 (같은 맵)
      for (const se of s.enemies) {
        if (!m.has(se.key)) m.set(se.key, []);
        m.get(se.key)!.push(s);
      }
    }
    return m;
  }, [active]);

  // 도감 컨텍스트 — 험난한 길에만 등장하는 적(보스 등)은 도감에서도 g10+ 배율을
  // 적용해 노드 상세와 같은 수치를 보여준다 (사용자 리포트: 도감/노드 상세 불일치)
  const dexCtx = (key: string): StatCtx => {
    const appear = enemyStages.get(key) ?? [];
    return { emergencyOrBoss: appear.length > 0 && appear.every((s) => s.kind === "boss") };
  };

  const enemies = useMemo(() => {
    const q = normSearch(enemyQ);
    return Object.entries(data.enemies)
      .filter(([, e]) => (!enemyRank || e.rank === enemyRank))
      .filter(([, e]) => !q || normSearch(e.name).includes(q) || (e.cn && normSearch(e.cn).includes(q)))
      .sort(([, a], [, b]) => (RANK_SORT[a.rank ?? ""] ?? 0) - (RANK_SORT[b.rank ?? ""] ?? 0) || a.name.localeCompare(b.name, "ko"));
  }, [enemyQ, enemyRank, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const relics = useMemo(() => {
    const q = normSearch(relicQ);
    return data.relics.filter((r) => !q || normSearch(r.name).includes(q) || (r.cn && normSearch(r.cn).includes(q)) || normSearch(r.usage ?? "").includes(q));
  }, [relicQ, active]); // eslint-disable-line react-hooks/exhaustive-deps


  // 엔딩 조건 문장 속 「이름」 참조를 전부 클릭 가능하게 — 스테이지·조우·유물·적 순으로 매칭
  const stageByName = useMemo(() => new Map(data.stages.filter((s) => s.kind !== "emergency").map((s) => [s.name, s])), [active]);
  const encByTitle = useMemo(() => new Map(data.encounters.map((e) => [e.title, e])), [active]);
  const relicByName = useMemo(() => new Map(data.relics.map((r) => [r.name, r])), [active]);
  const enemyByName = useMemo(() => new Map(Object.entries(data.enemies).map(([k, e]) => [e.name, k])), [active]);
  const renderCond = (text: string) => {
    const parts = text.split(/「([^」]+)」/g);
    return parts.map((part, i) => {
      if (i % 2 === 0) return part;
      const s = stageByName.get(part);
      if (s) return <button key={i} type="button" className="rg-cond-node" onClick={() => setStageOpen(pairOf(s))}>「{part}」</button>;
      const enc = encByTitle.get(part);
      if (enc) return <button key={i} type="button" className="rg-cond-node" onClick={() => setEncOpen(enc)}>「{part}」</button>;
      const rl = relicByName.get(part);
      if (rl) return <button key={i} type="button" className="rg-cond-node relic" onClick={() => setRelicOpen(rl)}>「{part}」</button>;
      const en = enemyByName.get(part);
      if (en) return <button key={i} type="button" className="rg-cond-node" onClick={() => setEnemyOpen({ key: en, ctx: dexCtx(en) })}>「{part}」</button>;
      return `「${part}」`;
    });
  };

  const hasEasy = data.difficulties.some((d) => d.mode === "EASY");
  const normalName = data.difficulties.find((d) => d.mode === "NORMAL")?.name ?? "";
  const easyName = data.difficulties.find((d) => d.mode === "EASY")?.name ?? "";
  // 최고 난이도는 토픽마다 다르다 (IS1/3/6=15, IS2/4/5=승천 18) — 데이터에서 읽는다.
  // switchTopic이 토픽 전환 시 grade를 0으로 리셋하므로 별도 클램프는 불필요.
  const maxGrade = useMemo(() => Math.max(15, ...data.difficulties.filter((d) => d.mode === "NORMAL").map((d) => d.grade)), [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className={`rg${topic === "rogue_1" ? "" : " rg" + topic.split("_")[1]}`} aria-labelledby="rg-title">
      <header className="rg-head">
        <div className="rg-hero">
          <img className="rg-hero-kv" src={`/rogue/kv${topic.split("_")[1]}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />
          <div className="rg-hero-text">
            <span className="rg-eyebrow">INTEGRATED STRATEGIES</span>
            <h2 id="rg-title">{t("통합전략 가이드")}</h2>
            <p className="rg-topic-pick">
              {TOPICS.filter((tp) => !tp.future || includeFuture).map((tp) => (
                <button key={tp.id} type="button"
                  className={`rg-topic ${tp.id === topic ? "on" : tp.ready ? "off ready" : "off"}`}
                  disabled={!tp.ready}
                  title={tp.ready ? undefined : t("준비 중")}
                  onClick={() => tp.ready && switchTopic(tp.id)}>
                  {tp.name}{tp.future && <em className="rg-topic-future">{t("미래시")}</em>}
                </button>
              ))}
            </p>
            {topic === "rogue_6" && (
              <p className="rg-disclaimer">
                {data.cnName && <span className="rg-cn" lang="zh">{data.cnName}</span>}{" "}
                {t("CN 선행 데이터 기반 · 명칭은 비공식 번역이며 중국어 원문을 병기합니다.")}
              </p>
            )}
            {locale !== "ko" && <p className="rg-disclaimer">{t("통합전략 데이터는 현재 한국어로만 제공됩니다.")}</p>}
            {data.line && <p className="rg-line">{data.line}</p>}
          </div>

          {/* 난이도 선택 — 배너 우하단, 모든 스탯 표시에 반영 */}
          <div className="rg-diffbar" role="group" aria-label={t("난이도 선택")}>
            <span className="rg-diffbar-label">{t("난이도")}</span>
            {hasEasy && <button type="button" className={`rg-diff-chip${grade < 0 ? " on" : ""}`} onClick={() => setGrade(-1)}>{t("쉬움")}</button>}
            <input type="range" min={0} max={maxGrade} value={Math.max(0, grade)}
              onChange={(e) => setGrade(Number(e.target.value))}
              aria-label={t("난이도 등급")} />
            <span className={`rg-diff-cur${grade >= 0 ? " on" : ""}`}>
              {grade >= 0 && <em className="rg-diff-hex">{grade}</em>}
              {grade < 0 ? easyName : normalName}
            </span>
          </div>
        </div>
      </header>

      {loading && <p className="rg-loading">{t("데이터를 불러오는 중...")}</p>}

      {!loading && (<>
      <nav className="rg-tabs" aria-label={t("통합전략 섹션")}>
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={view === v.id ? "on" : ""} onClick={() => goView(v.id)}>{t(v.label)}</button>
        ))}
      </nav>

      {view === "map" && (
        <div className="rg-map">
          {/* 층 카드 — 가로 일렬, 클릭하면 층 상세 모달 (사용자 확정 2026-07) */}
          <div className="rg-zone-cards">
          {data.zones.map((z) => {
            const pairs = z.variant ? [] : pairsByZone.get(z.num) ?? [];
            const zoneBosses = z.variant ? [] : bossStages.filter((s) => s.zone === z.num);
            return (
              <button type="button" key={z.id} className={`rg-zonecard${z.hidden ? " hidden-zone" : ""}`}
                onClick={() => setZoneOpen(z)}>
                {z.img && <img className="rg-zonecard-bg" src={`/rogue/zone/${data.id}_map_${z.num}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                <span className="rg-zone-num">{z.hidden ? "?" : t("{n}층", { n: z.num })}</span>
                <span className="rg-zonecard-name"><Nm name={z.name} cn={z.cn} /></span>
                {z.variant && <span className="rg-zone-hidden">{t("변형 구역")}</span>}
                {z.hidden && <span className="rg-zone-hidden">{t("히든 층")}</span>}
                <span className="rg-zone-counts">
                  {pairs.length > 0 && t("작전 {n}개", { n: pairs.length })}
                  {zoneBosses.length > 0 && ` · ${t("보스 {n}개", { n: zoneBosses.length })}`}
                </span>
              </button>
            );
          })}
          </div>

          {/* 층이 배정되지 않은 보스(험난한 길) — 층 큐레이션이 없는 토픽에서 보스맵이 누락되지 않도록 폴백 */}
          {orphanBosses.length > 0 && (
          <details className="rg-zone rg-zone-wide" open>
            <summary className="rg-zone-sum">
              <h3 className="boss">{t("험난한 길 (보스)")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: orphanBosses.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("각 구역 끝에서 마주치는 강력한 적입니다.")}</p>
              <div className="rg-stage-cards">
                {orphanBosses.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} boss />)}
              </div>
            </div>
          </details>
          )}

          {(evStages.length > 0 || specialStages.length > 0) && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("조우 전투")} · {t("특수")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: evStages.length + specialStages.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("우연한 만남 등 이벤트에서 발생하는 전투입니다. 카드를 열면 일반/긴급 탭이 있는 경우 전환할 수 있습니다.")}</p>
              <div className="rg-stage-cards">
                {evStages.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} />)}
                {specialStages.map((s) => <StageCard key={s.id} pair={pairOf(s)} onOpen={setStageOpen} />)}
              </div>
            </div>
          </details>
          )}

          {trialStages.length > 0 && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("시련·특수 전투")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: trialStages.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <div className="rg-stage-cards">
                {trialStages.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} />)}
              </div>
            </div>
          </details>
          )}

          {incidentStages.length > 0 && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("조우 전투")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: incidentStages.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("우연한 만남 등 이벤트에서 발생하는 전투입니다. 카드를 열면 일반/긴급 탭이 있는 경우 전환할 수 있습니다.")}</p>
              <div className="rg-stage-cards">
                {incidentStages.map((s) => <StageCard key={s.id} pair={pairOf(s)} onOpen={setStageOpen} />)}
              </div>
            </div>
          </details>
          )}

          {chaseStages.length > 0 && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("추격전")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: chaseStages.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("행동력이 다 떨어지면 강제로 발생하는 전투입니다. 보스 층에서는 보스 특수판으로 대체됩니다.")}</p>
              <div className="rg-stage-cards">
                {chaseStages.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} />)}
              </div>
            </div>
          </details>
          )}

          {savageStages.length > 0 && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("거점전 ('주민' 거점)")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: savageStages.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("난이도(보밀등급) 4 이상에서만 나타나는 '주민' 거점 노드의 전투입니다. 격파하면 후한 보상과 함께 구역 내 떠돌이 '주민'이 모두 사라집니다.")}</p>
              <div className="rg-stage-cards">
                {savageStages.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} />)}
              </div>
            </div>
          </details>
          )}

          {duelStages.length > 0 && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("외나무다리 (결투)")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: duelStages.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("상대를 골라 싸우는 특수 전투입니다. 패배해도 목표 HP가 깎이지 않으며, 어려운 상대일수록 보상이 좋습니다.")}</p>
              <div className="rg-stage-cards">
                {duelStages.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} />)}
              </div>
            </div>
          </details>
          )}

          {(data.buoys?.length ?? 0) > 0 && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("지도 마커 (부표)")}</h3>
              <span className="rg-zone-counts">{data.buoys!.length}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("격자 지도 위에 나타나는 이벤트 마커입니다.")}</p>
              <div className="rg-relic-grid">
                {data.buoys!.map((b) => (
                  <article key={b.id} className="rg-relic">
                    <header>
                      {b.img && <img className="rg-relic-icon" src={`/rogue/misc/${b.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                      <h4><Nm name={b.name} cn={b.cn} /></h4>
                    </header>
                    {b.usage && <p className="rg-relic-desc">{b.usage}</p>}
                  </article>
                ))}
              </div>
            </div>
          </details>
          )}

          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("우연한 만남·기타 노드")}</h3>
              <span className="rg-zone-counts">{data.encounters.length}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{topic === "rogue_6" ? t("비전투 노드에서 발생하는 이벤트입니다. 출시 직후라 출현 층 정보는 아직 정리되지 않았습니다.") : t("비전투 노드에서 발생하는 이벤트입니다. 출현 층 표기는 위키 실측 기반입니다.")}</p>
              <div className="rg-enc-list">
                {[...data.encounters]
                  .sort((a, b) => (a.floors?.[0] ?? 99) - (b.floors?.[0] ?? 99) || (a.floors?.length ?? 9) - (b.floors?.length ?? 9) || a.title.localeCompare(b.title, "ko"))
                  .map((enc) => (
                    <button key={enc.scene} type="button" className="rg-enc-item" onClick={() => setEncOpen(enc)}>
                      {enc.bg
                        ? <img className="rg-enc-thumb" src={`/rogue/scene/${enc.bg}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />
                        : <span className="rg-enc-thumb none" aria-hidden />}
                      <span className="rg-enc-txt">
                        {enc.floors && <span className="rg-enc-floors">{enc.floors.join("·")}{t("층")}</span>}
                        <span className="rg-enc-title"><Nm name={enc.title} cn={enc.cn} /></span>
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </details>
        </div>
      )}

      {view === "enemy" && (
        <div className="rg-enemy-view">
          <div className="rg-filterbar">
            <input type="search" value={enemyQ} onChange={(e) => setEnemyQ(e.target.value)}
              placeholder={t("적 이름 검색")} aria-label={t("적 이름 검색")} />
            {["", "NORMAL", "ELITE", "BOSS"].map((rk) => (
              <button key={rk || "all"} type="button" className={enemyRank === rk ? "on" : ""}
                onClick={() => setEnemyRank(rk)}>{rk ? t(RANK_KO[rk]) : t("전체")}</button>
            ))}
            <span className="rg-count">{enemies.length}</span>
          </div>
          <div className="rg-enemy-grid">
            {enemies.map(([key, e]) => (
              <button type="button" key={key} className="rg-enemy-card" id={`rg-en-${key}`}
                onClick={() => setEnemyOpen({ key, ctx: dexCtx(key) })}>
                <header>
                  {e.img ? <img className="rg-enemy-face" src={`/rogue/enemy/${e.img}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />
                    : <span className="rg-enemy-face none" aria-hidden>?</span>}
                  <span className={`rg-rank r-${e.rank ?? "NORMAL"}`}>{t(RANK_KO[e.rank ?? ""] ?? "일반")}</span>
                  <h4><Nm name={e.name} cn={e.cn} /></h4>
                  {e.index && <span className="rg-enemy-idx">{e.index}</span>}
                </header>
                <StatRow e={e} grade={grade} ctx={dexCtx(key)} />
              </button>
            ))}
          </div>
        </div>
      )}

      {view === "archive" && (
        <div className="rg-archive">
          <div className="rg-filterbar">
            {([
              ["relic", "소장품 (유물)"] as const,
              ...(topic === "rogue_6"
                ? [["scrap", "부품 (零件)"], ["tool", "도구"], ["band", "스쿼드"], ["legacy", "유산"]] as const
                : [
                    ...((data.capsules?.length ?? 0) > 0 ? [["capsule", "레퍼토리 (음반)"]] as const : []),
                    ["tool", "무대 도구"] as const,
                    ...((data.exploreTools?.length ?? 0) > 0 ? [["explore", "탐사 도구"]] as const : []),
                    ["band", "스쿼드"] as const,
                  ]),
            ]).map(([id, label]) => (
              <button key={id} type="button" className={arcTab === id ? "on" : ""} onClick={() => setArcTab(id)}>{t(label)}</button>
            ))}
            {arcTab === "relic" && (
              <input type="search" value={relicQ} onChange={(e) => setRelicQ(e.target.value)}
                placeholder={t("유물 검색")} aria-label={t("유물 검색")} />
            )}
            <span className="rg-count">
              {arcTab === "relic" ? relics.length
                : arcTab === "capsule" ? data.capsules?.length ?? 0
                : arcTab === "scrap" ? data.scraps?.length ?? 0
                : arcTab === "legacy" ? data.legacies?.length ?? 0
                : arcTab === "explore" ? data.exploreTools?.length ?? 0
                : arcTab === "tool" ? data.tools.length : data.bands.length}
            </span>
          </div>
          {arcTab === "relic" && (
            <div className="rg-relic-grid">
              {relics.map((r) => (
                <article key={r.id} className="rg-relic">
                  <header>
                    {r.img && <img className="rg-relic-icon" src={`/rogue/relic/${r.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                    {r.order && <span className="rg-relic-no">{r.order}</span>}
                    <h4><Nm name={r.name} cn={r.cn} /></h4>
                  </header>
                  {r.usage && <p className="rg-relic-usage">{r.usage}</p>}
                  {r.desc && <p className="rg-relic-desc">{r.desc}</p>}
                  {r.obtain && <p className="rg-relic-obtain">{r.obtain}</p>}
                </article>
              ))}
            </div>
          )}
          {arcTab === "scrap" && (
            <div className="rg-scrap-view">
              {["GOODS", "MOVE", "PASSIVE"].map((st) => {
                const items = (data.scraps ?? []).filter((s) => s.type === st);
                if (items.length === 0) return null;
                return (
                  <div key={st} className="rg-scrap-group">
                    <h4 className="rg-scrap-type">{items[0].typeName}<em>{items.length}</em>
                      <span className="rg-scrap-hint">{st === "GOODS" ? t("팔면 오리지늄각뿔이 되는 자연물") : st === "MOVE" ? t("장착하면 지도 이동 능력을 주는 가공품") : t("특정 조건에서 발동하는 개념체")}</span>
                    </h4>
                    <div className="rg-relic-grid">
                      {items.map((s) => (
                        <article key={s.id} className="rg-relic">
                          <header>
                            {s.img && <img className="rg-relic-icon" src={`/rogue/relic/${s.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                            <h4><Nm name={s.name} cn={s.cn} /></h4>
                          </header>
                          {s.usage && <p className="rg-relic-usage">{s.usage}</p>}
                          {s.desc && <p className="rg-relic-desc">{s.desc}</p>}
                        </article>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {arcTab === "legacy" && (
            <div className="rg-relic-grid">
              {(data.legacies ?? []).map((c) => (
                <article key={c.id} className="rg-relic">
                  <header>
                    {c.img && <img className="rg-relic-icon" src={`/rogue/relic/${c.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                    <h4><Nm name={c.name} cn={c.cn} /></h4>
                  </header>
                  {c.usage && <p className="rg-relic-usage">{c.usage}</p>}
                  {c.desc && <p className="rg-relic-desc">{c.desc}</p>}
                </article>
              ))}
            </div>
          )}
          {arcTab === "capsule" && (
            <div className="rg-capsule-grid">
              {(data.capsules ?? []).map((c) => (
                <article key={c.id} className="rg-relic capsule">
                  {c.img && <img className="rg-cap-art" src={`/rogue/capsule/${c.id}.webp`} alt={c.name} loading="lazy" decoding="async" />}
                  <header><h4>{c.name}</h4>{c.en && <span className="rg-cap-en">{c.en}</span>}</header>
                  {c.usage && <p className="rg-relic-usage">{c.usage}</p>}
                  {c.desc && <p className="rg-relic-desc">{c.desc}</p>}
                </article>
              ))}
            </div>
          )}
          {arcTab === "tool" && (
            <div className="rg-relic-grid">
              {data.tools.map((c) => (
                <article key={c.id} className="rg-relic">
                  <header>
                    {c.img && <img className="rg-relic-icon" src={`/rogue/relic/${c.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                    <h4><Nm name={c.name} cn={c.cn} /></h4>
                  </header>
                  {c.usage && <p className="rg-relic-usage">{c.usage}</p>}
                  {c.desc && <p className="rg-relic-desc">{c.desc}</p>}
                </article>
              ))}
            </div>
          )}
          {arcTab === "explore" && (
            <div className="rg-relic-grid">
              {(data.exploreTools ?? []).map((c) => (
                <article key={c.id} className="rg-relic">
                  <header>
                    {c.img && <img className="rg-relic-icon" src={`/rogue/relic/${c.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                    <h4><Nm name={c.name} cn={c.cn} /></h4>
                  </header>
                  {c.usage && <p className="rg-relic-usage">{c.usage}</p>}
                  {c.desc && <p className="rg-relic-desc">{c.desc}</p>}
                </article>
              ))}
            </div>
          )}
          {arcTab === "band" && (
            <div className="rg-relic-grid">
              {data.bands.map((c) => (
                <article key={c.id} className="rg-relic">
                  <header>
                    {c.img && <img className="rg-relic-icon" src={`/rogue/relic/${c.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                    <h4><Nm name={c.name} cn={c.cn} /></h4>
                  </header>
                  {c.usage && <p className="rg-relic-usage">{c.usage}</p>}
                  {c.desc && <p className="rg-relic-desc">{c.desc}</p>}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "hallu" && (topic === "rogue_1" || topic === "rogue_2") && (
        <div className="rg-hallu">
          <p className="rg-zone-desc">{topic === "rogue_2"
            ? t("특정 구역에 '메아리'가 나타나 해당 구역 전체에 효과를 겁니다. 좋은 효과와 나쁜 효과가 함께 붙습니다.")
            : t("난이도 1 이상에서 구역에 환각이 나타납니다. 난이도 11 이상에서는 특정 조합이 융합 환각으로 발동합니다.")}</p>
          <div className="rg-relic-grid">
            {data.variations.map((v) => (
              <article key={v.id} className={`rg-relic${v.fusion ? " fusion" : ""}`}>
                <header>
                  <h4>{v.name}</h4>
                  {v.fusion && <span className="rg-fusion-tag">{t("융합")}</span>}
                </header>
                {v.func && <p className="rg-relic-usage">{v.func}</p>}
                {v.desc && <p className="rg-relic-desc">{v.desc}</p>}
              </article>
            ))}
          </div>
        </div>
      )}

      {view === "hallu" && topic === "rogue_6" && (
        <div className="rg-hallu">
          {/* 실토피아 — 기밀 등급 2+에서 격자 지도에 생성되는 이상역. 이념(주 효과) 10종 × 강도 3단계 */}
          <h3 className="rg-env-h">{t("실토피아 · 이념")} <span className="rg-cn" lang="zh">实托邦·理念</span></h3>
          <p className="rg-zone-desc">{t("기밀 등급 2 이상에서 '주민'의 사념이 실체화된 이상역(실토피아)이 격자 지도에 생성됩니다. '이상원' 노드를 파괴하면 제거되며, 영향권의 노드에 진입하면 아래 이념 효과가 발동합니다. 강도는 난이도에 따라 초기(a)/중기(b)/말기(c)로 강화됩니다.")}</p>
          <div className="rg-relic-grid">
            {(data.weathers ?? []).map((w) => (
              <article key={w.id} className="rg-relic">
                <header>
                  {w.img && <img className="rg-relic-icon" src={`/rogue/misc/${w.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                  <h4><Nm name={w.name} cn={w.cn} /></h4>
                </header>
                {w.levels.map((l) => (
                  <p key={l.lv} className="rg-relic-usage"><em className={`rg-wlv lv-${l.lv}`}>{l.lv === "a" ? t("초기") : l.lv === "b" ? t("중기") : t("말기")}</em> {l.desc}</p>
                ))}
              </article>
            ))}
          </div>

          <h3 className="rg-env-h">{t("실토피아 · 방침")} <span className="rg-cn" lang="zh">实托邦·方针</span></h3>
          <p className="rg-zone-desc">{t("기밀 등급 6 이상에서 이념에 더해지는 부가 효과입니다. 실토피아의 영향을 받는 노드를 지날 때 발동합니다.")}</p>
          <div className="rg-relic-grid">
            {(data.subweathers ?? []).map((w) => (
              <article key={w.id} className="rg-relic">
                <header>
                  {w.img && <img className="rg-relic-icon" src={`/rogue/misc/${w.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                  <h4><Nm name={w.name} cn={w.cn} /></h4>
                </header>
                {w.desc && <p className="rg-relic-usage">{w.desc}</p>}
              </article>
            ))}
          </div>

          <h3 className="rg-env-h">{t("유토피아 (흑담)")} <span className="rg-cn" lang="zh">乌托邦·黑潭</span></h3>
          <p className="rg-zone-desc">{t("기이한 공간 노드에서 가공품 1개를 소모하면 히든 구역 '흑담'에 진입합니다. 흑담에서는 아래 유토피아 규칙 중 하나가 맵 전체에 적용되며 제거할 수 없습니다 (대신 난이도 적 강화가 적용되지 않습니다).")}</p>
          <div className="rg-relic-grid">
            {data.variations.map((v) => (
              <article key={v.id} className="rg-relic">
                <header>
                  {v.img && <img className="rg-relic-icon" src={`/rogue/misc/rogue_6_${v.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                  <h4><Nm name={v.name} cn={v.cn} /></h4>
                </header>
                {v.func && <p className="rg-relic-usage">{v.func}</p>}
                {v.desc && <p className="rg-relic-desc">{v.desc}</p>}
              </article>
            ))}
          </div>
        </div>
      )}

      {view === "diff" && (
        <div className="rg-diff-view">
          <p className="rg-zone-desc">{t("난이도는 하위 등급의 규칙을 전부 포함합니다. 현재 선택한 난이도까지의 규칙이 강조됩니다.")}</p>
          <table className="rg-diff-table">
            <thead><tr><th>{t("등급")}</th><th>{t("추가 규칙")}</th></tr></thead>
            <tbody>
              {data.difficulties.filter((d) => d.mode === "EASY" || d.mode === "NORMAL").map((d) => {
                const on = d.mode === "EASY" ? grade < 0 : grade >= d.grade;
                return (
                  <tr key={`${d.mode}${d.grade}`} className={on ? "on" : ""} role="button" tabIndex={0}
                    title={t("이 난이도로 설정")}
                    onClick={() => setGrade(d.mode === "EASY" ? -1 : d.grade)}
                    onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setGrade(d.mode === "EASY" ? -1 : d.grade); } }}>
                    <td>{d.mode === "EASY" ? t("쉬움") : d.grade}</td>
                    <td>{d.rule}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === "ending" && (
        <div className="rg-endings">
          {data.endings.map((e) => (
            <article key={e.id} className="rg-ending">
              <header><h3><Nm name={e.name} cn={e.cn} /></h3></header>
              {e.desc && <p className="rg-ending-desc">{e.desc}</p>}
              {e.cond && e.cond.length > 0 && (
                <ol className="rg-ending-cond">
                  {e.cond.map((c, i) => <li key={i}>{renderCond(c)}</li>)}
                </ol>
              )}
              {e.change && <p className="rg-ending-change">“{e.change}”</p>}
            </article>
          ))}
        </div>
      )}

      {zoneOpen && (
        <ZoneModal zone={zoneOpen}
          pairs={zoneOpen.variant ? [] : pairsByZone.get(zoneOpen.num) ?? []}
          bosses={zoneOpen.variant ? [] : bossStages.filter((s) => s.zone === zoneOpen.num)}
          onOpenStage={setStageOpen} onClose={() => setZoneOpen(null)} />
      )}
      {stageOpen && (
        <StageModal key={stageOpen.n.id} pair={stageOpen} grade={grade} onClose={() => setStageOpen(null)}
          onOpenEnemy={(key, ctx) => setEnemyOpen({ key, ctx })} />
      )}
      {enemyOpen && (
        <EnemyModal ekey={enemyOpen.key} grade={grade} ctx={enemyOpen.ctx} onClose={() => setEnemyOpen(null)}
          appear={enemyStages.get(enemyOpen.key) ?? []}
          onOpenStage={(s) => { setEnemyOpen(null); setStageOpen(pairOf(s)); }} />
      )}
      {encOpen && <EncounterModal enc={encOpen} onClose={() => setEncOpen(null)} />}
      {relicOpen && <RelicModal relic={relicOpen} onClose={() => setRelicOpen(null)} />}
      </>)}
    </section>
  );
}

const RANK_SORT: Record<string, number> = { BOSS: 0, ELITE: 1, NORMAL: 2 };
