"use client";

// 중섭 계정 샘플 기증 (2026-10-06) — 중섭(직영 官服 · B服) '내 정보' 연동을 만들기 전에, 중섭 유저가 한 번 로그인해
// 게임 서버가 주는 계정 데이터(syncData 원본 + 워커 요약)를 제안 첨부 파일로 개발자에게 보내 주는 페이지.
// 보는 사람은 한국에 있는 중섭 유저라 화면은 한국어만 — 링크로만 오는 단독 페이지라 i18n 사전엔 넣지 않는다 (EN/JA 없음).
// 워커(workers/account)가 raw 응답에서 재접속 토큰을 빼고 이름표·uid 를 지운다. 휴대폰·비밀번호는 워커가 중계만 하고 저장하지 않는다.

import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { AccountError, loginCnSample, pollCnScan, startCnScan, type CnServer } from "../account";
import { sendFeedback, uploadFeedbackFile, fmtFileSize, FEEDBACK_IMG_MB } from "../feedback";

// ── 마감 (사용자 계획 2026-10-06) ── 직영·B服 데이터가 각각 하나 이상 들어오면 페이지를 닫는다.
// 닫을 때 여기에 받은 건수를 넣고 배포한다 — 로그인 화면 대신 감사 인사만 나온다. null 이면 열려 있다.
// 닫기 전 모습 미리보기: /cn-sample?preview=closed (dev·라이브 모두)
const CLOSED: { official: number; bili: number } | null = null;

const STEPS: { id: string; label: string }[] = [
  { id: "network", label: "서버 주소 확인" },
  { id: "passport", label: "계정 인증" },
  { id: "game", label: "게임 서버 접속" },
  { id: "sync", label: "계정 데이터 받기" },
  { id: "friends", label: "친구 목록" },
  { id: "shop", label: "크레딧 상점" },
  { id: "digest", label: "정리하기" },
];

function errorText(code: string): string {
  switch (code) {
    case "offline": return "계정 서버에 연결할 수 없습니다 — 잠시 뒤 다시 시도해 주세요.";
    case "bad-phone": return "휴대폰 번호 형식이 맞지 않습니다 (중국 휴대폰 번호 11자리).";
    case "bad-token": return "토큰 모양이 아닙니다 — 주소를 연 화면의 글자를 통째로 복사해 붙여넣어 주세요.";
    case "bad-password": return "아이디 또는 비밀번호가 맞지 않습니다.";
    case "weak-password": return "비리비리가 비밀번호 변경을 요구했습니다 (안전하지 않은 비밀번호). 비리비리에서 비밀번호를 바꾼 뒤 다시 시도해 주세요.";
    case "captcha": return "로그인에 캡차(사람 확인)가 걸렸습니다 — 이 페이지에선 풀 수 없어요. 직영 서버면 'QR 로그인'으로 해 주세요.";
    case "too-many": return "요청이 너무 잦습니다 — 1~2분 뒤 다시 시도해 주세요.";
    case "no-account": return "그 계정을 찾지 못했습니다.";
    case "token-expired": return "로그인 정보가 만료됐거나 맞지 않습니다 — 처음부터 다시 해 주세요 (QR은 새로 띄우고, 토큰은 새로 복사).";
    case "login-failed":
    case "sync-failed": return "게임 서버 로그인에 실패했습니다 — 게임을 완전히 종료한 뒤 다시 시도해 주세요.";
    default: return `로그인에 실패했습니다 (${code}) — 잠시 뒤 다시 시도해 주세요.`;
  }
}

// 붙여넣은 글자 → 토큰. 화면 전체({"code":0,"data":{"content":"…"},"msg":"接口调用成功"})를 붙여도, content 값만 붙여도 된다
function tokenOf(text: string): string {
  const t = text.trim();
  try {
    const content = (JSON.parse(t) as { data?: { content?: unknown } })?.data?.content;
    if (typeof content === "string") return content;
  } catch { /* JSON 이 아니면 값만 붙인 것 */ }
  return t.replace(/^"|"$/g, "");
}

// QR — 森空岛 앱이 읽는 hypergryph://scan_login?scanId=… 를 그린다 (me-share.tsx 와 같은 라이브러리)
function Qr({ text }: { text: string }) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return (
    <svg className="cns-qr" viewBox={`-3 -3 ${n + 6} ${n + 6}`} shapeRendering="crispEdges" role="img" aria-label="森空岛 로그인 QR">
      <rect x={-3} y={-3} width={n + 6} height={n + 6} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

// 중국어 고유명사 + 작은 주석 — 주석은 보는 언어 하나로 (사용자 확정 2026-10-06. 이 페이지는 한국어 전용이라 한국어)
function Zh({ t, g }: { t: string; g: string }) {
  return <>{t}<small className="cns-gloss" lang="ko">{g}</small></>;
}

type Result = { json: string; level: number; chars: number; stages: number; items: number; rogue: number };

export default function CnSamplePage() {
  const [preview, setPreview] = useState(false);
  useEffect(() => { setPreview(new URLSearchParams(location.search).get("preview") === "closed"); }, []);
  const closed = CLOSED ?? (preview ? { official: 1, bili: 1 } : null);
  return closed ? <CnSampleClosed {...closed} /> : <CnSampleForm />;
}

function CnSampleClosed({ official, bili }: { official: number; bili: number }) {
  return (
    <main className="cns">
      <a className="cns-home" href="/">테라 아카이브</a>
      <h1>중국 서버 계정 데이터 보내기</h1>
      <p className="cns-sub">마감되었습니다</p>
      <section className="cns-box cns-done">
        <h2>도와주셔서 감사합니다!</h2>
        <p>
          총 <b>{official + bili}건</b>의 데이터를 전달받았습니다
          {" "}(<Zh t="官服" g="직영 서버" /> {official}건 · <Zh t="B服" g="비리비리 서버" /> {bili}건).
        </p>
        <p>보내 주신 데이터로 「내 정보」의 중국 서버 지원을 준비하겠습니다. 이 페이지는 이제 닫혀서 더 이상 로그인할 수 없습니다.</p>
      </section>
    </main>
  );
}

function CnSampleForm() {
  const [server, setServer] = useState<CnServer>("cn");
  // 官服: QR(기본 — 森空岛 앱으로 찍는다) · 토큰 붙여넣기 · 휴대폰 번호 + 비밀번호. 한국의 중섭 유저는 중국 휴대폰 문자를 못 받아서
  // 문자 인증코드는 워커만 지원하고 화면엔 안 둔다 (사용자 2026-10-06)
  const [mode, setMode] = useState<"qr" | "token" | "password">("qr");
  const [scan, setScan] = useState<{ id: string; url: string; state: "wait" | "scanned" | "expired" } | null>(null);
  const [token, setToken] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);

  const fail = (e: unknown) => setError(errorText(e instanceof AccountError ? e.code : "internal"));

  const login = async (scanToken?: string) => {
    setError(null);
    setBusy(true);
    setStep(null);
    try {
      const args = server === "bili"
        ? { server, username: username.trim(), password }
        : scanToken ? { server, hgToken: scanToken }
        : mode === "token" ? { server, hgToken: tokenOf(token) } : { server, phone: phone.trim(), password };
      const data = await loginCnSample(args, setStep);
      setPassword("");
      setToken("");
      const profile = (data.profile ?? {}) as { status?: { level?: number }; stages?: object; inventory?: object; rogue?: object };
      const sample = { kind: "terra-archive-cn-sample", version: 1, server, at: new Date().toISOString(), ...data, ok: undefined };
      setResult({
        json: JSON.stringify(sample),
        level: profile.status?.level ?? 0,
        chars: Array.isArray(data.chars) ? data.chars.length : 0,
        stages: Object.keys(profile.stages ?? {}).length,
        items: Object.keys(profile.inventory ?? {}).length,
        rogue: Object.keys(profile.rogue ?? {}).length,
      });
    } catch (e) { fail(e); }
    setStep(null);
    setBusy(false);
  };

  const startScan = async () => {
    setError(null);
    setBusy(true);
    try {
      const s = await startCnScan();
      setScan({ id: s.scanId, url: s.scanUrl, state: "wait" });
    } catch (e) { fail(e); }
    setBusy(false);
  };

  // QR 상태를 2초마다 본다 — 승인되면 그 토큰으로 바로 로그인. 3분이 지나면 만료로 본다
  useEffect(() => {
    if (!scan || scan.state === "expired") return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      if (Date.now() - started > 180_000) { setScan((s) => s && { ...s, state: "expired" }); return; }
      try {
        const r = await pollCnScan(scan.id);
        if (stop) return;
        if (r.state === "done" && r.hgToken) { setScan(null); void login(r.hgToken); return; }
        if (r.state === "expired") { setScan((s) => s && { ...s, state: "expired" }); return; }
        if (r.state === "scanned") setScan((s) => s && s.state !== "scanned" ? { ...s, state: "scanned" } : s);
      } catch (e) {
        if (!stop) { setScan(null); fail(e); }
        return;
      }
      setTimeout(tick, 2000);
    };
    const first = setTimeout(tick, 2000);
    return () => { stop = true; clearTimeout(first); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan?.id, scan?.state === "expired"]);

  // 방법·서버를 바꾸면 띄운 QR 은 버린다
  useEffect(() => { setScan(null); }, [mode, server]);

  // 파일 하나로 — 한도(10MB 미만)를 넘으면 gzip 으로 줄인다
  const sampleFile = async (): Promise<File> => {
    const stamp = new Date().toISOString().slice(0, 10);
    const plain = new Blob([result!.json], { type: "application/json" });
    if (plain.size < FEEDBACK_IMG_MB * 1024 * 1024 - 1024) return new File([plain], `cn-sample-${server}-${stamp}.json`, { type: "application/json" });
    const gz = await new Response(plain.stream().pipeThrough(new CompressionStream("gzip"))).blob();
    return new File([gz], `cn-sample-${server}-${stamp}.json.gz`, { type: "application/gzip" });
  };

  const submit = async () => {
    if (!result) return;
    setError(null);
    setBusy(true);
    try {
      const file = await sampleFile();
      const up = await uploadFeedbackFile(file);
      const label = server === "bili" ? "B服" : "官服";
      const message = `[중섭 계정 샘플 · ${label}] Lv.${result.level} · 오퍼 ${result.chars} · 작전 ${result.stages} · ${fmtFileSize(file.size)}` + (note.trim() ? `\n\n${note.trim()}` : "");
      await sendFeedback("feature", message, { files: [{ url: up.url, name: up.name, size: up.size }], cnSample: { server, level: result.level, chars: result.chars } });
      setSent(true);
    } catch (e) {
      setError(`전송 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  };

  const download = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([result.json], { type: "application/json" }));
    a.download = `cn-sample-${server}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const canLogin = agree && !busy && (server === "bili"
    ? username.trim() && password
    : mode === "qr" ? !scan : mode === "token" ? tokenOf(token).length >= 16 : /^1\d{10}$/.test(phone.trim()) && password);

  return (
    <main className="cns">
      <a className="cns-home" href="/">테라 아카이브</a>
      <h1>중국 서버 계정 데이터 보내기</h1>
      <p className="cns-sub"><Zh t="官服" g="직영 서버" /> · <Zh t="B服" g="비리비리 서버" /> 유저 대상</p>

      <section className="cns-box">
        <p><b>테라 아카이브</b>의 「내 정보」를 중국 서버 계정으로도 쓸 수 있게 준비하고 있습니다. 그런데 개발자에게 중섭 계정이 없어서, 중섭 게임 서버가 주는 데이터의 모양을 확인할 수가 없어요.</p>
        <p>도와주실 분은 여기서 한 번만 로그인해 주세요. <b>계정 데이터가 제안 첨부 파일로 개발자에게 전달되고</b>, 개발 용도로만 씁니다. 감사합니다!</p>
        <ul className="cns-list">
          <li><b>보내는 것:</b> 오퍼레이터·창고·작전 진행·기반시설·공개모집·통합전략 등 게임 데이터</li>
          <li><b>보내지 않는 것:</b> 토큰·휴대폰 번호·비밀번호. 닉네임·UID·자기소개·친구 닉네임도 지우고 보냅니다.</li>
          <li>토큰·휴대폰 번호·비밀번호는 서버가 하이퍼그리프 / <Zh t="B站" g="비리비리" />에 전달만 하고 <b>저장하거나 기록하지 않습니다</b>.</li>
          <li className="cns-warn">⚠ 로그인하면 켜져 있는 게임이 <b>접속 종료</b>됩니다 (계정당 접속 1개). 계정에는 아무 영향이 없고, 게임에 다시 들어가면 됩니다.</li>
        </ul>
      </section>

      {sent ? (
        <section className="cns-box cns-done">
          <h2>보냈습니다. 감사합니다!</h2>
          <p>데이터가 개발자에게 전달됐어요. 이제 게임에 다시 접속하셔도 됩니다.</p>
        </section>
      ) : result ? (
        <section className="cns-box">
          <h2>데이터를 받았습니다</h2>
          <dl className="cns-stats">
            <div><dt>레벨</dt><dd>{result.level}</dd></div>
            <div><dt>오퍼레이터</dt><dd>{result.chars}</dd></div>
            <div><dt>작전 기록</dt><dd>{result.stages}</dd></div>
            <div><dt>아이템 종류</dt><dd>{result.items}</dd></div>
            <div><dt>통합전략</dt><dd>{result.rogue}</dd></div>
            <div><dt>크기</dt><dd>{fmtFileSize(result.json.length)}</dd></div>
          </dl>
          <label className="cns-field">
            <span>남길 말 (선택)</span>
            <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="개발자에게 하고 싶은 말, 바라는 기능 등" />
          </label>
          <div className="cns-actions">
            <button type="button" className="cns-btn cns-pri" disabled={busy} onClick={submit}>{busy ? "보내는 중…" : "개발자에게 보내기"}</button>
            <button type="button" className="cns-btn" disabled={busy} onClick={download}>먼저 내려받아 보기 (JSON)</button>
          </div>
        </section>
      ) : (
        <section className="cns-box">
          <div className="cns-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={server === "cn"} className={server === "cn" ? "on" : ""} onClick={() => setServer("cn")}><Zh t="官服" g="직영 서버" /></button>
            <button type="button" role="tab" aria-selected={server === "bili"} className={server === "bili" ? "on" : ""} onClick={() => setServer("bili")}><Zh t="B服" g="비리비리 서버" /></button>
          </div>

          {server === "cn" ? (
            <>
              <div className="cns-modes">
                <label><input type="radio" checked={mode === "qr"} onChange={() => setMode("qr")} /> QR 로그인 (추천)</label>
                <label><input type="radio" checked={mode === "token"} onChange={() => setMode("token")} /> 토큰 붙여넣기</label>
                <label><input type="radio" checked={mode === "password"} onChange={() => setMode("password")} /> 휴대폰 번호 + 비밀번호</label>
              </div>
              {mode === "qr" ? (
                <>
                  <ol className="cns-how">
                    <li>폰에 <Zh t="森空岛" g="스카이랜드" /> 앱이 있어야 합니다 — 명일방주 계정으로 로그인돼 있으면 됩니다.</li>
                    <li>아래 확인란을 체크하고 <b>QR 띄우기</b>를 누릅니다. 폰으로 찍어야 하니 <b>PC 화면</b>에서 여는 게 편합니다.</li>
                    <li><Zh t="森空岛" g="스카이랜드" /> 앱의 스캔 버튼으로 QR을 찍고, 앱에서 로그인을 승인합니다. 그러면 자동으로 이어집니다.</li>
                  </ol>
                  {scan && (
                    <div className="cns-scan">
                      {scan.state === "expired" ? (
                        <p>QR이 만료됐습니다. 아래 버튼으로 다시 만들어 주세요.</p>
                      ) : (
                        <>
                          <Qr text={scan.url} />
                          <p>{scan.state === "scanned" ? "찍혔습니다 — 앱에서 승인해 주세요…" : <><Zh t="森空岛" g="스카이랜드" /> 앱으로 찍어 주세요 · 기다리는 중…</>}</p>
                          <a className="cns-note" href={scan.url}>이 폰에서 보고 있다면: <Zh t="森空岛" g="스카이랜드" /> 앱으로 바로 열기</a>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : mode === "token" ? (
                <>
                  <ol className="cns-how">
                    <li><a href="https://user.hypergryph.com/login" target="_blank" rel="noopener noreferrer">하이퍼그리프 통행증</a>에 로그인합니다. 이미 로그인돼 있으면 건너뛰세요.</li>
                    <li>같은 브라우저에서 <a href="https://web-api.hypergryph.com/account/info/hg" target="_blank" rel="noopener noreferrer">web-api.hypergryph.com/account/info/hg</a> 를 엽니다.</li>
                    <li>나온 글자 <code>{"{\"code\":0,\"data\":{\"content\":\"…\"}…}"}</code> 를 통째로 복사해 아래에 붙여넣습니다.</li>
                  </ol>
                  <label className="cns-field">
                    <span>토큰</span>
                    <textarea rows={3} spellCheck={false} autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder='{"code":0,"data":{"content":"…"},"msg":"接口调用成功"}' />
                  </label>
                  <p className="cns-note">이 토큰은 계정에 들어갈 수 있는 열쇠입니다 — 여기 말고 다른 곳엔 붙여넣지 마세요. 다 쓰고 나서 통행증에서 로그아웃하면 토큰도 무효가 됩니다.</p>
                </>
              ) : (
                <>
                  <p className="cns-note">문자를 받을 필요는 없습니다 — 통행증 아이디인 휴대폰 번호와 비밀번호만 넣으세요.</p>
                  <label className="cns-field">
                    <span>휴대폰 번호</span>
                    <input inputMode="numeric" autoComplete="username" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="중국 휴대폰 번호 11자리" />
                  </label>
                  <label className="cns-field">
                    <span>비밀번호</span>
                    <input type="password" autoComplete="current-password" maxLength={64} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </label>
                </>
              )}
            </>
          ) : (
            <>
              <p className="cns-note"><Zh t="B服" g="비리비리 서버" />은 <Zh t="B站" g="비리비리" /> 아이디 + 비밀번호 로그인만 됩니다 (문자 인증은 아직 못 붙였어요).</p>
              <label className="cns-field">
                <span><Zh t="B站" g="비리비리" /> 아이디 (휴대폰 번호 / 이메일)</span>
                <input autoComplete="username" maxLength={64} value={username} onChange={(e) => setUsername(e.target.value)} />
              </label>
              <label className="cns-field">
                <span>비밀번호</span>
                <input type="password" autoComplete="current-password" maxLength={64} value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
            </>
          )}

          <label className="cns-agree">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            로그인하면 게임 접속이 끊기고, 계정 데이터가 개발자에게 전달되는 것을 확인했습니다.
          </label>
          {server === "cn" && mode === "qr" ? (
            (!scan || scan.state === "expired") && (
              <button type="button" className="cns-btn cns-pri cns-go" disabled={!agree || busy} onClick={startScan}>{busy ? "로그인 중…" : scan ? "QR 다시 만들기" : "QR 띄우기"}</button>
            )
          ) : (
            <button type="button" className="cns-btn cns-pri cns-go" disabled={!canLogin} onClick={() => login()}>{busy ? "로그인 중…" : "로그인하고 데이터 받기"}</button>
          )}

          {busy && step && (
            <ol className="cns-steps">
              {STEPS.map((s, i) => {
                const at = STEPS.findIndex((x) => x.id === step);
                return <li key={s.id} className={i < at ? "done" : i === at ? "now" : ""}>{s.label}</li>;
              })}
            </ol>
          )}
        </section>
      )}

      {error && <p className="cns-error" role="alert">{error}</p>}
    </main>
  );
}
