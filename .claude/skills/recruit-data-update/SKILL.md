---
name: recruit-data-update
description: 명일방주 KR 공개모집(공채) 데이터를 클뜯 레포의 gacha_table에서 파싱해 recruit.json을 재생성한다. "공채 데이터 갱신", "공채 풀 뜯어와", "모집 태그 업데이트" 같은 요청에 사용.
---

# 공채(공개모집) 데이터 갱신

`app/data/recruit.json`(공채 태그 + 모집 풀)을 클뜯 레포에서 재생성한다.
**손으로 고치지 않고 파이프라인으로 재생성한다.** 상세는 [scripts/README.md](../../../scripts/README.md), 공채 도메인 규칙은 [docs/PROJECT-GUIDE.md](../../../docs/PROJECT-GUIDE.md) / 메모리(공채 1·2성 규칙).

## 데이터 소스

- **`ArknightsAssets/ArknightsGamedata` 레포, `kr` 폴더, `master` 브랜치** (Kengxxiao 금지).
  - `kr/gamedata/excel/gacha_table.json` → `kr_gacha_table.json` (모집 풀·`recruitDetail`)
  - 성별 태그(남성/여성)는 핸드북 프로필의 `[성별]`에서 뽑으므로 `kr_handbook_info_table.json`도 필요.
  - 태그·성급 정보는 `kr_character_table.json`.

## 절차

1. 위 테이블을 스크래치 폴더(예: `.gamedata/`)에 `kr_<name>.json`으로 다운로드.
2. 재생성:
   ```bash
   python3 scripts/build-recruit.py .gamedata    # → app/data/recruit.json
   ```
   - 풀은 `gacha_table`의 `recruitDetail` 텍스트에서 파싱.
   - 5성 → 특별 채용, 6성 → 고급 특별 채용 자격 태그 자동 부여.
   - 태그/풀이 바뀌었으면 `python3 scripts/build-i18n.py .gamedata`도 실행해
     EN/JA 오버레이(extra-i18n.*.json)를 동기화 (en/jp gacha·character 테이블 필요).
3. **검증**: `git diff`로 신규 오퍼/태그 변경만 반영됐는지 확인.
4. **빌드 → 커밋 → 푸시까지만**. **`scripts/deploy.sh` 자동 실행 금지**(2026-07 규칙) — 배포는 사용자가 직접.

## 지켜야 할 규칙 (사용자 확인)

- 공채 태그에서 **남성/여성 태그는 삭제됨**(공식에서 빠짐) — 되살리지 말 것.
- **1·2성은 태그 게이트 없이** 시간 조건만으로 노출(1성 `3:50 이하`, 2성 `7:30 이하`). **로봇 태그는 필수가 아님**(사용자 정정).
- 6성은 `고급 특별 채용` 태그가 있어야 확정. 4·5성 저격 조합 사전(SNIPE_DICT)은 3성+ 기준(9시간) 유지.
- 조합 평가 로직은 app/recruit.tsx의 `evaluate()`에 있음 — 데이터만 갱신하고 규칙 변경은 사용자 확인 후.
