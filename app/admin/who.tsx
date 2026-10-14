"use client";

// 관리 화면의 '누구' 표시 — 내 정보로 로그인한 사람은 게임 계정(서버:UID — 닉네임은 모으지 않는다), 아니면 종전처럼 방문자 코드(앞 8자)
// (사용자 지시 2026-10-14 "방문자 코드 쓰는 모든 곳은 로그인했다면 UID 로, 안 했으면 지금처럼").
// 방문자 ↔ 계정 표(visit_player, docs/supabase-visits.sql)를 처음 한 번 받아 두고 방문자 코드 앞 8자로 찾는다 —
// 제안의 payload.visitor 는 8자, 방문 기록은 전체 uuid 라 앞 8자가 공통 열쇠다.
import { useSyncExternalStore } from "react";

export type Player = { server: string; uid: string };
let byCode: Map<string, Player> | null = null;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();

function load(): void {
  if (loading) return;
  loading = fetch("/api/visits/visit_player?select=visitor,server,uid,at&order=at.desc&limit=10000")
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: { visitor: string; server: string; uid: string }[]) => {
      const m = new Map<string, Player>();
      for (const r of rows) { const k = r.visitor.slice(0, 8); if (!m.has(k)) m.set(k, { server: r.server, uid: r.uid }); }   // 최근 것 먼저
      byCode = m;
    })
    .catch(() => { byCode = new Map(); })
    .finally(() => { subs.forEach((f) => f()); });
}
const subscribe = (f: () => void) => { subs.add(f); load(); return () => { subs.delete(f); }; };

/** 방문자 코드(전체 또는 앞 8자) → 로그인한 게임 계정, 모르면 null */
export function usePlayerOf(visitor: string | null | undefined): Player | null {
  const map = useSyncExternalStore(subscribe, () => byCode, () => null);
  return visitor && map ? map.get(visitor.slice(0, 8)) ?? null : null;
}

/** 표 칸·단추 안에 넣는 '누구' — 계정이면 👤 kr:UID, 아니면 방문자 코드 */
export function Who({ visitor }: { visitor: string | null | undefined }) {
  const p = usePlayerOf(visitor);
  if (p) return <span className="vz-player-inline" title={`방문자 ${visitor?.slice(0, 8) ?? "-"}`}>👤 {p.server}:{p.uid}</span>;
  return <code>{(visitor ?? "—").slice(0, 8)}</code>;
}
