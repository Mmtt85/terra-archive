// 명일방주 공식 유튜브 채널에서 예약·라이브 방송을 수집해 KV에 캐시하는 워커.
// 프론트엔드(테라 아카이브 헤더 방송 모달)는 GET / 로 이 데이터를 읽는다.
// 쿼터: search.list 100유닛 × 2종(upcoming/live) × 3채널 = 600 + 업로드 목록 3 + videos 1 ≈ 604/회,
// 6시간마다 → 일 ~2,420 (한도 10,000).
// 지난 방송은 eventType=completed 검색이 아니라 업로드 재생목록 스캔으로 찾는다 —
// KR 채널 생방송이 completed 검색 인덱스에 안 잡히는 사례가 있음 (2026-07 확인).

const CHANNELS = [
  { server: "kr", id: "UCnnbUv4urnbWgb_lgGUfeBw" },
  { server: "jp", id: "UCvoQlzEzqa6vQA8hq9GNNug" },
  { server: "global", id: "UCR0J2NYGuC8epsa1O4DMmXQ" },
];

const KV_KEY = "broadcasts";
const MAX_ENTRIES = 40; // 지난 방송 이력 보존 상한
const DEFAULT_DURATION_MIN = 150;

async function yt(path, params, apiKey) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function poll(env) {
  const apiKey = env.YOUTUBE_API_KEY;
  const videoIds = new Map(); // videoId -> server

  for (const ch of CHANNELS) {
    // 예약·라이브는 search가 가장 확실하게 잡는다
    for (const eventType of ["upcoming", "live"]) {
      const data = await yt("search", {
        part: "id", channelId: ch.id, eventType, type: "video", maxResults: "5",
      }, apiKey);
      for (const item of data.items ?? []) videoIds.set(item.id.videoId, ch.server);
    }
    // 최근 업로드를 스캔해 종료된 생방송(지난 방송 이력)을 찾는다.
    // 생방송 기록이 없는 일반 영상은 아래 videos.list 단계에서 걸러진다.
    const uploads = "UU" + ch.id.slice(2); // 채널 ID → 업로드 재생목록 ID
    const pl = await yt("playlistItems", {
      part: "contentDetails", playlistId: uploads, maxResults: "10",
    }, apiKey);
    for (const item of pl.items ?? []) videoIds.set(item.contentDetails.videoId, ch.server);
  }

  // 이전 저장분도 다시 조회 대상에 포함 — 예약→라이브→종료 전환과 시각 변경을 반영
  const prev = (await env.BCAST.get(KV_KEY, "json")) ?? { broadcasts: [], events: [] };
  const now = Date.now();
  for (const b of prev.broadcasts) {
    const fresh = now - Date.parse(b.start) < 7 * 86_400_000; // 최근 7일 것만 재확인
    if (b.videoId && fresh && !videoIds.has(b.videoId)) videoIds.set(b.videoId, b.server);
  }

  const merged = new Map(prev.broadcasts.filter((b) => b.videoId).map((b) => [b.videoId, b]));
  if (videoIds.size > 0) {
    const data = await yt("videos", {
      part: "snippet,liveStreamingDetails", id: [...videoIds.keys()].join(","),
    }, apiKey);
    for (const v of data.items ?? []) {
      const live = v.liveStreamingDetails ?? {};
      const start = live.actualStartTime ?? live.scheduledStartTime;
      if (!start) continue;
      const durationMin = live.actualEndTime
        ? Math.max(1, Math.round((Date.parse(live.actualEndTime) - Date.parse(start)) / 60_000))
        : DEFAULT_DURATION_MIN;
      merged.set(v.id, {
        server: videoIds.get(v.id) ?? merged.get(v.id)?.server ?? "global",
        title: v.snippet.title,
        start,
        durationMin,
        videoId: v.id,
        url: `https://www.youtube.com/watch?v=${v.id}`,
      });
    }
  }

  const broadcasts = [...merged.values()]
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))
    .slice(0, MAX_ENTRIES);
  // 진행중 게임 이벤트도 같은 payload에 실어 헤더가 fetch 한 번으로 다 받게 한다.
  // 클뜯 불통 시 이전 저장분 유지 — 판정은 클라이언트가 start/end로 하므로 하루쯤 묵어도 된다.
  const events = await fetchEvents().catch(() => prev.events ?? []);
  const payload = { updated: new Date().toISOString(), broadcasts, events };
  await env.BCAST.put(KV_KEY, JSON.stringify(payload));
  return payload;
}

// ── 진행중 게임 이벤트 (KR activity_table) ────────────────────
// KR 서버 이벤트의 정확한 시작·종료 시각을 클뜯 레포에서 뽑는다. 진행중 판정은
// 클라이언트가 Date.now()와 비교하므로, 워커는 "아직 안 끝났고 3주 내 시작"인
// 항목만 실어 payload를 작게 유지한다 (사이드스토리·콜라보·로그인 등 전부 포함).
// 공식 네이버 카페 이벤트 게시판(메뉴 3) 공지를 제목 매칭으로 찾아 url로 붙인다.
const CAFE_CLUB = 29703924; // 명일방주 공식 카페
const CAFE_LIST = `https://apis.naver.com/cafe-web/cafe2/ArticleListV2dot1.json?search.clubid=${CAFE_CLUB}&search.menuid=3&search.perPage=30`;

// 이벤트명 → 공지 제목 매칭 키 ("나른한 기분 콜라보 이벤트" → "나른한 기분"도 시도)
function eventMatchKeys(name) {
  const keys = [name];
  const stripped = name.replace(/(콜라보 이벤트|로그인 이벤트|한정 임무|이벤트)$/, "").trim();
  if (stripped && stripped !== name) keys.push(stripped);
  return keys;
}

async function fetchEventNotices() {
  const res = await fetch(CAFE_LIST, { headers: { Referer: "https://cafe.naver.com" } });
  if (!res.ok) throw new Error(`cafe fetch ${res.status}`);
  const data = await res.json();
  return (data?.message?.result?.articleList ?? []).map((a) => ({ id: a.articleId, subject: a.subject ?? "" }));
}

function noticeUrlFor(name, articles) {
  let best = null;
  for (const art of articles) {
    if (!eventMatchKeys(name).some((k) => k && art.subject.includes(k))) continue;
    // 업데이트 공지 본문을 우선 — PV·캘린더·가이드·축전은 후순위
    let score = art.subject.includes("안내") ? 2 : 1;
    if (/PV|트레일러|캘린더|가이드|축전/.test(art.subject)) score -= 2;
    if (!best || score > best.score) best = { score, id: art.id };
  }
  // 카페 URL 슬러그는 arknightskor — arknights는 다른 카페라 로그인 게이트가 뜬다 (사용자 정정 2026-07)
  return best ? `https://cafe.naver.com/arknightskor/${best.id}` : undefined;
}

async function fetchEvents() {
  const res = await fetch(`${GAMEDATA_BASE}/activity_table.json`);
  if (!res.ok) throw new Error(`activity fetch ${res.status}`);
  const table = await res.json();
  const now = Date.now();
  const soon = now + 21 * 86_400_000;
  const articles = await fetchEventNotices().catch(() => []); // 카페 불통이어도 이벤트는 살린다
  return Object.values(table.basicInfo ?? {})
    .filter((a) => a.startTime > 0 && a.endTime * 1000 > now && a.startTime * 1000 < soon)
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type ?? null,
      displayType: a.displayType ?? null,
      start: new Date(a.startTime * 1000).toISOString(),
      end: new Date(a.endTime * 1000).toISOString(),
      url: noticeUrlFor(a.name, articles),
    }))
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end));
}

// ── 게임 데이터 신규 항목 감지 ─────────────────────────────
// 하루 한 번 클뜯 레포(ArknightsAssets/ArknightsGamedata, kr, master)에서
// 오퍼레이터 목록과 공채 풀 요약만 뽑아 KV에 저장한다. 실제 비교는 /admin 페이지가
// 사이트에 번들된 operators.json/recruit.json과 브라우저에서 수행 — 워커에 기준
// 상태를 두지 않으므로 사이트 갱신과 어긋날 일이 없다.
const GAMEDATA_BASE = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/kr/gamedata/excel";
const DATACHECK_KEY = "datacheck";

const tierToStars = (rarity) =>
  typeof rarity === "number" ? rarity + 1 : Number(String(rarity).replace("TIER_", ""));

// recruitDetail 텍스트에서 공채 풀 오퍼 이름을 뽑는다 — ★줄이 성급, 아래 줄들이 / 구분 이름
function parseRecruitPool(detail) {
  const out = [];
  let rarity = 0;
  for (const rawLine of detail.split("\n")) {
    const line = rawLine.trim();
    if (/^★+$/.test(line)) { rarity = line.length; continue; }
    if (!rarity || !line || line.startsWith("-")) continue;
    const cleaned = line.replace(/<[^>]*>/g, "").trim();
    for (const part of cleaned.split("/")) {
      const name = part.trim();
      if (name) out.push({ name, rarity });
    }
  }
  return out;
}

// 재료 파밍표 신선도 요약 — 펭귄 물류에서 "지금 KR에 열려 있고 표본이 충분한
// 파밍 스테이지·재료(5자리 id)" 세트만 뽑는다. build-farm.py가 farm.json에 기록한
// 빌드 시점 세트(openStages/items)와 /admin이 브라우저에서 비교해, 달라졌으면
// (이벤트 개폐·신규 재료) "파밍표 갱신 필요"를 띄운다. 기준은 build-farm.py와 동일:
// 5자리 숫자 itemId, times ≥ 100, KR 개방, apCost > 0.
const PENGUIN = "https://penguin-stats.io/PenguinStats/api/v2";

async function farmCheck() {
  const [stagesRes, matrixRes] = await Promise.all([
    fetch(`${PENGUIN}/stages?server=KR`),
    fetch(`${PENGUIN}/result/matrix?server=KR&show_closed_zones=false`),
  ]);
  if (!stagesRes.ok || !matrixRes.ok) throw new Error(`penguin fetch ${stagesRes.status}/${matrixRes.status}`);
  const stages = new Map((await stagesRes.json()).map((s) => [s.stageId, s]));
  const { matrix } = await matrixRes.json();
  const stageIds = new Set();
  const itemIds = new Set();
  for (const row of matrix) {
    if (!/^\d{5}$/.test(row.itemId) || row.times < 100 || !(row.quantity > 0)) continue;
    const stage = stages.get(row.stageId);
    if (!stage?.existence?.KR?.exist || !(stage.apCost > 0)) continue;
    stageIds.add(row.stageId);
    itemIds.add(row.itemId);
  }
  return { stages: [...stageIds].sort(), items: [...itemIds].sort() };
}

async function dataCheck(env) {
  const [charRes, gachaRes] = await Promise.all([
    fetch(`${GAMEDATA_BASE}/character_table.json`),
    fetch(`${GAMEDATA_BASE}/gacha_table.json`),
  ]);
  if (!charRes.ok || !gachaRes.ok) throw new Error(`gamedata fetch ${charRes.status}/${gachaRes.status}`);
  const table = await charRes.json();
  const chars = table.chars ?? table;
  const operators = Object.entries(chars)
    .filter(([id]) => id.startsWith("char_"))
    .map(([id, c]) => ({ id, name: c.name, rarity: tierToStars(c.rarity), obtainable: !c.isNotObtainable }));
  const gacha = await gachaRes.json();
  const recruit = parseRecruitPool(gacha.recruitDetail ?? "");
  // 펭귄 불통이어도 오퍼·공채 체크는 살린다 — farm은 null로 두면 admin이 섹션만 생략
  const farm = await farmCheck().catch(() => null);
  const payload = { updated: new Date().toISOString(), operators, recruit, farm };
  await env.BCAST.put(DATACHECK_KEY, JSON.stringify(payload));
  return payload;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=300",
  "Content-Type": "application/json; charset=utf-8",
};

const DATACHECK_CRON = "41 2 * * *"; // 11:41 KST — KR 업데이트(목 10시) 당일 반영

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === DATACHECK_CRON ? dataCheck(env) : poll(env));
  },
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const isDataCheck = new URL(request.url).pathname === "/datacheck";
    const key = isDataCheck ? DATACHECK_KEY : KV_KEY;
    let payload = await env.BCAST.get(key, "json");
    if (!payload) payload = await (isDataCheck ? dataCheck(env) : poll(env)); // KV가 비어 있으면 즉석 수집
    return new Response(JSON.stringify(payload), { headers: CORS });
  },
};
