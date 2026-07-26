"use client";

// 팁 풍선 — 화면 빈 곳을 찾아 떠다니는 힌트 (사용자 요청 2026-07-27:
// "한곳에 고정으로 나오면 안되고, 본문이나 컨텐츠를 가려선 안됨. 간단한 제목이랑,
//  풍선을 누르면 그자리에서 커져서 이미지 + 설명 같은걸 보여줄 수 있어야 함").
//
// 가리지 않는 방법: 화면 격자 후보마다 **풍선 크기의 사각형 9점을 elementFromPoint로 찍어**
// 글자·이미지·카드가 하나라도 걸리면 그 자리를 버린다. 스크롤·탭 전환·창 크기 변경으로
// 자리가 더럽혀지면 감시 타이머가 즉시 다른 빈 곳으로 옮긴다.
// 내용은 Supabase `tips` 테이블 (docs/supabase-tips.sql) — /admin에서 넣으면 배포 없이 반영.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "./i18n";
import { fetchTips, tipTitle, tipBody, tipImage, type TipRow } from "./tips-api";

const DISMISS_KEY = "ta-tip-off";   // 값 = 다시 보여도 되는 시각(ms)
const DISMISS_HOURS = 12;
const FIRST_DELAY_MS = 5000;        // 들어오자마자 튀어나오지 않게
const ROAM_MS = 17_000;             // 자리 옮기고 다음 팁으로
const WATCH_MS = 2500;              // 자리가 더럽혀졌는지 감시
const COLLAPSED = { w: 252, h: 40 };
const EXPANDED_W = 330;
const MARGIN = 12;

// ── 빈 자리 찾기 ──────────────────────────────────────────────────────────────
// 이 태그들은 그 자체가 눈에 보이는 내용이다 (글자가 없어도 가리면 안 된다)
const CONTENT_TAG = /^(IMG|SVG|CANVAS|VIDEO|IFRAME|BUTTON|INPUT|SELECT|TEXTAREA|A|H1|H2|H3|H4|H5|H6|B|STRONG|EM|I|CODE|SMALL|LABEL|TIME|LI|TD|TH|SUMMARY|HR)$/;

function paintsContent(el: Element, pageBg: string): boolean {
  if (CONTENT_TAG.test(el.tagName)) return true;
  // 컨테이너라도 자기 자식으로 글자를 직접 갖고 있으면 내용이다
  for (const node of el.childNodes) {
    if (node.nodeType === 3 && (node.textContent ?? "").trim()) return true;
  }
  const cs = getComputedStyle(el);
  if (cs.backgroundImage !== "none") return true;
  const bg = cs.backgroundColor;
  if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent" && bg !== pageBg) return true;
  // 카드·패널의 테두리
  if (parseFloat(cs.borderTopWidth) > 0.5 || parseFloat(cs.borderLeftWidth) > 0.5
    || parseFloat(cs.borderRightWidth) > 0.5 || parseFloat(cs.borderBottomWidth) > 0.5) return true;
  return false;
}

/** 사각형 안 9점을 찍어 전부 배경이면 true */
function rectFree(x: number, y: number, w: number, h: number, pageBg: string): boolean {
  for (const cx of [x + 3, x + w / 2, x + w - 3]) {
    for (const cy of [y + 3, y + h / 2, y + h - 3]) {
      const el = document.elementFromPoint(cx, cy);
      if (!el) continue;                        // 화면 밖 — 빈 것으로 본다
      if (el.closest(".tip-balloon")) continue; // 자기 자신은 무시
      if (paintsContent(el, pageBg)) return false;
    }
  }
  return true;
}

type Spot = { x: number; y: number };

/** 화면 격자에서 빈 자리를 골라 준다 (없으면 null). avoid에서 먼 쪽·가장자리를 선호. */
function findSpot(w: number, h: number, avoid: Spot | null): Spot | null {
  const pageBg = getComputedStyle(document.body).backgroundColor;
  const header = document.querySelector(".site-header");
  const top = Math.max(MARGIN, (header?.getBoundingClientRect().bottom ?? 0) + 10);
  const maxX = window.innerWidth - w - MARGIN;
  const maxY = window.innerHeight - h - MARGIN;
  if (maxX < MARGIN || maxY < top) return null;

  const cols = 9, rows = 7;
  const cx0 = window.innerWidth / 2, cy0 = window.innerHeight / 2;
  const cands: (Spot & { score: number })[] = [];
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      // 정수 좌표로 — 소수점에 놓이면 글자가 흐리게 렌더된다
      const x = Math.round(MARGIN + ((maxX - MARGIN) * i) / (cols - 1));
      const y = Math.round(top + ((maxY - top) * j) / (rows - 1));
      if (!rectFree(x, y, w, h, pageBg)) continue;
      const edge = Math.hypot(x + w / 2 - cx0, y + h / 2 - cy0);   // 가운데(본문)에서 먼 쪽
      const far = avoid ? Math.hypot(x - avoid.x, y - avoid.y) : 0; // 직전 자리에서 먼 쪽
      cands.push({ x, y, score: edge + far * 0.6 + Math.random() * 140 });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  return cands[Math.floor(Math.random() * Math.min(4, cands.length))];
}

// 다크 모드 구독 (about.tsx와 같은 방식 — html.dark 관찰)
const subscribeDark = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
};
const useDark = () => useSyncExternalStore(
  subscribeDark,
  () => document.documentElement.classList.contains("dark"),
  () => false,
);

const dismissedNow = (): boolean => {
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Number.isFinite(until) && Date.now() < until;
  } catch { return false; }
};

export default function TipBalloon() {
  const { locale, t } = useI18n();
  const localeBase = locale === "ko" ? "" : `/${locale}`;
  const dark = useDark();
  const [tips, setTips] = useState<TipRow[]>([]);
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [open, setOpen] = useState(false);      // 펼침
  const [gone, setGone] = useState(true);       // 마운트 전·닫음
  const hovering = useRef(false);               // 마우스가 올라가 있으면 자리를 옮기지 않는다
  const openRef = useRef(false);
  openRef.current = open;
  const boxRef = useRef<HTMLDivElement>(null);

  // 팁 로드 — 실패하면 조용히 아무것도 띄우지 않는다 (테이블 미설치 포함)
  useEffect(() => {
    if (dismissedNow()) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      fetchTips()
        .then((rows) => {
          if (!alive || !rows.length) return;
          setTips(rows);
          setIndex(Math.floor(Math.random() * rows.length));
          setGone(false);
        })
        .catch(() => { /* 조용히 숨김 */ });
    }, FIRST_DELAY_MS);
    return () => { alive = false; window.clearTimeout(timer); };
  }, []);

  // 펼치면 카드 높이가 내용에 따라 달라진다 — **실측해서** 화면 밖으로 나간 만큼 되민다.
  // transform은 transition 목록에 없어 즉시 보정되고, 안쪽 카드의 등장 애니메이션과도 안 겹친다.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.transform = "";
    const r = el.getBoundingClientRect();
    let dx = 0, dy = 0;
    if (r.right > window.innerWidth - MARGIN) dx = window.innerWidth - MARGIN - r.right;
    if (r.bottom > window.innerHeight - MARGIN) dy = window.innerHeight - MARGIN - r.bottom;
    if (r.left + dx < MARGIN) dx = MARGIN - r.left;
    if (r.top + dy < MARGIN) dy = MARGIN - r.top;
    el.style.transform = dx || dy ? `translate(${Math.round(dx)}px, ${Math.round(dy)}px)` : "";
  });

  const place = useCallback((next: boolean) => {
    if (openRef.current || hovering.current) return;   // 펼쳐져 있거나 만지는 중이면 그대로
    const found = findSpot(COLLAPSED.w, COLLAPSED.h, spot);
    if (found) setSpot(found);
    else setSpot(null);                                // 빈 곳이 없으면 잠시 숨는다
    if (next) setIndex((i) => (i + 1) % Math.max(1, tips.length));
  }, [spot, tips.length]);
  // 타이머가 첫 렌더의 place를 붙잡고 있으면 '직전 자리에서 멀리'가 늘 null 기준이 된다 —
  // 최신 place를 ref로 넘겨 준다 (타이머는 재설치하지 않는다)
  const placeRef = useRef(place);
  placeRef.current = place;

  // 첫 배치 + 주기적 이동 + 자리 감시(스크롤·탭 전환·모달로 더럽혀지면 즉시 옮김)
  useEffect(() => {
    if (gone || !tips.length) return;
    placeRef.current(false);
    const roam = window.setInterval(() => placeRef.current(true), ROAM_MS);
    const watch = window.setInterval(() => {
      if (openRef.current || hovering.current) return;
      // 모달이 열려 있으면 잠시 비운다 (백드롭 뒤에서 어른거리지 않게)
      if (document.querySelector(".modal-backdrop")) { setSpot(null); return; }
      setSpot((cur) => {
        if (!cur) { const f = findSpot(COLLAPSED.w, COLLAPSED.h, null); return f; }
        const pageBg = getComputedStyle(document.body).backgroundColor;
        if (rectFree(cur.x, cur.y, COLLAPSED.w, COLLAPSED.h, pageBg)) return cur;
        return findSpot(COLLAPSED.w, COLLAPSED.h, cur);
      });
    }, WATCH_MS);
    const onResize = () => placeRef.current(false);
    window.addEventListener("resize", onResize);
    return () => { window.clearInterval(roam); window.clearInterval(watch); window.removeEventListener("resize", onResize); };
  }, [gone, tips.length]);

  // Esc로 접기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (gone || !spot || !tips.length) return null;
  const tip = tips[index % tips.length];
  if (!tip) return null;

  // 가로는 여기서 가두고, 세로(카드 높이는 내용마다 다름)는 위 useLayoutEffect가 실측 보정한다
  const width = open ? EXPANDED_W : COLLAPSED.w;
  const left = Math.max(MARGIN, Math.min(spot.x, window.innerWidth - width - MARGIN));
  const top = Math.max(MARGIN, spot.y);
  const img = tipImage(tip, dark);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_HOURS * 3600_000)); } catch { /* 무시 */ }
    setGone(true);
  };

  return createPortal(
    <div
      ref={boxRef}
      className={`tip-balloon${open ? " open" : ""}`}
      style={{ left, top, width: open ? EXPANDED_W : undefined }}
      onMouseEnter={() => { hovering.current = true; }}
      onMouseLeave={() => { hovering.current = false; }}
      role="complementary"
      aria-label={t("사이트 이용 팁")}
    >
      {!open ? (
        <button type="button" className="tip-head" onClick={() => setOpen(true)} aria-expanded={false}>
          <span className="tip-mark" aria-hidden>💡</span>
          <span className="tip-title">{tipTitle(tip, locale)}</span>
          <span className="tip-more" aria-hidden>＋</span>
        </button>
      ) : (
        <div className="tip-card">
          <div className="tip-card-head">
            <span className="tip-mark" aria-hidden>💡</span>
            <b>{tipTitle(tip, locale)}</b>
            <button type="button" className="tip-close" onClick={() => setOpen(false)} aria-label={t("접기")}>×</button>
          </div>
          {img && <img className="tip-shot" src={img} alt="" loading="lazy" decoding="async" />}
          <p className="tip-body">{tipBody(tip, locale)}</p>
          <div className="tip-actions">
            {tip.href && (
              <a className="tip-go" href={tip.href.startsWith("/") ? `${localeBase}${tip.href}` : tip.href}>
                {t("바로가기")} →
              </a>
            )}
            <button type="button" className="tip-off" onClick={dismiss}>{t("팁 그만 보기")}</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
