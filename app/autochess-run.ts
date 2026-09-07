"use client";
// 위수 협의 **한 판 스토어** — 게임 연결이 화면에서 읽어 온 것이 모이는 곳 (2026-09-06, 2026-09-07 재가동·확장).
//
// 왜 (사용자 요청 2026-09-06 "한판 하면서 필요한 정보들을 유지하게"):
// 한 판에 필요한 정보는 화면에서 순식간에 사라진다 — 밴 목록은 시작 화면 25초
// (enterStepList.INFO_CHECK)뿐이고, 상대 전략도 그때뿐이며, 내 중첩 수는 매 라운드 바뀐다.
// 그 사이에 전략까지 골라야 해서 손으로 받아적을 틈이 없다. 그래서 사람이 넣지 않고 읽는다.
//
// 2026-09-07 재가동 (사용자 재요청 — 실플레이 녹화 2편 제공, "포기하기 힘들다"): 시뮬레이션 종류(mode)·
// 내/상대 전략(bands)·얼굴로 확정한 밴 기물(banVotes)·남은 배치 칸(deployLeft)·목표 HP·본 기물(pieces)이 늘었다.
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

/** 독립 / 연합 — **버튼으로 고르지 않는다.** 화면에서 알아낸다.
 *  둘 다 게임 자신의 용어다 (메인 화면이 '독립 시뮬레이션' 과 '연합 시뮬레이션' 으로 가르고,
 *  연합 아래에 동맹 시뮬레이션·파티 매칭이 있다). 내부 값은 게임 데이터의 modeType 그대로.
 *  (사용자 확정 2026-09-06 "그냥 화면인식으로 정할 수 있을거 같으니 굳이 나누지 말자").
 *  판정 근거는 '전략 정보' 화면 왼쪽의 참가자 카드 수 — 한 명이면 독립, 여럿이면 연합.
 *  ⚠ 900px 판에서 '#1234' 의 # 이 1 로 읽혀 parseSeats 가 0/9 였다 (2026-09-07 실측) —
 *  상대 전략(seat>0)이 하나라도 잡히면 그것도 연합의 근거로 삼는다.
 *  아직 아무 근거가 없으면 null (모르는 걸 아는 척하지 않는다). */
export type AcMode = "single" | "multi";
export const acModeOf = (run: AcRun): AcMode | null => {
  const seats = Math.max(run.seats, run.bands.some((b) => b.seat > 0) ? 2 : 0);
  return !seats ? null : seats > 1 ? "multi" : "single";
};

/** 밴 표 — 이 값 이상이면 '확정', 0 초과 미만이면 '후보'. 한 프레임의 마진 ≥ BAN_MARGIN_SURE 가 표 1이다. */
export const BAN_VOTE_SURE = 1;
/** 얼굴 매칭 마진(1위−2위 HOG 코사인) 이 이 이상이면 그 프레임만으로 확정 — 실측(2026-09-07, 294카드)
 *  후보 제한 시 정답 마진 중앙값 0.21·오답 0건, 후보가 하나면 마진 1 이라 즉시 확정된다. */
export const BAN_MARGIN_SURE = 0.12;

export type AcRun = {
  /** 맹약 id → 중첩 수 — 화면의 맹약 원형에서 읽는다 */
  stacks: Record<string, number>;
  /** 밴 관측 — 맹약 id → 그 행에 보인 티어 목록. **밴된 기물 자체가 아니라 관측을 쌓는다.**
   *  얼굴로 못 가른 자리(초상 없는 기물 등)는 (맹약, 티어) 조합으로 역산한다 — 풀이는 lens/acsolve.ts.
   *  스크롤하며 여러 프레임으로 들어오므로 **(맹약, 티어)마다 최댓값**으로 쌓는다:
   *  한 프레임에 다 보인 행이 그 맹약의 완전한 목록이고, 잘려 덜 보인 프레임은 부분집합이다. */
  banObs: Record<string, number[]>;
  /** 화면에서 **본** 맹약 줄 → 그 줄에서 본 카드 수 (맹약별 최댓값).
   *  banObs 와 다른 점: **불완전한 행도 여기엔 들어간다.** 5장 행이 화면 맨 아래에 오면 '준비 완료'
   *  버튼이 6번째 열을 가려 완전한 관측이 못 되는데(acvision cut ③), 그렇다고 "이 줄을 봤다" 는 사실을
   *  버리면 그 맹약 그룹이 화면에서 통째로 사라진다 (사용자 신고 2026-09-07 "시라쿠사 맹약 밴목록이
   *  인식이 안됐네"). 그룹 목록·"확정/본 카드" 분모는 이 값을 쓰고, 조합 풀이는 banObs 만 쓴다. */
  banSeen: Record<string, number>;
  /** **손으로 넣은** 맹약 중첩 — 덱편성 시뮬레이터(계획용)의 값. 위 stacks(인식값)와 **섞지 않는다**.
   *  사용자 확정 2026-09-07: "덱편성 시뮬레이터랑 PRTS에서 나오는 시뮬레이터는 서로 별도로 데이터가
   *  들어가야 함. 공유하면 안됨" — 계획한 편성을 옆에 띄워 놓고 실제 판을 PRTS 로 따라가기 때문이다.
   *  해시 링크(?st=)에 실리는 것도 이쪽이다 (공유하는 건 계획이다). */
  manual: Record<string, number>;
  /** 밴 기물 — 얼굴 매칭으로 확정한 chess 기본형 id → 누적 표. 프레임마다 마진을 표로 바꿔 더한다
   *  (마진 ≥ BAN_MARGIN_SURE 면 1표, 아니면 그 비율). 줄어들지 않는다 — resetAcRun 만 비운다. */
  banVotes: Record<string, number>;
  /** 자리별 전략 — seat 0 = 나, 1~3 = 상대 (연합 전용). final=false 는 고르는 중(미리보기) */
  bands: { seat: number; band: string; final?: boolean }[];
  /** 참가자 수 — '전략 정보' 화면의 참가자 카드 수. 0 = 아직 그 화면을 못 봤다 */
  seats: number;
  /** 남은 배치 칸 — 화면의 '배치 가능 인원:N'. null = 아직 못 읽음 */
  deployLeft: number | null;
  /** 최대 배치 9 (인사부 파일) 를 봤다 — 남은 칸이 9 로 찍히면 그 판은 9칸이다 (사용자 확정 2026-09-06) */
  deploy9: boolean;
  /** 시뮬레이션 종류 코드 (AC-1~4 · AC-TR-1). 판 안에서 바뀌지 않으므로 non-null 만 반영 */
  mode: string | null;
  /** 목표 HP — HUD 상단 (판 내 불변) */
  hp: number | null;
  /** 화면에서 이름을 읽은 기물·장비 — id → 본 횟수 (정보용) */
  pieces: Record<string, number>;
  /** 마지막으로 가른 화면 종류 */
  screen: string | null;
  /** 마지막 인식 시각 (epoch ms) — 0이면 아직 아무것도 못 읽음 */
  at: number;
};

const EMPTY: AcRun = { stacks: {}, banObs: {}, banSeen: {}, manual: {}, banVotes: {}, bands: [], seats: 0, deployLeft: null, deploy9: false,
  mode: null, hp: null, pieces: {}, screen: null, at: 0 };
const KEY = "ta-ac-run";

let run: AcRun = EMPTY;
let loaded = false;
const subs = new Set<() => void>();

function emit(): void { for (const f of subs) f(); }

/** 티어 목록 → 티어별 개수 */
const tally = (ts: number[]): Map<number, number> => {
  const m = new Map<number, number>();
  for (const t of ts) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
};
/** 티어별 개수 → 티어 목록 (내림차순) */
const expand = (m: Map<number, number>): number[] => {
  const out: number[] = [];
  for (const [t, n] of [...m].sort((a, b) => b[0] - a[0])) for (let i = 0; i < n; i++) out.push(t);
  return out;
};

function persist(): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(run)); } catch { /* 사생활 모드 등 — 메모리로만 */ }
}

const numMap = (v: unknown): Record<string, number> => {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  return out;
};

/** 첫 접근에서 세션 저장본을 복구한다 (SSR 에서는 아무것도 안 한다). */
function hydrate(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    const d = JSON.parse(raw) as Partial<AcRun> & { deploy?: { cur: number; max: number } | null };
    run = {
      stacks: numMap(d.stacks),
      banObs: d.banObs && typeof d.banObs === "object" ? d.banObs : {},
      banSeen: numMap(d.banSeen),
      manual: numMap(d.manual),
      banVotes: numMap(d.banVotes),
      bands: Array.isArray(d.bands) ? d.bands.filter((b) => b && typeof b.seat === "number" && typeof b.band === "string") : [],
      seats: typeof d.seats === "number" ? d.seats : 0,
      deployLeft: typeof d.deployLeft === "number" ? d.deployLeft : null,
      // 옛 저장본(2026-09-06 형식 deploy.max) 도 받아 준다 — 9 였으면 인사부 파일
      deploy9: d.deploy9 === true || d.deploy?.max === 9,
      mode: typeof d.mode === "string" ? d.mode : null,
      hp: typeof d.hp === "number" ? d.hp : null,
      pieces: numMap(d.pieces),
      screen: typeof d.screen === "string" ? d.screen : null,
      at: typeof d.at === "number" ? d.at : 0,
    };
  } catch { /* 깨진 저장본은 버린다 */ }
}

export function acRun(): AcRun { hydrate(); return run; }

export type AcRunPatch = {
  stacks?: Record<string, number>;
  banObs?: Record<string, number[]>;
  banSeen?: Record<string, number>;
  bans?: { id: string; margin: number }[];
  bands?: { seat: number; band: string; final?: boolean }[];
  /** bands 의 상대 자리(seat>0)가 **참가자 줄을 통째로 다시 읽은 결과**인가 — 그렇다면 갈아 끼운다 */
  bandRows?: boolean;
  seats?: number;
  deployLeft?: number | null;
  mode?: string | null;
  hp?: number | null;
  pieces?: { id: string }[];
  screen?: string | null;
};

const sameNumMap = (a: Record<string, number>, b: Record<string, number>): boolean =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);

/** 인식 결과 병합.
 *  ⚠ **덮어쓰기가 아니라 병합**이다. 화면에는 그때 보이는 맹약만 떠 있으므로(원형 몇 개),
 *  안 보이는 맹약의 값을 지우면 스크롤할 때마다 값이 깜빡인다.
 *  필드별 규약 (2026-09-07):
 *    stacks 맹약별 최신 · banObs (맹약,티어) 최댓값 · banVotes 누적(줄지 않음) · bands 자리별 최신,
 *    단 확정(final) 을 미리보기(final=false) 가 덮지 않음 · seats 최댓값 · deployLeft 최신 non-null ·
 *    deploy9 OR · mode/hp 최신 non-null · pieces 누적 · screen 최신 non-null. 비우는 건 resetAcRun 만.
 *  연결 중에는 손 입력이 잠기므로(autochess.tsx acLocked) 별도의 일시정지 장치는 두지 않는다 —
 *  "연결되면 인식된 내용만 자동으로 바뀐다"가 규약이다 (사용자 확정 2026-09-06). */
export function mergeAcRun(patch: AcRunPatch): boolean {
  hydrate();
  const stacks = { ...run.stacks, ...(patch.stacks ?? {}) };
  // 밴 관측 누적 — **(맹약, 티어)마다 최댓값**. 스크롤하면 같은 행이 여러 프레임에 걸쳐
  // 덜 보였다 다 보였다 하는데, 최댓값을 쥐면 가장 많이 보인 프레임이 남는다.
  let banObs = run.banObs;
  if (patch.banObs && Object.keys(patch.banObs).length) {
    banObs = { ...run.banObs };
    for (const [bd, tiers] of Object.entries(patch.banObs)) {
      const cur = tally(banObs[bd] ?? []);
      const inc = tally(tiers);
      let grew = !banObs[bd];
      for (const [t, n] of inc) if (n > (cur.get(t) ?? 0)) { cur.set(t, n); grew = true; }
      if (grew) banObs[bd] = expand(cur);
    }
  }
  // 본 맹약 줄 — 줄마다 **본 카드 수의 최댓값** (스크롤하며 덜 보였다 다 보였다 하므로)
  let banSeen = run.banSeen;
  if (patch.banSeen && Object.keys(patch.banSeen).length) {
    banSeen = { ...run.banSeen };
    for (const [bd, n] of Object.entries(patch.banSeen)) if (n > (banSeen[bd] ?? 0)) banSeen[bd] = n;
  }
  // 얼굴 확정 밴 — 표 누적. 한 프레임에 같은 기물이 둘 이상 나오면(여러 맹약 행) 그중 큰 마진 하나만 센다
  let banVotes = run.banVotes;
  if (patch.bans?.length) {
    banVotes = { ...run.banVotes };
    const best = new Map<string, number>();
    for (const b of patch.bans) best.set(b.id, Math.max(best.get(b.id) ?? 0, b.margin));
    for (const [id, m] of best) banVotes[id] = (banVotes[id] ?? 0) + Math.min(1, Math.max(0, m) / BAN_MARGIN_SURE);
  }
  // 전략은 자리(seat)로 덮어쓴다 — 같은 자리를 다시 읽으면 최신이 이긴다. 단 확정을 미리보기가 덮지 않는다.
  // ⚠ 참가자 줄을 읽은 패치(bandRows)면 **상대 자리를 통째로 갈아 끼운다**. 자리 번호는 '전략을 고른
  //   줄' 중의 순서라, 누가 새로 고르면 그 아래 줄들이 한 칸씩 밀린다 — 자리별로 병합하면 밀려나기 전
  //   값이 유령 자리로 남아 없는 참가자가 하나 더 생긴다. 화면이 그때그때 다 보여주므로 누적할 이유도 없다.
  //   내 자리(0)는 우측 패널도 쓰는 자리라 남긴다.
  let bands = run.bands;
  if (patch.bands?.length) {
    const keep = patch.bandRows ? run.bands.filter((b) => b.seat === 0) : run.bands;
    const by = new Map(keep.map((b) => [b.seat, b]));
    for (const b of patch.bands) {
      const cur = by.get(b.seat);
      if (cur?.final && !b.final) continue;
      by.set(b.seat, { seat: b.seat, band: b.band, final: !!b.final });
    }
    bands = [...by.values()].sort((a, b) => a.seat - b.seat);
  }
  // 참가자 수는 **줄어들지 않는다** — 전략 정보 화면을 스크롤하면 카드가 화면 밖으로
  // 나가면서 덜 잡히는데, 그때마다 연합이 독립으로 바뀌면 안 된다.
  const seats = Math.max(run.seats, patch.seats ?? 0);
  const deployLeft = typeof patch.deployLeft === "number" ? patch.deployLeft : run.deployLeft;
  const deploy9 = run.deploy9 || (typeof patch.deployLeft === "number" && patch.deployLeft >= 9);
  const mode = patch.mode ?? run.mode;
  const hp = typeof patch.hp === "number" ? patch.hp : run.hp;
  let pieces = run.pieces;
  if (patch.pieces?.length) {
    pieces = { ...run.pieces };
    for (const p of new Set(patch.pieces.map((x) => x.id))) pieces[p] = (pieces[p] ?? 0) + 1;
  }
  const screen = patch.screen ?? run.screen;
  const same = banObs === run.banObs && banSeen === run.banSeen && bands === run.bands && banVotes === run.banVotes && pieces === run.pieces
    && seats === run.seats && deployLeft === run.deployLeft && deploy9 === run.deploy9 && mode === run.mode
    && hp === run.hp && screen === run.screen && sameNumMap(stacks, run.stacks);
  if (same) return false;                      // 값이 그대로면 리렌더를 만들지 않는다
  run = { stacks, banObs, banSeen, manual: run.manual, banVotes, bands, seats, deployLeft, deploy9, mode, hp, pieces, screen, at: Date.now() };
  persist();
  emit();
  return true;
}

/** 손으로 넣은 중첩 — **manual 에만** 쓴다. 인식값(stacks)과 섞지 않는다 (위 manual 주석).
 *  ⚠ 2026-09-06~07 에는 둘이 같은 곳에 썼다. 그러면 계획한 편성과 실제 판이 한 값을 다투게 되고,
 *  PRTS 를 켠 순간 손으로 넣어 둔 중첩이 인식값에 덮인다 — 사용자가 그래서 분리를 지시했다. */
export function setAcStack(bondId: string, n: number | null): void {
  hydrate();
  const manual = { ...run.manual };
  if (n === null || !Number.isFinite(n)) delete manual[bondId];
  else manual[bondId] = n;
  run = { ...run, manual };
  persist();
  emit();
}

/** 여러 맹약 중첩을 한 번에 (해시 링크 복원용) — 계획값이므로 manual 이다. at 은 건드리지 않는다. */
export function setAcStacks(manual: Record<string, number>): void {
  hydrate();
  run = { ...run, manual };
  persist();
  emit();
}

/** 새 판 — '시뮬레이션 정보' 화면을 인식하면 자동 호출된다.
 *  지난 판의 중첩이 새 판에 새면 조용히 틀린 계산이 나온다 (run.ts resetGradeCache 와 같은 규약). */
export function resetAcRun(): void {
  hydrate();
  if (run.at === 0 && !Object.keys(run.stacks).length && !Object.keys(run.banObs).length && !Object.keys(run.banVotes).length
    && !run.bands.length && run.deployLeft === null && !run.seats && !run.mode) return;
  // ⚠ 손으로 넣은 중첩(manual)은 **남긴다** — 새 판이 시작됐다고 사용자가 계획해 둔 편성을 지우면 안 된다
  run = { ...EMPTY, manual: run.manual };
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
