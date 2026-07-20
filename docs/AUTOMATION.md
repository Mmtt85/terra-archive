# 무인 유지보수 자동화

클뜯 데이터 갱신·신규 오퍼·이벤트 시작을 **하루 두세 번 자동 감지**해, 사람 없이도
사이트가 최신으로 유지되게 하는 GitHub Actions 파이프라인. 세션을 안 열어놔도 돌아간다.

## 두 레인

| 레인 | 워크플로 | 하는 일 | 발행 |
|---|---|---|---|
| 🟢 결정론 | `data-refresh.yml` | 오퍼/공채/파밍/인프라/육성비용/스토리목록/EN·JA 재생성 | 진짜 변동 시 자동 커밋·배포 |
| 🟡 LLM | `content-auto.yml` | 시작된 신규 이벤트의 AI 스토리 요약 집필·번역 | 빌드+자체검증 통과 시 자동 커밋·배포 |

- **결정론 레인**은 LLM이 필요 없다. `git diff`가 곧 변경 감지기다 — 파이프라인을 돌려
  진짜 데이터가 바뀐 게 있을 때만(=`updated` 날짜만 바뀐 건 무시) 커밋·배포한다.
  방송·이벤트 시작 배지는 이미 크론 워커+런타임 계산이라 리빌드가 필요 없다.
- **LLM 레인**은 "시작됐는데 요약이 없는 이벤트"만 감지해 Claude가 집필한다. 배포 전
  `npm run build` 통과와 Claude 자체 환각검증을 게이트로 둔다.
- 인프라 시너지/컨셉 태그 같은 **사람이 교정해온 도메인 규칙**은 자동 집필하지 않는다 —
  신규 오퍼가 잡히면 결정론 레인이 이메일 경고로 알려주고, 판단은 사람이 한다.

## 스케줄 (UTC)

- `08:00`(17:00 KST) · `13:00`(22:00 KST) — KR 데이터 리프레시 2회
- `04:00`(12:00 CST) — CN(미래시) 데이터 리프레시 1회
- `14:00`(23:00 KST) — LLM 요약 집필 1회

수동 실행: 각 워크플로 Actions 탭 → **Run workflow** → `dry_run` 체크하면 커밋·배포 없이
리포트/집필만 하고 이메일만 보낸다. **처음엔 반드시 dry_run으로 한 번 돌려볼 것.**

## 비용

레포가 public이라 **GitHub Actions는 무제한 무료**. Cloudflare Pages 배포도 무료.
LLM 레인은 `CLAUDE_CODE_OAUTH_TOKEN`(구독 토큰)을 써서 API 종량 과금이 아니라 기존
Claude 구독 쿼터를 소모한다 → **추가 요금 0**.

## 필요한 저장소 시크릿

`Settings → Secrets and variables → Actions → New repository secret`에서 등록:

| 시크릿 | 용도 | 발급 방법 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Pages 배포 | My Profile → API Tokens → **Create Custom Token**(Pages 전용 템플릿은 없음) → Permissions에 `Account · Cloudflare Pages · Edit` 추가 → Account Resources는 본인 계정 Include → Create |
| `CLOUDFLARE_ACCOUNT_ID` | Pages 배포 | Cloudflare 대시보드 우측 사이드바 Account ID |
| `CLAUDE_CODE_OAUTH_TOKEN` | 헤드리스 Claude(무과금) | 로컬에서 `claude setup-token` 실행 → 출력 토큰 |
| `MAIL_USERNAME` | 이메일 발신 | Gmail 주소 |
| `MAIL_PASSWORD` | 이메일 발신 | Gmail 2단계인증 후 [앱 비밀번호](https://myaccount.google.com/apppasswords) 발급 |
| `MAIL_TO` | 이메일 수신 | 리포트 받을 주소 (발신과 같아도 됨) |

시크릿을 다 넣기 전엔 워크플로가 해당 단계에서 조용히 실패한다 — 배포/메일 시크릿부터 넣을 것.

## deploy.sh 자동 실행 규칙과의 관계

CLAUDE.md의 "`bash scripts/deploy.sh` 자동 실행 금지"는 **대화형 Claude 세션**이 매번 배포해
토큰을 낭비하지 말라는 규칙이다. 이 CI 파이프라인은 그와 별개로, **진짜 데이터가 바뀔 때만**
배포하는 승인된 무인 경로다. 세션에서 손으로 돌리는 배포 습관은 여전히 금지.

## 사람 손이 필요한 일 = 스킬 하나 딸깍 (`/terra-maintain`)

도메인 판단이 필요해 자동화하지 않은 일은 **전용 스킬**로 정리돼 있다. 하지만 독타가 여러 개를
직접 고를 필요는 없다 — 메일이 오면 **`/terra-maintain` 스킬 하나만** 실행하면, 그 스킬이
밀린 항목을 감지해 필요한 하위 스킬을 알아서 골라 실행한다.

| 이메일이 지목하는 항목 | (자동 호출되는) 하위 스킬 | 하는 일 |
|---|---|---|
| 요약 없는 신규 이벤트 | `story-summary` | 전문 스크립트+AI 요약+번역 (평소엔 content-auto가 자동) |
| 테라 연대기 미등록 N건 | `chronicle-register` | chronology.json에 테라력·테마 아크 등록 |
| 신규 오퍼 인프라 시너지 검토 | `planner-synergy-review` | 새 시너지 팟/토큰/오분류를 rules.json에 반영 |
| CN 신규 텍스트 번역 (未/译 경고) | `cn-translation-fill` | cn-translations.json에 비공식 번역 채우기 |
| 새 통합전략(록라) 토픽 | `rogue-guide` | 엔딩·보스층·조우 트리 큐레이션 |

- **AI 스토리 요약**은 자동(content-auto 레인)이라 스킬 실행 불필요 — 다만 첫 신규 이벤트 땐
  dry_run으로 결과를 한 번 지켜볼 것.
- 리포트가 조용하면(메일 안 오면) 손댈 것 없음. 뭔가 필요하면 반드시 메일이 오고, 어떤 스킬을
  돌릴지까지 적혀 있으므로 **누락되는 수작업은 없다**.
