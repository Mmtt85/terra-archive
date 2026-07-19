"use client";

import { useSyncExternalStore } from "react";
import { useI18n, rich, type Locale } from "./i18n";
import type { Tab } from "./home";

// 소개 페이지 — 홍보·개발사 후원 문의용. 각 기능이 무엇이고 어떤 상황에 쓰는지 3개 언어로 설명.
// 콘텐츠 분량이 많아 공유 사전(i18n) 대신 로케일별 구조 객체로 관리하고, **굵게**는 rich()로 렌더.

type Feature = {
  tab: Tab;
  icon: string;
  name: string;
  summary: string;
  bullets: string[];
  highlight?: string; // 강조 박스 (인프라 플래너 90/10 어필)
};

// 기능별 스크린샷 (한국어 UI · 헤드리스 캡처본, 데스크톱+모바일 한 쌍). 로케일 공용 — 탭 키로 매핑.
type ShotPair = { d: string; m: string };
const SHOTS: Partial<Record<Tab, ShotPair>> = {
  archive: { d: "/about/archive.webp", m: "/about/archive-m.webp" },
  planner: { d: "/about/planner.webp", m: "/about/planner-m.webp" },
  recruit: { d: "/about/recruit.webp", m: "/about/recruit-m.webp" },
  farm: { d: "/about/farm.webp", m: "/about/farm-m.webp" },
  story: { d: "/about/story.webp", m: "/about/story-m.webp" },
  rogue: { d: "/about/rogue.webp", m: "/about/rogue-m.webp" },
};

// 다크모드 구독 — html.dark 클래스를 관찰해 테마 토글 시 실시간 리렌더.
// SSR/하이드레이션 스냅샷은 null("아직 모름") — 첫 페인트에선 이미지 없이 빈 박스만 두고,
// 클라이언트에서 테마가 확정된 직후 곧바로 맞는 캡처본을 넣는다. 밝은→어두운 플래시 방지.
function subscribeDark(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}
function useTheme(): "light" | "dark" | null {
  return useSyncExternalStore(
    subscribeDark,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => null,
  );
}

// 데스크톱 스크린샷과 모바일 화면을 겹치지 않게 나란히 놓아 반응형 UI를 한눈에 보여준다.
// 래퍼 div에 고정 aspect-ratio를 주어 로드 전에도 공간을 예약(CLS 0)하고, 774:226 플렉스 비율로
// 데스크톱·모바일 캡처의 렌더 높이를 동일하게 맞춘다. 다크모드일 땐 다크 캡처본(-dark)으로 스왑.
function ShotFrame({ shot, alt, cap }: { shot: ShotPair; alt: string; cap?: string }) {
  const theme = useTheme();
  const src = (p: string) => (theme === "dark" ? p.replace(/\.webp$/, "-dark.webp") : p);
  return (
    <figure className="about-shot-fig">
      <div className="about-shots">
        <div className="about-shot about-shot-d">
          {theme && <img src={src(shot.d)} alt={alt} width={1200} height={760} loading="lazy" decoding="async" />}
        </div>
        <div className="about-shot about-shot-m" aria-hidden>
          {theme && <img src={src(shot.m)} alt="" width={440} height={952} loading="lazy" decoding="async" />}
        </div>
      </div>
      {cap && <figcaption className="about-shot-cap">{cap}</figcaption>}
    </figure>
  );
}

type Content = {
  kicker: string;
  title: string;
  tagline: string;
  intro: string;
  featureLead: string;
  features: Feature[];
  chronicleCap: string; // 스토리 카드 안 테라 연대기 스크린샷 캡션
  future: { title: string; body: string };
  data: { title: string; body: string };
  disclaimer: { title: string; body: string };
  cta: string;
};

const CONTENT: Record<Locale, Content> = {
  ko: {
    kicker: "ABOUT",
    title: "테라 아카이브 소개",
    tagline: "명일방주(Arknights) 한국 서버 도우미 · 한국어 / English / 日本語",
    intro:
      "테라 아카이브는 명일방주 독타를 위한 비영리 팬 도구 모음입니다. 오퍼레이터 자료 조사부터 기반시설 편성, 공개모집, 재료 파밍·육성 계획, 스토리 요약까지 — 게임 데이터를 직접 파싱해 자동 파이프라인으로 항상 최신 상태를 유지합니다. 설치·로그인 없이 웹에서 바로 쓸 수 있습니다.",
    featureLead: "여섯 가지 도구가 있습니다. 카드를 누르면 해당 기능으로 이동합니다.",
    features: [
      {
        tab: "planner", icon: "⌂", name: "인프라 자동편성기",
        summary: "보유한 오퍼레이터만 입력하면 243 기지(제조소·무역소·발전소·제어 센터·응접실 등)의 A/B 2교대 편성을 자동으로 짜줍니다.",
        highlight:
          "**모든 걸 100% 대신 짜주는 도구가 아닙니다.** 시너지 세트·시설 간 포인트 시스템·교대 정책까지 반영해 **큰 틀의 90% 이상을 자동으로 잡아주고**, 개인 취향과 특수 상황에 맞춘 **나머지 10%는 독타가 직접 손봐 완성**하도록 설계했습니다. 방별 수동 편집, 빈칸만 채우기, 오퍼별 정예화 조정, 우선 생산 모드 전환을 모두 지원합니다.",
        bullets: [
          "순금 우선 / 작전기록 우선 / 밸런스 등 우선 생산 모드 선택",
          "쉐라그 무역소 세트 같은 진영 시너지와 속세의 화식 등 토큰 시스템 자동 판정",
          "MAA(MaaAssistantArknights) 오퍼 박스 인식 결과를 불러와 보유·정예화 일괄 설정",
          "편성 내보내기/불러오기, 미래시(중국 선행) 오퍼 포함 계산 지원",
        ],
      },
      {
        tab: "archive", icon: "▤", name: "오퍼 백과사전",
        summary: "모든 오퍼레이터의 스탯·스킬·재능·잠재·모듈·기반시설 스킬을 한곳에서 봅니다.",
        bullets: [
          "진영·직군·세부 직군·전투 태그·시너지 컨셉으로 필터링, 이름·별명·효과로 검색",
          "정예화 단계별 스탯과 사거리, 스킬 SP·지속시간, 모듈 스탯·효과까지 상세 표시",
          "시너지 팟(컨셉덱) 태그로 함께 쓰기 좋은 오퍼를 묶어서 확인",
          "커뮤니티가 제보한 별명을 집계해 검색에 반영 — 별명으로도 오퍼를 찾습니다",
        ],
      },
      {
        tab: "recruit", icon: "◎", name: "공채 도우미",
        summary: "공개모집(공채) 태그 조합으로 확정·고성급 오퍼레이터가 나오는 경우를 계산합니다.",
        bullets: [
          "선택한 태그 조합마다 등장 가능한 오퍼레이터와 최소 보장 성급을 표시",
          "고성급 확정 조합을 우선순위로 정렬해 놓치지 않게 안내",
        ],
      },
      {
        tab: "farm", icon: "◈", name: "파밍·육성 시뮬",
        summary: "재료별 최적 파밍 스테이지와 육성에 드는 재료 총량을 함께 계산합니다.",
        bullets: [
          "재료마다 어느 스테이지가 이성 효율이 가장 좋은지 펭귄 물류 실측 드랍률로 표시",
          "정예화·스킬·특화·모듈·레벨업에 필요한 용문폐·경험치·재료 총량을 오퍼별로 합산",
          "여러 오퍼를 담아 한 번에 계획 — 무엇을 얼마나 파밍해야 하는지 바로 확인",
        ],
      },
      {
        tab: "story", icon: "✦", name: "스토리",
        summary: "이벤트·메인스토리를 전문(풀 스크립트)과 AI 요약, 두 가지 방식으로 읽습니다.",
        bullets: [
          "전문 보기 — 인게임 대사 전체를 컷씬·화자 얼굴과 함께, 게임 밖에서 그대로 정주행",
          "본문에 등장하는 오퍼레이터·용어는 오른쪽 인물 레일과 자동 연결, 클릭하면 상세 확인",
          "바쁜 독타를 위한 AI 요약 — 스크립트 전문을 정독하고 10분 분량으로 줄거리 정리",
          "테라 연대기 타임라인과 테마별 묶음 보기 — 테마 링크는 URL로 바로 공유",
        ],
      },
      {
        tab: "rogue", icon: "❖", name: "통합전략 가이드",
        summary: "통합전략(IS) 전 테마의 층 구성·전투 노드·적 도감·유물·엔딩 조건을 난이도별로 정리합니다. 한국어·영어·일본어 완전 현지화.",
        bullets: [
          "팬텀 & 크림슨 솔리테어부터 쉐이의 기이한 계원까지 정식 5개 테마 전부 + 중국 선행 테마(침몰자의 흑류수해)는 미래시 토글로 미리 보기",
          "층별 노드 맵과 인게임 맵 미리보기, 등장 적·스폰 수·긴급 작전 배율, 우연한 만남의 출현 층(위키 실측)까지 표시",
          "적 도감은 난이도 등급을 바꾸면 스탯이 실시간으로 재계산",
          "유물·조우 이벤트·엔딩 해금 조건을 클릭 가능한 상호 링크로 연결 — 노드가 실제로 뭘 하는지 기능 설명 병기",
        ],
      },
    ],
    chronicleCap: "테라 연대기 — 이벤트·메인스토리·통합 전략을 테라력 연표로",
    future: {
      title: "미래시 데이터",
      body:
        "헤더의 '미래시 데이터 포함'을 켜면 한국 서버에 아직 나오지 않은(중국 서버 선행) 오퍼레이터·재료·이벤트까지 미리 볼 수 있습니다. 미실장 텍스트는 정식 출시 전까지 비공식 AI 번역으로 제공하며 그 사실을 명확히 표시하고, 한국 서버 출시가 데이터에 반영되면 자동으로 공식 데이터로 교체됩니다.",
    },
    data: {
      title: "데이터와 갱신",
      body:
        "데이터는 커뮤니티 게임 데이터 추출본(ArknightsGamedata)과 펭귄 물류(Penguin Statistics)의 실측 드랍률을 기반으로 합니다. 새 버전이 올라오면 자동 파이프라인이 이를 감지해 오퍼레이터·기반시설·공채·파밍·육성 데이터를 함께 재생성하므로, 업데이트 후에도 빠르게 최신 상태가 됩니다.",
    },
    disclaimer: {
      title: "비공식 팬 사이트 안내",
      body:
        "테라 아카이브는 Hypergryph 및 Yostar와 무관한 비공식·비영리 팬 사이트입니다. 게임 내 이미지·명칭·스토리 등 모든 저작권은 원저작자에게 있으며, 팬 콘텐츠 가이드라인을 존중합니다. 수익을 목적으로 하지 않습니다.",
    },
    cta: "오류 제보나 기능 제안은 각 페이지의 피드백 버튼으로 보내주세요.",
  },
  en: {
    kicker: "ABOUT",
    title: "About Terra Archive",
    tagline: "An Arknights (KR-server) companion · 한국어 / English / 日本語",
    intro:
      "Terra Archive is a non-commercial fan toolkit for Arknights players (Doctors). From researching operators to planning your base, recruitment, farming and upgrade budgeting, and catching up on the story — it parses the game data directly and an automated pipeline keeps everything up to date. No install, no login; it runs right in the browser.",
    featureLead: "Six tools in one. Tap a card to jump to that feature.",
    features: [
      {
        tab: "planner", icon: "⌂", name: "Base Auto-Planner",
        summary: "Just enter the operators you own and it automatically builds the whole A/B two-shift assignment for the 243 base (factories, trading posts, power plants, control center, reception room, and more) for you.",
        highlight:
          "**It isn't a tool that does 100% for you.** By accounting for synergy sets, cross-facility point systems, and shift policy, it **locks in 90%+ of the overall framework automatically** — and is designed so **you, the Doctor, finish the remaining 10%** to fit your preferences and edge cases. Per-room manual edits, fill-empty-slots, per-operator Elite adjustment, and production-priority modes are all supported.",
        bullets: [
          "Choose a production priority: Gold-first, Battle Record–first, or Balanced",
          "Auto-detects faction synergies (e.g. the Kjerag trading-post set) and token systems (Worldly Plight, etc.)",
          "Import your MAA (MaaAssistantArknights) operator-box scan to set ownership and Elite at once",
          "Export/import assignments; can include future (CN-first) operators in the calculation",
        ],
      },
      {
        tab: "archive", icon: "▤", name: "Operator Encyclopedia",
        summary: "Every operator's stats, skills, talents, potentials, modules, and base skills in one place.",
        bullets: [
          "Filter by faction, class, subclass, combat tags, and synergy concepts; search by name, nickname, or effect",
          "Per–Elite-phase stats and range, skill SP and duration, module stats and effects in full detail",
          "Synergy (concept-deck) tags group operators that work well together",
          "Community-submitted nicknames are tallied and made searchable — find operators by nickname too",
        ],
      },
      {
        tab: "recruit", icon: "◎", name: "Recruitment Helper",
        summary: "Calculates which guaranteed or high-rarity operators a recruitment tag combination can yield.",
        bullets: [
          "For each selected tag combo, shows the possible operators and the minimum guaranteed rarity",
          "Ranks guaranteed high-rarity combos first so you don't miss them",
        ],
      },
      {
        tab: "farm", icon: "◈", name: "Farming & Upgrade Sim",
        summary: "Finds the best farming stage per material and totals the materials an upgrade will cost.",
        bullets: [
          "Best sanity-efficiency stage per material, based on Penguin Statistics real drop rates",
          "Totals the LMD, EXP, and materials needed for Elite, skills, masteries, modules, and leveling per operator",
          "Queue several operators to plan at once — see exactly what and how much to farm",
        ],
      },
      {
        tab: "story", icon: "✦", name: "Story",
        summary: "Read event and main stories two ways: the full script, or an AI digest.",
        bullets: [
          "Full-script reader — every in-game line with cutscenes and speaker portraits, binge the story outside the game",
          "Operators and terms in the text link to a reference rail on the right — click for details",
          "AI digests for busy Doctors — written from the full script, the plot in about 10 minutes",
          "A Terra chronology timeline plus by-theme grouping — theme links are shareable URLs",
        ],
      },
      {
        tab: "rogue", icon: "❖", name: "Integrated Strategies Guide",
        summary: "Every IS theme's floor layouts, battle nodes, enemy dex, relics, and ending conditions — all difficulty-aware, fully localized in Korean, English, and Japanese.",
        bullets: [
          "All five released themes, from Phantom & Crimson Solitaire to Sui's Garden of Grotesqueries — plus the CN-first theme via the future-data toggle",
          "Node maps per floor with in-game previews, enemy rosters, spawn counts, emergency multipliers, and wiki-verified encounter floors",
          "The enemy dex recalculates stats live as you change the difficulty grade",
          "Relics, encounters, and ending unlock conditions are cross-linked and clickable — with plain explanations of what each node actually does",
        ],
      },
    ],
    chronicleCap: "Terra Chronicle — events, main story, and Integrated Strategies on a Terra-calendar timeline",
    future: {
      title: "Future (unreleased) data",
      body:
        "Turn on 'Include future data' in the header to preview operators, materials, and events not yet on the KR server (CN-first). Unreleased text is provided as an unofficial AI translation until launch — clearly labeled as such — and is automatically replaced with official data once the KR release lands in the source.",
    },
    data: {
      title: "Data & updates",
      body:
        "Data is based on community game-data extracts (ArknightsGamedata) and real drop rates from Penguin Statistics. When a new version ships, an automated pipeline detects it and regenerates the operator, base, recruitment, farming, and upgrade data together — so the site catches up quickly after each update.",
    },
    disclaimer: {
      title: "Unofficial fan site",
      body:
        "Terra Archive is an unofficial, non-commercial fan site unaffiliated with Hypergryph or Yostar. All in-game images, names, and story text remain the property of their respective owners, and we respect the fan-content guidelines. It is not operated for profit.",
    },
    cta: "Report errors or suggest features via the feedback button on each page.",
  },
  ja: {
    kicker: "ABOUT",
    title: "テラアーカイブについて",
    tagline: "アークナイツ（韓国サーバー基準）の補助ツール · 한국어 / English / 日本語",
    intro:
      "テラアーカイブは、アークナイツのプレイヤー（ドクター）のための非営利ファンツール集です。オペレーターの調査から基地編成、公開求人、素材周回・育成の計画、ストーリー要約まで — ゲームデータを直接解析し、自動パイプラインで常に最新の状態を保ちます。インストールもログインも不要、ブラウザですぐに使えます。",
    featureLead: "6つのツールがあります。カードを押すとその機能へ移動します。",
    features: [
      {
        tab: "planner", icon: "⌂", name: "基地自動編成",
        summary: "手持ちのオペレーターを入力するだけで、243基地（製造所・貿易所・発電所・制御中枢・応接室など）のA/B2交代編成を自動で組んでくれます。",
        highlight:
          "**すべてを100%代わりに組むツールではありません。** シナジーセット・施設間のポイントシステム・交代方針まで反映し、**全体の枠組みの90%以上を自動で固め**、好みや特殊な状況に合わせた**残り10%はドクター自身が手直しして仕上げる**ように設計しています。部屋ごとの手動編集、空き枠だけ補充、オペレーター単位の昇進調整、優先生産モードの切替にすべて対応しています。",
        bullets: [
          "純金優先／作戦記録優先／バランスなど、優先生産モードを選択",
          "カジミエーシュ…ではなくクルビア等の陣営シナジー（イェラグ貿易所セット）やトークンシステム（俗世之憂ほか）を自動判定",
          "MAA（MaaAssistantArknights）のオペレーターボックス認識結果を読み込み、所持・昇進を一括設定",
          "編成のエクスポート／インポート、未実装（中国先行）オペレーターを含めた計算に対応",
        ],
      },
      {
        tab: "archive", icon: "▤", name: "オペレーター図鑑",
        summary: "全オペレーターのステータス・スキル・素質・潜在・モジュール・基地スキルを一箇所で確認できます。",
        bullets: [
          "陣営・職分・サブ職分・戦闘タグ・シナジー概念で絞り込み、名前・愛称・効果で検索",
          "昇進段階ごとのステータスと範囲、スキルSP・持続時間、モジュールのステータス・効果まで詳細表示",
          "シナジー（コンセプトデッキ）タグで、相性の良いオペレーターをまとめて確認",
          "ユーザー投稿の愛称を集計して検索に反映 — 愛称でもオペレーターを探せます",
        ],
      },
      {
        tab: "recruit", icon: "◎", name: "公開求人ヘルパー",
        summary: "公開求人タグの組み合わせから、確定・高レアオペレーターが出る場合を計算します。",
        bullets: [
          "選んだタグの組み合わせごとに、出現しうるオペレーターと最低保証レアリティを表示",
          "高レア確定の組み合わせを優先して並べ、見逃さないように案内",
        ],
      },
      {
        tab: "farm", icon: "◈", name: "周回・育成シミュ",
        summary: "素材ごとの最適な周回ステージと、育成に必要な素材の合計をまとめて計算します。",
        bullets: [
          "素材ごとにどのステージが理性効率が良いかを、ペンギン急便の実測ドロップ率で表示",
          "昇進・スキル・特化・モジュール・レベリングに必要な龍門幣・経験値・素材の合計をオペレーター単位で集計",
          "複数のオペレーターをまとめて計画 — 何をどれだけ周回すべきかが一目で分かります",
        ],
      },
      {
        tab: "story", icon: "✦", name: "ストーリー",
        summary: "イベント・メインストーリーを、全文（フルスクリプト）とAI要約の2つの方式で読めます。",
        bullets: [
          "全文ビュー — ゲーム内のセリフ全文をカットシーン・話者の顔と共に、ゲーム外でそのまま一気読み",
          "本文に登場するオペレーター・用語は右側の人物レールと自動連携、クリックで詳細を確認",
          "忙しいドクターのためのAI要約 — スクリプト全文を読み込み、約10分のあらすじに整理",
          "テラ年代記のタイムラインとテーマ別のまとめ表示 — テーマリンクはURLでそのまま共有",
        ],
      },
      {
        tab: "rogue", icon: "❖", name: "統合戦略ガイド",
        summary: "統合戦略（IS）全テーマの階層構成・戦闘ノード・敵図鑑・秘宝・エンディング条件を難易度別に整理。韓国語・英語・日本語に完全対応。",
        bullets: [
          "ファントムと緋き貴石から歳の界園志異まで正式実装5テーマすべて + 中国先行テーマ（沈淪者の黒流樹海）は未実装トグルで先取り",
          "階層ごとのノードマップとゲーム内プレビュー、出現する敵・スポーン数・緊急作戦の倍率、思わぬ遭遇の出現階層（Wiki実測）まで表示",
          "敵図鑑は難易度等級を変えるとステータスをリアルタイムに再計算",
          "秘宝・遭遇イベント・エンディング解放条件をクリック可能な相互リンクで接続 — 各ノードが実際に何をするのかの機能説明つき",
        ],
      },
    ],
    chronicleCap: "テラ年代記 — イベント・メインストーリー・統合戦略をテラ暦の年表で",
    future: {
      title: "未実装（先行）データ",
      body:
        "ヘッダーの「未実装データを含む」をオンにすると、韓国サーバー未実装（中国サーバー先行）のオペレーター・素材・イベントも先に確認できます。未実装テキストは正式実装まで非公式のAI翻訳として提供し、その旨を明示します。韓国サーバーでの実装がデータに反映されると、自動的に公式データへ置き換えられます。",
    },
    data: {
      title: "データと更新",
      body:
        "データはコミュニティのゲームデータ抽出（ArknightsGamedata）と、ペンギン急便（Penguin Statistics）の実測ドロップ率に基づいています。新バージョンが公開されると自動パイプラインがそれを検知し、オペレーター・基地・公開求人・周回・育成のデータをまとめて再生成するため、アップデート後もすばやく最新の状態になります。",
    },
    disclaimer: {
      title: "非公式ファンサイトについて",
      body:
        "テラアーカイブは、HypergryphおよびYostarとは無関係の非公式・非営利ファンサイトです。ゲーム内の画像・名称・ストーリー等の著作権はすべて原著作者に帰属し、ファンコンテンツのガイドラインを尊重します。営利を目的としていません。",
    },
    cta: "不具合の報告や機能の提案は、各ページのフィードバックボタンからお寄せください。",
  },
};

export default function About({ onOpenTab }: { onOpenTab?: (tab: Tab) => void }) {
  const { locale } = useI18n();
  const c = CONTENT[locale];
  return (
    <section className="about" aria-label={c.title}>
      <div className="about-hero">
        <span className="section-no">{c.kicker}</span>
        <h2>{c.title}</h2>
        <p className="about-tagline">{c.tagline}</p>
        <p className="about-intro">{c.intro}</p>
        <ShotFrame shot={{ d: "/about/portal.webp", m: "/about/portal-m.webp" }} alt={c.title} />
      </div>

      <p className="about-lead">{c.featureLead}</p>
      <div className="about-features">
        {c.features.map((f) => (
          <article key={f.tab} className={`about-card${f.highlight ? " featured" : ""}`}>
            <header>
              <span className="about-card-icon" aria-hidden>{f.icon}</span>
              <h3>{f.name}</h3>
            </header>
            {SHOTS[f.tab] && <ShotFrame shot={SHOTS[f.tab]!} alt={f.name} />}
            {/* 테라 연대기는 AI 스토리 요약 기능의 일부 — 스토리 카드 안에 함께 보여준다 */}
            {f.tab === "story" && (
              <ShotFrame shot={{ d: "/about/chronicle.webp", m: "/about/chronicle-m.webp" }} alt={c.chronicleCap} cap={c.chronicleCap} />
            )}
            <p className="about-card-summary">{f.summary}</p>
            {f.highlight && <p className="about-card-highlight">{rich(f.highlight)}</p>}
            <ul className="about-card-bullets">
              {f.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
            {onOpenTab && (
              <button type="button" className="about-card-go" onClick={() => { onOpenTab(f.tab); window.scrollTo({ top: 0 }); }}>
                {f.name} →
              </button>
            )}
          </article>
        ))}
      </div>

      <div className="about-notes">
        {[c.future, c.data, c.disclaimer].map((note) => (
          <div key={note.title} className="about-note">
            <h4>{note.title}</h4>
            <p>{note.body}</p>
          </div>
        ))}
      </div>

      <p className="about-cta">{c.cta}</p>
    </section>
  );
}
