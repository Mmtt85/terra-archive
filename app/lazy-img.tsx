"use client";

import { useEffect, useRef, useState } from "react";

// 오퍼 백과사전 420장 아바타를 한 번에 요청하지 않기 위한 lazy-reveal 훅.
// 브라우저 네이티브 loading="lazy"는 UA·연결 속도에 따라 미리보기 여유 폭(root margin)이
// 꽤 넓어(수백~2000px대) 진입 즉시 상당수가 선행 요청된다 (사용자 리포트 2026-07-22:
// "들어가자마자 다 다운받는다"). 대신 카드가 스크롤 컨테이너 근처(margin)에 실제로
// 들어오기 전엔 <img>를 아예 마운트하지 않아 요청 자체가 안 나가게 한다. 한 번 보인 카드는
// 계속 렌더 유지(다시 스크롤해 나가도 재요청 안 함). 카드마다 별도 IntersectionObserver를
// 만들지 않고 margin값별로 하나씩 공유해 420개 관찰자 생성 비용을 없앤다.
const shared = new Map<string, { io: IntersectionObserver; reveal: Map<Element, () => void> }>();

function sharedObserver(margin: string) {
  let entry = shared.get(margin);
  if (!entry) {
    const reveal = new Map<Element, () => void>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          reveal.get(e.target)?.();
        }
      },
      { rootMargin: margin },
    );
    entry = { io, reveal };
    shared.set(margin, entry);
  }
  return entry;
}

// margin: 화면(정확히는 뷰포트 — 중첩 스크롤 컨테이너 안이어도 실제 화면 좌표 기준이라 그대로
// 잘 맞는다)에서 이만큼 여유를 두고 미리 드러낸다. 기본 480px ≈ 카드 두어 줄 앞.
export function useLazyVisible<T extends Element = HTMLDivElement>(margin = "480px 0px") {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const { io, reveal } = sharedObserver(margin);
    const onReveal = () => { setVisible(true); io.unobserve(el); reveal.delete(el); };
    reveal.set(el, onReveal);
    io.observe(el);
    return () => { io.unobserve(el); reveal.delete(el); };
  }, [margin, visible]);
  return [ref, visible] as const;
}
