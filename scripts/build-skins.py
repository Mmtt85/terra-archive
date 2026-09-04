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
from collections import Counter
import os
import shutil
import sys
import re
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cntr  # noqa: E402
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


# ── 미실장 스킨의 CN 원문 번역 (2026-09-04) ──────────────────────────────────
# 미실장 오퍼는 KR 스킨 테이블에 없어 CN 원문으로 폴백되는데, 이 스크립트는 종전에
# cn-translations.json 을 아예 읽지 않아 **스킨 설명만 중국어로 남아 있었다**
# (사용자 제보 2026-09-04 — 오퍼 상세 · 복장 탭). 다른 빌더(regen-operators·
# build-profiles·build-costs …)와 같은 사전을 같은 방식으로 태운다.
#   · cntr.load = 말줄임표 표기 흔들림(…… ↔ ......) 흡수
#   · 사전에 없으면 원문 유지 + 아래 집계로 보고 (지어내지 않는다)
CN_TR = cntr.load(f"{REPO}/scripts/cn-translations.json")
CJK_ONLY = re.compile(r"[一-鿿]")
HANGUL = re.compile(r"[가-힣]")
cn_missing = Counter()


def tr(text, loc):
    """CN 원문이면 사전의 로케일 문구로 갈아끼운다. 없으면 원문 그대로 + 미번역 집계."""
    if not text:
        return text
    hit = CN_TR.get(text)
    if isinstance(hit, dict) and hit.get(loc):
        return hit[loc]
    # 한자만 있고 한글이 없으면 아직 CN 원문이다 — ko 패스에서만 센다(중복 집계 방지)
    if loc == "ko" and CJK_ONLY.search(text) and not HANGUL.search(text):
        cn_missing[text] += 1
    return text


# 기본 복장(skinName 없음)은 전부 이름이 "기본 복장"이라 탭에서 구분이 안 된다
# (사용자 지적 2026-07-28). skinGroupId가 정예화 단계를 알려 주므로 그걸로 가른다.
# ⚠ ILLUST_0은 정예화 0·1이 함께 쓰는 기본 일러다 (게임 실측: 보유 420명 전원 ILLUST_0,
# 그중 377명이 ILLUST_2를 따로 가짐. ILLUST_1은 단 1건). 그래서 ILLUST_0을 "1정 일러"로
# 적으면 틀린 표기가 된다 — "기본 일러"로 두되 두 탭 모두 꼬리표가 붙게 한다.
ILLUST_STAGE = {"ILLUST_0": "기본 일러", "ILLUST_1": "1정 일러", "ILLUST_2": "2정 일러", "ILLUST_3": "3정 일러"}


# 기본 복장의 이름·설명문은 **모든 오퍼가 똑같이 쓰는 정형문**이다 (ILLUST_0 = "평소에
# 가장 자주 입는 복장", ILLUST_2 = "정예화 후 조정된 복장"). CN 폴백으로 채운 미실장 오퍼는
# 로케일 테이블에 그 스킨 id가 없어 중국어 원문("默认服装", "干员平时最常穿着的服装。")이
# 그대로 나오는데, 같은 정형문을 **로케일 테이블의 아무 기본 복장 항목에서 빌려오면**
# 번역 없이 정확한 문구가 된다 (2026-08-09). 오퍼별로 다른 값(일러스트레이터·초상 id)은
# 당연히 CN 원본 것을 그대로 쓴다.
def default_skin_texts(table):
    """로케일 테이블 → {skinGroupId: {"group": 시리즈명, "content": 정형 설명문}}.

    ⚠ 설명문은 **오퍼별로 다를 수 있다** — 실측(KR): ILLUST_0은 공란 718 · 정형문 343 ·
    기타 46종, ILLUST_2는 정형문 336 · 기타 40여 종. 그래서 '아무거나 하나'를 빌리면
    엉뚱한 오퍼의 설명(예: 로봇의 '합금 재질 프레임…')이 붙는다. **최빈값**만 정형문으로
    본다. 시리즈명(기본 복장/Default Outfit/デフォルト)은 전원 동일해 그대로 쓴다.
    """
    groups, contents = {}, {}
    for v in table.values():
        ds = v.get("displaySkin") or {}
        gid = ds.get("skinGroupId") or ""
        if ds.get("skinName") or not gid.startswith("ILLUST_"):
            continue
        groups.setdefault(gid, Counter())[ds.get("skinGroupName") or ""] += 1
        contents.setdefault(gid, Counter())[ds.get("content") or ""] += 1
    out = {}
    for gid in groups:
        top_group = groups[gid].most_common(1)[0][0]
        # 공란이 최빈일 수 있다(ILLUST_0) — 공란은 정형문으로 치지 않고 실제 문구 중 최빈을 쓴다
        top_content = next((t for t, _ in contents[gid].most_common() if t), "")
        out[gid] = {"group": top_group, "content": top_content}
    return out


DEFAULT_TEXTS = {loc: default_skin_texts(t) for loc, t in loc_tables.items()}
# CN 쪽 정형문 — 미실장 오퍼의 설명이 **이것과 같을 때만** 로케일 정형문으로 갈아끼운다.
# 오퍼 고유 설명(중국어)은 함부로 바꾸지 않고 그대로 둔다(번역 대상이지 치환 대상이 아니다).
CN_DEFAULT_TEXTS = None   # cn 테이블을 읽은 뒤 아래에서 채운다


def entry(skin_id, base, localized, loc=None):
    """표시 문자열은 로케일 테이블 우선, 없으면 KR 폴백. 구조 필드는 KR 정본."""
    d = (localized or base).get("displaySkin") or {}
    kd = base.get("displaySkin") or {}
    pick = lambda k: d.get(k) or kd.get(k)
    # CN 폴백으로 들어온 미실장 오퍼의 기본 복장 — 시리즈명은 전원 공통이라 로케일 값으로
    # 바꾸고, 설명문은 **CN 정형문과 일치할 때만** 로케일 정형문으로 바꾼다.
    # 오퍼 고유 설명은 중국어 그대로 남긴다(번역 파이프라인 소관이지 여기서 지어낼 것이 아니다).
    ko_default = None
    if localized is None and loc and not kd.get("skinName"):
        gid = kd.get("skinGroupId") or ""
        ko_default = DEFAULT_TEXTS.get(loc, {}).get(gid)
        cn_default = (CN_DEFAULT_TEXTS or {}).get(gid) or {}
        if ko_default:
            group_txt = ko_default["group"]
            content_txt = (ko_default["content"]
                           if (kd.get("content") or "") == cn_default.get("content", "\x00")
                           else pick("content"))
            # tr(): CN 폴백으로 남은 중국어를 cn-translations.json 으로 갈아끼운다.
            # artists(일러스트레이터 필명)는 대상이 아니다 — 게임도 원문 표기를 쓴다.
            return {
                "id": skin_id,
                "name": tr(clean(group_txt), loc) or "",
                "stage": ILLUST_STAGE.get(gid, ""),
                "group": tr(clean(group_txt), loc),
                "artists": kd.get("drawerList") or [],
                "content": tr(clean(content_txt), loc),
                "usage": tr(clean(pick("usage")), loc),
                "quote": tr(clean(pick("description")), loc),
                "obtain": tr(clean(pick("obtainApproach")), loc),
                "portrait": base.get("portraitId") or "",
                "sort": kd.get("sortId") or 0,
                "default": True,
            }
    return {
        "id": skin_id,
        # 기본 복장·정예화2 일러는 skinName이 없다 — 시리즈명(기본 복장 등)으로 대신 표시
        "name": tr(clean(pick("skinName")) or clean(pick("skinGroupName")), loc) or "",
        # 기본 복장 탭 구분용 꼬리표 ("1정 일러"/"2정 일러") — UI가 이름 뒤에 붙인다
        "stage": ILLUST_STAGE.get(kd.get("skinGroupId") or "", ""),
        "group": tr(clean(pick("skinGroupName")), loc),
        "artists": kd.get("drawerList") or [],
        "content": tr(clean(pick("content")), loc),
        "usage": tr(clean(pick("usage")), loc),
        "quote": tr(clean(pick("description")), loc),
        "obtain": tr(clean(pick("obtainApproach")), loc),
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

# 미실장(CN 선행) 오퍼는 **KR 스킨 테이블에 아예 없다** — 그래서 종전엔 스킨 파일이
# 만들어지지 않았고, 도감에서 기본 일러조차 볼 수 없었다 (사용자 지적 2026-08-09:
# "중국서버에만 실장된 오퍼레이터... 1정 2정 기본일러는 있어야 하지 않음?").
# CN 테이블에는 20명 전원의 기본 복장 일러가 있고(대부분 ILLUST_0 + ILLUST_2),
# 포트레이트·전체 일러 미러에도 파일이 실재한다(실측 200). CN으로 메운다.
#
# ⚠ **KR에 있는 오퍼는 절대 건드리지 않는다** — CN이 정본을 덮어쓰면 KR 기준 표기·정렬이
# 흔들린다. KR 커버리지가 0인 오퍼만 대상으로 한다.
# 표시 문자열은 로케일 테이블에 그 스킨 id가 없어 CN 원문(중국어)으로 폴백되는데,
# 정예화 꼬리표(기본 일러/2정 일러)는 skinGroupId로 계산하므로 언어와 무관하게 맞는다.
cn = skins_of(f"{S}/cn_skin_table.json")
CN_DEFAULT_TEXTS = default_skin_texts(cn)
kr_chars = set(by_char)
cn_filled = set()
for skin_id, base in cn.items():
    cid = base.get("charId")
    if cid not in ops or cid in kr_chars:
        continue
    by_char.setdefault(cid, []).append((skin_id, base))
    cn_filled.add(cid)
if cn_filled:
    print(f"  CN 폴백: 미실장 {len(cn_filled)}명의 스킨을 cn_skin_table에서 채움")

written = 0
for loc in LOCALES:
    out_dir = f"{META_ROOT}/{loc}"
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir, exist_ok=True)
    table = loc_tables[loc]
    for cid, entries in by_char.items():
        items = [entry(sid, base, table.get(sid), loc) for sid, base in entries]
        items.sort(key=lambda x: x["sort"])
        with open(f"{out_dir}/{cid}.json", "w", encoding="utf-8") as f:
            json.dump({"id": cid, "skins": items}, f, ensure_ascii=False, separators=(",", ":"))
        written += 1
print(f"skins 메타: {written}개 파일 ({len(by_char)}명 × {len(LOCALES)}로케일)"
      f" · 스킨 {sum(len(v) for v in by_char.values())}종")
if cn_missing:
    print(f"  ⚠ 미번역 CN 스킨 텍스트 {len(cn_missing)}줄 "
          f"{sum(len(k) for k in cn_missing)}자 — scripts/cn-translations.json 에 채울 것")
    for txt in list(cn_missing)[:5]:
        print(f"     · {txt[:60]}")

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
