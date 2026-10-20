// dev 서버 감시 — vinext dev 를 띄우고, 렌더 워커가 끊기면 저절로 다시 띄운다 (2026-10-20).
// app/i18n.tsx 처럼 서버 쪽 전체가 불러오는 파일을 고치면 vite 가 서버 환경을 통째로 다시 띄우는데(program reload),
// 그때 렌더 워커와의 연결이 끊겨("An error happened during full reload" → "Network connection lost") 그 뒤 모든 요청이 500 이 됐다.
// vinext 안쪽 문제라 여기서는 그 줄이 보이면 dev 를 내렸다 다시 올린다. npm run dev 가 이걸 부른다 (npm run dev:raw 는 감시 없이).
// ⚠ dev 는 자식·손자 프로세스(workerd 등)를 거느린다 — 자기 프로세스 묶음(detached)으로 띄우고 묶음째(-pid) 끈다.
//   종전엔 npx 만 끄고 손자 vinext 가 3000번을 붙잡은 채 남아, 새 dev 가 3001번으로 떴다 (2026-10-20 실측).
import { spawn } from "node:child_process";

const DEAD = /An error happened during full reload|Internal server error: Network connection lost/;
let child = null;
let restarting = false;
let quitting = false;

function killGroup(sig) {
  if (!child) return;
  try { process.kill(-child.pid, sig); } catch { /* 이미 끝남 */ }
}

function start() {
  restarting = false;
  child = spawn("node_modules/.bin/vinext", ["dev", ...process.argv.slice(2)], {
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const me = child;
  const watch = (src, out) => src.on("data", (buf) => {
    out.write(buf);
    if (!restarting && me === child && DEAD.test(String(buf))) restart();
  });
  watch(child.stdout, process.stdout);
  watch(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (me !== child) return;          // 이미 새 dev 로 넘어간 뒤의 옛 프로세스
    if (quitting) process.exit(code ?? 0);
    if (restarting) { setTimeout(start, 1500); return; }
    console.log(`[dev-watch] dev 가 ${code} 로 끝났습니다 — 다시 띄웁니다`);
    setTimeout(start, 1500);
  });
}

function restart() {
  restarting = true;
  console.log("\n[dev-watch] 렌더 워커가 끊겼습니다 — dev 서버를 다시 띄웁니다\n");
  killGroup("SIGTERM");
  setTimeout(() => { if (restarting) killGroup("SIGKILL"); }, 4000);
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { quitting = true; killGroup(sig); setTimeout(() => process.exit(0), 3000); });
start();
