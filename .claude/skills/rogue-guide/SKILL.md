---
name: rogue-guide
description: 통합전략(IS) 가이드 탭(/rogue)의 데이터 재생성·신규 토픽 추가·UI 규칙. "통합전략 데이터 갱신해줘", "IS3(미즈키) 추가해줘", "rogue 가이드 고쳐줘" 같은 요청에 사용.
---

# 통합전략 가이드 탭 (/rogue)

첫 토픽 = 팬텀 & 크림슨 솔리테어(rogue_1). 2026-07-17 구축.
**명칭 규칙: 표시 문구는 반드시 '통합전략'(EN: Integrated Strategies / JA: 統合戦略).
'로그라이크'는 화면에 절대 노출 금지** — 내부 코드 id(rogue_N)는 유지.

## 데이터 파이프라인

```bash
python3 scripts/build-rogue.py            # → app/data/rogue1.json (~300KB)
python3 scripts/build-rogue.py --icons    # 유물·도구 아이콘 언팩 (UnityPy·lz4inv 필요)
```

- 소스는 전부 클뜯 레포 (PROJECT-GUIDE §2, Kengxxiao 금지):
  - `kr/gamedata/excel/roguelike_topic_table.json` — 존·스테이지·유물·음반·환각·난이도·엔딩·조우
  - `kr/gamedata/levels/obt/roguelike/roN/*.json` — 등장 적(enemyDbRefs)·스폰 수(waves+branches)·**긴급 배율(runes: difficultyMask=FOUR_STAR의 enemy_attribute_mul)**
  - `kr/gamedata/levels/enemydata/enemy_database.json` (15MB) — 적 스탯. `{m_defined,m_value}` 언랩, 레벨 파일 overwrittenData가 최종 오버라이드
  - `kr/gamedata/excel/enemy_handbook_table.json` — 적 이름·급(NORMAL/ELITE/BOSS)·공격방식·능력
- 캐시: `.gamedata/rogue/` (gitignore). 재다운로드하려면 캐시 삭제.
- **모든 문자열에 sanitize 적용** — `<@ro.lose>1</>`·`<color=...>` 류 게임 마크업은 제거,
  `<독가스>` 같은 한글 꺾쇠 강조는 보존 (정규식 `</?[@$a-zA-Z][^>]*>|</>`).

### 스테이지 id 규칙 (rogue_1 기준)
`ro1_n_<층>_<i>`=작전 · `ro1_e_<층>_<i>`=긴급(같은 levelId 공유 — 룬만 추가) ·
`ro1_b_<i>`=험난한 길(보스) · `ro1_ev_<i>`=조우 전투 · `ro1_t_<i>`=특수(심층 조사).

### 이미지 (public/rogue/)
| 폴더 | 소스 | 비고 |
|---|---|---|
| `map/` | `ASSETS/arts/ui/stage/mappreviews/<stageId>.png` | 인게임 프리뷰(512² 풀블리드). 없으면 mapData 격자 렌더 폴백 |
| `enemy/` | `ASSETS/arts/enemies/<id>.png` | 변종 `_N`은 원본 id로 폴백 (`e["img"]`=실제 파일명) |
| `scene/` | `ASSETS/avg/images/<choiceScenes.background>.png` | 조우 CG |
| `capsule/` | `ASSETS/ui/rogueliketopic/topics/<topic>/capsule/` | 음반(레퍼토리) 자켓 |
| `zone/` | `ASSETS/ui/rogueliketopic/topics/<topic>_update/levelbgpic/` | 존 배경 |
| `relic/` | KR CDN `spritepack/ui_roguelike_topic_item_h1_<topic>_0.ab` 언팩 | `--icons` 모드. **깃허브 레포엔 없음** (아틀라스 패킹) |

## 수작업 큐레이션 (scripts/rogueN-curated.json)

클라 테이블에 없는 정보 — 빌드 시 병합:
- `encounterFloors`: 조우별 출현 층. **PRTS `<테마명>/事件一览` wikitext의 `floor=` 필드** 전사
  (rest/ent/treasure 계열은 floor 필드 없음 — 노드 배치 서술로만 확인).
- `encounterNotes`: 분기 조건(아이템 소지 시 등장 등).
- `endingConds`: 엔딩별 선제조건 스텝 배열. **「이름」 표기는 데이터의 공식 KR 명칭과
  글자 단위로 일치**시켜야 UI가 자동 링크한다 (아래 renderCond).
- `bossFloors`: 험난한 길 층 배정. rogue_1(사용자 확인): b_1~5=3층, b_6~7=5층, b_8~9=히든 6층.

## UI 규칙 (app/rogue.tsx + globals.css .rg-*)

- **크림슨 극장 다크 테마**: `.rg` 로컬 변수 `--rgbg #150a0e / --rgcard #211218 /
  --rgcrim #c23b4e / --rggold #c9a35c / --rgink #ead9c8`. 키비주얼 히어로 헤더.
- **층 카드 = 아코디언** (기본 접힘). 존 배경 img는 **반드시 `<summary>` 안에** —
  details 직속이면 닫힌 층이 열려 보이는 버그. 그리드에 `align-items:start` 필수
  (없으면 옆 카드가 행 높이만큼 늘어나 빈 채로 열려 보임).
- **일반/긴급은 카드 하나로 통합** — StagePair {n, e}. 모달 안 [일반 작전|긴급 작전] 탭 전환.
  모달은 `key={pair.n.id}`로 재마운트 (effect로 mode 리셋 금지 — lint 에러).
- **맵 미리보기: 16:9로 늘려서(fill) 표시** — 크롭 금지, 인게임과 동일 (사용자 확정).
  전투 노드 카드는 **한 줄 3개 고정**.
- **모달 4종**: StageModal(적 행 클릭→EnemyModal 스택) · EnemyModal(초상·전체 스탯·등장
  노드) · EncounterModal(CG·층·선택지) · RelicModal(아이콘·효과). 스택 모달은
  `.rg-modal-back.stack`(z-index 90).
- **renderCond**: 엔딩 조건 문장의 `「이름」`을 스테이지→조우→유물→적 순으로 매칭해
  클릭 가능한 모달 링크로 렌더. 새 조건 문안 추가 시 매칭 검증 스크립트로 미매핑 확인.
- **난이도 탭**: 등급 행 클릭 → 상단 난이도 선택 연동.
- 섹션 해시 딥링크: `#rg-map / #rg-enemy / #rg-archive / #rg-hallu / #rg-diff / #rg-ending`.

### 난이도 스탯 적용 (applyDiff — ruleDesc 근거 하드코딩)
- g5+: 정예·리더 HP ×1.2
- g10+: 긴급 작전·험난한 길 공격/HP ×1.15
- g14+: 정예·리더 등장 20초 공격 ×1.3 (한시 — 별도 뱃지 표기만)
- 긴급 작전 자체는 스테이지별 레벨 룬 배율(emg) 추가 적용.
- 검증 예: 덕로드 45,000 ×1.9(룬) ×1.2 ×1.15 = 117,990.

## 새 토픽 추가 절차 (rogue_2~)

1. build-rogue.py의 build_rogue1을 토픽 파라미터화(또는 복제). 스테이지 id 접두(roN_) 동일.
2. 토픽 고유 시스템 필드 추가: IS2=환각(variationData+fusionData), IS3=붕괴,
   IS5=부적·승천 — details의 해당 필드를 확인해 스키마 확장.
3. PRTS `<테마명>/事件一览`에서 조우 층 규칙 리서치 → rogueN-curated.json 작성
   (엔딩 조건은 메인 문서 结局/进入方式 문단).
4. `--icons <topic>`으로 아이콘 언팩, 이미지 다운로드는 기본 모드가 처리.
5. UI는 토픽 셀렉터(현재 "다른 테마는 준비 중" 자리)를 활성화해 데이터 스위칭.
6. rogue_6(볼리바르)은 CN 텍스트만 존재·에셋 미러링 안 됨(2026-07) — KR 출시 후 진행.

## 마무리 (CLAUDE.md 수칙)

- 한국어 UI 문구 추가 시 `app/i18n.tsx` 사전에 EN/JA 병기.
- `npm run build` + `npx eslint app/rogue.tsx` 통과 확인 → **커밋 → push까지만**.
  `scripts/deploy.sh` 자동 실행 금지 (배포는 사용자가 직접).
