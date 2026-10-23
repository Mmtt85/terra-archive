"use client";

// 로케일별 이벤트 도감 래퍼 — 자기 언어 데이터만 정적 임포트한다 (app/enemies-en.tsx와 같은 관례).
// 한 모듈에서 세 로케일을 동적 선택하면 셋 다 같은 청크에 묶인다.
import EventDex, { type EventDoc } from "./events";
import base from "./data/events.en.json";
import crisis from "./data/events-crisis.en.json";

// 위기 협약 시즌·홀로그램 매트릭스 (scripts/build-stages-crisis.py, 2026-10-16) — 2026-10-23부터 **위기 협약 가이드(/crisis)** 로 따로 뺐다
// (사용자 지시 "이벤트 가이드에서 빼서 위기협약 가이드로 따로 메뉴"). 이벤트 가이드 목록엔 안 싣고, 모달만 띄울 때(헤더 칩·작전 배지에서
// 시즌을 누를 때)는 둘 다 찾을 수 있게 합친 문서를 쓴다. 시작일 순(최신 위), 미실장(시작일 없음)은 맨 위 그대로 — sort 는 안정 정렬
const byStart = (a: { start?: string | null }, b: { start?: string | null }) => (b.start ?? "9999").localeCompare(a.start ?? "9999");
const crisisDoc = { ...base, events: [...crisis.events].sort(byStart) };
const fullDoc = { ...base, events: [...base.events, ...crisis.events].sort(byStart) };

export default function EventDexEN({ onShowOperator, onOpenGuide, modalOnly, initialId, onCloseModal, crisisOnly }: {
  onShowOperator: (id: string) => void; onOpenGuide: (seg: string) => void;
  /** 목록 없이 모달만 (헤더 이벤트 버튼 — app/events.tsx 의 modalOnly 주석 참조) */
  modalOnly?: boolean; initialId?: string | null; onCloseModal?: () => void;
  /** 위기 협약 가이드 — 위기 협약 시즌·홀로그램 매트릭스만 */
  crisisOnly?: boolean;
}) {
  const doc = crisisOnly ? crisisDoc : modalOnly ? fullDoc : base;
  return <EventDex doc={doc as unknown as EventDoc} onShowOperator={onShowOperator} onOpenGuide={onOpenGuide}
    modalOnly={modalOnly} initialId={initialId} onCloseModal={onCloseModal} crisis={crisisOnly} />;
}
