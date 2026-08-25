#!/usr/bin/env python3
"""'장면 모드'(스토리 전문의 VN 재생)용 배경·스탠딩 스프라이트를 받아 webp로 굽는다.

Usage:
  python3 scripts/build-story-vn.py act6d5      # 한 이벤트
  python3 scripts/build-story-vn.py             # 연출 트랙(vn)이 있는 전 이벤트

입력은 build-story-scripts.py 가 이미 만들어 둔 public/story/script/<eid>.json 의 `vn`
트랙이다 (배경 이름·스프라이트 base·표정 번호). 여기서는 그 이름들을 실제 파일로만 바꾼다.

산출물 (둘 다 public/story/ 밑 — deploy.sh 가 통째로 R2 로 보내는 폴더라
Cloudflare Pages 의 2만 파일 한도를 건드리지 않는다):
  public/story/bg/<배경이름>.webp
  public/story/sprite/<base>__<표정번호>.webp     ← 알파 여백을 잘라낸 것

## 스프라이트 파일명 규칙 (전수 확인 2026-08-25)
클뜯 레포 avg/characters 아래 항목은 **두 형태**다:
  · 폴더  char_002_amiya_1/ → char_002_amiya_1.png, char_002_amiya_2.png … (표정별)
  · 낱장  char_015_lmg.png                                                  (표정 없음)
폴더 이름은 표정 1번 파일 이름과 같고, 표정 번호는 **띄엄띄엄**하다
(char_136_hsguma 는 _1 과 _3 만 있다). 그래서 번호를 계산하지 않고 폴더 목록을 읽어
고른다. 없는 번호는 가장 가까운 번호로 대체하되, **파일 이름은 대본이 부른 번호**로
저장한다 — 화면이 대본 그대로 찾으면 되게.

## 알파 트림을 왜 하는가
원본은 1024×1024 캔버스에 인물이 가운데 떠 있고 여백이 절반 가까이 된다
(예: 첸 1024×1024 → 실제 505×931). 그대로 붙이면 인물 키가 제각각이라 무대에 세울 수
없다. 투명 여백을 잘라 바닥 기준으로 세우면 키가 대체로 맞는다.
"""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn"
API = "https://api.github.com/repos/ArknightsAssets/ArknightsAssets2/contents/assets/dyn"
SCRIPT_DIR = os.path.join(REPO, "public", "story", "script")
BG_DIR = os.path.join(REPO, "public", "story", "bg")
SPR_DIR = os.path.join(REPO, "public", "story", "sprite")
CACHE = os.path.join(REPO, ".gamedata", "story-vn-cache")

BG_MAX = 1280      # 무대는 아무리 커도 가로 1280 이면 충분하다 (원본 1024×576 이 대부분)
SPR_MAX = 760      # 트림 후 긴 변 — 무대 높이의 90% 로 그려도 선명하다


_token = ...

def gh_token():
    """GitHub API 토큰 — 없으면 None. 인증 없는 한도가 **시간당 60회**라 목록 조회에
    금방 걸린다 (실측 2026-08-25: 4이벤트 만에 403, 그걸 빈 목록으로 캐시해 스탠딩이
    통째로 사라졌다). 로컬에선 gh CLI 로그인을, CI 에선 GITHUB_TOKEN 을 쓴다."""
    global _token
    if _token is not ...:
        return _token
    _token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not _token:
        try:
            import subprocess
            _token = subprocess.run(["gh", "auth", "token"], capture_output=True,
                                    text=True, timeout=15).stdout.strip() or None
        except Exception:
            _token = None
    return _token


def _get(url, binary=True):
    headers = {"User-Agent": "terra-archive-vn/1.0"}
    if url.startswith("https://api.github.com/"):
        tok = gh_token()
        if tok:
            headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as res:
        raw = res.read()
        return raw if binary else json.loads(raw.decode("utf-8"))


# ── 스프라이트 목록 ─────────────────────────────────────────────────────────
# avg/characters 아래를 **API 한 번**(recursive 트리)으로 통째로 받아 캐시한다.
# ⚠ 폴더마다 contents API 를 부르면 안 된다 — 인증 없는 한도(60회/시간)에 4이벤트 만에
#   걸리고, 403 을 빈 목록으로 캐시해 그 인물의 스탠딩이 조용히 사라진다 (실측 2026-08-25).
# 대소문자가 대본과 다른 경우가 있어(avg_6D5_1 → avg_6d5_1) 소문자 색인을 함께 둔다.
_tree = None

def char_tree():
    """(최상위 이름 목록, {폴더: [파일이름…]})"""
    global _tree
    if _tree is not None:
        return _tree
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "tree.json")
    if os.path.exists(path):
        data = json.load(open(path, encoding="utf-8"))
    else:
        # ⚠ recursive 는 `cn:<경로>` 형식에 500 을 돌려준다 — 먼저 그 폴더의 sha 를 받고
        #   sha 로 recursive 를 부른다 (실측 2026-08-25: 14,088개, 잘리지 않음).
        root = _get("https://api.github.com/repos/ArknightsAssets/ArknightsAssets2/"
                    "git/trees/cn:assets/dyn/avg/characters", binary=False)
        # 14,000개짜리 트리라 GitHub 가 가끔 500 을 던진다 — 몇 번 다시 물어본다 (실측)
        tree = None
        for attempt in range(5):
            try:
                tree = _get("https://api.github.com/repos/ArknightsAssets/ArknightsAssets2/"
                            f"git/trees/{root['sha']}?recursive=1", binary=False)
                break
            except urllib.error.HTTPError as err:
                if err.code < 500 or attempt == 4:
                    raise
                time.sleep(2 * (attempt + 1))
        if tree is None:
            raise SystemExit("avg/characters 트리를 못 받았다")
        if tree.get("truncated"):
            raise SystemExit("avg/characters 트리가 잘렸다 — 폴더별 조회로 되돌려야 한다")
        names, dirs = [], {}
        for e in tree["tree"]:
            path_ = e["path"]
            if "/" not in path_:
                names.append(path_)
            elif path_.endswith(".png"):
                folder, name = path_.split("/", 1)
                # 크기까지 담는다 — '얼굴만 잘라 둔 파일'을 골라내는 데 쓴다 (아래 pick_hash)
                dirs.setdefault(folder, {})[name[:-4]] = e.get("size", 0)
        data = {"names": names, "dirs": dirs}
        json.dump(data, open(path, "w", encoding="utf-8"))
    _tree = ({n.lower(): n for n in data["names"]}, data["dirs"])
    return _tree


def char_index():
    return char_tree()[0]


def folder_files(folder):
    """폴더 안 파일 이름(확장자 제외). 정렬해 돌려준다 — 공통 접두 계산이 순서를 탄다."""
    return sorted(char_tree()[1].get(folder, {}))


def folder_sizes(folder):
    return char_tree()[1].get(folder, {})


# ── `<이름>#<표정>$<몸>` 계열 (미러 폴더 1,037개 중 877개) ────────────────────
# 스크립트가 부르는 이름이 곧 파일 이름이다: [charslot(name="avg_4179_monstr_1#4$1")].
# ⚠ 여기서 $N(몸 변형)을 버리면 안 된다 — 2026-08-25 사용자 제보 'Mon3tr 일러스트가 이상함'.
#   대부분(켈시 등)은 `#N$M` 자체가 표정이 들어간 **전신**이지만, Mon3tr 처럼 `#N$M` 이
#   512px **얼굴만** 잘라 둔 인물이 있다(전신은 `$M`, 1816px). 그대로 쓰면 얼굴 클로즈업이
#   전신 자리에 들어간다. 그래서 **몸(`$M`)보다 눈에 띄게 작으면 몸을 쓴다** —
#   표정은 잃지만 그림은 멀쩡하다 (얼굴을 몸에 합성하려면 위치 정보가 필요한데 없다).
FACE_ONLY_RATIO = 0.5

def pick_hash(entry, expr, part):
    """`#표정`·`#표정$몸` 계열 폴더에서 쓸 파일 이름을 고른다. 못 고르면 None.

    미러의 이름 규칙은 세 갈래다 (실측 2026-08-25, 폴더 1,037개):
      · `<이름>_<표정>`      옛 규칙 — 여기 말고 아래 옛 경로가 맡는다
      · `<이름>#<표정>`      몸 변형이 없는 인물 (avg_1013_spchen_1#2 …)
      · `<이름>#<표정>$<몸>` 몸 변형이 있는 인물 (avg_003_kalts_1#1$1 …)
    표정도 몸도 없는 `<이름>` / `<이름>$<몸>` 은 **표정 없는 몸**이다."""
    files = folder_sizes(entry)
    pat = re.compile(re.escape(entry) + r"(?:#(\d+))?(?:\$(\d+))?$")
    items = {}                      # (표정, 몸) → 파일 이름. 없는 자리는 0
    for name in files:
        m = pat.fullmatch(name)
        if m:
            items[(int(m.group(1) or 0), int(m.group(2) or 0))] = name
    if not items:
        return None
    want_part = int(part or 0)
    # 몸(표정 0) — 같은 몸 번호 우선
    body = items.get((0, want_part)) or items.get((0, 0))
    if body is None:
        zeros = sorted(k for k in items if k[0] == 0)
        body = items[zeros[0]] if zeros else None
    # 표정: 정확히 → 같은 표정의 다른 몸 → 가장 가까운 표정
    want = items.get((expr, want_part))
    if want is None:
        same = sorted(k for k in items if k[0] == expr)
        want = items[same[0]] if same else None
    if want is None:
        exprs = sorted({k[0] for k in items if k[0] > 0})
        if exprs:
            near = min(exprs, key=lambda e: (abs(e - expr), e))
            want = items.get((near, want_part)) or items[sorted(k for k in items if k[0] == near)[0]]
    # ⚠ Mon3tr 처럼 `#표정$몸` 이 **얼굴만 잘라 둔 파일**인 인물이 있다 (512px, 전신은 1816px).
    #   그대로 쓰면 얼굴 클로즈업이 전신 자리에 들어간다 (사용자 제보 2026-08-25).
    #   몸보다 눈에 띄게 작으면 표정을 포기하고 전신을 쓴다 — 얼굴을 몸에 합성하려면
    #   위치 정보가 필요한데 미러에 없다.
    if want and body and files.get(want, 0) < FACE_ONLY_RATIO * files.get(body, 0):
        return body
    return want or body


def resolve_sprite(base, expr):
    """(base, 표정번호) → 내려받을 URL. 못 찾으면 None.
    base 끝의 `-p<N>` 은 대본이 부른 몸 변형($N) 이다 (build-story-scripts.py sprite_ref)."""
    idx = char_index()
    part = None
    m = re.fullmatch(r"(.+)-p(\d+)", base)
    if m:
        base, part = m.group(1), m.group(2)
    entry = idx.get(base.lower()) or idx.get(base.lower() + ".png")
    # 폴더가 없으면 **낱장 이름에 #표정·$몸이 그대로 붙은 경우**를 찾는다 —
    # 미러는 표정이 하나뿐인 인물을 폴더 없이 `avg_286_cast3_1$1.png` 로도 둔다
    # (실측 2026-08-25: 미해결 515건 중 177건이 이 형태였다).
    if entry is None and part:
        for cand in (f"{base}#{expr}${part}.png", f"{base}${part}.png"):
            entry = idx.get(cand.lower())
            if entry:
                break
    # avg_ ↔ char_ — 같은 인물을 두 접두로 나눠 둔 경우 (avg_1505_frstar_1 → char_1505_frstar_1)
    # ⚠ **양방향**이어야 한다. 종전엔 avg_→char_ 만 봐서 반대가 통째로 빠졌다
    #   (사용자 제보 2026-08-25: 대본의 char_214_kafka_1 이 미러엔 avg_214_kafka_1 —
    #    act15d0 이 167회 부르는데 한 장도 안 받아져 404 가 쌓이고 있었다).
    if entry is None:
        low = base.lower()
        alt = ("char_" + base[4:]) if low.startswith("avg_") else (
            ("avg_" + base[5:]) if low.startswith("char_") else None)
        if alt:
            entry = idx.get(alt.lower()) or idx.get(alt.lower() + ".png")
            if entry is None and part:
                for cand in (f"{alt}#{expr}${part}.png", f"{alt}${part}.png"):
                    entry = idx.get(cand.lower())
                    if entry:
                        break
    if entry is None:
        # 미러가 이름을 바꾼 경우 — 캐릭터 번호(char_2006_…)가 같은 항목으로 넘어간다.
        # 실측 2026-08-25: 대본의 char_2006_weiywfmzuki_1 이 미러엔 char_2006_fmzuki_1.png.
        # 접두는 avg_/char_ 둘 다 볼 것 — 위와 같은 이유다
        m = re.match(r"(?:char|avg)_(\d+)_", base.lower())
        if m:
            pre = re.compile(r"(?:char|avg)_" + m.group(1) + r"_")
            same = sorted(v for k, v in idx.items() if pre.match(k))
            if same:
                entry = same[0]
                print(f"    · {base} → {entry} (번호가 같은 항목으로 대체)")
    if entry is None:
        return None
    if entry.endswith(".png"):                      # 낱장 — 표정 변형이 없다
        return f"{ASSETS}/avg/characters/{urllib.parse.quote(entry)}"
    files = folder_files(entry)
    if not files:
        return None
    # ⚠ `-p<N>` 이 붙어 있어도 폴더가 옛 규칙(<stem>_<표정>)이면 아래 옛 경로로 간다 —
    #   대본은 늘 $1 을 달고 부르지만 미러의 옛 폴더에는 $ 파일이 없다 (char_002_amiya_1 등).
    if any("#" in f for f in files):
        want = pick_hash(entry, expr, part)
        if not want:
            return None
        return f"{ASSETS}/avg/characters/{urllib.parse.quote(entry)}/{urllib.parse.quote(want)}.png"
    if len(files) == 1:
        return f"{ASSETS}/avg/characters/{urllib.parse.quote(entry)}/{urllib.parse.quote(files[0])}.png"
    # ⚠ 줄기를 폴더 이름에서 번호를 떼어 구하면 안 된다 — avg_npc_034 는 번호가 아니라
    #   인물 번호라 avg_npc 로 잘려 전부 빗나간다 (실측 2026-08-25). 파일 이름들의
    #   **공통 접두**에서 구하면 두 형태(폴더가 표정1인 경우/아닌 경우)를 모두 맞춘다.
    stem = os.path.commonprefix(files).rstrip("_")
    by_num = {}
    for f in files:
        m = re.fullmatch(re.escape(stem) + r"_(\d+)", f)
        if m:
            by_num[int(m.group(1))] = f
    if stem in files:
        by_num.setdefault(1, stem)          # 표정 1은 번호 없이 오기도 한다 (avg_npc_034.png)
    if not by_num:
        want = files[0]
    else:
        # 띄엄띄엄한 번호 — 없으면 가장 가까운 번호로 (표정만 조금 다르고 인물은 같다)
        want = by_num.get(expr) or by_num[min(by_num, key=lambda n: (abs(n - expr), n))]
    return f"{ASSETS}/avg/characters/{urllib.parse.quote(entry)}/{urllib.parse.quote(want)}.png"


# ── 저장 ────────────────────────────────────────────────────────────────────
def save_bg(png, dest):
    from PIL import Image
    im = Image.open(BytesIO(png))
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA")
    if max(im.size) > BG_MAX:
        im.thumbnail((BG_MAX, BG_MAX), Image.LANCZOS)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    # 배경은 사진에 가깝고 투명이 없다 — 손실 q82 로 충분하다 (알파가 있으면 유지)
    if im.mode == "RGBA" and im.getchannel("A").getextrema()[0] == 255:
        im = im.convert("RGB")
    im.save(dest, "WEBP", quality=82, method=4)


def save_sprite(png, dest):
    """투명 여백을 잘라 저장. 잘린 크기를 (w, h)로 돌려준다."""
    from PIL import Image
    im = Image.open(BytesIO(png)).convert("RGBA")
    # ⚠ getbbox() 는 알파가 1이라도 있으면 남긴다. 큰 캔버스에 아틀라스 찌꺼기가 거의
    #   투명하게 깔려 있는 원본(예: avg_4179_monstr_1$1, 1816px)에서는 그래서 아무것도
    #   안 잘리고 인물이 손톱만 하게 들어간다 — 알파 16 이상만 내용으로 본다 (2026-08-25).
    mask = im.getchannel("A").point(lambda v: 255 if v > 16 else 0)
    bbox = mask.getbbox() or im.getbbox()
    if bbox:
        im = im.crop(bbox)
    if max(im.size) > SPR_MAX:
        im.thumbnail((SPR_MAX, SPR_MAX), Image.LANCZOS)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    # q84 — 무대에서 세로 630px 안팎으로 그려지는 그림이라 육안 차이가 없고, 전체 용량이
    # 40% 줄어든다 (q90 평균 68KB → 40KB대). 스탠딩은 수천 장이라 이 차이가 크다.
    im.save(dest, "WEBP", quality=84, method=5)
    return im.size


# ── 수집 ────────────────────────────────────────────────────────────────────
def collect(eid):
    """이벤트 JSON 의 vn 트랙에서 배경 이름·(스프라이트 base, 표정) 쌍을 모은다."""
    doc = json.load(open(os.path.join(SCRIPT_DIR, f"{eid}.json"), encoding="utf-8"))
    bgs, sprites = set(), set()
    for ep in doc.get("eps", []):
        for snap in ep.get("vn", []):
            if snap.get("bg"):
                bgs.add(snap["bg"])
            for base, expr in snap.get("ch", []):
                if base and base != "char_empty":
                    sprites.add((base, int(expr)))
    return bgs, sprites


def run(eid):
    bgs, sprites = collect(eid)
    if not bgs and not sprites:
        print(f"{eid}: 연출 트랙 없음 — 건너뜀")
        return
    missing_bg, missing_spr = [], []

    def dl_bg(name):
        dest = os.path.join(BG_DIR, f"{name}.webp")
        if os.path.exists(dest):
            return
        for cand in dict.fromkeys([name, name.lower()]):
            try:
                save_bg(_get(f"{ASSETS}/avg/backgrounds/{urllib.parse.quote(cand)}.png"), dest)
                return
            except urllib.error.HTTPError:
                continue
        missing_bg.append(name)

    def dl_spr(item):
        base, expr = item
        dest = os.path.join(SPR_DIR, f"{base}__{expr}.webp")
        if os.path.exists(dest):
            return
        url = resolve_sprite(base, expr)
        if not url:
            missing_spr.append(f"{base}#{expr}")
            return
        try:
            save_sprite(_get(url), dest)
        except urllib.error.HTTPError:
            missing_spr.append(f"{base}#{expr}")

    with ThreadPoolExecutor(8) as ex:
        list(ex.map(dl_bg, sorted(bgs)))
    # 폴더 목록이 트리 캐시(char_tree)로 바뀌어 조회가 없어졌으므로 배경과 같이 병렬로 받는다
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(dl_spr, sorted(sprites)))

    def folder_kb(d, names):
        return sum(os.path.getsize(os.path.join(d, n)) for n in names if os.path.exists(os.path.join(d, n))) // 1024

    bg_kb = folder_kb(BG_DIR, [f"{n}.webp" for n in bgs])
    spr_kb = folder_kb(SPR_DIR, [f"{b}__{e}.webp" for b, e in sprites])
    print(f"{eid}: 배경 {len(bgs) - len(missing_bg)}/{len(bgs)}장 {bg_kb}KB · "
          f"스탠딩 {len(sprites) - len(missing_spr)}/{len(sprites)}장 {spr_kb}KB")
    if missing_bg:
        print("  미러에 없는 배경:", ", ".join(sorted(missing_bg)))
    if missing_spr:
        print("  미러에 없는 스탠딩:", ", ".join(sorted(missing_spr)))


def write_ids():
    """장면 모드를 켤 수 있는 이벤트 목록 → app/data/story-scene-ids.json.
    화면이 버튼을 띄울지 **스크립트 JSON 을 받기 전에** 알아야 해서 따로 둔다
    (전문 목록 story-script-ids.json 과 같은 규약). 어느 한 편만 다시 빌드해도
    전체를 다시 훑어 만든다 — 목록이 부분 갱신으로 어긋나지 않게."""
    ids = []
    for f in sorted(os.listdir(SCRIPT_DIR)):
        if not f.endswith(".json"):
            continue
        doc = json.load(open(os.path.join(SCRIPT_DIR, f), encoding="utf-8"))
        if any(ep.get("vn") for ep in doc.get("eps", [])):
            ids.append(doc["id"])
    dest = os.path.join(REPO, "app", "data", "story-scene-ids.json")
    json.dump(sorted(ids), open(dest, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"장면 모드 가능 {len(ids)}편 → app/data/story-scene-ids.json")


def patch_missing():
    """미러에 없는 스탠딩을 vn 트랙에서 char_empty 로 바꾼다 (KR·EN·JA 전부).

    안 하면 화면이 없는 파일을 계속 불러 콘솔이 404로 도배된다 (사용자 제보 2026-08-25:
    avg_npc_1981_1). char_empty 로 바꾸는 이유는 **슬롯 번호를 지키기 위해서**다 —
    ch 에서 빼 버리면 focus 가 가리키는 자리가 어긋난다."""
    roots = [SCRIPT_DIR, os.path.join(SCRIPT_DIR, "en"), os.path.join(SCRIPT_DIR, "ja")]
    gone, fixed, files = set(), 0, 0
    for root in roots:
        if not os.path.isdir(root):
            continue
        for f in sorted(os.listdir(root)):
            if not f.endswith(".json"):
                continue
            path = os.path.join(root, f)
            doc = json.load(open(path, encoding="utf-8"))
            hit = 0
            for ep in doc.get("eps", []):
                for snap in ep.get("vn", []):
                    for pair in snap.get("ch", []):
                        base, expr = pair[0], int(pair[1])
                        if not base or base == "char_empty":
                            continue
                        if os.path.exists(os.path.join(SPR_DIR, f"{base}__{expr}.webp")):
                            continue
                        gone.add(f"{base}#{expr}")
                        pair[0], pair[1] = "char_empty", 1
                        hit += 1
            if hit:
                json.dump(doc, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
                fixed += hit
                files += 1
    if fixed:
        print(f"미러에 없는 스탠딩 {len(gone)}종을 빈 슬롯으로 정리 — {fixed}자리 / {files}파일")
        for k in sorted(gone)[:20]:
            print("   ·", k)
        if len(gone) > 20:
            print(f"   … 외 {len(gone) - 20}종")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if args:
        targets = args
    else:
        targets = []
        for f in sorted(os.listdir(SCRIPT_DIR)):
            if not f.endswith(".json"):
                continue
            doc = json.load(open(os.path.join(SCRIPT_DIR, f), encoding="utf-8"))
            if any(ep.get("vn") for ep in doc.get("eps", [])):
                targets.append(doc["id"])
    for eid in targets:
        run(eid)
    patch_missing()
    write_ids()


if __name__ == "__main__":
    main()
