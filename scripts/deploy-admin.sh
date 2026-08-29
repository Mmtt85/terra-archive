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

# ⚠ 관리자 사이트는 **/admin 한 장**이다 — 본사이트 산출물을 통째로 복사한 뒤 몇 폴더만
#   지우는 방식은 2026-08-29에 Pages 20,000파일 한도에 걸려 배포가 실패했다
#   (dist/client 49,116파일 중 제외 목록을 다 빼도 route 페이지만 2만 개가 넘는다:
#    ja 5,676 · en 5,676 · enemies 3,088 · stages 1,516 …).
#   그래서 **필요한 것만 담는다** — admin.html/.rsc + assets/ + 아이콘 몇 개.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp dist/client/admin.html dist/client/admin.rsc "$STAGE/"
cp -r dist/client/assets "$STAGE/assets"
# Pages 업로드 제외 규칙과 없는 페이지용 404, 파비콘류만 함께 (본사이트 전용인
# sitemap·robots·feed·검색엔진 인증 파일은 관리자 도메인에 올리지 않는다)
for f in .assetsignore 404.html favicon.ico favicon-16.png favicon-32.png favicon-180.png; do
  [ -f "dist/client/$f" ] && cp "dist/client/$f" "$STAGE/"
done

# 루트로 오면 관리자 페이지로
cat > "$STAGE/_redirects" <<'EOF'
/ /admin 302
EOF

# .rsc 콘텐츠 타입 — 본사이트 deploy.sh와 같은 이유 (vinext RSC 라우팅)
while IFS= read -r rsc; do
  printf '\n%s\n  Content-Type: text/x-component\n' "${rsc#"$STAGE"}" >> "$STAGE/_headers"
done < <(find "$STAGE" -name "*.rsc" -type f | sort)

# 안전망 — 한도에 다시 다가가면 배포 전에 멈춘다 (조용히 실패하느니 여기서 실패한다)
COUNT=$(find "$STAGE" -type f | wc -l | tr -d ' ')
echo "관리자 스테이지 파일 $COUNT개"
if [ "$COUNT" -gt 19000 ]; then
  echo "관리자 배포 파일이 $COUNT개 — Pages 한도(20,000)에 너무 가깝다. 담는 목록을 확인할 것." >&2
  exit 1
fi
if [ ! -s "$STAGE/admin.html" ]; then
  echo "admin.html이 비었다 — 빌드 산출물을 확인할 것." >&2
  exit 1
fi

npx wrangler pages deploy "$STAGE" --project-name terra-archive-admin --branch main --commit-dirty=true
