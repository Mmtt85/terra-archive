"use client";

// 오퍼 보유 스캐너 UI — 에뮬레이터 창을 화면 공유(getDisplayMedia)로 받아, 스크롤한 뒤
// [이 화면 인식]을 누르면 현재 프레임 1장을 인식한다(수동 스냅샷 방식, 2026-07-23).
// 100% 클라이언트. 파이프라인(v4): 자동 격자 → 별 성급 → 카드 아트 ↔ 초상(스킨 포함)
// masked ZNCC 매칭 → 정예화 엠블럼 3-way. 픽스처 138셀 식별·정예화 100% (verify-scan.ts).
// 이전 이름 OCR(tesseract, 상한 84%)은 아트 매칭으로 대체·제거됨.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { T } from "../i18n";
import { ops, opById, maxElite, ELITE_LABEL, type Elite, type InfraOp } from "../planner-engine";
import { normSearch } from "../search";
import { scanFrame, type CellDetection } from "./vision";
import { toGray, matchArt, classifyElite } from "./artmatch";

interface Detected {
  id: string;
  op: InfraOp;
  score: number;       // 아트 ZNCC
  margin: number;      // 타 오퍼와의 점수 차
  pid: string;         // 인식된 초상(스킨) id — 진단용
  confident: boolean;
  seen: number;        // 몇 번 인식됐나
  rarity: number;
  cls: string;
  elite: Elite;        // 엠블럼 자동 인식 (성급 상한 클램프) — 배지로 수동 수정 가능
  eliteManual: boolean; // 사용자가 손으로 고쳤으면 이후 스캔이 덮어쓰지 않음
}

// 신뢰 판정(픽스처 138셀 실측: 정답 최저 0.80/마진 최저 0.11, 오답 최고 0.75)
const SCORE_MIN = 0.55;      // 미만이면 검출 자체를 버림
const CONFIDENT_SCORE = 0.8;
const CONFIDENT_MARGIN = 0.05;

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

  useEffect(() => () => { stopStream(); }, [stopStream]);

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
  // 아트 매칭은 축소본(≤MAX_W)에서 충분 — 픽스처 검증도 같은 해상도 경로로 수행됨.
  const recognizeCurrent = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy.current) return;
    busy.current = true; setRecognizing(true);
    try {
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

      const g = toGray({ data: frame.data, width: W, height: H });
      const next = new Map(resultsRef.current);
      for (const cell of scan.cells) {
        if (cell.rarity < 1) continue;
        const am = matchArt(g, cell.sx, cell.ry, scan.px);
        if (!am || am.best.score < SCORE_MIN) continue;
        const op = opById.get(am.best.op);
        if (!op) continue;
        const el = classifyElite(g, cell.sx, cell.ry, scan.px);
        const elite = Math.min(el.elite, maxElite(op.rarity)) as Elite;
        const confident = am.best.score >= CONFIDENT_SCORE && am.margin >= CONFIDENT_MARGIN;
        // 라이브 진단용 — 셀별 매칭 결과 (개발자도구 콘솔)
        console.debug(`[scan] r${cell.row}c${cell.col} ${cell.rarity}★${cell.cls} → ${op.name} ${am.best.score.toFixed(3)} 마진${am.margin.toFixed(3)} E${elite}[${el.s1.toFixed(2)}/${el.s2.toFixed(2)}] ${am.best.pid}`);
        const prev = next.get(op.id);
        if (!prev || am.best.score > prev.score) {
          next.set(op.id, {
            id: op.id, op, score: am.best.score, margin: am.margin, pid: am.best.pid,
            confident: confident || (prev?.confident ?? false), seen: (prev?.seen ?? 0) + 1,
            rarity: cell.rarity, cls: cell.cls,
            elite: prev?.eliteManual ? prev.elite : elite,
            eliteManual: prev?.eliteManual ?? false,
          });
        } else {
          next.set(op.id, { ...prev, seen: prev.seen + 1, confident: prev.confident || confident });
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
      if (!n.has(id)) n.set(id, { id, op, score: 1, margin: 1, pid: "", confident: true, seen: 0, rarity: op.rarity, cls: op.job, elite: maxElite(op.rarity), eliteManual: false });
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
      n.set(id, { ...d, elite: (d.elite >= cap ? 0 : ((d.elite + 1) as Elite)), eliteManual: true });
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
        <h2>{t("보유 오퍼 스캔")} <span className="scanner-ver">v4</span></h2>
        <button className="modal-close" onClick={() => { stopStream(); onClose(); }} aria-label={t("닫기")}>✕</button>
      </header>

      {phase === "idle" && (
        <div className="scanner-intro">
          <p>{t("에뮬레이터(블루스택 등)의 오퍼레이터 목록 화면을 열고, 아래 버튼으로 그 창을 화면 공유하세요. 목록을 스크롤한 뒤 [이 화면 인식]을 누르면 그 화면의 보유 오퍼를 인식합니다. 화면마다 반복하면 오퍼가 누적됩니다.")}</p>
          <ul className="scanner-tips">
            <li>{t("전체 화면이 아니라 에뮬레이터 '창'을 선택하면 정확도가 높습니다.")}</li>
            <li>{t("스크롤 후 잠깐 멈추면 그 화면을 인식합니다. 모두 100% 클라이언트에서 처리되며 서버로 전송되지 않습니다.")}</li>
            <li>{t("정예화(0/1/2정)는 카드 엠블럼으로 자동 인식됩니다 — 잘못 읽힌 오퍼만 이름 옆 배지를 눌러 고치세요.")}</li>
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
                <div key={d.id} className={`scanner-card${d.confident ? "" : " uncertain"}`} title={`${d.op.name} · ${d.score.toFixed(2)}/${d.margin.toFixed(2)} · ${d.seen}회${d.pid ? ` · ${d.pid}` : ""}`}>
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
