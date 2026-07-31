// ── 컨셉덱 검색 ──────────────────────────────────────────────────────────────
// 컨셉덱은 원래 태그 40여 개를 벽처럼 깔아 놓고 고르는 방식이었는데, 사용자가 실제로
// 쓰는 말(“슬로우”, “트루뎀”, “록라모듈”)과 태그 이름(“감속·정지”, “트루 대미지”)이
// 달라서 찾지를 못했다. 그래서 **입력 + 검색 버튼**으로 바꾸고(사용자 요청 2026-08-01),
// 여기서 별칭을 태그 키로 옮겨 준다.
//
// 규칙
//  · 태그 키(한국어)와 EN/JA 표시명은 코드가 알아서 후보에 넣는다 — 여기엔 **줄임말·
//    다른 이름·오타 변형만** 적는다.
//  · 정확히 일치하는 별칭이 있으면 **그것만** 쓴다 (“은신”이 은신 감지까지 끌고 오지
//    않도록). 정확히 맞는 게 없을 때만 부분 일치로 넓힌다.
//  · 태그로는 표현이 안 되는 조건(통합전략 전용 모듈 보유 등)은 SPECIAL_CONCEPTS에
//    술어로 넣는다 — 키가 "@"로 시작해 태그 키와 절대 겹치지 않는다.
import { conceptName, type Locale } from "./i18n";

export type ConceptTarget = { concepts: string[]; modules: { type: string }[] };

// 게임의 특수 모듈 — uniequip 테이블에서 typeName2가 A·B인 것(isSpecial). 통합전략(ISW-·SO-)과
// 생존 연산(RA-) 전용이고, 일반 모듈은 X·Y·D라 여기 걸리지 않는다.
const isSpecialModule = (type: string) => {
  const suffix = type.split("-").pop();
  return suffix === "A" || suffix === "B";
};

export const SPECIAL_CONCEPTS: {
  key: string; label: string; aliases: string[]; match: (op: ConceptTarget) => boolean;
}[] = [
  {
    key: "@통합전략모듈",
    label: "통합전략 전용 모듈",
    aliases: ["알파모듈", "록라모듈", "로그라이크모듈", "통합전략모듈", "is모듈", "isw",
      "특별한정배지", "통합전략", "록라", "로그라이크", "rogue module", "is module"],
    match: (op) => op.modules.some((m) => isSpecialModule(m.type) && !m.type.startsWith("RA-")),
  },
  {
    key: "@생존연산모듈",
    label: "생존 연산 전용 모듈",
    aliases: ["생존연산모듈", "ra모듈", "생존연산", "reclamation", "ra module"],
    match: (op) => op.modules.some((m) => m.type.startsWith("RA-")),
  },
];

const SPECIAL_BY_KEY = new Map(SPECIAL_CONCEPTS.map((entry) => [entry.key, entry]));

// 태그 키 → 사람들이 실제로 치는 말
const ALIASES: Record<string, string[]> = {
  // 시너지 팟 — 팟 이름에서 “팟”을 뺀 진영명으로 많이 친다
  "어비설팟": ["어비설", "어비셜", "어비스", "심연", "abyssal"],
  "쉐이팟": ["쉐이", "염쉐이", "sui"],
  "쉐라그팟": ["쉐라그", "예라그", "이에라그", "kjerag"],
  "카시미어팟": ["카시미어", "기사", "kazimierz"],
  "미노스팟": ["미노스", "minos"],
  "아베무팟": ["아베무", "아베무지카", "뱅드림", "ave mujica"],
  "소각팟": ["소각", "연소", "화상", "burn"],
  "라테라노팟": ["라테라노", "laterano"],
  "탄약팟": ["탄약", "총알", "ammo"],
  "라인랩팟": ["라인랩", "라인생명", "rhine lab", "rhine"],
  "라이오스 파티": ["라이오스", "던전밥", "laios"],
  // 일반 컨셉
  "아군 치유": ["힐", "힐러", "치유", "치료", "회복력", "heal", "healer"],
  "공격 회복": ["공회", "공격시회복", "공격형sp"],
  "피격 회복": ["피회", "피격시회복", "방어형sp"],
  "자가 회복": ["자힐", "자가치유", "셀프힐"],
  "SP 배터리": ["sp", "sp배터리", "배터리", "sp회복", "sp회복속도증가", "sp충전", "충전", "sp수급"],
  "기절": ["스턴", "스탠", "stun"],
  "수면": ["슬립", "재움", "sleep"],
  "공격 중지": ["침묵", "무장해제", "공격봉인", "silence"],
  "감속·정지": ["슬로우", "감속", "정지", "이동속도감소", "이속감소", "둔화", "slow"],
  "회피": ["닷지", "회피율", "물리회피", "dodge"],
  "소환물·장치": ["소환물", "장치", "소환", "드론", "인형", "분신", "summon"],
  "체력 비례": ["체력비례", "hp비례", "체비", "최대체력비례"],
  "대공": ["공중", "비행", "대공격추", "anti air"],
  "보호막": ["실드", "방어막", "쉴드", "shield"],
  "반사": ["가시", "대미지반사", "반격", "thorn", "reflect"],
  "방어 무시": ["방무", "방어관통", "방깎무시", "물리관통"],
  "속박": ["바인드", "결박", "구속", "bind"],
  "지속 피해": ["도트", "출혈", "중독", "독", "dot"],
  "취약": ["받피증", "받는피해증가", "피해증폭", "fragile"],
  "원소 피해": ["원소", "침식", "신경손상", "원소손상", "elemental"],
  "강제 이동": ["강제이동", "변위", "밀치기", "넉백", "끌어당기기", "견인", "push", "pull"],
  "쾌속 배치": ["쾌배", "쾌속배치", "고속재배치", "재배치", "fast redeploy"],
  "불사·생존": ["불사", "생존", "부활", "무적", "즉사방지"],
  "은신·위장": ["은신", "스텔스", "위장", "투명", "invisible", "stealth"],
  "은신 감지": ["은신감지", "투명감지", "은신탐지", "스텔스감지"],
  "마법 저항 감소": ["마저감소", "마저깎", "술내성감소", "res감소"],
  "트루 대미지": ["트루뎀", "트루댐", "트루대미지", "확정대미지", "고정대미지", "true damage"],
  "방어력 감소": ["방깎", "방어감소", "def감소"],
  "냉기·빙결": ["빙결", "냉기", "동결", "얼음", "결빙", "freeze", "cold"],
  "마법 저항 무시": ["마저무시", "술내성무시", "마법관통", "res무시"],
  "힐링 디펜더": ["힐탱", "힐디", "치유디펜더"],
  "소환사": ["서머너", "summoner"],
  "음유시인": ["바드", "bard"],
  "리퍼": ["reaper"],
  "함정": ["트랩", "trap"],
  "포트리스": ["요새", "fortress"],
  "공포": ["도주", "fear"],
  "체력 소모": ["체력소모", "hp소모", "자해", "피깎"],
};

// 표기 흔들림을 지운다 — 가운뎃점·공백·하이픈은 사람마다 다르게 친다
const norm = (s: string) => s.toLowerCase().replace(/[\s·・/_.'"-]+/g, "");

// 특수 컨셉의 표시명도 CONCEPT_I18N(i18n.tsx)에 KR 라벨을 키로 넣어 뒀다
export function conceptTitle(locale: Locale, key: string): string {
  return conceptName(locale, SPECIAL_BY_KEY.get(key)?.label ?? key);
}

export function conceptMatches(key: string, op: ConceptTarget): boolean {
  const special = SPECIAL_BY_KEY.get(key);
  return special ? special.match(op) : op.concepts.includes(key);
}

// 한 컨셉이 가진 검색어 후보 — 태그 키 + 3개 로케일 표시명 + 별칭
function keywordsOf(key: string): string[] {
  const special = SPECIAL_BY_KEY.get(key);
  if (special) return [special.label, ...special.aliases];
  return [key, conceptName("en", key), conceptName("ja", key), ...(ALIASES[key] ?? [])];
}

/** 검색어 → 컨셉 키들. 정확히 맞는 게 있으면 그것만, 없으면 부분 일치로 넓힌다. */
export function resolveConcepts(query: string, keys: string[]): string[] {
  const q = norm(query);
  if (!q) return [];
  const exact: string[] = [], partial: string[] = [];
  for (const key of keys) {
    const words = keywordsOf(key).map(norm);
    if (words.some((w) => w === q)) exact.push(key);
    else if (words.some((w) => w.includes(q))) partial.push(key);
  }
  return exact.length ? exact : partial;
}

/** 입력 중 보여줄 후보 — 검색과 같은 규칙이되 정확 일치도 목록에 남긴다. */
export function suggestConcepts(query: string, keys: string[], limit = 8): string[] {
  const q = norm(query);
  if (!q) return [];
  const head: string[] = [], tail: string[] = [];
  for (const key of keys) {
    const words = keywordsOf(key).map(norm);
    if (words.some((w) => w.startsWith(q))) head.push(key);
    else if (words.some((w) => w.includes(q))) tail.push(key);
  }
  return [...head, ...tail].slice(0, limit);
}
