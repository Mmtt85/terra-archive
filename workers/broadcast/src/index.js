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
  const prev = (await env.BCAST.get(KV_KEY, "json")) ?? { broadcasts: [] };
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
  const payload = { updated: new Date().toISOString(), broadcasts };
  await env.BCAST.put(KV_KEY, JSON.stringify(payload));
  return payload;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=300",
  "Content-Type": "application/json; charset=utf-8",
};

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(poll(env));
  },
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    let payload = await env.BCAST.get(KV_KEY, "json");
    if (!payload) payload = await poll(env); // 최초 배포 직후 KV가 비어 있으면 즉석 수집
    return new Response(JSON.stringify(payload), { headers: CORS });
  },
};
