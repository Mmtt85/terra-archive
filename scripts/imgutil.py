# -*- coding: utf-8 -*-
"""이미지 저장 공용 헬퍼 — 사이트 이미지는 전부 webp로 통일한다 (2026-07).

방문자 대역폭 절감을 위해 png/jpg 원본을 받아 webp로 변환 저장한다.
- 사진·컷씬(원본 jpg 계열): 손실 q82
- 일러스트·아이콘(원본 png 계열): 손실 q90 vs 무손실 중 작은 쪽
- max_px 지정 시 긴 변 기준 축소
"""
import io, os
from PIL import Image

def save_webp(png_or_jpg_bytes, dest, *, photo=False, max_px=None):
    """바이트를 받아 dest(.webp)에 저장. photo=True면 jpg 계열(손실 q82)."""
    im = Image.open(io.BytesIO(png_or_jpg_bytes))
    if max_px and max(im.size) > max_px:
        im.thumbnail((max_px, max_px), Image.LANCZOS)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if photo:
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        im.save(dest, "WEBP", quality=82, method=6)
        return dest
    # png 계열 — 손실 q90 vs 무손실 중 작은 쪽
    lossy, lossless = io.BytesIO(), io.BytesIO()
    im.save(lossy, "WEBP", quality=90, method=6)
    im.save(lossless, "WEBP", lossless=True, quality=100, method=6)
    best = lossy if lossy.tell() <= lossless.tell() else lossless
    open(dest, "wb").write(best.getvalue())
    return dest
