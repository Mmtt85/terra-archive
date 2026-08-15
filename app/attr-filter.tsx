"use client";

// 여러 속성 필터를 한 컨트롤로 묶는 공용 부품 — 오퍼 백과사전(app/home.tsx)과
// 적 도감(app/enemies.tsx)·작전 도감(app/stages.tsx)이 함께 쓴다. 데이터 의존이 없어 별도
// 모듈로 뺐다 (2026-08-09): home.tsx에 두면 적 도감 청크가 home.tsx를 통째로 끌어온다.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
// disabled/hint — 상위 조건이 정해져야 열리는 카테고리용 (지금은 subFor가 대신한다)
// single — 그 칸에서 하나만 고르게 한다 (작전 도감의 계열 → 이벤트 → 구역처럼 **한 갈래씩
// 좁혀 가는** 필터용, 사용자 요청 2026-08-09). 오퍼 백과사전은 종전대로 복수 선택이다.
// 검색줄은 **모든 칸에 항상** 붙는다 (사용자 재확정 2026-08-10 — 처음엔 긴 칸에만 얹었더니
// "뭐가 바뀐지 모르겠다"는 지적. 짧은 칸에도 있는 게 일관돼서 낫다).
//
// ── 계층 목록 (subFor, 사용자 요청 2026-08-16) ──────────────────────────────────
// 종전에는 상위를 고르면 **옆에 새 카테고리 칸이 생기는** 방식이었다 ("클릭하고 새로 나타나고
// 뭐하고 하는 게 아니라"). 이제 값에 **마우스를 올리면 그 값의 하위가 옆 열로 열린다** —
// 계열 → 이벤트 → 구역, 직군 → 세부 직군이 한 칸 안에서 끝난다.
//   - subFor(path)는 루트부터 그 값까지의 경로를 받아 **다음 계층**을 돌려준다. 경로마다 축이
//     달라도 된다 (작전 도감: 이벤트가 없는 계열은 곧바로 구역이 온다).
//   - 마우스 기기: 줄에 **올리면 그 줄 오른쪽에** 하위 목록이 뜬다(진짜 서브메뉴).
//     ⚠ 이 목록은 **body로 portal + position:fixed** 다. 같은 DOM 안에 absolute로 두면
//     `.attr-drop`의 `overflow-y:auto`에 잘리고, 목록 밖(.attr-cats 직속)으로 빼면 필터
//     패널을 넘어가 결과 영역에 가려진다 (둘 다 2026-08-16 실측). portal이면 어떤 조상의
//     overflow·겹침에도 안 걸려서 **메뉴 사이를 벌리지 않고** 옆에 그대로 띄울 수 있다.
//   - 터치 기기: 옆에 띄울 자리가 없으므로 **누르면 그 줄 아래로** 들여써서 펼친다
//     (사용자 확정 2026-08-16). 부모 자체를 고르려면 펼쳐진 목록 맨 위의 '전체'를 쓴다.
export type AttrSub = {
  title: string;
  items: string[];
  selected: string[];
  labelFor?: (value: string) => string;
  countForItem: (value: string) => number;
  single?: boolean;
  onPick: (value: string) => void;
};
export type AttrGroup = {
  title: string; items: string[]; selected: string[]; onToggle: (value: string) => void;
  labelFor?: (value: string) => string; countForItem: (value: string) => number;
  disabled?: boolean; hint?: string; single?: boolean;
  /** 이 경로의 **다음 계층** — 없으면 null. path는 루트부터 그 값까지 (깊이 무제한) */
  subFor?: (path: string[]) => AttrSub | null;
};

/** 목록의 한 계층 — 루트도 하위 열도 같은 모양이라 한 타입으로 다룬다 */
type Level = {
  title: string; items: string[]; selected: string[];
  labelFor?: (value: string) => string; countForItem: (value: string) => number;
  pick: (value: string) => void;
};
const levelOfGroup = (g: AttrGroup): Level => ({ ...g, pick: g.onToggle });
const levelOfSub = (s: AttrSub): Level => ({ ...s, pick: s.onPick });

/** 서브메뉴 크기 — 화면 밖으로 나갈지 미리 재려면 렌더 전에 알아야 해서 CSS와 같은 값을 둔다 */
const FLY_W = 250;
const FLY_MAX_H = 340;

/** openPath가 이 줄(prefix)을 지나가는가 — 지나가면 그 줄의 하위가 열려 있다 */
const startsWith = (path: string[], prefix: string[]) =>
  prefix.length <= path.length && prefix.every((v, i) => v === path[i]);

/** 하위 목록을 띄울 기준 좌표 — 그 줄의 화면 좌표 (position:fixed 기준이라 스크롤 보정 불필요) */
export type Anchor = { top: number; left: number; right: number };

/** 값 한 줄. 터치 모드에서만 자기 하위를 자기 안에 펼치고, 마우스 모드에서는 앵커만 올려 준다 */
function AttrRow({ item, path, level, subFor, hoverMode, openPath, openAt, pick }: {
  item: string;
  /** 루트부터 이 값까지 */ path: string[];
  level: Level;
  subFor?: (path: string[]) => AttrSub | null;
  hoverMode: boolean;
  openPath: string[];
  /** 이 줄의 하위를 연다 (마우스: 앵커 포함 / 터치: 앵커 없이 토글) */
  openAt: (path: string[], anchor?: Anchor) => void;
  /** 값 하나를 고르고 목록을 닫는다 */ pick: (level: Level, value: string) => void;
}) {
  const { t } = useI18n();
  const sub = subFor?.(path) ?? null;
  const hasSub = !!sub && sub.items.length > 0;
  const openHere = hasSub && startsWith(openPath, path);
  const isSelected = level.selected.includes(item);
  const label = level.labelFor ? level.labelFor(item) : item;
  return (
    <li className={`${hasSub ? "attr-has-sub" : ""}${openHere ? " open" : ""}`}
      // 마우스: 줄에 올리기만 해도 그 줄의 하위가 오른쪽에 뜬다. 하위가 없는 줄로 옮기면
      // 그 깊이까지만 남기고 닫힌다 (형제 줄 사이를 지나가도 체인이 어긋나지 않게).
      onPointerEnter={hoverMode ? (event) => {
        // ⚠ 하위가 **없는** 줄에서는 앵커를 건드리지 않는다. 넘기면 그 좌표가 이 줄이 속한
        // 목록의 앵커(anchors[path.length-1])를 덮어써서, 그 목록이 자기 안의 줄 오른쪽으로
        // 다시 그려진다 = 마우스만 올려도 서브메뉴가 오른쪽으로 튄다 (사용자 지적 2026-08-16).
        if (!hasSub) { openAt(path.slice(0, -1)); return; }
        const r = event.currentTarget.getBoundingClientRect();
        openAt(path, { top: r.top, left: r.left, right: r.right });
      } : undefined}>
      {/* ⚠ role="option"에는 aria-expanded를 달 수 없다 (jsx-a11y) — 펼침 상태는 목록
          자체(aria-label 있는 중첩 listbox)와 › / ˅ 표식으로 전달된다 */}
      <button type="button" role="option" aria-selected={isSelected}
        className={isSelected ? "selected" : ""}
        onClick={() => {
          // 터치: 하위가 있으면 **펼치기**가 우선 (부모만 고르려면 펼쳐진 '전체'를 쓴다).
          // 마우스: 줄을 누르면 종전처럼 그 값으로 확정하고 닫는다.
          if (!hoverMode && hasSub) { openAt(openHere ? path.slice(0, -1) : path); return; }
          pick(level, item);
        }}>
        <i aria-hidden>{isSelected ? "✓" : ""}</i>
        {label}
        <span>{level.countForItem(item)}</span>
        {hasSub && <b className="attr-sub-caret" aria-hidden>{!hoverMode && openHere ? "˅" : "›"}</b>}
      </button>
      {/* 터치 전용 — 마우스 모드의 하위는 AttributeFilter가 portal로 옆에 띄운다 */}
      {!hoverMode && openHere && sub && (
        <ul className="attr-sub" role="listbox" aria-multiselectable={!sub.single} aria-label={sub.title}>
          <li className="attr-sub-head" aria-hidden>{sub.title}</li>
          <li>
            <button type="button" role="option" aria-selected={false} className="attr-sub-all"
              onClick={() => pick(level, item)}>
              <i aria-hidden />{t("{name} 전체", { name: label })}
              <span>{level.countForItem(item)}</span>
            </button>
          </li>
          {sub.items.map((child) => (
            <AttrRow key={child} item={child} path={[...path, child]} level={levelOfSub(sub)}
              subFor={subFor} hoverMode={hoverMode} openPath={openPath} openAt={openAt} pick={pick} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function AttributeFilter({ groups }: { groups: AttrGroup[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  // 지금 펼쳐진 하위 경로 + 각 깊이를 띄울 기준 줄의 화면 좌표. 카테고리를 바꿔 열면 비운다.
  const [openPath, setOpenPath] = useState<string[]>([]);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  // 드롭다운 안 검색어 — 칸을 바꿔 열 때 초기화한다 (effect가 아니라 클릭 핸들러에서:
  // set-state-in-effect 린트 관례)
  const [query, setQuery] = useState("");
  // 열려 있는 동안 상위 조건이 풀리면(직군 해제) 목록도 같이 닫힌다
  const active = groups.find((g) => g.title === open && !g.disabled);
  const wrapRef = useRef<HTMLDivElement>(null);
  // 마우스가 있는 기기에서만 옆 열 — 터치는 그 자리에서 아래로 펼친다.
  // ⚠ 이펙트로 상태에 담지 않는다(set-state-in-effect 린트 관례). 렌더 중에 읽어도 안전한 건
  //   이 값을 **드롭다운 안에서만** 쓰기 때문 — 드롭다운은 카테고리를 눌러야 생기므로
  //   서버 HTML·첫 클라이언트 렌더 어디에도 없어 하이드레이션이 어긋날 자리가 없다.
  //   (그래서 아래 legend 안내 문구는 두 조작을 아우르는 **한 문장**으로 쓴다.)
  const hoverMode = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches, []);

  const close = () => { setOpen(null); setOpenPath([]); setAnchors([]); };
  /** 그 줄의 하위를 연다 — 앵커는 그 깊이 자리에 넣고 더 깊은 것은 버린다 */
  const openAt = (path: string[], anchor?: Anchor) => {
    setOpenPath(path);
    if (anchor && path.length > 0) {
      setAnchors((cur) => { const next = cur.slice(0, path.length - 1); next[path.length - 1] = anchor; return next; });
    }
  };
  const pick = (level: Level, value: string) => { level.pick(value); close(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // 서브메뉴는 body로 portal돼 wrapRef 바깥이다 — 그것도 '안'으로 쳐야 클릭이 안 끊긴다
      if (!wrapRef.current?.contains(target) && !(target as Element)?.closest?.(".attr-fly")) close();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);


  return (
    <fieldset className="attr-filter">
      <legend>{t("세부 조건")}<small className="multi-hint">
        {groups.some((g) => g.subFor)
          ? t("항목을 눌러 값을 고르세요 · › 표시가 있는 항목은 하위로 좁힐 수 있습니다")
          : t("항목을 눌러 값을 고르세요 · 복수 선택 가능")}
      </small></legend>
      <div className="attr-cats" ref={wrapRef}>
        {groups.map((g) => (
          <button key={g.title} type="button" disabled={g.disabled}
            className={`attr-cat${open === g.title ? " open" : ""}${g.selected.length ? " has-sel" : ""}`}
            aria-expanded={open === g.title} title={g.disabled ? g.hint : undefined}
            onClick={() => {
              setQuery(""); setOpenPath([]); setAnchors([]);
              setOpen((current) => (current === g.title ? null : g.title));
            }}>
            {g.title}{g.selected.length > 0 && <em>{g.selected.length}</em>}
            {g.disabled && g.hint && <small className="attr-cat-hint">{g.hint}</small>}
            <span className="attr-caret" aria-hidden>{open === g.title ? "▴" : "▾"}</span>
          </button>
        ))}
        {active && (() => {
          const q = query.trim().toLowerCase();
          const shown = q
            ? active.items.filter((item) => (active.labelFor ? active.labelFor(item) : item).toLowerCase().includes(q))
            : active.items;
          // 마우스 모드의 서브메뉴 — openPath의 깊이마다 하나. body로 portal해 fixed로 띄우므로
          // .attr-drop의 overflow에도, 결과 영역의 겹침에도 걸리지 않는다.
          const flyouts: { sub: AttrSub; parentLevel: Level; parent: string; anchor: Anchor }[] = [];
          if (hoverMode && active.subFor) {
            let parentLevel = levelOfGroup(active);
            for (let depth = 1; depth <= openPath.length; depth += 1) {
              const sub = active.subFor(openPath.slice(0, depth));
              const anchor = anchors[depth - 1];
              if (!sub || sub.items.length === 0 || !anchor) break;
              flyouts.push({ sub, parentLevel, parent: openPath[depth - 1], anchor });
              parentLevel = levelOfSub(sub);
            }
          }
          return (
            <>
              <ul className="attr-drop"
                role="listbox" aria-multiselectable={!active.single} aria-label={active.title}>
                <li className="attr-search">
                  {/* 모바일은 자동 포커스하지 않는다 — 키보드가 바로 솟아 목록을 가린다 */}
                  <input type="search" value={query} placeholder={t("입력해서 찾기")}
                    aria-label={`${active.title} — ${t("입력해서 찾기")}`}
                    autoFocus={typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches}
                    onChange={(event) => setQuery(event.target.value)} />
                </li>
                {shown.map((item) => (
                  <AttrRow key={item} item={item} path={[item]} level={levelOfGroup(active)}
                    subFor={active.subFor} hoverMode={hoverMode}
                    openPath={openPath} openAt={openAt} pick={pick} />
                ))}
                {shown.length === 0 && <li className="attr-none">{t("검색 결과가 없습니다")}</li>}
              </ul>
              {flyouts.map(({ sub, parentLevel, parent, anchor }, depth) => {
                const parentLabel = parentLevel.labelFor ? parentLevel.labelFor(parent) : parent;
                // 오른쪽이 모자라면 왼쪽으로 뒤집고, 아래가 모자라면 위로 끌어올린다
                const flip = anchor.right + FLY_W + 8 > window.innerWidth;
                const left = flip ? Math.max(4, anchor.left - FLY_W - 2) : anchor.right + 2;
                const top = Math.max(4, Math.min(anchor.top - 6, window.innerHeight - FLY_MAX_H - 8));
                return createPortal(
                  <ul key={openPath.slice(0, depth + 1).join(" ")} className="attr-drop attr-fly"
                    style={{ left, top }}
                    role="listbox" aria-multiselectable={!sub.single} aria-label={sub.title}>
                    <li className="attr-sub-head" aria-hidden>{sub.title}</li>
                    {/* 하위로 좁히지 않고 부모 값만 고른다 */}
                    <li>
                      <button type="button" role="option" aria-selected={false} className="attr-sub-all"
                        onClick={() => pick(parentLevel, parent)}>
                        <i aria-hidden />{t("{name} 전체", { name: parentLabel })}
                        <span>{parentLevel.countForItem(parent)}</span>
                      </button>
                    </li>
                    {sub.items.map((item) => (
                      <AttrRow key={item} item={item} path={[...openPath.slice(0, depth + 1), item]}
                        level={levelOfSub(sub)} subFor={active.subFor} hoverMode={hoverMode}
                        openPath={openPath} openAt={openAt} pick={pick} />
                    ))}
                  </ul>, document.body);
              })}
            </>
          );
        })()}
      </div>
    </fieldset>
  );
}
