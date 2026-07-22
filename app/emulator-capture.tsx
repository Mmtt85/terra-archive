"use client";

// 에뮬레이터 화면 연동 + 오퍼 인식 스캐너.
// ① getDisplayMedia로 에뮬레이터(또는 명일방주) 창을 캡처 → 미리보기
// ② '인식'을 누르면 현재 화면 전체를 한 번에 한국어 OCR → 감지된 글자를 위치로 묶어(카드 이름)
//    우리 오퍼 사전(436명·한/영/일+별명)에 fuzzy match. 격자·크롭·수동 보정 없이 전자동.
//    (게임 카드 아트는 우리 아바타와 달라 초상화 매칭은 폐기 — 이름 OCR이 식별자, 2026-07-22)
// 100% 클라이언트: 캡처·OCR 전부 이 브라우저 안에서만, 화면 픽셀은 어디에도 전송 안 함.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { startDisplayCapture, sampleBrightness } from "./screen-capture";
import { initOcr, ocrWords, terminateOcr, type OcrProgress } from "./scanner-ocr";
import { initNames, detectFromWords, type Detection } from "./scanner-names";

const conf = (s: number) => (s >= 0.75 ? "good" : s >= 0.5 ? "mid" : "low");
const pct = (s: number) => Math.round(s * 100);

export default function EmulatorCapture({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frozenRef = useRef<HTMLCanvasElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [black, setBlack] = useState(false);
  const [mode, setMode] = useState<"live" | "frozen">("live");
  const [detections, setDetections] = useState<Detection[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [ocrStatus, setOcrStatus] = useState("");

  // 열리면 OCR 엔진·이름 사전 미리 로드
  useEffect(() => {
    void initNames();
    void initOcr((p: OcrProgress) => setOcrStatus(p.progress >= 1 || p.status === "recognizing text" ? "" : `${p.status} ${Math.round(p.progress * 100)}%`))
      .then(() => setOcrStatus(""));
    return () => { void terminateOcr(); };
  }, []);

  // ── 캡처 ────────────────────────────────────────────────────────────────────
  const stop = () => { stream?.getTracks().forEach((tk) => tk.stop()); setStream(null); setDims(null); setBlack(false); };
  const start = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) return;
    try {
      const s = await startDisplayCapture();
      stop();
      setStream(s); setMode("live"); setDetections(null);
      s.getVideoTracks()[0]?.addEventListener("ended", () => { setStream(null); setDims(null); });
    } catch { /* 취소/오류 무시 */ }
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

  const paintFrozen = () => {
    const src = frozenRef.current;
    const disp = document.getElementById("cap-frozen-disp") as HTMLCanvasElement | null;
    if (!src || !disp) return;
    disp.width = src.width; disp.height = src.height;
    disp.getContext("2d")!.drawImage(src, 0, 0);
  };
  useEffect(() => { if (mode === "frozen") requestAnimationFrame(paintFrozen); }, [mode, detections]);

  const grabFrame = (): HTMLCanvasElement | null => {
    const v = videoRef.current;
    if (!v?.videoWidth) return frozenRef.current;
    const canvas = frozenRef.current ?? document.createElement("canvas");
    frozenRef.current = canvas;
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    setDims({ w: v.videoWidth, h: v.videoHeight });
    return canvas;
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
      setMode("frozen"); setDetections(null);
      URL.revokeObjectURL(url);
      requestAnimationFrame(paintFrozen);
      void recognize(canvas);
    };
    img.src = url;
  };

  // ── 인식 (전체프레임 OCR → 자동 클러스터 → fuzzy match) ─────────────────────
  const recognize = async (canvasArg?: HTMLCanvasElement) => {
    if (busy) return;
    const frame = canvasArg ?? (mode === "live" ? grabFrame() : frozenRef.current);
    if (!frame) return;
    setBusy(true);
    setMode("frozen");
    setDetections(null);
    requestAnimationFrame(paintFrozen);
    try {
      await Promise.all([initOcr(), initNames()]);
      const words = await ocrWords(frame, frame.width, frame.height);
      setDetections(detectFromWords(words));
    } finally {
      setBusy(false);
    }
  };

  const W = dims?.w ?? 1, H = dims?.h ?? 1;
  const pctL = (v: number) => `${(v * 100).toFixed(2)}%`;

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
          <div className="cap-stage">
            {mode === "live" ? (
              <>
                <video ref={videoRef} className="capture-video" autoPlay muted playsInline />
                {!stream && <p className="capture-hint">{t("화면 선택창에서 에뮬레이터(또는 명일방주) 창을 고르세요.")}</p>}
              </>
            ) : (
              <div className="cap-frozen-wrap">
                <canvas id="cap-frozen-disp" className="cap-frozen-canvas" />
                {detections?.map((d, i) => (
                  <div key={i} className={`cap-cell ${conf(d.sim)}`}
                    style={{ left: pctL(d.box.x0 / W), top: pctL(d.box.y0 / H), width: pctL((d.box.x1 - d.box.x0) / W), height: pctL((d.box.y1 - d.box.y0) / H) }}>
                    <span className="cap-cell-lbl">{`${d.name}·${pct(d.sim)}`}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {black && mode === "live" && <p className="capture-warn">{t("검은 화면만 잡힙니다 — 게임 화면 보호(DRM)로 캡처가 막혔을 수 있어요. 에뮬레이터 창을 고르거나 '화면 전체'를 선택해 보세요.")}</p>}

          <div className="cap-controls">
            {mode === "frozen" && <button type="button" onClick={() => { setMode("live"); setDetections(null); }}>{t("라이브로")}</button>}
            <button type="button" className="apply cap-run" onClick={() => { void recognize(); }} disabled={busy || (!stream && mode === "live")}>
              {busy ? t("인식 중…") : mode === "frozen" ? t("다시 인식") : t("인식")}
            </button>
          </div>

          <p className="capture-status">
            {ocrStatus
              ? t("OCR 엔진 준비 중… {s}", { s: ocrStatus })
              : busy
                ? t("화면 전체에서 오퍼 이름을 읽는 중…")
                : detections
                  ? t("{n}명 인식됨 (초록=정확, 노랑/빨강=애매)", { n: detections.length })
                  : (stream ? (dims ? t("연동됨 · {w}×{h} · '인식'을 누르세요", { w: dims.w, h: dims.h }) : t("연동됨 · 프레임 대기 중…")) : t("연동 대기 중"))}
          </p>

          {detections && detections.length > 0 && (
            <div className="cap-results">
              {detections.map((d) => (
                <span key={d.id} className={`cap-chip ${conf(d.sim)}`} title={`OCR "${d.text}" → ${d.name} (${pct(d.sim)}%)`}>
                  <img src={`/avatars/${d.id}.webp`} alt="" width={34} height={34} loading="lazy" />
                  <b>{d.name}</b>
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
