"use client";

// 게임 연결 — 게임 창(에뮬레이터·PC 클라이언트) 화면을 받아 스샷 레이더에 태운다.
//
// ⚠ 크롬 확장으로 만들었다가 걷어냈다 (2026-07-26, 사용자 지적):
//   확장의 명분은 "탭 스로틀을 안 받는 오프스크린 문서에서 캡처를 돌린다"였는데,
//   MV3 서비스 워커가 받은 스트림 id는 **대상 탭의 렌더러에 묶여** 오프스크린에서
//   쓸 수 없었다("Error starting tab capture"). 캡처를 콘텐츠 스크립트로 옮긴 순간
//   그건 페이지와 같은 렌더러 = getDisplayMedia를 직접 부르는 것과 완전히 동일해졌다.
//   설치를 요구하는 대가로 얻는 게 없어서 확장을 지우고 여기로 합쳤다.
//
// 인식·이동 코드는 여전히 하나도 없다 — 프레임을 File로 만들어 각 탭의 handleLensShot에
// 넘기면 recognizeShot → 판정 → 이동이 이미 있던 코드로 돈다. 클립보드 감시(clipwatch.ts)의
// 형제일 뿐이고, useBridgeWatch는 useClipboardWatch와 같은 시그니처다.
//
// ⚠ 수신과 판정을 분리한 이유 (실기에서 잡은 두 증상):
//   ① "됐다 안됐다" — 화면 캡처는 **바뀔 때만** 새 프레임을 준다. 노드 상세처럼 멈춘
//      화면은 프레임이 끊기므로, 프레임 도착에 판정을 걸면 안착을 확정하지 못한다.
//   ② "사이트로 돌아가야 반영된다" — <video>는 탭이 가려지면 프레임 갱신을 멈춘다.
//      게임이 브라우저를 덮은 채 도는 게 이 기능의 전제라 <video>는 쓸 수 없다.
//   그래서 수신은 MediaStreamTrackProcessor(렌더링과 무관), 판정은 setInterval(프레임이
//   안 와도 틱은 돈다)로 나눴다. 5분 뒤의 '집중 스로틀'은 Web Lock을 쥐어 면제받는다.

import { useEffect, useRef, useState } from "react";

const SMALL_W = 64, SMALL_H = 36;
const TICK_MS = 400;       // 판정 주기 (숨겨진 탭에서는 크롬이 1초로 늘린다 — 그래도 충분)
const FULL_MS = 300;       // 원본 해상도 캔버스 갱신 주기 (매 프레임 그리면 낭비)
const MOVING = 6.0;        // 평균 절대차(0~255) 이 이상이면 움직이는 중
const SETTLE_MS = 600;     // 마지막 움직임 이후 이만큼 잠잠하면 안착
const NEW_SCENE = 6.0;     // 마지막 전송본과 이 이상 다르면 새 화면
// 인식에 넘기기 전 가로 상한 — OCR 비용은 픽셀 수에 비례해서 여기가 속도의 전부다.
// 픽스처 2배 축소 회귀에서 이동 판정이 14/17로 살아남았고(실패는 대부분 난이도 배지),
// 브라우저 실측도 1368×832 3.3초 → 684×416 1.3초였다. 게임을 돌리는 중에 도는 처리라
// CPU를 아끼는 쪽이 맞다. 검증된 하한(960×540)보다 넉넉하게 잡는다.
const OCR_MAX_W = 1280;

export type BridgeSettings = {
  label: string; width: number; height: number;
  frameRate: number | null; devicePixelRatio: number;
};
export type BridgeGate = { phase: string; ticks: number; emitted: number; framesIn: number };

export const bridgeSupported = (): boolean =>
  typeof navigator !== "undefined"
  && !!navigator.mediaDevices?.getDisplayMedia
  && typeof MediaStreamTrackProcessor !== "undefined";

let stream: MediaStream | null = null;
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let timer: number | undefined;
let lockRelease: (() => void) | null = null;
let running = false;

let smallCx: OffscreenCanvasRenderingContext2D | null = null;
let fullCv: OffscreenCanvas | null = null;
let fullCx: OffscreenCanvasRenderingContext2D | null = null;
let outCv: OffscreenCanvas | null = null;   // 인식용 축소본 (OCR_MAX_W)
let latestGray: Uint8Array | null = null;
let prevGray: Uint8Array | null = null;
let sentGray: Uint8Array | null = null;
let latestW = 0, latestH = 0, lastFullAt = 0, lastMoveAt = 0;
let framesIn = 0, ticks = 0, emitted = 0;

let settings: BridgeSettings | null = null;
let gate: BridgeGate | null = null;
let error = "";

const frameSubs = new Set<(f: File) => void>();
const statusSubs = new Set<() => void>();
const notify = () => { for (const cb of statusSubs) cb(); };

export const bridgeSettings = () => settings;
export const bridgeGate = () => gate;
export const bridgeError = () => error;

/** 창 선택 → 캡처 시작. 사용자 제스처(버튼 클릭) 안에서만 부를 수 있다. */
export async function connectBridge(): Promise<void> {
  disconnectBridge();
  error = ""; notify();
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: { frameRate: { ideal: 10 } },
      // 자기 탭은 피커에서 숨긴다(무한거울 방지). 공유 중 창을 바꿔도 다시 안 골라도 된다.
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
    } as DisplayMediaStreamOptions);
  } catch (e) {
    error = e instanceof Error && e.name === "NotAllowedError"
      ? "창 선택이 취소되었습니다" : `연결 실패: ${e instanceof Error ? e.message : String(e)}`;
    notify();
    return;
  }

  const track = stream.getVideoTracks()[0];
  track.addEventListener("ended", () => { disconnectBridge(); });

  const smallCv = new OffscreenCanvas(SMALL_W, SMALL_H);
  smallCx = smallCv.getContext("2d", { willReadFrequently: true });
  fullCv = new OffscreenCanvas(2, 2);
  fullCx = fullCv.getContext("2d");
  latestGray = prevGray = sentGray = null;
  latestW = latestH = lastFullAt = 0;
  framesIn = ticks = emitted = 0;
  lastMoveAt = Date.now();

  running = true;
  reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  void pump();
  for (let i = 0; i < 50 && !latestW; i++) await new Promise((r) => setTimeout(r, 100));
  if (!latestW) { disconnectBridge(); error = "캡처 프레임이 오지 않습니다"; notify(); return; }

  const s = track.getSettings();
  settings = {
    label: track.label || "",
    width: latestW, height: latestH,      // 실제로 받은 프레임 크기 — 이게 정답이다
    frameRate: s.frameRate ?? null,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
  console.debug(`[bridge] 캡처 시작 — ${latestW}×${latestH} · dpr ${settings.devicePixelRatio} · ${settings.label}`);
  timer = window.setInterval(tick, TICK_MS);
  holdLock();
  notify();
}

export function disconnectBridge(): void {
  running = false;
  if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
  if (lockRelease) { lockRelease(); lockRelease = null; }
  if (reader) { void reader.cancel().catch(() => { /* 이미 닫힘 */ }); reader = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  settings = null; gate = null; latestGray = null; latestW = 0;
  notify();
}

/** 수신 — 도착 즉시 그려 두고 close한다. 판정은 하지 않는다(정지 화면이면 여기가 멈추므로). */
async function pump(): Promise<void> {
  while (running && reader) {
    let res: ReadableStreamReadResult<VideoFrame>;
    try { res = await reader.read(); } catch { break; }
    if (res.done || !res.value) break;
    const frame = res.value;
    try {
      const w = frame.displayWidth, h = frame.displayHeight;
      if (w && h && smallCx && fullCv && fullCx) {
        latestW = w; latestH = h;
        smallCx.drawImage(frame, 0, 0, SMALL_W, SMALL_H);
        const px = smallCx.getImageData(0, 0, SMALL_W, SMALL_H).data;
        const g = new Uint8Array(SMALL_W * SMALL_H);
        for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (px[p] * 77 + px[p + 1] * 150 + px[p + 2] * 29) >> 8;
        latestGray = g;
        framesIn++;
        const now = Date.now();
        if (now - lastFullAt >= FULL_MS) {
          lastFullAt = now;
          if (fullCv.width !== w || fullCv.height !== h) { fullCv.width = w; fullCv.height = h; }
          fullCx.drawImage(frame, 0, 0, w, h);
        }
      }
    } catch { /* 프레임 하나는 건너뛴다 */ } finally {
      frame.close();   // ⚠ 반드시 닫는다 — 안 닫으면 파이프가 막힌다
    }
  }
}

/** 숨겨진 탭의 '집중 스로틀'(5분 뒤 1분당 1회) 면제 — Web Lock 보유가 제외 조건이다. */
function holdLock(): void {
  try {
    void navigator.locks?.request("ta-bridge-capture", { mode: "shared" }, () =>
      new Promise<void>((resolve) => { lockRelease = resolve; }));
  } catch { /* 미지원 — 타이머가 느려질 뿐 동작은 한다 */ }
}

/** 판정 — 프레임 도착과 무관하게 돈다. 그래서 정지 화면도 안착이 확정된다. */
function tick(): void {
  if (!latestGray || !fullCv) return;
  const now = Date.now();
  ticks++;
  const first = !prevGray;
  const dMove = diff(latestGray, prevGray);
  prevGray = latestGray;

  const say = (phase: string) => { gate = { phase, ticks, emitted, framesIn }; notify(); };

  if (first) { lastMoveAt = now; say("settling"); return; }
  if (dMove > MOVING) { lastMoveAt = now; say("moving"); return; }
  // 시간 기준 안착 — 숨겨진 탭에서 틱 간격이 늘어도 판정이 흔들리지 않는다
  if (now - lastMoveAt < SETTLE_MS) { say("settling"); return; }
  if (diff(latestGray, sentGray) < NEW_SCENE) { say("same"); return; }
  if (fullCv.width < 4) return;

  sentGray = latestGray;
  emitted++;
  const w = fullCv.width, h = fullCv.height;
  // 상한을 넘으면 줄여서 넘긴다 (OCR 비용 = 픽셀 수). 원본이 이미 작으면 그대로.
  const outW = Math.min(w, OCR_MAX_W);
  const outH = Math.round((h / w) * outW);
  let out: OffscreenCanvas = fullCv;
  if (outW < w) {
    outCv ??= new OffscreenCanvas(2, 2);
    if (outCv.width !== outW || outCv.height !== outH) { outCv.width = outW; outCv.height = outH; }
    outCv.getContext("2d")!.drawImage(fullCv, 0, 0, outW, outH);
    out = outCv;
  }
  console.debug(`[bridge] 새 화면 → 인식 #${emitted} · ${w}×${h}${outW < w ? ` → ${outW}×${outH}` : ""} (틱 ${ticks} · 수신 ${framesIn})`);
  say("emit");
  void out.convertToBlob({ type: "image/jpeg", quality: 0.9 }).then((blob) => {
    const file = new File([blob], "bridge.jpg", { type: "image/jpeg" });
    for (const cb of frameSubs) cb(file);
  });
}

function diff(a: Uint8Array | null, b: Uint8Array | null): number {
  if (!a || !b) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** 헤더 버튼용 — 연결 상태가 바뀔 때마다 다시 그린다. */
export function useBridgeStatus() {
  const [, bump] = useState(0);
  useEffect(() => {
    const cb = () => bump((n) => n + 1);
    statusSubs.add(cb);
    return () => { statusSubs.delete(cb); };
  }, []);
  return { settings, gate, error };
}

/** 프레임 공급원 — useClipboardWatch와 같은 모양이라 각 탭이 그대로 갈아 끼울 수 있다.
 *  화면 하나당 1장만 오므로 여기서 더 조를 필요는 없고, 인식 중에 온 프레임만 흘려보낸다. */
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
    const onFrame = (file: File) => {
      if (busy.current) return;
      busy.current = true;
      void (async () => {
        try { await cb.current(file); } catch { /* 한 장 실패는 넘긴다 */ } finally { busy.current = false; }
      })();
    };
    frameSubs.add(onFrame);
    return () => { frameSubs.delete(onFrame); };
  }, [enabled]);

  return on;
}
