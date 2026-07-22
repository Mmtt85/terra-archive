# -*- coding: utf-8 -*-
"""오퍼 리스트 카드 이미지 매칭용 portrait 임베딩 인덱스 생성.

인게임 오퍼 목록 카드가 렌더하는 그림은 avatar(정사각 아이콘)가 아니라 **portrait
(세로 반신 카드 이미지)** 애셋이다 — 참조와 화면이 동일 원본이라 다운스케일 그레이
정규화 벡터(코사인 매칭)로 식별한다 (2026-07-22 재설계, OCR은 레벨 숫자 전용).

  yuanyan3060/ArknightsGameResource portrait/*.png
    → .portrait-cache/ 원본 캐시 (있으면 다운로드 스킵 — mtime 재계산만)
    → app/data/portrait-index.json  { id, v(변형), g(상단 정사각 그레이 16×16 base64) }

- operators.json에 있는 오퍼의 변형(기본 _1/_2, 스킨 name#N, 특수 _1+)만 수록.
- variant → operator_id 는 파일명 접두 매칭 (가장 긴 일치 id).
- ⚠ 런타임(app/scanner-match.ts)과 파리티: 그레이 L601 · 상단 정사각 16×16 · 평균0/L2 정규화는
  런타임이 수행(여기선 원시 그레이 바이트만 저장).
- 손편집 금지.  실행:  python3 scripts/build-portrait-index.py
"""
import base64
import io
import json
import os
import sys
import urllib.parse
import urllib.request

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(REPO, ".portrait-cache")
DST = os.path.join(REPO, "app", "data", "portrait-index.json")
LIST_URL = "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/file_dict.json"
IMG_BASE = "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main"

# 상단 정사각(폭×폭) 크롭 — 카드가 portrait를 "상단 정렬·전폭"으로 그리므로, 상단 정사각은
# 카드 비율과 무관하게 항상 공통으로 보이는 영역이다 (2026-07-22 실험: 전체상 매칭 4/14 →
# 상단 정사각 14/14). scanner-match.ts와 파리티.
W, H = 16, 16

OPS = json.load(open(os.path.join(REPO, "app", "data", "operators.json"), encoding="utf-8"))
# 접두 매칭용 — 긴 id 우선 (char_1001_amiya2 가 char_002_amiya 등과 헷갈리지 않게)
IDS = sorted((o["id"] for o in OPS), key=len, reverse=True)


def op_of(stem: str):
    for op_id in IDS:
        if stem == op_id or stem.startswith(op_id + "_") or stem.startswith(op_id + "#"):
            return op_id
    return None


def fetch(url: str) -> bytes:
    # 스킨 파일명의 '#'은 URL 프래그먼트로 잘리므로 경로를 반드시 인코딩 (2026-07-22 404 원인)
    base, path = url.split("/main/", 1)
    req = urllib.request.Request(f"{base}/main/{urllib.parse.quote(path)}", headers={"User-Agent": "terra-archive-scanner"})
    return urllib.request.urlopen(req, timeout=120).read()


def main():
    os.makedirs(CACHE, exist_ok=True)
    files = json.load(io.BytesIO(fetch(LIST_URL)))
    keys = files.keys() if isinstance(files, dict) else files
    ports = [k for k in keys if k.startswith("portrait/") and k.endswith(".png")]
    wanted = []  # (path, op_id, variant)
    for k in ports:
        stem = os.path.basename(k)[:-4]
        op_id = op_of(stem)
        if op_id:
            wanted.append((k, op_id, stem))
    print(f"portrait {len(ports)}장 중 로스터 매칭 {len(wanted)}장")

    entries = []
    misses = 0
    for i, (path, op_id, variant) in enumerate(sorted(wanted)):
        local = os.path.join(CACHE, os.path.basename(path))
        if not os.path.exists(local):
            try:
                data = fetch(f"{IMG_BASE}/{path}")
                open(local, "wb").write(data)
            except Exception as e:  # noqa: BLE001 — 개별 실패는 건너뛰고 집계
                misses += 1
                print(f"  ✗ {path}: {e}")
                continue
        im = Image.open(local).convert("RGBA")
        im = Image.alpha_composite(Image.new("RGBA", im.size, (0, 0, 0, 255)), im).convert("L")
        im = im.crop((0, 0, im.width, min(im.width, im.height)))  # 상단 정사각
        g = im.resize((W, H), Image.BILINEAR)
        entries.append({"id": op_id, "v": variant, "g": base64.b64encode(g.tobytes()).decode("ascii")})
        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{len(wanted)}")

    out = {
        "_doc": "오퍼 portrait(리스트 카드 원본 아트) 상단 정사각 그레이 16×16 인덱스 — scanner-match.ts 매칭용. build-portrait-index.py 생성, 손편집 금지.",
        "w": W, "h": H,
        "count": len(entries),
        "portraits": entries,
    }
    json.dump(out, open(DST, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(DST) // 1024
    print(f"인덱스 {len(entries)}변형 → app/data/portrait-index.json ({kb}KB) · 다운로드 실패 {misses}")


if __name__ == "__main__":
    main()
