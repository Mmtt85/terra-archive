"use client";

// 에뮬레이터 화면 연동 + 오퍼 인식 스캐너.
// ① getDisplayMedia로 에뮬레이터(또는 명일방주) 창을 캡처 → 미리보기
// ② 현재 프레임을 정지시키고, 오퍼 카드 격자에 인식 영역(ROI)을 드래그로 맞춤
// ③ 각 카드의 '이름 밴드'를 한국어 OCR로 읽어 우리 오퍼 사전에 fuzzy match → 보유 오퍼 식별
//    (게임 카드 아트는 우리 아바타와 달라 초상화 매칭이 실패 → 이름 OCR이 정식 식별자, 2026-07-22)
// 100% 클라이언트: 캡처·OCR 전부 이 브라우저 안에서만, 화면 픽셀은 어디에도 전송 안 함.
// 지금은 "한 화면(정지 프레임) 인식 증명" 단계. 스크롤 자동 누적 스캔은 다음 단계.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { startDisplayCapture, sampleBrightness } from "./screen-capture";
import { initOcr, ocrName, terminateOcr, type OcrProgress } from "./scanner-ocr";
import { initNames, matchName, type NameMatch } from "./scanner-names";

type Rect = { x: number; y: number; w: number; h: number }; // 0~1 정규화 (프레임 기준)
type CellMatch = { r: number; c: number; band: Rect; match: NameMatch | null };

// 이름 밴드 기본값 — 카드 안에서 이름 텍스트가 있는 아래쪽 띠(세로 비율)와 좌우 여백. 게임 화면에 맞춰 보정.
const DEFAULT_BAND = { top: 0.84, bottom: 1.0, inset: 0.02 };
const DEFAULT_ROI: Rect = { x: 0.1, y: 0.16, w: 0.8, h: 0.66 };
// fuzzy 유사도(0~1) 확신도 색. 실제 게임 폰트로 임계값은 실측 후 재보정.
const conf = (s: number) => (s >= 0.75 ? "good" : s >= 0.5 ? "mid" : "low");
const pct = (s: number) => Math.round(s * 100);

export default function EmulatorCapture({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frozenRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [black, setBlack] = useState(false);
  const [mode, setMode] = useState<"live" | "frozen">("live");
  const [roi, setRoi] = useState<Rect>(DEFAULT_ROI);
  const [cols, setCols] = useState(7);
  const [rows, setRows] = useState(2);
  const [band, setBand] = useState(DEFAULT_BAND);
  const [matches, setMatches] = useState<CellMatch[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [ocrStatus, setOcrStatus] = useState<string>(""); // OCR 엔진 준비 상태
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // 스캐너 열리면 OCR 엔진·이름 사전 미리 로드 (첫 인식이 빠르게)
  useEffect(() => {
    void initNames();
    void initOcr((p: OcrProgress) => {
      setOcrStatus(p.progress >= 1 || p.status === "recognizing text" ? "" : `${p.status} ${Math.round(p.progress * 100)}%`);
    }).then(() => setOcrStatus(""));
    return () => { void terminateOcr(); };
  }, []);

  // ── 캡처 시작/정리 ──────────────────────────────────────────────────────────
  const stop = () => { stream?.getTracks().forEach((tk) => tk.stop()); setStream(null); setDims(null); setBlack(false); };
  const start = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) return;
    try {
      const s = await startDisplayCapture();
      stop();
      setStream(s);
      setMode("live");
      setMatches(null);
      s.getVideoTracks()[0]?.addEventListener("ended", () => { setStream(null); setDims(null); });
    } catch { /* 취소/오류는 조용히 */ }
  };
  useEffect(() => { const id = window.setTimeout(() => void start(), 0); return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { stream?.getTracks().forEach((tk) => tk.stop()); }, [stream]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !stream || mode !== "live") return;
    v.srcObject = stream;
    void v.play().catch(() => {});
    const tick = () => { if (v.videoWidth) setDims({ w: v.videoWidth, h: v.videoHeight }); setBlack(sampleBrightness(v) < 0.03); };
    const id = window.setInterval(tick, 1000);
    const first = window.setTimeout(tick, 0);
    return () => { window.clearInterval(id); window.clearTimeout(first); };
  }, [stream, mode]);

  // ── 프레임 정지 ──────────────────────────────────────────────────────────────
  const freeze = () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const canvas = frozenRef.current ?? document.createElement("canvas");
    frozenRef.current = canvas;
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    setDims({ w: v.videoWidth, h: v.videoHeight });
    setMode("frozen");
    setMatches(null);
  };
  const loadImage = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = frozenRef.current ?? document.createElement("canvas");
      frozenRef.current = canvas;
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
      setMode("frozen");
      setMatches(null);
      URL.revokeObjectURL(url);
      requestAnimationFrame(paintFrozen);
    };
    img.src = url;
  };
  const paintFrozen = () => {
    const src = frozenRef.current;
    const disp = document.getElementById("cap-frozen-disp") as HTMLCanvasElement | null;
    if (!src || !disp) return;
    disp.width = src.width; disp.height = src.height;
    disp.getContext("2d")!.drawImage(src, 0, 0);
  };
  useEffect(() => { if (mode === "frozen") requestAnimationFrame(paintFrozen); }, [mode]);

  // ── ROI 드래그 ──────────────────────────────────────────────────────────────
  const toNorm = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) };
  };
  const onDown = (e: React.PointerEvent) => {
    if (mode !== "frozen") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toNorm(e); dragRef.current = p; setRoi({ x: p.x, y: p.y, w: 0, h: 0 }); setMatches(null);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const p = toNorm(e); const s = dragRef.current;
    setRoi({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onUp = () => { if (!dragRef.current) return; dragRef.current = null; setRoi((r) => (r.w < 0.02 || r.h < 0.02 ? DEFAULT_ROI : r)); };

  // 격자 셀 → 이름 밴드 (정규화). 오버레이·인식 공용.
  const bandOf = (r: number, c: number): Rect => {
    const cw = roi.w / cols, ch = roi.h / rows;
    const cx = roi.x + c * cw, cy = roi.y + r * ch;
    return { x: cx + cw * band.inset, y: cy + ch * band.top, w: cw * (1 - band.inset * 2), h: ch * (band.bottom - band.top) };
  };
  const bandCells: { r: number; c: number; band: Rect }[] = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) bandCells.push({ r, c, band: bandOf(r, c) });

  // ── 인식 (이름 밴드 OCR → fuzzy match) ──────────────────────────────────────
  const recognize = async () => {
    const frame = frozenRef.current;
    if (!frame || progress) return;
    await Promise.all([initOcr(), initNames()]);
    const W = frame.width, H = frame.height;
    const out: CellMatch[] = [];
    setProgress({ done: 0, total: bandCells.length });
    for (let i = 0; i < bandCells.length; i += 1) {
      const { r, c, band: b } = bandCells[i];
      const text = await ocrName(frame, b.x * W, b.y * H, b.w * W, b.h * H);
      out.push({ r, c, band: b, match: text ? matchName(text) : null });
      setProgress({ done: i + 1, total: bandCells.length });
    }
    setProgress(null);
    setMatches(out);
  };

  // 중복 제거한 인식 결과 (id별 최고 sim)
  const found = matches
    ? Array.from(matches.reduce((m, cm) => {
        if (cm.match) { const cur = m.get(cm.match.id); if (!cur || cm.match.sim > cur.sim) m.set(cm.match.id, cm.match); }
        return m;
      }, new Map<string, NameMatch>()).values()).sort((a, b) => b.sim - a.sim)
    : [];

  const cpct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const matchAt = (r: number, c: number) => matches?.find((m) => m.r === r && m.c === c)?.match ?? null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { stop(); onClose(); } }}>
      <section className="operator-modal room-modal capture-modal" style={{ "--accent": "var(--lime)" } as React.CSSProperties}>
        <button type="button" className="modal-close" onClick={() => { stop(); onClose(); }} aria-label={t("닫기")}>×</button>
        <header className="room-modal-head">
          <span className="modal-kicker">SCREEN LINK · SCAN</span>
          <h2>{t("에뮬레이터 화면 연동")}</h2>
          <div className="roster-tools">
            <button type="button" className="apply" onClick={() => { void start(); }}>{t("다시 선택")}</button>
            <label className="import-label">{t("이미지로 테스트")}<input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadImage(f); e.target.value = ""; }} /></label>
            <button type="button" onClick={() => { stop(); onClose(); }}>{t("연동 해제")}</button>
          </div>
        </header>

        <div className="capture-body">
          <div className="cap-stage" ref={stageRef}>
            {mode === "live" ? (
              <>
                <video ref={videoRef} className="capture-video" autoPlay muted playsInline />
                {!stream && <p className="capture-hint">{t("화면 선택창에서 에뮬레이터(또는 명일방주) 창을 고르세요.")}</p>}
              </>
            ) : (
              <div className="cap-frozen-wrap" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
                <canvas id="cap-frozen-disp" className="cap-frozen-canvas" />
                <div className="cap-roi" style={{ left: cpct(roi.x), top: cpct(roi.y), width: cpct(roi.w), height: cpct(roi.h) }} />
                {/* 이름 밴드 오버레이 (인식 전엔 밴드 위치 확인용, 인식 후엔 결과 라벨) */}
                {bandCells.map(({ r, c, band: b }, i) => {
                  const m = matchAt(r, c);
                  return (
                    <div key={i} className={`cap-cell ${matches ? (m ? conf(m.sim) : "none") : "band"}`}
                      style={{ left: cpct(b.x), top: cpct(b.y), width: cpct(b.w), height: cpct(b.h) }}>
                      {m && <span className="cap-cell-lbl">{`${m.name}·${pct(m.sim)}`}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {black && mode === "live" && <p className="capture-warn">{t("검은 화면만 잡힙니다 — 게임 화면 보호(DRM)로 캡처가 막혔을 수 있어요. 에뮬레이터 창을 고르거나 '화면 전체'를 선택해 보세요.")}</p>}

          <div className="cap-controls">
            {mode === "live" ? (
              <button type="button" className="apply" onClick={freeze} disabled={!stream}>{t("현재 화면 정지")}</button>
            ) : (
              <>
                <button type="button" onClick={() => { setMode("live"); setMatches(null); }}>{t("라이브로")}</button>
                <label className="cap-num">{t("열")}<input type="number" min={1} max={12} value={cols} onChange={(e) => setCols(Math.max(1, Math.min(12, +e.target.value || 1)))} /></label>
                <label className="cap-num">{t("행")}<input type="number" min={1} max={6} value={rows} onChange={(e) => setRows(Math.max(1, Math.min(6, +e.target.value || 1)))} /></label>
                <label className="cap-range">{t("이름 상단")}<input type="range" min={0.4} max={0.98} step={0.01} value={band.top} onChange={(e) => setBand((b) => ({ ...b, top: +e.target.value }))} /></label>
                <label className="cap-range">{t("이름 하단")}<input type="range" min={0.5} max={1} step={0.01} value={band.bottom} onChange={(e) => setBand((b) => ({ ...b, bottom: +e.target.value }))} /></label>
                <button type="button" className="apply cap-run" onClick={() => { void recognize(); }} disabled={!!progress}>{progress ? t("인식 중… {i}/{n}", { i: progress.done, n: progress.total }) : t("인식")}</button>
              </>
            )}
          </div>

          <p className="capture-status">
            {ocrStatus
              ? t("OCR 엔진 준비 중… {s}", { s: ocrStatus })
              : mode === "frozen"
                ? (matches ? t("{n}명 인식됨 (초록=정확, 노랑/빨강=애매)", { n: found.length }) : t("이름 밴드를 카드 이름 위치에 맞추고 '인식'을 누르세요. 격자는 드래그로 다시 그릴 수 있어요."))
                : (stream ? (dims ? t("연동됨 · {w}×{h}", { w: dims.w, h: dims.h }) : t("연동됨 · 프레임 대기 중…")) : t("연동 대기 중"))}
          </p>

          {found.length > 0 && (
            <div className="cap-results">
              {found.map((m) => (
                <span key={m.id} className={`cap-chip ${conf(m.sim)}`} title={`OCR "${m.text}" → ${m.name} (${pct(m.sim)}%)`}>
                  <img src={`/avatars/${m.id}.webp`} alt="" width={34} height={34} loading="lazy" />
                  <b>{m.name}</b>
                </span>
              ))}
            </div>
          )}

          <p className="capture-privacy">{t("이 영상은 이 브라우저 안에서만 처리되며 어디에도 전송되지 않습니다. 다음 단계에서 스크롤하며 자동으로 누적 인식합니다.")}</p>
        </div>
      </section>
    </div>
  );
}
