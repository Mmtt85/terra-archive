"use client";

// 리더기 — 스토리 전문을 원작처럼 **무대**로 재생한다 (2026-08-25).
//
// 데이터는 스크립트 JSON 의 `vn` 트랙(scripts/build-story-scripts.py) 하나뿐이다.
// 트랙은 "무대가 바뀐 줄"에만 스냅샷이 찍혀 있어서, 여기서는 줄마다 **직전 스냅샷**을
// 미리 펴 두고(stages) 현재 줄의 것만 그린다 — 상태 기계가 없다.
//
// 에셋: 배경 /story/bg/<이름>.webp · 스탠딩 /story/sprite/<base>__<표정>.webp
//       컷 CG 는 기존 /story/cut/<이름>.webp 를 그대로 쓴다 (이미 1,478장 있다).
//       셋 다 public/story 밑이라 배포 시 R2 로 나가고 Pages 파일 수에 안 잡힌다.
//
// ⚠ 스탠딩은 빌드에서 **투명 여백을 잘라** 저장한다 — 원본은 1024 캔버스에 인물이 떠
//   있어 그대로 세우면 키가 제각각이다. 그래서 여기선 높이 기준으로만 맞추면 된다.
//
// 화면 규약 (사용자 확정 2026-08-25):
//   · 기본은 **페이지 안 인라인** — 처음부터 화면을 덮지 않는다.
//   · [전체 모드]를 눌러야 화면을 덮고, 그때 오른쪽 위 ✕ 나 Esc 로 인라인으로 돌아온다.
//   · 리더기를 아예 벗어나는 건 위쪽 보기 방식 탭(전문 보기·AI 요약)이 맡는다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { asset } from "./assets";
import { useI18n } from "./i18n";
import type { ScriptEp, VnSnap } from "./story";

const hideErr = (e: { currentTarget: { style: { visibility: string } } }) => {
  e.currentTarget.style.visibility = "hidden";
};

// 대사창 글꼴(본고딕) — **리더기를 열 때 처음** 가져온다.
// ⚠ next/font 로 자체 호스팅하면 안 된다: 한글은 unicode-range 로 124조각이라
//   vinext 가 그 전부를 `Link: rel=preload` **응답 헤더 한 줄**에 넣어 헤더 한도를 넘기고,
//   프리렌더가 8,466개 라우트 전부 "Headers Overflow Error"로 죽는다 (실측 2026-08-25).
//   `preload: false` 로도 안 막힌다 — 헤더는 CSS 안의 url() 을 훑어 만든다.
// 못 받아 와도 폴백 글꼴로 그대로 읽힌다 (display=swap).
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap";

function ensureReaderFont(): void {
  if (typeof document === "undefined" || document.getElementById("vn-font")) return;
  const pre = document.createElement("link");
  pre.rel = "preconnect";
  pre.href = "https://fonts.gstatic.com";
  pre.crossOrigin = "";
  const css = document.createElement("link");
  css.id = "vn-font";
  css.rel = "stylesheet";
  css.href = FONT_CSS;
  document.head.append(pre, css);
}

/** 자동 넘김 대기(ms) — 대사가 길수록 더 오래 머문다. 앞의 1.2초는 줄과 줄 사이의
 *  숨 돌릴 틈이다 (사용자 요청 2026-08-25: "0.5초쯤 더 주라"). */
const autoDelay = (chars: number) => Math.min(7500, Math.max(1600, 1200 + chars * 70));

/** 슬롯 n개를 무대에 고르게 세울 때 k번째의 가로 위치(%) */
const slotAt = (k: number, n: number) => (100 / (n + 1)) * (k + 1);

export default function SceneMode({ ep, title, hasPrev, hasNext, onEp }: {
  ep: ScriptEp;
  title: string;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** 에피소드 이동 (-1 이전 / +1 다음) */
  onEp?: (delta: number) => void;
}) {
  const { t } = useI18n();
  const [idx, setIdx] = useState(0);
  const [full, setFull] = useState(false);
  const [auto, setAuto] = useState(false);
  const last = ep.lines.length - 1;
  const boxRef = useRef<HTMLDivElement>(null);

  // 줄마다의 무대 — vn 트랙(변화 지점만 있음)을 앞으로 펴 둔다
  const stages = useMemo(() => {
    const out: VnSnap[] = [];
    const vn = ep.vn ?? [];
    let cur: VnSnap = { i: 0 };
    let k = 0;
    for (let i = 0; i < ep.lines.length; i += 1) {
      while (k < vn.length && vn[k].i <= i) { cur = vn[k]; k += 1; }
      out.push(cur);
    }
    return out;
  }, [ep]);

  const line = ep.lines[idx];
  const stage = stages[idx] ?? {};
  const chars = stage.ch ?? [];

  const go = useCallback((delta: number) => {
    setIdx((i) => Math.min(last, Math.max(0, i + delta)));
  }, [last]);

  // 전체 모드 = 우리 오버레이 + **브라우저 전체화면**. 후자를 같이 걸어야 주소창·툴바가
  // 사라진다 (사용자 요청 2026-08-25). 지원하지 않는 환경(아이폰 사파리는 요소 전체화면이
  // 없다)에서는 조용히 실패하고 오버레이만 남는다 — 기능은 그대로 쓸 수 있다.
  const enterFull = useCallback(() => {
    setFull(true);
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    try { void (el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.()); } catch { /* 미지원 */ }
  }, []);
  const exitFull = useCallback(() => {
    setFull(false);
    const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> };
    try { if (doc.fullscreenElement) void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.()); } catch { /* 미지원 */ }
  }, []);

  const onKey = useCallback((e: { key: string; preventDefault: () => void }) => {
    if (e.key === "Escape") { if (full) { e.preventDefault(); exitFull(); } return; }
    if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter" || e.key === "PageDown") {
      e.preventDefault(); go(1); return;
    }
    if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
  }, [go, full, exitFull]);

  // 전체 모드에서만 창 전체의 키를 가져온다 — 인라인에서 가로채면 페이지 스크롤(Space)이
  // 막힌다. 인라인일 땐 무대에 포커스가 있을 때만 먹는다 (무대의 onKeyDown).
  useEffect(() => {
    if (!full) return;
    const handler = (e: KeyboardEvent) => { if (!e.isComposing) onKey(e); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [full, onKey]);

  // 브라우저 쪽에서 전체화면이 풀리면(Esc·제스처) 오버레이도 같이 내린다 — 상태가 갈리면
  // 화면은 덮여 있는데 나가는 길이 안 보인다.
  useEffect(() => {
    if (!full) return;
    const sync = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [full]);

  // 전체 모드일 때만 배경 스크롤을 잠근다 (.site-scroll 이 이 사이트의 스크롤러다)
  useEffect(() => {
    if (!full) return;
    const el = document.querySelector(".site-scroll") as HTMLElement | null;
    const prev = el?.style.overflow;
    if (el) el.style.overflow = "hidden";
    return () => { if (el) el.style.overflow = prev ?? ""; };
  }, [full]);

  // 대사가 바뀔 때마다 말풍선을 맨 위로 (긴 대사에서 이전 스크롤이 남지 않게)
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = 0; }, [idx]);

  // 대사창 글꼴은 리더기가 실제로 열렸을 때만 받아 온다
  useEffect(() => { ensureReaderFont(); }, []);

  const cutSrc = stage.cut ? asset(`/story/cut/${stage.cut}.webp`) : null;
  const bgSrc = stage.bg ? asset(`/story/bg/${stage.bg}.webp`) : null;
  const atEnd = idx >= last;

  // 자동 넘김 — 지금 줄의 글자 수로 머무는 시간을 정한다 (짧으면 빨리, 길면 천천히).
  // idx 가 바뀌면 타이머가 새로 걸리므로, 손으로 넘겨도 박자가 그 줄 기준으로 다시 잡힌다.
  useEffect(() => {
    if (!auto || atEnd) return;
    const chars = ((line?.x ?? "") + (line?.st ?? "") + (line?.loc ?? "")).length;
    const timer = setTimeout(() => go(1), autoDelay(chars));
    return () => clearTimeout(timer);
  }, [auto, atEnd, idx, line, go]);

  const body = (
    <div className={`vn-root${full ? " full" : ""}`}
      {...(full ? { role: "dialog", "aria-modal": true, "aria-label": `${title} — ${t("리더기")}` } : {})}>
      {/* 무대: 배경 → 스탠딩 → 컷 CG → 가림막 순으로 겹친다.
          ⚠ 각 층의 key 에 **그림 이름**을 넣는다 — 그래야 등장 애니메이션이 매 줄이 아니라
             그림이 실제로 바뀐 순간에만 돈다 (매 줄 깜빡이면 눈이 아프다). */}
      <div className={`vn-stage${stage.sh ? " shake" : ""}`}
        onClick={() => go(1)} onKeyDown={onKey} role="button" tabIndex={0} aria-label={t("다음 줄")}>
        {bgSrc && <img key={stage.bg} className="vn-bg" src={bgSrc} alt="" aria-hidden onError={hideErr} />}
        {chars.map(([base, expr], k) => {
          if (!base || base === "char_empty") return null;
          const dim = (stage.f ?? 0) > 0 && k !== (stage.f ?? 0) - 1;
          return (
            <img key={`${k}-${base}`} className={`vn-char${dim ? " dim" : ""}`}
              style={{ left: `${slotAt(k, chars.length)}%` }}
              src={asset(`/story/sprite/${base}__${expr}.webp`)} alt="" aria-hidden onError={hideErr} />
          );
        })}
        {cutSrc && <img key={stage.cut} className="vn-cut" src={cutSrc} alt="" aria-hidden onError={hideErr} />}
        {stage.bk && <div className="vn-blocker" style={{ background: stage.bk }} aria-hidden />}

        {/* 조작은 전부 **무대 위**에 얹는다 (사용자 지시 2026-08-25) — 화 이동·자동 넘김·
            전체 모드까지. 살짝 흐리게 떠 있다가 올리면 또렷해진다.
            ⚠ 빈 자리는 pointer-events:none 이라 눌러도 무대(다음 줄)로 통과한다. */}
        <div className="vn-top" role="presentation">
          {hasPrev && onEp && (
            <button type="button" className="vn-obtn" title={t("이전 화")} aria-label={t("이전 화")}
              onClick={(e) => { e.stopPropagation(); onEp(-1); }}>⏮</button>
          )}
          <span className="vn-top-mid">{idx + 1} / {ep.lines.length}</span>
          <button type="button" className={`vn-obtn${auto ? " on" : ""}`} disabled={atEnd}
            title={auto ? t("자동 넘김 끄기") : t("자동 넘김")} aria-label={auto ? t("자동 넘김 끄기") : t("자동 넘김")}
            onClick={(e) => { e.stopPropagation(); setAuto((v) => !v); }}>{auto ? "⏸" : "▶"}</button>
          {hasNext && onEp && (
            <button type="button" className={`vn-obtn${atEnd ? " ready" : ""}`}
              title={t("다음 화")} aria-label={t("다음 화")}
              onClick={(e) => { e.stopPropagation(); onEp(1); }}>⏭</button>
          )}
          <button type="button" className="vn-obtn"
            title={full ? t("전체 모드 끄기") : t("전체 모드")} aria-label={full ? t("전체 모드 끄기") : t("전체 모드")}
            onClick={(e) => { e.stopPropagation(); if (full) exitFull(); else enterFull(); }}>{full ? "✕" : "⛶"}</button>
        </div>

        {/* 가로모드(낮은 화면)에서만 뜨는 양옆 줄 이동 — 아래 막대를 놓을 자리가 없다
            (사용자 제보 2026-08-25: 가로로 돌리면 버튼 글자가 세로로 눌린다). */}
        <button type="button" className="vn-arrow left" aria-label={t("이전 줄")} disabled={idx === 0}
          onClick={(e) => { e.stopPropagation(); go(-1); }}>‹</button>
        <button type="button" className="vn-arrow right" aria-label={t("다음 줄")} disabled={atEnd}
          onClick={(e) => { e.stopPropagation(); go(1); }}>›</button>

        {/* 대사창 — ⚠ 줄마다 애니메이션을 걸지 말 것. 글자가 매 줄 깜빡여 읽기 힘들다
            (사용자 지적 2026-08-25). 바뀌는 건 글자뿐이라 전환 효과가 필요 없다. */}
        <div className="vn-box" ref={boxRef}
          onClick={(e) => { e.stopPropagation(); go(1); }} role="presentation">
          {line?.loc && <p className="vn-loc">{line.loc}</p>}
          {line?.opts && (
            <div className="vn-opts"><i>{t("선택지")}</i>{line.opts.map((o, j) => <span key={j}>{o}</span>)}</div>
          )}
          {line?.br != null && <p className="vn-br">▼ {t("분기")}</p>}
          {line?.st && <p className="vn-st">{line.st}</p>}
          {line?.n && <p className="vn-name">{line.n}</p>}
          {line?.x && <p className={line.n ? "vn-say" : "vn-narr"}>{line.x}</p>}
          {!line?.x && !line?.st && !line?.opts && line?.br == null && !line?.loc && (
            <p className="vn-narr vn-beat">— {t("장면 전환")} —</p>
          )}
        </div>
      </div>

      {/* 아래 막대에는 줄 이동만 남는다 — 나머지는 전부 무대 위로 올라갔다.
          가로모드에서는 이 막대를 감추고 무대 양옆 화살표가 대신한다. */}
      <div className="vn-bar">
        <div className="vn-nav">
          <button type="button" onClick={() => go(-1)} disabled={idx === 0}>← {t("이전 줄")}</button>
          <span className="vn-count">{idx + 1} / {ep.lines.length}</span>
          <button type="button" onClick={() => go(1)} disabled={atEnd}>{t("다음 줄")} →</button>
        </div>
        {full && <span className="vn-title">{title}</span>}
        {atEnd && !(hasNext && onEp) && <span className="vn-count">{t("마지막 화입니다")}</span>}
      </div>
      <p className="vn-hint">
        {full ? t("클릭 · Space · → 다음 · ← 이전 · Esc 전체 모드 끄기")
          : t("클릭하면 한 줄씩 넘어갑니다 · 전체 모드에서는 키보드로도 넘길 수 있어요")}
      </p>
    </div>
  );

  // 전체 모드일 때만 body 포털 — 인라인일 땐 페이지 흐름 안에 그대로 있는다
  return full ? createPortal(body, document.body) : body;
}
