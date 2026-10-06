#!/usr/bin/env node
// 헤더 '진행중 이벤트' 칩의 **첫 화면용 사본** — 빌드할 때 이벤트 워커 피드를 받아 app/data/kr-running.json 에 굽는다.
// 헤더는 이 사본(빌드 시각 기준)으로 프리렌더부터 칩을 그리고, 뜬 뒤 실제 피드로 갈아 끼운다
// (사용자 2026-10-07 "새로고침 뒤에 칩이 늦게 나타난다" — 종전엔 피드가 올 때까지 칩이 없었다).
// 받기에 실패하면 이전 사본을 그대로 둔다 — 빌드를 멈추지 않는다.
import { existsSync, writeFileSync } from "node:fs";

const OUT = new URL("../app/data/kr-running.json", import.meta.url);
const API = "https://terra-archive-broadcast.nzkonaru.workers.dev/";
try {
  const res = await fetch(API, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json();
  if (!Array.isArray(data.events)) throw new Error("no events");
  // 칩에 필요한 칸만 (카페 url 은 칩이 안 쓴다 — 뜬 뒤 실제 피드가 채운다)
  const events = data.events.map(({ id, name, type, displayType, start, end }) => ({ id, name, type, displayType, start, end }));
  writeFileSync(OUT, JSON.stringify({ events }) + "\n");
  console.log(`snap-events: ${events.length}건`);
} catch (err) {
  if (!existsSync(OUT)) writeFileSync(OUT, '{"events":[]}\n');
  console.warn(`snap-events: 받기 실패(${err?.message ?? err}) — 이전 사본 유지`);
}
