#!/usr/bin/env python3
"""패러독스 시뮬레이션 목록 — app/data/paradox.json (2026-10-17, 내 정보 '패러독스 시뮬레이션' 칸).

handbook_info_table.handbookStageData 의 오퍼마다 해금 조건(정예화·레벨)만 싣는다. 이름은 오퍼 도감 쪽에 이미 있어 안 싣는다.
  {"char_009_12fce": [0, 30], "char_103_angel": [2, 1], ...}   # [정예화, 레벨] — 이 단계에 닿으면 열린다
  셋째 칸 1 = 중섭에만 있는 패러독스 — 오퍼는 한섭에 나왔어도 패러독스는 늦게 오는 경우가 있어(실측 13개) 한섭 계정은 이걸 빼고 센다
한섭 표를 기본으로, 중섭에만 있는 오퍼(미실장)도 더한다 — 중섭 계정이 쓰고, 한섭 계정 화면은 오퍼 도감의 미실장 표시로 거른다.
해금 종류는 지금 AWAKE(정예화·레벨) 하나뿐이다 — 다른 종류가 생기면 멈춰서 알린다.

  python3 scripts/build-paradox.py [.gamedata]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".gamedata")


def load(server):
    p = os.path.join(G, f"{server}_handbook_info_table.json")
    if not os.path.exists(p):
        return {}
    return json.load(open(p, encoding="utf-8")).get("handbookStageData") or {}


def main():
    out = {}
    for server in ("kr", "cn"):
        for cid, row in load(server).items():
            if cid in out:
                continue
            req = None
            for u in row.get("unlockParam") or []:
                if u.get("unlockType") != "AWAKE":
                    sys.exit(f"✗ {cid}: 모르는 해금 종류 {u.get('unlockType')} — build-paradox.py 를 손볼 것")
                req = [int(u.get("unlockParam1") or 0), int(u.get("unlockParam2") or 1)]
            out[cid] = (req or [0, 1]) + ([1] if server == "cn" else [])   # 셋째 칸 1 = 중섭에만 있다(한섭 미실장)
    if not out:
        sys.exit("✗ handbook_info_table 이 없다")
    p = os.path.join(ROOT, "app", "data", "paradox.json")
    json.dump(dict(sorted(out.items())), open(p, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"  paradox.json: 패러독스 {len(out)}개")


if __name__ == "__main__":
    main()
