"use client";

import { useEffect, useState } from "react";
import { adminDeleteFeedback, adminListFeedback, adminSetHandling, adminSetReviewed, handlingAt, withHandling, type FeedbackRow } from "../feedback";
import { adminDeleteRelease, adminDeleteRule, adminListRules, adminPublishRelease, adminUpsertRule, fetchLatestRelease, type ReleaseRow } from "../rules-api";
import { adminDeleteChange, adminUpsertChange, fetchAllChanges, CHANGE_KINDS, CHANGE_KIND_LABEL, daysAgoKst, type ChangeDraft, type ChangeRow } from "../changelog-api";
import { adminDeleteTip, adminUpsertTip, fetchAllTips, type TipDraft, type TipRow } from "../tips-api";
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
      await onSave({ ...row, released_at: date, kind, ko, en, ja, href, seq: Number(seq) || 0 });
    } catch (err) { setError(String((err as Error).message ?? err)); }
    setSaving(false);
  };
  return (
    <div className="rule-editor chlog-editor">
      <header>
        <b>{row.id ? "항목 편집" : "새 항목"}</b>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title="표시·정렬 기준일" />
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

// payload.page("/#infra" 등)를 사람이 읽을 라벨로 — 클릭하면 그 페이지가 새 탭에 열린다
function pageOf(payload: unknown): string | undefined {
  const page = payload && typeof payload === "object" ? (payload as { page?: unknown }).page : undefined;
  return typeof page === "string" && page ? page : undefined;
}
function pageLabel(page: string): string {
  if (page.includes("#infra")) return "인프라 자동편성기";
  if (page.includes("#recruit")) return "공채 도우미";
  const op = page.match(/#op-(char_[A-Za-z0-9_]+)/);
  if (op) return `오퍼 상세 · ${OP_NAME.get(op[1]) ?? op[1]}`;
  return "오퍼 백과사전";
}

export default function AdminPage() {
  // window.confirm/prompt는 VSCode 웹뷰 등 일부 임베디드 브라우저에서 미지원
  // ("prompt() is not supported" 크래시, 2026-07-22) — 사이트 공용 확인 모달로 대체
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [password, setPassword] = useState("");
  const [entered, setEntered] = useState(false);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("open"); // open(대응미완료) | reviewed(대응완료)
  const [tab, setTab] = useState<"feedback" | "rules" | "changelog" | "tips" | "files">("feedback"); // 상단 탭
  // 팁 풍선 원장 (null = 조회 실패 → 미설치 안내)
  const [tips, setTips] = useState<TipRow[] | null>(null);
  const [tipStatus, setTipStatus] = useState("");
  const [editingTip, setEditingTip] = useState<TipDraft | null>(null);
  // 파일 저장소(R2) — 워커 미배포·비밀번호 불일치면 null + 안내
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [fileStatus, setFileStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
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
    if (!entered) return;
    fetch(DATACHECK_API)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (Array.isArray(data?.operators)) setDataCheck(data); })
      .catch(() => { /* 워커 불통 시 섹션이 '확인 중'으로 남음 */ });
  }, [entered]);

  const load = async (pw: string) => {
    setStatus("불러오는 중…");
    try {
      const data = await adminListFeedback(pw);
      setRows(data);
      setStatus(data.length ? "" : "항목이 없습니다 — 비밀번호가 틀리면 목록이 비어 보입니다");
      setEntered(true);
      sessionStorage.setItem("ta-admin-key", pw);
      loadRules(pw);
      loadChanges();
      loadTips();
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
    await adminUpsertChange(password, next);
    setEditingChange(null);
    setChangeStatus(`저장됨 — 사이트 헤더 🛠 모달에 즉시 반영됩니다 (${next.released_at})`);
    loadChanges();
  };

  const removeChange = async (row: ChangeRow) => {
    if (!(await confirm({ message: `'${row.ko.slice(0, 40)}…' 항목을 삭제할까요?`, danger: true }))) return;
    try {
      await adminDeleteChange(password, row.id);
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
    await adminUpsertTip(password, next);
    setEditingTip(null);
    setTipStatus("저장됨 — 사이트 팁 풍선에 즉시 반영됩니다");
    loadTips();
  };

  const removeTip = async (row: TipRow) => {
    if (!(await confirm({ message: `'${row.title_ko}' 팁을 삭제할까요?`, danger: true }))) return;
    try { await adminDeleteTip(password, row.id); setTipStatus("삭제됨"); loadTips(); }
    catch { setTipStatus("삭제 실패"); }
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
    if (tab === "files" && files === null && entered) loadFiles(password);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, entered]);

  const uploadPicked = async (list: FileList | File[]) => {
    const picked = [...list];
    if (!picked.length) return;
    setUploading(true);
    let done = 0;
    for (const file of picked) {
      try {
        const stored = await adminUploadFile(password, file);
        done += 1;
        setFileStatus(`올림 (${done}/${picked.length}) — ${stored.key}`);
      } catch (err) {
        setFileStatus(`업로드 실패: ${file.name} — ${String((err as Error).message ?? err)}`);
        break;
      }
    }
    setUploading(false);
    loadFiles(password);
  };

  const copyFileUrl = async (row: StoredFile) => {
    try { await navigator.clipboard.writeText(row.url); setFileStatus(`URL 복사됨 — ${row.key}`); }
    catch { setFileStatus(row.url); } // 클립보드 미지원 환경이면 그냥 보여준다
  };

  const removeFile = async (row: StoredFile) => {
    if (!(await confirm({ message: `'${row.key}' 파일을 삭제할까요? 이 URL을 쓰는 팁·페이지에선 이미지가 깨집니다.`, danger: true }))) return;
    try { await adminDeleteFile(password, row.key); setFileStatus("삭제됨"); loadFiles(password); }
    catch { setFileStatus("삭제 실패"); }
  };

  // 팁 편집기 이미지칸 "올리기" — 올리고 나서 공개 URL을 돌려준다
  const uploadForTip = async (file: File) => (await adminUploadFile(password, file)).url;

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
    await adminUpsertRule(password, next);
    setEditingRule(null);
    setRulesStatus(`저장됨: ${next.kind}/${next.key} — 발행해야 반영됩니다`);
    loadRules(password);
  };

  const removeRule = async (rule: RuleRow) => {
    if (!rule.id) return;
    if (!(await confirm({ message: `${RULE_KIND_LABEL[rule.kind]} '${rule.key}'를 삭제할까요? (이력을 남기려면 삭제 대신 편집에서 retired로)`, danger: true }))) return;
    try {
      await adminDeleteRule(password, rule.id);
      setRulesStatus(`삭제됨: ${rule.kind}/${rule.key} — 발행해야 반영됩니다`);
      loadRules(password);
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
      await adminPublishRelease(password, nextVersion, compileSnapshot(rules, nextVersion), publishNote.trim());
      setRelease(await fetchLatestRelease());
      setPublishNote("");
      setRulesStatus(`v${nextVersion} 발행 완료 — 로컬에서 python3 scripts/build-rules.py 베이크 → 안내되는 검증 절차 → 커밋·배포`);
    } catch (err) { setRulesStatus(String((err as Error).message ?? err)); }
  };

  const rollbackRelease = async () => {
    if (!release) return;
    if (!(await confirm({ message: `최신 발행 v${release.version}을 삭제(롤백)할까요? 이전 버전이 최신이 됩니다.`, danger: true }))) return;
    try {
      await adminDeleteRelease(password, release.version);
      setRelease(await fetchLatestRelease());
      setRulesStatus(`v${release.version} 롤백됨`);
    } catch { setRulesStatus("롤백 실패"); }
  };

  useEffect(() => {
    const saved = sessionStorage.getItem("ta-admin-key");
    if (saved) { setPassword(saved); load(saved); }
  }, []);

  const toggleReviewed = async (row: FeedbackRow) => {
    const next = !row.reviewed_at;
    try {
      await adminSetReviewed(password, row.id, next);
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, reviewed_at: next ? new Date().toISOString() : null } : item));
    } catch {
      setStatus("갱신 실패");
    }
  };

  const toggleHandling = async (row: FeedbackRow) => {
    const next = !handlingAt(row.payload);
    try {
      await adminSetHandling(password, row.id, row.payload, next);
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, payload: withHandling(item.payload, next) } : item));
    } catch {
      setStatus("갱신 실패");
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
        await adminSetHandling(password, row.id, row.payload, true);
        setRows((current) => current.map((item) => item.id === row.id ? { ...item, payload: withHandling(item.payload, true) } : item));
      } catch { /* 개별 실패는 건너뛴다 */ }
      setStatus(`대응중 표시 중… (${++done}/${targets.length})`);
    }
    setStatus(`${done}건 대응중 표시 완료`);
  };

  const remove = async (id: string) => {
    if (!(await confirm({ message: "이 항목을 삭제할까요?", danger: true }))) return;
    try {
      await adminDeleteFeedback(password, id);
      setRows((current) => current.filter((row) => row.id !== id));
    } catch {
      setStatus("삭제 실패");
    }
  };

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

  if (!entered) {
    return (
      <main className="admin-gate">
        <section>
          <h1>TERRA ARCHIVE // ADMIN</h1>
          <form onSubmit={(event) => { event.preventDefault(); load(password); }}>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비밀번호" autoFocus />
            <button type="submit">입장</button>
          </form>
          {status && <p>{status}</p>}
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
          <button className={tab === "tips" ? "selected" : ""} onClick={() => setTab("tips")}>
            팁 풍선{tips ? ` (${tips.filter((row) => row.active).length}/${tips.length})` : ""}
          </button>
          <button className={tab === "files" ? "selected" : ""} onClick={() => setTab("files")}>
            파일{files ? ` (${files.length})` : ""}
          </button>
          <button onClick={() => load(password)}>새로고침</button>
          <button onClick={() => { sessionStorage.removeItem("ta-admin-key"); setEntered(false); setRows([]); }}>잠금</button>
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
              <button onClick={() => remove(row.id)}>삭제</button>
            </header>
            {row.message && <p>{row.message}</p>}
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
        기본 표시는 최근 7일치이고, 그 이전 항목은 방문자가 &lsquo;지난 기록 전체보기&rsquo;를 눌러야 보입니다.
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
                  <i className="rule-status-chip">{CHANGE_KIND_LABEL[row.kind]}</i>
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
        Cloudflare R2 파일 저장소입니다. 올린 파일은 <code>uploads/</code> 폴더에 들어가고
        <code>files.terra-archive.net</code> 공개 URL이 생겨 팁 이미지 등 어디에나 쓸 수 있습니다.
        같은 이름을 다시 올리면 <b>덮어씁니다</b> (URL 캐시 때문에 반영은 최대 1일).
        사이트 에셋(story·avatars 등)은 여기 안 보입니다 — 그건 <code>scripts/r2-sync.mjs</code> 관할.
      </p>
      {fileStatus && <p className="admin-status">{fileStatus}</p>}
      <div className="admin-rules">
        <label
          className={`file-drop${dragOver ? " drag" : ""}${uploading ? " busy" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!uploading) uploadPicked(e.dataTransfer.files); }}
        >
          {uploading ? "올리는 중…" : "파일을 끌어다 놓거나 눌러서 선택 (여러 개 가능 · 95MB 이하)"}
          <input type="file" multiple disabled={uploading} onChange={(e) => { if (e.target.files) uploadPicked(e.target.files); e.target.value = ""; }} />
        </label>
        <div className="admin-tools">
          <button onClick={() => loadFiles(password)}>새로고침</button>
        </div>
        {files === null ? (
          <p className="admin-status">
            목록을 못 불러왔습니다 — R2 활성화 · <code>workers/upload</code> 배포 · <code>ADMIN_KEY</code> 시크릿(= 이 페이지 비밀번호)을 확인하세요.
          </p>
        ) : files.length === 0 ? (
          <p className="admin-status">아직 올린 파일이 없습니다.</p>
        ) : (
          files.map((row) => (
            <div key={row.key} className="rule-row file-row">
              {isImageKey(row.key)
                ? <img className="file-thumb" src={row.url} alt="" loading="lazy" />
                : <span className="file-thumb file-thumb-blank">📄</span>}
              <code title={row.url}>{row.key}</code>
              <span className="rule-note">{formatSize(row.size)}</span>
              <span className="rule-note">{new Date(row.uploaded).toLocaleDateString("ko-KR")}</span>
              <button onClick={() => copyFileUrl(row)}>URL 복사</button>
              <button onClick={() => window.open(row.url, "_blank")}>열기</button>
              <button onClick={() => removeFile(row)}>삭제</button>
            </div>
          ))
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
            <button onClick={() => loadRules(password)}>새로고침</button>
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
