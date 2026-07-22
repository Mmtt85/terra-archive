"use client";

// 오퍼 보유 스캐너 UI — 에뮬레이터 창을 화면 공유(getDisplayMedia)로 받아, 스크롤하며
// 보유 오퍼를 자동 인식한다. 100% 클라이언트. 파이프라인: 자동 격자 → 별 성급 →
// 인-도메인 직군 ZNCC → 이름 OCR → 성급/직군 제약 fuzzy 매칭 (2026-07-23 재건, 검증됨).
// 스크롤이 멈춘 '안정 프레임'만 처리하고, 같은 오퍼를 여러 프레임에서 보며 최고 점수를 채택한다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { T } from "../i18n";
import { ops, opById, type InfraOp } from "../planner-engine";
import { normSearch } from "../search";
import { scanFrame, type CellDetection } from "./vision";
import { matchOperator } from "./match";
import { initOcr, ocrNameBand, terminateOcr } from "./ocr";

interface Detected {
  id: string;
  op: InfraOp;
  score: number;
  nameSim: number;
  confident: boolean;
  seen: number;      // 몇 프레임에서 잡혔나(투표수)
  rarity: number;    // 검출된 성급
  cls: string;       // 검출된 직군
}

type Phase = "idle" | "requesting" | "ready" | "scanning" | "error";

const STAR = "★";

export function ScannerModal({ t, onClose, onApply }: {
  t: T;
  onClose: () => void;
  onApply: (ids: string[]) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const workCanvas = useRef<HTMLCanvasElement | null>(null);
  const tinyCanvas = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastTiny = useRef<Uint8ClampedArray | null>(null);
  const processedStable = useRef(false); // 현재 안정 화면을 이미 처리했나
  const stableCount = useRef(0);
  const busy = useRef(false);
  const loopId = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string>("");
  const [ocrStatus, setOcrStatus] = useState<string>("");
  const [debug, setDebug] = useState(true);
  const [frameInfo, setFrameInfo] = useState<string>("");
  const [results, setResults] = useState<Map<string, Detected>>(new Map());
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [addQuery, setAddQuery] = useState("");

  // ── 정리 ───────────────────────────────────────────────────────────────────
  const stopStream = useCallback(() => {
    if (loopId.current) { clearInterval(loopId.current); loopId.current = null; }
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => { stopStream(); terminateOcr(); }, [stopStream]);

  // ── 화면 공유 시작 ───────────────────────────────────────────────────────────
  const startCapture = useCallback(async () => {
    setErr(""); setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 8 }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      stream.getVideoTracks()[0].addEventListener("ended", () => { stopStream(); setPhase("ready"); });
      setPhase("ready");
      // OCR 모델 선로딩(첫 스캔 지연 감소)
      initOcr((status, p) => setOcrStatus(`${status} ${Math.round(p * 100)}%`)).then(() => setOcrStatus(""));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [stopStream]);

  // ── 프레임 처리(안정 화면 1회) ────────────────────────────────────────────────
  const processStableFrame = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const W = v.videoWidth, H = v.videoHeight;
    let wc = workCanvas.current;
    if (!wc) { wc = document.createElement("canvas"); workCanvas.current = wc; }
    wc.width = W; wc.height = H;
    const ctx = wc.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, W, H);
    const frame = ctx.getImageData(0, 0, W, H);
    const scan = scanFrame({ data: frame.data, width: W, height: H });
    setFrameInfo(t("격자 {c}열 · px {p} · 행 {r}", { c: String(scan.cols.length), p: String(scan.px), r: scan.rows.join(",") }));
    drawOverlay(scan.cells, W, H);

    // 각 셀 OCR + 매칭
    const next = new Map(resultsRef.current);
    for (const cell of scan.cells) {
      if (cell.rarity < 1) continue;
      let text = "";
      try { text = await ocrNameBand(wc, cell.nameBox, W, H); } catch { continue; }
      if (!text) continue;
      const m = matchOperator(text, { rarity: cell.rarity, cls: cell.cls, clsConf: cell.clsConf });
      if (!m || m.nameSim < 0.4) continue;
      const op = opById.get(m.id);
      if (!op) continue;
      const prev = next.get(m.id);
      if (!prev || m.score > prev.score) {
        next.set(m.id, { id: m.id, op, score: m.score, nameSim: m.nameSim, confident: m.confident, seen: (prev?.seen ?? 0) + 1, rarity: cell.rarity, cls: cell.cls });
      } else {
        next.set(m.id, { ...prev, seen: prev.seen + 1 });
      }
    }
    setResults(next);
  }, [t]);

  // ── 디버그 오버레이 ──────────────────────────────────────────────────────────
  const drawOverlay = useCallback((cells: CellDetection[], W: number, H: number) => {
    const ov = overlayRef.current, v = videoRef.current;
    if (!ov || !v) return;
    const rect = v.getBoundingClientRect();
    ov.width = rect.width; ov.height = rect.height;
    const sx = rect.width / W, sy = rect.height / H;
    const ctx = ov.getContext("2d")!;
    ctx.clearRect(0, 0, ov.width, ov.height);
    if (!debug) return;
    ctx.lineWidth = 2; ctx.font = "12px sans-serif";
    for (const c of cells) {
      const conf = c.clsConf >= 0.8;
      ctx.strokeStyle = conf ? "#7fe07f" : "#e0a020";
      ctx.strokeRect(c.card.x * sx, c.card.y * sy, c.card.w * sx, c.card.h * sy);
      ctx.strokeStyle = "#40a0ff";
      ctx.strokeRect(c.nameBox.x * sx, c.nameBox.y * sy, c.nameBox.w * sx, c.nameBox.h * sy);
      ctx.fillStyle = conf ? "#7fe07f" : "#e0a020";
      ctx.fillText(`${c.rarity}${STAR} ${c.cls.slice(0, 4)}`, c.card.x * sx + 2, c.card.y * sy - 3);
    }
  }, [debug]);

  // ── 스캔 루프(안정 감지) ──────────────────────────────────────────────────────
  const tick = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy.current) return;
    // 32x24 축소 프레임 diff로 스크롤/정지 판정
    let tc = tinyCanvas.current;
    if (!tc) { tc = document.createElement("canvas"); tc.width = 32; tc.height = 24; tinyCanvas.current = tc; }
    const tctx = tc.getContext("2d", { willReadFrequently: true })!;
    tctx.drawImage(v, 0, 0, 32, 24);
    const cur = tctx.getImageData(0, 0, 32, 24).data;
    let diff = 0;
    const prev = lastTiny.current;
    if (prev) for (let i = 0; i < cur.length; i += 4) diff += Math.abs(cur[i] - prev[i]);
    lastTiny.current = cur.slice();
    const moving = diff > 32 * 24 * 6; // 임계
    if (moving) { stableCount.current = 0; processedStable.current = false; return; }
    stableCount.current++;
    if (stableCount.current >= 2 && !processedStable.current) {
      processedStable.current = true;
      busy.current = true;
      try { await processStableFrame(); } finally { busy.current = false; }
    }
  }, [processStableFrame]);

  const toggleScan = useCallback(() => {
    if (phase === "scanning") {
      if (loopId.current) { clearInterval(loopId.current); loopId.current = null; }
      setPhase("ready");
    } else if (phase === "ready") {
      setPhase("scanning");
      processedStable.current = false; stableCount.current = 0; lastTiny.current = null;
      loopId.current = window.setInterval(() => { void tick(); }, 400);
    }
  }, [phase, tick]);

  // ── 결과 목록 ────────────────────────────────────────────────────────────────
  const kept = useMemo(() => Array.from(results.values()).filter((d) => !removed.has(d.id)), [results, removed]);
  const sorted = useMemo(() => [...kept].sort((a, b) =>
    (Number(b.confident) - Number(a.confident)) || (b.op.rarity - a.op.rarity) || (b.score - a.score)), [kept]);
  const confidentCount = kept.filter((d) => d.confident).length;
  const uncertainCount = kept.length - confidentCount;

  const addManual = useCallback((id: string) => {
    const op = opById.get(id);
    if (!op) return;
    setResults((prev) => {
      const n = new Map(prev);
      if (!n.has(id)) n.set(id, { id, op, score: 1, nameSim: 1, confident: true, seen: 0, rarity: op.rarity, cls: op.job });
      return n;
    });
    setRemoved((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setAddQuery("");
  }, []);

  const addMatches = useMemo(() => {
    const q = normSearch(addQuery);
    if (q.length < 1) return [];
    return ops.filter((o) => normSearch(o.name).includes(q) && !results.has(o.id)).slice(0, 6);
  }, [addQuery, results]);

  return (
    <section className="operator-modal scanner-modal" role="dialog" aria-modal="true" aria-label={t("보유 오퍼 스캔")}>
      <header className="scanner-head">
        <h2>{t("보유 오퍼 스캔")}</h2>
        <button className="modal-close" onClick={() => { stopStream(); onClose(); }} aria-label={t("닫기")}>✕</button>
      </header>

      {phase === "idle" && (
        <div className="scanner-intro">
          <p>{t("에뮬레이터(블루스택 등)의 오퍼레이터 목록 화면을 열고, 아래 버튼으로 그 창을 화면 공유하세요. 목록을 위/아래로 천천히 스크롤하면 보유 오퍼를 자동으로 인식합니다.")}</p>
          <ul className="scanner-tips">
            <li>{t("전체 화면이 아니라 에뮬레이터 '창'을 선택하면 정확도가 높습니다.")}</li>
            <li>{t("스크롤 후 잠깐 멈추면 그 화면을 인식합니다. 모두 100% 클라이언트에서 처리되며 서버로 전송되지 않습니다.")}</li>
          </ul>
          <button className="scanner-primary" onClick={startCapture}>{t("화면 공유 시작")}</button>
        </div>
      )}

      {phase === "error" && (
        <div className="scanner-intro">
          <p className="scanner-err">{t("화면 공유를 시작하지 못했습니다")}: {err}</p>
          <button className="scanner-primary" onClick={startCapture}>{t("다시 시도")}</button>
        </div>
      )}

      {(phase === "requesting" || phase === "ready" || phase === "scanning") && (
        <div className="scanner-body">
          <div className="scanner-stage">
            <div className="scanner-video-wrap">
              <video ref={videoRef} muted playsInline className="scanner-video" />
              <canvas ref={overlayRef} className="scanner-overlay" />
            </div>
            <div className="scanner-controls">
              <button className="scanner-primary" onClick={toggleScan} disabled={phase === "requesting"}>
                {phase === "scanning" ? t("스캔 멈춤") : t("스캔 시작")}
              </button>
              <label className="scanner-check"><input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />{t("검출 표시")}</label>
              {ocrStatus && <span className="scanner-ocr-status">{t("문자 인식 준비")}: {ocrStatus}</span>}
              {frameInfo && <span className="scanner-frame-info">{frameInfo}</span>}
              {phase === "scanning" && <span className="scanner-live">● {t("스크롤하며 인식 중")}</span>}
            </div>
          </div>

          <div className="scanner-results">
            <div className="scanner-results-head">
              <strong>{t("인식된 오퍼 {n}명", { n: String(kept.length) })}</strong>
              <span className="scanner-badge-ok">{t("확실 {n}", { n: String(confidentCount) })}</span>
              {uncertainCount > 0 && <span className="scanner-badge-warn">{t("확인 필요 {n}", { n: String(uncertainCount) })}</span>}
            </div>

            <div className="scanner-add">
              <input value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder={t("빠진 오퍼 직접 추가 (이름 검색)")} />
              {addMatches.length > 0 && (
                <div className="scanner-add-list">
                  {addMatches.map((o) => (
                    <button key={o.id} onClick={() => addManual(o.id)}>
                      <img src={o.image} alt="" width={28} height={28} />{o.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="scanner-grid">
              {sorted.map((d) => (
                <div key={d.id} className={`scanner-card${d.confident ? "" : " uncertain"}`} title={`${d.op.name} · sim ${d.nameSim.toFixed(2)} · ${d.seen}회`}>
                  <img src={d.op.image} alt="" width={44} height={44} loading="lazy" />
                  <div className="scanner-card-info">
                    <span className="scanner-card-name">{d.op.name}</span>
                    <span className="scanner-card-meta">{STAR.repeat(d.op.rarity)} · {d.op.job}{d.confident ? "" : ` · ${t("확인 필요")}`}</span>
                  </div>
                  <button className="scanner-card-x" onClick={() => setRemoved((prev) => new Set(prev).add(d.id))} aria-label={t("제거")}>✕</button>
                </div>
              ))}
              {sorted.length === 0 && <p className="scanner-empty">{t("아직 인식된 오퍼가 없습니다. '스캔 시작'을 누르고 목록을 스크롤하세요.")}</p>}
            </div>
          </div>
        </div>
      )}

      <footer className="scanner-foot">
        <button onClick={() => { stopStream(); onClose(); }}>{t("취소")}</button>
        <button className="scanner-primary" disabled={kept.length === 0}
          onClick={() => { stopStream(); onApply(kept.map((d) => d.id)); }}>
          {t("{n}명 보유로 추가", { n: String(kept.length) })}
        </button>
      </footer>
    </section>
  );
}
