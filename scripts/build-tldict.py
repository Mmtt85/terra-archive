#!/usr/bin/env python3
"""중국어→한국어 번역 사전 공개본 — 사람이 열어 읽을 수 있는 모양으로 낸다.

배경 (2026-09-17):
  중섭 화면을 OCR로 읽어 한국어를 덧씌우는 개인 앱에서 "공개 API·오프라인 사전·증분
  동기화가 가능하냐"는 문의가 왔다.

⚠ **200개씩 끊는 조각(chunk)은 만들지 않는다 — 한 번 만들었다가 접었다.**
  사전 전량이 3MB인데 받는 쪽은 2~3주에 한 번 내려받는다. 증분으로 아끼는 건 한 달에
  3MB뿐인데, 그 대가로 47개짜리 조각 파일이 생기고 **열어 봐도 뭐가 든 파일인지 알 수
  없어졌다** (사용자 지적 2026-09-17: "청크 안에 내용이 그냥 중구난방이라 읽을 수가 없음").
  조각 배정 상태를 물려받는 코드에서 고아 파일 버그도 났다. 아낀 것보다 치른 게 컸다.

  그래서 **의미 있는 경계로만** 가른다:
    · 콘텐츠 단위 (통합전략은 테마별, 생존연산, 오퍼)
    · 자주 바뀌는 것 ↔ 거의 안 바뀌는 것 (op-fut ↔ op-past)
  파일마다 해시를 manifest에 실으므로 증분은 **파일 단위로** 그대로 된다.

내는 것 (11개):
  manifest.json      파일 목록·해시·항목 수 + **바로 요청할 수 있는 URL**
  op-fut.json        미실장 오퍼·재료 — 중섭 패치마다 늘어난다
  op-past.json       한섭 출시로 공식 번역이 덮은 옛 장부 — 거의 안 바뀐다
  ra.json            생존연산
  is1.json … is6.json  통합전략 1~6 — 안에서 소장품·노드·조우·엔딩·전투로 갈라 둔다
  is-common.json     통합전략 공통 조우 편집자 텍스트 (테마 구분이 없는 안내·판정 문구)

통합전략 파일 모양 (사용자 지시 2026-09-17 "is3 : {아이템: 뭐시기, 적: 뭐시기} 이런 식"):
  {"소장품": {"热水壶": {"ko": "전기주전자"}, …}, "노드": {…}, "조우": {…}, …}

출처:
  scripts/cn-translations.json   미실장 오퍼·재료 상세 (특성·재능·스킬·잠재·모듈·기반시설)
  scripts/sandbox-cn-ko.json     생존연산
  scripts/rogue-enc-i18n.json    통합전략 조우 씬 텍스트 (게임 excel에 없는 직접 집필분)
  app/data/rogue{1..5}.cn.json   통합전략 1~5 — **원문 병기(`cn` 필드)** 에서 긁는다
  app/data/rogue6.json           통합전략 6 — 같은 방식

  ⚠ 통합전략은 **여섯 테마 전부**다 (사용자 지시 2026-09-17). 1~5는 사전 파일이 따로
    없는데, build-rogue.py 의 cn_koreanize() 가 이름·제목·설명에 CN 원문을 `cn` 필드로
    병기해 두므로 거기서 (cn → 한국어) 짝을 그대로 긁어낼 수 있다.

  ⚠ `scripts/rogue-i18n.json`·`rogue<N>-curated.json`·`scripts/story-i18n/` 은 **뺐다** —
    키가 중국어가 아니라 한국어라 CN 화면 OCR로는 찾을 수 없다.

manifest 에 URL 을 미리 박아 둔다 (사용자 지시 2026-09-17) — 받는 쪽이 주소를 조합하지
않게 하려는 것이고, 거기에 **해시를 `?v=` 로 같이 박는다.** 조각 JSON 의 캐시 정책이
`max-age=60, must-revalidate` 라, 해시가 바뀐 걸 보고 곧바로 받아도 자기 캐시·중간
프록시·CDN 엣지가 옛 바이트를 돌려줄 창이 남는다. 내용이 바뀌면 URL 이 바뀌므로 그 창이
닫힌다 — 이 사이트가 이미 같은 사고를 겪고 같은 방식으로 막아 둔 자리가 있다
(app/rogue.tsx 의 `?v=2` "트리밍 전 이미지가 CDN 엣지에 남아 몇 시간째 옛 그림").
R2 워커는 쿼리 파라미터를 무시하고 같은 오브젝트를 준다 (실측 2026-09-17).
도메인·경로를 옮겨도 받는 쪽은 manifest 만 다시 받으면 따라온다 — 하드코딩할 것이
manifest 주소 하나로 줄어든다.

사용:  python3 scripts/build-tldict.py
"""
import hashlib
import json
import os
import re
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "public", "tl")
# ⚠ **사용자가 "완전히 끝났다"고 오케이 하기 전까지는 1로 둔다** (지시 2026-09-17).
#   아직 아무도 받아 가지 않는 동안 형식을 다듬는 중이라, 그 과정에서 2·3·4로 올려 봐야
#   받는 쪽엔 아무 의미가 없고 첫 공개본이 v4 로 나가는 이상한 모양만 남는다.
#   **공개를 승인받은 뒤부터** 형식이 바뀔 때 올린다 — 그때 받는 쪽은 모르는 v 를 보면
#   전량을 다시 받으면 된다 (public/tl/README.md 에 그렇게 적어 뒀다).
# ⚠ **사용자가 "완전히 끝났다"고 오케이 하기 전까지는 1로 둔다** (지시 2026-09-17).
#   아직 아무도 받아 가지 않는 동안 형식을 다듬는 중이라, 그 과정에서 2·3·4로 올려 봐야
#   받는 쪽엔 아무 의미가 없고 첫 공개본이 v4로 나가는 이상한 모양만 남는다.
#   **공개를 승인받은 뒤부터** 형식이 바뀔 때 올린다 — 그때 받는 쪽은 모르는 v를 보면
#   전량을 다시 받으면 된다 (public/tl/README.md에 그렇게 적어 뒀다).
FORMAT_VERSION = 1
# 공개 기준 주소 — r2-sync.mjs 가 public/<경로> 를 assets/<경로> 로 올린다 (PREFIX="assets/").
# 여기를 고치면 manifest 의 base·url 이 함께 따라간다.
BASE = "https://files.terra-archive.net/assets/tl"

CJK = re.compile(r"[一-鿿]")

# 통합전략 산출물의 컬렉션 → 파일 안의 갈래 이름. 제보자가 물어 온 갈래 그대로 맞춘다
# ("소장품·노드·조우·엔딩·전투 설명").
IS_GROUP = {
    "relics": "소장품", "capsules": "소장품", "tools": "소장품",
    "scraps": "소장품", "legacies": "소장품", "buoys": "소장품",
    "nodeTypes": "노드", "zones": "노드", "weathers": "노드",
    "subweathers": "노드", "difficulties": "노드",
    "encounters": "조우", "visitors": "조우",
    "endings": "엔딩",
    "stages": "전투", "enemies": "전투", "bands": "전투",
    "mechanics": "전투", "variations": "전투",
}
IS_ORDER = ["소장품", "노드", "조우", "엔딩", "전투"]

ROGUE_FILES = [("is1", "app/data/rogue1.cn.json"), ("is2", "app/data/rogue2.cn.json"),
               ("is3", "app/data/rogue3.cn.json"), ("is4", "app/data/rogue4.cn.json"),
               ("is5", "app/data/rogue5.cn.json"),
               # 6번은 중섭 선행이라 CN 변형 빌드가 없다 — KR 산출물이 원문 병기를 들고 있다
               ("is6", "app/data/rogue6.json")]

FUT_THEMES = {"is6"}   # 아직 한섭에 없는 테마


def load(rel):
    with open(os.path.join(REPO, rel), encoding="utf-8") as fp:
        return json.load(fp)


def harvest_rogue(doc):
    """통합전략 산출물에서 {갈래: {중국어 원문: {ko}}} 를 긁는다.

    build-rogue.py 의 cn_koreanize() 가 이름·제목·설명에 CN 원문을 `cn` 필드로 병기해
    둔다 — 인게임 화면이 중국어라 대조할 것이 있어야 하기 때문이다(사용자 지적 2026-09-06).
    그 병기를 뒤집으면 그대로 CN→KO 사전이 된다.
    """
    groups = {}

    def walk(x, group):
        if isinstance(x, dict):
            cn = x.get("cn")
            if isinstance(cn, str) and CJK.search(cn):
                for field in ("name", "title", "desc"):
                    ko = x.get(field)
                    if isinstance(ko, str) and ko.strip() and not CJK.search(ko):
                        groups.setdefault(group, {}).setdefault(cn, {"ko": ko})
                        break
            for v in x.values():
                walk(v, group)
        elif isinstance(x, list):
            for v in x:
                walk(v, group)

    for coll, val in doc.items():
        group = IS_GROUP.get(coll)
        if group:
            walk(val, group)
    return {g: groups[g] for g in IS_ORDER if groups.get(g)}


def live_blobs():
    """지금 사이트 데이터에 실려 있는 한국어 뭉치 — '아직 한섭에 없나' 판정용.

    cn-translations.json 은 **과거 미실장 번역이 쌓인 장부**다. 한섭에 정식 출시되면
    공식 번역이 그 자리를 덮으므로 옛 AI 번역문은 더 이상 산출물에 나타나지 않는다
    (실측 2026-09-17: 2,802건 중 2,451건이 이미 대체됨). 그래서 "지금 산출물에 그
    번역문이 보이나"가 곧 "아직 한섭에 없나"다.
    """
    out = []
    for rel in ("app/data/operators.json", "app/data/infra.json", "app/data/items.json"):
        path = os.path.join(REPO, rel)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fp:
                out.append(fp.read())
    return out


def digest(obj):
    raw = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def leaves(doc):
    """잎(번역문) 수 — 갈래로 한 겹 싸인 파일도 맞게 센다."""
    if not doc:
        return 0
    first = next(iter(doc.values()))
    if isinstance(first, dict) and not ({"ko", "en", "ja"} & set(first)):
        return sum(len(v) for v in doc.values())
    return len(doc)


# ── 모으기 ───────────────────────────────────────────────────────────────────
files, labels = {}, {}

# 오퍼·재료 장부 — 살아 있는 것(미실장)과 대체된 것(옛 장부)을 가른다.
# 앞쪽은 중섭 패치마다 늘고 뒤쪽은 거의 안 바뀌므로, 받는 쪽이 앞쪽만 자주 받으면 된다.
blobs = live_blobs()
op_fut, op_past = {}, {}
for cn, val in load("scripts/cn-translations.json").items():
    if cn.startswith("_") or not isinstance(val, dict):
        continue
    entry = {k: v for k, v in val.items() if k in ("ko", "en", "ja") and v}
    if not entry.get("ko") or entry["ko"] == cn:
        continue
    (op_fut if any(entry["ko"] in b for b in blobs) else op_past)[cn] = entry
files["op-fut.json"] = op_fut
labels["op-fut.json"] = "오퍼레이터·재료 — 아직 한국 서버에 없는 것"
files["op-past.json"] = op_past
labels["op-past.json"] = "오퍼레이터·재료 — 한국 서버 출시로 공식 번역이 덮은 옛 항목"

# 생존연산
ra = {}
for cn, ko in load("scripts/sandbox-cn-ko.json").items():
    if not cn.startswith("_") and isinstance(ko, str) and ko and ko != cn:
        ra[cn] = {"ko": ko}
files["ra.json"] = ra
labels["ra.json"] = "생존연산 (중국 서버 선행)"

# 통합전략 1~6
for tag, rel in ROGUE_FILES:
    files[f"{tag}.json"] = harvest_rogue(load(rel))
    labels[f"{tag}.json"] = (f"통합전략 {tag[2:]}"
                             + (" (중국 서버 선행)" if tag in FUT_THEMES else ""))

# 통합전략 공통 — 테마 구분이 없는 조우 편집자 텍스트
common = {}
for cn, val in load("scripts/rogue-enc-i18n.json").items():
    if cn.startswith("_") or not isinstance(val, dict):
        continue
    entry = {k: v for k, v in val.items() if k in ("ko", "en", "ja") and v}
    if entry.get("ko") and entry["ko"] != cn:
        common[cn] = entry
files["is-common.json"] = {"조우": common}
labels["is-common.json"] = "통합전략 공통 — 조우 안내·판정 문구 (테마 구분 없음)"

# ── 내보내기 ─────────────────────────────────────────────────────────────────
os.makedirs(OUT, exist_ok=True)
ORDER = ["op-fut.json", "op-past.json", "ra.json",
         *[f"{t}.json" for t, _ in ROGUE_FILES], "is-common.json"]
rows, group_counts, changed = [], {}, 0
for name in ORDER:
    body = files[name]
    path = os.path.join(OUT, name)
    # indent=1 — 사람이 열어 읽을 파일이다. gzip 을 타면 들여쓰기 비용은 거의 없다.
    raw = json.dumps(body, ensure_ascii=False, indent=1) + "\n"
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != raw:
        with open(path, "w", encoding="utf-8") as fp:
            fp.write(raw)
        changed += 1
    h = digest(body)
    # url 에 ?v=<hash> — 내용이 바뀌면 주소가 바뀌어 캐시가 옛 바이트를 못 돌려준다
    row = {"file": name, "url": f"{BASE}/{name}?v={h}",
           "label": labels[name], "n": leaves(body), "hash": h}
    # ⚠ 갈래별 개수는 **manifest 에 넣지 않는다** (사용자 지적 2026-09-17). 갈래는 이미
    #   파일 안에 들어 있고(is*.json 최상위 키), 파일은 통째로 받으므로 개수를 미리 알아야
    #   내릴지 말지 정할 일이 없다 — 받는 쪽이 쓸 데 없는 중복이다. 아래 콘솔 출력용으로만 쓴다.
    first = next(iter(body.values()), None)
    grouped = isinstance(first, dict) and not ({"ko", "en", "ja"} & set(first))
    group_counts[name] = {g: len(v) for g, v in body.items()} if grouped else None
    rows.append(row)

# 옛 조각 파일(c0000·op-000·is-relic-000 …)을 치운다 — 이제 안 쓴다
keep = {"manifest.json", "README.md"} | set(ORDER)
for name in os.listdir(OUT):
    if name not in keep:
        os.remove(os.path.join(OUT, name))

manifest = {"v": FORMAT_VERSION, "updated": time.strftime("%Y-%m-%d"),
            # base 는 주소를 직접 조합하고 싶은 쪽 몫 — 보통은 files[].url 을 그대로 쓰면 된다
            "base": BASE, "total": sum(r["n"] for r in rows), "files": rows}
with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fp:
    json.dump(manifest, fp, ensure_ascii=False, indent=1)
    fp.write("\n")

size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith(".json"))
for r in rows:
    g = group_counts.get(r["file"])
    extra = ("   " + " · ".join(f"{k} {n}" for k, n in g.items())) if g else ""
    print(f"  {r['file']:16} {r['n']:6,}{extra}")
print(f"파일 {len(rows)}개 (이번에 바뀐 파일 {changed}개) · "
      f"{manifest['total']:,}항목 · {size/1024/1024:.1f}MB → public/tl/")
