// 테라 아카이브 계정 연동 워커 — Yostar(글로벌 KR/JP/EN) 계정으로 로그인해
// 게임 서버에서 보유 오퍼레이터 목록을 받아온다. 2026-10-06~ 중섭(직영 cn · B服 bili)도 받는다 — 아래 '중국 서버 인증'. 프론트(보유 오퍼 설정 → 가져오기 → 게임 로그인)가
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
  // 중국 서버 (2026-10-06) — 직영(하이퍼그리프)과 B服(비리비리)은 게임 서버가 다르다 (ak-gs-gf / ak-gs-b)
  cn: "https://ak-conf.hypergryph.com/config/prod/official/network_config",
  bili: "https://ak-conf.hypergryph.com/config/prod/b/network_config",
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
const YOSTAR_SERVERS = ["en", "jp", "kr"];
const isYostar = (server) => YOSTAR_SERVERS.includes(server);

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

// ── 점검 판별 (2026-10-14) ─────────────────────────────────────
// 점검 중엔 u8·게임 서버가 로그인을 거절해 'token-expired'·'login-failed' 로 읽혔고, 사이트가 저장된 로그인을 지우며
// "로그인 정보가 만료"라고 띄웠다 (사용자 지적 2026-10-14 한섭 큰 점검). 실패했을 때만 게임의 점검 사전공지
// ({an}/Android/preannouncement.meta.json — 게임이 접속 화면에 띄우는 그 공지)를 보고, 공지의 점검 시간 안이면 'maintenance'.
// 공지는 점검 며칠 전부터 actived 라 시간까지 읽어야 한다 — 시간을 못 읽으면 점검으로 보지 않는다
// (중섭은 2024년 공지가 계속 actived 다). 한섭 "10월 14일 (수), 10:00 ~ 16:00", 일섭 "2026年10月14日(水）10:00～16:00" — 둘 다 UTC+9.
function parseMaintenanceWindow(text) {
  const kst = new Date(Date.now() + 9 * 3600_000);
  const m = text.match(/(?:(\d{4})年)?(\d{1,2})[월月] ?(\d{1,2})[일日][^\d]{0,12}(\d{1,2}):(\d{2}) ?[~～〜\-－] ?(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const year = Number(m[1] ?? kst.getUTCFullYear()), mon = Number(m[2]) - 1, day = Number(m[3]);
  const at = (h, mi) => Date.UTC(year, mon, day, Number(h) - 9, Number(mi));
  const start = at(m[4], m[5]);
  let end = at(m[6], m[7]);
  if (end <= start) end += 86_400_000; // 자정을 넘기는 점검
  return { start, end, label: `${m[2]}/${m[3]} ${m[4].padStart(2, "0")}:${m[5]}~${m[6].padStart(2, "0")}:${m[7]}` };
}
async function maintenanceError(network) {
  try {
    const base = String(network?.an ?? "").replace(/\{0\}\/announcement\.meta\.json$/, "");
    if (!base || base === network.an) return null;
    const meta = await (await fetch(base + "Android/preannouncement.meta.json", { headers: BASE_HEADERS })).json();
    if (!meta?.actived || !meta.preAnnounceUrl) return null;
    const html = await (await fetch(meta.preAnnounceUrl)).text();
    const w = parseMaintenanceWindow(html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " "));
    const now = Date.now();
    // 앞뒤 여유 — 점검 직전 접속 차단·연장 점검
    if (!w || now < w.start - 30 * 60_000 || now > w.end + 2 * 3600_000) return null;
    const error = new HttpError(503, "maintenance");
    error.window = w.label;
    return error;
  } catch {
    return null;
  }
}
/** 게임 서버 단계가 실패하면 점검인지 먼저 본다 — 점검이면 원래 오류 대신 'maintenance' */
async function orMaintenance(promise, network) {
  try { return await promise; }
  catch (error) { throw (await maintenanceError(network)) ?? error; }
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

// ── 중국 서버 인증 (2026-10-06) ─────────────────────────────
// 직영(官服): 하이퍼그리프 통행증 — 계정 토큰 → oauth2 grant(게임 appCode) → u8. 계정 토큰을 얻는 길은 셋:
//   ① 공식 홈페이지 토큰 붙여넣기 — user.hypergryph.com 에 로그인한 브라우저로 web-api.hypergryph.com/account/info/hg 를 열면
//     data.content 가 그 토큰이다 (가챠 기록 내보내기·森空岛 출석 도구들이 쓰는 방식). 한국의 중섭 유저는 중국 휴대폰으로
//     문자를 못 받는 경우가 많아 이게 주 경로다 (사용자 2026-10-06). ② 휴대폰 번호 + 비밀번호 ③ 문자 인증코드.
//   이메일 로그인(token_by_email_password)은 명일방주 통행증 서버엔 없다 (404, 2026-10-06 실측 — 엔드필드 쪽 경로다).
//   나머지 흐름:
//   oauth2 grant(게임 appCode) → u8. 출처: 1w6qn/checkin get_token (2026-09 동작 확인된 코드).
//   실측 오류(2026-10-06, HTTP 200 + status): 100 비밀번호 틀림 · 101 번호/코드 틀림 · 103 번호 형식.
const HG_AS = "https://as.hypergryph.com";
const HG_GAME_APP_CODE = "7318def77669979d";

// u8·account/login 의 deviceId2·3 — 중섭 클라이언트 모양(85+숫자 13자리 · md5 hex). 같은 deviceId 에서 늘 같게 만든다.
function cnDeviceIds(deviceId) {
  const hex = md5Hex("2:" + deviceId);
  const digits = [...md5Hex("3:" + deviceId)].map((c) => parseInt(c, 16) % 10).join("").slice(0, 13);
  return { deviceId2: "85" + digits, deviceId3: hex };
}
const cnDeviceId = () => md5Hex(crypto.randomUUID());

async function hgPost(path, body) {
  const res = await fetch(HG_AS + path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const data = await res.json().catch(() => null);
  if (!data) throw new HttpError(502, `hg ${res.status}`);
  if (data.status !== 0) throw new HttpError(400, hgReason(data));
  return data.data ?? {};
}

function hgReason(data) {
  const msg = String(data?.msg ?? "");
  if (/人机|滑块|安全验证|行为验证|captcha|geetest/i.test(msg)) return "captcha";
  if (/频繁|太快|稍后|上限/.test(msg)) return "too-many";
  if (data?.status === 100 || /密码/.test(msg)) return "bad-password";
  if (data?.status === 101 || /验证码/.test(msg)) return "bad-code";
  if (data?.status === 103 || /手机号/.test(msg)) return "bad-phone";
  if (/不存在|未注册/.test(msg)) return "no-account";
  return `hg-${data?.status ?? "unknown"}`;
}

async function hgSendCode(phone) {
  await hgPost("/general/v1/send_phone_code", { phone, type: 2 });
}

// 문자 코드 또는 비밀번호 → 하이퍼그리프 계정 토큰 (재동기화에 다시 쓸 수 있다)
async function hgToken(phone, { code, password, token }) {
  if (token) return token;   // ① 붙여넣은 토큰 — 검증은 다음 단계(grant)가 한다
  const data = code
    ? await hgPost("/user/auth/v2/token_by_phone_code", { phone, code })
    : await hgPost("/user/auth/v1/token_by_phone_password", { phone, password });
  if (!data.token) throw new HttpError(400, "login-failed");
  return data.token;
}

// QR 로그인 (2026-10-06) — 森空岛(스카이랜드) 앱으로 찍는다. 문자·비밀번호 없이 통행증 토큰을 얻는 길이라
// 한국의 중섭 유저에게 가장 쉽다. gen_scan → (유저가 앱으로 스캔·승인) → scan_status 가 scanCode → token_by_scan_code.
// 출처: FrostN0v0/nonebot-plugin-skland api/login.py. appCode 는 森空岛 것 — 찍을 수 있는 앱이 森空岛뿐이다.
// 실측 2026-10-06: scan_status 는 status 100 未扫码(아직 안 찍음). 그 밖의 대기 상태 번호는 msg 로 가른다.
const SKLAND_APP_CODE = "4ca99fa6b56cc2ba";

async function hgScanStart() {
  const data = await hgPost("/general/v1/gen_scan/login", { appCode: SKLAND_APP_CODE });
  if (!data.scanId || !data.scanUrl) throw new HttpError(502, "scan-failed");
  return { scanId: data.scanId, scanUrl: data.scanUrl };
}

// → { state: "wait" | "scanned" | "expired", hgToken? }
async function hgScanStatus(scanId) {
  const res = await fetch(`${HG_AS}/general/v1/scan_status?scanId=${encodeURIComponent(scanId)}`);
  const data = await res.json().catch(() => null);
  if (!data) throw new HttpError(502, `hg ${res.status}`);
  if (data.status === 0 && data.data?.scanCode) {
    const token = await hgPost("/user/auth/v1/token_by_scan_code", { scanCode: data.data.scanCode });
    if (!token.token) throw new HttpError(400, "login-failed");
    return { state: "done", hgToken: token.token };
  }
  const msg = String(data.msg ?? "");
  if (data.status === 100 || /未扫码/.test(msg)) return { state: "wait" };
  if (/已扫码|待确认|确认/.test(msg)) return { state: "scanned" };
  return { state: "expired", detail: data.status ?? null };
}

// 계정 토큰 → 게임용 1회성 grant 코드
async function hgGrant(token) {
  const data = await hgPost("/user/oauth2/v2/grant", { token, appCode: HG_GAME_APP_CODE, type: 1 })
    .catch((error) => { throw error?.code?.startsWith?.("hg-") ? new HttpError(401, "token-expired") : error; });
  const grant = data.token ?? data.code;
  if (!grant) throw new HttpError(401, "token-expired");
  return grant;
}

// B服: 비리비리 게임 SDK — 아이디 + 비밀번호(RSA PKCS#1 v1.5 로 암호화) → uid + access_key.
// 출처 thesadru/ArkPRTS BilibiliAuth. 문자 인증 로그인은 공개된 선례가 없어 비밀번호만 받는다.
// WebCrypto 에는 RSA PKCS#1 v1.5 '암호화'가 없어 BigInt 로 직접 한다 (공개키 연산이라 비밀값이 없다).
const BILI_SDK = "https://line1-sdk-center-login-sh.biligame.net";
const BILI_BASE = { merchant_id: "328", game_id: "952", server_id: "1178", version: "3" };
const BILI_SALT = "8783abfb533544c59e598cddc933d1bf";

async function biliPost(path, fields) {
  const body = { ...BILI_BASE, timestamp: String(Math.floor(Date.now() / 1000)), ...fields };
  const sorted = Object.keys(body).sort();
  body.sign = md5Hex(sorted.map((k) => body[k]).join("") + BILI_SALT);
  const res = await fetch(BILI_SDK + path, {
    method: "POST",
    body: new URLSearchParams(body).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": BASE_HEADERS["User-Agent"] },
  });
  const data = await res.json().catch(() => null);
  if (!data) throw new HttpError(502, `bili ${res.status}`);
  if (data.code !== 0) throw new HttpError(400, biliReason(data));
  return data;
}

function biliReason(data) {
  const msg = String(data?.message ?? data?.server_message ?? "");
  if (data?.code === 200000 || /验证|captcha|极验|geetest/i.test(msg)) return "captcha";
  if (/频繁|稍后|上限/.test(msg)) return "too-many";
  // 실측 2026-10-06: 500002 PWD_INVALID(틀린 아이디·비밀번호) · 500024 密码不安全,请您修改密码(B站이 비밀번호 변경을 요구)
  if (data?.code === 500024) return "weak-password";
  if (data?.code === 500002 || /密码|PWD/.test(msg)) return "bad-password";
  if (/不存在|未注册/.test(msg)) return "no-account";
  return `bili-${data?.code ?? "unknown"}`;
}

// PEM(SubjectPublicKeyInfo) → { n, e } — DER 를 필요한 만큼만 읽는다
function rsaKeyOf(pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  let at = 0;
  const head = () => {
    const tag = der[at++];
    let len = der[at++];
    if (len & 0x80) { let n = len & 0x7f; len = 0; while (n--) len = len * 256 + der[at++]; }
    return { tag, len };
  };
  head();                                   // SEQUENCE (SPKI)
  const alg = head(); at += alg.len;        // SEQUENCE (알고리즘) 건너뛰기
  head(); at += 1;                          // BIT STRING + 남는 비트 수(0)
  head();                                   // SEQUENCE (RSAPublicKey)
  const int = () => { const { len } = head(); let v = 0n; for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(der[at++]); return { v, len }; };
  const n = int(), e = int();
  return { n: n.v, e: e.v, size: n.v.toString(16).length + 1 >> 1 };
}

function rsaEncryptPkcs1(pem, text) {
  const { n, e, size } = rsaKeyOf(pem);
  const msg = new TextEncoder().encode(text);
  if (msg.length > size - 11) throw new HttpError(400, "bad-password");
  const block = new Uint8Array(size);
  block[1] = 2;
  const pad = block.subarray(2, size - msg.length - 1);
  crypto.getRandomValues(pad);
  for (let i = 0; i < pad.length; i++) while (pad[i] === 0) pad[i] = crypto.getRandomValues(new Uint8Array(1))[0];
  block.set(msg, size - msg.length);
  let m = 0n;
  for (const b of block) m = (m << 8n) | BigInt(b);
  let r = 1n, base = m % n, exp = e;
  while (exp > 0n) { if (exp & 1n) r = (r * base) % n; base = (base * base) % n; exp >>= 1n; }
  const out = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i--) { out[i] = Number(r & 0xffn); r >>= 8n; }
  return btoa(String.fromCharCode(...out));
}

async function biliToken(username, password) {
  const cipher = await biliPost("/api/external/issue/cipher/v3", { cipher_type: "bili_login_rsa" });
  const hex = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  let cut = 0;
  const bdId = [8, 4, 4, 4, 12, 8, 4, 4, 4, 3].map((n) => hex.slice(cut, (cut += n))).join("-");
  const data = await biliPost("/api/external/login/v3", {
    bd_id: bdId, user_id: username, pwd: rsaEncryptPkcs1(cipher.cipher_key, cipher.hash + password),
  });
  if (!data.uid || !data.access_key) throw new HttpError(400, "login-failed");
  return { uid: String(data.uid), token: data.access_key };
}

// cred = 채널(로그인 플랫폼) 쪽 인증값 { uid, token } — 서버마다 u8 에 넘기는 모양이 다르다.
//   요스타: channel 3, { type: 1, uid, token }
//   직영(cn): channel 1, 하이퍼그리프 계정 토큰을 grant 코드로 바꿔 { code, isSuc, type: 2 }
//   B服(bili): channel 2, { uid, access_token } — 출처 thesadru/ArkPRTS BilibiliAuth
async function getU8Token(cred, deviceId, network, server = "kr") {
  let channelId = YOSTAR_CHANNEL_ID;
  let extension = { type: 1, uid: cred.uid, token: cred.token };
  if (server === "cn") {
    channelId = "1";
    extension = { code: await hgGrant(cred.token), isSuc: true, type: 2 };
  } else if (server === "bili") {
    channelId = "2";
    extension = { uid: cred.uid, access_token: cred.token };
  }
  const cnIds = !isYostar(server) ? cnDeviceIds(deviceId) : { deviceId2: "", deviceId3: "" };
  const body = {
    appId: "1",
    platform: 1,
    channelId,
    subChannel: channelId,
    extension: JSON.stringify(extension),
    worldId: channelId,
    deviceId,
    ...cnIds,
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
async function gameLogin(u8, deviceId, network, server = "kr") {
  const version = await getVersionConfig(network);
  const body = {
    platform: 1,
    networkVersion: isYostar(server) ? "1" : "5", // 중섭은 5 (ArkPRTS)
    assetsVersion: version.resVersion,
    clientVersion: version.clientVersion,
    token: u8.token,
    uid: u8.uid,
    deviceId,
    ...(!isYostar(server) ? cnDeviceIds(deviceId) : { deviceId2: "", deviceId3: "" }),
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

// 세션을 연 뒤의 게임 서버 호출 — seqnum 은 요청마다 1씩 오른다 (login=1, syncData=2, …).
// 서버가 응답 헤더로 다음 값을 알려 주면 그걸 따른다.
function gameSession(secret, network) {
  let seq = 1;
  return async (path, body) => {
    seq += 1;
    const res = await fetch(network.gs + path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { ...BASE_HEADERS, secret: secret.secret, uid: secret.uid, seqnum: String(seq) },
    });
    const next = Number(res.headers.get("seqnum"));
    if (Number.isFinite(next) && next > seq) seq = next;
    if (!res.ok) throw new HttpError(502, `${path} ${res.status}`);
    return res.json().catch(() => ({}));
  };
}

async function syncData(call) {
  const data = await call("/account/syncData", { platform: 1 });
  if (data.result !== 0 || !data.user) throw new HttpError(502, "sync-failed");
  return data.user;
}

// 친구 목록 — 실패해도 동기화 전체를 버리지 않는다 (부가 정보라 빈 목록으로 둔다).
// 흐름 출처: thesadru/ArkPRTS client.get_friends (getSortListInfo → getFriendList)
async function friendList(call) {
  try {
    const sorted = await call("/social/getSortListInfo", { type: 1, sortKeyList: ["level", "infoShare"], param: {} });
    const ids = (sorted.result ?? []).map((row) => row?.uid).filter(Boolean);
    if (!ids.length) return [];
    const data = await call("/social/getFriendList", { idList: ids });
    // 친구 정보에 uid 가 빠져 오면 요청한 id 순서로 채운다 (친구 카드 UID 복사, 2026-10-21)
    return Array.isArray(data.friends) ? data.friends.map((f, i) => (f && f.uid == null && data.friends.length === ids.length ? { ...f, uid: ids[i] } : f)) : [];
  } catch {
    return null;
  }
}

// ── 응답 정리 ──────────────────────────────────────────────
// syncData 전체는 수 MB라 그대로 넘기지 않는다. 보유 오퍼 설정에 필요한 것만 추린다.
function roster(user) {
  const chars = [];
  // 형태가 여럿인 오퍼(아미야 — 기본·근위 char_1001_amiya2·의료 char_1037_amiya3)는 계정에 charId 하나로 오고,
  // 형태별 스킬·특화·모듈·스킨이 tmpl[형태 id] 안에 따로 있다 — 바깥 skills·equip 은 비어 있다. 형태마다 오퍼 하나로 펼친다
  // (정예화·레벨·잠재·신뢰는 공유). 종전엔 바깥만 읽어 아미야가 특화·모듈 없음, 근위·의료 아미야는 미보유로 보였다
  // (중섭 기증 데이터에서 발견 2026-10-06 — 한·일·글섭도 같은 구조다).
  const forms = [];
  for (const entry of Object.values(user?.troop?.chars ?? {})) {
    if (!entry?.charId) continue;
    const tmpl = entry.tmpl && typeof entry.tmpl === "object" ? Object.entries(entry.tmpl) : [];
    if (tmpl.length) for (const [id, t] of tmpl) forms.push({ ...entry, charId: id, skills: t?.skills ?? [], equip: t?.equip ?? {}, currentEquip: t?.currentEquip ?? null, skin: t?.skinId ?? null, defaultSkillIndex: t?.defaultSkillIndex ?? -1 });
    else forms.push(entry);
  }
  for (const entry of forms) {
    const modules = {};
    for (const [id, mod] of Object.entries(entry.equip ?? {})) {
      // locked: 1 = 아직 해금 안 한 모듈 — 계정 기록엔 해금 전 모듈도 Lv1 로 같이 온다 (기증 데이터 848개 중 345개).
      // 종전엔 이것까지 'Lv.1 보유'로 보였다 (2026-10-06)
      if (mod && typeof mod.level === "number" && mod.locked !== 1) modules[id] = mod.level;
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
      // 아래 셋은 '내 정보' 화면용 (2026-10-04) — 보유 오퍼 설정은 안 쓴다
      gain: entry.gainTime ?? 0,
      skillIndex: entry.defaultSkillIndex ?? -1,
      equip: entry.currentEquip ?? null,
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

// 통합전략 진행 — 테마별 수집 기록(엔딩 도서·방문객 기록·소장품·레퍼토리 …)을 '얻은 id 목록'으로 줄인다 (2026-10-05).
// 원본 rlv2.outer[테마].collect 의 갈래 이름이 공개 자료로 확정되지 않아 갈래 이름은 그대로 두고, 값이 비었거나
// state 가 0 인 것만 뺀다. 엔딩 달성 기록(record)은 작아서 원본째 싣는다 — 실계정으로 필드를 맞춘 뒤 줄인다.
function rogueDigest(user) {
  const out = {};
  for (const [topic, outer] of Object.entries(user?.rlv2?.outer ?? {})) {
    const collect = {};
    for (const [kind, map] of Object.entries(outer?.collect ?? {})) {
      if (!map || typeof map !== "object") continue;
      // 소장품(relic)은 state 2 = 얻음, 1 = 해금만 됨(못 얻음) — 1 까지 세서 살카즈 350/350(실제 339)으로 나왔다
      // (사용자 지적 2026-10-18, 원본 대조: rogue_4 state2 339·state1 11 / rogue_5 state2 251·state1 78·state0 4)
      const need = kind === "relic" ? 2 : 1;
      const ids = Object.entries(map)
        .filter(([, v]) => v && (typeof v !== "object" || (v.state ?? need) >= need || (need === 1 && v.isNew === 0)))
        .map(([id]) => id);
      if (ids.length) collect[kind] = ids;
    }
    const record = outer?.record ?? null;
    const recordJson = record ? JSON.stringify(record) : "";
    // 방문객(월간 소대 대화)은 팀 단위 id 하나에 장면별 진행이 값으로 들어 있다 — 값째 남긴다 (항목 8개 남짓)
    const chat = {};
    for (const kind of ["chat", "chatV2"]) if (outer?.collect?.[kind]) chat[kind] = outer.collect[kind];
    // 저금(bank — 판이 끝날 때 남은 오리지늄각뿔을 쌓아 두는 곳)과 바깥 성장 트리 진행(buff — 찍은 노드·포인트)도 싣는다
    // (사용자 요청 2026-10-18 "쌓아 둔 각뿔 총 몇 개", 성장 트리 탭). 필드 이름을 실계정으로 맞추려고 원본째 + 바깥 키 목록
    const small = (v) => { const j = v == null ? "" : JSON.stringify(v); return j && j.length < 8000 ? v : (v && typeof v === "object" ? { keys: Object.keys(v) } : null); };
    out[topic] = { collect, chat, record: recordJson.length < 20000 ? record : { keys: Object.keys(record) },
      bank: small(outer?.bank), buff: small(outer?.buff), outerKeys: Object.keys(outer ?? {}) };
  }
  return out;
}

// 게임 '수집' 수에 안 드는 훈장 — 숨김 훈장(medal_hidden_*, 34개)과 금장 훈장(원래 훈장을 금테로 올린 판, id 끝이 세 자리 …5,
// 80개). 실계정 대조: 처음 얻은 시각(fts) 기준 1,358 − 금장 75 − 숨김 31 = 1,252 = 게임 수 (2026-10-05). medal_table 의
// isHidden·originMedal 과 id 모양이 KR·CN 전부 일치한다 — 워커는 표를 안 들고 있어 id 로 가른다.
const countedMedal = (id) => !id.startsWith("medal_hidden_") && !/_\d{2}5$/.test(id);

function storiesDigest(user) {
  const out = {};
  for (const [group, row] of Object.entries(user?.storyreview?.groups ?? {})) {
    const ids = (row?.stories ?? []).map((st) => String(st?.id ?? "")).filter(Boolean)
      .map((id) => (id.startsWith(`${group}_`) ? id.slice(group.length + 1) : `=${id}`));
    if (ids.length) out[group] = ids;
  }
  return out;
}

// '내 정보' 화면용 계정 요약 (2026-10-04). syncData 원본은 수 MB라 화면이 쓰는 것만 추린다.
// 브라우저 localStorage 에 그대로 남으므로 **토큰·기기 id 같은 접근 권한 값은 넣지 않는다.**
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

// 생존연산 '사막 이야기'(SANDBOX_V2 sandbox_1) 보유 수량 — 재료 가방·조리한 음식·제작물 (사용자 요청 2026-10-11).
// 원본 구조는 2026-10-11 실계정 점검으로 확인: bag.material{id:수}, cook.food{f_n:{id,count}}, build.{building,tactical,animal}{id:수}
function sandboxDigest(user) {
  const sb = user?.sandboxPerm?.template?.SANDBOX_V2?.sandbox_1;
  if (!sb) return null;
  const nums = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === "number" && v > 0));
  const food = {};
  for (const f of Object.values(sb.cook?.food ?? {})) if (f?.id && f.count > 0) food[f.id] = (food[f.id] ?? 0) + f.count;
  return { material: nums(sb.bag?.material), food, building: nums(sb.build?.building), tactical: nums(sb.build?.tactical), animal: nums(sb.build?.animal) };
}
// 위수협의 전략(band) — 원본 autochessSeason.band{band_*: 1}. 실계정 41개가 전부 1 이라 '해금(얻음)' 표시로 본다.
// 전략별 클리어 횟수는 계정 원본에 없다 (2026-10-11 점검)
function autochessDigest(user) {
  const a = user?.autochessSeason;
  if (!a) return null;
  return { bands: Object.keys(a.band ?? {}).filter((k) => num(a.band[k]) > 0), training: num(a.trainingModeFin?.mode_training_1) };
}

// 멈춰 둔 진행 상황 — 통합전략 진행 중인 판·보안파견·생존연산 (사용자 요청 2026-10-11 "동기화할 때 진행 중인 록라 상황,
// 보안파견 등 진행하다 멈춘 모든 것"). 원본 구조는 같은 날 실계정 점검으로 확인했다:
//   rlv2.current{player{state,property{level,hp,gold,shield,population},cursor{zone},toEnding},troop{chars},game{theme,mode,modeGrade,start},inventory{relic}}
//   tower.current.status{state,tower,coord,isHard,start,strategy}, sandbox_1.status/main.game
// 게임 중 동기화는 클라를 튕기므로(사용자 확인) '멈춘 상태를 기록'하는 용도다.
function progressDigest(user) {
  const out = {};
  const cur = user?.rlv2?.current;
  const st = cur?.player?.state;
  if (cur && st && st !== "NONE") {
    const p = cur.player?.property ?? {};
    const relics = cur.inventory?.relic ?? {};
    out.rogue = {
      state: st, theme: cur.game?.theme ?? null, mode: cur.game?.mode ?? null, grade: num(cur.game?.modeGrade), start: num(cur.game?.start),
      // cursor.zone 은 지도 구역 키(1000 등)라 그대로 보이면 안 된다 — 그 구역의 순번(index)·id(zone_3)를 꺼낸다 (2026-10-11 '1000층' 지적)
      zone: num(cur.map?.zones?.[cur.player?.cursor?.zone]?.index), zoneId: cur.map?.zones?.[cur.player?.cursor?.zone]?.id ?? null,
      level: num(p.level), hp: num(p.hp?.current), maxHp: num(p.hp?.max), gold: num(p.gold), shield: num(p.shield),
      popCost: num(p.population?.cost), popMax: num(p.population?.max), toEnding: cur.player?.toEnding ?? null,
      relics: Object.values(relics).map((r) => r?.id).filter(Boolean),
      troop: Object.values(cur.troop?.chars ?? {}).map((c) => ({ id: c?.charId, elite: num(c?.evolvePhase), level: num(c?.level) })).filter((c) => c.id),
    };
  }
  const tw = user?.tower?.current?.status;
  if (tw && tw.state && tw.state !== "NONE") {
    out.tower = { state: tw.state, tower: tw.tower ?? null, coord: num(tw.coord), hard: !!tw.isHard, start: num(tw.start), strategy: tw.strategy ?? null };
    // 진행 중인 판의 더 자세한 것 (사용자 요청 2026-10-17 "보안파견 정보 전부") — 직군별 전술 장비, 리더 카드, 모은 오퍼 카드, 함정.
    // ⚠ 진행 중 샘플을 아직 못 봤다(실계정은 NONE) — 카드 칸 모양을 모르니 charId 가 보이는 것만 집는다
    const cur = user.tower.current;
    const tactical = {};
    for (const [job, id] of Object.entries(tw.tactical ?? {})) if (id) tactical[job] = String(id);
    const charOf = (c) => c?.charId ?? (c?.charInstId != null ? user?.troop?.chars?.[String(c.charInstId)]?.charId : null) ?? null;
    out.tower.tactical = tactical;
    out.tower.god = cur?.godCard?.id ? { id: cur.godCard.id, sub: cur.godCard.subGodCardId || null } : null;
    out.tower.cards = Object.values(cur?.cards ?? {}).map((c) => ({ id: charOf(c), type: c?.type ?? null, elite: num(c?.evolvePhase), level: num(c?.level) })).filter((c) => c.id);
    out.tower.traps = (cur?.trap ?? []).map((x) => (typeof x === "string" ? x : x?.id ?? null)).filter(Boolean);
  }
  const sb = user?.sandboxPerm?.template?.SANDBOX_V2?.sandbox_1;
  if (sb?.status && sb.main?.game) {
    // 생존연산 상세 (사용자 요청 2026-10-11 "생존연산도 아주 자세하게") — 분대 슬롯은 오퍼 '인스턴스 번호'라 계정 오퍼 목록으로 charId 를 찾는다.
    // 슬롯 안 키 이름은 아직 실계정으로 못 봤다 — 숫자 칸 중 인스턴스 번호와 맞는 것을 쓴다
    const instToChar = {};
    for (const c of Object.values(user?.troop?.chars ?? {})) if (c?.instId != null) instToChar[String(c.instId)] = c.charId;
    const slotChar = (slot) => {
      if (!slot || typeof slot !== "object") return null;
      for (const v of Object.values(slot)) if ((typeof v === "number" || typeof v === "string") && instToChar[String(v)]) return instToChar[String(v)];
      return null;
    };
    const squads = (sb.troop?.squad ?? []).map((q) => ({ chars: (q?.slots ?? []).map(slotChar).filter(Boolean), tools: (q?.tools ?? []).filter(Boolean) }))
      .filter((q) => q.chars.length || q.tools.length);
    const season = sb.main?.map?.season;
    out.sandbox = {
      state: num(sb.status.state), mode: num(sb.status.mode), challenge: !!sb.status.isChallenge, explore: !!sb.status.exploreMode, rift: !!sb.status.isRift,
      day: num(sb.main.game.day), maxDay: num(sb.main.game.maxDay), ap: num(sb.main.game.ap), maxAp: num(sb.main.game.maxAp), mapId: sb.main.game.mapId ?? null,
      season: season ? { type: num(season.type), remain: num(season.remain), total: num(season.total) } : null,
      zones: Object.fromEntries(Object.entries(sb.main?.map?.zone ?? {}).map(([k, z]) => [k, { state: num(z?.state), weather: num(z?.weather) }])),
      baseLv: num(sb.base?.baseLv), bossKill: Array.isArray(sb.base?.bossKill) ? sb.base.bossKill : [],
      portable: !!sb.base?.portableUnlock, outpost: !!sb.base?.outpostUnlock,
      techToken: num(sb.tech?.token), techUnlock: Array.isArray(sb.tech?.unlock) ? sb.tech.unlock.length : 0,
      drink: num(sb.cook?.drink), squads,
      usedChars: (sb.troop?.usedChar ?? []).map((i) => instToChar[String(i)]).filter(Boolean),
      best: sb.challenge?.best?.day ? num(sb.challenge.best.day) : 0,
    };
  }
  return Object.keys(out).length ? out : null;
}

// 보안파견 기록 (사용자 요청 2026-10-17 "보안파견 정보 전부") — 원본은 같은 날 실계정으로 확인했다:
//   tower.outer.towers{id:{best,hardBest,unlockHard,canSweep}} · tower.season{id,finishTs,missions{id:{value,target,hasRecv}},
//   slots{맵:[{godCardId,squad:[{charInstId,skillIndex,currentEquip}]}]},period{termTs,cur,len}}
// 맵 기록은 [일반 최고 층, 하드 최고 층, 하드 열림 0/1, 소탕 0/1]
function towerDigest(user) {
  const t = user?.tower;
  if (!t?.outer && !t?.season) return null;
  const maps = {};
  for (const [id, r] of Object.entries(t.outer?.towers ?? {})) maps[id] = [num(r?.best), num(r?.hardBest), r?.unlockHard ? 1 : 0, r?.canSweep ? 1 : 0];
  const ss = t.season;
  const charOf = (inst) => user?.troop?.chars?.[String(inst)]?.charId ?? null;
  const slots = {};
  for (const [tower, list] of Object.entries(ss?.slots ?? {})) {
    slots[tower] = (Array.isArray(list) ? list : []).map((sl) => ({
      god: sl?.godCardId ?? null,
      squad: (sl?.squad ?? []).map((m) => ({ id: charOf(m?.charInstId), skill: num(m?.skillIndex), equip: m?.currentEquip ?? null })).filter((m) => m.id),
    }));
  }
  // 얻은 보안파견 훈장 — 맵마다 완료·긴급 보급·히든(재시도 없이) 셋 (사용자 요청 2026-10-17). 처음 얻은 시각(fts)이 있으면 얻은 것
  const medals = Object.entries(user?.medal?.medals ?? {})
    .filter(([id, m]) => /^medal_(tower_complete|hardtower_complete|hidden_tower)_/.test(id) && num(m?.fts) > 0).map(([id]) => id);
  // 평소 고른 직군별 전술 장비 (outer.tactical {직군: 장비 id}) — 보안파견 가이드 표에 '내 선택' 표시 (사용자 요청 2026-10-18)
  const tactical = {};
  for (const [job, id] of Object.entries(t.outer?.tactical ?? {})) if (typeof id === "string" && id) tactical[job] = id;
  return {
    maps,
    medals,
    tactical,
    season: ss?.id ? {
      id: ss.id, finish: num(ss.finishTs),
      missions: Object.fromEntries(Object.entries(ss.missions ?? {}).map(([id, m]) => [id, [num(m?.value), num(m?.target), m?.hasRecv ? 1 : 0]])),
      period: ss.period ? { term: num(ss.period.termTs), cur: num(ss.period.cur), len: num(ss.period.len) } : null,
      slots,
    } : null,
  };
}

function profile(user, friends, shop) {
  const status = user?.status ?? {};
  const troop = user?.troop?.chars ?? {};
  const charOfInst = (inst) => troop[String(inst)]?.charId ?? null;

  // 창고 — inventory(개수) + consumable(유효기간별로 쪼개진 이성 회복제 등) + status 의 화폐
  const inventory = {};
  const add = (id, count) => { if (count > 0) inventory[id] = (inventory[id] ?? 0) + count; };
  for (const [id, count] of Object.entries(user?.inventory ?? {})) add(id, num(count));
  for (const [id, entries] of Object.entries(user?.consumable ?? {})) {
    for (const entry of Object.values(entries ?? {})) add(id, num(entry?.count));
  }
  const CURRENCY = {
    4001: status.gold, 4003: status.diamondShard, 4004: status.hggShard, 4005: status.lggShard,
    7001: status.recruitLicense, 7002: status.instantFinishTicket, 7003: status.gachaTicket,
    7004: status.tenGachaTicket, 6001: status.practiceTicket, SOCIAL_PT: status.socialPoint,
    classic_normal_ticket: status.classicShard,
  };
  for (const [id, count] of Object.entries(CURRENCY)) add(id, num(count));
  // 순오리지늄 — 한·일·글섭은 유상(payDiamond)+무상(freeDiamond). 중섭은 기기별로 따로다(androidDiamond·iosDiamond,
  // 서로 못 쓴다 — 중섭 기증 데이터 2026-10-06). 로그인은 안드로이드로 하므로 4002 는 안드로이드 몫, iOS 몫은 따로 싣는다
  const cnDiamond = typeof status.androidDiamond === "number" || typeof status.iosDiamond === "number";
  add("4002", cnDiamond ? num(status.androidDiamond) : num(status.payDiamond) + num(status.freeDiamond));

  // 작전 — state: 0 해금 · 1 진입 · 2 클리어 · 3 완벽(3성)
  const stages = {};
  for (const [id, stage] of Object.entries(user?.dungeon?.stages ?? {})) stages[id] = num(stage?.state);

  // 섬멸 작전 최고 처치 수
  const campaigns = {};
  for (const [id, rec] of Object.entries(user?.campaignsV2?.instances ?? {})) campaigns[id] = num(rec?.maxKills);

  // 공개모집 슬롯
  const recruit = Object.entries(user?.recruit?.normal?.slots ?? {}).map(([slot, row]) => ({
    slot: Number(slot),
    state: num(row?.state),
    tags: (row?.tags ?? []).map(Number),
    picked: (row?.selectTags ?? []).filter((tag) => tag?.pick).map((tag) => Number(tag.tagId)),
    finish: num(row?.maxFinishTs),
  }));

  // 지원 유닛 (내가 친구들에게 빌려주는 오퍼)
  const assist = (user?.social?.assistCharList ?? []).filter(Boolean).map((row) => ({
    id: charOfInst(row.charInstId), skillIndex: num(row.skillIndex), equip: row.currentEquip ?? null,
  })).filter((row) => row.id);

  // 기반시설 — 방 종류·레벨
  // + 배치된 오퍼와 컨디션 (사용자 요청 2026-10-18 "내 정보에서 인프라 상태 — 피로도 다 단 애들 있나 간단하게").
  //   building.roomSlots[칸].charInstIds(빈 칸 -1) · building.chars[instId].ap (만점 8,640,000 = 24 × 360,000) ·
  //   lastApAddTime(ap 를 마지막으로 잰 시각). 컨디션은 0~24 로 바꿔 싣는다 — 동기화 시각 기준 값이다
  const bchars = user?.building?.chars ?? {};
  const rooms = Object.entries(user?.building?.roomSlots ?? {}).map(([slot, row]) => ({
    slot, room: row?.roomId ?? "", level: num(row?.level),
    ops: (Array.isArray(row?.charInstIds) ? row.charInstIds : []).filter((iid) => iid != null && Number(iid) >= 0).map((iid) => {
      const bc = bchars[String(iid)] ?? {};
      // rate — 게임이 매긴 시간당 컨디션 변화 ×100 (changeScale). 실측 2026-10-19: 제어센터 5명 -75(= -1 + 0.05×5), 숙소 +400~465, 쉬는 방 0
      return { id: bc.charId ?? charOfInst(iid), ap: Number.isFinite(Number(bc.ap)) ? Math.round(Number(bc.ap) / 36000) / 10 : null, at: num(bc.lastApAddTime) || null,
        rate: Number.isFinite(Number(bc.changeScale)) ? Number(bc.changeScale) : null };
    }).filter((o) => o.id),
  })).filter((row) => row.room);

  const friendRows = Array.isArray(friends) ? friends.map((f) => ({
    nickName: f?.nickName ?? "",
    nickNumber: f?.nickNumber ?? "",
    uid: f?.uid != null ? String(f.uid) : null,   // 친구 UID — 내 브라우저로만 간다(서버에 안 남김), 친구 카드 복사용 (2026-10-20)
    level: num(f?.level),
    avatar: f?.avatar?.id ?? f?.avatarId ?? null,
    secretary: f?.secretary ?? null,
    secretarySkin: f?.secretarySkinId ?? null,
    lastOnline: num(f?.lastOnlineTime),
    register: num(f?.registerTs) || null,   // 입사일(초) — 게임이 친구 정보에 주면 (2026-10-20)
    resume: f?.resume ?? "",
    charCnt: num(f?.charCnt),
    progress: f?.mainStageProgress ?? null,
    assist: (f?.assistCharList ?? []).filter(Boolean).map((a) => ({
      id: a.charId, elite: num(a.evolvePhase), level: num(a.level), potential: num(a.potentialRank) + 1,
      skin: a.skinId ?? null, skillIndex: num(a.skillIndex),
      mastery: (a.skills ?? []).map((sk) => num(sk?.specializeLevel)), skill: num(a.mainSkillLvl),
      equip: a.currentEquip ?? null,
      equipLevel: a.currentEquip ? num(a.equip?.[a.currentEquip]?.level) : 0,
    })),
  })) : null;

  return {
    status: {
      level: num(status.level), exp: num(status.exp),
      ap: num(status.ap), maxAp: num(status.maxAp), apTs: num(status.lastApAddTime),
      register: num(status.registerTs), lastOnline: num(status.lastOnlineTs),
      progress: status.mainStageProgress ?? null,
      secretary: status.secretary ?? null, secretarySkin: status.secretarySkinId ?? null,
      avatar: status.avatar?.id ?? status.avatarId ?? null,
      resume: status.resume ?? "",
      friendLimit: num(status.friendNumLimit),
      monthlyEnd: num(status.monthlySubscriptionEndTime),
      ...(cnDiamond ? { iosDiamond: num(status.iosDiamond) } : {}),
    },
    inventory,
    stages,
    campaigns,
    recruit,
    assist,
    rooms,
    skins: Object.keys(user?.skin?.characterSkins ?? {}).length,
    // 보유 스킨 id 목록 — 오퍼 상세·갤러리에 '보유 중' 표시 (사용자 요청 2026-10-11). 기본 복장(#1·#1+·#2)은 원래 다 갖고 있어 뺀다
    // 얻은 시각(skinTs)이 있으면 최근 것부터 — 내 정보 '보유 스킨' 칸 배경이 가장 최근 스킨 (사용자 요청 2026-10-22)
    // 얻은 시각(skinTs)이 없으면 원본 순서(얻은 순)를 뒤집는다 — 원본은 처음 얻은 것부터라 칸에 가장 오래된 스킨이 보였다 (같은 날 지적)
    skinIds: (user?.skin?.skinTs
      ? Object.keys(user.skin.characterSkins ?? {}).sort((a, b) => num(user.skin.skinTs[b]) - num(user.skin.skinTs[a]))
      : Object.keys(user?.skin?.characterSkins ?? {}).reverse()).filter((id) => id.includes("@")),
    // 훈장 — 원본엔 아직 못 얻은 훈장의 진행 기록도 같이 있다(실계정 1,516개). 처음 얻은 시각(fts)이 있는 것만 센다
    // (숨김·금장 훈장은 게임 '수집' 수처럼 뺀다 — countedMedal)
    medals: Object.entries(user?.medal?.medals ?? {}).filter(([id, m]) => countedMedal(id) && num(m?.fts) > 0).length,
    // 얻은 훈장 [id, 처음 얻은 시각(초)] — 내 정보 '훈장' 칸을 누르면 목록 (사용자 요청 2026-10-22). 숨김·금장도 싣는다(화면이 묶음으로 보인다)
    medalList: Object.entries(user?.medal?.medals ?? {}).filter(([, m]) => num(m?.fts) > 0).map(([id, m]) => [id, num(m.fts)]),
    // 전체 훈장 수 — 계정 원본은 훈장마다 기록을 하나씩 갖고 있다(medal_table 1,516개와 같다). '현재 / 최대' 표시용
    medalTotal: Object.keys(user?.medal?.medals ?? {}).filter(countedMedal).length,
    furniture: Object.keys(user?.building?.furniture ?? {}).length,
    // 기반시설 드론 — 동기화 시점 값·상한·마지막 갱신 시각·회복 가속(발전소). 지금 값은 화면이 360초당 1개(×가속)로 어림한다 (사용자 요청 2026-10-12)
    labor: user?.building?.status?.labor ? {
      value: num(user.building.status.labor.value), max: num(user.building.status.labor.maxValue),
      ts: num(user.building.status.labor.lastUpdateTime), speed: Number(user.building.status.labor.buffSpeed) || 0,
      point: Number(user.building.status.labor.processPoint) || 0,
    } : null,
    friends: friendRows,
    // 누적 소비 크레딧 — 구매센터 → 크레딧 → '오퍼레이터 언락'의 숫자. 상점을 열 때 받는 정보(getSocialGoodList)의
    // costSocialPoint 다 (실계정 1,804,976 대조, 2026-10-05)
    creditSpent: typeof shop?.costSocialPoint === "number" ? shop.costSocialPoint : null,
    rogue: rogueDigest(user),
    sandbox: sandboxDigest(user),
    autochess: autochessDigest(user),
    // 진행 중(멈춘) 판 — 통합전략·보안파견·생존연산 (2026-10-11)
    progress: progressDigest(user),
    // 연 스토리 — 게임 '스토리 회상'이 기록한 것(storyreview.groups[스토리].stories[].id). 끝난 이벤트는 작전 기록이 지워져
    // 작전 조건만으론 '한 적 있음'을 알 수 없다 — 갤러리 스포 방지가 쓴다 (2026-10-06). '<스토리>_' 접두는 떼고 싣는다
    stories: storiesDigest(user),
    // 패러독스 시뮬레이션을 깬 오퍼 id (2026-10-17) — troop.addon[오퍼].stage[mem_…] 가 연 적 있는 패러독스다. 깼으면 completeTimes 가
    // 1 이상(실계정 192개 중 state 3 이 190, state 1 이 2 — 둘 다 completeTimes 1). 안 열린 패러독스는 기록 자체가 없다
    tower: towerDigest(user),
    paradox: Object.entries(user?.troop?.addon ?? {})
      .filter(([, row]) => Object.values(row?.stage ?? {}).some((st) => num(st?.completeTimes) > 0 || num(st?.state) >= 3))
      .map(([id]) => id),
  };
}

// ── 정품 인증 (2026-10-05) ──────────────────────────────────
// '이미지로 내보내기' 카드에 QR·인증코드를 찍는다. 동기화한 그 순간의 핵심 숫자를 서버 비밀 키(SIGN_KEY 시크릿)로
// 서명해 두고, QR로 열리는 검증 창이 /verify 로 서명을 확인해 원래 숫자를 보여 준다. 브라우저 저장소를 고치거나
// 이미지를 고치면 숫자가 어긋나 드러난다. 저장하는 것은 없다 — 코드 안에 숫자와 서명이 다 들어 있다.
let SIGN_KEY = null;
// 보유 수에 세지 않는 임시 인원 15명 — app/me-store.ts NOT_COLLECTIBLE 과 같은 목록
const NOT_COLLECTIBLE = new Set([
  "char_504_rguard", "char_505_rcast", "char_506_rmedic", "char_507_rsnipe", "char_514_rdfend",
  "char_600_cpione", "char_601_cguard", "char_605_cmedic", "char_606_csuppo", "char_607_cspec",
  "char_508_aguard", "char_509_acast", "char_510_amedic", "char_511_asnipe", "char_513_apionr",
]);
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function hmac(text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SIGN_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))).slice(0, 16);
}
// ── 사이트 설정 동기화 (2026-10-14) ─────────────────────────
// 게임 UID 는 계정마다 평생 안 바뀐다 — 그걸 열쇠로 사이트 설정(내 정보 맞춤 칸·스토리 읽은 위치…)을 D1(DB, 표 prefs)에 둔다.
// 2026-10-15 KV 에서 옮김 — KV 무료 쓰기 하루 1,000번은 리더기 읽는 사람 열댓 명이면 찼다. D1 무료는 하루 10만 줄
// 쓰기·읽기는 **설정용 표**로만: 로그인·동기화 때 [2, 서버, UID] 를 SIGN_KEY 로 서명해 내준다. 정품 인증 seal 은 공유 이미지 QR 로
// 남에게 보이는 값이라 이 용도로 쓰지 않는다. UID 를 그냥 받으면 누구나 남의 설정을 고칠 수 있다.
let PREFS = null;   // 옛 KV — 옮기기 전에 저장한 계정을 처음 읽을 때 D1 으로 옮겨 오는 데만
let DB = null;
const PREF_MAX = 2_000_000;        // 계정당 설정 전체 상한 (바이트) — 인프라 편성기 상태가 커서 넉넉히 (D1 한 줄 한도도 2MB)
const PREF_KEYS = new Set(["ta:me-layout", "ta:story-pos", "ta-feedback-token", "ta-feedback-extra",
  "ta-theme", "ta-locale", "ta-include-future", "story-reader-prefs", "story-reader-sound", "ta:gallery-spoiler",
  "ta-recruit-prized", "ta:new-seen", "terra-archive-infra-v3", "terra-archive-infra-recycle", "terra-archive-infra-training", "terra-archive-infra-drone", "ta:me-order", "ta:rogue-map-pos", "ta:gacha-plan"]);   // 받아 주는 설정 키 — 사이트 app/cloud-prefs.ts SYNC 와 같게
async function prefTokenOf(server, uid) {
  if (!SIGN_KEY || !uid) return null;
  const body = b64url(new TextEncoder().encode(JSON.stringify([2, server, String(uid)])));
  return `${body}.${b64url(await hmac(body))}`;
}
async function prefOwner(token) {
  if (!SIGN_KEY || typeof token !== "string" || token.length > 300) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = b64url(await hmac(body));
  let diff = want.length ^ sig.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (sig.charCodeAt(i) || 0);
  if (diff !== 0) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return Array.isArray(v) && v[0] === 2 && typeof v[1] === "string" && typeof v[2] === "string" ? `p:${v[1]}:${v[2]}` : null;
  } catch { return null; }
}
// 관리자 — 내 정보로 로그인한 게임 UID 가 이것이면 사이트 관리자 기능을 연다 (사용자 지시 2026-10-14 "내 UID 로 로그인하면 관리자").
// 서명된 설정용 표로만 판정한다(UID 를 그냥 받지 않는다). 통과하면 관리자 키(ADMIN_KEY 시크릿 = .supabase-admin-key)를 내준다 —
// 제안 게시판 답변·위수 협의 통계 같은 쓰기는 지금처럼 Supabase RLS 가 그 키로 확인한다
const ADMIN_UIDS = new Set(["07799010"]);
let ADMIN_KEY = null;
async function adminKeyFor(token) {
  const key = await prefOwner(token);
  const uid = key?.split(":")[2];
  if (!uid || !ADMIN_UIDS.has(uid)) throw new HttpError(403, "not-admin");
  if (!ADMIN_KEY) throw new HttpError(503, "admin-key-missing");
  return { ok: true, key: ADMIN_KEY };
}
// ── 친구 매칭 (2026-10-20) ─────────────────────────────────────────────
// 내 정보에서 '매칭 등록'을 켠 사람만 표 match 에 한 줄. 지원 오퍼(상세)·박사 레벨·친구 수/상한·닉네임#번호를 공개 목록에 싣는다.
// 닉네임은 **등록한 사람만** 여기 저장하고, 등록을 끄면 줄째 즉시 지운다(사용자 결정). 다른 기록에는 닉네임을 두지 않는다.
// 정보는 로그인·동기화 때 워커가 만든다(matchEntry) — 등록 중이면 그 자리에서 줄을 덮어써 지원 오퍼를 바꾸고 동기화만 해도 바로 반영
// (사용자 지시 "매칭 걸어둔 상태에서 동기화해 내 정보가 바뀌면 목록도 자동으로"). 등록할 때는 동기화 응답에 실린 서명된 정보를
// 그대로 돌려받아(위조 불가) 게임에 다시 접속하지 않는다. 2주 넘게 동기화가 없거나 친구 자리가 꽉 차면 목록에서 뺀다
const MATCH_STALE_MS = 14 * 86400_000;
// 내 정보를 90일 동안 동기화하지 않은 등록은 줄째(닉네임 포함) 지운다 (사용자 지시 2026-10-20). 목록을 받을 때 한 시간에 한 번쯤 쓸어 낸다
const MATCH_EXPIRE_MS = 90 * 86400_000;
// 사이트 설정(prefs)도 같은 90일 — 마지막 내 정보 로그인·동기화 시각(seen)이 기준. seen 이 없는 계정(이 기능 전 저장분)은 설정을 마지막으로 고친 시각으로 본다
let matchSweptAt = 0;
async function matchSweep() {
  if (!DB || Date.now() - matchSweptAt < 3600_000) return;
  matchSweptAt = Date.now();
  const cutoff = Date.now() - MATCH_EXPIRE_MS;
  const { results } = await DB.prepare("delete from match where t < ?1 returning server").bind(cutoff).all().catch(() => ({ results: [] }));
  if (results?.length) {
    await noteWrite("delete", results.length);
    for (const r of results) await matchLog("expire", r.server);
  }
  const gone = await DB.prepare(`delete from prefs where owner in (
      select p.owner from prefs p left join seen s on s.owner = p.owner group by p.owner
      having coalesce(max(s.t), max(p.t)) < ?1)`).bind(cutoff).run().catch(() => null);
  if (gone?.meta?.changes) await noteWrite("delete", gone.meta.changes);
  await DB.prepare("delete from seen where t < ?1").bind(cutoff).run().catch(() => null);
}
/** 내 정보 로그인·동기화 시각 — 90일 자동 삭제의 기준 (2026-10-20) */
async function noteSeen(server, uid) {
  if (!DB || !uid) return;
  await DB.prepare("insert into seen (owner, t) values (?1, ?2) on conflict(owner) do update set t = ?2")
    .bind(`p:${server}:${uid}`, Date.now()).run().catch(() => null);
}
function matchEntry(r, prof, server) {
  const byId = new Map((r.chars ?? []).map((c) => [c.id, c]));
  const assist = (prof.assist ?? []).map((a) => {
    const c = byId.get(a.id);
    if (!c) return null;
    const si = a.skillIndex ?? 0;
    return { id: a.id, elite: c.elite, level: c.level, potential: c.potential, skill: c.skill, skillIndex: si,
      mastery: c.mastery?.[si] ?? 0, equip: a.equip ?? null, equipLevel: a.equip ? (c.modules?.[a.equip] ?? 0) : 0 };
  }).filter(Boolean);
  return {
    server, uid: String(r.player?.uid ?? ""), nick: r.player?.nickName ? `${r.player.nickName}#${r.player.nickNumber ?? ""}` : "",
    level: num(prof.status?.level), assist, friends: Array.isArray(prof.friends) ? prof.friends.length : null,
    flimit: num(prof.status?.friendLimit) || null, t: Date.now(),
    // 부관과 그 스킨 — 목록 카드 배경 그림 (사용자 지시 2026-10-20. 게임 명함·로비 배경은 사이트에 그림이 없어 부관으로)
    sec: prof.status?.secretary ?? null, secSkin: prof.status?.secretarySkin ?? null,
    // 상태 문구(게임 프로필 한 줄) — 목록 카드에 (사용자 지시 2026-10-20)
    resume: String(prof.status?.resume ?? "").slice(0, 120),
    register: num(prof.status?.register) || null,   // 입사일(초) — 카드에 (사용자 지시 2026-10-20)
  };
}
async function matchSigned(entry) {
  if (!SIGN_KEY) return null;
  const body = b64url(new TextEncoder().encode(JSON.stringify(entry)));
  return { body, sig: b64url(await hmac(`m.${body}`)) };
}
async function matchUpsert(owner, e, keepCreated = true) {
  await DB.prepare(`insert into match (owner, server, uid, nick, level, assist, friends, flimit, t, created, sec, sec_skin, resume, register) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, ?11, ?12, ?13)
    on conflict(owner) do update set nick = ?4, level = ?5, assist = ?6, friends = ?7, flimit = ?8, t = ?9, sec = ?10, sec_skin = ?11, resume = ?12, register = ?13${keepCreated ? "" : ", created = ?9"}`)
    .bind(owner, e.server, e.uid, e.nick, e.level, JSON.stringify(e.assist), e.friends, e.flimit, e.t, e.sec ?? null, e.secSkin ?? null, e.resume ?? null, e.register ?? null).run();
  await noteWrite("put", 1);
}
/** 동기화 때 — 등록 중인 계정이면 줄을 새 정보로 (등록 안 했으면 아무것도 안 쓴다: update 는 0줄) */
async function matchRefresh(e) {
  if (!DB || !e?.uid) return;
  const owner = `p:${e.server}:${e.uid}`;
  const r = await DB.prepare("update match set nick = ?2, level = ?3, assist = ?4, friends = ?5, flimit = ?6, t = ?7, sec = ?8, sec_skin = ?9, resume = ?10, register = ?11 where owner = ?1")
    .bind(owner, e.nick, e.level, JSON.stringify(e.assist), e.friends, e.flimit, e.t, e.sec ?? null, e.secSkin ?? null, e.resume ?? null, e.register ?? null).run().catch(() => null);
  if (r?.meta?.changes) await noteWrite("put", r.meta.changes);
}
async function matchPut(token, signed) {
  const owner = await prefOwner(token);
  if (!owner) throw new HttpError(401, "pref-token");
  if (!DB) throw new HttpError(503, "pref-store");
  if (!signed || typeof signed.body !== "string" || typeof signed.sig !== "string" || signed.body.length > 8000) throw new HttpError(400, "bad-request");
  if (b64url(await hmac(`m.${signed.body}`)) !== signed.sig) throw new HttpError(400, "bad-sig");
  const e = JSON.parse(new TextDecoder().decode(unb64url(signed.body)));
  if (`p:${e.server}:${e.uid}` !== owner) throw new HttpError(403, "not-owner");
  // 너무 오래된 동기화 정보로는 등록하지 않는다 — 목록에 실리자마자 '2주 넘음'으로 빠진다. 다시 동기화하고 등록하게
  if (!(Date.now() - (e.t ?? 0) < MATCH_STALE_MS)) throw new HttpError(409, "stale-sync");
  const had = await DB.prepare("select 1 from match where owner = ?1").bind(owner).first();
  await matchUpsert(owner, e, false);
  if (!had) await matchLog("put", e.server);
  return { ok: true };
}
/** 관리 사이트 추이용 기록 — 등록(put)·취소(delete)·검색(search, op = 찾은 오퍼 id). 누가 했는지는 남기지 않는다 */
function matchLog(kind, server, op = null) {
  return DB.prepare("insert into match_log (at, kind, server, op) values (?1, ?2, ?3, ?4)")
    .bind(Date.now(), kind, String(server ?? "").slice(0, 8), op ? String(op).slice(0, 40) : null).run().catch(() => null);
}
async function matchSearch(server, ops) {
  if (!DB) throw new HttpError(503, "pref-store");
  if (!validServer(String(server ?? ""))) throw new HttpError(400, "bad-request");
  const list = (Array.isArray(ops) ? ops : []).filter((o) => typeof o === "string" && /^char_\w{1,36}$/.test(o)).slice(0, 3);
  for (const op of list) await matchLog("search", server, op);
  return { ok: true };
}
/** 관리 — 등록 목록 + 하루별 등록·취소·검색 수 + 많이 찾은 오퍼 (최근 60일) */
async function matchAdmin() {
  const { rows } = await matchList("", true);
  const since = Date.now() - 60 * 86400_000;
  const { results: days } = await DB.prepare(`select date(at / 1000, 'unixepoch', '+9 hours') as day, kind, server, count(*) as n
    from match_log where at > ?1 group by 1, 2, 3 order by 1`).bind(since).all();
  const { results: ops } = await DB.prepare(`select op, server, count(*) as n from match_log where kind = 'search' and at > ?1 and op is not null
    group by 1, 2 order by n desc limit 200`).bind(since).all();
  return { ok: true, rows, days, ops };
}
async function matchDelete(token) {
  const owner = await prefOwner(token);
  if (!owner) throw new HttpError(401, "pref-token");
  if (!DB) throw new HttpError(503, "pref-store");
  const r = await DB.prepare("delete from match where owner = ?1").bind(owner).run();   // 닉네임까지 줄째 즉시 삭제
  await noteWrite("delete", r.meta?.changes ?? 0);
  if (r.meta?.changes) await matchLog("delete", owner.split(":")[1]);
  return { ok: true };
}
async function matchMine(token) {
  const owner = await prefOwner(token);
  if (!owner) throw new HttpError(401, "pref-token");
  if (!DB) throw new HttpError(503, "pref-store");
  const row = await DB.prepare("select t, created from match where owner = ?1").bind(owner).first();
  return { ok: true, registered: !!row, t: row?.t ?? null, created: row?.created ?? null };
}
const matchRow = (r) => ({ server: r.server, uid: r.uid, nick: r.nick, level: r.level, assist: JSON.parse(r.assist || "[]"),
  friends: r.friends, flimit: r.flimit, t: r.t, created: r.created, sec: r.sec ?? null, secSkin: r.sec_skin ?? null, resume: r.resume ?? "", register: r.register ?? null });
// 불량 판정(match_flag, match-flag 스킬이 하이쿠로 적는다 — 2026-10-22) — 닉네임(#번호 뗀 이름)이나 한마디가 불량이면 hidden.
// 지우지 않고 사이트가 흐리게 맨 뒤로 보내, 눌러야 보이게 한다(사용자 지시). 표가 없거나 읽기 실패면 아무것도 안 가린다
async function matchHidden() {
  const { results } = await DB.prepare("select field, value from match_flag where bad = 1").all().catch(() => ({ results: [] }));
  return new Set(results.map((f) => `${f.field}\u0000${f.value}`));
}
const isHidden = (flags, r) => flags.has(`nick\u0000${String(r.nick ?? "").replace(/#\d+$/, "").trim()}`) || flags.has(`resume\u0000${String(r.resume ?? "").trim()}`);
async function matchList(server, all = false) {
  if (!DB) throw new HttpError(503, "pref-store");
  await matchSweep();
  const since = Date.now() - MATCH_STALE_MS;
  const sql = all ? "select * from match order by t desc limit 2000"
    // 친구 꽉 찬 줄도 싣는다 — 사이트가 흐리게 맨 뒤로 보낸다 (사용자 지시 2026-10-20, 종전엔 여기서 뺐다)
    : "select * from match where server = ?1 and t > ?2 order by t desc limit 500";
  const { results } = all ? await DB.prepare(sql).all() : await DB.prepare(sql).bind(server, since).all();
  const flags = await matchHidden();
  return { ok: true, rows: results.map((r) => ({ ...matchRow(r), ...(isHidden(flags, r) ? { hidden: true } : {}) })) };
}

// 하루(UTC) 쓰기 기록 — 관리 화면 방문 통계 '설정 저장소 쓰기' (2026-10-15). D1 무료는 하루 쓴 줄 10만이라 줄 수(rows)를 센다
const D1_DAILY_ROWS = 100_000;
function noteWrite(kind, rows) {
  const day = new Date().toISOString().slice(0, 10);
  return DB.prepare(`insert into usage (day, puts, deletes, rows) values (?1, ?2, ?3, ?4)
    on conflict(day) do update set puts = puts + ?2, deletes = deletes + ?3, rows = rows + ?4`)
    .bind(day, kind === "put" ? 1 : 0, kind === "delete" ? 1 : 0, rows + 1).run().catch(() => null);   // 기록이 실패해도 설정 저장은 그대로
}
/** 이 계정의 설정 전부 — { 키: {t, d} }. D1 에 없으면 옛 KV 에서 한 번 옮겨 온다 */
async function loadPrefs(owner) {
  const { results } = await DB.prepare("select k, t, d from prefs where owner = ?1").bind(owner).all();
  const out = {};
  for (const r of results) out[r.k] = { t: r.t, d: r.d };
  if (results.length || !PREFS) return out;
  const old = await PREFS.get(owner, "json").catch(() => null);
  const keys = Object.entries(old?.keys ?? {}).filter(([k, v]) => PREF_KEYS.has(k) && v && Number.isFinite(v.t));
  if (!keys.length) return out;
  await DB.batch(keys.map(([k, v]) => DB.prepare("insert or ignore into prefs (owner, k, t, d) values (?1, ?2, ?3, ?4)").bind(owner, k, v.t, v.d ?? null)));
  await PREFS.delete(owner).catch(() => null);   // 옮겼으면 KV 쪽은 지운다 (KV 지우기도 하루 1,000번 안에 든다 — 한 계정 한 번뿐)
  for (const [k, v] of keys) out[k] = { t: v.t, d: v.d ?? null };
  return out;
}
async function prefsGet(token) {
  const key = await prefOwner(token);
  if (!key) throw new HttpError(401, "pref-token");
  if (!DB) throw new HttpError(503, "pref-store");
  return { ok: true, keys: await loadPrefs(key) };
}
/** 이 계정에 저장된 설정을 통째로 지운다 — 내 정보 '저장된 설정 완전 초기화' (2026-10-14) */
async function prefsDelete(token) {
  const key = await prefOwner(token);
  if (!key) throw new HttpError(401, "pref-token");
  if (!DB) throw new HttpError(503, "pref-store");
  const r = await DB.prepare("delete from prefs where owner = ?1").bind(key).run();
  if (PREFS) await PREFS.delete(key).catch(() => null);   // 옛 KV 에 남은 게 있으면 그것도 (안 지우면 다음 읽기에 되살아난다)
  await noteWrite("delete", r.meta?.changes ?? 0);
  return { ok: true };
}
/** 키마다 더 나중(t)인 것을 남긴다 — 다른 기기에서 동시에 고쳐도 그 키 단위로 최신이 이긴다. 바뀐 키만 그 줄을 쓴다 */
async function prefsPut(token, keys) {
  const key = await prefOwner(token);
  if (!key) throw new HttpError(401, "pref-token");
  if (!DB) throw new HttpError(503, "pref-store");
  if (!keys || typeof keys !== "object") throw new HttpError(400, "bad-request");
  const cur = await loadPrefs(key);
  const changed = [];
  for (const [k, v] of Object.entries(keys)) {
    if (!PREF_KEYS.has(k) || !v || typeof v !== "object" || !Number.isFinite(v.t)) continue;
    if (v.d !== null && typeof v.d !== "string") continue;
    if (!cur[k] || v.t > cur[k].t) { cur[k] = { t: v.t, d: v.d }; changed.push(k); }
  }
  const size = Object.entries(cur).reduce((a, [k, v]) => a + k.length + (v.d?.length ?? 0) + 20, 0);
  if (size > PREF_MAX) throw new HttpError(413, "pref-too-big");
  if (changed.length) {
    await DB.batch(changed.map((k) => DB.prepare(`insert into prefs (owner, k, t, d) values (?1, ?2, ?3, ?4)
      on conflict(owner, k) do update set t = excluded.t, d = excluded.d where excluded.t > prefs.t`).bind(key, k, cur[k].t, cur[k].d)));
    await noteWrite("put", changed.length);
  }
  return { ok: true, keys: cur };
}

// 순서가 곧 형식이다 — 바꾸면 v 를 올린다 (검증 창이 같은 순서로 읽는다)
const SEAL_FIELDS = ["v", "server", "uid", "nick", "nickNo", "level", "register", "at", "owned", "e2", "e2l90", "pot6", "m3", "skins", "medals"];
async function sealOf(rosterResult, prof, server) {
  if (!SIGN_KEY) return null;
  const chars = rosterResult.chars.filter((c) => !NOT_COLLECTIBLE.has(c.id));
  const p = rosterResult.player;
  const values = [1, server, String(p.uid), p.nickName, String(p.nickNumber), num(p.level), num(prof.status?.register), Math.floor(Date.now() / 1000),
    chars.length,
    chars.filter((c) => c.elite >= 2).length,
    chars.filter((c) => c.elite >= 2 && c.level >= 90).length,
    chars.filter((c) => c.potential >= 6).length,
    chars.reduce((n, c) => n + c.mastery.filter((m) => m >= 3).length, 0),
    num(prof.skins), num(prof.medals)];
  const body = b64url(new TextEncoder().encode(JSON.stringify(values)));
  return `${body}.${b64url(await hmac(body))}`;
}
async function verifySeal(code) {
  if (!SIGN_KEY || typeof code !== "string" || code.length > 1000) return { ok: true, valid: false };
  const [body, sig] = code.split(".");
  if (!body || !sig) return { ok: true, valid: false };
  const want = b64url(await hmac(body));
  let diff = want.length ^ sig.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (sig.charCodeAt(i) || 0);
  if (diff !== 0) return { ok: true, valid: false };
  let values;
  try { values = JSON.parse(new TextDecoder().decode(unb64url(body))); } catch { return { ok: true, valid: false }; }
  if (!Array.isArray(values) || values[0] !== 1) return { ok: true, valid: false };
  return { ok: true, valid: true, data: Object.fromEntries(SEAL_FIELDS.map((k, i) => [k, values[i]])) };
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

// 진행 단계를 한 줄씩 흘려보내는 응답 (NDJSON) — {"step":"…"} 줄들 뒤에 마지막 줄이 결과다.
// 로그인이 10초 가까이 걸려 '무엇을 받는 중인지' 보여 달라는 요청 (2026-10-05). body.stream 일 때만.
function streamed(origin, run) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (obj) => writer.write(enc.encode(JSON.stringify(obj) + "\n")).catch(() => {});
  (async () => {
    try {
      await send(await run((step) => { void send({ step }); }));
    } catch (error) {
      await send({ ok: false, error: error?.code ?? "internal", ...(error?.window ? { window: error.window } : {}) });
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  return new Response(readable, { headers: { ...corsHeaders(origin), "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

const validEmail = (value) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
const validCode = (value) => typeof value === "string" && /^[0-9]{4,8}$/.test(value.trim());
const validServer = (value) => SERVERS.includes(value);
const validPhone = (value) => typeof value === "string" && /^1[0-9]{10}$/.test(value);
const validSecret = (value) => typeof value === "string" && value.length >= 1 && value.length <= 64;

// 중섭 계정 샘플 기증 (2026-10-06) — raw 를 달라고 하면 syncData 원본도 함께 돌려준다. 받는 쪽(기증 페이지 /cn-sample — 2026-10-06 마감·삭제, B服 샘플이 다시 필요할 때 쓰려고 워커 쪽은 남긴다)이
// 개발자에게 제안 첨부로 보낸다. 남(친구)의 이름표와 기증자 본인의 식별값은 키 이름으로 지운다 — 값의 '모양'만 남긴다.
const SCRUB_KEYS = new Set(["nickName", "nickNumber", "resume", "uid", "friendUid", "fromUid", "fromName", "userName", "phone"]);
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SCRUB_KEYS.has(k) && (typeof v === "string" || typeof v === "number") ? (typeof v === "number" ? 0 : "") : scrub(v);
  }
  return out;
}
function withRaw(result, fetched, wantRaw) {
  if (!wantRaw) return result;
  const { token, ...rest } = result;   // 기증 응답엔 재접속 토큰을 싣지 않는다
  void token;
  return { ...scrub(rest), raw: scrub({ user: fetched.user, friends: fetched.friends, shop: fetched.shop }) };
}

// 이메일 코드 → 로스터. 토큰도 함께 돌려줘 재동기화에서 코드를 다시 받지 않게 한다.
// step(name) — 진행 단계를 알린다 (스트리밍 응답일 때만 화면에 흘러간다, 2026-10-05)
const noStep = () => {};
// 중섭: cn = { phone, code | password } · bili = { username, password }. step 이름 "yostar" 자리는 "passport" 다.
async function handleLogin({ email, code, server, phone, password, username, hgToken: hgTokenArg, raw }, step = noStep) {
  const deviceId = isYostar(server) ? crypto.randomUUID() : cnDeviceId();
  step("network");
  const network = await getNetworkConfig(server);
  let cred;
  if (server === "cn") {
    step("passport");
    cred = { uid: "hg", token: await hgToken(phone, hgTokenArg ? { token: hgTokenArg } : code ? { code: code.trim() } : { password }) };
  } else if (server === "bili") {
    step("passport");
    cred = await biliToken(username, password);
  } else {
    step("yostar");
    cred = await getYostarToken(email, code.trim(), server, deviceId);
  }
  const fetched = await orMaintenance(fetchUser(cred, deviceId, network, step, server), network);
  step("digest");
  const r = roster(fetched.user), prof = profile(fetched.user, fetched.friends, fetched.shop);
  prof.seal = raw ? null : await sealOf(r, prof, server);
  const me = matchEntry(r, prof, server);
  if (!raw) { await matchRefresh(me); await noteSeen(server, r.player?.uid); }
  return withRaw({ ok: true, ...r, profile: prof, token: { uid: cred.uid, token: cred.token, deviceId }, prefToken: raw ? null : await prefTokenOf(server, r.player?.uid), match: raw ? null : await matchSigned(me) }, fetched, raw);
}

// 저장된 토큰으로 재동기화 (이메일 코드 불필요)
async function handleSync({ token, server, raw }, step = noStep) {
  step("network");
  const network = await getNetworkConfig(server);
  const fetched = await orMaintenance(fetchUser({ uid: token.uid, token: token.token }, token.deviceId, network, step, server), network);
  step("digest");
  const r = roster(fetched.user), prof = profile(fetched.user, fetched.friends, fetched.shop);
  prof.seal = raw ? null : await sealOf(r, prof, server);
  const me = matchEntry(r, prof, server);
  if (!raw) { await matchRefresh(me); await noteSeen(server, r.player?.uid); }   // 매칭 등록 중이면 목록 줄을 방금 받은 정보로 (지원 오퍼를 바꾸고 동기화만 해도 반영)
  return withRaw({ ok: true, ...r, profile: prof, token, prefToken: raw ? null : await prefTokenOf(server, r.player?.uid), match: raw ? null : await matchSigned(me) }, fetched, raw);
}

// 크레딧 상점 — 게임에서 상점을 열 때 받는 정보. '오퍼레이터 언락'의 누적 소비 크레딧이 syncData 에는 없어서
// (실계정 확인 2026-10-05) 여기서 찾는다. 읽기 요청이다. 실패해도 동기화는 계속한다.
async function socialShop(call) {
  try {
    const data = await call("/shop/getSocialGoodList", {});
    if (!data || typeof data !== "object") return null;
    const { playerDataDelta, ...rest } = data;   // 계정 변화분은 크고 필요 없다
    void playerDataDelta;
    return rest;
  } catch {
    return null;
  }
}

// 위수협의 전략별 클리어·보스 처치 수 — syncData 엔 없다(autochessSeason 은 band·trainingModeFin 뿐). 게임이 위수협의 메뉴를
// 열 때 보내는 읽기 요청 /activity/autochessSeason/syncInfo {actId} 에 있을 것으로 보이나, 2026-10-11 시험에서 한섭 시즌 2
// (act2autochess)가 끝나 "activity is not available" 로 거절됐다. 다음 시즌이 열리면 그 actId 로 응답 모양부터 확인할 것.

async function fetchUser(cred, deviceId, network, step = noStep, server = "kr") {
  step("game");
  const u8 = await getU8Token(cred, deviceId, network, server);
  const secret = await gameLogin(u8, deviceId, network, server);
  const call = gameSession(secret, network);
  step("sync");
  const user = await syncData(call);
  step("friends");
  const friends = await friendList(call);
  step("shop");
  const shop = await socialShop(call);
  return { user, friends, shop };
}

export default {
  async fetch(request, env) {
    SIGN_KEY = env?.SIGN_KEY ?? null;
    PREFS = env?.PREFS ?? null;
    DB = env?.DB ?? null;
    ADMIN_KEY = env?.ADMIN_KEY ?? null;
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
    // 친구 매칭 공개 목록 — GET /match/list?server=kr (누구나 읽는다, 등록한 사람만 실린다)
    if (url.pathname === "/match/list" && request.method === "GET") {
      const server = url.searchParams.get("server") ?? "kr";
      if (!validServer(server)) return json({ ok: false, error: "bad-server" }, origin, 400);
      try { return json(await matchList(server), origin); }
      catch (error) { return json({ ok: false, error: error?.code ?? "internal" }, origin, error instanceof HttpError ? error.status : 500); }
    }
    if (url.pathname === "/" && request.method === "GET") {
      return json({ ok: true, service: "terra-archive-account", servers: SERVERS }, origin);
    }

    if (request.method !== "POST") return json({ ok: false, error: "method" }, origin, 405);
    // 정품 인증 확인 — 서버 구분 없이 서명만 본다 (검증 창은 사이트에서만 부른다)
    if (url.pathname === "/verify") {
      if (!ORIGIN_OK(origin)) return json({ ok: false, error: "origin" }, origin, 403);
      const body = await request.json().catch(() => null);
      return json(await verifySeal(body?.code), origin);
    }
    // 관리 화면 'UID 로 설정 보기' (2026-10-14) — admin-api 워커·dev 중계가 관리자 키(x-admin-key)를 붙여 서버끼리 부른다
    if (url.pathname === "/admin/prefs") {
      const given = request.headers.get("x-admin-key") ?? "";
      if (!ADMIN_KEY || given !== ADMIN_KEY) return json({ ok: false, error: "not-admin" }, origin, 403);
      if (!DB) return json({ ok: false, error: "pref-store" }, origin, 503);
      const q = await request.json().catch(() => null);
      // {usage: 14} — 하루(UTC)별 쓰기 기록, 방문 통계의 '설정 저장소 쓰기' (2026-10-15)
      // {match: true} — 친구 매칭 등록 전체 (관리 사이트 '친구 찾기' 탭)
      if (q?.match) return json(await matchAdmin(), origin);
      if (q?.usage) {
        const { results } = await DB.prepare("select day, puts, deletes, rows from usage order by day desc limit ?1").bind(Math.min(60, Number(q.usage) || 14)).all();
        return json({ ok: true, limit: D1_DAILY_ROWS, days: results }, origin);
      }
      const server = String(q?.server ?? ""), uid = String(q?.uid ?? "").replace(/\D/g, "");
      if (!validServer(server) || !uid) return json({ ok: false, error: "bad-request" }, origin, 400);
      const keys = await loadPrefs(`p:${server}:${uid}`);
      const at = Math.max(0, ...Object.values(keys).map((v) => v.t));
      return json({ ok: true, server, uid, found: Object.keys(keys).length > 0, keys, at: at || null }, origin);
    }
    // 브라우저 외부(다른 사이트·스크립트)에서의 호출은 받지 않는다
    if (!ORIGIN_OK(origin)) return json({ ok: false, error: "origin" }, origin, 403);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ ok: false, error: "bad-body" }, origin, 400);
    // 사이트 설정 동기화 — 서버·UID 는 표 안에 있다 (서버 값을 따로 받지 않는다)
    if (url.pathname === "/match/put" || url.pathname === "/match/delete" || url.pathname === "/match/mine" || url.pathname === "/match/search") {
      try {
        if (url.pathname === "/match/put") return json(await matchPut(body.token, body.match), origin);
        if (url.pathname === "/match/delete") return json(await matchDelete(body.token), origin);
        if (url.pathname === "/match/search") return json(await matchSearch(body.server, body.ops), origin);
        return json(await matchMine(body.token), origin);
      } catch (error) {
        return json({ ok: false, error: error?.code ?? "internal" }, origin, error instanceof HttpError ? error.status : 500);
      }
    }
    if (url.pathname === "/prefs/get" || url.pathname === "/prefs/put" || url.pathname === "/prefs/delete" || url.pathname === "/admin/key") {
      try {
        if (url.pathname === "/admin/key") return json(await adminKeyFor(body.token), origin);
        if (url.pathname === "/prefs/delete") return json(await prefsDelete(body.token), origin);
        if (url.pathname === "/prefs/get") await matchSweep();   // 90일 미동기화 정리 — 한 시간에 한 번만 실제로 돈다
        return json(url.pathname === "/prefs/get" ? await prefsGet(body.token) : await prefsPut(body.token, body.keys), origin);
      } catch (error) {
        return json({ ok: false, error: error?.code ?? "internal" }, origin, error instanceof HttpError ? error.status : 500);
      }
    }
    const server = body.server;
    if (!validServer(server)) return json({ ok: false, error: "bad-server" }, origin, 400);

    try {
      if (url.pathname === "/scan-start" && server === "cn") return json({ ok: true, ...(await hgScanStart()) }, origin);
      if (url.pathname === "/scan-status" && server === "cn") {
        if (typeof body.scanId !== "string" || !/^[0-9a-f]{16,64}$/.test(body.scanId)) return json({ ok: false, error: "bad-request" }, origin, 400);
        return json({ ok: true, ...(await hgScanStatus(body.scanId)) }, origin);
      }
      if (url.pathname === "/send-code") {
        if (server === "cn") {
          if (!validPhone(body.phone)) return json({ ok: false, error: "bad-phone" }, origin, 400);
          await hgSendCode(body.phone);
          return json({ ok: true }, origin);
        }
        if (!isYostar(server)) return json({ ok: false, error: "bad-server" }, origin, 400);
        if (!validEmail(body.email)) return json({ ok: false, error: "bad-email" }, origin, 400);
        await sendCode(body.email, server);
        return json({ ok: true }, origin);
      }
      if (url.pathname === "/login") {
        const raw = body.raw === true;
        let args;
        if (server === "cn" && body.hgToken !== undefined) {
          if (typeof body.hgToken !== "string" || !/^[A-Za-z0-9+/=_.-]{16,512}$/.test(body.hgToken)) return json({ ok: false, error: "bad-token" }, origin, 400);
          args = { server, hgToken: body.hgToken, raw };
        } else if (server === "cn") {
          if (!validPhone(body.phone)) return json({ ok: false, error: "bad-phone" }, origin, 400);
          if (body.code ? !validCode(body.code) : !validSecret(body.password)) return json({ ok: false, error: body.code ? "bad-code" : "bad-password" }, origin, 400);
          args = { server, phone: body.phone, code: body.code || null, password: body.password, raw };
        } else if (server === "bili") {
          if (!validSecret(body.username)) return json({ ok: false, error: "bad-request" }, origin, 400);
          if (!validSecret(body.password)) return json({ ok: false, error: "bad-password" }, origin, 400);
          args = { server, username: body.username, password: body.password, raw };
        } else {
          if (!validEmail(body.email)) return json({ ok: false, error: "bad-email" }, origin, 400);
          if (!validCode(body.code)) return json({ ok: false, error: "bad-code" }, origin, 400);
          args = { email: body.email, code: body.code, server, raw };
        }
        if (body.stream) return streamed(origin, (step) => handleLogin(args, step));
        return json(await handleLogin(args), origin);
      }
      if (url.pathname === "/sync") {
        const token = body.token;
        if (!token?.uid || !token?.token || !token?.deviceId) {
          return json({ ok: false, error: "bad-token" }, origin, 400);
        }
        const raw = body.raw === true;
        if (body.stream) return streamed(origin, (step) => handleSync({ token, server, raw }, step));
        return json(await handleSync({ token, server, raw }), origin);
      }
      return json({ ok: false, error: "not-found" }, origin, 404);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      // 오류 문자열에 이메일·코드가 섞이지 않도록 코드만 내보낸다
      return json({ ok: false, error: error?.code ?? "internal", ...(error?.window ? { window: error.window } : {}) }, origin, status);
    }
  },
};
