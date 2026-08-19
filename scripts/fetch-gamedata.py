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
    # ⚠ charword_table은 build-voicelines.py의 유일한 입력이다. 2026-08-01에 이게 빠져 있어
    #   CI가 보이스 파일 1,280개를 통째로 지우고 커밋했다 — 빼먹지 말 것.
    # ⚠ enemy_handbook_table·zone_table은 build-enemies.py(적 도감)의 입력이다. 셋 다
    #   같은 세트로 있어야 EN/JA 적 도감이 한국어로 폴백하지 않는다.
    "kr": ["character_table", "skill_table", "uniequip_table", "battle_equip_table",
           "building_data", "range_table", "handbook_team_table", "handbook_info_table",
           "gamedata_const", "item_table", "gacha_table", "stage_table", "skin_table",
           "charword_table", "enemy_handbook_table", "zone_table", "activity_table", "climb_tower_table",
           "sandbox_perm_table",  # 생존연산 가이드 (build-sandbox.py)
           "retro_table"],  # 복각 상설(기록 복원) 존·이벤트명 — build-farm.py 이벤트명 병기
    "cn": ["character_table", "skill_table", "uniequip_table", "battle_equip_table",
           "building_data", "range_table", "handbook_team_table", "handbook_info_table",
           "gamedata_const", "item_table", "charword_table", "skin_table",
           "enemy_handbook_table", "sandbox_perm_table"],  # sandbox_2(신시즌)는 CN 선행
    "en": ["character_table", "skill_table", "uniequip_table", "battle_equip_table",
           "building_data", "handbook_team_table", "handbook_info_table",
           "item_table", "gacha_table", "stage_table", "skin_table", "charword_table",
           "enemy_handbook_table", "zone_table", "activity_table", "climb_tower_table", "sandbox_perm_table", "retro_table"],
    "jp": ["character_table", "skill_table", "uniequip_table", "battle_equip_table",
           "building_data", "handbook_team_table", "handbook_info_table",
           "item_table", "gacha_table", "stage_table", "skin_table", "charword_table",
           "enemy_handbook_table", "zone_table", "activity_table", "climb_tower_table", "sandbox_perm_table", "retro_table"],
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
