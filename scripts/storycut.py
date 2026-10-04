"""스토리 CG(public/story/cut/<이름>.webp) 받기 규칙 — build-story-scripts.py · build-story.py --cuts · build-records.py 공용.

## 왜 (사용자 지시 2026-10-04 "다운로드 방식도 고쳐줘")

예전엔 CG 를 **있으면 건너뛰었다.** 7월에 에셋 미러의 중섭(cn) 브랜치에서 받은 그림이 그대로 남아, 게임 CDN(한섭)으로
바꾼 뒤에도 한 번도 다시 받지 않았다 — 메인 스토리 장 카드(avg_ep01 '第一章 黑暗时代 完')·이벤트 타이틀 카드처럼
**글자가 박힌 CG 38장이 중국어**로 남아 있었다 (2026-10-04 일회성으로 교체).
이제는 **어디서 받았는지**를 기록한다: 한섭 CDN 에서 받은 그림은 종전대로 건너뛰고, 미러(중섭)에서 받은 그림은
`scripts/story-cut-mirror.json` 에 이름을 적어 두었다가 **빌드할 때마다 한섭 CDN 을 다시 본다** — 한섭판이 생기면 그때 갈아
끼우고 목록에서 뺀다. (한섭에 아직 없는 중섭 선행 스토리의 CG 가 한섭에 열리면 저절로 한국어판이 된다.)
"""
import json
import os
import threading
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUT_DIR = os.path.join(REPO, "public", "story", "cut")
MIRROR_LIST = os.path.join(REPO, "scripts", "story-cut-mirror.json")
ASSETS = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn"
FOLDERS = ("avg/images", "avg/items")
_lock = threading.Lock()
_mirror = None


def _load():
    global _mirror
    if _mirror is None:
        try:
            _mirror = set(json.load(open(MIRROR_LIST, encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            _mirror = set()
    return _mirror


def needs_fetch(name):
    """받아야 하나 — 파일이 없거나, 있어도 미러(중섭)판이면 한섭 CDN 을 다시 본다."""
    return not os.path.exists(os.path.join(CUT_DIR, f"{name}.webp")) or name in _load()


def fetch_png(name, server="kr"):
    """(png, 출처) — 출처는 'kr'(게임 CDN) · 'mirror'(에셋 미러 cn) · None(못 받음). 대문자 참조(21_I1)는 소문자로도."""
    import cdnassets
    cands = list(dict.fromkeys([name, name.lower()]))
    for folder in FOLDERS:
        for cand in cands:
            png = cdnassets.png_bytes(f"{folder}/{cand}", server)
            if png:
                return png, "kr"
    for folder in FOLDERS:
        for cand in cands:
            try:
                req = urllib.request.Request(f"{ASSETS}/{folder}/{cand}.png", headers={"User-Agent": "Mozilla/5.0"})
                return urllib.request.urlopen(req, timeout=60).read(), "mirror"
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
                continue
    return None, None


def mark(name, src):
    """받은 출처를 기록 — 미러판이면 목록에 넣고(다음에 다시 확인), 한섭판이면 뺀다."""
    with _lock:
        m = _load()
        if src == "mirror":
            m.add(name)
        elif src == "kr":
            m.discard(name)


def save():
    with _lock:
        m = sorted(_load())
    json.dump(m, open(MIRROR_LIST, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
