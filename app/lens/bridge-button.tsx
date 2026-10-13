"use client";

// 게임 연결 표시 — **토스트**로 항상 최상위에 떠 있다 (사용자 확정 2026-07-26:
// "모달창이 뜨면 뒷쪽이 어두워지니까" 헤더 인라인 대신 z-index 최상위 토스트 + 연결해제 버튼).
// 연결 자체는 /rogue 각 테마의 게임 연결 버튼에서 한다 (BridgeTopicButton — 테마 하드 고정).
// 연결 전에는 아무것도 그리지 않는다.

import { NewBadge } from "../new-badge";
import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useBridgeStatus, connectBridge, disconnectBridge, bridgeSupported, bridgeOnMobile, bridgeLogCount, setBridgeNodeJump, bridgeLastScan, markBridgeWrong, bridgePipNode, bridgePipRelics, bridgePipRecruit, bridgeSession, setBridgePipActive, type BridgeLock, type BridgePipCard } from "./bridge";
import BridgeReplayModal from "./bridge-replay";
import { isNewFeature } from "../whats-new";
import { useHashSync } from "../hash-modal";
import { isAcLock } from "../autochess-run";
import { isOwnerBrowser } from "../visit-track";
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
// ⚠ 시험판 — **운영자 브라우저에서만** 보인다 (사용자 지시 2026-10-12 "사용자들이 안 보이게 몰래 숨겨 놓고 나만 써 보고 싶음").
//   공개할 때 isOwnerBrowser() 조건만 빼면 된다
const usePipOk = () => useSyncExternalStore(noSubscribe, () => !!docPip() && isOwnerBrowser(), () => false);

/** 카드 하나 — 섬네일 + 이름 + 효과. 펼칠 게 있으면(작전 지도·등장 적·선택지) 눌러서 펼친다 (사용자 지시 2026-10-12
 *  "작전이 인식돼서 떴고 그걸 클릭하면 작전맵이 떴으면") */
function PipCard({ c }: { c: BridgePipCard }) {
  const [open, setOpen] = useState(false);
  const more = !!c.detailImg || (c.list?.length ?? 0) > 0;
  return (
    <article className={`bridge-pip-card${more ? " more" : ""}${open ? " open" : ""}`}
      onClick={more ? () => setOpen((v) => !v) : undefined}>
      <div className="bridge-pip-card-head">
        {c.img && <img src={c.img} alt="" width={36} height={36} />}
        <div><small>{c.kind}</small><b>{c.name}</b></div>
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
          {error && <p className="bridge-pip-err">{error}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="bridge-pip">
      <header className="bridge-pip-head">
        <span className="bridge-dot" aria-hidden>◉</span>
        <b>{lockName}</b>
        <span>{phase}{note ? ` · ${note}` : ""}</span>
        <button type="button" className="bridge-toast-off bridge-pip-off" onClick={disconnectBridge} title={t("PRTS 링크 끊기")}>{t("연결 끊기")}</button>
      </header>
      {pipLock?.topic === "recruit" || bridgePipRecruit() ? <RecruitPanes t={t} /> : (<>
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
      {last && (
        <footer className="bridge-pip-foot">
          {last.wrong
            ? <span className="bridge-toast-thanks">{t(last.shot === "sending" ? "화면 보내는 중…" : last.shot === "fail" ? "화면 전송 실패 — 기록만 남겼어요" : "알려 주셔서 고마워요")}</span>
            : <button type="button" className="bridge-toast-off bridge-toast-wrong" onClick={markBridgeWrong}>{t("틀렸어요")}</button>}
        </footer>
      )}
    </div>
  );
}

/** 연결 상태 토스트 — 문서 최상위에 포털로 그려 모달 백드롭 위에도 항상 보인다. */
export default function BridgeButton({ t }: { t: T }) {
  const { settings, gate, busy, note, lock, nodeJump, error } = useBridgeStatus();
  const pip = usePipWin();
  const pipOk = usePipOk();
  const phase = busy ? t("인식 중…") : t(PHASE[gate?.phase ?? ""] ?? "연결됨");
  // 작은 창은 연결 전에도 떠 있을 수 있다 — 연결 단추를 그 창에서 누른다
  const pipPortal = pip ? createPortal(
    <PipView t={t} connected={!!settings} phase={phase} note={note} error={error}
      lockName={lock ? t(lock.name) : t("PRTS 링크 연결됨")} />, pip.document.body) : null;
  if (!settings) return pipPortal;   // 연결 전·미지원 — 토스트는 그리지 않는다
  const togglePip = () => togglePipWindow(lock);

  return createPortal(
    <div className={`bridge-toast${busy ? " busy" : ""}`} aria-live="polite" role="status">
      <span className="bridge-dot" aria-hidden>◉</span>
      <span className="bridge-toast-text">
        {lock ? <b>{t(lock.name)}</b> : <b>{t("PRTS 링크 연결됨")}</b>}
        {` · `}<b>{phase}</b>
        {gate ? ` · ${t("인식")} ${gate.emitted} · ${t("기록")} ${bridgeLogCount()}` : ""}
        {note ? ` · ${note}` : ""}
      </span>
      {/* 틀렸어요 — 마지막 인식을 틀렸다고 남긴다 (사용자 지시 2026-10-12). 인식이 한 번이라도 끝난 뒤에만 보인다 */}
      {(() => {
        const last = bridgeLastScan();
        if (!last) return null;
        return last.wrong
          ? <span className="bridge-toast-thanks">{t(last.shot === "sending" ? "화면 보내는 중…" : last.shot === "fail" ? "화면 전송 실패 — 기록만 남겼어요" : "알려 주셔서 고마워요")}</span>
          : <button type="button" className="bridge-toast-off bridge-toast-wrong" onClick={markBridgeWrong}
              title={t("방금 인식이 틀렸다고 알려 주세요 — 그 인식에 쓴 게임 화면 한 장이 함께 전송되어 인식을 고치는 데 쓰입니다")}>
              {t("틀렸어요")}
            </button>;
      })()}
      {/* 맵 노드 자동 이동 (제보 f1c050b2) — 연결 중에만 보이면 되는 설정이라 여기 둔다.
          인식을 끄는 게 아니라 **이동만** 끈다: 소장품·도구 인식은 그대로 동작한다.
          ⚠ 위수 협의(PRTS 시뮬레이션)에는 맵 노드가 없다 — 거기선 아예 안 그린다
          (사용자 지시 2026-09-06 "명토체스의 경우는 노드이동 이거 없애줘야지"). */}
      {!isAcLock(lock?.topic) && (
        <button type="button" className={`bridge-toast-node${nodeJump ? " on" : ""}`}
          aria-pressed={nodeJump} onClick={() => setBridgeNodeJump(!nodeJump)}
          title={t("맵 노드(작전·조우·구역)를 인식했을 때 그 상세로 자동으로 이동할지 정합니다. 꺼도 소장품·도구 인식은 그대로 동작합니다")}>
          <span className="bridge-node-knob" aria-hidden />🗺 {t("노드 이동")}
        </button>
      )}
      {pipOk && (
        <button type="button" className={`bridge-toast-node${pip ? " on" : ""}`} aria-pressed={!!pip} onClick={() => void togglePip()}
          title={t("게임 위에 항상 떠 있는 작은 창에 인식 결과를 띄웁니다 (크롬·엣지)")}>
          ⧉ {t("작은 창")}
        </button>
      )}
      <button type="button" className="bridge-toast-off" onClick={disconnectBridge} title={t("PRTS 링크 끊기")}>
        {t("연결 끊기")}
      </button>
      {/* 기록 수집 안내 (사용자 지시 2026-10-12) — 토스트 둘째 줄 */}
      {pipPortal}
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
export function BridgeTopicButton({ topic, name, t, noReplay, noPip, compact }: { topic: string; name: string; t: T; noReplay?: boolean; noPip?: boolean; compact?: boolean }) {
  const { settings, lock } = useBridgeStatus();
  const supported = useSyncExternalStore(noSubscribe, bridgeSupported, () => false);
  // 모바일 판정은 화면 크기가 아니라 기기 특성(UA-CH·hover/pointer)이다 — bridge.ts 주석 참조.
  // SSR 스냅샷은 true(비활성) — 프리렌더 HTML엔 'PC 전용'으로 실리고 데스크탑이 하이드레이션
  // 때 활성으로 바뀐다 (종전엔 SSR에서 아예 안 그렸으니 어느 쪽이든 깜빡임은 새로 안 생긴다).
  const mobile = useSyncExternalStore(noSubscribe, bridgeOnMobile, () => true);
  const [replayOpen, setReplayOpen] = useState(false);
  const pip = usePipWin();
  const pipOk = usePipOk();
  const [helpOpen, setHelpOpen] = useState(false);
  // 딥링크: #replay(리플레이 프리뷰)·#prts-help(도움말) — /rogue 툴바엔 활성 테마의
  // 버튼 인스턴스 하나만 마운트되므로 여기서 동기화해도 중복이 없다 (2026-07-27)
  useHashSync(replayOpen ? "#replay" : helpOpen ? "#prts-help" : null, (h) => {
    setReplayOpen(h === "#replay");
    setHelpOpen(h === "#prts-help");
  });
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
          // 연결하면 작은 창도 같이 연다 (사용자 지시 2026-10-12 "PRTS 연결되면 자동으로 PiP"). 화면 공유를 **먼저** 청하고
          // 같은 클릭으로 작은 창을 연다 — 브라우저가 한 클릭에 둘 다 안 받아 주면 작은 창만 안 뜨고, 토스트의 '작은 창'으로 열면 된다
          void connectBridge({ topic, name });
          if (pipOk && !pip && !noPip) void togglePipWindow({ topic, name }).catch(() => { /* 사용자 동작 없음 — 토스트 단추로 */ });
        }}
      >
        <span aria-hidden>{mine ? "◉" : "○"}</span> {mine ? t("PRTS 링크 연결됨") : t("PRTS 링크")}
        {/* 아직 다듬는 중이라 BETA 표시 (사용자 지시 2026-07-26) — 새기능 배지와 달리 상시 */}
        <span className="beta-badge">BETA</span>
        <NewBadge id="bridge" show={!settings && isNewFeature("bridge")} />
      </button>
      )}
      {/* 툴바의 '작은 창' 단추는 걷어냈다 — 연결하면 저절로 열린다. 안 열리면 연결 토스트의 '작은 창'으로 (사용자 지시 2026-10-12) */}
      {/* ?는 **PRTS 링크 버튼 바로 오른쪽**에 붙는 세그먼트다 — 리플레이 뒤에 두면 리플레이
          도움말처럼 보인다 (사용자 지적 2026-07-26) */}
      <button type="button" className="lens-help-btn bridge-help-btn" aria-label={t("PRTS 링크 도움말")}
        onClick={() => setHelpOpen(true)}>?</button>
      {!noReplay && (
      <button
        type="button"
        className="lens-open-btn bridge-log-btn"
        title={t("플레이 기록을 미리 보고 JSON으로 가져오거나 내보냅니다")}
        onClick={() => setReplayOpen(true)}
      >
        <span aria-hidden>▤</span> {t("리플레이")}
      </button>
      )}
      {replayOpen && <BridgeReplayModal t={t} onClose={() => setReplayOpen(false)} />}
      {/* 도움말은 공용 창(ModalWindow)이라 백드롭·포털을 스스로 만든다 — 여기서 감싸지 않는다 */}
      {helpOpen && (
        <Suspense fallback={null}>
          <BridgeHelpModal where={topic === "recruit" ? "recruit" : "rogue"} onClose={() => setHelpOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
