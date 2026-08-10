"use client";

// 헤더 만능검색 — 사이트 전체 컨텐츠 색인 + 점수 매김 (순수 로직, UI는 omni.tsx).
//
// 색인 대상과 이동 방법:
//   오퍼레이터   → #op-<id> 모달 (다국어 이름·별칭·이격 별명·코드)
//   스토리       → 스토리 탭 #story-<id>
//   재료         → 파밍 탭 재료 상세 모달 (커뮤니티 은어 별칭 포함)
//   공채 태그    → 공개채용 도우미 탭 태그 선택
//   통합전략 테마 → /rogue?topic=isN
//   통합전략 항목 → 유물·조우·작전·분대… (스샷 레이더 인덱스 재사용, **지연 로드 2.9MB**)
//   기능 탭      → 인프라 자동편성기·파밍·육성 시뮬 등 (동의어: riic, base, is3 …)
//
// 무거운 통합전략 항목은 기본 색인에서 빠져 있다 — 가벼운 색인으로 답이 안 나올 때만
// omni.tsx가 getRogueIndex()로 받아 rogueOmniItems()로 합친다.
import recruitData from "./data/recruit.json";
import { asset } from "./assets";
import { ALL_MATERIALS, MATERIAL_ALIASES } from "./farm";
import { canOpenStory, eventById } from "./story";
import { TOPICS } from "./rogue-topics";
import { normSearch } from "./search";
import { gotoForEntity, type LensGoto, type LensIndex } from "./lens/match";
import { PICK_BONUS_MAX, type PickMap } from "./omni-picks";
import type { Operator, Tab } from "./home";
import type { ExtraI18n, Locale, T } from "./i18n";

export type OmniKind = "op" | "story" | "material" | "tag" | "rogue" | "topic" | "tab";

export type OmniTarget =
  | { kind: "tab"; tab: Tab }
  | { kind: "op"; id: string }
  | { kind: "story"; id: string }
  | { kind: "rogue"; topic: string; goto?: LensGoto }
  | { kind: "recruit"; tags: string[] }
  | { kind: "farm"; item: string };

export type OmniItem = {
  uid: string;        // React key
  kind: OmniKind;
  name: string;       // 표시 이름 (현재 로케일)
  sub: string;        // 보조 설명 ("6★ 가드", "이벤트 스토리", "팬텀 & 크림슨 솔리테어 · 소장품")
  img?: string;       // 결과 목록 아이콘
  keys: string[];     // 정규화된 검색 키 — 0번이 표시 이름, 뒤쪽은 별명/코드(가중치 감점)
  target: OmniTarget;
};
export type OmniHit = OmniItem & {
  score: number;
  votes: number;      // 이 검색어에서 선택된 표수(학습)
  fuzzy?: boolean;    // 오탈자 근사로 걸린 후보 ("첸 더 더스트릭" → 첸 더 던스트릭)
  hinted?: boolean;   // 분류 힌트로 걸린 후보 ("쉐이록라" = 쉐이 + 록라(통합전략))
  learned?: boolean;  // 글자는 안 맞지만 학습된 별명으로 끌어온 항목 ("날시" → 켈시 이격)
};

// 점수: 완전일치 > 접두일치 > 부분일치. 접두·부분은 검색어가 후보를 얼마나 덮는지(비율)로 스케일.
const EXACT = 120;
const PREFIX = 100;
const PART = 60;
const ALIAS_PENALTY = 8;     // 별명·코드로 잡힌 건 이름으로 잡힌 것보다 한 단계 아래
const MIN_SCORE = 18;        // 이 밑은 잡음 (한 글자 검색어가 전 항목에 걸리는 것 방지)
const DECIDE_GAP = 30;       // 1위-2위 점수차가 이 이상이면 되묻지 않고 바로 이동
// 종류별 미세 가중 — 같은 점수면 사람이 먼저 떠올릴 법한 쪽을 위로
const KIND_BONUS: Record<OmniKind, number> = { op: 3, tab: 2, topic: 2, story: 2, material: 1, tag: 0, rogue: 0 };

// 검색 정규화 + **장식 문자 제거** — 통합전략 항목 이름은 《글로리어스 카시미어》·'글로리 팩'처럼
// 괄호·따옴표를 달고 있어서, 그대로 두면 "글로리"가 접두로 안 걸린다 (사용자 리포트 2026-07-26).
const DECOR = /[《》〈〉「」『』【】〔〕（）()[\]{}"'“”‘’·・,、。~!?！？:：;；\/\\|+*=_-]/g;
const norm = (s: string) => normSearch(s).replace(DECOR, "");
// 조합 별칭은 **완전일치일 때만** 맞는 키로 넣는다 — "사미엔딩"이 "사미" 부분일치로 새어
// 후보를 어지럽히지 않게. 키 앞의 "=" 한 글자가 그 표시다 (searchOmni·fuzzyHits가 해석).
const exactKey = (raw: string) => `=${norm(raw)}`;
const keysOf = (...raw: (string | null | undefined)[]) => {
  const out: string[] = [];
  for (const s of raw) {
    const k = norm(s ?? "");
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
};
// 이름을 띄어쓰기 단위로도 키에 넣는다 (0번 이후라 별명 가중) — "던스트릭"으로 '첸 더 던스트릭',
// "쉐이"로 '쉐이의 기이한 계원'이 잡히게. 한 글자 조각(더·의)은 잡음이라 버린다.
const words = (name: string) => name.split(/[\s·&,/]+/).filter((w) => w.length >= 2);

// ── 기능 탭 ────────────────────────────────────────────────────────────────
// 동의어는 로케일과 무관하게 전부 실어 둔다 — 한국 사용자가 "riic", "IS3"로 찾기도 한다.
const TAB_ENTRIES: { tab: Tab; label: string; alt: string[] }[] = [
  { tab: "portal", label: "홈", alt: ["home", "portal", "메인", "첫화면"] },
  { tab: "archive", label: "오퍼 백과사전", alt: ["operator archive", "도감", "오퍼레이터", "백과", "캐릭터"] },
  // "인프라 딸깍" — 커뮤니티에서 기지 편성을 그렇게 부른다 (사용자 지정 2026-07-26)
  { tab: "enemy", label: "적 도감", alt: ["enemy", "적", "몹", "도감", "적도감", "enemies"] },
  { tab: "stage", label: "작전 도감", alt: ["stage", "작전", "스테이지", "맵", "지형", "stages"] },
  // "시뮬레이터"는 인프라 편성기 별칭에도 있다 — 둘 다 결과에 뜨는 게 맞다 (호칭이 겹침)
  { tab: "sim", label: "작전 시뮬레이터", alt: ["sim", "simulator", "시뮬", "시뮬레이트", "시뮬레이터", "작전 시뮬", "스폰", "타임라인", "シミュレーター"] },
  { tab: "planner", label: "인프라 자동편성기", alt: ["riic", "base", "기지", "기반시설", "인프라", "편성", "자동편성", "딸깍", "인프라딸깍", "시뮬레이터"] },
  { tab: "recruit", label: "공개채용 도우미", alt: ["recruit", "공개모집", "공채", "태그계산"] },
  { tab: "farm", label: "재료파밍 도우미", alt: ["farm", "재료", "파밍", "효율표", "드랍"] },
  { tab: "upgrade", label: "오퍼 육성 시뮬", alt: ["upgrade", "육성", "비용", "계산기", "스킬특화", "모듈"] },
  { tab: "story", label: "스토리", alt: ["story", "요약", "전문", "연대기"] },
  { tab: "rogue", label: "통합전략 가이드", alt: ["rogue", "integrated strategies", "로그라이크", "통합전략", "is"] },
  { tab: "about", label: "테라 아카이브 소개", alt: ["about", "소개", "문의", "제작", "어바웃"] },
];

// 통합전략 테마의 커뮤니티 호칭 — 대부분 이 이름으로 부른다 (사용자 확인 2026-07-25:
// "탐험가의 은빛 서리 끝자락은 사미라고 부름"). 여기에 분류어를 붙인 "사미록라"도 자동 생성된다.
const TOPIC_NICKS: Record<string, string[]> = {
  rogue_1: ["팬텀", "크림슨솔리테어", "솔리테어"],
  rogue_2: ["미즈키", "카이룰라", "카이룰라아버", "아버"],
  rogue_3: ["사미", "은빛서리", "서리끝자락", "탐험가"],
  rogue_4: ["살카즈", "영겁기담", "기담"],
  rogue_5: ["쉐이", "기이한계원", "계원"],
  rogue_6: ["흑류수해", "침몰자", "흑수"],
};
const ROGUE_WORDS = ["록라", "로라", "로그라이크", "통합전략", "통전"];
// 통합전략 화면(뷰) — rogue.tsx viewsFor()와 같은 id·라벨을 쓴다 (딥링크가 그 id로 동작)
const ROGUE_VIEWS: { id: string; label: string }[] = [
  { id: "map", label: "맵·노드" },
  { id: "enemy", label: "적 도감" },
  { id: "relic", label: "소장품" },
  { id: "archive", label: "전시관" },
  { id: "diff", label: "난이도" },
  { id: "ending", label: "엔딩" },
];

const SECTION_LABEL: Record<string, string> = {
  band: "분대", relic: "소장품", stage: "작전", zone: "구역", enc: "조우",
  capsule: "음반", scrap: "부품", ending: "엔딩", mech: "시스템",
};

export type OmniSource = {
  roster: Operator[];                                  // 미래시 토글이 이미 반영된 목록
  includeFuture: boolean;
  locale: Locale;
  t: T;
  extra?: ExtraI18n | null;
};

/** 가벼운 색인 — 이미 번들에 들어 있는 데이터만 쓴다 (통합전략 세부 항목 제외). */
export function buildOmniIndex({ roster, includeFuture, locale, t, extra }: OmniSource): OmniItem[] {
  const items: OmniItem[] = [];

  for (const entry of TAB_ENTRIES) {
    items.push({
      uid: `tab:${entry.tab}`, kind: "tab", name: t(entry.label), sub: t("사이트 기능"),
      keys: keysOf(t(entry.label), entry.label, ...entry.alt),
      target: { kind: "tab", tab: entry.tab },
    });
  }

  for (const tp of TOPICS) {
    if (!tp.ready || (tp.future && !includeFuture)) continue;
    const num = tp.id.split("_")[1];
    const nicks = TOPIC_NICKS[tp.id] ?? [];
    // 테마 별명("사미")과 별명+분류어("사미록라") 조합까지 키로 — 커뮤니티가 쓰는 호칭이 정답이다
    const nickKeys = [...nicks, ...nicks.flatMap((nick) => ROGUE_WORDS.map((w) => exactKey(`${nick}${w}`)))];
    items.push({
      uid: `topic:${tp.id}`, kind: "topic", name: t(tp.name), sub: t("통합전략 테마"),
      keys: keysOf(t(tp.name), ...words(t(tp.name)), ...words(tp.name), ...nickKeys, `is${num}`, `통합전략${num}`),
      target: { kind: "rogue", topic: tp.id },
    });
    // 테마 안의 **화면 이름**도 찾을 수 있어야 한다 (사용자 요청 2026-07-25: "전시관" 검색).
    // 전시관 안 서브탭(암호판·사고 등)은 테마 데이터에 있어 지연 로드 후 rogueOmniItems가 얹는다.
    for (const view of ROGUE_VIEWS) {
      items.push({
        uid: `rgview:${tp.id}:${view.id}`, kind: "rogue", name: t(view.label),
        sub: `${t(tp.name)} · ${t("화면")}`,
        keys: [...keysOf(t(view.label), view.label),
          ...nicks.map((nick) => exactKey(`${nick}${view.label}`)), exactKey(`${t(tp.name)}${view.label}`)],
        target: { kind: "rogue", topic: tp.id, goto: { page: "rogue", topic: tp.id, view: view.id } },
      });
    }
  }

  // 이격(알터) 오퍼는 "이격첸"·"첸알터"로도 찾아야 한다 (사용자 요청 2026-07-25).
  // 알터 이름은 언제나 "원본 이름 + 수식어"(첸 더 던스트릭 / 실버애쉬 더 레인프로스트)라,
  // 첫 단어가 다른 오퍼의 이름과 같으면 그 오퍼의 이격으로 본다 — 로케일 데이터에도 그대로
  // 성립한다(Chen the Holungday → Chen). 별칭이 하나 늘 뿐이라 오탐도 무해하다.
  const baseNames = new Set(roster.map((op) => norm(op.name)));
  const alterKeys = (name: string): string[] => {
    // words()는 한 글자 단어(첸·팽)를 버리므로 여기선 원문 첫 토큰을 그대로 본다
    const parts = name.split(/\s+/).filter(Boolean);
    const head = parts[0];
    if (parts.length < 2 || !head || !baseNames.has(norm(head))) return [];
    return [`이격${head}`, `${head}이격`, `알터${head}`, `${head}알터`, `${head} alter`].map(exactKey);
  };

  for (const op of roster) {
    items.push({
      uid: `op:${op.id}`, kind: "op", name: op.name,
      sub: `${op.rarity}★ ${op.job}`,
      img: asset(`/avatars/${op.id}.webp`),
      keys: keysOf(op.name, ...words(op.name), ...alterKeys(op.name), ...op.aliases, op.code),
      target: { kind: "op", id: op.id },
    });
  }

  // 이름이 통합전략 테마와 같은 스토리(사미·미즈키 등)는 테마 별명으로도 찾히게 한다
  const nickByKoName = new Map<string, string[]>();
  for (const tp of TOPICS) if (TOPIC_NICKS[tp.id]) nickByKoName.set(norm(tp.name), TOPIC_NICKS[tp.id]);

  for (const ev of eventById.values()) {
    if (!canOpenStory(ev.id) || (ev.unreleased && !includeFuture)) continue;
    const name = (locale === "ko" ? ev.name.ko : ev.name[locale]) ?? ev.name.ko;
    items.push({
      uid: `story:${ev.id}`, kind: "story", name,
      sub: ev.epNo != null ? t("메인 스토리") : t("이벤트 스토리"),
      keys: keysOf(name, ...words(name), ev.name.ko, ev.name.en, ev.name.ja, ...(nickByKoName.get(norm(ev.name.ko)) ?? [])),
      target: { kind: "story", id: ev.id },
    });
  }

  for (const item of ALL_MATERIALS) {
    if (item.unreleased && !includeFuture) continue;
    const name = (locale === "ko" ? item.name.ko : item.name[locale]) ?? item.name.ko;
    items.push({
      uid: `mat:${item.id}`, kind: "material", name,
      sub: `T${item.rarity} · ${t("재료")}`, img: item.image,
      keys: keysOf(name, ...words(name), item.name.ko, item.name.en, item.name.ja, ...(MATERIAL_ALIASES[item.id] ?? [])),
      target: { kind: "farm", item: item.id },
    });
  }

  for (const tag of (recruitData as { tags: { name: string }[] }).tags) {
    const label = extra?.recruitTags?.[tag.name] ?? tag.name;
    items.push({
      uid: `tag:${tag.name}`, kind: "tag", name: label, sub: t("공채 태그"),
      keys: keysOf(label, tag.name),
      target: { kind: "recruit", tags: [tag.name] },
    });
  }

  return items;
}

/** 통합전략 세부 항목 — 스샷 레이더 인덱스(지연 로드)를 그대로 재활용한다.
 *  덧붙여 **전시관 서브탭 이름**(암호판·사고·레퍼토리…)도 항목으로 만든다 — 탭 목록은 테마
 *  데이터에만 있어서(mechanics[].label) 지연 로드 시점에야 알 수 있다. */
export function rogueOmniItems(index: LensIndex, includeFuture: boolean, t: T): OmniItem[] {
  const allowed = new Set(TOPICS.filter((tp) => tp.ready && (!tp.future || includeFuture)).map((tp) => tp.id));
  const topicName = new Map<string, string>();
  const arcTabs = new Map<string, Set<string>>();   // 토픽 → 전시관 탭 라벨
  const items: OmniItem[] = [];
  for (const e of index.entries) {
    if (!allowed.has(e.topic)) continue;
    topicName.set(e.topic, e.topicName);
    if (e.section === "mech" && e.arc) (arcTabs.get(e.topic) ?? arcTabs.set(e.topic, new Set()).get(e.topic)!).add(e.arc);
  }
  for (const [topic, labels] of arcTabs) {
    const nicks = TOPIC_NICKS[topic] ?? [];
    for (const label of labels) {
      items.push({
        uid: `rgarc:${topic}:${label}`, kind: "rogue", name: label,
        sub: `${topicName.get(topic) ?? topic} · ${t("전시관")}`,
        keys: [...keysOf(label), ...nicks.map((nick) => exactKey(`${nick}${label}`))],
        target: { kind: "rogue", topic, goto: { page: "rogue", topic, view: "archive", arcTab: label } },
      });
    }
  }
  for (const e of index.entries) {
    // nameN이 빈 엔트리 = EN/JA 인덱스의 CN 선행 항목 (중국어 패스 전용) — 검색에 안 걸린다
    if (!e.nameN || !allowed.has(e.topic)) continue;
    const goto = gotoForEntity(e);
    if (!goto) continue;
    items.push({
      uid: `rg:${e.topic}:${e.section}:${e.id}`, kind: "rogue", name: e.name,
      // topicName은 로케일 데이터(rogueN.<loc>.json)에서 온 이름이라 그대로 쓴다
      sub: `${e.topicName} · ${t(SECTION_LABEL[e.section] ?? e.section)}`,
      keys: [e.nameN, ...words(e.name).map(norm).filter((w) => w && w !== e.nameN)],
      target: { kind: "rogue", topic: e.topic, goto },
    });
  }
  return items;
}

/** 선택 학습 보너스 — 표수 p가 쌓일수록 완만하게 오르고 PICK_BONUS_MAX에서 멈춘다.
 *  상한이 있어야 학습이 **비슷한 후보들의 순서만** 바꾸고, 관련 없는 항목을 끌어올리지 않는다
 *  (완전일치 120 vs 부분일치 60+45=105 → 완전일치가 여전히 이긴다). */
const pickBonus = (p: number) => (p > 0 ? Math.min(PICK_BONUS_MAX, 18 + 9 * Math.log2(1 + p)) : 0);

export function searchOmni(items: OmniItem[], raw: string, opts?: { limit?: number; picks?: PickMap }): OmniHit[] {
  const q = norm(raw);
  if (!q) return [];
  const picks = opts?.picks;
  const hits: OmniHit[] = [];
  for (const it of items) {
    let best = 0;
    for (let i = 0; i < it.keys.length; i += 1) {
      const k = it.keys[i];
      let score = k.startsWith("=")
        ? (k.slice(1) === q ? EXACT : 0)                       // 조합 별칭 — 완전일치 전용
        : k === q ? EXACT
          : k.startsWith(q) ? PREFIX * (q.length / k.length)
            : k.includes(q) ? PART * (q.length / k.length)
              : 0;
      if (score && i > 0) score -= ALIAS_PENALTY;
      if (score > best) best = score;
    }
    if (best < MIN_SCORE) continue;
    const votes = picks?.[it.uid] ?? 0;
    hits.push({ ...it, score: best + KIND_BONUS[it.kind] + pickBonus(votes), votes });
  }
  hits.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return hits.slice(0, opts?.limit ?? 10);
}

// ── 오탈자 근사 매칭 (사용자 요청 2026-07-25) ───────────────────────────────
// "첸 더 더스트릭"으로 첸 더 던스트릭, "네스티"로 내스티가 나와야 한다. 둘 다 **자모 한 개**
// 차이(받침 ㄴ, 모음 ㅐ/ㅔ)라 음절 단위로는 잡기 어렵다 → 한글을 자모로 풀어 2-그램
// 유사도(Dice)를 본다. 편집거리보다 싸고(선형), 수천 항목을 훑어도 부담이 없다.
const jamoOf = (s: string): string => {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code >= 0 && code < 11172) {
      out += String.fromCharCode(0x1100 + Math.floor(code / 588));          // 초성
      out += String.fromCharCode(0x1161 + Math.floor((code % 588) / 28));   // 중성
      const jong = code % 28;
      if (jong) out += String.fromCharCode(0x11a7 + jong);                  // 종성
    } else {
      out += ch;
    }
  }
  return out;
};
const gramCache = new Map<string, Set<string>>();      // 키 문자열 → 자모 2-그램 (재검색 시 재활용)
function grams(key: string): Set<string> {
  let g = gramCache.get(key);
  if (!g) {
    const j = jamoOf(key);
    g = new Set<string>();
    for (let i = 0; i + 1 < j.length; i += 1) g.add(j.slice(i, i + 2));
    if (!g.size && j) g.add(j);
    gramCache.set(key, g);
  }
  return g;
}
const dice = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit += 1;
  return (2 * hit) / (a.size + b.size);
};
const FUZZY_MIN = 0.55;    // 이 밑은 "아예 다른 단어"로 본다
export const FUZZY_GATE = 72;   // 정상 매칭 최고점이 이보다 낮을 때만 근사 검색을 돌린다 (miss 판정도 공유)
const FUZZY_BASE = 30;     // 근사 후보 점수: 30 ~ 85 (완전일치 120은 절대 못 넘는다)
const LEARNED_BASE = 55;   // 학습된 별명(텍스트 불일치)로 끌어온 항목의 기본 점수

function fuzzyHits(items: OmniItem[], q: string, picks?: PickMap, kinds?: OmniKind[]): OmniHit[] {
  const qj = jamoOf(q);
  if (qj.length < 4) return [];        // 자모 4개(=2음절) 미만은 근사 검색이 잡음만 낸다
  const qg = grams(q);
  const out: OmniHit[] = [];
  for (const it of items) {
    if (kinds && !kinds.includes(it.kind)) continue;
    let best = 0;
    for (let i = 0; i < Math.min(it.keys.length, 4); i += 1) {
      const key = it.keys[i];
      if (key.startsWith("=")) continue;      // 조합 별칭은 근사 매칭 대상이 아니다
      const kj = jamoOf(key).length;
      if (kj < qj.length * 0.5 || kj > qj.length * 2) continue;   // 길이가 너무 다르면 후보 아님
      const d = dice(qg, grams(key)) - (i > 0 ? 0.04 : 0);
      if (d > best) best = d;
    }
    if (best < FUZZY_MIN) continue;
    const votes = picks?.[it.uid] ?? 0;
    const score = FUZZY_BASE + 55 * ((best - FUZZY_MIN) / (1 - FUZZY_MIN)) + pickBonus(votes);
    out.push({ ...it, score, votes, fuzzy: true });
  }
  return out;
}

// ── 분류 힌트 (별명·은어) ────────────────────────────────────────────────────
// "쉐이록라" = 쉐이(이름) + 록라(=로그라이크=통합전략). 이름 뒤에 붙은 분류어를 떼고
// 남은 이름으로 그 분류만 검색한다. 사용자가 새 은어를 쓰면 omni-picks의 힌트 학습이
// (검색어에서 남는 조각 → 고른 항목의 종류)를 기억해 이 사전에 얹힌다.
const HINT_TOKENS: { token: string; kinds: OmniKind[] }[] = [
  { token: "로그라이크", kinds: ["topic", "rogue"] },
  { token: "통합전략", kinds: ["topic", "rogue"] },
  { token: "록라", kinds: ["topic", "rogue"] },
  { token: "로라", kinds: ["topic", "rogue"] },
  { token: "통전", kinds: ["topic", "rogue"] },
  { token: "이벤트스토리", kinds: ["story"] },
  { token: "스토리", kinds: ["story"] },
  { token: "이벤트", kinds: ["story"] },
  { token: "썰", kinds: ["story"] },
  { token: "재료", kinds: ["material"] },
  { token: "파밍", kinds: ["material"] },
  { token: "공채", kinds: ["tag"] },
  { token: "태그", kinds: ["tag"] },
  { token: "오퍼레이터", kinds: ["op"] },
  { token: "오퍼", kinds: ["op"] },
  { token: "캐릭", kinds: ["op"] },
];
const HINT_BONUS = 34;   // 힌트가 지목한 종류에 얹는 가중 (확신 문턱 30을 넘겨 바로 이동 가능)

// ── 여러 낱말 검색 ("사미 글로리") ──────────────────────────────────────────
// 낱말 하나가 **범위**(어느 테마·어느 종류·어느 섹션)를 정하고, 나머지가 이름 조각이다.
// "사미 글로리" = 탐험가의 은빛 서리 끝자락 안에서 이름에 '글로리'가 든 것 → 《글로리어스 카시미어》.
// 범위 낱말은 테마 별명(TOPIC_NICKS·+록라 조합), 분류어(HINT_TOKENS), 아래 섹션어를 받는다.
// 섹션 → 그 섹션을 보여 주는 화면(뷰) — 범위만 준 검색("쉐이 조우")의 도착지
const SECTION_VIEW: Record<string, string> = {
  relic: "relic", enc: "map", stage: "map", zone: "map",
  band: "archive", capsule: "archive", scrap: "archive", mech: "archive", ending: "ending",
};
const SECTION_WORDS: Record<string, string> = {
  유물: "relic", 소장품: "relic", 아이템: "relic", 도구: "relic",
  조우: "enc", 이벤트칸: "enc",
  작전: "stage", 스테이지: "stage", 전투: "stage",
  구역: "zone", 지역: "zone", 층: "zone",
  분대: "band",
  음반: "capsule", 레퍼토리: "capsule",
  부품: "scrap",
  엔딩: "ending", 결말: "ending",
  시스템: "mech", 사고: "mech",
};
// 테마 별명·이름 → 토픽 id (별명 + "사미록라" 같은 붙임말 포함)
const topicByToken = (() => {
  const map = new Map<string, string>();
  for (const [topic, nicks] of Object.entries(TOPIC_NICKS)) {
    for (const nick of nicks) {
      map.set(norm(nick), topic);
      for (const word of ROGUE_WORDS) map.set(norm(nick + word), topic);
    }
  }
  for (const tp of TOPICS) {
    map.set(norm(tp.name), tp.id);
    for (const word of words(tp.name)) if (word.length >= 2) map.set(norm(word), tp.id);
    map.set(`is${tp.id.split("_")[1]}`, tp.id);
  }
  return map;
})();

const topicOf = (item: OmniItem): string | null =>
  item.target.kind === "rogue" ? item.target.topic : null;
const sectionOf = (item: OmniItem): string | null => {
  const parts = item.uid.split(":");
  return item.uid.startsWith("rg:") && parts.length >= 4 ? parts[2] : null;
};

/** 낱말이 여럿인 검색어를 (범위 + 이름 조각)으로 나눠 훑는다. 범위가 하나도 없으면 빈 결과. */
function tokenSearch(items: OmniItem[], raw: string, picks?: PickMap): OmniHit[] {
  const parts = raw.trim().split(/\s+/).map(norm).filter(Boolean);
  if (parts.length < 2) return [];
  const topics = new Set<string>();
  const kinds = new Set<OmniKind>();
  const sections = new Set<string>();
  const texts: string[] = [];
  for (const part of parts) {
    const topic = topicByToken.get(part);
    if (topic) { topics.add(topic); continue; }
    const hint = HINT_TOKENS.find((h) => h.token === part);
    if (hint) { for (const kind of hint.kinds) kinds.add(kind); continue; }
    const section = SECTION_WORDS[part];
    if (section) { sections.add(section); continue; }
    texts.push(part);
  }
  if (!topics.size && !kinds.size && !sections.size) return [];
  // 이름 조각 없이 범위만 준 경우 — "쉐이 조우"는 그 테마의 해당 화면으로, "사미 스토리"는
  // 그 테마 이름으로 스토리를 찾는다 (범위만으로 수백 개를 쏟아내지 않는다).
  if (!texts.length) {
    if (sections.size && topics.size) {
      const views = new Set([...sections].map((section) => SECTION_VIEW[section] ?? "archive"));
      return items
        .filter((item) => item.uid.startsWith("rgview:")
          && topics.has(item.uid.split(":")[1]) && views.has(item.uid.split(":")[2]))
        .map((item) => ({ ...item, score: LEARNED_BASE + HINT_BONUS, votes: 0, hinted: true }));
    }
    if (topics.size && kinds.size) {
      for (const topic of topics) {
        const name = TOPICS.find((tp) => tp.id === topic)?.name;
        if (name) texts.push(norm(name));
      }
    }
    if (!texts.length) return [];
  }
  const hits: OmniHit[] = [];
  for (const item of items) {
    if (topics.size) {
      const topic = topicOf(item);
      if (!topic || !topics.has(topic)) continue;
    }
    if (kinds.size && !kinds.has(item.kind)) continue;
    if (sections.size) {
      const section = sectionOf(item);
      if (!section || !sections.has(section)) continue;
    }
    // 이름 조각은 **전부** 맞아야 한다 (AND) — 하나라도 안 맞으면 후보 아님
    let total = 0;
    let ok = true;
    for (const text of texts) {
      let best = 0;
      for (let i = 0; i < item.keys.length; i += 1) {
        const key = item.keys[i];
        if (key.startsWith("=")) continue;
        const score = key === text ? EXACT
          : key.startsWith(text) ? PREFIX * (text.length / key.length)
            : key.includes(text) ? PART * (text.length / key.length)
              : 0;
        if (score > best) best = score;
      }
      if (best < 12) { ok = false; break; }     // 다중 낱말은 조각이 짧아 문턱을 낮춘다
      total += best;
    }
    if (!ok) continue;
    const votes = picks?.[item.uid] ?? 0;
    hits.push({ ...item, score: total / texts.length + HINT_BONUS + pickBonus(votes), votes, hinted: true });
  }
  return hits;
}

/** 검색어에서 분류어를 떼어낸다. learned = 선택 학습으로 익힌 은어(토큰 → 종류). */
export function splitHint(q: string, learned?: Record<string, OmniKind[]>): { rest: string; kinds: OmniKind[]; token: string } | null {
  const table = [
    ...Object.entries(learned ?? {}).map(([token, kinds]) => ({ token, kinds })),
    ...HINT_TOKENS,
  ].filter((h) => h.token && h.kinds.length).sort((a, b) => b.token.length - a.token.length);
  for (const h of table) {
    if (!q.includes(h.token)) continue;
    const rest = q.split(h.token).join("");        // 이름 + 분류어(앞·뒤 무관)
    if (rest.length >= 1) return { rest, kinds: h.kinds, token: h.token };
  }
  return null;
}

/** 사이트 검색 한 방 — 정확 매칭 + 분류 힌트 + (그래도 약하면) 오탈자 근사. */
export function searchSmart(items: OmniItem[], raw: string, opts?: {
  picks?: PickMap; hints?: Record<string, OmniKind[]>; limit?: number;
}): OmniHit[] {
  const q = norm(raw);
  if (!q) return [];
  const limit = opts?.limit ?? 10;
  const merged = new Map<string, OmniHit>();
  const put = (hit: OmniHit) => {
    const cur = merged.get(hit.uid);
    if (!cur || cur.score < hit.score) merged.set(hit.uid, hit);
  };
  for (const hit of searchOmni(items, q, { picks: opts?.picks, limit: 40 })) put(hit);

  // 여러 낱말: "사미 글로리" = 범위(사미) + 이름 조각(글로리)
  for (const hit of tokenSearch(items, raw, opts?.picks)) put(hit);

  const hint = splitHint(q, opts?.hints);
  if (hint) {
    for (const hit of searchOmni(items, hint.rest, { picks: opts?.picks, limit: 40 })) {
      if (!hint.kinds.includes(hit.kind)) continue;
      put({ ...hit, score: hit.score + HINT_BONUS, hinted: true });
    }
  }

  // 학습된 별명 — 글자가 하나도 안 맞아도 넣는다. "날시"는 어떤 이름과도 안 겹치지만
  // 사람들이 그렇게 검색한 뒤 결국 그 오퍼로 갔다면 답은 그 오퍼다 (app/trail.ts).
  if (opts?.picks) {
    const wanted = Object.entries(opts.picks).filter(([uid, weight]) => weight > 0 && !merged.has(uid));
    if (wanted.length) {
      const byUid = new Map(items.map((item) => [item.uid, item]));
      for (const [uid, weight] of wanted) {
        const item = byUid.get(uid);
        if (item) put({ ...item, score: LEARNED_BASE + pickBonus(weight), votes: weight, learned: true });
      }
    }
  }

  // 정상 매칭이 시원찮을 때만 근사 검색 (오탈자·기억 안 나는 이름)
  const best = Math.max(0, ...[...merged.values()].map((hit) => hit.score));
  if (best < FUZZY_GATE) {
    for (const hit of fuzzyHits(items, q, opts?.picks)) put(hit);
    if (hint) for (const hit of fuzzyHits(items, hint.rest, opts?.picks, hint.kinds)) {
      put({ ...hit, score: hit.score + HINT_BONUS, hinted: true });
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** 바로 이동해도 되는 1위인가 — 애매하면 null(= "이 중에 무엇인가요?" 선택지).
 *  preferTopic = 지금 보고 있는 통합전략 테마(있으면). 유물·분대는 이름이 테마 공용이라
 *  동점이 5개씩 나오는데, 그 테마 가이드를 보는 중이라면 그 테마를 고르는 게 맞다
 *  (스샷 레이더의 현재-토픽 사전확률 CTX_BOOST와 같은 판단). */
export function decideOmni(hits: OmniHit[], preferTopic?: string): OmniHit | null {
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0];
  const [first, second] = hits;
  // 완전일치가 하나뿐이면 그것 (동명이인·동명 항목이면 되묻는다)
  if (first.score >= EXACT && second.score < EXACT) return first;
  if (first.score - second.score >= DECIDE_GAP) return first;
  if (preferTopic) {
    const tied = hits.filter((hit) => hit.score >= first.score - 1e-6);
    if (tied.length > 1 && tied.every((hit) => hit.kind === "rogue" && hit.name === first.name)) {
      const mine = tied.find((hit) => hit.target.kind === "rogue" && hit.target.topic === preferTopic);
      if (mine) return mine;
    }
  }
  return null;
}

/** 현재 URL이 통합전략 페이지면 그 테마 id (없으면 undefined) — decideOmni의 사전확률용 */
export function currentRogueTopic(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (!/\/rogue\/?$/.test(window.location.pathname)) return undefined;
  const slug = new URLSearchParams(window.location.search).get("topic") ?? "";
  const num = /^is(\d+)$/.exec(slug);
  return num ? `rogue_${num[1]}` : "rogue_1";   // ?topic 없으면 기본 테마(팬텀)
}
