# 통합전략(로그라이크) 데이터 빌드 — app/data/rogue1.json
#
# Usage:
#   python3 scripts/build-rogue.py            # rogue_1 (팬텀 & 크림슨 솔리테어)
#
# 소스 (ArknightsAssets/ArknightsGamedata kr — PROJECT-GUIDE §2 클뜯 레포):
#   excel/roguelike_topic_table.json  — 존·스테이지·유물·레퍼토리(음반)·환각·난이도·엔딩·조우 씬
#   levels/obt/roguelike/ro1/*.json   — 스테이지별 등장 적(enemyDbRefs)·스폰 수(waves)·긴급 배율(runes)
#   levels/enemydata/enemy_database.json — 적 스탯 원본 (level별)
#   excel/enemy_handbook_table.json   — 적 도감 텍스트 (이름·급·공격방식·능력)
#
# 조우(우연한 만남)의 층별 출현 규칙과 엔딩 선제조건은 클라 테이블에 없어
# scripts/rogue1-curated.json (PRTS 위키 기반 수작업 큐레이션)에서 병합한다.
import json, os, sys, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
CACHE = os.path.join(REPO, ".gamedata", "rogue")
os.makedirs(CACHE, exist_ok=True)

def fetch_json(path):
    """kr gamedata JSON — .gamedata/rogue 에 캐시."""
    cache = os.path.join(CACHE, path.replace("/", "__"))
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    url = f"{GAMEDATA}/kr/gamedata/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req).read()
    open(cache, "wb").write(raw)
    return json.loads(raw)

def mv(field, default=None):
    """enemy_database의 {m_defined, m_value} 언랩."""
    if isinstance(field, dict) and "m_defined" in field:
        return field["m_value"] if field["m_defined"] else default
    return field if field is not None else default

def num(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return round(v, 3) if isinstance(v, float) else v


def build_rogue1():
    table = fetch_json("excel/roguelike_topic_table.json")
    topic = table["topics"]["rogue_1"]
    r = table["details"]["rogue_1"]
    handbook = fetch_json("excel/enemy_handbook_table.json")["enemyData"]
    enemy_db = fetch_json("levels/enemydata/enemy_database.json")

    items = r["items"]  # 유물/음반/티켓 등 표시 텍스트

    # ── 존 (portal_* 변형 존은 원본과 중복이라 제외) ──────────────────────────
    zones = []
    for zid, z in r["zones"].items():
        if zid.startswith("portal_"):
            continue
        desc = (z.get("description") or "").split("\n", 1)
        zones.append({
            "id": zid, "num": int(zid.split("_")[1]), "name": z["name"],
            "time": desc[0] if len(desc) > 1 else None,
            "desc": desc[1] if len(desc) > 1 else desc[0],
            "buff": z.get("buffDescription"), "hidden": bool(z.get("isHiddenZone")),
        })
    zones.sort(key=lambda z: z["num"])

    # ── 스테이지 + 레벨 파일 (일반/긴급이 같은 levelId 공유 → 캐시) ──────────
    level_cache = {}
    def load_level(level_id):
        if level_id in level_cache:
            return level_cache[level_id]
        lv = fetch_json(f"levels/{level_id.lower()}.json")
        # 등장 적: enemyDbRefs 순서 = 인게임 표시 순서
        refs = [{"key": e["id"], "level": e.get("level", 0),
                 "over": e.get("overwrittenData")} for e in lv.get("enemyDbRefs", [])]
        # 스폰 수: waves + branches(조건 스폰 — 최대치 기준)
        counts = {}
        def count_actions(actions):
            for a in actions or []:
                if a.get("actionType") in (0, "SPAWN") and a.get("key"):
                    counts[a["key"]] = counts.get(a["key"], 0) + a.get("count", 1)
        for w in lv.get("waves", []):
            for f in w.get("fragments", []):
                count_actions(f.get("actions"))
        for b in (lv.get("branches") or {}).values():
            for ph in b.get("phases", []):
                count_actions(ph.get("actions"))
        # 긴급 작전 배율: FOUR_STAR 룬의 enemy_attribute_mul / enemy_attribute_add
        emg = {}
        for rune in lv.get("runes") or []:
            if rune.get("difficultyMask") not in ("FOUR_STAR", 8):
                continue
            key = rune.get("key")
            if key not in ("enemy_attribute_mul", "enemy_attribute_add"):
                continue
            for bb in rune.get("blackboard", []):
                if bb.get("value") is not None:
                    emg.setdefault(key.rsplit("_", 1)[1], {})[bb["key"]] = num(bb["value"])
        level_cache[level_id] = {"refs": refs, "counts": counts, "emg": emg}
        return level_cache[level_id]

    used_enemies = {}  # key → {level, over} (스탯 해석용 대표 ref)
    stages = []
    for st in r["stages"].values():
        sid = st["id"]
        parts = sid.split("_")  # ro1_n_1_1 / ro1_e_1_1 / ro1_b_1 / ro1_ev_1 / ro1_t_1
        kind_code = parts[1]
        kind = {"n": "normal", "e": "emergency", "b": "boss", "ev": "event", "t": "duel"}.get(kind_code, kind_code)
        zone = int(parts[2]) if kind_code in ("n", "e") else None
        lv = load_level(st["levelId"])
        enemies = []
        for ref in lv["refs"]:
            cnt = lv["counts"].get(ref["key"], 0)
            enemies.append({"key": ref["key"], "cnt": cnt})
            cur = used_enemies.get(ref["key"])
            if cur is None or ref["level"] > cur["level"]:
                used_enemies[ref["key"]] = ref
        stages.append({
            "id": sid, "kind": kind, "zone": zone, "code": st.get("code"),
            "name": st["name"], "desc": st.get("description"),
            "eliteDesc": st.get("eliteDesc") or None,
            "emg": lv["emg"] if kind == "emergency" else None,
            "enemies": enemies,
        })
    order = {"normal": 0, "emergency": 1, "boss": 2, "event": 3, "duel": 4}
    stages.sort(key=lambda s: (order.get(s["kind"], 9), s["zone"] or 0, s["id"]))

    # ── 적 도감 (등장 적만) ───────────────────────────────────────────────────
    enemies = {}
    for key, ref in used_enemies.items():
        db = enemy_db.get(key)
        if not db:
            continue
        by_level = {e["level"]: e["enemyData"] for e in db}
        base = by_level.get(0, db[0]["enemyData"])
        pick = by_level.get(ref["level"], base)
        def attr(name, default=None):
            v = mv((pick.get("attributes") or {}).get(name))
            if v is None:
                v = mv((base.get("attributes") or {}).get(name), default)
            # 레벨 파일 overwrittenData가 최종 오버라이드
            ow = ((ref.get("over") or {}).get("attributes") or {}).get(name)
            ov = mv(ow) if ow else None
            return ov if ov is not None else v
        hb = handbook.get(key) or handbook.get(key.rsplit("_", 1)[0]) or {}
        name = mv(pick.get("name")) or mv(base.get("name")) or hb.get("name") or key
        enemies[key] = {
            "name": name,
            "rank": hb.get("enemyLevel"),  # NORMAL/ELITE/BOSS
            "index": hb.get("enemyIndex"),
            "attack": hb.get("attackType"),
            "desc": hb.get("description"),
            "ability": hb.get("ability"),
            "hp": num(attr("maxHp", 0)), "atk": num(attr("atk", 0)),
            "def": num(attr("def", 0)), "res": num(attr("magicResistance", 0)),
            "aspd": num(attr("attackSpeed", 100)), "ms": num(attr("moveSpeed", 1)),
            "weight": num(attr("massLevel", 1)),
            "lifePoint": mv(pick.get("lifePointReduce"), mv(base.get("lifePointReduce"), 1)),
        }

    # ── 전시관: 유물(소장품) / 레퍼토리(음반) / 무대 도구 / 분대 ─────────────
    relic_order = (r["archiveComp"]["relic"] or {}).get("relic", {})
    relics = []
    for iid, it in items.items():
        if it.get("type") != "RELIC":
            continue
        arc = relic_order.get(iid, {})
        relics.append({
            "id": iid, "name": it["name"], "desc": it.get("description"),
            "usage": it.get("usage"), "obtain": it.get("obtainApproach"),
            "order": arc.get("orderId"), "group": arc.get("relicGroupId"),
            "sort": arc.get("relicSortId", 9999), "sp": bool(arc.get("isSpRelic")),
        })
    relics.sort(key=lambda x: x["sort"])

    capsules = []
    cap_order = (r["archiveComp"]["capsule"] or {}).get("capsule", {})
    for iid, it in items.items():
        if it.get("type") != "CAPSULE":
            continue
        arc = cap_order.get(iid, {})
        capsules.append({
            "id": iid, "name": it["name"], "en": arc.get("englishName"),
            "desc": it.get("description"), "usage": it.get("usage"),
            "sort": arc.get("capsuleSortId", 9999),
        })
    capsules.sort(key=lambda x: x["sort"])

    tools = [{"id": iid, "name": it["name"], "desc": it.get("description"), "usage": it.get("usage")}
             for iid, it in items.items() if it.get("type") == "ACTIVE_TOOL"]
    bands = [{"id": iid, "name": it["name"], "desc": it.get("description"), "usage": it.get("usage")}
             for iid, it in items.items() if it.get("type") == "BAND"]

    # ── 환각(variation) + 융합(fusion) ────────────────────────────────────────
    variations = [{"id": k, "name": v.get("outerName") or v.get("innerName"),
                   "func": v.get("functionDesc"), "desc": v.get("desc"), "fusion": False}
                  for k, v in r["variationData"].items()]
    variations += [{"id": k, "name": v.get("name"), "func": v.get("functionDesc"),
                    "desc": v.get("desc"), "fusion": True}
                   for k, v in r["fusionData"].items()]

    # ── 난이도 (EASY + NORMAL 0~15; 월간/심층은 표기만) ──────────────────────
    difficulties = [{
        "mode": d["modeDifficulty"], "grade": d["grade"], "name": d["name"],
        "rule": d.get("ruleDesc"), "score": d.get("scoreFactor"),
    } for d in r["difficulties"]]

    # ── 엔딩 + 기록 텍스트 ────────────────────────────────────────────────────
    endings = [{
        "id": e["id"], "name": e["name"], "desc": e.get("desc"),
        "boss": e.get("bossIconId"), "priority": e.get("priority", 0),
        "change": e.get("changeEndingDesc"),
    } for e in r["endings"].values()]
    endings.sort(key=lambda x: x["priority"])

    # ── 조우 씬 (enter 씬 + 선택지 텍스트) ────────────────────────────────────
    encounters = []
    for sid, sc in r["choiceScenes"].items():
        if not sid.endswith("_enter"):
            continue
        prefix = sid[: -len("_enter")].replace("scene_", "choice_")
        chs = [{"title": c["title"], "desc": c.get("description")}
               for cid, c in sorted(r["choices"].items())
               if cid.startswith(prefix + "_")]
        encounters.append({
            "scene": sid, "title": sc["title"], "desc": sc.get("description"),
            "choices": chs,
        })
    encounters.sort(key=lambda x: x["scene"])

    # ── 수작업 큐레이션 병합 (조우 층 규칙·엔딩 조건 — PRTS 기반) ─────────────
    curated_path = os.path.join(REPO, "scripts", "rogue1-curated.json")
    if os.path.exists(curated_path):
        curated = json.load(open(curated_path, encoding="utf-8"))
        floors = curated.get("encounterFloors", {})
        notes = curated.get("encounterNotes", {})
        for enc in encounters:
            if enc["scene"] in floors:
                enc["floors"] = floors[enc["scene"]]
            if enc["scene"] in notes:
                enc["note"] = notes[enc["scene"]]
        conds = curated.get("endingConds", {})
        for e in endings:
            if e["id"] in conds:
                e["cond"] = conds[e["id"]]

    out = {
        "id": "rogue_1",
        "name": topic["name"],
        "line": topic.get("lineText"),
        "zones": zones,
        "nodeTypes": [{"id": k, "name": v["name"], "desc": v.get("description")}
                      for k, v in r["nodeTypeData"].items()],
        "difficulties": difficulties,
        "stages": stages,
        "enemies": enemies,
        "relics": relics,
        "capsules": capsules,
        "tools": tools,
        "bands": bands,
        "variations": variations,
        "endings": endings,
        "encounters": encounters,
    }
    dest = os.path.join(REPO, "app", "data", "rogue1.json")
    json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(dest) // 1024
    print(f"rogue1.json: zones={len(zones)} stages={len(stages)} enemies={len(enemies)} "
          f"relics={len(relics)} capsules={len(capsules)} variations={len(variations)} "
          f"encounters={len(encounters)} → {kb}KB")


if __name__ == "__main__":
    build_rogue1()
