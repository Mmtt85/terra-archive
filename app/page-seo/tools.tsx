// 도구 화면 서버 안내 — 가챠·육성·인프라·작전 시뮬레이터, 푸터 위 접는 칸 (2026-10-15, 사용자 지시 "전부 다 해야돼").
// 이 화면들은 계산기 본체가 브라우저에서 늦게 그려져 서버 HTML 에 본문이 거의 없었다(127~948자). 쓰는 법·규칙을 HTML 에 싣는다. 세 언어.
// 수치는 화면이 쓰는 것과 같은 곳에서 — 가챠 확률·5성 보장은 gacha-pool.json(게임 gacha_table), 천장·픽업 비율은 app/gacha.tsx 상수와 같다.
// 문구는 실제 기능과 대조해 썼다 — 화면에 없는 기능을 적지 말 것(가챠 회차 통계·인프라 사무소·3-3-3 배치를 적었다가 지웠다)
import type React from "react";
import pool from "../data/gacha-pool.json";
import costs from "../data/costs.json";
import operatorsData from "../data/operators.json";
import stagesKo from "../data/stages.json";
import stagesEn from "../data/stages.en.json";
import stagesJa from "../data/stages.ja.json";
import { BASE, type SeoLang } from "./locale";

const P = pool as { rates: Record<"3" | "4" | "5" | "6", number>; guarantee5: number; pool: Record<string, string[]> };
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const NUM_LOCALE: Record<SeoLang, string> = { ko: "ko-KR", en: "en-US", ja: "ja-JP" };

function Box({ label, summary, children }: { label: string; summary: string; children: React.ReactNode }) {
  return (
    <section className="page-seo" aria-label={label}>
      <details>
        <summary>{summary}</summary>
        {children}
      </details>
    </section>
  );
}

// ── 헤드헌팅 시뮬레이터 ──
const r = P.rates;
const counts = { 6: P.pool["6"].length, 5: P.pool["5"].length, 4: P.pool["4"].length, 3: P.pool["3"].length };
const GACHA = {
  ko: {
    label: "헤드헌팅 시뮬레이터 안내", summary: "헤드헌팅 시뮬레이터 사용 방법 · 확률과 천장 규칙", how: "사용 방법", rules: "확률과 천장",
    p: "배너(통상·한정·커널)를 고르고 픽업 오퍼레이터를 넣은 뒤 1회·10회·100회·300회 헤드헌팅을 돌려 봅니다. 나온 6★는 ‘6성 기록’에 모이고, 결과는 이미지로 저장하거나 복사할 수 있습니다. 이벤트 배너를 고르면 그 이벤트의 신규 5·6★로 픽업이 채워집니다.",
    li: [
      `기본 확률 — 6★ ${pct(r["6"])} · 5★ ${pct(r["5"])} · 4★ ${pct(r["4"])} · 3★ ${pct(r["3"])} (게임 데이터)`,
      "천장 — 6★ 없이 50회를 넘기면 1회마다 6★ 확률이 2%씩 오르고, 나머지 성급은 비율대로 줄어듭니다. 6★가 나오면 처음으로 돌아갑니다.",
      `첫 ${P.guarantee5}회 안에 5★ 이상 1명 보장`,
      "픽업 비율 — 6★가 나왔을 때 통상 배너는 50%, 한정 배너는 70%가 픽업 오퍼레이터, 5★는 50%가 픽업입니다. 픽업이 여럿이면 똑같이 나눕니다.",
      "커널 배너는 5·6★가 커널 오퍼레이터에서만, 3·4★는 일반 풀에서 나옵니다.",
    ],
    pool: `헤드헌팅 풀: 6★ ${counts[6]}명 · 5★ ${counts[5]}명 · 4★ ${counts[4]}명 · 3★ ${counts[3]}명 (한정·콜라보 제외).`,
  },
  en: {
    label: "Headhunting simulator guide", summary: "How to use the Headhunting simulator · Rates and pity", how: "How to use", rules: "Rates and pity",
    p: "Pick a banner (Standard, Limited or Kernel), set the rate-up operators and run 1, 10, 100 or 300 pulls. Every 6★ you get is collected in the 6★ log, and you can save or copy the results as an image. Choosing an event banner fills the rate-ups with that event's new 5★ and 6★ operators.",
    li: [
      `Base rates — 6★ ${pct(r["6"])} · 5★ ${pct(r["5"])} · 4★ ${pct(r["4"])} · 3★ ${pct(r["3"])} (game data)`,
      "Pity — after 50 pulls without a 6★, the 6★ rate rises by 2% per pull and the other rarities shrink in proportion. It resets when a 6★ appears.",
      `One 5★ or higher guaranteed within the first ${P.guarantee5} pulls`,
      "Rate-up share — when a 6★ appears it is a rate-up operator 50% of the time on Standard banners and 70% on Limited banners; 5★ rate-ups get 50%. Several rate-ups split it evenly.",
      "On Kernel banners, 5★ and 6★ come only from Kernel operators; 3★ and 4★ come from the regular pool.",
    ],
    pool: `Headhunting pool: ${counts[6]} 6★ · ${counts[5]} 5★ · ${counts[4]} 4★ · ${counts[3]} 3★ (limited and collab excluded).`,
  },
  ja: {
    label: "ヘッドハンティング シミュレーターの案内", summary: "ヘッドハンティング シミュレーターの使い方・確率と天井", how: "使い方", rules: "確率と天井",
    p: "バナー（通常・限定・カーネル）を選び、ピックアップのオペレーターを入れて1回・10回・100回・300回のヘッドハンティングを回します。出た★6は「★6記録」にまとまり、結果は画像として保存・コピーできます。イベントバナーを選ぶと、そのイベントの新★5・★6がピックアップに入ります。",
    li: [
      `基本確率 — ★6 ${pct(r["6"])} · ★5 ${pct(r["5"])} · ★4 ${pct(r["4"])} · ★3 ${pct(r["3"])}（ゲームデータ）`,
      "天井 — ★6が出ないまま50回を超えると、1回ごとに★6の確率が2%ずつ上がり、ほかのレアリティは比率どおりに下がります。★6が出るとリセットされます。",
      `最初の${P.guarantee5}回以内に★5以上を1体保証`,
      "ピックアップの割合 — ★6が出たとき、通常バナーは50%、限定バナーは70%がピックアップ、★5は50%がピックアップです。ピックアップが複数なら均等に分けます。",
      "カーネルバナーでは★5・★6はカーネルオペレーターからのみ、★3・★4は通常のプールから出ます。",
    ],
    pool: `ヘッドハンティングのプール: ★6 ${counts[6]}体 · ★5 ${counts[5]}体 · ★4 ${counts[4]}体 · ★3 ${counts[3]}体（限定・コラボを除く）。`,
  },
};

export function GachaSeo({ lang = "ko" }: { lang?: SeoLang }) {
  const L = GACHA[lang];
  return (
    <Box label={L.label} summary={L.summary}>
      <h2>{L.how}</h2>
      <p>{L.p}</p>
      <h2>{L.rules}</h2>
      <ul>{L.li.map((x) => <li key={x}>{x}</li>)}</ul>
      <p>{L.pool}</p>
    </Box>
  );
}

// ── 육성 비용 계산기 ──
// 성급·정예화 단계마다 Lv.1 → 만렙 레벨업에 드는 경험치·용문폐 — costs.json 의 오퍼별 levels(정예화 승급 비용은 빠진 레벨업분)에서
// 성급마다 가장 흔한 값(= 그 성급 표준)을 고른다
const LEVEL_TABLE = (() => {
  const rarity = new Map((operatorsData as unknown as { id: string; rarity: number }[]).map((o) => [o.id, o.rarity]));
  const count = new Map<string, number>();
  for (const [id, v] of Object.entries((costs as unknown as { ops: Record<string, { levels: { lmd: number; maxLv: number; exp: number }[] }> }).ops)) {
    const rr = rarity.get(id);
    if (!rr) continue;
    v.levels.forEach((l, i) => { const k = `${rr}|${i}|${l.maxLv}|${l.exp}|${l.lmd}`; count.set(k, (count.get(k) ?? 0) + 1); });
  }
  const best = new Map<string, [string, number]>();
  for (const [k, n] of count) { const [rr, i] = k.split("|"); const key = `${rr}|${i}`; if (!best.has(key) || best.get(key)![1] < n) best.set(key, [k, n]); }
  return [...best.values()].map(([k]) => { const [rr, i, maxLv, exp, lmd] = k.split("|").map(Number); return { r: rr, i, maxLv, exp, lmd }; })
    .sort((a, b) => b.r - a.r || a.i - b.i);
})();

const UPGRADE = {
  ko: {
    label: "육성 비용 계산기 안내", summary: "오퍼레이터 육성 비용 계산기 사용 방법", how: "사용 방법",
    p1: "검색창에서 오퍼레이터를 추가하면 레벨·정예화(게임 순서대로 E0 만렙 → 정예화1 → E1 만렙 → 정예화2 → E2 만렙), 스킬 레벨 2~7, 스킬별 특화 1~3, 모듈별 1~3단계가 따로 나옵니다. 목표 단계를 누르면 앞 단계까지 합쳐 필요한 용문폐·경험치·재료 총량을 계산합니다. 경험치는 고급작전기록(2000 EXP) 개수로 환산해 보여 줍니다.",
    p2: "여러 오퍼레이터를 담으면 재료 합계가 한곳에 모이고, 재료를 누르면 파밍 스테이지와 획득 방법이 열립니다. ‘전체 2정 Lv.60’, ‘전체 최대 육성’으로 한 번에 목표를 정할 수 있고, 내 정보로 로그인하면 지금 육성 상태부터 목표까지만 계산합니다.",
    table: "성급별 레벨업 비용 (Lv.1 → 만렙)", tableP: "정예화 단계마다 Lv.1에서 그 단계 만렙까지 올리는 데 드는 경험치와 용문폐입니다. 정예화 승급에 드는 용문폐·재료는 오퍼레이터마다 달라 계산기에서 확인하세요.",
    row: (x: (typeof LEVEL_TABLE)[number], n: (v: number) => string) => `${x.r}★ 정예화 ${x.i} — Lv.1 → ${x.maxLv}: 경험치 ${n(x.exp)} · 용문폐 ${n(x.lmd)}`,
  },
  en: {
    label: "Upgrade cost calculator guide", summary: "How to use the Operator upgrade cost calculator", how: "How to use",
    p1: "Add operators from the search box and you get separate rows for levels and promotion (in game order: E0 max → Elite 1 → E1 max → Elite 2 → E2 max), skill levels 2–7, Specialization 1–3 for each skill and module stages 1–3. Click a target stage and it adds up every earlier stage to total the LMD, EXP and materials you need. EXP is shown as a count of Strategic Battle Records (2,000 EXP each).",
    p2: "Materials from every operator you add are totalled in one place, and clicking a material opens its farming stages and other sources. 'All E2 Lv.60' and 'Max everything' set targets in one go, and if you log in via My Info it only counts from your current progress to the target.",
    table: "Level-up cost by rarity (Lv.1 → max)", tableP: "EXP and LMD to go from Lv.1 to the level cap of each promotion phase. Promotion LMD and materials differ per operator, so check them in the calculator.",
    row: (x: (typeof LEVEL_TABLE)[number], n: (v: number) => string) => `${x.r}★ Elite ${x.i} — Lv.1 → ${x.maxLv}: ${n(x.exp)} EXP · ${n(x.lmd)} LMD`,
  },
  ja: {
    label: "育成コスト計算機の案内", summary: "オペレーター育成コスト計算機の使い方", how: "使い方",
    p1: "検索欄からオペレーターを追加すると、レベル・昇進（ゲームの順に 昇進0最大 → 昇進1 → 昇進1最大 → 昇進2 → 昇進2最大）、スキルレベル2〜7、スキルごとの特化1〜3、モジュールごとの1〜3段階が別々に並びます。目標の段階を押すと、その前の段階まで合わせて必要な龍門幣・経験値・素材の合計を計算します。経験値は上級作戦記録（2000 EXP）の個数に換算して表示します。",
    p2: "複数のオペレーターを入れると素材の合計が一か所にまとまり、素材を押すと周回ステージと入手方法が開きます。「全員 昇進2 Lv.60」「全員 最大育成」で目標を一度に決められ、マイ情報でログインすると今の育成状況から目標までだけを計算します。",
    table: "レアリティ別レベルアップ費用（Lv.1 → 最大）", tableP: "昇進段階ごとに Lv.1 からその段階の最大レベルまで上げるのに必要な経験値と龍門幣です。昇進そのものに必要な龍門幣・素材はオペレーターごとに違うので計算機で確認してください。",
    row: (x: (typeof LEVEL_TABLE)[number], n: (v: number) => string) => `★${x.r} 昇進${x.i} — Lv.1 → ${x.maxLv}: 経験値 ${n(x.exp)} · 龍門幣 ${n(x.lmd)}`,
  },
};

export function UpgradeSeo({ lang = "ko" }: { lang?: SeoLang }) {
  const L = UPGRADE[lang];
  const n = (v: number) => v.toLocaleString(NUM_LOCALE[lang]);
  return (
    <Box label={L.label} summary={L.summary}>
      <h2>{L.how}</h2>
      <p>{L.p1}</p>
      <p>{L.p2}</p>
      <h2>{L.table}</h2>
      <p>{L.tableP}</p>
      <ul>{LEVEL_TABLE.map((x) => <li key={`${x.r}-${x.i}`}>{L.row(x, n)}</li>)}</ul>
    </Box>
  );
}

// ── 기반시설 자동편성기 ──
const INFRA = {
  ko: {
    label: "기반시설 자동편성기 안내", summary: "기반시설(인프라) 자동편성기 사용 방법", how: "사용 방법",
    p1: "보유한 오퍼레이터와 정예화·레벨만 알려 주면 제조소·무역소·발전소·제어 센터·숙소·응접실·가공소·훈련실 배치를 기반시설 스킬 시너지까지 따져 자동으로 짜 줍니다. 하루 용문폐·작전기록 산출과 드론 회복량을 함께 계산합니다.",
    in: "보유 오퍼레이터 입력", inP: "직접 체크하거나, MAA 결과 파일·게임 화면 스크린샷·게임 계정 로그인으로 한 번에 가져올 수 있습니다.",
    more: "그 밖의 기능", li: ["육성 추천 — 정예화하면 편성 효율이 오르는 오퍼레이터를 이득이 큰 순서로", "생산 우선순위·기지 배치(2-4-3·1-5-3·2-5-2·직접 구성) 바꾸기, A조·B조 교대 편성", "MAA 기반시설 커스텀 JSON 내보내기, 편성을 이미지로 저장"],
  },
  en: {
    label: "Base auto-planner guide", summary: "How to use the Base (RIIC) auto-planner", how: "How to use",
    p1: "Tell it which operators you own and their promotion and level, and it builds assignments for the Factory, Trading Post, Power Plant, Control Center, Dormitory, Reception Room, Workshop and Training Room, accounting for base skill synergies. It also works out daily LMD and Battle Record output and drone recovery.",
    in: "Entering your operators", inP: "Tick them by hand, or import them all at once from an MAA result file, a game screenshot or by logging in to your game account.",
    more: "Other features", li: ["Promotion picks — operators whose promotion raises your base output the most, in order", "Change production priority and base layout (2-4-3, 1-5-3, 2-5-2 or custom), with A/B shift rotation", "Export MAA custom base JSON, save the assignment as an image"],
  },
  ja: {
    label: "基地自動編成の案内", summary: "基地（インフラ）自動編成の使い方", how: "使い方",
    p1: "所持オペレーターと昇進・レベルを入れるだけで、製造所・貿易所・発電所・制御中枢・宿舎・応接室・加工所・訓練室の配置を、基地スキルのシナジーまで考えて自動で組みます。1日の龍門幣・作戦記録の産出とドローン回復量もあわせて計算します。",
    in: "所持オペレーターの入力", inP: "手でチェックするほか、MAAの結果ファイル・ゲーム画面のスクリーンショット・ゲームアカウントへのログインでまとめて取り込めます。",
    more: "そのほかの機能", li: ["育成おすすめ — 昇進させると編成効率が上がるオペレーターを効果の大きい順に", "生産の優先度・基地配置（2-4-3・1-5-3・2-5-2・カスタム）の変更、A班・B班の交代編成", "MAA基地カスタムJSONの書き出し、編成を画像で保存"],
  },
};

export function InfraSeo({ lang = "ko" }: { lang?: SeoLang }) {
  const L = INFRA[lang];
  return (
    <Box label={L.label} summary={L.summary}>
      <h2>{L.how}</h2>
      <p>{L.p1}</p>
      <h2>{L.in}</h2>
      <p>{L.inP}</p>
      <h2>{L.more}</h2>
      <ul>{L.li.map((x) => <li key={x}>{x}</li>)}</ul>
    </Box>
  );
}

// ── 작전 시뮬레이터 ──
type StageRow = { id: string; code: string; name: string; z: number; t: string };
const mainOf = (doc: unknown) => {
  const d = doc as { zones: string[]; stages: StageRow[] };
  const by = new Map<number, StageRow[]>();
  for (const st of d.stages) if (st.t === "MAIN") by.set(st.z, [...(by.get(st.z) ?? []), st]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([z, list]) => ({ zone: d.zones[z] ?? "", list }));
};
const MAIN: Record<SeoLang, ReturnType<typeof mainOf>> = { ko: mainOf(stagesKo), en: mainOf(stagesEn), ja: mainOf(stagesJa) };
const SIM = {
  ko: {
    label: "작전 시뮬레이터 안내", summary: "작전 시뮬레이터 사용 방법", how: "사용 방법",
    p1: "작전을 검색해 고르면 적이 몇 초에 어느 출현 지점에서 나와 어떤 경로로 어디에 들어가는지 스폰 타임라인을 지도 위에 재생합니다. 배속을 바꾸거나 원하는 구간으로 건너뛸 수 있고, 같은 작전의 등장 적·드랍도 함께 봅니다.",
    p2: "메인 스토리·이벤트·통합전략 전투 노드까지 작전 도감에 있는 작전이면 모두 재생할 수 있습니다.", main: "메인 스토리 작전",
  },
  en: {
    label: "Operation simulator guide", summary: "How to use the Operation simulator", how: "How to use",
    p1: "Search for an operation and it plays the spawn timeline on the map — when each enemy appears, from which spawn point, which route it takes and where it goes in. Change the speed or jump to any point, and see the operation's enemies and drops alongside.",
    p2: "Any operation in the Operation index can be played, from the main story and events to Integrated Strategies battle nodes.", main: "Main story operations",
  },
  ja: {
    label: "作戦シミュレーターの案内", summary: "作戦シミュレーターの使い方", how: "使い方",
    p1: "作戦を検索して選ぶと、敵が何秒にどの出現地点から現れ、どの経路でどこへ入るかを、マップ上でスポーンのタイムラインとして再生します。倍速の切り替えや好きな区間への移動ができ、同じ作戦の出現敵・ドロップもあわせて見られます。",
    p2: "メインストーリー・イベント・統合戦略の戦闘ノードまで、作戦図鑑にある作戦ならすべて再生できます。", main: "メインストーリーの作戦",
  },
};

export function SimSeo({ lang = "ko" }: { lang?: SeoLang }) {
  const L = SIM[lang];
  return (
    <Box label={L.label} summary={L.summary}>
      <h2>{L.how}</h2>
      <p>{L.p1}</p>
      <p>{L.p2}</p>
      <h2>{L.main}</h2>
      <dl>{MAIN[lang].map((g) => (
        <div key={g.zone}><dt>{g.zone}</dt><dd>{g.list.map((st, i) => <span key={st.id}>{i ? " · " : ""}<a href={`${BASE[lang]}/stages/${st.id}`}>{st.code} {st.name}</a></span>)}</dd></div>
      ))}</dl>
    </Box>
  );
}
