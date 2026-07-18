#!/bin/bash
# 테라 아카이브 배포: vinext 정적 내보내기(output:"export") → Cloudflare Pages (https://terra-archive.net)
# 사전 조건: 이 기기에서 wrangler OAuth 로그인 완료 (nzkonaru@gmail.com)
#
# 2026-07: SSR 워커 배포 → 완전 정적 배포로 전환. 데이터 JSON이 워커에 인라인되어
# 무료 플랜 워커 한도(3MiB, no_bundle 모듈 합산 기준)를 넘었기 때문. 사이트는 전부
# 클라이언트 렌더링이라 정적 HTML(로케일×탭 18페이지, SEO 메타 포함)로 충분하다.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build

# dist/client가 정적 사이트 전체 (HTML + assets). 워커(_worker.js)는 올리지 않는다.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -r dist/client/. "$STAGE/"

# 아바타는 char id당 내용이 사실상 불변 — 브라우저/CDN 30일 캐시로 캐시율을 높인다
cat >> "$STAGE/_headers" <<'EOF'

/avatars/*
  Cache-Control: public, max-age=2592000

/items/*
  Cache-Control: public, max-age=2592000

/story/*
  Cache-Control: public, max-age=2592000
EOF

# ⚠ .rsc(RSC 페이로드)는 반드시 text/x-component 로 서빙해야 한다 (2026-07-18 근본 원인 수정).
# CF 기본값(application/octet-stream)이면 vinext 클라 라우터가 RSC 응답으로 인정하지 않고
# location.href 하드 내비게이션을 시도하는데, 대상이 현재 URL(+해시)과 같아 same-document
# 내비게이션 → popstate → 재fetch 무한 루프가 된다 (뒤로가기 시 stories.rsc?_rsc 폭주 버그).
# _headers 확장자 글롭 지원이 불확실해 파일별로 명시 (페이지 수 × 로케일 ≈ 수십 건, 100룰 한도 내).
while IFS= read -r rsc; do
  printf '\n%s\n  Content-Type: text/x-component\n' "${rsc#"$STAGE"}" >> "$STAGE/_headers"
done < <(find "$STAGE" -name "*.rsc" -type f | sort)
echo ".rsc content-type 규칙 $(find "$STAGE" -name "*.rsc" -type f | wc -l | tr -d ' ')건 추가"

npx wrangler pages deploy "$STAGE" --project-name terra-archive --branch main --commit-dirty=true
