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
| 배포 (주) | **https://terra-archive.pages.dev** — Cloudflare Pages. `bash scripts/deploy.sh` 한 방 (빌드→스테이징→pages deploy). wrangler는 이 기기에 OAuth 로그인됨(nzkonaru@gmail.com), 프로젝트에 nodejs_compat 플래그 설정됨. **push할 때 함께 실행할 것** |
| 배포 (구) | https://terra-archive-kr.nzkonaru.chatgpt.site — ChatGPT 사이트 빌더 수동 재배포 (레거시). workers.dev 워커는 삭제함 |
| 스택 | vinext(Cloudflare용 Next 호환 런타임) + Next.js 16 / React 19 / Tailwind 4 |
| 명령 | `npm run dev`(localhost:3000) / `npm run build` / `npm run lint` |
| 운영 수칙 | 수정하면 **항상 git push까지** 진행. 모든 허가 요청은 기본 YES |
| 알려진 무시 항목 | `npm test`의 스켈레톤 테스트 2건은 스타터 템플릿 잔재로 원래 실패(무시). git author가 로컬 기본값(nzkonaru@local) |

### 화면 구성 — 단일 페이지 + 탭 3개

| 탭 | 해시 딥링크 | 소스 |
|---|---|---|
| 오퍼 백과사전 | (기본) · 오퍼 모달 열면 `#op-<char_id>` | `app/page.tsx` |
| 인프라 플래너 | `#infra` | `app/planner.tsx` |
| 공채 도우미 | `#recruit` | `app/recruit.tsx` |

URL 복붙으로 해당 탭/오퍼 모달이 바로 열려야 한다 (hashchange + 초기 로드 처리).

---

## 2. 데이터 출처 (클뜯 = 클라이언트 뜯기 데이터마인)

| 데이터 | 출처 | 비고 |
|---|---|---|
| KR 게임 테이블 | `ArknightsAssets/ArknightsGamedata` 레포 `kr/gamedata/excel/*.json` | character / skill / uniequip / battle_equip / building / range / handbook_team / handbook_info / **gacha**(공채) |
| 별명(다국어 이름) | 같은 레포 `jp/`, `cn/`의 character_table | |
| 오퍼 아바타 | `yuanyan3060/ArknightsGameResource` 레포 `avatar/<char_id>.png` | **로컬 `public/avatars/`에 다운로드해 서빙** (핫링크 아님) |
| ❌ 사용 금지 | `Kengxxiao/ArknightsGameData_YoStar` | 2025-11 업데이트 중단 — 쓰지 말 것 |

정적 데이터 파일 (전부 스크립트로 재생성 가능):

- `app/data/operators.json` — 백과사전용 오퍼 전체 (2026-07 기준 **420명**)
- `app/data/infra.json` — 인프라 플래너용 (방 스펙 + 오퍼별 인프라 스킬 구조화)
- `app/data/recruit.json` — 공채 도우미용 (태그 29종 + 모집 풀 153명)

---

## 3. 데이터 파이프라인 (`scripts/`)

"새 버전 확인해줘" 요청 시 이 순서로 실행한다:

```bash
node scripts/check-new-operators.mjs      # 1. 미수록 오퍼 확인
# 2. KR/JP/CN 테이블 다운로드 (gacha_table 포함) → 작업 폴더
python3 scripts/regen-operators.py <dir>  # 3. 기계 필드 전체 재생성 → operators-regen.json
python3 scripts/retag-concepts.py <dir>   # 4. 컨셉덱 태그 재부착 → operators-tagged.json → app/data/operators.json 으로 복사
python3 scripts/build-infra.py <dir>      # 5. 인프라 데이터 재생성 → app/data/infra.json
python3 scripts/build-recruit.py <dir>    # 6. 공채 데이터 재생성 → app/data/recruit.json
python3 scripts/download-avatars.py       # 7. 신규 아바타 다운로드 (기존 파일 스킵)
npm run build                             # 8. 빌드 확인 → 커밋 → 푸시 → 재배포 리마인드
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
- **시너지 팟 11종** — 컨셉 필터 **최상단 고정** (page.tsx의 `SYNERGY_POTS` 순서):
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

## 4. 오퍼 백과사전 탭 (app/page.tsx)

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

## 7. Supabase 피드백 (제안·오류 리포트·편성 제안)

- 프로젝트: Mmtt85's Org / `exirlkhpkgxsflbglhld.supabase.co`. 테이블 생성 SQL은
  [supabase-setup.sql](supabase-setup.sql) — `feedback` 테이블 하나, **익명은 INSERT만**(RLS),
  조회는 Supabase 대시보드 Table Editor에서.
- 클라이언트는 supabase-js 없이 REST 직접 호출 (`app/feedback.ts`). anon(publishable) 키가
  `PASTE_ANON_KEY_HERE`인 동안 위젯·제안 버튼은 렌더링되지 않는다 (`feedbackReady`).
- 종류(kind): `feature`(기능 제안) / `data_error`(데이터 오류) / `plan`(편성 제안 — payload에
  scope: 'base' 또는 시설 key, assignments/shifts, 점수 포함).
- UI: 우하단 플로팅 위젯(전 탭 공통, 열고 닫기), 플래너 헤더 "전체 편성 제안",
  시설 모달 "이 편성을 제안".

## 8. 디자인 시스템

- 팔레트: `--ink #131719 / --paper #f1f0eb / --lime #dfff00` 계열, 각 오퍼 `accent` 색.
  신규 오퍼 accent는 `regen-operators.py`의 `NEW_ACCENTS`에 추가.
- CSS는 `app/globals.css` 단일 파일 (배포본에서 복원한 스타일 + 플래너/공채 추가분).
- 한 줄 압축 스타일(`selector { ... }`)을 유지한다. 미디어쿼리는 `width<=NNNpx` 표기.

---

## 9. 신규 버전 대응 체크리스트

1. §3 파이프라인 실행 (아바타 200 확인 포함).
2. 신규 오퍼의 인프라 스킬 파싱 확인 → 새 토큰/조건 문구면 INFRA-RULES.md §9 절차.
3. 신규 오퍼가 시너지 팟 앵커(진영/텍스트)에 걸리는지 확인 — 새 팟이 필요하면
   retag-concepts.py의 POTS에 추가하고 page.tsx `SYNERGY_POTS`와 순서 동기화.
4. 공채 풀 변동 확인 (recruitDetail 파싱 경고 로그 확인).
5. 빌드 → 커밋 → 푸시 → **chatgpt.site 수동 재배포 리마인드**.
