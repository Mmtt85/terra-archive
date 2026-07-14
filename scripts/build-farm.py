#!/usr/bin/env python3
"""Build app/data/farm.json — 재료 파밍 효율표 탭 데이터.

Usage: python3 scripts/build-farm.py <gamedata-dir>
Needs: {kr,en,jp}_item_table.json, {kr,en,jp}_stage_table.json (클뜯 레포)
       + 네트워크 (펭귄 물류 API 2건 실시간 조회).

데이터 결합:
  - 재료 목록·이름(3개 언어)·아이콘·등급: 클뜯 item_table (5자리 숫자 id의 MATERIAL,
    즉 30xxx/31xxx 정예화 재료 — 드랍 통계가 있는 것만 수록)
  - 스테이지 이성(apCost)·코드·개방 여부(KR): 펭귄 물류 /stages
  - 실측 드랍률: 펭귄 물류 /result/matrix?server=KR&show_closed_zones=false
    (현재 열려 있는 존만 — 종료된 이벤트 스테이지는 제외됨)
  - 스테이지 이름(3개 언어): 클뜯 stage_table

효율 지표 = 기대 이성(sanity) = apCost / 드랍률. 재료별로 기대 이성이 가장 낮은
스테이지가 "최고 효율". 표본(times)이 MIN_TIMES 미만인 행은 신뢰 불가로 버린다.

아이콘은 yuanyan3060/ArknightsGameResource의 item/<iconId>.png 를
public/items/<itemId>.png 로 내려받는다 (있으면 스킵).
"""
import json, os, sys, time, urllib.request

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PENGUIN = "https://penguin-stats.io/PenguinStats/api/v2"
ICON_BASE = "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/item"
MIN_TIMES = 100     # 이 표본 미만의 드랍 통계는 수록하지 않는다
MAX_STAGES = 8      # 재료당 표시할 스테이지 수 (기대 이성 오름차순 상위)

load = lambda p: json.load(open(p, encoding="utf-8"))

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "terra-archive-farm/1.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))

def items_of(prefix):
    table = load(f"{S}/{prefix}_item_table.json")
    return table.get("items", table)

def stage_names_of(prefix):
    table = load(f"{S}/{prefix}_stage_table.json")
    return {sid: st.get("name") for sid, st in (table.get("stages") or {}).items()}

kr_items = items_of("kr")
en_items = items_of("en")
jp_items = items_of("jp")
kr_stage_names = stage_names_of("kr")
en_stage_names = stage_names_of("en")
jp_stage_names = stage_names_of("jp")

print("fetching penguin-stats …", file=sys.stderr)
pg_stages = {s["stageId"]: s for s in fetch(f"{PENGUIN}/stages?server=KR")}
matrix = fetch(f"{PENGUIN}/result/matrix?server=KR&show_closed_zones=false")["matrix"]

def tier(r):
    return int(str(r).replace("TIER_", ""))

# 스테이지 성격: 상시(메인/서브·복각 상설) / 기간 한정 이벤트 / 물자(요일)
def stage_kind(stage):
    sid, stype = stage["stageId"], stage.get("stageType")
    if stype in ("MAIN", "SUB"): return "main"
    if sid.endswith("_perm") or sid.endswith("_rep"): return "perm"
    if stype == "DAILY": return "daily"
    return "event"

# 드랍 행 집계: itemId → [{stage row}]
rows_by_item = {}
for entry in matrix:
    iid = entry["itemId"]
    if not (iid.isdigit() and len(iid) == 5 and iid in kr_items): continue
    if kr_items[iid].get("itemType") != "MATERIAL": continue
    stage = pg_stages.get(entry["stageId"])
    if not stage: continue
    if not ((stage.get("existence") or {}).get("KR") or {}).get("exist"): continue
    times, quantity = entry.get("times", 0), entry.get("quantity", 0)
    ap = stage.get("apCost") or 0
    if times < MIN_TIMES or quantity <= 0 or ap <= 0: continue
    rate = quantity / times
    rows_by_item.setdefault(iid, []).append({
        "id": stage["stageId"],
        "code": (stage.get("code_i18n") or {}).get("ko") or stage.get("code"),
        "name": {
            "ko": kr_stage_names.get(stage["stageId"]),
            "en": en_stage_names.get(stage["stageId"]),
            "ja": jp_stage_names.get(stage["stageId"]),
        },
        "ap": ap,
        "kind": stage_kind(stage),
        "rate": round(rate * 100, 2),        # %
        "sanity": round(ap / rate, 1),        # 개당 기대 이성
        "times": times,
    })

# 아이콘 다운로드 (public/items/<itemId>.png, 있으면 스킵)
icon_dir = os.path.join(REPO, "public", "items")
os.makedirs(icon_dir, exist_ok=True)
failed_icons = []
for iid in rows_by_item:
    dest = os.path.join(icon_dir, f"{iid}.png")
    if os.path.exists(dest): continue
    icon = kr_items[iid].get("iconId")
    try:
        req = urllib.request.Request(f"{ICON_BASE}/{urllib.request.quote(icon)}.png",
                                     headers={"User-Agent": "terra-archive-farm/1.0"})
        with urllib.request.urlopen(req, timeout=60) as res:
            open(dest, "wb").write(res.read())
        print("icon:", iid, icon, file=sys.stderr)
    except Exception as err:  # noqa: BLE001 — 아이콘 하나 실패해도 데이터는 만든다
        failed_icons.append((iid, icon, str(err)))

out_items = []
for iid, rows in rows_by_item.items():
    info = kr_items[iid]
    rows.sort(key=lambda r: r["sanity"])
    out_items.append({
        "id": iid,
        "name": {
            "ko": info.get("name"),
            "en": (en_items.get(iid) or {}).get("name") or info.get("name"),
            "ja": (jp_items.get(iid) or {}).get("name") or info.get("name"),
        },
        "rarity": tier(info.get("rarity")),
        "sortId": info.get("sortId", 0),
        "image": f"/items/{iid}.png",
        "stages": rows[:MAX_STAGES],
    })
# 표시 순서: 등급 내림차순 → 게임 정렬(sortId)
out_items.sort(key=lambda item: (-item["rarity"], item["sortId"]))

out = {"updated": time.strftime("%Y-%m-%d"), "minTimes": MIN_TIMES, "items": out_items}
json.dump(out, open(f"{REPO}/app/data/farm.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))

print(f"farm.json: {len(out_items)} materials")
for r in range(5, 0, -1):
    n = sum(1 for i in out_items if i["rarity"] == r)
    if n: print(f"  T{r}: {n}")
if failed_icons:
    print("FAILED icons:", failed_icons, file=sys.stderr)
    sys.exit(1)
