"use client";

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ScriptData } from "./story";
import { asset } from "./assets";
import { useI18n } from "./i18n";
import { ModalWindow } from "./modal-window";

// ── 기록 원문 모달 — 엔딩북 조각·방문객 장면의 스토리 전문 (사용자 요청 2026-08-17
// "하나씩 볼 수 있게"). /rogue/record/<rid>.json 을 열 때 지연 로드, 현재 로케일 텍스트
// 우선(없으면 ko → cn 폴백 — IS6은 cn뿐이라 중국어 원문 표시). ────────────────
// 문단은 두 종류다 — **산문은 문자열, 대사는 {c,n,x}** (IS1 월간 친목회 기록만 원문이
// 대화 스크립트다. 종전엔 [Dialog(head=…)] 명령이 그대로 화면에 찍혔다 — 사용자 제보
// 2026-09-06 "팬텀록라 전시관 방문객 기록이 뭔가 이상하다").
type RecLine = string | { c?: string; n?: string; x: string };

// 긴 산문 문단은 문장 경계에서 끊어 여러 문단으로 보인다 (사용자 지적 2026-10-18 "눈아파 줄바꿈좀") —
// 원문은 한 문단 600자 넘는 것도 있다. 따옴표 안에서는 끊지 않고, 조각이 너무 짧아지지 않게 문장을 모은다.
const SPLIT_OVER = 220, CHUNK_MIN = 110;
function splitPara(p: string): string[] {
  if (p.length <= SPLIT_OVER) return [p];
  const out: string[] = [];
  let cur = "", depth = 0;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    cur += ch;
    if ("“「『（(".includes(ch)) depth++;
    else if ("”」』）)".includes(ch)) depth = Math.max(0, depth - 1);
    const end = /[.!?。！？]/.test(ch) && !/[.!?。！？…”」』）)]/.test(p[i + 1] ?? "");
    if (end && depth === 0 && cur.trim().length >= CHUNK_MIN && p.length - i - 1 >= CHUNK_MIN / 2) {
      out.push(cur.trim()); cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// kind = 머리의 작은 꼬리표 — 기본 '기록', 엔딩 연출 스토리는 '엔딩 스토리' (2026-10-18)
export function RecordModal({ rid, title, sub, kind, onClose }: { rid: string; title: string; sub?: string; kind?: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [paras, setParas] = useState<RecLine[] | null>(null);
  const [zh, setZh] = useState(false);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(asset(`/rogue/record/${rid}.json`))
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: Record<string, RecLine[]>) => {
        if (!alive) return;
        const pick = d[locale] ?? d.ko ?? d.cn ?? d.en;
        if (pick) { setZh(!d[locale] && !d.ko); setParas(pick); } else setErr(true);
      })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [rid, locale]);
  return (
    <ModalWindow label={title} className="rg-modal rg-recmodal" onClose={onClose}>
      <header className="rg-modal-head">
        <div>
          <span className="rg-kind">{kind ?? t("기록")}</span>
          <h3><span className="rg-modal-title">{title}</span></h3>
          {sub && <span className="rg-modal-zone">{sub}</span>}
        </div>
      </header>
      <div className="rg-rec-body" lang={zh ? "zh" : undefined}>
        {err ? <p className="rg-rec-status">{t("기록을 불러오지 못했습니다.")}</p>
          : paras === null ? <p className="rg-rec-status">{t("기록 불러오는 중…")}</p>
            : paras.map((p, i) => {
              if (typeof p === "string") return splitPara(p).map((s, j) => <p key={`${i}.${j}`}>{s}</p>);
              if (!p.n) return <p key={i}>{p.x}</p>;
              // 같은 화자가 이어지면 이름을 생략한다 (스토리 전문 뷰 .sc-line.cont 와 같은 규약)
              const prev = paras[i - 1];
              const cont = typeof prev === "object" && prev.n === p.n;
              return (
                <p key={i} className={cont ? "rg-rec-say cont" : "rg-rec-say"}>
                  {!cont && (
                    <span className="rg-rec-who">
                      {p.c && <img src={asset(`/avatars/${p.c}.webp`)} alt="" width={180} height={180}
                        loading="lazy" decoding="async" />}
                      {p.n}
                    </span>
                  )}
                  {p.x}
                </p>
              );
            })}
      </div>
    </ModalWindow>
  );
}


// ── 엔딩 연출 스토리 — 스토리 리더기로 (사용자 요청 2026-10-18 "엔딩 스토리도 스토리 리더기 붙일 수 있어") ──
// public/rogue/endstory/<locale>/<id>.json = {id, recs:[{lines, vn?, au?}], faces} — 오퍼 기록(밀록)과 같은 모양이라
// 같은 ScriptReader 를 창으로 연다 (home.tsx RecordSection 과 같은 짜임). story 청크는 열 때만 받는다.
// 흑류수해(중섭 선행)는 중국어 원문을 AI 가 번역한 비공식 텍스트라 안내를 붙인다.
const StoryScriptReader = lazy(() => import("./story").then((m) => ({ default: m.ScriptReader })));
// ?v= — 파일을 고치면 올린다. R2 에 올리기 전에 열어 본 주소는 옛 판이 엣지에 4시간 남는다
const ENDSTORY_VER = "2026101802";
type EndStoryDoc = { id: string; recs: { lines: ScriptData["eps"][number]["lines"]; vn?: ScriptData["eps"][number]["vn"]; au?: ScriptData["eps"][number]["au"] }[]; faces?: Record<string, string> };

// className — 통합전략 가이드에서 열면 'rg-modal rg-storymodal'(테마 색, 사용자 지시 2026-10-18), 내 정보에선 기본
export function EndingStoryModal({ rid, title, onClose, className }: { rid: string; title: string; onClose: () => void; className?: string }) {
  const { t, locale } = useI18n();
  const [doc, setDoc] = useState<EndStoryDoc | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const get = (loc: string) => fetch(asset(`/rogue/endstory/${loc}/${rid}.json?v=${ENDSTORY_VER}`)).then((r) => (r.ok ? r.json() : null));
    get(locale).then((d) => d ?? (locale === "ko" ? null : get("ko")))
      .then((d: EndStoryDoc | null) => { if (!alive) return; if (d?.recs?.length) setDoc(d); else setErr(true); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [rid, locale]);
  const script = useMemo<ScriptData | null>(() => (doc
    ? { id: `${rid}-end`, eps: [{ code: "", name: title, tag: "", lines: doc.recs[0].lines,
        ...(doc.recs[0].vn ? { vn: doc.recs[0].vn } : {}), ...(doc.recs[0].au ? { au: doc.recs[0].au } : {}) }], faces: doc.faces }
    : null), [doc, rid, title]);
  return (
    <ModalWindow label={`${t("엔딩 스토리")} · ${title}`} className={className ?? "op-record-modal"} onClose={onClose}>
      {/rogue6_/.test(rid) && <p className="future-note">{t("중국 서버 선행 엔딩입니다 — 중국어 원문을 AI가 번역한 비공식 텍스트라 정식 출시 시 공식 번역과 다를 수 있습니다.")}</p>}
      {err ? <p className="no-detail">{t("기록을 불러오지 못했습니다.")}</p>
        : !script ? <p className="no-detail">{t("불러오는 중…")}</p>
          : (
            <Suspense fallback={<p className="no-detail">{t("불러오는 중…")}</p>}>
              <StoryScriptReader script={script} error={false} entities={[]} withPrefs withScene />
            </Suspense>
          )}
    </ModalWindow>
  );
}

// ── 엔딩 상세 창 — 통합전략 가이드와 내 정보가 같이 쓴다 (사용자 지시 2026-10-18 "내 정보에서도 리뉴얼된 엔딩 창") ──
// 그림 머리(번호·최종 보스·이름·달성·인용구·설명·엔딩 스토리) + 진입 조건(점과 선 단계) + 해금 스토리(가로 칸).
// className — 가이드는 'rg-modal rg-endmodal', 내 정보는 테마 색을 받으려고 'rg-themed rgN' 을 덧붙인다(globals.css 토큰 블록)
function splitSteps(c: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (let i = 0; i < c.length; i += 1) {
    const ch = c[i];
    if ("(（[［".includes(ch)) depth += 1;
    else if (")）]］".includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === "→" && depth === 0 && /\s/.test(c[i - 1] ?? "") && /\s/.test(c[i + 1] ?? "")) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}
// 엔딩별 최종 보스 — 그 엔딩으로 가는 험난한 길(boss 작전, end = 엔딩 번호) 중 가장 깊은 층의 첫 BOSS 적.
// 이름은 '이름, 별칭'(프레몬트, 모든 생각의 해답) — 칩에 둘 다 적는다 (사용자 지시 2026-10-18 "보스 이름 별명도 다 적어 줘").
// 가이드(rogue.tsx)와 내 정보(me.tsx)가 같이 쓴다
export type EndingBoss = { short: string; epithet: string; full: string };
export function endingBosses(doc: {
  endings: { id: string }[];
  stages?: { kind?: string | null; end?: number | null; var?: unknown; side?: unknown; zone?: number | null; enemies?: { key: string }[] | null }[];
  enemies?: Record<string, { rank?: string | null; name?: string | null }>;
}): Map<string, EndingBoss> {
  const m = new Map<string, EndingBoss>();
  const stages = doc.stages ?? [];
  const enemies = doc.enemies ?? {};
  doc.endings.forEach((e, i) => {
    const top = stages.filter((st) => st.kind === "boss" && st.end === i + 1 && !st.var && !st.side)
      .sort((a, b) => (b.zone ?? 0) - (a.zone ?? 0))[0];
    for (const x of top?.enemies ?? []) {
      const en = enemies[x.key] ?? enemies[x.key.replace(/_\d+$/, "")];
      if (en?.rank !== "BOSS" || !en.name) continue;
      const strip = (v: string) => v.replace(/^[\s'‘’"“”「」『』]+|[\s'‘’"“”「」『』]+$/g, "");
      const [head, ...rest] = en.name.split(/,\s*|，/);
      m.set(e.id, { short: strip(head) || en.name, epithet: strip(rest.join(", ")), full: en.name });
      break;
    }
  });
  return m;
}
export function BossChip({ boss }: { boss: EndingBoss }) {
  return <span className="rg-ending-boss" title={boss.full}>{boss.short}{boss.epithet && <small>{boss.epithet}</small>}</span>;
}

export type EndingCard = {
  id: string; name: string; cn?: string; pic?: string | null; change?: string | null; desc?: string | null; avg?: string;
  cond?: string[]; book?: { name?: string; cn?: string; cond?: string; rid?: string; txt?: boolean | 1 }[];
};
export function EndingWindow({ e, index, className, boss, done, bookGot, renderCond, onOpenStory, onOpenRecord, onClose, extra }: {
  e: EndingCard; index: number; className?: string;
  boss?: EndingBoss | null;
  /** 달성 여부 — undefined 면 꼬리표를 안 단다 */ done?: boolean;
  /** 해금 스토리 해금 여부 — 없으면 꼬리표를 안 단다 */ bookGot?: (rid: string) => boolean;
  renderCond?: (text: string) => React.ReactNode;
  onOpenStory?: (rid: string, title: string) => void;
  onOpenRecord?: (rid: string, title: string, sub: string) => void;
  onClose: () => void;
  /** 머리 아래에 덧붙일 줄 (내 정보: 도달 횟수·최고 난이도) */ extra?: React.ReactNode;
}) {
  const { t } = useI18n();
  const title = e.cn ? `${e.cn} ${e.name}` : e.name;
  const nm = (name: string, cn?: string) => (cn ? <><span lang="zh">{cn}</span><span className="rg-sub">{name}</span></> : <>{name}</>);
  const cond = renderCond ?? ((c: string) => c);
  return (
    <ModalWindow key={e.id} label={title} className={`rg-modal rg-endmodal${className ? ` ${className}` : ""}`} onClose={onClose}>
      <header className="rg-ending-hero" style={e.pic ? { ["--bg" as string]: `url(${asset(e.pic)})` } : undefined}>
        <span className="rg-ending-no">ENDING {String(index + 1).padStart(2, "0")}</span>
        <div className="rg-ending-title">
          {boss && <BossChip boss={boss} />}
          <h3>{nm(e.name, e.cn)}</h3>
          {done !== undefined && <em className={`rg-prog${done ? " on" : ""}`}>{done ? t("달성") : t("미달성")}</em>}
        </div>
        {e.change && <p className="rg-ending-change">“{e.change}”</p>}
        {e.desc && <p className="rg-ending-desc on-pic">{e.desc}</p>}
        {e.avg && onOpenStory && (
          <button type="button" className="rg-ending-avg on-pic" onClick={() => onOpenStory(e.avg!, title)}>
            <i aria-hidden>▶</i><b>{t("엔딩 스토리 보기")}</b>
          </button>
        )}
      </header>
      {extra}
      <div className="rg-ending-main">
        {e.cond && e.cond.length > 0 && (
          <div className="rg-ending-sec">
            <h4>{t("진입 조건")}</h4>
            <ol className="rg-ending-cond">
              {e.cond.map((c, i) => {
                // 단계 구분은 앞뒤 공백이 있는 ' → ' 만 (붙은 화살표는 '바뀐다'는 뜻이라 한 문장), 그리고 **괄호 밖**만 —
                // '(수상한 상인 → 안전한 곳 → 전투 → 험난한 길)' 같은 괄호 속 경로까지 쪼개 줄이 다섯 개로 갈라졌다 (사용자 지적 2026-10-18)
                const parts = splitSteps(c);
                return (
                  <li key={i}>
                    {i < e.cond!.length - 1 && <i className={`rg-step-arrow${i % 4 === 3 ? " wrap" : ""}`} aria-hidden />}
                    {i > 0 && i % 4 === 0 && <i className="rg-step-arrow from" aria-hidden />}
                    <div className="rg-cond-in">
                      {parts.length > 1 ? <ol className="rg-cond-steps">{parts.map((p, j) => <li key={j}>{cond(p)}</li>)}</ol> : cond(c)}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        {e.book && e.book.length > 0 && (
          <div className="rg-ending-sec rg-ending-book">
            <h4>{t("엔딩 후 해금 스토리")}<em>{e.book.length}</em></h4>
            <ul>
              {e.book.map((b, i) => {
                const tag = bookGot && b.rid ? <em className={`rg-prog sm${bookGot(b.rid) ? " on" : ""}`}>{bookGot(b.rid) ? t("해금됨") : t("미해금")}</em> : null;
                return (
                  <li key={i}>
                    {b.txt && b.rid && onOpenRecord ? (
                      <button type="button" className="rg-rec-btn" onClick={() => onOpenRecord(b.rid!, b.cn ? `${b.cn} ${b.name ?? ""}` : b.name ?? "", e.name)}>
                        <strong>{nm(b.name ?? "", b.cn)}</strong><span>{b.cond}</span>{tag}
                        <i className="rg-rec-read" aria-hidden>▸ {t("읽기")}</i>
                      </button>
                    ) : (
                      <div className="rg-rec-row"><strong>{nm(b.name ?? "", b.cn)}</strong><span>{b.cond}</span>{tag}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </ModalWindow>
  );
}
