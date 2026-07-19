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
| `synergySets` | `planner-engine.ts` | **시너지 팟 카탈로그** (Phase 3) — 어떤 세트가 있는지는 데이터, 평가기(anchor.detect/bodies.from/target.cell)는 엔진. §7 참조 |
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
- **Phase 2 (완료 2026-07-19)** — Supabase 이관: 테이블 `planner_rules`(원장 — kind/key/body
  jsonb/status/source/note/seq)와 `rule_releases`(version, snapshot jsonb — 발행 시점에 active
  규칙을 rules.json 형태로 컴파일한 것). **픽스처도 원장의 `kind='fixture'` 행**으로 통합
  (설계 초안의 별도 plan_fixtures 테이블은 과설계라 폐기 — 출처는 source/note 컬럼으로 충분).
  RLS는 기존 패턴 그대로: releases SELECT만 anon, 원장 CRUD·발행·롤백은 x-admin-key
  (`docs/supabase-planner-rules.sql` — **SQL Editor에서 1회 실행 필요**, 시드 45행 + v1 발행 포함).
  /admin에 "플래너 규칙" 탭(원장 CRUD + 발행 + 롤백 + 번들 버전 대조), 로컬은
  `scripts/build-rules.py`가 최신 release를 rules.json으로 베이크(깃 커밋 = 이력·리뷰).
  컴파일 등가성은 시드 rows → `compileSnapshot()` == rules.json으로 검증 완료.
- **Phase 3 — 시너지팟 카탈로그 (완료 2026-07-19)**: 쉐라그·품질 수익 조합·피누스 세트를
  엔진 하드코딩 3블록에서 **`synergySets`(kind='synergy_set' 행) + 제네릭 조립기
  (`seedSynergySet`)**로 이관. optimize는 카탈로그의 가용 세트들로 멱집합 후보안을 만들어
  planScore 비교 채택. 이관은 스냅샷 6로스터×3모드 완전 일치로 무손실 검증.
  ⚠ 기존 설치는 `supabase-planner-rules.sql`의 Phase 3 마이그레이션(ALTER 2줄 — kind CHECK에
  synergy_set 추가)을 1회 실행해야 원장에 세트 행을 넣을 수 있다.
- **남은 축적 루프**: 피드백 행에 "규칙으로 승격"(source: `feedback:<id>` 자동 기록) /
  "픽스처로 승격" 버튼. 발행 전 브라우저에서 픽스처 실행(엔진 상수 주입 필요 — 현재는
  베이크 후 verify-plan이 정식 게이트).
- **Phase 4 (선택) — 런타임 오버레이**: 플래너 마운트 시 release 버전 확인, 번들보다
  새 버전이면 교체(실패 시 조용히 번들 사용) — 배포 없이 규칙 핫픽스가 필요해지면 도입.

## 5. 운영 흐름 (Phase 2 이후)

```
/admin '플래너 규칙' 탭에서 편집 (원장 planner_rules; draft=발행 보류, retired=퇴역)
  → 🚀 발행: validateRules → compileSnapshot → rule_releases에 v(N+1) INSERT
  → 로컬: python3 scripts/build-rules.py     # rules.json 베이크 + 후속 절차 자동 안내
  → (parser/tokens/skillOverrides 변경 시) build-infra.py + build-i18n.py 재생성
  → node scripts/verify-plan.mjs             # 정식 게이트 — 실패하면 커밋 금지
  → npm run build → 커밋·푸시 → 배포
잘못 발행했으면 /admin에서 ↩ 롤백(최신 release 행 삭제) 후 재발행.
```

⚠ `rules.json`은 build-rules.py가 쓰는 파일 — DB 시드 이후엔 손으로 고치지 않는다
(같은 버전인데 내용이 다르면 베이크가 드리프트 경고를 내고 발행본으로 덮어쓴다).

## 6. 새 시너지팟 추가 방법 (Phase 3)

1. /admin '플래너 규칙' 탭 → `+ 시너지 세트` → 정의 작성:
   - `key`(후보 플래그, 영문)·`name`(표시명, KR)·`shift`(0=A조/1=B조)·`badge`(전략 라벨 표시)
   - `anchor`: 별도 방에 앉는 오라원 탐지 — `detect: "gateFaction"`(진영 N명 게이트 오라) 또는
     `"perProduct"`(생산품별 진영 오라). 앵커 없는 순수 역할 조합은 생략.
   - `bodies`: 본체 — `from: "anchorFaction"`(앵커 진영원, `count`/`min`은 숫자 또는
     `"gateCount"`, 머릿수 게이트면 `requireRoomSkill: false`) 또는 `from: "roles"`
     (스킬 kind 슬롯 배열 — override/payout/quality 등).
   - `target.cell`: `first`(그 방종류 첫 칸)/`firstFree`(시드 없는 첫 칸)/`byAnchorProduct`
     (앵커 오라의 양수 생산품 칸).
2. 발행 → 베이크 → **정배 픽스처도 함께 추가**(세트가 실제 채택되는 로스터로) → verify-plan.
3. 표시명 EN/JA는 `app/i18n.tsx`에 name 그대로 키로 추가 (없으면 KR로 표시).
4. 새 팟이 기존 평가기로 표현 안 되면(새 anchor.detect 유형 등) 엔진(L0) 확장 —
   그건 코드 작업이 맞다. INFRA-RULES에 규칙 명문화 필수.

## 7. 파일 지도

```
app/planner-engine.ts             L0 엔진 (React 무의존 — esbuild로 노드 실행 가능)
app/planner.tsx                   UI만 (엔진 심볼은 planner-engine에서 import)
app/rules.ts                      L2 로더·타입 (RULES / C)
app/data/rules.json               L2 런타임 정본 (DB 발행 스냅샷의 베이크 결과)
app/rules-compile.ts              원장 rows → 스냅샷 컴파일 + 발행 전 검증
app/rules-api.ts                  Supabase REST (release 읽기 anon / CRUD·발행 x-admin-key)
app/admin/page.tsx                '플래너 규칙' 탭 (원장 CRUD·발행·롤백)
docs/supabase-planner-rules.sql   테이블·RLS·시드·v1 발행 (SQL Editor 1회 실행)
scripts/build-rules.py            최신 release → rules.json 베이크 + 후속 절차 안내
scripts/build-infra.py            L1 생성기 — parser·tokens·skillOverrides를 rules.json에서 읽음
scripts/verify-plan.mjs           회귀 하네스 (픽스처 / --snapshot / --compare)
```
