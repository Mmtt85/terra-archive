---
name: cn-future-events
description: 중국서버(중섭)에 새 이벤트가 열렸거나 이벤트 도감 '미실장 이벤트' 줄에 빠진 것이 있을 때, 미래시(중섭 선행) 이벤트를 이름·그림·작전·적·재화·상위 재료·신규 오퍼·세 언어 번역까지 빠짐없이 싣는 절차. "중섭 이벤트 열렸어", "미래시 이벤트 추가해줘", "미실장 이벤트에 OO가 없어", "중국서버 새 이벤트 반영해줘" 같은 요청에 사용. cn-big-patch·cn-small-patch 가 끝에서 이걸 부른다.
---

# 미래시(중섭 선행) 이벤트 — 이벤트 도감에 빠짐없이 싣기

이벤트 도감(`/events`) 위쪽 **미실장 이벤트** 줄은 한섭엔 아직 없고 중섭에만 열린 이벤트다.
한 줄에 이름·개방 예정월·그림·작전·등장 적·교환 재화·상위 재료·신규 오퍼가 붙는다.
빌더 하나로 끝나지 않는다 — **이름표·번역·그림·오퍼 장부가 따로 논다.** 아래를 순서대로 다 돈다.
2026-10-01 에 한 번에 다섯 개(「相变临界」 이격 켈시·클로저 이벤트 포함)가 빠져 있던 걸 계기로 정리했다.

모든 Bash 는 `exec </dev/null;` 로 시작하고, 실측용 임시 스크립트는 **scratchpad 에** 둔다 (저장소 루트에 두면
deploy.sh 미커밋 가드가 배포를 막는다 — ship-no-hang 기억).

---

## 0. 무엇이 미실장 이벤트인가 — 규칙 (빌더가 이대로 뽑는다)

`scripts/build-events.py` 가 두 갈래로 모은다:

| 갈래 | 출처 | 이름표 |
|---|---|---|
| **스토리 있는** 이벤트 (사이드·미니 스토리) | `app/data/stories.json` 의 `unreleased` (build-story.py 가 중섭 story_review 에서 뽑는다) | `scripts/build-story.py` **`CN_PROVISIONAL_NAMES`** |
| **스토리 없는** 이벤트 (벡터 돌파·메인 사이드 actNmainss·축구·DP·ARK_HUB …) | 중섭 `activity_table.basicInfo` 직접 | `scripts/build-events.py` **`CN_ONLY_NAMES`** |

스토리 없는 쪽의 조건 (`build-events.py` "스토리가 없는 중섭 선행 이벤트" 블록):
- 한섭 activity 표에 **없고** · 작전이 있고(zone 이 있다) · 복각(`isReplicate`)이 아니고
- **한섭이 마지막으로 따라온 이벤트(양 서버에 다 있는 것 중 가장 최근)의 중섭 개방일보다 뒤에** 열었다.
- ⚠ **"중섭에서 아직 안 끝난 것"으로 거르지 않는다.** 중섭에서 끝났어도 한섭엔 아직 안 왔다 — 그 조건 때문에
  4월 말 2주짜리 7주년 「相变临界」가 통째로 빠졌다. 한섭이 건너뛴 중섭 전용 이벤트는 한섭이 그 뒤 이벤트를
  따라오는 순간 기준선 앞으로 밀려 저절로 빠진다.
- 한섭에 그 이벤트가 열리면 한섭 블록이 같은 id 로 이 행을 **대체**한다 — 이름표·번역·오퍼 장부 항목은 그대로 둬도 된다.

줄 순서: **중섭 개방일이 늦은 것이 맨 앞(왼쪽)**. 두 갈래를 따로 끼우던 탓에 순서가 꼬였던 적이 있어,
빌더가 마지막에 중섭 개방일 내림차순으로 다시 세운다 (중섭 표가 없으면 eta).

개방 예정월(`eta`): 스토리 있는 쪽은 build-story.py 의 한↔중 시차, 스토리 없는 쪽은 build-events.py 가
가장 최근 짝 이벤트의 시차로 낸다 — **이번 달보다 앞서지 않게** 자른다 (중섭에서 오래된 이벤트가 지난달로 나왔다).
화면 문구는 "YYYY.MM 예정"이고 **배지 밑 제 줄**에 뜬다(globals.css `.ev-eta`).

---

## 1. 중섭 표가 최신인지 (gamedata-pull 스킬 흐름)

```bash
python3 scripts/fetch-gamedata-cdn.py --server cn --check     # resVersion·clientVersion
python3 scripts/fetch-gamedata-cdn.py --server cn             # activity·stage·zone·item·character … (17표)
```
이벤트 쪽은 `.gamedata/cn_activity_table.json` · `cn_stage_table.json` · `cn_item_table.json` ·
`cn_enemy_handbook_table.json` · `cn_character_table.json` 이 쓰인다. 레벨(등장 적)은 `cdnlevels` 가 CDN 에서 직접 연다.

스토리 있는 새 이벤트면 먼저 스토리 파이프라인이 돌아야 `unreleased` 에 오른다:
```bash
python3 scripts/build-story.py          # stories.json — CN_PROVISIONAL_NAMES 에 이름이 없으면 중국어 그대로 나간다
```

## 2. 어떤 이벤트가 새로 잡혀야 하나 — 먼저 목록을 뽑아 대조한다

```bash
exec </dev/null; python3 - <<'PY'
import json, time
cn = json.load(open('.gamedata/cn_activity_table.json'))['basicInfo']
kr = json.load(open('.gamedata/kr_activity_table.json'))['basicInfo']
ev = {e['id']: e for e in json.load(open('app/data/events.json'))['events']}
ymd = lambda t: time.strftime('%Y-%m-%d', time.gmtime(t))
pairs = sorted((b['startTime'], a) for a, b in cn.items() if a in kr and b.get('hasStage')
               and not b.get('isReplicate') and b.get('startTime') and kr[a].get('startTime'))
front = pairs[-1][0]
print('한섭이 마지막으로 따라온 이벤트:', pairs[-1][1], ymd(front))
for a, b in sorted(cn.items(), key=lambda kv: kv[1].get('startTime') or 0):
    if a in kr or not b.get('hasStage') or b.get('isReplicate') or (b.get('startTime') or 0) <= front:
        continue
    e = ev.get(a)
    print(a, b.get('type'), b.get('name'), ymd(b['startTime']), '→', e['n'] if e and e.get('fut') else '❌ 도감에 없음')
PY
```
`❌` 가 남으면 아래 3~6을 그 이벤트에 대해 채운다. **사용자가 이름을 댄 이벤트(예: "이격 켈시 오는 이벤트")가
목록에 없으면** 그 오퍼가 중섭 표에 처음 들어온 날을 찾아 그날 열린 이벤트를 본다 — 대개 기준선·필터 문제다.

## 3. 이벤트 이름 (AI 임시 번역 — 세 언어 다)

- 스토리 없는 것 → `build-events.py` `CN_ONLY_NAMES`, 스토리 있는 것 → `build-story.py` `CN_PROVISIONAL_NAMES`.
  `{"ko": …, "en": …, "ja": …}` 셋 다 채운다. 없으면 빌더가 `⚠ 중섭 선행 이벤트 …는 번역표(CN_ONLY_NAMES)에 없어
  도감에서 뺐다` 를 찍고 **행을 뺀다** (중국어 원문을 한국어 화면에 싣지 않는다).
- 표기 관례:
  - **4자 시제(詩題)** 는 한국어 한자 독음 — 포영창정(泡影苍霆)·월행수상(月行水上)·사세행(辞岁行). 일본어는 한자 그대로.
  - **메인 사이드(actNmainss)** 는 낱말을 옮긴다 — 해리성 결합·비정상 스펙트럼·상전이 임계(相变临界).
  - 벡터 돌파는 `벡터 돌파#N <부제>` (회차 번호는 게임이 매긴 것).
  - 같은 낱말이 `scripts/cn-translations.json` 의 재화 설명 등에 이미 옮겨져 있으면 **그 말을 따른다**
    (阵地足球锦标 = 진지 축구 토너먼트, 奇象巡展 = 기상 순회전). 공식 KR 표기는 `grep -l "<말>" .gamedata/kr_*.json`.
  - 괄호 역주 금지 (cn-translation-fill 스킬).

## 4. 작전·적·재화 이름 번역 — 미번역 0건까지

```bash
python3 scripts/build-events.py 2>&1 | grep -E "미번역|번역표|이벤트 [0-9]+개"
```
`⚠ 미래시 이벤트 미번역 ko/en/ja N건` 이 **세 언어 모두 사라질 때까지** `scripts/cn-translations.json` 에 채운다
(키는 중국어 원문 글자 그대로 — 전각 느낌표 `！`, 따옴표 `“”` 까지). 경고는 8건까지만 보여 주므로 전부 뽑아서 본다:

```bash
exec </dev/null; python3 - <<'PY'
import json, re
cn = re.compile(r'[一-鿿]')
for f in ('events.json', 'events.en.json', 'events.ja.json'):
    for e in json.load(open('app/data/' + f))['events']:
        if not e.get('fut'): continue
        for s in e.get('stages') or []:
            if cn.search(s[2] or ''): print(f, e['id'], '작전', s[1], s[2])
        for x in (e.get('enemies') or []) + (e.get('items') or []) + (e.get('mats') or []):
            if cn.search(x[1] or ''): print(f, e['id'], x[0], x[1])
PY
```
**번역 전에 공식 짝부터 찾는다** — 새 이벤트도 지난 모드의 용어를 그대로 잇는 일이 많다. 같은 id 의 중섭 원문과
한·영·일 판을 맞대면(`{cn,kr,en,jp}_enemy_handbook_table` 의 name·abilityList, `{…}_stage_table` 의 description —
`\\n` 을 줄바꿈으로 풀고 `<@…>`·`</>` 를 벗긴 뒤 줄·표식 순서로) 공식 표기가 나온다. 2026-10-01 에 지어냈다가 고친 것:

| 원문 | 한 | 영 | 일 |
|---|---|---|---|
| 阵地足球 · 阵地屏障 | 진지 축구 · 진지 방호벽 | Positional Football · Positional Barrier | ポジションサッカー · 陣地障壁 |
| 击球手 · 守门员 · 击人手 | 스트라이커 · 골키퍼 · 미드킬러 | Shooter · Goalie · Hitter | ストライカー · キーパー · エースキラー (팀명 뒤 の 없이) |
| 爱球会 · 球德联 · 战术队 | 동호회 · 축덕연 · 전술팀 | Ball Mania Club · Sportsmen United · Tactical Team | 愛球会 · 公正連 · 戦術組 |
| 风情街“…” | 패션가 '…' | Fashion Street '…' | 商店街「…」 |
| 集团军 | 군단 | (the) Army | ウルサス軍 |
| 真实伤害 · 法术伤害 · 技力 · 目标生命 · 假死 | 트루 대미지 · 마법 대미지 · SP · 목표 HP · 빈사 상태 | True/Arts damage · SP · Life Points · coma | 確定/術ダメージ · SP · 耐久値 · 仮死 |
| 菲林 | 필라인 | Feline | フェリーン |

기믹 표식 줄(`<활성 오리지늄> …`)은 한섭 문체 그대로 — `<표식> 설명 … 부여/획득/증가/불가`.
양이 많으면(100줄+) 영어·일본어를 에이전트 둘에 나눠 맡겨도 된다 — 입력에 원문·한국어·맥락, 위 표와 공식 표식 사전을 주고
"공식 짝을 `.gamedata` 에서 확인하라"고 시킨다. 돌아온 결과는 위 표대로 한 번 더 맞춘다.
⚠ build-future-dex 는 공식 짝을 사전보다 먼저 쓴다. 공식 영어판이 표식을 잃은 줄(`Deploy to block a tile…`)은
빌더가 표식 있는 사전 번역 → 공식 표식 이름 + 공식 본문 순으로 되살린다(`_hit`).

맥락이 필요하면 적은 `cn_enemy_handbook_table` 설명, 작전은 `cn_stage_table` 의 description 을 본다
(예: 逐影集趣의 绒绒 = 놀이공원의 복슬복슬한 생물 → 폭신이 / Fluffies / モフモフ).
일본어가 원문 한자와 같아도(消耗品·三生花) **값을 채운다** — 비어 있으면 미번역으로 친다.

## 5. 그림 (카드 섬네일)

| 경우 | 도구 | 저장 |
|---|---|---|
| 스토리 있는 이벤트 | build-story.py (중섭 배너 → 플레이스홀더 / `CN_THUMB_CUT` 컷씬) | `public/story/cn/<id>.webp` |
| 스토리 없고 **중섭에 지금 걸린** 이벤트 | `python3 scripts/build-event-art.py --server cn` (홈 테마 그림, CDN) | `public/event/<id>.webp` |
| 스토리 없고 **중섭에서 이미 끝난** 이벤트 | 같은 도구의 ⓓ 단계 — 에셋 미러 **cn 브랜치** `hometheme/<id>.png`·`<id>_1.png` | `public/event/<id>.webp` |

```bash
python3 scripts/build-event-art.py --server cn      # ①(지금 걸린 것) + ③④ 미러 대체(끝난 것) 를 한 번에
python3 scripts/build-events.py                     # 행에 thumb 를 잇는다
```
미러에도 없으면 `⚠ mirror(cn): … 못 찾았다` — 카드는 '이미지 없음'으로 뜬다. 미실장은 중섭판이 원본이라
그림 속 중국어 제목은 허용한다. 교환 재화 아이콘은 빌더가 `public/items/icon/<id>.webp` 로 받아 둔다.
⚠ `public/event/`·`public/items/` 는 **R2 폴더**다 — 새 파일은 커밋하고, 배포(deploy.sh 가 r2-sync)까지 해야 뜬다.
dev 도 그림을 R2(files.terra-archive.net)에서 받으므로 **배포 전 dev 에선 새 그림이 '이미지 없음'인 게 정상**이다.

## 6. 신규 오퍼 (그 이벤트와 함께 중섭에 데뷔한 오퍼)

배너 신규 오퍼는 게임 데이터가 이벤트와 묶어 주지 않는다. 중섭 캐릭터 표를 **개방일 앞뒤 판으로 비교**해서 잡는다:

```bash
python3 scripts/build-events.py                          # 먼저 — 오퍼 장부가 events.json 의 미실장 행을 대상으로 읽는다
python3 scripts/build-operator-debut.py --cn-only        # app/data/operator-debut.json 의 cnEventOps 만 갱신
python3 scripts/build-events.py                          # 다시 — 행에 ops 를 잇는다
```
- 대상 = stories.json `unreleased` + events.json 미실장 행 **둘 다** (종전엔 앞쪽만 봐서 스토리 없는 「相变临界」에
  켈시·에스페란타·클로저가 안 붙었다).
- 창은 개방일 14일 전 ~ 3일 뒤인데, **바로 앞 중섭 이벤트 개방일 다음 날보다 이르지 않게** 막는다 — 안 그러면
  앞 이벤트 오퍼가 '처음 나타난 판'으로 잡힌다 (진지 축구 06-08 ← 포영창정 05-31).
- ⚠ **`--cn-only` 로 돌린다.** 플래그 없이 `--cn-events` 를 돌리면 한섭 데뷔 장부(debut·baselineIds)까지
  이력에서 다시 계산해, 이번 일과 상관없는 기준선 변경이 딸려 나온다.
- 결과 줄(`act4mainss 중섭 개방 … +5: 켈시·에스페란타, 크랙본, Вий, GALLUS², 클로저`)을 **눈으로 확인한다** —
  축구·DP 같은 모드 이벤트는 0명이 정상이다. `operator-debut.json` diff 는 `cnEventOps` 안만 바뀌어야 한다.
- 오퍼 이름·아바타는 사이트 오퍼 목록(미실장 포함)에서 온다 — 목록에 없는 오퍼면 operator-data-update 가 먼저다.

## 6-1. 이벤트 창 상세 (작전 도면·적 초상·작전 설명·경로) — build-future-dex.py

카드는 events.json 이지만, 카드를 눌러 여는 **이벤트 창의 작전·적·재화 상세**는 `app/data/future-dex*.json` 이다
(본 도감에 없는 id 만 여기서 찾는다). **새 이벤트를 넣었으면 반드시 돌린다** — 안 돌리면 창에서 작전·적이 비어 보인다
(2026-10-01 다섯 개를 넣고 처음엔 빠뜨렸다).
```bash
python3 scripts/build-events.py           # 먼저 (미실장 행을 읽는다)
python3 scripts/build-future-dex.py       # 로컬은 그림까지 (중섭 CDN → 에셋 미러). CI 는 --no-images
```
- 미번역(작전 설명·적 설명·재화 설명)은 `scripts/future-dex-untranslated.json` 에 남는다 → cn-translations.json 에
  **줄 단위**로 채우고 다시 돌린다 (기믹 표식 `<…>` 은 원문대로). 세 언어 0건까지.
- 새 도면 `public/stage/…`·적 초상 `public/enemy/…` 등 `git status` 의 `??` 를 전부 커밋한다(R2 폴더).
- 새 이벤트 카메라는 도면에서 추정(scripts/camfit.py → stagecams-fit.json) — route-map-rules 스킬 ★절, 겹쳐서 눈으로 확인.

## 7. 상위 재료 (맵에서 파밍되는 재료)

한섭 이벤트와 **같은 규칙**: 작전의 **주요 드랍**(`dropType NORMAL`)이면서 재료이고 **T3 이상**(`MAT_TIER`)인 것만,
등급 높은 것 먼저. 미실장은 `cn_stage_table` 의 `stageDropInfo.displayDetailRewards` 에서 빌더가 같은 기준으로 뽑는다
(`cn_event_body` → `fut_localize`). 이름·아이콘·등급은 사이트 아이템 목록, 없으면 중섭 아이템 표(이름은 cn-translations).
특별·추가 드랍·완벽 작전 보상은 세지 않는다. 축구·DP·ARK_HUB 처럼 재료가 안 나오는 모드는 빈 게 정상이다.

## 8. 특수 이벤트

- **벡터 돌파** (`VEC_BREAK_V2`): 행에 `vb` 가 붙고 상세는 `build-event-vecbreak.py` — cn-big-patch 스킬 "벡터 돌파 새 회차".
- **듀얼 채널** (`ENEMY_DUEL`): `build-event-duel.py` (진행 중 회차 그림만 남는다 — build-event-art.py 머리주석).

## 9. 확인 — 숫자로 먼저, 화면은 한 장

```bash
exec </dev/null; python3 - <<'PY'
import json
for e in json.load(open('app/data/events.json'))['events']:
    if e.get('fut'):
        print(e['id'], e['n'], e.get('eta'), '그림' if e.get('thumb') else '❌그림',
              '작전', len(e.get('stages') or []), '적', len(e.get('enemies') or []),
              '재료', [m[1] for m in e.get('mats') or []], '오퍼', [o[1] for o in e.get('ops') or []])
PY
```
- 줄 순서가 중섭 개방일 최신순인지, ❌ 가 없는지, 4절 미번역 0건인지, 다른(한섭) 이벤트 행이 안 바뀌었는지
  (`git show HEAD:app/data/events.json` 과 미실장 아닌 행 대조).
- dev `/events` 위쪽 줄 — 긴 제목은 한 줄로 두고 넘치면 흐른다(Marquee, 미실장 줄 카드만), 예정월은 배지 밑 줄.

## 10. 커밋·배포

사용자가 배포하라고 할 때 `bash scripts/ship.sh -m "…" <경로…>` 를 배경으로 (ship-no-hang 기억). 집을 경로:
`scripts/build-events.py`(이름표) · `scripts/build-story.py`(이름표) · `scripts/cn-translations.json` ·
`app/data/events*.json` · `app/data/event-ids.json` · `app/data/operator-debut.json` · `app/data/stories*.json`(바뀌었으면) ·
`app/data/future-dex*.json` · `app/data/future-routes.json` · `scripts/stagecams-fit.json`(바뀌었으면) ·
새 `public/event/*.webp` · 새 `public/items/icon/*.webp` · 새 `public/stage/…`·`public/enemy/…` (`git status` 의 `??` 를 빠짐없이).
새 그림이 수십 장이면 경로를 변수에 담아 넘기지 말 것 — 셸이 zsh 라 `$NEW` 가 **한 덩어리**로 넘어가 git 이
`pathspec … did not match` 로 멈춘다(2026-10-01). 목록 파일 + xargs 로 넘긴다:
```bash
git ls-files --others --exclude-standard -z public/enemy public/stage public/event public/items > "$SP/new.lst"
xargs -0 bash scripts/ship.sh -m "$MSG" <고친 파일들…> < "$SP/new.lst"
```
**한국어가 다 되면 먼저 배포**하고 영어·일본어는 뒤이어 (korean-first-deploy 기억). 배포 뒤
`https://files.terra-archive.net/assets/event/<id>.webp` 가 200 인지, 라이브 `/events` 줄을 확인한다.
업데이트 내역은 changelog-post 스킬 (점검으로 열린 게 아니므로 "미실장 이벤트 N개 추가" 정도로 묶는다).
