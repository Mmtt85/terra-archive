"use client";

// 공용 드롭다운 — **버튼 하나 + 목록 하나**짜리 한 칸 컨트롤.
// 종전에는 화면마다 제각각이었다 (사용자 지시 2026-08-25 "드랍다운인데 공용 드랍다운
// 안쓰는애들은 전부다 쓰게 해 줘"): 위수 협의 4개는 .ac-garsel, 언어 선택은 .server-chip,
// 록라 토픽은 .rg-topicsel, 오퍼 정렬·리더기 에피소드는 네이티브 <select>였다.
// 여닫는 방식(바깥 클릭·Esc)도 화면마다 따로 구현돼 한 곳을 고쳐도 나머지가 안 따라왔다.
//
// ⚠ 여러 **축**을 한 컨트롤에 묶는 속성 필터는 attr-filter.tsx(AttributeFilter)가 따로 있다.
//   여기는 축이 하나인 자리 전용이다. multi로 그 축 안에서 여러 값을 고를 수는 있다.
import { useEffect, useRef, useState } from "react";

export type DropItem = {
  value: string;
  label: React.ReactNode;
  /** 줄 오른쪽 끝의 회색 숫자 (건수 등) */
  count?: number | string;
  disabled?: boolean;
};

/** 오른쪽 공간이 이만큼도 없으면 왼쪽으로 펼친다 (.ac-garsel과 같은 규약) */
const MENU_MIN_SPACE = 240;

export function Dropdown({
  label, items, selected, onPick, multi, ariaLabel,
  className, buttonClassName, scroll, disabled,
}: {
  /** 버튼에 보일 현재 상태 */
  label: React.ReactNode;
  items: DropItem[];
  selected: string[];
  onPick: (value: string) => void;
  /** 여러 개 고르기 — 고른 뒤에도 목록을 **닫지 않는다** (연달아 고르는 게 자연스럽다) */
  multi?: boolean;
  ariaLabel: string;
  className?: string;
  buttonClassName?: string;
  /** 항목이 많은 목록 — 최대 높이를 두고 스크롤 */
  scroll?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // 바깥 클릭·Esc로 닫기 — 종전에는 화면마다 따로 달려 있었다
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onEsc); };
  }, [open]);

  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    // 열기 직전에 오른쪽 여유를 재서 펼칠 방향을 정한다 — 화면 오른끝 버튼이 잘리던 문제
    const rect = event.currentTarget.getBoundingClientRect();
    setAlignRight(rect.left + MENU_MIN_SPACE > window.innerWidth);
    setOpen((value) => !value);
  };

  return (
    <div className={`drop${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button type="button" disabled={disabled}
        className={`drop-btn${selected.length > 0 ? " on" : ""}${buttonClassName ? ` ${buttonClassName}` : ""}`}
        aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} onClick={toggle}>
        <span className="drop-label">{label}</span>
        {/* 캐럿은 .drop-caret이 1em 칸을 잡는다 — ▾/▴의 자체 폭이 달라 버튼이 흔들리던 문제 */}
        <i className="drop-caret" aria-hidden>▾</i>
      </button>
      {open && (
        <ul className={`drop-menu${alignRight ? " align-right" : ""}${scroll ? " scroll" : ""}`}
          role="menu" aria-label={ariaLabel}>
          {items.map((item) => {
            const on = selected.includes(item.value);
            return (
              <li key={item.value} role="none">
                <button type="button" role={multi ? "menuitemcheckbox" : "menuitemradio"}
                  aria-checked={on} disabled={item.disabled} className={on ? "on" : ""}
                  onClick={() => { onPick(item.value); if (!multi) setOpen(false); }}>
                  <span>{item.label}</span>
                  {item.count !== undefined && <em>{item.count}</em>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
