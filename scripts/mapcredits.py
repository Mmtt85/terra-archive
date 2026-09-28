#!/usr/bin/env python3
"""작전 도면 출처 — scripts/stage-map-credits.json → 작전 레코드의 mc (사용자 지시 2026-09-28 "넣고 출처표기해줘").

public/stage/<stageId>.webp 는 대부분 게임이 준 미리보기(512²)지만, 게임에 미리보기가 없는 작전은
팬 위키의 그림을 받아 쓴다 (build-stages.py 폴백 2, 2026-08-10). 그 그림은 위키의 라이선스를 따르므로
**출처를 적어야 한다** — 작전 상세의 도면 밑에 한 줄로 낸다 (app/stage-detail.tsx).

  PRTS (prts.wiki — 중국 팬 위키, 공식 아님)          CC BY-NC-SA 4.0
  Arknights Terra Wiki (arknights.wiki.gg — 영어 팬 위키)  CC BY-SA 4.0
  (두 라이선스 모두 2026-09-28 각 위키 api.php siteinfo rightsinfo 로 확인)

그림 파일에는 어디서 왔는지가 남지 않는다 — **이 목록(scripts/stage-map-credits.json)이 유일한 기록이다.**
지우지 말 것.
  { stageId: [원천, 위키 파일 이름] }  또는  [원천, 파일, 1]  (1 = 잘라내는 등 손댄 그림)
  원천: "p" PRTS · "w" wiki.gg
화면에는 attach() 가 같은 값을 작전 레코드(stages*.json)의 `mc` 로 붙여 보낸다 — 작전 상세는 첫 화면 번들에
실리는 코드라(app/stage-detail.tsx 머리주석) 목록 파일을 따로 임포트하지 않는다. 카메라(stagecams.py)와 같은 짜임.

누가 쓰나:
  · build-stages.py — 위키 폴백으로 새로 받을 때마다 record() 로 적고, MANUAL 작전은 격자 렌더
    **앞에서** fetch_manual() 로 받는다 (그림이 없을 때만).
  · build-stages.py — 저장 직전에 attach() 로 레코드에 mc 를 붙인다 (--no-images 인 CI 에서도).
  · 이 스크립트 직접 실행:
      python3 scripts/mapcredits.py --scan     # 기록 없이 들어와 있는 위키 그림을 위키 원본과 대조해 붙인다
      python3 scripts/mapcredits.py --manual   # MANUAL 그림을 PRTS 에서 다시 받아 덮어쓴다
      python3 scripts/mapcredits.py --attach   # 커밋된 stages*.json 에 mc 를 제자리로 붙인다

⚠ 그림을 바꾸면(파일 이름 그대로) app/dex-paths.ts 의 MAP_VER 를 올려야 방문자 브라우저의 30일 캐시를
  넘는다. 그리고 **R2 동기화 전에 dev 에서 새 키로 열지 말 것** — 옛 그림이 새 키로 브라우저에 박힌다.
"""
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREDITS = os.path.join(REPO, "scripts", "stage-map-credits.json")
DATA = os.path.join(REPO, "app", "data")
STAGE_DIR = os.path.join(REPO, "public", "stage")
UA = {"User-Agent": "terra-archive-fetch (fansite; contact contact@terra-archive.net)"}
PRTS_API = "https://prts.wiki/api.php"
WGG_API = "https://arknights.wiki.gg/api.php"

# 게임에 미리보기가 **없는** 판을 위키 스크린샷으로 손수 잇는다 (사용자 지시 2026-09-28).
# 위수 협의 첫 시즌(act1vautochess)은 작전 선택 화면을 안 쓰는 모드라 게임 파일(cn·en 미러 포함)에 미리보기가
# 아예 없고 — PRTS 도 그림에 "游戏内未提供原生地图，截图仅供参考"(게임에 원본 지도가 없어 참고용 캡처)라고 적었다 —
# 그래서 종전엔 레벨 격자 렌더가 들어가 있었다.
# PRTS 파일 이름(战场00~04)은 우리 id(m01~m05)와 이름으로 이어지지 않는다. 짝은 레벨 격자에서 **판마다 하나뿐인
# 표식**을 스크린샷과 대조해 정했다 (2026-09-28):
#   m01 줄 사이 연결 없음 · m02 세로 통로 둘 사이 구멍이 가운데 줄부터 아래 줄까지 · m03 가운데 줄이 배치 불가
#   격자 바닥이고 그 밑에 발판 줄 · m04 가운데 줄 한가운데가 끊기고 양옆 통로로 윗줄과 이어짐 ·
#   m05 윗줄 한가운데가 끊기고(기계 상자) 양옆에 배치 불가 × 칸
# crop: 640px 썸네일 기준 (left, top, right, bottom). 아래 안내문(342~352행)을 자르고, 16:9 를 지키려고
#   폭도 36px 뺀다 (604×340) — 작전 상세는 도면을 16:9 로 펴서 보이므로 비율이 어긋나면 늘어난다.
#   폭은 **왼쪽**(헬기장 장식)에서 뺀다 — 오른쪽을 자르면 게임 UI 문구 "剩余可放置角色：9"(남은 배치 인원)가
#   숫자 앞에서 끊긴다 (좌우 18px 씩 잘랐다가 확인하고 바꿈).
MANUAL = {
    "act1vautochess_m01": ("p", "卫戍协议_战场00_地图.png", (36, 0, 640, 340)),
    "act1vautochess_m02": ("p", "卫戍协议_战场01_地图.png", (36, 0, 640, 340)),
    "act1vautochess_m03": ("p", "卫戍协议_战场02_地图.png", (36, 0, 640, 340)),
    "act1vautochess_m04": ("p", "卫戍协议_战场03_地图.png", (36, 0, 640, 340)),
    "act1vautochess_m05": ("p", "卫戍协议_战场04_地图.png", (36, 0, 640, 340)),
}


def load():
    try:
        with open(CREDITS, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save(credits):
    with open(CREDITS, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(credits.items())), f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


def record(sid, src, name, edited=False):
    """위키에서 받은 그림 하나를 목록에 적는다 (파일에 바로 쓴다 — 받는 쪽이 여러 번 불러도 된다)."""
    credits = load()
    credits[sid] = [src, name, 1] if edited else [src, name]
    save(credits)


def attach(doc, credits=None):
    """작전 문서(stages*.json 구조)의 레코드에 mc 를 붙이고, 기록에 없는 레코드의 mc 는 뗀다. 붙인 수를 돌려준다."""
    credits = load() if credits is None else credits
    n = 0
    for e in doc["stages"]:
        c = credits.get(e["id"])
        if c:
            e["mc"] = c
            n += 1
        else:
            e.pop("mc", None)
    return n


def attach_committed():
    credits = load()
    for suf in ("", ".en", ".ja"):
        p = os.path.join(DATA, f"stages{suf}.json")
        with open(p, encoding="utf-8") as f:
            doc = json.load(f)
        n = attach(doc, credits)
        # build-stages.py 와 같은 모양으로 쓴다 — 공백 없이·줄바꿈 없이 (다르면 diff 가 통째로 난다)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  stages{suf}.json: 도면 출처 {n}개")


def _get(url, timeout=30, tries=3):
    # ⚠ media.prts.wiki 는 IP 라운드로빈 중 일부가 이 망에서 SYN 조차 안 잡힌다 (build-stages.py 주석, 2026-08-10) —
    #   짧게 끊고 다시 뽑는 쪽이 빠르다.
    last = None
    for _ in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()
        except Exception as err:  # noqa: BLE001
            last = err
            time.sleep(1)
    raise last


def _api(base, **params):
    params.setdefault("format", "json")
    return json.loads(_get(f"{base}?{urllib.parse.urlencode(params)}", timeout=60))


def _thumbs(base, files, width):
    """위키 파일 이름들 → {이름: 썸네일 URL} (없는 파일은 빠진다). 50개씩 묶어 묻는다."""
    out = {}
    for i in range(0, len(files), 50):
        chunk = files[i:i + 50]
        d = _api(base, action="query", titles="|".join("File:" + f for f in chunk),
                 prop="imageinfo", iiprop="url", iiurlwidth=str(width))
        back = {n["to"]: n["from"] for n in d["query"].get("normalized", [])}
        for p in d["query"]["pages"].values():
            if "imageinfo" not in p:
                continue
            title = back.get(p["title"], p["title"])
            name = title.split(":", 1)[1]
            ii = p["imageinfo"][0]
            out[name] = ii.get("thumburl") or ii["url"]
    return out


def fetch_manual(dest_dir=STAGE_DIR, only_missing=True):
    """MANUAL 그림을 PRTS 에서 받아 잘라 저장하고 출처를 적는다. 저장한 stageId 목록을 돌려준다."""
    from PIL import Image
    todo = {sid: v for sid, v in MANUAL.items()
            if not (only_missing and os.path.exists(os.path.join(dest_dir, sid + ".webp")))}
    if not todo:
        return []
    urls = _thumbs(PRTS_API, sorted({v[1] for v in todo.values()}), 640)
    done = []
    for sid, (src, name, crop) in todo.items():
        url = urls.get(name)
        if not url:
            print(f"  ⚠ {sid}: PRTS 에 {name} 이 없다 — 건너뜀")
            continue
        im = Image.open(io.BytesIO(_get(url, timeout=120))).convert("RGB")
        if im.width != 640:
            im = im.resize((640, round(im.height * 640 / im.width)), Image.LANCZOS)
        im.crop(crop).save(os.path.join(dest_dir, sid + ".webp"), "WEBP", quality=82, method=4)
        record(sid, src, name, edited=True)
        done.append(sid)
    return done


def _sig(img_bytes_or_path):
    """대조용 지문 — 흑백 64×36 으로 줄인 픽셀 (비율이 달라도 같은 그림이면 같게 눌린다)."""
    from PIL import Image
    im = Image.open(io.BytesIO(img_bytes_or_path) if isinstance(img_bytes_or_path, bytes) else img_bytes_or_path)
    return list(im.convert("L").resize((64, 36), Image.BILINEAR).getdata())


def _diff(a, b):
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def scan(recheck=False):
    """기록 없이 들어와 있는 위키 그림(512² 미리보기도 격자 렌더도 아닌 사진)을 위키 원본과 대조해 적는다.

    빌드가 위키 그림을 받은 순서(build-stages.py 폴백 2)를 그대로 따른다: wiki.gg '<코드>_map.png'·'_map_1.png'
    → PRTS '<코드>_<CN 이름>' 접두의 地图(WAVE1 우선). 이름만 믿지 않고 **그림을 대조해** 맞을 때만 적는다
    (같은 코드가 시즌마다 되풀이되면 이름이 같아도 다른 판일 수 있다)."""
    from PIL import Image
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    gd = os.environ.get("GAMEDATA_DIR", os.path.join(REPO, ".gamedata"))
    kr = json.load(open(os.path.join(gd, "kr_stage_table.json"), encoding="utf-8"))["stages"]
    cn = json.load(open(os.path.join(gd, "cn_stage_table.json"), encoding="utf-8"))["stages"]
    credits = load()
    cands = []
    for f in sorted(os.listdir(STAGE_DIR)):
        if not f.endswith(".webp"):
            continue
        sid = f[:-5]
        if sid in MANUAL or (sid in credits and not recheck):
            continue
        path = os.path.join(STAGE_DIR, f)
        im = Image.open(path)
        if im.size == (512, 512) or max(im.size) != 640:
            continue                                   # 게임 미리보기 · 격자 렌더(크기가 제각각)
        cols = im.convert("RGB").getcolors(1 << 20)
        if cols is not None and len(cols) < 6000:
            continue                                   # 색이 몇 안 되면 격자 렌더다
        v = kr.get(sid) or cn.get(sid) or {}
        code = (v.get("code") or "").strip()
        if code:
            cands.append({"id": sid, "code": code, "cn": ((cn.get(sid) or {}).get("name") or "").strip(),
                          "sig": _sig(path)})
    print(f"대조할 위키 그림: {len(cands)}장")
    if not cands:
        return

    # ① wiki.gg — 이름으로 한 번에 묻고, 있는 것만 썸네일을 받아 대조
    names = sorted({c["code"] + s for c in cands for s in ("_map.png", "_map_1.png")})
    wgg = _thumbs(WGG_API, names, 160)
    # 0~255 평균 차. 2026-09-28 실측: 같은 그림(우리 파일 ↔ 위키 원본) 0.3~1.1 · 서로 다른 판끼리 가장 가까운 쌍
    # 12.9(중앙값 25.6 — 보스러시 일반·EX처럼 지도를 같이 쓰는 판은 0.0 이라 뺀 값). 둘 사이 넉넉한 곳에 둔다.
    TH = 6.0

    def try_wgg(c):
        best = None
        for s in ("_map.png", "_map_1.png"):
            name = c["code"] + s
            if name in wgg:
                try:
                    d = _diff(c["sig"], _sig(_get(wgg[name])))
                except Exception:  # noqa: BLE001
                    continue
                if best is None or d < best[2]:
                    best = ("w", name, d)
        return best

    with ThreadPoolExecutor(6) as ex:
        got = dict(zip([c["id"] for c in cands], ex.map(try_wgg, cands)))

    # ② PRTS — 남은 것만, 빌드와 같은 접두 검색
    def try_prts(c):
        if not c["cn"]:
            return None
        try:
            imgs = _api(PRTS_API, action="query", list="allimages", aiprefix=f"{c['code']}_{c['cn']}",
                        ailimit="50").get("query", {}).get("allimages", [])
        except Exception:  # noqa: BLE001
            return None
        maps = sorted((i["name"] for i in imgs if "地图" in i["name"]), key=lambda n: ("WAVE1" not in n, n))
        if not maps:
            return None
        try:
            th = _thumbs(PRTS_API, maps, 160)
        except Exception:  # noqa: BLE001
            return None
        best = None
        for name in maps:
            if name not in th:
                continue
            try:
                d = _diff(c["sig"], _sig(_get(th[name], timeout=40)))
            except Exception:  # noqa: BLE001
                continue
            if best is None or d < best[2]:
                best = ("p", name, d)
        return best

    # 대조 점수는 버리지 않고 모은다 — 기준값(TH)이 맞는지 분포로 확인하려고
    near = {sid: r for sid, r in got.items() if r}
    got = {sid: (r if r and r[2] < TH else None) for sid, r in got.items()}
    rest = [c for c in cands if not got[c["id"]]]
    with ThreadPoolExecutor(4) as ex:
        for c, r in zip(rest, ex.map(try_prts, rest)):
            if r:
                near.setdefault(c["id"], r)
                if r[2] < near[c["id"]][2]:
                    near[c["id"]] = r
            got[c["id"]] = r if r and r[2] < TH else None
    ds = sorted(r[2] for r in near.values())
    print("대조 차이 분포:", [round(d, 1) for d in ds])

    credits = load()
    miss = []
    for sid, r in got.items():
        if r:
            credits[sid] = [r[0], r[1]]
        else:
            miss.append(sid)
    save(credits)
    w = sum(1 for r in got.values() if r and r[0] == "w")
    p = sum(1 for r in got.values() if r and r[0] == "p")
    worst = max((r[2] for r in got.values() if r), default=0)
    print(f"출처 기록: wiki.gg {w} · PRTS {p} (대조 차이 최대 {worst:.1f}) · 못 찾음 {len(miss)}")
    if miss:
        print("  ⚠ 못 찾음:", miss)


if __name__ == "__main__":
    if "--manual" in sys.argv:
        print("MANUAL:", fetch_manual(only_missing=False))
    if "--scan" in sys.argv or "--recheck" in sys.argv:
        scan(recheck="--recheck" in sys.argv)
    if "--attach" in sys.argv:
        attach_committed()
    if not any(a in sys.argv for a in ("--manual", "--scan", "--recheck", "--attach")):
        print(__doc__)
