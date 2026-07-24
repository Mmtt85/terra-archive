"use client";
// 스샷 레이더 — 인식 파이프라인 (모달과 페이지 레벨 자동인식이 공유).
// 모드별 단계형 OCR + 매칭: 판정이 나면 나머지 패스를 생략한다 (속도).

import { createOcrSession } from "./ocr";
import { buildIndex, analyzeLines, analyzeChinese, analyzeRecruit, wantsChipPass, normFor, type LensIndex, type LensOutcome } from "./match";
import { parseStoryIndex, analyzeStoryLines, type StoryIndex } from "./storymatch";
import storySearchMeta from "../data/story-search-meta.json";

export type LensMode = "rogue" | "recruit" | "story";

// 화면 언어 → tesseract 프라이머리 모델 (KR=kor, EN=eng, JA=jpn). 그 외는 kor.
const OCR_LANG: Record<string, string> = { ko: "kor", en: "eng", ja: "jpn" };
/** 로케일 → OCR 프라이머리 모델명 (rogue.tsx가 warmOcr 예열에 쓴다). */
export const ocrLangFor = (locale: string): string => OCR_LANG[locale] ?? "kor";

// 로케일별 통합전략 데이터 모듈 — 사이트의 loadersFor(locale)와 같은 파일 세트.
// rogue_6(흑류수해)은 CN 선행이라 공식 EN/JA가 없어 전 로케일이 rogue6.json(KR/CN 병기)을 공유 —
// buildIndex가 EN/JA 인덱스에선 rogue_6의 ko 이름/본문을 비우고 cnN(중국어 패스)만 남긴다.
function rogueModules(locale: string): Promise<{ default: unknown }>[] {
  if (locale === "en") return [
    import("../data/rogue1.en.json"), import("../data/rogue2.en.json"), import("../data/rogue3.en.json"),
    import("../data/rogue4.en.json"), import("../data/rogue5.en.json"), import("../data/rogue6.json"),
  ];
  if (locale === "ja") return [
    import("../data/rogue1.ja.json"), import("../data/rogue2.ja.json"), import("../data/rogue3.ja.json"),
    import("../data/rogue4.ja.json"), import("../data/rogue5.ja.json"), import("../data/rogue6.json"),
  ];
  return [
    import("../data/rogue1.json"), import("../data/rogue2.json"), import("../data/rogue3.json"),
    import("../data/rogue4.json"), import("../data/rogue5.json"), import("../data/rogue6.json"),
  ];
}

// 매칭 데이터 지연 로드 — 로케일별로 캐시 (recruit는 rogue*.json 2.9MB를 안 내려받는다).
const rogueIndexByLoc = new Map<string, Promise<LensIndex>>();
export function getRogueIndex(locale = "ko"): Promise<LensIndex> {
  let p = rogueIndexByLoc.get(locale);
  if (!p) {
    p = Promise.all(rogueModules(locale)).then((mods) => buildIndex(mods.map((m) => m.default), normFor(locale)));
    p.catch(() => { rogueIndexByLoc.delete(locale); });
    rogueIndexByLoc.set(locale, p);
  }
  return p;
}
let recruitTagsP: Promise<string[]> | null = null;
export function getRecruitTags(): Promise<string[]> {
  if (!recruitTagsP) {
    recruitTagsP = import("../data/recruit.json")
      .then((m) => (m.default as { tags: { name: string }[] }).tags.map((tg) => tg.name));
    recruitTagsP.catch(() => { recruitTagsP = null; });
  }
  return recruitTagsP;
}
// 스토리 전문 검색 인덱스 (3.4MB 바이너리) — 토글을 켠 동안만 내려받는다
let storyIndexP: Promise<StoryIndex> | null = null;
export function getStoryIndex(): Promise<StoryIndex> {
  if (!storyIndexP) {
    storyIndexP = fetch("/story/search.bin")
      .then((r) => { if (!r.ok) throw new Error(`search.bin ${r.status}`); return r.arrayBuffer(); })
      .then((buf) => parseStoryIndex(buf, (storySearchMeta as { ids: string[] }).ids));
    storyIndexP.catch(() => { storyIndexP = null; });
  }
  return storyIndexP;
}

/** 데이터 예열 (모달 열림/토글 켜짐 시 호출). locale은 rogue 인덱스를 로케일별로 예열. */
export function warmData(mode: LensMode, locale = "ko"): void {
  if (mode === "recruit") void getRecruitTags();
  else if (mode === "story") void getStoryIndex();
  else void getRogueIndex(locale);
}

/** 스크린샷 1장 인식 — 모드별 단계형 파이프라인. topic은 rogue 모드의 현재 토픽(사전확률).
 *  locale(ko|en|ja)은 rogue 모드에서 OCR 모델·인덱스·정규화를 화면 언어에 맞춘다. */
export async function recognizeShot(mode: LensMode, file: Blob, topic?: string, locale = "ko"): Promise<LensOutcome> {
  let lines: string[];
  let oc: LensOutcome;
  if (mode === "recruit") {
    // 태그는 어두운 버튼 칩이 본체 — 칩 패스 필수, 전체 프레임은 보조 (선택된 파란 태그 등)
    const [tags, session] = await Promise.all([getRecruitTags(), createOcrSession(file)]);
    lines = (await session.chips()).concat(await session.sparse());
    oc = analyzeRecruit(lines, tags);
  } else if (mode === "story") {
    // 스토리 전문 대사 화면 — OCR 라인의 10자 그램을 역색인에 투표해 스토리·ep 특정 (2026-07-24)
    const [idx, session] = await Promise.all([getStoryIndex(), createOcrSession(file)]);
    lines = await session.sparse();
    let hit = analyzeStoryLines(lines, idx);
    // 표가 약하면 PSM3 폴백으로 보강 — 대사 스트립이 sparse에서 안 잡히는 캡처 대비
    if (!hit || hit.hits < 2) {
      lines = lines.concat(await session.auto());
      const hit2 = analyzeStoryLines(lines, idx);
      if (hit2 && (!hit || hit2.hits > hit.hits)) hit = hit2;
    }
    console.debug(`[lens] 스토리 판정: ${hit ? `${hit.id} ep${hit.ep ?? "?"} (표 ${hit.hits})` : "(없음)"}`);
    oc = hit
      ? { screens: [], entities: [], topics: [], section: "story", target: { kind: "goto", goto: { page: "story", id: hit.id, ep: hit.ep, hits: hit.hits } } }
      : { screens: [], entities: [], topics: [], section: null, target: { kind: "none" } };
  } else {
    // 화면 언어(로케일)로 OCR 모델·인덱스·정규화를 맞춘다 — KR=kor, EN=eng, JA=jpn.
    const norm = normFor(locale);
    const [index, session] = await Promise.all([getRogueIndex(locale), createOcrSession(file, OCR_LANG[locale] ?? "kor")]);
    // 단계형 인식 — PSM11만으로 판정이 나면 나머지 패스를 생략한다 (속도)
    lines = await session.sparse();
    let chipsRan = false;
    if (wantsChipPass(lines)) { chipsRan = true; lines = lines.concat(await session.chips()); }
    const ctx = { context: { topic }, norm };
    oc = analyzeLines(lines, index, ctx);
    // 중국어(흑류수해 CN 클라) 분기 — cn 화면은 무조건 흑류수해(사용자 확정). chi_sim으로 cn
    // 이름을 매칭한다. 이미지가 고정이라 zh 패스는 결정적 → 한 번만 돌리고 캐시(zhRan).
    let zhRan = false, zhHit = false;
    const tryZh = async () => {
      if (zhRan) return;
      zhRan = true;
      const zlines = await session.zh();
      const zoc = analyzeChinese(zlines, index);
      console.debug(`[lens] 중국어 패스: OCR ${zlines.length}줄 → ${zoc.target.kind}/${zoc.section ?? "-"}`);
      if (zoc.target.kind !== "none") { oc = zoc; zhHit = true; lines = zlines; }
    };
    // 1차 게이트 — KR(kor)은 중국어에서 무신호라 완전 무신호일 때만. EN/JA는 프라이머리(특히
    // jpn)가 한자를 kanji로 읽어 약한 표·tie를 낼 수 있어(cn 화면), 확신 goto가 아니면 시도한다.
    if ((oc.target.kind === "none" && !oc.topics.length && !oc.screens.length)
        || (locale !== "ko" && oc.target.kind !== "goto")) {
      await tryZh();
    }
    // 폴백 패스: none·tie(판정 미완) 또는 하이라이트형 goto(목록 표시 — 엔티티 완성도가 중요,
    // 예: 분대 4개 중 PSM11이 3개만 읽은 경우)일 때 PSM3·칩으로 보강 후 재판정.
    const needMore = !zhHit && (oc.target.kind !== "goto"
      || (oc.target.goto.page === "rogue" && !oc.target.goto.modal && !!oc.target.goto.highlight));
    if (needMore) {
      lines = lines.concat(await session.auto());
      if (!chipsRan) lines = lines.concat(await session.chips());
      oc = analyzeLines(lines, index, ctx);
      // 폴백까지 실패(무신호)면 마지막으로 중국어를 시도한다 (zhRan이면 이미 돌려 스킵)
      if (oc.target.kind === "none") await tryZh();
    }
    // 좌하단 난이도 배지 — 있으면 이동 목표에 스탬프해 난이도 셀렉터에 자동 적용 (2026-07-24)
    if (oc.target.kind !== "none") {
      const grade = await session.difficulty();
      console.debug(`[lens] 난이도 배지: ${grade ?? "(없음)"}`);
      if (grade !== null) {
        if (oc.target.kind === "goto" && oc.target.goto.page === "rogue") oc.target.goto.grade = grade;
        else if (oc.target.kind === "tie") for (const o of oc.target.options) { if (o.goto.page === "rogue") o.goto.grade = grade; }
      }
    }
  }
  // 필드 진단용 — 오인식 리포트를 받으면 콘솔에서 OCR 라인·판정을 바로 확인한다
  console.debug(`[lens:${mode}] OCR ${lines.length}줄 → ${oc.target.kind}/${oc.section ?? "-"} · 엔티티 ${oc.entities.length}`, { lines, outcome: oc });
  return oc;
}
