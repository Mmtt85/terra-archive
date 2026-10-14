"use client";

// 판 위의 카드를 아무 데나 끌어 놓기 — 통합전략 지도판 층·묶음 카드 (사용자 지시 2026-10-15 "아무데나 마음대로, 겹쳐도 어쩔 수 없음").
// 자리는 CSS 가 정한 기본 자리에서 얼마나 옮겼는지(dx, dy)를 **판 폭·높이에 대한 비율**로 둔다 — 창 크기가 바뀌어도 대략 같은 곳에.
// 옮긴 양은 CSS `translate` 로 얹는다: 층 카드의 역아치는 `transform` 이라 서로 더해진다.
// 저장은 localStorage "ta:rogue-map-pos" { 판 이름: { 카드: [dx, dy] } } — 내 정보 로그인이면 설정 동기화(app/cloud-prefs.tsx)로 이어진다.
// 판이 풀려 위아래 줄이 되는 좁은 화면에서는 끄지도 옮기지도 않는다 (minWidth)
import type React from "react";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";

const KEY = "ta:rogue-map-pos";
type Pos = Record<string, Record<string, [number, number]>>;
const read = (): string => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } };
const parse = (raw: string): Pos => { try { const v = raw ? JSON.parse(raw) : null; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const subscribe = (cb: () => void) => {
  const on = (e: StorageEvent) => { if (e.key === null || e.key === KEY) cb(); };
  window.addEventListener("storage", on);
  return () => window.removeEventListener("storage", on);
};
function save(board: string, cards: Record<string, [number, number]> | null) {
  try {
    const all = parse(read());
    if (cards && Object.keys(cards).length) all[board] = cards; else delete all[board];
    if (Object.keys(all).length) localStorage.setItem(KEY, JSON.stringify(all)); else localStorage.removeItem(KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  } catch { /* 무시 */ }
}
const wideQuery = (w: number) => `(min-width: ${w}px)`;

/** board = 판 이름(토픽 id), minWidth = 이 폭 이상에서만 */
export function useFreeDrag(board: string, minWidth: number) {
  const cards = parse(useSyncExternalStore(subscribe, read, () => ""))[board] ?? {};
  const wide = useSyncExternalStore(
    (cb) => { const m = window.matchMedia(wideQuery(minWidth)); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(wideQuery(minWidth)).matches, () => false);
  const [dragging, setDragging] = useState<string | null>(null);
  const moved = useRef(false);
  // 판 크기 — 비율로 둔 자리를 px 로 바꿀 때. 판은 탭(맵·노드)을 열 때 늦게 생겨서 콜백 ref 로 그때 잰다
  // (useEffect 로 처음 한 번만 찾으면 판이 아직 없어 크기가 비었고, 저장된 자리가 안 얹혀 놓으면 제자리로 튀었다 — 2026-10-15)
  const [size, setSize] = useState<[number, number] | null>(null);
  const fieldEl = useRef<HTMLDivElement | null>(null);
  const ro = useRef<ResizeObserver | null>(null);
  const field = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    fieldEl.current = el;
    if (!el) return;
    ro.current = new ResizeObserver(() => setSize([el.offsetWidth, el.offsetHeight]));
    ro.current.observe(el);
  }, []);

  const bind = (key: string) => {
    const off = wide && size ? cards[key] : undefined;
    return {
      "data-free": key,
      className: `${dragging === key ? " free-dragging" : ""}${off ? " free-moved" : ""}`,
      style: off && size ? ({ translate: `${off[0] * size[0]}px ${off[1] * size[1]}px` } as React.CSSProperties) : undefined,
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (!wide || e.button !== 0 || !fieldEl.current) return;
        const el = e.currentTarget;
        const f = fieldEl.current.getBoundingClientRect();
        const fw = fieldEl.current.offsetWidth, fh = fieldEl.current.offsetHeight;
        const r = el.getBoundingClientRect();
        const start = cards[key] ?? [0, 0];
        const x0 = e.clientX, y0 = e.clientY;
        // 옮길 수 있는 범위 — 좌우·위는 판 안, 아래는 푸터 바로 위까지 (사용자 지시 2026-10-15 "하한선을 푸터 바로 위까지").
        // 판 아래로 내려간 카드는 판 높이를 늘리지 않고 그 아래 내용 위에 겹친다
        const foot = document.querySelector<HTMLElement>(".site-scroll > footer")?.getBoundingClientRect().top;
        const floor = foot != null ? Math.max(f.bottom, foot - 8) : f.bottom;
        const lim = { l: f.left - r.left, r: f.right - r.right, t: f.top - r.top, b: floor - r.bottom };
        let dx = 0, dy = 0;
        moved.current = false;
        const move = (ev: PointerEvent) => {
          dx = Math.max(lim.l, Math.min(lim.r, ev.clientX - x0));
          dy = Math.max(lim.t, Math.min(lim.b, ev.clientY - y0));
          if (!moved.current) { if (Math.hypot(dx, dy) < 6) return; moved.current = true; setDragging(key); }
          ev.preventDefault();
          el.style.translate = `${start[0] * fw + dx}px ${start[1] * fh + dy}px`;
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          if (!moved.current) return;
          setDragging(null);
          const next = { ...cards, [key]: [start[0] + dx / fw, start[1] + dy / fh] as [number, number] };
          save(board, next);
        };
        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      },
      // 끌었으면 이어지는 click(상세 창 열기)은 삼킨다
      onClickCapture: (e: React.MouseEvent) => { if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; } },
      onDragStart: (e: React.DragEvent) => e.preventDefault(),
    };
  };
  return { field, bind, custom: wide && Object.keys(cards).length > 0, reset: () => save(board, null), wide };
}
