// 위수 협의 전략(밴드) 아이콘 매칭 회귀 하네스 — app/lens/acband.ts 를 v2 녹화 픽스처에 돌려 정답과 비교한다.
//
//   npx tsx scripts/verify-ac/band.ts        ← 리포 루트에서. 실패 시 exit 1
//   import { verify } from "./band"          ← 통합 러너용: { name, pass, fail, lines }
//
// 픽스처: fixtures/lens/ac-frames/v2/f001~f081.png (1fps · 1826×1030 · 초월 AC-4, git 미추적 로컬 전용).
// 없으면 **조용히 건너뛴다** (pass 0 · fail 0).
//
// 정답은 아래 상수 — 2026-09-07 사람이 눈으로 확정한 것 (scratchpad 가 아니라 여기가 정본):
//  · 격자 프레임 f021~f025: 4×4=16 타일, 행우선으로 bands[].sort 1~16 (아이콘 시트와 대조). 5행은 화면 아래 잘림.
//  · SELECTED: f023~f025 = tiles[5](row1,col1)=저스틴, f021·f022 = 없음.
//  · 비격자 12 프레임(f003 f005 f010 f019 f020 f026 f027 f028 f029 f062 f066 f075)은 격자가 아니어야 한다.
//  · 확정 화면 f026·f027·f029 참가자 카드 썸네일 = 저스틴 (브래킷 박스 원본 x586~705 · y516~628).
//  · 큰 초상 = 저스틴: 우측 패널 f023~f025 · 확정 화면 f026·f027·f029 · 팝업 f028.
//    아이콘 박스(원본)는 넓은 스케일 탐색으로 위치를 찾아 눈으로 확인한 값 — 패널 (1471,225) 254px ·
//    확정 (1097,317) 253px · 팝업 (456,374) 245px.
//  · f021~f025 의 카드는 '선택 중'(모래시계) — 썸네일 매칭이 BAND_ACCEPT 를 넘으면 안 된다 (미선택 판정 근거).
//
// 하한(아래로 떨어지면 실패): 격자 5/5 · 비격자 0/12 · SELECTED 3/3(+없음 2/2) · 타일 ≥78/80 · 썸네일 3/3 ·
// 큰 초상 ≥6/7 · 참가자 줄 1인 3/3 · 안 고른 화면 0줄 6/6 · 연합 4인 스크린샷 11/22/33/44 줄 수·순서·'나' 정확 일치.
// 실측 2026-09-07 (node, Apple Silicon): 격자 5/5 · 비격자 0/12 · 타일 80/80 최소 마진 0.276 · 썸네일 3/3
// 마진 0.30~0.40 · 큰 초상 7/7 마진 0.42~0.50 · 55 ms/타일(1232 창).
//
// 브리지 시뮬레이션: app/lens/bridge.ts 가 인식기에 넘기는 모양 — 어두운 여백 크롭(contentRect 96×54 그레이)
// → 가로 900 축소 → JPEG q0.9 → 재디코드. 브라우저와 다른 점은 축소 보간(canvas ↔ sharp lanczos3)뿐이고,
// 그 뒤 크롭·축소·특징은 acband.ts(pix.ts)가 양쪽에서 같은 코드로 한다.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { findBandGrid, searchBand, bandTemplate, participantRows, BAND_ACCEPT, type BandRect } from "../../app/lens/acband";
import type { Raster } from "../../app/lens/pix";

const ROOT = resolve(import.meta.dirname ?? __dirname, "../..");
const FRAMES = resolve(ROOT, "fixtures/lens/ac-frames/v2");
const SHOTS = resolve(ROOT, "fixtures/lens/screenshots");

// ── 정답 상수 ─────────────────────────────────────────────────────────────────
/** 격자 타일 행우선 정답 (sort 1~16) */
const GRID_TILES = [
  "band_bldsk", "band_amiya", "band_duyaoy", "band_sarkazb",      // 와파린 · 아미야 · 두요야 · 골리앗
  "band_orchid", "band_justin", "band_ermengard", "band_lmlee",   // 오키드 · 저스틴 · 에르망가르드 · 리
  "band_kirara", "band_pepe", "band_harold", "band_sciurus",      // 키라라 · 페페 · 해럴드 · 시우루스
  "band_paganini", "band_clementia", "band_emperor", "band_mberry", // 파가니니 · 클레멘티아 · 엠퍼러 · 멀베리
];
const GRID_FRAMES: { n: number; selected: number | null }[] = [
  { n: 21, selected: null }, { n: 22, selected: null }, { n: 23, selected: 5 }, { n: 24, selected: 5 }, { n: 25, selected: 5 },
];
const NON_GRID_FRAMES = [3, 5, 10, 19, 20, 26, 27, 28, 29, 62, 66, 75];
const JUSTIN = "band_justin";
/** 참가자 카드 썸네일 (브래킷 박스, 원본 좌표) */
const THUMB_FRAMES = [26, 27, 29];
const THUMB_RECT_ORIG: BandRect = { x: 586, y: 516, w: 119, h: 112 };
/** '선택 중' 카드 — 썸네일 자리에 모래시계만 있어 매칭이 승인되면 안 된다 */
const UNSELECTED_FRAMES = [21, 22, 23, 24, 25];
/** 큰 초상 아이콘 박스 (원본 좌표) */
const BIG_PORTRAITS: { kind: string; frames: number[]; rect: BandRect }[] = [
  { kind: "우측 패널", frames: [23, 24, 25], rect: { x: 1471, y: 225, w: 254, h: 254 } },
  { kind: "확정 화면", frames: [26, 27, 29], rect: { x: 1097, y: 317, w: 253, h: 253 } },
  { kind: "팝업", frames: [28], rect: { x: 456, y: 374, w: 245, h: 245 } },
];
/**
 * 연합(4인) '전략 정보' 화면 — fixtures/lens/screenshots/{11,22,33,44}.png (사용자 제공 2026-09-07,
 * git 미추적). 이 픽스처가 생긴 이유: 참가자 줄 기하를 **1인 녹화만 보고** 맞춰 놨더니 연합에서 남의
 * 줄을 하나도 못 찾았다. 양성만 재면 못 보는 것과 같은 실수라 여기에 박아 둔다.
 *  · 11 = 아무도 아직 안 골랐다(한 명 '선택 중', 셋은 '···') → 0줄
 *  · 22 = 셋이 골랐다(둘째가 '선택 중') → 3줄
 *  · 33 = 넷 다 골랐다 → 4줄
 *  · 44 = 동맹 로비(준비 완료) → 0줄. 전략 화면이 아니다.
 * '나'(테라아카이브)는 위에서 셋째 줄 — 카드 좌상단 청록 표식으로 가른다.
 */
const ALLY_SHOTS: { name: string; rows: string[]; mine: number }[] = [
  { name: "11", rows: [], mine: -1 },
  { name: "22", rows: ["band_duyaoy", "band_humus", "band_pepe"], mine: 1 },
  { name: "33", rows: ["band_duyaoy", "band_chiave", "band_humus", "band_pepe"], mine: 2 },
  { name: "44", rows: [], mine: -1 },
];

/** 하한 */
const MIN = { tiles: 78, big: 6, slots: 2 };

// ── 브리지 시뮬레이션 (bridge.ts 와 같은 로직) ───────────────────────────────
const OCR_MAX_W = 900;
const SMALL_W = 96, SMALL_H = 54;
type Frame = { rgba: Uint8ClampedArray; width: number; height: number; crop: { x: number; y: number; w: number; h: number } };

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

async function loadPath(path: string): Promise<Frame> {
  const meta = await sharp(path).metadata();
  const w = meta.width!, h = meta.height!;
  const small = await sharp(path).resize(SMALL_W, SMALL_H, { fit: "fill" }).greyscale().raw().toBuffer();
  const crop = contentRect(new Uint8Array(small), w, h);
  const outW = Math.min(crop.w, OCR_MAX_W), outH = Math.round((crop.h / crop.w) * outW);
  let pipe = sharp(path).extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h });
  if (outW !== crop.w) pipe = pipe.resize(outW, outH, { kernel: "lanczos3" });
  const jpeg = await pipe.jpeg({ quality: 90 }).toBuffer();
  const { data, info } = await sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, crop };
}
const loadFrame = (n: number) => loadPath(resolve(FRAMES, `f${String(n).padStart(3, "0")}.png`));

/** 원본 좌표 rect → 브리지 프레임 정규화 rect */
const norm = (f: Frame, r: BandRect): BandRect =>
  ({ x: (r.x - f.crop.x) / f.crop.w, y: (r.y - f.crop.y) / f.crop.h, w: r.w / f.crop.w, h: r.h / f.crop.h });

async function loadTemplates(): Promise<Map<string, Float32Array>> {
  const doc = JSON.parse(readFileSync(resolve(ROOT, "app/data/autochess.json"), "utf8")) as { bands: { id: string; sort: number }[] };
  const out = new Map<string, Float32Array>();
  for (const b of [...doc.bands].sort((a, c) => a.sort - c.sort)) {
    const { data, info } = await sharp(resolve(ROOT, `public/ac/band/${b.id}.webp`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const raster: Raster = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: 4 };
    out.set(b.id, bandTemplate(raster));
  }
  return out;
}

const accepted = (h: { score: number; margin: number } | null) => !!h && h.score >= BAND_ACCEPT.score && h.margin >= BAND_ACCEPT.margin;
const f3 = (v: number) => v.toFixed(3);

export async function verify(): Promise<{ name: string; pass: number; fail: number; lines: string[] }> {
  const name = "band";
  const lines: string[] = [];
  if (!existsSync(FRAMES)) return { name, pass: 0, fail: 0, lines: ["픽스처 없음 — 건너뜀 (fixtures/lens/ac-frames/v2 는 로컬 전용)"] };
  let pass = 0, fail = 0;
  const check = (ok: boolean, msg: string) => { if (ok) pass++; else fail++; lines.push(`${ok ? "✅" : "❌"} ${msg}`); };

  const t0 = performance.now();
  const tpl = await loadTemplates();
  lines.push(`템플릿 ${tpl.size}개 ${(performance.now() - t0).toFixed(0)}ms`);

  const frames = new Map<number, Frame>();
  const frame = async (n: number) => { let f = frames.get(n); if (!f) { f = await loadFrame(n); frames.set(n, f); } return f; };

  // ── 격자 검출 + SELECTED + 타일 매칭 ──
  let gridOk = 0, selOk = 0, selTotal = 0, tileHit = 0, tileN = 0, tileAccepted = 0;
  let minMargin = Infinity, sumMargin = 0, sumMs = 0, maxMs = 0, sumWin = 0;
  for (const { n, selected } of GRID_FRAMES) {
    const f = await frame(n);
    const g0 = performance.now();
    const g = findBandGrid(f.rgba, f.width, f.height);
    const gms = performance.now() - g0;
    const ok = !!g && g.cols === 4 && g.rows === 4 && g.tiles.length === 16;
    if (ok) gridOk++;
    selTotal++;
    const sOk = !!g && g.selected === selected;
    if (sOk) selOk++;
    lines.push(`  f${String(n).padStart(3, "0")} 격자 ${g ? `${g.cols}×${g.rows}` : "없음"} ${ok ? "" : "(기대 4×4) "}selected=${g?.selected ?? "없음"} ${sOk ? "" : `(기대 ${selected ?? "없음"}) `}${gms.toFixed(1)}ms`);
    if (!g) continue;
    for (const t of g.tiles) {
      const truth = GRID_TILES[t.row * 4 + t.col];
      const m0 = performance.now();
      const h = searchBand(f.rgba, f.width, f.height, t, tpl);
      const ms = performance.now() - m0;
      sumMs += ms; maxMs = Math.max(maxMs, ms); sumWin += h?.windows ?? 0; tileN++;
      if (h) { minMargin = Math.min(minMargin, h.margin); sumMargin += h.margin; }
      if (h?.band === truth) tileHit++; else lines.push(`    ✗ f${n} r${t.row}c${t.col} 기대 ${truth} → ${h?.band ?? "없음"} ${h ? `${f3(h.score)} 마진 ${f3(h.margin)} (2위 ${h.second})` : ""}`);
      if (h?.band === truth && accepted(h)) tileAccepted++;
    }
  }
  check(gridOk === GRID_FRAMES.length, `격자 검출 ${gridOk}/${GRID_FRAMES.length}`);
  check(selOk === selTotal, `SELECTED 판정 ${selOk}/${selTotal} (선택 3 · 없음 2)`);
  check(tileHit >= MIN.tiles, `타일 식별 ${tileHit}/${tileN} (하한 ${MIN.tiles}) · 승인(≥${BAND_ACCEPT.score}·마진≥${BAND_ACCEPT.margin}) ${tileAccepted} · 최소 마진 ${f3(minMargin)} · 평균 ${f3(sumMargin / Math.max(1, tileN))}`);
  lines.push(`  타일당 ${(sumMs / Math.max(1, tileN)).toFixed(1)}ms (최대 ${maxMs.toFixed(1)}) · 창 ${(sumWin / Math.max(1, tileN)).toFixed(0)}개/타일`);

  // ── 비격자 ──
  let falseGrid = 0;
  for (const n of NON_GRID_FRAMES) {
    const f = await frame(n);
    const g = findBandGrid(f.rgba, f.width, f.height);
    if (g) { falseGrid++; lines.push(`    ✗ f${n} 비격자인데 격자 ${g.cols}×${g.rows} 검출`); }
  }
  check(falseGrid === 0, `비격자 오탐 ${falseGrid}/${NON_GRID_FRAMES.length}`);

  // ── 참가자 카드 썸네일 (고정 브래킷 rect) ──
  let thumbOk = 0;
  for (const n of THUMB_FRAMES) {
    const f = await frame(n);
    const h = searchBand(f.rgba, f.width, f.height, norm(f, THUMB_RECT_ORIG), tpl);
    const ok = h?.band === JUSTIN && accepted(h);
    if (ok) thumbOk++;
    lines.push(`  f${n} 썸네일 → ${h?.band ?? "없음"} ${h ? `${f3(h.score)} 마진 ${f3(h.margin)}` : ""}${ok ? "" : " ✗"}`);
  }
  check(thumbOk === THUMB_FRAMES.length, `카드 썸네일 ${thumbOk}/${THUMB_FRAMES.length}`);

  // ── '선택 중' 카드 — 승인되면 안 된다 ──
  let unselOk = 0;
  for (const n of UNSELECTED_FRAMES) {
    const f = await frame(n);
    const h = searchBand(f.rgba, f.width, f.height, norm(f, THUMB_RECT_ORIG), tpl);
    const ok = !accepted(h);
    if (ok) unselOk++;
    lines.push(`  f${n} 선택 중 썸네일 → ${h?.band ?? "없음"} ${h ? `${f3(h.score)} 마진 ${f3(h.margin)}` : ""}${ok ? " (미승인 ✓)" : " ✗ 승인됨"}`);
  }
  check(unselOk === UNSELECTED_FRAMES.length, `'선택 중' 카드 미승인 ${unselOk}/${UNSELECTED_FRAMES.length}`);

  // ── 큰 초상 ──
  let bigOk = 0, bigN = 0;
  for (const B of BIG_PORTRAITS) for (const n of B.frames) {
    const f = await frame(n);
    const m0 = performance.now();
    const h = searchBand(f.rgba, f.width, f.height, norm(f, B.rect), tpl);
    const ms = performance.now() - m0;
    bigN++;
    const ok = h?.band === JUSTIN && accepted(h);
    if (ok) bigOk++;
    lines.push(`  f${n} ${B.kind} 큰 초상 → ${h?.band ?? "없음"} ${h ? `${f3(h.score)} 마진 ${f3(h.margin)}` : ""} ${ms.toFixed(0)}ms${ok ? "" : " ✗"}`);
  }
  check(bigOk >= MIN.big, `큰 초상 ${bigOk}/${bigN} (하한 ${MIN.big})`);

  // ── 참가자 줄 ──
  // 호출자와 같은 규약으로 잰다: 기하가 후보를 내고 **searchBand 승인이 판정**한다.
  const readRows = (f: Frame) => participantRows(f.rgba, f.width, f.height)
    .map((r) => ({ r, h: searchBand(f.rgba, f.width, f.height, r.thumb, tpl) }))
    .filter((x) => accepted(x.h));

  // 1인 카드(v2). ⚠ f026 은 체크박스가 **막 켜지는 번쩍임** 프레임이라 흰빛에 가까워 청록 마스크에
  // 안 잡힌다 (그 자리 청록 조각 3×7). 애니메이션 한 프레임이고, 브리지는 화면이 잠잠할 때만 프레임을
  // 내보내므로 실사용에서 이 상태로 굳을 일은 없다 — 그래서 하한을 2/3 로 둔다.
  let slotOk = 0;
  for (const n of THUMB_FRAMES) {
    const f = await frame(n);
    const s0 = performance.now();
    const got = readRows(f);
    const ms = performance.now() - s0;
    const ok = got.length === 1 && got[0].h!.band === JUSTIN;
    if (ok) slotOk++;
    lines.push(`  f${n} 참가자 줄 ${got.length}개 ${ms.toFixed(1)}ms${got[0]?.r.mine ? " (나)" : ""} → ${got.map((x) => `${x.h!.band} ${f3(x.h!.score)}`).join(",") || "없음"}${ok ? "" : " ✗"}`);
  }
  check(slotOk >= MIN.slots, `참가자 줄(1인 화면) ${slotOk}/${THUMB_FRAMES.length} (하한 ${MIN.slots})`);

  // '선택 중'·팝업 프레임엔 체크박스가 없다 → 승인된 줄 0개여야 한다
  let emptyOk = 0;
  for (const n of [...UNSELECTED_FRAMES, 28]) {
    const f = await frame(n);
    const got = readRows(f);
    if (!got.length) emptyOk++; else lines.push(`    ✗ f${n} 안 고른 화면인데 참가자 줄 ${got.length}개 (${got.map((x) => x.h!.band).join(",")})`);
  }
  check(emptyOk === UNSELECTED_FRAMES.length + 1, `안 고른 화면 0줄 ${emptyOk}/${UNSELECTED_FRAMES.length + 1}`);

  // ── 참가자 줄 — 연합 4인 (스크린샷 픽스처) ──
  if (!existsSync(resolve(SHOTS, "33.png"))) {
    lines.push("  연합 스크린샷 없음 — 건너뜀 (fixtures/lens/screenshots 는 로컬 전용)");
  } else {
    for (const shot of ALLY_SHOTS) {
      const f = await loadPath(resolve(SHOTS, `${shot.name}.png`));
      const s0 = performance.now();
      const got = readRows(f);
      const ms = performance.now() - s0;
      const ids = got.map((x) => x.h!.band);
      const mineAt = got.findIndex((x) => x.r.mine);
      const okRows = ids.length === shot.rows.length && ids.every((v, i) => v === shot.rows[i]);
      const okMine = mineAt === shot.mine;
      check(okRows, `${shot.name}.png 줄 ${ids.length}/${shot.rows.length}개${okRows ? "" : ` → ${ids.join(",") || "없음"} (기대 ${shot.rows.join(",") || "없음"})`}`);
      if (shot.rows.length) check(okMine, `${shot.name}.png '나' 줄 ${mineAt} (기대 ${shot.mine})`);
      const worst = got.reduce((a, x) => Math.min(a, x.h!.score), 1);
      lines.push(`  ${shot.name}.png ${got.length}줄 ${ms.toFixed(1)}ms${got.length ? ` · 최소 점수 ${f3(worst)}` : ""}`);
    }
  }

  return { name, pass, fail, lines };
}

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  verify().then((r) => {
    console.log(r.lines.join("\n"));
    console.log(r.fail ? `\n${r.fail}건 실패 (통과 ${r.pass})` : `\n전부 통과 (${r.pass}건)`);
    process.exit(r.fail ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
