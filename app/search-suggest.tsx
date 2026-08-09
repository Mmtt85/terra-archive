"use client";

// 검색란 제안 드롭다운 — 사이트의 모든 검색란 공용 부품 (사용자 확정 2026-08-10:
// "검색란은 전부 드랍다운 겸 검색란으로", 항목을 고르면 **그 항목의 상세가 열린다**).
//
// 입력란 자체는 각 화면이 그대로 관리한다 — 이 부품은 "질의 + 후보 + 고르기"만 받아
// 입력란 아래에 떠 있는 목록을 그린다. 매칭 로직은 화면마다 이미 있으므로(별명·초성 등
// 화면별 규칙이 다르다) **후보는 호출부가 걸러서 넘긴다**. 여기서 다시 매칭하지 않는다.
//
// 놓는 법: 입력란과 같은 부모(대개 .search-wrap) 안에 나란히 넣고, 그 부모가
// position:relative여야 한다 (.search-wrap은 globals.css에서 일괄 처리).
// 키보드 화살표 탐색은 아직 없다 — 클릭/탭 + Esc 닫기만 (첫 판 범위).

import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";

export type Suggest = {
  key: string;
  label: string;
  sub?: string;       // 라벨 오른쪽 보조 정보 (직군·구역·등급 등)
  img?: string;       // 왼쪽 섬네일 (없으면 생략)
};

export function SearchSuggest({ query, items, onPick, max = 10 }: {
  query: string;
  items: Suggest[];
  onPick: (key: string) => void;
  max?: number;
}) {
  const { t } = useI18n();
  // "이 질의에 대해 닫았음" — Esc·바깥 클릭으로 닫아도, 질의를 고치면 다시 열린다
  const [closed, setClosed] = useState("");
  const dropRef = useRef<HTMLDivElement>(null);
  const show = query.trim().length > 0 && closed !== query && items.length > 0;

  useEffect(() => {
    if (!show) return;
    const onDown = (event: PointerEvent) => {
      // 입력란 클릭은 열림 유지가 자연스럽다 — 입력란까지 포함하는 부모(.search-wrap) 기준
      const anchor = dropRef.current?.parentElement;
      if (anchor && !anchor.contains(event.target as Node)) setClosed(query);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setClosed(query); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [show, query]);

  if (!show) return null;
  return (
    <div className="suggest-drop" ref={dropRef} role="listbox" aria-label={t("검색 제안")}>
      {items.slice(0, max).map((item) => (
        <button key={item.key} type="button" role="option" aria-selected={false}
          // 입력란 blur보다 먼저 실행돼 목록이 닫히며 클릭이 증발하는 것을 막는다
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => { setClosed(query); onPick(item.key); }}>
          {item.img && (
            <img src={item.img} alt="" aria-hidden width={40} height={40} loading="lazy" decoding="async"
              onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
          )}
          <span className="sg-label">{item.label}</span>
          {item.sub && <span className="sg-sub">{item.sub}</span>}
        </button>
      ))}
      {items.length > max && (
        <div className="sg-more">{t("외 {n}개 — 더 입력해 좁혀 보세요", { n: String(items.length - max) })}</div>
      )}
    </div>
  );
}
