# story-scripts — 원본 스토리 스크립트 보관소

AI 스토리 요약·테라 연대기 작업용 **원본 게임 스크립트**(한국판)를 이벤트별로 보관한다.
tmp가 아니라 레포에 두는 이유: 다른 세션/컴퓨터에서 작업을 이어가기 위함.

- 출처: 클뜯 레포 `ArknightsAssets/ArknightsGamedata` → `kr/gamedata/story/activities/<eventId>/level_*.txt`
- 파일명 = 스테이지 스크립트 (`level_<eventId>_<stage>_(beg|end).txt`, `_stNN` = 막간).
  스크립트 목록·순서는 `story_review_table.json`의 `infoUnlockDatas[].storyTxt` 순서를 따른다.
- 형식: `[명령(...)]` 연출 태그 + 지문/대사 줄. `[name="..."]` = 화자.

## 현재 보관 — 전체 (연대 비교 작업용)
- **KR 스토리 스크립트 전량**: `story_review_table.json`의 모든 그룹(441개) × 스크립트(1825개).
  - 메인스토리 `main_0`~`main_16`, 사이드 이벤트(`act__side`), 미니 이벤트(`act__mini`), 초기 이벤트(`1stact` 등) 포함.
  - 폴더명 = story_review_table 그룹 id, 파일 = 스테이지 스크립트 basename.
- **누락**: `act24side`(불을 쫓는 낙엽) — KR 클뜯 레포에 폴더 자체가 없음(act23side→act25side로 건너뜀). 소스 미포함.
- 재다운로드: story_review_table의 `infoUnlockDatas[].storyTxt`를 `kr/gamedata/story/<storyTxt>.txt`에서 받아 `story-scripts/<그룹id>/<basename>.txt`로 저장.

## 연대기 관련 메모 (테라력 조사)
- 스크립트에 **"테라력"이라는 단어는 없음**. 시간 표현은 대부분 **상대**("200년 전", "5년 전").
- 다만 **절대 연도**가 지문에 드물게 박혀 있음: 스툴티페라 나비스 "고요함(대침묵) 사건 = **1038년**",
  아테누스 복수록 "**1100년**". → grep으로 일괄 추출은 불가, 이벤트별 정독으로 앵커 연도를 잡아야 함.
