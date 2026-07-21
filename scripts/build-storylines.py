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

out = {"lines": lines}
json.dump(out, open(f"{REPO}/app/data/storylines.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print(f"storylines.json: {len(lines)}개 라인, 항목 {sum(len(l['items']) for l in lines)}건"
      + (f" · 해석 실패 {dropped}" if dropped else ""))
for l in lines:
    guests = sum(1 for i in l["items"] if i.get("guest"))
    print(f"  {l['name']['ko']}: {len(l['items'])}항목 (참조 {guests})")
