# 인프라 플래너 지식 베이스 설계 (rules.json → Supabase)

인프라 플래너의 규칙을 "코드에 다 박는" 구조에서 벗어나기 위한 설계 정본.
도메인 규칙 자체는 [INFRA-RULES.md](INFRA-RULES.md)가 정본이고, 이 문서는 **그 규칙들이
어디에 살아야 하는가(계층)와 DB 이관 로드맵**을 다룬다. (설계 확정 2026-07-19)

## 1. 규칙 3계층

| 계층 | 위치 | 내용 | 예 |
|---|---|---|---|
| **L0 엔진** | `app/planner-engine.ts` (코드) | 절대룰 + 점수 결합 방식 + 감사 알고리즘. 어떤 데이터가 와도 변하지 않는 것 | A·B 동시 배치 금지(숙소·가공소 예외), 243 레이아웃, 훈련실 비움, 방별 통째 검수·체인 승격 루프, override=max·automation 제로아웃 같은 점수 결합 |
| **L1 게임 팩트** | `app/data/infra.json` (파이프라인 생성) | 클뜯 데이터에서 파싱한 스킬 사실 | kind/value/파트너·게이트 조건 필드 |
| **L2 지식 베이스** | `app/data/rules.json` (편집 가능 데이터) | 유동 규칙 — 오퍼별·런타임별로 변하고 사용자 피드백으로 갱신되는 것 | 추정 상수, 토큰 카탈로그, 파싱 교정(skillOverrides), 검증된 정배(fixtures) |

**핵심 계약: L2는 점수를 직접 조작하지 않는다.** L2가 할 수 있는 것은
① 상수 튜닝 ② 후보 생성·시드 ③ 조건 게이트 ④ 파싱 교정 ⑤ 동률 타이브레이크(미세값)뿐.
채택 판정은 항상 `teamScore`/`planScore`가 한다. 이를 어기면 rules.json이
"시뮬레이터와 싸우는 매직 넘버 더미"가 된다. (INFRA-RULES의 "개별 오퍼 패치 금지,
감사 규칙으로 잡는다" 원칙의 연장)

## 2. rules.json 섹션별 소비자

| 섹션 | 소비자 | 용도 |
|---|---|---|
| `constants` | `app/rules.ts` → `planner-engine.ts` | 런타임 상수 (오라 가중, 조별 가중, 시드 임계, payout 근사 모델, 단서 기본치 등) |
| `parser` | `scripts/build-infra.py` | 파스 타임 추정 상수 (INFRA-RULES §8 — 숙소 20명, 모집 ×4, DROP_ASSUMED 등) |
| `tokens` | `scripts/build-infra.py` | 토큰 카탈로그 — 새 토큰 시스템은 여기 추가 |
| `skillOverrides` | `scripts/build-infra.py` | buffId→patch 파싱 교정. 새 문구 오분류 시 정규식 패치 대신 행 추가. 파서가 정식 지원하면(재생성 diff 없음) 행 삭제. 미적용 행은 재생성 시 WARNING |
| `fixtures` | `scripts/verify-plan.mjs` | 검증된 정배·절대룰 불변식 = 회귀 테스트. 피드백으로 확정된 편성 지식은 여기 축적 |

**작업 규칙: 엔진·rules.json·build-infra.py를 고치면 커밋 전에 `node scripts/verify-plan.mjs`를
돌린다.** 픽스처가 "굼 없는 레토"류 회귀(전례: 롤백 2026-07)를 기계적으로 잡는다.
엔진 리팩토링 시엔 `--snapshot` → 수정 → `--compare`로 무변화까지 증명한다.

## 3. 픽스처 타입

- `invariant` — 절대룰 검사: `noDualShift`(근무 방 A·B 중복 금지), `trainingEmpty`
- `planContains` — 전체 자동편성 결과에 특정 조합이 있어야 함.
  `roomKey`(특정 방) 또는 `roomType`(그 종류의 어느 한 방에 `allOf` 전원이 **함께**)
- `teamCompare` — `teamScore(better) > teamScore(worse)` 직접 비교 (방·product 지정)

새 정배가 사용자 피드백으로 확정되면: INFRA-RULES에 규칙 기록 + fixtures에 케이스 추가.

## 4. DB 이관 로드맵

- **Phase 1 (완료 2026-07-19)**: 엔진(L0)을 `planner-engine.ts`로 분리, 유동 지식을
  `rules.json`(정적)으로 추출, `verify-plan.mjs` 하네스. 스냅샷 6로스터×3모드 무변화 검증 완료.
- **Phase 2 — Supabase 이관**: 테이블 `planner_rules`(kind/key/body jsonb/status/source/note),
  `rule_releases`(version, snapshot jsonb — active 규칙을 발행 시점에 한 덩어리로 컴파일),
  `plan_fixtures`(room_key/given/expect/verdict/feedback_id). RLS는 기존 패턴 그대로
  (anon은 releases 최신 1행 SELECT만, 쓰기는 x-admin-key — docs/supabase-admin.sql 참조).
  `scripts/build-rules.py`가 최신 release를 받아 rules.json으로 베이크(깃 커밋 = 이력·롤백).
- **Phase 3 — 축적 루프**: /admin에 "플래너 규칙" 탭(CRUD+발행), 피드백 행에
  "규칙으로 승격"(source: `feedback:<id>` 자동 기록) / "픽스처로 승격" 버튼.
  발행 전 verify-plan.mjs 픽스처 전체 통과를 강제.
- **Phase 4 (선택) — 런타임 오버레이**: 플래너 마운트 시 release 버전 확인, 번들보다
  새 버전이면 교체(실패 시 조용히 번들 사용) — 배포 없이 규칙 핫픽스가 필요해지면 도입.

## 5. Phase 1 파일 지도

```
app/planner-engine.ts   L0 엔진 (React 무의존 — esbuild로 노드 실행 가능)
app/planner.tsx         UI만 (엔진 심볼은 planner-engine에서 import)
app/rules.ts            L2 로더·타입 (RULES / C)
app/data/rules.json     L2 정본 (constants·parser·tokens·skillOverrides·fixtures)
scripts/build-infra.py  L1 생성기 — parser·tokens·skillOverrides를 rules.json에서 읽음
scripts/verify-plan.mjs 회귀 하네스 (픽스처 / --snapshot / --compare)
```
