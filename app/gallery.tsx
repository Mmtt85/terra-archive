"use client";

// 갤러리 (/gallery) — 스토리 CG · 스탠딩 · 오퍼 일러스트를 한곳에서 둘러본다.
// 제안 게시판 요청 → 사용자 승인 2026-10-04 ("역대 CG나 오퍼들 스탠딩 혹은 정예 일러를 정리해서 볼 수 있는 항목").
// 그림은 전부 **이미 R2 에 있는 것**이다 — 스토리 리더기(CG·스탠딩)와 오퍼 상세의 스킨 절(일러스트)이 쓰는 그 파일.
// 색인은 scripts/build-gallery.py (app/data/gallery*.json), 일러스트는 오퍼별 스킨 문서를 창을 열 때 받는다.
//
// 보기 선택(CG·스탠딩·일러스트)은 해시(#cg·#sprite·#illust)로 — 프리렌더는 언제나 CG 라, 딥링크 첫 페인트는
// data-hashswap 가리개 + useLayoutEffect 로 맞춘다 (new-screen 점검표 §1).

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { asset, storyCutUrl } from "./assets";
import { useI18n } from "./i18n";
import { ModalWindow } from "./modal-window";
import { normSearch, useSearchInput } from "./search";
import { AttributeFilter } from "./attr-filter";
import eventIdsData from "./data/event-ids.json";
import { useMe } from "./me-store";

// 스토리 상세 — 스탠딩 창의 '등장 스토리'를 누르면 페이지를 넘기지 않고 겹쳐 띄운다 (이벤트 도감과 같은 부품)
// 이벤트 도감이 아는 이벤트 — '등장 스토리'가 이벤트면 이벤트 모달, 메인 스토리 장이면 스토리 상세 (사용자 지시 2026-10-04)
const EVENT_IDS = new Set((eventIdsData as { ids: string[] }).ids);
const StoryModal = lazy(() => import("./story").then((m) => ({ default: m.StoryDetailById })));

/** req — 에피소드(1부터) → 그 스토리가 열리는 조건 [[작전 id, 최소 상태(1 진입·2 클리어·3 완벽)]] (scripts/build-gallery.py req_of).
 *  키가 없는 에피소드는 '모름'이다 — 내 진행을 알아도 가린다 (중섭 선행 스토리 등) */
type GEvent = { id: string; n: string; cuts: [string, number, number?, string?][]; fut?: 1; req?: Record<string, [string, number][]>;
  /** 에피소드 → storyId(앞의 '<스토리 id>_' 를 뗀 것) — 계정의 '연 스토리'(profile.stories)와 맞춘다 */
  sid?: Record<string, string> };
// 통합전략·생존연산 묶음 — 섹션(키비주얼·조우 CG·층·음반 / 월드맵·보스·NPC·지역)마다 [경로, 이름]
type GArt = { id: string; n: string; link: string; fut?: 1; secs: { k: string; pics: [string, string][] }[] };
type CgKind = "main" | "event" | "rogue" | "sandbox";
const CG_KINDS: CgKind[] = ["main", "event", "rogue", "sandbox"];
const CG_KIND_LABEL: Record<CgKind, string> = { main: "메인 스토리", event: "이벤트", rogue: "통합전략", sandbox: "생존연산" };
const SEC_LABEL: Record<string, string> = {
  kv: "키 비주얼", scene: "우연한 만남", zone: "구역", capsule: "레퍼토리",
  world: "월드맵", boss: "보스", npc: "NPC",
};
/** CG 보기의 한 장 — 이야기 CG 와 통합전략·생존연산 그림을 같은 모양으로 */
/** cap = 한 줄 설명(이야기 CG 는 그 CG 가 뜨는 장면의 대사, 통합전략은 조우·구역·음반 이름) · tag = EP 표시 */
type Pic = { src: string; cap: string; tag?: string; href: string; go: string; story?: { id: string; n: string; ep: number; line: number };
  /** 이 CG 가 나오는 에피소드의 열림 조건 — undefined 면 모름(통합전략·생존연산 그림·중섭 선행 스토리) */
  req?: [string, number][];
  /** 그 스토리 전체가 조건으로 쓰는 작전 id — 조건 없는 에피소드(이벤트 첫 화 등)를 열어 줄지 가르는 데 쓴다 */
  reqAll?: string[];
  /** 그 에피소드의 storyId (계정 '연 스토리'와 같은 모양) + 그 스토리 id */
  sid?: string; gid?: string };
type CgGroup = { id: string; n: string; kind: CgKind; fut?: 1; secs: { k?: string; pics: Pic[] }[]; all: Pic[] };
type GChar = { id: string; n: string; f: string[]; op?: string; s?: number[] };
export type GalleryDoc = { main: GEvent[]; events: GEvent[]; rogue?: GArt[]; sandbox?: GArt[];
  /** 등장 스토리 목록 [id, 이름] — CG 없는 스토리 포함. 인물의 s 는 이 목록의 번호 */
  refs?: [string, string][]; chars: GChar[] };
export type GalleryOp = { id: string; name: string; rarity: number; job?: string; subProfession?: string; unreleased?: boolean };
type SkinEntry = { id: string; name: string; stage?: string; artists: string[]; portrait: string; default?: boolean };

type View = "cg" | "sprite" | "illust";
const VIEWS: View[] = ["cg", "sprite", "illust"];
// ⚠ 사전(t)을 안 거친다 — "일러스트" 키는 이미 화가 표기용(EN "Artist")으로 쓰이고 있다
const VIEW_LABEL: Record<View, Record<string, string>> = {
  cg: { ko: "CG", en: "CG", ja: "CG" },
  sprite: { ko: "스탠딩", en: "Sprites", ja: "立ち絵" },
  illust: { ko: "일러스트", en: "Artwork", ja: "イラスト" },
};
const LOCALE_BASE: Record<string, string> = { ko: "", en: "/en", ja: "/ja" };
// 그림 수 — 사전의 "{n}장" 키는 다른 화면이 '부(copies)' 뜻으로 쓰고 있어 EN 이 "9 copies" 로 나왔다. 여기서 직접 정한다.
const imgCount = (locale: string, n: number) => (locale === "en" ? `${n} images` : locale === "ja" ? `${n}枚` : `${n}장`);
const SPOIL_KEY = "ta:gallery-spoiler";
// 스포일러 가리기 — 브라우저 저장소 값을 useSyncExternalStore 로 읽는다 (서버·하이드레이션 스냅샷은 꺼짐이라 프리렌더와 안 갈린다)
const SPOIL_EVENT = "ta:gallery-spoiler";
const readSpoil = () => { try { return localStorage.getItem(SPOIL_KEY) === "1"; } catch { return false; } };
const subscribeSpoil = (cb: () => void) => { window.addEventListener(SPOIL_EVENT, cb); return () => window.removeEventListener(SPOIL_EVENT, cb); };
const writeSpoil = (on: boolean) => {
  try { localStorage.setItem(SPOIL_KEY, on ? "1" : "0"); } catch { /* 저장소가 막혀 있으면 이번 화면만 */ }
  window.dispatchEvent(new Event(SPOIL_EVENT));
};

const storyHref = (base: string, id: string, ep = 1) => `${base}/stories#story-${id}${ep > 1 ? `/ep${ep}` : ""}`;
// 링크는 새 탭·크롤러용으로 남기고, 그냥 누르면 페이지를 넘기지 않고 그 자리의 동작(오퍼 상세 모달)만
const plainClick = (event: React.MouseEvent) => !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0);
const cutSrc = (n: string) => storyCutUrl(n);
const spriteSrc = (c: GChar, tail: string) => asset(`/story/sprite/${encodeURIComponent(c.id + tail)}.webp`);
const viewFromHash = (h: string): View => (VIEWS.includes(h.replace(/^#/, "") as View) ? (h.replace(/^#/, "") as View) : "cg");
// 해시만 바꾼다 — location.hash 대입은 vinext RSC 내비게이션을 타서 정적 배포에서 무한 재시도에 빠진다 (점검표 §2)
const writeHash = (v: View) => {
  const url = `${location.pathname}${location.search}${v === "cg" ? "" : `#${v}`}`;
  History.prototype.replaceState.call(history, history.state, "", url);
};

/** 스탠딩 분류 경로 판정 — [op, 직군, 세부 직군] · [npc, 등장 스토리 번호] */
function charMatch(c: GChar, path: string[], opById: Map<string, GalleryOp>): boolean {
  const [k, a, b] = path;
  if (!k) return true;
  if (k === "op") {
    if (!c.op) return false;
    const o = opById.get(c.op);
    return (!a || o?.job === a) && (!b || o?.subProfession === b);
  }
  if (c.op) return false;
  return !a || (c.s ?? []).includes(Number(a));
}

export default function Gallery({ doc, operators, includeFuture, onShowOperator, onOpenEvent }: {
  doc: GalleryDoc; operators: GalleryOp[]; includeFuture?: boolean;
  /** 오퍼 상세 모달 — 페이지를 넘기지 않고 그 자리에 (사용자 지시 2026-10-04) */
  onShowOperator?: (id: string) => void;
  /** 이벤트 모달 — 페이지를 넘기지 않고 그 자리에 (home.tsx openEventById) */
  onOpenEvent?: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  const [view, setView] = useState<View>("cg");
  const { term, clear, inputProps } = useSearchInput();
  // 분류 — 한 갈래씩 좁혀 가는 계층 (작전 도감과 같은 규약: 같은 단계는 하나만, 다시 누르면 해제)
  //   CG       메인 스토리 → 장 · 이벤트 → 이벤트
  //   스탠딩   오퍼레이터 → 직군 → 세부 직군 · 그 외 인물 → 등장 스토리
  //   일러스트 직군 → 세부 직군 (+ 등급은 따로)
  const [lv, setLv] = useState<string[]>([]);
  const [rar, setRar] = useState<string[]>([]);
  const spoil = useSyncExternalStore(subscribeSpoil, readSpoil, () => false);
  // 스포 방지 — '내 정보' 계정이 있으면 내 진행 기준으로 아직 안 열린 에피소드의 CG 만 가린다 (사용자 요청 2026-10-06).
  // 계정이 없으면 종전처럼 전부. 조건을 모르는 그림(req 없음)은 계정이 있어도 가린다
  const myProfile = useMe()?.profile ?? null;
  const myStages = myProfile?.stages ?? null;
  const myStories = myProfile?.stories ?? null;
  // 조건 없는 에피소드(작전 없이 이벤트가 열리면 바로 보이는 첫 화·미니 스토리)는 그 스토리의 작전에 한 번이라도 들어가 봤을 때만 연다 —
  // 그냥 열면 이벤트를 안 한 사람에게도 보였다. 작전이 하나도 없는 스토리는 진행을 알 수 없어 가린다
  const locked = (pic: Pic) => {
    if (!myStages) return true;
    // 게임 '스토리 회상'이 이미 연 에피소드면 보인다 — 끝난 이벤트도 여기로 안다 (다시 동기화 뒤부터 있다)
    if (pic.sid && pic.gid && myStories?.[pic.gid]?.includes(pic.sid)) return false;
    if (!pic.req) return true;
    if (!pic.req.length) return !(pic.reqAll ?? []).some((id) => (myStages[id] ?? -1) >= 1);
    return pic.req.some(([id, lv]) => (myStages[id] ?? -1) < lv);
  };
  const [cgOpen, setCgOpen] = useState<{ g: CgGroup; i: number } | null>(null);
  const [charOpen, setCharOpen] = useState<GChar | null>(null);
  const [opOpen, setOpOpen] = useState<GalleryOp | null>(null);
  const [storyOpen, setStoryOpen] = useState<{ id: string; n: string; k: number; ep?: number; line?: number } | null>(null);
  // 스토리 창은 자기 보기를 해시(#story-<id>/ep3 …)에 쓴다 — 닫으면 갤러리 보기 해시로 되돌린다
  const closeStory = () => { setStoryOpen(null); writeHash(view); };

  useLayoutEffect(() => {
    // 보기 이름이 아닌 해시(겹쳐 뜬 스토리 창의 #story-… 등)는 무시한다 — 뒤 화면이 CG 로 튀지 않게
    const apply = () => {
      const h = location.hash.replace(/^#/, "");
      if (!h || VIEWS.includes(h as View)) setView(viewFromHash(location.hash));
    };
    apply();
    document.documentElement.removeAttribute("data-hashboot");
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const toggleSpoil = () => writeSpoil(!spoil);
  const resetFilters = () => { setLv([]); setRar([]); clear(false); };
  const pick = (v: View) => { setView(v); resetFilters(); writeHash(v); };

  const q = normSearch(term);
  const storyList = useMemo(() => (doc.refs ?? []).map(([id, n]) => ({ id, n })), [doc]);
  const opById = useMemo(() => new Map(operators.map((o) => [o.id, o])), [operators]);
  const base = LOCALE_BASE[locale] ?? "";
  const storyHrefOf = (id: string, ep = 1) => storyHref(base, id, ep);
  // 미실장 오퍼는 상세 라우트가 없다 — 목록 + #op- 딥링크 (home.tsx operatorHref 와 같은 규약)
  const opHrefOf = (id: string) => (opById.get(id)?.unreleased ? `${base}/operators#op-${id}` : `${base}/operators/${id}`);
  // CG 묶음 전부 — 이야기(장·이벤트)는 '스토리에서 보기', 통합전략·생존연산은 '가이드에서 보기'
  const cgAll = useMemo<CgGroup[]>(() => {
    const story = (e: GEvent, kind: CgKind): CgGroup => {
      const reqAll = [...new Set(Object.values(e.req ?? {}).flat().map(([id]) => id))];
      const pics = e.cuts.map(([name, ep, line, cap]) => ({
        src: cutSrc(name), cap: cap ?? "", tag: `EP ${ep}`, href: storyHref(base, e.id, ep), go: "스토리에서 보기",
        story: { id: e.id, n: e.n, ep, line: line ?? 0 }, req: e.req?.[String(ep)], reqAll, sid: e.sid?.[String(ep)], gid: e.id,
      }));
      return { id: e.id, n: e.n, kind, fut: e.fut, secs: [{ pics }], all: pics };
    };
    const art = (g: GArt, kind: CgKind): CgGroup => {
      const secs = g.secs.map((sec) => ({
        k: sec.k,
        pics: sec.pics.map(([path, cap]) => ({ src: asset(path), cap, href: `${base}${g.link}`, go: "가이드에서 보기" })),
      }));
      return { id: g.id, n: g.n, kind, fut: g.fut, secs, all: secs.flatMap((x) => x.pics) };
    };
    return [
      ...doc.main.map((e) => story(e, "main")), ...doc.events.map((e) => story(e, "event")),
      ...(doc.rogue ?? []).map((g) => art(g, "rogue")), ...(doc.sandbox ?? []).map((g) => art(g, "sandbox")),
    ];
  }, [doc, base]);
  const groups = useMemo(() => {
    const [k, id] = lv;
    const all = cgAll.filter((g) => (!k || g.kind === k) && (!id || g.id === id));
    return q ? all.filter((g) => normSearch(g.n).includes(q)) : all;
  }, [cgAll, lv, q]);
  const chars = useMemo(() => {
    const coll = new Intl.Collator(locale, { ignorePunctuation: true, sensitivity: "base" });
    return doc.chars
      .filter((c) => charMatch(c, lv, opById))
      .filter((c) => !q || normSearch(c.n).includes(q))
      .sort((a, b) => coll.compare(a.n, b.n));
  }, [doc, lv, q, locale, opById]);
  const opPool = useMemo(() => operators.filter((o) => includeFuture || !o.unreleased), [operators, includeFuture]);
  const ops = useMemo(() => opPool
    .filter((o) => (!lv[0] || o.job === lv[0]) && (!lv[1] || o.subProfession === lv[1]))
    .filter((o) => rar.length === 0 || rar.includes(String(o.rarity)))
    .filter((o) => !q || normSearch(o.name).includes(q))
    .sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, locale)), [opPool, lv, rar, q, locale]);

  const nCuts = groups.reduce((n, g) => n + g.all.length, 0);
  const count = view === "cg" ? nCuts : view === "sprite" ? chars.length : ops.length;
  // 직군·세부 직군 — 게임 표기(로케일 데이터) 그대로, 처음 나온 순서
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const jobs = (pool: GalleryOp[]) => uniq(pool.map((o) => o.job));
  const subsOf = (pool: GalleryOp[], job: string) => uniq(pool.filter((o) => o.job === job).map((o) => o.subProfession));
  const one = (path: string[]) => setLv((cur) => (cur.length === path.length && cur.every((x, i) => x === path[i]) ? path.slice(0, -1) : path));
  const charOps = useMemo(() => doc.chars.flatMap((c) => {
    const o = c.op ? opById.get(c.op) : undefined;
    return o ? [o] : [];
  }), [doc, opById]);
  const countChars = (path: string[]) => doc.chars.filter((c) => charMatch(c, path, opById)).length;
  const groupsFor: Parameters<typeof AttributeFilter>[0]["groups"] = view === "cg" ? [{
    title: t("분류"), items: CG_KINDS.filter((k) => cgAll.some((g) => g.kind === k)), selected: lv.slice(0, 1), single: true,
    labelFor: (v) => t(CG_KIND_LABEL[v as CgKind] ?? v),
    countForItem: (v) => cgAll.filter((g) => g.kind === v).reduce((n, g) => n + g.all.length, 0),
    onToggle: (v) => one([v]),
    subFor: (path) => {
      if (path.length !== 1) return null;
      const list = cgAll.filter((g) => g.kind === path[0]);
      return {
        title: t(CG_KIND_LABEL[path[0] as CgKind] ?? path[0]), items: list.map((g) => g.id), selected: lv.slice(1, 2), single: true,
        labelFor: (id) => list.find((g) => g.id === id)?.n ?? id,
        countForItem: (id) => list.find((g) => g.id === id)?.all.length ?? 0,
        onPick: (id) => one([path[0], id]),
      };
    },
  }] : view === "sprite" ? [{
    title: t("분류"), items: ["op", "npc"], selected: lv.slice(0, 1), single: true,
    labelFor: (v) => (v === "op" ? t("오퍼레이터") : t("그 외 인물")),
    countForItem: (v) => countChars([v]),
    onToggle: (v) => one([v]),
    subFor: (path) => {
      const [k, a] = path;
      if (k === "op" && path.length === 1) {
        return { title: t("직군"), items: jobs(charOps), selected: lv.slice(1, 2), single: true,
          countForItem: (j) => countChars(["op", j]), onPick: (j) => one(["op", j]) };
      }
      if (k === "op" && path.length === 2) {
        const subs = subsOf(charOps, a);
        return subs.length > 1 ? { title: t("세부 직군"), items: subs, selected: lv.slice(2, 3), single: true,
          countForItem: (b) => countChars(["op", a, b]), onPick: (b) => one(["op", a, b]) } : null;
      }
      if (k === "npc" && path.length === 1) {
        const items = storyList.map((_, i) => String(i)).filter((i) => countChars(["npc", i]) > 0);
        return { title: t("등장 스토리"), items, selected: lv.slice(1, 2), single: true,
          labelFor: (i) => storyList[Number(i)]?.n ?? i,
          countForItem: (i) => countChars(["npc", i]), onPick: (i) => one(["npc", i]) };
      }
      return null;
    },
  }] : [{
    title: t("직군"), items: jobs(opPool), selected: lv.slice(0, 1), single: true,
    countForItem: (j) => opPool.filter((o) => o.job === j).length,
    onToggle: (j) => one([j]),
    subFor: (path) => {
      if (path.length !== 1) return null;
      const subs = subsOf(opPool, path[0]);
      return subs.length > 1 ? { title: t("세부 직군"), items: subs, selected: lv.slice(1, 2), single: true,
        countForItem: (b) => opPool.filter((o) => o.job === path[0] && o.subProfession === b).length,
        onPick: (b) => one([path[0], b]) } : null;
    },
  }, {
    title: t("등급"), items: ["6", "5", "4", "3", "2", "1"], selected: rar, labelFor: (v) => `★${v}`,
    countForItem: (v) => opPool.filter((o) => String(o.rarity) === v).length,
    onToggle: (v) => setRar((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])),
  }];
  // 고른 조건 칩 — 맨 아래 단계 이름 하나로 (누르면 한 단계 위로)
  const lvLabel = (): string | null => {
    if (!lv.length) return null;
    const last = lv[lv.length - 1];
    if (view === "cg") return lv.length === 1 ? t(CG_KIND_LABEL[last as CgKind] ?? last) : cgAll.find((g) => g.id === last)?.n ?? last;
    if (view === "sprite") {
      if (lv.length === 1) return last === "op" ? t("오퍼레이터") : t("그 외 인물");
      return lv[0] === "npc" ? storyList[Number(last)]?.n ?? last : last;
    }
    return last;
  };

  return (
    <section className="explorer gl-explorer" aria-labelledby="gallery-title" data-hashswap>
      <div className="filter-panel">
        <div className="panel-heading">
          <div><span className="section-no">FILTER / 01</span><h2 id="gallery-title">{t("탐색 조건")}</h2></div>
          <button className="reset" onClick={resetFilters}>↻ {t("초기화")}</button>
        </div>
        <div className="gl-views" role="tablist" aria-label={t("갤러리")}>
          {VIEWS.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v}
              className={view === v ? "selected" : ""} onClick={() => pick(v)}>{VIEW_LABEL[v][locale] ?? VIEW_LABEL[v].ko}</button>
          ))}
        </div>
        <div className="search-wrap panel-search">
          <span>⌕</span>
          <input id="gallery-search" {...inputProps}
            placeholder={view === "cg" ? t("스토리 이름 검색") : view === "sprite" ? t("인물 이름 검색") : t("오퍼레이터 이름 검색")} />
          <button type="button" className="search-clear" onClick={() => clear()} aria-label={t("검색어 지우기")}>×</button>
        </div>
        <AttributeFilter groups={groupsFor} />
        {view === "cg" && (
          <label className="gl-spoil-toggle">
            <input type="checkbox" checked={spoil} onChange={toggleSpoil} />
            <span>{t("스포일러 가리기")}{myStages && <em className="gl-spoil-mine">{t("내 진행 기준")}</em>}</span>
            <small>{myStages
              ? t("아직 안 본 스토리의 CG만 흐리게 둡니다 — 내 정보의 작전 진행 기준. 가리키거나 눌러야 보입니다.")
              : t("CG를 흐리게 두고, 가리키거나 눌러야 보입니다.")}</small>
          </label>
        )}
      </div>

      <div className="results">
        <div className="results-heading">
          <div><span className="section-no">RESULT / 02</span><h2>{t("갤러리")} · {VIEW_LABEL[view][locale] ?? VIEW_LABEL[view].ko}</h2></div>
          <div className="results-tools"><span className="count"><b>{count}</b> {view === "cg" ? "CG" : view === "sprite" ? "CHARACTERS" : "OPERATORS"}</span></div>
        </div>
        <div className="active-filters">
          {lvLabel() && <button onClick={() => setLv((cur) => cur.slice(0, -1))}>{lvLabel()} ×</button>}
          {rar.map((v) => <button key={v} onClick={() => setRar((cur) => cur.filter((x) => x !== v))}>★{v} ×</button>)}
          {term && <button onClick={() => clear()}>“{term}” ×</button>}
        </div>
        <div className="results-scroll">
          {count === 0 && (
            <div className="empty"><span>NO MATCH</span><h3>{t("조건에 맞는 그림이 없어요.")}</h3></div>
          )}
          {view === "cg" && groups.map((g) => (
            <div key={g.id} className={`gl-group${g.fut ? " fut-dim" : ""}`}>
              <h3><em>{t(CG_KIND_LABEL[g.kind])}</em>{g.n}<small>{g.all.length}</small>
                {g.fut && <span className="gl-fut">{t("미실장")}</span>}</h3>
              {g.secs.map((sec, si) => (
                <div key={sec.k ?? si} className="gl-sec">
                  {sec.k && <h4>{t(SEC_LABEL[sec.k] ?? sec.k)} <small>{sec.pics.length}</small></h4>}
                  <div className={`gl-cg-grid${sec.k === "capsule" || sec.k === "boss" || sec.k === "npc" ? " square" : ""}`}>
                    {sec.pics.map((pic) => (
                      <button key={pic.src} type="button" className={`gl-cg-card${spoil && locked(pic) ? " spoil" : ""}`} title={pic.cap || undefined}
                        onClick={() => setCgOpen({ g, i: g.all.indexOf(pic) })} aria-label={`${g.n} ${pic.cap}`}>
                        <span className="gl-cg">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={pic.src} alt="" loading="lazy" decoding="async" width={320} height={180} />
                        </span>
                        {(pic.cap || pic.tag) && (
                          <span className="gl-cg-cap">{pic.tag && <em>{pic.tag}</em>}{pic.cap}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {view === "sprite" && count > 0 && (
            <div className="gl-char-grid">
              {chars.map((c) => (
                <button key={c.id} type="button" className="gl-char" onClick={() => setCharOpen(c)}>
                  <span className="gl-char-img">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={spriteSrc(c, c.f[0])} alt="" loading="lazy" decoding="async" />
                  </span>
                  <b>{c.n}</b>
                  <small>{imgCount(locale, c.f.length)}</small>
                </button>
              ))}
            </div>
          )}
          {view === "illust" && count > 0 && (
            <div className="gl-op-grid">
              {ops.map((o) => (
                <button key={o.id} type="button" className={`gl-op${o.unreleased ? " fut-dim" : ""}`} onClick={() => setOpOpen(o)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset(`/avatars/${o.id}.webp`)} alt="" loading="lazy" decoding="async" width={96} height={96} />
                  <b>{o.name}</b>
                  <small>★{o.rarity}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {cgOpen && (
        <CgWindow g={cgOpen.g} index={cgOpen.i}
          onStory={(st) => setStoryOpen((cur) => ({ id: st.id, n: st.n, ep: st.ep, line: st.line, k: (cur?.k ?? 0) + 1 }))}
          onStep={(d) => setCgOpen((cur) => (cur ? { g: cur.g, i: (cur.i + d + cur.g.all.length) % cur.g.all.length } : cur))}
          onClose={() => setCgOpen(null)} />
      )}
      {charOpen && (
        <CharWindow key={charOpen.id} c={charOpen} onClose={() => setCharOpen(null)}
          stories={(charOpen.s ?? []).map((i) => storyList[i]).filter(Boolean).map((e) => ({ id: e.id, n: e.n, href: storyHrefOf(e.id) }))}
          onStory={(id, n) => {
            if (onOpenEvent && EVENT_IDS.has(id)) onOpenEvent(id);
            else setStoryOpen((cur) => ({ id, n, k: (cur?.k ?? 0) + 1 }));
          }}
          opHref={charOpen.op && opById.has(charOpen.op) ? opHrefOf(charOpen.op) : undefined}
          onOp={charOpen.op && onShowOperator ? () => onShowOperator(charOpen.op!) : undefined} />
      )}
      {storyOpen && (
        <ModalWindow key={`sy-${storyOpen.k}`} label={storyOpen.n} className="operator-modal sy-modal" onClose={closeStory}>
          <Suspense fallback={<p className="no-detail">{t("불러오는 중…")}</p>}>
            <StoryModal id={storyOpen.id} name={storyOpen.n} onClose={closeStory} onShowOperator={onShowOperator}
              {...(storyOpen.ep ? { view: "scene" as const, ep: storyOpen.ep - 1, line: storyOpen.line } : {})} />
          </Suspense>
        </ModalWindow>
      )}
      {opOpen && <IllustWindow key={opOpen.id} op={opOpen} opHref={opHrefOf(opOpen.id)}
        onOp={onShowOperator ? () => onShowOperator(opOpen.id) : undefined} onClose={() => setOpOpen(null)} />}
    </section>
  );
}

/** 큰 그림 — 받는 동안 '불러오는 중…', 실패하면 안내 (사용자 요청 2026-10-04). 그림이 바뀌면 key 로 다시 마운트돼
 *  상태가 처음부터 시작한다. 이미 캐시에 있으면 onLoad 가 곧바로 와서 표시가 거의 안 보인다. */
function ViewImg({ src, alt, onClick }: { src: string; alt: string; onClick?: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<"load" | "ok" | "err">("load");
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} onClick={onClick} className={state === "ok" ? undefined : "gl-img-wait"}
        onLoad={() => setState("ok")} onError={() => setState("err")} />
      {state !== "ok" && (
        <span className="gl-loading" role="status">
          {state === "load" ? <><i aria-hidden />{t("불러오는 중…")}</> : t("이미지를 불러오지 못했습니다.")}
        </span>
      )}
    </>
  );
}

/** 좌우 화살표로 넘긴다 — 입력란에 초점이 있으면 건드리지 않는다 */
function useArrows(onStep: (d: number) => void) {
  useEffect(() => {
    const on = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (typeof el?.closest === "function" && el.closest("input, textarea")) return;
      if (event.key === "ArrowLeft") onStep(-1);
      else if (event.key === "ArrowRight") onStep(1);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onStep]);
}

function CgWindow({ g, index, onStep, onStory, onClose }: {
  g: CgGroup; index: number; onStep: (d: number) => void; onClose: () => void;
  /** 이야기 CG — 스토리 모달을 그 화·그 CG 가 뜨는 줄의 리더기로 (사용자 요청 2026-10-04) */
  onStory?: (st: NonNullable<Pic["story"]>) => void;
}) {
  const { t } = useI18n();
  const pic = g.all[index];
  useArrows(onStep);
  const [zoom, setZoom] = useState(false);
  const alt = `${g.n} ${pic.cap || index + 1}`;
  return (
    <ModalWindow label={g.n} className="operator-modal gl-modal" onClose={onClose}>
      <div className="gl-view">
        <ViewImg key={pic.src} src={pic.src} alt={alt} onClick={() => setZoom(true)} />
        {g.all.length > 1 && <>
          <button type="button" className="gl-nav prev" onClick={() => onStep(-1)} aria-label={t("이전")}>‹</button>
          <button type="button" className="gl-nav next" onClick={() => onStep(1)} aria-label={t("다음")}>›</button>
        </>}
      </div>
      <div className="gl-caption">
        <span><b>{g.n}</b>{pic.tag && <> · {pic.tag}</>} · {index + 1} / {g.all.length}</span>
        <a href={pic.href} onClick={(event) => {
          if (pic.story && onStory && plainClick(event)) { event.preventDefault(); onStory(pic.story); }
        }}>{t(pic.go)} →</a>
      </div>
      {pic.cap && <p className="gl-cg-line">{pic.cap}</p>}
      {zoom && <ZoomWindow src={pic.src} alt={alt} onClose={() => setZoom(false)} />}
    </ModalWindow>
  );
}

function CharWindow({ c, stories, opHref, onOp, onStory, onClose }: {
  c: GChar; stories: { id: string; n: string; href: string }[]; opHref?: string; onOp?: () => void;
  onStory?: (id: string, n: string) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [i, setI] = useState(0);
  const step = (d: number) => setI((cur) => (cur + d + c.f.length) % c.f.length);
  useArrows(step);
  const [zoom, setZoom] = useState(false);
  // 고른 썸네일이 줄 밖이면 보이게 끌어온다 (슬라이더·화살표로 넘길 때)
  const pickRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = pickRef.current;
    const btn = box?.querySelectorAll<HTMLElement>(".gl-strip button")[i];
    if (!box || !btn) return;
    const l = btn.offsetLeft, r = l + btn.offsetWidth;
    if (l < box.scrollLeft) box.scrollLeft = l - 8;
    else if (r > box.scrollLeft + box.clientWidth) box.scrollLeft = r - box.clientWidth + 8;
  }, [i]);
  return (
    <ModalWindow label={c.n} className="operator-modal gl-modal gl-fit-tall" onClose={onClose}>
      <div className="gl-view sprite">
        <ViewImg key={c.f[i]} src={spriteSrc(c, c.f[i])} alt={c.n} onClick={() => setZoom(true)} />
        {c.f.length > 1 && <>
          <button type="button" className="gl-nav prev" onClick={() => step(-1)} aria-label={t("이전")}>‹</button>
          <button type="button" className="gl-nav next" onClick={() => step(1)} aria-label={t("다음")}>›</button>
        </>}
      </div>
      <div className="gl-caption">
        <span><b>{c.n}</b> · {i + 1} / {c.f.length}</span>
        {opHref && <a href={opHref} onClick={(event) => { if (onOp && plainClick(event)) { event.preventDefault(); onOp(); } }}>{t("오퍼 도감에서 보기")} →</a>}
      </div>
      {/* 나오는 스토리 — 누르면 그 스토리 페이지로 (사용자 요청 2026-10-04) */}
      {stories.length > 0 && (
        <div className="gl-links">
          <b>{t("등장 스토리")}</b>
          {stories.map((st) => (
            <a key={st.href} href={st.href}
              onClick={(event) => { if (onStory && plainClick(event)) { event.preventDefault(); onStory(st.id, st.n); } }}>{st.n}</a>
          ))}
        </div>
      )}
      {/* 표정 고르기 — 썸네일 줄과 슬라이더가 **한 덩어리로** 옆으로 스크롤된다. 슬라이더 길이는 줄 전체 폭이고
          손잡이 중심이 각 썸네일 가운데에 온다(CSS .gl-pick) — 끌면 그 아래 그림으로 곧바로 바뀐다 (사용자 요청 2026-10-04). */}
      <div className="gl-pick" ref={pickRef}>
        <div className="gl-pick-inner">
          <div className="gl-strip">
            {c.f.map((tail, k) => (
              <button key={tail} type="button" className={k === i ? "selected" : ""} onClick={() => setI(k)} aria-label={`${k + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={spriteSrc(c, tail)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
          {c.f.length > 1 && (
            <input type="range" className="gl-slider" min={0} max={c.f.length - 1} step={1} value={i}
              style={{ ["--pct" as string]: `${(i / (c.f.length - 1)) * 100}%` }}
              onChange={(event) => setI(Number(event.currentTarget.value))} aria-label={t("표정")} />
          )}
        </div>
      </div>
      {zoom && <ZoomWindow src={spriteSrc(c, c.f[i])} alt={c.n} onClose={() => setZoom(false)} />}
    </ModalWindow>
  );
}

/** 큰 그림을 누르면 뜨는 확대 창 — 원본 크기로, 넘치면 창 안에서 스크롤 (사용자 요청 2026-10-04) */
function ZoomWindow({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <ModalWindow label={alt} className="operator-modal gl-modal gl-zoom" onClose={onClose}>
      <div className="gl-zoom-body">
        <ViewImg src={src} alt={alt} />
      </div>
    </ModalWindow>
  );
}

const skinCache = new Map<string, SkinEntry[] | null>();

function IllustWindow({ op, opHref, onOp, onClose }: { op: GalleryOp; opHref: string; onOp?: () => void; onClose: () => void }) {
  const { locale, t } = useI18n();
  const key = `${locale}/${op.id}`;
  const [skins, setSkins] = useState<SkinEntry[] | null | undefined>(() => skinCache.get(key));
  const [i, setI] = useState(0);
  useEffect(() => {
    if (skinCache.has(key)) return;          // 초기값으로 이미 들어 있다 (오퍼마다 key 로 다시 마운트)
    let alive = true;
    fetch(asset(`/skins/${locale}/${op.id}.json`))
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data: { skins?: SkinEntry[] } | null) => {
        const list = (data?.skins ?? []).filter((s) => s.portrait);
        skinCache.set(key, list.length ? list : null);
        if (alive) setSkins(list.length ? list : null);
      });
    return () => { alive = false; };
  }, [key, locale, op.id]);
  const n = skins?.length ?? 0;
  const step = (d: number) => { if (n) setI((cur) => (cur + d + n) % n); };
  useArrows(step);
  const cur = skins?.[i];
  const [zoom, setZoom] = useState(false);
  const fullSrc = (sk: SkinEntry) => asset(`/skin/full/${encodeURIComponent(sk.portrait)}.webp`);
  const label = (s: SkinEntry) => (s.default ? (s.stage ?? s.name) : s.name);
  return (
    <ModalWindow label={op.name} className="operator-modal gl-modal gl-fit-sq" onClose={onClose}>
      {skins === undefined && <p className="no-detail">{t("불러오는 중…")}</p>}
      {skins === null && <p className="no-detail">{t("일러스트가 아직 없습니다.")}</p>}
      {cur && <>
        <div className="gl-view illust">
          <ViewImg key={cur.portrait} src={fullSrc(cur)} alt={`${op.name} ${label(cur)}`} onClick={() => setZoom(true)} />
          {n > 1 && <>
            <button type="button" className="gl-nav prev" onClick={() => step(-1)} aria-label={t("이전")}>‹</button>
            <button type="button" className="gl-nav next" onClick={() => step(1)} aria-label={t("다음")}>›</button>
          </>}
        </div>
        <div className="gl-caption">
          <span><b>{label(cur)}</b>{cur.artists.length > 0 && <> · {cur.artists.join(" · ")}</>}</span>
          <span>{i + 1} / {n} · <a href={opHref} onClick={(event) => { if (onOp && plainClick(event)) { event.preventDefault(); onOp(); } }}>{t("오퍼 도감에서 보기")} →</a></span>
        </div>
        <div className="gl-strip illust">
          {skins!.map((s, k) => (
            <button key={s.id} type="button" className={k === i ? "selected" : ""} onClick={() => setI(k)} title={label(s)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset(`/skin/portrait/${encodeURIComponent(s.portrait)}.webp`)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
        {zoom && <ZoomWindow src={fullSrc(cur)} alt={`${op.name} ${label(cur)}`} onClose={() => setZoom(false)} />}
      </>}
    </ModalWindow>
  );
}
