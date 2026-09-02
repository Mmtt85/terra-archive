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

## 2. 받는다

```bash
python3 scripts/fetch-gamedata-cdn.py                  # kr 기본 20표 → .gamedata/kr_*.json
python3 scripts/fetch-gamedata-cdn.py --tables activity_table,character_table   # 필요한 것만
```

`fetch-gamedata.py`(레포판)와 **출력이 완전히 같아서** 뒤 파이프라인은 손댈 것이 없다.
EN/JA도 필요하면 `--server en` / `--server jp`.

⚠ 표를 건너뛰면 **3번**으로. 건너뛴 채로 파이프라인을 돌리면 그 표를 쓰는 데이터가 조용히 망가진다.

## 3. 스키마가 어긋났을 때 (클라가 올라가면 생긴다)

```bash
python3 scripts/fbs-repair.py <표이름> --dry-run   # 무엇을 지울지만 본다
python3 scripts/fbs-repair.py <표이름>             # → scripts/fbs/<서버>/<표>.fbs
```

클뜯 레포의 그 서버 JSON을 정답지로 삼아 자동으로 고친다 (하위 테이블까지).
**정답지가 낡아도 된다** — 어긋난 필드를 찾는 데만 쓰지, 데이터를 가져오는 게 아니다.

## 4. 재생성 → 검증 → 빌드

바뀐 표에 맞는 스크립트만 돌린다 (`scripts/README.md` §3~). 위수 협의라면:

```bash
python3 scripts/build-autochess.py          # + public/ac/ 아이콘
python3 scripts/build-autochess-routes.py   # 전투 맵이 바뀌었으면
```

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
