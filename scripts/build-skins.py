#!/usr/bin/env python3
"""스킨 메타데이터 + 스킨 포트레이트(반신 초상)를 받아온다.

Usage: python3 scripts/build-skins.py [gamedata-dir]   # default: .gamedata

메타: 클뜯 `skin_table.json`의 charSkins — 스킨명·시리즈·일러스트레이터·설명문·
전용 대사·획득처. KR을 정본으로 쓰고 EN/JP 테이블에서 같은 스킨 키의 표시 문자열을
덮어써 3개 언어를 만든다 (없으면 KR 폴백).

이미지 두 종류 (같은 미러, 파일명 규칙만 다르다):
  · 반신 초상  portrait/<portraitId>.png       → 목록·기본 표시 (180×360)
  · 전체 일러  skin/<portraitId>**b**.png      → 클릭 확대용 (원본 2500px·5~8MB를 1200px로)

출력:
  public/skins/<locale>/<charId>.json     — 오퍼당 스킨 목록 (프로필과 같은 지연 로딩 방식)
  public/skin/portrait/<portraitId>.webp  — 반신 초상
  public/skin/full/<portraitId>.webp      — 전체 일러스트
전부 R2 서빙: node scripts/r2-sync.mjs

⚠ 이미지(public/skin/)는 .gitignore 대상이다 (~296MB, 2026-07-28 사용자 확정) — 새 클론에서
필요하면 이 스크립트를 다시 돌리면 된다(멱등: 이미 있는 파일은 건너뛴다). 메타 JSON은 커밋된다.
"""
import concurrent.futures as cf
import json
import os
import shutil
import sys
import re
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imgutil import save_webp  # noqa: E402

ONLY_META = "--meta-only" in sys.argv
positional = [a for a in sys.argv[1:] if not a.startswith("-")]
S = positional[0] if positional else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META_ROOT = f"{REPO}/public/skins"
PORTRAIT_DIR = f"{REPO}/public/skin/portrait"   # 반신 초상 180×360 — 목록·기본 표시
FULL_DIR = f"{REPO}/public/skin/full"           # 전체 일러스트(긴 변 1200px) — 클릭 확대용
# 포트레이트 미러 — 앞의 것을 먼저 쓰고 404면 다음으로. 2번째(ArknightsAssets2)는
# yuanyan 미러가 아직 안 받은 신규 이격(플라멘타·첸3 등)을 메워 준다 (실측 2026-07-28).
SRCS = [
    "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/portrait",
    "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn/arts/charportraits",
]
# 전체 일러스트 — 같은 미러의 skin/ 폴더, 파일명이 **portraitId + "b"**다
# (char_1035_wisdel_2b.png). 원본은 2500px·5~8MB라 긴 변 1200px로 줄여 받는다
# (실측 표본 21장 평균 161KB → 1,265종 ≈ 199MB).
FULL_SRCS = ["https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/skin"]
FULL_MAX_PX = 1200

load = lambda p: json.load(open(p, encoding="utf-8"))
ops = {o["id"] for o in load(f"{REPO}/app/data/operators.json")}
LOCALES = {"ko": "kr", "en": "en", "ja": "jp"}


def skins_of(path):
    if not os.path.exists(path):
        return {}
    return load(path).get("charSkins", {})


kr = skins_of(f"{S}/kr_skin_table.json")
if not kr:
    sys.exit(f"{S}/kr_skin_table.json 없음 — python3 scripts/fetch-gamedata.py 먼저")
loc_tables = {loc: skins_of(f"{S}/{p}_skin_table.json") for loc, p in LOCALES.items()}


def clean(s):
    """게임 텍스트 태그 제거 — <color name=#ffffff>…</color>가 그대로 새어 나왔다 (2026-07-28)."""
    if not s:
        return ""
    s = re.sub(r"<[@$/][^>]*>", "", s).replace("</>", "")
    s = re.sub(r"</?[a-zA-Z][^>]*>", "", s)
    return s.replace("\\n", "\n").strip()


# 기본 복장(skinName 없음)은 전부 이름이 "기본 복장"이라 탭에서 구분이 안 된다
# (사용자 지적 2026-07-28). skinGroupId가 정예화 단계를 알려 주므로 그걸로 가른다.
# ⚠ ILLUST_0은 정예화 0·1이 함께 쓰는 기본 일러다 (게임 실측: 보유 420명 전원 ILLUST_0,
# 그중 377명이 ILLUST_2를 따로 가짐. ILLUST_1은 단 1건). 그래서 ILLUST_0을 "1정 일러"로
# 적으면 틀린 표기가 된다 — "기본 일러"로 두되 두 탭 모두 꼬리표가 붙게 한다.
ILLUST_STAGE = {"ILLUST_0": "기본 일러", "ILLUST_1": "1정 일러", "ILLUST_2": "2정 일러", "ILLUST_3": "3정 일러"}


def entry(skin_id, base, localized):
    """표시 문자열은 로케일 테이블 우선, 없으면 KR 폴백. 구조 필드는 KR 정본."""
    d = (localized or base).get("displaySkin") or {}
    kd = base.get("displaySkin") or {}
    pick = lambda k: d.get(k) or kd.get(k)
    return {
        "id": skin_id,
        # 기본 복장·정예화2 일러는 skinName이 없다 — 시리즈명(기본 복장 등)으로 대신 표시
        "name": clean(pick("skinName")) or clean(pick("skinGroupName")) or "",
        # 기본 복장 탭 구분용 꼬리표 ("1정 일러"/"2정 일러") — UI가 이름 뒤에 붙인다
        "stage": ILLUST_STAGE.get(kd.get("skinGroupId") or "", ""),
        "group": clean(pick("skinGroupName")),
        "artists": kd.get("drawerList") or [],
        "content": clean(pick("content")),
        "usage": clean(pick("usage")),
        "quote": clean(pick("description")),
        "obtain": clean(pick("obtainApproach")),
        "portrait": base.get("portraitId") or "",
        "sort": kd.get("sortId") or 0,
        # 기본 복장 여부 — UI가 유료/이벤트 스킨과 가르는 데 쓴다
        "default": not bool(kd.get("skinName")),
    }


by_char = {}
for skin_id, base in kr.items():
    cid = base.get("charId")
    if cid not in ops:
        continue
    by_char.setdefault(cid, []).append((skin_id, base))

written = 0
for loc in LOCALES:
    out_dir = f"{META_ROOT}/{loc}"
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir, exist_ok=True)
    table = loc_tables[loc]
    for cid, entries in by_char.items():
        items = [entry(sid, base, table.get(sid)) for sid, base in entries]
        items.sort(key=lambda x: x["sort"])
        with open(f"{out_dir}/{cid}.json", "w", encoding="utf-8") as f:
            json.dump({"id": cid, "skins": items}, f, ensure_ascii=False, separators=(",", ":"))
        written += 1
print(f"skins 메타: {written}개 파일 ({len(by_char)}명 × {len(LOCALES)}로케일)"
      f" · 스킨 {sum(len(v) for v in by_char.values())}종")

if ONLY_META:
    sys.exit(0)

# ── 이미지 다운로드 ─────────────────────────────────────────────────────────
os.makedirs(PORTRAIT_DIR, exist_ok=True)
os.makedirs(FULL_DIR, exist_ok=True)
portraits = sorted({base.get("portraitId") for _, entries in by_char.items()
                    for _, base in entries if base.get("portraitId")})


def dl(job):
    kind, pid = job
    full = kind == "full"
    dest = f"{(FULL_DIR if full else PORTRAIT_DIR)}/{pid}.webp"
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return ("skip", pid)
    data = None
    errs = []
    for src in (FULL_SRCS if full else SRCS):
        name = f"{pid}b" if full else pid
        url = f"{src}/{urllib.parse.quote(name, safe='')}.png"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "terra-archive"})
            body = urllib.request.urlopen(req, timeout=60).read()
        except Exception as err:  # noqa: BLE001
            errs.append(str(err))
            continue
        if len(body) >= 500:
            data = body
            break
        errs.append(f"too small ({len(body)}B)")
    if data is None:
        return ("fail", f"{'full' if full else 'portrait'} {pid}: {' / '.join(errs)}")
    # method=4 + 무손실 생략 — 실측 6~15초/장 → 0.05초/장이고 결과 크기는 사실상 동일
    # (imgutil.save_webp 주석 참고). 2,500장이라 기본값이면 몇 시간이 걸린다.
    save_webp(data, dest, method=4, try_lossless=False,
              max_px=FULL_MAX_PX if full else None)
    return ("ok", pid)


def run(kind, jobs):
    done = {"ok": 0, "skip": 0, "fail": 0}
    fails = []
    with cf.ThreadPoolExecutor(12) as ex:
        for i, (status, info) in enumerate(ex.map(dl, [(kind, p) for p in jobs]), 1):
            done[status] += 1
            if status == "fail":
                fails.append(info)
            if i % 200 == 0:
                print(f"  {kind} … {i}/{len(jobs)} (받음 {done['ok']} · 기존 {done['skip']} · 실패 {done['fail']})",
                      flush=True)
    return done, fails


def dir_size(d):
    return sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d))


all_fails = []
for kind, label, d in (("portrait", "반신 초상", PORTRAIT_DIR), ("full", "전체 일러", FULL_DIR)):
    done, fails = run(kind, portraits)
    all_fails += fails
    print(f"{label} {len(portraits)}종 → 신규 {done['ok']} · 기존 {done['skip']} · 실패 {done['fail']}"
          f" · {dir_size(d) / 1024 / 1024:.1f} MB")
if all_fails:
    print(f"실패 {len(all_fails)}건 (앞 20건 — 공개 미러에 아직 없는 최신 스킨):")
    for f in all_fails[:20]:
        print("  ", f)
print("→ R2 반영: node scripts/r2-sync.mjs")
