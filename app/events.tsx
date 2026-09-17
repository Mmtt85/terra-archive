"use client";

// 이벤트 도감 (/events) — 이벤트 하나에 딸린 것을 한자리에 모은다.
//
// ## 왜 (사용자 요청 2026-09-16)
//
// "해당 이벤트에서 등장하는 적, 맵, 아이템, 신규오퍼 한번에 모아서 볼 수 있도록."
// 지금은 같은 이벤트의 정보가 네 화면에 흩어져 있다 — 작전은 작전 도감, 적은 적 도감,
// 재화는 아이템 도감, 읽을거리는 스토리. 게임에서는 이벤트가 끝나면 통째로 사라진다.
//
// 자리는 **가이드 묶음**이다 (사용자 확정 2026-09-16: "가이드에 이벤트를 넣어야 할듯").
// 통합전략·생존연산·위수 협의와 같은 결 — "이 콘텐츠를 보러 간다"는 메뉴다.
//
// 데이터(로케일당 ~240KB)는 이벤트 단위로 **미리 접어 둔 것**이다 (scripts/build-events.py).
// 화면에서 조인하면 stages 1.4MB + items 0.65MB 를 통째로 받아야 하는데, 실제로 쓰는 건
// 이벤트당 작전 20여 개·적 15종·재화 2종뿐이다.
//
// ⚠ 개별 라우트(/events/<id>)를 만들지 않는다 — 항목 1개당 6파일(html+rsc × 3언어)이고
//   Pages 파일 수 한도가 있다 (아이템 도감과 같은 판단). 상세는 모달 + `#ev-<id>` 딥링크.

import { lazy, Suspense, useMemo, useState } from "react";
import { asset } from "./assets";
import { useI18n } from "./i18n";
import { normSearch, useSearchInput } from "./search";
import { useLazyVisible } from "./lazy-img";
import { ModalWindow } from "./modal-window";
import { useHashSync } from "./hash-modal";
import { AttributeFilter } from "./attr-filter";
import { SearchSuggest } from "./search-suggest";
import { loadEnemies, loadEnemyStages, loadEnemyStats, loadItems, loadStages } from "./dex-cross";
import { EnemyFile, enemyImg, type Enemy, type EnemyStages } from "./enemy-detail";
import { StageFile } from "./stage-detail";
import { viewOf, type StageView } from "./stage-data";
import { ItemFile, itemIcon, type DexItem, type ItemDoc } from "./items";
// 스토리 상세를 **모달로** 겹쳐 띄운다 (사용자 요청 2026-09-17). 스토리 모듈과 요약 본문
// (1.8MB)은 누를 때 처음 받는다 — 정적 임포트면 이벤트 도감 청크에 통째로 딸려 온다.
const StoryModal = lazy(() => import("./story").then((m) => ({ default: m.StoryDetailById })));

/** 작전 [id, 코드, 이름] · 적 [id, 이름] · 재화 [id, 이름, 아이콘?] · 오퍼 [id, 이름, 성급, 종류] */
export type EventRow = {
  id: string;
  n: string;
  type?: string | null;
  start?: string | null;
  end?: string | null;
  story?: number;
  thumb?: string;
  stages?: [string, string, string][];
  enemies?: [string, string][];
  items?: ([string, string] | [string, string, string])[];
  /** 맵에서 파밍되는 상위 재료 [id, 이름, 아이콘, 등급, 작전 코드들] — T3 이상 */
  mats?: [string, string, string, number, string[]][];
  /** [id, 이름, 성급, 종류] — reward=이벤트 보상(무료 배포) · new=이 이벤트와 함께 데뷔 */
  ops?: [string, string, number, "reward" | "new"][];
  /** 사이트에 전용 가이드가 있는 모드 — 카드를 누르면 모달 대신 그리로 간다 */
  guide?: string;
  /** 중섭 선행(미실장) — 흑백 처리되고 미래시 토글이 꺼져 있으면 눌리지 않는다 */
  fut?: number;
  /** 스토리 페이지 id — 복각판은 원본 이벤트의 것이다 (없으면 자기 id) */
  sid?: string;
  /** 복각판이면 원본 이벤트 id */
  origin?: string;
  /** 원본이면 복각(재개방) 이벤트 id */
  rerun?: string;
  /** 한섭 개방 추정월 ("2026-11") — 미실장에만 */
  eta?: string;
};
export type EventDoc = { updated: string; events: EventRow[] };

// 게임이 붙인 종류 — 표시명은 사전으로 옮긴다 (데이터 문자열을 그대로 내보내지 않는다)
const TYPE_LABEL: Record<string, string> = {
  SIDESTORY: "사이드 스토리",
  MINISTORY: "미니 이벤트",
  BRANCHLINE: "막간 이야기",
  NONE: "기타",
};
const typeOf = (row: EventRow) => (row.type && TYPE_LABEL[row.type] ? row.type : "NONE");

// '수록 내용' 필터 — 이벤트에 무엇이 들었는지로 거른다
const HAS = ["stages", "enemies", "items", "mats", "ops", "story", "fut"] as const;
const HAS_LABEL: Record<string, string> = {
  stages: "작전", enemies: "등장 적", items: "교환 재화", mats: "상위 재료",
  ops: "이벤트 오퍼", story: "스토리", fut: "미실장",
};
const hasThing = (row: EventRow, key: string) =>
  key === "story" ? !!row.story
    : key === "fut" ? !!row.fut
      : ((row[key as "stages"] as unknown[] | undefined)?.length ?? 0) > 0;

const OP_KIND: Record<string, string> = { reward: "보상", new: "신규" };

const localeBase = (locale: string) => (locale === "ko" ? "" : `/${locale}`);
// app/story.tsx 의 storyPath 와 같은 규칙 — 거기서 가져오면 요약·리더기 모듈이 딸려 온다
const storyHref = (locale: string, id: string) => `${localeBase(locale)}/stories/${id}`;

function EventCard({ row, onSelect, onGuide }: {
  row: EventRow; onSelect: (r: EventRow) => void; onGuide: (seg: string) => void;
}) {
  const { locale, t } = useI18n();
  const Tag = (row.guide ? "a" : "button") as "a";
  const href = row.guide ? `${localeBase(locale)}/${row.guide}` : undefined;
  const [ref, visible] = useLazyVisible<HTMLSpanElement>();
  const counts = [
    row.stages?.length ? t("작전 {n}", { n: row.stages.length }) : null,
    row.enemies?.length ? t("적 {n}", { n: row.enemies.length }) : null,
    row.items?.length ? t("재화 {n}", { n: row.items.length }) : null,
    row.mats?.length ? t("상위 재료 {n}", { n: row.mats.length }) : null,
  ].filter(Boolean);
  return (
    // ⚠ 썸네일 칸은 **항상 그린다.** 없다고 빼면 카드마다 폭이 달라져 줄이 어긋난다
    //   (사용자 지시 2026-09-17: "섬네일 없으면 NO IMAGE를 띄우든 빈 공간을 하든 레이아웃이
    //   무너지지 않게"). 그림이 없거나 받다 실패하면 자리표시 글자를 남긴다.
    // 전용 가이드가 있는 모드(위수 협의)는 **앵커**다 — 새 탭·주소 복사가 그대로 되고,
    // 누르면 그 가이드로 간다 (사용자 지시 2026-09-16).
    // 미실장(중섭 선행)은 `.fut-dim` 만 붙이면 된다 — 흑백 처리도, 미래시가 꺼져 있을 때
    // 클릭을 삼키는 것도 app/future-tip.tsx 의 위임 리스너가 클래스만 보고 알아서 한다.
    <Tag type={row.guide ? undefined : "button"} {...(row.guide ? { href } : {})}
      className={`ev-card${row.fut ? " fut-dim" : ""}`}
      onClick={(e: React.MouseEvent) => {
        if (!row.guide) { onSelect(row); return; }
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault(); onGuide(row.guide);
      }}>
      <span className="ev-card-face" ref={ref} data-noimg={t("이미지 없음")}>
        {visible && row.thumb && (
          <img src={asset(row.thumb)} alt="" aria-hidden loading="lazy" decoding="async"
            onError={(e) => { e.currentTarget.remove(); }} />
        )}
      </span>
      <span className="ev-card-body">
        <b className="ev-card-name">{row.n}</b>
        <span className="ev-card-meta">
          <em className={`ev-type t-${typeOf(row).toLowerCase()}`}>{t(TYPE_LABEL[typeOf(row)])}</em>
          {row.fut
            ? <span className="ev-eta">{row.eta ? t("{ym} 예정", { ym: row.eta.replace("-", ".") }) : t("미실장")}</span>
            : row.start && <span>{row.start}</span>}
        </span>
        {counts.length > 0 && <span className="ev-card-counts">{counts.join(" · ")}</span>}
        {row.ops && row.ops.length > 0 && (
          <span className="ev-card-ops">
            {row.ops.map(([id, name, rarity, how]) => (
              <span key={id} className={`ev-op-chip k-${how}`} data-rarity={rarity}>
                <img src={asset(`/avatars/${id}.webp`)} alt="" aria-hidden width={28} height={28}
                  loading="lazy" decoding="async" />
                {name}
              </span>
            ))}
          </span>
        )}
      </span>
    </Tag>
  );
}

/** 이벤트 상세 — 작전·등장 적·교환 재화·보상 오퍼를 한 화면에. 누르면 각 도감이 겹쳐 뜬다. */
function EventFile({ row, onOpenStage, onOpenEnemy, onOpenItem, onShowOperator, onOpenStory, onOpenOrigin }: {
  row: EventRow;
  onOpenStage: (id: string) => void;
  onOpenEnemy: (id: string) => void;
  onOpenItem: (id: string) => void;
  onShowOperator: (id: string) => void;
  onOpenStory: (id: string) => void;
  onOpenOrigin: (id: string) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <>
      <header>
        <div>
          <h3>
            {row.n}
            {/* 스토리 읽기는 이름 바로 옆에 (사용자 지시 2026-09-17).
                정본 주소는 앵커에 그대로 둬서 새 탭·주소 복사·크롤러가 살아 있고,
                좌클릭일 때만 모달로 겹친다. */}
            {row.story ? (
              <a className="it-link ev-story-link" href={storyHref(locale, row.sid ?? row.id)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault(); onOpenStory(row.sid ?? row.id);
                }}>{t(row.sid ? "원본 이벤트 스토리 읽기" : "이 이벤트 스토리 읽기")}</a>
            ) : null}
            {/* 원본 ↔ 복각을 서로 이어 준다 (사용자 지시 2026-09-17) */}
            {row.origin ? (
              <button type="button" className="it-link ev-story-link"
                onClick={() => onOpenOrigin(row.origin as string)}>{t("원본 이벤트 보기")}</button>
            ) : null}
            {row.rerun ? (
              <button type="button" className="it-link ev-story-link"
                onClick={() => onOpenOrigin(row.rerun as string)}>{t("재개방 이벤트 보기")}</button>
            ) : null}
          </h3>
          <em className={`ev-type t-${typeOf(row).toLowerCase()}`}>{t(TYPE_LABEL[typeOf(row)])}</em>
          {row.fut
            ? <span className="ev-period">{row.eta ? t("한국 서버 {ym} 예정", { ym: row.eta.replace("-", ".") }) : t("미실장")}</span>
            : row.start && <span className="ev-period">{row.start}{row.end ? ` ~ ${row.end}` : ""}</span>}
        </div>
      </header>
      {/* 썸네일은 왼쪽, 스토리 읽기·이벤트 오퍼·작전은 오른쪽 — 한눈에 들어오게
          (사용자 요청 2026-09-17). 좁은 화면에서는 CSS가 한 줄로 되돌린다. */}
      {/* ⚠ 썸네일이 없다고 한 칸으로 바꾸지 않는다 — 자리표시가 모달 폭을 다 먹어
          다른 이벤트와 모양이 달라진다 (사용자 지적 2026-09-17). 칸 수는 늘 둘이다. */}
      <div className="ev-top">
        <div className="ev-top-side">
          {/* 상세도 카드와 같다 — 그림이 없으면 자리만 남기고 글자를 띄운다
              (사용자 지시 2026-09-17). 빼 버리면 두 칸 배치가 한 칸으로 무너진다. */}
          <div className="ev-hero" data-noimg={t("이미지 없음")}>
            {row.thumb && (
              <img src={asset(row.thumb)} alt="" aria-hidden loading="lazy" decoding="async"
                onError={(e) => { e.currentTarget.remove(); }} />
            )}
          </div>
          {/* 교환 재화는 썸네일 바로 밑 (사용자 지시 2026-09-17) — 이벤트당 한두 개뿐이라
              오른쪽 칸을 비집고 들어갈 이유가 없다. */}
          {row.items && row.items.length > 0 && (
            <section className="ev-sec ev-sec-side">
              <b>{t("교환 재화")}</b>
              <div className="ev-items">
                {row.items.map((it) => (
                  <button key={it[0]} type="button" className="ev-item" onClick={() => onOpenItem(it[0])}>
                    {it[2] && <img src={itemIcon(it[2])} alt="" aria-hidden width={40} height={40}
                      loading="lazy" decoding="async" />}
                    <span>{it[1]}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="ev-top-main">
      {/* 이벤트 오퍼레이터 ↔ 맵에서 나오는 상위 재료를 나란히 (사용자 요청 2026-09-17).
          한쪽만 있으면 그쪽이 폭을 다 쓴다. */}
      <div className="ev-pair">
      {row.ops && row.ops.length > 0 && (
        <section className="ev-sec">
          <b>{t("이벤트 오퍼레이터")}</b>
          {/* 보상(무료 배포)과 신규 데뷔를 구분해 적는다 — 성격이 다르다.
              신규는 게임 데이터가 이벤트와 묶어 주지 않아 데뷔 장부로 붙인 것이라,
              사이트 개설(2026-07) 이전 이벤트에는 보상 오퍼만 있다. */}
          <div className="ev-ops">
            {row.ops.map(([id, name, rarity, how]) => (
              <button key={id} type="button" className={`ev-op k-${how}`} data-rarity={rarity}
                onClick={() => onShowOperator(id)}>
                <img src={asset(`/avatars/${id}.webp`)} alt="" aria-hidden width={56} height={56}
                  loading="lazy" decoding="async" />
                <span>{name}</span>
                <i>{"★".repeat(rarity)}</i>
                <em>{t(OP_KIND[how] ?? how)}</em>
              </button>
            ))}
          </div>
        </section>
      )}

      {row.mats && row.mats.length > 0 && (
        <section className="ev-sec">
          <b>{t("맵에서 나오는 상위 재료")}</b>
          <div className="ev-mats">
            {row.mats.map(([id, name, icon, rarity, codes]) => (
              <button key={id} type="button" className="ev-mat" onClick={() => onOpenItem(id)}>
                {icon && <img src={itemIcon(icon)} alt="" aria-hidden width={36} height={36}
                  loading="lazy" decoding="async" />}
                <span>
                  <b>{name}<em className={`farm-tier tier-${rarity}`}>T{rarity}</em></b>
                  <i>{codes.join(" · ")}</i>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      </div>

      {row.stages && row.stages.length > 0 && (
        <section className="ev-sec">
          <b>{t("작전 {n}", { n: row.stages.length })}</b>
          <div className="ev-stages">
            {row.stages.map(([id, code, name]) => (
              <button key={id} type="button" className="ev-stage" onClick={() => onOpenStage(id)}>
                <b>{code}</b><span>{name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
        </div>
      </div>

      {row.enemies && row.enemies.length > 0 && (
        <section className="ev-sec">
          <b>{t("등장 적 {n}", { n: row.enemies.length })}</b>
          <div className="ev-enemies">
            {row.enemies.map(([id, name]) => (
              <button key={id} type="button" className="ev-enemy" onClick={() => onOpenEnemy(id)}>
                <img src={enemyImg(id)} alt="" aria-hidden width={44} height={44}
                  loading="lazy" decoding="async"
                  onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                <span>{name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export default function EventDex({ doc, onShowOperator, onOpenGuide, modalOnly, initialId, onCloseModal }: {
  doc: EventDoc; onShowOperator: (id: string) => void;
  /** 전용 가이드가 있는 모드로 탭을 넘긴다 (위수 협의 등) */
  onOpenGuide: (seg: string) => void;
  /** 목록 없이 **모달만** 그린다 — 헤더 이벤트 버튼이 페이지를 안 넘기고 그 자리에 띄울 때
   *  (사용자 지시 2026-09-17: "이벤트 가이드로 페이지가 넘어가지 말고 그냥 모달창만").
   *  작전·적·아이템·스토리 겹침 모달 배선을 그대로 재사용하려고 같은 컴포넌트를 쓴다. */
  modalOnly?: boolean;
  /** modalOnly 일 때 열 이벤트 id — ⚠ 호스트가 **key 로도 써서** 다른 이벤트를 누르면
   *  이 컴포넌트가 새로 마운트된다. 그래서 여기선 초기값으로만 읽고 동기화 effect 를 두지 않는다. */
  initialId?: string | null;
  /** modalOnly 일 때 주 모달이 닫혔음을 알린다 (호스트가 자기 상태를 지운다) */
  onCloseModal?: () => void;
}) {
  const { locale, t } = useI18n();
  const { term, clear, inputProps } = useSearchInput();
  const [types, setTypes] = useState<string[]>([]);
  const [has, setHas] = useState<string[]>([]);
  const [open, setOpen] = useState<EventRow | null>(
    () => (modalOnly && initialId ? doc.events.find((e) => e.id === initialId) ?? null : null));
  // 겹쳐 뜨는 부가 모달 — 이벤트 모달을 그대로 둔 채 위에 하나 더 (적 도감과 같은 규약).
  // ⚠ 해시 동기화는 하지 않는다 (주 모달 #ev-<id>와 서로 덮어써 창이 닫힌다).
  const [subStage, setSubStage] = useState<StageView | null>(null);
  const [subEnemy, setSubEnemy] = useState<Enemy | null>(null);
  // ⚠ 적 도감 **전체 맵**을 들고 있어야 '연계 소환'에 이름을 찍을 수 있다. 안 그러면
  //   `enemy_1588_ubbphw` 같은 id가 그대로 보인다 (사용자 제보 2026-09-17 "파블로비치,
  //   추밀관"). 어차피 적을 여는 순간 받는 맵이라 새로 받는 값이 아니다.
  const [enMap, setEnMap] = useState<Map<string, Enemy> | null>(null);
  // 등장 작전 역색인 — 적 모달의 '등장 작전' 절. 없으면 그 절이 통째로 안 그려진다
  // (사용자 지시 2026-09-17 "등장 작전도 다른 모달에서 다 보이게 해줘").
  const [enStages, setEnStages] = useState<EnemyStages | null>(null);
  const [subItem, setSubItem] = useState<DexItem | null>(null);
  const [itemDoc, setItemDoc] = useState<ItemDoc | null>(null);
  const [subStory, setSubStory] = useState<string | null>(null);
  const [raise, setRaise] = useState(0);

  const events = doc.events;
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  const openStage = (sid: string) => {
    setRaise((k) => k + 1);
    void Promise.all([loadStages(locale), loadEnemyStats()]).then(([d, stats]) => {
      const st = d.stages.find((x) => x.id === sid);
      setSubStage(st ? viewOf(d, st, stats) : null);
    });
  };
  const openEnemy = (eid: string) => {
    setRaise((k) => k + 1);
    void loadEnemies(locale).then((m) => { setEnMap(m); setSubEnemy(m.get(eid) ?? null); });
    void loadEnemyStages(locale).then(setEnStages);
  };
  // 재화는 **모달로 겹쳐** 띄운다 (사용자 지시 2026-09-16: "페이지 이동이 아니라 모달창").
  // 아이템 도감 문서(로케일당 ~650KB)는 여기서 처음 필요해지므로 그때 받는다.
  const openItem = (iid: string) => {
    setRaise((k) => k + 1);
    void loadItems<ItemDoc>(locale).then((d) => {
      setItemDoc(d);
      setSubItem(d.items.find((x) => x.id === iid) ?? null);
    });
  };

  // ⚠ 스토리 모달이 떠 있는 동안은 **해시를 비켜 준다.** 스토리 상세는 자기 보기 방식을
  //   해시(#story-<id>/ep3 등)에 쓰는데, 여기가 계속 #ev-<id>로 되돌리면 둘이 서로를
  //   덮어써 창이 닫힌다 (이 화면의 다른 겹침 모달들이 해시를 안 쓰는 것과 같은 이유).
  // ⚠ modalOnly 는 해시를 건드리지 않는다 — 호스트 페이지(홈·도감 등)가 자기 해시를 쓰고
  //   있어서, 여기서 #ev-<id>로 덮으면 그 화면의 해시 기계와 서로를 지운다.
  useHashSync(modalOnly || subStory ? null : (open ? `#ev-${open.id}` : null), (hash) => {
    if (modalOnly || subStory) return;
    const m = /^#ev-(.+)$/.exec(hash);
    setOpen(m ? byId.get(m[1]) ?? null : null);
  });

  const typeOpts = useMemo(
    () => [...new Set(events.map(typeOf))].sort((a, b) => a.localeCompare(b)), [events]);

  const shown = useMemo(() => {
    const q = normSearch(term);
    return events.filter((e) => {
      if (types.length && !types.includes(typeOf(e))) return false;
      if (has.length && !has.every((k) => hasThing(e, k))) return false;
      if (!q) return true;
      const ops = (e.ops ?? []).map((o) => o[1]).join(" ");
      const items = (e.items ?? []).map((i) => i[1]).join(" ");
      return normSearch(`${e.n} ${ops} ${items}`).includes(q);
    });
  }, [events, term, types, has]);

  // 미래시는 위쪽 스트립, 나머지는 본 목록 (오퍼 도감과 같은 규약)
  const futureRows = useMemo(() => shown.filter((e) => e.fut), [shown]);
  const mainRows = useMemo(() => shown.filter((e) => !e.fut), [shown]);

  const countBy = useMemo(() => {
    const ty = new Map<string, number>(), hs = new Map<string, number>();
    for (const e of events) {
      ty.set(typeOf(e), (ty.get(typeOf(e)) ?? 0) + 1);
      for (const k of HAS) if (hasThing(e, k)) hs.set(k, (hs.get(k) ?? 0) + 1);
    }
    return { ty, hs };
  }, [events]);

  const toggle = (set: (fn: (cur: string[]) => string[]) => void) => (v: string) =>
    set((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  const reset = () => { setTypes([]); setHas([]); clear(false); };
  const active = types.length + has.length > 0 || !!term;

  const modals = (
    <>
      {open && (
        <ModalWindow label={open.n} className="operator-modal ev-modal"
          onClose={() => { setOpen(null); onCloseModal?.(); }}>
          <EventFile row={open} onOpenStage={openStage} onOpenEnemy={openEnemy}
            onOpenItem={openItem} onShowOperator={onShowOperator}
            onOpenStory={(id) => { setRaise((k) => k + 1); setSubStory(id); }}
            onOpenOrigin={(id) => { const e = byId.get(id); if (e) setOpen(e); }} />
        </ModalWindow>
      )}
      {subStage && (
        <ModalWindow key={`st-${raise}`} label={`${subStage.stage.code} ${subStage.stage.name}`}
          className="operator-modal st-modal" onClose={() => setSubStage(null)}>
          {/* ⚠ onOpenItem 을 빠뜨리면 드랍 칩이 disabled 로 죽는다 — 작전 도감(app/stages.tsx)은
              넘기고 있는데 여기만 빠져 있었다 (사용자 제보 2026-09-17). */}
          <StageFile view={subStage} onOpenEnemy={openEnemy} onOpenItem={openItem} />
        </ModalWindow>
      )}
      {subEnemy && (
        <ModalWindow key={`en-${raise}`} label={subEnemy.name} className="operator-modal en-modal"
          onClose={() => setSubEnemy(null)}>
          {/* ⚠ nameOf·onOpenEnemy 를 빠뜨리면 '연계 소환'이 id를 날것으로 찍고, 눌렀을 때
              모달이 아니라 적 상세 **페이지로 튕겨 나간다** (사용자 제보 2026-09-17).
              */}
          <EnemyFile enemy={subEnemy} stagesDoc={enStages}
            nameOf={(id) => enMap?.get(id)?.name}
            onOpenEnemy={openEnemy} onOpenStage={openStage} />
        </ModalWindow>
      )}
      {subStory && (
        <ModalWindow key={`sy-${raise}`} label={byId.get(subStory)?.n ?? ""}
          className="operator-modal sy-modal" onClose={() => setSubStory(null)}>
          <Suspense fallback={<p className="no-detail">{t("불러오는 중…")}</p>}>
            <StoryModal id={subStory} onClose={() => setSubStory(null)} onShowOperator={onShowOperator} />
          </Suspense>
        </ModalWindow>
      )}
      {subItem && itemDoc && (
        <ModalWindow key={`it-${raise}`} label={subItem.n} className="item-modal it-modal"
          onClose={() => setSubItem(null)}>
          <ItemFile item={subItem} doc={itemDoc} onOpenStage={openStage} />
        </ModalWindow>
      )}
    </>
  );

  // 모달만 그리는 모드 — 목록·필터 DOM 없이 겹침 모달 배선만 재사용한다
  if (modalOnly) return modals;

  return (
    <section className="explorer ev-explorer" aria-labelledby="event-title">
      <div className="filter-panel">
        <div className="panel-heading">
          <div><span className="section-no">FILTER / 01</span><h2 id="event-title">{t("탐색 조건")}</h2></div>
          <button className="reset" onClick={reset}>↻ {t("초기화")}</button>
        </div>
        <AttributeFilter groups={[
          { title: t("종류"), items: typeOpts, selected: types, onToggle: toggle(setTypes),
            labelFor: (v) => t(TYPE_LABEL[v] ?? v), countForItem: (v) => countBy.ty.get(v) ?? 0 },
          { title: t("수록 내용"), items: [...HAS], selected: has, onToggle: toggle(setHas),
            labelFor: (v) => t(HAS_LABEL[v] ?? v), countForItem: (v) => countBy.hs.get(v) ?? 0 },
        ]} />
      </div>

      <div className="results">
        <div className="results-heading">
          <div><span className="section-no">RESULT / 02</span><h2>{active ? t("탐색 결과") : t("전체 이벤트")}</h2></div>
          <div className="search-wrap heading-search">
            <span>⌕</span>
            <input id="event-search" {...inputProps} placeholder={t("이벤트, 재화, 오퍼 검색")} />
            <button type="button" className="search-clear" onClick={() => clear()} aria-label={t("검색어 지우기")}>×</button>
            <SearchSuggest query={term}
              items={shown.map((e) => ({ key: e.id, label: e.n, sub: e.start ?? undefined, img: e.thumb ? asset(e.thumb) : undefined }))}
              onPick={(id) => { const e = byId.get(id); if (e) setOpen(e); }} />
          </div>
          <div className="results-tools"><span className="count"><b>{shown.length}</b> EVENTS</span></div>
        </div>
        <div className="active-filters">
          {types.map((v) => <button key={`t-${v}`} onClick={() => toggle(setTypes)(v)}>{t(TYPE_LABEL[v] ?? v)} ×</button>)}
          {has.map((v) => <button key={`h-${v}`} onClick={() => toggle(setHas)(v)}>{t(HAS_LABEL[v] ?? v)} ×</button>)}
          {term && <button onClick={() => clear()}>“{term}” ×</button>}
        </div>

        <div className="results-scroll">
          {shown.length > 0 ? (
            <>
              {/* 미래시(중섭 선행) 이벤트는 **위쪽 작은 칸**으로 뺀다 — 오퍼 도감의 미실장
                  스트립과 같은 규약 (사용자 지시 2026-09-17). 한섭 유저가 아직 안 열린
                  이벤트를 훑고 내려가야 하는 걸 막는다. */}
              {futureRows.length > 0 && (
                <section className="future-strip ev-future">
                  <h3>
                    {t("미실장 이벤트 {n}개", { n: futureRows.length })}
                    <small>{t("중국 서버 선행 — 한국 서버엔 아직 없습니다")}</small>
                  </h3>
                  <div className="ev-grid mini">
                    {futureRows.map((e) => <EventCard key={e.id} row={e} onSelect={setOpen} onGuide={onOpenGuide} />)}
                  </div>
                </section>
              )}
              <div className="ev-grid">
                {mainRows.map((e) => <EventCard key={e.id} row={e} onSelect={setOpen} onGuide={onOpenGuide} />)}
              </div>
            </>
          ) : (
            <div className="empty"><span>NO MATCH</span><h3>{t("조건에 맞는 이벤트가 없어요.")}</h3>
              <button onClick={reset}><span className="btn-icon" aria-hidden>↻</span>{t("전체 보기")}</button></div>
          )}
        </div>
      </div>

      {modals}
    </section>
  );
}
