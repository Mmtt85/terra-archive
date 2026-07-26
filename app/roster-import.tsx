"use client";

// 보유 오퍼 가져오기 패널 — 보유 오퍼 설정 모달의 "가져오기" 모드 본문.
// 세 경로를 한 화면에 모아 둔다 (사용자 확정 2026-07-26: 입력 방식은 크게
// ① 직접 입력 ② 가져오기(MAA 파일 · 스크린샷 · 게임 로그인) 두 종류):
//   - MAA 파일: 오퍼 박스 인식 결과 JSON (파일이 아는 오퍼만 갱신)
//   - 스크린샷: 화면 인식 스캐너 (모달을 따로 띄운다)
//   - 게임 로그인: 요스타 이메일 인증코드 → 계정의 실제 보유 목록 (전체를 덮어쓴다)
// 로그인 경로만 여기서 상태를 갖고, 나머지 둘은 부모 콜백으로 넘긴다.

import React, { useState } from "react";
import { rich, type T } from "./i18n";
import {
  ACCOUNT_SERVERS, AccountError, accountErrorText, loginAccount, sendAccountCode,
  type AccountRoster, type AccountServer,
} from "./account";

type Props = {
  t: T;
  onMaaFile: (file: File) => void;
  onScan: () => void;
  onAccount: (roster: AccountRoster) => void;
  scanBadge?: React.ReactNode;
};

export function RosterImportPanel({ t, onMaaFile, onScan, onAccount, scanBadge }: Props) {
  const [server, setServer] = useState<AccountServer>("kr");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<"" | "code" | "login">("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = (caught: unknown) => {
    const failCode = caught instanceof AccountError ? caught.code : "internal";
    setError(t(accountErrorText(failCode), { code: failCode }));
    // 쿨다운(too-many)은 직전 요청의 코드가 아직 유효하다는 뜻이라 입력칸을 닫지 않는다
    if (failCode === "too-many") setSent(true);
  };

  const requestCode = async () => {
    setError(null); setNotice(null); setBusy("code");
    try {
      await sendAccountCode(email, server);
      setSent(true);
      setNotice(t("인증코드를 보냈습니다 — 메일함(스팸함 포함)을 확인해 주세요."));
    } catch (caught) { fail(caught); } finally { setBusy(""); }
  };

  const login = async () => {
    setError(null); setNotice(null); setBusy("login");
    try {
      const roster = await loginAccount(email, code, server);
      setCode("");
      onAccount(roster);
    } catch (caught) { fail(caught); } finally { setBusy(""); }
  };

  return (
    <div className="roster-import">
      <section className="import-way">
        <h4>{t("MAA 파일")}</h4>
        <p>{t("MAA(MaaAssistantArknights)의 오퍼 박스 인식 결과 JSON을 불러옵니다. 파일에 있는 오퍼만 갱신하므로, MAA가 모르는 최신 오퍼는 현재 설정이 그대로 남습니다.")}</p>
        <label className="maa-import import-action">
          <span className="btn-icon" aria-hidden>⤒</span>{t("MAA 파일 가져오기")}
          <input type="file" accept="application/json,.json"
            onChange={(event) => { const file = event.target.files?.[0]; if (file) onMaaFile(file); event.target.value = ""; }} />
        </label>
      </section>

      <section className="import-way">
        <h4>{t("스크린샷")}</h4>
        <p>{t("게임의 오퍼레이터 목록 화면을 캡처해 붙여넣으면 카드 그림과 정예화를 자동으로 읽습니다. 게임 세션을 건드리지 않아 플레이 중에도 쓸 수 있습니다.")}</p>
        <button type="button" className="import-action" onClick={onScan}>
          <span className="btn-icon" aria-hidden>◉</span>{t("스크린샷으로 보유 오퍼 스캔")}{scanBadge}
        </button>
      </section>

      <section className="import-way import-login">
        <h4>{t("게임 로그인")}</h4>
        <p>{t("요스타 계정 이메일로 인증코드를 받아 로그인하면, 계정의 실제 보유 목록과 정예화를 그대로 가져옵니다 — 가장 정확한 방법입니다.")}</p>
        <p className="import-warn">{rich(t("**주의: 가져오는 순간 게임 접속이 끊깁니다.** 데이터를 받으려면 게임 서버에 접속을 새로 열어야 하고, 명일방주는 계정당 접속을 하나만 허용하기 때문입니다. 게임을 하지 않을 때 쓰세요 — 계정에는 아무 문제가 없고, 다시 실행하면 그대로 접속됩니다."))}</p>
        <div className="import-form">
          <label>
            <span>{t("서버")}</span>
            <select value={server} onChange={(event) => { setServer(event.target.value as AccountServer); setSent(false); }}>
              {ACCOUNT_SERVERS.map((entry) => <option key={entry.code} value={entry.code}>{t(entry.label)}</option>)}
            </select>
          </label>
          <label className="import-email">
            <span>{t("요스타 계정 이메일")}</span>
            <input type="email" inputMode="email" autoComplete="email" value={email} placeholder="doctor@example.com"
              onChange={(event) => { setEmail(event.target.value); setSent(false); }} />
          </label>
          <button type="button" className="import-action" disabled={!email.includes("@") || busy !== ""} onClick={() => void requestCode()}>
            {busy === "code" ? t("보내는 중…") : sent ? t("인증코드 다시 받기") : t("인증코드 받기")}
          </button>
        </div>
        {sent && (
          <div className="import-form">
            <label className="import-code">
              <span>{t("인증코드")}</span>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
            </label>
            <button type="button" className="import-action apply" disabled={code.length < 4 || busy !== ""} onClick={() => void login()}>
              {busy === "login" ? t("가져오는 중…") : t("로그인해서 보유 오퍼 가져오기")}
            </button>
          </div>
        )}
        {notice && <p className="import-msg">{notice}</p>}
        {error && <p className="import-msg error">{error}</p>}
        <p className="import-privacy">{t("이메일과 인증코드는 저장하지 않습니다 — 요스타 인증을 대신 호출하는 데만 쓰고 바로 버립니다. 받은 보유 목록도 이 브라우저 안에만 남습니다.")}</p>
      </section>
    </div>
  );
}
