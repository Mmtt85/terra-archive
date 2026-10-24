"use client";

// 훈수방 공개방 목록 — 내 정보 '훈수방' 단추 (사용자 지시 2026-10-24). 하는 사람이 '공개방'으로 켠 방만 뜬다 (방 워커 /coach-lobby).
// 목록은 내 정보를 동기화한 사람만 본다 — 단추는 보이되 동기화 전이면 안내만 (실제 명일방주 하는 사람만 찾아오게).
// 링크(/w/<코드>)를 받은 사람은 동기화와 상관없이 누구나 들어온다 — 이 제한은 목록에만 있다.
// 지금은 관리자만 단추가 보인다 (BETA, me.tsx).

import { useEffect, useState } from "react";
import { ModalWindow } from "./modal-window";
import { useI18n } from "./i18n";
import { coachLobby, type CoachLobbyRoom } from "./lens/coach";
import { ACCOUNT_SERVERS } from "./account";
import { asset } from "./assets";

export function CoachLobbyModal({ synced, onSync, onClose }: { synced: boolean; onSync: () => void; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [rooms, setRooms] = useState<CoachLobbyRoom[] | null>(null);
  const [err, setErr] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!synced) return;
    let alive = true;
    const load = () => coachLobby().then((r) => { if (alive) { setRooms(r); setErr(false); setNow(Date.now()); } }).catch(() => { if (alive) setErr(true); });
    load();
    const id = window.setInterval(load, 10_000);   // 열어 둔 동안 10초마다
    return () => { alive = false; window.clearInterval(id); };
  }, [synced]);
  const prefix = locale === "ko" ? "" : `/${locale}`;
  return (
    <ModalWindow label={t("게임 화면 같이 보기")} className="operator-modal coach-lobby-modal" onClose={onClose}>
      <p className="coach-lobby-head">{t("지금 공개로 열린 방이에요. 들어가면 하는 사람의 게임 화면을 같이 보며 채팅·추천을 보낼 수 있어요.")}</p>
      {!synced ? (
        <div className="coach-lobby-gate">
          <p>{t("공개방 목록은 내 정보를 동기화한 뒤에 볼 수 있어요.")}</p>
          <button type="button" className="import-action apply" onClick={onSync}>{t("내 정보 동기화하기")}</button>
          <small>{t("링크를 받았다면 동기화 없이 바로 들어갈 수 있어요.")}</small>
        </div>
      ) : err ? (
        <p className="coach-lobby-empty">{t("목록을 불러오지 못했어요 — 잠시 뒤 다시 열어 주세요")}</p>
      ) : rooms == null ? (
        <p className="coach-lobby-empty">{t("불러오는 중…")}</p>
      ) : rooms.length === 0 ? (
        <p className="coach-lobby-empty">{t("지금 열린 공개방이 없어요")}</p>
      ) : (
        <ul className="coach-lobby-list">
          {rooms.map((r) => {
            const full = r.viewers >= r.max;
            const mins = Math.max(0, Math.round((now - r.since) / 60_000));
            return (
              <li key={r.code} className={full ? "full" : ""}>
                <a href={`${prefix}/w/${r.code}`} target="_blank" rel="noopener" aria-disabled={full}
                  onClick={(e) => { if (full) e.preventDefault(); }}>
                  {/* 테마 대표 그림 — 통합전략이면 그 테마 키 비주얼(rogue/kvN), 아니면 빈 칸 (사용자 지시 2026-10-24) */}
                  {/^rogue_\d+$/.test(r.topic ?? "")
                    ? <img className="coach-lobby-kv" src={asset(`/rogue/kv${r.topic!.split("_")[1]}.webp`)} alt="" loading="lazy" />
                    : <span className="coach-lobby-kv none" aria-hidden />}
                  <b>{r.title || r.name || t("하는 사람")}</b>
                  {r.title && <span className="coach-lobby-by">{r.name || t("하는 사람")}</span>}
                  <span>{[r.server ? t(ACCOUNT_SERVERS.find((x) => x.code === r.server)?.label ?? r.server) : "", r.theme, r.floor ? t("{n}층", { n: r.floor }) : "", r.grade != null ? t("난이도 {n}", { n: r.grade }) : ""].filter(Boolean).join(" · ")}</span>
                  <em>{full ? t("꽉 참") : t("보는 사람 {a}/{b}", { a: r.viewers, b: r.max })}<br />{t("공유 {n}분째", { n: mins })}</em>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </ModalWindow>
  );
}
