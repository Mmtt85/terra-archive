#!/bin/bash
# 무인 파이프라인 전용 푸시 — 원격이 그새 앞서 있으면 리베이스하고 다시 민다.
#
# 왜 필요한가 (2026-07-28 실사고): 대화형 세션이 같은 시각에 푸시하는 바람에
# `git push`가 non-fast-forward로 거부됐고, 워크플로가 그 자리에서 죽으면서
#   ⓐ 이미 만든 "데이터 자동 갱신 (kr) — 2026-07-27" 커밋이 통째로 버려지고
#   ⓑ 뒤따르는 Pages 배포 스텝도 실행되지 않았다.
# 데이터 갱신 하루치가 조용히 사라진 것이라, 한 번의 충돌로 하루를 날리지 않게 한다.
#
# ⚠ 워크플로가 fetch-depth를 얕게(2) 잡으므로 병합 기점이 로컬에 없을 수 있다 —
#    리베이스 전에 깊이를 늘린다. 충돌이 나면 되돌리고 **실패로 끝낸다**
#    (데이터 파일을 자동으로 뭉개지 않는다).
set -uo pipefail

BRANCH="${1:-main}"

for attempt in 1 2 3; do
  if git push origin "HEAD:$BRANCH"; then
    [ "$attempt" -gt 1 ] && echo "리베이스 후 푸시 성공 (시도 $attempt)"
    exit 0
  fi
  echo "푸시 거부 — 원격을 가져와 리베이스한다 (시도 $attempt/3)"
  git fetch --deepen=100 origin "$BRANCH" 2>/dev/null || git fetch origin "$BRANCH"
  if ! git rebase "origin/$BRANCH"; then
    git rebase --abort || true
    echo "::error::리베이스 충돌 — 손으로 봐야 합니다. 아무것도 푸시하지 않았습니다."
    exit 1
  fi
  sleep $((attempt * 5))
done

echo "::error::3번 시도했지만 원격이 계속 앞서 푸시하지 못했습니다."
exit 1
