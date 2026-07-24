"use client";

import { lazy, startTransition, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useI18n, tokenName, rich, type ExtraI18n, type Locale, type T } from "./i18n";
import { RULES } from "./rules";
import { useConfirm } from "./confirm";
import { normSearch } from "./search";
import { isNewFeature } from "./whats-new";

import {
  infra, ops, opById, factionsOf, withElite, clueBase, maxElite, eliteOptions,
  ELITE_LABEL, LAYOUT, cellByKey, ROOM_ACCENT, UNIT, PARK_KEYS, SHIFT_COUNT,
  JOB_ORDER, ROSTER_SORT_KEYS, PRODUCTION_KEYS, SUPPORT_KEYS,
  AURA_WEIGHT, AURA_LABEL, skillApplies, breakdown, teamScore, aurasOf, ambientFor, capConvFor,
  ctxFor, sanitizePlan, presentIdsFor, slotSubstitutes, setLayoutPreset, memberOf,
  setLevels as setEngineLevels, slotsFor, maxLevelOf, levelOf, powerBudget, suggestedLevels,
  type InfraOp, type InfraSkill, type Elite, type Plan, type ProdPriority, type TokenFlow, type OptimizeStep, type LayoutPreset, type Levels,
} from "./planner-engine";
import type { RaiseRec, InvestProgress } from "./planner-invest";
// 자동편성·육성 추천의 실제 계산은 Web Worker에서 (INP — 메인 스레드는 진행 표시만, 2026-07-22)
import { optimizeOff, investOff } from "./planner-offload";

// 보유 오퍼 화면 스캔(에뮬레이터 화면 공유 → 자동 인식, 2026-07-23) — 초상 템플릿 2.4MB 무거워 lazy 스플릿
const ScannerModal = lazy(() => import("./scan/scanner").then((m) => ({ default: m.ScannerModal })));
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
  // 프리셋별 저장 버킷 — 243/153/252 각각의 편성·레벨·육성추천을 따로 보관해 전환 시
  // 재편성 없이 그대로 복원한다 (사용자 확정 2026-07-24: "각각 따로 한번 자동편성하면 유지")
  type LayoutBucket = { plan: Plan | null; levels: Levels; invest: RaiseRec[] | null; investHidden: string[] };
  const bucketsRef = useRef<Partial<Record<LayoutPreset, LayoutBucket>>>({});
  const syncBucket = (lay: LayoutPreset, patch: Partial<LayoutBucket>) => {
    bucketsRef.current[lay] = {
      plan: null, levels: suggestedLevels(lay), invest: null, investHidden: [],
      ...(bucketsRef.current[lay] ?? {}), ...patch,
    };
  };
  const [activeShift, setActiveShift] = useState(0);
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const [showFlows, setShowFlows] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
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
  // 1~5성은 기본 보유, 6성은 미보유로 시작 — 가진 6성만 직접 체크한다
  const [ownedIds, setOwnedIds] = useState<Set<string>>(() => new Set(ops.filter((op) => op.rarity <= 5).map((op) => op.id)));
  // 미지정 = 2정(정예화 2, 최대) 가정 — 정예화 2 스킬이 있는 오퍼만 1정으로 낮출 수 있다
  const [eliteById, setEliteById] = useState<Map<string, Elite>>(new Map());
  // 보유 오퍼·정예화 구성이나 방별 수동 편성을 바꾼 뒤 파일로 저장하지 않았으면 true
  const [dirty, setDirty] = useState(false);
  // 육성(정예화 완성) 추천 — 반사실 재최적화 결과(null=미실행)와 진행률, 모달 표시 여부.
  // 결과는 한 번 분석하면 새 자동편성 전까지 유지된다 (persist·export 포함, 사용자 확정 2026-07-21)
  const [investRecs, setInvestRecs] = useState<RaiseRec[] | null>(null);
  const [investing, setInvesting] = useState<InvestProgress | null>(null);
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
  // 표시용 추천 = 숨김 제외 후 상위 20 — 숨기면 다음 순위가 자동으로 올라온다
  const visibleRecs = useMemo(() => (investRecs ? investRecs.filter((r) => !investHidden.has(r.opId)).slice(0, INVEST_SHOW) : null), [investRecs, investHidden]);

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
  const effectiveOps = useMemo(() => visibleOps.map((op) => withElite(op, viewElite.get(op.id))), [visibleOps, viewElite]);
  const effectiveOpById = useMemo(() => new Map(effectiveOps.map((op) => [op.id, op])), [effectiveOps]);
  const roster = useMemo(() => effectiveOps.filter((op) => ownedIds.has(op.id)), [effectiveOps, ownedIds]);

  const persist = (ids: Set<string>, nextPlan: Plan | null, elite: Map<string, Elite> = eliteById, prio: ProdPriority = priority, invest: RaiseRec[] | null = investRecs, hidden: Set<string> = investHidden, lay: LayoutPreset = layout, lvls: Levels = levels) => {
    // 현재 프리셋 버킷을 최신 상태로 갱신한 뒤 전체 버킷을 저장 — 다른 프리셋의 편성은 보존된다
    syncBucket(lay, { plan: nextPlan, levels: lvls, invest, investHidden: Array.from(hidden) });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        owned: Array.from(ids), elite: Array.from(elite.entries()), priority: prio,
        layout: lay, buckets: bucketsRef.current,
        // 구버전 호환 필드 (이 버전 이전 코드가 읽어도 현 프리셋 편성은 복원되게)
        plan: nextPlan, invest, investHidden: Array.from(hidden),
      }));
    } catch { /* ignore */ }
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
    const ambientAt = [0, 1].map((shift) => aurasOf(controlTeamAt(shift), ctxFor("CONTROL", shift === 0 ? plan.tokenPoints : {}, plan.factionCounts[shift] ?? {}, plan.plants, presentIdsFor(plan, shift))));
    const rows: Row[] = LAYOUT.map((cell) => {
      const shifts = plan.assignments[cell.key] ?? [];
      const scoreFor = (team: InfraOp[], shift: number) =>
        cell.room === "DORMITORY" || PARK_KEYS.includes(cell.key) ? null
          : Math.round(teamScore(team, cell.room, ctxFor(cell.key, shift === 0 ? plan.tokenPoints : {}, plan.factionCounts[shift] ?? {}, plan.plants, presentIdsFor(plan, shift), ambientAt[shift])));
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
      img.crossOrigin = "anonymous";
      img.onload = () => { avatars.set(op.id, img); resolve(); };
      img.onerror = () => resolve();
      img.src = op.image;
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
    const payload = JSON.stringify({ version: 1, exported: new Date().toISOString(), owned: Array.from(ownedIds), elite: Array.from(eliteById.entries()), plan, invest: investRecs, layout, levels, buckets: { ...bucketsRef.current, [layout]: { plan, levels, invest: investRecs, investHidden: Array.from(investHidden) } } }, null, 1);
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
        const lay: LayoutPreset = data.layout === "153" ? "153" : data.layout === "252" ? "252" : "243";
        if (lay !== layout) { setLayoutPreset(lay); setLayoutState(lay); }
        const fileBuckets = (data.buckets && typeof data.buckets === "object" ? data.buckets : {}) as Partial<Record<LayoutPreset, LayoutBucket>>;
        for (const k of ["243", "153", "252"] as const) if (fileBuckets[k]) bucketsRef.current[k] = fileBuckets[k]!;
        const lvls: Levels = (data.levels && typeof data.levels === "object" ? data.levels : bucketsRef.current[lay]?.levels) ?? suggestedLevels(lay);
        setEngineLevels(lvls);
        setLevelsState(lvls);
        const plan = sanitizePlan(data.plan);
        const invest = restoreInvest(data.invest);
        const hidden = restoreHidden(data.investHidden);
        setOwnedIds(ids);
        setEliteById(elite);
        if (plan) { setPlan(plan); setActiveShift(0); }
        setInvestRecs(invest);
        setInvestHidden(hidden);
        setShowInvest(false);
        persist(ids, plan, elite, priority, invest, hidden, lay, lvls);
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
  const updateTeam = (cellKey: string, shiftIdx: number, ids: string[]) => {
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
    persist(ownedIds, next);
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

  const runOptimize = async (ids: Set<string> = ownedIds, elite: Map<string, Elite> = eliteById, prio: ProdPriority = priority) => {
    if (optimizing) return; // 중복 실행 방지
    // 페이싱 없음 (사용자 확정 2026-07-21: 최대한 빠르게) — 진행 문구만 갱신하고 지연은 두지
    // 않는다. 엔진 tick의 매크로태스크 양보(setTimeout 0)만으로 리페인트는 충분하다.
    setOptimizing(t("자동편성 엔진 계산 중 — 편성 공간 구성…"));
    try {
      const paced = (step: OptimizeStep) => { setOptimizing(stepMessage(step)); };
      const next = await optimizeOff({ owned: ids, elite, includeFuture: !!includeFuture, priority: prio, layout, levels }, paced);
      setPlan(next);
      setActiveShift(0);
      // 새 자동편성 → 기존 육성 추천·숨김 무효화 + 임시 적용 세션 종료(새 편성이 기준). 2026-07-21
      setInvestRecs(null);
      setInvestHidden(new Set());
      setShowInvest(false);
      endTemp(false);
      persist(ids, next, elite, prio, null, new Set());
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
    if (investRecs) { setShowInvest(true); return; }
    void runInvest();
  };
  const runInvest = async () => {
    if (investing) return;
    endTemp(true); // 다시 분석 → 임시 적용 되돌리고 커밋된 로스터 기준으로 재분석
    setInvesting({ done: 0, total: 0 });
    try {
      const recs = await investOff({ owned: ownedIds, elite: eliteById, includeFuture: !!includeFuture, priority, layout, levels }, setInvesting);
      setInvestRecs(recs);
      setInvestHidden(new Set()); // 새 분석 → 숨김 초기화
      persist(ownedIds, plan, eliteById, priority, recs, new Set());
      setShowInvest(true);
      if (!recs.length) showToast(t("완성하면 이득인 오퍼를 찾지 못했습니다 — 보유 설정에서 정예화를 낮춰 두면 후보가 됩니다"));
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
      const next = await optimizeOff({ owned: ownedIds, elite: effElite, includeFuture: !!includeFuture, priority, layout, levels }, paced);
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
    persist(ownedIds, plan, eliteById, priority, investRecs, next);
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

  // 우선 생산 모드는 설정(라디오)일 뿐 — 실제 편성은 기존처럼 자동편성 버튼으로 실행한다
  // (사용자 확정 2026-07: 설정 변경이 편성을 갈아엎으면 안 됨)
  const setPriority = (prio: ProdPriority) => {
    if (prio === priority) return;
    setPriorityState(prio);
    persist(ownedIds, plan, eliteById, prio);
    showToast(t("우선 생산 설정을 저장했습니다 — 다음 자동편성부터 적용됩니다"));
  };

  // 기지 배치 프리셋 전환 (사용자 요청 2026-07-24): 프리셋마다 편성·레벨·육성추천 버킷을
  // 따로 보관한다 — 현재 상태를 현 프리셋 버킷에 넣고, 대상 프리셋의 저장분을 그대로 복원
  // (사용자 확정: 전환할 때마다 자동편성하지 않는다 — 각자 한 번 편성해 두면 유지).
  const setLayoutChoice = (next: LayoutPreset) => {
    if (next === layout) return;
    // 1) 현재 프리셋 상태 저장
    syncBucket(layout, { plan, levels, invest: investRecs, investHidden: Array.from(investHidden) });
    // 2) 엔진 전환 후 대상 버킷 복원 (sanitize는 새 LAYOUT 기준이라 반드시 전환 뒤에)
    setLayoutPreset(next);
    const b = bucketsRef.current[next] ?? { plan: null, levels: suggestedLevels(next), invest: null, investHidden: [] };
    const restored = b.plan ? sanitizePlan(b.plan) : null;
    setEngineLevels(b.levels);
    setLayoutState(next);
    setLevelsState(b.levels);
    setPlan(restored);
    setInvestRecs(b.invest);
    setInvestHidden(new Set(b.investHidden));
    setShowInvest(false);
    setOpenRoom(null);
    setActiveShift(0);
    endTemp(false); // 임시 적용 세션은 프리셋 간 이월하지 않는다
    persist(ownedIds, restored, eliteById, priority, b.invest, new Set(b.investHidden), next, b.levels);
    showToast(restored
      ? t("기지 배치 {p} — 저장된 편성을 복원했습니다", { p: next })
      : t("기지 배치 {p} — 처음이라 편성이 비어 있습니다. 전체 자동편성을 눌러 만들어 두면 유지됩니다", { p: next }));
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
    persist(ownedIds, nextPlan, eliteById, priority, investRecs, investHidden, layout, next);
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
      for (const shifts of Object.values(assignments)) {
        for (const id of shifts[Math.min(shift, shifts.length - 1)] ?? []) {
          present.add(id);
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
          const ambientNow = aurasOf(controlTeam, ctxFor("CONTROL", points, counts, plan.plants, present));
          const ctx = ctxFor(key, points, counts, plan.plants, present, ambientNow);
          const team = shifts[index].map((id) => effectiveOpById.get(id)).filter(Boolean) as InfraOp[];
          const current = teamScore(team, cell.room, ctx);
          let best: InfraOp | null = null;
          let bestDelta = 0;
          for (const op of roster) {
            if (usedAll.has(op.id)) continue;
            if (!op.skills.some((skill) => skillApplies(skill, cell.room, ctx.product))) continue;
            const delta = teamScore([...team, op], cell.room, ctx) - current;
            if (delta > bestDelta) { bestDelta = delta; best = op; }
          }
          if (!best) break;
          shifts[index].push(best.id);
          usedAll.add(best.id);
          present.add(best.id);
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
    persist(ownedIds, next, eliteById, priority, investRecs, investHidden, layout, lvls);
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
        setInvestRecs(restoreInvest(data.invest)); // 저장된 육성 추천 복원 (모달은 버튼으로 연다)
        setInvestHidden(restoreHidden(data.investHidden));
        if (data.priority) setPriorityState(data.priority as ProdPriority);
        // 기지 배치 프리셋·버킷 복원 — sanitizePlan이 활성 LAYOUT을 쓰므로 반드시 plan 복원보다 먼저.
        // buckets가 없는 구버전 저장분은 현 프리셋 버킷으로 이관한다
        const savedLayout: LayoutPreset = data.layout === "153" ? "153" : data.layout === "252" ? "252" : "243";
        const rawBuckets = (data.buckets && typeof data.buckets === "object" ? data.buckets : {}) as Partial<Record<LayoutPreset, LayoutBucket>>;
        if (!data.buckets) {
          rawBuckets[savedLayout] = { plan: data.plan ?? null, levels: {}, invest: data.invest ?? null, investHidden: data.investHidden ?? [] };
        }
        for (const k of ["243", "153", "252"] as const) {
          const rb = rawBuckets[k];
          if (rb) bucketsRef.current[k] = {
            plan: rb.plan ?? null,
            levels: rb.levels && typeof rb.levels === "object" ? rb.levels : suggestedLevels(k),
            invest: Array.isArray(rb.invest) ? rb.invest : null,
            investHidden: Array.isArray(rb.investHidden) ? rb.investHidden : [],
          };
        }
        if (savedLayout !== "243") { setLayoutPreset(savedLayout); setLayoutState(savedLayout); }
        const bucket = bucketsRef.current[savedLayout];
        const savedLevels = bucket?.levels ?? suggestedLevels(savedLayout);
        setEngineLevels(savedLevels);
        setLevelsState(savedLevels);
        if (bucket) { setInvestRecs(restoreInvest(bucket.invest)); setInvestHidden(restoreHidden(bucket.investHidden)); }
        // 손상·구버전 저장분 방어 — raw 복원은 assignments 등 누락 시 렌더 크래시
        // (개발 중간 상태가 저장된 localStorage에서 실제 발병, 2026-07-19). 정규화 실패면
        // 아래로 떨어져 새 편성을 만든다.
        if (bucket?.plan) {
          const savedPlan = sanitizePlan(bucket.plan);
          if (savedPlan) { setPlan(savedPlan); if (!data.priority && savedPlan.priority) setPriorityState(savedPlan.priority); return; }
        }
        // 마운트 시점엔 미래시 토글이 아직 복원 전(false)일 수 있으므로 미실장은 제외하고
        // 기본 편성을 만든다 — 미래시 포함 편성은 토글 후 자동편성 버튼으로 실행
        void optimizeOff({ owned: ids, elite, includeFuture: false, priority: "gold", layout: savedLayout, levels: savedLevels }).then(setPlan);
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

  // 제어센터 오라 — 대상 방(제조·무역·사무·응접) 점수와 서머리에 실제 합산된다
  const ambient = useMemo(() => {
    if (!plan) return undefined;
    const control = teamFor("CONTROL", activeShift);
    return aurasOf(control, ctxFor("CONTROL", pointsFor(activeShift), plan.factionCounts[activeShift], plan.plants, presentIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, activeShift, presentIds, eliteById]);

  const summary = useMemo(() => {
    if (!plan) return null;
    const avg = (prefix: string) => {
      const keys = LAYOUT.filter((cell) => cell.key.startsWith(prefix)).map((cell) => cell.key);
      const totals = keys.map((key) => teamScore(teamFor(key, activeShift), cellByKey.get(key)!.room, ctxFor(key, pointsFor(activeShift), plan.factionCounts[activeShift], plan.plants, presentIds, ambient)));
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
  const committedOpById = useMemo(() => new Map(visibleOps.map((op) => [op.id, withElite(op, eliteById.get(op.id))])), [visibleOps, eliteById]);

  // 임의 plan+조의 방 %효율 — teamScore + 제어센터 오라. before(스냅샷)/after(현재)를 같은 식으로.
  const scoreRoomIn = (p: Plan, opMap: Map<string, InfraOp>, key: string, shift: number): number => {
    const room = cellByKey.get(key)?.room;
    if (!room) return 0;
    const teamAt = (k: string) => (p.assignments[k]?.[Math.min(shift, (p.assignments[k]?.length ?? 1) - 1)] ?? []).map((id) => opMap.get(id)).filter(Boolean) as InfraOp[];
    const points = shift === 0 ? p.tokenPoints : {};
    const counts = p.factionCounts[shift] ?? {};
    const present = presentIdsFor(p, shift);
    const amb = aurasOf(teamAt("CONTROL"), ctxFor("CONTROL", points, counts, p.plants, present));
    return teamScore(teamAt(key), room, ctxFor(key, points, counts, p.plants, present, amb));
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
  const power = useMemo(() => powerBudget(levels), [levels, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCell = LAYOUT.find((cell) => cell.key === openRoom);

  return (
    <section className="planner">
      {confirmDialog}
      <div className="planner-controls">
        <div>
          <span className="section-no">{layout === "153"
            ? t("RIIC / 153 · 순금 1 + 작전기록 4 · A조 풀파워, 피로 시 B조 교대")
            : layout === "252"
              ? t("RIIC / 252 · 순금 2 + 작전기록 3 · 발전 2 — 시설 레벨로 전력 관리")
              : t("RIIC / 243 · 순금 2 + 작전기록 2 · A조 풀파워, 피로 시 B조 교대")}</span>
          <h2>{t("인프라 배치 최적화")}</h2>
        </div>
        <div className="planner-buttons">
          {/* startTransition: 로스터 모달(카드 수백 장)은 렌더가 무거워 클릭 페인트부터 내보낸다 (INP, 2026-07-21) */}
          <button onClick={() => startTransition(() => setShowRoster(true))}><span className="btn-icon" aria-hidden>▦</span>{t("보유 오퍼 설정 ({a}/{b})", { a: visibleOps.filter((op) => ownedIds.has(op.id)).length, b: visibleOps.length })}{isNewFeature("scanner") && <span className="new-badge">{t("새기능")}</span>}</button>
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
          t={t} locale={locale} />
      )}

      {/* 우선 생산 설정 (라디오) — 다음 자동편성부터 적용, 편성 실행은 버튼으로 */}
      <div className="prio-setting" role="radiogroup" aria-label={t("우선 생산")}
        title={t("먼저 채우는 방이 최고 요원을 가져갑니다 — 다음 자동편성부터 적용됩니다")}>
        <span className="prio-label">⚙ {t("우선 생산")}</span>
        {(["gold", "exp", "balance"] as const).map((mode) => (
          <label key={mode} className={priority === mode ? "on" : ""}>
            <input type="radio" name="prod-priority" checked={priority === mode} onChange={() => setPriority(mode)} />
            {t(mode === "gold" ? "순금 우선" : mode === "exp" ? "작전기록 우선" : "밸런스")}
          </label>
        ))}
        {/* 기지 배치 프리셋 (사용자 요청 2026-07-24) — 방 구성은 즉시 바뀌고, 재편성은 자동편성 버튼으로 */}
        <span className="prio-label prio-label-layout">🏗 {t("기지 배치")}{isNewFeature("layout-153") && <span className="new-badge">{t("새기능")}</span>}</span>
        {(["243", "153", "252"] as const).map((preset) => (
          <label key={preset} className={layout === preset ? "on" : ""}
            title={preset === "243" ? t("무역소 2 · 제조소 4(순금 2+작전기록 2) · 발전소 3")
              : preset === "153" ? t("무역소 1 · 제조소 5(순금 1+작전기록 4) · 발전소 3")
              : t("무역소 2 · 제조소 5(순금 2+작전기록 3) · 발전소 2 — 전력 부족: 작전기록 제조소 Lv2·사무실 Lv2·숙소 Lv1(첫 숙소만 Lv2) 권장, 정확히 540/540")}>
            <input type="radio" name="base-layout" checked={layout === preset} onChange={() => setLayoutChoice(preset)} />
            {preset}
          </label>
        ))}
      </div>

      {/* 항상 렌더해 높이를 처음부터 예약 — 계산 전엔 '—'로 채운다. 계산 완료 후 값이 튀어나오며
          아래 배치도를 밀어내던 CLS 방지 (사용자 리포트 2026-07-20). summary가 있으면 plan도 항상 있음. */}
      <div className="planner-summary">
        <button type="button" className="strategy-cell" onClick={() => setShowFlows(true)} disabled={!plan}>
          <span>{t("전략 (클릭해 시너지 트리 보기)")}</span>
          <b className="strategy">{plan ? `${strategyLabel(plan, locale, t)}${Object.keys(plan.tokenPoints).length > 0 ? ` · ${Object.entries(plan.tokenPoints).map(([token, points]) => t("{token} {n}점", { token: tokenName(locale, token), n: Math.round(points) })).join(" · ")}` : ""}` : "—"}</b>
        </button>
        <div><span>{t("제조소 평균")}</span><b>{summary ? `+${summary.manufacture}%` : "—"}</b></div>
        <div><span>{t("무역소 평균")}</span><b>{summary ? `+${summary.trading}%` : "—"}</b></div>
        <div><span>{t("발전소 평균")}</span><b>{summary ? `+${summary.power}%` : "—"}</b></div>
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

      {plan && (
        <div className="shift-tabs">
          {Array.from({ length: SHIFT_COUNT }, (_, i) => (
            <button key={i} className={activeShift === i ? "selected" : ""} onClick={() => setActiveShift(i)}>{[t("A조 (풀파워)"), t("B조 (회복 교대)")][i]}</button>
          ))}
          <span className="shift-hint">{t("A조 컨디션 소진 시 B조 투입 · 시너지 세트는 A조 집중 · 숙소·고정 요원은 조 전환과 무관 · ")}<b>{t("숙소는 항상 5명 꽉 채워 유지")}</b></span>
        </div>
      )}

      <div className={`ship${layout !== "243" ? ` ship-${layout}` : ""}`}>
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
          ) : investRecs && !investing ? (
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
              <span className={`srb-lbl${investing ? " hide" : ""}`}>★ {t("인프라 오퍼 육성 추천")}{isNewFeature("invest") && <span className="new-badge">{t("새기능")}</span>}</span>
              {investing && <span className="srb-over">★ {investing.total ? t("분석 중 {i}/{n}", { i: investing.done, n: investing.total }) : t("분석 중…")}</span>}
            </button>
          )}
        </div>
        {LAYOUT.map((cell) => {
          if (cell.room === "DORMITORY") {
            const pinned = teamFor(cell.key, 0);
            return (
              // 숙소도 클릭 → 상세 모달 (사용자 요청 2026-07-24) — 레벨 조절(전력·숙소 연동 스킬)용.
              // 편성은 시너지 고정 전용이라 모달에서 읽기 전용.
              <button key={cell.key} type="button" className={`ship-room dorm-room pos-${cell.key.toLowerCase()}`} onClick={() => setOpenRoom(cell.key)} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
                <div className="ship-room-head"><b>{t(cell.label)}<em className={`room-lv${levelOf(cell.key) < maxLevelOf(cell.room) ? "" : " max"}`}>Lv{levelOf(cell.key)}</em></b><span>{t("고정")}</span></div>
                <div className="ship-room-crew">
                  {pinned.map((op) => <img key={op.id} src={op.image} alt={op.name} width={180} height={180} title={t("{name} 상세 정보", { name: op.name })} loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={(event) => { event.stopPropagation(); onShowOperator?.(op.id); }} />)}
                  <i>{pinned.length ? t("시너지 고정 + 휴식 공간") : t("휴식 공간 · 조 전환과 무관")}</i>
                </div>
              </button>
            );
          }
          const team = teamFor(cell.key, activeShift);
          const spec = infra.rooms[cell.room];
          const cellCtx = ctxFor(cell.key, pointsFor(activeShift), plan?.factionCounts?.[activeShift], plan?.plants, presentIds, ambient);
          const score = Math.round(teamScore(team, cell.room, cellCtx));
          // 제어센터 오라 수신분 — 카드 총점이 "오퍼 스킬 합과 달라 보이는" 이유를 명시
          // (플레임테일 B조: 작전기록 +30 / 순금 -30 등. 사용자 지적 2026-07-19)
          const ambientPart = score - Math.round(teamScore(team, cell.room, ctxFor(cell.key, pointsFor(activeShift), plan?.factionCounts?.[activeShift], plan?.plants, presentIds)));
          // 임시 적용 중이면 원래(스냅샷·커밋 정예화) 효율 대비 변화를 방 카드에 인플레이스 표시
          const raiseBefore = tempApplied.size > 0 && tempBasePlan && cell.room !== "CONTROL" && !PARK_KEYS.includes(cell.key)
            ? Math.round(scoreRoomIn(tempBasePlan, committedOpById, cell.key, activeShift)) : null;
          return (
            <button key={cell.key} type="button" className={`ship-room pos-${cell.key.toLowerCase()}`} onClick={() => setOpenRoom(cell.key)} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
              <div className="ship-room-head">
                <b>{t(cell.label)}<em className={`room-lv${levelOf(cell.key) < maxLevelOf(cell.room) ? "" : " max"}`}>Lv{levelOf(cell.key)}</em></b>
                <span>{team.length}/{slotsFor(cell.key)}</span>
              </div>
              <div className="ship-room-crew">
                {team.length ? team.map((op) => {
                  // 오퍼의 정예화 단계 (E0/E1/E2) — 임시 적용 반영(viewElite), 미지정이면 그 오퍼 최대 정예화.
                  const elite = viewElite.get(op.id) ?? maxElite(op.rarity);
                  const isTemp = tempApplied.has(op.id); // 육성 추천 임시 적용 오퍼 — 미리보기임을 썸네일에 표시
                  return (
                    <span key={op.id} className={`op-av${isTemp ? " temp" : ""}`} title={isTemp ? t("{name} — 임시 적용 중 (완성 가정 미리보기)", { name: op.name }) : undefined}>
                      <img src={op.image} alt={op.name} width={180} height={180} title={isTemp ? undefined : op.name} loading="lazy" />
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

      <aside className="data-note"><span>PLANNER NOTE</span><p>{t("오퍼레이터의 모든 인프라 스킬을 동시에 적용하고(α/β는 상위 티어만), 시설 간 포인트 시스템(속세의 화식·무성의 공명 등)을 겹쳐 쌓을 수 있을 때까지 패키지로 조합합니다. 고품질 귀금속 오더 확률(샤마르·카프카·디아만테·바이비크)과 오더당 수익(테킬라·프로바이조)의 상호작용, 샤마르의 효율 대체를 반영합니다. 조건부·누적 버프는 추정 상한 기준 근사치입니다.")}</p></aside>

      {showRoster && (
        <RosterModal
          allOps={visibleOps}
          ownedIds={ownedIds}
          eliteById={eliteById}
          onApply={(ids, elite) => { setOwnedIds(ids); setEliteById(elite); setShowRoster(false); runOptimize(ids, elite); setDirty(true); }}
          onClose={() => setShowRoster(false)}
          onShowOperator={onShowOperator}
        />
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {imageUrl && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeImage(); }}>
          <section className="operator-modal room-modal image-preview" style={{ "--accent": "var(--lime)" } as React.CSSProperties}>
            <button type="button" className="modal-close" onClick={closeImage} aria-label={t("닫기")}>×</button>
            <header className="room-modal-head">
              <span className="modal-kicker">PLAN SHEET</span>
              <h2>{t("편성표 이미지")}</h2>
              <div className="roster-tools">
                <a className="apply save-image" href={imageUrl} download="terra-archive-infra.png">{t("PNG 저장")}</a>
              </div>
            </header>
            <div className="modal-scroll"><img src={imageUrl} alt={t("인프라 편성표")} /></div>
          </section>
        </div>
      )}

      {showFlows && plan && <FlowModal plan={plan} opMap={effectiveOpById} onClose={() => setShowFlows(false)} onShowOperator={onShowOperator} />}

      {openCell && plan && (
        <RoomModal
          cell={openCell}
          plan={plan}
          allAssigned={allAssigned}
          roster={roster}
          opMap={effectiveOpById}
          initialShift={activeShift}
          onClose={() => setOpenRoom(null)}
          onShowOperator={onShowOperator}
          onSetLevel={setRoomLevel}
          onUpdateTeam={openCell.room === "DORMITORY" ? undefined : updateTeam}
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
function InvestPanel({ recs, opMap, onShowOperator, onClose, onReanalyze, onToggleSelect, onApplySelected, onApplyAll, onHide, selected, applied, onRevert, t, locale }: {
  recs: RaiseRec[]; opMap: Map<string, InfraOp>; onShowOperator?: (id: string) => void;
  onClose: () => void; onReanalyze: () => void; onToggleSelect: (opId: string) => void; onApplySelected: () => void; onApplyAll: () => void;
  onHide: (opId: string) => void; selected: Set<string>; applied: Set<string>; onRevert: () => void; t: T; locale: Locale;
}) {
  // 방 라벨은 i18n 사전 키("제조소 1 · 순금" 등) — 배 뷰(t(cell.label))처럼 번역해 표시
  // (일어판 육성 추천 모달에 방 이름만 한국어로 남던 문제, 사용자 리포트 2026-07-22)
  const roomLabel = (key: string) => t(cellByKey.get(key)?.label ?? key);
  const shiftTag = (s: number) => (s === 0 ? t("A조") : t("B조"));
  const num = (n: number) => Math.round(n).toLocaleString();
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="operator-modal invest-panel" role="dialog" aria-modal="true" aria-label={t("인프라 오퍼 육성 추천")}>
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
      {!recs.length && <p className="invest-empty">{t("완성해도 최적 편성이 바뀌는 오퍼가 없습니다. 보유 오퍼 설정에서 아직 안 키운 오퍼의 정예화를 낮춰 두면, 완성 시 이득이 있는지 여기서 확인할 수 있습니다.")}</p>}
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
                  <span className="invest-raise">{t(ELITE_LABEL[r.from])} → {t(ELITE_LABEL[r.to])} {t("완성")}</span>
                  {r.synergy && <span className="invest-syn" title={t("팀 시너지를 여는 오퍼 — 완성 시 열리는 세트의 총 시너지 효율까지 반영해 평가했습니다")}>{t("시너지")}</span>}
                  <span className="invest-gains" title={t("완성 시 오르는 방 %효율의 조별 합계 — 아래 방 변화의 합입니다")}>
                    {Math.round(r.aGain) >= 1 && <span className="inv-gain a">{t("A조 +{n}%p", { n: Math.round(r.aGain) })}</span>}
                    {Math.round(r.bGain) >= 1 && <span className="inv-gain b">{t("B조 +{n}%p", { n: Math.round(r.bGain) })}</span>}
                  </span>
                </div>
                {r.placement && <div className="invest-place">{t("{room} · {shift}에 배치됩니다", { room: roomLabel(r.placement.key), shift: shiftTag(r.placement.shift) })}</div>}
                {deltas.length > 0 && (
                  <ul className="invest-rooms">
                    {deltas.map((d, i) => (
                      <li key={i}><span>{roomLabel(d.key)} {shiftTag(d.shift)}</span> <em>{Math.round(d.before)}% → {Math.round(d.after)}%</em></li>
                    ))}
                  </ul>
                )}
                <div className="invest-cost">
                  <span className="inv-cost-label">{t("완성 비용")}</span>
                  <span className="inv-cost-lmd">{t("용문폐")} {num(r.cost.lmd)}</span>
                  {r.cost.exp > 0 && <span>{t("경험치")} {num(r.cost.exp)}</span>}
                  {r.cost.items.map(([id, ct]) => (
                    <span key={id} className="inv-mat" title={`${ITEM_CAT[id]?.name?.[locale] ?? id} ×${ct}`}>
                      <img src={ITEM_CAT[id]?.image} alt="" width={22} height={22} loading="lazy" />{ct}
                    </span>
                  ))}
                  {/* 선택·숨기기는 푸터 오른쪽 끝 — 타이틀 줄이 꽉 차면 버튼이 다음 줄로 밀리던 문제 (사용자 요청 2026-07-21) */}
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
    </section>
    </div>
  );
}

function RoomModal({ cell, plan, allAssigned, roster, opMap, initialShift, onClose, onShowOperator, onUpdateTeam, eliteById, onSetElite, tempIds, onRevertTempOne, onSetLevel }: { cell: { key: string; room: string; label: string; product?: string }; plan: Plan; allAssigned: Set<string>; roster: InfraOp[]; opMap: Map<string, InfraOp>; initialShift: number; onClose: () => void; onShowOperator?: (id: string) => void; onUpdateTeam?: (cellKey: string, shiftIdx: number, ids: string[]) => void; eliteById: Map<string, Elite>; onSetElite: (id: string, elite: Elite) => void; tempIds: Set<string>; onRevertTempOne: (opId: string) => void; onSetLevel?: (key: string, lv: number) => void }) {
  const { locale, t } = useI18n();
  const [shift, setShift] = useState(initialShift);
  const shiftIndex = Math.min(shift, (plan.assignments[cell.key]?.length ?? 1) - 1);
  const rawIds = plan.assignments[cell.key]?.[shiftIndex] ?? [];
  const team = rawIds.map((id) => opMap.get(id)).filter(Boolean) as InfraOp[];
  const teamIds = new Set(team.map((op) => op.id));
  const points = shiftIndex === 0 ? plan.tokenPoints : {};
  // 제어센터 오라를 이 방 점수에도 합산 (제어센터 자신을 볼 때는 미적용)
  const controlShifts = plan.assignments["CONTROL"] ?? [];
  const controlTeam = (controlShifts[Math.min(shiftIndex, controlShifts.length - 1)] ?? []).map((id) => opMap.get(id)).filter(Boolean) as InfraOp[];
  const ambient = cell.key === "CONTROL" ? undefined
    : aurasOf(controlTeam, ctxFor("CONTROL", points, plan.factionCounts[shiftIndex] ?? {}, plan.plants, presentIdsFor(plan, shiftIndex)));
  const ctx = ctxFor(cell.key, points, plan.factionCounts[shiftIndex] ?? {}, plan.plants, presentIdsFor(plan, shiftIndex), ambient);
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
  const [benchQuery, setBenchQuery] = useState("");
  const benchFull = team.length < slots && onUpdateTeam
    ? roster
        .filter((op) => !allAssigned.has(op.id))
        .map((op) => ({ op, delta: Math.round(teamScore([...team, op], cell.room, ctx)) - currentScore }))
        .sort((a, b) => b.delta - a.delta || b.op.rarity - a.op.rarity)
    : [];
  const benchKeyword = normSearch(benchQuery);
  const benchFiltered = benchKeyword
    ? benchFull.filter(({ op }) => normSearch(op.name).includes(benchKeyword) || normSearch(op.faction).includes(benchKeyword))
    : benchFull;
  const bench = benchAll ? benchFiltered : benchFiltered.slice(0, 12);
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
  // 칩은 보유 로스터 내 관련 오퍼만(배치 중 = 컬러, 미배치 = 흑백), 스킬당 최대 3관계·칩 8개.
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
  const chipSort = (chips: { op: InfraOp; on: boolean }[]) => chips.sort((a, b) => Number(b.on) - Number(a.on) || b.op.rarity - a.op.rarity).slice(0, 8);
  const relsOf = (skill: InfraSkill, self: InfraOp): Rel[] => {
    const rels: Rel[] = [];
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
      const providers = team.filter((member) => member.id !== self.id && member.skills.some((s) => (s.cap ?? 0) !== 0 && skillApplies(s, cell.room, cell.product)));
      rels.push({ note: t("적립 용량을 생산력으로 전환"), chips: providers.map((member) => ({ op: member, on: true })) });
    }
    return rels.slice(0, 3);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
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
          {cell.room !== "DORMITORY" && (
            <div className="shift-tabs in-modal">
              {Array.from({ length: SHIFT_COUNT }, (_, i) => (
                <button key={i} className={shift === i ? "selected" : ""} onClick={() => setShift(i)}>{[t("A조"), t("B조")][i]}</button>
              ))}
            </div>
          )}
        </header>
        <div className="modal-scroll">
          {scored && (
            <section className="detail-section room-summary">
              <span className="detail-no">RESULT / 00</span>
              <h3>{t("종합 효율")}{cell.product ? ` · ${cell.product}` : ""} <b className="summary-total">+{currentScore}{cell.room === "CONTROL" ? "" : "%"}</b></h3>
              <div className="summary-parts">
                {Object.entries(agg).filter(([, value]) => Math.round(value) !== 0).map(([name, value]) => (
                  <span key={name}>{t(name)} <b>{Math.round(value) >= 0 ? "+" : ""}{Math.round(value)}</b></span>
                ))}
                {team.length === 0 && <span>{t("편성 없음")}</span>}
              </div>
              <p className="summary-note">{t("아래에서 오퍼를 빼거나(✕) 대체 오퍼·추가 후보를 클릭하면 즉시 다시 계산됩니다. 단, 토큰 포인트(속세의 화식 등)와 패키지 구성은 마지막 자동편성 기준이므로, 토큰 생성원을 바꿨다면 자동편성 실행으로 재계산하세요.")}</p>
            </section>
          )}
          <section className="detail-section">
            <span className="detail-no">CREW / 01</span>
            <h3>{t("편성 ({a}/{b})", { a: team.length, b: slots })}</h3>
            {cell.room === "DORMITORY" && (
              <p className="dorm-note">{rich(t("숙소는 **항상 5명을 꽉 채운 상태로 유지**하세요. 고정 생성원 외의 빈 자리는 휴식이 필요한 아무 오퍼레이터로 채우면 됩니다 — 토큰 생성과 회복 효율은 풀 인원 기준으로 계산됩니다."))}</p>
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
                const shown = b.skills.length ? b.skills : op.skills.filter((skill) => skill.room === cell.room);
                return (
                  <article key={op.id} className="crew-card">
                    {tempIds.has(op.id) && <button type="button" className="crew-revert" title={t("이 오퍼만 임시 적용을 되돌립니다")} onClick={() => onRevertTempOne(op.id)}>↩</button>}
                    {onUpdateTeam && <button type="button" className="crew-remove" title={t("이 자리에서 빼기")} onClick={() => setIds(rawIds.filter((id) => id !== op.id))}>✕</button>}
                    <span className={`crew-face${tempIds.has(op.id) ? " temp" : ""}`}>
                      <img src={op.image} alt={op.name} width={180} height={180} loading="lazy" className={onShowOperator ? "op-link" : undefined}
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
                        const rels = relsOf(skill, op);
                        return (
                          <p key={skill.name}>
                            <em>{skill.name}</em> — {skill.description}
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
                <span>{t("빈 자리에 추가 — 클릭 시 즉시 배치 (기여 예상):")}</span>
                <input className="bench-search" value={benchQuery} onChange={(event) => setBenchQuery(event.target.value)} placeholder={t("이름·소속으로 후보 검색")} />
                {bench.length > 0 ? (
                  <div className="bench-chips">
                    {bench.map(({ op, delta }) => (
                      <small key={op.id} className="sub-chip swappable" title={t("{name} 추가", { name: op.name })} onClick={() => setIds([...rawIds, op.id])}>
                        <img src={op.image} alt="" width={180} height={180} loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={(event) => { event.stopPropagation(); onShowOperator?.(op.id); }} />{op.name} <em>{delta >= 0 ? `+${delta}` : delta}</em>
                      </small>
                    ))}
                  </div>
                ) : (
                  <p className="no-detail">{t("검색 결과가 없습니다.")}</p>
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
      </section>
    </div>
  );
}

function FlowModal({ plan, opMap, onClose, onShowOperator }: { plan: Plan; opMap: Map<string, InfraOp>; onClose: () => void; onShowOperator?: (id: string) => void }) {
  const { locale, t } = useI18n();
  const flows = plan.flows.filter((flow) => flow.generators.length > 0 || flow.consumers.length > 0);
  const avatar = (op: InfraOp | undefined) => op ? (
    <img src={op.image} alt="" width={180} height={180} loading="lazy" className={onShowOperator ? "op-link" : undefined}
      title={onShowOperator ? t("{name} 상세 정보", { name: op.name }) : undefined} onClick={() => onShowOperator?.(op.id)} />
  ) : null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": "var(--lime)" } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
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
      </section>
    </div>
  );
}

function RosterModal({ allOps, ownedIds, eliteById, onApply, onClose, onShowOperator }: { allOps: InfraOp[]; ownedIds: Set<string>; eliteById: Map<string, Elite>; onApply: (ids: Set<string>, elite: Map<string, Elite>) => void; onClose: () => void; onShowOperator?: (id: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Set<string>>(new Set(ownedIds));
  const [eliteDraft, setEliteDraft] = useState<Map<string, Elite>>(new Map(eliteById));
  const [showScan, setShowScan] = useState(false); // 스크린샷 스캐너(모달 내부에서 draft에 병합)
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("기본");
  const [sortAsc, setSortAsc] = useState(true);
  const keyword = query.trim().toLowerCase();
  // 백과사전과 동일한 정렬 (직군·세부 직군·출신지·종족 포함). 기본 = 6성↓ → KR 출시 최신순
  const filteredOps = allOps.filter((op) => !keyword || op.name.toLowerCase().includes(keyword) || op.faction.toLowerCase().includes(keyword));
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
  const futureOps = sortOps(filteredOps.filter((op) => op.unreleased));
  const releasedOps = sortOps(filteredOps.filter((op) => !op.unreleased));
  const visible = [...futureOps, ...releasedOps];
  const toggle = (id: string) => setDraft((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const setElite = (id: string, elite: Elite) => setEliteDraft((current) => {
    const next = new Map(current);
    if (elite === 2) next.delete(id); else next.set(id, elite); // 2정이 기본값이라 별도 저장 불필요
    return next;
  });
  const renderCard = (op: InfraOp) => {
    const owned = draft.has(op.id);
    const options = eliteOptions(op);
    const elite = Math.min(eliteDraft.get(op.id) ?? 2, options.length ? options[options.length - 1] : 2) as Elite;
    return (
      <div key={op.id} className={`roster-card${owned ? " owned" : ""}${op.unreleased ? " future" : ""}`}>
        <button type="button" onClick={() => toggle(op.id)} title={op.name}>
          <img src={op.image} alt={op.name} width={180} height={180} loading="lazy" className={onShowOperator ? "op-link" : undefined}
            onClick={(event) => { if (onShowOperator) { event.stopPropagation(); onShowOperator(op.id); } }} />
          <span>{op.name}{op.unreleased && <em className="future-badge">{t("미실장")}</em>}</span>
        </button>
        {owned && options.length > 0 && (
          <div className="elite-toggle" role="group" aria-label={t("{name} 정예화 단계", { name: op.name })}>
            {options.map((option) => (
              <button key={option} type="button" className={elite === option ? "selected" : ""} onClick={() => setElite(op.id, option)}>{t(ELITE_LABEL[option])}</button>
            ))}
          </div>
        )}
      </div>
    );
  };
  // 성급 단위 일괄 조작 — 보유 체크/해제, 정예화 노정예/1정/2정
  // (정예화는 3성 이상에만 적용 — 2성 이하는 승급이 없어 보유/해제만)
  const bulkOwn = (test: (rarity: number) => boolean, own: boolean) => setDraft((current) => {
    const next = new Set(current);
    for (const op of allOps) if (test(op.rarity)) { if (own) next.add(op.id); else next.delete(op.id); }
    return next;
  });
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
        type MaaOper = { id?: string; own?: boolean; elite?: number };
        const entries: MaaOper[] = Array.isArray(parsed)
          ? parsed
          : [...((parsed?.all_opers as MaaOper[]) ?? []), ...((parsed?.own_opers as MaaOper[]) ?? [])];
        const byId = new Map(allOps.map((op) => [op.id, op]));
        const nextDraft = new Set(draft);
        const nextElite = new Map(eliteDraft);
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
        }
        if (seen.size === 0) { fail(); return; }
        setDraft(nextDraft);
        setEliteDraft(nextElite);
        setImportMsg(t("MAA 보유 데이터를 반영했습니다 — 보유 {own}명 · 정예화 반영 {elite}건 · 미수록 오퍼 {skip}건. 확인 후 '적용 및 자동편성 실행'을 누르세요.", { own: owned, elite: eliteSet, skip: unmatched }));
      } catch { fail(); }
    };
    reader.readAsText(file);
  };
  // 성급별 가능한 정예화 단계: 4성+ = 노정예/1정/2정, 3성 = 노정예/1정, 2성 이하 = 노정예뿐(선택지 없음)
  const BULK_GROUPS: { label: string; test: (rarity: number) => boolean; elites: Elite[] }[] = [
    { label: "6성", test: (rarity) => rarity === 6, elites: [0, 1, 2] },
    { label: "5성", test: (rarity) => rarity === 5, elites: [0, 1, 2] },
    { label: "4성", test: (rarity) => rarity === 4, elites: [0, 1, 2] },
    { label: "3성", test: (rarity) => rarity === 3, elites: [0, 1] },
    { label: "2성 이하", test: (rarity) => rarity <= 2, elites: [] },
  ];
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": "var(--lime)" } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        <header className="room-modal-head">
          <span className="modal-kicker">ROSTER · {t("{n}/{m} 보유", { n: draft.size, m: allOps.length })}</span>
          <h2>{t("보유 오퍼레이터 설정")}</h2>
          <div className="roster-tools">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("이름·소속 검색")} />
            <button type="button" onClick={() => setDraft(new Set(allOps.map((op) => op.id)))}><span className="btn-icon" aria-hidden>✓</span>{t("전체 선택")}</button>
            <button type="button" onClick={() => setDraft(new Set())}><span className="btn-icon" aria-hidden>✕</span>{t("전체 해제")}</button>
            <label className="maa-import" title={t("MAA(MaaAssistantArknights)의 오퍼 박스 인식 결과 JSON을 불러와 보유·정예화를 한 번에 설정합니다")}>
              <span className="btn-icon" aria-hidden>⤒</span>{t("MAA 파일 가져오기")}
              <input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) importMaa(file); event.target.value = ""; }} />
            </label>
            <button type="button" onClick={() => setShowScan(true)} title={t("오퍼 목록 스크린샷을 자동 인식해 보유·정예화를 채웁니다")}><span className="btn-icon" aria-hidden>◉</span>{t("스크린샷으로 보유 오퍼 스캔")}{isNewFeature("scanner") && <span className="new-badge">{t("새기능")}</span>}</button>
            <button type="button" className="apply" onClick={() => onApply(draft, eliteDraft)}><span className="btn-icon" aria-hidden>⟳</span>{t("적용 및 자동편성 실행")}</button>
          </div>
        </header>
        <div className="modal-scroll">
          {importMsg && <p className="dorm-note maa-import-msg">{importMsg}</p>}
          <p className="dorm-note">{rich(t("3성 이상 오퍼는 카드 아래에서 **노정예/1정/2정**(3성은 1정까지)을 선택할 수 있습니다 (기본값 최대 정예화). 얼굴을 클릭하면 상세 정보가 열립니다."))}</p>
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
        </div>
      </section>
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
                setImportMsg(t("스캔 결과 {n}명을 반영했습니다 — 확인 후 '적용 및 자동편성 실행'을 누르세요.", { n: String(dets.length) }));
              }}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

const HELP_SECTIONS: { title: string; items: string[] }[] = [
  { title: "교대 정책", items: [
    "A조가 풀파워 주력이고 토큰 패키지·시너지 세트는 기본적으로 A조에 모입니다. B조는 A조 컨디션이 소진됐을 때 투입되는 회복 교대입니다 (12시간 2조). 예외로 피누스 실베스트리스 세트는 B조에 결집합니다 — A조 제조소·제어센터는 화식 세트와 상위 생산 오퍼 몫이기 때문입니다.",
    "A조를 먼저 반복 전수검사로 풀파워로 완성한 뒤(안정될 때까지), 남은 오퍼레이터만으로 B조를 같은 방식으로 검수해 편성합니다. 시너지 세트 후보안도 가능한 조합을 전부 만들어 총점으로 비교하므로 계산에 몇 초가 걸릴 수 있습니다.",
    "같은 오퍼를 A조·B조에 동시 배치하지 않는 것이 기본 원칙입니다 — 근무를 이중으로 서면 못 쉬고 24시간 돌아야 하기 때문입니다. 사기를 소모하지 않는 숙소(휴식)·가공소(상시 슬롯)만 예외로 조 전환과 무관하게 고정됩니다.",
    "숙소·시너지 고정 요원(숙소 생성원, 니엔 등)은 A/B 전환과 무관하게 고정됩니다. 응접실도 A/B 교대로 운영합니다 — 같은 인원을 24시간 돌리지 않습니다.",
    "가공소는 상시 슬롯이라 A조 한 팀(니엔 고정)만 편성하고 B조 칸은 비워 둡니다 — 회복 교대에 가공 요원을 따로 두지 않습니다.",
    "훈련실은 실제 스킬 특화 훈련에 쓰도록 비워 둡니다.",
    "자동편성은 제조소·무역소·응접실·사무실을 반드시 정원까지 채웁니다 — 인프라 스킬이 없는 오퍼라도 배치 인원 자체가 기본 생산분을 내므로, 슬롯을 비우는 것이 항상 손해이기 때문입니다. 보유 오퍼 총원이 모자랄 때만 빈 자리가 남습니다. 제어센터·발전소는 스킬 없는 배치가 사기만 소모해 예외입니다.",
    "'전체 자동편성'은 처음부터 다시 계산하고, '빈 자리만 자동편성'은 현재 편성(수동 수정 포함)을 유지한 채 남은 빈 자리만 한계 기여 순으로 채웁니다.",
  ]},
  { title: "방 우선순위", items: [
    "기지 배치 설정: 243(무역 2·제조 4 — 순금 2+작전기록 2, 기본) · 153(무역 1·제조 5 — 순금 1+작전기록 4) · 252(무역 2·제조 5 — 순금 2+작전기록 3, 발전 2). 153은 무역소가 하나라 제조소 대부분을 작전기록에 쓰되, 유일한 순금방이 병목이므로 그 방을 맨 먼저(최정예로) 채웁니다. 각 배치의 편성·시설 레벨은 따로 저장됩니다 — 배치마다 한 번씩 자동편성해 두면 전환할 때 그대로 복원됩니다.",
    "전력·시설 레벨: 발전소가 전력을 공급하고(레벨 3 기준 1기 270, 3기 810) 나머지 시설이 소비합니다. 방을 눌러 시설 레벨을 바꾸면 전력 소비·근무 슬롯(제조소·무역소 Lv1/2/3 = 1/2/3인)·레벨 연동 스킬(숙소 레벨 합·응접실·훈련실 레벨 등)이 함께 재계산됩니다. 243·153은 전부 만렙일 때 소비가 정확히 810이라 여유가 0이고, 252는 발전소가 2기(540)뿐이라 시설 레벨을 낮춰야 성립합니다 — 기본값은 순금 제조소·응접실·훈련실 만렙 유지, 작전기록 제조소 Lv2, 사무실 Lv2, 숙소 Lv1(첫 숙소만 Lv2)로 소비가 정확히 540입니다. 상단 ⚡ 전력이 음수면 게임에서 지을 수 없는 구성입니다.",
    "우선 생산 설정: 순금 우선(기본) · 작전기록 우선 · 밸런스(교차). 먼저 채우는 방이 최고 요원을 가져갑니다. 설정만 바꾸고, 실제 편성은 전체 자동편성 버튼을 눌러 적용합니다.",
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
    "레벨 성장형은 만렙 기지 기준 상한으로 계산합니다: 비질 +40%(응접실 Lv3), 아르케토 +40%(숙소 20레벨), 미틈 +30%, 만트라 +45%(시설 10개).",
    "언더플로우(+30%)는 울피아누스가 기지 어디든(숙소 포함) 있으면 +40%가 됩니다 — 울피아누스를 숙소에 고정해 두세요. B조 무역소 정배: 비질+아르케토+언더플로우.",
  ]},
  { title: "자동화 제조소", items: [
    "위디·유넥티스·윈드플릿·패신저는 방 내 다른 오퍼의 생산력을 0으로 만들고 발전소 1기당 +15%/+10%/+5%/+5%를 받습니다 — 이들과 같은 방에 넣은 일반 +30%/+35%류 생산력 스킬은 전부 0%가 되므로, 직접 수치가 아니라 이런 제로아웃 오퍼와 궁합이 맞는지 먼저 확인해야 합니다.",
    "스네구로치카는 같은 방식으로 제로아웃하되 발전소가 아니라 그 제조소에 실제 배치된 인원수당 +10%로 스케일됩니다.",
    "단 시설 수량 기반 생산력(퓨어스트림·쏜즈의 '각각의 무역소가…')은 살아남아 함께 쓸 수 있습니다.",
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
    "만트라 정예 소대는 실존 정예 오퍼 수 기준으로 계산합니다 (현재 6명 → +37%, 신규 정예 오퍼 추가 시 데이터 갱신에서 자동 반영).",
  ]},
  { title: "정예화 단계 (1정/2정)", items: [
    "보유 오퍼 설정에서 오퍼별로 기본값(2정 · 정예화 2)을 노정예/1정으로 낮출 수 있습니다 (3성 이상 전원 — 스킬이 노정예부터 있는 오퍼도 선택 가능).",
    "1정으로 지정하면 해당 오퍼는 정예화 2 전용 스킬 없이 계산·자동편성됩니다 — 아직 승급 못 한 오퍼를 과대평가하지 않도록 맞춰 두세요.",
  ]},
  { title: "대체 추천", items: [
    "각 자리의 대체 후보는 실제로 교체해 본 방 점수로 순위를 매기고, 동점이면 낮은 성급(육성 저렴)을 우선합니다.",
    "토큰 생성·소비자, 오버라이드·수익 역할, 쉐이 카운트 인원 같은 시너지 코어는 '대체 불가'로 표시됩니다.",
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
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": "var(--lime)" } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
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
      </section>
    </div>
  );
}
