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

import { forgetModalPos, PRTS_MODAL_KEY } from "../modal-geo";
import { useEffect, useRef, useState } from "react";
import type { LensOutcome } from "./match";
import { holdVisitActive, notePrtsStart, notePrtsEnd, notePrtsScan, prtsScanId, type PrtsScanRow } from "../visit-track";
import { uploadFeedbackFile } from "../feedback";
import { lastOcrLines } from "./ocr-trace";

// 크롬 전용 API 라 TS 기본 DOM 타입에 없다 — 쓰는 만큼만 선언
declare const MediaStreamTrackProcessor: {
  new (init: { track: MediaStreamTrack }): { readable: ReadableStream<VideoFrame> };
};

// 변화 감지용 축소본. 전투노드 화면끼리는 맵·패널이 그대로고 **오른쪽 패널 글자만**
// 바뀌므로, 너무 거칠면 그 차이가 전체 평균에 묻힌다 (2026-07-26 제보: 전투노드 →
// 전투노드 전환을 못 잡음). 조금 키우고, 아래 tileMax로 국소 변화를 따로 본다.
const SMALL_W = 96, SMALL_H = 54;
const TILE = 8;            // 국소 비교 타일 크기 (96×54 → 12×6 타일)
const TICK_MS = 200;       // 판정 주기 (숨겨진 탭에서는 크롬이 1초로 늘린다 — 그래도 충분)
const GRAY_MS = 200;       // 그레이 변환 최소 간격 — 더 자주 온 프레임은 들고만 있는다
const FPS_IDEAL = 4;       // 캡처 프레임레이트 — 판정 주기(400ms)에 이 이상은 낭비다
const MOVING = 6.0;        // 평균 절대차(0~255) 이 이상이면 움직이는 중
const SETTLE_MS = 300;     // 마지막 움직임 이후 이만큼 잠잠하면 안착 (4~5초 체감 단축, 2026-07-26)
const NEW_SCENE = 6.0;     // 마지막 전송본과 **전체 평균**이 이 이상 다르면 새 화면
// 한 타일이라도 이만큼 바뀌면 새 화면으로 본다 — 화면 대부분이 같고 글자만 바뀌는
// 경우(전투노드 → 전투노드)를 잡는 조건이다. 전체 평균만 보면 절대 못 넘는다.
const NEW_TILE = 11.0;  // 15→11 (영상5: 작전노드→작전노드 전환 누락 — 패널 글자 변화가 15를 못 넘는 케이스)
// 공채 — 슬롯끼리는 배경·틀이 같고 **태그 글자 몇 개만** 달라 11 을 못 넘어 늘 '같은 화면'이었다 (사용자 지적 2026-10-12).
// 공채로 연결했을 때만 낮춘다 (떠다니는 반짝이로 같은 태그를 한 번 더 읽는 일은 있어도 결과는 같다)
const NEW_TILE_RECRUIT = 4.0;
// 전투 홀드 — 전투 화면으로 판정된 뒤에는 이만큼 **전체**가 바뀔 때만 인식을 재개한다
// (승리/실패·일시정지처럼 화면이 통째로 바뀌는 전환). 전투 중 타이머·이펙트의 국소
// 변화가 매번 tileMax를 넘어 헛 OCR을 돌리던 낭비 제거 (2026-07-26 "무시가능한 건 무시").
const BATTLE_EXIT = 8.0;
const BATTLE_RECHECK_MS = 20_000;  // 안전망 — 이만큼 지나면 한 번 다시 읽어 홀드 오진을 자가치유
const MEMO_MAX = 8;                // 화면 판정 캐시 크기 (맵↔노드 왕복 재인식 생략)
// 인식에 넘기기 전 가로 상한 — OCR 비용은 픽셀 수에 비례해서 여기가 속도의 전부다.
// 픽스처 2배 축소 회귀에서 이동 판정이 14/17로 살아남았고(실패는 대부분 난이도 배지),
// 브라우저 실측도 1368×832 3.3초 → 684×416 1.3초였다. 게임을 돌리는 중에 도는 처리라
// CPU를 아끼는 쪽이 맞다. 검증된 하한(960×540)보다 넉넉하게 잡는다.
const OCR_MAX_W = 900;     // 1024→900 (2026-07-26 "성능 희생해도 속도"): 캔버스 1800px, 23% 추가 감소

export type BridgeSettings = {
  label: string; width: number; height: number;
  frameRate: number | null; devicePixelRatio: number;
};
export type BridgeGate = { phase: string; ticks: number; emitted: number; framesIn: number };
// 테마별 게임연결(사용자 확정 2026-07-26: "사미록라의 게임연결 버튼은 무조건 사미록라만") —
// 연결 시 테마를 하드 고정하면 인식이 그 테마 밖을 아예 보지 않는다.
export type BridgeLock = { topic: string; name: string };
// 플레이 로그 한 줄 — **여정 기록**: 원시 인식 전부가 아니라 유저가 뭘 골랐는지만 남긴다
// (사용자 확정 2026-07-26: "어느 작전에 들어갔고 결과가 어땠고, 조우에서 뭐가 나왔고,
//  무슨 소장품을 골랐고, 무슨 붕괴 패러다임이 발생했는지 사람이 알아보게").
export type BridgeLogEvent = {
  at: string;                       // ISO 시각
  type: string;                     // stage|enc|relic|zone|archive|battle-result
  name?: string;                    // 대표 항목 (작전·조우·유물 이름)
  names?: string[];                 // 함께 인식된 항목들
  arc?: string;                     // 전시관 탭 라벨 (band|tool|… 또는 암호판·붕괴 패러다임 등)
  emergency?: boolean;              // 긴급 작전 화면
  grade?: number;                   // 난이도 배지 (표시는 헤더에 1회 — 판 내 불변)
  hp?: [number, number];            // 목표 HP 추정 (OCR)
  levelExp?: [number, number];      // 지휘 레벨 경험치 추정 (OCR)
  result?: string;                  // 작전 성공/실패
  cached?: boolean;                 // 화면 판정 캐시 재적용 (OCR 없이 지난 판정 — HUD 수치 없음)
};

// 모바일 기기 판정 — **화면 크기로 판단하지 않는다** (사용자 확정 2026-08-09: PC에서 창을
// 좁게 줄여 쓰는 경우와 구분돼야 한다). 근거 두 가지만 쓴다:
// ① navigator.userAgentData.mobile — 크로뮴이 직접 알려주는 기기 분류 (창 크기 무관).
// ② (hover: none) and (pointer: coarse) — 주 입력이 호버 없는 터치인 환경 = 폰·태블릿.
//    좁힌 데스크탑 창은 hover+fine이라 안 걸리고, 터치스크린 노트북도 주 포인터는 fine이다.
const isMobileDevice = (): boolean =>
  (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile === true
  || window.matchMedia("(hover: none) and (pointer: coarse)").matches;

// 모바일이면 캡처가 성립하지 않는다 (게임이 딴 앱) — 안드로이드 크롬은 getDisplayMedia가
// 정의돼 있어 기능 감지만으로는 못 거른다. 다만 버튼을 숨기지 않고 **비활성 + 'PC 전용'
// 표기**로 남기므로 (사용자 확정 2026-08-09) 이 판정은 bridgeSupported에 섞지 않는다.
export const bridgeOnMobile = (): boolean => typeof navigator !== "undefined" && isMobileDevice();

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
let runLog: BridgeLogEvent[] = [];   // 이번 연결의 플레이 로그 — 끊은 뒤에도 다음 연결까지 유지
let startedAt = "";
// 연결을 끊은 뒤 리플레이 다운로드용 스냅샷 — lock/settings는 끊는 순간 사라지므로 여기 남긴다
let logMeta: { topic: string | null; name: string | null; startedAt: string; endedAt: string;
  width: number | null; height: number | null } | null = null;

// 화면 판정 캐시 — 최근에 본 화면(축소 그레이)과 그때의 판정. 같은 화면으로 돌아오면
// (맵↔노드 모달 왕복이 전형) OCR 없이 판정을 재적용한다 (2026-07-26 속도 요청).
let lastEmitGray: Uint8Array | null = null;
let sceneMemos: { gray: Uint8Array; outcome: LensOutcome }[] = [];
let battleHold = false, battleHoldAt = 0;

// ── 인식 기록 (2026-10-12, 사용자 지시 "얼마나 걸렸나 제대로 인식이 됐나") ─────────────────────────────
// 화면을 넘기는 순간(emit) scan 을 열고, 소비자(탭)의 판정이 끝나면(useBridgeWatch finally) 한 줄 보낸다.
// 판정 내용은 탭이 부르는 memoBridgeScene(outcome)·noteBridge(text)에서 주워 담는다 — 탭 코드는 그대로다.
// ⚠ 그림·OCR 원문은 보내지 않는다(화면에 닉네임·UID). 이름표(결과·구역·이동 대상)와 숫자만.
type ScanCtx = { id: string; emitAt: number; w: number; h: number; crop: number; cached: boolean; href: string;
  oc?: LensOutcome; note?: string; blob?: Blob; retry?: boolean };
let scan: ScanCtx | null = null;
/** 마지막으로 끝난 인식 — 토스트의 '틀렸어요'가 가리킨다 */
/** shot = '틀렸어요'와 함께 보낸 화면 — 보내는 중·보냄·실패 (화면이 없으면 none: 캐시 재적용은 새 화면을 안 만든다) */
// row = 그 인식의 기록 한 줄 — 평소엔 보내지 않고 '틀렸어요'를 누를 때만 보낸다 (사용자 지시 2026-10-12 "인식표는 지우자. 받지도 말자" —
// 인식마다 보내니 하루 3천 줄이 쌓여 관리자 화면이 느려졌다). 같은 까닭으로 '바로잡음'(fix) 추적도 걷어냈다
let lastScan: { id: string; at: number; wrong: boolean; row?: PrtsScanRow; ocr?: string[]; blob?: Blob; shot?: "sending" | "sent" | "fail" | "none" } | null = null;
/** '못 찾음'이면 화면이 그대로여도 한 번 다시 읽는다 — 보상 화면처럼 서서히 나타나는 화면을 다 뜨기 전에 읽은 경우
 *  (사용자 제보 2026-10-12 "하나 받고 나서야 리스트에 뜬다" — 화면이 '같은 화면'으로 묶여 다시 안 읽혔다) */
let retryAt = 0;
let retryNext = false;   // 다음 인식이 그 재시도다 — 재시도에서 또 못 찾으면 더는 다시 읽지 않는다 (메뉴 화면 무한 OCR 방지)

function gotoKey(oc: LensOutcome): string | undefined {
  const tg = oc.target;
  if (tg.kind === "tie") return `tie:${tg.options.map((o) => o.topic).join(",")}`;
  if (tg.kind !== "goto") return undefined;
  const g = tg.goto as Record<string, unknown> & { page: string };
  const modal = g.modal as { type?: string; id?: string } | undefined;
  const parts = [g.page, g.topic, g.view, modal ? `${modal.type}=${modal.id}` : g.id, g.ep, Array.isArray(g.tags) ? (g.tags as string[]).join("+") : undefined,
    Array.isArray(g.highlight) ? `hl${(g.highlight as string[]).length}` : undefined];
  return parts.filter((x) => x != null && x !== "").join(":");
}

function finishScan(ocrStart?: number): void {
  const sc = scan;
  scan = null;
  if (!sc) return;
  const now = Date.now();
  const oc = sc.oc;
  const result = !oc ? "unreported" : oc.battle ? "battle" : oc.target.kind;
  // 판정 근거 — 맞춘 게임 항목 이름(최대 5)·화면 종류(최대 3). 게임 데이터 이름표뿐이다
  const seen = oc ? [...oc.entities.slice(0, 5).map((e) => e.name), ...oc.screens.slice(0, 3).map((x) => `#${x}`)].join("|") : undefined;
  const row: PrtsScanRow = {
    id: sc.id, kind: "scan", seen, page: location.pathname.replace(/^\/(en|ja)(?=\/|$)/, "") || "/", topic: lock?.topic,
    result, section: oc?.section ?? undefined, target: oc ? gotoKey(oc) : undefined, note: sc.note,
    ms: now - sc.emitAt, ocr_ms: ocrStart != null ? now - ocrStart : 0, cached: sc.cached, w: sc.w, h: sc.h, crop: sc.crop,
  };
  lastScan = { id: sc.id, at: now, wrong: false, row, ocr: sc.cached ? undefined : lastOcrLines(), blob: sc.blob };
  // 화면 모으기 — 그 화면의 판정을 옆에 남긴다 (결과·구역·대상·상태줄·판정 근거·걸린 시간)
  if (collectDir && !sc.cached) void collectWrite(`${sc.id}.txt`, JSON.stringify({ topic: row.topic, page: row.page, result, section: row.section, target: row.target, note: row.note, seen: row.seen, ms: row.ms, ocr_ms: row.ocr_ms, w: sc.w, h: sc.h, ocr: lastOcrLines() }, null, 1));
  retryAt = result === "none" && !sc.cached && !sc.retry ? now + 1500 : 0;
  notify();
}

/** 토스트의 '틀렸어요' — 마지막 인식을 틀렸다고 표시하고, **그 인식에 쓴 화면 한 장**을 같이 올린다
 *  (사용자 지시 2026-10-12 "인식된 화면을 받아보는 게 낫다"). 평소 기록엔 그림이 없고 이 단추를 누를 때만 간다 —
 *  토스트 안내문이 그렇게 말한다. 올리는 곳은 제안 게시판 첨부와 같은 익명 업로드(workers/upload, feedback/…). 같은 인식엔 한 번만 */
export function markBridgeWrong(memo?: string): void {
  const ls = lastScan;
  if (!ls || ls.wrong) return;
  ls.wrong = true;
  const wrongId = prtsScanId();
  if (ls.row) notePrtsScan(ls.row);   // 그 인식 한 줄 — 이때 처음 보낸다
  // 메모 — 뭐가 틀렸는지 한 줄 (사용자 지시 2026-10-13 "틀렸어요 누를 때 한 줄 써서 보낼 수 있게"). 비워도 된다
  const note = memo?.trim().slice(0, 200) || undefined;
  notePrtsScan({ id: wrongId, kind: "wrong", ref: ls.id, topic: lock?.topic, ...(note ? { note } : {}) });
  if (!ls.blob) { ls.shot = "none"; notify(); return; }
  ls.shot = "sending";
  notify();
  const file = new File([ls.blob], `prts-wrong-${ls.id.slice(0, 8)}.jpg`, { type: "image/jpeg" });
  // 화면에 더해 **그 인식의 판정 + OCR 이 읽은 줄 전체**를 JSON 으로 (사용자 지시 2026-10-13 "패들 OCR 이 인식한 내용 json 도 받아야") —
  // 화면만으로는 왜 틀렸는지(무엇을 어떻게 읽었는지) 알 수 없다. 둘 다 'shot' 줄로 남고 관리자 목록이 화면·OCR 기록으로 나눠 보인다
  const ocrFile = new File([JSON.stringify({ id: ls.id, ...(ls.row ?? {}), ...(note ? { memo: note } : {}), ocr: ls.ocr ?? [] }, null, 1)], `prts-wrong-${ls.id.slice(0, 8)}.json`, { type: "application/json" });
  void uploadFeedbackFile(file)
    .then((up) => { notePrtsScan({ id: prtsScanId(), kind: "shot", ref: ls.id, img: up.url }); ls.shot = "sent"; })
    .then(() => uploadFeedbackFile(ocrFile))
    .then((up) => { if (up) notePrtsScan({ id: prtsScanId(), kind: "shot", ref: ls.id, img: up.url }); })
    .catch(() => { if (ls.shot !== "sent") ls.shot = "fail"; })
    .finally(() => { ls.blob = undefined; notify(); });
}
export const bridgeLastScan = () => lastScan;

// ── 작은 창(문서 PiP) 카드 (2026-10-12 시험판) — 게임 위에 떠 있는 창에 '방금 인식한 것'을 보여 준다.
// 탭(rogue.tsx)이 인식할 때마다 채우고, 토스트(bridge-button.tsx)가 PiP 창에 그린다.
export type BridgePipCard = { kind: string; name: string; text?: string | null; list?: string[]; listLabel?: string;
  /** 섬네일 (절대 주소 — 작은 창 문서는 about:blank 라 상대 주소가 안 풀린다) */ img?: string;
  /** 눌러 펼치면 보이는 큰 그림 (작전 지도) */ detailImg?: string;
  /** list 와 같은 순서의 작은 그림 (등장 적 얼굴) */ listImgs?: (string | undefined)[] };
// 작은 창은 두 칸 — 노드(층·작전·조우) 카드 한 장 · 소장품 카드 여러 장. 각자 새로 인식될 때만 갈아 끼운다
// (사용자 지시 2026-10-12 "PiP 창 하나를 둘로 나눠서")
let pipNode: BridgePipCard | null = null;
let pipRelics: BridgePipCard[] = [];
/** 작은 창이 열려 있나 — 종전엔 열려 있으면 본 화면을 안 바꿨는데, 이제 본 화면 상시 창도 같이 바뀐다 (사용자 지시 2026-10-12) */
let pipActive = false;
export function setBridgePipActive(v: boolean): void { pipActive = v; }
export const bridgePipActive = () => pipActive;
export function setBridgePipNode(card: BridgePipCard | null): void { pipNode = card; notify(); }
export function setBridgePipRelics(cards: BridgePipCard[]): void { pipRelics = cards; notify(); }
export const bridgePipNode = () => pipNode;
export const bridgePipRelics = () => pipRelics;
/** 공채 작은 창 — 인식된 태그 · 태그 조합 결과(오퍼 목록). 공채 화면(recruit.tsx)이 고른 태그가 바뀔 때마다 채운다
 *  (사용자 지시 2026-10-13 "공채야말로 PiP 에 — 노드가 아니라 인식된 태그, 소장품이 아니라 태그 조합 결과 오퍼 리스트") */
export type BridgePipRecruit = { tags: string[]; rows: { combo: string[]; floor: number; ceil: number; ops: { id: string; name: string; rarity: number; img: string }[] }[];
  /** 본 화면 '4★ 이상만' 토글과 같은 값 — 작은 창에서 바꾸면 onPrized 로 본 화면도 바뀐다 (사용자 지시 2026-10-13 "본사이트랑 동일하게 동기화") */
  prized: boolean; onPrized?: () => void };
let pipRecruit: BridgePipRecruit | null = null;
export function setBridgePipRecruit(v: BridgePipRecruit | null): void { pipRecruit = v; notify(); }
export const bridgePipRecruit = () => pipRecruit;
/** 통합전략 공통 정보 — 노드·소장품 칸 위 한 줄: 층(번호·이름)·난이도 (사용자 지시 2026-10-13 "1층, 영혼 융합의 시작 · 난이도").
 *  구역·작전이 인식되면 층을, 좌하단 난이도 배지가 읽히면 난이도를 갈아 끼운다 — 다른 값은 그대로 둔다 */
/** era — 통합전략 4 의 '시대'(재앙 시대 등)가 일어났을 때. 공통 정보 띠의 칩을 누르면 효과가 펼쳐진다 (2026-10-13) */
export type BridgePipFloor = { floor?: number; name?: string;
  /** 층이 아닌 구역(쉐이의 잔식)의 이름 — 있으면 'N층' 대신 '쉐이의 잔식 - 이름' */
  place?: string; grade?: number; squad?: string; era?: { name: string; text: string } | null };
let pipFloor: BridgePipFloor = {};
export function setBridgePipFloor(v: BridgePipFloor): void {
  const next = { ...pipFloor, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
  if (next.floor === pipFloor.floor && next.name === pipFloor.name && next.place === pipFloor.place && next.grade === pipFloor.grade && next.squad === pipFloor.squad && next.era === pipFloor.era) return;
  pipFloor = next; notify();
}
export const bridgePipFloor = () => pipFloor;

/** 강제 인식 (사용자 지시 2026-10-13 "인식이 이상할 때 대비해 강제 인식 버튼") — '같은 화면'·판정 캐시·전투 홀드를 무시하고
 *  지금 화면을 다음 틱에 바로 다시 읽는다 */
export function forceBridgeRescan(): void {
  if (!running) return;
  sentGray = null; sceneMemos = []; battleHold = false; retryAt = 0; retryNext = false;
  lastMoveAt = Date.now() - 10_000;   // 안착 대기 없이
  console.debug("[bridge] 강제 인식");
  notify();
}

// ── 화면 모으기 (관리자 시험 기능, 2026-10-13) — 록라 OCR 을 PaddleOCR 로 바꾸기 전에 tesseract 와 나란히 비교할 화면을 모은다.
// 사용자가 고른 PC 폴더(크롬 showDirectoryPicker)에 인식에 쓴 화면(jpg)과 그 판정(txt)을 바로 쓴다 — **서버로는 아무것도 안 간다**
type DirHandle = { getFileHandle: (n: string, o: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (d: Blob | string) => Promise<void>; close: () => Promise<void> }> }> };
let collectDir: DirHandle | null = null;
let collectN = 0;
export const bridgeCollecting = () => (collectDir ? collectN : -1);
export async function startBridgeCollect(): Promise<boolean> {
  const pick = (window as unknown as { showDirectoryPicker?: (o: { mode: string }) => Promise<DirHandle> }).showDirectoryPicker;
  if (!pick) return false;
  try { collectDir = await pick({ mode: "readwrite" }); collectN = 0; notify(); return true; } catch { return false; }
}
export function stopBridgeCollect(): void { collectDir = null; notify(); }
async function collectWrite(name: string, data: Blob | string): Promise<void> {
  const dir = collectDir;
  if (!dir) return;
  try {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  } catch (e) { console.warn("[bridge] 화면 모으기 저장 실패", e); }
}

const frameSubs = new Set<(f: File) => void>();
const replaySubs = new Set<(oc: LensOutcome) => void>();
const statusSubs = new Set<() => void>();
const notify = () => { for (const cb of statusSubs) cb(); };

// ── 맵 노드 자동 이동 (제보 f1c050b2, 2026-09-04 "노드인식이 방해되는 경우가 조금 있네요") ──
// 인식을 끄는 게 아니라 **맵 노드(작전·조우·구역)로 튀는 이동만** 끈다 — 소장품·도구·분대
// 인식은 그대로 동작한다. 맵을 훑으며 노드를 하나씩 눌러 보는 동안 사이트가 계속 그 작전
// 상세로 넘어가는 게 방해였다는 제보다.
// ⚠ 이 설정은 **PRTS 링크 전용**이다 (사용자 확정 2026-09-05 "prts에서만 켜고끄고 할 수
//   있어야하니"). 스샷 레이더는 사람이 한 장씩 일부러 붙여넣는 것이라 그 화면으로 가는 게
//   목적이므로 게이트하지 않는다. 그래서 상태도 rogue.tsx 가 아니라 여기(브리지)에 둔다.
// ⚠ 읽기를 **지연**시킨다 — 모듈 최상위에서 localStorage 를 만지면 서버 렌더에서 터진다.
//   토스트는 연결 뒤(클라이언트)에만 그려지므로 하이드레이션 불일치도 없다.
const NODE_JUMP_KEY = "ta:bridge-node-jump";
let nodeJump: boolean | null = null;
export function bridgeNodeJump(): boolean {
  if (nodeJump === null) {
    try { nodeJump = localStorage.getItem(NODE_JUMP_KEY) !== "0"; } catch { nodeJump = true; }
  }
  return nodeJump;
}
export function setBridgeNodeJump(on: boolean) {
  nodeJump = on;
  try { localStorage.setItem(NODE_JUMP_KEY, on ? "1" : "0"); } catch { /* 프라이빗 모드 등 */ }
  notify();
}

export const bridgeSettings = () => settings;
export const bridgeGate = () => gate;
export const bridgeError = () => error;
export const bridgeBusy = () => busy;
export const bridgeLock = () => lock;
/** 이번 연결 회차 — 연결할 때마다 바뀐다 (rogue.tsx 상시 창이 지난 회차 내용을 버리는 데 쓴다). 끊긴 동안은 "" */
export const bridgeSession = () => (running ? startedAt : "");
/** 지금 연결돼 있나 — connectBridge 는 실패해도 throw 하지 않고 조용히 돌아오므로
 *  (창 선택 취소 등) 호출한 쪽이 성사 여부를 이걸로 확인한다. */
export const bridgeOn = () => !!settings;
export const bridgeNote = () => note;
/** 각 탭의 handleLensShot이 판정 결과를 한 줄로 알려준다 — "잘 안된다"의 원인을
 *  헤더에서 바로 보기 위한 것이다 (사용자 요청 2026-07-26). */
export function noteBridge(text: string): void { note = text; if (scan) scan.note = text; notify(); }
/** 플레이 로그 적재 — rogue 탭이 라이브 인식 1건마다 부른다. 연결 중에만 쌓는다. */
export function logBridgeEvent(ev: BridgeLogEvent): void {
  if (!settings) return;
  runLog.push(ev);
  notify();
}
export const bridgeLogCount = () => runLog.length;

/** 각 탭이 라이브 인식 결과를 알려준다 — ① 전투 화면이면 전투 홀드에 들어가고(큰 전환까지
 *  인식 중단), ② 확신 이동(goto)이면 화면 판정 캐시에 남겨 같은 화면 복귀 시 OCR을 생략한다. */
export function memoBridgeScene(outcome: LensOutcome): void {
  if (scan) scan.oc = outcome;   // 인식 기록에 판정을 싣는다
  if (outcome.battle) { battleHold = true; battleHoldAt = Date.now(); return; }
  if (!lastEmitGray || outcome.target.kind !== "goto") return;
  const g = lastEmitGray;
  sceneMemos = sceneMemos.filter((m) => m.gray !== g);
  sceneMemos.push({ gray: g, outcome });
  if (sceneMemos.length > MEMO_MAX) sceneMemos.shift();
}

/** 리플레이 JSON의 파일 형태 — 익스포트가 만들고 임포트가 읽는 공통 스키마. */
export type BridgeLogPayload = {
  site: string;
  theme: string | null;
  themeName: string | null;
  startedAt: string;
  endedAt: string;
  grade?: number;                   // 난이도 — 판 내 불변이라 페이로드 수준에 1개
  capture: { width: number; height: number } | null;
  events: BridgeLogEvent[];
};

/** 현재(또는 마지막) 연결의 플레이 로그 — 리플레이 프리뷰 모달이 표시용으로 읽는다.
 *  연결 중에도, 끊은 뒤에도(다음 연결 전까지) 살아 있다. */
export function bridgeLogPayload(): BridgeLogPayload | null {
  if (!runLog.length) return null;
  const meta = settings
    ? { topic: lock?.topic ?? null, name: lock?.name ?? null, startedAt,
        endedAt: new Date().toISOString(), width: settings.width, height: settings.height }
    : logMeta;
  if (!meta) return null;
  // 난이도는 **마지막** 기록을 쓴다 — 배지 오독으로 잘못 잡혔다가 사용자가 셀렉터를 고쳤으면
  // 그 뒤 기록이 맞다 (2026-07-26 제보: 3인데 4로 남던 문제). 처음 값을 쥐면 오독이 박힌다.
  const grade = [...runLog].reverse().find((e) => e.grade !== undefined)?.grade;
  return {
    site: "terra-archive",
    theme: meta.topic,
    themeName: meta.name,
    startedAt: meta.startedAt, endedAt: meta.endedAt,
    ...(grade !== undefined ? { grade } : {}),
    capture: meta.width != null ? { width: meta.width, height: meta.height! } : null,
    events: runLog,
  };
}

/** 페이로드를 JSON 파일로 저장 — 리플레이 모달의 'JSON 내보내기'가 부른다.
 *  자동 다운로드는 없다 (사용자 확정 2026-07-26: 버튼을 눌러야만 내려간다). */
export function downloadBridgePayload(payload: BridgeLogPayload): void {
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    a.href = URL.createObjectURL(blob);
    a.download = `테라아카이브-록라기록-${payload.themeName ?? "게임"}-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } catch { /* 다운로드 차단 환경 — 로그는 콘솔에 남긴다 */ }
  console.debug("[bridge] 플레이 로그", payload);
}

// 방문 통계에 '쓰는 중'으로 걸어 두었는가 (visit-track holdVisitActive)
let visitHeld = false;

/** 창 선택 → 캡처 시작. 사용자 제스처(버튼 클릭) 안에서만 부를 수 있다.
 *  withLock을 주면 그 테마로 하드 고정 — 인식이 다른 테마로 절대 넘어가지 않는다. */
export async function connectBridge(withLock?: BridgeLock, via?: Window): Promise<void> {
  disconnectBridge();
  lock = withLock ?? null;
  // 공채·통합전략 — PaddleOCR(모델·엔진)을 연결과 함께 받아 둔다. 첫 인식이 받는 시간을 기다리지 않게
  // 통합전략(한국어)도 화면 전체 읽기를 PaddleOCR 로 한다 (2026-10-13) — 같이 미리 받는다
  if (lock?.topic === "recruit" || lock?.topic?.startsWith("rogue_")) void import("./paddle").then((m) => m.warmPaddle());
  runLog = []; logMeta = null; startedAt = new Date().toISOString();
  scan = null; lastScan = null; pipNode = null; pipRelics = []; pipRecruit = null; pipFloor = {};
  sceneMemos = []; lastEmitGray = null; battleHold = false;
  error = ""; notify();
  const opts = {
    audio: false,
    video: { frameRate: { ideal: FPS_IDEAL, max: 8 } },
    // 자기 탭은 피커에서 숨긴다(무한거울 방지). 공유 중 창을 바꿔도 다시 안 골라도 된다.
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
  } as DisplayMediaStreamOptions;
  try {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(opts);
    } catch (e) {
      // 작은 창(PiP)에서 누른 연결 — 클릭이 그 창에서 일어나 본창엔 '방금 사용자 동작'이 없을 수 있다.
      // 그때는 그 창에서 다시 청한다 (2026-10-12). ⚠ 그 경우 작은 창을 닫으면 캡처도 끊길 수 있다 — 트랙 ended 로 정리된다
      if (!via || !(e instanceof Error) || e.name !== "InvalidStateError") throw e;
      stream = await via.navigator.mediaDevices.getDisplayMedia(opts);
    }
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
  document.documentElement.dataset.prtsLive = "1";   // 새 버전 새로고침을 미룬다 (app/version-check.ts)
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
  // 연결해 둔 동안은 방문 통계의 조작 시간으로 센다 (게임이 화면을 덮고 있어도 쓰는 중이다)
  if (!visitHeld) { visitHeld = true; holdVisitActive(true); }
  // 방문 통계 PRTS 링크 기록 — 어디서 연결했나(테마 고정이면 그 테마, 아니면 지금 화면 경로)
  notePrtsStart(lock?.topic ?? (location.pathname.replace(/^\/(en|ja)(?=\/|$)/, "") || "/"));
  notify();
}

export function disconnectBridge(): void {
  // 로그는 지우지 않는다 — '리플레이 다운받기' 버튼으로만 내려간다 (다음 연결 때 초기화).
  // lock/settings는 곧 사라지므로 다운로드용 스냅샷을 남긴다.
  if (runLog.length && settings) {
    logMeta = { topic: lock?.topic ?? null, name: lock?.name ?? null, startedAt,
      endedAt: new Date().toISOString(), width: settings.width, height: settings.height };
  }
  running = false;
  delete document.documentElement.dataset.prtsLive;
  forgetModalPos(PRTS_MODAL_KEY); // 끊으면 PRTS 창 자리·크기를 잊는다 — 다음 연결은 기본 자리부터 (사용자 지시 2026-10-12)
  if (visitHeld) { visitHeld = false; holdVisitActive(false); }
  notePrtsEnd();
  scan = null;
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
  // 전투 홀드 — 전투 화면으로 판정된 뒤에는 타이머·이펙트의 국소 변화를 전부 무시하고,
  // 화면이 통째로 바뀌는 전환(승리/실패·모달)만 기다린다. 안전망으로 20초마다 한 번은
  // 다시 읽어, 홀드가 오진이었어도 자가치유된다 (다시 전투로 판정되면 홀드 재진입).
  if (battleHold) {
    if (diff(latestGray, sentGray) < BATTLE_EXIT && now - battleHoldAt < BATTLE_RECHECK_MS) {
      say("battle"); return;
    }
    battleHold = false;
  }
  // '못 찾음' 한 번 재시도 — 그 사이 화면이 멈춰 있었으면 새 화면처럼 다시 넘긴다 (한 번만)
  if (retryAt && now >= retryAt && !busy) { retryAt = 0; sentGray = null; retryNext = true; }
  // 새 화면 판정 — 전체 평균 **또는** 한 타일의 국소 변화. 전투노드끼리는 맵이 그대로고
  // 패널 글자만 바뀌어 평균으로는 절대 안 잡히므로 tileMax가 실질적인 판정자다.
  if (diff(latestGray, sentGray) < NEW_SCENE && tileMax(latestGray, sentGray) < (lock?.topic === "recruit" ? NEW_TILE_RECRUIT : NEW_TILE)) {
    say("same"); return;
  }
  if (!heldFrame) return;
  // ⚠ 인식이 도는 중에는 내보내지 않는다. 내보내면 소비자가 버리는데 여기서는 이미
  //   "보냈다"(sentGray)고 기록해버려, **그 화면은 영영 인식되지 않는다.**
  //   다음 틱에 다시 시도하면 되므로 그냥 기다린다 (사용자 지적 2026-07-26:
  //   "너무 빠르게 인식 시도해서 오히려 느려지는 건 없나" — 정확히 이 문제였다).
  if (busy) { say("emit"); return; }
  // ⚠ 받을 화면이 없으면(공채 화면을 떠나 다른 화면에 가 있음) 보내지 않는다 — 보내면 '보냈다'로 기록돼, 돌아와도
  //   게임 화면이 그대로면 '같은 화면'으로 보고 다시 안 보내 멈춘 것처럼 됐다 (사용자 지적 2026-10-12)
  if (!frameSubs.size && !replaySubs.size) { say("same"); return; }

  // 화면 판정 캐시 — 최근에 본 화면과 같으면(같은 판정 기준: 평균+타일) OCR을 통째로
  // 생략하고 지난 판정을 재적용한다. 맵↔노드 모달 왕복이 즉시(~0.5초) 반응하게 된다.
  for (const m of sceneMemos) {
    if (diff(latestGray, m.gray) < NEW_SCENE && tileMax(latestGray, m.gray) < NEW_TILE) {
      sentGray = latestGray;
      emitted++;
      console.debug(`[bridge] 이미 본 화면 → 판정 재적용 #${emitted} (OCR 생략)`);
      say("replay");
      scan = { id: prtsScanId(), emitAt: now, w: latestW, h: latestH, crop: 1, cached: true, href: location.href, oc: m.outcome };
      for (const cb of replaySubs) cb(m.outcome);
      finishScan();
      return;
    }
  }

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
  lastEmitGray = latestGray;   // 판정이 끝나면 memoBridgeScene이 이 화면과 짝지어 캐시한다
  emitted++;
  const cropped = c.w < w || c.h < h ? ` (여백 잘라 ${c.w}×${c.h})` : "";
  console.debug(`[bridge] 새 화면 → 인식 #${emitted} · ${w}×${h}${cropped} → ${outW}×${outH} (틱 ${ticks} · 수신 ${framesIn})`);
  say("emit");
  const ctx: ScanCtx = { id: prtsScanId(), emitAt: Date.now(), w, h, crop: (c.w * c.h) / (w * h), cached: false, href: location.href, retry: retryNext };
  retryNext = false;
  scan = ctx;
  void outCv.convertToBlob({ type: "image/jpeg", quality: 0.9 }).then((blob) => {
    ctx.blob = blob;   // '틀렸어요' 때만 올린다 — 그 전엔 메모리에만 (다음 인식이 오면 버린다)
    if (collectDir) { collectN++; notify(); void collectWrite(`${ctx.id}.jpg`, blob); }
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
  return { settings, gate, error, busy, note, lock, nodeJump: bridgeNodeJump() };
}

/** 프레임 공급원 — useClipboardWatch와 같은 모양이라 각 탭이 그대로 갈아 끼울 수 있다.
 *  화면 하나당 1장만 오므로 여기서 더 조를 필요는 없고, 인식 중에 온 프레임만 흘려보낸다. */
let busyLocal = false;   // 인식 중복 실행 방지 (구독자 공용 — 캡처는 하나뿐이다)

export function useBridgeWatch(enabled: boolean, onImage: (file: File) => Promise<void> | void,
  onReplay?: (oc: LensOutcome) => void): boolean {
  const [on, setOn] = useState(false);
  const cb = useRef(onImage);
  const rp = useRef(onReplay);
  useEffect(() => { cb.current = onImage; rp.current = onReplay; });

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
      const ocrStart = Date.now();
      void (async () => {
        try { await cb.current(file); } catch { /* 한 장 실패는 넘긴다 */ }
        finally { busyLocal = false; busy = false; finishScan(ocrStart); notify(); }
      })();
    };
    // 화면 판정 캐시 재적용 — OCR이 없어 빠르므로 busy 없이 바로 넘긴다
    const onCached = (oc: LensOutcome) => { try { rp.current?.(oc); } catch { /* 한 건 실패는 넘긴다 */ } };
    frameSubs.add(onFrame);
    replaySubs.add(onCached);
    // 화면이 새로 붙으면 지금 게임 화면을 한 번 다시 읽는다 — 떠나 있던 사이 본 화면은 이 화면에 안 들어왔다
    sentGray = null;
    return () => { frameSubs.delete(onFrame); replaySubs.delete(onCached); };
  }, [enabled]);

  return on;
}
