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
python3 scripts/build-infra.py .gamedata      # → app/data/infra.json (방 스펙 + 스킬 수치·시너지 파싱)
python3 scripts/build-recruit.py .gamedata    # → app/data/recruit.json (공채 태그 31종 + 모집 풀)
python3 scripts/download-avatars.py           # 신규 오퍼 아바타를 public/avatars/에 다운로드
```

공채 데이터는 `kr_gacha_table.json`(추가 다운로드 필요: `kr/gamedata/excel/gacha_table.json`)의
`recruitDetail` 텍스트에서 풀을 파싱하고, 성별 태그(남성/여성)는 핸드북 프로필의 `[성별]`에서 뽑는다.
5성→특별 채용, 6성→고급 특별 채용 자격 태그는 성급에서 자동 부여.

- 신규 오퍼레이터의 `accent` 색상은 `regen-operators.py`의 `NEW_ACCENTS`에 추가한다.
- 커뮤니티 별명은 기존 JSON의 aliases에서 자동 보존된다(새로 추가하려면 데이터에 직접).
- 출신지·종족은 handbook에서 파싱하며 로봇·예비 인원은 "불명" 처리된다.
