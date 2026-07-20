#!/usr/bin/env python3
"""OG(소셜 미리보기) 이미지 생성 — 로케일×탭별 1200x630.

사이트 톤(다크 블루프린트 + 라임 #c3d24b)을 코드로 렌더한다. '모든 페이지 동일' 문제를
없애기 위해 탭마다 부제·모노 라벨·라인 아이콘을 다르게 그리고, 3개 언어(ko/en/ja)로 낸다.
정적 자산이라 자주 안 돌린다 — CJK 폰트가 필요하므로 로컬(macOS)에서 생성해 커밋한다.

출력: public/og/<locale>/<tab>.jpg (+ public/og.jpg = ko portal 폴백)
사용: python3 scripts/build-og.py
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1200, 630
BG_TOP, BG_BOT = (14, 17, 19), (9, 11, 12)
INK, MUTED, DIM = (233, 237, 236), (150, 158, 161), (96, 104, 107)
LIME, LINE, GRID = (195, 210, 75), (38, 43, 47), (24, 28, 30)

KR = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
JP = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
MONO = "/System/Library/Fonts/Menlo.ttc"

# 로케일별 제목·본문 폰트 (모노 라벨은 영문이라 공용)
LOCALES = {
    "ko": {"title": "테라 아카이브", "font": KR},
    "en": {"title": "Terra Archive", "font": KR},   # Latin은 KR 폰트로 충분
    "ja": {"title": "テラアーカイブ", "font": JP},
}

# 탭별: 모노 코드 라벨 · 라인 아이콘 종류 (로케일 공용)
TAB_META = {
    "portal":  ("DATA PORTAL",           "aperture"),
    "archive": ("OPERATOR DATABASE",     "cards"),
    "planner": ("INFRA AUTO-PLANNER",    "grid"),
    "recruit": ("RECRUIT CALCULATOR",    "tags"),
    "farm":    ("FARMING SIMULATOR",     "hex"),
    "story":   ("AI STORY DIGEST",       "story"),
    "rogue":   ("INTEGRATED STRATEGIES", "nodes"),
    "about":   ("FEATURE GUIDE",         "info"),
}

# 탭×로케일 부제 (아카이브·데이터 톤)
SUBLINE = {
    "portal":  {"ko": "모든 오퍼레이터, 모든 데이터. 하나의 아카이브.",
                "en": "Every operator, every datum. One archive.",
                "ja": "全オペレーター、全データ。ひとつのアーカイブ。"},
    "archive": {"ko": "모든 오퍼레이터를 소속·직군·시너지로 검색.",
                "en": "Search every operator by faction, class & synergy.",
                "ja": "全オペレーターを所属・クラス・シナジーで検索。"},
    "planner": {"ko": "보유 오퍼만 입력하면 최적 인프라 편성 자동 완성.",
                "en": "Enter your roster — get the optimal base layout.",
                "ja": "手持ちを入力するだけで最適な基地編成。"},
    "recruit": {"ko": "태그 조합으로 확정·고성급 오퍼를 계산.",
                "en": "Find guaranteed operators from tag combos.",
                "ja": "タグの組み合わせから確定オペレーターを計算。"},
    "farm":    {"ko": "재료 파밍부터 육성 비용까지, 전부 데이터로.",
                "en": "Material farming to upgrade costs — all in data.",
                "ja": "素材周回から育成コストまで、すべてデータで。"},
    "story":   {"ko": "이벤트 스토리를 컷씬과 함께 10분 요약으로.",
                "en": "Event stories summarized with cutscenes in 10 min.",
                "ja": "イベントストーリーをカットシーンと共に10分要約。"},
    "rogue":   {"ko": "통합전략의 모든 층·적 도감·엔딩 조건.",
                "en": "Every floor, enemy & ending of Integrated Strategies.",
                "ja": "統合戦略の全階層・敵図鑑・エンディング条件。"},
    "about":   {"ko": "테라 아카이브가 무엇이고 무엇을 할 수 있는지.",
                "en": "What Terra Archive is, and what it can do.",
                "ja": "テラアーカイブが何で、何ができるのか。"},
}


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def fit(path, text, start, max_w, floor):
    """max_w 안에 들어갈 때까지 폰트 크기를 줄여 반환."""
    d = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    size = start
    while size > floor and d.textlength(text, font=font(path, size)) > max_w:
        size -= 2
    return font(path, size)


def bg(d):
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))
    for x in range(0, W, 48):
        d.line([(x, 0), (x, H)], fill=GRID)
    for y in range(0, H, 48):
        d.line([(0, y), (W, y)], fill=GRID)


def frame(d):
    m = 40
    d.rectangle([m, m, W - m, H - m], outline=LINE, width=1)
    for cx, cy in [(m, m), (W - m, m), (m, H - m), (W - m, H - m)]:
        d.line([(cx - 10, cy), (cx + 10, cy)], fill=DIM, width=1)
        d.line([(cx, cy - 10), (cx, cy + 10)], fill=DIM, width=1)
    for i in range(12):
        x = m + 60 + i * 26
        d.line([(x, m), (x, m + (10 if i % 4 == 0 else 5))], fill=LINE, width=1)


def tracked(d, xy, text, fnt, fill, spacing=6):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill)
        x += d.textlength(ch, font=fnt) + spacing
    return x


def icon(d, kind, cx, cy, s):
    col, sub = LIME, (70, 78, 60)
    if kind == "aperture":
        for r in (s, int(s * 0.62), int(s * 0.28)):
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col if r == s else sub, width=3 if r == s else 2)
        d.line([(cx - s, cy), (cx + s, cy)], fill=sub, width=2)
        d.line([(cx, cy - s), (cx, cy + s)], fill=sub, width=2)
    elif kind == "cards":
        for i, dx in enumerate((-70, 0, 70)):
            x0 = cx + dx - 46
            c = col if i == 1 else sub
            d.rounded_rectangle([x0, cy - 74, x0 + 92, cy + 74], radius=10, outline=c, width=3)
            d.ellipse([x0 + 30, cy - 50, x0 + 62, cy - 18], outline=c, width=3)
            d.line([(x0 + 20, cy + 6), (x0 + 72, cy + 6)], fill=c, width=3)
            d.line([(x0 + 20, cy + 30), (x0 + 56, cy + 30)], fill=c, width=2)
    elif kind == "grid":
        cell, gap = 52, 12
        tot = 3 * cell + 2 * gap
        ox, oy = cx - tot // 2, cy - tot // 2
        hot = {(0, 0), (1, 1), (2, 0), (2, 2)}
        for r in range(3):
            for c in range(3):
                x0, y0 = ox + c * (cell + gap), oy + r * (cell + gap)
                d.rounded_rectangle([x0, y0, x0 + cell, y0 + cell], radius=8,
                                    outline=col if (r, c) in hot else sub, width=3)
    elif kind == "tags":
        for i, (dx, dy) in enumerate([(-40, -46), (34, -20), (-20, 40), (48, 44)]):
            x0, y0 = cx + dx - 60, cy + dy - 20
            c = col if i in (0, 3) else sub
            d.rounded_rectangle([x0, y0, x0 + 120, y0 + 40], radius=20, outline=c, width=3)
            d.ellipse([x0 + 14, y0 + 13, x0 + 28, y0 + 27], outline=c, width=2)
    elif kind == "hex":
        def hexagon(hx, hy, r, c):
            pts = [(hx + r * math.cos(math.radians(60 * k - 30)), hy + r * math.sin(math.radians(60 * k - 30))) for k in range(6)]
            d.polygon(pts, outline=c, width=3)
        r = 44
        dy = int(r * 1.5)
        dx = int(r * math.sqrt(3) / 2 * 2 * 0.87)
        hexagon(cx, cy - dy, r, sub); hexagon(cx - dx, cy, r, col)
        hexagon(cx + dx, cy, r, sub); hexagon(cx, cy + dy, r, col)
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
        for u, v in [("a", "b"), ("b", "d"), ("b", "e"), ("a", "c"), ("d", "e")]:
            d.line([pts[u], pts[v]], fill=sub, width=2)
        for k, (x, y) in pts.items():
            hot = k in ("b", "e"); r = 16 if hot else 12
            d.ellipse([x - r, y - r, x + r, y + r], outline=col if hot else sub,
                      width=3, fill=(20, 24, 20) if hot else None)
    elif kind == "info":
        d.ellipse([cx - s, cy - s, cx + s, cy + s], outline=col, width=3)
        d.ellipse([cx - 6, cy - 46, cx + 6, cy - 34], fill=col)
        d.rounded_rectangle([cx - 6, cy - 18, cx + 6, cy + 52], radius=6, fill=col)


def build(locale, tab):
    label, ic = TAB_META[tab]
    loc = LOCALES[locale]
    subline = SUBLINE[tab][locale]
    im = Image.new("RGB", (W, H), BG_BOT)
    d = ImageDraw.Draw(im)
    bg(d)
    frame(d)

    x0 = 96
    f_kick = font(MONO, 22)
    f_title = fit(loc["font"], loc["title"], 96, 660, 60)   # 우측 패널(800~) 안 침범하게 폭 맞춤
    f_sub = fit(loc["font"], subline, 32, 660, 22)          # 좌측 영역 안에 들어가게
    f_tag = font(MONO, 24)
    f_foot = font(MONO, 19)

    tracked(d, (x0, 120), "TERRA ARCHIVE", f_kick, LIME, spacing=8)
    d.text((x0 - 2, 172), loc["title"], font=f_title, fill=INK, stroke_width=1, stroke_fill=INK)
    d.rectangle([x0, 320, x0 + 8, 356], fill=LIME)
    d.text((x0 + 26, 320), subline, font=f_sub, fill=MUTED)
    d.text((x0, 392), "// ", font=f_tag, fill=LIME)
    tw = d.textlength("// ", font=f_tag)
    tracked(d, (x0 + tw, 392), label, f_tag, INK, spacing=4)

    px0 = 800
    d.rounded_rectangle([px0, 150, W - 72, H - 120], radius=16, outline=LINE, width=1)
    icon(d, ic, px0 + (W - 72 - px0) // 2, 150 + (H - 120 - 150) // 2, 66)

    d.text((x0, H - 92), "terra-archive.net", font=f_foot, fill=DIM)
    rt = "ARKNIGHTS FANSITE"
    d.text((1010 - d.textlength(rt, font=f_foot), H - 92), rt, font=f_foot, fill=DIM)

    d.polygon([(W - 40, H - 40), (W - 40, H - 150), (W - 150, H - 40)], fill=LIME)
    d.polygon([(W - 40, H - 40), (W - 40, H - 108), (W - 108, H - 40)], fill=BG_BOT)

    out_dir = os.path.join(REPO, "public", "og", locale)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{tab}.jpg")
    im.save(path, "JPEG", quality=88)
    return path


if __name__ == "__main__":
    n = 0
    for locale in LOCALES:
        for tab in TAB_META:
            build(locale, tab); n += 1
    # ko portal을 기본 폴백 /og.jpg 로도 복사
    Image.open(os.path.join(REPO, "public", "og", "ko", "portal.jpg")).save(
        os.path.join(REPO, "public", "og.jpg"), "JPEG", quality=88)
    print(f"생성: {n}종 (og/<locale>/<tab>.jpg) + og.jpg 폴백")
