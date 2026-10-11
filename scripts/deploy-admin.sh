#!/bin/bash
# 관리자 사이트 배포: admin.terra-archive.net (Pages 프로젝트 terra-archive-admin)
# 관리자 전용 빌드(admin-app/ · vite.admin.config.ts)를 올린다. Cloudflare Access(구글 SSO)가
# 도메인 전체를 막고, CRUD는 /api(admin-api 워커)가 Access JWT 검증 후 중계한다.
# 본사이트 배포(deploy.sh)와는 **완전히 분리된 명령**이다 (2026-07-28 재분리) — 관리자 UI를
# 고쳤을 때만 돌린다. 데이터·본사이트만 바뀐 배포에 관리자까지 따라 나갈 이유가 없다.
# 스스로 빌드한다(관리자 전용 빌드라 몇 초). 본사이트 빌드(dist/)와는 무관하다.
set -euo pipefail
cd "$(dirname "$0")/.."

# ⚠ 2026-10-11부터 **관리자 전용 빌드**다 (사용자 지시 "관리자 사이트만 따로 빼자. 빌드도 따로") — 종전엔 본사이트 빌드
#   (vinext, 프리렌더 8,600장, 3~5분)를 통째로 돌린 뒤 admin.html 한 장만 꺼냈다. 이제 admin-app/(단독 진입점)을
#   vite.admin.config.ts 로 몇 초 만에 빌드해 dist-admin/ 을 그대로 올린다. 화면 코드는 그대로 app/admin/page.tsx.
#   SKIP_BUILD 는 이제 필요 없다(빌드가 빠르다) — 넘겨도 무시하지 않고 그냥 다시 빌드한다.
npx vite build --config vite.admin.config.ts

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -r dist-admin/. "$STAGE/"
for f in favicon.ico favicon-16.png favicon-32.png favicon-180.png; do
  [ -f "public/$f" ] && cp "public/$f" "$STAGE/"
done

# 옛 주소 /admin(북마크)도 같은 화면 — 한 장짜리라 루트 index.html 로 다시 쓴다
cat > "$STAGE/_redirects" <<'EOF2'
/admin /index.html 200
/admin/ /index.html 200
EOF2

COUNT=$(find "$STAGE" -type f | wc -l | tr -d ' ')
echo "관리자 스테이지 파일 ${COUNT}개"
if [ ! -s "$STAGE/index.html" ]; then
  echo "index.html 이 비었다 — vite.admin.config.ts 빌드를 확인할 것." >&2
  exit 1
fi

npx wrangler pages deploy "$STAGE" --project-name terra-archive-admin --branch main --commit-dirty=true
