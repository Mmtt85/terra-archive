"use client";

// 테라 브리지 — 크롬 확장이 보내는 게임 창 프레임을 받는 쪽 (사이트).
//
// 확장(extension/)은 창 선택과 캡처, 변화 감지까지만 한다. 여기부터는 **기존 스샷 레이더와
// 완전히 같은 길**이다: 프레임을 File로 만들어 각 탭의 handleLensShot에 넘기면
// recognizeShot → 판정 → 이동이 이미 있는 코드로 돌아간다. 그래서 이 파일에는
// 인식 로직도 이동 로직도 없다 — 클립보드 감시(clipwatch.ts)의 형제일 뿐이다.
//
// 연결은 사이트 전체에서 하나다(캡처는 창 하나) — 그래서 모듈 싱글턴으로 두고,
// 헤더 버튼이 연결을 켜고 각 탭이 프레임을 구독한다.

import { useEffect, useRef, useState } from "react";

const TAG = "ta-bridge";

export type BridgeSettings = {
  label: string; width: number; height: number;
  reportedWidth: number | null; reportedHeight: number | null;
  frameRate: number | null; devicePixelRatio: number;
};
// framesIn = 확장이 캡처에서 실제로 받은 프레임 수. 탭이 가려진 동안에도 이게 늘어야
// 백그라운드 인식이 도는 것이다 — 헤더 버튼 툴팁에 그대로 노출한다(진단용).
export type BridgeGate = { phase: string; ticks: number; emitted: number; moving: number; framesIn: number };
export type BridgeFrame = { url: string; w: number; h: number; at: number };

let installed: boolean | null = null;   // null = 아직 모름
let settings: BridgeSettings | null = null;
let gate: BridgeGate | null = null;
let error = "";
let msgId = 0;

const frameSubs = new Set<(f: BridgeFrame) => void>();
const statusSubs = new Set<() => void>();
const notify = () => { for (const cb of statusSubs) cb(); };

let wired = false;
function wire(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const msg = event.data as { tag?: string; dir?: string; type?: string; payload?: unknown };
    if (!msg || msg.tag !== TAG || msg.dir !== "toPage") return;

    if (msg.type === "hello") { if (installed !== true) { installed = true; notify(); } return; }
    if (msg.type === "ack") {
      const p = msg.payload as { ok?: boolean; error?: string; settings?: BridgeSettings } | undefined;
      if (p && p.ok === false) { error = p.error ?? "연결 실패"; settings = null; notify(); }
      else if (p?.settings) { settings = p.settings; error = ""; notify(); }
      return;
    }
    if (msg.type === "state") {
      const p = msg.payload as { phase: string; settings?: BridgeSettings } & Partial<BridgeGate>;
      if (p.settings) { settings = p.settings; error = ""; }
      else gate = { phase: p.phase, ticks: p.ticks ?? 0, emitted: p.emitted ?? 0, moving: p.moving ?? 0, framesIn: p.framesIn ?? 0 };
      notify();
      return;
    }
    if (msg.type === "frame") {
      const f = msg.payload as BridgeFrame;
      for (const cb of frameSubs) cb(f);
      return;
    }
    if (msg.type === "ended") { settings = null; gate = null; notify(); }
  });
}

function post(type: string, payload?: unknown): void {
  msgId += 1;
  window.postMessage({ tag: TAG, dir: "toExt", type, payload, id: msgId }, window.location.origin);
}

/** 확장이 깔려 있는지 물어본다 (콘텐츠 스크립트가 hello로 답한다). */
export function probeBridge(): void {
  if (typeof window === "undefined") return;
  wire();
  post("ping");
  window.setTimeout(() => { if (installed === null) { installed = false; notify(); } }, 1500);
}

export function connectBridge(): void { wire(); error = ""; notify(); post("start"); }
export function disconnectBridge(): void { post("stop"); }

export const bridgeInstalled = () => installed;
export const bridgeSettings = () => settings;
export const bridgeGate = () => gate;
export const bridgeError = () => error;

/** 헤더 버튼용 — 연결 상태가 바뀔 때마다 다시 그린다. */
export function useBridgeStatus() {
  const [, bump] = useState(0);
  useEffect(() => {
    const cb = () => bump((n) => n + 1);
    statusSubs.add(cb);
    probeBridge();
    return () => { statusSubs.delete(cb); };
  }, []);
  return { installed, settings, gate, error };
}

/** 프레임 공급원 — useClipboardWatch와 같은 모양이라 각 탭이 그대로 갈아 끼울 수 있다.
 *  화면 하나당 1장만 오므로(확장의 변화 게이트) 여기서 추가로 조를 필요는 없고,
 *  인식이 도는 중에 다음 프레임이 오면 그것만 흘려보낸다. */
export function useBridgeWatch(enabled: boolean, onImage: (file: File) => Promise<void> | void): boolean {
  const [on, setOn] = useState(false);
  const busy = useRef(false);
  const cb = useRef(onImage);
  useEffect(() => { cb.current = onImage; });

  useEffect(() => {
    const sync = () => setOn(!!settings);
    statusSubs.add(sync);
    sync();
    return () => { statusSubs.delete(sync); };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onFrame = (f: BridgeFrame) => {
      if (busy.current) return;
      busy.current = true;
      void (async () => {
        try {
          const blob = await (await fetch(f.url)).blob();
          await cb.current(new File([blob], "bridge.jpg", { type: blob.type || "image/jpeg" }));
        } catch { /* 프레임 하나 실패는 넘긴다 */ } finally { busy.current = false; }
      })();
    };
    frameSubs.add(onFrame);
    return () => { frameSubs.delete(onFrame); };
  }, [enabled]);

  return on;
}
