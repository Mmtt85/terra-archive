---
name: broadcast-check
description: 명일방주 공식 방송 자동 수집 시스템(크론 워커) 점검 및 유튜브 외 공지 방송의 수동 보완. "방송 확인해줘", "방송 배지 이상해", "방송 일정 갱신" 같은 요청에 사용.
---

# 명일방주 공식 방송 일정 — 자동 시스템 점검·보완

## 현재 구조 (2026-07 자동화 완료 — 수동 갱신은 보완용)

방송 수집은 **Cloudflare 크론 워커가 전자동**으로 처리한다. 매일 반복하던 수동 체크는 더 이상 필요 없다.

- **워커**: `workers/broadcast/` → `terra-archive-broadcast` (nzkonaru 계정, 6시간마다 크론 `23 */6 * * *`)
  - 유튜브 공식 채널 3개(KR `UCnnbUv4urnbWgb_lgGUfeBw` / JP `UCvoQlzEzqa6vQA8hq9GNNug` / GL `UCR0J2NYGuC8epsa1O4DMmXQ`)에서
    ① search(eventType=upcoming/live)로 예약·라이브, ② 업로드 재생목록 스캔으로 종료된 생방송을 수집
    (KR 생방송이 completed 검색 인덱스에 안 잡히는 사례가 있어 재생목록 방식 사용).
  - YouTube Data API 키는 워커 secret `YOUTUBE_API_KEY` (코드·git에 없음). 쿼터 일 ~2,420/10,000.
  - 결과는 KV(binding BCAST)에 저장, **GET https://terra-archive-broadcast.nzkonaru.workers.dev/** 로 서빙 (CORS 허용, 5분 캐시).
- **프론트**: `BroadcastBadges`(app/page.tsx)가 워커 API를 fetch, 실패 시 `app/data/broadcasts.json` 폴백.
  원격·정적 중복은 videoId(없으면 서버+UTC날짜)로 제거하고 원격 우선. 상태(예약/생방송/지난방송)는 클라이언트가 시각 비교로 계산.
- **워커 배포**: `bash workers/broadcast/deploy.sh` (루트 vinext 빌드 산출물과의 wrangler 설정 충돌을 우회함).
  워커 배포는 사이트 배포 금지 규칙과 별개지만, 사용자에게 한 줄 보고할 것.

## 이 skill이 하는 일

1. **점검**: `curl -s https://terra-archive-broadcast.nzkonaru.workers.dev/` 로 데이터가 최신인지(`updated` 시각, 최근 방송 포함 여부) 확인. 이상하면 워커 로그(`npx wrangler tail terra-archive-broadcast`)·쿼터를 확인.
2. **수동 보완**: 유튜브에 예약 영상이 아직 안 올라오고 **트위터/공지로만 알려진 방송**은 자동 수집이 못 잡는다 → `app/data/broadcasts.json`에 수동 추가 (start는 오프셋 포함 ISO8601, 예: `+09:00`; 유튜브 링크가 생기면 `url`을 `watch?v=ID`로). 웹 검색 소스: KR arca.live 공지/@ArknightsKorea, JP 4Gamer·電撃, GL wiki.gg Livestreams.
3. **KV 강제 갱신**: `npx wrangler kv key delete broadcasts --namespace-id=b6445de857bc40fc83595aa8132ccd75 --remote` 후 엔드포인트 curl 한 번 (KV 비면 즉석 재수집).

## 규칙

- 정적 JSON의 지난 방송 항목은 지우지 않는다 (원격과 중복되면 화면에서 자동 제거됨).
- 사이트 코드 수정 시 **빌드 → 커밋 → 푸시까지만** (`scripts/deploy.sh` 자동 실행 금지, PROJECT-GUIDE 참고).
- 보고: 세 서버별 현재 상태(예약 D-N / 생방송 중 / 마지막 방송 날짜)를 짧은 표로 요약.
