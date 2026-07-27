// 관리자 API 프록시 — Cloudflare Access(구글 SSO) JWT를 검증한 뒤에만
// 관리자 키를 주입해 Supabase REST·업로드 워커(R2)로 중계한다 (2026-07-27).
//
//   GET  /api/me                      로그인 확인 — {email}
//   ANY  /api/supabase/<rest>?query   → SUPABASE_URL/rest/v1/<rest> (+x-admin-key)
//   ANY  /api/files[...]              → UPLOAD_API/files[...] (+x-admin-key)
//
// Access가 admin.terra-archive.net 전체를 덮으므로 여기 도달한 요청은 이미 로그인을
// 통과했지만, 그래도 JWT를 직접 검증한다 — 라우트 우회·설정 실수에 대한 이중 방어.
// ACCESS_TEAM/ACCESS_AUD가 비어 있으면 전부 503 (열린 채 뜨는 사고 방지).

const b64urlToBytes = (s) => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const decodeJson = (part) => JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));

// 팀 공개키(JWKS) 캐시 — 키 회전 대비 1시간마다 다시 받는다
let certsCache = { team: "", keys: null, until: 0 };
async function getKeys(team) {
  if (certsCache.team === team && certsCache.keys && Date.now() < certsCache.until) return certsCache.keys;
  const res = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const { keys } = await res.json();
  certsCache = { team, keys, until: Date.now() + 3600_000 };
  return keys;
}

/** Access JWT 검증 — 통과하면 이메일을, 실패하면 null을 돌려준다 */
async function verifyAccess(request, env) {
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return { error: "not-configured" };
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { error: "no-token" };
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) return { error: "malformed" };

  let header, payload;
  try { header = decodeJson(h); payload = decodeJson(p); } catch { return { error: "malformed" }; }

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com`) return { error: "bad-iss" };
  if (!aud.includes(env.ACCESS_AUD)) return { error: "bad-aud" };
  if (typeof payload.exp !== "number" || payload.exp < now) return { error: "expired" };
  if (payload.email !== env.ALLOWED_EMAIL) return { error: "wrong-email" };

  const jwk = (await getKeys(env.ACCESS_TEAM)).find((k) => k.kid === header.kid);
  if (!jwk) return { error: "unknown-kid" };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`),
  );
  return valid ? { email: payload.email } : { error: "bad-signature" };
}

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

// 중계 시 통과시킬 요청 헤더 — 쿠키·Access 토큰은 상류로 새어나가지 않게 명시 목록만
const PASS_REQ = ["content-type", "prefer", "range", "x-cache-control", "if-none-match"];

async function proxy(request, target, extraHeaders) {
  const headers = new Headers();
  for (const name of PASS_REQ) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  const res = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
  });
  // 응답은 그대로 — Content-Range(count) 같은 헤더를 admin UI가 쓴다
  return new Response(res.body, { status: res.status, headers: res.headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return json({ ok: false, error: "not-found" }, 404);

    const auth = await verifyAccess(request, env);
    if (auth.error === "not-configured") return json({ ok: false, error: "not-configured — Zero Trust 설정 후 ACCESS_TEAM/ACCESS_AUD를 채우세요" }, 503);
    if (!auth.email) return json({ ok: false, error: `unauthorized (${auth.error})` }, 401);

    if (url.pathname === "/api/me") return json({ ok: true, email: auth.email });

    // Supabase REST 중계 — /api/supabase/<rest> → /rest/v1/<rest>
    if (url.pathname.startsWith("/api/supabase/")) {
      const rest = url.pathname.slice("/api/supabase/".length);
      if (!/^[A-Za-z0-9_]+$/.test(rest)) return json({ ok: false, error: "bad-table" }, 400);
      return proxy(request, `${env.SUPABASE_URL}/rest/v1/${rest}${url.search}`, {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        "x-admin-key": env.SUPABASE_ADMIN_KEY ?? "",
      });
    }

    // 업로드 워커(R2) 중계 — /api/files[...] → UPLOAD_API/files[...]
    if (url.pathname === "/api/files" || url.pathname.startsWith("/api/files/")) {
      const rest = url.pathname.slice("/api".length); // "/files..." 그대로
      return proxy(request, `${env.UPLOAD_API}${rest}${url.search}`, {
        "x-admin-key": env.UPLOAD_ADMIN_KEY ?? "",
      });
    }

    return json({ ok: false, error: "not-found" }, 404);
  },
};
