"use client";

// 내 정보 오른쪽 열 — 카드 순서를 손잡이(⠿)로 끌어 바꾼다 (사용자 지시 2026-10-15 "마우스로 잡고 위아래로 움직여서 배치").
// 순서는 localStorage "ta:me-order" — 내 정보로 로그인했으면 설정 동기화(app/cloud-prefs.tsx SYNC)로 다른 기기에도 이어진다.
// 손잡이는 카드 제목 줄에 붙는다: 칸을 감싼 SortItem 이 컨텍스트로 넘기고, Card(app/me.tsx)·접은 칸 줄이 받아 그린다.
// 카드 통째로 잡게 하지 않은 건 안의 단추·오퍼 얼굴을 누르다 끌려 버려서다
import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "./i18n";

const KEY = "ta:me-order";
export const ME_ORDER_DEFAULT = ["summary", "resume", "recruit", "paradox", "records", "rogue", "drawers", "rarity"] as const;
export type MeBlock = (typeof ME_ORDER_DEFAULT)[number];

export const DRAWER_DEFAULT = ["progress", "friends", "recent", "depot"] as const;
export type DrawerKey = (typeof DRAWER_DEFAULT)[number];

/** 저장된 목록을 알려진 칸만 남기고, 빠진 칸(새로 생긴 칸)은 기본 순서의 앞 칸 뒤에 끼운다 */
function norm<K extends string>(raw: unknown, def: readonly K[]): K[] {
  const known = new Set<string>(def);
  const uniq = [...new Set(Array.isArray(raw) ? raw.filter((x): x is K => typeof x === "string" && known.has(x)) : [])];
  for (const [i, k] of def.entries()) {
    if (uniq.includes(k)) continue;
    const prev = def.slice(0, i).reverse().find((p) => uniq.includes(p));
    uniq.splice(prev ? uniq.indexOf(prev) + 1 : 0, 0, k);
  }
  return uniq;
}
const read = (): string => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } };
const subscribe = (cb: () => void) => {
  const on = (e: StorageEvent) => { if (e.key === null || e.key === KEY) cb(); };
  window.addEventListener("storage", on);   // 다른 탭·설정 동기화(같은 탭에 storage 이벤트를 흉내 낸다)
  return () => window.removeEventListener("storage", on);
};
/** folded — 접어 둔 카드(카드 번호 no, 예: "PARADOX"). 순서와 같은 설정에 실어 기기 사이에 이어진다 (사용자 지시 2026-10-22 "내 정보 섹션 전부 아코디언") */
type Saved = { blocks?: string[]; drawers?: string[]; folded?: string[] };
function parse(raw: string): Saved { try { const v = raw ? JSON.parse(raw) : null; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } }
function save(patch: Saved | null) {
  try {
    const cur = parse(read());
    // null = 순서 초기화 — 접어 둔 카드는 순서가 아니라 그대로 둔다
    const next: Saved = patch ? { ...cur, ...patch } : (cur.folded?.length ? { folded: cur.folded } : {});
    if (next.folded && !next.folded.length) delete next.folded;
    const same = (a: string[] | undefined, d: readonly string[]) => !a || a.join() === d.join();
    if (same(next.blocks, ME_ORDER_DEFAULT)) delete next.blocks;
    if (same(next.drawers, DRAWER_DEFAULT)) delete next.drawers;
    if (Object.keys(next).length) localStorage.setItem(KEY, JSON.stringify(next)); else localStorage.removeItem(KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  } catch { /* 무시 */ }
}

/** 지금 순서 — 오른쪽 열 칸·접은 칸, 기본에서 바꿨는지 */
export function useMeOrder(): { order: MeBlock[]; drawers: DrawerKey[]; custom: boolean } {
  const saved = parse(useSyncExternalStore(subscribe, read, () => ""));
  return { order: norm(saved.blocks, ME_ORDER_DEFAULT), drawers: norm(saved.drawers, DRAWER_DEFAULT), custom: !!(saved.blocks || saved.drawers) };
}
/** 접어 둔 카드 — 카드 번호(no) 목록 */
export function useMeFolded(): Set<string> {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => new Set(parse(raw).folded ?? []), [raw]);
}
export function toggleMeFolded(no: string) {
  const cur = new Set(parse(read()).folded ?? []);
  if (cur.has(no)) cur.delete(no); else cur.add(no);
  save({ folded: [...cur] });
}
/** 접은 칸 순서 저장 — 같은 묶음 안에서 좌우로 (사용자 지시 2026-10-15) */
export const saveDrawerOrder = (drawers: DrawerKey[]) => save({ drawers });

type Handle = { onPointerDown: (e: React.PointerEvent) => void; onKeyDown: (e: React.KeyboardEvent) => void; takeMoved: () => boolean };
const HandleCtx = createContext<Handle | null>(null);
/** 이 칸 아래의 카드(창 안 카드 등)에는 손잡이가 또 생기지 않게 끊는다 */
export function NoSortHandle({ children }: { children: React.ReactNode }) {
  return <HandleCtx.Provider value={null}>{children}</HandleCtx.Provider>;
}
/** 카드 제목 줄의 손잡이 — ⠿ 와 제목 글자까지 잡는 자리 (사용자 지시 2026-10-15 "타이틀까지도 ⠿ 영역으로").
 *  끌어 놓을 수 있는 칸 밖(창 안 카드 등)에서는 제목만 그린다 */
export function SortHandle({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) {
  const h = useContext(HandleCtx);
  const { t } = useI18n();
  // 제목을 그냥 누르면 onClick(카드 접기·펼치기), 6px 넘게 끌면 옮기기 (사용자 지시 2026-10-22 "제목 누르면 아코디언 열닫")
  if (!h) return onClick ? <button type="button" className="me-sort-handle with-title no-sort" onClick={onClick}>{children}</button> : <>{children}</>;
  return (
    <button type="button" className={`me-sort-handle${children ? " with-title" : ""}`} title={t("끌어서 순서 바꾸기 (↑↓)")}
      onPointerDown={h.onPointerDown} onKeyDown={h.onKeyDown} onClick={() => { if (!h.takeMoved()) onClick?.(); }}><span className="me-sort-grip" aria-hidden>⠿</span>{children}</button>
  );
}

/** 끌어 옮기기 공용 — 끄는 동안 칸이 포인터를 따라오고, 나머지 칸은 놓았을 때의 자리로 미리 미끄러져 비킨다(FLIP).
 *  놓으면 끌던 칸이 제자리로 스르륵 들어간다 (사용자 지시 2026-10-15 "선 하나 생기고 툭 떨어져서 헷갈리니 미리 보여 줘").
 *  자리는 칸의 배치 위치(offsetLeft/Top — 움직이는 transform 과 무관)로 가른다. twoD 면 격자(줄을 넘김)를 읽는 순서로 */
export function useLiveSort<K extends string>(keys: K[], attr: string, twoD: boolean, onDrop: (next: K[]) => void, threshold = 0, swap = false) {
  // swap — 끼워 넣지 않고 **두 칸을 맞바꾼다** (인프라 시설 자리 바꾸기, 2026-10-23). at = 맞바꿀 상대의 원래 자리
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ key: K; at: number } | null>(null);
  const st = useRef<{ key: K; gx: number; gy: number; x: number; y: number; at: number; live: boolean; av: HTMLElement | null } | null>(null);
  const moved = useRef(false);   // 끌었으면 이어지는 click 은 삼킨다 (접은 칸 단추)
  const pos = useRef(new Map<string, [number, number]>());
  const swapped = (at: number, key: K) => { const r = [...keys]; const i = keys.indexOf(key); [r[i], r[at]] = [r[at], r[i]]; return r; };
  const display = drag ? (swap ? swapped(drag.at, drag.key) : (() => { const r = keys.filter((k) => k !== drag.key); r.splice(drag.at, 0, drag.key); return r; })()) : keys;

  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>(`:scope > [${attr}]`) ?? [])];
  const elOf = (k: string) => items().find((el) => el.getAttribute(attr) === k) ?? null;
  // 포인터를 따라오는 건 복사본(av, 화면 고정)이고, 원래 칸은 놓일 자리에 반투명하게 남아 미리 보인다
  // (사용자 지시 2026-10-15 "놓일 자리에 집고 있는 카드가 투명한 느낌으로 미리"). 복사본은 같은 부모에 넣어 칸 CSS(.me-drawers > button 등)를 그대로 받는다
  const follow = () => {
    const s = st.current;
    if (!s?.av) return;
    s.av.style.left = `${twoD ? s.x - s.gx : s.av.getBoundingClientRect().left}px`;
    s.av.style.top = `${s.y - s.gy}px`;
  };
  // 칸의 배치 자리(화면 좌표) — 보이는 자리에서 지금 걸린 transform(미끄러지는 중인 움직임)을 뺀다.
  // offsetTop 은 offsetParent 가 body 면 문서 기준이라 스크롤만큼 어긋났다 (사용자 지적 2026-10-15 "위에 게 툭 떨어짐")
  const home = (it: HTMLElement) => {
    const r = it.getBoundingClientRect();
    const m = new DOMMatrixReadOnly(getComputedStyle(it).transform === "none" ? undefined : getComputedStyle(it).transform);
    return { left: r.left - m.m41, top: r.top - m.m42, width: r.width, height: r.height };
  };
  // 놓일 자리 = 끄는 칸을 뺀 나머지 중 몇 번째 뒤인가.
  // 위아래(열): 각 자리에 놓았을 때 끄는 칸이 앉을 높이를 셈해 지금 떠 있는 높이에 가장 가까운 자리로 — 12px 넘게 더 가까워야 옮긴다.
  //   키가 다른 두 칸을 '가장자리가 반쯤 걸치면' 으로 가르면 바꾸는 선과 되돌리는 선이 엇갈려, 그 사이에서 위아래로 깜빡였다 (사용자 지적 2026-10-15)
  // 격자(더 보기 칸): 이웃 칸과 반 이상 겹치면 서로 자리를 바꾼다 (사용자 지시 2026-10-15)
  const slotAt = () => {
    const s = st.current; const el = s && elOf(s.key);
    if (!s || !el) return s?.at ?? 0;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = s.x - s.gx, top = s.y - s.gy, right = left + w, bottom = top + h;
    const all = items();
    const others = all.filter((it) => it !== el);
    const mine = all.indexOf(el);   // 지금 보이는 순서에서 끄는 칸의 자리
    if (twoD && swap) {
      // 맞바꾸기 — 반 이상 겹친 칸의 **원래 자리**와 바꾼다. 아무 데도 안 겹치면 지금 고른 자리 그대로
      for (const it of others) {
        if (!it.offsetParent) continue;
        const r = home(it);
        const ov = Math.max(0, Math.min(right, r.left + r.width) - Math.max(left, r.left)) * Math.max(0, Math.min(bottom, r.top + r.height) - Math.max(top, r.top));
        if (ov >= (r.width * r.height) / 2) {
          // 자리 번호 = 지금 화면 순서에서 그 칸의 번호. 화면은 이미 (끄는 칸 ↔ s.at 칸) 이 바뀐 상태라,
          // 원래 자리로 밀려나 있는 칸 위에 올리면 그 번호가 끄는 칸의 원래 자리 = 제자리로 돌아간다
          return swapped(s.at, s.key).indexOf(it.getAttribute(attr) as K);
        }
      }
      return s.at;
    }
    if (twoD) {
      for (const [i, it] of others.entries()) {
        if (!it.offsetParent) continue;
        const r = home(it);
        const ov = Math.max(0, Math.min(right, r.left + r.width) - Math.max(left, r.left)) * Math.max(0, Math.min(bottom, r.top + r.height) - Math.max(top, r.top));
        if (ov >= (r.width * r.height) / 2) return i < mine ? i : i + 1;   // 그 칸 자리로 — 앞 칸이면 그 앞, 뒤 칸이면 그 뒤
      }
      return s.at;
    }
    const gap = parseFloat(getComputedStyle(ref.current!).rowGap) || 0;
    const vis = all.filter((it) => it.offsetParent);
    const base = Math.min(...vis.map((it) => home(it).top));
    // k 번째 자리에 놓으면 앉을 높이 — 앞의 보이는 칸 높이 + 틈의 합
    const seat: number[] = [base];
    for (const it of others) seat.push(seat[seat.length - 1] + (it.offsetParent ? it.offsetHeight + gap : 0));
    let best = s.at;
    for (let k = 0; k < seat.length; k++) if (Math.abs(top - seat[k]) < Math.abs(top - seat[best])) best = k;
    return Math.abs(top - seat[s.at]) - Math.abs(top - seat[best]) > 12 ? best : s.at;
  };
  // 순서가 바뀌면 나머지 칸을 옛 자리에서 새 자리로 미끄러뜨린다
  useLayoutEffect(() => {
    for (const el of items()) {
      const k = el.getAttribute(attr) ?? "";
      const now: [number, number] = [el.offsetLeft, el.offsetTop];
      const old = pos.current.get(k);
      pos.current.set(k, now);
      if (!old || !el.offsetParent || (old[0] === now[0] && old[1] === now[1])) continue;
      el.style.transition = "none";
      el.style.transform = `translate(${old[0] - now[0]}px, ${old[1] - now[1]}px)`;
      void el.offsetWidth;
      el.style.transition = "transform .22s cubic-bezier(.2, .8, .3, 1)";
      el.style.transform = "";
    }
  });   // 매 렌더 — 칸 높이가 바뀌어도 자리 기록을 맞춘다 (움직임은 자리가 바뀐 칸만)

  const start = (key: K, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = elOf(key);
    if (!el) return;
    if (!threshold) e.preventDefault();
    const r = el.getBoundingClientRect();
    st.current = { key, gx: e.clientX - r.left, gy: e.clientY - r.top, x: e.clientX, y: e.clientY, at: keys.indexOf(key), live: false, av: null };
    moved.current = false;
    const x0 = e.clientX, y0 = e.clientY;
    const begin = () => {
      const s = st.current!; s.live = true; moved.current = true;
      const av = el.cloneNode(true) as HTMLElement;
      av.removeAttribute(attr);
      av.removeAttribute("id");
      av.classList.add("me-drag-avatar");
      av.setAttribute("aria-hidden", "true");
      Object.assign(av.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
        margin: "0", zIndex: "1000", pointerEvents: "none", transform: "none", transition: "none" });
      el.parentElement?.appendChild(av);
      s.av = av;
      setDrag({ key, at: s.at });
    };
    if (!threshold) begin();
    const scroller = (() => { let p = el.parentElement; while (p && p !== document.body) { const o = getComputedStyle(p).overflowY; if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p; p = p.parentElement; } return document.scrollingElement as HTMLElement; })();
    const step = () => {
      const s = st.current!;
      follow();
      const at = slotAt();
      if (at !== s.at) { s.at = at; setDrag({ key, at }); }
    };
    const move = (ev: PointerEvent) => {
      const s = st.current; if (!s) return;
      s.x = ev.clientX; s.y = ev.clientY;
      if (!s.live) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < threshold) return; begin(); }
      ev.preventDefault();
      // 화면 끝에 닿으면 굴린다 — 긴 카드 너머로 옮길 때
      if (ev.clientY < 60) scroller.scrollBy(0, -16); else if (ev.clientY > window.innerHeight - 60) scroller.scrollBy(0, 16);
      step();
    };
    const onScroll = () => { if (st.current?.live) step(); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("scroll", onScroll, true);
      const s = st.current;
      st.current = null;
      if (!s?.live) return;
      const av = s.av;
      if (av) {
        // 복사본이 놓일 자리(반투명 원래 칸)로 스르륵 들어가 합쳐진다
        const node = elOf(s.key);
        const to = node ? home(node) : null;
        av.style.transition = "left .2s cubic-bezier(.2, .8, .3, 1), top .2s cubic-bezier(.2, .8, .3, 1), opacity .2s";
        if (to) { av.style.left = `${to.left}px`; av.style.top = `${to.top}px`; }
        window.setTimeout(() => av.remove(), 210);
      }
      const next = swap ? swapped(s.at, s.key) : (() => { const r = keys.filter((k) => k !== s.key); r.splice(s.at, 0, s.key); return r; })();
      onDrop(next);
      setDrag(null);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("scroll", onScroll, true);
  };
  // 끌고 난 click 을 삼킬지 — 한 번 물으면 지운다 (ref 를 그대로 내주면 렌더 중 ref 읽기로 잡힌다)
  const takeMoved = () => { const m = moved.current; moved.current = false; return m; };
  return { ref, display, drag, start, takeMoved };
}

/** 오른쪽 열 — blocks 의 칸을 저장된 순서로 늘어놓고 손잡이로 옮긴다. 빈 칸(null 을 그리는 카드)은 grid 틈이 안 생기게 감춘다 */
export function SortColumn({ className, blocks }: { className: string; blocks: Record<MeBlock, React.ReactNode> }) {
  const { order, custom } = useMeOrder();
  const { t } = useI18n();
  // 6px 넘게 끌어야 옮기기 — 그냥 누르면 제목 클릭(카드 접기)으로 남는다
  const { ref: colRef, display, drag, start, takeMoved } = useLiveSort(order, "data-sort", false, (next) => save({ blocks: next }), 6);

  const handleOf = (key: MeBlock): Handle => ({
    takeMoved,
    onPointerDown: (e) => start(key, e),
    onKeyDown: (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const i = order.indexOf(key);
      const at = Math.max(0, Math.min(order.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)));
      if (at !== i) { const next = order.filter((k) => k !== key); next.splice(at, 0, key); save({ blocks: next }); }
      const btn = e.currentTarget as HTMLElement;
      requestAnimationFrame(() => btn.focus());
    },
  });

  return (
    <div ref={colRef} className={`${className}${drag ? " me-sorting" : ""}`}>
      {display.map((k) => (
        <div key={k} data-sort={k} className={`me-sortable${drag?.key === k ? " dragging" : ""}`}>
          <HandleCtx.Provider value={handleOf(k)}>{blocks[k]}</HandleCtx.Provider>
        </div>
      ))}
      {custom && <button type="button" className="me-sort-reset" onClick={() => save(null)}>{t("카드 순서 기본으로")}</button>}
    </div>
  );
}

/** 접은 칸(단추 줄) 안에서 좌우로 — 단추를 6px 넘게 끌면 옮기기, 그냥 누르면 지금처럼 창이 열린다.
 *  keys = 지금 보이는 칸(저장 순서), all = 저장 순서 전체. display 순서로 그린다 */
export function useDrawerDrag(keys: DrawerKey[], all: DrawerKey[]) {
  const { ref, display, drag, start, takeMoved } = useLiveSort(keys, "data-drawer", true, (vis) => saveDrawerOrder([...vis, ...all.filter((k) => !keys.includes(k))]), 6);
  const bind = (key: DrawerKey) => ({
    "data-drawer": key,
    onPointerDown: (e: React.PointerEvent) => start(key, e),
    onClickCapture: (e: React.MouseEvent) => { if (takeMoved()) { e.preventDefault(); e.stopPropagation(); } },
    onDragStart: (e: React.DragEvent) => e.preventDefault(),   // 배경 그림을 끄는 브라우저 기본 동작 막기
  });
  const cls = (key: DrawerKey) => (drag?.key === key ? " dragging" : "");
  return { ref, bind, cls, dragging: !!drag, display };
}
