"use client";

// 통합전략 탭 — 토픽: 팬텀 & 크림슨 솔리테어(rogue_1) ~ 침몰자의 블랙플로우(rogue_6, CN 선행·미래시).
// 데이터는 scripts/build-rogue.py가 생성하는 app/data/rogueN[.loc].json (클뜯 레포 원본).
// rogue_6은 CN 데이터를 한국어화(rogue6-ko.json)한 것으로, 이름류는 중국어 원문(cn)을 병기한다.
// 서버 탭(한국섭/중국섭, 2026-08-04): 중국섭은 rogueN.cn.json — CN 서버 텍스트에 KR 공식
// 번역을 오버레이한 것으로 rogue_6과 같은 병기 표기. 블랙플로우는 KR 미출시라 KR 탭 비활성.
// 조우의 층별 출현 규칙·엔딩 선제조건은 클라 데이터에 없어 PRTS 기반 큐레이션(rogueN-curated.json)을 병합한다.
import { Fragment, lazy, startTransition, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TOPICS, slugOf, roguePath } from "./rogue-topics";
import rogue1Data from "./data/rogue1.json";
// 노드 종류 아이콘 보유 목록 — 이미지 자체는 R2에만 있고 커밋되지 않는다(.gitignore
// /public/rogue/node/). 어느 (테마,타입) 조합에 아이콘이 있는지는 이 목록으로만 안다.
// 생성: python3 scripts/build-rogue.py --node-icons
import nodeIconData from "./data/rogue-node-icons.json";
import { useConfirm } from "./confirm";
import rogueIndexData from "./data/rogue-index.json";
import { useI18n } from "./i18n";
import { normSearch, useSearchInput } from "./search";
import { SearchSuggest } from "./search-suggest";
import { anyNewFeature, isNewFeature } from "./whats-new";
import { GLOBAL_MODAL_HASH } from "./hash-modal";
import { LENS_ITEM_SECTIONS, type LensGoto, type LensOutcome } from "./lens/match";
import { recognizeShot, warmData, ocrLangFor, resetGradeCache } from "./lens/run";
import { warmOcr, warmDigitOcr } from "./lens/ocr";
import { useClipboardWatch } from "./lens/clipwatch";
import { useBridgeWatch, noteBridge, bridgeLock, bridgeNodeJump, logBridgeEvent, memoBridgeScene, type BridgeLogEvent } from "./lens/bridge";
import { BridgeTopicButton } from "./lens/bridge-button";
import { useDropWatch } from "./lens/dropwatch";
import { asset } from "./assets";
import { ModalWindow } from "./modal-window";
import { StageRouteMap, enemyRouteColor, type StageRoutes } from "./stage-route-map";

// 전투 노드 적 이동 경로 (scripts/build-rogue-routes.py) — 작전 도감과 같은 렌더러를
// 쓴다 (규칙: .claude/skills/route-map-rules). '이동 경로' 탭을 처음 눌렀을 때만
// 지연 로드하고, 긴급 노드 값은 같은 레벨을 쓰는 일반 노드 id 별칭 문자열이다.
let ROUTES_CACHE: Record<string, StageRoutes | string> | null = null;
let ROUTES_LOADING: Promise<void> | null = null;
function loadRogueRoutes(): Promise<void> {
  if (ROUTES_CACHE) return Promise.resolve();
  ROUTES_LOADING ??= import("./data/rogue-routes.json").then((m) => {
    ROUTES_CACHE = (m.default ?? m) as unknown as Record<string, StageRoutes | string>;
  });
  return ROUTES_LOADING;
}
function routesFor(id: string): StageRoutes | undefined {
  let d = ROUTES_CACHE?.[id];
  if (typeof d === "string") d = ROUTES_CACHE?.[d];   // 별칭 한 단계 해석
  return d && typeof d === "object" ? d : undefined;
}

// 게임연결·리플레이 배포 스위치 — 2026-07-26 켜짐(사용자 지시). 끄면 진입 버튼
// (BridgeTopicButton)만 사라지고 인식 파이프라인은 죽은 경로로 남는다.
const BRIDGE_LIVE = true;

// 스샷 레이더 도움말 — 순수 설명 전용 모달 (입력 기능은 페이지 레벨 자동인식이 전담)
const LensHelpModal = lazy(() => import("./lens/help"));

type Zone = { id: string; num: number; name: string; time: string | null; desc: string; buff: string | null; hidden: boolean; img?: boolean; variant?: boolean; cn?: string; portal?: boolean; bg?: string };
type StageEnemy = { key: string; cnt: number };
type Emg = {
  mul?: Record<string, number>; add?: Record<string, number>;
  per?: { keys: string[]; mul: Record<string, number> }[];  // 특정 적 한정 배율
  replace?: Record<string, string>;                          // 긴급 시 적 교체 (원본→변종)
} | null;
type Stage = { id: string; kind: string; zone: number | null; code: string | null; name: string; desc: string | null; eliteDesc: string | null; emg: Emg; map?: string | null; enemies: StageEnemy[]; cn?: string };
type Enemy = { name: string; rank: string | null; index: string | null; attack: string | null; desc: string | null; ability: string | null; hp: number; atk: number; def: number; res: number; aspd: number; ms: number; weight: number; lifePoint: number; immune?: string[]; img?: string | null; cn?: string };
// 소장품 효과의 수치 (scripts/build-rogue.py relic_effects) — usage 문장이 아니라 게임
// 데이터의 blackboard에서 뽑아 3개 로케일에 같은 배열로 심는다(언어 무관 합산).
// m: mul=배율 델타(0.35 → +35%) · add=가산 · scale=1 기준 배율(1.35 → +35%, 겹치면 곱)
//    · get=즉시 획득(편성 인원·희망·목표 HP 등)
// sel: null이면 전체 적용, 아니면 직업(warrior|sniper…)이나 melee/ranged 조건
type Eff = { k: string; v: number; m: "mul" | "add" | "scale" | "get"; sel: string | null };
type Relic = { id: string; name: string; desc: string | null; usage: string | null; obtain: string | null; order: string | null; group: number | null; sort: number; sp: boolean; img?: boolean; iconId?: string; cn?: string; eff?: Eff[] };
type Capsule = { id: string; name: string; en: string | null; desc: string | null; usage: string | null; img?: boolean; cn?: string };
type Simple = { id: string; name: string; desc?: string | null; usage: string | null; img?: boolean; cn?: string };
type Scrap = { id: string; name: string; type: string | null; typeName: string | null; usage: string | null; desc: string | null; img?: boolean; cn?: string };
type Weather = { id: string; name: string; levels: { lv: string; desc: string | null }[]; img?: boolean; cn?: string };
type SubWeather = { id: string; name: string; desc: string | null; img?: boolean; cn?: string };
type Variation = { id: string; name: string; func: string | null; desc: string | null; fusion: boolean; img?: boolean; cn?: string };
type Difficulty = { mode: string; grade: number; name: string; rule: string | null; score: number | null };
// 상세 모달·보유 리스트가 다루는 공통 형태 — 소장품(유물·무대 도구)·부품·사고·주화가 전부 맞는다
type InvStage = { label: string; name: string; usage?: string | null; desc?: string | null };
// stages: 붕괴 패러다임 등 다단계 시스템 — 카드 1장 안에 단계별 [섬네일+이름+효과] 행 (사용자 확정 2026-07-24)
type InvItem = { id: string; name: string; usage?: string | null; desc?: string | null; obtain?: string | null; order?: string | null; kind?: string | null; typeName?: string | null; img?: boolean; iconId?: string; cn?: string; stages?: InvStage[] };
// book = 엔딩 기록(엔딩북) 조각 — 게임 공식 해금 조건 텍스트 (사용자 소원 2026-08-17).
// rid/txt = 기록 원문 (public/rogue/record/<rid>.json — build-rogue-records.py), txt면 클릭 열람.
type Ending = { id: string; name: string; desc: string | null; boss: string | null; priority: number; change: string | null; cond?: string[]; cn?: string; book?: { name?: string; cond?: string; rid?: string; txt?: 1; cn?: string }[] };
// 월간 방문객 — 매달 로테이션되는 방문객 오퍼(chars)와 층·구역별 특별 조우 장면(scenes)
type Visitor = { id: string; name?: string; cn?: string; desc?: string; ym?: string; chars: { id: string; name: string }[]; scenes?: { floor?: number; zone?: string; desc?: string; rid?: string; txt?: 1; cn?: string }[] };
// 선택지는 계단식 트리 — next.desc는 그 선택의 결과 서사, next.choices는 이어지는 하위 선택지
// (현재 데이터는 대부분 결과 서사까지 깊이 2. 하위 선택지가 생기면 재귀로 중첩 렌더).
type EncChoice = { title: string; desc: string | null; cn?: string; variants?: string[]; next?: { desc: string | null; choices: EncChoice[] } };
// battles: 이 조우에서 이어지는 전투 스테이지 id (수작업 대응표 — build-rogue.py 주석 참조)
// scenes: PRTS 매칭 씬 트리 (build-rogue-enc-scenes.py) — dest는 scenes 배열 인덱스.
// branch = 랜덤 결과 분기 라벨(게임 선택지 아님), prob = %확률, cnTitle/cn = 매칭 실패 CN 폴백.
// note = 안내 블록(랜덤 출현 규칙·주사위 판정·조건 — 선택지가 아닌 정보 행).
type EncSceneChoice = { title?: string; desc?: string | null; cn?: string; cnTitle?: string; cnDesc?: string; branch?: string; prob?: number; dest?: number; note?: string };
type EncScene = { desc?: string | null; cn?: string; choices: EncSceneChoice[] };
type Encounter = { scene: string; title: string; desc: string | null; bg?: string | null; choices: EncChoice[]; floors?: number[]; note?: string; cn?: string; battles?: string[]; battlesRandom?: 1; scenes?: EncScene[] };
type RogueData = {
  id: string; name: string; line: string | null; cnName?: string; future?: boolean; server?: string;
  zones: Zone[]; nodeTypes: { id: string; name: string; desc: string | null; func?: string | null; cn?: string }[];
  difficulties: Difficulty[]; stages: Stage[]; enemies: Record<string, Enemy>;
  relics: Relic[]; capsules?: Capsule[]; tools: Simple[]; bands: Simple[]; exploreTools?: Simple[];
  scraps?: Scrap[]; legacies?: Simple[]; buoys?: Simple[];
  weathers?: Weather[]; subweathers?: SubWeather[];
  variations: Variation[]; endings: Ending[]; encounters: Encounter[]; visitors?: Visitor[];
  // 토픽 고유 시스템 갤러리 (거부반응·암호판·붕괴 패러다임·사고·시대·주화·분노 등) — 전시관 서브탭.
  // kind=하위 분류(사고: 염원/영감/구상), usage의 개행은 단계 효과(심화·형성기 등) 줄바꿈.
  mechanics?: { label: string; items: { id: string; name: string; kind?: string; usage?: string | null; desc?: string | null; img?: boolean; iconId?: string; stages?: InvStage[] }[] }[];
};

const rogue1 = rogue1Data as unknown as RogueData;
const NODE_ICONS: Record<string, string[]> = nodeIconData as Record<string, string[]>;
const hasNodeIcon = (topic: string, nodeId: string) => (NODE_ICONS[topic] ?? []).includes(nodeId);
// 현재 활성 토픽 데이터 — RogueGuide 렌더 최상단에서 갱신한다 (모달·applyDiff 등이 참조).
// 자식 컴포넌트는 항상 RogueGuide 렌더 뒤에 동기 렌더되므로 안전하다.
let data = rogue1;
function setActiveData(d: RogueData) { data = d; }

// CN 선행 토픽의 이름 표기 — 중국어 원문이 메인, 한국어 번역이 다음 줄 서브 (사용자 확정 2026-07)
function Nm({ name, cn }: { name: string; cn?: string }) {
  return cn ? <><span lang="zh">{cn}</span><span className="rg-sub">{name}</span></> : <>{name}</>;
}
/** 창 제목(문자열)용 한 줄 이름 — Nm과 같은 규칙(중국어 원문이 대표, 번역이 뒤) */
const nmText = (name: string, cn?: string) => (cn ? `${cn} ${name}` : name);

// 우연한 만남 선택지 노드 — 계단식 트리로 렌더. 선택 → (결과 서사) → 이어지는 하위 선택지.
// cn 병기 룰: 중국어(rogue_6)가 대표, 한국어 번역이 뒤 (Nm과 동일).
function ChoiceNode({ c, link }: { c: EncChoice; link?: (t: string | null) => React.ReactNode }) {
  // link: 보상 텍스트의 「소장품명」을 소장품 상세로 여는 버튼으로 바꾼다 (없으면 그대로 출력)
  const L = link ?? ((t: string | null) => t);
  return (
    <li className="rg-choice">
      <div className="rg-choice-head">
        {c.cn
          ? <><strong lang="zh">{c.cn}</strong><span className="rg-choice-kr">{c.title}</span></>
          : <strong>{c.title}</strong>}
        {c.desc && <span className="rg-choice-desc">{L(c.desc)}</span>}
      </div>
      {/* 라운드마다 반복되는 선택지의 서로 다른 결과(춤 -1/-2/-3 HP·받기 보상 12종)를 자식으로 */}
      {c.variants && c.variants.length > 0 && (
        <ul className="rg-choice-variants">
          {c.variants.map((v, i) => <li key={i}>{L(v)}</li>)}
        </ul>
      )}
      {c.next && (c.next.desc || c.next.choices.length > 0) && (
        <div className="rg-choice-next">
          {c.next.desc && <p className="rg-choice-result">{L(c.next.desc)}</p>}
          {c.next.choices.length > 0 && (
            <ul className="rg-enc-choices nested">
              {c.next.choices.map((cc, i) => <ChoiceNode key={i} c={cc} link={link} />)}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// 우연한 만남 씬 트리 — 게임처럼 선택지를 클릭하면 다음 씬(결과 서사·후속 선택지)이
// 그 자리에서 펼쳐진다 (사용자 지시 2026-08-16). 데이터는 PRTS ISEvent 구조를 게임 id에
// 매칭한 것 (scripts/build-rogue-enc-scenes.py). path로 순환(재도전 루프)을 끊는다.
function SceneChoices({ scenes, idx, path, link }: {
  scenes: EncScene[]; idx: number; path: number[]; link?: (t: string | null) => React.ReactNode;
}) {
  const { t } = useI18n();
  const L = link ?? ((x: string | null) => x);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const sc = scenes[idx];
  if (!sc) return null;
  return (
    <ul className={`rg-enc-choices${idx > 0 || path.length > 1 ? " nested" : ""}`}>
      {sc.choices.map((c, i) => {
        // 안내 블록 — 클릭 불가 정보 행 (랜덤 출현 규칙·주사위 판정·조건 안내)
        if (c.note !== undefined) {
          return (
            <li key={i} className="rg-choice rg-choice-note-row">
              <span className="rg-choice-note">{L(c.note)}</span>
            </li>
          );
        }
        const dest = c.dest;
        const cyclic = dest !== undefined && path.includes(dest);
        const expandable = dest !== undefined && !cyclic;
        const expanded = expandable && open.has(i);
        const head = c.branch !== undefined
          ? <>
              <span className="rg-choice-prob" aria-hidden>▮</span>
              <strong className="rg-choice-branch">{c.branch}</strong>
              {c.prob !== undefined && <span className="rg-choice-prob-pct">{c.prob}%</span>}
            </>
          : c.cn
            ? <><strong lang="zh">{c.cn}</strong><span className="rg-choice-kr">{c.title ?? c.cnTitle}</span></>
            : c.cnTitle
              ? <strong lang="zh">{c.cnTitle}</strong>
              : <strong>{c.title}</strong>;
        const descTxt = c.desc ?? c.cnDesc ?? null;
        return (
          <li key={i} className="rg-choice">
            {expandable ? (
              <button type="button" className="rg-choice-head rg-choice-btn" aria-expanded={expanded}
                onClick={() => setOpen((cur) => { const nx = new Set(cur); if (nx.has(i)) nx.delete(i); else nx.add(i); return nx; })}>
                {head}
                {descTxt && <span className="rg-choice-desc">{L(descTxt)}</span>}
                <span className="rg-choice-caret" aria-hidden>{expanded ? "▾" : "▸"}</span>
              </button>
            ) : (
              <div className="rg-choice-head">
                {head}
                {descTxt && <span className="rg-choice-desc">{L(descTxt)}</span>}
                {cyclic && <span className="rg-choice-loop">{t("↻ 앞의 단계로 돌아갑니다")}</span>}
              </div>
            )}
            {expanded && dest !== undefined && (
              <div className="rg-choice-next">
                {(scenes[dest]?.desc || scenes[dest]?.cn) && (
                  <p className={`rg-choice-result${scenes[dest]?.cn ? " zh" : ""}`}
                    lang={scenes[dest]?.cn ? "zh" : undefined}>
                    {L(scenes[dest]?.desc ?? scenes[dest]?.cn ?? null)}
                  </p>
                )}
                <SceneChoices scenes={scenes} idx={dest} path={[...path, dest]} link={link} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// 모든 록라 공통 6탭. 테마별 고유 시스템(환각/메아리/환경·거부반응·암호판·붕괴·파편·주화 등)은
// 전부 전시관(archive) 안 서브탭으로 들어간다 (사용자 확정 2026-07-18).
type View = "map" | "enemy" | "relic" | "archive" | "diff" | "ending";
// 환각 계열 서브탭의 토픽별 라벨 (전시관 안에서 사용)
const HALLU_LABEL: Record<string, string> = { rogue_1: "환각", rogue_2: "메아리", rogue_6: "환경" };
const viewsFor = (): { id: View; label: string }[] => [
  { id: "map", label: "맵·노드" },
  { id: "enemy", label: "적 도감" },
  { id: "relic", label: "소장품" },
  { id: "archive", label: "전시관" },
  { id: "diff", label: "난이도" },
  { id: "ending", label: "엔딩" },
];

const RANK_KO: Record<string, string> = { NORMAL: "일반", ELITE: "정예", BOSS: "리더" };

// ── 난이도 스탯 적용 ────────────────────────────────────────────────────────
// 수치 규칙 (difficulties.ruleDesc 근거 — 토픽마다 다르다):
// rogue_1 (팬텀 & 크림슨 솔리테어):
//   g5+  : 모든 정예·리더 적 HP ×1.2
//   g10+ : 긴급 작전·험난한 길에서 적 공격력·HP ×1.15
//   g14+ : 정예·리더 등장 후 20초 공격력 ×1.3 / 받는 대미지 -50% (한시 효과 — 별도 표기)
// rogue_6 (침몰자의 블랙플로우):
//   g5+  : 모든 적 최대 HP ×1.3
//   g8+  : 정예·리더 공격력 ×1.15
//   g11+ : 리더가 받는 대미지 -20% (수치 미반영 — 별도 표기)
// 긴급 작전 자체 배율은 레벨 룬(emg — 스테이지마다 다름)으로 별도 적용.
type StatCtx = { emergencyOrBoss?: boolean; emg?: Emg; enemyKey?: string };
function applyDiff(e: Enemy, grade: number, ctx: StatCtx) {
  let hp = e.hp, atk = e.atk, def = e.def;
  if (ctx.emg) {
    const m = ctx.emg.mul ?? {};
    if (m.max_hp) hp *= m.max_hp;
    if (m.atk) atk *= m.atk;
    if (m.def) def *= m.def;
    const a = ctx.emg.add ?? {};
    if (a.max_hp) hp += a.max_hp;
    if (a.atk) atk += a.atk;
    if (a.def) def += a.def;
    // 특정 적 한정 배율 (ebuff_attribute의 enemy 셀렉터)
    if (ctx.enemyKey) {
      for (const p of ctx.emg.per ?? []) {
        if (!p.keys.includes(ctx.enemyKey)) continue;
        if (p.mul.max_hp) hp *= p.mul.max_hp;
        if (p.mul.atk) atk *= p.mul.atk;
        if (p.mul.def) def *= p.mul.def;
      }
    }
  }
  const elite = e.rank === "ELITE" || e.rank === "BOSS";
  const boss = e.rank === "BOSS";
  let res = e.res;
  let burst14 = false, guard = 0; // guard = 피격 대미지 감소 뱃지(%) — 토픽별 규칙
  if (data.id === "rogue_6") {
    if (grade >= 5) hp *= 1.3;
    if (grade >= 8 && elite) atk *= 1.15;
    if (grade >= 11 && boss) guard = 20;
  } else if (data.id === "rogue_2") {
    // g3+/g12+ 마법 저항 +10 · g5+ 리더 공/방 +15% · g11+ 정예·리더 HP +20% · g15 정예·리더 전 스탯 +20%
    if (grade >= 3) res += 10;
    if (grade >= 5 && boss) { atk *= 1.15; def *= 1.15; }
    if (grade >= 11 && elite) hp *= 1.2;
    if (grade >= 12) res += 10;
    if (grade >= 15 && elite) { atk *= 1.2; def *= 1.2; hp *= 1.2; }
  } else if (data.id === "rogue_3") {
    // g4+ 정예 공격 +10% · g5+ 전체 공/HP +5% · g10+ 전체 공격 +10% · g14+ 전체 방/HP +5% · g15 전체 +10%
    if (grade >= 4 && e.rank === "ELITE") atk *= 1.1;
    if (grade >= 5) { atk *= 1.05; hp *= 1.05; }
    if (grade >= 10) atk *= 1.1;
    if (grade >= 14) { def *= 1.05; hp *= 1.05; }
    if (grade >= 15) { atk *= 1.1; def *= 1.1; hp *= 1.1; }
    if (grade >= 11 && boss) guard = 5; // 리더 피격 대미지 -5% (표기만)
  } else if (data.id === "rogue_4") {
    // g4+ 정예·리더 HP +20% · g10+ 정예·리더 피격 대미지 -10% (표기만)
    if (grade >= 4 && elite) hp *= 1.2;
    if (grade >= 10 && elite) guard = 10;
  } else if (data.id === "rogue_5") {
    // g4+ 전체 HP +40% · g8+ 정예·리더 방/HP +20% · g11+ 전체 공격 +20% · g14+ 리더 피격 -20% (표기만)
    if (grade >= 4) hp *= 1.4;
    if (grade >= 8 && elite) { def *= 1.2; hp *= 1.2; }
    if (grade >= 11) atk *= 1.2;
    if (grade >= 14 && boss) guard = 20;
  } else {
    if (grade >= 5 && elite) hp *= 1.2;
    if (grade >= 10 && ctx.emergencyOrBoss) { hp *= 1.15; atk *= 1.15; }
    burst14 = grade >= 14 && elite;
  }
  return { hp: Math.round(hp), atk: Math.round(atk), def: Math.round(def), res, burst14, guard };
}

const fmt = (n: number) => n.toLocaleString("en-US");

function StatRow({ e, grade, ctx }: { e: Enemy; grade: number; ctx: StatCtx }) {
  const { t } = useI18n();
  const s = applyDiff(e, grade, ctx);
  const up = (v: number, b: number) => v !== Math.round(b);
  return (
    <div className="rg-stats" role="group">
      <span className={up(s.hp, e.hp) ? "rg-stat up" : "rg-stat"} title={t("최대 HP")}>HP {fmt(s.hp)}</span>
      <span className={up(s.atk, e.atk) ? "rg-stat up" : "rg-stat"} title={t("공격력")}>{t("공격")} {fmt(s.atk)}</span>
      <span className={up(s.def, e.def) ? "rg-stat up" : "rg-stat"} title={t("방어력")}>{t("방어")} {fmt(s.def)}</span>
      <span className="rg-stat" title={t("마법 저항")}>{t("마저")} {s.res}</span>
      {s.burst14 && <span className="rg-stat g14" title={t("난이도 14 이상: 정예·리더가 등장 후 20초간 공격력 +30%, 받는 물리·마법 대미지 -50%")}>{t("등장 20초")} {t("공격")} {fmt(Math.round(s.atk * 1.3))}</span>}
      {s.guard > 0 && <span className="rg-stat g14" title={t("고난이도에서 이 적이 받는 물리·마법 대미지가 감소합니다")}>{t("받는 대미지")} -{s.guard}%</span>}
    </div>
  );
}

// ── 스테이지 상세 모달 — 일반/긴급이 같은 맵을 공유하므로 페어로 받아 탭 전환 ──
export type StagePair = { n: Stage; e?: Stage; init?: "n" | "e" };   // init — 렌즈가 긴급 화면을 인식하면 "e"
function StageModal({ pair, grade, onClose, onOpenEnemy }: {
  pair: StagePair; grade: number; onClose: () => void; onOpenEnemy: (key: string, ctx: StatCtx) => void;
}) {
  // 겹쳐 뜰 때의 앞뒤는 공용 창(ModalWindow)의 z 카운터가 맡는다 — 종전엔 stack 플래그로
  // 백드롭 z를 80↔90으로 올렸다 (2026-08-24 공통 모달 이관).
  const { t } = useI18n();
  const [mode, setMode] = useState<"n" | "e">(pair.init === "e" && pair.e ? "e" : "n");
  const [mapZoom, setMapZoom] = useState(false); // 미리보기 클릭 → 2배 확대, 축소는 아무 곳이나 클릭
  // 실사 도면 / 이동 경로 탭 — 작전 도감 상세와 같은 짜임 (사용자 지시 2026-08-10
  // "모든 로그라이크 작전 노드에도 다 동일하게 적용"). 규칙: .claude/skills/route-map-rules.
  const [mapView, setMapView] = useState<"map" | "route">("map");
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
  const [, bumpRoutes] = useState(0);   // 지연 로드 완료 시 리렌더용
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (!mapZoom) return;
    // 캡처 단계에서 가로채 모달 닫힘·적 상세 열림 등 다른 클릭 동작을 막고 축소만 한다
    const onAnyClick = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); setMapZoom(false); };
    document.addEventListener("click", onAnyClick, true);
    return () => document.removeEventListener("click", onAnyClick, true);
  }, [mapZoom]);
  const stage = mode === "e" && pair.e ? pair.e : pair.n;
  const isEmg = stage.kind === "emergency";
  const isBoss = stage.kind === "boss";
  const ctx: StatCtx = { emergencyOrBoss: isEmg || isBoss, emg: isEmg ? stage.emg : null };
  const mul = stage.emg?.mul ?? {};
  // 경로 모드 공용 — 적 셀(고정 토글·선 색)과 지도 양쪽이 쓴다. 일반/긴급은 같은 레벨을
  // 공유하므로(별칭) 모드를 바꿔도 경로는 같다. 적↔경로 연결 키는 **교체 전 원본**
  // se.key다 (긴급 교체 룬은 표시만 변종으로 바꾸고 스폰 경로는 그대로).
  const rd = mapView === "route" ? routesFor(stage.id) : undefined;
  const sorted = [...stage.enemies].sort((a, b) => {
    const rankOrder = (k: string) => isSpecialLast(k)
      ? 3 : ({ BOSS: 0, ELITE: 1 }[data.enemies[k]?.rank ?? ""] ?? 2);
    return rankOrder(a.key) - rankOrder(b.key);
  });
  const routeOrder = rd ? sorted.filter((se) => rd.e[se.key]?.length).map((se) => se.key) : [];
  const togglePin = (id: string) => setPinned((curSet) => {
    const next = new Set(curSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <ModalWindow label={nmText(stage.name, stage.cn)} className="rg-modal" onClose={onClose}>
      <header className="rg-modal-head">
        <div>
          <span className={`rg-kind k-${stage.kind}`}>{t(KIND_LABEL[stage.kind] ?? stage.kind)}</span>
          <h3><NodeIco id={KIND_NODE[stage.kind]} cls="rg-modal-ico" /><span className="rg-modal-title"><Nm name={stage.name} cn={stage.cn} /></span></h3>
          {stage.zone != null && <span className="rg-modal-zone">{t("{n}층", { n: stage.zone })}</span>}
        </div>
        {/* 일반/긴급 탭은 모달 오른쪽 위 — 작전 도감의 환경 탭과 같은 자리 (사용자 지시 2026-08-10) */}
        {pair.e && (
          <div className="rg-modal-modes in-head" role="tablist" aria-label={t("작전 모드")}>
            <button type="button" role="tab" aria-selected={mode === "n"} className={mode === "n" ? "on" : ""} onClick={() => setMode("n")}>{t("일반 작전")}</button>
            <button type="button" role="tab" aria-selected={mode === "e"} className={`emg${mode === "e" ? " on" : ""}`} onClick={() => setMode("e")}>{t("긴급 작전")}</button>
          </div>
        )}
      </header>
      <div className="rg-modal-cols">
        <div className="rg-modal-left">
          {stage.map && (
            <div className="rg-modal-modes rg-maptabs" role="tablist" aria-label={t("도면 보기")}>
              <button type="button" role="tab" aria-selected={mapView === "map"}
                className={mapView === "map" ? "on" : ""} onClick={() => setMapView("map")}>{t("실사 도면")}</button>
              <button type="button" role="tab" aria-selected={mapView === "route"}
                className={mapView === "route" ? "on" : ""}
                onClick={() => {
                  setMapView("route");
                  if (!ROUTES_CACHE) loadRogueRoutes().then(() => bumpRoutes((k) => k + 1)).catch(() => { ROUTES_LOADING = null; bumpRoutes((k) => k + 1); });
                }}>{t("이동 경로")}{isNewFeature("route-map") && <span className="new-badge">{t("새기능")}</span>}</button>
            </div>
          )}
          {mapView === "route" ? (rd ? (
            // 호버 중이면 그 적만, 아니면 고정된 적들의 합집합 — 고정 조작은 오른쪽
            // 적 셀이 맡는다 (셀 클릭 = 고정, 셀 속 섬네일 클릭 = 적 상세 모달)
            <StageRouteMap data={rd} order={routeOrder}
              highlights={hover ? [hover] : pinned.size ? [...pinned] : null}
              imgOf={(k2) => { const e2 = data.enemies[k2]; return e2?.img ? asset(`/rogue/enemy/${e2.img}.webp`) : undefined; }}
              nameOf={(k2) => data.enemies[k2]?.name}
              onPick={togglePin} />
          ) : (
            <p className="rg-modal-desc">{ROUTES_CACHE ? t("이 작전은 경로 데이터가 없습니다.") : t("경로 데이터를 불러오는 중…")}</p>
          )) : stage.map && (
            <button type="button" className={`rg-map-zoom${mapZoom ? " zoom" : ""}`}
              onClick={() => setMapZoom((z) => !z)}
              title={mapZoom ? t("아무 곳이나 클릭하면 원래 크기로 돌아갑니다") : t("클릭하면 2배로 확대됩니다")}>
              <img className="rg-modal-map" src={asset(`/rogue/map/${stage.map}.webp`)} alt={t("전장 미니맵")} loading="lazy" decoding="async" />
            </button>
          )}
          {stage.desc && <p className="rg-modal-desc">{stage.desc}</p>}
          {stage.eliteDesc && <p className="rg-modal-elite">⚠ {stage.eliteDesc}</p>}
          {isEmg && (mul.atk || mul.max_hp || mul.def) && (
            <p className="rg-modal-elite">
              {t("긴급 배율")}: {mul.atk ? `${t("공격")} ×${mul.atk} ` : ""}{mul.def ? `${t("방어")} ×${mul.def} ` : ""}{mul.max_hp ? `HP ×${mul.max_hp}` : ""}
            </p>
          )}
          {isEmg && (stage.emg?.per ?? []).map((p, i) => (
            <p key={i} className="rg-modal-elite">
              {t("특정 적 강화")} ({p.keys.map((k) => data.enemies[k]?.name ?? k).join(", ")}):
              {p.mul.atk ? ` ${t("공격")} ×${p.mul.atk}` : ""}{p.mul.def ? ` ${t("방어")} ×${p.mul.def}` : ""}{p.mul.max_hp ? ` HP ×${p.mul.max_hp}` : ""}
            </p>
          ))}
          {isEmg && stage.emg?.replace && Object.keys(stage.emg.replace).length > 0 && (
            <p className="rg-modal-elite">
              {t("긴급 시 적 교체")}: {Object.entries(stage.emg.replace).map(([f, to]) =>
                `${data.enemies[f]?.name ?? f} → ${data.enemies[to]?.name ?? to}`).join(" · ")}
            </p>
          )}
        </div>
        <div className="rg-modal-enemies">
        {/* 리더 → 정예 → 일반 → 공통 특수몹 순으로 정렬 (사용자 확정 2026-07-18).
            전 테마 공통 특수몹은 데이터에 판별 플래그가 없어 이름 하드코딩 */}
        {sorted.map((se) => {
          // 긴급 모드에선 교체 룬(level_enemy_replace)이 적용된 변종으로 표시
          const key = isEmg ? (stage.emg?.replace?.[se.key] ?? se.key) : se.key;
          const e = data.enemies[key];
          if (!e) return null;
          // 경로 모드 (작전 도감과 동일 조작): 셀 클릭 = 경로 고정 토글, 호버 = 그 적만
          // 강조, **섬네일 클릭 = 항상 적 상세 모달** (stopPropagation으로 고정과 분리)
          const pinColor = rd && rd.e[se.key]?.length ? enemyRouteColor(routeOrder, se.key) : undefined;
          const routeMode = !!rd && !!pinColor;
          return (
            <button type="button" key={se.key}
              className={`rg-enemy-cell${pinned.has(se.key) ? " pinned" : ""}${routeMode ? " has-route" : ""}`}
              style={pinColor ? ({ "--rc": pinColor } as React.CSSProperties) : undefined}
              onMouseEnter={rd ? () => setHover(se.key) : undefined}
              onMouseLeave={rd ? () => setHover(null) : undefined}
              onClick={() => { if (routeMode) togglePin(se.key); else onOpenEnemy(key, { ...ctx, enemyKey: key }); }}>
              {e.img ? <img className="rg-enemy-face" src={asset(`/rogue/enemy/${e.img}.webp`)} alt="" aria-hidden width={158} height={158} loading="lazy" decoding="async"
                onClick={(ev) => {
                  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
                  ev.stopPropagation(); onOpenEnemy(key, { ...ctx, enemyKey: key });
                }} />
                : <span className="rg-enemy-face none" aria-hidden>?</span>}
              <span className="rg-enemy-cell-head">
                <span className={`rg-rank r-${e.rank ?? "NORMAL"}`}>{t(RANK_KO[e.rank ?? ""] ?? "일반")}</span>
                {se.cnt > 0 && <span className="rg-enemy-cnt">×{se.cnt}</span>}
              </span>
              <span className="rg-enemy-name"><Nm name={e.name} cn={e.cn} /></span>
              <StatRow e={e} grade={grade} ctx={{ ...ctx, enemyKey: key }} />
            </button>
          );
        })}
        </div>
      </div>
    </ModalWindow>
  );
}

// 전 테마 공통으로 등장하는 특수(길가) 몹 — 전투 노드 적 목록에서 맨 밑으로 (사용자 확정 2026-07-18).
// ⚠ 이름이 아니라 적 id(변종 _N 제거한 베이스)로 판별 — EN/JA 데이터에선 이름이 현지어라 이름 매칭이 깨진다
// (고프닉·덕로드·동글이·눈물 흘리는 사내·상자 넝쿨·'게이트'·'창문'·시대의 흔적·진기한 장치·탐사용 자율차)
const SPECIAL_LAST_IDS = new Set(["enemy_2002_bearmi", "enemy_2001_duckmi", "enemy_2085_skzjxd", "enemy_2034_sythef",
  "enemy_2059_smbox", "enemy_2067_skzcy", "enemy_2091_skzgds", "enemy_2086_skzdwx", "enemy_2069_skzbox", "enemy_2062_smcar"]);
const isSpecialLast = (key: string) => SPECIAL_LAST_IDS.has(key.replace(/_\d+$/, ""));

// 전투 노드 kind → 노드 타입 ID. 상세 모달 머리에 지도 글리프를 같이 띄우기 위한 것
// (제보 2026-07-29 "노드 상세 모달에도 노드 아이콘을 표시해 달라").
// 조우 전투(event/incident)는 '우연한 만남'에서 이어지는 전투라 INCIDENT 글리프를 쓴다.
// 매핑이 없는 kind(특수·시련 등)는 아이콘 없이 배지만 나온다.
const KIND_NODE: Record<string, string> = {
  normal: "BATTLE_NORMAL", emergency: "BATTLE_ELITE", boss: "BATTLE_BOSS",
  event: "INCIDENT", incident: "INCIDENT", duel: "DUEL", savage: "BATTLE_SAVAGE",
};

// 노드 종류별 색 — 게임 지도는 같은 글리프에 **타입마다 다른 색**을 입힌다(런타임 틴트).
// 붉은 긴급 작전·초록 험난한 길의 끝처럼 색 자체가 종류 구분 신호라, 클라 스프라이트가
// 전부 청록 한 벌인 것을 여기서 같은 방식으로 돌린다 (사용자 제공 게임 화면 대조 2026-07-29).
// 화면에서 색을 확인한 타입만 넣는다 — 확인 못 한 타입은 기본 청록 그대로.
const NODE_TINT: Record<string, string> = {
  BATTLE_NORMAL: "nt-purple",   // 作战 — 보라
  BATTLE_ELITE: "nt-red",       // 紧急作战 — 붉은 노드
  FINAL: "nt-green",            // 险路尽头 — 초록
  SCRAP_SHOP: "nt-gold",        // 秘境行商 — 금빛
  EVACUATE: "nt-gold",          // 险路小径 — 금빛
  PORTAL: "nt-gold",            // 误入奇境(원더랜드) — 금빛
};
// 화면에서 확인한 나머지: 不期而遇(INCIDENT)·诡意行商(BATTLE_SHOP)·曲折密道(DOOR)는
// 기본 청록 그대로다. 그 외 타입은 지도 화면을 못 봐서 손대지 않는다.

/** 노드 종류 글리프 — 이 테마에 그 타입 아이콘이 있을 때만 그린다 */
function NodeIco({ id, cls = "rg-nodetype-ico" }: { id?: string | null; cls?: string }) {
  if (!id || !hasNodeIcon(data.id, id)) return null;
  const tint = NODE_TINT[id];
  // ?v=2 — 트리밍 전 이미지가 CDN 엣지에 남아 몇 시간째 옛 그림이 나오던 것을 끊는다
  return <img className={`${cls}${tint ? ` ${tint}` : ""}`} src={asset(`/rogue/node/${data.id}/${id}.webp?v=2`)}
    alt="" width={160} height={160} loading="lazy" decoding="async" />;
}

const KIND_LABEL: Record<string, string> = {
  normal: "작전", emergency: "긴급 작전", boss: "험난한 길", event: "조우 전투", special: "특수",
  duel: "외나무다리", trial: "시련", chase: "추격전", savage: "거점전", incident: "조우 전투",
};

// 전투 노드 카드 — 인게임 맵 미리보기 + 이름 (클릭 → 상세, 일반/긴급은 모달 탭 전환)
function StageCard({ pair, onOpen, boss }: { pair: StagePair; onOpen: (p: StagePair) => void; boss?: boolean }) {
  const s = pair.n;
  return (
    <button type="button" className={`rg-stagecard${boss ? " boss" : ""}`} onClick={() => onOpen(pair)}>
      {s.map && <img className="rg-stagecard-map" src={asset(`/rogue/map/${s.map}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
      <span className="rg-stagecard-name"><Nm name={s.name} cn={s.cn} /></span>
    </button>
  );
}

// ── 적 상세 모달 — 도감 카드·스테이지 모달의 적 행에서 연다 (스테이지 모달 위에 스택) ──
function EnemyModal({ ekey, grade, ctx, onClose, onOpenStage, appear }: {
  ekey: string; grade: number; ctx: StatCtx; onClose: () => void;
  onOpenStage: (s: Stage) => void; appear: Stage[];
}) {
  const { t } = useI18n();
  const e = data.enemies[ekey];
  if (!e) return null;
  return (
    <ModalWindow label={nmText(e.name, e.cn)} className="rg-modal rg-emodal" onClose={onClose}>
      <header className="rg-modal-head">
        <div>
          <span className={`rg-rank r-${e.rank ?? "NORMAL"}`}>{t(RANK_KO[e.rank ?? ""] ?? "일반")}</span>
          <h3><Nm name={e.name} cn={e.cn} /></h3>
          {e.index && <span className="rg-modal-zone">{e.index}</span>}
        </div>
      </header>
      {/* 초상은 원본 해상도(158px) 그대로 크게 — 작은 헤더 아이콘 대신 (피드백 반영 2026-07-18) */}
      <div className="rg-emodal-cols">
        {e.img ? <img className="rg-emodal-portrait" src={asset(`/rogue/enemy/${e.img}.webp`)} alt="" aria-hidden width={158} height={158} loading="lazy" decoding="async" />
          : <span className="rg-emodal-portrait none" aria-hidden>?</span>}
        <div className="rg-emodal-main">
          {e.attack && <p className="rg-emodal-row"><strong>{t("공격 방식")}</strong> {e.attack}</p>}
          {e.desc && <p className="rg-emodal-desc">{e.desc}</p>}
          {e.ability && <p className="rg-emodal-ability">{e.ability}</p>}
          {e.immune && e.immune.length > 0 && (
            <p className="rg-emodal-immune"><strong>{t("상태이상 면역")}</strong>
              {e.immune.map((im) => <span key={im} className="rg-immune-chip">{t(im)}</span>)}
            </p>
          )}
        </div>
      </div>
      {/* 연 곳(노드 상세/도감)의 배율 컨텍스트를 그대로 물려받아 표시 — 수치 불일치 방지 */}
      {ctx.emg && <p className="rg-ctx-note">{t("긴급 작전 배율이 반영된 수치입니다.")}</p>}
      {!ctx.emg && ctx.emergencyOrBoss && grade >= 10 && <p className="rg-ctx-note">{t("난이도 10 이상 험난한 길·긴급 작전 배율(공격·HP ×1.15)이 반영된 수치입니다.")}</p>}
      <StatRow e={e} grade={grade} ctx={{ ...ctx, enemyKey: ekey }} />
      <div className="rg-stats sub">
        <span className="rg-stat">{t("공속")} {e.aspd}</span>
        <span className="rg-stat">{t("이속")} {e.ms}</span>
        <span className="rg-stat">{t("무게")} {e.weight}</span>
        <span className="rg-stat">{t("침투 피해")} {e.lifePoint}</span>
      </div>
      {appear.length > 0 && (
        <div className="rg-appear">
          <strong>{t("등장 노드")}</strong>
          <div className="rg-chips">
            {appear.map((s) => (
              <button key={s.id} type="button" className={`rg-chip${s.kind === "boss" ? " boss" : ""}`}
                onClick={() => onOpenStage(s)}>
                {s.zone != null ? `${s.zone}F ` : ""}<Nm name={s.name} cn={s.cn} />
              </button>
            ))}
          </div>
        </div>
      )}
    </ModalWindow>
  );
}

// ── 기록 원문 모달 — 엔딩북 조각·방문객 장면의 스토리 전문 (사용자 요청 2026-08-17
// "하나씩 볼 수 있게"). /rogue/record/<rid>.json 을 열 때 지연 로드, 현재 로케일 텍스트
// 우선(없으면 ko → cn 폴백 — IS6은 cn뿐이라 중국어 원문 표시). ────────────────
function RecordModal({ rid, title, sub, onClose }: { rid: string; title: string; sub?: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [paras, setParas] = useState<string[] | null>(null);
  const [zh, setZh] = useState(false);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(asset(`/rogue/record/${rid}.json`))
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: Record<string, string[]>) => {
        if (!alive) return;
        const pick = d[locale] ?? d.ko ?? d.cn ?? d.en;
        if (pick) { setZh(!d[locale] && !d.ko); setParas(pick); } else setErr(true);
      })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [rid, locale]);
  return (
    <ModalWindow label={title} className="rg-modal rg-recmodal" onClose={onClose}>
      <header className="rg-modal-head">
        <div>
          <span className="rg-kind">{t("기록")}</span>
          <h3><span className="rg-modal-title">{title}</span></h3>
          {sub && <span className="rg-modal-zone">{sub}</span>}
        </div>
      </header>
      <div className="rg-rec-body" lang={zh ? "zh" : undefined}>
        {err ? <p className="rg-rec-status">{t("기록을 불러오지 못했습니다.")}</p>
          : paras === null ? <p className="rg-rec-status">{t("기록 불러오는 중…")}</p>
            : paras.map((p, i) => <p key={i}>{p}</p>)}
      </div>
    </ModalWindow>
  );
}

// ── 조우 상세 모달 — 엔딩 조건 등에서 조우를 참조할 때 연다 ──────────────────
function EncounterModal({ enc, onClose, link, battles, onOpenStage }: {
  enc: Encounter; onClose: () => void; link?: (t: string | null) => React.ReactNode;
  battles?: StagePair[]; onOpenStage?: (p: StagePair) => void;
}) {
  // battlesRandom: 전투 선택지는 있지만 고정 맵이 없는 조우 — '힘든 전투 직면' 류는
  // 그 층의 일반 전투 맵에서 무작위로 벌어진다 (사용자 지시 2026-08-16 "랜덤전투라고 적어줘")
  const { t } = useI18n();
  return (
    <ModalWindow label={nmText(enc.title, enc.cn)} className="rg-modal" onClose={onClose}>
      <header className="rg-modal-head">
        <div>
          <span className="rg-kind">{t("우연한 만남")}</span>
          <h3><NodeIco id="INCIDENT" cls="rg-modal-ico" /><span className="rg-modal-title"><Nm name={enc.title} cn={enc.cn} /></span></h3>
          {enc.floors && <span className="rg-modal-zone">{enc.floors.join("·")}{t("층")}</span>}
        </div>
      </header>
      <div className="rg-modal-cols enc">
        <div className="rg-modal-left">
          {enc.bg && <img className="rg-enc-cg modal" src={asset(`/rogue/scene/${enc.bg}.webp`)} alt={enc.title} loading="lazy" decoding="async" />}
        </div>
        <div className="rg-enc-body">
          {enc.desc && <p className="rg-modal-desc">{enc.desc}</p>}
          {enc.note && <p className="rg-enc-note">{enc.note}</p>}
          {/* 씬 트리(PRTS 매칭)가 있으면 게임처럼 클릭해 다음 씬을 펼치는 렌더,
              없으면 기존 평탄 트리. rogue_6은 게임 버튼이 중국어라 원문을 대표로 병기. */}
          {enc.scenes ? (
            <SceneChoices scenes={enc.scenes} idx={0} path={[0]} link={link} />
          ) : (
            <ul className="rg-enc-choices">
              {enc.choices.map((c, i) => <ChoiceNode key={i} c={c} link={link} />)}
            </ul>
          )}
          {/* 이 조우에서 전투가 벌어지면 그 맵을 바로 열 수 있게 (사용자 요청 2026-08-16).
              게임 데이터에 조우↔전투 링크가 없어 수작업 대응표로만 붙는다 — 없으면 안 그린다. */}
          {battles && battles.length > 0 && onOpenStage ? (
            <div className="rg-enc-battles">
              <strong>{t("이 만남의 전투")}</strong>
              <div className="rg-stage-cards">
                {battles.map((p) => <StageCard key={p.n.id} pair={p} onOpen={onOpenStage} />)}
              </div>
            </div>
          ) : enc.battlesRandom ? (
            <div className="rg-enc-battles">
              <strong>{t("이 만남의 전투")}</strong>
              <p className="rg-enc-battles-random">{t("랜덤 전투 — 고정된 전투 맵 없이, 현재 층의 일반 전투 맵 중 하나에서 벌어집니다.")}</p>
            </div>
          ) : null}
        </div>
      </div>
    </ModalWindow>
  );
}

// ── 아이템 상세 모달 — 소장품·부품·사고·주화 공용 (부품·자원도 소장품처럼 상세를 연다,
// 피드백 반영 2026-07-24). owned/onToggleOwn이 오면 보유 리스트 토글 버튼을 붙인다.
function RelicModal({ relic, owned, onToggleOwn, onClose }: {
  relic: InvItem; owned?: boolean; onToggleOwn?: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <ModalWindow label={nmText(relic.name, relic.cn)} className="rg-modal rg-rmodal" onClose={onClose}>
      <header className="rg-modal-head">
        <div>
          {relic.img && <img className="rg-relic-icon lg" src={asset(`/rogue/relic/${relic.iconId ?? relic.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
          {relic.order && <span className="rg-relic-no">{relic.order}</span>}
          <h3><Nm name={relic.name} cn={relic.cn} /></h3>
          {(relic.kind || relic.typeName) && <span className="rg-modal-zone">{t((relic.kind ?? relic.typeName)!)}</span>}
        </div>
      </header>
      {/* 해당 소장품의 모든 데이터 — 효과·설명·획득 방법 (사용자 확정 2026-07-24).
          다단계(stages, 붕괴 패러다임)는 단계별 [섬네일+이름+효과+플레이버] 블록으로 */}
      {relic.stages ? relic.stages.map((s) => (
        <div key={s.name} className="rg-stage rg-stage-modal">
          {relic.img && <img className="rg-relic-icon" src={asset(`/rogue/relic/${relic.iconId ?? relic.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
          <div className="rg-stage-txt">
            <h4>{s.name} <em className="rg-stage-lb">{s.label}</em></h4>
            {s.usage && <p className="rg-relic-usage rg-multiline">{s.usage}</p>}
            {s.desc && <p className="rg-relic-desc rg-multiline">{s.desc}</p>}
          </div>
        </div>
      )) : (<>
        {relic.usage && <p className="rg-relic-usage rg-multiline">{relic.usage}</p>}
        {relic.desc && <p className="rg-relic-desc rg-multiline">{relic.desc}</p>}
      </>)}
      {relic.obtain && <p className="rg-relic-obtain"><em>{t("획득 방법")}</em> {relic.obtain}</p>}
      {onToggleOwn && (
        <button type="button" className={`rg-inv-toggle${owned ? " on" : ""}`} onClick={onToggleOwn}>
          {owned ? `✓ ${t("보유중 — 누르면 보유 리스트에서 뺍니다")}` : `🎒 ${t("보유 리스트에 추가")}`}
        </button>
      )}
    </ModalWindow>
  );
}

// 카드 우상단 보유 토글 — 소장품 목록·전시관 자원·모아보기·보유 리스트 카드 공용
// (피드백 반영 2026-07-24). 카드 자체 클릭(상세 열기)과 겹치지 않게 전파를 끊는다.
function InvPill({ owned, onToggle }: { owned: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className={`rg-inv-btn${owned ? " on" : ""}`}
      title={owned ? t("보유 리스트에서 제거") : t("보유 리스트에 추가")}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => e.stopPropagation()}>
      {owned ? t("✓ 보유중") : t("＋ 보유")}
    </button>
  );
}

// ── 보유 소장품 효과 총합 (사용자 요청 2026-07-29) ───────────────────────────
// 담아둔 소장품의 수치 효과를 더해 보유 리스트 맨 위에 보여준다. 수치는 usage 문장이
// 아니라 게임 데이터 blackboard에서 뽑은 eff 배열이라 EN/JA에서도 그대로 계산된다.
//
// ⚠ 전부 더할 수 있는 게 아니다 — 실측상 수치 효과를 가진 소장품은 40% 남짓이고,
// 나머지는 "스킬 발동 시", "특정 지형에서" 같은 조건부·고유 효과라 애초에 합이 없다.
// 그래서 못 더한 개수를 감추지 않고 함께 적는다.
// 표시 묶음 — 아군 / 적군 / 판 수치. 섞어 놓으면 '공격력'이 누구 것인지 알 수 없다.
const EFF_ALLY = ["atk", "burst", "hp", "def", "aspd", "res", "ev_phy", "ev_mag", "cost", "block", "respawn", "regen", "regen_pct", "pen", "heal", "sp_born", "sp_regen"];
const EFF_ENEMY = ["e_atk", "e_hp", "e_def", "e_aspd", "e_ms", "dmg_phy", "dmg_mag", "dmg_pure"];
const EFF_FIELD = ["deploy", "initcost", "costlimit", "exp_up", "gold_up"];
const EFF_ORDER = [...EFF_ALLY, ...EFF_ENEMY, ...EFF_FIELD];
const EFF_LABEL: Record<string, string> = {
  atk: "공격력", hp: "HP", def: "방어력", aspd: "공격 속도", res: "마법 저항",
  cost: "배치 코스트", block: "저지 가능 수", respawn: "재배치 시간",
  regen: "초당 HP 회복", regen_pct: "초당 HP 회복(최대 HP 비례)", pen: "방어 관통",
  burst: "강타", ev_phy: "물리 회피", ev_mag: "마법 회피",
  heal: "받는 치료·회복 효과", sp_born: "초기 SP", sp_regen: "자연 회복 SP",
  e_atk: "적 공격력", e_hp: "적 HP", e_def: "적 방어력", e_aspd: "적 공격 속도",
  e_ms: "적 이동 속도", dmg_phy: "적이 받는 물리 대미지", dmg_mag: "적이 받는 마법 대미지",
  dmg_pure: "적이 받는 트루 대미지",
  deploy: "배치 가능 인원수", initcost: "초기 코스트", costlimit: "코스트 상한",
  exp_up: "전투 획득 경험치", gold_up: "전투 획득 오리지늄각뿔",
};
// 줄여 쓴 라벨의 본뜻 — 알약에 title로 붙인다 (사용자 지시 2026-07-29: 긴 문구는 '강타'로 줄이되
// 무슨 뜻인지는 알 수 있어야 한다)
const EFF_HINT: Record<string, string> = {
  burst: "스킬 발동 후 1초간 공격력",
  regen_pct: "최대 HP 비례 초당 회복",
};
// 즉시 획득분 — 배율이 아니라 '누계로 얼마를 받았나'
const GET_ORDER = ["squad", "life", "lifemax", "hope", "shield", "gold"];
const GET_LABEL: Record<string, string> = {
  squad: "편성 가능 인원수", life: "목표 HP", lifemax: "최대 목표 HP",
  hope: "희망", shield: "실드", gold: "오리지늄각뿔",
};
const SEL_LABEL: Record<string, string> = {
  melee: "근접", ranged: "원거리", token: "소환물",
  warrior: "가드", sniper: "스나이퍼", tank: "디펜더", medic: "메딕",
  support: "서포터", caster: "캐스터", special: "스페셜리스트", pioneer: "뱅가드",
};
// scale은 1이 기준인 배율(1.35 = +35%)이라 더하지 않고 **곱한다** — 데이터의
// global_buff_stack_base_one이 그렇게 겹친다. 초기값이 0이 아니라 1인 이유.
// pct/flat 플래그가 따로 있는 이유: 합이 정확히 0이어도(예: 경험치 +20%+30%-50%) 값을
// 지우지 않고 "0%"로 보여줘야 한다. 0을 falsy로 걸러 냈다가 라벨만 남고 숫자가 사라졌다.
type EffSum = { mul: number; add: number; scale: number; pct: boolean; flat: boolean };
const emptySum = (): EffSum => ({ mul: 0, add: 0, scale: 1, pct: false, flat: false });

/** 보유 항목 → 조건별 스탯 합·즉시 획득 합·수치화 못 한 개수 */
function sumEffects(items: { eff?: Eff[] }[]) {
  const stats = new Map<string, Map<string, EffSum>>();   // sel("" = 전체) → 스탯 → 합
  const got = new Map<string, number>();
  let plain = 0;                                          // 수치 효과가 없는 소장품 수
  for (const it of items) {
    if (!it.eff?.length) { plain += 1; continue; }
    for (const e of it.eff) {
      if (e.m === "get") { got.set(e.k, (got.get(e.k) ?? 0) + e.v); continue; }
      const sel = e.sel ?? "";
      let bucket = stats.get(sel);
      if (!bucket) { bucket = new Map(); stats.set(sel, bucket); }
      const cur = bucket.get(e.k) ?? emptySum();
      if (e.m === "scale") { cur.scale *= e.v; cur.pct = true; }
      else if (e.m === "mul") { cur.mul += e.v; cur.pct = true; }
      else { cur.add += e.v; cur.flat = true; }
      bucket.set(e.k, cur);
    }
  }
  return { stats, got, plain };
}

// 배율은 소수(0.35)로 들어오므로 %로, 가산은 그대로. 부호는 데이터가 가진 걸 그대로 쓴다
// (재배치 시간 -25%, 적 공격력 -12% 같은 감소 효과가 있다).
const signed = (v: number, pct: boolean) => {
  const n = pct ? v * 100 : v;
  const s = Math.round(n * 100) / 100;
  return `${s > 0 ? "+" : ""}${s}${pct ? "%" : ""}`;
};
/**
 * 한 스탯의 합을 사람이 읽는 한 줄로.
 *
 * 백분율은 **덧셈분과 곱배율분을 하나로 합쳐** 낸다: (1+mul)×scale − 1.
 * 예전엔 "적 공격력 -7% +25%"처럼 두 수를 나란히 찍어 순값을 알 수 없었다.
 * 같은 종류끼리는 더하고(게임 표기 그대로), 성격이 다른 곱배율은 곱해서 한 번에 반영한다.
 * 가산(마법 저항 +15, 초기 SP +32)은 단위가 달라 백분율과 나란히 둔다.
 */
const sumText = (s: EffSum) => {
  const parts: string[] = [];
  if (s.pct) parts.push(signed((1 + s.mul) * s.scale - 1, true));
  if (s.flat) parts.push(signed(s.add, false));
  return parts.join(" ");
};

// 효과 총합 모달 — 보유 리스트의 「Σ 효과 총합」 버튼으로 연다 (사용자 지시 2026-07-29:
// 목록 안에 붙박이로 두지 말고 버튼→모달로). 떠 있는 보유 창(z-150)보다 위에 뜬다.
function EffectTotals({ items, label, onClose }: { items: { eff?: Eff[] }[]; label: string; onClose: () => void }) {
  const { t } = useI18n();
  const { stats, got, plain } = useMemo(() => sumEffects(items), [items]);
  const global = stats.get("") ?? new Map<string, EffSum>();
  // 조건부는 대상 이름 순으로 — 근접/원거리 먼저, 그다음 직업
  const conds = [...stats.entries()].filter(([sel]) => sel).sort((a, b) => a[0].localeCompare(b[0]));
  const selName = (sel: string) => sel.split("+").map((s) => t(SEL_LABEL[s] ?? s)).join(" · ");
  const chip = (k: string, sum: EffSum) => (
    <li key={k} title={EFF_HINT[k] ? t(EFF_HINT[k]) : undefined}>
      <span>{t(EFF_LABEL[k] ?? k)}</span><b>{sumText(sum)}</b>
    </li>
  );
  // 아군/적군/판 수치를 나눠 낸다 — 섞으면 '공격력'이 누구 것인지 알 수 없다
  const group = (keys: string[], title: string) => {
    const hit = keys.filter((k) => global.has(k));
    if (!hit.length) return null;
    return (
      <div className="rg-efftot-grp" key={title}>
        <h5>{t(title)}</h5>
        <ul className="rg-efftot-row">{hit.map((k) => chip(k, global.get(k)!))}</ul>
      </div>
    );
  };
  const nothing = !global.size && !conds.length && !got.size;
  return (
    <ModalWindow label={`Σ ${t("효과 총합")}`} className="rg-modal rg-effmodal" onClose={onClose}>
      <header className="rg-modal-head">
        <div>
          <h3>Σ {t("효과 총합")}</h3>
          {/* 몇 개를 더했는지 밝힌다 — 조건부·고유 효과는 합이 없으므로 감추면 거짓말이 된다 */}
          <span className="rg-modal-zone">{t("{n}개 중 {m}개 합산", { n: items.length, m: items.length - plain })}</span>
        </div>
      </header>
      {nothing ? (
        <p className="rg-efftot-none">{t("담아둔 항목에는 더할 수 있는 수치 효과가 없습니다 — 조건부·고유 효과뿐입니다.")}</p>
      ) : (
        <>
          {group(EFF_ALLY, "아군")}
          {group(EFF_ENEMY, "적군")}
          {group(EFF_FIELD, "판 수치")}
          {conds.length > 0 && (
            <div className="rg-efftot-grp">
              <h5>{t("조건부")}</h5>
              {conds.map(([sel, m]) => (
                <ul className="rg-efftot-row cond" key={sel}>
                  <li className="rg-efftot-sel">{selName(sel)}</li>
                  {EFF_ORDER.filter((k) => m.has(k)).map((k) => chip(k, m.get(k)!))}
                </ul>
              ))}
            </div>
          )}
          {got.size > 0 && (
            <div className="rg-efftot-grp">
              <h5>{t("누계 획득")}</h5>
              <ul className="rg-efftot-row get">
                {GET_ORDER.filter((k) => got.has(k)).map((k) => (
                  <li key={k}><span>{t(GET_LABEL[k])}</span><b>{signed(got.get(k)!, false)}</b></li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {/* 합산된 게 하나도 없으면 위 안내가 이미 같은 말을 하므로 겹쳐 적지 않는다 */}
      {plain > 0 && !nothing && (
        <p className="rg-efftot-rest">
          {t("나머지 {n}개는 조건부·고유 효과라 합산 대상이 아닙니다 (카드에서 개별 확인).", { n: plain })}
        </p>
      )}
      <p className="rg-efftot-note">{t("같은 종류의 배율은 더해서, 「받는 대미지」류는 곱해서 적용됩니다. {label} 기준.", { label })}</p>
    </ModalWindow>
  );
}

// ── 층 상세 모달 — 층 카드 클릭 시 (설명 + 작전/보스 카드) ───────────────────
function ZoneModal({ zone, badge, pairs, bosses, onOpenStage, onClose }: {
  zone: Zone; badge: string; pairs: StagePair[]; bosses: Stage[];
  onOpenStage: (p: StagePair) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <ModalWindow label={nmText(zone.name, zone.cn)} className="rg-modal rg-zmodal" onClose={onClose}>
      <header className="rg-modal-head">
        <div>
          <span className="rg-zone-num">{badge}</span>
          <h3><Nm name={zone.name} cn={zone.cn} /></h3>
          {zone.variant && <span className="rg-zone-hidden">{t("변형 구역")}</span>}
          {zone.hidden && <span className="rg-zone-hidden">{t("히든 층")}</span>}
          {zone.time && <span className="rg-modal-zone">{zone.time}</span>}
        </div>
      </header>
      <p className="rg-zone-desc">{zone.desc}</p>
      {zone.buff && <p className="rg-modal-elite">{zone.buff}</p>}
      {pairs.length > 0 && (
        <div className="rg-stage-group">
          <h4>{t("작전")} <em>{pairs.length}</em> <span className="rg-stage-hint">{t("카드를 열면 일반/긴급 탭으로 전환할 수 있습니다")}</span></h4>
          <div className="rg-stage-cards">
            {pairs.map((p) => <StageCard key={p.n.id} pair={p} onOpen={onOpenStage} />)}
          </div>
        </div>
      )}
      {bosses.length > 0 && (
        <div className="rg-stage-group">
          <h4 className="boss">{t("험난한 길 (보스)")} <em>{bosses.length}</em></h4>
          <div className="rg-stage-cards">
            {bosses.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={onOpenStage} boss />)}
          </div>
        </div>
      )}
    </ModalWindow>
  );
}

// 토픽 목록 — ready=데이터 있음, future=미래시 토글 필요 (CN 선행, 비공식 번역명)
// 햄버거 메뉴가 '통합전략 가이드' 부메뉴로도 쓰므로 export (home.tsx)
// TOPICS는 rogue-topics.ts로 이동 (셸이 데이터 없이 쓰기 위해) — 여기선 재export만 한다.
export { TOPICS, slugOf, roguePath } from "./rogue-topics";

// 토픽 데이터 동적 로더 — KR은 rogue_1만 기본 번들, 나머지는 선택 시 로드 (각 300~600KB).
// EN/JA는 글로벌/일본 서버 공식 텍스트로 빌드한 rogueN.<loc>.json (build-rogue.py i18n).
// rogue_6은 CN 선행이라 공식 현지화가 없어 전 로케일이 KR/CN 병기 파일을 공유한다.
const TOPIC_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  rogue_2: () => import("./data/rogue2.json"),
  rogue_3: () => import("./data/rogue3.json"),
  rogue_4: () => import("./data/rogue4.json"),
  rogue_5: () => import("./data/rogue5.json"),
  rogue_6: () => import("./data/rogue6.json"),
};
// 중국섭 탭(서버 탭 '중국 서버') — CN 텍스트 테이블 + KR 공식 한국어 오버레이 빌드
// (build-rogue.py cn — 블랙플로우처럼 중국어 원문 병기). 공식 현지화가 없는 데이터라
// EN/JA 로케일도 이 파일을 그대로 쓴다 (rogue_6과 같은 정책). rogue_6은 원래 CN 빌드.
const TOPIC_LOADERS_CN: Record<string, () => Promise<{ default: unknown }>> = {
  rogue_1: () => import("./data/rogue1.cn.json"),
  rogue_2: () => import("./data/rogue2.cn.json"),
  rogue_3: () => import("./data/rogue3.cn.json"),
  rogue_4: () => import("./data/rogue4.cn.json"),
  rogue_5: () => import("./data/rogue5.cn.json"),
  rogue_6: () => import("./data/rogue6.json"),
};
const TOPIC_LOADERS_EN: Record<string, () => Promise<{ default: unknown }>> = {
  rogue_1: () => import("./data/rogue1.en.json"),
  rogue_2: () => import("./data/rogue2.en.json"),
  rogue_3: () => import("./data/rogue3.en.json"),
  rogue_4: () => import("./data/rogue4.en.json"),
  rogue_5: () => import("./data/rogue5.en.json"),
  rogue_6: () => import("./data/rogue6.json"),
};
const TOPIC_LOADERS_JA: Record<string, () => Promise<{ default: unknown }>> = {
  rogue_1: () => import("./data/rogue1.ja.json"),
  rogue_2: () => import("./data/rogue2.ja.json"),
  rogue_3: () => import("./data/rogue3.ja.json"),
  rogue_4: () => import("./data/rogue4.ja.json"),
  rogue_5: () => import("./data/rogue5.ja.json"),
  rogue_6: () => import("./data/rogue6.json"),
};
const loadersFor = (locale: string) =>
  locale === "en" ? TOPIC_LOADERS_EN : locale === "ja" ? TOPIC_LOADERS_JA : TOPIC_LOADERS;

// 토픽 URL 슬러그 — /rogue?topic=is6 (rogue_1은 파라미터 없음)
// 테마별 상징색 — 드롭다운 색점 (각 스킨(.rgN)의 강조색과 동일 계열)
const TOPIC_HUE: Record<string, string> = {
  rogue_1: "#c23b4e", rogue_2: "#4a9edd", rogue_3: "#b7c2d1",
  rogue_4: "#8e222f", rogue_5: "#efa5c1", rogue_6: "#2fbfa5",
};

// 테마의 정본 주소 = /rogue/<slug> (2026-08-06, SEO). 종전에는 6개 테마가 ?topic=isN
// 쿼리 파라미터 하나를 나눠 써서 사이트맵에도 없고 테마별 제목·설명도 없었다.
// 옛 ?topic= 링크는 그대로 동작한다 (경로가 우선, 없으면 파라미터).
const ROGUE_PATH_RE = /^\/(?:en\/|ja\/)?rogue\/([^/]+)\/?$/;
const LOCALE_BASE: Record<string, string> = { ko: "", en: "/en", ja: "/ja" };
// 테마 이름·도입문만 담은 경량 색인(3.6KB, scripts/build-rogue-index.mjs) — 본문 데이터를
// 불러오기 전에도 히어로를 그릴 수 있다. 무거운 rogueN.json은 종전대로 동적 로드.
const ROGUE_INDEX = rogueIndexData as Record<string, Partial<Record<string, { name: string; line: string }>>>;
const topicOfSlug = (slug: string | null) =>
  TOPICS.find((tp) => tp.ready && slugOf(tp.id) === slug)?.id ?? null;
const topicFromUrl = () =>
  topicOfSlug(ROGUE_PATH_RE.exec(window.location.pathname)?.[1] ?? null)
  ?? topicOfSlug(new URLSearchParams(window.location.search).get("topic"))
  ?? "rogue_1";
// 서버 탭 — URL은 ?sv=cn 일 때만 표시. 블랙플로우(rogue_6)는 자국 서버 미출시라
// 토픽만으로도 중국 서버가 강제된다 (자국 서버 탭은 비활성).
// "kr"은 **화면 언어의 자국 서버**를 뜻하는 내부 코드값이다 — 로케일별 로더가
// ko=한국(rogueN.json) · en=글로벌(.en) · ja=일본(.ja) 서버 공식 텍스트를 싣는다.
type Server = "kr" | "cn";
// 자국 서버 라벨 — short=미니 토글(좁음), label은 "{label} 서버" 조합용 (i18n 공용 키)
const HOME_SERVER: Record<string, { short: string; label: string }> = {
  ko: { short: "한국섭", label: "한국" },
  en: { short: "글로벌섭", label: "글로벌" },
  ja: { short: "일본섭", label: "일본" },
};
const serverFromUrl = (): Server =>
  new URLSearchParams(window.location.search).get("sv") === "cn" || topicFromUrl() === "rogue_6" ? "cn" : "kr";

// ── 메인 ───────────────────────────────────────────────────────────────────
export default function RogueGuide({ initialTopic }: {
  /** 테마 라우트(/rogue/<slug>)가 넘겨주는 토픽 id — 프리렌더 HTML의 히어로가 이걸 쓴다 */
  initialTopic?: string;
}) {
  const { t, locale } = useI18n();

  // 첫 렌더의 시작 토픽 — 라우트가 알려준 게 있으면 그것(프리렌더와 하이드레이션이 일치),
  // 없으면 URL에서 읽는다 (SSR에선 rogue_1)
  const [topic, setTopic] = useState(() =>
    initialTopic ?? (typeof window === "undefined" ? "rogue_1" : topicFromUrl()));
  // 서버 탭 — 한국섭(kr, 기본)/중국섭(cn). SSR에선 kr, 마운트 게이트가 미스매치를 막는다.
  const [server, setServer] = useState<Server>(() => (typeof window === "undefined" ? "kr" : serverFromUrl()));
  const [loaded, setLoaded] = useState<Record<string, RogueData>>({});
  // 마운트 게이트 — 정적 프리렌더 HTML(항상 rogue_1)과 클라 첫 렌더가 어긋나면
  // 하이드레이션 미스매치가 난다. 마운트 전엔 토픽 무관 로딩 셸만 렌더해 양쪽을
  // 일치시키고, 마운트 후 곧바로 올바른 토픽을 그린다 (팬텀→사미 깜빡임도 방지).
  // useSyncExternalStore: 서버/하이드레이션 스냅샷=false, 마운트 후 클라 스냅샷=true
  // (effect 내 setState 없이 하이드레이션 안전하게 클라 마운트를 감지).
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  // KR rogue_1만 기본 번들 — 그 외(다른 토픽·EN/JA 로케일·중국섭)는 선택 시 동적 로드.
  // 캐시 키는 토픽:서버:로케일 (언어·서버 전환 시 같은 토픽의 해당 데이터를 다시 불러온다)
  const bundled = topic === "rogue_1" && locale === "ko" && server === "kr";
  const dataKey = `${topic}:${server}:${locale}`;
  useEffect(() => {
    const key = `${topic}:${server}:${locale}`;
    const loader = server === "cn" ? TOPIC_LOADERS_CN[topic] : loadersFor(locale)[topic];
    if (!(topic === "rogue_1" && locale === "ko" && server === "kr") && !loaded[key] && loader) {
      loader().then((m) =>
        setLoaded((cur) => ({ ...cur, [key]: m.default as RogueData })));
    }
  }, [topic, server, locale, loaded]);
  const active = bundled ? rogue1 : loaded[dataKey] ?? null;
  setActiveData(active ?? rogue1);
  const loading = active == null;

  // 다크 테마 배경을 페이지 전체(100% 폭)에 칠한다 — 토픽별 스킨 클래스(rg2~rg6)
  useEffect(() => {
    const c = document.documentElement.classList;
    c.add("rg-theme");
    for (const tp of TOPICS) c.toggle("rg" + tp.id.split("_")[1], tp.id === topic && tp.id !== "rogue_1");
    return () => { c.remove("rg-theme"); for (const tp of TOPICS) c.remove("rg" + tp.id.split("_")[1]); };
  }, [topic]);
  const [view, setView] = useState<View>("map");
  const [grade, setGrade] = useState(0); // -1 = EASY, 0~15
  // 테마 변경 커스텀 드롭다운 — 바깥 클릭·Esc로 닫기
  const [topicMenu, setTopicMenu] = useState(false);
  const topicSelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!topicMenu) return;
    const onDown = (e: MouseEvent) => { if (!topicSelRef.current?.contains(e.target as Node)) setTopicMenu(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setTopicMenu(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onEsc); };
  }, [topicMenu]);
  const [zoneOpen, setZoneOpen] = useState<Zone | null>(null);
  // 스크린샷 렌즈 도착 하이라이트 (전시관 카드) — applyTopic이 리셋하므로 여기(앞)에 선언
  const [lensHits, setLensHits] = useState<Set<string> | null>(null);
  // 다중 인식 아이템 모아보기 — 유물·도구·음반·시스템 항목 공통 필드 (2026-07-23)
  type LensItem = { id: string; name: string; usage?: string | null; desc?: string | null; img?: boolean; iconId?: string; order?: string | null; cn?: string };
  const [lensMulti, setLensMulti] = useState<LensItem[] | null>(null);
  const [stageOpen, setStageOpen] = useState<StagePair | null>(null);
  const [enemyOpen, setEnemyOpen] = useState<{ key: string; ctx: StatCtx } | null>(null);
  const [encOpen, setEncOpen] = useState<Encounter | null>(null);
  const [relicOpen, setRelicOpen] = useState<InvItem | null>(null); // 소장품·부품·자원 공용 상세
  // 기록 원문(엔딩북 조각·방문객 장면) 열람 — 제목·부제는 여는 쪽이 채운다
  const [recOpen, setRecOpen] = useState<{ rid: string; title: string; sub?: string } | null>(null);
  // 비제어 입력 3종 — 타이핑 중 렌더 0회, 멈춘 뒤 0.5초에만 목록 갱신 (search.ts)
  const { term: enemyTerm, set: setEnemyTerm, inputProps: enemyProps } = useSearchInput();
  const [enemyRank, setEnemyRank] = useState<string>("");
  const { term: relicTerm, set: setRelicTerm, inputProps: relicProps } = useSearchInput();
  // 맵·노드 이름 검색 (작전·조우 전투·우연한 만남 전부)
  const { term: mapTerm, set: setMapTerm, inputProps: mapProps } = useSearchInput();
  // 표준 카테고리 + 토픽 고유 시스템(mechanics)의 라벨을 탭 id로 쓰므로 string
  const [arcTab, setArcTab] = useState<string>("relic");
  const VIEWS = viewsFor();
  // 전시관 서브탭 [id, 라벨] 목록 — 환각계열 + 토픽 고유 시스템 전부 + 표준(도구·분대 등).
  // 소장품(유물)은 최상위 탭으로 승격돼 여기서 제외. arcTab이 무효면 첫 탭으로 폴백.
  const hasVariations = (data.variations?.length ?? 0) > 0 || (data.weathers?.length ?? 0) > 0;
  // 월간 방문객 탭 — 데이터 있는 테마에만 (사용자 소원 2026-08-17)
  const visitorTab: [string, string][] = (data.visitors?.length ?? 0) > 0 ? [["visitor", "방문객"]] : [];
  const archiveTabs: [string, string][] = topic === "rogue_6"
    ? [...(hasVariations ? [["hallu", HALLU_LABEL[topic]] as [string, string]] : []),
       ["scrap", "부품 (零件)"], ["band", "분대"], ["legacy", "유산"],
       // 부표는 노드가 아니라 격자 지도 위 이벤트 마커 — 전시관으로 이동 (사용자 확정 2026-07-18)
       ...((data.buoys?.length ?? 0) > 0 ? [["buoy", "지도 마커 (부표)"] as [string, string]] : []),
       ...visitorTab]
    : [...(hasVariations && HALLU_LABEL[topic] ? [["hallu", HALLU_LABEL[topic]] as [string, string]] : []),
       ...((data.capsules?.length ?? 0) > 0 ? [["capsule", "레퍼토리 (음반)"] as [string, string]] : []),
       ...(data.mechanics ?? []).map((m) => [m.label, m.label] as [string, string]),
       ...((data.exploreTools?.length ?? 0) > 0 ? [["explore", "탐사 도구"] as [string, string]] : []),
       ["band", "분대"], ...visitorTab];
  const activeArc = archiveTabs.some(([id]) => id === arcTab) ? arcTab : (archiveTabs[0]?.[0] ?? "tool");

  // 뒤로/앞으로·햄버거 부메뉴(popstate) → 토픽 동기화. 토픽 전환은 이제 헤더 버튼이 아니라
  // 햄버거 '통합전략 가이드' 부메뉴가 URL(?topic=isN)을 바꿔 트리거한다. 토픽이 실제로
  // 바뀌면 뷰·난이도·검색·모달을 초기화한다(옛 switchTopic이 하던 리셋).
  const topicRef = useRef(topic);
  // 내비게이션(뒤로가기·부메뉴·만능검색) 신호 — 토픽이 그대로여도 핸드오프를 다시 적용하게 하는 카운터
  const [navTick, setNavTick] = useState(0);
  // 토픽 전환 + 뷰/난이도/검색/모달 리셋 (옛 switchTopic이 하던 일). 같은 토픽이면 무시.
  const applyTopic = (next: string) => {
    if (next === "rogue_6") applyServer("cn"); // 블랙플로우는 KR 미출시 — 중국섭 강제
    if (topicRef.current === next) return;
    topicRef.current = next;
    setTopic(next);
    setView("map");
    setGrade(0);
    setZoneOpen(null); setStageOpen(null); setEnemyOpen(null); setEncOpen(null); setRelicOpen(null); setRecOpen(null);
    setEnemyTerm("", false); setEnemyRank(""); setRelicTerm("", false); setMapTerm("", false); setArcTab("relic");
    setLensHits(null); setLensMulti(null); // 렌즈 하이라이트·모아보기는 토픽 전환 시 해제
    setInvOpen(false); setInvTab("relic"); // 보유 리스트 모달·탭 리셋 (목록 자체는 테마별 저장)
  };
  const applyTopicFromUrl = () => applyTopic(topicFromUrl());
  // 서버 전환 — 같은 토픽의 다른 서버 데이터 인스턴스로 갈아끼운다. 열려 있던 상세 모달은
  // 옛 데이터 객체를 물고 있으므로 닫는다 (뷰·난이도·검색은 유지 — 같은 토픽이라 유효).
  const serverRef = useRef(server);
  const applyServer = (next: Server) => {
    if (serverRef.current === next) return;
    serverRef.current = next;
    setServer(next);
    setZoneOpen(null); setStageOpen(null); setEnemyOpen(null); setEncOpen(null); setRelicOpen(null); setRecOpen(null);
    setLensHits(null); setLensMulti(null);
  };
  const applyServerFromUrl = () => applyServer(serverFromUrl());
  // 중섭 탭을 켜 놓고 보는 테마 = 화면이 중국어인 테마. 스샷 레이더·PRTS 링크가 이 값을
  // lens에 넘겨 그 테마의 CN 이름을 인식 인덱스에 얹는다 (2026-08-13 사용자 지적:
  // "흑류수해 말고 다른 록라 중섭으로 바꾸면 중국어 인식 못하지?" — 맞았다).
  // rogue_6은 rogue6.json 자체가 KR/CN 병기라 여기서 걸려도 run.ts가 알아서 무시한다.
  const cnTopicNow = () => (serverRef.current === "cn" ? topicRef.current : undefined);
  useEffect(() => {
    // popstate=브라우저 뒤로/앞으로, ta:rogue-topic=햄버거 부메뉴에서 온 커스텀 이벤트.
    // ⚠ 예전엔 부메뉴/드롭다운이 합성 popstate를 쐈는데, vinext 라우터가 그걸 내비게이션으로
    // 보고 rogue RSC를 재요청했다 → 커스텀 이벤트로 바꿔 프레임워크가 무시하게 한다.
    // 핸드오프 재적용 신호도 함께 올린다 — 헤더 만능검색이 **같은 테마**의 항목을 지목하면
    // 토픽이 안 바뀌어 아래 데이터 로드 effect가 다시 안 돌기 때문. 테마가 바뀐 경우엔
    // 그 effect가 데이터 로드 후 처리한다(applyLensHandoff는 토픽이 맞을 때만 소비).
    const onNav = () => { applyTopicFromUrl(); applyServerFromUrl(); setNavTick((n) => n + 1); };
    window.addEventListener("popstate", onNav);
    window.addEventListener("ta:rogue-topic", onNav);
    return () => { window.removeEventListener("popstate", onNav); window.removeEventListener("ta:rogue-topic", onNav); };
  }, []);

  // 헤더 테마 드롭다운 — URL(?topic=isN)만 바꾸고 직접 토픽 전환(합성 popstate 안 씀).
  // sv 파라미터도 실효 서버(블랙플로우=cn 강제)에 맞춰 함께 정리해 뒤로가기와 어긋나지 않게 한다.
  const goTopic = (id: string) => {
    if (id === topic) return;
    const url = new URL(window.location.href);
    // 주소는 테마의 정본 경로로 — 공유·새로고침이 색인된 주소가 된다 (2026-08-06).
    // 옛 ?topic= 파라미터는 경로로 대체되므로 지운다(둘이 어긋나면 경로가 이긴다).
    url.pathname = roguePath(LOCALE_BASE[locale] ?? "", id);
    url.searchParams.delete("topic");
    if (id === "rogue_6" || serverRef.current === "cn") url.searchParams.set("sv", "cn");
    else url.searchParams.delete("sv");
    history.pushState(null, "", url.pathname + url.search + url.hash);
    applyTopic(id);
  };

  // 서버 탭 클릭 — URL(?sv=cn)을 바꾸고 전환. 블랙플로우에서 KR 탭은 비활성(미출시).
  const goServer = (next: Server) => {
    if (next === server || (next === "kr" && topic === "rogue_6")) return;
    const url = new URL(window.location.href);
    if (next === "cn") url.searchParams.set("sv", "cn");
    else url.searchParams.delete("sv");
    history.pushState(null, "", url.pathname + url.search + url.hash);
    applyServer(next);
  };

  // 뷰 전환 — URL 해시 동기화는 아래 딥링크 effect가 담당 (뷰+열린 모달을 함께 표현)
  // startTransition: 뷰 전환은 대형 리스트 재렌더라 클릭 페인트부터 내보낸다 (INP, 2026-07-21)
  const goView = (v: View) => startTransition(() => setView(v));

  // 층별 전투 노드 — 일반/긴급이 같은 맵을 공유하므로 페어(StagePair)로 묶는다.
  // rogue_6의 조우 전투(t)도 긴급 페어(e_t)가 있다.
  const emgById = useMemo(() => new Map(data.stages.filter((s) => s.kind === "emergency").map((s) => [s.id, s])), [active]);
  const emgOf = (s: Stage): Stage | undefined =>
    s.kind === "normal" ? emgById.get(s.id.replace("_n_", "_e_"))
      : s.kind === "incident" || s.kind === "special" ? emgById.get(s.id.replace("_t_", "_e_t_")) : undefined;
  const pairOf = (s: Stage): StagePair => ({ n: s, e: emgOf(s) });
  const pairsByZone = useMemo(() => {
    const m = new Map<number, StagePair[]>();
    for (const s of data.stages) {
      if (s.zone == null || s.kind !== "normal") continue;
      if (!m.has(s.zone)) m.set(s.zone, []);
      m.get(s.zone)!.push({ n: s, e: emgById.get(s.id.replace("_n_", "_e_")) });
    }
    return m;
  }, [emgById]); // eslint-disable-line react-hooks/exhaustive-deps
  const bossStages = useMemo(() => data.stages.filter((s) => s.kind === "boss"), [active]);
  // 층이 배정되지 않은 보스(층 큐레이션이 없는 토픽) — 이름 없는 더미 보스는 제외
  const orphanBosses = useMemo(() => bossStages.filter((s) => s.zone == null && s.name.trim()), [bossStages]);
  const evStages = useMemo(() => data.stages.filter((s) => s.kind === "event"), [active]);
  const specialStages = useMemo(() => data.stages.filter((s) => s.kind === "special"), [active]);
  const duelStages = useMemo(() => data.stages.filter((s) => s.kind === "duel"), [active]);
  const trialStages = useMemo(() => data.stages.filter((s) => s.kind === "trial"), [active]);
  // 특수 구역(경) ↔ 시련 작전 수동 매핑 — 게임데이터에는 존 연결이 없다 (2026-07-26 사용자
  // 제보: 쉐이 시비경·금석경 모달이 텅 빔). 이름이 근거다: sv·dv = 시비 판정류(우쭐함·
  // 노여움·탐욕과 망념…) → 시비경, fs = 대사냥류(방천·영뢰·멸진·부운·척홍) → 금석경.
  // 변형판(_b·_c·_dlc1)은 같은 이름의 강화판이라 기본판만 카드로 싣는다.
  const TRIAL_ZONE_RE: Record<string, RegExp> = {
    zone_sky_1: /^ro5_(?:sv|dv)_\d+$/,
    zone_sky_2: /^ro5_fs_\d+$/,
  };
  const trialPairsFor = (z: Zone): StagePair[] => {
    const re = TRIAL_ZONE_RE[z.id];
    return re ? trialStages.filter((s) => re.test(s.id)).map((s) => ({ n: s })) : [];
  };
  // 층 배지 — 히든 층 중 진입 경로명이 확정된 곳은 ? 대신 그 이름 (사용자 확정 2026-07-26:
  // 미즈키 '짙푸른 요람'은 원더랜드로 진입)
  const ZONE_BADGE: Record<string, string> = { "rogue_2:zone_7": "원더랜드" };
  const zoneBadge = (z: Zone): string => {
    const custom = ZONE_BADGE[`${data.id}:${z.id}`];
    if (custom) return t(custom);
    return z.portal ? t("특수 구역") : z.hidden ? "?" : t("{n}층", { n: z.num });
  };
  const chaseStages = useMemo(() => data.stages.filter((s) => s.kind === "chase"), [active]);
  const savageStages = useMemo(() => data.stages.filter((s) => s.kind === "savage"), [active]);
  const incidentStages = useMemo(() => data.stages.filter((s) => s.kind === "incident"), [active]);
  // 기타 노드 — 전투(작전·긴급·험난한 길)와 우연한 만남을 제외한 노드 타입 설명.
  // 같은 이름의 중복 타입(운명의 암시 등)은 하나만 남긴다 (사용자 요청 2026-07-18)
  const otherNodes = useMemo(() => {
    const skip = new Set(["BATTLE_NORMAL", "BATTLE_ELITE", "BATTLE_BOSS", "INCIDENT"]);
    const seen = new Set<string>();
    return data.nodeTypes.filter((nt) => {
      if (skip.has(nt.id) || seen.has(nt.name)) return false;
      seen.add(nt.name);
      return true;
    });
  }, [active]);

  // 적 → 등장 스테이지 역매핑
  const enemyStages = useMemo(() => {
    const m = new Map<string, Stage[]>();
    for (const s of data.stages) {
      if (s.kind === "emergency") continue; // 일반과 중복 (같은 맵)
      for (const se of s.enemies) {
        if (!m.has(se.key)) m.set(se.key, []);
        m.get(se.key)!.push(s);
      }
    }
    return m;
  }, [active]);

  // 도감 컨텍스트 — 험난한 길에만 등장하는 적(보스 등)은 도감에서도 g10+ 배율을
  // 적용해 노드 상세와 같은 수치를 보여준다 (사용자 리포트: 도감/노드 상세 불일치)
  const dexCtx = (key: string): StatCtx => {
    const appear = enemyStages.get(key) ?? [];
    return { emergencyOrBoss: appear.length > 0 && appear.every((s) => s.kind === "boss") };
  };

  const enemies = useMemo(() => {
    const q = normSearch(enemyTerm);
    return Object.entries(data.enemies)
      .filter(([, e]) => (!enemyRank || e.rank === enemyRank))
      .filter(([, e]) => !q || normSearch(e.name).includes(q) || (e.cn && normSearch(e.cn).includes(q)))
      .sort(([, a], [, b]) => (RANK_SORT[a.rank ?? ""] ?? 0) - (RANK_SORT[b.rank ?? ""] ?? 0) || a.name.localeCompare(b.name, "ko"));
  }, [enemyTerm, enemyRank, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // 무대 도구는 소장품에 통합해 함께 표시 (사용자 확정 2026-07-24) — 목록 끝에 붙는다
  const relicsAll = useMemo(() => [
    ...data.relics,
    ...data.tools.map((tool, i) => ({
      id: tool.id, name: tool.name, desc: tool.desc ?? null, usage: tool.usage ?? null,
      obtain: null, order: null, group: null, sort: 100000 + i, sp: false, img: tool.img,
    } as Relic)),
  ], [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const relics = useMemo(() => {
    const q = normSearch(relicTerm);
    // 소장품 번호(order)로도 검색 — 순수 숫자 질의는 번호 정확일치 우선 (사용자 요청)
    return relicsAll.filter((r) => !q
      || normSearch(r.name).includes(q)
      || (r.cn && normSearch(r.cn).includes(q))
      || normSearch(r.usage ?? "").includes(q)
      || (r.order != null && (/^\d+$/.test(q) ? String(r.order) === q : normSearch(String(r.order)).includes(q))));
  }, [relicTerm, relicsAll]);

  // 맵 탭 이름 검색 — 전투 노드(작전·긴급·보스·조우 전투·특수·시련·추격전·거점전·외나무다리)
  // + 우연한 만남(조우)을 전부 이름/중국어 원문으로 매칭
  const mapHits = useMemo(() => {
    const q = normSearch(mapTerm);
    if (!q) return null;
    const nm = (name: string, cn?: string) => normSearch(name).includes(q) || (cn ? normSearch(cn).includes(q) : false);
    const stages = data.stages.filter((s) => s.kind !== "emergency" && nm(s.name, s.cn));
    const encs = data.encounters.filter((e) => nm(e.title, e.cn));
    return { stages, encs };
  }, [mapTerm, active]); // eslint-disable-line react-hooks/exhaustive-deps


  // 엔딩 조건 문장 속 「이름」 참조를 전부 클릭 가능하게 — 스테이지·조우·유물·적 순으로 매칭
  const stageByName = useMemo(() => new Map(data.stages.filter((s) => s.kind !== "emergency").map((s) => [s.name, s])), [active]);
  const encByTitle = useMemo(() => new Map(data.encounters.map((e) => [e.title, e])), [active]);
  const relicByName = useMemo(() => new Map(relicsAll.map((r) => [r.name, r])), [relicsAll]);
  const enemyByName = useMemo(() => new Map(Object.entries(data.enemies).map(([k, e]) => [e.name, k])), [active]);

  // ─── 딥링크: URL 해시로 뷰 + 열린 모달(노드·적 도감·조우·소장품·층)을 표현 ───
  // 형식 #rg-<view> 또는 #rg-<view>~<type>~<id> (type=zone|stage|enemy|enc|relic).
  // 복붙 URL로 바로 그 모달이 열린다. (사용자 요청 2026-07-20)
  const stageById = useMemo(() => new Map(data.stages.map((s) => [s.id, s])), [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const relicById = useMemo(() => new Map(relicsAll.map((r) => [r.id, r])), [relicsAll]); // 무대 도구 포함
  const encByScene = useMemo(() => new Map(data.encounters.map((e) => [e.scene, e])), [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoneById = useMemo(() => new Map(data.zones.map((z) => [z.id, z])), [active]); // eslint-disable-line react-hooks/exhaustive-deps
  // 렌즈 모아보기용 통합 아이템 룩업 — 유물·도구·음반·부품·탐사도구·토픽 고유 시스템 (id는 전역 유일)
  const lensItemById = useMemo(() => {
    const m = new Map<string, LensItem>();
    for (const r of data.relics) m.set(r.id, r);
    for (const c of data.tools) m.set(c.id, c);
    for (const c of data.capsules ?? []) m.set(c.id, c);
    for (const c of data.exploreTools ?? []) m.set(c.id, c);
    for (const s of data.scraps ?? []) m.set(s.id, s); // 블랙플로우 부품 — CN 상인 판매 화면 모아보기
    for (const mech of data.mechanics ?? []) for (const it of mech.items) m.set(it.id, it);
    return m;
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 보유 리스트 (인벤토리) — 게임에서 얻은 소장품·테마 자원을 담아두는 개인 목록 ───
  // (피드백 반영 2026-07-24) 테마별 localStorage(ta:rogue-inv:<topic>)에 영속.
  // 자원 탭은 테마 고유 '수집 자원'만: 사미=암호판, 살카즈=사고, 쉐이=주화, 블랙플로우=부품
  // (거부반응·시대·분노 등 판 규칙류는 수집물이 아니라 제외). EN/JA 데이터는 mechanics
  // 라벨이 현지어라 라벨 매칭이 깨진다 — 아이템 id 접두사로 자원 시스템을 찾는다.
  const RES_MECH_PREFIX: Record<string, string> = { rogue_3: "rogue_3_totem", rogue_4: "rogue_4_fragment", rogue_5: "rogue_5_copper" };
  const resMech = useMemo(
    () => (data.mechanics ?? []).find((m) => m.items[0]?.id.startsWith(RES_MECH_PREFIX[topic] ?? "\u0000")),
    [active, topic]); // eslint-disable-line react-hooks/exhaustive-deps
  const resItems: InvItem[] = topic === "rogue_6" ? (data.scraps ?? []) : (resMech?.items ?? []);
  const resLabel = topic === "rogue_6" ? ((data.scraps?.length ?? 0) > 0 ? "부품 (零件)" : null) : resMech?.label ?? null;
  const resIds = useMemo(() => new Set(resItems.map((i) => i.id)), [resItems]);
  const [inv, setInvState] = useState<Set<string>>(new Set());
  // IS5 주화 id 이관 — 예전 데이터는 주화마다 '부여'가 붙은 변종(_i 등)을 대표로 골랐어서
  // 보유 목록에 그 id가 저장돼 있다. 지금은 본체(_a)가 대표라 그대로면 체크가 사라진다.
  // 변종 계열(copper_buff_·change_copper_)과 부여 접미를 본체 id로 되돌려 읽는다.
  const migrateInvId = (id: string) =>
    id.replace(/^rogue_5_(?:copper_buff|change_copper)_/, "rogue_5_copper_")
      .replace(/^(rogue_5_copper_[A-Z]+_\d+)_[a-z]$/, "$1_a");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`ta:rogue-inv:${topic}`);
      const ids = raw ? (JSON.parse(raw) as string[]) : [];
      setInvState(new Set(topic === "rogue_5" ? ids.map(migrateInvId) : ids));
    } catch { setInvState(new Set()); }
  }, [topic]);
  const saveInv = (next: Set<string>) => {
    try { localStorage.setItem(`ta:rogue-inv:${topic}`, JSON.stringify([...next])); } catch { /* 프라이빗 모드 등 */ }
  };
  // 보유 리스트에 **담을 때만** 리플레이에 소장품 한 줄을 남긴다 (사용자 확정 2026-07-26:
  // "본인이 직접 집어서 보유 상태로 변한 게 아니면, 한번 클릭해봤다고 리플레이에 남기면 안 됨").
  // 화면 인식으로 소장품 상세가 열린 것만으로는 아무것도 기록하지 않는다. 빼는 건 기록 대상 아님.
  const logInvPick = (id: string) => {
    if (!bridgeLock()) return;                      // PRTS 링크로 플레이 중일 때만
    const item = relicById.get(id) ?? lensItemById.get(id);
    const section = invSection(id);
    if (!item?.name || !section) return;
    logBridgeEvent({ at: new Date().toISOString(), type: section === "res" ? "res" : "relic", name: item.name });
  };
  const toggleInv = (id: string) => setInvState((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) { next.add(id); logInvPick(id); }
    saveInv(next);
    return next;
  });
  // 보유 담기가 가능한 항목인지 — 소장품(무대 도구 포함) 또는 테마 자원. 그 외(분대·음반 등)는 대상 아님
  const invSection = (id: string): "relic" | "res" | null =>
    relicById.has(id) ? "relic" : resIds.has(id) ? "res" : null;
  // 여러 개 일괄 담기/빼기 — 모아보기 모달의 전체 보유 토글용 (사용자 요청 2026-07-24)
  const toggleInvAll = (ids: string[], own: boolean) => setInvState((prev) => {
    const next = new Set(prev);
    for (const id of ids) {
      if (!own) { next.delete(id); continue; }
      if (!next.has(id)) { next.add(id); logInvPick(id); }
    }
    saveInv(next);
    return next;
  });
  const [invOpen, setInvOpen] = useState(false);
  const [invTab, setInvTab] = useState<"relic" | "res">("relic");
  // ── 떠 있는 창의 위치 (사용자 지시 2026-07-29: "윗쪽 잡고 드래그하면 위치이동")
  // 위치는 토픽과 무관한 작업 공간이라 테마별이 아니라 하나만 저장한다.
  const INV_POS_KEY = "ta:rogue-inv-pos";
  const invPanelRef = useRef<HTMLDivElement>(null);
  const invDragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [invPos, setInvPos] = useState<{ x: number; y: number } | null>(null);
  const [invDragging, setInvDragging] = useState(false);
  const [effOpen, setEffOpen] = useState(false);          // 효과 총합 모달
  // 사용자가 CSS resize 손잡이로 바꾼 크기를 기억한다 (사용자 지시 2026-07-29)
  const INV_SIZE_KEY = "ta:rogue-inv-size";
  const [invSize, setInvSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!invOpen) return;
    try {
      const raw = localStorage.getItem(INV_SIZE_KEY);
      if (raw) setInvSize(JSON.parse(raw) as { w: number; h: number });
    } catch { /* 프라이빗 모드 등 */ }
  }, [invOpen]);
  // 크기 조절 — CSS `resize`는 **오른쪽 아래 한 곳뿐**이라 네 변 어디서나 잡을 수 있게
  // 직접 만든다 (사용자 지시 2026-07-29). 왼쪽·위 변을 끌면 크기와 함께 위치도 움직인다.
  const INV_MIN_W = 260;
  const INV_MIN_H = 180;
  const INV_GRIPS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];   // 모서리를 뒤에 둬서 변보다 위에
  const invRsRef = useRef<{ dir: string; px: number; py: number; x: number; y: number; w: number; h: number } | null>(null);
  const onInvResizeStart = (e: React.PointerEvent, dir: string) => {
    const el = invPanelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    invRsRef.current = { dir, px: e.clientX, py: e.clientY, x: r.left, y: r.top, w: r.width, h: r.height };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();                      // 헤더 드래그(이동)와 겹치지 않게
  };
  const onInvResizeMove = (e: React.PointerEvent) => {
    const s = invRsRef.current;
    if (!s) return;
    const dx = e.clientX - s.px;
    const dy = e.clientY - s.py;
    let { x, y, w, h } = s;
    // 오른쪽·아래로 늘릴 땐 **창을 움직이지 말고 크기를 화면 끝에서 멈춘다** — 그러지 않으면
    // 화면 끝에 닿는 순간 창 전체가 왼쪽으로 끌려간다(실측). 왼쪽·위는 원래 위치가 함께 움직인다.
    if (s.dir.includes("e")) w = Math.min(Math.max(INV_MIN_W, s.w + dx), window.innerWidth - 8 - s.x);
    if (s.dir.includes("s")) h = Math.min(Math.max(INV_MIN_H, s.h + dy), window.innerHeight - 8 - s.y);
    if (s.dir.includes("w")) {
      w = Math.min(Math.max(INV_MIN_W, s.w - dx), s.x + s.w - 8);
      x = s.x + (s.w - w);
    }
    if (s.dir.includes("n")) {
      h = Math.min(Math.max(INV_MIN_H, s.h - dy), s.y + s.h - 8);
      y = s.y + (s.h - h);
    }
    setInvSize({ w, h });
    setInvPos({ x, y });
  };
  const onInvResizeEnd = (e: React.PointerEvent) => {
    if (!invRsRef.current) return;
    invRsRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    try {
      if (invSize) localStorage.setItem(INV_SIZE_KEY, JSON.stringify(invSize));
      if (invPos) localStorage.setItem(INV_POS_KEY, JSON.stringify(invPos));
    } catch { /* 프라이빗 모드 등 */ }
  };
  // 창이 화면 밖으로 나가지 않게 — 저장된 위치를 복원할 때 창 크기가 달라졌을 수 있다.
  // 창이 화면보다 크면(모바일) 위쪽에 붙인다.
  const clampInv = (x: number, y: number) => {
    const el = invPanelRef.current;
    const w = el?.offsetWidth ?? 420;
    const h = el?.offsetHeight ?? 320;
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(y, Math.max(8, window.innerHeight - h - 8))),
    };
  };
  // 처음 열 때 위치 결정 — 저장된 값이 있으면 그걸로, 없으면 오른쪽 위(가이드 본문을 덜 가린다)
  useEffect(() => {
    if (!invOpen) return;
    let saved: { x: number; y: number } | null = null;
    try {
      const raw = localStorage.getItem(INV_POS_KEY);
      if (raw) saved = JSON.parse(raw) as { x: number; y: number };
    } catch { /* 프라이빗 모드 등 */ }
    // 레이아웃이 잡힌 뒤에 재보정해야 창 크기를 알 수 있다
    const place = () => setInvPos(clampInv(
      saved?.x ?? window.innerWidth - (invPanelRef.current?.offsetWidth ?? 440) - 24,
      saved?.y ?? 84,
    ));
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [invOpen]);
  // 창 크기가 바뀌면 화면 밖으로 밀려나지 않게 다시 안으로
  useEffect(() => {
    if (!invOpen) return;
    const onResize = () => setInvPos((p) => (p ? clampInv(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [invOpen]);
  const onInvDragStart = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;   // 닫기 버튼은 드래그가 아니다
    const el = invPanelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    invDragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setInvDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();                                        // 헤더 텍스트가 드래그 선택되지 않게
  };
  const onInvDragMove = (e: React.PointerEvent) => {
    const d = invDragRef.current;
    if (d) setInvPos(clampInv(e.clientX - d.dx, e.clientY - d.dy));
  };
  const onInvDragEnd = (e: React.PointerEvent) => {
    if (!invDragRef.current) return;
    invDragRef.current = null;
    setInvDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setInvPos((p) => {
      if (p) try { localStorage.setItem(INV_POS_KEY, JSON.stringify(p)); } catch { /* 프라이빗 모드 등 */ }
      return p;
    });
  };
  const ownedRelics = useMemo(() => relicsAll.filter((r) => inv.has(r.id)), [relicsAll, inv]);
  const ownedRes = useMemo(() => resItems.filter((i) => inv.has(i.id)), [resItems, inv]); // eslint-disable-line react-hooks/exhaustive-deps
  // 비우기 확인은 사이트 공용 확인 모달(useConfirm) — window.confirm 금지 (사용자 확정 2026-07-24)
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [confirmBusy, setConfirmBusy] = useState(false); // 확인 모달이 떠 있는 동안 Esc 중복 처리 방지
  const clearInvTab = async (section: "relic" | "res") => {
    setConfirmBusy(true);
    const okd = await confirm({ message: t("이 탭의 보유 항목을 전부 비웁니다 — 계속할까요?"), danger: true });
    setConfirmBusy(false);
    if (!okd) return;
    setInvState((prev) => {
      const next = new Set([...prev].filter((id) => invSection(id) !== section));
      saveInv(next);
      return next;
    });
  };
  // Esc로 보유 모달 닫기 — 위에 상세 모달·확인 모달이 스택돼 있으면 그쪽 리스너만 닫는다
  useEffect(() => {
    if (!invOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !relicOpen && !confirmBusy) setInvOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [invOpen, relicOpen, confirmBusy]);
  const curModal = (): { type: string; id: string } | null =>
    relicOpen ? { type: "relic", id: relicOpen.id }
      : encOpen ? { type: "enc", id: encOpen.scene }
        : enemyOpen ? { type: "enemy", id: enemyOpen.key }
          : stageOpen?.n ? { type: "stage", id: stageOpen.n.id }
            : zoneOpen ? { type: "zone", id: zoneOpen.id }
              : null;
  // 전시관 서브탭도 URL에 실린다: #rg-archive~arc~<탭id> (사용자 요청 2026-07-24).
  // 모달이 열려 있으면 모달 해시가 우선 — 뒤로가기로 모달을 닫으면 arc 해시로 복귀한다.
  const hashFor = (v: string, m: { type: string; id: string } | null) =>
    `#rg-${v}${m ? `~${m.type}~${encodeURIComponent(m.id)}`
      : v === "archive" ? `~arc~${encodeURIComponent(activeArc)}` : ""}`;
  const applyHash = () => {
    const mt = window.location.hash.match(/^#rg-([a-z]+)(?:~([a-z]+)~(.+))?$/);
    if (!mt) return;
    const [, v, type, rawId] = mt;
    if (viewsFor().some((x) => x.id === v)) setView(v as View);
    setZoneOpen(null); setStageOpen(null); setEnemyOpen(null); setEncOpen(null); setRelicOpen(null);
    if (!type || !rawId) return;
    const id = decodeURIComponent(rawId);
    // 부품·사고·주화 상세도 같은 relic 해시를 쓴다 — 소장품에 없으면 통합 룩업으로 폴백
    if (type === "relic") { const r = relicById.get(id) ?? lensItemById.get(id); if (r) setRelicOpen(r); }
    else if (type === "enc") { const e = encByScene.get(id); if (e) setEncOpen(e); }
    else if (type === "enemy") { if (data.enemies[id]) setEnemyOpen({ key: id, ctx: dexCtx(id) }); }
    else if (type === "stage") { const s = stageById.get(id); if (s) setStageOpen(pairOf(s)); }
    else if (type === "zone") { const z = zoneById.get(id); if (z) setZoneOpen(z); }
    else if (type === "arc") setArcTab(id); // 무효 탭이면 activeArc 폴백이 첫 탭으로 처리
  };
  // 최신 applyHash를 ref로 노출 — 리스너가 stale 클로저를 잡지 않게
  // (렌더 중 ref 대입은 lint 에러라 effect에서 매 렌더 후 갱신 — 리스너는 렌더 후에만 발화)
  const applyHashRef = useRef(applyHash);
  useEffect(() => { applyHashRef.current = applyHash; });

  // ─── 스샷으로 찾기 (페이지 내 설치, 사용자 확정 2026-07-23) ───────────────────
  // 인식 목표는 sessionStorage 핸드오프로 적용한다 — 다른 토픽이 인식되면 토픽 전환 후
  // 데이터 로드 effect가 마저 적용해야 하므로 (동일 토픽이면 즉시).
  const [lensOpen, setLensOpen] = useState(false);
  const [lensInitial, setLensInitial] = useState<LensOutcome | null>(null); // tie 결과를 모달에 넘겨 테마 칩 표시
  const applyLensHandoff = () => {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem("ta:lens-handoff"); } catch { return; }
    if (!raw) return;
    let g: { page?: string; topic?: string; view?: string; arcTab?: string; modal?: { type: string; id: string }; highlight?: string[]; gather?: boolean; grade?: number; emergency?: boolean; items?: string[] };
    try { g = JSON.parse(raw); } catch { sessionStorage.removeItem("ta:lens-handoff"); return; }
    if (g.page && g.page !== "rogue") return; // 공채 등 다른 페이지 핸드오프는 해당 페이지가 소비
    if (g.topic !== topicRef.current) return; // 토픽 전환 완료 후 데이터 로드 effect에서 다시 불린다
    sessionStorage.removeItem("ta:lens-handoff");
    if (g.view && viewsFor().some((x) => x.id === g.view)) setView(g.view as View);
    if (g.arcTab) setArcTab(g.arcTab);
    // 좌하단 난이도 배지가 인식됐으면 난이도 셀렉터에 자동 적용 (사용자 요청 2026-07-24).
    // maxGrade memo는 이 함수보다 뒤에 선언되므로 여기서 직접 계산 (토픽별 15 또는 승천 18)
    if (typeof g.grade === "number" && g.grade >= 0) {
      const gmax = Math.max(15, ...data.difficulties.filter((df) => df.mode === "NORMAL").map((df) => df.grade));
      if (g.grade <= gmax) setGrade(g.grade);
    }
    setRelicTerm("", false); setMapTerm("", false); // 검색 필터가 하이라이트 대상을 가리지 않게
    setZoneOpen(null); setStageOpen(null); setEnemyOpen(null); setEncOpen(null); setRelicOpen(null);
    if (g.modal) {
      const { type, id } = g.modal;
      if (type === "relic") { const r = relicById.get(id); if (r) setRelicOpen(r); }
      else if (type === "enc") { const e = encByScene.get(id); if (e) setEncOpen(e); }
      else if (type === "stage") { const s = stageById.get(id); if (s) setStageOpen({ ...pairOf(s), init: g.emergency ? "e" : undefined }); }
      else if (type === "zone") { const z = zoneById.get(id); if (z) setZoneOpen(z); }
    }
    setLensHits(g.highlight?.length ? new Set(g.highlight) : null);
    // 아이템(유물·도구·음반·시스템)이 여러 개 인식되면 모아보기 모달로 띄운다 (gather 플래그)
    if (g.gather && (g.highlight?.length ?? 0) >= 2) {
      const rs = g.highlight!.map((id) => lensItemById.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
      setLensMulti(rs.length >= 2 ? rs : null);
    } else if (g.items?.length) {
      // 조우·작전 화면에 같이 떠 있던 소장품 — **한 개여도** 띄운다 (제보 16138722).
      // 조우 선택지는 보통 소장품을 하나씩 준다.
      const rs = g.items.map((id) => lensItemById.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
      setLensMulti(rs.length ? rs : null);
    } else {
      setLensMulti(null);
    }
  };
  const applyLensRef = useRef(applyLensHandoff);
  useEffect(() => { applyLensRef.current = applyLensHandoff; });
  // 데이터 로드 후(토픽 전환 포함) 적용 — 다른 토픽 인식 시 goTopic 후 이 effect가 마저 처리
  useEffect(() => {
    if (!mounted || !active) return;
    applyLensRef.current();
  }, [mounted, active, topic, navTick]);
  // 모달의 인식 결과 적용 — 같은 토픽이면 즉시, 다른 토픽이면 전환 후 위 effect가 처리
  const onLensGoto = (g: LensGoto) => {
    if (g.page !== "rogue") return;
    setLensOpen(false);
    setLensInitial(null);
    try { sessionStorage.setItem("ta:lens-handoff", JSON.stringify(g)); } catch { return; }
    if (g.topic !== topicRef.current) goTopic(g.topic);
    else applyLensRef.current();
  };
  // ── 페이지 레벨 클립보드 자동인식 토글 — 모달 없이 캡처만 하면 바로 이동 (사용자 요청 2026-07-23)
  // 기본 꺼짐 + 세션 비영속: 리프레시하면 항상 꺼진 상태로 시작한다 (사용자 확정 2026-07-24 —
  // 클립보드 폴링을 사용자가 켠 동안에만 돌리기 위해 localStorage 복원을 하지 않는다)
  const [lensAuto, setLensAuto] = useState(false);
  const toggleLensAuto = () => setLensAuto((v) => {
    const next = !v;
    if (next) { void warmOcr(ocrLangFor(locale)); warmData("rogue", locale, cnTopicNow()); } // 켜는 순간 화면 언어의 OCR·데이터 예열
    return next;
  });
  // ── 맵 노드 자동 이동 게이트 (제보 f1c050b2, 2026-09-04: "노드인식이 방해되는 경우가
  //    조금 있네요") ────────────────────────────────────────────────────────────
  // 인식 자체를 끄는 게 아니다 — **맵 노드(작전·조우·구역)로 튀는 이동만** 막고 소장품·
  // 도구·분대 인식은 그대로 둔다. 맵을 훑으며 노드를 하나씩 눌러 보는 동안 사이트가 계속
  // 그 작전 상세로 넘어가는 게 방해였다는 제보다.
  // ⚠ **PRTS 링크(live) 에만** 건다 — 스샷 레이더는 사람이 한 장씩 일부러 붙여넣는 것이라
  //   그 화면으로 가는 게 목적이다 (사용자 확정 2026-09-05 "prts에서만 켜고끄고").
  //   토글은 연결 중에만 떠 있는 브리지 토스트에 있다 (lens/bridge-button.tsx).
  // ⚠ 판정은 goto.view 로 한다 — SECTION_NAV(match.ts)에서 맵으로 가는 섹션이 stage·enc·zone
  //   셋이고 전부 view:"map" 이다. 섹션 이름을 여기 복제해 두면 새 섹션이 늘 때 어긋난다.
  // ⚠ journeyEvents 는 이 게이트보다 **먼저** 돈다 — 이동만 막히고 리플레이 기록(작전 입장·
  //   조우·구역)은 그대로 남는다.
  const lensGotoBlocked = (g: LensGoto, live: boolean) =>
    live && !bridgeNodeJump() && g.page === "rogue" && g.view === "map";
  // ── 화면에 같이 떠 있던 소장품 (제보 16138722, 2026-09-05) ─────────────────────
  // 조우 선택지가 주는 소장품은 **판마다 랜덤**이라 우리 조우 데이터엔 "소장품 1개 획득"
  // 으로만 적혀 있다 — 무엇인지는 화면에서 읽어야만 안다. 게임이 효과를 안 적어 주는
  // 것도 있어서(뱀파이어의 침대) 사이트가 채울 값이 실제로 있다.
  // ⚠ 이동 목표가 조우·작전이어도 인식 결과에는 그 소장품이 이미 들어 있다 —
  //   match.ts within()이 섹션 구분 없이 확신 엔티티를 모으고, 이동 목표만 우세 섹션으로
  //   정하기 때문이다. 버려지던 그것을 여기서 주워 쓴다.
  // ⚠ **'노드 이동' 토글과 무관하게** 보여 준다 (사용자 확정 2026-09-05). 그 토글은
  //   "이동만 끄고 아이템 인식은 그대로"가 취지인데, 조우가 맵 노드라 같이 막히면
  //   정작 이 정보를 못 보게 된다 — 제보자가 짚은 충돌이다.
  /** LensGoto 는 공채·스토리 변형이 있는 유니온이라, 통전 목표만 좁혀 쓴다 */
  const rogueGoto = (g: LensGoto) => (g.page === "rogue" ? g : null);
  const lensSideItems = (oc: LensOutcome): string[] => {
    if (oc.target.kind !== "goto") return [];
    const g = rogueGoto(oc.target.goto);
    if (!g || g.view !== "map") return [];   // 아이템 화면은 이미 모아보기가 맡는다
    return oc.entities.filter((e) => e.topic === g.topic && LENS_ITEM_SECTIONS.has(e.section)).map((e) => e.id);
  };
  /** 그 소장품들을 모아보기 창에 띄운다 — 띄운 개수를 준다 (0이면 안 띄운 것).
   *  이동 없이 띄우는 자리라 **지금 보고 있는 테마와 같을 때만** 한다 (다른 테마 항목은
   *  lensItemById에 없다 — 테마를 갈아타는 건 이동이고, 그건 토글이 막은 동작이다). */
  const showLensItems = (ids: string[], topic: string): number => {
    if (!ids.length || topic !== topicRef.current) return 0;
    const rs = ids.map((id) => lensItemById.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    if (rs.length) setLensMulti(rs);
    return rs.length;
  };
  const [lensMsg, setLensMsg] = useState<string | null>(null);
  const [lensThumb, setLensThumb] = useState<string | null>(null); // 인식 중/최근 이미지 미니 썸네일
  const lensMsgTimer = useRef<number | undefined>(undefined);
  const flashLensMsg = (msg: string | null, ms?: number) => {
    if (lensMsgTimer.current !== undefined) window.clearTimeout(lensMsgTimer.current);
    setLensMsg(msg);
    if (msg && ms) lensMsgTimer.current = window.setTimeout(() => setLensMsg(null), ms);
  };
  // 자동인식·필 드롭 공용 인식 흐름
  // 브리지 테마 고정 — 화면에 테마 이름이 보인 순간(앵커) 그 테마를 판의 기준으로 삼는다.
  // 사이트의 현재 토픽은 오인식 한 번에 오염돼 사전확률로 쓰면 연쇄 오판이 난다
  // (2026-07-26 제보: 사미 플레이 중 쉐이·살카즈로 튐). 다른 테마 메인화면을 띄우면 교체된다.
  const lensAnchor = useRef<string | null>(null);
  const lensBusy = useRef(false);
  // 화면을 훑어본 작전 — 아직 입장한 게 아니라 리플레이에 넣지 않고 쥐고만 있는다.
  // 입장이 확인되면(암전 로딩 또는 전투 화면) 그때 한 줄로 기록한다.
  const pendingStage = useRef<BridgeLogEvent | null>(null);
  // 리플레이의 난이도는 **사이트 난이도 셀렉터 값**을 쓴다 (사용자 제보 2026-07-26: "난이도 3인데
  // 자꾸 4로 기록됨"). 배지 OCR은 셀렉터를 자동으로 맞추는 데까지만 쓰고, 오독했으면 사용자가
  // 셀렉터를 고칠 수 있으므로 기록의 기준은 사람이 확인한 그 값이어야 한다.
  const gradeRef = useRef(grade);
  gradeRef.current = grade;
  // 여정 이벤트 변환 — 리플레이는 원시 인식이 아니라 **유저가 실제로 한 일**만 기록한다.
  // 사용자 확정 2026-07-26:
  //  · 작전은 노드를 눌러 봤다고 남기면 안 된다 → **입장 신호**(암전 로딩·전투 화면)가 와야 기록
  //  · 소장품도 화면에 떴다고 남기면 안 된다 → **보유 리스트에 담은 것만** (logInvPick)
  // 지도 복귀·상점 나열(모아보기)·인식 실패는 잡음이라 남기지 않는다.
  const journeyEvents = (oc: LensOutcome, cached: boolean): BridgeLogEvent[] => {
    const g = oc.target.kind === "goto" && oc.target.goto.page === "rogue" ? oc.target.goto : null;
    const result = cached ? undefined : oc.hud?.result;
    const type = result ? "battle-result" : g ? (g.modal?.type ?? g.view) : "";
    const base = (t2: string): BridgeLogEvent => ({
      at: new Date().toISOString(),
      type: t2,
      name: oc.entities[0]?.name,
      names: oc.entities.length > 1 ? oc.entities.slice(0, 8).map((e) => e.name) : undefined,
      arc: g?.arcTab,
      emergency: g?.emergency,
      grade: gradeRef.current >= 0 ? gradeRef.current : undefined, // 셀렉터 값 (EASY=-1은 등급 없음)
      hp: cached ? undefined : oc.hud?.hp,
      levelExp: cached ? undefined : oc.hud?.levelExp,
      result,
      cached: cached || undefined,
    });
    // 쥐고 있던 작전을 흘려보낸다 — 전투 화면이나 결과가 보이면 그 작전에 들어간 게 확실하다
    const flush = (): BridgeLogEvent[] => {
      const held = pendingStage.current;
      pendingStage.current = null;
      return held ? [held] : [];
    };
    if (type === "battle-result") return [...flush(), base("battle-result")];
    if (oc.battle) return flush();                      // 전투 화면 자체는 기록하지 않는다
    if (type === "stage") {
      const ev = base("stage");
      // 암전 로딩(입장) 화면이면 그 자리에서 확정, 지도의 노드 미리보기면 보류
      if (oc.dark) { pendingStage.current = null; return [ev]; }
      pendingStage.current = ev;
      return [];
    }
    if (!["enc", "zone", "archive"].includes(type)) return [];
    if (type === "archive" && !oc.entities[0]?.name) return [];   // 특정 항목 없는 전시관 이동은 제외
    return [base(type)];
  };
  const handleLensShot = async (file: File, live = false) => {
    if (lensBusy.current) return;
    lensBusy.current = true;
    setLensThumb((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    flashLensMsg(t("스캔 중…"));
    try {
      // 테마별 게임연결로 고정돼 있으면 그 테마가 절대 기준 — 앵커·사이트 토픽보다 우선
      const lock = bridgeLock();
      // cnTopicNow() — 스샷 레이더·PRTS 링크 공용 경로다(이 함수 하나를 클립보드·드롭·
      // 브리지가 같이 쓴다). 중섭이면 그 테마의 CN 이름으로도 매칭한다.
      const oc = await recognizeShot("rogue", file, lock?.topic ?? lensAnchor.current ?? topicRef.current,
        locale, { lock: !!lock, live, cnTopic: cnTopicNow() });
      if (oc.anchor) lensAnchor.current = oc.anchor;
      // 플레이 로그 — 라이브(게임 연결) 인식은 전부 기록한다. '리플레이 다운받기'로 내려간다.
      if (live) {
        // 브리지에 판정을 알려준다 — 전투면 전투 홀드, 확신 이동이면 화면 판정 캐시
        memoBridgeScene(oc);
        for (const ev of journeyEvents(oc, false)) logBridgeEvent(ev);
      }
      if (oc.target.kind === "goto" && lensGotoBlocked(oc.target.goto, live)) {
        // 맵 노드 이동을 꺼 뒀다 — 인식·기록은 이미 위에서 끝났고 이동만 건너뛴다.
        // 다만 화면에 소장품이 같이 떠 있었으면 그 효과는 띄운다 (토글과 무관, 위 주석).
        const side = showLensItems(lensSideItems(oc), rogueGoto(oc.target.goto)?.topic ?? "");
        noteBridge(side ? t("소장품 {n}개", { n: side }) : t("노드 이동 꺼짐"));
        flashLensMsg(side
          ? t("화면에서 소장품을 찾았습니다 — 노드 이동은 꺼져 있어 그대로 둡니다.")
          : t("맵 노드를 인식했지만 '노드 이동'이 꺼져 있어 이동하지 않았습니다."), 2000);
      } else if (oc.target.kind === "goto") {
        const items = lensSideItems(oc);
        const rg = rogueGoto(oc.target.goto);
        onLensGoto(rg && items.length ? { ...rg, items } : oc.target.goto);
        noteBridge(oc.entities[0]?.name ?? t("이동"));
        flashLensMsg(t("인식 완료 — 해당 정보로 이동했습니다."), 2000);
      } else if (oc.target.kind === "tie") {
        // 테마 선택 전용 미니 모달을 연다
        setLensInitial(oc);
        noteBridge(t("테마 되묻기"));
        flashLensMsg(null);
      } else {
        noteBridge(oc.battle ? t("전투 중") : t("못 찾음"));
        flashLensMsg(t("인식된 정보가 없습니다 — 분대·유물·조우·작전 화면을 캡처해 보세요."), 3000);
      }
    } catch {
      flashLensMsg(t("인식에 실패했습니다 — 다른 스크린샷으로 다시 시도해 주세요."), 3000);
    } finally {
      lensBusy.current = false;
    }
  };
  const lensClip = useClipboardWatch(lensAuto && !lensOpen, handleLensShot);
  // 게임 브리지(크롬 확장) — 클립보드와 같은 프레임 공급원. 스샷 레이더 토글과 무관하게,
  // 연결돼 있으면 게임 화면이 바뀔 때마다 여기로 들어와 같은 판정·이동 경로를 탄다.
  const bridgeOn = useBridgeWatch(!lensOpen, (file) => handleLensShot(file, true), (oc) => {
    // 화면 판정 캐시 재적용 — 이미 본 화면으로 돌아온 것. OCR 없이 지난 판정으로 바로 이동.
    // HUD 수치는 그때 것이라 신선하지 않으므로 로그에 싣지 않는다 (cached 표기).
    if (oc.target.kind !== "goto") return;
    for (const ev of journeyEvents(oc, true)) logBridgeEvent(ev);
    const side = lensSideItems(oc);
    const rg = rogueGoto(oc.target.goto);
    if (lensGotoBlocked(oc.target.goto, true)) {
      const n = showLensItems(side, rg?.topic ?? "");
      noteBridge(n ? t("소장품 {n}개", { n }) : t("노드 이동 꺼짐"));
      return;
    }
    onLensGoto(rg && side.length ? { ...rg, items: side } : oc.target.goto);
    noteBridge(oc.entities[0]?.name ?? t("이동"));
  });
  useEffect(() => {
    if (!bridgeOn) return;
    // 첫 인식에서 wasm·traineddata(~9MB) 로드로 수 초를 잃지 않게 연결 즉시 예열.
    // 난이도 배지 워커(eng)도 미리 — 배지 OCR은 본 패스와 병렬이라 초기화만 숨기면 공짜다.
    // 난이도 캐시는 연결 단위로 리셋 — 지난 판의 난이도가 새 판에 새지 않게.
    resetGradeCache();
    warmOcr(ocrLangFor(locale));
    void warmDigitOcr();
    // 중섭 인덱스는 로케일+테마 조합으로 캐시된다 — 지금 켜져 있는 조합을 예열해야
    // 첫 인식에서 다시 받지 않는다. (서버를 나중에 바꾸면 그때 온디맨드로 받는다)
    warmData("rogue", locale, cnTopicNow());
  }, [bridgeOn, locale]);
  // 자동인식 동안 창 전체가 드롭존 — 드래그 중이면 필을 드롭 가능 상태로 강조
  const lensDragging = useDropWatch(lensAuto && !lensOpen, handleLensShot);
  // 하이라이트 카드로 스크롤 (렌더 뒤 한 프레임 양보).
  // 소장품(relic)·모아보기(사고 등 다중 인식)는 모달이 뜨므로 스크롤 불필요 (사용자 확정 2026-07-24)
  useEffect(() => {
    if (!lensHits || view === "relic" || lensMulti) return;
    const id = window.setTimeout(() => {
      document.querySelector(".rg-lens-hit")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(id);
  }, [lensHits, view, arcTab, lensMulti]);
  const inited = useRef(false);
  // 데이터 로드 후 최초 1회: URL 해시대로 뷰·모달 복원 (복붙 딥링크 진입)
  useEffect(() => {
    if (!mounted || !active || inited.current) return;
    inited.current = true;
    applyHashRef.current();
  }, [mounted, active]);
  // 같은 페이지에서 해시가 바뀌면(뒤로/앞으로·수동 편집) 재적용
  useEffect(() => {
    if (!mounted) return;
    const onHash = () => { if (inited.current) applyHashRef.current(); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [mounted]);
  // 상태 → URL 동기화 (모달 새로 열림=pushState라 뒤로가기로 닫힘, 그 외=replaceState)
  const prevHash = useRef("");
  useEffect(() => {
    if (!mounted || !inited.current) return;
    // 전역 모달 딥링크(#changelog·#replay 등)가 떠 있으면 내 해시로 덮어쓰지 않는다 (2026-07-27)
    if (GLOBAL_MODAL_HASH.test(window.location.hash)) return;
    const want = hashFor(view, curModal());
    if (want === (window.location.hash || "#rg-map")) { prevHash.current = want; return; }
    // arc 해시(~arc~)도 "~"를 포함하므로, 모달 열림 판정은 모달 타입 페어에만 반응해야 한다
    const hadModal = /~(relic|enc|enemy|stage|zone)~/.test(prevHash.current);
    const opening = curModal() !== null && !hadModal;
    // ⚠ vinext가 history.pushState를 인스턴스 패치해 내비게이션으로 취급 — .site-scroll을
    // 맨 위로 리셋한다 (사용자 리포트 2026-07-24: 모달 열면 스크롤이 튐). 모달 해시 기록은
    // 스크롤을 건드리면 안 되므로 네이티브 프로토타입을 직접 불러 라우터를 우회한다
    // (replaceState는 패치돼 있어도 스크롤 리셋 없음 — 실측).
    if (opening) History.prototype.pushState.call(history, null, "", want);
    else history.replaceState(null, "", want);
    prevHash.current = want;
  }, [view, zoneOpen, stageOpen, enemyOpen, encOpen, relicOpen, activeArc, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  // 「이름」·'이름' 참조 하나를 해석 — 스테이지/소장품/조우/적/테마 항목(암호판 등) 순.
  // 동명 조우·소장품(IS2 하트 오브 카이룰라)은 문맥 판별: 바로 뒤 콜론이면 단계 라벨=조우,
  // 그 외(획득·소지·나열)는 아이템 (사용자 확인 2026-08-17). 아무것도 아니면 원문 그대로
  // — '캠프 수색' 같은 선택지 텍스트는 링크 대상이 없어 평문으로 남는다.
  const condRef = (name: string, disp: string, after: string, key: string): React.ReactNode => {
    const s = stageByName.get(name);
    if (s) return <button key={key} type="button" className="rg-cond-node" onClick={() => setStageOpen(pairOf(s))}>{disp}</button>;
    const rl = relicByName.get(name);
    const enc = encByTitle.get(name);
    if (rl && enc) {
      const labelish = /^\s*[:：]/.test(after);
      return labelish
        ? <button key={key} type="button" className="rg-cond-node" onClick={() => setEncOpen(enc)}>{disp}</button>
        : <button key={key} type="button" className="rg-cond-node relic" onClick={() => setRelicOpen(rl)}>{disp}</button>;
    }
    if (rl) return <button key={key} type="button" className="rg-cond-node relic" onClick={() => setRelicOpen(rl)}>{disp}</button>;
    if (enc) return <button key={key} type="button" className="rg-cond-node" onClick={() => setEncOpen(enc)}>{disp}</button>;
    const en = enemyByName.get(name);
    if (en) return <button key={key} type="button" className="rg-cond-node" onClick={() => setEnemyOpen({ key: en, ctx: dexCtx(en) })}>{disp}</button>;
    // 암호판·사고·주화 등 테마 고유 항목 (「공허」·「상흔」 — 사용자 지시 2026-08-17)
    const mech = mechByName.get(name);
    if (mech) return <button key={key} type="button" className="rg-cond-node relic" onClick={() => setRelicOpen(mech)}>{disp}</button>;
    return disp;
  };
  // 조건 문장 — 「」에 더해 '이름'(홑따옴표)도 참조로 해석한다 (사용자 지적 2026-08-17:
  // '변화' 같은 조우 참조가 홑따옴표라 매핑이 안 됐다)
  const renderCond = (text: string) => {
    const out: React.ReactNode[] = [];
    const re = /「([^」]+)」|'([^']+)'/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const name = m[1] ?? m[2]!;
      const disp = m[1] !== undefined ? `「${name}」` : `'${name}'`;
      out.push(condRef(name, disp, text.slice(re.lastIndex, re.lastIndex + 4), `c${k++}`));
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };
  // 조우 선택지 보상의 「소장품명」을 소장품 상세 모달로 여는 링크로 (사용자 요청 2026-07-20).
  // 소장품이 아닌 「」 텍스트는 그대로 둔다.
  // 「」 없는 평문 속 소장품명도 링크 — PRTS 안내 노트의 "No.221 하트 오브 카이룰라 (…)"류
  // (사용자 지시 2026-08-17). 오탐 방지: 4자 이상 이름만, 긴 이름 우선 매칭.
  // 테마 고유 시스템(암호판·사고·주화·부품 등) 이름 → 항목 — 「공허」·「상흔」 같은
  // 암호판 참조도 상세로 연결 (사용자 지시 2026-08-17). 소장품과 동명이면 소장품 우선.
  const mechByName = useMemo(() => {
    const m = new Map<string, InvItem>();
    for (const mech of data.mechanics ?? []) for (const it of mech.items) if (!m.has(it.name)) m.set(it.name, it);
    for (const s of data.scraps ?? []) if (!m.has(s.name)) m.set(s.name, s);
    return m;
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const relicNamesByLen = useMemo(
    () => [...relicByName.keys()].filter((n) => n.length >= 4).sort((a, b) => b.length - a.length),
    [relicByName]);
  const linkFreeRelics = (seg: string, keyBase: string): React.ReactNode[] => {
    for (const nm of relicNamesByLen) {
      const idx = seg.indexOf(nm);
      if (idx >= 0) {
        const rl = relicByName.get(nm)!;
        return [
          ...linkFreeRelics(seg.slice(0, idx), `${keyBase}a`),
          <button key={`${keyBase}b`} type="button" className="rg-choice-relic" onClick={() => setRelicOpen(rl)}>{nm}</button>,
          ...linkFreeRelics(seg.slice(idx + nm.length), `${keyBase}c`),
        ];
      }
    }
    return seg ? [seg] : [];
  };
  const linkRelic = (text: string | null): React.ReactNode => {
    if (!text) return text;
    const parts = text.split(/「([^」]+)」/g);
    return parts.map((part, i) => {
      if (i % 2 === 0) return part ? <Fragment key={i}>{linkFreeRelics(part, `s${i}`)}</Fragment> : part;
      const rl = relicByName.get(part);
      return rl
        ? <button key={i} type="button" className="rg-choice-relic" onClick={() => setRelicOpen(rl)}>{part}</button>
        : `「${part}」`;
    });
  };

  const hasEasy = data.difficulties.some((d) => d.mode === "EASY");
  const normalName = data.difficulties.find((d) => d.mode === "NORMAL")?.name ?? "";
  const easyName = data.difficulties.find((d) => d.mode === "EASY")?.name ?? "";
  // 최고 난이도는 토픽마다 다르다 (IS1/3/6=15, IS2/4/5=승천 18) — 데이터에서 읽는다.
  // switchTopic이 토픽 전환 시 grade를 0으로 리셋하므로 별도 클램프는 불필요.
  const maxGrade = useMemo(() => Math.max(15, ...data.difficulties.filter((d) => d.mode === "NORMAL").map((d) => d.grade)), [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // 마운트 전(=SSR 프리렌더 + 클라 첫 렌더)엔 무거운 본문 없이 **히어로만** 그린다.
  // 본문(존·적·소장품)은 300~800KB라 동적 로드이고, 여기서 토픽별로 다른 걸 그리면
  // 하이드레이션이 어긋난다 — 그래서 라우트가 알려준 토픽(initialTopic)일 때만 그 테마의
  // 이름·도입문을 쓴다. 서버와 클라가 같은 값을 보므로 미스매치가 없고, /rogue/<slug>의
  // 정적 HTML에 제목과 소개가 담긴다 (종전엔 "불러오는 중" 한 줄뿐이었다, 2026-08-06).
  if (!mounted) {
    const seed = initialTopic ? ROGUE_INDEX[initialTopic]?.[locale] ?? ROGUE_INDEX[initialTopic]?.ko : null;
    return (
      <section className={`rg${!initialTopic || initialTopic === "rogue_1" ? "" : " rg" + initialTopic.split("_")[1]}`} aria-labelledby="rg-title">
        {seed && (
          <header className="rg-head">
            <div className="rg-hero">
              <img className="rg-hero-kv" src={asset(`/rogue/kv${initialTopic!.split("_")[1]}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />
              <div className="rg-hero-text">
                <span className="rg-eyebrow">INTEGRATED STRATEGIES</span>
                <h2 id="rg-title">{seed.name}</h2>
                <p className="rg-line">{seed.line}</p>
              </div>
            </div>
          </header>
        )}
        <p className="rg-loading">{t("데이터를 불러오는 중...")}</p>
      </section>
    );
  }

  // 보유 리스트 진입 버튼 — 각 뷰의 검색·필터 줄 **맨 오른쪽**에 붙인다 (사용자 지정 2026-07-26,
  // 종전 위치는 탭 줄). 뷰마다 필터 줄이 따로라 같은 엘리먼트를 재사용한다(동시에 그려지지 않음).
  // 자국 서버 표기 — 화면 언어에 따라 한국/글로벌/일본 (사용자 지적 2026-08-04)
  const homeServer = HOME_SERVER[locale] ?? HOME_SERVER.ko;
  const homeServerFull = t("{label} 서버", { label: t(homeServer.label) });

  const invButton = (
    <button type="button" className="rg-inv-open" onClick={() => setInvOpen(true)}
      title={t("소장품·자원 카드의 「＋ 보유」 버튼으로 담아두고 여기서 한눈에 봅니다")}>
      🎒 {t("보유 리스트")}
      {inv.size > 0 && <em className="rg-inv-count">{inv.size}</em>}
      {/* 창을 열어야 보이는 기능(Σ 효과 총합)도 여기서 알린다 — 새 기능을 창 안에 넣으면 키를 추가 */}
      {anyNewFeature("rogue-inv", "rogue-eff") && <span className="new-badge">{t("새기능")}</span>}
    </button>
  );

  return (
    <section className={`rg${topic === "rogue_1" ? "" : " rg" + topic.split("_")[1]}`} aria-labelledby="rg-title">
      <header className="rg-head">
        <div className="rg-hero">
          <img className="rg-hero-kv" src={asset(`/rogue/kv${topic.split("_")[1]}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />
          <div className="rg-hero-text">
            <span className="rg-eyebrow">INTEGRATED STRATEGIES</span>
            {/* 제목은 현재 테마 이름 — 테마 전환은 햄버거 '통합전략 가이드' 부메뉴/드롭다운 (사용자 확정 2026-07-18) */}
            <h2 id="rg-title">{t(TOPICS.find((tp) => tp.id === topic)?.name ?? "통합전략 가이드")}{TOPICS.find((tp) => tp.id === topic)?.future && <em className="rg-title-future">{t("미래시")}</em>}{server === "cn" && data.cnName && <span className="rg-title-cn" lang="zh">{data.cnName}</span>}</h2>
            {/* 중국섭 안내 한 줄 — 한국섭일 때도 같은 자리를 투명하게 예약해 서버 전환 시
                히어로 높이가 변하지 않게 한다 (사용자 요청 2026-08-04). 눈썹 줄에 넣는 안은
                도구 버튼 때문에 가용 폭이 160px뿐이라 문구가 잘려 폐기. CN 원제는 제목 오른쪽.
                블랙플로우도 같은 자리·같은 꼴 — 다만 KR 미출시라 문구가 '비공식 번역'이다. */}
            <p className="rg-disclaimer" aria-hidden={server !== "cn"}>
              {/* 한국섭에선 문구 자체를 렌더하지 않고 빈 줄(nbsp)만 남긴다 — CSS로 숨기면
                  스타일이 늦게 붙는 순간 중국섭 문구가 그대로 노출된다 (실측 2026-08-04) */}
              {server !== "cn" ? " "
                : topic === "rogue_6"
                  ? (locale === "ko"
                    ? t("CN 선행 데이터 기반 · 명칭은 비공식 번역이며 중국어 원문을 병기합니다.")
                    : t("이 테마는 CN 선행 데이터라 아직 한국어·중국어로만 제공됩니다."))
                  : (locale === "ko"
                    ? t("중국 서버 데이터 기반 · 한국 서버 공식 번역으로 표기하고 중국어 원문을 병기합니다.")
                    : t("중국 서버 데이터는 아직 한국어·중국어로만 제공됩니다."))}
            </p>
            {data.line && <p className="rg-line">{data.line}</p>}
          </div>

          {/* 난이도 선택 — 배너 우하단, 모든 스탯 표시에 반영 */}
          <div className="rg-diffbar" role="group" aria-label={t("난이도 선택")}>
            <span className="rg-diffbar-label">{t("난이도")}</span>
            {hasEasy && <button type="button" className={`rg-diff-chip${grade < 0 ? " on" : ""}`} onClick={() => setGrade(-1)}>{t("쉬움")}</button>}
            <input type="range" min={0} max={maxGrade} value={Math.max(0, grade)}
              onChange={(e) => setGrade(Number(e.target.value))}
              aria-label={t("난이도 등급")} />
            <span className={`rg-diff-cur${grade >= 0 ? " on" : ""}`}>
              {grade >= 0 && <em className="rg-diff-hex">{grade}</em>}
              {grade < 0 ? easyName : normalName}
            </span>
          </div>
        </div>

        {/* 배너 오른쪽 위 도구 열 — 위: 게임연결·리플레이·스샷 레이더, 아래: 테마 변경
            (사용자 지정 2026-07-26). ⚠ .rg-hero 안에 두면 overflow:hidden에 펼친 메뉴가
            잘린다 — 반드시 .rg-head 직속(클리핑 밖)에 두고 absolute로 겹칠 것 */}
        <div className="rg-headtools">
        {/* 스샷 레이더 — 버튼 자체가 자동인식 토글, ?는 도움말 모달. KR/EN/JA 화면 인식 (2026-07-25).
            블랙플로우(rogue_6)·중국섭 데이터는 중국어 병기라 중국어 화면도 전 로케일에서 인식한다. */}
        <div className="lens-open-wrap">
          {/* 테마별 게임연결 + 리플레이 — 여기서 연결하면 이 테마로만 인식이 고정된다 (2026-07-26) */}
          {BRIDGE_LIVE && <BridgeTopicButton topic={topic} name={TOPICS.find((tp) => tp.id === topic)?.name ?? topic} t={t} />}
          <button type="button" className={`lens-open-btn${lensAuto ? " on" : ""}`} aria-pressed={lensAuto}
            title={t("클릭해 스샷 자동인식을 켜고 끕니다 — 켜두면 게임 화면을 캡처만 해도 바로 인식·적용됩니다")}
            onClick={toggleLensAuto}>
            <span className="lens-auto-knob" aria-hidden />📷 {t("스샷 레이더")}{isNewFeature("lens") && <span className="new-badge">{t("새기능")}</span>}
          </button>
          <button type="button" className="lens-help-btn" aria-label={t("스샷 레이더 도움말")}
            onClick={() => setLensOpen(true)}>?</button>
        </div>
        {/* 테마 변경 드롭다운 — 네이티브 select 대신 테마 톤에 맞춘 커스텀 리스트박스 (2026-07-19) */}
        <div className="rg-topicsel" ref={topicSelRef}>
          <button type="button" className="rg-topicsel-btn" aria-haspopup="listbox" aria-expanded={topicMenu}
            onClick={() => setTopicMenu((v) => !v)}>
            <span className="rg-topicsel-label">{t("테마 변경")}</span>
            <span className="rg-topicsel-cur">
              <i className="rg-topicsel-dot" style={{ background: TOPIC_HUE[topic], boxShadow: `0 0 8px ${TOPIC_HUE[topic]}` }} aria-hidden />
              {t(TOPICS.find((tp) => tp.id === topic)?.name ?? "통합전략 가이드")}
            </span>
            <span className={`rg-topicsel-arrow${topicMenu ? " up" : ""}`} aria-hidden>▾</span>
          </button>
          {/* 한섭/중섭 미니 토글 — 테마 변경 버튼 우상단에 겹쳐 얹는다 (사용자 요청 2026-08-04:
              "테마변경 버튼 안에 작게"). 버튼 안에 버튼은 못 넣으므로 형제를 absolute로 올린다.
              블랙플로우는 KR 미출시라 한국 버튼 비활성 */}
          <div className="rg-serversel" role="group" aria-label={t("서버 선택")}>
            <button type="button" className={server === "kr" ? "on" : ""} aria-pressed={server === "kr"}
              disabled={topic === "rogue_6"} aria-label={homeServerFull}
              title={topic === "rogue_6" ? t("{sv} 미출시 테마 — 중국 서버 데이터만 제공됩니다", { sv: homeServerFull }) : homeServerFull}
              onClick={() => goServer("kr")}>{t(homeServer.short)}</button>
            <button type="button" className={server === "cn" ? "on" : ""} aria-pressed={server === "cn"}
              aria-label={t("중국 서버")} title={t("중국 서버")}
              onClick={() => goServer("cn")}>{t("중국섭")}</button>
            {/* 배지는 버튼 안이 아니라 토글 컨테이너 직속 — 버튼 안에 두면 그 좁은 버튼이
                기준이 돼 글자가 세로로 깨진다 (실측 2026-08-04) */}
            {isNewFeature("rogue-cn") && <span className="new-badge">{t("새기능")}</span>}
          </div>
          {topicMenu && (
            <ul className="rg-topicsel-menu" role="listbox" aria-label={t("테마 변경")}>
              {/* 미래시 토픽도 항상 목록에 둔다 — 흑백(.fut-dim) + '미래시' 표식 (2026-09-04 규칙 변경) */}
              {TOPICS.filter((tp) => tp.ready).map((tp) => (
                <li key={tp.id} role="option" aria-selected={tp.id === topic}>
                  {/* 실제 앵커 — 크롤러가 테마 페이지로 따라갈 내부 링크이자 새 탭 대상 (2026-08-06).
                      클릭은 종전대로 가로채 그 자리에서 전환한다. */}
                  {/* 중국섭 탭에선 전 토픽이 CN 서버 콘텐츠라 흑백 처리하지 않는다 */}
                  <a href={roguePath(LOCALE_BASE[locale] ?? "", tp.id)}
                    className={`${tp.id === topic ? "on" : ""}${tp.future && server !== "cn" ? " fut-dim" : ""}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault(); setTopicMenu(false); goTopic(tp.id);
                    }}>
                    <i className="rg-topicsel-dot" style={{ background: TOPIC_HUE[tp.id], boxShadow: `0 0 8px ${TOPIC_HUE[tp.id]}` }} aria-hidden />
                    <span className="rg-topicsel-name">{t(tp.name)}</span>
                    {tp.future && <em className="rg-topicsel-future">{t("미래시")}</em>}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        </div>
      </header>

      {loading && <p className="rg-loading">{t("데이터를 불러오는 중...")}</p>}

      {!loading && (<>
      <nav className="rg-tabs" aria-label={t("통합전략 섹션")}>
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={view === v.id ? "on" : ""} onClick={() => goView(v.id)}>{t(v.label)}</button>
        ))}
      </nav>
      {/* 자동인식 상태 필 — fixed 오버레이(레이아웃 안 밀음) + 인식 이미지 미니 썸네일.
          드롭은 창 전체가 받고(useDropWatch), 드래그 중이면 필이 드롭 가능 상태로 강조된다 */}
      {lensAuto && (
        <div className={`lens-auto-pill${lensMsg ? " busy" : ""}${lensDragging ? " drop" : ""}`} role="status">
          {lensThumb && !lensDragging && <img className="lens-auto-thumb" src={lensThumb} alt={t("인식한 스크린샷")} />}
          <span>{lensDragging ? t("여기든 어디든, 놓으면 바로 인식합니다") : lensMsg ?? (lensClip === "off"
            ? t("클립보드 접근이 막혀 있습니다 — 이미지를 화면에 드롭하거나 ⌘V로 붙여넣으세요")
            : t("스샷 자동인식 켜짐 — 게임 화면을 캡처하고 돌아오거나, 이미지를 화면에 드롭하세요"))}</span>
        </div>
      )}

      {view === "map" && (
        <div className="rg-map">
          {/* 노드 이름 검색 — 작전·보스·조우 전투·특수·우연한 만남 전부 (사용자 요청 2026-07-18) */}
          <div className="rg-filterbar rg-map-search">
            <input type="search" {...mapProps}
              placeholder={t("노드 이름 검색 (작전·조우·우연한 만남)")} aria-label={t("노드 이름 검색 (작전·조우·우연한 만남)")} />
            {mapHits && <span className="rg-count">{mapHits.stages.length + mapHits.encs.length}</span>}
            {invButton}
          </div>

          {mapHits && (<>
            {mapHits.stages.length === 0 && mapHits.encs.length === 0 && (
              <p className="rg-zone-desc">{t("검색 결과가 없습니다.")}</p>
            )}
            {mapHits.stages.length > 0 && (
              <div className="rg-stage-group rg-map-hits">
                <h4>{t("전투 노드")} <em>{mapHits.stages.length}</em></h4>
                <div className="rg-stage-cards">
                  {mapHits.stages.map((s) => (
                    <StageCard key={s.id} pair={pairOf(s)} onOpen={setStageOpen} boss={s.kind === "boss"} />
                  ))}
                </div>
              </div>
            )}
            {mapHits.encs.length > 0 && (
              <div className="rg-stage-group rg-map-hits">
                <h4>{t("우연한 만남")} <em>{mapHits.encs.length}</em></h4>
                <div className="rg-enc-list">
                  {mapHits.encs.map((enc) => (
                    <button key={enc.scene} type="button" className="rg-enc-item" onClick={() => setEncOpen(enc)}>
                      {enc.bg
                        ? <img className="rg-enc-thumb" src={asset(`/rogue/scene/${enc.bg}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />
                        : <span className="rg-enc-thumb none" aria-hidden />}
                      <span className="rg-enc-txt">
                        {enc.floors && <span className="rg-enc-floors">{enc.floors.join("·")}{t("층")}</span>}
                        <span className="rg-enc-title"><Nm name={enc.title} cn={enc.cn} /></span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>)}

          {!mapHits && (<>
          {/* 층 카드 — 가로 일렬, 클릭하면 층 상세 모달 (사용자 확정 2026-07) */}
          <div className="rg-zone-cards">
          {data.zones.map((z) => {
            const pairs = z.variant ? [] : (pairsByZone.get(z.num) ?? []).concat(trialPairsFor(z));
            const zoneBosses = z.variant ? [] : bossStages.filter((s) => s.zone === z.num);
            return (
              <button type="button" key={z.id} className={`rg-zonecard${z.hidden ? " hidden-zone" : ""}`}
                onClick={() => setZoneOpen(z)}>
                {z.img && <img className="rg-zonecard-bg" src={asset(`/rogue/zone/${z.bg ?? `${data.id}_map_${z.num}`}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                <span className="rg-zone-num">{zoneBadge(z)}</span>
                <span className="rg-zonecard-name"><Nm name={z.name} cn={z.cn} /></span>
                {z.variant && <span className="rg-zone-hidden">{t("변형 구역")}</span>}
                {z.hidden && <span className="rg-zone-hidden">{t("히든 층")}</span>}
                <span className="rg-zone-counts">
                  {pairs.length > 0 && t("작전 {n}개", { n: pairs.length })}
                  {zoneBosses.length > 0 && ` · ${t("보스 {n}개", { n: zoneBosses.length })}`}
                </span>
              </button>
            );
          })}
          </div>

          {/* 층이 배정되지 않은 보스(험난한 길) — 층 큐레이션이 없는 토픽에서 보스맵이 누락되지 않도록 폴백 */}
          {orphanBosses.length > 0 && (
          <details className="rg-zone rg-zone-wide" open>
            <summary className="rg-zone-sum">
              <h3 className="boss">{t("험난한 길 (보스)")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: orphanBosses.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("각 구역 끝에서 마주치는 강력한 적입니다.")}</p>
              <div className="rg-stage-cards">
                {orphanBosses.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} boss />)}
              </div>
            </div>
          </details>
          )}

          {(evStages.length > 0 || specialStages.length > 0) && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("조우 전투")} · {t("특수")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: evStages.length + specialStages.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("우연한 만남 등 이벤트에서 발생하는 전투입니다. 카드를 열면 일반/긴급 탭이 있는 경우 전환할 수 있습니다.")}</p>
              <div className="rg-stage-cards">
                {evStages.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} />)}
                {specialStages.map((s) => <StageCard key={s.id} pair={pairOf(s)} onOpen={setStageOpen} />)}
              </div>
            </div>
          </details>
          )}

          {trialStages.length > 0 && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("시련·특수 전투")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: trialStages.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <div className="rg-stage-cards">
                {trialStages.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} />)}
              </div>
            </div>
          </details>
          )}

          {incidentStages.length > 0 && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("조우 전투")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: incidentStages.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("우연한 만남 등 이벤트에서 발생하는 전투입니다. 카드를 열면 일반/긴급 탭이 있는 경우 전환할 수 있습니다.")}</p>
              <div className="rg-stage-cards">
                {incidentStages.map((s) => <StageCard key={s.id} pair={pairOf(s)} onOpen={setStageOpen} />)}
              </div>
            </div>
          </details>
          )}

          {chaseStages.length > 0 && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("추격전")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: chaseStages.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("행동력이 다 떨어지면 강제로 발생하는 전투입니다. 보스 층에서는 보스 특수판으로 대체됩니다.")}</p>
              <div className="rg-stage-cards">
                {chaseStages.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} />)}
              </div>
            </div>
          </details>
          )}

          {savageStages.length > 0 && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("거점전 ('주민' 거점)")}</h3>
              <span className="rg-zone-counts">{t("작전 {n}개", { n: savageStages.length })}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("난이도(보밀등급) 4 이상에서만 나타나는 '주민' 거점 노드의 전투입니다. 거점을 격파해 '주민'을 옮겨내면 '주민'의 악의를 완전히 없앨 수 있습니다.")}</p>
              <div className="rg-stage-cards">
                {savageStages.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} />)}
              </div>
            </div>
          </details>
          )}

          {/* 기타 노드 — 전투·우연한 만남 외 노드 타입 설명. 외나무다리 상세에 결투 전투 포함 (사용자 요청 2026-07-18) */}
          {otherNodes.length > 0 && (
          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("기타 노드")}</h3>
              <span className="rg-zone-counts">{otherNodes.length}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{t("지도에서 마주치는 전투 외 특수 노드들입니다.")}</p>
              <div className="rg-nodetype-list">
                {otherNodes.map((nt) => (
                  <article key={nt.id} className={`rg-nodetype${nt.id === "DUEL" && duelStages.length > 0 ? " wide" : ""}`}>
                    <h4>
                      {/* 게임 지도에 그려지는 그 글리프를 그대로 병기 — 종류가 많은 테마일수록
                          글자보다 그림이 빠르다 (제보 2026-07-29). 아이콘이 없는 타입은 글자만. */}
                      <NodeIco id={nt.id} />
                      {/* cn 병기(Nm)는 두 줄짜리라 flex 아이템 하나로 묶어야 아이콘 옆에 쌓인다 */}
                      <span className="rg-nodetype-title"><Nm name={nt.name} cn={nt.cn} /></span>
                    </h4>
                    {nt.func && <p className="rg-nodetype-func">{nt.func}</p>}
                    {nt.desc && <p>{nt.desc}</p>}
                    {nt.id === "DUEL" && duelStages.length > 0 && (
                      <>
                        <div className="rg-stage-cards">
                          {duelStages.map((s) => <StageCard key={s.id} pair={{ n: s }} onOpen={setStageOpen} />)}
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
            </div>
          </details>
          )}

          <details className="rg-zone rg-zone-wide">
            <summary className="rg-zone-sum">
              <h3>{t("우연한 만남")}</h3>
              <span className="rg-zone-counts">{data.encounters.length}</span>
              <span className="rg-zone-arrow" aria-hidden>▾</span>
            </summary>
            <div className="rg-zone-body">
              <p className="rg-zone-desc">{topic === "rogue_6" ? t("비전투 노드에서 발생하는 이벤트입니다. 출시 직후라 출현 층 정보는 아직 정리되지 않았습니다.") : t("비전투 노드에서 발생하는 이벤트입니다. 출현 층 표기는 위키 실측 기반입니다.")}</p>
              <div className="rg-enc-list">
                {[...data.encounters]
                  .sort((a, b) => (a.floors?.[0] ?? 99) - (b.floors?.[0] ?? 99) || (a.floors?.length ?? 9) - (b.floors?.length ?? 9) || a.title.localeCompare(b.title, "ko"))
                  .map((enc) => (
                    <button key={enc.scene} type="button" className="rg-enc-item" onClick={() => setEncOpen(enc)}>
                      {enc.bg
                        ? <img className="rg-enc-thumb" src={asset(`/rogue/scene/${enc.bg}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />
                        : <span className="rg-enc-thumb none" aria-hidden />}
                      <span className="rg-enc-txt">
                        {enc.floors && <span className="rg-enc-floors">{enc.floors.join("·")}{t("층")}</span>}
                        <span className="rg-enc-title"><Nm name={enc.title} cn={enc.cn} /></span>
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </details>
          </>)}
        </div>
      )}

      {view === "enemy" && (
        <div className="rg-enemy-view">
          <div className="rg-filterbar">
            <input type="search" {...enemyProps}
              placeholder={t("적 이름 검색")} aria-label={t("적 이름 검색")} />
            {/* 검색란 제안 — 고르면 그 적 상세가 바로 열린다 (사용자 확정 2026-08-10) */}
            <SearchSuggest query={enemyTerm}
              items={enemies.map(([key, e]) => ({ key, label: e.name || e.cn || key, sub: e.index ?? undefined, img: e.img ? asset(`/rogue/enemy/${e.img}.webp`) : undefined }))}
              onPick={(key) => setEnemyOpen({ key, ctx: dexCtx(key) })} />
            {["", "NORMAL", "ELITE", "BOSS"].map((rk) => (
              <button key={rk || "all"} type="button" className={enemyRank === rk ? "on" : ""}
                onClick={() => setEnemyRank(rk)}>{rk ? t(RANK_KO[rk]) : t("전체")}</button>
            ))}
            <span className="rg-count">{enemies.length}</span>
            {invButton}
          </div>
          {/* 도감은 사진 왼쪽·정보 오른쪽 가로형 카드 (피드백 반영 2026-07-18) */}
          <div className="rg-enemy-grid">
            {enemies.map(([key, e]) => (
              <button type="button" key={key} className="rg-enemy-cell row" id={`rg-en-${key}`}
                onClick={() => setEnemyOpen({ key, ctx: dexCtx(key) })}>
                {e.img ? <img className="rg-enemy-face" src={asset(`/rogue/enemy/${e.img}.webp`)} alt="" aria-hidden width={158} height={158} loading="lazy" decoding="async" />
                  : <span className="rg-enemy-face none" aria-hidden>?</span>}
                <span className="rg-enemy-cell-info">
                  <span className="rg-enemy-cell-head">
                    <span className={`rg-rank r-${e.rank ?? "NORMAL"}`}>{t(RANK_KO[e.rank ?? ""] ?? "일반")}</span>
                  </span>
                  <span className="rg-enemy-name"><Nm name={e.name} cn={e.cn} /></span>
                  <StatRow e={e} grade={grade} ctx={dexCtx(key)} />
                </span>
                {e.index && <span className="rg-enemy-idx">{e.index}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 소장품(유물) — 전시관에서 최상위 탭으로 승격 (사용자 요청 2026-07-18) */}
      {view === "relic" && (
        <div className="rg-archive">
          <div className="rg-filterbar">
            <input type="search" {...relicProps}
              placeholder={t("유물 검색 (이름·번호)")} aria-label={t("유물 검색 (이름·번호)")} />
            {/* 검색란 제안 — 고르면 그 유물 상세가 바로 열린다 (사용자 확정 2026-08-10) */}
            <SearchSuggest query={relicTerm}
              items={relics.map((r) => ({ key: r.id, label: r.name || r.cn || r.id, img: asset(`/rogue/relic/${r.iconId ?? r.id}.webp`) }))}
              onPick={(id) => { const r = relics.find((x) => x.id === id); if (r) setRelicOpen(r); }} />
            <span className="rg-count">{relics.length}</span>
            {invButton}
          </div>
          {/* 목록 카드는 섬네일·이름·효과만 — 번호·설명은 클릭 시 상세 모달에서 (사용자 요청 2026-07-23) */}
          <div className="rg-relic-grid">
            {relics.map((r) => (
              <article key={r.id} className={`rg-relic clickable${lensHits?.has(r.id) ? " rg-lens-hit" : ""}`}
                role="button" tabIndex={0}
                onClick={() => setRelicOpen(r)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRelicOpen(r); } }}>
                <header>
                  {r.img && <img className="rg-relic-icon" src={asset(`/rogue/relic/${r.iconId ?? r.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                  <h4><Nm name={r.name} cn={r.cn} /></h4>
                  <InvPill owned={inv.has(r.id)} onToggle={() => toggleInv(r.id)} />
                </header>
                {r.usage && <p className="rg-relic-usage">{r.usage}</p>}
              </article>
            ))}
          </div>
        </div>
      )}

      {view === "archive" && (
        <div className="rg-archive">
          <div className="rg-filterbar">
            {archiveTabs.map(([id, label]) => (
              <button key={id} type="button" className={activeArc === id ? "on" : ""} onClick={() => setArcTab(id)}>{t(label)}</button>
            ))}
            <span className="rg-count">
              {activeArc === "hallu" ? (data.variations?.length ?? data.weathers?.length ?? 0)
                : activeArc === "capsule" ? data.capsules?.length ?? 0
                : activeArc === "scrap" ? data.scraps?.length ?? 0
                : activeArc === "legacy" ? data.legacies?.length ?? 0
                : activeArc === "buoy" ? data.buoys?.length ?? 0
                : activeArc === "explore" ? data.exploreTools?.length ?? 0
                : activeArc === "visitor" ? data.visitors?.length ?? 0
                : activeArc === "band" ? data.bands.length
                : (data.mechanics ?? []).find((m) => m.label === activeArc)?.items.length ?? 0}
            </span>
            {invButton}
          </div>
          {activeArc === "scrap" && (
            <div className="rg-scrap-view">
              {["GOODS", "MOVE", "PASSIVE"].map((st) => {
                const items = (data.scraps ?? []).filter((s) => s.type === st);
                if (items.length === 0) return null;
                return (
                  <div key={st} className="rg-scrap-group">
                    <h4 className="rg-scrap-type">{items[0].typeName}<em>{items.length}</em>
                      <span className="rg-scrap-hint">{st === "GOODS" ? t("팔면 오리지늄각뿔이 되는 자연물") : st === "MOVE" ? t("장착하면 지도 이동 능력을 주는 가공품") : t("특정 조건에서 발동하는 개념체")}</span>
                    </h4>
                    <div className="rg-relic-grid">
                      {/* 부품도 소장품처럼 클릭 → 상세 모달 + 보유 토글 (피드백 반영 2026-07-24) */}
                      {items.map((s) => (
                        <article key={s.id} className={`rg-relic clickable${lensHits?.has(s.id) ? " rg-lens-hit" : ""}`}
                          role="button" tabIndex={0}
                          onClick={() => setRelicOpen(s)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRelicOpen(s); } }}>
                          <header>
                            {s.img && <img className="rg-relic-icon" src={asset(`/rogue/relic/${s.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                            <h4><Nm name={s.name} cn={s.cn} /></h4>
                            <InvPill owned={inv.has(s.id)} onToggle={() => toggleInv(s.id)} />
                          </header>
                          {/* 미리보기는 효과까지만 — 플레이버 설명은 상세에서 (사용자 확정 2026-07-24) */}
                          {s.usage && <p className="rg-relic-usage">{s.usage}</p>}
                        </article>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {activeArc === "legacy" && (
            <div className="rg-relic-grid">
              {(data.legacies ?? []).map((c) => (
                <article key={c.id} className="rg-relic">
                  <header>
                    {c.img && <img className="rg-relic-icon" src={asset(`/rogue/relic/${c.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                    <h4><Nm name={c.name} cn={c.cn} /></h4>
                  </header>
                  {c.usage && <p className="rg-relic-usage">{c.usage}</p>}
                  {c.desc && <p className="rg-relic-desc">{c.desc}</p>}
                </article>
              ))}
            </div>
          )}
          {/* 부표 — 노드가 아니라 격자 지도 위 이벤트 마커라 전시관에 배치 (사용자 확정 2026-07-18) */}
          {activeArc === "buoy" && (
            <div className="rg-relic-grid">
              {(data.buoys ?? []).map((b) => (
                <article key={b.id} className="rg-relic">
                  <header>
                    {b.img && <img className="rg-relic-icon" src={asset(`/rogue/misc/${b.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                    <h4><Nm name={b.name} cn={b.cn} /></h4>
                  </header>
                  {b.usage && <p className="rg-relic-desc">{b.usage}</p>}
                </article>
              ))}
            </div>
          )}
          {activeArc === "capsule" && (
            <div className="rg-capsule-grid">
              {(data.capsules ?? []).map((c) => (
                <article key={c.id} className={`rg-relic capsule${lensHits?.has(c.id) ? " rg-lens-hit" : ""}`}>
                  {c.img && <img className="rg-cap-art" src={asset(`/rogue/capsule/${c.id}.webp`)} alt={c.name} loading="lazy" decoding="async" />}
                  <header><h4>{c.name}</h4>{c.en && <span className="rg-cap-en">{c.en}</span>}</header>
                  {c.usage && <p className="rg-relic-usage">{c.usage}</p>}
                  {c.desc && <p className="rg-relic-desc">{c.desc}</p>}
                </article>
              ))}
            </div>
          )}
          {/* 월간 방문객 — 매달 로테이션되는 방문객 오퍼가 특정 층·구역의 특별 조우로
              등장하고, 만나면 기록이 해금된다 (사용자 소원 2026-08-17 "방문객 해금 스토리 정리") */}
          {activeArc === "visitor" && (
            <div className="rg-visitor-view">
              <p className="rg-visitor-note">{t("매달 다른 방문객이 찾아옵니다. 그달의 방문객은 아래 표시된 층·구역의 특별 조우에서 만날 수 있고, 만나면 그 장면의 기록이 해금됩니다. 로테이션이 한 바퀴 돌면 처음부터 반복됩니다.")}</p>
              <div className="rg-visitor-grid">
                {(data.visitors ?? []).map((v) => (
                  <article key={v.id} className="rg-visitor">
                    <header>
                      {v.chars.map((c) => (
                        <img key={c.id} className="rg-visitor-face" src={asset(`/avatars/${c.id}.webp`)}
                          alt="" width={180} height={180} loading="lazy" decoding="async" />
                      ))}
                      <div className="rg-visitor-who">
                        <h4>{v.chars.map((c) => c.name).join(" · ")}</h4>
                        <span className="rg-visitor-team"><Nm name={v.name ?? ""} cn={v.cn} />{v.ym && <em>{v.ym}</em>}</span>
                      </div>
                    </header>
                    {v.desc && <p className="rg-visitor-desc">{v.desc}</p>}
                    {v.scenes && v.scenes.length > 0 && (
                      <ul className="rg-visitor-scenes">
                        {v.scenes.map((s, i) => {
                          const where = `${s.floor !== undefined ? t("{n}층", { n: s.floor }) : ""}${s.zone ? ` · ${s.zone}` : ""}`;
                          const inner = (
                            <>
                              <span className="rg-visitor-where">{where}{s.txt && <i className="rg-rec-read" aria-hidden>▸ {t("읽기")}</i>}</span>
                              {(s.desc || s.cn) && (
                                <span className="rg-visitor-quote"><Nm name={s.desc ?? ""} cn={s.cn} /></span>
                              )}
                            </>
                          );
                          return (
                            <li key={i}>
                              {s.txt && s.rid ? (
                                <button type="button" className="rg-visitor-scene-row"
                                  onClick={() => setRecOpen({ rid: s.rid!, title: v.chars.map((c) => c.name).join(" · "), sub: where })}>
                                  {inner}
                                </button>
                              ) : <div className="rg-visitor-scene-row">{inner}</div>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}
          {/* 무대 도구는 소장품 뷰에 통합됨 (사용자 확정 2026-07-24) — 전용 탭 제거 */}
          {activeArc === "explore" && (
            <div className="rg-relic-grid">
              {(data.exploreTools ?? []).map((c) => (
                <article key={c.id} className="rg-relic">
                  <header>
                    {c.img && <img className="rg-relic-icon" src={asset(`/rogue/relic/${c.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                    <h4><Nm name={c.name} cn={c.cn} /></h4>
                  </header>
                  {c.usage && <p className="rg-relic-usage">{c.usage}</p>}
                  {c.desc && <p className="rg-relic-desc">{c.desc}</p>}
                </article>
              ))}
            </div>
          )}
          {activeArc === "band" && (
            <div className="rg-relic-grid">
              {data.bands.map((c) => (
                <article key={c.id} className={`rg-relic${lensHits?.has(c.id) ? " rg-lens-hit" : ""}`}>
                  <header>
                    {c.img && <img className="rg-relic-icon" src={asset(`/rogue/relic/${c.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                    <h4><Nm name={c.name} cn={c.cn} /></h4>
                  </header>
                  {c.usage && <p className="rg-relic-usage">{c.usage}</p>}
                  {c.desc && <p className="rg-relic-desc">{c.desc}</p>}
                </article>
              ))}
            </div>
          )}
          {/* 토픽 고유 시스템 갤러리 (거부반응·암호판·붕괴 패러다임·사고·시대·주화·분노 등).
              kind가 있으면(사고: 염원/영감/구상) 분류별 섹션으로 나눠 렌더 (부품 뷰와 동일 패턴) */}
          {(data.mechanics ?? []).map((m) => {
            if (m.label !== activeArc) return null;
            const kinds = [...new Set(m.items.map((c) => c.kind).filter(Boolean))] as string[];
            const groups: { kind?: string; items: typeof m.items }[] = kinds.length > 0
              ? kinds.map((k) => ({ kind: k, items: m.items.filter((c) => c.kind === k) }))
              : [{ items: m.items }];
            return groups.map((g) => (
              <div key={`${m.label}-${g.kind ?? "all"}`} className={g.kind ? "rg-scrap-group" : undefined}>
                {g.kind && <h4 className="rg-scrap-type">{t(g.kind)}<em>{g.items.length}</em></h4>}
                <div className="rg-relic-grid">
                  {/* 시스템 갤러리(암호판·사고·주화 등)도 소장품처럼 클릭 → 상세 모달
                      (사용자 요청 2026-07-24). 보유 토글은 테마 수집 자원(암호판·사고·주화)에만 */}
                  {g.items.map((c) => (
                    <article key={c.id} className={`rg-relic clickable${lensHits?.has(c.id) ? " rg-lens-hit" : ""}`}
                      role="button" tabIndex={0}
                      onClick={() => setRelicOpen(c)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRelicOpen(c); } }}>
                      {c.stages ? (
                        /* 다단계 시스템(붕괴 패러다임) — 카드 1장 안에 단계별 [섬네일+이름+효과] 행
                           (사용자 확정 2026-07-24). 아이콘은 단계 공용 1장(게임 원본에 _a 전용 아트 없음) */
                        <div className="rg-stage-list">
                          {c.stages.map((s) => (
                            <div key={s.name} className="rg-stage">
                              {c.img && <img className="rg-relic-icon" src={asset(`/rogue/relic/${c.iconId ?? c.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                              <div className="rg-stage-txt">
                                <h4>{s.name} <em className="rg-stage-lb">{s.label}</em></h4>
                                {s.usage && <p className="rg-relic-usage rg-multiline">{s.usage}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (<>
                        <header>
                          {c.img && <img className="rg-relic-icon" src={asset(`/rogue/relic/${c.iconId ?? c.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                          <h4>{c.name}</h4>
                          {resIds.has(c.id) && <InvPill owned={inv.has(c.id)} onToggle={() => toggleInv(c.id)} />}
                        </header>
                        {/* 미리보기는 효과까지만 — 플레이버 설명은 상세에서 (사용자 확정 2026-07-24) */}
                        {c.usage && <p className="rg-relic-usage rg-multiline">{c.usage}</p>}
                      </>)}
                    </article>
                  ))}
                </div>
              </div>
            ));
          })}
          {/* 환각/메아리 (IS1/IS2) — 전시관 서브탭으로 편입 */}
          {activeArc === "hallu" && (topic === "rogue_1" || topic === "rogue_2") && (
            <div className="rg-hallu-inner">
          <p className="rg-zone-desc">{topic === "rogue_2"
            ? t("특정 구역에 '메아리'가 나타나 해당 구역 전체에 효과를 겁니다. 좋은 효과와 나쁜 효과가 함께 붙습니다.")
            : t("난이도 1 이상에서 구역에 환각이 나타납니다. 난이도 11 이상에서는 특정 조합이 융합 환각으로 발동합니다.")}</p>
          <div className="rg-relic-grid">
            {data.variations.map((v) => (
              <article key={v.id} className={`rg-relic${v.fusion ? " fusion" : ""}`}>
                <header>
                  <h4>{v.name}</h4>
                  {v.fusion && <span className="rg-fusion-tag">{t("융합")}</span>}
                </header>
                {v.func && <p className="rg-relic-usage">{v.func}</p>}
                {v.desc && <p className="rg-relic-desc">{v.desc}</p>}
              </article>
            ))}
          </div>
        </div>
      )}

          {/* 환경(실토피아/유토피아, IS6) — 전시관 서브탭으로 편입 */}
          {activeArc === "hallu" && topic === "rogue_6" && (
        <div className="rg-hallu-inner">
          {/* 실토피아 — 기밀 등급 2+에서 격자 지도에 생성되는 이상역. 이념(주 효과) 10종 × 강도 3단계 */}
          {/* 병기 룰: 중국어 대표 + 한국어 번역 뒤 (.rg-cn은 보조 라벨 스타일로 번역 쪽에 재사용) */}
          <h3 className="rg-env-h"><span lang="zh">实托邦·理念</span> <span className="rg-cn">{t("실토피아 · 이념")}</span></h3>
          <p className="rg-zone-desc">{t("기밀 등급 2 이상에서 '주민'의 사념이 실체화된 이상역(실토피아)이 격자 지도에 생성됩니다. '이상원' 노드를 파괴하면 제거되며, 영향권의 노드에 진입하면 아래 이념 효과가 발동합니다. 강도는 난이도에 따라 초기(a)/중기(b)/말기(c)로 강화됩니다.")}</p>
          <div className="rg-relic-grid">
            {(data.weathers ?? []).map((w) => (
              <article key={w.id} className="rg-relic">
                <header>
                  {w.img && <img className="rg-relic-icon" src={asset(`/rogue/misc/${w.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                  <h4><Nm name={w.name} cn={w.cn} /></h4>
                </header>
                {w.levels.map((l) => (
                  <p key={l.lv} className="rg-relic-usage"><em className={`rg-wlv lv-${l.lv}`}>{l.lv === "a" ? t("초기") : l.lv === "b" ? t("중기") : t("말기")}</em> {l.desc}</p>
                ))}
              </article>
            ))}
          </div>

          <h3 className="rg-env-h"><span lang="zh">实托邦·方针</span> <span className="rg-cn">{t("실토피아 · 방침")}</span></h3>
          <p className="rg-zone-desc">{t("기밀 등급 6 이상에서 이념에 더해지는 부가 효과입니다. 실토피아의 영향을 받는 노드를 지날 때 발동합니다.")}</p>
          <div className="rg-relic-grid">
            {(data.subweathers ?? []).map((w) => (
              <article key={w.id} className="rg-relic">
                <header>
                  {w.img && <img className="rg-relic-icon" src={asset(`/rogue/misc/${w.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                  <h4><Nm name={w.name} cn={w.cn} /></h4>
                </header>
                {w.desc && <p className="rg-relic-usage">{w.desc}</p>}
              </article>
            ))}
          </div>

          <h3 className="rg-env-h"><span lang="zh">乌托邦·黑潭</span> <span className="rg-cn">{t("유토피아 (흑담)")}</span></h3>
          <p className="rg-zone-desc">{t("기이한 공간 노드에서 가공품 1개를 소모하면 히든 구역 '흑담'에 진입합니다. 흑담에서는 아래 유토피아 규칙 중 하나가 맵 전체에 적용되며 제거할 수 없습니다 (대신 난이도 적 강화가 적용되지 않습니다).")}</p>
          <div className="rg-relic-grid">
            {data.variations.map((v) => (
              <article key={v.id} className="rg-relic">
                <header>
                  {v.img && <img className="rg-relic-icon" src={asset(`/rogue/misc/rogue_6_${v.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                  <h4><Nm name={v.name} cn={v.cn} /></h4>
                </header>
                {v.func && <p className="rg-relic-usage">{v.func}</p>}
                {v.desc && <p className="rg-relic-desc">{v.desc}</p>}
              </article>
            ))}
          </div>
        </div>
          )}
        </div>
      )}

      {view === "diff" && (
        <div className="rg-diff-view">
          <p className="rg-zone-desc">{t("난이도는 하위 등급의 규칙을 전부 포함합니다. 현재 선택한 난이도까지의 규칙이 강조됩니다.")}</p>
          <table className="rg-diff-table">
            <thead><tr><th>{t("등급")}</th><th>{t("추가 규칙")}</th></tr></thead>
            <tbody>
              {data.difficulties.filter((d) => d.mode === "EASY" || d.mode === "NORMAL").map((d) => {
                const on = d.mode === "EASY" ? grade < 0 : grade >= d.grade;
                return (
                  <tr key={`${d.mode}${d.grade}`} className={on ? "on" : ""} role="button" tabIndex={0}
                    title={t("이 난이도로 설정")}
                    onClick={() => setGrade(d.mode === "EASY" ? -1 : d.grade)}
                    onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setGrade(d.mode === "EASY" ? -1 : d.grade); } }}>
                    <td>{d.mode === "EASY" ? t("쉬움") : d.grade}</td>
                    <td>{d.rule}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === "ending" && (
        <div className="rg-endings">
          {/* 엔딩 카드 — 진입 선행조건과 엔딩 후 해금 스토리(엔딩북)를 섹션으로 구분
              (사용자 지시 2026-08-17 "중구난방이니 나눠서 하나씩 볼 수 있게").
              기록 조각은 원문이 있으면(txt) 클릭해 전문을 읽는다. */}
          {data.endings.map((e) => (
            <article key={e.id} className="rg-ending">
              <header><h3><Nm name={e.name} cn={e.cn} /></h3></header>
              {e.desc && <p className="rg-ending-desc">{e.desc}</p>}
              {/* 엔딩 달성 시의 인용구 — 스토리 설명 바로 밑 (사용자 지시 2026-08-17, 예전엔 카드 맨 아래) */}
              {e.change && <p className="rg-ending-change">“{e.change}”</p>}
              {e.cond && e.cond.length > 0 && (
                <div className="rg-ending-sec">
                  <h4>{t("진입 조건")}</h4>
                  <ol className="rg-ending-cond">
                    {e.cond.map((c, i) => <li key={i}>{renderCond(c)}</li>)}
                  </ol>
                </div>
              )}
              {e.book && e.book.length > 0 && (
                <div className="rg-ending-sec rg-ending-book">
                  <h4>{t("엔딩 후 해금 스토리")}<em>{e.book.length}</em></h4>
                  <ul>
                    {e.book.map((b, i) => (
                      <li key={i}>
                        {b.txt && b.rid ? (
                          <button type="button" className="rg-rec-btn"
                            onClick={() => setRecOpen({ rid: b.rid!, title: nmText(b.name ?? "", b.cn), sub: e.name })}>
                            <strong><Nm name={b.name ?? ""} cn={b.cn} /></strong><span>{b.cond}</span><i className="rg-rec-read" aria-hidden>▸ {t("읽기")}</i>
                          </button>
                        ) : (
                          <div className="rg-rec-row"><strong><Nm name={b.name ?? ""} cn={b.cn} /></strong><span>{b.cond}</span></div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {zoneOpen && (
        <ZoneModal zone={zoneOpen} badge={zoneBadge(zoneOpen)}
          pairs={zoneOpen.variant ? [] : (pairsByZone.get(zoneOpen.num) ?? []).concat(trialPairsFor(zoneOpen))}
          bosses={zoneOpen.variant ? [] : bossStages.filter((s) => s.zone === zoneOpen.num)}
          onOpenStage={setStageOpen} onClose={() => setZoneOpen(null)} />
      )}
      {/* 조우에서 이어지는 전투 맵 — 조우를 닫지 않고 스테이지 모달을 위에 겹쳐 띄운다
          (사용자 지시 2026-08-16). 조우를 스테이지보다 먼저 그려서, 같은 stack층(z 90)에서
          DOM 순서로 스테이지→적 상세가 차례로 위에 온다. */}
      {encOpen && (
        <EncounterModal enc={encOpen} onClose={() => setEncOpen(null)} link={linkRelic}
          battles={(encOpen.battles ?? []).map((id) => stageById.get(id)).filter(Boolean).map((s) => pairOf(s!))}
          onOpenStage={setStageOpen} />
      )}
      {stageOpen && (
        <StageModal key={stageOpen.n.id} pair={stageOpen} grade={grade} onClose={() => setStageOpen(null)}
          onOpenEnemy={(key, ctx) => setEnemyOpen({ key, ctx })} />
      )}
      {enemyOpen && (
        <EnemyModal ekey={enemyOpen.key} grade={grade} ctx={enemyOpen.ctx} onClose={() => setEnemyOpen(null)}
          appear={enemyStages.get(enemyOpen.key) ?? []}
          onOpenStage={(s) => { setEnemyOpen(null); setStageOpen(pairOf(s)); }} />
      )}
      {relicOpen && (
        <RelicModal relic={relicOpen} onClose={() => setRelicOpen(null)}
          owned={inv.has(relicOpen.id)}
          onToggleOwn={invSection(relicOpen.id) ? () => toggleInv(relicOpen.id) : undefined} />
      )}
      {/* 기록 원문 (엔딩북 조각·방문객 장면) — 스포일러성 전문이라 클릭한 것만 연다 */}
      {recOpen && <RecordModal rid={recOpen.rid} title={recOpen.title} sub={recOpen.sub} onClose={() => setRecOpen(null)} />}
      {/* 보유 리스트 모달 — 소장품/테마 자원 탭으로 구분해 담아둔 항목을 한눈에 (피드백 반영 2026-07-24) */}
      {/* 보유 리스트는 모달이 아니라 **떠 있는 창** (사용자 지시 2026-07-29):
          바깥을 눌러도 닫히지 않고, 뒤를 어둡게 덮지 않으며(백드롭 없음), 항상 맨 위에 있고,
          머리를 잡아 옮길 수 있다. 담으면서 가이드를 계속 보라는 창이라 화면을 막으면 안 된다.
          닫기는 × 버튼뿐 — Esc도 막지 않는다(다른 모달과 달리 여긴 Esc 핸들러 자체가 없다). */}
      {invOpen && (
        <div className="rg-modal rg-invmodal" role="dialog" aria-label={t("보유 리스트")}
          ref={invPanelRef}
          style={{ ...(invPos ? { left: invPos.x, top: invPos.y } : {}),
                   ...(invSize ? { width: invSize.w, height: invSize.h } : {}) }}>
          {/* 네 변 + 네 모서리 크기 손잡이 (사용자 지시 2026-07-29) */}
          {INV_GRIPS.map((d) => (
            <div key={d} className={`rg-rs rg-rs-${d}`} onPointerDown={(e) => onInvResizeStart(e, d)}
              onPointerMove={onInvResizeMove} onPointerUp={onInvResizeEnd} onPointerCancel={onInvResizeEnd} />
          ))}
          <header className={`rg-modal-head rg-inv-grab${invDragging ? " dragging" : ""}`}
            onPointerDown={onInvDragStart} onPointerMove={onInvDragMove}
            onPointerUp={onInvDragEnd} onPointerCancel={onInvDragEnd}>
              <div title={t("게임에서 얻은 소장품·자원을 담아두는 목록입니다. 카드의 「＋ 보유」 버튼으로 추가하며, 이 브라우저에 테마별로 저장됩니다.")}>
                <h3>🎒 {t("보유 리스트")}</h3>
                <span className="rg-modal-zone">{t(TOPICS.find((tp) => tp.id === topic)?.name ?? "")}</span>
              </div>
              {/* 보유 리스트는 모달이 아니라 상시 떠 있는 창이라 공통 창으로 옮기지 않았다
                  (위치·크기를 localStorage에 저장하는데 ModalWindow는 그걸 돌려주지 않는다) —
                  자체 닫기 버튼도 그대로 둔다 */}
              <button type="button" className="rg-modal-close" onClick={() => setInvOpen(false)} aria-label={t("닫기")}>×</button>
            </header>
            {/* 안내문은 창을 키우지 않도록 헤더 툴팁으로 내렸다 (사용자 지시 2026-07-29: 내용 줄이기) */}
            <div className="rg-filterbar rg-inv-tabs">
              <button type="button" className={invTab === "relic" ? "on" : ""} onClick={() => setInvTab("relic")}>
                {t("소장품")} <em className="rg-inv-tabcnt">{ownedRelics.length}</em>
              </button>
              {resLabel && (
                <button type="button" className={invTab === "res" ? "on" : ""} onClick={() => setInvTab("res")}>
                  {t(resLabel)} <em className="rg-inv-tabcnt">{ownedRes.length}</em>
                </button>
              )}
              {/* 효과 총합은 붙박이 패널이 아니라 버튼→모달 (사용자 지시 2026-07-29).
                  자원 탭엔 수치 효과가 없어 소장품 탭에서만 낸다. */}
              {invTab === "relic" && ownedRelics.length > 0 && (
                <button type="button" className="rg-inv-sum" onClick={() => setEffOpen(true)}>Σ {t("효과 총합")}
                  {isNewFeature("rogue-eff") && <span className="new-badge">{t("새기능")}</span>}</button>
              )}
              {(invTab === "relic" ? ownedRelics : ownedRes).length > 0 && (
                <button type="button" className="rg-inv-clear" onClick={() => void clearInvTab(invTab)}>{t("전체 비우기")}</button>
              )}
            </div>
            {/* 머리·탭은 고정하고 목록만 스크롤 — 창을 줄여도 손잡이·탭이 따라 밀리지 않는다.
                가로 스크롤은 두지 않는다(사용자 지적): 좁은 창에서 옆으로 잘리면 못 읽는다. */}
            <div className="rg-inv-body">
            {(invTab === "relic" ? ownedRelics : ownedRes).length === 0 ? (
              <p className="rg-inv-empty">{t("아직 담은 항목이 없습니다 — 소장품·전시관 카드의 「＋ 보유」 버튼으로 추가하세요.")}</p>
            ) : (
              <div className="rg-relic-grid">
                {(invTab === "relic" ? ownedRelics : (ownedRes as InvItem[])).map((r) => (
                  <article key={r.id} className="rg-relic clickable" role="button" tabIndex={0}
                    onClick={() => setRelicOpen(r)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRelicOpen(r); } }}>
                    <header>
                      {r.img && <img className="rg-relic-icon" src={asset(`/rogue/relic/${r.iconId ?? r.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                      <h4><Nm name={r.name} cn={r.cn} /></h4>
                      <InvPill owned onToggle={() => toggleInv(r.id)} />
                    </header>
                    {r.usage && <p className="rg-relic-usage">{r.usage}</p>}
                  </article>
                ))}
              </div>
            )}
            </div>
        </div>
      )}
      {effOpen && (
        <EffectTotals items={ownedRelics} onClose={() => setEffOpen(false)}
          label={t(TOPICS.find((tp) => tp.id === topic)?.name ?? "")} />
      )}
      {/* 도움말은 공용 창(ModalWindow)이라 백드롭·포털을 스스로 만든다 (2026-09-05) */}
      {lensOpen && (
        <Suspense fallback={null}>
          <LensHelpModal mode="rogue" onClose={() => setLensOpen(false)} />
        </Suspense>
      )}
      {/* 소장품 다중 인식 모아보기 — 인식된 유물들을 상세 카드로 한 화면에 (사용자 요청 2026-07-23) */}
      {lensMulti && (() => {
        // 전체 보유 토글 — 담기 가능한 항목만 대상 (사용자 요청 2026-07-24)
        const multiIds = lensMulti.filter((r) => invSection(r.id)).map((r) => r.id);
        const multiAllOwned = multiIds.length > 0 && multiIds.every((id) => inv.has(id));
        return (
        <ModalWindow label={t("인식된 항목 {n}개", { n: lensMulti.length })} className="rg-modal rg-rmodal rg-rmulti" onClose={() => setLensMulti(null)}>
          <header className="rg-modal-head">
            <div>
              <h3>📷 {t("인식된 항목 {n}개", { n: lensMulti.length })}</h3>
              {multiIds.length > 0 && (
                <button type="button" className={`rg-inv-btn rg-inv-all${multiAllOwned ? " on" : ""}`}
                  title={multiAllOwned ? t("인식된 항목을 모두 보유 리스트에서 뺍니다") : t("인식된 항목을 모두 보유 리스트에 담습니다")}
                  onClick={() => toggleInvAll(multiIds, !multiAllOwned)}>
                  {multiAllOwned ? t("✓ 전체 보유중") : t("＋ 전체 보유")}
                </button>
              )}
            </div>
          </header>
          <div className="rg-rmulti-list">
            {lensMulti.map((r) => (
              <article key={r.id} className="rg-rmulti-item">
                <header>
                  {r.img && <img className="rg-relic-icon lg" src={asset(`/rogue/relic/${r.iconId ?? r.id}.webp`)} alt="" aria-hidden loading="lazy" decoding="async" />}
                  {r.order && <span className="rg-relic-no">{r.order}</span>}
                  <h4><Nm name={r.name} cn={r.cn} /></h4>
                  {/* 스샷 인식 → 바로 보유 담기 (피드백 반영 2026-07-24) */}
                  {invSection(r.id) && <InvPill owned={inv.has(r.id)} onToggle={() => toggleInv(r.id)} />}
                </header>
                {r.usage && <p className="rg-relic-usage">{r.usage}</p>}
                {r.desc && <p className="rg-relic-desc">{r.desc}</p>}
              </article>
            ))}
          </div>
        </ModalWindow>
        );
      })()}
      {/* 자동인식이 테마를 특정 못 한 경우(분대 이름은 테마 공통) — 테마 선택 전용 미니 창 */}
      {lensInitial?.target.kind === "tie" && (
        <ModalWindow label={`📷 ${t("테마 선택")}`} className="operator-modal lens-modal lens-tie"
          onClose={() => setLensInitial(null)}>
          <div className="lens-body">
            <p className="lens-verdict">{t("인식은 됐지만 어느 테마인지 화면만으론 알 수 없습니다 — 테마를 선택하세요.")}</p>
            <div className="lens-topic-chips">
              {lensInitial.target.options.map((o) => (
                <button key={o.topic} type="button" className="lens-chip" onClick={() => onLensGoto(o.goto)}>
                  {t(o.topicName)}
                </button>
              ))}
            </div>
          </div>
        </ModalWindow>
      )}
      {confirmDialog}
      </>)}
    </section>
  );
}

const RANK_SORT: Record<string, number> = { BOSS: 0, ELITE: 1, NORMAL: 2 };
