#!/usr/bin/env python3
"""내 정보(/me) '현재 / 전체' 칸의 전체 수 → app/data/me-meta.json (2026-10-05)

계정 데이터(워커)에는 '내가 가진 것'만 있다. '전체'는 게임 표에서 센다:
  skins   한섭 스킨 수 — skin_table.charSkins 중 기본 복장이 아닌 것(id 에 '@')

사용: python3 scripts/build-me-meta.py [gamedata-dir]   (ci-refresh.sh 가 build-stage-open 뒤에 돌린다)
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
G = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", os.path.join(REPO, ".gamedata"))
OUT = os.path.join(REPO, "app", "data", "me-meta.json")


def main():
    with open(os.path.join(G, "kr_skin_table.json"), encoding="utf-8") as f:
        skins = json.load(f).get("charSkins", {})
    n = sum(1 for sid, s in skins.items() if "@" in sid and str(s.get("charId", "")).startswith("char_"))
    out = {"updated": time.strftime("%Y-%m-%d"), "skins": n}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"me-meta: 스킨 {n} → {os.path.relpath(OUT, REPO)}")


if __name__ == "__main__":
    main()
