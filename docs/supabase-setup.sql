-- 테라 아카이브 피드백 테이블 (Supabase SQL Editor에서 1회 실행)
-- 익명 방문자는 INSERT만 가능, 조회는 대시보드(서비스 롤)에서만.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('feature', 'data_error', 'plan')),
  message text not null default '' check (char_length(message) <= 4000),
  payload jsonb
);

alter table public.feedback enable row level security;

drop policy if exists "anon insert feedback" on public.feedback;
create policy "anon insert feedback"
  on public.feedback for insert
  to anon
  with check (true);
