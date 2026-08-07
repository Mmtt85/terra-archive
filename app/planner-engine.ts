// 인프라 플래너 엔진 (L0) — 절대룰·점수 모델·자동편성·전수 감사. React/UI 의존 없음.
// 규칙 계층: L0(이 파일) 절대룰·점수 결합 방식 / L1 게임 팩트(data/infra.json) /
// L2 유동 규칙(data/rules.json — 상수·토큰 카탈로그·파서 교정·검증 픽스처, app/rules.ts 로더).
// 도메인 규칙 정본은 docs/INFRA-RULES.md. UI는 app/planner.tsx.
// ⚠ 이 파일이나 rules.json을 고치면 반드시 `node scripts/verify-plan.mjs`로 회귀 검증할 것 —
// 픽스처(검증된 정배)와 스냅샷이 "굼 없는 레토"류 회귀를 커밋 전에 잡는다.
import infraData from "./data/infra.json";
import { C, RULES, type SynergySetDef } from "./rules";

export type TokenGen = { token: string; estimate: number; perMember?: { per: number; cap: number; match: string }; perDormLevel?: number };
export type TokenUse = { token: string; per: number; value: number; percent: boolean };

// 용량(오더 상한/창고 용량) → 출력(효율/생산력) 변환기. 팀이 쌓은 용량을 다시 % 로 바꾼다.
//  lin    버메일 재활용(+2%/용량)·스와이어 투자 유치(+4%/상한)
//  bundle 데겐블레허 챔피언의 품격(제공 상한 per개당 rate%, 최대 max)
//  tier   버블 큰 게 좋아(≤at칸 lo%/칸, 초과분 hi%/칸)
//  diff   제이 시장경제(기본상한+팀용량 1당 rate%, 현재 오더 0 가정 — 유리 분기 관례)
// over = 이 변환기가 **죽이는** 다른 변환 스킬 이름 (버블 '큰 게 좋아!' 원문:
// "재활용 스킬과 중첩되지 않음. 우선으로 발동됨" — 사용자 제보 2026-07-29).
export type CapConv = { over?: string[] } & (
  | { t: "lin"; rate: number }
  | { t: "bundle"; per: number; rate: number; max: number | null }
  | { t: "tier"; at: number; lo: number; hi: number }
  | { t: "diff"; rate: number });

// 증폭형 (와이후 협동의식·스노우상트 근면성실): 같은 방 오퍼가 제공한 효율(시설 기반 제외)의
// per% 마다 add% 를 추가로 되돌린다(계단식). cap = 이 스킬이 제공하는 상한.
export type AmpSpec = { per: number; add: number; cap: number };

export type InfraSkill = {
  buffId?: string;   // 다국어 오버레이(extra-i18n) 매핑 키
  krName?: string;   // 표시명을 로케일로 바꿔도 로직(스킬 태그 카운트)은 KR 이름 기준
  name: string;
  room: string;
  unlock: string;
  description: string;
  kind: string;
  value: number;
  product: string;
  group: string;
  tier: number;
  moraleDrain: number;
  partners: string[];
  tokenGen: TokenGen[];
  tokenUse: TokenUse[];
  convert: { from: string; per: number; to: string; amount: number } | null;
  facilityBased?: boolean;
  facRoom?: string;    // facilityBased 단위 시설 (TRADING 등) — 활성 레이아웃 시설 수로 재계산 (2026-07-24)
  facPer?: number;     // facilityBased 시설 1개당 단위값 (value = facPer × 243 시설 수로 구움)
  // 배타 시설 수 비교 분기 (왕 '임기응변': 외세 = 무역소+발전소 수, 실리 = 제조소 수 —
  // 외세 ≥ 실리면 a(무역 오라), 실리 > 외세면 b(제조 오라)). 구운 kind/value는 243 기준이며,
  // 엔진이 활성 레이아웃의 시설 수로 분기를 다시 판정한다 (동수는 a — "크거나 같을 경우")
  facCompare?: { a: { rooms: string[]; kind: string; value: number }; b: { rooms: string[]; kind: string; value: number } };
  // 시간 성장형 (아로마·크루스·씬·팽·케오베·스푸리아·이네스, 2026-07-25): k시간째 값 =
  // min(first + rate×(k−1), cap). 교대마다 리셋되므로 구운 value = 24h 기준 교대 평균이고,
  // 엔진이 실제 편성의 교대 시계(ctx.shiftHours)로 재계산한다
  growHourly?: { first: number; rate: number; cap: number };
  // 특별 오더 (클로저·U-Official, 2026-08-05): 그 무역소가 받는 순금 오더를 **전부** 자기
  // 고정 오더로 대체한다. 값은 일반 오더 풀 대비 **시간당 용문폐 배수**(%)이며 방 처리량에
  // 곱으로 걸린다(프로바이조 payout_v와 같은 구조). 오더 풀 자체가 갈리므로 같은 방의
  // 품질 확률·품질 수익(테킬라)·위약 수익(프로바이조)은 전부 죽는다 — 유도는 INFRA-RULES.
  orderFix?: number;
  drainRoom?: number;             // "방 내 (모든) 오퍼레이터의 시간당 컨디션 소모 ±X" (슈 -0.1·'아' +1.5·파이어휘슬 -0.1·샤마르 속삭임 +0.25)
  // 근무 중 컨디션 회복 구조 필드 (무한동력 모드, 2026-07-27 — build-infra.py parse_recover):
  recoverRoom?: number;           // "제어 센터 내 모든 오퍼레이터의 시간당 컨디션 회복 +X" 고정형 (도베르만류)
  recoverRoomPer?: { faction: string; value: number }; // "<그룹> 1명 증가할 때마다 방 전체 회복 +X" (레인보우 팀 — 4보유×5명×0.05 = 소모 1.0 정확 상쇄)
  recoverAura?: { scope: string; value: number; perToken?: { token: string; per: number; add: number } }; // 제어센터→기타/일부 시설 횡단 회복 (위셔델·총웨·무에나)
  selfDrainNegate?: string | null; // "<진영> 오퍼레이터 본인의 컨디션 소모 영향 제거" (링: 쉐이)
  goldLine?: { per: number; add: number; base: number } | null; // 순금 라인 N개당 +add% (투예·파죰카) — 활성 레이아웃 순금방 수로 재계산
  // 시설 레벨 연동 단위값 (전력·레벨 시스템 2026-07-24) — baked value는 만렙 기준,
  // 엔진이 실제 레벨과의 차이만큼 보정한다: value + per×(현재 − 만렙), 하한 0
  dormLevels?: { per: number };     // "모든 숙소의 레벨 1당 +N%" (아르케토·틴맨·나란투야·필라에, 만렙 합 20)
  meetingLevel?: { per: number };   // "응접실 레벨 1당 추가 +N%" (비질·미틈, 만렙 3)
  trainingLevel?: { per: number };  // "훈련실 레벨 1당 +N%" (Вий, 만렙 3)
  roboLevels?: { cap: number; per: number; add: number }; // 공사용 로봇 = 전 시설 레벨 합(만렙 64) — floor(합/per)×add (미니멀리스트)
  basePartners?: string[];      // 기지 어디든(숙소 포함) 있으면 발동하는 동반 조건
  basePartnerBonus?: number | null; // 위 조건 충족 시 추가 효율 (언더플로우 +10)
  // 시설 집합 동반 조건 (외드레르 '자수성가', 2026-07-25): "이네스와 W가 **작업 시설**에 배치 시
  // 각각 추가로 +5%". 같은 방 동반(partners)도 숙소 포함 기지 전체(basePartners)도 아니라,
  // 용어 사전이 정의하는 시설 집합(작업 시설 = 발전소·제조소·무역소·사무실·응접실·제어 센터·
  // 훈련실, **숙소·가공소 제외**)에 있으면 **파트너 1명당** 가산된다.
  workPartners?: string[];
  workPartnerBonus?: number | null;
  workRooms?: string[];         // 조건을 충족하는 방 코드 (용어 사전 정의에서 파싱)
  gateFaction?: string | null;  // "쉐라그 3명 배치된 무역소" 류 — 진영 N명 배치 조건
  gateCount?: number | null;
  gatePlatforms?: number | null; // "작업 플랫폼 2대+ 발전소 배치 시" (푸딩) — 자동편성 미충족 조건
  roomPartner?: { id: string; room: string } | null; // "만약 굼이 무역소에 배치되어 있다면" (레토) — 교차방 파트너
  // 내보내는 교차방 오라 (저스티스 나이트 '띠띠~, 가동!', 사용자 제보 2026-08-07):
  // "발전소에 배치 시, **와일드메인이 배치된 제조소**의 생산력 +5%". roomPartner와 방향이
  // 반대다 — roomPartner는 남의 방을 보고 내 방에 적용, 이건 내가 앉으면 남의 방에 적용.
  // 데이터 전체에서 이 형태는 이 스킬 하나뿐. 짝이 앉은 **그 방 한 곳**에만 붙는다.
  crossBuff?: { partner: string; room: string; value: number } | null;
  belowThreshold?: number | null; // "누적 속도 30% 미만인 경우" 류 — 대상 방 수치가 임계값 미만일 때만 (사일라흐)
  reqFaction: string | null;
  // 명단형 그룹 동석 게이트 (레우스S·키린R '아이루와 유쾌한 친구들' — 진영 데이터에 없는
  // 게임 내부 그룹이라 용어 사전 명단으로 판정한다, 2026-07-25)
  reqGroup?: { term?: string; name?: string; ids: string[] } | null;
  // 그룹원이 앉은 **시설(칸) 수** 1개당 가산 (타락사쿰 '쉐이'·만트라/켈시 이격 '정예',
  // 2026-07-25): count = min(게임 상한, 실존 오퍼 수). 배치 지도가 없으면 상한 낙관 적용.
  perFacility?: { group?: string; ids: string[]; per: number; cap: number; count: number } | null;
  perFaction: string | null;
  perScope: string | null;
  perCap: number | null;
  perProduct?: Record<string, number> | null; // 생산품별 부호 오라 (플레임테일: {exp:+10, gold:-10} — 1명당)
  perSkillTag: string | null;
  perSkillValue: number | null;
  cap?: number;        // 이 스킬의 오더 상한/창고 용량 기여 (±N; perFaction이면 엔진이 인원수로 스케일)
  capConv?: CapConv;   // 팀 용량 합을 효율/생산력으로 변환 (버메일·버블·데겐블레허·스와이어·제이)
  amp?: AmpSpec | null; // 증폭형 (와이후·스노우상트): 팀 제공 효율을 배수로 되돌림
  perBase?: number;    // per-faction 스케일과 별개로 항상 더하는 flat 기본치 (뮤엘시스: 회복 +10% + 라인랩/명)
  perExclSelf?: boolean; // "자신을 제외한 <진영> 1명당" — 본인이 그 진영이면 카운트에서 제외 (뮤엘시스)
  condBonus?: { value: number; faction?: string; ids?: string[]; room?: string } | null;
                       // 조건부 가산: 같은 방 진영(faction)/오퍼(ids)/타방(ids+room) 충족 시 +value (르무엔·비나 등)
  families?: string[]; // 이 스킬이 속한 "~류" 계열 태그 (build-infra.py skillFamilies 카탈로그)
  tiers?: InfraSkill[]; // 같은 슬롯의 하위 정예화 단계 (스푸리아 기술 교류 α) — 정예화 낮추면 대체
  termRefs?: [string, string][]; // 설명 속 게임 용어 참조 [키, 표시어] — 클릭 시 TERMS 정의 표시 (2026-07-24)
};

// RIIC 용어 정의 (외세·실리·시라쿠사 등) — 스킬 설명 용어 클릭 팝업용.
// desc의 개행은 의미 단위(오퍼 명단 줄 등), refs는 정의 속 다른 용어 참조.
export type InfraTerm = { name: string; desc: string; refs?: [string, string][]; ops?: string[] };

export type InfraOp = {
  id: string;
  name: string;
  rarity: number;
  job: string;          // 직군 표시명 (뱅가드·가드 …)
  jobCode: string;      // 직군 정렬 순서의 정본 (PIONEER·WARRIOR …)
  subProfession: string;
  birthplace: string;
  race: string;
  faction: string;
  factions?: string[]; // 다중 소속 (마터호른: 카란 무역회사 + 쉐라그) — 진영 카운트는 전부 인정
  accent: string;
  image: string;
  seq: number;
  skills: InfraSkill[];
  unreleased?: boolean; // KR 미실장(중국 선행) — '미래시 데이터 포함' 토글이 켜져야 로스터에 노출
  elite?: Elite; // withElite가 스탬프하는 정예화 단계 (미지정=2정). 응접실 레어도 기본 단서속도 계산용
  level?: number; // withElite가 스탬프하는 레벨 (미지정=제한 없음). 'Lv.30' 해금 스킬 판정용
};

// 직군 정렬 순서·정렬 키 — 백과사전(home.tsx)과 동일 (보유 오퍼 설정 정렬용)
export const JOB_ORDER = ["PIONEER", "WARRIOR", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"];
export const ROSTER_SORT_KEYS = ["기본", "이름", "성급", "발매순", "소속", "출신지", "종족", "직군", "세부 직군"];

export const factionsOf = (op: InfraOp): string[] => op.factions ?? [op.faction];

// 진영 또는 명단형 그룹(OP_GROUPS — 비비아나 '기사' 등, L2 카탈로그) 소속 판정.
// 게임이 내부적으로만 아는 그룹은 진영 데이터에 없어 rules.json 명단으로 센다 (PRTS 근거)
export const memberOf = (op: InfraOp, name: string): boolean =>
  factionsOf(op).includes(name) || ((C.OP_GROUPS ?? {})[name] ?? []).includes(op.id);

export type RoomSpec = {
  name: string; slots: number; electricity: number; maxCount: number;
  drain?: number; // 시간당 기본 컨디션 소모 (근무방 1/h·가공소·숙소 0 — 게임 팩트, 교대 시계용)
  // 레벨별 스펙 (전력·시설 레벨 시스템 2026-07-24): phases[레벨-1] = {슬롯, 전력}.
  // 발전소 +60/+130/+270, 제조·무역 슬롯 1/2/3, 제어센터 슬롯=레벨(1~5), 숙소 Lv1~5 전력만 증가
  // fx 필드 (2026-07-24, 방 상세 레벨 표): 방 종류별 레벨 기능 — 오더 상한·등급(무역),
  // 보관함(제조), 회복·분위기(숙소), 친구 상한(응접), 특화 상한(훈련), 레시피 누적(가공)
  phases?: { slots: number; electricity: number; orderLimit?: number; orderRarity?: number; capacity?: number; recover?: number; ambience?: number; friendSlots?: number; specLimit?: number; recipes?: number }[];
};

export const infra = infraData as { rooms: Record<string, RoomSpec>; ops: InfraOp[] };
export const TERMS: Record<string, InfraTerm> =
  (infraData as unknown as { terms?: Record<string, InfraTerm> }).terms ?? {};
export const ops = infra.ops;
export const opById = new Map(ops.map((op) => [op.id, op]));

/**
 * 내보내는 교차방 오라 색인 — **짝 id** → 그 짝을 지목한 제공자들 (2026-08-07 사용자 제보).
 *
 * 저스티스 나이트 '띠띠~, 가동!'("발전소에 배치 시, 와일드메인이 배치된 제조소의 생산력
 * +5%")이 유일한 사례다. 제공자는 대상 방에 없으므로 breakdown이 제공자를 훑을 기회가
 * 없다 — 그래서 **짝 쪽에서** 역참조한다. 짝은 그 방 팀에 정확히 한 번 나오므로 중복
 * 가산이 없고, "짝이 앉은 그 방 한 곳에만"이라는 방 단위 의미도 자연히 지켜진다.
 *
 * 색인은 전역 ops 기준이다 — 정예화 하향(withElite)으로 제공자 스킬이 잠기는 경우를
 * 반영하지 못하지만, 현 유일 사례가 1성 로봇의 Lv.30 스킬이라 잠길 일이 없다.
 * 정예화 게이트가 걸린 crossBuff가 새로 생기면 그때 로스터 기준으로 옮길 것.
 */
export const crossBuffByPartner = (() => {
  const map = new Map<string, { providerId: string; fromRoom: string; room: string; value: number }[]>();
  for (const op of ops) {
    for (const skill of op.skills) {
      for (const sk of [skill, ...(skill.tiers ?? [])]) {
        if (!sk.crossBuff) continue;
        const list = map.get(sk.crossBuff.partner) ?? [];
        list.push({ providerId: op.id, fromRoom: sk.room, room: sk.crossBuff.room, value: sk.crossBuff.value });
        map.set(sk.crossBuff.partner, list);
      }
    }
  }
  return map;
})();

export type Elite = 0 | 1 | 2;

// 미지정 = 2정(최대) 가정. 1정은 '정예화 2' 해금 스킬을, 0정(노정예)은
// '정예화 1'·'정예화 2' 해금 스킬을 아직 못 쓴다 (Lv.1/Lv.30 스킬은 유지)
export const eliteLocks = (unlock: string, elite: Elite) => unlock === "정예화 2" || (elite === 0 && unlock === "정예화 1");
// 레벨 해금 — 기지 스킬 해금 조건은 (정예화, 레벨) 쌍이고 데이터의 unlock은 그중 하나다.
// 'Lv.30'(16종)은 **노정예 Lv.30**이 조건이라, 정예화 1 이상이면 E0 만렙(≥30)을 거쳤으므로
// 자동 충족이다. 레벨 미지정(undefined)은 제한 없음 — 옛 저장분·가져오기 미지정분 보존.
export const LEVEL_UNLOCK = 30;
export const levelLocks = (unlock: string, elite: Elite, level: number | undefined) =>
  unlock === "Lv.30" && elite === 0 && level != null && level < LEVEL_UNLOCK;
export function withElite(op: InfraOp, elite: Elite | undefined, level?: number): InfraOp {
  // 정예화 미지정은 **그 레어도의 최대 승급**으로 해석한다 — 'Lv.30' 해금 스킬은 전부
  // 1~2성(승급이 없어 항상 노정예)이라, 미지정을 그냥 통과시키면 레벨이 무시된다.
  // 저레어도엔 정예화 해금 스킬이 없어(1~2성 0건·3성은 '정예화 1'까지) 이 폴백이
  // 기존 판정을 바꾸지 않는다 (2026-08-04 데이터 실측).
  const eff = elite ?? maxElite(op.rarity);
  // 2정은 스킬 필터링이 필요 없다 (레벨 조건도 이미 넘긴 상태)
  if (eff === 2) return op;
  const locked = (unlock: string) => eliteLocks(unlock, eff) || levelLocks(unlock, eff, level);
  const skills: InfraSkill[] = [];
  for (const skill of op.skills) {
    if (!locked(skill.unlock)) { skills.push(skill); continue; }
    // 정예화·레벨로 잠긴 스킬 — 같은 슬롯의 하위 단계(기술 교류 α 등)가 있으면 그걸로 대체.
    // 없으면(순수 정예화 해금 스킬) 통째로 빠진다.
    const lower = (skill.tiers ?? []).filter((t) => !locked(t.unlock));
    if (lower.length) skills.push(lower[lower.length - 1]);
  }
  return { ...op, elite: eff, level, skills };
}

// 응접실 단서 수집 속도는 RIIC 스킬과 별개로 레어도·정예화 기본치가 가산된다
// (Terra Wiki): 3성↓ +5 / 4성 +7 / 5성 +9 / 6성 +10, 정예화 E1 +8 / E2 +16.
// 정예화 미지정이면 그 레어도의 최대 승급을 가정한다(6·5·4성 E2, 3성 E1, 2성↓ E0).
// RIIC 스킬 없는 2정 6성 +26%, 2정 5성 +25%(=12F 5+20). 응접실 2인 배치라 합산.
export const CLUE_RARITY_BASE: Record<string, number> = C.CLUE_RARITY_BASE;
export const CLUE_ELITE_BASE: number[] = C.CLUE_ELITE_BASE;
export const maxElite = (rarity: number): Elite => (rarity >= 4 ? 2 : rarity === 3 ? 1 : 0);
export const clueBase = (op: InfraOp): number => (CLUE_RARITY_BASE[op.rarity] ?? CLUE_RARITY_BASE.default ?? 5) + (CLUE_ELITE_BASE[op.elite ?? maxElite(op.rarity)] ?? 0);

// 정예화 단계 선택지: 성급 기준 — 3성은 정예화 1까지·1~2성은 승급 자체가 없다.
// 스킬이 전부 노정예 Lv.1부터 있는 오퍼(니엔 등)도 선택은 가능해야 한다
// (계산엔 영향 없어도 실제 보유 상태 기록·응접실 레어도 기본치에 쓰임, 2026-07-21).
export const ELITE_LABEL: Record<Elite, string> = { 0: "노정예", 1: "1정", 2: "2정" };
// 오퍼 레벨 입력 상한 — 6성 2정 만렙. 정예화 단계별 실제 상한은 성급마다 다르지만,
// 인프라 계산에 쓰이는 건 'Lv.30 미만이냐'뿐이라 입력은 단순 범위 검증만 한다.
export const MAX_OP_LEVEL = 90;
export function eliteOptions(op: InfraOp): Elite[] {
  if (op.rarity <= 2) return [];
  return op.rarity === 3 ? [0, 1] : [0, 1, 2];
}

// ── 자동편성 제외 명단 (사용자 확정 2026-07-28) ────────────────────────────────
// "케이퍼랑 인포서는 너무 조건을 많이 타고 피로도가 심하게 닳으니 둘 다 빼 줘 — 그냥
// 후보로만 올려줘". 케이퍼(단서 수집 β)는 단서 **공유 상태**에서만 값이 나오고 공유가
// 끊기면 10%로 추락해 넣었다 뺐다 해야 하고, 인포서(논리적 추리)는 단서속도 +35%의 대가로
// 시간당 컨디션 -2를 태워 응접실 하나 때문에 교대 주기를 통째로 끌어내린다. 방치 운용이
// 계약인 플래너 편성에는 맞지 않으므로 **자동편성 로스터에서 제외**한다. 완전 삭제가 아니라
// 벤치다 — 방 상세의 대체 후보(slotSubstitutes)·인원 추가 목록에는 그대로 남아 사용자가
// 직접 앉힐 수 있고, 숙소에 수동 고정한 경우도 그대로 유지된다.
// 명단은 rules.json constant AUTO_BENCH로 덮어쓸 수 있고, 없으면 이 기본값을 쓴다.
const AUTO_BENCH_DEFAULT = ["char_4100_caper", "char_4036_forcer"]; // 케이퍼 · 인포서
export const AUTO_BENCH_IDS = new Set<string>(
  (C as unknown as { AUTO_BENCH?: string[] }).AUTO_BENCH ?? AUTO_BENCH_DEFAULT
);
// 자동편성용 로스터 — 벤치 명단 제거. 단, 사용자가 숙소에 직접 고정한 인원은 남긴다.
export function autoRoster(roster: InfraOp[], pinnedDorms: Record<string, string[]> = {}): InfraOp[] {
  if (!AUTO_BENCH_IDS.size) return roster;
  const pinned = new Set(Object.values(pinnedDorms).flat());
  return roster.filter((op) => !AUTO_BENCH_IDS.has(op.id) || pinned.has(op.id));
}

// ── 기지 배치 프리셋 (사용자 요청 2026-07-24: 243 외에 153 지원) ─────────────
// 243 = 무역 2 · 제조 4(순금 2+작전기록 2) · 발전 3 (기본값·종전 유일 레이아웃).
// 153 = 무역 1 · 제조 5(순금 1+작전기록 4) · 발전 3 — 무역소가 1이라 순금 소비도 절반이지만
// 순금 제조소도 1이라 여전히 조금씩 모자란다(사용자 확정): 유일한 순금방(MANUFACTURE-0)이
// 병목이므로 기본(gold 우선) 모드가 그 방을 맨 먼저 채워 최정예를 앉힌다.
// 252 = 무역 2 · 제조 5(순금 2+작전기록 3) · 발전 2 — 만렙 소비 870 > 공급 540이라
// 시설 레벨을 낮춰야만 성립하는 배치. 권장 기본 레벨(숙소4·훈련실·응접실·사무실 Lv1)로
// 소비 500 ≤ 540. 프리셋 전환 시 각 프리셋의 저장된 편성·레벨 버킷이 그대로 복원된다
// (사용자 확정 2026-07-24: 전환마다 재편성 금지 — plan·levels를 프리셋별로 따로 저장).
// "custom"(그외) = 제조·무역·발전 9칸을 자유 구성 (사용자 요청 2026-07-24). 칸별 시설 종류만
// 정하면 buildCustomDef가 셀·우선순위·순금 라인(= min(무역, 제조) — 프리셋 3종과 동일 규칙)을
// 유도한다. slot = 배치도 3×3 왼쪽 블록의 고정 칸 번호(0~8, CSS pos-slot-N).
export type LayoutPreset = "243" | "153" | "252" | "custom";
export type CustomRoom = "MANUFACTURE" | "TRADING" | "POWER";
type LayoutCell = { key: string; room: string; label: string; product?: string; slot?: number };

const SUPPORT_CELLS: LayoutCell[] = [
  { key: "CONTROL", room: "CONTROL", label: "제어 센터" },
  { key: "MEETING", room: "MEETING", label: "응접실" },
  { key: "WORKSHOP", room: "WORKSHOP", label: "가공소" },
  { key: "HIRE", room: "HIRE", label: "사무실" },
  { key: "TRAINING", room: "TRAINING", label: "훈련실" },
  { key: "DORM-0", room: "DORMITORY", label: "숙소 1" },
  { key: "DORM-1", room: "DORMITORY", label: "숙소 2" },
  { key: "DORM-2", room: "DORMITORY", label: "숙소 3" },
  { key: "DORM-3", room: "DORMITORY", label: "숙소 4" },
];
const POWER_CELLS: LayoutCell[] = [
  { key: "POWER-0", room: "POWER", label: "발전소 1" },
  { key: "POWER-1", room: "POWER", label: "발전소 2" },
  { key: "POWER-2", room: "POWER", label: "발전소 3" },
];
const LAYOUT_DEFS: Record<Exclude<LayoutPreset, "custom">, {
  cells: LayoutCell[];
  priority: Record<ProdAxis, string[]>;       // 방 채우기 순서 (§1 생산 축 3종 — 운용 축은 순서를 안 바꾼다)
  goldLines: number;                          // 순금 제조소 수 (투예·파죰카 순금 라인 재계산)
  counts: Record<string, number>;             // 시설 수 (facilityBased 배수 재계산)
  plantsBase: number;                         // 발전소 수 (자동화 오퍼 스케일·그레이 시 +1)
}> = {
  "243": {
    cells: [
      { key: "TRADING-0", room: "TRADING", label: "무역소 1" },
      { key: "TRADING-1", room: "TRADING", label: "무역소 2" },
      { key: "MANUFACTURE-0", room: "MANUFACTURE", label: "제조소 1 · 순금", product: "gold" },
      { key: "MANUFACTURE-1", room: "MANUFACTURE", label: "제조소 2 · 순금", product: "gold" },
      { key: "MANUFACTURE-2", room: "MANUFACTURE", label: "제조소 3 · 작전기록", product: "exp" },
      { key: "MANUFACTURE-3", room: "MANUFACTURE", label: "제조소 4 · 작전기록", product: "exp" },
      ...POWER_CELLS, ...SUPPORT_CELLS,
    ],
    priority: {
      gold: ["MANUFACTURE-0", "MANUFACTURE-1", "MANUFACTURE-2", "MANUFACTURE-3", "TRADING-0", "TRADING-1", "POWER-0", "POWER-1", "POWER-2"],
      exp: ["MANUFACTURE-2", "MANUFACTURE-3", "MANUFACTURE-0", "MANUFACTURE-1", "TRADING-0", "TRADING-1", "POWER-0", "POWER-1", "POWER-2"],
      balance: ["MANUFACTURE-0", "MANUFACTURE-2", "MANUFACTURE-1", "MANUFACTURE-3", "TRADING-0", "TRADING-1", "POWER-0", "POWER-1", "POWER-2"],
    },
    goldLines: 2,
    counts: { TRADING: 2, MANUFACTURE: 4, POWER: 3 },
    plantsBase: 3,
  },
  "153": {
    cells: [
      { key: "TRADING-0", room: "TRADING", label: "무역소 1" },
      { key: "MANUFACTURE-0", room: "MANUFACTURE", label: "제조소 1 · 순금", product: "gold" },
      { key: "MANUFACTURE-1", room: "MANUFACTURE", label: "제조소 2 · 작전기록", product: "exp" },
      { key: "MANUFACTURE-2", room: "MANUFACTURE", label: "제조소 3 · 작전기록", product: "exp" },
      { key: "MANUFACTURE-3", room: "MANUFACTURE", label: "제조소 4 · 작전기록", product: "exp" },
      { key: "MANUFACTURE-4", room: "MANUFACTURE", label: "제조소 5 · 작전기록", product: "exp" },
      ...POWER_CELLS, ...SUPPORT_CELLS,
    ],
    priority: {
      gold: ["MANUFACTURE-0", "MANUFACTURE-1", "MANUFACTURE-2", "MANUFACTURE-3", "MANUFACTURE-4", "TRADING-0", "POWER-0", "POWER-1", "POWER-2"],
      exp: ["MANUFACTURE-1", "MANUFACTURE-2", "MANUFACTURE-3", "MANUFACTURE-4", "MANUFACTURE-0", "TRADING-0", "POWER-0", "POWER-1", "POWER-2"],
      // 밸런스(교차)는 순금방이 1개라 gold 우선과 동일한 순서가 된다
      balance: ["MANUFACTURE-0", "MANUFACTURE-1", "MANUFACTURE-2", "MANUFACTURE-3", "MANUFACTURE-4", "TRADING-0", "POWER-0", "POWER-1", "POWER-2"],
    },
    goldLines: 1,
    counts: { TRADING: 1, MANUFACTURE: 5, POWER: 3 },
    plantsBase: 3,
  },
  "252": {
    cells: [
      { key: "TRADING-0", room: "TRADING", label: "무역소 1" },
      { key: "TRADING-1", room: "TRADING", label: "무역소 2" },
      { key: "MANUFACTURE-0", room: "MANUFACTURE", label: "제조소 1 · 순금", product: "gold" },
      { key: "MANUFACTURE-1", room: "MANUFACTURE", label: "제조소 2 · 순금", product: "gold" },
      { key: "MANUFACTURE-2", room: "MANUFACTURE", label: "제조소 3 · 작전기록", product: "exp" },
      { key: "MANUFACTURE-3", room: "MANUFACTURE", label: "제조소 4 · 작전기록", product: "exp" },
      { key: "MANUFACTURE-4", room: "MANUFACTURE", label: "제조소 5 · 작전기록", product: "exp" },
      ...POWER_CELLS.slice(0, 2), ...SUPPORT_CELLS,
    ],
    priority: {
      gold: ["MANUFACTURE-0", "MANUFACTURE-1", "MANUFACTURE-2", "MANUFACTURE-3", "MANUFACTURE-4", "TRADING-0", "TRADING-1", "POWER-0", "POWER-1"],
      exp: ["MANUFACTURE-2", "MANUFACTURE-3", "MANUFACTURE-4", "MANUFACTURE-0", "MANUFACTURE-1", "TRADING-0", "TRADING-1", "POWER-0", "POWER-1"],
      balance: ["MANUFACTURE-0", "MANUFACTURE-2", "MANUFACTURE-1", "MANUFACTURE-3", "MANUFACTURE-4", "TRADING-0", "TRADING-1", "POWER-0", "POWER-1"],
    },
    goldLines: 2,
    counts: { TRADING: 2, MANUFACTURE: 5, POWER: 2 },
    plantsBase: 2,
  },
};

// 프리셋별 권장 기본 레벨 — 252는 전력 부족(만렙 -330)이라 조정 필요. 기본값은 사용자 확정
// 구성(2026-07-24 스크린샷): 순금 2방·응접실·훈련실(특화 3 유지)은 만렙, 작전기록 3방 Lv2,
// 사무실 Lv2, 숙소는 첫 방만 Lv2·나머지 Lv1 → 소비 540 = 공급 540 (수지 정확히 ±0).
// 243·153은 만렙 수지가 정확히 ±0이라 전부 만렙이 기본
const LEVEL_DEFAULTS: Partial<Record<LayoutPreset, Levels>> = {
  "252": { "MANUFACTURE-2": 2, "MANUFACTURE-3": 2, "MANUFACTURE-4": 2, "DORM-0": 2, "DORM-1": 1, "DORM-2": 1, "DORM-3": 1, "HIRE": 2 },
};
// 활성 레이아웃 기준 권장 레벨 전체 맵 (만렙 + 프리셋별 오버라이드. custom = 전부 만렙)
export function suggestedLevels(preset: LayoutPreset): Levels {
  const cells = preset === "custom" ? buildCustomDef(CUSTOM_ROOMS).cells : (LAYOUT_DEFS[preset] ?? LAYOUT_DEFS["243"]).cells;
  const out: Levels = {};
  for (const cell of cells) out[cell.key] = maxLevelOf(cell.room);
  return { ...out, ...(LEVEL_DEFAULTS[preset] ?? {}) };
}

// ── 그외(커스텀) 배치: 9칸 시설 종류 배열 → 레이아웃 정의 유도 ─────────────────
// 순금 방 수 = min(무역소 수, 제조소 수) — 243(무역2→순금2)·153(무역1→순금1)·252(무역2→순금2)와
// 동일한 도메인 규칙. 순금은 앞쪽 제조소부터. 우선순위(gold/exp/balance)도 프리셋과 같은 패턴.
export const DEFAULT_CUSTOM_ROOMS: CustomRoom[] = ["TRADING", "TRADING", "MANUFACTURE", "MANUFACTURE", "MANUFACTURE", "MANUFACTURE", "POWER", "POWER", "POWER"]; // = 243 모양
export let CUSTOM_ROOMS: CustomRoom[] = [...DEFAULT_CUSTOM_ROOMS];
// 제조소 칸별 품목 (사용자 요청 2026-07-24: 순금/작전기록 직접 선택). null = 자동
// (min(무역, 제조) 쿼터를 앞 제조소부터) — 기본값은 243 모양(순금 2 + 작전기록 2)과 일치.
export type CustomProduct = "gold" | "exp";
export const DEFAULT_CUSTOM_PRODUCTS: (CustomProduct | null)[] = [null, null, "gold", "gold", "exp", "exp", null, null, null];
export let CUSTOM_PRODUCTS: (CustomProduct | null)[] = [...DEFAULT_CUSTOM_PRODUCTS];
function buildCustomDef(rooms: CustomRoom[], products: (CustomProduct | null)[] = CUSTOM_PRODUCTS) {
  const counts: Record<string, number> = { TRADING: 0, MANUFACTURE: 0, POWER: 0 };
  for (const room of rooms) counts[room] += 1;
  // 명시 품목 우선 — 미지정(null) 제조소만 자동 배정: 명시 순금을 뺀 잔여 쿼터를 앞에서부터
  const goldQuota = Math.min(counts.TRADING, counts.MANUFACTURE);
  const explicitGold = rooms.filter((room, i) => room === "MANUFACTURE" && products[i] === "gold").length;
  let autoGoldLeft = Math.max(0, goldQuota - explicitGold);
  const cells: LayoutCell[] = [];
  let ti = 0, mi = 0, pi = 0;
  rooms.forEach((room, slot) => {
    if (room === "TRADING") { cells.push({ key: `TRADING-${ti}`, room, label: `무역소 ${ti + 1}`, slot }); ti += 1; }
    else if (room === "MANUFACTURE") {
      let product: CustomProduct;
      if (products[slot] === "gold" || products[slot] === "exp") product = products[slot]!;
      else { product = autoGoldLeft > 0 ? "gold" : "exp"; if (product === "gold") autoGoldLeft -= 1; }
      cells.push({ key: `MANUFACTURE-${mi}`, room, label: `제조소 ${mi + 1} · ${product === "gold" ? "순금" : "작전기록"}`, product, slot });
      mi += 1;
    } else { cells.push({ key: `POWER-${pi}`, room, label: `발전소 ${pi + 1}`, slot }); pi += 1; }
  });
  const goldKeys = cells.filter((cell) => cell.product === "gold").map((cell) => cell.key);
  const expKeys = cells.filter((cell) => cell.product === "exp").map((cell) => cell.key);
  const tradeKeys = cells.filter((cell) => cell.room === "TRADING").map((cell) => cell.key);
  const powerKeys = cells.filter((cell) => cell.room === "POWER").map((cell) => cell.key);
  const balance: string[] = [];
  for (let i = 0; i < Math.max(goldKeys.length, expKeys.length); i += 1) {
    if (goldKeys[i]) balance.push(goldKeys[i]);
    if (expKeys[i]) balance.push(expKeys[i]);
  }
  return {
    cells: [...cells, ...SUPPORT_CELLS],
    priority: {
      gold: [...goldKeys, ...expKeys, ...tradeKeys, ...powerKeys],
      exp: [...expKeys, ...goldKeys, ...tradeKeys, ...powerKeys],
      balance: [...balance, ...tradeKeys, ...powerKeys],
    } as Record<ProdAxis, string[]>,
    goldLines: goldKeys.length, // 실제 순금 방 수 (명시 선택 반영 — 투예·파죰카 라인 상수)
    counts,
    plantsBase: counts.POWER,
  };
}

// 활성 레이아웃 상태 — export let 라이브 바인딩이라 setLayoutPreset 후 임포터가 새 값을 본다.
// ⚠ 기본은 반드시 243 (verify-plan 픽스처·기존 저장 플랜 호환). UI가 저장된 프리셋을 복원한다.
export let activeLayout: LayoutPreset = "243";
export let LAYOUT: LayoutCell[] = LAYOUT_DEFS["243"].cells;
export let cellByKey = new Map(LAYOUT.map((cell) => [cell.key, cell]));
export let GOLD_LINES = LAYOUT_DEFS["243"].goldLines;
export let FACILITY_COUNTS: Record<string, number> = LAYOUT_DEFS["243"].counts;
export let PLANTS_BASE_RT = LAYOUT_DEFS["243"].plantsBase; // 발전소 수 — 252는 2 (그레이 배치 시 +1)

export function setLayoutPreset(preset: LayoutPreset, customRooms?: CustomRoom[] | null, customProducts?: (CustomProduct | null)[] | null) {
  if (customRooms && customRooms.length === 9) CUSTOM_ROOMS = [...customRooms];
  if (customProducts && customProducts.length === 9) CUSTOM_PRODUCTS = [...customProducts];
  const def = preset === "custom" ? buildCustomDef(CUSTOM_ROOMS, CUSTOM_PRODUCTS) : LAYOUT_DEFS[preset] ?? LAYOUT_DEFS["243"];
  activeLayout = preset === "custom" ? "custom" : def === LAYOUT_DEFS["243"] ? "243" : preset;
  LAYOUT = def.cells;
  cellByKey = new Map(LAYOUT.map((cell) => [cell.key, cell]));
  GOLD_LINES = def.goldLines;
  FACILITY_COUNTS = def.counts;
  PRODUCTION_KEYS = def.priority.gold;
  PRIORITY_KEYS = def.priority;
  PLANTS_BASE_RT = def.plantsBase;
}

// ── 시설 레벨 (전력·레벨 시스템, 사용자 요청 2026-07-24) ─────────────────────
// 방(셀)별 레벨. 빈 맵 = 전부 만렙 — verify-plan 픽스처·기존 저장분과의 호환 기본값.
// 워커는 엔진 모듈 인스턴스가 따로라 setLayoutPreset처럼 매 잡마다 setLevels로 동기화한다.
export type Levels = Record<string, number>;
export let LEVELS: Levels = {};
export function setLevels(levels?: Levels | null) { LEVELS = levels ?? {}; }
export function maxLevelOf(room: string): number { return infra.rooms[room]?.phases?.length ?? 3; }
export function levelOf(key: string): number {
  const room = cellByKey.get(key)?.room ?? key;
  const max = maxLevelOf(room);
  const v = LEVELS[key];
  return typeof v === "number" && v >= 1 && v <= max ? Math.floor(v) : max;
}
// 방 슬롯 수 = 레벨별 phases (제조·무역 1/2/3, 제어센터 = 레벨). 레벨 미지정은 만렙 슬롯
export function slotsFor(key: string): number {
  const room = cellByKey.get(key)?.room ?? key;
  // 훈련실 근무석은 **1석**으로 고정한다. 게임 데이터 정원은 2(트레이너석+훈련대상석)이고
  // 2026-07-29에 2석으로 풀어봤지만, 뒤따르는 편성이 계속 꼬여 사용자가 1석으로 되돌리라고
  // 지시했다("2명으로 늘린 거 다시 1명으로 롤백") — 그 판단이 이 캡의 근거다.
  if (room === "TRAINING") return 1;
  const spec = infra.rooms[room];
  return spec?.phases?.[levelOf(key) - 1]?.slots ?? spec?.slots ?? 1;
}
export function defaultLevels(): Levels {
  const out: Levels = {};
  for (const cell of LAYOUT) out[cell.key] = maxLevelOf(cell.room);
  return out;
}
// 전력 수지 — 발전소 phases가 공급(+60/+130/+270), 그 외 시설이 소비(음수)
export function powerBudget(levels?: Levels | null): { provide: number; consume: number; net: number } {
  const saved = LEVELS;
  if (levels) LEVELS = levels;
  let provide = 0, consume = 0;
  for (const cell of LAYOUT) {
    const e = infra.rooms[cell.room]?.phases?.[levelOf(cell.key) - 1]?.electricity ?? 0;
    if (e > 0) provide += e; else consume += -e;
  }
  LEVELS = saved;
  return { provide, consume, net: provide - consume };
}
const dormLevelSum = () => LAYOUT.filter((c) => c.room === "DORMITORY").reduce((s, c) => s + levelOf(c.key), 0);
const dormLevelMax = () => Math.max(1, ...LAYOUT.filter((c) => c.room === "DORMITORY").map((c) => levelOf(c.key)));
const totalLevelSum = () => LAYOUT.reduce((s, c) => s + levelOf(c.key), 0);
// 레벨 연동 스킬 값 보정 — baked(만렙) 값에 실제 레벨과의 차이만큼 가감 (하한 0).
// 로봇(미니멀리스트)은 전 시설 레벨 합으로 전량 재계산 (만렙 합 64 = baked 40과 일치)
function levelAdjusted(skill: InfraSkill): number {
  if (!skill.dormLevels && !skill.meetingLevel && !skill.trainingLevel && !skill.roboLevels) return skill.value;
  let v = skill.value;
  if (skill.dormLevels) v += skill.dormLevels.per * (dormLevelSum() - 4 * maxLevelOf("DORMITORY"));
  if (skill.meetingLevel) v += skill.meetingLevel.per * (levelOf("MEETING") - maxLevelOf("MEETING"));
  if (skill.trainingLevel) v += skill.trainingLevel.per * (levelOf("TRAINING") - maxLevelOf("TRAINING"));
  if (skill.roboLevels) v = Math.floor(Math.min(skill.roboLevels.cap, totalLevelSum()) / skill.roboLevels.per) * skill.roboLevels.add;
  return Math.max(0, v);
}
// 숙소 레벨당 토큰 생성(센시·아이리스·체르니 — 숙소 고정 요원은 최고 레벨 숙소에 앉는다 가정)
export function genEstimate(g: TokenGen): number {
  return g.perDormLevel != null ? g.perDormLevel * dormLevelMax() : g.estimate;
}

export const ROOM_ACCENT: Record<string, string> = {
  TRADING: "#4d9dd6", MANUFACTURE: "#e0b13e", POWER: "#b7d940", CONTROL: "#c3d24b",
  MEETING: "#8f7fc0", WORKSHOP: "#c78a54", HIRE: "#6fa08a", TRAINING: "#c05f6e", DORMITORY: "#7f8ea3",
};

export const UNIT: Record<string, string> = {
  MANUFACTURE: "생산력", TRADING: "오더 효율·품질", POWER: "드론 회복", MEETING: "단서 속도",
  HIRE: "연락 속도", WORKSHOP: "부산물", TRAINING: "훈련 속도", CONTROL: "지원", DORMITORY: "회복",
};

export const PARK_KEYS = ["WORKSHOP"];
export const SHIFT_COUNT = 2;

// cellOf = 오퍼 id → 배치된 **칸**(LAYOUT key). roomOf(방 종류)로는 "제조소 2곳에 쉐이가
// 앉았다" 같은 시설 개수를 셀 수 없어 시설 카운트 스킬(타락사쿰·만트라)용으로 함께 싣는다.
// shift: 평가 중인 조 (0=A·1=B). endless 컨디션 보너스는 **A조에만** 적용된다 (사용자 확정
// 2026-07-27: "A조를 최대한 오래 쓰고, B조는 그동안 휴식했다가 교대" — B조는 A조가 쉬는
// ~12h만 뛰면 되므로 소모 무관, 남은 오퍼로 생산만 최적화). 미지정은 A조 취급.
export type Ctx = { product?: string; tokenPoints: Record<string, number>; factionCounts?: Record<string, number>; plants?: number; presentIds?: Set<string>; ambient?: AmbientAura[]; roomOf?: Map<string, string>; cellOf?: Map<string, string>; shiftHours?: number; shift?: number };

// 시간 성장형 스킬의 교대 주기 평균 — k시간째 값 = min(first + rate×(k−1), cap),
// 마지막 부분 시간은 비례 (파서 grow_avg와 동일 공식, 구운 값 = 24h 기준)
export function growAvg(g: { first: number; rate: number; cap: number }, hours: number): number {
  let total = 0;
  for (let h = 0; h < hours; h += 1) total += Math.min(g.first + g.rate * h, g.cap) * Math.min(1, hours - h);
  return total / hours;
}

// 교대 시계 (사용자 확정 2026-07-25): A조에서 컨디션 소모가 가장 높은 오퍼가 24 컨디션을
// 소진하는 시간 = 24 ÷ max(방 기본 소모 + 본인 가산 + 방 전체 가산). 성장형 스택은 교대마다
// 리셋되므로 이 주기가 성장 스킬의 평균 구간이 된다. **생산 라인(제조·무역·발전·제어)만**
// 시계에 넣는다 — 응접실·사무실의 고소모 요원(인포서 +2 등)은 개별 교대가 가능한 지원방이라
// 전 기지 교대를 8h로 끌어내리지 않는다. 링 '멈추지 않는 술잔'은 같은 방 쉐이의 자기 소모
// 가산을 무효화한다(selfDrainNegate).
// **양수 소모만 반영 (사용자 정정 2026-07-25: "피로도가 빨리 줄면 좀 더 빨리 바꾸면 돼")**:
// 소모 감소(슈 방 전체 -0.1·트라고디아 본인 -0.25)로 교대가 늦어지는 건 타이밍 편의일 뿐
// 생산 가치가 아니므로 시계에 넣지 않는다 — 안 그러면 감소 요원이 "시계를 늘려 성장형을
// 올려주는" 유령 좌석 근거를 얻어 더 강한 효율 요원을 밀어낸다 (슈가 왕 확장을 막던 원인).
const CLOCK_ROOMS = new Set(["MANUFACTURE", "TRADING", "POWER", "CONTROL"]);

// ── 무한동력(endless) 우선 생산 모드 (사용자 요청 2026-07-27) ─────────────────────
// "오랫동안 쓰는 걸 우선": 교대 없이 오래가는 편성이 목적 함수다. 기존 3모드의 "양수 소모만"
// 교대 시계 규칙(INFRA-RULES §2 — 감소 요원이 유령 좌석 근거를 얻는 것을 막는 규칙)은
// 생산 우선 모드에 한정되고, 이 모드에서는 소모 감소·근무 중 회복이 곧 가치다.
// 결합은 방별 보너스: W × (방 기본 소모 − 방 최대 순소모) — 빈 방 0, 저소모팀 양수,
// 고소모팀(인포서 +2 등) 음수. 절대 페널티가 아니라 기본 소모 대비 상대치라 슬롯 백필
// 절대룰(방은 꽉 채운다)과 충돌하지 않는다. 비교 전용 함수(teamValue·planScore·감사·백필)
// 에만 더하고 표시용 teamScore(방 % 배지)는 순수 생산 점수로 유지한다.
// 운용 축 (사용자 확정 2026-07-28 축 분리): off(효율 우선) = 컨디션 무시, endless(장기 지속) =
// A조를 오래가게 — 소모 가중과 생산이 균형(제어센터 W=600, 일반 방 W=300)이고 **제어센터는
// 순소모 0 조합이 로스터에 있으면 무조건 그걸 앉힌다**(아래 PERPETUAL_CC_LOCK — 종전 별도
// 모드였던 '무한동력'을 장기 지속에 흡수. 사용자: "장기지속일 시, 무한동력 오퍼가 있다면
// 무한동력 조합 우선으로"). 생산 축(gold/exp/balance)과 자유 조합된다.
export type DrainMode = "off" | "endless";
export let DRAIN_MODE: DrainMode = "off";
export let ENDLESS_ON = false; // 소모 모델 활성 여부
export function setPriorityMode(priority?: ProdPriority) {
  DRAIN_MODE = splitPriority(priority).drain;
  ENDLESS_ON = DRAIN_MODE !== "off";
}
// 용량 변환 결집 후보(bestTeam)의 on/off. 방 점수는 분명히 오르는데 그 방이 가져간 오퍼 때문에
// 옆방 결집(도로시 라인테크)이 깨져 **기지 총점은 내려가는** 경우가 있어(실측 exp −1.57),
// optimizeConfig가 마지막에 켠 안과 끈 안을 planScore로 맞대 본다 (2026-07-30).
export let CAP_CLUSTER_ON = true;
let capClusterUsed = false; // 이번 buildPlan에서 결집 후보가 실제로 채택됐나 — A/B를 돌릴지 판단
export function setCapCluster(on: boolean) { CAP_CLUSTER_ON = on; }
// 지속시간 타이브레이크(bestTeam 후보 정렬)의 on/off — "효율이 동급이면 A조엔 오래 버티는 쪽"
// (사용자 확정 2026-07-31). 방 점수는 같지만 데려가는 오퍼가 달라져 옆방이 손해를 볼 수 있어
// (실측 full/gold −1.6), 용량 변환 결집과 같은 관례로 optimizeConfig가 총점을 맞대 본다.
export let SHIFT_TIEBREAK_ON = true;
let shiftTiebreakUsed = false; // 이번 buildPlan에서 종전(성급) 순서와 실제로 어긋났나
export function setShiftTiebreak(on: boolean) { SHIFT_TIEBREAK_ON = on; }
// 제어센터 무한동력 성립 여부 — 로스터에 순소모 0 제어센터 조합이 있으면 buildPlan이 켠다.
// 켜지면 ① 그 조합에 절대 우선 락 ② 토큰 패키지가 제어센터를 예약석으로 못 씀(죽은 사슬 방지).
// 불가능한 로스터에선 꺼진 채로 종전 장기 지속 경쟁(화식 코어 등)이 그대로 돈다.
export let PERPETUAL_CC = false;
// 일반 방은 소모와 효율을 저울질(ENDLESS_ROOM_W)하고, 제어센터만 종전 가중(ENDLESS_DRAIN_W —
// 회복 오라 코어 성립) + 순소모 0 강제 락으로 갈린다. 종전 사전식(W=20000 전 방)은 샤마르
// 조합(+132%p)을 0.25/h 아끼자고 B조로 밀었다 — "피로도 고작 조금 먹고 희생하는 효율이 너무 높다".
export const ENDLESS_DRAIN_W: number = (C as unknown as Record<string, number | undefined>).ENDLESS_DRAIN_W ?? 600; // 제어센터: 소모 1.0/h당 점수 등가 (L2 상수로 조정 가능)
export const ENDLESS_ROOM_W: number = (C as unknown as Record<string, number | undefined>).ENDLESS_ROOM_W ?? 300; // 일반 방: 0.25 감소 ≈ 75점 — 통상 격차(<30)는 저소모, 대형 시너지(샤마르 132)는 효율이 이긴다
const PERPETUAL_CC_LOCK = 1e6; // 무한동력 모드: 순소모 0 제어센터 조합의 절대 우선 보너스 (오라 자리 가치 합 최대 ~10만을 압도)
const ENDLESS_CLOCK_CAP = 72; // 순소모 0(무한동력) 방의 교대 시계 상한 — growAvg 발산 방지
// 시설 집합 용어(INFRA-RULES §5 전수조사): 기타 시설 = 작업 시설 − 제어센터·훈련실,
// 일부 시설 = 발전소·사무실·응접실. 위셔델·총웨·무에나의 횡단 회복 오라 대상.
const RECOVER_SCOPE_ROOMS: Record<string, string[]> = {
  other: ["MANUFACTURE", "TRADING", "POWER", "HIRE", "MEETING"],
  some: ["POWER", "HIRE", "MEETING"],
};
// 방 인원 시너지 감면 (사용자 인게임 통제 실험 2026-07-28로 확정): 같은 방의 **동료 1명당
// 시간당 컨디션 소모 -0.05** (자신 제외 — 3인 방 -0.1, 2인 -0.05, 1인 0. 실험: 총웨를 빼도
// 유지, 방 인원을 줄이면 정확히 이 공식대로 감소·소멸).
// endless 순소모 모델에만 반영 — 생산 3모드의 교대 시계는 종전 관례(방 기본 1/h)를 유지한다.
const CREW_RELIEF = 0.05;
// 제어센터 진주 감면 (v18, 사용자 전 방 실측 + 판별 실험 + PRTS 원문으로 확정): 제어센터에
// 앉은 **인원 1명당 다른 모든 작업 시설의 소모 -0.05** (제어센터 자신은 미적용 — 실측 CC 0.75
// = 1 − 동료 0.2 − 시 0.05가 인원항 없이 성립). 판별 실험: 5인→4인 시 전 방이 정확히 +0.05,
// 총웨만 빼면 무역소1이 0.40→0.70 (인원항 -0.05 + 오라 -0.25 동시 소실) — 모델 예측과 일치.
// ⚠ v17의 "횡단 감면 부존재" 결론은 오판(1인 방 실험은 방 동료항의 소멸이었음) — 정정.
const CC_OCC_RELIEF = 0.05;
// 횡단 회복 오라 실효값 — perToken(총웨 '외로운 빛과 함께': 화식 20점당 +0.05)은 **무상한 누적**
// (클뜯 원문 그대로, 스텝 상한 없음). 사용자 전 방 실측(2026-07-28): 화식 80 → 오라 0.05+4스텝
// = 0.25가 스킬 없는 전 방의 균일 -0.25를 정확히 설명. v17의 "1스텝 상한"은 오판 — 정정.
function recoverAuraValue(skill: InfraSkill, tokenPoints: Record<string, number>): number {
  const aura = skill.recoverAura!;
  const extra = aura.perToken ? Math.floor((tokenPoints[aura.perToken.token] ?? 0) / aura.perToken.per) * aura.perToken.add : 0;
  return aura.value + extra;
}
// 방 최대 순소모 (endless 모델, v18 = 인게임 전 방 실측 공식): 오퍼별
//   순소모 = 기본 + 본인 소모증가 + 방 전체 가산(부호 유지) − 방 내 회복 − 방 동료 시너지
//            − 제어센터 인원 감면 − **max(본인 소모감소, 횡단 회복 오라)**
// 마지막 항이 v18의 핵심 "동종 최고 규칙": 오라(무에나·총웨·위셔델 중 최대 1개)와 오퍼 자신의
// 소모 감소 스킬은 합산되지 않고 큰 쪽 하나만 적용된다 — 실측: 자기 -0.25 보유 방(샤마르 트리오·
// 트라고디아)은 오라 0.25에서 추가 이득 0, 스킬 없는 방만 오라 -0.25를 온전히 받았다.
// 오퍼별 하한 0(과회복은 낭비) 후 최댓값 — 방을 제일 먼저 지치는 오퍼가 교대를 부른다.
// 소모 없는 방(숙소·가공소)·빈 팀은 null. 동반 게이트 회복(리 '한가하고 덧없는 인생': 아와
// 함께)은 partners 전원이 같은 방일 때만 계상한다.
export function roomMaxNetDrain(team: InfraOp[], room: string, ctx: Ctx): number | null {
  const base = infra.rooms[room]?.drain ?? 1;
  if (base <= 0 || !team.length) return null;
  const teamIds = new Set(team.map((member) => member.id));
  let roomAdd = 0;
  let recover = 0;
  const negates: string[] = [];
  for (const member of team) for (const sk of activeSkills(member, room, ctx.product)) {
    roomAdd += sk.drainRoom ?? 0;
    if (sk.selfDrainNegate) negates.push(sk.selfDrainNegate);
    if (sk.partners.length && !sk.partners.every((pid) => teamIds.has(pid))) continue;
    if (sk.recoverRoom) recover += sk.recoverRoom;
    if (sk.recoverRoomPer) recover += sk.recoverRoomPer.value * team.filter((member2) => memberOf(member2, sk.recoverRoomPer!.faction)).length;
  }
  // 특별 비교 규칙 (용어 사전 cc.c.sui2_1): 무에나·총웨·위셔델의 횡단 회복 오라는 **최대
  // 수치 1개만** 적용 — 합산 금지. 제어센터 인원 감면(비오라 앰비언트)은 별도로 온전히 적용.
  let auraMax = 0;
  for (const aura of ctx.ambient ?? []) {
    if (aura.kind !== "drain_recover" || !aura.rooms?.includes(room)) continue;
    if (aura.aura) auraMax = Math.max(auraMax, aura.value);
    else recover += aura.value;
  }
  // 방 인원 시너지 — 동료 1명당 -0.05 (자신 제외, 전 근무방 공통)
  recover += CREW_RELIEF * (team.length - 1);
  let maxNet = 0;
  for (const member of team) {
    let self = 0;
    for (const sk of activeSkills(member, room, ctx.product)) self += sk.moraleDrain;
    if (self > 0 && negates.some((f) => factionsOf(member).some((fac) => fac.includes(f)))) self = 0;
    // 동종 최고 규칙 — 본인 소모 감소(self<0)와 횡단 오라 중 큰 쪽 하나만
    const personal = Math.max(Math.max(0, -self), auraMax);
    const selfPos = Math.max(0, self);
    maxNet = Math.max(maxNet, Math.max(0, base + selfPos + roomAdd - recover - personal));
  }
  return maxNet;
}
// endless 모드의 방별 컨디션 보너스 — teamValue·planScore·감사·백필이 생산 점수에 더한다.
// 제어센터는 횡단 회복 오라 보유자의 자리 가치(오라값 × W × 대상 방 수)를 추가한다 —
// 제어센터 오라의 §6 자리 평가와 같은 관례(자리 평가와 대상 방 실적용의 의도적 이중 계상).
// 위셔델(기타 +0.1)·총웨(+0.05+화식 스케일)·무에나(일부 +0.1)가 이 값으로 제어센터에 온다.
export function endlessBonus(team: InfraOp[], room: string, ctx: Ctx): number {
  // A조(shift 0·미지정)만 — B조는 회복 교대(~12h 근무)라 소모 무관, 생산 점수로만 편성한다
  if (!ENDLESS_ON || (ctx.shift ?? 0) !== 0) return 0;
  const maxNet = roomMaxNetDrain(team, room, ctx);
  if (maxNet == null) return 0;
  const base = infra.rooms[room]?.drain ?? 1;
  const W = room === "CONTROL" ? ENDLESS_DRAIN_W : ENDLESS_ROOM_W;
  let bonus = W * (base - maxNet);
  if (room === "CONTROL") {
    // 횡단 회복 오라 자리 가치 — 특별 비교 규칙(방마다 최대 1개)대로 대상 방별 최댓값만 계상.
    // 합산하면 회복 오라 다인 결집(위셔델+총웨+무에나)을 과대평가한다 (겹쳐도 이득 없음).
    const auraSkills: { value: number; targets: string[] }[] = [];
    for (const member of team) for (const sk of activeSkills(member, room, ctx.product)) {
      if (!sk.recoverAura) continue;
      auraSkills.push({ value: recoverAuraValue(sk, ctx.tokenPoints), targets: RECOVER_SCOPE_ROOMS[sk.recoverAura.scope] ?? [] });
    }
    for (const target of RECOVER_SCOPE_ROOMS.other) {
      const best = auraSkills.reduce((acc, entry) => entry.targets.includes(target) ? Math.max(acc, entry.value) : acc, 0);
      if (best > 0) bonus += best * W * (FACILITY_COUNTS[target] ?? 1);
    }
    // 무한동력 자동 우선 (사용자 확정 2026-07-28: "장기지속일 시, 무한동력 오퍼가 있다면 무한동력
    // 조합 우선으로"): 순소모 0 제어센터 조합은 오라 자리 가치·생산과 무관하게 절대 우선 —
    // 로스터에 성립하면(PERPETUAL_CC 사전 판정) 반드시 채택된다
    if (PERPETUAL_CC && maxNet <= 1e-9) bonus += PERPETUAL_CC_LOCK;
  }
  return bonus;
}

export function shiftHoursFor(teams: { room: string; ops: InfraOp[] }[]): number {
  // endless 모드: 순소모 모델(감소·회복 포함)로 시계를 계산한다 — 무한동력 방은 상한 72h.
  // 제어센터 인원 감면·횡단 오라는 전달받은 편성의 CONTROL 팀에서 직접 만든다 (화식 토큰 점수는
  // 이 단계에 없어 0으로 근사 — 총웨 스텝 가산만 보수적으로 빠진다).
  if (ENDLESS_ON) {
    const ccTeam = teams.find((entry) => entry.room === "CONTROL")?.ops ?? [];
    const ambient = ccTeam.length ? aurasOf(ccTeam, { tokenPoints: {} }) : [];
    let maxDrain = 24 / ENDLESS_CLOCK_CAP;
    for (const { room, ops: team } of teams) {
      if (!CLOCK_ROOMS.has(room)) continue;
      const net = roomMaxNetDrain(team, room, { tokenPoints: {}, ambient });
      if (net != null) maxDrain = Math.max(maxDrain, net);
    }
    return 24 / maxDrain;
  }
  let maxDrain = 1;
  for (const { room, ops: team } of teams) {
    if (!CLOCK_ROOMS.has(room)) continue;
    const base = infra.rooms[room]?.drain ?? 1;
    if (base <= 0) continue;
    let roomAdd = 0;
    const negates: string[] = [];
    for (const member of team) for (const sk of activeSkills(member, room)) {
      roomAdd += Math.max(0, sk.drainRoom ?? 0);
      if (sk.selfDrainNegate) negates.push(sk.selfDrainNegate);
    }
    for (const member of team) {
      let self = 0;
      for (const sk of activeSkills(member, room)) self += sk.moraleDrain;
      // 진영 판정은 부분 일치 — 스킬 원문의 "쉐이"가 데이터의 "염-쉐이"를 가리킨다 (토큰 카운터와 동일 관례)
      if (self > 0 && negates.some((f) => factionsOf(member).some((fac) => fac.includes(f)))) self = 0;
      maxDrain = Math.max(maxDrain, base + Math.max(0, self) + roomAdd);
    }
  }
  return 24 / maxDrain;
}

export function skillApplies(skill: InfraSkill, room: string, product?: string): boolean {
  if (skill.room !== room) return false;
  if (room === "MANUFACTURE" && product && skill.product !== "any" && skill.product !== product) return false;
  return true;
}

// 배타 시설 수 비교 분기(facCompare) 해석 — 구운 kind/value(243 기준)를 활성 레이아웃의
// 시설 수로 다시 판정한다. 153·252·커스텀에서 왕 '임기응변'이 무역 오라 ↔ 제조 오라로 갈린다
function resolveFacCompare(skill: InfraSkill): InfraSkill {
  const fc = skill.facCompare;
  if (!fc) return skill;
  const count = (rooms: string[]) => rooms.reduce((sum, r) => sum + (FACILITY_COUNTS[r] ?? 0), 0);
  const pick = count(fc.a.rooms) >= count(fc.b.rooms) ? fc.a : fc.b;
  return pick.kind === skill.kind && pick.value === skill.value ? skill : { ...skill, kind: pick.kind, value: pick.value };
}

// every distinct skill line (group) applies at once; α/β tiers replace each other
export function activeSkills(op: InfraOp, room: string, product?: string): InfraSkill[] {
  const byGroup = new Map<string, InfraSkill>();
  for (const skill of op.skills) {
    if (!skillApplies(skill, room, product)) continue;
    const existing = byGroup.get(skill.group);
    if (!existing || skill.tier > existing.tier) byGroup.set(skill.group, skill);
  }
  return Array.from(byGroup.values(), resolveFacCompare);
}

export type OpBreakdown = {
  efficiency: number;   // additive order/production efficiency
  facilityEff: number;  // facility-count-based production (survives automation)
  automation: number;   // 위디·유넥티스: zeroes others, scales with plants
  quality: number;      // quality-order probability (equiv %)
  payout: number;       // quality-order payout (테킬라 — scales with quality crew)
  payoutViolation: number; // violation-order payout (프로바이조 — anti-synergy with quality crew)
  orderFix: number;     // 특별 오더 배수(%) — 오더 풀을 통째로 대체 (클로저·U-Official)
  orderFixed: boolean;  // 특별 오더 보유 여부 (배수가 0·음수여도 풀 대체는 일어난다)
  override: number;     // 샤마르: flat rate replacing everyone's efficiency
  perCoworker: number;  // +x% per other member
  clueBase: number;     // 응접실: 레어도·정예화 기본 단서속도 (RIIC 스킬과 별개, 항상 가산)
  auras: Record<string, number>; // control-center facility-wide auras — "동종 최고만" 경쟁형
  aurasAdd: Record<string, number>; // 인원 카운트형(perScope mfg) 오라 — 서로 **중첩(가산)**.
                                    // 스킬에 "동종 효과 중 가장 높은 수치만" 문구가 없고, 실측
                                    // (+131% 제보)으로 플레임테일+비비아나 스택 확인 (2026-07-19)
  cap: number;          // 이 오퍼의 오더 상한/창고 용량 기여 (음수 포함, perFaction이면 인원 스케일)
  capConv: { conv: CapConv; name: string }[]; // 이 오퍼의 용량→출력 변환기 (보통 0~1개).
                                    // 이름을 함께 들고 다니는 건 비중첩 판정(버블이 재활용을
                                    // 죽인다)이 **스킬 이름**으로 지목되기 때문이다.
  amplify: AmpSpec[];   // 이 오퍼가 가진 증폭기 (와이후·스노우상트, 보통 0~1개)
  skills: InfraSkill[];
};

// control auras: only the highest of a kind counts, ranked by the user's
// priority — factories > trading posts > hire contacts > clue speed
export const AURA_WEIGHT: Record<string, number> = C.AURA_WEIGHT;
export const AURA_LABEL: Record<string, string> = { ctrl_mfg: "제조소 생산력 오라", ctrl_trade: "무역소 오더 효율 오라", ctrl_hire: "인맥 레퍼런스 오라", ctrl_clue: "단서 수집 오라" };
// 제어센터 오라가 실제로 더해지는 대상 방 — 방 점수·서머리에 합산된다
export const AURA_TARGET: Record<string, string> = { MANUFACTURE: "ctrl_mfg", TRADING: "ctrl_trade", HIRE: "ctrl_hire", MEETING: "ctrl_clue" };

// 조건부 오라(이격 실버애쉬: "쉐라그 3명 배치된 무역소")는 조건을 채운 그 방 하나에만 적용.
// perFaction+perProduct: 제조소 배치 진영원 오라(플레임테일·제시카 이격) — 기지 전체 일률이
// 아니라 **그 진영원이 앉은 제조소에만** 1명당 적용 (사용자 정정 2026-07-19). perProduct는
// 1명당 생산품별 가감 맵({exp:+10, gold:-10} 또는 {any:+5}), 방별 인원은 ambientFor가 센다.
// rooms: drain_recover(제어센터 횡단 컨디션 회복 — 위셔델·총웨·무에나) 오라의 대상 방 집합.
// 동종 최고 경쟁(ambientFor)이 아니라 endless 순소모 모델(roomMaxNetDrain)만 소비한다.
export type AmbientAura = { kind: string; value: number; gateFaction?: string | null; gateCount?: number | null; belowThreshold?: number | null; perFaction?: string | null; perProduct?: Record<string, number> | null; cap?: number; capPer?: number; rooms?: string[]; aura?: boolean };

// 방 기본 속도 — 임계값 조건("N% 미만인 경우, 기본 속도 포함") 판정용 (사무실 기본 누적 5%)
export const ROOM_BASE_RATE: Record<string, number> = C.ROOM_BASE_RATE;

// 제어센터 팀의 활성 오라 목록 — 대상 방 점수에 앰비언트로 더해 준다
export function aurasOf(controlTeam: InfraOp[], ctx: Ctx): AmbientAura[] {
  const list: AmbientAura[] = [];
  // 제어센터 진주 감면 — 배치 인원 1명당 다른 작업 시설 소모 -0.05 (PRTS 확인·인게임 판별 실험
  // 2026-07-28 확정, v18 복원). endless 순소모 모델·시계 표시 전용 소비 — 제어센터 자신은 미적용.
  if (controlTeam.length) list.push({ kind: "drain_recover", value: CC_OCC_RELIEF * controlTeam.length, rooms: RECOVER_SCOPE_ROOMS.other });
  for (const op of controlTeam) {
    const b = breakdown(op, "CONTROL", controlTeam, ctx);
    for (const skill of b.skills) {
      // 횡단 컨디션 회복 오라 (endless 모델 전용 소비 — 생산 모드에선 아무도 안 읽어 무해)
      if (skill.recoverAura) {
        list.push({ kind: "drain_recover", aura: true, value: recoverAuraValue(skill, ctx.tokenPoints), rooms: RECOVER_SCOPE_ROOMS[skill.recoverAura.scope] ?? [] });
      }
      if (!(skill.kind in AURA_WEIGHT)) continue;
      if (skill.gateFaction || skill.belowThreshold != null) {
        list.push({ kind: skill.kind, value: skill.value, gateFaction: skill.gateFaction, gateCount: skill.gateCount ?? 1, belowThreshold: skill.belowThreshold });
      } else if (skill.perFaction && (skill.perScope === "mfg" || skill.kind === "ctrl_trade")) {
        // 제조소·무역소 "내 <진영> 1명당" 오라 — 기지 전체 일률이 아니라 **대상 방에 실제 앉은
        // 진영원 수**로 1명당 적용한다. 제조소(플레임테일·제시카 이격, 2026-07-19)에 이어
        // 무역소(노시스 '무역소 내 쉐라그 -15%/+6상한'·델핀 '글래스고 +10%'·야하타 '시라쿠사 +5%',
        // 사용자 정정 2026-07-22)도 동일 처리 — 그 진영원이 0명인 방엔 0(노시스 자신도 안 셈).
        // 방별 카운트는 ambientFor(perProduct)·ambientCapFor(capPer)가 대상 방 팀에서 직접 센다.
        // value는 제어센터 자리 평가(§6 가중)용 base-스케일 근사치일 뿐 방 적용엔 안 쓴다.
        list.push({ kind: skill.kind, value: (b.auras[skill.kind] ?? 0) + (b.aurasAdd[skill.kind] ?? 0),
          perFaction: skill.perFaction, perProduct: skill.perProduct ?? { any: skill.value },
          ...(skill.cap ? { capPer: skill.cap } : {}) });
      } else {
        // perFaction 오라 값은 auras(양수 최고) + aurasAdd(음수 가산) 합 — 노시스 -45가 여기 실린다.
        // 같은 스킬의 오더 상한/창고 용량 기여(cap)도 함께 실어 대상 방 변환기에 먹인다(노시스 +18).
        list.push({ kind: skill.kind, value: skill.perFaction ? (b.auras[skill.kind] ?? 0) + (b.aurasAdd[skill.kind] ?? 0) : skill.value,
          ...(skill.cap ? { cap: b.cap } : {}) });
      }
    }
  }
  return list;
}

// 이 방이 실제로 받는 오라 (동종 최고만) — 조건부 오라는 방 구성원·수치가 조건을 채울 때만.
// roomEfficiency: 방 자체 크루가 내는 효율 (사일라흐 임계값 판정: 기본 속도 + 크루 효율 < 임계)
export function ambientFor(room: string, team: InfraOp[], ambient?: AmbientAura[], roomEfficiency = 0, product?: string): number {
  if (!team.length || !ambient) return 0;
  const target = AURA_TARGET[room] ?? "";
  let best = 0;
  let neg = 0;        // 음수 오라(노시스 -45)는 최고 경쟁에 삼켜지면 안 되므로 별도 가산
  let productAdd = 0; // 방 단위 진영원 오라 — 동종 최고 경쟁이 아니라 가감으로 합산 (감산 포함)
  for (const aura of ambient) {
    if (aura.kind !== target) continue;
    if (aura.perProduct) {
      // 이 방에 실제로 앉은 해당 진영·그룹원 수 × 이 방 생산품의 1명당 가감치 (any = 생산품 무관)
      const members = aura.perFaction ? team.filter((member) => memberOf(member, aura.perFaction!)).length : 0;
      if (members > 0) productAdd += ((product ? aura.perProduct[product] : undefined) ?? aura.perProduct.any ?? 0) * members;
      continue;
    }
    if (aura.gateFaction && team.filter((member) => factionsOf(member).includes(aura.gateFaction!)).length < (aura.gateCount ?? 1)) continue;
    if (aura.belowThreshold != null && (ROOM_BASE_RATE[room] ?? 0) + roomEfficiency >= aura.belowThreshold) continue;
    if (aura.value < 0) neg += aura.value;
    else best = Math.max(best, aura.value);
  }
  return best + neg + productAdd;
}

// 제어센터가 이 방에 실어 주는 오더 상한/창고 용량 (노시스 '무역소 내 쉐라그 1명당 +6' 등) — 변환기 입력.
// capPer(1명당)는 대상 방에 실제 앉은 진영원 수로 방별 스케일한다(노시스 자기 카운트·타 무역소 유출 방지).
export function ambientCapFor(room: string, ambient?: AmbientAura[], team?: InfraOp[]): number {
  if (!ambient) return 0;
  const target = AURA_TARGET[room] ?? "";
  let cap = 0;
  for (const aura of ambient) {
    if (aura.kind !== target) continue;
    if (aura.capPer != null && aura.perFaction) cap += aura.capPer * (team ? team.filter((m) => memberOf(m, aura.perFaction!)).length : 0);
    else if (aura.cap) cap += aura.cap;
  }
  return cap;
}

// 팀이 쌓은 용량(capOp = 오퍼 제공분, capTotal = 기본상한 + 오퍼 제공분)을 효율/생산력으로 변환.
function applyCapConv(conv: CapConv, capOp: number, capTotal: number): number {
  switch (conv.t) {
    case "lin": return capOp * conv.rate;
    case "bundle": { const e = Math.floor(capOp / conv.per) * conv.rate; return conv.max != null ? Math.min(e, conv.max) : e; }
    // tier는 문턱식: at 이하면 전량 lo/칸, 초과면 **전량** hi/칸 (한계식 아님 — 실측 확정 2026-07-20).
    // capConvOf가 오퍼별 개별 용량으로 호출한다 (방 합산 아님).
    case "tier": return capOp <= conv.at ? capOp * conv.lo : capOp * conv.hi;
    case "diff": return capTotal * conv.rate;
  }
}

// 방이 받는 용량 변환 효율/생산력 — 이미 계산된 parts를 받아 teamScore와 UI가 공유한다.
function capConvOf(parts: OpBreakdown[], room: string, ambient?: AmbientAura[], team?: InfraOp[]): number {
  const target = AURA_TARGET[room];
  if (target !== "ctrl_trade" && target !== "ctrl_mfg") return 0;
  const capOp = Math.max(0, parts.reduce((sum, p) => sum + p.cap, 0) + ambientCapFor(room, ambient, team));
  const capTotal = (C.CAP_BASE?.[room] ?? 0) + capOp;
  // 비중첩 — 같은 방에 지목된 변환 스킬이 함께 있으면 그쪽은 죽는다 (사용자 제보 2026-07-29:
  // "버메일과 버블은 중첩되지 않음. 버블 스킬 설명에 재활용과 같이 쓸 시 버블이 우선 발동됨").
  // 원문이 이름으로 못 박은 관계라 build-infra.py가 `capConv.over`로 옮기고 여기서 이름으로
  // 억제한다. 죽는 건 변환뿐 — 버메일이 올린 창고 용량(+8)은 그대로 남아 버블의 변환에 실린다.
  const suppressed = new Set(parts.flatMap((p) => p.capConv.flatMap((entry) => entry.conv.over ?? [])));
  // 자동화·오버라이드가 걸린 방에선 **변환분도 죽는다** (사용자 제보 2026-07-29: "버메일 +
  // 스네구로치카 둘 넣으면 실제로는 +23%인데 왜 48%가 찍히나"). 스네구로치카·위디·유넥티스·
  // 윈드플릿·패신저 원문이 "해당 제조소 내의 오퍼레이터가 제공하는 생산력이 **전부 0**이
  // 되고(**시설 수량에 따라** 제공하는 생산력 미포함)"인데, 변환(버메일 재활용·버블)은 오퍼가
  // 제공하는 생산력이지 시설 수량 기반이 아니다 — 예외 조항에 안 걸린다. 종전엔 teamScore가
  // efficiency만 0으로 눌러 capConv가 그대로 살아남았다(버메일+스네구로치카 46 = 자동화 20 +
  // 재활용 26). 샤마르 '속삭임'도 같은 꼴이지만 "**다른 인원**이 제공하는"이라 자기 몫만 남긴다.
  // 창고 용량(+8)은 생산력이 아니라 그대로 있지만, 되돌릴 변환기가 없으니 점수엔 안 잡힌다.
  const automated = parts.some((p) => p.automation > 0);
  const overrider = parts.find((p) => p.override > 0);
  let eff = 0;
  for (const p of parts) for (const { conv, name } of p.capConv) {
    if (suppressed.has(name)) continue;
    if (automated || (overrider != null && p !== overrider)) continue;
    if (conv.t === "tier") {
      // 버블 '큰 게 좋아' — 실측 역산으로 확정 (사용자 제보 2026-07-20, 베나+벌컨+버블 = +93):
      // **오퍼별 개별 용량**에 **문턱식**으로 적용한다 — 그 오퍼의 상승 용량이 at(16) 이하면
      // 전량 lo(1%)/칸, 초과하면 **전량** hi(3%)/칸 (한계식 아님).
      // 베나 17→51, 벌컨 19→57, 버블 10→10 = 118 (−25 페널티 = 93 ✓).
      // 방 합산 한계식(46→106→81)·오퍼별 한계식(54→29)은 실측과 불일치.
      // 제어센터 앰비언트 상한은 '오퍼가 자신이 상승시킨' 용량이 아니므로 제외.
      for (const q of parts) { const c = Math.max(0, q.cap); eff += applyCapConv(conv, c, c); }
    } else {
      eff += applyCapConv(conv, capOp, capTotal);
    }
  }
  return eff;
}

// UI용 — 팀·방·ctx로 용량 변환분을 직접 산출 (방 상세 '용량 변환' 항목). 모달 전용이라 재계산 OK.
export function capConvFor(team: InfraOp[], room: string, ctx: Ctx): number {
  return capConvOf(team.map((op) => breakdown(op, room, team, ctx)), room, ctx.ambient, team);
}

/**
 * 특별 오더가 이 방에 실제로 더하는 %p — 화면 표시용 (teamScore와 **같은 식**).
 * 배수는 방 처리량에 곱으로 걸리므로 "스킬에 적힌 +10%"만 봐선 기여를 알 수 없다
 * (사용자 지적 2026-08-05: "정확하게 몇 % 올려주는지 보여줘야지").
 */
export function orderFixFor(team: InfraOp[], room: string, ctx: Ctx): number {
  const parts = team.map((op) => breakdown(op, room, team, ctx));
  if (!parts.some((p) => p.orderFixed)) return 0;
  return parts.reduce((sum, p) => sum + p.orderFix, 0) * Math.min(1 + roomEfficiency(parts, team) / 100, C.PAYOUT_VIOLATION_CAP);
}

export function breakdown(op: InfraOp, room: string, team: InfraOp[], ctx: Ctx): OpBreakdown {
  const teamIds = new Set(team.map((member) => member.id));
  const teamSize = Math.max(team.length, 1);
  const out: OpBreakdown = { efficiency: 0, facilityEff: 0, automation: 0, quality: 0, payout: 0, payoutViolation: 0, orderFix: 0, orderFixed: false, override: 0, perCoworker: 0, clueBase: 0, auras: {}, aurasAdd: {}, cap: 0, capConv: [], amplify: [], skills: [] };
  const tokenRates = new Map<string, number>();
  for (const skill of activeSkills(op, room, ctx.product)) {
    if (skill.partners.length > 0 && !skill.partners.every((p) => teamIds.has(p))) continue;
    // faction companion gate (호시구마: 용문근위국 오퍼와 함께 배치 시)
    if (skill.reqFaction && !team.some((member) => member.id !== op.id && factionsOf(member).includes(skill.reqFaction!))) continue;
    // 명단형 그룹 동석 게이트 (레우스S·키린R: 아이루와 유쾌한 친구들 — 진영이 아니라 명단)
    if (skill.reqGroup && !team.some((member) => member.id !== op.id && skill.reqGroup!.ids.includes(member.id))) continue;
    // 진영 N명 배치 게이트 (실버애쉬 이격: 쉐라그 3명 배치된 무역소) — 조 전체 인원수 근사
    if (skill.gateFaction && (ctx.factionCounts?.[skill.gateFaction] ?? 0) < (skill.gateCount ?? 1)) continue;
    // 교차방 파트너 조건(레토: 굼이 무역소에): roomOf가 주어진 검증 단계에선 파트너가 지정 방에
    // 실제 있어야 발동. 그리디 1차(roomOf 없음)에선 낙관적으로 통과시켜 짝이 배치될 기회를 준다
    if (skill.roomPartner && ctx.roomOf && ctx.roomOf.get(skill.roomPartner.id) !== skill.roomPartner.room) continue;
    out.skills.push(skill);
    // 작업 플랫폼 발전소 배치 조건(푸딩)은 자동편성이 충족하지 않으므로 오라를 계상하지 않는다
    // — 스킬 자체는 표시(위에서 push)하되 효과는 0으로 둔다
    if (skill.gatePlatforms) continue;
    // 조건부 가산 (르무엔·비나 등 "기본 X% + 조건부 Y%"): 기본치는 아래에서 무조건 더해지고,
    // 여기서 조건(같은 방 진영/오퍼·타방 오퍼) 충족 시 +value 만 얹는다. crossRoom은 roomPartner
    // 게이트와 같은 관례로 roomOf 없으면 낙관 통과, 있으면 엄격 판정.
    if (skill.condBonus) {
      const cb = skill.condBonus;
      // ids는 **조건이 지목한 한 오퍼**(용어 링크면 그 용어의 명단 전원)라 판정은 OR다 —
      // 르무엔 '동반자'의 "엑시아"는 원본·이격 아무나 같은 방이면 +25% (사용자 확인 2026-07-25).
      // AND로 두면 명단이 2명 이상인 순간 조건이 영원히 거짓이 된다(엠브리엘+이격엑시아+르무엔
      // = 105가 80으로 나오던 자리). 두 오퍼를 동시에 요구하는 조건은 basePartners 쪽 규약.
      const ok = cb.faction
        ? team.some((m) => m.id !== op.id && factionsOf(m).includes(cb.faction!))
        : cb.room
          ? (!ctx.roomOf || (cb.ids ?? []).some((id) => ctx.roomOf!.get(id) === cb.room))
          : (cb.ids ?? []).some((id) => teamIds.has(id));
      if (ok) out.efficiency += cb.value;
    }
    // 용량 기여(오더 상한/창고 용량) + 변환기 수집. perFaction(노시스 '쉐라그 1명당 +6')은
    // 인원수로 스케일 — 제어센터 스킬이면 out.cap이 aurasOf를 통해 대상 방으로 앰비언트 전달된다.
    if (skill.cap) {
      const groupIds = (C.OP_GROUPS ?? {})[skill.perFaction ?? ""] ?? null;
      const scale = skill.perFaction
        ? (groupIds ? groupIds.filter((id) => ctx.presentIds?.has(id)).length : ctx.factionCounts?.[skill.perFaction] ?? 0)
        : 1;
      out.cap += skill.cap * scale;
    }
    if (skill.capConv) out.capConv.push({ conv: skill.capConv, name: skill.name });
    // 기반시설 어디든 존재 조건 (언더플로우: 울피아누스가 숙소 포함 기지 내에 있으면 +10%)
    if (skill.basePartners?.length && skill.basePartnerBonus && skill.basePartners.every((p) => ctx.presentIds?.has(p))) {
      out.efficiency += skill.basePartnerBonus;
    }
    // 작업 시설 동반 (외드레르 '자수성가'): 파트너가 그 시설 집합(숙소·가공소 제외)에 배치돼
    // 있으면 **각각** +bonus. 기본치를 게이트하지 않는다 — 조건 미충족이어도 본체(+30%)는 산다.
    // 배치 지도(roomOf)가 있으면 방까지 엄격 판정, 없으면 재적만 확인(레토 조건과 같은 관례).
    if (skill.workPartners?.length && skill.workPartnerBonus) {
      for (const pid of skill.workPartners) {
        if (!ctx.presentIds?.has(pid)) continue;
        const at = ctx.roomOf?.get(pid);
        if (at && skill.workRooms && !skill.workRooms.includes(at)) continue;
        out.efficiency += skill.workPartnerBonus;
      }
    }
    // 시설 카운트 (타락사쿰 '쉐이 오퍼레이터가 배치된 시설 1개당 +4%', 만트라·켈시 이격 '정예'):
    // 그룹원이 한 명이라도 앉은 **칸 수**로 스케일한다. 상한(count)은 게임 상한과 실존 오퍼 수
    // 중 작은 쪽(파서 확정). 배치 지도(cellOf)가 없는 그리디 1차에선 상한을 낙관 적용해
    // 후보 자격을 주고, 감사·검증·UI 단계(cellOf 보유)에서 실제 시설 수로 엄격 계상한다.
    if (skill.perFacility) {
      const pf = skill.perFacility;
      let cells = pf.count;
      if (ctx.cellOf) {
        const seen = new Set<string>();
        for (const id of pf.ids) { const at = ctx.cellOf.get(id); if (at) seen.add(at); }
        cells = Math.min(pf.count, seen.size);
      }
      out.efficiency += pf.per * cells;
    }
    // per-faction counting (바르카리스: 미노스 오퍼레이터 1명당 +v%, 최대 cap).
    // perScope "mfg"(플레임테일·제시카 이격·비비아나 "제조소에 배치된 <진영·그룹> 1명당")의
    // 기지 전체 근사는 같은 제어센터에 앉은 동일 소속(본인 포함)을 빼서 과산정을 줄인다.
    // 명단형 그룹(기사)은 factionCounts에 없으므로 배치 전원(presentIds)에서 직접 센다
    if (skill.perFaction && skill.perSkillTag == null) {
      const isMember = (member: InfraOp) => memberOf(member, skill.perFaction!);
      const seated = skill.perScope === "mfg" ? team.filter(isMember).length : 0;
      const groupIds = (C.OP_GROUPS ?? {})[skill.perFaction] ?? null;
      const baseCount = groupIds
        ? groupIds.filter((id) => ctx.presentIds?.has(id)).length
        : ctx.factionCounts?.[skill.perFaction] ?? 0;
      // 제어센터 무역소 인원 오라(야하타 '무역소 내 시라쿠사 1명당'·델핀·노시스)의 자리 평가:
      // 실제 적용(ambientFor)은 **그 무역소에 앉은** 진영원 수인데, 종전 근사는 기지 전체
      // 인원(factionCounts) × 전 무역소 가중이라 무역소 밖 진영원까지 유령 가치로 잡혔고,
      // Math.max 동종 경쟁이 왕 '임기응변'의 진짜 +7 플랫 오라를 삼켰다 (2026-07-24 —
      // 야하타가 무역소 시라쿠사 1명뿐인데도 왕을 밀어내던 원인). 노시스 원칙("오라는
      // base가 아니라 방내 인원으로 스케일")대로 배치 지도(roomOf)가 있으면 무역소 재적만 센다
      const tradeAura = room === "CONTROL" && skill.kind === "ctrl_trade" && skill.perScope !== "mfg";
      let tradeSeated: number | null = null;
      if (tradeAura && ctx.roomOf) {
        tradeSeated = 0;
        for (const [id, r] of ctx.roomOf) {
          if (r !== "TRADING" || id === op.id) continue;
          const member = opById.get(id);
          if (member && isMember(member)) tradeSeated += 1;
        }
      }
      // "자신을 제외한 <진영> 1명당"(뮤엘시스): 본인이 그 진영이면 카운트에서 자신을 뺀다
      const selfEx = skill.perExclSelf && isMember(op) ? 1 : 0;
      const count = Math.max(0, (skill.perScope === "room"
        ? team.filter(isMember).length
        : tradeSeated ?? Math.max(0, baseCount - seated)) - selfEx);
      const gained = Math.min(skill.value * count, skill.perCap ?? Infinity);
      if (skill.kind in AURA_WEIGHT) {
        // 무역소 인원 오라는 ① 가산 채널 — 적용 모델(ambientFor productAdd)이 플랫 오라와
        // 중첩이므로 동종 최고 경쟁에 넣지 않고, ② 방 수 나눔 — AURA_WEIGHT(ctrl_trade)는
        // "전 무역소" 배율인데 이 오라는 진영원이 앉은 그 방에만 닿으므로 가중을 상쇄해
        // 1개 방 실효로 환산한다 (243 야하타: 5%×1명 → 2.5 ×가중2 = 실효 5)
        if (tradeAura) { out.aurasAdd[skill.kind] = (out.aurasAdd[skill.kind] ?? 0) + gained / Math.max(1, FACILITY_COUNTS.TRADING ?? 1); continue; }
        // 인원 카운트형(mfg)은 중첩 — 플레임테일+비비아나가 같은 방에 함께 실리는 실측 반영.
        // 음수 오라(노시스 '쉐라그 1명당 오더 효율 -15%')도 가산 채널로 — Math.max에 삼켜지면
        // -45 페널티가 통째로 사라진다. 양수는 동종 최고만(중복 오라 이중계상 방지) 유지.
        if (skill.perScope === "mfg" || gained < 0) out.aurasAdd[skill.kind] = (out.aurasAdd[skill.kind] ?? 0) + gained;
        else out.auras[skill.kind] = Math.max(out.auras[skill.kind] ?? 0, gained);
        continue;
      }
      out.efficiency += gained + (skill.perBase ?? 0);  // perBase = 카운트와 별개 flat 기본치 (뮤엘시스 +10%)
      continue;
    }
    // same-room skill-tag counting (도로시: 라인테크류 1개당 +5% / 브라이오피타: 금속공예류 +5%)
    // 계열 판정은 build-infra.py가 정리한 families 카탈로그 우선. 폴백도 부분매칭이 아니라
    // **정확 명칭**("<태그>" 또는 "<태그> α/β/γ")만 인정 — '비표준화'류 오포함 방지, 사용자
    // 확정 2026-07. (컨빅션 "작전기록류 +35%"의 '~류'는 제품 분류라 계열이 아님)
    if (skill.perSkillTag && skill.perSkillValue) {
      const tag = skill.perSkillTag;
      let count = 0;
      for (const member of team) for (const active of activeSkills(member, room, ctx.product)) {
        const raw = (active.krName ?? active.name).trim();
        const inFamily = active.families ? active.families.includes(tag)
          : raw.startsWith(tag) && raw.slice(tag.length).trim().length <= 2 && !/[가-힣]/.test(raw.slice(tag.length));
        if (inFamily) count += 1;
      }
      out.efficiency += skill.perSkillValue * count;
      continue;
    }
    const percentUses = skill.tokenUse.filter((use) => use.percent);
    for (const use of percentUses) {
      const rate = use.value / use.per;
      if (rate > (tokenRates.get(use.token) ?? 0)) tokenRates.set(use.token, rate);
    }
    if (skill.kind === "override") { out.override = Math.max(out.override, skill.value); continue; }
    if (skill.kind === "automation") { out.automation += skill.value * (ctx.plants ?? PLANTS_BASE_RT); continue; }
    // 스네구로치카: 위디·유넥티스와 같은 제로아웃이지만 발전소가 아니라 같은 방 인원수로 스케일
    if (skill.kind === "automation_crew") { out.automation += skill.value * teamSize; continue; }
    // 와이후·스노우상트 증폭: 팀 제공 효율에 스케일 — teamScore에서 opProvided 합산 후 계상
    if (skill.kind === "amplify") { if (skill.amp) out.amplify.push(skill.amp); continue; }
    // 특별 오더 — kind와 별개 필드다 (클로저는 "효율 +10% **그리고** 특별 오더"라 한 스킬이
    // 두 채널을 동시에 갖는다). 배수는 teamScore에서 방 처리량에 곱으로 건다.
    if (typeof skill.orderFix === "number") { out.orderFix += skill.orderFix; out.orderFixed = true; }
    if (skill.kind === "quality") { out.quality += skill.value; continue; }
    if (skill.kind === "payout") { out.payout += skill.value; continue; }
    if (skill.kind === "payout_v") { out.payoutViolation += skill.value; continue; }
    if (skill.kind === "percoworker") { out.perCoworker += skill.value; continue; }
    if (skill.kind === "solo") { if (teamSize === 1) out.efficiency += skill.value; continue; }
    // 단서 공유 상태 기준 — 소모 모드에선 미계상 (사용자 확정 2026-07-27: "케이퍼는 엔간하면
    // 빼는 게 좋음, 단서를 못 받으면 10%로 떨어져 넣었다 뺐다 해야 함" — 장기 지속·무한동력은
    // 방치 운용이 계약이라 공유 상태 유지를 전제할 수 없다. 생산 3모드는 종전대로 낙관 계상.)
    if (skill.kind === "shared") { if (!ENDLESS_ON) out.efficiency += skill.value; continue; }
    if (skill.kind in AURA_WEIGHT) { out.auras[skill.kind] = Math.max(out.auras[skill.kind] ?? 0, skill.value); continue; }
    if (room === "DORMITORY") continue;
    // 기본치(flat base)를 항상 더한다. 과거엔 percentUses가 있으면 통째로 건너뛰어,
    // "기본 X% + 토큰 N점당 Y%" 스킬(삼첸·이아나·Blitz·Frost)의 기본 X%가 누락됐다.
    // 이제 파서가 value=순수 기본치(순수 per-token 스킬은 0)로 넣으므로 무조건 더해도 안전하다.
    // 레이아웃 프리셋 재계산: 시설 배수(퓨어스트림 '무역소당 +20%')·순금 라인(투예·파죰카)은
    // baked value(243 기준) 대신 구조 필드로 활성 레이아웃의 시설 수에서 다시 계산한다 (2026-07-24)
    if (skill.facilityBased) {
      out.facilityEff += skill.facRoom && skill.facPer != null
        ? skill.facPer * (FACILITY_COUNTS[skill.facRoom] ?? 1)
        : skill.value;
    } else if (skill.goldLine) {
      out.efficiency += skill.goldLine.base + Math.floor(GOLD_LINES / skill.goldLine.per) * skill.goldLine.add;
    } else if (skill.growHourly) {
      // 시간 성장형: 편성의 교대 시계가 있으면 그 주기 평균으로 재계산, 없으면 구운 24h 기준
      out.efficiency += ctx.shiftHours ? growAvg(skill.growHourly, ctx.shiftHours) : skill.value;
    } else {
      // 시설 레벨 연동 스킬(숙소 레벨합·응접실·훈련실·로봇)은 실제 레벨로 보정 (2026-07-24)
      out.efficiency += levelAdjusted(skill);
    }
  }
  for (const [token, rate] of tokenRates) out.efficiency += (ctx.tokenPoints[token] ?? 0) * rate;
  // 내보내는 교차방 오라 수신 (저스티스 나이트 → 와일드메인이 앉은 제조소, 사용자 제보
  // 2026-08-07). 제공자가 이 방에 없으므로 **짝인 내가** 역참조해 받는다.
  // roomOf는 조(shift)별 지도라 같은 교대 판정이 공짜로 따라온다.
  //
  // ⚠ roomPartner·condBonus의 "지도 없으면 낙관 통과" 관례를 **따르지 않는다**. 저 관례는
  // 짝이 다른 방 그리디에서 배치될 여지를 주려는 것인데, 여기 제공자는 자동편성이 세울
  // 수단이 없다(교차방 시드가 없다). 낙관 통과시키면 짝이 영구히 +5 뻥튀기돼 실제로는
  // 오지 않는 보너스로 편성이 뒤틀린다 — 실측으로 42개 편성 중 9개가 흔들렸다.
  // 지도가 있을 때만 엄격 판정하면 자동편성은 종전과 동일하고, 수동 배치(항상 지도가 있다)만
  // 정확해진다.
  for (const cb of crossBuffByPartner.get(op.id) ?? []) {
    if (cb.room !== room) continue;
    if (!ctx.roomOf || ctx.roomOf.get(cb.providerId) !== cb.fromRoom) continue;
    // 짝 본인의 생산력과 같은 채널(가산 효율)로 넣는다 — 위디·유넥티스 automation이 켜진
    // 방이면 함께 0이 되고, 와이후 증폭도 함께 받는다. 방에 붙는 생산력 보너스라는 점에서
    // 같은 취급이 맞다.
    out.efficiency += cb.value;
  }
  // 응접실: RIIC 스킬과 별개로 레어도·정예화 기본 단서속도를 모든 배치 오퍼가 가산.
  // efficiency에 묻지 않고 별도 필드로 둬서 화면에 "레어도 기본"으로 따로 표시한다
  if (room === "MEETING") out.clueBase = clueBase(op);
  return out;
}

/**
 * 방의 유효 효율(%) — teamScore와 orderFixFor가 **같은 값**을 쓰도록 뽑아 둔 공용 계산.
 * 샤마르 override는 전원 효율을 대체하고, 위디·유넥티스 automation은 오퍼 제공분만 0으로
 * 만들되 시설 기반 생산력은 살린다.
 */
function roomEfficiency(parts: OpBreakdown[], team: InfraOp[]): number {
  const override = Math.max(...parts.map((p) => p.override), 0);
  const automation = parts.reduce((sum, p) => sum + p.automation, 0);
  const facilityEff = parts.reduce((sum, p) => sum + p.facilityEff, 0);
  const additive = parts.reduce((sum, p) => sum + p.efficiency + p.perCoworker * (team.length - 1), 0);
  // 증폭형 (와이후 협동의식·스노우상트 근면성실): 방 안 오퍼가 제공한 효율(시설 기반 제외)을
  // "per%당 add%" 배수로 되돌린다. 제공 효율 합(opProvided)을 per로 나눠 계단식(floor) 가산,
  // 스킬별 cap. override/automation이 활성이면 제공 효율이 0이 되므로 증폭도 발동하지 않는다.
  const opProvided = parts.reduce((sum, p) => sum + p.efficiency, 0);
  const amplify = parts.reduce((sum, p) => sum + p.amplify.reduce(
    (a, spec) => a + Math.min(spec.cap, Math.floor(opProvided / spec.per) * spec.add), 0), 0);
  return override > 0 ? override * team.length
    : automation > 0 ? automation + facilityEff
    : additive + facilityEff + amplify;
}

export function teamScore(team: InfraOp[], room: string, ctx: Ctx): number {
  const parts = team.map((op) => breakdown(op, room, team, ctx));
  const efficiency = roomEfficiency(parts, team);
  const probCount = parts.filter((p) => p.quality > 0).length;
  const quality = parts.reduce((sum, p) => sum + p.quality, 0);
  // quality payouts (테킬라) profit from quality orders; violation payouts
  // (프로바이조) need low-count orders — quality crew works against them, but
  // a high-throughput post (우요우·에벤홀츠) multiplies her per-order bonus.
  // 위약 감쇄는 별도 상수(사용자 확정 2026-07-27: "샤마르는 고품질 확률 상승, 프로바이조는
  // 위약 오더여야 — 상충이라 효율이 안 좋음"): VIOLATION_STEP=1이면 품질 요원 1명으로 위약
  // 배상이 0이 되어 같은 방에 안 앉는다. 테킬라 쪽 QUALITY_STEP을 같이 올리면 부스트가 1명
  // 만에 캡에 닿아 품질 결집 유인이 죽으므로(바이비크가 제이에 밀림) 반드시 분리 유지.
  const violationStep = (C as unknown as Record<string, number | undefined>).PAYOUT_VIOLATION_STEP ?? C.PAYOUT_QUALITY_STEP;
  // 특별 오더(클로저·U-Official)는 그 방의 순금 오더를 전부 자기 고정 오더로 바꾼다 —
  // 고품질 확률·품질 수익(테킬라 4금 필요)·위약 수익(프로바이조 위약 오더 필요)의 **전제가
  // 사라지므로 전부 0**이다. 대신 자기 배수를 방 처리량에 곱으로 건다 (payout_v와 같은 구조).
  const orderFixed = parts.some((p) => p.orderFixed);
  const orderFix = orderFixed
    ? parts.reduce((sum, p) => sum + p.orderFix, 0) * Math.min(1 + efficiency / 100, C.PAYOUT_VIOLATION_CAP)
    : 0;
  const payout = orderFixed ? orderFix
    : parts.reduce((sum, p) => sum + p.payout, 0) * Math.min(1 + C.PAYOUT_QUALITY_STEP * probCount, C.PAYOUT_QUALITY_CAP)
    + parts.reduce((sum, p) => sum + p.payoutViolation, 0) * Math.max(1 - violationStep * probCount, 0) * Math.min(1 + efficiency / 100, C.PAYOUT_VIOLATION_CAP);
  let auras = 0;
  for (const kind of Object.keys(AURA_WEIGHT)) {
    const bestOfKind = Math.max(...parts.map((p) => p.auras[kind] ?? 0), 0);
    const stacked = parts.reduce((sum, p) => sum + (p.aurasAdd[kind] ?? 0), 0); // 카운트형은 중첩
    auras += (bestOfKind + stacked) * AURA_WEIGHT[kind];
  }
  // 응접실 레어도 기본 단서속도 — 스킬과 무관한 항상 가산분 (override/automation과 무관)
  const clueBaseSum = parts.reduce((sum, p) => sum + p.clueBase, 0);
  // 용량 차원(2-패스): 팀이 쌓은 오더 상한/창고 용량을 변환기가 효율/생산력으로 되돌린다.
  // capOp = 오퍼 제공분(노시스 제어센터 앰비언트 포함), capTotal = 기본상한 + capOp(제이 diff용).
  // 베나+벌컨(용량↑)+버블(변환) · 데겐블레허 · 스와이어 같은 시너지가 여기서 데이터로 성립한다.
  const capConvEff = capConvOf(parts, room, ctx.ambient, team);
  // 제어센터 오라를 대상 방 점수에 실제 합산 — "무역소 오더 효율 +10%"면 무역소가 +10%.
  // 조건부 오라(쉐라그 3명 배치)는 조건을 채운 그 방 하나에만 붙는다
  return efficiency + clueBaseSum + (orderFixed ? 0 : quality) + payout + auras + capConvEff + ambientFor(room, team, ctx.ambient, efficiency, ctx.product);
}

// 비교용 팀 가치 = 생산 점수 + endless 컨디션 보너스 (생산 모드에선 teamScore와 동일).
// 자동편성의 모든 채택 비교(그리디·감사·백필·planScore·대체 추천 순위)는 이 값을 쓰고,
// 표시용 방 % 배지는 순수 teamScore를 유지한다 — 무한동력 모드 2026-07-27.
export function teamValue(team: InfraOp[], room: string, ctx: Ctx): number {
  return teamScore(team, room, ctx) + endlessBonus(team, room, ctx);
}

export function opSolo(op: InfraOp, room: string, slots: number, ctx: Ctx): number {
  const b = breakdown(op, room, [op], ctx);
  let auras = 0;
  for (const kind of Object.keys(AURA_WEIGHT)) auras += ((b.auras[kind] ?? 0) + (b.aurasAdd[kind] ?? 0)) * AURA_WEIGHT[kind];
  // endless 모드: 단독 순소모 보너스(쇼트리스트 순위) — 회복·저소모 오퍼가 top-40에서 잘리지 않게
  // 특별 오더는 단독 기준으로도 자기 효율만큼 증폭된다 (팀 효율 반영은 teamScore가 한다)
  const soloOrderFix = b.orderFixed ? b.orderFix * (1 + b.efficiency / 100) : 0;
  return b.efficiency + b.clueBase + b.facilityEff + b.automation + b.quality + b.payout + b.payoutViolation + soloOrderFix + b.override * slots + b.perCoworker * (slots - 1) + auras + endlessBonus([op], room, ctx);
}

export function bestTeam(room: string, slots: number, pool: Map<string, InfraOp>, ctx: Ctx, seedOps: InfraOp[] = []): InfraOp[] {
  const cands = Array.from(pool.values()).filter((op) => op.skills.some((skill) => skillApplies(skill, room, ctx.product)));
  // 동점 타이브레이크 = **덜 지치는 쪽 먼저** (사용자 확정 2026-07-31: "효율이 동급일 경우
  // A조에 지속시간 긴 놈을 놔야 하는데 이게 고려되지 않고 있음 — 하루카·어스스피릿 둘 다
  // 사무실 +45%인데 A조에 어스스피릿을 박음"). 종전엔 동점이면 **낮은 성급 우선**(6성 아끼기)
  // 이라 어스스피릿(★4·소모+2)이 하루카(★6·소모 0)보다 먼저 뽑혔다.
  // A조를 먼저 채우고 남은 인원으로 B조를 채우므로, 이 순서만 바꾸면 고소모 쪽이 B조로 밀린다.
  // 소모가 없는 방(숙소·가공소, infra.rooms[].drain=0)은 지속시간 개념이 없어 종전 순서 유지.
  const drains = (infra.rooms[room]?.drain ?? 0) > 0;
  const shiftCost = (op: InfraOp) => (drains
    ? activeSkills(op, room, ctx.product).reduce((sum, sk) =>
        sum + sk.moraleDrain + (sk.drainRoom ?? 0) - (sk.recoverRoom ?? 0), 0)
    : 0);
  const solo = cands.map((op) => ({ op, v: opSolo(op, room, slots, ctx), c: shiftCost(op) }))
    .sort((a, b) => {
      if (b.v !== a.v) return b.v - a.v;
      if (SHIFT_TIEBREAK_ON && a.c !== b.c) {
        // 종전(낮은 성급 우선)과 순서가 뒤집힐 때만 A/B를 부른다 — 같은 방향이면 공짜다
        if ((a.c - b.c) * (a.op.rarity - b.op.rarity) < 0) shiftTiebreakUsed = true;
        return a.c - b.c;
      }
      return a.op.rarity - b.op.rarity;
    });
  // 쇼트리스트 = 단독 점수 상위 40 + **팀 의존 역할군 전원**. override/payout/quality/
  // percoworker는 팀이 갖춰져야 가치가 드러나 단독 점수로는 저평가되는데, 쇼트리스트에서
  // 잘리면 그리디·감사 모두 완성형 조합을 영영 못 본다 — 무6성 로스터에서 디아만테(단독 15)가
  // 잘려 샤마르 방이 품질 요원을 못 받던 사례 (사용자 확정 2026-07-19: 계산이 느려져도 전수)
  // 용량 부여기(벌컨 -5%/+19칸·베나 -20%/+17칸)는 단독 점수가 음수라 top-40에서 잘리지만,
  // 변환기(버블·데겐블레허)와 만나야 가치가 드러난다 — cap·capConv 스킬 보유자도 상시 포함.
  const TEAM_KINDS = new Set(["override", "payout", "quality", "percoworker", "amplify"]);
  const rankedBase = solo.slice(0, 40).map((entry) => entry.op);
  const rankedIds = new Set(rankedBase.map((op) => op.id));
  const ranked = [...rankedBase, ...cands.filter((op) =>
    !rankedIds.has(op.id) && op.skills.some((skill) => skillApplies(skill, room, ctx.product)
      && (TEAM_KINDS.has(skill.kind) || (skill.cap ?? 0) !== 0 || skill.capConv != null
        // endless 모드: 소모 감소·근무 회복 보유자도 상시 포함 (cap/capConv와 같은 관례 —
        // 단독 생산 0인 레인보우 팀·THRM-EX류가 top-40에서 잘리면 저소모 조합을 영영 못 본다)
        || (ENDLESS_ON && ((skill.moraleDrain ?? 0) < 0 || (skill.drainRoom ?? 0) < 0
          || skill.selfDrainNegate != null || skill.recoverRoom != null || skill.recoverRoomPer != null || skill.recoverAura != null)))))];
  // 점수가 실제로 오를 때만 슬롯을 채운다 — 0 기여 몸빵으로 컨디션을 낭비하지 않고,
  // 아르모니류 '자신만 업무 중' 스킬은 혼자 남을 수 있다
  const fill = (seed: InfraOp[], shortlist: InfraOp[] = ranked): InfraOp[] => {
    const team = [...seed].slice(0, slots);
    while (team.length < slots) {
      let pick: InfraOp | null = null;
      let pickScore = teamValue(team, room, ctx); // 현재 점수보다 나아야 추가
      for (const op of shortlist) {
        if (team.includes(op)) continue;
        const score = teamValue([...team, op], room, ctx);
        if (score > pickScore) { pickScore = score; pick = op; }
      }
      if (!pick) break;
      team.push(pick);
    }
    return team;
  };
  let best = fill(seedOps);
  let bestScore = teamValue(best, room, ctx);
  // 솔로 스킬 오퍼가 상위에 있으면 그리디가 '혼자 50%'에 갇혀 '둘이 60%' 조합을 놓친다
  // — 솔로 오퍼를 뺀 대안 팀도 만들어 비교한다
  const noSolo = ranked.filter((op) => !op.skills.some((skill) => skill.kind === "solo" && skillApplies(skill, room, ctx.product)));
  if (noSolo.length !== ranked.length) {
    const alt = fill(seedOps, noSolo);
    const altScore = teamValue(alt, room, ctx);
    if (altScore > bestScore) { best = alt; bestScore = altScore; }
  }
  for (const cand of cands) {
    for (const skill of cand.skills) {
      if (skill.room !== room || skill.partners.length === 0) continue;
      const seed = [...seedOps];
      if (!seed.includes(cand)) seed.push(cand);
      let valid = true;
      for (const pid of skill.partners) {
        const partner = pool.get(pid);
        if (!partner) { valid = false; break; }
        if (!seed.includes(partner)) seed.push(partner);
      }
      if (!valid || seed.length > slots) continue;
      const team = fill(seed);
      const score = teamValue(team, room, ctx);
      if (score > bestScore) { best = team; bestScore = score; }
    }
  }
  // 용량 변환 결집 후보 (사용자 제보 2026-07-30: "창고 수량으로 생산량 늘리는 시너지 조합이
  // 아예 적용이 안 되고 있나?"). 변환기(버메일 '재활용' 1칸당 2%·버블 '큰 게 좋아!')는 혼자면
  // 0이고 용량 부여기도 대개 0~음수라(벌컨 −5%/+19칸·베나 −20%/+17칸), 한계 기여 등반은
  // 개별 점수가 높은 언덕(표준화 3인 = 90)에 먼저 갇혀 **셋이 모여야 서는 정점**(버메일·씬·
  // 팔라스 = 105)을 영영 못 본다 — 쇼트리스트 상시 포함(위 cap/capConv)만으론 부족했다.
  // endless 그룹 회복 결집과 같은 관례로 **변환기를 시드**한 후보를 만들고, 남는 자리는
  // ① 그리디 ② 용량 큰 순으로 채운 두 안을 teamValue로 비교한다. ②가 필요한 이유는 tier식
  // (버블)이 **오퍼별 16칸 문턱**을 넘겨야 1%/칸 → 3%/칸이 되는 계단이라, 문턱 앞에서
  // 한계 기여가 꺾여 등반이 멈추기 때문이다. 변환기는 방당 2~3명뿐이라 비용도 작다.
  {
    const converters = CAP_CLUSTER_ON ? cands.filter((op) => activeSkills(op, room, ctx.product).some((sk) => sk.capConv)) : [];
    if (converters.length) {
      const capOf = (op: InfraOp) => activeSkills(op, room, ctx.product).reduce((sum, sk) => sum + (sk.cap ?? 0), 0);
      const givers = cands.filter((op) => capOf(op) > 0).sort((a, b) => capOf(b) - capOf(a));
      for (const conv of converters) {
        for (const withGivers of [false, true]) {
          const seed = [...seedOps];
          if (!seed.some((s) => s.id === conv.id)) seed.push(conv);
          if (seed.length > slots) continue;
          if (withGivers) for (const op of givers) {
            if (seed.length >= slots) break;
            if (!seed.some((s) => s.id === op.id)) seed.push(op);
          }
          const team = fill(seed);
          const score = teamValue(team, room, ctx);
          if (score > bestScore) { best = team; bestScore = score; capClusterUsed = true; }
        }
      }
    }
  }
  // endless 모드 · 그룹 회복 결집 후보 (레인보우 팀 무한동력, 2026-07-27): recoverRoomPer는
  // "보유자 수 × 방 내 그룹원 수"로 스케일해 4보유×5명 = 소모 1.0 정확 상쇄가 정점인데,
  // 그리디 등반은 첫 자리(단독 0.05)가 약해 이 언덕을 못 오른다 — 보유자+그룹원을 시드로
  // 결집한 후보를 만들어 teamValue로 비교한다 (아 같은 고소모 그룹원이 섞이면 비교가 거른다).
  if (ENDLESS_ON) {
    const groups = new Set<string>();
    for (const cand of cands) for (const sk of cand.skills) {
      if (sk.recoverRoomPer && skillApplies(sk, room, ctx.product)) groups.add(sk.recoverRoomPer.faction);
    }
    for (const group of groups) {
      const holders = cands.filter((op) => op.skills.some((sk) => sk.recoverRoomPer?.faction === group && skillApplies(sk, room, ctx.product)));
      const members = Array.from(pool.values()).filter((op) => memberOf(op, group) && !holders.some((h) => h.id === op.id));
      // 두 안을 다 본다 — ② 그룹 결집(보유자+그룹원으로 자리를 다 채움: 레인보우 4보유×5명)과
      // ① 보유자만 시드(남는 자리는 그리디에 맡겨 **타 그룹 회복 보강**이 들어올 수 있게).
      // ①이 없으면 얼터네이트 3보유(0.95)에 훔(리 탐정 +0.2)을 얹어 정확히 0을 만드는 교차
      // 조합을 영영 못 본다 — 무6성 로스터의 무한동력이 이 형태다 (2026-07-28).
      for (const seedBase of [holders, [...holders, ...members]]) {
        const seed = [...seedOps];
        for (const op of seedBase) if (!seed.some((s) => s.id === op.id) && seed.length < slots) seed.push(op);
        const team = fill(seed);
        const score = teamValue(team, room, ctx);
        if (score > bestScore) { best = team; bestScore = score; }
      }
    }
  }
  return best;
}

// need = 이 생성분이 기대는 **경로 전환자** opId 명단 (위스퍼레인의 기억 조각 → 감지 정보 →
// 생각의 사슬이면 [위스퍼레인, 로즈몬티스]). 하나라도 안 앉아 있으면 그 생성분은 죽는다.
export type FlowGenerator = { opId: string; at: string; amount: number; via?: string; convRate?: number; need?: string[]; perMember?: { per: number; cap: number; match: string } };
export type FlowConsumer = { opId: string; at: string; room: string; rate: number; percent: boolean; gain: number };

export type TokenFlow = {
  token: string;
  total: number;
  generators: FlowGenerator[];
  converters: { opId: string; from: string }[];
  consumers: FlowConsumer[];
};

export type Plan = {
  assignments: Record<string, string[][]>; // roomKey -> shift -> opIds
  plants: number; // 발전소 수 (그레이 더 라이트닝베어러 배치 시 4로 간주)
  tokenPoints: Record<string, number>;
  factionCounts: Record<string, number>[]; // per shift, base-wide placements
  flows: TokenFlow[];
  crowdedOut?: { opId: string; room: string }[]; // 자리가 없어 밀려난 토큰 생성원 (탐색 힌트)
  strategy: string;             // KR 조합 문자열 (구버전 저장 호환용)
  strategyTokens?: string[];    // 표시용 구조 필드 — 로케일에서 토큰명 번역해 재조립
  strategySet?: boolean;
  priority?: ProdPriority;    // 우선 생산 모드 (기본 gold)
  auditRounds?: number[];     // 조별 전수 감사 수렴 회차 [A, B] — 진행 안내 재생용
  shiftHours?: number[];      // 조별 교대 시계 [A, B] — 성장형 평균 기준 주기 (최대 소모 오퍼 기준)
};


// 방 채우기 우선순위 (사용자 확정 2026-07): 제조소-순금 > 제조소-작전기록 > 무역소 >
// 발전소 > 사무실 > 응접실 — 먼저 채우는 방이 최고 요원을 가져간다. 응접실은 최하위
// (제어센터는 쉐이 시드·오라 요원 전용이라 경합이 적어 발전소 다음에 둔다).
// 순서 자체는 레이아웃 프리셋(LAYOUT_DEFS.priority)이 정의하고, 여기는 활성 바인딩만 둔다.
export let PRODUCTION_KEYS = LAYOUT_DEFS["243"].priority.gold;
// 우선 생산 모드 (사용자 확정 2026-07): 먼저 채우는 방이 최고 요원을 가져가므로,
// 방 순서만 바꾸면 순금 우선 / 작전기록 우선 / 밸런스(교차)가 된다.
// ── 2축 구조 (사용자 확정 2026-07-28: "순금우선 + 효율우선이 디폴트, 순금우선 + 장기지속도 가능") ──
// **생산 축**(ProdAxis)이 방 채우기 순서를, **운용 축**(DrainMode)이 컨디션 모델 on/off를 정한다.
// 저장·전달은 결합 문자열 하나("gold" = 효율 우선, "gold+endless" = 장기 지속)로 해서 기존
// priority 배관(저장 파일·워커 메시지·플랜 필드)을 그대로 쓴다.
export type ProdAxis = "gold" | "exp" | "balance";
export type ProdPriority = ProdAxis | "gold+endless" | "exp+endless" | "balance+endless";
// 결합 문자열 → 두 축. 레거시 저장값 "endless"·"perpetual"(축 분리 전 단일 모드)은 종전 방 순서가
// 밸런스와 같았으므로 balance+endless로 읽는다 — 무한동력은 장기 지속에 흡수됐다(PERPETUAL_CC).
export function splitPriority(priority?: string): { prod: ProdAxis; drain: DrainMode } {
  if (priority === "endless" || priority === "perpetual") return { prod: "balance", drain: "endless" };
  const [prod, drain] = String(priority ?? "gold").split("+");
  return {
    prod: prod === "exp" ? "exp" : prod === "balance" ? "balance" : "gold",
    drain: drain === "endless" ? "endless" : "off",
  };
}
export function joinPriority(prod: ProdAxis, drain: DrainMode): ProdPriority {
  return (drain === "endless" ? `${prod}+endless` : prod) as ProdPriority;
}
export let PRIORITY_KEYS: Record<ProdAxis, string[]> = LAYOUT_DEFS["243"].priority;
export const SUPPORT_KEYS = ["CONTROL", "HIRE", "MEETING", "WORKSHOP", "TRAINING"];

export function ctxFor(key: string, tokenPoints: Record<string, number>, factionCounts?: Record<string, number>, plants?: number, presentIds?: Set<string>, ambient?: AmbientAura[], roomOf?: Map<string, string>, cellOf?: Map<string, string>): Ctx {
  return { product: cellByKey.get(key)?.product, tokenPoints, factionCounts, plants, presentIds, ambient, roomOf, cellOf };
}

// 불러온(import) plan을 렌더가 안전하게 다룰 수 있는 형태로 정규화한다.
// 방 키는 현재 LAYOUT만 남기고, 각 시프트는 문자열 id 배열로, factionCounts는 조 수만큼
// 채운다. 손상·구버전·수기 편집 파일이 들어와도 인덱스 초과·undefined 접근으로 크래시하지
// 않게 하는 방어 코드 (사용자 제보 2026-07: 커스텀 json 불러오면 인덱스 초과 오류).
export function sanitizePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const src = (p.assignments && typeof p.assignments === "object") ? p.assignments as Record<string, unknown> : {};
  const assignments: Record<string, string[][]> = {};
  for (const cell of LAYOUT) {
    const v = src[cell.key];
    const shifts = Array.isArray(v)
      ? v.map((s) => (Array.isArray(s) ? s.filter((x): x is string => typeof x === "string") : []))
      : [];
    assignments[cell.key] = shifts.length ? shifts : [[]]; // 최소 1개 시프트 보장
  }
  const fc = Array.isArray(p.factionCounts) ? p.factionCounts : [];
  const factionCounts = Array.from({ length: SHIFT_COUNT }, (_, i) =>
    (fc[i] && typeof fc[i] === "object" ? fc[i] : {})) as Record<string, number>[];
  const flows = Array.isArray(p.flows)
    ? (p.flows as unknown[]).filter((f): f is TokenFlow => {
        const o = f as Record<string, unknown>;
        return !!o && typeof o.token === "string" && Array.isArray(o.generators) && Array.isArray(o.converters) && Array.isArray(o.consumers);
      })
    : [];
  return {
    assignments,
    plants: typeof p.plants === "number" ? p.plants : PLANTS_BASE_RT,
    tokenPoints: (p.tokenPoints && typeof p.tokenPoints === "object") ? p.tokenPoints as Record<string, number> : {},
    factionCounts,
    flows,
    strategy: typeof p.strategy === "string" ? p.strategy : "",
    strategyTokens: Array.isArray(p.strategyTokens) ? (p.strategyTokens as unknown[]).filter((x): x is string => typeof x === "string") : [],
    strategySet: !!p.strategySet,
    // 축 분리 후 정규화 — 레거시 "endless"·"perpetual"은 splitPriority가 balance+endless로 읽는다
    priority: typeof p.priority === "string" ? joinPriority(splitPriority(p.priority).prod, splitPriority(p.priority).drain) : "gold",
    // 교대 시계 — 숫자 배열만 인정 (구버전 저장엔 없음 → planScore·UI가 편성에서 재계산)
    ...(Array.isArray(p.shiftHours) && (p.shiftHours as unknown[]).every((n) => typeof n === "number")
      ? { shiftHours: p.shiftHours as number[] } : {}),
  };
}

// 해당 조 기준 기지 내 배치 전원 (숙소·응접실 포함) — 기반시설 존재 조건 판정용
export function presentIdsFor(plan: Plan, shift: number): Set<string> {
  const ids = new Set<string>();
  for (const shifts of Object.values(plan.assignments)) {
    for (const id of shifts[Math.min(shift, shifts.length - 1)] ?? []) ids.add(id);
  }
  return ids;
}

// 조 배치 지도 (오퍼 id → 방 종류) — 방까지 봐야 하는 조건(작업 시설 동반·교차방 파트너)의
// 엄격 판정용. presentIds만으론 숙소에서 쉬는 오퍼까지 "배치됨"으로 세게 된다 (2026-07-25).
export function roomOfFor(plan: Plan, shift: number): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, shifts] of Object.entries(plan.assignments)) {
    const room = cellByKey.get(key)?.room ?? key;
    for (const id of shifts[Math.min(shift, shifts.length - 1)] ?? []) map.set(id, room);
  }
  return map;
}

// 조 배치 지도 (오퍼 id → 배치된 칸) — 시설 **개수**를 세는 조건(타락사쿰 '쉐이가 배치된
// 시설 1개당')용. 같은 종류 방이 여럿이라 roomOf로는 개수를 셀 수 없다 (2026-07-25).
export function cellOfFor(plan: Plan, shift: number): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, shifts] of Object.entries(plan.assignments)) {
    for (const id of shifts[Math.min(shift, shifts.length - 1)] ?? []) map.set(id, key);
  }
  return map;
}

// ── 시너지 세트(팟) — L2 카탈로그 기반 제네릭 조립 (Phase 3, 2026-07-19) ──────────────
// 어떤 팟이 있는지(쉐라그·피누스·품질 조합·이후 추가분)는 rules.json synergySets(L2 데이터)가
// 정의하고, 평가기(anchor.detect / bodies.from / target.cell)만 여기 L0에 있다.
// 각 팟은 **개별 후보**로 평가한다(멱집합) — 단일 플래그로 묶으면 한 세트의 이득에 다른
// 세트가 무임승차로 채택되는 얽힘이 생긴다. 채택은 항상 planScore 비교 (L2는 점수 불간섭).
const SYNERGY_SETS: SynergySetDef[] = RULES.synergySets ?? [];

export type FactionSets = Record<string, boolean>; // def.key → 이 후보안에 세트 포함 여부

const matchAnchorSkill = (detect: string, skill: InfraSkill): boolean =>
  detect === "gateFaction" ? Boolean(skill.gateFaction && skill.gateCount)
  : detect === "perProduct" ? Boolean(skill.kind in AURA_WEIGHT && skill.perFaction && skill.perProduct)
  : false;

// 로스터로 조립 가능한 시너지 세트 키 목록 — 육성 추천(planner-invest)이 후보별로 "완성 시
// 새로 열릴 세트"만 좁혀 평가하도록(전체 optimize 대신 baseline 세트 + 신규 가용 세트만 buildPlan).
export function availableSetKeys(roster: InfraOp[]): string[] {
  return SYNERGY_SETS.filter((def) => synergySetAvailable(def, roster)).map((def) => def.key);
}

// 조립 가능한 각 세트의 참가자(앵커·본체) op id 목록 — 육성 추천이 "이 후보가 그 세트의
// 멤버일 때만" 세트 활성안을 추가 평가하도록(무관한 후보에 세트 재탐색을 돌리던 낭비 제거).
// 비멤버 오퍼를 키워도 휴면 세트가 더 이득이 되진 않으므로(그 세트를 강화하지 않음) 안전하다.
export function synergySetMembers(roster: InfraOp[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const def of SYNERGY_SETS) {
    if (!synergySetAvailable(def, roster)) continue;
    const ids = new Set<string>();
    let anchorFaction: string | null = null;
    if (def.anchor) {
      const anchor = def.anchor;
      for (const op of roster) {
        const sk = op.skills.find((s) => s.room === anchor.room && matchAnchorSkill(anchor.detect, s));
        if (sk) { ids.add(op.id); anchorFaction = anchorFaction ?? sk.gateFaction ?? sk.perFaction ?? null; }
      }
    }
    if (def.bodies) {
      if (def.bodies.from === "anchorFaction" && anchorFaction) {
        for (const op of roster) if (factionsOf(op).includes(anchorFaction)) ids.add(op.id);
      }
      for (const kind of def.bodies.roles ?? []) {
        for (const op of roster) if (op.skills.some((s) => s.room === def.bodies.room && s.kind === kind)) ids.add(op.id);
      }
    }
    out[def.key] = [...ids];
  }
  return out;
}

// 로스터만으로 세트 조립 가능성 판정 — optimize()가 후보 플래그(멱집합의 축)를 만들 때 사용
export function synergySetAvailable(def: SynergySetDef, roster: InfraOp[]): boolean {
  if (def.anchor) {
    const anchor = def.anchor;
    return roster.some((op) => op.skills.some((skill) => skill.room === anchor.room && matchAnchorSkill(anchor.detect, skill)));
  }
  const picked = new Set<string>();
  for (const kind of def.bodies.roles ?? []) {
    const cand = roster.find((op) => !picked.has(op.id) && op.skills.some((skill) => skill.room === def.bodies.room && skill.kind === kind));
    if (!cand) return false;
    picked.add(cand.id);
  }
  return (def.bodies.roles ?? []).length > 0;
}

// 팟 하나를 시드·예약으로 연다 — 그리디가 방 순서 때문에 못 여는 완성형(닭-달걀·시드 선점)의
// 탈출구. 실패 조건(앵커 없음·인원 미달·칸 없음)이면 조용히 무시 → 그 후보안은 기본과 동일.
function seedSynergySet(def: SynergySetDef, roster: InfraOp[], used: Set<string>, reserved: Map<string, string>, seeds: Record<string, InfraOp[]>): void {
  const room = def.bodies.room;
  const soloCtx: Ctx = { tokenPoints: {} };
  const free = (op: InfraOp) => !used.has(op.id) && !reserved.has(op.id);
  // 앵커(오라원) — 별도 방(제어센터 등)에 앉아 세트를 여는 오퍼
  let anchorOp: InfraOp | undefined;
  let anchorSkill: InfraSkill | undefined;
  if (def.anchor) {
    const anchor = def.anchor;
    for (const op of roster) {
      if (!free(op)) continue;
      const skill = op.skills.find((sk) => sk.room === anchor.room && matchAnchorSkill(anchor.detect, sk));
      if (skill) { anchorOp = op; anchorSkill = skill; break; }
    }
    if (!anchorOp || !anchorSkill) return;
  }
  // 본체 대상 생산품 (byAnchorProduct: 앵커 perProduct의 양수 쪽 — 피누스 작전기록)
  const product = def.target.cell === "byAnchorProduct"
    ? Object.entries(anchorSkill?.perProduct ?? {}).find(([, per]) => per > 0)?.[0]
    : undefined;
  if (def.target.cell === "byAnchorProduct" && !product) return;
  const gateCount = anchorSkill?.gateCount ?? 3;
  const resolve = (value: number | "gateCount" | undefined, fallback: number) => (value === "gateCount" ? gateCount : value ?? fallback);
  // 본체 선발 — anchorFaction: 앵커 진영원(쉐라그는 머릿수라 방 스킬 불요), roles: kind 역할 슬롯
  const bodies: InfraOp[] = [];
  if (def.bodies.from === "anchorFaction") {
    const faction = anchorSkill?.gateFaction ?? anchorSkill?.perFaction;
    if (!faction) return;
    bodies.push(...roster
      .filter((op) => op.id !== anchorOp!.id && free(op) && factionsOf(op).includes(faction)
        && (def.bodies.requireRoomSkill === false || op.skills.some((sk) => skillApplies(sk, room, product))))
      .sort((a, b) => opSolo(b, room, 3, soloCtx) - opSolo(a, room, 3, soloCtx))
      .slice(0, resolve(def.bodies.count, 3)));
  } else {
    // 역할 슬롯 순서대로 그리디 — 첫 자리는 단독 점수, 이후는 "지금까지 뽑힌 팀과의 방 점수"로
    // 순위 (품질 요원처럼 팀이 있어야 가치가 드러나는 역할의 동급 대체 판정)
    for (const kind of def.bodies.roles ?? []) {
      const cand = roster
        .filter((op) => free(op) && op.id !== anchorOp?.id && !bodies.some((b) => b.id === op.id)
          && op.skills.some((sk) => sk.room === room && sk.kind === kind))
        .sort((a, b) => (bodies.length
          ? teamScore([...bodies, b], room, soloCtx) - teamScore([...bodies, a], room, soloCtx)
          : opSolo(b, room, 3, soloCtx) - opSolo(a, room, 3, soloCtx)))[0];
      if (cand) bodies.push(cand);
    }
  }
  const min = resolve(def.bodies.min, def.bodies.from === "roles" ? (def.bodies.roles ?? []).length : resolve(def.bodies.count, 3));
  if (bodies.length < min) return;
  // 시드 + 예약 — 같은 조의 앞 순서 방이 시드를 채가거나 전수 감사(seedKeep)가 쓸어내지 않게
  const cells = LAYOUT.filter((c) => c.room === room);
  const cell = def.target.cell === "firstFree" ? cells.find((c) => !(seeds[c.key]?.length))
    : def.target.cell === "byAnchorProduct" ? cells.find((c) => c.product === product)
    : cells[0];
  if (!cell) return;
  seeds[cell.key] = [...(seeds[cell.key] ?? []), ...bodies].slice(0, slotsFor(cell.key));
  for (const op of seeds[cell.key]) reserved.set(op.id, cell.key);
  if (anchorOp && def.anchor) {
    const anchorCell = LAYOUT.find((c) => c.room === def.anchor!.room);
    if (anchorCell) {
      seeds[anchorCell.key] = [...(seeds[anchorCell.key] ?? []), anchorOp].slice(0, slotsFor(anchorCell.key));
      reserved.set(anchorOp.id, anchorCell.key);
    }
  }
}

// 무한동력 제어센터 사전 판정 (사용자 확정 2026-07-28: "장기지속일 시, 무한동력 오퍼가 있다면
// 무한동력 조합 우선으로"). 종전 별도 모드(perpetual)가 하던 일을 로스터 판정으로 대체한다 —
// 락을 켠 상태로 제어센터만 최적화해 순소모 0이 나오면 그 로스터엔 무한동력 조합이 실재하므로
// place 가드(패키지 선점 금지)·CC 락을 계속 켜 두고, 안 나오면 꺼서 종전 장기 지속 경쟁으로 둔다.
// 결과는 로스터별 캐시 — optimizeConfig가 buildPlan을 수십 번 부르므로 재판정 비용을 없앤다.
let PERP_CACHE: { key: string; value: boolean } | null = null;
export function detectPerpetualControl(roster: InfraOp[]): boolean {
  if (!ENDLESS_ON) { PERPETUAL_CC = false; return false; }
  const slots = slotsFor("CONTROL");
  const key = `${slots}|${roster.map((op) => op.id).join(",")}`;
  if (PERP_CACHE?.key === key) { PERPETUAL_CC = PERP_CACHE.value; return PERPETUAL_CC; }
  const pool = new Map(roster.map((op) => [op.id, op] as const));
  const ctx = ctxFor("CONTROL", {}, {}, PLANTS_BASE_RT);
  const prev = PERPETUAL_CC;
  PERPETUAL_CC = true; // 락을 켜야 bestTeam이 순소모 0 조합을 최우선으로 탐색한다
  let team: InfraOp[] = [];
  try { team = bestTeam("CONTROL", slots, pool, ctx); } finally { PERPETUAL_CC = prev; }
  const net = roomMaxNetDrain(team, "CONTROL", ctx);
  const value = net != null && net <= 1e-9;
  PERP_CACHE = { key, value };
  PERPETUAL_CC = value;
  return value;
}

export function buildPlan(packageTokens: string[], fullRoster: InfraOp[], factionSets: FactionSets = {}, priority: ProdPriority = "gold", extraSeeds: { opId: string; room: string }[] = [], concentrate = true, park = false, pinnedDorms: Record<string, string[]> = {}): Plan {
  // 자동편성 제외 명단(케이퍼·인포서)은 여기서 한 번에 걷어낸다 — buildPlan이 모든 편성
  // 생성의 유일한 관문이라 optimize·육성 추천·감사 재편성이 전부 같은 로스터를 본다.
  const roster = autoRoster(fullRoster, pinnedDorms);
  setPriorityMode(priority); // 장기 지속이면 teamValue·시계가 순소모 모델로 전환 (모듈 플래그)
  detectPerpetualControl(roster); // 무한동력 제어센터 성립 여부 — place 가드·CC 락을 함께 켠다
  const prodKeys = PRIORITY_KEYS[splitPriority(priority).prod];
  const assignments: Record<string, string[][]> = {};
  // 시설 카운트 스킬(타락사쿰·만트라)용 배치 지도 — 숙소·가공소까지 **모든 칸**을 센다.
  // 감사 패스의 roomOfS는 근무 방 + 숙소만 담아 시설 개수 판정엔 못 쓴다 (2026-07-25).
  const cellMapFor = (shift: number): Map<string, string> => {
    const map = new Map<string, string>();
    for (const [key, shifts] of Object.entries(assignments)) {
      for (const id of shifts[Math.min(shift, shifts.length - 1)] ?? []) map.set(id, key);
    }
    return map;
  };
  const used = new Set<string>();
  const keys = [...prodKeys, ...SUPPORT_KEYS];
  for (const key of keys) assignments[key] = [];
  const tokenPoints: Record<string, number> = {};
  const flows: TokenFlow[] = [];
  // 자리가 없어 밀려난 토큰 생성원 (optimizeConfig 시드 변형용 — 아래 패키지 루프 참조)
  const crowdedOut: { opId: string; room: string }[] = [];
  const factionCountsPerShift: Record<string, number>[] = [];
  const reserved = new Map<string, string>(); // seeded ops belong to their room
  const packageReserved = new Set<string>();  // 토큰 패키지發 예약(세트 시딩과 구분) — 감사 해제 판정용
  // 그레이 더 라이트닝베어러: 다른 발전소에 1성 로봇(작업 플랫폼)만 없으면
  // 발전소 +1개로 간주 — 발전소에 고정 배치하고 4기로 계산
  const plantBooster = roster.find((op) => op.skills.some((skill) => skill.kind === "plantbonus"));
  const plants = PLANTS_BASE_RT + (plantBooster ? 1 : 0); // 243/153=3(그레이 4), 252=2(그레이 3)

  const dormPins: InfraOp[][] = [[], [], [], []];
  // ── 숙소 수동 고정 (사용자 요청 2026-07-25: "숙소도 배치 변경·고정") ──────────────
  // 사용자가 숙소 칸에 직접 넣어 고정한 오퍼는 자동편성이 건드리지 않는다 — 울피아누스를
  // 숙소에 박아 언더플로우(+10%)를 켜는 운용이 대표 사례다. 근무 방 후보에서도 빼(used)
  // 이중 배치를 막고, 조 전환과 무관하게(숙소 규칙) 양 조 모두 그 자리에 남는다.
  const dormLockOps: Record<string, InfraOp[]> = {};
  const dormLocked = new Set<string>();
  for (let d = 0; d < 4; d += 1) {
    const key = `DORM-${d}`;
    for (const id of (pinnedDorms[key] ?? []).slice(0, slotsFor(key))) {
      const op = roster.find((member) => member.id === id);
      if (!op || dormLocked.has(id)) continue;
      (dormLockOps[key] = dormLockOps[key] ?? []).push(op);
      dormLocked.add(id);
      used.add(id);
      reserved.set(id, key);
    }
    dormPins[d] = [...(dormLockOps[key] ?? [])];
  }
  for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
    const seeds: Record<string, InfraOp[]> = {};
    // 고정 인원을 시드로 먼저 깔아 둔다 — 토큰 패키지의 숙소 배치가 남은 슬롯만 쓰게
    for (const [key, list] of Object.entries(dormLockOps)) seeds[key] = [...list];
    if (shift === 0 && plantBooster) {
      seeds["POWER-0"] = [plantBooster];
      reserved.set(plantBooster.id, "POWER-0");
    }
    // ── 시너지 세트 시딩 — 카탈로그(rules.json synergySets)의 이 조(shift) 팟 중,
    // 이 후보안(factionSets)에 포함된 것만 연다. 도메인 근거는 INFRA-RULES §4·§5.
    for (const def of SYNERGY_SETS) {
      if ((def.shift ?? 0) === shift && factionSets[def.key]) seedSynergySet(def, roster, used, reserved, seeds);
    }
    // perMember 캡 확장 시드 (optimizeConfig 변형 전용, 2026-07-24) — 카운터 진영의 오라
    // 요원(왕)을 지정 방에 예약해 캡 초과를 만든다. 시드 자체는 자리 하나를 쓰지만, 초과가
    // 되면 잉여 소비자(슈)의 패키지 예약이 풀려 방 업그레이드가 연쇄된다. 채택은 planScore.
    // 시드로 먼저 앉은 오퍼는 패키지 루프에서도 **이미 앉은 것**으로 취급해야 한다 — 안 그러면
    // 자기 토큰 생성분이 원장에 안 실린다(위스퍼레인을 사무실에 시드해 놓고 그가 만드는 감지
    // 정보를 계상 못 하던 문제). 2026-07-29.
    const preSeeded = new Set<string>();
    const preSeededAt = new Map<string, string>();
    if (shift === 0) for (const ex of extraSeeds) {
      const op = roster.find((o) => o.id === ex.opId);
      if (!op || used.has(op.id) || reserved.has(op.id)) continue;
      const cell = LAYOUT.find((c) => c.room === ex.room && (seeds[c.key]?.length ?? 0) < slotsFor(c.key));
      if (!cell) continue;
      seeds[cell.key] = [...(seeds[cell.key] ?? []), op];
      reserved.set(op.id, cell.key);
      preSeeded.add(op.id);
      preSeededAt.set(op.id, cell.label);
    }
    if (shift === 0 && packageTokens.length) {
      const parked = new Set<string>(preSeeded);
      const placedAt = new Map<string, string>(preSeededAt);
      const place = (op: InfraOp, key: string) => {
        // 무한동력 성립 시: 제어센터는 순소모 0 조합 전용 — 토큰 패키지가 선점하지 않는다
        // (화식 코어 링·시·총웨가 시드로 앉으면 레인보우/이격 조합이 영영 못 서는 원인)
        if (PERPETUAL_CC && key === "CONTROL") return false;
        seeds[key] = seeds[key] ?? [];
        const slots = slotsFor(key);
        if (seeds[key].length >= slots || parked.has(op.id)) return false;
        seeds[key].push(op);
        parked.add(op.id);
        reserved.set(op.id, key);
        packageReserved.add(op.id);
        placedAt.set(op.id, cellByKey.get(key)?.label ?? key);
        return true;
      };
      for (const token of packageTokens) {
        // converters (에벤홀츠) pull a source token into this one, so source
        // generators (숙소의 아이리스·체르니 등) join the package too
        const converters = roster.filter((op) => op.skills.some((skill) => skill.convert?.to === token));
        // ── 전환은 **여러 홉**을 탄다 (사용자 제보 2026-07-29: "로즈몬티스가 있어도 위스퍼레인
        // 대신 레퍼런스 속도 높은 오퍼가 먼저 배치됨") ─────────────────────────────────
        // 위스퍼레인: 모집마다 **기억 조각** 생성 → (자기 E2) 감지 정보 → (로즈몬티스) 생각의 사슬.
        // 한 홉만 따라가면(종전) 상류 토큰이 '감지 정보'까지라, 감지 정보를 **직접 생성**하지 않는
        // 위스퍼레인은 사슬에서 통째로 빠져 사무실에서 원시 레퍼런스 속도(페넌스 50·하루카 45)로만
        // 줄 세워졌다. 역방향 BFS로 상류 토큰마다 **누적 전환율**과 **그 경로에 필요한 전환자 명단**을
        // 모은다 — 명단이 다 앉아야 사슬이 살아 있다고 본다(중간 전환자가 없으면 죽은 사슬).
        // seen 가드로 순환·중복 경로를 막고 최단 경로 하나만 남긴다.
        const sources = new Map<string, number>();          // 상류 토큰 → 이 토큰 기준 누적 환산율
        const chainNeeds = new Map<string, string[]>();      // 상류 토큰 → 필요한 전환자 opId 명단
        {
          const seen = new Set<string>([token]);
          let frontier: { token: string; rate: number; need: string[] }[] = [{ token, rate: 1, need: [] }];
          while (frontier.length) {
            const next: typeof frontier = [];
            for (const cur of frontier) {
              for (const op of roster) for (const skill of op.skills) {
                const cv = skill.convert;
                if (!cv || cv.to !== cur.token || seen.has(cv.from) || cv.per <= 0) continue;
                seen.add(cv.from);
                const rate = cur.rate * (cv.amount / cv.per);
                const need = [...cur.need, op.id];
                sources.set(cv.from, rate);
                chainNeeds.set(cv.from, need);
                next.push({ token: cv.from, rate, need });
              }
            }
            frontier = next;
          }
        }
        const flow: TokenFlow = { token, total: 0, generators: [], converters: converters.map((op) => ({ opId: op.id, from: op.skills.find((skill) => skill.convert?.to === token)?.convert?.from ?? "" })), consumers: [] };
        flows.push(flow);
        const generatesFor = (op: InfraOp) => op.skills.some((skill) => skill.tokenGen.some((g) => g.token === token || sources.has(g.token)));
        const members = roster.filter((op) => !used.has(op.id) && (generatesFor(op) || op.skills.some((skill) => skill.tokenUse.some((u) => u.token === token))));
        // 무한동력 성립 시: 제어센터 생성분(화식 코어 링·시·총웨)은 place 가드로 앉을 수 없으니
        // 기대치에서 제외한다 — 종전엔 전량 계상돼 소비자(슈)만 예약석을 먹는 죽은 사슬이 생겼다.
        // 비제어센터 잔량(우요우 화식 등 미니 생태)은 정직하게 남아 그만큼만 시드·계상된다.
        const estTotal = roster.reduce((sum, member) => sum + member.skills.reduce((inner, skill) => inner + (PERPETUAL_CC && skill.room === "CONTROL" ? 0 : skill.tokenGen.reduce((acc, g) => acc + (g.token === token ? genEstimate(g) : sources.has(g.token) ? genEstimate(g) * (sources.get(g.token) ?? 0) : 0), 0)), 0), 0);
        for (const op of members) {
          for (const skill of op.skills) {
            const use = skill.tokenUse.find((u) => u.token === token && u.percent);
            if (!use) continue;
            // 시드는 토큰 기대 가치가 큰 핵심 소비자만: 약한 소비자(마르실
            // +5% 급)는 일반 경쟁으로 — 토큰 값은 점수에 자동 반영된다
            if ((use.value / use.per) * estTotal < C.SEED_TOKEN_MIN_GAIN) continue;
            // 우선 생산 모드 순서대로 시드 배치 — 순금 우선이면 순금 제조소부터,
            // 작전기록 우선이면 작전기록부터, 밸런스는 교차 순서로 최고 요원이 앉는다
            const ord = new Map(prodKeys.map((k, i) => [k, i] as const));
            const targets = LAYOUT.filter((c) => c.room === skill.room && !PARK_KEYS.includes(c.key))
              .sort((a, b) => (ord.get(a.key) ?? 99) - (ord.get(b.key) ?? 99));
            for (const cell of targets) if (place(op, cell.key)) break;
          }
        }
        for (const op of members) {
          for (const skill of op.skills) {
            const gen = skill.tokenGen.filter((g) => g.token === token || sources.has(g.token));
            if (!gen.length) continue;
            // 사슬이 사는 조건: 직접 생성이거나, 그 상류 토큰의 **경로 전환자가 전부** 앉아 있을 것
            // (위스퍼레인 기억 조각 → 자기 전환 → 로즈몬티스 전환. 자기 자신은 지금 앉히는 중이라 산 것으로 본다)
            const needsOf = (g: TokenGen) => (g.token === token ? [] : chainNeeds.get(g.token) ?? []);
            const live = (g: TokenGen) => needsOf(g).every((cid) => parked.has(cid) || cid === op.id);
            const converterPlaced = gen.some(live);
            const already = parked.has(op.id);
            // 죽은 전환 사슬의 공급원은 앉히지 않는다 (사용자 확정 2026-07-19): 전환으로만
            // 이 토큰에 기여하는 오퍼(우요우: 화식→주술)는 전환자(지에윈)가 배치돼 있을 때만
            // 자리를 받는다 — 무6성 로스터에서 기대가치 8짜리 사슬이 우요우를 무역소에
            // 예약해 품질 조합(210 > 182.5)을 봉쇄하던 원인
            if (!already && !converterPlaced) continue;
            if (already || LAYOUT.filter((c) => c.room === skill.room).some((cell) => place(op, cell.key))) {
              if (converterPlaced) {
                for (const g of gen) {
                  if (!live(g)) continue; // 여러 홉 중 하나라도 전환자가 없으면 그 생성분은 죽는다
                  const convRate = g.token === token ? 1 : sources.get(g.token) ?? 0;
                  const amount = genEstimate(g) * convRate; // 숙소 레벨당 생성(센시 등)은 실제 레벨로
                  if (amount <= 0) continue;
                  // need = 이 생성분이 기대는 전환자 명단 — 원장 재집계가 "그들이 아직 앉아 있나"를 본다
                  flow.generators.push({ opId: op.id, at: placedAt.get(op.id) ?? "기존 배치", amount, via: g.token === token ? undefined : g.token, convRate, perMember: g.perMember, need: needsOf(g) });
                  tokenPoints[token] = (tokenPoints[token] ?? 0) + amount;
                }
              }
              break;
            }
            // 자리가 없어 밀려난 생성원 — 앞서 처리된 다른 토큰의 시드가 방을 선점했다는 뜻이다
            // (사무실 1석: 화식이 먼저 돌아 멀베리가 앉으면 위스퍼레인의 기억 조각→감지 정보→
            // 생각의 사슬 사슬은 자리가 없어 통째로 죽는다 — 사용자 제보 2026-07-29).
            // 여기서 억지로 밀어내지 않고 **사실만 기록**한다. 누가 나은지는 방 점수가 아니라
            // 기지 총점이 판정할 문제라, optimizeConfig가 이 명단으로 시드 변형을 만들어
            // planScore로 고른다 (미니 토큰 조합·캡 확장과 같은 관례).
            if (converterPlaced && !crowdedOut.some((c) => c.opId === op.id)) crowdedOut.push({ opId: op.id, room: skill.room });
          }
        }
        // 가공소는 토큰 패키지가 선점하지 않는다 — 상시 슬롯(PARK_KEYS)이라 일반 방 채우기가
        // 최고 점수 가공소 오퍼(=니엔 고정, §1)를 넣는다. 예전엔 여기서 토큰 멤버·"family pin"으로
        // 가공소를 강제 배치했으나, 콜라보 토큰(아이룰루=작전팀 A4) family가 같은 진영의 무관한
        // 가공소 오퍼(레인저)를 니엔보다 먼저 앉히는 오발동이 있었다 (사용자 제보 2026-07-21).
        // 쉐이 화식 팟의 니엔도 가공소 최고점(100)이라 일반 채우기로 자연히 고정된다.
      }
      // dorm-pinned package members stay put across both shifts
      for (let d = 0; d < 4; d += 1) {
        const pinned = seeds[`DORM-${d}`] ?? [];
        dormPins[d] = pinned;
        pinned.forEach((op) => used.add(op.id));
      }
    }
    const shiftFactionCounts: Record<string, number> = {};
    // 기지 전체 존재 조건(언더플로우의 울피아누스 등)용 — 숙소 고정 인원 포함,
    // 이 조에서 지금까지 배치된 오퍼가 누적된다
    const placedIds = new Set<string>(dormPins.flat().map((op) => op.id));
    for (const key of keys) {
      // 훈련실은 이 그리디에선 건너뛴다 — 생산 방이 좋은 오퍼를 먼저 가져가야 하기 때문이다.
      // 빈 채로 두는 게 아니라 **말미 채우기 패스**가 남는 인원으로 채운다 (2026-07-29).
      if (key === "TRAINING") { assignments[key].push([]); continue; }
      // 가공소(상시 슬롯)는 조 전환과 무관하게 A조 한 팀만 고정 — B조는 비운다.
      // 사기 비소모 방이라 교대 개념이 없고, 회복 교대에 가공 요원(혼 등)을 끌어올
      // 이유가 없다 (사용자 확정 2026-07-19)
      if (PARK_KEYS.includes(key) && shift > 0) { assignments[key].push([]); continue; }
      const room = cellByKey.get(key)?.room ?? key;
      const slots = slotsFor(key);
      // 예약(시드)은 조 불문 강제 — A조 세트(쉐라그·토큰 코어)뿐 아니라 B조 세트(피누스)도
      // 앞 순서 방이 시드를 채가지 못하게 한다 (A조 예약 오퍼는 이미 used라 B풀에 없음)
      const pool = new Map(roster.filter((op) => !used.has(op.id) && (!reserved.has(op.id) || reserved.get(op.id) === key)).map((op) => [op.id, op]));
      const ctx = { ...ctxFor(key, shift === 0 ? tokenPoints : {}, shiftFactionCounts, plants, placedIds), shift };
      const seed = (seeds[key] ?? []).filter((op) => pool.has(op.id));
      const team = bestTeam(room, slots, pool, ctx, seed);
      team.forEach((op) => {
        used.add(op.id);
        placedIds.add(op.id);
        for (const faction of factionsOf(op)) shiftFactionCounts[faction] = (shiftFactionCounts[faction] ?? 0) + 1;
      });
      assignments[key].push(team.map((op) => op.id));
    }
    factionCountsPerShift.push(shiftFactionCounts);
  }
  // dorms: pinned rest space; package members that generate from the dorm
  // (아이리스·체르니·비르투오사 등) stay locked in regardless of shift
  for (let d = 0; d < 4; d += 1) assignments[`DORM-${d}`] = [dormPins[d].map((op) => op.id)];

  // ── 교차방 조건 리페어 패스 (사용자 제안 2026-07) ──────────────────────────────
  // 그리디는 방을 우선순위대로 채우느라 "굼이 무역소에 있어야 +35%"인 레토처럼 나중에
  // 채워질 방에 걸린 조건을 1차엔 낙관적으로 배치한다. 편성을 다 마친 뒤 조 전체를 다시
  // 보고, 조건이 실제로 미충족인 오퍼는 그 자리에서 더 나은 벤치 오퍼로 교체(없으면 제거)한다.
  // 조건 미충족 오퍼만 손대므로(그리디 결과를 갈아엎지 않음) 안전. 안정될 때까지 최대 5회.
  const byIdAll = new Map(roster.map((op) => [op.id, op]));

  const teamAtKey = (key: string, shift: number): InfraOp[] =>
    (assignments[key]?.[Math.min(shift, (assignments[key]?.length ?? 1) - 1)] ?? [])
      .map((id) => byIdAll.get(id)).filter((op): op is InfraOp => Boolean(op));
  // 근무 방 총점 (훈련실·가공소 제외) — 파킹이 "다른 방"에 이득을 줬을 때만 채택하는 판정치
  const scoreExTraining = (shift: number): number => {
    const cellOf = cellMapFor(shift);
    const present = new Set(cellOf.keys());
    const roomOf = new Map<string, string>();
    for (const [id, k] of cellOf) roomOf.set(id, cellByKey.get(k)?.room ?? k);
    const fc: Record<string, number> = {};
    for (const id of present) { const op = byIdAll.get(id); if (op) for (const f of factionsOf(op)) fc[f] = (fc[f] ?? 0) + 1; }
    const tp = shift === 0 ? tokenPoints : {};
    const amb = aurasOf(teamAtKey("CONTROL", shift), ctxFor("CONTROL", tp, fc, plants, present, undefined, roomOf, cellOf));
    let total = 0;
    for (const key of [...prodKeys, ...SUPPORT_KEYS]) {
      if (key === "TRAINING" || PARK_KEYS.includes(key)) continue;
      total += teamValue(teamAtKey(key, shift), cellByKey.get(key)!.room, { ...ctxFor(key, tp, fc, plants, present, amb, roomOf, cellOf), shift });
    }
    return total;
  };

  // ── 숙소 파킹 (사용자 제보 2026-07-25: "언더플로우 + 울피아누스를 숙소에 고정시켜 쓴다") ──
  // '짝이 기반시설(숙소 포함) 어디에든 있으면 +N%' 조건 — 언더플로우←울피아누스,
  // Bellone←비질, 산크타 믹사파라토←피아메타 — 은 짝이 **일하지 않아도** 성립한다.
  // 울피아누스는 훈련실 전용이라 자동편성이 어디에도 안 앉혔고, 그래서 이 조건은 영영
  // 거짓이었다: 언더플로우가 30%로 평가돼 같은 30%인 야토·팽·굼 무리 뒤(무역소 후보 23위)로
  // 밀렸다 — 짝이 있으면 40%로 3위. 여기서 교착이 하나 생긴다. 짝을 주차할 이유는 수혜
  // 오퍼가 배치돼야 생기고, 수혜 오퍼가 배치되려면 짝이 먼저 있어야 한다. 그래서 감사 **전에**
  // 씨앗 주차(seedParks)로 짝을 빈 숙소에 넣어 두고, 감사가 끝난 뒤 쓸모없어진 주차를 뺀다.
  // 주차해도 근무 후보 자격은 유지한다 — 피아메타처럼 원래 일할 오퍼를 숙소에 가둬 응접실
  // 자리를 잃으면 오히려 손해였다(-3.8). 근무에 뽑히면 그 즉시 숙소에서 뺀다.
  const dormKeys = LAYOUT.filter((cell) => cell.room === "DORMITORY").map((cell) => cell.key);
  const parked = new Set<string>();
  const workKeysAll = [...prodKeys, ...SUPPORT_KEYS];
  const workingSomewhere = (id: string) => workKeysAll.some((key) => (assignments[key] ?? []).some((team) => team.includes(id)));
  const unparkOne = (id: string, mirror?: Set<string>) => {
    for (const key of dormKeys) assignments[key][0] = (assignments[key][0] ?? []).filter((other) => other !== id);
    parked.delete(id);
    mirror?.delete(id);
  };
  const unparkEmployed = (mirror?: Set<string>) => {
    for (const id of [...parked]) if (workingSomewhere(id)) unparkOne(id, mirror);
  };
  const freeDorm = () => dormKeys.find((key) => (assignments[key]?.[0]?.length ?? 0) < slotsFor(key));
  // 로스터에 짝이 있는 조건은 전부 미리 주차 — 감사가 수혜 오퍼를 실제로 뽑을 기회를 준다
  const seedParks = () => {
    const partners = new Set<string>();
    for (const op of roster) {
      for (const skill of op.skills) {
        if (!skill.basePartnerBonus) continue;
        for (const pid of skill.basePartners ?? []) if (byIdAll.has(pid)) partners.add(pid);
      }
    }
    for (const pid of partners) {
      if (reserved.has(pid) || workingSomewhere(pid) || dormKeys.some((key) => (assignments[key]?.[0] ?? []).includes(pid))) continue;
      const spot = freeDorm();
      if (!spot) break;
      assignments[spot][0] = [...(assignments[spot][0] ?? []), pid];
      parked.add(pid);
    }
  };
  // 편성이 확정된 뒤 정리 — 수혜 오퍼가 실제로 배치된 짝만 남기고, 새로 필요해진 짝은 넣는다
  const parkEnablers = () => {
    const wanted = new Set<string>();
    for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
      for (const [id, key] of cellMapFor(shift)) {
        const op = byIdAll.get(id);
        const cell = cellByKey.get(key);
        if (!op || !cell) continue;
        for (const skill of op.skills) {
          if (!skill.basePartnerBonus || !skillApplies(skill, cell.room, cell.product)) continue;
          for (const pid of skill.basePartners ?? []) wanted.add(pid);
        }
      }
    }
    for (const id of [...parked]) if (!wanted.has(id)) unparkOne(id);
    const present = new Set<string>([...cellMapFor(0).keys(), ...cellMapFor(1).keys()]);
    for (const pid of wanted) {
      if (present.has(pid) || reserved.has(pid) || !byIdAll.has(pid)) continue;
      const spot = freeDorm();
      if (!spot) break;
      const before = scoreExTraining(0) + scoreExTraining(1);
      assignments[spot][0] = [...(assignments[spot][0] ?? []), pid];
      if (scoreExTraining(0) + scoreExTraining(1) > before + 1e-6) { parked.add(pid); present.add(pid); }
      else assignments[spot][0] = (assignments[spot][0] ?? []).filter((id) => id !== pid);
    }
  };
  if (park) seedParks();

  for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
    for (let pass = 0; pass < 5; pass += 1) {
      const roomOf = new Map<string, string>();
      const placed = new Set<string>();
      for (const key of Object.keys(assignments)) {
        const room = cellByKey.get(key)?.room ?? key;
        for (const id of assignments[key][Math.min(shift, assignments[key].length - 1)] ?? []) { roomOf.set(id, room); placed.add(id); }
      }
      const fc: Record<string, number> = {};
      for (const id of placed) { const op = byIdAll.get(id); if (op) for (const f of factionsOf(op)) fc[f] = (fc[f] ?? 0) + 1; }
      // 다른 조의 근무 인원 — 대체 후보로 뽑으면 A·B 동시 배치가 되므로 제외 (INFRA-RULES §1)
      const otherWorking = new Set<string>();
      for (const okey of Object.keys(assignments)) {
        const oroom = cellByKey.get(okey)?.room ?? okey;
        if (oroom === "DORMITORY" || oroom === "WORKSHOP") continue;
        for (const id of assignments[okey][Math.min(SHIFT_COUNT - 1 - shift, assignments[okey].length - 1)] ?? []) otherWorking.add(id);
      }
      let changed = false;
      for (const key of prodKeys) {
        const room = cellByKey.get(key)?.room ?? key;
        const idx = Math.min(shift, assignments[key].length - 1);
        const team = (assignments[key][idx] ?? []).map((id) => byIdAll.get(id)).filter((op): op is InfraOp => Boolean(op));
        if (!team.length) continue;
        const ctx: Ctx = { product: cellByKey.get(key)?.product, tokenPoints: shift === 0 ? tokenPoints : {}, factionCounts: fc, plants, presentIds: placed, roomOf, cellOf: cellMapFor(shift) };
        // 조건(roomPartner)이 실제 미충족인 멤버 — 시드/예약 오퍼는 건드리지 않는다
        const member = team.find((op) => reserved.get(op.id) !== key && op.skills.some((sk) =>
          sk.roomPartner && skillApplies(sk, room, ctx.product) && roomOf.get(sk.roomPartner.id) !== sk.roomPartner.room));
        if (!member) continue;
        const rest = team.filter((op) => op !== member);
        // 미충족 멤버는 "빼기(DROP)"를 기본값으로 둔다 — 조건이 안 채워진 데드웨이트는
        // 슬롯을 비우는 게 낫다(0 기여 몸빵 금지). 유지·대체가 더 나을 때만 그쪽을 택한다.
        let bestScore = teamScore(rest, room, ctx);
        let bestPick: InfraOp | "DROP" | null = "DROP";
        if (teamScore(team, room, ctx) > bestScore) { bestScore = teamScore(team, room, ctx); bestPick = null; }
        for (const op of roster) {
          if (placed.has(op.id) || reserved.has(op.id) || otherWorking.has(op.id)) continue;
          if (!op.skills.some((sk) => skillApplies(sk, room, ctx.product))) continue;
          const sc = teamScore([...rest, op], room, ctx);
          if (sc > bestScore) { bestScore = sc; bestPick = op; }
        }
        if (bestPick) {
          const newTeam = bestPick === "DROP" ? rest : [...rest, bestPick];
          assignments[key][idx] = newTeam.map((op) => op.id);
          placed.delete(member.id); roomOf.delete(member.id);
          if (bestPick !== "DROP") { placed.add(bestPick.id); roomOf.set(bestPick.id, room); }
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  // ── 편성 후 전수 감사 ×3 (사용자 확정 2026-07, INFRA-RULES §1) ────────────────────
  // 한 번의 그리디로는 "A조=최강·조 동시배치 금지·빈 방 금지" 규칙을 놓치므로, 편성을
  // 마친 뒤 수렴할 때까지(최대 8회 — 사용자 확정 2026-07-19: 계산이 수 초 걸려도 전수조사
  // 반복이 우선) 다시 훑어 교정한다. 매 회: ① A조가 각 방(제품 타입별)에서 최강이
  // 되도록 B조의 더 나은 요원을 끌어올리고(같은 방타입 내 swap, 시드/예약은 고정) →
  // ② A·B 동시 배치를 제거하고 → ③ 빈 근무 방을 벤치 최고 요원으로 채운다. 사기 비소모
  // 방 숙소(휴식)·가공소(상시 슬롯)만 예외로 조 전환과 무관하게 고정.
  // 조별 전수 감사가 몇 회 만에 수렴했는지 — UI가 최종 단계에서 회차를 재생 표시한다
  const auditRounds: number[] = [0, 0];
  {
    const restRoom = (key: string) => { const r = cellByKey.get(key)?.room ?? key; return r === "DORMITORY" || r === "WORKSHOP"; };
    const workKeys = keys.filter((key) => !restRoom(key) && key !== "TRAINING");
    const dormIds = new Set<string>();
    for (let d = 0; d < 4; d += 1) for (const id of assignments[`DORM-${d}`]?.[0] ?? []) dormIds.add(id);
    // 조 단위 2단계 감사 (사용자 규칙 2026-07): A조를 먼저 수렴까지 전수검사로 풀파워로
    // 완성하고(전체 로스터에서 선발), 그 뒤 B조를 "남은 오퍼만으로" 수렴까지 전수검사한다.
    // A·B를 한 번에 섞어 보면 서로 자리를 뺏고 되돌리는 진동이 생긴다.
    const orderKeys = [...prodKeys, ...SUPPORT_KEYS].filter((k) => workKeys.includes(k));
    // 무한동력 방의 양조 고정 인원 (opId → 방 키) — 동시 배치 금지의 유일한 근무 방 예외
    const permaBoth = new Map<string, string>();
    for (let auditShift = 0; auditShift < SHIFT_COUNT; auditShift += 1) {
      // ── 무한동력 방 양조 고정 (사용자 확정 2026-07-27: "무한동력이면 절대룰(A·B 동시 배치
      // 금지)을 깨고 같이 넣어도 됨") ── A조 감사 수렴 직후: 제어센터의 A조 순소모가 0이면
      // (판정이 자기 방 인원만으로 닫혀 있어 조 전환과 무관) 컨디션이 닳지 않으므로 숙소·
      // 가공소처럼 그 크루를 **양조 고정**한다 — 한무(레인보우·이격)센터를 영원히 안 건드리는
      // 운용. 제어센터가 고정되면 그 오라(기본 효과·횡단 회복)가 양조에 동일하게 걸리므로,
      // 그 오라 아래 순소모 0인 다른 근무 방(로봇 발전소 등)도 함께 고정한다. 고정 인원은
      // reserved에 올려 B조 감사가 유지하고, 동시 배치 제거에서 자기 방만 면제된다.
      if (ENDLESS_ON && auditShift === 1) {
        const teamOf0 = (key: string) => (assignments[key]?.[0] ?? []).map((id) => byIdAll.get(id)).filter((op): op is InfraOp => Boolean(op));
        const ccTeam = teamOf0("CONTROL");
        const ccNet = ccTeam.length ? roomMaxNetDrain(ccTeam, "CONTROL", { ...ctxFor("CONTROL", tokenPoints, factionCountsPerShift[0], plants), shift: 0 }) : null;
        if (ccNet != null && ccNet <= 1e-9) {
          const amb = aurasOf(ccTeam, ctxFor("CONTROL", tokenPoints, factionCountsPerShift[0], plants));
          for (const key of workKeys) {
            const room = cellByKey.get(key)?.room ?? key;
            const team = teamOf0(key);
            if (!team.length) continue;
            const net = roomMaxNetDrain(team, room, { ...ctxFor(key, tokenPoints, factionCountsPerShift[0], plants, undefined, amb), shift: 0 });
            if (net == null || net > 1e-9) continue;
            const idx = Math.min(1, (assignments[key]?.length ?? 1) - 1);
            // 밀려나는 기존 B조 예약자(피누스 세트 플레임테일 등)는 예약을 풀어 재배치 가능하게
            for (const id of assignments[key]?.[idx] ?? []) {
              if (!team.some((op) => op.id === id) && reserved.get(id) === key) reserved.delete(id);
            }
            assignments[key][idx] = team.map((op) => op.id);
            for (const op of team) { permaBoth.set(op.id, key); reserved.set(op.id, key); }
          }
        }
      }
      const tp = auditShift === 0 ? tokenPoints : {};
      // 앞서 확정한 조의 근무자 — 이번 조에서 사용 금지(동시 배치 금지), 남아 있으면 제거
      const lockedPrev = new Set<string>();
      for (let s2 = 0; s2 < auditShift; s2 += 1) for (const k of workKeys) for (const id of assignments[k]?.[s2] ?? []) lockedPrev.add(id);
      for (const k of workKeys) {
        const idx = Math.min(auditShift, (assignments[k]?.length ?? 1) - 1);
        // 무한동력 양조 고정 인원은 자기 방에서만 동시 배치 허용 (그 외 방에선 종전대로 제거)
        assignments[k][idx] = (assignments[k]?.[idx] ?? []).filter((id) => !lockedPrev.has(id) || permaBoth.get(id) === k);
      }
    for (let pass = 0; pass < 8; pass += 1) {
      auditRounds[auditShift] = pass + 1;
      let changed = false;
      const shift = auditShift;
      // 이 조의 교대 시계 — 패스 시작 시점 편성 기준 (패스 내 교체는 다음 패스에서 수렴)
      const shiftClock = shiftHoursFor(workKeys.map((k) => {
        const idx = Math.min(shift, (assignments[k]?.length ?? 1) - 1);
        return { room: cellByKey.get(k)?.room ?? k, ops: (assignments[k]?.[idx] ?? []).map((id) => byIdAll.get(id)).filter(Boolean) as InfraOp[] };
      }));

      // ① 방별 통째 검수 (사용자 규칙 2026-07): 시설을 하나하나 보며
      //    세 후보를 만들어 "총 생산력"을 직접 비교하고 높은 쪽을 배치한다. 한 자리씩 바꾸는
      //    swap이 아니라 팀 전체 단위 비교라 국소최적에 안 갇힌다. (B조를 검수하지 않으면
      //    "도로시 혼자" 같은 방이 회복 교대에 그대로 남는다 — 사용자 지적 2026-07)
      //    ⓐ 현재 팀 그대로
      //    ⓑ 일반 재편성 — 자유 풀(벤치, 반대 조 근무자 제외)에서 방 전체를 다시 짠 최고 팀
      //    ⓒ 시너지 결집 — perSkillTag 보유자(도로시: 라인테크류 1개당 +5%)를 축으로 같은
      //       계열(families 카탈로그)을 채운 팀. 계열 요원이 같은 조 다른 방에 있으면 그 방의
      //       손실(차출 후 재충원해도 남는 점수 하락)을 비용으로 계산해 순증일 때만 차출한다.
      //       **총점 동률이면 ⓒ(시너지 결집)를 우선한다** — 같은 점수면 계열을 모아두는 쪽이
      //       정배이고, 사용자가 편성을 읽을 때도 의도가 보인다.
      //    시드·예약 요원은 항상 유지, roomPartner는 엄격 평가(굼 없는 레토 방지).
      {
        for (const aKey of orderKeys) {
          const room = cellByKey.get(aKey)?.room ?? aKey;
          const slots = slotsFor(aKey);
          // 이 조의 현재 배치 지도 (매 방마다 갱신) + 반대 조 근무자(동시 배치 금지 대상)
          const roomKeyOf = new Map<string, string>();
          for (const k of workKeys) for (const id of assignments[k]?.[shift] ?? []) roomKeyOf.set(id, k);
          const otherWork = lockedPrev; // 앞 조(A) 근무자만 잠금 — 같은 조 내 이동은 자유
          const roomOfS = new Map<string, string>();
          for (const [id, k] of roomKeyOf) roomOfS.set(id, cellByKey.get(k)?.room ?? k);
          for (const id of dormIds) roomOfS.set(id, "DORMITORY");
          const cellOfS = cellMapFor(shift);
          const present = new Set<string>([...roomKeyOf.keys(), ...dormIds]);
          const ctx = { ...ctxFor(aKey, tp, factionCountsPerShift[shift], plants, present), roomOf: roomOfS, cellOf: cellOfS, shiftHours: shiftClock, shift };
          const curTeam = (assignments[aKey][shift] ?? []).map((id) => byIdAll.get(id)).filter((op): op is InfraOp => Boolean(op));
          // 패키지 예약 해제 (사용자 통찰 2026-07-24: "쉐이가 5명까지라 슈가 필요 없다"):
          // 토큰을 직접 생성·전환하지 않는 패키지 예약자는, 자신이 빠져도 모든 perMember
          // 카운터(총웨 '쉐이 1명당 +5, 최대 5명')가 상한을 유지하면 시드 고정을 풀고 일반
          // 경쟁에 부친다 — 왕이 제어센터에 앉아 쉐이가 6명이 되면 슈의 순금방 자리는 더 강한
          // 평범 제조 요원에게 넘어갈 수 있다. 생성원·전환원이거나 상한 미달이면 종전대로 고정.
          // 카운트는 원장 재집계와 같은 범위(A조 근무방 전체 — 가공소 포함, 숙소 제외).
          const packageReleasable = (op: InfraOp): boolean => {
            if (shift !== 0 || !packageReserved.has(op.id)) return false;
            if (op.skills.some((sk) => sk.tokenGen.length > 0 || sk.convert)) return false;
            for (const flow of flows) for (const gen of flow.generators) {
              const pm = gen.perMember;
              if (!pm || !factionsOf(op).some((f) => f.includes(pm.match))) continue;
              let count = 0;
              for (const k of keys) for (const id of assignments[k]?.[0] ?? []) {
                if (id === op.id) continue;
                const member = byIdAll.get(id);
                if (member && factionsOf(member).some((f) => f.includes(pm.match))) count += 1;
              }
              if (count < pm.cap) return false;
            }
            return true;
          };
          // 예약 시드는 조 불문 유지 — A조 세트(쉐라그 등)와 B조 세트(피누스, 2026-07-19)
          // 모두 감사 재편성(ⓑ flat)이 쓸어내지 않도록 현재 방에 예약된 멤버를 시드로 고정
          const seedKeep = curTeam.filter((op) => reserved.get(op.id) === aKey && !packageReleasable(op));
          // 자유 풀 = 벤치 + 이 방의 현재 멤버 (같은 조 다른 방·반대 조 근무·숙소 고정·타방 예약 제외)
          const freeOps = roster.filter((op) =>
            (!dormIds.has(op.id) || parked.has(op.id)) && !otherWork.has(op.id) &&  // 주차는 근무 후보 자격을 뺏지 않는다
            (!roomKeyOf.has(op.id) || roomKeyOf.get(op.id) === aKey) &&
            (!reserved.has(op.id) || reserved.get(op.id) === aKey));
          const score = (team: InfraOp[]) => teamValue(team, room, ctx);
          let bestPickTeam = curTeam;
          let bestNet = score(curTeam);
          let bestDonors: { fromKey: string; refill: InfraOp[] }[] = [];
          // ⓑ 일반 재편성
          const flat = bestTeam(room, slots, new Map(freeOps.map((op) => [op.id, op])), ctx, seedKeep);
          if (score(flat) > bestNet + 1e-6) { bestPickTeam = flat; bestNet = score(flat); bestDonors = []; }
          // ⓒ 시너지 결집 — 계열 카운트 보유자별 후보 팀
          const holders = freeOps.filter((op) => activeSkills(op, room, ctx.product).some((sk) => sk.perSkillTag && sk.perSkillValue));
          for (const holder of holders) {
            const tags = new Set(activeSkills(holder, room, ctx.product).flatMap((sk) => (sk.perSkillTag ? [sk.perSkillTag] : [])));
            const isFam = (op: InfraOp) => op.id !== holder.id && activeSkills(op, room, ctx.product).some((sk) => {
              if (sk.families) return sk.families.some((f) => tags.has(f));
              const raw = (sk.krName ?? sk.name).trim(); // 폴백도 정확 명칭만 — 부분매칭 금지
              return [...tags].some((t) => raw.startsWith(t) && raw.slice(t.length).trim().length <= 2 && !/[가-힣]/.test(raw.slice(t.length)));
            });
            let team = seedKeep.some((op) => op.id === holder.id) ? [...seedKeep] : [...seedKeep, holder];
            if (team.length > slots) continue;
            // 전체 자유 풀에서 한계 기여 순으로 채우되, **동률이면 계열 요원 우선**(미세 보정 +1e-4).
            // 계열만 먼저 채우면 [도로시+계열+계열]=95가 [도로시+계열+강범용]=100을 가리는 함정이 있다.
            let adding = true;
            while (adding && team.length < slots) {
              adding = false;
              let pick: InfraOp | null = null; let ps = score(team) + 1e-6;
              for (const op of freeOps) {
                if (team.some((t) => t.id === op.id)) continue;
                const s = score([...team, op]) + (isFam(op) ? C.FAMILY_TIEBREAK : 0);
                if (s > ps) { ps = s; pick = op; }
              }
              if (pick) { team.push(pick); adding = true; }
            }
            // 같은 조 다른 방의 계열 요원 차출 — 그 방의 손실을 비용으로 치르고 순증일 때만
            const donors: { fromKey: string; refill: InfraOp[] }[] = [];
            let net = 0;
            if (team.length < slots) {
              for (const [id, fromKey] of roomKeyOf) {
                if (team.length >= slots) break;
                if (fromKey === aKey || reserved.has(id)) continue;
                const op = byIdAll.get(id);
                if (!op || !isFam(op) || team.some((t) => t.id === op.id)) continue;
                const gain = score([...team, op]) - score(team);
                const dRoom = cellByKey.get(fromKey)?.room ?? fromKey;
                const dSlots = slotsFor(fromKey);
                const dCtx = { ...ctxFor(fromKey, tp, factionCountsPerShift[shift], plants, present), roomOf: roomOfS, cellOf: cellOfS, shift };
                const dTeam = (assignments[fromKey][shift] ?? []).map((x) => byIdAll.get(x)).filter((o): o is InfraOp => Boolean(o));
                const rest = dTeam.filter((o) => o.id !== id);
                const claimed = new Set(team.map((t) => t.id));
                const dPool = new Map(freeOps.filter((o) => !claimed.has(o.id)).map((o) => [o.id, o]));
                const refill = bestTeam(dRoom, dSlots, dPool, dCtx, rest);
                const cost = teamValue(dTeam, dRoom, dCtx) - teamValue(refill, dRoom, dCtx);
                if (gain - cost > 1e-6) { team.push(op); donors.push({ fromKey, refill }); net -= cost; }
              }
            }
            // 남는 자리는 자유 풀 최고 요원으로 (점수가 오를 때만 — 0 기여 몸빵 금지)
            if (team.length < slots) {
              const claimed = new Set([...team.map((t) => t.id), ...donors.flatMap((d) => d.refill.map((o) => o.id))]);
              team = bestTeam(room, slots, new Map(freeOps.filter((o) => !claimed.has(o.id)).map((o) => [o.id, o])), ctx, team);
            }
            const total = score(team) + net;
            // 순증이면 채택. 차출 없는 결집은 동률(±1e-6)이어도 채택 — 같은 점수면 시너지를
            // 모아두는 게 정배(시너지 우선 규칙). 동일 팀 재선택은 커밋 가드가 걸러 수렴한다.
            const wins = donors.length ? total > bestNet + 1e-6 : total > bestNet - 1e-6;
            if (wins) { bestPickTeam = team; bestNet = Math.max(bestNet, total); bestDonors = donors; }
          }
          // 최고 후보 배치 (중복·공백은 바로 뒤 ②·③이 정규화)
          const newIds = bestPickTeam.map((o) => o.id);
          if (newIds.join() !== (assignments[aKey][shift] ?? []).join()) {
            assignments[aKey][shift] = newIds;
            for (const d of bestDonors) assignments[d.fromKey][shift] = d.refill.map((o) => o.id);
            unparkEmployed(dormIds);  // 주차해 뒀던 짝이 근무에 뽑혔으면 숙소에서 뺀다(이중 배치 방지)
            changed = true;
          }
        }
      }

      // ④ 체인 승격 (사용자 지적 2026-07: 미즈키 30 근무·트라고디아 35 벤치): 제품 전용
      //    스페셜리스트는 자기 제품 방이 동률 범용으로 차 있으면 ⓑ 재편성으로 못 들어온다
      //    (동률이라 교체 이득 0). 벤치 오퍼 S를 방 R의 멤버 M 자리에 넣고(손해 없음 이상),
      //    밀려난 M을 다른 방 R2의 더 약한 W 자리(또는 빈 슬롯)로 옮기는 2단 이동을
      //    "두 방 합산 순증"일 때 실행한다. 시드·예약은 건드리지 않는다.
      {
        let moved = true;
        let guard = 0;
        while (moved && guard < 30) {
          moved = false; guard += 1;
          const roomKeyOf = new Map<string, string>();
          for (const k of workKeys) for (const id of assignments[k]?.[shift] ?? []) roomKeyOf.set(id, k);
          const otherWork = lockedPrev; // 앞 조(A) 근무자만 잠금 — 같은 조 내 이동은 자유
          const roomOfS = new Map<string, string>();
          for (const [id, k] of roomKeyOf) roomOfS.set(id, cellByKey.get(k)?.room ?? k);
          for (const id of dormIds) roomOfS.set(id, "DORMITORY");
          const cellOfS = cellMapFor(shift);
          const present = new Set<string>([...roomKeyOf.keys(), ...dormIds]);
          const ctxOf = (key: string) => ({ ...ctxFor(key, tp, factionCountsPerShift[shift], plants, present), roomOf: roomOfS, cellOf: cellOfS, shift });
          const scoreOf = (key: string, team: InfraOp[]) => teamValue(team, cellByKey.get(key)?.room ?? key, ctxOf(key));
          const teamOf = (key: string) => (assignments[key]?.[shift] ?? []).map((id) => byIdAll.get(id)).filter((op): op is InfraOp => Boolean(op));
          const bench = roster.filter((op) => (!dormIds.has(op.id) || parked.has(op.id)) && !roomKeyOf.has(op.id) && !otherWork.has(op.id) && !reserved.has(op.id));
          // 후보 S = 벤치(이탈 비용 0) + 같은 조 다른 방 근무자(이탈 시 그 방을 벤치로 재충원한
          // 손실 g0 부담) — 미틈이 다른 무역소에 묶여 샤마르·테킬라 조합에 못 가는 케이스 회수
          const sources: { S: InfraOp; fromKey: string | null }[] = [
            ...bench.map((S) => ({ S, fromKey: null as string | null })),
            ...[...roomKeyOf.entries()].filter(([id]) => !reserved.has(id)).map(([id, k]) => ({ S: byIdAll.get(id)!, fromKey: k as string | null })).filter((x) => Boolean(x.S)),
          ];
          chain: for (const { S, fromKey } of sources) {
            // 소스 방 이탈 비용 (벤치면 0)
            let g0 = 0; let srcRefill: InfraOp[] | null = null;
            if (fromKey) {
              const t0 = teamOf(fromKey);
              const room0 = cellByKey.get(fromKey)?.room ?? fromKey;
              const slots0 = slotsFor(fromKey);
              const pool0 = new Map(bench.map((o) => [o.id, o]));
              srcRefill = bestTeam(room0, slots0, pool0, ctxOf(fromKey), t0.filter((o) => o.id !== S.id));
              g0 = scoreOf(fromKey, srcRefill) - scoreOf(fromKey, t0);
            }
            for (const rKey of workKeys) {
              if (rKey === fromKey) continue;
              const room = cellByKey.get(rKey)?.room ?? rKey;
              if (!S.skills.some((sk) => skillApplies(sk, room, cellByKey.get(rKey)?.product))) continue;
              const team = teamOf(rKey);
              const base1 = scoreOf(rKey, team);
              for (let i = 0; i < team.length; i += 1) {
                const M = team[i];
                if (reserved.has(M.id)) continue;
                const g1 = scoreOf(rKey, team.map((o, x) => (x === i ? S : o))) - base1;
                if (g1 < -1e-6) continue; // S가 그 자리에서 손해면 체인 무의미
                // M의 최선 재배치처 탐색 (다른 방의 약한 멤버 대체 또는 빈 슬롯)
                let g2 = 0; let r2Key: string | null = null; let wIdx = -1;
                for (const cand of workKeys) {
                  if (cand === rKey || cand === fromKey) continue;
                  const room2 = cellByKey.get(cand)?.room ?? cand;
                  if (!M.skills.some((sk) => skillApplies(sk, room2, cellByKey.get(cand)?.product))) continue;
                  const t2 = teamOf(cand);
                  const base2 = scoreOf(cand, t2);
                  const slots2 = slotsFor(cand);
                  if (t2.length < slots2) {
                    const g = scoreOf(cand, [...t2, M]) - base2;
                    if (g > g2) { g2 = g; r2Key = cand; wIdx = -1; }
                  }
                  for (let j = 0; j < t2.length; j += 1) {
                    if (reserved.has(t2[j].id)) continue;
                    const g = scoreOf(cand, t2.map((o, x) => (x === j ? M : o))) - base2;
                    if (g > g2) { g2 = g; r2Key = cand; wIdx = j; }
                  }
                }
                if (g0 + g1 + g2 > 1e-6) {
                  if (fromKey && srcRefill) assignments[fromKey][shift] = srcRefill.map((o) => o.id);
                  assignments[rKey][shift] = team.map((o, x) => (x === i ? S : o)).map((o) => o.id);
                  if (r2Key) {
                    const t2 = teamOf(r2Key);
                    assignments[r2Key][shift] = (wIdx < 0 ? [...t2, M] : t2.map((o, x) => (x === wIdx ? M : o))).map((o) => o.id);
                  }
                  changed = true; moved = true;
                  break chain; // 지도가 바뀌었으니 처음부터 다시 스캔
                }
              }
            }
          }
        }
      }

      // ②·③ 조 동시배치 제거 + 빈 방 재충원 (이번 조만)
      {
        const otherWorking = lockedPrev;
        const usedThisShift = new Set<string>();
        for (const key of workKeys) {
          // 무한동력 양조 고정(permaBoth)은 자기 방에 한해 동시 배치 허용 — 절대룰의 유일한 예외
          const kept = (assignments[key][shift] ?? []).filter((id) => (!otherWorking.has(id) || permaBoth.get(id) === key) && !usedThisShift.has(id));
          if (kept.length !== (assignments[key][shift] ?? []).length) changed = true;
          assignments[key][shift] = kept;
          for (const id of kept) usedThisShift.add(id);
        }
        // roomPartner 조건 엄격 평가용 현재 배치 지도 — 재충원이 굼 없는 레토 등을 도로 넣지 않게.
        const roomOfS = new Map<string, string>();
        for (const k of workKeys) { const rm = cellByKey.get(k)?.room ?? k; for (const id of assignments[k]?.[shift] ?? []) roomOfS.set(id, rm); }
        for (let dd = 0; dd < 4; dd += 1) for (const id of assignments[`DORM-${dd}`]?.[0] ?? []) roomOfS.set(id, "DORMITORY");
        const cellOfS = cellMapFor(shift);
        for (const key of workKeys) {
          const room = cellByKey.get(key)?.room ?? key;
          const slots = slotsFor(key);
          const team = assignments[key][shift] ?? [];
          if (team.length >= slots) continue;
          const present = new Set<string>([...usedThisShift, ...dormIds]);
          const ctx = { ...ctxFor(key, shift === 0 ? tokenPoints : {}, factionCountsPerShift[shift], plants, present), roomOf: roomOfS, cellOf: cellOfS, shift };
          const pool = new Map(roster.filter((op) =>
            !usedThisShift.has(op.id) && !otherWorking.has(op.id) &&
            (!reserved.has(op.id) || reserved.get(op.id) === key)).map((op) => [op.id, op]));
          const seed = team.map((id) => byIdAll.get(id)).filter((op): op is InfraOp => Boolean(op));
          const filled = bestTeam(room, slots, pool, ctx, seed);
          if (filled.length !== team.length) changed = true;
          assignments[key][shift] = filled.map((op) => op.id);
          for (const op of filled) { usedThisShift.add(op.id); roomOfS.set(op.id, room); }
        }
      }

      if (!changed) break;
    }
    }
  }

  // ── 절대룰: 슬롯 백필 (사용자 확정 2026-07-24, INFRA-RULES §1) ────────────────
  // "시설은 오퍼레이터 총 숫자가 모자란 게 아니면 반드시 꽉 채운다." 점수 모델은 보너스%만
  // 다루지만 실제 게임은 배치 인원 자체가 기본 생산분을 낸다 — 스킬 무관 몸빵이라도 빈
  // 슬롯보다 항상 낫다 (153 순금방 슈 단독 사례). 대상은 인원 자체가 기본 기여를 하는
  // 제조소·무역소·응접실·사무실. 제어센터·발전소는 스킬 없는 배치가 사기 소모뿐이라 제외,
  // 훈련실(특화 대기)·가공소(상시 1조)·숙소(휴식)는 의도적 공실 유지. 벤치에서 한계 기여
  // 최고 순으로 채우고(대개 0 — 동률이면 저레어·선출시 우선), 점수가 내려가도(솔로 스킬 방)
  // 채운다 — 절대룰이 점수에 우선. A·B 동시 배치 금지 유지: 한 번 채운 벤치는 재사용 금지.
  {
    const BODY_ROOMS = new Set(["TRADING", "MANUFACTURE", "HIRE", "MEETING"]);
    const targets: string[] = [];
    for (const key of keys) {
      const room = cellByKey.get(key)?.room ?? key;
      if (BODY_ROOMS.has(room) && !PARK_KEYS.includes(key) && !targets.includes(key)) targets.push(key);
    }
    const dormIds = new Set<string>();
    for (let d = 0; d < 4; d += 1) for (const id of assignments[`DORM-${d}`]?.[0] ?? []) dormIds.add(id);
    const workingAny = new Set<string>();
    for (const key of Object.keys(assignments)) {
      const room = cellByKey.get(key)?.room ?? key;
      if (room === "DORMITORY") continue;
      for (const arr of assignments[key]) for (const id of arr) workingAny.add(id);
    }
    const bench = roster.filter((op) => !workingAny.has(op.id) && (!dormIds.has(op.id) || parked.has(op.id)) && !reserved.has(op.id));
    for (let shift = 0; shift < SHIFT_COUNT && bench.length; shift += 1) {
      const roomOfS = new Map<string, string>();
      for (const key of Object.keys(assignments)) {
        const room = cellByKey.get(key)?.room ?? key;
        for (const id of assignments[key][Math.min(shift, assignments[key].length - 1)] ?? []) roomOfS.set(id, room);
      }
      for (const id of dormIds) roomOfS.set(id, "DORMITORY");
      const cellOfS = cellMapFor(shift);
      const present = new Set<string>(roomOfS.keys());
      for (const key of targets) {
        if (!bench.length) break;
        const room = cellByKey.get(key)?.room ?? key;
        const slots = slotsFor(key);
        const team = (assignments[key][shift] ?? []).map((id) => byIdAll.get(id)).filter((op): op is InfraOp => Boolean(op));
        let added = false;
        while (team.length < slots && bench.length) {
          const ctx = { ...ctxFor(key, shift === 0 ? tokenPoints : {}, factionCountsPerShift[shift], plants, present), roomOf: roomOfS, cellOf: cellOfS, shift };
          const base = teamValue(team, room, ctx);
          let at = 0;
          let best = teamValue([...team, bench[0]], room, ctx) - base;
          for (let i = 1; i < bench.length; i += 1) {
            const d = teamValue([...team, bench[i]], room, ctx) - base;
            const tie = Math.abs(d - best) <= 1e-9;
            if (d > best + 1e-9 || (tie && (bench[i].rarity < bench[at].rarity || (bench[i].rarity === bench[at].rarity && bench[i].seq < bench[at].seq)))) { best = d; at = i; }
          }
          const [pick] = bench.splice(at, 1);
          team.push(pick);
          present.add(pick.id);
          roomOfS.set(pick.id, room);
          for (const faction of factionsOf(pick)) factionCountsPerShift[shift][faction] = (factionCountsPerShift[shift][faction] ?? 0) + 1;
          added = true;
        }
        if (added) assignments[key][shift] = team.map((op) => op.id);
      }
    }
  }

  // ── ⑤ 우선 생산 집중 — 무승부 타이브레이크 (사용자 확정 2026-07-25) ─────────────────
  // 순금/작전기록 우선일 때, product:any 요원을 비우선 제조소에서 우선 제조소로 끌어와 **우선 방
  // 생산력을 올리되 전체 plan 총점(planScore)은 보존(무승부 이상)**할 때만 스왑한다. product:any는
  // 어느 제조소든 생산력이 같아(순금%=작전기록%) 순금↔작전기록 재배치가 총점 무승부라, 총점만 보는
  // 감사(①④)는 안 옮긴다 — 화식 소비자(슈·지에윈)가 순금방을 시드로 점유하고 미니멀·와이후가
  // 작전기록방에 낭비되던 갭. **감사·백필 완료 후 최종 폴리시로 1회만** 돈다: 감사 패스 중간(과도
  // 상태·B조 미수렴)에 돌리면 수렴 궤도를 틀고 config 채택까지 뒤집혀 총점이 되레 샌다(전례:
  // full/gold −5.82·withFuture/exp −2.75). 컨빅션 등 product:exp 전용은 우선방서 점수가 안 올라
  // 자동 제외, 시너지·파트너·교대시계 손실은 **실제 planScore 가드**가 걸러낸다. 밸런스 모드는 건너뜀.
  // concentrate=false는 optimizeConfig의 **config 탐색 단계** — ⑤가 config별 planScore를 바꿔
  // 토큰 패키지 채택을 뒤집으면(전례: withFuture/exp에서 주술 결정 패키지가 밀려 −2.75) 안 되므로,
  // 탐색은 ⑤-무관(원래 선택 그대로)으로 돌리고 **채택된 config에만 최종 1회 ⑤를 입힌다**.
  // 생산 축만 본다 — 운용 축(장기 지속)은 품목 집중과 직교한다 ("순금 우선 + 장기 지속"도 순금 집중)
  const prodAxis = splitPriority(priority).prod;
  const preferProduct = concentrate ? (prodAxis === "gold" ? "gold" : prodAxis === "exp" ? "exp" : null) : null;
  if (preferProduct) {
    const isManu = (k: string) => cellByKey.get(k)?.room === "MANUFACTURE";
    const prefKeys = prodKeys.filter((k) => isManu(k) && cellByKey.get(k)?.product === preferProduct);
    const otherKeys = prodKeys.filter((k) => isManu(k) && cellByKey.get(k)?.product && cellByKey.get(k)?.product !== preferProduct);
    const work5 = keys.filter((k) => { const r = cellByKey.get(k)?.room ?? k; return r !== "DORMITORY" && r !== "WORKSHOP" && k !== "TRAINING"; });
    const dorm5 = new Set<string>();
    for (let d = 0; d < 4; d += 1) for (const id of assignments[`DORM-${d}`]?.[0] ?? []) dorm5.add(id);
    const producesInPref = (op: InfraOp) => op.skills.some((sk) => sk.room === "MANUFACTURE" && (sk.product === "any" || sk.product === preferProduct));
    const provPlan = { assignments, plants, tokenPoints, factionCounts: factionCountsPerShift } as unknown as Plan;
    for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
      const team5 = (key: string) => (assignments[key]?.[shift] ?? []).map((id) => byIdAll.get(id)).filter((o): o is InfraOp => Boolean(o));
      // 우선 제품 방들의 생산력 합 — 스왑이 실제로 우선 제품을 올렸는지 방향 판정용(제어센터 오라 포함)
      const prefScore = () => {
        const rko = new Map<string, string>();
        for (const k of work5) for (const id of assignments[k]?.[shift] ?? []) rko.set(id, cellByKey.get(k)?.room ?? k);
        for (const id of dorm5) rko.set(id, "DORMITORY");
        const cko = cellMapFor(shift);
        const pres = new Set<string>([...rko.keys(), ...dorm5]);
        const tp5 = shift === 0 ? tokenPoints : {};
        const amb = aurasOf(team5("CONTROL"), ctxFor("CONTROL", tp5, factionCountsPerShift[shift], plants, pres));
        let t = 0;
        for (const k of prefKeys) t += teamScore(team5(k), "MANUFACTURE", { ...ctxFor(k, tp5, factionCountsPerShift[shift], plants, pres, amb), roomOf: rko, cellOf: cko });
        return t;
      };
      let swapped5 = true; let g5 = 0;
      while (swapped5 && g5 < 30) {
        swapped5 = false; g5 += 1;
        const prefBefore = prefScore();
        const fullBefore = planScore(provPlan, byIdAll);
        let done5 = false;
        for (const pKey of prefKeys) {
          const pIds0 = [...(assignments[pKey]?.[shift] ?? [])];
          for (const nKey of otherKeys) {
            const nIds0 = [...(assignments[nKey]?.[shift] ?? [])];
            for (const a of team5(nKey)) {
              if (reserved.has(a.id) || !producesInPref(a)) continue; // 예약 안 됐고 우선방서 생산 가능한 요원만
              for (const b of team5(pKey)) {
                // 스왑을 임시 적용해 우선 제품 합·전체 plan 총점(planScore)을 재평가한다
                assignments[pKey][shift] = [...pIds0.filter((id) => id !== b.id), a.id];
                assignments[nKey][shift] = [...nIds0.filter((id) => id !== a.id), b.id];
                // 우선 제품 생산력이 실제로 오르고, 전체 plan 총점이 안 내려갈 때만 채택(무승부 이상)
                if (prefScore() > prefBefore + 1e-6 && planScore(provPlan, byIdAll) >= fullBefore - 1e-6) {
                  swapped5 = true; done5 = true; break;
                }
                assignments[pKey][shift] = pIds0; assignments[nKey][shift] = nIds0; // 되돌림
              }
              if (done5) break;
            }
            if (done5) break;
          }
          if (done5) break; // 지도가 바뀌었으니 처음부터 다시 스캔
        }
      }
    }
  }

  // ── 훈련실 파킹 (사용자 정정 2026-07-25: "훈련실에 절대로 아무것도 넣으면 안 되는 건 아니다") ──
  // 훈련실은 특화 훈련용으로 비워 두는 게 정배지만 **금지**는 아니다. 다른 오퍼의 조건이
  // 훈련실 배치로만 충족되는 경우 — 외드레르 '자수성가'의 W처럼 작업 시설(발전소·제조소·
  // 무역소·사무실·응접실·제어 센터·훈련실)이 훈련실밖에 안 남았을 때 — 는 넣는다.
  // 훈련실 자체 산출(훈련 속도)을 노리고 채우지는 않으므로, ⓐ 후보는 **이미 배치된 오퍼의
  // 조건이 지목하는 오퍼**로만 한정하고 ⓑ 판정 점수에서 훈련실 자신은 뺀다.
  {
    for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
      const idx = Math.min(shift, (assignments["TRAINING"]?.length ?? 1) - 1);
      if (!assignments["TRAINING"]) break;
      // 두 조 통틀어 어느 근무 방에든 이미 들어간 오퍼는 제외 — A·B 동시 배치 금지 (§1)
      const otherWorking = new Set<string>();
      for (const key of [...prodKeys, ...SUPPORT_KEYS]) {
        if (key === "TRAINING") continue;
        for (const team of assignments[key] ?? []) for (const id of team) otherWorking.add(id);
      }
      // 훈련실은 위에서 건너뛰므로 **다른 조 훈련실** 인원을 따로 더한다 — 안 그러면
      // A조 훈련실에 앉은 오퍼가 B조 훈련실에도 또 앉는다 (A·B 동시 배치 금지, §1)
      (assignments["TRAINING"] ?? []).forEach((team, i) => { if (i !== idx) for (const id of team) otherWorking.add(id); });
      for (let slot = 0; slot < slotsFor("TRAINING"); slot += 1) {
        const cellOf = cellMapFor(shift);
        const placed = new Set(cellOf.keys());
        // 배치된 오퍼의 조건이 지목하는 미배치 오퍼만 후보 (훈련실을 조건 충족용으로만 쓴다)
        const wanted = new Set<string>();
        for (const [id, key] of cellOf) {
          const op = byIdAll.get(id);
          const cell = cellByKey.get(key);
          if (!op || !cell) continue;
          for (const skill of op.skills) {
            if (!skillApplies(skill, cell.room, cell.product)) continue;
            if (skill.workRooms?.includes("TRAINING")) for (const pid of skill.workPartners ?? []) wanted.add(pid);
            if (skill.roomPartner?.room === "TRAINING") wanted.add(skill.roomPartner.id);
            if (skill.perFacility) for (const pid of skill.perFacility.ids) wanted.add(pid);
          }
        }
        const before = scoreExTraining(shift);
        let best: { id: string; score: number } | null = null;
        for (const op of roster) {
          if (!wanted.has(op.id) || placed.has(op.id) || otherWorking.has(op.id) || reserved.has(op.id)) continue;
          assignments["TRAINING"][idx] = [...(assignments["TRAINING"][idx] ?? []), op.id];
          const after = scoreExTraining(shift);
          assignments["TRAINING"][idx] = (assignments["TRAINING"][idx] ?? []).filter((id) => id !== op.id);
          if (after > before + 1e-6 && (!best || after > best.score)) best = { id: op.id, score: after };
        }
        if (!best) break;
        assignments["TRAINING"][idx] = [...(assignments["TRAINING"][idx] ?? []), best.id];
      }
      // ⓒ **남는 자리는 비워 둔다** — 잉여 인원으로 훈련실을 채우는 패스는 폐기했다
      // (사용자 지시 2026-07-29: "훈련실은 그냥 비워줘"). 훈련 속도는 총점에 안 들어가니
      // 공짜처럼 보였지만 실제론 두 가지를 망가뜨렸다. ① 훈련실도 총웨 '자신을 아는 자'가
      // 세는 시설이라(숙소·활동실만 제외) 남는 쉐이(왕)를 여기 앉히면 캡이 **초과**되고,
      // 그러면 optimizeConfig의 'perMember 캡 확장 변형'이 "정확히 캡일 때만" 걸리는 조건에
      // 안 걸려 통째로 죽는다 — 왕을 제어센터에 앉혀 슈의 예약을 푸는 더 좋은 안(실측 +12.2)을
      // 영영 못 찾았다. ② 채우기 패스는 감사가 끝난 **뒤**에 도는 후처리라, 이렇게 판을 흔들면
      // 앞선 판정의 전제가 사후에 바뀐다. 훈련실은 ⓐ 다른 오퍼의 조건이 지목할 때만 쓴다.
    }
  }
  // 편성 확정 — 씨앗 주차 중 수혜 오퍼가 결국 배치되지 않은 짝은 숙소에서 빼고(이유 없는
  // 숙소 인원은 편성을 읽을 수 없게 만든다), 새로 필요해진 짝은 이득일 때만 넣는다.
  if (park) parkEnablers();

  // ledger: recount per-member generators against the actual A-crew roster,
  // then record who cashes the points in
  const rosterById = new Map(roster.map((op) => [op.id, op]));
  const placedA: InfraOp[] = [];
  for (const key of [...PRODUCTION_KEYS, ...SUPPORT_KEYS]) {
    for (const id of assignments[key]?.[0] ?? []) {
      const op = rosterById.get(id);
      if (op) placedA.push(op);
    }
  }
  // 원장에 실린 생성원 중 **감사가 결국 빼 버린 오퍼**는 재집계에서 뺀다 — 패키지 예약
  // 해제(자기 소비 전환자 등)로 지에윈이 벤치로 가면 그가 만들던 주술 결정도 0이어야 한다.
  // 숙소 생성원(센시 마물 요리)이 있으니 존재 판정은 숙소까지 포함한다.
  const presentA = new Set(placedA.map((op) => op.id));
  for (let d = 0; d < 4; d += 1) for (const id of assignments[`DORM-${d}`]?.[0] ?? []) presentA.add(id);
  for (const flow of flows) {
    // 전환 사슬(via)은 **경로 전환자가 전부** 앉아 있을 때만 산다 — 지에윈이 벤치로 가면
    // 화식→주술 결정 환산분이 전부 죽고, 로즈몬티스가 빠지면 위스퍼레인의 기억 조각→감지 정보→
    // 생각의 사슬도 통째로 죽는다(원장에 유령 점수가 남지 않게). 구버전 저장 플랜은 need가
    // 없으니 종전 판정(직접 전환자 아무나 존재)으로 되돌린다.
    const converterLive = flow.converters.some((conv) => presentA.has(conv.opId));
    flow.generators = flow.generators.filter((gen) => presentA.has(gen.opId)
      && (!gen.via || (gen.need ? gen.need.every((id) => presentA.has(id)) : converterLive)));
    let total = 0;
    for (const gen of flow.generators) {
      if (gen.perMember) {
        const count = placedA.filter((op) => factionsOf(op).some((faction) => faction.includes(gen.perMember!.match))).length;
        // 전환 생성원(총웨 속세의 화식→주술 결정 등)은 재집계 때도 전환율을 다시 곱해야 한다
        gen.amount = gen.perMember.per * Math.min(count, gen.perMember.cap) * (gen.convRate ?? 1);
      }
      total += gen.amount;
    }
    tokenPoints[flow.token] = total;
    flow.total = total;
    for (const key of [...PRODUCTION_KEYS, ...SUPPORT_KEYS, "DORM-0", "DORM-1", "DORM-2", "DORM-3"]) {
      const team = (assignments[key]?.[0] ?? []).map((id) => rosterById.get(id)).filter(Boolean) as InfraOp[];
      const cell = cellByKey.get(key);
      for (const op of team) {
        let bestRate = 0;
        let percent = true;
        for (const skill of activeSkills(op, cell?.room ?? key, cell?.product)) {
          for (const use of skill.tokenUse) {
            if (use.token !== flow.token) continue;
            const rate = use.value / use.per;
            if (use.percent && rate > bestRate) { bestRate = rate; percent = true; }
            if (!use.percent && bestRate === 0) { bestRate = rate; percent = false; }
          }
        }
        if (bestRate !== 0) flow.consumers.push({ opId: op.id, at: cell?.label ?? key, room: cell?.room ?? key, rate: bestRate, percent, gain: percent ? flow.total * bestRate : bestRate * flow.total });
      }
    }
  }
  const setUsed = SYNERGY_SETS.some((def) => def.badge && factionSets[def.key]);
  const strategy = (packageTokens.length ? `${packageTokens.join(" + ")} 패키지` : "기본 편성") + (setUsed ? " + 진영 세트" : "");
  // 조별 교대 시계 — 최종 편성 기준. 성장형 평균의 근거 주기이며 planScore·UI가 재사용한다
  const shiftHours = [0, 1].map((shift) => shiftHoursFor([...prodKeys, ...SUPPORT_KEYS].map((k) => ({
    room: cellByKey.get(k)?.room ?? k,
    ops: (assignments[k]?.[Math.min(shift, (assignments[k]?.length ?? 1) - 1)] ?? []).map((id) => rosterById.get(id)).filter(Boolean) as InfraOp[],
  }))));
  return { assignments, plants, tokenPoints, factionCounts: factionCountsPerShift, flows, crowdedOut, strategy, strategyTokens: packageTokens, strategySet: setUsed, priority, auditRounds, shiftHours };
}

// 세트 채택 비교 시 조별 가중 — A조는 풀파워 주력, B조는 회복 교대(§1). 동일 가중이면
// 약한 쉐라그 세트를 A조에 앉히고 강한 샤마르 조합을 B조로 밀어도 총점이 같아 세트가 잘못
// 채택된다(사용자 지적 2026-07). A조를 더 높게 쳐서 강조합이 A조에 남게 한다.
export const SHIFT_WEIGHT: number[] = C.SHIFT_WEIGHT;
// 소모 모드의 B조 가중 (사용자 확정 2026-07-27: "샤마르 조합이 피로도 이득 없어도 무조건 A조 —
// 희생하는 효율이 너무 높다"): A조가 주력(~32h 근무), B조는 A조 휴식(~12h)만 메우는 커버라
// 듀티 비율(≈12/32)로 가중한다. 생산 모드 0.6이면 210짜리 팀을 B에 보관하는 게 이득으로
// 계산돼(126 > 대체 54) 고효율 결집이 A조에 못 올라오던 원인. gold/exp/balance는 종전 0.6 유지.
export const ENDLESS_B_WEIGHT: number = (C as unknown as Record<string, number | undefined>).ENDLESS_B_WEIGHT ?? 0.35;

// 계획 전체 총점 (양 조 전 방, 앰비언트 오라 포함) — 세트 포함/미포함 두 안 비교용
export function planScore(plan: Plan, byId: Map<string, InfraOp>): number {
  // 플랜에 모드가 실려 있으면 그 모드로 채점 — endless 플랜은 컨디션 보너스 포함 총점이
  // 채택 기준이다. buildPlan 중간의 임시 플랜(priority 미기재)은 현재 모듈 플래그 유지.
  if (plan.priority) setPriorityMode(plan.priority);
  let total = 0;
  for (let shift = 0; shift < SHIFT_COUNT; shift += 1) {
    const shiftWeight = ENDLESS_ON && shift === 1 ? ENDLESS_B_WEIGHT : SHIFT_WEIGHT[shift] ?? 1;
    const teamAt = (key: string): InfraOp[] => {
      const shifts = plan.assignments[key] ?? [];
      return (shifts[Math.min(shift, shifts.length - 1)] ?? []).map((id) => byId.get(id)).filter(Boolean) as InfraOp[];
    };
    const points = shift === 0 ? plan.tokenPoints : {};
    const counts = plan.factionCounts[shift] ?? {};
    const present = presentIdsFor(plan, shift);
    const ambient = aurasOf(teamAt("CONTROL"), ctxFor("CONTROL", points, counts, plan.plants, present));
    // 교대 시계 — 플랜에 실린 값을 재사용하고, 없으면(구버전 저장·수기 편집) 편성에서 재계산
    const clock = plan.shiftHours?.[shift]
      ?? shiftHoursFor([...PRODUCTION_KEYS, ...SUPPORT_KEYS].map((key) => ({ room: cellByKey.get(key)!.room, ops: teamAt(key) })));
    for (const key of [...PRODUCTION_KEYS, ...SUPPORT_KEYS]) {
      const cell = cellByKey.get(key)!;
      if (PARK_KEYS.includes(key)) continue;
      // 훈련실 점수(훈련 속도 %)는 총점에서 뺀다 — 자원 생산과 단위가 다르다. 넣으면
      // "W를 무역소에서 빼 훈련실에 앉히면 총점이 오른다" 같은 교환이 생긴다. 그렇다고
      // "총점에 안 잡히니 남는 인원으로 채우면 공짜"도 아니다 — 훈련실도 시설로 세는 방이라
      // 잉여를 앉히면 카운터가 엉뚱하게 찬다 (buildPlan 훈련실 파킹 ⓒ 주석 참조).
      if (key === "TRAINING") continue;
      total += shiftWeight * teamValue(teamAt(key), cell.room, { ...ctxFor(key, points, counts, plan.plants, present, ambient), shiftHours: clock, shift });
    }
  }
  return total;
}

// 자동편성 진행 알림 — UI가 로케일 문구로 포맷해 표시한다 (엔진은 i18n 무의존).
// 콜백이 Promise를 돌려주면 기다린다 — UI가 단계별 최소 표시 시간(페이싱)을 넣을 수 있게
// (사용자 확정 2026-07-19: 안내 문구를 읽을 수 있도록 전체 3~5초). 콜백이 없으면(초기 로드·
// 검증 스크립트) 페이싱 없이 전속력으로 돈다.
export type OptimizeStep = { phase: "base" | "variant" | "final"; index?: number; total?: number; sets?: string[]; crew?: "A" | "B" };

// optimize가 고른 전략(토큰 패키지·시너지 세트)까지 함께 반환 — 육성 추천(planner-invest)이
// 후보마다 전체 재탐색을 반복하지 않고, 이 config를 재사용해 buildPlan을 1회만 돌려 빠르게
// 반사실 평가를 하도록 한다 (2026-07-21 성능: 후보당 buildPlan 15회 → 1회).
// 채택안이 실제로 쓴 **전략 전부**를 돌려준다 — 육성 추천(planner-invest)이 반사실 편성을
// 지을 때 같은 조건을 재현해야 하기 때문이다. tokenChoice·factionSets·park만 넘기던 종전엔
// seeds(캡 확장·밀려난 생성원)·excluded(사슬 전환자 제외)·capCluster를 못 재현해서, 반사실이
// 베이스라인보다 **상수만큼 낮게** 지어졌다(실계정 −1.521). 그 상수가 모든 후보의 ΔS에서
// 똑같이 빠지니, 진짜 이득이 그보다 작은 후보는 전부 음수가 되어 추천이 0건이 됐다
// (사용자 제보 2026-07-30 "추천 오퍼가 또 안 나온다").
export type OptimizeResult = {
  plan: Plan; tokenChoice: string[]; factionSets: FactionSets; park: boolean;
  /** 채택안이 쓴 시드(perMember 캡 확장 · 자리에서 밀려난 생성원) */
  seeds: { opId: string; room: string }[];
  /** 채택안이 로스터에서 뺀 오퍼 id (패키지/자기 소비 사슬 전환자 제외 변형) */
  excluded: string[];
  /** 채택안이 용량 변환 결집 후보를 켠 안인지 */
  capCluster: boolean;
  /** 채택안이 지속시간 타이브레이크를 켠 안인지 (동점 시 저소모 우선) */
  shiftTiebreak: boolean;
};
export async function optimizeConfig(fullRoster: InfraOp[], priority: ProdPriority = "gold", onStep?: (step: OptimizeStep) => void | Promise<void>, pinnedDorms: Record<string, string[]> = {}): Promise<OptimizeResult> {
  // 자동편성 제외 명단은 탐색 시작부터 뺀다 — 토큰 패키지·세트 성립 판정도 벤치 없는
  // 로스터 기준이어야 buildPlan(내부에서 같은 필터)과 결과가 어긋나지 않는다.
  const roster = autoRoster(fullRoster, pinnedDorms);
  setPriorityMode(priority); // config 탐색 전 구간(buildPlan 사이 planScore 비교 포함) 모드 고정
  setCapCluster(true);       // 앞 실행이 A/B 도중 끊겨 꺼진 채 남아 있을 수 있다 — 탐색은 항상 켠 상태로
  setShiftTiebreak(true);    // 위와 같은 이유 (지속시간 타이브레이크 A/B)
  // 진행 콜백(페이싱 포함) 후 매크로태스크 양보 — 브라우저가 안내 문구를 리페인트할 틈을 준다
  const tick = async (step: OptimizeStep) => {
    if (!onStep) return;
    await onStep(step);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  // 메시지 없이 메인 스레드만 양보 — buildPlan 여러 번을 한 태스크로 돌리면 계산 중
  // 다른 클릭이 수백 ms 블로킹된다 (INP, 2026-07-21). UI 없는 실행(검증 하네스)은 무양보.
  const breathe = async () => { if (onStep) await new Promise((resolve) => setTimeout(resolve, 0)); };
  // every token family (속세의 화식, 감지 정보 계열, 주술 결정, …) is always
  // assembled into A조 — B조 is the recovery crew that steps in when A조's
  // morale runs out
  const allTokens = new Set<string>();
  for (const op of roster) for (const skill of op.skills) for (const use of skill.tokenUse) if (use.percent) allTokens.add(use.token);
  // closed single-team systems (정보 저장 = 레인보우 팀 전용) stay out of the
  // base-wide packages — they'd hijack control/meeting slots from the mains
  const open = Array.from(allTokens).filter((token) => {
    const participants = roster.filter((op) => op.skills.some((skill) => skill.tokenGen.some((g) => g.token === token) || skill.tokenUse.some((u) => u.token === token)));
    const factions = new Set(participants.map((op) => op.faction));
    if (participants.length < 2 || factions.size > 1) return true;
    // closed single-team systems stay only if their generators live in the
    // dorm (센시 마물 요리) — control-seat generators (Ash 정보 저장) hijack
    const genRooms = new Set(participants.flatMap((op) => op.skills.filter((skill) => skill.tokenGen.some((g) => g.token === token)).map((skill) => skill.room)));
    return genRooms.size > 0 && Array.from(genRooms).every((room) => room === "DORMITORY");
  });
  await tick({ phase: "base" });
  const byId = new Map(roster.map((op) => [op.id, op]));
  // 미니 토큰 패키지(참가자 ≤4 — 아이룰루 같은 콜라보 3~4인 세트)는 세트와 같은 규칙으로
  // **planScore 비교해 이득일 때만** 포함한다 (사용자 제보 2026-07-21: 아이룰루 패키지가
  // 테라 대륙 조사단을 무역소에 시드해 프로바이조 완성형(우요우+에벤홀츠+프로바이조)을
  // 밀어내고 제어센터 2석까지 차지 — 총점 −68인데도 무조건 포함되던 문제). 다진영 콜라보라
  // 폐쇄 팀 규칙(단일 진영)을 비켜가는 케이스다. 본편 대형 패키지(화식 등 5인 이상)는
  // 항상 이득이라 종전대로 무조건 포함. 미니 조합은 멱집합 비교(≤3개 → ≤8안).
  const isMini = (token: string) =>
    roster.filter((op) => op.skills.some((skill) => skill.tokenGen.some((g) => g.token === token) || skill.tokenUse.some((u) => u.token === token))).length <= 4;
  const minis = open.filter(isMini).slice(0, 3);
  const coreTokens = open.filter((token) => !minis.includes(token));
  let tokenChoice = open;
  let base = buildPlan(open, roster, {}, priority, [], false, false, pinnedDorms);
  if (minis.length) {
    let bestTokScore = planScore(base, byId);
    for (let mask = 0; mask < (1 << minis.length) - 1; mask += 1) { // 마지막 mask(전부 포함) = base
      await breathe();
      const subset = coreTokens.concat(minis.filter((_, index) => mask & (1 << index)));
      const candidate = buildPlan(subset, roster, {}, priority, [], false, false, pinnedDorms);
      const score = planScore(candidate, byId);
      if (score > bestTokScore) { base = candidate; bestTokScore = score; tokenChoice = subset; }
    }
  }
  // ── 장기 지속: 패키지 전환자 개인 제외 변형 (사용자 제보 2026-07-27: "위셔델·이네스는
  // 있는데 외드레르가 없다" 추적 중 검출) — 전환자(에벤홀츠)는 패키지 예약 보호로 감사가
  // 못 빼는데, 소모 가중 planScore에선 사슬 가치가 저소모 팀(파이어휘슬 -0.1)을 밀어낸
  // 손해보다 작을 수 있다 (실측 −7.5). 토큰을 통째로 빼면 자가 생성자(로즈몬티스) 가치까지
  // 죽으므로, **전환자 한 명만 로스터에서 뺀** 재편성을 총점 비교로 판정한다. 채택되면 그
  // 오퍼는 이 플랜에서 휴식 — 이후 세트·마무리 재편성도 같은 제외 로스터로 돈다.
  // 소모 모드 공통(장기 지속·무한동력) — gold/exp/balance는 이 블록을 안 타 기존 편성 불변.
  let effRoster = roster;
  if (ENDLESS_ON && tokenChoice.length) {
    let curScore = planScore(base, byId);
    const converterIds = [...new Set(base.flows.flatMap((flow) => flow.converters.map((c) => c.opId)))].slice(0, 3);
    for (const cid of converterIds) {
      await breathe();
      const sub = effRoster.filter((op) => op.id !== cid);
      const candidate = buildPlan(tokenChoice, sub, {}, priority, [], false, false, pinnedDorms);
      const score = planScore(candidate, byId);
      if (score > curScore) { base = candidate; curScore = score; effRoster = sub; }
    }
  }
  // 세트 후보 — 쉐라그(게이트 오라, A조 무역소)·피누스(생산품별 진영 오라, B조 작전기록방)·
  // 품질 조합(오버라이드+수익+품질, A조 무역소) 보유 시 **가능한 모든 조합(멱집합)**의
  // 후보안을 만들어 기지 총점이 가장 높은 안을 채택한다. 세트를 한 플래그로 묶으면 한
  // 세트의 이득에 다른 세트가 무임승차하는 얽힘이 생기고(2026-07-19 검출), 조합을 빼먹으면
  // 두 세트가 함께일 때만 이기는 안을 놓친다 — 계산이 수 초 걸려도 전수 비교가 우선
  // (사용자 확정 2026-07-19). 귀금속 감산 등 세트의 비용도 planScore에 그대로 반영되며,
  // 동률이면 세트 없는 안 유지(쉐라그 "이득일 때만" 규칙).
  const flags = SYNERGY_SETS.filter((def) => synergySetAvailable(def, effRoster)).map((def) => def.key);
  const variants: FactionSets[] = [];
  for (let mask = 1; mask < (1 << flags.length); mask += 1) {
    const sets: FactionSets = {};
    flags.forEach((flag, index) => { if (mask & (1 << index)) sets[flag] = true; });
    variants.push(sets);
  }
  // 조합 폭발 가드 — 카탈로그가 5종 이상이면 후보 상한 15안 (2^4-1). 넘게 등록할 일이
  // 생기면 세트 우선순위 필드를 도입할 것 (지금은 3종 = 최대 7안)
  if (variants.length > 15) variants.length = 15;
  // 채택 config에 최종 ⑤(우선 생산 집중)를 입혀 반환 — 탐색은 ⑤-무관이라 선택이 원래대로 유지되고,
  // 여기서만 planScore 단조 개선(무승부 이상)을 얹는다. 밸런스는 ⑤가 no-op이라 그대로.
  const concentrates = splitPriority(priority).prod !== "balance"; // 생산 축 기준 — 장기 지속과 직교
  const withConcentration = (tokens: string[], sets: FactionSets, seeds: { opId: string; room: string }[], park = false) =>
    buildPlan(tokens, effRoster, sets, priority, seeds, concentrates, park, pinnedDorms);
  // 숙소 파킹 A/B — '짝이 기지 어디든 있으면 +N%'(언더플로우←울피아누스 등)를 켜려고 노는 짝을
  // 빈 숙소에 주차한 안을 따로 만들고, **planScore가 실제로 오를 때만** 채택한다. 로스터가 두꺼우면
  // 대체 후보가 많아 파킹이 부른 재편성이 르무엔+엑시아 같은 기존 조합을 깨 손해일 수도 있다
  // (404명 박스 −3.8) — 그래서 규칙이 아니라 후보안이다. 켤 짝이 없으면 아예 안 돌린다.
  const finishOnce = (tokens: string[], sets: FactionSets, seeds: { opId: string; room: string }[]): OptimizeResult => {
    // effRoster는 위 제외 변형들이 줄여 놓은 로스터다 — 그 명단을 결과에 함께 실어야
    // 육성 추천의 반사실이 같은 조건으로 지어진다 (OptimizeResult 주석 참고).
    const strategy = {
      tokenChoice: tokens, factionSets: sets, seeds,
      excluded: roster.filter((op) => !effRoster.includes(op)).map((op) => op.id),
      capCluster: CAP_CLUSTER_ON,
      shiftTiebreak: SHIFT_TIEBREAK_ON,
    };
    const plain = withConcentration(tokens, sets, seeds);
    const pairIds = new Set<string>();
    for (const op of roster) for (const skill of op.skills) {
      if (skill.basePartnerBonus) for (const pid of skill.basePartners ?? []) if (byId.has(pid)) pairIds.add(pid);
    }
    const idle = [...pairIds].some((pid) => !presentIdsFor(plain, 0).has(pid) && !presentIdsFor(plain, 1).has(pid));
    if (!idle) return { plan: plain, ...strategy, park: false };
    const parkedPlan = withConcentration(tokens, sets, seeds, true);
    return planScore(parkedPlan, byId) > planScore(plain, byId) + 1e-6
      ? { plan: parkedPlan, ...strategy, park: true }
      : { plan: plain, ...strategy, park: false };
  };
  // 용량 변환 결집 A/B (2026-07-30) — bestTeam의 결집 후보가 실제로 채택된 플랜에 한해, 끈 안을
  // 한 번 더 지어 총점을 맞대 본다. 방 하나가 오르는 건 확실한데(B조 제조소 92 → 107) 그 방이
  // 데려간 오퍼 때문에 옆방 계열 결집이 깨져 총점이 내려가는 로스터가 있다(실측: 순금 +3.7 ·
  // 밸런스 +2.0인데 작전기록 −1.6). 미니 토큰 조합·숙소 파킹과 같은 관례 — 후보는 L0이 만들고
  // 채택은 planScore가 한다. 결집이 안 걸린 플랜(변환기 미보유 로스터)은 A/B를 아예 안 돈다.
  const finishCap = (tokens: string[], sets: FactionSets, seeds: { opId: string; room: string }[]): OptimizeResult => {
    setCapCluster(true);
    capClusterUsed = false;
    const on = finishOnce(tokens, sets, seeds);
    if (!capClusterUsed) return on;
    setCapCluster(false);
    const off = finishOnce(tokens, sets, seeds);
    setCapCluster(true);
    return planScore(off.plan, byId) > planScore(on.plan, byId) + 1e-6 ? off : on;
  };
  // 지속시간 타이브레이크 A/B (2026-07-31) — "효율이 동급일 경우 A조에 지속시간 긴 놈"은
  // **방 점수가 같을 때**의 규칙이다. 그런데 같은 점수라도 데려가는 오퍼가 달라지면 옆방이
  // 손해를 볼 수 있어(실측 full/gold −1.6 · no6/balance −1.2, 반대로 evenSeq/balance +4.8),
  // 총점이 내려가는 로스터에선 종전 순서를 쓴다 — 총점이 갈리면 효율이 이긴다.
  // 종전(성급) 순서와 실제로 어긋난 플랜만 A/B를 돈다.
  const finish = (tokens: string[], sets: FactionSets, seeds: { opId: string; room: string }[]): OptimizeResult => {
    setShiftTiebreak(true);
    shiftTiebreakUsed = false;
    const on = finishCap(tokens, sets, seeds);
    if (!shiftTiebreakUsed) return on;
    setShiftTiebreak(false);
    const off = finishCap(tokens, sets, seeds);
    setShiftTiebreak(true);
    return planScore(off.plan, byId) > planScore(on.plan, byId) + 1e-6 ? off : on;
  };
  if (!variants.length) return finish(tokenChoice, {}, []);
  let best = base;
  let bestScore = planScore(base, byId);
  let bestSets: FactionSets = {};
  let bestSeeds: { opId: string; room: string }[] = [];
  for (let i = 0; i < variants.length; i += 1) {
    await tick({ phase: "variant", index: i + 1, total: variants.length, sets: Object.keys(variants[i]) });
    const plan = buildPlan(tokenChoice, effRoster, variants[i], priority, [], false, false, pinnedDorms);
    const score = planScore(plan, byId);
    if (score > bestScore) { best = plan; bestScore = score; bestSets = variants[i]; bestSeeds = []; }
  }
  // ── perMember 캡 확장 변형 (사용자 통찰 2026-07-24: "왕을 앉히면 슈가 풀린다") ────────
  // 채택안의 perMember 카운터(총웨 '쉐이 1명당 +5, 최대 5명')가 **정확히 캡**이면, 카운터
  // 진영의 미배치 오라 보유자(왕)를 그 오라 방에 시드한 변형을 추가 평가한다. 자리 하나를
  // 쓰는 대신 캡 초과로 잉여 소비자(슈)의 예약이 풀려 방 업그레이드가 연쇄된다 — 국소 감사
  // (자리 대 자리 비교)는 이 교차방 사슬을 못 보므로, 미니 토큰 조합과 같은 관례로 후보는
  // L0이 만들고 채택은 planScore가 판정한다. 이미 캡 초과면 해제 규칙이 알아서 처리하므로 제외.
  {
    const aPlaced = new Set<string>();
    for (const key of [...PRODUCTION_KEYS, ...SUPPORT_KEYS]) for (const id of best.assignments[key]?.[0] ?? []) aPlaced.add(id);
    const expansions = new Map<string, { opId: string; room: string }>();
    for (const flow of best.flows) for (const gen of flow.generators) {
      const pm = gen.perMember;
      if (!pm) continue;
      const members = [...aPlaced].map((id) => byId.get(id))
        .filter((op): op is InfraOp => Boolean(op && factionsOf(op).some((f) => f.includes(pm.match))));
      if (members.length !== pm.cap) continue;
      for (const op of effRoster) {
        if (aPlaced.has(op.id) || expansions.has(op.id)) continue;
        if (!factionsOf(op).some((f) => f.includes(pm.match))) continue;
        const skill = op.skills.find((sk) => sk.kind in AURA_WEIGHT); // 오라 자리값 있는 방으로만
        if (skill) expansions.set(op.id, { opId: op.id, room: skill.room });
      }
    }
    for (const ex of [...expansions.values()].slice(0, 2)) {
      await breathe();
      const plan = buildPlan(tokenChoice, effRoster, bestSets, priority, [ex], false, false, pinnedDorms);
      const score = planScore(plan, byId);
      if (score > bestScore) { best = plan; bestScore = score; bestSeeds = [ex]; }
    }
  }
  // ── 자리에서 밀려난 토큰 생성원 시드 변형 (사용자 제보 2026-07-29: "로즈몬티스가 있어도
  // 위스퍼레인 대신 사무실 레퍼런스 속도 높은 오퍼가 먼저 배치됨") ────────────────────────
  // 사무실은 1석인데 토큰 패키지는 토큰을 하나씩 순서대로 처리한다. 화식이 먼저 돌아 멀베리가
  // 자리를 먹으면, 뒤에 도는 생각의 사슬의 상류 생성원(위스퍼레인: 기억 조각 → 감지 정보 →
  // 생각의 사슬)은 앉을 자리가 없어 통째로 미배치가 되고, 방 감사도 상대가 패키지 예약이라
  // 못 건드린다. 결과적으로 사무실은 **원시 레퍼런스 속도**(페넌스 50·하루카 45)로만 줄 세워진다.
  // 누가 나은지는 방 점수가 아니라 기지 총점이 판정할 문제이므로, buildPlan이 남긴 밀려난
  // 명단(crowdedOut)을 시드로 넣은 변형을 만들어 planScore로 고른다.
  {
    const tried = new Set<string>(bestSeeds.map((s) => s.opId));
    for (const ex of (best.crowdedOut ?? []).filter((c) => !tried.has(c.opId)).slice(0, 2)) {
      await breathe();
      const plan = buildPlan(tokenChoice, effRoster, bestSets, priority, [...bestSeeds, ex], false, false, pinnedDorms);
      const score = planScore(plan, byId);
      if (score > bestScore) { best = plan; bestScore = score; bestSeeds = [...bestSeeds, ex]; }
    }
  }
  // ── 자기 소비 사슬 전환자 제외 변형 (사용자 지적 2026-07-29: "슈 지에윈 빼고 더 효율 좋은
  // 오퍼가 있을 텐데") ─────────────────────────────────────────────────────────────
  // 지에윈은 화식→주술 결정을 만들어 그 주술 결정을 **자기 혼자** 쓴다. 전환자를 패키지
  // 예약으로 지켜 주는 이유는 하류에 남이 있기 때문인데, 하류가 자기뿐이면 지켜 봐야 남는 게
  // 없고 사슬 값이 평범한 제조 요원보다 낮을 수 있다. 그렇다고 "자기 소비면 무조건 푼다"로
  // 규칙화하면 안 된다 — 로즈몬티스(감지 정보→생각의 사슬→자기 생산력)도 같은 모양인데
  // 그쪽은 순금방 정배라, 규칙으로 풀었더니 순금 −1.8에 검증 픽스처가 깨졌다. 그래서
  // **후보만 만들고 채택은 planScore**. 위 장기 지속 변형과 달리 세트·캡 확장이 확정된
  // **뒤에** 재는데, 자리 값은 그 결집이 선 다음에야 제대로 보이기 때문이다 (같은 지에윈이
  // 세트 전 −1.3, 세트 후 +2.2로 부호가 뒤집힌다). 소모 모드는 위 갈래가 이미 전 전환자를
  // 훑으므로 중복 평가하지 않는다.
  if (!ENDLESS_ON && tokenChoice.length) {
    const aPlaced = new Set<string>();
    for (const key of [...PRODUCTION_KEYS, ...SUPPORT_KEYS]) for (const id of best.assignments[key]?.[0] ?? []) aPlaced.add(id);
    const selfChain: string[] = [];
    for (const flow of best.flows) for (const conv of flow.converters) {
      if (!aPlaced.has(conv.opId) || selfChain.includes(conv.opId)) continue; // 안 앉은 전환자는 빼 봐야 그대로
      const downstream = effRoster.some((op) => op.id !== conv.opId && op.skills.some((sk) =>
        sk.tokenUse.some((use) => use.token === flow.token) || sk.convert?.from === flow.token));
      if (!downstream) selfChain.push(conv.opId);
    }
    for (const cid of selfChain.slice(0, 3)) {
      await breathe();
      const sub = effRoster.filter((op) => op.id !== cid);
      const plan = buildPlan(tokenChoice, sub, bestSets, priority, bestSeeds, false, false, pinnedDorms);
      const score = planScore(plan, byId);
      if (score > bestScore) { best = plan; bestScore = score; effRoster = sub; }
    }
  }
  // 채택안의 전수 감사 수렴 회차를 조별로 재생 — "몇 회 반복으로 최선을 확인했는지"를
  // 보여준다 (사용자 확정 2026-07-19). 페이싱(랜덤 간격)은 UI 콜백 몫.
  const rounds = best.auditRounds ?? [];
  const totalTicks = Math.min(rounds.reduce((sum, n) => sum + n, 0), 6);
  if (totalTicks > 0) {
    let tickNo = 0;
    replay: for (let crew = 0; crew < rounds.length; crew += 1) {
      for (let round = 1; round <= rounds[crew]; round += 1) {
        tickNo += 1;
        await tick({ phase: "final", index: tickNo, total: totalTicks, crew: crew === 0 ? "A" : "B" });
        if (tickNo >= totalTicks) break replay;
      }
    }
  } else {
    await tick({ phase: "final" });
  }
  return finish(tokenChoice, bestSets, bestSeeds);
}

// 얇은 래퍼 — 편성만 필요한 호출부(planner.tsx·verify-plan)는 종전대로 Plan을 받는다.
export async function optimize(roster: InfraOp[], priority: ProdPriority = "gold", onStep?: (step: OptimizeStep) => void | Promise<void>, pinnedDorms: Record<string, string[]> = {}): Promise<Plan> {
  return (await optimizeConfig(roster, priority, onStep, pinnedDorms)).plan;
}

export function slotSubstitutes(team: InfraOp[], index: number, key: string, ctx: Ctx, excluded: Set<string>, roster: InfraOp[], count = 3): { op: InfraOp; score: number }[] {
  const room = cellByKey.get(key)?.room ?? key;
  return roster
    .filter((op) => !excluded.has(op.id) && op.skills.some((skill) => skillApplies(skill, room, ctx.product)))
    .map((op) => {
      const swapped = team.map((member, i) => (i === index ? op : member));
      // 순위는 teamValue(endless면 컨디션 보너스 포함), 표시 점수는 순수 생산 %(teamScore)
      return { op, score: Math.round(teamScore(swapped, room, ctx)), value: teamValue(swapped, room, ctx) };
    })
    .sort((a, b) => b.value - a.value || a.op.rarity - b.op.rarity)
    .map(({ op, score }) => ({ op, score }))
    .slice(0, count);
}
