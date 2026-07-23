"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import recruitData from "./data/recruit.json";
import { useI18n, rich, type ExtraI18n } from "./i18n";
import { isNewFeature } from "./whats-new";
import type { LensGoto } from "./lens/match";
import { recognizeShot, warmData } from "./lens/run";
import { warmOcr } from "./lens/ocr";
import { useClipboardWatch } from "./lens/clipwatch";
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
            <img src={op.image} alt="" width={180} height={180} loading="lazy" decoding="async" className={onShowOperator ? "op-link" : undefined}
              title={onShowOperator ? t("{name} 상세 정보", { name: opLabel(op) }) : undefined} onClick={() => onShowOperator?.(op.id)} />
            <span>{opLabel(op)}{op.pending && <em className="pending-tag">{t("추가 예정")}</em>}</span>
            <i style={{ color: RARITY_COLORS[op.rarity] }}>{op.rarity}★</i>
          </li>
        ))}
        {result.lowOps.map((op) => (
          <li key={op.id} className="low-time" style={{ borderColor: RARITY_COLORS[op.rarity] }}>
            <img src={op.image} alt="" width={180} height={180} loading="lazy" decoding="async" className={onShowOperator ? "op-link" : undefined}
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

export default function RecruitHelper({ onShowOperator, extra }: { onShowOperator?: (id: string) => void; extra?: ExtraI18n | null } = {}) {
  const { t, locale } = useI18n();
  const [showDict, setShowDict] = useState(false);
  const [quick, setQuick] = useState("");
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
  const quickChars = Array.from(new Set(quick.replace(/\s/g, "").toLowerCase().split("")));
  const autoPicks = useMemo(() =>
    quickChars
      .map((char) => ALL_TAG_NAMES.filter((name) => tagLabel(name).toLowerCase()[0] === char))
      .filter((candidates) => candidates.length === 1)
      .map((candidates) => candidates[0]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quick, tagLabelMap]);
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
  const clearAll = () => { setQuick(""); setManualOn([]); setManualOff([]); };

  // 스샷으로 태그 입력 (페이지 내 설치, 사용자 확정 2026-07-23) — 인식된 태그를 바로 선택
  const [lensOpen, setLensOpen] = useState(false);
  const onLensGoto = (g: LensGoto) => {
    if (g.page !== "recruit") return;
    setLensOpen(false);
    setQuick("");
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
  // 자동인식 동안 창 전체가 드롭존 — 드래그 중이면 필을 드롭 가능 상태로 강조
  const lensDragging = useDropWatch(lensAuto && !lensOpen, handleLensShot);

  const results = useMemo(() => comboResults(picked), [picked]);

  return (
    <section className="recruit" aria-label={t("공개모집 도우미")}>
      <div className="recruit-head">
        <span className="section-no">RECRUITMENT ASSIST</span>
        <h2>{t("공채 도우미")}</h2>
        <p>{rich(t("게임 공개모집에 **제시된 태그 5개**를 아래에서 그대로 입력하세요. 실제 게임에서 체크할 수 있는 **최대 3개**짜리 조합 전부를 계산해, 높은 성급이 확정되는 조합부터 순서대로 보여줍니다. 성급 배지는 모집 시간 **9시간** 기준 — 6★는 고급 특별 채용이 있어야 나옵니다. 모집 시간을 낮추면 나오는 **1·2★**도 함께 표시되며, 각 결과에 필요한 시간 조건이 붙어 있습니다."))}</p>
        <p className="recruit-time-note">{rich(t("**모집 시간별 출현 성급** — 1시간~3시간 50분: **1·2·3·4★** · 4시간~7시간 30분: **2·3·4·5★** · 7시간 40분 이상: **3·4·5★**만 출현. 저격 조합은 반드시 **7시간 40분 이상(보통 9시간)**으로 돌려야 3★ 미만이 섞이지 않습니다."))}</p>
      </div>

      <div className="recruit-tags">
        <div className="quick-wrap">
          <input value={quick} onChange={(event) => setQuick(event.target.value)}
            placeholder={t("빠른 입력 — 태그 첫 글자를 이어서 입력 (예: 가메신생범)")} aria-label={t("태그 첫 글자 빠른 입력")} />
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

      {picked.length === 0 ? (
        <p className="recruit-empty">{t("태그를 선택하면 조합 결과가 여기에 표시됩니다.")}</p>
      ) : (
        <div className="recruit-results">
          {results.map((result) => <ComboCard key={result.combo.join("+")} result={result} onShowOperator={onShowOperator} tagLabel={tagLabel} opLabel={opLabel} />)}
        </div>
      )}

      <div className="recruit-dict">
        <button type="button" className="dict-toggle" onClick={() => setShowDict((current) => !current)}>
          {t("4·5성 저격 조합 사전")} {showDict ? t("접기 ▲") : t("펼치기 ({n}개 조합) ▼", { n: SNIPE_DICT.length })}
        </button>
        {showDict && (
          <>
            <p>{rich(t("특별 채용·고급 특별 채용 없이도 **4★ 이상이 확정**되는 최소 태그 조합 전체입니다. 모집 태그에 아래 조합이 뜨면 놓치지 마세요. (태그를 더 얹어도 확정은 유지됩니다)"))}</p>
            <div className="recruit-results">
              {SNIPE_DICT.map((result) => <ComboCard key={result.combo.join("+")} result={result} onShowOperator={onShowOperator} tagLabel={tagLabel} opLabel={opLabel} />)}
            </div>
          </>
        )}
      </div>
      {lensOpen && (
        <div className="modal-backdrop scanner-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setLensOpen(false); }}>
          <Suspense fallback={null}>
            <LensHelpModal mode="recruit" onClose={() => setLensOpen(false)} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
