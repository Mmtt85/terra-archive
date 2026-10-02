#!/bin/bash
# 커밋 → origin/main 위로 rebase → 푸시 → 배포를 한 번에, **멈추지 않게** (2026-10-01).
#
# ## 왜 (사용자 지시 2026-10-01 "원인 완벽하게 해결해")
#
# 2026-09-30 밤 대화형 세션이 이 과정을 명령 체인(`git commit && git pull --rebase && git push && … ; tail $L`)으로
# 손수 이어 붙이다가 멈췄다. rebase 는 **1초 만에 실패**했는데(출력이 사라져 정확한 문구는 모른다 — 같은 순간 도는
# 다른 git 이 index.lock 을 쥔 것으로 본다), 체인 뒤쪽 `tail -3 $L` 의 L 이 비어 **tail 이 stdin 을 기다리며 영영
# 서 있었다** (사용자가 끊을 때까지 6분). 그 뒤로도 rebase 가 반쯤 걸린 상태가 남아 손으로 풀어야 했다.
# 여기서는:
#   · stdin 을 닫는다 — 입력을 기다리는 명령이 있으면 멈추는 대신 곧바로 실패한다
#   · 단계마다 실패를 곧바로 알리고 멈춘다 (체인 뒤쪽이 엉뚱하게 돌지 않는다)
#   · 일시 오류는 다시 시도한다 — index.lock 경합(잠금이 풀리길 기다렸다가), 푸시 경합(CI 가 그새 커밋을 올림 →
#     다시 rebase), 네트워크(제한 시간 넘기면 끊고 다시)
#   · rebase 가 실패하면 **반드시 되돌린다**(--abort) — 반쯤 걸린 rebase 를 남기지 않는다. 진짜 충돌이면 멈추고 알린다
# 배포 단계의 멈춤 방지는 deploy.sh 가 맡는다 (scripts/proc-guard.sh).
#
# ## 사용
#   bash scripts/ship.sh -m "커밋 메시지" 경로…          # 그 경로만 커밋 → rebase → 푸시 → 배포
#   bash scripts/ship.sh --no-deploy -m "…" 경로…        # 푸시까지만
#   bash scripts/ship.sh                                 # 이미 커밋해 뒀으면 rebase → 푸시 → 배포만
# ⚠ `git add -A` 는 하지 않는다 — 다른 세션 작업이 트리에 있을 수 있다 (SESSION.md §1). 준 경로만 올린다.
# ⚠ 배포는 사용자가 하라고 할 때만 (SESSION.md §1) — 이 스크립트가 그 판단을 대신하지 않는다.
# ⚠ 오래 걸리므로(배포 3~4분) 대화형 세션은 **배경으로** 돌린다 — 앞에서 돌리면 사용자가 메시지를 보낼 때 같이 끊긴다.
set -euo pipefail
exec </dev/null
cd "$(dirname "$0")/.."
# shellcheck source=scripts/proc-guard.sh
. scripts/proc-guard.sh
export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_TERMINAL_PROMPT=0 GIT_MERGE_AUTOEDIT=no

MSG=""; DEPLOY=1; PATHS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -m) MSG=${2:?"-m 뒤에 커밋 메시지"}; shift 2 ;;
    --no-deploy) DEPLOY=""; shift ;;
    --) shift; PATHS+=("$@"); break ;;
    -*) echo "✗ 모르는 옵션: $1" >&2; exit 2 ;;
    *) PATHS+=("$1"); shift ;;
  esac
done
if [ ${#PATHS[@]} -gt 0 ] && [ -z "$MSG" ]; then echo "✗ 경로를 주면 -m 커밋 메시지도 줘야 합니다" >&2; exit 2; fi

GIT_DIR_ABS=$(git rev-parse --path-format=absolute --git-dir)

# 색인 잠금이 풀리길 기다린다 — VS Code 의 git 확장·다른 세션이 잠깐씩 쥔다. 30초가 지나도 남아 있으면
# 주인 없는 잠금일 수 있다 — **지우지 않고** 알린다 (도는 git 이 있는데 지우면 색인이 깨진다).
wait_index_lock() {
  local i=0
  while [ -e "$GIT_DIR_ABS/index.lock" ]; do
    if [ "$i" -ge 30 ]; then
      echo "✗ $GIT_DIR_ABS/index.lock 이 30초째 남아 있습니다 — 도는 git 이 없으면 그 파일을 지우고 다시 돌리세요." >&2
      return 1
    fi
    [ "$i" -eq 0 ] && echo "… 다른 git 이 색인을 잠가 두었습니다 — 풀리길 기다립니다" >&2
    sleep 1; i=$((i + 1))
  done
}

# 반쯤 걸린 rebase·merge 가 남아 있으면 시작하지 않는다 — 이전 실행의 찌꺼기일 수 있어 사람이 봐야 한다
if [ -d "$GIT_DIR_ABS/rebase-merge" ] || [ -d "$GIT_DIR_ABS/rebase-apply" ] || [ -e "$GIT_DIR_ABS/MERGE_HEAD" ]; then
  echo "✗ 진행 중인 rebase/merge 가 남아 있습니다 — 'git status' 로 보고 'git rebase --abort' 등으로 정리한 뒤 다시 돌리세요." >&2
  exit 1
fi
if [ "$(git symbolic-ref -q --short HEAD || true)" != "main" ]; then
  echo "✗ main 브랜치가 아닙니다 ($(git rev-parse --short HEAD)) — main 에서 돌리세요." >&2
  exit 1
fi

# 빌드 부산물 — 커밋하지 않는다 (SESSION.md §1)
git checkout -- public/sitemap.xml 2>/dev/null || true

# ── 1. 커밋 (준 경로만) ──
if [ ${#PATHS[@]} -gt 0 ]; then
  wait_index_lock
  git add -- "${PATHS[@]}"
  if git diff --cached --quiet; then
    echo "✗ 준 경로에 커밋할 변경이 없습니다: ${PATHS[*]}" >&2
    exit 1
  fi
  retry 3 2 git commit -q -m "$MSG"
  echo "✓ 커밋 $(git log --oneline -1)"
fi

# ── 2. origin/main 위로 rebase — 실패하면 되돌리고, 충돌이 아니면 다시 ──
# rebase 는 트리를 origin/main 으로 돌렸다가 우리 커밋을 다시 얹는다 — 그 커밋의 파일은 1초 안에 **두 번 뒤집힌다**.
# 상시 켜 둔 dev 서버(vite)가 두 번째 변경을 놓치면 옛 판(origin/main 쪽)을 계속 내보낸다: 라이브는 멀쩡한데
# 로컬만 CSS 가 안 먹는 일이 두 번 났다 (2026-10-01·10-02, 둘 다 CI 커밋 위로 rebase 한 배포 직후 — 실측:
# /app/globals.css 가 어제 판이었다). 다시 얹힌 우리 커밋의 파일을 한 번 더 건드려 dev 가 마지막 내용을 읽게 한다.
nudge_dev() {
  local before="$1" f
  [ "$(git rev-parse HEAD)" = "$before" ] && return 0     # 아무것도 안 뒤집혔다
  git diff --name-only origin/main HEAD 2>/dev/null | while IFS= read -r f; do
    [ -f "$f" ] && touch "$f"
  done
}
sync_main() {
  local attempt out
  for attempt in 1 2 3; do
    retry 3 5 run_to 60 git fetch -q origin main || return 1
    wait_index_lock || return 1
    # --autostash — 트리에 다른 세션의 미커밋 작업이 있어도 rebase 가 거부하지 않게 잠깐 치웠다 되돌린다
    local before; before=$(git rev-parse HEAD)
    if out=$(git rebase -q --autostash origin/main 2>&1); then
      nudge_dev "$before"
      return 0
    fi
    echo "⚠ rebase 실패 ($attempt/3):" >&2
    echo "$out" | sed 's/^/    /' >&2
    if [ -n "$(git diff --name-only --diff-filter=U 2>/dev/null)" ]; then
      git rebase --abort 2>/dev/null || true
      echo "✗ 충돌입니다 — 되돌려 두었습니다(커밋은 그대로). 손으로 풀어야 합니다: git pull --rebase" >&2
      return 1
    fi
    git rebase --abort 2>/dev/null || true
    sleep 2
  done
  echo "✗ rebase 가 세 번 다 실패했습니다 — 위 메시지를 보세요 (rebase 는 되돌려 두었습니다)." >&2
  return 1
}

# ── 3. 푸시 — 그새 CI 가 커밋을 올렸으면(거부) 다시 rebase 해서 ──
pushed=""
for attempt in 1 2 3; do
  sync_main || exit 1
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && { pushed=1; echo "✓ 푸시할 커밋 없음 — origin/main 과 같습니다"; break; }
  if run_to 90 git push -q origin HEAD:main; then
    pushed=1; echo "✓ 푸시 $(git log --oneline -1)"; break
  fi
  echo "⚠ 푸시 실패 ($attempt/3) — 다시 받아 rebase 한 뒤 재시도합니다" >&2
  sleep 3
done
[ -n "$pushed" ] || { echo "✗ 푸시가 세 번 다 실패했습니다." >&2; exit 1; }
retry 3 5 run_to 60 git fetch -q origin main || { echo "✗ 푸시 뒤 확인용 fetch 실패" >&2; exit 1; }
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
  || { echo "✗ 푸시 뒤에도 HEAD ≠ origin/main — 배포하지 않습니다." >&2; exit 1; }

# ── 4. 배포 ──
if [ -n "$DEPLOY" ]; then
  exec bash scripts/deploy.sh
fi
