"use client";

// 가챠 플래너 — /gacha-planner (메뉴 가챠 → 플래너, 2026-10-17) (제안 29e01609 "미래시 일정이 쭉 나오고 지금 가진 재화·이벤트마다 몇 연차 쓸지 넣으면 계산되는 기능",
// 48a95d32 "gacha currency calculator/planner for future earnings and spending", 2026-10-17).
//
// 일정 = gacha-pool.json plan (scripts/build-gacha-pool.py) — 진행 중·앞으로 올 이벤트, 신규 헤드헌팅 오퍼·한정 여부·첫 클리어 순오리지늄.
// 날짜는 한섭 기간 → 한섭 확정일(kr-confirmed) → 중↔한 시차 추정월(eta, 그 달 15일로 셈) 순. 복각·한정 배너처럼 데이터에 없는
// 일정은 사용자가 줄을 더한다.
// 수입은 게임 데이터에 없는 값이라(일일·주간 임무·섬멸·상점은 서버 규칙) 흔히 쓰는 기본값을 깔고 사용자가 고친다.
// 이벤트 미션·상점의 합성옥·허가증도 게임 표에 없다 — 이벤트 수입은 작전 첫 3성 순오리지늄(prime)만 데이터에서 온다.
// 저장은 이 브라우저(localStorage 'ta:gacha-plan'). 내 정보에 로그인돼 있으면 cloud-prefs 가 계정에도 올리고 다른 기기에서 받아 온다
// (사용자 지시 2026-10-17 "조정한 설정값도 로그인 상태면 서버에 저장") — 받아 쓸 때 오는 storage 이벤트를 듣는다.
import { useEffect, useMemo, useState } from "react";
import { asset } from "./assets";
import { type Operator } from "./home";
import { useI18n } from "./i18n";
import { mePulls, useMe } from "./me-store";
import { confirmedDay } from "./kr-confirmed";
import { NumInput } from "./num-input";
import { ModalWindow } from "./modal-window";
import { openEvent } from "./event-open";
import { DatePicker } from "./date-picker";
import { Dropdown } from "./dropdown";
import poolData from "./data/gacha-pool.json";

type PlanRow = { id: string; n: Record<"ko" | "en" | "ja", string>; start?: string | null; end?: string | null; eta?: string; fut?: 1; ops?: string[]; lim?: 1; prime?: number };
const PLAN = ((poolData as unknown as { plan?: PlanRow[] }).plan ?? []);

type Income = { daily: number; weekly: number; anni: number; card: boolean; monthPermit: number; monthOrundum: number; monthPrime: number; useOP: boolean; cert: boolean };
type Start = { orundum: number; permit: number; permit10: number; prime: number };
type Custom = { id: string; name: string; date: string };
// targets = 일정마다 뽑을 오퍼(목표) — 사용자 지시 2026-10-17 "무슨 오퍼 뽑을건지 지정하는 기능도 필요"
type Saved = { income?: Partial<Income>; start?: Start | null; spend?: Record<string, number>; custom?: Custom[]; targets?: Record<string, string[]> };
// 헤드헌팅으로 얻는 오퍼 — 목표 고르기 창의 검색 후보 (통상 풀 + 한정 + 커널 + 미실장 헤드헌팅 오퍼)
const POOL = poolData as unknown as { pool: Record<string, string[]>; limited: string[]; kernel: string[]; future: string[] };
const GACHAABLE = new Set([...Object.values(POOL.pool).flat(), ...POOL.limited, ...POOL.kernel, ...POOL.future]);

// 기본 수입 — 일일 임무 합성옥 100 · 주간 임무 500 · 섬멸 작전 주 1,800 (주간 상한) · 월정액 켬 · 순오리지늄 환산 켬
// (사용자 지시 2026-10-17 "기본적으로 월정액이랑 오리지늄도 합성옥 바꾼다 체크돼 있어야 함")
const DEF_INCOME: Income = { daily: 100, weekly: 500, anni: 1800, card: true, monthPermit: 0, monthOrundum: 0, monthPrime: 0, useOP: true, cert: false };
const KEY = "ta:gacha-plan";
// 한정 배너 전용 연차 — 기간 중 매일 무료 1회(보통 14일) + 그 배너에서만 쓰는 10회 헤드헌팅권 1장 (사용자 설명 2026-10-17
// "한정 배너는 대부분 하루 1뽑 무료 + 그 한정에서만 쓸 수 있는 10뽑 헤드헌팅권"). 게임 표에 없는 값이라 상수로
const CERT_PULLS = 38;
const LIM_FREE_DAYS = 14, LIM_TICKET = 10;
const LIM_ONLY = LIM_FREE_DAYS + LIM_TICKET;
const DAY = 86400000;
const SIM_EVENTS = new Set(((poolData as unknown as { events?: { id: string }[] }).events ?? []).map((e) => e.id));
const LIMITED = new Set(POOL.limited);
/** 그 줄의 배너로 가챠 시뮬레이터를 연다 (사용자 지시 2026-10-17 "가챠하러 가기 버튼으로 바로 시뮬레이터") —
 *  시뮬레이터 이벤트 배너에 있으면 그 이벤트로, 없으면 픽업 오퍼(직접 더한 일정은 고른 뽑을 오퍼)로. events.tsx gachaHref 와 같은 주소 규칙 */
function simHref(locale: string, r: { id: string; ops: string[]; fut?: boolean; lim?: boolean }, targets: string[], byId: Map<string, Operator>): string | null {
  const five = (ids: string[]) => ids.filter((id) => (byId.get(id)?.rarity ?? 0) >= 5);
  const picks = five(r.ops).length ? five(r.ops) : five(targets);
  if (!SIM_EVENTS.has(r.id) && !picks.length) return null;
  const q = new URLSearchParams(SIM_EVENTS.has(r.id) ? { event: r.id } : { pick: picks.join(",") });
  if (!SIM_EVENTS.has(r.id) && (r.lim || picks.some((id) => LIMITED.has(id)))) q.set("kind", "limited");
  if (r.fut) q.set("future", "1");
  return `${locale === "ko" ? "" : `/${locale}`}/gacha?${q.toString().replace(/%2C/g, ",")}`;
}

function load(): Saved {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Saved; } catch { return {}; }
}
function save(v: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 사생활 보호 창 — 저장 없이 쓴다 */ }
}
/** 오늘(KST) 0시 */
function todayKst(): number {
  const now = new Date(Date.now() + 9 * 3600000);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
const dayOf = (s: string) => Date.parse(`${s}T00:00:00Z`);

export function GachaPlanner({ operators, onShowOperator }: { operators: Operator[]; onShowOperator?: (id: string) => void }) {
  const { locale, t } = useI18n();
  const byId = useMemo(() => new Map(operators.map((o) => [o.id, o])), [operators]);
  const me = useMe();
  const mine = mePulls(me?.profile?.inventory);
  const [saved, setSaved] = useState<Saved>({});
  const [ready, setReady] = useState(false);
  const [whyOpen, setWhyOpen] = useState<string | null>(null);
  // 일정 창 — 새로 추가(true) · 직접 더한 일정 편집(그 일정) · 닫힘(false) (사용자 지시 2026-10-17 "추가한 일정은 편집 기능도")
  const [addOpen, setAddOpen] = useState<boolean | Custom>(false);
  // 저장값은 마운트 뒤에 읽는다 — 프리렌더 HTML 과 첫 렌더가 같아야 해서 (localStorage 는 서버에 없다)
  useEffect(() => { setSaved(load()); setReady(true); }, []);  // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => { if (ready) save(saved); }, [saved, ready]);
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === KEY) setSaved(load()); };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  const income: Income = { ...DEF_INCOME, ...(saved.income ?? {}) };
  // 시작 재화 — 직접 넣은 값이 있으면 그것, 없으면 내 정보(로그인) 값, 그것도 없으면 0
  const start: Start = saved.start ?? (mine ? { orundum: mine.orundum, permit: mine.permit, permit10: mine.permit10, prime: mine.prime } : { orundum: 0, permit: 0, permit10: 0, prime: 0 });
  const fromMe = !saved.start && !!mine;
  const setIncome = (k: keyof Income, v: number | boolean) => setSaved((s) => ({ ...s, income: { ...(s.income ?? {}), [k]: v } }));
  const setStart = (k: keyof Start, v: number) => setSaved((s) => ({ ...s, start: { ...start, [k]: v } }));
  const setSpend = (id: string, v: number) => setSaved((s) => ({ ...s, spend: { ...(s.spend ?? {}), [id]: v } }));
  const [targetOpen, setTargetOpen] = useState<string | null>(null);

  const today = todayKst();
  // 줄 — 데이터 일정 + 사용자 줄, 날짜순
  const rows = useMemo(() => {
    const out: { id: string; name: string; day: number; est: boolean; fut: boolean; ops: string[]; lim: boolean; prime: number; custom?: boolean }[] = [];
    for (const r of PLAN) {
      const conf = confirmedDay(r.id);
      const d = r.start ? dayOf(r.start) : conf ? dayOf(conf) : r.eta ? dayOf(`${r.eta}-15`) : NaN;
      if (!Number.isFinite(d)) continue;
      out.push({ id: r.id, name: r.n[locale] ?? r.n.ko, day: Math.max(d, today), est: !r.start && !conf, fut: !!r.fut, ops: r.ops ?? [], lim: !!r.lim, prime: r.prime ?? 0 });
    }
    for (const c of saved.custom ?? []) {
      const d = dayOf(c.date);
      if (Number.isFinite(d)) out.push({ id: c.id, name: c.name || t("직접 추가한 일정"), day: d, est: false, fut: false, ops: [], lim: false, prime: 0, custom: true });
    }
    return out.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
  }, [saved.custom, locale, today, t]);

  // 그날까지 쌓인 수입 (오늘부터) — 합성옥·허가증
  // 항목별로 쌓는다 — 줄마다 '+N' 이 무엇에서 왔는지 풀어 보인다 (사용자 지시 2026-10-17 "늘어난 가챠는 뭐 때문에 늘어나는지 자세히")
  const parts = (day: number) => {
    const days = Math.max(0, Math.round((day - today) / DAY));
    const weeks = Math.floor(days / 7), months = Math.floor(days / 30);
    return {
      daily: days * income.daily, weekly: weeks * income.weekly, anni: weeks * income.anni, monthOrundum: months * income.monthOrundum,
      card: income.card ? days * 200 : 0, cardPrime: income.card ? months * 6 : 0, permit: months * income.monthPermit,
      monthPrime: months * income.monthPrime,   // 그 밖의 순오리지늄 (사용자 지시 2026-10-17 "그 밖의 오리지늄도")
      // 노란 증표 상점(고급 증표 구역) 헤드헌팅 허가증 사다리 풀매수 — 허가증 1·2·5장 + 10회 허가증 1·2장 = 한 달 38회, 증표 258
      // (PRTS 采购中心/凭证交易所 高级凭证区, 매달 1일 초기화 · 사용자 지시 2026-10-17 "매달 노티로 헤드헌팅권 사는 5단계, 풀매수 전제")
      cert: income.cert ? months * CERT_PULLS : 0,
    };
  };
  const gained = (day: number) => {
    const p = parts(day);
    return { orundum: p.daily + p.weekly + p.anni + p.monthOrundum + p.card, permit: p.permit + p.cert, prime: p.cardPrime + p.monthPrime };
  };

  // 줄마다 남는 재화 — 이벤트 순오리지늄은 그날 들어온다고 보고, 쓸 때는 허가증부터
  const table = useMemo(() => {
    // gain = 앞 일정(첫 줄은 오늘) 뒤로 그날까지 늘어난 연차 — '그날 연차'가 왜 느는지 보이게 (사용자 질문 2026-10-17 "가진 연차는 왜 늘어나")
    type Why = { daily: number; weekly: number; anni: number; monthOrundum: number; card: number; cardPrime: number; permit: number; monthPrime: number; cert: number; eventPrime: number };
    const out: (typeof rows[number] & { before: number; spend: number; only: number; after: number; gain: number; why: Why })[] = [];
    let prevParts = parts(today);
    let prevAfter = Math.floor((start.orundum + (income.useOP ? start.prime * 180 : 0)) / 600) + start.permit + start.permit10 * 10;
    const acc = { orundum: 0, permit: 0, prime: 0 };   // 지금까지 쓴 합성옥·허가증 · 지나간 이벤트의 순오리지늄
    for (const r of rows) {
      acc.prime += r.prime;
      const g = gained(r.day);
      const prime = start.prime + g.prime + acc.prime;
      const orundumBefore = start.orundum + g.orundum + (income.useOP ? prime * 180 : 0) - acc.orundum;
      const permitBefore = start.permit + start.permit10 * 10 + g.permit - acc.permit;
      const before = Math.floor(orundumBefore / 600) + permitBefore;
      const spend = Math.max(0, saved.spend?.[r.id] ?? 0);
      // 한정 배너는 전용 연차(무료 + 전용권)부터 쓰고, 넘는 만큼만 일반 재화에서 — 쓸 때는 허가증부터
      const only = r.lim ? LIM_ONLY : 0;
      const general = Math.max(0, spend - only);
      const usePermit = Math.min(Math.max(0, permitBefore), general);
      acc.permit += usePermit;
      acc.orundum += (general - usePermit) * 600;
      const cur = parts(r.day);
      const why = { daily: cur.daily - prevParts.daily, weekly: cur.weekly - prevParts.weekly, anni: cur.anni - prevParts.anni,
        monthOrundum: cur.monthOrundum - prevParts.monthOrundum, card: cur.card - prevParts.card, cardPrime: cur.cardPrime - prevParts.cardPrime,
        permit: cur.permit - prevParts.permit, monthPrime: cur.monthPrime - prevParts.monthPrime, cert: cur.cert - prevParts.cert, eventPrime: r.prime };
      prevParts = cur;
      out.push({ ...r, before, spend, only, after: before - general, gain: before - prevAfter, why });
      prevAfter = before - general;
    }
    return out;
  }, [rows, saved.spend, start.orundum, start.permit, start.permit10, start.prime, income]);  // eslint-disable-line react-hooks/exhaustive-deps

  const fmtDay = (d: number) => {
    const x = new Date(d);
    return `${x.getUTCFullYear()}.${String(x.getUTCMonth() + 1).padStart(2, "0")}.${String(x.getUTCDate()).padStart(2, "0")}`;
  };
  const totalSpend = table.reduce((n, r) => n + r.spend, 0);
  const last = table[table.length - 1];

  return (
    <section className="explorer tool-explorer gacha gacha-plan" aria-label={t("가챠 플래너")}>
      <div className="filter-panel gacha-panel">
        <div className="panel-heading">
          <div><span className="section-no">PLAN / 01</span><h2>{t("재화와 수입")}</h2></div>
          <button type="button" className="reset" onClick={() => setSaved({})}>↻ {t("초기화")}</button>
        </div>
        <div className="gp-group">
          <h3>{t("지금 가진 재화")}{fromMe && <small>{t("내 정보 계정 값")}</small>}</h3>
          <div className="gp-field"><span>{t("합성옥")}</span><NumInput value={start.orundum} onChange={(v) => setStart("orundum", v)} /></div>
          <div className="gp-field"><span>{t("헤드헌팅 허가증")}</span><NumInput value={start.permit} onChange={(v) => setStart("permit", v)} /></div>
          <div className="gp-field"><span>{t("10회 허가증")}</span><NumInput value={start.permit10} onChange={(v) => setStart("permit10", v)} /></div>
          <div className="gp-field"><span>{t("순오리지늄")}</span><NumInput value={start.prime} onChange={(v) => setStart("prime", v)} /></div>
          {/* 순오리지늄 환산은 재화 쪽 설정 — 가진 것·월정액·이벤트 순오리지늄 전부에 걸린다 (사용자 지시 2026-10-17 "재화 쪽에 있어야") */}
          <label className="gp-check"><input type="checkbox" checked={income.useOP} onChange={(e) => setIncome("useOP", e.target.checked)} />{t("순오리지늄도 합성옥으로 바꿔 쓴다 (1개 = 180)")}</label>
          {saved.start && mine && (
            <button type="button" className="gp-link" onClick={() => setSaved((s) => ({ ...s, start: null }))}>{t("내 정보 계정 값으로 되돌리기")}</button>
          )}
        </div>
        <div className="gp-group">
          <h3>{t("수입")}
            {/* 순오리지늄 환산(useOP)은 재화 칸 설정이라 여기 '되돌리기'와 무관하다 */}
            {saved.income && Object.keys(saved.income).some((k) => k !== "useOP") && (
              <button type="button" className="gp-link" onClick={() => setSaved((s) => ({ ...s, income: s.income?.useOP !== undefined ? { useOP: s.income.useOP } : undefined }))}>{t("기본값으로 되돌리기")}</button>
            )}
          </h3>
          <div className="gp-field"><span>{t("일일 임무 (하루)")}</span><NumInput value={income.daily} onChange={(v) => setIncome("daily", v)} step={10} /></div>
          <div className="gp-field"><span>{t("주간 임무 (한 주)")}</span><NumInput value={income.weekly} onChange={(v) => setIncome("weekly", v)} step={100} /></div>
          <div className="gp-field"><span>{t("섬멸 작전 (한 주)")}</span><NumInput value={income.anni} onChange={(v) => setIncome("anni", v)} step={100} /></div>
          <div className="gp-field"><span title={t("매달 들어오는 양 — 30일마다 더한다")}>{t("그 밖의 합성옥")}</span><NumInput value={income.monthOrundum} onChange={(v) => setIncome("monthOrundum", v)} step={100} /></div>
          <div className="gp-field"><span title={t("매달 들어오는 양 — 30일마다 더한다")}>{t("그 밖의 순오리지늄")}</span><NumInput value={income.monthPrime} onChange={(v) => setIncome("monthPrime", v)} step={1} /></div>
          <div className="gp-field"><span title={t("매달 들어오는 양 — 30일마다 더한다")}>{t("그 밖의 허가증")}</span><NumInput value={income.monthPermit} onChange={(v) => setIncome("monthPermit", v)} step={1} /></div>
          <label className="gp-check"><input type="checkbox" checked={income.card} onChange={(e) => setIncome("card", e.target.checked)} />{t("월정액 (하루 합성옥 200 · 한 달 순오리지늄 6)")}</label>
          <label className="gp-check" title={t("허가증 1·2·5장 + 10회 허가증 1·2장 — 노란 증표 258개, 매달 1일 초기화")}><input type="checkbox" checked={income.cert} onChange={(e) => setIncome("cert", e.target.checked)} />{t("노란 증표 상점 헤드헌팅 허가증 매달 다 산다 (한 달 38회)")}</label>
        </div>
        <p className="gp-note">{t("'그날 연차'는 지금 가진 재화에 그날까지 쌓일 수입(일일·주간 임무, 섬멸, 지난 이벤트의 순오리지늄)을 더하고 앞 일정에서 쓴 만큼을 뺀 값입니다. 그 밑의 +는 앞 일정 뒤로 늘어난 연차입니다.")}</p>
        <p className="gp-note">{t("이벤트 수입은 작전 첫 3성 순오리지늄만 셉니다 — 이벤트 상점·미션의 허가증·합성옥은 게임 데이터에 없어 '그 밖의' 칸에 넣어 주세요. 날짜가 '예상'인 일정은 중국 서버 기준 추정이라 실제와 다를 수 있습니다.")}</p>
      </div>

      <div className="gp-main">
        <div className="gp-summary">
          <div><small>{t("지금 연차")}</small><b>{Math.floor((start.orundum + (income.useOP ? start.prime * 180 : 0)) / 600) + start.permit + start.permit10 * 10}</b></div>
          <div><small>{t("쓸 연차 합계")}</small><b>{totalSpend}</b></div>
          {last && <div className={last.after < 0 ? "bad" : ""}><small>{t("마지막 일정 뒤 남는 연차")}</small><b>{last.after}</b></div>}
        </div>
        {/* 일정 목록 머리 — 오른쪽 위 '일정 추가하기' 를 누르면 창에서 넣는다 (사용자 지시 2026-10-17; 종전엔 목록 맨 밑 입력 줄이라
            달력이 스크롤 목록 안에서 펼쳐지며 무너졌다) */}
        <div className="gp-list-head">
          <b>{t("배너·이벤트 일정")} <em>{table.length}</em></b>
          <button type="button" className="gp-add-btn" onClick={() => setAddOpen(true)}>+ {t("일정 추가하기")}</button>
        </div>
        <ol className="gp-rows">
          {table.map((r) => (
            <li key={r.id} className={`${r.after < 0 ? "short" : ""}${r.lim ? " lim" : ""}`}>
              <div className="gp-when">
                <b>{fmtDay(r.day)}</b>
                {r.est && <em>{t("예상")}</em>}
              </div>
              <div className="gp-what">
                <div className="gp-what-main">
                <span className="gp-name">{r.custom
                  ? <button type="button" className="gp-evlink" title={t("일정 편집")} onClick={() => { const c = (saved.custom ?? []).find((x) => x.id === r.id); if (c) setAddOpen(c); }}>{r.name}</button>
                  : <button type="button" className="gp-evlink" onClick={() => openEvent(r.id)}>{r.name}</button>}{r.lim && <em className="gp-lim">{t("한정")}</em>}{r.fut && !r.custom && <em className="gp-fut">{t("미실장")}</em>}</span>
                {/* 오퍼 — 그 배너의 픽업 + 사용자가 고른 목표(★). 칩을 누르면 오퍼 상세, '뽑을 오퍼' 로 목표를 고른다 */}
                {(() => {
                  const tg = saved.targets?.[r.id] ?? [];
                  const ids = [...r.ops, ...tg.filter((x) => !r.ops.includes(x))];
                  return (
                    <span className="gp-ops">
                      {ids.map((id) => byId.get(id)).filter(Boolean).map((o) => (
                        <span key={o!.id} className="gp-op-wrap">
                          <button type="button" className={`gp-op r${o!.rarity}${tg.includes(o!.id) ? " tgt" : ""}`} title={o!.name} onClick={() => onShowOperator?.(o!.id)}>
                            <img src={asset(o!.image)} alt="" width={28} height={28} loading="lazy" decoding="async" />{tg.includes(o!.id) && <i aria-label={t("목표")}>★</i>}{o!.name}
                          </button>
                          {/* 뽑을 오퍼 지우기 (사용자 지시 2026-10-17) — 픽업 오퍼는 배너 것이라 지울 수 없다, 목표 표시만 뗀다 */}
                          {tg.includes(o!.id) && (
                            <button type="button" className="gp-op-x" aria-label={t("{name} 뽑을 오퍼에서 빼기", { name: o!.name })} title={t("뽑을 오퍼에서 빼기")}
                              onClick={() => setSaved((s) => ({ ...s, targets: { ...(s.targets ?? {}), [r.id]: tg.filter((x) => x !== o!.id) } }))}>×</button>
                          )}
                        </span>
                      ))}
                      <button type="button" className="gp-link gp-tgt-btn" onClick={() => setTargetOpen(r.id)}>{tg.length ? t("뽑을 오퍼 {n}", { n: String(tg.length) }) : t("+ 뽑을 오퍼")}</button>
                    </span>
                  );
                })()}
                {r.custom && (
                  <span className="gp-custom-acts">
                    <button type="button" className="gp-link" onClick={() => { const c = (saved.custom ?? []).find((x) => x.id === r.id); if (c) setAddOpen(c); }}>{t("편집")}</button>
                    <button type="button" className="gp-link" onClick={() => setSaved((s) => ({ ...s, custom: (s.custom ?? []).filter((c) => c.id !== r.id) }))}>{t("이 줄 지우기")}</button>
                  </span>
                )}
                </div>
                {/* 뽑을 오퍼가 있는 줄에만 — 배너 픽업 오퍼가 이미 있거나 사용자가 지정한 줄 (사용자 지시 2026-10-17) */}
                {((saved.targets?.[r.id] ?? []).length > 0 || r.ops.length > 0) && (() => { const href = simHref(locale, r, saved.targets?.[r.id] ?? [], byId); return href && <a className="gp-link gp-sim" href={href}>{t("가챠하러 가기")} <span aria-hidden>→</span></a>; })()}
              </div>
              <div className="gp-have"><small>{t("그날 연차")}</small><b>{r.before}</b>
                {r.only > 0 && <em className="gp-only" title={t("이 한정 배너에서만 — 매일 무료 1회 × {d}일 + 한정 10회 헤드헌팅권", { d: String(LIM_FREE_DAYS) })}>{t("+전용 {n}", { n: String(r.only) })}</em>}
                {r.gain > 0 && <button type="button" className="gp-gain" title={t("늘어난 내역 보기")} onClick={() => setWhyOpen(r.id)}>+{r.gain}</button>}
              </div>
              <div className="gp-spend"><small>{t("쓸 연차")}</small>
                <NumInput value={r.spend} step={10} placeholder="0" onChange={(v) => setSpend(r.id, v)} ariaLabel={t("쓸 연차")} />
              </div>
              <div className="gp-left"><small>{t("남는 연차")}</small><b>{r.after}</b></div>
            </li>
          ))}
        </ol>
        {addOpen && (
          <AddModal key={typeof addOpen === "object" ? addOpen.id : "new"} edit={typeof addOpen === "object" ? addOpen : undefined}
            ops={typeof addOpen === "object" ? saved.targets?.[addOpen.id] ?? [] : []} byId={byId}
            onClose={() => setAddOpen(false)}
            onAdd={(c, ops) => {
              // 같은 id 면 고친 것 — 자리를 그대로 두고 바꾼다. 고른 오퍼는 그 일정의 목표로
              setSaved((s) => ({ ...s,
                custom: (s.custom ?? []).some((x) => x.id === c.id) ? (s.custom ?? []).map((x) => (x.id === c.id ? c : x)) : [...(s.custom ?? []), c],
                targets: { ...(s.targets ?? {}), [c.id]: ops } }));
              setAddOpen(false);
            }}
            onDelete={(id) => {
              setSaved((s) => { const tg = { ...(s.targets ?? {}) }; delete tg[id]; return { ...s, custom: (s.custom ?? []).filter((x) => x.id !== id), targets: tg }; });
              setAddOpen(false);
            }} />
        )}
      </div>
      {targetOpen && (() => {
        const r = table.find((x) => x.id === targetOpen);
        if (!r) return null;
        return <TargetModal key={r.id} title={r.name} pickup={r.ops} chosen={saved.targets?.[r.id] ?? []} byId={byId}
          onSave={(ops) => { setSaved((s) => ({ ...s, targets: { ...(s.targets ?? {}), [r.id]: ops } })); setTargetOpen(null); }} onClose={() => setTargetOpen(null)} />;
      })()}
      {/* '+N' 내역 창 — 그 일정 앞(첫 줄은 오늘)부터 그날까지 들어오는 것 (사용자 지시 2026-10-17 "+12 클릭하면 모달창으로 상세하게") */}
      {(() => {
        const r = table.find((x) => x.id === whyOpen);
        if (!r) return null;
        const w = r.why, f = (n: number) => n.toLocaleString("en-US");
        const idx = table.indexOf(r);
        const from = idx > 0 ? fmtDay(table[idx - 1].day) : t("오늘");
        const lines: [string, string, string][] = [
          [t("일일 임무"), w.daily ? t("합성옥 {n}", { n: f(w.daily) }) : "", t("하루 {n} × {d}일", { n: f(income.daily), d: f(income.daily ? w.daily / income.daily : 0) })],
          [t("주간 임무"), w.weekly ? t("합성옥 {n}", { n: f(w.weekly) }) : "", t("한 주 {n} × {w}주", { n: f(income.weekly), w: f(income.weekly ? w.weekly / income.weekly : 0) })],
          [t("섬멸 작전"), w.anni ? t("합성옥 {n}", { n: f(w.anni) }) : "", t("한 주 {n} × {w}주", { n: f(income.anni), w: f(income.anni ? w.anni / income.anni : 0) })],
          [t("월정액"), w.card ? t("합성옥 {n}", { n: f(w.card) }) + (w.cardPrime ? ` · ${t("순오리지늄 {n}", { n: f(w.cardPrime) })}` : "") : "", t("하루 합성옥 200 · 30일마다 순오리지늄 6")],
          [t("그 밖의 합성옥"), w.monthOrundum ? t("합성옥 {n}", { n: f(w.monthOrundum) }) : "", t("한 달 {n}", { n: f(income.monthOrundum) })],
          [t("노란 증표 상점"), w.cert ? t("{n}회", { n: f(w.cert) }) : "", t("허가증 1·2·5장 + 10회 허가증 1·2장 — 한 달 38회")],
          [t("그 밖의 순오리지늄"), w.monthPrime ? t("순오리지늄 {n}", { n: f(w.monthPrime) }) + (income.useOP ? ` (${t("합성옥 {n}", { n: f(w.monthPrime * 180) })})` : "") : "", t("한 달 {n}", { n: f(income.monthPrime) })],
          [t("그 밖의 허가증"), w.permit ? t("{n}장", { n: f(w.permit) }) : "", t("한 달 {n}장", { n: f(income.monthPermit) })],
          [t("이 이벤트 첫 클리어"), w.eventPrime ? t("순오리지늄 {n}", { n: f(w.eventPrime) }) + (income.useOP ? ` (${t("합성옥 {n}", { n: f(w.eventPrime * 180) })})` : "") : "", t("작전 첫 3성 보상 — 게임 데이터")],
          [t("한정 배너 전용"), r.only ? t("{n}회 (이 배너에서만)", { n: String(r.only) }) : "", t("매일 무료 1회 × {d}일 + 한정 10회 헤드헌팅권 1장", { d: String(LIM_FREE_DAYS) })],
        ].filter((x) => x[1]) as [string, string, string][];
        return (
          <ModalWindow label={`${r.name} · +${r.gain}`} className="operator-modal gp-why-modal" onClose={() => setWhyOpen(null)}>
            <div className="gp-why-body">
              <h3>{r.name}</h3>
              <p className="gp-note">{t("{a} 뒤로 {b}까지 들어오는 것 — 합성옥 600 = 1연차, 허가증 1장 = 1연차", { a: from, b: fmtDay(r.day) })}</p>
              <table className="gp-why-table">
                <tbody>
                  {lines.map(([k, v, how]) => <tr key={k}><th>{k}</th><td>{v}</td><td>{how}</td></tr>)}
                </tbody>
                <tfoot><tr><th>{t("늘어난 연차")}</th><td colSpan={2}>+{r.gain}</td></tr></tfoot>
              </table>
            </div>
          </ModalWindow>
        );
      })()}
    </section>
  );
}

/** 일정 추가 창 — 복각·한정 배너처럼 데이터에 없는 일정 */
function AddModal({ edit, ops: initOps = [], byId, onAdd, onClose, onDelete }: {
  edit?: Custom; ops?: string[]; byId: Map<string, Operator>; onAdd: (c: Custom, ops: string[]) => void; onClose: () => void; onDelete: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const [minDay] = useState(() => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10));   // 오늘(KST) 부터만
  const [name, setName] = useState(edit?.name ?? "");
  const [date, setDate] = useState(edit?.date ?? "");
  // 뽑을 오퍼 — 일정 추가·편집 창에서도 고른다 (사용자 지시 2026-10-17 "일정 추가하기 모달에도 오퍼 추가하기")
  const [ops, setOps] = useState<string[]>(initOps);
  const title = edit ? t("일정 편집") : t("일정 추가하기");
  return (
    <ModalWindow label={title} className="operator-modal gp-add-modal" onClose={onClose}>
      <form className="gp-add" onSubmit={(e) => {
        e.preventDefault();
        if (!date) return;
        onAdd({ id: edit?.id ?? `c${Date.now().toString(36)}`, name: name.trim(), date }, ops);
      }}>
        <h3>{title}</h3>
        <p className="gp-note">{t("복각·한정 배너처럼 목록에 없는 일정을 넣습니다. 이 브라우저에만 저장됩니다.")}</p>
        <label className="gp-add-field"><span>{t("일정 이름")}</span>
          <input type="text" value={name} placeholder={t("예: 복각 배너")} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="gp-add-field"><span>{t("날짜")}</span>
          {/* 날짜는 공용 달력(app/date-picker.tsx) */}
          <DatePicker value={date} onChange={setDate} min={edit && edit.date < minDay ? edit.date : minDay}
            ariaLabel={t("일정 날짜")} placeholder={t("날짜 고르기")} locale={locale} />
        </div>
        <div className="gp-add-ops">
          <span className="gp-add-label">{t("뽑을 오퍼")}</span>
          <OpPicker value={ops} byId={byId} onChange={setOps} />
        </div>
        <div className="gp-add-actions">
          {edit && <button type="button" className="danger" onClick={() => onDelete(edit.id)}>{t("삭제")}</button>}
          <button type="button" onClick={onClose}>{t("취소")}</button>
          <button type="submit" className="primary" disabled={!date}>{edit ? t("저장") : t("추가")}</button>
        </div>
      </form>
    </ModalWindow>
  );
}

/** 뽑을 오퍼 자리 — 가챠 시뮬레이터의 픽업 자리와 같은 방식 (사용자 지시 2026-10-17 "6성 5성 카드 비어있음 더하는 그 방식 그대로").
 *  성급마다 빈 자리 카드를 깔고, 누르면 그 성급 목록(검색)에서 고른다. '+ 자리 추가' 로 늘리고, 목록 맨 위 '비우기'·'자리 빼기'.
 *  이 배너 픽업은 목록 맨 위에. 값은 부모의 임시 상태로만 — 창의 저장 단추를 눌러야 적용된다 */
const DROP_SLOT = "__drop";
function OpPicker({ pickup = [], value, byId, onChange }: {
  pickup?: string[]; value: string[]; byId: Map<string, Operator>; onChange: (ops: string[]) => void;
}) {
  const { t } = useI18n();
  // 자리 — 빈 자리("")도 칸으로 남긴다. 처음엔 고른 오퍼 + 성급마다 최소 한 칸
  const [slots, setSlots] = useState<Record<5 | 6, string[]>>(() => {
    const of = (r: number) => value.filter((id) => byId.get(id)?.rarity === r);
    const s6 = of(6), s5 = of(5);
    return { 6: s6.length ? s6 : [""], 5: s5.length ? s5 : [""] };
  });
  const [openNew, setOpenNew] = useState<{ r: 5 | 6; i: number } | null>(null);
  const lists = useMemo(() => {
    const all = [...GACHAABLE].map((id) => byId.get(id)).filter((o): o is Operator => !!o);
    const sort = (a: Operator, b: Operator) => Number(pickup.includes(b.id)) - Number(pickup.includes(a.id)) || b.seq - a.seq;
    return { 6: all.filter((o) => o.rarity === 6).sort(sort), 5: all.filter((o) => o.rarity === 5).sort(sort) };
  }, [byId, pickup]);
  const commit = (next: Record<5 | 6, string[]>) => {
    setSlots(next);
    // 4·3성 목표(예전 저장분)는 자리에 안 보여도 그대로 둔다
    const rest = value.filter((id) => { const r = byId.get(id)?.rarity; return r !== 5 && r !== 6; });
    onChange([...next[6], ...next[5]].filter(Boolean).concat(rest));
  };
  const setSlot = (r: 5 | 6, i: number, id: string) => {
    if (id === DROP_SLOT) { commit({ ...slots, [r]: slots[r].filter((_, j) => j !== i) }); return; }
    const row = slots[r].map((x) => (x === id ? "" : x));
    row[i] = id;
    commit({ ...slots, [r]: row });
  };
  // 막 늘린 자리를 그려진 뒤 열어 준다 — 시뮬레이터와 같은 동작
  useEffect(() => {
    if (!openNew) return;
    const row = document.querySelector<HTMLElement>(`.gp-slots .gacha-slots[data-r="${openNew.r}"]`);
    row?.querySelectorAll<HTMLButtonElement>(".drop .gacha-slot")[openNew.i]?.click();
    setOpenNew(null); // eslint-disable-line react-hooks/set-state-in-effect
  }, [openNew]);
  return (
    <div className="gacha gp-slots">
      {([6, 5] as const).map((r) => (
        <div key={r} className="gacha-slots" data-r={r}>
          <small className="gacha-slots-label">{r === 6 ? t("6성") : t("5성")}</small>
          <div className="gacha-slots-row">
            {slots[r].map((id, i) => {
              const o = id ? byId.get(id) : undefined;
              return (
                <Dropdown key={i} ariaLabel={t("{r}성 {n}번째 자리", { r, n: i + 1 })} scroll className="gacha-slot-wrap" buttonClassName={`gacha-slot r${r}${o ? " filled" : ""}`}
                  label={o
                    ? <>{pickup.includes(o.id) && <em className="gacha-badge">{t("픽업")}</em>}<img src={asset(o.image)} alt="" width={58} height={58} /><b>{o.name}</b><small>{r}★</small></>
                    : <><small>{r}★</small><span>{t("비어있음")}</span></>}
                  search={t("오퍼 이름 검색")} anchor=".gacha-slots"
                  items={[...(o ? [{ value: "", label: t("비우기") }] : []), ...(slots[r].length > 1 ? [{ value: DROP_SLOT, label: t("자리 빼기") }] : []),
                    ...lists[r].map((x) => ({ value: x.id, searchText: x.name,
                      label: <>{x.name}{pickup.includes(x.id) && <em className="gacha-limited">{t("픽업")}</em>}{x.unreleased && <em className="gacha-future">{t("미실장")}</em>}</>,
                      icon: <img src={asset(x.image)} alt="" width={22} height={22} /> }))]}
                  selected={id ? [id] : []} onPick={(v) => setSlot(r, i, v)} />
              );
            })}
            <button type="button" className={`gacha-slot add r${r}`} aria-label={t("{r}성 자리 추가", { r })}
              onClick={() => { setSlots((s) => ({ ...s, [r]: [...s[r], ""] })); setOpenNew({ r, i: slots[r].length }); }}>
              <b aria-hidden>+</b><span>{t("자리 추가")}</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 뽑을 오퍼(목표) 고르기 창 — 저장을 눌러야 적용된다 (사용자 지시 2026-10-17) */
function TargetModal({ title, pickup, chosen, byId, onSave, onClose }: {
  title: string; pickup: string[]; chosen: string[]; byId: Map<string, Operator>; onSave: (ops: string[]) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [ops, setOps] = useState(chosen);
  return (
    <ModalWindow label={t("뽑을 오퍼 고르기")} className="operator-modal gp-tgt-modal" onClose={onClose}>
      <div className="gp-tgt-body">
        <h3>{t("뽑을 오퍼 고르기")} <small>{title}</small></h3>
        <OpPicker pickup={pickup} value={ops} byId={byId} onChange={setOps} />
        <div className="gp-add-actions">
          <button type="button" onClick={onClose}>{t("취소")}</button>
          <button type="button" className="primary" onClick={() => onSave(ops)}>{t("저장")}</button>
        </div>
      </div>
    </ModalWindow>
  );
}
