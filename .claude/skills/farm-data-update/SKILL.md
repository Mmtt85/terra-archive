---
name: farm-data-update
description: 명일방주 재료 파밍 효율표 데이터(farm.json)를 클뜯 item/stage_table + 펭귄 물류 실측 드랍률에서 재생성한다. "파밍 데이터 갱신", "재료 효율표 업데이트", "이벤트 열렸으니 파밍표 다시 뽑아줘" 같은 요청에 사용.
---

# 재료 파밍 효율표 데이터 갱신

`app/data/farm.json`(재료 50종+ × 스테이지별 실측 드랍률·기대 이성)과 `public/items/` 재료
아이콘을 재생성한다. **손으로 고치지 않고 파이프라인으로 재생성한다.**
상세 규칙은 [docs/PROJECT-GUIDE.md](../../../docs/PROJECT-GUIDE.md) §6.5,
실행 명령은 [scripts/README.md](../../../scripts/README.md) §5.

## 언제 갱신하나

- **/admin "데이터 상태" 섹션이 "재료 파밍표 갱신 필요"를 띄울 때** — 크론 워커가 매일
  11:41 KST 펭귄 물류에서 "지금 KR에 열린 파밍 스테이지·재료" 세트를 수집해 두면,
  admin이 farm.json에 박힌 빌드 시점 세트(`openStages`/`items`)와 브라우저에서 비교해
  이벤트 개폐·신규 재료를 감지한다 (workers/broadcast의 farmCheck).
- **이벤트가 열리거나 닫혔을 때** — 펭귄 매트릭스는 "현재 KR에 개방된 존"만 반환하므로,
  이벤트 개폐 시점마다 재실행해야 스테이지 목록이 실제와 일치한다.
- 신규 챕터/신규 재료가 KR에 추가됐을 때 (신규 재료 아이콘도 자동 다운로드됨).
- 사용자가 "드랍률이 요즘 수치랑 다르다"고 할 때 (표본 누적으로 수치가 갱신됨).

## 데이터 소스

- **클뜯**: `ArknightsAssets/ArknightsGamedata` 레포 `master` 브랜치 (Kengxxiao 금지)
  - `{kr,en,jp}/gamedata/excel/item_table.json` → `<prefix>_item_table.json` (재료 이름 3개 언어·등급·iconId)
  - `{kr,en,jp}/gamedata/excel/stage_table.json` → `<prefix>_stage_table.json` (스테이지 이름 3개 언어)
- **펭귄 물류 API** (스크립트가 실시간 조회 — 네트워크 필요):
  - `https://penguin-stats.io/PenguinStats/api/v2/stages?server=KR` (이성 소모·코드·KR 개방 여부)
  - `…/result/matrix?server=KR&show_closed_zones=false` (실측 드랍 통계, 열린 존만)
- **아이콘**: `yuanyan3060/ArknightsGameResource` 레포 `item/<iconId>.png` →
  `public/items/<itemId>.png` (있으면 스킵, 실패 시 종료코드 1)

## 절차

1. 위 클뜯 테이블 6개를 스크래치 폴더(예: `.gamedata/`)에 `<prefix>_<name>.json`으로 다운로드.
2. 재생성:
   ```bash
   python3 scripts/build-farm.py .gamedata   # → app/data/farm.json + public/items/
   ```
3. **검증**: 스크립트 출력의 재료 수(현재 50종, T1~T4)와 `git diff`로 변경 폭 확인.
   재료 수가 크게 줄었으면 펭귄 API 응답 이상이나 파서 회귀 — 원인 파악 후 진행.
4. **빌드 → 커밋 → 푸시까지만**. **`scripts/deploy.sh` 자동 실행 금지**(2026-07 규칙) —
   배포는 사용자가 직접.

## 지켜야 할 규칙

- **수록 기준**: 5자리 숫자 id의 MATERIAL(30xxx/31xxx 정예화 재료)만. 작전기록·용문폐·칩·
  스킬개론 등은 넣지 않는다 (사용자가 원하면 별도 확정 후).
- **효율 지표 = 개당 기대 이성 = apCost ÷ 드랍률** (낮을수록 좋음). 재료당 상위 8개
  스테이지, 첫 행이 "최고 효율" 배지. 표본 100회 미만(`MIN_TIMES`) 행은 신뢰 불가로 버린다.
- KR 미개방 스테이지(`existence.KR.exist == false`)는 절대 수록하지 않는다.
- 스테이지 성격: MAIN/SUB=상시(무표시) · `_perm`/`_rep`=상설 · DAILY=물자 · 그 외=이벤트 한정.
- farm.json은 이름이 {ko,en,ja} 인라인이라 **build-i18n.py와 무관** — 단독 재실행 가능.
- UI 문구를 바꾸면 `app/i18n.tsx` 사전 키도 함께 갱신 (3개 언어 규칙).
