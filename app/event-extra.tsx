"use client";

// 이벤트 창의 추가 탭 — 일정 · 이벤트 미션 · 훈장 · 이벤트 가구 · 신뢰도 보너스 (사용자 요청 2026-10-01
// "이벤트 데이터 전부 다 최대한 보여줄 수 있도록 … 가능한한 이벤트 관련 모든 정보 한번 표시해줘봐" →
// "개요에다가 이벤트 오퍼·맵에서 나오는 상위재료·교환재화 이런류 보여주고 다른 정보들은 다 탭으로").
// 데이터: app/data/event-extra/<로케일>/<이벤트 id>.json (scripts/build-event-extra.py) — 이벤트마다 한 파일(평균 6KB)이라
// import.meta.glob 으로 **그 이벤트 것만** 받는다. 미실장(중섭 선행) 이벤트는 파일이 없어 탭이 안 생긴다.
// 훈장 아이콘(public/event/medal/)·가구 아이콘(public/event/furni/)은 build-event-art.py --extra 가 받는다(R2 폴더).

import { useEffect, useState, type ReactNode } from "react";
import { asset, eventArtUrl } from "./assets";
import { useI18n } from "./i18n";
import { itemIcon } from "./items";
import { ModalWindow } from "./modal-window";

/** 이벤트 창 탭 하나 — 이벤트 창·듀얼 채널·벡터 돌파 상세가 같은 탭 막대에 이어 붙인다 */
export type ExtraTab = { key: string; label: string; node: ReactNode };

/** 보상 하나 — [종류, id, 이름, 개수, 아이콘?] (item 만 아이콘 id 가 있다) */
type Reward = ["item" | "furn" | "char" | "skin", string, string, number, string?];
type Extra = {
  /** 일정 — 시작 s · 종료 e · 교환소 마감 r(종료와 다를 때) · 단계 일정 n [시각, 제목] (KST) ·
   *  cn 1 = 미실장(중섭 선행) 이벤트라 **중국 서버 날짜**다 */
  sched?: { s: string; e: string | null; r?: string; n?: [string, string][]; cn?: 1 };
  /** 이벤트 미션 [목표, 보상들] — 게임 정렬 순 */
  missions?: [string, Reward[]][];
  /** 훈장 — set [세트 이름, 설명] · list [id, 이름, 등급, 획득 조건, 설명, 숨김 1/0] */
  medals?: { set?: [string, string]; list: [string, string, string, string, string, number][] };
  /** 이벤트 가구 — theme [테마 이름, 설명] · list [id, 이름, 등급] */
  /** list: [id, 이름, 희귀도, 분위기, [가로, 깊이, 높이], 상호작용(MUSIC …), 설명문] · sets: 부분 세트 [이름, 가구 수, 분위기 보너스] */
  furn?: { theme?: [string, string]; list: [string, string, number, number?, [number, number, number]?, string?, string?][]; sets?: [string, number, number][] };
  /** 이벤트 기간 신뢰도 보너스 오퍼 [id, 이름] */
  favor?: [string, string][];
  /** 이 이벤트의 스토리 — id · 전문 화 목록 eps [작전 코드, 구분](배열 순서 = 리더기 화 번호) · AI 요약 sum · 리더기 scene */
  story?: EventStory;
};
export type EventStory = { id: string; eps?: [string, string][]; sum?: 1; scene?: 1 };

const FILES = import.meta.glob<{ default: Extra }>("./data/event-extra/*/*.json");

/** dev 는 그림도 R2 에서 받는다 — 아직 안 올린 새 그림(훈장·가구)은 로컬 public/ 으로 한 번 더 시도한다.
 *  운영에선 R2 가 정본이라 그대로 숨긴다 (Pages 빌드엔 public/ 의 R2 폴더가 빠진다). */
function onImgError(local: string) {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (import.meta.env.DEV && local && !img.dataset.local) { img.dataset.local = "1"; img.src = local; return; }
    img.style.visibility = "hidden";
  };
}

type Open = { onOpenItem: (id: string) => void; onShowOperator: (id: string) => void };

/** 이 이벤트의 추가 탭들 + 개요에 얹을 일정. 받는 동안·파일이 없으면 빈 배열·null (탭 막대는 있는 것만 그린다).
 *  일정은 탭이 아니라 **개요에** 둔다 (사용자 지시 2026-10-01 "일정도 개요에 보여줘").
 *  skipMedals — 듀얼 채널·벡터 돌파는 자기 상세에 훈장 탭이 있고, 일정도 자기 개요(기간·진행 단계)에 있다. */
export function useExtraTabs(id: string, open: Open, skipMedals = false): { tabs: ExtraTab[]; schedule: ReactNode; story: EventStory | null } {
  const { locale, t } = useI18n();
  const [got, setGot] = useState<{ key: string; data: Extra } | null>(null);
  const key = `${locale}/${id}`;
  useEffect(() => {
    let live = true;
    const load = FILES[`./data/event-extra/${key}.json`];
    if (!load) return;
    void load().then((m: { default: Extra }) => { if (live) setGot({ key, data: m.default }); }, () => {});
    return () => { live = false; };
  }, [key]);
  const data = got?.key === key ? got.data : null;
  if (!data) return { tabs: [], schedule: null, story: null };
  const tabs: ExtraTab[] = [];
  const schedule = data.sched && !skipMedals ? (
    <section className="ev-sec evx-sched-sec">
      <b>{data.sched.cn ? t("일정 (중국 서버 기준)") : t("일정")}</b><Schedule s={data.sched} />
    </section>
  ) : null;
  if (data.missions?.length) {
    tabs.push({ key: "missions", label: t("이벤트 미션 {n}", { n: data.missions.length }),
      node: <Missions list={data.missions} open={open} /> });
  }
  if (data.medals && !skipMedals) {
    tabs.push({ key: "medals", label: t("훈장 {n}", { n: data.medals.list.length }), node: <Medals m={data.medals} /> });
  }
  if (data.furn) {
    tabs.push({ key: "furn", label: t("이벤트 가구 {n}", { n: data.furn.list.length }), node: <Furniture f={data.furn} /> });
  }
  if (data.favor?.length) {
    tabs.push({ key: "favor", label: t("신뢰도 보너스 오퍼레이터"), node: <Favor list={data.favor} open={open} /> });
  }
  return { tabs, schedule, story: data.story ?? null };
}

function Schedule({ s }: { s: NonNullable<Extra["sched"]> }) {
  const { t } = useI18n();
  return (
    <dl className="evx-sched">
      <dt>{t("이벤트 기간")}</dt><dd>{s.s}{s.e ? ` ~ ${s.e}` : ""}</dd>
      {s.r && (<><dt>{t("교환소 마감")}</dt><dd>{s.r}</dd></>)}
      {s.n?.map(([at, title], i) => (
        <div key={i} className="evx-node"><dt>{at}</dt><dd>{title}</dd></div>
      ))}
    </dl>
  );
}

const MISSION_FOLD = 24;   // 미션이 이보다 많으면 접어 두고 '모두 보기' — 많은 건 60개가 넘는다

function RewardChip({ r, open }: { r: Reward; open: Open }) {
  const [kind, rid, name, n, icon] = r;
  const img = kind === "item" && icon ? itemIcon(icon)
    : kind === "furn" ? eventArtUrl("furni", rid)
    : kind === "char" ? asset(`/avatars/${rid}.webp`) : null;
  const local = kind === "furn" ? `/event/furni/${rid}.webp` : "";
  const click = kind === "item" ? () => open.onOpenItem(rid) : kind === "char" ? () => open.onShowOperator(rid) : undefined;
  const body = (
    <>
      {img && <img src={img} alt="" aria-hidden width={24} height={24} loading="lazy" decoding="async"
        onError={onImgError(local)} />}
      <span>{name}</span>{n > 1 && <em>×{n.toLocaleString()}</em>}
    </>
  );
  return click
    ? <button type="button" className="evx-rw" onClick={click}>{body}</button>
    : <span className="evx-rw">{body}</span>;
}

function Missions({ list, open }: { list: NonNullable<Extra["missions"]>; open: Open }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, MISSION_FOLD);
  return (
    <>
      <ol className="evx-missions">
        {shown.map(([goal, rws], i) => (
          <li key={i}>
            <span className="evx-goal">{goal}</span>
            <span className="evx-rws">{rws.map((r, k) => <RewardChip key={k} r={r} open={open} />)}</span>
          </li>
        ))}
      </ol>
      {list.length > MISSION_FOLD && (
        <button type="button" className="evx-more" onClick={() => setAll((v) => !v)}>
          {all ? t("접기") : t("모두 보기 ({n})", { n: list.length })}
        </button>
      )}
    </>
  );
}

/** 훈장 상세 모달 — 목록 칸은 이름·얻는 조건까지만, 누르면 큰 그림·설명문까지 (사용자 지시 2026-10-10
 *  "훈장도 클릭하면 상세정보, 기본적으로는 얻는 조건까지만"). 벡터 돌파 훈장 탭도 이걸 쓴다 */
export function MedalModal({ img, name, tags, how, desc, onClose }: {
  img: ReactNode; name: string; tags?: ReactNode; how?: ReactNode; desc?: ReactNode; onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <ModalWindow label={name} className="operator-modal evx-furn-modal evx-medal-modal" onClose={onClose}>
      <div className="evx-furn-detail">
        {img}
        <div>
          <strong>{name}{tags}</strong>
          {how && <dl><dt>{t("얻는 조건")}</dt><dd className="evx-medal-how">{how}</dd></dl>}
          {desc && <p>{desc}</p>}
        </div>
      </div>
    </ModalWindow>
  );
}

function Medals({ m }: { m: NonNullable<Extra["medals"]> }) {
  const { t } = useI18n();
  const [pick, setPick] = useState<string | null>(null);
  const cur = m.list.find((r) => r[0] === pick);
  const tagsOf = (rarity: string, hidden: number) => (
    <>{rarity && <em className="evx-tier">{rarity}</em>}{hidden ? <em className="evx-hidden">{t("숨김 훈장")}</em> : null}</>
  );
  return (
    <>
      {m.set && <p className="evx-set"><strong>{m.set[0]}</strong>{m.set[1] && <span>{m.set[1]}</span>}</p>}
      <ul className="vb-medals">
        {m.list.map(([mid, name, rarity, how, , hidden]) => (
          <li key={mid}>
            <button type="button" className="vb-medal-btn" onClick={() => setPick(mid)}>
              <img src={eventArtUrl("medal", mid)} alt="" aria-hidden width={48} height={48}
                loading="lazy" decoding="async" onError={onImgError(`/event/medal/${mid}.webp`)} />
              <span>
                <b>{name}{tagsOf(rarity, hidden)}</b>
                {how && <i>{how}</i>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {cur && (
        <MedalModal name={cur[1]} tags={tagsOf(cur[2], cur[5])} how={cur[3]} desc={cur[4]} onClose={() => setPick(null)}
          img={<img src={eventArtUrl("medal", cur[0])} alt="" aria-hidden width={128} height={128} onError={onImgError(`/event/medal/${cur[0]}.webp`)} />} />
      )}
    </>
  );
}

// 가구 카드를 누르면 그 가구의 상세(분위기·크기·상호작용·설명문)를 모달로 (사용자 지시 2026-10-10 "클릭하면 모달로") (사용자 요청 2026-10-10 "이벤트 가구는
// 상세 데이터 없어?"). 세트 설명 밑엔 부분 세트 효과(가구 n개 → 분위기 +m)와 가구 분위기 합
function Furniture({ f }: { f: NonNullable<Extra["furn"]> }) {
  const { t } = useI18n();
  const [pick, setPick] = useState<string | null>(null);
  const cur = f.list.find((r) => r[0] === pick);
  const total = f.list.reduce((a, r) => a + (r[3] ?? 0), 0);
  return (
    <>
      {f.theme && <p className="evx-set"><strong>{f.theme[0]}</strong>{f.theme[1] && <span>{f.theme[1]}</span>}</p>}
      {(f.sets?.length || total > 0) && (
        <p className="evx-furn-sets">
          {total > 0 && <span>{t("가구 분위기 합")} <b>{total.toLocaleString()}</b></span>}
          {f.sets?.map(([name, n, c], i) => (
            <span key={i} title={name || undefined}>{name ? `${name} · ` : ""}{t("{n}개 모으면", { n })} <b>+{c}</b></span>
          ))}
        </p>
      )}
      <div className="evx-furn evx-furn-big">
        {f.list.map(([fid, name, , comfort]) => (
          <button key={fid} type="button" className={`evx-rw${fid === pick ? " on" : ""}`} aria-pressed={fid === pick}
            onClick={() => setPick((p) => (p === fid ? null : fid))}>
            <img src={eventArtUrl("furni", fid)} alt="" aria-hidden width={96} height={96}
              loading="lazy" decoding="async" onError={onImgError(`/event/furni/${fid}.webp`)} />
            <span>{name}</span>
            {comfort ? <small>{t("분위기")} {comfort}</small> : null}
          </button>
        ))}
      </div>
      {cur && (
        <ModalWindow label={cur[1]} className="operator-modal evx-furn-modal" onClose={() => setPick(null)}>
          <div className="evx-furn-detail">
            <img src={eventArtUrl("furni", cur[0])} alt="" aria-hidden width={160} height={160}
              onError={onImgError(`/event/furni/${cur[0]}.webp`)} />
            <div>
              <strong>{cur[1]}</strong>
              <dl>
                {cur[3] != null && <><dt>{t("분위기")}</dt><dd>{cur[3]}</dd></>}
                {cur[4] && <><dt>{t("크기")}</dt><dd>{t("가로 {w} · 깊이 {d} · 높이 {h}", { w: cur[4][0], d: cur[4][1], h: cur[4][2] })}</dd></>}
                {cur[5] && <><dt>{t("상호작용")}</dt><dd>{cur[5] === "MUSIC" ? t("음악 재생") : cur[5]}</dd></>}
              </dl>
              {cur[6] && <p>{cur[6]}</p>}
            </div>
          </div>
        </ModalWindow>
      )}
    </>
  );
}

function Favor({ list, open }: { list: [string, string][]; open: Open }) {
  return (
    <div className="evx-furn">
      {list.map(([cid, name]) => (
        <button key={cid} type="button" className="evx-rw" onClick={() => open.onShowOperator(cid)}>
          <img src={asset(`/avatars/${cid}.webp`)} alt="" aria-hidden width={32} height={32} loading="lazy" decoding="async" />
          <span>{name}</span>
        </button>
      ))}
    </div>
  );
}

/** 이벤트 창 탭 막대 — 듀얼 채널·벡터 돌파 상세와 같은 규격(.ed-tabs·.ed-panel). 탭이 하나뿐이면 막대 없이 본문만.
 *  ⚠ 호출부가 `key={이벤트 id}` 로 다시 마운트해 다른 이벤트로 넘어가면 개요로 돌아온다. */
export function EventTabs({ tabs }: { tabs: ExtraTab[] }) {
  const [cur, setCur] = useState(tabs[0]?.key);
  const active = tabs.find((x) => x.key === cur) ?? tabs[0];
  if (!active) return null;
  if (tabs.length < 2) return <>{active.node}</>;
  return (
    <section className="ev-sec ed-wrap ev-tabwrap">
      <div className="ed-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={x.key === active.key}
            className={x.key === active.key ? "on" : undefined} onClick={() => setCur(x.key)}>{x.label}</button>
        ))}
      </div>
      <div className="ed-panel" role="tabpanel">{active.node}</div>
    </section>
  );
}
