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
import { initOcr, ocrWords, ocrName, ocrDigits, terminateOcr, type OcrProgress } from "./scanner-ocr";
import { initNames, groupWords, matchName, type Detection } from "./scanner-names";
import { initEliteTemplates, classifyElite } from "./scanner-elite";

const conf = (s: number) => (s >= 0.75 ? "good" : s >= 0.5 ? "mid" : "low");
const pct = (s: number) => Math.round(s * 100);
// 인식 결과 = 이름 + (있으면) 정예화·레벨. 정예화는 배지 템플릿, 레벨은 1패스 OCR 숫자에서.
type DetectionEx = Detection & { elite?: 0 | 1 | 2; level?: number };

export default function EmulatorCapture({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frozenRef = useRef<HTMLCanvasElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [black, setBlack] = useState(false);
  const [mode, setMode] = useState<"live" | "frozen">("live");
  const [detections, setDetections] = useState<DetectionEx[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [ocrStatus, setOcrStatus] = useState("");

  // 열리면 OCR 엔진·이름 사전 미리 로드
  useEffect(() => {
    void initNames();
    void initEliteTemplates();
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
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    frozenRef.current = canvas;
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
      await Promise.all([initOcr(), initNames(), initEliteTemplates()]);
      // 1패스: 전체프레임 sparse OCR → 이름 위치(그룹) 찾기
      const words = await ocrWords(frame, frame.width, frame.height);
      const groups = groupWords(words);
      // 2패스: 확실치 않은 그룹만 그 영역을 고해상도·반전 재판독(PSM 단일행) — 짧은 이름 정확도↑
      const best = new Map<string, Detection>();
      for (const g of groups) {
        let m = matchName(g.text);
        if (!m || m.sim < 0.85) {
          const gw = g.box.x1 - g.box.x0, gh = g.box.y1 - g.box.y0;
          const padX = Math.max(6, gw * 0.12), padY = Math.max(4, gh * 0.35);
          const text2 = await ocrName(frame, g.box.x0 - padX, g.box.y0 - padY, gw + padX * 2, gh + padY * 2);
          const m2 = text2 ? matchName(text2) : null;
          if (m2 && (!m || m2.sim > m.sim)) m = m2;
        }
        if (m && m.sim >= 0.62) { const cur = best.get(m.id); if (!cur || m.sim > cur.sim) best.set(m.id, { ...m, box: g.box }); }
      }
      // 부분문자열 억제 — "텍사스"가 "텍사스 디 오메르토사"의 일부로 잘못 잡히면(멀티워드 분리·OCR 조각)
      // 더 구체적인(긴) 이름만 남긴다. 실버애쉬 vs 실버애쉬 더 레인프로스트 등도 방어.
      const dets: DetectionEx[] = [...best.values()];
      const norm = (s: string) => s.replace(/\s/g, "");
      const filtered = dets.filter((d) => !dets.some((o) => o.id !== d.id && norm(o.name).length > norm(d.name).length && norm(o.name).includes(norm(d.name))));

      // ── 카드 기하 역산 → 정예화 배지 분류 + 레벨 추출 ─────────────────────────
      // 이름 박스는 카드 하단·가운데 → 이웃 이름 중심 간격(피치)으로 카드 폭을 추정하고,
      // 이름 위쪽 피치×1.15 영역(배지·레벨 원이 있는 카드 상부)을 탐색한다.
      const centers = filtered.map((d) => ({ d, cx: (d.box.x0 + d.box.x1) / 2, cy: (d.box.y0 + d.box.y1) / 2 }));
      const diffs: number[] = [];
      for (const a of centers) {
        let nearest = Infinity;
        for (const b2 of centers) {
          if (a === b2 || Math.abs(a.cy - b2.cy) > (a.d.box.y1 - a.d.box.y0) * 2) continue; // 같은 행만
          const dx = Math.abs(a.cx - b2.cx);
          if (dx > 4 && dx < nearest) nearest = dx;
        }
        if (Number.isFinite(nearest)) diffs.push(nearest);
      }
      diffs.sort((x, y) => x - y);
      const nameH = centers.length ? centers.map((c) => c.d.box.y1 - c.d.box.y0).sort((x, y) => x - y)[centers.length >> 1] : 12;
      const pitch = diffs.length ? diffs[diffs.length >> 1] : nameH * 7; // 이웃 없으면 대략치
      const digitWords = words.filter((w2) => /^\d{1,2}$/.test(w2.text.trim()) && (w2.conf ?? 0) >= 40);
      for (const { d, cx } of centers) {
        const strip = { x: cx - pitch * 0.45, y: d.box.y0 - pitch * 1.15, w: pitch * 0.9, h: pitch * 1.1 };
        strip.x = Math.max(0, strip.x); strip.y = Math.max(0, strip.y);
        strip.w = Math.min(strip.w, frame.width - strip.x); strip.h = Math.min(strip.h, d.box.y0 - strip.y);
        const er = classifyElite(frame, strip);
        if (er) d.elite = er.elite;
        // 레벨 = 탐색 영역 안의 1~2자리 숫자(레벨 원의 "90" 등). 여러 개면 가장 큰 것(레벨이 제일 큼).
        let lv: number | undefined;
        for (const w2 of digitWords) {
          const wx = (w2.x0 + w2.x1) / 2, wy = (w2.y0 + w2.y1) / 2;
          if (wx >= strip.x && wx <= strip.x + strip.w && wy >= strip.y && wy <= strip.y + strip.h) {
            const n = parseInt(w2.text, 10);
            if (n >= 1 && n <= 90 && (lv === undefined || n > lv)) lv = n;
          }
        }
        // 1패스가 못 읽었으면 레벨 원 부근(스트립 하부)을 숫자 전용 OCR로 재판독
        if (lv === undefined) {
          const found2 = await ocrDigits(frame, strip.x, strip.y + strip.h * 0.5, strip.w, strip.h * 0.5 + nameH * 0.4);
          if (found2 !== null) lv = found2;
        }
        if (lv !== undefined) d.level = lv;
      }
      setDetections(filtered.sort((a, b) => b.sim - a.sim));
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
                  {d.elite !== undefined && <i className="cap-elite">E{d.elite}</i>}
                  {d.level !== undefined && <i className="cap-lv">Lv{d.level}</i>}
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
