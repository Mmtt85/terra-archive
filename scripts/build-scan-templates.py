#!/usr/bin/env python3
"""오퍼 스캐너 초상 템플릿 빌드 → app/scan/portrait-templates.json

오퍼 목록 화면의 카드 아트는 "장착 중인 스킨의 초상(portrait) 에셋"이다 (2026-07-23 확정 —
기본 E2 초상만 봐서는 안 되고, KR에 풀린 모든 스킨 초상이 후보여야 한다). 이 스크립트는
KR 오퍼 전원의 초상(기본 _1/_2 + 스킨)을 공개 미러에서 받아, 카드에 실제로 그려지는
영역만 잘라 소형 그레이스케일 템플릿으로 굽는다. 브라우저 스캐너(app/scan/vision.ts)는
카드 밴드를 같은 크기로 리샘플해 masked ZNCC로 대조한다.

캘리브레이션 근거(픽스처 3셀·2개 창 크기, 오차 ±1px):
  카드 밴드  = 별앵커(sx,ry) 기준  x: sx-0.28px .. sx+0.56px,  y: ry+0.06px .. ry+0.66px
  초상 rect  = 180×360 좌표계의 (-10.2, 36.5) - (175.0, 168.8)   [종횡비 1.400 = 밴드와 동일]
이 두 상수는 vision.ts의 ART_BAND와 반드시 일치해야 한다.

실행: python3 scripts/build-scan-templates.py   (재실행 안전 — 초상은 .gamedata/portraits/ 캐시)
"""
from __future__ import annotations

import base64
import io
import json
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from fetchutil import urlread

ROOT = Path(__file__).parent.parent
CACHE = ROOT / ".gamedata" / "portraits"
OUT = ROOT / "app" / "scan" / "portrait-templates.json"

SKIN_TABLE = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/kr/gamedata/excel/skin_table.json"
# 초상 미러 (우선순위대로) — # 은 %23으로 인코딩해야 한다.
# 최신 오퍼(2026~)는 yuanyan3060 스냅샷에 없고 ArknightsAssets2(cn)에만 있다.
MIRRORS = [
    "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/portrait/{}.png",
    "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn/arts/charportraits/{}.png",
    "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/en/assets/dyn/arts/charportraits/{}.png",
    "https://raw.githubusercontent.com/akgcc/arkdata/main/assets/torappu/dynamicassets/arts/charportraits/{}.png",
    "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets/cn/assets/torappu/dynamicassets/arts/charportraits/{}.png",
]

TW, TH = 42, 30                      # 템플릿 크기 (종횡비 1.4)
RECT = (-10.2, 36.5, 175.0, 168.8)   # 초상(180×360)에서 카드 밴드에 그려지는 영역
BAND = {"ax": -0.28, "ay": 0.06, "aw": 0.84, "ah": 0.60}  # vision.ts ART_BAND와 동일해야 함


def fetch_portrait(pid: str) -> Image.Image | None:
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"{pid}.png"
    if cached.exists():
        return Image.open(cached).convert("RGBA")
    # 미러에 따라 파일명이 전부 소문자인 경우가 있다 (예: ambienceSynesthesia → ambiencesynesthesia)
    variants = [urllib.parse.quote(pid)]
    if pid != pid.lower():
        variants.append(urllib.parse.quote(pid.lower()))
    for mirror in MIRRORS:
        for enc in variants:
            try:
                data = urlread(mirror.format(enc), timeout=30)
            except Exception:
                continue
            if data[:4] != b"\x89PNG":
                continue
            cached.write_bytes(data)
            return Image.open(io.BytesIO(data)).convert("RGBA")
    return None


def to_template(im: Image.Image) -> tuple[str, str]:
    """초상 → (그레이 base64, 알파마스크 base64). RECT는 초상 밖으로 나가면 투명 패딩."""
    x0, y0, x1, y1 = RECT
    w, h = x1 - x0, y1 - y0
    canvas = Image.new("RGBA", (round(w), round(h)), (0, 0, 0, 0))
    canvas.alpha_composite(im, (round(-x0), round(-y0)))
    small = canvas.resize((TW, TH), Image.LANCZOS)
    px = small.load()
    gray = bytearray(TW * TH)
    mask = bytearray((TW * TH + 7) // 8)
    for j in range(TH):
        for i in range(TW):
            r, g, b, a = px[i, j]
            p = j * TW + i
            gray[p] = round(0.299 * r + 0.587 * g + 0.114 * b)
            if a >= 128:
                mask[p >> 3] |= 1 << (p & 7)
    return base64.b64encode(bytes(gray)).decode(), base64.b64encode(bytes(mask)).decode()


def main() -> None:
    ops = {o["id"]: o["rarity"] for o in json.load(open(ROOT / "app" / "data" / "operators.json"))}
    skins = json.loads(urlread(SKIN_TABLE, timeout=60))["charSkins"]
    pid_to_op: dict[str, str] = {}
    for v in skins.values():
        cid, pid = v.get("charId"), v.get("portraitId")
        if cid in ops and pid:
            pid_to_op[pid] = cid

    print(f"KR 오퍼 {len(ops)} · 초상 {len(pid_to_op)}장 수집")
    entries, missing = [], []

    def work(item: tuple[str, str]):
        pid, cid = item
        im = fetch_portrait(pid)
        if im is None:
            return pid, None
        g, m = to_template(im)
        return pid, {"op": cid, "pid": pid, "r": ops[cid], "g": g, "m": m}

    with ThreadPoolExecutor(8) as pool:
        for pid, entry in pool.map(work, sorted(pid_to_op.items())):
            if entry is None:
                missing.append(pid)
            else:
                entries.append(entry)

    # 미러에 아직 없는 최신 스킨은 픽스처 실추출 오버라이드로 보강 (정식 초상이 잡히면 그쪽 우선)
    ov_path = Path(__file__).parent / "scan-template-overrides.json"
    if ov_path.exists():
        have = {e["pid"] for e in entries}
        for e in json.loads(ov_path.read_text())["templates"]:
            if e["pid"] not in have:
                entries.append(e)
                missing = [p for p in missing if p != e["pid"]]
                print(f"오버라이드 사용: {e['pid']}")

    # 커버리지 검증: 미러 누락 오퍼는 그 오퍼의 다른 초상이 하나라도 있으면 식별 가능
    covered = {e["op"] for e in entries}
    lost_ops = [pid for pid in missing if pid_to_op[pid] not in covered]
    if missing:
        print(f"⚠ 미러 누락 {len(missing)}장: {', '.join(missing[:10])}{' …' if len(missing) > 10 else ''}")
    if lost_ops:
        print(f"⚠⚠ 초상이 전무한 오퍼 존재 — 식별 불가: {lost_ops}")

    out = {"tw": TW, "th": TH, "rect": list(RECT), "band": BAND, "templates": entries}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"→ {OUT.relative_to(ROOT)} ({len(entries)}장, {OUT.stat().st_size / 1e6:.1f}MB)")


if __name__ == "__main__":
    main()
