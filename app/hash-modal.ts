"use client";

// 모달 딥링크 공용 헬퍼 (사용자 요청 2026-07-27: "링크 만들 수 있는 모든 곳에 URL을").
// 열려 있는 모달 상태 ↔ URL 해시를 양방향 동기화한다.
//  - 열림: pushState → 뒤로가기가 모달을 닫는다. 모달 내 상태 변화(탭 전환 등)는 replaceState.
//  - 닫힘(UI 조작): 해시를 지운다(replaceState — 히스토리 오염 없음).
//  - 딥링크 진입·뒤로/앞으로: hashchange/popstate에서 apply()로 상태를 복원한다.
// ⚠ vinext가 history.pushState를 인스턴스 패치해 내비게이션으로 취급, .site-scroll을 맨 위로
// 리셋한다 — 해시만 바꿀 땐 네이티브 프로토타입을 직접 불러 우회한다 (rogue.tsx와 동일 실측).
// ⚠⚠ 밖에서 이 모달을 열 때 `location.hash = "#…"` 대입은 절대 금지. vinext의 RSC 내비게이션을
// 타는데 Pages(정적 배포)에선 페이로드를 못 받아 무한 재시도에 빠진다 — 그 popstate 폭풍이
// 아래 apply()를 계속 불러 닫은 모달이 즉시 다시 열린다 (2026-08-13 라이브 실측: 클릭 1회에
// RSC 내비 75회·popstate 45회/2초. 로컬 서버는 1회로 끝나 재현되지 않으니 주의).
// 여는 쪽은 History.prototype.pushState + dispatchEvent(new Event("hashchange"))를 쓸 것.

import { useEffect, useRef } from "react";

// 페이지 소유 해시 머신(rogue.tsx의 #rg-…)이 전역 모달 해시를 자기 상태로 덮어쓰지 않게
// 하는 가드 목록. 전역(모든 탭에서 열리는) 모달의 해시만 등록한다.
export const GLOBAL_MODAL_HASH = /^#(changelog|devnotes|broadcast|replay|prts-help)/;

/**
 * value: 지금 상태가 원하는 해시(모달 열림, 예 "#roster") — 닫혀 있으면 null.
 * apply: URL 해시 → 상태 복원. 자기 해시가 아니면 자기 모달을 닫아야 한다.
 */
export function useHashSync(value: string | null, apply: (hash: string) => void) {
  const applyRef = useRef(apply);
  useEffect(() => { applyRef.current = apply; });
  const owned = useRef<string | null>(null); // 마지막으로 URL에 쓴 내 해시

  // 최초 마운트(딥링크 진입) + 뒤로/앞으로·수동 편집 → 상태
  useEffect(() => {
    const on = () => applyRef.current(decodeURIComponent(window.location.hash));
    on();
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    return () => { window.removeEventListener("hashchange", on); window.removeEventListener("popstate", on); };
  }, []);

  // 상태 → URL
  useEffect(() => {
    const cur = decodeURIComponent(window.location.hash);
    if (value) {
      if (cur !== value) {
        // 이미 내 해시가 떠 있으면(모달 내 상태 변화) 교체, 새로 열렸으면 push
        if (owned.current && cur === owned.current) history.replaceState(null, "", value);
        else History.prototype.pushState.call(history, null, "", value);
      }
      owned.current = value;
    } else {
      // UI로 닫았고 해시가 아직 내 것이면 지운다. 뒤로가기로 닫힌 경우(cur ≠ owned)는 그대로.
      if (owned.current && cur === owned.current) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      owned.current = null;
    }
  }, [value]);
}
