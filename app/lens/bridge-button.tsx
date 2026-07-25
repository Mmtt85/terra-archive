"use client";

// 헤더의 게임 연결 버튼 — 크롬 확장(extension/)이 깔려 있을 때만 나타난다.
// 확장이 없는 사람에겐 헤더에 아무것도 늘지 않는다 (아직 실험이라 그게 맞다).
//
// 누르면 확장이 창 선택 피커를 띄우고, 고른 창의 프레임이 흐르기 시작한다.
// 그 뒤 인식·이동은 각 탭의 스샷 레이더 경로가 그대로 처리한다 (app/lens/bridge.ts 참고).

import { useBridgeStatus, connectBridge, disconnectBridge } from "./bridge";
import type { T } from "../i18n";

export default function BridgeButton({ t }: { t: T }) {
  const { installed, settings, gate, error } = useBridgeStatus();
  if (installed !== true) return null;

  const on = !!settings;
  // 진단 순서: 해상도 → 수신 프레임(탭이 가려져도 늘어야 한다) → 전송/틱 → 지금 국면
  const detail = on && settings
    ? `${settings.width}×${settings.height}`
      + (gate ? ` · ${t("수신")} ${gate.framesIn} · ${t("전송")} ${gate.emitted}/${gate.ticks} · ${gate.phase}` : "")
    : error || t("게임 창을 골라 화면을 자동으로 인식시킵니다");

  return (
    <button
      type="button"
      className={`omni-trigger bridge-trigger${on ? " on" : ""}`}
      title={detail}
      aria-label={on ? t("게임 연결 끊기") : t("게임 창 연결")}
      onClick={() => (on ? disconnectBridge() : connectBridge())}
    >
      <span aria-hidden>{on ? "◉" : "○"}</span>
      {on ? t("게임 연결됨") : t("게임 연결")}
    </button>
  );
}
