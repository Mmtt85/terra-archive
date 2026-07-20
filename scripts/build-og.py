#!/usr/bin/env python3
"""OG(소셜 미리보기) 이미지 생성 — 탭별 전용 1200x630.

사이트 톤(다크 블루프린트 + 라임 #c3d24b)을 코드로 렌더한다. '모든 페이지 동일' 문제를
없애기 위해 탭마다 부제·모노 라벨·라인 아이콘을 다르게 그린다. 정적 자산이라 자주 안 돌린다 —
한글 폰트가 필요하므로 로컬(macOS AppleSDGothicNeo)에서 생성해 커밋한다.

출력: public/og/<tab>.jpg (+ public/og.jpg = portal 폴백)
사용: python3 scripts/build-og.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "public", "og")
os.makedirs(OUT, exist_ok=True)

W, H = 1200, 630
BG_TOP = (14, 17, 19)
BG_BOT = (9, 11, 12)
INK = (233, 237, 236)
MUTED = (150, 158, 161)
DIM = (96, 104, 107)
LIME = (195, 210, 75)
LINE = (38, 43, 47)
GRID = (24, 28, 30)

KR = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
MONO = "/System/Library/Fonts/Menlo.ttc"


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


# 탭별 정의: 모노 코드 라벨 · 한글 부제(아카이브·데이터 톤) · 아이콘 종류
TABS = {
    "portal":  ("DATA PORTAL",        "모든 오퍼레이터, 모든 데이터. 하나의 아카이브.", "aperture"),
    "archive": ("OPERATOR DATABASE",  "모든 오퍼레이터를 소속·직군·시너지로 검색.",     "cards"),
    "planner": ("INFRA AUTO-PLANNER", "보유 오퍼만 입력하면 최적 인프라 편성 자동 완성.", "grid"),
    "recruit": ("RECRUIT CALCULATOR", "태그 조합으로 확정·고성급 오퍼를 계산.",         "tags"),
    "farm":    ("FARMING SIMULATOR",  "재료 파밍부터 육성 비용까지, 전부 데이터로.",     "hex"),
    "story":   ("AI STORY DIGEST",    "이벤트 스토리를 컷씬과 함께 10분 요약으로.",       "story"),
    "rogue":   ("INTEGRATED STRATEGIES", "통합전략의 모든 층·적 도감·엔딩 조건.",         "nodes"),
    "about":   ("FEATURE GUIDE",      "테라 아카이브가 무엇이고 무엇을 할 수 있는지.",    "info"),
}


def bg(d):
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))
    # 블루프린트 그리드
    for x in range(0, W, 48):
        d.line([(x, 0), (x, H)], fill=GRID)
    for y in range(0, H, 48):
        d.line([(0, y), (W, y)], fill=GRID)


def frame(d):
    m = 40
    d.rectangle([m, m, W - m, H - m], outline=LINE, width=1)
    # 코너 크로스헤어 틱
    for cx, cy in [(m, m), (W - m, m), (m, H - m), (W - m, H - m)]:
        d.line([(cx - 10, cy), (cx + 10, cy)], fill=DIM, width=1)
        d.line([(cx, cy - 10), (cx, cy + 10)], fill=DIM, width=1)
    # 상단 눈금자 느낌 (좌측)
    for i in range(12):
        x = m + 60 + i * 26
        d.line([(x, m), (x, m + (10 if i % 4 == 0 else 5))], fill=LINE, width=1)


def tracked(d, xy, text, fnt, fill, spacing=6):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill)
        x += d.textlength(ch, font=fnt) + spacing
    return x


# ── 우측 라인 아이콘들 (탭별 모티프) ─────────────────────────────
def icon(d, kind, cx, cy, s):
    col = LIME
    sub = (70, 78, 60)
    if kind == "aperture":
        for r in (s, int(s * 0.62), int(s * 0.28)):
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col if r == s else sub, width=3 if r == s else 2)
        d.line([(cx - s, cy), (cx + s, cy)], fill=sub, width=2)
        d.line([(cx, cy - s), (cx, cy + s)], fill=sub, width=2)
    elif kind == "cards":
        for i, dx in enumerate((-70, 0, 70)):
            x0 = cx + dx - 46
            col2 = col if i == 1 else sub
            d.rounded_rectangle([x0, cy - 74, x0 + 92, cy + 74], radius=10, outline=col2, width=3)
            d.ellipse([x0 + 30, cy - 50, x0 + 62, cy - 18], outline=col2, width=3)
            d.line([(x0 + 20, cy + 6), (x0 + 72, cy + 6)], fill=col2, width=3)
            d.line([(x0 + 20, cy + 30), (x0 + 56, cy + 30)], fill=col2, width=2)
    elif kind == "grid":
        g = 3
        cell = 52
        gap = 12
        tot = g * cell + (g - 1) * gap
        ox, oy = cx - tot // 2, cy - tot // 2
        hot = {(0, 0), (1, 1), (2, 0), (2, 2)}
        for r in range(g):
            for c in range(g):
                x0 = ox + c * (cell + gap)
                y0 = oy + r * (cell + gap)
                d.rounded_rectangle([x0, y0, x0 + cell, y0 + cell], radius=8,
                                    outline=col if (r, c) in hot else sub, width=3)
    elif kind == "tags":
        for i, (dx, dy) in enumerate([(-40, -46), (34, -20), (-20, 40), (48, 44)]):
            x0, y0 = cx + dx - 60, cy + dy - 20
            col2 = col if i in (0, 3) else sub
            d.rounded_rectangle([x0, y0, x0 + 120, y0 + 40], radius=20, outline=col2, width=3)
            d.ellipse([x0 + 14, y0 + 13, x0 + 28, y0 + 27], outline=col2, width=2)
    elif kind == "hex":
        import math
        def hexagon(hx, hy, r, c):
            pts = [(hx + r * math.cos(math.radians(60 * k - 30)), hy + r * math.sin(math.radians(60 * k - 30))) for k in range(6)]
            d.polygon(pts, outline=c, width=3)
        r = 44
        dy = int(r * 1.5)
        dx = int(r * math.sqrt(3) / 2 * 2 * 0.87)
        hexagon(cx, cy - dy, r, sub)
        hexagon(cx - dx, cy, r, col)
        hexagon(cx + dx, cy, r, sub)
        hexagon(cx, cy + dy, r, col)
    elif kind == "story":
        d.rounded_rectangle([cx - 96, cy - 74, cx + 96, cy + 74], radius=12, outline=col, width=3)
        d.line([(cx, cy - 74), (cx, cy + 74)], fill=sub, width=3)
        for i in range(4):
            yy = cy - 44 + i * 26
            d.line([(cx - 78, yy), (cx - 18, yy)], fill=sub, width=3)
            d.line([(cx + 18, yy), (cx + 78, yy)], fill=sub, width=3)
    elif kind == "nodes":
        pts = {"a": (cx - 78, cy + 40), "b": (cx - 10, cy - 20), "c": (cx - 30, cy + 70),
               "d": (cx + 60, cy - 58), "e": (cx + 74, cy + 34)}
        edges = [("a", "b"), ("b", "d"), ("b", "e"), ("a", "c"), ("d", "e")]
        for u, v in edges:
            d.line([pts[u], pts[v]], fill=sub, width=2)
        for k, (x, y) in pts.items():
            hot = k in ("b", "e")
            r = 16 if hot else 12
            d.ellipse([x - r, y - r, x + r, y + r], outline=col if hot else sub,
                      width=3, fill=(20, 24, 20) if hot else None)
    elif kind == "info":
        d.ellipse([cx - s, cy - s, cx + s, cy + s], outline=col, width=3)
        d.ellipse([cx - 6, cy - 46, cx + 6, cy - 34], fill=col)
        d.rounded_rectangle([cx - 6, cy - 18, cx + 6, cy + 52], radius=6, fill=col)


def build(tab):
    label, subline, ic = TABS[tab]
    im = Image.new("RGB", (W, H), BG_BOT)
    d = ImageDraw.Draw(im)
    bg(d)
    frame(d)

    f_kick = font(MONO, 22)
    f_title = font(KR, 96)
    f_sub = font(KR, 32)
    f_tag = font(MONO, 24)
    f_foot = font(MONO, 19)

    x0 = 96
    # 킥커 (모노, 라임)
    tracked(d, (x0, 120), "TERRA ARCHIVE", f_kick, LIME, spacing=8)
    # 타이틀 (한글, 굵게=stroke)
    d.text((x0 - 2, 168), "테라 아카이브", font=f_title, fill=INK, stroke_width=1, stroke_fill=INK)
    # 라임 슬래시 + 부제
    d.rectangle([x0, 320, x0 + 8, 356], fill=LIME)
    d.text((x0 + 26, 318), subline, font=f_sub, fill=MUTED)
    # 탭 코드 라벨
    d.text((x0, 392), "// ", font=f_tag, fill=LIME)
    tw = d.textlength("// ", font=f_tag)
    tracked(d, (x0 + tw, 392), label, f_tag, INK, spacing=4)

    # 우측 모티프 패널 + 아이콘
    px0 = 800
    d.rounded_rectangle([px0, 150, W - 72, H - 120], radius=16, outline=LINE, width=1)
    icon(d, ic, (px0 + (W - 72 - px0) // 2), (150 + (H - 120 - 150) // 2), 66)

    # 하단 푸터 라벨 (모노 = 영문만; 한글은 글리프 없어 깨짐)
    d.text((x0, H - 92), "terra-archive.net", font=f_foot, fill=DIM)
    rt = "ARKNIGHTS · KR"
    d.text((1010 - d.textlength(rt, font=f_foot), H - 92), rt, font=f_foot, fill=DIM)

    # 우하단 라임 앵글 액센트
    d.polygon([(W - 40, H - 40), (W - 40, H - 150), (W - 150, H - 40)], fill=LIME)
    d.polygon([(W - 40, H - 40), (W - 40, H - 108), (W - 108, H - 40)], fill=BG_BOT)

    path = os.path.join(OUT, f"{tab}.jpg")
    im.save(path, "JPEG", quality=88)
    return path


if __name__ == "__main__":
    for tab in TABS:
        p = build(tab)
        print("생성:", os.path.relpath(p, REPO))
    # portal을 기본 폴백 /og.jpg 로도 복사
    Image.open(os.path.join(OUT, "portal.jpg")).save(os.path.join(REPO, "public", "og.jpg"), "JPEG", quality=88)
    print("생성: public/og.jpg (portal 폴백)")
