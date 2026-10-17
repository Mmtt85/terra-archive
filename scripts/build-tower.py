#!/usr/bin/env python3
"""보안파견 — 맵 이름·배경과 내 정보 '보안파견' 칸용 이름표 (2026-10-17).

  app/data/towers.json              맵 이름 세 언어 {"tower_n_20": {"ko","en","ja"}} — 이어하기 칸이 바로 쓴다(작다)
  app/data/towers-detail{,.en,.ja}.json  보안파견 칸이 열 때 받는 이름표:
      towers   {id: [이름, 부제, 층 수, 하드 있음 0/1]}
      cards    {id: [이름, 설명]}   리더 카드(mainCards) + 보조 모듈(subCards)
      tactical {id: [직군, 설명, A|B]}   직군별 전술 장비
      seasons  {id: [이름, 열린 맵 id들]}
      missions {id: [설명, [[보상 아이템 id, 개수], …]]}  시즌 임무
      medals   {맵: {clear|hard|hidden: [훈장 id, 이름, 얻는 법]}}  맵별 훈장 셋
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
    out = {"towers": {}, "cards": {}, "tactical": {}, "seasons": {}, "missions": {}, "medals": {}}
    for i in fb.get("towers") or {}:
        r = pick("towers", i)
        out["towers"][i] = [r.get("name") or "", r.get("subName") or "", int(r.get("stageNum") or 0), 1 if r.get("hardLevels") else 0]
    for key in ("mainCards", "subCards"):
        for i in fb.get(key) or {}:
            r = pick(key, i)
            out["cards"][i] = [r.get("name") or "", clean(r.get("desc"))]
    for i in fb.get("tacticalBuffs") or {}:
        r = pick("tacticalBuffs", i)
        out["tactical"][i] = [r.get("profession") or "", clean(r.get("desc")), r.get("buffType") or ""]   # buffType A/B
    for i in fb.get("seasonInfos") or {}:
        r = pick("seasonInfos", i)
        out["seasons"][i] = [r.get("name") or "", r.get("towers") or []]   # [이름, 이번 시즌에 열린 맵]
    # ── 보안파견 가이드(/sss, 2026-10-17)용 — 내 정보는 위 칸만 쓴다 ──
    # info   {맵: {desc, danger, hardDesc, boss, card, curses[], tasks[[층, [[아이템, 개수]…]]…], levels[], training}}
    # cardInfo {카드: [종류 TOWER|SEASON, 연결 맵, 보조 모듈 id들]}   curses {id: [이름, 설명]}
    # seasonInfo {시즌: [시작, 끝, 시즌 카드들]}   const {숫자 규칙 몇 개}
    out["info"], out["cardInfo"], out["curses"], out["seasonInfo"] = {}, {}, {}, {}
    for i in fb.get("towers") or {}:
        r, r0 = pick("towers", i), (fb.get("towers") or {}).get(i) or {}
        out["info"][i] = {
            "desc": clean(r.get("desc")), "danger": clean(r.get("dangerDesc")), "hardDesc": clean(r.get("hardModeDesc")),
            "boss": r0.get("bossId"), "card": r0.get("cardId"), "curses": sorted(set(r0.get("curseCardIds") or [])),
            "tasks": [[x.get("levelNum"), [[w.get("id"), int(w.get("count") or 0)] for w in x.get("rewards") or []]] for x in r0.get("taskInfo") or []],
            "levels": r0.get("levels") or [], "training": 1 if r0.get("towerType") == "TRAINING" else 0,
        }
    for i, r0 in (fb.get("mainCards") or {}).items():
        out["cardInfo"][i] = [r0.get("type") or "", r0.get("linkedTowerId"), r0.get("subCardIds") or []]
    for i in fb.get("curseCards") or {}:
        r = pick("curseCards", i)
        out["curses"][i] = [r.get("name") or "", clean(r.get("desc"))]
    for i, r0 in (fb.get("seasonInfos") or {}).items():
        out["seasonInfo"][i] = [int(r0.get("startTs") or 0), int(r0.get("endTs") or 0), r0.get("seasonCards") or []]
    dc = t.get("detailConst") or fb.get("detailConst") or {}
    out["const"] = {k: dc.get(k) for k in ("initCharCount", "charRecruitTimes", "charRecruitChoiceCount", "assistCharLimit", "subCardObtainDesc", "lowerItemId", "lowerItemLimit", "higherItemId", "higherItemLimit")}
    for i, r0 in (fb.get("missionData") or {}).items():
        if r0.get("type") == "TOWERSEASON":
            # [설명, 보상 [[아이템 id, 개수], …]] — 보상도 보여 달라 (사용자 요청 2026-10-17)
            out["missions"][i] = [clean(pick("missionData", i).get("description")),
                                  [[x.get("id"), int(x.get("count") or 0)] for x in r0.get("rewards") or [] if x.get("id")]]
    # 맵별 훈장 — [훈장 id, 이름, 얻는 법] 셋: 완료(medal_tower_complete_NN) · 긴급 보급 완료(medal_hardtower_complete_NN) ·
    # 히든(medal_hidden_tower_NN — 재시도 없이 완벽하게, 사용자 요청 2026-10-17 "히든 훈장 획득 여부")
    for i, r in (t.get("_medals") or fb.get("_medals") or {}).items():
        m = re.fullmatch(r"medal_(tower_complete|hardtower_complete|hidden_tower)_(\d+)", i)
        if not m:
            continue
        kind = {"tower_complete": "clear", "hardtower_complete": "hard", "hidden_tower": "hidden"}[m.group(1)]
        out["medals"].setdefault(f"tower_n_{m.group(2)}", {})[kind] = [i, r.get("medalName") or "", clean(r.get("getMethod") or r.get("description"))]
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
        mp = os.path.join(G, f"{server}_medal_table.json")
        if t and os.path.exists(mp):
            t["_medals"] = {r["medalId"]: r for r in json.load(open(mp, encoding="utf-8")).get("medalList") or [] if "tower" in r.get("medalId", "")}
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
