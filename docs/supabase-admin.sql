-- /admin 페이지용 관리자 정책 (Supabase SQL Editor에서 1회 실행)
-- 요청 헤더 x-admin-key가 아래 비밀번호와 일치할 때만 조회·삭제 허용.
-- 비밀번호를 바꾸려면 'admin' 부분을 고쳐서 다시 실행하면 된다 (drop 후 재생성).

drop policy if exists "admin read feedback" on public.feedback;
create policy "admin read feedback"
  on public.feedback for select
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin');

drop policy if exists "admin delete feedback" on public.feedback;
create policy "admin delete feedback"
  on public.feedback for delete
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin');

-- 확인완료 표시 (reviewed_at이 null이 아니면 확인된 제안)
alter table public.feedback add column if not exists reviewed_at timestamptz;

drop policy if exists "admin update feedback" on public.feedback;
create policy "admin update feedback"
  on public.feedback for update
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin')
  with check ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin');
