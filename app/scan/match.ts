// 오퍼 스캐너 — 이름 OCR 결과 + 성급/직군 신호로 오퍼레이터를 식별한다.
// 카드 아트 매칭 불가 → 이름 OCR이 주 식별자. 성급·직군은 fuzzy 매칭을 좁히는 제약.
// (2026-07-23 검증) 성급+직군 제약이 전체436 무제약 10~11/14 → 13~14/14로 끌어올림.
// 안전 설계: 성급·직군은 HARD 배제가 아니라 강한 점수 부스트(신호 오검이 매칭을 죽이지 않게).
// 직군은 clsConf≥0.8일 때만 적용(신뢰도 게이트).
import { ops } from "../planner-engine";
import { JOB_TO_CLASS, type ClassKey } from "./vision";

export interface Signal {
  rarity: number;   // 1~6 (0=미검출)
  cls: ClassKey;
  clsConf: number;  // ZNCC 상관
}

export interface MatchResult {
  id: string;
  name: string;
  score: number;      // 종합 점수
  nameSim: number;    // 이름 유사도 0~1
  rarity: number;
  cls: ClassKey;
  confident: boolean; // 신뢰(수동확인 불필요) 여부
}

const CLASS_CONF_GATE = 0.8;
const W_RARITY = 0.18;  // 성급 일치 부스트
const W_CLASS = 0.12;   // 직군 일치 부스트(게이트 통과 시)
const CONFIDENT_NAME = 0.62; // 이 이상이면 이름만으로 신뢰

// ── 정규화 ───────────────────────────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
// OCR 숫자·꼬리 노이즈 제거(레벨 숫자가 이름에 붙거나, 조사·오탐 음절이 붙는 경우)
const stripNoise = (s: string) =>
  s.replace(/^\d+|\d+$/g, "").replace(/(를|을|보|룰|즐|뿔|블|·|\.|,|'|"|\||=|_)+$/g, "").trim();

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function sim(a: string, b: string): number {
  if (!a || !b) return 0;
  const d = lev(a, b);
  const base = 1 - d / Math.max(a.length, b.length);
  // 포함 관계 보너스(OCR이 이름 일부만/여분을 붙였을 때)
  if (a.includes(b) || b.includes(a)) return Math.max(base, 0.6 + 0.4 * (Math.min(a.length, b.length) / Math.max(a.length, b.length)));
  return base;
}

// 후보 이름 집합(정규화된 name + aliases)을 사전 계산
interface Cand { id: string; name: string; rarity: number; cls: ClassKey; keys: string[]; }
let CANDS: Cand[] | null = null;
function candidates(): Cand[] {
  if (CANDS) return CANDS;
  CANDS = ops.map((o) => {
    const keys = [norm(o.name), ...(Array.isArray(o.aliases) ? o.aliases : []).map(norm)].filter(Boolean);
    return { id: o.id, name: o.name, rarity: o.rarity, cls: JOB_TO_CLASS[o.job] ?? "guard", keys };
  });
  return CANDS;
}

// ocrText 하나에 대한 최상위 매칭
export function matchOperator(ocrText: string, sig: Signal): MatchResult | null {
  const raw = norm(ocrText);
  const stripped = norm(stripNoise(ocrText));
  if (raw.length < 1 && stripped.length < 1) return null;
  const useClass = sig.clsConf >= CLASS_CONF_GATE;

  let best: MatchResult | null = null;
  for (const c of candidates()) {
    let ns = 0;
    for (const k of c.keys) ns = Math.max(ns, sim(raw, k), stripped ? sim(stripped, k) : 0);
    let score = ns;
    if (sig.rarity && c.rarity === sig.rarity) score += W_RARITY;
    if (useClass && c.cls === sig.cls) score += W_CLASS;
    if (!best || score > best.score) {
      best = { id: c.id, name: c.name, score, nameSim: ns, rarity: c.rarity, cls: c.cls, confident: false };
    }
  }
  if (best) {
    // 신뢰 판정: 이름이 확실하거나(≥CONFIDENT_NAME) 이름+신호가 함께 지지
    best.confident = best.nameSim >= CONFIDENT_NAME ||
      (best.nameSim >= 0.45 && ((sig.rarity && best.rarity === sig.rarity) as boolean) && (useClass ? best.cls === sig.cls : true));
  }
  return best;
}
