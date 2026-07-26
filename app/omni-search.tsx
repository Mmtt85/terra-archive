"use client";

// 헤더 만능검색 UI — 단어 하나로 사이트 안 아무 컨텐츠나 찾아 이동한다 (사용자 요청 2026-07-25).
//
//  · 트리거는 헤더 1줄(로고·햄버거와 같은 줄)이라 **헤더를 접어도 남는다**.
//  · 패널: 입력란 + [바로가기] 버튼 + 결과 목록. 1위가 확실하면 곧장 이동하고,
//    애매하면(동점·완전일치 여럿) "이 중에 무엇인가요?" 선택지를 띄운다 — 판정은 omni.ts.
//  · **검색은 타이핑이 멈춘 뒤 0.5초에만** 돈다 (사용자 확정 2026-07-25 — 한 글자마다 목록을
//    다시 그리던 게 입력 지연의 원인이었다). [바로가기]·⏎는 기다리지 않고 즉시 검색한다.
//  · 되묻기에서 고른 항목은 기억한다 (omni-picks.ts) — 내 선택은 즉시, 사람들의 선택은
//    2표부터 반영돼 같은 검색어가 점점 정확해진다.
//  · 통합전략 세부 항목(유물·조우·작전…)은 스샷 레이더 인덱스(2.9MB)라 기본 색인에서 빠져
//    있고, 가벼운 색인으로 답이 안 나올 때만 지연 로드해 합친다.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getRogueIndex } from "./lens/run";
import { buildOmniIndex, currentRogueTopic, decideOmni, FUZZY_GATE, rogueOmniItems, searchSmart, splitHint, type OmniHit, type OmniItem, type OmniKind, type OmniTarget } from "./omni";
import { crowdPicks, fetchCrowdPicks, learnedHints, picksFor, recordHint, recordPick, type PickIndex } from "./omni-picks";
import { normSearch, SEARCH_DEBOUNCE_MS } from "./search";
import { consumeMiss, noteAction, noteMiss, recentMissQ } from "./trail";
import { useI18n, type ExtraI18n } from "./i18n";
import { isNewFeature } from "./whats-new";
import type { Operator } from "./home";

// 이미지가 없는 종류의 아이콘 — 햄버거 탭 아이콘과 같은 글리프를 써서 어디로 가는지 읽히게
const KIND_GLYPH: Record<string, string> = { story: "✦", tag: "◎", rogue: "❖", topic: "❖", tab: "◇" };
const LEARNED_MIN = 3;   // 이 표수 이상이면 '자주 선택' 표시 (내 선택 1회 = 3표)

export default function OmniSearch({ roster, includeFuture, extra, onGo }: {
  roster: Operator[];
  includeFuture: boolean;
  extra?: ExtraI18n | null;
  onGo: (target: OmniTarget) => void;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  // ⚠ 입력란은 **비제어(uncontrolled)** — 타이핑 한 글자마다 React 렌더를 돌리면 그 렌더가
  // 끝난 뒤에야 글자가 보인다(특히 한글 IME 조합 중). 입력값은 ref에만 담고, 화면 갱신은
  // 0.5초 디바운스가 끝난 뒤 term 한 번으로 처리한다 (사용자 리포트 2026-07-25).
  const rawRef = useRef("");
  const [term, setTerm] = useState("");           // 실제 검색어 (타이핑 멈춘 뒤 0.5초)
  const [ask, setAsk] = useState(false);          // "이 중에 무엇인가요?" (되묻기)
  const [active, setActive] = useState(-1);       // ↑↓로 고른 줄 (-1 = 아직 안 고름)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rogueItems, setRogueItems] = useState<OmniItem[] | null>(null);  // 지연 로드된 통합전략 항목
  // 전역 집계(사람들의 표) — 학습은 전부 DB에 쌓이고, 여기선 세션 1회 받아 온 지도를 읽는다.
  // tick은 내 표를 낙관적으로 얹은 뒤 다시 그리기 위한 신호 (지도 자체는 omni-picks 모듈 소유).
  const [crowd, setCrowd] = useState<PickIndex>({});
  const [, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);   // 'stale'(대기 중) 표시는 클래스만 직접 토글
  const timerRef = useRef<number | undefined>(undefined);

  // 색인은 패널을 처음 열 때 만든다 (헤더만 있는 상태에선 아무 비용도 들이지 않는다)
  const base = useMemo(
    () => (open ? buildOmniIndex({ roster, includeFuture, locale, t, extra }) : []),
    [open, roster, includeFuture, locale, t, extra]);
  const items = useMemo(() => (rogueItems ? base.concat(rogueItems) : base), [base, rogueItems]);
  const picks = useMemo(() => picksFor(normSearch(term), crowd), [term, crowd]);
  // 선택 학습으로 익힌 은어 사전 ("록라" → 통합전략) — 내장 사전 위에 얹힌다
  const hints = useMemo(() => learnedHints(crowd) as Record<string, OmniKind[]>, [crowd]);
  const hits = useMemo(() => searchSmart(items, term, { picks, hints }), [items, term, picks, hints]);

  const openPanel = () => {
    setOpen(true);
    setCrowd({ ...crowdPicks() });                          // 이미 받아 둔 집계 즉시 반영
    void fetchCrowdPicks().then((index) => setCrowd({ ...index })).catch(() => { /* 테이블 미설치 */ });
  };
  // 상태 리셋은 이펙트가 아니라 닫기·입력 핸들러에서 직접 한다 (이펙트 setState = 연쇄 렌더)
  const close = () => {
    window.clearTimeout(timerRef.current);
    rawRef.current = "";
    setOpen(false); setTerm(""); setAsk(false); setActive(-1); setMsg(null);
  };
  // 타이핑 중엔 **아무 setState도 하지 않는다** (렌더 0회) — 멈춘 뒤 0.5초에 한 번만 검색한다.
  // 대기 중 표시는 목록 DOM에 클래스만 붙였다 떼므로 리액트 렌더가 필요 없다.
  const onInput = (value: string) => {
    rawRef.current = value;
    if (value) listRef.current?.classList.add("stale");
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      listRef.current?.classList.remove("stale");
      setAsk(false); setActive(-1); setMsg(null);
      setTerm(value);
      if (value.trim()) noteAction();     // 새 검색어 = 행동 1회 (실패 추적 창을 좁힌다)
    }, value ? SEARCH_DEBOUNCE_MS : 0);
  };
  const clearInput = () => {
    if (inputRef.current) inputRef.current.value = "";
    onInput("");
    inputRef.current?.focus();
  };

  // ⌘K·Ctrl+K로 열기 ("/"는 입력 중이 아닐 때만 — 검색어 타이핑을 가로채지 않게)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]");
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openPanel(); }
      else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); openPanel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // openPanel은 상태 세터·모듈 함수만 부른다 (매 렌더 새로 만들어져도 동작 동일)
  }, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);


  // Esc는 창 전체에서 받는다 — [바로가기] 버튼을 눌러 포커스가 입력란을 떠난 뒤에도 닫히게
  // (전역 esc-close.ts는 .modal-backdrop만 다루므로 이 패널은 스스로 처리한다)
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if ((e.key === "Escape" || e.key === "Esc") && !e.isComposing) close(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);

  /** 검색어에서 고른 항목 이름과 겹치는 앞부분을 뺀 조각 (은어 후보). 예: 쉐이록라 → 록라 */
  const leftoverToken = (q: string, hit: OmniHit): string | null => {
    // 이미 아는 분류어면 다시 배울 필요 없다
    if (splitHint(q, hints)) return null;
    let best = 0;
    for (const key of hit.keys) {
      let i = 0;
      while (i < key.length && i < q.length && key[i] === q[i]) i += 1;
      if (i > best) best = i;
    }
    if (best < 2) return null;
    const rest = q.slice(best);
    return /^[0-9a-z가-힣]{2,6}$/.test(rest) ? rest : null;
  };

  /** 이동. learn=true(목록에서 직접 고른 경우)면 그 선택을 기억한다.
   *  ⚠ 후보가 하나뿐이어도 검색어가 그 항목의 이름과 다르면(퍼지·별칭) 기록한다 —
   *  "크슬"의 유일 후보 크라운슬레이어를 클릭해도 candidates=1이라 학습이 안 쌓여,
   *  확장 색인이 없는 다음 세션엔 재검색이 실패했다 (사용자 제보 2026-07-26). */
  const go = (hit: OmniHit, learn: boolean, candidates: number, rawQuery: string, rank?: number) => {
    const q = normSearch(rawQuery);
    const informative = candidates >= 2 || hit.fuzzy || hit.learned || !hit.keys.includes(q);
    if (learn && q && informative) {
      recordPick(q, hit.uid, {
        kind: hit.kind, name: hit.name, locale,
        rank, candidates, fuzzy: hit.fuzzy, hinted: hit.hinted,
      });
      // 은어 학습 — 검색어에서 고른 항목의 이름(공통 접두)을 뺀 조각을 그 종류의 힌트로 기억한다.
      // "쉐이록라"에서 쉐이 테마를 고르면 → "록라"는 통합전략 (다음엔 "미즈키록라"도 통한다).
      const rest = leftoverToken(q, hit);
      if (rest) recordHint(rest, hit.kind);
    }
    // 실패 검색 → 재검색해 고른 선택 잇기 (사용자 제보 2026-07-26: "보텀" 실패 후
    // "트라고디아"를 검색해 클릭해도 보텀이 학습되지 않았다). 10분 안의 실패 검색어를
    // 이 선택에 표로 연결한다 — 같은 세션에서 즉시 반영되고 DB에도 남는다.
    const missQ = recentMissQ();
    if (q && missQ && missQ !== q) {
      recordPick(missQ, hit.uid, { kind: hit.kind, name: hit.name, locale });
      consumeMiss();
    }
    // 방금 만든 표를 화면에도 즉시 반영 (지도는 omni-picks가 이미 갱신했다)
    setCrowd({ ...crowdPicks() });
    setTick((n) => n + 1);
    close();
    onGo(hit.target);
  };
  const pick = (hit: OmniHit, rank?: number) => go(hit, true, hits.length, term || rawRef.current, rank);

  // 통합전략 세부 항목까지 확장 (한 세션에 한 번만 내려받는다)
  const loadRogue = async (): Promise<OmniItem[]> => {
    if (rogueItems) return rogueItems;
    setBusy(true);
    try {
      const index = await getRogueIndex(locale);
      const extraItems = rogueOmniItems(index, includeFuture, t);
      setRogueItems(extraItems);
      return extraItems;
    } catch {
      setMsg(t("통합전략 데이터를 불러오지 못했어요 — 잠시 후 다시 시도해 주세요."));
      return [];
    } finally {
      setBusy(false);
    }
  };

  // 통합전략 세부 항목(2.9MB)은 **알아서** 불러온다 (사용자 요청 2026-07-25: 버튼 없이 바로 찾기).
  // 조건: 가벼운 색인이 빈손이거나, 검색어가 통합전략을 가리킬 때. 한 세션에 한 번뿐이고
  // 통합전략을 안 찾는 사람은 영영 안 받는다. (setTimeout = 이펙트 안 동기 setState 회피)
  useEffect(() => {
    if (!open || rogueItems || busy || !term.trim()) return;
    const hint = splitHint(normSearch(term), hints);
    // 학습된 별명이 통합전략 항목(rg:)을 가리키면 색인을 불러와야 주입이 된다 —
    // 잡음 결과가 몇 개 떠 있어도(hits.length>0) 학습 항목이 빠지면 안 되므로 함께 본다.
    // 퍼지 잡음뿐인 검색(확신 매칭 없음)도 확장 색인에서 진짜 답을 찾아본다.
    const solid = hits.some((h) => h.learned || h.hinted || h.score >= FUZZY_GATE);
    const wantsRogue = !solid
      || hint?.kinds.some((kind) => kind === "rogue" || kind === "topic")
      || (picks && Object.keys(picks).some((uid) => uid.startsWith("rg:")));
    if (!wantsRogue) return;
    const timer = window.setTimeout(() => { void loadRogue(); }, 0);
    return () => window.clearTimeout(timer);
    // loadRogue·hints는 렌더마다 새로 만들어지지만 하는 일이 같다 (term 기준으로만 재시도)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, term, hits.length, rogueItems, busy]);

  // 확신 매칭이 하나도 없으면 "실패한 검색"으로 남긴다 — 이후 도착한 목적지를 이 검색어에
  // 이어 붙이기 위해서다 (app/trail.ts). ⚠ 0건일 때만 세면 안 된다: "보텀" 같은 검색은
  // 퍼지 잡음(토터)이 몇 개 떠서 미스로 안 잡혔고, 그래서 실패→도착 학습이 영영 시작되지
  // 않았다 (사용자 제보 2026-07-26). 통합전략 자동 로드가 끝난 뒤에만 센다.
  useEffect(() => {
    if (!open || busy || !term.trim()) return;
    if (hits.some((h) => h.learned || h.hinted || h.score >= FUZZY_GATE)) return;
    if (!rogueItems) return;                 // 아직 확장 검색 전 — 진짜 미스인지 모른다
    noteMiss(normSearch(term), locale);
  }, [open, busy, term, hits, rogueItems, locale]);

  // 되묻기로 전환 — 포커스를 입력란으로 되돌려 ↑↓·⏎로 바로 고를 수 있게 한다
  const askUser = () => { setAsk(true); setActive(0); inputRef.current?.focus(); };

  // [바로가기]·⏎ — 디바운스를 기다리지 않고 **지금 입력값으로** 즉시 검색한다
  const submit = async () => {
    const query = rawRef.current;
    const raw = query.trim();
    if (!raw || busy) return;
    window.clearTimeout(timerRef.current);
    listRef.current?.classList.remove("stale");
    setTerm(query);                                   // 화면 목록도 이 검색어에 맞춘다
    const here = currentRogueTopic();                 // 통합전략 가이드를 보는 중이면 그 테마를 사전확률로
    const now = picksFor(normSearch(query), crowd);
    const list = searchSmart(items, query, { picks: now, hints });
    const direct = decideOmni(list, here);
    if (direct) { go(direct, false, list.length, query); return; }
    // 가벼운 색인이 아무것도 못 찾았으면 통합전략 항목까지 뒤진다
    if (!list.length && !rogueItems) {
      const extraItems = await loadRogue();
      const merged = searchSmart(base.concat(extraItems), query, { picks: now, hints });
      const second = decideOmni(merged, here);
      if (second) { go(second, false, merged.length, query); return; }
      if (!merged.length) { setMsg(t("‘{q}’와(과) 관련된 항목을 찾지 못했어요.", { q: raw })); return; }
      askUser();
      return;
    }
    if (!list.length) { setMsg(t("‘{q}’와(과) 관련된 항목을 찾지 못했어요.", { q: raw })); return; }
    askUser();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); return; }
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (active >= 0 && hits[active]) pick(hits[active], active);
      else void submit();
    }
  };

  const panel = open ? createPortal(
    <div className="omni-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="omni-panel" role="dialog" aria-modal="true" aria-label={t("유니버셜 서치 — 사이트 전체 검색")}>
        <div className="omni-bar">
          <span className="omni-bar-icon" aria-hidden>⌕</span>
          {/* 비제어 입력 — value를 React가 되돌려 쓰지 않으므로 글자는 브라우저 속도로 바로 뜬다.
              지우기(×)·바로가기의 비활성 표시는 :placeholder-shown CSS로 (상태 렌더 없이). */}
          <input ref={inputRef} defaultValue="" onInput={(e) => onInput(e.currentTarget.value)} onKeyDown={onKeyDown}
            placeholder={t("오퍼레이터 · 재료 · 스토리 · 통합전략 · 기능 검색")}
            aria-label={t("유니버셜 서치 — 사이트 전체 검색")} enterKeyHint="go" />
          <button type="button" className="omni-clear" onClick={clearInput} aria-label={t("검색어 지우기")}>×</button>
          <button type="button" className="omni-go" onClick={() => void submit()} disabled={busy}>
            {busy ? t("찾는 중…") : t("바로가기")}
          </button>
        </div>

        {ask && <p className="omni-ask">{t("이 중에 무엇인가요?")}<em>{t("고른 항목을 기억해 다음엔 바로 이동해요")}</em></p>}
        {msg && <p className="omni-msg">{msg}</p>}

        {hits.length > 0 && (
          <ul className="omni-list" ref={listRef} role="listbox" aria-label={t("검색 결과")}>
            {hits.map((hit, i) => (
              <li key={hit.uid} role="option" aria-selected={i === active}>
                <button type="button" className={i === active ? "active" : ""} onClick={() => pick(hit, i)} onMouseEnter={() => setActive(i)}>
                  <span className="omni-icon" data-kind={hit.kind}>
                    {hit.img ? <img src={hit.img} alt="" width={40} height={40} loading="lazy" decoding="async" />
                      : <em aria-hidden>{KIND_GLYPH[hit.kind] ?? "◆"}</em>}
                  </span>
                  <span className="omni-name">{hit.name}</span>
                  {hit.fuzzy && <span className="omni-approx">{t("비슷한 이름")}</span>}
                  {hit.votes >= LEARNED_MIN && <span className="omni-learned">{t("자주 선택")}</span>}
                  <span className="omni-sub">{hit.sub}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="omni-foot">
          {busy && <span className="omni-loading">{t("통합전략 데이터를 불러오는 중…")}</span>}
          <span className="omni-hint">{t("↑↓ 이동 · ⏎ 바로가기 · Esc 닫기")}</span>
        </div>
      </div>
    </div>, document.body) : null;

  return (
    <div className="omni">
      {/* 입력창처럼 생긴 트리거 (사용자 확정 2026-07-26) — 실제 입력은 클릭 시 열리는
          패널에서 한다. 검색창으로 보이도록 placeholder풍 문구 + ⌘K 힌트. */}
      <button type="button" className="omni-trigger" onClick={openPanel} aria-label={t("유니버셜 서치 — 사이트 전체 검색")}
        title={t("유니버셜 서치 — 오퍼·재료·스토리·통합전략·기능을 한 번에 찾아 이동합니다 (⌘K)")}>
        <span aria-hidden>⌕</span>
        <span className="omni-trigger-label">{t("유니버셜 서치")}{isNewFeature("omni") && <span className="new-badge">{t("새기능")}</span>}</span>
        <kbd className="omni-trigger-kbd" aria-hidden>⌘K</kbd>
      </button>
      {panel}
    </div>
  );
}
