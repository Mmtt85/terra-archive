"use client";

// 검색 정규화 — 소문자로 낮추고 공백을 전부 제거한다.
// 검색어와 후보 문자열 양쪽에 똑같이 적용하면 "론트"로 "론 트레일"이 히트한다.
export const normSearch = (s: string) => s.toLowerCase().replace(/\s+/g, "");

import { useRef, useState, type FormEvent } from "react";

// 사이트의 **모든 검색 입력**은 타이핑이 멈춘 뒤에만 검색한다 — "연속해서 입력하고 있을
// 때는 검색하지 말고, 입력이 멈춘 뒤에 검색" (사용자 확정 2026-07-25).
// 대기 시간은 **0.5초**로 확정 (처음 1초로 넣었다가 "너무 느리다"고 하향 — 다시 올리지 말 것).
// 한 글자마다 450명 로스터·수천 항목을 걸러 다시 그리던 비용이 사라진다 — 입력 지연의
// 실측 원인은 계산(1~8ms)이 아니라 매 글자 목록 재렌더·재페인트였다.
export const SEARCH_DEBOUNCE_MS = 500;

/** **비제어** 검색 입력 — 타이핑 중엔 리액트 렌더가 **한 번도 없다**.
 *  제어 입력(value={state})은 한 글자마다 화면 전체를 다시 렌더한 뒤에야 글자가 보이므로,
 *  목록이 큰 화면(오퍼 420장)에선 입력 자체가 굼떠진다 — 특히 한글 IME 조합 중
 *  (사용자 리포트 2026-07-25: "오퍼 검색할 때만 인풋 하나하나가 너무 느리다").
 *  입력값은 DOM에만 있고, 멈춘 뒤 ms 후에 term만 갱신된다.
 *
 *  주의: 입력이 비었는지를 상태로 들고 있지 않으므로, 지우기(×) 버튼 표시는
 *  `input:placeholder-shown ~ .search-clear { display: none }` 처럼 CSS로 처리한다.
 */
export function useSearchInput(ms = SEARCH_DEBOUNCE_MS) {
  const [term, setTerm] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const push = (value: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setTerm(value), value ? ms : 0);   // 지우기는 즉시
  };
  const onInput = (event: FormEvent<HTMLInputElement>) => push(event.currentTarget.value);
  /** 프로그램에서 값 지정 (모달의 '이 재료로 검색', 핸드오프, 초기화 등) — 기다리지 않고 즉시. */
  const set = (value: string, focus = false) => {
    if (inputRef.current) inputRef.current.value = value;
    window.clearTimeout(timer.current);
    setTerm(value);
    if (focus) inputRef.current?.focus();
  };
  const clear = (focus = true) => set("", focus);
  return { term, set, clear, inputRef, inputProps: { ref: inputRef, defaultValue: "", onInput } };
}
