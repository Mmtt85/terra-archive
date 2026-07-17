"use client";

// 통합전략 탭 — 첫 토픽: 팬텀 & 크림슨 솔리테어 (rogue_1).
// 데이터는 scripts/build-rogue.py가 생성하는 app/data/rogue1.json (클뜯 레포 원본).
// 층별 노드·적 도감(전투노드 매핑)·전시관(유물/레퍼토리)·환각·난이도 0~15 스탯 적용·엔딩 조건.
// 조우의 층별 출현 규칙·엔딩 선제조건은 클라 데이터에 없어 PRTS 기반 큐레이션(rogue1-curated.json)을 병합한다.
import { useEffect, useMemo, useState } from "react";
import rogueData from "./data/rogue1.json";
import { useI18n } from "./i18n";
import { normSearch } from "./search";

type Zone = { id: string; num: number; name: string; time: string | null; desc: string; buff: string | null; hidden: boolean; img?: boolean };
type StageEnemy = { key: string; cnt: number };
type Emg = { mul?: Record<string, number>; add?: Record<string, number> } | null;
type Stage = { id: string; kind: string; zone: number | null; code: string | null; name: string; desc: string | null; eliteDesc: string | null; emg: Emg; map?: string | null; enemies: StageEnemy[] };
type Enemy = { name: string; rank: string | null; index: string | null; attack: string | null; desc: string | null; ability: string | null; hp: number; atk: number; def: number; res: number; aspd: number; ms: number; weight: number; lifePoint: number; img?: string | null };
type Relic = { id: string; name: string; desc: string | null; usage: string | null; obtain: string | null; order: string | null; group: number | null; sort: number; sp: boolean };
type Capsule = { id: string; name: string; en: string | null; desc: string | null; usage: string | null; img?: boolean };
type Simple = { id: string; name: string; desc: string | null; usage: string | null };
type Variation = { id: string; name: string; func: string | null; desc: string | null; fusion: boolean };
type Difficulty = { mode: string; grade: number; name: string; rule: string | null; score: number | null };
type Ending = { id: string; name: string; desc: string | null; boss: string | null; priority: number; change: string | null; cond?: string[] };
type Encounter = { scene: string; title: string; desc: string | null; bg?: string | null; choices: { title: string; desc: string | null }[]; floors?: number[]; note?: string };
type RogueData = {
  id: string; name: string; line: string | null;
  zones: Zone[]; nodeTypes: { id: string; name: string; desc: string | null }[];
  difficulties: Difficulty[]; stages: Stage[]; enemies: Record<string, Enemy>;
  relics: Relic[]; capsules: Capsule[]; tools: Simple[]; bands: Simple[];
  variations: Variation[]; endings: Ending[]; encounters: Encounter[];
};

const data = rogueData as unknown as RogueData;

type View = "map" | "enemy" | "archive" | "hallu" | "diff" | "ending";
const VIEWS: { id: View; label: string }[] = [
  { id: "map", label: "맵·노드" },
  { id: "enemy", label: "적 도감" },
  { id: "archive", label: "전시관" },
  { id: "hallu", label: "환각" },
  { id: "diff", label: "난이도" },
  { id: "ending", label: "엔딩" },
];

const RANK_KO: Record<string, string> = { NORMAL: "일반", ELITE: "정예", BOSS: "리더" };

// ── 난이도 스탯 적용 ────────────────────────────────────────────────────────
// 수치 규칙 (difficulties.ruleDesc 근거):
//   g5+  : 모든 정예·리더 적 HP ×1.2
//   g10+ : 긴급 작전·험난한 길에서 적 공격력·HP ×1.15
//   g14+ : 정예·리더 등장 후 20초 공격력 ×1.3 / 받는 대미지 -50% (한시 효과 — 별도 표기)
// 긴급 작전 자체 배율은 레벨 룬(emg — 스테이지마다 다름)으로 별도 적용.
type StatCtx = { emergencyOrBoss?: boolean; emg?: Emg };
function applyDiff(e: Enemy, grade: number, ctx: StatCtx) {
  let hp = e.hp, atk = e.atk, def = e.def;
  const res = e.res;
  if (ctx.emg) {
    const m = ctx.emg.mul ?? {};
    if (m.max_hp) hp *= m.max_hp;
    if (m.atk) atk *= m.atk;
    if (m.def) def *= m.def;
    const a = ctx.emg.add ?? {};
    if (a.max_hp) hp += a.max_hp;
    if (a.atk) atk += a.atk;
    if (a.def) def += a.def;
  }
  const elite = e.rank === "ELITE" || e.rank === "BOSS";
  if (grade >= 5 && elite) hp *= 1.2;
  if (grade >= 10 && ctx.emergencyOrBoss) { hp *= 1.15; atk *= 1.15; }
  return { hp: Math.round(hp), atk: Math.round(atk), def: Math.round(def), res, burst14: grade >= 14 && elite };
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
    </div>
  );
}

// ── 스테이지 상세 모달 ──────────────────────────────────────────────────────
function StageModal({ stage, grade, onClose, onOpenEnemy }: {
  stage: Stage; grade: number; onClose: () => void; onOpenEnemy: (key: string) => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
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
            <h3>{stage.name}</h3>
            {stage.zone != null && <span className="rg-modal-zone">{t("{n}층", { n: stage.zone })}</span>}
          </div>
          <button type="button" className="rg-modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        </header>
        {stage.map && <img className="rg-modal-map" src={`/rogue/map/${stage.map}.webp`} alt={t("전장 미니맵")} loading="lazy" decoding="async" />}
        {stage.desc && <p className="rg-modal-desc">{stage.desc.replace(/<[^>]+>/g, "")}</p>}
        {stage.eliteDesc && <p className="rg-modal-elite">⚠ {stage.eliteDesc}</p>}
        {isEmg && (mul.atk || mul.max_hp || mul.def) && (
          <p className="rg-modal-elite">
            {t("긴급 배율")}: {mul.atk ? `${t("공격")} ×${mul.atk} ` : ""}{mul.def ? `${t("방어")} ×${mul.def} ` : ""}{mul.max_hp ? `HP ×${mul.max_hp}` : ""}
          </p>
        )}
        <div className="rg-modal-enemies">
          {stage.enemies.map((se) => {
            const e = data.enemies[se.key];
            if (!e) return null;
            return (
              <button type="button" key={se.key} className="rg-enemy-row" onClick={() => onOpenEnemy(se.key)}>
                {e.img ? <img className="rg-enemy-face sm" src={`/rogue/enemy/${e.img}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />
                  : <span className="rg-enemy-face sm none" aria-hidden>?</span>}
                <span className={`rg-rank r-${e.rank ?? "NORMAL"}`}>{t(RANK_KO[e.rank ?? ""] ?? "일반")}</span>
                <span className="rg-enemy-name">{e.name}</span>
                {se.cnt > 0 && <span className="rg-enemy-cnt">×{se.cnt}</span>}
                <StatRow e={e} grade={grade} ctx={ctx} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  normal: "작전", emergency: "긴급 작전", boss: "험난한 길", event: "조우 전투", duel: "특수",
};

// 전투 노드 카드 — 미니맵 썸네일 + 이름 (클릭 → 스테이지 상세)
function StageCard({ s, onOpen, emg, boss }: { s: Stage; onOpen: (s: Stage) => void; emg?: boolean; boss?: boolean }) {
  return (
    <button type="button" className={`rg-stagecard${emg ? " emg" : ""}${boss ? " boss" : ""}`} onClick={() => onOpen(s)}>
      {s.map && <img className="rg-stagecard-map" src={`/rogue/map/${s.map}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
      <span className="rg-stagecard-name">{s.name}</span>
    </button>
  );
}

// ── 메인 ───────────────────────────────────────────────────────────────────
export default function RogueGuide() {
  const { t, locale } = useI18n();
  const [view, setView] = useState<View>("map");
  const [grade, setGrade] = useState(0); // -1 = EASY, 0~15
  const [stageOpen, setStageOpen] = useState<Stage | null>(null);
  const [enemyOpen, setEnemyOpen] = useState<string | null>(null);
  const [enemyQ, setEnemyQ] = useState("");
  const [enemyRank, setEnemyRank] = useState<string>("");
  const [relicQ, setRelicQ] = useState("");
  const [arcTab, setArcTab] = useState<"relic" | "capsule" | "tool" | "band">("relic");

  // 해시 딥링크: #rg-<view>
  useEffect(() => {
    const fromHash = () => {
      const m = window.location.hash.match(/^#rg-(\w+)/);
      if (m && VIEWS.some((v) => v.id === m[1])) setView(m[1] as View);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const goView = (v: View) => {
    setView(v);
    history.pushState(null, "", `#rg-${v}`);
  };

  const stagesByZone = useMemo(() => {
    const m = new Map<number, { normal: Stage[]; emergency: Stage[] }>();
    for (const s of data.stages) {
      if (s.zone == null) continue;
      if (!m.has(s.zone)) m.set(s.zone, { normal: [], emergency: [] });
      const g = m.get(s.zone)!;
      (s.kind === "emergency" ? g.emergency : g.normal).push(s);
    }
    return m;
  }, []);
  const bossStages = useMemo(() => data.stages.filter((s) => s.kind === "boss"), []);
  const evStages = useMemo(() => data.stages.filter((s) => s.kind === "event"), []);
  const duelStages = useMemo(() => data.stages.filter((s) => s.kind === "duel"), []);

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
  }, []);

  const enemies = useMemo(() => {
    const q = normSearch(enemyQ);
    return Object.entries(data.enemies)
      .filter(([, e]) => (!enemyRank || e.rank === enemyRank))
      .filter(([, e]) => !q || normSearch(e.name).includes(q))
      .sort(([, a], [, b]) => (RANK_SORT[a.rank ?? ""] ?? 0) - (RANK_SORT[b.rank ?? ""] ?? 0) || a.name.localeCompare(b.name, "ko"));
  }, [enemyQ, enemyRank]);

  const relics = useMemo(() => {
    const q = normSearch(relicQ);
    return data.relics.filter((r) => !q || normSearch(r.name).includes(q) || normSearch(r.usage ?? "").includes(q));
  }, [relicQ]);

  const gradeLabel = grade < 0 ? t("고성 관광 (쉬움)") : t("정식 수사 {n}", { n: grade });

  const openEnemyFromStage = (key: string) => { setStageOpen(null); setEnemyOpen(key); goView("enemy"); setEnemyQ(data.enemies[key]?.name ?? ""); };

  return (
    <section className="rg" aria-labelledby="rg-title">
      <header className="rg-head">
        <div className="rg-hero">
          <img className="rg-hero-kv" src="/rogue/kv1.webp" alt="" aria-hidden loading="lazy" decoding="async" />
          <div className="rg-hero-text">
            <span className="rg-eyebrow">INTEGRATED STRATEGIES</span>
            <h2 id="rg-title">{t("통합전략 가이드")}</h2>
            <p className="rg-topic-pick">
              <span className="rg-topic on">{data.name}</span>
              <span className="rg-topic off">{t("다른 테마는 준비 중")}</span>
            </p>
            {locale !== "ko" && <p className="rg-disclaimer">{t("통합전략 데이터는 현재 한국어로만 제공됩니다.")}</p>}
            {data.line && <p className="rg-line">{data.line}</p>}
          </div>
        </div>

        {/* 난이도 선택 — 모든 스탯 표시에 반영 */}
        <div className="rg-diffbar" role="group" aria-label={t("난이도 선택")}>
          <span className="rg-diffbar-label">{t("난이도")}</span>
          <button type="button" className={`rg-diff-chip${grade < 0 ? " on" : ""}`} onClick={() => setGrade(-1)}>{t("쉬움")}</button>
          <input type="range" min={0} max={15} value={Math.max(0, grade)}
            onChange={(e) => setGrade(Number(e.target.value))}
            aria-label={t("난이도 등급")} />
          <span className={`rg-diff-cur${grade >= 0 ? " on" : ""}`}>{gradeLabel}</span>
        </div>
      </header>

      <nav className="rg-tabs" aria-label={t("통합전략 섹션")}>
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={view === v.id ? "on" : ""} onClick={() => goView(v.id)}>{t(v.label)}</button>
        ))}
      </nav>

      {view === "map" && (
        <div className="rg-map">
          {data.zones.map((z) => {
            const g = stagesByZone.get(z.num) ?? { normal: [], emergency: [] };
            const zoneBosses = bossStages.filter((s) => s.zone === z.num);
            return (
              <article key={z.id} className={`rg-zone${z.hidden ? " hidden-zone" : ""}`}>
                {z.img && <img className="rg-zone-bg" src={`/rogue/zone/rogue_1_map_${z.num}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                <div className="rg-zone-body">
                  <header>
                    <span className="rg-zone-num">{z.hidden ? "?" : z.num}</span>
                    <h3>{z.name}</h3>
                    {z.time && <span className="rg-zone-time">{z.time}</span>}
                    {z.hidden && <span className="rg-zone-hidden">{t("히든 층")}</span>}
                  </header>
                  <p className="rg-zone-desc">{z.desc}</p>
                  {g.normal.length > 0 && (
                    <div className="rg-stage-group">
                      <h4>{t("작전")} <em>{g.normal.length}</em></h4>
                      <div className="rg-stage-cards">
                        {g.normal.map((s) => <StageCard key={s.id} s={s} onOpen={setStageOpen} />)}
                      </div>
                    </div>
                  )}
                  {g.emergency.length > 0 && (
                    <div className="rg-stage-group">
                      <h4 className="emg">{t("긴급 작전")} <em>{g.emergency.length}</em></h4>
                      <div className="rg-stage-cards">
                        {g.emergency.map((s) => <StageCard key={s.id} s={s} onOpen={setStageOpen} emg />)}
                      </div>
                    </div>
                  )}
                  {zoneBosses.length > 0 && (
                    <div className="rg-stage-group">
                      <h4 className="boss">{t("험난한 길 (보스)")} <em>{zoneBosses.length}</em></h4>
                      <div className="rg-stage-cards">
                        {zoneBosses.map((s) => <StageCard key={s.id} s={s} onOpen={setStageOpen} boss />)}
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}

          <article className="rg-zone rg-zone-wide">
            <div className="rg-zone-body">
              <header><h3>{t("조우 전투")} · {t("특수 (심층 조사)")}</h3></header>
              <div className="rg-stage-cards">
                {evStages.map((s) => <StageCard key={s.id} s={s} onOpen={setStageOpen} />)}
                {duelStages.map((s) => <StageCard key={s.id} s={s} onOpen={setStageOpen} />)}
              </div>
            </div>
          </article>

          <article className="rg-zone rg-zone-wide">
            <div className="rg-zone-body">
              <header><h3>{t("우연한 만남·기타 노드")}</h3></header>
              <p className="rg-zone-desc">{t("비전투 노드에서 발생하는 이벤트입니다. 출현 층 표기는 위키 실측 기반입니다.")}</p>
              <div className="rg-encounters">
                {data.encounters.map((enc) => (
                  <details key={enc.scene} className="rg-enc">
                    <summary>
                      {enc.bg && <img className="rg-enc-thumb" src={`/rogue/scene/${enc.bg}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />}
                      <span className="rg-enc-title">{enc.title}</span>
                      {enc.floors && <span className="rg-enc-floors">{enc.floors.map((f) => `${f}`).join("·")}{t("층")}</span>}
                    </summary>
                    {enc.bg && <img className="rg-enc-cg" src={`/rogue/scene/${enc.bg}.webp`} alt={enc.title} loading="lazy" decoding="async" />}
                    {enc.desc && <p className="rg-enc-desc">{enc.desc}</p>}
                    {enc.note && <p className="rg-enc-note">{enc.note}</p>}
                    <ul className="rg-enc-choices">
                      {enc.choices.map((c, i) => (
                        <li key={i}><strong>{c.title}</strong>{c.desc ? ` — ${c.desc}` : ""}</li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </div>
          </article>
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
            {enemies.map(([key, e]) => {
              const appear = enemyStages.get(key) ?? [];
              const open = enemyOpen === key;
              return (
                <article key={key} className={`rg-enemy-card${open ? " open" : ""}`} id={`rg-en-${key}`}>
                  <header onClick={() => setEnemyOpen(open ? null : key)}>
                    {e.img ? <img className="rg-enemy-face" src={`/rogue/enemy/${e.img}.webp`} alt="" aria-hidden loading="lazy" decoding="async" />
                      : <span className="rg-enemy-face none" aria-hidden>?</span>}
                    <span className={`rg-rank r-${e.rank ?? "NORMAL"}`}>{t(RANK_KO[e.rank ?? ""] ?? "일반")}</span>
                    <h4>{e.name}</h4>
                    {e.index && <span className="rg-enemy-idx">{e.index}</span>}
                  </header>
                  <StatRow e={e} grade={grade} ctx={{ emergencyOrBoss: false }} />
                  {open && (
                    <div className="rg-enemy-more">
                      {e.attack && <p><strong>{t("공격 방식")}</strong> {e.attack}</p>}
                      {e.desc && <p className="rg-enemy-desc">{e.desc}</p>}
                      {e.ability && <p className="rg-enemy-ability">{e.ability.replace(/<[^>]+>/g, "")}</p>}
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
                                onClick={() => setStageOpen(s)}>
                                {s.zone != null ? `${s.zone}F ` : ""}{s.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}

      {view === "archive" && (
        <div className="rg-archive">
          <div className="rg-filterbar">
            {([["relic", "소장품 (유물)"], ["capsule", "레퍼토리 (음반)"], ["tool", "무대 도구"], ["band", "스쿼드"]] as const).map(([id, label]) => (
              <button key={id} type="button" className={arcTab === id ? "on" : ""} onClick={() => setArcTab(id)}>{t(label)}</button>
            ))}
            {arcTab === "relic" && (
              <input type="search" value={relicQ} onChange={(e) => setRelicQ(e.target.value)}
                placeholder={t("유물 검색")} aria-label={t("유물 검색")} />
            )}
            <span className="rg-count">
              {arcTab === "relic" ? relics.length : arcTab === "capsule" ? data.capsules.length : arcTab === "tool" ? data.tools.length : data.bands.length}
            </span>
          </div>
          {arcTab === "relic" && (
            <div className="rg-relic-grid">
              {relics.map((r) => (
                <article key={r.id} className="rg-relic">
                  <header>
                    {r.order && <span className="rg-relic-no">{r.order}</span>}
                    <h4>{r.name}</h4>
                  </header>
                  {r.usage && <p className="rg-relic-usage">{r.usage}</p>}
                  {r.desc && <p className="rg-relic-desc">{r.desc}</p>}
                  {r.obtain && <p className="rg-relic-obtain">{r.obtain}</p>}
                </article>
              ))}
            </div>
          )}
          {arcTab === "capsule" && (
            <div className="rg-capsule-grid">
              {data.capsules.map((c) => (
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
                  <header><h4>{c.name}</h4></header>
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
                  <header><h4>{c.name}</h4></header>
                  {c.usage && <p className="rg-relic-usage">{c.usage}</p>}
                  {c.desc && <p className="rg-relic-desc">{c.desc}</p>}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "hallu" && (
        <div className="rg-hallu">
          <p className="rg-zone-desc">{t("난이도 1 이상에서 구역에 환각이 나타납니다. 난이도 11 이상에서는 특정 조합이 융합 환각으로 발동합니다.")}</p>
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

      {view === "diff" && (
        <div className="rg-diff-view">
          <p className="rg-zone-desc">{t("난이도는 하위 등급의 규칙을 전부 포함합니다. 현재 선택한 난이도까지의 규칙이 강조됩니다.")}</p>
          <table className="rg-diff-table">
            <thead><tr><th>{t("등급")}</th><th>{t("추가 규칙")}</th></tr></thead>
            <tbody>
              {data.difficulties.filter((d) => d.mode === "EASY" || d.mode === "NORMAL").map((d) => {
                const on = d.mode === "EASY" ? grade < 0 : grade >= d.grade;
                return (
                  <tr key={`${d.mode}${d.grade}`} className={on ? "on" : ""}>
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
              <header><h3>{e.name}</h3></header>
              {e.desc && <p className="rg-ending-desc">{e.desc}</p>}
              {e.cond && e.cond.length > 0 && (
                <ol className="rg-ending-cond">
                  {e.cond.map((c, i) => <li key={i}>{c}</li>)}
                </ol>
              )}
              {e.change && <p className="rg-ending-change">“{e.change}”</p>}
            </article>
          ))}
        </div>
      )}

      {stageOpen && (
        <StageModal stage={stageOpen} grade={grade} onClose={() => setStageOpen(null)}
          onOpenEnemy={openEnemyFromStage} />
      )}
    </section>
  );
}

const RANK_SORT: Record<string, number> = { BOSS: 0, ELITE: 1, NORMAL: 2 };
