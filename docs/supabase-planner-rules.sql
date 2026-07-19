-- 테라 아카이브 인프라 플래너 지식 베이스 (Supabase SQL Editor에서 1회 실행)
-- 계층 설계: docs/PLANNER-RULES-DB.md · 규칙 정본: docs/INFRA-RULES.md
-- 기존 admin 패턴(docs/supabase-admin.sql)과 동일하게 쓰기는 x-admin-key 헤더로만 허용.
-- ⚠ 비밀번호를 바꿨다면 아래 'admin' 문자열을 전부 실제 비밀번호로 바꿔서 실행할 것.

-- ── 규칙 원장: 1행 = 1규칙 (kind: constant/parser/token/skill_override/fixture/doc) ──
create table if not exists public.planner_rules (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('constant', 'parser', 'token', 'skill_override', 'fixture', 'doc')),
  key text not null,
  body jsonb not null,
  status text not null default 'active' check (status in ('active', 'draft', 'retired')),
  source text,          -- 'seed:v1' | 'manual' | 'feedback:<id>'
  note text,
  seq int not null default 0,  -- 섹션 내 정렬 (tokens 순서는 infra.json 재생성 바이트를 결정)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, key)
);

alter table public.planner_rules enable row level security;

drop policy if exists "admin all planner_rules" on public.planner_rules;
create policy "admin all planner_rules"
  on public.planner_rules for all
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin')
  with check ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin');

-- ── 발행 스냅샷: 프론트/파이프라인이 읽는 것은 이것뿐 (원자적 버전 + 롤백) ──
create table if not exists public.rule_releases (
  version int primary key,
  snapshot jsonb not null,   -- active 규칙 전체를 발행 시점에 rules.json 형태로 컴파일한 것
  note text,
  published_at timestamptz not null default now()
);

alter table public.rule_releases enable row level security;

drop policy if exists "anon read releases" on public.rule_releases;
create policy "anon read releases"
  on public.rule_releases for select
  to anon
  using (true);

drop policy if exists "admin insert releases" on public.rule_releases;
create policy "admin insert releases"
  on public.rule_releases for insert
  to anon
  with check ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin');

-- 롤백 = 최신 발행 행 삭제 (이전 버전이 자동으로 최신이 된다)
drop policy if exists "admin delete releases" on public.rule_releases;
create policy "admin delete releases"
  on public.rule_releases for delete
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin');

-- ── 시드: 현재 app/data/rules.json (v1) — 이미 행이 있으면 건드리지 않는다 ──
insert into public.planner_rules (kind, key, body, seq, status, source)
select kind, key, body, seq, 'active', 'seed:v1'
from (values
  ('doc', 'root', '{"text": "인프라 플래너 지식 베이스(L2) 정본 — 유동 규칙만 담는다. 절대룰·점수 결합 방식은 app/planner-engine.ts(L0), 게임 팩트는 infra.json(L1, build-infra.py 생성). 이 파일의 상수·목록·교정·픽스처는 코드 수정 없이 편집할 수 있고, 편집 후 scripts/verify-plan.mjs로 회귀 검증한다. 유래: docs/INFRA-RULES.md의 ''사용자 확정'' 규칙들. Phase 2에서 Supabase 발행 스냅샷으로 대체될 예정 (docs/PLANNER-RULES-DB.md)."}'::jsonb, 0),
  ('doc', 'constants', '{"text": "planner-engine.ts 런타임 상수. AURA_WEIGHT=제어센터 오라 우선순위 가중(INFRA-RULES §6), SHIFT_WEIGHT=planScore 조별 가중(A조 풀파워 주력 §1), SEED_TOKEN_MIN_GAIN=토큰 기대가치 N% 이상 소비자만 시드 예약(§3), PAYOUT_*=품질/위약 수익 근사 모델(§8), CLUE_*=응접실 레어도·정예화 기본 단서속도(Terra Wiki §5), FAMILY_TIEBREAK=시너지 결집 동률 시 계열 우선 미세 보정(§1 ⓒ)"}'::jsonb, 0),
  ('constant', 'AURA_WEIGHT', '{"value": {"ctrl_mfg": 10, "ctrl_trade": 2, "ctrl_hire": 0.6, "ctrl_clue": 0.2}}'::jsonb, 1),
  ('constant', 'SHIFT_WEIGHT', '{"value": [1, 0.6]}'::jsonb, 2),
  ('constant', 'SEED_TOKEN_MIN_GAIN', '{"value": 20}'::jsonb, 3),
  ('constant', 'ROOM_BASE_RATE', '{"value": {"HIRE": 5}}'::jsonb, 4),
  ('constant', 'CLUE_RARITY_BASE', '{"value": {"6": 10, "5": 9, "4": 7, "default": 5}}'::jsonb, 5),
  ('constant', 'CLUE_ELITE_BASE', '{"value": [0, 8, 16]}'::jsonb, 6),
  ('constant', 'PLANTS_BASE', '{"value": 3}'::jsonb, 7),
  ('constant', 'PLANTS_BOOSTED', '{"value": 4}'::jsonb, 8),
  ('constant', 'PAYOUT_QUALITY_STEP', '{"value": 0.5}'::jsonb, 9),
  ('constant', 'PAYOUT_QUALITY_CAP', '{"value": 2}'::jsonb, 10),
  ('constant', 'PAYOUT_VIOLATION_CAP', '{"value": 3}'::jsonb, 11),
  ('constant', 'FAMILY_TIEBREAK', '{"value": 0.0001}'::jsonb, 12),
  ('doc', 'parser', '{"text": "build-infra.py 파스 타임 상수 — 게임 텍스트의 ''…당'' 수치를 만렙 243 기지 기준 고정값으로 환산할 때 쓰는 추정치(INFRA-RULES §8). DROP_ASSUMED=자기 컨디션 낙차 스킬의 대표 운용 낙차(토터 §2), QUALITY_*=고품질 확률 등가 %, LMD_PER_PERCENT=용문폐 수익 N → N/20% 등가, VIOLATION_EQUIV_MULT=위약 배상 N → N×10% 등가"}'::jsonb, 0),
  ('parser', 'DROP_ASSUMED', '{"value": 12}'::jsonb, 1),
  ('parser', 'DORM_SELF_MEMBERS', '{"value": 5}'::jsonb, 2),
  ('parser', 'DORM_ALL_MEMBERS', '{"value": 20}'::jsonb, 3),
  ('parser', 'DORM_LEVEL', '{"value": 5}'::jsonb, 4),
  ('parser', 'DORM_TOTAL_LEVELS', '{"value": 20}'::jsonb, 5),
  ('parser', 'MEETING_LEVELS', '{"value": 3}'::jsonb, 6),
  ('parser', 'RECRUIT_SLOTS', '{"value": 4}'::jsonb, 7),
  ('parser', 'RECRUIT_SLOTS_EXCL_INITIAL', '{"value": 2}'::jsonb, 8),
  ('parser', 'CONTROL_EXTRA_MEMBERS', '{"value": 4}'::jsonb, 9),
  ('parser', 'FACILITY_COUNTS', '{"value": {"무역소": 2, "발전소": 3, "제조소": 4}}'::jsonb, 10),
  ('parser', 'QUALITY_MINOR', '{"value": 10}'::jsonb, 11),
  ('parser', 'QUALITY_MAJOR', '{"value": 15}'::jsonb, 12),
  ('parser', 'LMD_PER_PERCENT', '{"value": 20}'::jsonb, 13),
  ('parser', 'VIOLATION_EQUIV_MULT', '{"value": 10}'::jsonb, 14),
  ('token', '속세의 화식', '{}'::jsonb, 0),
  ('token', '감지 정보', '{}'::jsonb, 1),
  ('token', '무성의 공명', '{}'::jsonb, 2),
  ('token', '생각의 사슬', '{}'::jsonb, 3),
  ('token', '정보 저장', '{}'::jsonb, 4),
  ('token', '주술 결정', '{}'::jsonb, 5),
  ('token', '마물 요리', '{}'::jsonb, 6),
  ('doc', 'skillOverrides', '{"text": "buffId → { patch: {필드 덮어쓰기}, note } — 파서가 새 문구를 오분류했을 때 정규식 패치 대신 여기에 교정 행을 추가한다. build-infra.py가 파싱 직후 적용. 파서가 정식 지원하게 되면 행을 지운다 (재생성 diff가 없으면 안전)"}'::jsonb, 0),
  ('fixture', 'A·B 동시 배치 금지 (근무 방)', '{"name": "A·B 동시 배치 금지 (근무 방)", "type": "invariant", "check": "noDualShift", "note": "INFRA-RULES §1 절대룰 — 숙소·가공소만 예외"}'::jsonb, 0),
  ('fixture', '훈련실은 비워 둔다', '{"name": "훈련실은 비워 둔다", "type": "invariant", "check": "trainingEmpty", "note": "INFRA-RULES §1 — 특화 훈련용"}'::jsonb, 1),
  ('fixture', '가공소 니엔 고정', '{"name": "가공소 니엔 고정", "type": "planContains", "roster": "full", "priority": "gold", "shift": 0, "roomKey": "WORKSHOP", "allOf": ["char_2014_nian"], "note": "INFRA-RULES §1 정배 — 쉐이 패밀리 피닝"}'::jsonb, 2),
  ('fixture', '제어센터 쉐이 3인 (링·시·총웨)', '{"name": "제어센터 쉐이 3인 (링·시·총웨)", "type": "planContains", "roster": "full", "priority": "gold", "shift": 0, "roomKey": "CONTROL", "allOf": ["char_2023_ling", "char_2015_dusk", "char_2024_chyue"], "note": "INFRA-RULES §6 — 속세의 화식 생성 코어"}'::jsonb, 3),
  ('fixture', '샤마르+테킬라 같은 무역소 (A조)', '{"name": "샤마르+테킬라 같은 무역소 (A조)", "type": "planContains", "roster": "full", "priority": "gold", "shift": 0, "roomType": "TRADING", "allOf": ["char_254_vodfox", "char_486_takila"], "note": "INFRA-RULES §4 품질 조합 정배"}'::jsonb, 4),
  ('fixture', '위디+유넥티스+퓨어스트림 순금방 (A조)', '{"name": "위디+유넥티스+퓨어스트림 순금방 (A조)", "type": "planContains", "roster": "full", "priority": "gold", "shift": 0, "roomType": "MANUFACTURE", "allOf": ["char_400_weedy", "char_416_zumama", "char_385_finlpp"], "note": "INFRA-RULES §4 자동화 세트 — 시설 기반 생산력만 생존"}'::jsonb, 5),
  ('fixture', '자동화 방: 시설기반(퓨어스트림) > 제로아웃되는 일반 output(그라벨)', '{"name": "자동화 방: 시설기반(퓨어스트림) > 제로아웃되는 일반 output(그라벨)", "type": "teamCompare", "room": "MANUFACTURE", "product": "gold", "better": ["char_400_weedy", "char_416_zumama", "char_385_finlpp"], "worse": ["char_400_weedy", "char_416_zumama", "char_237_gravel"], "note": "INFRA-RULES §4 제로아웃 오퍼 추천 원칙"}'::jsonb, 6),
  ('fixture', '샤마르 방: 품질 요원(디아만테) > 효율 요원(아르케토)', '{"name": "샤마르 방: 품질 요원(디아만테) > 효율 요원(아르케토)", "type": "teamCompare", "room": "TRADING", "better": ["char_254_vodfox", "char_486_takila", "char_499_kaitou"], "worse": ["char_254_vodfox", "char_486_takila", "char_332_archet"], "note": "INFRA-RULES §4 — override가 효율을 0으로, 품질 2장이 payout 배율을 올린다"}'::jsonb, 7)
) as seed(kind, key, body, seq)
where not exists (
  select 1 from public.planner_rules p where p.kind = seed.kind and p.key = seed.key
);

-- ── v1 발행: 시드 시점의 rules.json 전문을 스냅샷으로 ──
insert into public.rule_releases (version, snapshot, note)
values (1, '{"_doc": "인프라 플래너 지식 베이스(L2) 정본 — 유동 규칙만 담는다. 절대룰·점수 결합 방식은 app/planner-engine.ts(L0), 게임 팩트는 infra.json(L1, build-infra.py 생성). 이 파일의 상수·목록·교정·픽스처는 코드 수정 없이 편집할 수 있고, 편집 후 scripts/verify-plan.mjs로 회귀 검증한다. 유래: docs/INFRA-RULES.md의 ''사용자 확정'' 규칙들. Phase 2에서 Supabase 발행 스냅샷으로 대체될 예정 (docs/PLANNER-RULES-DB.md).", "version": 1, "constants": {"_doc": "planner-engine.ts 런타임 상수. AURA_WEIGHT=제어센터 오라 우선순위 가중(INFRA-RULES §6), SHIFT_WEIGHT=planScore 조별 가중(A조 풀파워 주력 §1), SEED_TOKEN_MIN_GAIN=토큰 기대가치 N% 이상 소비자만 시드 예약(§3), PAYOUT_*=품질/위약 수익 근사 모델(§8), CLUE_*=응접실 레어도·정예화 기본 단서속도(Terra Wiki §5), FAMILY_TIEBREAK=시너지 결집 동률 시 계열 우선 미세 보정(§1 ⓒ)", "AURA_WEIGHT": {"ctrl_mfg": 10, "ctrl_trade": 2, "ctrl_hire": 0.6, "ctrl_clue": 0.2}, "SHIFT_WEIGHT": [1, 0.6], "SEED_TOKEN_MIN_GAIN": 20, "ROOM_BASE_RATE": {"HIRE": 5}, "CLUE_RARITY_BASE": {"6": 10, "5": 9, "4": 7, "default": 5}, "CLUE_ELITE_BASE": [0, 8, 16], "PLANTS_BASE": 3, "PLANTS_BOOSTED": 4, "PAYOUT_QUALITY_STEP": 0.5, "PAYOUT_QUALITY_CAP": 2, "PAYOUT_VIOLATION_CAP": 3, "FAMILY_TIEBREAK": 0.0001}, "parser": {"_doc": "build-infra.py 파스 타임 상수 — 게임 텍스트의 ''…당'' 수치를 만렙 243 기지 기준 고정값으로 환산할 때 쓰는 추정치(INFRA-RULES §8). DROP_ASSUMED=자기 컨디션 낙차 스킬의 대표 운용 낙차(토터 §2), QUALITY_*=고품질 확률 등가 %, LMD_PER_PERCENT=용문폐 수익 N → N/20% 등가, VIOLATION_EQUIV_MULT=위약 배상 N → N×10% 등가", "DROP_ASSUMED": 12, "DORM_SELF_MEMBERS": 5, "DORM_ALL_MEMBERS": 20, "DORM_LEVEL": 5, "DORM_TOTAL_LEVELS": 20, "MEETING_LEVELS": 3, "RECRUIT_SLOTS": 4, "RECRUIT_SLOTS_EXCL_INITIAL": 2, "CONTROL_EXTRA_MEMBERS": 4, "FACILITY_COUNTS": {"무역소": 2, "발전소": 3, "제조소": 4}, "QUALITY_MINOR": 10, "QUALITY_MAJOR": 15, "LMD_PER_PERCENT": 20, "VIOLATION_EQUIV_MULT": 10}, "tokens": ["속세의 화식", "감지 정보", "무성의 공명", "생각의 사슬", "정보 저장", "주술 결정", "마물 요리"], "skillOverrides": {"_doc": "buffId → { patch: {필드 덮어쓰기}, note } — 파서가 새 문구를 오분류했을 때 정규식 패치 대신 여기에 교정 행을 추가한다. build-infra.py가 파싱 직후 적용. 파서가 정식 지원하게 되면 행을 지운다 (재생성 diff가 없으면 안전)"}, "fixtures": [{"name": "A·B 동시 배치 금지 (근무 방)", "type": "invariant", "check": "noDualShift", "note": "INFRA-RULES §1 절대룰 — 숙소·가공소만 예외"}, {"name": "훈련실은 비워 둔다", "type": "invariant", "check": "trainingEmpty", "note": "INFRA-RULES §1 — 특화 훈련용"}, {"name": "가공소 니엔 고정", "type": "planContains", "roster": "full", "priority": "gold", "shift": 0, "roomKey": "WORKSHOP", "allOf": ["char_2014_nian"], "note": "INFRA-RULES §1 정배 — 쉐이 패밀리 피닝"}, {"name": "제어센터 쉐이 3인 (링·시·총웨)", "type": "planContains", "roster": "full", "priority": "gold", "shift": 0, "roomKey": "CONTROL", "allOf": ["char_2023_ling", "char_2015_dusk", "char_2024_chyue"], "note": "INFRA-RULES §6 — 속세의 화식 생성 코어"}, {"name": "샤마르+테킬라 같은 무역소 (A조)", "type": "planContains", "roster": "full", "priority": "gold", "shift": 0, "roomType": "TRADING", "allOf": ["char_254_vodfox", "char_486_takila"], "note": "INFRA-RULES §4 품질 조합 정배"}, {"name": "위디+유넥티스+퓨어스트림 순금방 (A조)", "type": "planContains", "roster": "full", "priority": "gold", "shift": 0, "roomType": "MANUFACTURE", "allOf": ["char_400_weedy", "char_416_zumama", "char_385_finlpp"], "note": "INFRA-RULES §4 자동화 세트 — 시설 기반 생산력만 생존"}, {"name": "자동화 방: 시설기반(퓨어스트림) > 제로아웃되는 일반 output(그라벨)", "type": "teamCompare", "room": "MANUFACTURE", "product": "gold", "better": ["char_400_weedy", "char_416_zumama", "char_385_finlpp"], "worse": ["char_400_weedy", "char_416_zumama", "char_237_gravel"], "note": "INFRA-RULES §4 제로아웃 오퍼 추천 원칙"}, {"name": "샤마르 방: 품질 요원(디아만테) > 효율 요원(아르케토)", "type": "teamCompare", "room": "TRADING", "better": ["char_254_vodfox", "char_486_takila", "char_499_kaitou"], "worse": ["char_254_vodfox", "char_486_takila", "char_332_archet"], "note": "INFRA-RULES §4 — override가 효율을 0으로, 품질 2장이 payout 배율을 올린다"}]}'::jsonb, '시드 — Phase 1 rules.json 원본')
on conflict (version) do nothing;
