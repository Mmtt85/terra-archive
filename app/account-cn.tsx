"use client";

// 중섭(중국 서버) 게임 로그인 폼 — 인프라 '가져오기'와 '내 정보'의 로그인 폼(roster-import.tsx AccountLoginForm)이
// 서버를 '중국 (직영)'·'중국 (비리비리)'로 고르면 이걸 그린다 (2026-10-06). 기증 페이지(/cn-sample)도 부품을 같이 쓴다.
//   직영(官服): ① 森空岛(스카이랜드) 앱 QR ② 통행증 토큰 붙여넣기 ③ 휴대폰 번호 + 비밀번호.
//     한국의 중섭 유저는 중국 휴대폰 문자를 못 받는 게 보통이라 문자 인증코드는 화면에 두지 않는다 (사용자 2026-10-06).
//   B服: 비리비리 아이디 + 비밀번호.
// 중국어 고유명사엔 보는 언어로 작은 주석을 단다 (<Zh>, 사용자 확정 2026-10-06 — 세 언어를 나란히 달지 않는다).

import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import type { T } from "./i18n";
import {
  AccountError, accountErrorText, loginCnAccount, pollCnScan, startCnScan,
  type AccountRoster, type AccountStep, type CnLogin,
} from "./account";
import { saveMe } from "./me-store";
import { AccountSteps } from "./roster-import";

/** 중국어 고유명사 + 작은 주석 (보는 언어 하나) */
export function Zh({ t, g }: { t: string; g: string }) {
  return <>{t}<small className="zh-gloss">{g}</small></>;
}

/** QR — 森空岛 앱이 읽는 hypergryph://scan_login?scanId=… 를 그린다 (me-share.tsx 와 같은 라이브러리) */
export function ScanQr({ text, className }: { text: string; className?: string }) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return (
    <svg className={className} viewBox={`-3 -3 ${n + 6} ${n + 6}`} shapeRendering="crispEdges" role="img" aria-label="QR">
      <rect x={-3} y={-3} width={n + 6} height={n + 6} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** 붙여넣은 글자 → 통행증 토큰. 화면 전체({"code":0,"data":{"content":"…"}})를 붙여도, content 값만 붙여도 된다 */
export function tokenOf(text: string): string {
  const v = text.trim();
  try {
    const content = (JSON.parse(v) as { data?: { content?: unknown } })?.data?.content;
    if (typeof content === "string") return content;
  } catch { /* JSON 이 아니면 값만 붙인 것 */ }
  return v.replace(/^"|"$/g, "");
}

/** 클립보드 글자가 통행증 응답 모양이면 그 토큰 — 아니면 null. 아무 글자나 붙이지 않게 모양까지 본다 */
export function clipToken(text: string | null): string | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text.trim()) as { code?: unknown; data?: { content?: unknown } };
    const content = parsed?.data?.content;
    return parsed?.code === 0 && typeof content === "string" && content.length >= 16 ? text.trim() : null;
  } catch { return null; }
}

export type ScanState = { id: string; url: string; state: "wait" | "scanned" | "expired" };

/** QR 상태를 2초마다 본다 — 승인되면 onToken(통행증 토큰). 3분이 지나면 만료로 본다 */
export function useScanPoll(scan: ScanState | null, setScan: (fn: (s: ScanState | null) => ScanState | null) => void,
  onToken: (token: string) => void, onError: (e: unknown) => void) {
  useEffect(() => {
    if (!scan || scan.state === "expired") return;
    let stop = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stop) return;
      if (Date.now() - started > 180_000) { setScan((s) => s && { ...s, state: "expired" }); return; }
      try {
        const r = await pollCnScan(scan.id);
        if (stop) return;
        if (r.state === "done" && r.hgToken) { setScan(() => null); onToken(r.hgToken); return; }
        if (r.state === "expired") { setScan((s) => s && { ...s, state: "expired" }); return; }
        if (r.state === "scanned") setScan((s) => s && s.state !== "scanned" ? { ...s, state: "scanned" } : s);
      } catch (e) {
        if (!stop) { setScan(() => null); onError(e); }
        return;
      }
      timer = setTimeout(tick, 2000);
    };
    timer = setTimeout(tick, 2000);
    return () => { stop = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan?.id, scan?.state === "expired"]);
}

/** 중섭 오류 문구 — 요스타 문구를 쓰면 안 되는 몇 개만 따로, 나머지는 공용 (accountErrorText) */
export function cnErrorText(code: string): string {
  switch (code) {
    case "captcha": return "로그인에 캡차(사람 확인)가 걸렸습니다 — 이 화면에선 풀 수 없어요. 직영 서버면 QR 로그인으로 해 주세요.";
    case "token-expired": return "로그인 정보가 만료됐거나 맞지 않습니다 — 처음부터 다시 로그인해 주세요.";
    case "no-account": return "그 계정을 찾지 못했습니다.";
    default: return accountErrorText(code);
  }
}

export function CnLoginFields({ t, server, submitLabel, onAccount }: {
  t: T; server: "cn" | "bili"; submitLabel: string; onAccount: (roster: AccountRoster) => void;
}) {
  const [mode, setMode] = useState<"qr" | "token" | "password">("qr");
  const [token, setToken] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [scan, setScan] = useState<ScanState | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<AccountStep | "start">("start");
  const [error, setError] = useState<string | null>(null);

  const fail = (caught: unknown) => {
    const code = caught instanceof AccountError ? caught.code : "internal";
    setError(t(cnErrorText(code), { code }));
  };

  const login = async (args: CnLogin) => {
    setError(null); setBusy(true); setStep("start");
    try {
      const roster = await loginCnAccount(args, setStep);
      setPassword(""); setToken("");
      saveMe(roster, server);   // '내 정보'와 같은 저장소 — 인프라에서 로그인해도 함께 갱신된다
      onAccount(roster);
    } catch (caught) { fail(caught); } finally { setBusy(false); }
  };

  const startScan = async () => {
    setError(null); setBusy(true);
    try {
      const s = await startCnScan();
      setScan(() => ({ id: s.scanId, url: s.scanUrl, state: "wait" }));
    } catch (caught) { fail(caught); }
    setBusy(false);
  };

  // 토큰 자동 붙여넣기 (사용자 요청 2026-10-06) — 요스타 인증코드 자동 입력과 같은 방식. '토큰 붙여넣기'를 고를 때와
  // 통행증 탭에서 이 창으로 돌아올 때 클립보드를 읽어, 통행증 응답 모양({"code":0,"data":{"content":…}})이면 비어 있는 칸에 채운다.
  // 로그인 버튼은 사람이 누른다. 브라우저가 처음 한 번 권한을 묻고, 거절하면 조용히 손 붙여넣기로 남는다
  useEffect(() => {
    if (server !== "cn" || mode !== "token") return;
    const fill = async () => {
      let text: string | null = null;
      try { text = await navigator.clipboard.readText(); } catch { return; }
      const hit = clipToken(text);
      if (hit) setToken((cur) => cur || hit);
    };
    void fill();
    const onVisible = () => { if (document.visibilityState === "visible") void fill(); };
    window.addEventListener("focus", fill);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", fill); document.removeEventListener("visibilitychange", onVisible); };
  }, [server, mode]);

  useScanPoll(scan, setScan, (hgToken) => void login({ server: "cn", hgToken }), fail);
  // 방법·서버를 바꾸면 띄운 QR 은 버린다
  useEffect(() => { setScan(() => null); setError(null); }, [mode, server]);

  const skland = <Zh t="森空岛" g={t("스카이랜드")} />;
  const ready = server === "bili" ? !!(username.trim() && password)
    : mode === "token" ? tokenOf(token).length >= 16 : /^1\d{10}$/.test(phone.trim()) && !!password;

  return (
    <>
      {server === "cn" ? (
        <>
          <div className="cn-modes" role="radiogroup">
            <label><input type="radio" checked={mode === "qr"} onChange={() => setMode("qr")} /> {t("QR 로그인 (추천)")}</label>
            <label><input type="radio" checked={mode === "token"} onChange={() => setMode("token")} /> {t("토큰 붙여넣기")}</label>
            <label><input type="radio" checked={mode === "password"} onChange={() => setMode("password")} /> {t("휴대폰 번호 + 비밀번호")}</label>
          </div>
          {mode === "qr" ? (
            <>
              <ol className="cn-how">
                <li>{skland} {t("앱의 스캔 버튼으로 아래 QR을 찍고, 앱에서 로그인을 승인하세요. 그러면 자동으로 이어집니다.")}</li>
                <li>{t("폰으로 찍어야 하니 PC 화면에서 여는 게 편합니다.")}</li>
              </ol>
              {scan && (
                <div className="cn-scan">
                  {scan.state === "expired" ? <p>{t("QR이 만료됐습니다 — 다시 만들어 주세요.")}</p> : (
                    <>
                      <ScanQr text={scan.url} className="cn-qr" />
                      <p>{scan.state === "scanned" ? t("찍혔습니다 — 앱에서 승인해 주세요…") : t("기다리는 중…")}</p>
                      <a className="cn-note" href={scan.url}>{t("이 폰에서 보고 있다면: 앱으로 바로 열기")}</a>
                    </>
                  )}
                </div>
              )}
              {(!scan || scan.state === "expired") && (
                <button type="button" className="import-action apply cn-go" disabled={busy} onClick={() => void startScan()}>
                  {busy ? t("가져오는 중…") : scan ? t("QR 다시 만들기") : t("QR 띄우기")}
                </button>
              )}
            </>
          ) : mode === "token" ? (
            <>
              <ol className="cn-how">
                <li>{t("하이퍼그리프 통행증에 로그인합니다 — 이미 로그인돼 있으면 건너뛰세요.")}{" "}
                  <a href="https://user.hypergryph.com/login" target="_blank" rel="noopener noreferrer">user.hypergryph.com</a></li>
                <li>{t("같은 브라우저에서 아래 주소를 엽니다.")}{" "}
                  <a href="https://web-api.hypergryph.com/account/info/hg" target="_blank" rel="noopener noreferrer">web-api.hypergryph.com/account/info/hg</a></li>
                <li>{t("나온 글자를 통째로 복사해 아래에 붙여넣습니다.")}</li>
              </ol>
              <label className="cn-field">
                <span>{t("토큰")}</span>
                <textarea rows={3} spellCheck={false} autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)}
                  placeholder='{"code":0,"data":{"content":"…"}}' />
              </label>
              <p className="cn-note">{t("이 토큰은 계정에 들어갈 수 있는 열쇠입니다 — 여기 말고 다른 곳엔 붙여넣지 마세요.")}</p>
            </>
          ) : (
            <>
              <p className="cn-note">{t("문자를 받을 필요는 없습니다 — 통행증 아이디인 휴대폰 번호와 비밀번호만 넣으세요.")}</p>
              <label className="cn-field">
                <span>{t("휴대폰 번호")}</span>
                <input inputMode="numeric" autoComplete="username" maxLength={11} value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder={t("중국 휴대폰 번호 11자리")} />
              </label>
              <label className="cn-field">
                <span>{t("비밀번호")}</span>
                <input type="password" autoComplete="current-password" maxLength={64} value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
            </>
          )}
        </>
      ) : (
        <>
          <label className="cn-field">
            <span>{t("비리비리 아이디 (휴대폰 번호 / 이메일)")}</span>
            <input autoComplete="username" maxLength={64} value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="cn-field">
            <span>{t("비밀번호")}</span>
            <input type="password" autoComplete="current-password" maxLength={64} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </>
      )}
      {!(server === "cn" && mode === "qr") && (
        <button type="button" className="import-action apply cn-go" disabled={!ready || busy}
          onClick={() => void login(server === "bili" ? { server, username: username.trim(), password }
            : mode === "token" ? { server, hgToken: tokenOf(token) } : { server, phone: phone.trim(), password })}>
          {busy ? t("가져오는 중…") : submitLabel}
        </button>
      )}
      {busy && step !== "start" && <AccountSteps t={t} step={step} server={server} />}
      <p className="cn-note">{t("토큰·휴대폰 번호·비밀번호는 저장하지 않습니다 — 하이퍼그리프·비리비리에 전달만 하고 바로 버립니다. 받은 데이터도 이 브라우저 안에만 남습니다.")}</p>
      {error && <p className="import-msg error">{error}</p>}
    </>
  );
}
