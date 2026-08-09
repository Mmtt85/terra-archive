"use client";

// 검색란 제안 드롭다운 — 사이트의 모든 검색란 공용 부품 (사용자 확정 2026-08-10:
// "검색란은 전부 드랍다운 겸 검색란으로", 항목을 고르면 **그 항목의 상세가 열린다**).
// **클릭(포커스)만 해도 전체 리스트가 열리고**, 입력하면 좁혀진다 (사용자 재확정
// 2026-08-10 — 처음엔 입력해야만 떴는데 "일단 클릭하면 전체 리스트가 보여야지").
//
// 입력란 자체는 각 화면이 그대로 관리한다 — 이 부품은 "질의 + 후보 + 고르기"만 받아
// 입력란 아래에 떠 있는 목록을 그린다. 매칭 로직은 화면마다 이미 있으므로(별명·초성 등
// 화면별 규칙이 다르다) **후보는 호출부가 걸러서 넘긴다**. 질의가 비어 있으면 호출부의
// "다른 필터만 적용된 전체 목록"이 그대로 온다 — 그게 곧 클릭 시 보이는 전체 리스트다.
//
// 놓는 법: 입력란과 같은 부모(대개 .search-wrap) 안에 나란히 넣고, 그 부모가
// position:relative여야 한다. 부모 안의 <input>을 스스로 찾아 포커스를 감지한다.
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
  const hostRef = useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = useState(false);
  // Esc·바깥 클릭·항목 선택으로 닫은 질의 — 질의를 고치거나 다시 클릭하면 재개방
  const [closedFor, setClosedFor] = useState<string | null>(null);

  // 같은 부모 안의 입력란을 찾아 포커스·클릭을 감지한다 (입력란 코드는 손대지 않는다)
  useEffect(() => {
    const input = hostRef.current?.parentElement?.querySelector("input");
    if (!input) return;
    const onFocus = () => { setClosedFor(null); setFocused(true); };
    const onClick = () => setClosedFor(null);   // 이미 포커스 상태여도 다시 클릭하면 연다
    const onBlur = () => setFocused(false);     // 제안 클릭은 pointerdown preventDefault라 blur가 안 난다
    input.addEventListener("focus", onFocus);
    input.addEventListener("click", onClick);
    input.addEventListener("blur", onBlur);
    return () => {
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("click", onClick);
      input.removeEventListener("blur", onBlur);
    };
  }, []);

  const show = focused && closedFor !== query && items.length > 0;

  useEffect(() => {
    if (!show) return;
    const onDown = (event: PointerEvent) => {
      const anchor = hostRef.current?.parentElement;
      if (anchor && !anchor.contains(event.target as Node)) setClosedFor(query);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setClosedFor(query); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [show, query]);

  return (
    <span className="suggest-host" ref={hostRef}>
      {show && (
        <div className="suggest-drop" role="listbox" aria-label={t("검색 제안")}>
          {items.slice(0, max).map((item) => (
            <button key={item.key} type="button" role="option" aria-selected={false}
              // 입력란 blur보다 먼저 실행돼 목록이 닫히며 클릭이 증발하는 것을 막는다
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => { setClosedFor(query); onPick(item.key); }}>
              {item.img && (
                <img src={item.img} alt="" aria-hidden width={28} height={28} loading="lazy" decoding="async"
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
      )}
    </span>
  );
}
