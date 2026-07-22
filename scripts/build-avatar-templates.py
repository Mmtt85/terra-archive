# -*- coding: utf-8 -*-
"""오퍼 아바타 ZNCC 템플릿 인덱스 — 화면 인식 스캐너(app/scanner-core.ts)가 캡처된 카드
초상화를 정규화 상관(ZNCC)으로 매칭해 오퍼를 식별한다.

  public/avatars/<id>.webp → 중앙 크롭(투명 가장자리 제외) → 그레이 24×24 → app/data/avatar-templates.json

- dHash(64bit)는 변별력·정렬 민감도가 부족해 폐기(2026-07-22 실험). ZNCC 그레이 템플릿 + 런타임
  로컬 서치가 크롭 ±8% 어긋남·저해상도·블러에도 강건(합성 로스터 16/16 검증).
- 저장은 정규화 전 원본 그레이(uint8) base64. JS(scanner-core)가 로드 시 동일하게 평균차감·L2정규화한다.
- ⚠ 런타임 JS와 파리티: 그레이 L601, 중앙 크롭 비율(CROP), 24×24 — 세 가지가 동일해야 한다.
- operators.json에 있는 정식 오퍼만 인덱스. 손편집 금지.  실행: python3 scripts/build-avatar-templates.py
"""
import base64
import json
import os
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AV_DIR = os.path.join(REPO, "public", "avatars")
OPS = json.load(open(os.path.join(REPO, "app", "data", "operators.json"), encoding="utf-8"))
OP_BY_ID = {o["id"]: o for o in OPS}

SIZE = 24
CROP = {"x0": 0.12, "y0": 0.06, "x1": 0.88, "y1": 0.80}  # 캐릭터 상반신 중앙 (투명 배경 가장자리 제외)


def template_b64(path):
    im = Image.open(path).convert("RGBA")
    im = Image.alpha_composite(Image.new("RGBA", im.size, (0, 0, 0, 255)), im).convert("L")  # L601
    w, h = im.size
    im = im.crop((int(w * CROP["x0"]), int(h * CROP["y0"]), int(w * CROP["x1"]), int(h * CROP["y1"])))
    im = im.resize((SIZE, SIZE), Image.BILINEAR)
    return base64.b64encode(im.tobytes()).decode("ascii")


entries = []
for fn in sorted(os.listdir(AV_DIR)):
    if not fn.endswith(".webp"):
        continue
    op_id = fn[:-5]
    op = OP_BY_ID.get(op_id)
    if not op:
        continue
    entries.append({"id": op_id, "n": op["name"], "r": op["rarity"], "t": template_b64(os.path.join(AV_DIR, fn))})

out = {
    "_doc": "오퍼 아바타 ZNCC 그레이 템플릿(24×24, 중앙크롭) — scanner-core.ts 매칭용. build-avatar-templates.py 생성, 손편집 금지.",
    "size": SIZE,
    "crop": CROP,
    "count": len(entries),
    "avatars": entries,
}
dst = os.path.join(REPO, "app", "data", "avatar-templates.json")
json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
kb = os.path.getsize(dst) // 1024
print(f"ZNCC 템플릿 인덱스: {len(entries)}개 · {SIZE}×{SIZE} → app/data/avatar-templates.json ({kb}KB)")
