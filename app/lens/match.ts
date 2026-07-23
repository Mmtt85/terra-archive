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
};
export type LensGoto = {
  topic: string; view: string; arcTab?: string;
  modal?: { type: string; id: string };
  highlight?: string[];
};
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
};
export type LensIndex = { entries: Entry[] };

// ── 텍스트 정규화 ────────────────────────────────────────────────────────────
export const normText = (s: string | null | undefined): string =>
  (s || "").replace(/[^0-9a-zA-Z가-힣+%]/g, "");

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
];

// ── 인덱스 구축 — rogue*.json 형태의 토픽 데이터에서 ────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildIndex(topics: any[]): LensIndex {
  const entries: Entry[] = [];
  for (const d of topics) {
    if (!d?.id) continue;
    const topic: string = d.id, topicName: string = d.name;
    const add = (section: string, id: string, name: string, body: string) => {
      const nameN = normText(name);
      const bodyN = normText(body);
      if (!nameN && !bodyN) return;
      entries.push({ topic, topicName, section, id, name, nameN, bodyN, bodyBG: bigrams(bodyN) });
    };
    for (const b of d.bands ?? []) add("band", b.id, b.name, `${b.usage || ""} ${b.desc || ""}`);
    for (const r of d.relics ?? []) add("relic", r.id, r.name, `${r.usage || ""} ${r.desc || ""}`);
    for (const s of d.stages ?? []) add("stage", s.id, s.name, s.desc || "");
    for (const z of d.zones ?? []) add("zone", z.id, z.name, z.desc || "");
    for (const t of d.tools ?? []) add("tool", t.id, t.name, `${t.usage || ""} ${t.desc || ""}`);
    for (const c of d.capsules ?? []) add("capsule", c.id, c.name, `${c.usage || ""} ${c.desc || ""}`);
    for (const e of d.encounters ?? []) {
      const choices = (e.choices ?? []).map((c: { title?: string; desc?: string }) => `${c.title || ""} ${c.desc || ""}`).join(" ");
      add("enc", e.scene, e.title, `${e.desc || ""} ${choices}`);
    }
    for (const e of d.endings ?? []) add("ending", e.id, e.name, e.desc || "");
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
  ending: { view: "ending" },
};

export function analyzeLines(rawLines: string[], index: LensIndex): LensOutcome {
  const linesN = rawLines.map((l) => normText(l)).filter((l) => l.length >= 3);
  const allN = linesN.join("");
  const screens = SCREEN_KEYWORDS.filter((k) => allN.includes(k.key)).map((k) => k.label);

  // 라인별 2패스: 매칭 엔티티 수집 후 1/N 가중(IDF식) 분산
  const hits = new Map<number, number>(); // entryIdx → score
  for (const line of linesN) {
    const lineBG = bigrams(line);
    const lineHits: { ei: number; w: number }[] = [];
    for (let ei = 0; ei < index.entries.length; ei++) {
      const e = index.entries[ei];
      if (e.nameN.length >= 3 && (line.includes(e.nameN) || (line.length >= 4 && e.nameN.includes(line)))) {
        lineHits.push({ ei, w: 3 });
      } else if (line.length >= 6 && e.bodyN.length >= 6 && contain(lineBG, e.bodyBG) >= 0.7) {
        lineHits.push({ ei, w: 1 });
      }
    }
    if (lineHits.length === 0) continue;
    const idf = 1 / lineHits.length;
    for (const { ei, w } of lineHits) hits.set(ei, (hits.get(ei) ?? 0) + w * idf);
  }

  // 토픽·섹션 집계
  const topicScore = new Map<string, number>();
  const topicNames = new Map<string, string>();
  const sectionScore = new Map<string, number>(); // 섹션만 (토픽 무관 — 동점 시에도 섹션은 공유됨)
  const solids: LensEntity[] = [];
  for (const [ei, score] of hits) {
    const e = index.entries[ei];
    topicScore.set(e.topic, (topicScore.get(e.topic) ?? 0) + score);
    topicNames.set(e.topic, e.topicName);
    sectionScore.set(e.section, (sectionScore.get(e.section) ?? 0) + score);
    if (score >= SOLID) solids.push({ topic: e.topic, topicName: e.topicName, section: e.section, id: e.id, name: e.name, score });
  }
  solids.sort((a, b) => b.score - a.score);
  // 표시용 중복 제거 (일반/긴급 같은 이름 스테이지 등) — 토픽+섹션+이름 기준
  const seen = new Set<string>();
  const entities = solids.filter((s) => {
    const k = `${s.topic}/${s.section}/${s.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const topics = [...topicScore.entries()]
    .map(([topic, score]) => ({ topic, topicName: topicNames.get(topic) ?? topic, score }))
    .sort((a, b) => b.score - a.score);
  const section = [...sectionScore.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return { screens, entities, topics, section, target: resolveTarget(topics, section, entities) };
}

// 특정 토픽+섹션의 확신 엔티티들로 LensGoto 구성
function gotoFor(topic: string, section: string, entities: LensEntity[]): LensGoto | null {
  const nav = SECTION_NAV[section];
  if (!nav) return null;
  const mine = entities.filter((e) => e.topic === topic && e.section === section);
  const g: LensGoto = { topic, view: nav.view };
  if (nav.arcTab) g.arcTab = nav.arcTab;
  if (nav.modalType && mine[0]) g.modal = { type: nav.modalType, id: mine[0].id };
  else if (mine.length) g.highlight = mine.map((e) => e.id);
  return g;
}

function resolveTarget(
  topics: { topic: string; topicName: string; score: number }[],
  section: string | null,
  entities: LensEntity[],
): LensTarget {
  if (!topics.length || !section) return { kind: "none" };
  const top = topics[0];
  const second = topics[1];
  if (second && top.score < second.score * DOMINANCE) {
    // 토픽 동점 — 후보를 최신 토픽(번호 큰 쪽)부터 나열, 각각의 이동 목표 포함
    const options = topics
      .filter((t) => t.score >= top.score * TIE_FLOOR)
      .sort((a, b) => (parseInt(b.topic.split("_")[1] ?? "0", 10) - parseInt(a.topic.split("_")[1] ?? "0", 10)))
      .map((t) => ({ topic: t.topic, topicName: t.topicName, goto: gotoFor(t.topic, section, entities) }))
      .filter((o): o is { topic: string; topicName: string; goto: LensGoto } => o.goto !== null);
    return options.length ? { kind: "tie", section, options } : { kind: "none" };
  }
  const g = gotoFor(top.topic, section, entities);
  return g ? { kind: "goto", goto: g } : { kind: "none" };
}
