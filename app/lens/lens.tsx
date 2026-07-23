"use client";
// 스샷 레이더 모달 — 게임 스크린샷을 인식해 "현재 페이지 안의" 해당 콘텐츠로 이동/입력한다.
// 페이지별 설치 (사용자 확정 2026-07-23: 전역 워프가 아니라 페이지 내 도구):
//   mode "rogue"   → /rogue 탭 줄의 버튼. 분대·유물·작전·조우 인식 → 가이드 해당 위치로.
//                    현재 토픽을 사전확률로 부스트 (사미 페이지에서 분대 스샷 = 사미로 확정).
//   mode "recruit" → 공채 도우미의 버튼. 태그 인식 → 태그 자동 선택.
// 입력: 클립보드 자동 감지(시작 버튼 게이트) · ⌘V 붙여넣기 · 파일 드롭/선택.
// 페이지 레벨 자동인식 토글(모달 밖)은 rogue.tsx·recruit.tsx가 clipwatch+run을 직접 쓴다.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { warmOcr, disposeOcr } from "./ocr";
import { recognizeShot, warmData, type LensMode } from "./run";
import { useClipboardWatch } from "./clipwatch";
import type { LensOutcome, LensGoto } from "./match";

const SECTION_LABEL: Record<string, string> = {
  band: "분대", relic: "소장품", stage: "작전", zone: "층", enc: "조우",
  tool: "도구", capsule: "레퍼토리 (음반)", ending: "엔딩", recruit: "공개모집 태그",
};

export default function LensModal({ mode, topic, onClose, onGoto }: {
  mode: LensMode;
  topic?: string; // mode "rogue": 현재 토픽 id (사전확률 부스트)
  onClose: () => void;
  onGoto: (g: LensGoto) => void;
}) {
  const { t } = useI18n();
  const [clipStarted, setClipStarted] = useState(false);
  const [status, setStatus] = useState<string | null>(null); // 진행 상태 문구
  const [outcome, setOutcome] = useState<LensOutcome | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const busy = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const title = mode === "recruit" ? t("스샷으로 태그 입력") : t("스샷 레이더");

  // 모달 열자마자 OCR 워커·매칭 데이터를 예열 — 첫 드롭의 체감 속도 개선. 닫을 때 워커 정리.
  useEffect(() => {
    void warmOcr();
    warmData(mode);
    return () => { void disposeOcr(); };
  }, [mode]);

  const recognizeFiles = useCallback(async (files: Iterable<File>) => {
    if (busy.current) return;
    const file = Array.from(files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    busy.current = true;
    setOutcome(null);
    try {
      setPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
      setStatus(t("워프 중…"));
      const oc = await recognizeShot(mode, file, topic);
      setStatus(null);
      setOutcome(oc);
      // 단일 확신 타깃이면 바로 적용 (사용자 요청: 인식되면 자동으로)
      if (oc.target.kind === "goto") onGoto(oc.target.goto);
    } catch (err) {
      console.error("[lens]", err);
      setStatus(t("인식에 실패했습니다 — 다른 스크린샷으로 다시 시도해 주세요."));
    } finally {
      busy.current = false;
    }
  }, [t, onGoto, mode, topic]);

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

  // ── 클립보드 자동 감지 (시작 버튼 게이트) ───────────────────────────────────
  const clip = useClipboardWatch(clipStarted, (file) => recognizeFiles([file]));

  const onDropFiles = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) void recognizeFiles(e.dataTransfer.files);
  }, [recognizeFiles]);

  return (
    <section className="operator-modal lens-modal" role="dialog" aria-modal="true" aria-label={title}
      onDragOver={(e) => e.preventDefault()} onDrop={onDropFiles}>
      <header className="scanner-head">
        <h2>📷 {title}</h2>
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
            <p>{mode === "recruit"
              ? t("공개모집 화면을 클립보드로 캡처(맥 ⌃⌘⇧4 · 윈도우 Win+Shift+S)하고 이 탭으로 돌아오면, 인식된 태그가 자동으로 선택됩니다. 파일 드롭이나 ⌘V 붙여넣기도 됩니다.")
              : t("통합전략 화면(분대 선택·전리품·작전 노드·조우 등)을 클립보드로 캡처(맥 ⌃⌘⇧4 · 윈도우 Win+Shift+S)하고 이 탭으로 돌아오면, 가이드의 해당 정보로 바로 이동합니다. 파일 드롭이나 ⌘V 붙여넣기도 됩니다.")}</p>
          </div>
        ) : (
          <div className={`scanner-clip-banner ${clip}`}>
            {clip === "on" ? <span className="scanner-clip-on">● {t("클립보드 자동 인식 켜짐 — 이제 캡처만 반복하세요")}</span>
              : clip === "off" ? <span className="scanner-clip-off">{t("클립보드 접근이 막혀 있습니다 — ⌘V 붙여넣기나 파일 드롭을 이용하세요")}</span>
                : <span>{t("클립보드 확인 중…")}</span>}
          </div>
        )}

        <div className="lens-stage">
          {(preview || status) && (
            <div className="lens-stage-row">
              {preview && <img className="lens-preview" src={preview} alt={t("인식한 스크린샷")} />}
              {status && <p className="lens-status"><span className="lens-warp-icon" aria-hidden>⟫</span>{status}</p>}
            </div>
          )}

          {outcome && !status && (
            <div className="lens-result">
              {outcome.target.kind === "goto" && (
                <p className="lens-verdict">
                  {mode === "recruit" ? t("태그를 인식해 선택했습니다.") : t("인식 완료 — 해당 정보로 이동했습니다.")}
                  {outcome.entities[0] && <strong> {outcome.entities.filter((e) => !outcome.section || e.section === outcome.section).map((e) => e.name).slice(0, 5).join(" · ")}</strong>}
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
                <p className="lens-verdict none">{mode === "recruit"
                  ? t("인식된 태그가 없습니다 — 모집 요건 태그가 보이게 캡처해 보세요.")
                  : t("인식된 정보가 없습니다 — 분대·유물·조우·작전 화면을 캡처해 보세요.")}</p>
              )}
              {outcome.entities.length > 1 && outcome.target.kind !== "goto" && (
                <div className="lens-entities">
                  {outcome.entities.slice(0, 8).map((e) => (
                    <span key={`${e.topic}/${e.section}/${e.id}`} className="lens-entity">
                      <em>{e.section === "mech" ? (e.arc ?? t("시스템")) : t(SECTION_LABEL[e.section] ?? e.section)}</em> {e.name}
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
