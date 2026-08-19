"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  feedbackReady, sendFeedback, uploadFeedbackImage, imagesOf, FEEDBACK_IMG_MAX, FEEDBACK_IMG_MB,
  getFeedbackToken, setFeedbackToken, getFeedbackSeen, markFeedbackSeen,
  fetchMyFeedback, countNewReplies, updateMyFeedback, deleteMyFeedback,
  getBoardAdminKey, setBoardAdminKey, probeBoardAdminKey, fetchAllFeedbackBoard,
  boardAdminAddReply, boardAdminDeleteReply, boardAdminDeleteFeedback, boardAdminSetReviewed,
  countryOf, flagOf,
  type FeedbackKind, type BoardRow,
} from "./feedback";
import { ModalWindow } from "./modal-window";
import { useConfirm } from "./confirm";
import { fetchDevNotes, noteSuggestion, noteReply, DEVNOTE_STATUS_LABEL, type DevNoteRow } from "./devnotes-api";
import { useHashSync } from "./hash-modal";
import { isNewFeature } from "./whats-new";
import { useI18n } from "./i18n";

// open/setOpen은 부모(home)가 쥔다 — 모바일에선 헤더의 '제안' 버튼(공식 방송 옆)이,
// 데스크탑에선 우하단 FAB이 같은 패널을 연다 (사용자 요청 2026-07-22).
// 2026-08-17 게시판 개편 (사용자 확정): 모달이 스레드 목록이 됐다 — 이 브라우저(localStorage
// 토큰)로 보낸 제안과 개발자 답변을 작성자 본인만 본다. 새 답변 수는 onNewCount로 부모에
// 올려 헤더 버튼 뱃지에도 쓴다. 데이터 규칙: app/feedback.ts · docs/supabase-feedback-board.sql.
export default function FeedbackWidget({ open, setOpen, onNewCount }: {
  open: boolean; setOpen: (value: boolean) => void; onNewCount?: (n: number) => void;
}) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<"list" | "compose">("list");
  // 게시판 탭 — 내 제안(비공개 스레드) | 개발자 코멘트(전체 공개, 2026-08-17 업데이트 내역
  // 모달에서 이사. 사용자 지시: "개발자코멘트를 없애고 여기다가, 모두가 볼 수 있도록")
  const [tab, setTab] = useState<"mine" | "notes">("mine");
  const [notes, setNotes] = useState<DevNoteRow[] | null>(null);
  const [notesError, setNotesError] = useState(false);
  const notesLoaded = useRef(false);
  // 목록 클릭은 인라인 확장이 아니라 **별도 창모달**을 띄운다 (사용자 지시 2026-08-17:
  // "높이가 휙 늘어나지 말고 모달창 하나 더" — 개발자 코멘트도 마찬가지)
  const [noteId, setNoteId] = useState<string | null>(null);

  // ── 게시판 상태 ──
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  // 관리자 모드 (사용자 확정 2026-08-17: "제안 모달에서 답변 + 어차피 싹 다 볼 수 있어야") —
  // 열람 코드 입력칸에 관리자 키를 넣으면 전체 제안 + 답변 폼이 열린다
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [replyVal, setReplyVal] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  // 대응완료(reviewed_at) 가리기 — /admin의 '대응미완료' 기본 보기와 같은 감각 (기본: 가림)
  const [showReviewed, setShowReviewed] = useState(false);
  const [badge, setBadge] = useState(0);
  // 이번에 열기 직전의 '마지막 확인 시각' — 그 이후 답변에만 '새 답변' 점을 찍는다.
  // 기준점 읽기는 refresh() **시작 시점**(동기, seen을 갱신하기 전), 반영은 await 뒤 —
  // 늦게 도착한 응답이 그새 갱신된 seen을 기준으로 삼아 점을 놓치는 레이스를 막는다.
  const [newSince, setNewSince] = useState<string | null | undefined>(undefined);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeVal, setCodeVal] = useState("");
  const [codeErr, setCodeErr] = useState(false);
  const [copied, setCopied] = useState(false);
  // 본인 수정·삭제 (사용자 요청 2026-08-17)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [actErr, setActErr] = useState(false);
  // 첨부 이미지 확대 (사용자 지시 2026-08-17: "새 탭이 아니라 확대") — 창모달(z 200대) 위에
  // 떠야 하므로 confirm처럼 body 포털 (위젯 루트가 z 150 스태킹 컨텍스트라 안에선 못 넘는다)
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // 첫 setState 전에 반드시 await를 지나므로 이펙트에서 불러도 동기 캐스케이드가 없다
  // (react-hooks/set-state-in-effect — 신규 코드는 하우스 위반을 늘리지 않는다)
  const refresh = useCallback(async (markSeen: boolean) => {
    const ak = getBoardAdminKey();
    const tok = getFeedbackToken();
    const baselineSeen = getFeedbackSeen();
    // 관리자 모드는 전체 제안, 아니면 내 토큰 행만. 어느 쪽도 아니면 네트워크 없이 빈 목록.
    const data = await (
      ak ? fetchAllFeedbackBoard(ak).catch(() => null)
        : tok ? fetchMyFeedback().catch(() => null)
          : Promise.resolve<BoardRow[]>([])
    );
    setAdminKey(ak);
    setToken(tok);
    if (data === null) { setLoadError(true); return; }
    setLoadError(false);
    if (ak) {
      // 관리자에게 '새 답변' 뱃지는 무의미 (답변을 쓰는 쪽이므로)
      setBadge(0);
      onNewCount?.(0);
      if (markSeen) { setNewSince(baselineSeen); markFeedbackSeen(); }
    } else if (markSeen) {
      setNewSince(baselineSeen);
      markFeedbackSeen();
      setBadge(0);
      onNewCount?.(0);
    } else {
      const n = countNewReplies(data);
      setBadge(n);
      onNewCount?.(n);
    }
    setRows(data);
  }, [onNewCount]);

  // 마운트: 토큰 보유자(제안 이력 있는 방문자)·관리자만 조회 — 일반 방문자는 네트워크 0.
  // refresh의 setState는 전부 await 뒤(비동기 콜백)라 동기 캐스케이드가 없다 — 린터가
  // 호출 그래프를 보수적으로 추적해 오탐하므로 규칙만 지정 억제한다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (getFeedbackToken() || getBoardAdminKey()) void refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 열 때마다: 목록 갱신 + 읽음 처리 (뱃지는 지우되, 이번에 확인하는 새 답변엔 점 표시).
  // 뷰·펼침 리셋은 close()가 한다 — 이펙트에서 동기 setState를 피하는 하우스 규칙.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void refresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // #devnotes 딥링크 — 종전 업데이트 내역 모달의 코멘트 뷰가 쓰던 해시를 이어받는다
  // (이미 배포된 업데이트 내역 행의 href "/#devnotes"가 살아 있어야 한다)
  useHashSync(open && view === "list" && tab === "notes" ? "#devnotes" : null, (h) => {
    if (h.startsWith("#devnotes")) { setOpen(true); setView("list"); setTab("notes"); }
    else if (tab === "notes" && open) setOpen(false); // 뒤로가기로 해시가 걷히면 닫는다
  });

  // 개발자 코멘트 — 탭을 처음 열 때 1회 로드 (게시판만 열고 안 보면 안 부른다)
  useEffect(() => {
    if (!open || tab !== "notes" || notesLoaded.current) return;
    notesLoaded.current = true;
    let alive = true;
    fetchDevNotes()
      .then((data) => { if (alive) setNotes(data); })
      .catch(() => {
        if (!alive) return;
        notesLoaded.current = false; // 실패는 재시도 가능하게
        setNotesError(true);
      });
    return () => { alive = false; };
  }, [open, tab]);

  const close = () => {
    setOpen(false);
    setView("list");
    setTab("mine");
    setThreadId(null);
    setNoteId(null);
    setCodeOpen(false);
    setCodeErr(false);
    setEditingId(null);
    setActErr(false);
    setReplyVal("");
    setZoomSrc(null);
  };

  const openThread = (id: string) => {
    setThreadId(id);
    setEditingId(null);
    setActErr(false);
    setReplyVal("");
  };

  // ── 관리자 모드 동작 (게시판에서 직접 답변 — 그 제안의 작성자에게만 보인다) ──

  const exitAdmin = () => {
    setBoardAdminKey(null);
    setAdminKey(null);
    setThreadId(null);
    void refresh(true);
  };

  const sendReply = async (row: BoardRow) => {
    const body = replyVal.trim();
    if (!body || replyBusy || !adminKey) return;
    setReplyBusy(true);
    setActErr(false);
    try {
      const rep = await boardAdminAddReply(adminKey, row.id, body);
      setRows((cur) => (cur ?? []).map((r) => (r.id === row.id ? { ...r, feedback_replies: [...r.feedback_replies, rep] } : r)));
      setReplyVal("");
    } catch {
      setActErr(true);
    } finally {
      setReplyBusy(false);
    }
  };

  const removeReplyAdmin = async (row: BoardRow, replyId: string) => {
    if (!adminKey) return;
    if (!(await confirm({ message: t("이 답변을 삭제할까요?"), confirmLabel: t("삭제"), danger: true }))) return;
    setActErr(false);
    try {
      await boardAdminDeleteReply(adminKey, replyId);
      setRows((cur) => (cur ?? []).map((r) => (r.id === row.id ? { ...r, feedback_replies: r.feedback_replies.filter((rep) => rep.id !== replyId) } : r)));
    } catch {
      setActErr(true);
    }
  };

  // 관리자 제안 삭제 (사용자 요청 2026-08-17: "관리자도 제안 삭제 할 수 있도록")
  const removeFeedbackAdmin = async (row: BoardRow) => {
    if (!adminKey) return;
    if (!(await confirm({ message: t("이 제안을 삭제할까요? 달린 답변도 함께 삭제됩니다."), confirmLabel: t("삭제"), danger: true }))) return;
    setActErr(false);
    try {
      await boardAdminDeleteFeedback(adminKey, row.id);
      setRows((cur) => (cur ?? []).filter((r) => r.id !== row.id));
      setThreadId(null);
    } catch {
      setActErr(true);
    }
  };

  // 대응완료 토글 — 켜면 기본 보기(대응완료 가림)에서 목록을 빠져나간다
  const toggleReviewedAdmin = async (row: BoardRow) => {
    if (!adminKey) return;
    const next = !row.reviewed_at;
    setActErr(false);
    try {
      await boardAdminSetReviewed(adminKey, row.id, next);
      setRows((cur) => (cur ?? []).map((r) => (r.id === row.id ? { ...r, reviewed_at: next ? new Date().toISOString() : null } : r)));
    } catch {
      setActErr(true);
    }
  };

  const startEdit = (row: BoardRow) => {
    setEditingId(row.id);
    setEditVal(row.message);
    setActErr(false);
  };

  const saveEdit = async (row: BoardRow) => {
    const msg = editVal.trim();
    if (!msg || editBusy) return;
    setEditBusy(true);
    setActErr(false);
    try {
      await updateMyFeedback(row.id, msg);
      setRows((cur) => (cur ?? []).map((r) => (r.id === row.id ? { ...r, message: msg } : r)));
      setEditingId(null);
    } catch {
      setActErr(true);
    } finally {
      setEditBusy(false);
    }
  };

  const removeMine = async (row: BoardRow) => {
    if (!(await confirm({
      message: t("이 제안을 삭제할까요? 달린 답변도 함께 삭제됩니다."),
      confirmLabel: t("삭제"), danger: true,
    }))) return;
    setActErr(false);
    try {
      await deleteMyFeedback(row.id);
      setRows((cur) => (cur ?? []).filter((r) => r.id !== row.id));
      setThreadId(null);
    } catch {
      setActErr(true);
    }
  };

  // ── 작성 폼 상태 (종전 그대로) ──
  const [kind, setKind] = useState<FeedbackKind>("feature");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [statusText, setStatusText] = useState("");
  // 첨부 이미지 (사용자 요청 2026-08-05: 최대 3장). 고르면 미리보기만 만들고,
  // R2 업로드는 **보내기 시점**에 한다 — 쓰다 만 제안의 이미지가 버킷에 남지 않게.
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // objectURL은 우리가 만들었으니 우리가 해제한다 — 단 **언마운트 때만**. images를 deps에
  // 넣으면 장을 추가할 때마다 아직 쓰는 미리보기까지 해제된다.
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => () => { imagesRef.current.forEach((img) => URL.revokeObjectURL(img.preview)); }, []);

  // ⚠ FileList는 라이브 객체다 — input.value=""로 비우면 나중에 도는 상태 갱신에서
  //   빈 목록이 된다 (실측: 2장 첨부가 0장으로). 핸들러에서 배열로 스냅샷해 넘길 것.
  const addImages = (picked: File[]) => {
    const room = FEEDBACK_IMG_MAX - imagesRef.current.length;
    if (room <= 0) { setStatusText(t("이미지는 최대 {n}장까지 첨부할 수 있습니다", { n: FEEDBACK_IMG_MAX })); return; }
    const ok: { file: File; preview: string }[] = [];
    for (const file of picked) {
      if (ok.length >= room) break;
      if (!file.type.startsWith("image/")) continue;
      if (file.size > FEEDBACK_IMG_MB * 1024 * 1024) {
        setStatusText(t("이미지는 장당 {n}MB 이하만 첨부할 수 있습니다", { n: FEEDBACK_IMG_MB }));
        continue;
      }
      ok.push({ file, preview: URL.createObjectURL(file) });
    }
    if (ok.length) { setStatusText(""); setImages((cur) => [...cur, ...ok].slice(0, FEEDBACK_IMG_MAX)); }
  };

  const removeImage = (idx: number) => {
    setImages((cur) => {
      URL.revokeObjectURL(cur[idx]?.preview ?? "");
      return cur.filter((_, i) => i !== idx);
    });
  };

  // 클립보드 붙여넣기 — 작성 화면이 열려 있는 동안 어디에 포커스가 있든 받는다
  // (스크린샷을 캡처해 바로 Ctrl+V 하는 흐름이 가장 흔하다, 사용자 요청 2026-08-05)
  useEffect(() => {
    if (!open || view !== "compose") return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length) { e.preventDefault(); addImages(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view]);

  const submit = async () => {
    if (!message.trim() || status === "sending") return;
    setStatus("sending");
    setStatusText("");
    try {
      // 이미지 먼저 R2로 — 하나라도 실패하면 제안 자체를 보내지 않는다 (반쪽 전송 방지)
      const urls: string[] = [];
      for (const img of images) urls.push(await uploadFeedbackImage(img.file));
      await sendFeedback(kind, message.trim(), urls.length ? { images: urls } : undefined);
      setStatus("done");
      setMessage("");
      setImages((cur) => { cur.forEach((img) => URL.revokeObjectURL(img.preview)); return []; });
      setTimeout(() => setStatus("idle"), 2600);
      await refresh(true); // 방금 보낸 제안이 목록 맨 위에 뜨도록
      setView("list");
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2600);
    }
  };

  const copyCode = () => {
    if (!token) return;
    navigator.clipboard?.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const applyCode = async () => {
    const v = codeVal.trim();
    if (setFeedbackToken(v)) {
      // uuid 형식 → 열람 코드 (다른 기기 이어보기)
      setCodeErr(false);
      setCodeOpen(false);
      setCodeVal("");
      void refresh(true);
      return;
    }
    // uuid가 아니면 관리자 키로 시도 — 틀리면 겉으론 형식 오류와 동일하게 보인다.
    // 하한 8자 = make-admin-rotate-sql.mjs --allow-short 하한과 동일 (2026-08-17 사용자
    // 키 9자로 교체하며 20자 → 8자. 확인은 요청 1회짜리 probe라 오타에 낭비될 것도 없다)
    if (v.length >= 8 && (await probeBoardAdminKey(v))) {
      setBoardAdminKey(v);
      setCodeErr(false);
      setCodeOpen(false);
      setCodeVal("");
      void refresh(true);
      return;
    }
    setCodeErr(true);
  };

  const DT_LOC = locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR";
  // 제안·답변 시각은 초까지 (사용자 지시 2026-08-17: "시간 분 초까지 다 나오게")
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(DT_LOC, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  // 개발자 코멘트는 DB에 날짜만 있다(released_at date) — 시각 없이 날짜만
  const fmtDay = (iso: string) =>
    new Date(iso).toLocaleDateString(DT_LOC, { year: "numeric", month: "short", day: "numeric" });

  const KIND_KEY: Record<FeedbackKind, string> = { feature: "기능 제안", data_error: "데이터 오류 리포트", plan: "편성 제안" };
  const isNewReply = (iso: string) => newSince !== undefined && (!newSince || iso > newSince);

  if (!feedbackReady) return null;

  // 개발자 코멘트 탭 — 모두에게 공개 (devnote-* 스타일은 종전 업데이트 내역 뷰의 것을 재사용)
  const notesView = (
    <div className="fb-notes">
      <p className="devnote-intro">{t("여러분이 보내 주신 제안·피드백에 대한 답변입니다 — 무엇이 반영되고, 무엇이 왜 어려운지 남깁니다.")}</p>
      {notes === null && !notesError && <p className="fb-board-empty">{t("불러오는 중…")}</p>}
      {notesError && <p className="fb-board-empty">{t("개발자 코멘트를 불러오지 못했습니다 — 잠시 뒤 다시 시도해 주세요.")}</p>}
      {notes !== null && !notesError && notes.length === 0 && (
        <p className="fb-board-empty">{t("아직 등록된 개발자 코멘트가 없습니다.")}</p>
      )}
      <ul>
        {(notes ?? []).map((row) => (
          <li key={row.id} className="devnote">
            <span className={`chlog-kind devnote-status ${row.status}`}>{t(DEVNOTE_STATUS_LABEL[row.status])}</span>
            <div className="devnote-body">
              <button type="button" className="devnote-q" onClick={() => setNoteId(row.id)}>
                <span>{noteSuggestion(row, locale)}</span>
                <i aria-hidden>›</i>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  // 관리자 기본 보기는 대응완료 가림 (/admin '대응미완료'와 같은 감각)
  const reviewedCount = adminKey ? (rows ?? []).filter((r) => r.reviewed_at).length : 0;
  const shownRows = adminKey && !showReviewed ? (rows ?? []).filter((r) => !r.reviewed_at) : rows ?? [];

  const mineView = (<>
      <div className="fb-list-tools">
        {adminKey ? (<>
          <small className="fb-privacy">🛠 {t("관리자 모드 — 모든 제안이 보입니다")}</small>
          {reviewedCount > 0 && (
            <button type="button" className="fb-tool-btn" aria-pressed={showReviewed} onClick={() => setShowReviewed((s) => !s)}>
              {showReviewed ? t("대응완료 가리기") : `${t("대응완료 보기")} (${reviewedCount})`}
            </button>
          )}
        </>) : (<>
          <button type="button" className="fb-new-btn" onClick={() => setView("compose")}>+ {t("제안하기")}</button>
          <small className="fb-privacy">{t("제안은 작성자 본인과 개발자만 볼 수 있습니다")}</small>
        </>)}
        <button type="button" className="fb-tool-btn fb-refresh-btn" title={t("새로고침")} onClick={() => void refresh(true)}>↻</button>
      </div>
      {loadError ? (
        <p className="fb-board-empty">
          {t("제안 목록을 불러오지 못했습니다")}{" "}
          <button type="button" className="fb-retry-btn" onClick={() => void refresh(true)}>{t("다시 시도")}</button>
        </p>
      ) : rows === null ? (
        <p className="fb-board-empty">{t("불러오는 중…")}</p>
      ) : rows.length === 0 ? (
        <p className="fb-board-empty">
          {t("아직 보낸 제안이 없습니다")}<br />
          <small>{t("답변이 달리면 여기와 제안 버튼 뱃지로 알려드립니다")}</small>
        </p>
      ) : shownRows.length === 0 ? (
        <p className="fb-board-empty">{t("대응미완료 제안이 없습니다")}</p>
      ) : (
        <ul className="fb-board">
          {shownRows.map((row) => {
            const hasNew = row.feedback_replies.some((rep) => isNewReply(rep.created_at));
            return (
              <li key={row.id} className={`fb-board-item${adminKey && row.reviewed_at ? " reviewed" : ""}`}>
                <button type="button" className="fb-board-head" onClick={() => openThread(row.id)}>
                  <span className={`fb-kind-chip k-${row.kind}`}>{t(KIND_KEY[row.kind] ?? row.kind)}</span>
                  <time>{fmtDate(row.created_at)}</time>
                  {row.feedback_replies.length > 0 && (
                    <span className={`fb-reply-chip${hasNew ? " has-new" : ""}`} title={hasNew ? t("새 답변") : undefined}>
                      💬 {t("답변 {n}개", { n: row.feedback_replies.length })}
                    </span>
                  )}
                  {!!adminKey && !!row.reviewed_at && <span className="fb-reviewed-chip">✓ {t("대응완료")}</span>}
                  {/* 발신 국가 — 관리자에게만 (사용자 요청 2026-08-19). payload.country는 전송 시 /cdn-cgi/trace에서 채워진다 */}
                  {!!adminKey && countryOf(row.payload) && (
                    <span className="fb-geo-chip" title={countryOf(row.payload)!}>{flagOf(countryOf(row.payload)!)} {countryOf(row.payload)}</span>
                  )}
                  <span className="fb-board-preview">{row.message}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="fb-code-foot">
        {adminKey ? (
          <div className="fb-code-row">
            <small>🛠 {t("관리자 모드 — 모든 제안이 보입니다")}</small>
            <button type="button" className="fb-code-toggle" onClick={exitAdmin}>{t("관리자 해제")}</button>
          </div>
        ) : (<>
        <div className="fb-code-row">
          {token && (
            <>
              <small>{t("내 열람 코드")}</small>
              <code title={token}>{token.slice(0, 8)}…</code>
              <button type="button" onClick={copyCode}>{copied ? t("복사됨") : t("복사")}</button>
            </>
          )}
          <button type="button" className="fb-code-toggle" onClick={() => setCodeOpen((o) => !o)}>
            {t("다른 기기에서 이어보기")}
          </button>
        </div>
        {codeOpen && (
          <div className="fb-code-entry">
            <input
              value={codeVal}
              onChange={(e) => { setCodeVal(e.target.value); setCodeErr(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") void applyCode(); }}
              placeholder={t("열람 코드 붙여넣기")}
              spellCheck={false}
            />
            <button type="button" onClick={() => void applyCode()}>{t("적용")}</button>
            {codeErr && <small className="fb-code-err">{t("코드 형식이 올바르지 않습니다")}</small>}
            {!codeErr && !!rows?.length && (
              <small className="fb-code-warn">{t("코드를 적용하면 이 브라우저의 기존 제안 {n}건은 목록에서 사라집니다 — 필요하면 현재 열람 코드를 먼저 복사해 두세요", { n: rows.length })}</small>
            )}
          </div>
        )}
        {token && !codeOpen && <small className="fb-code-hint">{t("이 코드를 다른 기기에서 입력하면 같은 목록을 볼 수 있습니다")}</small>}
        </>)}
      </footer>
  </>);

  const board = (
    <div className="feedback-panel fb-board-panel">
      <div className="fb-tabs">
        <button type="button" className={tab === "mine" ? "selected" : ""} onClick={() => setTab("mine")}>{t("내 제안")}</button>
        <button type="button" className={tab === "notes" ? "selected" : ""} onClick={() => setTab("notes")}>💬 {t("개발자 코멘트")}</button>
      </div>
      {tab === "notes" ? notesView : mineView}
    </div>
  );

  const compose = (
    /* 패널 전체가 이미지 드롭 대상 — 끌어다 놓아도, 붙여넣어도, 눌러 골라도 된다 */
    <div className={`feedback-panel${dragOver ? " dragover" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); addImages(Array.from(e.dataTransfer.files ?? [])); }}>
      <div className="fb-compose-top">
        <button type="button" className="fb-back-btn" onClick={() => setView("list")}>‹ {t("뒤로")}</button>
      </div>
      <div className="feedback-kind">
        <button type="button" className={kind === "feature" ? "selected" : ""} onClick={() => setKind("feature")}>{t("기능 제안")}</button>
        <button type="button" className={kind === "data_error" ? "selected" : ""} onClick={() => setKind("data_error")}>{t("데이터 오류 리포트")}</button>
      </div>
      <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={4000}
        placeholder={kind === "feature" ? t("이런 기능이 있으면 좋겠어요…") : t("어떤 오퍼의 어떤 데이터가 잘못됐는지 알려주세요")} />
      {/* 첨부 줄 — 섬네일 + 추가 버튼. 3장이 차면 추가 버튼이 사라진다 */}
      <div className="fb-attach">
        {images.map((img, i) => (
          <span key={img.preview} className="fb-thumb">
            <img src={img.preview} alt="" />
            <button type="button" aria-label={t("첨부 삭제")} onClick={() => removeImage(i)}>×</button>
          </span>
        ))}
        {images.length < FEEDBACK_IMG_MAX && (
          <button type="button" className="fb-attach-btn" onClick={() => fileRef.current?.click()}
            title={t("스크린샷 등 이미지 최대 {n}장 (장당 {m}MB 이하)", { n: FEEDBACK_IMG_MAX, m: FEEDBACK_IMG_MB })}>
            📎 {t("이미지 첨부")} {images.length > 0 ? `${images.length}/${FEEDBACK_IMG_MAX}` : ""}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden
          onChange={(e) => { addImages(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>
      <p className="fb-attach-hint">{t("이미지를 끌어다 놓거나 붙여넣기(Ctrl+V)도 됩니다")}</p>
      <footer>
        <small>{status === "done" ? t("보냈습니다, 감사합니다!") : status === "error" ? t("전송 실패 — 잠시 후 다시 시도해주세요") : statusText || t("익명으로 전송됩니다")}</small>
        <button type="button" className="feedback-send" disabled={!message.trim() || status === "sending"} onClick={submit}>
          {status === "sending" ? t("전송 중…") : t("보내기")}
        </button>
      </footer>
      {dragOver && <div className="fb-drop-veil">{t("여기에 놓으면 첨부됩니다")}</div>}
    </div>
  );

  // 목록 클릭으로 여는 두 번째 창 — 목록 높이는 그대로, 스레드/코멘트는 창모달에서
  const threadRow = threadId ? (rows ?? []).find((r) => r.id === threadId) ?? null : null;
  const threadImgs = threadRow ? imagesOf(threadRow.payload) : [];
  const noteRow = noteId ? (notes ?? []).find((n) => n.id === noteId) ?? null : null;

  return (
    <div className="feedback-widget">
      {open && (
        <ModalWindow label={t("제안 게시판")} className="feedback-modal" onClose={close}>
          {view === "list" ? board : compose}
        </ModalWindow>
      )}
      {open && threadRow && (
        <ModalWindow label={t(KIND_KEY[threadRow.kind] ?? threadRow.kind)} className="fb-thread-modal" onClose={() => setThreadId(null)}>
          <div className="fb-thread fb-modal-thread">
            <time className="fb-thread-date">
              {fmtDate(threadRow.created_at)}
              {!!adminKey && countryOf(threadRow.payload) && (
                <span className="fb-geo-chip">{flagOf(countryOf(threadRow.payload)!)} {countryOf(threadRow.payload)}</span>
              )}
            </time>
            {editingId === threadRow.id ? (
              <div className="fb-edit-area">
                <textarea value={editVal} onChange={(e) => setEditVal(e.target.value)} rows={4} maxLength={4000} />
                <div className="fb-thread-tools">
                  <button type="button" className="fb-tool-btn" disabled={!editVal.trim() || editBusy} onClick={() => void saveEdit(threadRow)}>
                    {editBusy ? t("전송 중…") : t("저장")}
                  </button>
                  <button type="button" className="fb-tool-btn" onClick={() => setEditingId(null)}>{t("취소")}</button>
                </div>
              </div>
            ) : (
              <p className="fb-thread-msg">{threadRow.message}</p>
            )}
            {threadImgs.length > 0 && (
              <div className="fb-images">
                {threadImgs.map((u) => (
                  <button key={u} type="button" className="fb-img-zoom-btn" title={t("이미지 크게 보기")} onClick={() => setZoomSrc(u)}>
                    <img src={u} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
            {threadRow.feedback_replies.length === 0 ? (
              !adminKey && <p className="fb-noreply">{t("아직 답변이 없습니다")}</p>
            ) : threadRow.feedback_replies.map((rep) => (
              <div key={rep.id} className={`fb-reply${isNewReply(rep.created_at) ? " unread" : ""}`}>
                <header>
                  <b>🛠 {t("개발자")}</b>
                  {isNewReply(rep.created_at) && <i className="fb-new-tag">{t("새 답변")}</i>}
                  <time>{fmtDate(rep.created_at)}</time>
                  {adminKey && (
                    <button type="button" className="fb-reply-del" title={t("삭제")}
                      onClick={() => void removeReplyAdmin(threadRow, rep.id)}>×</button>
                  )}
                </header>
                <p>{rep.body}</p>
              </div>
            ))}
            {adminKey ? (<>
              {threadRow.author_token ? (
                <div className="fb-admin-reply-form">
                  <textarea value={replyVal} onChange={(e) => setReplyVal(e.target.value)} rows={2} maxLength={4000}
                    placeholder={t("작성자에게만 보이는 답변 달기…")} />
                  <button type="button" disabled={!replyVal.trim() || replyBusy} onClick={() => void sendReply(threadRow)}>
                    {replyBusy ? t("등록 중…") : t("답변 등록")}
                  </button>
                </div>
              ) : (
                <small className="fb-admin-reply-hint">{t("익명 제안 — 답변해도 작성자가 볼 수 없습니다")}</small>
              )}
              <div className="fb-thread-tools">
                <button type="button" className="fb-tool-btn" aria-pressed={!!threadRow.reviewed_at} onClick={() => void toggleReviewedAdmin(threadRow)}>
                  {threadRow.reviewed_at ? t("대응 취소") : `✓ ${t("대응완료")}`}
                </button>
                <button type="button" className="fb-tool-btn danger" onClick={() => void removeFeedbackAdmin(threadRow)}>{t("삭제")}</button>
              </div>
            </>) : editingId !== threadRow.id && (
              <div className="fb-thread-tools">
                <button type="button" className="fb-tool-btn" onClick={() => startEdit(threadRow)}>{t("수정하기")}</button>
                <button type="button" className="fb-tool-btn danger" onClick={() => void removeMine(threadRow)}>{t("삭제")}</button>
              </div>
            )}
            {actErr && <small className="fb-act-err">{t("실패했습니다 — 잠시 후 다시 시도해주세요")}</small>}
          </div>
        </ModalWindow>
      )}
      {open && noteRow && (
        <ModalWindow label={t("개발자 코멘트")} className="fb-thread-modal" onClose={() => setNoteId(null)}>
          <div className="fb-thread fb-modal-thread">
            <div className="fb-note-head">
              <span className={`chlog-kind devnote-status ${noteRow.status}`}>{t(DEVNOTE_STATUS_LABEL[noteRow.status])}</span>
              <time className="fb-thread-date">{fmtDay(`${noteRow.released_at}T00:00:00+09:00`)}</time>
            </div>
            <p className="fb-note-q">{noteSuggestion(noteRow, locale)}</p>
            <p className="devnote-reply">{noteReply(noteRow, locale)}</p>
            {noteRow.image && (
              <button type="button" className="fb-img-zoom-btn" title={t("이미지 크게 보기")} onClick={() => setZoomSrc(noteRow.image)}>
                <img className="devnote-img" src={noteRow.image} alt="" loading="lazy" />
              </button>
            )}
          </div>
        </ModalWindow>
      )}
      <button type="button" className="feedback-fab" onClick={() => (open ? close() : setOpen(true))} aria-label={t("제안 게시판")}>
        {open ? t("닫기") : t("💬 제안")}
        {!open && badge > 0 && <span className="fb-reply-badge" title={t("새 답변 {n}개", { n: badge })}>{badge}</span>}
        {!open && badge === 0 && isNewFeature("feedback-board") && <span className="new-badge">{t("새기능")}</span>}
      </button>
      {/* modal-backdrop 클래스 = 전역 esc-close 편입 — z 최상단이라 ESC가 이것만 닫고,
          아래 창모달은 유지된다 (esc-close.ts는 백드롭 mousedown을 디스패치한다) */}
      {zoomSrc && createPortal(
        <div className="modal-backdrop fb-lightbox" role="button" aria-label={t("닫기")}
          onMouseDown={() => setZoomSrc(null)}>
          <img src={zoomSrc} alt="" />
        </div>,
        document.body
      )}
      {confirmDialog}
    </div>
  );
}
