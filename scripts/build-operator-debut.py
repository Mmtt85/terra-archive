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

## 과거 채우기 (--repo-history)

사이트 이력은 2026-07-12부터라 그 전 이벤트는 '모름'이다. 클뜯 레포
(ArknightsAssets/ArknightsGamedata)의 `kr/gamedata/excel/character_table.json` 커밋 이력은
**2023-12-24**까지 닿으므로, 그걸 되짚어 2024년 이후 데뷔일을 채운다.
  · 그 파일을 건드린 커밋은 54개뿐이다 (= 한섭 데이터가 바뀐 날). 커밋마다 원본을 받아
    그 시점의 오퍼 id 집합을 만들고, 새로 나타난 id 에 그 커밋 날짜를 적는다.
  · 파일이 18MB라 다 받으면 1GB에 가깝다. **커밋별 id 집합만 캐시**해 두고(.gamedata/
    debut-cache/) 다시 돌릴 땐 건너뛴다. 원본은 스트리밍으로 훑어 메모리에 안 담는다.
  · 첫 커밋(2023-12-24)에 이미 있던 오퍼는 여전히 '모름'이다 — 그날 데뷔한 게 아니다.
  · 레포 날짜가 실제 한섭 패치일이라, 사이트 이력과 겹치면 **레포 쪽을 쓴다**.
  · raw.githubusercontent.com 으로 받아 API 한도를 쓰지 않는다. 커밋 목록만 API 한 번.

## 미래시(중섭 선행) 이벤트 (--cn-events)

미래시 이벤트의 신규 오퍼는 **중섭 데뷔**라 한섭 이력엔 없다. 그런데 중섭 쪽
`cn/gamedata/excel/character_table.json` 은 커밋이 6,400개라 전수는 수십 GB다.
그래서 **그 이벤트 개방일 앞뒤 커밋 두 개씩만** 집어 차분을 낸다 —
개방일 직전 판과 직후 판의 오퍼 id 집합을 빼면 그 패치로 들어온 오퍼가 나온다.
미래시 이벤트가 셋이면 여섯 판(약 110MB)이면 끝난다.

사용: python3 scripts/build-operator-debut.py [--repo-history] [--cn-events]
"""
import json, os, re, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = "app/data/operators.json"
DEST = os.path.join(REPO, "app", "data", "operator-debut.json")


def git(*args):
    return subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, check=True).stdout


# ── 클뜯 레포 커밋 이력 되짚기 (--repo-history) ──────────────────────────────
GH_REPO = "ArknightsAssets/ArknightsGamedata"
GH_PATH = "kr/gamedata/excel/character_table.json"
RAW = "https://raw.githubusercontent.com/%s/%s/%s"
CACHE_DIR = os.path.join(REPO, ".gamedata", "debut-cache")
# 오퍼 id — 소환수(token_)·함정(trap_)은 char_ 로 시작하지 않는다. 그래도 사이트 목록과
# 교집합을 내서 '진짜 오퍼'만 남긴다 (character_table 엔 미구현·테스트 항목도 섞인다).
CHAR_KEY = re.compile(rb'"(char_\d+_[a-z0-9]+)"\s*:')


def repo_commits():
    """그 파일을 건드린 커밋 (오래된 것부터) [(sha, YYYY-MM-DD), …]"""
    out, page = [], 1
    while True:
        raw = subprocess.run(
            ["gh", "api", "-X", "GET", f"repos/{GH_REPO}/commits",
             "-f", f"path={GH_PATH}", "-f", "per_page=100", "-f", f"page={page}"],
            capture_output=True, text=True, check=True).stdout
        batch = json.loads(raw)
        if not batch:
            break
        out += [(c["sha"], c["commit"]["committer"]["date"][:10]) for c in batch]
        if len(batch) < 100:
            break
        page += 1
    out.reverse()
    return out


def ids_at(sha, keep, path=GH_PATH):
    """그 커밋 시점의 오퍼 id 집합. 한 번 뽑으면 캐시한다 (원본은 18MB)."""
    import urllib.request
    os.makedirs(CACHE_DIR, exist_ok=True)
    dest = os.path.join(CACHE_DIR, f"{sha}.json")
    if os.path.exists(dest):
        return set(json.load(open(dest, encoding="utf-8")))
    found = set()
    tail = b""
    with urllib.request.urlopen(RAW % (GH_REPO, sha, path), timeout=300) as fp:
        while True:
            chunk = fp.read(1 << 20)
            if not chunk:
                break
            buf = tail + chunk
            for m in CHAR_KEY.finditer(buf):
                found.add(m.group(1).decode())
            tail = buf[-64:]          # 경계에 걸친 키를 놓치지 않게 꼬리를 물린다
    found &= keep
    json.dump(sorted(found), open(dest, "w", encoding="utf-8"))
    return found


LOOKBACK = 14      # 개방일 기준 며칠 전까지 거슬러 볼까 (중섭 이벤트 간격이 2~3주다)


def _iso_shift(date, days):
    import datetime as _d
    return (_d.date.fromisoformat(date) + _d.timedelta(days=days)).isoformat()


def _commits(branch_path, since=None, until=None, per_page=100):
    args = ["gh", "api", "-X", "GET", f"repos/{GH_REPO}/commits",
            "-f", f"path={branch_path}", "-f", f"per_page={per_page}"]
    if since:
        args += ["-f", f"since={since}"]
    if until:
        args += ["-f", f"until={until}"]
    out = json.loads(subprocess.run(args, capture_output=True, text=True, check=True).stdout)
    return [(c["sha"], c["commit"]["committer"]["date"][:10]) for c in out]


def commit_near(branch_path, date, before, span=21):
    """그 날짜 **직전**(before=True) 또는 **그날 이후 첫**(before=False) 커밋 (sha, date).

    ⚠ GitHub 은 **최신순**으로 준다. `since=` 만 걸고 마지막 항목을 집으면 '그날 이후 첫'이
    아니라 '한 페이지치 뒤'가 잡힌다 (중섭은 커밋이 6,400개라 실제로 어긋났다 — 차분이 0).
    그래서 `since`+`until` 로 **창을 막고** 그 안에서 가장 오래된 것을 집는다.
    """
    import datetime as _d
    d = _d.date.fromisoformat(date)
    if before:
        got = _commits(branch_path, until=f"{d.isoformat()}T00:00:00Z", per_page=1)
        return got[0] if got else None
    got = _commits(branch_path, since=f"{d.isoformat()}T00:00:00Z",
                   until=f"{(d + _d.timedelta(days=span)).isoformat()}T23:59:59Z")
    return got[-1] if got else None


def cn_event_debuts(names):
    """미래시 이벤트별로 중섭 개방 패치에 들어온 오퍼 — {이벤트id: [오퍼id, …]}

    ⚠ 날짜가 아니라 **이벤트 id 로 바로 묶어 둔다.** 중섭 표는 개방보다 하루 이틀 먼저
    들어와서 날짜로 되짚으면 어느 이벤트 것인지 다시 헷갈린다."""
    import time as _t
    out = {}
    try:
        cn = json.load(open(os.path.join(REPO, ".gamedata", "cn_activity_table.json"), encoding="utf-8"))
        stories = json.load(open(os.path.join(REPO, "app", "data", "stories.json"), encoding="utf-8"))["events"]
    except OSError:
        print("⚠ 중섭 활동표나 스토리 목록이 없다 — 미래시 데뷔는 건너뛴다")
        return out
    basic = cn.get("basicInfo") or {}
    path = "cn/gamedata/excel/character_table.json"
    for ev in stories:
        if not ev.get("unreleased"):
            continue
        info = basic.get(ev["id"]) or {}
        st = info.get("startTime")
        if not st:
            print(f"  ⚠ {ev['id']}: 중섭 개방일을 모른다")
            continue
        day = _t.strftime("%Y-%m-%d", _t.localtime(st))
        # ⚠ 중섭 표에는 오퍼가 **개방 하루 전쯤 먼저 들어온다** (act53side 실측: 08-01 개방인데
        #   07-31 스냅샷에 이미 있다). 그래서 개방일 앞뒤 한 판씩만 보면 차분이 0이 된다.
        #   창을 넉넉히 열어 **처음 나타난 판**을 직접 찾는다.
        win = _commits(path, since=f"{_iso_shift(day, -LOOKBACK)}T00:00:00Z",
                       until=f"{_iso_shift(day, 3)}T23:59:59Z")
        win.reverse()                       # 오래된 것부터
        base = commit_near(path, _iso_shift(day, -LOOKBACK), before=True)
        if not base or not win:
            print(f"  ⚠ {ev['id']}: 창 안에 커밋이 없다")
            continue
        try:
            seen_ids = ids_at(base[0], names, path)
            fresh, when = set(), day
            for sha, d in win:
                now_ids = ids_at(sha, names, path)
                new_ids = now_ids - seen_ids
                if new_ids and not fresh:
                    fresh, when = new_ids, d   # 처음 나타난 판이 그 이벤트의 데뷔
                seen_ids |= now_ids
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠ {ev['id']} 받기 실패: {str(e)[:60]}")
            continue
        if fresh:
            out[ev["id"]] = sorted(fresh)
        print(f"  {ev['id']} 중섭 개방 {day} · 기준 {base[1]} · 창 {len(win)}판 → {when} +{len(fresh)}: "
              + ", ".join(sorted(names_by.get(c, c) for c in fresh)[:6]))
    return out


def backfill(debut, baseline, names):
    """레포 이력으로 과거 데뷔일을 채운다. (갱신된 debut, baseline) 반환."""
    commits = repo_commits()
    if not commits:
        print("⚠ 레포 커밋 목록을 못 받았다 — 과거 채우기는 건너뛴다")
        return debut, baseline
    print(f"레포 이력 {len(commits)}커밋 ({commits[0][1]} ~ {commits[-1][1]})")
    seen, added = None, 0
    for i, (sha, date) in enumerate(commits, 1):
        try:
            ids = ids_at(sha, names)
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠ {sha[:8]} 실패: {str(e)[:60]}")
            continue
        if seen is None:
            seen = set(ids)
            baseline |= ids          # 첫 판에 있던 것은 그날 데뷔한 게 아니다
            print(f"  기준선 {date} — {len(ids)}명")
            continue
        fresh = ids - seen
        for cid in fresh:
            debut[cid] = date        # 레포 날짜가 실제 한섭 패치일이라 사이트 이력보다 낫다
            baseline.discard(cid)
            added += 1
        if fresh:
            print(f"  {date} +{len(fresh)}: " + ", ".join(sorted(names_of(fresh, names_map=names_by))[:6]))
        seen |= ids
        if i % 10 == 0:
            print(f"    … {i}/{len(commits)}")
    print(f"레포 이력에서 채운 데뷔 {added}명")
    return debut, baseline


names_by = {}


def names_of(ids, names_map):
    return [names_map.get(c, c) for c in ids]


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


REPO_HISTORY = "--repo-history" in sys.argv
CN_EVENTS = "--cn-events" in sys.argv
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

cn_event_ops = dict(prev.get("cnEventOps") or {})
if REPO_HISTORY or CN_EVENTS:
    _ops = json.load(open(os.path.join(REPO, TARGET), encoding="utf-8"))
    names_by.update({o["id"]: o["name"] for o in _ops})
    _keep = {o["id"] for o in _ops}
    if REPO_HISTORY:
        debut, baseline = backfill(debut, baseline, _keep)
    if CN_EVENTS:
        print("미래시(중섭 선행) 이벤트 — 개방일 앞뒤 커밋만 본다")
        cn_event_ops.update(cn_event_debuts(_keep))
        print(f"중섭 데뷔 — 이벤트 {len(cn_event_ops)}개 · 오퍼 {sum(len(v) for v in cn_event_ops.values())}명")

json.dump({"note": "한섭 데뷔일 — app/data/operators.json 커밋 이력에서 되짚었다. "
                   "baselineIds 는 첫 커밋에 이미 있던(=데뷔일을 모르는) 오퍼다. "
                   "얕은 체크아웃에서도 덧붙일 수 있게 둘 다 커밋한다.",
           "baseline": baseline_date, "baselineIds": sorted(baseline),
           "debut": dict(sorted(debut.items(), key=lambda kv: kv[1])),
           # 미래시(중섭 선행) 이벤트의 신규 오퍼 — 한섭 데뷔 장부와는 별개다
           "cnEventOps": dict(sorted(cn_event_ops.items()))},
          open(DEST, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print(f"{mode} · 기준선 {baseline_date}({len(baseline)}명) · 데뷔 기록 {len(debut)}명")
names = {o["id"]: o["name"] for o in json.load(open(os.path.join(REPO, TARGET), encoding="utf-8"))}
for cid, d in list(sorted(debut.items(), key=lambda kv: kv[1]))[-8:]:
    print(f"    {d}  {names.get(cid, cid)}")
