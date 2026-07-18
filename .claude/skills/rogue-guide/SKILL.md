---
name: rogue-guide
description: 통합전략(IS) 가이드 탭(/rogue)의 데이터 재생성·신규 토픽 추가·UI 규칙. "통합전략 데이터 갱신해줘", "IS3(미즈키) 추가해줘", "rogue 가이드 고쳐줘" 같은 요청에 사용.
---

# 통합전략 가이드 탭 (/rogue)

토픽 2종 가동: 팬텀 & 크림슨 솔리테어(rogue_1, KR 정식) + 침몰자의 흑류수해(rogue_6,
CN 선행·미래시 전용). 2026-07-17 구축.
**명칭 규칙: 표시 문구는 반드시 '통합전략'(EN: Integrated Strategies / JA: 統合戦略).
'로그라이크'는 화면에 절대 노출 금지** — 내부 코드 id(rogue_N)는 유지.

## 데이터 파이프라인

```bash
python3 scripts/build-rogue.py            # → app/data/rogue1.json (~300KB)
python3 scripts/build-rogue.py rogue6     # → app/data/rogue6.json (~425KB, CN 소스)
python3 scripts/build-rogue.py --icons rogue_6  # 아이콘 언팩 (UnityPy·lz4inv 필요)
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

### 긴급(FOUR_STAR) 룬 해석 — ⚠ 키가 레벨마다 다르다
- `enemy_attribute_mul`/`add` — 전역 배율 (bb마다 스탯 하나)
- `ebuff_attribute` — 전역 배율(bb에 스탯 여러 개). **bb에 `enemy` 셀렉터가 있으면
  특정 적 한정 배율** (`emg.per`) — `#N` 폼 접미는 strip
- `level_enemy_replace` — 긴급 시 적 교체 (`emg.replace` from→to). 교체 대상 적도
  used_enemies에 등록해야 도감·모달에 뜬다
- 이 셋을 모두 잡아야 긴급 36/36 전부 커버 (mul 키만 잡으면 16개가 빈다)

### 이미지 (public/rogue/)
| 폴더 | 소스 | 비고 |
|---|---|---|
| `map/` | `ASSETS/arts/ui/stage/mappreviews/<stageId>.png` | 인게임 프리뷰(512² 풀블리드). 없으면 mapData 격자 렌더 폴백 |
| `enemy/` | `ASSETS/arts/enemies/<id>.png` | 변종 `_N`은 원본 id로 폴백 (`e["img"]`=실제 파일명) |
| `scene/` | `ASSETS/avg/images/<choiceScenes.background>.png` | 조우 CG |
| `capsule/` | `ASSETS/ui/rogueliketopic/topics/<topic>/capsule/` | 음반(레퍼토리) 자켓 |
| `zone/` | `ASSETS/ui/rogueliketopic/topics/<topic>_update/levelbgpic/` | 존 배경 |
| `relic/` | KR CDN `spritepack/ui_roguelike_topic_item_h1_<topic>_0.ab` 언팩 | `--icons` 모드. **깃허브 레포엔 없음** (아틀라스 패킹) |
| `kv<N>.webp` | `topics/<topic>_update/entrykeyvisuals/<kv폴더>/` 좌/우 반쪽 2장(각 780×960) **가로 합성** | 히어로 배경. 파일명 토픽마다 불규칙(KV_SRC 매핑). ⚠ kv3(사미)는 좌측에 CN 제목이 박혀 있어 커밋본은 하늘 그라데이션 보간으로 텍스트를 지운 가공본 — 재생성 금지 |

### 적 상세 (공격 방식·능력) — 2026-07-18 확정
핸드북의 `attackType`/`ability` 상위 필드는 **폐기(전부 null)** — `damageType` 배열(물리/마법
KR 매핑 attack_of)과 `abilityList[].text`(개행 join, ability_of)에서 뽑는다. UI는
.rg-emodal-ability에 white-space:pre-line. 이걸 안 하면 적 상세 모달에 공격 방식·능력이 안 뜬다.

### 유물 정렬
전시관 유물은 **유물번호(archiveComp orderId) 오름차순** (사용자 확정) — 숫자 번호 먼저,
특수 번호(PCS01 등)는 그 뒤, 번호 없는 항목은 맨 뒤. relicSortId는 거의 전부 1이라 쓰지 말 것.

## 수작업 큐레이션 (scripts/rogueN-curated.json)

클라 테이블에 없는 정보 — 빌드 시 병합:
- `encounterFloors`: 조우별 출현 층. **PRTS `<테마명>/事件一览` wikitext의 `floor=` 필드** 전사
  (rest/ent/treasure 계열은 floor 필드 없음 — 노드 배치 서술로만 확인).
- `encounterNotes`: 분기 조건(아이템 소지 시 등장 등).
- `endingConds`: 엔딩별 선제조건 스텝 배열. **「이름」 표기는 데이터의 공식 KR 명칭과
  글자 단위로 일치**시켜야 UI가 자동 링크한다 (아래 renderCond).
- `bossFloors`: 험난한 길 층 배정. rogue_1(사용자 확인): b_1~5=3층, b_6~7=5층, b_8~9=히든 6층.
  rogue_2~4도 큐레이션 존재. **rogue_5(쉐이)는 PRTS 미정리로 bossFloors 아직 없음** — 층 미배정
  보스는 맵 뷰의 '험난한 길 (보스)' 폴백 아코디언(orphanBosses — 이름 없는 더미 보스 제외)에 뜬다.
  rogue5-curated.json은 **endingConds만** 채워져 있음(2026-07-18 — 나무위키+CN 공략 교차 검증,
  엔딩↔보스 매핑은 endings.bossIconId ↔ 보스전 적 id로 확정: 의법진무=b_4 파'쉐이'진사 /
  장권유흔=b_5 연기 같은 옛 글자 / 흑백현묘=b_6 쉐이를 꾀하는 자 / 무중생유=b_7 마지막 사냥 /
  낙장불입=b_8 기억 기록→b_9 절변·b_10 건곤).
- **조우 같은 제목 병합은 전 토픽 공통** (build_topic에도 적용, 2026-07-18): 같은 제목의
  enter 씬을 하나로 병합(선택지 dedupe 합집합) — rogue3 111→45, rogue5 114→58.

## UI 규칙 (app/rogue.tsx + globals.css .rg-*)

- **크림슨 극장 다크 테마**: `.rg` 로컬 변수 `--rgbg #150a0e / --rgcard #211218 /
  --rgcrim #c23b4e / --rggold #c9a35c / --rgink #ead9c8`. 키비주얼 히어로 헤더.
  ⚠ **모달·입력·스탯 칩 등 컴포넌트 색은 하드코딩 금지** — 전부 테마 변수
  (--rgdeep 어두운 바탕 / --rgmodal 모달 배경 / --rgmodalline 모달 테두리 /
  --rgsel 선택 강조 / --rgtext2 본문색 / --rgup·--rgupbg 스탯 상승 강조)로 쓸 것.
  토픽 스킨(.rg.rg6)이 변수만 오버라이드해서 전체 색이 갈아입혀지는 구조다.
- **토픽 스킨 색 (사용자 확정 2026-07-18)**: rg2=칠흑 심해+시안(인게임 KV) ·
  rg3=**눈빛 은색**(설원 은백+얼음 시안 — 밝은 --rgcrim 위 흰 글자 요소는 #101722 잉크로
  대비 보정 오버라이드 필수) · rg4=**검붉은** 검은 왕관(핏빛 심홍+왕관 금) ·
  rg5=**파스텔 분홍**(연분홍 로즈+벚꽃 은백) · rg6=심해 청록.
- **하이드레이션 게이트**: 정적 프리렌더는 항상 rogue_1 — `mounted`
  (useSyncExternalStore, effect-내-setState 금지)로 마운트 전엔 로딩 셸만 렌더.
  lazy init으로 topicFromUrl()을 첫 렌더에 쓰면 ?topic= URL에서 하이드레이션 에러,
  rogue_1 고정 후 effect 반영이면 팬텀→해당 토픽 깜빡임 — 게이트가 유일한 정답.
  switchTopic은 **팬텀도 ?topic=is1**을 URL에 남긴다.
- **맵 탭 노드 이름 검색** (.rg-map-search, mapQ): 전투 노드 전 종류+우연한 만남을
  이름/CN 원문으로 통합 검색 — 검색 중엔 결과 패널만 렌더, 토픽 전환 시 리셋.
- **층 = 가로 일렬 카드 → 클릭 시 ZoneModal** (사용자 확정 2026-07 — 아코디언에서 변경).
  .rg-zone-cards는 **grid-column: 1/-1 필수** (.rg-map이 2열 그리드라 안 주면 한 칸에 갇힘),
  grid-auto-flow: column으로 합산 100% 폭 균등 분할. 번호 뱃지는 **'N층' 텍스트**.
  모달(.rg-zmodal, 980px)에 설명+작전/보스 카드. StageModal이 ZoneModal 위에 겹치도록
  렌더 순서는 ZoneModal 먼저. 조우 전투·추격전·부표·우연한 만남 등 광폭 섹션은 아코디언 유지.
  내용(이름·설명·버프)이 본 존과 동일한 변형 존(zone_4_1)은 빌더에서 중복 제거.
- ⚠ StageModal의 onOpenEnemy는 (key, ctx) 2인자 — 호출부에서 `{ key, ctx }`로 감싸
  setEnemyOpen에 넘길 것 (setEnemyOpen을 직접 넘기면 적 클릭이 무반응).
- **일반/긴급은 카드 하나로 통합** — StagePair {n, e}. 모달 안 [일반 작전|긴급 작전] 탭 전환.
  모달은 `key={pair.n.id}`로 재마운트 (effect로 mode 리셋 금지 — lint 에러).
- **맵 미리보기: 16:9로 늘려서(fill) 표시** — 크롭 금지, 인게임과 동일 (사용자 확정).
  전투 노드 카드 열 수(사용자 확정 2026-07-18): **층 모달(.rg-zmodal) 4개** ·
  **광폭 섹션(.rg-zone-wide — 조우 전투·추격전·기타 노드 등) 5개** · 기본 3개.
- **모달 4종**: StageModal(적 행 클릭→EnemyModal 스택) · EnemyModal(초상·전체 스탯·등장
  노드) · EncounterModal(CG·층·선택지) · RelicModal(아이콘·효과). 스택 모달은
  `.rg-modal-back.stack`(z-index 90).
- **스탯 컨텍스트 일관성 (사용자 리포트로 확정)**: EnemyModal은 연 곳의 StatCtx를 그대로
  물려받는다(스테이지 모달→긴급 룬·험난한 길 배율 포함, 도감→dexCtx). 도감은 험난한 길
  전용 적(보스)만 g10+ 배율 자동 적용. 반영된 배율은 .rg-ctx-note로 명시 — 도감/노드
  상세 수치가 달라 보이면 안 된다.
- **StageModal 맵 미리보기 클릭 → 2배 확대** (.rg-map-zoom, transform scale(2)
  좌상단 기준 — 레이아웃 밀지 않고 우측 열 위로 겹침). **축소는 아무 곳이나 클릭**
  (document 캡처 리스너가 클릭을 가로채 모달 닫힘·타 동작 차단, 사용자 확정 2026-07-18).
- **StageModal 적 정렬: 리더 → 정예 → 일반 → 공통 특수몹** — 전 테마 공통 길가 몹
  (고프닉·덕로드·동글이·눈물 흘리는 사내·상자 넝쿨·'게이트'·'창문'·시대의 흔적·진기한 장치·
  탐사용 자율차)은 데이터 플래그가 없어 rogue.tsx `SPECIAL_LAST` 이름 하드코딩 (사용자 확정
  2026-07-18). hideInStage 플래그는 록라 적 전반에 켜져 있어 판별자로 못 쓴다.
- **완전 동일 적 병합**: 이름·스탯·능력·이미지가 전부 같은 적 엔트리(시대의 흔적 x/y/z 등)는
  빌더 `merge_dup_enemies`가 하나로 병합 (긴급 룬 per/replace 참조 키는 보호). 시대의 흔적·
  탐사용 자율차는 **게임에 초상 에셋 자체가 없음** (arts/enemies 전수 확인) — ? 플레이스홀더가 정상.
- **적 도감은 가로형 카드** (사진 왼쪽·정보 오른쪽, .rg-enemy-cell.row) · **EnemyModal은
  초상을 원본 해상도(158px) 그대로 좌측에 크게** (.rg-emodal-portrait) — 피드백 반영 2026-07-18.
- **기타 노드 섹션**: nodeTypes에서 BATTLE_NORMAL/ELITE/BOSS/INCIDENT 제외 + 이름 중복 제거
  (운명의 암시 등) 렌더. **외나무다리(DUEL) 항목 안에 duel 전투 카드 포함** — 별도 외나무다리
  섹션은 없앴다 (사용자 확정 2026-07-18). 조우 목록 제목은 '우연한 만남'으로 단순화.
- **조우 목록에서 startbuff 씬('작전 보상'/'행동 보상') 제외** — 실제 노드가 아닌 탐험 시작
  보너스 씬 (빌더에서 필터, 사용자 확정 2026-07-18). 조우 bg는 `.png` 접미 제거+소문자 정규화
  (rogue_3 '백 리 막사' 40_i05.png / '치료 의식' 23_I08 케이스).
- **IS4 8층(영겁의 안식) = ro4_b_9** ('아미야', 노심의 종곡 히든 최종전). 원본 이름·설명이
  공백(미스터리 연출)이라 빌더가 "???"로 표기, bossFloors 큐레이션으로 8층 배정.
- **renderCond**: 엔딩 조건 문장의 `「이름」`을 스테이지→조우→유물→적 순으로 매칭해
  클릭 가능한 모달 링크로 렌더. 새 조건 문안 추가 시 매칭 검증 스크립트로 미매핑 확인.
- **난이도 탭**: 등급 행 클릭 → 상단 난이도 선택 연동.
- 섹션 해시 딥링크: `#rg-map / #rg-enemy / #rg-archive / #rg-hallu / #rg-diff / #rg-ending`.
- **난이도 슬라이더는 히어로 배너 안 우하단** (absolute, 반투명 패널 + 육각 등급 뱃지).
- **우연한 만남 목록**: CG 썸네일(93×50 — 수차례 조정 끝 사용자 확정) + 텍스트 세로 스택
  (층 뱃지 윗줄 → 이름 아랫줄), 층 오름차순 정렬, 클릭 → EncounterModal.
  ⚠ 옛 아코디언 시절 .rg-enc/.rg-enc-thumb(52×34) 규칙이 남아 있으면 크기를 덮어쓴다 — 제거됨.
  **EncounterModal은 2열**: 좌측 CG(.rg-modal-cols.enc — 좌열 468px), 우측 설명·비고·선택지.
- **다크 배경은 페이지 100% 폭**: RogueGuide가 `html.rg-theme` 클래스를 토글하고
  CSS가 body에 그라데이션을 칠한다 (.rg 자체 배경 금지 — 70%만 칠해짐).
- **전역 레이아웃(전 탭 공통, 2026-07-18 확정)**: 1400px 이상에서 본문 직계 섹션에
  `margin-inline: 15%` + **width:auto/max-width:none 강제**(섹션별 자체 폭 920~1600px
  무효화 — 전 페이지가 정확히 가운데 70% 컬럼). 셀렉터는
  `main.site-main > :not(.site-header):not(footer):not(.modal-backdrop):not(.feedback-widget)`
  — **fixed 오버레이(.modal-backdrop 등)를 :not으로 함께 제외해야 한다**(margin이 남으면
  fixed inset:0 백드롭 블러가 가운데 70%만 덮는다. 별도 예외 규칙은 :not 체인 특이도에
  져서 안 먹음). 헤더·푸터는 배경 100% 폭에 내부 padding-inline 15%로 정렬. 푸터는
  main이 flex 컬럼(min-height 100dvh) + footer margin-top:auto로 항상 화면 하단.
  제안 버튼은 오른쪽 15% 기둥 가운데(right: calc(7.5% - 45px)).
- ⚠ **새 탭 추가 시 home.tsx `TAB_LABEL`에 반드시 항목 추가** — Record<Tab,string>이지만
  빌드가 타입체크를 안 해 누락돼도 통과된다. 누락되면 햄버거 버튼의 현재 탭 라벨이 빈다.
- 토픽 셀렉터: 미출시 테마는 disabled 버튼(준비 중), CN 선행(rogue_6)은
  `includeFuture`(미래시 데이터 포함 토글) 켜졌을 때만 노출 + "미래시" 뱃지.

### 난이도 스탯 적용 (applyDiff — ruleDesc 근거 하드코딩)
- g5+: 정예·리더 HP ×1.2
- g10+: 긴급 작전·험난한 길 공격/HP ×1.15
- g14+: 정예·리더 등장 20초 공격 ×1.3 (한시 — 별도 뱃지 표기만)
- 긴급 작전 자체는 스테이지별 레벨 룬 배율(emg) 추가 적용.
- 검증 예: 덕로드 45,000 ×1.9(룬) ×1.2 ×1.15 = 117,990.

## rogue_6 침몰자의 흑류수해 — CN 선행 토픽 (2026-07-17 구축)

- **소스는 cn 브랜치** (`fetch_json(path, "cn")`, 캐시 접두 `cn__`). KR 출시 후 branch="kr"로
  바꾸고 번역 오버레이 제거.
- **3단 번역**: ① KR/CN 테이블 교차 자동 사전(load_auto_tr — rogue_1~5 items·nodeType·적
  핸드북 같은 id 매칭) → ② `scripts/rogue6-ko.json` (CN 원문→한국어 수동 사전, AI 집필
  1,115건) → ③ 잔여분 `scripts/rogue6-untranslated.json` 리포트 (0건 유지할 것).
  ⚠ 매칭 전 sanitize에서 `\r\n`과 **리터럴 `\n`(백슬래시+n)** 을 실제 개행으로 정규화 —
  안 하면 여러 줄 문자열이 전부 미스매치.
- **중국어 병기 규칙 (사용자 확정)**: 이름류는 `cn` 필드에 원문 보존, UI는 `Nm` 컴포넌트로
  **중국어가 메인(윗줄), 한국어 번역이 다음 줄 서브**(.rg-sub — 블록. 인라인 병기용 .rg-cn과
  구분). 적 도감은 KR 공식 번역이 있어도 CN 원명 필수 병기(빌더에서 cn_name 별도 저장) —
  등장 노드 칩·모달 헤더·카드 전부 적용. 번역 사전에는 원문 유지용 항등 엔트리 가능(cnName).
- **IS6 고유 시스템**: 격자 존(행동력 이동)·실토피아(理念 10종×초기/중기/말기 + 方針 4종,
  modules.rogue_6.weather)·유토피아(variationData 9종 — 기이한 공간에서 가공품 소모로 히든
  구역 '흑담' 진입 시 적용되는 규칙)·부품(SCRAP 30: 자연물/가공품/개념체, modules.scrap)·
  유산(LEGACY 襁褓, 동명 중복은 대표 1개)·부표(NODE_BUOY 7, 지도 마커)·레퍼토리 없음
  (capsuleDict=None). 스테이지 접두: ro6_n/e(31쌍+e_t_3~5는 t와 페어)/b(10, _b=변형)/
  t(조우 전투 — 단 t_13~15는 예외)/duel(외나무다리 2)/c(추격전).
- **추격전 vs 거점전 (피드백+PRTS 확정 2026-07-18)**: 追猎(추격전)=c_1~c_4 계열 6종 —
  행동력 소진 시 강제 발생, 보스 층에선 _b 변형 보스(哀悼铁腕 등)가 그 대체판(그래서
  _b 보스는 원판과 같은 층). “居民”据点(거점전, BATTLE_SAVAGE)=**t_13~15**(“闹乐”/“纵怒”/
  “灭身”)가 정본 — 난이도(보밀등급) 4+ 전용 노드. **c_5~7은 같은 levelId의 미사용 중복
  등록이라 빌더에서 제외**(DUP_SKIP). kind: c→chase(추격전), t_13~15→savage(거점전).
- **난이도 규칙(applyDiff, rogue_6 분기)**: g5+ 모든 적 HP×1.3 / g8+ 정예·리더 공격×1.15 /
  g11+ 리더 받는 대미지 -20%(뱃지) / EASY 없음(기밀 등급 0~15만).
- **조우 병합**: 같은 제목의 enter 씬(溯源 19종 등)은 빌더에서 하나로 병합(선택지 합집합)
  — 안 하면 목록에 중복이 줄줄이 뜬다 (59→37). **선택지는 dedupe_choices로 제목+설명
  중복 제거 필수** — 다단계 씬은 후속 단계 선택지가 접두 매칭으로 전부 쓸려 들어와 같은
  선택지가 수십 번 반복된다 (回滚文明 24→10, 사용자 리포트 2026-07-18).
- **전투 노드 적 목록 정렬**: StageModal의 적은 **리더 → 정예 → 일반** 순 (사용자 확정
  2026-07-18).
- **큐레이션** `scripts/rogue6-curated.json`: bossFloors(3층=b_1~b_3 전원 — **_b 변형도
  원판과 같은 층** / 5층=b_4·b_4_b·b_5 / 6층=b_6 — PRTS+피드백), endingConds 3종(강제
  재부팅/차원 재구축/얽힘, 조화). encounterFloors는 PRTS 事件一览에 floor 필드가 아직
  없어 빈 채 — 문서 보강 후 채울 것.
- **이미지**: 전부 ArknightsAssets2 cn 브랜치에 있음(맵 프리뷰 105/105, 존 배경
  rogue_6_map_1~6, KV=entrykeyvisuals/rogue_kv_default/bg.png→kv6.webp, 날씨·유토피아·부표
  아이콘=topics/rogue_6/misc/→public/rogue/misc/). **유물·부품 아이콘은 CN 공식 CDN 언팩**
  (`--icons rogue_6` — network_config를 ak-conf.hypergryph.com으로 스위치, 337장).
- **UI**: 토픽 셀렉터로 전환(리셋: view/grade/모달/필터), rogue6.json은 dynamic import.
  URL은 `/rogue?topic=is6` (slugOf="is"+번호, popstate 동기화, 뷰 해시 #rg-*와 공존).
  테마는 html.rg-theme.**rg6** + `.rg.rg6` 변수 오버라이드(심해 청록 #0a1413/#1fa08e/시안
  #59dddc — 인게임 테마 화면 톤). 환각 탭 자리는 topic별 라벨('환경')로 실토피아·유토피아
  렌더. 전시관 탭: 유물/부품(3분류 그룹)/도구/스쿼드/유산.
- ⚠ 모듈 전역 `data`는 `setActiveData()`로만 갱신(컴포넌트 안 직접 재할당은 lint 에러).
  URL 초기 토픽은 useState lazy init(effect 내 동기 setState도 lint 에러).

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
