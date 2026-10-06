"use client";

// 페이지 머리의 '?' (안내) — 머리는 home.tsx 셸이 그리고 안내 창은 각 화면 부품 안에 있어서, 신호로 잇는다.
// 머리는 OPEN 신호(detail = 탭)를 쏘고, 그 탭의 화면이 usePageHelp 로 받아 자기 안내 창을 연다 (2026-10-07).
import { useEffect } from "react";

const PAGE_HELP = "ta:page-help";
/** 안내 창이 있는 탭 — 머리에 '?' 를 단다 */
export const PAGE_HELP_TABS = new Set(["story", "recruit", "farm", "upgrade", "sim"]);

export function openPageHelp(tab: string) {
  window.dispatchEvent(new CustomEvent<string>(PAGE_HELP, { detail: tab }));
}

export function usePageHelp(tab: string, open: () => void) {
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === tab) open(); };
    window.addEventListener(PAGE_HELP, on);
    return () => window.removeEventListener(PAGE_HELP, on);
  }, [tab, open]);
}
