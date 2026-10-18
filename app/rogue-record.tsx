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
              if (typeof p === "string") return <p key={i}>{p}</p>;
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
