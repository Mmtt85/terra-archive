"use client";

// 공유 카드 정품 인증 창 (2026-10-05) — 카드의 QR 이 /me#verify=<숫자.서명> 으로 연다.
// 서명은 계정 연동 워커만 만들고 확인할 수 있다(SIGN_KEY). 맞으면 동기화한 그 순간의 숫자를 보여 주고,
// 카드의 숫자가 이와 다르면 고친 이미지다. 해시는 전역 모달 해시(GLOBAL_MODAL_HASH)라 화면을 바꾸지 않는다.

import { useEffect, useState } from "react";
import { useI18n, DT_LOCALE } from "./i18n";
import { ModalWindow } from "./modal-window";
import { verifySeal, type SealData } from "./account";

const HASH = "#verify=";

export function MeVerify() {
  const { locale, t } = useI18n();
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<{ code: string; data: SealData | null; error?: boolean } | null>(null);

  useEffect(() => {
    const read = () => {
      const hash = window.location.hash;
      setCode(hash.startsWith(HASH) ? decodeURIComponent(hash.slice(HASH.length)) : null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    verifySeal(code)
      .then((data) => { if (alive) setState({ code, data }); })
      .catch(() => { if (alive) setState({ code, data: null, error: true }); });
    return () => { alive = false; };
  }, [code]);

  if (!code) return null;
  const close = () => {
    History.prototype.replaceState.call(history, null, "", window.location.pathname + window.location.search);
    setCode(null);
  };
  const fmt = new Intl.NumberFormat(DT_LOCALE[locale]).format;
  const when = (sec: number, time: boolean) => new Date(sec * 1000).toLocaleString(DT_LOCALE[locale], time
    ? { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
    : { year: "numeric", month: "long", day: "numeric" });
  const done = state?.code === code ? state : null;
  const d = done?.data;
  const rows: [string, string][] = d ? [
    [t("박사"), `${d.nick}#${d.nickNo}`],
    ["UID", d.uid],
    [t("서버"), d.server.toUpperCase()],
    [t("레벨"), `Lv.${d.level}`],
    ...(d.register ? [[t("입사일"), when(d.register, false)] as [string, string]] : []),
    [t("보유 오퍼"), fmt(d.owned)],
    [t("정예화 2"), fmt(d.e2)],
    [t("2정 90"), fmt(d.e2l90)],
    [t("풀잠 (잠재 6)"), fmt(d.pot6)],
    [t("3마스터 스킬"), fmt(d.m3)],
    [t("보유 스킨"), fmt(d.skins)],
    [t("훈장"), fmt(d.medals)],
  ] : [];
  return (
    <ModalWindow label={t("정품 인증")} className="operator-modal me-verify-modal" onClose={close}>
      <div className="me-verify">
        {!done && <p className="me-note">{t("확인하는 중…")}</p>}
        {done && d && (
          <>
            <p className="me-verify-ok"><b>✓ {t("정품 카드입니다")}</b>{t("{date}에 테라 아카이브가 게임 서버에서 직접 받아 서명한 숫자입니다.", { date: when(d.at, true) })}</p>
            <dl className="me-verify-list">
              {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
            <p className="me-note">{t("카드의 숫자가 위와 다르면 고친 이미지입니다. 동기화 뒤에 더 키운 만큼은 달라질 수 있습니다 — 카드의 동기화 시각을 함께 보세요.")}</p>
          </>
        )}
        {done && !d && (
          <p className="me-verify-bad"><b>✕ {t("확인할 수 없는 카드입니다")}</b>{done.error ? t("인증 서버에 연결하지 못했습니다 — 잠시 뒤 다시 열어 주세요.") : t("서명이 맞지 않습니다 — QR이 손상됐거나 내용을 고친 카드입니다.")}</p>
        )}
      </div>
    </ModalWindow>
  );
}
