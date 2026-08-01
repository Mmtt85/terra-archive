---
name: operator-data-update
description: 명일방주 KR 신규 오퍼레이터 데이터·아바타(썸네일)를 클뜯 레포에서 받아 operators.json/infra.json을 재생성한다. "새 버전 확인해줘", "신규 오퍼 갱신", "오퍼 데이터 뜯어와" 같은 요청에 사용.
---

# 오퍼레이터 데이터 + 아바타 갱신

`app/data/operators.json`·`infra.json`과 `public/avatars/`를 클뜯 레포에서 재생성한다.
**데이터는 손으로 고치지 않고 반드시 이 파이프라인으로 재생성한다.** 상세는 [scripts/README.md](../../../scripts/README.md), 도메인 규칙은 [docs/PROJECT-GUIDE.md](../../../docs/PROJECT-GUIDE.md) §3 / [docs/INFRA-RULES.md](../../../docs/INFRA-RULES.md).

## 데이터 소스 (중요)

- **`ArknightsAssets/ArknightsGamedata` 레포, `kr` 폴더, `master` 브랜치.** raw 경로:
  `https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/kr/gamedata/excel/<파일>.json`
  (upstream 파일에는 `kr_` 접두사가 없음 — 받은 뒤 `kr_<name>.json`으로 저장.)
- **Kengxxiao 레포는 죽었음(2025-11) — 절대 사용 금지.**

## 절차

1. **신규 오퍼 확인**: `node scripts/check-new-operators.mjs` — 미수록 오퍼레이터 목록 출력. 없으면 여기서 종료.
2. **게임 데이터 다운로드** → 스크래치 폴더(예: `.gamedata/`)에 저장:
   - `kr/gamedata/excel/`에서: `character_table`, `skill_table`, `uniequip_table`, `battle_equip_table`, `building_data`, `range_table`, `handbook_team_table`, `handbook_info_table`, `gacha_table` → 각각 `kr_<name>.json`으로.
   - 별명(다국어)용: `jp_character_table.json`, `cn_character_table.json`.
   - **EN/JA 사이트 데이터용**: `en/`·`jp/` 폴더에서 같은 테이블 세트(range 제외)를 `en_<name>.json`·`jp_<name>.json`으로.
3. **재생성은 손으로 스크립트를 나열하지 말고 파이프라인을 쓴다** — 무인 레인과 같은 경로라
   빠뜨리는 단계가 없다:
   ```bash
   bash scripts/ci-refresh.sh          # 전체(=all). 도감만 급하면 `fast`, 나머지는 `rest`
   ```
   fast(~57초) = 오퍼 데이터·EN/JA·아바타·**스킬 레벨**·**프로필**,
   rest(~7분) = 인프라·회귀검증·공채·파밍·비용·스토리·**보이스**·**스킨 메타**.
   ⚠ 굵게 표시한 **오퍼당 지연 로딩 파일 4종**은 2026-08-01까지 파이프라인에서 빠져 있었다.
   그 탓에 신규 오퍼의 상세 모달에 레벨 탭·프로필·대사가 통째로 비어 있었다 — 개별 스크립트를
   손으로 돌릴 거면 이 넷을 절대 빼먹지 말 것(`build-skins`는 `--meta-only`).
4. **R2 동기화 — 빼먹으면 사이트에서 404다.**
   ```bash
   node scripts/r2-sync.mjs
   ```
   `public/`의 에셋(아바타·스킬 레벨·프로필·보이스·스킨)은 전부 R2가 서빙한다.
   로컬에 파일이 있어도 R2에 없으면 **섬네일이 안 뜨고 레벨 탭이 안 나온다**(2026-08-01 실제 발생).
   무인 레인은 `deploy.sh`가 대신 돌리지만 `R2_SYNC_KEY` 시크릿이 있어야 한다.
5. **신규 오퍼 색상**: `regen-operators.py`의 `NEW_ACCENTS`에 accent 색을 추가(빠지면 카드 색이 기본값).
6. **미실장(CN 선행) 오퍼면 번역이 남는다** — `regen-operators`와 `build-profiles`가 각각
   미번역 분량을 경고로 낸다. `scripts/cn-translations.json`에 채운다(`/cn-translation-fill`).
   · 스킬 문구는 **번역문에서 수치 자리를 되찾아** 레벨별 템플릿을 만든다. 숫자를 빠뜨리거나
     CN과 순서를 바꾸면 그 스킬은 레벨 탭에서 문구가 안 바뀐다.
   · 프로필은 KR·CN 양쪽에 있는 오퍼 415명에서 **공식 번역을 자동 수확**하므로 정형 구간
     (기본정보·종합검진 등)은 손댈 필요가 없다. 산문만 채우면 된다.
7. **검증은 R2를 물린 상태로**. Playwright `route()`로 로컬 파일을 가로채면 **거짓 통과**가
   난다 — 실제 사이트는 R2의 옛 파일을 쓴다. `r2-sync` 뒤 가로채기 없이 확인할 것.
8. **검증**: 재생성 전후를 `git diff`로 비교해 **의도한 신규 오퍼만** 바뀌었는지 확인. 기존 항목이 대량으로 흔들리면 파서 회귀 — 원인 파악 후 진행.
9. **빌드 → 커밋 → 푸시까지만**. **`scripts/deploy.sh` 자동 실행 금지**(2026-07 규칙, PROJECT-GUIDE 참고) — 배포는 사용자가 직접.

## 지켜야 할 도메인 규칙 (사용자 확인, 어기지 말 것)

- 중복 정리: 같은 이름이면 획득 가능 우선 → 낮은 char 번호. 가짜 게스트/예비 인원 오퍼 제외.
- 인프라 buffChar **슬롯 구조**로 강화/신규 판정(이름 휴리스틱 금지). 자세한 규칙은 INFRA-RULES.md.
- 태그·컨셉 규칙, 생산력 제로아웃 오퍼, 조건부 메커니즘 일반화 등은 INFRA-RULES.md와 메모리에 기록됨.
