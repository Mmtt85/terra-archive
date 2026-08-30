#!/usr/bin/env python3
"""위수 협의 전투 맵 — app/data/autochess-routes.json (제보 c3d2c056, 2026-08-30).

사용:
  python3 scripts/build-autochess-routes.py

⚠⚠ **어느 레벨이 '맵'인지** — 여기서 두 번 틀렸다 (2026-08-30):
  · battleDataDict 의 levelId(level_act1autochess_01 …)는 **라운드별 웨이브 정의**다.
    지형이 장애물 없는 밋밋한 판 하나로 전부 같고, 거기 담긴 routes 는 그 밋밋한 판을
    기준으로 그어져 있다 — 실제 맵 위에 얹으면 **벽(x)을 뚫고 지나간다**(실측).
    처음엔 이걸 맵으로 알고 36장을 늘어놓았다가 "뭘 보여주려는지 모르겠다"는 지적을 받았다.
  · 진짜 맵은 **stageDatasDict → stage_table[stageId].levelId** 다. 시즌2가 쓰는 것은
    act1autochess_m01~m04 + act2autochess_m01~m02 의 **6장**이고 서로 지형이 다르다
    (m05~m07 은 weight 0, act2 m03·m04 는 KR 미실장). 판을 시작할 때 이 중 하나가 뽑힌다.

그래서 이 파일은 **지형만** 싣는다. 적 이동 경로는 라운드마다 다르고 실제 맵 위에서
다시 계산되는 값이라(템플릿 경로가 벽을 뚫는 것이 그 방증) 넣지 않는다.

렌더러는 작전 도감·통합전략과 같은 app/stage-route-map.tsx, 타일 분류 정본은
scripts/routeutil.py (규칙: .claude/skills/route-map-rules).

잘라내기: 21x19 중 위쪽 작은 상자(0~4행)는 전장이 아니라 별도 표시 구역이라 뺀다.
전장은 전부 'x' 인 행으로 갈라지는 두 구획(6~11 · 13~18)이다 — 둘 다 싣는다.

출력: { maps: [{id, n, w, h, g, band, modes, weight}], nm: {} }
"""
import json, os, sys, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
DATA = os.path.join(REPO, "app", "data")
CACHE = os.path.join(REPO, ".gamedata", "aclevel")
os.makedirs(CACHE, exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from routeutil import grid_of_level  # noqa: E402

ACT = "act2autochess"


def fetch(path, branch="kr"):
    fn = os.path.join(CACHE, f"{branch}__" + path.replace("/", "__"))
    if os.path.exists(fn):
        return json.load(open(fn, encoding="utf-8"))
    d = json.load(urllib.request.urlopen(f"{GAMEDATA}/{branch}/gamedata/{path}"))
    json.dump(d, open(fn, "w", encoding="utf-8"))
    return d


def local(name):
    return json.load(open(os.path.join(REPO, ".gamedata", name), encoding="utf-8"))


def main():
    act = local("kr_activity_table.json")["activity"]["AUTOCHESS_SEASON"][ACT]
    stages = local("kr_stage_table.json")["stages"]
    modes = {m["modeId"]: m for m in act["modeDataDict"].values()}

    rows, skipped = [], []
    for sid, sd in act["stageDatasDict"].items():
        if not sd.get("weight"):
            skipped.append((sid, "weight 0"))
            continue
        st = stages.get(sid)
        if not st or not st.get("levelId"):
            skipped.append((sid, "KR 미실장"))
            continue
        doc = grid_of_level(fetch("levels/" + st["levelId"].lower() + ".json"))
        if not doc:
            sys.exit(f"{sid}: 지형을 못 읽었다 ({st['levelId']})")
        g, H, W = doc["g"], doc["h"], doc["w"]
        # 전장 구획 — 전부 'x' 인 행으로 끊고, 맨 위 작은 상자는 뺀다
        bands, cur = [], None
        for i, row in enumerate(g):
            if set(row) == {"x"}:
                if cur:
                    bands.append(cur); cur = None
            else:
                cur = (cur[0], i) if cur else (i, i)
        if cur:
            bands.append(cur)
        if len(bands) != 3:
            sys.exit(f"{sid}: 구획이 3개가 아니다({len(bands)}) {bands} — 맵 구조가 바뀌었다")
        for bi, (r0, r1) in enumerate(bands[1:]):      # [0] = 위쪽 표시 상자, 버린다
            rows.append({
                "id": f"{sid}#{bi}", "stage": sid, "band": bi,
                "w": W, "h": r1 - r0 + 1, "g": g[r0:r1 + 1],
                "modes": [modes[m]["name"] for m in sd.get("mode", []) if m in modes],
            })
    if not rows:
        sys.exit("맵이 하나도 안 잡혔다 — stageDatasDict/stage_table 구조를 확인하라")

    out = {"maps": rows}
    fn = os.path.join(DATA, "autochess-routes.json")
    json.dump(out, open(fn, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    seen = sorted({r["stage"] for r in rows})
    print(f"  app/data/autochess-routes.json  {os.path.getsize(fn) // 1024}KB")
    print(f"  맵 {len(seen)}장 x 구획 2 = {len(rows)}판 · {rows[0]['w']}x{rows[0]['h']}")
    print(f"  실린 맵: {', '.join(seen)}")
    if skipped:
        print(f"  건너뜀: {', '.join(f'{a}({b})' for a, b in skipped)}")


if __name__ == "__main__":
    main()
