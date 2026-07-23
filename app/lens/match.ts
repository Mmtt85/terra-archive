// 스크린샷 렌즈 — OCR 라인 ↔ 통합전략 데이터 매칭 코어 (브라우저·verify-lens 하네스 공용).
//
// 파이프라인 (스모크 검증 2026-07-23, fixtures/lens f1~f4 4/4):
//  1. OCR 라인을 정규화(공백·특수문자 제거)
//  2. 엔티티 이름 부분일치(가중 3) + 본문 바이그램 포함율 ≥0.7(가중 1)
//  3. IDF식 표 분산 — 한 라인이 N개 엔티티에 걸리면 표를 1/N로 나눔.
//     "초기 희망 +2" 같은 범용 문구가 유물 수백 개에 저확신 매칭되며 오판시키는 것을 방지.
//  4. 토픽·섹션 다수결 → 이동 목표 해석 (모달 딥링크 / 전시관 탭+하이라이트 / 토픽 동점 선택)
//
// 알려진 한계: 분대 선택 화면은 텍스트만으론 토픽 특정 불가 (지휘/집합/지원/예봉 분대의
// 이름·효과문이 rogue1~4에서 자구까지 동일함을 확인) → 동점(tie) 타깃으로 내보내
// UI에서 테마 선택 칩을 보여준다.

export type LensEntity = {
  topic: string; topicName: string; section: string;
  id: string; name: string; score: number;
  arc?: string; // 토픽 고유 시스템(mechanics) 항목의 전시관 탭 라벨 (영감·암호판 등)
  nameHit?: boolean; // 이름 수준 매칭 여부 — 본문 조각만으로 잡힌 것과 구분
};
export type LensGoto =
  | {
    page: "rogue"; topic: string; view: string; arcTab?: string;
    modal?: { type: string; id: string };
    highlight?: string[];
    gather?: boolean; // 아이템 다중 인식 — 모아보기 모달로 표시
    grade?: number;   // 좌하단 난이도 배지 인식값 — 난이도 셀렉터에 자동 적용
  }
  | { page: "recruit"; tags: string[] };
export type LensTarget =
  | { kind: "none" }
  | { kind: "tie"; section: string; options: { topic: string; topicName: string; goto: LensGoto }[] }
  | { kind: "goto"; goto: LensGoto };
export type LensOutcome = {
  screens: string[];               // 화면 타이틀 키워드 라벨 (표시용, i18n 키)
  entities: LensEntity[];          // 확신 엔티티 (이름 기준 중복 제거, 점수순)
  topics: { topic: string; topicName: string; score: number }[];
  section: string | null;          // 우세 섹션 (band|stage|enc|relic|zone|tool|capsule|ending)
  target: LensTarget;
};

type Entry = {
  topic: string; topicName: string; section: string;
  id: string; name: string; nameN: string; bodyN: string; bodyBG: Set<string>;
  arc?: string;
  cnN?: string; // 중국어 원문 이름 정규화 — CN 선행 토픽(흑류수해)만 존재
};
export type LensIndex = { entries: Entry[] };

// ── 텍스트 정규화 ────────────────────────────────────────────────────────────
export const normText = (s: string | null | undefined): string =>
  (s || "").replace(/[^0-9a-zA-Z가-힣+%]/g, "");

// CN 정규화 — 한자 보존 + 라틴 소문자화. 그리스 문자는 OCR이 라틴으로 읽으므로("沙盘β"→"沙盘B")
// 같은 라틴 소문자로 접는다 (데이터 실측: cn 이름의 특수문자는 α β γ - 인용부호뿐)
export const normTextCn = (s: string | null | undefined): string =>
  (s || "").toLowerCase().replace(/α/g, "a").replace(/β/g, "b").replace(/γ/g, "y")
    .replace(/[^0-9a-z一-鿿+%]/g, "");

const bigrams = (s: string): Set<string> => {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
};
// line의 바이그램이 entry 본문에 얼마나 포함되는지 (0~1)
const contain = (lineBG: Set<string>, bodyBG: Set<string>): number => {
  if (lineBG.size === 0) return 0;
  let hit = 0;
  for (const b of lineBG) if (bodyBG.has(b)) hit++;
  return hit / lineBG.size;
};

// ── 화면 타이틀 키워드 (수동 사전 — 표시용 라벨은 i18n 키) ───────────────────
const SCREEN_KEYWORDS: { key: string; label: string }[] = [
  { key: "분대선택", label: "분대 선택 화면" },
  { key: "받는다", label: "전리품 획득 화면" },
  { key: "바로가기", label: "맵/작전 노드 화면" },
  { key: "작전준비", label: "작전 준비 화면" },
  { key: "모집요건", label: "공개모집 화면" },
];

// ── 공개모집 화면 감지 — 화면 키워드로 게이트한 뒤 태그 버튼 텍스트를 추출 ────
// 태그명은 짧아서("메딕" 2자) 로그라이크 설명문에도 흔히 등장 — 반드시 모집 화면
// 키워드(2개 이상, 또는 1개+태그 2개)로 게이트해야 오발동하지 않는다.
const RECRUIT_KEYWORDS = ["모집시간", "모집요건", "모집예산", "모집설명", "획득가능오퍼레이터", "인재아웃서칭", "태그갱신"];

/** 칩 패스(어두운 버튼 개별 OCR)가 필요한 화면인지 — 현재는 공개모집 키워드가 보일 때만.
 *  칩 패스는 크롭당 recognize를 돌려 비싸므로(최대 20회) 필요할 때만 실행한다. */
export function wantsChipPass(rawLines: string[]): boolean {
  const allN = rawLines.map((l) => normText(l)).join("");
  return RECRUIT_KEYWORDS.some((k) => allN.includes(k));
}

function detectRecruitTags(linesN: string[], recruitTags: string[]): string[] {
  const tagsN = recruitTags.map((t) => ({ name: t, n: normText(t) })).filter((t) => t.n.length >= 2);
  const found: string[] = [];
  for (const line of linesN) {
    for (const tag of tagsN) {
      if (found.includes(tag.name)) continue;
      if (!line.includes(tag.n)) continue;
      // 포함관계 태그 방어 — "뱅가드" 라인이 "가드"로, "고급 특별 채용"이 "특별 채용"으로 잡히지 않게
      const shadowed = tagsN.some((o) => o.name !== tag.name && o.n.includes(tag.n) && line.includes(o.n));
      if (shadowed) continue;
      found.push(tag.name);
    }
  }
  // 게임 규칙상 태그는 최대 5개 — 초과분은 OCR 오탐이므로 버린다
  return found.slice(0, 5);
}

/** 공채 도우미 전용 판정 — 페이지별 설치라 화면 분류가 불필요, 태그만 추출한다. */
export function analyzeRecruit(rawLines: string[], recruitTags: string[]): LensOutcome {
  const linesN = rawLines.map((l) => normText(l)).filter((l) => l.length >= 2);
  const allN = linesN.join("");
  const screens = RECRUIT_KEYWORDS.some((k) => allN.includes(k)) ? ["공개모집 화면"] : [];
  const tags = detectRecruitTags(linesN, recruitTags);
  if (!tags.length) {
    return { screens, entities: [], topics: [], section: null, target: { kind: "none" } };
  }
  return {
    screens,
    entities: tags.map((name) => ({ topic: "recruit", topicName: "공개모집", section: "recruit", id: name, name, score: 3 })),
    topics: [{ topic: "recruit", topicName: "공개모집", score: tags.length }],
    section: "recruit",
    target: { kind: "goto", goto: { page: "recruit", tags } },
  };
}

// ── 인덱스 구축 — rogue*.json 형태의 토픽 데이터에서 ────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildIndex(topics: any[]): LensIndex {
  const entries: Entry[] = [];
  for (const d of topics) {
    if (!d?.id) continue;
    const topic: string = d.id, topicName: string = d.name;
    const add = (section: string, id: string, name: string, body: string, arc?: string, cn?: string) => {
      const nameN = normText(name);
      const bodyN = normText(body);
      if (!nameN && !bodyN) return;
      const cnN = normTextCn(cn);
      entries.push({ topic, topicName, section, id, name, nameN, bodyN, bodyBG: bigrams(bodyN), arc, ...(cnN ? { cnN } : {}) });
    };
    for (const b of d.bands ?? []) add("band", b.id, b.name, `${b.usage || ""} ${b.desc || ""}`, undefined, b.cn);
    for (const r of d.relics ?? []) add("relic", r.id, r.name, `${r.usage || ""} ${r.desc || ""}`, undefined, r.cn);
    for (const s of d.stages ?? []) add("stage", s.id, s.name, s.desc || "", undefined, s.cn);
    for (const z of d.zones ?? []) add("zone", z.id, z.name, z.desc || "", undefined, z.cn);
    // 무대 도구는 사이트에서 소장품으로 통합 표시 (2026-07-24) — relic 섹션으로 인덱싱해
    // 단일=유물 모달, 다중=모아보기가 동일하게 동작한다
    for (const t of d.tools ?? []) add("relic", t.id, t.name, `${t.usage || ""} ${t.desc || ""}`, undefined, t.cn);
    for (const c of d.capsules ?? []) add("capsule", c.id, c.name, `${c.usage || ""} ${c.desc || ""}`, undefined, c.cn);
    // 부품(零件) — 흑류수해 고유, 전시관 scrap 탭. 상인 판매 화면에 여럿 나온다 (2026-07-24)
    for (const s of d.scraps ?? []) add("scrap", s.id, s.name, `${s.usage || ""} ${s.desc || ""}`, undefined, s.cn);
    for (const e of d.encounters ?? []) {
      const choices = (e.choices ?? []).map((c: { title?: string; desc?: string }) => `${c.title || ""} ${c.desc || ""}`).join(" ");
      add("enc", e.scene, e.title, `${e.desc || ""} ${choices}`, undefined, e.cn);
    }
    for (const e of d.endings ?? []) add("ending", e.id, e.name, e.desc || "", undefined, e.cn);
    // 토픽 고유 시스템 (사고=염원/영감/구상, 암호판, 붕괴 패러다임, 시대 등) — 전시관 탭 라벨을 arc로
    for (const m of d.mechanics ?? []) {
      for (const it of m.items ?? []) add("mech", it.id, it.name, `${it.usage || ""} ${it.desc || ""}`, m.label);
    }
  }
  return { entries };
}

// ── 매칭 + 타깃 해석 ────────────────────────────────────────────────────────
const SOLID = 0.75;      // IDF 분산 후에도 남는 확신 엔티티 점수 하한
const DOMINANCE = 1.5;   // 1위/2위 토픽 점수비가 이 미만이면 동점 처리
const TIE_FLOOR = 0.5;   // 동점 후보로 인정할 최소 점수비 (1위 대비)

// 섹션 → /rogue 이동 방법. 모달 딥링크가 있는 섹션은 modal, 나머지는 뷰(+전시관 탭)+하이라이트.
const SECTION_NAV: Record<string, { view: string; arcTab?: string; modalType?: string }> = {
  stage: { view: "map", modalType: "stage" },
  zone: { view: "map", modalType: "zone" },
  enc: { view: "map", modalType: "enc" },
  relic: { view: "relic", modalType: "relic" },
  band: { view: "archive", arcTab: "band" },
  tool: { view: "archive", arcTab: "tool" },
  capsule: { view: "archive", arcTab: "capsule" },
  scrap: { view: "archive", arcTab: "scrap" }, // 부품(零件) — 흑류수해 전시관 탭
  mech: { view: "archive" }, // arcTab은 엔티티의 arc(시스템 라벨: 영감·암호판 등)에서
  ending: { view: "ending" },
};

// 현재 페이지 컨텍스트 사전확률 — 사미 가이드를 보며 사미 스샷을 찍을 확률이 압도적이므로
// 현재 토픽의 표를 배수로 키운다. 동점(분대 선택)은 현재 토픽으로 자동 확정되고,
// 다른 토픽의 강한 증거(스테이지명 등, 통상 10~20배)는 그대로 이긴다.
const CTX_BOOST = 1.6;

export function analyzeLines(
  rawLines: string[],
  index: LensIndex,
  opts?: { context?: { topic?: string } },
): LensOutcome {
  const linesN = rawLines.map((l) => normText(l)).filter((l) => l.length >= 2);
  const allN = linesN.join("");
  const screens = SCREEN_KEYWORDS.filter((k) => allN.includes(k.key)).map((k) => k.label);

  // 1패스: 전체 인덱스 매칭 → 토픽 다수결 (IDF 분산으로 범용 문구 무력화)
  const hits = matchEntries(linesN, index.entries);
  const topicScore = new Map<string, number>();
  const topicNames = new Map<string, string>();
  const solidsAll: LensEntity[] = [];
  for (const [e, h] of hits) {
    topicScore.set(e.topic, (topicScore.get(e.topic) ?? 0) + h.score);
    topicNames.set(e.topic, e.topicName);
    if (h.score >= SOLID) solidsAll.push({ topic: e.topic, topicName: e.topicName, section: e.section, id: e.id, name: e.name, score: h.score, arc: e.arc, nameHit: h.nameHit });
  }
  // 현재 토픽 사전확률 부스트
  const ctxTopic = opts?.context?.topic;
  if (ctxTopic && topicScore.has(ctxTopic)) topicScore.set(ctxTopic, topicScore.get(ctxTopic)! * CTX_BOOST);
  const topics = [...topicScore.entries()]
    .map(([topic, score]) => ({ topic, topicName: topicNames.get(topic) ?? topic, score }))
    .sort((a, b) => b.score - a.score);
  if (!topics.length) return { screens, entities: [], topics, section: null, target: { kind: "none" } };

  // 동점(테마 특정 불가) — 전역 매칭 엔티티로 각 후보의 이동 목표 구성 (분대 선택 화면이 전형)
  const top = topics[0], second = topics[1];
  if (second && top.score < second.score * DOMINANCE) {
    const entities = dedupEntities(solidsAll);
    const section = topSection(hits) ?? "band";
    const options = topics
      .filter((tp) => tp.score >= top.score * TIE_FLOOR)
      .sort((a, b) => (parseInt(b.topic.split("_")[1] ?? "0", 10) - parseInt(a.topic.split("_")[1] ?? "0", 10)))
      .map((tp) => ({ topic: tp.topic, topicName: tp.topicName, goto: gotoFor(tp.topic, section, entities) }))
      .filter((o): o is { topic: string; topicName: string; goto: LensGoto } => o.goto !== null);
    return options.length
      ? { screens, entities, topics, section, target: { kind: "tie", section, options } }
      : { screens, entities, topics, section, target: { kind: "none" } };
  }

  // 2패스: 승자 토픽 안에서만 재채점 — 토픽 공통 이름("뱅가드 모집권" 등)이 교차 토픽
  // IDF로 1/6 희석돼 확신 문턱에서 탈락하는 문제 해결 (상점 화면 다중 아이템의 핵심)
  const wEntries = index.entries.filter((e) => e.topic === top.topic);
  const hitsW = matchEntries(linesN, wEntries);
  const solidsW: LensEntity[] = [];
  for (const [e, h] of hitsW) {
    if (h.score >= SOLID) solidsW.push({ topic: e.topic, topicName: e.topicName, section: e.section, id: e.id, name: e.name, score: h.score, arc: e.arc, nameHit: h.nameHit });
  }
  const entities = dedupEntities(solidsW);
  const section = topSection(hitsW);
  const g = section ? gotoFor(top.topic, section, entities) : null;
  return { screens, entities, topics, section, target: g ? { kind: "goto", goto: g } : { kind: "none" } };
}

// ── 중국어(CN 클라) 매칭 — 흑류수해는 CN 선행이라 스크린샷이 중국어다 ─────────
// 사용자 확정 2026-07-24: "중국어가 나오는 경우는 무조건 흑류수해 록라" — cn 이름은
// 구조적으로도 rogue_6에만 있으므로 토픽 투표 없이 cn 보유 엔트리만 상대로 매칭한다.
// cn은 이름뿐(본문 번역 없음)이라 이름 매칭 전용 + 1자 오독 퍼지(바이그램)를 쓴다.
export function analyzeChinese(rawLines: string[], index: LensIndex): LensOutcome {
  const linesN = rawLines.map((l) => normTextCn(l)).filter((l) => l.length >= 2);
  const entries = index.entries.filter((e) => e.cnN);
  const hits = new Map<Entry, Hit>();
  for (const line of linesN) {
    const lineBG = bigrams(line);
    const lineHits: { e: Entry; w: number }[] = [];
    for (const e of entries) {
      const n = e.cnN!;
      let w = 0;
      if (n.length >= 3 && (line.includes(n) || (line.length >= 4 && n.includes(line)))) w = 3;
      else if (n.length === 2 && line === n) w = 3; // 2자 이름은 정확일치만 (KR과 동일 규칙)
      else if (n.length >= 4 && Math.abs(line.length - n.length) <= 1) {
        // 카드 제목 라인의 1자 오독 허용 ("多生苔藓"→"多生苔苏" 실측) — 길이가 비슷할 때만
        const nb = bigrams(n);
        let hit = 0;
        for (const b of nb) if (lineBG.has(b)) hit++;
        if (hit / nb.size >= 0.6) w = 2;
      }
      if (w) lineHits.push({ e, w });
    }
    if (!lineHits.length) continue;
    // 존 이름은 모든 화면 헤더에 상시 노출("血色空脉") — 섹션 투표를 오염시키지 않게 반감
    for (const lh of lineHits) if (lh.e.section === "zone") lh.w *= 0.5;
    const idf = 1 / lineHits.length;
    for (const { e, w } of lineHits) {
      const h = hits.get(e) ?? { score: 0, nameHit: false };
      h.score += w * idf;
      h.nameHit = true; // CN은 이름 매칭뿐
      hits.set(e, h);
    }
  }
  if (!hits.size) return { screens: [], entities: [], topics: [], section: null, target: { kind: "none" } };
  const solids: LensEntity[] = [];
  const topicScore = new Map<string, number>();
  const topicNames = new Map<string, string>();
  for (const [e, h] of hits) {
    topicScore.set(e.topic, (topicScore.get(e.topic) ?? 0) + h.score);
    topicNames.set(e.topic, e.topicName);
    if (h.score >= SOLID) solids.push({ topic: e.topic, topicName: e.topicName, section: e.section, id: e.id, name: e.name, score: h.score, arc: e.arc, nameHit: h.nameHit });
  }
  const topics = [...topicScore.entries()]
    .map(([topic, score]) => ({ topic, topicName: topicNames.get(topic) ?? topic, score }))
    .sort((a, b) => b.score - a.score);
  const entities = dedupEntities(solids);
  const section = topSection(hits);
  const g = section ? gotoFor(topics[0].topic, section, entities) : null;
  return { screens: [], entities, topics, section, target: g ? { kind: "goto", goto: g } : { kind: "none" } };
}

// 라인 ↔ 엔트리 매칭 (IDF는 "전달된 엔트리 집합" 안에서 분산된다)
type Hit = { score: number; nameHit: boolean };
function matchEntries(linesN: string[], entries: Entry[]): Map<Entry, Hit> {
  const hits = new Map<Entry, Hit>();
  for (const line of linesN) {
    const lineBG = bigrams(line);
    const lineHits: { e: Entry; w: number; nm: boolean }[] = [];
    for (const e of entries) {
      if (e.nameN.length >= 3 && (line.includes(e.nameN) || (line.length >= 4 && e.nameN.includes(line)))) {
        lineHits.push({ e, w: 3, nm: true });
      } else if (e.nameN.length === 2 && line === e.nameN) {
        // 2글자 이름("구상" 등)은 라인 전체가 정확히 일치할 때만 — 부분일치는 오탐투성이
        lineHits.push({ e, w: 3, nm: true });
      } else if (line.length >= 6 && e.bodyN.length >= 6 && contain(lineBG, e.bodyBG) >= 0.7) {
        lineHits.push({ e, w: 1, nm: false });
      }
    }
    if (lineHits.length === 0) continue;
    const idf = 1 / lineHits.length;
    for (const { e, w, nm } of lineHits) {
      const h = hits.get(e) ?? { score: 0, nameHit: false };
      h.score += w * idf;
      h.nameHit ||= nm;
      hits.set(e, h);
    }
  }
  return hits;
}

function topSection(hits: Map<Entry, Hit>): string | null {
  const sectionScore = new Map<string, number>();
  for (const [e, h] of hits) sectionScore.set(e.section, (sectionScore.get(e.section) ?? 0) + h.score);
  return [...sectionScore.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// 표시용 중복 제거 (일반/긴급 같은 이름 스테이지 등) — 토픽+섹션+이름 기준, 점수순
function dedupEntities(solids: LensEntity[]): LensEntity[] {
  solids.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return solids.filter((s) => {
    const k = `${s.topic}/${s.section}/${s.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// 아이템류 섹션 — 상점·전리품 화면엔 유물/도구/음반/부품/토픽 고유 시스템이 섞여 나오므로
// 섹션을 가르지 않고 함께 수집한다 (사용자 요청 2026-07-23: 상인 화면 전 품목 인식)
const ITEM_SECTIONS = new Set(["relic", "tool", "capsule", "mech", "scrap"]);

// 특정 토픽+섹션의 확신 엔티티들로 LensGoto 구성.
// 동급 스코어(1위의 절반 이상) 엔티티가 여럿이면 단일 모달 대신 모아보기/하이라이트.
function gotoFor(topic: string, section: string, entities: LensEntity[]): LensGoto | null {
  // 아이템류: 섹션 경계 없이 cohort 구성 → 1개면 기존 단일 동작, 여럿이면 모아보기(gather)
  if (ITEM_SECTIONS.has(section)) {
    const mine = entities.filter((e) => e.topic === topic && ITEM_SECTIONS.has(e.section));
    // 절반 규칙 + 이름 매칭 특례 — 같은 아이템이 여러 장 반복돼(사고 화면의 고목 신지 ×6)
    // 1위 점수가 부풀어도 "이름으로" 잡힌 다른 아이템(구상 등)은 잘리지 않게.
    // 본문 조각만으로 잡힌 항목은 절반 규칙 그대로 (염원류 공유 효과문 오탐 방지)
    const half = (mine[0]?.score ?? 0) * 0.5;
    const cohort = mine.filter((e) => e.score >= half || (e.nameHit && e.score >= 1.4));
    if (!cohort.length) return null;
    if (cohort.length === 1) {
      const one = cohort[0];
      if (one.section === "relic") return { page: "rogue", topic, view: "relic", modal: { type: "relic", id: one.id } };
      const arcTab = one.section === "mech" ? one.arc : SECTION_NAV[one.section]?.arcTab;
      return { page: "rogue", topic, view: "archive", ...(arcTab ? { arcTab } : {}), highlight: [one.id] };
    }
    const hasRelic = cohort.some((e) => e.section === "relic");
    const arcTab = hasRelic ? undefined : (cohort[0].section === "mech" ? cohort[0].arc : SECTION_NAV[cohort[0].section]?.arcTab);
    return {
      page: "rogue", topic,
      view: hasRelic ? "relic" : "archive",
      ...(arcTab ? { arcTab } : {}),
      highlight: cohort.map((e) => e.id),
      gather: true, // rogue가 모아보기 모달로 띄운다
    };
  }
  const nav = SECTION_NAV[section];
  if (!nav) return null;
  const mine = entities.filter((e) => e.topic === topic && e.section === section);
  const cohort = mine.filter((e) => e.score >= (mine[0]?.score ?? 0) * 0.5);
  const g: LensGoto = { page: "rogue", topic, view: nav.view };
  if (nav.arcTab) g.arcTab = nav.arcTab;
  if (nav.modalType && cohort.length === 1) g.modal = { type: nav.modalType, id: cohort[0].id };
  else if (cohort.length) g.highlight = cohort.map((e) => e.id);
  return g;
}
