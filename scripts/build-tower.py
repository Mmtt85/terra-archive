#!/usr/bin/env python3
"""보안파견 맵 이름·배경 — app/data/towers.json · public/tower/<id>.webp (2026-10-17, 내 정보 '이어하기' 보안파견 칸).

이어하기는 계정 원본의 tower.current.status.tower(예: tower_n_20)만 안다 — 맵 이름(세 언어)과 게임 보안파견 화면의
맵 배경(arts/ui/[uc]climbtower/towerbkg/bkg_<id>, 1024×864)을 붙인다.
  {"tower_n_20": {"ko": "슈피어 산기슭", "en": "...", "ja": "..."}, ...}
그림은 이미 있으면 건너뛴다. 새 그림이 생기면 node scripts/r2-sync.mjs.

  python3 scripts/build-tower.py [.gamedata]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".gamedata")
sys.path.insert(0, os.path.join(ROOT, "scripts"))


def towers(server):
    p = os.path.join(G, f"{server}_climb_tower_table.json")
    return json.load(open(p, encoding="utf-8")).get("towers") or {} if os.path.exists(p) else {}


def main():
    kr, en, jp, cn = towers("kr"), towers("en"), towers("jp"), towers("cn")
    out = {}
    for tid in list(kr) + [t for t in cn if t not in kr]:
        base = kr.get(tid) or cn.get(tid)
        out[tid] = {"ko": base["name"], "en": (en.get(tid) or base)["name"], "ja": (jp.get(tid) or base)["name"]}
    p = os.path.join(ROOT, "app", "data", "towers.json")
    json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    d = os.path.join(ROOT, "public", "tower")
    os.makedirs(d, exist_ok=True)
    import cdnassets
    got = miss = 0
    for tid in out:
        dest = os.path.join(d, f"{tid}.webp")
        if os.path.exists(dest):
            continue
        try:
            im = cdnassets.image(f"arts/ui/[uc]climbtower/towerbkg/bkg_{tid}")
        except Exception:
            im = None
        if im is None:
            miss += 1   # 훈련장(tower_tr_*)은 배경이 없다
            continue
        im = im.convert("RGB")
        if im.width > 720:
            im = im.resize((720, round(im.height * 720 / im.width)))
        im.save(dest, "WEBP", quality=82, method=6)
        got += 1
    print(f"  towers.json: 보안파견 {len(out)}곳 · 배경 새로 {got}장 (없음 {miss})")


if __name__ == "__main__":
    main()
