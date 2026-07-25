"use client";

// 헤더 만능검색 — 사이트 전체 컨텐츠 색인 + 점수 매김 (순수 로직, UI는 omni.tsx).
//
// 색인 대상과 이동 방법:
//   오퍼레이터   → #op-<id> 모달 (별명·코드·다국어 이름 포함)
//   스토리       → 스토리 탭 #story-<id>
//   재료         → 파밍 탭 재료 상세 모달 (커뮤니티 은어 별칭 포함)
//   공채 태그    → 공채 도우미 탭 태그 선택
//   통합전략 테마 → /rogue?topic=isN
//   통합전략 항목 → 유물·조우·작전·분대… (스샷 레이더 인덱스 재사용, **지연 로드 2.9MB**)
//   기능 탭      → 인프라 자동편성기·파밍·육성 시뮬 등 (동의어: riic, base, is3 …)
//
// 무거운 통합전략 항목은 기본 색인에서 빠져 있다 — 가벼운 색인으로 답이 안 나올 때만
// omni.tsx가 getRogueIndex()로 받아 rogueOmniItems()로 합친다.
import recruitData from "./data/recruit.json";
import { ALL_MATERIALS, MATERIAL_ALIASES } from "./farm";
import { canOpenStory, eventById } from "./story";
import { TOPICS } from "./rogue";
import { normSearch } from "./search";
import { gotoForEntity, type LensGoto, type LensIndex } from "./lens/match";
import type { Operator, Tab } from "./home";
import type { ExtraI18n, Locale, T } from "./i18n";

export type OmniKind = "op" | "story" | "material" | "tag" | "rogue" | "tab";

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
export type OmniHit = OmniItem & { score: number };

// 점수: 완전일치 > 접두일치 > 부분일치. 접두·부분은 검색어가 후보를 얼마나 덮는지(비율)로 스케일.
const EXACT = 120;
const PREFIX = 100;
const PART = 60;
const ALIAS_PENALTY = 8;     // 별명·코드로 잡힌 건 이름으로 잡힌 것보다 한 단계 아래
const MIN_SCORE = 18;        // 이 밑은 잡음 (한 글자 검색어가 전 항목에 걸리는 것 방지)
const DECIDE_GAP = 30;       // 1위-2위 점수차가 이 이상이면 되묻지 않고 바로 이동
// 종류별 미세 가중 — 같은 점수면 사람이 먼저 떠올릴 법한 쪽을 위로
const KIND_BONUS: Record<OmniKind, number> = { op: 3, tab: 2, story: 2, material: 1, tag: 0, rogue: 0 };

const norm = (s: string) => normSearch(s);
const keysOf = (...raw: (string | null | undefined)[]) => {
  const out: string[] = [];
  for (const s of raw) {
    const k = norm(s ?? "");
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
};

// ── 기능 탭 ────────────────────────────────────────────────────────────────
// 동의어는 로케일과 무관하게 전부 실어 둔다 — 한국 사용자가 "riic", "IS3"로 찾기도 한다.
const TAB_ENTRIES: { tab: Tab; label: string; alt: string[] }[] = [
  { tab: "portal", label: "홈", alt: ["home", "portal", "메인", "첫화면"] },
  { tab: "archive", label: "오퍼 백과사전", alt: ["operator archive", "도감", "오퍼레이터", "백과", "캐릭터"] },
  { tab: "planner", label: "인프라 자동편성기", alt: ["riic", "base", "기지", "기반시설", "인프라", "편성", "자동편성"] },
  { tab: "recruit", label: "공채 도우미", alt: ["recruit", "공개모집", "공채", "태그계산"] },
  { tab: "farm", label: "파밍 도우미", alt: ["farm", "재료", "파밍", "효율표", "드랍"] },
  { tab: "upgrade", label: "오퍼 육성 시뮬", alt: ["upgrade", "육성", "비용", "계산기", "스킬특화", "모듈"] },
  { tab: "story", label: "스토리", alt: ["story", "요약", "전문", "연대기"] },
  { tab: "rogue", label: "통합전략 가이드", alt: ["rogue", "integrated strategies", "로그라이크", "통합전략", "is"] },
  { tab: "about", label: "소개", alt: ["about", "소개", "문의", "제작"] },
];

const SECTION_LABEL: Record<string, string> = {
  band: "분대", relic: "소장품", stage: "작전", zone: "구역", enc: "조우",
  capsule: "음반", scrap: "부품", ending: "엔딩", mech: "시스템",
};

export type OmniSource = {
  roster: Operator[];                                  // 미래시 토글이 이미 반영된 목록
  nicknames?: Map<string, { name: string; votes: number }[]>;
  includeFuture: boolean;
  locale: Locale;
  t: T;
  extra?: ExtraI18n | null;
};

/** 가벼운 색인 — 이미 번들에 들어 있는 데이터만 쓴다 (통합전략 세부 항목 제외). */
export function buildOmniIndex({ roster, nicknames, includeFuture, locale, t, extra }: OmniSource): OmniItem[] {
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
    items.push({
      uid: `topic:${tp.id}`, kind: "tab", name: t(tp.name), sub: t("통합전략 테마"),
      keys: keysOf(t(tp.name), tp.name, `is${num}`, `통합전략${num}`),
      target: { kind: "rogue", topic: tp.id },
    });
  }

  for (const op of roster) {
    const nicks = (nicknames?.get(op.id) ?? []).filter((n) => n.votes >= 3).map((n) => n.name);
    items.push({
      uid: `op:${op.id}`, kind: "op", name: op.name,
      sub: `${op.rarity}★ ${op.job}`,
      img: `/avatars/${op.id}.webp`,
      keys: keysOf(op.name, ...op.aliases, ...nicks, op.code),
      target: { kind: "op", id: op.id },
    });
  }

  for (const ev of eventById.values()) {
    if (!canOpenStory(ev.id) || (ev.unreleased && !includeFuture)) continue;
    const name = (locale === "ko" ? ev.name.ko : ev.name[locale]) ?? ev.name.ko;
    items.push({
      uid: `story:${ev.id}`, kind: "story", name,
      sub: ev.epNo != null ? t("메인 스토리") : t("이벤트 스토리"),
      keys: keysOf(name, ev.name.ko, ev.name.en, ev.name.ja),
      target: { kind: "story", id: ev.id },
    });
  }

  for (const item of ALL_MATERIALS) {
    if (item.unreleased && !includeFuture) continue;
    const name = (locale === "ko" ? item.name.ko : item.name[locale]) ?? item.name.ko;
    items.push({
      uid: `mat:${item.id}`, kind: "material", name,
      sub: `T${item.rarity} · ${t("재료")}`, img: item.image,
      keys: keysOf(name, item.name.ko, item.name.en, item.name.ja, ...(MATERIAL_ALIASES[item.id] ?? [])),
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

/** 통합전략 세부 항목 — 스샷 레이더 인덱스(지연 로드)를 그대로 재활용한다. */
export function rogueOmniItems(index: LensIndex, includeFuture: boolean, t: T): OmniItem[] {
  const allowed = new Set(TOPICS.filter((tp) => tp.ready && (!tp.future || includeFuture)).map((tp) => tp.id));
  const items: OmniItem[] = [];
  for (const e of index.entries) {
    // nameN이 빈 엔트리 = EN/JA 인덱스의 CN 선행 항목 (중국어 패스 전용) — 검색에 안 걸린다
    if (!e.nameN || !allowed.has(e.topic)) continue;
    const goto = gotoForEntity(e);
    if (!goto) continue;
    items.push({
      uid: `rg:${e.topic}:${e.section}:${e.id}`, kind: "rogue", name: e.name,
      // topicName은 로케일 데이터(rogueN.<loc>.json)에서 온 이름이라 그대로 쓴다
      sub: `${e.topicName} · ${t(SECTION_LABEL[e.section] ?? e.section)}`,
      keys: [e.nameN],
      target: { kind: "rogue", topic: e.topic, goto },
    });
  }
  return items;
}

export function searchOmni(items: OmniItem[], raw: string, limit = 12): OmniHit[] {
  const q = norm(raw);
  if (!q) return [];
  const hits: OmniHit[] = [];
  for (const it of items) {
    let best = 0;
    for (let i = 0; i < it.keys.length; i += 1) {
      const k = it.keys[i];
      let score = k === q ? EXACT
        : k.startsWith(q) ? PREFIX * (q.length / k.length)
          : k.includes(q) ? PART * (q.length / k.length)
            : 0;
      if (score && i > 0) score -= ALIAS_PENALTY;
      if (score > best) best = score;
    }
    if (best < MIN_SCORE) continue;
    hits.push({ ...it, score: best + KIND_BONUS[it.kind] });
  }
  hits.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
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
