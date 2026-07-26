"use client";

// 리플레이 프리뷰 모달 — 플레이 로그를 바로 내려받지 않고 가독성 있게 먼저 보여준다
// (사용자 요청 2026-07-26: "일단 프리뷰 모달로 열어서 한번 보여줘. JSON 임포트/익스포트도").
// 표시 대상은 ① 현재(또는 마지막) 연결의 로그, ② 가져온 JSON 파일 — 같은 스키마다.

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bridgeLogPayload, downloadBridgePayload, type BridgeLogPayload, type BridgeLogEvent } from "./bridge";
import type { T } from "../i18n";

// 이벤트 type → 표시 라벨 (i18n 키)
const TYPE_LABEL: Record<string, string> = {
  map: "지도", stage: "작전", enc: "조우", relic: "유물", zone: "지역", mech: "암호판",
  band: "분대", archive: "전시관", ending: "엔딩", grade: "난이도",
  battle: "전투", "battle-result": "작전 결과", none: "인식 실패", tie: "테마 되묻기",
};

const hhmmss = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toTimeString().slice(0, 8);
};

function Row({ ev, t }: { ev: BridgeLogEvent; t: T }) {
  const label = t(TYPE_LABEL[ev.type] ?? ev.type);
  return (
    <li className={`bridge-replay-row t-${ev.type}`}>
      <span className="br-time">{hhmmss(ev.at)}</span>
      <span className="br-type">{label}</span>
      <span className="br-name">
        {ev.emergency && <em className="br-emg">{t("긴급")}</em>}
        {ev.name ?? (ev.names?.length ? ev.names.join(" · ") : "—")}
        {ev.names && ev.names.length > 1 && ev.name && (
          <small> +{ev.names.length - 1}</small>
        )}
      </span>
      <span className="br-meta">
        {ev.result && <b>{ev.result === "success" ? t("작전 성공") : t("작전 실패")}</b>}
        {ev.hp && ` HP ${ev.hp[0]}/${ev.hp[1]}`}
        {ev.levelExp && ` · Lv ${ev.levelExp[0]}/${ev.levelExp[1]}`}
        {ev.grade !== undefined && ` · ${t("난이도")} ${ev.grade}`}
        {ev.cached && <i className="br-cached">{t("캐시 재적용")}</i>}
      </span>
    </li>
  );
}

export default function BridgeReplayModal({ t, onClose }: { t: T; onClose: () => void }) {
  // 열 때 현재 로그 스냅샷 — 라이브 중이면 그 시점까지의 기록을 보여준다
  const [payload, setPayload] = useState<BridgeLogPayload | null>(() => bridgeLogPayload());
  const [imported, setImported] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = (f: File | undefined) => {
    if (!f) return;
    void f.text().then((txt) => {
      try {
        const j = JSON.parse(txt) as BridgeLogPayload;
        if (!Array.isArray(j.events)) throw new Error("events 없음");
        setPayload(j);
        setImported(true);
        setErr("");
      } catch {
        setErr(t("리플레이 JSON이 아닙니다 — 내보내기로 저장한 파일을 골라주세요."));
      }
    });
  };

  return createPortal(
    <div className="bridge-replay-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bridge-replay" role="dialog" aria-modal="true" aria-label={t("리플레이")}>
        <header>
          <h3>
            {t("리플레이")}
            {payload?.themeName ? <span className="br-theme">{t(payload.themeName)}</span> : null}
            {imported && <span className="br-imported">{t("가져온 파일")}</span>}
          </h3>
          <button type="button" className="br-close" onClick={onClose} aria-label={t("닫기")}>×</button>
        </header>
        {payload ? (
          <>
            {/* 인식 실패(none)는 보여주지 않는다 — 지난 버전이 저장한 JSON에도 적용 */}
            <p className="br-range">
              {hhmmss(payload.startedAt)} ~ {hhmmss(payload.endedAt)}
              {" · "}{t("기록")} {payload.events.filter((ev) => ev.type !== "none").length}
            </p>
            <ul className="bridge-replay-list">
              {payload.events.filter((ev) => ev.type !== "none").map((ev, i) => <Row key={i} ev={ev} t={t} />)}
            </ul>
          </>
        ) : (
          <p className="br-empty">{t("아직 기록이 없습니다 — 게임 연결로 플레이하면 자동으로 쌓입니다. 저장해둔 JSON을 가져와 볼 수도 있습니다.")}</p>
        )}
        {err && <p className="br-err">{err}</p>}
        <footer>
          <button type="button" className="lens-open-btn" onClick={() => fileRef.current?.click()}>
            {t("JSON 가져오기")}
          </button>
          {payload && (
            <button type="button" className="lens-open-btn" onClick={() => downloadBridgePayload(payload)}>
              ⤓ {t("JSON 내보내기")}
            </button>
          )}
          <input
            ref={fileRef} type="file" accept=".json,application/json" hidden
            onChange={(e) => { onImport(e.target.files?.[0]); e.target.value = ""; }}
          />
        </footer>
      </div>
    </div>,
    document.body,
  );
}
