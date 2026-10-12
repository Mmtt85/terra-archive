"use client";

// 헤드헌팅(가챠) 시뮬레이터 — /gacha (2026-10-12, 제안 0a84bd2f "가챠 되기 전에 미리 재미로 돌려 보는").
// 확률 출처 (사용자 지시 2026-10-12 "외부 사이트가 아니라 게임 내 데이터로"):
//  · 성급별 기본 확률·첫 N회 5성 보장 = **게임 데이터**(gacha_table — 배너 상세 안내 문구·guarantee5Count)를
//    scripts/build-gacha-pool.py 가 읽어 gacha-pool.json 에 싣는다. 패치로 바뀌면 같이 바뀐다.
//  · 6성 천장(50회 이후 1회마다 +2%, 나머지 성급은 비율대로 줄어듦)·픽업 비율(통상 50% · 한정 70% · 5성 50%)은
//    게임 표에 **없다** — 게임 안 배너 '상세 정보'(서버가 내려 주는 공지)의 규칙이라 아래 상수로 둔다.
// 풀(app/data/gacha-pool.json, scripts/build-gacha-pool.py): '인재 채용' 오퍼에서 한정·콜라보를 뺀 것.
// ⚠ 게임 데이터에 일반·한정 배너의 픽업이 없어 픽업은 사용자가 고른다. 한정 배너의 '지난 한정 5배 가중'은 넣지 않았다.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usedFontCss } from "./font-css";
import { asset } from "./assets";
import { type Operator } from "./home";
import { useI18n } from "./i18n";
import { Dropdown } from "./dropdown";
import { ModalWindow } from "./modal-window";
import { usePageHelp } from "./page-help";
import { mePulls, useMe } from "./me-store";
import poolData from "./data/gacha-pool.json";

type Rarity = 3 | 4 | 5 | 6;
// 배너는 통상·한정 둘 (사용자 지시 2026-10-12 — 단일 픽업은 통상에 6성 하나만 넣으면 된다)
type BannerKind = "standard" | "limited";
const POOL = poolData as { rates: Record<"3" | "4" | "5" | "6", number>; guarantee5: number; pool: Record<"3" | "4" | "5" | "6", string[]>; limited: string[]; collab: string[];
  /** 이벤트 배너 — 이벤트와 함께 나온 신규 5·6성, 최신(미실장 포함)부터 (build-gacha-pool.py) */
  events: { id: string; n: Record<"ko" | "en" | "ja", string>; ops: string[]; fut?: 1; eta?: string; start?: string }[] };
const BASE: Record<Rarity, number> = { 6: POOL.rates["6"], 5: POOL.rates["5"], 4: POOL.rates["4"], 3: POOL.rates["3"] };
// 게임 안 배너 상세 정보의 규칙 (게임 표에 없는 값)
const PITY_FROM = 50;    // 6성 없이 이만큼 뽑은 뒤부터
const PITY_STEP = 0.02;  // 1회마다 6성 확률 +2%
const SIX_SHARE: Record<BannerKind, number> = { standard: 0.5, limited: 0.7 };
// 픽업 자리 최대 수 — 처음엔 한 자리씩 깔고 '+'로 늘린다 (사용자 지시 2026-10-12 "한정 둘에 통상 하나 · 4중 픽업 특별 배너도 있다").
// 사실상 제한 없이(패널이 넘치지 않게 8) — 6성 픽업 몫(50%·한정 70%)은 고른 오퍼끼리 똑같이 나눈다.
// 비워 둔 픽업은 그만큼 일반 출현
const SIX_SLOTS: Record<BannerKind, number> = { standard: 8, limited: 8 };
const FIVE_SLOTS: Record<BannerKind, number> = { standard: 8, limited: 8 };
const DROP_SLOT = "__drop";

type Pull = { id: string; rarity: Rarity; pickup: boolean; n: number };

/** n번째 뽑기의 성급 확률 — since6 = 직전 6성 이후 뽑은 횟수 */
function rates(since6: number): Record<Rarity, number> {
  const six = Math.min(1, BASE[6] + Math.max(0, since6 - (PITY_FROM - 1)) * PITY_STEP);
  const rest = (1 - six) / (1 - BASE[6]);
  return { 6: six, 5: BASE[5] * rest, 4: BASE[4] * rest, 3: BASE[3] * rest };
}

export function GachaSim({ operators, onShowOperator, includeFuture }: { operators: Operator[]; onShowOperator?: (id: string) => void; includeFuture?: boolean }) {
  const { locale, t } = useI18n();
  const byId = useMemo(() => new Map(operators.map((o) => [o.id, o])), [operators]);
  const [kind, setKind] = useState<BannerKind>("standard");
  const [six, setSix] = useState<string[]>([]);
  const [five, setFive] = useState<string[]>([]);
  // 성급별로 깔아 둔 자리 수 (1 ~ SIX_SLOTS/FIVE_SLOTS)
  const [n6, setN6] = useState(1);
  const [n5, setN5] = useState(1);
  // '자리 추가'로 막 생긴 자리 — 그려진 뒤 그 자리 단추를 눌러 목록을 바로 연다 (사용자 지시 2026-10-12)
  const openSlot = useRef<{ r: 5 | 6; i: number } | null>(null);
  /** 픽업을 통째로 채운다 — 이벤트 배너·이벤트 상세의 '가챠 돌려 보기' */
  const applyPicks = (raw: string[], k: BannerKind) => {
    const ids = raw.filter((id) => byId.has(id));
    if (!ids.length) return;
    const s6 = ids.filter((id) => byId.get(id)!.rarity === 6), s5 = ids.filter((id) => byId.get(id)!.rarity === 5);
    setKind(k); reset();
    setSix(s6); setFive(s5);
    setN6(Math.min(SIX_SLOTS[k], Math.max(1, s6.length))); setN5(Math.min(FIVE_SLOTS[k], Math.max(1, s5.length)));
  };
  // 이벤트 배너 — 고르면 그 이벤트의 신규 5·6성으로 픽업을 채운다. 한정이 끼면 한정 배너 (사용자 지시 2026-10-12)
  const [eventId, setEventId] = useState("");
  const pickEvent = (id: string) => {
    const ev = POOL.events.find((e) => e.id === id);
    if (!ev) return;
    applyPicks(ev.ops, ev.ops.some((x) => POOL.limited.includes(x)) ? "limited" : "standard");
    setEventId(id);
  };
  // 결과를 이미지로 (사용자 지시 2026-10-12) — 내 정보 공유 카드와 같은 변환기. 찍는 동안만 스크롤 상자를 펼쳐(.gacha-shooting)
  // 6성 기록·카드가 잘리지 않게 하고, 리셋·저장 단추는 빼고, 맨 밑에 사이트 이름 한 줄
  // 바로 내려받지 않고 미리보기 창 → 복사·PNG 저장 (같은 날 지시 — 내 정보 '이미지로 내보내기'와 같은 창)
  const resultsRef = useRef<HTMLDivElement>(null);
  const [shooting, setShooting] = useState(false);
  const [shot, setShot] = useState<{ url: string; blob: Blob } | null>(null);
  const [shotOpen, setShotOpen] = useState(false);
  const [shotFailed, setShotFailed] = useState(false);
  const [shotMsg, setShotMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);
  const closeShot = () => { if (shot) URL.revokeObjectURL(shot.url); setShot(null); setShotOpen(false); setShotFailed(false); setShotMsg(null); };
  const saveShot = () => {
    if (!shot) return;
    const a = document.createElement("a");
    a.href = shot.url;
    a.download = `terra-archive-gacha-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  };
  const copyShot = async () => {
    try {
      if (!shot) throw new Error("blob");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": shot.blob })]);
      setShotMsg(null);
      setToast({ text: t("이미지를 클립보드에 복사했습니다."), key: Date.now() });
    } catch { setShotMsg(t("이 브라우저에서는 복사할 수 없습니다 — PNG로 저장해 주세요.")); }
  };
  const exportImage = async () => {
    const el = resultsRef.current;
    if (!el || shooting) return;
    setShooting(true);
    setShotOpen(true); setShotFailed(false); setShotMsg(null);
    el.classList.add("gacha-shooting");
    try {
      await Promise.all(Array.from(el.querySelectorAll("img")).map((img) => (img.complete ? null : img.decode().catch(() => null))));
      const { domToBlob } = await import("modern-screenshot");
      const blob = await domToBlob(el, {
        scale: 2, type: "image/png", timeout: 1500,
        font: { cssText: usedFontCss(el) },
        // 그리드 <img> 가 남긴 CORS 없는 캐시 응답을 다시 쓰지 않게 ?cors 로 따로 받는다 (me-share·편성표 이미지와 같은 규약).
        // ⚠ R2 는 사이트 도메인에만 CORS 를 열어 두어 localhost(dev)에선 그림이 빈 칸으로 찍힌다 — 라이브에서 확인
        fetchFn: async (u) => {
          if (!/^https:\/\/files\.terra-archive\.net\//.test(u)) return false;
          try {
            const r = await fetch(`${u}${u.includes("?") ? "&" : "?"}cors`, { mode: "cors" });
            if (!r.ok) return false;
            const b = await r.blob();
            return await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(b); });
          } catch { return false; }
        },
        fetch: { requestInit: { mode: "cors" } },
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        filter: (n) => !(n instanceof HTMLElement && n.classList.contains("gacha-noshot")),
      });
      setShot({ url: URL.createObjectURL(blob), blob });
    } catch { setShotFailed(true); } finally {
      el.classList.remove("gacha-shooting");
      setShooting(false);
    }
  };
  const evDate = (e: (typeof POOL.events)[number]) => (e.fut ? `${t("미실장")}${e.eta ? ` · ${e.eta}` : ""}` : e.start ?? "");
  // 렌더가 끝난 뒤 — 막 늘린 자리가 그려졌으면 그 단추를 누른다 (상태가 아니라 ref: 이펙트 안 setState 를 피하는 하우스 규칙)
  useEffect(() => {
    const want = openSlot.current;
    if (!want) return;
    const row = [...document.querySelectorAll<HTMLElement>(`.gacha-slots[data-r="${want.r}"]`)].find((el) => el.offsetParent);
    const btn = row?.querySelectorAll<HTMLButtonElement>(".drop .gacha-slot")[want.i];
    if (!btn) return;
    openSlot.current = null;
    btn.click();
  });
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [since6, setSince6] = useState(0);
  const [last, setLast] = useState<Pull[]>([]);

  const poolOf = (r: Rarity) => POOL.pool[String(r) as "3"].filter((id) => byId.has(id));
  const reset = () => { setPulls([]); setSince6(0); setLast([]); };

  // 픽업 후보 — 6성·5성 전부(한정·콜라보 포함: 한정 배너의 픽업은 한정 오퍼다)
  // 픽업 후보 — 통상 배너엔 한정·콜라보가 픽업으로 나오지 않는다. 한정 배너는 한정 오퍼를 위에 (최신 출시순)
  const special = useMemo(() => new Set([...POOL.limited, ...POOL.collab]), []);
  const lim = useMemo(() => new Set(POOL.limited), []);
  // 미래시를 켜면 미실장(중섭 선행) 오퍼도 픽업 후보에 — 앞으로 올 배너를 미리 돌려 보기 (사용자 지시 2026-10-12)
  const live = operators.filter((o) => (includeFuture || !o.unreleased) && (kind === "limited" || !special.has(o.id)));
  const sixList = live.filter((o) => o.rarity === 6).sort((a, b) => (kind === "limited" ? Number(lim.has(b.id)) - Number(lim.has(a.id)) : 0) || b.seq - a.seq);
  const fiveList = live.filter((o) => o.rarity === 5).sort((a, b) => b.seq - a.seq);
  /** 픽업 자리 i 에 넣기 — id 가 "" 면 비우기. 같은 오퍼가 다른 자리에 있으면 그 자리는 비운다 */
  const setSlot = (r: 5 | 6, i: number, id: string) => {
    if (id === DROP_SLOT) {   // 자리 빼기 — 그 자리를 지우고 뒤 자리를 당긴다
      (r === 6 ? setSix : setFive)((cur) => cur.filter((_, j) => j !== i));
      (r === 6 ? setN6 : setN5)((n) => Math.max(1, n - 1));
      reset();
      return;
    }
    (r === 6 ? setSix : setFive)((cur) => {
      const next = cur.map((x) => (x === id ? "" : x));
      while (next.length <= i) next.push("");
      next[i] = id;
      return next;
    });
    reset();
  };
  const pickKind = (k: BannerKind) => {
    // 배너를 바꾸면 고른 픽업도 비운다 (사용자 지시 2026-10-12 "배너를 바꾸면 입력해 둔 조건을 리셋")
    setKind(k); reset(); setSix([]); setFive([]); setN6(1); setN5(1); setEventId("");
  };
  const KIND_LABEL = (k: BannerKind) => t(k === "standard" ? "통상 (6성 픽업 50%)" : "한정 (6성 픽업 70%)");
  // 확률 안내는 페이지 머리 '?' 로 여는 창 (사용자 지시 2026-10-12 — 다른 시뮬레이터와 같은 자리)
  const [showGuide, setShowGuide] = useState(false);
  usePageHelp("gacha", () => setShowGuide(true)); // 다른 시뮬레이터와 같은 꼴 (farm·sim)
  const me = useMe();
  const mine = mePulls(me?.profile?.inventory);
  const sixPick = six.slice(0, Math.min(n6, SIX_SLOTS[kind])).filter(Boolean);
  const fivePick = five.slice(0, Math.min(n5, FIVE_SLOTS[kind])).filter(Boolean);

  const pull = (count: number) => {
    let s6 = since6;
    const out: Pull[] = [];
    const base = pulls.length;
    let had5 = pulls.slice(0, POOL.guarantee5).some((p) => p.rarity >= 5);
    for (let i = 0; i < count; i++) {
      const nth = base + i + 1;
      const r6 = rates(s6);
      let roll = Math.random();
      let rarity: Rarity = 3;
      for (const rr of [6, 5, 4, 3] as Rarity[]) { if (roll < r6[rr]) { rarity = rr; break; } roll -= r6[rr]; }
      // 첫 10연 5성 이상 보장
      if (POOL.guarantee5 && nth === POOL.guarantee5 && !had5 && rarity < 5) rarity = 5;
      if (nth <= POOL.guarantee5 && rarity >= 5) had5 = true;
      const picks = rarity === 6 ? sixPick : rarity === 5 ? fivePick : [];
      const share = rarity === 6 ? SIX_SHARE[kind] : rarity === 5 ? 0.5 : 0;
      let id: string;
      let pickup = false;
      if (picks.length && Math.random() < share) { id = picks[Math.floor(Math.random() * picks.length)]; pickup = true; }
      else {
        const pool = poolOf(rarity).filter((x) => !picks.includes(x));
        id = pool[Math.floor(Math.random() * pool.length)] ?? picks[0] ?? "";
      }
      out.push({ id, rarity, pickup, n: nth });
      s6 = rarity === 6 ? 0 : s6 + 1;
    }
    setPulls((cur) => [...cur, ...out]);
    setSince6(s6);
    setLast(out);
  };

  const count = (r: Rarity) => pulls.filter((p) => p.rarity === r).length;
  const sixes = pulls.filter((p) => p.rarity === 6);
  const nextSix = rates(since6)[6];
  // 섬네일을 누르면 오퍼 상세 모달 (사용자 지시 2026-10-12)
  const showProps = (id: string) => onShowOperator && byId.has(id) ? {
    role: "button", tabIndex: 0, title: t("{name} 상세 정보", { name: byId.get(id)!.name }),
    onClick: () => onShowOperator(id),
    onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onShowOperator(id); } },
  } : {};

  // 이벤트 상세 '가챠 돌려 보기'에서 왔으면(?pick=id,id&kind=limited) 그 픽업으로 채워 둔다 (사용자 지시 2026-10-12)
  // 주소창은 프리렌더 때 못 읽으니 마운트 뒤에 한 번 채운다 — 이 한 번의 setState 만 규칙을 지정 억제한다
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ev = POOL.events.find((e) => e.id === q.get("event"));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ev) { pickEvent(ev.id); return; }
    applyPicks((q.get("pick") ?? "").split(","), q.get("kind") === "limited" ? "limited" : "standard");
  }, [byId]); // eslint-disable-line react-hooks/exhaustive-deps
  // 다른 시뮬레이터와 같은 틀 — 왼쪽 설정 칸(.filter-panel), 오른쪽 결과(.results) (사용자 지시 2026-10-12)
  return (
    <section className="explorer tool-explorer gacha" aria-label={t("가챠 시뮬레이터")}>
      <div className="filter-panel gacha-panel">
        <div className="panel-heading">
          <div><span className="section-no">BANNER / 01</span><h2>{t("배너 설정")}</h2></div>
          {/* 배너·픽업 초기화 — 다른 화면 패널 머리의 '↻ 초기화'와 같은 자리 (사용자 지시 2026-10-12) */}
          <button type="button" className="reset" onClick={() => pickKind("standard")}>↻ {t("초기화")}</button>
        </div>
        {/* 배너·픽업은 드롭다운 단추로 (사용자 지시 2026-10-12 "버튼 누르고 찾기 또 누르지 말고 드롭다운으로") — 공용 Dropdown.
            픽업도 하나 고를 때마다 목록을 닫는다 (같은 날 "클릭하면 리스트가 사라져야지") — multi 를 쓰지 않는다 */}
        <div className="gacha-setup">
          <Dropdown ariaLabel={t("배너 종류")} label={<><small>{t("배너")}</small> {KIND_LABEL(kind)}</>}
            items={(["standard", "limited"] as BannerKind[]).map((k) => ({ value: k, label: KIND_LABEL(k) }))}
            selected={[kind]} onPick={(v) => pickKind(v as BannerKind)} />
          {/* 이벤트 배너 — 이벤트와 함께 나온 신규 오퍼로 픽업을 한 번에 (최신 미실장 이벤트부터) */}
          <Dropdown ariaLabel={t("이벤트 배너")} scroll search={t("이벤트·오퍼 이름 검색")} className="gacha-event-drop"
            label={<><small>{t("이벤트")}</small> {POOL.events.find((e) => e.id === eventId)?.n[locale] ?? t("이벤트 배너에서 고르기")}</>}
            items={POOL.events.map((e) => ({
              value: e.id, searchText: `${e.n[locale]} ${e.n.ko} ${e.ops.map((x) => byId.get(x)?.name ?? "").join(" ")}`,
              icon: byId.get(e.ops.find((x) => byId.get(x)?.rarity === 6) ?? e.ops[0]) ? <img src={asset(byId.get(e.ops.find((x) => byId.get(x)?.rarity === 6) ?? e.ops[0])!.image)} alt="" width={22} height={22} /> : undefined,
              label: <>{e.n[locale]}<small className="gacha-ev-sub">{evDate(e)} · {e.ops.map((x) => byId.get(x)?.name).filter(Boolean).join("·")}</small></>,
              className: e.fut ? "gacha-ev-fut" : undefined,
            }))}
            selected={eventId ? [eventId] : []} onPick={pickEvent} />
          {/* 픽업 자리 — 배너에 맞춰 6성·5성 빈 자리를 미리 깔고, 누르면 그 성급 목록 (사용자 지시 2026-10-12 "드롭다운 박스 말고 자리를 만들어 놓고").
              채운 자리는 가챠 결과 카드와 같은 모양 (같은 날 지시) — 위 색띠·섬네일·이름·성급, 한정은 왼쪽 위 뱃지.
              목록은 공용 Dropdown 의 목록을 그대로 — 단추만 자리 카드로 그린다. 맨 위 '비우기' 로 자리를 비운다 */}
          {([6, 5] as const).map((r) => (
            <div key={r} className="gacha-slots" data-r={r}>
              <small className="gacha-slots-label">{r === 6 ? t("6성 픽업") : t("5성 픽업")}</small>
              <div className="gacha-slots-row">
                {Array.from({ length: Math.min(r === 6 ? n6 : n5, r === 6 ? SIX_SLOTS[kind] : FIVE_SLOTS[kind]) }, (_, i) => {
                  const id = (r === 6 ? six : five)[i] || "";
                  const o = id ? byId.get(id) : undefined;
                  const list = r === 6 ? sixList : fiveList;
                  return (
                    <Dropdown key={i} ariaLabel={t("{r}성 픽업 {n}번째 자리", { r, n: i + 1 })} scroll className="gacha-slot-wrap" buttonClassName={`gacha-slot r${r}${o ? " filled" : ""}`}
                      label={o
                        ? <>{POOL.limited.includes(o.id) && <em className="gacha-badge">{t("한정")}</em>}<img src={asset(o.image)} alt="" width={58} height={58} /><b>{o.name}</b><small>{r}★</small></>
                        : <><small>{r}★</small><span>{t("비어있음")}</span></>}
                      search={t("오퍼 이름 검색")} anchor=".gacha-slots"
                      items={[...(o ? [{ value: "", label: t("비우기") }] : []), ...(i > 0 ? [{ value: DROP_SLOT, label: t("자리 빼기") }] : []), ...list.map((x) => ({ value: x.id, searchText: x.name,
                        label: <>{x.name}{POOL.limited.includes(x.id) && <em className="gacha-limited">{t("한정")}</em>}{x.unreleased && <em className="gacha-future">{t("미실장")}</em>}</>,
                        icon: <img src={asset(x.image)} alt="" width={22} height={22} /> }))]}
                      selected={id ? [id] : []} onPick={(v) => setSlot(r, i, v)} />
                  );
                })}
                {(r === 6 ? n6 : n5) < (r === 6 ? SIX_SLOTS[kind] : FIVE_SLOTS[kind]) && (
                  <button type="button" className={`gacha-slot add r${r}`} onClick={() => { const n = r === 6 ? n6 : n5; (r === 6 ? setN6 : setN5)(n + 1); openSlot.current = { r, i: n }; }}
                    aria-label={t("{r}성 픽업 자리 추가", { r })}>
                    <b aria-hidden>+</b><span>{t("자리 추가")}</span>
                  </button>
                )}
              </div>
            </div>
          ))}
          {sixPick.length + fivePick.length === 0 && <small className="gacha-hint">{t("픽업 오퍼를 고르지 않으면 해당 성급에서 고르게 나옵니다")}</small>}
        </div>
      <div className="gacha-actions">
        <button type="button" className="gacha-pull" onClick={() => pull(1)}>{t("1회 가챠")}</button>
        <button type="button" className="gacha-pull ten" onClick={() => pull(10)}>{t("10회 가챠")}</button>
        {/* 몰아 돌리기 (사용자 지시 2026-10-12) — 결과는 5성 이상만 카드로, 나머지는 개수로 */}
        <button type="button" className="gacha-pull" onClick={() => pull(100)}>{t("{n}회", { n: 100 })}</button>
        <button type="button" className="gacha-pull" onClick={() => pull(300)}>{t("{n}회", { n: 300 })}</button>
        {/* 내 정보를 동기화해 두었으면 가진 재화만큼 한 번에 (사용자 지시 2026-10-12) — 순오리지늄까지 합성옥으로 바꾼 횟수 */}
        {mine && mine.all > 0 && (
          <button type="button" className="gacha-pull mine" onClick={() => pull(mine.all)}
            title={t("합성옥 600개 = 1회 · 헤드헌팅 허가증 1장 = 1회 · 10회 허가증 1장 = 10회 · 순오리지늄 1개 = 합성옥 180개")}>
            {t("내 재화로 {n}회", { n: mine.all.toLocaleString() })}
            <small>{t("합성옥 {a} · 허가증 {b} · 10회 허가증 {c}", { a: Math.floor(mine.orundum / 600), b: mine.permit, c: mine.permit10 * 10 })}{mine.prime > 0 && ` · ${t("순오리지늄 {n}", { n: mine.all - mine.pulls })}`}</small>
          </button>
        )}
      </div>
      </div>
      <div className="results" ref={resultsRef}>
        {/* 이미지에만 — 무슨 배너·이벤트·픽업으로 돌렸는지 (사용자 지시 2026-10-12) */}
        <div className="gacha-shot-head" aria-hidden>
          <b>{KIND_LABEL(kind)}{eventId && POOL.events.find((e) => e.id === eventId) && <> · {POOL.events.find((e) => e.id === eventId)!.n[locale]}</>}</b>
          {sixPick.length > 0 && <span><em className="r6">6★ {t("픽업")}</em> {sixPick.map((id) => byId.get(id)?.name ?? id).join(" · ")}</span>}
          {fivePick.length > 0 && <span><em className="r5">5★ {t("픽업")}</em> {fivePick.map((id) => byId.get(id)?.name ?? id).join(" · ")}</span>}
          {!sixPick.length && !fivePick.length && <span>{t("픽업 없음")}</span>}
        </div>
        <div className="results-heading">
          <div><span className="section-no">RESULT / 02</span><div className="rh-title"><h2>{t("가챠 결과")}</h2>
            {/* 누적 통계 — 제목 오른쪽 한 줄 (사용자 지시 2026-10-12) */}
            <p className="gacha-stats">
              <span>{t("누적 {n}회", { n: pulls.length })}</span>
              <span className="r6">6★ {count(6)}</span>
              <span className="r5">5★ {count(5)}</span>
              <span>{t("6성 없이 {n}회 · 다음 6성 확률 {p}%", { n: since6, p: (nextSix * 100).toFixed(0) })}</span>
              {/* 결과만 처음부터 — 통계 줄 오른끝이라야 '무엇의 처음부터'인지 보인다 (사용자 지시 2026-10-12) */}
              <button type="button" className="gacha-reset gacha-export gacha-noshot" onClick={() => void exportImage()} disabled={!pulls.length || shooting}>⤓ {t("이미지로 내보내기")}</button>
              <button type="button" className="gacha-reset gacha-noshot" onClick={reset} disabled={!pulls.length}>↻ {t("가챠 결과 리셋")}</button>
            </p>
          </div></div>
        </div>
        <div className="results-scroll gacha-out">
          <div className="gacha-main">
      {last.length > 10 && (
        <p className="gacha-bulk">
          {t("이번 {n}회", { n: last.length })} · <span className="r6">6★ {last.filter((p) => p.rarity === 6).length}</span> · <span className="r5">5★ {last.filter((p) => p.rarity === 5).length}</span>
          {" · "}4★ {last.filter((p) => p.rarity === 4).length} · 3★ {last.filter((p) => p.rarity === 3).length}
          <small> — {t("5성 이상만 카드로 보여요")}</small>
        </p>
      )}
      {last.length > 0 && (
        <ol className="gacha-results" aria-label={t("이번 결과")}>
          {(last.length > 10 ? last.filter((p) => p.rarity >= 5) : last).map((p) => {
            const o = byId.get(p.id);
            return (
              <li key={p.n} className={`gacha-card r${p.rarity}${p.pickup ? " pickup" : ""}${onShowOperator ? " link" : ""}`} {...showProps(p.id)}>
                {/* 픽업으로 지정한 오퍼가 나오면 배지 (사용자 지시 2026-10-12) */}
                {p.pickup && <em className="gacha-badge">{t("픽업 중")}</em>}
                {o && <img src={asset(o.image)} alt="" width={180} height={180} />}
                <b>{o?.name ?? p.id}</b>
                <small>{p.rarity}★</small>
              </li>
            );
          })}
        </ol>
      )}
          {last.length === 0 && <p className="gacha-side-empty">{t("왼쪽에서 배너를 고르고 가챠를 돌려 보세요")}</p>}
          </div>
        {/* 6성 기록 — 결과 칸 오른쪽 열 (사용자 지시 2026-10-12), 길어지면 그 안에서 스크롤. 좁은 화면은 카드 아래로 */}
        <div className="gacha-side">
      {sixes.length > 0 ? (
        <div className="gacha-log">
          <h3>{t("6성 기록")}</h3>
          {/* 같은 오퍼는 한 줄로 묶어 × N (사용자 지시 2026-10-12). 몇 번째에 나왔는지는 마우스를 올리면 */}
          <ul>{[...sixes.reduce((m, p) => m.set(p.id, [...(m.get(p.id) ?? []), p]), new Map<string, Pull[]>())].map(([id, ps]) => {
            const o = byId.get(id);
            return <li key={id} className={onShowOperator ? "link" : undefined} {...showProps(id)}
              title={ps.map((p) => t("{n}번째", { n: p.n })).join(" · ")}>
              {o && <img src={asset(o.image)} alt="" width={28} height={28} />}<b title={o?.name}>{o?.name ?? id}</b>
              {/* 한정 오퍼 배지 — 픽업 목록과 같은 표시 (사용자 지시 2026-10-12) */}
              {POOL.limited.includes(id) && <em className="gacha-limited">{t("한정")}</em>}
              {ps.length > 1 && <em className="gacha-times">× {ps.length}</em>}
              {ps[0].pickup && <small>{t("픽업")}</small>}
            </li>;
          })}</ul>
        </div>
      ) : <p className="gacha-side-empty">{t("6성이 나오면 여기에 모입니다")}</p>}
        </div>

        </div>
        <p className="gacha-shot-foot" aria-hidden>terra-archive.net · {t("가챠 시뮬레이터")}</p>
        {/* 결과 이미지에 담는 미리보기 창 */}
        {shotOpen && (
          <ModalWindow label={t("이미지로 내보내기")} className="operator-modal me-share-modal" onClose={closeShot}>
            <div className="me-share-wrap">
              <header className="me-share-bar">
                <div className="me-share-actions">
                  <button type="button" className="import-action" disabled={!shot} onClick={() => void copyShot()}><span className="btn-icon" aria-hidden>⧉</span>{t("복사")}</button>
                  <button type="button" className="import-action apply" disabled={!shot} onClick={saveShot}><span className="btn-icon" aria-hidden>⤓</span>{t("PNG 저장")}</button>
                </div>
              </header>
              {shotMsg && <p className="me-note">{shotMsg}</p>}
              <div className="me-share-stage">
                {shot && <img className="me-share-img" src={shot.url} alt={t("가챠 결과")} />}
                {!shot && !shotFailed && <p className="me-note">{t("이미지 만드는 중…")}</p>}
                {shotFailed && <p className="me-note">{t("이미지를 만들지 못했습니다 — 잠시 뒤 다시 시도해 주세요.")}</p>}
              </div>
            </div>
          </ModalWindow>
        )}
        {toast && createPortal(<div key={toast.key} className="toast me-share-toast" role="status">{toast.text}</div>, document.body)}
      </div>
      {showGuide && (
        <ModalWindow label={t("가챠 시뮬레이터 확률·규칙")} className="farm-guide-modal" onClose={() => setShowGuide(false)}>
          <p>
        {t("기본 확률 6성 {a}% · 5성 {b}% · 4성 {c}% · 3성 {d}%, 첫 {g}회 안 5성 이상 보장 — 게임 데이터 기준.", { a: +(BASE[6] * 100).toFixed(1), b: +(BASE[5] * 100).toFixed(1), c: +(BASE[4] * 100).toFixed(1), d: +(BASE[3] * 100).toFixed(1), g: POOL.guarantee5 })}{" "}
        {t("6성 없이 50회를 넘기면 1회마다 6성 +2%, 픽업 비율(통상 50% · 한정 70%)은 게임 내 배너 상세 정보 기준.")}{" "}
        {t("재미로 돌려 보는 시뮬레이터이며 실제 결과와는 무관합니다.")}
      </p>
        </ModalWindow>
      )}
    </section>
  );
}
