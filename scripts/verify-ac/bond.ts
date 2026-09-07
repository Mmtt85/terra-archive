// 위수 협의 밴 목록 **맹약 아이콘 → 맹약** 회귀 하네스 (app/lens/acbond.ts) — 2026-09-07.
//
//   npx tsx scripts/verify-ac/bond.ts            ← 리포 루트에서. 실패 시 exit 1
//   npx tsx scripts/verify-ac/bond.ts --quick    ← 표본 1/3 (3의 배수 프레임만), 하한도 같은 비율로 줄인다
//
// 픽스처(git 미추적, 로컬): fixtures/lens/ac-frames/v1/f001~f036.png · v2/f001~f081.png,
// fixtures/lens/screenshots/ban2.jpg. 없으면 **조용히 건너뛴다** (pass 0 · fail 0).
//
// 무엇을 재나 — 아이콘 매칭은 **게이트이면서 라벨**이다 (acbond.ts 머리말 참조):
//   (a) 양성 — 밴 카드가 보이는 33프레임의 검출된 행(cut 포함) 전부에서 1순위가 실제 맹약인가.
//       행↔정답 대응은 티어 목록 다중집합으로 정한다 (한 녹화 안에서 행별 티어 목록은 서로 다르다).
//       cut 행은 티어가 null 이라 어느 정답 행인지 못 정하므로 **그 녹화의 맹약 집합에 드는지**만 본다.
//   (b) 음성 — **밴 구간 밖 84프레임**의 모든 행(게이트 통과 여부와 무관하게 전부)에서 승인이 0건인가.
//       이게 0 이면 아이콘 매칭 단독으로도 게이트가 된다. 실측 149행 최고 0.431 vs 문턱 0.62.
//   (c) 전체화면 스샷 ban2.jpg (제3의 캡처, 2388×1668) — 6행 전부 정답인가.
//   (d) 점수·마진 분포와 소요 시간 — 문턱 여유가 줄어들면(회귀) 여기서 먼저 보인다.
//
// 하한 (2026-09-07 900px 판 실측에서 잡았다 — 아래로 내려가면 회귀다):
//   양성 행 95개 = 티어로 정답 행을 특정할 수 있는 **88** + cut 행 7(맹약 집합만 확인).
//   그 88개 1순위 정답 88/88(100%) → **≥86** · 승인 미달 0 → **0** · 음성 승인 0/149 → **0**
//   양성 최저 점수 0.830 → **≥0.70** (문턱 0.62 위로 여유 확인) · ban2 6/6 → **6**
//
// sharp 는 png/webp **디코드**와 브리지 시뮬레이션(900 축소·JPEG — 브라우저의 canvas drawImage 에 해당)에만 쓴다.
// 크롭·축소·특징은 운영 코드와 같은 pix.resampleRgb / acbond.bondTemplate 이다.
// ⚠ 정답 라벨은 이 파일 안의 상수다 (각 하네스가 자기 정답을 들고 있는 게 이 폴더의 규약).

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { findAcRows } from "../../app/lens/acvision";
import { bondTemplate, matchBondIcon, bondOfHit, BOND_ACCEPT } from "../../app/lens/acbond";
import type { Raster } from "../../app/lens/pix";

const ROOT = resolve(import.meta.dirname ?? __dirname, "../..");
const FRAMES_DIR = resolve(ROOT, "fixtures/lens/ac-frames");
const SHOTS_DIR = resolve(ROOT, "fixtures/lens/screenshots");
const ICONS_DIR = resolve(ROOT, "public/ac/bond");

// ── 정답 (사람이 프레임을 눈으로 보고 확정, 2026-09-07) ──────────────────────────────────
// 맹약 id → 그 행의 티어 목록. 줄바꿈된 7번째 카드는 findAcRows 가 위 행에 합치므로 합친 값이다.
const TRUTH: Record<"v1" | "v2", Record<string, number[]>> = {
  v1: {
    kjeragShip: [4, 3], lateranoShip: [6, 6, 5], egirShip: [6, 5, 5, 4, 4, 2, 1],
    visiShip: [5, 5, 4, 3, 2], raidShip: [4, 2, 1], indomShip: [5, 1], soloShip: [4, 4],
  },
  v2: {
    sargonShip: [4, 3, 3, 2, 2, 1], siracusaShip: [6, 5, 3, 2, 1], kazimierzShip: [5, 4, 2],
    skillfulShip: [3, 3, 1], steadShip: [2, 2, 1], visiShip: [5, 2], miraShip: [5, 4, 3, 2],
  },
};
/** 녹화 전체 길이와, 밴 **카드가 화면에 보이는** 구간 (grid.ts 와 같은 값) */
const ALL_FRAMES: Record<"v1" | "v2", number> = { v1: 36, v2: 81 };
const BAN_VISIBLE: Record<"v1" | "v2", [number, number]> = { v1: [15, 36], v2: [10, 20] };
/** 전체화면 스샷 — 위→아래 행 순서 (6번째는 아래로 잘린 행) */
const SHOT_ROWS: Record<string, string[]> = {
  "ban2.jpg": ["yanShip", "kjeragShip", "siracusaShip", "preciShip", "arcaneShip", "miraShip"],
};

// 하한
const MIN_POS_OK = 86;          // 양성 1순위 정답 (실측 88 — cut 행 7개는 맹약 집합만 확인하므로 별도)
const MIN_POS_SCORE = 0.70;     // 양성 최저 점수 (실측 0.830 · 문턱 0.62)
const MIN_SHOT_OK = 6;          // ban2.jpg 행 (실측 6)

// ── 브리지 시뮬레이션 (app/lens/bridge.ts 와 같은 모양) ──────────────────────────────────
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
async function loadBridgeFrame(path: string): Promise<Frame> {
  const meta = await sharp(path).metadata();
  const w = meta.width!, h = meta.height!;
  const small = await sharp(path).resize(SMALL_W, SMALL_H, { fit: "fill" }).greyscale().raw().toBuffer();
  const crop = contentRect(new Uint8Array(small), w, h);
  const outW = Math.min(crop.w, OCR_MAX_W), outH = Math.round((crop.h / crop.w) * outW);
  let pipe = sharp(path).extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h });
  if (outW !== crop.w) pipe = pipe.resize(outW, outH, { kernel: "lanczos3" });
  const jpeg = await pipe.jpeg({ quality: 90 }).toBuffer();
  const { data, info } = await sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), W: info.width, H: info.height };
}

// ── 템플릿 (sharp 는 webp 디코드만 — 정사각화·축소·특징은 acbond.bondTemplate 이 pix 로) ──────
const BOND_IDS = [
  "yanShip", "sargonShip", "victoriaShip", "kjeragShip", "lateranoShip", "egirShip", "siracusaShip",
  "kazimierzShip", "preciShip", "swiftShip", "skillfulShip", "arcaneShip", "steadShip", "deputShip",
  "visiShip", "miraShip", "investShip", "raidShip", "indomShip", "maniShip", "emptyShip", "soloShip", "suntShip",
];
async function loadTemplates(): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>();
  for (const id of BOND_IDS) {
    const p = resolve(ICONS_DIR, `${id}.webp`);
    if (!existsSync(p)) continue;
    const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const raster: Raster = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: 4 };
    out.set(id, bondTemplate(raster));
  }
  return out;
}

const sameSet = (a: number[], b: number[]) => {
  const x = a.slice().sort(), y = b.slice().sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const pct = (x: number, y: number) => `${x}/${y} (${y ? (100 * x / y).toFixed(0) : 0}%)`;
const q = (a: number[], f: number) => (a.length ? a.slice().sort((p, r) => p - r)[Math.min(a.length - 1, Math.floor(a.length * f))] : 0);

export async function verify(): Promise<{ name: string; pass: number; fail: number; lines: string[] }> {
  const name = "bond";
  const lines: string[] = [];
  let pass = 0, fail = 0;
  const quick = process.argv.includes("--quick");
  const haveFrames = existsSync(`${FRAMES_DIR}/v1/f015.png`) && existsSync(`${FRAMES_DIR}/v2/f010.png`);
  const shots = Object.keys(SHOT_ROWS).filter((f) => existsSync(resolve(SHOTS_DIR, f)));
  if (!haveFrames && !shots.length) { lines.push("픽스처 없음 — 건너뜀 (fixtures/lens/ 는 로컬 전용)"); return { name, pass, fail, lines }; }

  const t0 = performance.now();
  const tpl = await loadTemplates();
  const tplMs = performance.now() - t0;
  if (tpl.size !== BOND_IDS.length) {
    lines.push(`❌ 맹약 아이콘 템플릿 ${tpl.size}/${BOND_IDS.length} — public/ac/bond/ 에 파일이 빠졌다`);
    return { name, pass, fail: fail + 1, lines };
  }
  lines.push(`템플릿 ${tpl.size}개 ${tplMs.toFixed(0)}ms`);

  if (haveFrames) {
    let posOk = 0, posWrong = 0, posUnverified = 0, posReject = 0, negAccept = 0, negRows = 0, rowMs = 0, rows = 0;
    const posScores: number[] = [], posMargins: number[] = [], negScores: number[] = [];
    for (const v of ["v1", "v2"] as const) {
      const [a, b] = BAN_VISIBLE[v];
      const bonds = new Set(Object.keys(TRUTH[v]));
      for (let n = 1; n <= ALL_FRAMES[v]; n++) {
        if (quick && n % 3 !== 0) continue;
        const key = `${v}/f${String(n).padStart(3, "0")}`;
        const p = `${FRAMES_DIR}/${key}.png`;
        if (!existsSync(p)) continue;
        const f = await loadBridgeFrame(p);
        const g = findAcRows(f.px, f.W, f.H);
        const positive = n >= a && n <= b;
        for (const row of g.rows) {
          const t = performance.now();
          const hit = matchBondIcon(f.px, f.W, f.H, row.icon, tpl);
          rowMs += performance.now() - t; rows++;
          const got = bondOfHit(hit);
          if (!positive) {
            negRows++;
            if (hit) negScores.push(hit.score);
            if (got) {
              negAccept++;
              lines.push(`  음성 ❌ ${key} 행 top=${row.top.toFixed(3)} → ${got} ${hit!.score.toFixed(3)}/${hit!.margin.toFixed(3)} (승인되면 안 된다)`);
            }
            continue;
          }
          if (!got) {
            posReject++;
            lines.push(`  양성 ❌ ${key} 행 top=${row.top.toFixed(3)} 미승인 (${hit ? `${hit.band} ${hit.score.toFixed(3)}/${hit.margin.toFixed(3)}` : "평탄"})`);
            continue;
          }
          posScores.push(hit!.score); posMargins.push(hit!.margin);
          // 티어 목록으로 어느 정답 행인지 정한다 — cut 행은 티어가 없어 못 정하므로 맹약 집합만 본다
          const tiers = row.cards.map((k) => k.tier);
          const known = !row.cut && tiers.every((x): x is number => x !== null)
            ? Object.entries(TRUTH[v]).find(([, tt]) => sameSet(tiers as number[], tt))?.[0]
            : undefined;
          if (known) {
            if (known === got) posOk++;
            else { posWrong++; lines.push(`  양성 ❌ ${key} 행 [${tiers.join(",")}] → ${got} (정답 ${known}) ${hit!.score.toFixed(3)}`); }
          } else if (bonds.has(got)) posUnverified++;
          else { posWrong++; lines.push(`  양성 ❌ ${key} 행 top=${row.top.toFixed(3)} → ${got} — 이 녹화에 없는 맹약 ${hit!.score.toFixed(3)}`); }
        }
      }
    }
    const minPos = MIN_POS_OK * (quick ? 0.34 : 1);
    lines.push(`[양성] 1순위 정답 ${posOk} (하한 ${minPos.toFixed(0)}) · 맹약 집합만 확인(cut 행) ${posUnverified} · 오답 ${posWrong} · 미승인 ${posReject}`);
    lines.push(`       점수 최저 ${q(posScores, 0).toFixed(3)} · p10 ${q(posScores, 0.1).toFixed(3)} · 중앙 ${q(posScores, 0.5).toFixed(3)} · 최고 ${q(posScores, 1).toFixed(3)}`
      + ` | 마진 최저 ${q(posMargins, 0).toFixed(3)} · 중앙 ${q(posMargins, 0.5).toFixed(3)}`);
    lines.push(`[음성] 행 ${negRows}개 중 승인 ${negAccept} (기대 0) · 점수 최고 ${q(negScores, 1).toFixed(3)} (점수 없음 ${negRows - negScores.length}행) · 문턱 ${BOND_ACCEPT.score}`);
    lines.push(`[속도] 행당 ${rows ? (rowMs / rows).toFixed(1) : 0}ms · 행 ${rows}개`);
    const okPos = posOk >= minPos && posWrong === 0 && posReject === 0 && q(posScores, 0) >= MIN_POS_SCORE;
    const okNeg = negAccept === 0;
    lines.push(`${okPos ? "✅" : "❌"} 양성 — 정답 ${pct(posOk, posOk + posWrong)} · 최저 점수 ${q(posScores, 0).toFixed(3)} (하한 ${MIN_POS_SCORE})`);
    lines.push(`${okNeg ? "✅" : "❌"} 음성 — 밴 화면 밖 승인 ${negAccept} (기대 0)`);
    if (okPos) pass++; else fail++;
    if (okNeg) pass++; else fail++;
  } else lines.push("녹화 프레임 없음 — 건너뜀 (fixtures/lens/ac-frames/)");

  for (const file of shots) {
    const want = SHOT_ROWS[file];
    const { data, info } = await sharp(resolve(SHOTS_DIR, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
    const g = findAcRows(px, info.width, info.height);
    let ok = 0;
    const got: string[] = [];
    g.rows.forEach((row, i) => {
      const bond = bondOfHit(matchBondIcon(px, info.width, info.height, row.icon, tpl));
      got.push(bond ?? "?");
      if (bond && bond === want[i]) ok++;
    });
    const good = ok >= MIN_SHOT_OK;
    lines.push(`${good ? "✅" : "❌"} ${file} ${info.width}x${info.height} 행 ${g.rows.length} → ${ok}/${want.length} 정답: ${got.join(" ")}`);
    if (good) pass++; else fail++;
  }
  return { name, pass, fail, lines };
}

// 직접 실행
const isMain = typeof process !== "undefined" && process.argv[1] && /verify-ac[\\/]bond\.ts$/.test(process.argv[1]);
if (isMain) {
  verify().then((r) => {
    for (const l of r.lines) console.log(l);
    console.log(`\n${r.name}: pass ${r.pass} · fail ${r.fail}`);
    process.exit(r.fail ? 1 : 0);
  });
}
