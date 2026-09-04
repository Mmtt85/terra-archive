"use client";

// 미실장(중섭 선행) 항목의 안내 툴팁 — "미래시 데이터 포함을 켜야 활성화됩니다"
// (사용자 요청 2026-09-04).
//
// 2026-09-04에 미래시 규칙이 바뀌면서 미실장 항목은 **숨지 않고 흑백(.fut-dim)으로 남는다**.
// 그러면 "왜 이건 회색이지 / 왜 안 눌리지"가 바로 따라오므로, 그 자리에서 답을 준다.
//
// 왜 컴포넌트마다 붙이지 않고 **위임 리스너 하나**인가:
//   .fut-dim 은 오퍼 카드·모듈·기록·재료·플래너 로스터·탭 메뉴까지 성격이 제각각인 곳에
//   붙는다. 각자 상태를 들고 있게 하면 같은 코드가 여섯 벌이 되고, 새로 .fut-dim 을 붙인
//   화면은 조용히 툴팁이 빠진다. document 한 곳에서 closest(".fut-dim") 로 받으면
//   **클래스만 붙이면 자동으로 따라온다.**
//
// 데스크탑 = 마우스를 따라다니는 이름표, 모바일 = 탭한 자리.
//
// ⚠ **미래시가 꺼져 있으면 .fut-dim 은 아예 눌리지 않는다** (사용자 지시 2026-09-04:
//   "메뉴든 뭐든, 보이기만 하고 클릭은 안되게"). 여기서 캡처 단계로 클릭을 통째로 삼키고
//   대신 툴팁을 띄운다 — 카드·메뉴·링크·버튼이 제각각 막을 필요가 없고, 새로 .fut-dim 을
//   붙인 화면도 자동으로 같은 규칙을 따른다. 토글을 켜면 이 가로채기가 통째로 꺼진다.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "./i18n";

/** 커서에서 툴팁까지 띄우는 간격 — 커서 아래 그림자에 글자가 묻히지 않을 만큼만 */
const GAP = 16;

export default function FutureTip() {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // ⚠ 좌표는 **state 로 두지 않는다** — 마우스를 따라다니려면 초당 60번 갱신인데, 그때마다
  //   리렌더하면 목록 400장짜리 화면에서 눈에 띄게 버벅인다. ref 로 들고 DOM 을 직접 민다.
  const at = useRef({ x: 0, y: 0 });

  useEffect(() => {
    // 미래시가 켜져 있으면 흑백도 잠금도 없다 — 툴팁도 뜨지 않는다.
    const off = () => document.documentElement.dataset.fut !== "1";
    const hit = (target: EventTarget | null): Element | null => {
      if (!(target instanceof Element)) return null;
      const el = target.closest(".fut-dim");
      return el && off() ? el : null;
    };
    // 커서 오른쪽 아래에 달되, 화면 밖으로 나가려 하면 반대쪽으로 넘긴다.
    // (오른쪽 끝 카드에서 툴팁이 잘리던 것 — 폭을 재서 그 자리에서 접는다)
    const paint = () => {
      const box = boxRef.current;
      if (!box) return;
      const w = box.offsetWidth, h = box.offsetHeight;
      const { x, y } = at.current;
      const left = x + GAP + w > window.innerWidth ? Math.max(4, x - GAP - w) : x + GAP;
      const top = y + GAP + h > window.innerHeight ? Math.max(4, y - GAP - h) : y + GAP;
      box.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;   // 터치는 아래 block 이 맡는다
      const el = hit(event.target);
      if (!el) { setShown(false); return; }
      at.current = { x: event.clientX, y: event.clientY };
      setShown(true);
      paint();                                     // 이미 떠 있으면 이 프레임에 바로 따라온다
    };
    // 캡처 단계 — React 핸들러(모달 열기·탭 전환)보다 먼저 받아야 클릭을 막을 수 있다.
    // 여기서 끊지 않으면 카드가 모달을 열거나 앵커가 그대로 이동해 버린다.
    const block = (event: Event) => {
      const el = hit(event.target);
      if (!el) { if (event.type === "click") setShown(false); return; }
      event.preventDefault();
      event.stopPropagation();
      if (event.type !== "click") return;
      // 터치는 커서가 없다 — 누른 자리(없으면 그 항목 위)에 띄운다
      const m = event as MouseEvent;
      if (m.clientX || m.clientY) at.current = { x: m.clientX, y: m.clientY };
      else { const r = el.getBoundingClientRect(); at.current = { x: r.left + r.width / 2, y: r.bottom }; }
      setShown(true);
      paint();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") block(event);
    };
    const away = () => setShown(false);

    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", away);
    document.addEventListener("click", block, true);
    // 가운데 클릭(새 탭)·키보드 Enter/Space 도 같은 취급 — 링크가 살아 있으면 안 된다
    document.addEventListener("auxclick", block, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", away);
      document.removeEventListener("click", block, true);
      document.removeEventListener("auxclick", block, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, []);

  // 뜨는 첫 프레임에도 제자리에 있도록 — 마운트 직후 한 번 밀어 준다
  useEffect(() => {
    const box = boxRef.current;
    if (!shown || !box) return;
    const w = box.offsetWidth, h = box.offsetHeight;
    const { x, y } = at.current;
    const left = x + GAP + w > window.innerWidth ? Math.max(4, x - GAP - w) : x + GAP;
    const top = y + GAP + h > window.innerHeight ? Math.max(4, y - GAP - h) : y + GAP;
    box.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }, [shown]);

  if (!shown || typeof document === "undefined") return null;
  return createPortal(
    <div className="fut-tip" role="status" ref={boxRef}>
      {t("아직 한국 서버에 나오지 않은 항목입니다 — 헤더를 펼쳐 '미래시 데이터 포함'을 켜면 활성화됩니다.")}
    </div>,
    document.body,
  );
}
