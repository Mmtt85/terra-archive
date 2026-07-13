---
name: broadcast-check
description: 명일방주(Arknights) 한국·일본·글로벌 공식 생방송 일정을 웹에서 확인해 app/data/broadcasts.json을 갱신한다. "방송 확인해줘", "방송 일정 갱신", "생방송 예약 있어?" 같은 요청에 사용.
---

# 명일방주 공식 방송 일정 체크

테라 아카이브 헤더의 방송 배지를 채우는 `app/data/broadcasts.json`을 최신 상태로 유지하는 절차. 매일 반복 실행하는 것을 전제로 한다.

## 배경 — 어떻게 동작하나

- 사이트는 정적(static)이라 실시간 API가 없다. **방송 일정만 JSON에 넣어두면**, 헤더의 `BroadcastBadges`(app/page.tsx)가 현재 시각과 비교해 상태를 **자동 계산**한다:
  - `now < start` → `◷ 예약됨` (D-N / N시간 후 / 곧 시작)
  - `start ≤ now ≤ start+durationMin` → `● 생방송 중` (빨간색 깜빡임)
  - 그 이후 → `▶ 지난 방송` (방송 날짜 표시). **지난 방송도 계속 남긴다 — 지우지 않는다.**
- 헤더엔 가장 중요한 방송(생방송>가까운 예약>최근 지난방송) 요약 배지 하나만 뜨고, 클릭하면 **전체 목록 모달**(유튜브 썸네일·날짜·서버·상태)이 열린다.
- 상태 전환은 시간이 알아서 처리한다. **새 방송이 확정될 때만** 이 파일에 항목을 추가하면 된다.
- 공식 방송은 전부 유튜브다. **썸네일은 `https://i.ytimg.com/vi/<videoId>/hqdefault.jpg`에서 자동으로 받아온다** — `url`을 `watch?v=<ID>`/`youtu.be/<ID>`/`/live/<ID>` 형태로 넣거나 `videoId`를 채우면 썸네일이 뜬다. 채널 `/streams` URL만 있으면 썸네일 없이 표시된다.

## 절차

1. **세 서버의 공식 방송 예정을 웹에서 확인** (WebSearch/WebFetch). 신뢰 소스 우선:
   - 한국(kr): 명일방주 KR 공식 유튜브 `@Arknights_KR_Official`, 공식 X `@ArknightsKorea`, arca.live 명일방주 채널 공지
   - 일본(jp): 공식 유튜브 `@ArknightsStaff_JP/streams`, 4Gamer/電撃/Gamer 방송 예고 기사
   - 글로벌(global): 공식 유튜브 `@ArknightsOfficialYostar/streams`, arknights.wiki.gg `Livestreams/EN-<연도>`
   - 검색 예: `명일방주 공식 방송 예정`, `アークナイツ 生放送 予定`, `Arknights livestream schedule <연도>`
2. **확정된(날짜·시각이 공지된) 방송만** 추가한다. "곧 있을 예정" 수준의 미확정 루머는 넣지 않는다.
3. **시각은 반드시 오프셋 포함 ISO8601**로 적는다. 한국·일본 = `+09:00`, 글로벌 EN = 대개 `-07:00`(PT). 시각을 모르면 공지된 현지 시각 그대로 오프셋만 맞춰 기입.
4. `app/data/broadcasts.json`을 갱신:
   - 새 방송 객체 추가 (`server`, `title`, `start`, `durationMin`(기본 120~150), `url`).
   - `updated` 날짜를 오늘로.
   - 종료된 방송은 남겨둬도 자동으로 숨겨지므로 굳이 지우지 않는다(파일이 길어지면 3일 넘은 것 정리 가능).
   - `server`는 `kr` / `jp` / `global` 중 하나여야 배지 국가 라벨(KR/JP/GL)이 붙는다.
5. **빌드 → 커밋 → 푸시**까지만 한다. **`scripts/deploy.sh`는 실행하지 않는다** (사용자 규칙: 세션마다 자동 배포 금지 — 배포는 사용자가 모아서 직접 함). PROJECT-GUIDE 참고.

## 데이터 형식 예시

```json
{
  "updated": "2026-07-13",
  "broadcasts": [
    { "server": "kr", "title": "6.5주년 특별 방송", "start": "2026-07-12T13:00:00+09:00", "durationMin": 150, "url": "https://www.youtube.com/watch?v=..." }
  ]
}
```

## 보고

갱신 후 사용자에게 세 서버별 현재 상태(예약 D-N / 생방송 중 / 최근 종료 / 예정 없음)를 표로 간단히 요약한다.
