// 플래너 지식 베이스: planner_rules 행 목록 → rules.json 스냅샷 컴파일 + 발행 전 검증.
// /admin '플래너 규칙' 탭의 발행 버튼이 쓴다. 스냅샷 스키마는 app/rules.ts(PlannerRules)와
// 동일해야 하고, 베이크(scripts/build-rules.py)·검증(scripts/verify-plan.mjs)이 그대로 소비한다.
import type { PlannerRules } from "./rules";

export type RuleRow = {
  id?: string;
  kind: "constant" | "parser" | "token" | "skill_override" | "synergy_set" | "fixture" | "doc";
  key: string;
  body: Record<string, unknown>;
  status: "active" | "draft" | "retired";
  source?: string | null;
  note?: string | null;
  seq: number;
  updated_at?: string;
};

export const RULE_KINDS: RuleRow["kind"][] = ["constant", "parser", "token", "skill_override", "synergy_set", "fixture", "doc"];

const bySeq = (a: RuleRow, b: RuleRow) => a.seq - b.seq || a.key.localeCompare(b.key, "ko");

// active 행만 스냅샷에 들어간다 — draft는 발행 보류, retired는 이력용
export function compileSnapshot(rows: RuleRow[], version: number): PlannerRules {
  const active = rows.filter((row) => row.status === "active");
  const pick = (kind: RuleRow["kind"]) => active.filter((row) => row.kind === kind).sort(bySeq);
  const doc = (key: string) => (active.find((row) => row.kind === "doc" && row.key === key)?.body.text as string) ?? "";
  const section = (kind: "constant" | "parser", docKey: string) => {
    const out: Record<string, unknown> = { _doc: doc(docKey) };
    for (const row of pick(kind)) out[row.key] = row.body.value;
    return out;
  };
  const overrides: Record<string, unknown> = { _doc: doc("skillOverrides") };
  for (const row of pick("skill_override")) overrides[row.key] = row.body;
  return {
    _doc: doc("root"),
    version,
    constants: section("constant", "constants"),
    parser: section("parser", "parser"),
    tokens: pick("token").map((row) => row.key),
    skillOverrides: overrides,
    synergySets: pick("synergy_set").map((row) => row.body),
    fixtures: pick("fixture").map((row) => row.body),
  } as unknown as PlannerRules;
}

// 발행 전 최소 스키마 검증 — 통과해도 정식 게이트는 베이크 후 verify-plan.mjs다.
// (엔진 상수 주입이 안 되는 브라우저에선 픽스처를 실행해도 초안 상수가 반영되지 않는다)
const CONSTANT_KEYS = ["AURA_WEIGHT", "SHIFT_WEIGHT", "SEED_TOKEN_MIN_GAIN", "ROOM_BASE_RATE",
  "CLUE_RARITY_BASE", "CLUE_ELITE_BASE", "PLANTS_BASE", "PLANTS_BOOSTED",
  "PAYOUT_QUALITY_STEP", "PAYOUT_QUALITY_CAP", "PAYOUT_VIOLATION_CAP", "FAMILY_TIEBREAK"];
const PARSER_KEYS = ["DROP_ASSUMED", "DORM_SELF_MEMBERS", "DORM_ALL_MEMBERS", "DORM_LEVEL",
  "DORM_TOTAL_LEVELS", "MEETING_LEVELS", "RECRUIT_SLOTS", "RECRUIT_SLOTS_EXCL_INITIAL",
  "CONTROL_EXTRA_MEMBERS", "FACILITY_COUNTS", "QUALITY_MINOR", "QUALITY_MAJOR",
  "LMD_PER_PERCENT", "VIOLATION_EQUIV_MULT"];
const FIXTURE_TYPES = ["invariant", "planContains", "teamCompare"];

export function validateRules(rows: RuleRow[]): string[] {
  const errors: string[] = [];
  const active = rows.filter((row) => row.status === "active");
  const seen = new Set<string>();
  for (const row of active) {
    const tag = `${row.kind}/${row.key}`;
    if (seen.has(tag)) errors.push(`중복 키: ${tag}`);
    seen.add(tag);
    if (row.kind === "constant" || row.kind === "parser") {
      if (!("value" in row.body)) errors.push(`${tag}: body에 value가 없습니다`);
    }
    if (row.kind === "skill_override" && (typeof row.body.patch !== "object" || row.body.patch == null)) {
      errors.push(`${tag}: body.patch(덮어쓸 필드 객체)가 없습니다`);
    }
    if (row.kind === "fixture") {
      if (row.body.name !== row.key) errors.push(`${tag}: body.name과 key가 다릅니다`);
      if (!FIXTURE_TYPES.includes(row.body.type as string)) errors.push(`${tag}: type은 ${FIXTURE_TYPES.join("/")} 중 하나여야 합니다`);
    }
    if (row.kind === "synergy_set") {
      if (row.body.key !== row.key) errors.push(`${tag}: body.key와 key가 다릅니다`);
      if (!row.body.name) errors.push(`${tag}: name(표시명)이 없습니다`);
      const bodies = row.body.bodies as { room?: string; from?: string; roles?: unknown[] } | undefined;
      if (!bodies?.room || !["anchorFaction", "roles"].includes(bodies.from ?? "")) errors.push(`${tag}: bodies.room/from이 올바르지 않습니다`);
      if (bodies?.from === "roles" && !(Array.isArray(bodies.roles) && bodies.roles.length)) errors.push(`${tag}: from=roles면 roles 배열이 필요합니다`);
      if (bodies?.from === "anchorFaction" && !row.body.anchor) errors.push(`${tag}: from=anchorFaction이면 anchor가 필요합니다`);
      const cell = (row.body.target as { cell?: string } | undefined)?.cell;
      if (!["first", "firstFree", "byAnchorProduct"].includes(cell ?? "")) errors.push(`${tag}: target.cell은 first/firstFree/byAnchorProduct 중 하나여야 합니다`);
    }
  }
  // 엔진이 참조하는 상수는 전부 있어야 한다 — 빠지면 런타임 undefined 산술
  const has = (kind: string, key: string) => active.some((row) => row.kind === kind && row.key === key);
  for (const key of CONSTANT_KEYS) if (!has("constant", key)) errors.push(`필수 상수 누락: constant/${key}`);
  for (const key of PARSER_KEYS) if (!has("parser", key)) errors.push(`필수 파서 상수 누락: parser/${key}`);
  if (!active.some((row) => row.kind === "token")) errors.push("토큰 카탈로그가 비어 있습니다");
  return errors;
}
