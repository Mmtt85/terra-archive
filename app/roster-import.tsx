"use client";

// 보유 오퍼 가져오기 패널 — 보유 오퍼 설정 모달의 "가져오기" 모드 본문.
// 세 경로를 한 화면에 모아 둔다 (사용자 확정 2026-07-26: 입력 방식은 크게
// ① 직접 입력 ② 가져오기(MAA 파일 · 스크린샷 · 게임 로그인) 두 종류):
//   - MAA 파일: 오퍼 박스 인식 결과 JSON (파일이 아는 오퍼만 갱신)
//   - 스크린샷: 화면 인식 스캐너 (모달을 따로 띄운다)
//   - 게임 로그인: 요스타 이메일 인증코드 → 계정의 실제 보유 목록 (전체를 덮어쓴다)
// 로그인 경로만 여기서 상태를 갖고, 나머지 둘은 부모 콜백으로 넘긴다.

import React, { useEffect, useRef, useState } from "react";
import { rich, type T } from "./i18n";
import { Dropdown } from "./dropdown";
import { isNewFeature } from "./whats-new";
import {
  ACCOUNT_SERVERS, ACCOUNT_STEPS, AccountError, accountErrorText, isYostarServer, loginAccount, sendAccountCode,
  type AccountRoster, type AccountServer, type AccountStep,
} from "./account";
import { saveMe } from "./me-store";
import { CnLoginFields } from "./account-cn";

type Props = {
  t: T;
  onMaaFile: (file: File) => void;
  onScan: () => void;
  onAccount: (roster: AccountRoster) => void;
  scanBadge?: React.ReactNode;
};

export function RosterImportPanel({ t, onMaaFile, onScan, onAccount, scanBadge }: Props) {
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
        <h4>{t("게임 로그인")}{isNewFeature("account") && <span className="new-badge">{t("새기능")}</span>}</h4>
        <p>{t("요스타 계정 이메일로 인증코드를 받아 로그인하면, 계정의 실제 보유 목록과 정예화를 그대로 가져옵니다 — 가장 정확한 방법입니다.")}</p>
        <p className="import-warn">{rich(t("**주의: 가져오는 순간 게임 접속이 끊깁니다.** 데이터를 받으려면 게임 서버에 접속을 새로 열어야 하고, 명일방주는 계정당 접속을 하나만 허용하기 때문입니다. 게임을 하지 않을 때 쓰세요 — 계정에는 아무 문제가 없고, 다시 실행하면 그대로 접속됩니다."))}</p>
        <AccountLoginForm t={t} onAccount={onAccount} submitLabel={t("로그인해서 보유 오퍼 가져오기")}
          privacy={t("이메일과 인증코드는 저장하지 않습니다 — 요스타 인증을 대신 호출하는 데만 쓰고 바로 버립니다. 받은 보유 목록도 이 브라우저 안에만 남습니다.")} />
      </section>
    </div>
  );
}

/** 요스타 이메일 인증코드 로그인 폼 — 인프라 '가져오기'와 '내 정보'가 같이 쓴다.
 *  로그인에 성공하면 결과를 '내 정보' 저장소(me-store)에 쌓은 뒤 onAccount 로 넘긴다. */
/** 로그인·동기화 진행 단계 — 지난 단계 ✓, 지금 단계 강조, 남은 단계 흐리게 (사용자 요청 2026-10-05
 *  "로그인할 때 무슨 데이터 받아오고 있는지 진행 상황"). 다시 동기화는 요스타 인증을 건너뛴다. */
export function AccountSteps({ t, step, sync, server = "kr" }: { t: T; step: AccountStep | "start"; sync?: boolean; server?: AccountServer }) {
  // 인증 단계는 서버에 따라 하나 — 요스타(한·일·글) 또는 계정 인증(중섭 통행증·비리비리). 다시 동기화는 둘 다 건너뛴다
  const yostar = isYostarServer(server);
  const steps = ACCOUNT_STEPS.filter((entry) => !((entry.id === "yostar" && (sync || !yostar)) || (entry.id === "passport" && (sync || yostar))));
  const at = steps.findIndex((entry) => entry.id === step);
  return (
    <ol className="acct-steps" aria-live="polite">
      {steps.map((entry, i) => (
        <li key={entry.id} className={i < at ? "done" : i === at ? "now" : ""}>
          <span className="acct-step-dot" aria-hidden>{i < at ? "✓" : ""}</span>{t(entry.label)}
        </li>
      ))}
    </ol>
  );
}

/** privacy — 요스타 서버일 때만 맨 아래 붙는 개인정보 안내. 중섭은 폼(account-cn.tsx)이 자기 안내를 단다 — 둘이 겹쳐 나왔다 (2026-10-06) */
export function AccountLoginForm({ t, onAccount, submitLabel, privacy }: { t: T; onAccount: (roster: AccountRoster) => void; submitLabel: string; privacy?: string }) {
  const [server, setServer] = useState<AccountServer>("kr");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<"" | "code" | "login">("");
  const [step, setStep] = useState<AccountStep | "start">("start");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = (caught: unknown) => {
    const failCode = caught instanceof AccountError ? caught.code : "internal";
    setError(t(accountErrorText(failCode), { code: failCode }));
    // 쿨다운(too-many)은 직전 요청의 코드가 아직 유효하다는 뜻이라 입력칸을 닫지 않는다
    if (failCode === "too-many") setSent(true);
  };

  // 클립보드 자동 입력 (사용자 요청 2026-10-05) — 메일에서 복사한 여섯 자리 숫자를 창으로 돌아오면 코드 칸에 채운다.
  // 로그인 버튼은 사람이 누른다. 보내기 전부터 클립보드에 있던 숫자(옛 코드)는 쓰지 않으려고 보낼 때 한 번 읽어 둔다.
  // 브라우저가 클립보드 읽기를 처음 한 번 묻는다 — 거절하거나 지원하지 않으면 조용히 손 입력으로 남는다.
  const clipBefore = useRef<Promise<string | null>>(Promise.resolve(null));
  const readClip = async () => {
    try { return (await navigator.clipboard.readText()).trim(); } catch { return null; }
  };
  useEffect(() => {
    if (!sent) return;
    const fill = async () => {
      const text = await readClip();
      if (text && /^\d{6}$/.test(text) && text !== await clipBefore.current) setCode((cur) => cur || text);
    };
    const onVisible = () => { if (document.visibilityState === "visible") void fill(); };
    window.addEventListener("focus", fill);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", fill); document.removeEventListener("visibilitychange", onVisible); };
  }, [sent]);

  const requestCode = async () => {
    setError(null); setNotice(null); setBusy("code");
    clipBefore.current = readClip();   // 기다리지 않는다 — 권한 창이 떠도 코드 발송은 바로 나간다
    try {
      await sendAccountCode(email, server);
      setSent(true);
      setNotice(t("인증코드를 보냈습니다 — 메일함(스팸함 포함)을 확인해 주세요."));
    } catch (caught) { fail(caught); } finally { setBusy(""); }
  };

  const login = async () => {
    setError(null); setNotice(null); setBusy("login"); setStep("start");
    try {
      const roster = await loginAccount(email, code, server, setStep);
      setCode("");
      // '내 정보'와 같은 저장소에 쌓는다 — 여기서 로그인해도 도감·창고·통계가 함께 갱신된다
      saveMe(roster, server);
      onAccount(roster);
    } catch (caught) { fail(caught); } finally { setBusy(""); }
  };

  const serverPick = (
    <div className="import-field">
      <span>{t("서버")}</span>
      <Dropdown ariaLabel={t("서버")} selected={[server]}
        label={t(ACCOUNT_SERVERS.find((entry) => entry.code === server)?.label ?? server)}
        items={ACCOUNT_SERVERS.map((entry) => ({ value: entry.code, label: t(entry.label) }))}
        onPick={(value) => { setServer(value as AccountServer); setSent(false); setError(null); setNotice(null); }} />
    </div>
  );
  // 중섭은 로그인 방법이 달라 폼을 따로 그린다 (app/account-cn.tsx, 2026-10-06)
  if (server === "cn" || server === "bili") {
    return (
      <>
        <div className="import-form">{serverPick}</div>
        <CnLoginFields t={t} server={server} submitLabel={submitLabel} onAccount={onAccount} />
      </>
    );
  }

  return (
    <>
      <div className="import-form">
        {serverPick}
        <label className="import-email">
          <span>{t("요스타 계정 이메일")}</span>
          <input type="email" inputMode="email" autoComplete="email" value={email} placeholder="doctor@example.com"
            onChange={(event) => { setEmail(event.target.value); setSent(false); }}
            // 엔터 = 인증코드 받기 (사용자 요청 2026-10-05). 한글 조합 중 엔터는 무시한다
            onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && email.includes("@") && busy === "") void requestCode(); }} />
        </label>
        <button type="button" className="import-action" disabled={!email.includes("@") || busy !== ""} onClick={() => void requestCode()}>
          {busy === "code" ? t("보내는 중…") : sent ? t("인증코드 다시 받기") : t("인증코드 받기")}
        </button>
      </div>
      {/* 코드를 받기 전에도 이 줄은 **자리를 잡고 있는다** — 발송 응답은 클릭 500ms 뒤에
          오므로, 그때 줄이 새로 생기면 아래 안내문이 밀려 레이아웃 흔들림(CLS)으로 잡혔다
          (2026-08-22). 비활성 상태로 미리 보이면 다음 단계가 뭔지도 같이 알려 준다. */}
      <div className="import-form">
        <label className="import-code">
          <span>{t("인증코드")}</span>
          <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code}
            disabled={!sent} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            onKeyDown={(event) => { if (event.key === "Enter" && sent && code.length >= 4 && busy === "") void login(); }} />
        </label>
        <button type="button" className="import-action apply" disabled={!sent || code.length < 4 || busy !== ""} onClick={() => void login()}>
          {busy === "login" ? t("가져오는 중…") : submitLabel}
        </button>
      </div>
      {busy === "login" && <AccountSteps t={t} step={step} />}
      {notice && <p className="import-msg">{notice}</p>}
      {error && <p className="import-msg error">{error}</p>}
      {privacy && <p className="import-privacy">{privacy}</p>}
    </>
  );
}
