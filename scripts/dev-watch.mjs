// dev 서버 감시 — vinext dev 를 띄우고, 렌더 워커가 끊기면 저절로 다시 띄운다 (2026-10-20).
// app/i18n.tsx 처럼 서버 쪽 전체가 불러오는 파일을 고치면 vite 가 서버 환경을 통째로 다시 띄우는데(program reload),
// 그때 렌더 워커와의 연결이 끊겨("An error happened during full reload" → "Network connection lost") 그 뒤 모든 요청이 500 이 됐다.
// vinext 안쪽 문제라 여기서는 그 줄이 보이면 dev 를 내렸다 다시 올린다. npm run dev 가 이걸 부른다 (npm run dev:raw 는 감시 없이).
import { spawn } from "node:child_process";

const DEAD = /An error happened during full reload|Internal server error: Network connection lost/;
let child = null;
let restarting = false;
let quitting = false;

function start() {
  restarting = false;
  child = spawn("npx", ["vinext", "dev", ...process.argv.slice(2)], {
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
    stdio: ["inherit", "pipe", "pipe"],
  });
  const watch = (src, out) => src.on("data", (buf) => {
    out.write(buf);
    if (!restarting && DEAD.test(String(buf))) restart();
  });
  watch(child.stdout, process.stdout);
  watch(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (quitting) process.exit(code ?? 0);
    if (restarting) start();
    else { console.log(`[dev-watch] dev 가 ${code} 로 끝났습니다 — 다시 띄웁니다`); setTimeout(start, 1000); }
  });
}

function restart() {
  restarting = true;
  console.log("\n[dev-watch] 렌더 워커가 끊겼습니다 — dev 서버를 다시 띄웁니다\n");
  child.kill("SIGTERM");
  setTimeout(() => { if (child.exitCode == null) child.kill("SIGKILL"); }, 4000);
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { quitting = true; child?.kill(sig); });
start();
