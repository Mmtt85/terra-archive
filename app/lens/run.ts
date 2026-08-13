"use client";
// 스샷 레이더 — 인식 파이프라인 (모달과 페이지 레벨 자동인식이 공유).
// 모드별 단계형 OCR + 매칭: 판정이 나면 나머지 패스를 생략한다 (속도).

import { createOcrSession } from "./ocr";
import { asset } from "../assets";
import { buildIndex, analyzeLines, analyzeChinese, analyzeRecruit, wantsChipPass, normFor, type LensIndex, type LensOutcome, type LensHud } from "./match";
import { parseStoryIndex, analyzeStoryLines, type StoryIndex } from "./storymatch";
import storySearchMeta from "../data/story-search-meta.json";

export type LensMode = "rogue" | "recruit" | "story";

// 라이브 스트림용 난이도 캐시 — 한 판 도는 동안 불변 (배지 OCR 생략, 10분 TTL).
// 미검출(배지 없는 화면·모달)도 기억해 10초 쿨다운을 둔다 — 없는 배지를 화면마다
// 0.3초씩 다시 찾는 낭비 제거 ("고정되면 안 바뀌는 항목은 무시", 2026-07-26).
// ⚠ 확정은 **2회 연속 같은 값**일 때만 — 배지 OCR은 가끔 오독하는데(영상6: 3을 4로),
// 한 번 읽고 세션 캐시에 박으면 그 오독이 판 내내 남는다. 첫 읽기는 보류만 한다.
let gradeCache: { grade: number; at: number } | null = null;
let gradePend: number | null = null;
let gradeMissAt = 0;
/** 게임 연결 시작 시 호출 — 지난 판의 난이도가 새 판에 새지 않게 캐시를 비운다. */
export function resetGradeCache(): void { gradeCache = null; gradePend = null; gradeMissAt = 0; }

// 전투 입장 암전 화면의 평균 밝기 상한. 사미 지도·모달은 아트가 깔려 훨씬 밝고, 입장
// 로딩은 검은 배경에 작전 이름만 뜬다 (2026-07-26). 여유를 두되 지도가 걸리지 않는 값.
const DARK_LUMA = 46;

/** 게임 HUD 수치 파싱 (원시 OCR 라인) — 브리지 플레이 로그용 추정치 */
function parseHud(rawLines: string[]): LensHud {
  const fractions: [number, number][] = [];
  for (const l of rawLines) {
    const m = l.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
    if (!m) continue;
    const cur = parseInt(m[1], 10), max = parseInt(m[2], 10);
    if (max >= 1 && max <= 999 && cur <= max) fractions.push([cur, max]);
  }
  const all = rawLines.join("").replace(/\s/g, "");
  const hud: LensHud = { fractions };
  const hp = fractions.find(([, mx]) => mx >= 3 && mx <= 12);
  const exp = fractions.find(([, mx]) => mx >= 13 && mx <= 99);
  if (hp) hud.hp = hp;
  if (exp) hud.levelExp = exp;
  if (all.includes("작전성공")) hud.result = "success";
  else if (all.includes("작전실패")) hud.result = "fail";
  return hud;
}

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

// 중섭 탭(rogue.tsx의 서버 토글)을 켠 테마의 CN 원문 — **중국어 이름만** 얹으려고 따로 받는다.
// rogue_6은 rogue6.json 자체가 KR/CN 병기라 여기 없다(있으면 두 벌이 된다).
const CN_MODULES: Record<string, () => Promise<{ default: unknown }>> = {
  rogue_1: () => import("../data/rogue1.cn.json"),
  rogue_2: () => import("../data/rogue2.cn.json"),
  rogue_3: () => import("../data/rogue3.cn.json"),
  rogue_4: () => import("../data/rogue4.cn.json"),
  rogue_5: () => import("../data/rogue5.cn.json"),
};

// 매칭 데이터 지연 로드 — 로케일 + 중섭 테마별로 캐시 (recruit는 rogue*.json 2.9MB를 안 내려받는다).
// cnTopic이 있으면 그 테마의 CN 이름을 얹어 중국어 패스가 흑류수해 말고도 잡을 수 있게 한다
// (2026-08-13 사용자 지적: "흑류수해 말고 다른 록라 중섭으로 바꾸면 중국어 인식 못하지?" — 맞았다).
// 캐시 키가 로케일 → 로케일×중섭테마로 늘었다(최대 3×6). 인덱스 구축은 트라이그램 계산이라
// 공짜가 아니지만, 스샷 레이더·PRTS 링크를 켠 동안에만 불리고 테마를 바꿔가며 인식하는
// 사용은 드물어 그대로 둔다 — 문제가 되면 LRU로 줄일 것.
const rogueIndexByLoc = new Map<string, Promise<LensIndex>>();
export function getRogueIndex(locale = "ko", cnTopic?: string): Promise<LensIndex> {
  const cnLoad = cnTopic ? CN_MODULES[cnTopic] : undefined;   // rogue_6 등 변형이 없으면 무시
  const key = `${locale}|${cnLoad ? cnTopic : ""}`;
  let p = rogueIndexByLoc.get(key);
  if (!p) {
    p = Promise.all([Promise.all(rogueModules(locale)), cnLoad ? cnLoad() : null])
      .then(([mods, cn]) => buildIndex(mods.map((m) => m.default), normFor(locale),
        cn ? [cn.default] : []));
    p.catch(() => { rogueIndexByLoc.delete(key); });
    rogueIndexByLoc.set(key, p);
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
    storyIndexP = fetch(asset("/story/search.bin"))
      .then((r) => { if (!r.ok) throw new Error(`search.bin ${r.status}`); return r.arrayBuffer(); })
      .then((buf) => parseStoryIndex(buf, (storySearchMeta as { ids: string[] }).ids));
    storyIndexP.catch(() => { storyIndexP = null; });
  }
  return storyIndexP;
}

/** 데이터 예열 (모달 열림/토글 켜짐 시 호출). locale은 rogue 인덱스를 로케일별로 예열.
 *  cnTopic — 중섭 탭을 켠 테마. 인덱스가 로케일+중섭 조합으로 캐시되므로 같이 넘겨야
 *  실제로 쓸 인덱스가 예열된다 (안 넘기면 한섭 인덱스만 데워 놓고 다시 받는다). */
export function warmData(mode: LensMode, locale = "ko", cnTopic?: string): void {
  if (mode === "recruit") void getRecruitTags();
  else if (mode === "story") void getStoryIndex();
  else void getRogueIndex(locale, cnTopic);
}

/** 스크린샷 1장 인식 — 모드별 단계형 파이프라인. topic은 rogue 모드의 현재 토픽(사전확률).
 *  locale(ko|en|ja)은 rogue 모드에서 OCR 모델·인덱스·정규화를 화면 언어에 맞춘다.
 *  opts.lock — 테마 하드 고정(테마별 게임연결): topic 밖은 아예 보지 않는다.
 *  opts.cnTopic — 중섭 탭을 켠 테마(rogue.tsx의 서버 토글). 그 테마의 CN 이름을 인덱스에
 *    얹고 중국어 패스 게이트도 열어 준다.
 *  opts.live — 라이브 스트림용 빠른 경로: 비싼 폴백 패스(PSM3·칩 재시도)를 생략한다.
 *    스샷은 한 장이 전부라 폴백까지 짜내야 하지만, 스트림은 다음 프레임이 오므로
 *    못 읽으면 그냥 넘기는 게 총 지연이 짧다 (사용자 체감 "너무 느림" 대응 2026-07-26). */
export async function recognizeShot(mode: LensMode, file: Blob, topic?: string, locale = "ko",
  opts?: { lock?: boolean; live?: boolean; cnTopic?: string }): Promise<LensOutcome> {
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
    const [index, session] = await Promise.all([getRogueIndex(locale, opts?.cnTopic), createOcrSession(file, OCR_LANG[locale] ?? "kor")]);
    // 난이도 배지 — 전용 eng 워커라 본 패스와 **병렬**로 미리 돌린다 (직렬 ~0.3초 제거).
    // 라이브(게임 연결)는 세션 캐시가 유효하거나 미검출 쿨다운 중이면 아예 생략한다.
    const gradeFresh = !!gradeCache && Date.now() - gradeCache.at < 10 * 60_000;
    const skipGradeOcr = !!opts?.live && (gradeFresh || Date.now() - gradeMissAt < 10_000);
    const gradeP = skipGradeOcr ? null : session.difficulty()
      .then((g) => {
        if (g === null) { gradeMissAt = Date.now(); return null; }
        if (!opts?.live) return g;                       // 수동 스샷 1장은 그대로 쓴다 (기존 동작)
        if (gradePend === g) { gradeCache = { grade: g, at: Date.now() }; return g; }
        gradePend = g;                                   // 첫 읽기 — 다음 화면과 일치해야 확정
        console.debug(`[lens] 난이도 배지 보류: ${g} (재확인 대기)`);
        return null;
      })
      .catch(() => null);
    // 단계형 인식 — PSM11만으로 판정이 나면 나머지 패스를 생략한다 (속도)
    lines = await session.sparse();
    let chipsRan = false;
    if (wantsChipPass(lines)) { chipsRan = true; lines = lines.concat(await session.chips()); }
    const ctx = { context: { topic, lock: opts?.lock }, norm };
    oc = analyzeLines(lines, index, ctx);
    // 중국어(CN 클라) 분기 — chi_sim으로 cn 이름을 매칭한다. 이미지가 고정이라 zh 패스는
    // 결정적 → 한 번만 돌리고 캐시(zhRan). 예전엔 "cn 화면은 무조건 흑류수해"였지만,
    // 중섭 탭을 켠 테마도 이제 여기서 잡힌다 (2026-08-13 — 아래 zhPossible 참조).
    let zhRan = false, zhHit = false;
    const tryZh = async () => {
      if (zhRan) return;
      zhRan = true;
      const zlines = await session.zh();
      // 문맥(테마·잠금)을 한국어 패스와 똑같이 넘긴다 — 시리즈 공통 유물의 중국어 이름이
      // IS5·IS6에 154개 겹쳐서, 문맥 없이는 중섭 IS5 화면이 흑류수해로 샌다 (2026-08-13).
      const zoc = analyzeChinese(zlines, index, { topic, lock: opts?.lock });
      console.debug(`[lens] 중국어 패스: OCR ${zlines.length}줄 → ${zoc.target.kind}/${zoc.section ?? "-"}`);
      if (zoc.target.kind !== "none") { oc = zoc; zhHit = true; lines = zlines; }
    };
    // 1차 게이트 — KR(kor)은 중국어에서 무신호라 완전 무신호일 때만. EN/JA는 프라이머리(특히
    // jpn)가 한자를 kanji로 읽어 약한 표·tie를 낼 수 있어(cn 화면), 확신 goto가 아니면 시도한다.
    // 테마 고정 시에는 그 테마가 중국어일 수 있을 때만 zh 패스를 돈다 — 흑류수해(CN 선행)
    // 이거나, **중섭 탭을 켠 그 테마**일 때. 2026-08-13 이전엔 rogue_6만 통과시켜서,
    // IS1~5를 중섭으로 놓고 PRTS 링크를 걸면 chi_sim 패스가 아예 안 돌았다(사용자 지적).
    const zhPossible = !opts?.lock || topic === "rogue_6"
      || (!!opts?.cnTopic && topic === opts.cnTopic);
    if (zhPossible && ((oc.target.kind === "none" && !oc.topics.length && !oc.screens.length)
        || (locale !== "ko" && oc.target.kind !== "goto"))) {
      await tryZh();
    }
    // 폴백 패스: none·tie(판정 미완) 또는 하이라이트형 goto(목록 표시 — 엔티티 완성도가 중요,
    // 예: 분대 4개 중 PSM11이 3개만 읽은 경우)일 때 PSM3·칩으로 보강 후 재판정.
    // 라이브 스트림은 생략 — 다음 프레임이 오므로 짜내지 않는 쪽이 총 지연이 짧다.
    const needMore = !opts?.live && !zhHit && (oc.target.kind !== "goto"
      || (oc.target.goto.page === "rogue" && !oc.target.goto.modal && !!oc.target.goto.highlight));
    if (needMore) {
      lines = lines.concat(await session.auto());
      if (!chipsRan) lines = lines.concat(await session.chips());
      oc = analyzeLines(lines, index, ctx);
      // 폴백까지 실패(무신호)면 마지막으로 중국어를 시도한다 (zhRan이면 이미 돌려 스킵)
      if (zhPossible && oc.target.kind === "none") await tryZh();
    }
    // 전투 입장 암전 — 화면이 검게 덮이고 전투 이름만 뜨는 로딩 화면 (사용자 확정 2026-07-26).
    // 리플레이가 "노드를 눌러 본 것"과 "실제로 들어간 것"을 가르는 신호다. 지도·모달은
    // 아트가 깔려 평균 밝기가 훨씬 높다.
    oc.dark = session.luma < DARK_LUMA;
    // HUD 수치 파싱 — 브리지 플레이 로그용. 정규화가 '/'를 지우므로 **원시 라인**에서 읽는다.
    // OCR 오독(8/8→878)이 흔해 추정치다: 분수 전부를 원시로 남기고, 분모 크기로 HP/경험치를 가른다.
    oc.hud = parseHud(lines);
    // 긴급 작전 화면 색 감지 — 붉은 배너 위 '긴급 작전' 글자는 OCR이 자주 놓친다
    // (2026-07-26 영상3 실측: 텍스트 0회 검출). 강한 빨강 비율 1.1% 이상이면 긴급으로 본다 (영상5에서 1.4 미달 사례 → 하향, 음성 최대 0.9%).
    if (session.redness >= 0.011) {
      if (oc.target.kind === "goto" && oc.target.goto.page === "rogue" && oc.target.goto.modal?.type === "stage") oc.target.goto.emergency = true;
      else if (oc.target.kind === "tie") for (const o of oc.target.options) { if (o.goto.page === "rogue" && o.goto.modal?.type === "stage") o.goto.emergency = true; }
    }
    // 좌하단 난이도 배지 — 있으면 이동 목표에 스탬프해 난이도 셀렉터에 자동 적용 (2026-07-24)
    // ⚠ 배지는 **좌하단 육각형**이다 — 화면 상단 중앙의 숫자는 난이도가 아니라 별개
    // 게임 수치(간섭 방지 지수, 사용자 교정 2026-07-26)이므로 절대 읽지 않는다.
    if (oc.target.kind !== "none") {
      const grade = gradeP ? await gradeP : gradeFresh ? gradeCache!.grade : null;
      console.debug(`[lens] 난이도 배지: ${grade ?? "(없음)"}${gradeP ? "" : " (캐시)"}`);
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
