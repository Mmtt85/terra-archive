#!/bin/bash
# 테라 아카이브 배포: vinext 정적 내보내기(output:"export") → Cloudflare Pages (https://terra-archive.net)
# 사전 조건: 이 기기에서 wrangler OAuth 로그인 완료 (운영자 클라우드플레어 계정)
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
# ── 플래그 ─────────────────────────────────────────────────────────────────────
#   --skip-r2    R2 에셋 동기화를 건너뛴다 (코드만 고쳤고 에셋은 확실히 그대로일 때만)
#   --one-phase  프리뷰 선행 업로드를 건너뛴다 (업로드·해싱이 2회 → 1회)
#   --no-probe   무중단 프로브(최대 4분 대기)를 끈다
#   --fast       = --no-probe  (사용자 요청 2026-09-21: "디플로이가 너무 오래 걸린다")
#
# ⚠ 한때 --fast 에 --one-phase 를 함께 묶었다가 **뺐다** (2026-09-21 실측). 배포 419초를
#   단계별로 재 보니 프로브 대기가 220초(52%)로 압도적이었고, 1단계 선행 업로드 64초는
#   **아끼는 게 아니라 옮기는 것**이었다 — 로그: 1단계 `Uploaded 17254 files (50.73 sec)`,
#   2단계 `Uploaded 0 files (17663 already uploaded) (0.64 sec)`. --one-phase 로 끄면 그
#   64초가 전환 쪽으로 옮겨갈 뿐이고, 2026-08-06 사고 때문에 넣은 블롭 선행 업로드 보호만
#   잃는다.
#
# 그 64초(= 17,254개 재업로드)의 정체는 **`vite.config.ts` 의 `__BUILD_TIME__` 하나**다.
# 개입 없는 연속 두 빌드를 대조한 결과 (2026-09-21):
#   · 원본 그대로 일치 60/104 · 참조 청크 해시를 무시하면 102/104 · **빌드 시각까지 무시하면 104/104**
# 밀리초까지 든 빌드 시각을 품은 청크는 `dropdown` 과 `home` **둘뿐**이고, 그 둘의 해시가
# 바뀌면 참조하는 42개가 연쇄로 바뀌어 결국 html/rsc 17,213개가 전부 달라진다.
# (한때 "청크 5개"라고 적었던 건 틀렸다 — 나머지는 연쇄 피해자였다.)
#
# ⚠ **고치지 않기로 했다** (사용자 판단 2026-09-21 "그냥 두자"). 이유 둘:
#   ① `__BUILD_TIME__` 은 일부러 박은 값이다 — '새기능' 배지·기간 한정 배너 판정을 빌드
#      시각으로 고정해야 프리렌더와 클라이언트가 같은 답을 낸다 (whats-new.ts 주석, 2026-08-12
#      다크모드가 통째로 날아간 사고). 반올림하면 배너가 뜨고 지는 시점이 바뀐다.
#   ② 고쳐도 이득이 작다 — CSS 가 전 페이지가 참조하는 해시 자산 하나(`/assets/index-*.css`)라
#      `globals.css` 를 한 줄만 고쳐도 17,213개가 어차피 전부 달라진다.
ARGS=" $* "
case "$ARGS" in *" --fast "*) ARGS="$ARGS --no-probe " ;; esac
SKIP_R2=""; ONE_PHASE=""; NO_PROBE=""
case "$ARGS" in *" --skip-r2 "*) SKIP_R2=1 ;; esac
case "$ARGS" in *" --one-phase "*) ONE_PHASE=1 ;; esac
case "$ARGS" in *" --no-probe "*) NO_PROBE=1 ;; esac

# ── 단계별 소요 시간 ───────────────────────────────────────────────────────────
# 어느 단계가 몇 초인지 아무 데도 안 남아서 "배포가 오래 걸린다"를 짐작으로만 말했다
# (사용자 요청 2026-09-21). 실패해도 찍히도록 EXIT 트랩에서 출력한다.
DEPLOY_STEPS=""; DEPLOY_TSTEP=$(date +%s); DEPLOY_SUMMARY_DONE=""
step() {   # step "이름" — 직전 step 부터 지금까지를 그 이름으로 적는다
  local now
  now=$(date +%s)
  DEPLOY_STEPS="${DEPLOY_STEPS}$1|$((now - DEPLOY_TSTEP))
"
  DEPLOY_TSTEP=$now
}
deploy_summary() {
  if [ -n "$DEPLOY_SUMMARY_DONE" ] || [ -z "$DEPLOY_STEPS" ]; then return 0; fi
  DEPLOY_SUMMARY_DONE=1
  # ⚠ 이름을 **왼쪽에 두고 자리를 맞추지 않는다** — awk 의 %-28s 는 바이트로 세는데 한글은
  # UTF-8 로 3바이트라 줄이 어긋난다 (실측). 숫자를 앞에 두면 정렬이 필요 없다.
  printf '\n── 단계별 소요 ───────────────────────────────\n'
  printf '%s' "$DEPLOY_STEPS" | awk -F'|' '
    { n[NR] = $1; v[NR] = $2; t += $2 }
    END {
      for (i = 1; i <= NR; i++) printf "  %5d초  %3d%%  %s\n", v[i], (t ? v[i] * 100 / t : 0), n[i]
      printf "  %5d초        합계\n", t
    }'
}
if [ ! -f .r2-sync-key ] && [ -z "${R2_SYNC_KEY:-}" ] && [ -z "$SKIP_R2" ]; then
  echo "R2 동기화 키가 없다 (.r2-sync-key 또는 R2_SYNC_KEY) — 배포를 중단한다." >&2
  echo "에셋을 안 올리고 배포하면 신규 오퍼의 섬네일·스킬·프로필·보이스가 404가 된다." >&2
  echo "정말 코드만 바뀌었다면: bash scripts/deploy.sh --skip-r2" >&2
  exit 1
fi

npm run build
step "빌드 (npm run build)"

if [ -f .r2-sync-key ] || [ -n "${R2_SYNC_KEY:-}" ]; then
  node scripts/r2-sync.mjs
else
  echo "⚠ R2 동기화 건너뜀 (--skip-r2) — 에셋이 바뀌었다면 사이트에서 404가 난다" >&2
fi
step "R2 동기화"

# dist/client가 정적 사이트 전체 (HTML + assets). 워커(_worker.js)는 올리지 않는다.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"; deploy_summary' EXIT
cp -r dist/client/. "$STAGE/"

# R2로 옮긴 에셋 폴더는 Pages에 올리지 않는다 — 이게 배포가 빨라진 이유의 전부.
# (public/에는 그대로 남아 있고 scripts/r2-sync.mjs가 R2와 동기화한다)
# ⚠ enemy(단수)는 적 초상 폴더고, 라우트는 /enemies(복수)다 — 이름이 달라야 여기서
#   자산만 떼어낼 수 있다. rogue가 2026-08-08에 정확히 이 함정(에셋과 페이지가 같은 폴더)에
#   빠져 테마 페이지 6개가 매 배포마다 사라졌다. 적 도감은 처음부터 폴더를 갈라 뒀다.
# ⚠ 여기 빠지면 그 폴더는 R2와 Pages **양쪽에** 올라간다 — 배포 파일 수(2만 개 한도)를
#   그대로 갉아먹고 업로드도 그만큼 길어진다. r2-sync.mjs의 DIRS와 **같은 집합 + tl**이다.
#   (2026-08-23 점검: records 996개·32MB와 lore 99개가 빠져 있었다.)
# ⚠ `tl`만은 예외다 — r2-sync.mjs의 DIRS에는 **없고** 여기에만 있다. 번역 사전 공개본이라
#   올리는 건 scripts/publish-tl.mjs 관할이지만(2026-09-17 분리), Pages가 같은 파일을 또
#   서빙할 이유는 없으므로 트림은 그대로 탄다.
# ⚠ items 는 에셋 폴더(public/items/ — 재료·아이템 아이콘)이면서 라우트 세그먼트(/items,
#   아이템 도감)이기도 하다. 지금은 목록이 `items.html` 한 파일이라 이 삭제를 안 타지만,
#   **/items/<id> 같은 하위 라우트를 만들면 `items/` 아래로 떨어져 매 배포마다 사라진다**
#   (아래 rogue가 2026-08-08에 당한 그 사고). 아이템 상세는 모달 + #it-<id> 로 둘 것.
for dir in story lens tesseract avatars about og items scan profiles skins skin voice skills modules enemy stage sandbox ac records lore tl; do
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
# 파티 공유 짧은 링크 — 게시판 자동 링크가 **#(해시) 앞에서 끊긴다** (사용자 제보 2026-09-21,
# 디시: `…/autochess` 까지만 파랗고 `#bond?p=…` 는 맨 글자로 남는다). 그래서 공유 주소는
# 예약문자가 하나도 없는 `/p/<방ID>` 꼴이다.
# ⚠ **302 로 `?p=:splat` 에 넘기면 안 된다** — `:splat` 은 목적지의 **경로에서만** 치환되고
#   쿼리 안에서는 글자 그대로 남아 `%3Asplat` 으로 인코딩된다 (2026-09-21 라이브 실측:
#   `location: /autochess?p=%3Asplat`. 위 /avatars/* 처럼 경로에 쓴 규칙은 멀쩡하다).
#   그래서 **리라이트(200)** 로 간다 — 주소는 `/p/<방ID>` 그대로 두고 내용만 위수 협의
#   페이지를 내려 준다. 방 ID 는 화면이 location.pathname 에서 읽는다 (app/autochess.tsx).
# ⚠ `/profiles/*` 같은 아래 규칙과 겹치지 않는다 — 매처가 `^/p/(?<splat>.*)$` 로 앵커링한다.
/p/* /autochess 200
/en/p/* /en/autochess 200
/ja/p/* /ja/autochess 200
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
/ac/* https://files.terra-archive.net/assets/ac/:splat 301
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
step "스테이지 준비 (복사·트림·검사)"

# 2단계 배포 — **기본값** (끄려면 --one-phase)
# Pages는 **파일 내용 해시로 프로젝트 전체에서 업로드를 중복 제거**한다("N files already
# uploaded"). 그래서 같은 폴더를 프리뷰 브랜치에 먼저 올려 두면, 이어지는 프로덕션 배포는
# 업로드가 거의 0이 되고 "전환"만 남는다.
#
# 2026-08-06 밤 기본값으로 승격 — 그날 사고에서 404가 난 건 **이번 배포에 들어 있는**
# 2.3MB 청크였다(옛 청크가 아니라). 전환은 끝났는데 블롭을 엣지가 아직 못 읽는 상태였다는
# 뜻이라, 블롭을 먼저 올려 두고 나중에 전환하는 이 순서가 그 창을 줄인다.
# ⚠ Pages에는 프리뷰를 프로덕션으로 승격하는 CLI가 없다. 이건 승격이 아니라 '업로드 선행'이다.
if [ -n "$ONE_PHASE" ]; then
  echo "1단계 선행 업로드 건너뜀 (--one-phase)"
else
  echo "1단계: 프리뷰 브랜치(deploy-stage)에 먼저 업로드 — 블롭을 미리 올려 둔다"
  npx wrangler pages deploy "$STAGE" --project-name terra-archive --branch deploy-stage --commit-dirty=true
fi
step "1단계 선행 업로드"

# 무중단 실측 (2026-08-06 사용자 제보: "배포 끝나고 30~60초 접속이 안 되는 시간이 늘어난다").
# 전환 전후를 1초 간격으로 찔러 **언제 몇 초 동안 무엇이** 안 됐는지 남긴다 — 원인이
# 업로드 창인지·엣지 전파인지·브라우저에 남은 옛 청크인지에 따라 처방이 다르기 때문.
# 끄려면: bash scripts/deploy.sh --no-probe
PROBE_PID=""
if [ -z "$NO_PROBE" ]; then
  mkdir -p .ci
  node scripts/deploy-probe.mjs --seconds 240 > .ci/deploy-probe.log 2>&1 &
  PROBE_PID=$!
  echo "무중단 프로브 시작 (배포 후 요약 출력 — .ci/deploy-probe.log)"
fi

echo "2단계: 프로덕션 전환"
npx wrangler pages deploy "$STAGE" --project-name terra-archive --branch main --commit-dirty=true
step "2단계 프로덕션 전환"

# 전환 직후 이번 빌드의 청크를 우리가 먼저 한 번 당겨 엣지에 올린다 (2026-08-06 밤).
# 사용자보다 먼저 당겨 두면 첫 방문자가 404를 맞지 않는다. 안 뜨는 파일이 있으면 여기서
# 이름이 찍힌다 — 그게 곧 사용자가 콘솔에서 볼 파일이다.
node scripts/warm-assets.mjs --seconds 180 || true
step "청크 예열 (warm-assets)"

# 색인 통보(IndexNow) — 직전 커밋 대비 **실제로 바뀐** 페이지만 Bing·네이버에 알린다.
# 바뀐 게 없으면 아무것도 안 쏜다. 실패해도 배포는 성공이다(부가 작업이라 || true).
node scripts/indexnow.mjs || true
step "색인 통보 (IndexNow)"

# 관리자 사이트(admin.terra-archive.net)는 **별도 배포**다 (2026-07-28 재분리 — 한때 여기서
# deploy-admin.sh를 이어 불렀지만, 본사이트 배포마다 관리자까지 딸려 나갈 이유가 없다).
# 관리자 UI를 고쳤을 때만: bash scripts/deploy-admin.sh
echo ""
echo "✓ 본사이트 배포 완료 — 관리자 사이트는 별도입니다: bash scripts/deploy-admin.sh"
if [ -z "$ONE_PHASE$NO_PROBE" ]; then
  echo "  (코드만 조금 고친 배포라면 다음엔: bash scripts/deploy.sh --fast)"
fi

# ── 프로브 대기는 **맨 뒤** (사용자 지적 2026-09-21) ───────────────────────────
# 전환은 이미 끝났고 뒤에 남은 건 이 기다림뿐이라, Ctrl+C 로 끊어도 잃는 게 프로브 요약
# 하나다. 종전에는 이 블록이 IndexNow **앞**에 있어서 "Ctrl+C 해도 배포엔 영향 없다"고
# 안내해 놓고 실제로는 색인 통보까지 같이 날아갔다 (Ctrl+C 는 포그라운드 프로세스 그룹
# 전체에 SIGINT 를 보낸다 — 배경의 프로브도 같이 죽어 로그가 반쪽만 남는다).
if [ -n "$PROBE_PID" ]; then
  echo ""
  echo "배포는 끝났습니다 — 무중단 프로브만 남았습니다(최대 4분). Ctrl+C 로 끊으면 이 요약만 못 봅니다."
  wait "$PROBE_PID" || true
  sed -n '/── 요약/,$p' .ci/deploy-probe.log
fi
step "프로브 대기"
