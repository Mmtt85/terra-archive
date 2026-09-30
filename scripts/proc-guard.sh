# 멈춤 방지 도구 — deploy.sh · ship.sh 가 `source` 한다 (단독 실행용이 아니다).
#
# ## 왜 (2026-10-01, 사용자 지시 "에러가 나면 바로 그만두고 다시 시도를 하든지 뭘 하든지 해야 할거 아님?
#    내가 안 멈추면 그냥 평생 배포 안 하고 멈춰 있는 거잖음? 원인 완벽하게 해결해")
#
# 2026-09-30 밤 배포가 세 번 '멈췄다':
#   ① 커밋 → rebase → 푸시 → 배포를 명령 체인으로 이어 붙였는데 rebase 가 곧바로 실패했고, 체인 뒤쪽 `tail -3 $L` 의
#      L 이 비어 **tail 이 stdin 을 기다리며 영영 서 있었다** (사용자가 끊을 때까지 6분). 실패는 1초 만에 났다.
#   ② R2 목록 조회가 503 한 번에 배포를 통째로 끝냈다 — 다시 시도하는 곳이 없었다.
#   ③ 네트워크를 타는 단계(git fetch·gh·wrangler·R2·IndexNow)에 제한 시간이 없어, 응답이 안 오면 끝없이 기다릴 수 있었다.
# 그래서 여기 셋을 둔다 — 제한 시간(run_to) · 다시 시도(retry) · 제한 시간 있는 기다림(wait_to).
# 부르는 쪽은 맨 앞에서 `exec </dev/null` 로 stdin 을 닫는다 — 입력을 기다리는 것이 있으면 멈추는 대신 곧바로 실패한다.
#
# ⚠ macOS 에는 `timeout` 명령이 없다 (coreutils 없음) — 그래서 bash 로 직접 잰다. CI(리눅스)에서도 같게 돈다.

# kill_tree PID 신호 — 자식부터 차례로 죽인다 (npx → node → wrangler → esbuild 처럼 겹겹이라 부모만 죽이면 고아가 남는다)
kill_tree() {
  local _pg_c
  for _pg_c in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$_pg_c" "$2"; done
  kill -"$2" "$1" 2>/dev/null || true
}

# wait_to PID 초 — 그 프로세스를 기다리되 제한 시간이 지나면 트리째 죽인다. 종료 코드를 돌려준다(시간 초과는 124).
# ⚠ 지역 변수는 `_pg_` 로 시작한다 — bash 의 변수 범위는 동적이라, 이름이 `n`·`rc` 같으면 부른 명령(셸 함수)이
#   같은 이름을 쓸 때 서로 덮는다 (2026-10-01 시험에서 retry 의 횟수가 0 으로 덮여 한 번 만에 포기했다).
wait_to() {
  local _pg_pid=$1 _pg_secs=$2 _pg_rc=0 _pg_end
  _pg_end=$(( $(date +%s) + _pg_secs ))
  while kill -0 "$_pg_pid" 2>/dev/null; do
    if [ "$(date +%s)" -ge "$_pg_end" ]; then
      echo "✗ 제한 시간 ${_pg_secs}초를 넘겨 끊습니다 (pid $_pg_pid)" >&2
      kill_tree "$_pg_pid" TERM
      sleep 3
      kill_tree "$_pg_pid" KILL
      wait "$_pg_pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
  done
  wait "$_pg_pid" || _pg_rc=$?
  return "$_pg_rc"
}

# run_to 초 명령… — 명령을 돌리되 제한 시간 안에 안 끝나면 트리째 죽이고 124 로 실패한다.
run_to() {
  local _pg_to=$1
  shift
  "$@" &
  wait_to "$!" "$_pg_to"
}

# retry 횟수 쉬는초 명령… — 실패하면 쉬었다가 다시 한다. 마지막 실패의 종료 코드를 그대로 돌려준다.
# 결정적인 실패(빌드 오류·충돌)에는 쓰지 않는다 — 몇 번을 해도 같다. 일시 오류(네트워크·5xx·잠금 경합)에만.
retry() {
  local _pg_n=$1 _pg_pause=$2 _pg_i=1 _pg_rc
  shift 2
  while :; do
    _pg_rc=0
    "$@" || _pg_rc=$?
    [ "$_pg_rc" -eq 0 ] && return 0
    if [ "$_pg_i" -ge "$_pg_n" ]; then
      echo "✗ ${_pg_n}번 시도했지만 실패했습니다 (종료 코드 $_pg_rc): $*" >&2
      return "$_pg_rc"
    fi
    echo "⚠ 실패(종료 코드 $_pg_rc) — ${_pg_pause}초 뒤 다시 시도합니다 ($_pg_i/$_pg_n): $*" >&2
    sleep "$_pg_pause"
    _pg_i=$((_pg_i + 1))
  done
}
