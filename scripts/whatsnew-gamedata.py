#!/usr/bin/env python3
"""한국서버 패치로 **클뜯 데이터에 실제로 뭐가 들어왔는지** 한 번에 뽑는다.

큰 점검(오전 10시~오후 4시)이 끝나면 "몇 달치가 한 번에 들어왔다"는 소문이 돌지만,
정말 들어왔는지는 표를 직접 비교해야만 안다. 매번 손으로 짜던 diff를 여기 모았다.
(2026-08-13에 이 방식으로 "이벤트 미래시는 0건, 실제로는 통합전략 5 3차 확장팩과
스킨 4종"임을 확정했다.)

사용:
  python3 scripts/whatsnew-gamedata.py                # 직전 KR 커밋 대비
  python3 scripts/whatsnew-gamedata.py --since <sha>  # 특정 커밋 대비 (며칠치 몰아보기)
  python3 scripts/whatsnew-gamedata.py --no-rogue     # 21MB짜리 록라 표 생략(빠름)
  python3 scripts/whatsnew-gamedata.py --future-only  # 미래 일정 스캔만 (다운로드 최소)

출력 3부:
  ① 신규·변경 — 이벤트 / 오퍼 / 스킨 / 구역 / 통합전략
  ② 미래 일정 — 지금보다 뒤인 타임스탬프 전수 (= 진짜 '미래시')
  ③ 사이트 반영 필요 — 어떤 파이프라인을 돌려야 하는지

⚠ 비교 기준은 **클뜯 레포의 커밋**이지 사이트 데이터가 아니다. "사이트에 반영됐나"는
  ③의 안내대로 파이프라인을 돌려 git diff로 확인한다.
"""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetchutil import urlread

REPO = "ArknightsAssets/ArknightsGamedata"
RAW = f"https://raw.githubusercontent.com/{REPO}"
API = f"https://api.github.com/repos/{REPO}"

# 표 → (JSON 안에서 비교할 dict 경로, 항목 이름을 뽑는 함수)
TABLES = {
    "activity_table": ("basicInfo", lambda v: v.get("name")),
    "character_table": ("chars", lambda v: f"{v.get('name')} {v.get('rarity')}"),
    "skin_table": ("charSkins", lambda v: ((v.get("displaySkin") or {}).get("skinName")) or v.get("charId")),
    "zone_table": ("zones", lambda v: f"{v.get('zoneNameFirst') or ''} {v.get('zoneNameSecond') or ''}".strip()),
    "gacha_table": (None, None),          # 구조가 배열이라 따로 다룬다
    "roguelike_topic_table": (None, None),  # details.<topic>.<컬렉션> 2단이라 따로
}
FUTURE_TABLES = ("activity_table", "zone_table", "gacha_table")


def now_ts():
    return time.time()


def fmt(t):
    if not t or t <= 0:
        return "(미정)"
    return dt.datetime.fromtimestamp(t).strftime("%Y-%m-%d %H:%M")


def dig(doc, path):
    if not path:
        return doc
    for part in path.split("."):
        doc = (doc or {}).get(part) or {}
    return doc


def api_json(url):
    return json.loads(urlread(url, ua="terra-archive-whatsnew"))


def recent_kr_commits(limit=15):
    """kr/gamedata/excel 을 건드린 최근 커밋 (최신순)."""
    q = urllib.parse.urlencode({"path": "kr/gamedata/excel", "per_page": limit})
    return api_json(f"{API}/commits?{q}")


def table_at(sha, table):
    return json.loads(urlread(f"{RAW}/{sha}/kr/gamedata/excel/{table}.json", timeout=180))


def canon(x):
    """비교용 정규화 — 빈 컨테이너와 null 을 하나로 본다.

    출처마다 빈 값을 다르게 쓴다: 클뜯 레포는 빈 맵을 `{}`, 우리 CDN 디코더는 스키마
    타입대로 `[]`(빈 벡터)로 낸다. 이걸 다르다고 세면 `picGroup` 하나 때문에 활동 276개가
    "변경"으로 잡혀 **진짜 변경이 파묻힌다** (2026-09-02 실측).
    """
    if x is None or x == [] or x == {}:
        return None
    if isinstance(x, dict):
        return {k: canon(v) for k, v in x.items() if canon(v) is not None}
    if isinstance(x, list):
        return [canon(v) for v in x]
    return x


def diff_map(before, after, label_of):
    """dict-of-dicts 두 개 → (신규 키, 사라진 키, 내용이 바뀐 키)"""
    j = lambda v: json.dumps(canon(v), sort_keys=True, ensure_ascii=False)
    add = [k for k in after if k not in before]
    rem = [k for k in before if k not in after]
    mod = [k for k in after if k in before and j(before[k]) != j(after[k])]
    return add, rem, mod


def scan_future(doc, prefix=""):
    """미래 유닉스 타임스탬프를 값으로 가진 필드 전부 — 진짜 '미래시'는 여기 잡힌다."""
    out, cutoff = [], now_ts()
    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(v, (int, float)) and 1.7e9 < v < 2.2e9 and v > cutoff:
                    out.append((v, f"{path}.{k}"))
                else:
                    walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")
    walk(doc, prefix)
    return sorted(out)


def local_pair(out_dir, prefix, table):
    """`--local`: `<out>/.prev/<prefix>_<table>.json` (직전) vs `<out>/<prefix>_<table>.json` (지금).

    `fetch-gamedata-cdn.py` 가 덮어쓰기 전에 남겨 둔 스냅샷을 쓴다. 클뜯 레포를 안 쓰게
    되면서 '직전 커밋 대비'라는 기준이 사라진 자리를 이게 대신한다.
    """
    now = os.path.join(out_dir, "%s_%s.json" % (prefix, table))
    old = os.path.join(out_dir, ".prev", "%s_%s.json" % (prefix, table))
    if not os.path.exists(now):
        return None, None
    after = json.load(open(now, encoding="utf-8"))
    before = json.load(open(old, encoding="utf-8")) if os.path.exists(old) else {}
    return before, after


def main_local(args):
    out, pre = args.out, {"kr": "kr", "jp": "jp", "en": "en", "cn": "cn"}[args.server]
    print("■ 로컬 비교  %s/.prev/%s_*  →  %s/%s_*\n" % (out, pre, out, pre))
    need, seen = [], 0
    for table in TABLES:
        if args.no_rogue and table == "roguelike_topic_table":
            continue
        before, after = local_pair(out, pre, table)
        if after is None:
            continue
        seen += 1
        if not before:
            print("■ [%s] 직전 스냅샷 없음 — 이번 것이 처음이라 비교를 건너뛴다\n" % table)
            continue
        _report_diff(table, before, after, need)
    if not seen:
        sys.exit("비교할 로컬 표가 없다 — python3 scripts/fetch-gamedata-cdn.py 를 먼저 돌릴 것")
    print("■ 사이트 반영 — 돌려야 할 파이프라인")
    for line in (dict.fromkeys(need) or ["없음 (데이터 변화가 사이트 산출물에 닿지 않는다)"]):
        print("    · %s" % line)
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", help="비교 기준 커밋 sha (기본: 최신 KR 커밋의 부모)")
    ap.add_argument("--no-rogue", action="store_true", help="통합전략 표(21MB×2) 생략")
    ap.add_argument("--future-only", action="store_true", help="미래 일정 스캔만")
    ap.add_argument("--local", action="store_true",
                    help="클뜯 레포 대신 `<out>/.prev/` 스냅샷과 비교 (CDN으로 받은 뒤 쓴다)")
    ap.add_argument("--out", default=".gamedata", help="--local 일 때 볼 폴더")
    ap.add_argument("--server", default="kr", choices=["kr", "jp", "en", "cn"])
    args = ap.parse_args()

    if args.local:
        return main_local(args)

    commits = recent_kr_commits()
    if not commits:
        sys.exit("클뜯 레포 커밋을 못 읽었다")
    head = commits[0]
    print(f"■ 최신 KR 커밋  {head['sha'][:8]}  {head['commit']['committer']['date']}  "
          f"{head['commit']['message'].splitlines()[0]}")
    base = args.since or (head["parents"][0]["sha"] if head.get("parents") else None)
    if not base:
        sys.exit("비교 기준 커밋을 정할 수 없다 — --since 로 지정할 것")
    print(f"■ 비교 기준    {base[:8]}\n")

    targets = [t for t in TABLES if not (args.no_rogue and t == "roguelike_topic_table")]
    if args.future_only:
        targets = list(FUTURE_TABLES)

    need = []  # ③ 사이트 반영 안내
    for table in targets:
        try:
            after = table_at(head["sha"], table)
        except Exception as err:                       # 없는 표는 조용히 건너뛴다
            print(f"[{table}] 읽기 실패: {err}")
            continue

        if not args.future_only:
            try:
                before = table_at(base, table)
            except Exception:
                before = {}
            _report_diff(table, before, after, need)

        if table in FUTURE_TABLES:
            fut = scan_future(after, table)
            head_line = f"■ [{table}] 미래 일정 {len(fut)}건"
            print(head_line)
            for t, path in fut[:20]:
                print(f"    {fmt(t)}  {path[:110]}")
            if not fut:
                print("    (없음 — 이 표에는 예정 데이터가 들어와 있지 않다)")
            print()

    print("■ 사이트 반영 — 돌려야 할 파이프라인")
    if need:
        for line in dict.fromkeys(need):
            print(f"    · {line}")
    else:
        print("    · 없음 (데이터 변화가 사이트 산출물에 닿지 않는다)")
    print("    · 공통 마무리: bash scripts/ci-refresh.sh → npm run build → 커밋·푸시 "
          "(deploy.sh는 사용자 몫)")


# 활동 속이 바뀌었을 때 돌려야 하는 파이프라인 — 활동 id 접두사로 고른다
INNER_PIPE = [
    ("autochess", "위수 협의: python3 scripts/build-autochess.py "
                  "(+ build-autochess-routes.py 전투 맵이 바뀌었으면) → node scripts/r2-sync.mjs"),
    ("sandbox",   "생존연산: python3 scripts/build-sandbox.py"),
]


def _report_activity_inner(before, after, need):
    """활동 **하나하나의 속**을 비교한다 — 새 이벤트가 아니라 기존 이벤트가 불어난 경우."""
    ba, aa = before.get("activity") or {}, after.get("activity") or {}
    rows = []
    for typ in aa:
        for aid, node in (aa[typ] or {}).items():
            old = (ba.get(typ) or {}).get(aid)
            if old is None or not isinstance(node, dict) or not isinstance(old, dict):
                continue
            grew = []
            for k, v in node.items():
                o = old.get(k)
                if isinstance(v, dict) and isinstance(o, dict) and len(v) != len(o):
                    grew.append("%s %d→%d" % (k, len(o), len(v)))
                elif isinstance(v, list) and isinstance(o, list) and len(v) != len(o):
                    grew.append("%s %d→%d" % (k, len(o), len(v)))
            if grew:
                rows.append((aid, grew))
    if not rows:
        return
    print("■ [activity_table] 기존 활동 **속**이 바뀐 것 %d개" % len(rows))
    for aid, grew in rows[:12]:
        print("    ~ %-20s %s" % (aid, ", ".join(grew[:5]) + (" …" if len(grew) > 5 else "")))
    if len(rows) > 12:
        print("    … 외 %d개" % (len(rows) - 12))
    print()
    for aid, _ in rows:
        for key, line in INNER_PIPE:
            if key in aid:
                need.append(line)


def _report_diff(table, before, after, need):
    if table == "gacha_table":
        pa = {p["gachaPoolId"]: p for p in (before.get("gachaPoolClient") or [])}
        pb = {p["gachaPoolId"]: p for p in (after.get("gachaPoolClient") or [])}
        add, _rem, _mod = diff_map(pa, pb, None)
        print(f"■ [가챠] 신규 픽업 {len(add)}건")
        for k in sorted(add, key=lambda x: pb[x].get("openTime") or 0):
            p = pb[k]
            print(f"    {fmt(p.get('openTime'))} ~ {fmt(p.get('endTime'))}  {k}  {p.get('gachaPoolName')}")
        print()
        return

    if table == "roguelike_topic_table":
        da, db = before.get("details") or {}, after.get("details") or {}
        printed = False
        for topic in db:
            for coll in db[topic]:
                x, y = da.get(topic, {}).get(coll), db[topic][coll]
                if not isinstance(y, dict) or not isinstance(x, dict):
                    continue
                add, _r, _m = diff_map(x, y, None)
                if add:
                    if not printed:
                        print("■ [통합전략] 신규 항목")
                        printed = True
                    names = [(y[k] or {}).get("name") or (y[k] or {}).get("challengeName") or k for k in add[:6]]
                    print(f"    {topic}.{coll}: {len(add)}건 — {', '.join(str(n) for n in names)}")
                    need.append("통합전략: rm -f .gamedata/rogue/*roguelike_topic_table.json 후 "
                                f"python3 scripts/build-rogue.py {topic.replace('rogue_', 'rogue')} "
                                "(+ -en/-ja, cn) — ci-refresh에 없는 수동 레인")
        if not printed:
            print("■ [통합전략] 신규 항목 없음")
        print()
        return

    path, label_of = TABLES[table]
    a, b = dig(before, path), dig(after, path)
    add, rem, mod = diff_map(a, b, label_of)
    print(f"■ [{table}] 신규 {len(add)} · 삭제 {len(rem)} · 변경 {len(mod)}")
    for k in add[:30]:
        extra = ""
        if table == "activity_table":
            extra = f"  {fmt(b[k].get('startTime'))} ~ {fmt(b[k].get('endTime'))}  {b[k].get('type')}"
        print(f"    + {k:26} {label_of(b[k])}{extra}")
    if len(add) > 30:
        print(f"    … 외 {len(add)-30}건")
    # 변경이 표 전체의 1/4을 넘으면 개별 나열은 의미가 없다 — 전 항목에 필드가 하나 붙은
    # 종류의 스키마 변경이다 (2026-08-13 skin_table 2050/2063이 그랬다). 바뀐 필드 이름만 보인다.
    if mod and len(mod) > max(20, len(b) // 4):
        keys = set()
        for k in mod[:50]:
            for f in set(b[k]) | set(a[k]):
                if json.dumps(a[k].get(f), sort_keys=True) != json.dumps(b[k].get(f), sort_keys=True):
                    keys.add(f)
        print(f"    ~ 대량 변경 {len(mod)}건 — 스키마 변경으로 보인다. 바뀐 필드: {', '.join(sorted(keys)) or '?'}")
    else:
        for k in mod[:10]:
            print(f"    ~ {k:26} {label_of(b[k])}")
        if len(mod) > 10:
            print(f"    … 외 {len(mod)-10}건")
    print()

    # ⚠ basicInfo 만 보면 **기존 활동 안이 바뀐 것**은 못 잡는다. 2026-09-02 위수 협의 2단계가
    #   딱 그랬다 — 새 이벤트가 아니라 act2autochess 안에 전략 4종이 늘어난 것이라 basicInfo는
    #   한 글자도 안 바뀌었다. 그래서 활동별 속을 따로 한 번 더 훑는다.
    if table == "activity_table":
        _report_activity_inner(before, after, need)

    if add or mod:
        need.append({
            "activity_table": "이벤트: 방송 워커 KV 갱신 확인 · 새 이벤트면 build-story/build-story-scripts → story-summary → chronicle-register",
            "character_table": "오퍼: bash scripts/ci-refresh.sh fast (EN/JA 이름 폴백 확인) + planner-synergy-review",
            "skin_table": "스킨: python3 scripts/build-skins.py (전체 — CI는 --meta-only라 아트가 안 온다) → node scripts/r2-sync.mjs",
            "zone_table": "구역/스테이지: python3 scripts/build-enemies.py → build-stages.py (둘 다 전체 실행) → r2-sync",
        }[table])


if __name__ == "__main__":
    main()
