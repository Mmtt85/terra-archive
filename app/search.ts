"use client";

// 검색 정규화 — 소문자로 낮추고 공백을 전부 제거한다.
// 검색어와 후보 문자열 양쪽에 똑같이 적용하면 "론트"로 "론 트레일"이 히트한다.
export const normSearch = (s: string) => s.toLowerCase().replace(/\s+/g, "");

import { useEffect, useState } from "react";

// 사이트의 **모든 검색 입력**은 타이핑이 멈춘 뒤에만 검색한다 (사용자 확정 2026-07-25:
// "연속해서 입력하고 있을 때는 검색하지 말고, 입력이 멈춘 1초 이후에 검색 처리").
// 한 글자마다 450명 로스터·수천 항목을 걸러 다시 그리던 비용이 사라진다 — 입력 지연의
// 실측 원인은 계산(1~8ms)이 아니라 매 글자 목록 재렌더·재페인트였다.
export const SEARCH_DEBOUNCE_MS = 1000;

/** 입력이 멈춘 뒤 ms 후의 값만 흘려보낸다. 입력란 자체는 raw 값을 그대로 보여 준다.
 *  빈 문자열(지우기·초기화)은 기다리지 않고 즉시 반영한다 — 되돌리기는 즉각적이어야 한다. */
export function useDebounced<T>(value: T, ms = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (value === settled) return;
    const empty = typeof value === "string" && value.length === 0;
    const timer = window.setTimeout(() => setSettled(value), empty ? 0 : ms);
    return () => window.clearTimeout(timer);
  }, [value, settled, ms]);
  return settled;
}
