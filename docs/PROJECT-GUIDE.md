# 테라 아카이브 프로젝트 가이드 (정본)

명일방주(Arknights) **한국 서버** 팬사이트 "테라 아카이브"의 전체 개발 문서.
다른 세션/다른 개발자가 이 문서 하나로 이어서 개발할 수 있도록, 지금까지 확정된
**모든 규칙·개발 방향·데이터 출처·파이프라인**을 기록한다. 규칙이 바뀌면 이 문서를 함께 갱신할 것.

- 인프라 플래너의 도메인 규칙(교대·토큰·시너지·추정 상수)은 별도 정본: [INFRA-RULES.md](INFRA-RULES.md)
- 데이터 갱신 절차의 실행 명령 상세: [../scripts/README.md](../scripts/README.md)

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 위치 | `~/Documents/명일방주` |
| Git | `github.com:Mmtt85/terra-archive.git` (main 브랜치) |
| 배포 (주) | **https://terra-archive.pages.dev** — Cloudflare Pages. `bash scripts/deploy.sh` 한 방 (빌드→스테이징→pages deploy). wrangler는 이 기기에 OAuth 로그인됨(nzkonaru@gmail.com), 프로젝트에 nodejs_compat 플래그 설정됨. **⚠️ 자동 실행 금지 — 배포는 사용자가 변경분을 모아서 직접 돌린다** (2026-07 규칙 변경). |
| 방송 워커 | `terra-archive-broadcast` (workers/broadcast) — 6시간마다 유튜브 공식 채널 3개에서 방송 일정 자동 수집 → KV → https://terra-archive-broadcast.nzkonaru.workers.dev (프론트 폴백: app/data/broadcasts.json). 배포는 `bash workers/broadcast/deploy.sh`, 상세는 `.claude/skills/broadcast-check` |
| 스택 | vinext(Cloudflare용 Next 호환 런타임) + Next.js 16 / React 19 / Tailwind 4 |
| 명령 | `npm run dev`(localhost:3000) / `npm run build` / `npm run lint` |
| 운영 수칙 | 수정하면 **빌드 확인 → 커밋 → git push 까지만** 진행하고 **멈춘다**. `scripts/deploy.sh`는 절대 자동 실행하지 않음 — 세션마다 자동 배포하면 토큰이 낭비되므로, 배포는 사용자가 여러 변경을 모아서 직접 실행한다 (2026-07 규칙). 모든 허가 요청은 기본 YES |
| 알려진 무시 항목 | git author가 로컬 기본값(nzkonaru@local). 스타터 템플릿 잔재(ChatGPT 인증·D1/drizzle·스켈레톤 테스트 등)는 2026-07 전부 제거됨 — `npm test` 스크립트 없음 |

### 화면 구성 — 단일 페이지 + 탭 4개 × 언어 3종

| 탭 | 해시 딥링크 | 소스 |
|---|---|---|
| 오퍼 백과사전 | (기본) · 오퍼 모달 열면 `#op-<char_id>` | `app/home.tsx` (공용 루트) |
| 인프라 플래너 | `#infra` | `app/planner.tsx` |
| 공채 도우미 | `#recruit` | `app/recruit.tsx` |
| 재료 파밍 효율표 | `#farm` | `app/farm.tsx` |

URL 복붙으로 해당 탭/오퍼 모달이 바로 열려야 한다 (hashchange + 초기 로드 처리).

**언어 경로 (2026-07 도입)**: `/` = 한국어, `/en` = 영어, `/ja` = 일본어.
헤더 우측 "KR SERVER" 칩이 언어 드롭다운(전체 내비게이션, 해시 유지)이다.
- 라우트별 페이지(`app/page.tsx`·`app/en/page.tsx`·`app/ja/page.tsx`)는 서버 컴포넌트로
  로케일 메타데이터(`app/seo.ts`) + JSON-LD만 얹고, 클라이언트 래퍼
  (`app/home-{ko,en,ja}.tsx`)가 해당 언어의 `operators*.json`/`extra-i18n*.json`을
  **정적 import**해 `app/home.tsx`에 넘긴다 — 언어별 데이터는 그 라우트 번들에만 포함.
- UI 문자열 번역은 `app/i18n.tsx` 사전(한국어 원문 = 키, 없으면 KR 폴백).
  **KR 문구를 수정하면 사전 키도 같이 수정**해야 번역이 유지된다.
  컨셉덱 태그·플래너 토큰명 번역도 이 파일(CONCEPT_I18N/TOKEN_I18N).
- 플래너·공채의 계산 엔진은 항상 KR 데이터(infra.json/recruit.json)로 돌고,
  표시(이름·스킬 텍스트·태그명)만 extra-i18n 오버레이로 바꾼다
  (스킬 태그 카운트 등 텍스트 매칭 로직은 `krName` 원본 사용).
- SEO: 언어별 title/description/OG + hreflang 상호 참조(`app/seo.ts`),
  `public/sitemap.xml`에 3개 URL + xhtml:link alternates. html lang은 서버에선 ko,
  하이드레이션 후 로케일로 교체.

---

## 2. 데이터 출처 (클뜯 = 클라이언트 뜯기 데이터마인)

| 데이터 | 출처 | 비고 |
|---|---|---|
| KR 게임 테이블 | `ArknightsAssets/ArknightsGamedata` 레포 `kr/gamedata/excel/*.json` | character / skill / uniequip / battle_equip / building / range / handbook_team / handbook_info / **gacha**(공채) |
| 별명(다국어 이름) | 같은 레포 `jp/`, `cn/`의 character_table | |
| EN/JA 사이트 텍스트 | 같은 레포 `en/`, `jp/`의 위 테이블 세트 (range 제외) | `build-i18n.py`가 operators.{en,ja}.json + extra-i18n.{en,ja}.json 생성 |
| 오퍼 아바타 | `yuanyan3060/ArknightsGameResource` 레포 `avatar/<char_id>.png` | **로컬 `public/avatars/`에 다운로드해 서빙** (핫링크 아님) |
| ❌ 사용 금지 | `Kengxxiao/ArknightsGameData_YoStar` | 2025-11 업데이트 중단 — 쓰지 말 것 |

정적 데이터 파일 (전부 스크립트로 재생성 가능):

- `app/data/operators.json` — 백과사전용 오퍼 전체 (2026-07 기준 **416명**)
- `app/data/infra.json` — 인프라 플래너용 (방 스펙 + 오퍼별 인프라 스킬 구조화, 스킬마다 `buffId` = 다국어 매핑 키)
- `app/data/recruit.json` — 공채 도우미용 (태그 29종 + 모집 풀 153명)
- `app/data/operators.en.json` / `operators.ja.json` — 백과사전 EN/JA 로컬라이즈본 (같은 스키마, 컨셉 태그는 KR 키 유지)
- `app/data/extra-i18n.en.json` / `.ja.json` — 플래너·공채 표시 오버레이 (이름·buffId→스킬 텍스트·공채 tagId→태그명·방 이름)
- `app/data/farm.json` — 재료 파밍 효율표 (재료 50종, 이름 3개 언어 인라인, 스테이지별 실측 드랍률·기대 이성) + `public/items/` 재료 아이콘

---

## 3. 데이터 파이프라인 (`scripts/`)

"새 버전 확인해줘" 요청 시 이 순서로 실행한다:

```bash
node scripts/check-new-operators.mjs      # 1. 미수록 오퍼 확인
# 2. KR/JP/CN + EN 테이블 다운로드 (gacha_table 포함, EN/JP는 다국어용 풀 세트) → 작업 폴더
python3 scripts/regen-operators.py <dir>  # 3. 기계 필드 전체 재생성 → operators-regen.json
python3 scripts/retag-concepts.py <dir>   # 4. 컨셉덱 태그 재부착 → operators-tagged.json → app/data/operators.json 으로 복사
python3 scripts/build-infra.py <dir>      # 5. 인프라 데이터 재생성 → app/data/infra.json
python3 scripts/build-recruit.py <dir>    # 6. 공채 데이터 재생성 → app/data/recruit.json
python3 scripts/build-i18n.py <dir>       # 7. EN/JA 데이터 재생성 → operators.{en,ja}.json + extra-i18n.{en,ja}.json
python3 scripts/download-avatars.py       # 8. 신규 아바타 다운로드 (기존 파일 스킵)
npm run build                             # 9. 빌드 확인 → 커밋 → 푸시 → 재배포 리마인드
```

### 확정된 데이터 규칙 (사용자가 직접 교정한 것 — 어기면 안 됨)

1. **가짜 게스트 오퍼 제외**: `isNotObtainable == true` 이면서 **모듈 데이터가 있는** 항목은
   스토리용 가짜 데이터 → 제외 (char_608~617 계열: 6성판 샤프·피스·튤립·미저리·스톰아이·
   메커니스트·로드·샤프·라이디언 중복판·터치·맹약 서포터). 모듈 없는 획득 불가 오퍼
   (5성 A팀 샤프·스톰아이·튤립·피스)는 실사용 가능하므로 **유지**. 430→420명이 된 이유.
2. **KR 출시순 = handbook_info_table 키 순서** (`seq` 필드로 방출). char id 번호는 CN 배정
   순서라 정렬에 쓰면 안 됨. 핸드북에 없는 예비 인원류는 seq=-1로 맨 뒤.
3. **이미지 로컬화**: 데이터의 `image`는 `/avatars/<char_id>.png` 경로. 신규 오퍼는
   download-avatars.py로 받아온다 (레포에 24MB 커밋되어 있음).
4. **인프라 스킬 강화/신규 구분**은 building_data의 buffChar **슬롯 구조**가 정답
   (같은 슬롯=강화 단계→최종만, 다른 슬롯=동시 적용). 이름 휴리스틱 금지. → INFRA-RULES.md §2
5. 세부직군 명칭은 uniequip_table의 subProfDict 기준 (예: 네크라스=셰이퍼 캐스터).
6. KR 용어: 금괴 아님 → **순금/귀금속류**, 무인기 아님 → **드론**, 연소 원소 = **소각 손상**.

### 컨셉덱 태그 규칙 (`retag-concepts.py`)

- 태그는 스킬·재능·특성·모듈 텍스트를 규칙 엔진으로 훑어 재부착한다 (수동 태그 아님).
- **시너지 팟 11종** — 컨셉 필터 **최상단 고정** (home.tsx의 `SYNERGY_POTS` 순서):
  `해산물팟(어비설) · 쉐이팟 · 쉐라그팟 · 카시미어팟 · 미노스팟 · 아베무팟(Ave Mujica 콜라보) ·
  연소팟 · 라테라노팟 · 탄약팟 · 라인랩팟 · 라이오스 파티(던전밥 콜라보)`
- 팟 판정 = **앵커 진영 소속 OR 전투 텍스트 언급** (POT_BY_FACTION / POT_BY_TEXT / POT_EXTRA):
  - 출신지만으로 붙이지 말 것: 에기르 출신 ≠ 해산물팟 (루실라·언더플로우·딥컬러 제외,
    스카디 더 커럽팅 하트는 재능 텍스트로 포함).
  - 이벤트 맵 조건은 시너지 아님: 쉐이팟 텍스트 규칙은 "쉐이 **오퍼레이터**" 언급만
    ("[쉐이의 기이한 계원]에서" 같은 전장 환경 조건 제외 — 라이디언 사례).
  - 연소팟 = 텍스트 "소각" + 수동 추가(골든글로우, 라플란드 더 데카덴차 — 소각 게이지를
    실질 축적하는 고빈도 술딜러, 사용자 확정).
  - 쉐라그팟 = 쉐라그 + 카란 무역회사 두 진영.
- 정규식 주의: 필러에 `[^%\d]` 계열 사용 (백트래킹이 숫자를 먹어 "50% 상승"→"0%"가 된 버그 전례).
  한글 이름 매칭은 음절 경계 `(?<![가-힣])` 주의 ('레이'가 '오퍼레이터'에 매칭된 전례).

---

## 4. 오퍼 백과사전 탭 (app/home.tsx)

- **필터**: 전부 토글 다중선택, "전체" 버튼 없음 (모두 해제 = 전체). 필터 순서 고정:
  **컨셉덱 → 직군 → 세부 직군 → 전투 태그 → 공격 방식 → 공식 소속**.
- **공격 방식** = 근거리/원거리(position) + 물리/마법(특성에 "마법 대미지" 포함 여부로 판정).
- **정렬**: 기본 = **성급 내림차순 → KR 출시 최신순(seq)**. 그 외 이름/성급/소속/출신지/종족/직군/세부직군.
  방향 토글(↑↓) 있음.
- **카드 그리드**: 한 줄 5명 (≤1450px 4 / ≤1100px 3 / ≤760px 2 / ≤430px 1).
  카드 초상화는 min-height라 이름이 길면 늘어남 (소속·출신·종족이 잘리면 안 됨).
- **카드/모달 공통 표기**: 이름 아래 공식 소속·출신지·종족.
- **오퍼 상세 모달**: 내용 순서 = 잠재→스탯→스킬→재능→특성→모듈→인프라.
  상단 히어로(사진+이름)는 모달의 ~20%만 차지 (compact). 열면 `#op-<id>` 해시.
  모바일 뒤로가기로 닫힘(pushState/popstate), iOS는 dvh로 상단 잘림 방지.
- **오퍼 얼굴 = 상세 모달 (전 시스템 공통 규칙)**: 모든 탭·모달에서 오퍼 아바타를 클릭하면
  백과사전 상세 모달이 열린다. home.tsx의 `showOperatorById(id)`를 prop(`onShowOperator`)으로
  내려 `.op-link` 클래스 + onClick으로 연결 (플래너 시설/시너지트리/숙소, 공채 결과 등).
  **앞으로 오퍼 아바타를 렌더하는 새 UI는 반드시 이 핸들러를 연결할 것.**
  단 함선 미리보기의 일반 시설 타일은 방 모달을 여는 버튼이라 예외.

---

## 5. 인프라 플래너 탭 (app/planner.tsx)

**규칙 정본은 [INFRA-RULES.md](INFRA-RULES.md)** — 여기엔 구조만 요약.

- 243 레이아웃 함선 미리보기, 방 클릭 모달, 자동편성(현재 보유 로스터 기준 즉시 실행).
- **방 모달에서 직접 편집 가능**: 종합 효율 요약(구성 요소 분해 포함)이 상단에 표시되고,
  팀원 빼기(✕)·대체 오퍼 클릭 교체·빈 자리 추가(한계 기여 순 추천)가 실시간 재계산된다.
  단 토큰 포인트·패키지 구성은 마지막 자동편성 기준(근사) — 생성원 변경 시 재실행 안내.
- A조 풀파워 / B조 회복 2교대. 응접실·숙소 고정은 조 전환과 별개.
- 순금 병목 우선, 토큰 시너지(속세의 화식/감지 정보/무성의 공명/생각의 사슬/주술 결정/마물 요리),
  시너지 흐름 트리 모달, 슬롯별 대체 오퍼(시너지 코어는 대체 불가 표시), 도움말 모달(HelpModal).
- **보유 오퍼 설정**: 전원 표시하되 1~5성은 기본 보유 체크, 6성은 기본 미보유.
  **MAA 파일 가져오기**: MAA(MaaAssistantArknights) 오퍼 박스 인식 JSON을 불러와 보유+정예화를
  일괄 반영 (플랫 배열 Arknights_OperBox_Export.json / 원본 operbox {own_opers, all_opers} 둘 다,
  UTF-8 BOM 처리, 파일에 없는 오퍼는 현재 체크 상태 유지).
  정렬 = 6성 우선 → KR 출시 최신순. 버튼은 **"적용 및 자동편성 실행"** (적용하면 바로 재편성 —
  한때 "적용만"으로 바꿨다가 사용자가 재확정). 메인 버튼 문구는 "자동편성 실행".
- 내보내기: JSON(가져오기용) / PNG(A·B조 모두, 다운로드 아닌 미리보기 모달).
  localStorage 키 `terra-archive-infra-v3`.
- 로직 검증법: planner.tsx의 컴포넌트 이전 부분을 esbuild로 번들해 node에서 `optimize(ops)` 실행.

---

## 6. 공채 도우미 탭 (app/recruit.tsx)

- 데이터: `build-recruit.py`가 gacha_table의 `recruitDetail` 텍스트에서 모집 풀을 파싱
  (★ 섹션별, `<@rc.eml>` 마크 제거). 오퍼 태그 = 직군 + 위치 + tagList(로봇/신입 포함) +
  5성→특별 채용 / 6성→고급 특별 채용 자동 부여.
- **남성/여성 태그는 KR 공채에서 삭제됨** — gacha_table에 남아 있어도 쓰지 않는다.
- **공채 추가 지연 보충**: KR **클라이언트에 실제 적용**됐으나 데이터마인 `recruitDetail`이
  아직 갱신 안 됐을 때만 `build-recruit.py`의 `RECRUIT_SUPPLEMENT`(이름 리스트)에 넣는다.
  성급은 character_table 자동 판정, 데이터마인이 따라잡으면 id로 중복 제거됨.
  ⚠️ **나무위키 등의 "예정/미정"은 넣지 말 것** — 미확정 오퍼가 뜨면 유저가 허가증을 낭비함.
  반드시 recruitDetail/recruitPool에서 실제 반영을 확인한 뒤 추가한다.
  (2026-07-12: 카넬리안·키라라·인디고 요청이 있었으나 데이터마인 미반영=KR 미적용으로
  확인되어 제외. 실제 적용되면 이 리스트에 추가.)
- 입력은 **게임에 제시된 태그 5개**(0/5), 계산은 실제 체크 가능한 **1~3개 조합** 전부를
  "높은 성급 확정 순"으로 정렬해 표시. (한때 0/3으로 바꿨다가 사용자가 0/5로 재확정 —
  5개를 다 넣어야 어떤 조합이 4·5성인지 비교 가능하기 때문.)
- **빠른 입력**: 태그 첫 글자를 이어서 입력 (예: "가메신생범" = 가드·메딕·신입·생존형·범위공격).
  각 글자로 시작하는 태그만 표시하고, 후보가 하나뿐인 글자는 자동 선택.
  겹치는 글자(원 → 원거리/원소)는 표시만 하고 클릭으로 확정. **클리어** 버튼이 선택+입력 전체 초기화.
- 모집 시간별 출현 성급 (gacha_table recruitRarityTable, 도우미에 안내문으로 표기):
  1시간~3시간 50분 = 1·2·3·4★ / 4시간~7시간 30분 = 2·3·4·5★ / 7시간 40분 이상 = 3·4·5★만.
  저격은 반드시 7시간 40분 이상(보통 9시간)으로.
- 성급 규칙 (모집 시간 9시간 기준):
  - 6★는 조합에 **고급 특별 채용**이 있어야 풀에 포함.
  - 1★는 **로봇**, 2★는 **신입** 태그를 체크했을 때만 포함. 3~5★는 항상 가능.
  - 조합 풀의 최저 성급 ≥4면 강조(prized) 표시.
- **저격 조합 사전**: 자격 태그 없이 4★+가 확정되는 **최소 조합**(부분조합이 이미 확정이면
  제외)을 전수 계산해 접이식 패널로 내장 — 현재 35개 (5★ 확정 12 / 4★ 이상 23).

---

## 6.5 재료 파밍 효율표 탭 (app/farm.tsx)

- 데이터: `scripts/build-farm.py` → `app/data/farm.json`. **클뜯 item/stage_table**(재료·스테이지
  이름 3개 언어) + **펭귄 물류 API 실측 드랍률**(`/stages?server=KR`, `/result/matrix?server=KR&
  show_closed_zones=false` — 현재 KR에 개방된 존만)을 결합. 네트워크 필요.
- 수록 기준: 5자리 숫자 id의 MATERIAL(30xxx/31xxx 정예화 재료) 중 드랍 통계가 있는 것.
  표본(times) **100회 미만 행은 버림**, 재료당 상위 **8개 스테이지**만 (기대 이성 오름차순).
- **효율 지표 = 개당 기대 이성 = apCost ÷ 드랍률** (낮을수록 좋음). 첫 행이 "최고 효율" 배지.
- 스테이지 성격 태그: MAIN/SUB=상시(무표시), `_perm`/`_rep`=상설, DAILY=물자, 그 외=이벤트 한정.
  UI에 "상시 파밍 가능만" 토글 있음 (이벤트 한정 제외).
- **커뮤니티 별칭 검색** (사용자 확정): farm.tsx의 `SEARCH_ALIASES`에서 관리 — 오줌=아케톤류,
  돌=원암류+RMA70-24, 장치/좆치=장치류, 방석=연마석류, 젤리=콜류, 별사탕=RMA70류.
  데이터 재생성과 무관하게 유지되며, 새 별칭은 사용자 확정 후 추가.
- 재료 아이콘은 yuanyan3060 레포 `item/<iconId>.png` → `public/items/<itemId>.png` (스크립트가
  자동 다운로드, 있으면 스킵). 이름은 farm.json에 {ko,en,ja} 인라인이라 extra-i18n과 무관.
- 갱신: 이벤트 개방/종료나 신규 재료 때마다 `python3 scripts/build-farm.py <gamedata-dir>`
  재실행 (item/stage_table도 kr/en/jp 필요 — scripts/README §5).

---

## 6.6 AI 스토리 요약 탭 (app/story.tsx)

- 구성: **이벤트 목록/썸네일**은 `scripts/build-story.py` → `app/data/stories.json` +
  `public/story/<eventId>.jpg` (자동), **요약 본문**은 `app/data/story-summaries.json`
  (AI(Claude)가 스토리 스크립트 전문을 정독하고 직접 집필 — 스크립트가 만들지 않음).
- 데이터 소스: 클뜯 `excel/story_review_table.json`(kr/en/jp, 이벤트 제목·에피소드 구성),
  이미지는 `ArknightsAssets/ArknightsAssets2`(cn 브랜치) — 썸네일
  `assets/dyn/arts/ui/storyreview/hubs/activity/storyentrypic_*.png`,
  컷씬 CG `assets/dyn/avg/images/*.png`. sips로 jpeg 변환(컷씬은 1080px 리사이즈).
- 수록 범위: `entryType == "ACTIVITY"`(사이드 스토리)만. 요약이 있는 이벤트만 카드가 열리고
  나머지는 "요약 준비 중" 표시. 상세는 `#story-<id>` 해시로 공유/뒤로가기 가능.
- **요약 집필 규칙** (.claude/skills/story-summary 스킬 참조): 스크립트 전문 정독 후
  1만 자 미만, 유쾌한 말투(농담 허용)로, 결말 포함 전체 스포일러. 컷씬 CG를 본문 중간중간
  배치(`--cuts <eventId>`로 다운로드). **본문은 한국어 전용**(사용자 확정 2026-07) —
  EN/JA 라우트에선 "한국어로만 제공" 안내가 자동 표시됨.
- summary JSON 블록 형식: `{t:"h"|"p"|"img"|"quote", x, src, cap, who}` — p/quote의
  `**굵게**`는 rich()로 렌더링.

---

## 7. Supabase 피드백 (제안·오류 리포트·편성 제안)

- 프로젝트: Mmtt85's Org / `exirlkhpkgxsflbglhld.supabase.co`. 테이블 생성 SQL은
  [supabase-setup.sql](supabase-setup.sql) — `feedback` 테이블 하나, **익명은 INSERT만**(RLS),
  조회는 Supabase 대시보드 Table Editor에서.
- 클라이언트는 supabase-js 없이 REST 직접 호출 (`app/feedback.ts`). anon(publishable) 키가
  `PASTE_ANON_KEY_HERE`인 동안 위젯·제안 버튼은 렌더링되지 않는다 (`feedbackReady`).
- 종류(kind): `feature`(기능 제안) / `data_error`(데이터 오류) / `plan`(편성 제안 — payload에
  scope: 'base' 또는 시설 key, assignments/shifts, 점수 포함).
- UI: 우하단 플로팅 위젯(전 탭 공통, 열고 닫기), 플래너 헤더 "전체 편성 제안"(커스텀 확인
  다이얼로그), 시설 모달 "이 편성을 제안". ⚠️ **이 런타임은 `window.prompt/confirm/alert`가
  차단됨** — 확인창은 반드시 커스텀 React 다이얼로그로 구현할 것.
- 관리자 `/admin`: 비번(RLS `x-admin-key`) 입장, 종류 필터, 삭제, **확인완료 토글**
  (reviewed_at), 새로고침. 미확정/예정 데이터는 UI에서 "추가 예정" 배지로만 표시.
- 공채 "추가 예정"(`RECRUIT_PENDING`): pending 플래그 → 조합 결과에 "추가 예정" 배지.
  실제 적용되면 `RECRUIT_SUPPLEMENT`로 옮기거나 데이터마인 반영을 기다린다.

## 8. 디자인 시스템

- 팔레트: `--ink #131719 / --paper #f1f0eb / --lime #dfff00` 계열, 각 오퍼 `accent` 색.
  신규 오퍼 accent는 `regen-operators.py`의 `NEW_ACCENTS`에 추가.
- CSS는 `app/globals.css` 단일 파일 (배포본에서 복원한 스타일 + 플래너/공채 추가분).
- 한 줄 압축 스타일(`selector { ... }`)을 유지한다. 미디어쿼리는 `width<=NNNpx` 표기.

---

## 9. 신규 버전 대응 체크리스트

1. §3 파이프라인 실행 (아바타 200 확인 포함, **build-i18n.py까지**).
2. 신규 오퍼의 인프라 스킬 파싱 확인 → 새 토큰/조건 문구면 INFRA-RULES.md §9 절차.
   새 포인트 토큰이 생기면 `app/i18n.tsx`의 TOKEN_I18N에 EN/JA 명칭도 추가
   (클뜯 en/jp building_data의 같은 buffId 설명에서 공식 명칭 확인).
3. 신규 오퍼가 시너지 팟 앵커(진영/텍스트)에 걸리는지 확인 — 새 팟이 필요하면
   retag-concepts.py의 POTS에 추가하고 home.tsx `SYNERGY_POTS`와 순서 동기화,
   `app/i18n.tsx` CONCEPT_I18N에 EN/JA 표시명 추가.
4. 공채 풀 변동 확인 (recruitDetail 파싱 경고 로그 확인).
5. 빌드 → 커밋 → 푸시 (배포는 사용자가 직접 — §1 운영 수칙).
