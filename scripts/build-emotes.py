#!/usr/bin/env python3
"""훈수방 화면 반응 그림 — 게임의 '이모티콘 세트: 위수 협의'(기본 1·2)를 게임 CDN에서 꺼내 public/ac/emote/<이름>.webp 로.

사용자 지시 2026-10-24 "명토체스에서 쓰던 이모지는 어때?" — 기기마다 모양이 다른 이모지 대신 게임 그림을 그대로 쓴다.
협력(cooperate)·쿨함(playingcool)은 뺀다 (사용자 지시). 목록은 app/lens/coach.ts 의 EMOTES 와 같아야 한다.
세트 구성은 클라 번들 chat_emoji_hub(UI/Emoticon/Theme/[UC]emoticon_autochess_basic{,_2}/icon/pic_*_battle) 기준.

    python3 scripts/build-emotes.py      # 있으면 건너뛴다 (--force 로 다시)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdnassets  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "ac", "emote")
SETS = {
    "emoticon_autochess_basic": ["happy", "scared", "sorry", "thanks", "thinking"],
    "emoticon_autochess_basic_2": ["call", "dying", "noproblem", "respect", "sad"],
}

def main():
    force = "--force" in sys.argv
    if not cdnassets.available():
        print("✗ CDN 에셋을 못 연다 (cdnassets.available)", file=sys.stderr)
        return 1
    os.makedirs(OUT, exist_ok=True)
    bad = 0
    for theme, names in SETS.items():
        for n in names:
            dst = os.path.join(OUT, f"{n}.webp")
            if os.path.exists(dst) and not force:
                continue
            im = cdnassets.image(f"ui/emoticon/theme/[uc]{theme}/icon/pic_{n}_battle")
            if im is None:
                print(f"✗ {n}", file=sys.stderr); bad += 1; continue
            im.convert("RGBA").save(dst, "WEBP", quality=90, method=6)
            print(f"✓ {n} {im.size}")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
