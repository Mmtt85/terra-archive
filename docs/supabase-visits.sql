-- 방문 동선 기록 (사용자 요청 2026-10-04 — "어디로 유입돼서 어느 페이지를 열었고 어디에 몇 초간 머물렀고")
--
-- ⚠ **방문 기록 전용 Supabase 프로젝트**에서 실행한다 (본 프로젝트 exirlkhpkgxsflbglhld 가 아니다).
--    떼어 둔 이유: 무료 DB 는 500MB 를 넘으면 **통째로 읽기 전용**이 된다. 방문 기록이 넘쳐도
--    제안 게시판·업데이트 내역·검색 학습이 함께 멈추지 않게 (사용자 확정 2026-10-04).
--
-- 실행: `node scripts/make-visits-sql.mjs` → `.visits-setup.generated.sql`(관리자 키가 박힌 사본, gitignore)
--       을 방문 기록 프로젝트의 SQL Editor 에 붙여 넣고 Run. 재실행 안전(데이터는 지우지 않는다).
--       이 파일을 그대로 돌리면 맨 앞 가드가 멈춘다 — 관리자 키 자리가 아직 비어 있기 때문.
--
-- 설계 요점
--  1. 원장 두 개 — visit_session(탭 세션당 1행) · visit_view(화면 조각 1행). 익명 키로는 **INSERT 만**.
--     읽기는 x-admin-key 헤더가 맞을 때만(관리자 API 워커·dev 프록시가 붙인다). 수정·삭제는 아무도 못 한다.
--  2. **화면 조각** — 같은 (session, seq) 가 여러 행일 수 있다. 브라우저는 탭을 내리거나 화면을 떠날 때
--     **그사이 늘어난 시간만** 보낸다(추가 전용 — 익명에게 UPDATE 를 열지 않으려고). 읽을 땐 합친다:
--     visible_ms·active_ms 는 합, scroll 은 최대, interacted 는 OR.
--  3. **이탈 = 그 세션의 마지막 화면.** 브라우저는 '떠나는 중'과 '다음 화면으로 가는 중'을 구분하지 못한다.
--  4. **사람 판정** — 세션 동안 조작(스크롤·터치·클릭·키)이 한 번이라도 있었으면 사람.
--     JS 를 실행하며 사람 브라우저로 위장하는 크롤러(2026-09 싱가포르 건)를 거른다.
--  5. **보관 — 기간으로 자르지 않는다. DB 가 80% 차면 오래된 것부터** (사용자 지시 2026-10-04 "90일 유지가 아니라
--     디비 데이터 80% 이상 차면 순차 삭제"). 매일 00:10 KST pg_cron 이 전날·그전날을 일별 집계표로 말아 두고(영구),
--     visits_maintain 이 용량을 본다. ⚠ Postgres 는 행을 지워도 DB 크기 숫자가 줄지 않는다(빈자리를 다시 쓸 뿐) — 그래서
--     '크기 > 80% 면 지운다'를 그대로 쓰면 한 번 닿은 뒤 매일 밤 지운다. 처음 80% 에 닿은 날의 원장 행 수를 **상한**으로
--     적어 두고(visit_cap), 그 뒤로는 행 수를 상한의 85% 아래로 유지한다(가장 오래된 조각부터). 지운 자리는 VACUUM 이
--     재사용 가능으로 돌려 크기가 80% 언저리에서 멈춘다. 그래도 90% 를 넘으면 상한을 10% 낮춘다.
--  6. 개인 식별 정보는 없다 — IP·계정·위치를 받지 않는다. visitor 는 브라우저 localStorage 의
--     무작위 id(재방문 판정용)뿐이다. 나라는 모른다(브라우저 → DB 직행이라 IP 국가가 없다) — 시간대로 갈음.

-- ── 가드 — 관리자 키를 박지 않은 원본을 돌리면 아무것도 만들기 전에 멈춘다 ─────────────────────────
do $$
begin
  if '__ADMIN_KEY__' = '__ADMIN' || '_KEY__' then
    raise exception '관리자 키가 비어 있습니다 — node scripts/make-visits-sql.mjs 로 만든 .visits-setup.generated.sql 을 실행하세요';
  end if;
end $$;

-- ── 원장 ─────────────────────────────────────────────────────────────────────

create table if not exists public.visit_session (
  id uuid primary key,                                   -- 탭 세션 id (sessionStorage)
  visitor uuid not null,                                 -- 브라우저 익명 id (localStorage) — 재방문 판정용
  started_at timestamptz not null default now(),
  landing text not null check (char_length(landing) between 1 and 300),   -- 첫 화면 (경로+해시)
  ref_host text check (char_length(ref_host) <= 120),    -- 유입 도메인 (대개 여기까지만 온다)
  ref text check (char_length(ref) <= 300),              -- 리퍼러 전체 (드물게 경로·검색어까지 온다)
  utm_source text check (char_length(utm_source) <= 60),
  utm_medium text check (char_length(utm_medium) <= 60),
  utm_campaign text check (char_length(utm_campaign) <= 80),
  site_lang text check (site_lang in ('ko', 'en', 'ja')),
  lang text check (char_length(lang) <= 20),             -- 브라우저 언어
  tz text check (char_length(tz) <= 60),                 -- 시간대 (나라 대용)
  device text check (device in ('mobile', 'tablet', 'desktop')),
  vw int check (vw between 0 and 20000),
  vh int check (vh between 0 and 20000),
  dark boolean,
  revisit boolean,                                       -- 이 브라우저가 전에 온 적이 있다 ('returning' 은 예약어)
  env text not null default 'live' check (env in ('live', 'dev'))   -- dev = localhost 시험 전송
);
create index if not exists visit_session_started_idx on public.visit_session (started_at desc);

create table if not exists public.visit_view (
  id bigint generated always as identity primary key,
  session uuid not null,                                 -- visit_session.id (FK 없음 — 전송 순서가 뒤집혀도 받는다)
  seq int not null check (seq between 0 and 5000),       -- 세션 안 화면 순번
  at timestamptz not null default now(),                 -- 서버 수신 시각
  t0 int check (t0 between 0 and 2592000),               -- 세션 시작 기준 이 화면이 열린 초
  path text not null check (char_length(path) between 1 and 300),
  hash text check (char_length(hash) <= 200),            -- 모달 딥링크 (#st-…, #op-… 등)
  visible_ms int not null default 0 check (visible_ms between 0 and 86400000),   -- 탭이 보인 시간
  active_ms int not null default 0 check (active_ms between 0 and 86400000),     -- 그중 30초 안에 조작이 있던 시간
  scroll smallint check (scroll between 0 and 100),      -- 본문을 어디까지 내렸나 (%)
  interacted boolean not null default false,
  out_href text check (char_length(out_href) <= 300)     -- 이 화면에서 누른 바깥 링크
);
create index if not exists visit_view_session_idx on public.visit_view (session, seq);
create index if not exists visit_view_at_idx on public.visit_view (at desc);

-- ── 일별 집계 (영구 보관) ─────────────────────────────────────────────────────

create table if not exists public.visit_day (
  day date primary key,                                  -- KST 날짜
  sessions int not null, human_sessions int not null,
  visitors int not null, new_visitors int not null,
  views int not null, active_ms bigint not null
);
create table if not exists public.visit_src_day (
  day date not null, src text not null,
  sessions int not null, human_sessions int not null,
  primary key (day, src)
);
create table if not exists public.visit_page_day (       -- 사람 세션만
  day date not null, path text not null,
  views int not null, sessions int not null, active_ms bigint not null, exits int not null,
  primary key (day, path)
);

-- ── 권한 ─────────────────────────────────────────────────────────────────────

create or replace function public.visits_is_admin() returns boolean
language sql stable as $$
  select coalesce(current_setting('request.headers', true)::json ->> 'x-admin-key', '') = '__ADMIN_KEY__'
$$;

alter table public.visit_session enable row level security;
alter table public.visit_view enable row level security;
alter table public.visit_day enable row level security;
alter table public.visit_src_day enable row level security;
alter table public.visit_page_day enable row level security;

drop policy if exists "anon insert visit session" on public.visit_session;
create policy "anon insert visit session" on public.visit_session for insert to anon with check (true);
drop policy if exists "anon insert visit view" on public.visit_view;
create policy "anon insert visit view" on public.visit_view for insert to anon with check (true);

drop policy if exists "admin read visit session" on public.visit_session;
create policy "admin read visit session" on public.visit_session for select to anon using (public.visits_is_admin());
drop policy if exists "admin read visit view" on public.visit_view;
create policy "admin read visit view" on public.visit_view for select to anon using (public.visits_is_admin());
drop policy if exists "admin read visit day" on public.visit_day;
create policy "admin read visit day" on public.visit_day for select to anon using (public.visits_is_admin());
drop policy if exists "admin read visit src day" on public.visit_src_day;
create policy "admin read visit src day" on public.visit_src_day for select to anon using (public.visits_is_admin());
drop policy if exists "admin read visit page day" on public.visit_page_day;
create policy "admin read visit page day" on public.visit_page_day for select to anon using (public.visits_is_admin());

-- ── 분류 함수 ────────────────────────────────────────────────────────────────

-- 유입 도메인 → 유입원 이름. 클라이언트를 고치지 않고 여기서만 늘린다.
create or replace function public.visit_src(p_host text) returns text
language sql immutable as $$
  select case
    when p_host is null or p_host = '' or p_host ~ '(^|\.)terra-archive\.(net|pages\.dev)$' then '직접'
    when p_host ~ '(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$' then 'AI 검색'
    when p_host ~ '^(m\.)?blog\.naver\.com$' then '네이버 블로그'
    when p_host ~ '^(m\.)?cafe\.naver\.com$' then '네이버 카페'
    when p_host ~ '(^|\.)naver\.com$' then '네이버'
    when p_host ~ '(^|\.)google\.[a-z.]+$' then '구글'
    when p_host ~ '(^|\.)daum\.net$' then '다음'
    when p_host ~ '(^|\.)bing\.com$' then '빙'
    when p_host ~ '(^|\.)dcinside\.com$' then '디시인사이드'
    when p_host ~ '(^|\.)arca\.live$' then '아카라이브'
    when p_host ~ '(^|\.)(twitter\.com|x\.com|t\.co)$' then 'X'
    when p_host ~ '(^|\.)discord(app)?\.com$' then '디스코드'
    when p_host ~ '(^|\.)(youtube\.com|youtu\.be)$' then '유튜브'
    when p_host ~ '(^|\.)namu\.wiki$' then '나무위키'
    when p_host ~ '(^|\.)ruliweb\.com$' then '루리웹'
    when p_host ~ '(^|\.)inven\.co\.kr$' then '인벤'
    when p_host ~ '(^|\.)fmkorea\.com$' then '에펨코리아'
    when p_host ~ '(^|\.)reddit\.com$' then '레딧'
    else p_host
  end
$$;

-- 경로 정규화 — /en·/ja 접두를 떼고 빈 경로는 '/'.
create or replace function public.visit_path(p_path text) returns text
language sql immutable as $$
  select coalesce(nullif(regexp_replace(p_path, '^/(en|ja)(/|$)', '/'), ''), '/')
$$;

-- 흐름도용 화면 묶음 — 경로 첫 마디(+ 모달이면 해시 종류). 상세 페이지 수천 개를 갈래 단위로 접는다.
create or replace function public.visit_section(p_path text, p_hash text) returns text
language sql immutable as $$
  select coalesce(nullif(split_part(public.visit_path(p_path), '/', 2), ''), '홈')
      || coalesce(' #' || substring(p_hash from '^#([a-z]+)'), '')
$$;

-- ── 어드민 조회 (security invoker — RLS 가 관리자 키를 본다. 키가 없으면 빈 결과) ─────────────
-- 목록은 **자르지 않고 전부** 보낸다 — 어드민이 상위 5·10·20·50·100·전체를 고른다 (사용자 지시 2026-10-04).
-- 세션 타임라인만 한 번에 최대 5,000개.

-- 화면 조각을 화면 단위로 합친 것 + 세션 속 순번·마지막 여부
create or replace function public.visits_views(p_from timestamptz)
returns table (session uuid, seq int, n int, last boolean, path text, hash text, t0 int,
               visible_ms bigint, active_ms bigint, scroll int, interacted boolean, out_href text)
language sql stable as $$
  with g as (
    select v.session, v.seq, min(v.path) as path, min(v.hash) as hash, min(v.t0) as t0,
           sum(v.visible_ms) as visible_ms, sum(v.active_ms) as active_ms, max(v.scroll)::int as scroll,
           bool_or(v.interacted) as interacted, max(v.out_href) as out_href
    from public.visit_view v
    where v.at >= p_from
    group by v.session, v.seq
  )
  select g.session, g.seq,
         (row_number() over (partition by g.session order by g.seq))::int as n,
         g.seq = max(g.seq) over (partition by g.session) as last,
         g.path, g.hash, g.t0, g.visible_ms, g.active_ms, g.scroll, g.interacted, g.out_href
  from g
$$;

-- 대시보드 한 장 분량 (기간 p_days 일, 사람만이면 p_human)
create or replace function public.visits_summary(p_days int default 30, p_human boolean default true)
returns json language sql stable as $$
  with v as (
    select * from public.visits_views(now() - make_interval(days => p_days) - interval '1 day')
  ),
  sh as (
    select v.session, bool_or(v.interacted) as human, count(*) as views, sum(v.active_ms) as active_ms
    from v group by v.session
  ),
  s as (
    select vs.*, public.visit_src(vs.ref_host) as src,
           (vs.started_at at time zone 'Asia/Seoul') as kst,
           coalesce(sh.human, false) as human, coalesce(sh.views, 0) as views, coalesce(sh.active_ms, 0) as active_ms
    from public.visit_session vs left join sh on sh.session = vs.id
    where vs.started_at >= now() - make_interval(days => p_days) and vs.env = 'live'
      and (not p_human or coalesce(sh.human, false))
  ),
  sv as (select v.* from v join s on s.id = v.session)
  select json_build_object(
    'total', (select json_build_object(
        'sessions', count(*), 'visitors', count(distinct visitor), 'views', coalesce(sum(views), 0),
        'active_ms', coalesce(sum(active_ms), 0), 'revisit', count(*) filter (where revisit),
        'bounce', count(*) filter (where views <= 1),
        'bots', (select count(*) from public.visit_session x left join sh on sh.session = x.id
                 where x.started_at >= now() - make_interval(days => p_days) and x.env = 'live' and not coalesce(sh.human, false)))
      from s),
    'days', (select coalesce(json_agg(d order by d.day), '[]') from (
        select kst::date as day, count(*) as sessions, count(distinct visitor) as visitors,
               sum(views) as views, sum(active_ms) as active_ms
        from s group by 1) d),
    'src', (select coalesce(json_agg(d order by d.sessions desc), '[]') from (
        select src, count(*) as sessions, sum(views) as views, sum(active_ms) as active_ms
        from s group by 1) d),
    'ref', (select coalesce(json_agg(d order by d.sessions desc), '[]') from (
        select ref, count(*) as sessions from s where ref is not null and ref ~ '^https?://[^/]+/.' group by 1) d),
    'landing', (select coalesce(json_agg(d order by d.sessions desc), '[]') from (
        select public.visit_path(split_part(landing, '#', 1)) as path, count(*) as sessions,
               count(*) filter (where views <= 1) as bounces
        from s group by 1) d),
    'pages', (select coalesce(json_agg(d order by d.views desc), '[]') from (
        select public.visit_path(path) as path, count(*) as views, count(distinct session) as sessions,
               avg(active_ms)::bigint as avg_active, percentile_cont(0.5) within group (order by active_ms)::bigint as med_active,
               count(*) filter (where last) as exits, avg(scroll)::int as scroll
        from sv group by 1) d),
    'sections', (select coalesce(json_agg(d order by d.views desc), '[]') from (
        select public.visit_section(path, hash) as section, count(*) as views,
               avg(active_ms)::bigint as avg_active, count(*) filter (where last) as exits
        from sv group by 1) d),
    'hours', (select coalesce(json_agg(json_build_array(dow, hr, n)), '[]') from (
        select extract(isodow from kst)::int - 1 as dow, extract(hour from kst)::int as hr, count(*) as n
        from s group by 1, 2) d),
    'device', (select coalesce(json_agg(d order by d.n desc), '[]') from (select device as k, count(*) as n from s group by 1) d),
    'site_lang', (select coalesce(json_agg(d order by d.n desc), '[]') from (select site_lang as k, count(*) as n from s group by 1) d),
    'tz', (select coalesce(json_agg(d order by d.n desc), '[]') from (select tz as k, count(*) as n from s group by 1) d),
    'out', (select coalesce(json_agg(d order by d.n desc), '[]') from (
        select substring(out_href from '^https?://([^/?#]+)') as host, count(*) as n
        from sv where out_href is not null group by 1) d),
    -- 흐름도: 유입원 → 1번째 화면 → 2번째 → 3번째 (그 뒤는 끊는다). '이탈' 은 거기서 끝난 세션.
    'flow', (select coalesce(json_agg(d), '[]') from (
        select step, src, dst, count(*) as n from (
          select 0 as step, s.src as src, public.visit_section(a.path, a.hash) as dst
          from s join sv a on a.session = s.id and a.n = 1
          union all
          select a.n as step, public.visit_section(a.path, a.hash) as src,
                 case when b.session is null then '이탈' else public.visit_section(b.path, b.hash) end as dst
          from sv a left join sv b on b.session = a.session and b.n = a.n + 1
          where a.n between 1 and 3
        ) e group by 1, 2, 3) d)
  )
$$;

-- 세션 타임라인 목록 — 한 사람의 동선을 한 줄로
create or replace function public.visits_sessions(p_days int default 7, p_human boolean default true,
  p_src text default null, p_landing text default null, p_limit int default 100)
returns json language sql stable as $$
  with v as (
    select * from public.visits_views(now() - make_interval(days => p_days) - interval '1 day')
  ),
  s as (
    select vs.*, public.visit_src(vs.ref_host) as src, coalesce(h.human, false) as human
    from public.visit_session vs
    left join (select session, bool_or(interacted) as human from v group by 1) h on h.session = vs.id
    where vs.started_at >= now() - make_interval(days => p_days) and vs.env = 'live'
      and (not p_human or coalesce(h.human, false))
      and (p_src is null or public.visit_src(vs.ref_host) = p_src)
      and (p_landing is null or public.visit_path(split_part(vs.landing, '#', 1)) = p_landing)
    order by vs.started_at desc
    limit least(p_limit, 5000)
  )
  select coalesce(json_agg(json_build_object(
      'id', s.id, 'at', s.started_at, 'src', s.src, 'ref', coalesce(s.ref, s.ref_host), 'landing', s.landing,
      'device', s.device, 'site_lang', s.site_lang, 'tz', s.tz, 'revisit', s.revisit, 'human', s.human,
      'utm', s.utm_source,
      'views', (select coalesce(json_agg(json_build_object('path', v.path, 'hash', v.hash, 't0', v.t0,
                  'vis', v.visible_ms, 'act', v.active_ms, 'scroll', v.scroll, 'out', v.out_href) order by v.seq), '[]')
                from v where v.session = s.id)
    ) order by s.started_at desc), '[]')
  from s
$$;

-- 긴 기간 추이 — 원장이 지워진 옛날도 남도록 일별 집계표에서
create or replace function public.visits_trend(p_days int default 365)
returns json language sql stable as $$
  select coalesce(json_agg(d order by d.day), '[]')
  from public.visit_day d
  where d.day >= ((now() at time zone 'Asia/Seoul')::date - p_days)
$$;

-- ── 매일 밤 정리 (pg_cron) ─────────────────────────────────────────────────────

create or replace function public.visits_rollup(p_day date) returns void
language plpgsql as $$
declare
  -- 변수 이름이 칼럼(visit_view.t0)과 겹치면 plpgsql 이 모호하다고 멈춘다 — d0·d1
  d0 timestamptz := (p_day::timestamp at time zone 'Asia/Seoul');
  d1 timestamptz := d0 + interval '1 day';
begin
  delete from public.visit_day where day = p_day;
  delete from public.visit_src_day where day = p_day;
  delete from public.visit_page_day where day = p_day;

  -- visits_maintain 이 한 트랜잭션에서 두 번 부른다 — on commit drop 임시 표가 남아 있으니 먼저 치운다
  drop table if exists _v;
  drop table if exists _s;
  create temp table _v on commit drop as
    select * from public.visits_views(d0 - interval '1 day');
  create temp table _s on commit drop as
    select vs.id, vs.visitor, vs.revisit, public.visit_src(vs.ref_host) as src,
           coalesce(bool_or(v.interacted), false) as human, count(v.seq) as views, coalesce(sum(v.active_ms), 0) as active_ms
    from public.visit_session vs left join _v v on v.session = vs.id
    where vs.started_at >= d0 and vs.started_at < d1 and vs.env = 'live'
    group by vs.id, vs.visitor, vs.revisit, vs.ref_host;

  insert into public.visit_day
    select p_day, count(*), count(*) filter (where human), count(distinct visitor),
           count(distinct visitor) filter (where not coalesce(revisit, false)),
           coalesce(sum(views), 0), coalesce(sum(active_ms), 0)
    from _s having count(*) > 0;
  insert into public.visit_src_day
    select p_day, src, count(*), count(*) filter (where human) from _s group by src;
  insert into public.visit_page_day
    select p_day, public.visit_path(v.path), count(*), count(distinct v.session), sum(v.active_ms),
           count(*) filter (where v.last)
    from _v v join _s s on s.id = v.session and s.human
    group by 2;
end $$;

-- 용량 상한 기록 — 처음 80% 에 닿은 날의 원장 행 수 (한 줄짜리)
create table if not exists public.visit_cap (
  id boolean primary key default true check (id),
  cap_rows bigint not null,
  set_at timestamptz not null default now()
);
alter table public.visit_cap enable row level security;
drop policy if exists "admin read visit cap" on public.visit_cap;
create policy "admin read visit cap" on public.visit_cap for select to anon using (public.visits_is_admin());

drop function if exists public.visits_maintain();   -- 예전(90일 보관) 판 — 인자 없는 판이 남으면 호출이 모호해진다
create or replace function public.visits_maintain(p_limit_bytes bigint default 500 * 1024 * 1024)
returns void language plpgsql as $$
declare
  d date := (now() at time zone 'Asia/Seoul')::date;
  size bigint := pg_database_size(current_database());
  n bigint;
  cap bigint;
  keep bigint;
  cutoff timestamptz;
begin
  -- 자정 넘어 도착한 조각도 담기게 그전날까지 다시 만다 (집계는 매번 지우고 새로 넣어 멱등)
  perform public.visits_rollup(d - 2);
  perform public.visits_rollup(d - 1);

  select count(*) into n from public.visit_view;
  select cap_rows into cap from public.visit_cap;
  if cap is null and size >= p_limit_bytes * 0.8 then          -- 처음 80% 에 닿았다 — 지금 행 수가 상한
    cap := n;
    insert into public.visit_cap (cap_rows) values (cap);
  elsif cap is not null and size >= p_limit_bytes * 0.9 then    -- 빈자리 재사용으로도 못 막았다 — 상한을 낮춘다
    cap := floor(cap * 0.9);
    update public.visit_cap set cap_rows = cap, set_at = now();
  end if;
  if cap is null then return; end if;

  keep := floor(cap * 0.85);
  if n <= keep then return; end if;
  -- 가장 오래된 조각부터 (n - keep) 개를 지운다 — 그 경계 시각을 찾아 그 앞을 통째로
  select at into cutoff from public.visit_view order by at asc offset (n - keep) limit 1;
  delete from public.visit_view where at < cutoff;
  delete from public.visit_session s
   where s.started_at < cutoff and not exists (select 1 from public.visit_view v where v.session = s.id);
end $$;

-- 정리 함수는 익명에게 열지 않는다 (조회 함수는 열어 둬도 RLS 가 키 없는 요청에 빈 결과를 준다)
revoke execute on function public.visits_rollup(date) from public, anon, authenticated;
revoke execute on function public.visits_maintain(bigint) from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule('visits-maintain') where exists (select 1 from cron.job where jobname = 'visits-maintain');
select cron.schedule('visits-maintain', '10 15 * * *', $$select public.visits_maintain()$$);   -- 15:10 UTC = 00:10 KST
-- 지운 자리를 재사용 가능으로 — VACUUM 은 트랜잭션 안에서 못 돌아서 함수가 아니라 따로 둔다 (한 문장이어야 한다)
select cron.unschedule('visits-vacuum') where exists (select 1 from cron.job where jobname = 'visits-vacuum');
select cron.schedule('visits-vacuum', '30 15 * * *', $$vacuum (analyze) public.visit_view, public.visit_session$$);   -- 00:30 KST
