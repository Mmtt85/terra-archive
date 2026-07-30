#!/usr/bin/env python3
"""홈 화면 UI 테마 팔레트 뽑기 — 게임 홈 UI 테마 스크린샷에서 **색만** 읽어 온다.

⚠ 스크린샷 자체는 절대 사이트에 넣지 않는다 (2026-07-30 사고: 독타 ID가 찍힌 개인
   스크린샷을 배경으로 박아 공개 R2에 올렸다가 회수했다). 배경은 오퍼레이터 일러스트
   (public/skin/full)를 쓰고, 스크린샷에서는 인터페이스 색 구성만 가져온다.

쓰는 법: python3 scripts/build-portal-themes.py <스크린샷 폴더>
  → app/data/portal-themes.json (팔레트 목록) 갱신. 이미지는 만들지 않는다.

읽는 곳: 게임 홈의 타일이 모여 있는 오른쪽 구간(가로 55~98%, 세로 18~80%).
  · plate  = 그 구간에서 가장 넓은 면적을 차지하는 색 (타일 판 색)
  · accent = 채도가 가장 높은 색 (게임 UI의 포인트 색)
"""
import colorsys
import json
import os
import sys
from collections import Counter

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = os.path.join(ROOT, "app", "data", "portal-themes.json")
UI_BOX = (0.55, 0.18, 0.98, 0.80)   # 타일이 모여 있는 구간 (좌, 상, 우, 하)


def quant(rgb, step=24):
    """가까운 색을 한 통에 모은다 — 그라디언트·노이즈로 표가 흩어지는 걸 막는다."""
    return tuple(min(255, (c // step) * step + step // 2) for c in rgb)


def lum(rgb):
    r, g, b = rgb
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255


def hexs(rgb):
    return "#%02x%02x%02x" % tuple(int(c) for c in rgb)


def mix(rgb, other, w):
    return tuple(rgb[i] * (1 - w) + other[i] * w for i in range(3))


files = sorted(f for f in os.listdir(SRC) if f.lower().endswith((".png", ".jpg", ".jpeg")))
if not files:
    print(f"이미지가 없습니다: {SRC}")
    sys.exit(1)

out = []
for i, name in enumerate(files, start=1):
    im = Image.open(os.path.join(SRC, name)).convert("RGB")
    w, h = im.size
    ui = im.crop((int(w * UI_BOX[0]), int(h * UI_BOX[1]), int(w * UI_BOX[2]), int(h * UI_BOX[3])))
    ui = ui.resize((ui.width // 6, ui.height // 6), Image.BILINEAR)   # 표본만 있으면 된다
    px = list(ui.getdata())

    counts = Counter(quant(p) for p in px)
    plate = max(counts, key=lambda c: counts[c])                        # 가장 넓은 면 = 판 색
    # 포인트 색 — 채도가 높고 어느 정도 자주 나오는 색 (테두리 한 줄짜리 색은 거른다)
    common = [c for c, n in counts.items() if n >= len(px) * 0.004]
    accent = max(common, key=lambda c: colorsys.rgb_to_hsv(*[v / 255 for v in c])[1] * 0.8
                 + colorsys.rgb_to_hsv(*[v / 255 for v in c])[2] * 0.2)
    dark = lum(plate) < 0.5
    ink = (245, 245, 240) if dark else (26, 25, 23)

    out.append({
        "id": f"t{i:02d}",
        "dark": dark,
        "vars": {
            "--pt-plate": hexs(plate),
            "--pt-plate-2": hexs(mix(plate, (0, 0, 0) if dark else (255, 255, 255), 0.18)),
            "--pt-ink": hexs(ink),
            "--pt-mut": hexs(mix(ink, plate, 0.45)),
            "--pt-accent": hexs(accent),
            "--pt-strip": hexs(mix(plate, (0, 0, 0), 0.72)),
            "--pt-strip-ink": "#f2efe8",
            "--pt-line": "#ffffff22" if dark else "#00000018",
            "--pt-glow": hexs(accent) + "55",
        },
    })
    print(f"  {name} → 판 {hexs(plate)} · 포인트 {hexs(accent)} · {'어두움' if dark else '밝음'}")

json.dump(out, open(META, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"\n팔레트 {len(out)}종 → {META} (이미지는 만들지 않는다 — 배경은 오퍼 일러스트)")
