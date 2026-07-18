"use client";

// 통합전략 탭 — 토픽: 팬텀 & 크림슨 솔리테어(rogue_1) + 침몰자의 흑류수해(rogue_6, CN 선행·미래시).
// 데이터는 scripts/build-rogue.py가 생성하는 app/data/rogue1.json / rogue6.json (클뜯 레포 원본).
// rogue_6은 CN 데이터를 한국어화(rogue6-ko.json)한 것으로, 이름류는 중국어 원문(cn)을 병기한다.
// 조우의 층별 출현 규칙·엔딩 선제조건은 클라 데이터에 없어 PRTS 기반 큐레이션(rogueN-curated.json)을 병합한다.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  zones: Zone[]; nodeTypes: { id: string; name: string; desc: string | null; func?: string | null; cn?: string }[];
  difficulties: Difficulty[]; stages: Stage[]; enemies: Record<string, Enemy>;
  relics: Relic[]; capsules?: Capsule[]; tools: Simple[]; bands: Simple[]; exploreTools?: Simple[];
  scraps?: Scrap[]; legacies?: Simple[]; buoys?: Simple[];
  weathers?: Weather[]; subweathers?: SubWeather[];
  variations: Variation[]; endings: Ending[]; encounters: Encounter[];
  // 토픽 고유 시스템 갤러리 (거부반응·암호판·붕괴 패러다임·사고·시대·주화·분노 등) — 전시관 서브탭.
  // kind=하위 분류(사고: 염원/영감/구상), usage의 개행은 단계 효과(심화·형성기 등) 줄바꿈.
  mechanics?: { label: string; items: { id: string; name: string; kind?: string; usage?: string | null; desc?: string | null; img?: boolean }[] }[];
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

// 모든 록라 공통 6탭. 테마별 고유 시스템(환각/메아리/환경·거부반응·암호판·붕괴·파편·주화 등)은
// 전부 전시관(archive) 안 서브탭으로 들어간다 (사용자 확정 2026-07-18).
type View = "map" | "enemy" | "relic" | "archive" | "diff" | "ending";
// 환각 계열 서브탭의 토픽별 라벨 (전시관 안에서 사용)
const HALLU_LABEL: Record<string, string> = { rogue_1: "환각", rogue_2: "메아리", rogue_6: "환경" };
const viewsFor = (): { id: View; label: string }[] => [
  { id: "map", label: "맵·노드" },
  { id: "enemy", label: "적 도감" },
  { id: "relic", label: "소장품" },
  { id: "archive", label: "전시관" },
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
  const [mapZoom, setMapZoom] = useState(false); // 미리보기 클릭 → 2배 확대, 축소는 아무 곳이나 클릭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (!mapZoom) return;
    // 캡처 단계에서 가로채 모달 닫힘·적 상세 열림 등 다른 클릭 동작을 막고 축소만 한다
    const onAnyClick = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); setMapZoom(false); };
    document.addEventListener("click", onAnyClick, true);
    return () => document.removeEventListener("click", onAnyClick, true);
  }, [mapZoom]);
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
                title={mapZoom ? t("아무 곳이나 클릭하면 원래 크기로 돌아갑니다") : t("클릭하면 2배로 확대됩니다")}>
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
          {/* 리더 → 정예 → 일반 → 공통 특수몹 순으로 정렬 (사용자 확정 2026-07-18).
              전 테마 공통 특수몹은 데이터에 판별 플래그가 없어 이름 하드코딩 */}
          {[...stage.enemies].sort((a, b) => {
            const rankOrder = (k: string) => isSpecialLast(k)
              ? 3 : ({ BOSS: 0, ELITE: 1 }[data.enemies[k]?.rank ?? ""] ?? 2);
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

// 전 테마 공통으로 등장하는 특수(길가) 몹 — 전투 노드 적 목록에서 맨 밑으로 (사용자 확정 2026-07-18).
// ⚠ 이름이 아니라 적 id(변종 _N 제거한 베이스)로 판별 — EN/JA 데이터에선 이름이 현지어라 이름 매칭이 깨진다
// (고프닉·덕로드·동글이·눈물 흘리는 사내·상자 넝쿨·'게이트'·'창문'·시대의 흔적·진기한 장치·탐사용 자율차)
const SPECIAL_LAST_IDS = new Set(["enemy_2002_bearmi", "enemy_2001_duckmi", "enemy_2085_skzjxd", "enemy_2034_sythef",
  "enemy_2059_smbox", "enemy_2067_skzcy", "enemy_2091_skzgds", "enemy_2086_skzdwx", "enemy_2069_skzbox", "enemy_2062_smcar"]);
const isSpecialLast = (key: string) => SPECIAL_LAST_IDS.has(key.replace(/_\d+$/, ""));

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
            <span className={`rg-rank r-${e.rank ?? "NORMAL"}`}>{t(RANK_KO[e.rank ?? ""] ?? "일반")}</span>
            <h3><Nm name={e.name} cn={e.cn} /></h3>
            {e.index && <span className="rg-modal-zone">{e.index}</span>}
          </div>
          <button type="button" className="rg-modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        </header>
        {/* 초상은 원본 해상도(158px) 그대로 크게 — 작은 헤더 아이콘 대신 (피드백 반영 2026-07-18) */}
        <div className="rg-emodal-cols">
          {e.img ? <img className="rg-emodal-portrait" src={`/rogue/enemy/${e.img}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />
            : <span className="rg-emodal-portrait none" aria-hidden>?</span>}
          <div className="rg-emodal-main">
            {e.attack && <p className="rg-emodal-row"><strong>{t("공격 방식")}</strong> {e.attack}</p>}
            {e.desc && <p className="rg-emodal-desc">{e.desc}</p>}
            {e.ability && <p className="rg-emodal-ability">{e.ability}</p>}
            {e.immune && e.immune.length > 0 && (
              <p className="rg-emodal-immune"><strong>{t("상태이상 면역")}</strong>
                {e.immune.map((im) => <span key={im} className="rg-immune-chip">{t(im)}</span>)}
              </p>
            )}
          </div>
        </div>
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
// 햄버거 메뉴가 '통합전략 가이드' 부메뉴로도 쓰므로 export (home.tsx)
export const TOPICS: { id: string; name: string; ready?: boolean; future?: boolean }[] = [
  { id: "rogue_1", name: "팬텀 & 크림슨 솔리테어", ready: true },
  { id: "rogue_2", name: "미즈키 & 카이룰라 아버", ready: true },
  { id: "rogue_3", name: "탐험가의 은빛 서리 끝자락", ready: true },
  { id: "rogue_4", name: "살카즈의 영겁 기담", ready: true },
  { id: "rogue_5", name: "쉐이의 기이한 계원", ready: true },
  { id: "rogue_6", name: "침몰자의 흑류수해", ready: true, future: true },
];

// 토픽 데이터 동적 로더 — KR은 rogue_1만 기본 번들, 나머지는 선택 시 로드 (각 300~600KB).
// EN/JA는 글로벌/일본 서버 공식 텍스트로 빌드한 rogueN.<loc>.json (build-rogue.py i18n).
// rogue_6은 CN 선행이라 공식 현지화가 없어 전 로케일이 KR/CN 병기 파일을 공유한다.
const TOPIC_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  rogue_2: () => import("./data/rogue2.json"),
  rogue_3: () => import("./data/rogue3.json"),
  rogue_4: () => import("./data/rogue4.json"),
  rogue_5: () => import("./data/rogue5.json"),
  rogue_6: () => import("./data/rogue6.json"),
};
const TOPIC_LOADERS_EN: Record<string, () => Promise<{ default: unknown }>> = {
  rogue_1: () => import("./data/rogue1.en.json"),
  rogue_2: () => import("./data/rogue2.en.json"),
  rogue_3: () => import("./data/rogue3.en.json"),
  rogue_4: () => import("./data/rogue4.en.json"),
  rogue_5: () => import("./data/rogue5.en.json"),
  rogue_6: () => import("./data/rogue6.json"),
};
const TOPIC_LOADERS_JA: Record<string, () => Promise<{ default: unknown }>> = {
  rogue_1: () => import("./data/rogue1.ja.json"),
  rogue_2: () => import("./data/rogue2.ja.json"),
  rogue_3: () => import("./data/rogue3.ja.json"),
  rogue_4: () => import("./data/rogue4.ja.json"),
  rogue_5: () => import("./data/rogue5.ja.json"),
  rogue_6: () => import("./data/rogue6.json"),
};
const loadersFor = (locale: string) =>
  locale === "en" ? TOPIC_LOADERS_EN : locale === "ja" ? TOPIC_LOADERS_JA : TOPIC_LOADERS;

// 토픽 URL 슬러그 — /rogue?topic=is6 (rogue_1은 파라미터 없음)
// 테마별 상징색 — 드롭다운 색점 (각 스킨(.rgN)의 강조색과 동일 계열)
const TOPIC_HUE: Record<string, string> = {
  rogue_1: "#c23b4e", rogue_2: "#4a9edd", rogue_3: "#b7c2d1",
  rogue_4: "#8e222f", rogue_5: "#efa5c1", rogue_6: "#2fbfa5",
};

export const slugOf = (id: string) => "is" + id.split("_")[1];
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
  // 마운트 게이트 — 정적 프리렌더 HTML(항상 rogue_1)과 클라 첫 렌더가 어긋나면
  // 하이드레이션 미스매치가 난다. 마운트 전엔 토픽 무관 로딩 셸만 렌더해 양쪽을
  // 일치시키고, 마운트 후 곧바로 올바른 토픽을 그린다 (팬텀→사미 깜빡임도 방지).
  // useSyncExternalStore: 서버/하이드레이션 스냅샷=false, 마운트 후 클라 스냅샷=true
  // (effect 내 setState 없이 하이드레이션 안전하게 클라 마운트를 감지).
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  // KR rogue_1만 기본 번들 — 그 외(다른 토픽·EN/JA 로케일)는 선택 시 동적 로드.
  // 캐시 키는 토픽:로케일 (언어 전환 시 같은 토픽의 현지어 데이터를 다시 불러온다)
  const dataKey = `${topic}:${locale}`;
  useEffect(() => {
    const key = `${topic}:${locale}`;
    const loader = loadersFor(locale)[topic];
    if (!(topic === "rogue_1" && locale === "ko") && !loaded[key] && loader) {
      loader().then((m) =>
        setLoaded((cur) => ({ ...cur, [key]: m.default as RogueData })));
    }
  }, [topic, locale, loaded]);
  const active = topic === "rogue_1" && locale === "ko" ? rogue1 : loaded[dataKey] ?? null;
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
  // 테마 변경 커스텀 드롭다운 — 바깥 클릭·Esc로 닫기
  const [topicMenu, setTopicMenu] = useState(false);
  const topicSelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!topicMenu) return;
    const onDown = (e: MouseEvent) => { if (!topicSelRef.current?.contains(e.target as Node)) setTopicMenu(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setTopicMenu(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onEsc); };
  }, [topicMenu]);
  const [zoneOpen, setZoneOpen] = useState<Zone | null>(null);
  const [stageOpen, setStageOpen] = useState<StagePair | null>(null);
  const [enemyOpen, setEnemyOpen] = useState<{ key: string; ctx: StatCtx } | null>(null);
  const [encOpen, setEncOpen] = useState<Encounter | null>(null);
  const [relicOpen, setRelicOpen] = useState<Relic | null>(null);
  const [enemyQ, setEnemyQ] = useState("");
  const [enemyRank, setEnemyRank] = useState<string>("");
  const [relicQ, setRelicQ] = useState("");
  const [mapQ, setMapQ] = useState(""); // 맵·노드 이름 검색 (작전·조우 전투·우연한 만남 전부)
  // 표준 카테고리 + 토픽 고유 시스템(mechanics)의 라벨을 탭 id로 쓰므로 string
  const [arcTab, setArcTab] = useState<string>("relic");
  const VIEWS = viewsFor();
  // 전시관 서브탭 [id, 라벨] 목록 — 환각계열 + 토픽 고유 시스템 전부 + 표준(도구·분대 등).
  // 소장품(유물)은 최상위 탭으로 승격돼 여기서 제외. arcTab이 무효면 첫 탭으로 폴백.
  const hasVariations = (data.variations?.length ?? 0) > 0 || (data.weathers?.length ?? 0) > 0;
  const archiveTabs: [string, string][] = topic === "rogue_6"
    ? [...(hasVariations ? [["hallu", HALLU_LABEL[topic]] as [string, string]] : []),
       ["scrap", "부품 (零件)"], ["tool", "도구"], ["band", "분대"], ["legacy", "유산"],
       // 부표는 노드가 아니라 격자 지도 위 이벤트 마커 — 전시관으로 이동 (사용자 확정 2026-07-18)
       ...((data.buoys?.length ?? 0) > 0 ? [["buoy", "지도 마커 (부표)"] as [string, string]] : [])]
    : [...(hasVariations && HALLU_LABEL[topic] ? [["hallu", HALLU_LABEL[topic]] as [string, string]] : []),
       ...((data.capsules?.length ?? 0) > 0 ? [["capsule", "레퍼토리 (음반)"] as [string, string]] : []),
       ...(data.mechanics ?? []).map((m) => [m.label, m.label] as [string, string]),
       ["tool", "무대 도구"],
       ...((data.exploreTools?.length ?? 0) > 0 ? [["explore", "탐사 도구"] as [string, string]] : []),
       ["band", "분대"]];
  const activeArc = archiveTabs.some(([id]) => id === arcTab) ? arcTab : (archiveTabs[0]?.[0] ?? "tool");

  // 뒤로/앞으로·햄버거 부메뉴(popstate) → 토픽 동기화. 토픽 전환은 이제 헤더 버튼이 아니라
  // 햄버거 '통합전략 가이드' 부메뉴가 URL(?topic=isN)을 바꿔 트리거한다. 토픽이 실제로
  // 바뀌면 뷰·난이도·검색·모달을 초기화한다(옛 switchTopic이 하던 리셋).
  const topicRef = useRef(topic);
  // 토픽 전환 + 뷰/난이도/검색/모달 리셋 (옛 switchTopic이 하던 일). 같은 토픽이면 무시.
  const applyTopic = (next: string) => {
    if (topicRef.current === next) return;
    topicRef.current = next;
    setTopic(next);
    setView("map");
    setGrade(0);
    setZoneOpen(null); setStageOpen(null); setEnemyOpen(null); setEncOpen(null); setRelicOpen(null);
    setEnemyQ(""); setEnemyRank(""); setRelicQ(""); setMapQ(""); setArcTab("relic");
  };
  const applyTopicFromUrl = () => applyTopic(topicFromUrl());
  useEffect(() => {
    // popstate=브라우저 뒤로/앞으로, ta:rogue-topic=햄버거 부메뉴에서 온 커스텀 이벤트.
    // ⚠ 예전엔 부메뉴/드롭다운이 합성 popstate를 쐈는데, vinext 라우터가 그걸 내비게이션으로
    // 보고 rogue RSC를 재요청했다 → 커스텀 이벤트로 바꿔 프레임워크가 무시하게 한다.
    const onNav = () => applyTopicFromUrl();
    window.addEventListener("popstate", onNav);
    window.addEventListener("ta:rogue-topic", onNav);
    return () => { window.removeEventListener("popstate", onNav); window.removeEventListener("ta:rogue-topic", onNav); };
  }, []);

  // 헤더 테마 드롭다운 — URL(?topic=isN)만 바꾸고 직접 토픽 전환(합성 popstate 안 씀).
  const goTopic = (id: string) => {
    if (id === topic) return;
    const url = new URL(window.location.href);
    url.searchParams.set("topic", slugOf(id));
    history.pushState(null, "", url.pathname + url.search + url.hash);
    applyTopic(id);
  };

  // 해시 딥링크: #rg-<view>
  useEffect(() => {
    const fromHash = () => {
      const m = window.location.hash.match(/^#rg-(\w+)/);
      if (m && viewsFor().some((v) => v.id === m[1])) setView(m[1] as View);
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
  // 기타 노드 — 전투(작전·긴급·험난한 길)와 우연한 만남을 제외한 노드 타입 설명.
  // 같은 이름의 중복 타입(운명의 암시 등)은 하나만 남긴다 (사용자 요청 2026-07-18)
  const otherNodes = useMemo(() => {
    const skip = new Set(["BATTLE_NORMAL", "BATTLE_ELITE", "BATTLE_BOSS", "INCIDENT"]);
    const seen = new Set<string>();
    return data.nodeTypes.filter((nt) => {
      if (skip.has(nt.id) || seen.has(nt.name)) return false;
      seen.add(nt.name);
      return true;
    });
  }, [active]);

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

  // 맵 탭 이름 검색 — 전투 노드(작전·긴급·보스·조우 전투·특수·시련·추격전·거점전·외나무다리)
  // + 우연한 만남(조우)을 전부 이름/중국어 원문으로 매칭
  const mapHits = useMemo(() => {
    const q = normSearch(mapQ);
    if (!q) return null;
    const nm = (name: string, cn?: string) => normSearch(name).includes(q) || (cn ? normSearch(cn).includes(q) : false);
    const stages = data.stages.filter((s) => s.kind !== "emergency" && nm(s.name, s.cn));
    const encs = data.encounters.filter((e) => nm(e.title, e.cn));
    return { stages, encs };
  }, [mapQ, active]); // eslint-disable-line react-hooks/exhaustive-deps


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

  // 마운트 전(=SSR 프리렌더 + 클라 첫 렌더)엔 토픽 무관 로딩 셸만 — 하이드레이션 일치용
  if (!mounted) {
    return (
      <section className="rg" aria-labelledby="rg-title">
        <p className="rg-loading">{t("데이터를 불러오는 중...")}</p>
      </section>
    );
  }

  return (
    <section className={`rg${topic === "rogue_1" ? "" : " rg" + topic.split("_")[1]}`} aria-labelledby="rg-title">
      <header className="rg-head">
        <div className="rg-hero">
          <img className="rg-hero-kv" src={`/rogue/kv${topic.split("_")[1]}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />
          <div className="rg-hero-text">
            <span className="rg-eyebrow">INTEGRATED STRATEGIES</span>
            {/* 제목은 현재 테마 이름 — 테마 전환은 햄버거 '통합전략 가이드' 부메뉴/드롭다운 (사용자 확정 2026-07-18) */}
            <h2 id="rg-title">{t(TOPICS.find((tp) => tp.id === topic)?.name ?? "통합전략 가이드")}{TOPICS.find((tp) => tp.id === topic)?.future && <em className="rg-title-future">{t("미래시")}</em>}</h2>
            {topic === "rogue_6" && (
              <p className="rg-disclaimer">
                {data.cnName && <span className="rg-cn" lang="zh">{data.cnName}</span>}{" "}
                {t("CN 선행 데이터 기반 · 명칭은 비공식 번역이며 중국어 원문을 병기합니다.")}
              </p>
            )}
            {locale !== "ko" && topic === "rogue_6" && <p className="rg-disclaimer">{t("이 테마는 CN 선행 데이터라 아직 한국어·중국어로만 제공됩니다.")}</p>}
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

        {/* 테마 변경 드롭다운 — 배너 오른쪽 위. 네이티브 select 대신 테마 톤에 맞춘 커스텀
            리스트박스 (사용자 요청 2026-07-19). ⚠ .rg-hero 안에 두면 overflow:hidden에
            펼친 메뉴가 잘린다 — 반드시 .rg-head 직속(클리핑 밖)에 두고 absolute로 겹칠 것 */}
        <div className="rg-topicsel" ref={topicSelRef}>
          <button type="button" className="rg-topicsel-btn" aria-haspopup="listbox" aria-expanded={topicMenu}
            onClick={() => setTopicMenu((v) => !v)}>
            <span className="rg-topicsel-label">{t("테마 변경")}</span>
            <span className="rg-topicsel-cur">
              <i className="rg-topicsel-dot" style={{ background: TOPIC_HUE[topic], boxShadow: `0 0 8px ${TOPIC_HUE[topic]}` }} aria-hidden />
              {t(TOPICS.find((tp) => tp.id === topic)?.name ?? "통합전략 가이드")}
            </span>
            <span className={`rg-topicsel-arrow${topicMenu ? " up" : ""}`} aria-hidden>▾</span>
          </button>
          {topicMenu && (
            <ul className="rg-topicsel-menu" role="listbox" aria-label={t("테마 변경")}>
              {TOPICS.filter((tp) => tp.ready && (!tp.future || includeFuture)).map((tp) => (
                <li key={tp.id} role="option" aria-selected={tp.id === topic}>
                  <button type="button" className={tp.id === topic ? "on" : ""}
                    onClick={() => { setTopicMenu(false); goTopic(tp.id); }}>
                    <i className="rg-topicsel-dot" style={{ background: TOPIC_HUE[tp.id], boxShadow: `0 0 8px ${TOPIC_HUE[tp.id]}` }} aria-hidden />
                    <span className="rg-topicsel-name">{t(tp.name)}</span>
                    {tp.future && <em className="rg-topicsel-future">{t("미래시")}</em>}
                  </button>
                </li>
              ))}
            </ul>
          )}
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
          {/* 노드 이름 검색 — 작전·보스·조우 전투·특수·우연한 만남 전부 (사용자 요청 2026-07-18) */}
          <div className="rg-filterbar rg-map-search">
            <input type="search" value={mapQ} onChange={(e) => setMapQ(e.target.value)}
              placeholder={t("노드 이름 검색 (작전·조우·우연한 만남)")} aria-label={t("노드 이름 검색 (작전·조우·우연한 만남)")} />
            {mapHits && <span className="rg-count">{mapHits.stages.length + mapHits.encs.length}</span>}
          </div>

          {mapHits && (<>
            {mapHits.stages.length === 0 && mapHits.encs.length === 0 && (
              <p className="rg-zone-desc">{t("검색 결과가 없습니다.")}</p>
            )}
            {mapHits.stages.length > 0 && (
              <div className="rg-stage-group rg-map-hits">
                <h4>{t("전투 노드")} <em>{mapHits.stages.length}</em></h4>
                <div className="rg-stage-cards">
                  {mapHits.stages.map((s) => (
                    <StageCard key={s.id} pair={pairOf(s)} onOpen={setStageOpen} boss={s.kind === "boss"} />
                  ))}
                </div>
              </div>
            )}
            {mapHits.encs.length > 0 && (
              <div className="rg-stage-group rg-map-hits">
                <h4>{t("우연한 만남")} <em>{mapHits.encs.length}</em></h4>
                <div className="rg-enc-list">
                  {mapHits.encs.map((enc) => (
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
            )}
          </>)}

          {!mapHits && (<>
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

          {/* 기타 노드 — 전투·우연한 만남 외 노드 타입 설명. 외나무다리 상세에 결투 전투 포함 (사용자 요청 2026-07-18) */}
          {otherNodes.length > 0 && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("기타 노드")}</h3>
              <span className="rg-zone-counts">{otherNodes.length}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("지도에서 마주치는 전투 외 특수 노드들입니다.")}</p>
              <div className="rg-nodetype-list">
                {otherNodes.map((nt) => (
                  <article key={nt.id} className={`rg-nodetype${nt.id === "DUEL" && duelStages.length > 0 ? " wide" : ""}`}>
                    <h4><Nm name={nt.name} cn={nt.cn} /></h4>
                    {nt.func && <p className="rg-nodetype-func">{nt.func}</p>}
                    {nt.desc && <p>{nt.desc}</p>}
                    {nt.id === "DUEL" && duelStages.length > 0 && (
                      <>
                        <div className="rg-stage-cards">
                          {duelStages.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} />)}
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
            </div>
          </details>
          )}

          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("우연한 만남")}</h3>
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
          </>)}
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
          {/* 도감은 사진 왼쪽·정보 오른쪽 가로형 카드 (피드백 반영 2026-07-18) */}
          <div className="rg-enemy-grid">
            {enemies.map(([key, e]) => (
              <button type="button" key={key} className="rg-enemy-cell row" id={`rg-en-${key}`}
                onClick={() => setEnemyOpen({ key, ctx: dexCtx(key) })}>
                {e.img ? <img className="rg-enemy-face" src={`/rogue/enemy/${e.img}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />
                  : <span className="rg-enemy-face none" aria-hidden>?</span>}
                <span className="rg-enemy-cell-info">
                  <span className="rg-enemy-cell-head">
                    <span className={`rg-rank r-${e.rank ?? "NORMAL"}`}>{t(RANK_KO[e.rank ?? ""] ?? "일반")}</span>
                  </span>
                  <span className="rg-enemy-name"><Nm name={e.name} cn={e.cn} /></span>
                  <StatRow e={e} grade={grade} ctx={dexCtx(key)} />
                </span>
                {e.index && <span className="rg-enemy-idx">{e.index}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 소장품(유물) — 전시관에서 최상위 탭으로 승격 (사용자 요청 2026-07-18) */}
      {view === "relic" && (
        <div className="rg-archive">
          <div className="rg-filterbar">
            <input type="search" value={relicQ} onChange={(e) => setRelicQ(e.target.value)}
              placeholder={t("유물 검색")} aria-label={t("유물 검색")} />
            <span className="rg-count">{relics.length}</span>
          </div>
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
              </article>
            ))}
          </div>
        </div>
      )}

      {view === "archive" && (
        <div className="rg-archive">
          <div className="rg-filterbar">
            {archiveTabs.map(([id, label]) => (
              <button key={id} type="button" className={activeArc === id ? "on" : ""} onClick={() => setArcTab(id)}>{t(label)}</button>
            ))}
            <span className="rg-count">
              {activeArc === "hallu" ? (data.variations?.length ?? data.weathers?.length ?? 0)
                : activeArc === "capsule" ? data.capsules?.length ?? 0
                : activeArc === "scrap" ? data.scraps?.length ?? 0
                : activeArc === "legacy" ? data.legacies?.length ?? 0
                : activeArc === "buoy" ? data.buoys?.length ?? 0
                : activeArc === "explore" ? data.exploreTools?.length ?? 0
                : activeArc === "tool" ? data.tools.length
                : activeArc === "band" ? data.bands.length
                : (data.mechanics ?? []).find((m) => m.label === activeArc)?.items.length ?? 0}
            </span>
          </div>
          {activeArc === "scrap" && (
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
          {activeArc === "legacy" && (
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
          {/* 부표 — 노드가 아니라 격자 지도 위 이벤트 마커라 전시관에 배치 (사용자 확정 2026-07-18) */}
          {activeArc === "buoy" && (
            <div className="rg-relic-grid">
              {(data.buoys ?? []).map((b) => (
                <article key={b.id} className="rg-relic">
                  <header>
                    {b.img && <img className="rg-relic-icon" src={`/rogue/misc/${b.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                    <h4><Nm name={b.name} cn={b.cn} /></h4>
                  </header>
                  {b.usage && <p className="rg-relic-desc">{b.usage}</p>}
                </article>
              ))}
            </div>
          )}
          {activeArc === "capsule" && (
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
          {activeArc === "tool" && (
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
          {activeArc === "explore" && (
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
          {activeArc === "band" && (
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
          {/* 토픽 고유 시스템 갤러리 (거부반응·암호판·붕괴 패러다임·사고·시대·주화·분노 등).
              kind가 있으면(사고: 염원/영감/구상) 분류별 섹션으로 나눠 렌더 (부품 뷰와 동일 패턴) */}
          {(data.mechanics ?? []).map((m) => {
            if (m.label !== activeArc) return null;
            const kinds = [...new Set(m.items.map((c) => c.kind).filter(Boolean))] as string[];
            const groups: { kind?: string; items: typeof m.items }[] = kinds.length > 0
              ? kinds.map((k) => ({ kind: k, items: m.items.filter((c) => c.kind === k) }))
              : [{ items: m.items }];
            return groups.map((g) => (
              <div key={`${m.label}-${g.kind ?? "all"}`} className={g.kind ? "rg-scrap-group" : undefined}>
                {g.kind && <h4 className="rg-scrap-type">{t(g.kind)}<em>{g.items.length}</em></h4>}
                <div className="rg-relic-grid">
                  {g.items.map((c) => (
                    <article key={c.id} className="rg-relic">
                      <header>
                        {c.img && <img className="rg-relic-icon" src={`/rogue/relic/${c.id}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                        <h4>{c.name}</h4>
                      </header>
                      {c.usage && <p className="rg-relic-usage rg-multiline">{c.usage}</p>}
                      {c.desc && <p className="rg-relic-desc">{c.desc}</p>}
                    </article>
                  ))}
                </div>
              </div>
            ));
          })}
          {/* 환각/메아리 (IS1/IS2) — 전시관 서브탭으로 편입 */}
          {activeArc === "hallu" && (topic === "rogue_1" || topic === "rogue_2") && (
            <div className="rg-hallu-inner">
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

          {/* 환경(실토피아/유토피아, IS6) — 전시관 서브탭으로 편입 */}
          {activeArc === "hallu" && topic === "rogue_6" && (
        <div className="rg-hallu-inner">
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
