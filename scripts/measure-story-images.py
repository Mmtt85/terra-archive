#!/usr/bin/env python3
"""public/story/의 컷씬·삽화 이미지 실측 크기를 재서 app/data/story-image-dims.json 생성.

스토리 요약 상세에서 CG(figure)·장식 삽화(deco)에 width/height를 박아 로딩 중 레이아웃
밀림(CLS)을 없애기 위한 데이터. 이미지의 고유 비율만 있으면 브라우저가 렌더 폭에 맞춰
높이를 미리 예약한다. CG를 새로 받으면(build-story.py --cuts / --chars) 재실행할 것.

의존성: pip install pillow
"""
import json, os, glob
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dims = {}
for sub in ("cut", "char"):
    for path in sorted(glob.glob(f"{REPO}/public/story/{sub}/*")):
        if not path.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            continue
        try:
            with Image.open(path) as im:
                w, h = im.size
        except Exception as e:
            print("skip", path, e)
            continue
        rel = "/story/" + sub + "/" + os.path.basename(path)
        dims[rel] = [w, h]

out = f"{REPO}/app/data/story-image-dims.json"
json.dump(dims, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"measured {len(dims)} images → app/data/story-image-dims.json")
