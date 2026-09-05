"use client";
// 위수 협의 **한 판 스토어** — 게임 연결이 화면에서 읽어 온 것이 모이는 곳 (2026-09-06).
//
// 왜 (사용자 요청 2026-09-06 "한판 하면서 필요한 정보들을 유지하게"):
// 한 판에 필요한 정보는 화면에서 순식간에 사라진다 — 밴 목록은 시작 화면 25초
// (enterStepList.INFO_CHECK)뿐이고, 상대 전략도 그때뿐이며, 내 중첩 수는 매 라운드 바뀐다.
// 그 사이에 전략까지 골라야 해서 손으로 받아적을 틈이 없다. 그래서 사람이 넣지 않고 읽는다.
//
// ⚠ **React 상태가 아니라 모듈 스토어**인 이유: 사용자가 덱편성 모달을 닫고 맹약을 검색하거나
//   기물을 필터링하는 동안에도 값이 살아 있어야 한다 (사용자 확정 2026-09-06 "강제로 계속
//   덱빌드 모달을 계속 띄우는건 좀 그렇긴 하네"). 모달·페이지·스트립이 같은 스냅샷을 본다.
//
// 저장은 sessionStorage — **판 하나 = 탭 세션 하나**. 새로고침해도 이어지고, 탭을 닫으면
// 지워진다. localStorage 로 하면 며칠 전 판의 중첩이 남아 조용히 틀린 계산을 한다.

import { useSyncExternalStore } from "react";

/** PRTS 링크 잠금 토픽 — 이게 걸려 있으면 위수 협의로 연결된 것이다.
 *  /rogue 에서 연결한 상태와 구분하기 위한 표식일 뿐, 인식 범위를 나누지 않는다. */
export const AC_LOCK = "autochess";
export const isAcLock = (topic?: string): boolean => topic === AC_LOCK;

/** 독립(싱글) / 멀티 — **버튼으로 고르지 않는다.** 화면에서 알아낸다
 *  (사용자 확정 2026-09-06 "그냥 화면인식으로 정할 수 있을거 같으니 굳이 나누지 말자").
 *  상대 자리(seat ≥ 1)의 전략이 하나라도 잡히면 멀티다. */
export type AcMode = "single" | "multi";
export const acModeOf = (run: AcRun): AcMode | null =>
  run.bands.some((b) => b.seat > 0) ? "multi" : run.at ? "single" : null;

export type AcRun = {
  /** 맹약 id → 중첩 수 — 화면의 맹약 원형에서 읽는다 */
  stacks: Record<string, number>;
  /** 밴된 기물 chessId — '사용 제한 오퍼레이터' 화면에서 누적.
   *  스크롤하며 여러 프레임으로 들어오므로 **합집합**으로 쌓아야 한다. */
  bans: string[];
  /** 자리별 전략 — seat 0 = 나, 1~3 = 상대 (멀티 전용) */
  bands: { seat: number; band: string }[];
  /** 배치 가능 인원 — 화면의 n/8 · n/9. **분모가 9면 인사부 파일을 쓴 것**이다
   *  (사용자 확정 2026-09-06). max 가 9로 바뀌면 9번째 칸을 열어 준다. */
  deploy: { cur: number; max: number } | null;
  /** 마지막 인식 시각 (epoch ms) — 0이면 아직 아무것도 못 읽음 */
  at: number;
};

const EMPTY: AcRun = { stacks: {}, bans: [], bands: [], deploy: null, at: 0 };
const KEY = "ta-ac-run";

let run: AcRun = EMPTY;
let loaded = false;
const subs = new Set<() => void>();

function emit(): void { for (const f of subs) f(); }

function persist(): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(run)); } catch { /* 사생활 모드 등 — 메모리로만 */ }
}

/** 첫 접근에서 세션 저장본을 복구한다 (SSR 에서는 아무것도 안 한다). */
function hydrate(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    const d = JSON.parse(raw) as Partial<AcRun>;
    run = {
      stacks: d.stacks && typeof d.stacks === "object" ? d.stacks : {},
      bans: Array.isArray(d.bans) ? d.bans : [],
      bands: Array.isArray(d.bands) ? d.bands : [],
      deploy: d.deploy && typeof d.deploy.max === "number" ? d.deploy : null,
      at: typeof d.at === "number" ? d.at : 0,
    };
  } catch { /* 깨진 저장본은 버린다 */ }
}

export function acRun(): AcRun { hydrate(); return run; }

/** 인식 결과 병합.
 *  ⚠ **덮어쓰기가 아니라 병합**이다. 화면에는 그때 보이는 맹약만 떠 있으므로(원형 몇 개),
 *  안 보이는 맹약의 값을 지우면 스크롤할 때마다 값이 깜빡인다.
 *  연결 중에는 손 입력이 잠기므로(autochess.tsx acLocked) 별도의 일시정지 장치는 두지 않는다 —
 *  "연결되면 인식된 내용만 자동으로 바뀐다"가 규약이다 (사용자 확정 2026-09-06). */
export function mergeAcRun(patch: {
  stacks?: Record<string, number>;
  bans?: string[];
  bands?: { seat: number; band: string }[];
  deploy?: { cur: number; max: number } | null;
}): boolean {
  hydrate();
  const stacks = { ...run.stacks, ...(patch.stacks ?? {}) };
  const bans = patch.bans?.length ? [...new Set([...run.bans, ...patch.bans])] : run.bans;
  // 전략은 자리(seat)로 덮어쓴다 — 같은 자리를 다시 읽으면 최신이 이긴다
  let bands = run.bands;
  if (patch.bands?.length) {
    const by = new Map(run.bands.map((b) => [b.seat, b.band]));
    for (const b of patch.bands) by.set(b.seat, b.band);
    bands = [...by].map(([seat, band]) => ({ seat, band })).sort((a, b) => a.seat - b.seat);
  }
  const deploy = patch.deploy !== undefined ? patch.deploy : run.deploy;
  const sameBands = bands === run.bands;
  const sameDeploy = deploy?.cur === run.deploy?.cur && deploy?.max === run.deploy?.max;
  const same = bans === run.bans && sameBands && sameDeploy
    && Object.keys(stacks).length === Object.keys(run.stacks).length
    && Object.entries(stacks).every(([k, v]) => run.stacks[k] === v);
  if (same) return false;                      // 값이 그대로면 리렌더를 만들지 않는다
  run = { stacks, bans, bands, deploy, at: Date.now() };
  persist();
  emit();
  return true;
}

/** 손으로 넣은 중첩 — 인식과 같은 스토어에 쓴다 (writer 를 하나로 모은다).
 *  일시정지 여부와 무관하게 언제나 반영된다. */
export function setAcStack(bondId: string, n: number | null): void {
  hydrate();
  const stacks = { ...run.stacks };
  if (n === null || !Number.isFinite(n)) delete stacks[bondId];
  else stacks[bondId] = n;
  run = { ...run, stacks };
  persist();
  emit();
}

/** 여러 맹약 중첩을 한 번에 (해시 링크 복원용) — at 을 건드리지 않는다(인식이 아니므로). */
export function setAcStacks(stacks: Record<string, number>): void {
  hydrate();
  run = { ...run, stacks };
  persist();
  emit();
}

/** 새 판 — '시뮬레이션 정보' 화면을 인식하면 자동 호출된다.
 *  지난 판의 중첩이 새 판에 새면 조용히 틀린 계산이 나온다 (run.ts resetGradeCache 와 같은 규약). */
export function resetAcRun(): void {
  hydrate();
  if (run.at === 0 && !Object.keys(run.stacks).length && !run.bans.length
    && !run.bands.length && !run.deploy) return;
  run = { stacks: {}, bans: [], bands: [], deploy: null, at: 0 };
  persist();
  emit();
}

function subscribe(f: () => void): () => void {
  hydrate();
  subs.add(f);
  return () => { subs.delete(f); };
}

/** 스토어 구독 훅 — 모달·페이지·스트립이 같은 값을 본다.
 *  서버 스냅샷은 EMPTY 고정 (sessionStorage 는 브라우저에만 있다 — 하이드레이션 불일치 방지). */
export function useAcRun(): AcRun {
  return useSyncExternalStore(subscribe, acRun, () => EMPTY);
}
