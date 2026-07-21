"use client";

import { useState } from "react";
import { feedbackReady, sendFeedback, type FeedbackKind } from "./feedback";
import { useI18n } from "./i18n";

// open/setOpen은 부모(home)가 쥔다 — 모바일에선 헤더의 '제안' 버튼(공식 방송 옆)이,
// 데스크탑에선 우하단 FAB이 같은 패널을 연다 (사용자 요청 2026-07-22, PC 동작은 종전과 동일).
export default function FeedbackWidget({ open, setOpen }: { open: boolean; setOpen: (value: boolean) => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<FeedbackKind>("feature");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  const submit = async () => {
    if (!message.trim() || status === "sending") return;
    setStatus("sending");
    try {
      await sendFeedback(kind, message.trim(), { page: window.location.hash || "#archive" });
      setStatus("done");
      setMessage("");
      setTimeout(() => setStatus("idle"), 2600);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2600);
    }
  };

  if (!feedbackReady) return null;

  return (
    <div className="feedback-widget">
      {open && (
        <div className="feedback-panel">
          <header>
            <b>{t("제안 보내기")}</b>
            <button type="button" aria-label={t("닫기")} onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="feedback-kind">
            <button type="button" className={kind === "feature" ? "selected" : ""} onClick={() => setKind("feature")}>{t("기능 제안")}</button>
            <button type="button" className={kind === "data_error" ? "selected" : ""} onClick={() => setKind("data_error")}>{t("데이터 오류 리포트")}</button>
          </div>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={4000}
            placeholder={kind === "feature" ? t("이런 기능이 있으면 좋겠어요…") : t("어떤 오퍼의 어떤 데이터가 잘못됐는지 알려주세요")} />
          <footer>
            <small>{status === "done" ? t("보냈습니다, 감사합니다!") : status === "error" ? t("전송 실패 — 잠시 후 다시 시도해주세요") : t("익명으로 전송됩니다")}</small>
            <button type="button" className="feedback-send" disabled={!message.trim() || status === "sending"} onClick={submit}>
              {status === "sending" ? t("전송 중…") : t("보내기")}
            </button>
          </footer>
        </div>
      )}
      <button type="button" className="feedback-fab" onClick={() => setOpen(!open)} aria-label={t("제안 보내기")}>
        {open ? t("닫기") : t("💬 제안")}
      </button>
    </div>
  );
}
