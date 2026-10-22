"use client";

// 내 정보 '보유 스킨'·'훈장' 칸을 누르면 뜨는 목록 창 (사용자 요청 2026-10-22 "클릭하면 뭐 갖고 있는지").
// 자료는 창을 열 때만 받는다 — public/skins/owned-index.json · public/medals/index.json · 아이콘 (scripts/build-collect.py, R2).
// 계정 쪽은 profile.skinIds(기본 복장 제외) · profile.medalList([id, 처음 얻은 시각]) — 옛 동기화엔 없어 다시 동기화하라고 안내한다.
import { useEffect, useMemo, useState } from "react";
import { asset } from "./assets";
import { useI18n, DT_LOCALE, type Locale } from "./i18n";
import { ModalWindow } from "./modal-window";
import { Dropdown } from "./dropdown";
import { ZoomWindow } from "./zoom-window";
import { dynPoster, hasDyn } from "./dyn-illust";

type L10n = Partial<Record<Locale, string>> & { ko?: string };
const pick = (m: L10n | undefined, locale: Locale) => (m ? m[locale] ?? m.ko ?? "" : "");
type SkinIdx = Record<string, { c: string; p: string; n: L10n; g: L10n; v?: string[] }>;
type MedalIdx = { groups: { id: string; n: L10n }[]; medals: Record<string, { g: string; n: L10n; m: L10n; r: string }> };

/** 목록 자료 캐시 키 — build-collect.py 로 다시 만들어 R2 에 올리면 올린다 (엣지가 옛 파일을 붙들지 않게) */
const COLLECT_VER = "2026102204";
let skinIdx: Promise<SkinIdx> | null = null;
let medalIdx: Promise<MedalIdx> | null = null;
// 실패하면 다음에 다시 받게 비운다 (자료가 R2 에 아직 없을 때 등)
const loadSkins = () => (skinIdx ??= fetch(`${asset("/skins/owned-index.json")}?v=${COLLECT_VER}`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).catch((e) => { skinIdx = null; throw e; }));
const loadMedals = () => (medalIdx ??= fetch(`${asset("/medals/index.json")}?v=${COLLECT_VER}`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).catch((e) => { medalIdx = null; throw e; }));
// 게임 '수집' 수에 안 드는 훈장 — 숨김·금장 (워커 countedMedal 과 같은 규칙)
const counted = (id: string) => !id.startsWith("medal_hidden_") && !/_\d{2}5$/.test(id);

export function SkinsWindow({ skinIds, server, opName, onShowOperator, onClose }: {
  skinIds: string[] | undefined; server: string; opName: (id: string) => string; onShowOperator?: (id: string) => void; onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const [idx, setIdx] = useState<SkinIdx | null>(null);
  const [failed, setFailed] = useState(false);
  // 누르면 그 스킨을 크게 — 오퍼 상세와 같은 확대 창(움직이는 일러가 있으면 그것) (사용자 지적 2026-10-22 "오퍼가 아니라 스킨이 크게")
  const [zoom, setZoom] = useState<{ p: string; n: string; c: string } | null>(null);
  // 브랜드 탭 (사용자 지시 2026-10-22 "에포크 같은 시리즈별로 탭") — null = 전체
  const [brand, setBrand] = useState<string | null>(null);
  useEffect(() => { void loadSkins().then(setIdx, () => setFailed(true)); }, []);
  // 브랜드별로 묶는다 — 묶음은 많이 가진 순(기타는 맨 뒤), 안에서는 가진 것 먼저·이름순.
  // 못 가진 스킨도 흐리게 같이 (사용자 요청 2026-10-22) — 계정 서버에 나온 것만 (중섭 계정은 표에 없어 전부)
  const groups = useMemo(() => {
    if (!idx || !skinIds) return [];
    const mine = new Set(skinIds);
    const srv = server === "kr" || server === "en" || server === "jp" ? server : null;
    const by = new Map<string, { id: string; c: string; p: string; n: string; own: boolean }[]>();
    for (const [id, s] of Object.entries(idx)) {
      const own = mine.has(id);
      if (!own && srv && s.v && !s.v.includes(srv)) continue;
      const g = pick(s.g, locale) || t("기타");
      (by.get(g) ?? by.set(g, []).get(g)!).push({ id, c: s.c, p: s.p, n: pick(s.n, locale), own });
    }
    const etc = t("기타");
    return [...by].map(([g, list]) => ({ g, own: list.filter((x) => x.own).length, list: list.sort((a, b) => Number(b.own) - Number(a.own) || a.n.localeCompare(b.n, locale)) }))
      .sort((a, b) => Number(a.g === etc) - Number(b.g === etc) || b.own - a.own || b.list.length - a.list.length || a.g.localeCompare(b.g, locale));
  }, [idx, skinIds, server, locale, t]);
  const n = groups.reduce((a, g) => a + g.own, 0);
  const all = groups.reduce((a, g) => a + g.list.length, 0);
  return (
    <ModalWindow label={t("보유 스킨")} className="operator-modal me-collect-modal" onClose={onClose}>
      <div className="me-collect">
        <p className="me-note">{!skinIds ? t("목록은 다시 동기화하면 보입니다.") : failed ? t("스킨 정보를 불러오지 못했습니다.") : idx ? t("기본 복장을 뺀 스킨 {n} / {all}벌", { n, all }) : t("불러오는 중…")}</p>
        {groups.length > 1 && (
          <div className="me-seg me-skin-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={!brand} className={!brand ? "selected" : ""} onClick={() => setBrand(null)}>{t("전체")} <small>{n}</small></button>
            {groups.map((g) => (
              <button key={g.g} type="button" role="tab" aria-selected={brand === g.g} className={brand === g.g ? "selected" : ""} onClick={() => setBrand(g.g)}>{g.g} <small>{g.own}</small></button>
            ))}
          </div>
        )}
        {groups.filter((x) => !brand || x.g === brand).map(({ g, list }) => (
          <section key={g} className="me-collect-group">
            <h4>{g} <small>{groups.find((x) => x.g === g)!.own} / {list.length}</small></h4>
            <ul className="me-skin-grid">
              {list.map((s) => (
                <li key={s.id} className={s.own ? undefined : "off"}>
                  <button type="button" onClick={() => setZoom(s)} title={`${s.n} — ${opName(s.c)}`}>
                    <span className="me-skin-art"><img src={asset(`/skin/full/${encodeURIComponent(s.p)}.webp`)} alt="" loading="lazy" decoding="async"
                      onLoad={(e) => e.currentTarget.classList.add("on")} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /></span>
                    <b>{s.n}</b>
                    <small>{opName(s.c)}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {zoom && <ZoomWindow onClose={() => setZoom(null)} alt={`${opName(zoom.c)} · ${zoom.n}`}
        src={hasDyn(zoom.p) ? dynPoster(zoom.p) : asset(`/skin/full/${encodeURIComponent(zoom.p)}.webp`)} dyn={hasDyn(zoom.p) ? zoom.p : undefined} />}
    </ModalWindow>
  );
}

export function MedalsWindow({ medalList, onClose }: { medalList: [string, number][] | undefined; onClose: () => void }) {
  const { locale, t } = useI18n();
  const [idx, setIdx] = useState<MedalIdx | null>(null);
  const [show, setShow] = useState<"got" | "all">("got");
  const [failed, setFailed] = useState(false);
  useEffect(() => { void loadMedals().then(setIdx, () => setFailed(true)); }, []);
  const got = useMemo(() => new Map(medalList ?? []), [medalList]);
  const fmtDate = (sec: number) => new Date(sec * 1000).toLocaleDateString(DT_LOCALE[locale]);
  const groups = useMemo(() => {
    if (!idx) return [];
    return idx.groups.map((g) => {
      const all = Object.entries(idx.medals).filter(([id, m]) => m.g === g.id && (got.has(id) || counted(id)));
      const mine = all.filter(([id]) => got.has(id));
      const list = (show === "got" ? mine : all).sort(([a], [b]) => (got.get(b) ?? 0) - (got.get(a) ?? 0) || a.localeCompare(b));
      return { id: g.id, name: pick(g.n, locale), mine: mine.length, total: all.filter(([id]) => counted(id)).length, list };
    }).filter((g) => g.list.length > 0);
  }, [idx, got, show, locale]);
  return (
    <ModalWindow label={t("훈장")} className="operator-modal me-collect-modal" onClose={onClose}>
      <div className="me-collect">
        <div className="me-collect-head">
          <p className="me-note">{!medalList ? t("목록은 다시 동기화하면 보입니다.") : t("얻은 훈장 {n}개", { n: medalList.length })}</p>
          <Dropdown ariaLabel={t("훈장 보기")} label={show === "got" ? t("얻은 것만") : t("못 얻은 것도")} selected={[show]}
            items={[{ value: "got", label: t("얻은 것만") }, { value: "all", label: t("못 얻은 것도") }]} onPick={(v) => setShow(v as "got" | "all")} />
        </div>
        {!idx && <p className="me-note">{failed ? t("훈장 정보를 불러오지 못했습니다.") : t("불러오는 중…")}</p>}
        {groups.map((g) => (
          <section key={g.id} className="me-collect-group">
            <h4>{g.name} <small>{g.mine} / {g.total}</small></h4>
            <ul className="me-medal-grid">
              {g.list.map(([id, m]) => {
                const at = got.get(id);
                return (
                  <li key={id} className={at ? undefined : "off"} title={`${pick(m.n, locale)}\n${pick(m.m, locale)}`}>
                    <img src={asset(`/medals/icon/${id}.webp`)} alt="" width={56} height={56} loading="lazy" decoding="async"
                      onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                    <b>{pick(m.n, locale)}</b>
                    <small>{at ? fmtDate(at) : pick(m.m, locale)}</small>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </ModalWindow>
  );
}
