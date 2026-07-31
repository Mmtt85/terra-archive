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

# 대용량 정적 에셋(story·rogue·아바타 등 334MB/7,700파일)은 Pages가 아니라 R2에서
# 서빙한다 (2026-07-27, files.terra-archive.net). 배포 전에 증분 동기화로 R2를 맞춰둔다.
# 키가 없으면(예: GH Actions에 R2_SYNC_KEY 시크릿 미등록) 경고만 하고 건너뛴다 —
# 무인 파이프라인은 app/data(번들)만 바꾸고 public/ 에셋은 안 만지므로 no-op이 맞다.
if [ -f .r2-sync-key ] || [ -n "${R2_SYNC_KEY:-}" ]; then
  node scripts/r2-sync.mjs
else
  echo "⚠⚠ R2 동기화 키 없음 — 에셋 동기화 건너뜀 (.r2-sync-key 또는 R2_SYNC_KEY)" >&2
fi

# dist/client가 정적 사이트 전체 (HTML + assets). 워커(_worker.js)는 올리지 않는다.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -r dist/client/. "$STAGE/"

# R2로 옮긴 에셋 폴더는 Pages에 올리지 않는다 — 이게 배포가 빨라진 이유의 전부.
# (public/에는 그대로 남아 있고 scripts/r2-sync.mjs가 R2와 동기화한다)
for dir in story rogue lens tesseract avatars about og items scan profiles skins skin voice skills; do
  rm -rf "${STAGE:?}/$dir"
done

# 관리자 페이지는 본사이트에서 제거 — admin.terra-archive.net(Cloudflare Access 뒤)으로
# 분리됐다 (2026-07-27, scripts/deploy-admin.sh). 옛 주소는 아래 _redirects가 넘겨준다.
rm -f "$STAGE/admin.html" "$STAGE/admin.rsc"

# 안전망: 코드가 asset()으로 못 감싼 옛 링크·외부 북마크가 남아 있으면 R2로 301.
# ⚠ /rogue·/about은 페이지 경로와 겹치므로 통짜 와일드카드 금지 — 하위 폴더만 건다.
#   (Pages 리다이렉트는 정적 파일보다 먼저 평가되고, splat은 빈 문자열에도 매치된다)
cat > "$STAGE/_redirects" <<'EOF'
/admin https://admin.terra-archive.net/admin 301
/story/* https://files.terra-archive.net/assets/story/:splat 301
/avatars/* https://files.terra-archive.net/assets/avatars/:splat 301
/items/* https://files.terra-archive.net/assets/items/:splat 301
/og/* https://files.terra-archive.net/assets/og/:splat 301
/lens/* https://files.terra-archive.net/assets/lens/:splat 301
/tesseract/* https://files.terra-archive.net/assets/tesseract/:splat 301
/scan/* https://files.terra-archive.net/assets/scan/:splat 301
/profiles/* https://files.terra-archive.net/assets/profiles/:splat 301
/skins/* https://files.terra-archive.net/assets/skins/:splat 301
/skin/* https://files.terra-archive.net/assets/skin/:splat 301
/rogue/map/* https://files.terra-archive.net/assets/rogue/map/:splat 301
/rogue/relic/* https://files.terra-archive.net/assets/rogue/relic/:splat 301
/rogue/enemy/* https://files.terra-archive.net/assets/rogue/enemy/:splat 301
/rogue/scene/* https://files.terra-archive.net/assets/rogue/scene/:splat 301
/rogue/zone/* https://files.terra-archive.net/assets/rogue/zone/:splat 301
/rogue/capsule/* https://files.terra-archive.net/assets/rogue/capsule/:splat 301
/rogue/misc/* https://files.terra-archive.net/assets/rogue/misc/:splat 301
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

# 관리자 사이트(admin.terra-archive.net)는 **별도 배포**다 (2026-07-28 재분리 — 한때 여기서
# deploy-admin.sh를 이어 불렀지만, 본사이트 배포마다 관리자까지 딸려 나갈 이유가 없다).
# 관리자 UI를 고쳤을 때만: bash scripts/deploy-admin.sh
echo ""
echo "✓ 본사이트 배포 완료 — 관리자 사이트는 별도입니다: bash scripts/deploy-admin.sh"
