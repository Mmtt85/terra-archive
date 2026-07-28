# -*- coding: utf-8 -*-
"""이미지 저장 공용 헬퍼 — 사이트 이미지는 전부 webp로 통일한다 (2026-07).

방문자 대역폭 절감을 위해 png/jpg 원본을 받아 webp로 변환 저장한다.
- 사진·컷씬(원본 jpg 계열): 손실 q82
- 일러스트·아이콘(원본 png 계열): 손실 q90 vs 무손실 중 작은 쪽
- max_px 지정 시 긴 변 기준 축소
"""
import io, os
from PIL import Image

def save_webp(png_or_jpg_bytes, dest, *, photo=False, max_px=None, method=6, try_lossless=True):
    """바이트를 받아 dest(.webp)에 저장. photo=True면 jpg 계열(손실 q82).

    method/try_lossless는 **대량 변환용 탈출구**다 (2026-07-28, 스킨 포트레이트 1,265장).
    실측: 180×360 RGBA 한 장이 method=6에서 6~15초인데 method=4는 0.03~0.07초이고
    결과 크기는 26KB vs 26KB로 사실상 같다 (~150배 차이, 이득 1KB 미만). 무손실 시도도
    이 그림들에선 항상 손실보다 커서(42KB vs 26KB) 순수 낭비였다. 기존 파이프라인의
    산출물을 바꾸지 않도록 기본값은 종전 그대로 두고, 부르는 쪽에서만 낮춘다.
    """
    im = Image.open(io.BytesIO(png_or_jpg_bytes))
    if max_px and max(im.size) > max_px:
        im.thumbnail((max_px, max_px), Image.LANCZOS)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if photo:
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        im.save(dest, "WEBP", quality=82, method=method)
        return dest
    # png 계열 — 손실 q90 vs 무손실 중 작은 쪽
    lossy = io.BytesIO()
    im.save(lossy, "WEBP", quality=90, method=method)
    best = lossy
    if try_lossless:
        lossless = io.BytesIO()
        im.save(lossless, "WEBP", lossless=True, quality=100, method=method)
        if lossless.tell() < lossy.tell():
            best = lossless
    open(dest, "wb").write(best.getvalue())
    return dest
