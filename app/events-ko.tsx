"use client";

// 로케일별 이벤트 도감 래퍼 — 자기 언어 데이터만 정적 임포트한다 (app/enemies-ko.tsx와 같은 관례).
// 한 모듈에서 세 로케일을 동적 선택하면 셋 다 같은 청크에 묶인다.
import EventDex, { type EventDoc } from "./events";
import doc from "./data/events.json";

export default function EventDexKO({ onShowOperator, onOpenGuide }: {
  onShowOperator: (id: string) => void; onOpenGuide: (seg: string) => void;
}) {
  return <EventDex doc={doc as unknown as EventDoc} onShowOperator={onShowOperator} onOpenGuide={onOpenGuide} />;
}
