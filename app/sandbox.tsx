"use client";

// 생존연산(Reclamation Algorithm) 가이드 — 사용자 확정 2026-08-12
// "생존연산 가이드, 중국어도 다 번역되도록... 할 수 있는 모든 걸 다 해서".
//
// - 사막 이야기(sandbox_1): KR/EN/JA 공식 텍스트 — 요리·음료, 제작·설치물, 지역·날씨,
//   조우, 균열·원정, 테크.
// - 신시즌 「재기동 앵커」(sandbox_2): **CN 선행** — 비공식 번역(scripts/sandbox-cn-ko.json)
//   + 中 원문 병기. 사이트 전역 '미래시 데이터 포함' 토글을 따른다 (통전 미래시와 동일).
//
// 데이터는 scripts/build-sandbox.py 산출 app/data/sandbox{,.en,.ja}.json —
// 로케일 래퍼(sandbox-ko/en/ja.tsx)가 자기 것만 정적 임포트하고 home이 lazy로 문다.

import { useMemo, useState } from "react";
import { useI18n } from "./i18n";
import { normSearch, useSearchInput } from "./search";
import { asset } from "./assets";

// 아이템 아이콘·지역 맵 프리뷰 — build-sandbox.py가 public/sandbox/{item,map}/에 받아
// R2로 서빙한다 (사용자 요청 2026-08-12 "맵이라든지 각종 섬네일이라든지 전부").
// ⚠ 폴더는 sandbox, 라우트는 /ra — 이름이 달라야 deploy.sh가 자산만 떼어낸다.
// 일부 재화(2종)는 원본에 아이콘이 없다 — onError로 조용히 숨긴다.
const itemIcon = (id: string) => asset(`/sandbox/item/${id}.webp`);
const stageMapImg = (id: string) => asset(`/sandbox/map/${id}.webp`);
const miscIcon = (k: string) => asset(`/sandbox/misc/${k}.webp`);
// 요리 속성 → 속성 아이콘 파일 (foodattributeicons — 실파일 6종)
const FOOD_ATTR_ICON: Record<string, string> = {
  SURVIVE: "survive_main", ATTACK: "attack_main", COOLDOWN: "cooldown_main",
  COST: "cost_main", SKILL_POINT: "skill_point_main", SPECIAL: "special_main",
};
const hideErr = (ev: React.SyntheticEvent<HTMLImageElement>) => { ev.currentTarget.style.display = "none"; };

type Item = [string, string, number, string];            // [이름, 용도, 희귀도, 타입]
type V3Item = [string, string, string, number, string];  // [번역명, CN, 용도, 희귀도, 타입]
export type SandboxDoc = {
  v2: {
    name: string;
    items: Record<string, Item>;
    foods: { id: string; attrs: string[]; recipes: string[][]; variants: [string, string, string][] }[];
    foodMats: [string, string, string, string, string][];
    drinkMats: [string, number][];
    crafts: { id: string; type: string; unlock: string; mats: Record<string, number>; rarity: number }[];
    traps: Record<string, { name: string; tag: string; type: string; lv: number }>;
    trapTags: Record<string, [string, string]>;
    stages: [string, string, string, string, number, number][];
    zones: Record<string, string>;
    nodeTypes: Record<string, [string, string]>;
    weather: [string, string, number, string, string, string, string][];
    scenes: { id: string; icon: string; title: string; desc: string; choices: [string, string, number][] }[];
    rift: { mains: [string, string, number, string][]; subs: [string, string][]; diffs: [number, string][] };
    expeditions: [string, string, number, number, number, number][];
    techs: [string, string, number, string, string][];
  };
  v3: {
    name: string; cnName: string; start: number;
    items: Record<string, V3Item>;
    process: [string, number, Record<string, number>, number][];
    builds: [string, Record<string, number>, string][];
    stages: [string, string, string, string][];
    weather: [string, string, string, string][];
    scenes: { title: string; cn: string; desc: string; choices: [string, string, string][] }[];
  };
};

const VIEWS = ["food", "craft", "stage", "event", "rift", "tech", "next"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = {
  food: "요리·음료", craft: "제작·설치물", stage: "지역·날씨", event: "조우",
  rift: "균열·원정", tech: "테크트리", next: "신시즌",
};
// 요리 효과 분류 (foodData.attributes — 2026-08-12 실데이터 전수: ATTACK·COOLDOWN·
// COST·SKILL_POINT·SPECIAL·SURVIVE)
const FOOD_ATTR: Record<string, string> = {
  SURVIVE: "생존", ATTACK: "공격", COOLDOWN: "재배치", COST: "코스트", SKILL_POINT: "스킬", SPECIAL: "특수",
};

// 테크 계열 (developmentData.techType — 실데이터 전수: BATTLE·COLLECT·DUNGEON·SHOP·SURVIVE)
const TECH_TYPE: Record<string, string> = {
  SURVIVE: "생존", BATTLE: "전투", COLLECT: "채집", DUNGEON: "균열", SHOP: "상점",
};

/** 재료 배열 → "이름 ×n + 이름" 표기 (같은 재료 반복을 접는다) */
function matLine(mats: string[], nameOf: (id: string) => string): string {
  const cnt = new Map<string, number>();
  for (const m of mats) cnt.set(m, (cnt.get(m) ?? 0) + 1);
  return [...cnt].map(([id, n]) => (n > 1 ? `${nameOf(id)} ×${n}` : nameOf(id))).join(" + ");
}

export default function SandboxGuide({ doc, includeFuture }: { doc: SandboxDoc; includeFuture?: boolean }) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<View>("food");
  const { term, clear, inputProps } = useSearchInput();
  const q = normSearch(term);
  const { v2, v3 } = doc;

  const nameOf = (id: string) => v2.items[id]?.[0] ?? id;
  // 신시즌(CN 선행)은 **중국어가 메인, 한국어 번역이 서브 병기** (사용자 확정 2026-08-12
  // "반드시 중국어를 메인으로, 한국어를 서브로 병기") — 재료 줄은 "原文(번역)" 꼴로 잇는다.
  const p3 = (id: string) => {
    const it = v3.items[id];
    if (!it) return id;
    return it[0] !== it[1] ? `${it[1]}(${it[0]})` : it[1];
  };

  // 뷰별 검색 필터 — 검색어가 있으면 각 뷰의 목록을 이름 기준으로 거른다
  const match = (s: string) => !q || normSearch(s).includes(q);

  const foods = useMemo(() => v2.foods.filter((f) => !q || f.variants.some((v) => normSearch(v[1]).includes(q))
    || f.recipes.some((r) => r.some((m) => normSearch(nameOf(m)).includes(q)))), [v2, q]);  // eslint-disable-line react-hooks/exhaustive-deps
  const crafts = useMemo(() => v2.crafts.filter((c) => match(nameOf(c.id))), [v2, q]);  // eslint-disable-line react-hooks/exhaustive-deps

  const views = VIEWS.filter((vw) => vw !== "next" || includeFuture);

  return (
    <section className="sb-guide" aria-labelledby="sb-title">
      <header className="sim-head">
        <span className="section-no">RECLAMATION ALGORITHM</span>
        <h2 id="sb-title">{t("생존연산 가이드")}</h2>
      </header>
      <p className="sim-intro">{t("생존연산 상설 「사막 이야기」의 요리 조합, 제작·설치물 재료, 지역과 날씨, 조우 선택지, 균열 목표를 게임 데이터에서 그대로 정리했습니다.")}</p>
      {!includeFuture && (
        <p className="sim-note">{t("중국 서버 선행 신시즌 「재기동 앵커」는 헤더의 '미래시 데이터 포함'을 켜면 보입니다.")}</p>
      )}

      <div className="sb-views" role="tablist" aria-label={t("생존연산 보기")}>
        {views.map((vw) => (
          <button key={vw} type="button" role="tab" aria-selected={view === vw}
            className={view === vw ? "on" : ""} onClick={() => setView(vw)}>
            {t(VIEW_LABEL[vw])}
            {vw === "next" && <em className="tab-sub-future">{t("미래시")}</em>}
          </button>
        ))}
      </div>

      {(view === "food" || view === "craft") && (
        <div className="search-wrap heading-search sim-search sb-search">
          <span>⌕</span>
          <input {...inputProps} placeholder={t("이름·재료 검색")} autoComplete="off" spellCheck={false} />
          <button type="button" className="search-clear" onClick={() => clear()} aria-label={t("검색어 지우기")}>×</button>
        </div>
      )}

      {view === "food" && (
        <>
          <p className="sim-note">{t("재료 조합이 같으면 같은 요리가 나옵니다. α·β는 보조 재료의 속성에 따라 갈리는 상위 변형입니다.")}</p>
          <div className="sb-grid">
            {foods.map((f) => (
              <article key={f.id} className="sb-card">
                <h4>
                  <img className="sb-ico" src={itemIcon(f.id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                  {f.variants[0]?.[1] ?? f.id}
                  {f.attrs.map((a) => (
                    <i key={a} className={`sb-chip a-${a}`}>
                      {FOOD_ATTR_ICON[a] && <img src={miscIcon(FOOD_ATTR_ICON[a])} alt="" aria-hidden onError={hideErr} />}
                      {t(FOOD_ATTR[a] ?? a)}
                    </i>
                  ))}
                </h4>
                {f.recipes.length > 0 ? (
                  <ul className="sb-recipes">
                    {f.recipes.map((r, i) => <li key={i}>{matLine(r, nameOf)}</li>)}
                  </ul>
                ) : (
                  <p className="sb-dim">{t("정해진 조합이 없는 요리입니다 — 조건이 안 맞는 조합에서 나옵니다.")}</p>
                )}
                <ul className="sb-variants">
                  {f.variants.map((v, i) => (
                    <li key={i}><b className={`v-${v[0]}`}>{v[0] === "NONE" ? "—" : v[0] === "ALPHA" ? "α" : "β"}</b> {v[2]}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <h3 className="sb-h3">{t("요리 재료 효과")}</h3>
          <p className="sim-note">{t("보조 재료의 속성이 α(공격)·β(방어) 변형을 결정합니다.")}</p>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("재료")}</th><th>{t("구분")}</th><th>{t("변형")}</th><th>{t("효과")}</th></tr></thead>
            <tbody>
              {v2.foodMats.filter((m) => match(nameOf(m[0]))).map((m, i) => (
                <tr key={i}><td className="sb-cell-ico"><img className="sb-ico" src={itemIcon(m[0])} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />{nameOf(m[0])}</td><td>{m[1] === "SUB" ? t("보조") : t("주재료")}</td>
                  <td>{m[3] === "ALPHA" ? "α" : m[3] === "BETA" ? "β" : "—"}</td><td>{m[4]}</td></tr>
              ))}
            </tbody>
          </table></div>
          <h3 className="sb-h3">{t("음료 재료")}</h3>
          <p className="sim-note">{t("음수대에 넣으면 수분으로 바뀌는 재료와 환산량입니다.")}</p>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("재료")}</th><th>{t("수분")}</th></tr></thead>
            <tbody>
              {v2.drinkMats.filter((m) => match(nameOf(m[0]))).map((m, i) => (
                <tr key={i}><td className="sb-cell-ico"><img className="sb-ico" src={itemIcon(m[0])} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />{nameOf(m[0])}</td><td>{m[1]}</td></tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      {view === "craft" && (
        <>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("설치물")}</th><th>{t("재료")}</th><th>{t("해금")}</th><th>{t("분류")}</th></tr></thead>
            <tbody>
              {crafts.map((c) => {
                const trap = v2.traps[c.id];
                return (
                  <tr key={c.id}>
                    <td className="sb-cell-ico"><img className="sb-ico" src={itemIcon(c.id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />{nameOf(c.id)}{trap && trap.lv > 1 && <i className="sb-lv">Lv.{trap.lv}</i>}</td>
                    <td>{Object.entries(c.mats).map(([id, n]) => `${nameOf(id)} ×${n}`).join(" + ") || "—"}</td>
                    <td>{c.unlock || "—"}</td>
                    <td className="sb-cell-ico">{trap ? (<>
                      {v2.trapTags[trap.tag]?.[1] && <img className="sb-ico sb-ico-dim" src={miscIcon(v2.trapTags[trap.tag][1])} alt="" aria-hidden loading="lazy" onError={hideErr} />}
                      {v2.trapTags[trap.tag]?.[0] ?? trap.tag}
                    </>) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </>
      )}

      {view === "stage" && (
        <>
          <h3 className="sb-h3">{t("날씨")}</h3>
          <div className="sb-grid sb-grid-s">
            {v2.weather.map((w) => (
              <article key={w[0]} className="sb-card">
                <h4>
                  {w[6] && <img className="sb-ico-big sb-ico-dim" src={miscIcon(w[6])} alt="" aria-hidden loading="lazy" onError={hideErr} />}
                  {w[1]} <i className="sb-chip">{w[3]}</i>{w[2] > 0 && <i className="sb-chip warn">{t("위험 {n}", { n: String(w[2]) })}</i>}
                </h4>
                <p>{w[4]}</p>
                <p className="sb-dim">{w[5]}</p>
              </article>
            ))}
          </div>
          <h3 className="sb-h3">{t("노드 종류")}</h3>
          <div className="sb-nodekey">
            {Object.entries(v2.nodeTypes).map(([k, nt]) => (
              <span key={k}>
                {nt[1] && <img src={miscIcon(nt[1])} alt="" aria-hidden loading="lazy" onError={hideErr} />}
                {nt[0]}
              </span>
            ))}
          </div>
          <h3 className="sb-h3">{t("지역")} <em className="sb-count">{v2.stages.length}</em></h3>
          <p className="sim-note">{t("행동력은 이동 1회 소모량, ⚔는 적습 조우 시의 소모량입니다.")}</p>
          <div className="sb-grid">
            {v2.stages.map((s) => (
              <article key={s[0]} className="sb-card sb-map-card">
                <img src={stageMapImg(s[0])} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />
                <h4><i className="sb-chip">{s[1]}</i>{s[2]}
                  <i className="sb-lv">{t("행동력")} {s[4]}{s[5] !== s[4] ? ` · ⚔${s[5]}` : ""}</i></h4>
                <p className="sb-dim">{s[3]}</p>
              </article>
            ))}
          </div>
        </>
      )}

      {view === "event" && (
        <div className="sb-grid">
          {v2.scenes.map((sc) => (
            <article key={sc.id} className="sb-card">
              <h4>
                {sc.icon && <img className="sb-ico-big sb-ico-dim" src={miscIcon(sc.icon)} alt="" aria-hidden loading="lazy" onError={hideErr} />}
                {sc.title}
              </h4>
              <p className="sb-dim">{sc.desc}</p>
              <ul className="sb-choices">
                {sc.choices.map((c, i) => (
                  <li key={i}><b>{c[0]}</b>{c[2] > 0 && <i className="sb-lv">{t("행동력 {n}", { n: String(c[2]) })}</i>}{c[1] && <span>{c[1]}</span>}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}

      {view === "rift" && (
        <>
          <h3 className="sb-h3">{t("균열 주 목표")}</h3>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("목표")}</th><th>{t("내용")}</th><th>{t("기한")}</th><th>{t("대상")}</th></tr></thead>
            <tbody>
              {v2.rift.mains.map((m, i) => (
                <tr key={i}><td>{m[0]}</td><td>{m[1]}</td><td>{m[2] ? t("{n}일", { n: String(m[2]) }) : "—"}</td><td>{m[3] || "—"}</td></tr>
              ))}
            </tbody>
          </table></div>
          <h3 className="sb-h3">{t("난이도 (환경압력)")}</h3>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("단계")}</th><th>{t("효과")}</th></tr></thead>
            <tbody>{v2.rift.diffs.sort((a, b) => a[0] - b[0]).map((dd, i) => <tr key={i}><td>{dd[0]}</td><td>{dd[1]}</td></tr>)}</tbody>
          </table></div>
          <h3 className="sb-h3">{t("원정")}</h3>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("내용")}</th><th>{t("효과")}</th><th>{t("인원")}</th><th>{t("기간")}</th></tr></thead>
            <tbody>
              {v2.expeditions.map((e, i) => (
                <tr key={i}><td className="sb-desc">{e[0]}</td><td>{e[1]}</td>
                  <td>{t("{n}명", { n: String(e[3]) })}{e[4] > 0 && ` · ${t("정예화 {n}+", { n: String(e[4]) })}`}</td>
                  <td>{t("{n}일", { n: String(e[5]) })}</td></tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      {view === "tech" && (
        <>
          <p className="sim-note">{t("주둔지 연구 노트로 해금하는 상시 강화입니다. 숫자는 필요한 토큰입니다.")}</p>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("기술")}</th><th>{t("계열")}</th><th>{t("토큰")}</th><th>{t("효과")}</th></tr></thead>
            <tbody>
              {v2.techs.map((tc, i) => (
                <tr key={i}><td className="sb-cell-ico">{tc[4] && <img className="sb-ico sb-ico-dim" src={miscIcon(tc[4])} alt="" aria-hidden loading="lazy" onError={hideErr} />}{tc[0]}</td><td>{t(TECH_TYPE[tc[1]] ?? tc[1])}</td><td>{tc[2]}</td><td>{tc[3]}</td></tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      {/* 신시즌(CN 선행) — **중국어 원문이 메인, 한국어 번역이 서브** (사용자 확정
          2026-08-12 "반드시 중국어를 메인으로, 한국어를 서브로 병기"). 표기 뒤집지 말 것. */}
      {view === "next" && includeFuture && (
        <>
          <h3 className="sb-h3">{v3.cnName}{v3.name !== v3.cnName && <span className="sb-cn">{v3.name}</span>}</h3>
          <p className="sim-note">
            {t("중국 서버 선행 신시즌입니다 — 원문(중국어)이 기준이고, 괄호·옆의 한국어는 비공식 번역입니다.")}
            {locale !== "ko" && <> {t("이 신시즌의 공식 번역은 아직 없어 원문(중국어)으로 표시됩니다.")}</>}
          </p>
          <h3 className="sb-h3">{t("가공 레시피")}</h3>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("산출")}</th><th>{t("재료")}</th><th>Lv</th></tr></thead>
            <tbody>
              {v3.process.map((r, i) => (
                <tr key={i}><td className="sb-cell-ico"><img className="sb-ico" src={itemIcon(r[0])} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />{p3(r[0])}{r[1] > 1 ? ` ×${r[1]}` : ""}</td>
                  <td>{Object.entries(r[2]).map(([id, n]) => `${p3(id)} ×${n}`).join(" + ")}</td><td>{r[3]}</td></tr>
              ))}
            </tbody>
          </table></div>
          <h3 className="sb-h3">{t("건설 레시피")}</h3>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("건물")}</th><th>{t("재료")}</th></tr></thead>
            <tbody>
              {v3.builds.map((b, i) => (
                <tr key={i}><td className="sb-cell-ico"><img className="sb-ico" src={itemIcon(b[0])} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />{p3(b[0])}</td>
                  <td>{Object.entries(b[1]).map(([id, n]) => `${p3(id)} ×${n}`).join(" + ") || "—"}</td></tr>
              ))}
            </tbody>
          </table></div>
          <h3 className="sb-h3">{t("지역")}</h3>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("코드")}</th><th>{t("이름")}</th><th>{t("설명")}</th></tr></thead>
            <tbody>
              {v3.stages.map((s, i) => (
                <tr key={i}><td>{s[0]}</td><td>{s[2]}{locale === "ko" && s[1] !== s[2] && <span className="sb-cn">{s[1]}</span>}</td>
                  <td className="sb-desc">{s[3]}</td></tr>
              ))}
            </tbody>
          </table></div>
          <h3 className="sb-h3">{t("날씨")}</h3>
          <div className="sb-grid sb-grid-s">
            {v3.weather.map((w, i) => (
              <article key={i} className="sb-card">
                <h4>{w[1]}{locale === "ko" && w[0] !== w[1] && <span className="sb-cn">{w[0]}</span>}</h4>
                <p>{w[2]}</p><p className="sb-dim">{w[3]}</p>
              </article>
            ))}
          </div>
          <h3 className="sb-h3">{t("조우")}</h3>
          <div className="sb-grid">
            {v3.scenes.map((sc, i) => (
              <article key={i} className="sb-card">
                <h4>{sc.cn}{locale === "ko" && sc.title !== sc.cn && <span className="sb-cn">{sc.title}</span>}</h4>
                <p className="sb-dim">{sc.desc}</p>
                <ul className="sb-choices">
                  {sc.choices.map((c, j) => (
                    <li key={j}><b>{c[0]}</b>{locale === "ko" && c[0] !== c[1] && <span className="sb-cn">{c[1]}</span>}{c[2] && <span>{c[2]}</span>}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <h3 className="sb-h3">{t("아이템")} <em className="sb-count">{Object.keys(v3.items).length}</em></h3>
          <div className="sb-table-wrap"><table className="sb-table">
            <thead><tr><th>{t("원문")}</th>{locale === "ko" && <th>{t("번역")}</th>}<th>{t("용도")}</th></tr></thead>
            <tbody>
              {Object.entries(v3.items).map(([id, it]) => (
                <tr key={id}><td className="sb-cell-ico"><img className="sb-ico" src={itemIcon(id)} alt="" aria-hidden loading="lazy" decoding="async" onError={hideErr} />{it[1]}</td>
                  {locale === "ko" && <td>{it[0] !== it[1] ? it[0] : "—"}</td>}<td className="sb-desc">{it[2]}</td></tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
    </section>
  );
}
