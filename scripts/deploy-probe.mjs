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

const samples = [];
let last = new Map();   // 대상별 직전 상태 — 바뀔 때만 한 줄 찍는다(로그 홍수 방지)
console.log(`배포 프로브 시작 (${SECONDS}초, 1초 간격) — ${TARGETS.map((t) => t.name).join(" · ")}`);

for (let n = 0; n * EVERY_MS < SECONDS * 1000; n += 1) {
  const tick = Date.now();
  const results = await Promise.all(TARGETS.map((t) => hit(t, n)));
  results.forEach((r, i) => {
    const target = TARGETS[i];
    samples.push({ at: tick, name: target.name, ...r });
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
for (const target of TARGETS) {
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
console.log(worst > 0
  ? `\n⚠ 최대 ${worst.toFixed(0)}초 끊김 — 위 구간의 상태 코드로 원인을 가른다:\n`
    + "   404/522 = 전환 후 엣지 전파 · 타임아웃(TimeoutError) = 업로드 창 · 200인데 사이트만 하얗다 = 브라우저에 남은 옛 청크"
  : "\n✓ 끊김 없음 (프로브 기준). 브라우저에서만 안 열렸다면 옛 청크(assets/*.js 404) 쪽이다 — 강력 새로고침으로 재현되는지 확인.");

try {
  mkdirSync(join(ROOT, ".ci"), { recursive: true });
  writeFileSync(join(ROOT, ".ci/deploy-probe.json"), `${JSON.stringify({ started, samples }, null, 1)}\n`);
} catch { /* 기록 실패는 무시 — 배포 부가 작업이다 */ }
