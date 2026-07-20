#!/usr/bin/env bash
# 결정론 데이터 리프레시 — 클뜯 레포에서 받아 모든 정적 데이터를 재생성한다.
# GitHub Actions(무인) + 로컬 양쪽에서 동일하게 돈다. LLM 판단이 필요한 산출물
# (스토리 요약 본문·록라 큐레이션·CN 신규 오퍼 번역)은 여기서 만들지 않는다 —
# 그건 content-auto 워크플로(LLM 레인)가 맡는다.
#
# 사용법:  bash scripts/ci-refresh.sh
# 산출:    app/data/*.json (+ EN/JA), public/avatars, public/items, public/story 썸네일
# 부수효과: 파이프라인 경고(미번역 CN 원문·미매칭 이름 등)를 .ci/warnings.log에 모은다.
#
# 실패 정책: 핵심 파이프라인이 죽으면 즉시 중단(set -e)해 깨진 데이터를 커밋하지 않는다.
#            특히 verify-plan.mjs(플래너 회귀)가 실패하면 배포까지 가지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."

G="${GAMEDATA_DIR:-.gamedata}"
mkdir -p .ci
WARN=".ci/warnings.log"
: > "$WARN"

# 각 단계 실행 + stderr를 경고 로그에 티(tee) — 경고는 남기되 실패는 그대로 전파.
run() {
  local label="$1"; shift
  echo "▶ $label"
  # stderr만 경고 로그에 복사(라벨 헤더 포함), stdout은 그대로.
  { "$@" 2> >(sed "s/^/[$label] /" | tee -a "$WARN" >&2); }
}

run "fetch-gamedata"   python3 scripts/fetch-gamedata.py "$G"

# 1) 오퍼레이터 기계 필드 재생성 → 컨셉 태그 → operators.json
run "regen-operators"  python3 scripts/regen-operators.py "$G"
run "retag-concepts"   python3 scripts/retag-concepts.py "$G"
cp "$G/operators-tagged.json" app/data/operators.json

# 2) 인프라 플래너 데이터 + 회귀 게이트 (실패 시 전체 중단)
run "build-infra"      python3 scripts/build-infra.py "$G"
run "verify-plan"      node scripts/verify-plan.mjs

# 3) 공채 / 파밍 / 육성비용 / 스토리 목록
run "build-recruit"    python3 scripts/build-recruit.py "$G"
run "build-farm"       python3 scripts/build-farm.py "$G"
run "build-costs"      python3 scripts/build-costs.py "$G"
run "build-story"      python3 scripts/build-story.py

# 4) 다국어(EN/JA) 데이터 — operators/infra/recruit 재생성했으면 필수
run "build-i18n"       python3 scripts/build-i18n.py "$G"

# 5) 신규 오퍼 아바타 (이미 있으면 건너뜀; 다운로드 실패는 치명적이지 않게 경고만)
run "download-avatars" python3 scripts/download-avatars.py || echo "[download-avatars] 일부 아바타 다운로드 실패 — 수동 확인 필요" | tee -a "$WARN" >&2

echo "✔ 결정론 리프레시 완료"
