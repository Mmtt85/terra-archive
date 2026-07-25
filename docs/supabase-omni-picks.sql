-- 유니버셜 서치 선택 학습 (Supabase SQL Editor에서 실행 — 재실행 안전, v1 설치 위에도 올라감)
--
-- 목적: 되묻기("이 중에 무엇인가요?")에서 **사이트를 쓰는 사람들 전체가** 무엇을 골랐는지
-- 모아 같은 검색어의 1순위를 정한다. 개인 기기 학습(localStorage)은 그 사람에게만 즉시
-- 반영되는 보조 신호이고, 전역 순위는 이 표가 정본이다 (사용자 확정 2026-07-25:
-- "자기 자신한테만 적용되면 안돼 — 모든 사람 데이터를 수집해서 가중치를").
--
-- 설계 요점
--  1. 클릭 1건 = 1행(원장). 집계는 뷰로만 공개하고 개별 행·시각은 비공개(RLS).
--  2. **표는 사람 단위로 센다** — session(브라우저 localStorage의 익명 랜덤 id)으로 중복
--     제거해 한 사람이 100번 눌러도 1표다. 개인 식별 정보가 아니며 검색어와만 묶인다.
--  3. 뷰는 **서로 다른 2명 이상**이 고른 조합만 노출한다 — 한 사람의 클릭으로 전역 순위가
--     흔들리지 않게. (본인 기기에서는 로컬 학습으로 이미 1순위가 된다.)
--  4. 은어 힌트("쉐이록라"의 록라 = 통합전략)도 같은 표에 쌓인다 — q가 '~토큰', uid가
--     'hint:<종류>'인 행. 그래서 스키마·뷰를 따로 두지 않는다.
--  5. rank/candidates/fuzzy/hinted는 품질 분석용 — 1순위가 정말 맞았는지(사람들이 몇 번째
--     후보를 골랐는지), 근사·힌트 매칭이 실제로 쓸모 있는지 나중에 확인할 수 있다.

create table if not exists public.omni_pick (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- 정규화된 검색어(소문자·공백제거). '~록라'처럼 앞에 ~가 붙으면 은어 힌트 행이다.
  q text not null check (char_length(q) between 1 and 41),
  -- 고른 항목 id: op:char_xxx / story:act44side / mat:30012 / topic:rogue_5 /
  -- rg:<토픽>:<섹션>:<id> / tag:쾌속부활 / tab:planner / hint:<종류>
  uid text not null check (char_length(uid) between 1 and 120),
  kind text check (char_length(kind) <= 20),
  name text check (char_length(name) <= 80),
  locale text check (char_length(locale) <= 5),
  session text check (char_length(session) <= 64),   -- 익명 랜덤 id (표 중복 제거용)
  rank int,          -- 클릭한 후보의 목록 순위 (0 = 맨 위)
  candidates int,    -- 그때 보여준 후보 수
  fuzzy boolean,     -- 오탈자 근사로 걸린 후보였는지
  hinted boolean     -- 분류 힌트(록라 등)로 걸린 후보였는지
);

-- v1(초판, session/rank/candidates/fuzzy/hinted 없음)에서 올리는 경우
alter table public.omni_pick add column if not exists session text;
alter table public.omni_pick add column if not exists rank int;
alter table public.omni_pick add column if not exists candidates int;
alter table public.omni_pick add column if not exists fuzzy boolean;
alter table public.omni_pick add column if not exists hinted boolean;

create index if not exists omni_pick_q_idx on public.omni_pick (q);
create index if not exists omni_pick_created_idx on public.omni_pick (created_at desc);

alter table public.omni_pick enable row level security;

drop policy if exists "anon insert omni pick" on public.omni_pick;
create policy "anon insert omni pick"
  on public.omni_pick for insert
  to anon
  with check (true);

-- ── 공개 집계 ────────────────────────────────────────────────────────────────
-- (검색어, 항목)별 표수. voters = 서로 다른 사람 수(= 가중치의 정본), picks = 총 클릭 수.
-- 2명 이상 합의한 조합만 노출한다. 뷰는 소유자 권한으로 돌아 RLS를 우회하므로
-- 개별 행이 아니라 집계만 나간다.
create or replace view public.omni_pick_counts as
  select q, uid,
         count(*)::int as picks,
         count(distinct coalesce(session, id::text))::int as voters
  from public.omni_pick
  group by q, uid
  having count(distinct coalesce(session, id::text)) >= 2;

grant select on public.omni_pick_counts to anon;

-- 인기 검색어 (은어 힌트 행 제외) — 지금은 사이트가 읽지 않지만, '인기 검색어' 기능이나
-- 검색 품질 점검(어떤 검색어가 후보 여러 개를 내는지)에 바로 쓸 수 있다.
create or replace view public.omni_query_top as
  select q,
         count(*)::int as picks,
         count(distinct coalesce(session, id::text))::int as voters,
         round(avg(rank)::numeric, 2) as avg_rank,       -- 0에 가까울수록 1순위가 잘 맞았다는 뜻
         round(avg(candidates)::numeric, 2) as avg_candidates,
         max(created_at) as last_at
  from public.omni_pick
  where q not like '~%'
  group by q;

grant select on public.omni_query_top to anon;

-- ── 관리자 (feedback과 동일한 x-admin-key 패턴, 비번 동기화 유지) ─────────────
drop policy if exists "admin read omni pick" on public.omni_pick;
create policy "admin read omni pick"
  on public.omni_pick for select
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin');

drop policy if exists "admin delete omni pick" on public.omni_pick;
create policy "admin delete omni pick"
  on public.omni_pick for delete
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin');
