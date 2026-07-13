# 테라 아카이브 (Terra Archive)

명일방주(Arknights) 한국 서버 팬사이트 — https://terra-archive.pages.dev

- **오퍼 백과사전** — 전 오퍼레이터 스탯·스킬·모듈·인프라 스킬 + 컨셉덱/진영/태그 필터, 커뮤니티 별명 검색
- **인프라 플래너** — 보유 오퍼 기반 기반시설(RIIC) A/B조 자동 편성 최적화
- **공채 도우미** — 공개모집 태그 조합 계산기 (4·5성 저격 조합 사전 포함)

## 스택

vinext(Cloudflare용 Next 호환 런타임) + React 19 + Tailwind 4, Cloudflare Pages 배포.
데이터는 API 없이 `app/data/*.json` 정적 파일 (클뜯 레포에서 `scripts/` 파이프라인으로 재생성).
공식 방송 일정만 별도 크론 워커(`workers/broadcast/`)가 유튜브에서 자동 수집.

## 명령

```bash
npm run dev     # localhost:3000
npm run build   # 빌드 확인
npm run lint
bash scripts/deploy.sh              # 사이트 배포 (Cloudflare Pages) — 사용자가 직접 실행
bash workers/broadcast/deploy.sh    # 방송 수집 워커 배포
```

## 문서

- [docs/PROJECT-GUIDE.md](docs/PROJECT-GUIDE.md) — 전체 규칙·데이터 출처·파이프라인 정본
- [docs/INFRA-RULES.md](docs/INFRA-RULES.md) — 인프라 플래너 도메인 규칙
- [scripts/README.md](scripts/README.md) — 데이터 갱신 파이프라인
