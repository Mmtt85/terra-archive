"use client";

// 에뮬레이터 화면 연동 + 오퍼 인식 스캐너.
// ① getDisplayMedia로 에뮬레이터(또는 명일방주) 창을 캡처 → 미리보기
// ② 현재 프레임을 정지시키고, 오퍼 카드 격자에 인식 영역(ROI)을 드래그로 맞춤
// ③ 격자를 열×행으로 나눠 각 카드 초상화를 dHash 매칭 → 보유 오퍼 식별
// 100% 클라이언트: 캡처·인식 전부 이 브라우저 안에서만, 어디에도 전송 안 함.
// 지금은 "한 화면(정지 프레임) 인식 증명" 단계. 스크롤 자동 누적 스캔은 다음 단계.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { startDisplayCapture, sampleBrightness } from "./screen-capture";
import { initTemplates, recognizeRegion, type Match } from "./scanner-core";

type Rect = { x: number; y: number; w: number; h: number }; // 0~1 정규화 (프레임 기준)
type CellMatch = { r: number; c: number; cell: Rect; match: Match | null };

// 초상화 크롭 기본값 — 카드 안에서 캐릭터 얼굴·상반신이 차지하는 대략 비율. 게임 화면에 맞춰 보정.
const DEFAULT_CROP = { top: 0.06, bottom: 0.6, inset: 0.06 };
const DEFAULT_ROI: Rect = { x: 0.1, y: 0.16, w: 0.8, h: 0.66 };
// ZNCC 코사인 유사도(0~1)로 확신도 색. 실제 게임 카드로 임계값은 다음 단계에서 재보정한다.
const conf = (s: number) => (s >= 0.72 ? "good" : s >= 0.55 ? "mid" : "low");
const pct = (s: number) => Math.round(s * 100);

export default function EmulatorCapture({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frozenRef = useRef<HTMLCanvasElement | null>(null); // 정지 프레임(원본 해상도)
  const stageRef = useRef<HTMLDivElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [black, setBlack] = useState(false);
  const [mode, setMode] = useState<"live" | "frozen">("live");
  const [roi, setRoi] = useState<Rect>(DEFAULT_ROI);
  const [cols, setCols] = useState(8);
  const [rows, setRows] = useState(2);
  const [crop, setCrop] = useState(DEFAULT_CROP);
  const [matches, setMatches] = useState<CellMatch[] | null>(null);
  const [busy, setBusy] = useState(false); // 템플릿 로드/인식 중
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // 스캐너 열리면 템플릿 미리 로드(지연 로드지만 인식 클릭 전에 준비되게)
  useEffect(() => { void initTemplates(); }, []);

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
    } catch { /* 취소/오류는 조용히 (버튼으로 다시 시도) */ }
  };
  // 열리면 곧바로 화면 선택창 (start는 async라 defer해 effect 내 동기 setState 경고 회피)
  useEffect(() => { const id = window.setTimeout(() => void start(), 0); return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { stream?.getTracks().forEach((tk) => tk.stop()); }, [stream]);

  // 라이브 스트림을 비디오에 연결 + 해상도·검은화면 감지
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !stream || mode !== "live") return;
    v.srcObject = stream;
    void v.play().catch(() => {});
    const tick = () => { if (v.videoWidth) setDims({ w: v.videoWidth, h: v.videoHeight }); setBlack(sampleBrightness(v) < 0.03); };
    const id = window.setInterval(tick, 1000);
    const first = window.setTimeout(tick, 0); // 첫 측정은 다음 태스크로 (effect 내 동기 setState 회피)
    return () => { window.clearInterval(id); window.clearTimeout(first); };
  }, [stream, mode]);

  // ── 프레임 정지 (라이브 → 인식 대상 캡처) ────────────────────────────────────
  const freeze = () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const canvas = frozenRef.current ?? document.createElement("canvas");
    frozenRef.current = canvas;
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    setDims({ w: v.videoWidth, h: v.videoHeight });
    setMode("frozen");
    setMatches(null);
  };
  // 이미지 파일로 테스트 (저장한 스크린샷 등) — 라이브 없이도 인식 검증
  const loadImage = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = frozenRef.current ?? document.createElement("canvas");
      frozenRef.current = canvas;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
      setMode("frozen");
      setMatches(null);
      URL.revokeObjectURL(url);
      // 정지 프레임을 화면에 그려 넣는다 (frozen 모드 렌더 후)
      requestAnimationFrame(paintFrozen);
    };
    img.src = url;
  };
  // 정지 프레임을 표시용 캔버스에 그린다 (mode frozen 진입 시)
  const paintFrozen = () => {
    const src = frozenRef.current;
    const disp = document.getElementById("cap-frozen-disp") as HTMLCanvasElement | null;
    if (!src || !disp) return;
    disp.width = src.width;
    disp.height = src.height;
    disp.getContext("2d")!.drawImage(src, 0, 0);
  };
  useEffect(() => { if (mode === "frozen") requestAnimationFrame(paintFrozen); }, [mode]);

  // ── ROI 드래그 (정규화 좌표) ────────────────────────────────────────────────
  const toNorm = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) };
  };
  const onDown = (e: React.PointerEvent) => {
    if (mode !== "frozen") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toNorm(e);
    dragRef.current = p;
    setRoi({ x: p.x, y: p.y, w: 0, h: 0 });
    setMatches(null);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const p = toNorm(e);
    const s = dragRef.current;
    setRoi({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setRoi((r) => (r.w < 0.02 || r.h < 0.02 ? DEFAULT_ROI : r)); // 너무 작으면 기본값 복귀
  };

  // ── 인식 (ZNCC 템플릿 + 로컬 서치) ──────────────────────────────────────────
  const recognize = async () => {
    const frame = frozenRef.current;
    if (!frame || busy) return;
    setBusy(true);
    try {
      await initTemplates();
      const W = frame.width, H = frame.height;
      const out: CellMatch[] = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          // 셀 안에서 crop(상단/하단/좌우 여백)으로 초상화 박스를 잡고, 코어가 로컬 서치로 미세정렬
          const cell: Rect = { x: roi.x + (c * roi.w) / cols, y: roi.y + (r * roi.h) / rows, w: roi.w / cols, h: roi.h / rows };
          const box = {
            x: (cell.x + cell.w * crop.inset) * W,
            y: (cell.y + cell.h * crop.top) * H,
            w: cell.w * (1 - crop.inset * 2) * W,
            h: cell.h * (crop.bottom - crop.top) * H,
          };
          out.push({ r, c, cell, match: recognizeRegion(frame, box) });
        }
      }
      setMatches(out);
    } finally {
      setBusy(false);
    }
  };

  // 중복 제거한 인식 결과 (id별 최고 score) — 결과 목록·카운터
  const found = matches
    ? Array.from(matches.reduce((m, cm) => {
        if (cm.match) { const cur = m.get(cm.match.id); if (!cur || cm.match.score > cur.score) m.set(cm.match.id, cm.match); }
        return m;
      }, new Map<string, Match>()).values()).sort((a, b) => b.score - a.score)
    : [];

  const cropPct = (v: number) => `${(v * 100).toFixed(0)}%`;

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
              <div className="cap-frozen-wrap"
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
                <canvas id="cap-frozen-disp" className="cap-frozen-canvas" />
                {/* ROI 박스 */}
                <div className="cap-roi" style={{ left: cropPct(roi.x), top: cropPct(roi.y), width: cropPct(roi.w), height: cropPct(roi.h) }} />
                {/* 인식 결과 셀 오버레이 */}
                {matches?.map((cm, i) => (
                  <div key={i} className={`cap-cell ${cm.match ? conf(cm.match.score) : "none"}`}
                    style={{ left: cropPct(cm.cell.x), top: cropPct(cm.cell.y), width: cropPct(cm.cell.w), height: cropPct(cm.cell.h) }}>
                    <span className="cap-cell-lbl">{cm.match ? `${cm.match.name}·${pct(cm.match.score)}` : "?"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {black && mode === "live" && <p className="capture-warn">{t("검은 화면만 잡힙니다 — 게임 화면 보호(DRM)로 캡처가 막혔을 수 있어요. 에뮬레이터 창을 고르거나 '화면 전체'를 선택해 보세요.")}</p>}

          {/* 조작줄 */}
          <div className="cap-controls">
            {mode === "live" ? (
              <button type="button" className="apply" onClick={freeze} disabled={!stream}>{t("현재 화면 정지")}</button>
            ) : (
              <>
                <button type="button" onClick={() => { setMode("live"); setMatches(null); }}>{t("라이브로")}</button>
                <label className="cap-num">{t("열")}<input type="number" min={1} max={12} value={cols} onChange={(e) => setCols(Math.max(1, Math.min(12, +e.target.value || 1)))} /></label>
                <label className="cap-num">{t("행")}<input type="number" min={1} max={6} value={rows} onChange={(e) => setRows(Math.max(1, Math.min(6, +e.target.value || 1)))} /></label>
                <label className="cap-range">{t("초상화 상단")}<input type="range" min={0} max={0.5} step={0.01} value={crop.top} onChange={(e) => setCrop((c) => ({ ...c, top: +e.target.value }))} /></label>
                <label className="cap-range">{t("초상화 하단")}<input type="range" min={0.3} max={0.95} step={0.01} value={crop.bottom} onChange={(e) => setCrop((c) => ({ ...c, bottom: +e.target.value }))} /></label>
                <button type="button" className="apply cap-run" onClick={() => { void recognize(); }} disabled={busy}>{busy ? t("인식 중…") : t("인식")}</button>
              </>
            )}
          </div>

          <p className="capture-status">
            {mode === "frozen"
              ? (matches ? t("{n}명 인식됨 (초록=정확, 노랑/빨강=애매)", { n: found.length }) : t("인식 영역을 오퍼 카드 격자에 맞추고 '인식'을 누르세요. 드래그로 영역을 다시 그릴 수 있어요."))
              : (stream ? (dims ? t("연동됨 · {w}×{h}", { w: dims.w, h: dims.h }) : t("연동됨 · 프레임 대기 중…")) : t("연동 대기 중"))}
          </p>

          {/* 인식 결과 목록 (참조 아바타와 나란히 — 눈으로 검증) */}
          {found.length > 0 && (
            <div className="cap-results">
              {found.map((m) => (
                <span key={m.id} className={`cap-chip ${conf(m.score)}`} title={`${m.id} · score ${pct(m.score)} · margin ${m.margin.toFixed(3)}`}>
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
