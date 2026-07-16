#!/usr/bin/env python3
"""Build app/data/stories.json — AI 스토리 요약 탭의 이벤트 목록 + 이미지 수집.

Usage:
  python3 scripts/build-story.py                # 이벤트 목록 재생성 + 썸네일 다운로드
  python3 scripts/build-story.py --cuts act48side   # 해당 이벤트 컷씬 CG 다운로드 (요약 집필용)
  python3 scripts/build-story.py --chars act48side  # 스탠딩 CG 이름↔화자 매칭표 출력
  python3 scripts/build-story.py --chars act48side avg_4056_titi_1 "avg_npc_2068_1#2" …
                                                # 지정 스탠딩 CG 다운로드 (기본 표정 #1$1)
  python3 scripts/build-story.py --kr-thumbs         # 사이드 이벤트 한국판 썸네일을 KR CDN에서 언팩
  python3 scripts/build-story.py --kr-story-thumbs   # 메인스토리(ko)·로그라이크 썸네일을 KR CDN에서 언팩
  python3 scripts/build-story.py --main-thumbs       # 메인스토리 en/ja 타이틀카드 썸네일

데이터 소스 (전부 원격 — 로컬 gamedata 폴더 불필요):
  - 이벤트 목록·제목(3개 언어)·에피소드 구성: 클뜯 레포 excel/story_review_table.json
    (kr 기준, en/jp는 미출시 이벤트면 한국어로 폴백)
  - 썸네일은 로케일별 서버판 (CN판은 중국어 부제가 박혀 있어 사용 금지 — 사용자 확정 2026-07):
    · ko: 한국판 → public/story/<id>.jpg — --kr-thumbs 모드가 KR 공식 CDN에서 언팩
      (신규 이벤트 직후 기본 모드는 글로벌판을 임시로 넣으니 --kr-thumbs로 교체할 것)
    · en: ArknightsAssets2 en 브랜치(글로벌판) → public/story/en/<id>.jpg (thumbEn)
    · ja: 555me/ArknightsAssets2 jp 브랜치(일본판) → public/story/ja/<id>.jpg (thumbJa)
      (en/ja는 없는 이벤트면 필드 생략 → UI가 기본판으로 폴백)
    경로: assets/dyn/arts/ui/storyreview/hubs/activity/storyentrypic_<id>.png
    (sips로 jpeg 변환, 있으면 스킵)
  - 컷씬 CG(--cuts): 스토리 스크립트의 [Image(image="...")] 태그를 수집해
    assets/dyn/avg/images/<name>.png → public/story/cut/<name>.jpg (1080px 리사이즈)

요약 본문은 app/data/story-summaries.json 에 별도 저장 — 이 스크립트가 만들지 않는다.
AI(Claude)가 스토리 스크립트를 정독하고 집필해 넣는다 (story-summary 스킬 참고).
ACTIVITY(사이드 스토리)만 수록. MINI_ACTIVITY(스토리 컬렉션)·MAINLINE은 필요해지면 확장.
"""
import json, os, re, subprocess, sys, time, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
ASSETS = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn"      # 컷씬·스탠딩(텍스트 없음)
ASSETS_EN = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/en/assets/dyn"  # 글로벌판 썸네일
ASSETS_JP = "https://raw.githubusercontent.com/555me/ArknightsAssets2/jp/assets/dyn"            # 일본판 썸네일 (본가엔 jp 브랜치 없음)

def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": "terra-archive-story/1.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        raw = res.read()
        return raw if binary else json.loads(raw.decode("utf-8"))

def to_jpeg(png_bytes, dest, max_px=None):
    """PNG 바이트를 jpeg로 변환해 저장 (macOS sips). 실패 시 png 그대로 저장."""
    tmp = dest + ".tmp.png"
    open(tmp, "wb").write(png_bytes)
    cmd = ["sips"] + (["-Z", str(max_px)] if max_px else []) + \
          ["-s", "format", "jpeg", "-s", "formatOptions", "78", tmp, "--out", dest]
    ok = subprocess.run(cmd, capture_output=True).returncode == 0
    os.remove(tmp)
    if not ok:  # sips 없는 환경 폴백 — png 확장자 그대로라도 동작은 한다
        open(dest, "wb").write(png_bytes)
    return ok

# ── --cuts <eventId>: 컷씬 CG 수집 (요약 집필 보조) ──────────────
def download_cuts(event_id):
    review = fetch(f"{GAMEDATA}/kr/gamedata/excel/story_review_table.json")
    event = review.get(event_id) or sys.exit(f"unknown event: {event_id}")
    cut_dir = os.path.join(REPO, "public", "story", "cut")
    os.makedirs(cut_dir, exist_ok=True)
    names = []
    for info in event["infoUnlockDatas"]:
        txt = fetch(f"{GAMEDATA}/kr/gamedata/story/{info['storyTxt']}.txt", binary=True).decode("utf-8")
        for m in re.finditer(r'\[Image\(image="([^"]+)"', txt, re.I):
            if m.group(1) not in names: names.append(m.group(1))
    for name in names:
        dest = os.path.join(cut_dir, f"{name}.jpg")
        if os.path.exists(dest):
            print("skip:", name); continue
        png = fetch(f"{ASSETS}/avg/images/{name}.png", binary=True)
        to_jpeg(png, dest, max_px=1080)
        print("cut:", f"/story/cut/{name}.jpg")
    print(f"{event_id}: {len(names)} cutscenes → public/story/cut/")

if len(sys.argv) > 2 and sys.argv[1] == "--cuts":
    download_cuts(sys.argv[2]); sys.exit(0)

# ── --chars <eventId> [name…]: 스탠딩 CG 매칭표/다운로드 (요약 집필 보조) ──
# 인자 없이: 스크립트의 [charslot name=…]과 바로 뒤따르는 [name="화자"]를 세어
# "어느 스프라이트가 누구인지" 표를 출력한다. 이름을 주면 해당 스탠딩 CG를
# public/story/char/<base>.png 로 내려받는다 (표정 변형 미지정 시 #1$1).
def chars_mode(event_id, wanted):
    review = fetch(f"{GAMEDATA}/kr/gamedata/excel/story_review_table.json")
    event = review.get(event_id) or sys.exit(f"unknown event: {event_id}")
    if wanted:
        char_dir = os.path.join(REPO, "public", "story", "char")
        os.makedirs(char_dir, exist_ok=True)
        for want in wanted:
            base = want.split("#")[0]
            variant = want if "#" in want else f"{want}#1$1"
            dest = os.path.join(char_dir, f"{base}.png")
            if os.path.exists(dest):
                print("skip:", base); continue
            url = f"{ASSETS}/avg/characters/{base}/{urllib.request.quote(variant)}.png"
            png = fetch(url, binary=True)
            tmp = dest + ".tmp.png"
            open(tmp, "wb").write(png)  # 스탠딩은 투명 배경이라 png 유지, 세로 640px로 축소
            ok = subprocess.run(["sips", "-Z", "640", tmp, "--out", dest], capture_output=True).returncode == 0
            os.remove(tmp) if ok else os.rename(tmp, dest)
            print("char:", f"/story/char/{base}.png")
        return
    from collections import Counter, defaultdict
    speaker_for = defaultdict(Counter)
    for info in event["infoUnlockDatas"]:
        txt = fetch(f"{GAMEDATA}/kr/gamedata/story/{info['storyTxt']}.txt", binary=True).decode("utf-8")
        active = set()
        for line in txt.splitlines():
            slots = re.findall(r'\[[Cc]har(?:slot|acter)\([^)]*?name2?\s*=\s*"([^"]+)"', line)
            if slots:
                active = {s.split("#")[0] for s in slots}; continue
            m = re.match(r'\s*\[name="([^"]+)"', line)
            if m and active:
                for a in active: speaker_for[a][m.group(1)] += 1
    for spr, cnt in sorted(speaker_for.items(), key=lambda kv: -sum(kv[1].values())):
        print(f"{sum(cnt.values()):4d}  {spr:28s} → {', '.join(n for n, _ in cnt.most_common(2))}")

if len(sys.argv) > 2 and sys.argv[1] == "--chars":
    chars_mode(sys.argv[2], sys.argv[3:]); sys.exit(0)

# ── --kr-thumbs: 한국판 썸네일을 KR 공식 CDN에서 언팩 ─────────────
# KR 서버는 언팩된 공개 레포가 없어 게임 CDN에서 직접 뽑는다 (사용자 확정 2026-07).
# 절차: network_config → resVersion → .idx 매니페스트(FlatBuffer, 128바이트 헤더 뒤)를
# 수제 파서로 읽어 asset→bundle 매핑 → storyentrypic이 든 spritepack 번들(.dat=zip)을
# 받아 UnityPy(+lz4inv, 아크나이츠 커스텀 압축)로 Texture2D 추출 → public/story/<id>.jpg.
# 필요 pip: UnityPy, lz4inv. 이벤트 id ≠ pic id인 경우(1stact=act1d0)는 리뷰 테이블로 매핑.
def kr_thumbs():
    import io, struct, zipfile
    try:
        import lz4inv, UnityPy
        from UnityPy.enums.BundleFile import CompressionFlags
        from UnityPy.helpers.CompressionHelper import DECOMPRESSION_MAP
        DECOMPRESSION_MAP[CompressionFlags.LZHAM] = lz4inv.decompress_buffer
    except ImportError:
        sys.exit("pip3 install --user UnityPy lz4inv 후 다시 실행")
    conf = fetch("https://ak-conf.arknights.kr/config/prod/official/network_config")
    network = json.loads(conf["content"])
    urls = network["configs"][network["funcVer"]]["network"]
    ver = fetch(urls["hv"].replace("{0}", "Android"))
    assets_url = f"{urls['hu']}/Android/assets/{ver['resVersion']}"
    hul = fetch(f"{assets_url}/hot_update_list.json")

    def fetch_dat(name):  # 번들 하나 = zip 포장 .dat
        dat = name.replace("/", "_").replace("#", "__").split(".")[0] + ".dat"
        with zipfile.ZipFile(io.BytesIO(fetch(f"{assets_url}/{dat}", binary=True))) as z:
            return z.read(z.filelist[0])

    # .idx FlatBuffer 수제 파싱 (스키마: OpenArknightsFBS resource_manifest.fbs)
    buf = fetch_dat(hul["manifestName"])[128:]
    u32 = lambda o: struct.unpack_from("<I", buf, o)[0]
    i32 = lambda o: struct.unpack_from("<i", buf, o)[0]
    u16 = lambda o: struct.unpack_from("<H", buf, o)[0]
    def table(o):
        vt = o - i32(o); nslots = (u16(vt) - 4) // 2
        return lambda s: (o + u16(vt + 4 + s*2)) if s < nslots and u16(vt + 4 + s*2) else None
    def string_at(fo):
        so = fo + u32(fo); return buf[so+4:so+4+u32(so)].decode("utf-8")
    def vector_at(fo):
        vo = fo + u32(fo); return vo + 4, u32(vo)
    root = table(u32(0))
    base, n = vector_at(root(1))
    bundles = []
    for i in range(n):
        t = table(base + i*4 + u32(base + i*4)); f = t(0)
        bundles.append(string_at(f) if f else "")
    base, n = vector_at(root(2))
    packs = set()
    for i in range(n):
        t = table(base + i*4 + u32(base + i*4)); fa, fb = t(0), t(1)
        if fa and "storyreview/hubs/activity/storyentrypic" in string_at(fa):
            packs.add(bundles[i32(fb)] if fb else "")

    review = fetch(f"{GAMEDATA}/kr/gamedata/excel/story_review_table.json")
    pic_to_event = {(v.get("storyEntryPicId") or "").lower(): v["id"]
                    for v in review.values() if v.get("entryType") == "ACTIVITY"}
    thumb_dir = os.path.join(REPO, "public", "story")
    count = 0
    for pack in sorted(packs):
        env = UnityPy.load(io.BytesIO(fetch_dat(pack)))
        for obj in env.objects:
            if obj.type.name != "Texture2D": continue
            d = obj.read()
            eid = pic_to_event.get(d.m_Name.lower())
            if not eid: continue
            tmp = os.path.join(thumb_dir, f".{eid}.tmp.png")
            d.image.save(tmp)
            to_jpeg(open(tmp, "rb").read(), os.path.join(thumb_dir, f"{eid}.jpg"))
            os.remove(tmp)
            count += 1
    print(f"KR 썸네일 {count}장 갱신 (resVersion {ver['resVersion']})")

if len(sys.argv) > 1 and sys.argv[1] == "--kr-thumbs":
    kr_thumbs(); sys.exit(0)

# ── 메인스토리·로그라이크 썸네일 ─────────────────────────────────────
# 메인스토리(main_N)·로그라이크(rogue_N)는 스토리 회고 썸네일이 없어 직접 만든다.
#   · 메인: 각 장 타이틀 카드 avg/images/avg_ep<NN> 를 세로형 중앙 크롭
#   · 로그라이크: 키 비주얼 avg/images/pic_rogue_<N>_kv1
# 텍스트가 박히므로 로케일별 서버판을 쓴다 (ko=한국판 CDN, en=글로벌, ja=일본).
#   · ko: public/story/{main_N,rogue_N}.jpg     ← --kr-story-thumbs (KR CDN 언팩)
#   · en: public/story/en/main_N.jpg            ← --main-thumbs
#   · ja: public/story/ja/main_N.jpg            ← --main-thumbs
# 로그라이크 키 비주얼은 일러스트라 로케일 무관 — ko판 하나를 전 로케일 공용으로 쓴다.
def to_portrait_jpeg(png_bytes, dest, ratio=404/491, max_px=720):
    """PNG를 세로형(404:491)으로 중앙 크롭 후 jpeg 저장 (macOS sips)."""
    tmp = dest + ".tmp.png"
    open(tmp, "wb").write(png_bytes)
    info = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", tmp],
                          capture_output=True, text=True).stdout
    w = int(re.search(r"pixelWidth: (\d+)", info).group(1))
    h = int(re.search(r"pixelHeight: (\d+)", info).group(1))
    cw = min(w, int(round(h * ratio)))
    subprocess.run(["sips", "-c", str(h), str(cw), tmp, "--out", tmp], capture_output=True)
    ok = subprocess.run(["sips", "-Z", str(max_px), "-s", "format", "jpeg",
                         "-s", "formatOptions", "80", tmp, "--out", dest], capture_output=True).returncode == 0
    os.remove(tmp)
    return ok

def main_thumbs():
    """글로벌(en)·일본(jp)판 메인스토리 타이틀 카드 → 로케일 서브폴더."""
    review = fetch(f"{GAMEDATA}/kr/gamedata/excel/story_review_table.json")
    ids = sorted((v["id"] for v in review.values() if v.get("entryType") == "MAINLINE"),
                 key=lambda x: int(x.split("_")[1]))
    thumb_dir = os.path.join(REPO, "public", "story")
    en_dir, ja_dir = os.path.join(thumb_dir, "en"), os.path.join(thumb_dir, "ja")
    os.makedirs(en_dir, exist_ok=True); os.makedirs(ja_dir, exist_ok=True)
    count = 0
    for eid in ids:
        n = int(eid.split("_")[1])
        pic = f"avg_ep{n:02d}"
        for base_url, sub_dir in ((ASSETS_EN, en_dir), (ASSETS_JP, ja_dir)):
            dest = os.path.join(sub_dir, f"{eid}.jpg")
            if os.path.exists(dest):
                print("skip:", dest); continue
            try:
                png = fetch(f"{base_url}/avg/images/{pic}.png", binary=True)
                to_portrait_jpeg(png, dest)
                print("main thumb:", dest); count += 1
            except Exception as err:  # noqa: BLE001
                print("FAIL:", eid, pic, err, file=sys.stderr)
    print(f"메인스토리 en/ja 썸네일 {count}장 생성")

if len(sys.argv) > 1 and sys.argv[1] == "--main-thumbs":
    main_thumbs(); sys.exit(0)

# ── --kr-story-thumbs: 한국판 메인스토리 카드 + 로그라이크 키비주얼 (KR CDN 언팩) ──
# KR 서버는 언팩 공개 레포가 없어 게임 CDN에서 직접 추출한다 (--kr-thumbs와 동일 파이프라인).
# avg/images/avg_ep<NN> (메인 17장) + avg/images/pic_rogue_<N>_kv1 (로그라이크 5종) 텍스처를
# 담은 번들(.ab)을 매니페스트에서 찾아 받아 UnityPy로 추출 → 세로형 크롭 저장.
def kr_story_thumbs():
    import io, struct, zipfile
    from collections import defaultdict
    try:
        import lz4inv, UnityPy
        from UnityPy.enums.BundleFile import CompressionFlags
        from UnityPy.helpers.CompressionHelper import DECOMPRESSION_MAP
        DECOMPRESSION_MAP[CompressionFlags.LZHAM] = lz4inv.decompress_buffer
    except ImportError:
        sys.exit("pip3 install --user UnityPy lz4inv 후 다시 실행")
    conf = fetch("https://ak-conf.arknights.kr/config/prod/official/network_config")
    network = json.loads(conf["content"])
    urls = network["configs"][network["funcVer"]]["network"]
    ver = fetch(urls["hv"].replace("{0}", "Android"))
    assets_url = f"{urls['hu']}/Android/assets/{ver['resVersion']}"
    hul = fetch(f"{assets_url}/hot_update_list.json")

    def fetch_dat(name):
        dat = name.replace("/", "_").replace("#", "__").split(".")[0] + ".dat"
        with zipfile.ZipFile(io.BytesIO(fetch(f"{assets_url}/{dat}", binary=True))) as z:
            return z.read(z.filelist[0])

    buf = fetch_dat(hul["manifestName"])[128:]
    u32 = lambda o: struct.unpack_from("<I", buf, o)[0]
    i32 = lambda o: struct.unpack_from("<i", buf, o)[0]
    u16 = lambda o: struct.unpack_from("<H", buf, o)[0]
    def table(o):
        vt = o - i32(o); nslots = (u16(vt) - 4) // 2
        return lambda s: (o + u16(vt + 4 + s*2)) if s < nslots and u16(vt + 4 + s*2) else None
    def string_at(fo):
        so = fo + u32(fo); return buf[so+4:so+4+u32(so)].decode("utf-8")
    def vector_at(fo):
        vo = fo + u32(fo); return vo + 4, u32(vo)
    root = table(u32(0))
    base, n = vector_at(root(1))
    bundles = []
    for i in range(n):
        t = table(base + i*4 + u32(base + i*4)); f = t(0)
        bundles.append(string_at(f) if f else "")

    thumb_dir = os.path.join(REPO, "public", "story")
    # KR 서버가 아직 한글화하지 않은 최신 장(15·16)은 타이틀 카드가 영문뿐이라,
    # 텍스트 없는 해당 장 대표 CG(로케일 무관)를 세로형 크롭해 대체한다.
    MAIN_OVERRIDE = {15: "60_i23", 16: "66_i14"}
    # 원하는 텍스처 basename(소문자) → 저장 경로 (오버라이드 장은 타이틀 카드 추출에서 제외)
    wanted = {}
    for i in range(17):
        if i in MAIN_OVERRIDE:
            continue
        wanted[f"avg_ep{i:02d}"] = os.path.join(thumb_dir, f"main_{i}.jpg")
    for i in range(1, 6):
        wanted[f"pic_rogue_{i}_kv1"] = os.path.join(thumb_dir, f"rogue_{i}.jpg")

    base, n = vector_at(root(2))
    by_bundle = defaultdict(list)  # bundle → [(basename, dest), …]
    for i in range(n):
        t = table(base + i*4 + u32(base + i*4)); fa, fb = t(0), t(1)
        if not fa:
            continue
        name = string_at(fa); bn = name.split("/")[-1].lower()
        if bn in wanted:
            by_bundle[bundles[i32(fb)] if fb else ""].append((bn, wanted[bn]))

    count = 0
    for bundle, items in sorted(by_bundle.items()):
        env = UnityPy.load(io.BytesIO(fetch_dat(bundle)))
        tex = {}
        for obj in env.objects:
            if obj.type.name == "Texture2D":
                d = obj.read(); tex[d.m_Name.lower()] = d
        for bn, dest in items:
            d = tex.get(bn)
            if not d:
                print("MISSING tex:", bn, "in", bundle, file=sys.stderr); continue
            png = io.BytesIO(); d.image.save(png, format="PNG")
            to_portrait_jpeg(png.getvalue(), dest)
            print("kr thumb:", dest); count += 1
    # 한글 미출시 장 대체 CG (cn 레포 = 텍스트 없는 일러스트라 로케일 무관)
    for n, cg in MAIN_OVERRIDE.items():
        dest = os.path.join(thumb_dir, f"main_{n}.jpg")
        png = fetch(f"{ASSETS}/avg/images/{cg}.png", binary=True)
        to_portrait_jpeg(png, dest)
        print("kr thumb(override CG):", dest, f"({cg})"); count += 1
    print(f"한국판 메인/로그라이크 썸네일 {count}장 생성 (resVersion {ver['resVersion']})")

if len(sys.argv) > 1 and sys.argv[1] == "--kr-story-thumbs":
    kr_story_thumbs(); sys.exit(0)

# ── 기본: stories.json + 썸네일 ─────────────────────────────
print("fetching story_review_table (kr/en/jp) …", file=sys.stderr)
kr = fetch(f"{GAMEDATA}/kr/gamedata/excel/story_review_table.json")
en = fetch(f"{GAMEDATA}/en/gamedata/excel/story_review_table.json")
jp = fetch(f"{GAMEDATA}/jp/gamedata/excel/story_review_table.json")

thumb_dir = os.path.join(REPO, "public", "story")
os.makedirs(thumb_dir, exist_ok=True)

# 스토리 회고 엔트리 이미지가 에셋 레포에 풀려 있지 않은 이벤트 — 스토리 CG로 대체
THUMB_FALLBACK = {
    "act24side": f"{ASSETS}/avg/images/36_i11.png",  # 불을 쫓는 낙엽
    "act36side": f"{ASSETS}/avg/images/54_i1.png",   # 테라밥
}

ja_dir = os.path.join(thumb_dir, "ja")
en_dir = os.path.join(thumb_dir, "en")
os.makedirs(ja_dir, exist_ok=True)
os.makedirs(en_dir, exist_ok=True)

events, failed = [], []
acts = sorted((v for v in kr.values() if v["entryType"] == "ACTIVITY"),
              key=lambda v: -v["startTime"])
for act in acts:
    eid = act["id"]
    # 에피소드: 같은 storyCode의 작전 전/후를 하나로 묶은 개수
    codes = []
    for info in act["infoUnlockDatas"]:
        if info["storyCode"] and info["storyCode"] not in codes: codes.append(info["storyCode"])
    entry = {
        "id": eid,
        "name": {
            "ko": act["name"],
            "en": (en.get(eid) or {}).get("name") or act["name"],
            "ja": (jp.get(eid) or {}).get("name") or act["name"],
        },
        "start": time.strftime("%Y-%m", time.gmtime(act["startTime"])),
        "episodes": len(codes),
        "thumb": f"/story/{eid}.jpg",
    }
    pic = (act.get("storyEntryPicId") or f"storyEntryPic_{eid}").lower()
    # 기본(ko) = 한국판 — KR CDN 언팩(--kr-thumbs)으로 채워지며 여기선 만들지 않는다.
    # 파일이 아직 없으면(신규 이벤트) 글로벌판을 임시로 받아두고, CG 대체 이벤트는 CG.
    dest = os.path.join(thumb_dir, f"{eid}.jpg")
    if not os.path.exists(dest):
        url = THUMB_FALLBACK.get(eid) or f"{ASSETS_EN}/arts/ui/storyreview/hubs/activity/{pic}.png"
        try:
            png = fetch(url, binary=True)
            to_jpeg(png, dest, max_px=640 if eid in THUMB_FALLBACK else None)
            print("thumb(임시-글로벌판, --kr-thumbs로 교체 필요):", eid, file=sys.stderr)
        except Exception as err:  # noqa: BLE001 — 썸네일 하나 실패해도 목록은 만든다
            failed.append((eid, pic, str(err)))
    # 글로벌판(en)·일본판(ja) — 없으면 필드 생략(UI가 기본판으로 폴백)
    if eid not in THUMB_FALLBACK:
        for key, sub_dir, base_url in (("thumbEn", en_dir, ASSETS_EN), ("thumbJa", ja_dir, ASSETS_JP)):
            sub_dest = os.path.join(sub_dir, f"{eid}.jpg")
            if not os.path.exists(sub_dest):
                try:
                    png = fetch(f"{base_url}/arts/ui/storyreview/hubs/activity/{pic}.png", binary=True)
                    to_jpeg(png, sub_dest)
                    print(f"thumb({key}):", eid, file=sys.stderr)
                except Exception:  # noqa: BLE001
                    continue
            entry[key] = f"/story/{os.path.basename(sub_dir)}/{eid}.jpg"
    events.append(entry)

# ── 중섭 선행(미실장) 이벤트 — CN에만 있는 ACTIVITY를 unreleased 플래그로 추가 ──
# 이름은 중국어 원문(한국어 데이터가 아직 없음). 썸네일은 CN판이 유일한 소스라 예외 허용
# (중국어 부제 금지 규칙은 KR 출시 이벤트의 기본 썸네일에만 적용 — 미실장은 CN판이 원본).
# /story/cn/ 에 따로 저장해, KR 출시 후 기본 썸네일(--kr-thumbs)과 파일이 충돌하지 않게 한다.
# UI는 '미래시 데이터 포함' 체크 시에만 노출한다.

# CN 전용 이벤트 제목의 AI 임시 번역 — 정식 출시 전까지 로케일별로 이걸 보여주고,
# UI에 '임시 번역이라 정식 번역과 다를 수 있다' 안내를 띄운다 (KR 출시되면 kr 테이블이
# 이 블록을 대체하므로 자연 소멸). 새 CN 이벤트가 잡히면 AI(Claude)가 여기에 번역을
# 채운다 — 없는 이벤트는 중국어 원문 그대로 나간다. 한자 시제(詩題)류는 KR 공식 관례대로
# 한자 독음(懷黍離→회서리, 將進酒→장진주)을 따른다.
CN_PROVISIONAL_NAMES = {
    "act49side": {"ko": "사세행", "en": "A Farewell to the Passing Year", "ja": "辞歳行"},  # 辞岁行
    "act51side": {"ko": "사람들, 우리", "en": "People, Us", "ja": "人々、私たち"},          # 人们，我们
}
print("fetching story_review_table (cn) …", file=sys.stderr)
cn = fetch(f"{GAMEDATA}/cn/gamedata/excel/story_review_table.json")
cn_dir = os.path.join(thumb_dir, "cn")
os.makedirs(cn_dir, exist_ok=True)
cn_acts = sorted((v for v in cn.values() if v["entryType"] == "ACTIVITY" and v["id"] not in kr),
                 key=lambda v: -v["startTime"])
for act in cn_acts:
    eid = act["id"]
    codes = []
    for info in act["infoUnlockDatas"]:
        if info["storyCode"] and info["storyCode"] not in codes: codes.append(info["storyCode"])
    pic = (act.get("storyEntryPicId") or f"storyEntryPic_{eid}").lower()
    dest = os.path.join(cn_dir, f"{eid}.jpg")
    if not os.path.exists(dest):
        try:
            png = fetch(f"{ASSETS}/arts/ui/storyreview/hubs/activity/{pic}.png", binary=True)
            to_jpeg(png, dest)
            print("thumb(cn·미실장):", eid, file=sys.stderr)
        except Exception as err:  # noqa: BLE001 — 썸네일 없으면 이벤트도 생략 (404 이미지 방지)
            print("skip cn event (no thumb):", eid, err, file=sys.stderr)
            continue
    trans = CN_PROVISIONAL_NAMES.get(eid)
    if not trans:
        print("untranslated cn event (원문 노출):", eid, act["name"], file=sys.stderr)
    events.append({
        "id": eid,
        "name": trans or {"ko": act["name"]},  # 임시 번역 없으면 중국어 원문
        "start": time.strftime("%Y-%m", time.gmtime(act["startTime"])),  # CN 출시월
        "episodes": len(codes),
        "thumb": f"/story/cn/{eid}.jpg",
        "unreleased": True,
    })

out = {"updated": time.strftime("%Y-%m-%d"), "events": events}
json.dump(out, open(f"{REPO}/app/data/stories.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print(f"stories.json: {len(events)} events "
      f"({sum(1 for e in events if e.get('unreleased'))} unreleased)")
if failed:
    print("FAILED thumbs:", failed, file=sys.stderr)
    sys.exit(1)
