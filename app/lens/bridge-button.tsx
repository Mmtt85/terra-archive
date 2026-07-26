"use client";

// 헤더의 "게임 연결" 버튼 — 누르면 크롬 창 선택 피커가 뜨고, 고른 게임 창의 화면이
// 흐르기 시작한다. 그 뒤 인식·이동은 각 탭의 스샷 레이더 경로가 그대로 처리한다.
// (설치할 것 없음 — 크롬 확장은 얻는 게 없어서 걷어냈다. app/lens/bridge.ts 참고)
//
// 버튼 아래에 상태를 실시간으로 적는다 (사용자 요청 2026-07-26). 배경에서 도는
// 기능이라 상태가 안 보이면 "느리다/안 된다"의 원인을 짚을 수가 없다:
//   해상도 · 수신(캡처가 준 프레임) · 인식 횟수 · 지금 국면 · 마지막 판정 결과

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

export default function BridgeButton({ t }: { t: T }) {
  const { settings, gate, error, busy, note, lock } = useBridgeStatus();
  const supported = useSyncExternalStore(noSubscribe, bridgeSupported, () => false);
  if (!supported) return null;   // 사파리·파이어폭스 — 스샷 경로는 그대로 쓸 수 있다

  const on = !!settings;
  const phase = busy ? t("인식 중…") : t(PHASE[gate?.phase ?? ""] ?? "연결됨");

  return (
    <span className="bridge-wrap">
      <button
        type="button"
        className={`omni-trigger bridge-trigger${on ? " on" : ""}`}
        aria-label={on ? t("게임 연결 끊기") : t("게임 창 연결")}
        title={on ? "" : error || t("게임 창을 골라 화면을 자동으로 인식시킵니다")}
        onClick={() => (on ? disconnectBridge() : void connectBridge())}
      >
        <span aria-hidden>{on ? "◉" : "○"}</span>
        {on ? t("게임 연결됨") : t("게임 연결")}
      </button>
      {on && settings && (
        <span className={`bridge-status${busy ? " busy" : ""}`} aria-live="polite">
          {lock && <b>{t(lock.name)} {t("고정")} · </b>}
          <b>{phase}</b>
          {` · ${settings.width}×${settings.height}`}
          {gate ? ` · ${t("수신")} ${gate.framesIn} · ${t("인식")} ${gate.emitted}` : ""}
          {note ? ` · ${note}` : ""}
        </span>
      )}
      {!on && error && <span className="bridge-status err">{error}</span>}
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
  const other = !!settings && !mine;                  // 다른 곳에서 연결됨 (전역 or 다른 테마)
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
