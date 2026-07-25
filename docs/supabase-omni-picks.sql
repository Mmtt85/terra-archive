-- 만능검색 선택 학습 테이블 (Supabase SQL Editor에서 1회 실행)
-- 되묻기("이 중에 무엇인가요?")에서 사람들이 무엇을 골랐는지 1클릭 = 1행으로 쌓고,
-- 공개는 **2표 이상** 집계 뷰로만 한다 (개별 클릭·시각은 비공개, 1표는 노출 안 함).
-- 클라이언트: app/omni-picks.ts — 테이블이 없으면 조용히 로컬 학습만 동작한다.
--
-- 저장하는 값: 정규화된 검색어(q, 소문자·공백제거) + 고른 항목 id(uid) + 종류·이름·언어.
-- 검색 이력을 사용자별로 묶을 수 있는 정보(세션·IP·시각 노출)는 공개하지 않는다.

create table if not exists public.omni_pick (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  q text not null check (char_length(q) between 1 and 40),
  uid text not null check (char_length(uid) between 1 and 120),
  kind text check (char_length(kind) <= 20),
  name text check (char_length(name) <= 80),
  locale text check (char_length(locale) <= 5)
);

create index if not exists omni_pick_q_idx on public.omni_pick (q);

alter table public.omni_pick enable row level security;

drop policy if exists "anon insert omni pick" on public.omni_pick;
create policy "anon insert omni pick"
  on public.omni_pick for insert
  to anon
  with check (true);

-- 집계 뷰: (검색어, 항목)별 표수 — 2표 이상만 공개해 1명의 클릭으로 순위가 흔들리지 않게 한다.
-- 뷰는 소유자 권한으로 실행되므로(RLS 우회) 집계 결과만 노출된다.
create or replace view public.omni_pick_counts as
  select q, uid, count(*)::int as picks
  from public.omni_pick
  group by q, uid
  having count(*) >= 2;

grant select on public.omni_pick_counts to anon;

-- 관리자: 이상 데이터 조회·삭제 (feedback과 동일한 x-admin-key 패턴, 비번 동기화 유지)
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
