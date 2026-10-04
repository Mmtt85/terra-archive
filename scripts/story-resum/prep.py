#!/usr/bin/env python3
"""요약 재집필 준비 — 이벤트 원문을 평문으로(src/<id>.txt), 기존 인물·용어 카드를 cards/<id>.json 으로.
사용: python3 prep.py <id> [<id> …]   → 한 줄 요약(평문 글자 수 · 목표 분량 · 컷씬 있음/없음) 출력"""
import glob, json, os, re, sys
REPO = "/Users/byeonghoseong/Documents/workspace/terra-archive"
R = os.path.dirname(os.path.abspath(__file__))
os.chdir(REPO)
for _d in ("src", "cards", "out", "work"):
    os.makedirs(f"{R}/{_d}", exist_ok=True)
rt = json.load(open(".gamedata/kr_story_review_table.json"))
summ = json.load(open("app/data/story-summaries.json"))
attr = lambda s, k: (re.search(k + r'\s*=\s*"([^"]*)"', s) or [None, None])[1]
# 그림 이름은 **디스크의 실제 대소문자**로 적는다 — 원문은 23_I01 처럼 대문자인데 파일은 23_i01.webp 다.
# macOS 는 대소문자를 안 가려 os.path.exists 가 통과하지만 라이브(R2)는 404 다 (2026-10-04 니어 라이트 12장).
_CUT = {n[:-5].lower(): n[:-5] for n in os.listdir("public/story/cut") if n.endswith(".webp")}
cut_name = lambda im: _CUT.get(im.lower(), im)
cut_ok = lambda im: im.lower() in _CUT


def kr_lines(fn):
    out = []
    state = {}
    for raw in open(fn, encoding="utf-8"):
        line = raw.strip()
        if not line: continue
        m = re.match(r'\[name="([^"]*)"\]\s*(.*)', line)
        if m: out.append(f"{m.group(1)}: {m.group(2)}"); continue
        m = re.match(r'\[multiline\(name="([^"]*)"[^\]]*\]\s*(.*)', line, re.I)
        if m: out.append(f"{m.group(1)}: {m.group(2)}"); continue
        if re.match(r'\[(subtitle|sticker)\(', line, re.I):
            tx = attr(line, "text")
            if tx: out.append(f"(자막) {tx}")
            continue
        if re.match(r'\[decision\(', line, re.I):
            out.append("[선택지] " + " / ".join((attr(line, "options") or "").split(";"))); continue
        if re.match(r'\[predicate\(', line, re.I):
            out.append(f"[선택지 {attr(line, 'references')}번 분기]"); continue
        if re.match(r'\[background\(', line, re.I):
            bg = attr(line, "image")
            if bg and bg != "bg_black" and bg != state.get("bg") and os.path.exists(f"public/story/bg/{bg}.webp"):
                out.append(f"[배경: {bg}]")
            state["bg"] = bg
            continue
        if re.match(r'\[image\(', line, re.I):
            im = attr(line, "image")
            if im: out.append(f"[CG: {cut_name(im)}" + ("" if cut_ok(im) else " (사이트에 그림 없음)") + "]")
            continue
        if line.startswith("["): continue
        out.append(f"(나레이션) {line}")
    return out


def kr_source(eid):
    out = []
    for i in sorted(rt[eid]["infoUnlockDatas"], key=lambda x: x["storySort"]):
        base = os.path.basename(i["storyTxt"])
        fn = f"story-scripts/{eid}/{base}.txt"
        if not os.path.exists(fn):
            fn = f".gamedata/story-cache/{i['storyTxt'].replace('/', '__')}.txt"
        if not os.path.exists(fn):
            raise SystemExit(f"{eid}: 원문 없음 {i['storyTxt']}")
        out.append(f"\n\n===== [{i['storySort']}] {i['storyCode']} {i['avgTag']} — {i['storyName']} =====\n")
        out += kr_lines(fn)
    return out


def cn_source(eid):
    out = []
    for fn in sorted(glob.glob(f"scripts/story-cn/{eid}/ko/ep_*.json")):
        d = json.load(open(fn, encoding="utf-8"))
        out.append(f"\n\n===== [{d['idx'] + 1}] {d.get('code', '')} {d.get('tag', '')} — {d.get('name', '')} =====\n")
        for l in d["lines"]:
            if "n" in l: out.append(f"{l['n']}: {l['x']}")
            elif "x" in l: out.append(f"(나레이션) {l['x']}")
            elif "st" in l: out.append(f"(자막) {l['st']}")
            elif "img" in l: out.append(f"[CG: {cut_name(l['img'])}" + ("" if cut_ok(l["img"]) else " (사이트에 그림 없음)") + "]")
            elif "opts" in l: out.append("[선택지] " + " / ".join(l["opts"]))
            elif "br" in l: out.append(f"[선택지 {l['br']}번 분기]")
    return out


def target(n):
    return (8000, 9500) if n < 100_000 else (9500, 11000) if n < 200_000 else (10500, 12000)


for eid in sys.argv[1:]:
    src = "cn" if os.path.isdir(f"scripts/story-cn/{eid}/ko") and eid not in (rt if os.path.isdir(f"story-scripts/{eid}") else {}) else "kr"
    if src == "kr" and eid not in rt:
        src = "cn"
    lines = cn_source(eid) if src == "cn" else kr_source(eid)
    txt = "\n".join(lines)
    open(f"{R}/src/{eid}.txt", "w", encoding="utf-8").write(txt)
    old = summ.get(eid) or {}
    json.dump({"chars": old.get("chars", []), "terms": old.get("terms", [])},
              open(f"{R}/cards/{eid}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    bgs = set(re.findall(r"\[배경: ([^\]]+)\]", txt))
    cgs = re.findall(r"\[CG: ([^\]\s]+)( \(사이트에 그림 없음\))?\]", txt)
    lo, hi = target(len(txt))
    meta = {"src": src, "chars": len(txt), "target": [lo, hi], "cg": len({c for c, _ in cgs}), "cg_missing": sorted({c for c, m in cgs if m}), "bg": len(bgs)}
    json.dump(meta, open(f"{R}/src/{eid}.meta.json", "w"), ensure_ascii=False)
    print(eid, json.dumps(meta, ensure_ascii=False))
