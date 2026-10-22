"use client";

// 공용 드롭다운 — **버튼 하나 + 목록 하나**짜리 한 칸 컨트롤.
// 종전에는 화면마다 제각각이었다 (사용자 지시 2026-08-25 "드랍다운인데 공용 드랍다운
// 안쓰는애들은 전부다 쓰게 해 줘"): 위수 협의 4개는 .ac-garsel, 언어 선택은 .server-chip,
// 록라 토픽은 .rg-topicsel, 오퍼 정렬·리더기 에피소드는 네이티브 <select>였다.
// 여닫는 방식(바깥 클릭·Esc)도 화면마다 따로 구현돼 한 곳을 고쳐도 나머지가 안 따라왔다.
//
// ⚠ 여러 **축**을 한 컨트롤에 묶는 속성 필터는 attr-filter.tsx(AttributeFilter)가 따로 있다.
//   여기는 축이 하나인 자리 전용이다. multi로 그 축 안에서 여러 값을 고를 수는 있다.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { normSearch } from "./search";
import { useI18n } from "./i18n";

export type DropItem = {
  value: string;
  label: React.ReactNode;
  /** 줄 오른쪽 끝의 회색 숫자 (건수 등) */
  count?: number | string;
  disabled?: boolean;
  /** 이름 앞의 작은 그림 (맹약 아이콘 등) */
  icon?: React.ReactNode;
  /** 줄에 덧붙일 클래스 (예: 저장 대기 표시 save-pending) */
  className?: string;
  /** 줄에 마우스를 올리면 뜨는 설명 */
  title?: string;
  /** search 목록에서 찾을 글자 (이름 등) — 없으면 검색어와 무관하게 늘 보인다 ('비우기' 같은 줄) */
  searchText?: string;
};

/** 오른쪽 공간이 이만큼도 없으면 왼쪽으로 펼친다 (.ac-garsel과 같은 규약) */
const MENU_MIN_SPACE = 240;

/** 목록이 펼쳐질 수 있는 가로 범위 [왼쪽, 오른쪽] — 창, 그리고 그 안에서 가로를 자르는 조상
 *  (모달 본문 등)의 안쪽. 창 폭만 재면 가운데 뜬 모달의 오른끝 버튼이 오른쪽으로 펴다 모달 밖으로
 *  잘렸다 (듀얼 채널 정렬, 1440px에서 99px — 사용자 지시 2026-09-23 "모달 경계 재게"). */
function room(el: HTMLElement): [number, number] {
  let left = 0;
  let right = window.innerWidth;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    // overflow-y만 auto여도 x는 visible이 아니라 auto로 계산된다 — 모달 본문(.mw-body)이 그렇다
    if (getComputedStyle(p).overflowX === "visible") continue;
    const box = p.getBoundingClientRect();
    left = Math.max(left, box.left + p.clientLeft);
    right = Math.min(right, box.left + p.clientLeft + p.clientWidth);
  }
  return [left, right];
}

/** 목록을 세로로 자르는 조상(모달 창 .mw-window overflow:hidden · 본문 .mw-body overflow:auto)의 안쪽 바닥.
 *  거기 걸리면 목록이 모달 바닥에서 잘렸다 (로그인 창 서버 선택, 서버 5개로 늘며 드러남 — 사용자 지적 2026-10-06) */
function clipBottom(el: HTMLElement): number {
  let bottom = window.innerHeight;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowY === "visible") continue;
    const box = p.getBoundingClientRect();
    bottom = Math.min(bottom, box.top + p.clientTop + p.clientHeight);
  }
  return bottom;
}

export function Dropdown({
  label, items, selected, onPick, multi, ariaLabel,
  className, buttonClassName, scroll, disabled, actions, search, anchor, limit, bare,
}: {
  /** 버튼에 보일 현재 상태 */
  label: React.ReactNode;
  items: DropItem[];
  selected: string[];
  onPick: (value: string) => void;
  /** 여러 개 고르기 — 고른 뒤에도 목록을 **닫지 않는다** (연달아 고르는 게 자연스럽다) */
  multi?: boolean;
  ariaLabel: string;
  className?: string;
  buttonClassName?: string;
  /** 항목이 많은 목록 — 최대 높이를 두고 스크롤 */
  scroll?: boolean;
  disabled?: boolean;
  /** 값을 고르는 게 아니라 **할 일을 고르는** 메뉴 ('그 외' 등) — 줄이 menuitem 이 되고 고른 표시가 없다 */
  actions?: boolean;
  /** 목록 맨 첫 줄에 검색란 — 자리표시 글자. 줄마다 searchText 로 거른다 (가챠 픽업 자리, 2026-10-12) */
  search?: string;
  /** 목록을 단추 대신 이 조상(closest 선택자)의 왼끝·폭에 맞춘다 — 좁은 패널 안의 작은 단추 (가챠 픽업 자리, 2026-10-12) */
  anchor?: string;
  /** 한 번에 그리는 줄 수 상한 — 넘는 만큼은 '외 N개 · 검색으로 찾기' 한 줄로 (DPS 계산기 적 1,586종, 2026-10-17:
   *  다 그리면 여는 데 1.7초 걸렸다). 검색하면 걸러진 것 중에서 다시 상한까지 */
  limit?: number;
  /** 단추 모양을 통째로 부르는 쪽이 그린다 — 공용 단추 결(.drop-btn: 고른 점·밑줄·캐럿)을 안 입힌다. 목록 동작은 같다
   *  (내 정보 항목 편집 조건 카드, 사용자 지적 2026-10-22 "드롭다운처럼 움직이라 했지 드롭다운 단추를 늘리라 한 게 아니다") */
  bare?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  // 조상에 잘릴 때만 화면 기준(position: fixed)으로 띄운다 — 늘 **아래로**, 모달 밖으로 넘어가도 보이게
  // (사용자 지시 2026-10-06 "위로 나오면 안 돼, 밑으로 나오면서 모달 밖으로 삐져나가도 보이도록"). 모달 조상엔 transform 이 없어
  // fixed 가 창 기준으로 잡힌다. 스크롤하면 버튼과 어긋나므로 그때는 닫는다
  const [float, setFloat] = useState<React.CSSProperties | null>(null);
  // anchor 를 준 목록의 세로 자리 — 기준 상자(anchor) 안에서 **누른 단추 바로 밑**. CSS 의 top:100% 는 기준 상자 바닥이라
  // 단추가 여러 줄로 넘어가면 윗줄 단추의 목록이 아랫줄 밑에 붙었다 (가챠 픽업 자리, 사용자 지적 2026-10-12)
  const [anchorTop, setAnchorTop] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const q = normSearch(query);
  const shown = search && q ? items.filter((item) => item.searchText === undefined || normSearch(item.searchText).includes(q)) : items;

  useEffect(() => {
    if (!open) return;
    // 바깥 클릭·Esc로 닫기 — 종전에는 화면마다 따로 달려 있었다
    // 바깥 = 단추·목록이 아닌 곳. 감싼 칸(.drop)이 폭 100%로 늘어난 화면(DPS 계산기 적 고르기 등)에서 단추 오른쪽 빈자리를 눌러도
    // '안쪽'으로 쳐서 안 닫혔다 (사용자 지적 2026-10-17 "전에도 있었던 문제") — 칸 자체를 누른 것도 바깥으로 본다
    const onDown = (event: MouseEvent) => {
      const root = rootRef.current, target = event.target as Node;
      if (!root?.contains(target) || target === root) setOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    // 떠 있는 목록(float)은 스크롤·창 크기 변경에 버튼과 어긋난다 — 닫는다. 목록 안 스크롤(scroll 목록)은 뺀다
    // 바깥이 스크롤되면 — 종전엔 바로 닫았는데, 휠을 조금만 굴려도 목록이 사라졌다 (DPS 계산기 오퍼 추가, 사용자 지적 2026-10-17).
    // 이제 목록이 단추를 따라 움직이고, 단추가 화면 밖으로 나가면 그때 닫는다. 창 크기 변경은 그대로 닫는다
    const onScroll = (event: Event) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      const btn = rootRef.current?.querySelector<HTMLElement>(".drop-btn, .drop-bare");
      if (event.type === "resize" || !btn) { setOpen(false); return; }
      const r = btn.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return; }
      setFloat((f) => (f ? { ...f, top: r.bottom + 4, ...(f.left !== undefined && f.left !== "auto" && !f.width ? { left: r.left } : {}) } : f));
    };
    if (float) { window.addEventListener("scroll", onScroll, true); window.addEventListener("resize", onScroll); }
    return () => {
      window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll);
    };
  }, [open, float]);

  // 펼친 뒤 실제 높이로 한 번 더 잰다 — 여는 순간엔 줄 수로 어림해서(줄 ≈30px), 실제가 더 크면 목록 끝이 모달 바닥에 잘린 채
  // 안에 갇혔다 (내 정보 카드 편집 '레벨', 사용자 지적 2026-10-22). 넘치면 화면 기준(fixed)으로 띄운다
  useLayoutEffect(() => {
    if (!open || float) return;
    const root = rootRef.current;
    const btn = root?.querySelector<HTMLElement>(".drop-btn, .drop-bare");
    const menu = root?.querySelector<HTMLElement>(".drop-menu");
    if (!btn || !menu) return;
    const limit = clipBottom(btn);
    if (menu.getBoundingClientRect().bottom <= limit || limit >= window.innerHeight) return;
    const r = btn.getBoundingClientRect();
    setFloat(alignRight ? { position: "fixed", top: r.bottom + 4, right: window.innerWidth - r.right, left: "auto" } : { position: "fixed", top: r.bottom + 4, left: r.left });
  }, [open, float, alignRight]);

  // 일부 모바일 인앱 브라우저(카카오톡·카페 웹뷰)는 탭 한 번에 click 을 두 번 합성한다 — 열리자마자 닫혀
  // "안 보임"이 됐다 (플래너 '그 외'에서 2026-07-18 제보, 공용으로 옮기며 가드도 함께 옮김). 350ms 안의 재토글은 무시
  const toggledAt = useRef(0);
  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    const now = Date.now();
    if (now - toggledAt.current < 350) return;
    toggledAt.current = now;
    // 열기 직전에 여유를 재서 펼칠 방향을 정한다 — 화면·모달 오른끝 버튼이 잘리던 문제.
    // 오른쪽이 모자라도 왼쪽이 더 좁으면 그대로 둔다 (좁은 창 왼끝 버튼이 반대로 잘리지 않게)
    const rect = event.currentTarget.getBoundingClientRect();
    const [left, right] = room(event.currentTarget);
    const alignRightNow = right - rect.left < MENU_MIN_SPACE && rect.right - left > right - rect.left;
    setAlignRight(alignRightNow);
    // 목록 높이는 줄 수로 어림한다(줄 ≈30px, scroll 이면 최대 440)
    const need = Math.min(items.length * 30 + 14 + (search ? 44 : 0), scroll ? 440 : Infinity);
    const clipped = clipBottom(event.currentTarget) - rect.bottom < need + 4 && clipBottom(event.currentTarget) < window.innerHeight;
    const box = anchor ? (event.currentTarget.closest(anchor) as HTMLElement | null)?.getBoundingClientRect() : undefined;
    setAnchorTop(box ? rect.bottom - box.top + 4 : null);
    setFloat(!clipped ? null : box ? { position: "fixed", top: rect.bottom + 4, left: box.left, right: "auto", width: box.width }
      : { position: "fixed", top: rect.bottom + 4, ...(alignRightNow ? { right: window.innerWidth - rect.right, left: "auto" } : { left: rect.left }) });
    setQuery("");
    setOpen((value) => !value);
  };

  return (
    <div className={`drop${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button type="button" disabled={disabled}
        className={bare ? `drop-bare${buttonClassName ? ` ${buttonClassName}` : ""}` : `drop-btn${selected.length > 0 ? " on" : ""}${buttonClassName ? ` ${buttonClassName}` : ""}`}
        aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} onClick={toggle}>
        {bare ? label : <>
          <span className="drop-label">{label}</span>
          {/* 캐럿은 .drop-caret이 1em 칸을 잡는다 — ▾/▴의 자체 폭이 달라 버튼이 흔들리던 문제 */}
          <i className="drop-caret" aria-hidden>▾</i>
        </>}
      </button>
      {open && (
        <ul className={`drop-menu menu-anim${alignRight ? " align-right" : ""}${scroll ? " scroll" : ""}`} style={float ?? (anchorTop != null ? { top: anchorTop } : undefined)}
          role="menu" aria-label={ariaLabel}>
          {search && (
            <li role="none" className="drop-search">
              <input type="search" autoFocus value={query} placeholder={search} aria-label={search}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // 엔터 = 걸러진 첫 줄 고르기
                  if (event.key !== "Enter") return;
                  const first = shown.find((item) => !item.disabled && item.searchText !== undefined);
                  if (first) { onPick(first.value); if (!multi) setOpen(false); }
                }} />
            </li>
          )}
          {(limit && shown.length > limit ? shown.slice(0, limit) : shown).map((item) => {
            const on = selected.includes(item.value);
            return (
              <li key={item.value} role="none">
                <button type="button" role={actions ? "menuitem" : multi ? "menuitemcheckbox" : "menuitemradio"}
                  aria-checked={actions ? undefined : on} disabled={item.disabled} title={item.title}
                  className={["menu-item-bar", on ? "on" : "", item.className ?? ""].filter(Boolean).join(" ")}
                  onClick={() => { onPick(item.value); if (!multi) setOpen(false); }}>
                  {item.icon}
                  <span>{item.label}</span>
                  {item.count !== undefined && <em>{item.count}</em>}
                </button>
              </li>
            );
          })}
          {limit != null && shown.length > limit && (
            <li role="none" className="drop-more">{t("외 {n}개 — 이름으로 검색하면 나옵니다", { n: shown.length - limit })}</li>
          )}
        </ul>
      )}
    </div>
  );
}
