#!/usr/bin/env python3
"""생존연산(Reclamation Algorithm) 가이드 데이터 생성.

입력: .gamedata/{kr,en,jp,cn}_sandbox_perm_table.json (fetch-gamedata.py TABLES)
출력: app/data/sandbox.json / .en.json / .ja.json

구성 (2026-08-12 사용자 확정 "생존연산 가이드, 중국어도 다 번역되도록"):
- v2 = sandbox_1 「사막 이야기」(SANDBOX_V2) — KR/EN/JP 공식 텍스트 3벌.
  요리·음료, 제작·건물·설치물, 지역·날씨, 조우(장면·선택지), 균열, 원정, 테크.
- v3 = sandbox_2 「重启锚点」(SANDBOX_V3) — **CN 선행 신시즌** (KR 미출시, 미래시).
  CN 원문에 scripts/sandbox-cn-ko.json 의 비공식 한국어 번역을 씌운다 (한국어 로케일만).
  번역이 없는 문자열은 CN 원문 그대로 나가고 빌드 로그에 미번역 수를 경고한다
  — cn-translation-fill 스킬과 같은 보완 흐름.

용량: 원본 3.4~7.5MB → 로케일당 수백 KB (가이드에 쓰는 필드만 추린다).
클라이언트는 탭 진입 시에만 지연 로드한다 (stages/rogue와 같은 성능 규칙).
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "app", "data")
GD = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".gamedata")

LOCALES = [("", "kr"), (".en", "en"), (".ja", "jp")]

# CN 선행분 비공식 번역 (CN 원문 → 한국어). 없는 키는 원문 유지 + 경고.
CN_KO_PATH = os.path.join(ROOT, "scripts", "sandbox-cn-ko.json")
CN_KO = json.load(open(CN_KO_PATH, encoding="utf-8")) if os.path.exists(CN_KO_PATH) else {}
_missing: set[str] = set()


def t_ko(s):
    """CN 문자열 → 비공식 한국어. 미등록이면 원문 그대로 두고 경고 수집."""
    if not s:
        return s
    hit = CN_KO.get(s)
    if hit is None:
        _missing.add(s)
        return s
    return hit


def clean(s):
    """리치 텍스트 태그 제거 — <@tag>…</> · <color=#…>…</color> 류."""
    if not s:
        return s
    s = re.sub(r"<@[^>]*>|<\$[^>]*>|</color>|<color=[^>]*>|</>", "", s)
    return s.replace("\\n", "\n").strip()


def load(prefix):
    p = os.path.join(GD, f"{prefix}_sandbox_perm_table.json")
    return json.load(open(p, encoding="utf-8"))


def build_v2(tbl):
    """sandbox_1 「사막 이야기」 — 해당 로케일 공식 텍스트."""
    d = tbl["detail"]["SANDBOX_V2"]["sandbox_1"]
    items_src = {k: v for k, v in tbl["itemData"].items() if k.startswith("sandbox_1")}
    items = {k: [v["itemName"], clean(v.get("itemUsage") or ""), v.get("itemRarity", 0), v.get("itemType", "")]
             for k, v in items_src.items()}

    foods = []
    for f in d["foodData"].values():
        foods.append({
            "id": f["id"],
            "attrs": f.get("attributes") or [],
            # 조합: 재료 id 배열 목록 (없으면 실패작·특수)
            "recipes": [r["mats"] for r in (f.get("recipes") or [])],
            # [변형타입, 이름, 효과]
            "variants": [[v.get("type"), v.get("name"), clean(v.get("usage") or "")] for v in (f.get("variants") or [])],
        })
    food_mats = [[m["id"], m.get("type"), m.get("attribute"), m.get("variantType"), clean(m.get("buffDesc") or "")]
                 for m in d["foodMatData"].values()]
    drink_mats = [[m["id"], m.get("count", 0)] for m in d["drinkMatData"].values()]

    # 설치물·건물 — itemTrapData가 레벨 행 단위라 baseName으로 묶는다
    trap_tags = {k: v["tagName"] for k, v in d["itemTrapTagData"].items()}
    building_rarity = {k: v.get("itemRarity", 0) for k, v in d["buildingItemData"].items()}
    traps = {}
    for row in d["itemTrapData"].values():
        base = row.get("minLevelItemId") or row["itemId"]
        g = traps.setdefault(base, {"name": row.get("baseItemName") or "", "tag": row.get("itemTag") or "",
                                    "type": row.get("itemType") or "", "lv": 0})
        g["lv"] = max(g["lv"], row.get("trapLevel", 1))

    crafts = []
    for c in d["craftItemData"].values():
        crafts.append({
            "id": c["itemId"],
            "type": c.get("type") or "",
            "unlock": clean(c.get("buildingUnlockDesc") or ""),
            "mats": c.get("materialItems") or {},
            "rarity": building_rarity.get(c["itemId"], 0),
        })

    stages = [[s["stageId"], s.get("code") or "", s.get("name") or "", clean(s.get("description") or ""),
               s.get("actionCost", 0), s.get("actionCostEnemyRush", 0)]
              for s in d["stageData"].values()]
    zones = {z["zoneId"]: z.get("zoneName") or "" for z in d["zoneData"].values()}
    node_types = {k: v.get("name") or "" for k, v in d["nodeTypeData"].items()}
    weather = [[w["weatherId"], w.get("name") or "", w.get("weatherLevel", 0), w.get("weatherTypeName") or "",
                clean(w.get("functionDesc") or ""), clean(w.get("description") or "")]
               for w in d["weatherData"].values()]

    # 조우 — 장면(scene)과 선택지(choice)를 장면 안에 풀어 넣는다
    choices = d["eventChoiceData"]
    scenes = []
    for sc in d["eventSceneData"].values():
        scenes.append({
            "id": sc["eventSceneId"],
            "title": sc.get("title") or "",
            "desc": clean(sc.get("desc") or ""),
            "choices": [[choices[c].get("title") or "", clean(choices[c].get("desc") or ""), choices[c].get("costAction", 0)]
                        for c in (sc.get("choiceIds") or []) if c in choices],
        })

    rift = {
        "mains": [[m.get("title") or "", clean(m.get("desc") or ""), m.get("targetDayCount", 0), m.get("questIconName") or ""]
                  for m in d["riftMainTargetData"].values()],
        "subs": [[m.get("title") or m.get("desc") or "", clean(m.get("desc") or "")] for m in d["riftSubTargetData"].values()],
        "diffs": [[m.get("difficultyLevel", 0), clean(m.get("desc") or "")] for m in d["riftDifficultyData"].values()],
    }
    expeditions = [[clean(e.get("desc") or ""), clean(e.get("effectDesc") or ""), e.get("costDrink", 0),
                    e.get("charCnt", 0), e.get("minEliteRank", 0), e.get("duration", 0)]
                   for e in d["expeditionData"].values()]
    techs = [[t.get("techName") or "", t.get("techType") or "", t.get("tokenCost", 0), clean(t.get("rawDesc") or "")]
             for t in d["developmentData"].values()]

    return {
        "name": tbl["basicInfo"]["sandbox_1"].get("topicName") or "",
        "items": items, "foods": foods, "foodMats": food_mats, "drinkMats": drink_mats,
        "crafts": crafts, "traps": traps, "trapTags": trap_tags,
        "stages": stages, "zones": zones, "nodeTypes": node_types, "weather": weather,
        "scenes": scenes, "rift": rift, "expeditions": expeditions, "techs": techs,
    }


def build_v3(cn, ko_mode):
    """sandbox_2 「重启锚点」 — CN 선행. ko_mode면 비공식 번역을 씌우고 CN 원문을 병기한다."""
    d = cn["detail"]["SANDBOX_V3"]["sandbox_2"]
    tr = t_ko if ko_mode else (lambda s: s)
    items_src = {k: v for k, v in cn["itemData"].items() if k.startswith("sandbox_2")}
    # [번역명(없으면 CN), CN 원문, 용도(CN), 희귀도]
    items = {}
    for k, v in items_src.items():
        cn_name = v.get("itemName") or ""
        items[k] = [tr(cn_name), cn_name, clean(v.get("itemUsage") or ""), v.get("itemRarity", 0), v.get("itemType", "")]

    process = [[r.get("outputItemId") or "", r.get("outputCnt", 1), r.get("materials") or {}, r.get("recipeLevel", 1)]
               for r in d["processRecipeData"].values()]
    builds = [[b.get("outputItemId") or "", b.get("materials") or {}, b.get("outputTrapType") or ""]
              for b in d["buildRecipeData"].values()]
    stages = [[s.get("code") or "", tr(s.get("name") or ""), s.get("name") or "", clean(s.get("description") or "")]
              for s in d["stageData"].values()]
    weather = [[tr(w.get("name") or ""), w.get("name") or "", clean(w.get("funcDesc") or ""), clean(w.get("desc") or "")]
               for w in d["weatherData"].values()]
    choices = d["eventChoiceData"]
    scenes = []
    for sc in d["eventSceneData"].values():
        scenes.append({
            "title": tr(sc.get("title") or ""),
            "cn": sc.get("title") or "",
            "desc": clean(sc.get("desc") or ""),
            "choices": [[tr(choices[c].get("title") or ""), clean(choices[c].get("desc") or "")]
                        for c in (sc.get("choiceIdList") or []) if c in choices],
        })
    info = cn["basicInfo"]["sandbox_2"]
    return {
        "name": tr(info.get("topicName") or ""), "cnName": info.get("topicName") or "",
        "start": info.get("topicStartTime", 0),
        "items": items, "process": process, "builds": builds,
        "stages": stages, "weather": weather, "scenes": scenes,
    }


def main():
    cn = load("cn")
    for suffix, prefix in LOCALES:
        tbl = load(prefix)
        doc = {"v2": build_v2(tbl), "v3": build_v3(cn, ko_mode=(suffix == ""))}
        p = os.path.join(DATA, f"sandbox{suffix}.json")
        json.dump(doc, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"  sandbox{suffix}.json: {os.path.getsize(p) // 1024}KB")
    if _missing:
        print(f"⚠ CN 선행분 미번역 {len(_missing)}건 — scripts/sandbox-cn-ko.json에 보완 (cn-translation-fill 흐름)")
        for s in sorted(_missing)[:20]:
            print(f"   未: {s[:60]}")


if __name__ == "__main__":
    main()
