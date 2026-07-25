"use client";

// 헤더의 "게임 연결" 버튼 — 누르면 크롬 창 선택 피커가 뜨고, 고른 게임 창의 화면이
// 흐르기 시작한다. 그 뒤 인식·이동은 각 탭의 스샷 레이더 경로가 그대로 처리한다.
// (설치할 것 없음 — 크롬 확장은 얻는 게 없어서 걷어냈다. app/lens/bridge.ts 참고)

import { useSyncExternalStore } from "react";
import { useBridgeStatus, connectBridge, disconnectBridge, bridgeSupported } from "./bridge";
import type { T } from "../i18n";

// 지원 여부는 navigator를 봐야 알 수 있어 서버에선 판단할 수 없다. 그냥 호출하면
// 서버(없음)와 클라이언트(있음)의 렌더 결과가 갈려 하이드레이션이 깨지므로(React #418),
// 서버 스냅샷을 false로 고정하는 useSyncExternalStore로 읽는다.
const noSubscribe = () => () => { /* 값이 바뀌지 않는다 */ };

export default function BridgeButton({ t }: { t: T }) {
  const { settings, gate, error } = useBridgeStatus();
  const supported = useSyncExternalStore(noSubscribe, bridgeSupported, () => false);
  if (!supported) return null;   // 사파리·파이어폭스 — 스샷 경로는 그대로 쓸 수 있다

  const on = !!settings;
  // 진단 순서: 해상도 → 수신 프레임(탭이 가려져도 늘어야 한다) → 인식 횟수/틱 → 지금 국면
  const detail = on && settings
    ? `${settings.width}×${settings.height}`
      + (gate ? ` · ${t("수신")} ${gate.framesIn} · ${t("인식")} ${gate.emitted}/${gate.ticks} · ${gate.phase}` : "")
    : error || t("게임 창을 골라 화면을 자동으로 인식시킵니다");

  return (
    <button
      type="button"
      className={`omni-trigger bridge-trigger${on ? " on" : ""}`}
      title={detail}
      aria-label={on ? t("게임 연결 끊기") : t("게임 창 연결")}
      onClick={() => (on ? disconnectBridge() : void connectBridge())}
    >
      <span aria-hidden>{on ? "◉" : "○"}</span>
      {on ? t("게임 연결됨") : t("게임 연결")}
    </button>
  );
}
