"use client";

import { useEffect, useRef, useState } from "react";
import { feedbackReady, sendFeedback, uploadFeedbackImage, FEEDBACK_IMG_MAX, FEEDBACK_IMG_MB, type FeedbackKind } from "./feedback";
import { useI18n } from "./i18n";

// open/setOpen은 부모(home)가 쥔다 — 모바일에선 헤더의 '제안' 버튼(공식 방송 옆)이,
// 데스크탑에선 우하단 FAB이 같은 패널을 연다 (사용자 요청 2026-07-22, PC 동작은 종전과 동일).
export default function FeedbackWidget({ open, setOpen }: { open: boolean; setOpen: (value: boolean) => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<FeedbackKind>("feature");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [statusText, setStatusText] = useState("");
  // 첨부 이미지 (사용자 요청 2026-08-05: 최대 3장). 고르면 미리보기만 만들고,
  // R2 업로드는 **보내기 시점**에 한다 — 쓰다 만 제안의 이미지가 버킷에 남지 않게.
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
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
    if (ok.length) setImages((cur) => [...cur, ...ok].slice(0, FEEDBACK_IMG_MAX));
  };

  const removeImage = (idx: number) => {
    setImages((cur) => {
      URL.revokeObjectURL(cur[idx]?.preview ?? "");
      return cur.filter((_, i) => i !== idx);
    });
  };

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
          <footer>
            <small>{status === "done" ? t("보냈습니다, 감사합니다!") : status === "error" ? t("전송 실패 — 잠시 후 다시 시도해주세요") : statusText || t("익명으로 전송됩니다")}</small>
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
