---
name: planner-synergy-review
description: 신규 오퍼레이터의 인프라(RIIC) 파싱 결과를 점검하고, 새 시너지 팟·토큰·특이 스킬 문구가 있으면 rules.json(플래너 지식 베이스, Supabase 정본)에 규칙을 추가한다. 무인 리포트가 "신규 오퍼 인프라 시너지 검토"로 지목하면 실행.
---

# 신규 오퍼 인프라 시너지·규칙 검토

무인 결정론 레인이 신규 오퍼의 스탯·스킬·인프라 스킬 텍스트는 자동 파싱한다
(`build-infra.py` → infra.json). 하지만 **새 시너지 메커니즘·토큰·오분류 문구**는 사람이
`rules.json`(플래너 지식 베이스)에 규칙을 넣어야 정확히 점수에 반영된다. 이 스킬로 점검한다.
정본 규칙은 [docs/INFRA-RULES.md](../../../docs/INFRA-RULES.md), 특히 **§10 신규 오퍼 점검 목록**.

## 절차 (INFRA-RULES §10 기준)

1. **파싱 결과 확인** — 신규 오퍼의 infra.json 항목에서 각 스킬의
   `kind / value / product / tokenGen / tokenUse / 조건 필드`가 실제 스킬 설명과 맞는지 본다.
   ```bash
   node -e "const d=require('./app/data/infra.json');console.log(JSON.stringify(d.find(o=>o.name==='<오퍼명>'),null,1))"
   ```
2. **새 토큰 시스템**이면 `app/data/rules.json`의 `tokens`에 추가 — 생성·소비·전환 문구가
   잡히는지 재생성으로 확인.
3. **파서 오분류 스킬**은 우선 `rules.json`의 `skillOverrides`(buffId→patch)로 교정.
   "…당", "…와 함께", "전부 0이 되고", "간주" 같은 **새 조건 문구 유형**이면 INFRA-RULES에
   규칙을 추가하고 파서·플래너에 반영(정식 지원 후 override 행 삭제 — 미적용 시 WARNING).
4. **새 시너지 팟**(진영/명단 결집 보너스)이면 `rules.json`의 `synergySets`에 추가.
   판정 기준은 메모리 [[terra-archive-concept-tag-rules]](진영 OR 텍스트) 및 INFRA-RULES 참조.
5. **회귀 검증** — `node scripts/verify-plan.mjs` 픽스처 전부 통과해야 커밋.
   확정된 정배 조합은 `rules.json`의 `fixtures`에 케이스로 축적.

## rules.json 편집 경로 (정본은 Supabase)

`rules.json`의 정본은 Supabase(`planner_rules` 원장 + `rule_releases` 발행)다:
- **/admin '플래너 규칙' 탭**에서 편집 → 발행 → 로컬에서 베이크:
  ```bash
  python3 scripts/build-rules.py   # 최신 발행 스냅샷 → app/data/rules.json
  ```
- 감사 방법론은 메모리 [[terra-archive-planner-audit-method]](방별 통째 비교 + 시뮬 검증),
  3계층 설계는 [[terra-archive-planner-rules-db]] / docs/PLANNER-RULES-DB.md.

## 마무리

- 확정된 새 규칙은 INFRA-RULES.md와 도움말 모달(`planner.tsx` HelpModal)에 함께 갱신.
- 사용자가 교정해준 도메인 규칙(A조 풀파워·쉐이 세트·니엔 고정 등, [[terra-archive-riic-domain-rules]])
  을 어기지 말 것.
- 커밋 → push. 배포는 사용자가 직접.

## 언제 무시해도 되나

대부분의 신규 오퍼는 기존 규칙으로 자동 처리된다. 파싱 결과가 스킬 설명과 일치하고
verify-plan이 통과하면 **rules.json 손댈 것 없이 넘어가도 된다** — 새 시너지/토큰/오분류가
있을 때만 규칙을 추가한다.
