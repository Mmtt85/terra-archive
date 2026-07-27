// 테라 아카이브 파일 저장소 워커 — R2 버킷(terra-archive-files) 앞단.
// 사용자 혼자 올리고 사이트가 <img src>로 쓰는 구조 (2026-07-27 확정, S3 대체).
//
//   GET    /f/<key>      공개 서빙(폴백) — 평소엔 버킷 커스텀 도메인 files.terra-archive.net이 서빙
//   GET    /files        목록 — 전체 (admin UI가 uploads/·assets/ 탭으로 나눔)
//   PUT    /files/<key>  업로드 — admin은 uploads/<key>로 강제, 같은 이름은 덮어쓴다
//   DELETE /files/<key>  삭제 — admin은 uploads/ 안에서만 (에셋 트리 보호)
//
// 관리자 판정: x-admin-key 헤더가 ADMIN_KEY(= /admin 입장 비밀번호) 또는
// SYNC_KEY(scripts/r2-sync.mjs 전용 무작위 키 — 사이트 정적 에셋 동기화) 시크릿과 일치할 때만.

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
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key, x-cache-control",
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
function keyEquals(given, secret) {
  if (!secret) return false; // 시크릿 미설정이면 거부 (열린 채 뜨는 사고 방지)
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(secret);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

// 누구로 인증됐는지에 따라 쓰기·삭제 범위가 다르다 (목록은 둘 다 전체):
//   admin(/admin 파일 탭) → uploads/ 안에서만 쓰고 지운다 (에셋 트리 실수 삭제 방지)
//   sync(r2-sync.mjs)     → 버킷 전체 (assets/ 동기화·프룬)
function authKind(request, env) {
  const given = request.headers.get("x-admin-key") ?? "";
  if (keyEquals(given, env.SYNC_KEY)) return "sync";
  if (keyEquals(given, env.ADMIN_KEY)) return "admin";
  return null;
}

const UPLOADS = "uploads/"; // /admin 수동 업로드 전용 폴더

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

// 공개 URL: PUBLIC_BASE(버킷 커스텀 도메인 — 키가 곧 경로)가 있으면 그쪽, 없으면 워커 /f/ 경로
const fileUrl = (env, url, key) => {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  const base = (env.PUBLIC_BASE || "").replace(/\/+$/, "");
  return base ? `${base}/${encoded}` : `${url.origin}/f/${encoded}`;
};

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
        // 업로드 때 지정한 캐시 정책(에셋 동기화는 확장자별로 넣는다), 없으면 1일
        "Cache-Control": object.httpMetadata?.cacheControl ?? "public, max-age=86400",
        ETag: object.httpEtag,
        "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      };
      if (!("body" in object) || !object.body) return new Response(null, { status: 304, headers }); // precondition 성립 → 304
      return new Response(request.method === "HEAD" ? null : object.body, { headers });
    }

    // ── 이하 관리자 전용 ──
    if (url.pathname === "/files" || url.pathname.startsWith("/files/")) {
      const kind = authKind(request, env);
      if (!kind) return json({ ok: false, error: "unauthorized" }, origin, 401);

      if (request.method === "GET" && url.pathname === "/files") {
        const files = [];
        let cursor;
        do {
          // 목록은 admin에게도 전체 공개 — /admin 파일 탭이 내 업로드/사이트 에셋 탭으로
          // 나눠 보여준다 (2026-07-27). 쓰기·삭제 스코프는 아래에서 계속 uploads/로 제한.
          const page = await env.FILES.list({ limit: 500, cursor });
          for (const obj of page.objects)
            // etag = 단일 PUT이면 본문 md5 (r2-sync.mjs 증분 판정에 쓴다)
            files.push({ key: obj.key, size: obj.size, uploaded: obj.uploaded, etag: obj.etag, url: fileUrl(env, url, obj.key) });
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        files.sort((a, b) => (a.uploaded < b.uploaded ? 1 : -1)); // 최신이 위
        return json({ ok: true, files }, origin);
      }

      let key = keyFrom(url.pathname, "/files/");
      if (!key) return json({ ok: false, error: "bad-key" }, origin, 400);
      // admin의 수동 업로드는 전부 uploads/ 폴더로 (에셋 트리와 격리, 삭제도 그 안에서만)
      if (kind === "admin" && request.method === "PUT" && !key.startsWith(UPLOADS)) key = UPLOADS + key;
      if (kind === "admin" && !key.startsWith(UPLOADS)) return json({ ok: false, error: "outside-uploads" }, origin, 403);

      if (request.method === "PUT") {
        // 워커 요청 본문 한도(100MB)를 넘기 전에 거절
        const size = Number(request.headers.get("Content-Length") ?? 0);
        if (size > 95 * 1024 * 1024) return json({ ok: false, error: "too-large" }, origin, 413);
        const object = await env.FILES.put(key, request.body, {
          httpMetadata: {
            contentType: request.headers.get("Content-Type") ?? "application/octet-stream",
            // 에셋 동기화는 확장자별 캐시 정책을 명시한다 (이미지 30일 등). 수동 업로드는 1일 —
            // 커스텀 도메인은 오브젝트 메타데이터를 그대로 서빙하므로 쓰기 시점에 박아둔다
            cacheControl: request.headers.get("x-cache-control") ?? "public, max-age=86400",
          },
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
