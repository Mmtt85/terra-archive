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
    emergency?: boolean; // 화면에 '긴급 작전'이 보임 — 스테이지 모달을 긴급 탭으로 연다
    highlight?: string[];
    gather?: boolean; // 아이템 다중 인식 — 모아보기 모달로 표시
    grade?: number;   // 좌하단 난이도 배지 인식값 — 난이도 셀렉터에 자동 적용
  }
  | { page: "recruit"; tags: string[] }
  | { page: "story"; id: string; ep: number | null; hits: number }; // 전문 뷰어 딥링크 (ep는 0기준)
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
  // 화면에 테마 **이름**이 그대로 보여 확정된 경우 그 토픽 — 브리지가 이걸로 판(세션)의
  // 테마를 고정한다. 사이트의 현재 토픽은 오인식 한 번에 오염되므로 사전확률로 부적합.
  anchor?: string;
  // 게임 HUD에서 읽은 수치 — 브리지 플레이 로그용 (run.ts가 원시 라인에서 파싱해 얹는다)
  hud?: LensHud;
};
export type LensHud = {
  fractions: [number, number][];   // 화면의 모든 x/y 분수 (원시)
  hp?: [number, number];           // 목표 HP 추정 (분모 ≤ 12)
  levelExp?: [number, number];     // 지휘 레벨 경험치 추정 (분모 13~99)
  result?: "success" | "fail";     // '작전 성공/실패' 문구 검출
};

type Entry = {
  topic: string; topicName: string; section: string;
  id: string; name: string; nameN: string; bodyN: string; bodyTG: Set<string>;
  shortLatin: boolean; // 짧은 순라틴 이름(2~5자) — 부분문자열 오탐이 심해 정확 일치만 허용
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
// EN 정규화 — 대소문자 무시(인덱스·OCR 양쪽 소문자). 게임 UI는 전부 대문자 제목이 흔하다.
// NFKD+결합문자 제거로 악센트를 ASCII로 접는다(Café→cafe). 그리스 문자는 OCR이 라틴으로
// 읽으므로(β→b) normTextCn과 같게 접는다 (샌드박스 α/β/γ 대비).
export const normTextEn = (s: string | null | undefined): string =>
  (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/α/g, "a").replace(/β/g, "b").replace(/γ/g, "y")
    .replace(/[^0-9a-z+%]/g, "");
// JA 정규화 — 히라가나(3041-3096)·가타카나(30A1-30FA)·장음ー·반복부호々·한자(4E00-9FFF) 보존 +
// 라틴 소문자 + 그리스 접기. NFKC로 전각 숫자·라틴을 반각, 반각 가나를 전각(탁점 보존)으로
// 접는다 — jpn/chi_sim OCR이 CJK 맥락에서 전각/반각을 섞어 내는 것을 흡수. normText는 가나·
// 한자를 전부 버려 JA엔 못 쓴다 (중점 ・ 등 구분자 제거).
export const normTextJa = (s: string | null | undefined): string =>
  (s || "").normalize("NFKC")
    .toLowerCase().replace(/α/g, "a").replace(/β/g, "b").replace(/γ/g, "y")
    .replace(/[^0-9a-zぁ-ゖァ-ヺー々一-鿿+%]/g, "");
// 로케일 → 이름/본문 정규화기. 인덱스와 질의는 반드시 같은 것을 써야 한다 (run.ts가 짝지어 호출).
export type LensLocale = "ko" | "en" | "ja";
export type Normalizer = (s: string | null | undefined) => string;
export const normFor = (locale?: string): Normalizer =>
  locale === "en" ? normTextEn : locale === "ja" ? normTextJa : normText;

/** nm의 바이그램이 전체 텍스트에 얼마나 포함되는지 (0~1) — 테마 이름 앵커 판정용 */
function bigramShare(nm: string, allN: string): number {
  const bg = bigrams(nm);
  if (!bg.size) return 0;
  const allBG = bigrams(allN);
  let hit = 0;
  for (const g of bg) if (allBG.has(g)) hit++;
  return hit / bg.size;
}
const bigrams = (s: string): Set<string> => {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
};
// 본문 포함 판정용 트라이그램 — 바이그램은 영어(저엔트로피)에서 흔한 산문이 무관한 본문에
// 70% 포함돼 오탐 goto를 냈다(리뷰 확정). 3-그램은 엔트로피가 훨씬 높아 이를 걸러낸다.
const trigrams = (s: string): Set<string> => {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
  return set;
};
// line의 n-그램이 entry 본문에 얼마나 포함되는지 (0~1)
const contain = (lineNG: Set<string>, bodyNG: Set<string>): number => {
  if (lineNG.size === 0) return 0;
  let hit = 0;
  for (const b of lineNG) if (bodyNG.has(b)) hit++;
  return hit / lineNG.size;
};

// ── 화면 타이틀 키워드 (수동 사전 — 표시용 라벨은 i18n 키) ───────────────────
// 전투 진행 중 화면의 배치 UI 문구 (KR/EN/JA 클라) — 이게 보이면 판정을 포기한다
const BATTLE_WORDS = ["배치가능인원", "배치코스트", "deployable", "deploymentpoints", "配置可能人数"];
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
// norm = 이름/본문 정규화기(로케일별). cnN(흑류수해 CN 원문)은 로케일 무관하게 항상 normTextCn.
// EN/JA 인덱스라도 rogue_6은 KR/CN 병기 파일이라, ko 이름은 norm에서 비게 되지만 cnN이 남아
// 중국어 패스(analyzeChinese)가 rogue_6을 잡는다 — 그래서 cnN만 있어도 엔트리를 버리지 않는다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildIndex(topics: any[], norm: Normalizer = normText): LensIndex {
  const entries: Entry[] = [];
  for (const d of topics) {
    if (!d?.id) continue;
    const topic: string = d.id, topicName: string = d.name;
    const add = (section: string, id: string, name: string, body: string, arc?: string, cn?: string) => {
      const cnN = normTextCn(cn);
      // EN/JA 인덱스(norm!==normText)에선 CN 선행 항목(cn 필드 보유 = rogue_6)의 ko 이름/본문을
      // 비운다 — normTextEn/Ja가 한글을 버려도 라틴·숫자 조각("투기장 VIP 티켓"→vip, "IoT"→iot)이
      // 남아 "Patriot"⊃iot 같은 오탐 goto를 내기 때문. cnN(중국어 패스)만 남겨 rogue_6은 CN으로만.
      const cnOnly = !!cnN && norm !== normText;
      const nameN = cnOnly ? "" : norm(name);
      const bodyN = cnOnly ? "" : norm(body);
      if (!nameN && !bodyN && !cnN) return;
      // 짧은 순라틴 이름(2~5자)은 흔한 영단어의 부분문자열로 가짜 매칭돼(moment⊃omen) 정확 일치만
      const shortLatin = nameN.length >= 2 && nameN.length <= 5 && /^[0-9a-z]+$/.test(nameN);
      entries.push({ topic, topicName, section, id, name, nameN, bodyN, bodyTG: trigrams(bodyN), shortLatin, arc, ...(cnN ? { cnN } : {}) });
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
// 현재 테마를 버리고 갈아타려면 다른 테마가 이만큼 압도해야 한다 (사용자 확정 2026-07-26 —
// 한 판 도는 중에 테마가 바뀌는 일은 없으므로, 애매하면 무조건 지금 테마가 맞다)
const SWITCH_MARGIN = 2.5;
// 테마 이름 앵커의 바이그램 포함율 하한 — OCR 오독·줄바꿈을 넘기되 오탐은 막는 선
const ANCHOR_MIN = 0.7;

export function analyzeLines(
  rawLines: string[],
  index: LensIndex,
  opts?: { context?: { topic?: string; lock?: boolean }; norm?: Normalizer },
): LensOutcome {
  const norm = opts?.norm ?? normText;
  const linesN = rawLines.map((l) => norm(l)).filter((l) => l.length >= 2);
  const allN = linesN.join("");
  const screens = SCREEN_KEYWORDS.filter((k) => allN.includes(k.key)).map((k) => k.label);

  // ── 전투 중 화면은 인식 대상이 아니다 (사용자 제보 2026-07-26) ──────────────
  // 사미 전투 도중에 갑자기 '대이동' 작전으로 튀었다. 전투 화면에는 매칭할 이름이
  // 하나도 없고("17/22", "2X", "99", "배치 가능 인원: 4"), OCR 잡음이 약한 항목
  // 하나에 붙으면 그대로 확신 이동해버린다. 배치 UI 문구로 통째로 걸러낸다.
  // normText는 대소문자를 보존하므로 라틴 키워드는 소문자로 접어서 본다
  const allL = allN.toLowerCase();
  if (BATTLE_WORDS.some((k) => allL.includes(k))) {
    return { screens, entities: [], topics: [], section: null, target: { kind: "none" } };
  }

  // 전 테마 공용 보상 문구 제거 (2026-07-26 제보) — 데이터 색인이 비대칭이라 이런 줄이
  // 특정 테마에 강한 표를 만든다: '뱅가드 모집권'은 rogue_1에만 색인돼 있어 보상 화면마다
  // 팬텀으로 갈아타게 했고, '오리지늄각뿔'은 사미의 '오리지늄' 항목(암호판 탭)에 부분일치해
  // 각뿔을 받을 때마다 암호판이 열렸다. 테마 정보가 전혀 없는 줄이므로 통째로 버린다.
  const linesM = linesN.filter((l) =>
    !l.startsWith("오리지늄각뿔") && !/모집권\d*$/.test(l) && !/1명모집$/.test(l));

  // 화면에 '긴급 작전'이 보이면 스테이지 모달을 긴급 탭으로 (2026-07-26 제보:
  // 긴급 작전맵의 '긴급'이 반영 안 됨 — 일반 탭으로만 열렸다)
  const markEmg = (g: LensGoto): LensGoto => {
    if (g.page === "rogue" && g.modal?.type === "stage" && allN.includes("긴급작전")) g.emergency = true;
    return g;
  };

  // ── 테마 하드 고정 (테마별 게임연결, 사용자 확정 2026-07-26) ─────────────────
  // "사미록라의 게임연결 버튼은 무조건 사미록라만" — 이 테마 밖은 아예 보지 않는다.
  // 다른 테마로의 전환·되묻기가 원천적으로 불가능하고, 매칭도 1/6 인덱스만 봐서 빠르다.
  if (opts?.context?.lock && opts.context.topic) {
    const topic = opts.context.topic;
    const name = index.entries.find((e) => e.topic === topic)?.topicName ?? topic;
    const w = within(topic, linesM, index);
    // 이름 매칭 또는 **조우 본문 우세** — 조우 스토리 화면은 제목이 장식 서체라 이름을 못
    // 읽지만, 본문 문단이 데이터의 조우 설명과 그대로 일치한다(트라이그램 포함율). 단독
    // 조우 모달 + 점수 2 이상(장문 여러 줄 일치)이면 이름 없이도 확정한다 (영상3 f172).
    const encSolid = w && w.section === "enc" && w.goto.page === "rogue"
      && w.goto.modal?.type === "enc" && (w.entities[0]?.score ?? 0) >= 2;
    // 암호판 선택 화면 — 암호판 아이템 이름은 대부분 2글자(결정·배척·교목…)라 2글자
    // 약화 규칙에 걸려 영영 안 열렸다 (2026-07-26 영상5). 화면에 '암호판 선택' 문구가
    // 있으면(선택 카드 화면 전용 — 하단바 상시 '암호판'과 구분) 2글자 mech도 인정한다.
    const mechSolid = w && w.entities[0]?.section === "mech"
      && (w.entities[0].score >= 2 || allN.includes("암호판선택"));
    // **1위 엔티티**가 이름 매칭이어야 확정 — 하위의 약한 이름 매칭이 상위 잡음(룬 문양
    // 오독 등)을 통과시키는 것을 막는다 (2026-07-26 영상3 f140: 배척 4.0 + 오리지늄
    // 아이리스 1.5·이름 → relic 뷰 오발). 정상 화면은 항상 1위가 이름이다(실측).
    if (w && (w.entities[0]?.nameHit || encSolid || mechSolid)) {
      markEmg(w.goto);
      return {
        screens, entities: w.entities,
        topics: [{ topic, topicName: name, score: 1 }],
        section: w.section, target: { kind: "goto", goto: w.goto },
      };
    }
    // 이름 매칭이 없어도 테마 이름(메인 화면)이 보이면 지도로
    const nm = norm(name);
    if (nm.length >= 5 && (allN.includes(nm) || bigramShare(nm, allN) >= ANCHOR_MIN)) {
      return {
        screens, entities: [], topics: [{ topic, topicName: name, score: 1 }],
        section: null, target: { kind: "goto", goto: { page: "rogue", topic, view: "map" } }, anchor: topic,
      };
    }
    return { screens, entities: [], topics: [], section: null, target: { kind: "none" } };
  }

  // 1패스: 전체 인덱스 매칭 → 토픽 다수결 (IDF 분산으로 범용 문구 무력화)
  const hits = matchEntries(linesM, index.entries);
  const topicScore = new Map<string, number>();
  const topicNames = new Map<string, string>();
  const solidsAll: LensEntity[] = [];
  for (const [e, h] of hits) {
    topicScore.set(e.topic, (topicScore.get(e.topic) ?? 0) + h.score);
    topicNames.set(e.topic, e.topicName);
    if (h.score >= SOLID) solidsAll.push({ topic: e.topic, topicName: e.topicName, section: e.section, id: e.id, name: e.name, score: h.score, arc: e.arc, nameHit: h.nameHit });
  }
  const ctxTopic = opts?.context?.topic;

  // ── 테마 고정 (사용자 확정 2026-07-26) ─────────────────────────────────────
  // "사미록라 메인화면을 띄우면 사이트도 사미록라를 띄우고, 그 뒤 진행하는 화면은
  //  제일 먼저 사미라고 판단해야 한다. 지금은 사미 보다가 갑자기 쉐이로 넘어간다."
  //
  // ① 앵커 — 화면에 테마 **이름**이 그대로 보이면 그것이 결정적이다. 테마 메인·로비가
  //    전형이고, 이름이 보이는데 다른 테마로 넘어가는 일은 있을 수 없다.
  //    OCR은 긴 제목을 여러 줄로 쪼개거나 한두 글자를 틀리므로 한 줄 정확일치로는 못 잡는다
  //    (2026-07-26 실기: 사미 메인화면이 안 잡힘). 전체 텍스트를 이어붙여 보고, 그래도
  //    안 맞으면 바이그램 포함율로 본다.
  const anchor = (() => {
    const seen = new Set<string>();
    const allBG = bigrams(allN);
    for (const e of index.entries) {
      if (seen.has(e.topic)) continue;
      seen.add(e.topic);
      const nm = norm(e.topicName);
      if (nm.length < 5) continue;
      if (allN.includes(nm)) return { topic: e.topic, name: e.topicName };
      const bg = bigrams(nm);
      if (!bg.size) continue;
      let hit = 0;
      for (const g of bg) if (allBG.has(g)) hit++;
      if (hit / bg.size >= ANCHOR_MIN) return { topic: e.topic, name: e.topicName };
    }
    return null;
  })();
  if (anchor) {
    const w = within(anchor.topic, linesM, index);
    // 항목은 **이름 수준 매칭**이 있을 때만 연다 — 테마 메인처럼 이름이 없는 화면에서
    // 본문 조각 잡음이 유물 모달을 여는 오작동 방지 (2026-07-26 제보: 사미 메인에서
    // '캔낫의 표식'이 뜸). 잡음뿐이면 그 테마의 지도로만 보낸다.
    const solid = w && w.entities.some((e) => e.nameHit);
    const goto: LensGoto = solid ? markEmg(w.goto) : { page: "rogue", topic: anchor.topic, view: "map" };
    return {
      screens, entities: solid ? w.entities : [],
      topics: [{ topic: anchor.topic, topicName: anchor.name, score: Number.MAX_SAFE_INTEGER }],
      section: solid ? w.section : null, target: { kind: "goto", goto },
      anchor: anchor.topic,
    };
  }

  // ② 현재 테마 우선 — 곱셈 부스트만으론 약하다(현재 테마 점수가 0이면 부스트가 없다).
  //    현재 테마 **안에서만** 먼저 판정해 확신이 나오면 그대로 간다. 테마를 갈아타려면
  //    다른 테마가 SWITCH_MARGIN배로 압도해야 한다 — 한 판 도는 중엔 사실상 안 바뀐다.
  if (ctxTopic) {
    const mineScore = topicScore.get(ctxTopic) ?? 0;
    const bestOther = Math.max(0, ...[...topicScore.entries()].filter(([tp]) => tp !== ctxTopic).map(([, s]) => s));
    if (bestOther < mineScore * SWITCH_MARGIN) {
      const g = within(ctxTopic, linesM, index);
      // ⚠ 이 지름길은 토픽 투표·동점 검사를 건너뛰므로 **이름 수준 매칭**이 있을 때만
      //   쓴다. 본문 조각만으로 잡힌 것에 이 길을 열어주면 전투 화면처럼 이름이 없는
      //   화면에서 OCR 잡음이 그대로 확신 이동이 된다 (2026-07-26 오인식 사례).
      if (g && g.entities.some((e) => e.nameHit)) {
        return {
          screens, entities: g.entities,
          topics: [{ topic: ctxTopic, topicName: topicNames.get(ctxTopic) ?? ctxTopic, score: mineScore }],
          section: g.section, target: { kind: "goto", goto: markEmg(g.goto) },
        };
      }
    }
  }

  // 현재 토픽 사전확률 부스트
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

  // 2패스: 승자 토픽 안에서만 재채점 (within 참고)
  const w = within(top.topic, linesM, index);
  // 테마 전환 가드 — 현재 테마가 있는데 다른 테마가 이겼다면 **이름 수준 매칭**이 있어야
  // 넘어간다. 본문 조각 잡음만으로는 절대 테마를 갈아타지 않는다 (2026-07-26 제보:
  // 사미 플레이 중 쉐이·살카즈로 튐). 이름이 없으면 현재 테마 안에서 다시 시도한다.
  if (ctxTopic && top.topic !== ctxTopic && !(w && w.entities.some((e) => e.nameHit))) {
    const g = within(ctxTopic, linesM, index);
    return g
      ? { screens, entities: g.entities, topics, section: g.section, target: { kind: "goto", goto: markEmg(g.goto) } }
      : { screens, entities: [], topics, section: null, target: { kind: "none" } };
  }
  return w
    ? { screens, entities: w.entities, topics, section: w.section, target: { kind: "goto", goto: markEmg(w.goto) } }
    : { screens, entities: [], topics, section: null, target: { kind: "none" } };
}

/** 한 테마 **안에서만** 재채점 — 토픽 공통 이름("뱅가드 모집권" 등)이 교차 토픽 IDF로
 *  1/6 희석돼 확신 문턱에서 탈락하는 문제를 푼다(상점 화면 다중 아이템의 핵심).
 *  1패스 승자 확정 후의 2패스와, 테마 고정(앵커·현재 테마 우선) 판정이 함께 쓴다. */
function within(topic: string, linesN: string[], index: LensIndex):
  { goto: LensGoto; entities: LensEntity[]; section: string } | null {
  const hitsW = matchEntries(linesN, index.entries.filter((e) => e.topic === topic));
  const solids: LensEntity[] = [];
  for (const [e, h] of hitsW) {
    if (h.score >= SOLID) solids.push({ topic: e.topic, topicName: e.topicName, section: e.section, id: e.id, name: e.name, score: h.score, arc: e.arc, nameHit: h.nameHit });
  }
  const entities = dedupEntities(solids);
  const section = topSection(hitsW);
  if (!section) return null;
  const goto = gotoFor(topic, section, entities);
  return goto ? { goto, entities, section } : null;
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
    const lineTG = trigrams(line);
    const lineLatin = /^[0-9a-z]+$/.test(line); // 순라틴 라인은 역포함(reverse) 문턱을 높인다
    const nameHits: Entry[] = [];
    const bodyHits: Entry[] = [];
    for (const e of entries) {
      const n = e.nameN;
      let nm = false;
      if (e.shortLatin || (n.length === 2)) {
        // 짧은 라틴 이름 + 2글자 이름("구상" 등)은 라인 전체가 정확히 일치할 때만 (부분일치 오탐 차단)
        nm = line === n;
      } else if (n.length >= 3) {
        // 부분일치 — 역포함(라인이 이름의 조각)은 라틴 라인이면 6자 이상만 허용(저엔트로피 오탐 방지)
        // 정포함은 라인이 이름+12자 이내일 때만 — 스토리 문단이 '오리지늄' 같은 짧은 이름을
        // 품어 가짜 nameHit를 만드는 것을 막는다 (2026-07-26 영상3: 조우 본문 → 오리지늄 모아보기)
        nm = (line.includes(n) && line.length <= n.length + 12)
          || (n.includes(line) && line.length >= (lineLatin ? 6 : 4));
      }
      if (nm) nameHits.push(e);
      else if (line.length >= 6 && e.bodyN.length >= 6 && contain(lineTG, e.bodyTG) >= 0.7) bodyHits.push(e);
    }
    // 이름 매칭과 본문 매칭은 IDF 풀을 분리한다 — 영어처럼 바이그램 엔트로피가 낮은 언어에서
    // 이름 한 줄이 수백 개 본문에 공통 바이그램(in·ng·er…)으로 저확신 매칭돼 IDF가 폭발,
    // 진짜 이름 매칭(w=3) 점수를 0에 수렴시키던 문제를 막는다. 한글·한자·가나는 엔트로피가
    // 높아 본문 오매칭이 원래 적어 영향이 미미하다 (KO 회귀는 verify-lens로 확인).
    const idfName = nameHits.length ? 3 / nameHits.length : 0;
    const idfBody = bodyHits.length ? 1 / bodyHits.length : 0;
    for (const e of nameHits) {
      const h = hits.get(e) ?? { score: 0, nameHit: false };
      h.score += idfName;
      // 2글자 한글 이름('구상' 등)의 정확일치는 점수만 주고 nameHit로 치지 않는다 —
      // OCR이 룬 문양·장식을 2글자 낱말로 환각해("배척") 잠금 모드 확정·테마 전환의
      // 근거가 되는 사고를 막는다 (2026-07-26 영상3 f140). 라틴 약어(ISW 등)는 유지.
      if (e.nameN.length >= 3 || e.shortLatin) h.nameHit = true;
      hits.set(e, h);
    }
    for (const e of bodyHits) {
      const h = hits.get(e) ?? { score: 0, nameHit: false };
      h.score += idfBody; hits.set(e, h);
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

/** 엔티티 **1건**의 이동 목표 — 헤더 만능검색(omni.ts)이 검색 결과 한 줄을 이동시킬 때 쓴다.
 *  스샷 렌즈의 gotoFor는 "한 화면에서 인식된 여러 항목"을 묶는 cohort 규칙이라 서로 다르다. */
export function gotoForEntity(e: { topic: string; section: string; id: string; arc?: string }): LensGoto | null {
  if (ITEM_SECTIONS.has(e.section)) {
    if (e.section === "relic") return { page: "rogue", topic: e.topic, view: "relic", modal: { type: "relic", id: e.id } };
    const arcTab = e.section === "mech" ? e.arc : SECTION_NAV[e.section]?.arcTab;
    return { page: "rogue", topic: e.topic, view: "archive", ...(arcTab ? { arcTab } : {}), highlight: [e.id] };
  }
  const nav = SECTION_NAV[e.section];
  if (!nav) return null;
  const g: LensGoto = { page: "rogue", topic: e.topic, view: nav.view };
  if (nav.arcTab) g.arcTab = nav.arcTab;
  if (nav.modalType) g.modal = { type: nav.modalType, id: e.id };
  else g.highlight = [e.id];
  return g;
}
