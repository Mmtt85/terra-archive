"use client";
// 친구 매칭 (2026-10-20, 사용자 지시) — 내 정보 개요의 '친구 매칭' 버튼이 여는 창.
// 매칭 등록을 켠 박사만 목록에 실린다(서버·UID·닉네임#번호·레벨·지원 오퍼·친구 수·마지막 동기화).
// 닉네임은 등록할 때만 저장하고, 취소하면 워커가 줄째 즉시 지운다. 등록 중엔 동기화할 때마다 워커가 줄을 새 정보로 바꾼다.
// 2주 넘게 동기화가 없거나 친구 자리가 꽉 찬 줄은 목록에서 빠진다(워커 matchList). 신고 기능은 만들지 않는다 (사용자 결정).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useI18n, DT_LOCALE } from "./i18n";
import { asset } from "./assets";
import { ModalWindow } from "./modal-window";
import { useConfirm } from "./confirm";
import { normSearch } from "./search";
import { AttributeFilter } from "./attr-filter";
import { eliteText, masteryText, mePrefToken, meToken, potText, saveMe, type MeData } from "./me-store";
import { AccountError, ACCOUNT_SERVERS, ACCOUNT_STEPS, syncAccount, type AccountFriend, type AccountStep, type MatchSigned, matchCancel, matchList, matchMine, matchRegister, matchSearchLog, type MatchAssist, type MatchRow } from "./account";
import type { MeOp } from "./me";

const JOB_ORDER = ["PIONEER", "WARRIOR", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"];
type Cond = "rar" | "job" | "elite" | "pot" | "mastery" | "module";
const avatarOf = (id: string) => asset(`/avatars/${id}.webp`);
/** 부관 스킨 id(char_002_amiya@epoque#4 · char_002_amiya#2) → 일러 파일 — 내 정보 박사 카드와 같은 규칙 */
const artOf = (sec: string, skin: string | null) => asset(`/skin/full/${encodeURIComponent(skin ? (skin.includes("@") ? skin.replace("@", "_") : skin.replace("#", "_")) : `${sec}_2`)}.webp`);

// 등록·취소 작업은 창 밖(모듈)에 둔다 — 창을 닫아도 끝까지 가고, 다시 열면 진행 중인 단계가 보인다
// (사용자 지적 2026-10-20 "처리하는 중에 멈췄나 하고 창을 닫으면 그대로 취소돼 버린다")
type Job = { step: string; err: string | null; running: boolean; n: number; cancel: boolean };
let job: Job | null = null;
const jobSubs = new Set<() => void>();
const setJob = (j: Job | null) => { job = j; jobSubs.forEach((f) => f()); };
const useJob = () => useSyncExternalStore((cb) => { jobSubs.add(cb); return () => { jobSubs.delete(cb); }; }, () => job, () => null);
async function runJob(token: string, cancel: boolean, signed: MatchSigned | null, stepText: (s: AccountStep | "put" | "delete") => string, errText: (code: string) => string) {
  const n = (job?.n ?? 0) + 1;
  setJob({ step: stepText(cancel ? "delete" : "put"), err: null, running: true, n, cancel });
  try {
    if (cancel) await matchCancel(token);
    else {
      // 이 기능 전에 동기화한 저장분엔 서명된 매칭 정보가 없다 — 그 자리에서 한 번 동기화해 받는다 (사용자 2026-10-20 "등록했는데 안 나온다")
      let sig = signed;
      const tk = sig ? null : meToken();
      if (!sig && tk) {
        const r = await syncAccount(tk.token, tk.server, (st) => setJob({ step: stepText(st), err: null, running: true, n, cancel }));
        saveMe(r, tk.server, "me_sync");
        sig = r.match ?? null;
      }
      if (!sig) throw new AccountError("no-match");
      setJob({ step: stepText("put"), err: null, running: true, n, cancel });
      await matchRegister(token, sig);
    }
    setJob({ step: "", err: null, running: false, n, cancel });
  } catch (e) {
    setJob({ step: "", err: errText(e instanceof AccountError ? e.message : "network"), running: false, n, cancel });
  }
}

/** 동기화 때 받은 서명된 내 정보를 풀어 본다 (미리보기용 — 등록은 서명본을 그대로 보낸다) */
function myEntry(me: MeData): MatchRow | null {
  if (!me.match?.body) return null;
  try {
    const b64 = me.match.body.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const e = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return { ...e, created: e.t };
  } catch { return null; }
}

function ago(t: ReturnType<typeof useI18n>["t"], now: number, ms: number): string {
  const m = Math.max(0, Math.floor((now - ms) / 60000));
  if (m < 60) return t("{n}분 전", { n: Math.max(1, m) });
  if (m < 1440) return t("{n}시간 전", { n: Math.floor(m / 60) });
  return t("{n}일 전", { n: Math.floor(m / 1440) });
}

function MatchOp({ a, op }: { a: MatchAssist; op: MeOp }) {
  const { locale, t } = useI18n();
  const sk = a.skillIndex >= 0 ? op.skills[a.skillIndex] : undefined;
  const mod = a.equip && a.equipLevel > 0 ? op.modules.find((m) => m.id === a.equip) : undefined;
  // 완전 풀업 — 정예화 2 만렙 · 풀잠 · 특화 3 · (모듈이 있는 오퍼면) 모듈 3단계. 황금빛으로 (사용자 지시 2026-10-20). 4★ 이상만
  const maxLv = op.rarity === 6 ? 90 : op.rarity === 5 ? 80 : 70;
  const maxed = op.rarity >= 4 && a.elite >= 2 && a.level >= maxLv && a.potential >= 6 && a.mastery >= 3 && (!op.modules.length || a.equipLevel >= 3);
  return (
    <li>
      <span className="mm-op" title={op.name}>
        <span className={`me-op-face r${op.rarity}${maxed ? " mm-maxed" : ""}`} title={maxed ? `${op.name} · ${t("완전 육성")}` : undefined}>
          <img src={avatarOf(op.id)} alt="" width={56} height={56} loading="lazy" />
          {sk && <img className="me-op-skill" src={asset(`/skills/icon/${sk.icon ?? sk.id}.webp`)} alt="" width={22} height={22} loading="lazy" />}
          {a.potential > 0 && <i className={`me-op-pot${a.potential >= 6 ? " max" : ""}`}>{potText(locale, a.potential)}</i>}
        </span>
        <span className="me-op-name">{op.name}</span>
        {/* 좁은 칸이라 정예화·레벨 / 스킬 / 모듈을 줄마다 나눈다 — 한 줄에 몰면 '스킬 7' 이 쪼개져 세 줄이 됐다 (사용자 지적 2026-10-20) */}
        <em>{eliteText(locale, a.elite, a.level)}</em>
        {sk && <em>{a.mastery ? masteryText(locale, a.mastery) : t("스킬 {n}", { n: a.skill })}</em>}
        {/* 좁은 칸이라 'PHY-Y' 의 끝 글자 + 단계만 ("모듈 Y2") — 전체 이름은 마우스를 올리면 */}
        {mod && <em className="mm-mod" title={`${mod.type ?? ""} ${mod.name} · ${a.equipLevel}${t("단계")}`}>{t("모듈")} {(mod.type ?? "").split("-").pop()}{a.equipLevel}</em>}
      </span>
    </li>
  );
}

function MatchRowView({ r, opById, now, mine, full, friend }: { r: MatchRow; opById: Map<string, MeOp>; now: number; mine?: boolean; full?: boolean; friend?: boolean }) {
  const { locale } = useI18n();
  // 배경 — 부관(과 그 스킨) 일러를 은은하게. 스킨 그림이 없으면 정예화 일러, 그것도 없으면 그림을 뺀다
  const sec = r.sec && opById.has(r.sec) ? r.sec : null;
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(r.uid).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  const [nick, num] = r.nick.split("#");
  return (
    <li className={`mm-row${mine ? " mine" : ""}${full ? " full" : ""}`} title={full ? t("친구 자리가 꽉 찼어요") : undefined}>
      {sec && <img className="mm-art" src={artOf(sec, r.secSkin ?? null)} alt="" aria-hidden decoding="async" loading="lazy"
        onError={(e) => { const el = e.currentTarget; const fb = artOf(sec, null); if (el.src !== new URL(fb, location.href).href) el.src = fb; else el.remove(); }} />}
      <div className="mm-who">
        {/* 이미 친구 — 닉네임#번호 바로 오른쪽에, 조금 더 눈에 띄게 (사용자 지시 2026-10-20) */}
        <b>{nick || "Dr."}{num && <small>#{num}</small>}{friend && <em className="mm-friend">{t("이미 친구")}</em>}</b>
        {/* 'N분 전' 은 친구 카드(전부 보기 — 게임의 마지막 접속)에만. 매칭 카드의 시각은 마지막 '동기화'라 접속 안 한 사람처럼 보였다 (사용자 지적 2026-10-20) */}
        <span>Lv.{r.level}{r.friends != null && r.flimit ? ` · ${t("친구 {a}/{b}", { a: r.friends, b: r.flimit })}` : ""}{!r.server && ` · ${ago(t, now, r.t)}`}</span>
        {/* 입사일 (사용자 지시 2026-10-20) — 박사 카드의 '입사'와 같은 글 */}
        {!!r.register && <span className="mm-reg-day">{t("{date} 입사", { date: new Date(r.register * 1000).toLocaleDateString(DT_LOCALE[locale], { year: "numeric", month: "short", day: "numeric" }) })}</span>}
        {r.resume && <q className="mm-resume" title={r.resume}>{r.resume}</q>}
        {r.uid && <button type="button" className="me-pf-uid" onClick={copy} title={t("UID 복사")}>
          UID <code>{r.uid}</code><span aria-hidden>{copied ? "✓" : "⧉"}</span>
        </button>}
        {/* 마지막 동기화가 1주일 넘음 — 2주가 넘으면 목록에서 빠진다. UID 밑에 (사용자 지시 2026-10-20) */}
        {full && <em className="mm-stale">{t("친구 꽉 참")}</em>}
        {r.server && now - r.t > 7 * 86400_000 && <em className="mm-stale">{t("동기화 1주일 넘음")}</em>}
      </div>
      <ul className="me-ops me-ops-mini">
        {r.assist.map((a, i) => { const op = opById.get(a.id); return op ? <MatchOp key={`${a.id}-${i}`} a={a} op={op} /> : null; })}
        {!r.assist.length && <li className="mm-none">{t("지원 오퍼 없음")}</li>}
      </ul>
    </li>
  );
}

/** 내 정보 친구 목록의 '전부 보기' — 친구 찾기 카드와 같은 모양 (사용자 지시 2026-10-20). 게임 친구 목록엔 UID 가 없어 복사 단추는 없다 */
/** 등록·취소 진행·결과 토스트 (사용자 지시 2026-10-20) — 창을 닫아도 보이게 내 정보 화면(me.tsx)에 늘 깔아 둔다.
 *  진행 중엔 단계가 바뀌며 떠 있고, 끝나면 결과가 잠깐 뜨고 사라진다 (.toast 애니메이션) */
export function MatchJobToast() {
  const { t } = useI18n();
  const cur = useJob();
  if (!cur || typeof document === "undefined") return null;
  if (cur.running) return createPortal(
    <div className="toast opt-progress-toast me-share-toast" role="status" aria-live="polite">
      <span className="opt-progress-spin" aria-hidden>◐</span>{cur.step}<small className="mm-toast-sub">{t("창을 닫아도 계속 진행됩니다")}</small>
    </div>, document.body);
  return createPortal(
    <div key={cur.n} className="toast me-share-toast" role="status">
      {cur.err ?? (cur.cancel ? t("매칭 등록을 취소했습니다") : t("매칭 등록했습니다"))}
    </div>, document.body);
}

export function FriendCards({ list, opById, now }: { list: AccountFriend[]; opById: Map<string, MeOp>; now: number }) {
  const { t } = useI18n();
  return (
    <ul className="mm-list mm-friends">
      {list.map((f) => {
        const r: MatchRow = { server: "", uid: f.uid ?? "", nick: `${f.nickName}#${f.nickNumber}`, level: f.level, friends: null, flimit: null,
          t: f.lastOnline * 1000, created: 0, sec: f.secretary, secSkin: f.secretarySkin, resume: f.resume, register: f.register ?? null,
          assist: f.assist.map((a) => ({ id: a.id, elite: a.elite, level: a.level, potential: a.potential, skill: a.skill, skillIndex: a.skillIndex,
            mastery: a.skillIndex >= 0 ? a.mastery[a.skillIndex] ?? 0 : 0, equip: a.equip, equipLevel: a.equipLevel })) };
        return <MatchRowView key={r.nick} r={r} opById={opById} now={now} />;
      })}
    </ul>
  );
}

export function MatchWindow({ me, opById, onClose }: { me: MeData; opById: Map<string, MeOp>; onClose: () => void }) {
  const { locale, t } = useI18n();
  const token = mePrefToken();
  const mine = useMemo(() => myEntry(me), [me]);
  const [registered, setRegistered] = useState<boolean | null>(() => (token ? null : false));
  const cur = useJob();
  const busy = !!cur?.running;
  const err = cur && !cur.running ? cur.err : null;
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [q, setQ] = useState("");
  // 조건 — 오퍼 도감과 같은 드롭다운(AttributeFilter, 사용자 지시 2026-10-20). 칸 안은 '또는', 칸끼리는 '그리고'이고
  // 전부 **지원 오퍼 한 명**이 채워야 한다 (6★ 고르고 특화 3 고르면 6★이면서 특화 3인 지원 오퍼가 있는 사람)
  const [sel, setSel] = useState<Record<Cond, string[]>>({ rar: [], job: [], elite: [], pot: [], mastery: [], module: [] });
  const pick = (k: Cond) => (v: string) => setSel((c) => ({ ...c, [k]: c[k].includes(v) ? c[k].filter((x) => x !== v) : [...c[k], v] }));
  const [now] = useState(() => Date.now());
  const server = ACCOUNT_SERVERS.find((s) => s.code === me.server)?.label ?? me.server;

  const load = () => { matchList(me.server).then(setRows).catch(() => setRows([])); };
  // 새로고침 단추 — 받는 동안 돌고, 빨리 끝나도 적어도 한 바퀴(0.7초)는 채운다. 바퀴 중간에 멈추지 않게 0.7초 단위로 맞춘다 (사용자 지시 2026-10-20)
  const [spin, setSpin] = useState(false);
  const refresh = () => {
    if (spin) return;
    setSpin(true);
    const t0 = Date.now();
    matchList(me.server).then(setRows).catch(() => null).finally(() => {
      const el = Date.now() - t0;
      setTimeout(() => setSpin(false), Math.max(1, Math.ceil(el / 700)) * 700 - el);
    });
  };
  useEffect(() => {
    load();
    if (token) matchMine(token).then((r) => setRegistered(r.registered)).catch(() => setRegistered(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.server, token]);

  // 작업이 끝나면(창을 닫았다 다시 열었어도) 등록 상태·목록을 다시 받는다
  const doneN = cur && !cur.running ? cur.n : 0;
  useEffect(() => {
    if (!doneN || !token) return;
    load();
    matchMine(token).then((r) => setRegistered(r.registered)).catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneN]);
  const stepText = (st: AccountStep | "put" | "delete") => st === "put" ? t("등록하는 중…") : st === "delete" ? t("취소하는 중…")
    : `${t("동기화하는 중")} · ${t(ACCOUNT_STEPS.find((x) => x.id === st)?.label ?? "")}`;
  const errText = (code: string) => code === "stale-sync" ? t("동기화한 지 2주가 넘었습니다 — 다시 동기화한 뒤 등록해 주세요.")
    : code === "no-match" ? t("내 정보를 다시 동기화한 뒤 등록해 주세요.") : t("처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");

  const { confirm, dialog } = useConfirm();
  const toggle = async () => {
    if (!token || busy) return;
    // 등록 전에 공개 항목·닉네임 저장 안내를 확인 창으로 (사용자 지시 2026-10-20 — 종전엔 창 본문에 늘 깔려 있었다)
    if (!registered) {
      const ok = await confirm({ title: t("매칭 등록"), confirmLabel: t("등록"), message: [
        t("공개 항목: 서버 · UID · 닉네임#번호 · 박사 레벨 · 지원 오퍼(정예화·레벨·잠재·스킬·특화·모듈) · 친구 수 · 마지막 동기화"),
        t("닉네임은 매칭 등록할 때만 저장하고, 매칭을 취소하면 즉시 삭제합니다."),
        t("등록해 두면 동기화할 때마다 목록의 내 정보도 바뀝니다. 2주 넘게 동기화하지 않거나 친구 자리가 다 차면 목록에서 숨겨집니다."),
        t("내 정보를 90일 동안 동기화하지 않으면 등록 정보(닉네임 포함)는 자동으로 삭제됩니다."),
      ].join("\n\n"),
        // 등록하면 목록에 이렇게 보인다 — 확인 창 안에서 미리 보여 준다 (사용자 지시 2026-10-20, 종전엔 창 본문 등록 버튼 옆)
        extra: mine ? <div className="mm-preview"><ul className="mm-list"><MatchRowView r={mine} opById={opById} now={me.syncedAt} mine /></ul>
          <p className="mm-sub">{t("등록하면 이렇게 보입니다")}</p></div> : undefined });
      if (ok !== true) return;
    } else {
      // 취소도 한 번 묻는다 (사용자 지시 2026-10-20)
      const ok = await confirm({ title: t("매칭 취소"), confirmLabel: t("매칭 취소"), danger: true,
        message: t("매칭 등록을 취소하시겠습니까? 목록에서 바로 내려가고, 저장된 닉네임도 즉시 삭제됩니다.") });
      if (ok !== true) return;
    }
    void runJob(token, !!registered, me.match ?? null, stepText, errText);
  };

  // 오퍼 이름으로 거르기 — 이름이 맞는 오퍼 id 들 (지원 오퍼 중 하나라도 맞고, 그 오퍼가 조건을 채워야 한다)
  const nq = normSearch(q.trim());
  const wanted = useMemo(() => (nq ? [...opById.values()].filter((o) => normSearch(o.name).includes(nq)).map((o) => o.id) : null), [nq, opById]);
  const val = (a: MatchAssist, k: Cond): string => {
    const op = opById.get(a.id);
    return k === "rar" ? String(op?.rarity ?? "") : k === "job" ? op?.jobCode ?? "" : k === "elite" ? String(a.elite)
      : k === "pot" ? String(a.potential) : k === "mastery" ? String(a.mastery) : String(a.equip && a.equipLevel > 0 ? a.equipLevel : 0);
  };
  const okOp = (a: MatchAssist, s2 = sel) => (!wanted || wanted.includes(a.id)) && (Object.keys(s2) as Cond[]).every((k) => !s2[k].length || s2[k].includes(val(a, k)));
  const passRow = (r: MatchRow, s2 = sel) => {
    if (nq && (r.uid.includes(q.trim()) || normSearch(r.nick).includes(nq))) return true;
    return (!wanted && !(Object.values(s2) as string[][]).some((v) => v.length)) || r.assist.some((a) => okOp(a, s2));
  };
  const filtered = (rows ?? []).filter((r) => passRow(r));
  // 칸마다 그 값을 골랐을 때 몇 명이 남나 (오퍼 도감 드롭다운의 숫자)
  const countFor = (k: Cond) => (v: string) => (rows ?? []).filter((r) => passRow(r, { ...sel, [k]: [v] })).length;
  const jobLabel = (code: string) => [...opById.values()].find((o) => o.jobCode === code)?.job ?? code;
  // 많이 찾은 오퍼 집계 — 이름으로 거른 결과가 오퍼 1~3명으로 좁혀졌을 때만, 입력이 1.5초 멈춘 뒤 한 번
  const logged = useRef("");
  useEffect(() => {
    if (!wanted || !wanted.length || wanted.length > 3) return;
    const key = wanted.join(",");
    if (logged.current === key) return;
    const tm = setTimeout(() => { logged.current = key; matchSearchLog(me.server, wanted); }, 1500);
    return () => clearTimeout(tm);
  }, [wanted, me.server]);

  // 등록했으면 목록에 나도 나온다(표시만 다르게) — 종전엔 빼서 "등록했는데 안 나온다"로 보였다 (사용자 지적 2026-10-20)
  // 친구 자리가 꽉 찬 박사는 흐리게 맨 뒤로 (사용자 지시 2026-10-20 — 종전엔 목록에서 뺐다). 그 안에서는 받은 순서(최근 동기화 순) 그대로
  // 이미 내 친구 — 내 정보 친구 목록의 닉네임#번호와 맞춘다 (사용자 지시 2026-10-20, 게임 친구 목록엔 UID 가 없다)
  const myFriends = useMemo(() => new Set((me.profile?.friends ?? []).map((f) => `${f.nickName}#${f.nickNumber}`)), [me]);
  const isFull = (r: MatchRow) => r.friends != null && r.flimit != null && r.friends >= r.flimit;
  const others = [...filtered.filter((r) => !isFull(r)), ...filtered.filter(isFull)];
  return (
    <ModalWindow label={t("친구 매칭")} className="operator-modal mm-modal" onClose={onClose}>
      <div className="mm-body">
        <section className="mm-me">
          {/* 설명은 등록 버튼 바로 왼쪽, 버튼은 오른쪽 끝 (사용자 지시 2026-10-20) */}
          <div className="mm-reg">
            <p>{t("등록하면 아래 목록에 내 정보가 올라가 같은 서버의 박사가 UID를 복사해 게임에서 친구 신청을 할 수 있습니다.")}</p>
            <button type="button" className={`mm-toggle${registered ? " on" : ""}`} role="switch" aria-checked={!!registered}
              disabled={busy || registered == null || !token} onClick={() => void toggle()}>
              {busy ? t("처리하는 중…") : registered ? t("등록 중 · 취소") : t("매칭 등록")}
            </button>
          </div>
          {err && <p className="me-note warn">{err}</p>}
          {/* 등록 중인데 목록에 안 보이거나 곧 빠질 때 — 내 쪽에만 알린다 (사용자 지시 2026-10-20) */}
          {registered && !busy && mine && mine.friends != null && mine.flimit != null && mine.friends >= mine.flimit
            && <p className="me-note warn">{t("친구 자리가 꽉 찼어요 ({a}/{b}) — 목록 맨 뒤에 흐리게 보입니다. 친구를 정리하고 동기화하면 다시 앞으로 올라갑니다.", { a: mine.friends, b: mine.flimit })}</p>}
          {registered && !busy && now - me.syncedAt > 7 * 86400_000
            && <p className="me-note warn">{now - me.syncedAt > 14 * 86400_000
              ? t("마지막 동기화가 2주를 넘어 목록에서 숨겨졌어요 — 다시 동기화하면 올라갑니다. 90일이 지나면 등록이 자동으로 삭제됩니다.")
              : t("마지막 동기화가 1주일이 넘었어요 — 2주가 넘으면 목록에서 숨겨집니다.")}</p>}
        </section>
        <section className="mm-find">
          <div className="mm-filters">
            <AttributeFilter groups={[
              // 값은 늘 전부 — 지금 목록에 없는 값도 고를 수 있게 (사용자 지시 2026-10-20, 종전엔 있는 것만)
              { title: t("성급"), items: ["6", "5", "4", "3", "2", "1"], selected: sel.rar, onToggle: pick("rar"), labelFor: (v) => `${v}★`, countForItem: countFor("rar") },
              { title: t("직군"), items: JOB_ORDER, selected: sel.job, onToggle: pick("job"), labelFor: jobLabel, countForItem: countFor("job") },
              { title: t("정예화"), items: ["2", "1", "0"], selected: sel.elite, onToggle: pick("elite"), labelFor: (v) => t("정예화 {n}", { n: v }), countForItem: countFor("elite") },
              { title: t("잠재"), items: ["6", "5", "4", "3", "2", "1"], selected: sel.pot, onToggle: pick("pot"), labelFor: (v) => potText(locale, +v), countForItem: countFor("pot") },
              { title: t("특화"), items: ["3", "2", "1", "0"], selected: sel.mastery, onToggle: pick("mastery"), labelFor: (v) => (v === "0" ? t("특화 없음") : t("특화 {n}", { n: v })), countForItem: countFor("mastery") },
              { title: t("모듈"), items: ["3", "2", "1", "0"], selected: sel.module, onToggle: pick("module"), labelFor: (v) => (v === "0" ? t("모듈 없음") : t("모듈 {n}단계", { n: v })), countForItem: countFor("module") },
            ]} />
            {/* 검색란은 모듈 버튼 오른쪽 (사용자 지시 2026-10-20) */}
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("오퍼 · 닉네임 · UID")} aria-label={t("검색")} />
            {/* 0명이면 아래 '없습니다' 안내 하나만 (사용자 지적 2026-10-20 — 두 줄이 같은 말을 했다) */}
          {(rows == null || others.length > 0) && <p className="mm-sub mm-count">{rows == null ? t("불러오는 중…") : t("{server} · 등록한 박사 {n}명", { server: t(server), n: others.length })}
            {/* 목록 다시 받기 (사용자 지시 2026-10-20) */}
            {rows != null && <button type="button" className={`mm-refresh${spin ? " spin" : ""}`} onClick={refresh} aria-busy={spin}
              title={spin ? t("새로고침하는 중…") : t("새로고침")} aria-label={spin ? t("새로고침하는 중…") : t("새로고침")}>
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden><path d="M13.2 6.4A5.4 5.4 0 1 0 13.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M13.6 2.6v3.9H9.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>}</p>}
          </div>
          
          <ul className="mm-list">
            {others.map((r) => <MatchRowView key={r.uid} r={r} opById={opById} now={now} mine={!!mine && r.uid === mine.uid} full={isFull(r)} friend={myFriends.has(r.nick)} />)}
          </ul>
          {rows != null && !others.length && <p className="me-note">{rows.length ? t("조건에 맞는 박사가 없습니다.") : t("아직 등록한 박사가 없습니다.")}</p>}
        </section>
      </div>
      {dialog}
    </ModalWindow>
  );
}
