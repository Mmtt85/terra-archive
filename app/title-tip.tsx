"use client";

// 사이트 전체 툴팁 — title 속성을 브라우저 기본 툴팁 대신 사이트가 그린다 (사용자 지시 2026-10-14 "마우스 오버 뒤 바로 툴팁", 0.5초).
// 브라우저 기본 툴팁은 뜨는 시간을 정할 수 없다(크롬 1~1.5초, 브라우저마다 다름). 그래서 마우스가 title 있는 요소에 올라가면
// title 을 잠깐 data-ta-title 로 옮겨 기본 툴팁을 막고, TIP_DELAY 뒤 이 상자를 띄운다. 벗어나면 title 을 되돌린다.
// 마우스(pointerType mouse)만 — 터치는 원래 툴팁이 없다. 283곳의 title 을 하나하나 고치지 않고 한 곳에서 건다.
// 작전 지도 범례의 data-tip(즉시 뜨는 CSS 툴팁)은 따로 있다 — title 이 없어 여기 걸리지 않는다.
import { useEffect, useRef, useState } from "react";

const TIP_DELAY = 500;   // 0.5초 (사용자 지시 2026-10-14 — 처음엔 1초)
const STASH = "data-ta-title";

export default function TitleTip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    let el: Element | null = null;
    let timer = 0;
    let last = { x: 0, y: 0 };
    const restore = () => {
      if (el && el.hasAttribute(STASH)) {
        if (!el.hasAttribute("title")) el.setAttribute("title", el.getAttribute(STASH) ?? "");
        el.removeAttribute(STASH);
      }
    };
    const hide = () => {
      window.clearTimeout(timer);
      restore();
      el = null;
      setTip(null);
    };
    // 렌더가 title 을 다시 써 넣으면(문구 갱신) 그걸 새 문구로 삼고 다시 감춘다 — 안 그러면 기본 툴팁이 같이 뜬다
    const stash = (target: Element) => {
      const t = target.getAttribute("title");
      if (t !== null) { target.setAttribute(STASH, t); target.removeAttribute("title"); }
      return target.getAttribute(STASH) ?? "";
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const target = (e.target as Element | null)?.closest?.("[title], [" + STASH + "]");
      if (target === el) return;
      hide();
      if (!target || target instanceof SVGElement) return;
      const text = stash(target).trim();
      if (!text) { restore(); return; }
      el = target;
      last = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        if (!el) return;
        const now = stash(el).trim();
        if (now) setTip({ text: now, x: last.x, y: last.y });
      }, TIP_DELAY);
    };
    const onMove = (e: PointerEvent) => {
      if (!el) return;
      last = { x: e.clientX, y: e.clientY };
      if (el.hasAttribute("title")) stash(el);
    };
    const onOut = (e: PointerEvent) => {
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      hide();
    };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // 화면 밖으로 나가지 않게 — 그린 뒤 크기를 재서 커서 오른쪽 아래, 모자라면 왼쪽·위로
  useEffect(() => {
    if (!tip) { setPos(null); return; }
    const b = boxRef.current;
    if (!b) return;
    const w = b.offsetWidth, h = b.offsetHeight;
    let left = tip.x + 12, top = tip.y + 18;
    if (left + w > window.innerWidth - 8) left = Math.max(8, tip.x - w - 12);
    if (top + h > window.innerHeight - 8) top = Math.max(8, tip.y - h - 12);
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={boxRef} className="ta-tip" role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>{tip.text}</div>
  );
}
