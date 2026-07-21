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
- `jp_character_table.json` ← 별명(다국어 이름)용
- **미래시(미실장) 오퍼용 CN 테이블 전체 세트**: `cn_<name>.json`으로 위와 같은 8종
  (character/skill/uniequip/battle_equip/building/range/handbook_team/handbook_info).
  regen-operators.py가 CN에만 있는 오퍼를 CN 테이블로 빌드해 `unreleased: true`
  플래그로 추가한다 — 이름은 영문 코드네임, 중국어 원명·한국어 통칭은 aliases
  (통칭은 스크립트의 `FUTURE_ALIASES`에서 관리). 헤더 '미래시 오퍼레이터 포함'
  체크로만 노출되며, 인프라 플래너·공채는 KR 데이터 기반이라 자동 제외된다.
- **미실장 텍스트 번역 (2026-07 도입)**: 미실장 오퍼의 상세 텍스트(특성·재능·스킬·
  잠재·모듈·기반시설·모집사유)는 ① regen-operators.py가 KR·CN 공존 오퍼 ~950명을
  CN 테이블로도 렌더링해 필드 단위로 짝지은 **CN→KR 자동 사전**(정형 문구 = 공식 번역)과
  ② **`scripts/cn-translations.json`** 수동 오버레이(`{cn원문: {ko,en,ja}}`, AI 비공식
  번역)로 한국어화한다. EN/JA는 build-i18n.py가 출시 오퍼의 KR→로케일 쌍을 수확 +
  같은 파일의 ko→en/ja 대응으로 채운다. build-costs.py도 미실장 재료 이름·설명에
  같은 파일을 쓴다. **새 CN 오퍼·재료가 잡히면 스크립트가 미번역 원문을 경고로
  출력한다 — AI(Claude)가 cn-translations.json에 번역을 채우고 재실행할 것.**
  UI에는 '비공식 AI 번역' 고지가 뜬다 (i18n.tsx).
  build-infra.py도 같은 방식(CN building_data 폴백 + buffId 조인 자동 사전 + 같은 수동
  파일)으로 미실장 오퍼를 infra.json에 `unreleased` 플래그로 수록한다 — 인프라 플래너는
  '미래시 데이터 포함' 토글이 켜져야 이들을 편성에 포함 (도메인 규칙: INFRA-RULES §9).
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
node scripts/verify-plan.mjs                  # 플래너 회귀 검증 — 정배 픽스처(rules.json) 전부 통과해야 커밋
node scripts/verify-stories.mjs               # 스토리 전수 렌더 검증 — 요약·전문을 실제 렌더해 진입 크래시 탐지 (요약/전문 데이터 수정 시)
python3 scripts/build-storylines.py .gamedata # → app/data/storylines.json (테마별 뷰 시계열 — stage_table storylines가 정본, 괄호=guest 참조)
python3 scripts/build-recruit.py .gamedata    # → app/data/recruit.json (공채 태그 31종 + 모집 풀)
python3 scripts/build-i18n.py .gamedata       # → app/data/operators.{en,ja}.json + extra-i18n.{en,ja}.json
python3 scripts/download-avatars.py           # 신규 오퍼 아바타를 public/avatars/에 다운로드
```

build-infra.py는 파서 추정 상수·토큰 카탈로그·파싱 교정(skillOverrides)을
`app/data/rules.json`(플래너 지식 베이스)에서 읽는다 — 파서가 새 문구를 오분류하면
정규식 패치 전에 skillOverrides 교정 행부터 고려할 것. 엔진 리팩토링 시엔
`node scripts/verify-plan.mjs --snapshot <f>` → 수정 → `--compare <f>`로 편성 무변화를
증명한다. 계층 설계는 docs/PLANNER-RULES-DB.md.

rules.json의 정본은 Supabase(원장 `planner_rules` + 발행 `rule_releases`)다 —
편집은 /admin '플래너 규칙' 탭에서 하고 발행 후 로컬에서 베이크한다:

```bash
python3 scripts/build-rules.py                # 최신 발행 스냅샷 → app/data/rules.json
                                              # (변경 섹션에 따라 후속 절차를 자동 안내)
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

## 5. 재료 파밍 효율표 데이터

```bash
# 추가 테이블: {kr,en,jp}/gamedata/excel/{item_table,stage_table}.json → <prefix>_<name>.json
python3 scripts/build-farm.py .gamedata   # → app/data/farm.json + public/items/ 아이콘
```

클뜯 item/stage_table(이름 3개 언어)과 **펭귄 물류 API**(실측 드랍률, KR 개방 스테이지만)를
결합한다 — 네트워크 필요. 효율 지표 = 개당 기대 이성(apCost ÷ 드랍률), 표본 100회 미만 제외,
재료당 상위 8개 스테이지 수록. 이벤트 개방/종료 시점마다 재실행해야 목록이 최신으로 유지된다.
상세 규칙: PROJECT-GUIDE §6.5.

## 5.5 육성 비용 계산기 데이터

```bash
# 추가 테이블: kr/gamedata/excel/gamedata_const.json → kr_gamedata_const.json (+ cn 세트, {en,jp}_item_table)
python3 scripts/build-costs.py .gamedata   # → app/data/costs.json + public/items/ 아이콘
```

레벨업(각 정예화 단계 1레벨→만렙의 용문폐 + 경험치), 정예화 1·2(재료 + gamedata_const의
용문폐), 스킬 2~7(allSkillLvlup), 스킬별 특화 1~3(levelUpCostCond), 모듈 1~3단계
(uniequip itemCost)를 오퍼별로 수록한다. 용문폐(4001)는 `lmd` 필드로 분리. 레벨업 경험치는
gamedata_const의 characterExpMap/characterUpgradeCostMap/maxLevel로 계산하고, item_table의
expItems(고급작전기록 2004 = 2000 EXP)로 환산 개수를 낸다. 미실장 오퍼는 CN 테이블 폴백 —
신재료 이름·설명은 `scripts/cn-translations.json`의 비공식 번역으로 채우고, 없으면
중국어 원문 유지 + 경고 출력. 아이템 사전에는
효율표(farm.json) 재료까지 합쳐 설명·용도·가공소 조합식(craft)도 수록한다 — 재료 상세
모달용. KR 미출시(중국 선행) 재료는 KR item_table에 이름이 없거나 한자(CJK)라 `unreleased: true`로
표시하며, '파밍·육성 시뮬' 탭에서 '미래시 데이터 포함'을 켜야 노출된다. 재료파밍 탭의
'육성 비용 계산기'가 사용하며, **operators.json 또는 farm.json을 재생성했다면 이것도 재실행**한다.

## 6. AI 스토리 요약 데이터

```bash
python3 scripts/build-story.py                 # → app/data/stories.json + public/story/ 썸네일
python3 scripts/build-story.py --cuts act48side  # 해당 이벤트 컷씬 CG → public/story/cut/ (집필용)
python3 scripts/build-story-scripts.py         # KR 전문 → public/story/script/<id>.json (~24MB)
python3 scripts/build-story-scripts.py act49side  # 한 이벤트만 (신규 이벤트 요약 추가 시 같이 실행)
python3 scripts/build-story-scripts.py --lang en  # EN 전문 → public/story/script/en/ (+ story-script-ids.en.json)
python3 scripts/build-story-scripts.py --lang ja  # JA 전문 → public/story/script/ja/ ({@nickname}=Doctor/ドクター)
```

'전문 보기'는 사이드+메인만 지원 (rogue_N은 원문이 조각이라 제외). 산출 JSON은 정적 파일로
UI(story.tsx ScriptReader)가 fetch — **JS 번들에 import 금지** (home 청크 폭증). 버튼 노출은
`app/data/story-script-ids.json` 기준. 컷씬은 public/story/cut/ 재사용, 없는 것만 다운로드
(대문자 참조는 소문자 재시도).

전부 원격 fetch라 로컬 gamedata 폴더 불필요 (story_review_table 3개 언어 + ArknightsAssets2
이미지). KR에 새 사이드 이벤트가 풀리면 기본 모드를 재실행해 목록·썸네일을 갱신한다.
**요약 본문(`app/data/story-summaries.json`)은 스크립트가 만들지 않는다** — AI(Claude)가
스토리 스크립트를 정독하고 집필해 넣는다 (`story-summary` 스킬, PROJECT-GUIDE §6.6).

컷씬 CG·삽화를 새로 받았으면(`--cuts`/`--chars`) **이미지 실측 크기도 재생성**한다:

```bash
python3 scripts/measure-story-images.py   # → app/data/story-image-dims.json (pillow 필요)
```

요약 상세의 CG(figure)·장식 삽화(deco) `<img>`에 width/height를 박아 로딩 중 레이아웃
밀림(CLS)을 없애는 용도. story.tsx가 이 파일을 읽어 이미지마다 고유 비율로 공간을 예약한다.
