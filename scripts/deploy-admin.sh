#!/bin/bash
# 관리자 사이트 배포: admin.terra-archive.net (Pages 프로젝트 terra-archive-admin)
# 본사이트와 같은 빌드 산출물을 쓰되 /admin이 입구다. Cloudflare Access(구글 SSO)가
# 도메인 전체를 막고, CRUD는 /api(admin-api 워커)가 Access JWT 검증 후 중계한다.
# 본사이트 배포(deploy.sh)와는 **완전히 분리된 명령**이다 (2026-07-28 재분리) — 관리자 UI를
# 고쳤을 때만 돌린다. 데이터·본사이트만 바뀐 배포에 관리자까지 따라 나갈 이유가 없다.
# 단독 실행이 기본이라 스스로 빌드한다. 방금 deploy.sh로 빌드한 직후라 재빌드가 아까우면
# SKIP_BUILD=1 bash scripts/deploy-admin.sh 로 현재 dist/를 그대로 쓴다.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${SKIP_BUILD:-}" ]; then
  if [ ! -f dist/client/admin.html ]; then
    echo "SKIP_BUILD인데 dist/client/admin.html이 없음 — 먼저 npm run build" >&2
    exit 1
  fi
  echo "SKIP_BUILD=1 — 기존 dist/ 산출물로 배포합니다"
else
  npm run build
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
