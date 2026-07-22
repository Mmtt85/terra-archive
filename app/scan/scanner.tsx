"use client";

// 오퍼 보유 스캐너 UI — 에뮬레이터 창을 화면 공유(getDisplayMedia)로 받아, 스크롤한 뒤
// [이 화면 인식]을 누르면 현재 프레임 1장을 인식한다(수동 스냅샷 방식, 2026-07-23).
// 자동 감지 루프의 타이밍 버그(스크롤이 OCR 처리와 겹치면 화면을 건너뜀)를 피하려 사용자가
// 화면마다 직접 누른다. 100% 클라이언트. 파이프라인: 자동 격자 → 별 성급 →
// 인-도메인 직군 ZNCC → 이름 OCR → 성급/직군 제약 fuzzy 매칭 (검증됨).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { T } from "../i18n";
import { ops, opById, maxElite, ELITE_LABEL, type Elite, type InfraOp } from "../planner-engine";
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
  seen: number;      // 몇 번 인식됐나
  rarity: number;
  cls: string;
  elite: Elite;      // 기본 maxElite(완성) — 사용자가 토글로 조정
}

type Phase = "idle" | "requesting" | "ready" | "error";

const STAR = "★";
const MAX_W = 1600; // 처리 해상도 상한(Retina 캡처 과대해상도 대비 속도)

export function ScannerModal({ t, onClose, onApply }: {
  t: T;
  onClose: () => void;
  onApply: (dets: { id: string; elite: Elite }[]) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const workCanvas = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busy = useRef(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState("");
  const [ocrStatus, setOcrStatus] = useState("");
  const [debug, setDebug] = useState(true);
  const [frameInfo, setFrameInfo] = useState("");
  const [recognizing, setRecognizing] = useState(false);
  const [vAspect, setVAspect] = useState("16 / 10");
  const [results, setResults] = useState<Map<string, Detected>>(new Map());
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [addQuery, setAddQuery] = useState("");

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => { stopStream(); terminateOcr(); }, [stopStream]);

  // ── 화면 공유 시작 ───────────────────────────────────────────────────────────
  const startCapture = useCallback(async () => {
    setErr(""); setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      stream.getVideoTracks()[0].addEventListener("ended", () => { stopStream(); setPhase("idle"); });
      setPhase("ready");
      initOcr((status, p) => setOcrStatus(`${status} ${Math.round(p * 100)}%`)).then(() => setOcrStatus(""));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [stopStream]);

  const onVideoMeta = useCallback(() => {
    const v = videoRef.current;
    if (v?.videoWidth) setVAspect(`${v.videoWidth} / ${v.videoHeight}`);
  }, []);

  // ── 디버그 오버레이 (object-fit:contain 레터박스 보정) ────────────────────────
  const drawOverlay = useCallback((cells: CellDetection[], W: number, H: number) => {
    const ov = overlayRef.current, v = videoRef.current;
    if (!ov || !v) return;
    const rect = v.getBoundingClientRect();
    ov.width = rect.width; ov.height = rect.height;
    const ctx = ov.getContext("2d")!;
    ctx.clearRect(0, 0, ov.width, ov.height);
    if (!debug) return;
    const s = Math.min(rect.width / W, rect.height / H);
    const offX = (rect.width - W * s) / 2, offY = (rect.height - H * s) / 2;
    const mx = (x: number) => offX + x * s, my = (y: number) => offY + y * s;
    ctx.lineWidth = 2; ctx.font = "12px sans-serif";
    for (const c of cells) {
      const conf = c.clsConf >= 0.8;
      ctx.strokeStyle = conf ? "#7fe07f" : "#e0a020";
      ctx.strokeRect(mx(c.card.x), my(c.card.y), c.card.w * s, c.card.h * s);
      ctx.strokeStyle = "#40a0ff";
      ctx.strokeRect(mx(c.nameBox.x), my(c.nameBox.y), c.nameBox.w * s, c.nameBox.h * s);
      ctx.fillStyle = conf ? "#7fe07f" : "#e0a020";
      ctx.fillText(`${c.rarity}${STAR} ${c.cls.slice(0, 4)}`, mx(c.card.x) + 2, my(c.card.y) - 3);
    }
  }, [debug]);

  // ── 실시간 격자 프리뷰(OCR 없이 격자·성급·직군만, 스냅샷 전에 정렬 확인) ────────
  const livePreview = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy.current) return;
    const scale = Math.min(1, MAX_W / v.videoWidth);
    const W = Math.round(v.videoWidth * scale), H = Math.round(v.videoHeight * scale);
    let wc = workCanvas.current;
    if (!wc) { wc = document.createElement("canvas"); workCanvas.current = wc; }
    wc.width = W; wc.height = H;
    const ctx = wc.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, W, H);
    const frame = ctx.getImageData(0, 0, W, H);
    const scan = scanFrame({ data: frame.data, width: W, height: H });
    setFrameInfo(t("격자 {c}열 · px {p} · 행 {r}", { c: String(scan.cols.length), p: String(scan.px), r: scan.rows.join(",") }));
    drawOverlay(scan.cells, W, H);
  }, [t, drawOverlay]);

  useEffect(() => {
    if (phase !== "ready") return;
    const id = window.setInterval(() => { if (!busy.current) livePreview(); }, 500);
    return () => clearInterval(id);
  }, [phase, livePreview]);

  // ── 현재 화면 1장 인식 ────────────────────────────────────────────────────────
  const recognizeCurrent = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy.current) return;
    busy.current = true; setRecognizing(true);
    try {
      // 원본 해상도 캔버스(OCR용) — 레티나 캡처(~2900px)를 다운스케일한 뒤 OCR하면
      // 이름 글자가 뭉개져 복구 불가(라이브 4/14 vs 원본 12/14의 원인). 격자 감지만 축소본으로.
      const FW = v.videoWidth, FH = v.videoHeight;
      let wc = workCanvas.current;
      if (!wc) { wc = document.createElement("canvas"); workCanvas.current = wc; }
      wc.width = FW; wc.height = FH;
      const fctx = wc.getContext("2d", { willReadFrequently: true })!;
      fctx.drawImage(v, 0, 0, FW, FH);
      const scale = Math.min(1, MAX_W / FW);
      const W = Math.round(FW * scale), H = Math.round(FH * scale);
      const sc = document.createElement("canvas");
      sc.width = W; sc.height = H;
      const sctx = sc.getContext("2d", { willReadFrequently: true })!;
      sctx.drawImage(wc, 0, 0, W, H);
      const frame = sctx.getImageData(0, 0, W, H);
      const scan = scanFrame({ data: frame.data, width: W, height: H });
      setFrameInfo(t("격자 {c}열 · px {p} · 행 {r}", { c: String(scan.cols.length), p: String(scan.px), r: scan.rows.join(",") }));
      drawOverlay(scan.cells, W, H);
      await initOcr((status, p) => setOcrStatus(`${status} ${Math.round(p * 100)}%`));
      setOcrStatus("");

      const inv = 1 / scale; // 축소좌표 → 원본좌표
      const next = new Map(resultsRef.current);
      for (const cell of scan.cells) {
        if (cell.rarity < 1) continue;
        const nb = { x: cell.nameBox.x * inv, y: cell.nameBox.y * inv, w: cell.nameBox.w * inv, h: cell.nameBox.h * inv };
        let text = "";
        try { text = await ocrNameBand(wc, nb, FW, FH); } catch { continue; }
        if (!text) continue;
        const m = matchOperator(text, { rarity: cell.rarity, cls: cell.cls, clsConf: cell.clsConf });
        // 라이브 진단용 — 셀별 OCR 원문과 매칭 결과 (개발자도구 콘솔)
        console.debug(`[scan] r${cell.row}c${cell.col} ${cell.rarity}★${cell.cls} ocr=${JSON.stringify(text)} → ${m?.name}(${m?.nameSim.toFixed(2)})`);
        if (!m || m.nameSim < 0.4) continue;
        const op = opById.get(m.id);
        if (!op) continue;
        const prev = next.get(m.id);
        if (!prev || m.score > prev.score) {
          next.set(m.id, { id: m.id, op, score: m.score, nameSim: m.nameSim, confident: m.confident, seen: (prev?.seen ?? 0) + 1, rarity: cell.rarity, cls: cell.cls, elite: prev?.elite ?? maxElite(op.rarity) });
        } else {
          next.set(m.id, { ...prev, seen: prev.seen + 1 });
        }
      }
      setResults(next);
    } finally {
      busy.current = false; setRecognizing(false);
    }
  }, [t, drawOverlay]);

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
      if (!n.has(id)) n.set(id, { id, op, score: 1, nameSim: 1, confident: true, seen: 0, rarity: op.rarity, cls: op.job, elite: maxElite(op.rarity) });
      return n;
    });
    setRemoved((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setAddQuery("");
  }, []);

  // 정예화 토글 (0→1→2→0, 성급 상한까지만)
  const cycleElite = useCallback((id: string) => {
    setResults((prev) => {
      const d = prev.get(id);
      if (!d) return prev;
      const cap = maxElite(d.op.rarity);
      const n = new Map(prev);
      n.set(id, { ...d, elite: (d.elite >= cap ? 0 : ((d.elite + 1) as Elite)) });
      return n;
    });
  }, []);

  const addMatches = useMemo(() => {
    const q = normSearch(addQuery);
    if (q.length < 1) return [];
    return ops.filter((o) => normSearch(o.name).includes(q) && !results.has(o.id)).slice(0, 6);
  }, [addQuery, results]);

  const active = phase === "requesting" || phase === "ready";

  return (
    <section className="operator-modal scanner-modal" role="dialog" aria-modal="true" aria-label={t("보유 오퍼 스캔")}>
      <header className="scanner-head">
        <h2>{t("보유 오퍼 스캔")} <span className="scanner-ver">v3</span></h2>
        <button className="modal-close" onClick={() => { stopStream(); onClose(); }} aria-label={t("닫기")}>✕</button>
      </header>

      {phase === "idle" && (
        <div className="scanner-intro">
          <p>{t("에뮬레이터(블루스택 등)의 오퍼레이터 목록 화면을 열고, 아래 버튼으로 그 창을 화면 공유하세요. 목록을 스크롤한 뒤 [이 화면 인식]을 누르면 그 화면의 보유 오퍼를 인식합니다. 화면마다 반복하면 오퍼가 누적됩니다.")}</p>
          <ul className="scanner-tips">
            <li>{t("전체 화면이 아니라 에뮬레이터 '창'을 선택하면 정확도가 높습니다.")}</li>
            <li>{t("스크롤 후 잠깐 멈추면 그 화면을 인식합니다. 모두 100% 클라이언트에서 처리되며 서버로 전송되지 않습니다.")}</li>
            <li>{t("정예화는 완성(최대)으로 표시됩니다 — 다른 오퍼는 이름 옆 배지를 눌러 조정하세요.")}</li>
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

      {active && (
        <div className="scanner-body">
          <div className="scanner-stage">
            <div className="scanner-video-wrap" style={{ aspectRatio: vAspect }}>
              <video ref={videoRef} muted playsInline className="scanner-video" onLoadedMetadata={onVideoMeta} />
              <canvas ref={overlayRef} className="scanner-overlay" />
            </div>
            <div className="scanner-controls">
              <button className="scanner-primary" onClick={recognizeCurrent} disabled={phase !== "ready" || recognizing}>
                {recognizing ? t("인식 중…") : t("이 화면 인식")}
              </button>
              <label className="scanner-check"><input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />{t("검출 표시")}</label>
              {ocrStatus && <span className="scanner-ocr-status">{t("문자 인식 준비")}: {ocrStatus}</span>}
              {frameInfo && <span className="scanner-frame-info">{frameInfo}</span>}
            </div>
            <p className="scanner-hint">{t("에뮬레이터에서 목록을 스크롤한 뒤 [이 화면 인식]을 누르세요. 화면을 바꿔가며 반복하면 오퍼가 누적됩니다.")}</p>
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
                  <button className={`scanner-elite e${d.elite}`} onClick={() => cycleElite(d.id)}
                    disabled={maxElite(d.op.rarity) === 0} title={t("정예화 단계 (눌러서 변경)")}>{ELITE_LABEL[d.elite]}</button>
                  <button className="scanner-card-x" onClick={() => setRemoved((prev) => new Set(prev).add(d.id))} aria-label={t("제거")}>✕</button>
                </div>
              ))}
              {sorted.length === 0 && <p className="scanner-empty">{t("아직 인식된 오퍼가 없습니다. 목록을 스크롤하고 [이 화면 인식]을 누르세요.")}</p>}
            </div>
          </div>
        </div>
      )}

      <footer className="scanner-foot">
        <button onClick={() => { stopStream(); onClose(); }}>{t("취소")}</button>
        <button className="scanner-primary" disabled={kept.length === 0}
          onClick={() => { stopStream(); onApply(kept.map((d) => ({ id: d.id, elite: d.elite }))); }}>
          {t("{n}명 보유로 추가", { n: String(kept.length) })}
        </button>
      </footer>
    </section>
  );
}
