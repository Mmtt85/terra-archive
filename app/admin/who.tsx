"use client";

// 관리 화면의 '누구' 표시 — 내 정보로 로그인한 사람은 게임 계정(서버:UID — 닉네임은 모으지 않는다), 아니면 종전처럼 방문자 코드(앞 8자)
// (사용자 지시 2026-10-14 "방문자 코드 쓰는 모든 곳은 로그인했다면 UID 로, 안 했으면 지금처럼").
// 방문자 ↔ 계정 표(visit_player, docs/supabase-visits.sql)를 처음 한 번 받아 두고 방문자 코드 앞 8자로 찾는다 —
// 제안의 payload.visitor 는 8자, 방문 기록은 전체 uuid 라 앞 8자가 공통 열쇠다.
import { useState, useSyncExternalStore } from "react";
import { PrefsModal } from "./prefs";

export type Player = { server: string; uid: string };
let byCode: Map<string, Player> | null = null;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();

let loadedAt = 0;
function load(force = false): void {
  if (loading && !force) return;
  if (force && Date.now() - loadedAt < 5_000) return;   // 같은 순간 여러 번 불려도 한 번만
  loadedAt = Date.now();
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
/** 다시 받기 — 방문 통계 새로고침(단추·10초 자동)과 함께. 처음 한 번만 받으면 그 뒤에 로그인한 사람이 계속 방문자 코드로 남았다 (2026-10-14) */
export function refreshPlayers(): void { load(true); }

/** 게임 계정 → 그 계정으로 로그인했던 방문자 코드(앞 8자) 전부 — 저장된 설정 창이 그 사람의 제안을 찾을 때 (2026-10-15) */
export async function visitorsOfPlayer(server: string, uid: string): Promise<string[]> {
  load();
  if (loading) await loading.catch(() => null);
  return [...(byCode ?? new Map<string, Player>()).entries()].filter(([, p]) => p.server === server && p.uid === uid).map(([k]) => k);
}

/** 방문자 코드(전체 또는 앞 8자) → 로그인한 게임 계정, 모르면 null */
export function usePlayerOf(visitor: string | null | undefined): Player | null {
  const map = useSyncExternalStore(subscribe, () => byCode, () => null);
  return visitor && map ? map.get(visitor.slice(0, 8)) ?? null : null;
}

/** 표 칸·단추 안에 넣는 '누구' — 계정이면 👤 kr:UID, 아니면 방문자 코드 */
export function Who({ visitor, plain }: { visitor: string | null | undefined; /** 단추 안에 들어갈 때 — 누르는 기능 없이 글자만 */ plain?: boolean }) {
  const p = usePlayerOf(visitor);
  if (p) return plain
    ? <span className="vz-player-inline" title={`방문자 ${visitor?.slice(0, 8) ?? "-"}`}>👤 {p.server}:{p.uid}</span>
    : <PlayerButton player={p} visitor={visitor} />;
  return <code>{(visitor ?? "—").slice(0, 8)}</code>;
}

/** 로그인한 방문자 — 누르면 그 UID 로 저장된 사이트 설정 창 (사용자 지시 2026-10-15 "방문자 코드를 누르면 UID 설정에서 찾은 내용이 모달로") */
export function PlayerButton({ player, visitor, className = "vz-player-inline" }: { player: Player; visitor?: string | null; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${className} vz-player-btn`} title={`방문자 ${visitor?.slice(0, 8) ?? "-"} — 눌러서 저장된 설정 보기`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}>👤 {player.server}:{player.uid}</button>
      {open && <PrefsModal server={player.server} uid={player.uid} onClose={() => setOpen(false)} />}
    </>
  );
}
