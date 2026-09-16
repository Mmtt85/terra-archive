#!/usr/bin/env python3
"""게임 CDN에서 **이미지 에셋**을 직접 꺼낸다 — 클뜯 에셋 레포를 기다리지 않는다.

표(gamedata/excel)는 `fetch-gamedata-cdn.py`, 스토리 본문(gamedata/story)은
`build-story-scripts.py` 가 각자 처리한다. 여기는 그림 담당이다:
아바타·초상·스킬 아이콘·적·아이템·스토리 스프라이트/배경·UI.

## 왜 (사용자 확정 2026-09-16)

에셋 미러(`ArknightsAssets2`)는 사람이 돌려야 올라와서 며칠씩 밀린다. 그동안 신규 오퍼는
**도감엔 뜨는데 썸네일만 404**가 된다 (2026-08-01에 실제로 그렇게 배포됐고, 그래서
`deploy.sh` 가 R2 키 없는 배포를 아예 막는다). 2026-09-16 개방일엔 표까지 밀려서 신규 오퍼
셋이 '미실장'으로 원복됐다. 게임 CDN은 인게임과 동시에 열리므로 기다릴 이유가 없다.

## 경로 규칙

에셋 미러의 `assets/dyn/<path>.png` 와 CDN 매니페스트의 `<path>` 가 **그대로 대응한다**
(실측: `arts/charavatars/char_4223_botany`, `arts/charportraits/char_002_amiya_1`,
`avg/characters/avgnew_112_siege_1`, `avg/backgrounds/...`, `arts/skills/...`).
그래서 호출부는 레포에 쓰던 경로를 그대로 넘기면 된다.

## 주의

- 한 번들에 **수십~수천 개**가 같이 들어 있다. 첫 오브젝트를 집으면 엉뚱한 그림이 나오므로
  **에셋 이름(경로 마지막 조각)으로 골라야 한다** (스토리 본문에서 실제로 당했다).
- `Sprite` 를 먼저 본다 — 아틀라스에서 제 영역만 잘라 준다. 없으면 `Texture2D`.
- 서버마다 매니페스트가 다르다. 한섭에 아직 없는 미래(중섭 선행) 그림은 `server="cn"`.

사용:
    import cdnassets
    im = cdnassets.image("arts/charavatars/char_4223_botany")      # PIL.Image | None
    png = cdnassets.png_bytes("arts/charportraits/char_002_amiya_1")
"""
import io
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(REPO, ".gamedata", ".cdn")

_cdn = {}       # server -> Cdn
_bundles = {}   # (server, bundle) -> {에셋이름: PIL.Image}
_ready = None   # 의존성(UnityPy·lz4inv) 사용 가능 여부 — 한 번만 판정
# 호출부가 스레드 풀을 쓴다 (download-avatars 는 12스레드). UnityPy 로딩과 캐시 채우기를
# 잠가 둔다 — 같은 번들을 여러 스레드가 동시에 열면 헛수고이고, 매니페스트 수신도 겹친다.
_lock = threading.RLock()


def available():
    """UnityPy·lz4inv 가 있나. 없으면 호출부는 종전 레포 경로로 물러난다."""
    global _ready
    if _ready is None:
        try:
            import UnityPy  # noqa: F401
            import lz4inv   # noqa: F401
            _ready = True
        except Exception:
            _ready = False
    return _ready


def _conn(server):
    with _lock:
        if server not in _cdn:
            from fbsutil import Cdn, unity_lzham
            unity_lzham()
            c = Cdn(server, cache_dir=CACHE)
            c.manifest()
            _cdn[server] = c
        return _cdn[server]


def _table(server, bundle):
    """번들 하나를 열어 {에셋이름: PIL.Image} 로 만든다 (번들당 한 번만)."""
    key = (server, bundle)
    if key in _bundles:
        return _bundles[key]
    with _lock:
        if key in _bundles:
            return _bundles[key]
        import UnityPy
        env = UnityPy.load(io.BytesIO(_conn(server).bundle(bundle)))
        out = {}
        for obj in env.objects:
            if obj.type.name not in ("Sprite", "Texture2D"):
                continue
            try:
                d = obj.read()
                name = d.m_Name
                if not name:
                    continue
                # Sprite 우선 — 아틀라스에서 제 영역만 잘라 준다. Texture2D 는 통짜다.
                if name in out and obj.type.name == "Texture2D":
                    continue
                out[name] = d.image
            except Exception:
                continue
        _bundles[key] = out
        return out


def _compose(tbl, name):
    """알파가 따로 실린 텍스처를 합친다.

    아크나이츠 번들은 그림 일부를 **RGB 본체 + `<이름>[alpha]` 회색조 마스크** 두 장으로
    쪼개 둔다 (스토리 스프라이트가 특히 그렇다). 본체만 쓰면 배경이 까맣게 남는다.
    """
    im = tbl.get(name)
    if im is None:
        return None
    mask = tbl.get(name + "[alpha]")
    if mask is None:
        return im.convert("RGBA") if im.mode != "RGBA" else im
    from PIL import Image
    im = im.convert("RGB")
    if mask.size != im.size:
        mask = mask.resize(im.size, Image.LANCZOS)
    out = im.convert("RGBA")
    out.putalpha(mask.convert("L"))
    return out


def _locate(path, server):
    """(번들의 에셋표, 에셋이름) — 못 찾으면 (None, None)."""
    cdn = _conn(server)
    mani = cdn.manifest()
    if path in mani:
        bundle = mani[path]
    else:
        try:
            # 접두사 검색이라 `..._1` 을 찾다 `..._1+` 이 걸릴 수 있다 (charportraits 에
            # `char_002_amiya_1` 과 `_1+` 가 같이 있다) — 정확히 맞는 게 있으면 위에서 잡힌다.
            _, bundle = cdn.find(path)
        except KeyError:
            return None, None
    return _table(server, bundle), path.rsplit("/", 1)[-1]


def image(path, server="kr"):
    """CDN에서 이미지 하나를 PIL.Image 로. 없거나 못 뜯으면 None.

    `path` 는 에셋 미러의 `assets/dyn/` 아래 경로와 같다 (확장자 없이).
    스토리 스프라이트처럼 표정별로 `$1`·`$2` 가 붙는 것은 `sprite()` 를 쓴다.
    """
    if not available():
        return None
    try:
        tbl, name = _locate(path, server)
        if tbl is None:
            return None
        im = _compose(tbl, name)
        if im is not None:
            return im
        # 표정 번호가 붙은 이름밖에 없으면 첫 번째를 준다 (avg/characters 계열)
        faces = _faces(tbl, name)
        return _compose(tbl, "%s$%d" % (name, faces[0])) if faces else None
    except Exception as e:
        print("⚠ CDN 에셋 실패(%s): %s" % (path, str(e)[:60]), file=sys.stderr)
        return None


def _faces(tbl, name):
    """번들 안에 실제로 있는 표정 번호 목록 (오름차순). 번호는 띄엄띄엄하다."""
    out = []
    head = name + "$"
    for k in tbl:
        if k.startswith(head) and not k.endswith("[alpha]"):
            tail = k[len(head):]
            if tail.isdigit():
                out.append(int(tail))
    return sorted(out)


def faces(path, server="kr"):
    """그 스프라이트에 있는 표정 번호들. 없으면 빈 목록."""
    if not available():
        return []
    try:
        tbl, name = _locate(path, server)
        return _faces(tbl, name) if tbl is not None else []
    except Exception:
        return []


def sprite(path, face=1, server="kr"):
    """스토리 스탠딩 한 장. 그 번호가 없으면 **가장 가까운 번호**로 대체한다 —
    번호가 띄엄띄엄해서(예: `char_136_hsguma` 는 1·3만 있다) 계산으로 맞출 수 없다."""
    if not available():
        return None
    try:
        tbl, name = _locate(path, server)
        if tbl is None:
            return None
        have = _faces(tbl, name)
        if not have:
            return _compose(tbl, name)
        pick = face if face in have else min(have, key=lambda n: (abs(n - face), n))
        return _compose(tbl, "%s$%d" % (name, pick))
    except Exception as e:
        print("⚠ CDN 스프라이트 실패(%s#%s): %s" % (path, face, str(e)[:60]), file=sys.stderr)
        return None


def png_bytes(path, server="kr"):
    """`image()` 를 PNG 바이트로 — `urlread(...png)` 자리에 그대로 끼울 수 있다."""
    im = image(path, server)
    if im is None:
        return None
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def first(paths, servers=("kr", "cn")):
    """여러 후보 경로·서버를 순서대로 훑어 처음 잡히는 것. (경로, PIL.Image) | (None, None)

    한섭에 아직 없는 미래(중섭 선행) 그림이 있어서 kr → cn 순으로 본다.
    """
    for server in servers:
        for p in paths:
            im = image(p, server)
            if im is not None:
                return p, im
    return None, None


# ── 에셋 미러 URL 어댑터 ────────────────────────────────────────────────────
# 호출부가 쓰던 URL을 그대로 넘기면 CDN에서 대신 받아 준다. 스크립트마다 최하단
# 이미지 수신부 한 줄만 이걸 먼저 보게 고치면 전환이 끝난다.
#
# 브랜치 → 서버: 그림은 대개 언어 무관이라 **kr 을 먼저** 본다(한섭 기준 최신). 한섭에
# 아직 없는 미래 콘텐츠는 cn 에서 잡힌다. 다만 en/jp 브랜치는 **글자가 박힌 현지화
# 썸네일**을 받으러 가는 자리라 그 서버만 본다 — kr 로 대신 주면 한국어 그림이 나간다.
_BRANCH_SERVERS = {"cn": ("kr", "cn"), "en": ("en",), "jp": ("jp",), "kr": ("kr",)}
_MIRROR_RE = None


def from_mirror_url(url):
    """에셋 미러 URL(`.../ArknightsAssets2/<브랜치>/assets/dyn/<경로>.png` 또는
    `ArknightsAssets/<브랜치>/assets/torappu/dynamicassets/<경로>.png`)을 CDN에서 받아
    **PNG 바이트**로. 대응이 없거나 CDN에 없으면 None → 호출부는 종전대로 네트워크로."""
    global _MIRROR_RE
    if not available():
        return None
    if _MIRROR_RE is None:
        import re
        _MIRROR_RE = re.compile(
            r"github(?:usercontent)?\.com/[^/]+/ArknightsAssets2?/([a-z]+)/"
            r"assets/(?:dyn|torappu/dynamicassets)/(.+?)(?:\.png)?$")
    m = _MIRROR_RE.search(url)
    if not m:
        return None
    branch, path = m.group(1), m.group(2)
    for server in _BRANCH_SERVERS.get(branch, ("kr", "cn")):
        data = png_bytes(path, server)
        if data:
            return data
    return None


if __name__ == "__main__":  # 수동 확인: python3 scripts/cdnassets.py arts/charavatars/char_4223_botany
    for arg in sys.argv[1:]:
        im = image(arg)
        print(arg, "→", (im.size, im.mode) if im else "없음")
