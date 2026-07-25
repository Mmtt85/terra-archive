-- 오퍼 별명 제보 기능 제거 (2026-07-25, 사용자 확정) — Supabase SQL Editor에서 1회 실행.
--
-- 유니버셜 서치의 전역 학습(docs/supabase-omni-picks.sql)이 같은 일을 대신한다:
-- 사람들이 어떤 말로 검색해 어디로 갔는지가 그대로 별명 사전이 되므로, 별명을 따로
-- 제보받아 관리할 이유가 없어졌다. 사이트·관리자 페이지에서도 관련 UI를 전부 제거했다.

drop view if exists public.op_nickname_counts;
drop table if exists public.op_nickname;
