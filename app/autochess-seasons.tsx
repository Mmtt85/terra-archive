"use client";

// 위수 협의 시즌 전환 (사용자 요청 2026-09-05 "예전 맹약 어땠는지 궁금해하는 사람들도 많더라").
//
// 로케일 래퍼 셋이 이걸 공유한다 — 지난 시즌 데이터는 **언어별 파일**이라 어느 파일을 물지는
// 래퍼가 정하고(past), 갈아타는 절차는 여기 한 곳에만 둔다.
//
// ⚠ 시즌이 바뀌면 `key` 로 가이드를 **통째로 새로 마운트**한다. 편성 판·필터·열린 모달이
//   전부 그 시즌의 기물·맹약 id 를 들고 있어서, 상태를 이어 주면 시즌1 화면에 시즌2 기물이
//   남는다. 시즌1↔2 는 같은 id 인데 수치가 갈아엎어져 있어(밴드 29/29 · 맹약 18/18 ·
//   기물 195/200 실측) 섞이면 틀린 수치가 그대로 보인다.
import { useState } from "react";
import AutochessGuide, { type AcSeason, type AutochessDoc } from "./autochess";
import seasonList from "./data/autochess-seasons.json";

/** 지난 시즌 데이터 로더 — `{ 1: () => import("./data/autochess-s1.json") }` 꼴 */
export type AcPastMap = Record<number, () => Promise<unknown>>;

export default function AutochessSeasons({ cur, past, onShowOperator }: {
  /** 최신 시즌 — 정적 임포트라 첫 페인트·프리렌더가 이걸 쓴다 */
  cur: AutochessDoc;
  past: AcPastMap;
  onShowOperator?: (id: string) => void;
}) {
  const [doc, setDoc] = useState<AutochessDoc>(cur);
  const [busy, setBusy] = useState<number | undefined>(undefined);

  const pick = (n: number) => {
    if (n === doc.season || busy != null) return;
    if (n === cur.season) { setDoc(cur); return; }
    const load = past[n];
    if (!load) return;
    setBusy(n);
    // import() 는 모듈 캐시를 타므로 오가며 눌러도 두 번 받지 않는다
    load().then((m) => setDoc(((m as { default?: unknown }).default ?? m) as AutochessDoc))
      .catch(() => { /* 못 받으면 보던 시즌 그대로 둔다 */ })
      .finally(() => setBusy(undefined));
  };

  return (
    <AutochessGuide key={doc.season} doc={doc} seasons={seasonList as AcSeason[]}
      onSeason={pick} seasonBusy={busy} onShowOperator={onShowOperator} />
  );
}
