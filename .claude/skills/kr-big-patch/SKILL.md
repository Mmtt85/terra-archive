---
name: kr-big-patch
description: 한국서버 큰 점검(오전 10시~오후 4시, 몇 달치 데이터가 한 번에 들어옴) 뒤 사이트를 통째로 따라잡히는 종합 절차. "큰 점검 끝났어", "한섭 패치됐어", "클뜯 새로 올라왔나 봐줘", "패치 데이터 갱신해줘" 같은 요청에 사용.
---

# 한국서버 큰 점검 대응 — 한 번에 다 따라잡기

## 점검 두 종류 (사용자 확정 2026-08-13)

| | **큰 점검** | 작은 점검 |
|---|---|---|
| 시간 | 오전 10시 ~ 오후 4시 (약 6시간) | 오후 4시 ~ 4시 10분 (약 10분) |
| 성격 | **몇 달치 데이터가 통째로 클라에 들어온다** | 큰 점검 때 들어온 걸 **하나씩 해금**만 한다 |
| 대응 | **이 스킬** — 전체 파이프라인 + 콘텐츠 집필 | [`kr-small-patch`](../kr-small-patch/SKILL.md) — 개방 확인 위주 |

아래 0→6을 순서대로. **각 단계는 앞 단계의 산출물을 쓴다** — 건너뛰면 반쪽이 된다.
전 과정에서 `bash scripts/deploy.sh`는 실행 금지 (CLAUDE.md) — 빌드·커밋·푸시까지만.

---

## 0. 데이터 받기 — **CDN에서 직접. 클뜯을 기다리지 않는다** (2026-09-02 변경)

```bash
python3 scripts/fetch-gamedata-cdn.py --check    # 새 resVersion인가 (1초)
python3 scripts/fetch-gamedata-cdn.py            # → .gamedata/kr_*.json
```

절차 전체는 **[`gamedata-pull`](../gamedata-pull/SKILL.md) 스킬**이 정본 — 스키마가 어긋나
표를 건너뛸 때의 수리(`fbs-repair.py`)까지 거기 있다. 먼저 그 스킬을 부르고 여기 §1로 돌아온다.

> **옛 절차(클뜯 레포 감시)는 이제 쓰지 않는다.** 레포는 사람이 돌려야 올라와서
> 점검 종료보다 2시간(사세행)~2시간 34분(교차지점) 늦었고, 2026-09-02엔 **11일** 밀려 있었다.
> CDN은 게임이 실제로 받는 곳이라 인게임 업데이트와 동시다.
> `scripts/watch-gamedata.sh`(레포 커밋 감시)는 CDN이 막혔을 때의 예비로만 남긴다.

⚠ **resVersion 문자열은 빌드 시각이지 배포 시각이 아니다.** `26-08-31-…`이 9/2에 배포될 수
있다 — 헷갈리면 version 엔드포인트의 HTTP `last-modified`를 본다.

> 급히 이벤트 배너부터 띄워야 하면 §3-1의 `MANUAL_EVENTS` 스톱갭을 먼저 쓴다.

## 1. 뭐가 들어왔나 — 추측하지 말고 표를 비교한다

```bash
python3 scripts/whatsnew-gamedata.py            # 직전 KR 커밋 대비 (~2분, 60MB)
python3 scripts/whatsnew-gamedata.py --no-rogue # 급할 때 (통합전략 21MB 생략)
```

출력 3부: ① 신규·변경(이벤트/오퍼/스킨/구역/통합전략) ② **미래 일정 전수** ③ 돌려야 할 파이프라인.

> ⚠ **"몇 달치 미래시가 들어왔다"는 대개 소문이다.** 2026-08-13 큰 점검을 전수 조사한 결과
> `activity_table`·`zone_table`·`stage_table`·`climb_tower_table`·`sandbox_perm_table`·
> `character_table` 어디에도 미래 일정이 **0건**이었고, 실제로 들어온 건 이벤트 1개·
> 통합전략 확장팩 1개·스킨 4종뿐이었다. ②를 근거로 **없으면 없다고 보고**할 것.
> (미래 타임스탬프가 잡혀도 명함·아바타 판매 기간이면 콘텐츠 일정이 아니다.)

## 2. 결정론 레인 — 여기까지는 스크립트가 다 한다

```bash
SKIP_FETCH=1 bash scripts/ci-refresh.sh   # 오퍼·다국어·인프라·공채·파밍·비용·스토리목록·보이스 (~8분)
```

> ⚠ **`SKIP_FETCH=1` 을 빼먹으면 §0에서 CDN으로 받은 것이 통째로 날아간다.**
> `ci-refresh.sh`는 맨 앞에서 `fetch-gamedata.py`(클뜯 레포)를 돌리는데, 레포는 사람이
> 돌려야 올라와서 며칠씩 밀린다(실측 11일) — 덮이면 **조용히** 옛 데이터로 사이트가
> 만들어져서, 점검 당일에 이걸 당하면 신규 콘텐츠가 통째로 빠진 채 배포된다.
> 무인 CI는 CDN 단계가 없으므로 기본값 그대로 둔다(이 플래그는 **로컬 전용**).

KR을 재생성하면 EN/JA도 같이 나온다(`build-i18n.py`가 레인 안에 있다 — CLAUDE.md 규칙 충족).

## 3. CI가 건너뛰는 로컬 전용 풀런 — **가장 자주 빠뜨리는 곳**

무인 CI는 러너 디스크·시간 때문에 무거운 단계를 축약해서 돈다. 큰 점검 뒤에는 **여기를
로컬에서 전체로 한 번** 돌려야 신규 콘텐츠의 이미지·역색인이 채워진다.

```bash
python3 scripts/build-enemies.py            # CI는 --meta-only --no-images (levels 179MB·신규 적 초상)
python3 scripts/build-stages.py             # CI는 --no-images (신규 도면). ⚠ 반드시 build-enemies 뒤
python3 scripts/build-skins.py              # CI는 --meta-only (신규 스킨 아트)
python3 scripts/build-story.py --kr-thumbs  # 기본 모드는 글로벌판 썸네일을 임시로 넣는다
node scripts/r2-sync.mjs                    # ⚠ 이걸 안 돌리면 커밋·배포해도 이미지가 404
```

**통합전략(록라)은 `ci-refresh.sh`에 아예 없다** (2026-08-13 발견 — 캐시가 7/17자로 멈춰
IS5 3차 확장팩이 통째로 누락돼 있었다). 캐시를 지워야 새 표를 받는다:

```bash
rm -f .gamedata/rogue/*roguelike_topic_table.json
python3 scripts/build-rogue-enc-scenes.py --refresh   # 조우 씬 트리 (PRTS 매칭) — build-rogue보다 먼저
python3 scripts/build-rogue-records.py --refresh      # 기록 원문(엔딩북·방문객) — build-rogue보다 먼저, r2-sync 대상
python3 scripts/build-rogue.py rogue5        # 최신 토픽 번호로. 1~4도 한 번씩 돌려 무변화 확인
python3 scripts/build-rogue.py rogue5-en
python3 scripts/build-rogue.py rogue5-ja
python3 scripts/build-rogue.py cn            # 중섭 변형 일괄 (미래시)
```
새 조우가 들어왔는데 PRTS가 아직 그 이벤트를 채우지 않았으면 씬 트리 없이 평탄 목록으로
나온다 (정상 — PRTS가 채워진 뒤 `--refresh`로 다시 돌리면 트리가 붙는다).
신규 유물이 잡히면 아이콘도 없다 → `python3 scripts/build-rogue.py --icons` (UnityPy 필요) 후 재실행.

**그리고 작전 도감의 통합전략 색인을 반드시 뒤이어 돌린다** — 록라 데이터만 갱신하고 이걸
빠뜨리면 `/stages`의 통합전략 693건만 옛 데이터로 남는다 (입력이 rogue*.json이라 네트워크 불필요):

```bash
python3 scripts/build-stages-rogue.py        # → app/data/stages-rogue{,.en,.ja}.json
```

생존연산 신시즌이 왔으면 `python3 scripts/build-sandbox.py`도 같은 취급.

위수 협의(오토체스) 시즌이 열렸거나 갱신됐으면:

```bash
python3 scripts/build-autochess.py           # → app/data/autochess{,.en,.ja}.json + public/ac/ 아이콘
python3 scripts/build-autochess-routes.py    # → app/data/autochess-routes.json (전투 맵·적 이동 경로)
```
> 새 시즌은 `activity.AUTOCHESS_SEASON.act<N>autochess` 로 들어온다 —
> 스크립트 상단 `ACT` 상수를 그 키로 올려야 한다 (ACT1은 EN 이름 폴백 전용).
> 새 아이콘이 생기면 `node scripts/r2-sync.mjs` 를 같이 돌린다 — `asset()`은 로컬에서도 R2를 문다.
> 헤더의 기간 한정 바로가기는 `app/home.tsx`의 `PROMO` 상수(시작·종료 시각)를 새 시즌 값으로 고친다.

새 이벤트에 미니게임·수집 읽을거리가 딸려 왔으면:

```bash
python3 scripts/build-eventlore.py           # → app/data/eventlore-index.json + public/lore/data/
node scripts/r2-sync.mjs                     # 본문 JSON·그림이 R2에 올라가야 화면에 뜬다
```
> 새 이벤트는 **자동으로 안 잡힌다** — `activity_table`의 자료 구조가 이벤트마다 달라서다.
> 스크립트의 `EXTRACT`에 추출기를, `META`에 미니게임 이름·한 줄 안내(3로케일)를 더해야 한다.
> 후보를 찾으려면 그 이벤트 블록에서 100자 넘는 문자열이 어디 모여 있는지 훑어본다.


## 4. 신규 이벤트

### 4-1. 배너부터 (activity_table이 아직 안 올라왔을 때만)
`workers/broadcast/src/index.js`의 `MANUAL_EVENTS`에 실제 행과 **똑같은 모양**으로 넣는다.
같은 id의 실데이터가 오면 자동으로 버려지고, `until`이 지나면 무시된다.

> ⚠ **시작 시각은 `zone_table`(zoneValidInfo.startTs) → 공식 카페 공지 순으로 믿는다.**
> 2026-08-13 교차지점: 공지는 "16:00 개방"이었는데 실제는 11:00이었고, 같은 날 올라온
> zone_table이 그 11:00을 이미 갖고 있었다. 공지를 믿고 썼다가 정정한 전례다.

### 4-2. 스토리 수록 → 요약 → 연대기
```bash
python3 scripts/build-story.py               # 목록·썸네일 (ci-refresh에 포함돼 있음)
python3 scripts/build-story-scripts.py       # ⚠ 전체 실행할 것
python3 scripts/build-story-scripts.py --lang en   # vn(연출) 트랙이 로케일별 파일 안에 있다
python3 scripts/build-story-scripts.py --lang ja
python3 scripts/build-story-vn.py            # 리더기 무대 — 배경·스탠딩 + story-scene-ids.json
python3 scripts/build-records.py             # 오퍼레이터 기록(밀록) — ci 미포함, 여기서만 돈다
python3 scripts/build-story-vn.py --records  #   └ 기록 리더기 무대 (기록 JSON 의 vn 트랙 → 배경·스탠딩)
```
> ⚠ `build-story-scripts.py <id>`처럼 **단일 id로 돌리면 `story-script-ids.json`을 갱신하지
> 않는다**(목록이 잘리는 걸 막으려는 의도적 동작). 새 이벤트가 목록에 안 뜨면 이게 원인이다.
> ⚠ **`build-story-vn.py`를 빼먹으면 새 이벤트만 리더기가 안 열린다** — 리더기 목록
> (`app/data/story-scene-ids.json`)은 이 스크립트만 갱신한다. 무인 CI에는 없는 단계다.
> ⚠ `--records`는 **`build-records.py` 뒤에** 돌린다 — 기록 JSON 안의 vn 트랙을 읽어
> 배경·스탠딩을 받는다. 빼먹으면 기록 리더기 무대가 검게 빈다 (목록 파일은 없다 —
> 화면이 기록 JSON 의 vn 유무를 직접 본다).
> 스탠딩이 대량으로 "미러에 없음"으로 나오면 GitHub API 한도를 의심할 것 (gh 로그인 필요).

그다음 `story-summary` 스킬 → 집필 → 번역 파이프라인 → `chronicle-register` 스킬(연대기 등록).
**요약 집필과 번역은 하위 에이전트에 위임하지 않는다** (`scripts/story-i18n/TRANSLATE.md`).

## 5. 신규 오퍼

```bash
node scripts/ci-report.mjs kr        # "신규 오퍼 인프라 시너지 검토" 항목이 뜨는지
```
- **EN/JA 이름 확인**: KR 선출시 오퍼는 로케일 표에 아직 없어 이름이 한글로 폴백된다.
  `build-i18n.py`가 KR `appellation`으로 메우게 돼 있으니(2026-08-13 수정),
  `operators.en.json`에 한글 이름이 남지 않았는지 한 번 본다.
- 인프라 시너지는 `planner-synergy-review` 스킬. 파트너 팟(`partners`)은 자동 파싱되므로
  **특이 문구가 없으면 손댈 것이 없다**.
- ⚠ ci-report의 시너지 감지는 **직전 커밋 대비 diff**라, 같은 날 이미 커밋했으면 안 뜬다.
  큰 점검 날은 `app/data/infra.json`에서 신규 오퍼를 직접 확인할 것.

## 6. 마무리

```bash
Skill: terra-maintain      # 밀린 수작업(연대기·시너지·CN 번역·록라) 재감지
npm run build
```
빌드 통과 → 커밋 → `git push`. **배포는 사용자가 직접** (`bash scripts/deploy.sh` 금지).

푸시 전 확인:
- 무인 파이프라인이 그새 커밋했을 수 있다 → `git pull --rebase` 후 사이트맵 재생성
  (`node scripts/build-sitemap.mjs`, lastmod가 커밋 시각에서 나오므로 커밋 **뒤에** 돌린다)
- `/about` 스샷을 다시 찍었다면 **`r2-sync` 다음에** `SHOT_VER`를 올린다 (`about-shots` 스킬)
- 이미 발행된 요약을 고쳤다면 `story-i18n-backport.py`를 먼저 (안 그러면 옛 번역이 덮는다)

## 보고

한 번에 이만큼 움직이므로, 끝나면 **무엇이 실제로 들어왔고 / 무엇을 반영했고 /
사람 손이 더 필요한 게 뭔지** 세 줄로 나눠 보고한다. 배포 대기 커밋 수도 같이.
