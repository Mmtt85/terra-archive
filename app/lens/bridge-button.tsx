"use client";

// 게임 연결 표시 — **토스트**로 항상 최상위에 떠 있다 (사용자 확정 2026-07-26:
// "모달창이 뜨면 뒷쪽이 어두워지니까" 헤더 인라인 대신 z-index 최상위 토스트 + 연결해제 버튼).
// 연결 자체는 /rogue 각 테마의 게임 연결 버튼에서 한다 (BridgeTopicButton — 테마 하드 고정).
// 연결 전에는 아무것도 그리지 않는다.

import { NewBadge } from "../new-badge";
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { isOwnerUid } from "../visit-track";
import { Thumb } from "./thumb";
import { coachPcLoad, coachReact, coachVoteFx, EMOTES, coachTitle, setCoachTitle, TITLE_MAX, coachPublic, setCoachPublic, QUALITIES, coachQuality, setCoachQuality, coachStats, coachReacts, emoteUrl, EMOTE_LABEL, coachVotes, msgName, coachState, cardKey, onCoachChange, startCoach, stopCoach, COACH_MAX, coachChat, coachChatRead, coachSay, coachName, setCoachName, setCoachChatOff, CHAT_MAX, NAME_MAX } from "./coach";
import { useBridgeStatus, connectBridge, disconnectBridge, clearBridgeError, bridgeNotArknights, bridgeArkThumb, confirmArknights, bridgeLock, bridgeSupported, bridgeOnMobile, bridgeLogCount, bridgeLastScan, markBridgeWrong, bridgePipNode, bridgePipRelics, bridgePipRecruit, bridgePipFloor, bridgeSession, forceBridgeRescan, setBridgePipActive, type BridgeLock, type BridgePipCard } from "./bridge";
import { isNewFeature } from "../whats-new";
import { useHashSync } from "../hash-modal";
import type { T } from "../i18n";

// 지원 여부는 navigator를 봐야 알 수 있어 서버에선 판단할 수 없다. 그냥 호출하면
// 서버(없음)와 클라이언트(있음)의 렌더 결과가 갈려 하이드레이션이 깨지므로(React #418),
// 서버 스냅샷을 false로 고정하는 useSyncExternalStore로 읽는다.
const noSubscribe = () => () => { /* 값이 바뀌지 않는다 */ };

const PHASE: Record<string, string> = {
  moving: "화면 변하는 중", settling: "멈추길 기다리는 중", same: "같은 화면", emit: "새 화면",
  battle: "전투 중", replay: "본 화면 재적용",
};

// ── 작은 창(문서 PiP, 2026-10-12 시험판) ─────────────────────────────────────────────
// 크롬·엣지(116+)의 Document Picture-in-Picture — 다른 프로그램(게임) 위에 **항상 떠 있는** 작은 창에 우리 화면을 그린다.
// 게임을 크게 띄운 채 방금 인식한 소장품 효과·작전 이름을 볼 수 있다. 창은 사용자 클릭으로만 열린다(브라우저 규칙).
// 같은 React 트리에서 createPortal 로 그 창 문서에 그린다 — 스타일시트는 열 때 복사한다.
type DocPip = { requestWindow: (o: { width: number; height: number }) => Promise<Window>; window: Window | null };
const docPip = (): DocPip | undefined => (typeof window !== "undefined" ? (window as unknown as { documentPictureInPicture?: DocPip }).documentPictureInPicture : undefined);

async function openPipWindow(): Promise<Window | null> {
  const dp = docPip();
  if (!dp) return null;
  const w = await dp.requestWindow({ width: 380, height: 640 }); // 두 칸(노드·소장품)이라 종전 460 보다 높게
  for (const sh of [...document.styleSheets]) {
    try {
      const st = w.document.createElement("style");
      st.textContent = [...sh.cssRules].map((r) => r.cssText).join("\n");
      w.document.head.append(st);
    } catch {
      if (sh.href) { const l = w.document.createElement("link"); l.rel = "stylesheet"; l.href = sh.href; w.document.head.append(l); }
    }
  }
  // 라이트·다크 테마만 — 통합전략 테마 클래스(rg-theme·rgN)는 본문에 테마 그라데이션을 깔아 작은 창 배경을 덮는다
  w.document.documentElement.className = document.documentElement.className.split(/\s+/).filter((c) => c && !/^rg/.test(c)).join(" ");
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme) w.document.documentElement.setAttribute("data-theme", theme);
  w.document.title = "PRTS";
  w.document.body.className = "bridge-pip-body";
  return w;
}

// 작은 창은 **연결과 따로** 산다 — 먼저 띄우고 그 안에서 연결할 수 있게 (사용자 지시 2026-10-12 "창부터 띄우고 거기서 연결").
// 그래서 창 상태를 컴포넌트가 아니라 모듈에 두고, 툴바(BridgeTopicButton)·토스트(BridgeButton) 어디서든 연다.
let pipWin: Window | null = null;
let pipLock: BridgeLock | null = null;   // 작은 창에서 '연결'을 누르면 이 테마로 고정 연결
const pipSubs = new Set<() => void>();
const pipNotify = () => { for (const cb of pipSubs) cb(); };
const pipSubscribe = (cb: () => void) => { pipSubs.add(cb); return () => { pipSubs.delete(cb); }; };
const usePipWin = () => useSyncExternalStore(pipSubscribe, () => pipWin, () => null);
/** 작은 창 창(Window) — 통합전략 페이지가 본 화면 상시 창 내용을 작은 창의 자리(#ta-pip-slot)에 그대로 그린다 (rogue.tsx) */
export const useBridgePipWindow = usePipWin;
// 작은 창 내용을 바깥(통합전략 페이지)이 그린다 — 켜져 있으면 작은 창은 머리·자리만 그린다 (사용자 지시 2026-10-13 "본 화면 노드 레이아웃이랑 pip 레이아웃이 다르다 — 본 화면으로 맞춰")
let pipExternal = false;
export function setBridgePipExternal(v: boolean): void { if (pipExternal !== v) { pipExternal = v; pipNotify(); } }
const usePipExternal = () => useSyncExternalStore(pipSubscribe, () => pipExternal, () => false);
async function togglePipWindow(lockFor?: BridgeLock | null): Promise<void> {
  if (pipWin) { pipWin.close(); pipWin = null; setBridgePipActive(false); pipNotify(); return; }
  try {
    const w = await openPipWindow();
    if (!w) return;
    if (lockFor) pipLock = lockFor;
    w.addEventListener("pagehide", () => { if (pipWin === w) { pipWin = null; setBridgePipActive(false); pipNotify(); } }, { once: true });
    pipWin = w;
    setBridgePipActive(true);
    pipNotify();
  } catch { /* 사용자가 막았거나 미지원 */ }
}
// 문서 PiP 를 지원하는 브라우저(크롬·엣지 116+)면 누구나 — 운영자 전용 시험판(2026-10-12)을 2026-10-13 공개 (사용자 지시 "공개해 얼른")
const usePipOk = () => useSyncExternalStore(noSubscribe, () => !!docPip(), () => false);

/** 카드 하나 — 섬네일 + 이름 + 효과. 펼칠 게 있으면(작전 지도·등장 적·선택지) 눌러서 펼친다 (사용자 지시 2026-10-12
 *  "작전이 인식돼서 떴고 그걸 클릭하면 작전맵이 떴으면") */
/** 틀렸어요 — 누르면 작은 모달이 떠서 뭐가 틀렸는지 한 줄 적어 보낸다(비워도 된다). 화면·OCR 기록과 함께 간다 (2026-10-13).
 *  모달은 이 버튼이 그려진 창(본 화면 또는 작은 창) 안에 고정 위치로 — 공용 ModalWindow 는 본 화면 body 로 포털돼 작은 창에선 안 보인다 */
function WrongButton({ t, cls }: { t: T; cls: string }) {
  const [open, setOpen] = useState<HTMLElement | null>(null);   // 열려 있으면 모달을 그릴 자리
  const [memo, setMemo] = useState("");
  const send = () => { markBridgeWrong(memo); setOpen(null); setMemo(""); };
  // ⚠ 모달은 버튼 옆이 아니라 그 창의 맨 바깥에 그린다 — 머리줄(backdrop-filter)·알림창(transform) 안에서 position:fixed 는
  //   화면이 아니라 그 상자를 기준으로 붙어 위쪽에 반쯤 걸렸다 (사용자 지적 2026-10-13). 작은 창이면 그 창의 테마 상자, 아니면 body
  const where = (el: HTMLElement) => (el.closest(".bridge-pip") as HTMLElement | null) ?? el.ownerDocument.body;
  return (<>
    <button type="button" className={`bridge-toast-off bridge-toast-wrong ${cls}`} onClick={(e) => setOpen(where(e.currentTarget))}
      title={t("방금 인식이 틀렸다고 알려 주세요 — 그 인식에 쓴 게임 화면 한 장이 함께 전송되어 인식을 고치는 데 쓰입니다")}>{t("틀렸어요")}</button>
    {open && createPortal(
      <div className="bridge-wrong-back" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
        <div className="bridge-wrong-modal" role="dialog" aria-modal="true" aria-label={t("틀렸어요")}>
          <b>{t("틀렸어요")}</b>
          <input type="text" value={memo} autoFocus maxLength={200} placeholder={t("뭐가 틀렸나요? (한 줄, 비워도 돼요)")}
            onChange={(e) => setMemo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); else if (e.key === "Escape") setOpen(null); }} />
          <div className="bridge-wrong-acts">
            <button type="button" className="bridge-toast-off" onClick={() => setOpen(null)}>{t("닫기")}</button>
            <button type="button" className="bridge-toast-off bridge-wrong-send" onClick={send}>{t("보내기")}</button>
          </div>
        </div>
      </div>, open,
    )}
  </>);
}

function PipCard({ c }: { c: BridgePipCard }) {
  const [open, setOpen] = useState(false);
  useCoach();
  // 훈수방 추천·비추천 — 보는 사람이 이 카드에 준 표 (2026-10-24)
  const vote = coachState().live ? coachVotes()[cardKey(c)] : undefined;
  const more = !!c.detailImg || (c.list?.length ?? 0) > 0;
  return (
    <article className={`bridge-pip-card${more ? " more" : ""}${open ? " open" : ""}`}
      onClick={more ? () => setOpen((v) => !v) : undefined}>
      <div className="bridge-pip-card-head">
        {c.img && <img src={c.img} alt="" width={36} height={36} />}
        <div><small>{c.kind}{c.tag && <> · <span className="bridge-pip-tag">{c.tag}</span></>}</small><b>{c.name}</b></div>
        {vote && (vote.up.length > 0 || vote.down.length > 0) && <em className="coach-ping">{vote.up.length > 0 && <span className="up"><Thumb size={12} />{vote.up.length}</span>}{vote.down.length > 0 && <span className="down"><Thumb down size={12} />{vote.down.length}</span>}</em>}
        {more && <i aria-hidden>{open ? "▴" : "▾"}</i>}
      </div>
      {c.text && <p>{c.text}</p>}
      {open && c.detailImg && <img className="bridge-pip-map" src={c.detailImg} alt="" />}
      {open && c.list && c.list.length > 0 && (
        <div className="bridge-pip-list">{c.listLabel && <span>{c.listLabel}</span>}
          <ul>{c.list.map((x, k) => <li key={k}>{c.listImgs?.[k] && <img src={c.listImgs[k]} alt="" width={22} height={22} />}{x}</li>)}</ul>
        </div>
      )}
    </article>
  );
}

/** 공채 작은 창 두 칸 — 인식된 태그 · 태그 조합 결과 (recruit.tsx 가 bridge.setBridgePipRecruit 로 채운다) */
function RecruitPanes({ t }: { t: T }) {
  const r = bridgePipRecruit();
  return (
    <>
      <section className="bridge-pip-pane">
        <h4>{t("인식된 태그")}{r && r.tags.length > 0 && <em>{r.tags.length}</em>}</h4>
        {r && r.tags.length
          ? <div className="bridge-pip-tags">{r.tags.map((g) => <span key={g}>{g}</span>)}</div>
          : <p className="bridge-pip-empty">{t("공개모집 화면을 인식하면 여기에 태그가 표시됩니다")}</p>}
      </section>
      <section className="bridge-pip-pane">
        <h4>{t("태그 조합 결과")}{r && r.rows.length > 0 && <em>{r.rows.length}</em>}
          {r?.onPrized && (
            <button type="button" className={`bridge-pip-prized${r.prized ? " on" : ""}`} aria-pressed={r.prized} onClick={r.onPrized}>{t("4★ 이상만")}</button>
          )}
        </h4>
        {r && r.rows.length
          ? <div className="bridge-pip-combos">{r.rows.map((row) => (
            <div key={row.combo.join("+")} className="bridge-pip-combo">
              <div className="bridge-pip-combo-head">
                <span className="bridge-pip-combo-tags">{row.combo.join(" + ")}</span>
                <b data-r={row.floor}>{row.floor === row.ceil ? `${row.floor}★` : `${row.floor}~${row.ceil}★`}</b>
              </div>
              <div className="bridge-pip-combo-ops">
                {row.ops.map((op) => (
                  <img key={op.id} src={op.img} alt={op.name} title={`${"★".repeat(op.rarity)} ${op.name}`} data-r={op.rarity} width={34} height={34} />
                ))}
              </div>
            </div>
          ))}</div>
          : <p className="bridge-pip-empty">{t("태그가 골라지면 나올 수 있는 오퍼레이터가 여기에 표시됩니다")}</p>}
      </section>
    </>
  );
}

function PipView({ t, connected, phase, note, lockName, error }: { t: T; connected: boolean; phase: string; note: string; lockName: string; error: string }) {
  const external = usePipExternal();
  const rgTopic = (bridgeLock() ?? pipLock)?.topic ?? "";
  const rgN = external && /^rogue_\d+$/.test(rgTopic) ? rgTopic.split("_")[1] : "";
  const node = bridgePipNode();
  const relics = bridgePipRelics();
  const last = bridgeLastScan();
  if (!connected) {
    const target = pipLock;
    return (
      <div className="bridge-pip">
        <header className="bridge-pip-head"><span className="bridge-dot off" aria-hidden>○</span><b>{target ? t(target.name) : "PRTS"}</b><span>{t("연결 안 됨")}</span></header>
        <div className="bridge-pip-connect">
          <button type="button" className="lens-open-btn bridge-topic-btn" onClick={() => void connectBridge(target ?? undefined, pipWin ?? undefined)}>
            <span aria-hidden>○</span> {t("PRTS 링크 연결")}
          </button>
          <p>{t("게임 창을 고르면 이 작은 창에 인식 결과가 나옵니다.")}</p>
          {error && <p className="bridge-pip-err">{t(error)}</p>}
        </div>
      </div>
    );
  }
  return (
    // 통합전략 — 작은 창 전체를 그 테마 색으로 (사용자 지시 2026-10-13 "록라 테마로 예쁘게"). 테마 변수는 .rg.rgN 에, 테마 색(--rg-hue)은 본 화면 html 에서 읽는다
    <div className={`bridge-pip${rgN ? ` rg rg${rgN} bridge-pip-rg` : ""}`}
      style={rgN ? ({ "--rg-hue": getComputedStyle(document.documentElement).getPropertyValue("--rg-hue") } as React.CSSProperties) : undefined}>
      {/* 머리줄·공유 줄·채팅은 한 덩어리로 위에 붙여 둔다 — 노드·소장품만 그 밑으로 스크롤 (사용자 지시 2026-10-24 "채팅은 바로 그 밑에 sticky") */}
      <div className="bridge-pip-top">
      <header className="bridge-pip-head">
        <span className="bridge-dot" aria-hidden>◉</span>
        <b>{lockName}</b>
        {/* 인식 상태 문구는 작은 창에 싣지 않는다 — 길이가 바뀔 때마다 창 배치가 늘었다 줄었다 했다 (사용자 지시 2026-10-13) */}
        <button type="button" className="bridge-toast-off bridge-pip-off" onClick={forceBridgeRescan} title={t("지금 화면을 바로 다시 인식합니다")}>{t("강제 인식")}</button>
        {/* 틀렸어요는 연결 끊기 왼쪽 — 바닥줄에 두면 내용이 길 때 스크롤해 내려가야 보였다 (사용자 지시 2026-10-13) */}
        {last && (last.wrong
          ? <span className="bridge-toast-thanks bridge-pip-thanks">{t(last.shot === "sending" ? "보내는 중…" : last.shot === "fail" ? "보내지 못했어요 — 다시 눌러 주세요" : "알려 주셔서 고마워요 — 보내 주신 화면으로 인식을 고칠게요")}</span>
          : <WrongButton t={t} cls="bridge-pip-wrong" />)}
        <button type="button" className="bridge-toast-off bridge-pip-off" onClick={disconnectBridge} title={t("PRTS 링크 끊기")}>{t("연결 끊기")}</button>
      </header>
      {bridgeNotArknights() && <ArkCheck t={t} />}
      <CoachControls t={t} />
      <CoachChat t={t} />
      </div>
      <CoachReactLayer />
      {pipLock?.topic === "recruit" || bridgePipRecruit() ? <RecruitPanes t={t} /> : external ? <div id="ta-pip-slot" className="bridge-pip-slot" /> : (<>
      {(() => {
        // 공통 정보 — 층 · 난이도 · 분대 세 칸만 (사용자 지시 2026-10-13 "N층, 난이도N, XX분대 이렇게 세 개만")
        const f = bridgePipFloor();
        const bits = [f.floor ? t("{n}층", { n: f.floor }) : "", typeof f.grade === "number" ? t("난이도 {n}", { n: f.grade }) : "", f.squad ?? ""].filter(Boolean);
        return bits.length ? <p className="bridge-pip-floor">{bits.map((b) => <span key={b}>{b}</span>)}</p> : null;
      })()}
      {/* 두 칸 — 노드(층·작전·조우) 한 장 · 소장품 여러 장, 각자 새로 인식될 때만 바뀐다 */}
      <section className="bridge-pip-pane">
        <h4>{t("노드")}</h4>
        {node
          ? <div className="bridge-pip-cards"><PipCard key={`${node.kind}:${node.name}`} c={node} /></div>
          : <p className="bridge-pip-empty">{t("층·작전·조우 화면을 인식하면 여기에 표시됩니다")}</p>}
      </section>
      <section className="bridge-pip-pane">
        <h4>{t("소장품")}{relics.length > 0 && <em>{relics.length}</em>}</h4>
        {relics.length
          ? <div className="bridge-pip-cards">{relics.map((c, i) => <PipCard key={`${c.kind}:${c.name}:${i}`} c={c} />)}</div>
          : <p className="bridge-pip-empty">{t("소장품을 인식하면 여기에 표시됩니다")}</p>}
      </section>
      </>)}
    </div>
  );
}

/** 훈수방 상태가 바뀌면 다시 그린다 */
function useCoach() {
  const [, bump] = useState(0);
  useEffect(() => onCoachChange(() => bump((n) => n + 1)), []);
  return coachState();
}
/** 훈수방 단추 줄 — 끈 상태면 '화면 공유', 켠 상태면 보는 사람 수·링크 복사·공유 끝내기 (2026-10-24).
 *  '모두 내보내기'·'새 링크'는 뺐다 — 링크를 직접 준 서넛뿐이고, 링크를 바꾸려면 끝냈다 다시 켜면 된다 (사용자 지시 2026-10-24) */
function CoachControls({ t }: { t: T }) {
  const st = useCoach();
  const [copied, setCopied] = useState(false);
  // 공유 줄 접기 — 게임 중엔 채팅·노드를 더 보이게 (사용자 지시 2026-10-24 "화면 공유 중 섹션은 닫을 수 있도록"). 이 브라우저에 기억
  // 공개방 켜기 확인 — 화면 속 닉네임·UID 가 모르는 사람에게 보일 수 있어 처음 켤 때 한 번 묻는다
  const [pubAsk, setPubAsk] = useState(false);
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem("ta:coach-bar-folded") === "1"; } catch { return false; } });
  const [copyFail, setCopyFail] = useState(false);
  // 지금은 관리자(운영자 UID 로 내 정보 동기화한 브라우저)만 — 시험 중 (사용자 지시 2026-10-24 "화면 공유 버튼은 관리자만")
  if (!isOwnerUid() && !st.live) return null;
  if (!st.live) return (
    <div className="coach-bar">
      {/* 방 제목 — 시작할 때 정한다 (사용자 지시 2026-10-24). 비워도 된다 */}
      <input className="coach-title" defaultValue={coachTitle()} maxLength={TITLE_MAX} placeholder={t("방 제목 (선택)")} aria-label={t("방 제목")}
        onBlur={(e) => setCoachTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setCoachTitle((e.target as HTMLInputElement).value); startCoach(); } }} />
      <button type="button" className="bridge-toast-node coach-start" onMouseDown={() => { const el = document.activeElement as HTMLInputElement | null; if (el?.classList.contains("coach-title")) setCoachTitle(el.value); }} onClick={() => startCoach()}
        title={t("링크를 받은 사람이 이 게임 화면과 PRTS 인식 정보를 실시간으로 봅니다 — 영상은 사이트를 거치지 않고 직접 갑니다(녹화·저장 없음), 최대 {n}명", { n: COACH_MAX })}>
        ◉ {t("화면 공유")} <span className="beta-badge">BETA</span>
      </button>
      {st.error && <small className="coach-err">{t(st.error)}</small>}
    </div>
  );
  // 복사는 **누른 단추가 있는 창**의 클립보드로 — 작은 창(별도 창)에서 본 창 navigator 로 쓰면 '포커스 없는 문서'라 크롬이 거부하고
  // 조용히 실패했다 (사용자 지적 2026-10-24 "복사가 안 된다"). 막히면 옛 방식(execCommand)으로, 그래도 안 되면 링크를 펼쳐 직접 고르게
  const copy = (ev: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    const doc = ev.currentTarget.ownerDocument;
    const win = doc.defaultView ?? window;
    const done = () => { setCopied(true); setCopyFail(false); setTimeout(() => setCopied(false), 2000); };
    const legacy = () => {
      try {
        const ta = doc.createElement("textarea");
        ta.value = st.url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        doc.body.appendChild(ta); ta.select();
        const ok = doc.execCommand("copy");
        ta.remove();
        if (ok) done(); else setCopyFail(true);
      } catch { setCopyFail(true); }
      // 실패해도 주소는 그대로 보이니 끌어서 고르면 된다 — 고른 상태로 둔다
      try { const r = doc.createRange(); r.selectNodeContents(ev.currentTarget); const sel = win.getSelection(); sel?.removeAllRanges(); sel?.addRange(r); } catch { /* */ }
    };
    const cb = win.navigator.clipboard;
    if (cb?.writeText) void cb.writeText(st.url).then(done).catch(legacy);
    else legacy();
  };
  const fold = () => { const v = !folded; setFolded(v); try { localStorage.setItem("ta:coach-bar-folded", v ? "1" : ""); } catch { /* */ } };
  if (folded) return (
    <div className="coach-bar on folded">
      <button type="button" className="coach-fold" onClick={fold} aria-expanded={false} title={t("펼치기")}>
        <span className="coach-live">● {t("화면 공유 중")} · {t("보는 사람 {a}/{b}", { a: st.viewers, b: COACH_MAX })}</span><i aria-hidden>▸</i>
      </button>
    </div>
  );
  return (
    <div className="coach-bar on">
      <button type="button" className="coach-fold" onClick={fold} aria-expanded title={t("접기")}>
        <span className="coach-live">● {t("화면 공유 중")} · {t("보는 사람 {a}/{b}", { a: st.viewers, b: COACH_MAX })}</span><i aria-hidden>▾</i>
      </button>

      <button type="button" className="bridge-toast-off" onClick={() => stopCoach()}>{t("공유 끝내기")}</button>
      {/* 링크는 단추 대신 주소 그대로 — 누르면 복사, 막혀도 끌어서 고를 수 있다 (사용자 지시 2026-10-24 "URL 직접 보여 주고 클릭하면 복사") */}
      <span className={`coach-url${copied ? " copied" : ""}`} role="button" tabIndex={0} title={t("눌러서 복사")}
        onClick={(e) => { if (!e.currentTarget.ownerDocument.defaultView?.getSelection()?.toString()) copy(e); }}
        onKeyDown={(e) => { if (e.key === "Enter") copy(e); }}>{st.url}</span>
      <input className="coach-title on" defaultValue={coachTitle()} maxLength={TITLE_MAX} placeholder={t("방 제목 (선택)")} aria-label={t("방 제목")}
        onBlur={(e) => { if (e.target.value.trim() !== coachTitle()) setCoachTitle(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      {/* 공개방 — 켜면 내 정보 '훈수방' 공개 목록에 오른다 (사용자 지시 2026-10-24). 링크로 들어오는 건 켜든 끄든 누구나 */}
      <div className="coach-pub">
        <button type="button" role="switch" aria-checked={coachPublic()} className={coachPublic() ? "on" : ""}
          onClick={() => (coachPublic() ? setCoachPublic(false) : setPubAsk(true))}>
          {coachPublic() ? `● ${t("공개방")}` : `○ ${t("비공개방")}`}
        </button>
        <small>{coachPublic() ? t("공개 목록에 올라 있어요 — 누구나 들어올 수 있어요") : t("링크를 받은 사람만 들어와요")}</small>
        {pubAsk && !coachPublic() && (
          <div className="coach-pub-ask" role="alertdialog">
            <p>{t("공개방으로 바꾸면 모르는 사람도 이 화면을 볼 수 있어요. 화면에 닉네임·UID 가 보이지 않는지 한번 확인해 주세요.")}</p>
            <button type="button" className="bridge-toast-node" onClick={() => { setCoachPublic(true); setPubAsk(false); }}>{t("공개방으로")}</button>
            <button type="button" className="bridge-toast-off" onClick={() => setPubAsk(false)}>{t("취소")}</button>
          </div>
        )}
      </div>
      {/* 화질 단계 — 게임 창이 단계 해상도보다 크면 줄여 보내고 작으면 그대로 (사용자 지시 2026-10-24). 옆은 보는 사람별 실측 */}
      <div className="coach-quality" role="radiogroup" aria-label={t("화질")}>
        <span>{t("화질")}</span>
        {QUALITIES.map((q) => (
          <button type="button" key={q.id} role="radio" aria-checked={coachQuality() === q.id}
            className={coachQuality() === q.id ? "on" : ""} onClick={() => setCoachQuality(q.id)}
            title={`${q.h}p · ${q.fps}fps · ${t("1명당 최대 {n}Mbps", { n: q.br / 1e6 })}`}>
            {t(q.label)}<small>{q.h}p{q.fps}</small>
          </button>
        ))}
      </div>
      {/* 실측 — 보는 사람별 해상도·프레임·보내는 양, 화질이 깎인 이유(CPU·대역폭), 회선 여유, 영상 형식. 맨 위는 PC 부하 (2026-10-25 "멈칫멈칫" 원인 보기) */}
      {(coachStats().length > 0 || coachPcLoad()) && (
        <ul className="coach-stats">
          {coachPcLoad() && <li className={`load-${coachPcLoad()}`}>{t("PC 부하")}: {t(({ nominal: "여유", fair: "보통", serious: "높음", critical: "한계" } as Record<string, string>)[coachPcLoad()] ?? coachPcLoad())}</li>}
          {coachStats().map((x) => (
            <li key={x.id} className={x.limit !== "none" ? "limited" : ""}>
              {t("보는 사람 {n}번", { n: x.id })} · {x.w && x.h ? `${x.w}×${x.h}` : "—"} · {x.fps}fps · {x.mbps}Mbps{x.save ? ` · ${t("데이터 절약")}` : ""}
              {x.limit === "cpu" ? ` · ⚠ ${t("CPU 부족")}` : x.limit === "bandwidth" ? ` · ⚠ ${t("대역폭 부족")}` : ""}
              {x.avail ? ` · ${t("여유 {n}Mbps", { n: x.avail })}` : ""}
              {x.codec ? ` · ${x.codec}${x.hw === true ? ` (${t("하드웨어")})` : x.hw === false ? ` (${t("소프트웨어")})` : ""}` : ""}
            </li>
          ))}
        </ul>
      )}
      {copied && <span className="coach-copy-note" role="status">✓ {t("게임 화면 같이 보기 링크를 복사했어요 — 보는 사람에게 보내 주세요")}</span>}
      {copyFail && !copied && <span className="coach-copy-note fail" role="status">{t("자동 복사가 막혔어요 — 주소를 끌어서 복사해 주세요")}</span>}
    </div>
  );
}

/** 보는 사람 화면 반응 — 작은 창 아래쪽에서 떠올랐다 사라진다 (게임 위수 협의 이모티콘, 2026-10-24) */
function CoachReactLayer() {
  const st = useCoach();
  if (!st.live) return null;
  const names = coachChat().names;
  const fx = coachVoteFx();
  return (
    <>
    {/* 추천·비추천 알림 — 들어온 순간 위쪽에 크게 (사용자 지적 2026-10-25 "눌렀는지 티가 안 난다") */}
    {fx.length > 0 && (
      <div className="coach-votefx" role="status">
        {fx.map((x) => (
          <span key={x.id} className={x.up ? "up" : "down"}>
            <Thumb down={!x.up} size={18} /><b>{names[String(x.from)] ?? ""}</b><small>{x.card}</small>
          </span>
        ))}
      </div>
    )}
    <div className="coach-react-layer" aria-hidden>
      {coachReacts().map((r) => (
        <span key={r.id} className="coach-react" style={{ left: `${12 + ((r.id * 37) % 70)}%` }}>
          <img src={emoteUrl(r.e)} alt={EMOTE_LABEL[r.e]} width={56} height={56} />
          <small>{names[String(r.from)] ?? ""}</small>
        </span>
      ))}
    </div>
    </>
  );
}

/** 보는 사람 추천·비추천 표 — 카드 열쇠(cardKey) 하나의 표를 그 자리에 단다. 통합전략 작은 창은 본 화면 창을 그대로 그려서
 *  PipCard 를 안 쓰므로, 그 노드 칸 머리·소장품마다 이걸 직접 붙인다 (사용자 지시 2026-10-24 "노드 이름을 따로 띄우지 말고 노드·소장품에") */
export function CoachVoteBadge({ k }: { k: string }) {
  const st = useCoach();
  const v = st.live && k ? coachVotes()[k] : undefined;
  if (!v || (!v.up.length && !v.down.length)) return null;
  return (
    <em className="coach-ping coach-vote-badge" key={`${v.up.length}:${v.down.length}`}>
      {v.up.length > 0 && <span className="up"><Thumb size={12} />{v.up.length}</span>}
      {v.down.length > 0 && <span className="down"><Thumb down size={12} />{v.down.length}</span>}
    </em>
  );
}

/** 훈수방 채팅 — 작은 창에서 하는 사람이 읽고 친다 (사용자 지시 2026-10-24 "록라는 채팅창 볼 틈이 있다").
 *  최근 줄만 보이고 새 줄이 오면 맨 아래로. 닉네임은 보는 사람과 같은 칸(ta:coach-name) */
function CoachChat({ t }: { t: T }) {
  const st = useCoach();
  const chat = coachChat();
  const [text, setText] = useState("");
  const [nameEdit, setNameEdit] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const last = chat.log[chat.log.length - 1]?.id ?? 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    coachChatRead();
  }, [last]);
  if (!st.live) return null;
  const send = () => { coachSay(text); setText(""); };
  return (
    <section className="coach-chat">
      <div className="coach-chat-head">
        <b>{t("채팅")}</b>
        <button type="button" className={`coach-roster-btn${rosterOpen ? " on" : ""}`} aria-expanded={rosterOpen} onClick={() => setRosterOpen((o) => !o)}>
          {t("참여 {n}명", { n: chat.present.length })} {rosterOpen ? "▴" : "▾"}
        </button>
        {nameEdit
          ? <input className="coach-chat-name" autoFocus maxLength={NAME_MAX} defaultValue={coachName()} placeholder={t("닉네임")}
            onBlur={(e) => { setCoachName(e.target.value); setNameEdit(false); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }} />
          : <button type="button" className="coach-chat-me" onClick={() => setNameEdit(true)} title={t("닉네임 바꾸기")}>{coachName() || t("하는 사람")} ✎</button>}
        <button type="button" className={`coach-chat-off${chat.off ? " on" : ""}`} aria-pressed={chat.off} onClick={() => setCoachChatOff(!chat.off)}
          title={t("끄면 보는 사람이 채팅을 보낼 수 없습니다")}>{chat.off ? t("채팅 꺼짐") : t("채팅 끄기")}</button>
      </div>
      {rosterOpen && (
        <ul className="coach-roster">
          {chat.present.map((a) => <li key={a} className={a === 0 ? "host" : ""}>{chat.names[String(a)] ?? ""}{a === 0 ? ` · ${t("나")}` : ""}</li>)}
        </ul>
      )}
      <div className="coach-chat-log" ref={listRef}>
        {chat.log.length === 0 && <p className="coach-chat-empty">{t("보는 사람이 보낸 채팅이 여기에 뜹니다")}</p>}
        {chat.log.map((m) => (
          m.sys
            ? <p key={m.id} className="sys">{t(m.sys === "join" ? "{n} 님이 들어왔어요" : "{n} 님이 나갔어요", { n: msgName(m, chat.names) })}</p>
            : <p key={m.id} className={m.from === 0 ? "me" : ""}><b>{msgName(m, chat.names)}</b>{m.text}</p>
        ))}
      </div>
      {/* 입력칸 + 이모티콘 단추 — 하는 사람도 반응을 보낸다 (보는 사람 화면과 같은 판, 2026-10-25) */}
      <div className="coach-chat-row">
        <input className="coach-chat-input" value={text} maxLength={CHAT_MAX} placeholder={t("채팅 (Enter 로 보내기)")}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) send(); }} />
        <button type="button" className={`coach-emote-btn${emoteOpen ? " on" : ""}`} aria-expanded={emoteOpen} aria-label={t("화면 반응")}
          title={t("화면 반응")} onClick={() => setEmoteOpen((o) => !o)}>
          <img src={emoteUrl("happy")} alt="" width={22} height={22} />
        </button>
        {emoteOpen && (
          <div className="coach-emotes" role="toolbar" aria-label={t("화면 반응")}>
            {EMOTES.map((e) => (
              <button type="button" key={e} title={t(EMOTE_LABEL[e])} aria-label={t(EMOTE_LABEL[e])}
                onClick={() => { coachReact(e); setEmoteOpen(false); }}>
                <img src={emoteUrl(e)} alt="" width={34} height={34} />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** 명일방주 화면이 아닌 것 같을 때 — 막지 않고 '한번 확인해 보라'고 하며 지금 잡히는 화면을 작게 보여 준다 (사용자 지시 2026-10-24).
 *  연결 토스트와 작은 창이 같이 쓴다 */
function ArkCheck({ t }: { t: T }) {
  const thumb = bridgeArkThumb();
  return (
    <div className="bridge-ark-check" role="status">
      <p>{t("지금 잡히는 화면이 명일방주가 아닌 것 같아요. 아래 화면이 게임 창이 맞는지 한번 확인해 주세요.")}</p>
      {thumb && <img src={thumb} alt={t("지금 잡히는 화면")} />}
      <button type="button" className="bridge-toast-node bridge-ark-ok" onClick={confirmArknights}
        title={t("이 화면이 명일방주라면 눌러 주세요 — 이 창·이 화면은 다음부터 경고하지 않고, 판별을 고치는 데 쓰도록 화면 한 장이 전송됩니다")}>
        ✓ {t("명일방주 맞습니다")}
      </button>
    </div>
  );
}

/** 연결 상태 토스트 — 문서 최상위에 포털로 그려 모달 백드롭 위에도 항상 보인다. */
export default function BridgeButton({ t }: { t: T }) {
  const { settings, gate, busy, note, lock, error, notArk } = useBridgeStatus();
  const pip = usePipWin();
  // 연결이 끊기면 작은 창도 닫는다 (사용자 지시 2026-10-13) — 연결돼 있다가 끊긴 순간에만 (작은 창에서 '연결'을 누르기 전 상태는 그대로)
  const wasOn = useRef(false);
  useEffect(() => {
    if (settings) { wasOn.current = true; return; }
    if (wasOn.current && pipWin) void togglePipWindow();
    wasOn.current = false;
  }, [settings]);
  const pipOk = usePipOk();
  const phase = busy ? t("인식 중…") : t(PHASE[gate?.phase ?? ""] ?? "연결됨");
  // 작은 창은 연결 전에도 떠 있을 수 있다 — 연결 단추를 그 창에서 누른다
  const pipPortal = pip ? createPortal(
    <PipView t={t} connected={!!settings} phase={phase} note={note} error={error}
      lockName={lock ? t(lock.name) : t("PRTS 링크 연결됨")} />, pip.document.body) : null;
  // 연결 전·미지원 — 연결 토스트는 그리지 않는다. 다만 연결이 막혔으면(화면 전체·탭을 고름 등) 그 이유를 본 화면에도 띄운다 —
  // 종전엔 작은 창에만 떠서 그냥 끊긴 것처럼 보였다 (사용자 지적 2026-10-24 "끊기만 하지 말고 뭐라도 띄워 줘"). 고르기 취소는 띄우지 않는다
  if (!settings) {
    if (!error || error === "창 선택이 취소되었습니다") return pipPortal;
    return <>{pipPortal}{createPortal(
      <div className="bridge-toast bridge-toast-err" role="alert">
        <span className="bridge-dot" aria-hidden>⚠</span>
        {/* 길어서 잘렸다 — ' — ' 앞뒤를 두 줄로 (사용자 지적 2026-10-24) */}
        <span className="bridge-toast-text bridge-err-text">{t(error).replace(" — ", "\n")}</span>
        <button type="button" className="bridge-err-x" aria-label={t("닫기")} onClick={clearBridgeError}>×</button>
      </div>, document.body)}</>;
  }
  const togglePip = () => togglePipWindow(lock);

  return createPortal(
    <div className={`bridge-toast${busy ? " busy" : ""}`} aria-live="polite" role="status">
      <span className="bridge-dot" aria-hidden>◉</span>
      {/* 이름 한 줄 + 상태 한 줄 — 한 줄이면 길어서 상태가 잘렸다 (사용자 지적 2026-10-24) */}
      <span className="bridge-toast-text bridge-toast-2line">
        <span className="bridge-toast-name">{lock ? <b>{t(lock.name)}</b> : <b>{t("PRTS 링크 연결됨")}</b>}</span>
        <span className="bridge-toast-state"><b>{phase}</b>
          {gate ? ` · ${t("인식")} ${gate.emitted} · ${t("기록")} ${bridgeLogCount()}` : ""}
          {note ? ` · ${note}` : ""}</span>
      </span>
      {/* 틀렸어요 — 마지막 인식을 틀렸다고 남긴다 (사용자 지시 2026-10-12). 인식이 한 번이라도 끝난 뒤에만 보인다 */}
      {(() => {
        const last = bridgeLastScan();
        if (!last) return null;
        return last.wrong
          ? <span className="bridge-toast-thanks">{t(last.shot === "sending" ? "보내는 중…" : last.shot === "fail" ? "보내지 못했어요 — 다시 눌러 주세요" : "알려 주셔서 고마워요 — 보내 주신 화면으로 인식을 고칠게요")}</span>
          : <WrongButton t={t} cls="" />;
      })()}
      {pipOk && (
        <button type="button" className={`bridge-toast-node${pip ? " on" : ""}`} aria-pressed={!!pip} onClick={() => void togglePip()}
          title={t("게임 위에 항상 떠 있는 작은 창에 인식 결과를 띄웁니다 (크롬·엣지)")}>
          ⧉ {t("작은 창")}
        </button>
      )}
      <button type="button" className="bridge-toast-node" onClick={forceBridgeRescan} title={t("지금 화면을 바로 다시 인식합니다")}>↻ {t("강제 인식")}</button>
      <button type="button" className="bridge-toast-off" onClick={disconnectBridge} title={t("PRTS 링크 끊기")}>
        {t("연결 끊기")}
      </button>
      {/* 기록 수집 안내 (사용자 지시 2026-10-12) — 토스트 둘째 줄 */}
      {pipPortal}
      {/* 명일방주 창이 아닌 것 같을 때 (창 제목 또는 화면 내용으로 판정 — app/lens/bridge.ts arkVerdict, 2026-10-24) */}
      {notArk && <ArkCheck t={t} />}
      <CoachControls t={t} />
      <small className="bridge-toast-hint">{t("잘못 인식했다면 '틀렸어요'를 눌러 주세요 — 그때만 그 인식 결과와 화면 한 장이 전송돼요. 평소 인식은 따로 보내지 않아요.")}</small>
    </div>,
    document.body,
  );
}

// 도움말은 설명만 담긴 모달이라 필요할 때만 받아온다
const BridgeHelpModal = lazy(() => import("./bridge-help"));

/** 테마별 PRTS 링크 — /rogue 툴바용 (사용자 확정 2026-07-26: "사미록라의 연결 버튼은
 *  무조건 사미록라만"). 여기서 연결하면 인식이 그 테마 밖을 아예 보지 않는다.
 *  리플레이 버튼은 프리뷰 모달을 연다 (즉시 다운로드 아님 — JSON 가져오기/내보내기는 모달 안). */
/** noReplay — 여정 기록(리플레이)이 없는 화면(공채)은 리플레이 단추를 뺀다.
 *  noPip — 작은 창을 쓰지 않는다: 단추도 없고 연결해도 안 연다. 공채는 본 화면 태그 판이 자동으로 골라지는 것으로 충분하다
 *  (사용자 지시 2026-10-12 "PiP 띄우지 말고 뒤에서 조건이 자동으로 선택되도록") */
/** compact — 좁은 칸(공채)용: 폭이 상태와 무관하게 늘 같다. 동그라미 대신 스샷 단추와 같은 점(켜지면 라임), 이름은 늘 'PRTS 링크',
 *  모바일 'PC 전용'은 마우스를 올린 설명으로만 — 프리렌더(모바일 가정)·연결됨 문구로 폭이 바뀌어 줄이 넘어가던 것 (사용자 지적 2026-10-12) */
// 리플레이(여정 기록 미리보기·JSON) 단추는 2026-10-13 뺐다 (사용자 지시 "아무도 안 쓰는 거 같은데 그냥 빼자"). noReplay 는 옛 호출 자리 호환으로만 받는다
export function BridgeTopicButton({ topic, name, t, noPip, compact }: { topic: string; name: string; t: T; noReplay?: boolean; noPip?: boolean; compact?: boolean }) {
  const { settings, lock } = useBridgeStatus();
  const supported = useSyncExternalStore(noSubscribe, bridgeSupported, () => false);
  // 모바일 판정은 화면 크기가 아니라 기기 특성(UA-CH·hover/pointer)이다 — bridge.ts 주석 참조.
  // SSR 스냅샷은 true(비활성) — 프리렌더 HTML엔 'PC 전용'으로 실리고 데스크탑이 하이드레이션
  // 때 활성으로 바뀐다 (종전엔 SSR에서 아예 안 그렸으니 어느 쪽이든 깜빡임은 새로 안 생긴다).
  const mobile = useSyncExternalStore(noSubscribe, bridgeOnMobile, () => true);
  const pip = usePipWin();
  const pipOk = usePipOk();
  const [helpOpen, setHelpOpen] = useState(false);
  // 딥링크: #prts-help(도움말) — /rogue 툴바엔 활성 테마의 버튼 인스턴스 하나만 마운트되므로 여기서 동기화해도 중복이 없다 (2026-07-27)
  useHashSync(helpOpen ? "#prts-help" : null, (h) => setHelpOpen(h === "#prts-help"));
  // API 없는 **데스크탑**(파이어폭스 등 비크로뮴)만 통째로 숨긴다 — 모바일은 숨기지 않고
  // 아래에서 비활성 + 'PC 전용' 표기로 남긴다 (사용자 확정 2026-08-09: "버튼은 있어야").
  if (!supported && !mobile) return null;

  const mine = !!settings && lock?.topic === topic;   // 이 테마로 고정 연결됨
  const other = !!settings && !mine;                  // 다른 테마에서 연결됨
  return (
    <>
      {compact ? (
        <button type="button" className={`lens-open-btn bridge-topic-btn${mine ? " on" : ""}`} disabled={mobile}
          aria-pressed={mine}
          title={mobile ? t("PRTS 링크는 PC 브라우저에서만 사용할 수 있습니다") : mine ? t("PRTS 링크 끊기") : t("게임 창을 골라 이 테마로만 인식하도록 연결합니다")}
          onClick={() => {
            if (mine) { disconnectBridge(); return; }
            // 작은 창은 **게임 창을 고른 뒤에** 연다 (사용자 지시 2026-10-13 "PRTS 링크를 누르고 창을 선택해야 PiP 가") — 고르기를
            // 취소하면 안 뜬다. ⚠ 작은 창은 사용자 클릭 직후(수 초)에만 열린다 — 창 고르기가 오래 걸리면 못 열고, 그땐 토스트의 '작은 창'으로
            void connectBridge({ topic, name }).then(() => {
              if (!bridgeSession() || !pipOk || pipWin || noPip) return;
              void togglePipWindow({ topic, name }).catch(() => { /* 클릭 직후가 아님 — 토스트 단추로 */ });
            });
          }}>
          <span className="lens-auto-knob" aria-hidden />{t("PRTS 링크")}
          <span className="beta-badge">BETA</span>
        </button>
      ) : mobile ? (
        <button type="button" className="lens-open-btn bridge-topic-btn" disabled
          title={t("PRTS 링크는 PC 브라우저에서만 사용할 수 있습니다")}>
          <span aria-hidden>○</span> {t("PRTS 링크")}
          <span className="beta-badge">{t("PC 전용")}</span>
        </button>
      ) : (
      <button
        type="button"
        className={`lens-open-btn bridge-topic-btn${mine ? " on" : ""}`}
        title={mine
          ? t("PRTS 링크 끊기")
          : other
            ? t("다시 연결하면 이 테마로만 인식하도록 고정됩니다")
            : t("게임 창을 골라 이 테마로만 인식하도록 연결합니다")}
        onClick={() => {
          if (mine) { disconnectBridge(); return; }
          // 작은 창은 **게임 창을 고른 뒤에** 연다 (사용자 지시 2026-10-13 "록라도 연결해야 PiP 화면 뜨게" — 공채와 같다).
          // 고르기를 취소하면 안 뜬다. ⚠ 작은 창은 클릭 직후(수 초)에만 열린다 — 고르기가 오래 걸리면 토스트의 '작은 창'으로
          void connectBridge({ topic, name }).then(() => {
            if (!bridgeSession() || !pipOk || pipWin || noPip) return;
            void togglePipWindow({ topic, name }).catch(() => { /* 클릭 직후가 아님 — 토스트 단추로 */ });
          });
        }}
      >
        <span aria-hidden>{mine ? "◉" : "○"}</span> {mine ? t("PRTS 링크 연결됨") : t("PRTS 링크")}
        {/* 아직 다듬는 중이라 BETA 표시 (사용자 지시 2026-07-26) — 새기능 배지와 달리 상시 */}
        <span className="beta-badge">BETA</span>
        <NewBadge id="bridge" show={!settings && isNewFeature("bridge")} />
      </button>
      )}
      {/* 툴바의 '작은 창' 단추는 걷어냈다 — 연결하면 저절로 열린다. 안 열리면 연결 토스트의 '작은 창'으로 (사용자 지시 2026-10-12) */}
      {/* ?는 **PRTS 링크 버튼 바로 오른쪽**에 붙는 세그먼트다 (사용자 지적 2026-07-26) */}
      <button type="button" className="lens-help-btn bridge-help-btn" aria-label={t("PRTS 링크 도움말")}
        onClick={() => setHelpOpen(true)}>?</button>
      {/* 도움말은 공용 창(ModalWindow)이라 백드롭·포털을 스스로 만든다 — 여기서 감싸지 않는다 */}
      {helpOpen && (
        <Suspense fallback={null}>
          <BridgeHelpModal where={topic === "recruit" ? "recruit" : "rogue"} onClose={() => setHelpOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
