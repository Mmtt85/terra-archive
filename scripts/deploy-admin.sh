#!/bin/bash
# 관리자 사이트 배포: admin.terra-archive.net (Pages 프로젝트 terra-archive-admin)
# 본사이트와 같은 빌드 산출물을 쓰되 /admin이 입구다. Cloudflare Access(구글 SSO)가
# 도메인 전체를 막고, CRUD는 /api(admin-api 워커)가 Access JWT 검증 후 중계한다.
# 사전 조건: npm run build 완료 (이 스크립트는 다시 빌드하지 않음 — deploy.sh와 묶어 쓰거나 단독 실행)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f dist/client/admin.html ]; then
  echo "dist/client/admin.html 없음 — 먼저 npm run build" >&2
  exit 1
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -r dist/client/. "$STAGE/"

# 대용량 에셋은 본사이트와 동일하게 R2 서빙 — Pages에 안 올린다
for dir in story rogue lens tesseract avatars about og items scan; do
  rm -rf "${STAGE:?}/$dir"
done

# 루트로 오면 관리자 페이지로
cat > "$STAGE/_redirects" <<'EOF'
/ /admin 302
EOF

# .rsc 콘텐츠 타입 — 본사이트 deploy.sh와 같은 이유 (vinext RSC 라우팅)
while IFS= read -r rsc; do
  printf '\n%s\n  Content-Type: text/x-component\n' "${rsc#"$STAGE"}" >> "$STAGE/_headers"
done < <(find "$STAGE" -name "*.rsc" -type f | sort)

npx wrangler pages deploy "$STAGE" --project-name terra-archive-admin --branch main --commit-dirty=true
