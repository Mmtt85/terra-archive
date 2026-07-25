"use client";

// 테라 브리지 실험 페이지 (/bridge) — 크롬 확장이 보내는 게임 창 프레임을 받아
// 기존 스샷 레이더 파이프라인(recognizeShot)에 그대로 태워 본다.
//
// 이 페이지가 답해야 하는 질문 하나: **캡처가 실제로 몇 픽셀을 주는가.**
// v6에서 라이브 공유를 접은 이유가 반해상도였고(app/scan/scanner.tsx 주석),
// 렌즈가 그 해상도에서 사는지는 픽스처 2배 축소 회귀로 "이동 판정 14/17"까지 확인했다.
// 여기서는 진짜 캡처 픽셀로 그 결론을 검증한다.
//
// 확장 없이 열면 설치 안내만 보인다. 아직 실험이라 nav·sitemap에 넣지 않았고,
// 한국어 전용이다 (i18n 사전 대상 아님).

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { LensOutcome } from "../lens/match";

const TAG = "ta-bridge";
type Mode = "rogue" | "recruit" | "story";

type Settings = {
  label: string; width: number; height: number;
  reportedWidth: number | null; reportedHeight: number | null;
  frameRate: number | null; devicePixelRatio: number;
};
type Gate = { phase: string; d: number; ticks: number; emitted: number; moving: number };
type Frame = { url: string; w: number; h: number; d: number; at: number };

export default function BridgePage() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [version, setVersion] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [preview, setPreview] = useState<{ url: string; w: number; h: number } | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("rogue");
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<{ text: string; ms: number; px: string } | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const idRef = useRef(0);
  const modeRef = useRef(mode);
  const autoRef = useRef(auto);
  const busyRef = useRef(false);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { autoRef.current = auto; }, [auto]);

  const say = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString("ko-KR")}  ${line}`, ...prev].slice(0, 40));
  }, []);

  const post = useCallback((type: string, payload?: unknown) => {
    idRef.current += 1;
    window.postMessage({ tag: TAG, dir: "toExt", type, payload, id: idRef.current }, window.location.origin);
  }, []);

  // ── 프레임 인식 — 기존 스샷 파이프라인을 그대로 쓴다 ─────────────────────
  const recognize = useCallback(async (f: Frame) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const t0 = performance.now();
    try {
      const { recognizeShot } = await import("../lens/run");
      const blob = await (await fetch(f.url)).blob();
      // topic(사전확률)은 주지 않는다 — 캡처만으로 어디까지 맞히는지 보려는 실험이라
      const oc = await recognizeShot(modeRef.current, blob, undefined, "ko");
      setVerdict({ text: describe(oc), ms: Math.round(performance.now() - t0), px: `${f.w}×${f.h}` });
      say(`인식 ${modeRef.current} · ${f.w}×${f.h} · ${Math.round(performance.now() - t0)}ms → ${describe(oc)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setVerdict({ text: `실패: ${msg}`, ms: Math.round(performance.now() - t0), px: `${f.w}×${f.h}` });
      say(`인식 실패: ${msg}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [say]);

  // ── 확장에서 오는 메시지 ────────────────────────────────────────────────
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const msg = event.data as { tag?: string; dir?: string; type?: string; payload?: unknown };
      if (!msg || msg.tag !== TAG || msg.dir !== "toPage") return;

      if (msg.type === "hello") {
        const p = msg.payload as { version?: string } | undefined;
        setInstalled(true);
        setVersion(p?.version ?? "");
        return;
      }
      if (msg.type === "ack") {
        const p = msg.payload as { ok?: boolean; error?: string; settings?: Settings } | undefined;
        if (p && p.ok === false) { setError(p.error ?? "알 수 없는 오류"); say(`오류: ${p.error}`); }
        else if (p?.settings) { setSettings(p.settings); setError(""); }
        return;
      }
      if (msg.type === "state") {
        const p = msg.payload as { phase: string; settings?: Settings } & Partial<Gate>;
        if (p.settings) { setSettings(p.settings); say(`캡처 시작 — ${p.settings.width}×${p.settings.height} · ${p.settings.label}`); }
        else setGate({ phase: p.phase, d: p.d ?? 0, ticks: p.ticks ?? 0, emitted: p.emitted ?? 0, moving: p.moving ?? 0 });
        return;
      }
      if (msg.type === "preview") { setPreview(msg.payload as { url: string; w: number; h: number }); return; }
      if (msg.type === "frame") {
        const f = msg.payload as Frame;
        setFrame(f);
        say(`새 화면 감지 — ${f.w}×${f.h} (차이 ${f.d})`);
        if (autoRef.current) void recognize(f);
        return;
      }
      if (msg.type === "ended") { setSettings(null); setGate(null); say("공유가 중지되었습니다"); }
    };
    window.addEventListener("message", onMessage);
    // 확장이 있는지 물어본다 (콘텐츠 스크립트가 먼저 인사했더라도 무해)
    idRef.current += 1;
    window.postMessage({ tag: TAG, dir: "toExt", type: "ping", id: idRef.current }, window.location.origin);
    const t = window.setTimeout(() => setInstalled((v) => (v === null ? false : v)), 1200);
    return () => { window.removeEventListener("message", onMessage); window.clearTimeout(t); };
  }, [recognize, say]);

  const connected = !!settings;

  return (
    <main style={S.page}>
      <h1 style={S.h1}>테라 브리지 <span style={S.tag}>실험</span></h1>
      <p style={S.lead}>
        크롬 확장이 게임 창을 캡처해 이 페이지로 보냅니다. 인식은 스샷 레이더와 <b>같은 파이프라인</b>을 씁니다.
        확인할 것은 하나 — <b>캡처가 실제로 몇 픽셀을 주는가</b>.
      </p>

      {installed === false && (
        <div style={S.warn}>
          <b>확장이 감지되지 않았습니다.</b>
          <ol style={S.ol}>
            <li>크롬에서 <code>chrome://extensions</code> 열기</li>
            <li>우측 상단 <b>개발자 모드</b> 켜기</li>
            <li><b>압축해제된 확장 프로그램을 로드합니다</b> → 이 리포의 <code>extension/</code> 폴더 선택</li>
            <li>이 페이지 새로고침</li>
          </ol>
          <p style={S.note}>macOS는 첫 캡처 때 시스템 설정 → 개인정보 보호 → 화면 기록에서 Chrome을 허용해야 합니다.</p>
        </div>
      )}

      {installed && (
        <div style={S.row}>
          <button style={connected ? S.btnOff : S.btn} onClick={() => post(connected ? "stop" : "start")}>
            {connected ? "연결 끊기" : "게임 창 연결"}
          </button>
          <span style={S.dim}>확장 v{version}</span>
          {error && <span style={S.err}>{error}</span>}
        </div>
      )}

      {settings && (
        <section style={S.card}>
          <h2 style={S.h2}>캡처 해상도 <span style={S.dim}>— 이 실험의 핵심 숫자</span></h2>
          <div style={S.grid}>
            <Cell k="실제 프레임" v={`${settings.width} × ${settings.height}`} big />
            <Cell k="트랙 신고값" v={settings.reportedWidth ? `${settings.reportedWidth} × ${settings.reportedHeight}` : "—"} />
            <Cell k="프레임레이트" v={settings.frameRate ? `${Math.round(settings.frameRate)} fps` : "—"} />
            <Cell k="devicePixelRatio" v={String(settings.devicePixelRatio)} />
          </div>
          <p style={S.note}>
            소스: {settings.label || "(이름 없음)"} · devicePixelRatio가 2인데 실제 프레임이 창 크기와 같다면
            <b> 반해상도</b>입니다. 회귀 실측 기준 <b>960×540 이상이면 이동 판정은 통과</b>합니다.
          </p>
        </section>
      )}

      {settings && (
        <section style={S.card}>
          <h2 style={S.h2}>변화 게이트</h2>
          <div style={S.grid}>
            <Cell k="상태" v={PHASE[gate?.phase ?? ""] ?? "대기"} big />
            <Cell k="틱" v={String(gate?.ticks ?? 0)} />
            <Cell k="전송한 프레임" v={String(gate?.emitted ?? 0)} />
            <Cell k="움직임 감지" v={String(gate?.moving ?? 0)} />
          </div>
          <p style={S.note}>
            전투·전환처럼 화면이 움직이는 동안은 아무것도 하지 않습니다. 두 틱 연속 정지하고,
            마지막으로 보낸 화면과 충분히 다를 때만 원본 프레임 한 장을 보냅니다.
            <b> 전송한 프레임 수가 틱 수보다 훨씬 작아야</b> 게이트가 제 일을 하는 겁니다.
          </p>
        </section>
      )}

      {settings && (
        <section style={S.card}>
          <h2 style={S.h2}>인식</h2>
          <div style={S.row}>
            {(["rogue", "recruit", "story"] as Mode[]).map((m) => (
              <button key={m} style={mode === m ? S.chipOn : S.chip} onClick={() => setMode(m)}>
                {MODE_LABEL[m]}
              </button>
            ))}
            <label style={S.check}>
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> 새 화면마다 자동 인식
            </label>
            <button style={S.btnSm} disabled={!frame || busy} onClick={() => frame && void recognize(frame)}>
              지금 프레임 인식
            </button>
          </div>
          {busy && <p style={S.note}>인식 중…</p>}
          {verdict && (
            <div style={S.verdict} data-t="verdict">
              <div style={S.verdictText}>{verdict.text}</div>
              <div style={S.dim}>{verdict.px} · {verdict.ms}ms</div>
            </div>
          )}
        </section>
      )}

      {(preview || frame) && (
        <section style={S.card}>
          <h2 style={S.h2}>화면</h2>
          <div style={S.shots}>
            {preview && (
              <figure style={S.fig}>
                <img src={preview.url} alt="라이브 미리보기" style={S.img} />
                <figcaption style={S.cap}>라이브 미리보기 (진단용 축소)</figcaption>
              </figure>
            )}
            {frame && (
              <figure style={S.fig}>
                <img src={frame.url} alt="마지막 전송 프레임" style={S.img} />
                <figcaption style={S.cap}>인식에 쓴 프레임 — 원본 {frame.w}×{frame.h}</figcaption>
              </figure>
            )}
          </div>
        </section>
      )}

      {!!log.length && (
        <section style={S.card}>
          <h2 style={S.h2}>기록</h2>
          <pre style={S.log}>{log.join("\n")}</pre>
        </section>
      )}
    </main>
  );
}

const MODE_LABEL: Record<Mode, string> = { rogue: "통합전략", recruit: "공개모집", story: "스토리 대사" };
const PHASE: Record<string, string> = {
  moving: "움직이는 중 (무시)", settling: "안착 중", same: "같은 화면 (무시)", emit: "새 화면 → 전송", started: "시작됨",
};

/** LensOutcome을 한 줄로 — 어디로 이동할지와 근거 엔티티. */
function describe(oc: LensOutcome): string {
  const ents = oc.entities.slice(0, 4).map((e) => e.name).join(", ");
  if (oc.target.kind === "none") return `판정 없음${ents ? ` (스친 이름: ${ents})` : ""}`;
  if (oc.target.kind === "tie") {
    return `되묻기 — ${oc.target.options.map((o) => o.topicName).join(" / ")}${ents ? ` · ${ents}` : ""}`;
  }
  const g = oc.target.goto;
  if (g.page === "recruit") return `공개모집 태그 [${g.tags.join(", ")}]`;
  if (g.page === "story") return `스토리 ${g.id} ep${g.ep ?? "?"} (표 ${g.hits})`;
  const bits = [g.topic, g.view];
  if (g.modal) bits.push(`${g.modal.type}:${g.modal.id}`);
  if (g.grade != null) bits.push(`난이도 ${g.grade}`);
  return `${bits.join(" · ")}${ents ? ` — ${ents}` : ""}`;
}

function Cell({ k, v, big }: { k: string; v: string; big?: boolean }) {
  return (
    <div style={S.cell}>
      <div style={S.cellK}>{k}</div>
      <div style={big ? S.cellVBig : S.cellV}>{v}</div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto", padding: "32px 20px 80px", lineHeight: 1.6 },
  h1: { fontSize: 26, fontWeight: 700, margin: "0 0 8px" },
  tag: { fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--line)", verticalAlign: "middle", marginLeft: 8, opacity: 0.7 },
  lead: { margin: "0 0 20px", opacity: 0.85 },
  card: { border: "1px solid var(--line)", borderRadius: 10, padding: "16px 18px", margin: "0 0 16px", background: "var(--bg-panel)" },
  h2: { fontSize: 15, fontWeight: 700, margin: "0 0 12px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 },
  cell: { border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-faint)" },
  cellK: { fontSize: 11, opacity: 0.6, marginBottom: 2 },
  cellV: { fontSize: 15, fontVariantNumeric: "tabular-nums" },
  cellVBig: { fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  row: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "0 0 14px" },
  btn: { padding: "9px 18px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg-soft)", cursor: "pointer", fontWeight: 600, fontSize: 14, color: "inherit" },
  btnOff: { padding: "9px 18px", borderRadius: 8, border: "1px solid var(--line)", background: "transparent", cursor: "pointer", fontSize: 14, color: "inherit", opacity: 0.75 },
  btnSm: { padding: "5px 12px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--bg-soft)", cursor: "pointer", fontSize: 13, color: "inherit" },
  chip: { padding: "5px 12px", borderRadius: 999, border: "1px solid var(--line)", background: "transparent", cursor: "pointer", fontSize: 13, color: "inherit" },
  chipOn: { padding: "5px 12px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--bg-soft2)", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "inherit" },
  check: { display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, opacity: 0.85 },
  verdict: { marginTop: 12, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg-faint)" },
  verdictText: { fontSize: 15, fontWeight: 600, wordBreak: "keep-all" },
  warn: { border: "1px solid var(--line)", borderRadius: 10, padding: "14px 18px", margin: "0 0 16px", background: "var(--bg-soft2)" },
  ol: { margin: "8px 0 4px", paddingLeft: 20 },
  note: { fontSize: 12.5, opacity: 0.7, margin: "10px 0 0" },
  dim: { fontSize: 12.5, opacity: 0.6 },
  err: { fontSize: 13, color: "#c0392b" },
  shots: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 },
  fig: { margin: 0 },
  img: { width: "100%", borderRadius: 8, border: "1px solid var(--line)", display: "block" },
  cap: { fontSize: 12, opacity: 0.65, marginTop: 6 },
  log: { fontSize: 12, lineHeight: 1.7, margin: 0, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
};
