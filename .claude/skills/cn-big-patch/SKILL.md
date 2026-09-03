---
name: cn-big-patch
description: 중국서버 큰 패치(停机更新 — 서버 정지, 클라 버전이 오름) 뒤 미래시 데이터를 통째로 따라잡히는 절차. "중섭 패치됐어", "중섭 업뎃 반영해줘", "미래시 갱신해줘", "중섭 신규 오퍼 들어왔어" 같은 요청에 사용. 작은 패치(闪断更新)는 cn-small-patch.
---

# 중국서버 큰 패치 대응 — 미래시를 통째로 따라잡기

## 중섭은 성격이 다르다 — 먼저 이걸 이해할 것

한·일·글 서버는 **그 언어 화면**을 만든다. 중섭은 **미래시(선행 정보) 전용**이다.
사이트에 중섭 콘텐츠를 싣지 않는다 — 헤더의 '미래시 데이터 포함'을 켰을 때 보이는
**아직 한섭에 안 나온 오퍼·재료·모듈·스킨**이 전부다.

그래서 중섭에서 받는 표는 **14개뿐**이고 (`activity_table`·`zone_table`·`stage_table`·
`gacha_table`·`retro_table`·`climb_tower_table` 없음), 중섭 이벤트가 열려도
**사이트에는 아무 일도 일어나지 않는 것이 정상**이다. 반영되는 건 오퍼/재료/모듈/스킨/
통합전략/생존연산처럼 **한섭에 언젠가 넘어올 것**들이다.

| | **큰 패치 (停机更新)** | 작은 패치 (闪断更新) |
|---|---|---|
| 성격 | 서버 정지. **클라 버전이 오른다** (2.7.x → 2.8.x) | 10분 순단. 리소스만 |
| 신호 | `clientVersion` 상승 | `resVersion`만 상승 |
| 대응 | **이 스킬** | [`cn-small-patch`](../cn-small-patch/SKILL.md) |

전 과정에서 `bash scripts/deploy.sh`는 실행 금지 (CLAUDE.md) — 빌드·커밋·푸시까지만.

---

## 1. 무엇이 올라왔나 확인 (1초)

```bash
python3 scripts/fetch-gamedata-cdn.py --server cn --check
```

```
cn CDN  resVersion 26-08-17-11-25-42_dbc172  (client 2.7.61)
```

**`clientVersion`이 올랐으면 큰 패치**, `resVersion`만 올랐으면 작은 패치다.
중섭 클라 버전 체계는 요스타 서버들과 아예 다르다 (중섭 `2.7.61` vs 한·일·글 `36.7.22`) —
숫자를 서로 비교하지 말 것.

⚠ **버전 문자열은 빌드 시각이지 배포 시각이 아니다.** 실제 배포 시각은 HTTP `last-modified`:

```bash
python3 - <<'PY'
import json, sys, urllib.request; sys.path.insert(0, "scripts")
from fetchutil import urlread
c = json.loads(urlread("https://ak-conf.hypergryph.com/config/prod/official/network_config",
                       timeout=60, ua="ta").decode())
n = json.loads(c["content"]); vu = n["configs"][n["funcVer"]]["network"]["hv"].replace("{0}", "Android")
v = json.loads(urlread(vu, timeout=60, ua="ta").decode())
r = urllib.request.Request(vu, headers={"User-Agent": "ta"}, method="HEAD")
print(v["resVersion"], v["clientVersion"],
      urllib.request.urlopen(r, timeout=60).headers.get("last-modified"))
PY
```

> 2026-09-04 기준선: `26-08-17-11-25-42_dbc172` / client `2.7.61` /
> last-modified `Fri, 21 Aug 2026 08:00:36 GMT` (= 8/21 17:00 KST).

### ⚠ 중섭 공지 엔드포인트는 죽어 있다 — 시간 낭비하지 말 것

한섭 절차에 있는 `network_config` → `an` → `announceList` 방식이 중섭에도 있지만,
**2026-09-04에 조회하니 2025년 5월 공지(announceId 2069)가 그대로 나왔다.** 1년 넘게
멈춘 피드다. 중섭에서 무엇이 들어왔는지는 **공지가 아니라 §3의 표 비교로 판단한다.**
(공식 방송 일정은 비리비리 라이브룸 — `scripts/build-broadcasts-cn.py`가 이미 수집한다.)

## 2. 받는다

```bash
python3 scripts/fetch-gamedata-cdn.py --server cn        # 14표 → .gamedata/cn_*.json
```

절차·함정 전체는 **[`gamedata-pull`](../gamedata-pull/SKILL.md) 스킬**이 정본.

- **중섭은 스키마를 손볼 일이 거의 없다.** 공개 스키마(`scripts/fbs/_cache/`,
  OpenArknightsFBS `main`)가 **곧 중섭 현행판**이기 때문 — 2026-09-04 실측 13/13 성공
  (+ 예정된 `range_table` 레포 폴백 1). 거꾸로 중섭에서 어긋나면 공개 스키마가 아직
  안 따라온 것이니, `fbs-repair` 전에 `rm -rf scripts/fbs/_cache` 로 최신판을 다시 받아 볼 것.
- **한섭도 같이 움직였는지 반드시 본다.** 중섭 큰 패치 날 한섭이 조용하리란 보장이 없다:
  ```bash
  for s in kr jp en; do python3 scripts/fetch-gamedata-cdn.py --server $s --check; done
  ```
  움직인 서버가 있으면 그쪽도 받고 [`kr-big-patch`](../kr-big-patch/SKILL.md)로 넘어간다.

## 3. 무엇이 바뀌었나 — 추측하지 말고 뽑는다

```bash
python3 scripts/whatsnew-gamedata.py --local --server cn
```

`fetch-gamedata-cdn.py`가 덮어쓰기 전에 남긴 `.gamedata/.prev/` 스냅샷과 비교한다.
중섭에 없는 표(활동·구역 등)는 알아서 건너뛴다.

**중섭에서 봐야 할 것** — 이것만이 사이트에 닿는다:

| 신호 | 뜻 | 반영 경로 |
|---|---|---|
| `character_table` 신규 | 신규 오퍼 (미래시) | §4 결정론 레인 + §5 번역 |
| `uniequip_table` 신규 | 신규 모듈 (**기존 오퍼에 조용히 붙는다**) | §4 + `audit-modules` |
| `item_table` 신규 | 신규 재료 | §4 + §5 번역 |
| `skin_table` 신규 | 신규 스킨 | `build-skins.py` |
| `building_data` 변경 | 인프라 스킬 신설·수치 변경 | §4 (`build-infra`) |
| `sandbox_perm_table` 변경 | 생존연산 신시즌 (중섭 선행) | `build-sandbox.py` |
| `enemy_handbook_table` 신규 | 신규 적 | `build-enemies.py` |

## 4. 결정론 레인 — **SKIP_FETCH 를 빼먹지 말 것**

```bash
SKIP_FETCH=1 bash scripts/ci-refresh.sh          # ~8분
```

> ⚠ **`SKIP_FETCH=1` 없이 돌리면 방금 받은 CDN 데이터가 통째로 날아간다.**
> `ci-refresh.sh`는 맨 앞에서 `fetch-gamedata.py`(클뜯 레포)를 돌리는데, 레포는 사람이
> 돌려야 올라와서 며칠씩 밀린다 — 덮이면 **조용히** 옛 데이터로 사이트가 만들어진다.
> 무인 CI는 CDN 단계가 없으므로 기본값 그대로 둔다(이 플래그는 로컬 전용).

KR을 재생성하면 EN/JA도 같이 나온다(`build-i18n.py`가 레인 안에 있다 — CLAUDE.md 규칙 충족).
중섭 데이터는 이 레인 안에서 `regen-operators`·`build-costs`·`build-infra`·`build-i18n`이
**미실장 항목의 원본**으로 읽는다.

## 5. 중국어 원문 번역 — 중섭 패치의 **본론**

신규 오퍼·재료의 텍스트는 KR 번역이 아직 없어 **중국어 원문 그대로** 나간다.
큰 패치에서 가장 손이 많이 가는 곳이고, 빠뜨리면 미래시 화면에 한자가 그대로 뜬다.

```bash
SKIP_FETCH=1 bash scripts/ci-refresh.sh 2>&1 | grep -Ei "미번역|未|译" | sort -u
```

걸리는 게 있으면 **[`cn-translation-fill`](../cn-translation-fill/SKILL.md) 스킬**로 넘어간다
(`scripts/cn-translations.json`에 ko/en/ja를 채우면 파이프라인이 오버레이한다).

## 6. 레인 밖 — 중섭 선행 콘텐츠

`ci-refresh.sh`에 **없는** 것들이다. §3에서 신호가 잡혔을 때만 돌린다.

```bash
python3 scripts/audit-modules.py .gamedata     # 기존 오퍼에 붙은 신규 모듈 전수 (리포트)
python3 scripts/build-skins.py                 # 전체 실행 — CI는 --meta-only라 아트가 안 온다
node scripts/r2-sync.mjs                       # ⚠ 새 이미지가 생겼으면 필수 (안 하면 404)
```

**통합전략(록라) 중섭 변형** — 새 토픽이나 확장팩이 왔으면:
```bash
rm -f .gamedata/rogue/*roguelike_topic_table.json    # 캐시를 지워야 새 표를 받는다
python3 scripts/build-rogue.py cn                    # 중섭 변형 일괄 (미래시)
python3 scripts/build-stages-rogue.py                # 작전 도감의 록라 색인도 따라가야 한다
```

**생존연산 신시즌** (`sandbox_perm_table` 변경 시):
```bash
python3 scripts/build-sandbox.py
```

## 7. 마무리

```bash
Skill: terra-maintain      # 밀린 수작업(연대기·시너지·CN 번역·록라) 재감지
npm run build
```

빌드 통과 → 커밋 → `git push`. **배포는 사용자가 직접** (`bash scripts/deploy.sh` 금지).

푸시 전:
- `public/sitemap.xml`은 건드리지 않는다 —
  `git stash push -q public/sitemap.xml` → `git pull --rebase -q` → `git push -q` → `git stash pop -q`
- 무인 파이프라인이 그새 커밋했을 수 있다 (`git pull --rebase`)

## 보고

끝나면 세 줄로 나눠 보고한다:
① **중섭에 실제로 들어온 것** (신규 오퍼·모듈·재료 이름까지 — "패치 있었음"으로 끝내지 말 것)
② **사이트에 반영한 것** (미래시 토글을 켜야 보인다는 점을 같이)
③ **사람 손이 더 필요한 것** (번역 미완, PRTS 미채움 등)

## 알아 둘 것

- **중섭 이벤트가 열려도 사이트는 그대로다** — 정상이다. 미래시는 오퍼·재료·모듈 축이지
  이벤트 축이 아니다. "중섭 이벤트 왔는데 왜 안 보이냐"는 질문에는 이걸 설명한다.
- **미실장 오퍼는 인프라 플래너·공채에서 자동 제외된다** (KR 데이터 기반 — INFRA-RULES §9).
  번역은 표시용일 뿐 계산에 영향이 없다.
- **미출시 이벤트는 테라 연대기에 넣지 않는다** (`chronicle-register` 스킬 주의사항).
- 중섭 CDN도 한섭과 완전히 같은 구조다 — 암호화가 아니라 128바이트 RSA 서명 + 평문
  FlatBuffer. 원리는 `docs/PROJECT-GUIDE.md` §2-1.
