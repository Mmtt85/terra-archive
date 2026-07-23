"use client";
// 스크린샷 렌즈 모달 — 게임 스크린샷을 인식해 사이트의 해당 정보로 바로 이동한다.
// 입력: 클립보드 자동 감지(시작 버튼 게이트) · ⌘V 붙여넣기 · 파일 드롭/선택 (스캐너 v6 UX 재사용).
// 파이프라인: ocr.ts(OCR) → match.ts(매칭·타깃 해석) → onGoto(홈 셸이 /rogue로 내비게이션).
// Phase 1 범위: 통합전략(로그라이크) 화면 — 분대·유물·스테이지·조우·엔딩 등. (KR 클라 전용)

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { ocrImage, disposeOcr } from "./ocr";
import { buildIndex, analyzeLines, type LensIndex, type LensOutcome, type LensGoto } from "./match";

// 토픽 데이터 지연 로드 — 렌즈에서 실제 인식할 때만 rogue*.json을 내려받는다
let indexP: Promise<LensIndex> | null = null;
function getIndex(): Promise<LensIndex> {
  if (!indexP) {
    indexP = Promise.all([
      import("../data/rogue1.json"),
      import("../data/rogue2.json"),
      import("../data/rogue3.json"),
      import("../data/rogue4.json"),
      import("../data/rogue5.json"),
      import("../data/rogue6.json"),
    ]).then((mods) => buildIndex(mods.map((m) => m.default)));
    indexP.catch(() => { indexP = null; });
  }
  return indexP;
}

const SECTION_LABEL: Record<string, string> = {
  band: "분대", relic: "소장품", stage: "작전", zone: "층", enc: "조우",
  tool: "도구", capsule: "레퍼토리 (음반)", ending: "엔딩",
};

export default function LensModal({ onClose, onGoto }: {
  onClose: () => void;
  onGoto: (g: LensGoto) => void;
}) {
  const { t } = useI18n();
  const [clipStarted, setClipStarted] = useState(false);
  const [clip, setClip] = useState<"idle" | "on" | "off">("idle");
  const [status, setStatus] = useState<string | null>(null); // 진행 상태 문구
  const [outcome, setOutcome] = useState<LensOutcome | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const busy = useRef(false);
  const lastClipHash = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { void disposeOcr(); }, []); // 닫을 때 워커 정리

  const recognizeFiles = useCallback(async (files: Iterable<File>) => {
    if (busy.current) return;
    const file = Array.from(files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    busy.current = true;
    setOutcome(null);
    try {
      setPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
      setStatus(t("인식 엔진 로딩 중…"));
      const [index] = await Promise.all([getIndex()]);
      setStatus(t("화면 분석 중… (수 초 걸립니다)"));
      const lines = await ocrImage(file);
      const oc = analyzeLines(lines, index);
      // 필드 진단용 — 오인식 리포트를 받으면 콘솔에서 OCR 라인·판정을 바로 확인한다
      console.debug(`[lens] OCR ${lines.length}줄 → ${oc.target.kind}/${oc.section ?? "-"} · 엔티티 ${oc.entities.length}`, { lines, outcome: oc });
      setStatus(null);
      setOutcome(oc);
      // 단일 확신 타깃이면 바로 이동 (사용자 요청: 인식되면 자동으로 해당 화면으로)
      if (oc.target.kind === "goto") onGoto(oc.target.goto);
    } catch (err) {
      console.error("[lens]", err);
      setStatus(t("인식에 실패했습니다 — 다른 스크린샷으로 다시 시도해 주세요."));
    } finally {
      busy.current = false;
    }
  }, [t, onGoto]);

  // ── ⌘V 붙여넣기 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length) { e.preventDefault(); void recognizeFiles(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [recognizeFiles]);

  // ── 클립보드 자동 감지 (스캐너 v6과 동일 패턴 — 시작 버튼 게이트) ────────────
  useEffect(() => {
    if (!clipStarted) return;
    let iv: number | undefined;
    let disposed = false;

    const tick = async () => {
      if (disposed || busy.current || !document.hasFocus()) return;
      try {
        const items = await navigator.clipboard.read();
        if (disposed) return;
        setClip("on");
        for (const it of items) {
          const type = it.types.find((tp) => tp.startsWith("image/"));
          if (!type) continue;
          const blob = await it.getType(type);
          const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
          let h = `${blob.size}:${type}:`;
          for (let i = 0; i < head.length; i += 997) h += head[i].toString(36);
          if (h === lastClipHash.current) continue;
          lastClipHash.current = h;
          await recognizeFiles([new File([blob], t("클립보드 스크린샷"), { type })]);
        }
      } catch {
        if (!disposed) setClip((c) => (c === "on" ? "on" : "off"));
      }
    };
    const startPolling = () => { if (iv === undefined) iv = window.setInterval(() => { void tick(); }, 1000); };

    (async () => {
      try {
        const st = await navigator.permissions.query({ name: "clipboard-read" as PermissionName });
        const apply = () => {
          if (disposed) return;
          if (st.state === "granted") { setClip("on"); startPolling(); }
          else if (st.state === "prompt") { void tick(); }
          else setClip("off");
        };
        st.addEventListener("change", apply);
        apply();
      } catch {
        await tick();
        if (!disposed) startPolling();
      }
    })();

    return () => { disposed = true; if (iv !== undefined) clearInterval(iv); };
  }, [clipStarted, recognizeFiles, t]);

  const onDropFiles = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) void recognizeFiles(e.dataTransfer.files);
  }, [recognizeFiles]);

  return (
    <section className="operator-modal lens-modal" role="dialog" aria-modal="true" aria-label={t("스크린샷 렌즈")}
      onDragOver={(e) => e.preventDefault()} onDrop={onDropFiles}>
      <header className="scanner-head">
        <h2>{t("스크린샷 렌즈")}</h2>
        <button className="modal-close" onClick={onClose} aria-label={t("닫기")}>✕</button>
      </header>
      <input ref={fileInputRef} type="file" accept="image/*" hidden
        onChange={(e) => { if (e.target.files?.length) void recognizeFiles(e.target.files); e.target.value = ""; }} />

      <div className="lens-body">
        {!clipStarted ? (
          <div className="scanner-clip-cta">
            <button className="scanner-clip-start" onClick={() => setClipStarted(true)}>
              <span className="clip-start-icon" aria-hidden>📷</span>
              <span>{t("클립보드 자동인식 시작")}</span>
            </button>
            <p>{t("통합전략(로그라이크) 화면을 클립보드로 캡처(맥 ⌃⌘⇧4 · 윈도우 Win+Shift+S)하고 이 탭으로 돌아오면, 분대·유물·작전·조우를 인식해 가이드의 해당 정보로 바로 이동합니다. 파일 드롭이나 ⌘V 붙여넣기도 됩니다.")}</p>
          </div>
        ) : (
          <div className={`scanner-clip-banner ${clip}`}>
            {clip === "on" ? <span className="scanner-clip-on">● {t("클립보드 자동 인식 켜짐 — 이제 캡처만 반복하세요")}</span>
              : clip === "off" ? <span className="scanner-clip-off">{t("클립보드 접근이 막혀 있습니다 — ⌘V 붙여넣기나 파일 드롭을 이용하세요")}</span>
                : <span>{t("클립보드 확인 중…")}</span>}
          </div>
        )}

        <div className="lens-stage">
          {preview && <img className="lens-preview" src={preview} alt={t("인식한 스크린샷")} />}
          {status && <p className="lens-status">{status}</p>}

          {outcome && !status && (
            <div className="lens-result">
              {outcome.target.kind === "goto" && (
                <p className="lens-verdict">
                  {t("인식 완료 — 해당 정보로 이동했습니다.")}
                  {outcome.entities[0] && <strong> {outcome.entities[0].name}</strong>}
                </p>
              )}
              {outcome.target.kind === "tie" && (
                <>
                  <p className="lens-verdict">
                    {t("「{a}」 정보를 인식했지만, 어느 테마인지 화면만으론 알 수 없습니다 — 테마를 선택하세요.", { a: t(SECTION_LABEL[outcome.target.section] ?? outcome.target.section) })}
                  </p>
                  <div className="lens-topic-chips">
                    {outcome.target.options.map((o) => (
                      <button key={o.topic} type="button" className="lens-chip" onClick={() => onGoto(o.goto)}>
                        {t(o.topicName)}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {outcome.target.kind === "none" && (
                <p className="lens-verdict none">{t("인식된 정보가 없습니다 — 현재는 통합전략(로그라이크) 화면만 지원합니다. 분대·유물·조우·작전 화면을 캡처해 보세요.")}</p>
              )}
              {outcome.entities.length > 1 && (
                <div className="lens-entities">
                  {outcome.entities.slice(0, 8).map((e) => (
                    <span key={`${e.topic}/${e.section}/${e.id}`} className="lens-entity">
                      <em>{t(SECTION_LABEL[e.section] ?? e.section)}</em> {e.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {!preview && !status && (
            <p className="lens-empty">
              {t("아직 인식한 스크린샷이 없습니다.")}{" "}
              <button type="button" className="lens-pick" onClick={() => fileInputRef.current?.click()}>{t("파일 선택")}</button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
