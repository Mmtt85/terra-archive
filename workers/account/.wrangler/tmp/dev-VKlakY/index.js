var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/md5.js
var S = [
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21
];
var K = new Uint32Array(64);
for (let i = 0; i < 64; i += 1) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
function md5Hex(input) {
  const msg = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const size = (msg.length + 8 >> 6) + 1 << 6;
  const buf = new Uint8Array(size);
  buf.set(msg);
  buf[msg.length] = 128;
  const view = new DataView(buf.buffer);
  const bits = msg.length * 8;
  view.setUint32(size - 8, bits >>> 0, true);
  view.setUint32(size - 4, Math.floor(bits / 4294967296), true);
  let a0 = 1732584193, b0 = 4023233417, c0 = 2562383102, d0 = 271733878;
  const M = new Uint32Array(16);
  for (let chunk = 0; chunk < size; chunk += 64) {
    for (let i = 0; i < 16; i += 1) M[i] = view.getUint32(chunk + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i += 1) {
      let f, g;
      if (i < 16) {
        f = B & C | ~B & D;
        g = i;
      } else if (i < 32) {
        f = D & B | ~D & C;
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        f = C ^ (B | ~D);
        g = 7 * i % 16;
      }
      f = f + A + K[i] + M[g] >>> 0;
      A = D;
      D = C;
      C = B;
      B = B + (f << S[i] | f >>> 32 - S[i]) >>> 0;
    }
    a0 = a0 + A >>> 0;
    b0 = b0 + B >>> 0;
    c0 = c0 + C >>> 0;
    d0 = d0 + D >>> 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  let hex = "";
  for (const byte of out) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
__name(md5Hex, "md5Hex");

// src/index.js
var YOSTAR_DOMAIN = {
  en: "https://en-sdk-api.yostarplat.com",
  jp: "https://jp-sdk-api.yostarplat.com",
  kr: "https://jp-sdk-api.yostarplat.com"
  // KR도 JP SDK 도메인을 쓴다 (PID로 구분)
};
var NETWORK_CONFIG_URL = {
  en: "https://ak-conf.arknights.global/config/prod/official/network_config",
  jp: "https://ak-conf.arknights.jp/config/prod/official/network_config",
  kr: "https://ak-conf.arknights.kr/config/prod/official/network_config"
};
var PID = { en: "US-ARKNIGHTS", jp: "JP-AK", kr: "KR-ARKNIGHTS" };
var LANG = { en: "en", jp: "jp", kr: "ko" };
var YOSTAR_SIGN_SALT = "886c085e4a8d30a703367b120dd8353948405ec2";
var U8_HMAC_KEY = "91240f70c09a08a6bc72af1a5c8d4670";
var YOSTAR_CHANNEL_ID = "3";
var BASE_HEADERS = {
  "Content-Type": "application/json",
  "X-Unity-Version": "2017.4.39f1",
  "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 11; KB2000 Build/RP1A.201005.001)",
  Connection: "Keep-Alive"
};
var SERVERS = Object.keys(NETWORK_CONFIG_URL);
function yostarHeaders(body, server, deviceId) {
  const head = {
    PID: PID[server],
    Channel: "googleplay",
    Platform: "android",
    Version: "4.10.0",
    GVersionNo: "2000112",
    GBuildNo: "",
    Lang: LANG[server],
    DeviceID: deviceId,
    DeviceModel: "F9",
    UID: "",
    Token: "",
    Time: Math.floor(Date.now() / 1e3)
  };
  const sign = md5Hex(JSON.stringify(head) + body + YOSTAR_SIGN_SALT).toUpperCase();
  return { ...BASE_HEADERS, Authorization: JSON.stringify({ Head: head, Sign: sign }) };
}
__name(yostarHeaders, "yostarHeaders");
async function hmacSha1Hex(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  let hex = "";
  for (const byte of new Uint8Array(mac)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
__name(hmacSha1Hex, "hmacSha1Hex");
async function u8Sign(body) {
  const sorted = {};
  for (const key of Object.keys(body).sort()) sorted[key] = body[key];
  return hmacSha1Hex(U8_HMAC_KEY, new URLSearchParams(sorted).toString());
}
__name(u8Sign, "u8Sign");
async function getNetworkConfig(server) {
  const res = await fetch(NETWORK_CONFIG_URL[server], { headers: BASE_HEADERS });
  if (!res.ok) throw new HttpError(502, `network_config ${res.status}`);
  const outer = await res.json();
  const parsed = JSON.parse(outer.content);
  return parsed.configs[parsed.funcVer].network;
}
__name(getNetworkConfig, "getNetworkConfig");
async function getVersionConfig(network) {
  const res = await fetch(String(network.hv).replace("{0}", "Android"), { headers: BASE_HEADERS });
  if (!res.ok) throw new HttpError(502, `version ${res.status}`);
  return res.json();
}
__name(getVersionConfig, "getVersionConfig");
var HttpError = class extends Error {
  static {
    __name(this, "HttpError");
  }
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
};
async function sendCode(email, server) {
  const body = JSON.stringify({ Account: email, Randstr: "", Ticket: "" });
  const res = await fetch(YOSTAR_DOMAIN[server] + "/yostar/send-code", {
    method: "POST",
    body,
    headers: yostarHeaders(body, server, crypto.randomUUID())
  });
  if (!res.ok) throw new HttpError(502, `send-code ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (data.Code !== 200) throw new HttpError(400, yostarReason(data));
  return true;
}
__name(sendCode, "sendCode");
var YOSTAR_CODE = { 100303: "bad-code", 100400: "bad-request" };
function yostarReason(data) {
  const known = YOSTAR_CODE[data?.Code];
  if (known) return known;
  const message = String(data?.Message ?? data?.Msg ?? "");
  if (/captcha|geetest|图形|极验/i.test(message)) return "captcha";
  if (/frequen|often|limit|cool|wait|频繁|太快|稍后/i.test(message)) return "too-many";
  if (/not.*regist|不存在|未注册|未登録/i.test(message)) return "no-account";
  if (/code|verif|验证码|認証コード/i.test(message)) return "bad-code";
  return `yostar-${data?.Code ?? "unknown"}`;
}
__name(yostarReason, "yostarReason");
async function getYostarToken(email, code, server, deviceId) {
  const authBody = JSON.stringify({ Account: email, Code: code });
  const authRes = await fetch(YOSTAR_DOMAIN[server] + "/yostar/get-auth", {
    method: "POST",
    body: authBody,
    headers: yostarHeaders(authBody, server, deviceId)
  });
  if (!authRes.ok) throw new HttpError(502, `get-auth ${authRes.status}`);
  const auth = await authRes.json().catch(() => ({}));
  if (auth.Code !== 200 || !auth.Data?.Token) throw new HttpError(400, yostarReason(auth));
  const loginBody = JSON.stringify({
    CheckAccount: 0,
    Geetest: { CaptchaID: null, CaptchaOutput: null, GenTime: null, LotNumber: null, PassToken: null },
    OpenID: email,
    Secret: "",
    Token: auth.Data.Token,
    Type: "yostar",
    UserName: email
  });
  const loginRes = await fetch(YOSTAR_DOMAIN[server] + "/user/login", {
    method: "POST",
    body: loginBody,
    headers: yostarHeaders(loginBody, server, deviceId)
  });
  if (!loginRes.ok) throw new HttpError(502, `user/login ${loginRes.status}`);
  const login = await loginRes.json().catch(() => ({}));
  const info = login.Data?.UserInfo;
  if (login.Code !== 200 || !info) throw new HttpError(400, yostarReason(login));
  return { uid: info.ID, token: info.Token };
}
__name(getYostarToken, "getYostarToken");
async function getU8Token(yostar, deviceId, network) {
  const body = {
    appId: "1",
    platform: 1,
    channelId: YOSTAR_CHANNEL_ID,
    subChannel: YOSTAR_CHANNEL_ID,
    extension: JSON.stringify({ type: 1, uid: yostar.uid, token: yostar.token }),
    worldId: YOSTAR_CHANNEL_ID,
    deviceId,
    deviceId2: "",
    deviceId3: ""
  };
  body.sign = await u8Sign(body);
  const res = await fetch(network.u8 + "/user/v1/getToken", {
    method: "POST",
    body: JSON.stringify(body),
    headers: BASE_HEADERS
  });
  if (!res.ok) throw new HttpError(502, `u8 ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (data.result !== 0 || !data.token) throw new HttpError(401, "token-expired");
  return data;
}
__name(getU8Token, "getU8Token");
async function gameLogin(u8, deviceId, network) {
  const version = await getVersionConfig(network);
  const body = {
    platform: 1,
    networkVersion: "1",
    assetsVersion: version.resVersion,
    clientVersion: version.clientVersion,
    token: u8.token,
    uid: u8.uid,
    deviceId,
    deviceId2: "",
    deviceId3: ""
  };
  const res = await fetch(network.gs + "/account/login", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { ...BASE_HEADERS, secret: "", seqnum: "1", uid: u8.uid }
  });
  if (!res.ok) throw new HttpError(502, `account/login ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (data.result !== 0 || !data.secret) throw new HttpError(401, "login-failed");
  return data;
}
__name(gameLogin, "gameLogin");
async function syncData(secret, network) {
  const res = await fetch(network.gs + "/account/syncData", {
    method: "POST",
    body: JSON.stringify({ platform: 1 }),
    headers: { ...BASE_HEADERS, secret: secret.secret, uid: secret.uid, seqnum: "2" }
  });
  if (!res.ok) throw new HttpError(502, `syncData ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (data.result !== 0 || !data.user) throw new HttpError(502, "sync-failed");
  return data.user;
}
__name(syncData, "syncData");
function roster(user) {
  const chars = [];
  for (const entry of Object.values(user?.troop?.chars ?? {})) {
    if (!entry?.charId) continue;
    const modules = {};
    for (const [id, mod] of Object.entries(entry.equip ?? {})) {
      if (mod && typeof mod.level === "number") modules[id] = mod.level;
    }
    chars.push({
      id: entry.charId,
      elite: entry.evolvePhase ?? 0,
      level: entry.level ?? 1,
      potential: (entry.potentialRank ?? 0) + 1,
      // 게임 표기는 잠재 1~6
      skill: entry.mainSkillLvl ?? 1,
      mastery: (entry.skills ?? []).map((s) => s?.specializeLevel ?? 0),
      modules,
      trust: entry.favorPoint ?? 0,
      skin: entry.skin ?? null
    });
  }
  chars.sort((a, b) => a.id.localeCompare(b.id));
  const status = user?.status ?? {};
  return {
    player: {
      nickName: status.nickName ?? "",
      nickNumber: status.nickNumber ?? "",
      uid: status.uid ?? "",
      level: status.level ?? 0,
      serverName: status.serverName ?? "",
      lastOnline: status.lastOnlineTs ?? 0
    },
    chars
  };
}
__name(roster, "roster");
var ORIGIN_OK = /* @__PURE__ */ __name((origin) => origin === "https://terra-archive.net" || origin === "https://terra-archive.pages.dev" || /^https:\/\/[a-z0-9-]+\.terra-archive\.pages\.dev$/.test(origin) || /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "ORIGIN_OK");
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ORIGIN_OK(origin) ? origin : "https://terra-archive.net",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  };
}
__name(corsHeaders, "corsHeaders");
var json = /* @__PURE__ */ __name((payload, origin, status = 200) => new Response(JSON.stringify(payload), { status, headers: corsHeaders(origin) }), "json");
var validEmail = /* @__PURE__ */ __name((value) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254, "validEmail");
var validCode = /* @__PURE__ */ __name((value) => typeof value === "string" && /^[0-9]{4,8}$/.test(value.trim()), "validCode");
var validServer = /* @__PURE__ */ __name((value) => SERVERS.includes(value), "validServer");
async function handleLogin({ email, code, server }) {
  const deviceId = crypto.randomUUID();
  const network = await getNetworkConfig(server);
  const yostar = await getYostarToken(email, code.trim(), server, deviceId);
  const user = await fetchUser(yostar, deviceId, network);
  return { ok: true, ...roster(user), token: { uid: yostar.uid, token: yostar.token, deviceId } };
}
__name(handleLogin, "handleLogin");
async function handleSync({ token, server }) {
  const network = await getNetworkConfig(server);
  const user = await fetchUser({ uid: token.uid, token: token.token }, token.deviceId, network);
  return { ok: true, ...roster(user), token };
}
__name(handleSync, "handleSync");
async function fetchUser(yostar, deviceId, network) {
  const u8 = await getU8Token(yostar, deviceId, network);
  const secret = await gameLogin(u8, deviceId, network);
  return syncData(secret, network);
}
__name(fetchUser, "fetchUser");
var src_default = {
  async fetch(request) {
    const origin = request.headers.get("Origin") ?? "";
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
    if (url.pathname === "/probe") {
      const server2 = url.searchParams.get("server") ?? "kr";
      if (!validServer(server2)) return json({ ok: false, error: "bad-server" }, origin, 400);
      try {
        const network = await getNetworkConfig(server2);
        const version = await getVersionConfig(network);
        return json({ ok: true, server: server2, gs: network.gs, u8: network.u8, version }, origin);
      } catch (error) {
        return json({ ok: false, error: String(error?.code ?? error?.message ?? error) }, origin, 502);
      }
    }
    if (url.pathname === "/" && request.method === "GET") {
      return json({ ok: true, service: "terra-archive-account", servers: SERVERS }, origin);
    }
    if (request.method !== "POST") return json({ ok: false, error: "method" }, origin, 405);
    if (!ORIGIN_OK(origin)) return json({ ok: false, error: "origin" }, origin, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ ok: false, error: "bad-body" }, origin, 400);
    const server = body.server;
    if (!validServer(server)) return json({ ok: false, error: "bad-server" }, origin, 400);
    try {
      if (url.pathname === "/send-code") {
        if (!validEmail(body.email)) return json({ ok: false, error: "bad-email" }, origin, 400);
        await sendCode(body.email, server);
        return json({ ok: true }, origin);
      }
      if (url.pathname === "/login") {
        if (!validEmail(body.email)) return json({ ok: false, error: "bad-email" }, origin, 400);
        if (!validCode(body.code)) return json({ ok: false, error: "bad-code" }, origin, 400);
        return json(await handleLogin({ email: body.email, code: body.code, server }), origin);
      }
      if (url.pathname === "/sync") {
        const token = body.token;
        if (!token?.uid || !token?.token || !token?.deviceId) {
          return json({ ok: false, error: "bad-token" }, origin, 400);
        }
        return json(await handleSync({ token, server }), origin);
      }
      return json({ ok: false, error: "not-found" }, origin, 404);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      return json({ ok: false, error: error?.code ?? "internal" }, origin, status);
    }
  }
};

// ../../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-aMkdCH/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-aMkdCH/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
