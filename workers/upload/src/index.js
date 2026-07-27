// 테라 아카이브 파일 저장소 워커 — R2 버킷(terra-archive-files) 앞단.
// 사용자 혼자 올리고 사이트가 <img src>로 쓰는 구조 (2026-07-27 확정, S3 대체).
//
//   GET    /f/<key>      공개 서빙 — 캐시 1일, ETag 304 지원. CORS *
//   GET    /files        목록 (관리자)
//   PUT    /files/<key>  업로드 (관리자) — 같은 이름은 덮어쓴다
//   DELETE /files/<key>  삭제 (관리자)
//
// 관리자 판정: x-admin-key 헤더가 ADMIN_KEY 시크릿과 일치할 때만.
// Supabase RLS(x-admin-key)와 같은 비밀번호를 쓴다 — /admin이 입장 비밀번호를 그대로 보낸다.

// 관리자 API는 계정 워커와 같은 원칙 — 사이트와 로컬 개발만 허용
const ORIGIN_OK = (origin) =>
  origin === "https://terra-archive.net" ||
  origin === "https://terra-archive.pages.dev" ||
  /^https:\/\/[a-z0-9-]+\.terra-archive\.pages\.dev$/.test(origin) ||
  /^http:\/\/localhost:\d+$/.test(origin) ||
  /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ORIGIN_OK(origin) ? origin : "https://terra-archive.net",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const json = (payload, origin, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });

// 비밀번호 비교는 길이를 맞춘 뒤 timingSafeEqual — === 는 타이밍이 샌다
async function isAdmin(request, env) {
  const given = request.headers.get("x-admin-key") ?? "";
  const secret = env.ADMIN_KEY ?? "";
  if (!secret) return false; // 시크릿 미설정이면 전부 거부 (열린 채 뜨는 사고 방지)
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(secret);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

// URL 경로에서 키 추출 — 퍼센트 디코딩 + 경로 탈출 차단
function keyFrom(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  let key;
  try {
    key = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
  if (!key || key.length > 200 || key.includes("..") || key.startsWith("/")) return null;
  return key;
}

const publicBase = (env, url) => (env.PUBLIC_BASE || url.origin).replace(/\/+$/, "");
const fileUrl = (env, url, key) => `${publicBase(env, url)}/f/${encodeURIComponent(key)}`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "";

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

    // ── 공개 서빙 — 인증 없음, 아무 오리진에서나 <img>·fetch 가능 ──
    if (url.pathname.startsWith("/f/")) {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("method not allowed", { status: 405 });
      const key = keyFrom(url.pathname, "/f/");
      if (!key) return new Response("bad key", { status: 400 });
      // onlyIf에 요청 헤더를 그대로 넘기면 If-None-Match 판정을 R2가 해준다
      const object = await env.FILES.get(key, { onlyIf: request.headers });
      if (!object) return new Response("not found", { status: 404 });
      const headers = {
        "Cache-Control": "public, max-age=86400", // 덮어쓰기 반영은 최대 1일 늦는다
        ETag: object.httpEtag,
        "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      };
      if (!("body" in object) || !object.body) return new Response(null, { status: 304, headers }); // precondition 성립 → 304
      return new Response(request.method === "HEAD" ? null : object.body, { headers });
    }

    // ── 이하 관리자 전용 ──
    if (url.pathname === "/files" || url.pathname.startsWith("/files/")) {
      if (!(await isAdmin(request, env))) return json({ ok: false, error: "unauthorized" }, origin, 401);

      if (request.method === "GET" && url.pathname === "/files") {
        const files = [];
        let cursor;
        do {
          const page = await env.FILES.list({ limit: 500, cursor });
          for (const obj of page.objects)
            files.push({ key: obj.key, size: obj.size, uploaded: obj.uploaded, url: fileUrl(env, url, obj.key) });
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        files.sort((a, b) => (a.uploaded < b.uploaded ? 1 : -1)); // 최신이 위
        return json({ ok: true, files }, origin);
      }

      const key = keyFrom(url.pathname, "/files/");
      if (!key) return json({ ok: false, error: "bad-key" }, origin, 400);

      if (request.method === "PUT") {
        // 워커 요청 본문 한도(100MB)를 넘기 전에 거절
        const size = Number(request.headers.get("Content-Length") ?? 0);
        if (size > 95 * 1024 * 1024) return json({ ok: false, error: "too-large" }, origin, 413);
        const object = await env.FILES.put(key, request.body, {
          httpMetadata: { contentType: request.headers.get("Content-Type") ?? "application/octet-stream" },
        });
        return json({ ok: true, key, size: object.size, uploaded: object.uploaded, url: fileUrl(env, url, key) }, origin);
      }

      if (request.method === "DELETE") {
        await env.FILES.delete(key);
        return json({ ok: true, key }, origin);
      }

      return json({ ok: false, error: "method-not-allowed" }, origin, 405);
    }

    return json({ ok: true, service: "terra-archive-upload" }, origin, url.pathname === "/" ? 200 : 404);
  },
};
