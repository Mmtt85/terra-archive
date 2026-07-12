#!/bin/bash
# 테라 아카이브 배포: vinext 빌드 → Cloudflare Pages (https://terra-archive.pages.dev)
# 사전 조건: 이 기기에서 wrangler OAuth 로그인 완료 (nzkonaru@gmail.com)
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -r dist/client/. "$STAGE/"
mkdir -p "$STAGE/_worker.js"
cp -r dist/server/. "$STAGE/_worker.js/"
rm -f "$STAGE/_worker.js/wrangler.json"

npx wrangler pages deploy "$STAGE" --project-name terra-archive --branch main --commit-dirty=true
