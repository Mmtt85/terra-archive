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
3. **재생성 + 태그** (스크래치에 출력 후 복사):
   ```bash
   python3 scripts/regen-operators.py .gamedata   # → operators-regen.json
   python3 scripts/retag-concepts.py .gamedata    # → operators-tagged.json
   cp <scratch>/operators-tagged.json app/data/operators.json
   python3 scripts/build-infra.py .gamedata       # → app/data/infra.json
   python3 scripts/build-i18n.py .gamedata        # → operators.{en,ja}.json + extra-i18n.{en,ja}.json (KR 재생성 후 필수)
   ```
4. **아바타(썸네일) 다운로드**: `python3 scripts/download-avatars.py` — 빠진 `public/avatars/<char_id>.png`를 `yuanyan3060/ArknightsGameResource`에서 받는다(있으면 건너뜀, 실패 시 종료코드 1). 데이터의 `image` 필드는 `/avatars/…` 경로.
5. **신규 오퍼 색상**: `regen-operators.py`의 `NEW_ACCENTS`에 accent 색을 추가(빠지면 카드 색이 기본값).
6. **검증**: 재생성 전후를 `git diff`로 비교해 **의도한 신규 오퍼만** 바뀌었는지 확인. 기존 항목이 대량으로 흔들리면 파서 회귀 — 원인 파악 후 진행.
7. **빌드 → 커밋 → 푸시까지만**. **`scripts/deploy.sh` 자동 실행 금지**(2026-07 규칙, PROJECT-GUIDE 참고) — 배포는 사용자가 직접.

## 지켜야 할 도메인 규칙 (사용자 확인, 어기지 말 것)

- 중복 정리: 같은 이름이면 획득 가능 우선 → 낮은 char 번호. 가짜 게스트/예비 인원 오퍼 제외.
- 인프라 buffChar **슬롯 구조**로 강화/신규 판정(이름 휴리스틱 금지). 자세한 규칙은 INFRA-RULES.md.
- 태그·컨셉 규칙, 생산력 제로아웃 오퍼, 조건부 메커니즘 일반화 등은 INFRA-RULES.md와 메모리에 기록됨.
