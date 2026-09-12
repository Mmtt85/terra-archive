#!/usr/bin/env python3
"""오퍼 도감이 쓰는 **전투 스킬 아이콘**을 받아 public/skills/icon/<icon>.webp 로 저장한다.

Usage: python3 scripts/build-skill-icons.py [gamedata-dir]   # default: .gamedata

파일명 규칙은 위수 협의(build-autochess.py)가 쓰던 것과 같다 —
`arts/skills/skill_icon_<icon>.png`, `icon = skill_table[skillId].iconId or skillId`.
스킬 1,630개 중 iconId가 따로 있는 것은 139개뿐이고 나머지는 스킬 id가 곧 파일명이다.

⚠ **이미 있는 파일은 건너뛴다.** 888장을 매번 다시 받으면 CI가 몇 분씩 길어진다 —
   신규 오퍼가 들어왔을 때 새 아이콘만 붙는 증분 방식이다. 다시 받고 싶으면 폴더를 지운다.

⚠ 대상은 **도감 오퍼가 실제로 참조하는 스킬**뿐이다 (operators.json 기준, 소환물 포함).
   skill_table 전체(1,630개)를 받으면 화면에 안 쓰는 적·소환 전용 아이콘까지 딸려 온다.

⚠ 서빙은 R2다 — r2-sync.mjs의 DIRS에 "skills"가 이미 있고 하위 폴더까지 훑으므로
   여기 새로 만드는 icon/ 도 자동으로 올라간다. 화면에서는 asset()으로 감싸 쓴다.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMEDATA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, ".gamedata")
OUT = os.path.join(REPO, "public", "skills", "icon")
SKILL_ICON = ("https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2"
              "/cn/assets/dyn/arts/skills")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imgutil import save_webp  # noqa: E402


def load(name):
    path = os.path.join(GAMEDATA, name)
    if not os.path.exists(path):
        sys.exit(f"없음: {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    skill_table = load("kr_skill_table.json")
    with open(os.path.join(REPO, "app", "data", "operators.json"), encoding="utf-8") as f:
        operators = json.load(f)

    # 도감이 참조하는 스킬 id — 본체 + 소환물
    sids = set()
    for op in operators:
        for sk in op.get("skills") or []:
            if sk.get("id"):
                sids.add(sk["id"])
        for su in op.get("summons") or []:
            for sk in su.get("skills") or []:
                if sk.get("id"):
                    sids.add(sk["id"])

    icons = {(skill_table.get(sid) or {}).get("iconId") or sid for sid in sids}
    os.makedirs(OUT, exist_ok=True)
    jobs = []
    for icon in sorted(icons):
        dest = os.path.join(OUT, f"{icon}.webp")
        if os.path.exists(dest):
            continue
        jobs.append((f"{SKILL_ICON}/skill_icon_{urllib.parse.quote(icon)}.png", dest))

    print(f"스킬 {len(sids)}개 · 아이콘 {len(icons)}종 · 받을 것 {len(jobs)}장", file=sys.stderr)
    if not jobs:
        print("전부 이미 있음 — 받을 것 없음", file=sys.stderr)
        return

    fails = []

    def one(job):
        url, dest = job
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "terra-archive-skill-icons/1.0"})
            with urllib.request.urlopen(req, timeout=30) as res:
                data = res.read()
            # 아이콘은 작은 투명 PNG라 무손실이 대체로 더 작다 — 스킨 포트레이트와 달리
            # method=6 로 눌러도 장당 수십 ms 수준이다
            save_webp(data, dest)
        except Exception as exc:  # noqa: BLE001 — 한 장 실패가 전체를 멈추지 않게
            fails.append((url, exc))

    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(one, jobs))

    print(f"아이콘 {len(jobs) - len(fails)}/{len(jobs)}", file=sys.stderr)
    for url, err in fails[:10]:
        print("  실패:", url, err, file=sys.stderr)
    if fails:
        print(f"⚠ {len(fails)}장 실패 — 다시 돌리면 없는 것만 재시도한다", file=sys.stderr)


if __name__ == "__main__":
    main()
