"use client";
// 스샷 레이더 — 인식 파이프라인 (모달과 페이지 레벨 자동인식이 공유).
// 모드별 단계형 OCR + 매칭: 판정이 나면 나머지 패스를 생략한다 (속도).

import { createOcrSession } from "./ocr";
import { asset } from "../assets";
import { buildIndex, analyzeLines, analyzeChinese, analyzeRecruit, wantsChipPass, isCollectLine, isCollectLineCn, LENS_ITEM_SECTIONS, normFor, type LensIndex, type LensOutcome, type LensHud } from "./match";
import { parseStoryIndex, analyzeStoryLines, type StoryIndex } from "./storymatch";
import { buildAcIndex, bondOfLine, parseSeats, isAcInfoScreen, classifyAcScreen, parseAcMode, badgeRectFromTitle,
  parseAcBand, parseDeployLeft, parseAcHud, findAcRings, ringNameRect, ringNumRect, RING_DIGITS, parseRingStack,
  buildPieceNameIndex, matchPieceName, type AcIndex, type PieceIndex, type AcScreen } from "./acmatch";
import { findAcRows, isAcBanScreen, acBanRows } from "./acvision";
import { cardFeature, solveBanRow, type FacePiece } from "./acface";
import { loadFaceTemplates } from "./acface-load";
import { participantSlots, searchBand, BAND_ACCEPT } from "./acband";
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
  let oc: LensOutcome;
  if (mode === "recruit") {
    // 태그는 어두운 버튼 칩이 본체 — 칩 패스 필수, 전체 프레임은 보조 (선택된 파란 태그 등)
    const [tags, session] = await Promise.all([getRecruitTags(), createOcrSession(file)]);
    lines = (await session.chips()).concat(await session.sparse());
    oc = analyzeRecruit(lines, tags);
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
        // 참가자 카드 썸네일 — 연합에서 **다른 참가자**의 전략. 카드 슬롯은 청록 요소로 찾고(참가자 1명 녹화로만
        // 검증, 다인 화면은 미검증) 썸네일을 전략 아이콘과 그림으로 맞춘다. 내 전략과 같은 그림은 내 카드로 본다.
        if (color && screen === "confirm") {
          try {
            const slots = participantSlots(color.px, color.W, color.H);
            if (slots.length) {
              const tpl = await loadBandTemplates(ac.bands.map((b) => b.id));
              let seat = 1;
              for (const sl of slots) {
                const hit = searchBand(color.px, color.W, color.H, sl.thumb, tpl);
                if (!hit || hit.score < BAND_ACCEPT.score || hit.margin < BAND_ACCEPT.margin) continue;
                if (pick && hit.band === pick.band) continue;          // 내 카드
                bands.push({ seat: seat++, band: hit.band, final: true });
              }
              if (slots.length > 1) seats = Math.max(seats, slots.length);
              console.debug(`[lens] 참가자 카드 ${slots.length}개 → 상대 전략 ${bands.filter((b) => b.seat > 0).map((b) => b.band).join(",") || "없음"}`);
            }
          } catch { /* 실험적 — 실패해도 내 전략은 살린다 */ }
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
      target: { kind: "acrun", screen, stacks, fresh, deployLeft, seats, mode: modeCode, bands, bans, banObs, banSeen, hp, pieces },
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
