#!/usr/bin/env node
// 배포 무중단 실측 — 배포 직전부터 프로덕션을 1초 간격으로 찔러 "언제 몇 초 동안 뭐가
// 안 됐는지"를 기록한다 (사용자 제보 2026-08-06: "배포 끝나고 30초~1분 접속이 안 되는
// 시간이 늘어난다").
//
// 왜 필요한가: 원인이 ① 업로드 창(전환 전) ② 전환 후 엣지 전파 ③ 브라우저에 남은 옛
// 청크(HTML은 새건데 assets/*.js가 404) 중 어느 것인지에 따라 처방이 완전히 다르다.
// 상태 코드·소요 시간·응답을 처리한 콜로(CF-Ray 접미)를 남겨 셋을 구분한다.
//
//   node scripts/deploy-probe.mjs --seconds 240        # 단독 실행
//   deploy.sh가 배포 직전에 자동으로 백그라운드 실행하고 끝나면 요약을 출력한다.
//
// 결과는 .ci/deploy-probe.log (git 무시). 실패해도 배포에는 영향이 없다.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const SECONDS = Number(arg("seconds", 240));
const EVERY_MS = 1000;
const TIMEOUT_MS = 8000;

// 대상 3종 — 셋이 서로 다른 실패 모드를 잡는다.
//  · HTML 진입점: 사이트가 뜨는가
//  · 해시 없는 정적 파일: 배포 전환이 됐는가(sitemap은 매 빌드 바뀐다)
//  · .rsc: 클라 라우터가 쓰는 응답이 살아 있는가(2026-07-18 무한루프 계열 재발 감시)
const TARGETS = [
  { name: "html", url: "https://terra-archive.net/" },
  { name: "infra", url: "https://terra-archive.net/infra" },
  { name: "rsc", url: "https://terra-archive.net/infra.rsc" },
];

const hhmmss = (ms) => new Date(ms + 9 * 3600_000).toISOString().slice(11, 19); // KST
const started = Date.now();

async function hit(target, n) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${target.url}${target.url.includes("?") ? "&" : "?"}_probe=${n}`, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 본문까지 받아야 "헤더는 왔는데 본문에서 끊기는" 경우가 잡힌다
    const body = await res.text();
    return {
      ok: res.status >= 200 && res.status < 400 && body.length > 0,
      status: res.status,
      ms: Date.now() - t0,
      colo: (res.headers.get("cf-ray") ?? "").split("-")[1] ?? "",
      bytes: body.length,
    };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - t0, colo: "", bytes: 0, err: err?.name || String(err) };
  }
}

// 핵심 판정: **방금 받은 HTML이 가리키는 청크 전부**가 그 자리에서 200인가.
// 사용자 브라우저가 겪는 것과 정확히 같은 순서(HTML → 그 HTML의 /assets/*)라,
// 여기서 404가 나면 "청크를 못 불러온다"의 재현이다.
//
// ⚠ 2026-08-06 밤 수정 — 종전엔 **첫 번째 매치 하나만** 확인했다. 그날 실제 사고에서 첫
// 매치는 작은 layout-segment-context 였고, 정작 3~4분간 404였던 건 2.3MB짜리
// home-<해시>.js 였다. 프로브는 "끊김 없음"을 찍었는데 브라우저는 흰 화면이었다.
// 큰 청크일수록 배포 직후 엣지에서 늦게 뜨므로, **전부** 그리고 **큰 것부터** 본다.
let lastSet = "";
async function chunkOfHtml(n) {
  const t0 = Date.now();
  try {
    const res = await fetch(`https://terra-archive.net/infra?_probe=c${n}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const html = await res.text();
    const srcs = [...new Set(html.match(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g) ?? [])];
    if (!srcs.length) return { ok: false, status: res.status, ms: Date.now() - t0, colo: "", bytes: 0, err: "청크참조없음" };
    // Range로 앞 2KB만 받는다 — 1초마다 2.3MB 청크를 통째로 끌면 4분에 550MB다.
    // HEAD가 아니라 Range인 이유: HEAD는 메타데이터만 보고 답할 수 있어 "블롭이 아직
    // 없다"를 놓칠 수 있다. 실제 본문 읽기를 강제해야 그 실패가 그대로 나온다.
    const checked = await Promise.all(srcs.map(async (src) => {
      try {
        const asset = await fetch(`https://terra-archive.net${src}`, {
          cache: "no-store", headers: { Range: "bytes=0-2047" }, signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await asset.text();
        const ok = (asset.status === 206 || asset.status === 200) && body.length > 0 && !body.startsWith("<");
        return { src, ok, status: asset.status, bytes: body.length, colo: (asset.headers.get("cf-ray") ?? "").split("-")[1] ?? "" };
      } catch (err) {
        return { src, ok: false, status: 0, bytes: 0, colo: "", err: err?.name || String(err) };
      }
    }));
    const bad = checked.filter((c) => !c.ok);
    const key = srcs.slice().sort().join(",");
    const changed = lastSet && lastSet !== key;
    lastSet = key;
    return {
      ok: bad.length === 0,
      status: bad[0]?.status ?? 200, ms: Date.now() - t0,
      colo: checked.find((c) => c.colo)?.colo ?? "",
      bytes: checked.reduce((a, c) => a + c.bytes, 0),
      note: changed ? `청크 세대 교체 (${srcs.length}개)` : undefined,
      // 어느 파일이 몇 번 죽었는지가 처방을 가른다 — 파일명을 그대로 남긴다
      err: bad.length ? `청크${bad[0].status || "실패"}(${bad.map((b) => b.src.replace("/assets/", "")).join(" ")})` : undefined,
    };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - t0, colo: "", bytes: 0, err: err?.name || String(err) };
  }
}

const samples = [];
let last = new Map();   // 대상별 직전 상태 — 바뀔 때만 한 줄 찍는다(로그 홍수 방지)
console.log(`배포 프로브 시작 (${SECONDS}초, 1초 간격) — ${TARGETS.map((t) => t.name).join(" · ")} · chunk`);

for (let n = 0; n * EVERY_MS < SECONDS * 1000; n += 1) {
  const tick = Date.now();
  const results = [...await Promise.all(TARGETS.map((t) => hit(t, n))), await chunkOfHtml(n)];
  results.forEach((r, i) => {
    const target = TARGETS[i] ?? { name: "chunk" };
    samples.push({ at: tick, name: target.name, ...r });
    if (r.note) console.log(`  ${hhmmss(tick)} chunk ${r.note}`);
    const state = r.ok ? `OK ${r.status}` : `실패 ${r.err ?? r.status}`;
    if (last.get(target.name) !== state) {
      console.log(`  ${hhmmss(tick)} ${target.name.padEnd(5)} ${state}${r.colo ? ` (${r.colo})` : ""} ${r.ms}ms`);
      last.set(target.name, state);
    }
  });
  const wait = EVERY_MS - (Date.now() - tick);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

// ── 요약: 대상별 연속 실패 구간 ──────────────────────────────────────────────
console.log("\n── 요약 ──────────────────────────────────────────");
let worst = 0;
for (const target of [...TARGETS, { name: "chunk" }]) {
  const mine = samples.filter((s) => s.name === target.name);
  const gaps = [];
  let run = null;
  for (const s of mine) {
    if (!s.ok) run = run ?? { from: s.at, codes: new Map() };
    if (!s.ok) run.codes.set(s.err ?? s.status, (run.codes.get(s.err ?? s.status) ?? 0) + 1);
    if (s.ok && run) { gaps.push({ ...run, to: s.at }); run = null; }
  }
  if (run) gaps.push({ ...run, to: mine.at(-1).at });
  const total = gaps.reduce((a, g) => a + (g.to - g.from) / 1000, 0);
  worst = Math.max(worst, total);
  const p50 = mine.map((s) => s.ms).sort((a, b) => a - b)[Math.floor(mine.length / 2)] ?? 0;
  console.log(`${target.name.padEnd(5)} 표본 ${mine.length} · 중앙 ${p50}ms · 실패 ${mine.filter((s) => !s.ok).length}회 · 끊긴 시간 ${total.toFixed(0)}초`);
  for (const g of gaps) {
    console.log(`      ${hhmmss(g.from)} ~ ${hhmmss(g.to)} (${((g.to - g.from) / 1000).toFixed(0)}초) — ${[...g.codes].map(([k, v]) => `${k}×${v}`).join(", ")}`);
  }
}
// chunk 줄이 핵심이다 — HTML을 받자마자 그 HTML이 가리키는 청크를 물었을 때의 결과라,
// 여기서 404가 났다면 사용자가 콘솔에서 보는 "청크를 못 불러온다"와 같은 사건이다.
const chunkFails = samples.filter((s) => s.name === "chunk" && !s.ok);
// 어느 파일이 죽었는지가 처방을 가른다 — 이번 빌드에 있는 파일이 404면 블롭 전파,
// 없는 파일이 404면 옛 탭이 물고 있던 청크(keep-assets 소관)다.
if (chunkFails.length) {
  const byFile = new Map();
  for (const s of chunkFails) for (const f of (s.err ?? "").replace(/^청크[^(]*\(|\)$/g, "").split(" ").filter(Boolean)) byFile.set(f, (byFile.get(f) ?? 0) + 1);
  console.log("\n죽은 청크 (파일별 실패 횟수):");
  for (const [f, c] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`      ${f} ×${c}`);
}
console.log(worst > 0
  ? `\n⚠ 최대 ${worst.toFixed(0)}초 끊김 — 원인 판정:\n`
    + (chunkFails.length > 0
      ? "   위 청크가 **이번 빌드에 있는 파일**이면 → 전환은 됐는데 블롭이 엣지에 아직 없다.\n"
        + "     처방: 2단계 배포(기본값, 블롭 선업로드) + 전환 직후 warm-assets. 둘 다 이미 돈다.\n"
        + "   **없는 파일**이면 → 옛 탭이 물고 있던 청크다. keep-assets(직전 3회분 동봉) 소관."
      : "   html/infra만 실패 → 업로드 창(TimeoutError) 또는 전환 자체.")
  : "\n✓ 끊김 없음 (프로브 기준, HTML이 참조하는 모든 청크 확인).");

try {
  mkdirSync(join(ROOT, ".ci"), { recursive: true });
  writeFileSync(join(ROOT, ".ci/deploy-probe.json"), `${JSON.stringify({ started, samples }, null, 1)}\n`);
} catch { /* 기록 실패는 무시 — 배포 부가 작업이다 */ }
