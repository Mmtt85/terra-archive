#!/usr/bin/env python3
"""위수 협의 전투 맵 — app/data/autochess-routes.json (사용자 요청 2026-08-30,
제보 c3d2c056 "add the maps for Stronghold Protocol … positioning aegir alliance").

사용:
  python3 scripts/build-autochess-routes.py

작전 도감(stage-routes.json)·통합전략(rogue-routes.json)과 **같은 문서 형식**이라
렌더러 app/stage-route-map.tsx를 그대로 쓴다. 추출 로직 정본은 scripts/routeutil.py —
규칙은 .claude/skills/route-map-rules/SKILL.md.

⚠ 맵 '사진'은 필요 없다 (2026-08-30 확인). 타일 격자와 적 경로는 레벨 JSON에서 뽑아
   그리는 것이라 이미지 자산이 아예 안 든다 — 예전에 이미지가 없어 접었다는 기억은
   이 방식에는 해당되지 않는다.

구조 (kr_activity_table → activity.AUTOCHESS_SEASON.act2autochess.battleDataDict):
  R1~R13  모든 난이도 공통 고정 맵 13개 (01~07 · h01~h06)
  R14     리더 7종(boss_1~7) 각각 전용 맵 — 단독은 `_S` 접미, 협동은 접미 없음
  R15     리더 3종(boss_8~10) 같은 규약. 표준 시뮬레이션만 리더가 R9에 온다.
  입문 협의는 tr01·tr02·tr04 4라운드.
  ⚠ 시즌2는 시즌1 맵을 그대로 물려받는다 — 36개 중 34개가 ACT1AUTOCHESS 레벨이고
    새 맵은 boss_5용 2개(단독/협동)뿐이다. levelId 대문자 경로는 404, 파일은 소문자다.

⚠⚠ **전장은 하나뿐이다** (실측 2026-08-30: 36개 맵의 타일 격자가 전부 동일).
라운드가 바뀌어도 지형은 그대로고, 달라지는 건 **적의 종류와 오는 길**뿐이다.
그 하나의 전장이 위·아래 두 구획으로 나뉘어 있고 — 전부 'x'인 행이 사이를 끊는다 —
**일반 라운드는 위 구획만, 리더 라운드는 아래 구획만** 쓴다 (전수 확인: 양쪽을 함께
쓰는 맵 0개). 그래서 맵마다 **자기 구획만** 잘라낸다. 통째로 그리면 어느 전투에서든
절반이 늘 빈 칸이라 "위아래로 두 개인데 뭘 뜻하는지 모르겠다"가 된다 (사용자 지적
2026-08-30 — 처음엔 21x19를 17x12로만 줄였다가 이 지적을 받고 구획별로 다시 잘랐다).

**잘라내기** 좌표를 옮겨야 하는 곳은 두 군데뿐:
  g = 행 문자열 (row 0 = 위)      → 행·열을 잘라낸다
  r = 경로 꼭짓점 [col, row]      (row 0 = **아래**) → col -= c0, row -= (H-1-r1)
나머지 필드(f·e·sp·wv·ems·cw·mm)에는 좌표가 없다.

출력: { bands, maps{id: 경로문서+band}, rounds[], leaders{}, train[], nm{} }
  band = 0 위 구획(일반 라운드) · 1 아래 구획(리더 라운드)
  nm = 적 도감(enemy-names.json)에 없는 적의 3개 국어 이름표 (리더 하위 형태 6종).
       나머지 33종은 화면이 loadEnemies()로 이미 풀 수 있어 싣지 않는다.
"""
import json, os, sys, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
DATA = os.path.join(REPO, "app", "data")
CACHE = os.path.join(REPO, ".gamedata", "aclevel")
os.makedirs(CACHE, exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from routeutil import routes_of_level  # noqa: E402

ACT = "act2autochess"
LOCS = [("ko", "kr"), ("en", "en"), ("ja", "jp")]


def fetch(path, branch="kr"):
    fn = os.path.join(CACHE, f"{branch}__" + path.replace("/", "__"))
    if os.path.exists(fn):
        return json.load(open(fn, encoding="utf-8"))
    d = json.load(urllib.request.urlopen(f"{GAMEDATA}/{branch}/gamedata/{path}"))
    json.dump(d, open(fn, "w", encoding="utf-8"))
    return d


def flat_db(db):
    out = {}
    for e in db.get("enemies", []):
        v = e.get("Value") or []
        if v:
            out[e["Key"]] = v[-1].get("enemyData", {})
    return out


def map_id(level_id):
    """Activities/ACT1AUTOCHESS/level_act1autochess_h07_01_S → h07_01_s"""
    tail = level_id.split("/")[-1].lower()
    for pre in ("level_act1autochess_", "level_act2autochess_"):
        if tail.startswith(pre):
            return tail[len(pre):]
    return tail


def crop_doc(doc, c0, r1_row, w, h, H):
    """격자와 경로를 잘라낸 상자에 맞춘다. r1_row = 남길 마지막 g행."""
    r0 = r1_row - h + 1
    doc["g"] = [row[c0:c0 + w] for row in doc["g"][r0:r1_row + 1]]
    doc["w"], doc["h"] = w, h
    dy = H - 1 - r1_row                      # g행 기준 아래쪽에서 잘라낸 줄 수
    doc["r"] = [None if p is None else [[x - c0, y - dy] for x, y in p] for p in doc["r"]]
    return doc


def main():
    act = json.load(open(os.path.join(REPO, ".gamedata", "kr_activity_table.json"),
                         encoding="utf-8"))["activity"]["AUTOCHESS_SEASON"][ACT]
    enemy_db = flat_db(fetch("levels/enemydata/enemy_database.json"))

    # ── 라운드 → 레벨 (모드 전체를 훑어 단독/협동 변형을 함께 모은다) ──
    lv_of = {}          # mapId → levelId(원본 경로)
    fixed = {}          # 라운드 → mapId (R1~R13 공통)
    leaders = {}        # bossId → {"s": 단독, "c": 협동}
    train = {}          # 라운드 → mapId (입문 협의)
    for mode, rounds in act["battleDataDict"].items():
        for rnd, arr in rounds.items():
            for e in arr:
                lid, mid = e["levelId"], map_id(e["levelId"])
                lv_of[mid] = lid
                if mode == "mode_training_1":
                    train[int(rnd)] = mid
                elif e.get("bossId"):
                    slot = "s" if mid.endswith("_s") else "c"
                    leaders.setdefault(e["bossId"], {})[slot] = mid
                else:
                    prev = fixed.setdefault(int(rnd), mid)
                    if prev != mid:
                        sys.exit(f"라운드 {rnd}에 맵이 둘: {prev} vs {mid} — 구조가 바뀌었다")

    # ── 경로 추출 ──
    docs = {}
    for mid, lid in sorted(lv_of.items()):
        path = "levels/" + lid.lower() + ".json"
        doc = routes_of_level(fetch(path), enemy_db)
        if not doc:
            sys.exit(f"경로 문서를 못 만들었다: {lid}")
        docs[mid] = doc

    # ── 전장은 하나 — 확인하고, 위·아래 구획으로 갈라 맵마다 자기 구획만 자른다 ──
    grids = {tuple(d["g"]) for d in docs.values()}
    if len(grids) != 1:
        sys.exit(f"전장이 하나가 아니다({len(grids)}가지) — 구획 나누기 전제가 깨졌다")
    g0 = docs[next(iter(docs))]["g"]
    H, W = len(g0), len(g0[0])
    bands, cur = [], None                      # 전부 'x' 인 행이 구획을 끊는다
    for i, row in enumerate(g0):
        if set(row) == {"x"}:
            if cur:
                bands.append(cur); cur = None
        else:
            cur = (cur[0], i) if cur else (i, i)
    if cur:
        bands.append(cur)
    if len(bands) != 2:
        sys.exit(f"구획이 2개가 아니다({len(bands)}개): {bands} — 전장 구조가 바뀌었다")
    cols = [c for row in g0 for c, ch in enumerate(row) if ch != "x"]
    c0, c1 = min(cols), max(cols)
    w = c1 - c0 + 1
    band_of = {}
    for mid, doc in docs.items():
        rows = {H - 1 - y for poly in doc["r"] for _x, y in poly or []}
        hit = [b for b in bands if rows <= set(range(b[0], b[1] + 1))]
        if len(hit) != 1:
            sys.exit(f"{mid}: 경로가 한 구획에 안 담긴다 (구획 {bands}, 경로 행 {sorted(rows)})")
        r0, r1 = hit[0]
        if not all(c0 <= x <= c1 for poly in doc["r"] for x, _y in poly or []):
            sys.exit(f"{mid}: 경로 열이 잘라낼 폭 밖이다")
        crop_doc(doc, c0, r1, w, r1 - r0 + 1, H)
        band_of[mid] = bands.index(hit[0])
        doc["band"] = band_of[mid]
    cnt = [sum(1 for v in band_of.values() if v == i) for i in range(2)]
    print(f"  전장 1개 · 구획 {bands} → 맵마다 자기 구획만: "
          f"{W}x{H} → {w}x{bands[0][1]-bands[0][0]+1} (위 {cnt[0]}개) · "
          f"{w}x{bands[1][1]-bands[1][0]+1} (아래 {cnt[1]}개)")

    # ── 적 도감이 못 푸는 적만 이름표를 싣는다 ──
    known = set(json.load(open(os.path.join(DATA, "enemy-names.json"), encoding="utf-8"))["ids"])
    used = sorted({k for doc in docs.values() for k in doc["e"]})
    books = {loc: fetch_handbook(br) for loc, br in LOCS}
    nm = {}
    for eid in used:
        if eid in known:
            continue
        nm[eid] = [(books[loc].get(eid) or {}).get("name") or eid for loc, _ in LOCS]

    out = {
        "bands": [[b[0], b[1]] for b in bands],
        "maps": docs,
        "rounds": [{"r": r, "m": fixed[r]} for r in sorted(fixed)],
        "leaders": leaders,
        "train": [{"r": r, "m": train[r]} for r in sorted(train)],
        "nm": nm,
    }
    # ── 검증 — 구조가 바뀌면 조용히 틀린 걸 내보내는 대신 여기서 선다 ──
    rs = [x["r"] for x in out["rounds"]]
    if rs != list(range(1, len(rs) + 1)):
        sys.exit(f"고정 라운드가 이어지지 않는다: {rs}")
    for bid, v in leaders.items():
        if not v.get("s") or not v.get("c"):
            sys.exit(f"{bid}: 단독/협동 맵이 짝을 못 이룬다 {v}")
    for mid in [x["m"] for x in out["rounds"]] + [x["m"] for x in out["train"]] \
            + [m for v in leaders.values() for m in v.values()]:
        if mid not in docs:
            sys.exit(f"참조된 맵이 없다: {mid}")

    fn = os.path.join(DATA, "autochess-routes.json")
    json.dump(out, open(fn, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(fn) // 1024
    print(f"  app/data/autochess-routes.json  {kb}KB")
    print(f"  맵 {len(docs)} (고정 {len(out['rounds'])} · 리더 {len(leaders)}종 x2 · 입문 {len(set(train.values()))})"
          f" · 적 {len(used)}종 (이름표 보충 {len(nm)})")


def fetch_handbook(branch):
    fn = os.path.join(REPO, ".gamedata", f"{branch}_enemy_handbook_table.json")
    if os.path.exists(fn):
        return json.load(open(fn, encoding="utf-8")).get("enemyData", {})
    return fetch("excel/enemy_handbook_table.json", branch).get("enemyData", {})


if __name__ == "__main__":
    main()
