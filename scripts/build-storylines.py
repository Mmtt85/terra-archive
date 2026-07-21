#!/usr/bin/env python3
"""Build app/data/storylines.json — 인게임 '스토리라인'(테마 시계열) 데이터.

Usage: python3 scripts/build-storylines.py [gamedata-dir]
Needs: {kr,en,jp}_stage_table.json (클뜯 레포 — fetch-gamedata.py가 받아둠)

스토리 탭 '테마별' 뷰의 정본 출처 (사용자 확정 2026-07-21):
  stage_table.storylines       — 테마 라인 13종 (mainLine '내일을 위하여' + ssLine_1~12)
  stage_table.storylineStorySets — 항목(스토리 세트) 메타

각 라인의 locations를 sortId 순으로 늘어놓으면 테라력 시계열 순서가 되고,
locationType이 STORY_SET이면 그 테마 '소속', BEFORE/AFTER면 다른 테마 소속이지만
시계열상 그 위치에 놓인 '참조'(인게임 표기 = 괄호)다. guest 플래그로 구분해 싣는다.

항목 id는 사이트 이벤트 id로 해석한다:
  setId_ssLine_<eventId>         → stories.json 이벤트 id
  mainlineData.zoneId main_<N>   → 합성 메인 id main_<N>
  mainlineData.retroId permanent_main_<K>_* → main_<14+K>
    (에피15부터 메인 존이 permanent_main 레코드로 등록됨 — 에피17 나오면 검산할 것)
"""
import json, os, re, sys

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

load = lambda p: json.load(open(p, encoding="utf-8"))
kr = load(f"{S}/kr_stage_table.json")
names_by_loc = {}
for loc, prefix in (("en", "en"), ("ja", "jp")):
    try:
        t = load(f"{S}/{prefix}_stage_table.json").get("storylines") or {}
        names_by_loc[loc] = {k: v.get("storylineName") for k, v in t.items()}
    except FileNotFoundError:
        names_by_loc[loc] = {}

stories = {e["id"] for e in load(f"{REPO}/app/data/stories.json")["events"]}
sets = kr["storylineStorySets"]


def item_id(set_id):
    s = sets.get(set_id)
    if not s:
        return None
    md = s.get("mainlineData")
    if md:
        zone = md.get("zoneId") or ""
        if zone.startswith("main_"):
            return f"main_{zone.split('_')[1]}"
        m = re.match(r"permanent_main_(\d+)_", md.get("retroId") or "")
        if m:
            return f"main_{14 + int(m.group(1))}"
        return None
    eid = set_id.replace("setId_ssLine_", "")
    if eid in stories:
        return eid
    # 세트 id가 이벤트 id와 다르면 relevantActivityId로 폴백
    aid = s.get("relevantActivityId")
    return aid if aid in stories else None


lines, dropped = [], []
for slid, sl in sorted(kr["storylines"].items(), key=lambda kv: kv[1].get("sortId", 0)):
    items = []
    for loc in sorted(sl["locations"].values(), key=lambda x: x["sortId"]):
        sid = loc.get("relevantStorySetId")
        if not sid:  # MAINLINE_SPLIT 등 구분선 — 항목 아님
            continue
        iid = item_id(sid)
        if not iid:
            dropped.append((slid, sid))
            continue
        entry = {"id": iid}
        if loc["locationType"] in ("BEFORE", "AFTER"):
            entry["guest"] = True
            entry["_t"] = loc["locationType"]  # 간선 추출용 — JSON 출력 전에 제거
        items.append(entry)
    lines.append({
        "id": slid,
        "name": {
            "ko": sl["storylineName"],
            "en": names_by_loc["en"].get(slid) or sl["storylineName"],
            "ja": names_by_loc["ja"].get(slid) or sl["storylineName"],
        },
        "items": items,
    })

# ── 전역 상대 시계열(order) — 테라 연대기용 ─────────────────────────────────
# 각 라인은 시계열로 정렬돼 있으므로 인접쌍이 '앞→뒤' 간선이 된다. 13개 라인의
# 부분 순서 + 테라력 확정 연도(chronology.json terraYear) 코호트 간선을 합쳐
# 위상 정렬(Kahn)로 하나의 전역 순서를 만든다. 동순위(제약 없음)는 라인 나열
# 순서의 첫 등장 인덱스(refindex)로 깨서 결정적으로 유지 — 정확한 연도는 몰라도
# '어디와 어디 사이'인지는 보이게 (사용자 요청 2026-07-21).
chron = load(f"{REPO}/app/data/chronology.json")
year_of = {}
for e in chron["entries"]:
    key = e.get("ref") or e.get("id")
    if key and e.get("terraYear") is not None:
        year_of[key] = e["terraYear"]

# 라인 성격 판별: 참조 앵커(메인 에피소드)가 나열 순서대로 올라가면 시계열 라인,
# 역행하면 선집(테라 기담 — 개별 설화 모음이라 소속 항목끼리는 순서가 없다).
#   시계열 라인  → 인접쌍 전부 간선 (참조 포함)
#   선집 라인    → BEFORE(참조→다음 소속)·AFTER(직전 소속→참조) 앵커 간선만
def is_chronological(items):
    epnos = [int(i["id"].split("_")[1]) for i in items
             if i.get("guest") and i["id"].startswith("main_")]
    return all(a <= b for a, b in zip(epnos, epnos[1:]))

nodes, refindex = [], {}
edges = set()
for l in lines:
    for i in l["items"]:
        if i["id"] not in refindex:
            refindex[i["id"]] = len(refindex)
            nodes.append(i["id"])
    if l["id"] == "mainLine" or is_chronological(l["items"]):
        ids = [i["id"] for i in l["items"]]
        for a, b in zip(ids, ids[1:]):
            edges.add((a, b))
    else:
        prev_member = None
        for idx, it in enumerate(l["items"]):
            if not it.get("guest"):
                prev_member = it["id"]
            elif it.get("_t") == "BEFORE":
                nxt = next((x["id"] for x in l["items"][idx + 1:] if not x.get("guest")), None)
                if nxt:
                    edges.add((it["id"], nxt))
            elif it.get("_t") == "AFTER" and prev_member:
                edges.add((prev_member, it["id"]))
# 테라력 앵커: 연도 낮은 코호트 → 다음 코호트 전체 (동일 연도끼린 제약 없음)
cohorts = {}
for nid in nodes:
    if nid in year_of:
        cohorts.setdefault(year_of[nid], []).append(nid)
years = sorted(cohorts)
year_edges = set()
for lo, hi in zip(years, years[1:]):
    for a in cohorts[lo]:
        for b in cohorts[hi]:
            year_edges.add((a, b))

def toposort(edge_set):
    indeg = {n: 0 for n in nodes}
    succ = {n: [] for n in nodes}
    for a, b in edge_set:
        succ[a].append(b)
        indeg[b] += 1
    avail = sorted((n for n in nodes if indeg[n] == 0), key=refindex.get)
    order = []
    while avail:
        n = avail.pop(0)
        order.append(n)
        for m in succ[n]:
            indeg[m] -= 1
            if indeg[m] == 0:
                avail.append(m)
        avail.sort(key=refindex.get)
    return order if len(order) == len(nodes) else None

# 연도 앵커는 라인 순서(인게임 정본)와 모순되지 않는 것만 개별 채택.
# (실례: '그 축복받은'이 츠빌링(1100)→해리성 결합(main_15, 1098)을 강제 — 메인
#  에피소드의 당대 연도가 사이드보다 뒤처지는 구간이 있어 전량 채택은 사이클이 난다)
succ_all = {n: set() for n in nodes}
for a, b in edges:
    succ_all[a].add(b)

def reachable(start, goal):
    seen, stack = set(), [start]
    while stack:
        n = stack.pop()
        if n == goal:
            return True
        for m in succ_all[n]:
            if m not in seen:
                seen.add(m)
                stack.append(m)
    return False

adopted, skipped = set(), []
for a, b in sorted(year_edges, key=lambda e: (refindex[e[0]], refindex[e[1]])):
    if reachable(b, a):
        skipped.append((a, b))
        continue
    adopted.add((a, b))
    succ_all[a].add(b)

order = toposort(edges | adopted)
if order is None:
    sys.exit("스토리라인 간선 자체에 사이클 — 데이터 확인 필요")
if skipped:
    print(f"연도 앵커 {len(skipped)}건은 라인 순서와 모순이라 미채택", file=sys.stderr)

for l in lines:  # 내부 필드 제거
    for i in l["items"]:
        i.pop("_t", None)
out = {"lines": lines, "order": order}
json.dump(out, open(f"{REPO}/app/data/storylines.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print(f"storylines.json: {len(lines)}개 라인, 항목 {sum(len(l['items']) for l in lines)}건"
      + (f" · 해석 실패 {dropped}" if dropped else ""))
for l in lines:
    guests = sum(1 for i in l["items"] if i.get("guest"))
    print(f"  {l['name']['ko']}: {len(l['items'])}항목 (참조 {guests})")
print(f"전역 순서: {len(order)}항목 (연도 앵커 {len(years)}개 연도 {sum(len(v) for v in cohorts.values())}건)")
