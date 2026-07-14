"use client";

// 사이트 다국어(한국어/영어/일본어) 지원의 정본.
// - UI 문자열은 한국어 원문을 키로 하는 사전(D)으로 번역한다 — 원문이 바뀌면
//   사전 키도 함께 바꿔야 하며, 키가 없으면 한국어로 폴백된다(사이트가 깨지지 않음).
// - 게임 데이터 텍스트(오퍼 이름·스킬 등)는 사전이 아니라 scripts/build-i18n.py가
//   클뜯 레포에서 생성한 operators.en/ja.json · extra-i18n.*.json을 쓴다.
// - 컨셉덱 태그·플래너 토큰명은 KR 키를 내부 정본으로 유지하고 표시할 때만 번역한다.
import React, { createContext, useContext } from "react";

export type Locale = "ko" | "en" | "ja";

export const LOCALES: { code: Locale; label: string; chip: string; path: string }[] = [
  { code: "ko", label: "한국어", chip: "KO", path: "/" },
  { code: "en", label: "English", chip: "EN", path: "/en" },
  { code: "ja", label: "日本語", chip: "JP", path: "/ja" },
];

export const DT_LOCALE: Record<Locale, string> = { ko: "ko-KR", en: "en-US", ja: "ja-JP" };

// 공격 방식 필터의 물리/마법 판정 — 특성 텍스트가 로케일 데이터라 정규식도 로케일별
export const MAGIC_TRAIT_RE: Record<Locale, RegExp> = {
  ko: /마법 대미지/, en: /arts damage/i, ja: /術ダメージ/,
};

type Pair = [string, string]; // [en, ja]

// ── 인프라 토큰 (KR 파싱 키 → 공식 EN/JA 명칭, 클뜯 building_data 확인) ──────
const TOKEN_I18N: Record<string, Pair> = {
  "속세의 화식": ["Worldly Plight", "俗世之憂"],
  "감지 정보": ["Perception Information", "知覚情報"],
  "무성의 공명": ["Soundless Resonance", "静かなる共鳴"],
  "생각의 사슬": ["Chain of Thought", "思念連鎖"],
  "정보 저장": ["Intelligence Reserve", "情報備蓄"],
  "주술 결정": ["Witchcraft Crystal", "巫術の結晶"],
  "마물 요리": ["Monster Meal", "魔物料理"],
};

export function tokenName(locale: Locale, ko: string): string {
  if (locale === "ko") return ko;
  return TOKEN_I18N[ko]?.[locale === "en" ? 0 : 1] ?? ko;
}

// ── 컨셉덱 태그 (retag-concepts.py의 KR 키 → 표시명) ────────────────────────
const CONCEPT_I18N: Record<string, Pair> = {
  // 시너지 팟 11종
  "해산물팟": ["Abyssal Team", "アビサルパーティ"],
  "쉐이팟": ["Sui Team", "スイパーティ"],
  "쉐라그팟": ["Kjerag Team", "イェラグパーティ"],
  "카시미어팟": ["Kazimierz Team", "カジミエーシュパーティ"],
  "미노스팟": ["Minos Team", "ミノスパーティ"],
  "아베무팟": ["Ave Mujica Team", "Ave Mujicaパーティ"],
  "연소팟": ["Burn Team", "燃焼パーティ"],
  "라테라노팟": ["Laterano Team", "ラテラーノパーティ"],
  "탄약팟": ["Ammo Team", "弾薬パーティ"],
  "라인랩팟": ["Rhine Lab Team", "ライン生命パーティ"],
  "라이오스 파티": ["Laios' Party", "ライオス一行"],
  // 일반 컨셉 태그
  "아군 치유": ["Ally Healing", "味方治療"],
  "공격 회복": ["Offensive Recovery", "攻撃回復"],
  "피격 회복": ["Defensive Recovery", "被撃回復"],
  "자가 회복": ["Self-Healing", "自己回復"],
  "SP 배터리": ["SP Battery", "SPバッテリー"],
  "기절": ["Stun", "スタン"],
  "수면": ["Sleep", "睡眠"],
  "공격 중지": ["Attack Stop", "攻撃停止"],
  "감속·정지": ["Slow · Stop", "減速・停止"],
  "회피": ["Dodge", "回避"],
  "소환물·장치": ["Summons · Devices", "召喚物・装置"],
  "체력 비례": ["HP-Scaling", "HP比例"],
  "대공": ["Anti-Air", "対空"],
  "보호막": ["Shield", "シールド"],
  "방어 무시": ["Ignore DEF", "防御無視"],
  "속박": ["Bind", "束縛"],
  "지속 피해": ["Damage over Time", "継続ダメージ"],
  "취약": ["Fragile", "脆弱"],
  "원소 피해": ["Elemental Damage", "元素ダメージ"],
  "강제 이동": ["Forced Movement", "強制移動"],
  "쾌속 배치": ["Fast-Redeploy", "高速再配置"],
  "불사·생존": ["Undying · Survival", "不死・生存"],
  "은신·위장": ["Invisibility · Camouflage", "ステルス・偽装"],
  "은신 감지": ["Invisibility Detection", "ステルス感知"],
  "마법 저항 감소": ["RES Reduction", "術耐性減少"],
  "트루 대미지": ["True Damage", "確定ダメージ"],
  "방어력 감소": ["DEF Reduction", "防御力減少"],
  "냉기·빙결": ["Cold · Freeze", "寒気・凍結"],
  "마법 저항 무시": ["Ignore RES", "術耐性無視"],
  "힐링 디펜더": ["Healing Defender", "回復型重装"],
  "소환사": ["Summoner", "サモナー"],
  "음유시인": ["Bard", "吟遊詩人"],
  "리퍼": ["Reaper", "リーパー"],
  "함정": ["Trap", "トラップ"],
  "침묵": ["Silence", "沈黙"],
  "포트리스": ["Fortress", "フォートレス"],
  "공포": ["Fear", "恐怖"],
  "체력 소모": ["HP Drain", "HP消耗"],
};

export function conceptName(locale: Locale, ko: string): string {
  if (locale === "ko") return ko;
  return CONCEPT_I18N[ko]?.[locale === "en" ? 0 : 1] ?? ko;
}

// ── UI 문자열 사전 (한국어 원문 = 키) ────────────────────────────────────────
const D: Record<string, Pair> = {
  // 헤더 / 공통
  "테라 아카이브": ["Terra Archive", "テラアーカイブ"],
  "명일방주(Arknights) KR 팬사이트": ["Arknights KR-server fansite", "アークナイツ韓国サーバーファンサイト"],
  "테라 아카이브 홈": ["Terra Archive home", "テラアーカイブ ホーム"],
  "주요 탭": ["Main tabs", "メインタブ"],
  "오퍼 백과사전": ["Operator Archive", "オペレーター図鑑"],
  "인프라 플래너": ["Base Planner", "基地プランナー"],
  "공채 도우미": ["Recruit Helper", "公開求人ヘルパー"],
  "언어 선택": ["Language", "言語選択"],
  "닫기": ["Close", "閉じる"],

  // 공식 방송
  "공식 방송": ["Official Streams", "公式配信"],
  "생방송 중": ["Live now", "配信中"],
  "곧 시작": ["Starting soon", "まもなく開始"],
  "{n}시간 후": ["in {n}h", "{n}時間後"],
  "예약 {s}": ["Next · {s}", "予約 · {s}"],
  "명일방주 한국·일본·글로벌 공식 방송 일정 보기": ["View official Arknights stream schedule (KR · JP · Global)", "アークナイツ公式配信スケジュールを見る（韓国・日本・グローバル）"],
  "명일방주 공식 방송 일정": ["Arknights official stream schedule", "アークナイツ公式配信スケジュール"],
  "명일방주 공식 방송": ["Arknights Official Streams", "アークナイツ公式配信"],
  "● 생방송 중": ["● Live", "● 配信中"],
  "예약됨 ({s})": ["Scheduled ({s})", "予約済み（{s}）"],
  "지난 방송": ["Past stream", "過去の配信"],
  "지금 방송 중": ["Streaming now", "現在配信中"],
  "{date} 예정": ["Scheduled for {date}", "{date} 予定"],
  "{date} 방송": ["Aired {date}", "{date} 配信"],
  "{label} 서버": ["{label} server", "{label}サーバー"],
  "한국": ["KR", "韓国"],
  "일본": ["JP", "日本"],
  "글로벌": ["Global", "グローバル"],

  // 백과사전 — 필터
  "탐색 조건": ["Filters", "検索条件"],
  "초기화": ["Reset", "リセット"],
  "오퍼레이터 검색": ["Operator search", "オペレーター検索"],
  "이름, 별명, 직군, 효과 검색": ["Search name, nickname, class, effect", "名前・愛称・職分・効果で検索"],
  "컨셉덱": ["Concepts", "コンセプト"],
  "직군": ["Class", "職分"],
  "세부 직군": ["Archetype", "職分細分"],
  "전투 태그": ["Combat Tags", "戦闘タグ"],
  "공격 방식": ["Attack Type", "攻撃タイプ"],
  "공식 소속": ["Affiliation", "所属"],
  "복수 선택 가능 · 전부 해제 시 전체": ["Multi-select · none selected = all", "複数選択可 · 全解除で全表示"],
  "접기": ["Collapse", "閉じる"],
  "더보기 +{n}": ["More +{n}", "もっと見る +{n}"],
  "한국 서버 {count}명 · 전원 이미지 · 다국어 이름 및 커뮤니티 별명 검색 · 스킬과 재능 기반 {concepts}개 컨셉 태그를 제공합니다. 모든 필터는 토글식이며 아무것도 선택하지 않으면 전체가 표시됩니다.": [
    "{count} KR-server operators · full artwork · multilingual name & community nickname search · {concepts} concept tags derived from skills and talents. Every filter is a toggle; with nothing selected, all operators are shown.",
    "韓国サーバー{count}名 · 全員画像付き · 多言語名・コミュニティ愛称検索 · スキルと素質に基づく{concepts}種のコンセプトタグを提供。フィルターはすべてトグル式で、何も選択しなければ全員が表示されます。",
  ],
  "{concept} 컨셉덱": ["{concept} concept", "{concept}コンセプト"],
  "탐색 결과": ["Results", "検索結果"],
  "전체 오퍼레이터": ["All Operators", "全オペレーター"],
  "정렬": ["Sort", "並び替え"],
  "기본": ["Default", "デフォルト"],
  "이름": ["Name", "名前"],
  "성급": ["Rarity", "レア度"],
  "발매순": ["Release order", "実装順"],
  "소속": ["Affiliation", "所属"],
  "출신지": ["Birthplace", "出身"],
  "종족": ["Race", "種族"],
  "내림차순으로 변경": ["Switch to descending", "降順に切替"],
  "오름차순으로 변경": ["Switch to ascending", "昇順に切替"],
  // 근거리/원거리 번역은 build-i18n.py의 position 값과 반드시 일치해야 한다 (필터 판정)
  "근거리": ["Melee", "近距離"],
  "원거리": ["Ranged", "遠距離"],
  "물리": ["Physical", "物理"],
  "마법": ["Arts", "術"],
  "조건에 맞는 오퍼레이터가 없어요.": ["No operators match these filters.", "条件に合うオペレーターがいません。"],
  "소속이나 컨셉 태그를 하나씩 해제해 보세요.": ["Try removing an affiliation or concept tag.", "所属やコンセプトタグを外してみてください。"],
  "전체 보기": ["Show all", "全て表示"],

  // 카드
  "출신": ["From", "出身"],
  "불명": ["Unknown", "不明"],
  "{name} 상세 정보 열기": ["Open {name} details", "{name}の詳細を開く"],
  "{name} 오퍼레이터": ["Operator {name}", "オペレーター{name}"],

  // 별명 제보
  "별명 제보": ["Suggest a nickname", "愛称を投稿"],
  "이 오퍼의 별명 (16자 이내)": ["Nickname for this operator (max 16 chars)", "このオペレーターの愛称（16字以内）"],
  "전송 중…": ["Sending…", "送信中…"],
  "제보": ["Send", "投稿"],
  "별명을 입력해 주세요": ["Please enter a nickname", "愛称を入力してください"],
  "별명은 16자 이내로 부탁드려요": ["Please keep nicknames within 16 characters", "愛称は16字以内でお願いします"],
  "이미 이 별명을 제보하셨어요, 감사합니다!": ["You already sent this nickname — thank you!", "この愛称は投稿済みです、ありがとうございます！"],
  "제보 감사합니다!": ["Thanks for the suggestion!", "ご投稿ありがとうございます！"],
  "전송 실패 — 잠시 후 다시 시도해주세요": ["Failed to send — please try again later", "送信失敗 — しばらくしてから再試行してください"],

  // 오퍼 상세 모달
  "상세 정보 닫기": ["Close details", "詳細を閉じる"],
  "{n}성": ["{n}-star", "星{n}"],
  "태그 없음": ["No tags", "タグなし"],
  "분류 없음": ["Unclassified", "分類なし"],
  "컨셉": ["Concepts", "コンセプト"],
  "잠재능력": ["Potential", "潜在能力"],
  "등록된 잠재능력 정보가 없습니다.": ["No potential data.", "潜在能力情報がありません。"],
  "스탯": ["Stats", "ステータス"],
  "육성 단계": ["Promotion", "育成段階"],
  "공격": ["ATK", "攻撃"],
  "방어": ["DEF", "防御"],
  "마저": ["RES", "術耐性"],
  "코스트": ["Cost", "コスト"],
  "저지": ["Block", "ブロック"],
  "재배치": ["Redeploy", "再配置"],
  "공격 간격": ["Interval", "攻撃間隔"],
  "공격 범위": ["Range", "攻撃範囲"],
  "{n}초": ["{n}s", "{n}秒"],
  "스킬": ["Skills", "スキル"],
  "초기 SP {n}": ["Initial SP {n}", "初期SP {n}"],
  "소모 SP {n}": ["SP cost {n}", "消費SP {n}"],
  "지속 {n}초": ["Duration {n}s", "持続{n}秒"],
  "등록된 전투 스킬이 없습니다.": ["No combat skills.", "戦闘スキルがありません。"],
  "재능": ["Talents", "素質"],
  "등록된 재능이 없습니다.": ["No talents.", "素質がありません。"],
  "특성": ["Trait", "特性"],
  "모듈": ["Modules", "モジュール"],
  "현재 적용 가능한 모듈이 없습니다.": ["No modules available yet.", "適用可能なモジュールがありません。"],
  "인프라 스킬": ["Base Skills", "基地スキル"],
  "등록된 인프라 스킬이 없습니다.": ["No base skills.", "基地スキルがありません。"],

  // 푸터 / 문서 제목
  "명일방주(Arknights) 비공식 팬 프로젝트 · 게임 내 명칭과 데이터의 권리는 Hypergryph / Yostar 등 각 권리자에게 있습니다.": [
    "Unofficial Arknights fan project. All in-game names and data belong to Hypergryph / Yostar and their respective right holders.",
    "アークナイツ非公式ファンプロジェクト · ゲーム内の名称およびデータの権利は Hypergryph / Yostar など各権利者に帰属します。",
  ],
  "테라 아카이브 | 명일방주(Arknights) KR 팬사이트": ["Terra Archive | Arknights KR Fansite", "テラアーカイブ | アークナイツ韓国サーバーファンサイト"],
  "{name} - 명일방주 오퍼레이터 | 테라 아카이브": ["{name} - Arknights Operator | Terra Archive", "{name} - アークナイツ オペレーター | テラアーカイブ"],
  "인프라 플래너 - 명일방주 기반시설 편성 | 테라 아카이브": ["Base Planner - Arknights RIIC Base | Terra Archive", "基地プランナー - アークナイツ基地編成 | テラアーカイブ"],
  "공채 도우미 - 명일방주 공개모집 계산기 | 테라 아카이브": ["Recruit Helper - Arknights Recruitment Calculator | Terra Archive", "公開求人ヘルパー - アークナイツ公開求人計算機 | テラアーカイブ"],

  // ── 인프라 플래너 ──────────────────────────────────────────────────────────
  "RIIC / 243 · 순금 2 + 작전기록 2 · 12시간 2조 교대": ["RIIC / 243 · Pure Gold ×2 + Battle Records ×2 · two 12h shifts", "RIIC / 243 · 純金2 + 作戦記録2 · 12時間2交代"],
  "인프라 배치 최적화": ["Base Assignment Optimizer", "基地配置最適化"],
  "보유 오퍼 설정 ({a}/{b})": ["My operators ({a}/{b})", "所持オペレーター設定（{a}/{b}）"],
  "전체 자동편성": ["Auto-assign all", "全自動編成"],
  "빈 자리만 자동편성": ["Fill empty slots", "空きスロットのみ自動編成"],
  "현재 편성(수동 수정 포함)은 그대로 두고, 남은 빈 자리만 효율 순으로 자동 편성합니다": ["Keeps the current assignment (including manual edits) and fills only the remaining empty slots by efficiency", "現在の編成（手動修正含む）を維持したまま、残りの空きスロットだけを効率順に自動編成します"],
  "이미지로 보기": ["View as image", "画像で見る"],
  "A조·B조 편성표를 이미지로 확인 (PNG)": ["Preview the Shift A/B sheet as a PNG image", "A班・B班の編成表をPNG画像で確認"],
  "현재 상태 파일로 저장": ["Save state to file", "現在の状態をファイルに保存"],
  "저장 후 변경 사항이 있습니다 — 파일로 저장하세요": ["There are unsaved changes — save them to a file", "保存後に変更があります — ファイルに保存してください"],
  "보유 오퍼와 편성을 JSON 파일로 저장": ["Save owned operators and assignments as a JSON file", "所持オペレーターと編成をJSONファイルに保存"],
  "저장된 상태 파일 가져오기": ["Load saved state file", "保存した状態ファイルを読み込む"],
  "도움말": ["Help", "ヘルプ"],
  "전략 (클릭해 시너지 트리 보기)": ["Strategy (click for synergy tree)", "戦略（クリックでシナジーツリー）"],
  "제조소 평균": ["Factory avg", "製造所平均"],
  "무역소 평균": ["Trading avg", "貿易所平均"],
  "발전소 평균": ["Power avg", "発電所平均"],
  "기용 인원": ["Operators used", "起用人数"],
  "{n}명": ["{n}", "{n}名"],
  "A조 (풀파워)": ["Shift A (full power)", "A班（フルパワー）"],
  "B조 (회복 교대)": ["Shift B (recovery)", "B班（回復交代）"],
  "A조": ["Shift A", "A班"],
  "B조": ["Shift B", "B班"],
  "A조 컨디션 소진 시 B조 투입 · 시너지 세트는 A조 집중 · 숙소·고정 요원은 조 전환과 무관 · ": ["Send in Shift B when Shift A's morale runs out · synergy sets concentrate in Shift A · dorm/pinned operators ignore shift changes · ", "A班の体力が尽きたらB班を投入 · シナジーセットはA班に集中 · 宿舎・固定要員は交代と無関係 · "],
  "숙소는 항상 5명 꽉 채워 유지": ["keep every dorm filled with 5 at all times", "宿舎は常に5人満員を維持"],
  // 243 레이아웃 라벨
  "무역소 1": ["Trading Post 1", "貿易所1"],
  "무역소 2": ["Trading Post 2", "貿易所2"],
  "제조소 1 · 순금": ["Factory 1 · Gold", "製造所1 · 純金"],
  "제조소 2 · 순금": ["Factory 2 · Gold", "製造所2 · 純金"],
  "제조소 3 · 작전기록": ["Factory 3 · Battle Records", "製造所3 · 作戦記録"],
  "제조소 4 · 작전기록": ["Factory 4 · Battle Records", "製造所4 · 作戦記録"],
  "발전소 1": ["Power Plant 1", "発電所1"],
  "발전소 2": ["Power Plant 2", "発電所2"],
  "발전소 3": ["Power Plant 3", "発電所3"],
  "제어 센터": ["Control Center", "制御中枢"],
  "응접실": ["Reception Room", "応接室"],
  "가공소": ["Workshop", "加工所"],
  "사무실": ["Office", "事務室"],
  "훈련실": ["Training Room", "訓練室"],
  "숙소 1": ["Dorm 1", "宿舎1"],
  "숙소 2": ["Dorm 2", "宿舎2"],
  "숙소 3": ["Dorm 3", "宿舎3"],
  "숙소 4": ["Dorm 4", "宿舎4"],
  "고정": ["Pinned", "固定"],
  "시너지 고정 + 휴식 공간": ["Synergy pins + rest space", "シナジー固定 + 休憩スペース"],
  "휴식 공간 · 조 전환과 무관": ["Rest space · unaffected by shifts", "休憩スペース · 交代と無関係"],
  "휴식 공간": ["Rest space", "休憩スペース"],
  "비워둠 · 특화 훈련 시 사용": ["Kept empty · used for mastery training", "空けておく · 特化訓練用"],
  "비워둠 (특화 훈련용)": ["Kept empty (mastery training)", "空けておく（特化訓練用）"],
  "비어 있음": ["Empty", "空き"],
  "자동 편성 대기": ["Awaiting auto-assign", "自動編成待ち"],
  "세트 요원 고정 · 효율 무관": ["Set member pinned · efficiency N/A", "セット要員固定 · 効率対象外"],
  // 방 단위 표기
  "생산력": ["productivity", "生産力"],
  "오더 효율·품질": ["order efficiency & quality", "受注効率・品質"],
  "드론 회복": ["drone recovery", "ドローン回復"],
  "단서 속도": ["clue speed", "手がかり速度"],
  "연락 속도": ["contact speed", "人脈収集速度"],
  "부산물": ["byproducts", "副産物"],
  "훈련 속도": ["training speed", "訓練速度"],
  "지원": ["support", "サポート"],
  "회복": ["recovery", "回復"],
  "효율": ["efficiency", "効率"],
  "제조소 생산력 오라": ["Factory productivity aura", "製造所生産力オーラ"],
  "무역소 오더 효율 오라": ["Trading order efficiency aura", "貿易所受注効率オーラ"],
  "인맥 레퍼런스 오라": ["HR contact aura", "人脈オーラ"],
  "단서 수집 오라": ["Clue collection aura", "手がかり収集オーラ"],
  "오퍼레이터의 모든 인프라 스킬을 동시에 적용하고(α/β는 상위 티어만), 시설 간 포인트 시스템(속세의 화식·무성의 공명 등)을 겹쳐 쌓을 수 있을 때까지 패키지로 조합합니다. 고품질 귀금속 오더 확률(샤마르·카프카·디아만테·바이비크)과 오더당 수익(테킬라·프로바이조)의 상호작용, 샤마르의 효율 대체를 반영합니다. 조건부·누적 버프는 추정 상한 기준 근사치입니다.": [
    "Every base skill of an operator applies at once (only the higher tier of α/β), and cross-facility point systems (Worldly Plight, Soundless Resonance, …) are combined into packages while they still stack. Interactions between quality-order odds (Shamare, Kafka, Diamante, Bibeak) and per-order payouts (Tequila, Proviso), and Shamare's efficiency override are modeled. Conditional/stacking buffs are approximations based on estimated caps.",
    "オペレーターの基地スキルはすべて同時適用（α/βは上位ティアのみ）、施設間ポイントシステム（俗世之憂・静かなる共鳴など）は積める限りパッケージとして組み合わせます。高品質受注確率（シャマル・カフカ・ディアマンテ・バイビーク）と受注ごとの収益（テキーラ・プロヴァイゾ）の相互作用、シャマルの効率オーバーライドを反映。条件付き・累積バフは推定上限に基づく近似値です。",
  ],
  // 토스트
  "현재 상태를 파일로 저장했습니다": ["Saved the current state to a file", "現在の状態をファイルに保存しました"],
  "저장된 상태를 불러왔습니다 · 보유 {n}명 복원": ["Loaded saved state · restored {n} owned operators", "保存した状態を読み込みました · 所持{n}名を復元"],
  "가져오기 실패: 파일 형식을 확인해 주세요.": ["Import failed: please check the file format.", "読み込み失敗：ファイル形式を確認してください。"],
  "전체 자동편성을 실행했습니다 · 보유 {n}명 기준": ["Ran full auto-assign · based on {n} owned operators", "全自動編成を実行しました · 所持{n}名基準"],
  "채울 수 있는 빈 자리가 없습니다": ["No empty slots can be filled", "埋められる空きスロットがありません"],
  "빈 자리 {n}곳을 채웠습니다 · 기존 편성 유지": ["Filled {n} empty slots · existing assignment kept", "空きスロット{n}箇所を埋めました · 既存編成は維持"],
  // 이미지 내보내기
  "편성표 이미지": ["Assignment Sheet Image", "編成表画像"],
  "PNG 저장": ["Save PNG", "PNG保存"],
  "인프라 편성표": ["Base assignment sheet", "基地編成表"],
  "{token} {n}점": ["{token} {n} pts", "{token} {n}点"],
  "{tokens} 패키지": ["{tokens} package", "{tokens}パッケージ"],
  "기본 편성": ["Baseline assignment", "基本編成"],
  " + 쉐라그 세트": [" + Kjerag set", " + イェラグセット"],
  "A = 풀파워 주간조 · B = 회복 교대조 · terra-archive infra planner": ["A = full-power crew · B = recovery crew · terra-archive infra planner", "A = フルパワー班 · B = 回復交代班 · terra-archive infra planner"],
  // 정예화
  "노정예": ["E0", "未昇進"],
  "1정": ["E1", "昇進1"],
  "2정": ["E2", "昇進2"],
  "{name} 정예화 단계": ["{name} promotion stage", "{name}の昇進段階"],
  // 방 상세 모달
  "종합 효율": ["Total efficiency", "総合効率"],
  "스킬 효율": ["Skill efficiency", "スキル効率"],
  "시설 기반": ["Facility-based", "施設ベース"],
  "자동화": ["Automation", "自動化"],
  "품질 기대치": ["Quality expectation", "品質期待値"],
  "오더 수익": ["Order payout", "受注収益"],
  "효율 오버라이드": ["Efficiency override", "効率オーバーライド"],
  "동료 보너스": ["Coworker bonus", "同僚ボーナス"],
  "제어 오라(가중)": ["Control auras (weighted)", "管制オーラ（加重）"],
  "제어센터 오라 수신": ["Aura received from Control", "制御中枢オーラ受信"],
  "편성 없음": ["No assignment", "編成なし"],
  "아래에서 오퍼를 빼거나(✕) 대체 오퍼·추가 후보를 클릭하면 즉시 다시 계산됩니다. 단, 토큰 포인트(속세의 화식 등)와 패키지 구성은 마지막 자동편성 기준이므로, 토큰 생성원을 바꿨다면 자동편성 실행으로 재계산하세요.": [
    "Remove operators (✕) or click substitutes/candidates below to recalculate instantly. Token points (Worldly Plight, etc.) and package composition follow the last auto-assign — rerun it if you changed token generators.",
    "下でオペレーターを外す（✕）か、代替・追加候補をクリックすると即座に再計算されます。ただしトークンポイント（俗世之憂など）とパッケージ構成は最後の自動編成基準なので、生成要員を変えた場合は自動編成を実行し直してください。",
  ],
  "편성 ({a}/{b})": ["Crew ({a}/{b})", "編成（{a}/{b}）"],
  "숙소는 **항상 5명을 꽉 채운 상태로 유지**하세요. 고정 생성원 외의 빈 자리는 휴식이 필요한 아무 오퍼레이터로 채우면 됩니다 — 토큰 생성과 회복 효율은 풀 인원 기준으로 계산됩니다.": [
    "Keep dorms **filled with 5 at all times**. Fill non-pinned seats with any operator who needs rest — token generation and recovery are computed at full occupancy.",
    "宿舎は**常に5人満員を維持**してください。固定生成要員以外の空きは休憩が必要な任意のオペレーターで埋めればOK — トークン生成と回復効率は満員基準で計算されます。",
  ],
  "이 자리에서 빼기": ["Remove from this slot", "このスロットから外す"],
  "{name} 상세 정보": ["{name} details", "{name}の詳細"],
  "이 시설에 적용되는 스킬이 없습니다 (세트 대기 요원).": ["No skills apply in this facility (set standby member).", "この施設に適用されるスキルはありません（セット待機要員）。"],
  "고품질 확률 +{n}%p 상당": ["quality odds +{n}%p equiv.", "高品質確率 +{n}%p相当"],
  "오더 수익 +{n}% 상당": ["order payout +{n}% equiv.", "受注収益 +{n}%相当"],
  "효율 대체 인당 +{n}%": ["override +{n}% per member", "効率代替 1人あたり+{n}%"],
  "동료 보너스 +{n}%": ["coworker bonus +{n}%", "同僚ボーナス +{n}%"],
  "시설 기반 +{n}%": ["facility-based +{n}%", "施設ベース +{n}%"],
  "자동화 +{n}%": ["automation +{n}%", "自動化 +{n}%"],
  "{token} +{n}점 생성": ["{token} +{n} pts generated", "{token} +{n}点生成"],
  "대체 불가 · 시너지 코어": ["Locked · synergy core", "代替不可 · シナジーコア"],
  "이 자리 대체 오퍼:": ["Substitutes for this slot:", "このスロットの代替オペレーター："],
  "클릭하면 {name} 자리에 교체": ["Click to replace {name}", "クリックで{name}と交代"],
  "동급": ["equal", "同等"],
  "빈 자리에 추가 — 클릭 시 즉시 배치 (기여 예상):": ["Add to an empty slot — click to place (estimated gain):", "空きスロットに追加 — クリックで即配置（貢献予想）："],
  "{name} 추가": ["Add {name}", "{name}を追加"],
  "이름·소속으로 후보 검색": ["Search candidates by name or affiliation", "名前・所属で候補検索"],
  "검색 결과가 없습니다.": ["No results.", "検索結果がありません。"],
  "더 많이 보기 (전체 {n}명)": ["Show more (all {n})", "もっと見る（全{n}名）"],
  "자동 편성을 먼저 실행해 주세요.": ["Run auto-assign first.", "先に自動編成を実行してください。"],
  // 시너지 트리
  "A조 기준": ["Shift A basis", "A班基準"],
  "시너지 트리": ["Synergy Tree", "シナジーツリー"],
  "활성화된 포인트 시너지가 없습니다.": ["No active point synergies.", "有効なポイントシナジーはありません。"],
  "총 {n}점": ["Total {n} pts", "合計{n}点"],
  "생성": ["Generation", "生成"],
  "전환": ["Conversion", "転換"],
  "소비": ["Consumption", "消費"],
  "+{n}점": ["+{n} pts", "+{n}点"],
  " ({token} 전환)": [" (converted from {token})", "（{token}から転換）"],
  "생성원이 배치되지 않음": ["No generators assigned", "生成要員が未配置"],
  "소비자가 배치되지 않음": ["No consumers assigned", "消費要員が未配置"],
  "{token} {n}점 소비 → {unit} +{m}% (1점당 +{r}%)": ["Consumes {n} {token} pts → {unit} +{m}% (+{r}% per pt)", "{token} {n}点消費 → {unit} +{m}%（1点あたり+{r}%）"],
  "{token} 기반 컨디션 회복·소모 보정": ["{token}-based morale recovery/drain adjustment", "{token}ベースの体力回復・消費補正"],
  "기존 배치": ["existing placement", "既存配置"],
  // 보유 오퍼 설정
  "{n}/{m} 보유": ["{n}/{m} owned", "所持 {n}/{m}"],
  "보유 오퍼레이터 설정": ["Set Owned Operators", "所持オペレーター設定"],
  "이름·소속 검색": ["Search name/affiliation", "名前・所属で検索"],
  "전체 선택": ["Select all", "全選択"],
  "전체 해제": ["Clear all", "全解除"],
  "적용 및 자동편성 실행": ["Apply & run auto-assign", "適用して自動編成を実行"],
  "MAA 파일 가져오기": ["Import MAA file", "MAAファイル読み込み"],
  "MAA(MaaAssistantArknights)의 오퍼 박스 인식 결과 JSON을 불러와 보유·정예화를 한 번에 설정합니다": [
    "Load an operator-box recognition JSON from MAA (MaaAssistantArknights) to set ownership and promotions at once",
    "MAA（MaaAssistantArknights）のオペレーターBOX認識結果JSONを読み込み、所持と昇進を一括設定します",
  ],
  "MAA 보유 데이터를 반영했습니다 — 보유 {own}명 · 정예화 반영 {elite}건 · 미수록 오퍼 {skip}건. 확인 후 '적용 및 자동편성 실행'을 누르세요.": [
    "Applied MAA box data — {own} owned · {elite} promotions set · {skip} operators not in this site's data. Review, then press 'Apply & run auto-assign'.",
    "MAAの所持データを反映しました — 所持{own}名 · 昇進反映{elite}件 · 未収録オペレーター{skip}件。確認後「適用して自動編成を実行」を押してください。",
  ],
  "MAA 파일을 인식하지 못했습니다 — 오퍼 박스 인식 결과 JSON(Arknights_OperBox_Export.json 등)인지 확인해 주세요.": [
    "Could not read the MAA file — make sure it is an operator-box recognition JSON (e.g. Arknights_OperBox_Export.json).",
    "MAAファイルを認識できませんでした — オペレーターBOX認識結果のJSON（Arknights_OperBox_Export.json など）か確認してください。",
  ],
  "정예화 단계에 따라 해금되는 인프라 스킬을 가진 오퍼는 카드 아래에서 **노정예/1정/2정**을 선택할 수 있습니다 (기본값 최대 정예화). 얼굴을 클릭하면 상세 정보가 열립니다.": [
    "Operators whose base skills unlock by promotion can be set to **E0/E1/E2** under their card (default: max promotion). Click a portrait to open details.",
    "昇進段階で基地スキルが解放されるオペレーターは、カード下で**未昇進/昇進1/昇進2**を選択できます（デフォルトは最大昇進）。顔をクリックすると詳細が開きます。",
  ],
  "6성": ["6★", "星6"],
  "5성": ["5★", "星5"],
  "4성": ["4★", "星4"],
  "3성": ["3★", "星3"],
  "2성 이하": ["≤2★", "星2以下"],
  "전체 보유": ["Own all", "全所持"],
  "일괄 {label}": ["All {label}", "一括{label}"],
  // 도움말 모달
  "최적화 규칙 도움말": ["Optimizer Rules Help", "最適化ルールのヘルプ"],
  "교대 정책": ["Shift policy", "交代方針"],
  "A조가 풀파워 주력이고 모든 시너지 세트는 A조에 모입니다. B조는 A조 컨디션이 소진됐을 때 투입되는 회복 교대입니다 (12시간 2조).": [
    "Shift A is the full-power main crew and every synergy set is assembled there. Shift B is the recovery crew that steps in when Shift A's morale runs out (two 12h shifts).",
    "A班がフルパワーの主力で、すべてのシナジーセットはA班に集めます。B班はA班の体力が尽きたときに投入される回復交代です（12時間2交代）。",
  ],
  "숙소·시너지 고정 요원(숙소 생성원, 니엔 등)은 A/B 전환과 무관하게 고정됩니다. 응접실도 A/B 교대로 운영합니다 — 같은 인원을 24시간 돌리지 않습니다.": [
    "Dorm/synergy-pinned members (dorm generators, Nian, …) stay put regardless of A/B. The Reception Room also rotates A/B — nobody works 24 hours straight.",
    "宿舎・シナジー固定要員（宿舎生成要員、ニェンなど）はA/B交代と無関係に固定されます。応接室もA/Bで交代運用 — 同じ人員を24時間回しません。",
  ],
  "훈련실은 실제 스킬 특화 훈련에 쓰도록 비워 둡니다.": ["The Training Room is kept empty for actual mastery training.", "訓練室は実際のスキル特化訓練用に空けておきます。"],
  "'전체 자동편성'은 처음부터 다시 계산하고, '빈 자리만 자동편성'은 현재 편성(수동 수정 포함)을 유지한 채 남은 빈 자리만 한계 기여 순으로 채웁니다.": [
    "'Auto-assign all' recomputes from scratch; 'Fill empty slots' keeps the current assignment (manual edits included) and fills only the remaining seats by marginal gain.",
    "「全自動編成」は最初から再計算し、「空きスロットのみ自動編成」は現在の編成（手動修正含む）を維持したまま残りの空きだけを限界貢献順に埋めます。",
  ],
  "방 우선순위": ["Room priority", "部屋の優先順位"],
  "채우는 순서: 제조소-순금 > 제조소-작전기록 > 무역소 > 발전소 > 사무실 > 응접실 — 먼저 채우는 방이 좋은 요원을 가져갑니다. 응접실은 최하위라, 응접실 스킬이 있는 오퍼(쉐라 등)도 상위 방 세트가 우선입니다.": [
    "Fill order: Gold factories > Battle Record factories > Trading Posts > Power Plants > Office > Reception Room — earlier rooms take the best operators. Reception is last, so even reception-skill operators may be claimed by higher rooms first.",
    "埋める順序：製造所-純金 > 製造所-作戦記録 > 貿易所 > 発電所 > 事務室 > 応接室 — 先に埋める部屋が優秀な要員を取ります。応接室は最下位のため、応接室スキル持ちでも上位部屋のセットが優先されます。",
  ],
  "순금 2 + 작전기록 2 분할. 무역소 효율이 오르면 순금이 병목이 되므로 가장 강한 생산 팀을 순금 2방에 먼저 배치하고, 남는 효율을 작전기록으로 돌립니다.": [
    "Split as Gold ×2 + Battle Records ×2. As trading efficiency rises, gold becomes the bottleneck, so the strongest production teams go to the two gold rooms first.",
    "純金2 + 作戦記録2の分割。貿易所の効率が上がると純金がボトルネックになるため、最強の生産チームを純金2部屋に先に配置し、余った効率を作戦記録に回します。",
  ],
  "품목 전용 스킬(금속공예류 = 순금)은 해당 품목 방에서만 계산됩니다.": ["Product-specific skills (e.g. metalcraft = gold) only count in rooms making that product.", "品目専用スキル（金属工芸類＝純金）は該当品目の部屋でのみ計算されます。"],
  "포인트 시너지 (시설 간)": ["Point synergies (cross-facility)", "ポイントシナジー（施設間）"],
  "속세의 화식: 제어센터 시·링·총웨(쉐이 1명당 +5, 최대 5명 — 실제 배치 수로 계산) + 우요우가 생성, 슈(제조)·우요우(무역)·지에윈(화식→주술 결정 전환)이 소비합니다.": [
    "Worldly Plight: generated by Dusk/Ling/Chongyue in Control (+5 per Sui member, up to 5 — counted from actual placements) plus Wuyou; consumed by Shu (factory), Wuyou (trading), and Jieyun (converting Plight → Witchcraft Crystal).",
    "俗世之憂：制御中枢のシー・リィン・チョンユエ（スイ1人につき+5、最大5人 — 実配置数で計算）とウーユウが生成し、シュウ（製造）・ウーユウ（貿易）・ジエユン（憂→巫術の結晶転換）が消費します。",
  ],
  "무성의 공명·감지 정보: 숙소에 고정된 아이리스(꿈나라)·체르니(소절)·비르투오사가 생성, 에벤홀츠가 감지 정보를 공명으로 전환해 무역소 효율로 소비합니다.": [
    "Soundless Resonance / Perception Information: generated by dorm-pinned Iris (Dreamland), Czerny (Passage), and Virtuosa; Ebenholz converts Perception into Resonance and cashes it in as trading efficiency.",
    "静かなる共鳴・知覚情報：宿舎固定のアイリス（夢の国）・チェルニー（楽節）・ヴィルトゥオーサが生成し、エーベンホルツが知覚情報を共鳴に転換して貿易所効率として消費します。",
  ],
  "마물 요리: 센시를 숙소에 고정하면 레벨당 1개(총 5개)가 생겨 마르실(제조)·라이오스(응접실)가 소비합니다.": [
    "Monster Meal: pinning Senshi in a dorm grants 1 per dorm level (5 total), consumed by Marcille (factory) and Laios (reception).",
    "魔物料理：センシを宿舎に固定するとレベルごとに1つ（計5つ）生まれ、マルシル（製造）・ライオス（応接室）が消費します。",
  ],
  "정보 저장은 레인보우 팀 전용 폐쇄 시스템이라 기지 편성에 넣지 않습니다.": ["Intelligence Reserve is a closed Team Rainbow system and is left out of base packages.", "情報備蓄はレインボー小隊専用の閉鎖システムのため、基地編成には入れません。"],
  "무역소 조합": ["Trading post combos", "貿易所の組み合わせ"],
  "샤마르(속삭임)는 다른 인원의 효율을 0으로 만들고 인당 +45%를 주므로, 효율이 없어도 되는 품질 요원과 묶습니다: 샤마르 + 테킬라(투자β: 고품질 순금 오더 수익) + 확률 요원(카프카·디아만테·바이비크 — 전부 동급).": [
    "Shamare (Whispers) zeroes everyone else's efficiency and grants +45% per member, so she pairs with quality operators who don't need efficiency: Shamare + Tequila (Investment β: quality gold order payout) + an odds operator (Kafka / Diamante / Bibeak — all equivalent).",
    "シャマル（ささやき）は他メンバーの効率を0にして1人あたり+45%を与えるため、効率が不要な品質要員と組みます：シャマル + テキーラ（投資β：高品質純金受注収益）+ 確率要員（カフカ・ディアマンテ・バイビーク — すべて同等）。",
  ],
  "프로바이조는 반대로 저품질 오더를 위약 처리해 수익을 내므로 고품질 확률과는 반시너지입니다. 처리량이 높은 우요우+에벤홀츠 방에 넣습니다.": [
    "Proviso instead profits from breaching low-count orders, so she anti-synergizes with quality odds — put her in the high-throughput Wuyou + Ebenholz post.",
    "プロヴァイゾは逆に低品質受注を違約処理して収益を出すため、高品質確率とは反シナジー。処理量の多いウーユウ+エーベンホルツの部屋に入れます。",
  ],
  "레벨 성장형은 만렙 기지 기준 상한으로 계산합니다: 비질 +40%(응접실 Lv3), 아르케토 +40%(숙소 20레벨), 미틈 +30%, 만트라 +45%(시설 10개).": [
    "Level-scaling skills use max-base caps: Vigil +40% (Reception Lv3), Archetto +40% (dorm levels 20), Mitm +30%, Mantra +45% (10 facilities).",
    "レベル成長型は最大レベル基地基準の上限で計算：ヴィジェル+40%（応接室Lv3）、アルケット+40%（宿舎20レベル）、ミトム+30%、マントラ+45%（施設10）。",
  ],
  "언더플로우(+30%)는 울피아누스가 기지 어디든(숙소 포함) 있으면 +40%가 됩니다 — 울피아누스를 숙소에 고정해 두세요. B조 무역소 정배: 비질+아르케토+언더플로우.": [
    "Underflow (+30%) becomes +40% while Ulpianus is anywhere in the base (dorms included) — keep him pinned in a dorm. Standard Shift B trading crew: Vigil + Archetto + Underflow.",
    "アンダーフロー（+30%）はウルピアヌスが基地内のどこか（宿舎含む）にいれば+40%になります — ウルピアヌスを宿舎に固定しておきましょう。B班貿易所の定番：ヴィジェル+アルケット+アンダーフロー。",
  ],
  "자동화 제조소": ["Automation factories", "自動化製造所"],
  "위디·유넥티스·윈드플릿·패신저는 방 내 다른 오퍼의 생산력을 0으로 만들고 발전소 1기당 +15%/+10%/+5%/+5%를 받습니다 — 이들과 같은 방에 넣은 일반 +30%/+35%류 생산력 스킬은 전부 0%가 되므로, 직접 수치가 아니라 이런 제로아웃 오퍼와 궁합이 맞는지 먼저 확인해야 합니다.": [
    "Weedy, Eunectes, Windflit, and Passenger zero out other operators' productivity in their room and gain +15%/+10%/+5%/+5% per power plant — ordinary +30%/+35% productivity skills in the same room all become 0%, so check compatibility with these zero-out operators before comparing raw numbers.",
    "ウィーディ・ユネクテス・ウィンドフリット・パッセンジャーは同室の他オペレーターの生産力を0にし、発電所1基につき+15%/+10%/+5%/+5%を得ます — 同室の通常+30%/+35%系生産力スキルはすべて0%になるため、数値そのものよりゼロアウト相性を先に確認してください。",
  ],
  "스네구로치카는 같은 방식으로 제로아웃하되 발전소가 아니라 그 제조소에 실제 배치된 인원수당 +10%로 스케일됩니다.": [
    "Snegurochka zeroes out the same way but scales at +10% per operator actually assigned to that factory instead of per power plant.",
    "スネグロチカは同様にゼロアウトしますが、発電所ではなくその製造所の実配置人数1人につき+10%でスケールします。",
  ],
  "단 시설 수량 기반 생산력(퓨어스트림·쏜즈의 '각각의 무역소가…')은 살아남아 함께 쓸 수 있습니다.": [
    "Facility-count productivity ('for each Trading Post…' — Purestream, Thorns) survives the zero-out and can be combined.",
    "ただし施設数ベースの生産力（ピュアストリーム・ソーンズの「各貿易所が…」）はゼロアウトを生き残り、併用できます。",
  ],
  "그레이 더 라이트닝베어러를 발전소에 두면(다른 발전소에 1성 로봇이 없는 한) 발전소 4기로 간주되어 자동화 방이 최대 140%까지 오릅니다.": [
    "Greyy the Lightningbearer in a Power Plant (as long as no 1★ robot sits in another plant) counts the base as 4 plants, pushing automation rooms up to 140%.",
    "グレイ・ザ・ライトニングベアラーを発電所に置くと（他の発電所に星1ロボットがいない限り）発電所4基とみなされ、自動化部屋は最大140%まで上がります。",
  ],
  "제로아웃 오퍼를 쓰는 편성 자체가 예외적인 케이스입니다 — 자동편성은 실제 방 점수(제로아웃 반영)로 비교해 더 나을 때만 추천합니다.": [
    "Zero-out crews are the exception, not the rule — auto-assign compares real room scores (zero-out applied) and only recommends them when they actually win.",
    "ゼロアウト編成自体が例外的なケースです — 自動編成は実際の部屋スコア（ゼロアウト反映）で比較し、上回る場合のみ推薦します。",
  ],
  "오라 우선순위: 제조소 생산력 > 무역소 오더 효율 > 인맥 레퍼런스 > 단서 수집. '동종 효과 중 최고만 적용' 규칙을 따릅니다.": [
    "Aura priority: factory productivity > trading order efficiency > HR contacts > clue collection. Only the strongest of each kind applies.",
    "オーラ優先度：製造所生産力 > 貿易所受注効率 > 人脈 > 手がかり収集。「同種効果は最高のみ適用」ルールに従います。",
  ],
  "제어센터 오라는 대상 방 점수에 실제로 합산됩니다 — 무역소 오더 효율 +10% 오라면 무역소 점수와 상단 서머리에 더해집니다 (방 상세의 '제어센터 오라 수신'). 단 이격 실버애쉬처럼 조건이 붙은 오라는 조건을 채운 그 방 하나에만 적용됩니다.": [
    "Control Center auras are actually added to the target room's score — a +10% trading aura raises the trading score and the top summary ('Aura received from Control' in room details). Conditional auras (e.g. SilverAsh alter) apply only to the single room meeting the condition.",
    "制御中枢オーラは対象部屋のスコアに実際に加算されます — 貿易所受注効率+10%のオーラなら貿易所スコアと上部サマリーに加算（部屋詳細の「制御中枢オーラ受信」）。ただし異格シルバーアッシュのような条件付きオーラは、条件を満たしたその1部屋にのみ適用されます。",
  ],
  "'용문근위국 오퍼와 함께'류 동반 조건, '미노스 1명당'류 카운트 조건은 실제 배치를 기준으로만 인정합니다.": [
    "Companion conditions ('together with an L.G.D. operator') and count conditions ('per Minos operator') are honored only against actual placements.",
    "「龍門近衛局オペレーターと共に」系の同伴条件、「ミノス1人につき」系のカウント条件は実際の配置のみを基準に認めます。",
  ],
  "이격 실버애쉬 보유 시 쉐라그 3명(무역 스킬 강한 순)을 무역소 한 곳에 모으는 세트안을 만들되, 세트 없는 편성과 기지 총점을 비교해 이득일 때만 채택합니다. 진영 판정은 다중 소속 기준(카란 무역회사 오퍼도 쉐라그로 인정).": [
    "With SilverAsh the Rimefrost, a set plan gathers 3 Kjerag operators (strongest trading skills first) into one Trading Post, but it is adopted only if the total base score beats the no-set plan. Faction checks use multi-affiliation (Karlan Trade operators count as Kjerag).",
    "異格シルバーアッシュ所持時はイェラグ3人（貿易スキルが強い順）を貿易所1箇所に集めるセット案を作りますが、セットなしの編成と基地総合スコアを比較して得な場合のみ採用します。陣営判定は多重所属基準（カラン貿易のオペレーターもイェラグと認定）。",
  ],
  "만트라 정예 소대는 실존 정예 오퍼 수 기준으로 계산합니다 (현재 6명 → +37%, 신규 정예 오퍼 추가 시 데이터 갱신에서 자동 반영).": [
    "Mantra's elite-squad count uses the number of elite operators that actually exist (currently 6 → +37%; new elite operators are picked up automatically on data refresh).",
    "マントラの精鋭小隊は実在する精鋭オペレーター数基準で計算します（現在6人 → +37%、新規精鋭追加時はデータ更新で自動反映）。",
  ],
  "정예화 단계 (1정/2정)": ["Promotion stages (E1/E2)", "昇進段階（昇進1/昇進2）"],
  "보유 오퍼 설정에서 오퍼별로 기본값(2정 · 정예화 2)을 1정으로 낮출 수 있습니다. 정예화 2에서 해금되는 인프라 스킬을 가진 오퍼만 선택지가 보입니다.": [
    "In the roster settings you can lower an operator from the default (E2) to E1. The choice only appears for operators with base skills that unlock at Elite 2.",
    "所持オペレーター設定で、デフォルト（昇進2）を昇進1に下げられます。昇進2で解放される基地スキルを持つオペレーターにのみ選択肢が表示されます。",
  ],
  "1정으로 지정하면 해당 오퍼는 정예화 2 전용 스킬 없이 계산·자동편성됩니다 — 아직 승급 못 한 오퍼를 과대평가하지 않도록 맞춰 두세요.": [
    "Marking E1 computes and auto-assigns that operator without their Elite-2-only skills — set this so unpromoted operators aren't overrated.",
    "昇進1に指定すると、そのオペレーターは昇進2専用スキルなしで計算・自動編成されます — まだ昇進していないオペレーターを過大評価しないよう設定してください。",
  ],
  "대체 추천": ["Substitute suggestions", "代替推薦"],
  "각 자리의 대체 후보는 실제로 교체해 본 방 점수로 순위를 매기고, 동점이면 낮은 성급(육성 저렴)을 우선합니다.": [
    "Substitute candidates are ranked by the room score after an actual swap; ties prefer lower rarity (cheaper to raise).",
    "各スロットの代替候補は実際に入れ替えた部屋スコアで順位付けし、同点なら低レア（育成が安い）を優先します。",
  ],
  "토큰 생성·소비자, 오버라이드·수익 역할, 쉐이 카운트 인원 같은 시너지 코어는 '대체 불가'로 표시됩니다.": [
    "Synergy cores — token generators/consumers, override/payout roles, Sui count members — are marked 'Locked'.",
    "トークン生成・消費者、オーバーライド・収益役、スイのカウント要員などのシナジーコアは「代替不可」と表示されます。",
  ],
  "수치는 근사치": ["Numbers are approximations", "数値は近似値"],
  "숙소는 풀 인원(20명), 모집 4칸, 발전소 3(그레이 알터 시 4) 기준의 추정 상한으로 계산합니다. 실제 게임 수치와 약간 다를 수 있습니다.": [
    "Dorms are assumed full (20 operators), 4 recruitment slots, 3 power plants (4 with Greyy alter) — estimated caps. Real in-game numbers may differ slightly.",
    "宿舎は満員（20名）、募集4枠、発電所3（グレイ異格時4）基準の推定上限で計算します。実際のゲーム数値とは多少異なる場合があります。",
  ],
  "자세한 규칙 전문은 저장소의 docs/INFRA-RULES.md를 참고하세요.": [
    "For the full rule text, see docs/INFRA-RULES.md in the repository.",
    "詳細なルール全文はリポジトリの docs/INFRA-RULES.md を参照してください。",
  ],

  // ── 공채 도우미 ────────────────────────────────────────────────────────────
  "공개모집 도우미": ["Recruitment helper", "公開求人ヘルパー"],
  "게임 공개모집에 **제시된 태그 5개**를 아래에서 그대로 입력하세요. 실제 게임에서 체크할 수 있는 **최대 3개**짜리 조합 전부를 계산해, 높은 성급이 확정되는 조합부터 순서대로 보여줍니다. 성급 배지는 모집 시간 **9시간** 기준 — 6★는 고급 특별 채용이 있어야 나옵니다. 모집 시간을 낮추면 나오는 **1·2★**도 함께 표시되며, 각 결과에 필요한 시간 조건이 붙어 있습니다.": [
    "Enter the **5 tags offered** in your in-game recruitment below. Every checkable combination of **up to 3 tags** is computed and sorted so guaranteed high-rarity combos come first. Rarity badges assume a **9-hour** recruitment — 6★ only appears with Top Operator. **1★/2★** results that require lowering the timer are also shown, each with its time condition.",
    "ゲームの公開求人で**提示された5つのタグ**をそのまま下に入力してください。実際にチェックできる**最大3つ**の組み合わせをすべて計算し、高レアが確定する組み合わせから順に表示します。レア度バッジは募集時間**9時間**基準 — 星6は上級エリートがないと出ません。時間を下げると出る**星1・2**も併せて表示され、各結果に必要な時間条件が付きます。",
  ],
  "**모집 시간별 출현 성급** — 1시간~3시간 50분: **1·2·3·4★** · 4시간~7시간 30분: **2·3·4·5★** · 7시간 40분 이상: **3·4·5★**만 출현. 저격 조합은 반드시 **7시간 40분 이상(보통 9시간)**으로 돌려야 3★ 미만이 섞이지 않습니다.": [
    "**Rarities by recruitment time** — 1:00–3:50: **1·2·3·4★** · 4:00–7:30: **2·3·4·5★** · 7:40+: only **3·4·5★**. Snipe combos must run at **7:40 or longer (usually 9h)** to keep sub-3★ out.",
    "**募集時間ごとの出現レア度** — 1時間~3時間50分：**星1·2·3·4** · 4時間~7時間30分：**星2·3·4·5** · 7時間40分以上：**星3·4·5**のみ。狙い撃ちは必ず**7時間40分以上（通常9時間）**で回さないと星3未満が混ざります。",
  ],
  "자격": ["Qualification", "資格"],
  "위치": ["Position", "位置"],
  "빠른 입력 — 태그 첫 글자를 이어서 입력 (예: 가메신생범)": ["Quick input — type the first letters of tags in a row", "クイック入力 — タグの頭文字を続けて入力"],
  "태그 첫 글자 빠른 입력": ["Quick input by tag first letters", "タグ頭文字クイック入力"],
  "클리어": ["Clear", "クリア"],
  "제시된 태그 {n}/5 · 체크 조합은 3개까지 계산": ["Offered tags {n}/5 · combos of up to 3 checks computed", "提示タグ {n}/5 · チェックは3つまでの組み合わせを計算"],
  "태그를 선택하면 조합 결과가 여기에 표시됩니다.": ["Pick tags and combo results will appear here.", "タグを選ぶと組み合わせ結果がここに表示されます。"],
  "{n}★ · 저시간 전용": ["{n}★ · low-time only", "{n}★ · 低時間限定"],
  "{n}★ 확정": ["{n}★ guaranteed", "{n}★確定"],
  "{n}★ 이상": ["{n}★ or higher", "{n}★以上"],
  "추가 예정": ["Coming soon", "追加予定"],
  "3:50 이하": ["≤ 3:50", "3:50以下"],
  "7:30 이하": ["≤ 7:30", "7:30以下"],
  "1·2★는 모집 시간을 낮춰야 등장합니다 — **1★는 3시간 50분 이하**, **2★는 7시간 30분 이하**. 9시간 설정 시에는 나오지 않습니다.": [
    "1★/2★ only appear when the timer is lowered — **1★ at 3:50 or less**, **2★ at 7:30 or less**. They never show up at 9 hours.",
    "星1・2は募集時間を下げないと出ません — **星1は3時間50分以下**、**星2は7時間30分以下**。9時間設定では出現しません。",
  ],
  "4·5성 저격 조합 사전": ["4★/5★ snipe combo dictionary", "星4・5狙い撃ち組み合わせ辞典"],
  "접기 ▲": ["Collapse ▲", "閉じる ▲"],
  "펼치기 ({n}개 조합) ▼": ["Expand ({n} combos) ▼", "開く（{n}組）▼"],
  "특별 채용·고급 특별 채용 없이도 **4★ 이상이 확정**되는 최소 태그 조합 전체입니다. 모집 태그에 아래 조합이 뜨면 놓치지 마세요. (태그를 더 얹어도 확정은 유지됩니다)": [
    "Every minimal tag combination that **guarantees 4★ or higher** without Senior/Top Operator. Don't miss these when they appear in your tags. (Adding more tags keeps the guarantee.)",
    "エリート・上級エリートなしでも**星4以上が確定**する最小タグ組み合わせの全リストです。募集タグに下の組み合わせが出たら見逃さないでください。（タグを追加しても確定は維持されます）",
  ],

  // ── 재료 파밍 효율표 ───────────────────────────────────────────────────────
  "재료 파밍": ["Farming", "素材周回"],
  "재료 파밍 효율표": ["Material Farming Efficiency", "素材周回効率表"],
  "재료 파밍 효율표 - 명일방주 파밍 가이드 | 테라 아카이브": ["Material Farming Efficiency - Arknights Farming Guide | Terra Archive", "素材周回効率表 - アークナイツ周回ガイド | テラアーカイブ"],
  "정예화 재료 {count}종의 실측 드랍 통계입니다. 재료마다 어느 스테이지에서 나오는지와 개당 기대 이성(이성 소모 ÷ 드랍률)을 표시하고, 이성 대비 획득 확률이 가장 높은 스테이지에 최고 효율 배지를 붙입니다.": [
    "Measured drop statistics for {count} elite materials. Each material lists the stages it drops from with the expected sanity per drop (sanity cost ÷ drop rate), and the stage with the best drop odds per sanity gets the Best badge.",
    "昇進素材{count}種の実測ドロップ統計です。素材ごとにドロップするステージと1個あたりの期待理性（理性消費 ÷ ドロップ率）を表示し、理性あたりの入手確率が最も高いステージに最高効率バッジを付けます。",
  ],
  "출처: 펭귄 물류 실측 통계(표본 {min}회 이상) + 클뜯 게임 데이터 · {date} 기준 한국 서버에 개방된 스테이지만 수록 · 기대 이성은 낮을수록 좋습니다.": [
    "Source: Penguin Statistics measured data (min. {min} samples) + datamined game data · only stages open on the KR server as of {date} · lower expected sanity is better.",
    "出典：ペンギン急便の実測統計（標本{min}回以上）+ データマインのゲームデータ · {date}時点で韓国サーバーに開放中のステージのみ収録 · 期待理性は低いほど良いです。",
  ],
  "등급 필터": ["Tier filter", "レア度フィルター"],
  "재료 이름 검색": ["Search material names", "素材名で検索"],
  "재료 이름·별명 검색": ["Search materials by name or nickname", "素材名・愛称で検索"],
  "상시 파밍 가능한 스테이지만 (이벤트 한정 제외)": ["Permanently farmable stages only (exclude limited events)", "常時周回可能なステージのみ（期間限定イベント除外）"],
  "조건에 맞는 재료가 없어요.": ["No materials match these filters.", "条件に合う素材がありません。"],
  "스테이지": ["Stage", "ステージ"],
  "드랍률": ["Drop rate", "ドロップ率"],
  "기대 이성": ["Exp. sanity", "期待理性"],
  "이성 {n} 소모": ["Costs {n} sanity", "理性{n}消費"],
  "표본 {n}회": ["{n} samples", "標本{n}回"],
  "최고 효율": ["Best", "最高効率"],
  "상설": ["Permanent", "常設"],
  "이벤트 한정": ["Limited event", "期間限定"],
  "물자": ["Supply", "物資"],

  // ── AI 스토리 요약 ─────────────────────────────────────────────────────────
  "스토리 요약": ["Story Digest", "ストーリー要約"],
  "AI 이벤트 스토리 요약": ["AI Event Story Digest", "AIイベントストーリー要約"],
  "AI 이벤트 스토리 요약 - 명일방주 이벤트 스토리 요약 | 테라 아카이브": ["AI Event Story Digest - Arknights Event Story Summaries | Terra Archive", "AIイベントストーリー要約 - アークナイツイベントストーリー要約 | テラアーカイブ"],
  "한국 서버에 풀린 사이드 스토리 {count}개의 아카이브입니다. AI가 스토리 스크립트 전문을 정독하고 컷씬과 함께 10분 분량으로 요약합니다. 현재 {done}개 수록 — 계속 추가됩니다.": [
    "An archive of all {count} side stories released on the KR server. AI reads the full story scripts and condenses each into a 10-minute digest with cutscenes. {done} available now — more on the way.",
    "韓国サーバーで公開されたサイドストーリー{count}件のアーカイブです。AIがストーリースクリプト全文を読み込み、カットシーン付きの10分ダイジェストにまとめます。現在{done}件収録 — 順次追加されます。",
  ],
  "요약에는 결말 포함 스포일러가 있습니다. 이벤트 제목·썸네일 출처: 게임 데이터 · {date} 기준.": [
    "Digests contain full spoilers including endings. Event titles & thumbnails from datamined game data · as of {date}.",
    "要約には結末を含むネタバレがあります。イベント名・サムネイルの出典：ゲームデータ · {date}時点。",
  ],
  "이벤트 이름 검색": ["Search event names", "イベント名で検索"],
  "조건에 맞는 이벤트가 없어요.": ["No events match your search.", "条件に合うイベントがありません。"],
  "AI 요약": ["AI digest", "AI要約"],
  "요약 준비 중": ["Digest coming soon", "要約準備中"],
  "에피소드 {n}개": ["{n} episodes", "エピソード{n}話"],
  "스토리 목록으로": ["Back to story list", "ストーリー一覧へ"],
  "이 요약은 AI가 게임 내 스토리 스크립트 전문을 읽고 쓴 2차 창작 요약입니다.": [
    "This digest is a fan-made summary written by AI after reading the full in-game story script.",
    "この要約はAIがゲーム内ストーリースクリプト全文を読んで書いた二次創作の要約です。",
  ],
  "요약 본문은 현재 한국어로만 제공됩니다.": ["Digest text is currently available in Korean only.", "要約本文は現在韓国語のみ提供しています。"],
  "등장인물": ["Cast", "登場人物"],
  "오퍼레이터 정보 보기": ["View operator details", "オペレーター情報を見る"],

  // ── 피드백 위젯 ────────────────────────────────────────────────────────────
  "제안 보내기": ["Send Feedback", "フィードバックを送る"],
  "기능 제안": ["Feature idea", "機能提案"],
  "데이터 오류 리포트": ["Data error report", "データ誤りの報告"],
  "이런 기능이 있으면 좋겠어요…": ["It would be great if…", "こんな機能が欲しい…"],
  "어떤 오퍼의 어떤 데이터가 잘못됐는지 알려주세요": ["Tell us which operator's data is wrong", "どのオペレーターのどのデータが誤っているか教えてください"],
  "보냈습니다, 감사합니다!": ["Sent — thank you!", "送信しました、ありがとうございます！"],
  "익명으로 전송됩니다": ["Sent anonymously", "匿名で送信されます"],
  "보내기": ["Send", "送信"],
  "💬 제안": ["💬 Feedback", "💬 提案"],
};

export type T = (key: string, vars?: Record<string, string | number>) => string;

export function makeT(locale: Locale): T {
  const index = locale === "en" ? 0 : 1;
  return (key, vars) => {
    let out = locale === "ko" ? key : D[key]?.[index] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
    return out;
  };
}

// **굵게** 마크업을 <b>로 렌더링 — 사전 문자열 안에서 강조를 유지하기 위한 최소 문법
export function rich(s: string): React.ReactNode {
  const parts = s.split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return s;
  return parts.map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

type I18nValue = { locale: Locale; t: T };
const I18nContext = createContext<I18nValue>({ locale: "ko", t: makeT("ko") });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = React.useMemo(() => makeT(locale), [locale]);
  return <I18nContext.Provider value={{ locale, t }}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

// ── 로케일 게임 데이터 오버레이 (플래너·공채 표시용) ─────────────────────────
// ko는 null(정적 KR 데이터 그대로), en/ja는 home-en/ja.tsx가 extra-i18n.*.json을
// 정적 import해 prop으로 내려준다 — 라우트별 번들에만 포함된다.
export type ExtraI18n = {
  names: Record<string, string>;
  recruitTags: Record<string, string>;
  buffs: Record<string, { name: string; desc: string }>;
  rooms: Record<string, string>;
};
