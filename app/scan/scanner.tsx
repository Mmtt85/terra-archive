"use client";

// 오퍼 보유 스캐너 UI (v6) — 오퍼 목록 "스크린샷"을 받아 인식한다. 입력 3경로:
// ① 클립보드 자동 감지(⌃⌘⇧4 캡처 후 이 탭에 돌아오면 자동 인식) ② ⌘V 붙여넣기
// ③ 파일 드래그&드롭/선택. 화면 공유(getDisplayMedia) 라이브 캡처는 v6에서 제거 —
// Chrome이 환경에 따라 절반해상도 흐린 프레임을 고집해(2026-07-23 라이브 검증) 인식이
// 붕괴하는 반면, 스크린샷 픽셀은 픽스처 152셀 식별·정예화 100%로 검증된 경로다.
// 파이프라인: 자동 격자 → 별 성급 → 카드 아트 ↔ 초상(스킨 포함) masked ZNCC →
// 정예화 엠블럼 3-way (scripts/verify-scan.ts). 100% 클라이언트 처리.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { T } from "../i18n";
import { ops, opById, maxElite, ELITE_LABEL, type Elite, type InfraOp } from "../planner-engine";
import { normSearch } from "../search";
import { scanFrame } from "./vision";
import { toGray, matchArt, classifyElite } from "./artmatch";

interface Detected {
  id: string;
  op: InfraOp;
  score: number;       // 아트 ZNCC
  margin: number;      // 타 오퍼와의 점수 차
  pid: string;         // 인식된 초상(스킨) id — 진단용
  confident: boolean;
  seen: number;        // 몇 번 인식됐나
  rarity: number;
  cls: string;
  elite: Elite;        // 엠블럼 자동 인식 (성급 상한 클램프) — 배지로 수동 수정 가능
  eliteManual: boolean; // 사용자가 손으로 고쳤으면 이후 스캔이 덮어쓰지 않음
}

// 신뢰 판정(픽스처 152셀 실측: 정답 최저 0.80/마진 최저 0.11, 오답 최고 0.75)
const SCORE_MIN = 0.55;      // 미만이면 검출 자체를 버림
const CONFIDENT_SCORE = 0.8;
const CONFIDENT_MARGIN = 0.05;

const STAR = "★";
const MAX_W = 1600; // 처리 해상도 상한(레티나 스크린샷 과대해상도 대비 속도)

type ClipState = "init" | "on" | "off";

export function ScannerModal({ t, onClose, onApply }: {
  t: T;
  onClose: () => void;
  onApply: (dets: { id: string; elite: Elite }[]) => void;
}) {
  const busy = useRef(false);
  const [recognizing, setRecognizing] = useState(false);
  const [frameInfo, setFrameInfo] = useState("");
  const [results, setResults] = useState<Map<string, Detected>>(new Map());
  const resultsRef = useRef(results);
  useEffect(() => { resultsRef.current = results; }, [results]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [addQuery, setAddQuery] = useState("");
  const [clip, setClip] = useState<ClipState>("init");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastClipHash = useRef("");

  // ── 프레임 1장 인식 코어 (픽스처 검증과 동일 경로) ───────────────────────────
  const recognizeFrameData = useCallback((frame: ImageData, capLabel: string) => {
    const W = frame.width, H = frame.height;
    const scan = scanFrame({ data: frame.data, width: W, height: H });
    setFrameInfo(`v6 · ${capLabel} · ` + t("격자 {c}열 · px {p} · 행 {r}", { c: String(scan.cols.length), p: String(scan.px), r: scan.rows.join(",") }));

    const g = toGray({ data: frame.data, width: W, height: H });
    const next = new Map(resultsRef.current);
    for (const cell of scan.cells) {
      if (cell.rarity < 1) continue;
      const am = matchArt(g, cell.sx, cell.ry, scan.px);
      if (!am || am.best.score < SCORE_MIN) continue;
      const op = opById.get(am.best.op);
      if (!op) continue;
      const el = classifyElite(g, cell.sx, cell.ry, scan.px);
      const elite = Math.min(el.elite, maxElite(op.rarity)) as Elite;
      const confident = am.best.score >= CONFIDENT_SCORE && am.margin >= CONFIDENT_MARGIN;
      // 진단용 — 셀별 매칭 결과 (개발자도구 콘솔)
      console.debug(`[scan] r${cell.row}c${cell.col} ${cell.rarity}★${cell.cls} → ${op.name} ${am.best.score.toFixed(3)} 마진${am.margin.toFixed(3)} E${elite}[${el.s1.toFixed(2)}/${el.s2.toFixed(2)}] ${am.best.pid}`);
      const prev = next.get(op.id);
      if (!prev || am.best.score > prev.score) {
        next.set(op.id, {
          id: op.id, op, score: am.best.score, margin: am.margin, pid: am.best.pid,
          confident: confident || (prev?.confident ?? false), seen: (prev?.seen ?? 0) + 1,
          rarity: cell.rarity, cls: cell.cls,
          elite: prev?.eliteManual ? prev.elite : elite,
          eliteManual: prev?.eliteManual ?? false,
        });
      } else {
        next.set(op.id, { ...prev, seen: prev.seen + 1, confident: prev.confident || confident });
      }
    }
    setResults(next);
  }, [t]);

  // ── 이미지(File/Blob)들 인식 ─────────────────────────────────────────────────
  const recognizeFiles = useCallback(async (files: Iterable<File>) => {
    if (busy.current) return;
    busy.current = true; setRecognizing(true);
    try {
      for (const f of files) {
        if (!f.type.startsWith("image/")) continue;
        const bmp = await createImageBitmap(f);
        const scale = Math.min(1, MAX_W / bmp.width);
        const W = Math.round(bmp.width * scale), H = Math.round(bmp.height * scale);
        const c = document.createElement("canvas");
        c.width = W; c.height = H;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0, W, H);
        bmp.close();
        recognizeFrameData(ctx.getImageData(0, 0, W, H), f.name);
      }
    } finally {
      busy.current = false; setRecognizing(false);
    }
  }, [recognizeFrameData]);

  // ── ⌘V 붙여넣기 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length) { e.preventDefault(); void recognizeFiles(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [recognizeFiles]);

  // ── 클립보드 자동 감지 ───────────────────────────────────────────────────────
  // 에뮬레이터에서 클립보드 캡처(⌃⌘⇧4) → 이 탭으로 돌아오면 새 이미지를 자동 인식.
  // 같은 클립보드를 중복 처리하지 않도록 크기+샘플 바이트 해시로 판별.
  // 권한: granted면 폴링, prompt면 1회 read()로 권한 요청, denied/미지원이면 ⌘V·드롭 안내.
  useEffect(() => {
    let iv: number | undefined;
    let disposed = false;

    const tick = async () => {
      if (disposed || busy.current || !document.hasFocus()) return;
      try {
        const items = await navigator.clipboard.read();
        if (disposed) return;
        setClip("on");
        for (const it of items) {
          const type = it.types.find((tp) => tp.startsWith("image/"));
          if (!type) continue;
          const blob = await it.getType(type);
          const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
          let h = `${blob.size}:${type}:`;
          for (let i = 0; i < head.length; i += 997) h += head[i].toString(36);
          if (h === lastClipHash.current) continue;
          lastClipHash.current = h;
          await recognizeFiles([new File([blob], t("클립보드 스크린샷"), { type })]);
        }
      } catch {
        if (!disposed) setClip((c) => (c === "on" ? "on" : "off"));
      }
    };
    const startPolling = () => { if (iv === undefined) iv = window.setInterval(() => { void tick(); }, 1000); };

    (async () => {
      try {
        const st = await navigator.permissions.query({ name: "clipboard-read" as PermissionName });
        const apply = () => {
          if (disposed) return;
          if (st.state === "granted") { setClip("on"); startPolling(); }
          else if (st.state === "prompt") { void tick(); } // 권한 프롬프트 1회 유도
          else setClip("off");
        };
        st.addEventListener("change", apply);
        apply();
      } catch {
        // permissions API 미지원(사파리 등) — 1회 시도 후 실패 시 ⌘V/드롭 폴백
        await tick();
        if (!disposed) startPolling();
      }
    })();

    return () => { disposed = true; if (iv !== undefined) clearInterval(iv); };
  }, [recognizeFiles, t]);

  // ── 결과 목록 ────────────────────────────────────────────────────────────────
  const kept = useMemo(() => Array.from(results.values()).filter((d) => !removed.has(d.id)), [results, removed]);
  const sorted = useMemo(() => [...kept].sort((a, b) =>
    (Number(b.confident) - Number(a.confident)) || (b.op.rarity - a.op.rarity) || (b.score - a.score)), [kept]);
  const confidentCount = kept.filter((d) => d.confident).length;
  const uncertainCount = kept.length - confidentCount;

  const addManual = useCallback((id: string) => {
    const op = opById.get(id);
    if (!op) return;
    setResults((prev) => {
      const n = new Map(prev);
      if (!n.has(id)) n.set(id, { id, op, score: 1, margin: 1, pid: "", confident: true, seen: 0, rarity: op.rarity, cls: op.job, elite: maxElite(op.rarity), eliteManual: false });
      return n;
    });
    setRemoved((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setAddQuery("");
  }, []);

  // 정예화 토글 (0→1→2→0, 성급 상한까지만)
  const cycleElite = useCallback((id: string) => {
    setResults((prev) => {
      const d = prev.get(id);
      if (!d) return prev;
      const cap = maxElite(d.op.rarity);
      const n = new Map(prev);
      n.set(id, { ...d, elite: (d.elite >= cap ? 0 : ((d.elite + 1) as Elite)), eliteManual: true });
      return n;
    });
  }, []);

  const addMatches = useMemo(() => {
    const q = normSearch(addQuery);
    if (q.length < 1) return [];
    return ops.filter((o) => normSearch(o.name).includes(q) && !results.has(o.id)).slice(0, 6);
  }, [addQuery, results]);

  const onDropFiles = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) void recognizeFiles(e.dataTransfer.files);
  }, [recognizeFiles]);

  return (
    <section className="operator-modal scanner-modal" role="dialog" aria-modal="true" aria-label={t("보유 오퍼 스캔")}
      onDragOver={(e) => e.preventDefault()} onDrop={onDropFiles}>
      <header className="scanner-head">
        <h2>{t("보유 오퍼 스캔")} <span className="scanner-ver">v6</span></h2>
        <button className="modal-close" onClick={onClose} aria-label={t("닫기")}>✕</button>
      </header>
      <input ref={fileInputRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { if (e.target.files?.length) void recognizeFiles(e.target.files); e.target.value = ""; }} />

      <div className="scanner-body">
        <div className="scanner-stage">
          <div className="scanner-dropzone" onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0}>
            {recognizing ? t("인식 중…") : t("여기에 오퍼 목록 스크린샷을 끌어놓거나, 클릭해서 파일을 추가하세요 (여러 장 가능)")}
          </div>
          <div className="scanner-controls">
            <button className="scanner-primary" onClick={() => fileInputRef.current?.click()} disabled={recognizing}>
              {recognizing ? t("인식 중…") : t("스크린샷 추가")}
            </button>
            {clip === "on" && <span className="scanner-clip-on">{t("클립보드 자동 인식 켜짐")}</span>}
            {clip === "off" && <span className="scanner-clip-off">{t("클립보드 자동 읽기가 막혀 있어요 — 스크린샷을 ⌘V로 붙여넣거나 파일을 끌어놓으세요")}</span>}
            {frameInfo && <span className="scanner-frame-info">{frameInfo}</span>}
          </div>
          <ul className="scanner-tips">
            <li>{t("에뮬레이터의 오퍼레이터 목록을 화면마다 캡처하세요 — 맥은 ⌃⌘⇧4(클립보드로 캡처)가 편합니다. 캡처 후 이 탭으로 돌아오면 자동으로 인식됩니다.")}</li>
            <li>{t("정예화(0/1/2정)는 카드 엠블럼으로 자동 인식됩니다 — 잘못 읽힌 오퍼만 이름 옆 배지를 눌러 고치세요.")}</li>
            <li>{t("모든 인식은 100% 브라우저 안에서 처리되며 이미지는 서버로 전송되지 않습니다.")}</li>
          </ul>
        </div>

        <div className="scanner-results">
          <div className="scanner-results-head">
            <strong>{t("인식된 오퍼 {n}명", { n: String(kept.length) })}</strong>
            <span className="scanner-badge-ok">{t("확실 {n}", { n: String(confidentCount) })}</span>
            {uncertainCount > 0 && <span className="scanner-badge-warn">{t("확인 필요 {n}", { n: String(uncertainCount) })}</span>}
          </div>

          <div className="scanner-add">
            <input value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder={t("빠진 오퍼 직접 추가 (이름 검색)")} />
            {addMatches.length > 0 && (
              <div className="scanner-add-list">
                {addMatches.map((o) => (
                  <button key={o.id} onClick={() => addManual(o.id)}>
                    <img src={o.image} alt="" width={28} height={28} />{o.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="scanner-grid">
            {sorted.map((d) => (
              <div key={d.id} className={`scanner-card${d.confident ? "" : " uncertain"}`} title={`${d.op.name} · ${d.score.toFixed(2)}/${d.margin.toFixed(2)} · ${d.seen}회${d.pid ? ` · ${d.pid}` : ""}`}>
                <img src={d.op.image} alt="" width={44} height={44} loading="lazy" />
                <div className="scanner-card-info">
                  <span className="scanner-card-name">{d.op.name}</span>
                  <span className="scanner-card-meta">{STAR.repeat(d.op.rarity)} · {d.op.job}{d.confident ? "" : ` · ${t("확인 필요")}`}</span>
                </div>
                <button className={`scanner-elite e${d.elite}`} onClick={() => cycleElite(d.id)}
                  disabled={maxElite(d.op.rarity) === 0} title={t("정예화 단계 (눌러서 변경)")}>{ELITE_LABEL[d.elite]}</button>
                <button className="scanner-card-x" onClick={() => setRemoved((prev) => new Set(prev).add(d.id))} aria-label={t("제거")}>✕</button>
              </div>
            ))}
            {sorted.length === 0 && <p className="scanner-empty">{t("아직 인식된 오퍼가 없습니다. 오퍼 목록 스크린샷을 추가하면 자동으로 인식됩니다.")}</p>}
          </div>
        </div>
      </div>

      <footer className="scanner-foot">
        <button onClick={onClose}>{t("취소")}</button>
        <button className="scanner-primary" disabled={kept.length === 0}
          onClick={() => onApply(kept.map((d) => ({ id: d.id, elite: d.elite })))}>
          {t("{n}명 보유로 추가", { n: String(kept.length) })}
        </button>
      </footer>
    </section>
  );
}
