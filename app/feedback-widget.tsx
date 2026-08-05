"use client";

import { useEffect, useRef, useState } from "react";
import { feedbackReady, sendFeedback, uploadFeedbackImage, FEEDBACK_IMG_MAX, FEEDBACK_IMG_MB, type FeedbackKind } from "./feedback";
import { ModalWindow } from "./modal-window";
import { isNewFeature } from "./whats-new";
import { useI18n } from "./i18n";

// open/setOpen은 부모(home)가 쥔다 — 모바일에선 헤더의 '제안' 버튼(공식 방송 옆)이,
// 데스크탑에선 우하단 FAB이 같은 패널을 연다 (사용자 요청 2026-07-22).
// 패널 자체는 사이트 공용 창 모달(ModalWindow) — 다른 모달과 같이 잡아 옮기고 고정할 수 있다
// (사용자 지적 2026-08-05: "제안 보내기 모달은 왜 윈도우방식이 아니고 radius도 없냐").
export default function FeedbackWidget({ open, setOpen }: { open: boolean; setOpen: (value: boolean) => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<FeedbackKind>("feature");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [statusText, setStatusText] = useState("");
  // 첨부 이미지 (사용자 요청 2026-08-05: 최대 3장). 고르면 미리보기만 만들고,
  // R2 업로드는 **보내기 시점**에 한다 — 쓰다 만 제안의 이미지가 버킷에 남지 않게.
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // objectURL은 우리가 만들었으니 우리가 해제한다 — 단 **언마운트 때만**. images를 deps에
  // 넣으면 장을 추가할 때마다 아직 쓰는 미리보기까지 해제된다.
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => () => { imagesRef.current.forEach((img) => URL.revokeObjectURL(img.preview)); }, []);

  // ⚠ FileList는 라이브 객체다 — input.value=""로 비우면 나중에 도는 상태 갱신에서
  //   빈 목록이 된다 (실측: 2장 첨부가 0장으로). 핸들러에서 배열로 스냅샷해 넘길 것.
  const addImages = (picked: File[]) => {
    const room = FEEDBACK_IMG_MAX - imagesRef.current.length;
    if (room <= 0) { setStatusText(t("이미지는 최대 {n}장까지 첨부할 수 있습니다", { n: FEEDBACK_IMG_MAX })); return; }
    const ok: { file: File; preview: string }[] = [];
    for (const file of picked) {
      if (ok.length >= room) break;
      if (!file.type.startsWith("image/")) continue;
      if (file.size > FEEDBACK_IMG_MB * 1024 * 1024) {
        setStatusText(t("이미지는 장당 {n}MB 이하만 첨부할 수 있습니다", { n: FEEDBACK_IMG_MB }));
        continue;
      }
      ok.push({ file, preview: URL.createObjectURL(file) });
    }
    if (ok.length) { setStatusText(""); setImages((cur) => [...cur, ...ok].slice(0, FEEDBACK_IMG_MAX)); }
  };

  const removeImage = (idx: number) => {
    setImages((cur) => {
      URL.revokeObjectURL(cur[idx]?.preview ?? "");
      return cur.filter((_, i) => i !== idx);
    });
  };

  // 클립보드 붙여넣기 — 패널이 열려 있는 동안 어디에 포커스가 있든 받는다
  // (스크린샷을 캡처해 바로 Ctrl+V 하는 흐름이 가장 흔하다, 사용자 요청 2026-08-05)
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length) { e.preventDefault(); addImages(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (!message.trim() || status === "sending") return;
    setStatus("sending");
    setStatusText("");
    try {
      // 이미지 먼저 R2로 — 하나라도 실패하면 제안 자체를 보내지 않는다 (반쪽 전송 방지)
      const urls: string[] = [];
      for (const img of images) urls.push(await uploadFeedbackImage(img.file));
      await sendFeedback(kind, message.trim(), urls.length ? { images: urls } : undefined);
      setStatus("done");
      setMessage("");
      setImages((cur) => { cur.forEach((img) => URL.revokeObjectURL(img.preview)); return []; });
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
        <ModalWindow label={t("제안 보내기")} className="feedback-modal" onClose={() => setOpen(false)}>
          {/* 패널 전체가 이미지 드롭 대상 — 끌어다 놓아도, 붙여넣어도, 눌러 골라도 된다 */}
          <div className={`feedback-panel${dragOver ? " dragover" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addImages(Array.from(e.dataTransfer.files ?? [])); }}>
            <div className="feedback-kind">
              <button type="button" className={kind === "feature" ? "selected" : ""} onClick={() => setKind("feature")}>{t("기능 제안")}</button>
              <button type="button" className={kind === "data_error" ? "selected" : ""} onClick={() => setKind("data_error")}>{t("데이터 오류 리포트")}</button>
            </div>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={4000}
              placeholder={kind === "feature" ? t("이런 기능이 있으면 좋겠어요…") : t("어떤 오퍼의 어떤 데이터가 잘못됐는지 알려주세요")} />
            {/* 첨부 줄 — 섬네일 + 추가 버튼. 3장이 차면 추가 버튼이 사라진다 */}
            <div className="fb-attach">
              {images.map((img, i) => (
                <span key={img.preview} className="fb-thumb">
                  <img src={img.preview} alt="" />
                  <button type="button" aria-label={t("첨부 삭제")} onClick={() => removeImage(i)}>×</button>
                </span>
              ))}
              {images.length < FEEDBACK_IMG_MAX && (
                <button type="button" className="fb-attach-btn" onClick={() => fileRef.current?.click()}
                  title={t("스크린샷 등 이미지 최대 {n}장 (장당 {m}MB 이하)", { n: FEEDBACK_IMG_MAX, m: FEEDBACK_IMG_MB })}>
                  📎 {t("이미지 첨부")} {images.length > 0 ? `${images.length}/${FEEDBACK_IMG_MAX}` : ""}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple hidden
                onChange={(e) => { addImages(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            </div>
            <p className="fb-attach-hint">{t("이미지를 끌어다 놓거나 붙여넣기(Ctrl+V)도 됩니다")}</p>
            <footer>
              <small>{status === "done" ? t("보냈습니다, 감사합니다!") : status === "error" ? t("전송 실패 — 잠시 후 다시 시도해주세요") : statusText || t("익명으로 전송됩니다")}</small>
              <button type="button" className="feedback-send" disabled={!message.trim() || status === "sending"} onClick={submit}>
                {status === "sending" ? t("전송 중…") : t("보내기")}
              </button>
            </footer>
            {dragOver && <div className="fb-drop-veil">{t("여기에 놓으면 첨부됩니다")}</div>}
          </div>
        </ModalWindow>
      )}
      <button type="button" className="feedback-fab" onClick={() => setOpen(!open)} aria-label={t("제안 보내기")}>
        {open ? t("닫기") : t("💬 제안")}
        {!open && isNewFeature("feedback-image") && <span className="new-badge">{t("새기능")}</span>}
      </button>
    </div>
  );
}
