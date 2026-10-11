"use client";

// 그림 한 장 보기(ViewImg)와 큰 그림 확대 창(ZoomWindow) — 갤러리와 오퍼 상세 스킨이 같이 쓴다.
// 오퍼 상세의 스킨 확대가 화면 전체를 덮던 것을 갤러리처럼 창 모달로 (사용자 지시 2026-10-12) 바꾸며 gallery.tsx 에서 옮겼다.
import { useState } from "react";
import { useI18n } from "./i18n";
import { ModalWindow } from "./modal-window";
import { DynVideo } from "./dyn-illust";

export function ViewImg({ src, alt, onClick, dyn }: { src: string; alt: string; onClick?: () => void; dyn?: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"load" | "ok" | "err">("load");
  const [live, setLive] = useState(false);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} onClick={onClick} className={state === "ok" ? (live ? "dyn-off" : undefined) : "gl-img-wait"}
        onLoad={() => setState("ok")} onError={() => setState("err")} />
      {/* 움직이는 일러스트 — 정지 그림(첫 프레임)과 같은 칸에 겹친다 */}
      {dyn && state === "ok" && <DynVideo portrait={dyn} className="gl-dyn" onLive={setLive} />}
      {state !== "ok" && (
        <span className="gl-loading" role="status">
          {state === "load" ? <><i aria-hidden />{t("불러오는 중…")}</> : t("이미지를 불러오지 못했습니다.")}
        </span>
      )}
    </>
  );
}

/** 큰 그림을 누르면 뜨는 확대 창 — 원본 크기로, 넘치면 창 안에서 스크롤 (사용자 요청 2026-10-04) */
export function ZoomWindow({ src, alt, onClose, dyn }: { src: string; alt: string; onClose: () => void; dyn?: string }) {
  return (
    <ModalWindow label={alt} className="operator-modal gl-modal gl-zoom" onClose={onClose}>
      <div className="gl-zoom-body">
        <ViewImg src={src} alt={alt} dyn={dyn} />
      </div>
    </ModalWindow>
  );
}
