"use client";

// 업데이트 내역 — 헤더 로고 오른쪽 🛠 버튼 + 모달.
// 내용은 코드가 아니라 **Supabase `changelog` 테이블**에서 실시간으로 읽는다
// (사용자 확정 2026-07-27: 새 항목은 /admin에서 넣으면 배포 없이 바로 뜬다).
// 표시 규칙 (사용자 확정 2026-07-27):
//  ① 기본은 **신기능만** — '상세보기'를 눌러야 개선·버그 수정·데이터 갱신까지 보인다.
//  ② 기간은 최근 7일치부터, '지난 기록'을 누를 때마다 **7일씩 더 과거로** 무한히 이어 붙인다.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n, DT_LOCALE } from "./i18n";
import { useHashSync } from "./hash-modal";
import {
  fetchChangelogRange, fetchOldestReleaseDate, windowRange, changeText,
  CHANGE_KIND_LABEL, RECENT_DAYS, daysAgoKst, type ChangeRow,
} from "./changelog-api";

const dateLabel = (iso: string, locale: string): string => {
  const d = new Date(`${iso}T00:00:00+09:00`);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(DT_LOCALE[locale as "ko"] ?? "ko-KR",
    { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }).format(d);
};

// 날짜별 묶기 — 서버가 released_at desc, seq asc로 주므로 순서대로 담기만 하면 된다
function groupByDate(rows: ChangeRow[]): { date: string; rows: ChangeRow[] }[] {
  const out: { date: string; rows: ChangeRow[] }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.date === row.released_at) last.rows.push(row);
    else out.push({ date: row.released_at, rows: [row] });
  }
  return out;
}

// 빈 주가 이어질 때 클릭 한 번이 헛돌지 않게 자동으로 다음 창까지 넘어간다.
// 1년 반 넘게 빈 구간이면 멈춘다 (런어웨이 방지).
const MAX_SKIP = 80;

export default function ChangelogButton() {
  const { locale, t } = useI18n();
  const localeBase = locale === "ko" ? "" : `/${locale}`;
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);        // false = 신기능만
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  const [weeks, setWeeks] = useState(1);              // 지금까지 불러온 7일 창 수
  const [oldest, setOldest] = useState<string | null>(null); // 전체에서 가장 오래된 항목 날짜
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const loaded = useRef(false);                       // 첫 로드 1회 가드

  // 딥링크: #changelog(신기능만) · #changelog-all(상세) — 기간 확장 상태는 URL에 담지 않는다
  useHashSync(open ? (detail ? "#changelog-all" : "#changelog") : null, (h) => {
    if (h === "#changelog" || h === "#changelog-all") { setOpen(true); setDetail(h === "#changelog-all"); }
    else setOpen(false);
  });

  // 첫 로드 — 최근 7일 + 전체 최고(最古) 날짜(더 볼 게 남았는지 판정용)
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    let alive = true;
    const { from } = windowRange(0);
    Promise.all([fetchChangelogRange(from), fetchOldestReleaseDate()])
      .then(([data, min]) => { if (!alive) return; setRows(data); setOldest(min); })
      .catch(() => {
        if (!alive) return;
        loaded.current = false;   // 실패는 재시도 가능하게
        setError(t("업데이트 내역을 불러오지 못했습니다 — 잠시 뒤 다시 시도해 주세요."));
      });
    return () => { alive = false; };
  }, [open, t]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 불러온 구간의 시작일 — 이보다 오래된 항목이 있으면 '지난 기록' 버튼을 보인다
  const loadedFrom = daysAgoKst(RECENT_DAYS * weeks);
  const hasOlder = oldest !== null && oldest < loadedFrom;

  const loadOlder = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      let i = weeks;
      // 항목이 하나도 없는 주는 건너뛰고, 뭔가 나오거나 더 과거가 없을 때까지 이어 간다
      for (let step = 0; step < MAX_SKIP; step += 1) {
        const { from, to } = windowRange(i);
        const page = await fetchChangelogRange(from, to);
        i += 1;
        if (page.length) {
          setRows((prev) => [...(prev ?? []), ...page]);
          break;
        }
        if (!(oldest !== null && oldest < from)) break;   // 더 과거가 없으면 중단
      }
      setWeeks(i);
    } catch {
      setError(t("업데이트 내역을 불러오지 못했습니다 — 잠시 뒤 다시 시도해 주세요."));
    }
    setLoadingMore(false);
  }, [weeks, oldest, loadingMore, t]);

  // 표시 대상 — 기본은 신기능만, 상세보기면 전부
  const shown = (rows ?? []).filter((row) => detail || row.kind === "new");
  const groups = groupByDate(shown);
  const hiddenCount = (rows?.length ?? 0) - shown.length;

  return (
    <>
      {/* 버튼으로 열 땐 항상 신기능만부터 — 딥링크(#changelog-all)로는 상세로 바로 진입 */}
      <button type="button" className="chlog-trigger" onClick={() => { setDetail(false); setOpen(true); }} title={t("최근 업데이트 내역 보기")}>
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
              {rows !== null && !error && shown.length === 0 && (
                <p className="chlog-empty">
                  {hiddenCount > 0
                    ? t("이 기간에 새로 나온 기능은 없습니다 — 상세보기로 개선·수정 내역을 확인하세요.")
                    : t("아직 등록된 업데이트 내역이 없습니다.")}
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
              {rows !== null && !error && (
                <div className="chlog-actions">
                  <button type="button" className="chlog-more-btn" onClick={() => setDetail((d) => !d)}>
                    {detail ? t("신기능만 보기") : t("상세보기 — 개선·수정 내역까지")}
                  </button>
                  {hasOlder && (
                    <button type="button" className="chlog-more-btn" onClick={() => { void loadOlder(); }} disabled={loadingMore}>
                      {loadingMore ? t("불러오는 중…") : weeks === 1 ? t("지난 기록 전체보기") : t("지난 기록 더 보기 (7일씩)")}
                    </button>
                  )}
                </div>
              )}
              {/* 후원 안내 — 항상 보이는 하단 노트 (사용자 요청 2026-07-27) */}
              <p className="chlog-donate">
                ☕ {t("사이트 후원 버튼도 달았습니다 — 광고 없이 운영되는 사이트라, 후원해 주시면 서버·도메인 비용에 큰 힘이 됩니다. 감사합니다!")}{" "}
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
