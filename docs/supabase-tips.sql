-- 팁 풍선 (사이트 곳곳을 떠다니는 힌트) — Supabase SQL Editor에서 1회 실행.
-- 사용자 확정 2026-07-27: 업데이트 내역과 같은 방식으로 DB에 넣으면 배포 없이 바로 뜬다.
-- 쓰기는 기존 admin 패턴(docs/supabase-admin.sql)과 같이 x-admin-key 헤더로만 허용.
-- ⚠ 관리자 비밀번호를 바꿨다면 아래 'admin' 문자열을 실제 비밀번호로 바꿔서 실행할 것.

create table if not exists public.tips (
  id uuid primary key default gen_random_uuid(),
  -- 풍선에 접힌 채로 보이는 한 줄 (짧게! 20자 안팎)
  title_ko text not null,
  title_en text,
  title_ja text,
  -- 눌러서 펼쳤을 때 나오는 설명
  body_ko text not null,
  body_en text,
  body_ja text,
  image text,           -- 펼침 이미지 경로 (사이트 내부 — 예: /about/planner.webp)
  image_dark text,      -- 다크 모드용 (없으면 image 그대로)
  href text,            -- '바로가기' 링크 (예: /infra#roster-import)
  active boolean not null default true,
  seq int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.tips enable row level security;

drop policy if exists "anon read tips" on public.tips;
create policy "anon read tips"
  on public.tips for select
  to anon
  using (true);

-- ⚠ 이미 있으면 건드리지 않는다 — 이 파일을 다시 돌려도 관리자 키가 아래 플레이스홀더로
--   되돌아가지 않게 (2026-07-29 changelog에서 실제로 당한 사고). 키를 바꾸거나 복구할 땐
--   drop policy … ; 를 손으로 먼저 실행한 뒤 이 블록을 돌린다.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tips' and policyname = 'admin write tips'
  ) then
    execute $p$create policy "admin write tips"
  on public.tips for all
  to anon
  using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin')
  with check ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin')$p$;
  end if;
end $$;

-- ── 시드: 사이트에 이미 있는 소개 스크린샷을 그대로 쓰는 팁 6개 ──
-- 같은 title_ko가 이미 있으면 넣지 않는다 — 이 파일을 다시 돌려도 안전.
insert into public.tips (seq, title_ko, title_en, title_ja, body_ko, body_en, body_ja, image, image_dark, href)
select v.seq, v.title_ko, v.title_en, v.title_ja, v.body_ko, v.body_en, v.body_ja,
       nullif(v.image, ''), nullif(v.image_dark, ''), nullif(v.href, '')
from (values
  (0,
   '보유 오퍼, 로그인으로 한 번에',
   'Import your roster in one go',
   '所持オペレーターを一括インポート',
   '오퍼 405명을 손으로 체크할 필요 없습니다. 인프라 자동편성기의 보유 오퍼 설정에서 요스타 계정으로 로그인하면 실제 보유 목록이 그대로 들어옵니다. MAA 파일이나 게임 스크린샷으로 가져올 수도 있어요.',
   'No need to tick 405 operators by hand. In the base planner''s roster settings, sign in with your Yostar account and your actual roster comes straight in — or import from an MAA file or game screenshots.',
   '405人を手でチェックする必要はありません。基地自動編成の所持オペレーター設定でYostarアカウントにログインすると実際の所持リストがそのまま入ります。MAAファイルやゲームのスクリーンショットからの取り込みも可能です。',
   '/about/planner.webp', '/about/planner-dark.webp', '/infra#roster-import'),
  (1,
   '단어 하나로 어디든',
   'One word, anywhere',
   '一語でどこへでも',
   '헤더 검색창(⌘K)에 단어 하나만 넣어 보세요. 오퍼·재료·스토리·통합전략·기능까지 사이트 안 아무 곳이나 찾아 바로 이동합니다. 오탈자나 은어 별명도 알아듣습니다.',
   'Type a single word into the header search (⌘K). It finds and jumps to anything on the site — operators, materials, stories, Integrated Strategies, tools — and understands typos and slang nicknames.',
   'ヘッダーの検索欄（⌘K）に一語入れてみてください。オペレーター・素材・ストーリー・統合戦略・機能まで、サイト内のどこへでも見つけて移動します。誤字や俗称も理解します。',
   '/about/portal.webp', '/about/portal-dark.webp', ''),
  (2,
   '게임 화면을 사이트에 물리기',
   'Link your game screen',
   'ゲーム画面をサイトに接続',
   '통합전략 가이드의 PRTS 링크(BETA)를 켜면 게임 창을 실시간으로 읽어 조우·소장품·작전 정보를 알아서 띄워 줍니다. 플레이한 여정은 리플레이로 남습니다.',
   'Turn on PRTS Link (BETA) in the Integrated Strategies guide and it reads your game window live, pulling up the matching encounter, collectible, and operation info as you play. Your run is saved as a replay.',
   '統合戦略ガイドのPRTSリンク（BETA）をオンにすると、ゲームウィンドウをライブで読み取り、遭遇・秘宝・作戦の情報を自動で表示します。プレイの行程はリプレイとして残ります。',
   '/lens/prts-link-sample.webp', '', '/rogue#prts-help'),
  (3,
   '이 재료, 어디서 캐야 하죠?',
   'Where do I farm this?',
   'この素材、どこで掘る？',
   '파밍 도우미는 재료마다 개당 기대 이성(이성 소모 ÷ 드랍률)을 계산해 가장 효율 좋은 스테이지에 배지를 붙여 줍니다. 펭귄 물류 실측 드랍률 기준입니다.',
   'The farming helper computes expected sanity per item (sanity ÷ drop rate) for every material and badges the most efficient stage — based on Penguin Statistics'' measured drop rates.',
   '周回ヘルパーは素材ごとの1個あたり期待理性（理性消費÷ドロップ率）を計算し、最も効率の良いステージにバッジを付けます。ペンギン急便の実測ドロップ率が基準です。',
   '/about/farm.webp', '/about/farm-dark.webp', '/farm'),
  (4,
   '스토리, 10분 요약으로',
   'The story in 10 minutes',
   'ストーリーを10分で',
   '이벤트·메인스토리를 전문(풀 스크립트)으로 정주행하거나, 바쁠 땐 AI 요약으로 10분 만에 따라잡을 수 있습니다. 본문의 점선 밑줄 단어를 누르면 인물·용어 설명이 그 자리에서 뜹니다.',
   'Binge event and main stories as full in-game scripts, or catch up in about ten minutes with the AI digest. Tap any dotted-underlined word for a character or term explanation right where you are.',
   'イベント・メインストーリーを全文で一気読みするか、忙しいときはAI要約で10分で追いつけます。本文の点線下線の単語を押すと、人物・用語の説明がその場で表示されます。',
   '/about/story.webp', '/about/story-dark.webp', '/stories'),
  (5,
   '공채 태그, 확정만 골라서',
   'Recruitment, guarantees first',
   '公開求人、確定だけを',
   '공채 도우미에 태그를 넣으면 나올 수 있는 오퍼와 최소 보장 성급을 계산해, 고성급 확정 조합을 위로 올려 줍니다. 놓치기 쉬운 조합을 대신 찾아 줍니다.',
   'Feed tags into the recruitment helper and it works out which operators can appear and the minimum guaranteed rarity, floating guaranteed high-rarity combos to the top so you don''t miss them.',
   '公開求人ヘルパーにタグを入れると、出現しうるオペレーターと最低保証レアリティを計算し、高レア確定の組み合わせを上に並べます。見逃しやすい組み合わせを代わりに探します。',
   '/about/recruit.webp', '/about/recruit-dark.webp', '/recruit')
) as v(seq, title_ko, title_en, title_ja, body_ko, body_en, body_ja, image, image_dark, href)
where not exists (select 1 from public.tips t where t.title_ko = v.title_ko);
