#!/usr/bin/env python3
"""Download the ArknightsGamedata excel tables the pipeline needs into one folder.

Usage: python3 scripts/fetch-gamedata.py [target-dir]   # default: .gamedata

파이프라인(regen-operators / retag-concepts / build-infra / build-recruit /
build-costs / build-farm / build-i18n)이 읽는 로케일별 테이블을
`ArknightsAssets/ArknightsGamedata` 레포에서 받아 `<prefix>_<table>.json`으로 저장한다.
경로 규칙: {BASE}/{prefix}/gamedata/excel/{table}.json (prefix = kr/cn/en/jp).
build-story.py는 story_review_table을 자체적으로 원격 fetch하므로 여기 없어도 된다.
"""
import concurrent.futures as cf
import os
import sys

from fetchutil import urlread

BASE = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"

# 로케일별 필요한 테이블 (현행 .gamedata 세트 = 스크립트가 실제 로드하는 것)
TABLES = {
    "kr": ["character_table", "skill_table", "uniequip_table", "battle_equip_table",
           "building_data", "range_table", "handbook_team_table", "handbook_info_table",
           "gamedata_const", "item_table", "gacha_table", "stage_table"],
    "cn": ["character_table", "skill_table", "uniequip_table", "battle_equip_table",
           "building_data", "range_table", "handbook_team_table", "handbook_info_table",
           "gamedata_const", "item_table"],
    "en": ["character_table", "skill_table", "uniequip_table", "battle_equip_table",
           "building_data", "handbook_team_table", "handbook_info_table",
           "item_table", "gacha_table", "stage_table"],
    "jp": ["character_table", "skill_table", "uniequip_table", "battle_equip_table",
           "building_data", "handbook_team_table", "handbook_info_table",
           "item_table", "gacha_table", "stage_table"],
}

target = sys.argv[1] if len(sys.argv) > 1 else ".gamedata"
os.makedirs(target, exist_ok=True)


def fetch(prefix, table):
    url = f"{BASE}/{prefix}/gamedata/excel/{table}.json"
    dest = os.path.join(target, f"{prefix}_{table}.json")
    # CI 러너의 일시 429/5xx 플레이크 대비 재시도 (fetchutil)
    data = urlread(url, timeout=60, ua="terra-archive-fetch")
    if len(data) < 2:
        raise ValueError("empty body")
    with open(dest, "wb") as f:
        f.write(data)
    return f"{prefix}_{table}.json ({len(data) // 1024} KB)"


jobs = [(p, t) for p, tables in TABLES.items() for t in tables]
failed = []
with cf.ThreadPoolExecutor(max_workers=8) as pool:
    futs = {pool.submit(fetch, p, t): (p, t) for p, t in jobs}
    for fut in cf.as_completed(futs):
        p, t = futs[fut]
        try:
            print("ok:", fut.result())
        except Exception as err:  # noqa: BLE001
            failed.append(f"{p}_{t}")
            print("FAIL:", f"{p}/{t}", err, file=sys.stderr)

print(f"\n{len(jobs) - len(failed)}/{len(jobs)} tables → {target}")
if failed:
    print("FAILED:", failed, file=sys.stderr)
    sys.exit(1)
