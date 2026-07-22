# -*- coding: utf-8 -*-
"""소개 페이지 스크린샷 webp 변환 — capture-about.mjs가 찍은 PNG를 public/about/에 넣는다.

입력: <inDir>/{ko,en,ja}/*.png (capture-about.mjs 출력)
출력: ko → public/about/*.webp (기존 URL 유지 — 구버전 캐시·외부 링크 보존)
      en/ja → public/about/{en,ja}/*.webp (about.tsx ShotFrame이 로케일로 분기)

  python3 scripts/convert-about.py <inDir>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imgutil import save_webp

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN = sys.argv[1]
OUT = os.path.join(REPO, "public", "about")

count = 0
for code in ("ko", "en", "ja"):
    src_dir = os.path.join(IN, code)
    if not os.path.isdir(src_dir):
        print(f"skip {code} — {src_dir} 없음")
        continue
    dst_dir = OUT if code == "ko" else os.path.join(OUT, code)
    for name in sorted(os.listdir(src_dir)):
        if not name.endswith(".png"):
            continue
        dst = os.path.join(dst_dir, name[:-4] + ".webp")
        with open(os.path.join(src_dir, name), "rb") as f:
            save_webp(f.read(), dst)
        count += 1
print(f"변환 완료: {count}개 → {OUT}")
