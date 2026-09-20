"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { asset } from "./assets";
import recruitData from "./data/recruit.json";
import { useI18n, rich, type ExtraI18n } from "./i18n";
import { ModalWindow } from "./modal-window";
import { HANDOFF_EVENT, takeHandoff } from "./handoff";
import { useSearchInput } from "./search";
import { isNewFeature } from "./whats-new";
import type { LensGoto } from "./lens/match";
import { recognizeShot, warmData } from "./lens/run";
import { warmOcr } from "./lens/ocr";
import { useClipboardWatch } from "./lens/clipwatch";
import { useBridgeWatch } from "./lens/bridge";
import { useDropWatch } from "./lens/dropwatch";

// 스샷 인식 도움말 — 순수 설명 전용 모달 (입력 기능은 페이지 레벨 자동인식이 전담)
const LensHelpModal = lazy(() => import("./lens/help"));

type RecruitTag = { id: number; name: string; group: number };
type RecruitOp = { id: string; name: string; rarity: number; tags: string[]; image: string; accent: string; seq: number; pending?: boolean };

const data = recruitData as { tags: RecruitTag[]; ops: RecruitOp[] };

// 조합 계산은 전부 KR 태그명을 정본으로 돌리고, 표시할 때만 로케일 이름으로 바꾼다
// (태그 번역은 gacha_table tagId로 대응 — extra-i18n.*.json의 recruitTags)
const QUALIFICATION_TAGS = ["고급 특별 채용", "특별 채용", "신입", "로봇"];
const JOB_TAGS = ["가드", "스나이퍼", "디펜더", "메딕", "서포터", "캐스터", "스페셜리스트", "뱅가드"];
const POSITION_TAGS = ["근거리", "원거리"];
const FIXED = new Set([...QUALIFICATION_TAGS, ...JOB_TAGS, ...POSITION_TAGS]);
const AFFIX_TAGS = data.tags.map((tag) => tag.name).filter((name) => !FIXED.has(name));

const TAG_GROUPS: Array<[string, string[]]> = [
  ["자격", QUALIFICATION_TAGS],
  ["직군", JOB_TAGS],
  ["위치", POSITION_TAGS],
  ["특성", AFFIX_TAGS],
];

const RARITY_COLORS: Record<number, string> = { 6: "#c2571f", 5: "#b8860b", 4: "#7c5cbf", 3: "#3a7ca5", 2: "#5a8f4f", 1: "#75797a" };

// lowOps: 모집 시간을 낮춰야만 등장하는 1·2성 — 배지(floor/ceil)는 9시간 기준(3★+)으로만 계산
type ComboResult = { combo: string[]; ops: RecruitOp[]; lowOps: RecruitOp[]; floor: number; ceil: number };

// 1·2★는 태그와 무관하게 모집 시간만 맞으면 등장할 수 있다 (사용자 확인:
// 로봇도 로봇 태그 없이 나온 사례 있음) — 1★는 3:50 이하, 2★는 7:30 이하
const LOW_TIME_HINT: Record<number, string> = { 1: "3:50 이하", 2: "7:30 이하" };

const allCombos = (tags: string[]): string[][] => {
  const combos: string[][] = [];
  for (let i = 0; i < tags.length; i++) {
    combos.push([tags[i]]);
    for (let j = i + 1; j < tags.length; j++) {
      combos.push([tags[i], tags[j]]);
      for (let k = j + 1; k < tags.length; k++) combos.push([tags[i], tags[j], tags[k]]);
    }
  }
  return combos;
};

const evaluate = (combo: string[]): ComboResult | null => {
  const byRarity = (op: RecruitOp) =>
    combo.every((tag) => op.tags.includes(tag)) &&
    (op.rarity !== 6 || combo.includes("고급 특별 채용"));
  const all = data.ops.filter(byRarity).sort((a, b) => b.rarity - a.rarity || b.seq - a.seq);
  const ops = all.filter((op) => op.rarity >= 3);
  const lowOps = all.filter((op) => op.rarity <= 2);
  if (all.length === 0) return null;
  // 배지는 9시간 기준 — 3★+ 매칭이 없고 저시간 전용(로봇 등)만 있으면 그 성급으로 표시
  const rarities = (ops.length ? ops : lowOps).map((op) => op.rarity);
  return { combo, ops, lowOps, floor: Math.min(...rarities), ceil: Math.max(...rarities) };
};

export function comboResults(picked: string[]): ComboResult[] {
  return allCombos(picked)
    .map(evaluate)
    .filter((result): result is ComboResult => result !== null)
    .sort((a, b) => b.floor - a.floor || b.ceil - a.ceil || a.ops.length - b.ops.length);
}

// 자격 태그 없이 4★ 이상이 확정되는 최소 조합 사전 (부분조합이 이미 확정이면 제외)
const SNIPE_DICT: ComboResult[] = (() => {
  const names = data.tags.map((tag) => tag.name).filter((name) => name !== "고급 특별 채용" && name !== "특별 채용");
  const key = (combo: string[]) => [...combo].sort().join("+");
  const qualifying = new Map<string, ComboResult>();
  for (const combo of allCombos(names)) {
    const result = evaluate(combo);
    if (result && result.floor >= 4) qualifying.set(key(combo), result);
  }
  return [...qualifying.values()]
    .filter(({ combo }) => combo.every((_, index) => {
      const subset = combo.filter((__, position) => position !== index);
      return subset.length === 0 || !qualifying.has(key(subset));
    }))
    .sort((a, b) => b.floor - a.floor || a.combo.length - b.combo.length || a.ops.length - b.ops.length);
})();

function ComboCard({ result, onShowOperator, tagLabel, opLabel }: { result: ComboResult; onShowOperator?: (id: string) => void; tagLabel: (tag: string) => string; opLabel: (op: RecruitOp) => string }) {
  const { t } = useI18n();
  const lowOnly = result.ops.length === 0;
  return (
    <article className={`recruit-combo${result.floor >= 4 ? " prized" : ""}`}>
      <header>
        <div className="combo-tags">{result.combo.map((tag) => <span key={tag}>{tagLabel(tag)}</span>)}</div>
        <b style={{ background: RARITY_COLORS[result.floor] }}>
          {lowOnly ? t("{n}★ · 저시간 전용", { n: result.floor }) : result.floor === result.ceil ? t("{n}★ 확정", { n: result.floor }) : t("{n}★ 이상", { n: result.floor })}
        </b>
      </header>
      <ul>
        {result.ops.map((op) => (
          <li key={op.id} className={op.pending ? "pending" : undefined} style={{ borderColor: RARITY_COLORS[op.rarity] }}>
            <img src={asset(op.image)} alt="" width={180} height={180} loading="lazy" decoding="async" className={onShowOperator ? "op-link" : undefined}
              title={onShowOperator ? t("{name} 상세 정보", { name: opLabel(op) }) : undefined} onClick={() => onShowOperator?.(op.id)} />
            <span>{opLabel(op)}{op.pending && <em className="pending-tag">{t("추가 예정")}</em>}</span>
            <i style={{ color: RARITY_COLORS[op.rarity] }}>{op.rarity}★</i>
          </li>
        ))}
        {result.lowOps.map((op) => (
          <li key={op.id} className="low-time" style={{ borderColor: RARITY_COLORS[op.rarity] }}>
            <img src={asset(op.image)} alt="" width={180} height={180} loading="lazy" decoding="async" className={onShowOperator ? "op-link" : undefined}
              title={onShowOperator ? t("{name} 상세 정보", { name: opLabel(op) }) : undefined} onClick={() => onShowOperator?.(op.id)} />
            <span>{opLabel(op)}<em className="time-req">{t(LOW_TIME_HINT[op.rarity])}</em></span>
            <i style={{ color: RARITY_COLORS[op.rarity] }}>{op.rarity}★</i>
          </li>
        ))}
      </ul>
      {result.lowOps.length > 0 && (
        <p className="low-time-note">{rich(t("1·2★는 모집 시간을 낮춰야 등장합니다 — **1★는 3시간 50분 이하**, **2★는 7시간 30분 이하**. 9시간 설정 시에는 나오지 않습니다."))}</p>
      )}
    </article>
  );
}

const ALL_TAG_NAMES = data.tags.map((tag) => tag.name);

// '4★ 이상 확정 조합만' 토글 localStorage 키 — 스샷을 연달아 찍으며 저격 조합만 보는
// 사용 흐름이라(사용자 제보 2026-08-16) 표시 필터는 세션을 넘어 기억한다
const PRIZED_KEY = "ta-recruit-prized";

// 빠른 입력 안내문 마퀴의 사본 간격 — globals.css `.quick-ph-run > i` 의 padding-right 와 같아야 한다
const PH_GAP = 36;

export default function RecruitHelper({ onShowOperator, extra }: { onShowOperator?: (id: string) => void; extra?: ExtraI18n | null } = {}) {
  const { t, locale } = useI18n();
  const [showDict, setShowDict] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  /* 빠른 입력 안내문은 좌우 분할의 왼쪽 칸(입력란 176px)에서 통째로 잘린다 (사용자 지적
     2026-09-20). 네이티브 placeholder 는 애니메이션이 안 되니 같은 자리에 겹쳐 그려 흘린다 —
     다만 **실제로 넘칠 때만**. 넘치는지는 CSS 가 알 수 없어 재서 data-run 을 다는데,
     상태가 아니라 DOM 표시라 리렌더가 없다 (react-hooks/set-state-in-effect 도 피한다). */
  const quickPhRef = useRef<HTMLSpanElement>(null);
  // 비제어 입력 — 타이핑 중 렌더 0회, 태그 자동 선택·조합 계산은 멈춘 뒤 0.5초에 (search.ts)
  const { term: quickTerm, set: setQuickTerm, inputProps: quickProps } = useSearchInput();
  const [manualOn, setManualOn] = useState<string[]>([]);   // 직접 클릭해 켠 태그
  const [manualOff, setManualOff] = useState<string[]>([]); // 자동 선택을 직접 꺼둔 태그

  // 태그·오퍼 표시명 — 내부 상태(picked 등)는 KR 이름 그대로, 화면·입력 매칭만 로케일
  const tagLabelMap = useMemo(() => {
    if (!extra) return null;
    const map = new Map<string, string>();
    for (const tag of data.tags) {
      const localized = extra.recruitTags[String(tag.id)];
      if (localized) map.set(tag.name, localized);
    }
    return map;
  }, [extra]);
  const tagLabel = (tag: string) => tagLabelMap?.get(tag) ?? tag;
  const opLabel = (op: RecruitOp) => extra?.names[op.id] ?? op.name;

  // 빠른 입력: 각 글자를 첫 글자로 갖는 태그만 표시하고, 후보가 하나뿐이면 자동 선택.
  // 선택은 현재 입력 문자열에서 매번 다시 계산한다 — 한글 IME 조합 중간 상태
  // (예: "가메" 입력 도중 '감')에서 잘못 붙은 자동 선택이 다음 키 입력에서 스스로 풀리게.
  // 영문/일문 로케일에서는 번역된 태그명의 첫 글자(대소문자 무시)로 매칭한다.
  const quickChars = Array.from(new Set(quickTerm.replace(/\s/g, "").toLowerCase().split("")));
  const autoPicks = useMemo(() =>
    quickChars
      .map((char) => ALL_TAG_NAMES.filter((name) => tagLabel(name).toLowerCase()[0] === char))
      .filter((candidates) => candidates.length === 1)
      .map((candidates) => candidates[0]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quickTerm, tagLabelMap]);
  const picked = useMemo(() => {
    const merged = [...autoPicks.filter((tag) => !manualOff.includes(tag))];
    for (const tag of manualOn) if (!merged.includes(tag)) merged.push(tag);
    return merged.slice(0, 5);
  }, [autoPicks, manualOn, manualOff]);

  const isVisible = (tag: string) => quickChars.length === 0 || quickChars.includes(tagLabel(tag).toLowerCase()[0]) || picked.includes(tag);
  const togglePicked = (tag: string) => {
    if (picked.includes(tag)) {
      setManualOn((current) => current.filter((item) => item !== tag));
      if (autoPicks.includes(tag)) setManualOff((current) => [...current, tag]);
    } else {
      setManualOff((current) => current.filter((item) => item !== tag));
      if (picked.length < 5 && !autoPicks.includes(tag)) setManualOn((current) => [...current, tag]);
    }
  };
  const clearAll = () => { setQuickTerm(""); setManualOn([]); setManualOff([]); };

  // 헤더 만능검색이 태그를 지목하면 그 태그를 켠 상태로 시작한다 (app/handoff.ts).
  // 태그 정본은 KR 이름이라 로케일과 무관하게 그대로 받는다.
  useEffect(() => {
    const apply = () => {
      const h = takeHandoff("recruit");
      if (!h?.tags?.length) return;
      setQuickTerm("");
      setManualOff([]);
      setManualOn(h.tags.filter((tag) => ALL_TAG_NAMES.includes(tag)).slice(0, 5));
    };
    apply();
    window.addEventListener(HANDOFF_EVENT, apply);
    return () => window.removeEventListener(HANDOFF_EVENT, apply);
  }, []);

  // 태그 판 접기 — **좁은 화면에서만** 5개를 다 고르는 순간 접는다 (사용자 지시 2026-09-20).
  // 넓은 화면은 좌우로 갈라져 태그 판이 결과를 밀어내지 않으므로 계속 펼쳐 둔다.
  const [tagsOpen, setTagsOpen] = useState(true);
  useEffect(() => {
    if (picked.length === 0) { setTagsOpen(true); return; }
    if (picked.length >= 5 && typeof window !== "undefined"
        && window.matchMedia("(max-width: 1099px)").matches) setTagsOpen(false);
  }, [picked.length]);

  // 스샷으로 태그 입력 (페이지 내 설치, 사용자 확정 2026-07-23) — 인식된 태그를 바로 선택
  const [lensOpen, setLensOpen] = useState(false);
  const onLensGoto = (g: LensGoto) => {
    if (g.page !== "recruit") return;
    setLensOpen(false);
    setQuickTerm("");
    setManualOff([]);
    setManualOn(g.tags.filter((tag) => ALL_TAG_NAMES.includes(tag)).slice(0, 5));
  };
  // 페이지 레벨 클립보드 자동인식 토글 — 모달 없이 캡처만 하면 태그가 바로 선택된다.
  // 기본 꺼짐 + 세션 비영속: 리프레시하면 항상 꺼진 상태로 시작 (사용자 확정 2026-07-24 —
  // 클립보드 폴링은 사용자가 켠 동안에만 돌린다, localStorage 복원 안 함)
  const [lensAuto, setLensAuto] = useState(false);
  const toggleLensAuto = () => setLensAuto((v) => {
    const next = !v;
    if (next) { void warmOcr(); warmData("recruit"); }
    return next;
  });
  const [lensMsg, setLensMsg] = useState<string | null>(null);
  const [lensThumb, setLensThumb] = useState<string | null>(null); // 인식 중/최근 이미지 미니 썸네일
  const lensMsgTimer = useRef<number | undefined>(undefined);
  const flashLensMsg = (msg: string | null, ms?: number) => {
    if (lensMsgTimer.current !== undefined) window.clearTimeout(lensMsgTimer.current);
    setLensMsg(msg);
    if (msg && ms) lensMsgTimer.current = window.setTimeout(() => setLensMsg(null), ms);
  };
  // 자동인식·필 드롭 공용 인식 흐름
  const lensBusy = useRef(false);
  const handleLensShot = async (file: File) => {
    if (lensBusy.current) return;
    lensBusy.current = true;
    setLensThumb((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    flashLensMsg(t("스캔 중…"));
    try {
      const oc = await recognizeShot("recruit", file);
      if (oc.target.kind === "goto") {
        onLensGoto(oc.target.goto);
        flashLensMsg(t("태그를 인식해 선택했습니다."), 2000);
      } else {
        flashLensMsg(t("인식된 태그가 없습니다 — 모집 요건 태그가 보이게 캡처해 보세요."), 3000);
      }
    } catch {
      flashLensMsg(t("인식에 실패했습니다 — 다른 스크린샷으로 다시 시도해 주세요."), 3000);
    } finally {
      lensBusy.current = false;
    }
  };
  const lensClip = useClipboardWatch(lensAuto && !lensOpen, handleLensShot);
  useBridgeWatch(!lensOpen, handleLensShot);   // 게임 브리지 — 같은 프레임 공급원
  // 자동인식 동안 창 전체가 드롭존 — 드래그 중이면 필을 드롭 가능 상태로 강조
  const lensDragging = useDropWatch(lensAuto && !lensOpen, handleLensShot);

  // 안내문이 입력란보다 넓을 때만 흘린다 — 들어맞는 폭에서 글자가 움직이면 거슬리기만 한다
  const quickPh = t("빠른 입력 — 태그 첫 글자를 이어서 입력 (예: 가메신생범)");
  useEffect(() => {
    const host = quickPhRef.current;
    const copy = host?.querySelector("i");
    if (!host || !copy) return;
    const measure = () => { host.dataset.run = copy.offsetWidth - PH_GAP > host.clientWidth ? "1" : ""; };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [quickPh]);

  const results = useMemo(() => comboResults(picked), [picked]);

  // 4★ 이상 확정(floor ≥ 4) 조합만 남기는 표시 필터 — SSR엔 localStorage가 없으므로
  // false로 하이드레이션 후 이펙트에서 복원 (home.tsx 미래시 토글과 같은 패턴)
  const [prizedOnly, setPrizedOnly] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem(PRIZED_KEY) === "1") setPrizedOnly(true); } catch { /* ignore */ }
  }, []);
  const togglePrizedOnly = () => {
    const next = !prizedOnly;
    setPrizedOnly(next);
    try { localStorage.setItem(PRIZED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };
  const shownResults = prizedOnly ? results.filter((result) => result.floor >= 4) : results;
  /* 성급이 다른 카드가 한 줄에 섞이면 등급이 읽히지 않는다 (사용자 지적 2026-09-20:
     "3성 이상이랑 5성 이상이 같은 줄에 있는 게 이상하지 않음?") — 배지가 같은 것끼리
     묶어 소제목을 달고 묶음마다 따로 격자를 깐다. results 가 이미 성급 내림차순이라
     Map 삽입 순서가 곧 표시 순서다. 저격 조합 사전도 같은 함수를 쓴다. */
  const groupByBadge = (list: ComboResult[]) => {
    const groups = new Map<string, { label: string; floor: number; items: ComboResult[] }>();
    for (const result of list) {
      const lowOnly = result.ops.length === 0;
      const key = lowOnly ? `low${result.floor}` : `${result.floor}${result.floor === result.ceil ? "f" : "u"}`;
      const label = lowOnly ? t("{n}★ · 저시간 전용", { n: result.floor })
        : result.floor === result.ceil ? t("{n}★ 확정", { n: result.floor })
        : t("{n}★ 이상", { n: result.floor });
      const group = groups.get(key) ?? { label, floor: result.floor, items: [] };
      group.items.push(result);
      groups.set(key, group);
    }
    /* 삽입 순서만으로는 같은 성급 안에서 「4★ 이상」이 「4★ 확정」보다 먼저 올 수 있다
       (사전이 조합 길이순으로 정렬돼 있어서) — 성급 높은 순, 같으면 확정 먼저,
       저시간 전용은 맨 뒤로 못 박는다. */
    return [...groups.entries()].sort(([, a], [, b]) =>
      (a.items[0].ops.length === 0 ? 1 : 0) - (b.items[0].ops.length === 0 ? 1 : 0)
      || b.floor - a.floor
      || (a.items[0].floor === a.items[0].ceil ? 0 : 1) - (b.items[0].floor === b.items[0].ceil ? 0 : 1));
  };
  const renderGroups = (list: ComboResult[]) => groupByBadge(list).map(([key, group]) => (
    <section key={key} className="recruit-group">
      <h3>
        <span style={{ background: RARITY_COLORS[group.floor] }}>{group.label}</span>
        <em>{t("{n}개 조합", { n: group.items.length })}</em>
      </h3>
      <div className="recruit-results">
        {group.items.map((result) => <ComboCard key={result.combo.join("+")} result={result} onShowOperator={onShowOperator} tagLabel={tagLabel} opLabel={opLabel} />)}
      </div>
    </section>
  ));

  return (
    <section className="recruit" aria-label={t("공개모집 도우미")}>
      <div className="recruit-head">
        <span className="section-no">RECRUITMENT ASSIST</span>
        <h2>{t("공개채용 도우미")}</h2>
        {/* 설명과 시간표는 한 번 읽으면 끝인데 263px 를 늘 깔고 있었다 (실측) — 창으로 뺐다.
            접이식(<details>)이었을 땐 펼치는 순간 아래가 통째로 밀려 내려가 결과를 다시
            찾아야 했다 (사용자 지적 2026-09-20). 저격 조합 사전도 같은 줄에서 연다 —
            둘 다 "지금 고른 태그와 무관한 참고표"라 본문에 깔 이유가 없다. */}
        <div className="head-links">
          <button type="button" onClick={() => setShowGuide(true)}>
            {rich(t("성급 배지는 모집 시간 **9시간** 기준입니다 — 읽는 법과 시간별 출현 성급"))}
          </button>
          <button type="button" onClick={() => setShowDict(true)}>
            {t("4·5성 저격 조합 사전")}<em>{t("{n}개 조합", { n: SNIPE_DICT.length })}</em>
          </button>
        </div>
      </div>

      {/* 넓은 화면에선 왼쪽 태그 판 · 오른쪽 결과로 갈라 스크롤을 줄인다 (사용자 지시
          2026-09-20: 종전엔 결과가 739px 아래에서 시작해 첫 화면에 한 장 반만 보였다).
          좁은 화면에서는 CSS 가 한 줄로 되돌려 종전과 같은 세로 배치가 된다. */}
      <div className="recruit-split">
      <div className={`recruit-tags${tagsOpen ? "" : " collapsed"}`}>
        {!tagsOpen && (
          <div className="recruit-tags-sum">
            <div className="combo-tags">{picked.map((tag) => <span key={tag}>{tagLabel(tag)}</span>)}</div>
            <button type="button" onClick={() => setTagsOpen(true)}>{t("태그 고치기")}</button>
          </div>
        )}
        <div className="quick-wrap">
          {/* placeholder 는 자리만 잡는 공백 한 칸 — 실제 안내문은 겹쳐 그린 .quick-ph 가
              맡는다(마퀴). :placeholder-shown 이 풀리면 CSS 가 알아서 감춘다. */}
          <div className="quick-input">
            <input {...quickProps} placeholder=" " aria-label={t("태그 첫 글자 빠른 입력")} />
            <span className="quick-ph" ref={quickPhRef} aria-hidden>
              <span className="quick-ph-run"><i>{quickPh}</i><i>{quickPh}</i></span>
            </span>
          </div>
          <button type="button" className="clear-btn" onClick={clearAll}><span className="btn-icon" aria-hidden>↻</span>{t("클리어")}</button>
          {/* 스샷으로 태그 입력 — 버튼 자체가 자동인식 토글, ?는 도움말 모달 (KR 클라 전용) */}
          {locale === "ko" && (
            <div className="lens-open-wrap">
              <button type="button" className={`lens-open-btn${lensAuto ? " on" : ""}`} aria-pressed={lensAuto}
                title={t("클릭해 스샷 자동인식을 켜고 끕니다 — 켜두면 게임 화면을 캡처만 해도 바로 인식·적용됩니다")}
                onClick={toggleLensAuto}>
                <span className="lens-auto-knob" aria-hidden />📷 {t("스샷으로 태그 입력")}{isNewFeature("lens") && <span className="new-badge">{t("새기능")}</span>}
              </button>
              <button type="button" className="lens-help-btn" aria-label={t("스샷 인식 도움말")}
                onClick={() => setLensOpen(true)}>?</button>
            </div>
          )}
        </div>
        {/* 자동인식 상태 필 — fixed 오버레이(레이아웃 안 밀음) + 인식 이미지 미니 썸네일.
            드롭은 창 전체가 받고(useDropWatch), 드래그 중이면 필이 드롭 가능 상태로 강조된다 */}
        {locale === "ko" && lensAuto && (
          <div className={`lens-auto-pill${lensMsg ? " busy" : ""}${lensDragging ? " drop" : ""}`} role="status">
            {lensThumb && !lensDragging && <img className="lens-auto-thumb" src={lensThumb} alt={t("인식한 스크린샷")} />}
            <span>{lensDragging ? t("여기든 어디든, 놓으면 바로 인식합니다") : lensMsg ?? (lensClip === "off"
              ? t("클립보드 접근이 막혀 있습니다 — 이미지를 화면에 드롭하거나 ⌘V로 붙여넣으세요")
              : t("스샷 자동인식 켜짐 — 게임 화면을 캡처하고 돌아오거나, 이미지를 화면에 드롭하세요"))}</span>
          </div>
        )}
        {TAG_GROUPS.map(([group, tags]) => {
          const shown = tags.filter(isVisible);
          if (shown.length === 0) return null;
          return (
            <fieldset key={group}>
              <legend>{t(group)}</legend>
              <div className="filter-list">
                {shown.map((tag) => (
                  <button key={tag} type="button" className={picked.includes(tag) ? "selected" : ""}
                    disabled={!picked.includes(tag) && picked.length >= 5} onClick={() => togglePicked(tag)}>{tagLabel(tag)}</button>
                ))}
              </div>
            </fieldset>
          );
        })}
        <div className="recruit-picked">
          {t("제시된 태그 {n}/5 · 체크 조합은 3개까지 계산", { n: picked.length })}
        </div>
      </div>

      {/* 4·5성 저격만 남기는 결과 필터 (사용자 제보) — 스샷 인식 결과에도 그대로 적용되고,
          태그를 고르기 전에도 미리 켜둘 수 있다 (사용자 확정 2026-08-16) */}
      <div className="recruit-main">
      <div className="recruit-results-bar">
        <button type="button" className={`recruit-prized-toggle${prizedOnly ? " on" : ""}`} aria-pressed={prizedOnly}
          title={t("높은 성급이 확정되는 조합만 남기고 나머지를 숨깁니다")} onClick={togglePrizedOnly}>
          <span className="recruit-prized-box" aria-hidden />{t("4★ 이상 확정 조합만 보기")}
        </button>
      </div>
      {picked.length === 0 ? (
        <p className="recruit-empty">{t("태그를 선택하면 조합 결과가 여기에 표시됩니다.")}</p>
      ) : shownResults.length === 0 ? (
        <p className="recruit-empty">{t("이 태그로는 4★ 이상이 확정되는 조합이 없습니다 — 토글을 끄면 전체 조합이 표시됩니다.")}</p>
      ) : renderGroups(shownResults)}

      </div>
      </div>

      {/* 도움말·사전은 둘 다 공용 창(ModalWindow) — globals 의 "모달은 예외 없이 전부 이 창" 규칙 */}
      {showGuide && (
        <ModalWindow label={t("공개채용 도우미 읽는 법")} className="recruit-guide-modal" onClose={() => setShowGuide(false)}>
          <p className="recruit-guide-p">{rich(t("게임 공개모집에 **제시된 태그 5개**를 아래에서 그대로 입력하세요. 실제 게임에서 체크할 수 있는 **최대 3개**짜리 조합 전부를 계산해, 높은 성급이 확정되는 조합부터 순서대로 보여줍니다. 성급 배지는 모집 시간 **9시간** 기준 — 6★는 고급 특별 채용이 있어야 나옵니다. 모집 시간을 낮추면 나오는 **1·2★**도 함께 표시되며, 각 결과에 필요한 시간 조건이 붙어 있습니다."))}</p>
          <p className="recruit-time-note">{rich(t("**모집 시간별 출현 성급** — 1시간~3시간 50분: **1·2·3·4★** · 4시간~7시간 30분: **2·3·4·5★** · 7시간 40분 이상: **3·4·5★**만 출현. 저격 조합은 반드시 **7시간 40분 이상(보통 9시간)**으로 돌려야 3★ 미만이 섞이지 않습니다."))}</p>
        </ModalWindow>
      )}
      {showDict && (
        <ModalWindow label={t("4·5성 저격 조합 사전")} className="recruit-dict-modal" onClose={() => setShowDict(false)}>
          <p className="recruit-dict-lead">{rich(t("특별 채용·고급 특별 채용 없이도 **4★ 이상이 확정**되는 최소 태그 조합 전체입니다. 모집 태그에 아래 조합이 뜨면 놓치지 마세요. (태그를 더 얹어도 확정은 유지됩니다)"))}</p>
          {renderGroups(SNIPE_DICT)}
        </ModalWindow>
      )}
      {/* 도움말은 공용 창(ModalWindow)이라 백드롭·포털을 스스로 만든다 (2026-09-05) */}
      {lensOpen && (
        <Suspense fallback={null}>
          <LensHelpModal mode="recruit" onClose={() => setLensOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}
