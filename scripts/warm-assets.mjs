#!/usr/bin/env node
// 배포 전환 직후, **이번 빌드의 청크가 엣지에서 실제로 200으로 나올 때까지** 한 바퀴씩
// 돌며 데운다 (2026-08-06 밤, 사용자 제보로 원인이 확정된 뒤 추가).
//
// 무슨 일이 있었나: 배포 직후 브라우저 콘솔에 /assets/home-<해시>.js 404가 3~4분 떴다.
// 그런데 그 파일은 **옛 청크가 아니라 이번 배포에 들어 있는 파일**이었다. 즉 "옛 탭이
// 사라진 청크를 물고 있다"(keep-assets가 막는 것)가 아니라, 전환은 끝났는데 그 콜로에서
// 블롭을 아직 못 읽는 상태였다. 큰 파일일수록 늦었다 (터진 건 2.3MB짜리).
//
// 데우기가 왜 처방인가: 엣지가 원본에서 한 번 당겨오면 그 뒤로는 그 콜로에서 바로 나온다.
// 배포 직후 우리가 먼저 한 번 당겨 두면, 사용자가 첫 요청으로 404를 맞는 일이 없다.
// 동시에 "몇 초 만에 다 떴는지"를 남겨 다음 배포의 판단 근거가 된다.
//
//   node scripts/warm-assets.mjs [--seconds 180] [--base https://terra-archive.net]
// deploy.sh가 wrangler 직후에 부른다. 실패해도 배포는 성공이다(부가 작업).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "https://terra-archive.net");
const DEADLINE_MS = Number(arg("seconds", 180)) * 1000;
const ROUND_GAP_MS = 3000;
const TIMEOUT_MS = 20000;

const dir = join(ROOT, "dist/client/assets");
if (!existsSync(dir)) { console.log("warm-assets: dist/client/assets가 없어 건너뜀"); process.exit(0); }

// 큰 파일이 늦게 뜬다 — 큰 것부터 데워 최악을 먼저 해소한다.
const files = readdirSync(dir)
  .filter((f) => statSync(join(dir, f)).isFile())
  .map((f) => ({ f, size: statSync(join(dir, f)).size }))
  .sort((a, b) => b.size - a.size);

if (!files.length) { console.log("warm-assets: 데울 자산 없음"); process.exit(0); }

const mb = (n) => `${Math.round(n / 104857.6) / 10}MB`;
const started = Date.now();
const pending = new Map(files.map(({ f, size }) => [f, size]));
/** 파일별 "몇 회차에 처음 200이 됐나" — 2회차 이상이 곧 배포 직후 404를 맞은 파일이다.
 *  경과 초로 재면 배치 순번(뒤에 도는 파일)까지 늦은 것으로 잡혀서 회차로 센다. */
const okRound = new Map();

// 전체를 통째로 받는다 — Range로 앞부분만 받으면 엣지가 나머지를 캐시하지 않을 수 있다.
async function pull(file) {
  try {
    const res = await fetch(`${BASE}/assets/${file}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.arrayBuffer();
    // Pages의 404는 text/html 본문이라 상태코드만으론 부족하다
    return res.status === 200 && body.byteLength > 0 && !(res.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  }
}

console.log(`warm-assets: 자산 ${files.length}개(${mb(files.reduce((a, x) => a + x.size, 0))}) 데우는 중 — ${BASE}`);

for (let round = 1; pending.size > 0 && Date.now() - started < DEADLINE_MS; round += 1) {
  const targets = [...pending.keys()];
  // 4개씩 — 배포 직후 원본을 두들기지 않으면서도 2.3MB짜리가 밀리지 않는 선
  for (let i = 0; i < targets.length; i += 4) {
    const batch = targets.slice(i, i + 4);
    const oks = await Promise.all(batch.map(pull));
    batch.forEach((f, k) => {
      if (!oks[k]) return;
      okRound.set(f, round);
      pending.delete(f);
    });
  }
  if (pending.size) {
    console.log(`  ${round}회차 — 아직 ${pending.size}개 못 뜸: ${[...pending.keys()].slice(0, 3).join(" ")}${pending.size > 3 ? " …" : ""}`);
    await new Promise((r) => setTimeout(r, ROUND_GAP_MS));
  }
}

const took = Math.round((Date.now() - started) / 1000);
// 1회차에 통과 = 전환 시점에 이미 엣지에서 읽혔다는 뜻. 2회차 이상이 배포 직후 404 창이다.
const late = [...okRound].filter(([, r]) => r > 1).sort((a, b) => b[1] - a[1]);
if (pending.size) {
  console.log(`⚠ warm-assets: ${Math.round(DEADLINE_MS / 1000)}초 안에 안 뜬 자산 ${pending.size}개 — ${[...pending.keys()].join(" ")}`);
  console.log("   이 파일들은 지금 이 순간 사용자에게도 404다. Cloudflare 대시보드에서 배포 상태를 확인할 것.");
} else if (late.length) {
  console.log(`warm-assets: 전부 정상 (${took}초). **배포 직후 404였다가 늦게 뜬 파일** ${late.length}개 — ${late.slice(0, 5).map(([f, r]) => `${f}(${r}회차)`).join(", ")}`);
  console.log("   우리가 먼저 당겨 뒀으니 사용자는 안 맞는다. 매번 같은 파일이면 그 청크를 쪼갤 것.");
} else {
  console.log(`warm-assets: 전부 즉시 정상 (${files.length}개, ${took}초) — 배포 직후 404 창 없음`);
}
