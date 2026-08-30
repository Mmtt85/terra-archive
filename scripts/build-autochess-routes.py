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

그래서 이 파일은 **둘 다, 따로** 싣는다 (사용자 지적 "경로 데이터 있었잖아? 다 있는데?"):
  maps   = 진짜 전장 6장의 **지형** — 배치 칸·적 출현·방어 지점. 실제로 플레이하는 판이다.
  rounds = 라운드별 **적 구성과 경로** (band = 0 일반 전장 · 1 리더 전장). 이건 웨이브 템플릿 격자 위의 도식이라 실제 지형과
           겹쳐 놓으면 안 된다 — 화면이 "실제 지형이 아니라 도식"이라고 명시한다.
           실측: 경로 꼭짓점이 자기 템플릿에서는 100% 이동 가능 타일에 얹히지만 실제 맵
           6장에서는 69~93%에 그친다(=벽을 뚫는다). 실제 경로는 게임이 맵마다 다시 구한다.

렌더러는 작전 도감·통합전략과 같은 app/stage-route-map.tsx, 타일 분류 정본은
scripts/routeutil.py (규칙: .claude/skills/route-map-rules).

잘라내기: 21x19 중 위쪽 작은 상자(0~4행)는 전장이 아니라 별도 표시 구역이라 뺀다.
전장은 전부 'x' 인 행으로 갈라지는 두 구획(6~11 · 13~18)이다 — 둘 다 싣는다.

출력: { maps: [{id, stage, band, w, h, g, modes}],
        rounds: [{k, label, band, ...경로문서}], nm: {적id: [ko,en,ja]} }
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


def crop_doc(doc, c0, r1_row, w, h, H):
    """격자와 경로를 잘라낸 상자에 맞춘다 (g는 위가 0행, r은 아래가 0행)."""
    r0 = r1_row - h + 1
    doc["g"] = [row[c0:c0 + w] for row in doc["g"][r0:r1_row + 1]]
    doc["w"], doc["h"] = w, h
    dy = H - 1 - r1_row
    doc["r"] = [None if p is None else [[x - c0, y - dy] for x, y in p] for p in doc["r"]]
    return doc


def fetch_handbook(branch):
    fn = os.path.join(REPO, ".gamedata", f"{branch}_enemy_handbook_table.json")
    if os.path.exists(fn):
        return json.load(open(fn, encoding="utf-8")).get("enemyData", {})
    return fetch("excel/enemy_handbook_table.json", branch).get("enemyData", {})


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

    # ── 라운드별 적·경로 (웨이브 템플릿) ──
    from routeutil import routes_of_level
    edb = {}
    for e in fetch("levels/enemydata/enemy_database.json").get("enemies", []):
        v = e.get("Value") or []
        if v:
            edb[e["Key"]] = v[-1].get("enemyData", {})
    bosses = {b: (act["bossInfoDict"][b].get("name") or b) for b in act["bossInfoDict"]}
    seen, waves = {}, []
    for mode, rnds in act["battleDataDict"].items():
        for rnd, arr in rnds.items():
            for e in arr:
                lid = e["levelId"].lower()
                w = seen.setdefault(lid, {"rounds": set(), "boss": e.get("bossId"),
                                          "train": mode == "mode_training_1"})
                w["rounds"].add(int(rnd))
    for lid, info in seen.items():
        doc = routes_of_level(fetch(f"levels/{lid}.json"), edb)
        if not doc:
            sys.exit(f"웨이브 경로를 못 만들었다: {lid}")
        g, H = doc["g"], doc["h"]
        bands, cur = [], None
        for i, row in enumerate(g):
            if set(row) == {"x"}:
                if cur:
                    bands.append(cur); cur = None
            else:
                cur = (cur[0], i) if cur else (i, i)
        if cur:
            bands.append(cur)
        rws = {H - 1 - y for poly in doc["r"] for _x, y in poly or []}
        hit = [b for b in bands if rws <= set(range(b[0], b[1] + 1))]
        if len(hit) != 1:
            sys.exit(f"{lid}: 경로가 한 구획에 안 담긴다")
        r0, r1 = hit[0]
        cols = [c for row in g for c, ch in enumerate(row) if ch != "x"]
        c0, c1 = min(cols), max(cols)
        crop_doc(doc, c0, r1, c1 - c0 + 1, r1 - r0 + 1, H)
        doc["k"] = lid.split("/")[-1].replace("level_act1autochess_", "").replace("level_act2autochess_", "")
        doc["boss"] = info["boss"]
        doc["train"] = 1 if info["train"] else 0
        doc["rs"] = sorted(info["rounds"])
        doc["solo"] = 1 if doc["k"].endswith("_s") else 0
        # 이 웨이브가 어느 구획에서 도는가 — 0 일반, 1 리더. 사용자가 게임 화면에서
        # "아랫판은 보스맵"이라고 확인해 줬고(2026-08-30), 경로가 실제로 그 구획에만 있다.
        doc["band"] = bands.index(hit[0])
        waves.append(doc)
    waves.sort(key=lambda d: (d["train"], min(d["rs"]), d["k"]))

    known = set(json.load(open(os.path.join(DATA, "enemy-names.json"), encoding="utf-8"))["ids"])
    books = {loc: fetch_handbook(br) for loc, br in [("ko", "kr"), ("en", "en"), ("ja", "jp")]}
    nm = {}
    for eid in sorted({k for d in waves for k in d["e"]}):
        if eid not in known:
            nm[eid] = [(books[l].get(eid) or {}).get("name") or eid for l in ("ko", "en", "ja")]

    out = {"maps": rows, "rounds": waves, "bosses": bosses, "nm": nm}
    fn = os.path.join(DATA, "autochess-routes.json")
    json.dump(out, open(fn, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"  app/data/autochess-routes.json  {os.path.getsize(fn) // 1024}KB")
    print(f"  전장 {len({r['stage'] for r in rows})}장 x 구획 2 = {len(rows)}판 · {rows[0]['w']}x{rows[0]['h']}")
    print(f"  실린 맵: {', '.join(sorted({r['stage'] for r in rows}))}")
    print(f"  라운드 웨이브 {len(waves)}판 · 적 이름표 보충 {len(nm)}")
    if skipped:
        print(f"  건너뜀: {', '.join(f'{a}({b})' for a, b in skipped)}")


if __name__ == "__main__":
    main()
