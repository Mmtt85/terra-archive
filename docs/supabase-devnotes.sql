-- 개발자 코멘트 (업데이트 내역 모달 안 — 받은 제안·피드백에 대한 개발자의 답변) —
-- Supabase SQL Editor에서 1회 실행.
-- 사용자 요청 2026-08-05: "제안 받은 피드백에 대한 피드백을 보여주고 싶음. 어떤 제안이 있는데
-- 뭐때문에 되고 뭐때문에 안되는지 이미지·코멘트를 관리자 페이지에서 입력".
-- 쓰기는 기존 admin 패턴(docs/supabase-admin.sql)과 같이 x-admin-key 헤더로만 허용.
--
-- ⚠⚠ 실행 전에 아래 'REPLACE-WITH-ADMIN-KEY'를 **실제 관리자 키**(레포 루트
--    .supabase-admin-key 파일의 내용)로 바꿀 것. 안 바꾸면 정책이 아무 키와도 안 맞아
--    쓰기가 전부 막힌다(=닫힌 채 실패). 종전 파일들처럼 'admin' 같은 짐작 가능한 문자열을
--    두면 anon 키가 공개 번들에 들어 있으므로 **누구나 쓰기·삭제가 된다** — 실제로
--    dev_notes가 그 상태로 만들어져 있었다(2026-08-05 발견, 아래 '정책 교체'로 수정).
--
-- 이미 만든 뒤 정책만 고칠 때 (드롭 후 재생성 — 위 do 블록은 '있으면 건드리지 않기'라
-- 두 번 돌려도 갱신되지 않는다):
--   drop policy "admin write dev_notes" on public.dev_notes;
--   그 다음 아래 do 블록을 실제 키로 바꿔 실행.

create table if not exists public.dev_notes (
  id uuid primary key default gen_random_uuid(),
  released_at date not null default current_date,  -- 표시·정렬 기준일
  -- 제안 처리 상태: done(반영 완료) | planned(반영 예정) | considering(검토중) | rejected(반려)
  status text not null default 'considering'
    check (status in ('done', 'planned', 'considering', 'rejected')),
  -- 받은 제안 요약 — 모달에서 인용문으로 보인다
  suggestion_ko text not null,
  suggestion_en text,
  suggestion_ja text,
  -- 개발자 답변 — 뭐때문에 되고 뭐때문에 안 되는지
  reply_ko text not null,
  reply_en text,
  reply_ja text,
  image text,            -- 첨부 이미지 URL (선택 — /admin 파일 저장소에서 올린 R2 URL 등)
  active boolean not null default true,
  seq int not null default 0,   -- 같은 날짜 안 정렬 (작을수록 위)
  created_at timestamptz not null default now()
);

create index if not exists dev_notes_released_idx on public.dev_notes (released_at desc, seq);

alter table public.dev_notes enable row level security;

drop policy if exists "anon read dev_notes" on public.dev_notes;
create policy "anon read dev_notes"
  on public.dev_notes for select
  to anon
  using (true);

-- ⚠ 이미 있으면 건드리지 않는다 — 이 파일을 다시 돌려도 관리자 키가 아래 플레이스홀더로
--   되돌아가지 않게 (2026-07-29 changelog에서 실제로 당한 사고와 같은 유형 방지).
--   키를 바꾸거나 복구할 땐 drop policy … ; 를 손으로 먼저 실행한 뒤 이 블록을 돌린다.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'dev_notes' and policyname = 'admin write dev_notes'
  ) then
    execute $p$create policy "admin write dev_notes"
  on public.dev_notes for all
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'REPLACE-WITH-ADMIN-KEY')
  with check ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'REPLACE-WITH-ADMIN-KEY')$p$;
  end if;
end $$;
