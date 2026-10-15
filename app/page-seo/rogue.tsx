// 통합전략 서버 안내 — 푸터 위 접는 칸 (2026-10-15, 사용자 지시 "가챠·육성·록라 전부").
// 통합전략 본문(층·적·소장품)은 300~800KB 라 브라우저에서 늦게 받아, 서버 HTML 에는 "데이터를 불러오는 중"뿐이었다(본문 80자).
// 여기서 같은 데이터(app/data/rogueN[.en|.ja].json)로 층·엔딩·보스·분대·난이도·소장품 이름을 HTML 에 싣는다 — 서버 컴포넌트라 브라우저로는 안 간다
import index from "../data/rogue-index.json";
import k1 from "../data/rogue1.json"; import e1 from "../data/rogue1.en.json"; import j1 from "../data/rogue1.ja.json";
import k2 from "../data/rogue2.json"; import e2 from "../data/rogue2.en.json"; import j2 from "../data/rogue2.ja.json";
import k3 from "../data/rogue3.json"; import e3 from "../data/rogue3.en.json"; import j3 from "../data/rogue3.ja.json";
import k4 from "../data/rogue4.json"; import e4 from "../data/rogue4.en.json"; import j4 from "../data/rogue4.ja.json";
import k5 from "../data/rogue5.json"; import e5 from "../data/rogue5.en.json"; import j5 from "../data/rogue5.ja.json";
import k6 from "../data/rogue6.json"; import e6 from "../data/rogue6.en.json"; import j6 from "../data/rogue6.ja.json";
import { BASE, type SeoLang } from "./locale";

type Topic = {
  id: string; name: string; future?: boolean; line?: string;
  zones: { num: number; name: string; desc?: string | null; variant?: boolean; hidden?: boolean }[];
  endings: { name: string; desc?: string | null; cond?: string[] }[];
  stages: { kind: string; code?: string; name: string }[];
  bands: { name: string; usage?: string | null }[];
  difficulties: { mode: string; grade: number; name: string; rule?: string | null }[];
  relics: { name: string }[];
};
const pack = (list: unknown[]) => Object.fromEntries((list as Topic[]).map((t) => [t.id, t]));
const TOPICS: Record<SeoLang, Record<string, Topic>> = {
  ko: pack([k1, k2, k3, k4, k5, k6]), en: pack([e1, e2, e3, e4, e5, e6]), ja: pack([j1, j2, j3, j4, j5, j6]),
};
type IndexText = { name: string; line: string; zones: number; enemies: number; relics: number };
const INDEX = index as unknown as Record<string, Record<SeoLang, IndexText>>;
const oneLine = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

const T = {
  ko: {
    hubAria: "통합전략 안내", hubSummary: "명일방주 통합전략 테마 목록 · 공략 안내",
    hubP: "명일방주 통합전략(로그라이크)의 테마별 층·노드, 적 도감(난이도별 스탯), 소장품, 엔딩 조건을 게임 데이터 그대로 정리했습니다. 위에서 테마를 고르거나 아래 테마 이름으로 들어가세요.",
    future: " (중국 서버 선행)", counts: (z: number, e: number, r: number) => `층 ${z}개 · 적 ${e}종 · 소장품 ${r}개.`,
    aria: (n: string) => `${n} 공략 정리`, summary: (n: string) => `${n} 공략 정리 — 층·엔딩·보스·분대·소장품 목록`,
    intro: (n: string, f: boolean) => `명일방주 통합전략 「${n}」${f ? "(중국 서버 선행 — 한국 서버 미실장)" : ""}의 층 구성, 엔딩 달성 조건, 보스 작전, 시작 분대, 난이도, 소장품을 게임 데이터에서 정리했습니다.`,
    zones: "층 구성", hidden: "히든 층", floor: (n: number) => `${n}층`, endings: "엔딩과 달성 조건", bosses: "보스 작전", bands: "분대",
    diff: "난이도", grade: (g: number) => `난이도 ${g}`, relics: (n: number) => `소장품 ${n}개`,
  },
  en: {
    hubAria: "Integrated Strategies guide", hubSummary: "Arknights Integrated Strategies themes · Guide",
    hubP: "Floors and nodes, the enemy index (stats by difficulty), collectibles and ending conditions for every Arknights Integrated Strategies (roguelike) theme, straight from the game data. Pick a theme above or open one below.",
    future: " (CN server preview)", counts: (z: number, e: number, r: number) => `${z} floors · ${e} enemies · ${r} collectibles.`,
    aria: (n: string) => `${n} guide`, summary: (n: string) => `${n} guide — floors, endings, bosses, squads, collectibles`,
    intro: (n: string, f: boolean) => `Floor layout, ending conditions, boss operations, starting squads, difficulty levels and collectibles of the Arknights Integrated Strategies theme "${n}"${f ? " (CN server preview — not yet on Global)" : ""}, from the game data.`,
    zones: "Floors", hidden: "Hidden floor", floor: (n: number) => `Floor ${n}`, endings: "Endings and how to reach them", bosses: "Boss operations", bands: "Squads",
    diff: "Difficulty", grade: (g: number) => `Difficulty ${g}`, relics: (n: number) => `${n} collectibles`,
  },
  ja: {
    hubAria: "統合戦略の案内", hubSummary: "アークナイツ統合戦略のテーマ一覧・攻略案内",
    hubP: "アークナイツ統合戦略（ローグライク）のテーマごとの階層・ノード、敵図鑑（難易度別ステータス）、秘宝、エンディング条件をゲームデータのまま整理しています。上でテーマを選ぶか、下のテーマ名から開いてください。",
    future: "（中国版先行）", counts: (z: number, e: number, r: number) => `階層${z} · 敵${e}種 · 秘宝${r}個。`,
    aria: (n: string) => `${n} 攻略まとめ`, summary: (n: string) => `${n} 攻略まとめ — 階層・エンディング・ボス・分隊・秘宝一覧`,
    intro: (n: string, f: boolean) => `アークナイツ統合戦略「${n}」${f ? "（中国版先行 — 日本版未実装）" : ""}の階層構成、エンディング条件、ボス作戦、初期分隊、難易度、秘宝をゲームデータから整理しました。`,
    zones: "階層構成", hidden: "隠し階層", floor: (n: number) => `第${n}層`, endings: "エンディングと条件", bosses: "ボス作戦", bands: "分隊",
    diff: "難易度", grade: (g: number) => `難易度${g}`, relics: (n: number) => `秘宝 ${n}個`,
  },
};

/** /rogue — 테마 목록 */
export function RogueHubSeo({ lang = "ko" }: { lang?: SeoLang }) {
  const L = T[lang];
  return (
    <section className="page-seo" aria-label={L.hubAria}>
      <details>
        <summary>{L.hubSummary}</summary>
        <p>{L.hubP}</p>
        <ul>
          {Object.entries(INDEX).map(([id, e]) => {
            const x = e[lang] ?? e.ko;
            return <li key={id}><a href={`${BASE[lang]}/rogue/is${id.split("_")[1]}`}>{x.name}</a>{TOPICS.ko[id]?.future ? L.future : ""} — {L.counts(x.zones, x.enemies, x.relics)} {oneLine(x.line)}</li>;
          })}
        </ul>
      </details>
    </section>
  );
}

/** /rogue/isN — 그 테마 정리 */
export function RogueTopicSeo({ slug, lang = "ko" }: { slug: string; lang?: SeoLang }) {
  const L = T[lang];
  const id = `rogue_${slug.replace(/^is/, "")}`;
  const t = TOPICS[lang][id] ?? TOPICS.ko[id];
  if (!t) return null;
  const zones = t.zones.filter((z) => !z.variant);
  const bosses = t.stages.filter((s) => s.kind === "boss");
  const normal = t.difficulties.filter((d) => d.mode === "NORMAL");
  return (
    <section className="page-seo" aria-label={L.aria(t.name)}>
      <details>
        <summary>{L.summary(t.name)}</summary>
        <p>{L.intro(t.name, !!TOPICS.ko[id]?.future)} {oneLine(t.line)}</p>

        <h2>{L.zones}</h2>
        <ul>{zones.map((z) => <li key={z.num}>{z.hidden ? L.hidden : L.floor(z.num)} {z.name}{z.desc ? ` — ${oneLine(z.desc)}` : ""}</li>)}</ul>

        <h2>{L.endings}</h2>
        <dl>{t.endings.map((e) => (
          <div key={e.name}><dt>{e.name}</dt><dd>{(e.cond?.length ? e.cond : [e.desc]).map(oneLine).filter(Boolean).join(" ")}</dd></div>
        ))}</dl>

        {bosses.length > 0 && <>
          <h2>{L.bosses}</h2>
          <ul>{bosses.map((s, i) => <li key={`${s.code}-${i}`}>{s.code ? `${s.code} ` : ""}{s.name}</li>)}</ul>
        </>}

        <h2>{L.bands}</h2>
        <ul>{t.bands.map((b, i) => <li key={i}>{b.name}{b.usage ? ` — ${oneLine(b.usage)}` : ""}</li>)}</ul>

        {normal.length > 0 && <>
          <h2>{L.diff}</h2>
          <ul>{normal.map((d) => <li key={d.grade}>{L.grade(d.grade)} {d.name}{d.rule ? ` — ${oneLine(d.rule)}` : ""}</li>)}</ul>
        </>}

        <h2>{L.relics(t.relics.length)}</h2>
        <p>{t.relics.map((r) => r.name).join(" · ")}</p>
      </details>
    </section>
  );
}
