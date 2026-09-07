// 위수 협의 인식 회귀 — **텍스트 파서·맹약 링** (app/lens/acmatch.ts + ocr.ts 의 maxCrop/cropInverted/digits 경로).
//
//   npx tsx scripts/verify-ac/text.ts            ← 리포 루트에서. 전 프레임(117장) 97s 실측 (PSM11 중앙값 674ms/프레임, M-시리즈)
//   npx tsx scripts/verify-ac/text.ts --quick    ← 표본 1/3 (3의 배수 프레임만), 하한도 같은 비율로 줄인다
//   npx tsx scripts/verify-ac/text.ts --only=v2 --frames=68-72,76-81   ← 한 영상·특정 프레임만 (개발용)
//
// 픽스처(git 미추적, 로컬): fixtures/lens/ac-frames/v1/f001~f036.png (2fps · 1936×1098 · BlueStacks 창틀 · 극한 AC-3)
//                              fixtures/lens/ac-frames/v2/f001~f081.png (1fps · 1826×1030 · 초월 AC-4)
// 프레임은 **브리지(app/lens/bridge.ts)가 인식기에 넘기는 모양**으로 만든다 — 어두운 여백 크롭 → 가로 900 축소 →
// JPEG q0.9 → 다시 디코드. 이게 운영 조건이다. 브라우저와 다른 점은 리샘플러(canvas ↔ sharp lanczos3)뿐이고,
// 전처리 함수(grayNormalize·maxChannelNormalize·invertRgb·binarizeGlyph)와 파서는 app/lens 의 것을 그대로 쓴다.
//
// 정답 라벨은 아래 상수 — 사람이 프레임을 눈으로 확인해 적은 것 (2026-09-07, scratchpad 가 아니라 여기가 정본).
// 하한은 실측치(2026-09-07 900px 판)에서 잡았다 — 아래로 내려가면 회귀다:
//   (a) 배지 모드 51/51 → ≥48  (b) 로딩 모드 11/11 → ≥10  (c) 전략 확정 3/3 · 미리보기 허용 · 그 외 오탐 0
//   (d) 배치 인원 17/19 → ≥15   (e) 화면 분류 info 42/42 · select 8/8 · band 5/5 · confirm 4/4 · loading 11/11 ·
//       null 15/15 · rest 19/23(f050~053 다이얼로그/전환은 null) · battle 7/9(f073~074 전환은 null)
//   (f) 링 개수 3 — 11/11 → ≥10 · 링 이름 33/33 → ≥30 · 링 숫자 0 — **약함** 7/33 → ≥7 (실험실 로그와 링 단위로 동일;
//       과제가 바란 8/33 은 단일 링 프레임 f065·f067 의 0 두 개를 합친 10/35 에서 나온 수치라 이 33개엔 없다)  (g) 목표 HP 24/28 → ≥20
// ⚠ 픽스처가 없으면 조용히 건너뛴다 (pass 0 · fail 0).
// ⚠ 링 숫자 **1 이상 값은 미검증** (라운드 1 녹화만 있어 전부 0) — 다음 라운드 녹화가 들어오면 RING_TRUTH 에 숫자를 채울 것.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";
import { grayNormalize, upscaleFactor, binarizeGlyph, isolateGlyphs, maxChannelNormalize, invertRgb } from "../../app/lens/preprocess";
import { normText } from "../../app/lens/match";
import {
  classifyAcScreen, parseAcMode, badgeRectFromTitle, parseAcBand, parseDeployLeft, parseAcHud,
  findAcRings, ringNameRect, ringNumRect, parseRingStack, RING_DIGITS, buildAcIndex, bondOfLine, type AcScreen,
} from "../../app/lens/acmatch";
import type { OcrBox, OcrRect } from "../../app/lens/ocr";

const ROOT = resolve(import.meta.dirname ?? __dirname, "../..");
const FRAMES = resolve(ROOT, "fixtures/lens/ac-frames");
type Vid = "v1" | "v2";

// ── 정답 ────────────────────────────────────────────────────────────────────
/** 화면 종류 — 구간 [from, to] 의 기대값. null = 어느 화면도 아님(메인·협의 가동·검은·전환). */
const SCREEN_TRUTH: Record<Vid, [number, number, AcScreen | null][]> = {
  v1: [[1, 2, null], [3, 3, null], [4, 7, "select"], [8, 8, null], [9, 36, "info"]],
  v2: [[1, 2, null], [3, 6, "select"], [7, 20, "info"], [21, 25, "band"], [26, 29, "confirm"], [30, 38, null],
    [39, 49, "loading"], [50, 72, "rest"], [73, 81, "battle"]],
};
/** 좌상단 붉은 배지가 보이는 정보·전략 화면 — 모드 코드 */
const BADGE_TRUTH: { v: Vid; from: number; to: number; want: string }[] = [
  { v: "v1", from: 9, to: 36, want: "AC-3" }, { v: "v2", from: 7, to: 29, want: "AC-4" }];
const LOADING_TRUTH = { v: "v2" as Vid, from: 39, to: 49, want: "AC-4" };
/** 전략 화면 v2 f021~029: f026,027,029 확정('선택한 전략 저스틴') · f028 확정 팝업 · f021~025 탐색(f023~025 는 우측 패널에 저스틴) */
const BAND_SCREEN = { from: 21, to: 29 };
const BAND_FINAL = new Set([26, 27, 29]);
const BAND_WANT = "band_justin";
/** '배치 가능 인원:N' — 기물을 살수록 8→7→6 */
const DEPLOY_TRUTH: Record<number, number> = {};
for (let i = 54; i <= 64; i++) DEPLOY_TRUTH[i] = 8;
for (let i = 65; i <= 66; i++) DEPLOY_TRUTH[i] = 7;
for (let i = 67; i <= 72; i++) DEPLOY_TRUTH[i] = 6;
/** 맹약 링 3개(좌→우) 가 온전히 보이는 프레임 — 이름과 중첩 수(라운드 1 이라 전부 0) */
const RING_FRAMES = [68, 69, 70, 71, 72, 76, 77, 78, 79, 80, 81];
const RING_TRUTH: { name: string; stack: number }[] = [
  { name: "신속", stack: 0 }, { name: "불굴", stack: 0 }, { name: "라테라노", stack: 0 }];
const HP_TRUTH = { from: 54, to: 81, want: 23 };

/** 하한 (전 프레임 기준 절대값). --quick 에서는 표본 비율로 줄인다. */
const MIN = { badge: 48, loading: 10, deploy: 15, ringCount: 10, ringName: 30, ringZero: 7, hp: 20,
  screen: { info: 42, select: 8, band: 5, confirm: 4, loading: 11, null: 15, rest: 19, battle: 7 } as Record<string, number> };
const FULL_N = { badge: 51, loading: 11, deploy: 19, ringCount: 11, ringName: 33, ringZero: 33, hp: 28,
  screen: { info: 42, select: 8, band: 5, confirm: 4, loading: 11, null: 15, rest: 23, battle: 9 } as Record<string, number> };

// ── 브리지 시뮬레이션 (bridge.ts contentRect · OCR_MAX_W · JPEG q0.9 와 같은 로직) ───────
const OCR_MAX_W = 900;
const SMALL_W = 96, SMALL_H = 54;
type Frame = { rgba: Uint8ClampedArray; width: number; height: number; jpeg: Buffer };

function contentRect(g: Uint8Array, w: number, h: number) {
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
  return { x: Math.round(fx * w), y: Math.round(fy * h), w: Math.max(4, Math.round(fw * w)), h: Math.max(4, Math.round(fh * h)) };
}

async function loadBridgeFrame(path: string): Promise<Frame> {
  const meta = await sharp(path).metadata();
  const w = meta.width!, h = meta.height!;
  const small = await sharp(path).resize(SMALL_W, SMALL_H, { fit: "fill" }).greyscale().raw().toBuffer();
  const crop = contentRect(new Uint8Array(small), w, h);
  const outW = Math.min(crop.w, OCR_MAX_W);
  const outH = Math.round((crop.h / crop.w) * outW);
  let pipe = sharp(path).extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h });
  if (outW !== crop.w) pipe = pipe.resize(outW, outH, { kernel: "lanczos3" });
  const jpeg = await pipe.jpeg({ quality: 90 }).toBuffer();
  // 픽셀은 **JPEG 를 다시 디코드**해서 낸다 — 브라우저도 File(JPEG) 을 디코드해 쓴다
  const { data, info } = await sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, jpeg };
}

// ── OCR 세션 복제 (ocr.ts createOcrSession 의 전처리를 sharp 로) ──────────────────────
const WORKER_OPTS = { langPath: resolve(ROOT, "public/lens"), cachePath: resolve(ROOT, "public/lens"), gzip: false };
const TEXT_OUT = { blocks: false, text: true, hocr: false, tsv: false } as const;
const linesOf = (t: string) => t.split("\n").map((s) => s.trim()).filter(Boolean);

async function makeSession(f: Frame, kor: Worker, eng: Worker) {
  const sc = upscaleFactor(f.width);
  const W = Math.round(f.width * sc), H = Math.round(f.height * sc);
  const up = new Uint8ClampedArray(await sharp(f.jpeg).resize(W, H, { kernel: "lanczos3" }).ensureAlpha().raw().toBuffer());
  grayNormalize(up);
  const gray = () => sharp(Buffer.from(up), { raw: { width: W, height: H, channels: 4 } });
  const grayPng = await gray().png().toBuffer();
  const px = (rect: OcrRect) => {
    const x = Math.max(0, Math.round(rect.x * W)), y = Math.max(0, Math.round(rect.y * H));
    return { x, y, w: Math.min(Math.round(rect.w * W), W - x), h: Math.min(Math.round(rect.h * H), H - y) };
  };
  // PNG 에 density 메타를 얹지 않는다 — 실측(2026-09-07) 파이프라인과 같게. tesseract 의 'Invalid resolution' 경고는 무해.
  const png = (raw: Uint8ClampedArray, w: number, h: number) =>
    sharp(Buffer.from(raw), { raw: { width: w, height: h, channels: 4 } });
  return {
    W, H,
    async sparse(): Promise<OcrBox[]> {
      await kor.setParameters({ tessedit_pageseg_mode: "11" as never });
      const r = await kor.recognize(grayPng, {}, { blocks: true, text: false, hocr: false, tsv: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((r.data.lines ?? []) as any[]).map((l) => ({
        text: String(l.text ?? "").trim(),
        x0: (l.bbox?.x0 ?? 0) / W, y0: (l.bbox?.y0 ?? 0) / H, x1: (l.bbox?.x1 ?? 0) / W, y1: (l.bbox?.y1 ?? 0) / H,
      })).filter((l: OcrBox) => l.text);
    },
    /** ocr.ts maxCrop — 원색 JPEG 크롭 → 4배 → 채널최댓값 → kor PSM7 */
    async maxCrop(rect: OcrRect): Promise<string[]> {
      const sx = Math.max(0, Math.round(rect.x * f.width)), sy = Math.max(0, Math.round(rect.y * f.height));
      const sw = Math.min(Math.round(rect.w * f.width), f.width - sx), sh = Math.min(Math.round(rect.h * f.height), f.height - sy);
      if (sw < 8 || sh < 6) return [];
      const raw = new Uint8ClampedArray(await sharp(f.jpeg).extract({ left: sx, top: sy, width: sw, height: sh })
        .resize(sw * 4, sh * 4, { kernel: "lanczos3" }).ensureAlpha().raw().toBuffer());
      maxChannelNormalize(raw);
      await kor.setParameters({ tessedit_pageseg_mode: "7" as never });
      const r = await kor.recognize(await png(raw, sw * 4, sh * 4).png().toBuffer(), {}, TEXT_OUT);
      return linesOf(r.data.text ?? "");
    },
    /** ocr.ts cropInverted — 그레이 크롭 → 반전 → 4배 → **검은** 12px 패딩 → kor PSM7.
     *  ⚠ 패딩은 검정 (흰 패딩이면 19/33 로 떨어진다 — 2026-09-07 A/B. 실측 34/35 를 낸 sharp 파이프라인은
     *  negate 가 extend 뒤에 적용돼 패딩이 검게 반전돼 있었다.) */
    async cropInverted(rect: OcrRect): Promise<string[]> {
      const { x, y, w, h } = px(rect);
      if (w < 4 || h < 4) return [];
      const raw = new Uint8ClampedArray(await gray().extract({ left: x, top: y, width: w, height: h }).raw().toBuffer());
      invertRgb(raw);
      const buf = await png(raw, w, h).resize(w * 4, h * 4, { kernel: "lanczos3" })
        .extend({ top: 12, bottom: 12, left: 12, right: 12, background: "#000" }).png().toBuffer();
      await kor.setParameters({ tessedit_pageseg_mode: "7" as never });
      const r = await kor.recognize(buf, {}, TEXT_OUT);
      return linesOf(r.data.text ?? "");
    },
    /** ocr.ts digits — 1:1 이진화 → (격리) → nearest 4배 → eng PSM7 */
    async digits(rect: OcrRect, opts?: { cut?: number; isolate?: boolean }): Promise<{ text: string; conf: number }> {
      const { x, y, w, h } = px(rect);
      if (w < 4 || h < 4) return { text: "", conf: 0 };
      const raw = new Uint8ClampedArray(await gray().extract({ left: x, top: y, width: w, height: h }).raw().toBuffer());
      binarizeGlyph(raw, opts?.cut);
      if (opts?.isolate !== false && isolateGlyphs(raw, w, h) === 0) return { text: "", conf: 0 };
      const r = await eng.recognize(await png(raw, w, h).resize(w * 4, h * 4, { kernel: "nearest" }).png().toBuffer(), {}, TEXT_OUT);
      return { text: (r.data.text ?? "").trim(), conf: r.data.confidence ?? 0 };
    },
  };
}

// ── 채점 ────────────────────────────────────────────────────────────────────
type Check = { name: string; ok: number; n: number; need: number; miss: string[] };
const truthOf = (v: Vid, n: number): AcScreen | null | undefined => {
  for (const [a, b, s] of SCREEN_TRUTH[v]) if (n >= a && n <= b) return s;
  return undefined;
};
const pad3 = (n: number) => `f${String(n).padStart(3, "0")}`;

export async function verify(): Promise<{ name: string; pass: number; fail: number; lines: string[] }> {
  const quick = process.argv.includes("--quick");
  const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7) as Vid | "";
  const framesArg = (process.argv.find((a) => a.startsWith("--frames=")) ?? "").slice(9);
  const frameSet = framesArg ? new Set(framesArg.split(",").flatMap((r) => {
    const [a, b] = r.split("-").map(Number); const out: number[] = [];
    for (let i = a; i <= (b ?? a); i++) out.push(i); return out;
  })) : null;
  const vids = (["v1", "v2"] as Vid[]).filter((v) => !only || v === only);
  const lines: string[] = [];
  if (!vids.some((v) => existsSync(resolve(FRAMES, v, "f001.png")))) {
    return { name: "text", pass: 0, fail: 0, lines: ["픽스처 없음 — 건너뜀 (fixtures/lens/ac-frames/ 는 로컬 전용)"] };
  }
  const doc = JSON.parse(readFileSync(resolve(ROOT, "app/data/autochess.json"), "utf8")) as {
    bonds: { id: string; n: string }[]; bands: { id: string; n: string; by: string }[] };
  const acIdx = buildAcIndex(doc.bonds, normText);
  const ringIds = RING_TRUTH.map((t) => doc.bonds.find((b) => b.n === t.name)?.id ?? t.name);
  const bondName = Object.fromEntries(doc.bonds.map((b) => [b.id, b.n]));

  const checks = new Map<string, Check>();
  const sampled = quick || !!frameSet || !!only;      // 표본만 돌릴 때는 하한도 같은 비율로
  const scale = (full: number, min: number, n: number) => (sampled ? Math.floor((min * n) / full) : min);
  const bump = (name: string, ok: boolean, note: string, need: (n: number) => number) => {
    let c = checks.get(name);
    if (!c) { c = { name, ok: 0, n: 0, need: 0, miss: [] }; checks.set(name, c); }
    c.n++; if (ok) c.ok++; else c.miss.push(note);
    c.need = need(c.n);
  };
  const kor = await createWorker("kor", 1, WORKER_OPTS as never);
  const eng = await createWorker("eng", 1, WORKER_OPTS as never);
  await eng.setParameters({ tessedit_pageseg_mode: "7" as never });
  const ms: number[] = [];
  const t0 = Date.now();
  try {
    for (const v of vids) {
      const total = v === "v1" ? 36 : 81;
      for (let n = 1; n <= total; n++) {
        if (quick && n % 3 !== 0) continue;
        if (frameSet && !frameSet.has(n)) continue;
        const path = resolve(FRAMES, v, `${pad3(n)}.png`);
        if (!existsSync(path)) continue;
        const key = `${v} ${pad3(n)}`;
        const f = await loadBridgeFrame(path);
        const s = await makeSession(f, kor, eng);
        const t1 = Date.now();
        const boxes = await s.sparse();
        ms.push(Date.now() - t1);
        const raw = boxes.map((b) => b.text), linesN = raw.map(normText);

        // (e) 화면 종류
        const want = truthOf(v, n);
        if (want !== undefined) {
          const got = classifyAcScreen(linesN, raw, boxes);
          const k = String(want);
          bump(`(e) 화면 ${k}`, got === want, `${key}→${got}`, (cnt) => scale(FULL_N.screen[k], MIN.screen[k], cnt));
        }
        // (a) 배지 모드 — 제목 줄 앵커 → maxCrop
        const badge = BADGE_TRUTH.find((b) => b.v === v && n >= b.from && n <= b.to);
        if (badge) {
          const rect = badgeRectFromTitle(boxes);
          const ls = rect ? await s.maxCrop(rect) : [];
          const mode = parseAcMode(ls.map(normText));
          bump("(a) 배지 모드(maxCrop)", mode === badge.want, `${key}→${mode ?? "-"} ${rect ? JSON.stringify(ls) : "(제목 줄 없음)"}`,
            (cnt) => scale(FULL_N.badge, MIN.badge, cnt));
        }
        // (b) 로딩 모드 — PSM11 줄
        if (v === LOADING_TRUTH.v && n >= LOADING_TRUTH.from && n <= LOADING_TRUTH.to) {
          const mode = parseAcMode(linesN);
          bump("(b) 로딩 모드(PSM11)", mode === LOADING_TRUTH.want, `${key}→${mode ?? "-"}`, (cnt) => scale(FULL_N.loading, MIN.loading, cnt));
        }
        // (c) 전략
        const band = parseAcBand(raw, doc.bands, normText);
        const bandStr = band ? `${band.band}/${band.final ? "final" : "preview"}` : "null";
        if (v === "v2" && BAND_FINAL.has(n)) {
          bump("(c) 전략 확정", !!band && band.band === BAND_WANT && band.final, `${key}→${bandStr}`, (cnt) => cnt);
        } else if (v === "v2" && n >= BAND_SCREEN.from && n <= BAND_SCREEN.to) {
          // 탐색(f021~025) 은 null 또는 저스틴 미리보기, 팝업(f028) 은 null 또는 저스틴 확정 — 다른 전략이면 실패
          const ok = band === null || (band.band === BAND_WANT && (n === 28 || !band.final));
          bump("(c) 전략 탐색/팝업(허용)", ok, `${key}→${bandStr}`, (cnt) => cnt);
        } else {
          bump("(c) 전략 오탐 0(전략 화면 밖)", band === null, `${key}→${bandStr}`, (cnt) => cnt);
        }
        // (d) 배치 가능 인원
        if (v === "v2" && n in DEPLOY_TRUTH) {
          const got = parseDeployLeft(raw);
          bump("(d) 배치 인원", got === DEPLOY_TRUTH[n], `${key}→${got ?? "-"} (정답 ${DEPLOY_TRUTH[n]})`, (cnt) => scale(FULL_N.deploy, MIN.deploy, cnt));
        }
        // (g) 목표 HP
        if (v === "v2" && n >= HP_TRUTH.from && n <= HP_TRUTH.to) {
          const hud = parseAcHud(boxes);
          bump("(g) 목표 HP", hud.hp === HP_TRUTH.want, `${key}→${hud.hp ?? "-"}`, (cnt) => scale(FULL_N.hp, MIN.hp, cnt));
        }
        // (f) 맹약 링 — 원색 픽셀에서 링 → 이름(cropInverted) · 숫자(digits, 격리 끔)
        if (v === "v2" && RING_FRAMES.includes(n)) {
          const rings = findAcRings(f.rgba, f.width, f.height);
          bump("(f) 링 개수 3", rings.length === RING_TRUTH.length,
            `${key}→${rings.length} ${rings.map((r) => `(${(r.cx * f.width).toFixed(0)},${(r.cy * f.height).toFixed(0)} s${r.score.toFixed(0)})`).join(" ")}`,
            (cnt) => scale(FULL_N.ringCount, MIN.ringCount, cnt));
          for (let i = 0; i < RING_TRUTH.length; i++) {
            const R = rings[i];
            if (!R) {
              bump("(f) 링 이름", false, `${key} #${i} (링 미검출)`, (cnt) => scale(FULL_N.ringName, MIN.ringName, cnt));
              bump("(f) 링 숫자 0(약함)", false, `${key} #${i} (링 미검출)`, (cnt) => scale(FULL_N.ringZero, MIN.ringZero, cnt));
              continue;
            }
            const nameLines = await s.cropInverted(ringNameRect(R));
            const id = nameLines.map((l) => bondOfLine(normText(l), acIdx)).find((x) => x) ?? null;
            bump("(f) 링 이름", id === ringIds[i], `${key} #${i}→${id ? bondName[id] : "-"} ${JSON.stringify(nameLines)} (정답 ${RING_TRUTH[i].name})`,
              (cnt) => scale(FULL_N.ringName, MIN.ringName, cnt));
            const d = await s.digits(ringNumRect(R), RING_DIGITS);
            const stack = parseRingStack(d.text);
            bump("(f) 링 숫자 0(약함)", stack === RING_TRUTH[i].stack, `${key} #${i}→${stack ?? "null"} "${d.text}" ${Math.round(d.conf)}%`,
              (cnt) => scale(FULL_N.ringZero, MIN.ringZero, cnt));
          }
        }
      }
    }
  } finally {
    await kor.terminate();
    await eng.terminate();
  }

  let pass = 0, fail = 0;
  const order = ["(a)", "(b)", "(c)", "(d)", "(e)", "(f)", "(g)"];
  const sorted = [...checks.values()].sort((a, b) => order.findIndex((o) => a.name.startsWith(o)) - order.findIndex((o) => b.name.startsWith(o)) || a.name.localeCompare(b.name));
  for (const c of sorted) {
    const ok = c.ok >= c.need;
    if (ok) pass++; else fail++;
    lines.push(`${ok ? "✅" : "❌"} ${c.name}: ${c.ok}/${c.n} (하한 ${c.need})`);
    for (const m of c.miss.slice(0, 12)) lines.push(`      ✗ ${m}`);
    if (c.miss.length > 12) lines.push(`      … 외 ${c.miss.length - 12}건`);
  }
  ms.sort((a, b) => a - b);
  lines.push(`PSM11 ${ms.length}프레임: 중앙값 ${ms[ms.length >> 1] ?? 0}ms · 최대 ${ms[ms.length - 1] ?? 0}ms · 전체 ${((Date.now() - t0) / 1000).toFixed(0)}s${sampled ? " (표본 — 하한을 비율로 줄임)" : ""}`);
  return { name: "text", pass, fail, lines };
}

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  verify().then((r) => {
    console.log(r.lines.join("\n"));
    console.log(r.fail ? `\n${r.fail}개 항목 실패` : "\n전부 통과");
    process.exit(r.fail ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
