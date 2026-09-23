#!/usr/bin/env python3
"""작전 도감 — 실사 도면 위에 경로를 투영할 **전투 카메라 위치(cam)** 를 작전 레코드에 붙인다.

실사 도면(arts/ui/stage/mappreviews/<stageId>.png, 512²)은 전투 카메라로 찍은 16:9 화면을
정사각형에 눌러 담은 그림이다 — 근거와 검증은 app/stage-cam.ts 머리주석. 카메라의 기울기(30°)와
화각(세로 반각 20°)은 공통이고 **위치만 레벨마다 다르다.** 그 위치를 여기서 붙인다.

## 카메라 위치는 어디서 오나 (2026-09-23 조사)

- 레벨 파일(levels/…json, FlatBuffers 스키마 포함)에는 **없다.**
- 맵 크기로 계산되지도 않는다 — 같은 11×7 맵도 레벨마다 다르다.
- 맵 씬 번들(scenes/<levelId>/<name>.ab)의 `_mapSettings` 에 `cameraView`(프리셋 번호)·
  `highlandHeight`(고지대 높이, 0-1은 0.2)가 있다. 하지만 **프리셋 번호만으로 정해지지 않는다**
  (12-6·13-8 둘 다 3번인데 13-8이 시선 방향으로 1칸 물러나 있다) — 나머지는 게임 코드 몫이다.
- 그 코드를 역공학해 레벨별 값을 뽑아 둔 것이 **yuanyan3060/ArknightsGameResource 의
  levels.json** 이다 (중섭 클라 자동 언팩, 매일 갱신). MAA 도 이 파일을 그대로 받아 쓴다
  (MAA .github/workflows/res-update-game.yml). 우리도 같은 파일을 쓴다.
  출처 표기 요청(작성자 README): https://github.com/yuanyan3060/Arknights-Tile-Pos (MIT)

## 어떤 작전에 붙나

도면이 **512×512 인게임 미리보기**인 작전만 (public/stage 2,241장 중 1,725장). 위키 스크린샷
(640×360 등)과 레벨 격자 렌더는 같은 카메라로 찍힌 그림이 아니라 투영이 맞지 않는다.
고난판(tough_*)은 일반판 도면을 복사해 쓰므로(build-stages.py 폴백 0) 일반판 카메라를 쓴다.

사용:
  python3 scripts/stagecams.py        # 커밋된 stages*.json · stages-rogue*.json 에 제자리로 붙인다
  import stagecams; stagecams.attach(doc, img_dir, level_of)   # build-stages*.py 가 저장 직전에
"""
import json
import os
import sys
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "app", "data")
UPSTREAM = "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/levels.json"
# 72MB 원본에서 쓰는 조각만 남긴 캐시 — {"s": {stageId: view0}, "l": {levelId: view0}}
CACHE = os.path.join(REPO, ".gamedata", "stage-views.json")
MAX_AGE = 12 * 3600          # 매일 갱신되는 원본이라 반나절이면 충분히 새롭다

_views = None


def views(refresh=False):
    """stageId·levelId → 카메라 위치(view[0]). 원본을 못 받으면 옛 캐시, 그것도 없으면 None."""
    global _views
    if _views is not None and not refresh:
        return _views
    fresh = os.path.exists(CACHE) and time.time() - os.path.getmtime(CACHE) < MAX_AGE
    if refresh or not fresh:
        try:
            req = urllib.request.Request(UPSTREAM, headers={"User-Agent": "terra-archive-script/1.0"})
            rows = json.loads(urllib.request.urlopen(req, timeout=180).read())
            r3 = lambda v: [round(float(x), 3) + 0.0 for x in v]   # +0.0: -0.0 → 0.0
            slim = {"s": {}, "l": {}}
            for e in rows:
                v = r3(e["view"][0])
                slim["s"][e["stageId"]] = v
                slim["l"].setdefault(e["levelId"].lower(), v)
            os.makedirs(os.path.dirname(CACHE), exist_ok=True)
            json.dump(slim, open(CACHE, "w", encoding="utf-8"), separators=(",", ":"))
            print(f"카메라: 원본 {len(rows)}레벨 받음")
        except Exception as err:
            print(f"  ⚠ 카메라 원본을 못 받았다 ({str(err)[:80]}) — 옛 캐시로 간다")
    if not os.path.exists(CACHE):
        return None
    _views = json.load(open(CACHE, encoding="utf-8"))
    return _views


def is_preview(path):
    """인게임 미리보기(512×512)인가 — 위키 스크린샷·격자 렌더는 크기가 다르다."""
    try:
        from PIL import Image
        with Image.open(path) as im:
            return im.size == (512, 512)
    except Exception:
        return False


def cam_for(sid, img_dir, level_of=None):
    """작전 하나의 카메라 위치 — 인게임 미리보기가 아니거나 값을 못 찾으면 None."""
    v = views()
    img = os.path.join(img_dir, sid + ".webp")
    if not v or not is_preview(img):
        return None
    # 고난판 도면은 대개 일반판 복사본(build-stages.py 폴백 0)이라 **그림의 주인(일반판) 카메라**가
    # 정답이다. 단 자기 미리보기를 가진 고난판도 18개 있고, 그중 tough_12-17 은 카메라가 일반판과
    # 다르다(−6.6/−10.63 vs −5.6/−8.9) — 그래서 파일이 실제로 같을 때만 일반판 것을 쓴다.
    cands = [sid]
    if sid.startswith("tough_"):
        twin = os.path.join(img_dir, sid.replace("tough_", "main_", 1) + ".webp")
        if os.path.exists(twin) and open(twin, "rb").read() == open(img, "rb").read():
            cands = [sid.replace("tough_", "main_", 1), sid]
    for c in cands:
        if c in v["s"]:
            return v["s"][c]
    lv = (level_of or {}).get(sid)
    return v["l"].get(lv.lower()) if lv else None


def attach(doc, img_dir, level_of=None, keep=None):
    """doc["stages"] 레코드마다 cam 을 붙인다(없으면 뗀다). 붙은 수를 돌려준다.
    keep: 원본을 아예 못 받았을 때 종전 값을 지키려고 넘기는 {stageId: cam} (선택)."""
    if views() is None and keep is not None:
        for e in doc["stages"]:
            if e["id"] in keep:
                e["cam"] = keep[e["id"]]
        return sum(1 for e in doc["stages"] if "cam" in e)
    n = 0
    for e in doc["stages"]:
        cam = cam_for(e["id"], img_dir, level_of)
        if cam:
            e["cam"] = cam
            n += 1
        else:
            e.pop("cam", None)
    return n


def _level_index():
    """stageId → levelId (한섭 표) — stageId 로 못 찾을 때 레벨로 한 번 더 찾는다."""
    p = os.path.join(REPO, ".gamedata", "kr_stage_table.json")
    if not os.path.exists(p):
        return {}
    return {k: v.get("levelId") for k, v in json.load(open(p, encoding="utf-8"))["stages"].items() if v.get("levelId")}


def main():
    level_of = _level_index()
    targets = [("stages", os.path.join(REPO, "public", "stage")),
               ("stages-rogue", os.path.join(REPO, "public", "rogue", "map"))]
    for base, img_dir in targets:
        for suf in ("", ".en", ".ja"):
            p = os.path.join(DATA, f"{base}{suf}.json")
            if not os.path.exists(p):
                continue
            doc = json.load(open(p, encoding="utf-8"))
            keep = {e["id"]: e["cam"] for e in doc["stages"] if "cam" in e}
            n = attach(doc, img_dir, level_of, keep)
            json.dump(doc, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
            print(f"  {base}{suf}.json: 카메라 {n}/{len(doc['stages'])}")


if __name__ == "__main__":
    main()
    sys.exit(0)
