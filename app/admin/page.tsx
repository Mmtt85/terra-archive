"use client";

import { useEffect, useState } from "react";
import { adminAddReply, adminDeleteFeedback, adminDeleteReply, adminListFeedback, adminMe, adminSetHandling, adminSetReviewed, handlingAt, imagesOf, withHandling, type FeedbackRow } from "../feedback";
import { adminDeleteRelease, adminDeleteRule, adminListRules, adminPublishRelease, adminUpsertRule, fetchLatestRelease, type ReleaseRow } from "../rules-api";
import { adminDeleteChange, adminUpsertChange, fetchAllChanges, areaOf, CHANGE_KINDS, CHANGE_KIND_LABEL, CHANGE_AREAS, CHANGE_AREA_LABEL, daysAgoKst, type ChangeArea, type ChangeDraft, type ChangeRow } from "../changelog-api";
import { adminDeleteTip, adminUpsertTip, fetchAllTips, type TipDraft, type TipRow } from "../tips-api";
import { adminDeleteDevNote, adminUpsertDevNote, fetchAllDevNotes, DEVNOTE_STATUSES, DEVNOTE_STATUS_LABEL, type DevNoteDraft, type DevNoteRow } from "../devnotes-api";
import { adminDeleteFile, adminListFiles, adminUploadFile, formatSize, isImageKey, type StoredFile } from "../files-api";
import { useConfirm } from "../confirm";
import { compileSnapshot, validateRules, RULE_KINDS, type RuleRow } from "../rules-compile";
import { RULES as bundledRules } from "../rules";
import operatorsData from "../data/operators.json";
import recruitData from "../data/recruit.json";
import farmData from "../data/farm.json";

// 크론 워커가 매일 클뜯 레포에서 뽑아둔 최신 오퍼 목록·공채 풀 요약.
// 여기(브라우저)서 사이트에 번들된 데이터와 비교해 "갱신 필요" 여부를 판단한다.
const DATACHECK_API = "https://terra-archive-broadcast.nzkonaru.workers.dev/datacheck";
type DataCheck = {
  updated: string;
  operators: { id: string; name: string; rarity: number; obtainable: boolean }[];
  recruit: { name: string; rarity: number }[];
  // 펭귄 물류 기준 "지금 KR에 열려 있는 파밍 스테이지·재료" 세트 (워커 불통 시 null)
  farm?: { stages: string[]; items: string[] } | null;
};

const KIND_LABEL: Record<string, string> = { feature: "기능 제안", data_error: "데이터 오류", plan: "편성 제안" };
const OP_NAME = new Map((operatorsData as { id: string; name: string }[]).map((op) => [op.id, op.name]));

// 제안 게시판 답변 폼 — 그 제안의 작성자(열람 토큰 보유 브라우저)만 볼 수 있는 답변을 단다
// (docs/supabase-feedback-board.sql). 실패 시 텍스트를 지우지 않는다 — 상태줄이 알린다.
function AdminReplyForm({ onSubmit }: { onSubmit: (body: string) => Promise<void> }) {
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const body = val.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await onSubmit(body); setVal(""); } catch { /* 상태줄에 표시됨 */ } finally { setBusy(false); }
  };
  return (
    <div className="fb-admin-reply-form">
      <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={2} maxLength={4000}
        placeholder="작성자에게만 보이는 답변 달기…" />
      <button onClick={send} disabled={!val.trim() || busy}>{busy ? "등록 중…" : "답변 등록"}</button>
    </div>
  );
}

// 플래너 지식 베이스(docs/PLANNER-RULES-DB.md) — 규칙 종류 표시명
const RULE_KIND_LABEL: Record<RuleRow["kind"], string> = {
  constant: "엔진 상수", parser: "파서 상수", token: "토큰 카탈로그",
  skill_override: "파싱 교정", synergy_set: "시너지 세트", fixture: "정배 픽스처", doc: "섹션 문서",
};

// 규칙 편집 폼 — body는 JSON 텍스트로 직접 편집 (저장 시 파싱 검증)
function RuleEditor({ rule, onSave, onCancel }: { rule: RuleRow; onSave: (next: RuleRow) => Promise<void>; onCancel: () => void }) {
  const isNew = !rule.id;
  const [key, setKey] = useState(rule.key);
  const [bodyText, setBodyText] = useState(JSON.stringify(rule.body, null, 2));
  const [status, setStatus] = useState<RuleRow["status"]>(rule.status);
  const [note, setNote] = useState(rule.note ?? "");
  const [seq, setSeq] = useState(String(rule.seq));
  const [error, setError] = useState("");
  const save = async () => {
    let body: Record<string, unknown>;
    try { body = JSON.parse(bodyText); } catch { setError("body가 올바른 JSON이 아닙니다"); return; }
    if (!key.trim()) { setError("key를 입력하세요"); return; }
    try {
      await onSave({ ...rule, key: key.trim(), body, status, note: note || null, seq: Number(seq) || 0 });
    } catch (err) { setError(String((err as Error).message ?? err)); }
  };
  return (
    <div className="rule-editor">
      <header>
        <b>{RULE_KIND_LABEL[rule.kind]}</b>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="key" disabled={!isNew}
          title={isNew ? "규칙 키 (kind 안에서 유일)" : "키 변경은 삭제 후 재생성으로"} />
        <select value={status} onChange={(e) => setStatus(e.target.value as RuleRow["status"])}>
          <option value="active">active (발행 포함)</option>
          <option value="draft">draft (발행 보류)</option>
          <option value="retired">retired (퇴역)</option>
        </select>
        <input className="rule-seq" value={seq} onChange={(e) => setSeq(e.target.value)} title="섹션 내 정렬 순서 (tokens는 파서 매칭 순서에 영향)" />
      </header>
      <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={Math.min(16, bodyText.split("\n").length + 2)} spellCheck={false} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모 (출처·근거 — 예: 사용자 확정 2026-07, feedback:<id>)" />
      {error && <p className="admin-status">{error}</p>}
      <div className="admin-tools">
        <button onClick={save}>저장</button>
        <button onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 업데이트 내역 편집기 (docs/supabase-changelog.sql) ──────────────────────────
// 저장 즉시 사이트 헤더 🛠 모달에 뜬다 (빌드·배포 불필요). ko는 필수, en/ja는 비우면 ko로 폴백.
function ChangeEditor({ row, onSave, onCancel }: { row: ChangeDraft; onSave: (next: ChangeDraft) => Promise<void>; onCancel: () => void }) {
  const [date, setDate] = useState(row.released_at);
  const [kind, setKind] = useState(row.kind);
  // 영역 — 배지가 '인프라 개선'처럼 읽히게 한다. 비워 두면 사이트가 href로 유추한다(areaOf).
  const [area, setArea] = useState(row.area ?? areaOf(row as ChangeRow));
  const [ko, setKo] = useState(row.ko);
  const [en, setEn] = useState(row.en ?? "");
  const [ja, setJa] = useState(row.ja ?? "");
  const [href, setHref] = useState(row.href ?? "");
  const [seq, setSeq] = useState(String(row.seq));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!ko.trim()) { setError("한국어 본문은 필수입니다"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError("날짜는 YYYY-MM-DD 형식이어야 합니다"); return; }
    setSaving(true);
    try {
      await onSave({ ...row, released_at: date, kind, area, ko, en, ja, href, seq: Number(seq) || 0 });
    } catch (err) { setError(String((err as Error).message ?? err)); }
    setSaving(false);
  };
  return (
    <div className="rule-editor chlog-editor">
      <header>
        <b>{row.id ? "항목 편집" : "새 항목"}</b>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title="표시·정렬 기준일" />
        <select value={area} onChange={(e) => setArea(e.target.value as ChangeArea)} title="어느 기능 이야기인가 — 배지에 '인프라 개선'처럼 붙는다">
          {CHANGE_AREAS.map((a) => <option key={a} value={a}>{CHANGE_AREA_LABEL[a]}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as ChangeRow["kind"])}>
          {CHANGE_KINDS.map((k) => <option key={k} value={k}>{CHANGE_KIND_LABEL[k]}</option>)}
        </select>
        <input className="rule-seq" value={seq} onChange={(e) => setSeq(e.target.value)} title="같은 날짜 안 정렬 (작을수록 위)" />
      </header>
      <textarea value={ko} onChange={(e) => setKo(e.target.value)} rows={3} placeholder="한국어 본문 (필수) — 사용자가 읽을 문장 그대로" />
      <textarea value={en} onChange={(e) => setEn(e.target.value)} rows={3} placeholder="English (비우면 한국어로 표시됩니다)" />
      <textarea value={ja} onChange={(e) => setJa(e.target.value)} rows={3} placeholder="日本語 (비우면 한국어로 표시됩니다)" />
      <input value={href} onChange={(e) => setHref(e.target.value)} placeholder="바로가기 경로 (선택) — 예: /infra#roster-import · /rogue#replay" />
      {error && <p className="admin-status">{error}</p>}
      <div className="admin-tools">
        <button onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
        <button onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// 이미지 입력칸 옆의 "올리기" 버튼 — 파일을 고르면 R2에 올리고 URL을 칸에 채운다
function UploadButton({ onPick }: { onPick: (file: File) => void }) {
  return (
    <label className="file-pick-btn" title="파일을 R2에 올리고 URL을 채웁니다">
      올리기
      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = ""; // 같은 파일을 다시 골라도 change가 뜨게
        }}
      />
    </label>
  );
}

// ── 팁 풍선 편집기 (docs/supabase-tips.sql) ─────────────────────────────────────
// 제목은 풍선에 접힌 채로 보이므로 짧게. 이미지는 사이트 내부 경로(/about/*.webp 등)나
// 파일 저장소(R2) URL — 옆의 올리기 버튼으로 그 자리에서 올릴 수 있다.
function TipEditor({ row, onSave, onCancel, upload }: { row: TipDraft; onSave: (next: TipDraft) => Promise<void>; onCancel: () => void; upload?: (file: File) => Promise<string> }) {
  const [v, setV] = useState<TipDraft>(row);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<TipDraft>) => setV((cur) => ({ ...cur, ...patch }));
  const pickImage = (field: "image" | "image_dark") => async (file: File) => {
    if (!upload) return;
    setError("");
    try { set({ [field]: await upload(file) }); }
    catch (err) { setError(String((err as Error).message ?? err)); }
  };
  const save = async () => {
    if (!v.title_ko.trim() || !v.body_ko.trim()) { setError("한국어 제목·설명은 필수입니다"); return; }
    setSaving(true);
    try { await onSave(v); } catch (err) { setError(String((err as Error).message ?? err)); }
    setSaving(false);
  };
  return (
    <div className="rule-editor chlog-editor">
      <header>
        <b>{row.id ? "팁 편집" : "새 팁"}</b>
        <label className="tip-active-lbl">
          <input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} /> 표시
        </label>
        <input className="rule-seq" value={String(v.seq)} onChange={(e) => set({ seq: Number(e.target.value) || 0 })} title="정렬 순서" />
      </header>
      <input value={v.title_ko} onChange={(e) => set({ title_ko: e.target.value })} placeholder="제목 · 한국어 (필수, 20자 안팎 — 풍선에 그대로 보입니다)" />
      <input value={v.title_en ?? ""} onChange={(e) => set({ title_en: e.target.value })} placeholder="Title · English" />
      <input value={v.title_ja ?? ""} onChange={(e) => set({ title_ja: e.target.value })} placeholder="タイトル · 日本語" />
      <textarea value={v.body_ko} onChange={(e) => set({ body_ko: e.target.value })} rows={3} placeholder="설명 · 한국어 (필수) — 풍선을 펼치면 나옵니다" />
      <textarea value={v.body_en ?? ""} onChange={(e) => set({ body_en: e.target.value })} rows={3} placeholder="Description · English" />
      <textarea value={v.body_ja ?? ""} onChange={(e) => set({ body_ja: e.target.value })} rows={3} placeholder="説明 · 日本語" />
      <div className="file-inline">
        <input value={v.image ?? ""} onChange={(e) => set({ image: e.target.value })} placeholder="이미지 경로 (선택) — 예: /about/planner.webp 또는 R2 URL" />
        {upload && <UploadButton onPick={pickImage("image")} />}
      </div>
      <div className="file-inline">
        <input value={v.image_dark ?? ""} onChange={(e) => set({ image_dark: e.target.value })} placeholder="다크 모드 이미지 (선택) — 예: /about/planner-dark.webp" />
        {upload && <UploadButton onPick={pickImage("image_dark")} />}
      </div>
      <input value={v.href ?? ""} onChange={(e) => set({ href: e.target.value })} placeholder="바로가기 경로 (선택) — 예: /infra#roster-import" />
      {error && <p className="admin-status">{error}</p>}
      <div className="admin-tools">
        <button onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
        <button onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 개발자 코멘트 편집기 (docs/supabase-devnotes.sql) ──────────────────────────
// 업데이트 내역 모달의 💬 개발자 코멘트 뷰에 뜬다. 받은 제안(인용)과 답변, 선택 이미지.
// ko는 필수, en/ja는 비우면 ko로 폴백. 저장 즉시 반영 (빌드·배포 불필요).
function DevNoteEditor({ row, onSave, onCancel, upload }: { row: DevNoteDraft; onSave: (next: DevNoteDraft) => Promise<void>; onCancel: () => void; upload?: (file: File) => Promise<string> }) {
  const [v, setV] = useState<DevNoteDraft>(row);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<DevNoteDraft>) => setV((cur) => ({ ...cur, ...patch }));
  const pickImage = async (file: File) => {
    if (!upload) return;
    setError("");
    try { set({ image: await upload(file) }); }
    catch (err) { setError(String((err as Error).message ?? err)); }
  };
  const save = async () => {
    if (!v.suggestion_ko.trim() || !v.reply_ko.trim()) { setError("한국어 제안·답변은 필수입니다"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.released_at)) { setError("날짜는 YYYY-MM-DD 형식이어야 합니다"); return; }
    setSaving(true);
    try { await onSave(v); } catch (err) { setError(String((err as Error).message ?? err)); }
    setSaving(false);
  };
  return (
    <div className="rule-editor chlog-editor">
      <header>
        <b>{row.id ? "코멘트 편집" : "새 코멘트"}</b>
        <input type="date" value={v.released_at} onChange={(e) => set({ released_at: e.target.value })} title="표시·정렬 기준일" />
        <select value={v.status} onChange={(e) => set({ status: e.target.value as DevNoteRow["status"] })} title="제안 처리 상태 — 배지로 보인다">
          {DEVNOTE_STATUSES.map((s) => <option key={s} value={s}>{DEVNOTE_STATUS_LABEL[s]}</option>)}
        </select>
        <label className="tip-active-lbl">
          <input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} /> 표시
        </label>
        <input className="rule-seq" value={String(v.seq)} onChange={(e) => set({ seq: Number(e.target.value) || 0 })} title="같은 날짜 안 정렬 (작을수록 위)" />
      </header>
      <textarea value={v.suggestion_ko} onChange={(e) => set({ suggestion_ko: e.target.value })} rows={2} placeholder="받은 제안 · 한국어 (필수) — 인용문으로 보입니다" />
      <textarea value={v.suggestion_en ?? ""} onChange={(e) => set({ suggestion_en: e.target.value })} rows={2} placeholder="Suggestion · English (비우면 한국어로 표시됩니다)" />
      <textarea value={v.suggestion_ja ?? ""} onChange={(e) => set({ suggestion_ja: e.target.value })} rows={2} placeholder="提案 · 日本語" />
      <textarea value={v.reply_ko} onChange={(e) => set({ reply_ko: e.target.value })} rows={3} placeholder="개발자 답변 · 한국어 (필수) — 뭐가 되고 뭐가 왜 어려운지" />
      <textarea value={v.reply_en ?? ""} onChange={(e) => set({ reply_en: e.target.value })} rows={3} placeholder="Reply · English" />
      <textarea value={v.reply_ja ?? ""} onChange={(e) => set({ reply_ja: e.target.value })} rows={3} placeholder="返信 · 日本語" />
      <div className="file-inline">
        <input value={v.image ?? ""} onChange={(e) => set({ image: e.target.value })} placeholder="이미지 URL (선택) — R2 파일 저장소 URL 또는 사이트 내부 경로" />
        {upload && <UploadButton onPick={pickImage} />}
      </div>
      {error && <p className="admin-status">{error}</p>}
      <div className="admin-tools">
        <button onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
        <button onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 파일 저장소 표시 (R2) — 공용 행 + assets/ 폴더 트리 ─────────────────────────
function FileRow({ row, label, showDate, onStatus, onDelete }: {
  row: StoredFile; label: string; showDate?: boolean;
  onStatus: (s: string) => void; onDelete?: () => void;
}) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(row.url); onStatus(`URL 복사됨 — ${row.key}`); }
    catch { onStatus(row.url); } // 클립보드 미지원 환경이면 그냥 보여준다
  };
  return (
    <div className="rule-row file-row">
      {isImageKey(row.key)
        ? <img className="file-thumb" src={row.url} alt="" loading="lazy" />
        : <span className="file-thumb file-thumb-blank">📄</span>}
      {/* 파일 이름 클릭 = 새 탭에서 열기 (사용자 요청 2026-07-27 — 별도 열기 버튼 없음) */}
      <a className="file-name" href={row.url} target="_blank" rel="noreferrer" title={row.url}><code>{label}</code></a>
      <span className="rule-note">{formatSize(row.size)}</span>
      {showDate && <span className="rule-note">{new Date(row.uploaded).toLocaleDateString("ko-KR")}</span>}
      <button onClick={copy}>URL 복사</button>
      {onDelete && <button onClick={onDelete}>삭제</button>}
    </div>
  );
}

// 키 목록 → 중첩 폴더 트리. skip = 최상위 접두사 세그먼트 수 (assets/ = 1)
type FileTreeDir = { dirs: Map<string, FileTreeDir>; files: StoredFile[]; count: number; size: number };
function buildFileTree(rows: StoredFile[], skip: number): FileTreeDir {
  const root: FileTreeDir = { dirs: new Map(), files: [], count: 0, size: 0 };
  for (const row of rows) {
    const parts = row.key.split("/");
    let node = root;
    node.count += 1; node.size += row.size;
    for (let i = skip; i < parts.length - 1; i += 1) {
      let dir = node.dirs.get(parts[i]);
      if (!dir) { dir = { dirs: new Map(), files: [], count: 0, size: 0 }; node.dirs.set(parts[i], dir); }
      node = dir;
      node.count += 1; node.size += row.size;
    }
    node.files.push(row);
  }
  return root;
}

// 폴더 노드 — 열 때만 자식을 렌더한다 (7,700행을 한꺼번에 DOM에 올리지 않기)
const FOLDER_SHOW_MAX = 400;
function FolderNode({ name, node, depth, onStatus }: { name: string; node: FileTreeDir; depth: number; onStatus: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ftree-dir" style={depth ? { marginLeft: 16 } : undefined}>
      <button type="button" className="ftree-toggle" onClick={() => setOpen((o) => !o)}>
        <i aria-hidden>{open ? "▾" : "▸"}</i> {name}/
        <small>{node.count.toLocaleString()}개 · {formatSize(node.size)}</small>
      </button>
      {open && (
        <div className="ftree-body">
          {[...node.dirs.keys()].sort().map((sub) => (
            <FolderNode key={sub} name={sub} node={node.dirs.get(sub)!} depth={depth + 1} onStatus={onStatus} />
          ))}
          {[...node.files].sort((a, b) => (a.key < b.key ? -1 : 1)).slice(0, FOLDER_SHOW_MAX).map((row) => (
            <FileRow key={row.key} row={row} label={row.key.split("/").pop()!} onStatus={onStatus} />
          ))}
          {node.files.length > FOLDER_SHOW_MAX && (
            <p className="rule-note">… 외 {(node.files.length - FOLDER_SHOW_MAX).toLocaleString()}개 — 검색으로 찾으세요</p>
          )}
        </div>
      )}
    </div>
  );
}

// payload.page("/#infra" 등)를 사람이 읽을 라벨로 — 클릭하면 그 페이지가 새 탭에 열린다
function pageOf(payload: unknown): string | undefined {
  const page = payload && typeof payload === "object" ? (payload as { page?: unknown }).page : undefined;
  return typeof page === "string" && page ? page : undefined;
}
function pageLabel(page: string): string {
  if (page.includes("#infra")) return "인프라 자동편성기";
  if (page.includes("#recruit")) return "공개채용 도우미";
  const op = page.match(/#op-(char_[A-Za-z0-9_]+)/);
  if (op) return `오퍼 상세 · ${OP_NAME.get(op[1]) ?? op[1]}`;
  return "오퍼 백과사전";
}

export default function AdminPage() {
  // window.confirm/prompt는 VSCode 웹뷰 등 일부 임베디드 브라우저에서 미지원
  // ("prompt() is not supported" 크래시, 2026-07-22) — 사이트 공용 확인 모달로 대체
  const { confirm, dialog: confirmDialog } = useConfirm();
  // 인증은 Cloudflare Access(구글 SSO) — /api/me가 통과하면 입장 (비밀번호 게이트 제거 2026-07-27)
  const [me, setMe] = useState<string | null | undefined>(undefined); // undefined=확인 중
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("open"); // open(대응미완료) | reviewed(대응완료)
  const [tab, setTab] = useState<"feedback" | "rules" | "changelog" | "devnotes" | "tips" | "files">("feedback"); // 상단 탭
  // 팁 풍선 원장 (null = 조회 실패 → 미설치 안내)
  const [tips, setTips] = useState<TipRow[] | null>(null);
  const [tipStatus, setTipStatus] = useState("");
  const [editingTip, setEditingTip] = useState<TipDraft | null>(null);
  // 개발자 코멘트 원장 (null = 조회 실패 → 미설치 안내)
  const [devNotes, setDevNotes] = useState<DevNoteRow[] | null>(null);
  const [devNoteStatus, setDevNoteStatus] = useState("");
  const [editingDevNote, setEditingDevNote] = useState<DevNoteDraft | null>(null);
  // 파일 저장소(R2) — 워커 미배포·비밀번호 불일치면 null + 안내
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [fileStatus, setFileStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileSub, setFileSub] = useState<"uploads" | "feedback" | "assets">("uploads"); // 내 업로드 | 제안 이미지 | 사이트 에셋
  const [fileQuery, setFileQuery] = useState("");
  // 업데이트 내역 원장 (null = 조회 실패 → 미설치 안내)
  const [changes, setChanges] = useState<ChangeRow[] | null>(null);
  const [changeStatus, setChangeStatus] = useState("");
  const [editingChange, setEditingChange] = useState<ChangeDraft | null>(null);
  const [dataCheck, setDataCheck] = useState<DataCheck | null>(null);
  // 플래너 규칙 원장 + 최신 발행 (null = 조회 실패 → 미설치 안내)
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [release, setRelease] = useState<ReleaseRow | null>(null);
  const [rulesStatus, setRulesStatus] = useState("");
  const [editingRule, setEditingRule] = useState<RuleRow | null>(null);
  const [publishNote, setPublishNote] = useState(""); // 발행 메모 — prompt() 미지원 환경 대응 인라인 입력

  useEffect(() => {
    if (!me) return;
    fetch(DATACHECK_API)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (Array.isArray(data?.operators)) setDataCheck(data); })
      .catch(() => { /* 워커 불통 시 섹션이 '확인 중'으로 남음 */ });
  }, [me]);

  const load = async () => {
    setStatus("불러오는 중…");
    try {
      const data = await adminListFeedback();
      setRows(data);
      setStatus(data.length ? "" : "항목이 없습니다");
      loadRules();
      loadChanges();
      loadTips();
      loadDevNotes();
    } catch {
      setStatus("조회 실패 — 잠시 후 다시 시도해주세요");
    }
  };

  // ── 업데이트 내역 (docs/supabase-changelog.sql) — 저장하면 사이트에 바로 반영 ──
  const loadChanges = async () => {
    try {
      setChanges(await fetchAllChanges());
      setChangeStatus("");
    } catch {
      setChanges(null);
      setChangeStatus("업데이트 내역 테이블 조회 실패 — docs/supabase-changelog.sql을 Supabase SQL Editor에서 실행했는지 확인");
    }
  };

  const saveChange = async (next: ChangeDraft) => {
    await adminUpsertChange(next);
    setEditingChange(null);
    setChangeStatus(`저장됨 — 사이트 헤더 🛠 모달에 즉시 반영됩니다 (${next.released_at})`);
    loadChanges();
  };

  const removeChange = async (row: ChangeRow) => {
    if (!(await confirm({ message: `'${row.ko.slice(0, 40)}…' 항목을 삭제할까요?`, danger: true }))) return;
    try {
      await adminDeleteChange(row.id);
      setChangeStatus("삭제됨");
      loadChanges();
    } catch { setChangeStatus("삭제 실패"); }
  };

  // ── 팁 풍선 (docs/supabase-tips.sql) — 저장하면 사이트에 바로 반영 ──
  const loadTips = async () => {
    try { setTips(await fetchAllTips()); setTipStatus(""); }
    catch {
      setTips(null);
      setTipStatus("팁 테이블 조회 실패 — docs/supabase-tips.sql을 Supabase SQL Editor에서 실행했는지 확인");
    }
  };

  const saveTip = async (next: TipDraft) => {
    await adminUpsertTip(next);
    setEditingTip(null);
    setTipStatus("저장됨 — 사이트 팁 풍선에 즉시 반영됩니다");
    loadTips();
  };

  const removeTip = async (row: TipRow) => {
    if (!(await confirm({ message: `'${row.title_ko}' 팁을 삭제할까요?`, danger: true }))) return;
    try { await adminDeleteTip(row.id); setTipStatus("삭제됨"); loadTips(); }
    catch { setTipStatus("삭제 실패"); }
  };

  // ── 개발자 코멘트 (docs/supabase-devnotes.sql) — 저장하면 사이트에 바로 반영 ──
  const loadDevNotes = async () => {
    try { setDevNotes(await fetchAllDevNotes()); setDevNoteStatus(""); }
    catch {
      setDevNotes(null);
      setDevNoteStatus("개발자 코멘트 테이블 조회 실패 — docs/supabase-devnotes.sql을 Supabase SQL Editor에서 실행했는지 확인");
    }
  };

  const saveDevNote = async (next: DevNoteDraft) => {
    await adminUpsertDevNote(next);
    setEditingDevNote(null);
    setDevNoteStatus("저장됨 — 업데이트 내역 모달의 💬 개발자 코멘트에 즉시 반영됩니다");
    loadDevNotes();
  };

  const removeDevNote = async (row: DevNoteRow) => {
    if (!(await confirm({ message: `'${row.suggestion_ko.slice(0, 40)}…' 코멘트를 삭제할까요?`, danger: true }))) return;
    try { await adminDeleteDevNote(row.id); setDevNoteStatus("삭제됨"); loadDevNotes(); }
    catch { setDevNoteStatus("삭제 실패"); }
  };

  // ── 파일 저장소 (workers/upload → R2) ────────────────────────────────────────
  const loadFiles = async (pw: string) => {
    try { setFiles(await adminListFiles(pw)); setFileStatus(""); }
    catch (err) {
      setFiles(null);
      setFileStatus(`파일 목록 조회 실패 — ${String((err as Error).message ?? err)}`);
    }
  };

  // 파일 탭을 처음 열 때 목록을 불러온다 (입장 시점엔 안 부른다 — 워커가 없어도 다른 탭은 멀쩡해야)
  useEffect(() => {
    if (tab === "files" && files === null && me) loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, me]);

  const uploadPicked = async (list: FileList | File[]) => {
    const picked = [...list];
    if (!picked.length) return;
    setUploading(true);
    let done = 0;
    for (const file of picked) {
      try {
        const stored = await adminUploadFile(file);
        done += 1;
        setFileStatus(`올림 (${done}/${picked.length}) — ${stored.key}`);
      } catch (err) {
        setFileStatus(`업로드 실패: ${file.name} — ${String((err as Error).message ?? err)}`);
        break;
      }
    }
    setUploading(false);
    loadFiles();
  };

  const removeFile = async (row: StoredFile) => {
    if (!(await confirm({ message: `'${row.key}' 파일을 삭제할까요? 이 URL을 쓰는 팁·페이지에선 이미지가 깨집니다.`, danger: true }))) return;
    try { await adminDeleteFile(row.key); setFileStatus("삭제됨"); loadFiles(); }
    catch { setFileStatus("삭제 실패"); }
  };

  // 팁 편집기 이미지칸 "올리기" — 올리고 나서 공개 URL을 돌려준다
  const uploadForTip = async (file: File) => (await adminUploadFile(file)).url;

  // ── 플래너 규칙 (docs/PLANNER-RULES-DB.md Phase 2) ────────────────────────────
  const loadRules = async (pw: string) => {
    try {
      const [rows, latest] = await Promise.all([adminListRules(pw), fetchLatestRelease()]);
      setRules(rows);
      setRelease(latest);
      setRulesStatus("");
    } catch {
      setRules(null);
      setRulesStatus("플래너 규칙 테이블 조회 실패 — docs/supabase-planner-rules.sql을 Supabase SQL Editor에서 실행했는지 확인");
    }
  };

  const saveRule = async (next: RuleRow) => {
    await adminUpsertRule(next);
    setEditingRule(null);
    setRulesStatus(`저장됨: ${next.kind}/${next.key} — 발행해야 반영됩니다`);
    loadRules();
  };

  const removeRule = async (rule: RuleRow) => {
    if (!rule.id) return;
    if (!(await confirm({ message: `${RULE_KIND_LABEL[rule.kind]} '${rule.key}'를 삭제할까요? (이력을 남기려면 삭제 대신 편집에서 retired로)`, danger: true }))) return;
    try {
      await adminDeleteRule(rule.id);
      setRulesStatus(`삭제됨: ${rule.kind}/${rule.key} — 발행해야 반영됩니다`);
      loadRules();
    } catch { setRulesStatus("규칙 삭제 실패"); }
  };

  const publishRules = async () => {
    if (!rules) return;
    const errors = validateRules(rules);
    if (errors.length) { setRulesStatus(`발행 불가 — ${errors.join(" · ")}`); return; }
    const nextVersion = (release?.version ?? 0) + 1;
    const activeCount = rules.filter((row) => row.status === "active").length;
    // 발행 메모는 window.prompt 대신 발행 버튼 옆 인라인 입력(publishNote)에서 받는다
    if (!(await confirm({ message: `v${nextVersion}으로 발행할까요? (active 규칙 ${activeCount}건 · 메모: ${publishNote.trim() || "없음"})` }))) return;
    try {
      await adminPublishRelease(nextVersion, compileSnapshot(rules, nextVersion), publishNote.trim());
      setRelease(await fetchLatestRelease());
      setPublishNote("");
      setRulesStatus(`v${nextVersion} 발행 완료 — 로컬에서 python3 scripts/build-rules.py 베이크 → 안내되는 검증 절차 → 커밋·배포`);
    } catch (err) { setRulesStatus(String((err as Error).message ?? err)); }
  };

  const rollbackRelease = async () => {
    if (!release) return;
    if (!(await confirm({ message: `최신 발행 v${release.version}을 삭제(롤백)할까요? 이전 버전이 최신이 됩니다.`, danger: true }))) return;
    try {
      await adminDeleteRelease(release.version);
      setRelease(await fetchLatestRelease());
      setRulesStatus(`v${release.version} 롤백됨`);
    } catch { setRulesStatus("롤백 실패"); }
  };

  // 입장 판정 — Access(구글 SSO)를 통과했는지 /api/me로 확인하고, 통과면 바로 로드
  useEffect(() => {
    adminMe().then((email) => {
      setMe(email);
      if (email) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleReviewed = async (row: FeedbackRow) => {
    const next = !row.reviewed_at;
    try {
      await adminSetReviewed(row.id, next);
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, reviewed_at: next ? new Date().toISOString() : null } : item));
    } catch {
      setStatus("갱신 실패");
    }
  };

  const toggleHandling = async (row: FeedbackRow) => {
    const next = !handlingAt(row.payload);
    try {
      await adminSetHandling(row.id, row.payload, next);
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, payload: withHandling(item.payload, next) } : item));
    } catch {
      setStatus("갱신 실패");
    }
  };

  // 제안 게시판 답변 — 등록·삭제 후 행의 feedback_replies를 로컬 갱신 (재조회 없이)
  const addReply = async (row: FeedbackRow, body: string) => {
    try {
      const rep = await adminAddReply(row.id, body);
      setRows((current) => current.map((item) => item.id === row.id
        ? { ...item, feedback_replies: [...(item.feedback_replies ?? []), rep] } : item));
    } catch (err) {
      setStatus(`답변 등록 실패 — ${String((err as Error).message ?? err)}`);
      throw err;
    }
  };

  const removeReply = async (row: FeedbackRow, replyId: string) => {
    if (!(await confirm({ message: "이 답변을 삭제할까요?", danger: true }))) return;
    try {
      await adminDeleteReply(replyId);
      setRows((current) => current.map((item) => item.id === row.id
        ? { ...item, feedback_replies: (item.feedback_replies ?? []).filter((r) => r.id !== replyId) } : item));
    } catch {
      setStatus("답변 삭제 실패");
    }
  };

  // "한꺼번에 대응중" — 지금 보이는 목록 중 아직 대응중이 아닌 항목을 일괄 표시
  const markShownHandling = async () => {
    const targets = shown.filter((row) => !handlingAt(row.payload));
    if (!targets.length) { setStatus("이미 모두 대응중입니다"); return; }
    if (!(await confirm({ message: `표시된 ${targets.length}건을 대응중으로 표시할까요?` }))) return;
    setStatus(`대응중 표시 중… (0/${targets.length})`);
    let done = 0;
    for (const row of targets) {
      try {
        await adminSetHandling(row.id, row.payload, true);
        setRows((current) => current.map((item) => item.id === row.id ? { ...item, payload: withHandling(item.payload, true) } : item));
      } catch { /* 개별 실패는 건너뛴다 */ }
      setStatus(`대응중 표시 중… (${++done}/${targets.length})`);
    }
    setStatus(`${done}건 대응중 표시 완료`);
  };

  // 첨부 이미지 URL → R2 키 (files.terra-archive.net/<key> 또는 워커 /f/<key> 폴백 둘 다)
  const keyOfImageUrl = (u: string): string | null => {
    try {
      const path = new URL(u).pathname.replace(/^\/f\//, "/").slice(1);
      return path.split("/").map(decodeURIComponent).join("/");
    } catch { return null; }
  };

  const remove = async (row: FeedbackRow) => {
    const imgs = imagesOf(row.payload);
    const msg = imgs.length ? `이 항목과 첨부 이미지 ${imgs.length}장을 삭제할까요?` : "이 항목을 삭제할까요?";
    if (!(await confirm({ message: msg, danger: true }))) return;
    try {
      // 첨부 이미지도 R2에서 정리 (용량 관리 — 사용자 방침 2026-08-05). 개별 실패는 무시:
      // 행 삭제가 우선이고, 남은 파일은 파일 탭 '제안 이미지'에서 지울 수 있다.
      for (const u of imgs) {
        const key = keyOfImageUrl(u);
        if (key?.startsWith("feedback/")) await adminDeleteFile(key).catch(() => {});
      }
      await adminDeleteFeedback(row.id);
      setRows((current) => current.filter((item) => item.id !== row.id));
    } catch {
      setStatus("삭제 실패");
    }
  };

  // 파일 탭 파생 상태 — uploads/(수동)·feedback/(제안 첨부)·assets/(r2-sync 관할) 분리,
  // 검색은 부분 문자열 매치
  const fileFilter = fileQuery.trim().toLowerCase();
  const uploadRows = (files ?? []).filter((row) => row.key.startsWith("uploads/"));
  const feedbackRows = (files ?? []).filter((row) => row.key.startsWith("feedback/"));
  const assetRows = (files ?? []).filter((row) => !row.key.startsWith("uploads/") && !row.key.startsWith("feedback/"));
  const shownUploads = fileFilter ? uploadRows.filter((row) => row.key.toLowerCase().includes(fileFilter)) : uploadRows;
  const shownFeedback = fileFilter ? feedbackRows.filter((row) => row.key.toLowerCase().includes(fileFilter)) : feedbackRows;
  const shownAssets = fileFilter ? assetRows.filter((row) => row.key.toLowerCase().includes(fileFilter)) : assetRows;
  const assetTree = buildFileTree(assetRows, 1); // 7.7천 건 순회 — 렌더당 수 ms라 메모 불필요

  // 상태 필터는 대응완료/대응미완료 둘뿐 (사용자 요청 2026-07-19). 미완료 안에서는
  // 대응중이 맨 위, 신규가 그 아래 (사용자 요청 2026-07-21) — 같은 그룹은 최신순
  const statusRank = (row: FeedbackRow) => (row.reviewed_at ? 2 : handlingAt(row.payload) ? 0 : 1);
  const matchStatus = (row: FeedbackRow) =>
    statusFilter === "reviewed" ? Boolean(row.reviewed_at) : !row.reviewed_at;
  const shown = rows
    .filter((row) => (filter === "all" || row.kind === filter) && matchStatus(row))
    .sort((a, b) => statusRank(a) - statusRank(b) || Date.parse(b.created_at) - Date.parse(a.created_at));
  const handlingCount = rows.filter((row) => handlingAt(row.payload) && !row.reviewed_at).length;

  // 게임 데이터 비교 — 획득 불가(가짜 게스트·컬래버 잔재 등)는 사이트가 의도적으로
  // 제외한 것이므로 obtainable=true만 신규로 판정한다
  // 공채 풀 텍스트(recruitDetail)의 오탈자를 build-recruit.py NAME_FIX와 동일하게 교정한 뒤 비교한다.
  // (샤마르가 공채 풀엔 "샤미르"로 잘못 적혀 있어, 교정하지 않으면 신규/삭제 양쪽에 영원히 뜬다 — 2026-07-20)
  const RECRUIT_NAME_FIX: Record<string, string> = { "샤미르": "샤마르" };
  const fixName = (n: string): string => RECRUIT_NAME_FIX[n] ?? n;
  const localOpIds = new Set((operatorsData as { id: string }[]).map((op) => op.id));
  const localRecruitNames = new Set((recruitData as { ops: { name: string }[] }).ops.map((op) => op.name));
  const newOps = (dataCheck?.operators ?? []).filter((op) => op.obtainable && !localOpIds.has(op.id)).sort((a, b) => b.rarity - a.rarity);
  const newRecruit = (dataCheck?.recruit ?? []).filter((r) => !localRecruitNames.has(fixName(r.name))).sort((a, b) => b.rarity - a.rarity);
  const remoteRecruitNames = new Set((dataCheck?.recruit ?? []).map((r) => fixName(r.name)));
  const staleRecruit = dataCheck ? (recruitData as { ops: { name: string }[] }).ops.filter((op) => !remoteRecruitNames.has(op.name)).map((op) => op.name) : [];
  // 재료 파밍표: farm.json에 박힌 빌드 시점 세트 vs 워커의 현재 세트 —
  // 이벤트 개폐(스테이지 증감)나 신규 재료가 생기면 재생성 신호
  const farmLocal = farmData as { updated: string; openStages?: string[]; items: { id: string }[] };
  const localFarmStages = new Set(farmLocal.openStages ?? []);
  const localFarmItems = new Set(farmLocal.items.map((item) => item.id));
  const remoteFarm = dataCheck?.farm ?? null;
  const farmOpened = remoteFarm ? remoteFarm.stages.filter((sid) => !localFarmStages.has(sid)) : [];
  const farmClosed = remoteFarm ? [...localFarmStages].filter((sid) => !remoteFarm.stages.includes(sid)) : [];
  const farmNewItems = remoteFarm ? remoteFarm.items.filter((iid) => !localFarmItems.has(iid)) : [];
  const farmNeeds = farmOpened.length > 0 || farmClosed.length > 0 || farmNewItems.length > 0;
  const needsUpdate = newOps.length > 0 || newRecruit.length > 0 || farmNeeds;

  if (!me) {
    return (
      <main className="admin-gate">
        <section>
          <h1>TERRA ARCHIVE // ADMIN</h1>
          {me === undefined ? (
            <p>인증 확인 중…</p>
          ) : (
            <>
              <p>
                구글 로그인이 필요합니다 — 이 페이지는{" "}
                <a href="https://admin.terra-archive.net/admin">admin.terra-archive.net</a>에서
                Cloudflare Access(구글 SSO)를 통과해야 열립니다.
              </p>
              <p className="admin-status">
                localhost에서 개발하려면 레포 루트에 키 파일(<code>.supabase-admin-key</code> ·
                <code>.upload-admin-key</code>)이 있어야 합니다 — dev 서버가 Access 대신
                키 파일로 중계합니다 (scripts/admin-dev-proxy.ts).
              </p>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="admin">
      {confirmDialog}
      <header>
        <h1>TERRA ARCHIVE 관리</h1>
        <div className="admin-tools admin-tabs">
          <button className={tab === "feedback" ? "selected" : ""} onClick={() => setTab("feedback")}>피드백 ({rows.length})</button>
          <button className={tab === "rules" ? "selected" : ""} onClick={() => setTab("rules")}>
            플래너 규칙{release ? ` (v${release.version}${release.version !== bundledRules.version ? " ⚠" : ""})` : ""}
          </button>
          <button className={tab === "changelog" ? "selected" : ""} onClick={() => setTab("changelog")}>
            업데이트 내역{changes ? ` (${changes.length})` : ""}
          </button>
          <button className={tab === "devnotes" ? "selected" : ""} onClick={() => setTab("devnotes")}>
            개발자 코멘트{devNotes ? ` (${devNotes.filter((row) => row.active).length}/${devNotes.length})` : ""}
          </button>
          <button className={tab === "tips" ? "selected" : ""} onClick={() => setTab("tips")}>
            팁 풍선{tips ? ` (${tips.filter((row) => row.active).length}/${tips.length})` : ""}
          </button>
          <button className={tab === "files" ? "selected" : ""} onClick={() => setTab("files")}>
            파일{files ? ` (${uploadRows.length})` : ""}
          </button>
          <button onClick={() => load()}>새로고침</button>
          {/* Access 세션 종료 — 다시 들어오려면 구글 로그인 필요 */}
          <button onClick={() => { window.location.href = "/cdn-cgi/access/logout"; }}>로그아웃</button>
        </div>
      </header>
      {status && <p className="admin-status">{status}</p>}

      <section className={`data-status ${dataCheck ? (needsUpdate ? "warn" : "ok") : ""}`}>
        {!dataCheck ? (
          <p>게임 데이터 확인 중… (크론 워커 응답 대기)</p>
        ) : (
          <>
            <header>
              <b>{needsUpdate ? "⚠ 게임 데이터 갱신 필요" : "✓ 게임 데이터 최신 상태"}</b>
              <time>클뜯 레포 기준 · {new Date(dataCheck.updated).toLocaleString("ko-KR")} 확인</time>
            </header>
            {newOps.length > 0 && (
              <p>
                <b>신규 오퍼 {newOps.length}명</b> — {newOps.map((op) => `${"★".repeat(op.rarity)} ${op.name}`).join(" · ")}
                <br /><i>Claude에서 <code>/operator-data-update</code> 실행</i>
              </p>
            )}
            {newRecruit.length > 0 && (
              <p>
                <b>공채 풀 추가 {newRecruit.length}명</b> — {newRecruit.map((r) => `${"★".repeat(r.rarity)} ${r.name}`).join(" · ")}
                <br /><i>Claude에서 <code>/recruit-data-update</code> 실행</i>
              </p>
            )}
            {farmNeeds && (
              <p>
                <b>재료 파밍표 갱신 필요</b>
                {farmOpened.length > 0 && <> — 새로 열린 파밍 스테이지 {farmOpened.length}개 ({farmOpened.slice(0, 8).join(" · ")}{farmOpened.length > 8 ? " …" : ""})</>}
                {farmClosed.length > 0 && <> — 닫힌 스테이지 {farmClosed.length}개 ({farmClosed.slice(0, 8).join(" · ")}{farmClosed.length > 8 ? " …" : ""})</>}
                {farmNewItems.length > 0 && <> — 신규 재료 {farmNewItems.length}종 ({farmNewItems.join(" · ")})</>}
                <br /><i>Claude에서 <code>/farm-data-update</code> 실행 (farm.json 기준일 {farmLocal.updated})</i>
              </p>
            )}
            {staleRecruit.length > 0 && (
              <p className="data-status-minor">참고 · 사이트 공채 풀에만 있는 오퍼 (데이터마인 미반영이면 정상): {staleRecruit.join(" · ")}</p>
            )}
            {remoteFarm == null && (
              <p className="data-status-minor">참고 · 파밍표 신선도는 다음 크론 수집(매일 11:41 KST) 후 표시됩니다.</p>
            )}
          </>
        )}
      </section>

      {tab === "feedback" && (<>
      <div className="admin-tools admin-status-tools">
        {["all", "feature", "data_error", "plan"].map((kind) => (
          <button key={kind} className={filter === kind ? "selected" : ""} onClick={() => setFilter(kind)}>
            {kind === "all" ? "전체" : KIND_LABEL[kind]} ({kind === "all" ? rows.length : rows.filter((row) => row.kind === kind).length})
          </button>
        ))}
        {([["open", "대응미완료"], ["reviewed", "대응완료"]] as const).map(([key, label]) => (
          <button key={key} className={statusFilter === key ? "selected" : ""} onClick={() => setStatusFilter(key)}>
            {label} ({rows.filter((row) => (key === "reviewed" ? row.reviewed_at : !row.reviewed_at)).length})
          </button>
        ))}
        <button className="bulk-handling-btn" onClick={markShownHandling} title="지금 보이는 목록을 한꺼번에 대응중으로 표시">🔧 표시된 항목 일괄 대응중{handlingCount ? ` (현재 ${handlingCount})` : ""}</button>
      </div>
      <div className="admin-list">
        {shown.map((row) => (
          <article key={row.id} className={`admin-row kind-${row.kind}${row.reviewed_at ? " reviewed" : ""}${handlingAt(row.payload) && !row.reviewed_at ? " handling" : ""}`}>
            <header>
              <code className="fb-id" title={`${row.id} — 클릭하면 전체 ID 복사`}
                onClick={() => { navigator.clipboard?.writeText(row.id).then(() => setStatus(`ID 복사됨: ${row.id}`)).catch(() => {}); }}>
                #{row.id.slice(0, 8)}
              </code>
              <b>{KIND_LABEL[row.kind] ?? row.kind}</b>
              {pageOf(row.payload) && (
                <a className="page-chip" href={pageOf(row.payload)} target="_blank" rel="noreferrer" title={`보낸 페이지 열기: ${pageOf(row.payload)}`}>
                  📍 {pageLabel(pageOf(row.payload)!)}
                </a>
              )}
              {handlingAt(row.payload) && !row.reviewed_at && <i className="handling-badge" title={new Date(handlingAt(row.payload)!).toLocaleString("ko-KR")}>🔧 대응중</i>}
              {row.reviewed_at && <i className="reviewed-badge" title={new Date(row.reviewed_at).toLocaleString("ko-KR")}>✓ 확인됨</i>}
              <time>{new Date(row.created_at).toLocaleString("ko-KR")}</time>
              <button className="handling-btn" onClick={() => toggleHandling(row)}>{handlingAt(row.payload) ? "대응 해제" : "대응중"}</button>
              <button className="review-btn" onClick={() => toggleReviewed(row)}>{row.reviewed_at ? "대응 취소" : "대응완료"}</button>
              <button onClick={() => remove(row)}>삭제</button>
            </header>
            {row.message && <p>{row.message}</p>}
            {imagesOf(row.payload).length > 0 && (
              <div className="fb-images">
                {imagesOf(row.payload).map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" title={u}>
                    <img src={u} alt="" loading="lazy" />
                  </a>
                ))}
              </div>
            )}
            {/* 게시판 답변 스레드 — 작성자(열람 토큰)와 나만 본다. 토큰 없는 구형 익명
                제안은 작성자가 볼 방법이 없으므로 답변 폼 대신 안내만 띄운다. */}
            <div className="fb-admin-replies">
              {(row.feedback_replies ?? []).map((rep) => (
                <div key={rep.id} className="fb-admin-reply">
                  <span className="fb-admin-reply-body">{rep.body}</span>
                  <time>{new Date(rep.created_at).toLocaleString("ko-KR")}</time>
                  <button onClick={() => removeReply(row, rep.id)}>삭제</button>
                </div>
              ))}
              {row.author_token
                ? <AdminReplyForm onSubmit={(body) => addReply(row, body)} />
                : <small className="fb-admin-reply-hint">게시판 개편(2026-08-17) 전 익명 제안 — 답변해도 작성자가 볼 수 없습니다</small>}
            </div>
            {row.payload != null && (
              <details>
                <summary>payload 보기</summary>
                <pre>{JSON.stringify(row.payload, null, 2)}</pre>
              </details>
            )}
          </article>
        ))}
        {shown.length === 0 && <p className="admin-status">표시할 항목이 없습니다.</p>}
      </div>
      </>)}

      {tab === "changelog" && (<>
      <p className="admin-status">
        여기에 저장하면 <b>배포 없이</b> 사이트 헤더 🛠 업데이트 내역에 바로 뜹니다.
        기본 표시는 최근 7일치·신기능만이고, 그 이전 항목은 방문자가 &lsquo;예전 기록 가져오기&rsquo;를,
        개선·수정·데이터 갱신은 제목 옆 &lsquo;상세보기&rsquo;를 눌러야 보입니다.
      </p>
      {changeStatus && <p className="admin-status">{changeStatus}</p>}
      {changes === null ? (
        <p className="admin-status">업데이트 내역 테이블이 아직 없습니다 — <code>docs/supabase-changelog.sql</code>을 Supabase SQL Editor에서 실행하세요.</p>
      ) : (
        <div className="admin-rules">
          <div className="admin-tools">
            <button onClick={() => setEditingChange({ released_at: daysAgoKst(0), kind: "new", ko: "", en: "", ja: "", href: "", seq: 0 })}>+ 새 항목</button>
            <button onClick={loadChanges}>새로고침</button>
          </div>
          {editingChange && !editingChange.id && <ChangeEditor row={editingChange} onSave={saveChange} onCancel={() => setEditingChange(null)} />}
          {changes.length === 0 && <p className="admin-status">아직 등록된 항목이 없습니다.</p>}
          {changes.map((row) => (
            editingChange && editingChange.id === row.id
              ? <ChangeEditor key={row.id} row={editingChange} onSave={saveChange} onCancel={() => setEditingChange(null)} />
              : (
                <div key={row.id} className="rule-row">
                  <code>{row.released_at}</code>
                  <i className="rule-status-chip">{CHANGE_AREA_LABEL[areaOf(row)]} {CHANGE_KIND_LABEL[row.kind]}</i>
                  <span className="rule-preview">{row.ko.slice(0, 70)}</span>
                  {!row.en || !row.ja ? <span className="rule-note" title="번역이 비면 한국어로 표시됩니다">번역 미완</span> : null}
                  {row.href && <span className="rule-note" title={row.href}>{row.href}</span>}
                  <button onClick={() => setEditingChange(row)}>편집</button>
                  <button onClick={() => removeChange(row)}>삭제</button>
                </div>
              )
          ))}
        </div>
      )}
      </>)}

      {tab === "devnotes" && (<>
      <p className="admin-status">
        받은 제안에 대한 개발자의 답변입니다 — 사이트 헤더 🛠 업데이트 내역 모달의
        <b> 💬 개발자 코멘트</b> 버튼에 뜹니다. 저장하면 <b>배포 없이</b> 바로 반영됩니다.
        제안은 인용문으로, 답변은 그 아래로 보이고 이미지는 선택입니다 (파일 탭에서 올린 URL 사용 가능).
      </p>
      {devNoteStatus && <p className="admin-status">{devNoteStatus}</p>}
      {devNotes === null ? (
        <p className="admin-status">개발자 코멘트 테이블이 아직 없습니다 — <code>docs/supabase-devnotes.sql</code>을 Supabase SQL Editor에서 실행하세요.</p>
      ) : (
        <div className="admin-rules">
          <div className="admin-tools">
            <button onClick={() => setEditingDevNote({ released_at: daysAgoKst(0), status: "considering", suggestion_ko: "", suggestion_en: "", suggestion_ja: "", reply_ko: "", reply_en: "", reply_ja: "", image: "", active: true, seq: 0 })}>+ 새 코멘트</button>
            <button onClick={loadDevNotes}>새로고침</button>
          </div>
          {editingDevNote && !editingDevNote.id && <DevNoteEditor row={editingDevNote} onSave={saveDevNote} onCancel={() => setEditingDevNote(null)} upload={uploadForTip} />}
          {devNotes.length === 0 && <p className="admin-status">아직 등록된 코멘트가 없습니다.</p>}
          {devNotes.map((row) => (
            editingDevNote && editingDevNote.id === row.id
              ? <DevNoteEditor key={row.id} row={editingDevNote} onSave={saveDevNote} onCancel={() => setEditingDevNote(null)} upload={uploadForTip} />
              : (
                <div key={row.id} className={`rule-row${row.active ? "" : " status-draft"}`}>
                  <code>{row.released_at}</code>
                  <i className="rule-status-chip">{DEVNOTE_STATUS_LABEL[row.status]}</i>
                  {!row.active && <i className="rule-status-chip">숨김</i>}
                  <span className="rule-preview">💬 {row.suggestion_ko.slice(0, 60)}</span>
                  {!row.suggestion_en || !row.suggestion_ja || !row.reply_en || !row.reply_ja ? <span className="rule-note" title="번역이 비면 한국어로 표시됩니다">번역 미완</span> : null}
                  {row.image && <span className="rule-note" title={row.image}>이미지</span>}
                  <button onClick={() => setEditingDevNote(row)}>편집</button>
                  <button onClick={() => removeDevNote(row)}>삭제</button>
                </div>
              )
          ))}
        </div>
      )}
      </>)}

      {tab === "tips" && (<>
      <p className="admin-status">
        사이트 화면 빈 곳을 떠다니는 힌트 풍선입니다. 저장하면 <b>배포 없이</b> 바로 반영됩니다.
        제목은 접힌 풍선에 그대로 보이니 짧게, 설명·이미지는 눌러서 펼쳤을 때 나옵니다.
      </p>
      {tipStatus && <p className="admin-status">{tipStatus}</p>}
      {tips === null ? (
        <p className="admin-status">팁 테이블이 아직 없습니다 — <code>docs/supabase-tips.sql</code>을 Supabase SQL Editor에서 실행하세요.</p>
      ) : (
        <div className="admin-rules">
          <div className="admin-tools">
            <button onClick={() => setEditingTip({ title_ko: "", title_en: "", title_ja: "", body_ko: "", body_en: "", body_ja: "", image: "", image_dark: "", href: "", active: true, seq: (tips.at(-1)?.seq ?? -1) + 1 })}>+ 새 팁</button>
            <button onClick={loadTips}>새로고침</button>
          </div>
          {editingTip && !editingTip.id && <TipEditor row={editingTip} onSave={saveTip} onCancel={() => setEditingTip(null)} upload={uploadForTip} />}
          {tips.length === 0 && <p className="admin-status">아직 등록된 팁이 없습니다.</p>}
          {tips.map((row) => (
            editingTip && editingTip.id === row.id
              ? <TipEditor key={row.id} row={editingTip} onSave={saveTip} onCancel={() => setEditingTip(null)} upload={uploadForTip} />
              : (
                <div key={row.id} className={`rule-row${row.active ? "" : " status-draft"}`}>
                  <code>{row.seq}</code>
                  {!row.active && <i className="rule-status-chip">숨김</i>}
                  <span className="rule-preview">💡 {row.title_ko}</span>
                  {!row.title_en || !row.title_ja || !row.body_en || !row.body_ja ? <span className="rule-note" title="번역이 비면 한국어로 표시됩니다">번역 미완</span> : null}
                  {row.image && <span className="rule-note" title={row.image}>이미지</span>}
                  <button onClick={() => setEditingTip(row)}>편집</button>
                  <button onClick={() => removeTip(row)}>삭제</button>
                </div>
              )
          ))}
        </div>
      )}
      </>)}

      {tab === "files" && (<>
      <p className="admin-status">
        Cloudflare R2 파일 저장소입니다. <b>내 업로드</b>(<code>uploads/</code>)는 여기서 올리고 지우며,
        <b>사이트 에셋</b>(<code>assets/</code> — story·avatars 등)은 <code>scripts/r2-sync.mjs</code>가
        public/과 동기화합니다 (여기선 열람·URL 복사만). 같은 이름을 다시 올리면 <b>덮어씁니다</b>
        (URL 캐시 때문에 반영은 최대 1일).
      </p>
      {fileStatus && <p className="admin-status">{fileStatus}</p>}
      <div className="admin-rules">
        <div className="admin-tools">
          <button className={fileSub === "uploads" ? "selected" : ""} onClick={() => setFileSub("uploads")}>내 업로드 ({uploadRows.length})</button>
          <button className={fileSub === "feedback" ? "selected" : ""} onClick={() => setFileSub("feedback")}>제안 이미지 ({feedbackRows.length})</button>
          <button className={fileSub === "assets" ? "selected" : ""} onClick={() => setFileSub("assets")}>사이트 에셋 ({assetRows.length.toLocaleString()})</button>
          <input className="file-search" value={fileQuery} onChange={(e) => setFileQuery(e.target.value)} placeholder="파일 이름 검색…" />
          <button onClick={() => loadFiles()}>새로고침</button>
        </div>
        {files === null ? (
          <p className="admin-status">
            목록을 못 불러왔습니다 — R2 활성화 · <code>workers/upload</code> 배포 · <code>ADMIN_KEY</code> 시크릿(= 이 페이지 비밀번호)을 확인하세요.
          </p>
        ) : fileSub === "uploads" ? (<>
          <label
            className={`file-drop${dragOver ? " drag" : ""}${uploading ? " busy" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!uploading) uploadPicked(e.dataTransfer.files); }}
          >
            {uploading ? "올리는 중…" : "파일을 끌어다 놓거나 눌러서 선택 (여러 개 가능 · 95MB 이하)"}
            <input type="file" multiple disabled={uploading} onChange={(e) => { if (e.target.files) uploadPicked(e.target.files); e.target.value = ""; }} />
          </label>
          {shownUploads.length === 0 ? (
            <p className="admin-status">{fileFilter ? "검색 결과가 없습니다." : "아직 올린 파일이 없습니다."}</p>
          ) : (
            shownUploads.map((row) => (
              <FileRow key={row.key} row={row} label={row.key.slice("uploads/".length)} showDate
                onStatus={setFileStatus} onDelete={() => removeFile(row)} />
            ))
          )}
        </>) : fileSub === "feedback" ? (<>
          <p className="admin-status">
            방문자가 제안에 첨부한 이미지입니다 (제안 삭제 시 함께 지워집니다). 용량이 차면 여기서 정리하세요 —
            지우면 피드백 탭의 해당 제안에선 이미지가 깨집니다.
          </p>
          {shownFeedback.length === 0 ? (
            <p className="admin-status">{fileFilter ? "검색 결과가 없습니다." : "아직 제안에 첨부된 이미지가 없습니다."}</p>
          ) : (
            shownFeedback.map((row) => (
              <FileRow key={row.key} row={row} label={row.key.slice("feedback/".length)} showDate
                onStatus={setFileStatus} onDelete={() => removeFile(row)} />
            ))
          )}
        </>) : fileFilter ? (<>
          {shownAssets.length === 0 && <p className="admin-status">검색 결과가 없습니다.</p>}
          {shownAssets.slice(0, 300).map((row) => (
            <FileRow key={row.key} row={row} label={row.key.slice("assets/".length)} onStatus={setFileStatus} />
          ))}
          {shownAssets.length > 300 && <p className="admin-status">{shownAssets.length.toLocaleString()}개 중 300개만 표시 — 검색어를 더 좁혀보세요.</p>}
        </>) : (
          <div className="ftree">
            {[...assetTree.dirs.keys()].sort().map((name) => (
              <FolderNode key={name} name={name} node={assetTree.dirs.get(name)!} depth={0} onStatus={setFileStatus} />
            ))}
            {assetTree.files.map((row) => (
              <FileRow key={row.key} row={row} label={row.key.slice("assets/".length)} onStatus={setFileStatus} />
            ))}
            {assetRows.length === 0 && <p className="admin-status">아직 동기화된 에셋이 없습니다 — <code>node scripts/r2-sync.mjs</code></p>}
          </div>
        )}
      </div>
      </>)}

      {tab === "rules" && (<>
      <p className="admin-status">
        발행 v{release?.version ?? "—"} · 사이트 번들 v{bundledRules.version}
        {release && release.version !== bundledRules.version && " — ⚠ 베이크 필요 (python3 scripts/build-rules.py)"}
      </p>
      {rulesStatus && <p className="admin-status">{rulesStatus}</p>}
      {rules === null ? (
        <p className="admin-status">플래너 규칙 테이블이 아직 없습니다 — <code>docs/supabase-planner-rules.sql</code>을 Supabase SQL Editor에서 실행하세요.</p>
      ) : (
        <div className="admin-rules">
          <div className="admin-tools">
            {RULE_KINDS.filter((kind) => kind !== "doc").map((kind) => (
              <button key={kind} onClick={() => setEditingRule({ kind, key: "", body: kind === "skill_override" ? { patch: {}, reason: "" } : kind === "fixture" ? { name: "", type: "planContains" } : kind === "synergy_set" ? { key: "", name: "", shift: 0, bodies: { room: "TRADING", from: "roles", roles: [] }, target: { cell: "firstFree" } } : kind === "token" ? {} : { value: 0 }, status: "active", seq: 99, note: null })}>
                + {RULE_KIND_LABEL[kind]}
              </button>
            ))}
            <button onClick={() => loadRules()}>새로고침</button>
            <input className="publish-note" value={publishNote} onChange={(e) => setPublishNote(e.target.value)} placeholder="발행 메모 (무엇을 왜 바꿨나)" />
            <button className="bulk-handling-btn" onClick={publishRules} title="active 규칙을 스냅샷으로 컴파일해 새 버전으로 발행">🚀 발행 (v{(release?.version ?? 0) + 1})</button>
            {release && <button onClick={rollbackRelease} title="최신 발행을 삭제해 이전 버전으로 롤백 (원장은 그대로)">↩ v{release.version} 롤백</button>}
          </div>
          {editingRule && !editingRule.id && <RuleEditor rule={editingRule} onSave={saveRule} onCancel={() => setEditingRule(null)} />}
          {RULE_KINDS.map((kind) => {
            const group = rules.filter((row) => row.kind === kind);
            if (!group.length) return null;
            return (
              <details key={kind} className="rule-group" open={kind === "fixture" || kind === "skill_override"}>
                <summary><b>{RULE_KIND_LABEL[kind]}</b> <small>{group.length}건{group.some((row) => row.status !== "active") ? ` (active ${group.filter((row) => row.status === "active").length})` : ""}</small></summary>
                {group.map((rule) => (
                  editingRule && editingRule.id === rule.id
                    ? <RuleEditor key={rule.id} rule={editingRule} onSave={saveRule} onCancel={() => setEditingRule(null)} />
                    : (
                      <div key={rule.id} className={`rule-row status-${rule.status}`}>
                        <code>{rule.key}</code>
                        {rule.status !== "active" && <i className="rule-status-chip">{rule.status}</i>}
                        <span className="rule-preview">{kind === "doc" ? String(rule.body.text ?? "").slice(0, 60) : JSON.stringify(kind === "constant" || kind === "parser" ? rule.body.value : rule.body).slice(0, 60)}</span>
                        {rule.note && <span className="rule-note" title={rule.note}>{rule.note}</span>}
                        <button onClick={() => setEditingRule(rule)}>편집</button>
                        <button onClick={() => removeRule(rule)}>삭제</button>
                      </div>
                    )
                ))}
              </details>
            );
          })}
          <p className="data-status-minor">
            발행 → 로컬 <code>python3 scripts/build-rules.py</code> 베이크 → 안내되는 검증(verify-plan, 파서 변경 시 build-infra 재생성) →
            커밋·배포까지 해야 사이트에 반영됩니다. 규칙 계층·작성법: <code>docs/PLANNER-RULES-DB.md</code>
          </p>
        </div>
      )}
      </>)}
    </main>
  );
}
