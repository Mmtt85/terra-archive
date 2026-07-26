"use client";

// 게임 연결 표시 (헤더) — **상태 현황만** 보여준다 (사용자 확정 2026-07-26: 헤더의
// 연결 버튼은 없애고 상태만). 연결 자체는 /rogue 각 테마의 게임 연결 버튼에서 한다
// (BridgeTopicButton — 그 테마로 인식이 하드 고정된다).
// 연결 전에는 아무것도 그리지 않아 헤더에 늘어나는 것이 없다.

import { useSyncExternalStore } from "react";
import { useBridgeStatus, connectBridge, disconnectBridge, bridgeSupported } from "./bridge";
import type { T } from "../i18n";

// 지원 여부는 navigator를 봐야 알 수 있어 서버에선 판단할 수 없다. 그냥 호출하면
// 서버(없음)와 클라이언트(있음)의 렌더 결과가 갈려 하이드레이션이 깨지므로(React #418),
// 서버 스냅샷을 false로 고정하는 useSyncExternalStore로 읽는다.
const noSubscribe = () => () => { /* 값이 바뀌지 않는다 */ };

const PHASE: Record<string, string> = {
  moving: "화면 변하는 중", settling: "멈추길 기다리는 중", same: "같은 화면", emit: "새 화면",
};

/** 헤더 상태 칩 — 연결 중일 때만 나타난다. 클릭은 연결 끊기(연결 시작은 여기서 못 한다). */
export default function BridgeButton({ t }: { t: T }) {
  const { settings, gate, error, busy, note, lock } = useBridgeStatus();
  if (!settings) return null;   // 연결 전·미지원 — 헤더에 아무것도 늘리지 않는다

  const phase = busy ? t("인식 중…") : t(PHASE[gate?.phase ?? ""] ?? "연결됨");

  return (
    <span className="bridge-wrap">
      <button
        type="button"
        className="omni-trigger bridge-trigger on"
        aria-label={t("게임 연결 끊기")}
        title={t("게임 연결 끊기")}
        onClick={() => disconnectBridge()}
      >
        <span aria-hidden>◉</span>
        {t("게임 연결됨")}
      </button>
      <span className={`bridge-status${busy ? " busy" : ""}`} aria-live="polite">
        {lock && <b>{t(lock.name)} {t("고정")} · </b>}
        <b>{phase}</b>
        {` · ${settings.width}×${settings.height}`}
        {gate ? ` · ${t("수신")} ${gate.framesIn} · ${t("인식")} ${gate.emitted}` : ""}
        {note ? ` · ${note}` : ""}
        {error ? ` · ${error}` : ""}
      </span>
    </span>
  );
}

/** 테마별 게임연결 — /rogue 툴바용 (사용자 확정 2026-07-26: "사미록라의 게임연결 버튼은
 *  무조건 사미록라만"). 여기서 연결하면 인식이 그 테마 밖을 아예 보지 않는다. */
export function BridgeTopicButton({ topic, name, t }: { topic: string; name: string; t: T }) {
  const { settings, lock } = useBridgeStatus();
  const supported = useSyncExternalStore(noSubscribe, bridgeSupported, () => false);
  if (!supported) return null;

  const mine = !!settings && lock?.topic === topic;   // 이 테마로 고정 연결됨
  const other = !!settings && !mine;                  // 다른 테마에서 연결됨
  return (
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
  );
}
