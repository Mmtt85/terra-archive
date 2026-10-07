"use client";

import { useState } from "react";
import { asset } from "./assets";
import dynList from "./data/skin-dyn.json";

// 움직이는 일러스트(게임 Spine dyn_illust) — 스킨마다 대기 동작 한 바퀴를 투명 영상(webm)으로 구워
// R2 /skin/dyn/<portrait>.{webm,webp} 에 둔다 (사용자 지시 2026-10-07 "움직이는 건 전부 움직이게").
// 굽는 절차는 scripts/README.md §7.8. 목록 = app/data/skin-dyn.json (구운 portrait 이름).
// 영상 구도는 정지 전체 일러스트와 다르다(장면 전체·자동 맞춤) — 그래서 대신 띄울 정지 그림도
// 영상 첫 프레임(.webp)을 쓴다. 겹쳐 둔 정지 그림은 영상이 살아나면 감춘다(움직이는 자리 뒤로 비치면 잔상).
const SET = new Set(dynList as string[]);
export const hasDyn = (portrait: string) => SET.has(portrait);
const base = (portrait: string) => asset(`/skin/dyn/${encodeURIComponent(portrait)}`);
export const dynPoster = (portrait: string) => `${base(portrait)}.webp`;

/** 정지 그림 위에 겹치는 영상. 투명이 제대로 그려질 때만 onLive(true) — 영상 네 변 8px 는 투명 테두리라
 *  왼쪽 위 한 점이 투명하면 알파가 살아 있는 것 (사파리 계열은 검게 나와 정지 그림을 유지한다).
 *  R2 가 ACAO:* 를 주므로 crossOrigin 으로 받아야 캔버스를 읽을 수 있다. */
export function DynVideo({ portrait, className, onLive }: { portrait: string; className?: string; onLive: (on: boolean) => void }) {
  const [live, setLive] = useState(false);
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const probe = (v: HTMLVideoElement) => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 4;
      const g = c.getContext("2d");
      if (!g) return;
      g.drawImage(v, 0, 0, 4, 4, 0, 0, 4, 4);
      if (g.getImageData(1, 1, 1, 1).data[3] < 250) { v.currentTime = 0; setLive(true); onLive(true); }
    } catch { /* 캔버스를 못 읽으면 정지 그림 유지 */ }
  };
  return (
    <video className={`dyn-video${live ? " on" : ""}${className ? ` ${className}` : ""}`} src={`${base(portrait)}.webm`}
      crossOrigin="anonymous" autoPlay loop muted playsInline preload="auto" aria-hidden
      onLoadedData={(e) => probe(e.currentTarget)} />
  );
}
