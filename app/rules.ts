// 인프라 플래너 지식 베이스(L2) 로더 — app/data/rules.json의 타입 정의와 접근자.
// 규칙 계층: L0 절대룰·점수 모델(planner-engine.ts) / L1 게임 팩트(infra.json) /
// L2 유동 규칙(rules.json — 상수·토큰 카탈로그·파서 교정·검증 픽스처).
// L2는 점수를 직접 조작하지 않는다: 상수 튜닝·후보 생성·게이트·파싱 교정·타이브레이크만.
// (Phase 2에서 Supabase 발행 스냅샷이 이 파일을 대체 공급할 예정 — docs/PLANNER-RULES-DB.md)
import rulesData from "./data/rules.json";

export type PlannerConstants = {
  AURA_WEIGHT: Record<string, number>;   // 제어센터 오라 종류별 가중 (INFRA-RULES §6)
  SHIFT_WEIGHT: number[];                // planScore 조별 가중 — A조 풀파워 주력 (§1)
  SEED_TOKEN_MIN_GAIN: number;           // 토큰 기대가치 N% 이상 소비자만 시드 예약 (§3)
  ROOM_BASE_RATE: Record<string, number>; // 방 기본 속도 — 임계값 미만 조건 판정용 (§5)
  CLUE_RARITY_BASE: Record<string, number>; // 응접실 레어도 기본 단서속도 + default (§5)
  CLUE_ELITE_BASE: number[];             // [E0, E1, E2] 정예화 기본 단서속도 (§5)
  PLANTS_BASE: number;                   // 243 발전소 수
  PLANTS_BOOSTED: number;                // 그레이 더 라이트닝베어러 배치 시 간주 수 (§4)
  PAYOUT_QUALITY_STEP: number;           // 품질 요원 1명당 payout 배율 증가 (§8)
  PAYOUT_QUALITY_CAP: number;            // payout 배율 상한 (§8)
  PAYOUT_VIOLATION_CAP: number;          // 위약 수익 처리량 비례 상한 (§8)
  FAMILY_TIEBREAK: number;               // 시너지 결집 동률 시 계열 우선 미세 보정 (§1 ⓒ)
  OP_GROUPS: Record<string, string[]>;   // 진영이 아닌 명단형 그룹 (비비아나 '기사' 등 — PRTS 근거, §5)
};

export type SkillOverride = { patch: Record<string, unknown>; note?: string };

// 시너지 세트(팟) 정의 — L2 카탈로그. 평가기 타입(anchor.detect, bodies.from, target.cell)은
// 엔진(L0)이 알고, 인스턴스는 데이터다. 새 팟 = /admin에서 synergy_set 행 추가 + 발행.
export type SynergySetDef = {
  key: string;                 // optimize 후보 플래그 키 (예: sherag/pinus/quality)
  name: string;                // 표시명 (진행 안내·admin) — KR, i18n 사전에 같은 키로 번역 추가
  shift?: number;              // 0 = A조(기본), 1 = B조(회복 교대)
  badge?: boolean;             // 채택 시 전략 라벨에 "+ 진영 세트" 표시
  note?: string;
  anchor?: {                   // 세트를 여는 오라원 (별도 방에 앉는 오퍼 — 없으면 본체만)
    room: string;              // 앵커가 앉는 방 (CONTROL 등)
    detect: "gateFaction" | "perProduct"; // 앵커 스킬 판별 평가기 (L0)
  };
  bodies: {
    room: string;              // 본체가 앉는 방 종류
    from: "anchorFaction" | "roles"; // 본체 선발: 앵커 진영원 / kind 역할 슬롯
    roles?: string[];          // from=roles: 슬롯별 스킬 kind (override/payout/quality …)
    count?: number | "gateCount";    // from=anchorFaction: 최대 인원 (gateCount = 앵커 게이트 수)
    min?: number | "gateCount";      // 세트 성립 최소 인원 (기본: roles 수 또는 count)
    requireRoomSkill?: boolean;      // 본체가 그 방 스킬을 가져야 하는가 (쉐라그는 머릿수라 false)
  };
  target: { cell: "first" | "firstFree" | "byAnchorProduct" }; // bodies.room의 어느 칸에
};

export type Fixture = {
  name: string;
  type: "invariant" | "planContains" | "teamCompare";
  note?: string;
  // invariant
  check?: "noDualShift" | "trainingEmpty";
  // planContains
  roster?: string;
  priority?: string;
  shift?: number;
  roomKey?: string;   // 특정 방 (예: WORKSHOP, CONTROL)
  roomType?: string;  // 방 종류 중 아무 방 (예: TRADING — 두 무역소 중 한 곳에 함께)
  allOf?: string[];
  anyOf?: string[];   // 같은 방에 이 중 1명 이상 (동급 대체군 — 품질 요원 4종 등)
  // teamCompare
  room?: string;
  product?: string;
  better?: string[];
  worse?: string[];
};

export type PlannerRules = {
  version: number;
  constants: PlannerConstants;
  parser: Record<string, unknown>;               // build-infra.py 전용 — 프론트 미사용
  tokens: string[];                              // build-infra.py 전용 토큰 카탈로그
  skillOverrides: Record<string, SkillOverride>; // build-infra.py 전용 파서 교정
  synergySets?: SynergySetDef[];                 // 시너지 세트 카탈로그 (v4+, 구 스냅샷은 부재 가능)
  fixtures: Fixture[];                           // scripts/verify-plan.mjs 전용
};

export const RULES = rulesData as unknown as PlannerRules;
export const C = RULES.constants;
