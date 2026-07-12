-- 오퍼레이터 별명 제보 테이블 (Supabase SQL Editor에서 1회 실행)
-- 제보 1건 = 1행. 익명 방문자는 INSERT만 가능하고, 공개 조회는 집계 뷰로만 한다
-- (개별 제보 행·시각은 비공개). 부적절 별명 삭제는 /admin에서 x-admin-key로.

create table if not exists public.op_nickname (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  op_id text not null check (char_length(op_id) between 1 and 40),
  name text not null check (char_length(name) between 1 and 16 and name !~ '[\n\r\t]')
);

alter table public.op_nickname enable row level security;

drop policy if exists "anon insert nickname" on public.op_nickname;
create policy "anon insert nickname"
  on public.op_nickname for insert
  to anon
  with check (true);

-- 집계 뷰: (오퍼, 별명)별 득표수만 공개 — 사이트가 이 뷰만 읽는다.
-- 뷰는 소유자 권한으로 실행되므로(RLS 우회) 집계 결과만 노출된다.
create or replace view public.op_nickname_counts as
  select op_id, name, count(*)::int as votes
  from public.op_nickname
  group by op_id, name;

grant select on public.op_nickname_counts to anon;

-- 관리자: 부적절 별명 일괄 삭제 (feedback과 동일한 x-admin-key 패턴, 비번 동기화 유지)
drop policy if exists "admin read nickname" on public.op_nickname;
create policy "admin read nickname"
  on public.op_nickname for select
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin');

drop policy if exists "admin delete nickname" on public.op_nickname;
create policy "admin delete nickname"
  on public.op_nickname for delete
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin');
