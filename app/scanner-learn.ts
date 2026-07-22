"use client";

// 자가학습 카드 아트 인덱스 — 신 UI 카드 일러스트가 공개 애셋에 없어(2026-07-22 판정)
// 유저 화면 자체에서 배운다: 이름 OCR로 확실히 식별된 카드의 상단 정사각 그레이 지문을
// localStorage에 저장 → 이후 스캔에서 OCR이 못 읽은 카드(1~2자 이름·저신뢰)를 이미지로 식별.
// 스킨을 바꾸지 않는 한 같은 계정의 카드 아트는 불변이라 두 번째 스캔부터 강해진다.
// 100% 클라이언트 — 지문(수백 바이트/오퍼)만 로컬 저장, 어디에도 전송 없음.

const KEY = "terra-archive-scan-learn-v1";
const S = 16;
const DIM = S * S;
const MAX_PER_OP = 2; // 오퍼당 지문 수 (스킨 변경 대응 — 오래된 것부터 교체)

type Store = Record<string, string[]>; // opId → base64(gray16 raw) 목록
let store: Store | null = null;

function load(): Store {
  if (store) return store;
  try { store = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store; }
  catch { store = {}; }
  return store!;
}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(store ?? {})); } catch { /* 용량 초과 등 무시 */ } }

const scratch = typeof document !== "undefined" ? document.createElement("canvas") : null;

// 카드 상단 정사각 → 정규화 벡터 (scanner-match.ts와 동일 수식)
export function cardVec(frame: CanvasImageSource, box: { x: number; y: number; w: number; h: number }): Float32Array | null {
  const side = Math.min(box.w, box.h);
  if (side < 8) return null;
  const canvas = scratch!;
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame, box.x, box.y, box.w, side, 0, 0, S, S);
  const { data } = ctx.getImageData(0, 0, S, S);
  const v = new Float32Array(DIM);
  let mean = 0;
  for (let i = 0; i < DIM; i += 1) { v[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; mean += v[i]; }
  mean /= DIM;
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) { v[i] -= mean; norm += v[i] * v[i]; }
  norm = Math.sqrt(norm);
  if (norm < 1e-6) return null;
  for (let i = 0; i < DIM; i += 1) v[i] /= norm;
  return v;
}

function decode(b64: string): Float32Array {
  const raw = atob(b64);
  const v = new Float32Array(DIM);
  let mean = 0;
  for (let i = 0; i < DIM; i += 1) { v[i] = raw.charCodeAt(i); mean += v[i]; }
  mean /= DIM;
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) { v[i] -= mean; norm += v[i] * v[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i += 1) v[i] /= norm;
  return v;
}

// 확실히 식별된 카드의 지문 학습 (원시 그레이 바이트로 저장 — 정규화는 로드 시)
export function learnCard(opId: string, frame: CanvasImageSource, box: { x: number; y: number; w: number; h: number }): void {
  const side = Math.min(box.w, box.h);
  if (side < 8) return;
  const canvas = scratch!;
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(frame, box.x, box.y, box.w, side, 0, 0, S, S);
  const { data } = ctx.getImageData(0, 0, S, S);
  let raw = "";
  for (let i = 0; i < DIM; i += 1) raw += String.fromCharCode(Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]));
  const b64 = btoa(raw);
  const st = load();
  const list = st[opId] ?? [];
  if (list.includes(b64)) return;
  st[opId] = [...list.slice(-(MAX_PER_OP - 1)), b64];
  persist();
}

export type LearnedMatch = { operatorId: string; score: number };

// 학습된 지문과 매칭 — OCR이 못 읽은 카드용. minScore 미달이면 null.
export function matchLearned(frame: CanvasImageSource, box: { x: number; y: number; w: number; h: number }, minScore = 0.86): LearnedMatch | null {
  const st = load();
  const v = cardVec(frame, box);
  if (!v) return null;
  let best: LearnedMatch | null = null;
  for (const [opId, list] of Object.entries(st)) {
    for (const b64 of list) {
      const t = decode(b64);
      let s = 0;
      for (let i = 0; i < DIM; i += 1) s += v[i] * t[i];
      if (!best || s > best.score) best = { operatorId: opId, score: s };
    }
  }
  return best && best.score >= minScore ? best : null;
}

export function learnedCount(): number { return Object.keys(load()).length; }
