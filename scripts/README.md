# 데이터 파이프라인

명일방주 새 버전이 나오면 클뜯 레포에서 데이터를 받아 `app/data/operators.json`을 갱신한다.

## 1. 신규 오퍼레이터 확인

```bash
node scripts/check-new-operators.mjs
```

KR 최신 `character_table`과 로컬 JSON을 비교해 미수록 오퍼레이터를 출력한다.

## 2. 게임 데이터 다운로드

`ArknightsAssets/ArknightsGamedata` 레포(자동 클뜯, kr 폴더)에서 아래 테이블을 받아 한 폴더(예: `.gamedata/`)에 저장:

- `kr_character_table.json`, `kr_skill_table.json`, `kr_uniequip_table.json`,
  `kr_battle_equip_table.json`, `kr_building_data.json`, `kr_range_table.json`,
  `kr_handbook_team_table.json`, `kr_handbook_info_table.json` ← `kr/gamedata/excel/*.json`
- `jp_character_table.json`, `cn_character_table.json` ← 별명(다국어 이름)용
- **다국어(EN/JA) 사이트 데이터용**: `en/`·`jp/` 폴더에서도 같은 테이블 세트를
  `en_<name>.json`·`jp_<name>.json`으로 저장 (character/skill/uniequip/battle_equip/
  building/handbook_team/handbook_info/gacha — range는 불필요)

이미지는 로컬 `public/avatars/<char_id>.png`에서 서빙한다 (데이터의 `image`는 `/avatars/…` 경로).
신규 오퍼레이터가 생기면 `python3 scripts/download-avatars.py`로 빠진 아바타를
`yuanyan3060/ArknightsGameResource`에서 내려받는다 (이미 있는 파일은 건너뜀, 실패 시 종료코드 1).

## 3. 재생성 + 태그

```bash
python3 scripts/regen-operators.py .gamedata   # 기계 필드 전체 재생성 → operators-regen.json
python3 scripts/retag-concepts.py .gamedata    # 스킬·재능·특성 기반 컨셉 태그 → operators-tagged.json
cp <scratch>/operators-tagged.json app/data/operators.json
```

데이터 갱신 후 인프라 플래너용 구조화 데이터도 재생성한다:

```bash
python3 scripts/build-infra.py .gamedata      # → app/data/infra.json (방 스펙 + 스킬 수치·시너지 파싱 + buffId)
python3 scripts/build-recruit.py .gamedata    # → app/data/recruit.json (공채 태그 31종 + 모집 풀)
python3 scripts/build-i18n.py .gamedata       # → app/data/operators.{en,ja}.json + extra-i18n.{en,ja}.json
python3 scripts/download-avatars.py           # 신규 오퍼 아바타를 public/avatars/에 다운로드
```

## 4. 다국어(EN/JA) 사이트 데이터

사이트는 `/`(한국어)·`/en`·`/ja` 세 경로로 서빙되며, EN/JA 게임 텍스트는
`scripts/build-i18n.py`가 클뜯 레포의 `en/`·`jp/` 테이블에서 생성한다:

- `app/data/operators.en.json` / `operators.ja.json` — operators.json과 **같은 스키마**의
  전체 로컬라이즈본. id·성급·컨셉 태그(KR 키)·seq·accent·스탯 수치는 KR 정본을 복사하고
  텍스트(이름·스킬·재능·모듈·인프라·핸드북)만 해당 언어로 채운다. 로케일 테이블에 없는
  항목은 KR 텍스트로 폴백.
- `app/data/extra-i18n.en.json` / `.ja.json` — 인프라 플래너·공채 도우미 표시용 오버레이
  (오퍼 이름, infra.json의 buffId → 스킬명/설명, gacha tagId → 공채 태그명, 방 이름).
  플래너·공채의 **계산 엔진은 KR 데이터로만 돌고** 표시만 이 오버레이로 바꾼다.
- UI 문자열(버튼·안내문 등) 번역은 데이터가 아니라 `app/i18n.tsx`의 사전(D)에 있다 —
  한국어 원문이 키이므로 **KR 문구를 고치면 사전 키도 함께 고칠 것** (키가 없으면 KR로 폴백).

**operators.json/infra.json/recruit.json을 재생성했다면 build-i18n.py도 반드시 다시 실행**해
세 언어 데이터가 같은 오퍼 세트를 가리키게 한다.

공채 데이터는 `kr_gacha_table.json`(추가 다운로드 필요: `kr/gamedata/excel/gacha_table.json`)의
`recruitDetail` 텍스트에서 풀을 파싱하고, 성별 태그(남성/여성)는 핸드북 프로필의 `[성별]`에서 뽑는다.
5성→특별 채용, 6성→고급 특별 채용 자격 태그는 성급에서 자동 부여.

- 신규 오퍼레이터의 `accent` 색상은 `regen-operators.py`의 `NEW_ACCENTS`에 추가한다.
- 커뮤니티 별명은 기존 JSON의 aliases에서 자동 보존된다(새로 추가하려면 데이터에 직접).
- 출신지·종족은 handbook에서 파싱하며 로봇·예비 인원은 "불명" 처리된다.
