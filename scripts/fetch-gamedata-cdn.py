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
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbsutil import Cdn, Normalizer, load_flatc_json, parse_fbs, root_slots, unity_lzham
from fetchutil import urlread

HERE = os.path.dirname(os.path.abspath(__file__))
FBS_DIR = os.path.join(HERE, "fbs")
FBS_URL = "https://raw.githubusercontent.com/MooncellWiki/OpenArknightsFBS/main/FBS/%s.fbs"

# fetch-gamedata.py 의 서버별 세트와 같은 목록 (그쪽이 정본 — 바뀌면 같이 고칠 것).
# ⚠ 서버마다 다르다. 중섭은 **미래시 전용**이라 14표만 쓴다 — 이벤트·구역·스테이지처럼
#   한섭 화면을 만드는 표는 중섭에서 받아도 쓰는 데가 없다(중섭 콘텐츠를 사이트에 싣지
#   않는다). 예전엔 kr 세트를 네 서버에 그대로 물렸는데, 그러면 중섭에서 40MB를 헛으로
#   받고 `.gamedata/cn_activity_table.json` 같은 **아무도 안 읽는 파일**만 쌓인다.
TABLES = {
    "kr": ["character_table", "skill_table", "uniequip_table", "battle_equip_table",
           "building_data", "range_table", "handbook_team_table", "handbook_info_table",
           "gamedata_const", "item_table", "gacha_table", "stage_table", "skin_table",
           "charword_table", "enemy_handbook_table", "zone_table", "activity_table",
           "climb_tower_table", "sandbox_perm_table", "retro_table"],
    "cn": ["character_table", "skill_table", "uniequip_table", "battle_equip_table",
           "building_data", "range_table", "handbook_team_table", "handbook_info_table",
           "gamedata_const", "item_table", "charword_table", "skin_table",
           "enemy_handbook_table", "sandbox_perm_table"],
    # en/jp 에 range_table 이 없는 것은 의도다 — 공격 범위 격자는 **언어와 무관**해서
    # kr(없으면 cn) 것만 읽는다 (build-skill-levels.py, regen-operators.py). 넣어 봐야
    # 아무도 안 읽는 파일이 하나 더 생길 뿐이고, 하필 CDN에서 못 뜯는 표라 레포까지 다녀온다.
    "en": ["character_table", "skill_table", "uniequip_table", "battle_equip_table",
           "building_data", "handbook_team_table", "handbook_info_table",
           "item_table", "gacha_table", "stage_table", "skin_table", "charword_table",
           "enemy_handbook_table", "zone_table", "activity_table", "climb_tower_table",
           "sandbox_perm_table", "retro_table"],
}
TABLES["jp"] = TABLES["en"]

# CDN에서 못 뜯는 표 → 클뜯 레포에서 받는다.
# 매니페스트 경로에 해시 접미사가 없는 소수 레거시 표들은 FlatBuffer가 아니라 **진짜 암호화**돼
# 있다 (엔트로피 7.997 — FlatBuffer 표는 5.6). 옛 JSON+AES 시절 형식이 그대로 남은 것들이고,
# 공개된 중섭 마스크로는 안 풀린다. 다만 콘텐츠 업데이트와 함께 바뀌지 않아 급하지 않다 —
# range_table(공격 범위 격자)은 연 2~4회, 새 범위 모양이 나오는 오퍼가 있을 때만 바뀐다
# (2026-08-13, 06-22, 02-10, 2025-12-11 …). 그래서 레포판으로 메우고 넘어간다.
REPO = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/%s/gamedata/excel/%s.json"
FALLBACK = {"range_table"}


def keep_prev(dest, out_dir):
    """덮어쓰기 전 직전 판을 `<out>/.prev/` 에 남긴다.

    이게 있어야 받은 직후에 `whatsnew-gamedata.py --local` 로 **무엇이 바뀌었는지**
    바로 볼 수 있다. 클뜯 레포를 안 쓰게 되면서 "직전 커밋 대비"라는 기준이 사라졌고,
    그 자리를 이 스냅샷이 대신한다.
    """
    if not os.path.exists(dest):
        return
    prev = os.path.join(out_dir, ".prev")
    os.makedirs(prev, exist_ok=True)
    try:
        shutil.copy2(dest, os.path.join(prev, os.path.basename(dest)))
    except OSError:
        pass          # 스냅샷은 편의 기능이다 — 실패해도 받는 것은 계속한다


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
    tables = a.tables.split(",") if a.tables else TABLES[a.server]
    print("매니페스트 읽는 중…")
    cdn.manifest()

    ok, expected, unexpected, skipped = 0, [], [], 0
    for t in tables:
        print("  %-24s" % t, end=" ", flush=True)
        dest = os.path.join(a.out, "%s_%s.json" % (a.server, t))
        data, why = None, None
        if t not in FALLBACK:
            try:
                fb, path = cdn.text_asset("gamedata/excel/" + t)
                fbs_path, fbs_text = schema_for(t, a.server)
                if fbs_text:
                    data = decode(fb, fbs_path, fbs_text, t)
                    if data is None:
                        why = "디코딩 실패"
                else:
                    why = "스키마 없음"
            except KeyError as e:
                why = str(e)[:40]
        if data is None:                      # CDN에서 못 얻었으면 클뜯 레포로
            try:
                raw = urlread(REPO % (a.server, t), timeout=180, ua="terra-archive-cdn/1.0")
                open(dest, "wb").write(raw)
                if why:
                    print("⚠ %s → 레포 폴백 (%d KB)" % (why, len(raw) // 1024))
                    unexpected.append((t, why))
                else:
                    print("레포 폴백 (%d KB)" % (len(raw) // 1024))
                    expected.append(t)
            except Exception as e:
                print("✗ 레포도 실패: %s" % str(e)[:50]); skipped += 1
            continue
        keep_prev(dest, a.out)
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        print("→ %s (%d KB)" % (os.path.basename(dest), os.path.getsize(dest) // 1024))
        ok += 1

    print("\nCDN %d개 / 예정된 레포 폴백 %d개 / 실패 %d개  (resVersion %s)"
          % (ok, len(expected), skipped, cdn.res_version))

    # ⚠ 예정에 없던 폴백은 조용히 넘기지 않는다. 레포판은 CDN보다 며칠씩 낡아서, 이걸 놓치면
    #   "그 서버엔 아직 데이터가 없나 보다"로 오해하게 된다 — 2026-09-02에 일섭 activity_table이
    #   딱 이래서, 이미 들어와 있던 일본어 전략 4종이 한국어로 폴백된 채 배포됐다.
    if unexpected:
        print("\n⚠ 예정에 없던 레포 폴백 %d개 — 레포판은 CDN보다 낡았을 수 있다:" % len(unexpected))
        for t, why in unexpected:
            print("    %-24s %s" % (t, why))
        print("  → python3 scripts/fbs-repair.py <표이름> --server %s  로 스키마를 고친 뒤 다시 받을 것"
              % a.server)
    return 1 if (skipped or unexpected) else 0


if __name__ == "__main__":
    sys.exit(main())
