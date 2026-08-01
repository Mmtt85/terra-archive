#!/usr/bin/env bash
# 결정론 데이터 리프레시 — 클뜯 레포에서 받아 모든 정적 데이터를 재생성한다.
# GitHub Actions(무인) + 로컬 양쪽에서 동일하게 돈다. LLM 판단이 필요한 산출물
# (스토리 요약 본문·록라 큐레이션·CN 신규 오퍼 번역)은 여기서 만들지 않는다 —
# 그건 content-auto 워크플로(LLM 레인)가 맡는다.
#
# ── 2단계 분리 (사용자 요청 2026-08-01) ─────────────────────────────────────
# 오퍼 도감에 필요한 건 40초면 끝나는데, 인프라(234초)·회귀검증(108초)·파밍(78초) 뒤에
# 줄을 서느라 신규 오퍼가 7분 뒤에야 올라갔다. 그래서 레인을 둘로 나눈다:
#   phase=fast : 클뜯 수신 → 오퍼 데이터 → 다국어 → 아바타·스킬레벨·프로필  (~40초)
#   phase=rest : 인프라 → 회귀검증 → 공채·파밍·비용·스토리 → 보이스·스킨    (~7분)
#   phase=all  : 둘 다 (기본값 — 로컬에서 통째로 돌릴 때)
# fast가 끝나면 워크플로가 먼저 커밋·배포하고, rest는 그 뒤에 따로 커밋·배포한다.
# ⚠ fast만 배포된 사이에는 infra.json이 신규 오퍼를 모른다 — 플래너가 그 오퍼를 편성
#   후보에서 빼는 정도라 몇 분간은 무해하다(미실장 오퍼는 원래 플래너에서 제외된다).
#
# 사용법:  bash scripts/ci-refresh.sh [fast|rest|all]
# 산출:    app/data/*.json (+ EN/JA), public/avatars, public/items, public/story 썸네일
# 부수효과: 파이프라인 경고(미번역 CN 원문·미매칭 이름 등)를 .ci/warnings.log에 모은다.
#
# 실패 정책: 핵심 파이프라인이 죽으면 즉시 중단(set -e)해 깨진 데이터를 커밋하지 않는다.
#            특히 verify-plan.mjs(플래너 회귀)가 실패하면 배포까지 가지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."

PHASE="${1:-all}"
case "$PHASE" in fast|rest|all) ;; *) echo "phase는 fast|rest|all 중 하나" >&2; exit 2 ;; esac
G="${GAMEDATA_DIR:-.gamedata}"
mkdir -p .ci
WARN=".ci/warnings.log"
# rest 레인은 fast가 남긴 경고를 지우지 않는다 (리포트가 둘을 합쳐 읽는다)
[ "$PHASE" = "rest" ] || : > "$WARN"

# 이 단계를 지금 레인에서 돌리나?
in_phase() { [ "$PHASE" = "all" ] || [ "$PHASE" = "$1" ]; }

# 각 단계 실행 + stderr를 경고 로그에 티(tee) — 경고는 남기되 실패는 그대로 전파.
run() {
  local label="$1"; shift
  echo "▶ $label"
  # stderr만 경고 로그에 복사(라벨 헤더 포함), stdout은 그대로.
  { "$@" 2> >(sed "s/^/[$label] /" | tee -a "$WARN" >&2); }
}

# 클뜯 수신은 두 레인 모두 필요하다 (rest도 .gamedata를 읽는다). 러너가 매번 새 체크아웃이라
# 캐시가 없어 각자 받는다 — 3초짜리라 나눠도 손해가 없다.
run "fetch-gamedata"   python3 scripts/fetch-gamedata.py "$G"

if in_phase fast; then
# 1) 오퍼레이터 기계 필드 재생성 → 컨셉 태그 → operators.json
run "regen-operators"  python3 scripts/regen-operators.py "$G"
run "retag-concepts"   python3 scripts/retag-concepts.py "$G"
cp "$G/operators-tagged.json" app/data/operators.json

# 4) 다국어(EN/JA) 데이터 — operators.json을 고쳤으면 바로 따라와야 한다
run "build-i18n"       python3 scripts/build-i18n.py "$G"

# 5) 신규 오퍼 아바타 (이미 있으면 건너뜀; 다운로드 실패는 치명적이지 않게 경고만)
run "download-avatars" python3 scripts/download-avatars.py || echo "[download-avatars] 일부 아바타 다운로드 실패 — 수동 확인 필요" | tee -a "$WARN" >&2

# 6) 오퍼당 지연 로딩 파일 중 **도감에서 바로 보이는 것** — 스킬 레벨 수치·프로필.
# ⚠ 이 넷(+보이스·스킨)이 파이프라인에 빠져 있어서 신규 오퍼가 들어와도 상세 모달의
#   레벨 탭·프로필·대사가 비어 있었다 (2026-08-01 사용자 지적).
run "build-skill-levels" python3 scripts/build-skill-levels.py "$G"
run "build-profiles"     python3 scripts/build-profiles.py "$G"

# 6-1) 모듈 전수 검사 (사용자 요청 2026-08-01 — "업데이트 있을 때마다 모듈 현황 싹 다").
# 기존 오퍼에 조용히 붙는 모듈(피아메타 통합전략 전용 등)은 신규 오퍼와 달리 눈에 안 띈다.
# 리포트 전용이라 종료 코드 0 — 경고만 낸다.
run "audit-modules"      python3 scripts/audit-modules.py "$G"
fi   # ── fast 끝 ──

if in_phase rest; then
# 2) 인프라 플래너 데이터 + 회귀 게이트 (실패 시 전체 중단)
run "build-infra"      python3 scripts/build-infra.py "$G"
run "verify-plan"      node scripts/verify-plan.mjs

# 3) 공채 / 파밍 / 육성비용 / 스토리 목록
run "build-recruit"    python3 scripts/build-recruit.py "$G"
# 펭귄 통계는 외부 서비스라 다운/순단이 잦다 — 실패해도 파이프라인을 죽이지 않고 기존
# farm.json(마지막 성공본)을 유지한다. farm.json은 스크립트 맨 끝에 원자적으로 쓰므로
# 중간 실패로 파일이 깨지지 않는다 (2026-07-21, 펭귄 read timeout으로 전체 실패한 회귀).
run "build-farm"       python3 scripts/build-farm.py "$G" \
  || echo "[build-farm] 펭귄 통계 fetch 실패 — 기존 farm.json 유지, 다음 실행 때 재시도" | tee -a "$WARN" >&2
run "build-costs"      python3 scripts/build-costs.py "$G"
run "build-story"      python3 scripts/build-story.py
# 인게임 스토리라인(테마 시계열) — stories.json을 참조하므로 build-story 뒤에
run "build-storylines" python3 scripts/build-storylines.py "$G"

# 3-1) 중섭(미래시) 공식 방송 일정 — 비리비리 라이브룸. 크론 워커(클라우드플레어)는 비리비리에
# 412로 막혀서 여기(GitHub 러너)서 수집한다. 외부 서비스라 실패해도 파이프라인을 죽이지 않는다.
run "broadcasts-cn"    python3 scripts/build-broadcasts-cn.py \
  || echo "[broadcasts-cn] 비리비리 조회 실패 — 기존 broadcasts.json 유지, 다음 실행 때 재시도" | tee -a "$WARN" >&2

# 7) 무거운 오퍼당 파일 — 보이스 대사·스킨 메타 (도감 첫 화면엔 안 보이는 것들)
# ⚠ build-skins는 **--meta-only** — 스킨 이미지 296MB는 git에 없고(gitignore) R2가 서빙하므로
#   CI가 매번 새로 받으면 러너 디스크·시간을 통째로 날린다. 이미지는 로컬에서 별도로 받는다.
run "build-voicelines"   python3 scripts/build-voicelines.py "$G"
run "build-skins-meta"   python3 scripts/build-skins.py "$G" --meta-only

# 8) 오퍼 지연 에셋 전수 검사 (사용자 요청 2026-08-02) — 데이터가 번들(배포)과 R2(동기화)
# 두 경로로 나가는데 한쪽만 돌면 반쪽이 된다. 2026-08-01에 R2 키가 없어 아바타가 안 올라갔고
# 배포는 성공해서 신규 4명 섬네일만 404였다. 여기서 잡는다. 리포트 전용(종료 코드 0).
run "audit-assets"       node scripts/audit-assets.mjs --r2
fi   # ── rest 끝 ──

echo "✔ 결정론 리프레시 완료 (phase=$PHASE)"
