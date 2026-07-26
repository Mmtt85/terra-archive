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

// 변화 감지용 축소본. 전투노드 화면끼리는 맵·패널이 그대로고 **오른쪽 패널 글자만**
// 바뀌므로, 너무 거칠면 그 차이가 전체 평균에 묻힌다 (2026-07-26 제보: 전투노드 →
// 전투노드 전환을 못 잡음). 조금 키우고, 아래 tileMax로 국소 변화를 따로 본다.
const SMALL_W = 96, SMALL_H = 54;
const TILE = 8;            // 국소 비교 타일 크기 (96×54 → 12×6 타일)
const TICK_MS = 250;       // 판정 주기 (숨겨진 탭에서는 크롬이 1초로 늘린다 — 그래도 충분)
const GRAY_MS = 200;       // 그레이 변환 최소 간격 — 더 자주 온 프레임은 들고만 있는다
const FPS_IDEAL = 4;       // 캡처 프레임레이트 — 판정 주기(400ms)에 이 이상은 낭비다
const MOVING = 6.0;        // 평균 절대차(0~255) 이 이상이면 움직이는 중
const SETTLE_MS = 350;     // 마지막 움직임 이후 이만큼 잠잠하면 안착 (4~5초 체감 단축, 2026-07-26)
const NEW_SCENE = 6.0;     // 마지막 전송본과 **전체 평균**이 이 이상 다르면 새 화면
// 한 타일이라도 이만큼 바뀌면 새 화면으로 본다 — 화면 대부분이 같고 글자만 바뀌는
// 경우(전투노드 → 전투노드)를 잡는 조건이다. 전체 평균만 보면 절대 못 넘는다.
const NEW_TILE = 15.0;
// 인식에 넘기기 전 가로 상한 — OCR 비용은 픽셀 수에 비례해서 여기가 속도의 전부다.
// 픽스처 2배 축소 회귀에서 이동 판정이 14/17로 살아남았고(실패는 대부분 난이도 배지),
// 브라우저 실측도 1368×832 3.3초 → 684×416 1.3초였다. 게임을 돌리는 중에 도는 처리라
// CPU를 아끼는 쪽이 맞다. 검증된 하한(960×540)보다 넉넉하게 잡는다.
const OCR_MAX_W = 1024;    // 1280→1024 (2026-07-26): OCR 캔버스 2048px — 픽셀 36% 감소, 회귀 무손실 확인

export type BridgeSettings = {
  label: string; width: number; height: number;
  frameRate: number | null; devicePixelRatio: number;
};
export type BridgeGate = { phase: string; ticks: number; emitted: number; framesIn: number };
// 테마별 게임연결(사용자 확정 2026-07-26: "사미록라의 게임연결 버튼은 무조건 사미록라만") —
// 연결 시 테마를 하드 고정하면 인식이 그 테마 밖을 아예 보지 않는다.
export type BridgeLock = { topic: string; name: string };
// 플레이 로그 한 줄 — 게임 화면을 인식할 때마다 쌓이고, 연결을 끊으면 JSON으로 내려받는다
// (사용자 요청 2026-07-26: "노드 진입 이력·작전 종료 체력/레벨 등 모든 플레이 데이터를 JSON으로").
export type BridgeLogEvent = {
  at: string;                       // ISO 시각
  type: string;                     // stage|enc|relic|zone|map|battle-result|none|…
  name?: string;                    // 대표 항목 (작전·조우·유물 이름)
  names?: string[];                 // 함께 인식된 항목들
  emergency?: boolean;              // 긴급 작전 화면
  grade?: number;                   // 난이도 배지
  hp?: [number, number];            // 목표 HP 추정 (OCR)
  levelExp?: [number, number];      // 지휘 레벨 경험치 추정 (OCR)
  result?: string;                  // 작전 성공/실패
  fractions?: [number, number][];   // 화면의 모든 x/y 원시값 (검증용)
};

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
let outCv: OffscreenCanvas | null = null;   // 인식용 캔버스 (여백 크롭 + OCR_MAX_W 축소)
// 최신 프레임은 **그리지 않고 들고만 있는다** — 매 프레임 원본 해상도 캔버스 복사가
// "연결만 해도 느리다"(2026-07-26)의 주범이었다. 인식이 필요한 순간(화면당 1회)에만
// 이 프레임을 그린다. VideoFrame은 하나만 쥐고 새 프레임이 오면 이전 것을 닫는다.
let heldFrame: VideoFrame | null = null;
let latestGray: Uint8Array | null = null;
let prevGray: Uint8Array | null = null;
let sentGray: Uint8Array | null = null;
let latestW = 0, latestH = 0, lastGrayAt = 0, lastMoveAt = 0;
let framesIn = 0, ticks = 0, emitted = 0;

let settings: BridgeSettings | null = null;
let gate: BridgeGate | null = null;
let error = "";
let busy = false;   // 지금 인식이 도는 중인가 (useBridgeWatch가 갱신)
let lock: BridgeLock | null = null;   // 테마 하드 고정 (테마별 연결 버튼)
let note = "";      // 마지막 인식 결과 — 각 탭이 알려준다 (헤더 상태줄에 그대로 보인다)
let runLog: BridgeLogEvent[] = [];   // 이번 연결의 플레이 로그
let startedAt = "";

const frameSubs = new Set<(f: File) => void>();
const statusSubs = new Set<() => void>();
const notify = () => { for (const cb of statusSubs) cb(); };

export const bridgeSettings = () => settings;
export const bridgeGate = () => gate;
export const bridgeError = () => error;
export const bridgeBusy = () => busy;
export const bridgeLock = () => lock;
export const bridgeNote = () => note;
/** 각 탭의 handleLensShot이 판정 결과를 한 줄로 알려준다 — "잘 안된다"의 원인을
 *  헤더에서 바로 보기 위한 것이다 (사용자 요청 2026-07-26). */
export function noteBridge(text: string): void { note = text; notify(); }
/** 플레이 로그 적재 — rogue 탭이 라이브 인식 1건마다 부른다. 연결 중에만 쌓는다. */
export function logBridgeEvent(ev: BridgeLogEvent): void {
  if (!settings) return;
  runLog.push(ev);
  notify();
}
export const bridgeLogCount = () => runLog.length;

/** 로그를 JSON 파일로 내려준다 — 연결 종료 시 자동 호출 (기록이 있을 때만). */
function downloadRunLog(): void {
  if (!runLog.length) return;
  const payload = {
    site: "terra-archive",
    theme: lock?.topic ?? null,
    themeName: lock?.name ?? null,
    startedAt, endedAt: new Date().toISOString(),
    capture: settings ? { width: settings.width, height: settings.height } : null,
    events: runLog,
  };
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    a.href = URL.createObjectURL(blob);
    a.download = `테라아카이브-록라기록-${lock?.name ?? "게임"}-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } catch { /* 다운로드 차단 환경 — 로그는 콘솔에 남긴다 */ }
  console.debug("[bridge] 플레이 로그", payload);
}

/** 창 선택 → 캡처 시작. 사용자 제스처(버튼 클릭) 안에서만 부를 수 있다.
 *  withLock을 주면 그 테마로 하드 고정 — 인식이 다른 테마로 절대 넘어가지 않는다. */
export async function connectBridge(withLock?: BridgeLock): Promise<void> {
  disconnectBridge();
  lock = withLock ?? null;
  runLog = []; startedAt = new Date().toISOString();
  error = ""; notify();
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: { frameRate: { ideal: FPS_IDEAL, max: 8 } },
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
  latestGray = prevGray = sentGray = null;
  latestW = latestH = lastGrayAt = 0;
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
  downloadRunLog();   // 기록이 있으면 JSON으로 내려준다 (사용자 요청 2026-07-26)
  runLog = [];
  running = false;
  if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
  if (lockRelease) { lockRelease(); lockRelease = null; }
  if (reader) { void reader.cancel().catch(() => { /* 이미 닫힘 */ }); reader = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (heldFrame) { try { heldFrame.close(); } catch { /* 이미 닫힘 */ } heldFrame = null; }
  settings = null; gate = null; latestGray = null; latestW = 0; note = ""; busy = false; lock = null;
  notify();
}

/** 수신 — 최신 프레임을 들고만 있고, 그레이 변환도 GRAY_MS로 조른다. 원본 해상도 그리기는
 *  여기서 하지 않는다(인식 순간에만). 판정도 하지 않는다(정지 화면이면 여기가 멈추므로). */
async function pump(): Promise<void> {
  while (running && reader) {
    let res: ReadableStreamReadResult<VideoFrame>;
    try { res = await reader.read(); } catch { break; }
    if (res.done || !res.value) break;
    const frame = res.value;
    const w = frame.displayWidth, h = frame.displayHeight;
    if (!running || !w || !h || !smallCx) { frame.close(); continue; }
    // 이전 프레임을 닫고 최신 것으로 교체 — 쥐는 건 항상 하나뿐이다
    if (heldFrame) { try { heldFrame.close(); } catch { /* 이미 닫힘 */ } }
    heldFrame = frame;
    latestW = w; latestH = h;
    framesIn++;
    const now = Date.now();
    if (now - lastGrayAt >= GRAY_MS) {
      lastGrayAt = now;
      try {
        smallCx.drawImage(frame, 0, 0, SMALL_W, SMALL_H);
        const px = smallCx.getImageData(0, 0, SMALL_W, SMALL_H).data;
        const g = new Uint8Array(SMALL_W * SMALL_H);
        for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (px[p] * 77 + px[p + 1] * 150 + px[p + 2] * 29) >> 8;
        latestGray = g;
      } catch { /* 이 프레임은 건너뛴다 */ }
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
let lastSayAt = 0;
function tick(): void {
  if (!latestGray) return;
  const now = Date.now();
  ticks++;
  const first = !prevGray;
  const dMove = diff(latestGray, prevGray);
  prevGray = latestGray;

  // 상태줄 갱신은 국면이 바뀔 때 + 1초 주기로만 — 매 틱 리렌더는 낭비다
  const say = (phase: string) => {
    const changed = gate?.phase !== phase;
    gate = { phase, ticks, emitted, framesIn };
    if (changed || now - lastSayAt >= 1000) { lastSayAt = now; notify(); }
  };

  if (first) { lastMoveAt = now; say("settling"); return; }
  if (dMove > MOVING) { lastMoveAt = now; say("moving"); return; }
  // 시간 기준 안착 — 숨겨진 탭에서 틱 간격이 늘어도 판정이 흔들리지 않는다
  if (now - lastMoveAt < SETTLE_MS) { say("settling"); return; }
  // 새 화면 판정 — 전체 평균 **또는** 한 타일의 국소 변화. 전투노드끼리는 맵이 그대로고
  // 패널 글자만 바뀌어 평균으로는 절대 안 잡히므로 tileMax가 실질적인 판정자다.
  if (diff(latestGray, sentGray) < NEW_SCENE && tileMax(latestGray, sentGray) < NEW_TILE) {
    say("same"); return;
  }
  if (!heldFrame) return;
  // ⚠ 인식이 도는 중에는 내보내지 않는다. 내보내면 소비자가 버리는데 여기서는 이미
  //   "보냈다"(sentGray)고 기록해버려, **그 화면은 영영 인식되지 않는다.**
  //   다음 틱에 다시 시도하면 되므로 그냥 기다린다 (사용자 지적 2026-07-26:
  //   "너무 빠르게 인식 시도해서 오히려 느려지는 건 없나" — 정확히 이 문제였다).
  if (busy) { say("emit"); return; }

  const w = latestW, h = latestH;
  // 여백 잘라내기 — 에뮬·미러링 창은 기기 베젤·레터박스 때문에 실제 게임 화면이
  // 프레임의 절반뿐인 경우가 흔하다(2026-07-26 사용자 제보 스크린샷). 그대로 축소하면
  // 글자가 그만큼 더 작아져 인식률이 떨어진다. 어두운 테두리를 먼저 떼고 축소한다.
  const c = contentRect(latestGray, w, h);
  // 상한을 넘으면 줄여서 넘긴다 (OCR 비용 = 픽셀 수). 원본 해상도 그리기는 여기가
  // 유일하다 — 들고 있던 프레임에서 크롭·축소를 한 번에 한다 (화면당 1회).
  const outW = Math.min(c.w, OCR_MAX_W);
  const outH = Math.round((c.h / c.w) * outW);
  outCv ??= new OffscreenCanvas(2, 2);
  if (outCv.width !== outW || outCv.height !== outH) { outCv.width = outW; outCv.height = outH; }
  try {
    outCv.getContext("2d")!.drawImage(heldFrame, c.x, c.y, c.w, c.h, 0, 0, outW, outH);
  } catch { return; }   // 프레임이 막 닫힌 찰나 — sentGray 갱신 전이라 다음 틱에 재시도된다
  sentGray = latestGray;
  emitted++;
  const cropped = c.w < w || c.h < h ? ` (여백 잘라 ${c.w}×${c.h})` : "";
  console.debug(`[bridge] 새 화면 → 인식 #${emitted} · ${w}×${h}${cropped} → ${outW}×${outH} (틱 ${ticks} · 수신 ${framesIn})`);
  say("emit");
  void outCv.convertToBlob({ type: "image/jpeg", quality: 0.9 }).then((blob) => {
    const file = new File([blob], "bridge.jpg", { type: "image/jpeg" });
    for (const cb of frameSubs) cb(file);
  });
}

/** 64×36 축소본에서 어두운 테두리(기기 베젤·레터박스)를 떼어낸 내용 영역을 원본 좌표로 준다.
 *  잘라낸 뒤가 원본의 40% 미만이면 오검출로 보고 통째로 쓴다 (어두운 화면 오판 방지). */
function contentRect(g: Uint8Array, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const DARK = 40;
  const rowLit = (y: number) => { for (let x = 0; x < SMALL_W; x++) if (g[y * SMALL_W + x] > DARK) return true; return false; };
  const colLit = (x: number) => { for (let y = 0; y < SMALL_H; y++) if (g[y * SMALL_W + x] > DARK) return true; return false; };
  let top = 0, bottom = SMALL_H - 1, left = 0, right = SMALL_W - 1;
  while (top < bottom && !rowLit(top)) top++;
  while (bottom > top && !rowLit(bottom)) bottom--;
  while (left < right && !colLit(left)) left++;
  while (right > left && !colLit(right)) right--;
  const fx = left / SMALL_W, fy = top / SMALL_H;
  const fw = (right + 1 - left) / SMALL_W, fh = (bottom + 1 - top) / SMALL_H;
  if (fw * fh < 0.4) return { x: 0, y: 0, w, h };
  return {
    x: Math.round(fx * w), y: Math.round(fy * h),
    w: Math.max(4, Math.round(fw * w)), h: Math.max(4, Math.round(fh * h)),
  };
}

/** 타일별 평균 절대차의 **최대값** — 화면 대부분이 같고 한 구석만 바뀐 경우를 잡는다.
 *  (전투노드 → 전투노드처럼 오른쪽 패널 글자만 바뀌는 전환이 전형) */
function tileMax(a: Uint8Array | null, b: Uint8Array | null): number {
  if (!a || !b) return 255;
  let worst = 0;
  for (let ty = 0; ty < SMALL_H; ty += TILE) {
    for (let tx = 0; tx < SMALL_W; tx += TILE) {
      let sum = 0, n = 0;
      const yEnd = Math.min(ty + TILE, SMALL_H), xEnd = Math.min(tx + TILE, SMALL_W);
      for (let y = ty; y < yEnd; y++) {
        for (let x = tx; x < xEnd; x++) { const i = y * SMALL_W + x; sum += Math.abs(a[i] - b[i]); n++; }
      }
      if (n) { const m = sum / n; if (m > worst) worst = m; }
    }
  }
  return worst;
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
  return { settings, gate, error, busy, note, lock };
}

/** 프레임 공급원 — useClipboardWatch와 같은 모양이라 각 탭이 그대로 갈아 끼울 수 있다.
 *  화면 하나당 1장만 오므로 여기서 더 조를 필요는 없고, 인식 중에 온 프레임만 흘려보낸다. */
let busyLocal = false;   // 인식 중복 실행 방지 (구독자 공용 — 캡처는 하나뿐이다)

export function useBridgeWatch(enabled: boolean, onImage: (file: File) => Promise<void> | void): boolean {
  const [on, setOn] = useState(false);
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
      if (busyLocal) return;
      busyLocal = true; busy = true; notify();
      void (async () => {
        try { await cb.current(file); } catch { /* 한 장 실패는 넘긴다 */ }
        finally { busyLocal = false; busy = false; notify(); }
      })();
    };
    frameSubs.add(onFrame);
    return () => { frameSubs.delete(onFrame); };
  }, [enabled]);

  return on;
}
