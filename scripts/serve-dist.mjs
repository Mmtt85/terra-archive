#!/usr/bin/env node
// 빌드 산출물(dist/client)을 **Pages 처럼** 서빙하는 로컬 정적 서버 — 소개 스샷 촬영용 (2026-09-28).
//
// 왜 vinext start 가 아닌가: SESSION.md §2 가 `npm run start` 를 금지한다 (/admin 이 dev 전용이고,
// 같은 3000 포트를 물어 늘 켜 두는 dev 와 부딪힌다). 이 사이트는 정적 내보내기(output: "export")라
// 라이브도 dist/client 파일을 그대로 내보낼 뿐이다 — 여기서 같은 규칙(깨끗한 주소 → .html,
// .rsc → text/x-component)으로 내보내면 라이브와 같은 화면이 나온다. 에셋은 빌드가 박은 R2 주소로 간다.
//
//   node scripts/serve-dist.mjs [포트=3100]      (.claude/launch.json 의 "terra-archive-dist")
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "client");
const PORT = Number(process.argv[2] || process.env.PORT || 3100);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".rsc": "text/x-component", ".js": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".woff": "font/woff", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
};

if (!existsSync(join(ROOT, "index.html"))) {
  console.error("serve-dist: dist/client/index.html 이 없다 — npm run build 먼저");
  process.exit(1);
}

const isFile = (p) => existsSync(p) && statSync(p).isFile();
function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const base = join(ROOT, clean);
  if (!base.startsWith(ROOT)) return null;
  // Pages 의 깨끗한 주소: /x → x.html, /x/ → x/index.html, / → index.html
  for (const p of [base, `${base.replace(/\/$/, "")}.html`, join(base, "index.html")]) if (isFile(p)) return p;
  return null;
}

createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  const file = resolve(path);
  const target = file || join(ROOT, "404.html");
  res.writeHead(file ? 200 : 404, { "Content-Type": TYPES[extname(target)] || "application/octet-stream" });
  createReadStream(target).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`serve-dist: http://127.0.0.1:${PORT} ← dist/client`));
