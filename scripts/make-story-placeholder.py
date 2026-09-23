#!/usr/bin/env python3
"""스토리 공용 자리표시 썸네일의 EN·JA 판 — public/story/_placeholder.{en,ja}.webp.

배너가 클뜯 레포에 없는(콜라보 라이선스 제외) 미출시 이벤트는 build-story.py 가 공용 자리표시
그림(/story/_placeholder.webp)을 쓴다. 그 그림에 '미출시 이벤트 / 배너 준비중'이 **그림으로** 박혀
있어서 EN·JA 화면에도 한글이 떴다 (사용자 지적 2026-09-23). 한국어 원본은 그대로 두고, 글자 자리만
배경 그라데이션으로 지운 뒤 같은 중심선·색으로 그 언어 문구를 얹는다.

사용: python3 scripts/make-story-placeholder.py   (macOS 시스템 글꼴 — SF · 히라기노 각고딕)
"""
import os

from PIL import Image, ImageDraw, ImageFont

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "public", "story", "_placeholder.webp")
FONTS = "/System/Library/Fonts"

# 원본 실측 (420×499): 제목 띠 y 220–246 · 부제 띠 y 268–285, 글자는 x 130–290 안
TITLE_MID, SUB_MID = 233, 277
TITLE_INK, SUB_INK = (202, 204, 217), (136, 141, 151)
ERASE = (108, 212, 312, 294)          # 지울 사각형 (x0, y0, x1, y1) — 글자 띠보다 조금 넓게
TEXTS = {
    "en": ("Unreleased Event", "Banner coming soon", os.path.join(FONTS, "SFNS.ttf"), 28, 19),
    "ja": ("未実装イベント", "バナー準備中", os.path.join(FONTS, "ヒラギノ角ゴシック W3.ttc"), 28, 19),
}


def erase_text(im):
    """글자 자리를 좌우 바탕색 사이 선형 보간으로 메운다 (세로 그라데이션이라 줄마다 다르다)."""
    px = im.load()
    x0, y0, x1, y1 = ERASE
    for y in range(y0, y1):
        left, right = px[x0 - 4, y], px[x1 + 4, y]
        for x in range(x0, x1):
            t = (x - x0) / (x1 - x0)
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(left, right))


def draw_centered(draw, text, font, mid_y, ink, width):
    box = draw.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text(((width - w) / 2 - box[0], mid_y - h / 2 - box[1]), text, font=font, fill=ink)


def main():
    for loc, (title, sub, font_path, title_px, sub_px) in TEXTS.items():
        im = Image.open(SRC).convert("RGB")
        erase_text(im)
        draw = ImageDraw.Draw(im)
        draw_centered(draw, title, ImageFont.truetype(font_path, title_px), TITLE_MID, TITLE_INK, im.width)
        draw_centered(draw, sub, ImageFont.truetype(font_path, sub_px), SUB_MID, SUB_INK, im.width)
        dest = os.path.join(REPO, "public", "story", f"_placeholder.{loc}.webp")
        im.save(dest, "WEBP", quality=90)
        print(f"  {os.path.relpath(dest, REPO)} ({os.path.getsize(dest)} B)")


if __name__ == "__main__":
    main()
