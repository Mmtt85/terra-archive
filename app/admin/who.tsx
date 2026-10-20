"use client";

// 관리 화면의 '누구' 표시 — 내 정보로 로그인한 사람은 게임 계정(서버:UID — 닉네임은 모으지 않는다), 아니면 종전처럼 방문자 코드(앞 8자)
// (사용자 지시 2026-10-14 "방문자 코드 쓰는 모든 곳은 로그인했다면 UID 로, 안 했으면 지금처럼").
// 방문자 ↔ 계정 표(visit_player, docs/supabase-visits.sql)를 처음 한 번 받아 두고 방문자 코드 앞 8자로 찾는다 —
// 제안의 payload.visitor 는 8자, 방문 기록은 전체 uuid 라 앞 8자가 공통 열쇠다.
import { useState, useSyncExternalStore } from "react";
import { PrefsModal } from "./prefs";
import { OWNER_UIDS } from "../visit-track";

/** 운영자 본인 계정은 UID 옆에 '관리자' (사용자 지시 2026-10-19) */
const label = (p: Player) => (OWNER_UIDS.has(p.uid) ? `관리자 · ${p.server}:${p.uid}` : `${p.server}:${p.uid}`);

export type Player = { server: string; uid: string };
let byCode: Map<string, Player> | null = null;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();

let loadedAt = 0;
function load(force = false): void {
  if (loading && !force) return;
  if (force && Date.now() - loadedAt < 5_000) return;   // 같은 순간 여러 번 불려도 한 번만
  loadedAt = Date.now();
  // ⚠ DB(PostgREST)는 한 번에 최대 1,000줄만 준다 — limit=10000 을 줘도 1,000에서 잘린다. 표가 1,000줄을 넘긴 날(2026-10-20,
  // 1,135줄) 가장 옛 계정들이 통째로 빠져 내 정보 동기화에 'UID 모름'이 갑자기 늘었다. 1,000줄씩 끝까지 나눠 받는다
  type Row = { visitor: string; server: string; uid: string };
  const PAGE = 1000;
  const pageAt = async (from: number): Promise<Row[]> => {
    const r = await fetch(`/api/visits/visit_player?select=visitor,server,uid,at&order=at.desc,visitor.asc&limit=${PAGE}&offset=${from}`);
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  };
  const all = async (): Promise<Row[]> => {
    const out: Row[] = [];
    for (let from = 0; from < 50 * PAGE; from += PAGE) {
      const rows = await pageAt(from);
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  };
  loading = all()
    .then((rows) => {
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

/** 방문자 코드(앞 8자) → 게임 계정 표 전체 — 받기 전엔 null. 내 정보 동기화 표를 계정 단위로 합칠 때 (2026-10-15) */
export function usePlayerMap(): Map<string, Player> | null {
  return useSyncExternalStore(subscribe, () => byCode, () => null);
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
    ? <span className="vz-player-inline" title={`방문자 ${visitor?.slice(0, 8) ?? "-"}`}>👤 {label(p)}</span>
    : <PlayerButton player={p} visitor={visitor} />;
  return <code>{(visitor ?? "—").slice(0, 8)}</code>;
}

/** 로그인한 방문자 — 누르면 그 UID 로 저장된 사이트 설정 창 (사용자 지시 2026-10-15 "방문자 코드를 누르면 UID 설정에서 찾은 내용이 모달로") */
export function PlayerButton({ player, visitor, className = "vz-player-inline" }: { player: Player; visitor?: string | null; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${className} vz-player-btn`} title={`방문자 ${visitor?.slice(0, 8) ?? "-"} — 눌러서 저장된 설정 보기`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}>👤 {label(player)}</button>
      {open && <PrefsModal server={player.server} uid={player.uid} onClose={() => setOpen(false)} />}
    </>
  );
}
