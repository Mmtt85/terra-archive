-- 제안 게시판 (스레드형 개편, 2026-08-17) — Supabase SQL Editor에서 1회 실행.
--
-- 사용자 확정: "제안 버튼을 누르면 게시판 형식 모달. 제안은 작성자 자신과 나만,
-- 내 답변도 나와 제안자만 볼 수 있게. 로그인 없이(구글 OAuth 없이) 판별."
--
-- 작성자 식별은 로그인 없이 **localStorage 토큰(uuid)** 으로 한다 (app/feedback.ts):
--   · INSERT 시 author_token을 함께 저장
--   · 조회는 요청 헤더 x-feedback-token이 그 토큰과 일치하는 행만 RLS로 허용
--     → 작성자 본인(토큰 보유 브라우저)과 관리자(x-admin-key)만 볼 수 있다
--   · 토큰은 uuid v4라 추측 불가. 다른 기기는 '열람 코드'(=토큰) 입력으로 이어본다
-- 답변(feedback_replies)도 같은 규칙: 읽기는 해당 제안 작성자·관리자, 쓰기는 관리자만.
--
-- ⚠⚠ 실행 전에 아래 'REPLACE-WITH-ADMIN-KEY'를 **실제 관리자 키**(레포 루트
--    .supabase-admin-key 파일의 내용)로 바꿀 것. 안 바꾸면 관리자 답변 쓰기가 전부
--    막힌다(=닫힌 채 실패). 'admin' 같은 짐작 가능한 문자열은 금지 — anon 키가 공개
--    번들에 들어 있어 누구나 답변을 쓰고 지울 수 있게 된다 (dev_notes 2026-08-05 전례).

-- ── feedback: 작성자 토큰 컬럼 + 본인 조회 정책 ─────────────────────────────

alter table public.feedback add column if not exists author_token uuid;

create index if not exists feedback_author_token_idx
  on public.feedback (author_token, created_at desc)
  where author_token is not null;

-- 본인 조회 — 기존 "admin read feedback"(x-admin-key)과 OR로 겹쳐진다.
-- author_token이 null인 구형 익명 제안은 누구의 목록에도 안 뜬다 (/admin에서만 보임).
drop policy if exists "author read feedback" on public.feedback;
create policy "author read feedback"
  on public.feedback for select
  to anon
  using (
    author_token is not null
    and author_token::text = (current_setting('request.headers', true)::json ->> 'x-feedback-token')
  );

-- 본인 수정·삭제 (사용자 요청 2026-08-17: "가능하면 수정 및 삭제도 가능하게").
-- 자기 토큰 행만 대상이라 남의 제안은 건드릴 수 없고, with check가 새 행에도 토큰 일치를
-- 요구해 author_token을 남의 것으로 바꿔치기할 수도 없다. 삭제 시 답변은 FK cascade로
-- 함께 지워진다. (첨부 이미지 R2 정리는 익명 클라이언트 권한이 없어 남는다 — /admin 파일
-- 탭 '제안 이미지'에서 지울 수 있다.)
drop policy if exists "author update feedback" on public.feedback;
create policy "author update feedback"
  on public.feedback for update
  to anon
  using (
    author_token is not null
    and author_token::text = (current_setting('request.headers', true)::json ->> 'x-feedback-token')
  )
  with check (
    author_token is not null
    and author_token::text = (current_setting('request.headers', true)::json ->> 'x-feedback-token')
  );

drop policy if exists "author delete feedback" on public.feedback;
create policy "author delete feedback"
  on public.feedback for delete
  to anon
  using (
    author_token is not null
    and author_token::text = (current_setting('request.headers', true)::json ->> 'x-feedback-token')
  );

-- ── feedback_replies: 관리자 답변 ───────────────────────────────────────────

create table if not exists public.feedback_replies (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  body text not null check (char_length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists feedback_replies_feedback_idx
  on public.feedback_replies (feedback_id, created_at);

alter table public.feedback_replies enable row level security;

-- 읽기: 그 답변이 달린 제안의 작성자만. (서브쿼리의 feedback 접근에도 RLS가 적용되지만,
-- "author read feedback" 정책이 같은 토큰 조건이라 결과가 일치한다 — 조건 중복은 의도.)
drop policy if exists "author read feedback_replies" on public.feedback_replies;
create policy "author read feedback_replies"
  on public.feedback_replies for select
  to anon
  using (exists (
    select 1 from public.feedback f
    where f.id = feedback_id
      and f.author_token is not null
      and f.author_token::text = (current_setting('request.headers', true)::json ->> 'x-feedback-token')
  ));

-- 쓰기·삭제·관리자 조회: x-admin-key 헤더로만 (/admin → admin-api 프록시 경유).
-- ⚠ 이미 있으면 건드리지 않는다 — 이 파일을 다시 돌려도 관리자 키가 아래 플레이스홀더로
--   되돌아가지 않게 (2026-07-29 changelog에서 실제로 당한 사고와 같은 유형 방지).
--   키를 바꾸거나 복구할 땐 drop policy … ; 를 손으로 먼저 실행한 뒤 이 블록을 돌린다.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feedback_replies' and policyname = 'admin all feedback_replies'
  ) then
    execute $p$create policy "admin all feedback_replies"
  on public.feedback_replies for all
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'REPLACE-WITH-ADMIN-KEY')
  with check ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'REPLACE-WITH-ADMIN-KEY')$p$;
  end if;
end $$;
