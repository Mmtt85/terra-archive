"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n, tokenName, rich, type ExtraI18n, type Locale, type T } from "./i18n";
import { RULES } from "./rules";
import { useConfirm } from "./confirm";
import { normSearch } from "./search";

import {
  infra, ops, opById, factionsOf, withElite, clueBase, maxElite, eliteOptions,
  ELITE_LABEL, LAYOUT, cellByKey, ROOM_ACCENT, UNIT, PARK_KEYS, SHIFT_COUNT,
  JOB_ORDER, ROSTER_SORT_KEYS, PRODUCTION_KEYS, SUPPORT_KEYS,
  AURA_WEIGHT, AURA_LABEL, skillApplies, breakdown, teamScore, aurasOf, ambientFor,
  ctxFor, sanitizePlan, presentIdsFor, optimize, slotSubstitutes,
  type InfraOp, type InfraSkill, type Elite, type Plan, type ProdPriority, type TokenFlow, type OptimizeStep,
} from "./planner-engine";

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

  const effectiveOps = useMemo(() => visibleOps.map((op) => withElite(op, eliteById.get(op.id))), [visibleOps, eliteById]);
  const effectiveOpById = useMemo(() => new Map(effectiveOps.map((op) => [op.id, op])), [effectiveOps]);
  const roster = useMemo(() => effectiveOps.filter((op) => ownedIds.has(op.id)), [effectiveOps, ownedIds]);

  const persist = (ids: Set<string>, nextPlan: Plan | null, elite: Map<string, Elite> = eliteById, prio: ProdPriority = priority) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ owned: Array.from(ids), elite: Array.from(elite.entries()), plan: nextPlan, priority: prio })); } catch { /* ignore */ }
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
    const payload = JSON.stringify({ version: 1, exported: new Date().toISOString(), owned: Array.from(ownedIds), elite: Array.from(eliteById.entries()), plan }, null, 1);
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
        const plan = sanitizePlan(data.plan);
        setOwnedIds(ids);
        setEliteById(elite);
        if (plan) { setPlan(plan); setActiveShift(0); }
        persist(ids, plan, elite);
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
  // 세트 표시명은 L2 카탈로그(rules.json synergySets)의 name — KR 원문이 i18n 사전 키
  const SET_LABEL: Record<string, string> = Object.fromEntries((RULES.synergySets ?? []).map((def) => [def.key, def.name]));
  const stepMessage = (step: OptimizeStep): string => {
    if (step.phase === "base") return t("자동편성 엔진 계산 중 — 기본 편성 조립·전수 감사…");
    if (step.phase === "variant") return t("자동편성 엔진 계산 중 — 시너지 세트 후보안 {i}/{n} ({sets}) 평가…", { i: step.index ?? 0, n: step.total ?? 0, sets: (step.sets ?? []).map((key) => t(SET_LABEL[key] ?? key)).join("+") });
    if (step.index) return t("자동편성 엔진 계산 중 — 채택안 전수 감사 {crew}조 {i}/{n}회차 검수…", { crew: step.crew ?? "A", i: step.index, n: step.total ?? step.index });
    return t("자동편성 엔진 계산 중 — 최적안 비교·마무리 검증…");
  };

  const runOptimize = async (ids: Set<string> = ownedIds, elite: Map<string, Elite> = eliteById, prio: ProdPriority = priority) => {
    if (optimizing) return; // 중복 실행 방지
    // 페이싱 (사용자 확정 2026-07-19): 전체 소요는 3~5초 사이 랜덤, 단계 간격은 0.3~1.2초
    // 랜덤(딱딱한 정주기 금지) — 남은 예산 안에서만 지연해 총 시간이 목표를 넘지 않는다.
    // 실제 계산이 목표보다 오래 걸리면 그만큼 걸린다 (전수 비교가 우선).
    const targetMs = 3000 + Math.random() * 2000;
    const startedAt = performance.now();
    setOptimizing(t("자동편성 엔진 계산 중 — 편성 공간 구성…"));
    try {
      const paced = async (step: OptimizeStep) => {
        setOptimizing(stepMessage(step));
        const budget = targetMs - (performance.now() - startedAt);
        const delay = Math.min(300 + Math.random() * 900, Math.max(budget, 0));
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      };
      const next = await optimize(visibleOps.map((op) => withElite(op, elite.get(op.id))).filter((op) => ids.has(op.id)), prio, paced);
      const remain = targetMs - (performance.now() - startedAt);
      if (remain > 0) await new Promise((resolve) => setTimeout(resolve, remain));
      setPlan(next);
      setActiveShift(0);
      persist(ids, next, elite);
      // 실제 계산에 쓰인 인원 = 보유 ∩ 현재 표시 대상(미래시 토글 반영) — 미래시 OFF면 미실장 제외
      const usedCount = visibleOps.filter((op) => ids.has(op.id)).length;
      showToast(t("전체 자동편성을 실행했습니다 · 보유 {n}명 기준", { n: usedCount }));
    } finally {
      setOptimizing(null);
    }
  };

  // 우선 생산 모드는 설정(라디오)일 뿐 — 실제 편성은 기존처럼 자동편성 버튼으로 실행한다
  // (사용자 확정 2026-07: 설정 변경이 편성을 갈아엎으면 안 됨)
  const setPriority = (prio: ProdPriority) => {
    if (prio === priority) return;
    setPriorityState(prio);
    persist(ownedIds, plan, eliteById, prio);
    showToast(t("우선 생산 설정을 저장했습니다 — 다음 자동편성부터 적용됩니다"));
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
        const slots = infra.rooms[cell.room]?.slots ?? 1;
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
    const assignments: Record<string, string[][]> = Object.fromEntries(
      Object.entries(plan.assignments).map(([key, shifts]) => [key, shifts.map(() => [])])
    );
    const next = { ...plan, assignments, tokenPoints: {}, factionCounts: plan.factionCounts.map(() => ({})) };
    setPlan(next);
    setActiveShift(0);
    persist(ownedIds, next);
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
        if (data.priority) setPriorityState(data.priority as ProdPriority);
        // 손상·구버전 저장분 방어 — raw 복원은 assignments 등 누락 시 렌더 크래시
        // (개발 중간 상태가 저장된 localStorage에서 실제 발병, 2026-07-19). 정규화 실패면
        // 아래로 떨어져 새 편성을 만든다.
        if (data.plan) {
          const savedPlan = sanitizePlan(data.plan);
          if (savedPlan) { setPlan(savedPlan); if (!data.priority && savedPlan.priority) setPriorityState(savedPlan.priority); return; }
        }
        // 마운트 시점엔 미래시 토글이 아직 복원 전(false)일 수 있으므로 미실장은 제외하고
        // 기본 편성을 만든다 — 미래시 포함 편성은 토글 후 자동편성 버튼으로 실행
        void optimize(ops.filter((op) => !op.unreleased).map((op) => withElite(op, elite.get(op.id))).filter((op) => ids.has(op.id))).then(setPlan);
        return;
      }
    } catch { /* fall through to defaults */ }
    void optimize(ops.filter((op) => op.rarity <= 5 && !op.unreleased)).then(setPlan);
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

  const openCell = LAYOUT.find((cell) => cell.key === openRoom);

  return (
    <section className="planner">
      {confirmDialog}
      <div className="planner-controls">
        <div>
          <span className="section-no">{t("RIIC / 243 · 순금 2 + 작전기록 2 · 12시간 2조 교대")}</span>
          <h2>{t("인프라 배치 최적화")}</h2>
        </div>
        <div className="planner-buttons">
          <button onClick={() => setShowRoster(true)}><span className="btn-icon" aria-hidden>▦</span>{t("보유 오퍼 설정 ({a}/{b})", { a: visibleOps.filter((op) => ownedIds.has(op.id)).length, b: visibleOps.length })}</button>
          <button className="primary" onClick={() => runOptimize()} disabled={!!optimizing}><span className="btn-icon" aria-hidden>⟳</span>{optimizing ? t("계산 중…") : t("전체 자동편성")}</button>
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

      {optimizing && (
        <p className="opt-progress" role="status" aria-live="polite">
          <span className="opt-progress-spin" aria-hidden>⟳</span> {optimizing}
        </p>
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
      </div>

      {summary && (
        <div className="planner-summary">
          <button type="button" className="strategy-cell" onClick={() => setShowFlows(true)}>
            <span>{t("전략 (클릭해 시너지 트리 보기)")}</span>
            <b className="strategy">{plan ? strategyLabel(plan, locale, t) : summary.strategy}{plan && Object.keys(plan.tokenPoints).length > 0 && ` · ${Object.entries(plan.tokenPoints).map(([token, points]) => t("{token} {n}점", { token: tokenName(locale, token), n: Math.round(points) })).join(" · ")}`}</b>
          </button>
          <div><span>{t("제조소 평균")}</span><b>+{summary.manufacture}%</b></div>
          <div><span>{t("무역소 평균")}</span><b>+{summary.trading}%</b></div>
          <div><span>{t("발전소 평균")}</span><b>+{summary.power}%</b></div>
          <div><span>{t("기용 인원")}</span><b>{t("{n}명", { n: summary.staffed })}</b></div>
        </div>
      )}

      {plan && (
        <div className="shift-tabs">
          {Array.from({ length: SHIFT_COUNT }, (_, i) => (
            <button key={i} className={activeShift === i ? "selected" : ""} onClick={() => setActiveShift(i)}>{[t("A조 (풀파워)"), t("B조 (회복 교대)")][i]}</button>
          ))}
          <span className="shift-hint">{t("A조 컨디션 소진 시 B조 투입 · 시너지 세트는 A조 집중 · 숙소·고정 요원은 조 전환과 무관 · ")}<b>{t("숙소는 항상 5명 꽉 채워 유지")}</b></span>
        </div>
      )}

      <div className="ship">
        {LAYOUT.map((cell) => {
          if (cell.room === "DORMITORY") {
            const pinned = teamFor(cell.key, 0);
            return (
              <div key={cell.key} className={`ship-room dorm-room pos-${cell.key.toLowerCase()}`} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
                <div className="ship-room-head"><b>{t(cell.label)}</b><span>{t("고정")}</span></div>
                <div className="ship-room-crew">
                  {pinned.map((op) => <img key={op.id} src={op.image} alt={op.name} title={t("{name} 상세 정보", { name: op.name })} loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={() => onShowOperator?.(op.id)} />)}
                  <i>{pinned.length ? t("시너지 고정 + 휴식 공간") : t("휴식 공간 · 조 전환과 무관")}</i>
                </div>
              </div>
            );
          }
          const team = teamFor(cell.key, activeShift);
          const spec = infra.rooms[cell.room];
          const score = Math.round(teamScore(team, cell.room, ctxFor(cell.key, pointsFor(activeShift), plan?.factionCounts?.[activeShift], plan?.plants, presentIds, ambient)));
          // 제어센터 오라 수신분 — 카드 총점이 "오퍼 스킬 합과 달라 보이는" 이유를 명시
          // (플레임테일 B조: 작전기록 +30 / 순금 -30 등. 사용자 지적 2026-07-19)
          const ambientPart = score - Math.round(teamScore(team, cell.room, ctxFor(cell.key, pointsFor(activeShift), plan?.factionCounts?.[activeShift], plan?.plants, presentIds)));
          return (
            <button key={cell.key} type="button" className={`ship-room pos-${cell.key.toLowerCase()}`} onClick={() => setOpenRoom(cell.key)} style={{ "--room-accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
              <div className="ship-room-head">
                <b>{t(cell.label)}</b>
                <span>{team.length}/{spec?.slots ?? 1}</span>
              </div>
              <div className="ship-room-crew">
                {team.length ? team.map((op) => (
                  <img key={op.id} src={op.image} alt={op.name} title={op.name} loading="lazy" />
                )) : <i>{cell.key === "TRAINING" ? t("비워둠 · 특화 훈련 시 사용") : plan ? t("비어 있음") : t("자동 편성 대기")}</i>}
              </div>
              {plan && team.length > 0 && !PARK_KEYS.includes(cell.key) && (
                <small title={cell.room === "CONTROL"
                  ? t("오라 효과를 우선순위 가중치(제조소 ×10 > 무역소 ×2 > 인맥 ×0.6 > 단서 ×0.2)로 환산해 합한 비교용 점수입니다 — %가 아니며, 실제 효과는 대상 방 점수에 '오라' 수신분으로 더해집니다.")
                  : ambientPart !== 0 ? t("제어센터 오라 수신 {n} 포함 — 방을 눌러 상세 내역을 확인하세요", { n: `${ambientPart > 0 ? "+" : ""}${ambientPart}` }) : undefined}>
                  +{score}{cell.room === "CONTROL" ? "" : "%"} {cell.room === "CONTROL" ? t("오라 가중 점수") : t(UNIT[cell.room])}
                  {ambientPart !== 0 && cell.room !== "CONTROL" && <em className="ambient-note"> ({t("오라")} {ambientPart > 0 ? "+" : ""}{ambientPart})</em>}
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
          onUpdateTeam={updateTeam}
          eliteById={eliteById}
          onSetElite={setOperatorElite}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}

function RoomModal({ cell, plan, allAssigned, roster, opMap, initialShift, onClose, onShowOperator, onUpdateTeam, eliteById, onSetElite }: { cell: { key: string; room: string; label: string; product?: string }; plan: Plan; allAssigned: Set<string>; roster: InfraOp[]; opMap: Map<string, InfraOp>; initialShift: number; onClose: () => void; onShowOperator?: (id: string) => void; onUpdateTeam?: (cellKey: string, shiftIdx: number, ids: string[]) => void; eliteById: Map<string, Elite>; onSetElite: (id: string, elite: Elite) => void }) {
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
  const slots = infra.rooms[cell.room]?.slots ?? 1;
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
    acc["제어 오라(가중)"] += Object.keys(AURA_WEIGHT).reduce((sum, kind) => sum + (b.auras[kind] ?? 0) * AURA_WEIGHT[kind], 0);
    return acc;
  }, { "스킬 효율": 0, "시설 기반": 0, "자동화": 0, "품질 기대치": 0, "오더 수익": 0, "효율 오버라이드": 0, "동료 보너스": 0, "레어도 기본": 0, "제어 오라(가중)": 0 } as Record<string, number>);
  agg["제어센터 오라 수신"] = ambientFor(cell.room, team, ambient, agg["스킬 효율"], ctx.product);
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

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="operator-modal room-modal" role="dialog" aria-modal="true" style={{ "--accent": ROOM_ACCENT[cell.room] } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        <header className="room-modal-head">
          <span className="modal-kicker">FACILITY FILE · {cell.room}</span>
          <h2>{t(cell.label)}</h2>
          <div className="shift-tabs in-modal">
            {Array.from({ length: SHIFT_COUNT }, (_, i) => (
              <button key={i} className={shift === i ? "selected" : ""} onClick={() => setShift(i)}>{[t("A조"), t("B조")][i]}</button>
            ))}
          </div>
        </header>
        <div className="modal-scroll">
          {scored && (
            <section className="detail-section room-summary">
              <span className="detail-no">RESULT / 00</span>
              <h3>{t("종합 효율")}{cell.product ? ` · ${cell.product}` : ""} <b className="summary-total">+{currentScore}{cell.room === "CONTROL" ? "" : "%"}</b></h3>
              <div className="summary-parts">
                {Object.entries(agg).filter(([, value]) => Math.round(value) !== 0).map(([name, value]) => (
                  <span key={name}>{t(name)} <b>+{Math.round(value)}</b></span>
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
                if (Math.round(b.quality) !== 0) parts.push(t("고품질 확률 +{n}%p 상당", { n: Math.round(b.quality) }));
                if (Math.round(b.payout + b.payoutViolation) !== 0) parts.push(t("오더 수익 +{n}% 상당", { n: Math.round(b.payout + b.payoutViolation) }));
                if (b.override > 0) parts.push(t("효율 대체 인당 +{n}%", { n: Math.round(b.override) }));
                if (Math.round(b.perCoworker * (team.length - 1)) !== 0) parts.push(t("동료 보너스 +{n}%", { n: Math.round(b.perCoworker * (team.length - 1)) }));
                if (Math.round(b.clueBase) !== 0) parts.push(t("레어도 기본 {r}성·{e} +{n}%", { r: op.rarity, e: t(ELITE_LABEL[op.elite ?? maxElite(op.rarity)]), n: Math.round(b.clueBase) }));
                for (const [kind, value] of Object.entries(b.auras)) if (value > 0) parts.push(`${t(AURA_LABEL[kind] ?? kind)} +${Math.round(value)}%`);
                const shown = b.skills.length ? b.skills : op.skills.filter((skill) => skill.room === cell.room);
                return (
                  <article key={op.id} className="crew-card">
                    {onUpdateTeam && <button type="button" className="crew-remove" title={t("이 자리에서 빼기")} onClick={() => setIds(rawIds.filter((id) => id !== op.id))}>✕</button>}
                    <img src={op.image} alt={op.name} loading="lazy" className={onShowOperator ? "op-link" : undefined}
                      title={t("{name} 상세 정보", { name: op.name })} onClick={() => onShowOperator?.(op.id)} />
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
                      {shown.length ? shown.map((skill) => <p key={skill.name}><em>{skill.name}</em> — {skill.description}</p>) : <p>{t("이 시설에 적용되는 스킬이 없습니다 (세트 대기 요원).")}</p>}
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
                              <img src={sub.image} alt="" loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={(event) => { event.stopPropagation(); onShowOperator?.(sub.id); }} />{sub.name} <em>{score >= currentScore ? t("동급") : `-${currentScore - score}`}</em>
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
                        <img src={op.image} alt="" loading="lazy" className={onShowOperator ? "op-link" : undefined} onClick={(event) => { event.stopPropagation(); onShowOperator?.(op.id); }} />{op.name} <em>{delta >= 0 ? `+${delta}` : delta}</em>
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
    <img src={op.image} alt="" loading="lazy" className={onShowOperator ? "op-link" : undefined}
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
          <img src={op.image} alt={op.name} loading="lazy" className={onShowOperator ? "op-link" : undefined}
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
  // (정예화는 정예화 해금 스킬이 있는 오퍼에만 적용, 3성 이하는 2정이 없어 보유/해제만)
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
            <button type="button" className="apply" onClick={() => onApply(draft, eliteDraft)}><span className="btn-icon" aria-hidden>⟳</span>{t("적용 및 자동편성 실행")}</button>
          </div>
        </header>
        <div className="modal-scroll">
          {importMsg && <p className="dorm-note maa-import-msg">{importMsg}</p>}
          <p className="dorm-note">{rich(t("정예화 단계에 따라 해금되는 인프라 스킬을 가진 오퍼는 카드 아래에서 **노정예/1정/2정**을 선택할 수 있습니다 (기본값 최대 정예화). 얼굴을 클릭하면 상세 정보가 열립니다."))}</p>
          {allOps.some((op) => op.unreleased) && (
            <p className="dorm-note">{rich(t("**미실장** 배지가 붙은 오퍼는 한국 서버 미출시(중국 서버 선행) 오퍼입니다 — 미래시 데이터 포함이 켜져 있을 때만 표시되며, 스킬 텍스트는 비공식 AI 번역입니다."))}</p>
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
              <h4 className="roster-section-head">{t("한국 서버 출시")} <em>{releasedOps.length}</em></h4>
            </>
          )}
          <div className="roster-grid">{releasedOps.map(renderCard)}</div>
        </div>
      </section>
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
    "'전체 자동편성'은 처음부터 다시 계산하고, '빈 자리만 자동편성'은 현재 편성(수동 수정 포함)을 유지한 채 남은 빈 자리만 한계 기여 순으로 채웁니다.",
  ]},
  { title: "방 우선순위", items: [
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
    "보유 오퍼 설정에서 오퍼별로 기본값(2정 · 정예화 2)을 1정으로 낮출 수 있습니다. 정예화 2에서 해금되는 인프라 스킬을 가진 오퍼만 선택지가 보입니다.",
    "1정으로 지정하면 해당 오퍼는 정예화 2 전용 스킬 없이 계산·자동편성됩니다 — 아직 승급 못 한 오퍼를 과대평가하지 않도록 맞춰 두세요.",
  ]},
  { title: "대체 추천", items: [
    "각 자리의 대체 후보는 실제로 교체해 본 방 점수로 순위를 매기고, 동점이면 낮은 성급(육성 저렴)을 우선합니다.",
    "토큰 생성·소비자, 오버라이드·수익 역할, 쉐이 카운트 인원 같은 시너지 코어는 '대체 불가'로 표시됩니다.",
  ]},
  { title: "미래시(미실장) 오퍼", items: [
    "헤더의 '미래시 데이터 포함'을 켜면 한국 서버 미출시(중국 서버 선행) 오퍼도 보유 오퍼 설정과 자동편성 계산에 포함됩니다. 스킬 텍스트는 비공식 AI 번역이며, 한국 서버 정식 출시 시 공식 데이터로 대체됩니다.",
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
