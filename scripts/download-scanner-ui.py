# -*- coding: utf-8 -*-
"""화면 인식 스캐너용 게임 UI 스프라이트 수확 — 정예화 배지(E0/E1/E2).

  PuppiizSunniiz/Arknight-Images ui/elite/{0,1,2}.png → public/scan/elite{0,1,2}.webp

오퍼 리스트 카드의 정예화 배지는 이 고정 스프라이트가 그대로 표시되므로(초상화와 달리
오퍼별 변형 없음) 템플릿 매칭(app/scanner-elite.ts)의 기준 이미지로 쓴다.
있으면 스킵.  실행:  python3 scripts/download-scanner-ui.py
"""
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imgutil import save_webp

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(REPO, "public", "scan")
SRC = "https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/main/ui/elite"

os.makedirs(DEST, exist_ok=True)
for n in (0, 1, 2):
    dst = os.path.join(DEST, f"elite{n}.webp")
    if os.path.exists(dst):
        print(f"skip elite{n}")
        continue
    req = urllib.request.Request(f"{SRC}/{n}.png", headers={"User-Agent": "terra-archive"})
    save_webp(urllib.request.urlopen(req, timeout=60).read(), dst)
    print(f"elite{n}.webp ← ui/elite/{n}.png")
print("완료:", DEST)
