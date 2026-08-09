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
# ⚠ enemy(단수)는 적 초상 폴더고, 라우트는 /enemies(복수)다 — 이름이 달라야 여기서
#   자산만 떼어낼 수 있다. rogue가 2026-08-08에 정확히 이 함정(에셋과 페이지가 같은 폴더)에
#   빠져 테마 페이지 6개가 매 배포마다 사라졌다. 적 도감은 처음부터 폴더를 갈라 뒀다.
for dir in story lens tesseract avatars about og items scan profiles skins skin voice skills modules enemy stage; do
  rm -rf "${STAGE:?}/$dir"
done

# ⚠ rogue만은 통째로 지우면 안 된다 (2026-08-08, GSC 색인 리포트로 발각).
# 2026-08-06에 통합전략 테마 정본 주소를 ?topic=isN → /rogue/<슬러그>로 옮기면서
# **에셋 폴더(map·relic·enemy·scene·zone·capsule·misc·node·kv*.webp)와 테마 페이지
# (is1~is6.html/.rsc)가 같은 폴더에 섞였다**. 여기서 rogue를 통째로 rm 하는 바람에
# 한국어 테마 페이지 6개가 매 배포마다 사라져 라이브에서 404였다 — 사이트맵에는
# 올라가 있으니 구글에는 "사이트맵이 가리키는데 없는 주소"로 보였다.
# (/en·/ja는 $STAGE/en/rogue/ 아래라 이 삭제를 안 타서 멀쩡했다 — 그래서 더 안 보였다.)
# 에셋은 asset()이 R2(files.terra-archive.net)로 보내므로 지우는 게 맞고, 페이지만 남긴다.
if [ -d "${STAGE:?}/rogue" ]; then
  find "${STAGE:?}/rogue" -mindepth 1 -maxdepth 1 \
    ! -name 'is*.html' ! -name 'is*.rsc' -exec rm -rf {} +
fi

# 사이트맵이 가리키는 주소가 실제로 스테이지에 있는지 검사한다 — 위 같은 사고를 조용히
# 넘기지 않기 위한 안전망. 하나라도 없으면 **배포를 중단**한다 (에셋 없는 배포를 막는
# --skip-r2 가드와 같은 원칙: 고쳐야 할 상태를 만드느니 실패가 낫다).
node scripts/check-staged.mjs "$STAGE"

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
/enemy/* https://files.terra-archive.net/assets/enemy/:splat 301
/stage/* https://files.terra-archive.net/assets/stage/:splat 301
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

# 직전 배포들의 청크를 함께 올린다 (2026-08-06, 사용자 제보: 배포 직후 콘솔에 "청크를 못
# 불러온다"). 파일명이 내용 해시라 재배포하면 옛 이름이 사라지고, 그 순간 열려 있던 탭의
# 지연 로딩이 404를 맞는다. 최근 3회분을 남겨 두면 그 창 자체가 없어진다.
node scripts/keep-assets.mjs "$STAGE" || true

# 2단계 배포 — **기본값** (끄려면 --one-phase)
# Pages는 **파일 내용 해시로 프로젝트 전체에서 업로드를 중복 제거**한다("N files already
# uploaded"). 그래서 같은 폴더를 프리뷰 브랜치에 먼저 올려 두면, 이어지는 프로덕션 배포는
# 업로드가 거의 0이 되고 "전환"만 남는다.
#
# 2026-08-06 밤 기본값으로 승격 — 그날 사고에서 404가 난 건 **이번 배포에 들어 있는**
# 2.3MB 청크였다(옛 청크가 아니라). 전환은 끝났는데 블롭을 엣지가 아직 못 읽는 상태였다는
# 뜻이라, 블롭을 먼저 올려 두고 나중에 전환하는 이 순서가 그 창을 줄인다.
# ⚠ Pages에는 프리뷰를 프로덕션으로 승격하는 CLI가 없다. 이건 승격이 아니라 '업로드 선행'이다.
case " $* " in *" --one-phase "*) echo "2단계 배포 건너뜀 (--one-phase)" ;; *)
  echo "1단계: 프리뷰 브랜치(deploy-stage)에 먼저 업로드 — 블롭을 미리 올려 둔다"
  npx wrangler pages deploy "$STAGE" --project-name terra-archive --branch deploy-stage --commit-dirty=true
esac

# 무중단 실측 (2026-08-06 사용자 제보: "배포 끝나고 30~60초 접속이 안 되는 시간이 늘어난다").
# 전환 전후를 1초 간격으로 찔러 **언제 몇 초 동안 무엇이** 안 됐는지 남긴다 — 원인이
# 업로드 창인지·엣지 전파인지·브라우저에 남은 옛 청크인지에 따라 처방이 다르기 때문.
# 끄려면: bash scripts/deploy.sh --no-probe
PROBE_PID=""
case " $* " in *" --no-probe "*) ;; *)
  mkdir -p .ci
  node scripts/deploy-probe.mjs --seconds 240 > .ci/deploy-probe.log 2>&1 &
  PROBE_PID=$!
  echo "무중단 프로브 시작 (배포 후 요약 출력 — .ci/deploy-probe.log)"
esac

echo "2단계: 프로덕션 전환"
npx wrangler pages deploy "$STAGE" --project-name terra-archive --branch main --commit-dirty=true

# 전환 직후 이번 빌드의 청크를 우리가 먼저 한 번 당겨 엣지에 올린다 (2026-08-06 밤).
# 사용자보다 먼저 당겨 두면 첫 방문자가 404를 맞지 않는다. 안 뜨는 파일이 있으면 여기서
# 이름이 찍힌다 — 그게 곧 사용자가 콘솔에서 볼 파일이다.
node scripts/warm-assets.mjs --seconds 180 || true

# 프로브는 전환 뒤 구간이 핵심이라 끝까지 기다렸다가 요약만 보여 준다
if [ -n "$PROBE_PID" ]; then
  echo "전환 완료 — 프로브가 끝날 때까지 대기 중(최대 4분, Ctrl+C로 건너뛰어도 배포엔 영향 없음)"
  wait "$PROBE_PID" || true
  sed -n '/── 요약/,$p' .ci/deploy-probe.log
fi

# 색인 통보(IndexNow) — 직전 커밋 대비 **실제로 바뀐** 페이지만 Bing·네이버에 알린다.
# 바뀐 게 없으면 아무것도 안 쏜다. 실패해도 배포는 성공이다(부가 작업이라 || true).
node scripts/indexnow.mjs || true

# 관리자 사이트(admin.terra-archive.net)는 **별도 배포**다 (2026-07-28 재분리 — 한때 여기서
# deploy-admin.sh를 이어 불렀지만, 본사이트 배포마다 관리자까지 딸려 나갈 이유가 없다).
# 관리자 UI를 고쳤을 때만: bash scripts/deploy-admin.sh
echo ""
echo "✓ 본사이트 배포 완료 — 관리자 사이트는 별도입니다: bash scripts/deploy-admin.sh"
