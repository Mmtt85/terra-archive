-- 업데이트 내역 (헤더 🛠 버튼 모달) — Supabase SQL Editor에서 1회 실행.
-- 사용자 확정 2026-07-27: 코드에 하드코딩하고 매번 빌드·배포하지 말고, DB에 넣으면
-- 사이트에 실시간으로 뜨게 한다. 종류·날짜·3개 언어를 모두 행에 담는다.
-- 쓰기는 기존 admin 패턴(docs/supabase-admin.sql)과 같이 x-admin-key 헤더로만 허용.
-- ⚠ 관리자 비밀번호를 바꿨다면 아래 'admin' 문자열을 실제 비밀번호로 바꿔서 실행할 것.

create table if not exists public.changelog (
  id uuid primary key default gen_random_uuid(),
  released_at date not null default current_date,   -- 표시·정렬 기준일 (배포한 날)
  -- new=신기능 · improve=개선 · change=수정(버그 아닌 일반 변경) · fix=버그 수정 · data=데이터 갱신
  kind text not null check (kind in ('new', 'improve', 'change', 'fix', 'data')),
  ko text not null,                                  -- 한국어 원문 (필수)
  en text,                                           -- 없으면 프론트가 ko로 폴백
  ja text,
  href text,                                         -- 바로가기 (사이트 내부 경로 — 예: /infra#roster-import)
  seq int not null default 0,                        -- 같은 날짜 안 정렬 (작을수록 위)
  created_at timestamptz not null default now()
);

-- 종류 추가 마이그레이션 (2026-07-27, change 분리) — 이미 설치했어도 이 파일을 다시 돌리면 갱신된다
alter table public.changelog drop constraint if exists changelog_kind_check;
alter table public.changelog add constraint changelog_kind_check
  check (kind in ('new', 'improve', 'change', 'fix', 'data'));

-- 기능 영역 (2026-07-29, 사용자 요청 "인프라 개선 / 사이트 개선처럼 나누자")
-- 배지가 '{영역} {종류}'로 읽힌다. 비워 두면 프론트가 href로 유추하고(areaOf), 그래도
-- 모르면 'site'. **href가 없는 옛 행은 전부 site가 되므로 /admin에서 채워 주는 게 정확하다.**
-- 사이트 조회는 select=* 라서 이 컬럼이 없어도 깨지지 않는다 — 다만 /admin 저장은 필요하다.
alter table public.changelog add column if not exists area text
  check (area is null or area in ('infra', 'archive', 'recruit', 'farm', 'upgrade', 'story', 'rogue', 'site'));

create index if not exists changelog_released_idx on public.changelog (released_at desc, seq);

alter table public.changelog enable row level security;

-- 누구나 읽는다 (사이트 모달이 익명 키로 조회)
drop policy if exists "anon read changelog" on public.changelog;
create policy "anon read changelog"
  on public.changelog for select
  to anon
  using (true);

-- 쓰기·수정·삭제는 관리자 헤더로만.
-- ⚠ **이미 정책이 있으면 건드리지 않는다.** 예전엔 drop → create 였는데, 컬럼 추가 같은
--   스키마 변경 때문에 이 파일을 다시 돌리면 **정책의 관리자 키가 아래 'admin' 플레이스홀더로
--   되돌아갔다** (2026-07-29 실제 사고: /admin이 조용히 아무것도 저장하지 않으면서 "저장됨"만
--   띄웠고, 그동안 누구나 x-admin-key: admin 으로 이 테이블에 쓸 수 있었다).
--   비밀번호를 바꾸거나 복구할 때만 아래 '키 재설정' 블록을 따로 실행할 것.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'changelog' and policyname = 'admin write changelog'
  ) then
    execute $p$
      create policy "admin write changelog"
        on public.changelog for all
        to anon
        using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin')
        with check ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin')
    $p$;
  end if;
end $$;

-- ── 키 재설정 (필요할 때만 손으로 실행) ────────────────────────────────────────
-- 'admin' 두 곳을 실제 관리자 키(.supabase-admin-key)로 바꿔서 통째로 실행한다.
--
--   drop policy if exists "admin write changelog" on public.changelog;
--   create policy "admin write changelog"
--     on public.changelog for all
--     to anon
--     using ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin')
--     with check ((current_setting('request.headers', true)::json ->> 'x-admin-key') = 'admin');

-- ── 시드: 2026-07-24 17시 이후 배포분 (종전 app/changelog.tsx 하드코딩 내용) ──
-- 이미 같은 (released_at, ko) 행이 있으면 넣지 않는다 — 이 파일을 다시 돌려도 안전.
insert into public.changelog (released_at, kind, seq, href, ko, en, ja)
select v.released_at::date, v.kind, v.seq, nullif(v.href, ''), v.ko, v.en, v.ja
from (values
  ('2026-07-27', 'new', 0, '',
   '업데이트 내역이 생겼습니다 — 헤더 로고 옆 🛠 버튼을 누르면 최근 1주일치 변경 사항이 보이고, 지난 기록 전체보기로 그 이전 내역까지 확인할 수 있습니다.',
   'A What''s New panel — tap the 🛠 button next to the logo in the header for the last week of changes, and "Show all past entries" for everything before that.',
   '更新履歴が追加されました — ヘッダーのロゴ横の🛠ボタンで直近1週間の変更が見られ、「過去の履歴をすべて表示」でそれ以前の内容も確認できます。'),
  ('2026-07-27', 'improve', 1, '/infra',
   '인프라 자동편성기 화면 정리 — 보유 오퍼 설정·전체 자동편성을 크고 눈에 띄는 버튼으로 올리고, 요약 카드 높이와 교대 탭 위치를 다듬었습니다.',
   'Tidied up the base planner — "Roster settings" and "Auto-plan everything" are now large primary buttons, with slimmer summary cards and a repositioned shift tab row.',
   '基地自動編成の画面を整理 — 「所持オペレーター設定」「全体自動編成」を大きな主要ボタンに、サマリーカードの高さと交代タブの位置も調整しました。'),
  ('2026-07-27', 'improve', 2, '',
   '모달마다 URL이 생겼습니다 — 보유 오퍼 설정, 방 상세, 리플레이, 재료 상세 등을 링크로 바로 공유하고 뒤로가기로 닫을 수 있습니다.',
   'Modals now have their own URLs — share a direct link to roster settings, room details, replays, material details and more, and close them with the back button.',
   'モーダルごとにURLが付きました — 所持オペレーター設定・部屋詳細・リプレイ・素材詳細などをリンクで直接共有でき、戻るボタンで閉じられます。'),
  ('2026-07-26', 'new', 0, '/infra#roster-import',
   '보유 오퍼레이터 가져오기 — 직접 입력 외에 MAA 파일·스크린샷·게임 계정 로그인 3가지 방식이 생겼습니다. 요스타 계정으로 로그인하면 실제 보유 목록을 통째로 동기화합니다.',
   'Roster import — besides manual entry, you can now import via MAA file, screenshots, or game account login. Signing in with your Yostar account syncs your actual roster in one go.',
   '所持オペレーターのインポート — 手動入力に加え、MAAファイル・スクリーンショット・ゲームアカウントログインの3方式が追加。Yostarアカウントでログインすると実際の所持リストを丸ごと同期します。'),
  ('2026-07-26', 'new', 1, '/rogue#prts-help',
   'PRTS 링크 (BETA) — 통합전략 가이드에서 게임 화면을 실시간으로 연결하면 조우·소장품·작전을 자동 인식해 해당 정보로 이동합니다. 자세한 사용법은 버튼 옆 ? 도움말에.',
   'PRTS Link (BETA) — connect your game screen live in the Integrated Strategies guide and it auto-recognizes encounters, collectibles, and operations, jumping to the matching info. See the ? help next to the button.',
   'PRTSリンク（BETA）— 統合戦略ガイドでゲーム画面をライブ接続すると、遭遇・秘宝・作戦を自動認識して該当情報へ移動します。詳しい使い方はボタン横の「?」ヘルプへ。'),
  ('2026-07-26', 'new', 2, '/rogue#replay',
   '리플레이 — PRTS 링크로 플레이한 여정(작전 진입·조우·소장품 획득)이 자동 기록됩니다. 프리뷰로 훑어보고 JSON으로 내보내기·가져오기가 됩니다.',
   'Replay — your journey while playing with PRTS Link (operations entered, encounters, collectibles picked up) is recorded automatically. Preview it and export/import as JSON.',
   'リプレイ — PRTSリンクでプレイした行程（作戦突入・遭遇・秘宝入手）を自動記録。プレビューで確認でき、JSONの書き出し・読み込みに対応。'),
  ('2026-07-26', 'improve', 3, '',
   '유니버셜 서치 — 검색창 폭을 정리하고, 실패한 검색어가 재검색 끝에 고른 결과와 즉시 짝지어지도록 학습을 강화했습니다.',
   'Universal search — tidied the search box width and strengthened learning so failed queries pair up immediately with the result you eventually pick.',
   'ユニバーサル検索 — 検索欄の幅を整理し、失敗した検索語が再検索の末に選んだ結果とすぐ結び付くよう学習を強化。'),
  ('2026-07-26', 'improve', 4, '',
   '보유 오퍼레이터 설정 모달이 가벼워졌습니다 — 카드를 눌렀을 때 전체가 다시 그려지던 문제를 없앴습니다.',
   'The roster settings modal is lighter — clicking a card no longer re-renders the whole grid.',
   '所持オペレーター設定モーダルが軽くなりました — カードを押すたび全体が再描画される問題を解消。'),
  ('2026-07-26', 'improve', 5, '',
   '사이트 전역의 버튼·카드·모달 모서리를 통일감 있게 둥글렸습니다.',
   'Rounded the corners of buttons, cards, and modals consistently across the site.',
   'サイト全体のボタン・カード・モーダルの角を統一感を持って丸めました。'),
  ('2026-07-26', 'change', 6, '',
   '이름 정리 — 메뉴 ''소개''는 ''테라 아카이브 소개''로, 검색어 ''인프라 딸깍''으로도 인프라 자동편성기에 들어갑니다.',
   'Naming cleanup — the About menu is now "About Terra Archive", and searching for the slang "infra one-click" also reaches the base planner.',
   '名称整理 — メニュー「紹介」は「テラアーカイブについて」に。俗称の検索でも基地自動編成に入れます。'),
  ('2026-07-25', 'new', 0, '',
   '만능검색 — 헤더 검색창에서 단어 하나로 사이트 안 아무 컨텐츠나 찾아 이동합니다. 오탈자 근사·은어 별칭을 알아듣고, 선택할수록 똑똑해집니다.',
   'Universal search — type one word in the header to find and jump to any content on the site. It handles typos and slang aliases, and gets smarter as you pick results.',
   'ユニバーサル検索 — ヘッダーの検索欄に一語入力するだけでサイト内のあらゆるコンテンツへ移動。誤字の近似や俗称も理解し、選ぶほど賢くなります。'),
  ('2026-07-25', 'new', 1, '/rogue',
   '스샷 레이더가 일본어·영어 게임 화면도 인식합니다 (KR 전용 → KR/EN/JA).',
   'Screenshot Radar now recognizes Japanese and English game screens too (KR-only → KR/EN/JA).',
   'スクショレーダーが日本語・英語のゲーム画面にも対応（KR専用 → KR/EN/JA）。'),
  ('2026-07-25', 'improve', 2, '',
   '공식 방송 — 버튼을 미래시 토글 옆으로 옮기고, 지난 방송 10건 이력을 담았습니다. 미래시를 켜면 중국 서버(비리비리) 일정도 보입니다.',
   'Official streams — moved the button next to the future-data toggle and added a history of the last 10 streams. With future data on, CN server (bilibili) schedules show too.',
   '公式配信 — ボタンを未来視トグルの横に移動し、過去配信10件の履歴を追加。未来視をオンにすると中国サーバー（bilibili）の日程も表示されます。'),
  ('2026-07-25', 'improve', 3, '',
   '헤더 이벤트 드롭다운에 ''향후 다가올 이벤트''를 추가하고, 미실장 이벤트에 KR 추정 출시월을 표시합니다.',
   'Added an "Upcoming events" section to the header event dropdown, with estimated KR release months for unreleased events.',
   'ヘッダーのイベントドロップダウンに「今後のイベント」を追加し、未実装イベントにKR推定実装月を表示。'),
  ('2026-07-25', 'improve', 4, '/infra',
   '인프라 자동편성기 — 숙소 직접 편성과 📌 고정, 파트너·이름 조건 오판 전수 정정, 육성 추천이 안 뜨던 원인 수정, 스킬 설명 속 RIIC 용어 클릭 팝업(79종).',
   'Base planner — manual dorm assignment with 📌 pinning, a full audit of partner/name condition misjudgments, fixed upgrade recommendations not appearing, and clickable RIIC term popups in skill descriptions (79 terms).',
   '基地自動編成 — 宿舎の手動編成と📌固定、パートナー・名前条件の誤判定を全数修正、育成おすすめが出ない原因を修正、スキル説明内のRIIC用語クリックポップアップ（79種）。'),
  ('2026-07-25', 'improve', 5, '/stories',
   '스토리 — 본문의 점선 밑줄 단어를 누르면 인물·용어 팝오버가 뜹니다. 화자와 스탠딩 CG가 어긋나던 장면도 전수 정정했습니다.',
   'Story — tap dotted-underlined words in the text for character/term popovers. Also fixed every scene where the speaker and standing CG were mismatched.',
   'ストーリー — 本文の点線下線の単語を押すと人物・用語ポップオーバーが表示。話者と立ち絵CGがずれていた場面も全数修正しました。'),
  ('2026-07-24', 'improve', 0, '/rogue',
   '통합전략 가이드 — 사미 암호판을 보유 리스트 수집 자원으로, 붕괴 패러다임을 1·2단계 카드로, 조우 트리를 큐레이션했습니다.',
   'Integrated Strategies guide — Sami runestones are now a collectible resource in the inventory, Collapsal Paradigms show stage 1/2 cards, and the encounter tree is curated.',
   '統合戦略ガイド — サーミの符呪を所持リストの収集資源に、崩壊パラダイムを1・2段階カードに、遭遇ツリーをキュレーション。'),
  ('2026-07-24', 'improve', 1, '',
   '스크린샷 스캐너가 iPad(4:3) 화면도 인식합니다.',
   'The screenshot scanner now recognizes iPad (4:3) screens too.',
   'スクリーンショットスキャナーがiPad（4:3）画面にも対応。'),
  ('2026-07-24', 'improve', 2, '/infra',
   '인프라 자동편성기 — 왕 ''임기응변''의 외세·실리 분기, 왕 착석→슈 해방 교차방 사슬 평가 등 편성 정확도를 올렸습니다.',
   'Base planner — improved assignment accuracy: Ling''s "Improvisation" faction branching, cross-room chains like seating Ling to free Shu, and more.',
   '基地自動編成 — リィンの「臨機応変」の勢力分岐、リィン着席→シュー解放のクロスルーム連鎖評価など編成精度を向上。')
) as v(released_at, kind, seq, href, ko, en, ja)
where not exists (
  select 1 from public.changelog c where c.released_at = v.released_at::date and c.ko = v.ko
);
