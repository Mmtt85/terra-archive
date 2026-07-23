#!/usr/bin/env python3
"""스토리 전문 스샷 검색 인덱스 — 스샷 레이더 /stories 설치용 (2026-07-24).

public/story/script/*.json(KR)의 대사 라인마다 10자 그램 앵커 3점(접두·중간·접미)을 뽑아
해시 → (스토리, 에피소드) 역색인을 만든다. 여러 스토리에 걸치는 그램(상투구)은 버리므로
남는 그램은 그 스토리 고유 — OCR 몇 조각만 맞아도 확정 판정이 가능하다.

앵커 3점인 이유 (⚠ %k 콘텐츠 샘플링은 실패했다 — 13자 대사는 그램 4개뿐이라 인덱스·질의
양쪽에서 다 안 뽑힐 수 있음): 라인마다 커버리지가 보장되고, 접두는 뒤쪽 오염(말줄임 등)에,
접미는 앞쪽 오염(화자 이름 병합 — 끝 정렬이라 오프셋 무관)에, 중간은 양끝 오독에 강하다.
질의(storymatch.ts)는 같은 3점 + 오프셋 ±1 변형을 조회한다.

같은 스토리 안에서 여러 ep에 걸치면 ep=255(스토리 전용 표)로 남긴다.

출력:
  public/story/search.bin        — u32 count | u32 hashes[count](정렬) | u8 story[count] | u8 ep[count]  (LE)
  app/data/story-search-meta.json — {"ids": [...]} (story 바이트 → 스토리 id, 정렬 순서 고정)

정규화·FNV 해시는 app/lens/storymatch.ts와 자구까지 동일해야 한다 (코드 유닛 2바이트 믹스).
"""
import json
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT_DIR = os.path.join(ROOT, "public", "story", "script")
OUT_BIN = os.path.join(ROOT, "public", "story", "search.bin")
OUT_META = os.path.join(ROOT, "app", "data", "story-search-meta.json")

N = 10          # 그램 길이 (자)
MIN_LINE = 10   # 이보다 짧은 정규화 대사는 제외
EP_AMBIG = 255  # 같은 스토리 안에서 여러 ep에 걸친 그램

NORM_RE = re.compile(r"[^0-9a-z가-힣]")


def norm(s: str) -> str:
    return NORM_RE.sub("", s.lower())


def fnv(s: str) -> int:
    """FNV-1a 32비트 — UTF-16 코드 유닛의 하위/상위 바이트를 순서대로 믹스 (storymatch.ts와 동일)."""
    h = 2166136261
    for ch in s:
        c = ord(ch)
        h = ((h ^ (c & 0xFF)) * 16777619) & 0xFFFFFFFF
        h = ((h ^ (c >> 8)) * 16777619) & 0xFFFFFFFF
    return h


def main() -> None:
    files = sorted(f for f in os.listdir(SCRIPT_DIR) if f.endswith(".json"))
    ids = [f[:-5] for f in files]
    if len(ids) > 250:
        sys.exit("스토리가 250개를 넘음 — story 바이트 확장 필요")

    # hash → (story, ep) | (story, EP_AMBIG) | None(교차 스토리 → 폐기)
    table: dict[int, tuple[int, int] | None] = {}
    grams = 0
    for si, fname in enumerate(files):
        with open(os.path.join(SCRIPT_DIR, fname)) as fp:
            d = json.load(fp)
        eps = d["eps"]
        if len(eps) >= EP_AMBIG:
            sys.exit(f"{fname}: ep {len(eps)}개 — ep 바이트 한계 초과")
        for ei, ep in enumerate(eps):
            for ln in ep["lines"]:
                x = ln.get("x")
                if not x:
                    continue
                s = norm(x)
                if len(s) < MIN_LINE:
                    continue
                last = len(s) - N
                for i in {0, last >> 1, last}:  # 앵커 3점 (짧은 라인은 중복 → set)
                    h = fnv(s[i:i + N])
                    grams += 1
                    cur = table.get(h, ("__miss__", 0))
                    if cur == ("__miss__", 0):
                        table[h] = (si, ei)
                    elif cur is None:
                        continue
                    elif cur[0] != si:
                        table[h] = None  # 교차 스토리 상투구 — 폐기
                    elif cur[1] != ei:
                        table[h] = (si, EP_AMBIG)

    entries = sorted((h, v[0], v[1]) for h, v in table.items() if v is not None)
    dropped = sum(1 for v in table.values() if v is None)
    with open(OUT_BIN, "wb") as out:
        out.write(struct.pack("<I", len(entries)))
        out.write(b"".join(struct.pack("<I", h) for h, _, _ in entries))
        out.write(bytes(s for _, s, _ in entries))
        out.write(bytes(e for _, _, e in entries))
    with open(OUT_META, "w") as out:
        json.dump({"ids": ids}, out, ensure_ascii=False)

    ambig = sum(1 for _, _, e in entries if e == EP_AMBIG)
    size = os.path.getsize(OUT_BIN)
    print(f"스토리 {len(ids)}개 · 샘플 그램 {grams:,} → 엔트리 {len(entries):,} "
          f"(ep 모호 {ambig:,} · 교차 폐기 {dropped:,}) · {size / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
