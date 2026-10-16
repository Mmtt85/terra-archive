"use client";
// 스샷 레이더 — 인식 파이프라인 (모달과 페이지 레벨 자동인식이 공유).
// 모드별 단계형 OCR + 매칭: 판정이 나면 나머지 패스를 생략한다 (속도).

import { createOcrSession } from "./ocr";
import { traceOcr } from "./ocr-trace";
import { setBridgePipFloor } from "./bridge";
import { asset } from "../assets";
import { buildIndex, normText, analyzeLines, analyzeChinese, analyzeRecruit, recruitLayoutOk, type RecruitLang, wantsChipPass, isCollectLine, isCollectLineCn, LENS_ITEM_SECTIONS, normFor, type LensIndex, type LensOutcome, type LensHud } from "./match";
import { parseStoryIndex, analyzeStoryLines, type StoryIndex } from "./storymatch";
import { buildAcIndex, bondOfLine, parseSeats, isAcInfoScreen, classifyAcScreen, parseAcMode, badgeRectFromTitle,
  parseAcBand, parseDeployLeft, parseAcHud, findAcRings, ringNameRect, ringNumRect, RING_DIGITS, parseRingStack,
  buildPieceNameIndex, matchPieceName, type AcIndex, type PieceIndex, type AcScreen } from "./acmatch";
import { findAcRows, isAcBanScreen, acBanRows } from "./acvision";
import { cardFeature, solveBanRow, type FacePiece } from "./acface";
import { loadFaceTemplates } from "./acface-load";
import { participantRows, searchBand, BAND_ACCEPT } from "./acband";
import { loadBandTemplates } from "./acband-load";
import { matchBondIcon, bondOfHit } from "./acbond";
import { loadBondTemplates } from "./acbond-load";
import storySearchMeta from "../data/story-search-meta.json";

export type LensMode = "rogue" | "recruit" | "story" | "autochess";

// 라이브 스트림용 난이도 캐시 — 한 판 도는 동안 불변 (배지 OCR 생략, 10분 TTL).
// 미검출(배지 없는 화면·모달)도 기억해 10초 쿨다운을 둔다 — 없는 배지를 화면마다
// 0.3초씩 다시 찾는 낭비 제거 ("고정되면 안 바뀌는 항목은 무시", 2026-07-26).
// ⚠ 확정은 **2회 연속 같은 값**일 때만 — 배지 OCR은 가끔 오독하는데(영상6: 3을 4로),
// 한 번 읽고 세션 캐시에 박으면 그 오독이 판 내내 남는다. 첫 읽기는 보류만 한다.
let gradeCache: { grade: number; at: number } | null = null;
let gradePend: number | null = null;
let gradeMissAt = 0;
/** 게임 연결 시작 시 호출 — 지난 판의 난이도가 새 판에 새지 않게 캐시를 비운다. */
export function resetGradeCache(): void { gradeCache = null; gradePend = null; gradeMissAt = 0; runGrade = null; }
// 한 판의 난이도 — '초기 모집' 화면 왼쪽 아래 배지에서 읽어 그 판 동안 고정한다 (사용자 지시 2026-10-13 "시작 전 오퍼 고르기 화면에서
// 이미 분대·난이도가 정해져 있다 — 이 시점에서 고정"). 다음 판의 '분대 선택' 화면이 보이면 푼다
let runGrade: number | null = null;

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
// rogue_6(블랙플로우)은 CN 선행이라 공식 EN/JA가 없어 전 로케일이 rogue6.json(KR/CN 병기)을 공유 —
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
// cnTopic이 있으면 그 테마의 CN 이름을 얹어 중국어 패스가 블랙플로우 말고도 잡을 수 있게 한다
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
/** 영어·일본어 공채 — 한국어 태그 → 그 언어 태그 이름 (extra-i18n.{en,ja}.json recruitTags, 태그 id 로 잇는다). 한국어면 undefined */
const recruitLangP = new Map<string, Promise<RecruitLang | undefined>>();
export function getRecruitLang(locale = "ko"): Promise<RecruitLang | undefined> {
  if (locale !== "en" && locale !== "ja") return Promise.resolve(undefined);
  let p = recruitLangP.get(locale);
  if (!p) {
    p = Promise.all([import("../data/recruit.json"), locale === "en" ? import("../data/extra-i18n.en.json") : import("../data/extra-i18n.ja.json")])
      .then(([r, x]) => {
        const loc = (x.default as { recruitTags?: Record<string, string> }).recruitTags ?? {};
        const alias: Record<string, string> = {};
        for (const tg of (r.default as { tags: { id: number; name: string }[] }).tags) if (loc[String(tg.id)]) alias[tg.name] = loc[String(tg.id)];
        return { norm: normFor(locale), alias };
      });
    p.catch(() => recruitLangP.delete(locale));
    recruitLangP.set(locale, p);
  }
  return p;
}
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

// 위수 협의 데이터 — 맹약 이름 색인 + 기물(얼굴 매칭용 op·티어·맹약) + 전략(대표 오퍼 이름) + 기물/장비 이름 색인.
// autochess.json 을 로케일별로 지연 import 한다 (페이지가 이미 들고 있어 캐시 적중). 이름은 로케일판, 정규화는 normFor(locale).
type AcData = {
  idx: AcIndex;                       // 맹약 이름 → id (링 아래 이름 줄)
  pieces: FacePiece[];                // 얼굴 매칭 후보 — chess 기본형 id · op(초상 파일명) · 티어 · 맹약
  ops: string[];                      // 초상이 필요한 op 전부 (예열용)
  bands: { id: string; n: string; by?: string }[];
  bondIds: string[];                  // 맹약 아이콘 템플릿(public/ac/bond/<id>.webp) — 밴 행 게이트·라벨
  pieceIdx: PieceIndex;               // 상점 카드·툴팁 이름 → chess/equip id
};
type AcJson = {
  bonds?: { id: string; n: string }[];
  chess?: { id: string; op?: string | null; n: string; t: number; bonds: string[] }[];
  bands?: { id: string; n: string; by?: string }[];
  equips?: { id: string; n: string }[];
};
const acDataByLoc = new Map<string, Promise<AcData>>();
export function getAcData(locale = "ko"): Promise<AcData> {
  let p = acDataByLoc.get(locale);
  if (!p) {
    const load = locale === "en" ? import("../data/autochess.en.json")
      : locale === "ja" ? import("../data/autochess.ja.json")
        : import("../data/autochess.json");
    p = load.then((m) => {
      const d = m.default as AcJson;
      const norm = normFor(locale);
      const pieces: FacePiece[] = (d.chess ?? []).filter((c) => !!c.op)
        .map((c) => ({ id: c.id, op: c.op as string, t: c.t, bonds: c.bonds }));
      return {
        idx: buildAcIndex(d.bonds ?? [], norm),
        pieces,
        ops: [...new Set(pieces.map((x) => x.op))],
        bands: d.bands ?? [],
        bondIds: (d.bonds ?? []).map((b) => b.id),
        pieceIdx: buildPieceNameIndex(d.chess ?? [], d.equips ?? [], norm),
      };
    });
    p.catch(() => { acDataByLoc.delete(locale); });
    acDataByLoc.set(locale, p);
  }
  return p;
}

/** 프레임의 **원색 픽셀** — 밴 격자(티어 배지 색)·얼굴·맹약 링·전략 아이콘이 전부 색을 본다.
 *  OCR 세션 캔버스는 grayNormalize 를 거쳐 색이 없으므로 blob 을 한 번 더 디코드한다 (ocr.ts colorBand 와 같은 이유). */
async function decodeColor(file: Blob): Promise<{ px: Uint8ClampedArray; W: number; H: number } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) { bmp.close(); return null; }
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const img = ctx.getImageData(0, 0, c.width, c.height);
    return { px: img.data, W: c.width, H: c.height };
  } catch { return null; }
}

/** 데이터 예열 (모달 열림/토글 켜짐 시 호출). locale은 rogue 인덱스를 로케일별로 예열.
 *  cnTopic — 중섭 탭을 켠 테마. 인덱스가 로케일+중섭 조합으로 캐시되므로 같이 넘겨야
 *  실제로 쓸 인덱스가 예열된다 (안 넘기면 한섭 인덱스만 데워 놓고 다시 받는다). */
export function warmData(mode: LensMode, locale = "ko", cnTopic?: string): void {
  if (mode === "recruit") void getRecruitTags();
  else if (mode === "story") void getStoryIndex();
  else if (mode === "autochess") void getAcData(locale);
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
  let rogueScreenOut: "map" | "runStart" | "squadSelect" | "lobby" | undefined;
  let rogueNodeOut: string | undefined;
  let oc: LensOutcome;
  if (mode === "recruit") {
    // 태그는 어두운 버튼 칩이 본체 — 칩 패스 필수, 전체 프레임은 보조 (선택된 파란 태그 등)
    // 칩은 PaddleOCR 로 (한국어, 2026-10-13 — app/lens/paddle.ts). 못 쓰면 ocr.ts 가 tesseract 로 물러난다
    // 2026-10-13~ 영어·일본어 사이트는 그 언어 게임 화면을 읽는다 — 글섭·일섭 공채 화면(PaddleOCR 중·일·영 모델) →
    // 그 언어 태그 이름을 한국어 태그로 맞춰 공채 판에 넣는다 (사용자 지시 "공채 시뮬 영어·일본어 페이지에 PRTS 링크가 없네")
    const [tags, rl, session] = await Promise.all([getRecruitTags(), getRecruitLang(locale),
      createOcrSession(file, OCR_LANG[locale] ?? "kor", { paddle: true })]);
    if (opts?.live) {
      // PRTS 링크 — 칩 패스만으로 태그 다섯 개가 다 읽히면 전체 프레임 패스는 건너뛴다. 슬롯을 빨리 넘기면
      // OCR 두 번이 다음 화면을 붙잡아 못 따라왔다 (사용자 지적 2026-10-12). 덜 읽혔을 때만 보조 패스를 더한다
      lines = await session.chips();
      oc = analyzeRecruit(lines, tags, rl);
      if (oc.target.kind !== "goto" || oc.target.goto.page !== "recruit" || oc.target.goto.tags.length < 5) {
        lines = lines.concat(await session.sparse());
        oc = analyzeRecruit(lines, tags, rl);
      }
    } else {
      lines = (await session.chips()).concat(await session.sparse());
      oc = analyzeRecruit(lines, tags, rl);
    }
    // 그래도 다섯 개가 안 되면 칩을 다른 방식(흑백 + 2배)으로 한 번 더 — 브라우저 확대가 '가드'를 '리도'로 뭉갠 실측
    // (틀렸어요 화면 2026-10-12: 이 재독으로 '가드'가 읽혔다)
    const nTags = () => (oc.target.kind === "goto" && oc.target.goto.page === "recruit" ? oc.target.goto.tags.length : 0);
    if (nTags() > 0 && nTags() < 5) {
      lines = lines.concat(await session.chipsAlt());
      oc = analyzeRecruit(lines, tags, rl);
    }
    // 그래도 모자라면 빈 글자로 돌아온 칩만 하나씩 다시 (PaddleOCR 경로 — chipsAlt 는 그땐 건너뛴다. 틀렸어요 966a22eb '신입')
    if (nTags() > 0 && nTags() < 5) {
      lines = lines.concat(await session.chipsRetry());
      oc = analyzeRecruit(lines, tags, rl);
    }
    // 공채 화면 모양이 아니면 버린다 — 다른 화면의 '로봇'·'가드' 같은 글자가 태그로 잡혔다 (match.ts recruitLayoutOk)
    if (nTags() > 0 && !recruitLayoutOk(session.chipBoxes(), tags, rl)) {
      console.debug("[lens] 공채 화면 모양이 아님 — 태그 무시", session.chipBoxes().map((b) => b.text).join(" "));
      oc = { screens: [], entities: [], topics: [], section: null, target: { kind: "none" } };
    }
  } else if (mode === "autochess") {
    // 위수 협의 — 이동이 아니라 **한 판 상태 갱신**이다. 화면이 계속 들어오며 값만 바뀐다 (2026-09-07 재가동).
    // 순서: ① 원색 픽셀로 밴 격자를 먼저 본다 — 밴 화면이면 얼굴로 기물을 확정하고 **OCR 은 건너뛴다**
    // (스크롤 중 프레임이 많이 들어오는데 OCR 1~2초가 프레임을 떨어뜨린다; 모드·전략은 다른 화면에서 읽힌다).
    // ② 그 외 화면은 PSM11 로 문구를 읽어 화면 종류를 가르고, 종류에 맞는 것만 읽는다 (모드 배지·전략·HUD·링).
    const norm = normFor(locale);
    const [ac, color] = await Promise.all([getAcData(locale), decodeColor(file)]);
    const stacks: Record<string, number> = {};
    const bans: { id: string; margin: number }[] = [];
    const banObs: Record<string, number[]> = {};
    const banSeen: Record<string, number> = {};
    let screen: AcScreen | "ban" | null = null;
    let fresh = false, seats = 0;
    let modeCode: string | null = null, deployLeft: number | null = null, hp: number | null = null;
    const bands: { seat: number; band: string; final: boolean }[] = [];
    let rowsRead = false;              // 상대 자리를 참가자 줄에서 통째로 다시 읽었나 (저장소가 갈아 끼운다)
    const pieces: { id: string; kind: "chess" | "equip" }[] = [];
    lines = [];

    // ① 밴 격자 — 카드 우상단 빨간 금지 표식으로 잡는다 (acvision). 잘린 행(cut)은 티어가 없으니 건너뛴다.
    //    ⚠ 표식만 보면 전투 화면의 붉은 UI가 카드로 잡힌다 (실측 밴 구간 밖 22프레임 — 사용자 신고
    //      2026-09-07 "밴 화면에서만 인식되게 해 줘야지"). 그래서 게이트가 두 겹이다:
    //        ② 행 위생 — col 0 부터 연속·2장 이상·red 고름 (acBanRows, 공짜·오탐 행 49→0·잃는 행 0)
    //        ③ 맹약 아이콘 — 행 왼쪽 아이콘이 23종 중 하나로 붙어야 밴 행 (acbond, 행당 ≈50ms)
    //      둘 다 단독으로 오탐 0 이고, ③은 ②를 통과한 행에만 도므로 다른 화면에서는 비용이 0 이다.
    //    ⚠ 버튼 위치 서명(isAcBanScreen)은 **조건으로 쓰지 않는다** — 셋 중 유일하게 창 비율에 의존해서,
    //      녹화와 다른 창으로 캡처하면 밴이 통째로 죽는다 (2026-09-07 오후 "밴리스트가 전~혀 안나온다").
    //      진단 로그와, 아이콘 템플릿을 못 받았을 때의 폴백으로만 남긴다.
    const grid = color ? findAcRows(color.px, color.W, color.H) : null;
    const clean = grid ? acBanRows(grid) : [];
    // ③ 맹약 아이콘 — 게이트이면서 동시에 **행의 맹약 라벨**이다 (실측 95/95 정답, 오탐 0).
    //    라벨을 직접 얻으므로 얼굴로 푼 기물들의 공통 맹약을 역산하지 않는다 — 한 장짜리 행도 맹약이 정해진다.
    const banRows: { row: (typeof clean)[number]["row"]; bond: string; complete: boolean }[] = [];
    if (clean.length && color && grid) {
      let bondTpl: Map<string, Float32Array> | null = null;
      try {
        bondTpl = await loadBondTemplates(ac.bondIds);
      } catch (e) {
        // 아이콘을 못 받으면(오프라인·R2 404·CORS) ③을 못 돈다. 밴 인식을 통째로 끄는 대신
        // 버튼 서명으로 물러난다 — 정확도는 떨어지지만 기능이 살아 있고, 원인이 로그에 남는다.
        console.warn(`[lens] 맹약 아이콘 템플릿 실패 — 버튼 서명으로 폴백: ${e instanceof Error ? e.message : String(e)}`);
        if (isAcBanScreen(grid)) for (const { row, complete } of clean) banRows.push({ row, bond: "", complete });
      }
      if (bondTpl) for (const { row, complete } of clean) {
        const hit = matchBondIcon(color.px, color.W, color.H, row.icon, bondTpl);
        const bond = bondOfHit(hit);
        if (bond) banRows.push({ row, bond, complete });
        else console.debug(`[lens] 밴 행 아님 — 맹약 아이콘 미승인 (${hit ? `${hit.band} ${hit.score.toFixed(2)}/${hit.margin.toFixed(2)}` : "평탄"})`);
      }
    }
    // 게이트가 왜 닫혔는지 한 줄로 — 캡처 환경이 녹화와 다를 때 이 줄만 보고 원인을 가린다
    if (grid && grid.rows.length) {
      const b = grid.button;
      console.debug(`[lens] 밴 격자: 행 ${grid.rows.length}(못 읽음 ${grid.rows.filter((r) => !r.readable).length}) → 위생 통과 ${clean.length}(완전 ${clean.filter((r) => r.complete).length}) → 맹약 확정 ${banRows.length}`
        + ` | c=${(grid.cardPx / (color?.W ?? 1)).toFixed(4)}W 첫열=${grid.cols[0]?.toFixed(3) ?? "-"} 버튼=${b ? `x${b.x.toFixed(3)} w${b.w.toFixed(3)}${isAcBanScreen(grid) ? " ✓" : " ✗"}` : "없음"}`);
    }
    if (banRows.length && color) {
      screen = "ban";
      // 얼굴 템플릿은 **행의 (맹약, 티어) 후보만** 받는다 (사용자 지시 2026-09-07). 조합당 1~4명이라
      // 티어 전체(≈20명)를 받던 것보다 훨씬 적다 — 예열이 아직 도는 중에도 곧바로 시작할 수 있다.
      // 맹약을 모르는 폴백 행(bond="")만 예전처럼 그 티어 전체를 받는다.
      const ops = new Set<string>();
      for (const { row, bond } of banRows) {
        const tiers = new Set(row.cards.map((c) => c.tier as number));
        for (const p of ac.pieces) {
          if (!tiers.has(p.t)) continue;
          if (bond && !p.bonds.includes(bond)) continue;
          ops.add(p.op);
        }
      }
      const tpl = await loadFaceTemplates([...ops]);
      console.debug(`[lens] 밴 얼굴 후보 ${ops.size}명 (${banRows.map((r) => r.bond || "?").join(",")})`);
      for (const { row, bond, complete } of banRows) {
        const cards = row.cards.map((c) => ({
          tier: c.tier as number,
          feat: cardFeature(color.px, color.W, color.H, { x: c.x * color.W, y: c.y * color.H, w: c.w * color.W, h: c.h * color.H }),
        }));
        // bond 가 빈 문자열이면 아이콘 폴백 경로다 — 맹약을 모르니 예전처럼 역산에 맡긴다
        const solved = solveBanRow(cards, ac.pieces, tpl, bond || null);
        // 얼굴로 확정한 기물은 **행이 완전하지 않아도** 사실이다 — 카드 단위 관측이니까
        for (const p of solved.picks) if (p.id) bans.push({ id: p.id, margin: p.margin });
        const key = bond || solved.bond;
        if (key) {
          // 본 줄과 그 줄에서 본 카드 수 — 밴 리스트를 맹약별로 묶는 UI 의 근거 (autochess.tsx banGroups).
          // 행이 불완전해도 남긴다: 그래야 "이 줄을 봤다" 는 사실이 화면에서 안 사라진다.
          banSeen[key] = cards.length;
          // (맹약, 티어) **완전한** 관측만 조합 풀이에 넘긴다 — 못 본 카드가 있는 행을 완전하다고 넘기면
          // acsolve 가 없는 카드를 있다고 믿어 엉뚱한 조합을 낸다 (얼굴이 못 가른 자리를 보태는 게 그쪽 몫이다)
          if (complete) banObs[key] = cards.map((c) => c.tier).sort((p, q) => q - p);
        }
        console.debug(`[lens] 밴 행 ${key || "?"}${complete ? "" : " (불완전 — 오른쪽·아래에 못 본 카드가 있을 수 있다)"}: ${solved.picks.map((p) => `${p.op || "?"}(${p.margin.toFixed(2)})`).join(" ")}`);
      }
    } else {
      // ② 문구 — 화면 종류를 가르고 종류에 맞는 것만 읽는다
      const session = await createOcrSession(file, OCR_LANG[locale] ?? "kor");
      lines = await session.sparse();
      const linesN = lines.map(norm);
      const boxes = session.boxes();
      screen = classifyAcScreen(linesN, lines, boxes);
      fresh = screen === "info" || isAcInfoScreen(linesN);
      // OCR 을 게이트로 쓰진 않지만(803ms·CN 클라에 문구가 없다) **이미 돌았으면 확증으로는 쓴다** — 공짜다.
      // 정보 화면인데 버튼 서명이 거짓이면 위 ①이 미검증 상태('준비 완료'를 누른 뒤·연합 다인 화면·초광각)에
      // 걸린 것이다. 실사용에서 이 줄이 뜨면 서명을 고쳐야 한다는 신호다.
      if (screen === "info" && grid && !isAcBanScreen(grid)) {
        const b = grid.button;
        console.debug(`[lens] ⚠ 정보 화면인데 '준비 완료' 서명 거짓 — ${b ? `버튼 x=${b.x.toFixed(3)} w=${b.w.toFixed(3)}` : "버튼 없음"} (밴 인식이 꺼진다)`);
      }
      // 시뮬레이션 종류 — 로딩 화면은 큰 글씨 그대로(11/11), 정보·전략 화면은 좌상단 붉은 배지를
      // 채널최댓값 크롭으로(51/51). ⚠ 정보·전략 화면의 PSM11 줄에 parseAcMode 를 쓰면 잠긴 전략의
      // 개방 조건('[표준 시뮬레이션]에서 …')이 AC-1 로 오판된다 — 배지 크롭 결과에만 쓴다.
      if (screen === "loading") modeCode = parseAcMode(linesN);
      else if (screen === "info" || screen === "band" || screen === "confirm") {
        const r = badgeRectFromTitle(boxes);
        if (r) modeCode = parseAcMode((await session.maxCrop(r)).map(norm));
      }
      if (modeCode) console.debug(`[lens] 시뮬레이션 종류: ${modeCode} (${screen})`);
      // 전략 — 우측 패널 대표 오퍼 이름. '선택한 전략' 화면이면 확정, 아니면 미리보기
      if (screen === "band" || screen === "confirm") {
        const pick = parseAcBand(lines, ac.bands, norm);
        if (pick) bands.push({ seat: 0, band: pick.band, final: pick.final });
        seats = parseSeats(lines);
        // 참가자 줄 — 연합에서 **다른 참가자**의 전략 (사용자 요청 2026-09-07 "다른사람 전략도 다 띄워줘야함").
        // 줄은 오른쪽 체크박스로 찾고(acband.participantRows — 전략을 고른 줄에만 켜진다) 썸네일을 전략
        // 아이콘과 그림으로 맞춘다. **기하는 후보만 내고 판정은 이 매칭이 한다** — 화면 어딘가의 청록
        // 정사각이 없는 줄을 만들어 내지 못하게. 실측: 진짜 줄 0.78~0.87 vs 헛자리 0.29~0.41.
        // ⚠ 'confirm'(내가 확정한 뒤) 뿐 아니라 'band'(내가 아직 고르는 중)에도 읽는다 — 참가자 목록은
        //   그때도 왼쪽에 떠 있고, **먼저 고른 사람의 체크박스는 이미 켜져 있다**. 확정 화면에서만 읽으면
        //   남의 전략이 내가 고를 때까지 안 보인다. 격자가 떠 있는 화면(11.png)에서 오탐 0 확인.
        if (color && (screen === "confirm" || screen === "band")) {
          try {
            const rows = participantRows(color.px, color.W, color.H);
            if (rows.length) {
              const tpl = await loadBandTemplates(ac.bands.map((b) => b.id));
              const read: { mine: boolean; band: string }[] = [];
              for (const r of rows) {
                const hit = searchBand(color.px, color.W, color.H, r.thumb, tpl);
                if (!hit || hit.score < BAND_ACCEPT.score || hit.margin < BAND_ACCEPT.margin) continue;
                read.push({ mine: r.mine, band: hit.band });
              }
              // 내 줄 — 카드 좌상단 '나' 표식이 정답이다. 표식을 못 봤을 때만 우측 패널이 읽은 전략과 대조한다
              // (패널은 **돋보기로 남의 전략을 열면 그 사람 것을 보여주므로** 그 자체로는 내 것의 근거가 못 된다).
              let mineAt = read.findIndex((x) => x.mine);
              if (mineAt < 0 && pick) mineAt = read.findIndex((x) => x.band === pick.band);
              let seat = 1;
              read.forEach((x, i) => { if (i !== mineAt) bands.push({ seat: seat++, band: x.band, final: true }); });
              // 내 줄의 썸네일이 우측 패널보다 낫다 — 뒤에 넣어 같은 자리를 덮는다
              if (mineAt >= 0) bands.push({ seat: 0, band: read[mineAt].band, final: true });
              else if (read.length) console.debug("[lens] ⚠ '나' 줄을 못 가렸다 — 참가자 칩이 하나 더 보일 수 있다");
              // ⚠ 줄이 하나면 참가자 수를 **주장하지 않는다** — 독립인지, 연합인데 아직 한 명만 골랐는지
              //   구별할 수 없다. 1 이라고 적으면 그 순간 런바가 '독립'으로 뒤집힌다.
              if (read.length > 1) seats = Math.max(seats, read.length + (mineAt < 0 ? 1 : 0));
              rowsRead = true;
              console.debug(`[lens] 참가자 줄 ${rows.length}개(승인 ${read.length}) → 나 ${mineAt < 0 ? "?" : read[mineAt].band} · 상대 ${bands.filter((b) => b.seat > 0).map((b) => b.band).join(",") || "없음"}`);
            }
          } catch (e) { console.warn("[lens] 참가자 줄 인식 실패 — 내 전략은 살린다", e); }
        }
        if (pick) console.debug(`[lens] 전략: ${pick.band} ${pick.final ? "확정" : "고르는 중"}`);
      }
      // 인게임 — 남은 배치 칸·목표 HP·맹약 링·상점/툴팁 이름. 다이얼로그가 덮인 전환 프레임은 종류가 null 로
      // 나오므로 링만 시도한다 (링이 없으면 아무 일도 없다 — 정보·전략 화면 오탐 0 실측).
      if (screen === "rest" || screen === "battle" || screen === null) {
        deployLeft = parseDeployLeft(lines);
        const hud = parseAcHud(boxes);
        hp = hud.hp;
        if (color) {
          const rings = findAcRings(color.px, color.W, color.H);
          for (const ring of rings) {
            // 링 아래 이름 → 맹약 (그레이 반전 크롭 34/35) · 링 안 숫자 → 중첩 (0 은 O/()/C 로 읽혀 매핑, 1 이상은 미검증)
            const names = await session.cropInverted(ringNameRect(ring));
            let id: string | null = null;
            for (const tx of names) { id = bondOfLine(norm(tx).replace(/[0-9]/g, ""), ac.idx); if (id) break; }
            if (!id) continue;
            const { text } = await session.digits(ringNumRect(ring), RING_DIGITS);
            const n = parseRingStack(text);
            if (n !== null) stacks[id] = n;
            console.debug(`[lens] 맹약 링 ${id}: "${text}" → ${n ?? "버림"}`);
          }
        }
        if (screen === "rest") {
          for (const l of lines) {
            const m = matchPieceName(l, ac.pieceIdx, norm);
            if (m && !pieces.some((x) => x.id === m.id)) pieces.push(m);
          }
        }
        if (deployLeft !== null) console.debug(`[lens] 남은 배치: ${deployLeft}${deployLeft >= 9 ? " (인사부 파일)" : ""}`);
      }
    }
    oc = {
      screens: [], entities: [], topics: [], section: screen,
      target: { kind: "acrun", screen, stacks, fresh, deployLeft, seats, mode: modeCode, bands, bandRows: rowsRead, bans, banObs, banSeen, hp, pieces },
      battle: screen === "battle",
    };
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
    // 화면 전체 읽기를 PaddleOCR 로 — 한국어는 kor 모델, 영어·일본어는 ch 모델(중·일·영) (2026-10-13, app/lens/paddle.ts). 못 쓰면 tesseract
    const [index, session] = await Promise.all([getRogueIndex(locale, opts?.cnTopic), createOcrSession(file, OCR_LANG[locale] ?? "kor", { paddleFull: true })]);
    // 난이도 배지 — 전용 eng 워커라 본 패스와 **병렬**로 미리 돌린다 (직렬 ~0.3초 제거).
    // 라이브(게임 연결)는 세션 캐시가 유효하거나 미검출 쿨다운 중이면 아예 생략한다.
    const gradeFresh = !!gradeCache && Date.now() - gradeCache.at < 10 * 60_000;
    // 한국어는 PaddleOCR 화면 전체 읽기의 왼쪽 아래 숫자로 난이도를 정하므로 tesseract 숫자 판독을 아예 돌리지 않는다 (2026-10-13 —
    // 결과를 안 쓰는데도 돌아 영어 숫자 모델을 받고 CPU 를 썼다). PaddleOCR 이 실패해 tesseract 로 물러난 화면은 난이도를 건너뛴다
    // 2026-10-13~ 영어·일본어도 PaddleOCR(ch 모델)로 읽으므로 같은 규칙
    const skipGradeOcr = ["kor", "eng", "jpn"].includes(OCR_LANG[locale] ?? "kor") || (!!opts?.live && (gradeFresh || Date.now() - gradeMissAt < 10_000));
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
    // ── 위쪽 HUD 의 층 이름 · 왼쪽 아래 난이도 배지 (2026-10-13, PaddleOCR 로 바꾼 뒤) — PaddleOCR 은 화면 위 가운데 HUD 의
    // 'Ⅰ 영혼 융합의 시작' 을 매번 또렷하게 읽어서, 그 구역(층)이 노드(작전·조우) 판정을 덮었다(지도 화면 거의 전부가 '1층'으로).
    // 그 줄은 판정에서 빼고 **층 정보로만** 쓴다. 난이도는 고정 자리 잘라 읽기가 창 제목 표시줄만큼 밀리면 놓쳐서,
    // 화면 전체 읽기에 이미 잡힌 왼쪽 아래 구석 숫자를 쓴다. 좌표는 0~1 정규화 (session.boxes)
    let hudGrade: number | null = null;
    let comboScreen = false;
    let rogueScreen: "map" | "runStart" | "squadSelect" | "lobby" | undefined;
    {
      const bx = session.boxes();
      const topN = bx.filter((b) => b.y1 < 0.2).map((b) => normText(b.text));
      // 모집 조합 선택(쉐이 초기 모집 전 단계) — 카드 이름 '차근차근'이 작전 '차근차근 유도'로, 잘린 '디펜더, 캐…'가 소장품 '디펜더-2'로 잡혔다
      // (틀렸어요 2026-10-13). 이 화면엔 알아볼 항목이 없어 판정을 통째로 비운다 — 판 시작 화면이라 분대·난이도는 초기 모집처럼 다룬다
      if (topN.some((x) => x.includes("모집조합선택"))) { rogueScreen = "runStart"; comboScreen = true; }
      else if (topN.some((x) => x.includes("초기모집"))) rogueScreen = "runStart";
      else if (topN.some((x) => x.includes("분대선택"))) rogueScreen = "squadSelect";
      // 탐험 로비(테마 첫 화면 — 계속 탐험·탐험 시작·심층 탐험·방문객 명단·정기 작전) — 판 밖이라 알아볼 게 없다.
      // 판정을 통째로 비우고 '탐험을 시작하면 인식됩니다' 안내를 띄운다 (틀렸어요 2026-10-14 "아예 인식이 안 돼요" — 로비 화면이었다)
      else {
        const all = bx.map((b) => normText(b.text)).join("|");
        const LOBBY = ["계속탐험", "탐험시작", "탐험포기", "심층탐험", "방문객명단", "정기작전", "안내책자"];
        if (LOBBY.filter((k) => all.includes(k)).length >= 2) { rogueScreen = "lobby"; comboScreen = true; }
      }
      const zoneEntries = index.entries.filter((e) => e.section === "zone" && (!topic || e.topic === topic));
      const drop = new Set<string>();
      for (const b of bx) {
        if (b.y1 > 0.14) continue;
        const rest = normText(b.text.replace(/^[\sIⅠⅡⅢⅣⅤⅥⅦⅧlㅣ|1-9]+/, ""));
        if (rest.length < 3) continue;
        const z = zoneEntries.find((e) => e.nameN === rest || (rest.length >= 4 && e.nameN.length >= 4
          && (rest.includes(e.nameN) || e.nameN.includes(rest)) && Math.min(rest.length, e.nameN.length) / Math.max(rest.length, e.nameN.length) >= 0.8));
        if (!z) continue;
        drop.add(b.text);
        // 쉐이의 잔식(zone_sky_N, 구역 번호 90·91)은 층이 아니다 — '90층' 대신 '쉐이의 잔식 - 시비경' (사용자 지시 2026-10-13)
        if (opts?.live) setBridgePipFloor(/^zone_sky_/.test(z.id) ? { floor: 0, place: z.name, name: z.name }
          : { floor: Number(z.id.replace(/\D/g, "")) || undefined, place: "", name: z.name });
      }
      // 층 이름이 글자 조각으로 쪼개져 읽힌 프레임 — '산수각'이 '산수'·'각' 두 상자로 와서 지도 화면 판별이 안 됐고, 그 바람에 지도 이름표
      // '무차별 교육'이 작전으로 잡혔다 (틀렸어요 2026-10-13). 위쪽 띠의 상자를 왼→오로 이어 붙여 층 이름을 다시 찾는다
      if (!drop.size) {
        const top = bx.filter((b) => b.y1 <= 0.14).sort((a, b) => a.x0 - b.x0);
        const joined = top.map((b) => normText(b.text)).join("");
        const z = zoneEntries.find((e) => e.nameN.length >= 3 && joined.includes(e.nameN));
        if (z) {
          for (const b of top) { const n = normText(b.text); if (n && z.nameN.includes(n)) drop.add(b.text); }
          if (opts?.live) setBridgePipFloor(/^zone_sky_/.test(z.id) ? { floor: 0, place: z.name, name: z.name }
            : { floor: Number(z.id.replace(/\D/g, "")) || undefined, place: "", name: z.name });
        }
      }
      // 그래도 못 찾았고 판 안 HUD(목표 HP·지휘 레벨)가 보이면 — 위 가운데 띠만 잘라 다시 읽는다. 전체 화면 읽기는 줄인 그림에서
      // 글자를 찾아 가는 층 이름을 놓쳤다 (틀렸어요 2026-10-15 '안개의 기로'·'고향의 잔해' 두 건 — 노드 이름표는 다 읽고 층 이름만 빠졌다)
      if (!drop.size && !rogueScreen) {
        const allN = bx.map((b) => normText(b.text));
        if (allN.some((x) => x.toLowerCase().includes("목표hp") || x.includes("지휘레벨"))) {
          const band = (await session.topBand()).map((t) => normText(t.replace(/^[\sIⅠⅡⅢⅣⅤⅥⅦⅧlㅣ|1-9]+/, "")));
          const joined = band.join("");
          const z = zoneEntries.find((e) => e.nameN.length >= 3 && (band.includes(e.nameN) || joined.includes(e.nameN)));
          if (z) {
            drop.add(`\u0000band:${z.id}`);   // 표식만 — 이 줄은 lines 에 없다
            if (opts?.live) setBridgePipFloor(/^zone_sky_/.test(z.id) ? { floor: 0, place: z.name, name: z.name }
              : { floor: Number(z.id.replace(/\D/g, "")) || undefined, place: "", name: z.name });
          }
          console.debug(`[lens] 층 이름 다시 읽기: ${band.join(" | ") || "없음"} → ${z?.name ?? "못 찾음"}`);
        }
      }
      // ⚠ 위쪽 HUD 에 층 이름이 보이는 화면(지도·노드)에서만 — 난이도 배지는 그 화면에만 있다. 분대·오퍼 선택 화면 왼쪽 아래의
      //   다른 숫자('1')를 난이도로 읽어 난이도 1 로 고정됐다 (사용자 제보 2026-10-13)
      if (drop.size && !rogueScreen) rogueScreen = "map";
      if (rogueScreen === "squadSelect") runGrade = null;
      if (drop.size || rogueScreen === "runStart") {
        // 배지 숫자가 '1'·'2' 두 상자로 쪼개져 오기도 해서 같은 줄의 숫자 상자는 왼→오로 이어 붙인다
        const digs = bx.filter((b) => b.x1 < 0.12 && b.y0 > 0.82 && /^\d{1,2}$/.test(b.text.trim())).sort((a, b) => a.x0 - b.x0);
        let txt = "";
        for (const b of digs) { if (txt && b.x0 - digs[digs.indexOf(b) - 1].x1 > 0.02) txt = ""; txt += b.text.trim(); }
        const g = Number(txt.slice(-2));
        if (txt && g <= 18) hudGrade = g;
        // 화면 전체 읽기의 검출은 작은 빨간 육각형 숫자를 자주 놓치고('12' → 없음·'2'), 배지만 잘라 키워 읽으면 맞게 나온다 —
        // 배지 판독을 우선한다. 판 난이도가 두 자리로 정해진 뒤에는 건너뛴다 (2026-10-13)
        if (!(runGrade !== null && runGrade >= 10)) { const bg = await session.gradeBadge(); if (bg !== null) hudGrade = bg; }
      }
      // 판 시작 화면의 배지를 판 난이도로 — 단 이미 두 자리(12)로 잡혔는데 끝자리만('2') 읽힌 건 무시한다
      const tailOf = (big: number, small: number) => big >= 10 && small < 10 && String(big).endsWith(String(small));
      if (rogueScreen === "runStart" && hudGrade !== null && !(runGrade !== null && tailOf(runGrade, hudGrade))) runGrade = hudGrade;
      // 거꾸로 판 난이도가 끝자리만 잡혔는데('2') 지도에서 두 자리('12')가 읽히면 두 자리로 바로잡는다 (사용자 제보 2026-10-13 "난이도 12인데 2")
      if (runGrade !== null && hudGrade !== null && tailOf(hudGrade, runGrade)) runGrade = hudGrade;
      if (runGrade !== null) hudGrade = runGrade;   // 판 안에서는 고정값 — 지도에서 다른 숫자를 읽어도 흔들리지 않게
      if (opts?.live && hudGrade !== null) setBridgePipFloor({ grade: hudGrade });
      // 지도 화면에 **늘 떠 있는** HUD 표 글자 — 줄 전체가 이것뿐이면 판정에서 뺀다. PaddleOCR 은 이것들을 매번 읽어서
      // '부하 오퍼레이터'가 효과 문구 '부하 오퍼레이터의 공격력 -30%'의 '미완의 마왕 이야기'로 지도 화면마다 잡혔다 (2026-10-13 모은 화면)
      // 직군 이름만 있는 줄도 뺀다 — 초기 모집의 '스페셜리스트'가 역포함으로 '논단: 스페셜리스트'(소장품)로 잡혔다 (틀렸어요 2026-10-13)
      // '주화상자' — 쉐이 아래 단추. '균형-주화 상자'(주화 항목)로 오퍼 모집 화면마다 잡혔다 (틀렸어요 2026-10-13)
      const HUD_LABELS = new Set(["목표HP", "지휘레벨", "부하오퍼레이터", "생각의부하", "소장품", "오퍼레이터", "편성", "생각", "명일방주", "주화상자",
        "뱅가드", "가드", "디펜더", "스나이퍼", "캐스터", "메딕", "서포터", "스페셜리스트"]);
      lines = lines.filter((l) => !drop.has(l) && !HUD_LABELS.has(normText(l)));
      rogueScreenOut = rogueScreen;
    }
    // 기타 노드 — 지도에서 노드를 누르면 오른쪽에 노드 이름과 설명 글이 뜬다. **이름 줄과 설명 줄이 같이** 보일 때만 그 노드로
    // (지도 위 노드 아이콘 밑에도 이름표가 붙어 있어서 이름만으로는 안 된다). 설명 줄은 판정에서 뺀다 — '교활한 상인'이 들어간
    // 소장품 효과문으로 새지 않게 (사용자 지시 2026-10-13 "교활한 상인·앞서 출발 같은 기타 노드도 인식")
    {
      const ns = lines.map((l) => normText(l));
      const near = (n: string, d: string) => {
        if (d.includes(n)) return true;
        if (n.length < 8) return false;
        const bg = new Set<string>(); for (let i = 0; i + 1 < d.length; i++) bg.add(d.slice(i, i + 2));
        let hit = 0; for (let i = 0; i + 1 < n.length; i++) if (bg.has(n.slice(i, i + 2))) hit++;
        return hit / (n.length - 1) >= 0.8;   // 받침 한두 개 틀린 줄까지
      };
      for (const c of (index.nodes ?? []).filter((x) => !topic || x.topic === topic)) {
        const iName = ns.findIndex((n) => n === c.nameN);
        if (iName < 0) continue;
        let descIdx = ns.flatMap((n, i) => (i !== iName && n.length >= 6 && near(n, c.descN) ? [i] : []));
        if (descIdx.reduce((a, i) => a + ns[i].length, 0) < 10) {
          // 설명 글을 못 읽은 프레임 — 패널 제목 바로 밑의 'INFO.' 표식(OCR 은 'ENFD.'·'EINFD.' 로 읽는다)이 붙어 있으면 고른 노드다
          // (틀렸어요 2026-10-13 '득과 실': 작은 설명 글이 통째로 안 읽혔다)
          const INFO = /^e?[il1]?nf[od0]$/i;   // 대소문자 무시 — PaddleOCR 은 'INFO'·'ENFD' 대문자로 읽는다(종전 소문자만 받아 걸리지 않았다, 2026-10-15)
          let k = ns.findIndex((n, i) => n === c.nameN && (INFO.test(ns[i + 1] ?? "") || INFO.test(ns[i + 2] ?? "")));
          // 읽힌 순서가 'INFO' 가 이름보다 앞일 때도 있다 (틀렸어요 2026-10-15 '우연한 만남') — 자리로 본다: 오른쪽 위 설명 창의 제목
          // (화면 오른쪽 절반·위 40%) 바로 밑(세로 12% 안, 가로로 붙어)에 INFO 상자가 있으면 고른 노드다. 지도 이름표는 그 자리에 INFO 가 없다
          if (k < 0) {
            const bxs = session.boxes();
            const title = bxs.find((b) => normText(b.text) === c.nameN && b.x0 > 0.5 && b.y0 < 0.4
              && bxs.some((o) => INFO.test(normText(o.text)) && o.y0 >= b.y0 && o.y0 - b.y1 < 0.12 && Math.abs(o.x0 - b.x0) < 0.12));
            if (title) k = ns.findIndex((n) => n === c.nameN);
          }
          if (k < 0) continue;
          descIdx = [k];
        }
        rogueNodeOut = c.id;
        const drop = new Set([iName, ...descIdx]);
        lines = lines.filter((_, i) => !drop.has(i));
        break;
      }
    }
    // 한 글자만 틀린 이름 바로잡기 — 줄 전체가 그 테마 항목 이름(4~12자)과 길이가 같고 한 글자만 다르며, 그런 항목이 **하나뿐**이면
    // 그 이름으로 (2026-10-13 상점의 '먹다만사랑' → 먹다 만 사탕. PaddleOCR 이 작은 글씨에서 받침 하나를 틀린다)
    {
      const names = index.entries.filter((e) => (!topic || e.topic === topic) && e.nameN.length >= 4 && e.nameN.length <= 12);
      const byLen = new Map<number, typeof names>();
      for (const e of names) { const a = byLen.get(e.nameN.length) ?? []; a.push(e); byLen.set(e.nameN.length, a); }
      const exact = new Set(names.map((e) => e.nameN));
      lines = lines.map((l) => {
        const n = normText(l);
        if (n.length < 4 || n.length > 12 || exact.has(n)) return l;
        const near = (byLen.get(n.length) ?? []).filter((e) => { let d = 0; for (let i = 0; i < n.length && d < 2; i++) if (e.nameN[i] !== n[i]) d++; return d === 1; });
        const uniq = [...new Set(near.map((e) => e.name))];
        return uniq.length === 1 ? uniq[0] : l;
      });
    }
    let chipsRan = false;
    if (wantsChipPass(lines)) { chipsRan = true; lines = lines.concat(await session.chips()); }
    const ctx = { context: { topic, lock: opts?.lock }, norm };
    oc = analyzeLines(lines, index, ctx);
    // 중국어(CN 클라) 분기 — chi_sim으로 cn 이름을 매칭한다. 이미지가 고정이라 zh 패스는
    // 결정적 → 한 번만 돌리고 캐시(zhRan). 예전엔 "cn 화면은 무조건 블랙플로우"였지만,
    // 중섭 탭을 켠 테마도 이제 여기서 잡힌다 (2026-08-13 — 아래 zhPossible 참조).
    let zhRan = false, zhHit = false;
    const tryZh = async () => {
      if (zhRan) return;
      zhRan = true;
      const zlines = await session.zh();
      // 문맥(테마·잠금)을 한국어 패스와 똑같이 넘긴다 — 시리즈 공통 유물의 중국어 이름이
      // IS5·IS6에 154개 겹쳐서, 문맥 없이는 중섭 IS5 화면이 블랙플로우로 샌다 (2026-08-13).
      const zoc = analyzeChinese(zlines, index, { topic, lock: opts?.lock });
      console.debug(`[lens] 중국어 패스: OCR ${zlines.length}줄 → ${zoc.target.kind}/${zoc.section ?? "-"}`);
      if (zoc.target.kind !== "none") { oc = zoc; zhHit = true; lines = zlines; }
    };
    // 1차 게이트 — KR(kor)은 중국어에서 무신호라 완전 무신호일 때만. EN/JA는 프라이머리(특히
    // jpn)가 한자를 kanji로 읽어 약한 표·tie를 낼 수 있어(cn 화면), 확신 goto가 아니면 시도한다.
    // 테마 고정 시에는 그 테마가 중국어일 수 있을 때만 zh 패스를 돈다 — 블랙플로우(CN 선행)
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
    // ── 색 글씨 밴드 패스 (제보 16138722, 2026-09-05) ────────────────────────────
    // 조우 선택지가 주는 소장품은 **판마다 랜덤**이라 우리 데이터엔 "소장품 1개 획득"으로만
    // 적혀 있다 — 이름은 화면에서 읽어야 안다. 그런데 그 이름만 **분홍 글씨**라 휘도
    // 그레이스케일에서 묻힌다 (실측: 윗줄 `获得1件收藏品`은 읽고 `·显圣吊坠`는 0줄).
    // 그래서 그 줄 **바로 아래**만 채널최댓값 전처리로 한 번 더 읽는다.
    // ⚠ 목표(target)는 건드리지 않는다 — **엔티티만** 보탠다. 조우 모달은 그대로 열리고,
    //   화면(rogue.tsx)이 그 소장품을 모아보기로 곁들인다. 섹션 투표를 다시 하면 조우가
    //   소장품으로 뒤집혀 정작 조우 정보를 잃는다.
    // ⚠ **이미 아이템을 잡았으면 돌지 않는다** — 소장품 화면은 본 패스가 이미 처리한다.
    //
    // ⚠ 언어는 zhHit 이 아니라 **트리거 줄 자체**로 판정한다 (제보 8368a46c, 2026-09-06).
    //   zhHit 은 "한국어 패스가 완전 무신호여서 zh 를 돌렸고 그게 맞았다"일 때만 선다.
    //   그런데 CN 클라 화면에서 kor 워커가 한자를 흘리다 **약한 오탐 하나**만 내도
    //   위 1차 게이트(297줄)가 막혀 zh 패스가 영영 안 돌고, 그 상태로 여기 내려오면
    //   중국어 이름을 **kor 워커로** 읽어(ocr.ts: zh 가 거짓이면 프라이머리 워커) 통째로
    //   놓쳤다. 제보자가 "될 때도 있고 안 될 때도 있다"고 한 것이 이것 — 소장품이 아니라
    //   **한국어 패스가 그 화면에서 헛것을 봤느냐**가 갈랐다.
    //   `收藏品`이 보이는 화면은 그냥 중국어이므로, 그걸 근거로 삼는다.
    const bandZh = zhHit || lines.some(isCollectLineCn);
    // 확실한 중국어인데 zh 패스를 아직 안 돌렸으면 지금 돌린다 — 본 판정(조우 모달)도
    // 중국어로 다시 보는 게 맞다. 이미 돌렸으면 zhRan 가드가 막는다.
    if (zhPossible && bandZh) await tryZh();
    const hasItem = oc.entities.some((e) => LENS_ITEM_SECTIONS.has(e.section));
    if (!hasItem && oc.target.kind !== "none" && lines.some(isCollectLine)) {
      const cLines = await session.colorBand(isCollectLine, bandZh);
      if (cLines.length) {
        const cOc = bandZh
          ? analyzeChinese(cLines, index, { topic, lock: opts?.lock })
          : analyzeLines(cLines, index, ctx);
        const add = cOc.entities.filter((e) => LENS_ITEM_SECTIONS.has(e.section)
          && !oc.entities.some((x) => x.id === e.id));
        console.debug(`[lens] 색 글씨 밴드: ${cLines.length}줄 → 소장품 ${add.length}개`, cLines);
        if (add.length) { oc.entities = [...oc.entities, ...add]; lines = lines.concat(cLines); }
      }
    }
    // 지도 화면의 작전 — 지도 아이콘 밑에 작전 이름표가 늘 붙어 있어서, 작전 노드가 하나뿐이면 다른 노드를 골라도 그 작전으로
    // 고정됐다 (틀렸어요 2026-10-13 "작전 노드가 셋 중 하나밖에 없으면 고정"). 작전을 **골랐을 때만** 오른쪽 패널에 작전 설명 글이
    // 뜨므로, 지도 화면에서는 설명 글이 읽힌 작전만 노드로 친다. 셋이 다 이름표로 보여도 고른 하나로 정해진다
    if (rogueScreenOut === "map") {
      const ns = lines.map((l) => normText(l));
      const descHit = (d: string) => ns.reduce((a, n) => {
        if (n.length < 6) return a;
        if (d.includes(n)) return a + n.length;
        if (n.length < 8) return a;
        let hit = 0; for (let i = 0; i + 1 < n.length; i++) if (d.includes(n.slice(i, i + 2))) hit++;
        return hit / (n.length - 1) >= 0.8 ? a + n.length : a;
      }, 0);
      let best: { id: string; v: number } | null = null;
      for (const e of index.entries) {
        if (e.section !== "stage" || (topic && e.topic !== topic) || e.bodyN.length < 10) continue;
        if (!ns.some((n) => n === e.nameN || (n.length >= 3 && n.includes(e.nameN) && e.nameN.length >= 3))) continue;
        const v = descHit(e.bodyN);
        if (v >= 10 && (!best || v > best.v)) best = { id: e.id, v };
      }
      const g = oc.target.kind === "goto" && oc.target.goto.page === "rogue" ? oc.target.goto : null;
      const stageish = !g || g.modal?.type === "stage" || g.modal?.type === "zone" || (g.view === "map" && !g.modal);
      if (best && (oc.target.kind !== "goto" || stageish) && !(g?.modal?.type === "enc")) {
        const tp = topic ?? index.entries.find((e) => e.id === best!.id)?.topic ?? "";
        oc.target = { kind: "goto", goto: { page: "rogue", topic: tp, view: "map", modal: { type: "stage", id: best.id },
          ...(ns.includes("긴급작전") ? { emergency: true } : {}) } };
        oc.section = "stage";
      } else if (!best && g?.modal?.type === "stage") {
        // 이름표만 보이는 지도 — 작전을 고른 게 아니다
        oc.target = { kind: "none" }; oc.section = null;
      }
    }
    // 분대 선택·초기 모집 화면에는 고를 노드가 없다 — 거기서 잡힌 작전·조우는 버린다
    // (틀렸어요 2026-10-13 쉐이 분대 선택 화면에 '차근차근 유도' 작전이 떴다)
    if (comboScreen) { oc.target = { kind: "none" }; oc.section = null; oc.entities = []; }
    if ((rogueScreenOut === "squadSelect" || rogueScreenOut === "runStart")
      && oc.target.kind === "goto" && oc.target.goto.page === "rogue" && (oc.target.goto.modal?.type === "stage" || oc.target.goto.modal?.type === "enc")) {
      oc.target = { kind: "none" }; oc.section = null;
    }
    // 화면 순서 — 모아보기가 점수순(뒤죽박죽)이 아니라 화면에 놓인 순서로 나오게, 아이템마다 이름이 찍힌 줄 상자의
    // 자리를 싣는다 (사용자 지시 2026-10-12 "실제 화면 순서대로"). 상자는 마지막 OCR 패스의 것이라 못 찾은 항목은 뒤로 간다
    {
      const boxes = session.boxes().map((b) => ({ t: norm(b.text), y: b.y0, x: b.x0 }));
      const order: Record<string, [number, number]> = {};
      for (const e of oc.entities) {
        if (!LENS_ITEM_SECTIONS.has(e.section)) continue;
        const n = norm(e.name);
        if (n.length < 2) continue;
        const b = boxes.find((bx) => bx.t.includes(n) || (bx.t.length >= 4 && n.includes(bx.t)));
        if (b) order[e.id] = [b.y, b.x];
      }
      if (Object.keys(order).length) {
        if (oc.target.kind === "goto" && oc.target.goto.page === "rogue") oc.target.goto.order = order;
        else if (oc.target.kind === "tie") for (const o of oc.target.options) { if (o.goto.page === "rogue") o.goto.order = order; }
      }
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
      // PaddleOCR 로 화면 전체를 읽었으면 난이도는 그 결과(HUD 화면의 왼쪽 아래 숫자)로만 — 고정 자리 tesseract 판독은 창 제목 표시줄만큼
      // 밀려 다른 숫자를 읽었다(분대 선택 화면에서 난이도 1 고정, 2026-10-13)
      const grade = session.paddleUsed() ? hudGrade : hudGrade ?? (gradeP ? await gradeP : gradeFresh ? gradeCache!.grade : null);
      console.debug(`[lens] 난이도 배지: ${grade ?? "(없음)"}${gradeP ? "" : " (캐시)"}`);
      if (grade !== null) {
        if (oc.target.kind === "goto" && oc.target.goto.page === "rogue") oc.target.goto.grade = grade;
        else if (oc.target.kind === "tie") for (const o of oc.target.options) { if (o.goto.page === "rogue") o.goto.grade = grade; }
      }
    }
  }
  // 필드 진단용 — 오인식 리포트를 받으면 콘솔에서 OCR 라인·판정을 바로 확인한다
  console.debug(`[lens:${mode}] OCR ${lines.length}줄 → ${oc.target.kind}/${oc.section ?? "-"} · 엔티티 ${oc.entities.length}`, { lines, outcome: oc });
  traceOcr(lines);   // 화면 모으기가 판정 옆에 읽은 줄을 남긴다 (ocr-trace.ts)
  if (rogueScreenOut) oc.rogueScreen = rogueScreenOut;
  if (rogueNodeOut) oc.rogueNode = rogueNodeOut;
  return oc;
}
