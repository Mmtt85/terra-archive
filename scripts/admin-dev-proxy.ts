// 로컬 개발용 관리자 API 프록시 (vite dev 전용 플러그인, 2026-07-27)
//
// 실서비스에선 admin.terra-archive.net/api/*를 admin-api 워커(Cloudflare Access 뒤)가
// 받지만, localhost dev 서버엔 Access 쿠키가 없다. 대신 이 플러그인이 dev 서버의
// /api/*를 가로채, 레포 루트의 키 파일(gitignore — 이 컴퓨터에만 존재)을 붙여
// Supabase·업로드 워커로 직접 중계한다 → 로컬에서도 /admin이 실서비스와 똑같이 동작.
//
// 키 파일이 없으면 503 — /admin 게이트에 안내가 뜬다. 빌드 산출물에는 포함되지 않는다.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const SUPABASE_URL = "https://exirlkhpkgxsflbglhld.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4aXJsa2hwa2d4c2ZsYmdsaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNTAwNDEsImV4cCI6MjA5ODgyNjA0MX0.IKwvqp0OyHOacl89JWIoRwzvJRDc2t0678qs3NPZ4fw";
const UPLOAD_API = "https://terra-archive-upload.nzkonaru.workers.dev";

const readKey = (root: string, name: string): string | null =>
  existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8").trim() : null;

const send = (res: ServerResponse, status: number, payload: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function relay(req: IncomingMessage, res: ServerResponse, target: string, extra: Record<string, string>) {
  const headers: Record<string, string> = { ...extra };
  for (const name of ["content-type", "prefer", "range", "x-cache-control", "if-none-match"]) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  const method = req.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
  const upstream = await fetch(target, { method, headers, body });
  res.statusCode = upstream.status;
  for (const name of ["content-type", "content-range", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

export function adminDevProxy(): Plugin {
  return {
    name: "terra-archive-admin-dev-proxy",
    apply: "serve", // dev에서만 — 빌드에는 아무 영향 없음
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/")) return next();

        (async () => {
          if (url === "/api/me") {
            // Access 대신 키 파일 존재가 곧 "이 컴퓨터 주인" 증명
            if (!readKey(root, ".supabase-admin-key")) {
              return send(res, 503, { ok: false, error: "로컬 키 파일(.supabase-admin-key) 없음 — 실서비스 admin.terra-archive.net을 쓰거나 키 파일을 준비하세요" });
            }
            return send(res, 200, { ok: true, email: "local-dev" });
          }

          if (url.startsWith("/api/supabase/")) {
            const key = readKey(root, ".supabase-admin-key");
            if (!key) return send(res, 503, { ok: false, error: "키 파일 없음 (.supabase-admin-key)" });
            const rest = url.slice("/api/supabase/".length);
            if (!/^[A-Za-z0-9_]+(\?|$)/.test(rest)) return send(res, 400, { ok: false, error: "bad-table" });
            return relay(req, res, `${SUPABASE_URL}/rest/v1/${rest}`, {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              "x-admin-key": key,
            });
          }

          if (url === "/api/files" || url.startsWith("/api/files/")) {
            const key = readKey(root, ".upload-admin-key");
            if (!key) return send(res, 503, { ok: false, error: "키 파일 없음 (.upload-admin-key)" });
            return relay(req, res, `${UPLOAD_API}${url.slice("/api".length)}`, { "x-admin-key": key });
          }

          send(res, 404, { ok: false, error: "not-found" });
        })().catch((err) => send(res, 502, { ok: false, error: String(err) }));
      });
    },
  };
}
