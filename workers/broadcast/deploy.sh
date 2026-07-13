#!/bin/bash
# 방송 수집 워커 배포. 루트의 vinext 빌드 산출물(.wrangler/deploy/config.json)이
# wrangler를 혼동시키므로 배포하는 동안만 치워둔다.
set -euo pipefail
cd "$(dirname "$0")"
ROOT_REDIRECT="../../.wrangler/deploy/config.json"
moved=0
if [ -f "$ROOT_REDIRECT" ]; then mv "$ROOT_REDIRECT" "$ROOT_REDIRECT.bak"; moved=1; fi
trap '[ "$moved" = 1 ] && mv "$ROOT_REDIRECT.bak" "$ROOT_REDIRECT"' EXIT
npx wrangler deploy
