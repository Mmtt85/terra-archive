# 테라 아카이브 (명일방주 KR 팬사이트)

**전체 규칙·데이터 출처·파이프라인 정본: [docs/PROJECT-GUIDE.md](docs/PROJECT-GUIDE.md)** —
작업 전 반드시 읽을 것. 인프라 플래너 도메인 규칙은 [docs/INFRA-RULES.md](docs/INFRA-RULES.md),
데이터 갱신 명령은 [scripts/README.md](scripts/README.md).

## 필수 수칙

- 수정 후 **빌드 확인 → 커밋 → git push 까지만** 진행하고 멈춘다.
  **`bash scripts/deploy.sh`는 자동 실행 금지** (2026-07 규칙) — 세션마다 자동 배포하면 토큰이 낭비되므로,
  배포는 사용자가 변경분을 모아 직접 돌린다. 배포 URL: https://terra-archive.pages.dev (Cloudflare Pages, wrangler 로그인됨).
- 데이터는 API가 아니라 `app/data/*.json` 정적 파일. 손으로 고치지 말고
  `scripts/`의 파이프라인으로 재생성한다 ("새 버전 확인해줘" = PROJECT-GUIDE §3 절차).
- 데이터 소스는 `ArknightsAssets/ArknightsGamedata`(kr) 클뜯 레포.
  Kengxxiao 레포는 죽었음(2025-11) — 사용 금지.
- 사용자가 교정해준 도메인 규칙(가짜 게스트 오퍼 제외, KR 출시순 seq, 시너지 팟 판정,
  인프라 buffChar 슬롯 규칙 등)은 PROJECT-GUIDE/INFRA-RULES에 기록되어 있다 — 어기지 말 것.
  새 규칙이 확정되면 해당 문서와 도움말 모달을 함께 갱신한다.
