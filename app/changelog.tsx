"use client";

// 업데이트 내역 — 헤더 로고 오른쪽 🛠 버튼 + 모달.
// 내용은 코드가 아니라 **Supabase `changelog` 테이블**에서 실시간으로 읽는다
// (사용자 확정 2026-07-27: 새 항목은 /admin에서 넣으면 배포 없이 바로 뜬다).
// 표시 규칙 (사용자 확정 2026-07-27):
//  ① 기본은 **신기능만** — 제목 옆 '상세보기'를 눌러야 개선·버그 수정·데이터 갱신까지 보인다.
//     (2026-07-29부터 버튼으로 열면 상세가 기본. 개선·수정이 변경의 대부분이라 신기능만 띄우면
//      "바뀐 게 없네"로 읽혔다.)
//  ② 기간은 최근 7일치부터, 목록 아래 '예전 기록 가져오기'를 누를 때마다 **7일씩 더 과거로** 이어 붙인다.
//  ③ 항목은 **핵심 한 줄만** 보이고, 끝의 '상세보기'로 나머지를 펼친다 (2026-07-29).
// 세 축은 별개다 — 종류 필터는 헤더, 기간 확장은 목록 끝, 항목 펼침은 항목 안에 둔다.
// ①과 ③이 같은 '상세보기' 라벨을 쓰지만 위계가 다르다(헤더 알약 vs 본문 인라인 링크).

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n, DT_LOCALE } from "./i18n";
import { useHashSync } from "./hash-modal";
import { ModalWindow } from "./modal-window";
import {
  fetchChangelogRange, fetchOldestReleaseDate, windowRange, changeText, splitChange, areaOf,
  CHANGE_KIND_LABEL, CHANGE_AREA_LABEL, RECENT_DAYS, daysAgoKst, type ChangeRow,
} from "./changelog-api";
import { fetchDevNotes, noteSuggestion, noteReply, DEVNOTE_STATUS_LABEL, type DevNoteRow } from "./devnotes-api";
import { isNewFeature } from "./whats-new";

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

// 코멘트도 날짜별로 묶는다 (업데이트 내역과 같은 시각 언어)
function groupNotesByDate(rows: DevNoteRow[]): { date: string; rows: DevNoteRow[] }[] {
  const out: { date: string; rows: DevNoteRow[] }[] = [];
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
  // 열면 **상세보기가 기본** (사용자 지시 2026-07-29) — 신기능만 보는 건 헤더 토글로.
  // 개선·수정이 실제 변경의 대부분이라, 신기능만 띄우면 "바뀐 게 없네"로 읽혔다.
  const [detail, setDetail] = useState(true);
  // 개발자 코멘트 뷰 (사용자 요청 2026-08-05: 받은 제안에 대한 답변 — 뭐가 되고 뭐가 왜 안 되는지).
  // 내역과 같은 모달을 나눠 쓰고, 크롬 바의 💬 버튼(신기능만 토글 왼쪽)으로 오간다.
  const [view, setView] = useState<"log" | "notes">("log");
  const [notes, setNotes] = useState<DevNoteRow[] | null>(null);
  const [notesError, setNotesError] = useState("");
  const notesLoaded = useRef(false);
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  const [weeks, setWeeks] = useState(1);              // 지금까지 불러온 7일 창 수
  const [oldest, setOldest] = useState<string | null>(null); // 전체에서 가장 오래된 항목 날짜
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  // 항목별 펼침 — 기본은 핵심 한 줄만 (사용자 요청 2026-07-29: "줄줄줄줄 너무 길어지니까").
  // 헤더의 '상세보기'는 어떤 **종류**를 보일지 고르는 필터라 축이 다르다.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggleRow = useCallback((id: string) => {
    setOpened((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const loaded = useRef(false);                       // 첫 로드 1회 가드

  // 딥링크: #changelog(신기능만) · #changelog-all(상세, 버튼으로 여는 기본) · #devnotes(개발자 코멘트)
  // — 기간 확장 상태는 URL에 담지 않는다
  useHashSync(open ? (view === "notes" ? "#devnotes" : detail ? "#changelog-all" : "#changelog") : null, (h) => {
    if (h === "#devnotes") { setOpen(true); setView("notes"); }
    else if (h === "#changelog" || h === "#changelog-all") { setOpen(true); setView("log"); setDetail(h === "#changelog-all"); }
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

  // 개발자 코멘트 — 뷰를 처음 열 때 1회 로드 (모달만 열고 안 보면 안 부른다)
  useEffect(() => {
    if (!open || view !== "notes" || notesLoaded.current) return;
    notesLoaded.current = true;
    let alive = true;
    fetchDevNotes()
      .then((data) => { if (alive) setNotes(data); })
      .catch(() => {
        if (!alive) return;
        notesLoaded.current = false;   // 실패는 재시도 가능하게
        setNotesError(t("개발자 코멘트를 불러오지 못했습니다 — 잠시 뒤 다시 시도해 주세요."));
      });
    return () => { alive = false; };
  }, [open, view, t]);

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
      {/* 버튼으로 열면 **상세보기**가 기본 (사용자 지시 2026-07-29) — 신기능만 보려면
          헤더 토글을 누르거나 #changelog 딥링크로 들어온다 */}
      <button type="button" className="chlog-trigger" onClick={() => { setDetail(true); setView("log"); setOpen(true); }} title={t("최근 업데이트 내역 보기")}>
        <span aria-hidden>🛠</span>
        {/* 모바일은 아이콘만 (1줄 로고 옆 — 폭이 좁다) */}
        <span className="chlog-label">{t("업데이트 내역")}</span>
        {/* 개발자 코멘트는 열어 봐야 보이므로 진입점에도 배지 (whats-new.ts 정책) */}
        {isNewFeature("dev-notes") && <span className="new-badge">{t("새기능")}</span>}
      </button>
      {/* 헤더의 backdrop-filter가 fixed 기준을 헤더로 만들어버리므로 portal로 body에 렌더.
          제목은 창 크롬 바(label)가 담당 — 종전 내부 header는 제목이 이중으로 떠서 제거하고,
          상세보기 토글(사용자 요청 2026-07-28: 제목 옆)은 크롬 바에 얹는다 (2026-08-03) */}
      {open && createPortal(
        // 제목은 지금 보이는 뷰를 말한다 — 코멘트 뷰에선 '개발자 코멘트' (사용자 요청 2026-08-05).
        // 배치도 같은 날 요청: 신기능만 토글은 제목 바로 오른쪽, 뷰 전환 버튼은 오른쪽 끝.
        <ModalWindow label={view === "notes" ? t("개발자 코멘트") : t("업데이트 내역")} className="chlog-modal" onClose={() => setOpen(false)}
          chrome={<>
            {view === "log" && rows !== null && !error && (
              <button type="button" className="chlog-detail-toggle" aria-pressed={detail}
                onClick={() => setDetail((d) => !d)}
                title={detail ? t("신기능만 보기") : t("상세보기 — 개선·수정 내역까지")}>
                {detail ? t("신기능만") : t("상세보기")}
              </button>
            )}
            {/* 뷰 전환 — 코멘트 뷰에선 라벨이 '업데이트 내역'으로 바뀌어 토글임이 드러난다 */}
            <button type="button" className="chlog-detail-toggle chlog-devnotes-btn" aria-pressed={view === "notes"}
              onClick={() => setView((v) => (v === "notes" ? "log" : "notes"))}
              title={view === "notes" ? t("업데이트 내역으로 돌아가기") : t("받은 제안에 대한 개발자의 답변 — 무엇이 반영되고 무엇이 왜 어려운지")}>
              {view === "notes" ? <>🛠 {t("업데이트 내역")}</> : <>💬 {t("개발자 코멘트")}</>}
            </button>
          </>}>
            {view === "notes" ? (
            <div className="chlog-list chlog-notes">
              {notes === null && !notesError && <p className="chlog-empty">{t("불러오는 중…")}</p>}
              {notesError && <p className="chlog-empty">{notesError}</p>}
              {notes !== null && !notesError && notes.length > 0 && (
                <p className="devnote-intro">{t("여러분이 보내 주신 제안·피드백에 대한 답변입니다 — 무엇이 반영되고, 무엇이 왜 어려운지 남깁니다.")}</p>
              )}
              {notes !== null && !notesError && notes.length === 0 && (
                <p className="chlog-empty">{t("아직 등록된 개발자 코멘트가 없습니다.")}</p>
              )}
              {groupNotesByDate(notes ?? []).map((day) => (
                <section key={day.date}>
                  <h3>{dateLabel(day.date, locale)}</h3>
                  <ul>
                    {day.rows.map((row) => {
                      // 기본은 제안(제목)만 — 눌러야 답변이 열린다 (사용자 요청 2026-08-05).
                      // 목록이 길어져도 무엇에 대한 답인지 한눈에 훑을 수 있게.
                      const shown = opened.has(row.id);
                      return (
                        <li key={row.id} className="devnote">
                          <span className={`chlog-kind devnote-status ${row.status}`}>{t(DEVNOTE_STATUS_LABEL[row.status])}</span>
                          <div className="devnote-body">
                            <button type="button" className="devnote-q" aria-expanded={shown} onClick={() => toggleRow(row.id)}>
                              <span>{noteSuggestion(row, locale)}</span>
                              <i aria-hidden>{shown ? "▴" : "▾"}</i>
                            </button>
                            {shown && (<>
                              <p className="devnote-reply">{noteReply(row, locale)}</p>
                              {row.image && (
                                <a href={row.image} target="_blank" rel="noreferrer" title={t("이미지 크게 보기")}>
                                  <img className="devnote-img" src={row.image} alt="" loading="lazy" />
                                </a>
                              )}
                            </>)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
            ) : (
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
                    {day.rows.map((row) => {
                      // 펼치면 원문을 그대로 — head+rest로 이어 붙이면 " — " 구분자가 사라진다
                      const full = changeText(row, locale);
                      const { head, rest } = splitChange(full);
                      const open = opened.has(row.id);
                      return (
                        <li key={row.id}>
                          {/* 배지는 '인프라 개선'처럼 기능+종류로 읽힌다 (사용자 요청 2026-07-29).
                              어순은 로케일마다 다르므로 "{area} {kind}" 서식 키로 조립한다. */}
                          <span className={`chlog-kind ${row.kind}`}>
                            {t("{area} {kind}", {
                              area: t(CHANGE_AREA_LABEL[areaOf(row)]),
                              kind: t(CHANGE_KIND_LABEL[row.kind] ?? row.kind),
                            })}
                          </span>
                          <span className="chlog-text">
                            {open ? full : head}
                            {rest && (
                              <button type="button" className="chlog-more" aria-expanded={open}
                                onClick={() => toggleRow(row.id)}>
                                {open ? t("접기") : t("상세보기")}
                              </button>
                            )}
                            {row.href && (
                              <a className="chlog-go" href={row.href.startsWith("/") ? `${localeBase}${row.href}` : row.href}>{t("바로가기")} →</a>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {rows !== null && !error && hasOlder && (
                <div className="chlog-actions">
                  <button type="button" className="chlog-more-btn" onClick={() => { void loadOlder(); }} disabled={loadingMore}>
                    {loadingMore ? t("불러오는 중…") : t("예전 기록 가져오기")}
                  </button>
                </div>
              )}
              {/* 후원 안내 — 항상 보이는 하단 노트 (사용자 요청 2026-07-27) */}
              <p className="chlog-donate">
                ☕ {t("사이트 후원 버튼도 달았습니다 — 광고 없이 운영되는 사이트라, 후원해 주시면 서버·도메인 비용에 큰 힘이 됩니다. 감사합니다!")}{" "}
                <a href="https://buymeacoffee.com/terra_archive" target="_blank" rel="noopener noreferrer">{t("서버 운영 후원")}</a>
              </p>
            </div>
            )}
        </ModalWindow>,
        document.body
      )}
    </>
  );
}
