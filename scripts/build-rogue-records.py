#!/usr/bin/env python3
"""통합전략 기록 원문 — 엔딩북 조각·월간 방문객 장면의 스토리 전문을 받아 JSON으로.

왜 (사용자 요청 2026-08-17 "엔딩·방문객 해금 스토리 정리 + 전문 읽기"):
roguelike_topic_table의 archiveComp.endbook(clientEndbookItemDatas[].textId)와
archiveComp.chat(chatItemList[].chatStoryId)가 gamedata 레포의 산문 텍스트
(story/obt/rogue/…)를 가리킨다. 이걸 로케일별로 받아 public/rogue/record/<id>.json
({"ko": [문단…], "en": …, "ja": …, "cn": …})으로 저장하면, build-rogue.py가 파일
존재를 보고 조각·장면에 txt 플래그를 붙이고 UI가 클릭 시 지연 로드한다.

문단은 **산문이면 문자열, 대사면 {"c": char id, "n": 화자, "x": 대사}** 두 종류다
(IS1 방문객 기록만 대화 스크립트 — 아래 to_paras 주석). UI(app/rogue.tsx RecordModal)가
둘 다 받는다.

로케일: rogue_1~5 = kr·en·jp (KR 정식 텍스트 — 번역 불필요), rogue_6 = cn (미출시).
일부 조각이 EN/JA 서버에 아직 없으면 그 로케일만 빠진다 (UI는 ko 폴백).

사용:  python3 scripts/build-rogue-records.py            # 캐시 사용
       python3 scripts/build-rogue-records.py --refresh  # 강제 재다운로드
⚠ build-rogue.py(txt 플래그)보다 먼저 돌릴 것. 산출물은 public/rogue라 배포 시
r2-sync 대상이다 (scripts/README.md).
"""
import json
import os
import re
import sys
import urllib.request
from collections import Counter
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


# ── 대사형 기록 (IS1 월간 친목회) ───────────────────────────────────────────
# rogue_1 의 방문객 기록만 산문이 아니라 **대화 스크립트**다 (다른 테마는 전부 산문):
#   [Title] MAIN_LOG_100_1                          내부 키 — 화면에 쓸 문자열이 아니다
#   [Div] Part.01                                   조각 번호 — 모달 제목·층 표시와 중복
#   [Dialog(head="char_171_bldsk", delay=0)]대사     ← 이것만 본문
# 종전 to_paras()가 줄을 그대로 흘려서 명령어가 화면에 노출됐다 (사용자 제보 2026-09-06
# "팬텀록라 전시관 방문객 기록이 뭔가 이상하다"). head 의 char id 는 **로케일별**
# character_table 로 이름을 붙인다 — 한 파일에 KR/EN/JA 가 같이 들어가므로 브랜치별로.
RE_DIALOG = re.compile(r'^\[Dialog\s*\(([^)]*)\)\]\s*(.*)$', re.I)
RE_HEAD = re.compile(r'head\s*=\s*"([^"]*)"', re.I)
RE_CMD = re.compile(r'^\[[A-Za-z_]+\s*(?:\([^)]*\))?\]')   # 연출 명령 한 줄 (본문 아님)
DROPPED = Counter()   # 버린 명령 태그 — 새 테마가 다른 연출을 쓰면 리포트로 드러난다

_NAMES = {}


def char_names(branch):
    """브랜치별 char id → 오퍼레이터 이름. 표가 없으면 빈 사전(이름 없이 대사만)."""
    if branch not in _NAMES:
        path = os.path.join(REPO, ".gamedata", f"{branch}_character_table.json")
        try:
            tbl = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError):
            tbl = {}
        root = tbl.get("chars", tbl) if isinstance(tbl, dict) else {}
        _NAMES[branch] = {k: (v.get("name") or "").strip()
                          for k, v in root.items() if isinstance(v, dict)}
    return _NAMES[branch]


def to_paras(raw, names=None):
    """원문 → 문단 목록. 산문은 문자열 그대로, 대사는 {"c": char id, "n": 화자, "x": 대사}."""
    names = names or {}
    out = []
    for ln in raw.replace("\r\n", "\n").split("\n"):
        ln = ln.strip()
        if not ln:
            continue
        m = RE_DIALOG.match(ln)
        if m:
            txt = m.group(2).strip().replace("\\n", " ")
            if not txt:
                continue                                   # 연출만 있는 빈 대사 줄
            h = RE_HEAD.search(m.group(1))
            cid = h.group(1) if h else None
            who = names.get(cid) if cid else None
            out.append({"c": cid, "n": who, "x": txt} if who else {"x": txt})
            continue
        if RE_CMD.match(ln):
            DROPPED[re.match(r'^\[([A-Za-z_]+)', ln).group(1)] += 1
            continue
        out.append(ln.replace("\\n", " "))
    return out


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
    for (base, loc, branch, _t), raw in zip(jobs, texts):
        if raw:
            records.setdefault(base, {})[loc] = to_paras(raw, char_names(branch))
    # ⚠ **손으로 채운 로케일을 덮어쓰지 않는다** (2026-09-06). IS6은 CN뿐이라 ko 를 사람이
    # 번역해 넣어 뒀는데, 종전처럼 파일을 통째로 새로 쓰면 kr-big-patch 가 이 스크립트를
    # 돌리는 순간 그 번역이 조용히 날아간다. 받아 온 로케일이 이기고(공식 텍스트가 나오면
    # 번역을 대체), 안 받아온 로케일은 기존 파일 값을 그대로 살린다.
    stale = []
    for base, locs in records.items():
        path = os.path.join(OUT_DIR, f"{base}.json")
        try:
            old = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError):
            old = {}
        kept = {k: v for k, v in old.items() if k not in locs}
        if kept:
            src = locs.get("cn") or locs.get("ko") or next(iter(locs.values()), [])
            for k, v in kept.items():
                if len(v) != len(src):      # 원문 줄 수가 바뀌었으면 번역이 밀렸다는 뜻
                    stale.append(f"{base}:{k} ({len(v)}줄 ↔ 원문 {len(src)}줄)")
        merged = {**kept, **locs}
        json.dump({k: merged[k] for k in ("ko", "en", "ja", "cn") if k in merged},   # 순서 고정 = 무의미한 diff 방지
                  open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    n_ko = sum(1 for v in records.values() if "ko" in v)
    n_en = sum(1 for v in records.values() if "en" in v)
    n_ja = sum(1 for v in records.values() if "ja" in v)
    n_cn = sum(1 for v in records.values() if "cn" in v)
    missing = [j for j, raw in zip(jobs, texts) if not raw]
    n_say = sum(1 for v in records.values()
                if any(isinstance(p, dict) for ls in v.values() for p in ls))
    print(f"→ public/rogue/record/ {len(records)}편 (ko {n_ko} · en {n_en} · ja {n_ja} · cn {n_cn})"
          f" — 대사형 {n_say}편")
    if DROPPED:
        print(f"  연출 명령 제외: {dict(DROPPED)}")   # Title·Div 외가 뜨면 파서 확인
    if stale:
        print(f"  ⚠ 원문이 바뀌어 손번역이 밀렸을 수 있음 {len(stale)}건: {', '.join(stale[:5])}")
    if missing:
        print(f"  미확보 {len(missing)}건 (해당 로케일 미출시 등):")
        for base, loc, _b, _t in missing[:10]:
            print(f"    {loc}: {base}")


if __name__ == "__main__":
    main()
