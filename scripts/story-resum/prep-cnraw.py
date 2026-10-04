#!/usr/bin/env python3
"""한국 서버에 스토리 원문이 없는 이벤트 — 중국 서버 원문(중국어)을 그대로 평문화한다 (2026-10-04).

「불을 쫓는 낙엽」(act24side, 몬스터 헌터 콜라보 落叶逐火)은 한섭 story_review_table 에는 있는데 한국어 대본이
gamedata 레포에도 한섭 게임 CDN 매니페스트에도 없다(콜라보 판권으로 내려간 것으로 본다). 그래서 중섭 대본을
prep.py 와 같은 꼴로 평문화하고, 집필 에이전트가 중국어 원문을 읽고 한국어로 요약한다(이름은 한국 공식 표기).

  python3 scripts/story-resum/prep-cnraw.py act24side
"""
import json, os, runpy, sys, urllib.request
R = os.path.dirname(os.path.abspath(__file__))
_argv, sys.argv = sys.argv, [sys.argv[0]]
P = runpy.run_path(os.path.join(R, "prep.py"))
sys.argv = _argv
os.chdir(P["REPO"])
G = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/cn/gamedata"
review = json.load(urllib.request.urlopen(f"{G}/excel/story_review_table.json", timeout=60))
for eid in sys.argv[1:]:
    e = review[eid]
    out = [f"# {e['name']} — 중국 서버 원문(중국어). 한국 서버 대본이 없어 이걸 읽고 한국어로 요약한다."]
    for k, info in enumerate(sorted(e["infoUnlockDatas"], key=lambda i: i["storySort"]), 1):
        dest = os.path.join(".gamedata/story-cache", "cn__" + info["storyTxt"].replace("/", "__") + ".txt")
        if not os.path.exists(dest):
            open(dest, "wb").write(urllib.request.urlopen(f"{G}/story/{info['storyTxt']}.txt", timeout=60).read())
        out.append(f"\n\n===== [{k}] {info.get('storyCode') or ''} {info.get('avgTag') or ''} — {info.get('storyName') or ''} =====\n")
        out += P["kr_lines"](dest)
    txt = "\n".join(out)
    open(f"{R}/src/{eid}.txt", "w", encoding="utf-8").write(txt)
    old = P["summ"].get(eid) or {}
    json.dump({"chars": old.get("chars", []), "terms": old.get("terms", [])}, open(f"{R}/cards/{eid}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # 중국어는 같은 내용이 한국어보다 짧다 — 분량 목표는 한국어 환산(×1.4)으로 잡는다
    lo, hi = P["target"](int(len(txt) * 1.4))
    import re
    meta = {"src": "cn-raw", "chars": len(txt), "target": [lo, hi], "cg": len(set(re.findall(r"\[CG: ([^\]\s]+)\]", txt))), "cg_missing": sorted(set(re.findall(r"\[CG: ([^\]\s]+) \(사이트에 그림 없음\)\]", txt))), "bg": len(set(re.findall(r"\[배경: ([^\]]+)\]", txt)))}
    json.dump(meta, open(f"{R}/src/{eid}.meta.json", "w"), ensure_ascii=False)
    print(eid, json.dumps(meta, ensure_ascii=False))
