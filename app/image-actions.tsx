"use client";

// 이미지 저장·복사 공용 단추 (사용자 지시 2026-10-23 "이미지 다운받는 모든 버튼을, 클릭하면 웹피랑 피엔지 메뉴가 나와서 … 복사도 마찬가지로").
// 화면마다 캔버스로 PNG 묶음(blob)을 만들어 두면, 여기서 고른 형식으로 바꿔 내려받거나 클립보드에 넣는다.
//  · WebP 는 같은 화질에 PNG 보다 훨씬 작다. 못 만드는 브라우저(옛 사파리)는 PNG 로 대신하고 알린다
//  · 클립보드는 image/png 만 받는 브라우저가 많다 — WebP 복사가 막히면 PNG 로 다시 시도한다
// 쓰는 곳: 인프라 편성표(planner.tsx) · 파밍 미래시(farm-future-image.tsx) · 가챠 결과(gacha.tsx) · 내 정보 공유 카드(me-share.tsx) · 관리 방문 리포트
import { useState } from "react";
import { Dropdown } from "./dropdown";
import { useI18n } from "./i18n";

type Fmt = "webp" | "png";

async function toFormat(png: Blob, fmt: Fmt): Promise<Blob> {
  if (fmt === "png") return png;
  const bmp = await createImageBitmap(png);
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  cv.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close?.();
  const out = await new Promise<Blob | null>((res) => cv.toBlob(res, "image/webp", 0.92));
  return out && out.type === "image/webp" ? out : png;
}

export function ImageActions({ blob, name, className, buttonClassName, saveLabel, copyLabel, onNote }: {
  /** 캔버스로 만든 PNG — 없으면 단추가 잠긴다 */
  blob: Blob | null;
  /** 내려받을 파일 이름 (확장자 없이) */
  name: string;
  className?: string;
  /** 화면마다 쓰던 단추 모양 그대로 */
  buttonClassName?: string;
  saveLabel?: React.ReactNode;
  copyLabel?: React.ReactNode;
  /** 결과 알림을 화면 쪽 토스트로 띄우고 싶을 때 — 없으면 단추 옆에 잠깐 글자로 */
  onNote?: (text: string) => void;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState<string | null>(null);
  const say = (text: string) => {
    if (onNote) { onNote(text); return; }
    setNote(text);
    window.setTimeout(() => setNote((cur) => (cur === text ? null : cur)), 2200);
  };
  const items = [{ value: "webp", label: "WebP" }, { value: "png", label: "PNG" }];
  const save = async (fmt: Fmt) => {
    if (!blob) return;
    const out = await toFormat(blob, fmt);
    const ext = out.type === "image/webp" ? "webp" : "png";
    const url = URL.createObjectURL(out);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    say(fmt === "webp" && ext !== "webp" ? t("이 브라우저는 WebP 를 못 만들어 PNG 로 저장했습니다") : t("저장했습니다"));
  };
  const copy = async (fmt: Fmt) => {
    if (!blob) return;
    try {
      const out = await toFormat(blob, fmt);
      try {
        await navigator.clipboard.write([new ClipboardItem({ [out.type]: out })]);
        say(t("복사했습니다"));
      } catch {
        if (out.type === "image/png") throw new Error("png");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        say(t("이 브라우저는 WebP 복사를 못 해 PNG 로 복사했습니다"));
      }
    } catch {
      say(t("이 브라우저에서는 그림 복사가 안 됩니다 — 저장 단추를 써 주세요"));
    }
  };
  return (
    <span className={`img-actions${className ? ` ${className}` : ""}`}>
      {note && <span className="img-actions-note" role="status">{note}</span>}
      <Dropdown actions ariaLabel={t("복사")} label={copyLabel ?? t("복사")} buttonClassName={buttonClassName} disabled={!blob}
        selected={[]} items={items} onPick={(v) => void copy(v as Fmt)} />
      <Dropdown actions ariaLabel={t("저장")} label={saveLabel ?? t("저장")} buttonClassName={buttonClassName} disabled={!blob}
        selected={[]} items={items} onPick={(v) => void save(v as Fmt)} />
    </span>
  );
}
