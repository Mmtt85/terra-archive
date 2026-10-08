#!/usr/bin/env python3
"""스토리 대사 검색 색인 — /stories '대사 검색' 창용 (제안 게시판 요청 2026-10-08).

스샷 레이더의 search.bin(build-story-search.py)은 줄마다 10자 앵커 3점만 담아 OCR 대조 전용이라,
사람이 치는 짧은 단어("켈시", "로도스")는 못 찾는다. 그래서 따로 만든다.

  public/story/find/<loc>/t/<id>.json  — 그 이야기의 대사만: [[화, 줄, 화자, 대사], ...]
                                         (화·줄은 전문 JSON 의 eps[화].lines[줄] — 리더기를 그 줄에서 연다)
  public/story/find/<loc>/g/<0..63>.json — 글자 조각 → 그 조각이 든 이야기 번호들 (조각의 해시로 64조각)
  app/data/story-find-meta.json          — {ver, <loc>: [{id, name}]} (이야기 번호 → id·제목, 결과를 늘어놓을 순서)

검색 창은 검색어의 조각이 든 색인 조각만 받아 후보 이야기를 좁히고, 후보의 대사 파일만 받아
실제로 맞춰 본다 — 대사 전체(한국어 압축 9MB)를 다 받지 않는다.

조각 규칙 (app/story-find.ts 와 자구까지 같아야 한다):
  정규화 = 소문자 + [0-9a-z가-힣ぁ-ゖァ-ヺー一-鿿] 만 남김 (띄어쓰기·문장부호 무시)
  위치 k 의 두 글자가 둘 다 ASCII 면 3글자, 아니면 2글자 — 영문은 두 글자 조합이 천여 개뿐이라
  거의 모든 이야기에 다 들어 있어 거르는 힘이 없다.
  해시 = FNV-1a 32비트 (UTF-16 코드 유닛의 하위·상위 바이트 순서 믹스, build-story-search.py 와 같은 함수)

제목이 없는 이야기(아직 목록에 안 오른 중섭 선행 메인 17장 등)는 뺀다 — 결과에 id 가 그대로 뜬다.
점검일 kr-big-patch §4-2 에서 build-story-scripts.py(ko·en·ja) 뒤에 돌린다.
"""
import hashlib
import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT_DIR = os.path.join(ROOT, "public", "story", "script")
OUT_DIR = os.path.join(ROOT, "public", "story", "find")
OUT_META = os.path.join(ROOT, "app", "data", "story-find-meta.json")
SHARDS = 64
LOCALES = ("ko", "en", "ja")

NORM_RE = re.compile(r"[^0-9a-z가-힣ぁ-ゖァ-ヺー一-鿿]")


def norm(s: str) -> str:
    return NORM_RE.sub("", s.lower())


def fnv(s: str) -> int:
    h = 2166136261
    for ch in s:
        c = ord(ch)
        h = ((h ^ (c & 0xFF)) * 16777619) & 0xFFFFFFFF
        h = ((h ^ (c >> 8)) * 16777619) & 0xFFFFFFFF
    return h


def grams(s: str):
    for k in range(len(s) - 1):
        n = 3 if ord(s[k]) < 128 and ord(s[k + 1]) < 128 else 2
        if k + n <= len(s):
            yield s[k:k + n]


def names() -> tuple[dict, list]:
    """id → {ko,en,ja} 제목(이벤트 목록 + 연대기의 메인·통합전략) · 결과에 늘어놓을 순서
    (한섭 이벤트 최신순 → 메인 장 순 → 통합전략 → 미실장 이벤트). 결과는 이 순서로 찾는다"""
    out = {}
    chron = [e for e in json.load(open(os.path.join(ROOT, "app", "data", "chronology.json")))["entries"]
             if e.get("id") and e.get("title")]
    for e in chron:
        out[e["id"]] = e["title"]
    events = json.load(open(os.path.join(ROOT, "app", "data", "stories.json")))["events"]
    for e in events:
        out[e["id"]] = e["name"]
    num = lambda i: int(re.sub(r"\D", "", i) or 0)
    order = [e["id"] for e in events if not e.get("unreleased")]
    order += sorted((e["id"] for e in chron if re.fullmatch(r"main_\d+", e["id"])), key=num)
    order += sorted((e["id"] for e in chron if re.fullmatch(r"rogue_\d+", e["id"])), key=num)
    order += [e["id"] for e in events if e.get("unreleased")]
    return out, order


def dump(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def main() -> None:
    title, order = names()
    rank = {sid: i for i, sid in enumerate(order)}
    if os.path.isdir(OUT_DIR):
        shutil.rmtree(OUT_DIR)
    meta: dict = {}
    digest = hashlib.sha1()
    for loc in LOCALES:
        src = SCRIPT_DIR if loc == "ko" else os.path.join(SCRIPT_DIR, loc)
        ids = sorted((f[:-5] for f in os.listdir(src) if f.endswith(".json") and f[:-5] in title),
                     key=lambda i: (rank.get(i, len(rank)), i))
        rows = []
        post: list[dict[str, list[int]]] = [{} for _ in range(SHARDS)]
        lines_total = 0
        for si, sid in enumerate(ids):
            data = json.load(open(os.path.join(src, f"{sid}.json")))
            out = []
            seen: set[str] = set()
            for ei, ep in enumerate(data.get("eps", [])):
                for li, ln in enumerate(ep.get("lines", [])):
                    text = ln.get("x") or ln.get("st")
                    if not text:
                        continue
                    out.append([ei, li, ln.get("n", ""), text])
                    seen.update(grams(norm(text)))
            for g in seen:
                post[fnv(g) % SHARDS].setdefault(g, []).append(si)
            dump(os.path.join(OUT_DIR, loc, "t", f"{sid}.json"), out)
            digest.update(json.dumps(out, ensure_ascii=False).encode())
            lines_total += len(out)
            t = title[sid]
            rows.append({"id": sid, "name": {k: t[k] for k in LOCALES if t.get(k)}})
        for i, shard in enumerate(post):
            dump(os.path.join(OUT_DIR, loc, "g", f"{i}.json"), shard)
        meta[loc] = rows
        print(f"{loc}: 이야기 {len(ids)}편 · 대사 {lines_total:,}줄 · 조각 {sum(len(p) for p in post):,}개")
    meta = {"ver": digest.hexdigest()[:8], **meta}
    dump(OUT_META, meta)
    print("ver", meta["ver"])


if __name__ == "__main__":
    main()
