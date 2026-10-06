"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "./i18n";

// window.confirm 대체 — 사이트 톤에 맞춘 확인 모달. 어디서든 재사용한다.
// 사용법: const { confirm, dialog } = useConfirm();  →  JSX에 {dialog} 렌더,
//        const ok = await confirm({ message, title?, confirmLabel?, cancelLabel?, danger? });
//        세 번째 길이 필요하면 altLabel — 그 버튼을 누르면 "alt" 로 끝난다 (다시 동기화 ↔ 다시 로그인, 2026-10-06)
export type ConfirmOptions = {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // 되돌릴 수 없는 파괴적 동작이면 확인 버튼을 경고색으로
  altLabel?: string; // 취소·확인 사이의 세 번째 버튼 — 누르면 confirm() 이 "alt" 를 돌려준다
};

function ConfirmDialog({
  message,
  title,
  confirmLabel,
  cancelLabel,
  danger,
  altLabel,
  onConfirm,
  onCancel,
  onAlt,
}: ConfirmOptions & { onConfirm: () => void; onCancel: () => void; onAlt: () => void }) {
  const { t } = useI18n();
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    okRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      else if (event.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onConfirm, onCancel]);

  return (
    <div className="modal-backdrop confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="confirm-modal" role="alertdialog" aria-modal="true" aria-label={title ?? message}>
        {title && <h3 className="confirm-title">{title}</h3>}
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onCancel}>{cancelLabel ?? t("취소")}</button>
          {altLabel && <button type="button" className="confirm-cancel" onClick={onAlt}>{altLabel}</button>}
          <button type="button" ref={okRef} className={`confirm-ok${danger ? " danger" : ""}`} onClick={onConfirm}>{confirmLabel ?? t("확인")}</button>
        </div>
      </section>
    </div>
  );
}

export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean | "alt") => void) | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean | "alt">((resolve) => {
        resolver.current = resolve;
        setOptions(opts);
      }),
    []
  );

  const settle = useCallback((ok: boolean | "alt") => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  }, []);

  // body 포털 — 부모가 만든 stacking context(z-index 낮은 위젯·창모달)에 갇히지 않게.
  // 제안 게시판(창모달 z 200대 위에서 confirm)에서 실측된 문제 (2026-08-17): 위젯 루트가
  // z 150 컨텍스트라 그 안에 그리면 백드롭이 창모달 아래 깔려 클릭이 막혔다.
  const dialog = options ? createPortal(
    <ConfirmDialog {...options} onConfirm={() => settle(true)} onCancel={() => settle(false)} onAlt={() => settle("alt")} />,
    document.body
  ) : null;

  return { confirm, dialog };
}
