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
import { learnCard, matchLearned, learnedCount } from "./scanner-learn";
import { nameOf } from "./scanner-names";
import costsData from "./data/costs.json";
import { initNames, groupWords, matchName, type Detection } from "./scanner-names";
import { initEliteTemplates, classifyElite } from "./scanner-elite";

const conf = (s: number) => (s >= 0.75 ? "good" : s >= 0.5 ? "mid" : "low");
const pct = (s: number) => Math.round(s * 100);
// 인식 결과 = 이름 + (있으면) 정예화·레벨. 식별은 이름 OCR이 1차, 자가학습 아트 지문이 2차
// (신 UI 카드 일러가 공개 애셋에 없어 사전 이미지 인덱스 불가 판정 — 2026-07-22).
// 정예화는 배지 템플릿(E2→E1→미달시 E0), 레벨은 OCR 숫자 + costs.json maxLv 검증.
type DetectionEx = Detection & { elite?: 0 | 1 | 2; eliteConf?: number; level?: number; levelConf?: number; via?: "ocr" | "learned" };
type OpCost = { levels?: { maxLv: number }[] };
const OPS_COST = (costsData as unknown as { ops: Record<string, OpCost> }).ops;

// 스펙 출력 형식 — [{operatorId, name, elite, level, potential, confidence:{...}}]
// potential: 목록 화면에 잠재 표시가 없으므로 null (억지 추정 금지 — 스펙 §7)
function specJson(dets: DetectionEx[]) {
  return dets.map((d) => ({
    operatorId: d.id,
    name: d.name,
    elite: d.elite ?? null,
    level: d.level ?? null,
    potential: null,
    confidence: {
      operator: Math.round(d.sim * 100) / 100,
      elite: d.eliteConf ?? 0,
      level: d.levelConf ?? 0,
    },
    ...(d.via === "learned" ? { identifiedBy: "image" } : {}),
  }));
}

export default function EmulatorCapture({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frozenRef = useRef<HTMLCanvasElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [black, setBlack] = useState(false);
  const [mode, setMode] = useState<"live" | "frozen">("live");
  const [detections, setDetections] = useState<DetectionEx[] | null>(null);
  const [learnedInfo, setLearnedInfo] = useState<{ hits: number; total: number } | null>(null);
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
      let filtered = dets.filter((d) => !dets.some((o) => o.id !== d.id && norm(o.name).length > norm(d.name).length && norm(o.name).includes(norm(d.name))));
      // 이름 줄(행) 위치 필터 — 카드 이름은 같은 행(이름띠 높이)에 정렬된다. 확실한 앵커(3자 이상
      // 이름)로 행을 잡고, 행에서 벗어난 검출(배지 그림을 "시" 같은 1자 오퍼로 오독 등)을 버린다.
      // (사용자 리포트 2026-07-22: 엔텔레키아 정예화 마크가 '시'로 오인식)
      const anchors = filtered.filter((d) => norm(d.name).length >= 3 && d.sim >= 0.7);
      const nameH0 = anchors.length ? anchors.map((d) => d.box.y1 - d.box.y0).sort((a, b2) => a - b2)[anchors.length >> 1] : 12;
      const rowTops0: number[] = [];
      for (const d of anchors) {
        if (!rowTops0.some((r) => Math.abs(r - d.box.y0) < nameH0 * 2)) rowTops0.push(d.box.y0);
      }
      if (rowTops0.length) filtered = filtered.filter((d) => rowTops0.some((r) => Math.abs(d.box.y0 - r) < nameH0 * 2));

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
      // 카드 상부(아트+배지+레벨) 영역 — 이름 위 피치×1.15
      const stripOf = (cx: number, nameTop: number) => {
        const strip = { x: cx - pitch * 0.45, y: nameTop - pitch * 1.15, w: pitch * 0.9, h: pitch * 1.1 };
        strip.x = Math.max(0, strip.x); strip.y = Math.max(0, strip.y);
        strip.w = Math.min(strip.w, frame.width - strip.x); strip.h = Math.min(strip.h, nameTop - strip.y);
        return strip;
      };
      // 정예화·레벨 판독 + 자가학습 (카드 하나)
      const annotate = async (d: DetectionEx, cx: number, nameTop: number) => {
        const strip = stripOf(cx, nameTop);
        const er = classifyElite(frame, strip);
        d.elite = er.elite; d.eliteConf = Math.round(er.confidence * 100) / 100;
        // LV 숫자는 카드 왼쪽 하단의 검은 원 안 — 왼쪽 45% × 이름 위 0.55피치 영역만 본다
        // (중앙 대형 배지·점무늬가 숫자로 오독되던 문제, 실화면 보정 2026-07-22)
        const lvBox = { x: strip.x, y: Math.max(strip.y, nameTop - pitch * 0.55), w: strip.w * 0.45, h: 0 };
        lvBox.h = nameTop - lvBox.y;
        let lv: number | undefined; let lvConf = 0;
        for (const w2 of digitWords) {
          const wx = (w2.x0 + w2.x1) / 2, wy = (w2.y0 + w2.y1) / 2;
          if (wx >= lvBox.x && wx <= lvBox.x + lvBox.w && wy >= lvBox.y && wy <= lvBox.y + lvBox.h) {
            const n = parseInt(w2.text, 10);
            if (n >= 1 && n <= 90 && (lv === undefined || n > lv)) { lv = n; lvConf = 0.9; }
          }
        }
        if (lv === undefined) {
          const found2 = await ocrDigits(frame, lvBox.x, lvBox.y, lvBox.w, lvBox.h);
          if (found2 !== null) { lv = found2; lvConf = 0.7; }
        }
        // 범위 검증 (스펙 §6): 정예화 단계별 최대 레벨(costs.json) 초과 = 오인식 의심 → 신뢰도 강등
        if (lv !== undefined) {
          const cap = OPS_COST[d.id]?.levels?.[d.elite ?? 2]?.maxLv;
          if (cap !== undefined && lv > cap) lvConf = Math.min(lvConf, 0.3);
          d.level = lv; d.levelConf = lvConf;
        }
        // 자가학습: 이름 확신이 높으면 카드 아트 지문 저장 → 다음부터 이미지로도 식별
        if (d.via !== "learned" && d.sim >= 0.8 && strip.h > pitch * 0.8) learnCard(d.id, frame, strip);
      };
      for (const { d, cx } of centers) await annotate(d, cx, d.box.y0);

      // ── 격자 보완: 이름 OCR이 놓친 칸을 ①학습된 아트 지문 ②이름띠 조준 재판독으로 식별 ──
      // (1패스 sparse OCR이 그룹 자체를 못 만든 카드는 재판독 기회가 없었다 — 울피아누스·호시구마
      //  누락, 사용자 리포트 2026-07-22. 빈 칸의 이름띠 위치를 알고 있으니 고해상 단일행 OCR로 조준)
      let learnedHits = 0;
      if (centers.length >= 3) {
        // 행 = nameTop 군집, 열 = 최소 cx부터 피치 간격
        const rowTops: number[] = [];
        for (const { d } of centers) {
          const t = d.box.y0;
          if (!rowTops.some((r) => Math.abs(r - t) < nameH * 2)) rowTops.push(t);
        }
        const minCx = Math.min(...centers.map((c) => c.cx));
        let startCx = minCx;
        while (startCx - pitch > pitch * 0.5) startCx -= pitch; // 왼쪽으로 확장 (잘린 첫 칸 제외)
        for (const rowTop of rowTops) {
          for (let cx = startCx; cx < frame.width - pitch * 0.4; cx += pitch) {
            if (centers.some((c) => Math.abs(c.cx - cx) < pitch * 0.4 && Math.abs(c.d.box.y0 - rowTop) < nameH * 2)) continue;
            const strip = stripOf(cx, rowTop);
            if (strip.h < pitch * 0.9 || strip.w < pitch * 0.85) continue; // 잘린 칸 제외 (스펙 §7)
            let d: DetectionEx | null = null;
            // ① 학습된 아트 지문 (두 번째 스캔부터)
            const lm = matchLearned(frame, strip);
            if (lm) {
              d = { id: lm.operatorId, name: nameOf(lm.operatorId), sim: Math.round(lm.score * 100) / 100, text: "(image)",
                box: { x0: cx - pitch * 0.3, y0: rowTop, x1: cx + pitch * 0.3, y1: rowTop + nameH }, via: "learned" };
            } else {
              // ② 이름띠 조준 재판독 — 카드 폭 70% × 이름띠 높이. 블라인드 재판독이라 수용 기준을 높인다
              //    (1~2자 이름은 정확 일치=1.0만 통과 → 위·슈·혼도 여기서 잡힐 기회)
              const text2 = await ocrName(frame, cx - pitch * 0.35, rowTop - nameH * 0.3, pitch * 0.7, nameH * 1.7);
              const m2 = text2 ? matchName(text2) : null;
              if (m2 && (norm(m2.name).length >= 3 ? m2.sim >= 0.78 : m2.sim >= 0.99)) {
                d = { ...m2, box: { x0: cx - pitch * 0.3, y0: rowTop, x1: cx + pitch * 0.3, y1: rowTop + nameH } };
              }
            }
            if (!d) continue;
            await annotate(d, cx, rowTop);
            filtered.push(d);
            if (d.via === "learned") learnedHits += 1;
          }
        }
      }
      const finalDets = filtered.sort((a, b) => b.sim - a.sim);
      setDetections(finalDets);
      setLearnedInfo({ hits: learnedHits, total: learnedCount() });
      // 평가 하네스·외부 연동용 스펙 JSON (스펙 §최종 목표)
      (window as unknown as { __scanResult?: unknown }).__scanResult = specJson(finalDets);
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
                    {/* 숫자(신뢰도%)는 혼란만 줘서 오버레이에선 제거 — 색(초록/노랑/빨강)이 신뢰도 (사용자 피드백 2026-07-22) */}
                    <span className="cap-cell-lbl">{d.name}</span>
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
            {detections && detections.length > 0 && (
              <button type="button" onClick={() => {
                const blob = new Blob([JSON.stringify(specJson(detections), null, 1)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = "terra-archive-scan.json"; a.click();
                URL.revokeObjectURL(url);
              }}>{t("결과 JSON 저장")}</button>
            )}
          </div>

          <p className="capture-status">
            {ocrStatus
              ? t("OCR 엔진 준비 중… {s}", { s: ocrStatus })
              : busy
                ? t("화면 전체에서 오퍼 이름을 읽는 중…")
                : detections
                  ? <>{t("{n}명 인식됨 (초록=정확, 노랑/빨강=애매)", { n: detections.length })}
                      {learnedInfo && learnedInfo.hits > 0 && <> · {t("이미지로 식별 {n}건", { n: learnedInfo.hits })}</>}
                      {learnedInfo && learnedInfo.total > 0 && <> · {t("학습 {n}명", { n: learnedInfo.total })}</>}</>
                  : (stream ? (dims ? t("연동됨 · {w}×{h} · '인식'을 누르세요", { w: dims.w, h: dims.h }) : t("연동됨 · 프레임 대기 중…")) : t("연동 대기 중"))}
          </p>

          {detections && detections.length > 0 && (
            <div className="cap-results">
              {detections.map((d) => (
                <span key={d.id} className={`cap-chip ${conf(d.sim)}`} title={`${d.via === "learned" ? "이미지 지문" : `OCR "${d.text}"`} → ${d.name} (${pct(d.sim)}%)`}>
                  <img src={`/avatars/${d.id}.webp`} alt="" width={34} height={34} loading="lazy" />
                  <b>{d.name}</b>
                  {d.via === "learned" && <i className="cap-via" aria-hidden>📷</i>}
                  {d.elite !== undefined && <i className="cap-elite">E{d.elite}</i>}
                  {d.level !== undefined && <i className={`cap-lv${(d.levelConf ?? 1) <= 0.3 ? " low" : ""}`}>Lv{d.level}</i>}
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
