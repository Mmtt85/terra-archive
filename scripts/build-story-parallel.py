#!/usr/bin/env python3
"""공식 스토리 4개 언어 줄 정렬 말뭉치 → .gamedata/story-parallel.jsonl (gitignore)

  python3 scripts/build-story-parallel.py

한섭·글로벌·일섭에 이미 나온 스토리를 CN/KO/EN/JA 로 **줄 단위** 정렬해 둔다. 미실장(중섭 선행)
스토리를 다룰 때 고유명사·용어의 공식 표기를 찾는 데 쓴다 — 조회는 scripts/story-cn/_concord.py.
(2026-09-26: 이 말뭉치로 KO 기계 번역의 이름 오역 — 알로이제→공식 '알로이즈' 등 — 을 잡았다)

- 입력: .gamedata/story-cache/ 의 KR·EN·JP 대본 캐시 (build-story-scripts.py 가 채운다). CN 대본은
  같은 경로를 클뜯 레포에서 받아 cn__ 접두로 캐시한다 (처음 한 번 1,800여 건).
- 네 언어 모두 build-story-scripts.py 의 parse_story 로 파싱하고, 줄 수가 CN 과 같은 언어만 정렬한다
  (다르면 연출이 달라 줄이 밀린 것 — 그 언어만 뺀다).
- 한 줄 = {"f": 대본 경로, "cn": …, "n": CN 화자, "ko"/"en"/"ja": …}
"""
import importlib.util
import json
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("bss", os.path.join(REPO, "scripts", "build-story-scripts.py"))
bss = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bss)
CACHE = bss.CACHE
OUT = os.path.join(REPO, ".gamedata", "story-parallel.jsonl")
NICK = {"cn": "博士", "kr": "박사", "en": "Doctor", "jp": "ドクター"}
LOC = {"kr": "ko", "en": "en", "jp": "ja"}


def kr_files():
    return sorted(f for f in os.listdir(CACHE)
                  if f.endswith(".txt") and not f.startswith(("en__", "jp__", "cn__")))


def fetch_cn(files):
    todo = [f for f in files if not os.path.exists(os.path.join(CACHE, "cn__" + f))]

    def dl(f):
        path = f[:-4].replace("__", "/")
        try:
            req = urllib.request.Request(f"{bss.GAMEDATA}/cn/gamedata/story/{path}.txt",
                                         headers={"User-Agent": "terra-archive-parallel/1.0"})
            raw = urllib.request.urlopen(req, timeout=60).read()
        except Exception:  # noqa: BLE001 — CN 에 없는 경로(한섭 전용)는 건너뛴다
            return 1
        open(os.path.join(CACHE, "cn__" + f), "wb").write(raw)
        return 0

    with ThreadPoolExecutor(16) as ex:
        fails = sum(ex.map(dl, todo))
    print(f"CN 대본 {len(todo)}건 받음" + (f" (실패 {fails})" if fails else ""))


def parse(server, f):
    p = os.path.join(CACHE, f if server == "kr" else f"{server}__{f}")
    if not os.path.exists(p):
        return None
    bss.NICKNAME = NICK[server]
    return bss.parse_story(open(p, encoding="utf-8").read())


def main():
    files = kr_files()
    fetch_cn(files)
    n = 0
    with open(OUT, "w", encoding="utf-8") as out:
        for f in files:
            cn = parse("cn", f)
            if not cn:
                continue
            other = {sv: parse(sv, f) for sv in LOC}
            ok = {sv: bool(v) and len(v) == len(cn) for sv, v in other.items()}
            if not any(ok.values()):
                continue
            for i, a in enumerate(cn):
                for k in ("x", "st", "loc"):
                    if isinstance(a.get(k), str) and a[k]:
                        row = {"f": f[:-4], "cn": a[k], **({"n": a["n"]} if a.get("n") else {})}
                        for sv, loc in LOC.items():
                            if ok[sv] and isinstance(other[sv][i].get(k), str):
                                row[loc] = other[sv][i][k]
                        out.write(json.dumps(row, ensure_ascii=False) + "\n")
                        n += 1
                for j, o in enumerate(a.get("opts") or []):
                    row = {"f": f[:-4], "cn": o}
                    for sv, loc in LOC.items():
                        opts = other[sv][i].get("opts") if ok[sv] else None
                        if opts and len(opts) > j:
                            row[loc] = opts[j]
                    out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    n += 1
    print(f"{n}줄 → {os.path.relpath(OUT, REPO)} ({os.path.getsize(OUT) // 1024 // 1024}MB)")


if __name__ == "__main__":
    main()
