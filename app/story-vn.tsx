"use client";

// 장면 모드 — 스토리 전문을 원작처럼 **무대**로 재생한다 (2026-08-25 파일럿: act6d5).
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { asset } from "./assets";
import { useI18n } from "./i18n";
import type { ScriptEp, VnSnap } from "./story";

const hideErr = (e: { currentTarget: { style: { visibility: string } } }) => {
  e.currentTarget.style.visibility = "hidden";
};

/** 슬롯 n개를 무대에 고르게 세울 때 k번째의 가로 위치(%) */
const slotAt = (k: number, n: number) => (100 / (n + 1)) * (k + 1);

export default function SceneMode({ ep, title, startAt = 0, hasPrev, hasNext, onEp, onClose }: {
  ep: ScriptEp;
  title: string;
  startAt?: number;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** 에피소드 이동 (-1 이전 / +1 다음) */
  onEp?: (delta: number) => void;
  /** 닫기 — 마지막으로 보던 줄 번호를 넘겨 글 읽기가 그 자리로 갈 수 있게 한다 */
  onClose: (lineIdx: number) => void;
}) {
  const { t } = useI18n();
  const [idx, setIdx] = useState(() => Math.min(Math.max(0, startAt), Math.max(0, ep.lines.length - 1)));
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Escape") { e.preventDefault(); onClose(idx); return; }
      if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter" || e.key === "PageDown") {
        e.preventDefault(); go(1); return;
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, idx, onClose]);

  // 배경 스크롤 잠금 (오퍼 모달과 같은 규약 — .site-scroll 이 스크롤러다)
  useEffect(() => {
    const el = document.querySelector(".site-scroll") as HTMLElement | null;
    const prev = el?.style.overflow;
    if (el) el.style.overflow = "hidden";
    return () => { if (el) el.style.overflow = prev ?? ""; };
  }, []);

  // 대사가 바뀔 때마다 말풍선을 맨 위로 (긴 대사에서 이전 스크롤이 남지 않게)
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = 0; }, [idx]);

  const cutSrc = stage.cut ? asset(`/story/cut/${stage.cut}.webp`) : null;
  const bgSrc = stage.bg ? asset(`/story/bg/${stage.bg}.webp`) : null;
  const atEnd = idx >= last;

  return createPortal(
    <div className="vn-root" role="dialog" aria-modal="true" aria-label={`${title} — ${t("장면 모드")}`}>
      {/* 무대: 배경 → 스탠딩 → 컷 CG → 가림막 순으로 겹친다 */}
      <div className={`vn-stage${stage.sh ? " shake" : ""}`} key={`${stage.i}-${stage.sh ?? 0}`}
        onClick={() => go(1)} role="presentation">
        {bgSrc && <img className="vn-bg" src={bgSrc} alt="" aria-hidden onError={hideErr} />}
        {chars.map(([base, expr], k) => {
          if (!base || base === "char_empty") return null;
          const dim = (stage.f ?? 0) > 0 && k !== (stage.f ?? 0) - 1;
          return (
            <img key={`${k}-${base}-${expr}`} className={`vn-char${dim ? " dim" : ""}`}
              style={{ left: `${slotAt(k, chars.length)}%` }}
              src={asset(`/story/sprite/${base}__${expr}.webp`)} alt="" aria-hidden onError={hideErr} />
          );
        })}
        {cutSrc && <img className="vn-cut" src={cutSrc} alt="" aria-hidden onError={hideErr} />}
        {stage.bk && <div className="vn-blocker" style={{ background: stage.bk }} aria-hidden />}

        {/* 대사창 */}
        <div className="vn-box" ref={boxRef} onClick={(e) => { e.stopPropagation(); go(1); }} role="presentation">
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

      {/* 조작 막대 */}
      <div className="vn-bar">
        <button type="button" className="vn-x" onClick={() => onClose(idx)} aria-label={t("장면 모드 닫기")}>✕</button>
        <span className="vn-title">{title}</span>
        <button type="button" onClick={() => go(-1)} disabled={idx === 0}>← {t("이전 줄")}</button>
        <span className="vn-count">{idx + 1} / {ep.lines.length}</span>
        <button type="button" onClick={() => go(1)} disabled={atEnd}>{t("다음 줄")} →</button>
        {atEnd && hasNext && onEp && (
          <button type="button" className="vn-nextep" onClick={() => onEp(1)}>{t("다음 에피소드")} ⏭</button>
        )}
        {atEnd && !hasNext && <span className="vn-count">{t("마지막 화입니다")}</span>}
        {idx === 0 && hasPrev && onEp && (
          <button type="button" className="vn-nextep" onClick={() => onEp(-1)}>⏮ {t("이전 에피소드")}</button>
        )}
      </div>
      <p className="vn-hint">{t("클릭 · Space · → 다음 · ← 이전 · Esc 닫기")}</p>
    </div>,
    document.body);
}
