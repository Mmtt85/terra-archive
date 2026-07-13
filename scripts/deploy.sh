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

# 아바타는 char id당 내용이 사실상 불변 — 브라우저/CDN 30일 캐시로 캐시율을 높인다
cat >> "$STAGE/_headers" <<'EOF'

/avatars/*
  Cache-Control: public, max-age=2592000
EOF

# Pages 고급 모드(_worker.js)는 기본적으로 모든 요청을 워커로 보낸다.
# 정적 자산 경로는 워커를 거치지 않고 바로 서빙되도록 제외한다.
cat > "$STAGE/_routes.json" <<'JSON'
{
  "version": 1,
  "include": ["/*"],
  "exclude": ["/assets/*", "/avatars/*", "/favicon.svg", "/og.png", "/file.svg", "/globe.svg", "/window.svg", "/robots.txt", "/sitemap.xml"]
}
JSON

npx wrangler pages deploy "$STAGE" --project-name terra-archive --branch main --commit-dirty=true
