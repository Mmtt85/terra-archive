// 위수 협의 밴 카드 **얼굴 → 기물** 회귀 하네스 (app/lens/acface.ts) — 2026-09-07.
//
//   npx tsx scripts/verify-ac/face.ts        ← 리포 루트에서. 실패 시 exit 1
//
// 픽스처(git 미추적, 로컬): fixtures/lens/ac-frames/v1/f016~f036.png · v2/f010~f020.png (밴 목록 구간).
// 없으면 **조용히 건너뛴다** (pass 0 · fail 0 · "픽스처 없음").
//
// 무엇을 재나: 프레임을 브리지(app/lens/bridge.ts)가 넘기는 모양(어두운 여백 크롭 → 가로 900 → JPEG q0.9)으로
// 만들고, 고정 격자 + 행 밝기 투영으로 카드 박스를 다시 만들어(ac-lab face-truth.ts 의 방식을 복제 — ac-lab 은
// 지워질 예정이라 import 하지 않는다) 정답 TRUTH 와 연속 매칭한 뒤, 카드마다 cardFeature → 템플릿 121종과 비교한다.
//   (a) 전체 121종 1위%  (b) 티어 제한 1위%  (c) (맹약,티어) 제한 1위%  (d) solveBanRow 행 맹약·pick 정답률
//   (e) 마진 분포  (f) 카드당 ms — 기본 템플릿 vs 지터 27개 각각. 기본 모드는 박스를 ±2px·±6% 흔든 판도 잰다
//   (실제 격자가 완벽하지 않으니 — face-match.ts 의 sh±2 · sc0.94/1.06 모드와 같다).
// 하한: (c) ≥ 99% · (d) pick ≥ 98% · 행 맹약 오답 0 · 흔든 판에서 결함 제외 (c) ≥ 99% (기본 모드).
// 박스 294개(2026-09-07 실측)도 확인한다 — 박스 생성이 어긋나면 나머지 수치가 무의미해지기 때문.
//
// sharp 는 png/webp **디코드**와 브리지 시뮬레이션(900 축소·JPEG — 브라우저의 canvas drawImage 에 해당)에만 쓴다.
// 카드·템플릿의 크롭·축소는 운영 코드와 같은 pix.resampleRgb 다.
//
// 실측 (2026-09-07 · 294 카드 · 900px 판 · 결함 4장 포함 / 제외):
//   face-match.ts(128 캔버스·lanczos3) 인셋 0.10: 기본 전체 95.6 · 티어 97.3 · (맹약,티어) 99.3/100 | 지터 97.6 · 97.6 · 100/100
//   이 하네스(pix 한 번에 48)   인셋 0.10: 기본 94.2 · 97.3 · 99.7/100 · pick 99.7 | 지터 97.6 · 97.6 · 100/100 · pick 100
//   이 하네스                  인셋 0.13: 기본 96.9 · 97.3 · 99.7/100 · pick 99.7 | 지터 97.6 · 97.6 · 100/100 · pick 100  ← 채택
//   기본 모드 흔든 판(0.13): sh+2 98.6/99.7 · sh-2 99.7/100 · sc0.94 99.0/100 · sc1.06 99.7/100 — 행 맹약은 전부 96/96.
//   시간(node, M-시리즈): 카드 특징 0.45ms · 순위 0.10ms(기본)/1.9ms(지터) · 템플릿 op 당 1.5ms(기본)/40ms(지터).

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { cardFeature, templateFeatures, rankFaces, solveBanRow, type FaceCand, type FacePiece } from "../../app/lens/acface";
import type { Raster } from "../../app/lens/pix";

const ROOT = resolve(import.meta.dirname ?? __dirname, "../..");
const FRAMES = resolve(ROOT, "fixtures/lens/ac-frames");

// ── 정답 (사람이 프레임을 보고 확정, 2026-09-07 — 맹약 행 순서대로 · 카드 순서대로) ─────────────────
type GtRow = { bond: string; cards: { op: string; t: number }[] };
const TRUTH: Record<"v1" | "v2", GtRow[]> = {
  v1: [
    { bond: "kjeragShip", cards: [{ op: "char_172_svrash", t: 4 }, { op: "char_174_slbell", t: 3 }] },
    { bond: "lateranoShip", cards: [{ op: "char_245_cello", t: 6 }, { op: "char_1041_angel2", t: 6 }, { op: "char_1032_excu2", t: 5 }] },
    // 에기르 7장 — 6장까지 한 줄, 7번째(T1 언더플로우)는 아이콘·이름 없이 둘째 줄로 줄바꿈되어 별도 행처럼 보인다
    { bond: "egirShip", cards: [{ op: "char_1012_skadi2", t: 6 }, { op: "char_4145_ulpia", t: 5 }, { op: "char_1023_ghost2", t: 5 }, { op: "char_437_mizuki", t: 4 }, { op: "char_474_glady", t: 4 }, { op: "char_143_ghost", t: 2 }] },
    { bond: "egirShip", cards: [{ op: "char_4137_udflow", t: 1 }] },
    { bond: "visiShip", cards: [{ op: "char_1032_excu2", t: 5 }, { op: "char_341_sntlla", t: 5 }, { op: "char_4087_ines", t: 4 }, { op: "char_174_slbell", t: 3 }, { op: "char_108_silent", t: 2 }] },
    { bond: "raidShip", cards: [{ op: "char_4087_ines", t: 4 }, { op: "char_491_humus", t: 2 }, { op: "char_337_utage", t: 1 }] },
    { bond: "indomShip", cards: [{ op: "char_1023_ghost2", t: 5 }, { op: "char_107_liskam", t: 1 }] },
    { bond: "soloShip", cards: [{ op: "char_437_mizuki", t: 4 }, { op: "char_311_mudrok", t: 4 }] },
  ],
  v2: [
    { bond: "sargonShip", cards: [{ op: "char_1026_gvial2", t: 4 }, { op: "char_4148_philae", t: 3 }, { op: "char_4054_malist", t: 3 }, { op: "char_4139_papyrs", t: 2 }, { op: "char_381_bubble", t: 2 }, { op: "char_127_estell", t: 1 }] },
    { bond: "siracusaShip", cards: [{ op: "char_1038_whitw2", t: 6 }, { op: "char_291_aglina", t: 5 }, { op: "char_427_vigil", t: 3 }, { op: "char_140_whitew", t: 2 }, { op: "char_145_prove", t: 1 }] },
    { bond: "kazimierzShip", cards: [{ op: "char_4064_mlynar", t: 5 }, { op: "char_420_flamtl", t: 4 }, { op: "char_431_ashlok", t: 2 }] },
    // 기민 행: 모자=에이어스카르페, 뾰족귀=미니멀리스트 (2026-09-07 눈으로 교정)
    { bond: "skillfulShip", cards: [{ op: "char_294_ayer", t: 3 }, { op: "char_4054_malist", t: 3 }, { op: "char_253_greyy", t: 1 }] },
    { bond: "steadShip", cards: [{ op: "char_381_bubble", t: 2 }, { op: "char_431_ashlok", t: 2 }, { op: "char_196_sunbr", t: 1 }] },
    { bond: "visiShip", cards: [{ op: "char_341_sntlla", t: 5 }, { op: "char_108_silent", t: 2 }] },
    { bond: "miraShip", cards: [{ op: "char_291_aglina", t: 5 }, { op: "char_171_bldsk", t: 4 }, { op: "char_427_vigil", t: 3 }, { op: "char_4016_kazema", t: 2 }] },
  ],
};
// 원본(여백 크롭 후) 좌표의 카드 격자 — 실측 (findAcCards 정상 행에서). frames = 밴 목록이 보이는 구간.
const GRID: Record<"v1" | "v2", { x0: number; pitch: number; w: number; frames: [number, number] }> = {
  v1: { x0: 467, pitch: 205.7, w: 146, frames: [16, 36] },
  v2: { x0: 461, pitch: 193.2, w: 137, frames: [10, 20] },
};
const EXPECT_BOXES = 294;   // 2026-09-07 face-truth.ts 실측 (v1 187 + v2 107)
// 픽스처 결함(눈으로 확인, 2026-09-07): v1 f017 에기르 행 6번째 카드는 '준비 완료' 버튼에 완전히 가려짐,
// v2 f017 고수 행은 뷰포트 위쪽에 잘려 박스가 어긋남. 실제 파이프라인은 격자 단계에서 이런 카드를 걸러야 한다.
const isArtifact = (b: { video: string; frame: number; rowIdx: number; col: number }) =>
  (b.video === "v1" && b.frame === 17 && b.rowIdx === 2 && b.col === 5) || (b.video === "v2" && b.frame === 17 && b.rowIdx === 4);

// ── 브리지 시뮬레이션 (app/lens/bridge.ts 의 contentRect + OCR_MAX_W 축소 + JPEG q0.9 를 sharp 로 재현) ──
const OCR_MAX_W = 900, SMALL_W = 96, SMALL_H = 54;
type Frame = { rgba: Uint8ClampedArray; width: number; height: number; scale: number };
function contentRect(g: Uint8Array, w: number, h: number) {
  const DARK = 40;
  const rowLit = (y: number) => { for (let x = 0; x < SMALL_W; x++) if (g[y * SMALL_W + x] > DARK) return true; return false; };
  const colLit = (x: number) => { for (let y = 0; y < SMALL_H; y++) if (g[y * SMALL_W + x] > DARK) return true; return false; };
  let top = 0, bottom = SMALL_H - 1, left = 0, right = SMALL_W - 1;
  while (top < bottom && !rowLit(top)) top++;
  while (bottom > top && !rowLit(bottom)) bottom--;
  while (left < right && !colLit(left)) left++;
  while (right > left && !colLit(right)) right--;
  const fx = left / SMALL_W, fy = top / SMALL_H, fw = (right + 1 - left) / SMALL_W, fh = (bottom + 1 - top) / SMALL_H;
  if (fw * fh < 0.4) return { x: 0, y: 0, w, h };
  return { x: Math.round(fx * w), y: Math.round(fy * h), w: Math.max(4, Math.round(fw * w)), h: Math.max(4, Math.round(fh * h)) };
}
async function loadBridgeFrame(path: string, maxW: number): Promise<Frame> {
  const meta = await sharp(path).metadata();
  const small = await sharp(path).resize(SMALL_W, SMALL_H, { fit: "fill" }).greyscale().raw().toBuffer();
  const crop = contentRect(new Uint8Array(small), meta.width!, meta.height!);
  const outW = Math.min(crop.w, maxW), outH = Math.round((crop.h / crop.w) * outW);
  let pipe = sharp(path).extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h });
  if (outW !== crop.w) pipe = pipe.resize(outW, outH, { kernel: "lanczos3" });
  const jpeg = await pipe.jpeg({ quality: 90 }).toBuffer();
  // 픽셀은 JPEG 를 다시 디코드해서 — 브라우저도 File(JPEG) 을 디코드해 쓴다
  const { data, info } = await sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, scale: outW / crop.w };
}
const framePath = (v: "v1" | "v2", n: number) => resolve(FRAMES, v, `f${String(n).padStart(3, "0")}.png`);

// ── 카드 박스 생성 (face-truth.ts 복제): 고정 x 격자 + 행은 밝기 투영, 행의 카드 수·티어 패턴을 정답과 연속 매칭 ──
// ⚠ 티어 판독은 2026-09-06 판 readTier 를 **여기 복제**해 쓴다 (git fa9b019e 의 acvision.ts). 정답 상자 294개가
//   그 판독으로 만들어졌고, 운영 acvision.readTier 는 격자 작업으로 계속 바뀌어(2026-09-07 시그니처·문턱 변경)
//   그걸 따라가면 상자 수가 흔들린다 (실측: 새 판을 그대로 물리자 294→273). 라벨링 도구는 얼어 있어야 한다.
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}
const LEGACY_HUES = [{ tier: 6, h: 31 }, { tier: 5, h: 46 }, { tier: 4, h: 189 }, { tier: 3, h: 161 }];
function readTierLegacy(px: Uint8ClampedArray, W: number, H: number, cx: number, cy: number, cw: number, chh: number): number | null {
  const x0 = Math.round(cx + cw * 0.02), x1 = Math.round(cx + cw * 0.24);
  const y0 = Math.round(cy + chh * 0.70), y1 = Math.round(cy + chh * 0.97);
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;
  if (y1 > H || y0 < 0 || x1 > W) return null;
  const hits: number[] = [];
  let white = 0, total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    const [h, s, v] = rgbToHsv(px[i], px[i + 1], px[i + 2]);
    total++;
    if (v > 0.72 && s < 0.30) white++;
    if (s >= 0.45 && v > 0.55) hits.push(h);
  }
  if (!total) return null;
  if (hits.length > total * 0.06) {
    let sx = 0, sy = 0;
    for (const h of hits) { sx += Math.cos(h * Math.PI / 180); sy += Math.sin(h * Math.PI / 180); }
    let hm = Math.atan2(sy, sx) * 180 / Math.PI; if (hm < 0) hm += 360;
    let best: number | null = null, bestD = 12;
    for (const c of LEGACY_HUES) { const d = Math.min(Math.abs(hm - c.h), 360 - Math.abs(hm - c.h)); if (d < bestD) { bestD = d; best = c.tier; } }
    if (best !== null) return best;
  }
  return white / total > 0.15 ? 2 : 1;
}
type Rect = { x: number; y: number; w: number; h: number };
type Box = { video: "v1" | "v2"; frame: number; rowIdx: number; bond: string; col: number; op: string; t: number; px: Rect /* 900px 판 좌표 */ };
const lum = (px: Uint8ClampedArray, i: number) => px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
function boxesOfFrame(video: "v1" | "v2", n: number, orig: Frame, scale: number): Box[] {
  const g = GRID[video], rows = TRUTH[video];
  const { rgba: px, width: W, height: H } = orig;
  const rowP = new Float32Array(H);
  const cx0 = g.x0 + 10, cx1 = g.x0 + g.w - 10;
  for (let y = 0; y < H; y++) { let c = 0; for (let x = cx0; x < cx1; x++) if (lum(px, (y * W + x) * 4) > 60) c++; rowP[y] = c / (cx1 - cx0); }
  const runs: [number, number][] = []; let s = -1;
  for (let y = 0; y < H; y++) { if (rowP[y] >= 0.15 && s < 0) s = y; else if (rowP[y] < 0.15 && s >= 0) { if (y - s >= 8) runs.push([s, y - 1]); s = -1; } }
  if (s >= 0) runs.push([s, H - 1]);
  const merged: [number, number][] = [];
  for (const r of runs) { const l = merged[merged.length - 1]; if (l && r[0] - l[1] < 30) l[1] = r[1]; else merged.push([r[0], r[1]]); }
  const cand = merged.filter(([a, b]) => b - a + 1 >= g.w * 0.8 && b - a + 1 <= g.w * 1.15 && a >= 2 && a + g.w <= H - 2);
  type Obs = { y: number; count: number; tiers: (number | null)[] };
  const obs: Obs[] = [];
  for (const [a] of cand) {
    const y = a; let count = 0; const tiers: (number | null)[] = [];
    for (let k = 0; k < 6; k++) {
      const x = Math.round(g.x0 + k * g.pitch); if (x + g.w > W) break;
      let sum = 0, cnt = 0;
      for (let yy = y + 10; yy < y + g.w - 10; yy += 2) for (let xx = x + 10; xx < x + g.w - 10; xx += 2) { sum += lum(px, (yy * W + xx) * 4); cnt++; }
      if (sum / cnt < 45) break;
      count++; tiers.push(readTierLegacy(px, W, H, x, y, g.w, g.w));
    }
    if (count) obs.push({ y, count, tiers });
  }
  if (!obs.length) return [];
  // 행 품질 = 티어 일치율 (카드 수는 정답과 같거나 +1 — 우하단 '준비 완료' 버튼이 6번째 칸을 밝힌다)
  const quality = (o: Obs, r: GtRow) => {
    if (o.count !== r.cards.length && o.count !== r.cards.length + 1) return -1;
    let m = 0; for (let k = 0; k < r.cards.length; k++) if (o.tiers[k] === r.cards[k].t) m++;
    return m / r.cards.length;
  };
  let best = { s: 0, i: 0, score: -Infinity };
  for (let s0 = 0; s0 < obs.length; s0++) {
    for (let i = 0; i + (obs.length - s0) <= rows.length; i++) {
      let score = -s0 * 0.4;
      for (let j = 0; s0 + j < obs.length; j++) { const q = quality(obs[s0 + j], rows[i + j]); score += q >= 0.5 ? q : -2; }
      if (score > best.score) best = { s: s0, i, score };
    }
  }
  const out: Box[] = [];
  obs.forEach((o, j) => {
    const r = j < best.s ? null : rows[best.i + j - best.s];
    if (!r || quality(o, r) < 0.5) return;
    r.cards.forEach((c, k) => {
      const ox = Math.round(g.x0 + k * g.pitch);
      out.push({ video, frame: n, rowIdx: rows.indexOf(r), bond: r.bond, col: k, op: c.op, t: c.t,
        px: { x: Math.round(ox * scale), y: Math.round(o.y * scale), w: Math.round(g.w * scale), h: Math.round(g.w * scale) } });
    });
  });
  return out;
}
/** 박스 흔들기 — sh±d: 좌상단 d px 이동 · sc f: 중심 고정 f 배 */
function perturb(r: Rect, mode: string): Rect {
  if (mode.startsWith("sh")) { const d = parseInt(mode.slice(2), 10); return { ...r, x: r.x + d, y: r.y + d }; }
  if (mode.startsWith("sc")) { const f = parseFloat(mode.slice(2)); const nw = Math.round(r.w * f); return { x: r.x + Math.round((r.w - nw) / 2), y: r.y + Math.round((r.h - nw) / 2), w: nw, h: nw }; }
  return r;
}

// ── 템플릿 (sharp 는 webp 디코드만 — 변환·축소는 acface.templateFeatures 가 pix 로) ─────────────────
async function portraitRaster(op: string): Promise<Raster | null> {
  const paths = [`public/skin/portrait/${op}_2.webp`, `public/skin/portrait/${op}_1.webp`, `public/avatars/${op}.webp`].map((p) => resolve(ROOT, p));
  const p = paths.find((q) => existsSync(q));
  if (!p) return null;
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: 4 };
}

const pct = (n: number, d: number) => d ? `${(n / d * 100).toFixed(1)}%` : "-";
const med = (a: number[]) => a.length ? a.slice().sort((p, q) => p - q)[a.length >> 1] : NaN;
const f3 = (x: number) => isNaN(x) ? "-" : x.toFixed(3);

// ── 평가 ────────────────────────────────────────────────────────────────────────────────────────
type Eval = {
  n: number; nClean: number; top1: number; tier1: number; cand1: number; cand1Clean: number; mOk: number[]; mBad: number[]; msRank: number;
  rowN: number; rowBondOk: number; rowBondNull: number; rowBondBad: number; pickN: number; pickOk: number; pickNClean: number; pickOkClean: number; wrong: string[];
};
function evaluate(boxes: Box[], feats: Float32Array[], pieces: FacePiece[], ops: string[], tpl: Map<string, Float32Array[]>): Eval {
  const cands: FaceCand[] = ops.filter((o) => tpl.has(o)).map((o) => ({ op: o, feats: tpl.get(o)! }));
  const ev: Eval = { n: boxes.length, nClean: 0, top1: 0, tier1: 0, cand1: 0, cand1Clean: 0, mOk: [], mBad: [], msRank: 0,
    rowN: 0, rowBondOk: 0, rowBondNull: 0, rowBondBad: 0, pickN: 0, pickOk: 0, pickNClean: 0, pickOkClean: 0, wrong: [] };
  const tag = (b: Box, k = b.col) => `${b.video}/f${String(b.frame).padStart(3, "0")} 행${b.rowIdx}열${k}${isArtifact(b) ? "(결함)" : ""}`;
  boxes.forEach((b, i) => {
    const t = performance.now();
    const ranked = rankFaces(feats[i], cands);
    ev.msRank += performance.now() - t;
    const score = new Map(ranked.map((r) => [r.op, r.score]));
    const truth = score.get(b.op) ?? -Infinity;
    const art = isArtifact(b);
    if (!art) ev.nClean++;
    if (!ranked.some((r) => r.score > truth)) ev.top1++;
    const tierOps = pieces.filter((p) => p.t === b.t).map((p) => p.op);
    if (!tierOps.some((o) => (score.get(o) ?? -Infinity) > truth)) ev.tier1++;
    const candOps = [...new Set(pieces.filter((p) => p.t === b.t && p.bonds.includes(b.bond)).map((p) => p.op))];
    const cs = candOps.map((o) => ({ o, s: score.get(o) ?? -Infinity })).sort((a, c) => c.s - a.s);
    const ok = cs[0]?.o === b.op;
    if (ok) { ev.cand1++; if (!art) ev.cand1Clean++; }
    else ev.wrong.push(`(c) ${tag(b)} ${b.op}→${cs[0]?.o} (${cs.length}후보)`);
    if (cs.length >= 2) (ok ? ev.mOk : ev.mBad).push(cs[0].s - cs[1].s);
  });
  // solveBanRow — 프레임 안의 행 단위 (정답 티어를 넣는다: 티어 판독은 격자 단계의 몫)
  const rows = new Map<string, number[]>();
  boxes.forEach((b, i) => { const k = `${b.video}-${b.frame}-${b.rowIdx}`; if (!rows.has(k)) rows.set(k, []); rows.get(k)!.push(i); });
  for (const [, idx] of rows) {
    idx.sort((a, c) => boxes[a].col - boxes[c].col);
    const r = solveBanRow(idx.map((i) => ({ tier: boxes[i].t, feat: feats[i] })), pieces, tpl);
    const b0 = boxes[idx[0]];
    ev.rowN++;
    if (r.bond === b0.bond) ev.rowBondOk++;
    else if (r.bond === null) ev.rowBondNull++;
    else { ev.rowBondBad++; ev.wrong.push(`행 맹약 오답 ${tag(b0)} ${b0.bond}→${r.bond}`); }
    idx.forEach((i, k) => {
      const b = boxes[i], art = isArtifact(b);
      ev.pickN++; if (!art) ev.pickNClean++;
      if (r.picks[k]?.op === b.op) { ev.pickOk++; if (!art) ev.pickOkClean++; }
      else ev.wrong.push(`pick 오답 ${tag(b, k)} ${b.op}→${r.picks[k]?.op} m=${f3(r.picks[k]?.margin ?? NaN)}`);
    });
  }
  return ev;
}
const evalLine = (ev: Eval) =>
  `${pct(ev.top1, ev.n)} | ${pct(ev.tier1, ev.n)} | ${pct(ev.cand1, ev.n)}/${pct(ev.cand1Clean, ev.nClean)} | ${ev.rowBondOk}/${ev.rowBondNull}/${ev.rowBondBad} (${ev.rowN}) · ${pct(ev.pickOk, ev.pickN)}/${pct(ev.pickOkClean, ev.pickNClean)} | ${f3(med(ev.mOk))}/${f3(Math.min(...ev.mOk))} · ${ev.mBad.length ? f3(Math.max(...ev.mBad)) : "-"}(${ev.mBad.length}) | ${(ev.msRank / ev.n).toFixed(2)}`;

export async function verify(): Promise<{ name: string; pass: number; fail: number; lines: string[] }> {
  const name = "ac-face";
  const lines: string[] = [];
  let pass = 0, fail = 0;
  const check = (ok: boolean, msg: string) => { if (ok) pass++; else fail++; lines.push(`${ok ? "PASS" : "FAIL"} ${msg}`); };
  if (!existsSync(framePath("v1", 16)) || !existsSync(framePath("v2", 10))) return { name, pass, fail, lines: ["픽스처 없음 — 건너뜀 (fixtures/lens/ac-frames/)"] };

  const doc = JSON.parse(readFileSync(resolve(ROOT, "app/data/autochess.json"), "utf8")) as { chess: { id: string; op?: string | null; t: number; bonds: string[] }[] };
  const pieces: FacePiece[] = doc.chess.filter((c) => c.op).map((c) => ({ id: c.id, op: c.op!, t: c.t, bonds: c.bonds }));
  const ops = [...new Set(pieces.map((p) => p.op))];

  // 템플릿 — 기본 / 지터 (시간 측정)
  const tplBase = new Map<string, Float32Array[]>(), tplJit = new Map<string, Float32Array[]>();
  let msBase = 0, msJit = 0, missing = 0;
  for (const op of ops) {
    const r = await portraitRaster(op);
    if (!r) { missing++; continue; }
    let t = performance.now(); tplBase.set(op, templateFeatures(r, false)); msBase += performance.now() - t;
    t = performance.now(); tplJit.set(op, templateFeatures(r, true)); msJit += performance.now() - t;
  }
  check(missing === 0, `템플릿 이미지 ${ops.length - missing}/${ops.length} (없는 op ${missing})`);
  lines.push(`템플릿 특징 시간: 기본 ${msBase.toFixed(0)}ms (op당 ${(msBase / ops.length).toFixed(1)}) · 지터27 ${msJit.toFixed(0)}ms (op당 ${(msJit / ops.length).toFixed(1)})`);

  // 박스 + 900px 판 픽셀
  const boxes: Box[] = [];
  const frames900 = new Map<string, Frame>();
  for (const video of ["v1", "v2"] as const) {
    const [a, b] = GRID[video].frames;
    for (let n = a; n <= b; n++) {
      const p = framePath(video, n);
      if (!existsSync(p)) continue;
      const orig = await loadBridgeFrame(p, Infinity);
      const f9 = await loadBridgeFrame(p, OCR_MAX_W);
      frames900.set(`${video}-${n}`, f9);
      boxes.push(...boxesOfFrame(video, n, orig, f9.scale));
    }
  }
  const nArt = boxes.filter(isArtifact).length;
  check(boxes.length === EXPECT_BOXES, `카드 박스 ${boxes.length} (기대 ${EXPECT_BOXES} · v1 ${boxes.filter((b) => b.video === "v1").length} · v2 ${boxes.filter((b) => b.video === "v2").length} · 결함 ${nArt})`);

  // 카드 특징 (박스 모드별)
  let msFeat = 0;
  const featsOf = (mode: string) => boxes.map((b) => {
    const f = frames900.get(`${b.video}-${b.frame}`)!;
    const t = performance.now();
    const feat = cardFeature(f.rgba, f.width, f.height, perturb(b.px, mode));
    msFeat += performance.now() - t;
    return feat;
  });
  const feats = featsOf("none");
  const N = boxes.length;
  lines.push(`표본: ${N} 카드 (결함 ${nArt} · 클린 ${N - nArt}) · 카드 특징 ${(msFeat / N).toFixed(2)}ms/카드`);
  lines.push("모드 | (a)전체1위 | (b)티어1위 | (c)맹약·티어1위 전체/클린 | (d)행 맹약 정답/미정/오답 (행) · pick 전체/클린 | (e)마진 정답 중앙값/최소 · 오답 최대(n) | (f)순위 ms/카드");
  const base = evaluate(boxes, feats, pieces, ops, tplBase);
  const jit = evaluate(boxes, feats, pieces, ops, tplJit);
  lines.push(`기본 | ${evalLine(base)}`);
  for (const w of base.wrong) lines.push(`  기본 ${w}`);
  lines.push(`지터27 | ${evalLine(jit)}`);
  for (const w of jit.wrong) lines.push(`  지터27 ${w}`);

  // 하한 — 기본 모드(운영 기본값, acface-load.ts FACE_JITTER_DEFAULT=false) 기준
  check(base.cand1 / N >= 0.99, `(c) (맹약,티어) 제한 1위 ${pct(base.cand1, N)} ≥ 99%`);
  check(base.pickOk / base.pickN >= 0.98, `(d) solveBanRow pick ${pct(base.pickOk, base.pickN)} ≥ 98%`);
  check(base.rowBondBad === 0, `(d) solveBanRow 행 맹약 오답 ${base.rowBondBad} (정답 ${base.rowBondOk} · 미정 ${base.rowBondNull} / ${base.rowN})`);

  // 박스 흔들림 (기본 모드) — 격자가 몇 px 어긋나도 (맹약,티어) 제한이 버티는지
  for (const mode of ["sh+2", "sh-2", "sc0.94", "sc1.06"]) {
    const ev = evaluate(boxes, featsOf(mode), pieces, ops, tplBase);
    check(ev.cand1Clean / ev.nClean >= 0.99, `흔든 판 ${mode} (기본): (c) ${pct(ev.cand1, ev.n)}/${pct(ev.cand1Clean, ev.nClean)} 클린 ≥ 99% · 행 맹약 ${ev.rowBondOk}/${ev.rowBondNull}/${ev.rowBondBad} · pick ${pct(ev.pickOk, ev.pickN)}/${pct(ev.pickOkClean, ev.pickNClean)}`);
  }
  return { name, pass, fail, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verify().then((r) => {
    console.log(`[${r.name}] pass ${r.pass} · fail ${r.fail}`);
    for (const l of r.lines) console.log(l);
    if (r.fail) process.exit(1);
  }).catch((e) => { console.error(e); process.exit(1); });
}
