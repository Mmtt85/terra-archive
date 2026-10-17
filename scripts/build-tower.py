#!/usr/bin/env python3
"""보안파견 — 맵 이름·배경과 내 정보 '보안파견' 칸용 이름표 (2026-10-17).

  app/data/towers.json              맵 이름 세 언어 {"tower_n_20": {"ko","en","ja"}} — 이어하기 칸이 바로 쓴다(작다)
  app/data/towers-detail{,.en,.ja}.json  보안파견 칸이 열 때 받는 이름표:
      towers   {id: [이름, 부제, 층 수, 하드 있음 0/1]}
      cards    {id: [이름, 설명]}   리더 카드(mainCards) + 보조 모듈(subCards)
      tactical {id: [직군, 설명]}   직군별 전술 장비
      seasons  {id: 이름}
      missions {id: 설명}           시즌 임무
  public/tower/<id>.webp            게임 보안파견 화면의 맵 배경(towerbkg, 1024×864 → 720) — 없는 것만 받는다

이어하기·보안파견 칸은 계정 원본의 tower(current·outer·season)를 워커가 추린 것이다 (workers/account towerDigest).
새 그림이 생기면 node scripts/r2-sync.mjs (배포가 한다).

  python3 scripts/build-tower.py [.gamedata]
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".gamedata")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
DATA = os.path.join(ROOT, "app", "data")


def table(server):
    p = os.path.join(G, f"{server}_climb_tower_table.json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}


def clean(text):
    """게임 서식 태그(<@ba.vup>…</>, <color=…>…</color>)를 걷는다"""
    return re.sub(r"<[^>]*>", "", text or "").strip()


def detail(t, fb):
    """한 언어치 이름표 — 그 언어 표에 없는 id 는 fb(한섭 표)에서"""
    def pick(key, i):
        return (t.get(key) or {}).get(i) or (fb.get(key) or {}).get(i) or {}
    out = {"towers": {}, "cards": {}, "tactical": {}, "seasons": {}, "missions": {}}
    for i in fb.get("towers") or {}:
        r = pick("towers", i)
        out["towers"][i] = [r.get("name") or "", r.get("subName") or "", int(r.get("stageNum") or 0), 1 if r.get("hardLevels") else 0]
    for key in ("mainCards", "subCards"):
        for i in fb.get(key) or {}:
            r = pick(key, i)
            out["cards"][i] = [r.get("name") or "", clean(r.get("desc"))]
    for i in fb.get("tacticalBuffs") or {}:
        r = pick("tacticalBuffs", i)
        out["tactical"][i] = [r.get("profession") or "", clean(r.get("desc"))]
    for i in fb.get("seasonInfos") or {}:
        out["seasons"][i] = pick("seasonInfos", i).get("name") or ""
    for i, r0 in (fb.get("missionData") or {}).items():
        if r0.get("type") == "TOWERSEASON":
            out["missions"][i] = clean(pick("missionData", i).get("description"))
    return out


def retired(server):
    """표에서 빠진 초기 맵(tower_n_01~04) — 계정 기록엔 남아 있다. 이름은 훈장 '[아이언 캐럿 광산] 완료'에서, 층 수는 작전 표에서"""
    out = {}
    mp = os.path.join(G, f"{server}_medal_table.json")
    sp = os.path.join(G, f"{server}_stage_table.json")
    if not os.path.exists(mp):
        return out
    stages = json.load(open(sp, encoding="utf-8")).get("stages") or {} if os.path.exists(sp) else {}
    for r in json.load(open(mp, encoding="utf-8")).get("medalList") or []:
        m = re.fullmatch(r"medal_tower_complete_(\d+)", r.get("medalId") or "")
        name = re.search(r"[\[【]([^\]】]+)[\]】]", r.get("getMethod") or "")
        if m and name:
            tid = f"tower_n_{m.group(1)}"
            n = sum(1 for st in stages.values() if st.get("zoneId") == tid and not (st.get("stageId") or "").endswith("_ex"))
            out[tid] = {"id": tid, "name": name.group(1), "subName": "", "stageNum": n, "hardLevels": []}
    return out


def main():
    kr, en, jp = table("kr"), table("en"), table("jp")
    if not kr:
        sys.exit("✗ kr_climb_tower_table 이 없다")
    # 표에서 빠진 초기 맵을 앞에 끼운다 (이미 있는 id 는 표가 이긴다)
    for t, server in ((kr, "kr"), (en, "en"), (jp, "jp")):
        if t:
            t["towers"] = {**{k: v for k, v in retired(server).items() if k not in (t.get("towers") or {})}, **(t.get("towers") or {})}
    names = {}
    for tid, base in (kr.get("towers") or {}).items():
        names[tid] = {"ko": base["name"], "en": ((en.get("towers") or {}).get(tid) or base)["name"],
                      "ja": ((jp.get("towers") or {}).get(tid) or base)["name"]}
    json.dump(names, open(os.path.join(DATA, "towers.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    for suf, t in (("", kr), (".en", en), (".ja", jp)):
        json.dump(detail(t, kr), open(os.path.join(DATA, f"towers-detail{suf}.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))

    d = os.path.join(ROOT, "public", "tower")
    os.makedirs(d, exist_ok=True)
    import cdnassets
    got = miss = 0
    for tid in names:
        dest = os.path.join(d, f"{tid}.webp")
        if os.path.exists(dest):
            continue
        try:
            im = cdnassets.image(f"arts/ui/[uc]climbtower/towerbkg/bkg_{tid}")
        except Exception:
            im = None
        if im is None:
            miss += 1   # 훈련장(tower_tr_*)·초기 맵(tower_n_01~04)은 배경이 없다
            continue
        im = im.convert("RGB")
        if im.width > 720:
            im = im.resize((720, round(im.height * 720 / im.width)))
        im.save(dest, "WEBP", quality=82, method=6)
        got += 1
    print(f"  towers.json: 보안파견 {len(names)}곳 · 이름표 세 언어 · 배경 새로 {got}장 (없음 {miss})")


if __name__ == "__main__":
    main()
