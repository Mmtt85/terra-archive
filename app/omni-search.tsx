"use client";

// 헤더 만능검색 UI — 단어 하나로 사이트 안 아무 컨텐츠나 찾아 이동한다 (사용자 요청 2026-07-25).
//
//  · 트리거는 헤더 1줄(로고·햄버거와 같은 줄)이라 **헤더를 접어도 남는다**.
//  · 패널: 입력란 + [바로가기] 버튼 + 결과 목록. 1위가 확실하면 곧장 이동하고,
//    애매하면(동점·완전일치 여럿) "이 중에 무엇인가요?" 선택지를 띄운다 — 판정은 omni.ts.
//  · 통합전략 세부 항목(유물·조우·작전…)은 스샷 레이더 인덱스(2.9MB)라 기본 색인에서 빠져
//    있고, 가벼운 색인으로 답이 안 나올 때만 지연 로드해 합친다.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getRogueIndex } from "./lens/run";
import { buildOmniIndex, currentRogueTopic, decideOmni, rogueOmniItems, searchOmni, type OmniHit, type OmniItem, type OmniTarget } from "./omni";
import { useI18n, type ExtraI18n } from "./i18n";
import { isNewFeature } from "./whats-new";
import type { Operator } from "./home";

// 이미지가 없는 종류의 아이콘 — 햄버거 탭 아이콘과 같은 글리프를 써서 어디로 가는지 읽히게
const KIND_GLYPH: Record<string, string> = { story: "✦", tag: "◎", rogue: "❖", tab: "◇" };

export default function OmniSearch({ roster, nicknames, includeFuture, extra, onGo }: {
  roster: Operator[];
  nicknames?: Map<string, { name: string; votes: number }[]>;
  includeFuture: boolean;
  extra?: ExtraI18n | null;
  onGo: (target: OmniTarget) => void;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ask, setAsk] = useState(false);          // "이 중에 무엇인가요?" (되묻기)
  const [active, setActive] = useState(-1);       // ↑↓로 고른 줄 (-1 = 아직 안 고름)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rogueItems, setRogueItems] = useState<OmniItem[] | null>(null);  // 지연 로드된 통합전략 항목
  const inputRef = useRef<HTMLInputElement>(null);

  // 색인은 패널을 처음 열 때 만든다 (헤더만 있는 상태에선 아무 비용도 들이지 않는다)
  const base = useMemo(
    () => (open ? buildOmniIndex({ roster, nicknames, includeFuture, locale, t, extra }) : []),
    [open, roster, nicknames, includeFuture, locale, t, extra]);
  const items = useMemo(() => (rogueItems ? base.concat(rogueItems) : base), [base, rogueItems]);
  const hits = useMemo(() => searchOmni(items, query), [items, query]);

  // ⌘K·Ctrl+K로 열기 ("/"는 입력 중이 아닐 때만 — 검색어 타이핑을 가로채지 않게)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]");
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen(true); }
      else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  // 상태 리셋은 이펙트가 아니라 닫기·입력 핸들러에서 직접 한다 (이펙트 setState = 연쇄 렌더)
  const close = () => { setOpen(false); setQuery(""); setAsk(false); setActive(-1); setMsg(null); };
  // 검색어가 바뀌면 되묻기 상태를 푼다 (새 질문이니까)
  const onChange = (value: string) => { setQuery(value); setAsk(false); setActive(-1); setMsg(null); };

  // Esc는 창 전체에서 받는다 — [바로가기] 버튼을 눌러 포커스가 입력란을 떠난 뒤에도 닫히게
  // (전역 esc-close.ts는 .modal-backdrop만 다루므로 이 패널은 스스로 처리한다)
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if ((e.key === "Escape" || e.key === "Esc") && !e.isComposing) close(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);

  const go = (hit: OmniHit) => { close(); onGo(hit.target); };

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

  // 되묻기로 전환 — 포커스를 입력란으로 되돌려 ↑↓·⏎로 바로 고를 수 있게 한다
  const askUser = () => { setAsk(true); setActive(0); inputRef.current?.focus(); };

  const submit = async () => {
    if (!query.trim() || busy) return;
    // 통합전략 가이드를 보는 중이면 그 테마를 사전확률로 준다 (동명 유물이 테마마다 있음)
    const here = currentRogueTopic();
    const direct = decideOmni(hits, here);
    if (direct) { go(direct); return; }
    // 가벼운 색인이 아무것도 못 찾았으면 통합전략 항목까지 뒤진다
    if (!hits.length && !rogueItems) {
      const extraItems = await loadRogue();
      const merged = searchOmni(base.concat(extraItems), query);
      const second = decideOmni(merged, here);
      if (second) { go(second); return; }
      if (!merged.length) { setMsg(t("‘{q}’와(과) 관련된 항목을 찾지 못했어요.", { q: query.trim() })); return; }
      askUser();
      return;
    }
    if (!hits.length) { setMsg(t("‘{q}’와(과) 관련된 항목을 찾지 못했어요.", { q: query.trim() })); return; }
    askUser();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); return; }
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (active >= 0 && hits[active]) go(hits[active]);
      else void submit();
    }
  };

  const panel = open ? createPortal(
    <div className="omni-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="omni-panel" role="dialog" aria-modal="true" aria-label={t("사이트 통합 검색")}>
        <div className="omni-bar">
          <span className="omni-bar-icon" aria-hidden>⌕</span>
          <input ref={inputRef} value={query} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}
            placeholder={t("오퍼레이터 · 재료 · 스토리 · 통합전략 · 기능 검색")}
            aria-label={t("사이트 통합 검색")} enterKeyHint="go" />
          {query && <button type="button" className="omni-clear" onClick={() => { onChange(""); inputRef.current?.focus(); }} aria-label={t("검색어 지우기")}>×</button>}
          <button type="button" className="omni-go" onClick={() => void submit()} disabled={busy || !query.trim()}>
            {busy ? t("찾는 중…") : t("바로가기")}
          </button>
        </div>

        {ask && <p className="omni-ask">{t("이 중에 무엇인가요?")}</p>}
        {msg && <p className="omni-msg">{msg}</p>}

        {hits.length > 0 && (
          <ul className="omni-list" role="listbox" aria-label={t("검색 결과")}>
            {hits.map((hit, i) => (
              <li key={hit.uid} role="option" aria-selected={i === active}>
                <button type="button" className={i === active ? "active" : ""} onClick={() => go(hit)} onMouseEnter={() => setActive(i)}>
                  <span className="omni-icon" data-kind={hit.kind}>
                    {hit.img ? <img src={hit.img} alt="" width={40} height={40} loading="lazy" decoding="async" />
                      : <em aria-hidden>{KIND_GLYPH[hit.kind] ?? "◆"}</em>}
                  </span>
                  <span className="omni-name">{hit.name}</span>
                  <span className="omni-sub">{hit.sub}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="omni-foot">
          {!rogueItems && query.trim() && (
            <button type="button" className="omni-more" onClick={() => void (async () => {
              const extraItems = await loadRogue();
              if (extraItems.length) askUser();
            })()} disabled={busy}>
              {busy ? t("통합전략 데이터를 불러오는 중…") : t("통합전략 세부 항목까지 찾기")}
            </button>
          )}
          <span className="omni-hint">{t("↑↓ 이동 · ⏎ 바로가기 · Esc 닫기")}</span>
        </div>
      </div>
    </div>, document.body) : null;

  return (
    <div className="omni">
      <button type="button" className="omni-trigger" onClick={() => setOpen(true)} aria-label={t("사이트 통합 검색")} title={t("사이트 통합 검색 (⌘K)")}>
        <span aria-hidden>⌕</span>
        <span className="omni-trigger-label">{t("검색")}{isNewFeature("omni") && <span className="new-badge">{t("새기능")}</span>}</span>
      </button>
      {panel}
    </div>
  );
}
