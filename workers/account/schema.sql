-- 사이트 설정 동기화 D1 (2026-10-15 — KV 무료 쓰기 하루 1,000번이 모자라 옮김. D1 무료는 하루 10만 줄)
-- 적용: npx wrangler d1 execute terra-archive-prefs --remote --file schema.sql   (deploy.sh 처럼 루트 .wrangler/deploy/config.json 을 잠시 치울 것)

-- 계정(owner = "p:<서버>:<UID>") × localStorage 키 하나가 한 줄. t = 그 키를 마지막으로 고친 시각(ms) — 키마다 나중 것이 이긴다
create table if not exists prefs (
  owner text not null,
  k text not null,
  t integer not null,
  d text,
  primary key (owner, k)
) without rowid;

-- 하루(UTC)별 쓰기 — 관리 화면 방문 통계에 '설정 저장소 쓰기 오늘 N / 100,000' 으로 (D1 한도는 줄 단위라 rows 를 센다)
create table if not exists usage (
  day text primary key,
  puts integer not null default 0,
  deletes integer not null default 0,
  rows integer not null default 0
);

-- 친구 매칭 (2026-10-20) — 내 정보에서 '매칭 등록'을 켠 계정만 한 줄. 닉네임은 여기에만, 등록을 끄면 줄째 즉시 삭제
create table if not exists match (
  owner text primary key,          -- p:<서버>:<UID>
  server text not null,
  uid text not null,
  nick text,                       -- 닉네임#번호 (등록한 사람만)
  level integer,
  assist text,                     -- 지원 오퍼 3명 JSON (정예화·레벨·잠재·스킬·특화·모듈)
  friends integer,                 -- 친구 수
  flimit integer,                  -- 친구 상한
  t integer not null,              -- 마지막 동기화(갱신) 시각 ms
  created integer not null,        -- 등록 시각 ms
  sec text,                        -- 부관 오퍼 id — 목록 카드 배경 (2026-10-20 추가: alter table match add column sec text)
  sec_skin text,                   -- 부관 스킨 id (같은 날 추가: alter table match add column sec_skin text)
  resume text                      -- 상태 문구 (같은 날 추가: alter table match add column resume text)
) without rowid;
create index if not exists match_server_t on match (server, t desc);

-- 친구 매칭 기록 (2026-10-20) — 관리 사이트 '친구 찾기' 탭의 등록·취소 추이와 많이 찾은 오퍼. 누가 했는지는 안 남긴다
create table if not exists match_log (
  at integer not null,             -- ms
  kind text not null,              -- put · delete · search
  server text,
  op text                          -- search 때 찾은 오퍼 id
);
create index if not exists match_log_at on match_log (at);
