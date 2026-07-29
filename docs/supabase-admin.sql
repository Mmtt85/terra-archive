-- /admin 페이지용 관리자 정책 (Supabase SQL Editor에서 1회 실행)
-- 요청 헤더 x-admin-key가 아래 비밀번호와 일치할 때만 조회·삭제 허용.
-- 비밀번호를 바꾸려면 해당 `drop policy if exists "…" on public.feedback;` 를 SQL Editor에서
-- 손으로 먼저 실행한 뒤, 'admin'을 실제 키로 고쳐서 아래 블록을 돌린다.
-- (그냥 다시 실행하는 것만으로는 안 바뀐다 — 이미 있는 정책은 건드리지 않도록 막아 뒀다.)

-- ⚠ 이미 있으면 건드리지 않는다 — 이 파일을 다시 돌려도 관리자 키가 아래 플레이스홀더로
--   되돌아가지 않게 (2026-07-29 changelog에서 실제로 당한 사고). 키를 바꾸거나 복구할 땐
--   drop policy … ; 를 손으로 먼저 실행한 뒤 이 블록을 돌린다.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feedback' and policyname = 'admin read feedback'
  ) then
    execute $p$create policy "admin read feedback"
  on public.feedback for select
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin')$p$;
  end if;
end $$;

-- ⚠ 이미 있으면 건드리지 않는다 — 이 파일을 다시 돌려도 관리자 키가 아래 플레이스홀더로
--   되돌아가지 않게 (2026-07-29 changelog에서 실제로 당한 사고). 키를 바꾸거나 복구할 땐
--   drop policy … ; 를 손으로 먼저 실행한 뒤 이 블록을 돌린다.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feedback' and policyname = 'admin delete feedback'
  ) then
    execute $p$create policy "admin delete feedback"
  on public.feedback for delete
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin')$p$;
  end if;
end $$;

-- 확인완료 표시 (reviewed_at이 null이 아니면 확인된 제안)
alter table public.feedback add column if not exists reviewed_at timestamptz;

-- ⚠ 이미 있으면 건드리지 않는다 — 이 파일을 다시 돌려도 관리자 키가 아래 플레이스홀더로
--   되돌아가지 않게 (2026-07-29 changelog에서 실제로 당한 사고). 키를 바꾸거나 복구할 땐
--   drop policy … ; 를 손으로 먼저 실행한 뒤 이 블록을 돌린다.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feedback' and policyname = 'admin update feedback'
  ) then
    execute $p$create policy "admin update feedback"
  on public.feedback for update
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin')
  with check ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin')$p$;
  end if;
end $$;
