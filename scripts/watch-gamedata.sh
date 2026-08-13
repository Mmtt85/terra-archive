#!/usr/bin/env bash
# 클뜯 레포(ArknightsAssets/ArknightsGamedata)에 KR 데이터가 새로 올라올 때까지 기다린다.
#
# 한국서버 큰 점검(오전 10시~오후 4시) 중에 백그라운드로 띄워 두는 용도다. 점검이 끝나도
# 레포 반영은 곧바로가 아니다 — 실측 이력:
#   2026-07-16 사세행   : 이벤트 시작 16:00, activity_table 커밋 18:09  (2시간 늦음)
#   2026-08-13 교차지점 : 이벤트 시작 11:00, activity_table 커밋 13:34  (2시간 34분 늦음)
# 그래서 "패치됐으니 지금 받자"로 한 번 받고 끝내면 빈손이거나 반쪽짜리가 된다.
#
# 사용:
#   bash scripts/watch-gamedata.sh                      # activity_table 감시 (기본)
#   bash scripts/watch-gamedata.sh activity_table zone_table character_table
#   WATCH_INTERVAL=300 WATCH_TIMEOUT=25200 bash scripts/watch-gamedata.sh
#
# 종료 코드: 0 = 변경 감지(무엇이 바뀌었는지 출력) · 1 = 제한 시간 초과
#
# ⚠ 맥 기본 bash는 3.2라 연관배열(declare -A)이 없다 — 기준값은 임시 파일에 적는다.
# ⚠ GitHub API는 비인증 시간당 60회다. gh가 로그인돼 있으면 gh api(5,000회)를 쓰고,
#   아니면 curl로 떨어진다. 표 N개 × (3600/INTERVAL)회가 한도 안에 들어와야 한다.
set -uo pipefail

REPO="ArknightsAssets/ArknightsGamedata"
INTERVAL="${WATCH_INTERVAL:-300}"     # 5분
TIMEOUT="${WATCH_TIMEOUT:-25200}"     # 7시간 (10시 시작 큰 점검을 끝까지 덮는다)
TABLES=("$@")
[ $# -eq 0 ] && TABLES=("activity_table")

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  api() { gh api "$1" 2>/dev/null; }
else
  api() { curl -sf "https://api.github.com/$1"; }
fi

# 표 하나의 최신 커밋 → "<sha 앞 8자> <UTC 시각> <메시지 첫 줄>"
head_of() {
  api "repos/$REPO/commits?path=kr/gamedata/excel/$1.json&per_page=1" | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: sys.exit(1)
if not d: sys.exit(1)
c = d[0]
print(c["sha"][:8], c["commit"]["committer"]["date"], c["commit"]["message"].splitlines()[0])
' 2>/dev/null
}

BASEFILE=$(mktemp -t watch-gamedata)
trap 'rm -f "$BASEFILE"' EXIT

echo "▶ 클뜯 감시 시작 — 표: ${TABLES[*]} · ${INTERVAL}초 간격 · 최대 $((TIMEOUT/60))분"
for t in "${TABLES[@]}"; do
  h=$(head_of "$t")
  [ -z "$h" ] && echo "  ⚠ $t 기준 커밋을 못 읽었다 (API 실패) — 다음 주기에 다시 잡는다"
  printf '%s\t%s\n' "$t" "$h" >> "$BASEFILE"
  echo "  기준 $t: ${h:-(불명)}"
done

START=$(date +%s)
while :; do
  sleep "$INTERVAL"
  ELAPSED=$(( $(date +%s) - START ))
  hit=0
  for t in "${TABLES[@]}"; do
    h=$(head_of "$t")
    [ -z "$h" ] && continue                       # 일시적 API 실패는 건너뛴다
    base=$(awk -F'\t' -v k="$t" '$1==k{print $2; exit}' "$BASEFILE")
    if [ -z "$base" ]; then                       # 처음에 못 읽었던 표 — 지금 값을 기준으로
      awk -F'\t' -v k="$t" -v v="$h" 'BEGIN{OFS="\t"} $1==k{$2=v} {print}' "$BASEFILE" > "$BASEFILE.n" && mv "$BASEFILE.n" "$BASEFILE"
      continue
    fi
    [ "$h" = "$base" ] && continue
    [ "$hit" -eq 0 ] && echo "✔ 새 데이터 감지 ($((ELAPSED/60))분 경과)"
    echo "   $t → $h"
    hit=1
  done
  [ "$hit" -eq 1 ] && exit 0
  echo "   … $((ELAPSED/60))분 경과 — 변경 없음"
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "✖ 제한 시간($((TIMEOUT/60))분) 초과 — 변경 없음. 점검이 길어졌거나 레포 반영이 더 늦는다."
    exit 1
  fi
done
