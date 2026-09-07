// 밴 카드 격자·티어(app/lens/acvision.ts findAcRows) 회귀 하네스 (2026-09-07).
//   npx tsx scripts/verify-ac/grid.ts          — 결과 출력, 기대 하한에 못 미치면 exit 1
//   import { verify } from "./grid"            — 묶음 실행용 { name, pass, fail, lines }
//
// 무엇을 재나: 녹화 프레임(v1 f016~036 · v2 f010~020)을 **브리지가 인식기에 넘기는 모양**(어두운 여백 크롭
// → 가로 900 축소 → JPEG q0.9 → 디코드)으로 만들어 findAcRows 에 넣고, 사람이 확정한 행별 티어 목록과
// 대조한다. 행에 이름을 붙일 수 없으니(이름 OCR·아이콘 매칭은 다른 모듈) **티어 목록의 다중집합**으로
// 어느 정답 행인지 정한다 — 한 녹화 안에서 행별 티어 목록은 서로 다르다.
//   · 온전한 행 검출+티어 정답: cut 아닌 행의 티어 목록이 그 프레임에서 온전히 보이는 정답 행과 일치
//   · 잘린 행 누출: cut 아닌 행이 일부만 보이는 정답 행과 일치하거나 어느 정답 행의 진부분집합 (소비자가 완전한
//     관측으로 오해한다 — 버튼에 가린 카드·화면 밖 줄바꿈 카드가 이 경로다)
//   · 오탐 행: 어느 정답 행과도 안 맞는 cut 아닌 행 (허깃 행 또는 티어 오독) · 같은 정답 행이 둘 잡힌 것도 포함
//   · 카드 티어 정확도: cut 아닌 행마다 길이가 같은 정답 행 중 자리별로 가장 많이 맞는 것과 비교
// 900px 판이 운영 조건이라 그 결과로 pass/fail 을 정하고, 원본 해상도 판·전체화면 스샷(ban1: 카드 없는 화면
// → 0행, ban2: 5행 + 잘린 6번째 행)도 함께 재서 같은 기준을 건다.
//
// ⚠ 픽스처(fixtures/lens/…)는 git 미추적 로컬 전용 — 없으면 조용히 건너뛴다 (pass 0 fail 0).
// ⚠ 정답 라벨은 이 파일 안의 상수다 (scripts/ac-lab/ban-truth.ts 에서 옮겨 옴 — ac-lab 은 지워진다).

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { findAcRows, type AcGrid } from "../../app/lens/acvision";

const ROOT = resolve(import.meta.dirname ?? __dirname, "../..");
const FRAMES_DIR = resolve(ROOT, "fixtures/lens/ac-frames");
const SHOTS_DIR = resolve(ROOT, "fixtures/lens/screenshots");

// ── 정답 라벨 (사람이 프레임을 눈으로 보고 확정, 2026-09-07) ─────────────────────────────
// 티어 배지: VI 주황 · V 노랑 · IV 청록 · III 초록 · II/I 회색(획 수).
const TRUTH: Record<"v1" | "v2", Record<string, number[]>> = {
  v1: {
    "쉐라그": [4, 3],
    "라테라노": [6, 6, 5],
    // ⚠ 7장 — 6장까지 한 줄, 7번째(T1)는 아이콘·이름 없이 둘째 줄로 줄바꿈된다
    "에기르": [6, 5, 5, 4, 4, 2, 1],
    "예견": [5, 5, 4, 3, 2],
    "기습": [4, 2, 1],
    "불굴": [5, 1],
    "독행": [4, 4],
  },
  v2: {
    "사르곤": [4, 3, 3, 2, 2, 1],
    "시라쿠사": [6, 5, 3, 2, 1],
    "카시미어": [5, 4, 2],
    "기민": [3, 3, 1],
    "고수": [2, 2, 1],
    "예견": [5, 2],
    "기적": [5, 4, 3, 2],
  },
};
/** 프레임마다 온전히 보이는 행(full)과 일부만 보이는 행(partial).
 *  full = 그 맹약의 **모든** 카드가 배지까지 잘리지 않고, '준비 완료' 버튼에 가리지도 않음. */
type FrameTruth = { fullRows: string[]; partialRows: string[] };
const FRAMES: Record<string, FrameTruth> = {};
const set = (v: string, from: number, to: number, full: string[], partial: string[]) => {
  for (let n = from; n <= to; n++) FRAMES[`${v}/f${String(n).padStart(3, "0")}`] = { fullRows: full, partialRows: partial };
};
// v1 (2fps · 1936×1098 · BlueStacks 창틀 — 게임 화면 아래에 창 밖 띠가 붙어 있다)
set("v1", 16, 16, ["쉐라그"], ["라테라노"]);
set("v1", 17, 17, ["쉐라그", "라테라노"], ["에기르"]);            // 에기르 6번째 카드가 버튼에 가림
set("v1", 18, 18, ["쉐라그", "라테라노"], ["에기르"]);            // 에기르 줄바꿈 7번째 카드 배지가 뷰포트 아래
set("v1", 19, 19, ["쉐라그", "라테라노", "에기르"], []);          // 줄바꿈 카드 배지까지 보임 (경계)
set("v1", 20, 20, ["라테라노", "에기르", "예견"], ["쉐라그"]);
set("v1", 21, 21, ["에기르", "예견", "기습"], ["라테라노"]);
set("v1", 22, 23, ["에기르", "예견", "기습"], ["불굴"]);
set("v1", 24, 36, ["기습", "불굴", "독행"], ["예견"]);
// v2 (1fps · 1826×1030 · 창틀 거의 없음)
set("v2", 10, 11, [], ["사르곤"]);                                // 6번째 카드가 '준비 완료' 버튼 뒤
set("v2", 12, 12, ["사르곤", "시라쿠사", "카시미어"], []);
set("v2", 13, 13, ["사르곤", "시라쿠사", "카시미어"], ["기민"]);
set("v2", 14, 15, ["시라쿠사", "카시미어", "기민", "고수"], ["사르곤"]);
set("v2", 16, 16, ["기민", "고수", "예견", "기적"], ["카시미어"]);
// ⚠ 라벨 교정 (2026-09-07): 원 라벨은 f017 고수를 partial 로 적었다 — 행의 위 0.2c 가 반투명 제목 바 아래에
//   있어서다. 그러나 세 카드의 배지·표식이 모두 온전하고(표식 r 평균 159~174 vs 전체 중앙값 152 — 어두워지지도
//   않았다) 숨을 수 있는 카드도 없어, "모든 카드가 배지까지 잘리지 않음" 기준으로는 온전한 행이다.
//   이 하네스는 티어 관측의 완전성을 재므로 full 로 둔다 (얼굴 매칭 쪽은 위 0.2c 가 살짝 어둡다는 점만 유의).
set("v2", 17, 17, ["고수", "예견", "기적"], []);
set("v2", 18, 20, ["고수", "예견", "기적"], ["기민"]);
const BAN_FRAMES: Record<"v1" | "v2", [number, number]> = { v1: [16, 36], v2: [10, 20] };

/** 전체화면 스샷 — 행별 티어 (verify-autochess.ts EXPECT 와 같은 값; 이름은 못 붙이니 목록 집합으로 대조) */
const SHOTS: Record<string, { rows: number[][]; cutRows: number }> = {
  // 맹약 정보 상단 화면 — 밴 카드가 하나도 없다 (오탐 검사)
  "ban1.jpg": { rows: [], cutRows: 0 },
  // 염국 · 쉐라그 · 시라쿠사 · 정밀 · 아케인 + 아래에 잘린 6번째 행
  "ban2.jpg": { rows: [[5, 5, 4, 1], [6, 4, 3], [6, 5, 4, 3, 2, 1], [4, 3, 1, 1], [6, 5, 4, 1]], cutRows: 1 },
};

// 기대 하한 (900px 운영 조건 · 원본 해상도 모두) — 온전한 행 총 89 (v1 59 + v2 30)
const MIN_FULL_FOUND = 85;

// ── 브리지 시뮬레이션 (app/lens/bridge.ts 와 같은 모양: 어두운 여백 크롭 → 가로 900 → JPEG q0.9) ──
// 브라우저와 다른 점은 리샘플러(canvas drawImage ↔ sharp lanczos3)뿐. 측정 단계(ac-lab/bridge-sim.ts)와 동일.
const OCR_MAX_W = 900, SMALL_W = 96, SMALL_H = 54;
function contentRect(g: Uint8Array, w: number, h: number) {
  const DARK = 40;
  const rowLit = (y: number) => { for (let x = 0; x < SMALL_W; x++) if (g[y * SMALL_W + x] > DARK) return true; return false; };
  const colLit = (x: number) => { for (let y = 0; y < SMALL_H; y++) if (g[y * SMALL_W + x] > DARK) return true; return false; };
  let top = 0, bottom = SMALL_H - 1, left = 0, right = SMALL_W - 1;
  while (top < bottom && !rowLit(top)) top++;
  while (bottom > top && !rowLit(bottom)) bottom--;
  while (left < right && !colLit(left)) left++;
  while (right > left && !colLit(right)) right--;
  const fw = (right + 1 - left) / SMALL_W, fh = (bottom + 1 - top) / SMALL_H;
  if (fw * fh < 0.4) return { x: 0, y: 0, w, h };
  return { x: Math.round((left / SMALL_W) * w), y: Math.round((top / SMALL_H) * h), w: Math.max(4, Math.round(fw * w)), h: Math.max(4, Math.round(fh * h)) };
}
type Frame = { px: Uint8ClampedArray; W: number; H: number };
async function loadBridgeFrame(path: string, maxW: number): Promise<Frame> {
  const meta = await sharp(path).metadata();
  const w = meta.width!, h = meta.height!;
  const small = await sharp(path).resize(SMALL_W, SMALL_H, { fit: "fill" }).greyscale().raw().toBuffer();
  const crop = contentRect(new Uint8Array(small), w, h);
  const outW = Math.min(crop.w, maxW), outH = Math.round((crop.h / crop.w) * outW);
  let pipe = sharp(path).extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h });
  if (outW !== crop.w) pipe = pipe.resize(outW, outH, { kernel: "lanczos3" });
  const jpeg = await pipe.jpeg({ quality: 90 }).toBuffer();
  const { data, info } = await sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), W: info.width, H: info.height };
}
async function loadRaw(path: string): Promise<Frame> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), W: info.width, H: info.height };
}

// ── 대조 ───────────────────────────────────────────────────────────────────────
const R: Record<number, string> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI" };
const rom = (ts: (number | null)[]) => ts.map((t) => (t === null ? "·" : R[t])).join(" ");
const sameSet = (a: number[], b: number[]) => { const x = a.slice().sort(), y = b.slice().sort(); return x.length === y.length && x.every((v, i) => v === y[i]); };
const strictSubset = (a: number[], b: number[]) => {
  if (a.length >= b.length) return false;
  const m = new Map<number, number>();
  for (const t of b) m.set(t, (m.get(t) ?? 0) + 1);
  for (const t of a) { const n = m.get(t) ?? 0; if (!n) return false; m.set(t, n - 1); }
  return true;
};
type Stat = { frames: number; fullRows: number; fullFound: number; leaked: number; wrong: number; cutRows: number; cards: number; cardsOk: number; ms: number; msList: number[]; failFrames: string[] };
const newStat = (): Stat => ({ frames: 0, fullRows: 0, fullFound: 0, leaked: 0, wrong: 0, cutRows: 0, cards: 0, cardsOk: 0, ms: 0, msList: [], failFrames: [] });
const median = (a: number[]) => (a.length ? a.slice().sort((p, q) => p - q)[a.length >> 1] : 0);

function gradeFrame(g: AcGrid, T: Record<string, number[]>, FT: FrameTruth, st: Stat, key: string): string {
  const notes: string[] = [];
  const found = new Set<string>();
  let bad = false;
  for (const r of g.rows) {
    if (r.cut) { st.cutRows++; notes.push(`(잘림 ${r.cards.length}장)`); continue; }
    const tiers = r.cards.map((k) => k.tier).filter((t): t is number => t !== null);
    const hit = Object.entries(T).find(([, tt]) => sameSet(tiers, tt))?.[0];
    const sub = !hit ? Object.entries(T).find(([, tt]) => strictSubset(tiers, tt))?.[0] : undefined;
    // 카드 단위 — 길이가 같은 정답 행 중 자리별로 가장 많이 맞는 것
    const bestPos = Object.values(T).filter((tt) => tt.length === tiers.length)
      .map((tt) => tt.filter((x, i) => x === tiers[i]).length).sort((p, q) => q - p)[0];
    if (bestPos !== undefined) { st.cards += tiers.length; st.cardsOk += bestPos; }
    if (hit && FT.fullRows.includes(hit) && !found.has(hit)) { found.add(hit); notes.push(`✓${hit}[${rom(tiers)}]`); continue; }
    if (hit && FT.partialRows.includes(hit)) { st.leaked++; bad = true; notes.push(`누출 ${hit}[${rom(tiers)}]`); continue; }
    if (sub) { st.leaked++; bad = true; notes.push(`누출(부분집합 ${sub})[${rom(tiers)}]`); continue; }
    st.wrong++; bad = true; notes.push(`✗${hit ? `중복 ${hit}` : "?"}[${rom(tiers)}]`);
  }
  st.frames++; st.fullRows += FT.fullRows.length; st.fullFound += found.size;
  const missed = FT.fullRows.filter((r) => !found.has(r));
  if (missed.length || bad) st.failFrames.push(key);
  return `${notes.join(" · ") || "(행 없음)"}${missed.length ? `  놓침: ${missed.join(",")}` : ""}`;
}

export async function verify(): Promise<{ name: string; pass: number; fail: number; lines: string[] }> {
  const name = "grid";
  const lines: string[] = [];
  let pass = 0, fail = 0;
  const haveFrames = (["v1", "v2"] as const).every((v) => existsSync(`${FRAMES_DIR}/${v}/f${String(BAN_FRAMES[v][0]).padStart(3, "0")}.png`));
  const shots = Object.keys(SHOTS).filter((f) => existsSync(resolve(SHOTS_DIR, f)));
  if (!haveFrames && !shots.length) { lines.push("픽스처 없음 — 건너뜀 (fixtures/lens/ 는 로컬 전용)"); return { name, pass, fail, lines }; }

  if (haveFrames) {
    for (const variant of ["900", "orig"] as const) {
      const st = newStat();
      const per: Record<string, Stat> = { v1: newStat(), v2: newStat() };
      let warmed = false;
      for (const v of ["v1", "v2"] as const) {
        const [a, b] = BAN_FRAMES[v];
        for (let n = a; n <= b; n++) {
          const key = `${v}/f${String(n).padStart(3, "0")}`;
          const f = await loadBridgeFrame(`${FRAMES_DIR}/${v}/f${String(n).padStart(3, "0")}.png`, variant === "900" ? OCR_MAX_W : Infinity);
          if (!warmed) { findAcRows(f.px, f.W, f.H); warmed = true; }   // JIT 워밍업 — 첫 호출은 3~4배 느리다
          const t0 = performance.now();
          const g = findAcRows(f.px, f.W, f.H);
          const ms = performance.now() - t0;
          const line = gradeFrame(g, TRUTH[v], FRAMES[key], st, key);
          gradeFrame(g, TRUTH[v], FRAMES[key], per[v], key);
          st.ms += ms; per[v].ms += ms; st.msList.push(ms); per[v].msList.push(ms);
          lines.push(`  ${variant.padEnd(4)} ${key} ${f.W}x${f.H} ${line}  [${g.note[0]}] ${ms.toFixed(1)}ms`);
        }
      }
      const pct = (x: number, y: number) => `${x}/${y} (${y ? (100 * x / y).toFixed(0) : 0}%)`;
      const summary = (k: string, s: Stat) => `[${variant} ${k}] 프레임 ${s.frames} · 온전한 행 검출+티어 정답 ${pct(s.fullFound, s.fullRows)} · 잘린 행 누출 ${s.leaked} · 오탐 ${s.wrong} · 잘림 처리 ${s.cutRows}행 · 카드 티어 ${pct(s.cardsOk, s.cards)} · 평균 ${(s.ms / s.frames).toFixed(1)}ms (중앙값 ${median(s.msList).toFixed(1)}ms)`;
      lines.push(summary("전체", st), summary("v1", per.v1), summary("v2", per.v2));
      if (st.failFrames.length) lines.push(`  실패 프레임: ${st.failFrames.join(", ")}`);
      const ok = st.fullFound >= MIN_FULL_FOUND && st.leaked === 0 && st.wrong === 0;
      if (ok) pass++; else { fail++; lines.push(`  ❌ ${variant}: 기대 하한(온전한 행 ≥ ${MIN_FULL_FOUND}/${st.fullRows} · 누출 0 · 오탐 0) 미달`); }
    }
  } else lines.push("녹화 프레임 없음 — 건너뜀 (fixtures/lens/ac-frames/)");

  for (const file of shots) {
    const want = SHOTS[file];
    const f = await loadRaw(resolve(SHOTS_DIR, file));
    const t0 = performance.now();
    const g = findAcRows(f.px, f.W, f.H);
    const ms = performance.now() - t0;
    const full = g.rows.filter((r) => !r.cut).map((r) => r.cards.map((k) => k.tier as number));
    const cut = g.rows.filter((r) => r.cut).length;
    const remain = want.rows.map((r) => r.slice());
    let wrong = 0;
    for (const tiers of full) {
      const i = remain.findIndex((tt) => sameSet(tt, tiers));
      if (i >= 0) remain.splice(i, 1); else wrong++;
    }
    const ok = !remain.length && !wrong && cut === want.cutRows;
    if (ok) pass++; else fail++;
    lines.push(`${ok ? "✅" : "❌"} ${file} ${f.W}x${f.H} 행 ${full.length}(+잘림 ${cut}) c=${g.cardPx.toFixed(1)} (${(g.cardPx / f.W).toFixed(4)}W) ${ms.toFixed(0)}ms`
      + `: ${full.map((t) => `[${rom(t)}]`).join(" ")}${remain.length ? `  놓침 ${remain.map((t) => `[${rom(t)}]`).join(" ")}` : ""}${wrong ? `  오탐 ${wrong}` : ""}${cut !== want.cutRows ? `  잘림 행 ${cut} (기대 ${want.cutRows})` : ""}`);
  }
  return { name, pass, fail, lines };
}

// 직접 실행
const isMain = typeof process !== "undefined" && process.argv[1] && /verify-ac[\\/]grid\.ts$/.test(process.argv[1]);
if (isMain) {
  verify().then((r) => {
    const verbose = process.argv.includes("-v") || process.env.VERBOSE;
    for (const l of r.lines) if (verbose || !l.startsWith("  900 ") && !l.startsWith("  orig")) console.log(l);
    console.log(`\n${r.name}: pass ${r.pass} · fail ${r.fail}`);
    process.exit(r.fail ? 1 : 0);
  });
}
