"use client";

// '새기능' 배지 — 출시 뒤 3일(whats-new.ts) 동안 뜨되, **배지가 붙은 버튼을 한 번 누르면 다시는 안 뜬다**
// (사용자 지시 2026-10-07 "뉴 버튼은 3일동안 떠있되, 한번 클릭하면 다시는 안나오게").
// 본 배지는 id 별로 이 브라우저(localStorage)에 기억한다 — 같은 id 의 다른 배지도 함께 사라진다.
//
// 쓰는 법: 종전 `{isNewFeature("x") && <span className="new-badge">…</span>}` 를
//   `<NewBadge id="x" show={isNewFeature("x")} />` 로. 누름을 받는 곳은 배지를 품은 가장 가까운
//   버튼·링크(host 로 바꿀 수 있다 — 업데이트 내역 항목은 그 줄 전체 li).
// ⚠ 본 기록은 마운트 뒤에만 읽는다 — 렌더 중에 읽으면 프리렌더 HTML(배지 있음)과 갈라져 React #418 이다.

import { useEffect, useRef, useState } from "react";
import { FEATURE_RELEASED } from "./whats-new";

const SEEN_KEY = "ta:new-seen";
const SEEN_EVENT = "ta:new-seen";

// 값 = 본 날(일 단위 숫자, Date.now()/86400000). 평생 쌓이지 않게 KEEP_DAYS 지난 것은 쓸 때마다 지운다 (사용자 지적 2026-10-15
// "NEW 배지 본 기록이 평생 누적될 것 같다"). NEW 는 길어야 3일만 뜨므로(whats-new.ts·changelog NEW_DAYS) 30일 지난 기록은 다시 뜰 일이 없다.
// 옛 기록(값 1, 날짜 없음)은 처음 쓸 때 오늘 날짜를 붙여 30일 뒤에 함께 정리된다
// 보관 기간 = 가장 긴 NEW 기간 + 일주일, 최소 30일 — 나중에 3일보다 긴 NEW 를 만들어도 그 기간 안에 기록이 지워져 다시 뜨지 않게.
// (인프라 '변경 있음'은 이 기록과 무관한 따로 장치다)
const KEEP_DAYS = Math.max(30, ...Object.values(FEATURE_RELEASED).map((e) => (typeof e === "string" ? 3 : e.days) + 7));
const today = () => Math.floor(Date.now() / 86_400_000);
function readSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") ?? {}; } catch { return {}; }
}

export function isBadgeSeen(id: string): boolean {
  return !!readSeen()[id];
}

/** quiet = 기록만 남기고 지금 떠 있는 배지는 그대로 둔다 (보는 것만으로 '본 것'이 되는 배지) */
export function markBadgeSeen(id: string, quiet = false) {
  try {
    const seen = readSeen();
    if (seen[id]) return;
    const now = today();
    const kept: Record<string, number> = {};
    for (const [k, d] of Object.entries(seen)) {
      const day = typeof d === "number" && d > 1 ? d : now;   // 옛 기록(1)은 오늘 본 것으로
      if (now - day <= KEEP_DAYS) kept[k] = day;
    }
    kept[id] = now;
    localStorage.setItem(SEEN_KEY, JSON.stringify(kept));
  } catch { /* 저장이 막힌 창이면 이번 화면에서만 숨긴다 */ }
  if (!quiet) window.dispatchEvent(new CustomEvent<string>(SEEN_EVENT, { detail: id }));
}

// seenOnView — 누르지 않아도 **화면에 뜬 것만으로** 본 것으로 친다. 이번에는 그대로 보이고, 다음부터 안 뜬다
// (업데이트 내역 목록의 항목 NEW — 사용자 지시 2026-10-07 "리스트 본 것만으로도 사라지게").
export function NewBadge({ id, show, host = "button, a, label, [role=button]", label = "NEW", seenOnView = false }: {
  id: string; show: boolean; host?: string; label?: string; seenOnView?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // 본 기록은 마운트 뒤에야 읽을 수 있다 — 그 전(프리렌더·첫 페인트)엔 아예 안 그린다.
  // 종전엔 일단 그렸다가 '본 것'이면 지워서, 새로고침마다 배지가 잠깐 떴다 사라졌다 (사용자 지적 2026-10-07).
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!show || isBadgeSeen(id)) { setVisible(false); return; }
    setVisible(true);
    if (seenOnView) markBadgeSeen(id, true);
    const onSeen = (e: Event) => { if ((e as CustomEvent<string>).detail === id) setVisible(false); };
    window.addEventListener(SEEN_EVENT, onSeen);
    return () => window.removeEventListener(SEEN_EVENT, onSeen);
  }, [id, show, seenOnView]);
  // 누르는 순간을 받는 곳 — 배지를 품은 버튼·링크(없으면 바로 위 요소). 배지가 그려진 뒤에 건다
  useEffect(() => {
    if (!visible) return;
    const el = ref.current?.parentElement?.closest<HTMLElement>(host) ?? ref.current?.parentElement;
    const onClick = () => markBadgeSeen(id);
    el?.addEventListener("click", onClick);
    return () => el?.removeEventListener("click", onClick);
  }, [visible, id, host]);
  if (!visible) return null;
  // 이름은 어디서나 NEW 하나 (사용자 지시 2026-10-07 — '새기능'/NEW 를 나눌 이유가 없다)
  return <span ref={ref} className="new-badge">{label}</span>;
}
