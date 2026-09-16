#!/usr/bin/env python3
"""오퍼레이터 한섭 데뷔 시점 장부 — app/data/operator-debut.json

## 왜 (사용자 지시 2026-09-16)

"보상 오퍼 뿐만 아니라 이 이벤트가 오면서 새로 등장한 신규오퍼 둘도 나와야해."

이벤트 보상 오퍼(무료 배포)는 `activity_table.missionData` 에 그대로 있다. 그런데
**배너로 나온 신규 오퍼**는 게임 데이터 어디에도 이벤트와 묶여 있지 않다:

  · character_table 에 출시일 필드가 없다 (`itemObtainApproach` 는 전부 "인재 채용")
  · 기본 스킨의 `getTime` 은 전부 0
  · handbook_info_table 에 활동 참조가 없다
  · gacha_table 의 배너는 기간은 있는데 **명단이 없다** — `dynMeta` 에 char id 가 들어 있는
    것은 재록(CLASSIC/ATTAIN) 배너 89개뿐이고, 정규 배너 286개에는 없다 (2026-09-16 실측)

그럼 오늘 신규 오퍼 셋은 어떻게 알았나 — **표를 이전 판과 비교(diff)해서**다
(scripts/check-new-operators.mjs, regen-operators.py 의 실장 래칫과 같은 원리).
그 비교의 기록이 이미 레포에 남아 있다: `app/data/operators.json` 의 커밋 이력.
그래서 여기서 이력을 되짚어 **"그 오퍼가 처음 한섭 목록에 올라온 날"** 을 뽑는다.

## 한계 (분명히 해 둘 것)

- **첫 커밋에 이미 있던 오퍼는 '모름'** 이다. 사이트가 생긴 날 400명이 한꺼번에 들어온
  것이지 그날 데뷔한 게 아니다. 그날짜를 데뷔로 적으면 옛 이벤트가 전부 400명을 달게 된다.
- 그래서 장부는 **사이트 개설 이후**만 정확하다. 앞으로는 점검마다 저절로 늘어난다.
- 미실장(중섭 선행) 오퍼는 한섭 출시 전에도 목록에 있으므로, **seq 가 한섭 구간
  (< 100000)으로 바뀐 첫 커밋**을 데뷔로 본다 (regen-operators.py 의 seq 규칙).

사용: python3 scripts/build-operator-debut.py
"""
import json, os, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = "app/data/operators.json"
DEST = os.path.join(REPO, "app", "data", "operator-debut.json")


def git(*args):
    return subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, check=True).stdout


def kr_ids(blob):
    """그 시점 목록에서 **한섭에 나와 있던** 오퍼 id 집합."""
    try:
        ops = json.loads(blob)
    except json.JSONDecodeError:
        return None
    out = set()
    for o in ops:
        if not isinstance(o, dict) or "id" not in o:
            continue
        if o.get("unreleased"):
            continue
        seq = o.get("seq")
        if isinstance(seq, int) and seq >= 100000:   # 미실장 구간
            continue
        out.add(o["id"])
    return out


prev = json.load(open(DEST, encoding="utf-8")) if os.path.exists(DEST) else {}
debut = dict(prev.get("debut") or {})
baseline = set(prev.get("baselineIds") or [])
baseline_date = prev.get("baseline")

commits = [l.split("|", 1) for l in git("log", "--reverse", "--format=%H|%ad", "--date=short",
                                        "--", TARGET).strip().split("\n") if "|" in l]
today = subprocess.run(["date", "+%Y-%m-%d"], capture_output=True, text=True).stdout.strip()

# ⚠ 무인 CI 는 얕은 체크아웃(fetch-depth 2)이라 이력을 되짚을 수 없다. 그래서 장부를
#   **커밋해 두고**, 이력이 얕으면 이미 있는 장부에 새 오퍼만 덧붙인다. 이력이 깊으면
#   (로컬) 처음부터 다시 훑어 빠진 것을 메운다.
if len(commits) > 2:
    seen = None
    for sha, date in commits:
        try:
            ids = kr_ids(git("show", f"{sha}:{TARGET}"))
        except subprocess.CalledProcessError:
            continue
        if ids is None:
            continue
        if seen is None:              # 첫 커밋 = 기준선. 데뷔로 세지 않는다.
            seen, baseline, baseline_date = set(ids), set(ids), date
            continue
        for cid in ids - seen:
            debut.setdefault(cid, date)
        seen |= ids
    # ⚠ **기준선과 같은 날짜는 데뷔가 아니다.** 사이트를 만들던 날 커밋이 여러 번 갈렸고,
    #   두 번째 커밋에서 29명이 더 들어왔다 — 그날 데뷔한 게 아니라 데이터를 채우던 중이다.
    #   그대로 두면 그때 열려 있던 이벤트가 신규 오퍼 29명을 달게 된다 (2026-09-16 실측).
    late = {cid for cid, d in debut.items() if d == baseline_date}
    for cid in late:
        debut.pop(cid, None)
    baseline |= late
    mode = f"이력 {len(commits)}커밋 전수 (기준선 당일 {len(late)}명은 데뷔 아님)"
else:
    now = kr_ids(open(os.path.join(REPO, TARGET), encoding="utf-8").read()) or set()
    fresh = now - baseline - set(debut)
    for cid in fresh:
        debut[cid] = today
    mode = f"얕은 이력 — 새 오퍼 {len(fresh)}명 덧붙임"

json.dump({"note": "한섭 데뷔일 — app/data/operators.json 커밋 이력에서 되짚었다. "
                   "baselineIds 는 첫 커밋에 이미 있던(=데뷔일을 모르는) 오퍼다. "
                   "얕은 체크아웃에서도 덧붙일 수 있게 둘 다 커밋한다.",
           "baseline": baseline_date, "baselineIds": sorted(baseline),
           "debut": dict(sorted(debut.items(), key=lambda kv: kv[1]))},
          open(DEST, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print(f"{mode} · 기준선 {baseline_date}({len(baseline)}명) · 데뷔 기록 {len(debut)}명")
names = {o["id"]: o["name"] for o in json.load(open(os.path.join(REPO, TARGET), encoding="utf-8"))}
for cid, d in list(sorted(debut.items(), key=lambda kv: kv[1]))[-8:]:
    print(f"    {d}  {names.get(cid, cid)}")
