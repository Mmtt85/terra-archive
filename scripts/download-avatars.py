#!/usr/bin/env python3
"""Download missing operator avatars into public/avatars/ (webp로 변환 저장).

출처 우선순위 (2026-09-16 CDN 우선으로 전환):
  1. **게임 CDN** `arts/charavatars/<char_id>` — 인게임과 동시에 열린다
  2. yuanyan3060/ArknightsGameResource `avatar/<char_id>.png` — 미러(비상용)

CDN을 먼저 보는 이유: 미러는 사람이 돌려야 올라와서 며칠씩 밀린다. 그동안 신규 오퍼는
**도감엔 뜨는데 썸네일만 404**가 된다 — 2026-08-01에 중섭 신규 4명이 실제로 그렇게
배포됐고, 그래서 deploy.sh 가 R2 키 없는 배포를 아예 막는다.

Usage:  python3 scripts/download-avatars.py   (repo root)
Idempotent — skips files that already exist with sane size.
"""
import io, json, os, sys, urllib.request, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdnassets
from imgutil import save_webp

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(REPO, "public", "avatars")
SRC = "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar"

os.makedirs(DEST, exist_ok=True)
ops = json.load(open(os.path.join(REPO, "app", "data", "operators.json")))
jobs = [o["id"] for o in ops]

def from_cdn(cid):
    """게임 CDN에서 아바타 PNG 바이트. 한섭에 없으면 중섭(미래시 오퍼)도 본다."""
    for server in ("kr", "cn"):
        im = cdnassets.image(f"arts/charavatars/{cid}", server)
        if im is not None:
            buf = io.BytesIO()
            im.save(buf, "PNG")
            return buf.getvalue()
    return None


def dl(cid):
    dest = os.path.join(DEST, f"{cid}.webp")
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return None
    data = from_cdn(cid)
    if data:
        save_webp(data, dest)
        return f"ok {cid} (CDN)"
    # CDN에 없으면 미러로 — 옛 오퍼나 CDN 경로가 바뀐 경우
    req = urllib.request.Request(f"{SRC}/{cid}.png", headers={"User-Agent": "terra-archive"})
    try:
        data = urllib.request.urlopen(req, timeout=30).read()
    except Exception as e:
        return f"FAIL {cid}: {e}"
    if len(data) < 500:
        return f"FAIL {cid}: response too small ({len(data)} bytes)"
    save_webp(data, dest)
    return f"ok {cid} (미러)"

with cf.ThreadPoolExecutor(12) as ex:
    results = [r for r in ex.map(dl, jobs) if r]
for r in results:
    print(r)
fails = [r for r in results if r.startswith("FAIL")]
print(f"downloaded {len(results) - len(fails)}, failed {len(fails)}, total ops {len(jobs)}")
sys.exit(1 if fails else 0)
