---
name: gamedata-pull
description: 게임 CDN에서 gamedata를 직접 받아 사이트를 갱신한다 — 클뜯 레포를 기다리지 않는다. "클뜯 아직 안 올라왔는데 갱신해줘", "지금 바로 데이터 받아와", "CDN에서 직접 뜯어줘", "게임엔 떴는데 사이트에 없어", 그리고 점검 뒤 갱신 전반에 사용. 스키마가 어긋나 표를 못 뜯을 때도 이 스킬.
---

# 게임 CDN에서 직접 받기 — 클뜯 레포를 기다리지 않는다

클뜯 레포(`ArknightsAssets/ArknightsGamedata`)는 **사람이 돌려야** 올라온다.
2026-09-02 위수 협의 2단계 때 실측하니 레포의 `kr/gamedata/excel`이 **11일** 뒤처져 있었다.
게임이 실제로 받는 CDN에서 직접 받으면 **인게임 업데이트와 동시에** 손에 들어온다.

원리·검증 수치·함정은 [docs/PROJECT-GUIDE.md](../../../docs/PROJECT-GUIDE.md) **§2-1**이 정본.
이 스킬은 절차만 적는다.

## 0. 준비 (한 번만)

```bash
brew install flatbuffers          # flatc
pip3 install --user UnityPy lz4inv
```

## 1. 새 데이터가 올라왔는지 확인 (1초)

```bash
python3 scripts/fetch-gamedata-cdn.py --check
```

`resVersion`이 지난번과 다르면 새 데이터다. **버전 문자열은 빌드 시각이지 배포 시각이 아니다** —
`26-08-31-…`이 9/2에 배포될 수 있다. 헷갈리면 HTTP `last-modified`를 본다:

```bash
curl -sI "https://ark-kr-static-online-1300509597.yo-star.com/assetbundle/official/Android/version" | grep -i last-modified
```

무엇이 들어왔는지 **공식 인게임 공지**로 확인하면 확실하다 (게임 데이터를 뜯기 전에
무엇을 찾아야 하는지 알고 시작하는 게 낫다):

```bash
python3 - <<'PY'
import json, re, sys; sys.path.insert(0, "scripts")
from fetchutil import urlread
g = lambda u: json.loads(urlread(u, timeout=60, ua="ta").decode())
c = g("https://ak-conf.arknights.kr/config/prod/official/network_config")
n = json.loads(c["content"]); U = n["configs"][n["funcVer"]]["network"]
a = g(U["an"].replace("{0}", "Android"))["announceList"][0]
print(re.sub(r"\n{2,}", "\n", re.sub(r"<[^>]+>", "\n", urlread(a["webUrl"], timeout=60,
      ua="Mozilla/5.0").decode("utf-8", "replace"))).strip()[:1500])
PY
```

## 2. 받는다 — **화면에 나가는 세 서버를 다 받는다**

```bash
python3 scripts/fetch-gamedata-cdn.py                  # kr 20표 → .gamedata/kr_*.json
python3 scripts/fetch-gamedata-cdn.py --server jp      # 일섭 18표
python3 scripts/fetch-gamedata-cdn.py --server en      # 글섭 18표
python3 scripts/fetch-gamedata-cdn.py --server cn      # 중섭 14표 — **미래시 전용**
python3 scripts/fetch-gamedata-cdn.py --tables activity_table,character_table   # 필요한 것만
```

표 목록은 서버마다 다르다(`TABLES` 상수 — `fetch-gamedata.py`의 세트와 같다).
`fetch-gamedata.py`(레포판)와 **출력이 완전히 같아서** 뒤 파이프라인은 손댈 것이 없다.

**중섭은 성격이 다르다.** 한·일·글은 그 언어 화면을 만들지만, 중섭은 **미래시(선행 정보)
전용**이라 이벤트·구역·스테이지 표를 아예 받지 않는다 — 중섭 콘텐츠를 사이트에 싣지
않기 때문. 중섭 패치 대응은 [`cn-big-patch`](../cn-big-patch/SKILL.md) ·
[`cn-small-patch`](../cn-small-patch/SKILL.md).

### ⚠ 받은 뒤 `ci-refresh.sh`를 그냥 돌리지 말 것

그 스크립트는 맨 앞에서 `fetch-gamedata.py`(클뜯 레포)를 돌려 **방금 CDN에서 받은 것을
통째로 덮어쓴다.** 레포는 며칠씩 밀리므로(실측 11일) 조용히 옛 데이터로 사이트가 만들어진다.

```bash
SKIP_FETCH=1 bash scripts/ci-refresh.sh      # ← .gamedata 의 기존(=CDN) 데이터를 쓴다
```

무인 CI는 CDN 단계가 없으니 기본값(레포에서 받기) 그대로 둔다 — 이 플래그는 **로컬 전용**이다.

⚠ **한섭만 받고 끝내지 말 것.** 사이트는 3개 언어인데 한섭만 새로 받으면 EN/JA가 낡은
데이터로 만들어져 **번역이 있는데도 한국어로 폴백한다.** 2026-09-02에 실제로 그랬다 —
일섭엔 신규 전략 4종이 이미 들어와 있었는데 한섭만 CDN에서 받는 바람에 일본어가 한국어로
나간 채 배포됐다.

⚠ **서버마다 리소스 버전이 따로 논다.** 같은 날 실측: kr `26-08-31` · jp `26-08-28` ·
en `26-08-17` (클라는 셋 다 36.7.22). 그러니 "한섭에 있으면 일섭에도 있겠지"도,
"일섭에 없으니 글섭에도 없겠지"도 둘 다 틀린다 — **서버마다 직접 확인한다.**
정말로 그 서버에 아직 안 들어온 것이면 한국어 폴백이 정상이니 억지로 메우지 말고 사용자에게 알린다.

⚠ 표를 건너뛰면 **3번**으로. 건너뛴 채로 파이프라인을 돌리면 그 표를 쓰는 데이터가 조용히 망가진다.

## 3. 스키마가 어긋났을 때 (클라가 올라가면 생긴다)

```bash
python3 scripts/fbs-repair.py <표이름> --server <서버> --dry-run   # 무엇을 지울지만 본다
python3 scripts/fbs-repair.py <표이름> --server <서버>             # → scripts/fbs/<서버>/<표>.fbs
```

클뜯 레포의 그 서버 JSON을 정답지로 삼아 자동으로 고친다 (하위 테이블까지).
**정답지가 낡아도 된다** — 어긋난 필드를 찾는 데만 쓰지, 데이터를 가져오는 게 아니다.

⚠ **`--server`를 빼먹지 말 것.** 스키마는 서버마다 따로 둔다(`scripts/fbs/<서버>/`).
kr 것만 만들어 두면 jp·en은 중섭 스키마를 물다 실패한다.

⚠ **중섭은 스키마를 만들 필요가 없다.** 공개 스키마(`scripts/fbs/_cache/`, OpenArknightsFBS
`main` 브랜치)가 **곧 중섭 현행판**이라 그대로 맞는다 — 2026-09-04 실측으로 14표 중
13표가 손 안 대고 뜯렸다(나머지 1표는 예정된 `range_table` 폴백). 거꾸로 말하면
**중섭에서 스키마가 어긋나면 공개 스키마가 아직 안 따라온 것**이니, 고치기 전에
`rm -rf scripts/fbs/_cache` 로 최신판을 다시 받아 보는 게 먼저다.

⚠ **클라가 올라가면 그 서버 스키마는 낡는다.** 2026-09-04에 글섭 클라가 `26-08-17`→
`26-08-28`로 오르자 9/2에 만들어 둔 en 스키마 3개(`building_data`·`stage_table`·
`retro_table`)가 한꺼번에 어긋났다 — 한 번 만들었다고 끝이 아니다.

### ⚠ "예정에 없던 레포 폴백" 경고를 무시하지 말 것

CDN에서 못 뜯으면 스크립트가 클뜯 레포판으로 메우고 **경고를 찍는다**:

```
⚠ 예정에 없던 레포 폴백 1개 — 레포판은 CDN보다 낡았을 수 있다:
    activity_table           디코딩 실패
  → python3 scripts/fbs-repair.py <표이름> --server jp  로 스키마를 고친 뒤 다시 받을 것
```

`range_table`처럼 **예정된** 폴백은 요약줄에만 세고 경고하지 않는다. 경고가 뜨는 건
고쳐야 하는 것이다 — 그냥 두면 그 표만 며칠 낡은 데이터로 사이트가 만들어진다.
2026-09-02에 이 폴백이 실패를 가려서 일본어가 한국어로 나간 채 배포됐다.

## 3-5. 무엇이 바뀌었나 — 짐작하지 말고 뽑는다

```bash
python3 scripts/whatsnew-gamedata.py --local --no-rogue
```

`fetch-gamedata-cdn.py`가 덮어쓰기 전에 남긴 `.gamedata/.prev/` 스냅샷과 비교해
① 무엇이 바뀌었고 ② **어떤 파이프라인을 돌려야 하는지**까지 찍는다.

```
■ [activity_table] 기존 활동 **속**이 바뀐 것 1개
    ~ act2autochess        bandDataListDict 36→40
■ 사이트 반영 — 돌려야 할 파이프라인
    · 위수 협의: python3 scripts/build-autochess.py (+ build-autochess-routes.py …) → r2-sync
```

⚠ 신규 이벤트만 보지 말 것. **기존 이벤트가 속으로 불어나는 경우**가 있다 —
2026-09-02 위수 협의 2단계가 그랬다. 새 이벤트가 아니라 `act2autochess` 안에서 전략이
36→40이 된 것이라 `basicInfo`는 한 글자도 안 바뀌었다. 위 출력의 "속이 바뀐 것" 절이 그걸 잡는다.

## 4. 재생성 → 검증 → 빌드

3-5가 찍어 준 파이프라인을 돌린다 (목록 전체는 `scripts/README.md` §3~). 위수 협의라면:

```bash
python3 scripts/build-autochess.py --all          # 지난 시즌까지 (+ public/ac/ 아이콘)
python3 scripts/build-autochess-routes.py --all   # 전투 맵이 바뀌었으면
```
> **새 시즌(`act<N>autochess`)이 처음 보이면** 화면 배선을 같이 고쳐야 한다 —
> `.claude/skills/autochess-season` 스킬이 정본이다.

**돌린 뒤 반드시 커밋본과 대조한다** — 순수 추가여야 하고, 기존 항목이 무더기로 바뀌면
디코딩이 잘못된 것이다 (2026-09-02에 실제로 기물 121개의 이름·스킬이 통째로 `None`이 된 적이
있다 — 루트 껍데기를 안 벗겨서였다):

```bash
python3 - <<'PY'
import json, subprocess
f = "app/data/autochess.json"
old = json.loads(subprocess.run(["git","show","HEAD:"+f],capture_output=True).stdout.decode())
new = json.load(open(f))
for k in old:
    a, b = old[k], new[k]
    if a == b: continue
    if isinstance(a, list) and a and isinstance(a[0], dict) and "id" in a[0]:
        om = {x["id"]: x for x in a}; nm = {x["id"]: x for x in b}
        add = [i for i in nm if i not in om]; rm = [i for i in om if i not in nm]
        ch = [i for i in om if i in nm and om[i] != nm[i]]
        print("  %-8s +%d -%d ~%d  %s" % (k, len(add), len(rm), len(ch), add[:5]))
    elif isinstance(a, dict):
        print("  %-8s +%d -%d ~%d" % (k, len([i for i in b if i not in a]),
              len([i for i in a if i not in b]), len([i for i in a if i in b and a[i]!=b[i]])))
PY
```

그다음 **화면에 박힌 숫자**를 찾아 고친다 — 데이터만 늘리고 여기를 빼먹으면 소개·SEO 문구가
어긋난다 (3개 언어 전부):

```bash
grep -rnE "전략 3[0-9]|3[0-9] strateg|戦略3[0-9]" app/ docs/ | grep -v node_modules
```

`app/seo.ts` · `app/about.tsx` · `docs/PROJECT-GUIDE.md` 개요표가 단골이다.

```bash
npm run build
```

## 5. 마무리

빌드 통과 → 커밋 → push. **`scripts/deploy.sh`는 실행하지 않는다** (CLAUDE.md — 배포는 사용자가 직접).
새 아이콘이 생겼으면 배포가 `r2-sync`를 같이 도니 따로 돌릴 것 없다.
배포가 끝났다고 하면 그때 업데이트 내역을 등록한다 (DB라서 먼저 올리면 없는 기능을 가리킨다).

## 알아 둘 것

- **암호화가 아니다.** gamedata는 앞 128바이트 RSA 서명 + 평문 FlatBuffer다. 중섭도 한섭도 같다.
  공개된 중섭 AES 마스크(`UITpAi82pHAWwnzq…`)는 표가 JSON이던 옛 시절 유물이라 안 풀린다 —
  안 풀리는 게 정상이니 키를 찾아 헤매지 말 것.
- **ipatool로 IPA를 받는 건 헛수고다.** FairPlay는 실행 바이너리만 걸고, 애초에 앱 패키지엔
  gamedata가 거의 없다 — 첫 실행 때 이 CDN에서 통째로 받는다.
- **`range_table`은 CDN에서 못 뜯는다** (옛 AES 형식이 남은 소수 레거시 표, 엔트로피 7.997).
  스크립트가 자동으로 레포판을 받아 메우므로 신경 쓸 것 없다. 연 2~4회만 바뀐다.
- EN/JA는 그 서버에 콘텐츠가 들어와야 번역이 채워진다. 한섭 선출시 구간에서는 이름만 번역되고
  본문이 한국어로 폴백하는 게 **정상**이다 — 억지로 메우지 말고 그대로 두고 사용자에게 알린다.
