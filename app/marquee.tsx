"use client";

// 넘칠 때만 흘러가는 한 줄 — 넘치지 않으면 아무 일도 하지 않는다.
//
// 공개채용 도우미의 입력 안내문이 2026-09-20에 먼저 이 방식을 썼고(.quick-ph),
// 같은 것이 또 필요해져서(인프라 '하루 드론 회복'이 칸을 삐져나갔다 — 사용자 제보
// 2026-09-23) 여기로 빼 둔다. 새로 필요한 곳이 생기면 감싸기만 하면 된다.
//
// ⚠ **넘침은 CSS가 감지하지 못한다.** 그래서 폭을 재서 `data-mq="run"` 을 붙이는 일은
//   JS가 하고, 움직임은 CSS(globals.css `.mq`)가 맡는다.
// ⚠ 내용을 **두 벌** 그린다 — 한 벌이 왼쪽으로 빠져나가는 동안 뒤 벌이 이어 들어와야
//   끊기지 않는다. 넘치지 않을 때는 뒤 벌을 CSS가 감춘다.
// ⚠ 흐르는 속도는 길이에 비례한다 (초당 28px) — 짧은 글이 쏜살같이 지나가지 않게.
// ⚠ prefers-reduced-motion 을 지킨다 (globals.css). 움직임이 꺼져도 앞 벌은 그대로 읽힌다.

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/** 두 벌 사이 간격(px). globals.css 의 `.mq-run > i { padding-right }` 와 반드시 같아야 한다. */
const MQ_GAP = 48;
/** 초당 흐르는 거리(px) */
const MQ_SPEED = 28;

export function Marquee({ children, className }: { children: ReactNode; className?: string }) {
  const host = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = host.current;
    const copy = el?.querySelector<HTMLElement>(":scope > .mq-run > i");
    if (!el || !copy) return;
    const measure = () => {
      const width = copy.offsetWidth - MQ_GAP;
      const over = width > el.clientWidth + 1;
      el.dataset.mq = over ? "run" : "";
      if (over) el.style.setProperty("--mq-dur", `${Math.max(8, Math.round((width + MQ_GAP) / MQ_SPEED))}s`);
      else el.style.removeProperty("--mq-dur");
    };
    measure();
    // 칸이 좁아지거나(회전·창 크기) 글이 바뀌면(값 갱신) 다시 잰다
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(copy);
    return () => observer.disconnect();
  });

  return (
    <span className={`mq${className ? ` ${className}` : ""}`} ref={host}>
      <span className="mq-run">
        <i>{children}</i>
        <i aria-hidden>{children}</i>
      </span>
    </span>
  );
}
