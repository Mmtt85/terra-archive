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

-- 일 기록 — '내 정보' 로그인(me_login)·다시 동기화(me_sync) (2026-10-05 "누가, 몇 번 동기화했는지").
-- 누가 = 방문자 익명 id(visit_session.visitor 와 같은 값). 닉네임·계정 정보는 받지 않는다.
create table if not exists public.visit_event (
  id bigint generated always as identity primary key,
  session uuid not null,
  visitor text check (char_length(visitor) <= 64),
  at timestamptz not null default now(),
  kind text not null check (kind in ('me_login', 'me_sync')),
  server text check (char_length(server) <= 8),
  env text not null default 'live' check (env in ('live', 'dev'))
);
create index if not exists visit_event_at_idx on public.visit_event (at desc);

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

-- ⚠ 정책은 `using ((select public.visits_is_admin()))` — 괄호 안 select 로 감싸야 쿼리마다 **한 번만** 판정한다.
--   맨 함수 호출이면 행마다 요청 헤더 JSON 을 다시 풀어, 4만 8천 행짜리 30일 집계가 27초·시간 초과까지 갔다
--   (2026-10-11, Supabase RLS 성능 안내의 initPlan 요령)
alter table public.visit_session enable row level security;
alter table public.visit_view enable row level security;
alter table public.visit_event enable row level security;
alter table public.visit_day enable row level security;
alter table public.visit_src_day enable row level security;
alter table public.visit_page_day enable row level security;

drop policy if exists "anon insert visit session" on public.visit_session;
create policy "anon insert visit session" on public.visit_session for insert to anon with check (true);
drop policy if exists "anon insert visit view" on public.visit_view;
create policy "anon insert visit view" on public.visit_view for insert to anon with check (true);

drop policy if exists "anon insert visit event" on public.visit_event;
create policy "anon insert visit event" on public.visit_event for insert to anon with check (true);
drop policy if exists "admin read visit event" on public.visit_event;
create policy "admin read visit event" on public.visit_event for select to anon using ((select public.visits_is_admin()));
drop policy if exists "admin read visit session" on public.visit_session;
create policy "admin read visit session" on public.visit_session for select to anon using ((select public.visits_is_admin()));
drop policy if exists "admin read visit view" on public.visit_view;
create policy "admin read visit view" on public.visit_view for select to anon using ((select public.visits_is_admin()));
drop policy if exists "admin read visit day" on public.visit_day;
create policy "admin read visit day" on public.visit_day for select to anon using ((select public.visits_is_admin()));
drop policy if exists "admin read visit src day" on public.visit_src_day;
create policy "admin read visit src day" on public.visit_src_day for select to anon using ((select public.visits_is_admin()));
drop policy if exists "admin read visit page day" on public.visit_page_day;
create policy "admin read visit page day" on public.visit_page_day for select to anon using ((select public.visits_is_admin()));

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

-- 유입원 '목록'만 리퍼러 호스트 그대로 묶는다 (사용자 지시 2026-10-08) — 세션 타임라인·내 정보 동기화의
-- '구글 · www.google.com/' 같은 이름표는 visit_src 그대로 둔다. 리퍼러가 없거나 우리 사이트면 '직접'
create or replace function public.visit_host(p_host text) returns text
language sql immutable as $$
  select case
    when p_host is null or p_host = '' or p_host ~ '(^|\.)terra-archive\.(net|pages\.dev)$' then '직접'
    else p_host
  end
$$;

-- 경로 정규화 — /en·/ja 접두를 떼고 빈 경로는 '/'. 맨 /rogue 는 1번 테마가 열리는 주소라 /rogue/is1 로 합친다
-- (통합전략은 몇 번 테마인지가 제일 중요하다 — 사용자 지시 2026-10-04).
create or replace function public.visit_path(p_path text) returns text
language sql immutable as $$
  select case when x ~ '^/rogue/?$' then '/rogue/is1' else x end
  from (select coalesce(nullif(regexp_replace(p_path, '^/(en|ja)(/|$)', '/'), ''), '/') as x) t
$$;

-- 흐름도용 화면 묶음 — 경로 첫 마디(+ 모달이면 해시 종류). 상세 페이지 수천 개를 갈래 단위로 접는다.
-- 통합전략만은 **몇 번 테마인지**가 갈래다 (사용자 지시 2026-10-04 "통합전략 몇번에 접속했는지가 제일 중요") —
-- 'rogue/is3' 처럼 테마까지 적고(맨 /rogue 는 1번 테마가 열린다), 해시는 #rg-<화면>(맵·적 도감·소장품 …)의 화면 이름.
create or replace function public.visit_section(p_path text, p_hash text) returns text
language sql immutable as $$
  select case
    when split_part(public.visit_path(p_path), '/', 2) = 'rogue' then
      'rogue/' || coalesce(nullif(split_part(public.visit_path(p_path), '/', 3), ''), 'is1')
        || coalesce(' #' || substring(p_hash from '^#rg-([a-z]+)'), '')
    else coalesce(nullif(split_part(public.visit_path(p_path), '/', 2), ''), '홈')
        || coalesce(' #' || substring(p_hash from '^#([a-z]+)'), '')
  end
$$;

-- ── 어드민 조회 (security invoker — RLS 가 관리자 키를 본다. 키가 없으면 빈 결과) ─────────────
-- 목록은 **자르지 않고 전부** 보낸다 — 어드민이 상위 5·10·20·50·100·전체를 고른다 (사용자 지시 2026-10-04).
-- 세션 타임라인만 한 번에 최대 5,000개.

-- 기간의 시작 시각 — p_days 일 전부터. **0 이면 오늘(KST 0시 00분)부터** (사용자 지시 2026-10-04 "오늘 하루 방문자도")
create or replace function public.visits_from(p_days int) returns timestamptz
language sql stable as $$
  select case when p_days <= 0 then date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
              else now() - make_interval(days => p_days) end
$$;

-- 화면 조각을 화면 단위로 합친 것 + 세션 속 순번·마지막 여부
-- 범위판 (2026-10-05 — 어드민 '기간 지정'). p_to 는 그 시각 **미만**.
create or replace function public.visits_views_range(p_from timestamptz, p_to timestamptz)
returns table (session uuid, seq int, n int, last boolean, path text, hash text, t0 int,
               visible_ms bigint, active_ms bigint, scroll int, interacted boolean, out_href text)
language sql stable as $$
  with g as (
    select v.session, v.seq, min(v.path) as path, min(v.hash) as hash, min(v.t0) as t0,
           sum(v.visible_ms) as visible_ms, sum(v.active_ms) as active_ms, max(v.scroll)::int as scroll,
           bool_or(v.interacted) as interacted, max(v.out_href) as out_href
    from public.visit_view v
    where v.at >= p_from and v.at < p_to
    group by v.session, v.seq
  )
  select g.session, g.seq,
         (row_number() over (partition by g.session order by g.seq))::int as n,
         g.seq = max(g.seq) over (partition by g.session) as last,
         g.path, g.hash, g.t0, g.visible_ms, g.active_ms, g.scroll, g.interacted, g.out_href
  from g
$$;

create or replace function public.visits_views(p_from timestamptz)
returns table (session uuid, seq int, n int, last boolean, path text, hash text, t0 int,
               visible_ms bigint, active_ms bigint, scroll int, interacted boolean, out_href text)
language sql stable as $$
  select * from public.visits_views_range(p_from, 'infinity'::timestamptz)
$$;

-- 세션 종류 (2026-10-08, 사용자 지시 "사람·훑고 간 사람·봇 셋으로 나눠 조합으로") —
--   human = 조작(스크롤·클릭·터치·키)이 있었음
--   skim  = 조작은 없지만 화면에 1초 이상 떠 있었고 시간대가 한국·일본 — 즐겨찾기로 열어 확인만 하고 닫은 사람
--           (실측: 서울 폰·한 화면 1~4초, 재방문 다수)
--   bot   = 나머지 — 화면 기록 없음(61%, 상하이·모스크바·LA 크롤러), 화면에 0초(미리보기·프리렌더), 해외 시간대 무조작
-- p_visible_ms 는 numeric — sum() 이 numeric 을 내서 bigint 로 받으면 함수를 못 찾는다(42883, 2026-10-08)
drop function if exists public.visit_is_human(boolean, bigint, text);
drop function if exists public.visit_kind(boolean, bigint, text);
create or replace function public.visit_kind(p_interacted boolean, p_visible_ms numeric, p_tz text)
returns text language sql immutable as $$
  select case when coalesce(p_interacted, false) then 'human'
              when coalesce(p_visible_ms, 0) >= 1000 and p_tz in ('Asia/Seoul', 'Asia/Tokyo') then 'skim'
              else 'bot' end
$$;
-- 매일 정리의 '사람 세션' = human + skim
create or replace function public.visit_is_human(p_interacted boolean, p_visible_ms numeric, p_tz text)
returns boolean language sql immutable as $$
  select public.visit_kind(p_interacted, p_visible_ms, p_tz) <> 'bot'
$$;
-- 고른 종류에 드는가 — p_kinds 가 있으면 그걸로(예: '{human,skim}'), 없으면 옛 p_human(true 사람·false 봇·null 전부)
create or replace function public.visit_pick(p_kind text, p_kinds text[], p_human boolean)
returns boolean language sql immutable as $$
  select case when p_kinds is not null then p_kind = any(p_kinds)
              when p_human is null then true
              else (p_kind <> 'bot') = p_human end
$$;

-- 대시보드 한 장 분량 — 세션 시작이 [p_from, p_to) 인 것. p_hourly 면 시간대별(하루 보기)도 채운다.
-- 조각(view)은 세션 시작 하루 전부터 끝 하루 뒤까지 읽는다 — 자정을 걸친 세션의 조각을 놓치지 않게.
drop function if exists public.visits_summary_range(timestamptz, timestamptz, boolean, boolean);
create or replace function public.visits_summary_range(p_from timestamptz, p_to timestamptz,
  p_human boolean default true, p_hourly boolean default false, p_kinds text[] default null)
returns json language sql stable as $$
  with v as (
    select * from public.visits_views_range(p_from - interval '1 day', p_to + interval '1 day')
  ),
  sh as (
    -- 머문 시간(visible_ms)·조작 시간 — 화면 하나당 **1시간 상한**을 둘 다에 (2026-10-07, 3시간 → 1시간: 사용자 "1시간 넘게
    -- 켜 둔 건 게임 안 하고 그냥 켜 둔 것"). 종전 3시간 사유: 통합전략은 한 판에
    -- 1시간씩 띄워 두고 참고하니 30분 상한은 진짜 사용을 잘랐다(사용자 지적). 밤새 켜 둔 탭 같은 극단값만 자른다.
    -- 같은 상한이라 화면마다 조작 ≤ 머문 이 늘 성립한다(수집이 '보일 때만 조작을 센다'이므로)
    select v.session, bool_or(v.interacted) as human, count(*) as views, sum(least(v.active_ms, 3600000)) as active_ms,
           sum(least(v.visible_ms, 3600000)) as visible_ms
    from v group by v.session
  ),
  s as (
    select vs.*, public.visit_src(vs.ref_host) as src,
           (vs.started_at at time zone 'Asia/Seoul') as kst,
           public.visit_kind(sh.human, sh.visible_ms, vs.tz) as kind, coalesce(sh.views, 0) as views, coalesce(sh.active_ms, 0) as active_ms,
           coalesce(sh.visible_ms, 0) as visible_ms
    from public.visit_session vs left join sh on sh.session = vs.id
    where vs.started_at >= p_from and vs.started_at < p_to and vs.env = 'live' and coalesce(vs.ref_host, '') !~ '^(localhost|127\.0\.0\.1)(:|$)'  -- 로컬 dev 에서 넘어온 운영자 (2026-10-06)
      -- p_human: true 사람만 · false 봇만 · null 둘 다 (사용자 지시 2026-10-05 — 종전 false 는 '둘 다'였다)
      and public.visit_pick(public.visit_kind(sh.human, sh.visible_ms, vs.tz), p_kinds, p_human)
  ),
  -- 기간 안 세션 종류별 수 (고른 종류와 무관하게 셋 다)
  k as (
    select public.visit_kind(sh.human, sh.visible_ms, x.tz) as kind, count(*) as n
    from public.visit_session x left join sh on sh.session = x.id
    where x.started_at >= p_from and x.started_at < p_to and x.env = 'live'
      and coalesce(x.ref_host, '') !~ '^(localhost|127\.0\.0\.1)(:|$)'
    group by 1),
  sv as (select v.* from v join s on s.id = v.session),
  -- 동선 흐름용 — 갈래만(모달·해시 없이) 보고 같은 갈래가 이어지면 한 칸으로 접는다 (사용자 지시 2026-10-04
  -- "인프라는 인프라로 합쳐줘. 모달을 굳이 나눌 필요 없음"). 통합전략은 테마 번호까지가 갈래다.
  fl as (
    select session, row_number() over (partition by session order by n) as k, sec from (
      select session, n, sec, lag(sec) over (partition by session order by n) as prev
      from (select session, n, public.visit_section(path, null) as sec from sv) x
    ) y where prev is distinct from sec)
  select json_build_object(
    'total', (select json_build_object(
        'sessions', count(*), 'visitors', count(distinct visitor), 'views', coalesce(sum(views), 0),
        'active_ms', coalesce(sum(active_ms), 0), 'visible_ms', coalesce(sum(visible_ms), 0),
        'med_active', coalesce(percentile_cont(0.5) within group (order by active_ms), 0)::bigint,
        'med_visible', coalesce(percentile_cont(0.5) within group (order by visible_ms), 0)::bigint,
        'med_views', coalesce(percentile_cont(0.5) within group (order by views), 0),
        'revisit', count(*) filter (where revisit),
        'bounce', count(*) filter (where views <= 1),
        'bots', coalesce((select n from k where kind = 'bot'), 0),
        'kinds', (select json_build_object('human', coalesce(sum(n) filter (where kind = 'human'), 0),
                                           'skim', coalesce(sum(n) filter (where kind = 'skim'), 0),
                                           'bot', coalesce(sum(n) filter (where kind = 'bot'), 0)) from k))
      from s),
    'days', (select coalesce(json_agg(d order by d.day), '[]') from (
        select kst::date as day, count(*) as sessions, count(distinct visitor) as visitors,
               sum(views) as views, sum(active_ms) as active_ms, sum(visible_ms) as visible_ms
        from s group by 1) d),
    'src', (select coalesce(json_agg(d order by d.sessions desc), '[]') from (
        select public.visit_host(ref_host) as src, count(*) as sessions, sum(views) as views, sum(active_ms) as active_ms, sum(visible_ms) as visible_ms,
               percentile_cont(0.5) within group (order by active_ms)::bigint as med_active,
               percentile_cont(0.5) within group (order by visible_ms)::bigint as med_visible
        from s group by 1) d),
    'ref', (select coalesce(json_agg(d order by d.sessions desc), '[]') from (
        select ref, count(*) as sessions from s where ref is not null and ref ~ '^https?://[^/]+/.' group by 1) d),
    'landing', (select coalesce(json_agg(d order by d.sessions desc), '[]') from (
        select public.visit_path(split_part(landing, '#', 1)) as path, count(*) as sessions,
               count(*) filter (where views <= 1) as bounces
        from s group by 1) d),
    'pages', (select coalesce(json_agg(d order by d.views desc), '[]') from (
        select public.visit_path(path) as path, count(*) as views, count(distinct session) as sessions,
               avg(least(active_ms, 3600000))::bigint as avg_active,
               percentile_cont(0.5) within group (order by least(active_ms, 3600000))::bigint as med_active,
               avg(least(visible_ms, 3600000))::bigint as avg_visible,
               percentile_cont(0.5) within group (order by least(visible_ms, 3600000))::bigint as med_visible,
               -- 스크롤은 평균 (2026-10-07 — 한때 중앙값이었다가 지표 전부 평균으로 되돌렸다)
               count(*) filter (where last) as exits, avg(scroll)::int as scroll
        from sv group by 1) d),
    'sections', (select coalesce(json_agg(d order by d.views desc), '[]') from (
        select public.visit_section(path, hash) as section, count(*) as views,
               avg(least(active_ms, 3600000))::bigint as avg_active,
               percentile_cont(0.5) within group (order by least(active_ms, 3600000))::bigint as med_active,
               percentile_cont(0.5) within group (order by least(visible_ms, 3600000))::bigint as med_visible,
               avg(least(visible_ms, 3600000))::bigint as avg_visible,
               count(*) filter (where last) as exits
        from sv group by 1) d),
    -- 오늘 보기의 시간대별 추이 — 시작 시각(KST)의 시로 세션·방문자·화면 조회 (기간이 하루를 넘으면 비운다)
    -- '내 정보' 동기화 — 횟수·사람 수, 사람(익명 방문자)별 횟수, 최근 기록 (사람만 보기와 무관하게 전부)
    'me_sync', (select json_build_object(
        'n', count(*), 'people', count(distinct e.visitor),
        'login', count(*) filter (where e.kind = 'me_login'), 'sync', count(*) filter (where e.kind = 'me_sync'),
        -- 유입(src·ref) = 그 사람이 이 기간에 처음 로그인한(없으면 처음 동기화한) 세션이 어디서 왔는가 (2026-10-05)
        'by', (select coalesce(json_agg(b order by b.n desc, b.last desc), '[]') from (
            select g.*, f.src, f.ref from (
              select x.visitor, count(*) as n, count(*) filter (where x.kind = 'me_login') as login,
                     count(*) filter (where x.kind = 'me_sync') as sync, max(x.at) as last, max(x.server) as server
              from public.visit_event x where x.at >= p_from and x.at < p_to and x.env = 'live' group by 1) g
            left join lateral (
              select public.visit_src(vs.ref_host) as src, coalesce(vs.ref, vs.ref_host) as ref
              from public.visit_event y join public.visit_session vs on vs.id = y.session
              where y.visitor is not distinct from g.visitor and y.at >= p_from and y.at < p_to and y.env = 'live'
              order by (y.kind = 'me_login') desc, y.at asc limit 1) f on true) b),
        'recent', (select coalesce(json_agg(r order by r.at desc), '[]') from (
            select x.at, x.visitor, x.kind, x.server, public.visit_src(vs.ref_host) as src, coalesce(vs.ref, vs.ref_host) as ref
            from public.visit_event x left join public.visit_session vs on vs.id = x.session
            where x.at >= p_from and x.at < p_to and x.env = 'live' order by x.at desc limit 100) r))
      from public.visit_event e where e.at >= p_from and e.at < p_to and e.env = 'live'),
    'hourly', (select coalesce(json_agg(d order by d.hr), '[]') from (
        select extract(hour from kst)::int as hr, count(*) as sessions, count(distinct visitor) as visitors, sum(views) as views
        from s where p_hourly group by 1) d),
    -- 15분 칸 (하루 보기 그래프, 2026-10-07 사용자 지시 — 1시간 칸은 너무 뭉툭했다). q = 시×4 + 분÷15 (0~95)
    'quarter', (select coalesce(json_agg(d order by d.q), '[]') from (
        select (extract(hour from kst)::int * 4 + floor(extract(minute from kst) / 15)::int) as q,
               count(*) as sessions, count(distinct visitor) as visitors, sum(views) as views
        from s where p_hourly group by 1) d),
    -- 시각 칸 (2026-10-08) — 15·30·60분, t = 칸 시작 epoch 초. 기간을 시각까지 고를 수 있어 날짜를 넘는 칸도 겹치지 않게
    -- 하루 안의 순번(q) 대신 절대 시각으로 센다. 방문자는 칸마다 따로 중복 제외(합쳐서 내면 겹쳐 센다)
    'b15', (select coalesce(json_agg(d order by d.t), '[]') from (
        select (floor(extract(epoch from started_at) / 900) * 900)::bigint as t,
               count(*) as sessions, count(distinct visitor) as visitors, sum(views) as views
        from s where p_hourly group by 1) d),
    'b30', (select coalesce(json_agg(d order by d.t), '[]') from (
        select (floor(extract(epoch from started_at) / 1800) * 1800)::bigint as t,
               count(*) as sessions, count(distinct visitor) as visitors, sum(views) as views
        from s where p_hourly group by 1) d),
    'b60', (select coalesce(json_agg(d order by d.t), '[]') from (
        select (floor(extract(epoch from started_at) / 3600) * 3600)::bigint as t,
               count(*) as sessions, count(distinct visitor) as visitors, sum(views) as views
        from s where p_hourly group by 1) d),
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
          select 0 as step, s.src as src, a.sec as dst
          from s join fl a on a.session = s.id and a.k = 1
          union all
          select a.k as step, a.sec as src, case when b.session is null then '이탈' else b.sec end as dst
          from fl a left join fl b on b.session = a.session and b.k = a.k + 1
          where a.k between 1 and 3
        ) e group by 1, 2, 3) d)
  )
$$;

-- 종전 '최근 N일' 판 — 범위판을 그대로 부른다 (0 = 오늘)
drop function if exists public.visits_summary(int, boolean);
create or replace function public.visits_summary(p_days int default 30, p_human boolean default true, p_kinds text[] default null)
returns json language sql stable as $$
  select public.visits_summary_range(public.visits_from(p_days), 'infinity'::timestamptz, p_human, p_days <= 0, p_kinds)
$$;

-- 세션 타임라인 목록 — 한 사람의 동선을 한 줄로
drop function if exists public.visits_sessions_range(timestamptz, timestamptz, boolean, text, text, int);
create or replace function public.visits_sessions_range(p_from timestamptz, p_to timestamptz, p_human boolean default true,
  p_src text default null, p_landing text default null, p_limit int default 100, p_kinds text[] default null)
returns json language sql stable as $$
  with v as (
    select * from public.visits_views_range(p_from - interval '1 day', p_to + interval '1 day')
  ),
  s as (
    select vs.*, public.visit_src(vs.ref_host) as src, public.visit_kind(h.human, h.vis, vs.tz) as kind,
           public.visit_kind(h.human, h.vis, vs.tz) <> 'bot' as human
    from public.visit_session vs
    left join (select session, bool_or(interacted) as human, sum(visible_ms) as vis from v group by 1) h on h.session = vs.id
    where vs.started_at >= p_from and vs.started_at < p_to and vs.env = 'live' and coalesce(vs.ref_host, '') !~ '^(localhost|127\.0\.0\.1)(:|$)'  -- 로컬 dev 에서 넘어온 운영자 (2026-10-06)
      and public.visit_pick(public.visit_kind(h.human, h.vis, vs.tz), p_kinds, p_human)
      and (p_src is null or public.visit_host(vs.ref_host) = p_src or public.visit_src(vs.ref_host) = p_src)
      and (p_landing is null or public.visit_path(split_part(vs.landing, '#', 1)) = p_landing)
    order by vs.started_at desc
    limit least(p_limit, 5000)
  )
  select coalesce(json_agg(json_build_object(
      'id', s.id, 'at', s.started_at, 'src', s.src, 'ref', coalesce(s.ref, s.ref_host), 'landing', s.landing,
      'device', s.device, 'site_lang', s.site_lang, 'tz', s.tz, 'revisit', s.revisit, 'human', s.human, 'kind', s.kind,
      'utm', s.utm_source,
      -- 마지막으로 받은 시각 — 열려 있는 탭은 1분마다 보내므로(visit-track.ts BEAT_MS) 몇 분 안이면 '조작 중' (2026-10-10)
      'last_at', (select max(vv.at) from public.visit_view vv where vv.session = s.id),
      'views', (select coalesce(json_agg(json_build_object('path', v.path, 'hash', v.hash, 't0', v.t0,
                  'vis', v.visible_ms, 'act', v.active_ms, 'scroll', v.scroll, 'out', v.out_href) order by v.seq), '[]')
                from v where v.session = s.id)
    ) order by s.started_at desc), '[]')
  from s
$$;

drop function if exists public.visits_sessions(int, boolean, text, text, int);
create or replace function public.visits_sessions(p_days int default 7, p_human boolean default true,
  p_src text default null, p_landing text default null, p_limit int default 100, p_kinds text[] default null)
returns json language sql stable as $$
  select public.visits_sessions_range(public.visits_from(p_days), 'infinity'::timestamptz, p_human, p_src, p_landing, p_limit, p_kinds)
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
           public.visit_is_human(bool_or(v.interacted), sum(v.visible_ms), vs.tz) as human, count(v.seq) as views, coalesce(sum(v.active_ms), 0) as active_ms
    from public.visit_session vs left join _v v on v.session = vs.id
    where vs.started_at >= d0 and vs.started_at < d1 and vs.env = 'live' and coalesce(vs.ref_host, '') !~ '^(localhost|127\.0\.0\.1)(:|$)'  -- 로컬 dev 에서 넘어온 운영자 (2026-10-06)
    group by vs.id, vs.visitor, vs.revisit, vs.ref_host, vs.tz;

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
create policy "admin read visit cap" on public.visit_cap for select to anon using ((select public.visits_is_admin()));

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
