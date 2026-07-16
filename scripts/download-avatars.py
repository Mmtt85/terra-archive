#!/usr/bin/env python3
"""Download missing operator avatars into public/avatars/ (webp로 변환 저장).

Source: yuanyan3060/ArknightsGameResource avatar/<char_id>.png → <char_id>.webp
Usage:  python3 scripts/download-avatars.py   (repo root)
Idempotent — skips files that already exist with sane size.
"""
import json, os, sys, urllib.request, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imgutil import save_webp

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(REPO, "public", "avatars")
SRC = "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar"

os.makedirs(DEST, exist_ok=True)
ops = json.load(open(os.path.join(REPO, "app", "data", "operators.json")))
jobs = [o["id"] for o in ops]

def dl(cid):
    dest = os.path.join(DEST, f"{cid}.webp")
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return None
    req = urllib.request.Request(f"{SRC}/{cid}.png", headers={"User-Agent": "terra-archive"})
    try:
        data = urllib.request.urlopen(req, timeout=30).read()
    except Exception as e:
        return f"FAIL {cid}: {e}"
    if len(data) < 500:
        return f"FAIL {cid}: response too small ({len(data)} bytes)"
    save_webp(data, dest)
    return f"ok {cid}"

with cf.ThreadPoolExecutor(12) as ex:
    results = [r for r in ex.map(dl, jobs) if r]
for r in results:
    print(r)
fails = [r for r in results if r.startswith("FAIL")]
print(f"downloaded {len(results) - len(fails)}, failed {len(fails)}, total ops {len(jobs)}")
sys.exit(1 if fails else 0)
