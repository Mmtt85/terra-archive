# 테라 아카이브 (Terra Archive)

명일방주(Arknights) 한국 서버 팬사이트 — https://terra-archive.net
한국어(`/`) · English(`/en`) · 日本語(`/ja`)

## 화면 (헤더 메뉴 순)

| 메뉴 | 경로 | 내용 |
|---|---|---|
| 홈 | `/` | 기능 타일 · 진행중 이벤트 |
| 인프라 자동편성기 | `/infra` | 보유 오퍼 기준 기반시설(RIIC) 교대 편성 최적화 |
| 도감 | `/operators` · `/enemies` · `/stages` · `/items` | 오퍼레이터 · 적 · 작전(도면·이동 경로) · 아이템 |
| 시뮬레이터 | `/recruit` · `/farm` · `/upgrade` · `/sim` | 공개채용 태그 조합 · 재료 파밍 효율 · 육성 비용 · 작전(적 이동 재생) |
| 가이드 | `/rogue` · `/ra` · `/autochess` · `/events` | 통합전략 · 생존연산 · 위수 협의 · 이벤트 |
| 스토리 | `/stories` | 이벤트 AI 요약 · 테라 연대기 · 리더기 |
| 소개 | `/about` | 기능 소개 |

중국 서버에 먼저 나온 오퍼·이벤트 등은 헤더의 **미래시** 토글로 미리 볼 수 있다.

## 스택·데이터

- vinext(Cloudflare용 Next 호환 런타임) + React 19 + Tailwind 4 → Cloudflare Pages.
- 데이터는 API 없이 `app/data/*.json` 정적 파일. **게임 CDN에서 직접 받아** `scripts/`
  파이프라인으로 재생성한다 (클뜯 레포 `ArknightsAssets/ArknightsGamedata`는 폴백용).
- 그림 등 큰 에셋은 Cloudflare R2(`files.terra-archive.net`), 제안 게시판·업데이트 내역은 Supabase.
- 데이터 갱신은 GitHub Actions(`data-refresh.yml`)가 점검 시간대에 CDN 버전을 감시하다가
  바뀌면 자동으로 커밋·배포한다 — [docs/AUTOMATION.md](docs/AUTOMATION.md).

## 명령

```bash
npm run dev                         # localhost:3000 — 상시 켜 둔다
npm run build                       # 배포할 때만
npm run lint
bash scripts/deploy.sh              # 본사이트 배포 (빌드 + R2 동기화 + Pages) — 사용자가 하라고 할 때만
bash scripts/deploy-admin.sh        # 관리자 사이트(admin.terra-archive.net) — 관리자 UI를 고쳤을 때만
```

## 워커 (사이트 배포와 별개 — 각자 `bash workers/<폴더>/deploy.sh`)

| 폴더 | 하는 일 |
|---|---|
| `workers/broadcast` | 진행중 이벤트 피드(`/`) + 관리자 데이터 점검(`/datacheck`). 이름은 2026-09-23에 걷어낸 방송 기능 시절 것 |
| `workers/account` | 요스타 계정 로그인 → 보유 오퍼 가져오기 |
| `workers/acroom` | 위수 협의 파티 공유 방 |
| `workers/upload` | R2 파일 저장소 (에셋 동기화·제안 첨부) |
| `workers/admin-api` | 관리자 사이트 API 프록시 (Cloudflare Access 뒤) |

## 문서

- [CLAUDE.md](CLAUDE.md) · [SESSION.md](SESSION.md) — 작업 규칙
- [docs/PROJECT-GUIDE.md](docs/PROJECT-GUIDE.md) — 전체 규칙·데이터 출처·파이프라인 정본
- [docs/INFRA-RULES.md](docs/INFRA-RULES.md) — 인프라 플래너 도메인 규칙
- [docs/AUTOMATION.md](docs/AUTOMATION.md) — 무인 데이터 갱신(GitHub Actions)
- [scripts/README.md](scripts/README.md) — 데이터 갱신 명령
