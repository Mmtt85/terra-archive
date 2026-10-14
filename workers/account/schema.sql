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
