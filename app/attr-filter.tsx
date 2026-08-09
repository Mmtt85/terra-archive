"use client";

// 여러 속성 필터를 한 컨트롤로 묶는 공용 부품 — 오퍼 백과사전(app/home.tsx)과
// 적 도감(app/enemies.tsx)이 함께 쓴다. 데이터 의존이 없어 별도 모듈로 뺐다
// (2026-08-09): home.tsx에 두면 적 도감 청크가 home.tsx를 통째로 끌어온다.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";


// 여러 속성 필터(성급·직군·세부직군·전투태그·공격방식·소속)를 한 컨트롤로 — 카테고리를 누르면
// 그 값 태그가 나온다. 필터 패널이 세로로 끝없이 늘어나던 문제 해소 (사용자 요청 2026-07-22).
// 값 목록은 아래로 밀어내지 않고 **떠 있는 드롭다운**으로 (사용자 요청 2026-08-01) —
// 태그를 흩뿌리지 않고 컨셉덱 검색(.concept-drop)과 같은 **한 줄에 하나씩 세로 리스트**다
// (사용자 요청 2026-08-01). ⚠ 하나 고르면 **바로 닫는다** (사용자 요청 2026-08-01) — 값이
// 복수 선택이긴 하지만 고른 뒤에도 목록이 화면을 덮고 있으면 결과를 볼 수 없다. 더 고를 땐
// 카테고리를 다시 누르면 되고, 이미 고른 값은 ✓로 표시돼 있어 다시 열어도 바로 보인다.
// (컨셉덱은 하나만 고르는 기능이라 고른 걸 아예 목록에서 뺀다 — 그 차이만 다르다.)
// 컨셉덱은 시그니처 기능이라 별도 유지.
// disabled/hint — 상위 조건이 정해져야 열리는 카테고리(세부 직군 ← 직군)용
export type AttrGroup = { title: string; items: string[]; selected: string[]; onToggle: (value: string) => void; labelFor?: (value: string) => string; countForItem: (value: string) => number; disabled?: boolean; hint?: string };
export function AttributeFilter({ groups }: { groups: AttrGroup[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  // 열려 있는 동안 상위 조건이 풀리면(직군 해제) 목록도 같이 닫힌다
  const active = groups.find((g) => g.title === open && !g.disabled);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <fieldset className="attr-filter">
      <legend>{t("세부 조건")}<small className="multi-hint">{t("항목을 눌러 값을 고르세요 · 복수 선택 가능")}</small></legend>
      <div className="attr-cats" ref={wrapRef}>
        {groups.map((g) => (
          <button key={g.title} type="button" disabled={g.disabled}
            className={`attr-cat${open === g.title ? " open" : ""}${g.selected.length ? " has-sel" : ""}`}
            aria-expanded={open === g.title} title={g.disabled ? g.hint : undefined}
            onClick={() => setOpen((current) => (current === g.title ? null : g.title))}>
            {g.title}{g.selected.length > 0 && <em>{g.selected.length}</em>}
            {g.disabled && g.hint && <small className="attr-cat-hint">{g.hint}</small>}
            <span className="attr-caret" aria-hidden>{open === g.title ? "▴" : "▾"}</span>
          </button>
        ))}
        {active && (
          <ul className="attr-drop" role="listbox" aria-multiselectable aria-label={active.title}>
            {active.items.map((item) => {
              const isSelected = active.selected.includes(item);
              return (
                <li key={item}>
                  <button type="button" role="option" aria-selected={isSelected}
                    className={isSelected ? "selected" : ""}
                    onClick={() => { active.onToggle(item); setOpen(null); }}>
                    <i aria-hidden>{isSelected ? "✓" : ""}</i>
                    {active.labelFor ? active.labelFor(item) : item}
                    <span>{active.countForItem(item)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </fieldset>
  );
}

