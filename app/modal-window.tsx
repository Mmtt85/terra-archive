"use client";

// 공용 창형 모달 (2026-08-03, 사용자 지시: "모든 모달을 록라 보유 소장품 모달처럼") —
// 록라 보유 리스트 창(app/rogue.tsx)의 이동·8방향 리사이즈 문법을 일반화한 래퍼.
//
// 동작:
// - 기본(비고정): 종전 모달 그대로 — 백드롭이 어둡게 깔리고, 바깥 클릭·Esc(layout.tsx 전역
//   스크립트가 백드롭의 .modal-close를 눌러줌)로 닫힌다.
// - 📌 고정: 백드롭이 투명·통과(pointer-events:none)로 바뀌어 뒤 화면을 그대로 쓸 수 있고,
//   바깥 클릭·Esc로는 닫히지 않는다(전역 Esc가 .modal-backdrop만 찾는데 통과 백드롭은
//   mw-pinned로 제외) — × 버튼만이 닫는다. 여러 창이 떠 있으면 누른 창이 맨 앞으로 온다.
// - 백드롭은 고정 여부와 무관하게 **항상 마운트** — 고정 토글로 부모가 바뀌면 React가
//   내용물을 리마운트해 스크롤·탭 상태가 날아간다(설계 근거).
// - 창 머리(크롬 바)를 잡아 끌면 이동(첫 드래그에서 현재 위치를 고정 좌표로 떼어냄),
//   변·모서리 그립으로 크기 조절. 위치·크기는 화면 안으로 클램프.
//
// 대상 밖: 확인 대화상자·스캐너/렌즈 오버레이·라이트박스·팁 풍선 같은 일시적 UI.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "./i18n";

let zTop = 200; // .modal-backdrop 기본 z(100)보다 위에서 시작 — 창끼리는 이 카운터로 앞뒤 결정

// ── Esc 가드 — 최상단 창이 📌 고정이면 Esc 전파를 문서 캡처 단계에서 끊는다.
// 개별 모달들의 자체 Esc 핸들러(window keydown)·전역 esc-close가 전부 그 뒤 단계라
// 하나하나 고치지 않아도 고정 창을 못 닫게 된다. 단 레지스트리 밖 오버레이(스캐너·확인
// 대화상자)가 더 위에 떠 있으면 양보한다 — 그쪽 Esc는 정상 동작해야 하므로.
const windowRegistry = new Map<symbol, { z: number; pinned: boolean }>();
let escGuardBound = false;
function bindEscGuard() {
  if (escGuardBound || typeof document === "undefined") return;
  escGuardBound = true;
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Escape" && e.key !== "Esc") return;
    let top: { z: number; pinned: boolean } | null = null;
    for (const entry of windowRegistry.values()) if (!top || entry.z >= top.z) top = entry;
    if (!top?.pinned) return;
    for (const el of document.querySelectorAll<HTMLElement>(".modal-backdrop:not(.mw-backdrop)")) {
      if ((parseInt(getComputedStyle(el).zIndex, 10) || 0) > top.z) return; // 위에 일반 오버레이
    }
    e.stopPropagation();
  }, true);
}

const GRIPS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"]; // 모서리를 뒤에 — 변보다 위에 겹치게
const MIN_W = 280;
const MIN_H = 200;

type Pos = { x: number; y: number };
type Size = { w: number; h: number };

export function ModalWindow({ label, className, style, onClose, permanent, defaultPos, initialSize, chrome, onPinChange, children }: {
  label: string;
  className?: string;
  style?: React.CSSProperties;
  onClose: () => void;
  /** true = 항상 창 모드(백드롭 없음·고정 버튼 없음) — 치비 대화창처럼 상시 떠 있는 창 */
  permanent?: boolean;
  defaultPos?: Pos;
  initialSize?: Size;
  /** 크롬 바에 끼워 넣을 추가 버튼 (제목과 고정·닫기 사이) */
  chrome?: React.ReactNode;
  /** 고정 상태 변화 통지 — 해시 동기화 등 외부 상태가 고정 창을 닫아버리지 않게 게이트할 때 사용 */
  onPinChange?: (pinned: boolean) => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [z, setZ] = useState(() => ++zTop);
  const [pinned, setPinned] = useState(!!permanent);
  const [pos, setPos] = useState<Pos | null>(defaultPos ?? null);
  const [size, setSize] = useState<Size | null>(initialSize ?? null);
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const rsRef = useRef<{ dir: string; px: number; py: number; x: number; y: number; w: number; h: number } | null>(null);

  const raise = () => setZ((current) => (current === zTop ? current : ++zTop));

  const clamp = (x: number, y: number): Pos => {
    const el = panelRef.current;
    const w = el?.offsetWidth ?? 420;
    const h = el?.offsetHeight ?? 320;
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(y, Math.max(8, window.innerHeight - h - 8))),
    };
  };

  // 백드롭의 flex 중앙 정렬에서 떼어내 고정 좌표로 — 드래그·고정의 첫 순간에 현재 자리를 붙든다
  const detach = (): Pos => {
    if (pos) return pos;
    const r = panelRef.current?.getBoundingClientRect();
    const next = r ? { x: r.left, y: r.top } : { x: window.innerWidth / 2 - 220, y: 80 };
    setPos(next);
    return next;
  };

  const togglePin = () => {
    if (permanent) return;
    if (!pinned) detach(); // 백드롭이 통과로 바뀌어도 그 자리에 남게
    setPinned((value) => {
      onPinChange?.(!value);
      return !value;
    });
  };
  // 닫히면(언마운트) 고정 통지를 원복 — 다음 모달이 옛 게이트에 걸리지 않게
  useEffect(() => () => onPinChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onDragStart = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // 고정·닫기 버튼은 드래그가 아니다
    const at = detach();
    dragRef.current = { dx: e.clientX - at.x, dy: e.clientY - at.y };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d) setPos(clamp(e.clientX - d.dx, e.clientY - d.dy));
  };
  const onDragEnd = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onResizeStart = (e: React.PointerEvent, dir: string) => {
    const el = panelRef.current;
    if (!el) return;
    detach();
    const r = el.getBoundingClientRect();
    rsRef.current = { dir, px: e.clientX, py: e.clientY, x: r.left, y: r.top, w: r.width, h: r.height };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const s = rsRef.current;
    if (!s) return;
    const dx = e.clientX - s.px;
    const dy = e.clientY - s.py;
    let { x, y, w, h } = s;
    // 오른쪽·아래로 늘릴 땐 창을 움직이지 않고 화면 끝에서 멈춘다 — 왼쪽·위는 위치가 함께 움직인다
    if (s.dir.includes("e")) w = Math.min(Math.max(MIN_W, s.w + dx), window.innerWidth - 8 - s.x);
    if (s.dir.includes("s")) h = Math.min(Math.max(MIN_H, s.h + dy), window.innerHeight - 8 - s.y);
    if (s.dir.includes("w")) {
      w = Math.min(Math.max(MIN_W, s.w - dx), s.x + s.w - 8);
      x = s.x + (s.w - w);
    }
    if (s.dir.includes("n")) {
      h = Math.min(Math.max(MIN_H, s.h - dy), s.y + s.h - 8);
      y = s.y + (s.h - h);
    }
    setSize({ w, h });
    setPos({ x, y });
  };
  const onResizeEnd = (e: React.PointerEvent) => {
    if (!rsRef.current) return;
    rsRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // 화면 크기가 바뀌면 창을 다시 안쪽으로
  useEffect(() => {
    const onWindowResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);

  // Esc 가드 레지스트리 — z·고정 상태를 항상 최신으로
  const registryId = useRef<symbol | null>(null);
  if (registryId.current === null) registryId.current = Symbol("mw");
  useEffect(() => {
    bindEscGuard();
    const id = registryId.current!;
    windowRegistry.set(id, { z, pinned });
    return () => { windowRegistry.delete(id); };
  }, [z, pinned]);

  // body 포털 — 헤더(.site-header z:20, backdrop-filter) 같은 스태킹 컨텍스트 안에서 렌더되면
  // 창의 z가 그 컨텍스트에 갇혀 다른 모달 밑에 그려진다 (치비 대화창 실측 2026-08-03:
  // 아미야 모달이 위에 깔려 채팅 드래그가 아미야 창을 끌었다). 전 창이 body를 공통
  // 스태킹 루트로 쓰면 zTop 카운터가 전역에서 참이 된다.
  if (typeof document === "undefined") return null; // 프리렌더에는 창이 없다
  return createPortal(
    <div className={`modal-backdrop mw-backdrop${pinned ? " mw-pinned" : ""}`} style={{ zIndex: z }}
      onMouseDown={(e) => { if (!pinned && e.target === e.currentTarget) onClose(); }}>
      <section ref={panelRef}
        className={`mw-window ${className ?? ""}${dragging ? " mw-dragging" : ""}`}
        role="dialog" aria-modal={!pinned} aria-label={label}
        style={{
          ...style,
          ...(pos ? { position: "fixed", left: pos.x, top: pos.y, margin: 0 } : {}),
          ...(size ? { width: size.w, height: size.h, maxWidth: "none", maxHeight: "none" } : {}),
        }}
        onPointerDownCapture={raise}>
        {GRIPS.map((dir) => (
          <div key={dir} className={`mw-rs mw-rs-${dir}`} onPointerDown={(e) => onResizeStart(e, dir)}
            onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onResizeEnd} />
        ))}
        <div className={`mw-chrome${dragging ? " dragging" : ""}`}
          onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
          <span className="mw-title">{label}</span>
          {chrome}
          {!permanent && (
            <button type="button" className={`mw-pin${pinned ? " on" : ""}`} onClick={togglePin}
              title={pinned ? t("고정 해제 — 바깥 클릭·Esc로 닫히게") : t("고정 — 바깥을 클릭해도 닫히지 않게")}
              aria-pressed={pinned}
              aria-label={pinned ? t("고정 해제 — 바깥 클릭·Esc로 닫히게") : t("고정 — 바깥을 클릭해도 닫히지 않게")}>📌</button>
          )}
          <button type="button" className="modal-close mw-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        </div>
        <div className="mw-body">{children}</div>
      </section>
    </div>,
    document.body
  );
}
