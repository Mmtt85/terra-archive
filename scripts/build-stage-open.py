#!/usr/bin/env python3
"""지금 한섭에서 '들어갈 수 있는' 작전 기준표 → app/data/stage-open.json (2026-10-04)

내 정보(/me)의 '진행 상황'이 미클리어·3성 미달성 목록에서 **지금 못 들어가는 작전을 뺀다** (사용자 지시
"지금 진입할 수 없는 맵이나 이벤트들은 미완료 리스트에서 빼 줘"). 메인 스토리·막간은 늘 열려 있으니 표에
안 싣고, 이벤트와 섬멸 작전만 가른다:

  retro   상설 사이드 스토리(재개방 뒤 상시 개방, retro_table.stageList)에 있는 작전 id
  events  기간 이벤트 — [시작, 끝, [작전 id…]]. 끝이 빌드 시각보다 뒤인 것만 (지난 이벤트는 어차피 닫혀 있다).
          화면이 지금 시각으로 열림 여부를 가린다. app/data/events.json(build-events.py 산출물)을 읽는다.
  camp    섬멸 작전 — permanent(상설) + rotate [[작전 id, 시작 시각(초)]…]. 순환 섬멸은 가장 최근에
          시작한 회차 하나만 열려 있다 (campaign_table.campaignRotateStageOpenTimes).

사용: python3 scripts/build-stage-open.py [gamedata-dir]   (ci-refresh.sh 가 build-events 뒤에 돌린다)
"""
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
G = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", os.path.join(REPO, ".gamedata"))
OUT = os.path.join(REPO, "app", "data", "stage-open.json")
RAW = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/kr/gamedata/excel/%s.json"


def table(name):
    """kr_<name>.json — 받아 둔 게 없으면 클뜯 레포판으로 메운다 (campaign_table 은 2026-10-04 에야 받는 목록에 들어갔다)."""
    path = os.path.join(G, f"kr_{name}.json")
    if not os.path.exists(path):
        with urllib.request.urlopen(RAW % name, timeout=60) as res:
            data = res.read()
        with open(path, "wb") as f:
            f.write(data)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    stages = json.load(open(os.path.join(REPO, "app", "data", "stages.json"), encoding="utf-8"))
    known = {s["id"] for s in stages["stages"]}

    retro = table("retro_table")
    retro_ids = sorted(sid for sid in retro.get("stageList", {}) if sid in known)

    now = time.time()
    events = json.load(open(os.path.join(REPO, "app", "data", "events.json"), encoding="utf-8"))["events"]
    windows = []
    for ev in events:
        if ev.get("fut") or not ev.get("start") or not ev.get("end"):
            continue
        # events.json 날짜는 KST 날짜(YYYY-MM-DD, 끝 날 포함). 하루 여유를 두고 지난 것만 거른다
        end_ts = time.mktime(time.strptime(ev["end"][:10], "%Y-%m-%d"))
        if end_ts + 2 * 86400 < now:
            continue
        ids = [s[0] for s in ev.get("stages", []) if s and s[0] in known and s[0] not in retro_ids]
        if ids:
            windows.append([ev["start"], ev["end"], ids])

    camp = table("campaign_table")
    rotate = [[r["stageId"], int(r["startTs"])] for r in camp.get("campaignRotateStageOpenTimes", [])]
    rot_ids = {r[0] for r in rotate}
    permanent = sorted(cid for cid in camp.get("campaigns", {}) if cid not in rot_ids and cid in known)

    out = {"updated": time.strftime("%Y-%m-%d"), "retro": retro_ids, "events": windows,
           "camp": {"permanent": permanent, "rotate": rotate}}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"stage-open: 상설 사이드 {len(retro_ids)} · 기간 이벤트 {len(windows)} · 상설 섬멸 {len(permanent)} · 순환 섬멸 {len(rotate)} → {os.path.relpath(OUT, REPO)}")


if __name__ == "__main__":
    main()
