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
python3 scripts/build-enemies.py .gamedata     # → app/data/enemies{,.en,.ja}.json + enemy-stages* + public/enemy/ (3개 언어 동시)
#   ⚠ 인자 없이 돌리면 levels/ 2,283개(179MB)를 받아 '등장 작전'을 역색인한다 (약 1분).
#     CI는 --meta-only --no-images로 돌아 그 둘을 건너뛰므로, 새 이벤트의 등장 적과
#     신규 적 초상은 **로컬 전체 실행**으로만 갱신된다 (docs/AUTOMATION.md 1-B).
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
- `app/data/extra-i18n.en.json` / `.ja.json` — 인프라 플래너·공개채용 도우미 표시용 오버레이
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

## 5.2 중국 서버(미래시) 공식 방송 일정

```bash
python3 scripts/build-broadcasts-cn.py   # → app/data/broadcasts.json 의 server:"cn" 항목
```

중섭 공식 방송은 유튜브가 아니라 **비리비리 라이브룸**(明日方舟 room 5555734)이라, 유튜브 3개
채널을 도는 크론 워커(workers/broadcast)가 못 잡는다. 운영팀이 방 소개문에 다음 방송 일정을
적어 두므로("…计划将于7月15日20:00进行") 거기서 제목·시각·커버를 뽑아 정적 파일에 넣는다.
**비리비리는 클라우드플레어 이그레스를 412로 밴**하지만 GitHub 러너는 통과해서, 크론 워커가
아니라 결정론 레인(`scripts/ci-refresh.sh`)에 있다. 사이트는 **미래시 데이터 포함이 켜졌을
때만** 이 항목을 보여준다. 실패해도 파이프라인을 죽이지 않는다(기존 파일 유지).

## 5.5 육성 비용 계산기 데이터

```bash
# 추가 테이블: kr/gamedata/excel/gamedata_const.json → kr_gamedata_const.json (+ cn 세트, {en,jp}_item_table)
python3 scripts/build-costs.py .gamedata   # → app/data/costs.json + public/items/ 아이콘
python3 scripts/build-sanity.py            # → app/data/sanity.json (재료 이성 단가 · costs/farm 이후)
```

`build-sanity.py`는 육성 추천의 **예상 회수일**이 쓰는 이성(AP) 환산 단가를 만든다 —
파밍 가능 재료는 farm.json 실측 최저 이성, 칩은 주간 PR, 제작 전용 재료는 가공소·제조소
레시피 재귀 분해, 용문폐·작전기록은 CE-6·LS-6 고정 드랍. **costs.json·farm.json이 갱신되면
같이 돌린다.** 규칙 정본은 docs/INFRA-RULES.md "육성 추천의 이성 환산 회수일".

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
python3 scripts/build-story-search.py          # 스샷 레이더 전문 검색 인덱스 → public/story/search.bin (KR 전문 갱신 시 같이 실행)
```

'전문 보기'는 사이드+메인만 지원 (rogue_N은 원문이 조각이라 제외). 산출 JSON은 정적 파일로
UI(story.tsx ScriptReader)가 fetch — **JS 번들에 import 금지** (home 청크 폭증). 버튼 노출은
`app/data/story-script-ids.json` 기준. 컷씬은 public/story/cut/ 재사용, 없는 것만 다운로드
(대문자 참조는 소문자 재시도).

전부 원격 fetch라 로컬 gamedata 폴더 불필요 (story_review_table 3개 언어 + ArknightsAssets2
이미지). KR에 새 사이드 이벤트가 풀리면 기본 모드를 재실행해 목록·썸네일을 갱신한다.
**요약 본문(`app/data/story-summaries.json`)은 스크립트가 만들지 않는다** — AI(Claude)가
스토리 스크립트를 정독하고 집필해 넣는다 (`story-summary` 스킬, PROJECT-GUIDE §6.6).

### 6.1 요약 EN/JA 번역

집필(한국어)이 끝나면 번역까지 돌려야 발행이 끝난다. 작업본 `scripts/story-i18n/`은 gitignore.

```bash
python3 scripts/story-i18n-setup.py       # KO 스캐폴드 + 고유명사 용어집 → scripts/story-i18n/
#   → scripts/story-i18n/{en,ja}/<id>.json 을 서브에이전트가 채운다 (TRANSLATE.md 참조)
python3 scripts/story-i18n-merge.py       # 검증·병합 → app/data/story-summaries.{en,ja}.json
python3 scripts/story-i18n-merge.py --publish   # 이미 발행된 번역이 바뀌는 걸 승인
python3 scripts/story-i18n-backport.py    # 발행본을 직접 고쳤을 때 작업본으로 되돌리기
```

merge는 **이미 발행된 번역이 달라지면 아무것도 쓰지 않고 멈춘다**(exit 1). 발행본을 손으로
고친 뒤라면 backport를 먼저 돌린다. 구조 파손·번역 누락만 KO 폴백이고, alias 길이·볼드
개수는 경고로 발행한다. KO 본문이 번역 이후 바뀌면 "낡음 — 재번역 필요"로 보고한다.
`alias`는 로케일 본문 하이라이트와 한국어 원문 화자 매칭을 겸해 **언어가 섞이는 게 정상**이며
KO와 개수가 달라도 된다.

컷씬 CG·삽화를 새로 받았으면(`--cuts`/`--chars`) **이미지 실측 크기도 재생성**한다:

```bash
python3 scripts/measure-story-images.py   # → app/data/story-image-dims.json (pillow 필요)
```

요약 상세의 CG(figure)·장식 삽화(deco) `<img>`에 width/height를 박아 로딩 중 레이아웃
밀림(CLS)을 없애는 용도. story.tsx가 이 파일을 읽어 이미지마다 고유 비율로 공간을 예약한다.

## 7. 오퍼 스캐너 템플릿 (인프라 플래너 · 보유 오퍼 스캔)

```bash
python3 scripts/build-scan-templates.py   # → app/scan/portrait-templates.json (KR 전 초상, 스킨 포함)
npx --yes tsx scripts/verify-scan.ts      # 회귀 검증 — 픽스처 138셀 식별·정예화 100% 기준
```

- 카드 아트 = **장착 스킨의 초상(portrait) 에셋** → KR skin_table의 portraitId 전부(기본 _1/_2 +
  스킨)를 미러 5곳에서 받아 카드에 그려지는 영역만 42×30 템플릿으로 굽는다. 초상은
  `.gamedata/portraits/` 캐시, `#`은 `%23`, 미러에 따라 파일명이 소문자인 경우 폴백.
- 미러에 아직 없는 최신 스킨(Yostar 콜라보 등)은 `scan-template-overrides.json`(픽스처 실추출)로
  보강 — 정식 초상이 미러에 올라오면 빌드가 자동으로 그쪽을 우선한다. 빌드 로그의
  "미러 누락 N장"은 해당 스킨 장착 유저만 영향(기본 초상으로 오퍼 자체는 식별됨).
- 정예화 엠블럼 템플릿(app/scan/elite-templates.json)은 픽스처에서 추출한 고정 애셋 —
  게임 UI가 바뀌지 않는 한 재생성 불필요.
- 신규 오퍼 추가(operators.json 재생성) 후에는 이 스크립트도 한 번 돌려 초상 템플릿을 따라잡게 한다.

## 7.5 오퍼레이터 보이스 대사 (텍스트, 2026-07-31~)

```bash
# 추가 테이블: {kr,en,jp,cn}/gamedata/excel/charword_table.json → <prefix>_charword_table.json
python3 scripts/build-voicelines.py .gamedata   # → public/voice/{ko,en,ja}/<opId>.json
```

- 출처는 `charword_table.json` — 대사 본문·제목·해금 조건(신뢰도/승진)·재생 위치 + 언어별 성우.
  KR·EN·JP 테이블이 각각 공식 번역이라 AI 번역을 쓰지 않는다 (미실장 오퍼만 CN 폴백).
- **음성 파일(mp3)은 넣지 않는다** (사용자 확정 2026-07-31 "텍스트만 할까"). 음성은
  `ArknightsAssets/ArknightsAssets2`의 **voice 브랜치**
  (`assets/dyn/audio/sound_beta_2/{voice,voice_cn,voice_en,voice_kr}/<charId>/<voiceId>.mp3`)에
  언어당 약 1GB 있지만, 게임 에셋 원본 재배포라 성격이 다르다 — 넣으려면 별도 결정이 필요하다.
- **대사는 charId가 아니라 wordKey로 묶는다.** 한 charId 밑에 세 종류가 섞여 있다:
  - 언어 변종(`…_ITA`·`…_CN_TOPOLECT`) = 같은 대본을 그 언어 성우가 읽은 것(문장부호만 다름).
    `voiceLangDict[charId].wordkeys`로 걸러낸다 — 안 거르면 **모든 줄이 두 번** 나온다(실측).
  - 복장 전용 세트(`…_epoque#7` 등, 14개) = 38줄 중 37줄이 다른 별개 대본이라 살리고
    skin_table의 `charId@suffix`에서 이름을 붙인다.
  - 다른 형태(가드/메딕 아미야)는 그 자체가 오퍼 id — 사이트 로스터에 없으면 표시하지 않는다.
- 산출물은 오퍼당 파일 1개(평균 8KB, 로케일당 3MB)로 `public/voice/`에 쓰고 상세 모달이 열릴 때만
  받아간다 — profiles·skins와 같은 관례. **R2 동기화(아래 8절)를 돌려야 사이트에 보인다.**
- 예비 인원 10명은 대사가 없어 파일도 안 만든다(UI가 "등록된 보이스 대사가 없습니다"를 띄운다).

## 7.6 전투 스킬 레벨별 수치 (Lv.1~7 · 특화 M1~M3, 2026-08-01~)

```bash
python3 scripts/build-skill-levels.py .gamedata   # → public/skills/{ko,en,ja}/<opId>.json
```

- 출처는 이미 받아 둔 `<prefix>_skill_table.json`의 `levels[]` — 추가 다운로드가 필요 없다.
- **operators.json에 넣지 않는다.** 948개 스킬 × 10레벨 = 370KB(gzip 75KB)라
  operators.json(gzip 276KB)을 27% 불리는데, 그 파일은 **번들에 통째로 실려** 모든 페이지
  첫 로딩에 들어간다. 레벨 수치는 상세 모달에서만 쓰므로 profiles·skins·voice와 같은
  관례로 오퍼당 파일 1개(평균 0.9KB)를 만든다. **R2 동기화(아래 8절)를 돌려야 보인다.**
- 설명 문장은 레벨마다 같고 숫자만 바뀌므로 **템플릿 + 값**으로 쪼갠다. 레벨 사이에 실제로
  변하는 자리만 `{0}`·`{1}` 마커로 남기고 나머지는 문장에 박아 둔다 — 화면은 마커 자리에
  그 레벨 값을 끼워 넣고 강조 표시한다(어느 수치가 레벨을 타는지 한눈에 보인다).
- 특화에서 **문장 자체가 바뀌는 스킬이 83개** 있어 `tpl`은 배열이고 `ti`(레벨→템플릿 색인)가 붙는다.
- ⚠ 미실장 오퍼는 로케일 테이블에 없어 CN 폴백인데, 그대로 쓰면 **중국어가 화면에 샌다**
  (operators.json 설명은 이미 AI 번역본이므로). 폴백일 땐 CN 템플릿을 버리고
  operators.json(로케일본)의 최고레벨 설명에서 값의 자리를 찾아 템플릿을 되만든다.
  못 찾으면 tpl 없이 sp·지속만 내고 화면은 기존 설명을 그대로 쓴다(현재 7개).
- 검증: 만든 최고레벨 문장이 operators.json의 `description`과 **948개 전부 일치**해야 한다
  (`python3 -c` 한 줄 대조 — 안 맞으면 interpolate 규칙이 어긋난 것).

## 7.7 헤더 마스코트 치비 (베타, 2026-08-03~)

**표시 클립**: `public/chibi/skadi2-{relax,move,sit,sleep,interact,grab,sitdown,situp,liedown,wakeup}.webm`
(VP9+알파 · 1024×576 · 24fps, 합계 ~1.5MB, 표시 높이 92px). 게임 원본 Spine 데이터(3.8.99)의
모션을 **직접 렌더**한 것 — 공식 렌더 레포(ArknightsSpines)는 Relax만 구워 두어서, 걷기·추가
포즈는 이 경로로만 나온다. sitdown/situp/liedown/wakeup은 **Spine AnimationState 믹스로 구운
포즈 전환**(render.html의 renderTransition — Relax↔Sit 0.55s·Sit↔Sleep 0.7s crossfade,
"서 있다가 갑자기 앉는 게 아니라 서서히", 사용자 확정 2026-08-03): 한 번 재생 후 onEnded로
정착 클립에 전이한다.
생활 루프(틱 3.5~7초): 서기에서 65% 산책·15% 앉기(sitdown), **잠은 앉기를 거쳐서만**(두 틱
이상 앉아 있으면 60%로 liedown→취침, 기상은 wakeup→앉기부터 — "서 있다가 갑자기 눕는 건
이상하다", 사용자 확정 2026-08-03).
**레어 이벤트**(2026-08-03): 命途迭代/II 스킨의 기지 Special(10.7s — 붉은 드레스로 갈아입고
카드 점술, 미니 치비 관객 등장)을 `skadi2-special.webm`(902KB, preload=none)으로 렌더.
쿨다운 4분 + 서 있는 틱의 3%로 발동, 끝나면 기본 복장 원복. 스킨 소스는 isHarryh/Ark-Models
`models/1012_skadi2_iteration%232/` (atlas의 png 참조에 '#'이 있어 로컬 파일명을 바꿔 로드).
斗争血脉/IV 스킨의 Special(시본 소환 5.3s)은 미사용 — 원하면 같은 절차로.
**드래그 이사**(2026-08-03): 7px 넘게 끌면 잡힘 — grab 클립(Default 직립 정지 1프레임)을
커서가 쥔 허리(상자 49%·52%, bbox 실측)를 축으로 기울여 대롱대롱. 잡기 지점은 허리로
스냅한다(상자 위쪽은 투명 여백이라 그대로 쓰면 커서 아래에 매달림). 놓으면 등가속 낙하 →
발밑 x에서 `elementsFromPoint`로 아래를 훑어 **처음 만나는 요소의 윗변에 착지**, 그 표면
폭 안에서 배회. 스크롤·리사이즈 시엔 착지 요소의 rect를 따라 "탑승"하고, 요소가 사라지거나
화면 밖으로 나가면 다시 떨어진다. **320px 넘게 떨어지면** 철푸덕 체인(렌더 클립 —
CSS 회전 계열은 전부 반려됨, 사용자 확정 2026-08-03): splat(Default→Sleep 0.18s 급속
믹스=털썩 뻗기, 25f) → getupmad(Sleep→Default 0.3s=벌떡, 12f) → Interact + 💢(짜증) → relax. **등반**: 배회 틱의 30%로 머리 위 30~190px에서 그려진 요소의
윗변(턱)을 찾으면 점프(0.26s) → grab 포즈로 매달림(0.38s) → 기어오름(0.26s) → 그 위에서
배회 — 반복되며 한 칸씩 꼭대기까지 오른다 (mode "climb"). 좌표는 home=헤더 슬롯(--cx) / free=뷰포트 고정(--fx/--fy) 이원화.
클릭 = 반응 모션(Interact) + **크롬 내장 Gemini Nano(Prompt API, Chrome 148+ 데스크탑)
상태별 대화 패널**(app/chibi-chat.tsx — 페르소나(반말·"당신" 호칭)·few-shot·스트리밍, 기기 내
생성이라 서버·비용 없음): 설치됨=바로 대화 · 다운로드 가능/진행 중=크기(약 2GB)·용도 안내 후
**동의 시에만** 내려받기(진행률 표시, 완료 즉시 대화) · 요건 미달=모션만 (사용자 확정 2026-08-03 —
무단 다운로드 금지, 원하는 사람은 안내 거쳐 설치). 대화 중엔 생활 루프가 얌전해진다(산책·낮잠 억제).
대화에서 **사이트 기능 실행**도 된다: 메시지마다 1회용 세션 + responseConstraint JSON 분류로
의도를 라우팅해(고정 액션 목록 — 탭 9종 + 오퍼 상세) 탭 전환·오퍼 모달을 실제로 연다.
**대화 기록은 localStorage**(로케일별, 최근 40개)에만 저장 — 패널을 닫거나 재방문해도 이어지고,
세션 재생성 시 최근 10개(개당 400자)를 initialPrompts로 재주입해 기억을 복원한다. 🗑로 삭제.
Pages 같은 출처로 서빙(R2 아님 — 알파 프로브가 캔버스를 읽어야 해서 CORS 헤더 없는
R2 워커로 옮기면 깨진다. 이관하려면 워커에 ACAO부터).

재렌더 절차 (스킨 교체·포즈 추가 시 — 세션 스크립트라 레포엔 절차만 남긴다):

1. **Spine 원본**: `isHarryh/Ark-Models` 레포 `models/1012_skadi2/`의 `.skel/.atlas/.png`
   (다른 오퍼·스킨은 `models_data.json`에서 탐색). 스카디 보유 모션:
   Default · Interact · Move(1.67s) · Relax(4.8s) · Sit(5.3s) · Sleep(2.7s) — 전부 뽑을 수 있다.
2. **프레임 캡처**: spine-ts 3.8 런타임(`spine-webgl.js`, EsotericSoftware/spine-runtimes
   @3.8 브랜치)을 로컬 HTML에 얹고 헤드리스 크로미움(playwright)으로 24fps PNG 캡처.
   캔버스 1024×576 · 카메라 중심 (0, 288) — 공식 렌더(SpineExporter)와 같은 프레이밍이라
   기존 클립과 위치가 안 튄다. Move는 루트 이동 없는 제자리걸음(실측 중심 x 오차 ±2px).
3. **인코딩**: `ffmpeg -framerate 24 -i f%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p
   -auto-alt-ref 0 -crf 40 -b:v 0 out.webm` (ffmpeg 없으면 npm ffmpeg-static).
   `-auto-alt-ref 0`이 없으면 알파가 안 실린다.

Spine 런타임 사용은 팬 도구 관례상 회색지대(비영리 팬사이트 참조 관행) — 배포 에셋은
렌더 산출물뿐이고 원본 skel·atlas·런타임은 레포에 넣지 않는다.

### 7.7.1 기지 치비 렌더 매니페스트 (로테이션 대비 데이터)

```bash
node scripts/build-chibi-manifest.mjs   # → app/data/chibi.json
```

ArknightsSpines @cn의 Relax 렌더 374명분 목록(+스킨명 3개 언어 조인). 현재 헤더는
이격 스카디 고정이라 **UI에서 안 쓰지만**, 로테이션 복귀·다른 기능 재활용 대비로
데이터·스크립트를 유지한다. 소스는 jsDelivr 스트리밍 전제(ACAO:* 제공).
- 변형(스킨) 표시명은 `.gamedata/{kr,en,jp}_skin_table.json`과 파일명 suffix를 조인해
  3개 언어로 박는다 — `fetch-gamedata.py`가 먼저 돌아 있어야 한다.
- KR 실장 오퍼 커버리지는 소스 레포의 렌더 진도를 따른다(2026-08-03 기준 374/420) —
  없는 오퍼는 UI가 안내문으로 폴백하므로 재생성만 하면 자동 편입된다.

## 8. 정적 에셋 R2 동기화 (2026-07-27~)

public/의 story·rogue·lens·tesseract·avatars·about·og·items·scan·profiles·skins·voice·skills는 사이트 배포(Pages)가
아니라 **R2(files.terra-archive.net/assets/…)** 에서 서빙된다. 버킷은 assets/(이 스크립트 관할)와
uploads/(/admin 수동 업로드)로 나뉘며, --prune은 로컬에 없는 assets/ 키만 지운다. 파이프라인이 이 폴더들에 파일을
새로 만들었으면(신규 오퍼 아바타, 이벤트 섬네일·전문 스크립트, 통합전략 에셋, OG 이미지,
소개 스크린샷 등) R2에 밀어 올려야 사이트에 보인다:

```bash
node scripts/r2-sync.mjs           # md5 증분 — 바뀐 것만 올린다
node scripts/r2-sync.mjs --dry     # 올릴 목록 미리 보기
node scripts/r2-sync.mjs --recache # 내용이 같아도 데이터 파일을 다시 올려 캐시 헤더 갱신
node scripts/audit-assets.mjs --r2 # 오퍼 에셋 전수 검사 (로컬 완결성 + R2 미동기)
```

**`--recache`는 언제 쓰나** — 캐시 정책(`cacheFor()`)은 오브젝트 **메타데이터**라
정책만 고치면 이미 올라간 파일엔 반영되지 않는다. 정책을 바꾼 뒤 한 번만 돌리면 된다
(2026-08-02: json/txt/bin을 `max-age=86400` → `60 + must-revalidate`로 바꾸면서 5,350개 갱신).

**`audit-assets.mjs`** — 데이터가 번들(배포)과 R2(동기화) 두 경로로 나가는데 한쪽만 돌면
반쪽이 된다(PROJECT-GUIDE §7). 아바타 누락 · 스킬이 있는데 레벨 파일이 없는 오퍼 ·
**로케일 일부에만 있는 파일** · `--r2`면 R2 미동기 건수까지 본다. 정상적인 공백(스킬 0개
로봇, 핸드북 없는 예비 오퍼레이터)은 데이터에서 유도해 걸러내므로 기준선 파일이 없다.
`ci-refresh.sh`의 rest 단계에 들어 있다.

**`--prune` 안전장치 (2026-08-01)** — prune은 "로컬에 없다 = 지워도 된다"로 판단하는데,
로컬이 빈 이유가 삭제 의도가 아닌 경우가 있다: `build-profiles/skins/voicelines.py`는
**출력 폴더를 통째로 지우고 다시 굽기 때문에** 중간에 죽으면 부분 상태로 남고(git에 원본이
있어도 작업 폴더는 이미 빈 상태), 부분 클론·CI 체크아웃도 마찬가지다. 그래서 두 겹을 건다:

- **원격엔 키가 있는데 로컬 폴더가 빈** DIRS 항목이 있으면 삭제를 건너뛴다
  (양쪽 다 비었으면 그냥 안 쓰는 항목이라 통과)
- 삭제 대상이 원격 `assets/` 키의 **10%를 넘으면** 건너뛴다
- 업로드는 정상 진행하고 **삭제만** 막는다 — 진짜 대량 정리는 `--prune --force`

실측(2026-08-01): 이 장치를 넣자마자 죽은 항목 `portal`(로컬·R2 양쪽 0개)이 걸려서 DIRS에서
제거했다. 대문 배경이 이격 스카디 일러 한 장(`/skin/full/…`)으로 굳으면서 빈 폴더가 된 것.

`bash scripts/deploy.sh`가 배포 전에 자동으로 돌리므로 보통은 신경 쓸 일 없다.
인증은 레포 루트 `.r2-sync-key`(gitignore) — 잃어버리면
`openssl rand -hex 32 > .r2-sync-key && (cd workers/upload && npx wrangler secret put SYNC_KEY < ../../.r2-sync-key)`.

### ⚠ 에셋 폴더와 **페이지가 같은 이름**일 때 (`rogue`, 2026-08-08 사고)

deploy.sh는 위 폴더들을 `rm -rf`로 스테이지에서 걷어낸다(R2가 서빙하므로). 그런데
2026-08-06에 통합전략 테마 정본 주소를 `?topic=isN` → **`/rogue/<슬러그>`** 로 옮기면서
`dist/client/rogue/` 안에 **에셋 폴더와 페이지 파일이 섞였다**:

```
rogue/  map relic enemy scene zone capsule misc node kv1~6.webp   ← R2 (지워야 함)
        is1~is6.html · is1~is6.rsc                                ← 페이지 (남겨야 함)
```

통짜 `rm -rf rogue`가 테마 페이지까지 지워, **한국어 6개 페이지가 매 배포마다 사라져
라이브에서 404**였다. 사이트맵에는 실려 있으니 구글에는 "사이트맵이 가리키는데 없는
주소"로 보였고, `/en`·`/ja`는 `$STAGE/en/rogue/` 아래라 이 삭제를 안 타서 멀쩡했다 —
그래서 눈으로는 더 안 보였다. **GSC 색인 리포트로야 드러났다.**

이제 rogue만 `find … ! -name 'is*.html' ! -name 'is*.rsc' -exec rm -rf {} +` 로 페이지를
남기고 지운다. 앞으로 **에셋 폴더 이름과 페이지 경로가 겹치면 같은 사고가 난다** — 새
라우트를 만들 때 `dist/client/<이름>/`이 삭제 목록에 있는지 먼저 볼 것.

**`check-staged.mjs` — 사이트맵 대조 안전망** — 위 사고를 조용히 넘기지 않도록,
스테이지 가공 직후 **사이트맵의 모든 주소가 실제 파일로 있는지** 대조하고 하나라도
없으면 배포를 중단한다(`--skip-r2` 가드와 같은 원칙: 고쳐야 할 상태를 만드느니 실패가 낫다).

```bash
node scripts/check-staged.mjs <스테이지경로>   # deploy.sh가 자동 실행
```

회귀 확인(2026-08-08): 옛 삭제 방식을 재현하면 종료코드 1과 함께 `/rogue/is1`~`is6`을
정확히 지목하고, 고친 방식에서는 사이트맵 1,578개 주소가 전부 통과한다.

## 배포 무중단 확인 (`deploy-probe.mjs`, 2026-08-06)

사용자 제보: *"배포 끝나고 30초~1분간 사이트 접속이 안 되는 시간이 늘어난다."* 원인이
① 업로드 창 ② 전환 후 엣지 전파 ③ 브라우저에 남은 옛 청크 중 어느 것이냐에 따라 처방이
완전히 다른데, 지금까지 상태 코드도 지속 시간도 잰 적이 없었다. 그래서 **먼저 잰다.**

`deploy.sh`가 wrangler 전환 직전에 자동으로 띄우고(끄려면 `--no-probe`), 4분간
`/`·`/infra`·`/infra.rsc` 셋을 1초 간격으로 찔러 상태 코드·응답 시간·처리 콜로를 기록한 뒤
**끊긴 구간을 요약**한다 (`.ci/deploy-probe.log`, 원본 표본은 `.ci/deploy-probe.json`).
단독 실행: `node scripts/deploy-probe.mjs --seconds 240`.

### 확정된 원인 (2026-08-06 밤, 제보 스크린샷 2장)

첫 시도에선 원인을 ③(옛 탭이 물고 있던 청크)으로 잡았는데 **틀렸다**. 실제 사고 때 콘솔에
404로 찍힌 두 파일을 그날 빌드 산출물과 대조해 보니 **둘 다 이번 배포에 들어 있는 파일**이었다:

```
home-C4EzpAjF.js   ← dist/client/assets에 있음. 2.3MB (그 빌드에서 가장 큰 청크)
index-nVVUPfoT.js  ← dist/client/assets에 있음
```

즉 **전환은 끝났는데 그 콜로가 블롭을 아직 못 읽는 상태**였다(②). 큰 파일일수록 늦었다.
`keep-assets`(③ 처방)는 이 방향엔 듣지 않는다 — 사라진 옛 파일이 아니라 **새 파일**이 404였다.

같은 배포의 프로브는 "끊김 없음"을 찍었다. 프로브가 HTML에서 찾은 **첫 번째** `/assets/*.js`
하나만 확인했고 그게 하필 작은 `layout-segment-context`였기 때문이다. 지금은 HTML이 참조하는
**모든** 청크를 매 틱 확인한다(앞 2KB만 Range로 — 2.3MB를 1초마다 통째로 받으면 4분에 550MB).

읽는 법 — 요약에 찍힌 실패 코드로 원인이 갈린다:

| 증상 | 원인 | 처방 |
|---|---|---|
| `TimeoutError` (전환 **전**) | 업로드 창 | 2단계 배포(기본값) |
| 404인데 **이번 빌드에 있는** 파일 | 블롭 전파 ← **실제 사고** | 2단계 배포 + `warm-assets` |
| 404인데 **이번 빌드에 없는** 파일 | 옛 탭이 물던 청크 | `keep-assets` |

요약의 "죽은 청크 (파일별 실패 횟수)" 줄에 파일명이 그대로 찍히니 `ls dist/client/assets`와
대조하면 위 둘 중 어느 쪽인지 바로 갈린다.

**2단계 배포 — 이제 기본값 (끄려면 `--one-phase`)** — Pages는 **파일 내용 해시로 프로젝트
전체에서 업로드를 중복 제거**한다("N files already uploaded"). 같은 폴더를 프리뷰
브랜치(`deploy-stage`)에 먼저 올려 두면 이어지는 프로덕션 배포는 업로드가 거의 0이 되고
전환만 남는다. **블롭을 먼저 올려 두고 나중에 전환**하는 순서라 위 ② 창이 줄어든다.
⚠ Pages에는 **프리뷰를 프로덕션으로 승격하는 CLI가 없다** — 이건 승격이 아니라 '업로드 선행'이다.
프리뷰 URL(`deploy-stage.terra-archive.pages.dev`)이 공개되지만 모든 페이지의 canonical이
terra-archive.net을 가리켜 색인은 정본으로 합쳐진다.

**`warm-assets.mjs` — 전환 직후 데우기 (②의 직접 처방)** — 전환이 끝나자마자 이번 빌드의
청크를 **우리가 먼저 한 번 당긴다**(큰 파일부터, 4개씩, 안 뜨면 3초 간격 재시도, 최대 3분).
엣지가 원본에서 한 번 당겨오면 그 뒤로는 그 콜로에서 바로 나오므로, 사용자가 첫 요청으로
404를 맞는 일이 없어진다. 1회차에 통과하면 "전환 시점에 이미 읽혔다", 2회차 이상이면
**그게 곧 배포 직후 404 창**이라 파일명과 회차가 로그에 남는다. 매번 같은 파일이 늦으면
그 청크를 쪼갤 때다.

**`keep-assets.mjs` — 직전 배포 청크 동봉 (③ 대비, 여전히 유효)** — 청크 파일명은 내용
해시라 재배포하면 옛 이름이 통째로 사라지고, Pages는 **현재 배포에 있는 파일만** 서빙하므로
배포 순간 열려 있던 탭의 지연 로딩이 404(그것도 `text/html`인 404 페이지)를 맞는다.
배포 직전에 `.deploy-assets/`(로컬 캐시, gitignore)에서 **최근 3회분 청크를 스테이지에
채워 넣는다** — 같은 이름은 언제나 이번 빌드 것이 우선. 1회분이 48개·27MB라 파일 수·용량
모두 여유가 크다(배포당 3,225개 / Pages 한도 20,000개). 이번 사고의 원인은 아니었지만
탭을 열어둔 채 배포하는 상황은 실제로 있으므로 그대로 둔다.

**자동 새로고침 (app/layout.tsx)** — 죽은 청크를 잡아 새로고침하는 장치는 2026-07-25부터
있었는데 세 가지가 고장나 있었다:

- **가드가 10초 고정** — 404가 30~60초 이어지면 그동안 10초마다 새로고침을 반복했다.
  사용자에겐 그게 곧 "배포하면 30초~1분 접속이 안 된다"였다.
- **대기 창에 걸리면 재시도를 아무도 예약하지 않았다** — 새로고침 → 또 실패 → 가드에 막혀
  `return` → 끝. 즉 2회차 이후로는 **영영 복구되지 않았다**. 이제 남은 시간만큼 타이머를 건다.
- **흰 화면을 못 잡았다** — 청크가 404나면 `React.lazy`가 undefined를 받아
  `Cannot read properties of undefined (reading 'default')`로 **동기 예외**를 던진다.
  `unhandledrejection`도 SCRIPT 로드 실패도 아니라 종전 핸들러가 전부 놓쳤다. 이제
  `/assets/` 요청이 한 번이라도 실패했으면(hit 플래그) 뒤이은 렌더 예외도 청크 사고로 본다
  — 무관한 앱 버그로 루프를 돌지 않도록 **플래그가 섰을 때만**. modulepreload가 LINK 태그라
  `tagName==='SCRIPT'` 검사에 안 걸리던 것도 함께 고쳤다.

지금은 0 → 3초 → 10초 → 30초 → 30초 → 1분 × 3으로 **8회·약 4분 15초**까지 버틴다(실제 사고가
3~4분이었다). 3회차부터는 흰 화면 대신 안내와 '지금 다시 시도' 버튼을 띄우고, 정상 로드 5초
뒤 카운터를 지운다.

**바뀌는 파일 수** — 지금은 HTML 1,582 + `.rsc` 1,579개가 **매 배포마다 전부** 바뀐다.
푸터 배포 시각(`__BUILD_TIME__`)이 번들에 박혀 home 청크 해시가 매번 달라지고, 그 청크를
모든 페이지가 물고 있기 때문이다. 위 처방으로도 남는 끊김이 있으면 여기가 다음 손댈 곳이다
(배포 시각을 번들에서 빼 작은 정적 파일로 런타임에 읽기). 덤으로 home 청크 해시가 고정되면
`warm-assets`가 데울 신규 파일 자체가 줄어든다.

## 검색 노출 (SEO) — 빌드 산출물과 통보

**`build-sitemap.mjs`** — `public/sitemap.xml`. `app/`의 `page.tsx`를 훑어 라우트를 모으고,
`[id]` 동적 라우트는 데이터로 펼친다(스토리 요약 91편 · 정식 출시 오퍼 420명 × 3언어 =
1,560 URL). `lastmod`는 **그 페이지 내용을 좌우하는 데이터 파일의 마지막 커밋 시각**이라
진짜 바뀐 날만 갱신된다. `npm run build`가 자동 실행 — 직접 고치지 말 것.

**`build-rss.mjs`** — `public/feed.xml`. AI 스토리 요약 최신 60편 발행 피드(한국어).
사이트맵과 별개로 **네이버 서치어드바이저에 RSS로 제출**하면 신규 수집이 빨라진다.
같이 빌드된다. 오퍼 데이터는 발행물이 아니라 참조 자료라 피드에 넣지 않는다.

**`indexnow.mjs`** — 배포 후 Bing·네이버에 바뀐 페이지를 즉시 통보한다.
`deploy.sh`가 wrangler 배포 성공 뒤에 부른다(실패해도 배포는 성공).
직전 커밋 대비 **실제로 바뀐 `app/data` 파일**에서 URL을 뽑고, 신규 스토리 요약·신규 오퍼는
상세 URL까지 넣는다. 바뀐 게 없으면 아무것도 안 보낸다 — 전체 목록을 매번 밀어넣으면
통보 자체가 신뢰를 잃는다. 확인만 하려면 `node scripts/indexnow.mjs --dry --base <ref>`.
키 파일은 `public/<32자리 hex>.txt`이며 사이트 루트에 그대로 서빙돼야 검증을 통과한다.

**사람이 해야 하는 등록** — 구글 서치콘솔 · 네이버 서치어드바이저(사이트맵 + RSS 각각) ·
Bing 웹마스터도구(GSC에서 임포트) · 다음 검색등록. 배포로 자동화되지 않는다.
