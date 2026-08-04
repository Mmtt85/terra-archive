"use client";

import { lazy, memo, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { asset } from "./assets";
import { useI18n, tokenName, rich, type ExtraI18n, type Locale, type T } from "./i18n";
import { RULES } from "./rules";
import { useConfirm } from "./confirm";
import { normSearch, useSearchInput } from "./search";
import { isNewFeature } from "./whats-new";
import { useHashSync } from "./hash-modal";

import {
  infra, ops, opById, factionsOf, withElite, clueBase, maxElite, eliteOptions,
  ELITE_LABEL, MAX_OP_LEVEL, LAYOUT, cellByKey, ROOM_ACCENT, UNIT, PARK_KEYS, SHIFT_COUNT,
  JOB_ORDER, ROSTER_SORT_KEYS, PRODUCTION_KEYS, SUPPORT_KEYS,
  AURA_WEIGHT, AURA_LABEL, skillApplies, breakdown, teamScore, aurasOf, ambientFor, capConvFor, roomMaxNetDrain,
  ctxFor, sanitizePlan, presentIdsFor, roomOfFor, cellOfFor, slotSubstitutes, setLayoutPreset, setPriorityMode, memberOf, growAvg, DEFAULT_CUSTOM_ROOMS, DEFAULT_CUSTOM_PRODUCTS,
  setLevels as setEngineLevels, slotsFor, maxLevelOf, levelOf, powerBudget, suggestedLevels, TERMS,
  splitPriority, joinPriority, AUTO_BENCH_IDS,
  type InfraOp, type InfraSkill, type Elite, type Plan, type ProdPriority, type ProdAxis, type DrainMode, type TokenFlow, type OptimizeStep, type LayoutPreset, type Levels, type CustomRoom, type CustomProduct,
} from "./planner-engine";
import type { RaiseRec, InvestProgress } from "./planner-invest";
// 회수일 각주가 쓰는 환산 기준 — 엔진(planner-invest)은 워커 전용 무거운 모듈이라
// 값으로 가져오지 않고 생성 데이터만 직접 읽는다 (scripts/build-sanity.py)
import sanityBasis from "./data/sanity.json";
// 자동편성·육성 추천의 실제 계산은 Web Worker에서 (INP — 메인 스레드는 진행 표시만, 2026-07-22)
import { optimizeOff, investOff } from "./planner-offload";

// 보유 오퍼 화면 스캔(에뮬레이터 화면 공유 → 자동 인식, 2026-07-23) — 초상 템플릿 2.4MB 무거워 lazy 스플릿
const ScannerModal = lazy(() => import("./scan/scanner").then((m) => ({ default: m.ScannerModal })));
// 보유 오퍼 가져오기(MAA 파일·스크린샷·게임 로그인) 패널 — 2026-07-26
import { RosterImportPanel } from "./roster-import";
// MAA 커스텀 기반시설 JSON 내보내기 (베타) — 2026-08-02
import { buildMaaInfrast } from "./maa-export";
// 공용 창형 모달 — 이동·리사이즈·고정·z순서 (2026-08-03)
import { ModalWindow } from "./modal-window";
import type { AccountRoster } from "./account";
import costsData from "./data/costs.json";

// 재료 표시용 카탈로그 (이름·아이콘) — costs.json items (build-costs.py 수확)
const ITEM_CAT = (costsData as { items: Record<string, { name: Record<string, string>; image: string }> }).items;

// 전략 라벨은 저장된 문자열이 아니라 구조 필드에서 로케일로 재조립한다
// (localStorage의 구버전 플랜은 strategyTokens가 없어 KR 문자열 그대로 표시)
function strategyLabel(plan: Plan, locale: Locale, t: T): string {
  if (!plan.strategyTokens) return plan.strategy;
  const base = plan.strategyTokens.length
    ? t("{tokens} 패키지", { tokens: plan.strategyTokens.map((token) => tokenName(locale, token)).join(" + ") })
    : t("기본 편성");
  return base + (plan.strategySet ? t(" + 진영 세트") : "");
}

const STORAGE_KEY = "terra-archive-infra-v3";
// 육성 추천 표시 개수 — 엔진은 정렬 전체를 반환하고, 숨긴 오퍼 자리는 다음 순위가 채운다
const INVEST_SHOW = 20;

export default function InfraPlanner({ onShowOperator, extra, includeFuture }: { onShowOperator?: (id: string) => void; extra?: ExtraI18n | null; includeFuture?: boolean } = {}) {
  const { locale, t } = useI18n();
  // 로케일 표시 오버레이: 이름·스킬명·설명만 교체하고(krName에 원본 보존),
  // 엔진이 쓰는 구조 필드(unlock·kind·token 등)는 KR 원본 그대로 둔다
  const lops = useMemo(() => {
    if (!extra) return ops;
    const loc = (skill: InfraSkill): InfraSkill => ({
      ...skill,
      krName: skill.name,
      name: (skill.buffId && extra.buffs[skill.buffId]?.name) || skill.name,
      description: (skill.buffId && extra.buffs[skill.buffId]?.desc) || skill.description,
      // 하위 정예화 단계(정예화 낮추면 대체됨)도 같은 오버레이로 로컬라이즈
      ...(skill.tiers ? { tiers: skill.tiers.map(loc) } : {}),
    });
    return ops.map((op) => ({
      ...op,
      name: extra.names[op.id] ?? op.name,
      skills: op.skills.map(loc),
    }));
  }, [extra]);
  // 미실장(중국 선행) 오퍼는 '미래시 데이터 포함' 토글이 켜져야 로스터·설정·편성에 등장.
  // 토글을 바꿔도 현재 편성은 갈아엎지 않는다 — 다음 자동편성부터 반영 (설정 불변 원칙)
  const visibleOps = useMemo(() => (includeFuture ? lops : lops.filter((op) => !op.unreleased)), [lops, includeFuture]);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [priority, setPriorityState] = useState<ProdPriority>("gold"); // 우선 생산 모드
  // 기지 배치 프리셋 (사용자 요청 2026-07-24): 243(기본)·153·252. 엔진 모듈 상태(setLayoutPreset)와
  // 항상 함께 바꾼다 — LAYOUT은 라이브 바인딩이라 상태 변경 리렌더에서 새 값을 읽는다.
  const [layout, setLayoutState] = useState<LayoutPreset>("243");
  // 시설 레벨 (전력·레벨 시스템 2026-07-24): 방 키 → 레벨. 빈 맵 = 전부 만렙.
  // 엔진 모듈 상태(setEngineLevels)와 항상 함께 바꾼다 (프리셋과 같은 패턴)
  const [levels, setLevelsState] = useState<Levels>({});
  // 사용자 지정(커스텀) 배치의 9칸 구성 (사용자 요청 2026-07-24) — 기본은 243 모양.
  // 엔진(setLayoutPreset("custom", …))·워커 잡·저장 파일에 항상 함께 실어 동기화한다.
  const [customRooms, setCustomRooms] = useState<CustomRoom[]>([...DEFAULT_CUSTOM_ROOMS]);
  // 커스텀 제조소 품목(순금/작전기록) 명시 선택 — null = 자동(min(무역,제조) 쿼터 앞채움)
  const [customProducts, setCustomProducts] = useState<(CustomProduct | null)[]>([...DEFAULT_CUSTOM_PRODUCTS]);
  // 사용자 지정 진입 직후 제조/무역/발전 토글을 두 번 반짝여 위치를 알린다 (사용자 요청 2026-07-24)
  const [switchFlash, setSwitchFlash] = useState(false);
  // 프리셋별 저장 버킷 — 243/153/252 각각의 편성·레벨·육성추천을 따로 보관해 전환 시
  // 재편성 없이 그대로 복원한다 (사용자 확정 2026-07-24: "각각 따로 한번 자동편성하면 유지")
  type LayoutBucket = { plan: Plan | null; levels: Levels; invest: RaiseRec[] | null; investHidden: string[]; dormPins?: Record<string, string[]> };
  const bucketsRef = useRef<Partial<Record<LayoutPreset, LayoutBucket>>>({});
  const syncBucket = (lay: LayoutPreset, patch: Partial<LayoutBucket>) => {
    bucketsRef.current[lay] = {
      plan: null, levels: suggestedLevels(lay), invest: null, investHidden: [], dormPins: {},
      ...(bucketsRef.current[lay] ?? {}), ...patch,
    };
  };
  // 숙소 고정 — 사용자가 숙소 칸에 직접 넣은(또는 📌로 잠근) 오퍼. 자동편성이 이 인원을
  // 그대로 두고 남은 자리만 짠다 (사용자 요청 2026-07-25: "숙소도 배치 변경·고정").
  // 프리셋(243/153/252/그외)마다 기지 모양이 달라 편성·레벨과 같은 버킷에 함께 저장한다.
  const [dormPins, setDormPinsState] = useState<Record<string, string[]>>({});
  const [activeShift, setActiveShift] = useState(0);
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const [showFlows, setShowFlows] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // 교대 탭의 짧은 링크 두 개가 여는 상세 모달 (사용자 요청 2026-07-28) —
  // "drain" = 지속 시간이 달라지는 이유, "policy" = A조·B조 교대 정책
  const [shiftNote, setShiftNote] = useState<ShiftNoteKind | null>(null);
  // 보유 오퍼 설정의 입력 방식 탭 — 딥링크(#roster/#roster-import)와 동기화하려 여기서 쥔다
  const [rosterMode, setRosterMode] = useState<"direct" | "import">("direct");
  // 딥링크 (사용자 요청 2026-07-27: 링크 가능한 상태 전부 URL로) — /infra 경로 위에서
  // #roster(직접 입력)·#roster-import(가져오기 탭)·#help·#flows·#room-<방키> 를 양방향 동기화.
  // #invest(육성 추천)는 분석 결과가 있어야만 열리는 모달이라 딥링크 대상이 아니다.
  useHashSync(
    showRoster ? (rosterMode === "import" ? "#roster-import" : "#roster")
      : showHelp ? "#help"
        : showFlows ? "#flows"
          : openRoom ? `#room-${openRoom}` : null,
    (h) => {
      setShowRoster(h === "#roster" || h === "#roster-import");
      if (h === "#roster") setRosterMode("direct");
      else if (h === "#roster-import") setRosterMode("import");
      setShowHelp(h === "#help");
      setShowFlows(h === "#flows");
      setOpenRoom(h.startsWith("#room-") && LAYOUT.some((cell) => cell.key === h.slice(6)) ? h.slice(6) : null);
    },
  );
  const [moreOpen, setMoreOpen] = useState(false); // '그 외' 드롭다운(이미지·파일·도움말)
  // 일부 모바일 인앱 브라우저(카카오톡·카페 웹뷰 등)는 탭 한 번에 click을 두 번 합성하거나
  // ~300ms 지연 mousedown을 쏜다 — 토글이 열리자마자 닫혀 "안 보임"이 된다
  // (사용자 리포트 2026-07-18, 일반 브라우저·에뮬레이터에선 재현 불가). 350ms 가드로 방어.
  const moreToggledAt = useRef(0);
  const toggleMore = () => {
    const now = Date.now();
    if (now - moreToggledAt.current < 350) return; // 고스트 클릭(중복 합성 click) 무시
    moreToggledAt.current = now;
    setMoreOpen((open) => !open);
  };
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showMaa, setShowMaa] = useState(false); // MAA 기반시설 내보내기 모달 (베타)
  // 1~5성은 기본 보유, 6성은 미보유로 시작 — 가진 6성만 직접 체크한다
  const [ownedIds, setOwnedIds] = useState<Set<string>>(() => new Set(ops.filter((op) => op.rarity <= 5).map((op) => op.id)));
  // 미지정 = 2정(정예화 2, 최대) 가정 — 정예화 2 스킬이 있는 오퍼만 1정으로 낮출 수 있다
  const [eliteById, setEliteById] = useState<Map<string, Elite>>(new Map());
  // 오퍼 레벨 (미지정 = 제한 없음). 노정예 Lv.30 해금 스킬 판정에만 쓰인다 —
  // 보유 설정에서 새로 체크하면 Lv.1로 시작한다 (사용자 확정 2026-08-04)
  const [levelById, setLevelById] = useState<Map<string, number>>(new Map());
  // 보유 오퍼·정예화 구성이나 방별 수동 편성을 바꾼 뒤 파일로 저장하지 않았으면 true
  const [dirty, setDirty] = useState(false);
  // 육성(정예화 완성) 추천 — 반사실 재최적화 결과(null=미실행)와 진행률, 모달 표시 여부.
  // 결과는 한 번 분석하면 새 자동편성 전까지 유지된다 (persist·export 포함, 사용자 확정 2026-07-21)
  const [investRecs, setInvestRecs] = useState<RaiseRec[] | null>(null);
  const [investing, setInvesting] = useState<InvestProgress | null>(null);
  // 0건일 때 "왜 없는지"를 패널이 말하게 하는 진단값 — 토스트는 사라지고 패널만 남아서
  // "아무것도 안 나온다"로 보이던 문제 (사용자 제보 2026-07-29). candidates는 엔진이
  // 진행 콜백으로 알려주는 정밀 평가 후보 수(total)를 그대로 받는다.
  const [investDiag, setInvestDiag] = useState<{ unfinished: number; candidates: number } | null>(null);
  const [showInvest, setShowInvest] = useState(false);
  // 숨긴 추천 오퍼 — 목록에서 빠지고 21위 이후 후보가 순서대로 올라온다 (사용자 요청 2026-07-21).
  // recommendRaises가 정렬 전체를 반환하므로 표시는 "숨김 제외 후 상위 INVEST_SHOW개".
  const [investHidden, setInvestHidden] = useState<Set<string>>(new Set());
  // 육성 추천 '임시 적용' 세션 — 추천 오퍼를 완성했다 가정한 미리보기 편성(비영구). 되돌리기
  // 가능하고 추천 목록은 유지된다. 전체 자동편성·다시 분석을 누르기 전까지 (사용자 확정 2026-07-21).
  const [tempApplied, setTempApplied] = useState<Map<string, Elite>>(new Map());
  const [tempBasePlan, setTempBasePlan] = useState<Plan | null>(null);
  // 아직 적용 안 한 '선택' 오퍼 — 개별 클릭은 선택만 하고, '선택 임시 적용'으로 한 번에 재편성
  const [selectedRaise, setSelectedRaise] = useState<Set<string>>(new Set());
  // 화면 표시용 정예화 = 커밋된 eliteById에 임시 적용(tempApplied)을 덮어쓴 것. 임시 적용 중엔
  // 플랜이 그 정예화로 재계산되므로, 방 내용·스킬·정예화 배지도 같은 정예화로 그려야 어긋나지
  // 않는다(E2로 편성됐는데 배지는 E1로 뜨던 버그, 사용자 제보 2026-07-21). 로스터 설정 모달은
  // 커밋된 eliteById를 그대로 쓴다(실제 보유 상태 편집).
  const viewElite = useMemo(() => {
    if (!tempApplied.size) return eliteById;
    const m = new Map(eliteById);
    for (const [id, e] of tempApplied) { const op = opById.get(id); if (op && e >= maxElite(op.rarity)) m.delete(id); else m.set(id, e); }
    return m;
  }, [eliteById, tempApplied]);
  const effectiveOps = useMemo(() => visibleOps.map((op) => withElite(op, viewElite.get(op.id), levelById.get(op.id))), [visibleOps, viewElite, levelById]);
  const effectiveOpById = useMemo(() => new Map(effectiveOps.map((op) => [op.id, op])), [effectiveOps]);
  const roster = useMemo(() => effectiveOps.filter((op) => ownedIds.has(op.id)), [effectiveOps, ownedIds]);
  // 보유 중 아직 정예화를 완성 안 한(= 육성 추천 후보가 될 수 있는) 오퍼 수
  const unfinishedCount = useMemo(() => [...ownedIds].filter((id) => {
    const op = opById.get(id);
    return op && (eliteById.get(id) ?? maxElite(op.rarity)) < maxElite(op.rarity);
  }).length, [ownedIds, eliteById]);

  // 표시용 추천 = 숨김 제외 후 상위 20 — 숨기면 다음 순위가 자동으로 올라온다
  // ⚠ 카드 렌더는 현재 보이는 로스터(effectiveOpById)에 없는 오퍼를 말없이 버리므로, 여기서
  // 같은 기준으로 걸러야 "N명"과 실제 목록이 어긋나지 않는다 — 미래시 ON으로 분석해 두고
  // OFF로 돌아오면 헤더는 N명인데 목록이 텅 비던 경로 (사용자 제보 2026-07-25)
  const visibleRecs = useMemo(() => (investRecs
    ? investRecs.filter((r) => !investHidden.has(r.opId) && effectiveOpById.has(r.opId)).slice(0, INVEST_SHOW)
    : null), [investRecs, investHidden, effectiveOpById]);

  const persist = (ids: Set<string>, nextPlan: Plan | null, elite: Map<string, Elite> = eliteById, lvById: Map<string, number> = levelById, prio: ProdPriority = priority, invest: RaiseRec[] | null = investRecs, hidden: Set<string> = investHidden, lay: LayoutPreset = layout, lvls: Levels = levels, rooms: CustomRoom[] = customRooms, products: (CustomProduct | null)[] = customProducts, pins: Record<string, string[]> = dormPins) => {
    // 현재 프리셋 버킷을 최신 상태로 갱신한 뒤 전체 버킷을 저장 — 다른 프리셋의 편성은 보존된다
    syncBucket(lay, { plan: nextPlan, levels: lvls, invest, investHidden: Array.from(hidden), dormPins: pins });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        owned: Array.from(ids), elite: Array.from(elite.entries()), opLevels: Array.from(lvById.entries()), priority: prio,
        layout: lay, buckets: bucketsRef.current, customRooms: rooms, customProducts: products,
        // 구버전 호환 필드 (이 버전 이전 코드가 읽어도 현 프리셋 편성은 복원되게)
        plan: nextPlan, invest, investHidden: Array.from(hidden),
      }));
    } catch { /* ignore */ }
  };

  // 저장된 오퍼 레벨 복원 — [id, 1~90] 쌍만 인정 (손상 항목 무시)
  const restoreOpLevels = (raw: unknown): Map<string, number> => new Map(
    (Array.isArray(raw) ? raw : []).filter((e: unknown): e is [string, number] =>
      Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number"
      && Number.isFinite(e[1]) && e[1] >= 1 && e[1] <= MAX_OP_LEVEL),
  );

  // 저장된 그외(커스텀) 9칸 구성 복원 — 유효한 3종 시설명 9개일 때만
  const restoreCustomRooms = (raw: unknown): CustomRoom[] | null =>
    Array.isArray(raw) && raw.length === 9 && raw.every((room) => room === "MANUFACTURE" || room === "TRADING" || room === "POWER") ? raw as CustomRoom[] : null;

  // 저장된 커스텀 제조 품목 복원 — "gold"/"exp"/null 9개일 때만
  const restoreCustomProducts = (raw: unknown): (CustomProduct | null)[] | null =>
    Array.isArray(raw) && raw.length === 9 && raw.every((v) => v === "gold" || v === "exp" || v === null) ? raw as (CustomProduct | null)[] : null;

  // 저장된 숙소 고정 복원 — 실존 숙소 칸 · 실존 오퍼 id만 (손상·구버전 방어)
  const restoreDormPins = (raw: unknown): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [key, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!LAYOUT.some((cell) => cell.key === key && cell.room === "DORMITORY") || !Array.isArray(list)) continue;
      const ids = list.filter((id): id is string => typeof id === "string" && opById.has(id));
      if (ids.length) out[key] = ids;
    }
    return out;
  };

  // 저장된 숨김 목록 복원 — 실존 오퍼 id만
  const restoreHidden = (raw: unknown): Set<string> =>
    new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && opById.has(id)) : []);

  // 저장된 육성 추천 복원 — opId가 실존하고 필수 필드가 있는 항목만 (손상·구버전 방어)
  const restoreInvest = (raw: unknown): RaiseRec[] | null => {
    if (!Array.isArray(raw)) return null;
    return raw.filter((r): r is RaiseRec => {
      const o = r as Record<string, unknown> | null;
      return !!o && typeof o.opId === "string" && opById.has(o.opId) && typeof o.deltaScore === "number" && Array.isArray(o.roomDeltas) && !!o.cost;
    });
  };

  const exportImage = async () => {
    if (!plan) return;
    type Row = { cell: (typeof LAYOUT)[number]; crews: { label: string; team: InfraOp[]; score: number | null }[] };
    const controlTeamAt = (shift: number) => {
      const shifts = plan.assignments["CONTROL"] ?? [];
      return (shifts[Math.min(shift, shifts.length - 1)] ?? []).map((id) => effectiveOpById.get(id)).filter(Boolean) as InfraOp[];
    };
    const roomOfAt = [0, 1].map((shift) => roomOfFor(plan, shift));
    const cellOfAt = [0, 1].map((shift) => cellOfFor(plan, shift));
    const ambientAt = [0, 1].map((shift) => aurasOf(controlTeamAt(shift), ctxFor("CONTROL", shift === 0 ? plan.tokenPoints : {}, plan.factionCounts[shift] ?? {}, plan.plants, presentIdsFor(plan, shift), undefined, roomOfAt[shift], cellOfAt[shift])));
    const rows: Row[] = LAYOUT.map((cell) => {
      const shifts = plan.assignments[cell.key] ?? [];
      const scoreFor = (team: InfraOp[], shift: number) =>
        cell.room === "DORMITORY" || PARK_KEYS.includes(cell.key) ? null
          : Math.round(teamScore(team, cell.room, { ...ctxFor(cell.key, shift === 0 ? plan.tokenPoints : {}, plan.factionCounts[shift] ?? {}, plan.plants, presentIdsFor(plan, shift), ambientAt[shift], roomOfAt[shift], cellOfAt[shift]), shiftHours: plan.shiftHours?.[shift] }));
      const teamAt = (shift: number) => (shifts[Math.min(shift, shifts.length - 1)] ?? []).map((id) => effectiveOpById.get(id)).filter(Boolean) as InfraOp[];
      const single = cell.room === "DORMITORY" || cell.key === "TRAINING";
      if (single) {
        const team = teamAt(0);
        return { cell, crews: [{ label: cell.room === "DORMITORY" ? t("고정") : "-", team, score: scoreFor(team, 0) }] };
      }
      return { cell, crews: [0, 1].map((shift) => ({ label: ["A", "B"][shift], team: teamAt(shift), score: scoreFor(teamAt(shift), shift) })) };
    });
    const uniqueOps = Array.from(new Set(rows.flatMap((row) => row.crews.flatMap((crew) => crew.team))));
    const avatars = new Map<string, HTMLImageElement>();
    await Promise.all(uniqueOps.map((op) => new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous"; // R2(files.terra-archive.net) 아바타 — CORS 없이는 캔버스가 오염된다
      img.onload = () => { avatars.set(op.id, img); resolve(); };
      img.onerror = () => resolve();
      // ?cors: 그리드 <img>가 Origin 없이 받아 브라우저 캐시에 남긴 무-ACAO 응답을
      // crossOrigin 요청이 재사용하며 터지는 것을 캐시 키 분리로 차단 (실측 2026-07-27)
      img.src = `${asset(op.image)}?cors`;
    })));
    const W = 1240; const lineH = 46; const top = 150;
    const rowHeights = rows.map((row) => row.crews.length * lineH + 12);
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = top + rowHeights.reduce((a, b) => a + b, 0) + 70;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#f1f0eb"; g.fillRect(0, 0, W, canvas.height);
    g.fillStyle = "#131719"; g.fillRect(0, 0, W, 96);
    g.fillStyle = "#c3d24b"; g.font = "900 30px monospace"; g.fillText("TERRA ARCHIVE // RIIC PLAN", 32, 58);
    g.fillStyle = "#131719"; g.font = "700 15px sans-serif";
    g.fillText(`${strategyLabel(plan, locale, t)} · ${Object.entries(plan.tokenPoints).map(([token, points]) => t("{token} {n}점", { token: tokenName(locale, token), n: Math.round(points) })).join(" · ")}`, 32, 126);
    let y = top;
    rows.forEach((row, index) => {
      const h = rowHeights[index];
      g.fillStyle = index % 2 ? "#eceae3" : "#fbfbf8"; g.fillRect(24, y, W - 48, h - 8);
      g.fillStyle = ROOM_ACCENT[row.cell.room] ?? "#888"; g.fillRect(24, y, 5, h - 8);
      g.fillStyle = "#131719"; g.font = "800 15px sans-serif";
      g.fillText(t(row.cell.label), 44, y + 26);
      row.crews.forEach((crew, crewIndex) => {
        const cy = y + crewIndex * lineH;
        g.font = "900 13px monospace";
        const labelWidth = g.measureText(crew.label).width;
        const badgeWidth = Math.max(26, labelWidth + 14);
        g.fillStyle = "#131719";
        g.fillRect(210, cy + 10, badgeWidth, 26);
        g.fillStyle = "#c3d24b";
        g.fillText(crew.label, 210 + (badgeWidth - labelWidth) / 2, cy + 28);
        let x = 210 + badgeWidth + 12;
        for (const op of crew.team) {
          const img = avatars.get(op.id);
          if (img) g.drawImage(img, x, cy + 6, 34, 34);
          g.fillStyle = "#131719"; g.font = "700 12px sans-serif";
          g.fillText(op.name, x + 40, cy + 28);
          x += 40 + Math.max(g.measureText(op.name).width + 20, 76);
        }
        if (!crew.team.length) {
          g.fillStyle = "#9aa0a3"; g.font = "700 12px sans-serif";
          g.fillText(row.cell.key === "TRAINING" ? t("비워둠 (특화 훈련용)") : t("휴식 공간"), 248, cy + 28);
        }
        if (crew.score != null) {
          g.fillStyle = "#687176"; g.font = "800 13px monospace";
          const label = `+${crew.score}${row.cell.room === "CONTROL" ? "" : "%"}`;
          g.fillText(label, W - 48 - g.measureText(label).width, cy + 28);
        }
      });
      y += h;
    });
    g.fillStyle = "#687176"; g.font = "700 11px monospace";
    g.fillText(t("A = 풀파워 주간조 · B = 회복 교대조 · terra-archive infra planner"), 32, canvas.height - 28);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setImageUrl(URL.createObjectURL(blob)); // 미리보기 모달로 바로 표시
    });
  };

  const closeImage = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
  };

  const exportState = () => {
    const payload = JSON.stringify({ version: 1, exported: new Date().toISOString(), owned: Array.from(ownedIds), elite: Array.from(eliteById.entries()), opLevels: Array.from(levelById.entries()), plan, invest: investRecs, layout, levels, customRooms, customProducts, dormPins, buckets: { ...bucketsRef.current, [layout]: { plan, levels, invest: investRecs, investHidden: Array.from(investHidden), dormPins } } }, null, 1);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "terra-archive-infra.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setDirty(false);
    showToast(t("현재 상태를 파일로 저장했습니다"));
  };

  const importState = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const ids = new Set<string>((Array.isArray(data.owned) ? data.owned : []).filter((id: unknown): id is string => typeof id === "string" && opById.has(id)));
        // 정예화는 [id, 0|1|2] 쌍만 인정 (손상 항목 무시)
        const elite = new Map<string, Elite>(
          (Array.isArray(data.elite) ? data.elite : [])
            .filter((e: unknown): e is [string, Elite] => Array.isArray(e) && typeof e[0] === "string" && [0, 1, 2].includes(e[1] as number)),
        );
        // 파일의 기지 배치 프리셋·버킷 복원 — sanitizePlan이 활성 LAYOUT을 쓰므로 plan 정규화보다 먼저
        const lay: LayoutPreset = data.layout === "153" ? "153" : data.layout === "252" ? "252" : data.layout === "custom" ? "custom" : "243";
        const fileCustom = restoreCustomRooms(data.customRooms);
        if (fileCustom) setCustomRooms(fileCustom);
        const fileProducts = restoreCustomProducts(data.customProducts);
        if (fileProducts) setCustomProducts(fileProducts);
        setLayoutPreset(lay, fileCustom, fileProducts);
        setLayoutState(lay);
        const fileBuckets = (data.buckets && typeof data.buckets === "object" ? data.buckets : {}) as Partial<Record<LayoutPreset, LayoutBucket>>;
        for (const k of ["243", "153", "252", "custom"] as const) if (fileBuckets[k]) bucketsRef.current[k] = fileBuckets[k]!;
        const lvls: Levels = (data.levels && typeof data.levels === "object" ? data.levels : bucketsRef.current[lay]?.levels) ?? suggestedLevels(lay);
        setEngineLevels(lvls);
        setLevelsState(lvls);
        const plan = sanitizePlan(data.plan);
        const invest = restoreInvest(data.invest);
        const hidden = restoreHidden(data.investHidden);
        const pins = restoreDormPins(fileBuckets[lay]?.dormPins ?? data.dormPins);
        setDormPinsState(pins);
        const lvById = restoreOpLevels(data.opLevels);
        setOwnedIds(ids);
        setEliteById(elite);
        setLevelById(lvById);
        if (plan) { setPlan(plan); setActiveShift(0); }
        setInvestRecs(invest);
        setInvestHidden(hidden);
        setShowInvest(false);
        persist(ids, plan, elite, lvById, priority, invest, hidden, lay, lvls, fileCustom ?? customRooms, fileProducts ?? customProducts, pins);
        setDirty(false);
        showToast(t("저장된 상태를 불러왔습니다 · 보유 {n}명 복원", { n: ids.size }));
      } catch { alert(t("가져오기 실패: 파일 형식을 확인해 주세요.")); }
    };
    reader.readAsText(file);
  };

  const allAssigned = useMemo(() => {
    const set = new Set<string>();
    if (plan) for (const shifts of Object.values(plan.assignments)) for (const team of shifts) for (const id of team) set.add(id);
    return set;
  }, [plan]);

  // 방 모달에서 직접 편집: 해당 조의 팀을 교체하고 진영 카운트를 다시 센다.
  // 토큰 포인트·패키지 구성은 마지막 자동편성 기준으로 유지된다 (근사).
  const updateTeam = (cellKey: string, shiftIdx: number, ids: string[], pins?: Record<string, string[]>) => {
    if (!plan) return;
    const shifts = (plan.assignments[cellKey] ?? []).map((team, index) => (index === shiftIdx ? ids : team));
    const assignments = { ...plan.assignments, [cellKey]: shifts };
    const factionCounts = [0, 1].map((s) => {
      const counts: Record<string, number> = {};
      for (const c of LAYOUT) {
        const cellShifts = assignments[c.key] ?? [];
        const team = cellShifts[Math.min(s, cellShifts.length - 1)] ?? [];
        for (const id of team) {
          const op = effectiveOpById.get(id);
          if (op) for (const faction of factionsOf(op)) counts[faction] = (counts[faction] ?? 0) + 1;
        }
      }
      return counts;
    });
    const next = { ...plan, assignments, factionCounts };
    setPlan(next);
    const cleaned = pins && Object.fromEntries(Object.entries(pins).filter(([, list]) => list.length));
    if (cleaned) setDormPinsState(cleaned);
    persist(ownedIds, next, eliteById, levelById, priority, investRecs, investHidden, layout, levels, customRooms, customProducts, cleaned ?? dormPins);
    setDirty(true);
  };

  // 숙소 편성 변경 — 숙소는 조 전환과 무관한 단일 팀이라 항상 0번 슬롯을 고친다.
  // **직접 넣은 오퍼는 자동으로 고정(📌)**된다: 고정하지 않으면 다음 자동편성이 지워버려
  // "울피아누스를 숙소에 넣고 자동편성 → 언더플로우가 들어가나 보자"가 성립하지 않는다.
  // 빼면 고정도 함께 풀린다. 엔진이 넣은 인원(토큰 생성원·짝 주차)은 고정이 아니며,
  // 📌를 눌러 잠글 수 있다 (사용자 요청 2026-07-25).
  const updateDorm = (cellKey: string, ids: string[]) => {
    if (!plan) return;
    const before = plan.assignments[cellKey]?.[0] ?? [];
    const added = ids.filter((id) => !before.includes(id));
    const kept = (dormPins[cellKey] ?? []).filter((id) => ids.includes(id));
    updateTeam(cellKey, 0, ids, { ...dormPins, [cellKey]: [...kept, ...added.filter((id) => !kept.includes(id))] });
  };
  const toggleDormPin = (cellKey: string, opId: string) => {
    const cur = dormPins[cellKey] ?? [];
    const next = cur.includes(opId) ? cur.filter((id) => id !== opId) : [...cur, opId];
    const pins = Object.fromEntries(Object.entries({ ...dormPins, [cellKey]: next }).filter(([, list]) => list.length));
    setDormPinsState(pins);
    persist(ownedIds, plan, eliteById, levelById, priority, investRecs, investHidden, layout, levels, customRooms, customProducts, pins);
    setDirty(true);
  };

  // 이미 배치된 오퍼의 정예화 단계를 방 상세에서 바로 바꾼다 — 편성 자체는 그대로 두고
  // 해당 오퍼의 활성 스킬만 다시 계산된다 (전체 재배치는 자동편성 실행에서 별도로).
  const setOperatorElite = (id: string, elite: Elite) => {
    const next = new Map(eliteById);
    if (elite === 2) next.delete(id); else next.set(id, elite);
    setEliteById(next);
    persist(ownedIds, plan, next);
    setDirty(true);
  };

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  // 자동편성 진행 안내 — 계산이 수 초 걸려도 전수 비교가 우선(사용자 확정 2026-07-19)이라,
  // 엔진이 후보안 사이마다 진행 단계를 알려주면 로케일 문구로 표시한다
  const [optimizing, setOptimizing] = useState<string | null>(null);
  const stepMessage = (step: OptimizeStep): string => {
    if (step.phase === "base") return t("자동편성 엔진 계산 중 — 기본 편성 조립·전수 감사…");
    if (step.phase === "variant") return t("자동편성 엔진 계산 중 — 시너지 세트 후보안 {i}/{n} 평가…", { i: step.index ?? 0, n: step.total ?? 0 });
    if (step.index) return t("자동편성 엔진 계산 중 — 채택안 전수 감사 {crew}조 {i}/{n}회차 검수…", { crew: step.crew ?? "A", i: step.index, n: step.total ?? step.index });
    return t("자동편성 엔진 계산 중 — 최적안 비교·마무리 검증…");
  };

  const runOptimize = async (ids: Set<string> = ownedIds, elite: Map<string, Elite> = eliteById, prio: ProdPriority = priority, lvById: Map<string, number> = levelById) => {
    if (optimizing) return; // 중복 실행 방지
    // 페이싱 없음 (사용자 확정 2026-07-21: 최대한 빠르게) — 진행 문구만 갱신하고 지연은 두지
    // 않는다. 엔진 tick의 매크로태스크 양보(setTimeout 0)만으로 리페인트는 충분하다.
    setOptimizing(t("자동편성 엔진 계산 중 — 편성 공간 구성…"));
    try {
      const paced = (step: OptimizeStep) => { setOptimizing(stepMessage(step)); };
      const next = await optimizeOff({ owned: ids, elite, opLevels: lvById, includeFuture: !!includeFuture, priority: prio, layout, levels, customRooms, customProducts, dormPins }, paced);
      setPlan(next);
      setActiveShift(0);
      // 새 자동편성 → 기존 육성 추천·숨김 무효화 + 임시 적용 세션 종료(새 편성이 기준). 2026-07-21
      setInvestRecs(null);
      setInvestHidden(new Set());
      setInvestDiag(null);   // 진단값도 옛 편성 기준이라 함께 버린다
      setShowInvest(false);
      endTemp(false);
      persist(ids, next, elite, lvById, prio, null, new Set());
      // 실제 계산에 쓰인 인원 = 보유 ∩ 현재 표시 대상(미래시 토글 반영) — 미래시 OFF면 미실장 제외
      const usedCount = visibleOps.filter((op) => ids.has(op.id)).length;
      showToast(t("전체 자동편성을 실행했습니다 · 보유 {n}명 기준", { n: usedCount }));
    } finally {
      setOptimizing(null);
    }
  };

  // 육성(정예화 완성) 추천 — "이 오퍼를 키우면 인프라가 얼마나 좋아지나"를 감으로 추정하지
  // 않고, 현재 상태 로스터와 후보만 완성한 로스터로 각각 자동편성을 돌려 기지 총점 차이(ΔS)로
  // 증명한다. 후보 수만큼 optimize를 돌려 수십 초 걸릴 수 있어 워커에서 계산하고(INP),
  // 메인 스레드는 진행 바만 갱신한다 (계산 우선순위는 정확성 — INFRA-RULES §1).
  // 버튼: 캐시된 결과가 있으면 다시 계산 없이 그 모달을 연다 (사용자 확정 2026-07-21: 새
  // 자동편성 전까지 같은 결과 유지). 없으면 분석을 돌린다.
  const openInvest = () => {
    if (investing) return;
    // 캐시가 **비어 있으면** 그대로 열지 않고 다시 계산한다 — 0건 결과도 localStorage에
    // 저장되므로, 예전에 한 번 0건이 나왔으면(정예화를 아직 안 채웠을 때 등) 이후 아무리
    // 눌러도 빈 모달만 뜨고 재계산이 안 되던 문제 (사용자 제보 2026-07-25 "아무것도 안 뜬다")
    if (investRecs?.length) { setShowInvest(true); return; }
    void runInvest();
  };
  const runInvest = async () => {
    if (investing) return;
    endTemp(true); // 다시 분석 → 임시 적용 되돌리고 커밋된 로스터 기준으로 재분석
    setInvesting({ done: 0, total: 0 });
    try {
      let candidates = 0; // 엔진이 정밀 평가한 후보 수 — 0건 안내를 후보 유무로 갈라 쓴다
      const recs = await investOff({ owned: ownedIds, elite: eliteById, opLevels: levelById, includeFuture: !!includeFuture, priority, layout, levels, customRooms, customProducts, dormPins },
        (p) => { if (p.total) candidates = p.total; setInvesting(p); });
      setInvestDiag({ unfinished: unfinishedCount, candidates });
      setInvestRecs(recs);
      setInvestHidden(new Set()); // 새 분석 → 숨김 초기화
      persist(ownedIds, plan, eliteById, levelById, priority, recs, new Set());
      setShowInvest(true);
      if (!recs.length) {
        // 후보 자체가 없는 경우(전원 만정예 간주)와 후보는 있는데 이득이 없는 경우를 구분해 안내
        const lowered = [...ownedIds].filter((id) => { const op = opById.get(id); return op && (eliteById.get(id) ?? maxElite(op.rarity)) < maxElite(op.rarity); }).length;
        showToast(lowered
          ? t("완성하면 이득인 오퍼를 찾지 못했습니다 — 미완성 {n}명 모두 지금 편성을 바꾸지 못합니다", { n: lowered })
          : t("보유 오퍼 전원이 정예화 완성 상태로 잡혀 있습니다 — 보유 설정에서 아직 안 키운 오퍼의 정예화를 낮춰 주세요"));
      }
    } catch (error) {
      // 종전엔 catch가 없어 워커가 에러를 돌려주면 아무 일도 안 일어났다(모달·토스트 없음)
      showToast(t("육성 추천 계산에 실패했습니다 — {msg}", { msg: String((error as Error)?.message ?? error).slice(0, 120) }));
    } finally {
      setInvesting(null);
    }
  };

  // 육성 추천 '임시 적용' — 추천 오퍼(들)를 완성했다 가정한 미리보기 편성. 로스터 정예화를
  // 영구히 바꾸지 않고(비영구·되돌리기 가능), 추천 목록도 유지한다(사용자 확정 2026-07-21).
  // 커밋된 eliteById 위에 tempApplied를 덮어 재편성만 한다 — localStorage 저장 안 함.
  const mergedElite = (temp: Map<string, Elite>): Map<string, Elite> => {
    const m = new Map(eliteById);
    for (const [id, e] of temp) { const op = opById.get(id); if (op && e >= maxElite(op.rarity)) m.delete(id); else m.set(id, e); }
    return m;
  };
  // 미리보기 재편성 — persist·investRecs 갱신 없이 plan만 바꾼다 (임시 적용 전용)
  const previewOptimize = async (effElite: Map<string, Elite>) => {
    setOptimizing(t("자동편성 엔진 계산 중 — 편성 공간 구성…"));
    try {
      const paced = (step: OptimizeStep) => { setOptimizing(stepMessage(step)); };
      const next = await optimizeOff({ owned: ownedIds, elite: effElite, opLevels: levelById, includeFuture: !!includeFuture, priority, layout, levels, customRooms, customProducts, dormPins }, paced);
      setPlan(next);
      setActiveShift(0);
    } finally { setOptimizing(null); }
  };
  // 개별 추천 카드는 '선택'만 한다(즉시 재편성 X) — 모아서 '선택 임시 적용'으로 한 번에 반영
  const toggleSelectRaise = (opId: string) => {
    setSelectedRaise((prev) => { const next = new Set(prev); if (next.has(opId)) next.delete(opId); else next.add(opId); return next; });
  };
  // 추천 숨기기 — 목록에서 빼고(선택도 해제) 다음 순위 후보가 자동으로 올라온다
  const hideRaise = (opId: string) => {
    const next = new Set(investHidden);
    next.add(opId);
    setInvestHidden(next);
    setSelectedRaise((prev) => { if (!prev.has(opId)) return prev; const s = new Set(prev); s.delete(opId); return s; });
    persist(ownedIds, plan, eliteById, levelById, priority, investRecs, next);
  };
  // 정예화 오버레이 묶음(adds)을 기존 임시 적용에 더해 한 번에 미리보기 재편성
  const applyTempSet = async (adds: Map<string, Elite>, label: string) => {
    if (optimizing || investing || !adds.size) return;
    const nextTemp = new Map(tempApplied);
    for (const [id, to] of adds) nextTemp.set(id, to);
    if (!tempApplied.size) setTempBasePlan(plan); // 첫 임시 적용 시 되돌릴 편성 스냅샷
    setTempApplied(nextTemp);
    setSelectedRaise(new Set());
    setShowInvest(false); // 적용하면 모달을 닫아 편성에 반영되는 걸 보여준다 (사용자 요청 2026-07-21)
    await previewOptimize(mergedElite(nextTemp));
    showToast(label);
  };
  const applySelected = async () => {
    if (!visibleRecs) return;
    const adds = new Map<string, Elite>();
    for (const r of visibleRecs) if (selectedRaise.has(r.opId)) adds.set(r.opId, r.to);
    await applyTempSet(adds, t("선택 {n}명을 임시 적용했습니다 — '되돌리기'로 취소할 수 있습니다", { n: adds.size }));
  };
  const applyAllRaises = async () => {
    if (!visibleRecs?.length) return;
    // 전체 = 화면에 보이는 목록(숨긴 오퍼 제외) 전체
    const adds = new Map<string, Elite>(visibleRecs.map((r) => [r.opId, r.to]));
    await applyTempSet(adds, t("추천 {n}명을 임시 적용했습니다 — '되돌리기'로 취소할 수 있습니다", { n: adds.size }));
  };
  // 오퍼 하나만 임시 적용 해제 — 남은 임시 오퍼들로 미리보기 재편성 (마지막 하나면 전체 되돌리기)
  const revertTempOne = async (opId: string) => {
    if (optimizing || investing || !tempApplied.has(opId)) return;
    const next = new Map(tempApplied);
    next.delete(opId);
    if (!next.size) { revertTemp(); return; }
    setTempApplied(next);
    await previewOptimize(mergedElite(next));
    showToast(t("{name}의 임시 적용을 되돌렸습니다", { name: opById.get(opId)?.name ?? opId }));
  };
  // 임시 적용 되돌리기 — 스냅샷 편성으로 복원하고 세션 종료
  const revertTemp = () => {
    setSelectedRaise(new Set());
    if (!tempApplied.size) return;
    if (tempBasePlan) { setPlan(tempBasePlan); setActiveShift(0); }
    setTempApplied(new Map());
    setTempBasePlan(null);
    showToast(t("임시 적용을 되돌렸습니다"));
  };
  // 임시 적용 세션 종료 (전체 자동편성·다시 분석이 호출) — restore=true면 편성도 스냅샷 복원
  const endTemp = (restore: boolean) => {
    setSelectedRaise(new Set());
    if (!tempApplied.size) return;
    if (restore && tempBasePlan) { setPlan(tempBasePlan); setActiveShift(0); }
    setTempApplied(new Map());
    setTempBasePlan(null);
  };

  // endless(무한동력) 모드 동기화 — 메인 스레드 엔진 인스턴스의 비교 함수(대체 추천 순위 등)가
  // 현재 모드의 컨디션 보너스를 쓰도록 모듈 플래그를 맞춘다 (워커 쪽은 잡마다 buildPlan이 설정)
  useEffect(() => { setPriorityMode(priority); }, [priority]);

  // 편성 설정(라디오)은 설정일 뿐 — 실제 편성은 기존처럼 자동편성 버튼으로 실행한다
  // (사용자 확정 2026-07: 설정 변경이 편성을 갈아엎으면 안 됨)
  const setPriority = (prio: ProdPriority) => {
    if (prio === priority) return;
    setPriorityState(prio);
    persist(ownedIds, plan, eliteById, levelById, prio);
    showToast(t("편성 설정을 저장했습니다 — 다음 자동편성부터 적용됩니다"));
  };
  // 2축 구조 (사용자 확정 2026-07-28): 생산 축(무엇을 많이) × 운용 축(얼마나 오래) —
  // 저장은 결합 문자열 하나("gold" = 순금+효율, "gold+endless" = 순금+장기 지속)로 한다
  const { prod: prodAxis, drain: drainAxis } = splitPriority(priority);
  const setProdAxis = (axis: ProdAxis) => setPriority(joinPriority(axis, drainAxis));
  const setDrainAxis = (axis: DrainMode) => setPriority(joinPriority(prodAxis, axis));

  // 기지 배치 프리셋 전환 (사용자 요청 2026-07-24): 프리셋마다 편성·레벨·육성추천 버킷을
  // 따로 보관한다 — 현재 상태를 현 프리셋 버킷에 넣고, 대상 프리셋의 저장분을 그대로 복원
  // (사용자 확정: 전환할 때마다 자동편성하지 않는다 — 각자 한 번 편성해 두면 유지).
  const setLayoutChoice = (next: LayoutPreset) => {
    if (next === layout) return;
    // 1) 현재 프리셋 상태 저장
    syncBucket(layout, { plan, levels, invest: investRecs, investHidden: Array.from(investHidden), dormPins });
    // 2) 엔진 전환 후 대상 버킷 복원 (sanitize는 새 LAYOUT 기준이라 반드시 전환 뒤에)
    setLayoutPreset(next, customRooms, customProducts);
    const b = bucketsRef.current[next] ?? { plan: null, levels: suggestedLevels(next), invest: null, investHidden: [], dormPins: {} };
    const restored = b.plan ? sanitizePlan(b.plan) : null;
    setEngineLevels(b.levels);
    setLayoutState(next);
    setLevelsState(b.levels);
    setPlan(restored);
    setInvestRecs(b.invest);
    setInvestHidden(new Set(b.investHidden));
    setDormPinsState(restoreDormPins(b.dormPins));
    setShowInvest(false);
    setOpenRoom(null);
    setActiveShift(0);
    endTemp(false); // 임시 적용 세션은 프리셋 간 이월하지 않는다
    persist(ownedIds, restored, eliteById, levelById, priority, b.invest, new Set(b.investHidden), next, b.levels, customRooms, customProducts, restoreDormPins(b.dormPins));
    showToast(restored
      ? t("기지 배치 {p} — 저장된 편성을 복원했습니다", { p: next })
      : t("기지 배치 {p} — 처음이라 편성이 비어 있습니다. 전체 자동편성을 눌러 만들어 두면 유지됩니다", { p: next }));
    if (next === "custom") {
      setSwitchFlash(true);
      window.setTimeout(() => setSwitchFlash(false), 1700); // 0.8s × 2회 반짝임 후 해제
    }
  };

  // 시설 레벨 변경 (전력·레벨 시스템 2026-07-24): 슬롯이 줄면 그 방의 초과 인원을 양 조에서
  // 트림하고 진영 카운트를 재계산한다. 전력 수지·레벨 연동 스킬은 즉시 반영, 편성 최적화는
  // 자동편성 버튼으로 (설정 불변 원칙).
  const setRoomLevel = (key: string, lv: number) => {
    const room = cellByKey.get(key)?.room ?? key;
    const max = maxLevelOf(room);
    const next = { ...levels, [key]: Math.max(1, Math.min(max, lv)) };
    setEngineLevels(next);
    setLevelsState(next);
    let nextPlan = plan;
    if (plan) {
      const slots = infra.rooms[room]?.phases?.[next[key] - 1]?.slots ?? infra.rooms[room]?.slots ?? 1;
      const shifts = plan.assignments[key] ?? [];
      const trimmedCount = shifts.reduce((n, team) => n + Math.max(0, team.length - slots), 0);
      if (trimmedCount > 0) {
        const assignments = { ...plan.assignments, [key]: shifts.map((team) => team.slice(0, slots)) };
        const factionCounts = [0, 1].map((sh) => {
          const counts: Record<string, number> = {};
          for (const k of Object.keys(assignments)) {
            const cellShifts = assignments[k] ?? [];
            for (const id of cellShifts[Math.min(sh, cellShifts.length - 1)] ?? []) {
              const op = effectiveOpById.get(id);
              if (op) for (const faction of factionsOf(op)) counts[faction] = (counts[faction] ?? 0) + 1;
            }
          }
          return counts;
        });
        nextPlan = { ...plan, assignments, factionCounts };
        setPlan(nextPlan);
        showToast(t("레벨을 낮춰 슬롯이 줄었습니다 — 초과 인원 {n}명을 뺐습니다", { n: trimmedCount }));
      }
    }
    persist(ownedIds, nextPlan, eliteById, levelById, priority, investRecs, investHidden, layout, next);
  };

  // 사용자 지정(커스텀) 배치: 카드의 제조/무역/발전 전환 (사용자 요청 2026-07-24). 종류를 바꾸면
  // 같은 종류의 셀 키가 재번호되므로 현재 플랜은 새 LAYOUT 기준으로 정규화한다(사라진 방
  // 편성은 드랍 — 새 구성은 자동편성으로 다시 짠다).
  const changeCustomRoom = (slot: number, room: CustomRoom) => {
    const next = [...customRooms];
    next[slot] = room;
    setCustomRooms(next);
    setLayoutPreset("custom", next, customProducts);
    const sanitized = plan ? sanitizePlan(plan) : null;
    setPlan(sanitized);
    setOpenRoom(null);
    persist(ownedIds, sanitized, eliteById, levelById, priority, investRecs, investHidden, "custom", levels, next, customProducts);
    setDirty(true);
    showToast(t("칸 구성을 바꿨습니다 — 전체 자동편성으로 새 구성에 맞게 재편성하세요"));
  };

  // 커스텀 제조소 품목(순금/작전기록) 전환 — 셀 키는 그대로라 편성은 유지되고, 라벨·순금
  // 라인 수·우선순위·품목 전용 스킬 점수만 갱신된다. 재편성은 자동편성으로.
  const changeCustomProduct = (slot: number, product: CustomProduct) => {
    const next = [...customProducts];
    next[slot] = product;
    setCustomProducts(next);
    setLayoutPreset("custom", customRooms, next);
    persist(ownedIds, plan, eliteById, levelById, priority, investRecs, investHidden, "custom", levels, customRooms, next);
    setDirty(true);
    showToast(t("제조 품목을 바꿨습니다 — 자동편성으로 재편성하면 편성에 반영됩니다"));
  };

  // 현재 편성(수동 수정 포함)은 그대로 두고, 빈 슬롯만 한계 기여가 큰 미배치 오퍼로
  // 채운다 — 방 우선순위(순금→작전기록→무역→발전→사무실→응접실) 순서로 그리디
  const fillGaps = () => {
    if (!plan) return;
    const assignments: Record<string, string[][]> = Object.fromEntries(
      Object.entries(plan.assignments).map(([key, shifts]) => [key, shifts.map((team) => [...team])])
    );
    const usedAll = new Set<string>();
    for (const shifts of Object.values(assignments)) for (const team of shifts) for (const id of team) usedAll.add(id);
    let added = 0;
    for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
      const points = shift === 0 ? plan.tokenPoints : {};
      const counts: Record<string, number> = {};
      const present = new Set<string>(); // 이 조 기준 기지 내 배치 전원
      const roomOf = new Map<string, string>(); // 방까지 보는 조건(작업 시설 동반) 판정용
      const cellOf = new Map<string, string>(); // 시설 **개수** 조건(타락사쿰 쉐이) 판정용
      for (const [key, shifts] of Object.entries(assignments)) {
        for (const id of shifts[Math.min(shift, shifts.length - 1)] ?? []) {
          present.add(id);
          roomOf.set(id, cellByKey.get(key)?.room ?? key);
          cellOf.set(id, key);
          const op = effectiveOpById.get(id);
          if (op) for (const faction of factionsOf(op)) counts[faction] = (counts[faction] ?? 0) + 1;
        }
      }
      for (const key of [...PRODUCTION_KEYS, ...SUPPORT_KEYS]) {
        if (key === "TRAINING" || PARK_KEYS.includes(key)) continue; // 훈련실 비움·가공소 고정 정책 유지
        const cell = cellByKey.get(key)!;
        const shifts = assignments[key] ?? (assignments[key] = [[]]);
        const index = Math.min(shift, shifts.length - 1);
        const slots = slotsFor(key); // 시설 레벨 반영 (2026-07-24)
        while (shifts[index].length < slots) {
          const controlIds = assignments["CONTROL"]?.[Math.min(shift, (assignments["CONTROL"]?.length ?? 1) - 1)] ?? [];
          const controlTeam = controlIds.map((id) => effectiveOpById.get(id)).filter(Boolean) as InfraOp[];
          const ambientNow = aurasOf(controlTeam, ctxFor("CONTROL", points, counts, plan.plants, present, undefined, roomOf, cellOf));
          const ctx = { ...ctxFor(key, points, counts, plan.plants, present, ambientNow, roomOf, cellOf), shiftHours: plan.shiftHours?.[shift] };
          const team = shifts[index].map((id) => effectiveOpById.get(id)).filter(Boolean) as InfraOp[];
          const current = teamScore(team, cell.room, ctx);
          let best: InfraOp | null = null;
          let bestDelta = 0;
          for (const op of roster) {
            if (usedAll.has(op.id)) continue;
            if (AUTO_BENCH_IDS.has(op.id)) continue; // 자동편성 제외 명단 — 빈 자리 채우기도 자동이므로 동일 적용
            if (!op.skills.some((skill) => skillApplies(skill, cell.room, ctx.product))) continue;
            const delta = teamScore([...team, op], cell.room, ctx) - current;
            if (delta > bestDelta) { bestDelta = delta; best = op; }
          }
          if (!best) break;
          shifts[index].push(best.id);
          usedAll.add(best.id);
          present.add(best.id);
          roomOf.set(best.id, cell.room);
          cellOf.set(best.id, key);
          for (const faction of factionsOf(best)) counts[faction] = (counts[faction] ?? 0) + 1;
          added += 1;
        }
      }
    }
    if (added === 0) { showToast(t("채울 수 있는 빈 자리가 없습니다")); return; }
    const factionCounts = [0, 1].map((shift) => {
      const counts: Record<string, number> = {};
      for (const cell of LAYOUT) {
        const cellShifts = assignments[cell.key] ?? [];
        for (const id of cellShifts[Math.min(shift, cellShifts.length - 1)] ?? []) {
          const op = effectiveOpById.get(id);
          if (op) for (const faction of factionsOf(op)) counts[faction] = (counts[faction] ?? 0) + 1;
        }
      }
      return counts;
    });
    const next = { ...plan, assignments, factionCounts };
    setPlan(next);
    persist(ownedIds, next);
    setDirty(true);
    showToast(t("빈 자리 {n}곳을 채웠습니다 · 기존 편성 유지", { n: added }));
  };

  // 편성 전체 비우기 — 모든 방을 빈 슬롯으로 되돌린다(수동 배치 시작점). 되돌릴 수 없어 확인을 받는다.
  const clearAll = async () => {
    if (!plan) return;
    const ok = await confirm({
      title: t("편성 전체 비우기"),
      message: t("현재 편성을 전부 비웁니다. 되돌릴 수 없어요 — 계속할까요?"),
      confirmLabel: t("비우기"),
      danger: true,
    });
    if (!ok) return;
    // 시설 레벨도 프리셋 권장 기본값으로 리셋 (사용자 확정 2026-07-24) — 252 비우기 = 첫 진입과
    // 동일한 시작점(작전기록 Lv2·사무실 Lv2·숙소1 Lv2·숙소 Lv1, 540/540). 243·153은 만렙.
    const lvls = suggestedLevels(layout);
    setEngineLevels(lvls);
    setLevelsState(lvls);
    const assignments: Record<string, string[][]> = Object.fromEntries(
      Object.entries(plan.assignments).map(([key, shifts]) => [key, shifts.map(() => [])])
    );
    const next = { ...plan, assignments, tokenPoints: {}, factionCounts: plan.factionCounts.map(() => ({})) };
    setPlan(next);
    setActiveShift(0);
    persist(ownedIds, next, eliteById, levelById, priority, investRecs, investHidden, layout, lvls);
    setDirty(true);
    showToast(t("편성을 전부 비웠습니다 — 방을 눌러 수동 배치하거나 자동편성하세요"));
  };

  // '그 외' 드롭다운: 바깥 클릭·Esc로 닫기.
  // pointerdown 사용 + 열린 직후 350ms 무시 — 웹뷰의 지연 합성 mousedown이
  // 메뉴가 열린 뒤 도착해 "바깥 클릭"으로 오판·즉시 닫히는 것을 막는다.
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (event: PointerEvent) => {
      if (Date.now() - moreToggledAt.current < 350) return;
      if (!(event.target as HTMLElement).closest(".more-group")) setMoreOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(false); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onEsc); };
  }, [moreOpen]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        const ids = new Set<string>((data.owned as string[]).filter((id: string) => opById.has(id)));
        const elite = new Map<string, Elite>((data.elite as [string, Elite][] | undefined) ?? []);
        setOwnedIds(ids);
        setEliteById(elite);
        setLevelById(restoreOpLevels(data.opLevels));
        setInvestRecs(restoreInvest(data.invest)); // 저장된 육성 추천 복원 (모달은 버튼으로 연다)
        setInvestHidden(restoreHidden(data.investHidden));
        if (data.priority) setPriorityState(data.priority as ProdPriority);
        // 기지 배치 프리셋·버킷 복원 — sanitizePlan이 활성 LAYOUT을 쓰므로 반드시 plan 복원보다 먼저.
        // buckets가 없는 구버전 저장분은 현 프리셋 버킷으로 이관한다
        const savedLayout: LayoutPreset = data.layout === "153" ? "153" : data.layout === "252" ? "252" : data.layout === "custom" ? "custom" : "243";
        const savedCustom = restoreCustomRooms(data.customRooms);
        if (savedCustom) setCustomRooms(savedCustom);
        const savedProducts = restoreCustomProducts(data.customProducts);
        if (savedProducts) setCustomProducts(savedProducts);
        const rawBuckets = (data.buckets && typeof data.buckets === "object" ? data.buckets : {}) as Partial<Record<LayoutPreset, LayoutBucket>>;
        if (!data.buckets) {
          rawBuckets[savedLayout] = { plan: data.plan ?? null, levels: {}, invest: data.invest ?? null, investHidden: data.investHidden ?? [] };
        }
        for (const k of ["243", "153", "252", "custom"] as const) {
          const rb = rawBuckets[k];
          if (rb) bucketsRef.current[k] = {
            plan: rb.plan ?? null,
            levels: rb.levels && typeof rb.levels === "object" ? rb.levels : suggestedLevels(k),
            invest: Array.isArray(rb.invest) ? rb.invest : null,
            investHidden: Array.isArray(rb.investHidden) ? rb.investHidden : [],
            dormPins: restoreDormPins(rb.dormPins),
          };
        }
        if (savedLayout !== "243") { setLayoutPreset(savedLayout, savedCustom, savedProducts); setLayoutState(savedLayout); }
        const bucket = bucketsRef.current[savedLayout];
        const savedLevels = bucket?.levels ?? suggestedLevels(savedLayout);
        setEngineLevels(savedLevels);
        setLevelsState(savedLevels);
        if (bucket) { setInvestRecs(restoreInvest(bucket.invest)); setInvestHidden(restoreHidden(bucket.investHidden)); setDormPinsState(restoreDormPins(bucket.dormPins)); }
        // 손상·구버전 저장분 방어 — raw 복원은 assignments 등 누락 시 렌더 크래시
        // (개발 중간 상태가 저장된 localStorage에서 실제 발병, 2026-07-19). 정규화 실패면
        // 아래로 떨어져 새 편성을 만든다.
        if (bucket?.plan) {
          const savedPlan = sanitizePlan(bucket.plan);
          if (savedPlan) { setPlan(savedPlan); if (!data.priority && savedPlan.priority) setPriorityState(savedPlan.priority); return; }
        }
        // 마운트 시점엔 미래시 토글이 아직 복원 전(false)일 수 있으므로 미실장은 제외하고
        // 기본 편성을 만든다 — 미래시 포함 편성은 토글 후 자동편성 버튼으로 실행
        void optimizeOff({ owned: ids, elite, opLevels: restoreOpLevels(data.opLevels), includeFuture: false, priority: "gold", layout: savedLayout, levels: savedLevels, customRooms: savedCustom, customProducts: savedProducts }).then(setPlan);
        return;
      }
    } catch { /* fall through to defaults */ }
    void optimizeOff({ owned: new Set(ops.filter((op) => op.rarity <= 5).map((op) => op.id)), elite: new Map(), includeFuture: false, priority: "gold", layout: "243", levels: null }).then(setPlan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teamFor = (key: string, shift: number): InfraOp[] => {
    const shifts = plan?.assignments[key] ?? [];
    const team = shifts[Math.min(shift, shifts.length - 1)] ?? [];
    return team.map((id) => effectiveOpById.get(id)).filter(Boolean) as InfraOp[];
  };

  const pointsFor = (shift: number) => (shift === 0 && plan ? plan.tokenPoints : {});

  // 현재 조 기준 기지 내 배치 전원 — 기반시설 존재 조건(언더플로우+울피아누스) 판정용
  const presentIds = useMemo(() => (plan ? presentIdsFor(plan, activeShift) : undefined), [plan, activeShift]);
  // 배치 지도 — 숙소에서 쉬는 오퍼를 "작업 시설에 배치"로 오인하지 않도록 방까지 판정 (외드레르)
  const roomOf = useMemo(() => (plan ? roomOfFor(plan, activeShift) : undefined), [plan, activeShift]);
  // 칸 지도 — 시설 **개수** 조건(타락사쿰 '쉐이가 배치된 시설 1개당') 판정용
  const cellOf = useMemo(() => (plan ? cellOfFor(plan, activeShift) : undefined), [plan, activeShift]);

  // 제어센터 오라 — 대상 방(제조·무역·사무·응접) 점수와 서머리에 실제 합산된다
  const ambient = useMemo(() => {
    if (!plan) return undefined;
    const control = teamFor("CONTROL", activeShift);
    return aurasOf(control, ctxFor("CONTROL", pointsFor(activeShift), plan.factionCounts[activeShift], plan.plants, presentIds, undefined, roomOf, cellOf));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, activeShift, presentIds, eliteById]);

  // A조 방별 지속 시계 (사용자 요청 2026-07-28, 전 모드 표시) — 풀 컨디션 24 ÷ 방 순소모.
  // 한때 12 기준(절반)으로 낮췄었는데, 그 "절반 체감"은 총웨 오라 과대 계상(화식 스텝 무한 누적)
  // 등 율 오류의 착시였다 — 율 교정 후 24 기준이 사용자 계산("0.65면 ~30시간")과 일치한다.
  // 실제 교대는 병목 방·컨디션 12 신호에서 더 이르게 온다 (툴팁에 명시).
  // 병목(제일 빨리 닳는 방)에 맞춰 A조 전체를 한 번에 B조로 교대하는 운용이라, 방마다 배지 +
  // 조 탭에 병목 기준 전체 시계를 표시한다. 순소모 0(무한동력·양조 고정)은 ∞. 회복 오라·제어센터
  // 기본 효과를 반영한 모델값이라 저장된 보수적 시계(plan.shiftHours)와는 다르다. 표시 전용이라
  // 편성·점수엔 영향 없음(생산 3모드 --compare 무관).
  const drainClock = useMemo(() => {
    if (!plan) return null;
    const present = presentIdsFor(plan, 0);
    const amb = aurasOf(teamFor("CONTROL", 0), ctxFor("CONTROL", pointsFor(0), plan.factionCounts[0], plan.plants, present));
    const rooms = new Map<string, number>();
    let worst = 0;
    let worstKey: string | null = null;
    for (const cell of LAYOUT) {
      if (PARK_KEYS.includes(cell.key) || cell.key === "TRAINING" || cell.key.startsWith("DORM")) continue;
      const team = teamFor(cell.key, 0);
      if (!team.length) continue;
      const ctx = { ...ctxFor(cell.key, pointsFor(0), plan.factionCounts[0], plan.plants, present, amb), shift: 0 };
      const net = roomMaxNetDrain(team, cell.room, ctx);
      if (net == null) continue;
      rooms.set(cell.key, net);
      if (net > worst) { worst = net; worstKey = cell.key; }
    }
    return { rooms, worstKey, hours: worst <= 1e-9 ? Infinity : 24 / worst };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, eliteById]);

  const summary = useMemo(() => {
    if (!plan) return null;
    const avg = (prefix: string) => {
      const keys = LAYOUT.filter((cell) => cell.key.startsWith(prefix)).map((cell) => cell.key);
      const totals = keys.map((key) => teamScore(teamFor(key, activeShift), cellByKey.get(key)!.room, { ...ctxFor(key, pointsFor(activeShift), plan.factionCounts[activeShift], plan.plants, presentIds, ambient, roomOf, cellOf), shiftHours: plan.shiftHours?.[activeShift] }));
      return totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0;
    };
    return {
      strategy: plan.strategy,
      manufacture: avg("MANUFACTURE"),
      trading: avg("TRADING"),
      power: avg("POWER"),
      staffed: allAssigned.size,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, activeShift, allAssigned, presentIds, ambient, eliteById]);

  // 커밋 정예화 기준 op 맵 — 임시 적용 '이전' 편성 점수 계산용(현재 effectiveOpById는 임시 반영본)
  const committedOpById = useMemo(() => new Map(visibleOps.map((op) => [op.id, withElite(op, eliteById.get(op.id), levelById.get(op.id))])), [visibleOps, eliteById, levelById]);

  // 임의 plan+조의 방 %효율 — teamScore + 제어센터 오라. before(스냅샷)/after(현재)를 같은 식으로.
  const scoreRoomIn = (p: Plan, opMap: Map<string, InfraOp>, key: string, shift: number): number => {
    const room = cellByKey.get(key)?.room;
    if (!room) return 0;
    const teamAt = (k: string) => (p.assignments[k]?.[Math.min(shift, (p.assignments[k]?.length ?? 1) - 1)] ?? []).map((id) => opMap.get(id)).filter(Boolean) as InfraOp[];
    const points = shift === 0 ? p.tokenPoints : {};
    const counts = p.factionCounts[shift] ?? {};
    const present = presentIdsFor(p, shift);
    const rooms = roomOfFor(p, shift);
    const cells = cellOfFor(p, shift);
    const amb = aurasOf(teamAt("CONTROL"), ctxFor("CONTROL", points, counts, p.plants, present, undefined, rooms, cells));
    return teamScore(teamAt(key), room, { ...ctxFor(key, points, counts, p.plants, present, amb, rooms, cells), shiftHours: p.shiftHours?.[shift] });
  };

  // 임시 적용 전(tempBasePlan·커밋 정예화) → 후(현재 plan·임시 정예화) 방별 %효율 변화 — 전체 표시용.
  // 제어센터·훈련실·가공소·숙소는 제외(제어 효과는 버프받는 방에 드러남). Δ<0.5%p는 무시.
  const tempDiffs = useMemo(() => {
    if (!tempApplied.size || !tempBasePlan || !plan) return null;
    const skip = new Set(["DORMITORY", "WORKSHOP", "TRAINING", "CONTROL"]);
    const rows: { key: string; label: string; shift: number; before: number; after: number }[] = [];
    for (const cell of LAYOUT) {
      if (skip.has(cell.room)) continue;
      for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
        const before = scoreRoomIn(tempBasePlan, committedOpById, cell.key, shift);
        const after = scoreRoomIn(plan, effectiveOpById, cell.key, shift);
        if (Math.abs(after - before) < 0.5) continue;
        rows.push({ key: cell.key, label: cell.label, shift, before: Math.round(before), after: Math.round(after) });
      }
    }
    rows.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempApplied, tempBasePlan, plan, committedOpById, effectiveOpById]);
  const tempTotalA = tempDiffs?.filter((d) => d.shift === 0).reduce((s, d) => s + (d.after - d.before), 0) ?? 0;
  const tempTotalB = tempDiffs?.filter((d) => d.shift === 1).reduce((s, d) => s + (d.after - d.before), 0) ?? 0;

  // 전력 수지 (전력·레벨 시스템 2026-07-24) — 발전소 공급 vs 나머지 시설 소비
  const power = useMemo(() => powerBudget(levels), [levels, layout, customRooms]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCell = LAYOUT.find((cell) => cell.key === openRoom);

  return (
    <section className="planner">
      {confirmDialog}
      {/* 헤더 재구성 (사용자 요청 2026-07-27): RIIC 문구는 기지 배치·우선 생산 행 밑으로
          내려보내고, 버튼 5개는 전폭 한 줄(오른쪽 정렬)로 — '그 외'가 밑줄로 밀리지 않게 */}
      <div className="planner-controls">
        <h2>{t("인프라 자동편성기")}</h2>
        <div className="planner-buttons">
          {/* startTransition: 로스터 모달(카드 수백 장)은 렌더가 무거워 클릭 페인트부터 내보낸다 (INP, 2026-07-21) */}
          {/* 보유 오퍼 설정·전체 자동편성 = 핵심 2버튼(.primary) — 나머지는 보조 톤으로 낮춰
              위계를 만든다 (사용자 요청 2026-07-27: "버튼이 너무 많아 헷갈림") */}
          <button className="primary" onClick={() => startTransition(() => { setRosterMode("direct"); setShowRoster(true); })}><span className="btn-icon" aria-hidden>▦</span>{t("보유 오퍼 설정 ({a}/{b})", { a: visibleOps.filter((op) => ownedIds.has(op.id)).length, b: visibleOps.length })}{isNewFeature("scanner") && <span className="new-badge">{t("새기능")}</span>}</button>
          {/* 라벨이 '계산 중…'으로 바뀌어도 버튼 폭이 줄지 않게 원 라벨로 폭을 잡아둔다 (사용자 요청 2026-07-21) */}
          <button className="primary" onClick={() => runOptimize()} disabled={!!optimizing}>
            <span className="btn-icon" aria-hidden>⟳</span>
            <span className="btn-swap">
              <span className={optimizing ? "btn-swap-hidden" : undefined}>{t("전체 자동편성")}</span>
              {optimizing && <span className="btn-swap-over">{t("계산 중…")}</span>}
            </span>
          </button>
          <button onClick={fillGaps} title={t("현재 편성(수동 수정 포함)은 그대로 두고, 남은 빈 자리만 효율 순으로 자동 편성합니다")}><span className="btn-icon" aria-hidden>⊕</span>{t("빈 자리만 자동편성")}</button>
          <button onClick={clearAll} title={t("모든 방의 편성을 비웁니다 (보유 오퍼 설정은 유지)")}><span className="btn-icon" aria-hidden>⌫</span>{t("편성 전체 비우기")}</button>
          {/* 이미지·파일·도움말은 '그 외' 드롭다운으로 묶는다 (사용자 요청 2026-07) */}
          <span className="more-group">
            <button className={`more-toggle${dirty ? " save-pending" : ""}`} aria-expanded={moreOpen} aria-haspopup="menu"
              onClick={toggleMore}><span className="btn-icon" aria-hidden>⋯</span>{t("그 외")}</button>
            {moreOpen && (
              <div className="more-menu" role="menu">
                <button role="menuitem" onClick={() => { setMoreOpen(false); exportImage(); }} title={t("A조·B조 편성표를 이미지로 확인 (PNG)")}><span className="btn-icon" aria-hidden>⧉</span>{t("이미지로 보기")}</button>
                <button role="menuitem" className={dirty ? "save-pending" : undefined} onClick={() => { setMoreOpen(false); exportState(); }} title={dirty ? t("저장 후 변경 사항이 있습니다 — 파일로 저장하세요") : t("보유 오퍼와 편성을 JSON 파일로 저장")}><span className="btn-icon" aria-hidden>⤓</span>{t("현재 상태 파일로 저장")}</button>
                <label className="import-label" role="menuitem">
                  <span className="btn-icon" aria-hidden>⤒</span>{t("저장된 상태 파일 가져오기")}
                  <input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) importState(file); event.target.value = ""; setMoreOpen(false); }} />
                </label>
                <button role="menuitem" onClick={() => { setMoreOpen(false); setShowMaa(true); }} title={t("현재 편성을 MAA 커스텀 기반시설 JSON으로 내보냅니다")}><span className="btn-icon" aria-hidden>⇥</span>{t("MAA 기반시설 내보내기")}<span className="new-badge">{t("베타")}</span></button>
                <button role="menuitem" onClick={() => { setMoreOpen(false); setShowHelp(true); }}><span className="btn-icon" aria-hidden>?</span>{t("도움말")}</button>
              </div>
            )}
          </span>
        </div>
      </div>

      {/* 진행 안내는 레이아웃을 밀지 않게 완료 토스트와 같은 자리에 오버레이로 (사용자 요청 2026-07-21) */}
      {optimizing && (
        <div className="toast opt-progress-toast" role="status" aria-live="polite">
          <span className="opt-progress-spin" aria-hidden>⟳</span> {optimizing}
        </div>
      )}
      {investing && (
        <div className="toast opt-progress-toast" role="status" aria-live="polite">
          <span className="opt-progress-spin" aria-hidden>⟳</span>{" "}
          {investing.total
            ? t("육성 추천 분석 중 — 후보 {i}/{n}, 완성 시 편성을 다시 계산해 이득 검증 중…", { i: investing.done, n: investing.total })
            : t("육성 추천 분석 중 — 현재 상태 기준 편성 계산…")}
        </div>
      )}

      {showInvest && visibleRecs && !investing && (
        <InvestPanel recs={visibleRecs} opMap={effectiveOpById} onShowOperator={onShowOperator}
          onClose={() => setShowInvest(false)} onReanalyze={() => { void runInvest(); }}
          onToggleSelect={toggleSelectRaise} onApplySelected={applySelected} onApplyAll={applyAllRaises} onHide={hideRaise}
          selected={selectedRaise} applied={new Set(tempApplied.keys())} onRevert={revertTemp}
          diag={investDiag} hiddenCount={investRecs?.filter((r) => investHidden.has(r.opId)).length ?? 0}
          onUnhideAll={() => { setInvestHidden(new Set()); persist(ownedIds, plan, eliteById, levelById, priority, investRecs, new Set()); }}
          onOpenRoster={() => { setShowInvest(false); startTransition(() => { setRosterMode("direct"); setShowRoster(true); }); }}
          t={t} locale={locale} />
      )}

      {/* 편성 설정 (라디오) — 다음 자동편성부터 적용, 편성 실행은 버튼으로 */}
      {/* 설정 행 — 기지 배치 → 운용 방식 → 우선 생산 순 (2026-07-28 순서 교체). 사용자 지정
          배치에선 품목을 칸마다 직접 고르므로 우선 생산 라디오를 숨긴다 (사용자 요청 2026-07-24) */}
      <div className="prio-setting">
        <span className="prio-label">🏗 {t("기지 배치")}{isNewFeature("layout-153") && <span className="new-badge">{t("새기능")}</span>}</span>
        {(["243", "153", "252", "custom"] as const).map((preset) => (
          <label key={preset} className={layout === preset ? "on" : ""}
            title={preset === "243" ? t("무역소 2 · 제조소 4(순금 2+작전기록 2) · 발전소 3")
              : preset === "153" ? t("무역소 1 · 제조소 5(순금 1+작전기록 4) · 발전소 3")
              : preset === "252" ? t("무역소 2 · 제조소 5(순금 2+작전기록 3) · 발전소 2 — 전력 부족: 작전기록 제조소 Lv2·사무실 Lv2·숙소 Lv1(첫 숙소만 Lv2) 권장, 정확히 540/540")
              : t("제조소·무역소·발전소 9칸을 자유 구성합니다 — 방 카드의 제조소/무역소/발전소 버튼으로 종류를 바꿉니다")}>
            <input type="radio" name="base-layout" checked={layout === preset} onChange={() => setLayoutChoice(preset)} />
            {preset === "custom" ? t("사용자 지정") : preset}
          </label>
        ))}
        {layout !== "custom" && (
          <>
            {/* 운용 방식 ⇄ 우선 생산 순서 교체 (사용자 요청 2026-07-28) — 두 축은 직교라
                순서만 바뀌고 동작·저장 값은 그대로다 */}
            <span className="prio-label prio-label-layout" title={t("컨디션(피로도)을 어떻게 다룰지 — 우선 생산과 자유롭게 조합됩니다 (예: 순금 우선 + 장기 지속)")}>⏱ {t("운용 방식")}</span>
            {(["off", "endless"] as const).map((axis) => (
              <label key={axis} className={drainAxis === axis ? "on" : ""}
                title={axis === "off" ? t("컨디션은 따지지 않고 생산 효율만 봅니다 — 자주 들여다보며 교대해 주는 운용")
                  : t("주력인 A조를 컨디션 소모·회복까지 계산해 오래가게 짭니다 — 소모는 효율과 저울질(1순위 아님), B조는 A조가 쉬는 동안의 생산 교대. 제어센터에 무한동력(순소모 0) 조합이 가능한 로스터면 그 조합을 무조건 우선합니다")}>
                <input type="radio" name="drain-mode" checked={drainAxis === axis} onChange={() => setDrainAxis(axis)} />
                {t(axis === "off" ? "효율 우선" : "장기 지속")}
                {axis === "endless" && isNewFeature("endless") && <span className="new-badge">{t("새기능")}</span>}
              </label>
            ))}
            <span className="prio-label prio-label-layout" title={t("먼저 채우는 방이 최고 요원을 가져갑니다 — 다음 자동편성부터 적용됩니다")}>⚙ {t("우선 생산")}</span>
            {(["gold", "exp", "balance"] as const).map((axis) => (
              <label key={axis} className={prodAxis === axis ? "on" : ""}>
                <input type="radio" name="prod-priority" checked={prodAxis === axis} onChange={() => setProdAxis(axis)} />
                {t(axis === "gold" ? "순금 우선" : axis === "exp" ? "작전기록 우선" : "밸런스")}
              </label>
            ))}
          </>
        )}
      </div>

      {/* 항상 렌더해 높이를 처음부터 예약 — 계산 전엔 '—'로 채운다. 계산 완료 후 값이 튀어나오며
          아래 배치도를 밀어내던 CLS 방지 (사용자 리포트 2026-07-20). summary가 있으면 plan도 항상 있음. */}
      <div className="planner-summary">
        {/* 전략 상세(패키지 구성·토큰 점수)는 길어서 카드를 세로로 늘리므로 시너지 트리
            모달로 넘기고, 카드엔 클릭 안내만 둔다 (사용자 요청 2026-07-25) */}
        <button type="button" className="strategy-cell" onClick={() => setShowFlows(true)} disabled={!plan}
          title={plan ? `${strategyLabel(plan, locale, t)}${Object.keys(plan.tokenPoints).length > 0 ? ` · ${Object.entries(plan.tokenPoints).map(([token, points]) => t("{token} {n}점", { token: tokenName(locale, token), n: Math.round(points) })).join(" · ")}` : ""}` : undefined}>
          <span>{t("전략")}</span>
          <b className="strategy">{plan ? t("시너지 트리 보기 ▸") : "—"}</b>
        </button>
        <div><span>{t("제조소 평균")}</span><b>{summary ? `+${summary.manufacture}%` : "—"}</b></div>
        <div><span>{t("무역소 평균")}</span><b>{summary ? `+${summary.trading}%` : "—"}</b></div>
        <div><span>{t("드론 회복 평균 효율")}</span><b>{summary ? `+${summary.power}%` : "—"}</b></div>
        {/* 전력 수지 — 발전소 phases 공급(만렙 270×기수) vs 시설 소비. 음수면 게임에서 성립 불가.
            소비/공급 슬래시 표기 + 시설별 내역 툴팁 (사용자 요청 2026-07-24) */}
        <div className={power.net < 0 ? "power-cell over" : "power-cell"}
          title={`${t("발전소 공급 {p} − 시설 소비 {c}. 음수면 시설 레벨을 낮춰야 합니다 (방을 눌러 레벨 조절)", { p: power.provide, c: power.consume })}\n${LAYOUT.map((cell) => {
            const e = infra.rooms[cell.room]?.phases?.[levelOf(cell.key) - 1]?.electricity ?? 0;
            return `${t(cell.label)} Lv${levelOf(cell.key)}: ${e > 0 ? "+" : ""}${e}`;
          }).join("\n")}`}>
          <span>⚡ {t("전력")}</span><b>{power.net >= 0 ? `+${power.net}` : power.net} <i className="power-detail">({power.consume}/{power.provide})</i></b>
        </div>
        <div><span>{t("기용 인원")}</span><b>{summary ? t("{n}명", { n: summary.staffed }) : "—"}</b></div>
      </div>

      <div className={`ship${layout !== "243" ? ` ship-${layout}` : ""}`}>
        {/* 교대 탭 + 육성 추천을 그리드 첫 행(제어센터·응접실과 같은 행)에 세로로 쌓는다 —
            탭은 행 맨 위, 추천 바는 행 바닥(=무역소 바로 위) (사용자 요청 2026-07-27) */}
        <div className="ship-leftcol">
          {plan && (
            <div className="shift-tabs">
              {Array.from({ length: SHIFT_COUNT }, (_, i) => (
                <button key={i} className={activeShift === i ? "selected" : ""} onClick={() => setActiveShift(i)}>{[t("A조 (풀파워)"), t("B조 (회복 교대)")][i]}</button>
              ))}
              {drainClock && (
                <span className="shift-clock" title={t("제일 빨리 닳는 시설의 완전 소진 기준 — 그 전에(대개 컨디션 12 신호쯤) A조 전체를 B조로 한 번에 교대합니다. 특히 제어센터가 먼저 지치면 감면이 꺼져 전 방이 가속되니 병목보다 늦으면 안 됩니다. 전원이 풀 컨디션(24)에서 시작한다고 본 추정치라, 오퍼별 현재 피로도에 따라 실제 시간은 달라집니다")}>
                  {drainClock.hours === Infinity
                    ? t("A조 전체 무한동력 ∞ — 교대 불필요")
                    : t("A조 ~{h}시간 — {room} 기준 일괄 교대", { h: Math.round(drainClock.hours), room: t(cellByKey.get(drainClock.worstKey!)?.label ?? "") })}
                </span>
              )}
              {/* 시계 배지 옆 짧은 단서 + 그 아래 짧은 교대 정책 — 둘 다 **클릭하면 상세 모달**
                  (사용자 요청 2026-07-28). 왼쪽 칸이 제어센터·응접실 높이를 밀어올리지 않도록
                  줄글은 전부 모달로 내리고 여기엔 한 줄짜리 링크만 남긴다. */}
              {/* 두 링크는 한 덩어리(flex 아이템 하나)로 묶어 구분선 '|'과 함께 같은 줄에
                  머물게 한다 — 따로 두면 폭에 따라 둘이 갈라진다 (사용자 요청 2026-07-28) */}
              <span className="shift-notes">
                {drainClock && drainClock.hours !== Infinity && (
                  <>
                    <button type="button" className="shift-note-link" onClick={() => setShiftNote("drain")}
                      title={t("표시된 시간은 전원 풀 컨디션(24)으로 시작한다고 본 추정치입니다 — 오퍼별 현재 피로도에 따라 실제 교대 시점은 달라질 수 있습니다")}>
                      {t("※ 지속시간은 피로도에 따라 변동")}
                    </button>
                    <i aria-hidden>|</i>
                  </>
                )}
                <button type="button" className="shift-note-link" onClick={() => setShiftNote("policy")}>
                  {t("※ A조 지치면 B조 교대")}
                </button>
              </span>
            </div>
          )}
          <div className={`ship-raisebar${(investing || (tempApplied.size === 0 && !investRecs)) ? " idle" : " boxed"}`} role="group" aria-label={t("인프라 오퍼 육성 추천")}>
          {tempApplied.size > 0 && !investing ? (
            <>
              <span className="srb-top">★ {t("임시 적용 중 · {n}명", { n: tempApplied.size })}</span>
              <span className="srb-gain">
                <span className="a">{t("A조 +{n}%p", { n: Math.round(tempTotalA) })}</span>
                <span className="b">{t("B조 +{n}%p", { n: Math.round(tempTotalB) })}</span>
              </span>
              <span className="srb-btns">
                <button onClick={() => setShowInvest(true)}>{t("추천 열기")}</button>
                <button className="revert" onClick={revertTemp}>{t("되돌리기")}</button>
              </span>
            </>
          ) : visibleRecs?.length && !investing ? (
            <>
              <span className="srb-top">★ {t("인프라 오퍼 육성 추천")}{isNewFeature("invest") && <span className="new-badge">{t("새기능")}</span>}</span>
              <span className="srb-btns">
                <button className="run" onClick={() => setShowInvest(true)}>{t("추천 열기 ({n})", { n: visibleRecs?.length ?? 0 })}</button>
                <button onClick={() => { void runInvest(); }}>{t("다시 분석")}</button>
              </span>
            </>
          ) : (
            // 대기·분석중 공용 — 두 라벨을 겹쳐(overlay) 폭을 idle 라벨에 고정, 분석 중에도 버튼 길이 불변
            <button className="srb-run" onClick={openInvest} disabled={!!investing}
              title={t("보유했지만 아직 완성하지 않은(정예화를 낮춰 둔) 오퍼 중, 완성하면 인프라 효율이 오르는 오퍼를 실제 자동편성을 다시 돌려 찾아냅니다")}>
              {/* 전제조건을 눈에 보이게 — 정예화를 낮춰 둔 오퍼가 0명이면 분석해도 후보가 없다
                  (전원 만정예 가정이 기본값이라 "왜 아무것도 안 뜨지"의 최대 원인, 2026-07-25) */}
              <span className={`srb-lbl${investing ? " hide" : ""}`}>★ {t("인프라 오퍼 육성 추천")}{isNewFeature("invest") && <span className="new-badge">{t("새기능")}</span>}<em className="srb-sub">{t("미완성 {n}명", { n: unfinishedCount })}</em></span>
              {investing && <span className="srb-over">★ {investing.total ? t("분석 중 {i}/{n}", { i: investing.done, n: investing.total }) : t("분석 중…")}</span>}
            </button>
          )}
          </div>
        </div>
        {LAYOUT.map((cell) => {
          if (cell.room === "DORMITORY") {
            const pinned = teamFor(cell.key, 0);
            const locked = dormPins[cell.key] ?? [];
            return (
              // 숙소도 클릭 → 상세 모달 (사용자 요청 2026-07-24) — 레벨 조절(전력·숙소 연동 스킬)용.
              // 편성은 시너지 고정 전용이라 모달에서 읽기 전용.
              <button key={cell.key} type="button" className={`ship-room dorm-room pos-${cell.key.toLowerCase()}`} onClick={() => setOpenRoom(cell.key)} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
                <div className="ship-room-head"><b>{t(cell.label)}<em className={`room-lv${levelOf(cell.key) < maxLevelOf(cell.room) ? "" : " max"}`}>Lv{levelOf(cell.key)}</em></b><span>{locked.length ? t("고정 {n}명", { n: locked.length }) : t("휴식")}</span></div>
                {/* 얼굴은 **클릭 대상이 아니다** — 다른 시설 카드와 동일하게 카드 전체가 방 상세를
                    여는 버튼이고 썸네일은 표시 전용 (사용자 요청 2026-07-28). 편성 안내 문구도
                    카드에서 빼 숙소 상세 안으로 옮겼다. */}
                <div className="ship-room-crew">
                  {pinned.map((op) => (
                    <img key={op.id} src={asset(op.image)} alt={op.name} width={180} height={180}
                      className={locked.includes(op.id) ? "dorm-locked" : undefined}
                      title={locked.includes(op.id) ? t("{name} — 숙소 고정 (자동편성이 유지)", { name: op.name }) : op.name}
                      loading="lazy" />
                  ))}
                  {!pinned.length && <i>{t("휴식 공간")}</i>}
                </div>
              </button>
            );
          }
          const team = teamFor(cell.key, activeShift);
          const spec = infra.rooms[cell.room];
          const cellCtx = { ...ctxFor(cell.key, pointsFor(activeShift), plan?.factionCounts?.[activeShift], plan?.plants, presentIds, ambient, roomOf), shiftHours: plan?.shiftHours?.[activeShift] };
          const score = Math.round(teamScore(team, cell.room, cellCtx));
          // 제어센터 오라 수신분 — 카드 총점이 "오퍼 스킬 합과 달라 보이는" 이유를 명시
          // (플레임테일 B조: 작전기록 +30 / 순금 -30 등. 사용자 지적 2026-07-19)
          const ambientPart = score - Math.round(teamScore(team, cell.room, { ...ctxFor(cell.key, pointsFor(activeShift), plan?.factionCounts?.[activeShift], plan?.plants, presentIds, undefined, roomOf), shiftHours: plan?.shiftHours?.[activeShift] }));
          // 임시 적용 중이면 원래(스냅샷·커밋 정예화) 효율 대비 변화를 방 카드에 인플레이스 표시
          const raiseBefore = tempApplied.size > 0 && tempBasePlan && cell.room !== "CONTROL" && !PARK_KEYS.includes(cell.key)
            ? Math.round(scoreRoomIn(tempBasePlan, committedOpById, cell.key, activeShift)) : null;
          return (
            <button key={cell.key} type="button" className={`ship-room ${cell.slot != null ? `pos-slot-${cell.slot}` : `pos-${cell.key.toLowerCase()}`}`} onClick={() => setOpenRoom(cell.key)} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
              <div className="ship-room-head">
                <b>
                  {/* 사용자 지정 제조소: 제목의 품목 자리에 2버튼 그룹 — 제조/무역/발전 토글과 동일한 모양
                      (사용자 요청 2026-07-24: 칩 5개 한 줄은 헷갈림 → 품목은 제목 자리, 종류는 아래 행) */}
                  {layout === "custom" && cell.slot != null && cell.room === "MANUFACTURE"
                    ? <>{t("제조소 {n}", { n: Number(cell.key.split("-")[1]) + 1 })}
                      <span className="room-type-switch product-inline" role="group" aria-label={t("제조 품목 변경")} onClick={(event) => event.stopPropagation()}>
                        {(["gold", "exp"] as const).map((productType) => (
                          <span key={productType} role="button" tabIndex={0} className={cell.product === productType ? "on" : ""}
                            onClick={(event) => { event.stopPropagation(); if (cell.product !== productType) changeCustomProduct(cell.slot!, productType); }}
                            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); if (cell.product !== productType) changeCustomProduct(cell.slot!, productType); } }}>
                            {t(productType === "gold" ? "순금" : "작전기록")}
                          </span>
                        ))}
                      </span></>
                    : t(cell.label)}
                  <em className={`room-lv${levelOf(cell.key) < maxLevelOf(cell.room) ? "" : " max"}`}>Lv{levelOf(cell.key)}</em>
                </b>
                <span>
                  {activeShift === 0 && drainClock?.rooms.has(cell.key) && (() => {
                    const net = drainClock.rooms.get(cell.key)!;
                    return (
                      <em className="room-clock" title={net <= 1e-9
                        ? t("순소모 0 — 무한동력, 이 방은 교대가 필요 없습니다")
                        : t("A조 지속 — 풀 컨디션 24를 이 방 순소모 {d}/h로 나눈 완전 소진 시간 (총웨류 회복 오라·제어센터 인원당 -0.05 반영). 실제 교대는 컨디션 12(지침 신호)쯤에서 이르게 하는 게 보통입니다. 전원 풀 컨디션 가정이라 오퍼별 현재 피로도에 따라 실제 시간은 달라집니다", { d: net.toFixed(2) })}>
                        {net <= 1e-9 ? "∞" : t("{n}시간", { n: Math.round(24 / net) })}
                      </em>
                    );
                  })()}
                  {team.length}/{slotsFor(cell.key)}
                </span>
              </div>
              {/* 그외(커스텀) 배치: 칸의 시설 종류 전환 (중첩 button 금지 — span[role=button]) */}
              {layout === "custom" && cell.slot != null && (
                <span className={`room-type-switch type-corner${switchFlash ? " flash" : ""}`} role="group" aria-label={t("시설 종류 변경")} onClick={(event) => event.stopPropagation()}>
                  {(["MANUFACTURE", "TRADING", "POWER"] as const).map((roomType) => (
                    <span key={roomType} role="button" tabIndex={0} className={cell.room === roomType ? "on" : ""}
                      onClick={(event) => { event.stopPropagation(); if (cell.room !== roomType) changeCustomRoom(cell.slot!, roomType); }}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); if (cell.room !== roomType) changeCustomRoom(cell.slot!, roomType); } }}>
                      {t(roomType === "MANUFACTURE" ? "제조소" : roomType === "TRADING" ? "무역소" : "발전소")}
                    </span>
                  ))}
                </span>
              )}
              <div className="ship-room-crew">
                {team.length ? team.map((op) => {
                  // 오퍼의 정예화 단계 (E0/E1/E2) — 임시 적용 반영(viewElite), 미지정이면 그 오퍼 최대 정예화.
                  const elite = viewElite.get(op.id) ?? maxElite(op.rarity);
                  const isTemp = tempApplied.has(op.id); // 육성 추천 임시 적용 오퍼 — 미리보기임을 썸네일에 표시
                  return (
                    <span key={op.id} className={`op-av${isTemp ? " temp" : ""}`} title={isTemp ? t("{name} — 임시 적용 중 (완성 가정 미리보기)", { name: op.name }) : undefined}>
                      <img src={asset(op.image)} alt={op.name} width={180} height={180} title={isTemp ? undefined : op.name} loading="lazy" />
                      <em className={`op-elite e${elite}`} title={t("정예화 {n}", { n: elite })}>E{elite}</em>
                      {isTemp && <i className="op-temp-badge" aria-hidden>{t("임시")}</i>}
                    </span>
                  );
                }) : <i>{cell.key === "TRAINING" ? t("비워둠 · 특화 훈련 시 사용") : plan ? t("비어 있음") : t("자동 편성 대기")}</i>}
              </div>
              {plan && team.length > 0 && !PARK_KEYS.includes(cell.key) && (
                <small title={cell.room === "CONTROL"
                  ? t("오라 효과를 우선순위 가중치(제조소 ×10 > 무역소 ×2 > 인맥 ×0.6 > 단서 ×0.2)로 환산해 합한 비교용 점수입니다 — %가 아니며, 실제 효과는 대상 방 점수에 '오라' 수신분으로 더해집니다.")
                  : ambientPart !== 0 ? t("제어센터 오라 수신 {n} 포함 — 방을 눌러 상세 내역을 확인하세요", { n: `${ambientPart > 0 ? "+" : ""}${ambientPart}` }) : undefined}>
                  +{score}{cell.room === "CONTROL" ? "" : "%"} {cell.room === "CONTROL" ? t("오라 가중 점수") : t(UNIT[cell.room])}
                  {ambientPart !== 0 && cell.room !== "CONTROL" && <em className="ambient-note"> ({t("오라")} {ambientPart > 0 ? "+" : ""}{ambientPart})</em>}
                  {raiseBefore != null && raiseBefore !== score && <em className={`raise-delta ${score >= raiseBefore ? "up" : "down"}`}> · {t("원래 {b}%", { b: raiseBefore })} ({score >= raiseBefore ? "+" : ""}{score - raiseBefore})</em>}
                </small>
              )}
              {plan && PARK_KEYS.includes(cell.key) && team.length > 0 && <small>{t("세트 요원 고정 · 효율 무관")}</small>}
            </button>
          );
        })}
      </div>

      {showRoster && (
        <RosterModal
          levelById={levelById}
          allOps={visibleOps}
          ownedIds={ownedIds}
          eliteById={eliteById}
          onApply={(ids, elite, lv) => { setOwnedIds(ids); setEliteById(elite); setLevelById(lv); setShowRoster(false); runOptimize(ids, elite, priority, lv); setDirty(true); }}
          onClose={() => setShowRoster(false)}
          onShowOperator={onShowOperator}
          mode={rosterMode}
          onMode={setRosterMode}
        />
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showMaa && <MaaExportModal plan={plan} nameOf={(id) => effectiveOpById.get(id)?.name ?? opById.get(id)?.name} toast={showToast} onClose={() => setShowMaa(false)} />}

      {shiftNote && <ShiftNoteModal kind={shiftNote} onClose={() => setShiftNote(null)} />}

      {imageUrl && (
        <ModalWindow label={t("편성표 이미지")} className="operator-modal room-modal image-preview" onClose={closeImage} style={{ "--accent": "var(--lime)" } as React.CSSProperties}>
            <header className="room-modal-head">
              <span className="modal-kicker">PLAN SHEET</span>
              <h2>{t("편성표 이미지")}</h2>
              <div className="roster-tools">
                <a className="apply save-image" href={imageUrl} download="terra-archive-infra.png">{t("PNG 저장")}</a>
              </div>
            </header>
            <div className="modal-scroll"><img src={imageUrl} alt={t("인프라 편성표")} /></div>
        </ModalWindow>
      )}

      {showFlows && plan && <FlowModal plan={plan} opMap={effectiveOpById} onClose={() => setShowFlows(false)} onShowOperator={onShowOperator} />}

      {openCell && plan && (
        <RoomModal
          /* 방을 바꾸면 새로 마운트한다 — 조 탭·후보 검색어가 이전 방 것으로 남지 않게
             (근무 중 오퍼 칩으로 다른 시설을 열 때 필요, 2026-07-31) */
          key={openCell.key}
          cell={openCell}
          plan={plan}
          allAssigned={allAssigned}
          roster={roster}
          opMap={effectiveOpById}
          initialShift={activeShift}
          onClose={() => setOpenRoom(null)}
          onOpenRoom={(key, shift) => { setActiveShift(shift); setOpenRoom(key); }}
          onShowOperator={onShowOperator}
          onSetLevel={setRoomLevel}
          onUpdateTeam={openCell.room === "DORMITORY" ? (key, _shift, ids) => updateDorm(key, ids) : updateTeam}
          dormPins={openCell.room === "DORMITORY" ? (dormPins[openCell.key] ?? []) : undefined}
          onToggleDormPin={openCell.room === "DORMITORY" ? (opId: string) => toggleDormPin(openCell.key, opId) : undefined}
          eliteById={viewElite}
          onSetElite={setOperatorElite}
          tempIds={new Set(tempApplied.keys())}
          onRevertTempOne={(id) => { void revertTempOne(id); }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}

// 육성 추천 결과 모달 — recommendRaises가 증명한 "완성하면 이득인 정예화 투자"를 ΔS 순으로.
// 방 %효율 변화·완성 비용은 실제 편성·게임 데이터 기준(근사 환산 없음). 한 번 분석하면 새
// 자동편성 전까지 유지되며, 모달 안 '다시 분석'으로 강제 재계산한다.
function InvestPanel({ recs, opMap, onShowOperator, onClose, onReanalyze, onToggleSelect, onApplySelected, onApplyAll, onHide, selected, applied, onRevert, diag, hiddenCount, onUnhideAll, onOpenRoster, t, locale }: {
  recs: RaiseRec[]; opMap: Map<string, InfraOp>; onShowOperator?: (id: string) => void;
  onClose: () => void; onReanalyze: () => void; onToggleSelect: (opId: string) => void; onApplySelected: () => void; onApplyAll: () => void;
  onHide: (opId: string) => void; selected: Set<string>; applied: Set<string>; onRevert: () => void;
  diag: { unfinished: number; candidates: number } | null; hiddenCount: number; onUnhideAll: () => void; onOpenRoster: () => void;
  t: T; locale: Locale;
}) {
  // 방 라벨은 i18n 사전 키("제조소 1 · 순금" 등) — 배 뷰(t(cell.label))처럼 번역해 표시
  // (일어판 육성 추천 모달에 방 이름만 한국어로 남던 문제, 사용자 리포트 2026-07-22)
  // 칸 키(MANUFACTURE-2)면 그 칸 이름, 방 종류 키(MANUFACTURE)면 시설 이름 —
  // 같은 종류 방이 여럿 바뀌면 육성 추천이 방 종류로 합산해 내려보낸다 (2026-07-25)
  const roomLabel = (key: string) => t(cellByKey.get(key)?.label ?? infra.rooms[key]?.name ?? key);
  const shiftTag = (s: number) => (s === 0 ? t("A조") : t("B조"));
  const num = (n: number) => Math.round(n).toLocaleString();
  const SANITY_BASIS = sanityBasis.basis;
  const GOLD_LMD = sanityBasis.goldLmd;
  const SANITY_ITEMS = sanityBasis.items as Record<string, number>;
  // 회수 버튼으로 펼치는 완성 비용 내역 — 한 번에 하나만 (사용자 지정 2026-08-05)
  const [openCost, setOpenCost] = useState<string | null>(null);
  // 회수일 기준 — 기본은 용문폐+경험치만, 버튼을 눌러야 재료까지 합친다 (사용자 지정 2026-08-05).
  // 오퍼별로 따로 켠다 — 전역이면 하나 켤 때 다른 카드까지 전부 바뀐다 (사용자 지적)
  const [withMatIds, setWithMatIds] = useState<Set<string>>(new Set());
  const matOn = (opId: string) => withMatIds.has(opId);
  const toggleMat = (opId: string) => setWithMatIds((cur) => {
    const next = new Set(cur);
    if (next.has(opId)) next.delete(opId); else next.add(opId);
    return next;
  });
  // ⚠ 비용·회수일은 저장된 payback 필드를 쓰지 않고 **cost + 현재 단가로 매번 재계산**한다.
  // 구버전 엔진이 저장한 추천(apBase·daysWithMat 없음)을 새 UI가 읽으면 합계가 재료 포함값으로
  // 폴백되고(11,164 vs 3,537) 없는 필드를 나눠 'NaN일'이 떴다 (사용자 제보 2026-08-05).
  // 저장분에서 신뢰하는 건 dailyAp(방 델타 × 편성 교대 시계 — UI가 재현 불가)뿐이다.
  const apOf = (c: RaiseRec["cost"]) => {
    const apLmd = c.lmd / sanityBasis.lmdPerAp;
    const apExp = c.exp / sanityBasis.expPerAp;
    let apMat = 0;
    let unconverted = 0;
    for (const [iid, ct] of c.items) {
      const unit = SANITY_ITEMS[iid];
      if (unit == null) unconverted += 1;
      else apMat += unit * ct;
    }
    return { apLmd, apExp, apMat, apBase: apLmd + apExp, apTotal: apLmd + apExp + apMat, unconverted };
  };
  const daysOf = (r: RaiseRec, withM: boolean): number | null => {
    const daily = r.payback?.dailyAp ?? 0;
    if (!(daily > 0)) return null;
    const ap = apOf(r.cost);
    return (withM ? ap.apTotal : ap.apBase) / daily;
  };
  const costRec = openCost ? recs.find((x) => x.opId === openCost) ?? null : null;
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);
  return (
    <ModalWindow label={t("인프라 오퍼 육성 추천")} className="operator-modal invest-panel" onClose={onClose}>
      <div className="invest-head">
        <div className="invest-head-title">
          <div>
            <span className="section-no">{t("인프라 오퍼 육성 추천 · 정예화 완성 투자")}</span>
            <h3>{recs.length ? t("완성하면 인프라가 좋아지는 오퍼 {n}명", { n: recs.length }) : t("추천할 오퍼가 없습니다")}</h3>
          </div>
          <button className="invest-close" onClick={onClose} aria-label={t("닫기")}>✕</button>
        </div>
        <div className="invest-head-btns">
          {applied.size > 0 && <button className="invest-revert" onClick={onRevert} title={t("임시 적용을 모두 취소하고 이전 편성으로 되돌립니다")}>↩ {t("되돌리기 ({n})", { n: applied.size })}</button>}
          {recs.length > 0 && <button className="invest-applysel" onClick={onApplySelected} disabled={selected.size === 0} title={t("선택한 오퍼만 한 번에 임시 적용합니다 (되돌리기 가능)")}>{t("선택 임시 적용 ({n})", { n: selected.size })}</button>}
          {recs.length > 0 && <button className="invest-applyall" onClick={onApplyAll} title={t("추천 오퍼 전부를 임시 적용합니다 — 되돌리기 가능")}>{t("전체 임시 적용")}</button>}
          <button className="invest-reanalyze" onClick={onReanalyze} title={t("현재 보유·정예화 상태로 다시 계산합니다 (임시 적용은 취소됩니다)")}>↻ {t("다시 분석")}</button>
        </div>
      </div>
      <p className="invest-note">{t("아직 완성 안 한(정예화를 낮춰 둔) 오퍼를 완성했다고 가정해 자동편성을 다시 돌리고, 방 %효율이 실제로 얼마나 오르는지로 이득을 증명합니다. 숫자는 그 방 %효율 변화의 합계(%p)이며, A조(주력)를 우선해 정렬합니다. '적용'은 완성했다 가정해 편성에 임시 반영합니다 — 되돌리기 가능하고, 전체 자동편성·다시 분석 전까지 추천은 그대로 유지됩니다.")}</p>
      <p className="invest-note invest-note-sub">{t("교대는 12시간 고정이 아닙니다 — A조를 풀파워로 돌리다 A조 오퍼 중 하나라도 피로도가 소진되면 B조로 전환하고, A조가 전부 회복되면 즉시 A조로 되돌립니다. 그래서 A조 이득을 우선합니다.")}</p>
      {/* 회수일 기준 전환 + 계산 근거 — 숫자만 던지지 않고 기준을 전부 밝힌다 (2026-08-05) */}
      {recs.length > 0 && (
        <div />
      )}
      {recs.length > 0 && (
        <details className="invest-basis">
          <summary>{t("‘회수 N일’은 이렇게 계산했습니다 — 환산 기준 보기")}</summary>
          <ul>
            <li>{rich(t("**기본은 용문폐·경험치만** 계산합니다. 위 버튼으로 켜면 듀얼칩 등 육성 재료의 이성까지 합칩니다."))}</li>
            <li>{rich(t("**비용**: 완성에 드는 용문폐·경험치·재료를 각각의 전용 파밍처 이성 단가로 환산해 더합니다. 승급은 그 단계 만렙에서만 가능하므로 **남은 레벨업 비용까지 포함**합니다(보유 설정에 적어 둔 레벨부터 계산)."))}</li>
            <li>{t("용문폐 1이성 = {lmd} (전용 스테이지 {ls} · {lap}이성에 {ld}) · 경험치 1이성 = {exp} (전용 스테이지 {es} · {eap}이성에 {ed})", { lmd: Math.round(SANITY_BASIS.lmd.drop / SANITY_BASIS.lmd.ap), ls: SANITY_BASIS.lmd.stage, lap: SANITY_BASIS.lmd.ap, ld: num(SANITY_BASIS.lmd.drop), exp: Math.round(SANITY_BASIS.exp.drop / SANITY_BASIS.exp.ap), es: SANITY_BASIS.exp.stage, eap: SANITY_BASIS.exp.ap, ed: num(SANITY_BASIS.exp.drop) })}</li>
            <li>{t("재료 이성 단가: 파밍 가능한 재료는 파밍 도우미의 실측 드랍률 기준 최저 이성 스테이지, 칩·칩셋은 주간 PR 스테이지, 제작 전용 재료(듀얼칩·D32강 등)는 가공소 레시피를 재료까지 재귀 분해해 계산합니다.")}</li>
            <li>{rich(t("**하루 이득**: 방 %효율 변화 × 그 방 1%p의 하루 산출 × 그 조가 실제로 근무하는 시간 비율. 제조소는 기본 생산 속도 1포인트/초(순금 4,320pt·중급작전기록 10,800pt=1,000exp) 기준입니다."))}</li>
            <li>{t("순금 1개는 무역소 주문에서 용문폐 {n}으로 봅니다 — 주문 보상만은 게임 데이터에 없어 통용값을 쓴 유일한 추정치입니다.", { n: num(GOLD_LMD) })}</li>
            <li>{t("발전소·사무실·응접실 변화는 산출을 이성으로 환산할 근거가 없어 이득에서 빼고 '회수 환산 제외'로 표시합니다 — 실제 회수는 표시된 것보다 빠를 수 있습니다.")}</li>
          </ul>
        </details>
      )}
      {/* 0건 안내는 **이유별로** 다르게 — 종전엔 한 문장뿐이라 "정예화를 입력 안 해서 후보가
          0인" 경우와 "후보는 다 검증했는데 이득이 없는" 경우가 구분되지 않았다 (2026-07-29). */}
      {!recs.length && (
        <div className="invest-empty">
          {hiddenCount > 0 ? (<>
            <p>{t("추천 {n}건을 모두 숨겼습니다 — 숨김을 풀면 다시 보입니다.", { n: hiddenCount })}</p>
            <button type="button" className="invest-empty-act" onClick={onUnhideAll}>{t("숨김 해제")}</button>
          </>) : diag && diag.unfinished === 0 ? (<>
            <p>{t("보유 오퍼가 전원 정예화 완성 상태로 잡혀 있어 검증할 후보가 없습니다 — 아직 안 키운 오퍼의 정예화를 낮춰 주세요. (스캔·계정 연동 결과를 '적용' 없이 닫으면 정예화가 반영되지 않습니다)")}</p>
            <button type="button" className="invest-empty-act" onClick={onOpenRoster}>{t("보유 오퍼 설정 열기")}</button>
          </>) : diag && diag.candidates === 0 ? (
            <p>{t("미완성 {n}명 중 정예화로 인프라 스킬이 새로 열리는 오퍼가 없습니다 — 완성해도 편성이 바뀌지 않습니다.", { n: diag.unfinished })}</p>
          ) : diag ? (
            <p>{t("미완성 {n}명 중 후보 {c}명을 실제로 완성해 편성을 다시 계산해 봤지만, 어느 쪽도 지금 편성을 바꾸지 못했습니다.", { n: diag.unfinished, c: diag.candidates })}</p>
          ) : (
            <p>{t("완성해도 최적 편성이 바뀌는 오퍼가 없습니다. 보유 오퍼 설정에서 아직 안 키운 오퍼의 정예화를 낮춰 두면, 완성 시 이득이 있는지 여기서 확인할 수 있습니다.")}</p>
          )}
        </div>
      )}
      <ul className="invest-list">
        {recs.map((r) => {
          const op = opMap.get(r.opId);
          if (!op) return null;
          const deltas = [...r.roomDeltas].sort((a, b) => {
            const ap = r.placement && a.key === r.placement.key && a.shift === r.placement.shift ? 0 : 1;
            const bp = r.placement && b.key === r.placement.key && b.shift === r.placement.shift ? 0 : 1;
            return ap - bp;
          }).slice(0, 4);
          return (
            <li key={r.opId} className="invest-card">
              <img className={onShowOperator ? "op-link" : undefined} src={op.image} alt={op.name} width={180} height={180} loading="lazy" onClick={() => onShowOperator?.(r.opId)} />
              <div className="invest-body">
                <div className="invest-title">
                  <b className={onShowOperator ? "op-link" : undefined} onClick={() => onShowOperator?.(r.opId)}>{op.name}</b>
                  <i className="invest-stars" aria-hidden>{"★".repeat(op.rarity)}</i>
                  <span className="invest-raise">{t("{e} Lv.{lv}", { e: t(ELITE_LABEL[r.from]), lv: r.fromLevel ?? 1 })} → {t(ELITE_LABEL[r.to])} {t("완성")}</span>
                  {r.synergy && <span className="invest-syn" title={t("팀 시너지를 여는 오퍼 — 완성 시 열리는 세트의 총 시너지 효율까지 반영해 평가했습니다")}>{t("시너지")}</span>}
                  <span className="invest-gains" title={t("완성 시 오르는 방 %효율의 조별 합계 — 아래 방 변화의 합입니다")}>
                    {Math.round(r.aGain) >= 1 && <span className="inv-gain a">{t("A조 +{n}%p", { n: Math.round(r.aGain) })}</span>}
                    {Math.round(r.bGain) >= 1 && <span className="inv-gain b">{t("B조 +{n}%p", { n: Math.round(r.bGain) })}</span>}
                  </span>
                  {/* 예상 회수일 — 누르면 완성 비용 내역이 펼쳐진다 (사용자 지정 2026-08-05).
                      계산 근거는 그 내역과 패널 상단 각주에 그대로 밝힌다 */}
                  <button type="button" className={`invest-payback${openCost === r.opId ? " on" : ""}`}
                    aria-expanded={openCost === r.opId}
                    onClick={() => setOpenCost(openCost === r.opId ? null : r.opId)}
                    title={t("완성 비용 내역과 계산 과정을 봅니다")}>
                    {daysOf(r, matOn(r.opId)) == null
                      ? t("회수 계산 불가")
                      : t("회수까지 {n}일", { n: num(Math.round(daysOf(r, matOn(r.opId))!)) })}
                  </button>
                </div>
                {r.placement && <div className="invest-place">{t("{room} · {shift}에 배치됩니다", { room: roomLabel(r.placement.key), shift: shiftTag(r.placement.shift) })}</div>}
                {deltas.length > 0 && (
                  <ul className="invest-rooms">
                    {deltas.map((d, i) => (
                      <li key={i}><span>{roomLabel(d.key)} {shiftTag(d.shift)}</span> <em>{Math.round(d.before)}% → {Math.round(d.after)}%</em></li>
                    ))}
                  </ul>
                )}
                {/* 비용 요약 줄은 뺐다 — 회수 버튼으로 펼치는 내역에 같은 내용이 표로 있다
                    (사용자 지적 2026-08-05). 이 줄엔 선택·숨기기만 남긴다 */}
                <div className="invest-cost">
                  <span className="invest-cost-actions">
                    {applied.has(r.opId)
                      ? <span className="invest-applied" title={t("임시 적용됨 — 헤더 '되돌리기'로 취소")}>✓ {t("적용됨")}</span>
                      : <>
                          <button className={`invest-apply${selected.has(r.opId) ? " on" : ""}`} onClick={() => onToggleSelect(r.opId)} title={t("적용할 오퍼로 선택합니다 — 헤더 '선택 임시 적용'으로 한 번에 반영")}>{selected.has(r.opId) ? `✓ ${t("선택됨")}` : t("선택")}</button>
                          <button className="invest-hide" onClick={() => onHide(r.opId)} title={t("이 오퍼를 추천 목록에서 숨깁니다 — 다음 순위 오퍼가 올라옵니다")}>{t("숨기기")}</button>
                        </>}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {/* 완성 비용 상세 — 카드 인라인이 아니라 별도 모달 (사용자 지정 2026-08-05).
          표시 값은 전부 apOf/daysOf 재계산 — 저장분 형식과 무관하게 표와 합계가 항상 일치한다 */}
      {costRec && (() => {
        const ap = apOf(costRec.cost);
        const on = matOn(costRec.opId);
        const days = daysOf(costRec, on);
        return (
        <ModalWindow label={t("완성 비용")} className="operator-modal invest-costmodal" onClose={() => setOpenCost(null)}>
          <div className="invest-costdetail">
            <h3 className="invest-costmodal-title">
              {opMap.get(costRec.opId)?.name ?? costRec.opId}
              <em>{t("{e} Lv.{lv}", { e: t(ELITE_LABEL[costRec.from]), lv: costRec.fromLevel ?? 1 })} → {t(ELITE_LABEL[costRec.to])} {t("완성")}</em>
            </h3>
            <p className="invest-costmodal-days">
              {days == null ? t("회수 계산 불가") : t("회수까지 {n}일", { n: num(Math.round(days)) })}
            </p>
            <table>
              <tbody>
                <tr><th>{t("용문폐")}</th><td>{num(costRec.cost.lmd)}</td><td>{t("{n} 이성", { n: num(ap.apLmd) })}</td></tr>
                {costRec.cost.exp > 0 && <tr><th>{t("경험치")}</th><td>{num(costRec.cost.exp)}</td><td>{t("{n} 이성", { n: num(ap.apExp) })}</td></tr>}
                {costRec.cost.items.map(([id, ct]) => {
                  const unit = SANITY_ITEMS[id];
                  return (
                    <tr key={id} className={on ? undefined : "off"}>
                      <th>{ITEM_CAT[id]?.name?.[locale] ?? id}</th>
                      <td>×{ct}</td>
                      <td>{unit == null ? t("환산 불가") : t("{n} 이성", { n: num(unit * ct) })}</td>
                    </tr>
                  );
                })}
                <tr className="sum"><th>{on ? t("합계 (재료 포함)") : t("합계 (용문폐·경험치)")}</th><td /><td>{t("{n} 이성", { n: num(on ? ap.apTotal : ap.apBase) })}</td></tr>
              </tbody>
            </table>
            {ap.apMat > 0 && (
              <button type="button" className={`invest-mattoggle${on ? " on" : ""}`} aria-pressed={on}
                onClick={() => toggleMat(costRec.opId)}
                title={t("이 오퍼의 회수일을 용문폐·경험치만으로 볼지, 듀얼칩 등 육성 재료까지 합쳐 볼지 전환합니다")}>
                <span className="invest-mattoggle-box" aria-hidden />{t("육성 재료 비용까지 포함")}
              </button>
            )}
            <p className="invest-costcalc">
              {days == null
                ? t("이 오퍼가 올리는 방은 산출을 이성으로 환산할 근거가 없어(발전소·사무실·응접실) 회수일을 내지 않습니다. 방 %효율 이득은 위 목록 그대로입니다.")
                : rich(t("하루 이득 **{daily} 이성** (방 %효율 변화 × 그 방 1%p의 하루 산출 × 그 조 근무시간 비율) → **{cost} ÷ {daily} = 약 {days}일**", { daily: costRec.payback!.dailyAp.toFixed(2), cost: num(on ? ap.apTotal : ap.apBase), days: num(Math.round(days)) }))}
            </p>
            {days != null && ap.apMat > 0 && (
              <p className="invest-costcalc dim">{on
                ? t("재료 {mat} 이성을 포함한 값입니다 — 빼면 {days}일.", { mat: num(ap.apMat), days: num(Math.round(daysOf(costRec, false)!)) })
                : t("재료 {mat} 이성은 빠져 있습니다 — 포함하면 {days}일.", { mat: num(ap.apMat), days: num(Math.round(daysOf(costRec, true)!)) })}</p>
            )}
            {ap.unconverted > 0 && (
              <p className="invest-costcalc dim">{t("이성 단가를 구할 수 없는 재료 {n}종(교환 전용·미출시)은 비용에서 빠졌습니다 — 실제 비용은 조금 더 듭니다.", { n: ap.unconverted })}</p>
            )}
            {costRec.fromLevel != null && (
              <p className="invest-costcalc dim">{t("보유 설정의 현재 레벨 Lv.{lv}부터 남은 레벨업만 계산했습니다 (승급은 그 단계 만렙에서만 가능).", { lv: costRec.fromLevel })}</p>
            )}
          </div>
        </ModalWindow>
        );
      })()}
    </ModalWindow>
  );
}

// ── RIIC 용어 클릭 (왕 외세·실리, 우미리 시라쿠사 등 — 사용자 요청 2026-07-24) ──────
// 스킬 설명 속 게임 용어(termRefs, <$cc.*> 참조)를 클릭 가능하게 렌더한다. 클릭하면
// TermPopup이 게임 용어 사전(infra.json terms)의 정의를 보여주고, 정의 속 오퍼 명단 줄은
// 아바타 칩(배치 중=컬러·미배치=흑백)으로, 정의가 참조하는 다른 용어는 다시 클릭 가능.
// EN/JA는 스킬 설명이 로케일 텍스트라 참조 문자열이 안 맞아 자연히 평문으로 남는다(무해).
const opByName = new Map(ops.map((op) => [op.name, op]));
function escRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function TermText({ text, refs, onTerm }: { text: string; refs?: [string, string][]; onTerm: (k: string) => void }) {
  const parts = useMemo(() => {
    if (!refs?.length) return null;
    const map = new Map(refs.map(([key, label]) => [label, key]));
    const re = new RegExp(`(${[...map.keys()].sort((a, b) => b.length - a.length).map(escRe).join("|")})`, "g");
    return { map, segs: text.split(re) };
  }, [text, refs]);
  if (!parts) return <>{text}</>;
  return <>{parts.segs.map((seg, i) => {
    const key = parts.map.get(seg);
    return key
      ? <button key={i} type="button" className="term-link" title={TERMS[key]?.name ?? seg}
          onClick={(ev) => { ev.stopPropagation(); onTerm(key); }}>{seg}</button>
      : seg;
  })}</>;
}
function TermPopup({ termKey, presentIds, onNavigate, onShowOperator, onClose }: {
  termKey: string; presentIds: Set<string>; onNavigate: (k: string) => void;
  onShowOperator?: (id: string) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const term = TERMS[termKey];
  if (!term) return null;
  return (
    <ModalWindow label={term.name} className="operator-modal term-modal" onClose={onClose}>
        <header className="term-head">
          <span className="modal-kicker">RIIC TERM</span>
          <h2>{term.name}</h2>
        </header>
        <div className="term-body">
          {term.desc.split("\n").map((line, i) => {
            // 오퍼 명단 줄(쉼표 나열 전원이 오퍼명)은 아바타 칩으로 — "시라쿠사 오퍼레이터
            // 클릭 → 연결된 오퍼 전부" 요구의 핵심. 그 외 줄은 평문(+중첩 용어 클릭).
            const names = line.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
            const hit = names.map((n) => opByName.get(n));
            if (names.length > 0 && hit.every((o): o is InfraOp => !!o)) {
              return (
                <span key={i} className="rel-chips term-ops">
                  {hit.map((o) => (
                    <img key={o.id} src={o.image} alt={o.name} width={44} height={44} loading="lazy"
                      className={presentIds.has(o.id) ? "on" : ""}
                      title={presentIds.has(o.id) ? o.name : t("{name} — 미배치", { name: o.name })}
                      onClick={(ev) => { ev.stopPropagation(); onShowOperator?.(o.id); }} />
                  ))}
                </span>
              );
            }
            return <p key={i} className="term-line"><TermText text={line} refs={term.refs} onTerm={onNavigate} /></p>;
          })}
        </div>
    </ModalWindow>
  );
}

function RoomModal({ cell, plan, allAssigned, roster, opMap, initialShift, onClose, onOpenRoom, onShowOperator, onUpdateTeam, eliteById, onSetElite, tempIds, onRevertTempOne, onSetLevel, dormPins, onToggleDormPin }: { cell: { key: string; room: string; label: string; product?: string }; plan: Plan; allAssigned: Set<string>; roster: InfraOp[]; opMap: Map<string, InfraOp>; initialShift: number; onClose: () => void; onOpenRoom?: (key: string, shift: number) => void; onShowOperator?: (id: string) => void; onUpdateTeam?: (cellKey: string, shiftIdx: number, ids: string[]) => void; eliteById: Map<string, Elite>; onSetElite: (id: string, elite: Elite) => void; tempIds: Set<string>; onRevertTempOne: (opId: string) => void; onSetLevel?: (key: string, lv: number) => void; dormPins?: string[]; onToggleDormPin?: (opId: string) => void }) {
  const { locale, t } = useI18n();
  const [shift, setShift] = useState(initialShift);
  const [termOpen, setTermOpen] = useState<string | null>(null); // RIIC 용어 팝업 (외세·실리 등)
  const shiftIndex = Math.min(shift, (plan.assignments[cell.key]?.length ?? 1) - 1);
  const rawIds = plan.assignments[cell.key]?.[shiftIndex] ?? [];
  const team = rawIds.map((id) => opMap.get(id)).filter(Boolean) as InfraOp[];
  const teamIds = new Set(team.map((op) => op.id));
  const points = shiftIndex === 0 ? plan.tokenPoints : {};
  // 제어센터 오라를 이 방 점수에도 합산 (제어센터 자신을 볼 때는 미적용)
  const controlShifts = plan.assignments["CONTROL"] ?? [];
  const controlTeam = (controlShifts[Math.min(shiftIndex, controlShifts.length - 1)] ?? []).map((id) => opMap.get(id)).filter(Boolean) as InfraOp[];
  const roomOf = roomOfFor(plan, shiftIndex);
  const cellOf = cellOfFor(plan, shiftIndex);
  const ambient = cell.key === "CONTROL" ? undefined
    : aurasOf(controlTeam, ctxFor("CONTROL", points, plan.factionCounts[shiftIndex] ?? {}, plan.plants, presentIdsFor(plan, shiftIndex), undefined, roomOf, cellOf));
  const ctx = { ...ctxFor(cell.key, points, plan.factionCounts[shiftIndex] ?? {}, plan.plants, presentIdsFor(plan, shiftIndex), ambient, roomOf, cellOf), shiftHours: plan.shiftHours?.[shiftIndex], shift: shiftIndex };
  const excluded = new Set([...allAssigned, ...teamIds]);
  const currentScore = Math.round(teamScore(team, cell.room, ctx));
  const slots = slotsFor(cell.key); // 시설 레벨 반영 (2026-07-24)
  const scored = cell.room !== "DORMITORY" && !PARK_KEYS.includes(cell.key);
  const setIds = (ids: string[]) => onUpdateTeam?.(cell.key, shiftIndex, ids);
  // 종합 효율 구성 요소 (팀원 breakdown 합산)
  const agg = team.reduce((acc, op) => {
    const b = breakdown(op, cell.room, team, ctx);
    acc["스킬 효율"] += b.efficiency;
    acc["시설 기반"] += b.facilityEff;
    acc["자동화"] += b.automation;
    acc["품질 기대치"] += b.quality;
    acc["오더 수익"] += b.payout + b.payoutViolation;
    acc["효율 오버라이드"] += b.override > 0 ? b.override : 0;
    acc["동료 보너스"] += b.perCoworker * (team.length - 1);
    acc["레어도 기본"] += b.clueBase;
    acc["제어 오라(가중)"] += Object.keys(AURA_WEIGHT).reduce((sum, kind) => sum + ((b.auras[kind] ?? 0) + (b.aurasAdd[kind] ?? 0)) * AURA_WEIGHT[kind], 0);
    return acc;
  }, { "스킬 효율": 0, "시설 기반": 0, "자동화": 0, "품질 기대치": 0, "오더 수익": 0, "효율 오버라이드": 0, "동료 보너스": 0, "레어도 기본": 0, "제어 오라(가중)": 0 } as Record<string, number>);
  agg["제어센터 오라 수신"] = ambientFor(cell.room, team, ambient, agg["스킬 효율"], ctx.product);
  // 용량 변환 — 팀이 쌓은 오더 상한/창고 용량을 변환기가 되돌린 효율/생산력 (베나벌컨버블·데겐블레허·제이)
  agg["용량 변환"] = capConvFor(team, cell.room, ctx);
  // 증폭 — 팀이 제공한 효율(=스킬 효율 합)을 배수로 되돌림 (와이후 협동의식·스노우상트 근면성실)
  const ampSpecs = team.flatMap((op) => breakdown(op, cell.room, team, ctx).amplify);
  agg["증폭"] = ampSpecs.reduce((sum, spec) => sum + Math.min(spec.cap, Math.floor(agg["스킬 효율"] / spec.per) * spec.add), 0);
  // 추가 후보: 어디에도 배치 안 된 보유 오퍼를 한계 기여 순으로
  const [benchAll, setBenchAll] = useState(false);
  // 비제어 입력 — 타이핑 중 렌더 0회, 멈춘 뒤 0.5초에만 후보 목록 갱신 (search.ts)
  const { term: benchTerm, inputProps: benchProps } = useSearchInput();
  // 숙소에 두면 다른 방의 조건을 켜 주는 오퍼("…가 기반시설 어디든 있으면 +N%"의 짝) —
  // 언더플로우의 울피아누스처럼, 숙소 후보 목록에서 이들을 맨 앞에 세운다 (2026-07-25)
  const enablerFor = useMemo(() => {
    const map = new Map<string, string>();
    if (cell.room !== "DORMITORY") return map;
    // 배치된 오퍼가 아니라 **보유 로스터 전체**를 본다 — 정작 짝이 없어서 수혜 오퍼가
    // 벤치에 있는 경우(언더플로우)가 이 안내가 가장 필요한 상황이기 때문이다
    for (const op of roster) {
      for (const skill of op.skills) {
        if (!skill.basePartnerBonus) continue;
        for (const pid of skill.basePartners ?? []) if (!map.has(pid)) map.set(pid, op.name);
      }
    }
    return map;
  }, [cell.room, roster]);
  const benchFull = team.length < slots && onUpdateTeam
    ? roster
        .filter((op) => !allAssigned.has(op.id))
        .map((op) => ({ op, delta: Math.round(teamScore([...team, op], cell.room, ctx)) - currentScore }))
        .sort((a, b) => (enablerFor.has(b.op.id) ? 1 : 0) - (enablerFor.has(a.op.id) ? 1 : 0)
          || b.delta - a.delta || b.op.rarity - a.op.rarity)
    : [];
  const benchKeyword = normSearch(benchTerm);
  const benchFiltered = benchKeyword
    ? benchFull.filter(({ op }) => normSearch(op.name).includes(benchKeyword) || normSearch(op.faction).includes(benchKeyword))
    : benchFull;
  const bench = benchAll ? benchFiltered : benchFiltered.slice(0, 12);
  // 검색어에 걸렸는데 **이미 어딘가 근무 중**이라 후보에서 빠진 오퍼 — "검색 결과가 없습니다"로
  // 끝내지 말고 어느 시설 어느 조에 있는지 알려준다 (사용자 요청 2026-07-31).
  // 한 오퍼가 A조·B조에 따로 들어가 있을 수 있으므로 시설별로 조를 모아 표시한다.
  const busyMatches = useMemo(() => {
    if (!benchKeyword) return [];
    const where = new Map<string, Map<string, number[]>>(); // opId → (방 키 → 조 번호들)
    for (const [key, shifts] of Object.entries(plan.assignments)) {
      shifts.forEach((ids, shift) => {
        for (const id of ids) {
          const rooms = where.get(id) ?? new Map<string, number[]>();
          rooms.set(key, [...(rooms.get(key) ?? []), shift]);
          where.set(id, rooms);
        }
      });
    }
    return roster
      .filter((op) => where.has(op.id)
        && (normSearch(op.name).includes(benchKeyword) || normSearch(op.faction).includes(benchKeyword)))
      .map((op) => {
        const spots = [...where.get(op.id)!];
        return {
          op,
          // 클릭 시 열 시설 — 여러 군데면 첫 자리 (조도 그 자리 기준으로 맞춘다)
          go: { key: spots[0][0], shift: spots[0][1][0] },
          at: spots.map(([key, shifts]) =>
            `${t(cellByKey.get(key)?.label ?? key)} ${shifts.map((s) => (s === 0 ? t("A조") : t("B조"))).join("·")}`).join(", "),
        };
      })
      .sort((a, b) => b.op.rarity - a.op.rarity || a.op.name.localeCompare(b.op.name))
      .slice(0, 12);
  }, [benchKeyword, plan, roster, t]);
  // synergy cores can't be swapped: token generators/consumers of active
  // systems, override/payout roles, and per-member counter bodies (쉐이)
  const activeTokens = new Set(Object.entries(plan.tokenPoints).filter(([, points]) => points > 0).map(([token]) => token));
  const counterMatches = plan.flows.flatMap((flow) => flow.generators).filter((gen) => gen.perMember).map((gen) => gen.perMember!.match);
  const isCore = (op: InfraOp) =>
    op.skills.some((skill) =>
      skill.kind === "override" || skill.kind === "payout" || skill.kind === "payout_v" ||
      skill.tokenGen.some((gen) => activeTokens.has(gen.token)) ||
      skill.tokenUse.some((use) => use.percent && activeTokens.has(use.token))) ||
    counterMatches.some((match) => factionsOf(op).some((faction) => faction.includes(match)));

  // 편성 근거 표시 (사용자 요청 2026-07-24, **모든 오퍼**): 각 스킬의 발동 조건·관계를 현재
  // 편성 기준 상태 + 관련 오퍼 칩으로 풀어 보여준다 — 진영 카운트(우미리·노시스), 파트너,
  // 타방 조건(레토·굼), 토큰 생성↔소비, 전환 공급, 계열 카운트(도로시), 동료 보너스,
  // 효율 대체(샤마르), 솔로 조건, 품질↔수익 결합, 용량↔변환(베나벌컨버블)까지.
  // 칩은 보유 로스터 내 관련 오퍼만(배치 중 = 컬러, 미배치 = 흑백), 스킬당 최대 4관계.
  // 2026-07-25 확장: 조건부 가산·기지 동반·작업 시설 동반·시설 카운트·명단 동석까지 전부 펴고,
  // 그래도 안 걸리면 용어 명단 폴백 (사용자 지적 "표시 되는 것도 있고 안 되는 것도 있다").
  const presentNow = presentIdsFor(plan, shiftIndex);
  const typeTeamIds = (roomType: string): Set<string> => {
    const ids = new Set<string>();
    for (const c of LAYOUT) {
      if (c.room !== roomType) continue;
      const shifts = plan.assignments[c.key] ?? [];
      for (const id of shifts[Math.min(shiftIndex, shifts.length - 1)] ?? []) ids.add(id);
    }
    return ids;
  };
  type Rel = { note: string; chips: { op: InfraOp; on: boolean }[] };
  // 배치 중 → 레어도 순. 보유 로스터 내 오퍼만 들어오므로 상한을 넉넉히 둔다
  // (사용자 요청 2026-07-25: "관련된 모든 오퍼레이터를 전부 다 표시")
  const chipSort = (chips: { op: InfraOp; on: boolean }[]) => chips.sort((a, b) => Number(b.on) - Number(a.on) || b.op.rarity - a.op.rarity).slice(0, 24);
  const relsOf = (skill: InfraSkill, self: InfraOp): Rel[] => {
    const rels: Rel[] = [];
    // 시간 성장형 (아로마·크루스·이네스 등): 표시·점수가 만개값이 아니라 교대 주기의
    // 시간 평균임을 명시 (사용자 요청 2026-07-25 — "처음부터 45%로 잡는 건 안 맞다")
    if (skill.growHourly) {
      const g = skill.growHourly;
      const hours = Math.round((ctx.shiftHours ?? 24) * 10) / 10;
      const full = g.rate > 0 ? Math.ceil(Math.max(0, g.cap - g.first) / g.rate) : 0;
      rels.push({
        note: t("시간 성장형 — 만개 {cap}%는 배치 {full}시간 후 도달하므로, 교대 주기 {hours}시간의 시간 평균 {avg}%로 계상", {
          cap: g.cap, full, hours, avg: Math.round(growAvg(g, ctx.shiftHours ?? 24) * 10) / 10 }),
        chips: [],
      });
    }
    // 자동화 (위디·유넥티스 — 발전소 수 스케일): 그레이 더 라이트닝베어러의 "발전소 +1개로
    // 간주"가 끼면 물리 발전소 3개인데 60%(15×4)가 나와 어리둥절해진다 — 근거를 칩으로 명시
    if (skill.kind === "automation") {
      const plants = ctx.plants ?? 3;
      const booster = roster.find((member) => member.skills.some((s) => s.kind === "plantbonus"));
      const boosterOn = booster ? presentNow.has(booster.id) : false;
      rels.push({
        note: boosterOn
          ? t("발전소 1개당 {per}% — 현재 {n}개(+1개 간주 포함) 기준 {total}%", { per: skill.value, n: plants, total: Math.round(skill.value * plants) })
          : t("발전소 1개당 {per}% — 현재 {n}개 기준 {total}%", { per: skill.value, n: plants, total: Math.round(skill.value * plants) }),
        chips: booster ? [{ op: booster, on: boosterOn }] : [],
      });
    }
    if (skill.perFaction && !skill.perSkillTag) {
      const scope = skill.kind === "ctrl_trade" ? "TRADING" : skill.perScope === "mfg" ? "MANUFACTURE" : skill.perScope === "room" ? "room" : "base";
      const inScope = scope === "room" ? new Set(team.map((member) => member.id)) : scope === "base" ? presentNow : typeTeamIds(scope);
      const members = roster.filter((member) => member.id !== self.id && memberOf(member, skill.perFaction!));
      const n = members.filter((member) => inScope.has(member.id)).length;
      const total = skill.value > 0 && skill.perCap != null ? Math.min(skill.value * n, skill.perCap) : skill.value * n;
      const where = t(scope === "TRADING" ? "무역소" : scope === "MANUFACTURE" ? "제조소" : scope === "room" ? "이 방" : "기지 전체");
      rels.push({
        note: t("{faction} 1명당 {per}% — 현재 {where} {n}명 · {total}% 적용", { faction: skill.perFaction, per: skill.value, where, n, total: Math.round(total) }),
        chips: chipSort(members.map((member) => ({ op: member, on: inScope.has(member.id) }))),
      });
    }
    if (skill.roomPartner) {
      const partner = opById.get(skill.roomPartner.id) ?? opMap.get(skill.roomPartner.id);
      if (partner) rels.push({
        note: t("{name}이(가) {room}에 배치되어 있을 때 발동", { name: partner.name, room: t(infra.rooms[skill.roomPartner.room]?.name ?? skill.roomPartner.room) }),
        chips: [{ op: partner, on: typeTeamIds(skill.roomPartner.room).has(partner.id) }],
      });
    }
    if (skill.partners.length) {
      const chips = skill.partners
        .map((id) => opById.get(id) ?? opMap.get(id))
        .filter((partner): partner is InfraOp => Boolean(partner))
        .map((partner) => ({ op: partner, on: teamIds.has(partner.id) }));
      if (chips.length) rels.push({ note: t("파트너 스킬 — 전원이 같은 방에 있을 때 발동"), chips });
    }
    // ── 조건부 가산·동반 조건 (사용자 요청 2026-07-25: "관련된 오퍼를 전부 다 표시") ────────
    // 종전엔 계산에만 반영되고 화면엔 아무 표시가 없어, 르무엔의 엑시아·캐서린의 스테인리스처럼
    // "왜 이 오퍼가 여기 있나"가 안 보였다. 조건부 가산(condBonus)·기지 동반(basePartners)·
    // 작업 시설 동반(workPartners)·시설 카운트(perFacility)·명단 동석(reqGroup)을 모두 칩으로 편다.
    if (skill.condBonus) {
      const cb = skill.condBonus;
      const ids = cb.ids ?? [];
      if (ids.length) {
        // 명단은 스킬이 지목한 id(condBonus.ids)를 그대로 쓴다 — 이름이 용어 링크인 조건은
        // 빌드 때 용어 명단으로 확장돼 있다(르무엔 '동반자' = 엑시아 + 이격 둘 다).
        const chips = ids.map((id) => opById.get(id) ?? opMap.get(id))
          .filter((partner): partner is InfraOp => Boolean(partner))
          .map((partner) => ({ op: partner, on: cb.room ? typeTeamIds(cb.room).has(partner.id) : teamIds.has(partner.id) }));
        if (chips.length) rels.push({
          note: cb.room
            ? t("{name}이(가) {room}에 있으면 추가 +{v}%", { name: chips.map((c) => c.op.name).join(", "), room: t(infra.rooms[cb.room]?.name ?? cb.room), v: cb.value })
            : t("{name}과(와) 같은 방이면 추가 +{v}%", { name: chips.map((c) => c.op.name).join(", "), v: cb.value }),
          chips,
        });
      } else if (cb.faction) {
        const members = roster.filter((member) => member.id !== self.id && memberOf(member, cb.faction!));
        rels.push({
          note: t("{faction} 오퍼와 같은 방이면 추가 +{v}% — 현재 {n}명", { faction: cb.faction, v: cb.value, n: members.filter((member) => teamIds.has(member.id)).length }),
          chips: chipSort(members.map((member) => ({ op: member, on: teamIds.has(member.id) }))),
        });
      }
    }
    if (skill.basePartners?.length && skill.basePartnerBonus) {
      const chips = skill.basePartners.map((id) => opById.get(id) ?? opMap.get(id))
        .filter((partner): partner is InfraOp => Boolean(partner))
        .map((partner) => ({ op: partner, on: presentNow.has(partner.id) }));
      if (chips.length) rels.push({
        note: t("{name}이(가) 기지 어디든(숙소 포함) 있으면 추가 +{v}%", { name: chips.map((c) => c.op.name).join(", "), v: skill.basePartnerBonus }),
        chips,
      });
    }
    if (skill.workPartners?.length && skill.workPartnerBonus) {
      const rooms = (skill.workRooms ?? []).map((room) => t(infra.rooms[room]?.name ?? room)).join("·");
      const chips = skill.workPartners.map((id) => opById.get(id) ?? opMap.get(id))
        .filter((partner): partner is InfraOp => Boolean(partner))
        .map((partner) => ({ op: partner, on: (skill.workRooms ?? []).includes(roomOf.get(partner.id) ?? "") }));
      if (chips.length) rels.push({
        note: t("{rooms}에 배치될 때마다 각각 추가 +{v}% — 현재 {n}명 충족", { rooms, v: skill.workPartnerBonus, n: chips.filter((c) => c.on).length }),
        chips,
      });
    }
    if (skill.perFacility) {
      const pf = skill.perFacility;
      const cells = new Set(pf.ids.map((id) => cellOf.get(id)).filter(Boolean) as string[]);
      const n = Math.min(pf.count, cells.size);
      const members = pf.ids.map((id) => opById.get(id) ?? opMap.get(id)).filter((member): member is InfraOp => Boolean(member));
      rels.push({
        note: t("{group} 오퍼가 배치된 시설 1개당 +{per}% — 현재 {n}개 · {total}% (최대 {cap}개)", {
          group: pf.group ?? "", per: pf.per, n, total: Math.round(pf.per * n), cap: pf.count }),
        chips: chipSort(members.map((member) => ({ op: member, on: presentNow.has(member.id) }))),
      });
    }
    if (skill.reqGroup?.ids.length) {
      const members = skill.reqGroup.ids
        .filter((id) => id !== self.id)
        .map((id) => opById.get(id) ?? opMap.get(id))
        .filter((member): member is InfraOp => Boolean(member));
      rels.push({
        note: t("{group} 오퍼와 함께 배치되어야 발동", { group: skill.reqGroup.name ?? "" }),
        chips: chipSort(members.map((member) => ({ op: member, on: teamIds.has(member.id) }))),
      });
    }
    if (skill.reqFaction) {
      const members = roster.filter((member) => member.id !== self.id && memberOf(member, skill.reqFaction!));
      rels.push({
        note: t("{group} 오퍼와 함께 배치되어야 발동", { group: skill.reqFaction }),
        chips: chipSort(members.map((member) => ({ op: member, on: teamIds.has(member.id) }))),
      });
    }
    if (skill.gateFaction) {
      const members = roster.filter((member) => member.id !== self.id && memberOf(member, skill.gateFaction!));
      const count = members.filter((member) => teamIds.has(member.id)).length + (memberOf(self, skill.gateFaction!) ? 1 : 0);
      rels.push({
        note: t("{faction} {n}명 이상일 때 발동 — 현재 {c}명", { faction: skill.gateFaction, n: skill.gateCount ?? 1, c: count }),
        chips: chipSort(members.map((member) => ({ op: member, on: teamIds.has(member.id) }))),
      });
    }
    // 토큰 생성 → 소비 오퍼 (총웨·아이리스류가 "왜" 앉는지)
    for (const gen of skill.tokenGen.slice(0, 2)) {
      const consumers = roster.filter((member) => member.id !== self.id && member.skills.some((s) => s.tokenUse.some((u) => u.token === gen.token) || s.convert?.from === gen.token));
      if (consumers.length) rels.push({
        note: t("{token} 생성 → 소비 오퍼", { token: tokenName(locale, gen.token) }),
        chips: chipSort(consumers.map((member) => ({ op: member, on: presentNow.has(member.id) }))),
      });
    }
    // 토큰 소비 ← 생성 오퍼 (슈·마르실류)
    for (const use of skill.tokenUse.slice(0, 2)) {
      const gens = roster.filter((member) => member.id !== self.id && member.skills.some((s) => s.tokenGen.some((g) => g.token === use.token) || s.convert?.to === use.token));
      if (gens.length) rels.push({
        note: t("{token} 소비 ← 생성 오퍼", { token: tokenName(locale, use.token) }),
        chips: chipSort(gens.map((member) => ({ op: member, on: presentNow.has(member.id) }))),
      });
    }
    // 전환 (에벤홀츠·지에윈): 원료 토큰 공급자
    if (skill.convert) {
      const sources = roster.filter((member) => member.id !== self.id && member.skills.some((s) => s.tokenGen.some((g) => g.token === skill.convert!.from)));
      if (sources.length) rels.push({
        note: t("{from} → {to} 전환 — 공급 오퍼", { from: tokenName(locale, skill.convert.from), to: tokenName(locale, skill.convert.to) }),
        chips: chipSort(sources.map((member) => ({ op: member, on: presentNow.has(member.id) }))),
      });
    }
    // 계열 카운트 (도로시·브라이오피타): 같은 방의 계열 스킬 보유자
    if (skill.perSkillTag && skill.perSkillValue) {
      const tag = skill.perSkillTag;
      const holders = roster.filter((member) => member.id !== self.id && member.skills.some((s) => (s.families ?? []).includes(tag) && skillApplies(s, cell.room, cell.product)));
      const n = team.filter((member) => member.id !== self.id && member.skills.some((s) => (s.families ?? []).includes(tag) && skillApplies(s, cell.room, cell.product))).length;
      rels.push({
        note: t("{tag}류 스킬 1개당 {per}% — 현재 이 방 {n}개 · {total}%", { tag, per: skill.perSkillValue, n, total: Math.round(skill.perSkillValue * n) }),
        chips: chipSort(holders.map((member) => ({ op: member, on: teamIds.has(member.id) }))),
      });
    }
    if (skill.kind === "percoworker") {
      const n = Math.max(0, team.length - 1);
      rels.push({ note: t("동료 1명당 {per}% — 현재 {n}명 · {total}%", { per: skill.value, n, total: Math.round(skill.value * n) }), chips: [] });
    }
    if (skill.kind === "override") rels.push({ note: t("같은 방 전원의 효율을 대체합니다 — 인당 {per}%", { per: skill.value }), chips: [] });
    if (skill.kind === "solo") rels.push({ note: t("혼자 근무할 때만 발동 — 현재 이 방 {n}명", { n: team.length }), chips: [] });
    if (skill.kind === "quality") {
      const payoutOps = team.filter((member) => member.id !== self.id && member.skills.some((s) => (s.kind === "payout" || s.kind === "payout_v") && skillApplies(s, cell.room, cell.product)));
      rels.push({ note: t("고품질 확률 — 오더 수익 오퍼와 결합 시 극대화"), chips: payoutOps.map((member) => ({ op: member, on: true })) });
    }
    if (skill.kind === "payout" || skill.kind === "payout_v") {
      const qualityOps = team.filter((member) => member.id !== self.id && member.skills.some((s) => s.kind === "quality" && skillApplies(s, cell.room, cell.product)));
      rels.push({ note: t("고품질 오더 수익 — 확률 오퍼와 결합 시 극대화"), chips: qualityOps.map((member) => ({ op: member, on: true })) });
    }
    // 용량 ↔ 변환 (베나·벌컨 ↔ 버블·데겐블레허)
    if ((skill.cap ?? 0) !== 0) {
      const converters = roster.filter((member) => member.id !== self.id && member.skills.some((s) => s.capConv != null && skillApplies(s, cell.room, cell.product)));
      if (converters.length) rels.push({
        note: t("용량 {n}칸 — 변환 오퍼가 생산력으로 되돌립니다", { n: skill.cap! > 0 ? `+${skill.cap}` : skill.cap }),
        chips: chipSort(converters.map((member) => ({ op: member, on: teamIds.has(member.id) }))),
      });
    }
    if (skill.capConv != null) {
      // 비중첩 (사용자 제보 2026-07-29) — 같은 방에 이 스킬을 죽이는 변환기(버블 '큰 게 좋아!'가
      // 버메일 '재활용'을)가 있으면 "전환한다"가 아니라 "안 걸린다"고 말해야 한다.
      const killers = team.filter((member) => member.id !== self.id && member.skills.some((s) =>
        s.capConv?.over?.includes(skill.name) && skillApplies(s, cell.room, cell.product)));
      const providers = team.filter((member) => member.id !== self.id && member.skills.some((s) => (s.cap ?? 0) !== 0 && skillApplies(s, cell.room, cell.product)));
      rels.push(killers.length
        ? { note: t("중첩되지 않음 — 같은 방의 변환 스킬이 우선 발동됩니다"), chips: killers.map((member) => ({ op: member, on: true })) }
        : { note: t("적립 용량을 생산력으로 전환"), chips: providers.map((member) => ({ op: member, on: true })) });
    }
    // 용어 명단 폴백 — 스킬이 참조하는 게임 용어가 오퍼 명단으로 정의된 그룹(쉐이·정예
    // 오퍼레이터·라이오스 파티·작업 플랫폼 등)이면 그 오퍼들을 칩으로 보여 준다.
    // 위에서 **지목 id로 이미 관계를 편 스킬은 건너뛴다** — 같은 명단이 두 줄로 중복된다
    // (르무엔 '동반자'의 엑시아 2명은 condBonus 줄이 이미 보여 준다).
    const named = Boolean(skill.condBonus?.ids?.length || skill.partners.length || skill.basePartners?.length
      || skill.workPartners?.length || skill.roomPartner || skill.perFacility || skill.reqGroup);
    if (!named) {
      const seen = new Set(rels.flatMap((rel) => rel.chips.map((chip) => chip.op.id)));
      for (const [key] of skill.termRefs ?? []) {
        // 진영 카운트·게이트로 이미 편 그룹은 건너뛴다 (야하타 '시라쿠사' 중복 표시 방지)
        if (TERMS[key]?.name && [skill.perFaction, skill.gateFaction, skill.reqFaction].includes(TERMS[key].name)) continue;
        const members = (TERMS[key]?.ops ?? [])
          .filter((id) => id !== self.id && !seen.has(id))
          .map((id) => opById.get(id) ?? opMap.get(id))
          .filter((member): member is InfraOp => Boolean(member));
        if (!members.length) continue;
        rels.push({
          note: t("{term} — 관련 오퍼", { term: TERMS[key]?.name ?? key }),
          chips: chipSort(members.map((member) => ({ op: member, on: presentNow.has(member.id) }))),
        });
        for (const member of members) seen.add(member.id);
      }
    }
    return rels.slice(0, 4);
  };

  return (
    <ModalWindow label={t(cell.label)} className="operator-modal room-modal" onClose={onClose} style={{ "--accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
        <header className="room-modal-head">
          <span className="modal-kicker">FACILITY FILE · {cell.room}</span>
          {/* 레벨 조절 버튼은 시설 이름 오른쪽에 (사용자 요청 2026-07-24) */}
          <div className="room-head-row">
            <h2>{t(cell.label)}</h2>
            {/* 시설 레벨 선택 (전력·레벨 시스템 2026-07-24) — 슬롯·전력·레벨 연동 스킬에 즉시 반영 */}
            {onSetLevel && maxLevelOf(cell.room) > 1 && (
              <div className="room-level-sel" role="radiogroup" aria-label={t("시설 레벨")}
                title={t("레벨을 낮추면 전력 소비가 줄고, 제조소·무역소는 근무 슬롯도 줄어듭니다")}>
                <span className="room-level-lbl">{t("레벨")}</span>
                {Array.from({ length: maxLevelOf(cell.room) }, (_, i) => i + 1).map((lv) => (
                  <button key={lv} type="button" className={levelOf(cell.key) === lv ? "on" : ""}
                    onClick={() => onSetLevel(cell.key, lv)}>{lv}</button>
                ))}
                <span className="room-level-power">{(infra.rooms[cell.room]?.phases?.[levelOf(cell.key) - 1]?.electricity ?? 0) > 0 ? "⚡+" : "⚡"}{infra.rooms[cell.room]?.phases?.[levelOf(cell.key) - 1]?.electricity ?? 0}</span>
              </div>
            )}
            {/* 현재 레벨의 효과 한 줄 — 헤더 높이를 늘리지 않게 (사용자 요청 2026-07-24) */}
            {(() => {
              const i = levelOf(cell.key) - 1;
              const p = infra.rooms[cell.room]?.phases?.[i];
              if (!p) return null;
              const fx = (() => {
                switch (cell.room) {
                  case "TRADING": return t("오더 대기 상한 {n} · 오더 등급 {r}", { n: p.orderLimit ?? 0, r: p.orderRarity ?? 0 });
                  case "MANUFACTURE": return t("제품 보관함 {n}칸", { n: p.capacity ?? 0 });
                  case "POWER": return t("무인기 회복 가속");
                  case "DORMITORY": return t("기본 회복 계수 {n} · 인테리어 분위기 상한 {m}", { n: p.recover ?? 0, m: p.ambience ?? 0 });
                  case "MEETING": return t("친구 상한 +{n} · 단서 수집", { n: p.friendSlots ?? 0 });
                  // 공개모집 슬롯 해금은 building_data 밖 게임 내 기준 (INFRA-RULES §1) — Lv1/2/3 = 2/3/4 슬롯
                  case "HIRE": return t("연락 속도 가속 · 공개모집 슬롯 {n}개 (제어센터 만렙 기준)", { n: [2, 3, 4][i] ?? 4 });
                  case "TRAINING": return t("특화 훈련 상한: 특화 {n}", { n: p.specLimit ?? 0 });
                  case "WORKSHOP": return t("가공 레시피 누적 {n}종", { n: p.recipes ?? 0 });
                  case "CONTROL": return t("기지 확장 해금 — 제어센터 레벨이 다른 시설의 최대 레벨·개수를 결정합니다");
                  default: return "";
                }
              })();
              return <span className="room-level-fxline">{t("{n}인", { n: p.slots ?? 1 })} · {fx}</span>;
            })()}
          </div>
          {/* 조 탭 + 종합 효율을 헤더 한 줄에 (사용자 요청 2026-07-30: "밑으로 드르륵 하면
              종합효율이 안 보여서 곤란"). 모달은 grid(헤더 auto + 본문 1fr)라 헤더는 원래부터
              스크롤 밖 고정이므로, 요약을 여기로 올리는 것만으로 항상 보인다 — 본문의
              RESULT/00 섹션은 그래서 없앴다(같은 숫자를 두 번 그리지 않는다). */}
          {cell.room !== "DORMITORY" && (
            <div className="room-head-foot">
              <div className="shift-tabs in-modal">
                {Array.from({ length: SHIFT_COUNT }, (_, i) => (
                  <button key={i} className={shift === i ? "selected" : ""} onClick={() => setShift(i)}>{[t("A조"), t("B조")][i]}</button>
                ))}
              </div>
              {scored && (
                <div className="room-head-eff">
                  <span className="rh-eff-total">
                    {t("종합 효율")}{cell.product ? ` · ${t(cell.product === "gold" ? "순금" : "작전기록")}` : ""}
                    <b>+{currentScore}{cell.room === "CONTROL" ? "" : "%"}</b>
                  </span>
                  <span className="rh-eff-parts">
                    {Object.entries(agg).filter(([, value]) => Math.round(value) !== 0).map(([name, value]) => (
                      <span key={name}>{t(name)} <b>{Math.round(value) >= 0 ? "+" : ""}{Math.round(value)}</b></span>
                    ))}
                    {team.length === 0 && <span>{t("편성 없음")}</span>}
                  </span>
                </div>
              )}
            </div>
          )}
        </header>
        <div className="modal-scroll">
          <section className="detail-section">
            <span className="detail-no">CREW / 01</span>
            <h3>{t("편성 ({a}/{b})", { a: team.length, b: slots })}</h3>
            {cell.room === "DORMITORY" && (
              <p className="dorm-note">{rich(t("숙소는 **항상 5명을 꽉 채운 상태로 유지**하세요. 고정 생성원 외의 빈 자리는 휴식이 필요한 아무 오퍼레이터로 채우면 됩니다 — 토큰 생성과 회복 효율은 풀 인원 기준으로 계산됩니다."))}</p>
            )}
            {/* 배치 방법 안내는 방 카드가 아니라 여기(숙소 상세) 몫이다 — 카드는 다른 시설과
                똑같이 표시 전용 (사용자 요청 2026-07-28) */}
            {cell.room === "DORMITORY" && onToggleDormPin && (
              <p className="dorm-note">{rich(t("**숙소 인원은 여기서 직접 넣고 뺍니다** — 아래 후보를 누르면 즉시 배치되고, 이렇게 직접 넣은 오퍼는 **📌 고정**되어 자동편성이 그대로 둡니다 (울피아누스를 숙소에 고정해 언더플로우 +10%를 켜는 식). 카드의 📌를 눌러 고정을 걸거나 풀 수 있고, ✕로 빼면 고정도 함께 풀립니다."))}</p>
            )}
            <div className="crew-list">
              {team.map((op) => {
                const b = breakdown(op, cell.room, team, ctx);
                // 기여를 성분별로 풀어서 표시 — 특히 제어센터 오라는 내부 가중치 점수가
                // 아니라 실제 효과("무역소 오더 효율 오라 +10%")로 보여준다
                const pct = cell.room === "CONTROL" ? "" : "%";
                const parts: string[] = [];
                if (Math.round(b.efficiency) !== 0) parts.push(`${t(UNIT[cell.room] ?? "효율")} +${Math.round(b.efficiency)}${pct}`);
                if (Math.round(b.facilityEff) !== 0) parts.push(t("시설 기반 +{n}%", { n: Math.round(b.facilityEff) }));
                if (Math.round(b.automation) !== 0) parts.push(t("자동화 +{n}%", { n: Math.round(b.automation) }));
                if (b.amplify.length) {
                  const ampAdd = b.amplify.reduce((s, spec) => s + Math.min(spec.cap, Math.floor(agg["스킬 효율"] / spec.per) * spec.add), 0);
                  if (Math.round(ampAdd) !== 0) parts.push(t("증폭 +{n}%", { n: Math.round(ampAdd) }));
                }
                if (Math.round(b.quality) !== 0) parts.push(t("고품질 확률 +{n}%p 상당", { n: Math.round(b.quality) }));
                if (Math.round(b.payout + b.payoutViolation) !== 0) parts.push(t("오더 수익 +{n}% 상당", { n: Math.round(b.payout + b.payoutViolation) }));
                if (b.override > 0) parts.push(t("효율 대체 인당 +{n}%", { n: Math.round(b.override) }));
                if (Math.round(b.perCoworker * (team.length - 1)) !== 0) parts.push(t("동료 보너스 +{n}%", { n: Math.round(b.perCoworker * (team.length - 1)) }));
                if (Math.round(b.clueBase) !== 0) parts.push(t("레어도 기본 {r}성·{e} +{n}%", { r: op.rarity, e: t(ELITE_LABEL[op.elite ?? maxElite(op.rarity)]), n: Math.round(b.clueBase) }));
                for (const [kind, value] of Object.entries(b.auras)) if (value > 0) parts.push(`${t(AURA_LABEL[kind] ?? kind)} +${Math.round(value)}%`);
                // 이 방에 걸리는 스킬 + **생산품이 안 맞아 잠긴 스킬**까지 함께 보여 준다
                // (사용자 제보 2026-07-29: "씬·팔라스 2정예화 인프라 누락"). 씬 '편집 α'와
                // 팔라스 '승리의 계책'은 작전기록 전용이라 순금방에선 안 걸리는 게 맞는데,
                // 종전엔 목록에서 통째로 사라져 데이터가 빠진 것처럼 보였다. 이제 회색으로
                // 남기고 "작전기록 방에서만" 꼬리표를 단다 — 계산엔 여전히 안 들어간다.
                const active = new Set(b.skills.map((skill) => skill.name));
                const unused = (skill: InfraSkill) => !active.has(skill.name)
                  && !(skill.tiers ?? []).some((tier) => active.has(tier.name));
                const gated = op.skills.filter((skill) => skill.room === cell.room && unused(skill));
                // **다른 시설 스킬도 지우지 않는다** — 흐릿하게 남기고 어느 시설 것인지 꼬리표를
                // 단다 (사용자 요청 2026-07-31: "에이야 같은 경우 제조소에 넣으면 사무실 관련
                // 인프라가 아예 사라짐"). 위 생산품 잠금 스킬과 같은 관례로, 계산엔 안 들어간다.
                const elsewhere = op.skills.filter((skill) => skill.room !== cell.room && unused(skill));
                const shown = [...b.skills, ...gated, ...elsewhere];
                return (
                  <article key={op.id} className="crew-card">
                    {tempIds.has(op.id) && <button type="button" className="crew-revert" title={t("이 오퍼만 임시 적용을 되돌립니다")} onClick={() => onRevertTempOne(op.id)}>↩</button>}
                    {onToggleDormPin && (
                      <button type="button" className={`crew-pin${dormPins?.includes(op.id) ? " on" : ""}`}
                        title={dormPins?.includes(op.id) ? t("숙소 고정 해제 — 다음 자동편성이 이 자리를 다시 짤 수 있습니다") : t("숙소에 고정 — 자동편성이 이 인원을 그대로 둡니다")}
                        onClick={() => onToggleDormPin(op.id)}>📌</button>
                    )}
                    {onUpdateTeam && <button type="button" className="crew-remove" title={t("이 자리에서 빼기")} onClick={() => setIds(rawIds.filter((id) => id !== op.id))}>✕</button>}
                    <span className={`crew-face${tempIds.has(op.id) ? " temp" : ""}`}>
                      <img src={asset(op.image)} alt={op.name} width={180} height={180} loading="lazy" className={onShowOperator ? "op-link" : undefined}
                        title={tempIds.has(op.id) ? t("{name} — 임시 적용 중 (완성 가정 미리보기)", { name: op.name }) : t("{name} 상세 정보", { name: op.name })} onClick={() => onShowOperator?.(op.id)} />
                      {tempIds.has(op.id) && <i className="op-temp-badge" aria-hidden>{t("임시")}</i>}
                    </span>
                    <div>
                      <b>
                        {op.name} <i>{"★".repeat(op.rarity)}</i>
                        {(() => {
                          // 정예화 판정은 스킬이 필터링되지 않은 원본(opById) 기준
                          const master = opById.get(op.id);
                          const options = master ? eliteOptions(master) : [];
                          if (!options.length) return null;
                          const current = Math.min(eliteById.get(op.id) ?? 2, options[options.length - 1]) as Elite;
                          return (
                            <span className="elite-pill" role="group" aria-label={t("{name} 정예화 단계", { name: op.name })}>
                              {options.map((option) => (
                                <button key={option} type="button" className={current === option ? "selected" : ""} onClick={() => onSetElite(op.id, option)}>{t(ELITE_LABEL[option])}</button>
                              ))}
                            </span>
                          );
                        })()}
                      </b>
                      {shown.length ? shown.map((skill) => {
                        const off = !active.has(skill.name);
                        const rels = off ? [] : relsOf(skill, op);
                        return (
                          <p key={skill.name} className={off ? "skill-off" : undefined}>
                            <em>{skill.name}</em> — <TermText text={skill.description} refs={skill.termRefs} onTerm={setTermOpen} />
                            {off && (
                              <i className="skill-off-tag">
                                {skill.room !== cell.room ? t("{room} 스킬 — 이 시설에서는 적용되지 않음", { room: t(infra.rooms[skill.room]?.name ?? skill.room) })
                                  : skill.product === "gold" ? t("순금 제조소에서만 적용")
                                  : skill.product === "exp" ? t("작전기록 제조소에서만 적용")
                                  : t("이 방에서는 적용되지 않음")}
                              </i>
                            )}
                            {rels.map((rel) => (
                              <span key={rel.note} className="skill-rel">
                                <i className="rel-note">{rel.note}</i>
                                <span className="rel-chips">
                                  {rel.chips.map(({ op: relOp, on }) => (
                                    <img key={relOp.id} src={relOp.image} alt={relOp.name} width={44} height={44} loading="lazy"
                                      className={on ? "on" : ""}
                                      title={on ? relOp.name : t("{name} — 미배치", { name: relOp.name })}
                                      onClick={(event) => { event.stopPropagation(); onShowOperator?.(relOp.id); }} />
                                  ))}
                                </span>
                              </span>
                            ))}
                          </p>
                        );
                      }) : <p>{t("이 시설에 적용되는 스킬이 없습니다 (세트 대기 요원).")}</p>}
                      {parts.map((part) => <small key={part}>{part}</small>)}
                      {op.skills.flatMap((skill) => skill.tokenGen).map((gen) => (
                        <small key={`${op.id}-${gen.token}`} className="token-chip">{t("{token} +{n}점 생성", { token: tokenName(locale, gen.token), n: Math.round(gen.estimate) })}</small>
                      ))}
                      {isCore(op) ? (
                        <div className="slot-subs"><small className="core-chip">{t("대체 불가 · 시너지 코어")}</small></div>
                      ) : (
                        <div className="slot-subs">
                          <span>{t("이 자리 대체 오퍼:")}</span>
                          {slotSubstitutes(team, team.indexOf(op), cell.key, ctx, excluded, roster).map(({ op: sub, score }) => (
                            <small key={sub.id} className={`sub-chip${onUpdateTeam ? " swappable" : ""}`}
                              title={`${t("클릭하면 {name} 자리에 교체", { name: op.name })}\n${sub.skills.filter((skill) => skill.room === cell.room).map((skill) => `${skill.name}: ${skill.description}`).join("\n")}`}
                              onClick={() => onUpdateTeam && setIds(rawIds.map((id) => (id === op.id ? sub.id : id)))}>
                              <img src={sub.image} alt="" width={180} height={180} loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={(event) => { event.stopPropagation(); onShowOperator?.(sub.id); }} />{sub.name} <em>{score >= currentScore ? t("동급") : `-${currentScore - score}`}</em>
                            </small>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
              {team.length === 0 && !benchFull.length && <p className="no-detail">{t("자동 편성을 먼저 실행해 주세요.")}</p>}
            </div>
            {benchFull.length > 0 && (
              <div className="bench">
                <span>{cell.room === "DORMITORY"
                  ? t("빈 자리에 추가 — 클릭 시 즉시 배치·고정 (다른 방의 조건을 켜 주는 오퍼가 맨 앞):")
                  : t("빈 자리에 추가 — 클릭 시 즉시 배치 (기여 예상):")}</span>
                <input className="bench-search" {...benchProps} placeholder={t("이름·소속으로 후보 검색")} />
                {bench.length > 0 ? (
                  <div className="bench-chips">
                    {bench.map(({ op, delta }) => {
                      // 숙소는 자체 산출이 없어 기여가 전부 0 — 대신 "누구의 조건을 켜 주는지"를 보여준다
                      const wakes = enablerFor.get(op.id);
                      // 자동편성 제외 명단(케이퍼·인포서)은 후보로만 뜬다 — 직접 넣는 건 자유 (2026-07-28)
                      const manualOnly = AUTO_BENCH_IDS.has(op.id);
                      return (
                        <small key={op.id} className={`sub-chip swappable${wakes ? " enabler" : ""}${manualOnly ? " manual-only" : ""}`}
                          title={manualOnly
                            ? t("자동편성 제외 — 조건을 많이 타고 컨디션 소모가 커서 자동으로는 배치하지 않습니다. 직접 넣는 건 가능합니다")
                            : wakes ? t("{name}의 조건을 켭니다 (기지 어디든 있으면 발동)", { name: wakes }) : t("{name} 추가", { name: op.name })}
                          onClick={() => setIds([...rawIds, op.id])}>
                          <img src={asset(op.image)} alt="" width={180} height={180} loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={(event) => { event.stopPropagation(); onShowOperator?.(op.id); }} />{op.name}{" "}
                          <em>{manualOnly ? t("수동 전용") : wakes ? t("{name} 조건", { name: wakes }) : delta >= 0 ? `+${delta}` : delta}</em>
                        </small>
                      );
                    })}
                  </div>
                ) : busyMatches.length === 0 && (
                  <p className="no-detail">{t("검색 결과가 없습니다.")}</p>
                )}
                {/* 이미 근무 중이라 후보에 못 뜨는 오퍼 — 어디 있는지 알려주고, 누르면 그 시설
                    상세로 건너뛴다 (사용자 요청 2026-07-31: 오퍼 상세는 얼굴 클릭으로 충분) */}
                {busyMatches.length > 0 && (
                  <div className="bench-busy">
                    <span>{t("이미 근무 중 — 빼려면 그 시설에서 ✕를 누르세요:")}</span>
                    <div className="bench-chips">
                      {busyMatches.map(({ op, at, go }) => (
                        <small key={op.id} className="sub-chip busy"
                          title={t("{at}로 이동 — {name}은(는) 여기서 근무 중입니다", { at, name: op.name })}
                          /* 같은 방의 다른 조면 openRoom 값이 그대로라 모달이 새로 마운트되지
                             않는다 — 그 경우엔 여기서 조 탭만 바꾼다 (사용자 제보 2026-07-31:
                             제어센터 A조에서 B조 근무자를 눌러도 A조가 그대로였다) */
                          onClick={() => (go.key === cell.key ? setShift(go.shift) : onOpenRoom?.(go.key, go.shift))}>
                          <img src={asset(op.image)} alt="" width={180} height={180} loading="lazy"
                            className={onShowOperator ? "op-link" : undefined}
                            onClick={(event) => { event.stopPropagation(); onShowOperator?.(op.id); }} />{op.name}{" "}
                          <em>{at}</em>
                        </small>
                      ))}
                    </div>
                  </div>
                )}
                {benchFiltered.length > 12 && (
                  <button type="button" className="more-filter" onClick={() => setBenchAll((current) => !current)}>
                    {benchAll ? t("접기") : t("더 많이 보기 (전체 {n}명)", { n: benchFiltered.length })}
                  </button>
                )}
              </div>
            )}
          </section>

        </div>
      {/* RIIC 용어 정의 팝업 — 스킬 설명의 용어(외세·실리·시라쿠사 등) 클릭 시. 중첩 창이라
          ESC 전역 핸들러(z-index 최상단)와 자기-타깃 클릭 닫기가 이 팝업만 먼저 닫는다. */}
      {termOpen && (
        <TermPopup termKey={termOpen} presentIds={presentNow} onNavigate={setTermOpen}
          onShowOperator={onShowOperator} onClose={() => setTermOpen(null)} />
      )}
    </ModalWindow>
  );
}

function FlowModal({ plan, opMap, onClose, onShowOperator }: { plan: Plan; opMap: Map<string, InfraOp>; onClose: () => void; onShowOperator?: (id: string) => void }) {
  const { locale, t } = useI18n();
  const flows = plan.flows.filter((flow) => flow.generators.length > 0 || flow.consumers.length > 0);
  const avatar = (op: InfraOp | undefined) => op ? (
    <img src={asset(op.image)} alt="" width={180} height={180} loading="lazy" className={onShowOperator ? "op-link" : undefined}
      title={onShowOperator ? t("{name} 상세 정보", { name: op.name }) : undefined} onClick={() => onShowOperator?.(op.id)} />
  ) : null;
  return (
    <ModalWindow label={t("시너지 트리")} className="operator-modal room-modal" onClose={onClose} style={{ "--accent": "var(--lime)" } as React.CSSProperties}>
        <header className="room-modal-head">
          <span className="modal-kicker">SYNERGY LEDGER · {t("A조 기준")}</span>
          <h2>{t("시너지 트리")}</h2>
        </header>
        <div className="modal-scroll">
          {flows.length === 0 && <p className="no-detail">{t("활성화된 포인트 시너지가 없습니다.")}</p>}
          {flows.map((flow) => (
            <section key={flow.token} className="detail-section flow-tree">
              <h3>{tokenName(locale, flow.token)} <span className="flow-total">{t("총 {n}점", { n: Math.round(flow.total) })}</span></h3>
              <ul>
                <li className="flow-branch">{t("생성")}
                  <ul>
                    {flow.generators.map((gen, index) => {
                      const op = opMap.get(gen.opId);
                      return (
                        <li key={`${gen.opId}-${index}`}>
                          {avatar(op)}
                          <b>{op?.name ?? gen.opId}</b> <i>{t(gen.at)}</i>
                          <em>{t("+{n}점", { n: Math.round(gen.amount) })}{gen.via ? t(" ({token} 전환)", { token: tokenName(locale, gen.via) }) : ""}</em>
                        </li>
                      );
                    })}
                    {flow.generators.length === 0 && <li><em>{t("생성원이 배치되지 않음")}</em></li>}
                  </ul>
                </li>
                {flow.converters.length > 0 && (
                  <li className="flow-branch">{t("전환")}
                    <ul>
                      {flow.converters.map((conv) => {
                        const op = opMap.get(conv.opId);
                        return <li key={conv.opId}>{avatar(op)}<b>{op?.name}</b> <em>{tokenName(locale, conv.from)} → {tokenName(locale, flow.token)}</em></li>;
                      })}
                    </ul>
                  </li>
                )}
                <li className="flow-branch">{t("소비")}
                  <ul>
                    {flow.consumers.map((consumer, index) => {
                      const op = opMap.get(consumer.opId);
                      return (
                        <li key={`${consumer.opId}-${index}`}>
                          {avatar(op)}
                          <b>{op?.name ?? consumer.opId}</b> <i>{t(consumer.at)}</i>
                          <em>{consumer.percent
                            ? t("{token} {n}점 소비 → {unit} +{m}% (1점당 +{r}%)", { token: tokenName(locale, flow.token), n: Math.round(flow.total), unit: t(UNIT[consumer.room] ?? "효율"), m: Math.round(consumer.gain), r: consumer.rate })
                            : t("{token} 기반 컨디션 회복·소모 보정", { token: tokenName(locale, flow.token) })}</em>
                        </li>
                      );
                    })}
                    {flow.consumers.length === 0 && <li><em>{t("소비자가 배치되지 않음")}</em></li>}
                  </ul>
                </li>
              </ul>
            </section>
          ))}
        </div>
    </ModalWindow>
  );
}

// 보유 오퍼 카드 — memo로 감싼다. 카드가 405장이라 memo가 없으면 체크 한 번에 전 카드가
// 다시 렌더돼 클릭 응답이 CPU 4배 느린 환경에서 ~49ms까지 늘었다 (INP 악화, 2026-07-26 실측).
// props를 전부 원시값·안정 참조로 유지해야 memo가 듣는다 — options는 op에서 파생되므로
// 배열을 넘기지 않고 안에서 계산한다.
const RosterCard = memo(function RosterCard({ op, owned, elite, level, onToggle, onElite, onLevel, onShowOperator, t }: {
  op: InfraOp; owned: boolean; elite: Elite; level: number | undefined;
  onToggle: (id: string) => void; onElite: (id: string, elite: Elite) => void;
  onLevel: (id: string, level: number | undefined) => void;
  onShowOperator?: (id: string) => void; t: T;
}) {
  const options = eliteOptions(op);
  // 레벨은 노정예에서만 인프라 계산에 영향을 준다('Lv.30' 해금 스킬) — 1정 이상은
  // 그 조건을 이미 넘겼으므로 입력칸을 흐리게 두되 기록은 그대로 남긴다
  const levelMatters = elite === 0;
  return (
    <div className={`roster-card${owned ? " owned" : ""}${op.unreleased ? " future" : ""}`}>
      <button type="button" onClick={() => onToggle(op.id)} title={op.name}>
        <img src={asset(op.image)} alt={op.name} width={180} height={180} loading="lazy" className={onShowOperator ? "op-link" : undefined}
          onClick={(event) => { if (onShowOperator) { event.stopPropagation(); onShowOperator(op.id); } }} />
        <span>{op.name}{op.unreleased && <em className="future-badge">{t("미실장")}</em>}</span>
      </button>
      {owned && options.length > 0 && (
        <div className="elite-toggle" role="group" aria-label={t("{name} 정예화 단계", { name: op.name })}>
          {options.map((option) => (
            <button key={option} type="button" className={elite === option ? "selected" : ""} onClick={() => onElite(op.id, option)}>{t(ELITE_LABEL[option])}</button>
          ))}
        </div>
      )}
      {owned && (
        <label className={`roster-level${levelMatters ? "" : " dim"}`}
          title={levelMatters
            ? t("노정예 Lv.30부터 열리는 기지 스킬이 있어 레벨이 계산에 반영됩니다")
            : t("1정 이상은 레벨 조건을 이미 넘겨 계산에 영향이 없습니다")}>
          <span>Lv.</span>
          <input type="number" min={1} max={MAX_OP_LEVEL} inputMode="numeric"
            value={level ?? ""} placeholder="—"
            aria-label={t("{name} 레벨", { name: op.name })}
            onChange={(event) => {
              const raw = event.target.value.trim();
              if (!raw) { onLevel(op.id, undefined); return; }
              const n = Math.round(Number(raw));
              if (Number.isFinite(n)) onLevel(op.id, Math.max(1, Math.min(MAX_OP_LEVEL, n)));
            }} />
        </label>
      )}
    </div>
  );
});

function RosterModal({ allOps, ownedIds, eliteById, levelById, onApply, onClose, onShowOperator, mode, onMode }:{ allOps: InfraOp[]; ownedIds: Set<string>; eliteById: Map<string, Elite>; levelById: Map<string, number>; onApply: (ids: Set<string>, elite: Map<string, Elite>, level: Map<string, number>) => void; onClose: () => void; onShowOperator?: (id: string) => void; mode: "direct" | "import"; onMode: (m: "direct" | "import") => void }) {
  const { t } = useI18n();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<Set<string>>(new Set(ownedIds));
  const [eliteDraft, setEliteDraft] = useState<Map<string, Elite>>(new Map(eliteById));
  const [levelDraft, setLevelDraft] = useState<Map<string, number>>(new Map(levelById));
  const [showScan, setShowScan] = useState(false); // 스크린샷 스캐너(모달 내부에서 draft에 병합)
  // 입력 방식 두 종류 (사용자 확정 2026-07-26): 직접 입력 = 카드 격자에서 손으로 체크,
  // 가져오기 = MAA 파일·스크린샷·게임 로그인. 가져온 결과는 직접 입력 화면에서 검토한 뒤 적용한다.
  // 상태는 부모(딥링크 #roster/#roster-import 동기화)가 쥔다 (2026-07-27)
  const setMode = onMode;
  // 비제어 입력 — 450칩 목록을 한 글자마다 다시 그리지 않는다 (search.ts)
  const { term: searchTerm, inputProps: searchProps } = useSearchInput();
  const [sortKey, setSortKey] = useState("기본");
  const [sortAsc, setSortAsc] = useState(true);
  const keyword = searchTerm.trim().toLowerCase();
  // 백과사전과 동일한 정렬 (직군·세부 직군·출신지·종족 포함). 기본 = 6성↓ → KR 출시 최신순.
  // **검색어·정렬이 그대로면 다시 계산하지 않는다** — 체크 한 번마다 405개를 필터 + 두 번
  // 정렬하던 것이 클릭 응답(INP)의 최대 비용이었다 (2026-07-26 실측).
  const { futureOps, releasedOps, visible } = useMemo(() => {
    const filtered = allOps.filter((op) => !keyword || op.name.toLowerCase().includes(keyword) || op.faction.toLowerCase().includes(keyword));
    const sortOps = (list: InfraOp[]): InfraOp[] => {
      if (sortKey === "기본") {
        const base = [...list].sort((a, b) => b.rarity - a.rarity || b.seq - a.seq);
        return sortAsc ? base : base.reverse();
      }
      const valueOf = (op: InfraOp): string | number =>
        sortKey === "이름" ? op.name : sortKey === "성급" ? op.rarity : sortKey === "발매순" ? op.seq
        : sortKey === "출신지" ? op.birthplace : sortKey === "종족" ? op.race
        : sortKey === "직군" ? JOB_ORDER.indexOf(op.jobCode) : sortKey === "세부 직군" ? op.subProfession
        : op.faction;
      const direction = sortAsc ? 1 : -1;
      return [...list].sort((a, b) => {
        const left = valueOf(a), right = valueOf(b);
        const compared = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "ko");
        return compared !== 0 ? compared * direction : a.name.localeCompare(b.name, "ko");
      });
    };
    // 미실장(중국 선행) 오퍼는 위쪽에 따로 빼서 보여준다 (사용자 요청) — 각 그룹 내부는 선택 정렬
    const future = sortOps(filtered.filter((op) => op.unreleased));
    const released = sortOps(filtered.filter((op) => !op.unreleased));
    return { futureOps: future, releasedOps: released, visible: [...future, ...released] };
  }, [allOps, keyword, sortKey, sortAsc]);
  // useCallback 필수 — RosterCard의 memo가 이 참조로 판정한다
  // 새로 체크한 오퍼는 **노정예로 시작**한다 (사용자 확정 2026-07-30: "체크하면 기본적으로는
  // 노정예로 해 줘"). 체크하는 순간 0을 명시로 써 넣는 방식이다 — 저장 규약(맵에 값이 없으면
  // 만정예)까지 뒤집으면 **이미 저장된 로스터가 통째로 노정예가 되어** 기존 편성이 무너진다.
  // 그래서 새로 들어오는 오퍼만 노정예고, 예전에 체크해 둔 오퍼는 건드리지 않는다.
  // 가져오기(MAA·스캐너·계정 연동)는 진짜 정예화를 실어 오므로 이 기본값을 타지 않는다.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const startAtE0 = (map: Map<string, Elite>, ids: string[]) => {
    let next: Map<string, Elite> | null = null;
    for (const id of ids) {
      if (map.has(id)) continue;                       // 이미 지정된 값은 존중
      const op = opById.get(id);
      if (!op || eliteOptions(op).length === 0) continue; // 1~2성은 승급 자체가 없다
      next ??= new Map(map);
      next.set(id, 0);
    }
    return next ?? map;
  };
  // 새로 체크한 오퍼는 **Lv.1로 시작**한다 (사용자 확정 2026-08-04) — 노정예 시작과 같은
  // 규약이며, 이미 값이 있는 오퍼(가져오기로 실제 레벨이 들어온 것 포함)는 건드리지 않는다
  const startAtLv1 = (map: Map<string, number>, ids: string[]) => {
    let next: Map<string, number> | null = null;
    for (const id of ids) {
      if (map.has(id)) continue;
      next ??= new Map(map);
      next.set(id, 1);
    }
    return next ?? map;
  };
  const toggle = useCallback((id: string) => {
    const adding = !draftRef.current.has(id);
    setDraft((current) => {
      const next = new Set(current);
      if (adding) next.add(id); else next.delete(id);
      return next;
    });
    if (adding) {
      setEliteDraft((current) => startAtE0(current, [id]));
      setLevelDraft((current) => startAtLv1(current, [id]));
    }
  }, []);
  const setLevel = useCallback((id: string, level: number | undefined) => setLevelDraft((current) => {
    const next = new Map(current);
    if (level == null) next.delete(id); else next.set(id, level); // 빈칸 = 미지정(제한 없음)
    return next;
  }), []);
  const setElite = useCallback((id: string, elite: Elite) => setEliteDraft((current) => {
    const next = new Map(current);
    if (elite === 2) next.delete(id); else next.set(id, elite); // 2정 = 맵에 없음 (저장 규약)
    return next;
  }), []);
  const renderCard = (op: InfraOp) => {
    const options = eliteOptions(op);
    const elite = Math.min(eliteDraft.get(op.id) ?? 2, options.length ? options[options.length - 1] : 2) as Elite;
    return (
      <RosterCard key={op.id} op={op} owned={draft.has(op.id)} elite={elite} level={levelDraft.get(op.id)}
        onToggle={toggle} onElite={setElite} onLevel={setLevel} onShowOperator={onShowOperator} t={t} />
    );
  };
  // 성급 단위 일괄 조작 — 보유 체크/해제, 정예화 노정예/1정/2정
  // (정예화는 3성 이상에만 적용 — 2성 이하는 승급이 없어 보유/해제만)
  const bulkOwn = (test: (rarity: number) => boolean, own: boolean) => {
    const added: string[] = [];
    setDraft((current) => {
      const next = new Set(current);
      for (const op of allOps) {
        if (!test(op.rarity)) continue;
        if (own) { if (!next.has(op.id)) added.push(op.id); next.add(op.id); } else next.delete(op.id);
      }
      return next;
    });
    if (own) { // 일괄 체크도 노정예·Lv.1로 시작
      setEliteDraft((current) => startAtE0(current, added));
      setLevelDraft((current) => startAtLv1(current, added));
    }
  };
  const bulkElite = (test: (rarity: number) => boolean, elite: Elite) => setEliteDraft((current) => {
    const next = new Map(current);
    for (const op of allOps) {
      if (!test(op.rarity) || eliteOptions(op).length === 0) continue;
      if (elite === 2) next.delete(op.id); else next.set(op.id, elite);
    }
    return next;
  });
  // MAA(MaaAssistantArknights) 오퍼 박스 인식 결과 가져오기.
  // 지원 형식: ① Arknights_OperBox_Export.json — [{id, own, elite, ...}] 플랫 배열
  //           ② MAA 원본 operbox — {own_opers:[...], all_opers:[...]}
  // 파일이 언급한 오퍼만 갱신한다 (MAA가 모르는 최신 오퍼는 현재 체크 상태 유지).
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importMaa = (file: File) => {
    const reader = new FileReader();
    const fail = () => setImportMsg(t("MAA 파일을 인식하지 못했습니다 — 오퍼 박스 인식 결과 JSON(Arknights_OperBox_Export.json 등)인지 확인해 주세요."));
    reader.onload = () => {
      try {
        // MAA 내보내기 파일은 UTF-8 BOM이 붙어 있어 그대로 JSON.parse하면 실패한다
        const text = String(reader.result).replace(/^\uFEFF/, "");
        const parsed = JSON.parse(text);
        type MaaOper = { id?: string; own?: boolean; elite?: number; level?: number };
        const entries: MaaOper[] = Array.isArray(parsed)
          ? parsed
          : [...((parsed?.all_opers as MaaOper[]) ?? []), ...((parsed?.own_opers as MaaOper[]) ?? [])];
        const byId = new Map(allOps.map((op) => [op.id, op]));
        const nextDraft = new Set(draft);
        const nextElite = new Map(eliteDraft);
        const nextLevel = new Map(levelDraft);
        const seen = new Set<string>();
        let owned = 0, eliteSet = 0, unmatched = 0;
        for (const entry of entries) {
          if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) continue;
          seen.add(entry.id);
          const op = byId.get(entry.id);
          const isOwned = entry.own !== false; // own_opers 항목은 own 필드 없이도 보유로 취급
          if (!op) { if (isOwned) unmatched += 1; continue; }
          if (isOwned) { nextDraft.add(op.id); owned += 1; } else nextDraft.delete(op.id);
          const elite = (typeof entry.elite === "number" ? Math.max(0, Math.min(2, entry.elite)) : 2) as Elite;
          if (isOwned && elite < 2 && eliteOptions(op).length > 0) { nextElite.set(op.id, elite); eliteSet += 1; }
          else nextElite.delete(op.id);
          // MAA 오퍼 박스에도 레벨이 들어 있다 — 있으면 실제 값, 없으면 미지정(제한 없음)
          if (isOwned && typeof entry.level === "number" && entry.level >= 1) nextLevel.set(op.id, Math.min(MAX_OP_LEVEL, Math.round(entry.level)));
          else if (!isOwned) nextLevel.delete(op.id);
        }
        if (seen.size === 0) { fail(); return; }
        setDraft(nextDraft);
        setEliteDraft(nextElite);
        setLevelDraft(nextLevel);
        setImportMsg(t("MAA 보유 데이터를 반영했습니다 — 보유 {own}명 · 정예화 반영 {elite}건 · 미수록 오퍼 {skip}건. 확인 후 '적용 및 자동편성 실행'을 누르세요.", { own: owned, elite: eliteSet, skip: unmatched }));
      } catch { fail(); }
    };
    reader.readAsText(file);
  };
  // 게임 로그인(요스타 계정)으로 받아온 보유 목록 반영. MAA·스캔과 달리 **계정의 실제 전체
  // 목록**이라 보유 체크를 통째로 덮어쓴다 — 계정에 없는 오퍼는 미보유가 정답이다.
  // 사이트에 없는 오퍼(미실장 데이터를 끈 상태의 중섭 선행분 등)는 건너뛰고 건수만 알린다.
  const applyAccount = (roster: AccountRoster) => {
    const byId = new Map(allOps.map((op) => [op.id, op]));
    const nextDraft = new Set<string>();
    const nextElite = new Map<string, Elite>();
    const nextLevel = new Map<string, number>();
    let unmatched = 0;
    for (const char of roster.chars) {
      const op = byId.get(char.id);
      if (!op) { unmatched += 1; continue; }
      nextDraft.add(op.id);
      const elite = Math.max(0, Math.min(2, char.elite)) as Elite;
      if (elite < 2 && eliteOptions(op).length > 0) nextElite.set(op.id, elite);
      // 계정 연동은 진짜 레벨을 실어 온다 — 직접 입력의 Lv.1 기본값을 타지 않는다
      if (Number.isFinite(char.level) && char.level >= 1) nextLevel.set(op.id, Math.min(MAX_OP_LEVEL, Math.round(char.level)));
    }
    setDraft(nextDraft);
    setEliteDraft(nextElite);
    setLevelDraft(nextLevel);
    setMode("direct");
    setImportMsg(unmatched > 0
      ? t("{name} 박사의 계정에서 보유 {own}명을 가져왔습니다 (사이트 미수록 {skip}명 제외) — 확인 후 '적용 및 자동편성 실행'을 누르세요.", { name: roster.player.nickName, own: nextDraft.size, skip: unmatched })
      : t("{name} 박사의 계정에서 보유 {own}명을 가져왔습니다 — 확인 후 '적용 및 자동편성 실행'을 누르세요.", { name: roster.player.nickName, own: nextDraft.size }));
  };
  // 성급별 가능한 정예화 단계: 4성+ = 노정예/1정/2정, 3성 = 노정예/1정, 2성 이하 = 노정예뿐(선택지 없음)
  const BULK_GROUPS: { label: string; test: (rarity: number) => boolean; elites: Elite[] }[] = [
    { label: "6성", test: (rarity) => rarity === 6, elites: [0, 1, 2] },
    { label: "5성", test: (rarity) => rarity === 5, elites: [0, 1, 2] },
    { label: "4성", test: (rarity) => rarity === 4, elites: [0, 1, 2] },
    { label: "3성", test: (rarity) => rarity === 3, elites: [0, 1] },
    { label: "2성 이하", test: (rarity) => rarity <= 2, elites: [] },
  ];
  // 스캔·MAA 가져오기로 채운 보유·정예화는 '적용 및 자동편성 실행'을 눌러야 커밋된다 —
  // 배경 클릭·✕로 닫으면 통째로 사라져, 스캔했는데 정예화가 전부 만정예로 남고 육성 추천이
  // 0건이 되는 조용한 유실 경로였다 (2026-07-25). 변경분이 있으면 닫기 전에 확인한다.
  const dirtyDraft = draft.size !== ownedIds.size || [...draft].some((id) => !ownedIds.has(id))
    || eliteDraft.size !== eliteById.size || [...eliteDraft].some(([id, e]) => eliteById.get(id) !== e);
  const closeGuarded = async () => {
    if (dirtyDraft && !(await confirm({
      message: t("적용하지 않은 보유·정예화 변경이 있습니다. 그냥 닫으면 변경이 사라집니다."),
      confirmLabel: t("변경 버리고 닫기"),
    }))) return;
    onClose();
  };
  return (
    <ModalWindow label={t("보유 오퍼레이터 설정")} className="operator-modal room-modal" onClose={() => { void closeGuarded(); }} style={{ "--accent": "var(--lime)" } as React.CSSProperties}>
        {confirmDialog}
        <header className="room-modal-head">
          <span className="modal-kicker">ROSTER · {t("{n}/{m} 보유", { n: draft.size, m: allOps.length })}</span>
          {/* 제목 오른쪽에 입력 방식 — 직접 입력(카드 격자) / 가져오기(MAA·스크린샷·게임 로그인) */}
          <div className="roster-head-row">
            <h2>{t("보유 오퍼레이터 설정")}</h2>
            <div className="roster-mode" role="group" aria-label={t("보유 오퍼 입력 방식")}>
              <button type="button" className={mode === "direct" ? "selected" : ""} onClick={() => setMode("direct")}><span className="btn-icon" aria-hidden>▦</span>{t("직접 입력")}</button>
              <button type="button" className={mode === "import" ? "selected" : ""} onClick={() => setMode("import")}><span className="btn-icon" aria-hidden>⤒</span>{t("가져오기")}{isNewFeature("account") && <span className="new-badge">{t("새기능")}</span>}</button>
            </div>
          </div>
          {/* 가져오기 모드에는 도구 줄이 없다 — 세 경로 모두 결과를 직접 입력으로 되돌리므로
              검색·일괄·적용 버튼은 그쪽에서만 닿는다 (사용자 지적 2026-07-26) */}
          {mode === "direct" && (
          <div className="roster-tools">
            <input {...searchProps} placeholder={t("이름·소속 검색")} />
            <button type="button" onClick={() => setDraft(new Set(allOps.map((op) => op.id)))}><span className="btn-icon" aria-hidden>✓</span>{t("전체 선택")}</button>
            <button type="button" onClick={() => setDraft(new Set())}><span className="btn-icon" aria-hidden>✕</span>{t("전체 해제")}</button>
            <button type="button" className="apply" onClick={() => onApply(draft, eliteDraft, levelDraft)}><span className="btn-icon" aria-hidden>⟳</span>{t("적용 및 자동편성 실행")}</button>
          </div>
          )}
        </header>
        <div className="modal-scroll">
          {importMsg && <p className="dorm-note maa-import-msg">{importMsg}</p>}
          {mode === "import" ? (
            <RosterImportPanel
              t={t}
              onMaaFile={(file) => { importMaa(file); setMode("direct"); }}
              onScan={() => setShowScan(true)}
              onAccount={applyAccount}
              scanBadge={isNewFeature("scanner") ? <span className="new-badge">{t("새기능")}</span> : null}
            />
          ) : (
          <>
          <p className="dorm-note">{rich(t("3성 이상 오퍼는 카드 아래에서 **노정예/1정/2정**(3성은 1정까지)을 선택할 수 있고, 그 아래 **Lv.** 칸에 레벨을 적어 둘 수 있습니다 — 새로 체크하면 **노정예 Lv.1로 시작**하니 키운 만큼 올려 주세요. 레벨은 **노정예 Lv.30**부터 열리는 기지 스킬 판정에 쓰입니다(1정 이상은 영향 없음). 얼굴을 클릭하면 상세 정보가 열립니다."))}</p>
          {allOps.some((op) => op.unreleased) && (
            <p className="dorm-note">{rich(t("**미실장** 배지가 붙은 오퍼는 미출시(중국 서버 선행) 오퍼입니다 — 미래시 데이터 포함이 켜져 있을 때만 표시되며, 스킬 텍스트는 비공식 AI 번역입니다."))}</p>
          )}
          <div className="roster-bulk">
            {BULK_GROUPS.map(({ label, test, elites }) => (
              <span key={label} className="bulk-group">
                <b>{t(label)}</b>
                <button type="button" onClick={() => bulkOwn(test, true)}>{t("전체 보유")}</button>
                <button type="button" onClick={() => bulkOwn(test, false)}>{t("전체 해제")}</button>
                {elites.map((option) => (
                  <button key={option} type="button" onClick={() => bulkElite(test, option)}>{t("일괄 {label}", { label: t(ELITE_LABEL[option]) })}</button>
                ))}
              </span>
            ))}
          </div>
          <div className="roster-sortbar">
            <label className="sort-wrap">
              <span>{t("정렬")}</span>
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
                {ROSTER_SORT_KEYS.map((key) => <option key={key} value={key}>{t(key)}</option>)}
              </select>
              <button type="button" className="sort-direction" onClick={() => setSortAsc((current) => !current)} aria-label={sortAsc ? t("내림차순으로 변경") : t("오름차순으로 변경")}>{sortAsc ? "↑" : "↓"}</button>
            </label>
            <span className="count"><b>{visible.length}</b> OPERATORS</span>
          </div>
          {futureOps.length > 0 && (
            <>
              <h4 className="roster-section-head">{t("미실장 (중국 서버 선행)")} <em>{futureOps.length}</em></h4>
              <div className="roster-grid">{futureOps.map(renderCard)}</div>
              <h4 className="roster-section-head">{t("정식 출시")} <em>{releasedOps.length}</em></h4>
            </>
          )}
          <div className="roster-grid">{releasedOps.map(renderCard)}</div>
          </>
          )}
        </div>
      {/* 스크린샷 스캐너 — 모달 내부에서 열고, 인식 결과를 draft/eliteDraft에 병합(MAA 가져오기와 동일
          흐름: 검토 후 '적용 및 자동편성 실행'). 오퍼 스캐너 v6, 픽스처 178셀 100% (verify-scan.ts). */}
      {showScan && (
        <div className="modal-backdrop scanner-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowScan(false); }}>
          <Suspense fallback={<div className="scanner-loading">{t("스캐너 불러오는 중…")}</div>}>
            <ScannerModal
              t={t}
              onClose={() => setShowScan(false)}
              onApply={(dets) => {
                setDraft((prev) => {
                  const n = new Set(prev);
                  for (const d of dets) if (opById.has(d.id)) n.add(d.id);
                  return n;
                });
                setEliteDraft((prev) => {
                  const n = new Map(prev);
                  for (const d of dets) { if (d.elite === 2) n.delete(d.id); else n.set(d.id, d.elite); }
                  return n;
                });
                setShowScan(false);
                setMode("direct"); // 인식 결과를 카드 격자에서 바로 검토하게 한다
                setImportMsg(t("스캔 결과 {n}명을 반영했습니다 — 확인 후 '적용 및 자동편성 실행'을 누르세요.", { n: String(dets.length) }));
              }}
            />
          </Suspense>
        </div>
      )}
    </ModalWindow>
  );
}

// ── 교대 탭의 짧은 링크가 여는 상세 모달 (사용자 요청 2026-07-28) ────────────────
// 왼쪽 칸에 줄글을 깔면 그리드 첫 행(제어센터·응접실) 높이가 밀린다 — 화면엔 한 줄짜리
// 링크만 두고 설명은 전부 여기로 내린다.
export type ShiftNoteKind = "drain" | "policy";

// "왜 표시된 시간이 그대로 안 가는가" — 사용자가 짚은 제어센터 연쇄가 핵심이다.
// 수치는 INFRA-RULES §1 컨디션 모델 v18(실측 9건 재현) 기준.
const DRAIN_NOTE_ITEMS = [
  "표시된 시간은 **전원이 풀 컨디션 24로 근무를 시작한다**고 본 계산값입니다. 실제 오퍼는 저마다 남은 컨디션이 다르므로, 이미 지친 인원이 섞여 있으면 그만큼 교대가 앞당겨집니다.",
  "특히 **제어센터가 먼저 지치면 기지 전체가 함께 빨라집니다**. 제어센터에 앉은 인원은 다른 모든 작업 시설의 시간당 컨디션 소모를 1명당 0.05씩 깎아 주는데, 제어센터 크루가 먼저 소진돼 자리가 비면 그 감면이 사라져 제조소·무역소·발전소가 일제히 더 빨리 닳습니다. 표시된 시간은 감면이 계속 걸려 있다고 보고 계산한 값입니다.",
  "같은 방 동료 시너지(동료 1명당 -0.05)와 회복 오라(총웨·위셔델·무에나)도 표시값에 반영돼 있지만, 이 역시 **그 배치가 그대로 유지될 때**의 값입니다. 오퍼를 빼거나 옮기면 남은 인원의 소모가 즉시 올라갑니다.",
  "그래서 이 숫자는 상한이 아니라 기준점으로 보세요. 병목(가장 빨리 닳는 방)보다 늦게 교대하면 안 되고, 보통은 컨디션 12(지침 신호)쯤에서 A조 전체를 한 번에 B조로 바꿉니다.",
];

// tldr = 제목 오른쪽 한 줄 요약 — "그래서 뭘 하면 되는지"만 (사용자 요청 2026-07-28)
const SHIFT_NOTE_SPEC: Record<ShiftNoteKind, { kicker: string; title: string; tldr?: string; items: string[] }> = {
  drain: { kicker: "SHIFT CLOCK", title: "지속 시간이 달라지는 이유", items: DRAIN_NOTE_ITEMS },
  // 교대 정책은 도움말의 같은 섹션을 그대로 쓴다 — 이미 검증·번역된 본문이라 어긋날 일이 없다
  policy: {
    kicker: "SHIFT POLICY", title: "교대 정책",
    tldr: "A조로 계속 돌리다 컨디션이 바닥나면 B조로 통째 교대, 회복되면 다시 A조로",
    items: [],
  },
};

function ShiftNoteModal({ kind, onClose }: { kind: ShiftNoteKind; onClose: () => void }) {
  const { t } = useI18n();
  const spec = SHIFT_NOTE_SPEC[kind];
  const items = kind === "policy"
    ? (HELP_SECTIONS.find((section) => section.title === "교대 정책")?.items ?? [])
    : spec.items;
  return (
    <ModalWindow label={t(spec.title)} className="operator-modal room-modal" onClose={onClose} style={{ "--accent": "var(--lime)" } as React.CSSProperties}>
        <header className="room-modal-head">
          <span className="modal-kicker">{spec.kicker}</span>
          <h2>{t(spec.title)}{spec.tldr && <em className="modal-head-tldr">{t(spec.tldr)}</em>}</h2>
        </header>
        <div className="modal-scroll">
          {/* 번호를 매겨 항목을 구분하기 쉽게 (사용자 요청 2026-07-28) */}
          <ol className="help-list help-list-numbered">
            {items.map((item, index) => <li key={index}>{emphasize(t(item))}</li>)}
          </ol>
        </div>
    </ModalWindow>
  );
}

// **강조** 마크업만 해석 — 모달 본문에서 핵심 절을 굵게 (번역문도 같은 표기를 쓴다)
function emphasize(text: string): React.ReactNode {
  const parts = text.split("**");
  return parts.map((part, index) => (index % 2 ? <b key={index}>{part}</b> : part));
}

const HELP_SECTIONS: { title: string; items: string[] }[] = [
  { title: "교대 정책", items: [
    "A조가 풀파워 주력이고 토큰 패키지·시너지 세트는 기본적으로 A조에 모입니다. B조는 A조 컨디션이 소진됐을 때 투입되는 회복 교대입니다 (12시간 2조). 예외로 피누스 실베스트리스 세트는 B조에 결집합니다 — A조 제조소·제어센터는 화식 세트와 상위 생산 오퍼 몫이기 때문입니다.",
    "A조를 먼저 반복 전수검사로 풀파워로 완성한 뒤(안정될 때까지), 남은 오퍼레이터만으로 B조를 같은 방식으로 검수해 편성합니다. 시너지 세트 후보안도 가능한 조합을 전부 만들어 총점으로 비교하므로 계산에 몇 초가 걸릴 수 있습니다.",
    "같은 오퍼를 A조·B조에 동시 배치하지 않는 것이 기본 원칙입니다 — 근무를 이중으로 서면 못 쉬고 24시간 돌아야 하기 때문입니다. 사기를 소모하지 않는 숙소(휴식)·가공소(상시 슬롯)만 예외로 조 전환과 무관하게 고정됩니다.",
    "숙소·시너지 고정 요원(숙소 생성원, 니엔 등)은 A/B 전환과 무관하게 고정됩니다. 응접실도 A/B 교대로 운영합니다 — 같은 인원을 24시간 돌리지 않습니다.",
    "가공소는 상시 슬롯이라 A조 한 팀(니엔 고정)만 편성하고 B조 칸은 비워 둡니다 — 회복 교대에 가공 요원을 따로 두지 않습니다.",
    "훈련실 정원 2는 트레이너석 1 + 훈련대상석 1이라, 플래너가 쓰는 근무석은 1석입니다. 그 1석도 실제 스킬 특화 훈련에 쓰도록 비워 둡니다 — 훈련 속도는 자원 생산과 단위가 달라 총점에 넣지 않으니 남는 인원으로 채우면 공짜처럼 보이지만, 훈련실도 시설로 세는 방이라 잉여 오퍼를 앉히면 총웨의 '쉐이 1명당 화식 +5(최대 5명)' 같은 카운터가 엉뚱하게 차 버립니다. 비움이 절대 규칙은 아닙니다 — 다른 오퍼의 조건이 훈련실 배치로만 충족될 때(외드레르의 W가 앉을 작업 시설이 훈련실밖에 안 남은 경우)는 그쪽 이득이 실제로 더 클 때만 배치합니다.",
    "숙소도 방을 눌러 직접 편성할 수 있습니다 — 직접 넣은 오퍼는 📌로 고정되어 전체 자동편성이 그대로 둡니다(카드의 📌로 잠그거나 풀고, ✕로 빼면 고정도 풀립니다). 울피아누스를 숙소에 고정해 두면 다음 자동편성이 언더플로우(+10%)를 자연히 뽑아 갑니다. 고정 인원은 근무 방 후보에서 빠지므로 이중 배치되지 않습니다.",
    "'짝이 기반시설(숙소 포함) 어디에든 있으면 +N%'인 조건(언더플로우←울피아누스, Bellone←비질, 산크타 믹사파라토←피아메타)은 짝이 일하지 않아도 성립합니다. 그래서 자동편성은 노는 짝을 빈 숙소에 '주차'해 조건을 켜는 안을 따로 만들어 보고, 기지 총점이 실제로 오를 때만 채택합니다 — 보유 오퍼가 두터워 대체 후보가 많으면 주차가 부른 재편성이 오히려 손해라 채택하지 않습니다.",
    "자동편성은 제조소·무역소·응접실·사무실을 반드시 정원까지 채웁니다 — 인프라 스킬이 없는 오퍼라도 배치 인원 자체가 기본 생산분을 내므로, 슬롯을 비우는 것이 항상 손해이기 때문입니다. 보유 오퍼 총원이 모자랄 때만 빈 자리가 남습니다. 제어센터·발전소는 스킬 없는 배치가 사기만 소모해 예외입니다.",
    "'전체 자동편성'은 처음부터 다시 계산하고, '빈 자리만 자동편성'은 현재 편성(수동 수정 포함)을 유지한 채 남은 빈 자리만 한계 기여 순으로 채웁니다.",
    "조 탭의 'A조 ~N시간'과 방 카드의 시간 배지는 전원이 풀 컨디션(24)에서 근무를 시작한다고 본 추정치입니다 — 실제 교대 시점은 오퍼별 현재 피로도에 따라 달라집니다. 이미 지친 오퍼가 섞여 있으면 표시보다 빨리 교대해야 하고, 보통은 컨디션 12(지침 신호)쯤에서 이르게 바꿉니다.",
    "케이퍼·인포서는 자동편성에서 제외됩니다 — 케이퍼는 단서 공유가 끊기면 효율이 10%로 떨어져 넣었다 뺐다 해야 하고, 인포서는 단서 속도 +35%의 대가로 시간당 컨디션 -2를 태워 응접실 하나 때문에 기지 전체 교대 주기가 짧아집니다. 완전히 사라지는 건 아니고 방 상세의 후보 목록에 '수동 전용'으로 남으므로, 필요하면 직접 넣을 수 있습니다.",
  ]},
  { title: "방 우선순위", items: [
    "기지 배치 설정: 243(무역 2·제조 4 — 순금 2+작전기록 2, 기본) · 153(무역 1·제조 5 — 순금 1+작전기록 4) · 252(무역 2·제조 5 — 순금 2+작전기록 3, 발전 2). 153은 무역소가 하나라 제조소 대부분을 작전기록에 쓰되, 유일한 순금방이 병목이므로 그 방을 맨 먼저(최정예로) 채웁니다. 각 배치의 편성·시설 레벨은 따로 저장됩니다 — 배치마다 한 번씩 자동편성해 두면 전환할 때 그대로 복원됩니다.",
    "전력·시설 레벨: 발전소가 전력을 공급하고(레벨 3 기준 1기 270, 3기 810) 나머지 시설이 소비합니다. 방을 눌러 시설 레벨을 바꾸면 전력 소비·근무 슬롯(제조소·무역소 Lv1/2/3 = 1/2/3인)·레벨 연동 스킬(숙소 레벨 합·응접실·훈련실 레벨 등)이 함께 재계산됩니다. 243·153은 전부 만렙일 때 소비가 정확히 810이라 여유가 0이고, 252는 발전소가 2기(540)뿐이라 시설 레벨을 낮춰야 성립합니다 — 기본값은 순금 제조소·응접실·훈련실 만렙 유지, 작전기록 제조소 Lv2, 사무실 Lv2, 숙소 Lv1(첫 숙소만 Lv2)로 소비가 정확히 540입니다. 상단 ⚡ 전력이 음수면 게임에서 지을 수 없는 구성입니다.",
    "사용자 지정 배치: 제조소·무역소·발전소 9칸을 자유롭게 구성합니다. 방 카드의 제조소/무역소/발전소 버튼으로 각 칸의 종류를 바꾸면 순금 제조소 수는 무역소 수에 맞춰 자동 배정되고(프리셋과 동일 규칙), 전력·자동화 스케일도 발전소 수를 따라갑니다. 칸을 바꾼 뒤엔 전체 자동편성으로 재편성하세요 — 그외 배치의 편성·레벨도 별도 버킷으로 저장됩니다.",
    "편성 설정은 두 축입니다 — 무엇을 많이 뽑을지(우선 생산: 순금 우선 · 작전기록 우선 · 밸런스) × 컨디션을 어떻게 다룰지(운용 방식: 효율 우선 · 장기 지속). 기본은 순금 우선 + 효율 우선이고, 순금 우선 + 장기 지속처럼 자유롭게 조합됩니다. 먼저 채우는 방이 최고 요원을 가져가고, 순금(또는 작전기록) 우선이면 어느 제조소에서나 생산력이 같은 요원을 그 제조소로 몰아줍니다 — 총 생산력이 같을 때만.",
    "운용 방식 — 효율 우선은 컨디션을 따지지 않고 생산 효율만 봅니다(자주 들여다보며 교대해 주는 운용). 장기 지속은 주력인 A조를 컨디션 소모·근무 중 회복까지 계산해 오래가게 짜되 소모를 1순위로 두지는 않습니다 — 소모가 조금 늘어도 크게 이득인 고효율 조합(샤마르 조합 등)은 A조에 올립니다. 제어센터에 무한동력(순소모 0) 조합을 세울 수 있는 로스터라면(레인보우 팀·3성 이격 등) 그 조합을 무조건 우선합니다. B조는 A조가 쉬는 동안을 메우는 생산 편성이고, 순소모 0이 된 방의 크루는 컨디션이 닳지 않아 A·B 양조에 고정됩니다. 설정만 바꾸고, 실제 편성은 전체 자동편성 버튼을 눌러 적용합니다.",
    "채우는 순서: 제조소-순금 > 제조소-작전기록 > 무역소 > 발전소 > 사무실 > 응접실 — 먼저 채우는 방이 좋은 요원을 가져갑니다. 응접실은 최하위라, 응접실 스킬이 있는 오퍼(쉐라 등)도 상위 방 세트가 우선입니다.",
    "응접실 단서 수집 속도는 RIIC 스킬과 별개로 레어도·정예화 기본치가 더해집니다: 6성 +10 / 5성 +9 / 4성 +7 / 3성↓ +5, 정예화 1정 +8 · 2정 +16 (미지정은 그 레어도 최대 승급 가정). 그래서 스킬 없는 2정 6성도 +26%. 카드에 '레어도 기본'으로 따로 표기됩니다.",
    "순금 2 + 작전기록 2 분할. 무역소 효율이 오르면 순금이 병목이 되므로 가장 강한 생산 팀을 순금 2방에 먼저 배치하고, 남는 효율을 작전기록으로 돌립니다.",
    "품목 전용 스킬(금속공예류 = 순금)은 해당 품목 방에서만 계산됩니다.",
  ]},
  { title: "포인트 시너지 (시설 간)", items: [
    "속세의 화식: 제어센터 시·링·총웨(쉐이 1명당 +5, 최대 5명 — 실제 배치 수로 계산) + 우요우가 생성, 슈(제조)·우요우(무역)·지에윈(화식→주술 결정 전환)이 소비합니다.",
    "무성의 공명·감지 정보: 숙소에 고정된 아이리스(꿈나라)·체르니(소절)·비르투오사가 생성, 에벤홀츠가 감지 정보를 공명으로 전환해 무역소 효율로 소비합니다.",
    "마물 요리: 센시를 숙소에 고정하면 레벨당 1개(총 5개)가 생겨 마르실(제조)·라이오스(응접실)가 소비합니다.",
    "정보 저장은 레인보우 팀 전용 폐쇄 시스템이라 기지 편성에 넣지 않습니다.",
  ]},
  { title: "무역소 조합", items: [
    "샤마르(속삭임)는 다른 인원의 효율을 0으로 만들고 인당 +45%를 주므로, 효율이 없어도 되는 품질 요원과 묶습니다: 샤마르 + 테킬라(투자β: 고품질 순금 오더 수익) + 확률 요원(카프카·디아만테·바이비크 — 전부 동급).",
    "프로바이조는 반대로 저품질 오더를 위약 처리해 수익을 내므로 고품질 확률과는 반시너지입니다. 처리량이 높은 우요우+에벤홀츠 방에 넣습니다.",
    "레벨 성장형은 만렙 기지 기준 상한으로 계산합니다: 비질 +40%(응접실 Lv3), 아르케토 +40%(숙소 20레벨), 미틈 +30%.",
    "언더플로우(+30%)는 울피아누스가 기지 어디든(숙소 포함) 있으면 +40%가 됩니다 — 울피아누스를 숙소에 고정해 두세요. B조 무역소 정배: 비질+아르케토+언더플로우.",
    "외드레르(+30%)는 이네스·W가 '작업 시설'(발전소·제조소·무역소·사무실·응접실·제어 센터·훈련실 — 숙소·가공소 제외)에 배치되면 각각 +5%가 붙어 최대 +40%입니다. 같은 무역소에 앉힐 필요는 없습니다 — 이네스는 사무실이 제자리입니다.",
  ]},
  { title: "자동화 제조소", items: [
    "위디·유넥티스·윈드플릿·패신저는 방 내 다른 오퍼의 생산력을 0으로 만들고 발전소 1기당 +15%/+10%/+5%/+5%를 받습니다 — 이들과 같은 방에 넣은 일반 +30%/+35%류 생산력 스킬은 전부 0%가 되므로, 직접 수치가 아니라 이런 제로아웃 오퍼와 궁합이 맞는지 먼저 확인해야 합니다.",
    "스네구로치카는 같은 방식으로 제로아웃하되 발전소가 아니라 그 제조소에 실제 배치된 인원수당 +10%로 스케일됩니다.",
    "단 시설 수량 기반 생산력(퓨어스트림·쏜즈의 '각각의 무역소가…')은 살아남아 함께 쓸 수 있습니다. 원문의 예외가 '시설 수량'뿐이라, 창고 용량을 생산력으로 되돌리는 변환(버메일 재활용·버블 큰 게 좋아)은 함께 0이 됩니다 — 버메일+스네구로치카는 +46%가 아니라 자동화 +20%뿐입니다.",
    "그레이 더 라이트닝베어러를 발전소에 두면(다른 발전소에 1성 로봇이 없는 한) 발전소 4기로 간주되어 자동화 방이 최대 140%까지 오릅니다.",
    "제로아웃 오퍼를 쓰는 편성 자체가 예외적인 케이스입니다 — 자동편성은 실제 방 점수(제로아웃 반영)로 비교해 더 나을 때만 추천합니다.",
    "와이후(협동의식)·스노우상트(근면성실)는 증폭형입니다 — 같은 방 다른 오퍼가 제공한 효율(시설 기반 제외)의 5%당 5%를 최대 +40%(스노우상트 +35%)까지 되돌립니다. 생산력 높은 오퍼와 묶어야 값이 나오므로, 아로마(귀금속 25+청소 20)+30%급 오퍼 같은 강한 생산팀에 얹으면 순금방이 ~115%가 됩니다. 시간당 성장형(아로마·크루스·씬·팽·케오베)과 Вий(훈련실 레벨 성장)는 만렙 기지 상한값으로 계산합니다.",
  ]},
  { title: "제어 센터", items: [
    "오라 우선순위: 제조소 생산력 > 무역소 오더 효율 > 인맥 레퍼런스 > 단서 수집. '동종 효과 중 최고만 적용' 규칙을 따릅니다.",
    "제어센터 오라는 대상 방 점수에 실제로 합산됩니다 — 무역소 오더 효율 +10% 오라면 무역소 점수와 상단 서머리에 더해집니다 (방 상세의 '제어센터 오라 수신'). 단 이격 실버애쉬처럼 조건이 붙은 오라는 조건을 채운 그 방 하나에만 적용됩니다.",
    "'용문근위국 오퍼와 함께'류 동반 조건, '미노스 1명당'류 카운트 조건은 실제 배치를 기준으로만 인정합니다.",
    "이격 실버애쉬 보유 시 쉐라그 3명(무역 스킬 강한 순)을 무역소 한 곳에 모으는 세트안을 만들되, 세트 없는 편성과 기지 총점을 비교해 이득일 때만 채택합니다. 진영 판정은 다중 소속 기준(카란 무역회사 오퍼도 쉐라그로 인정).",
    "플레임테일(피누스 실베스트리스 기사)은 제조소에 배치된 기사단원 1명당, 그 기사단원이 일하는 제조소에 작전기록 +10%·귀금속 -10%를 주는 오라입니다 — 기지 전체 일률이 아니라 방 단위라, 기사단을 작전기록방에 모으면 감산은 발생하지 않습니다. 보유 시 애쉬락·와일드메인·파투스(각 +25%)를 B조 작전기록방에 결집하고 플레임테일을 B조 제어센터에 앉히는 세트안을 만들어, 세트 없는 편성과 기지 총점을 비교해 이득일 때만 채택합니다.",
    "제어센터 카드의 '+N 오라 가중 점수'는 %가 아니라 오라를 우선순위 가중치(제조소 ×10 > 무역소 ×2 > 인맥 ×0.6 > 단서 ×0.2)로 환산한 비교용 점수입니다. 일반 방 카드에 '(오라 ±N)'이 붙어 있으면 제어센터 오라 수신분이 포함된 것으로, 방 점수가 오퍼 스킬 합과 달라 보이는 이유입니다 — 방 상세의 '제어센터 오라 수신' 항목에서 내역을 확인할 수 있습니다.",
    "시설 카운트 스킬(타락사쿰 '쉐이'·만트라 '정예 오퍼레이터')은 그 그룹원이 실제로 앉은 시설 수만큼만 붙습니다 — 한 방에 둘이 앉아도 1개로 세고, 숙소·가공소도 시설로 셉니다. 상한은 게임 상한과 실존 오퍼 수 중 작은 쪽입니다 (만트라는 정예 6명이라 최대 6개 = +12%).",
  ]},
  { title: "정예화 단계 (1정/2정)", items: [
    "보유 오퍼 설정에서 오퍼별로 기본값(2정 · 정예화 2)을 노정예/1정으로 낮출 수 있습니다 (3성 이상 전원 — 스킬이 노정예부터 있는 오퍼도 선택 가능).",
    "1정으로 지정하면 해당 오퍼는 정예화 2 전용 스킬 없이 계산·자동편성됩니다 — 아직 승급 못 한 오퍼를 과대평가하지 않도록 맞춰 두세요.",
  ]},
  { title: "대체 추천", items: [
    "각 자리의 대체 후보는 실제로 교체해 본 방 점수로 순위를 매기고, 동점이면 낮은 성급(육성 저렴)을 우선합니다.",
    "토큰 생성·소비자, 오버라이드·수익 역할, 쉐이 카운트 인원 같은 시너지 코어는 '대체 불가'로 표시됩니다.",
    "방 상세의 스킬 설명에서 점선 밑줄 용어(외세·실리·시라쿠사 등)를 클릭하면 게임 용어 사전의 정의가 뜹니다 — 오퍼 명단이 있는 용어(진영·그룹)는 연결된 오퍼 전원이 아바타로 표시됩니다 (배치 중 = 컬러, 미배치 = 흑백).",
  ]},
  { title: "미래시(미실장) 오퍼", items: [
    "헤더의 '미래시 데이터 포함'을 켜면 미출시(중국 서버 선행) 오퍼도 보유 오퍼 설정과 자동편성 계산에 포함됩니다. 스킬 텍스트는 비공식 AI 번역이며, 정식 출시 시 공식 데이터로 대체됩니다.",
    "토글을 바꿔도 현재 편성은 유지됩니다 — 자동편성을 다시 실행해야 반영됩니다.",
  ]},
  { title: "수치는 근사치", items: [
    "숙소는 풀 인원(20명), 모집 4칸, 발전소 3(그레이 알터 시 4) 기준의 추정 상한으로 계산합니다. 실제 게임 수치와 약간 다를 수 있습니다.",
    "자세한 규칙 전문은 저장소의 docs/INFRA-RULES.md를 참고하세요.",
  ]},
];

function HelpModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <ModalWindow label={t("최적화 규칙 도움말")} className="operator-modal room-modal" onClose={onClose} style={{ "--accent": "var(--lime)" } as React.CSSProperties}>
        <header className="room-modal-head">
          <span className="modal-kicker">HOW IT WORKS</span>
          <h2>{t("최적화 규칙 도움말")}</h2>
        </header>
        <div className="modal-scroll">
          {HELP_SECTIONS.map((section) => (
            <section key={section.title} className="detail-section">
              <h3>{t(section.title)}</h3>
              <ul className="help-list">
                {section.items.map((item, index) => <li key={index}>{t(item)}</li>)}
              </ul>
            </section>
          ))}
        </div>
    </ModalWindow>
  );
}

// MAA 커스텀 기반시설 내보내기 (베타) — 현재 편성(A/B 2교대)을 MAA JSON으로 저장 (2026-08-02).
// 시각 입력만 받는 이유: MAA는 벽시계(period) 기준으로 plan을 전환하지, 사이트의
// '지치면 교대' 모델을 모른다 — 그 차이는 모달 안내문으로 명시한다.
function MaaExportModal({ plan, nameOf, toast, onClose }: { plan: Plan | null; nameOf: (id: string) => string | undefined; toast: (message: string) => void; onClose: () => void }) {
  const { locale, t } = useI18n();
  const [startA, setStartA] = useState("08:00");
  const [startB, setStartB] = useState("20:00");
  const langLabel = locale === "ja" ? "日本語" : locale === "en" ? "English" : "한국어";
  const sameTime = startA === startB;
  const download = () => {
    if (!plan) return;
    const payload = buildMaaInfrast({
      assignments: plan.assignments,
      cells: LAYOUT,
      nameOf,
      shiftStarts: [startA, startB],
      title: t("테라 아카이브 인프라 자동편성"),
      description: t("A = 풀파워 주간조 · B = 회복 교대조 · terra-archive infra planner"),
      planNames: [t("A조"), t("B조")],
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "terra-archive-maa-infrast.json";
    anchor.click();
    URL.revokeObjectURL(url);
    toast(t("MAA 기반시설 JSON을 저장했습니다"));
    onClose();
  };
  return (
    <ModalWindow label={t("MAA 기반시설 내보내기")} className="operator-modal room-modal" onClose={onClose} style={{ "--accent": "var(--lime)" } as React.CSSProperties}>
        <header className="room-modal-head">
          <span className="modal-kicker">MAA CUSTOM INFRAST</span>
          <h2>{t("MAA 기반시설 내보내기")} <span className="new-badge">{t("베타")}</span></h2>
        </header>
        <div className="modal-scroll">
          <section className="detail-section">
            <p>{t("현재 편성(A/B 2교대)을 MAA의 커스텀 기반시설 계획 JSON으로 저장합니다. MAA 설정 → 기반시설 → 커스텀 기반시설에서 이 파일을 선택하면 A/B조가 시각에 맞춰 자동 교대됩니다.")}</p>
          </section>
          <section className="detail-section">
            <h3>{t("교대 시각")}</h3>
            <p className="maa-times">
              <label>{t("A조 시작")} <input type="time" value={startA} onChange={(event) => setStartA(event.target.value)} /></label>
              {" "}
              <label>{t("B조 시작")} <input type="time" value={startB} onChange={(event) => setStartB(event.target.value)} /></label>
            </p>
            <p className="maa-note">{t("사이트의 교대는 '지치면 교대'지만 MAA는 시각으로만 전환합니다 — 두 조의 근무 시간대를 정해 주세요.")}</p>
          </section>
          <section className="detail-section">
            <h3>{t("내보내기 전 확인")}</h3>
            <ul className="help-list">
              <li>{t("오퍼 이름은 지금 보는 언어({lang}) 그대로 담깁니다 — MAA가 화면 글자를 읽어 대조하므로 게임 클라이언트 언어와 같아야 합니다.", { lang: langLabel })}</li>
              <li>{t("게임 기지의 제조소·무역소 순서(품목 포함)가 이 편성표의 방 순서와 같아야 합니다. 품목을 함께 기록하므로 어긋나면 MAA가 감지합니다.")}</li>
              <li>{t("숙소는 고정 배치 인원만 기록하고 빈 칸은 MAA가 지친 오퍼로 채웁니다. 훈련실은 MAA 스키마에 없어 제외되고, 빈 방은 '건드리지 않음'으로 저장됩니다.")}</li>
              <li>{t("피아메타·드론 사용은 담지 않습니다 — 필요하면 MAA에서 직접 설정하세요.")}</li>
            </ul>
          </section>
          {!plan && <p className="maa-note">{t("내보낼 편성이 없습니다 — 먼저 전체 자동편성을 실행하세요.")}</p>}
          {sameTime && plan && <p className="maa-note">{t("A조와 B조 시작 시각이 같습니다 — 시간대(period) 없이 저장됩니다.")}</p>}
          <p className="maa-download"><button className="primary" onClick={download} disabled={!plan}><span className="btn-icon" aria-hidden>⇥</span>{t("JSON 파일로 내려받기")}</button></p>
        </div>
    </ModalWindow>
  );
}
