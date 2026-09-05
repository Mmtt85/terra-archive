"use client";

// 리플레이 프리뷰 모달 — 플레이 로그를 바로 내려받지 않고 가독성 있게 먼저 보여준다
// (사용자 요청 2026-07-26: "일단 프리뷰 모달로 열어서 한번 보여줘. JSON 임포트/익스포트도").
// 표시 대상은 ① 현재(또는 마지막) 연결의 로그, ② 가져온 JSON 파일 — 같은 스키마다.

import { useRef, useState } from "react";
import { bridgeLogPayload, downloadBridgePayload, type BridgeLogPayload, type BridgeLogEvent } from "./bridge";
import type { T } from "../i18n";
import { ModalWindow } from "../modal-window";

// 여정 이벤트 type → 표시 라벨 (i18n 키). 여기 없는 type(옛 파일의 map·none·battle 등)은
// 여정이 아니므로 표시하지 않는다 — 사용자 확정 2026-07-26: "유저가 뭘 선택했는지만".
// 작전은 **입장**만, 소장품·자원은 **보유 리스트에 담은 것**만 들어온다 (rogue.tsx, 2026-07-26)
const TYPE_LABEL: Record<string, string> = {
  stage: "작전 진입", enc: "조우", relic: "소장품 획득", res: "자원 획득",
  zone: "지역", "battle-result": "작전 결과",
};
// 전시관(archive) 이벤트는 arc 탭으로 구분 — band 같은 영문 키는 한국어로, 테마 고유
// 시스템(암호판·붕괴 패러다임 등)은 데이터의 한국어 라벨이 그대로 온다.
const ARC_LABEL: Record<string, string> = {
  band: "분대", tool: "탐사 도구", scrap: "부품",
};

const hhmmss = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toTimeString().slice(0, 8);
};

const rowLabel = (ev: BridgeLogEvent, t: T): string | null => {
  if (ev.type === "archive") {
    const arc = ev.arc ?? "";
    return ARC_LABEL[arc] ? t(ARC_LABEL[arc]) : arc || t("전시관");
  }
  const key = TYPE_LABEL[ev.type];
  return key ? t(key) : null;   // 여정 밖 type — 표시 제외
};

function Row({ ev, n, t }: { ev: BridgeLogEvent; n: number; t: T }) {
  return (
    <li className={`bridge-replay-row t-${ev.type}`}>
      <span className="br-time">{hhmmss(ev.at)}</span>
      <span className="br-type">{rowLabel(ev, t)}</span>
      <span className="br-name">
        {ev.emergency && <em className="br-emg">{t("긴급")}</em>}
        {ev.name ?? (ev.names?.length ? ev.names.join(" · ") : ev.type === "battle-result" ? "" : "—")}
        {ev.names && ev.names.length > 1 && ev.name && (
          <small> +{ev.names.length - 1}</small>
        )}
        {n > 1 && <small className="br-dup">×{n}</small>}
      </span>
      <span className="br-meta">
        {/* 값은 파이프라인이 넣는 success|fail 뿐 — 가져온 파일에 다른 값이 있으면 아무것도
            쓰지 않는다 (모르는 값을 '실패'로 단정하지 않게, 2026-07-26) */}
        {ev.result === "success" ? <b>{t("작전 성공")}</b> : ev.result === "fail" ? <b>{t("작전 실패")}</b> : null}
        {ev.hp && ` HP ${ev.hp[0]}/${ev.hp[1]}`}
        {ev.levelExp && ` · Lv ${ev.levelExp[0]}/${ev.levelExp[1]}`}
        {ev.cached && <i className="br-cached">{t("캐시 재적용")}</i>}
      </span>
    </li>
  );
}

// 난이도 — 판 내 불변이라 헤더에 1회만 표시 (페이로드 수준 grade, 옛 파일은 이벤트에서 탐색)
const gradeOf = (p: BridgeLogPayload): number | undefined =>
  p.grade ?? [...p.events].reverse().find((e) => e.grade !== undefined)?.grade;

// 연속 중복 병합 — 같은 화면이 여러 번 인식되면(재안착·미세 변화) 같은 줄이 줄줄이 쌓인다.
// 표시용으로만 하나로 합치고 ×N을 단다 (사용자 요청 2026-07-26). JSON 원본은 그대로다.
// 수치(HP·레벨·결과)는 뒤 이벤트가 최신이므로 갱신해 담는다.
function mergeRuns(events: BridgeLogEvent[]): { ev: BridgeLogEvent; n: number }[] {
  const key = (e: BridgeLogEvent) => `${e.type}|${e.name ?? ""}|${(e.names ?? []).join(",")}`;
  const out: { ev: BridgeLogEvent; n: number }[] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    if (last && key(last.ev) === key(ev)) {
      last.n++;
      last.ev = {
        ...last.ev,
        hp: ev.hp ?? last.ev.hp,
        levelExp: ev.levelExp ?? last.ev.levelExp,
        result: ev.result ?? last.ev.result,
        grade: ev.grade ?? last.ev.grade,
        emergency: last.ev.emergency || ev.emergency,
        cached: last.ev.cached && ev.cached,
      };
    } else {
      out.push({ ev: { ...ev }, n: 1 });
    }
  }
  return out;
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

  // 공용 창(ModalWindow) — 백드롭·Esc·겹침(z)·이동·📌 고정은 창이 맡는다 (2026-09-05 일괄 전환).
  // 테마·난이도·가져온 파일 표시는 크롬 바에 끼워 넣는다 (종전 <header> 안 배지들).
  return (
    <ModalWindow label={t("리플레이")} className="bridge-replay" onClose={onClose}
      chrome={<>
        {payload?.themeName ? <span className="br-theme">{t(payload.themeName)}</span> : null}
        {payload && gradeOf(payload) !== undefined && (
          <span className="br-grade">{t("난이도")} {gradeOf(payload)}</span>
        )}
        {imported && <span className="br-imported">{t("가져온 파일")}</span>}
      </>}>
        {payload ? (
          <>
            {/* 여정 이벤트만 보여주고(옛 파일의 잡음 type 제외) 연속 중복은 ×N 한 줄로 */}
            {(() => {
              const rows = mergeRuns(payload.events.filter((ev) => rowLabel(ev, t) !== null));
              return (
                <>
                  <p className="br-range">
                    {hhmmss(payload.startedAt)} ~ {hhmmss(payload.endedAt)}
                    {" · "}{t("기록")} {rows.length}
                  </p>
                  <ul className="bridge-replay-list">
                    {rows.map((r, i) => <Row key={i} ev={r.ev} n={r.n} t={t} />)}
                  </ul>
                </>
              );
            })()}
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
    </ModalWindow>
  );
}
