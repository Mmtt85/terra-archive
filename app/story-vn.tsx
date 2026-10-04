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
//
// 소리 (2026-09-27): 스크립트 JSON 의 `au` 트랙 → story-audio.ts 가 Web Audio 로 튼다.
//   무대(vn)와 같은 규약 — 줄마다 직전 소리 스냅샷을 펴 두고 지금 줄의 것을 건다. 효과음은 줄을
//   **넘어온 순간**에만 울린다. 브라우저 자동재생 정책 때문에 리더기를 처음 누를 때 소리가 켜진다.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { asset, storyCutUrl } from "./assets";
import { useI18n } from "./i18n";
import type { ScriptEp, VnSnap } from "./story";
import { getSound, setSound, SOUND_DEFAULT, storyAudio, subscribeSound, type AuSnap } from "./story-audio";

const hideErr = (e: { currentTarget: { style: { visibility: string } } }) => {
  e.currentTarget.style.visibility = "hidden";
};

// 대사창 글꼴(본고딕) — **리더기를 열 때 처음** 가져온다.
// ⚠ next/font 로 자체 호스팅하면 안 된다: 한글은 unicode-range 로 124조각이라
//   vinext 가 그 전부를 `Link: rel=preload` **응답 헤더 한 줄**에 넣어 헤더 한도를 넘기고,
//   프리렌더가 8,466개 라우트 전부 "Headers Overflow Error"로 죽는다 (실측 2026-08-25).
//   `preload: false` 로도 안 막힌다 — 헤더는 CSS 안의 url() 을 훑어 만든다.
// 못 받아 와도 폴백 글꼴로 그대로 읽힌다 (display=swap).
// 고운돋움 — 본고딕(Noto Sans KR)이 "너무 딱딱하다"는 지적으로 바꿨다 (2026-08-25).
// 획 끝이 살짝 둥근 인간미 있는 고딕이라 무대 위 대사에 더 어울린다.
// ⚠ 굵기가 400 하나뿐이다 — 화자 이름은 굵게 대신 색(라임)과 자간으로 세운다.
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Gowun+Dodum&display=swap";

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

/** 소리 켜기/끄기 아이콘 — 다른 버튼(⏮ ⏭ ⛶)처럼 단색이어야 해서 이모지(🔊) 대신 선 그림 */
function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" stroke="none" />
      {on
        ? <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>
        : <><path d="m16 9.5 5 5" /><path d="m21 9.5-5 5" /></>}
    </svg>
  );
}

/** 지금 줄 뒤 몇 줄에서 울릴 소리 — 미리 받아 둔다 (곡은 받는 데 1~2초 걸린다) */
const AHEAD = 12;
function upcoming(au: AuSnap[], idx: number, cur: AuSnap | null): string[] {
  const ids = new Set<string>();
  const take = (a: AuSnap | null) => {
    if (!a) return;
    if (a.m) ids.add(a.m);
    if (a.mi) ids.add(a.mi);
    for (const [id] of Object.values(a.lp ?? {})) ids.add(id);
    for (const [id] of a.se ?? []) ids.add(id);
  };
  take(cur);
  for (const a of au) {
    if (a.i > idx + AHEAD) break;
    if (a.i > idx) take(a);
  }
  return [...ids];
}

export default function SceneMode({ ep, title, hasPrev, hasNext, onEp, startLine }: {
  ep: ScriptEp;
  /** 처음 보여 줄 줄(0부터) — 갤러리 CG '스토리에서 보기' (2026-10-04). 화가 바뀌면 key 로 다시 마운트돼 0부터 */
  startLine?: number;
  title: string;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** 에피소드 이동 (-1 이전 / +1 다음) */
  onEp?: (delta: number) => void;
}) {
  const { t } = useI18n();
  const [idx, setIdx] = useState(() => Math.max(0, Math.min(startLine ?? 0, ep.lines.length - 1)));
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

  // 줄마다의 소리 — au 트랙도 같은 방식으로 편다 (소리가 한 번도 안 바뀐 앞부분은 null = 무음)
  const au = ep.au;
  const hasAudio = !!au && au.length > 0;
  const sounds = useMemo(() => {
    const out: (AuSnap | null)[] = [];
    const track = au ?? [];
    let cur: AuSnap | null = null;
    let k = 0;
    for (let i = 0; i < ep.lines.length; i += 1) {
      while (k < track.length && track[k].i <= i) { cur = track[k]; k += 1; }
      out.push(cur);
    }
    return out;
  }, [ep, au]);
  const snd = useSyncExternalStore(subscribeSound, getSound, () => SOUND_DEFAULT);
  const soundOn = hasAudio && snd.on;

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

  const onKey = useCallback((e: { key: string; preventDefault: () => void; stopPropagation?: () => void }) => {
    // ⚠ 전체 모드의 Esc 는 **전체화면만** 닫는다 — 전파를 끊지 않으면 layout.tsx 의 전역 Esc
    //    처리기가 뒤이어 밑에 깔린 창까지 닫는다. 스토리 상세에선 리더기 아래에 창이 없어
    //    안 드러났지만, 오퍼 기록 모달 안에서 열면 Esc 한 번에 기록 창까지 사라졌다
    //    (2026-09-04). 아래 리스너를 **캡처 단계**로 두는 것과 한 쌍이다 — 전역 처리기는
    //    document 버블이라 그냥 두면 이쪽보다 먼저 돈다.
    if (e.key === "Escape") { if (full) { e.preventDefault(); e.stopPropagation?.(); exitFull(); } return; }
    if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter" || e.key === "PageDown") {
      e.preventDefault(); go(1); return;
    }
    if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
  }, [go, full, exitFull]);

  // 소리는 사용자 조작 안에서만 켤 수 있다 (자동재생 정책) — 리더기 안의 클릭·키를 **캡처 단계**에서
  // 받아 깨운다. 버튼들이 전파를 끊어도(stopPropagation) 캡처는 먼저 온다.
  const wake = useCallback(() => { if (soundOn) storyAudio.unlock(); }, [soundOn]);

  // 전체 모드에서만 창 전체의 키를 가져온다 — 인라인에서 가로채면 페이지 스크롤(Space)이
  // 막힌다. 인라인일 땐 무대에 포커스가 있을 때만 먹는다 (무대의 onKeyDown).
  useEffect(() => {
    if (!full) return;
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      wake();
      // 음량 막대에 포커스가 있으면 방향키는 막대 몫이다 (줄을 넘기지 않는다)
      if (e.key !== "Escape" && (e.target as HTMLElement | null)?.tagName === "INPUT") return;
      onKey(e);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [full, onKey, wake]);

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

  // 소리 — 줄이 바뀔 때마다 그 줄의 상태(곡·반복음)를 건다. 효과음은 줄을 **넘어온 순간**에만
  // 울린다 — 첫 화면이나 소리를 막 켰을 때 같은 줄을 다시 걸면서 효과음이 또 나면 안 된다.
  const lastIdx = useRef<number | null>(null);
  useEffect(() => {
    const moved = lastIdx.current !== null && lastIdx.current !== idx;
    lastIdx.current = idx;
    if (!soundOn || !au) return;
    const snap = sounds[idx] ?? null;
    storyAudio.apply(snap, moved && snap?.i === idx);
    storyAudio.prefetch(upcoming(au, idx, snap));
  }, [idx, soundOn, sounds, au]);
  useEffect(() => { if (!soundOn) storyAudio.silence(); }, [soundOn]);
  useEffect(() => { storyAudio.setVolume(snd.vol); }, [snd.vol]);
  // 리더기를 벗어나면(화 이동·보기 전환·창 닫기) 멈춘다 — 다음 화는 새로 마운트되며 제 곡을 건다
  useEffect(() => () => storyAudio.silence(), []);

  const cutSrc = stage.cut ? storyCutUrl(stage.cut) : null;
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
    <div className={`vn-root${full ? " full" : ""}`} onClickCapture={wake} onKeyDownCapture={wake}
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
          {full && <span className="vn-top-title">{title}</span>}
          {/* 소리 — 소리 트랙이 있는 화에만. 음량 막대는 마우스를 올리면 왼쪽으로 펼쳐진다
              (폰은 기기 음량 버튼이 있어 막대를 안 띄운다). */}
          {hasAudio && (
            <div className={`vn-snd${snd.on ? "" : " off"}`}>
              <input type="range" className="vn-vol" min={0} max={1} step={0.05} value={snd.vol}
                aria-label={t("음량")} disabled={!snd.on}
                onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => setSound({ ...snd, vol: Number(e.target.value) })} />
              <button type="button" className={`vn-obtn${snd.on ? "" : " mute"}`} aria-pressed={snd.on}
                title={snd.on ? t("소리 끄기") : t("소리 켜기")} aria-label={snd.on ? t("소리 끄기") : t("소리 켜기")}
                onClick={(e) => {
                  e.stopPropagation();
                  // 켜는 클릭은 캡처 단계에선 아직 꺼진 상태라 wake 가 안 돈다 — 여기서 직접 깨운다
                  if (!snd.on) storyAudio.unlock();
                  setSound({ ...snd, on: !snd.on });
                }}><SpeakerIcon on={snd.on} /></button>
            </div>
          )}
          {/* 자동 진행 — 아이콘(▶)은 무슨 뜻인지 헷갈린다는 지적으로 글자로 바꿨다 (2026-08-25) */}
          <button type="button" className={`vn-obtn vn-auto${auto ? " on" : ""}`} disabled={atEnd}
            title={auto ? t("자동 넘김 끄기") : t("자동 넘김")} aria-label={auto ? t("자동 넘김 끄기") : t("자동 넘김")}
            onClick={(e) => { e.stopPropagation(); setAuto((v) => !v); }}>AUTO</button>
          {hasNext && onEp && (
            <button type="button" className={`vn-obtn${atEnd ? " ready" : ""}`}
              title={t("다음 화")} aria-label={t("다음 화")}
              onClick={(e) => { e.stopPropagation(); onEp(1); }}>⏭</button>
          )}
          <button type="button" className="vn-obtn"
            title={full ? t("전체 모드 끄기") : t("전체 모드")} aria-label={full ? t("전체 모드 끄기") : t("전체 모드")}
            onClick={(e) => { e.stopPropagation(); if (full) exitFull(); else enterFull(); }}>{full ? "✕" : "⛶"}</button>
        </div>

        {/* 줄 이동은 **무대 안 양옆**이 전부다 (사용자 확정 2026-08-25: "모바일 가로모드처럼
            전부 통일"). 아래 막대와 거기 있던 페이지 번호는 없앴다 — 번호는 왼쪽 위에 있다. */}
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

      <p className="vn-hint">
        {full ? t("클릭 · Space · → 다음 · ← 이전 · Esc 전체 모드 끄기")
          : t("클릭하면 한 줄씩 넘어갑니다 · 전체 모드에서는 키보드로도 넘길 수 있어요")}
      </p>
    </div>
  );

  // 전체 모드일 때만 body 포털 — 인라인일 땐 페이지 흐름 안에 그대로 있는다
  return full ? createPortal(body, document.body) : body;
}
