#!/usr/bin/env python3
"""통합전략 테마(rogue_1~5) 요약 원문 평문화 — prep.py 의 통합전략판 (2026-10-04 사용자 지시 "통합전략 5편").

통합전략은 story_review_table 에 에피소드 구성이 없어 prep.py 로 못 만든다. 이야기가 여러 곳에 흩어져 있어서 모은다:
  ① 도입·엔딩 대본 — 게임 공식 한국어 AVG (gamedata story/obt/roguelike/roN/level_rogueN_entry·ending_K, ref_*)
  ② 엔딩 정보 — roguelike_topic_table endings (이름·설명)
  ③ 엔딩 기록(엔딩북 조각) · ④ 월간 방문객 장면 — public/rogue/record/*.json (build-rogue-records.py 가 받아 둔 한국어 원문)
  ⑤ 조우 사건 — roguelike_topic_table choiceScenes(제목·본문) + choices(선택지)
그림: 엔딩북 cgId · 대본 속 [CG] · public/story/cut/pic_rogue_N_* 목록.

  python3 scripts/story-resum/prep-rogue.py rogue_1 [rogue_2 …]
산출: src/<id>.txt · src/<id>.meta.json · cards/<id>.json (prep.py 와 같은 꼴 — merge.py 그대로 쓴다)
"""
import json
import os
import re
import runpy
import sys
import urllib.request

R = os.path.dirname(os.path.abspath(__file__))
_argv, sys.argv = sys.argv, [sys.argv[0]]
P = runpy.run_path(os.path.join(R, "prep.py"))   # kr_lines·cut_name·target 를 빌린다 (인자 없이 돌면 아무것도 안 만든다)
sys.argv = _argv
REPO = P["REPO"]
os.chdir(REPO)
kr_lines, target, cut_name = P["kr_lines"], P["target"], P["cut_name"]
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
CACHE = ".gamedata/story-cache"
TOPIC = json.load(open(".gamedata/roguelike_topic_table.json", encoding="utf-8"))
SUMM = json.load(open("app/data/story-summaries.json", encoding="utf-8"))
CUTS = sorted(n[:-5] for n in os.listdir("public/story/cut") if n.endswith(".webp"))


def story(path):
    """gamedata story txt (KR) — 캐시 후 경로 반환, 없으면 None"""
    dest = os.path.join(CACHE, "kr__" + path.replace("/", "__") + ".txt")
    if not os.path.exists(dest):
        try:
            with urllib.request.urlopen(f"{GAMEDATA}/kr/gamedata/story/{path}.txt", timeout=60) as r:
                data = r.read()
        except Exception:
            return None
        os.makedirs(CACHE, exist_ok=True)
        open(dest, "wb").write(data)
    return dest


def record(rid):
    f = f"public/rogue/record/{rid}.json"
    if not os.path.exists(f):
        return []
    out = []
    for p in json.load(open(f, encoding="utf-8")).get("ko") or []:
        out.append(p if isinstance(p, str) else f"{p.get('n', '')}: {p.get('x', '')}")
    return out


def build(tid):
    n = tid.split("_")[1]
    det = TOPIC["details"][tid]
    topic = TOPIC["topics"][tid]
    out = [f"# 통합전략 {n} 「{topic['name']}」", ""]
    sec = 0

    def head(title):
        nonlocal sec
        sec += 1
        out.append(f"\n\n===== [{sec}] {title} =====\n")

    # ① 도입
    f = story(f"obt/roguelike/ro{n}/level_rogue{n}_entry")
    if f:
        head("도입 대본")
        out += kr_lines(f)
    # ② 지역(층) 설명
    zs = [z for z in det["zones"].values() if z.get("description")]
    if zs and len(zs) <= 30:
        head("지역(층) 소개")
        for z in zs:
            out.append(f"[지역] {z.get('name')}: {z['description']}")
    # ③ 엔딩 대본 + 엔딩 정보 + 엔딩 기록
    endings = sorted(det["endings"].values(), key=lambda e: e["id"])
    books = {b["endingId"]: b for b in det["archiveComp"].get("endbook", {}).get("endbook", {}).values()}
    for k, e in enumerate(endings, 1):
        head(f"엔딩 {k} 「{e['name']}」")
        out.append(f"[엔딩 설명] {e.get('desc') or ''}")
        f = story(f"obt/roguelike/ro{n}/level_rogue{n}_ending_{k}")
        if f:
            out.append("[엔딩 대본]")
            out += kr_lines(f)
        b = books.get(e["id"])
        if b:
            if b.get("cgId") and b["cgId"].lower() in {c.lower() for c in CUTS}:
                out.append(f"[CG: {cut_name(b['cgId'])}]")
            out.append(f"[엔딩 기록 「{b.get('title')}」]")
            for it in b.get("clientEndbookItemDatas", []):
                out.append(f"— 「{it.get('endbookName')}」")
                out += record(it["endBookId"])
    # ④ 참고 대본(ref)
    for ref in ("ref_rogue_%s" % n, "ref_rogue_%s_2" % n, "ref_rogue_%s_dlc1" % n, "ref_rogue_%s_dlc2" % n, "ref/ref_rogue_%s" % n, "ref/ref_rogue_%s_2" % n):
        f = story(f"obt/roguelike/ro{n}/{ref}")
        if f:
            head(f"참고 대본 {ref.split('/')[-1]}")
            out += kr_lines(f)
    # ⑤ 월간 방문객 장면
    chats = sorted(det["archiveComp"].get("chat", {}).get("chat", {}).items(), key=lambda kv: kv[1].get("sortId", 0))
    for cid, c in chats:
        head(f"월간 방문객 기록 {c.get('sortId')}")
        for it in c.get("chatItemList", []):
            if it.get("chatDesc"):
                out.append(f"[{it.get('floor')}층] {it['chatDesc']}")
            out += record(it["chatStoryId"].split("/")[-1])
    # ⑥ 조우 사건 — 장면 본문 + 그 장면으로 이어지는 선택지 제목 (선택지 설명은 보상 수치라 뺀다)
    strip = lambda x: re.sub(r"<[@$/][^>]*>", "", x or "").strip()
    into = {}
    for c in det["choices"].values():
        if c.get("nextSceneId") and strip(c.get("title")):
            into.setdefault(c["nextSceneId"], []).append(strip(c["title"]))
    head("조우 사건 (게임 속 이벤트 노드 — 제목·본문, ← 는 그 장면으로 이어지는 선택지)")
    seen = set()
    for sid, sc in det["choiceScenes"].items():
        d = strip(sc.get("description"))
        if not d or d in seen:
            continue
        seen.add(d)
        pre = into.get(sid, [])
        out.append((f"  ← 선택: {' / '.join(dict.fromkeys(pre))}\n" if pre else "") + f"[조우: {strip(sc.get('title'))}] {d}")
    # 그림 목록
    pics = [c for c in CUTS if c.lower().startswith(f"pic_rogue_{n}_")]
    out.append("\n\n===== [그림 목록] 이 테마에 쓸 수 있는 그림 (public/story/cut/<이름>.webp) =====")
    out.append(", ".join(pics))
    return "\n".join(out), pics


for tid in sys.argv[1:]:
    txt, pics = build(tid)
    open(f"{R}/src/{tid}.txt", "w", encoding="utf-8").write(txt)
    old = SUMM.get(tid) or {}
    json.dump({"chars": old.get("chars", []), "terms": old.get("terms", [])},
              open(f"{R}/cards/{tid}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    body = txt.split("===== [그림 목록]")[0]
    lo, hi = target(len(body))
    cgs = set(re.findall(r"\[CG: ([^\]\s]+)\]", txt))
    meta = {"src": "kr", "chars": len(body), "target": [lo, hi], "cg": len(cgs), "cg_missing": [], "bg": len(set(re.findall(r"\[배경: ([^\]]+)\]", txt))), "pics": len(pics)}
    json.dump(meta, open(f"{R}/src/{tid}.meta.json", "w"), ensure_ascii=False)
    print(tid, json.dumps(meta, ensure_ascii=False))
