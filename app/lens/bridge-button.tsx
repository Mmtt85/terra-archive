"use client";

// 게임 연결 표시 — **토스트**로 항상 최상위에 떠 있다 (사용자 확정 2026-07-26:
// "모달창이 뜨면 뒷쪽이 어두워지니까" 헤더 인라인 대신 z-index 최상위 토스트 + 연결해제 버튼).
// 연결 자체는 /rogue 각 테마의 게임 연결 버튼에서 한다 (BridgeTopicButton — 테마 하드 고정).
// 연결 전에는 아무것도 그리지 않는다.

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useBridgeStatus, connectBridge, disconnectBridge, bridgeSupported, bridgeLogCount } from "./bridge";
import BridgeReplayModal from "./bridge-replay";
import type { T } from "../i18n";

// 지원 여부는 navigator를 봐야 알 수 있어 서버에선 판단할 수 없다. 그냥 호출하면
// 서버(없음)와 클라이언트(있음)의 렌더 결과가 갈려 하이드레이션이 깨지므로(React #418),
// 서버 스냅샷을 false로 고정하는 useSyncExternalStore로 읽는다.
const noSubscribe = () => () => { /* 값이 바뀌지 않는다 */ };

const PHASE: Record<string, string> = {
  moving: "화면 변하는 중", settling: "멈추길 기다리는 중", same: "같은 화면", emit: "새 화면",
  battle: "전투 중", replay: "본 화면 재적용",
};

/** 연결 상태 토스트 — 문서 최상위에 포털로 그려 모달 백드롭 위에도 항상 보인다. */
export default function BridgeButton({ t }: { t: T }) {
  const { settings, gate, busy, note, lock } = useBridgeStatus();
  if (!settings) return null;   // 연결 전·미지원 — 아무것도 그리지 않는다

  const phase = busy ? t("인식 중…") : t(PHASE[gate?.phase ?? ""] ?? "연결됨");

  return createPortal(
    <div className={`bridge-toast${busy ? " busy" : ""}`} aria-live="polite" role="status">
      <span className="bridge-dot" aria-hidden>◉</span>
      <span className="bridge-toast-text">
        {lock ? <b>{t(lock.name)}</b> : <b>{t("게임 연결됨")}</b>}
        {` · `}<b>{phase}</b>
        {gate ? ` · ${t("인식")} ${gate.emitted} · ${t("기록")} ${bridgeLogCount()}` : ""}
        {note ? ` · ${note}` : ""}
      </span>
      <button type="button" className="bridge-toast-off" onClick={disconnectBridge} title={t("게임 연결 끊기")}>
        {t("연결 끊기")}
      </button>
    </div>,
    document.body,
  );
}

/** 테마별 게임연결 — /rogue 툴바용 (사용자 확정 2026-07-26: "사미록라의 게임연결 버튼은
 *  무조건 사미록라만"). 여기서 연결하면 인식이 그 테마 밖을 아예 보지 않는다.
 *  리플레이 버튼은 프리뷰 모달을 연다 (즉시 다운로드 아님 — JSON 가져오기/내보내기는 모달 안). */
export function BridgeTopicButton({ topic, name, t }: { topic: string; name: string; t: T }) {
  const { settings, lock } = useBridgeStatus();
  const supported = useSyncExternalStore(noSubscribe, bridgeSupported, () => false);
  const [replayOpen, setReplayOpen] = useState(false);
  if (!supported) return null;

  const mine = !!settings && lock?.topic === topic;   // 이 테마로 고정 연결됨
  const other = !!settings && !mine;                  // 다른 테마에서 연결됨
  return (
    <>
      <button
        type="button"
        className={`lens-open-btn bridge-topic-btn${mine ? " on" : ""}`}
        title={mine
          ? t("게임 연결 끊기")
          : other
            ? t("다시 연결하면 이 테마로만 인식하도록 고정됩니다")
            : t("게임 창을 골라 이 테마로만 인식하도록 연결합니다")}
        onClick={() => (mine ? disconnectBridge() : void connectBridge({ topic, name }))}
      >
        <span aria-hidden>{mine ? "◉" : "○"}</span> {mine ? t("게임 연결됨") : t("게임 연결")}
      </button>
      <button
        type="button"
        className="lens-open-btn bridge-log-btn"
        title={t("플레이 기록을 미리 보고 JSON으로 가져오거나 내보냅니다")}
        onClick={() => setReplayOpen(true)}
      >
        <span aria-hidden>▤</span> {t("리플레이")}
      </button>
      {replayOpen && <BridgeReplayModal t={t} onClose={() => setReplayOpen(false)} />}
    </>
  );
}
