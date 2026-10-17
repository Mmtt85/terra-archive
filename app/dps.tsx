"use client";

// DPS 계산기 — /dps (2026-10-17, 제안 e8bcebb4 "オペレーターのスキル仕様でのDPSがほしい" · 사용자 지시 "시뮬레이터에 DPS 계산기 메뉴를 따로",
// "물리 및 마법 방어에 따른 DPS 자동", "어떤 적에 대한 DPS", "탄약은 다 썼을 때 기준", "범위 공격은 1명일 때·여러 명일 때").
// 왼쪽: 적(도감에서 고르거나 방어력·마법 저항·체력을 직접) · 적 수 · 그래프 축. 오른쪽: 오퍼 카드(여러 명 비교) + 방어력/저항 곡선.
// 계산은 app/dps-calc.ts (확실한 계수만 — 나머지는 '일부 효과 미반영'으로 알린다), 데이터는 scripts/build-dps.py → app/data/dps.json (이 화면에서만 받는다).
// 저장은 이 브라우저(localStorage 'ta:dps'). 주소 ?op=id,id&enemy=id:레벨 로 들어오면 그 오퍼·적으로 채운다(오퍼·적 도감의 'DPS 계산기에서 보기').
import { useEffect, useMemo, useState } from "react";
import { asset } from "./assets";
import { type Operator } from "./home";
import { useI18n } from "./i18n";
import { Dropdown } from "./dropdown";
import { NumInput } from "./num-input";
import { loadEnemies } from "./dex-cross";
import { enemyImg, enemyImgBase } from "./dex-paths";
import type { Enemy as DexEnemy } from "./enemy-detail";
import { calc, partialLabel, type Build, type DpsOp, type Result } from "./dps-calc";

/** count — 이 오퍼에게 맞는 적 수 (없으면 왼쪽 적 수). 여러 명을 치는 공격만 칸이 나온다 (사용자 지시 2026-10-17 "총 적 몇 명도 커스터마이즈") */
type Card = Build & { key: string; op: string; count?: number; span?: number };
/** 끝없이 지속되는 스킬(수르트 S3 등)의 총 피해를 몇 초 기준으로 셀지 — 기본 60초 (사용자 지시 2026-10-17 "스킬 켰을 때 총 피해량이 왜 없어") */
const DEF_SPAN = 60;
type Foe = { id: string; lv: number; def: number; res: number; hp: number; count: number };
type Saved = { cards?: Card[]; foe?: Foe; axis?: "def" | "res" };
const KEY = "ta:dps";
const DEF_FOE: Foe = { id: "", lv: 0, def: 0, res: 0, hp: 10000, count: 1 };
const MAX_CARDS = 6;

const load = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Saved; } catch { return {}; } };
const save = (v: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 사생활 보호 창 */ } };
const fmt = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "∞");
const sec = (n: number) => (Number.isFinite(n) ? `${n < 10 ? n.toFixed(2) : n.toFixed(1)}` : "∞");

function defaultBuild(op: DpsOp, id: string): Card {
  const phase = op.ph.length - 1;
  const skill = Math.max(0, op.sk.length - 1);
  return { key: `${id}-${Date.now().toString(36)}`, op: id, phase, level: op.ph[phase][0], pot: 1, equip: "", equipLv: 3,
    skill, skillLv: op.sk[skill]?.lv.length ?? 1, dmg: "auto" };
}

export function DpsCalc({ operators, onShowOperator }: { operators: Operator[]; onShowOperator?: (id: string) => void }) {
  const { locale, t } = useI18n();
  const byId = useMemo(() => new Map(operators.map((o) => [o.id, o])), [operators]);
  const [data, setData] = useState<Record<string, DpsOp> | null>(null);
  const [enemies, setEnemies] = useState<Map<string, DexEnemy> | null>(null);
  const [saved, setSaved] = useState<Saved>({});
  const [ready, setReady] = useState(false);
  // 데이터는 이 화면에 들어올 때만 (약 110KB 압축)
  useEffect(() => {
    let on = true;
    import("./data/dps.json").then((m) => { if (on) setData((m.default as unknown as { ops: Record<string, DpsOp> }).ops); });
    return () => { on = false; };
  }, []);
  useEffect(() => { let on = true; loadEnemies(locale).then((m) => { if (on) setEnemies(m); }); return () => { on = false; }; }, [locale]);
  // 저장값·주소는 마운트 뒤에 — 프리렌더 HTML 과 첫 렌더가 같아야 해서
  useEffect(() => {
    if (!data || ready) return;
    const s = load();
    const q = new URLSearchParams(window.location.search);
    const ops = (q.get("op") ?? "").split(",").filter((id) => data[id]);
    if (ops.length) s.cards = ops.slice(0, MAX_CARDS).map((id) => defaultBuild(data[id], id));
    setSaved(s); setReady(true);   // eslint-disable-line react-hooks/set-state-in-effect
  }, [data, ready]);
  useEffect(() => { if (ready) save(saved); }, [saved, ready]);
  // ?enemy=id:레벨 — 적 도감은 늦게 오므로 따로
  useEffect(() => {
    if (!ready || !enemies) return;
    const raw = new URLSearchParams(window.location.search).get("enemy");
    if (!raw) return;
    const [id, lv] = raw.split(":");
    const e = enemies.get(id);
    if (e) pickFoe(e, Number(lv) || 0);
  }, [ready, enemies]);   // eslint-disable-line react-hooks/exhaustive-deps

  const cards = useMemo(() => saved.cards ?? [], [saved.cards]);
  const foe = { ...DEF_FOE, ...(saved.foe ?? {}) };
  const axis = saved.axis ?? "def";
  const setFoe = (p: Partial<Foe>) => setSaved((s) => ({ ...s, foe: { ...DEF_FOE, ...(s.foe ?? {}), ...p } }));
  const setCard = (key: string, p: Partial<Card>) => setSaved((s) => ({ ...s, cards: (s.cards ?? []).map((c) => (c.key === key ? { ...c, ...p } : c)) }));
  function pickFoe(e: DexEnemy, lv: number) {
    const L = e.lv[Math.min(lv, e.lv.length - 1)] ?? e.lv[0];
    setFoe({ id: e.id, lv: L?.l ?? 0, def: L?.def ?? 0, res: L?.res ?? 0, hp: L?.hp ?? 0 });
  }
  const foeDex = foe.id ? enemies?.get(foe.id) : undefined;

  const results = useMemo(() => cards.map((c) => {
    const op = data?.[c.op];
    return op ? calc(op, c, { def: foe.def, res: foe.res, hp: foe.hp, count: c.count ?? foe.count }) : null;
  }), [cards, data, foe.def, foe.res, foe.hp, foe.count]);

  const candidates = useMemo(() => (data ? operators.filter((o) => data[o.id]).sort((a, b) => b.rarity - a.rarity || (b.seq ?? 0) - (a.seq ?? 0)) : []), [operators, data]);
  const enemyList = useMemo(() => (enemies ? [...enemies.values()].filter((e) => !e.hid).sort((a, b) => a.sort - b.sort) : []), [enemies]);

  return (
    <section className="explorer tool-explorer gacha gacha-plan dps" aria-label={t("DPS 계산기")}>
      <div className="filter-panel gacha-panel">
        <div className="panel-heading">
          <div><span className="section-no">DPS / 01</span><h2>{t("적과 조건")}</h2></div>
          <button type="button" className="reset" onClick={() => setSaved((s) => ({ ...s, foe: undefined }))}>↻ {t("초기화")}</button>
        </div>
        <div className="gp-group">
          <h3>{t("적")}</h3>
          <Dropdown ariaLabel={t("적 고르기")} scroll search={t("적 이름 검색")} className="dps-foe-drop" limit={50}
            label={foeDex ? <><FoeImg id={foeDex.id} size={22} />{foeDex.name}{foeDex.lv.length > 1 && <small> · {t("레벨 {n}", { n: foe.lv })}</small>}</> : t("직접 입력 (적 고르기)")}
            items={[{ value: "", label: t("직접 입력") }, ...enemyList.map((e) => ({ value: e.id, searchText: `${e.name} ${e.idx ?? ""}`,
              icon: <FoeImg id={e.id} size={22} />,
              label: <>{e.name}<small className="dps-foe-sub">{t("방어 {d} · 저항 {r}%", { d: e.lv[0]?.def ?? 0, r: e.lv[0]?.res ?? 0 })}</small></> }))]}
            selected={[foe.id]} onPick={(v) => { const e = enemies?.get(v); if (e) pickFoe(e, 0); else setFoe({ id: "", lv: 0 }); }} />
          {foeDex && foeDex.lv.length > 1 && (
            <div className="dps-seg" role="group" aria-label={t("적 레벨")}>
              {foeDex.lv.map((L, i) => (
                <button type="button" key={L.l} className={foe.lv === L.l ? "on" : ""} onClick={() => pickFoe(foeDex, i)}>{t("레벨 {n}", { n: L.l })}</button>
              ))}
            </div>
          )}
          <div className="gp-field"><span>{t("방어력")}</span><NumInput value={foe.def} onChange={(v) => setFoe({ def: v, id: "" })} step={50} /></div>
          <div className="gp-field"><span>{t("마법 저항 (%)")}</span><NumInput value={foe.res} onChange={(v) => setFoe({ res: v, id: "" })} max={100} step={5} /></div>
          <div className="gp-field"><span>{t("체력")}</span><NumInput value={foe.hp} onChange={(v) => setFoe({ hp: v })} step={1000} /></div>
          <div className="gp-field"><span title={t("범위 공격·여러 명 동시 공격은 이 수만큼 맞는다")}>{t("적 수")}</span><NumInput value={foe.count} onChange={(v) => setFoe({ count: v })} min={1} max={20} /></div>
        </div>
        <div className="gp-note">
          <p>{t("공격력·공격 배율·공격 속도·공격 간격·타수·대상 수·탄약·방어 무시처럼 확실한 계수만 계산합니다. 확률·원소 피해·체력 비례 같은 효과가 있는 스킬은 '일부 효과 미반영'으로 표시합니다.")}</p>
          <p>{t("재능과 모듈의 특성 변화는 아직 넣지 않았습니다(모듈은 스탯만). 버프·디버프를 주는 다른 오퍼도 계산하지 않습니다.")}</p>
        </div>
      </div>

      <div className="gp-main dps-main">
        {!data && <p className="gacha-side-empty">{t("불러오는 중…")}</p>}
        {data && (
          <div className="dps-cards">
            {cards.map((c, i) => {
              const o = byId.get(c.op), op = data[c.op], r = results[i];
              if (!o || !op || !r) return null;
              return <OpCard key={c.key} idx={i} card={c} o={o} op={op} r={r} count={c.count ?? foe.count} hp={foe.hp}
                onChange={(p) => setCard(c.key, p)} onShow={() => onShowOperator?.(c.op)} candidates={candidates}
                onSwap={(id) => { if (data[id]) setSaved((s) => ({ ...s, cards: (s.cards ?? []).map((x) => (x.key === c.key ? defaultBuild(data[id], id) : x)) })); }}
                onRemove={() => setSaved((s) => ({ ...s, cards: (s.cards ?? []).filter((x) => x.key !== c.key) }))} />;
            })}
            {cards.length < MAX_CARDS && (
              <Dropdown ariaLabel={t("오퍼 추가")} scroll search={t("오퍼 이름 검색")} className="dps-add-wrap" buttonClassName="dps-add"
                label={<><b aria-hidden>+</b><span>{t("오퍼 추가")}</span></>}
                items={candidates.map((x) => ({ value: x.id, searchText: x.name, label: <>{x.name}<small className="dps-foe-sub">★{x.rarity}</small></>,
                  icon: <img src={asset(x.image)} alt="" width={22} height={22} /> }))}
                selected={[]} onPick={(v) => { if (data[v]) setSaved((s) => ({ ...s, cards: [...(s.cards ?? []), defaultBuild(data[v], v)] })); }} />
            )}
          </div>
        )}
        {data && cards.length === 0 && <p className="gacha-side-empty">{t("오퍼를 추가하면 DPS 가 나옵니다")}</p>}
        {data && cards.length > 0 && <Chart cards={cards} data={data} byId={byId} foe={foe} foeName={foeDex?.name} axis={axis}
          onAxis={(a) => setSaved((s) => ({ ...s, axis: a }))} />}
      </div>
    </section>
  );
}

const PHASE = ["정예화 0", "정예화 1", "정예화 2"];

/** 적 초상 — 작게 (사용자 지시 2026-10-17 "적 섬네일도 좀 띄워 줘 작게"). 변형 id(…_2)는 기본 초상으로 물러난다 */
function FoeImg({ id, size }: { id: string; size: number }) {
  return <img className="dps-foe-img" src={enemyImg(id)} alt="" width={size} height={size} loading="lazy" decoding="async"
    onError={(e) => { const el = e.currentTarget; if (!el.dataset.fb) { el.dataset.fb = "1"; el.src = enemyImgBase(id); } else el.style.visibility = "hidden"; }} />;
}

function OpCard({ idx, card: c, o, op, r, count, hp, candidates, onChange, onShow, onSwap, onRemove }: {
  idx: number; card: Card; o: Operator; op: DpsOp; r: Result; count: number; hp: number; candidates: Operator[];
  onChange: (p: Partial<Card>) => void; onShow: () => void; onSwap: (id: string) => void; onRemove: () => void;
}) {
  const { t, locale } = useI18n();
  const maxLv = op.ph[Math.min(c.phase, op.ph.length - 1)][0];
  const sk = op.sk[c.skill];
  const skName = (i: number) => o.skills.find((s) => s.id === op.sk[i]?.id)?.name ?? `S${i + 1}`;
  const skLvLabel = (n: number) => (n <= 7 ? t("스킬 {n}레벨", { n }) : t("특화 {n}", { n: n - 7 }));
  const mods = Object.keys(op.eq);
  const modName = (id: string) => { const m = o.modules.find((x) => x.id === id); return m ? `${m.type}` : id; };
  // 여러 명을 치는 공격인가 — 적이 아주 많을 때 동시에 맞는 수로 가늠한다
  const wide = useMemo(() => calc(op, c, { def: 0, res: 0, hp: 1, count: 99 }), [op, c]);
  const maxT = wide.kind === "ok" ? Math.max(wide.normal.targets, wide.skill?.targets ?? 1) : 1;
  const showN = count > 1 && maxT > 1;
  // 한 줄 = DPS · 그동안의 총 피해. 적이 여럿이면 칸 아래에 N명 값
  const cell = (one: number | null, many: number | null) => (
    <td>{one == null ? "—" : fmt(one)}{showN && many != null && <small>{t("{n}명 {v}", { n: count, v: fmt(many) })}</small>}</td>
  );
  const row = (label: string, note: string, d1: number | null, dN: number | null, tot1: number | null, totN: number | null) => (
    <tr><th>{label}{note && <small>{note}</small>}</th>{cell(d1, dN)}{cell(tot1, totN)}</tr>
  );
  const charge = r.charge;
  // 끝없이 지속 — 켜 두고 싸우는 스킬이라 평타·한 바퀴 평균은 빼고, 정한 시간 동안의 총 피해를 낸다
  const endless = !!r.skill && r.dur === Infinity;
  const span = c.span ?? DEF_SPAN;
  const ammoNote = r.ammoTotal > 0 ? t("탄약 {n}발", { n: r.ammoTotal }) : "";
  return (
    <article className={`dps-card s${idx}`}>
      <header>
        {/* 초상 = 오퍼 상세, 이름 = 다른 오퍼로 바꾸는 드롭다운 (사용자 지시 2026-10-17 "오퍼 변경 버튼 따로 하지 말고 오퍼 이름 부분을 드롭다운으로").
            바꾸면 자리(색·순서)는 그대로, 설정은 새 오퍼 기본값 */}
        <button type="button" className="dps-op-img" onClick={onShow} title={t("오퍼 상세")} aria-label={t("오퍼 상세")}>
          <img src={asset(o.image)} alt="" width={40} height={40} />
        </button>
        <Dropdown ariaLabel={t("다른 오퍼로 바꾸기")} scroll search={t("오퍼 이름 검색")} className="dps-swap-wrap" buttonClassName="dps-swap"
          label={<span className="dps-op-name"><b>{o.name}</b><small>★{o.rarity} · {r.dmg === "arts" ? t("마법") : t("물리")}</small></span>}
          items={candidates.map((x) => ({ value: x.id, searchText: x.name, label: <>{x.name}<small className="dps-foe-sub">★{x.rarity}</small></>,
            icon: <img src={asset(x.image)} alt="" width={22} height={22} /> }))}
          selected={[o.id]} onPick={(v) => { if (v !== o.id) onSwap(v); }} />
        <button type="button" className="dps-x" aria-label={t("{name} 빼기", { name: o.name })} onClick={onRemove}>×</button>
      </header>
      <div className="dps-ctrl">
        <Dropdown ariaLabel={t("정예화")} label={t(PHASE[c.phase])} items={op.ph.map((_, i) => ({ value: String(i), label: t(PHASE[i]) }))}
          selected={[String(c.phase)]} onPick={(v) => { const p = Number(v); onChange({ phase: p, level: op.ph[p][0], skillLv: p < 2 ? Math.min(c.skillLv, p === 0 ? 4 : 7) : c.skillLv }); }} />
        <label className="dps-lv"><span>Lv</span><NumInput value={c.level} onChange={(v) => onChange({ level: v })} min={1} max={maxLv} /></label>
        <Dropdown ariaLabel={t("잠재")} label={t("잠재 {n}", { n: c.pot })} items={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: t("잠재 {n}", { n }) }))}
          selected={[String(c.pot)]} onPick={(v) => onChange({ pot: Number(v) })} />
        {op.sk.length > 0 && (
          <Dropdown ariaLabel={t("스킬")} label={`S${c.skill + 1} ${skName(c.skill)}`}
            items={op.sk.map((_, i) => ({ value: String(i), label: `S${i + 1} ${skName(i)}` }))}
            selected={[String(c.skill)]} onPick={(v) => { const i = Number(v); onChange({ skill: i, skillLv: Math.min(c.skillLv, op.sk[i].lv.length) }); }} />
        )}
        {sk && (
          <Dropdown ariaLabel={t("스킬 레벨")} label={skLvLabel(c.skillLv)}
            items={sk.lv.map((_, i) => ({ value: String(i + 1), label: skLvLabel(i + 1) }))}
            selected={[String(c.skillLv)]} onPick={(v) => onChange({ skillLv: Number(v) })} />
        )}
        {mods.length > 0 && c.phase === 2 && (
          <Dropdown ariaLabel={t("모듈")} label={c.equip ? `${modName(c.equip)} · ${c.equipLv}` : t("모듈 없음")}
            items={[{ value: "", label: t("모듈 없음") }, ...mods.flatMap((id) => [1, 2, 3].map((lv) => ({ value: `${id}|${lv}`, label: `${modName(id)} · ${t("{n}단계", { n: lv })}` })))]}
            selected={[c.equip ? `${c.equip}|${c.equipLv}` : ""]} onPick={(v) => { const [id, lv] = v.split("|"); onChange({ equip: id, equipLv: Number(lv) || 3 }); }} />
        )}
        <Dropdown ariaLabel={t("피해 유형")} label={c.dmg === "auto" ? t("피해 자동") : c.dmg === "arts" ? t("마법 피해") : t("물리 피해")}
          items={[{ value: "auto", label: t("피해 자동") }, { value: "phys", label: t("물리 피해") }, { value: "arts", label: t("마법 피해") }]}
          selected={[c.dmg]} onPick={(v) => onChange({ dmg: v as Card["dmg"] })} />
        {endless && (
          <label className="dps-lv" title={t("끝없이 지속되는 스킬의 총 피해를 몇 초 동안으로 셀지")}><span>{t("계산 시간(초)")}</span>
            <NumInput value={span} onChange={(v) => onChange({ span: v })} min={1} max={600} step={10} /></label>
        )}
        {maxT > 1 && (
          <label className="dps-lv" title={t("이 오퍼에게 맞는 적 수 — 비우면 왼쪽 '적 수'를 따른다")}><span>{t("맞는 적")}</span>
            <NumInput value={c.count ?? count} onChange={(v) => onChange({ count: v })} min={1} max={maxT >= 20 ? 20 : maxT} /></label>
        )}
      </div>
      {r.kind === "heal" ? <p className="dps-none">{t("치료 오퍼레이터라 DPS 를 계산하지 않습니다")}</p>
        : r.kind === "none" ? <p className="dps-none">{t("직접 공격하지 않는 오퍼레이터입니다")}</p>
        : (
          <>
            <table className="dps-table">
              <thead><tr><th /><th>DPS</th><th>{t("총 피해")}</th></tr></thead>
              <tbody>
                {/* 평타 — 총 피해는 스킬을 채우는 동안(충전 시간). 스킬이 없거나 피격 충전이면 비운다 */}
                {/* 평타 줄은 평타가 스킬과 섞여 나갈 때만 — 스킬이 없거나, 다음 공격을 강화하는 한 방짜리 스킬 (사용자 지시 2026-10-17
                    "스킬 발동 전 평타 DPS 는 필요 없지 않아? 스킬 쓰면서 평타 섞여 나가는 경우 아니면") */}
                {(!r.skill || r.dur === 0) && row(t("평타"), r.skill && charge != null ? t("충전 {s}초 동안", { s: sec(charge) }) : "", r.normal.dps1, r.normal.dpsN,
                  r.skill && charge != null ? r.normal.dps1 * charge : null, r.skill && charge != null ? r.normal.dpsN * charge : null)}
                {/* 발동 순간 피해 (보정 규칙 burst — 첸 더 던스트릭 S2 참격 10회 등) */}
                {r.skill && r.open1 > 0 && row(t("발동 피해"), t("한 번"), null, null, r.open1, r.openN)}
                {r.skill && (r.dur === 0
                  ? r.open1 === 0 && row(t("스킬"), t("한 번"), null, null, r.skill.hit, r.skill.hit * r.skill.targets)
                  : endless
                    ? row(t("스킬 중"), t("계속 지속 · {s}초 기준", { s: span }), r.skill.dps1, r.skill.dpsN, r.skill.dps1 * span + r.open1, r.skill.dpsN * span + r.openN)
                    : r.skill.dps1 > 0 || r.open1 === 0
                      ? row(r.open1 > 0 ? t("스킬 중 공격") : t("스킬 중"), r.ammoTotal > 0 ? ammoNote : t("{s}초", { s: sec(r.dur) }), r.skill.dps1, r.skill.dpsN,
                        r.total1 - r.open1, r.totalN - r.openN)
                      : null)}
                {/* 발동 피해가 있으면 합계 — DPS 는 (발동 + 공격) ÷ 지속 */}
                {r.skill && r.open1 > 0 && r.dur > 0 && Number.isFinite(r.dur) && row(t("스킬 합계"), t("{s}초", { s: sec(r.dur) }), r.eff1, r.effN, r.total1, r.totalN)}
                {/* 한 바퀴 평균(충전+발동)은 뺐다 — "평타 DPS 신경 쓰는 사람 없다" (사용자 판단 2026-10-17) */}
              </tbody>
            </table>
            <p className="dps-facts">
              <span>{t("공격력 {n}", { n: fmt(r.atk) })}</span>
              <span>{t("공격 간격 {n}초", { n: sec(r.normal.interval) })}{r.skill && r.skill.interval !== r.normal.interval && ` → ${sec(r.skill.interval)}`}</span>
              {r.skill && <span>{r.dur === 0 ? t("한 번 쓰는 스킬") : r.ammoTotal > 0 ? (r.ammo !== r.ammoTotal ? t("탄약 {n}발 · 공격 {a}회 · {s}초", { n: r.ammoTotal, a: r.ammo, s: sec(r.dur) }) : t("탄약 {n}발 · {s}초", { n: r.ammoTotal, s: sec(r.dur) })) : Number.isFinite(r.dur) ? t("지속 {s}초", { s: sec(r.dur) }) : t("계속 지속")}</span>}
              {r.charge != null && r.skill && <span>{t("충전 {s}초", { s: sec(r.charge) })}</span>}
              {r.skill && r.skill.targets > 1 && <span>{t("동시에 {n}명", { n: r.skill.targets })}</span>}
              {hp > 0 && r.skill && r.eff1 > 0 && r.dur !== 0 && (
                <span title={t("스킬 중 DPS 로 적 1명을 쓰러뜨리는 시간")}>{t("처치 {s}초", { s: sec(hp / r.eff1) })}{Number.isFinite(r.dur) && hp / r.eff1 > r.dur && ` (${t("스킬 시간 초과")})`}</span>
              )}
            </p>
            {r.fxNote && <p className="dps-fx">{typeof r.fxNote === "string" ? t(r.fxNote) : r.fxNote[locale as "ko" | "en" | "ja"] ?? r.fxNote.ko}</p>}
            {(r.partial.length > 0 || r.subNote) && (
              <p className="dps-partial">
                <b>{t("일부 효과 미반영")}</b>
                {[...new Set(r.partial.map(partialLabel))].map((k) => t(k)).concat(r.subNote ? [t(r.subNote)] : []).join(" · ")}
              </p>
            )}
            {sk && <p className="dps-desc">{o.skills.find((s) => s.id === sk.id)?.description}</p>}
          </>
        )}
    </article>
  );
}

/** 방어력(또는 마법 저항)에 따른 곡선 — 오퍼마다 선 하나, 고른 적은 세로 점선 */
function Chart({ cards, data, byId, foe, foeName, axis, onAxis }: {
  cards: Card[]; data: Record<string, DpsOp>; byId: Map<string, Operator>; foe: Foe; foeName?: string; axis: "def" | "res"; onAxis: (a: "def" | "res") => void;
}) {
  const { t } = useI18n();
  // 축 이름 — 가로는 방어력/마법 저항, 세로는 DPS (사용자 지적 2026-10-17 "어디가 방어력이고 어디가 DPS 인지 구분이 안 감")
  const W = 640, H = 260, P = { l: 66, r: 24, t: 12, b: 44 };
  // 점은 선마다 401개(축 길이 ÷ 400 간격) — 50 간격이면 바닥(5%)에 닿는 자리가 비탈로 그려져 꺾인 듯 보였다 (사용자 지적 2026-10-17).
  // 아래 useMemo 로 축·카드·적이 바뀔 때만 다시 센다
  const valueAt = (c: Card, x: number): number | null => {
    const op = data[c.op];
    if (!op) return null;
    const r = calc(op, c, { def: axis === "def" ? x : foe.def, res: axis === "res" ? x : foe.res, hp: foe.hp, count: 1 });
    if (r.kind !== "ok") return null;
    return r.skill && r.dur !== 0 ? r.eff1 : r.normal.dps1;
  };
  // 방어력 축 끝 — 2,000 고정이 아니라 모든 선이 최소 DPS(5%)에 닿는 방어력 + 5% (사용자 지시 2026-10-17).
  // 선마다 큰 방어력(10,000)의 값을 최소로 보고, 처음 그 값이 되는 방어력을 50 간격으로 찾는다. 마법만 있으면(방어력과 무관) 1,000.
  // 고른 적의 방어력이 그보다 크면 거기까지. 마법 저항 축은 0~100% 그대로
  // floors — 선마다 최소 DPS 가 시작되는 정확한 자리 (그 사이를 이분법으로). 점은 안 찍고 자석만 (사용자 지시 2026-10-17 "최소 대미지가 되는 지점도 자석" · "점 찍을 필요 없음")
  const { xMax, floors } = useMemo(() => {
    const big = axis === "def" ? 10000 : 100;
    const floors: { i: number; x: number; y: number }[] = [];
    cards.forEach((c, i) => {
      const floor = valueAt(c, big);
      if (floor == null || valueAt(c, 0) === floor) return;
      const stepF = axis === "def" ? 50 : 1;
      let x = 0;
      while (x < big && (valueAt(c, x) ?? floor) > floor + 1e-6) x += stepF;
      let lo = Math.max(0, x - stepF), hi = x;
      for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if ((valueAt(c, mid) ?? floor) > floor + 1e-6) lo = mid; else hi = mid; }
      floors.push({ i, x: hi, y: floor });
    });
    if (axis === "res") return { xMax: 100, floors };
    const edge = Math.max(0, ...floors.map((f) => f.x));
    const raw = Math.max(edge ? edge * 1.05 : 1000, foe.def * 1.05, 100);
    const unit = raw > 2000 ? 500 : raw > 800 ? 100 : 50;
    return { xMax: Math.ceil(raw / unit) * unit, floors };
  }, [cards, data, axis, foe.def, foe.res]);   // eslint-disable-line react-hooks/exhaustive-deps
  const step = xMax / 400;
  const xs = Array.from({ length: 401 }, (_, i) => i * step);
  const series = useMemo(() => cards.map((c) => ({ c, ys: data[c.op] ? xs.map((x) => valueAt(c, x)) : [] })),
    [cards, data, axis, foe.def, foe.res, foe.hp, xMax]);   // eslint-disable-line react-hooks/exhaustive-deps
  // 두 선이 엇갈리는 자리 — 눈금 사이에서 부호가 바뀌면 이분법으로 정확한 값을 찾아 가로축에 숫자로 (사용자 지시 2026-10-17
  // "크로스되는 부분이 정확하게 얼만지 축 쪽에다가 숫자 표시"). 둘 다 바닥(5%)에 붙어 같아지는 구간은 엇갈림이 아니다
  const crosses = useMemo(() => {
    const out: { x: number; y: number; a: number; b: number }[] = [];
    for (let a = 0; a < series.length; a++) for (let b = a + 1; b < series.length; b++) {
      const A = series[a], B = series[b];
      for (let j = 1; j < xs.length; j++) {
        const p0 = A.ys[j - 1], p1 = A.ys[j], q0 = B.ys[j - 1], q1 = B.ys[j];
        if (p0 == null || p1 == null || q0 == null || q1 == null) continue;
        const d0 = p0 - q0, d1 = p1 - q1;
        if (d0 === 0 || d1 === 0 || Math.sign(d0) === Math.sign(d1)) continue;
        let lo = xs[j - 1], hi = xs[j];
        for (let k = 0; k < 30; k++) {
          const mid = (lo + hi) / 2, d = (valueAt(A.c, mid) ?? 0) - (valueAt(B.c, mid) ?? 0);
          if (Math.sign(d) === Math.sign(d0)) lo = mid; else hi = mid;
        }
        const x = (lo + hi) / 2;
        out.push({ x, y: valueAt(A.c, x) ?? 0, a, b });
      }
    }
    return out;
  }, [series]);   // eslint-disable-line react-hooks/exhaustive-deps

  const yMax = Math.max(1, ...series.flatMap((s) => s.ys.filter((v): v is number => v != null)));
  const X = (x: number) => P.l + (x / xMax) * (W - P.l - P.r);
  const Y = (y: number) => H - P.b - (y / yMax) * (H - P.t - P.b);
  // 가로 눈금 — 축 길이에 맞춰 4~6칸
  const tickStep = axis === "res" ? 20 : [50, 100, 200, 250, 500, 1000].find((u) => xMax / u <= 6) ?? 1000;
  const ticksX = Array.from({ length: Math.floor(xMax / tickStep) + 1 }, (_, i) => i * tickStep);
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const cur = axis === "def" ? foe.def : foe.res;
  // 마우스를 올린 자리 — 그 가로값에서 선마다 정확한 DPS (사용자 지시 2026-10-17 "선에 마우스오버 했을 때 해당 지점이 어떤 값인지")
  const [hx, setHx] = useState<{ x: number; px: number; py: number; flip: boolean; list: number[]; snap?: "cross" | "foe" | "floor" } | null>(null);
  // 클릭하면 그 자리에 고정, 다시 클릭하면 풀린다 (사용자 지시 2026-10-17 "클릭하면 그대로 고정되게")
  const [pinned, setPinned] = useState(false);
  const onMove = (e: React.MouseEvent<SVGSVGElement>, force?: boolean) => {
    if (pinned && !force) return;
    const rc = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rc.left) / rc.width) * W;
    const sy0 = ((e.clientY - rc.top) / rc.height) * H;
    // 선이 그려지는 칸 안에서만 — 축 숫자·축 이름 자리는 뺀다 (사용자 지시 2026-10-17 "그래프 밖 x축 쪽에 올려도 뜬다")
    if (sx < P.l || sx > W - P.r || sy0 < P.t || sy0 > H - P.b) { setHx(null); return; }
    const raw = ((sx - P.l) / (W - P.l - P.r)) * xMax;
    // 점 자석 — 선 위에 점이 찍힌 자리(엇갈림·고른 적) 좌우 4px(그래프 단위) 안이면 그 자리로 붙는다
    // (사용자 지시 2026-10-17 "자석으로 달라붙듯이" → 같은 날 "점이 있는 모든 부분에, 범위는 조금 더 줄여" → "살짝 더 줄여" 10→6→4)
    const dots = [...crosses.map((cr) => ({ x: cr.x, kind: "cross" as const })), ...floors.map((f) => ({ x: f.x, kind: "floor" as const })),
      ...((cur > 0 || foeName) && cur <= xMax ? [{ x: cur, kind: "foe" as const }] : [])];
    const snap = dots.reduce<{ x: number; d: number; kind: "cross" | "foe" | "floor" } | null>((best, dt) => {
      const d = Math.abs(X(dt.x) - sx);
      return d < 4 && (!best || d < best.d) ? { x: dt.x, d, kind: dt.kind } : best;
    }, null);
    const x = snap ? snap.x : axis === "res" ? Math.round(raw * 2) / 2 : Math.round(raw);
    // 그래프 어디에 올려도 그 가로값의 선 전부, 큰 값부터 (사용자 지시 2026-10-17 — 선 위·선 밑만 잡던 걸 거쳐 "그래프 위쪽도 다 인식하게")
    const list = series.map((s, i) => ({ i, v: valueAt(s.c, x) })).filter((o): o is { i: number; v: number } => o.v != null)
      .sort((a, b) => b.v - a.v).map((o) => o.i);
    if (!list.length) { setHx(null); return; }
    setHx({ x, list, snap: snap?.kind, px: snap ? (X(snap.x) / W) * rc.width : e.clientX - rc.left, py: e.clientY - rc.top, flip: e.clientX - rc.left > rc.width * 0.6 });   // 오른쪽이면 상자를 왼쪽에
  };
  const hv = hx ? hx.list.map((i) => ({ i, s: series[i], v: valueAt(series[i].c, hx.x) })) : [];
  // 세로축의 강조 숫자(엇갈림·고른 적·마우스 자리) 근처 눈금 숫자는 숨긴다 — 겹쳐서 "2,040 이 뭐냐"가 됐다 (사용자 질문 2026-10-17)
  const marks = [
    ...(hx ? hv.map((h) => (h.v == null ? null : Y(h.v))) : (cur > 0 || foeName) && cur <= xMax ? series.map((s) => { const v = valueAt(s.c, cur); return v == null ? null : Y(v); }) : []),
  ].filter((v): v is number => v != null);
  const tickHidden = (y: number) => marks.some((m) => Math.abs(m - Y(y)) < 12);
  return (
    <figure className="dps-chart">
      <figcaption>{axis === "def" ? t("방어력에 따른 DPS") : t("마법 저항에 따른 DPS")} · {t("스킬 중")} · {t("적 1명")}
        {pinned && <em className="dps-pin-badge">📌 {t("고정 중")}</em>}
        {foeName && <small>{t("점선 = {name} ({a})", { name: foeName, a: axis === "def" ? t("방어력 {n}", { n: foe.def }) : t("마법 저항 {n}%", { n: foe.res }) })}</small>}
        {/* 가로축 고르기 — 제목 줄 오른쪽 끝 (사용자 지시 2026-10-17 "그래프 안 오른쪽 위" → "더 위로, 제목 줄 오른쪽"). 종전엔 왼쪽 칸 '그래프' 묶음 */}
        <span className="dps-seg dps-axis-seg" role="group" aria-label={t("그래프 가로축")}>
          <button type="button" className={axis === "def" ? "on" : ""} onClick={() => onAxis("def")}>{t("방어력")}</button>
          <button type="button" className={axis === "res" ? "on" : ""} onClick={() => onAxis("res")}>{t("마법 저항")}</button>
        </span></figcaption>
      <div className="dps-chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("DPS 곡선")} onPointerMove={onMove} onPointerLeave={() => { if (!pinned) setHx(null); }}
        onClick={(e) => { if (pinned) { setPinned(false); onMove(e, true); } else if (hx) setPinned(true); }} className={pinned ? "pinned" : undefined}>
        {ticksY.map((y) => <g key={y}><line className="grid" x1={P.l} x2={W - P.r} y1={Y(y)} y2={Y(y)} />{!tickHidden(y) && <text x={P.l - 6} y={Y(y) + 4} textAnchor="end">{fmt(y)}</text>}</g>)}
        {ticksX.map((x) => <text key={x} x={X(x)} y={H - P.b + 16} textAnchor="middle">{axis === "res" ? `${x}%` : x}</text>)}
        <line className="axis" x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} />
        {/* 고른 적(점선) 자리 — 선마다 그 자리의 DPS 를 점과 숫자로 */}
        {(cur > 0 || foeName) && cur <= xMax && series.map((s, i) => {
          const v = valueAt(s.c, cur);
          return v == null ? null : (
            <g key={`cur-${s.c.key}`} className={`cur-pt s${i}`}>
              <line className="to-y" x1={P.l} x2={X(cur)} y1={Y(v)} y2={Y(v)} />
              <circle cx={X(cur)} cy={Y(v)} r={3.5} />
              {!hx && <text className="y" x={P.l - 6} y={Y(v) + 4} textAnchor="end">{fmt(v)}</text>}
            </g>
          );
        })}
        {/* 엇갈림 — 점과 축까지 내린 가는 선만. 값(방어력·DPS)은 늘 적지 않고 마우스를 올리면 나온다 (사용자 지시 2026-10-17 "값 자체를 지워") */}
        {crosses.map((cr, i) => {
          return (
            <g key={`${cr.a}-${cr.b}-${i}`} className="cross">
              <line x1={X(cr.x)} x2={X(cr.x)} y1={Y(cr.y)} y2={H - P.b} />
              <circle cx={X(cr.x)} cy={Y(cr.y)} r={3} />
            </g>
          );
        })}
        <line className="axis" x1={P.l} x2={P.l} y1={P.t} y2={H - P.b} />
        <text className="axis-title" x={(P.l + W - P.r) / 2} y={H - 6} textAnchor="middle">{axis === "def" ? t("적 방어력") : t("적 마법 저항")} →</text>
        <text className="axis-title" x={14} y={(P.t + H - P.b) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(P.t + H - P.b) / 2})`}>DPS →</text>
        {/* 고른 적 — 이름까지 (사용자 지시 2026-10-17 "무슨 적인지도 알 수 있게"). 오른쪽 끝에 가까우면 선 왼쪽에 쓴다 */}
        {cur >= 0 && cur <= xMax && (foeName || cur > 0) && (
          <text className="cur-label" x={X(cur) + (cur > xMax * 0.7 ? -6 : 6)} y={H - P.b - 8} textAnchor={cur > xMax * 0.7 ? "end" : "start"}>
            {foeName ? `${foeName} · ` : ""}{axis === "def" ? t("방어력 {n}", { n: cur }) : t("마법 저항 {n}%", { n: cur })}
          </text>
        )}
        {(cur > 0 || foeName) && cur <= xMax && (() => {
          // 세로 점선은 선 위로 안 올라간다 (사용자 지시 2026-10-17) — 가장 높은 선까지만
          const top = Math.min(H - P.b, ...series.map((s) => valueAt(s.c, cur)).filter((v): v is number => v != null).map(Y));
          return <line className="cur" x1={X(cur)} x2={X(cur)} y1={top} y2={H - P.b} />;
        })()}
        {series.map((s, i) => (
          <polyline key={s.c.key} className={`ln s${i}`} fill="none"
            points={s.ys.map((y, j) => (y == null ? null : `${X(xs[j]).toFixed(1)},${Y(y).toFixed(1)}`)).filter(Boolean).join(" ")} />
        ))}
      {hx && (
          <g className="hover">
            <line x1={X(hx.x)} x2={X(hx.x)} y1={hv[0]?.v != null ? Y(hv[0].v) : H - P.b} y2={H - P.b} />{/* hv 는 큰 값부터 — 맨 위 점까지 */}
            {hv.map(({ i, v }) => v != null && (
              <g key={i} className={`s${i}`}>
                <line className="to-y" x1={P.l} x2={X(hx.x)} y1={Y(v)} y2={Y(v)} />
                <circle cx={X(hx.x)} cy={Y(v)} r={4} />
                <text className="y" x={P.l - 6} y={Y(v) + 4} textAnchor="end">{fmt(v)}</text>
              </g>
            ))}
          </g>
        )}
      </svg>
      {hx && (
        <div className={`dps-tip${hx.flip ? " flip" : ""}${pinned ? " pinned" : ""}`} style={{ left: hx.px, top: Math.max(0, hx.py - 52) }}>
          {pinned && <small className="dps-pin">📌 {t("고정 중 — 그래프를 다시 누르면 풀림")}</small>}
          <b>{axis === "def" ? t("방어력 {n}", { n: Math.round(hx.x) }) : t("마법 저항 {n}%", { n: Math.round(hx.x * 10) / 10 })}
            {hx.snap === "cross" && <small> · {t("두 선이 엇갈리는 자리")}</small>}{hx.snap === "foe" && foeName && <small> · {foeName}</small>}{hx.snap === "floor" && <small> · {t("여기서부터 최소 대미지(5%)")}</small>}</b>
          {hv.map(({ i, s, v }) => (
            <span key={i} className={`s${i}`}><i aria-hidden />{byId.get(s.c.op)?.name} S{s.c.skill + 1}<em>{v == null ? "—" : fmt(v)}</em></span>
          ))}
        </div>
      )}
      </div>
      <ul className="dps-legend">
        {series.map((s, i) => <li key={s.c.key} className={`s${i}`}><i aria-hidden />{byId.get(s.c.op)?.name} S{s.c.skill + 1}</li>)}
      </ul>
    </figure>
  );
}
