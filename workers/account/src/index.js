// 테라 아카이브 계정 연동 워커 — Yostar(글로벌 KR/JP/EN) 계정으로 로그인해
// 게임 서버에서 보유 오퍼레이터 목록을 받아온다. 프론트(보유 오퍼 설정 → 가져오기 → 게임 로그인)가
// 이 워커를 호출한다.
//
// 왜 워커(백엔드)인가: Yostar SDK/게임 서버는 CORS 헤더를 주지 않고, 요청마다
// 안드로이드 클라이언트 위장 헤더 + MD5/HMAC 서명이 필요해 브라우저에서 직접 호출할 수 없다.
// 같은 방식을 쓰는 선례(Krooster, arkprtserver)도 모두 자체 백엔드를 둔다.
// 인증 흐름 출처: thesadru/ArkPRTS auth.py, neeia/ak-roster yostarAuth.ts
//
// 개인정보: **무상태**다. 이메일·인증코드·토큰을 저장하지도 로그로 남기지도 않는다.
// 응답의 token은 클라이언트가 "코드 없이 다시 동기화"에 쓰는 값이며 브라우저 메모리에만 있다.
//
// 주의(사용자에게 반드시 고지): 데이터를 받으려면 게임 서버에 정식 세션을 새로 열어야 하므로,
// 동기화 순간 게임 클라이언트 세션이 밀려나 다른 기기에서 로그아웃된다. 계정 자체는 무해.
//
// 배포: `bash deploy.sh`

import { md5Hex } from "./md5.js";

const YOSTAR_DOMAIN = {
  en: "https://en-sdk-api.yostarplat.com",
  jp: "https://jp-sdk-api.yostarplat.com",
  kr: "https://jp-sdk-api.yostarplat.com", // KR도 JP SDK 도메인을 쓴다 (PID로 구분)
};
const NETWORK_CONFIG_URL = {
  en: "https://ak-conf.arknights.global/config/prod/official/network_config",
  jp: "https://ak-conf.arknights.jp/config/prod/official/network_config",
  kr: "https://ak-conf.arknights.kr/config/prod/official/network_config",
};
const PID = { en: "US-ARKNIGHTS", jp: "JP-AK", kr: "KR-ARKNIGHTS" };
const LANG = { en: "en", jp: "jp", kr: "ko" };

const YOSTAR_SIGN_SALT = "886c085e4a8d30a703367b120dd8353948405ec2";
const U8_HMAC_KEY = "91240f70c09a08a6bc72af1a5c8d4670";
const YOSTAR_CHANNEL_ID = "3"; // distributor: yostar

const BASE_HEADERS = {
  "Content-Type": "application/json",
  "X-Unity-Version": "2017.4.39f1",
  "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 11; KB2000 Build/RP1A.201005.001)",
  Connection: "Keep-Alive",
};

const SERVERS = Object.keys(NETWORK_CONFIG_URL);

// ── Yostar SDK 서명 ────────────────────────────────────────
// Head를 삽입 순서 그대로 직렬화한 문자열 + 본문 + 소금을 MD5 → 대문자 hex.
// 키 순서가 서명에 그대로 반영되므로 아래 객체 리터럴의 순서를 바꾸지 말 것.
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
    Time: Math.floor(Date.now() / 1000),
  };
  const sign = md5Hex(JSON.stringify(head) + body + YOSTAR_SIGN_SALT).toUpperCase();
  return { ...BASE_HEADERS, Authorization: JSON.stringify({ Head: head, Sign: sign }) };
}

async function hmacSha1Hex(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  let hex = "";
  for (const byte of new Uint8Array(mac)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// u8 서명: 키 이름 정렬 → 폼 인코딩 쿼리 → HMAC-SHA1
async function u8Sign(body) {
  const sorted = {};
  for (const key of Object.keys(body).sort()) sorted[key] = body[key];
  return hmacSha1Hex(U8_HMAC_KEY, new URLSearchParams(sorted).toString());
}

// ── 게임 서버 접속 정보 ─────────────────────────────────────
async function getNetworkConfig(server) {
  const res = await fetch(NETWORK_CONFIG_URL[server], { headers: BASE_HEADERS });
  if (!res.ok) throw new HttpError(502, `network_config ${res.status}`);
  const outer = await res.json();
  const parsed = JSON.parse(outer.content);
  return parsed.configs[parsed.funcVer].network;
}

async function getVersionConfig(network) {
  const res = await fetch(String(network.hv).replace("{0}", "Android"), { headers: BASE_HEADERS });
  if (!res.ok) throw new HttpError(502, `version ${res.status}`);
  return res.json();
}

// ── 인증 3단 ───────────────────────────────────────────────
class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

async function sendCode(email, server) {
  const body = JSON.stringify({ Account: email, Randstr: "", Ticket: "" });
  const res = await fetch(YOSTAR_DOMAIN[server] + "/yostar/send-code", {
    method: "POST", body, headers: yostarHeaders(body, server, crypto.randomUUID()),
  });
  if (!res.ok) throw new HttpError(502, `send-code ${res.status}`);
  const data = await res.json().catch(() => ({}));
  // Yostar는 미등록 이메일·쿨다운·캡차 요구를 200 + Code≠200으로 알린다
  if (data.Code !== 200) throw new HttpError(400, yostarReason(data));
  return true;
}

// Yostar 오류를 프론트가 문구로 바꿀 수 있는 짧은 코드로 정리.
// Yostar는 HTTP 200 + Code로 실패를 알리고 Msg는 중국어다 (실측 2026-07-26):
//   100302 같은 주소로 코드 재요청     → 쿨다운 (직전에 보낸 코드가 아직 유효)
//   100303 获取授权信息失败       → 인증코드 불일치·만료
//   100400 客户端参数有误 / 서명 불일치 → 요청 값 문제
const YOSTAR_CODE = { 100302: "too-many", 100303: "bad-code", 100400: "bad-request" };

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

// 이메일 인증코드 → yostar 토큰(uid + token). 이 토큰은 재동기화에 재사용할 수 있다.
async function getYostarToken(email, code, server, deviceId) {
  const authBody = JSON.stringify({ Account: email, Code: code });
  const authRes = await fetch(YOSTAR_DOMAIN[server] + "/yostar/get-auth", {
    method: "POST", body: authBody, headers: yostarHeaders(authBody, server, deviceId),
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
    UserName: email,
  });
  const loginRes = await fetch(YOSTAR_DOMAIN[server] + "/user/login", {
    method: "POST", body: loginBody, headers: yostarHeaders(loginBody, server, deviceId),
  });
  if (!loginRes.ok) throw new HttpError(502, `user/login ${loginRes.status}`);
  const login = await loginRes.json().catch(() => ({}));
  const info = login.Data?.UserInfo;
  if (login.Code !== 200 || !info) throw new HttpError(400, yostarReason(login));
  return { uid: info.ID, token: info.Token };
}

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
    deviceId3: "",
  };
  body.sign = await u8Sign(body);
  const res = await fetch(network.u8 + "/user/v1/getToken", {
    method: "POST", body: JSON.stringify(body), headers: BASE_HEADERS,
  });
  if (!res.ok) throw new HttpError(502, `u8 ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (data.result !== 0 || !data.token) throw new HttpError(401, "token-expired");
  return data;
}

// 게임 서버 세션을 연다 — **이 시점에 게임 클라이언트가 밀려난다**
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
    deviceId3: "",
  };
  const res = await fetch(network.gs + "/account/login", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { ...BASE_HEADERS, secret: "", seqnum: "1", uid: u8.uid },
  });
  if (!res.ok) throw new HttpError(502, `account/login ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (data.result !== 0 || !data.secret) throw new HttpError(401, "login-failed");
  return data;
}

async function syncData(secret, network) {
  const res = await fetch(network.gs + "/account/syncData", {
    method: "POST",
    body: JSON.stringify({ platform: 1 }),
    headers: { ...BASE_HEADERS, secret: secret.secret, uid: secret.uid, seqnum: "2" },
  });
  if (!res.ok) throw new HttpError(502, `syncData ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (data.result !== 0 || !data.user) throw new HttpError(502, "sync-failed");
  return data.user;
}

// ── 응답 정리 ──────────────────────────────────────────────
// syncData 전체는 수 MB라 그대로 넘기지 않는다. 보유 오퍼 설정에 필요한 것만 추린다.
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
      potential: (entry.potentialRank ?? 0) + 1, // 게임 표기는 잠재 1~6
      skill: entry.mainSkillLvl ?? 1,
      mastery: (entry.skills ?? []).map((s) => s?.specializeLevel ?? 0),
      modules,
      trust: entry.favorPoint ?? 0,
      skin: entry.skin ?? null,
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
      lastOnline: status.lastOnlineTs ?? 0,
    },
    chars,
  };
}

// ── HTTP ───────────────────────────────────────────────────
// 계정 인증을 다루므로 방송 워커처럼 Origin을 열어두지 않는다 — 사이트와 로컬 개발만 허용.
const ORIGIN_OK = (origin) =>
  origin === "https://terra-archive.net" ||
  origin === "https://terra-archive.pages.dev" ||
  /^https:\/\/[a-z0-9-]+\.terra-archive\.pages\.dev$/.test(origin) ||
  /^http:\/\/localhost:\d+$/.test(origin) ||
  /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ORIGIN_OK(origin) ? origin : "https://terra-archive.net",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };
}

const json = (payload, origin, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: corsHeaders(origin) });

const validEmail = (value) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
const validCode = (value) => typeof value === "string" && /^[0-9]{4,8}$/.test(value.trim());
const validServer = (value) => SERVERS.includes(value);

// 이메일 코드 → 로스터. 토큰도 함께 돌려줘 재동기화에서 코드를 다시 받지 않게 한다.
async function handleLogin({ email, code, server }) {
  const deviceId = crypto.randomUUID();
  const network = await getNetworkConfig(server);
  const yostar = await getYostarToken(email, code.trim(), server, deviceId);
  const user = await fetchUser(yostar, deviceId, network);
  return { ok: true, ...roster(user), token: { uid: yostar.uid, token: yostar.token, deviceId } };
}

// 저장된 토큰으로 재동기화 (이메일 코드 불필요)
async function handleSync({ token, server }) {
  const network = await getNetworkConfig(server);
  const user = await fetchUser({ uid: token.uid, token: token.token }, token.deviceId, network);
  return { ok: true, ...roster(user), token };
}

async function fetchUser(yostar, deviceId, network) {
  const u8 = await getU8Token(yostar, deviceId, network);
  const secret = await gameLogin(u8, deviceId, network);
  return syncData(secret, network);
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") ?? "";
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

    // 도달성 점검 — 계정 없이 워커→Yostar 경로가 살아 있는지 확인한다 (/probe?server=kr)
    if (url.pathname === "/probe") {
      const server = url.searchParams.get("server") ?? "kr";
      if (!validServer(server)) return json({ ok: false, error: "bad-server" }, origin, 400);
      try {
        const network = await getNetworkConfig(server);
        const version = await getVersionConfig(network);
        return json({ ok: true, server, gs: network.gs, u8: network.u8, version }, origin);
      } catch (error) {
        return json({ ok: false, error: String(error?.code ?? error?.message ?? error) }, origin, 502);
      }
    }
    if (url.pathname === "/" && request.method === "GET") {
      return json({ ok: true, service: "terra-archive-account", servers: SERVERS }, origin);
    }

    if (request.method !== "POST") return json({ ok: false, error: "method" }, origin, 405);
    // 브라우저 외부(다른 사이트·스크립트)에서의 호출은 받지 않는다
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
      // 오류 문자열에 이메일·코드가 섞이지 않도록 코드만 내보낸다
      return json({ ok: false, error: error?.code ?? "internal" }, origin, status);
    }
  },
};
