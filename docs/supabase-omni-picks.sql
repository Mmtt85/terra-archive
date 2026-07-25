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
--  3. 브라우저에는 학습을 보관하지 않는다 — 가중치의 정본은 이 표 하나다. 그래서 뷰는
--     1표짜리도 그대로 노출하고(그 사람도 다음 접속에 자기 표를 돌려받아야 하니까),
--     한 표로는 순위만 오르고 **두 사람이 합의해야 되묻지 않고 확정**되게 클라이언트가 끊는다
--     (1표=27점 < 확신 문턱 30 ≤ 2표=32점).
--  4. 은어 힌트("쉐이록라"의 록라 = 통합전략)도 같은 표에 쌓인다 — q가 '~토큰', uid가
--     'hint:<종류>'인 행. 그래서 스키마·뷰를 따로 두지 않는다.
--  5. **실패한 검색 → 최종 목적지 연결도 DB에서 한다** — 브라우저는 miss(0건이었다)와
--     visit(여기 도착했다)라는 사실만 보고하고, omni_trail_counts 뷰가 같은 세션에서
--     miss 뒤 10분 안의 첫 visit을 짝짓는다. "날시"(0건) → 백과사전에서 켈시 이격 클릭이면
--     날시 = 그 오퍼. 추론이라 직접 클릭의 절반 무게(0.5표).
--  6. rank/candidates/fuzzy/hinted는 품질 분석용 — 1순위가 정말 맞았는지(사람들이 몇 번째
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
  hinted boolean,    -- 분류 힌트(록라 등)로 걸린 후보였는지
  -- 'pick'  = 검색 결과를 직접 클릭 (q = 검색어, uid = 고른 항목)
  -- 'miss'  = 그 검색어로 결과가 0건이었다 (q = 검색어, uid = '-')
  -- 'visit' = 컨텐츠에 도착했다 (q = '-', uid = 도착한 항목)
  --   → **miss 뒤 10분 안의 첫 visit**을 아래 omni_trail_counts 뷰가 짝지어
  --     "실패한 검색 → 최종 목적지" 가중치로 만든다. 짝짓기를 브라우저가 아니라 DB에서
  --     하기 때문에, 중간에 새로고침·탭 이동이 있어도 같은 세션이면 이어진다.
  source text default 'pick' check (source in ('pick', 'trail', 'miss', 'visit')),
  steps int          -- (구버전 trail 행 호환용, 지금은 안 쓴다)
);

-- v1(초판, session/rank/candidates/fuzzy/hinted 없음)에서 올리는 경우
alter table public.omni_pick add column if not exists session text;
alter table public.omni_pick add column if not exists rank int;
alter table public.omni_pick add column if not exists candidates int;
alter table public.omni_pick add column if not exists fuzzy boolean;
alter table public.omni_pick add column if not exists hinted boolean;
alter table public.omni_pick add column if not exists source text default 'pick';
alter table public.omni_pick add column if not exists steps int;
-- v2에서 올리는 경우: source에 'miss'가 추가됐다 (0건이었던 검색어 통계)
alter table public.omni_pick drop constraint if exists omni_pick_source_check;
alter table public.omni_pick add constraint omni_pick_source_check
  check (source in ('pick', 'trail', 'miss', 'visit'));

create index if not exists omni_pick_q_idx on public.omni_pick (q);
create index if not exists omni_pick_created_idx on public.omni_pick (created_at desc);
-- 실패→도착 짝짓기(같은 세션의 시간순 조회)용
create index if not exists omni_pick_session_idx on public.omni_pick (session, created_at);

alter table public.omni_pick enable row level security;

drop policy if exists "anon insert omni pick" on public.omni_pick;
create policy "anon insert omni pick"
  on public.omni_pick for insert
  to anon
  with check (true);

-- ── 공개 집계 ────────────────────────────────────────────────────────────────
-- 1) 직접 클릭 — (검색어, 항목)별 **서로 다른 사람 수**.
create or replace view public.omni_pick_counts as
  select q, uid,
         count(*)::int as picks,
         count(distinct coalesce(session, id::text))::int as voters
  from public.omni_pick
  where source = 'pick'
  group by q, uid;

-- 2) 실패한 검색 → 최종 목적지 — 같은 세션에서 miss 뒤 **10분 안의 방문 5곳까지**를 짝짓는다.
--    "날시"(0건) → … → Kal'tsit·Esperanta 도착 = (날시 → 그 오퍼) 한 표.
--    **목적지는 하나가 아닐 수 있다** (사용자 확정 2026-07-25): "야토"는 야토와 키린R야토,
--    "켈시"는 켈시와 Kal'tsit·Esperanta, "성녀"는 프라마닉스와 프라마닉스 더 프레리타 —
--    그래서 첫 방문 하나만 잡지 않고 창 안의 방문을 모두 쌓아 각각 표를 준다.
--    사람들이 실제로 더 많이 가는 쪽이 자연히 위로 올라오고, 비슷하면 되묻기가 뜬다.
--    브라우저는 miss와 visit '사실'만 보고하고, 연결·집계는 전부 여기서 한다.
--    ⚠ 데이터가 커지면 이 lateral 조인이 무거워진다 — 그때는 visit INSERT 트리거로
--      바꿔 미리 계산해 두면 된다(같은 결과, 조회는 단순 group by).
create or replace view public.omni_trail_counts as
  select m.q, v.uid, count(distinct coalesce(m.session, m.id::text))::int as trail_voters
  from public.omni_pick m
  join lateral (
    select p.uid
    from public.omni_pick p
    where p.source = 'visit'
      and p.session is not null and p.session = m.session
      and p.created_at > m.created_at
      and p.created_at < m.created_at + interval '10 minutes'
    order by p.created_at
    limit 5                      -- 목적지 후보는 최대 5곳 (사용자 제안 5~10 액션)
  ) v on true
  where m.source = 'miss'
  group by m.q, v.uid;

-- 3) 사이트가 읽는 최종 가중치 — 위 둘을 합친 뷰 하나 (클라이언트는 여기만 본다).
--    가중 = voters + 0.5×trail_voters  (추론은 절반 무게)
create or replace view public.omni_weights as
  select coalesce(p.q, t.q) as q,
         coalesce(p.uid, t.uid) as uid,
         coalesce(p.voters, 0) as voters,
         coalesce(t.trail_voters, 0) as trail_voters
  from public.omni_pick_counts p
  full outer join public.omni_trail_counts t on t.q = p.q and t.uid = p.uid;

grant select on public.omni_pick_counts to anon;
grant select on public.omni_trail_counts to anon;
grant select on public.omni_weights to anon;

-- 못 찾은 검색어 순위 — "사람들이 무슨 말로 검색했는데 0건이었나". 여기 자주 올라오는 말은
-- 별칭·힌트 사전(omni.ts TOPIC_NICKS/HINT_TOKENS)이나 데이터 보강으로 바로 이어진다.
create or replace view public.omni_miss_top as
  select q,
         count(*)::int as misses,
         count(distinct coalesce(session, id::text))::int as people,
         max(created_at) as last_at
  from public.omni_pick
  where source = 'miss'
  group by q;

grant select on public.omni_miss_top to anon;

-- 인기 검색어 — 1순위가 실제로 맞았는지(avg_rank 0에 가까울수록 좋다) 점검용.
create or replace view public.omni_query_top as
  select q,
         count(*)::int as picks,
         count(distinct coalesce(session, id::text))::int as voters,
         round(avg(rank)::numeric, 2) as avg_rank,
         round(avg(candidates)::numeric, 2) as avg_candidates,
         max(created_at) as last_at
  from public.omni_pick
  where source = 'pick' and q not like '~%'
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
