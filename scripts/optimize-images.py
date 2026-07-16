# -*- coding: utf-8 -*-
"""public/ 이미지를 webp로 일괄 변환해 방문자 대역폭을 줄인다 (2026-07).

- jpg → 손실 webp q82 (사진·컷씬: 시각적 무손실 수준)
- png → 손실 q90과 무손실 중 '작은 쪽' 자동 선택 (아바타·스탠딩은 손실이,
  플랫 아이콘은 무손실이 이기는 경우가 있음 — 무손실이면 픽셀 완전 동일)
- 변환 후 더 커지면 원본 유지 (그럴 일은 거의 없음)
- 제외: og 이미지(카카오톡 스크래퍼 webp 미지원), 파비콘류, svg

사용: python3 scripts/optimize-images.py [--delete-originals]
  기본은 원본을 남겨두고 .webp만 생성 (참조 갱신·검증 후 --delete-originals로 정리)
"""
import os, sys, glob
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = ["avatars", "items", "story", "about"]
SKIP_NAMES = {"og.png", "og.jpg"}
SKIP_PREFIX = ("favicon",)

def convert(src):
    dest = os.path.splitext(src)[0] + ".webp"
    if os.path.exists(dest):
        return "skip", 0, 0
    im = Image.open(src)
    ext = os.path.splitext(src)[1].lower()
    tmp_lossy = dest + ".lossy"
    tmp_lossless = dest + ".lossless"
    if ext == ".jpg" or ext == ".jpeg":
        im.save(tmp_lossy, "WEBP", quality=82, method=6)
        best = tmp_lossy
    else:  # png — 손실 q90 vs 무손실 중 작은 쪽
        im.save(tmp_lossy, "WEBP", quality=90, method=6)
        im.save(tmp_lossless, "WEBP", lossless=True, quality=100, method=6)
        best = tmp_lossy if os.path.getsize(tmp_lossy) <= os.path.getsize(tmp_lossless) else tmp_lossless
    before, after = os.path.getsize(src), os.path.getsize(best)
    if after >= before:  # 역효과면 포기
        for t in (tmp_lossy, tmp_lossless):
            if os.path.exists(t): os.remove(t)
        return "worse", before, before
    os.rename(best, dest)
    for t in (tmp_lossy, tmp_lossless):
        if os.path.exists(t): os.remove(t)
    return "ok", before, after

def main():
    delete = "--delete-originals" in sys.argv
    total_before = total_after = converted = 0
    for target in TARGETS:
        for src in sorted(glob.glob(os.path.join(REPO, "public", target, "**", "*.*"), recursive=True)):
            name = os.path.basename(src)
            if not name.lower().endswith((".png", ".jpg", ".jpeg")): continue
            if name in SKIP_NAMES or name.startswith(SKIP_PREFIX): continue
            if delete:
                dest = os.path.splitext(src)[0] + ".webp"
                if os.path.exists(dest):
                    os.remove(src)
                continue
            state, before, after = convert(src)
            if state == "ok":
                converted += 1
                total_before += before
                total_after += after
    if delete:
        print("원본 정리 완료")
    else:
        mb = lambda n: f"{n/1048576:.1f}MB"
        print(f"변환 {converted}개: {mb(total_before)} → {mb(total_after)} ({100 - total_after*100//max(total_before,1)}% 절감)")

if __name__ == "__main__":
    main()
