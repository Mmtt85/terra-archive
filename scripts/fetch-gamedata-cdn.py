#!/usr/bin/env python3
"""게임 CDN에서 gamedata 표를 직접 받아 `.gamedata/<prefix>_<table>.json` 으로 낸다.

`fetch-gamedata.py`(클뜯 레포에서 받기)와 **출력이 완전히 같은** 대체재다.
차이는 출처뿐 — 이쪽은 게임이 실제로 받는 CDN이라 **인게임 업데이트와 동시에** 손에 들어온다.
클뜯 레포는 사람이 돌려야 올라오므로 몇 시간~며칠씩 밀린다 (2026-09-02 실측: 11일).

    python3 scripts/fetch-gamedata-cdn.py                     # kr 기본 세트
    python3 scripts/fetch-gamedata-cdn.py --tables activity_table
    python3 scripts/fetch-gamedata-cdn.py --server cn --out .gamedata
    python3 scripts/fetch-gamedata-cdn.py --check             # 버전만 확인하고 끝

필요한 것: flatc(`brew install flatbuffers`), pip `UnityPy` `lz4inv`.

## 스키마

FlatBuffer를 JSON으로 되돌리려면 `.fbs` 스키마가 필요하다. 공개 스키마
(MooncellWiki/OpenArknightsFBS)를 받아 `scripts/fbs/_cache/` 에 캐시하고,
서버별로 손본 게 있으면 `scripts/fbs/<server>/<table>.fbs` 가 우선한다.

⚠ **스키마가 어긋나면 flatc는 조용히 세그폴트한다.** 그래서 돌리기 전에 바이너리
  루트 vtable 슬롯 수와 스키마 필드 수를 대조해, 안 맞으면 그 표를 건너뛰고
  무엇이 몇 개 어긋났는지 찍는다 (2026-09-02 — 중섭 스키마를 한섭에 그대로 물렸다가
  세그폴트만 보고 원인을 못 찾았던 일이 있어 넣은 방어선).
  어긋났을 때 고치는 법은 `docs/PROJECT-GUIDE.md` §2 참조.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbsutil import Cdn, Normalizer, load_flatc_json, parse_fbs, root_slots, unity_lzham
from fetchutil import urlread

HERE = os.path.dirname(os.path.abspath(__file__))
FBS_DIR = os.path.join(HERE, "fbs")
FBS_URL = "https://raw.githubusercontent.com/MooncellWiki/OpenArknightsFBS/main/FBS/%s.fbs"

# fetch-gamedata.py 의 kr 세트와 같은 목록 (그쪽이 정본 — 바뀌면 같이 고칠 것)
DEFAULT_TABLES = [
    "character_table", "skill_table", "uniequip_table", "battle_equip_table",
    "building_data", "range_table", "handbook_team_table", "handbook_info_table",
    "gamedata_const", "item_table", "gacha_table", "stage_table", "skin_table",
    "charword_table", "enemy_handbook_table", "zone_table", "activity_table",
    "climb_tower_table", "sandbox_perm_table", "retro_table",
]


def schema_for(table, server):
    """서버 전용 스키마 > 공용 손본 스키마 > 공개 스키마(캐시). 없으면 None."""
    for p in (os.path.join(FBS_DIR, server, table + ".fbs"),
              os.path.join(FBS_DIR, table + ".fbs")):
        if os.path.exists(p):
            return p, open(p, encoding="utf-8").read()
    cache = os.path.join(FBS_DIR, "_cache")
    os.makedirs(cache, exist_ok=True)
    p = os.path.join(cache, table + ".fbs")
    if not os.path.exists(p):
        try:
            data = urlread(FBS_URL % table, timeout=60, ua="terra-archive-cdn/1.0")
        except Exception:
            return None, None
        open(p, "wb").write(data)
    return p, open(p, encoding="utf-8").read()


def decode(fb, fbs_path, fbs_text, table):
    """FlatBuffer 바이트 → 공식 모양 JSON. 스키마가 안 맞으면 None."""
    tables, root = parse_fbs(fbs_text)
    want, have = len(tables.get(root, {})), root_slots(fb)
    if want != have:
        print("    ✗ 스키마 불일치 — 바이너리 %d슬롯 vs 스키마 %d필드 (%s)"
              % (have, want, root), file=sys.stderr)
        return None
    with tempfile.TemporaryDirectory() as tmp:
        binp = os.path.join(tmp, table + ".fb")
        open(binp, "wb").write(fb)
        r = subprocess.run(
            ["flatc", "--json", "--raw-binary", "--strict-json",
             "--allow-non-utf8", "--defaults-json", "-o", tmp, fbs_path, "--", binp],
            capture_output=True)
        out = os.path.join(tmp, table + ".json")
        if r.returncode != 0 or not os.path.exists(out):
            err = [l for l in r.stdout.decode("utf-8", "replace").split("\n")
                   if l.strip() and "warning" not in l]
            print("    ✗ flatc 실패(%d) %s" % (r.returncode, " ".join(err[:2])[:120]),
                  file=sys.stderr)
            return None
        return load_flatc_json(out, fbs_text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="kr", choices=["kr", "cn", "jp", "en"])
    ap.add_argument("--out", default=".gamedata")
    ap.add_argument("--tables", help="쉼표 구분. 생략하면 기본 세트")
    ap.add_argument("--cache", default=".gamedata/.cdn", help="번들 캐시 폴더")
    ap.add_argument("--check", action="store_true", help="버전만 찍고 끝")
    a = ap.parse_args()

    unity_lzham()
    cdn = Cdn(a.server, cache_dir=a.cache)
    print("%s CDN  resVersion %s  (client %s)"
          % (a.server, cdn.res_version, cdn.client_version))
    if a.check:
        return 0

    os.makedirs(a.out, exist_ok=True)
    tables = a.tables.split(",") if a.tables else DEFAULT_TABLES
    print("매니페스트 읽는 중…")
    cdn.manifest()

    ok = skipped = 0
    for t in tables:
        print("  %-24s" % t, end=" ", flush=True)
        try:
            fb, path = cdn.text_asset("gamedata/excel/" + t)
        except KeyError as e:
            print("✗ %s" % e); skipped += 1; continue
        fbs_path, fbs_text = schema_for(t, a.server)
        if not fbs_text:
            print("✗ 스키마 없음"); skipped += 1; continue
        data = decode(fb, fbs_path, fbs_text, t)
        if data is None:
            skipped += 1; continue
        dest = os.path.join(a.out, "%s_%s.json" % (a.server, t))
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        print("→ %s (%d KB)" % (os.path.basename(dest), os.path.getsize(dest) // 1024))
        ok += 1

    print("\n%d개 완료 / %d개 건너뜀  (resVersion %s)" % (ok, skipped, cdn.res_version))
    return 1 if skipped and not ok else 0


if __name__ == "__main__":
    sys.exit(main())
