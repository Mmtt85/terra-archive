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
    return Array.isArray(data.friends) ? data.friends : [];
  } catch {
    return null;
  }
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
      const ids = Object.entries(map)
        .filter(([, v]) => v && (typeof v !== "object" || (v.state ?? 1) > 0 || v.isNew === 0))
        .map(([id]) => id);
      if (ids.length) collect[kind] = ids;
    }
    const record = outer?.record ?? null;
    const recordJson = record ? JSON.stringify(record) : "";
    // 방문객(월간 소대 대화)은 팀 단위 id 하나에 장면별 진행이 값으로 들어 있다 — 값째 남긴다 (항목 8개 남짓)
    const chat = {};
    for (const kind of ["chat", "chatV2"]) if (outer?.collect?.[kind]) chat[kind] = outer.collect[kind];
    out[topic] = { collect, chat, record: recordJson.length < 20000 ? record : { keys: Object.keys(record) } };
  }
  return out;
}

function medalProbe(medals) {
  const rows = Object.entries(medals);
  const keys = {};
  for (const [, m] of rows) for (const k of Object.keys(m ?? {})) keys[k] = (keys[k] ?? 0) + 1;
  const pos = (k) => rows.filter(([, m]) => num(m?.[k]) > 0).length;
  return {
    keys,
    fts: pos("fts"), rts: pos("rts"),
    ftsOnly: rows.filter(([, m]) => num(m?.fts) > 0 && !(num(m?.rts) > 0)).map(([id]) => id),
    sample: rows.slice(0, 3).map(([id, m]) => ({ id, ...m })),
  };
}

// '내 정보' 화면용 계정 요약 (2026-10-04). syncData 원본은 수 MB라 화면이 쓰는 것만 추린다.
// 브라우저 localStorage 에 그대로 남으므로 **토큰·기기 id 같은 접근 권한 값은 넣지 않는다.**
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

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
  add("4002", num(status.payDiamond) + num(status.freeDiamond));

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
  const rooms = Object.entries(user?.building?.roomSlots ?? {}).map(([slot, row]) => ({
    slot, room: row?.roomId ?? "", level: num(row?.level),
  })).filter((row) => row.room);

  const friendRows = Array.isArray(friends) ? friends.map((f) => ({
    nickName: f?.nickName ?? "",
    nickNumber: f?.nickNumber ?? "",
    level: num(f?.level),
    avatar: f?.avatar?.id ?? f?.avatarId ?? null,
    secretary: f?.secretary ?? null,
    secretarySkin: f?.secretarySkinId ?? null,
    lastOnline: num(f?.lastOnlineTime),
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
    },
    inventory,
    stages,
    campaigns,
    recruit,
    assist,
    rooms,
    skins: Object.keys(user?.skin?.characterSkins ?? {}).length,
    // 훈장 — 원본엔 아직 못 얻은 훈장의 진행 기록도 같이 있다(실계정 1,516개). 처음 얻은 시각(fts)이 있는 것만 센다
    medals: Object.values(user?.medal?.medals ?? {}).filter((m) => num(m?.fts) > 0).length,
    // 전체 훈장 수 — 계정 원본은 훈장마다 기록을 하나씩 갖고 있다(medal_table 1,516개와 같다). '현재 / 최대' 표시용
    medalTotal: Object.keys(user?.medal?.medals ?? {}).length,
    furniture: Object.keys(user?.building?.furniture ?? {}).length,
    friends: friendRows,
    // 누적 소비 크레딧 — 구매센터 → 크레딧 → '오퍼레이터 언락'의 숫자. 상점을 열 때 받는 정보(getSocialGoodList)의
    // costSocialPoint 다 (실계정 1,804,976 대조, 2026-10-05)
    creditSpent: typeof shop?.costSocialPoint === "number" ? shop.costSocialPoint : null,
    rogue: rogueDigest(user),
    // 훈장 수 확인용 — 게임 '수집' 수(실계정 1,252)와 fts 기준(1,358)이 달라 기록 모양을 본다. 확인 뒤 뺀다 (2026-10-05)
    medalProbe: medalProbe(user?.medal?.medals ?? {}),
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
      await send({ ok: false, error: error?.code ?? "internal" });
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  return new Response(readable, { headers: { ...corsHeaders(origin), "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

const validEmail = (value) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
const validCode = (value) => typeof value === "string" && /^[0-9]{4,8}$/.test(value.trim());
const validServer = (value) => SERVERS.includes(value);

// 이메일 코드 → 로스터. 토큰도 함께 돌려줘 재동기화에서 코드를 다시 받지 않게 한다.
// step(name) — 진행 단계를 알린다 (스트리밍 응답일 때만 화면에 흘러간다, 2026-10-05)
const noStep = () => {};
async function handleLogin({ email, code, server }, step = noStep) {
  const deviceId = crypto.randomUUID();
  step("network");
  const network = await getNetworkConfig(server);
  step("yostar");
  const yostar = await getYostarToken(email, code.trim(), server, deviceId);
  const { user, friends, shop } = await fetchUser(yostar, deviceId, network, step);
  step("digest");
  const r = roster(user), prof = profile(user, friends, shop);
  prof.seal = await sealOf(r, prof, server);
  return { ok: true, ...r, profile: prof, token: { uid: yostar.uid, token: yostar.token, deviceId } };
}

// 저장된 토큰으로 재동기화 (이메일 코드 불필요)
async function handleSync({ token, server }, step = noStep) {
  step("network");
  const network = await getNetworkConfig(server);
  const { user, friends, shop } = await fetchUser({ uid: token.uid, token: token.token }, token.deviceId, network, step);
  step("digest");
  const r = roster(user), prof = profile(user, friends, shop);
  prof.seal = await sealOf(r, prof, server);
  return { ok: true, ...r, profile: prof, token };
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

async function fetchUser(yostar, deviceId, network, step = noStep) {
  step("game");
  const u8 = await getU8Token(yostar, deviceId, network);
  const secret = await gameLogin(u8, deviceId, network);
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
    // 정품 인증 확인 — 서버 구분 없이 서명만 본다 (검증 창은 사이트에서만 부른다)
    if (url.pathname === "/verify") {
      if (!ORIGIN_OK(origin)) return json({ ok: false, error: "origin" }, origin, 403);
      const body = await request.json().catch(() => null);
      return json(await verifySeal(body?.code), origin);
    }
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
        const args = { email: body.email, code: body.code, server };
        if (body.stream) return streamed(origin, (step) => handleLogin(args, step));
        return json(await handleLogin(args), origin);
      }
      if (url.pathname === "/sync") {
        const token = body.token;
        if (!token?.uid || !token?.token || !token?.deviceId) {
          return json({ ok: false, error: "bad-token" }, origin, 400);
        }
        if (body.stream) return streamed(origin, (step) => handleSync({ token, server }, step));
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
