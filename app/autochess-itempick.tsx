"use client";

// 덱편성 시뮬레이터 칸의 장비 고르기 (제안 2383c050, 2026-10-24).
// 여러 단계 하위 메뉴 — 아이템 → 맹약 관련 / 그 외, 맹약 관련 안에서 같은 맹약 장비는 다시 한 줄로 묶는다
// (빅토리아 해머 5종 — 사용자 지시 "해머는 해머끼리, 마우스오버하면 부메뉴로", "아이템 → 맹약 관련 → 지금 리스트 / 그 외 → 나머지").
// 마우스는 올리면 펼치고, 터치는 눌러서 펼친다. 칸이 overflow:hidden 이라 목록은 body 에 화면 기준(fixed)으로 띄운다 —
// 공용 Dropdown 에는 하위 메뉴가 없다. 단계마다 같은 층(.ac-ip-layer)의 형제로 띄워 서로 잘리지 않게 한다.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** 메뉴 한 줄 — id 가 있으면 고를 수 있는 장비, kids 가 있으면 하위 메뉴 */
export type PickNode = { key: string; n: string; icon?: string; note?: string; title?: string; id?: string; kids?: PickNode[] };

type Open = { key: string; kids: PickNode[]; left?: number; right?: number; top: number };
const SUB_W = 240;

/** 화면 기준으로 뜬 메뉴 한 장 — 아래로 넘치면 위로 당기고, 그래도 길면 안에서 스크롤 */
function Menu({ style, children, label }: { style: React.CSSProperties; children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const over = r.bottom - (window.innerHeight - 8);
    if (over > 0) setShift(-Math.min(over, Math.max(0, r.top - 8)));
  }, []);
  return (
    <div ref={ref} className="ac-ip-menu menu-anim" role="menu" aria-label={label}
      style={{ ...style, ...(shift ? { top: (style.top as number) + shift } : {}) }}>
      {children}
    </div>
  );
}

export function ItemPick({ tree, value, onPick, label, ariaLabel, noneLabel, on }: {
  tree: PickNode[];
  value: string | undefined;
  onPick: (id: string) => void;
  label: React.ReactNode;
  ariaLabel: string;
  noneLabel: string;
  on: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [path, setPath] = useState<Open[]>([]);   // 펼친 하위 메뉴 — 단계마다 하나
  const btnRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current!.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - SUB_W - 8)), top: r.bottom + 4 });
    setPath([]);
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!t && (!!layerRef.current?.contains(t as Node) || !!btnRef.current?.contains(t as Node));
    const down = (e: MouseEvent) => { if (!inside(e.target)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const scroll = (e: Event) => { if (!inside(e.target)) setOpen(false); };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => {
      window.removeEventListener("mousedown", down); window.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", scroll);
    };
  }, [open]);

  const pick = (id: string) => { onPick(id); setOpen(false); };
  /** depth 단계의 줄을 가리켰다 — 하위 메뉴가 있으면 그 옆에 펼치고, 아니면 그보다 깊은 메뉴를 닫는다 */
  const hover = (depth: number, n: PickNode | null, el?: HTMLElement) => {
    if (!n?.kids || !el) { setPath((p) => (p.length > depth ? p.slice(0, depth) : p)); return; }
    const r = el.getBoundingClientRect();
    const toLeft = r.right - 2 + SUB_W > window.innerWidth - 8;   // 오른쪽에 자리가 없으면 왼쪽에
    const o: Open = { key: n.key, kids: n.kids, top: r.top - 5, ...(toLeft ? { right: window.innerWidth - r.left - 2 } : { left: r.right - 2 }) };
    setPath((p) => (p[depth]?.key === n.key && p.length === depth + 1 ? p : [...p.slice(0, depth), o]));
  };
  const has = (n: PickNode): boolean => n.id === value || !!n.kids?.some(has);
  const rows = (nodes: PickNode[], depth: number) => nodes.map((n) => n.kids
    ? (
      <button type="button" key={n.key} aria-haspopup="menu" aria-expanded={path[depth]?.key === n.key} title={n.title}
        className={`ac-ip-row grp${path[depth]?.key === n.key ? " open" : ""}${value && has(n) ? " on" : ""}`}
        onMouseEnter={(ev) => hover(depth, n, ev.currentTarget)}
        onClick={(ev) => (path[depth]?.key === n.key ? hover(depth, null) : hover(depth, n, ev.currentTarget))}>
        {n.icon && <img src={n.icon} alt="" width={18} height={18} />}<span>{n.n}</span>{n.note && <em>{n.note}</em>}<i aria-hidden>▸</i>
      </button>
    ) : (
      <button type="button" key={n.key} role="menuitemradio" aria-checked={value === n.id}
        className={`ac-ip-row${value === n.id ? " on" : ""}`} title={n.title}
        onMouseEnter={() => hover(depth, null)} onClick={() => pick(n.id ?? "")}>
        {n.icon && <img src={n.icon} alt="" width={18} height={18} />}<span>{n.n}</span>{n.note && <em>{n.note}</em>}
      </button>
    ));

  return (
    <div className="ac-itempick">
      <button type="button" ref={btnRef} className={`ac-itembtn${on ? " on" : ""}`}
        aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} onClick={toggle}>{label}</button>
      {open && pos && createPortal(
        <div ref={layerRef} className="ac-ip-layer">
          <Menu style={{ left: pos.left, top: pos.top }} label={ariaLabel}>
            <button type="button" role="menuitemradio" aria-checked={!value} className={`ac-ip-row none${!value ? " on" : ""}`}
              onMouseEnter={() => hover(0, null)} onClick={() => pick("")}>
              <span>{noneLabel}</span>
            </button>
            {rows(tree, 0)}
          </Menu>
          {path.map((o, d) => (
            <Menu key={`${d}:${o.key}`} label={ariaLabel}
              style={{ top: o.top, ...(o.left != null ? { left: o.left } : { right: o.right }) }}>
              {rows(o.kids, d + 1)}
            </Menu>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
