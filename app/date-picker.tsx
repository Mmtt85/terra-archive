"use client";
// 공용 날짜 고르기 — 누르면 달력이 펼쳐진다 (2026-10-13, 사용자 지시 "공용 카렌다 컴포넌트"). 브라우저 기본 <input type="date"> 는
// '연도. 월. 일.' 칸이 그대로 보이고 사이트 결(다크·글꼴)과 따로 놀았다. 단추·펼침 판은 공용 Dropdown(app/dropdown.tsx)과 같은
// 클래스(drop·drop-btn·drop-menu)라 바탕·테두리·호버·열림 모양이 저절로 같다. 값은 'YYYY-MM-DD' 문자열(입력란과 같은 꼴).

import { useEffect, useRef, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (v: string | undefined | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? "");
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null;
};
/** 오늘(한국 시간) — 관리 화면 기간이 KST 기준이다 */
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export function DatePicker({ value, onChange, min, max, ariaLabel, placeholder = "날짜 고르기", locale = "ko", className }: {
  /** 'YYYY-MM-DD' — 비어 있으면 placeholder */
  value: string | null | undefined;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  ariaLabel: string;
  placeholder?: string;
  locale?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  // 아래 공간이 모자라면 위로 펼친다 — 스크롤되는 목록 맨 밑(가챠 플래너 '일정 더하기')에서 아래로 열면 목록이 길어지며 무너졌다 (2026-10-17)
  const [dropUp, setDropUp] = useState(false);
  const cur = parse(value) ?? parse(max && todayKst() > max ? max : todayKst())!;
  const [view, setView] = useState({ y: cur.y, m: cur.m });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onEsc); };
  }, [open]);

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!open) {
      const p = parse(value) ?? cur;
      setView({ y: p.y, m: p.m });
      const r = e.currentTarget.getBoundingClientRect();
      setAlignRight(window.innerWidth - r.left < 280);
      // 아래 공간 = 화면 바닥 또는 가장 가까운 스크롤 상자 바닥까지 — 달력 판 높이(약 300px)가 안 들어가면 위로
      let box = e.currentTarget.parentElement;
      while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
      const bottom = Math.min(window.innerHeight, box ? box.getBoundingClientRect().bottom : window.innerHeight);
      setDropUp(bottom - r.bottom < 310 && r.top > 310);
    }
    setOpen((o) => !o);
  };
  const shift = (dm: number) => setView((v) => { const d = new Date(Date.UTC(v.y, v.m + dm, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const ok = (v: string) => (!min || v >= min) && (!max || v <= max);
  const pick = (v: string) => { if (!ok(v)) return; onChange(v); setOpen(false); };

  const p = parse(value);
  const label = p
    ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", timeZone: "UTC" }).format(Date.UTC(p.y, p.m, p.d))
    : placeholder;
  const head = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" }).format(Date.UTC(view.y, view.m, 1));
  const week = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(Date.UTC(2026, 9, 4 + i)));   // 2026-10-04 = 일요일
  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const today = todayKst();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  return (
    <div className={`drop date-pick${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button type="button" className={`drop-btn${p ? " on" : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel} onClick={toggle}>
        <span className="drop-label">{label}</span>
        <i className="drop-caret" aria-hidden>▾</i>
      </button>
      {open && (
        <div className={`drop-menu menu-anim date-menu${alignRight ? " align-right" : ""}${dropUp ? " drop-up" : ""}`} role="dialog" aria-label={ariaLabel}>
          <div className="date-head">
            <button type="button" onClick={() => shift(-1)} aria-label="이전 달">‹</button>
            <b>{head}</b>
            <button type="button" onClick={() => shift(1)} aria-label="다음 달">›</button>
          </div>
          <div className="date-grid" role="grid">
            {week.map((w, i) => <span key={`w${i}`} className={`date-wd${i === 0 ? " sun" : i === 6 ? " sat" : ""}`}>{w}</span>)}
            {cells.map((d, i) => {
              if (d == null) return <span key={`e${i}`} />;
              const v = ymd(view.y, view.m, d);
              const wd = (first + d - 1) % 7;
              return (
                <button key={v} type="button" disabled={!ok(v)} onClick={() => pick(v)}
                  className={["date-day", v === value ? "on" : "", v === today ? "today" : "", wd === 0 ? "sun" : wd === 6 ? "sat" : ""].filter(Boolean).join(" ")}>
                  {d}
                </button>
              );
            })}
          </div>
          <div className="date-foot">
            <button type="button" disabled={!ok(today)} onClick={() => pick(today)}>오늘</button>
          </div>
        </div>
      )}
    </div>
  );
}
