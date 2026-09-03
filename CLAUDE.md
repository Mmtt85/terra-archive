# 테라 아카이브 (명일방주 KR 팬사이트)

**전체 규칙·데이터 출처·파이프라인 정본: [docs/PROJECT-GUIDE.md](docs/PROJECT-GUIDE.md)** —
작업 전 반드시 읽을 것. 인프라 플래너 도메인 규칙은 [docs/INFRA-RULES.md](docs/INFRA-RULES.md),
데이터 갱신 명령은 [scripts/README.md](scripts/README.md),
무인 유지보수 자동화(GitHub Actions)는 [docs/AUTOMATION.md](docs/AUTOMATION.md).

## 필수 수칙

- 수정 후 **빌드 확인 → 커밋 → git push 까지만** 진행하고 멈춘다.
  **`bash scripts/deploy.sh`는 자동 실행 금지** (2026-07 규칙) — 세션마다 자동 배포하면 토큰이 낭비되므로,
  배포는 사용자가 변경분을 모아 직접 돌린다. 배포 URL: https://terra-archive.pages.dev (Cloudflare Pages, wrangler 로그인됨).
  단, `docs/AUTOMATION.md`의 GitHub Actions 무인 파이프라인은 **진짜 데이터가 바뀔 때만** 배포하는
  승인된 별개 경로다 (이 규칙은 대화형 세션에만 적용).
- 데이터는 API가 아니라 `app/data/*.json` 정적 파일. 손으로 고치지 말고
  `scripts/`의 파이프라인으로 재생성한다 ("새 버전 확인해줘" = PROJECT-GUIDE §3 절차).
  KR 데이터를 재생성하면 **`build-i18n.py`로 EN/JA 데이터도 함께 재생성**한다.
- **점검일에는 스킬을 쓴다** — 손으로 꿰면 매번 빠뜨린다 (CI가 축약해 도는 무거운 단계인
  적 초상·도면·스킨·통합전략을 로컬에서 따로 돌려야 한다).

  | 서버 | 큰 패치 | 작은 패치 |
  |---|---|---|
  | 한국 | `kr-big-patch` (오전 10시~오후 4시, 몇 달치가 한 번에) | `kr-small-patch` (오후 4시~4시 10분, 해금만) |
  | 중국 | `cn-big-patch` (停机更新 — **클라 버전이 오른다**) | `cn-small-patch` (闪断更新 — 한국시간 17시~17시 10분) |

  중섭은 **미래시(선행 정보) 전용**이라 14표만 받고, 중섭 이벤트가 열려도 사이트는 그대로인
  게 정상이다 — 반영되는 건 한섭에 언젠가 넘어올 오퍼·재료·모듈·스킨뿐.
- **`ci-refresh.sh`는 `SKIP_FETCH=1`로 돌린다** (CDN에서 받아 온 뒤라면). 안 그러면 맨 앞의
  `fetch-gamedata.py`가 클뜯 레포판으로 **방금 받은 최신 데이터를 덮어쓴다** — 레포는 며칠씩
  밀려서(실측 11일) 조용히 옛 데이터로 사이트가 만들어진다. 무인 CI는 기본값 그대로 둔다.
- 사이트는 3개 언어(`/` 한국어 · `/en` · `/ja`). UI의 **한국어 문구를 수정하면
  `app/i18n.tsx` 사전의 같은 키도 함께 수정**해야 EN/JA 번역이 유지된다 (PROJECT-GUIDE §1).
- **데이터는 게임 CDN에서 직접 받는다** (`scripts/fetch-gamedata-cdn.py`, 2026-09-02~) —
  인게임 업데이트와 동시에 손에 들어온다. 절차는 `gamedata-pull` 스킬, 원리는 PROJECT-GUIDE §2-1.
  클뜯 레포 `ArknightsAssets/ArknightsGamedata`는 사람이 돌려야 올라와서 몇 시간~며칠 밀리므로
  (실측 11일) **`range_table` 폴백과 스키마 수리용 정답지로만** 쓴다.
  Kengxxiao 레포는 죽었음(2025-11) — 사용 금지.
- 사용자가 교정해준 도메인 규칙(가짜 게스트 오퍼 제외, KR 출시순 seq, 시너지 팟 판정,
  인프라 buffChar 슬롯 규칙 등)은 PROJECT-GUIDE/INFRA-RULES에 기록되어 있다 — 어기지 말 것.
  새 규칙이 확정되면 해당 문서와 도움말 모달을 함께 갱신한다.
