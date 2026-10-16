"use client";

// 로케일별 이벤트 도감 래퍼 — 자기 언어 데이터만 정적 임포트한다 (app/enemies-en.tsx와 같은 관례).
// 한 모듈에서 세 로케일을 동적 선택하면 셋 다 같은 청크에 묶인다.
import EventDex, { type EventDoc } from "./events";
import base from "./data/events.en.json";
import crisis from "./data/events-crisis.en.json";

// 위기 협약 시즌·홀로그램 매트릭스 (scripts/build-stages-crisis.py, 2026-10-16) — 시작일 순(최신 위)으로 끼워 넣는다.
// 미실장(시작일 없음)은 맨 위 그대로 — 화면이 미실장 줄로 따로 모은다. sort 는 안정 정렬이라 같은 날은 원래 순서
const doc = { ...base, events: [...base.events, ...crisis.events]
  .sort((a, b) => ((b as { start?: string | null }).start ?? "9999").localeCompare((a as { start?: string | null }).start ?? "9999")) };

export default function EventDexEN({ onShowOperator, onOpenGuide, modalOnly, initialId, onCloseModal }: {
  onShowOperator: (id: string) => void; onOpenGuide: (seg: string) => void;
  /** 목록 없이 모달만 (헤더 이벤트 버튼 — app/events.tsx 의 modalOnly 주석 참조) */
  modalOnly?: boolean; initialId?: string | null; onCloseModal?: () => void;
}) {
  return <EventDex doc={doc as unknown as EventDoc} onShowOperator={onShowOperator} onOpenGuide={onOpenGuide}
    modalOnly={modalOnly} initialId={initialId} onCloseModal={onCloseModal} />;
}
