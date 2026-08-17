#!/usr/bin/env python3
"""통합전략 기록 원문 — 엔딩북 조각·월간 방문객 장면의 스토리 전문을 받아 JSON으로.

왜 (사용자 요청 2026-08-17 "엔딩·방문객 해금 스토리 정리 + 전문 읽기"):
roguelike_topic_table의 archiveComp.endbook(clientEndbookItemDatas[].textId)와
archiveComp.chat(chatItemList[].chatStoryId)가 gamedata 레포의 산문 텍스트
(story/obt/rogue/…)를 가리킨다. 이걸 로케일별로 받아 public/rogue/record/<id>.json
({"ko": [문단…], "en": …, "ja": …, "cn": …})으로 저장하면, build-rogue.py가 파일
존재를 보고 조각·장면에 txt 플래그를 붙이고 UI가 클릭 시 지연 로드한다.

로케일: rogue_1~5 = kr·en·jp (KR 정식 텍스트 — 번역 불필요), rogue_6 = cn (미출시).
일부 조각이 EN/JA 서버에 아직 없으면 그 로케일만 빠진다 (UI는 ko 폴백).

사용:  python3 scripts/build-rogue-records.py            # 캐시 사용
       python3 scripts/build-rogue-records.py --refresh  # 강제 재다운로드
⚠ build-rogue.py(txt 플래그)보다 먼저 돌릴 것. 산출물은 public/rogue라 배포 시
r2-sync 대상이다 (scripts/README.md).
"""
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(REPO, ".gamedata", "rogue", "records")
OUT_DIR = os.path.join(REPO, "public", "rogue", "record")
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"

# 테마 → 받을 로케일 gamedata 브랜치 (사이트 로케일 키와 브랜치가 다름: ja↔jp)
THEME_LOCALES = {
    "rogue_1": [("ko", "kr"), ("en", "en"), ("ja", "jp")],
    "rogue_2": [("ko", "kr"), ("en", "en"), ("ja", "jp")],
    "rogue_3": [("ko", "kr"), ("en", "en"), ("ja", "jp")],
    "rogue_4": [("ko", "kr"), ("en", "en"), ("ja", "jp")],
    "rogue_5": [("ko", "kr"), ("en", "en"), ("ja", "jp")],
    "rogue_6": [("cn", "cn")],
}


def topic_table(branch):
    prefix = "" if branch == "kr" else f"{branch}__"
    path = os.path.join(REPO, ".gamedata", "rogue", f"{prefix}excel__roguelike_topic_table.json")
    return json.load(open(path, encoding="utf-8"))["details"]


def record_ids(det):
    """이 테마의 (기록 id, story 경로) 목록 — 엔딩북 조각 + 방문객 장면."""
    out = []
    ac = det.get("archiveComp") or {}
    for b in ((ac.get("endbook") or {}).get("endbook") or {}).values():
        for it in b.get("clientEndbookItemDatas") or []:
            if it.get("textId"):
                out.append(it["textId"])
    for c in ((ac.get("chat") or {}).get("chat") or {}).values():
        for it in c.get("chatItemList") or []:
            if it.get("chatStoryId"):
                out.append(it["chatStoryId"])
    return out


def fetch_text(branch, text_id, refresh=False):
    """story 텍스트 1편 — 캐시 우선. 없거나 404면 None."""
    base = text_id.rsplit("/", 1)[-1]
    cache = os.path.join(CACHE, f"{branch}__{base}.txt")
    if os.path.exists(cache) and not refresh:
        raw = open(cache, encoding="utf-8").read()
        return raw if raw.strip() else None       # 빈 파일 = 이전에 404였음 (재시도 안 함)
    url = f"{GAMEDATA}/{branch}/gamedata/story/{text_id.lower()}.txt"
    try:
        raw = urllib.request.urlopen(
            urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30
        ).read().decode("utf-8")
    except Exception:
        raw = ""
    open(cache, "w", encoding="utf-8").write(raw)
    return raw if raw.strip() else None


def to_paras(raw):
    return [ln.strip().replace("\\n", " ") for ln in raw.replace("\r\n", "\n").split("\n") if ln.strip()]


def main():
    refresh = "--refresh" in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    tables = {}
    jobs = []   # (기록 base id, 사이트 로케일, 브랜치, textId)
    for tid, locs in THEME_LOCALES.items():
        for loc, branch in locs:
            if branch not in tables:
                tables[branch] = topic_table(branch)
            det = tables[branch].get(tid)
            if not det:
                continue
            for text_id in record_ids(det):
                jobs.append((text_id.rsplit("/", 1)[-1], loc, branch, text_id))
    with ThreadPoolExecutor(max_workers=8) as pool:
        texts = list(pool.map(lambda j: fetch_text(j[2], j[3], refresh), jobs))
    records = {}
    for (base, loc, _b, _t), raw in zip(jobs, texts):
        if raw:
            records.setdefault(base, {})[loc] = to_paras(raw)
    for base, locs in records.items():
        json.dump(locs, open(os.path.join(OUT_DIR, f"{base}.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))
    n_ko = sum(1 for v in records.values() if "ko" in v)
    n_en = sum(1 for v in records.values() if "en" in v)
    n_ja = sum(1 for v in records.values() if "ja" in v)
    n_cn = sum(1 for v in records.values() if "cn" in v)
    missing = [j for j, raw in zip(jobs, texts) if not raw]
    print(f"→ public/rogue/record/ {len(records)}편 (ko {n_ko} · en {n_en} · ja {n_ja} · cn {n_cn})")
    if missing:
        print(f"  미확보 {len(missing)}건 (해당 로케일 미출시 등):")
        for base, loc, _b, _t in missing[:10]:
            print(f"    {loc}: {base}")


if __name__ == "__main__":
    main()
