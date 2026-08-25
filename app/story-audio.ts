"use client";

// 스토리 리더 오디오 — **효과음만** 소리로 낸다.
//
// 대본(build-story-scripts.py 의 `au` 트랙)은 BGM·효과음을 모두 지시하지만, 여기서
// 재생하는 것은 효과음뿐이다. 음악은 Monster Siren Records 가 별도 상품으로 내는 것이라
// 재호스팅하지 않는다 (scripts/build-story-sfx.py 머리말 참조). 효과음은 0.5~4초짜리
// 기능적 클립이라 배경·스탠딩과 같은 선에 둔다.
//
// 에셋: /story/sfx/<키>.m4a — public/story 밑이라 R2 로 나가고 Pages 파일 수에 안 잡힌다.
// AAC 96kbps 로 구웠다 (iOS 사파리까지 되는 무난한 선택 — Opus 는 더 작지만 지원이 들쭉날쭉).
//
// ⚠ 브라우저 자동재생 정책: 사용자 제스처 **전에는** play() 가 거부된다. 그래서 기본은
//   꺼짐이고, 리더의 '소리' 버튼을 누르는 그 클릭이 첫 제스처가 된다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { asset } from "./assets";

export type AuSound = [string] | [string, number];
export type AuCue = {
  i: number;
  /** BGM — [intro|null, loop] 로 시작, 0 이면 정지. **소리로는 내지 않는다** */
  m?: [string | null, string] | 0;
  /** BGM 음량 (m 없이 오면 현재 곡 음량 변경) */
  mv?: number;
  /** 크로스페이드 초 */
  cf?: number;
  /** 효과음 — [키, 음량?] 목록 */
  s?: AuSound[];
  /** 효과음 전부 정지 */
  ss?: 1;
};

const STORE_KEY = "ta-story-sfx";
/** 동시에 울릴 수 있는 효과음 수 — 발소리 연타가 겹쳐도 이 정도면 충분하다 */
const POOL = 8;

/** 한 번 404 난 키는 다시 안 부른다 (대본이 부르지만 클립이 아닌 이벤트명이 10종쯤 있다) */
const dead = new Set<string>();

function readPref(): { on: boolean; vol: number } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { on?: boolean; vol?: number };
      return { on: !!v.on, vol: typeof v.vol === "number" ? v.vol : 0.7 };
    }
  } catch { /* 프라이빗 창·차단 설정 — 기본값으로 */ }
  return { on: false, vol: 0.7 };
}

/** 효과음 재생기 — 리더가 줄을 넘길 때마다 그 줄의 큐를 울린다. */
export function useStorySfx(au: AuCue[] | undefined, idx: number) {
  const [pref, setPref] = useState<{ on: boolean; vol: number }>({ on: false, vol: 0.7 });
  const poolRef = useRef<HTMLAudioElement[]>([]);
  const turnRef = useRef(0);

  // 첫 렌더는 서버와 같아야 하므로(하이드레이션) 저장값은 마운트 후에 읽는다
  useEffect(() => { setPref(readPref()); }, []);

  const save = useCallback((next: { on: boolean; vol: number }) => {
    setPref(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* 저장 못 해도 그만 */ }
  }, []);

  const byLine = useMemo(() => {
    const m = new Map<number, AuCue>();
    for (const c of au ?? []) m.set(c.i, c);
    return m;
  }, [au]);

  const stopAll = useCallback(() => {
    for (const a of poolRef.current) { try { a.pause(); a.currentTime = 0; } catch { /* noop */ } }
  }, []);

  const fire = useCallback((key: string, vol: number) => {
    if (dead.has(key)) return;
    const pool = poolRef.current;
    let el = pool.find((a) => a.paused || a.ended);
    if (!el) {
      if (pool.length < POOL) { el = new Audio(); pool.push(el); }
      else { el = pool[turnRef.current++ % pool.length]; }   // 가장 오래된 것을 밀어낸다
    }
    el.src = asset(`/story/sfx/${key}.m4a`);
    el.volume = Math.max(0, Math.min(1, vol));
    el.currentTime = 0;
    void el.play().catch(() => { dead.add(key); });          // 404·정책 거부 — 조용히 포기
  }, []);

  // 줄이 바뀔 때 그 줄의 효과음을 울린다. 되돌아갔다 다시 오면 다시 울린다(게임과 같다).
  useEffect(() => {
    if (!pref.on) return;
    const cue = byLine.get(idx);
    if (!cue) return;
    if (cue.ss) stopAll();
    for (const s of cue.s ?? []) {
      const [key, v] = s;
      if (key) fire(key, (typeof v === "number" ? v : 1) * pref.vol);
    }
  }, [idx, pref.on, pref.vol, byLine, fire, stopAll]);

  // 끄면 즉시 조용해진다 · 화면을 떠나도 소리가 남지 않게
  useEffect(() => { if (!pref.on) stopAll(); }, [pref.on, stopAll]);
  useEffect(() => () => {
    for (const a of poolRef.current) { try { a.pause(); a.src = ""; } catch { /* noop */ } }
    poolRef.current = [];
  }, []);

  /** 이 에피소드에 울릴 효과음이 하나라도 있나 — 없으면 버튼을 띄우지 않는다 */
  const hasSfx = useMemo(() => (au ?? []).some((c) => (c.s?.length ?? 0) > 0), [au]);

  return {
    on: pref.on, vol: pref.vol, hasSfx,
    toggle: () => save({ ...pref, on: !pref.on }),
    setVol: (v: number) => save({ ...pref, vol: v }),
  };
}

/** 이 줄에서 흐르고 있는 BGM 의 loop 키 (없으면 null).
 *  소리는 내지 않는다 — 음악이 흐르는 구간인지 안내문에 쓰려고 둔다. */
export function bgmAt(au: AuCue[] | undefined, idx: number): string | null {
  let cur: string | null = null;
  for (const c of au ?? []) {
    if (c.i > idx) break;
    if (c.m === 0) cur = null;
    else if (Array.isArray(c.m)) cur = c.m[1] ?? null;
  }
  return cur;
}
