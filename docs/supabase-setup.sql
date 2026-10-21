-- 테라 아카이브 피드백 테이블 (Supabase SQL Editor에서 1회 실행)
-- 익명 방문자는 INSERT만 가능, 조회는 대시보드(서비스 롤)에서만.
-- ⚠ 2026-08-17 게시판 개편: 작성자 토큰 컬럼·본인 조회 정책·답변 테이블은
--   supabase-feedback-board.sql에 있다 — 이 파일 다음에 그것도 실행할 것.

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

-- 표 권한 (Supabase 2026-10-30 변경 대비) — 그날부터 public 에 새로 만든 표는 Data API 권한이 자동으로 붙지 않는다.
-- 지금까지 자동으로 주던 권한과 같게 직접 준다 (실제 접근 제한은 위 RLS 정책이 맡는다). 이 문서로 표를 다시 만들 때 꼭 함께 실행
grant select, insert, update, delete on public.feedback to anon, authenticated, service_role;
