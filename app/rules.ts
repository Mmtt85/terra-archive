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
};

export type SkillOverride = { patch: Record<string, unknown>; note?: string };

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
  fixtures: Fixture[];                           // scripts/verify-plan.mjs 전용
};

export const RULES = rulesData as unknown as PlannerRules;
export const C = RULES.constants;
