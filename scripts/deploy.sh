#!/bin/bash
# 테라 아카이브 배포: vinext 정적 내보내기(output:"export") → Cloudflare Pages (https://terra-archive.net)
# 사전 조건: 이 기기에서 wrangler OAuth 로그인 완료 (nzkonaru@gmail.com)
#
# 2026-07: SSR 워커 배포 → 완전 정적 배포로 전환. 데이터 JSON이 워커에 인라인되어
# 무료 플랜 워커 한도(3MiB, no_bundle 모듈 합산 기준)를 넘었기 때문. 사이트는 전부
# 클라이언트 렌더링이라 정적 HTML(로케일×탭 18페이지, SEO 메타 포함)로 충분하다.
set -euo pipefail
cd "$(dirname "$0")/.."

# 대용량 정적 에셋(story·rogue·아바타 등 767MB/15,300파일)은 Pages가 아니라 R2에서
# 서빙한다 (2026-07-27, files.terra-archive.net). 배포 전에 증분 동기화로 R2를 맞춰둔다.
# ci-refresh가 신규 오퍼의 아바타·스킬 레벨·프로필·보이스·스킨 메타를 public/에 만들기 때문에
# 키가 없으면 그 에셋이 R2에 안 올라가 사이트에서 404가 난다.
#
# ⚠ 키가 없으면 **빌드도 하기 전에 멈춘다** (2026-08-02). 예전엔 경고만 찍고 넘어갔는데
# 그 경고를 아무도 안 읽어서, 8/1에 중섭 신규 4명이 도감엔 뜨고 섬네일만 404인 채로
# 배포됐다. 에셋 없는 배포는 "고쳐야 할 상태"를 만드는 것이라 성공보다 실패가 낫다.
# 코드만 고쳤고 에셋은 확실히 그대로일 때만 --skip-r2 로 넘긴다.
SKIP_R2=""
for a in "$@"; do [ "$a" = "--skip-r2" ] && SKIP_R2=1; done
if [ ! -f .r2-sync-key ] && [ -z "${R2_SYNC_KEY:-}" ] && [ -z "$SKIP_R2" ]; then
  echo "R2 동기화 키가 없다 (.r2-sync-key 또는 R2_SYNC_KEY) — 배포를 중단한다." >&2
  echo "에셋을 안 올리고 배포하면 신규 오퍼의 섬네일·스킬·프로필·보이스가 404가 된다." >&2
  echo "정말 코드만 바뀌었다면: bash scripts/deploy.sh --skip-r2" >&2
  exit 1
fi

npm run build

if [ -f .r2-sync-key ] || [ -n "${R2_SYNC_KEY:-}" ]; then
  node scripts/r2-sync.mjs
else
  echo "⚠ R2 동기화 건너뜀 (--skip-r2) — 에셋이 바뀌었다면 사이트에서 404가 난다" >&2
fi

# dist/client가 정적 사이트 전체 (HTML + assets). 워커(_worker.js)는 올리지 않는다.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -r dist/client/. "$STAGE/"

# R2로 옮긴 에셋 폴더는 Pages에 올리지 않는다 — 이게 배포가 빨라진 이유의 전부.
# (public/에는 그대로 남아 있고 scripts/r2-sync.mjs가 R2와 동기화한다)
for dir in story rogue lens tesseract avatars about og items scan profiles skins skin voice skills modules; do
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
/modules/* https://files.terra-archive.net/assets/modules/:splat 301
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
#
# 종전엔 파일별로 한 줄씩 적었는데, 스토리 상세 라우트(/stories/<id> × 3언어 = 273개)가
# 생기면서 301줄이 되어 **_headers의 100룰 한도**를 넘겼다 (초과분은 조용히 무시된다 —
# 위 무한 루프가 그대로 재발한다). 확장자 글롭으로 한 줄로 줄인다: wrangler가 쓰는
# 매처(workers-shared asset-worker rules-engine)는 규칙의 `*`를 위치 상관없이
# `(?<splat>.*)`로 바꾸고 앞뒤를 앵커링하므로, `/*.rsc` → `^/(?<splat>.*)\.rsc$` 가 되어
# 하위 폴더까지 전부 걸린다. (`*`는 규칙당 하나만 — 둘이면 같은 이름의 캡처 그룹이 겹친다.)
printf '\n/*.rsc\n  Content-Type: text/x-component\n' >> "$STAGE/_headers"

# 피드·IndexNow 키 파일의 Content-Type을 명시한다 (2026-08-06).
# 피드 리더는 application/rss+xml을 기대하고, IndexNow는 키 파일이 text/plain이어야 검증한다.
printf '\n/feed.xml\n  Content-Type: application/rss+xml; charset=utf-8\n' >> "$STAGE/_headers"
for keyfile in "$STAGE"/[0-9a-f]*.txt; do
  [ -e "$keyfile" ] || continue
  printf '\n%s\n  Content-Type: text/plain; charset=utf-8\n' "${keyfile#"$STAGE"}" >> "$STAGE/_headers"
done
echo ".rsc content-type 규칙 1건(글롭) — 대상 $(find "$STAGE" -name "*.rsc" -type f | wc -l | tr -d ' ')개"

npx wrangler pages deploy "$STAGE" --project-name terra-archive --branch main --commit-dirty=true

# 색인 통보(IndexNow) — 직전 커밋 대비 **실제로 바뀐** 페이지만 Bing·네이버에 알린다.
# 바뀐 게 없으면 아무것도 안 쏜다. 실패해도 배포는 성공이다(부가 작업이라 || true).
node scripts/indexnow.mjs || true

# 관리자 사이트(admin.terra-archive.net)는 **별도 배포**다 (2026-07-28 재분리 — 한때 여기서
# deploy-admin.sh를 이어 불렀지만, 본사이트 배포마다 관리자까지 딸려 나갈 이유가 없다).
# 관리자 UI를 고쳤을 때만: bash scripts/deploy-admin.sh
echo ""
echo "✓ 본사이트 배포 완료 — 관리자 사이트는 별도입니다: bash scripts/deploy-admin.sh"
