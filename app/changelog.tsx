"use client";

// 업데이트 내역 — 헤더 로고 오른쪽 🛠 버튼 + 모달.
// 내용은 코드가 아니라 **Supabase `changelog` 테이블**에서 실시간으로 읽는다
// (사용자 확정 2026-07-27: 새 항목은 /admin에서 넣으면 배포 없이 바로 뜬다).
// 기본은 최근 1주일치, '지난 기록 전체보기'를 누르면 전부 불러온다.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n, DT_LOCALE } from "./i18n";
import { useHashSync } from "./hash-modal";
import {
  fetchChangelog, changeText, CHANGE_KIND_LABEL, RECENT_DAYS,
  type ChangeRow,
} from "./changelog-api";

const dateLabel = (iso: string, locale: string): string => {
  const d = new Date(`${iso}T00:00:00+09:00`);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(DT_LOCALE[locale as "ko"] ?? "ko-KR",
    { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }).format(d);
};

// 날짜별 묶기 — 서버가 released_at desc, seq asc로 정렬해 주므로 순서대로 담기만 하면 된다
function groupByDate(rows: ChangeRow[]): { date: string; rows: ChangeRow[] }[] {
  const out: { date: string; rows: ChangeRow[] }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.date === row.released_at) last.rows.push(row);
    else out.push({ date: row.released_at, rows: [row] });
  }
  return out;
}

export default function ChangelogButton() {
  const { locale, t } = useI18n();
  const localeBase = locale === "ko" ? "" : `/${locale}`;
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);          // false = 최근 1주일, true = 전체
  // 범위별로 따로 캐시한다 — 한 변수에 담으면 전체를 본 뒤 버튼으로 다시 열었을 때
  // 표시는 전체인데 버튼은 '전체보기'로 남는 어긋남이 생긴다
  const [recent, setRecent] = useState<ChangeRow[] | null>(null);
  const [full, setFull] = useState<ChangeRow[] | null>(null);
  const [error, setError] = useState("");
  const rows = all ? full : recent;

  // 딥링크: #changelog(최근 1주일) · #changelog-all(전체) — 어느 탭에서든 열린다
  useHashSync(open ? (all ? "#changelog-all" : "#changelog") : null, (h) => {
    if (h === "#changelog" || h === "#changelog-all") { setOpen(true); setAll(h === "#changelog-all"); }
    else setOpen(false);
  });

  useEffect(() => {
    if (!open || rows !== null) return;   // 이미 받아둔 범위면 재요청 안 함
    let alive = true;
    setError("");
    const wantAll = all;
    fetchChangelog(wantAll)
      .then((data) => { if (!alive) return; if (wantAll) setFull(data); else setRecent(data); })
      .catch(() => { if (alive) setError(t("업데이트 내역을 불러오지 못했습니다 — 잠시 뒤 다시 시도해 주세요.")); });
    return () => { alive = false; };
  }, [open, all, rows, t]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const groups = groupByDate(rows ?? []);

  return (
    <>
      {/* 버튼으로 열 땐 항상 최근 1주일부터 — 딥링크(#changelog-all)로는 전체로 바로 진입 */}
      <button type="button" className="chlog-trigger" onClick={() => { setAll(false); setOpen(true); }} title={t("최근 업데이트 내역 보기")}>
        <span aria-hidden>🛠</span>
        {/* 모바일은 아이콘만 (1줄 로고 옆 — 폭이 좁다) */}
        <span className="chlog-label">{t("업데이트 내역")}</span>
      </button>
      {/* 헤더의 backdrop-filter가 fixed 기준을 헤더로 만들어버리므로 portal로 body에 렌더 */}
      {open && createPortal(
        <div className="modal-backdrop chlog-backdrop" onClick={() => setOpen(false)}>
          <div className="chlog-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("업데이트 내역")}>
            <header>
              <h2>🛠 {t("업데이트 내역")}</h2>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label={t("닫기")}>×</button>
            </header>
            <div className="chlog-list">
              {rows === null && !error && <p className="chlog-empty">{t("불러오는 중…")}</p>}
              {error && <p className="chlog-empty">{error}</p>}
              {rows !== null && rows.length === 0 && !error && (
                <p className="chlog-empty">
                  {all ? t("아직 등록된 업데이트 내역이 없습니다.")
                    : t("최근 {n}일 사이의 업데이트가 없습니다 — 지난 기록 전체보기로 이전 내역을 확인하세요.", { n: RECENT_DAYS })}
                </p>
              )}
              {groups.map((day) => (
                <section key={day.date}>
                  <h3>{dateLabel(day.date, locale)}</h3>
                  <ul>
                    {day.rows.map((row) => (
                      <li key={row.id}>
                        <span className={`chlog-kind ${row.kind}`}>{t(CHANGE_KIND_LABEL[row.kind] ?? row.kind)}</span>
                        <span className="chlog-text">
                          {changeText(row, locale)}
                          {row.href && (
                            <a className="chlog-go" href={row.href.startsWith("/") ? `${localeBase}${row.href}` : row.href}>{t("바로가기")} →</a>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {!all && (
                <button type="button" className="chlog-more-btn" onClick={() => setAll(true)}>
                  {t("지난 기록 전체보기")}
                </button>
              )}
              {/* 후원 안내 — 항상 보이는 하단 노트 (사용자 요청 2026-07-27) */}
              <p className="chlog-donate">
                ☕ {t("사이트 후원 버튼도 달았습니다 — 광고 없이 운영되는 사이트라, 후원해 주시면 서버·도메인 비용에 큰 힘이 됩니다. 감사하겠습니다!")}{" "}
                <a href="https://buymeacoffee.com/terra_archive" target="_blank" rel="noopener noreferrer">{t("서버 운영 후원")}</a>
              </p>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
